import {
  DEFAULT_COMMAND_LEAD_TICKS,
  PHASE_ONE_PLAYER_IDS,
  createMinimalSkirmishConfig,
  type ClientMessage,
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
import { createHashArbiter, type HashArbiter } from "./hashArbiter";
import {
  createSnapshotStore,
  type SnapshotStore,
  type StoredSnapshot,
} from "./snapshotStore";
import { createTickLoop, type TickLoop } from "./tickLoop";

type MatchSession = {
  id: string;
  playerId: PlayerId;
  socket: WebSocket;
};

export type MatchCoordinator = Readonly<{
  commandBuffer: CommandBuffer;
  hashArbiter: HashArbiter;
  snapshotStore: SnapshotStore;
  tickLoop: TickLoop;
  receive: (
    message: ClientMessage
  ) => CommandAckMessage | DesyncMessage | StoredSnapshot | null;
  nextTick: () => CommandBatch;
}>;

export function createMatchCoordinator(
  commandLeadTicks = DEFAULT_COMMAND_LEAD_TICKS
): MatchCoordinator {
  const commandBuffer = createCommandBuffer();
  const hashArbiter = createHashArbiter(PHASE_ONE_PLAYER_IDS);
  const snapshotStore = createSnapshotStore();
  const tickLoop = createTickLoop({
    takeBatch: (tick) => commandBuffer.takeBatch(tick),
  });

  return {
    commandBuffer,
    hashArbiter,
    snapshotStore,
    tickLoop,
    receive(message) {
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

      return null;
    },
    nextTick() {
      return tickLoop.nextBatch();
    },
  };
}

export class MatchDurableObject {
  private readonly coordinator = createMatchCoordinator();
  private readonly sessions = new Map<string, MatchSession>();
  private readonly config = createMinimalSkirmishConfig();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private nextSessionId = 1;

  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/ws")) {
      return this.connect(request, url);
    }

    return Response.json(this.readStatus());
  }

  private connect(request: Request, url: URL): Response {
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
    this.send(session, {
      type: "matchStart",
      playerId,
      serverTick: this.coordinator.tickLoop.currentTick(),
      config: this.config,
    });
    this.broadcastConnectionStatus();
    this.updateTicking();

    server.addEventListener("message", (event: MessageEvent) => {
      this.receiveSocketMessage(session.id, event.data);
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

  private receiveSocketMessage(sessionId: string, data: unknown): void {
    const session = this.sessions.get(sessionId);

    if (!session || typeof data !== "string") {
      return;
    }

    const message = parseClientMessage(data);

    if (!message) {
      this.sendError(session, "invalid-message");
      return;
    }

    const result = this.coordinator.receive({
      ...message,
      playerId: session.playerId,
    });

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
        this.broadcastNextTick();
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

  private broadcastNextTick(): void {
    const batch = this.coordinator.nextTick();
    this.broadcast({
      type: "tickCommands",
      batch,
    });

    if (this.coordinator.tickLoop.currentTick() % 30 === 0) {
      this.broadcastConnectionStatus();
    }
  }

  private broadcastConnectionStatus(): void {
    this.broadcast(this.createConnectionStatus());
  }

  private createConnectionStatus(): ConnectionStatusMessage {
    return {
      type: "connectionStatus",
      serverTick: this.coordinator.tickLoop.currentTick(),
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

  private readStatus() {
    return {
      status: "match-do",
      tick: this.coordinator.tickLoop.currentTick(),
      running: this.timerId !== null,
      scheduledTicks: this.coordinator.commandBuffer.peekScheduledTicks(),
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

function recordSnapshot(
  snapshotStore: SnapshotStore,
  message: SnapshotMessage
): StoredSnapshot {
  return snapshotStore.write(message.playerId, message.snapshot);
}

function parsePlayerId(value: string | null): PlayerId | null {
  const parsed = Number(value);

  return parsed === 1 || parsed === 2 ? parsed : null;
}

function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data) as Partial<ClientMessage>;

    if (
      parsed.type === "ready" ||
      parsed.type === "command" ||
      parsed.type === "hash" ||
      parsed.type === "snapshot"
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}
