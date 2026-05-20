import {
  DEFAULT_CONTENT_REGISTRY,
  createCaptureDemoConfig,
} from "@drop-ship/content";
import {
  createEmptyCommandBatch,
  type ClientMessage,
  type CommandBatch,
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

        if (world.tick % 30 === 0) {
          sendClientMessage({
            type: "hash",
            playerId: options.playerId,
            tick: world.tick,
            hash: readCachedHash(world, hashCache),
          });
        }

        if (options.playerId === 1 && world.tick % 600 === 0) {
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
      if (!disposed) {
        status = {
          ...status,
          state: "closed",
          running: false,
        };
      }
    });
    socket.addEventListener("error", () => {
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
      status = {
        ...status,
        state: "error",
        lastError: message.code,
      };
      return;
    }

    if (message.type === "matchStart") {
      world = createWorld({
        config: message.config as MatchConfig,
        content: DEFAULT_CONTENT_REGISTRY,
      });
      queuedBatches.clear();
      status = {
        ...status,
        playerId: message.playerId,
        serverTick: message.serverTick,
      };

      if (message.serverTick > world.tick) {
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
      status = {
        ...status,
        serverTick: message.serverTick,
        running: message.running,
        players: message.players,
      };
      return;
    }

    if (message.type === "catchup") {
      applyCatchup(message);
      return;
    }

    if (message.type === "resyncHard") {
      world = hydrateWorldFromSnapshot(message.snapshot, DEFAULT_CONTENT_REGISTRY);
      queuedBatches.clear();
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

    while (world.tick < message.serverTick && !world.matchResult) {
      runTick(
        world,
        catchupBatches.get(world.tick) ?? createEmptyCommandBatch(world.tick)
      );
    }

    if (world.matchResult) {
      queuedBatches.clear();
    }

    status = {
      ...status,
      serverTick: message.serverTick,
    };
  }

  function sendClientMessage(message: ClientMessage): void {
    const encoded = JSON.stringify(message);

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

    while (outbox.length > 0) {
      socket.send(outbox.shift() ?? "");
    }
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
