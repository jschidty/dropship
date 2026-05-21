import type { UnitWeaponProfile } from "../shipStats";
import {
  findUnitByHandle,
  type SimUnit,
  type SimWorld,
} from "../world";
import { distanceSquared } from "../movement";
import { sameHandle } from "@drop-ship/protocol";

export function findNearestEnemy(
  units: readonly SimUnit[],
  unit: SimUnit,
  maxRange: number
): SimUnit | null {
  const maxRangeSquared = maxRange * maxRange;
  let best: SimUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of units) {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    const distance = distanceSquared(unit.position, candidate.position);

    if (distance > maxRangeSquared || distance >= bestDistance) {
      continue;
    }

    best = candidate;
    bestDistance = distance;
  }

  return best;
}

export function findWeaponTarget(
  world: SimWorld,
  units: readonly SimUnit[],
  unit: SimUnit,
  weapon: UnitWeaponProfile
): SimUnit | null {
  const orderedTarget = readOrderedAttackTarget(world, unit);

  if (
    orderedTarget &&
    orderedTarget.owner !== unit.owner &&
    orderedTarget.health.current > 0 &&
    distanceSquared(unit.position, orderedTarget.position) <=
      weapon.range * weapon.range
  ) {
    return orderedTarget;
  }

  return findNearestEnemy(units, unit, weapon.range);
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
