import { PHASE_ONE_SIM_HZ, SHIP_CLASS_IDS, sameHandle } from "@drop-ship/protocol";
import type { CaptureDemoRules } from "@drop-ship/protocol";
import { distanceSquared } from "../movement";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
} from "../world";
import { readCaptureDemoRules } from "./captureRules";

export const CaptureSystem: SimSystem = {
  name: "CaptureSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);
    const requiredTicks = Math.floor(
      rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ
    );

    for (const planet of getPlanetsInStableOrder(world)) {
      if (!planet.control.capturable) {
        continue;
      }

      updatePlanetCapture(world, planet, rules, requiredTicks, tick);
    }
  },
};

function updatePlanetCapture(
  world: SimWorld,
  planet: SimPlanet,
  rules: CaptureDemoRules,
  requiredTicks: number,
  tick: number
): void {
  const eligible = getEligibleDropShips(world, planet, rules);
  const playerOneDropShip = eligible.find((unit) => unit.owner === 1) ?? null;
  const playerTwoDropShip = eligible.find((unit) => unit.owner === 2) ?? null;

  planet.control.contested = Boolean(playerOneDropShip && playerTwoDropShip);

  if (planet.control.contested) {
    return;
  }

  const candidate = playerOneDropShip ?? playerTwoDropShip;

  if (!candidate) {
    handleCaptureBreak(planet, rules);
    return;
  }

  if (planet.control.owner === candidate.owner) {
    resetCaptureProgress(planet);
    return;
  }

  if (
    planet.control.capturingPlayer !== candidate.owner ||
    !planet.control.capturingDropShip ||
    !sameHandle(planet.control.capturingDropShip, candidate.handle)
  ) {
    planet.control.capturingPlayer = candidate.owner;
    planet.control.capturingDropShip = candidate.handle;
    planet.control.captureTicks = 1;
    planet.control.breakTicks = 0;
    return;
  }

  planet.control.captureTicks += 1;
  planet.control.breakTicks = 0;

  if (planet.control.captureTicks > requiredTicks) {
    planet.control.owner = candidate.owner;
    world.events.push({
      type: "planetCaptured",
      tick,
      planet: planet.handle,
      owner: candidate.owner,
    });
    resetCaptureProgress(planet);
  }
}

function getEligibleDropShips(
  world: SimWorld,
  planet: SimPlanet,
  rules: CaptureDemoRules
): readonly SimUnit[] {
  const minRadius = planet.radius * rules.captureOrbitMinRadiusMultiplier;
  const maxRadius = planet.radius * rules.captureOrbitMaxRadiusMultiplier;
  const minRadiusSquared = minRadius * minRadius;
  const maxRadiusSquared = maxRadius * maxRadius;

  return getUnitsInStableOrder(world).filter((unit) => {
    if (
      unit.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      unit.health.current <= 0 ||
      unit.moveOrder?.type !== "capturePlanet" ||
      !sameHandle(unit.moveOrder.planet, planet.handle)
    ) {
      return false;
    }

    const distance = distanceSquared(unit.position, planet.position);
    return distance >= minRadiusSquared && distance <= maxRadiusSquared;
  });
}

function handleCaptureBreak(planet: SimPlanet, rules: CaptureDemoRules): void {
  if (
    planet.control.capturingDropShip &&
    planet.control.breakTicks < rules.captureBreakGraceTicks
  ) {
    planet.control.breakTicks += 1;
    return;
  }

  resetCaptureProgress(planet);
}

function resetCaptureProgress(planet: SimPlanet): void {
  planet.control.capturingPlayer = 0;
  planet.control.capturingDropShip = null;
  planet.control.captureTicks = 0;
  planet.control.contested = false;
  planet.control.breakTicks = 0;
}
