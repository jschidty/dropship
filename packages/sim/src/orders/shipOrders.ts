import type { ShipStats } from "@drop-ship/content";
import type { Vec3Data } from "@drop-ship/protocol";
import {
  computeApproachVelocity,
  computeEscortVelocity,
  computeOrbitVelocityAroundPlanet,
  length,
  normalize,
  scale,
  subtract,
  clamp,
  unitScalar,
  MOVE_ORDER_ARRIVAL_DISTANCE,
  MOVE_ORDER_SLOW_RADIUS,
} from "../movement";
import {
  findPlanetByHandle,
  findUnitByHandle,
  getUnitsInStableOrder,
  type SimUnit,
  type SimWorld,
} from "../world";
import {
  readUnitShipStats,
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "../shipStats";

export function updateShipOrderIntents(world: SimWorld, tick: number): void {
  const shipStats = new Map<number, ShipStats>();
  const weaponProfiles = new Map<number, UnitWeaponProfile>();

  for (const unit of getUnitsInStableOrder(world)) {
    const stats = readUnitShipStats(world, shipStats, unit);
    unit.desiredVelocity = computeOrderVelocity(
      unit,
      world,
      tick,
      stats,
      readUnitWeaponProfile(world, weaponProfiles, unit)
    );
  }
}

function computeOrderVelocity(
  unit: SimUnit,
  world: SimWorld,
  tick: number,
  stats: ShipStats,
  weaponProfile: UnitWeaponProfile | null
): Vec3Data | null {
  const order = unit.moveOrder;

  if (!order) {
    return null;
  }

  if (order.type === "attackTarget") {
    const target = findUnitByHandle(world, order.target);

    if (!target || target.health.current <= 0) {
      unit.moveOrder = null;
      return null;
    }

    return computeApproachVelocity(
      unit,
      target.position,
      stats,
      Math.max((weaponProfile?.range ?? 42) * 0.78, 12)
    );
  }

  if (
    order.type === "capturePlanet" ||
    order.type === "guardPlanet" ||
    order.type === "orbitPlanet"
  ) {
    const planet = findPlanetByHandle(world, order.planet);

    if (!planet) {
      unit.moveOrder = null;
      return null;
    }

    let targetRadius = planet.radius * 3.05;

    if (order.type === "capturePlanet") {
      targetRadius = planet.radius * 2.25;
    } else if (order.type === "orbitPlanet") {
      targetRadius =
        planet.radius * (2.62 + unitScalar(unit, 0x85ebca6b) * 0.32);
    }

    return computeOrbitVelocityAroundPlanet(
      unit,
      planet,
      tick,
      stats,
      targetRadius
    );
  }

  if (order.type === "escort") {
    const target = findUnitByHandle(world, order.target);

    if (!target || target.health.current <= 0) {
      unit.moveOrder = null;
      return null;
    }

    return computeEscortVelocity(unit, target, stats);
  }

  const target = order.target;
  const offset = subtract(target, unit.position);
  const distance = length(offset);

  if (distance <= MOVE_ORDER_ARRIVAL_DISTANCE) {
    unit.moveOrder = null;
    return null;
  }

  const speed =
    stats.cruiseSpeed * clamp(distance / MOVE_ORDER_SLOW_RADIUS, 0.35, 1);

  return scale(normalize(offset), speed);
}
