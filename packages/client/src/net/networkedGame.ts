import {
  DEFAULT_CONTENT_REGISTRY,
  createCaptureDemoConfig,
} from "@drop-ship/content";
import {
  createEmptyCommandBatch,
  type ClientMessage,
  type CommandBatch,
  type CompactSimSnapshot,
  type MatchConfig,
  type PlayerId,
  type ServerMessage,
} from "@drop-ship/protocol";
import {
  createWorld,
  hydrateWorldFromSnapshot,
  runTick,
  serializeWorld,
} from "@drop-ship/sim";
import type { LocalGameRuntime, RuntimeConnectionStatus } from "../types";
import {
  createHashCache,
  createViewModelCache,
  readCachedHash,
  readCachedPlanetViewModels,
  readCachedUnitViewModels,
} from "../runtime/viewModels";

export function createNetworkedGame(options: {
  matchId: string;
  playerId: PlayerId;
  serverUrl?: string;
  seed?: number;
  debugLogs?: boolean;
}): LocalGameRuntime {
  let world = createWorld({
    config: createCaptureDemoConfig({
      matchId: options.matchId,
      seed: options.seed,
    }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const queuedBatches = new Map<number, CommandBatch>();
  const pendingEvents: typeof world.events = [];
  const outbox: string[] = [];
  let socket: WebSocket | null = null;
  let clientSeq = 0;
  let disposed = false;
  let status: RuntimeConnectionStatus = {
    mode: "network",
    state: "connecting",
    playerId: options.playerId,
    matchId: options.matchId,
    running: false,
  };
  const viewModelCache = createViewModelCache();
  const hashCache = createHashCache();
  const debugLog = createNetworkDebugLogger(
    options.debugLogs,
    options.matchId,
    options.playerId
  );
  let loggedMatchResultTick: number | null = null;
  let reportedMatchEndTick: number | null = null;
  let lastConnectionStatusLogKey = "";

  debugLog("connection:init", {
    serverUrl: options.serverUrl ?? "same-origin",
    seed: options.seed ?? null,
    ...summarizeWorld(world),
  });

  const runtime: LocalGameRuntime = {
    playerId: options.playerId,
    get world() {
      return world;
    },
    stepTick() {
      if (world.matchResult) {
        queuedBatches.clear();
        return;
      }

      let processed = 0;

      while (processed < 8 && !world.matchResult) {
        const batch = queuedBatches.get(world.tick);

        if (!batch) {
          break;
        }

        queuedBatches.delete(world.tick);
        runTick(world, batch);
        pendingEvents.push(...world.events);
        processed += 1;
        logMatchResult();

        if (world.tick % 30 === 0) {
          sendClientMessage({
            type: "hash",
            playerId: options.playerId,
            tick: world.tick,
            hash: readCachedHash(world, hashCache),
          });
        }

        if (options.playerId === 1 && world.tick % 600 === 0) {
          debugLog("snapshot:send", {
            tick: world.tick,
            ...summarizeWorld(world),
          });
          sendClientMessage({
            type: "snapshot",
            playerId: options.playerId,
            tick: world.tick,
            snapshot: serializeWorld(world),
          });
        }
      }

      if (world.matchResult) {
        queuedBatches.clear();
      }
    },
    enqueueRandomTurn() {
      if (world.matchResult) {
        return;
      }

      clientSeq += 1;
      sendClientMessage({
        type: "command",
        playerId: options.playerId,
        clientSeq,
        localTick: world.tick,
        command: {
          type: "randomTurnOwnedUnits",
        },
      });
    },
    enqueueMoveUnits(unitHandles, target) {
      if (world.matchResult || unitHandles.length === 0) {
        return;
      }

      clientSeq += 1;
      sendClientMessage({
        type: "command",
        playerId: options.playerId,
        clientSeq,
        localTick: world.tick,
        command: {
          type: "moveUnits",
          unitHandles,
          target,
        },
      });
    },
    enqueueUnitOrder(unitHandles, order) {
      if (world.matchResult || unitHandles.length === 0) {
        return;
      }

      clientSeq += 1;
      sendClientMessage({
        type: "command",
        playerId: options.playerId,
        clientSeq,
        localTick: world.tick,
        command: {
          type: "issueUnitOrder",
          unitHandles,
          order,
          queueMode: "replace",
        },
      });
    },
    readUnits() {
      return readCachedUnitViewModels(world, viewModelCache);
    },
    readPlanets() {
      return readCachedPlanetViewModels(world, viewModelCache);
    },
    drainEvents() {
      return pendingEvents.splice(0);
    },
    readHash() {
      return readCachedHash(world, hashCache);
    },
    readSnapshot() {
      return serializeWorld(world);
    },
    readConnectionStatus() {
      return status;
    },
    dispose() {
      debugLog("connection:dispose", {
        socketState: socket?.readyState ?? null,
        queuedBatches: queuedBatches.size,
        outboxMessages: outbox.length,
        ...summarizeWorld(world),
      });
      disposed = true;
      queuedBatches.clear();
      pendingEvents.splice(0);
      outbox.splice(0);
      socket?.close();
      socket = null;
    },
  };

  connect();
  return runtime;

  function connect(): void {
    const url = createMatchWebSocketUrl(
      options.matchId,
      options.playerId,
      options.serverUrl,
      options.seed
    );
    debugLog("connection:connecting", {
      url,
      ...summarizeWorld(world),
    });
    socket = new WebSocket(url);
    status = {
      ...status,
      state: "connecting",
    };

    socket.addEventListener("open", () => {
      status = {
        ...status,
        state: "open",
        lastError: undefined,
      };
      debugLog("connection:open", {
        outboxMessages: outbox.length,
        ...summarizeWorld(world),
      });
      sendClientMessage({
        type: "ready",
        playerId: options.playerId,
      });
      flushOutbox();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        receiveServerMessage(event.data);
      }
    });
    socket.addEventListener("close", () => {
      debugLog("connection:closed", {
        disposed,
        serverTick: status.serverTick ?? null,
        queuedBatches: queuedBatches.size,
        outboxMessages: outbox.length,
        ...summarizeWorld(world),
      });
      if (!disposed) {
        status = {
          ...status,
          state: "closed",
          running: false,
        };
      }
    });
    socket.addEventListener("error", () => {
      debugLog("connection:error", {
        serverTick: status.serverTick ?? null,
        ...summarizeWorld(world),
      });
      status = {
        ...status,
        state: "error",
        running: false,
        lastError: "WebSocket error",
      };
    });
  }

  function receiveServerMessage(data: string): void {
    const message = JSON.parse(data) as ServerMessage | { type: "error"; code: string };

    if (message.type === "error") {
      debugLog("connection:server-error", {
        code: message.code,
        ...summarizeWorld(world),
      });
      status = {
        ...status,
        state: "error",
        lastError: message.code,
      };
      return;
    }

    if (message.type === "matchStart") {
      debugLog("match:start", {
        serverTick: message.serverTick,
        configMatchId: message.config.matchId,
        gameMode: message.config.gameMode ?? null,
        initialUnits: message.config.initialUnits.length,
        initialPlanets: message.config.initialPlanets.length,
        localTickBefore: world.tick,
      });
      world = createWorld({
        config: message.config as MatchConfig,
        content: DEFAULT_CONTENT_REGISTRY,
      });
      queuedBatches.clear();
      loggedMatchResultTick = null;
      reportedMatchEndTick = null;
      status = {
        ...status,
        playerId: message.playerId,
        serverTick: message.serverTick,
      };

      if (message.serverTick > world.tick) {
        debugLog("reconnect:request", {
          lastTick: world.tick,
          serverTick: message.serverTick,
        });
        sendClientMessage({
          type: "reconnect",
          playerId: options.playerId,
          lastTick: world.tick,
        });
      }
      return;
    }

    if (message.type === "tickCommands") {
      if (!world.matchResult && message.batch.tick >= world.tick) {
        queuedBatches.set(message.batch.tick, message.batch);
      }
      return;
    }

    if (message.type === "commandAck") {
      status = {
        ...status,
        lastAckTick: message.executeTick,
      };
      return;
    }

    if (message.type === "connectionStatus") {
      const statusLogKey = createConnectionStatusLogKey(message);
      if (statusLogKey !== lastConnectionStatusLogKey) {
        debugLog("connection:status", {
          serverTick: message.serverTick,
          running: message.running,
          players: message.players,
        });
        lastConnectionStatusLogKey = statusLogKey;
      }
      status = {
        ...status,
        serverTick: message.serverTick,
        running: message.running,
        players: message.players,
      };
      return;
    }

    if (message.type === "catchup") {
      debugLog("catchup:received", {
        serverTick: message.serverTick,
        snapshotTick: message.snapshotTick,
        snapshot: summarizeSnapshot(message.snapshot),
        commandBatches: message.commands.length,
        commandCount: countCommands(message.commands),
        localTickBefore: world.tick,
      });
      applyCatchup(message);
      return;
    }

    if (message.type === "resyncHard") {
      debugLog("resync:hard", {
        tick: message.tick,
        snapshot: summarizeSnapshot(message.snapshot),
        localTickBefore: world.tick,
      });
      world = hydrateWorldFromSnapshot(message.snapshot, DEFAULT_CONTENT_REGISTRY);
      queuedBatches.clear();
      logMatchResult();
      return;
    }

    if (message.type === "matchEnd") {
      debugLog("match:end", {
        tick: message.tick,
        winner: message.winner,
        finalHash: message.finalHash,
      });
      queuedBatches.clear();
      status = {
        ...status,
        running: false,
        serverTick: message.tick,
      };
    }
  }

  function applyCatchup(message: Extract<ServerMessage, { type: "catchup" }>): void {
    world = message.snapshot
      ? hydrateWorldFromSnapshot(message.snapshot, DEFAULT_CONTENT_REGISTRY)
      : createWorld({
          config: world.config,
          content: DEFAULT_CONTENT_REGISTRY,
        });

    queuedBatches.clear();

    const catchupBatches = new Map(
      message.commands.map((batch) => [batch.tick, batch])
    );
    const replayStartTick = world.tick;
    let replayedTicks = 0;
    let replayedBatches = 0;
    let replayedCommands = 0;

    debugLog("replay:start", {
      fromTick: replayStartTick,
      toTick: message.serverTick,
      snapshotTick: message.snapshotTick,
      commandBatches: message.commands.length,
      commandCount: countCommands(message.commands),
      ...summarizeWorld(world),
    });

    while (world.tick < message.serverTick && !world.matchResult) {
      const batch =
        catchupBatches.get(world.tick) ?? createEmptyCommandBatch(world.tick);

      if (batch.commands.length > 0) {
        replayedBatches += 1;
        replayedCommands += batch.commands.length;
      }

      runTick(world, batch);
      replayedTicks += 1;
      logMatchResult();
    }

    if (world.matchResult) {
      queuedBatches.clear();
    }

    debugLog("replay:done", {
      fromTick: replayStartTick,
      toTick: world.tick,
      targetServerTick: message.serverTick,
      replayedTicks,
      replayedBatches,
      replayedCommands,
      ...summarizeWorld(world),
    });

    status = {
      ...status,
      serverTick: message.serverTick,
    };
  }

  function sendClientMessage(message: ClientMessage): void {
    const encoded = JSON.stringify(message);

    logOutgoingClientMessage(message, socket?.readyState === WebSocket.OPEN);

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encoded);
      return;
    }

    outbox.push(encoded);
  }

  function flushOutbox(): void {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (outbox.length > 0) {
      debugLog("connection:flush-outbox", {
        messages: outbox.length,
      });
    }

    while (outbox.length > 0) {
      socket.send(outbox.shift() ?? "");
    }
  }

  function logOutgoingClientMessage(message: ClientMessage, isOpen: boolean): void {
    if (message.type === "ready") {
      debugLog("connection:ready", {
        isOpen,
      });
      return;
    }

    if (message.type === "reconnect") {
      debugLog("reconnect:send", {
        isOpen,
        lastTick: message.lastTick,
        serverTick: status.serverTick ?? null,
      });
      return;
    }

    if (message.type === "snapshot") {
      debugLog("snapshot:queued", {
        isOpen,
        tick: message.tick,
        snapshot: summarizeSnapshot(message.snapshot),
      });
      return;
    }

    if (message.type === "matchEndReport") {
      debugLog("match:end-report", {
        isOpen,
        tick: message.tick,
        winner: message.winner,
        finalHash: message.finalHash,
      });
    }
  }

  function logMatchResult(): void {
    const result = world.matchResult;

    if (!result || loggedMatchResultTick === result.completedTick) {
      return;
    }

    loggedMatchResultTick = result.completedTick;
    reportMatchEnd(result);
    debugLog("match:result", {
      result,
      ...summarizeWorld(world),
    });
  }

  function reportMatchEnd(result: NonNullable<typeof world.matchResult>): void {
    if (reportedMatchEndTick === result.completedTick) {
      return;
    }

    reportedMatchEndTick = result.completedTick;
    sendClientMessage({
      type: "matchEndReport",
      playerId: options.playerId,
      tick: result.completedTick,
      winner: result.winner,
      finalHash: readCachedHash(world, hashCache),
    });
  }
}

function createMatchWebSocketUrl(
  matchId: string,
  playerId: PlayerId,
  serverUrl?: string,
  seed?: number
): string {
  const base =
    serverUrl ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
      window.location.host
    }`;
  const url = new URL(`/api/matches/${encodeURIComponent(matchId)}/ws`, base);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.searchParams.set("player", playerId.toString());

  if (seed !== undefined) {
    url.searchParams.set("seed", seed.toString());
  }

  return url.toString();
}

type NetworkDebugLogger = (
  event: string,
  payload?: Readonly<Record<string, unknown>>
) => void;

function createNetworkDebugLogger(
  enabled: boolean | undefined,
  matchId: string,
  playerId: PlayerId
): NetworkDebugLogger {
  if (!enabled) {
    return () => {};
  }

  return (event, payload = {}) => {
    console.info("[drop-ship:net]", event, {
      matchId,
      playerId,
      ...payload,
    });
  };
}

function summarizeWorld(world: ReturnType<typeof createWorld>): Record<string, unknown> {
  return {
    tick: world.tick,
    units: world.units.length,
    planets: world.planets.length,
    matchResult: world.matchResult,
  };
}

function summarizeSnapshot(
  snapshot: CompactSimSnapshot | null
): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }

  return {
    tick: snapshot.tick,
    units: snapshot.units.length,
    planets: snapshot.planets.length,
    matchResult: snapshot.matchResult ?? null,
  };
}

function countCommands(batches: readonly CommandBatch[]): number {
  return batches.reduce((total, batch) => total + batch.commands.length, 0);
}

function createConnectionStatusLogKey(
  message: Extract<ServerMessage, { type: "connectionStatus" }>
): string {
  return [
    message.running ? "running" : "paused",
    ...message.players.map(
      (player) => `${player.playerId}:${player.connected ? "1" : "0"}`
    ),
  ].join("|");
}
