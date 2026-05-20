import { sameHandle } from "@drop-ship/protocol";
import type { CaptureRulesConfig } from "@drop-ship/protocol";
import { distanceSquared } from "../movement";
import {
  findPlanetByHandle,
  getUnitsInStableOrder,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
} from "../world";
import { readCaptureRules } from "./captureRules";

export const OrbitTrackingSystem: SimSystem = {
  name: "OrbitTrackingSystem",
  run(world) {
    const rules = readCaptureRules(world);

    for (const unit of getUnitsInStableOrder(world)) {
      updateUnitOrbitState(world, unit, rules);
    }
  },
};

function updateUnitOrbitState(
  world: SimWorld,
  unit: SimUnit,
  rules: CaptureRulesConfig
): void {
  const planet = readOrderedPlanet(world, unit);

  if (
    !planet ||
    unit.health.current <= 0 ||
    !isInsideCaptureOrbitBand(unit, planet, rules)
  ) {
    unit.orbit = {
      isOrbiting: false,
      planet: null,
      orbitTicks: 0,
    };
    return;
  }

  const wasOrbitingSamePlanet =
    unit.orbit.isOrbiting &&
    unit.orbit.planet &&
    sameHandle(unit.orbit.planet, planet.handle);

  unit.orbit = {
    isOrbiting: true,
    planet: planet.handle,
    orbitTicks: wasOrbitingSamePlanet ? unit.orbit.orbitTicks + 1 : 1,
  };
}

function readOrderedPlanet(world: SimWorld, unit: SimUnit): SimPlanet | null {
  const order = unit.moveOrder;

  if (
    !order ||
    (order.type !== "capturePlanet" &&
      order.type !== "guardPlanet" &&
      order.type !== "orbitPlanet")
  ) {
    return null;
  }

  return findPlanetByHandle(world, order.planet);
}

function isInsideCaptureOrbitBand(
  unit: SimUnit,
  planet: SimPlanet,
  rules: CaptureRulesConfig
): boolean {
  const minRadius = planet.radius * rules.orbitMinRadiusMultiplier;
  const maxRadius = planet.radius * rules.orbitMaxRadiusMultiplier;
  const distance = distanceSquared(unit.position, planet.position);

  return distance >= minRadius * minRadius && distance <= maxRadius * maxRadius;
}
