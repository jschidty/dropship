import type {
  CommandBatch,
  MatchEndReason,
  PlayerId,
  ReplayHash,
} from "@drop-ship/protocol";
import { SHIP_CLASS_IDS } from "@drop-ship/protocol";
import type { SimEvent, SimWorld } from "@drop-ship/sim";

export type HeadlessEventCounts = Readonly<{
  weaponFired: number;
  unitDestroyed: number;
  unitSpawned: number;
  planetCaptured: number;
}>;

export type HeadlessDamageMetrics = Readonly<{
  total: number;
  byOwner: Readonly<Record<string, number>>;
  bySourceShipClass: Readonly<Record<string, number>>;
  battleship: Readonly<{
    total: number;
    byOwner: Readonly<Record<string, number>>;
  }>;
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
  damageDone: HeadlessDamageMetrics;
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
  damageDone: {
    total: number;
    byOwner: Record<string, number>;
    bySourceShipClass: Record<string, number>;
    battleship: {
      total: number;
      byOwner: Record<string, number>;
    };
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
    damageDone: {
      total: 0,
      byOwner: {},
      bySourceShipClass: {},
      battleship: {
        total: 0,
        byOwner: {},
      },
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

    if (event.type === "weaponFired") {
      recordDamageDone(draft.damageDone, event);
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
    damageDone: cloneDamageMetrics(draft.damageDone),
    finalHash,
  };
}

function recordDamageDone(
  damageDone: HeadlessMatchMetricsDraft["damageDone"],
  event: Extract<SimEvent, { type: "weaponFired" }>
): void {
  damageDone.total += event.damage;
  addDamage(damageDone.byOwner, event.owner, event.damage);
  addDamage(
    damageDone.bySourceShipClass,
    event.sourceShipClassId,
    event.damage
  );

  if (event.sourceShipClassId === SHIP_CLASS_IDS.battleship) {
    damageDone.battleship.total += event.damage;
    addDamage(damageDone.battleship.byOwner, event.owner, event.damage);
  }
}

function addDamage(
  target: Record<string, number>,
  key: number,
  damage: number
): void {
  target[String(key)] = (target[String(key)] ?? 0) + damage;
}

function cloneDamageMetrics(
  damageDone: HeadlessMatchMetricsDraft["damageDone"]
): HeadlessDamageMetrics {
  return {
    total: damageDone.total,
    byOwner: { ...damageDone.byOwner },
    bySourceShipClass: { ...damageDone.bySourceShipClass },
    battleship: {
      total: damageDone.battleship.total,
      byOwner: { ...damageDone.battleship.byOwner },
    },
  };
}
