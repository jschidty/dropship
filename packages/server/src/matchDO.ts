import {
  DEFAULT_COMMAND_LEAD_TICKS,
  PHASE_ONE_PLAYER_IDS,
  createMinimalSkirmishConfig,
  type ClientMessage,
  type CatchupMessage,
  type CommandAckMessage,
  type CommandBatch,
  type ConnectionStatusMessage,
  type DesyncMessage,
  type HashMessage,
  type PlayerId,
  type ServerMessage,
  type SnapshotMessage,
} from "@drop-ship/protocol";
import { createCommandBuffer, type CommandBuffer } from "./commandBuffer";
import {
  createCommandLogStore,
  type CommandLogStore,
} from "./commandLogStore";
import { createHashArbiter, type HashArbiter } from "./hashArbiter";
import {
  createSnapshotStore,
  type SnapshotStore,
  type StoredSnapshot,
} from "./snapshotStore";
import { createTickLoop, type TickLoop } from "./tickLoop";

const CURRENT_TICK_KEY = "match:currentTick";

type MatchSession = {
  id: string;
  playerId: PlayerId;
  socket: WebSocket;
};

export type MatchCoordinator = Readonly<{
  commandBuffer: CommandBuffer;
  commandLogStore: CommandLogStore;
  hashArbiter: HashArbiter;
  snapshotStore: SnapshotStore;
  tickLoop: TickLoop;
  receive: (
    message: ClientMessage
  ) => Promise<
    CommandAckMessage | DesyncMessage | StoredSnapshot | CatchupMessage | null
  >;
  nextTick: () => CommandBatch;
}>;

export type MatchCoordinatorOptions = Readonly<{
  commandLeadTicks?: number;
  initialTick?: number;
  commandLogStore?: CommandLogStore;
  snapshotStore?: SnapshotStore;
}>;

export function createMatchCoordinator(
  options: MatchCoordinatorOptions | number = {}
): MatchCoordinator {
  const optionBag: MatchCoordinatorOptions =
    typeof options === "number" ? {} : options;
  const commandLeadTicks =
    typeof options === "number"
      ? options
      : optionBag.commandLeadTicks ?? DEFAULT_COMMAND_LEAD_TICKS;
  const commandBuffer = createCommandBuffer();
  const commandLogStore = optionBag.commandLogStore ?? createCommandLogStore();
  const hashArbiter = createHashArbiter(PHASE_ONE_PLAYER_IDS);
  const snapshotStore = optionBag.snapshotStore ?? createSnapshotStore();
  const tickLoop = createTickLoop({
    initialTick: optionBag.initialTick,
    takeBatch: (tick) => commandBuffer.takeBatch(tick),
  });

  return {
    commandBuffer,
    commandLogStore,
    hashArbiter,
    snapshotStore,
    tickLoop,
    async receive(message) {
      if (message.type === "command") {
        const executeTick = tickLoop.currentTick() + commandLeadTicks;
        return commandBuffer.schedule(executeTick, message);
      }

      if (message.type === "hash") {
        return recordHash(hashArbiter, message);
      }

      if (message.type === "snapshot") {
        return recordSnapshot(snapshotStore, message);
      }

      if (message.type === "reconnect") {
        return createCatchupMessage(
          snapshotStore,
          commandLogStore,
          tickLoop.currentTick()
        );
      }

      return null;
    },
    nextTick() {
      return tickLoop.nextBatch();
    },
  };
}

export class MatchDurableObject {
  private coordinator: MatchCoordinator | null = null;
  private readonly sessions = new Map<string, MatchSession>();
  private config: ReturnType<typeof createMinimalSkirmishConfig> | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private broadcastingTick = false;
  private nextSessionId = 1;

  constructor(private readonly state?: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const coordinator = await this.getCoordinator();
    const url = new URL(request.url);

    if (url.pathname.endsWith("/ws")) {
      return this.connect(request, url, coordinator);
    }

    return Response.json(this.readStatus(coordinator));
  }

  private async getCoordinator(): Promise<MatchCoordinator> {
    if (this.coordinator) {
      return this.coordinator;
    }

    const storage = this.state?.storage;
    const initialTick = (await storage?.get<number>(CURRENT_TICK_KEY)) ?? 0;

    this.coordinator = createMatchCoordinator({
      initialTick,
      commandLogStore: createCommandLogStore(storage),
      snapshotStore: createSnapshotStore({
        storage,
      }),
    });

    return this.coordinator;
  }

  private requireCoordinator(): MatchCoordinator {
    if (!this.coordinator) {
      throw new Error("Match coordinator has not been initialized");
    }

    return this.coordinator;
  }

  private connect(
    request: Request,
    url: URL,
    coordinator: MatchCoordinator
  ): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const playerId = parsePlayerId(url.searchParams.get("player"));

    if (!playerId) {
      return Response.json(
        {
          error: "invalid-player",
          expected: PHASE_ONE_PLAYER_IDS,
        },
        { status: 400 }
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const session: MatchSession = {
      id: `${Date.now().toString(36)}-${this.nextSessionId}`,
      playerId,
      socket: server,
    };

    this.nextSessionId += 1;
    server.accept();
    this.sessions.set(session.id, session);
    const config = this.getMatchConfig(url);
    this.send(session, {
      type: "matchStart",
      playerId,
      serverTick: coordinator.tickLoop.currentTick(),
      config,
    });
    this.broadcastConnectionStatus();
    this.updateTicking();

    server.addEventListener("message", (event: MessageEvent) => {
      void this.receiveSocketMessage(session.id, event.data);
    });
    server.addEventListener("close", () => {
      this.disconnect(session.id);
    });
    server.addEventListener("error", () => {
      this.disconnect(session.id);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private getMatchConfig(url: URL): ReturnType<typeof createMinimalSkirmishConfig> {
    if (this.config) {
      return this.config;
    }

    const matchId = parseMatchIdFromPath(url.pathname) ?? "demo";
    this.config = createMinimalSkirmishConfig({
      matchId,
      seed: parseSeed(url.searchParams.get("seed")) ?? parseSeed(matchId),
    });
    return this.config;
  }

  private async receiveSocketMessage(
    sessionId: string,
    data: unknown
  ): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session || typeof data !== "string") {
      return;
    }

    const message = parseClientMessage(data);

    if (!message) {
      this.sendError(session, "invalid-message");
      return;
    }

    let result:
      | CommandAckMessage
      | DesyncMessage
      | StoredSnapshot
      | CatchupMessage
      | null;

    try {
      const coordinator = await this.getCoordinator();
      result = await coordinator.receive({
        ...message,
        playerId: session.playerId,
      });
    } catch {
      this.sendError(session, "server-error");
      return;
    }

    if (!result) {
      return;
    }

    if (!("type" in result)) {
      return;
    }

    if (result.type === "desync") {
      this.broadcast(result);
      return;
    }

    if (result.type === "commandAck") {
      this.send(session, result);
      return;
    }

    if (result.type === "catchup") {
      this.send(session, result);
    }
  }

  private disconnect(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) {
      return;
    }

    this.broadcastConnectionStatus();
    this.updateTicking();
  }

  private updateTicking(): void {
    const shouldRun = PHASE_ONE_PLAYER_IDS.every((playerId) =>
      this.hasConnectedPlayer(playerId)
    );

    if (shouldRun && this.timerId === null) {
      this.timerId = setInterval(() => {
        void this.broadcastNextTick();
      }, 1000 / 30);
      this.broadcastConnectionStatus();
      return;
    }

    if (!shouldRun && this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.broadcastConnectionStatus();
    }
  }

  private async broadcastNextTick(): Promise<void> {
    if (this.broadcastingTick) {
      return;
    }

    this.broadcastingTick = true;

    try {
      const coordinator = await this.getCoordinator();
      const batch = coordinator.nextTick();

      await coordinator.commandLogStore.record(batch);
      await this.state?.storage.put(
        CURRENT_TICK_KEY,
        coordinator.tickLoop.currentTick()
      );

      this.broadcast({
        type: "tickCommands",
        batch,
      });

      if (coordinator.tickLoop.currentTick() % 30 === 0) {
        this.broadcastConnectionStatus();
      }
    } finally {
      this.broadcastingTick = false;
    }
  }

  private broadcastConnectionStatus(): void {
    this.broadcast(this.createConnectionStatus());
  }

  private createConnectionStatus(): ConnectionStatusMessage {
    return {
      type: "connectionStatus",
      serverTick: this.requireCoordinator().tickLoop.currentTick(),
      running: this.timerId !== null,
      players: PHASE_ONE_PLAYER_IDS.map((playerId) => ({
        playerId,
        connected: this.hasConnectedPlayer(playerId),
      })),
    };
  }

  private hasConnectedPlayer(playerId: PlayerId): boolean {
    for (const session of this.sessions.values()) {
      if (session.playerId === playerId) {
        return true;
      }
    }

    return false;
  }

  private broadcast(message: ServerMessage): void {
    for (const session of this.sessions.values()) {
      this.send(session, message);
    }
  }

  private send(session: MatchSession, message: ServerMessage): void {
    try {
      session.socket.send(JSON.stringify(message));
    } catch {
      this.disconnect(session.id);
    }
  }

  private sendError(session: MatchSession, code: string): void {
    try {
      session.socket.send(JSON.stringify({ type: "error", code }));
    } catch {
      this.disconnect(session.id);
    }
  }

  private readStatus(coordinator: MatchCoordinator) {
    return {
      status: "match-do",
      tick: coordinator.tickLoop.currentTick(),
      running: this.timerId !== null,
      scheduledTicks: coordinator.commandBuffer.peekScheduledTicks(),
      sessions: [...this.sessions.values()]
        .map((session) => ({
          id: session.id,
          playerId: session.playerId,
        }))
        .sort((a, b) =>
          a.playerId === b.playerId
            ? a.id.localeCompare(b.id)
            : a.playerId - b.playerId
        ),
    };
  }
}

function recordHash(
  hashArbiter: HashArbiter,
  message: HashMessage
): DesyncMessage | null {
  return hashArbiter.record(message);
}

async function recordSnapshot(
  snapshotStore: SnapshotStore,
  message: SnapshotMessage
): Promise<StoredSnapshot> {
  return snapshotStore.write(message.playerId, message.snapshot);
}

async function createCatchupMessage(
  snapshotStore: SnapshotStore,
  commandLogStore: CommandLogStore,
  serverTick: number
): Promise<CatchupMessage> {
  const latestSnapshot = await snapshotStore.latestAtOrBefore(serverTick);
  const snapshotTick = latestSnapshot?.tick ?? 0;
  const commands = await commandLogStore.readRange(snapshotTick, serverTick);

  return {
    type: "catchup",
    serverTick,
    snapshotTick,
    snapshot: latestSnapshot?.snapshot ?? null,
    commands,
  };
}

function parsePlayerId(value: string | null): PlayerId | null {
  const parsed = Number(value);

  return parsed === 1 || parsed === 2 ? parsed : null;
}

function parseSeed(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function parseMatchIdFromPath(pathname: string): string | null {
  const match = /^\/api\/matches\/([^/]+)(?:\/ws)?$/.exec(pathname);

  return match ? decodeURIComponent(match[1]) : null;
}

function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data) as Partial<ClientMessage>;

    if (
      parsed.type === "ready" ||
      parsed.type === "command" ||
      parsed.type === "hash" ||
      parsed.type === "snapshot" ||
      parsed.type === "reconnect"
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}
