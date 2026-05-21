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
} from "../movement";
import {
  findPlanetByHandle,
  findUnitByHandle,
  getUnitsInStableOrder,
  promoteQueuedUnitOrder,
  type SimUnit,
  type SimWorld,
} from "../world";
import {
  readUnitShipStats,
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "../shipStats";
import { readSimTuning } from "../config";

export function updateShipOrderIntents(world: SimWorld, tick: number): void {
  const shipStats = new Map<number | string, ShipStats>();
  const weaponProfiles = new Map<number | string, UnitWeaponProfile>();
  const tuning = readSimTuning(world);

  for (const unit of getUnitsInStableOrder(world)) {
    promoteQueuedUnitOrder(unit);

    const stats = readUnitShipStats(world, shipStats, unit);
    unit.desiredVelocity = computeOrderVelocity(
      unit,
      world,
      tick,
      stats,
      readUnitWeaponProfile(world, weaponProfiles, unit),
      tuning
    );
  }
}

function computeOrderVelocity(
  unit: SimUnit,
  world: SimWorld,
  tick: number,
  stats: ShipStats,
  weaponProfile: UnitWeaponProfile | null,
  tuning: ReturnType<typeof readSimTuning>
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
      Math.max((weaponProfile?.range ?? 42) * 0.78, 12),
      tuning.movement
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

    let targetRadius = planet.radius * tuning.orbit.guardRadiusMultiplier;

    if (order.type === "capturePlanet") {
      targetRadius = planet.radius * tuning.orbit.captureRadiusMultiplier;
    } else if (order.type === "orbitPlanet") {
      targetRadius =
        planet.radius *
        (tuning.orbit.activeOrbitBaseMultiplier +
          unitScalar(unit, 0x85ebca6b) *
            tuning.orbit.activeOrbitJitterMultiplier);
    }

    return computeOrbitVelocityAroundPlanet(
      unit,
      planet,
      tick,
      stats,
      targetRadius,
      tuning.orbit
    );
  }

  if (order.type === "escort") {
    const target = findUnitByHandle(world, order.target);

    if (!target || target.health.current <= 0) {
      unit.moveOrder = null;
      return null;
    }

    return computeEscortVelocity(
      unit,
      target,
      stats,
      tuning.movement,
      tuning.escort
    );
  }

  const target = order.target;
  const offset = subtract(target, unit.position);
  const distance = length(offset);

  if (distance <= tuning.movement.arrivalDistanceWorldUnits) {
    unit.moveOrder = null;
    return null;
  }

  const speed =
    stats.cruiseSpeed *
    clamp(
      distance / tuning.movement.slowRadiusWorldUnits,
      tuning.movement.approachMinSpeedRatio,
      1
    );

  return scale(normalize(offset), speed);
}
