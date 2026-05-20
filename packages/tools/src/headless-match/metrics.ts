import type {
  CommandBatch,
  MatchEndReason,
  PlayerId,
  ReplayHash,
} from "@drop-ship/protocol";
import type { SimEvent, SimWorld } from "@drop-ship/sim";

export type HeadlessEventCounts = Readonly<{
  weaponFired: number;
  unitDestroyed: number;
  unitSpawned: number;
  planetCaptured: number;
}>;

export type HeadlessMatchMetrics = Readonly<{
  startedTick: number;
  finishedTick: number;
  ticksElapsed: number;
  completed: boolean;
  winner: PlayerId | 0 | null;
  completedTick: number | null;
  matchEndReason: MatchEndReason | null;
  commandCount: number;
  nonEmptyCommandBatches: number;
  hashesRecorded: number;
  firstPlanetCaptureTick: number | null;
  eventCounts: HeadlessEventCounts;
  finalHash: string;
}>;

export type HeadlessMatchMetricsDraft = {
  startedTick: number;
  commandCount: number;
  nonEmptyCommandBatches: number;
  hashesRecorded: number;
  firstPlanetCaptureTick: number | null;
  eventCounts: {
    weaponFired: number;
    unitDestroyed: number;
    unitSpawned: number;
    planetCaptured: number;
  };
};

export function createHeadlessMatchMetricsDraft(
  world: SimWorld
): HeadlessMatchMetricsDraft {
  return {
    startedTick: world.tick,
    commandCount: 0,
    nonEmptyCommandBatches: 0,
    hashesRecorded: 0,
    firstPlanetCaptureTick: null,
    eventCounts: {
      weaponFired: 0,
      unitDestroyed: 0,
      unitSpawned: 0,
      planetCaptured: 0,
    },
  };
}

export function recordHeadlessMatchStep(
  draft: HeadlessMatchMetricsDraft,
  batch: CommandBatch,
  events: readonly SimEvent[],
  hash: ReplayHash | null
): void {
  draft.commandCount += batch.commands.length;

  if (batch.commands.length > 0) {
    draft.nonEmptyCommandBatches += 1;
  }

  if (hash) {
    draft.hashesRecorded += 1;
  }

  for (const event of events) {
    draft.eventCounts[event.type] += 1;

    if (
      event.type === "planetCaptured" &&
      draft.firstPlanetCaptureTick === null
    ) {
      draft.firstPlanetCaptureTick = event.tick;
    }
  }
}

export function finalizeHeadlessMatchMetrics(
  draft: HeadlessMatchMetricsDraft,
  world: SimWorld,
  finalHash: string
): HeadlessMatchMetrics {
  return {
    startedTick: draft.startedTick,
    finishedTick: world.tick,
    ticksElapsed: world.tick - draft.startedTick,
    completed: world.matchResult !== null,
    winner: world.matchResult?.winner ?? null,
    completedTick: world.matchResult?.completedTick ?? null,
    matchEndReason: world.matchResult?.reason ?? null,
    commandCount: draft.commandCount,
    nonEmptyCommandBatches: draft.nonEmptyCommandBatches,
    hashesRecorded: draft.hashesRecorded,
    firstPlanetCaptureTick: draft.firstPlanetCaptureTick,
    eventCounts: { ...draft.eventCounts },
    finalHash,
  };
}
