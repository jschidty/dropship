import { DEFAULT_CONTENT_HASH } from "@drop-ship/content";
import {
  DEFAULT_COMMAND_LEAD_TICKS,
  PHASE_ONE_PLAYER_IDS,
  createCaptureDemoConfig,
  type ClientMessage,
  type CatchupMessage,
  type CommandAckMessage,
  type CommandBatch,
  type ConnectionStatusMessage,
  type DesyncMessage,
  type HashMessage,
  type MatchConfig,
  type MatchEndMessage,
  type MatchSessionRole,
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
import {
  MATCH_CONFIG_KEY,
  readOrCreateStoredMatchConfig,
} from "./matchConfigStore";
import { createMatchEndStore, type MatchEndStore } from "./matchEnd";
import { createTickLoop, type TickLoop } from "./tickLoop";

const CURRENT_TICK_KEY = "match:currentTick";
const CREATOR_TOKEN_KEY = "match:creatorToken";
const PLAYER_TWO_TOKEN_KEY = "match:playerTwoToken";
const INTERNAL_PLAYER_ID_HEADER = "x-drop-ship-player-id";
const INTERNAL_CREATOR_TOKEN_HEADER = "x-drop-ship-creator-token";

type MatchSession = {
  id: string;
  seat: PlayerId | null;
  playerId: PlayerId;
  role: MatchSessionRole;
  canControl: boolean;
  seatToken?: string;
  socket: WebSocket;
};

type MatchSessionAssignment = Readonly<{
  seat: PlayerId | null;
  playerId: PlayerId;
  role: MatchSessionRole;
  canControl: boolean;
  seatToken?: string;
}>;

export type MatchCoordinator = Readonly<{
  commandBuffer: CommandBuffer;
  commandLogStore: CommandLogStore;
  hashArbiter: HashArbiter;
  matchEndStore: MatchEndStore;
  snapshotStore: SnapshotStore;
  tickLoop: TickLoop;
  receive: (
    message: ClientMessage
  ) => Promise<
    | CommandAckMessage
    | DesyncMessage
    | StoredSnapshot
    | CatchupMessage
    | MatchEndMessage
    | null
  >;
  nextTick: () => CommandBatch;
}>;

export type MatchCoordinatorOptions = Readonly<{
  commandLeadTicks?: number;
  initialTick?: number;
  commandLogStore?: CommandLogStore;
  matchEndStore?: MatchEndStore;
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
  const matchEndStore = optionBag.matchEndStore ?? createMatchEndStore();
  const snapshotStore = optionBag.snapshotStore ?? createSnapshotStore();
  const tickLoop = createTickLoop({
    initialTick: optionBag.initialTick,
    takeBatch: (tick) => commandBuffer.takeBatch(tick),
  });

  return {
    commandBuffer,
    commandLogStore,
    hashArbiter,
    matchEndStore,
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

      if (message.type === "matchEndReport") {
        return matchEndStore.record(message);
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
  private config: MatchConfig | null = null;
  private matchEnded = false;
  private matchStarted = false;
  private readonly readyPlayerIds = new Set<PlayerId>();
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

    if (request.method === "POST") {
      return this.initializeMatch(request, coordinator);
    }

    return Response.json(this.readStatus(coordinator));
  }

  private async getCoordinator(): Promise<MatchCoordinator> {
    if (this.coordinator) {
      return this.coordinator;
    }

    const storage = this.state?.storage;
    const initialTick = (await storage?.get<number>(CURRENT_TICK_KEY)) ?? 0;
    this.matchStarted ||= initialTick > 0;

    this.coordinator = createMatchCoordinator({
      initialTick,
      commandLogStore: createCommandLogStore(storage),
      matchEndStore: createMatchEndStore(storage),
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

  private async connect(
    request: Request,
    url: URL,
    coordinator: MatchCoordinator
  ): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const assignment = await this.assignSession(request, url);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const session: MatchSession = {
      id: `${Date.now().toString(36)}-${this.nextSessionId}`,
      ...assignment,
      socket: server,
    };

    this.nextSessionId += 1;
    server.accept();
    this.sessions.set(session.id, session);
    const config = await this.getMatchConfig(url);
    this.send(session, {
      type: "matchStart",
      playerId: assignment.playerId,
      role: assignment.role,
      canControl: assignment.canControl,
      seatToken: assignment.seatToken,
      serverTick: coordinator.tickLoop.currentTick(),
      config,
    });
    await this.sendStoredMatchEndIfPresent(session, coordinator);
    this.updateTicking();
    this.broadcastConnectionStatus();

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

  private async getMatchConfig(url: URL): Promise<MatchConfig> {
    if (this.config) {
      return this.config;
    }

    const matchId = parseMatchIdFromPath(url.pathname) ?? "demo";
    this.config = await readOrCreateStoredMatchConfig(
      this.state?.storage,
      () =>
        createCaptureDemoConfig({
          matchId,
          seed: parseSeed(url.searchParams.get("seed")) ?? parseSeed(matchId),
          contentHash: DEFAULT_CONTENT_HASH,
        })
    );
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
      | MatchEndMessage
      | null;

    try {
      if (!canSessionSendMessage(session, message)) {
        return;
      }

      const sessionMessage = {
        ...message,
        playerId: session.seat ?? session.playerId,
      };

      if (sessionMessage.type === "ready") {
        this.markSessionReady(session);
        return;
      }

      if (sessionMessage.type === "replay") {
        await this.replayMatch(session);
        return;
      }

      const coordinator = await this.getCoordinator();
      result =
        sessionMessage.type === "matchEndReport" &&
        this.shouldTrustSingleMatchEndReport()
          ? await coordinator.matchEndStore.recordTrusted(sessionMessage)
          : await coordinator.receive(sessionMessage);
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

    if (result.type === "matchEnd") {
      this.finalizeMatchEnd(result);
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
    const session = this.sessions.get(sessionId);

    if (!session || !this.sessions.delete(sessionId)) {
      return;
    }

    if (!this.matchStarted && session.seat !== null) {
      this.readyPlayerIds.delete(session.seat);
    }

    this.updateTicking();
    this.broadcastConnectionStatus();
    void this.finalizeTrustedReportFromConnectedPlayer();
  }

  private updateTicking(): void {
    if (
      !this.matchStarted &&
      this.allPlayersConnected() &&
      this.allPlayersReady()
    ) {
      this.matchStarted = true;
    }

    const shouldRun =
      !this.matchEnded && this.matchStarted && this.hasConnectedPlayer();

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
    if (this.broadcastingTick || this.matchEnded) {
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
        ready: this.matchStarted || this.readyPlayerIds.has(playerId),
      })),
      spectatorCount: this.countSpectators(),
    };
  }

  private hasConnectedPlayer(): boolean;
  private hasConnectedPlayer(playerId: PlayerId): boolean;
  private hasConnectedPlayer(playerId?: PlayerId): boolean {
    if (playerId === undefined) {
      for (const session of this.sessions.values()) {
        if (session.seat !== null) {
          return true;
        }
      }

      return false;
    }

    for (const session of this.sessions.values()) {
      if (session.seat === playerId) {
        return true;
      }
    }

    return false;
  }

  private allPlayersConnected(): boolean {
    return PHASE_ONE_PLAYER_IDS.every((playerId) =>
      this.hasConnectedPlayer(playerId)
    );
  }

  private allPlayersReady(): boolean {
    return PHASE_ONE_PLAYER_IDS.every((playerId) =>
      this.readyPlayerIds.has(playerId)
    );
  }

  private markSessionReady(session: MatchSession): void {
    if (this.matchStarted || session.seat === null || !session.canControl) {
      return;
    }

    this.readyPlayerIds.add(session.seat);
    this.updateTicking();
    this.broadcastConnectionStatus();
  }

  private async assignSession(
    request: Request,
    url: URL
  ): Promise<MatchSessionAssignment> {
    const storedCreatorToken = await this.readCreatorToken();
    const storedPlayerTwoToken = await this.readPlayerTwoToken();
    const creatorToken = url.searchParams.get("creatorToken");
    const playerToken = url.searchParams.get("playerToken");
    const reconnectSeat = resolveAuthenticatedSeat({
      creatorToken,
      storedCreatorToken,
      playerToken,
      storedPlayerTwoToken,
    });

    if (reconnectSeat !== null) {
      this.disconnectSeat(reconnectSeat);
    }

    const newPlayerTwoToken =
      storedCreatorToken && !storedPlayerTwoToken ? createSeatToken() : null;
    const assignment = assignMatchSession({
      requestedPlayerId: resolveConnectionPlayerId(request, url),
      creatorToken,
      storedCreatorToken,
      playerToken,
      storedPlayerTwoToken,
      newPlayerTwoToken,
      connectedPlayerIds: this.connectedPlayerIds(),
    });

    if (
      assignment.seat === 2 &&
      assignment.seatToken &&
      assignment.seatToken !== storedPlayerTwoToken
    ) {
      await this.state?.storage.put(PLAYER_TWO_TOKEN_KEY, assignment.seatToken);
    }

    return assignment;
  }

  private disconnectSeat(seat: PlayerId): void {
    for (const session of this.sessions.values()) {
      if (session.seat !== seat) {
        continue;
      }

      this.sessions.delete(session.id);

      if (!this.matchStarted) {
        this.readyPlayerIds.delete(seat);
      }

      try {
        session.socket.close(1000, "seat-replaced");
      } catch {
        // The stale session has already been removed.
      }
    }
  }

  private connectedPlayerIds(): readonly PlayerId[] {
    return [...this.sessions.values()]
      .map((session) => session.seat)
      .filter((seat): seat is PlayerId => seat !== null);
  }

  private countSpectators(): number {
    return [...this.sessions.values()].filter((session) => !session.canControl)
      .length;
  }

  private shouldTrustSingleMatchEndReport(): boolean {
    return this.matchStarted && !this.allPlayersConnected();
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

  private async sendStoredMatchEndIfPresent(
    session: MatchSession,
    coordinator: MatchCoordinator
  ): Promise<void> {
    const final = await coordinator.matchEndStore.readFinal();

    if (!final) {
      return;
    }

    this.matchEnded = true;
    this.send(session, final);
    this.updateTicking();
  }

  private finalizeMatchEnd(message: MatchEndMessage): void {
    if (this.matchEnded) {
      return;
    }

    this.matchEnded = true;
    this.broadcast(message);
    this.updateTicking();
  }

  private async replayMatch(session: MatchSession): Promise<void> {
    if (!this.matchEnded || !session.canControl || session.seat === null) {
      return;
    }

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    const storage = this.state?.storage;
    await deleteStoredMatchRuntimeState(storage);

    const config = createCaptureDemoConfig({
      matchId: this.config?.matchId ?? "demo",
      seed: createRandomSeed(this.config?.seed),
      contentHash: DEFAULT_CONTENT_HASH,
    });
    await storage?.put(MATCH_CONFIG_KEY, config);

    this.config = config;
    this.coordinator = createMatchCoordinator({
      commandLogStore: createCommandLogStore(storage),
      matchEndStore: createMatchEndStore(storage),
      snapshotStore: createSnapshotStore({
        storage,
      }),
    });
    this.matchEnded = false;
    this.matchStarted = this.allPlayersConnected();
    this.readyPlayerIds.clear();
    this.broadcastingTick = false;

    for (const activeSession of this.sessions.values()) {
      this.send(activeSession, {
        type: "matchStart",
        playerId: activeSession.playerId,
        role: activeSession.role,
        canControl: activeSession.canControl,
        seatToken: activeSession.seatToken,
        serverTick: 0,
        config,
      });
    }

    this.updateTicking();
    this.broadcastConnectionStatus();
  }

  private async finalizeTrustedReportFromConnectedPlayer(): Promise<void> {
    if (
      this.matchEnded ||
      !this.matchStarted ||
      this.allPlayersConnected() ||
      !this.hasConnectedPlayer()
    ) {
      return;
    }

    const coordinator = await this.getCoordinator();
    const connectedPlayerIds = new Set(
      [...this.sessions.values()]
        .filter((session) => session.seat !== null)
        .map((session) => session.seat as PlayerId)
    );
    const trustedReport = (await coordinator.matchEndStore.listReports()).find(
      (report) => connectedPlayerIds.has(report.playerId)
    );

    if (!trustedReport) {
      return;
    }

    this.finalizeMatchEnd(
      await coordinator.matchEndStore.recordTrusted(trustedReport)
    );
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
          playerId: session.seat,
          role: session.role,
          canControl: session.canControl,
        }))
        .sort((a, b) =>
          (a.playerId ?? 99) === (b.playerId ?? 99)
            ? a.id.localeCompare(b.id)
            : (a.playerId ?? 99) - (b.playerId ?? 99)
        ),
    };
  }

  private async initializeMatch(
    request: Request,
    coordinator: MatchCoordinator
  ): Promise<Response> {
    const creatorToken = request.headers.get(INTERNAL_CREATOR_TOKEN_HEADER);

    if (creatorToken) {
      await this.state?.storage.put(CREATOR_TOKEN_KEY, creatorToken);
    }

    const config = await this.getMatchConfig(new URL(request.url));

    return Response.json({
      status: "match-do",
      matchId: config.matchId,
      tick: coordinator.tickLoop.currentTick(),
      initialized: true,
    });
  }

  private async readCreatorToken(): Promise<string | null> {
    return (await this.state?.storage.get<string>(CREATOR_TOKEN_KEY)) ?? null;
  }

  private async readPlayerTwoToken(): Promise<string | null> {
    return (await this.state?.storage.get<string>(PLAYER_TWO_TOKEN_KEY)) ?? null;
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

function createPlayerAssignment(
  playerId: PlayerId,
  seatToken?: string | null
): MatchSessionAssignment {
  const assignment: MatchSessionAssignment = {
    seat: playerId,
    playerId,
    role: playerId === 2 ? "player2" : "player1",
    canControl: true,
  };

  if (seatToken) {
    return {
      ...assignment,
      seatToken,
    };
  }

  return assignment;
}

export function assignMatchSession(options: {
  requestedPlayerId?: PlayerId | null;
  creatorToken?: string | null;
  storedCreatorToken?: string | null;
  playerToken?: string | null;
  storedPlayerTwoToken?: string | null;
  newPlayerTwoToken?: string | null;
  connectedPlayerIds?: readonly PlayerId[];
}): MatchSessionAssignment {
  const connectedPlayerIds = options.connectedPlayerIds ?? [];

  if (options.requestedPlayerId) {
    return !connectedPlayerIds.includes(options.requestedPlayerId)
      ? createPlayerAssignment(options.requestedPlayerId)
      : createSpectatorAssignment();
  }

  const storedCreatorToken = options.storedCreatorToken;
  const isCreator =
    Boolean(options.creatorToken) && options.creatorToken === storedCreatorToken;
  const isPlayerTwo =
    Boolean(options.playerToken) &&
    options.playerToken === options.storedPlayerTwoToken;

  if (isCreator) {
    return !connectedPlayerIds.includes(1)
      ? createPlayerAssignment(1)
      : createSpectatorAssignment();
  }

  if (isPlayerTwo) {
    return !connectedPlayerIds.includes(2)
      ? createPlayerAssignment(2, options.storedPlayerTwoToken)
      : createSpectatorAssignment();
  }

  if (storedCreatorToken) {
    return !options.storedPlayerTwoToken && !connectedPlayerIds.includes(2)
      ? createPlayerAssignment(2, options.newPlayerTwoToken)
      : createSpectatorAssignment();
  }

  const availableSeat = PHASE_ONE_PLAYER_IDS.find(
    (playerId) => !connectedPlayerIds.includes(playerId)
  );

  return availableSeat
    ? createPlayerAssignment(availableSeat)
    : createSpectatorAssignment();
}

function resolveAuthenticatedSeat(options: {
  creatorToken?: string | null;
  storedCreatorToken?: string | null;
  playerToken?: string | null;
  storedPlayerTwoToken?: string | null;
}): PlayerId | null {
  if (
    options.creatorToken &&
    options.creatorToken === options.storedCreatorToken
  ) {
    return 1;
  }

  if (
    options.playerToken &&
    options.playerToken === options.storedPlayerTwoToken
  ) {
    return 2;
  }

  return null;
}

function createSpectatorAssignment(): MatchSessionAssignment {
  return {
    seat: null,
    playerId: 1,
    role: "spectator",
    canControl: false,
  };
}

function createSeatToken(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  return `seat-${randomId}`;
}

function canSessionSendMessage(
  session: MatchSession,
  message: ClientMessage
): boolean {
  if (message.type === "ready" || message.type === "reconnect") {
    return true;
  }

  return session.canControl && session.seat !== null;
}

function parsePlayerId(value: string | null): PlayerId | null {
  const parsed = Number(value);

  return parsed === 1 || parsed === 2 ? parsed : null;
}

function resolveConnectionPlayerId(
  request: Request,
  url: URL
): PlayerId | null {
  const internalPlayerId = parsePlayerId(
    request.headers.get(INTERNAL_PLAYER_ID_HEADER)
  );

  if (internalPlayerId) {
    return internalPlayerId;
  }

  if (!allowsDebugSeat(url)) {
    return null;
  }

  return parsePlayerId(url.searchParams.get("player"));
}

function allowsDebugSeat(url: URL): boolean {
  return url.searchParams.get("debugSeat") === "1" && isLocalDebugHost(url.hostname);
}

function isLocalDebugHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function parseSeed(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

async function deleteStoredMatchRuntimeState(
  storage: DurableObjectStorage | undefined
): Promise<void> {
  if (!storage) {
    return;
  }

  const stored = await storage.list();
  const keys = [...stored.keys()].filter(
    (key) => key !== CREATOR_TOKEN_KEY && key !== PLAYER_TWO_TOKEN_KEY
  );

  await Promise.all(keys.map((key) => storage.delete(key)));
}

function createRandomSeed(previousSeed?: number): number {
  let seed: number;

  if (globalThis.crypto?.getRandomValues) {
    seed =
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000_000;
  } else {
    seed = Math.floor(Math.random() * 1_000_000_000);
  }

  return seed === previousSeed ? (seed + 1) % 1_000_000_000 : seed;
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
      parsed.type === "reconnect" ||
      parsed.type === "matchEndReport" ||
      parsed.type === "replay"
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}
