import { createScriptedNpcController } from "@drop-ship/controllers";
import { DEFAULT_CONTENT_REGISTRY } from "@drop-ship/content";
import {
  createEmptyCommandBatch,
  type PlayerId,
  type ScheduledCommand,
} from "@drop-ship/protocol";
import { createWorld, runTick, serializeWorld } from "@drop-ship/sim";
import type { LocalGameRuntime } from "../types";
import { DEFAULT_LOCAL_PLAYER_ID, createLocalMatchConfig } from "./matchConfig";
import {
  createHashCache,
  createViewModelCache,
  readCachedHash,
  readCachedPlanetViewModels,
  readCachedUnitViewModels,
} from "./viewModels";

export function createMinimalLocalGame(
  playerId: PlayerId = DEFAULT_LOCAL_PLAYER_ID,
  options: { seed?: number; stressUnits?: number } = {}
): LocalGameRuntime {
  const config = createLocalMatchConfig(options.seed, options.stressUnits);
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const pendingCommands: ScheduledCommand[] = [];
  const pendingEvents: typeof world.events = [];
  const scriptedNpcController = createScriptedNpcController();
  const viewModelCache = createViewModelCache();
  const hashCache = createHashCache();
  let clientSeq = 0;

  return {
    playerId,
    world,
    stepTick() {
      if (world.matchResult) {
        return;
      }

      const commands = sortScheduledCommands([
        ...pendingCommands.splice(0),
        ...scriptedNpcController.commandsForTick(world),
      ]);
      runTick(
        world,
        commands.length > 0
          ? {
              tick: world.tick,
              commands,
            }
          : createEmptyCommandBatch(world.tick)
      );
      pendingEvents.push(...world.events);
    },
    enqueueRandomTurn() {
      if (world.matchResult) {
        return;
      }

      clientSeq += 1;
      pendingCommands.push({
        playerId,
        clientSeq,
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
      pendingCommands.push({
        playerId,
        clientSeq,
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
      pendingCommands.push({
        playerId,
        clientSeq,
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
      return {
        mode: "local",
        state: "local",
        playerId,
      };
    },
    dispose() {
      pendingCommands.splice(0);
      pendingEvents.splice(0);
      scriptedNpcController.reset?.(world);
    },
  };
}

function sortScheduledCommands(
  commands: readonly ScheduledCommand[]
): readonly ScheduledCommand[] {
  return commands
    .slice()
    .sort((a, b) =>
      a.playerId === b.playerId
        ? a.clientSeq - b.clientSeq
        : a.playerId - b.playerId
    );
}
