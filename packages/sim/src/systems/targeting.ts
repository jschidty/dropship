import { compareHandles } from "@drop-ship/protocol";
import type { UnitWeaponProfile } from "../shipStats";
import type { UnitSpatialIndex } from "../spatialIndex";
import {
  findUnitByHandle,
  type SimUnit,
  type SimWorld,
} from "../world";
import { distanceSquared } from "../movement";

export function findNearestEnemy(
  units: readonly SimUnit[],
  spatialIndex: UnitSpatialIndex | null,
  unit: SimUnit,
  maxRange: number,
  minRange = 0
): SimUnit | null {
  let best: SimUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const minRangeSquared = minRange * minRange;

  const visitCandidate = (
    candidate: SimUnit,
    candidateDistance: number
  ): void => {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      candidate === unit
    ) {
      return;
    }

    if (candidateDistance < minRangeSquared) {
      return;
    }

    if (
      candidateDistance > bestDistance ||
      (candidateDistance === bestDistance &&
        best &&
        compareHandles(candidate.handle, best.handle) >= 0)
    ) {
      return;
    }

    best = candidate;
    bestDistance = candidateDistance;
  };

  if (spatialIndex) {
    spatialIndex.forEachEnemyRadius(
      unit.owner,
      unit.position,
      maxRange,
      visitCandidate
    );
    return best;
  }

  const maxRangeSquared = maxRange * maxRange;

  for (const candidate of units) {
    const candidateDistance = distanceSquared(unit.position, candidate.position);

    if (candidateDistance <= maxRangeSquared) {
      visitCandidate(candidate, candidateDistance);
    }
  }

  return best;
}

export function findWeaponTarget(
  world: SimWorld,
  units: readonly SimUnit[],
  spatialIndex: UnitSpatialIndex | null,
  unit: SimUnit,
  weapon: UnitWeaponProfile
): SimUnit | null {
  const orderedTarget = readOrderedAttackTarget(world, unit);

  if (
    orderedTarget &&
    orderedTarget.owner !== unit.owner &&
    orderedTarget.health.current > 0 &&
    isDistanceInWeaponRange(
      distanceSquared(unit.position, orderedTarget.position),
      weapon
    )
  ) {
    return orderedTarget;
  }

  return findNearestEnemy(
    units,
    spatialIndex,
    unit,
    weapon.range,
    weapon.minRange
  );
}

function isDistanceInWeaponRange(
  distanceSquaredValue: number,
  weapon: UnitWeaponProfile
): boolean {
  return (
    distanceSquaredValue >= weapon.minRange * weapon.minRange &&
    distanceSquaredValue <= weapon.range * weapon.range
  );
}

function readOrderedAttackTarget(world: SimWorld, unit: SimUnit): SimUnit | null {
  const order = unit.moveOrder;

  if (!order) {
    return null;
  }

  if (order.type === "attackTarget" || order.type === "escort") {
    return findUnitByHandle(world, order.target);
  }

  return null;
}
