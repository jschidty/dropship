import {
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  TEMPLATE_IDS,
  sameHandle,
  type Vec3Data,
} from "@drop-ship/protocol";
import type { CaptureRulesConfig } from "@drop-ship/protocol";
import { SIM_TAU, deterministicCos, deterministicSin } from "../deterministicMath";
import { distanceSquared } from "../movement";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  spawnUnit,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
} from "../world";
import { readCaptureRules } from "./captureRules";

export const CaptureSystem: SimSystem = {
  name: "CaptureSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureRules(world);
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
  rules: CaptureRulesConfig,
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
    spawnCapturedPlanetDropShip(world, planet, candidate.owner, tick);
    resetCaptureProgress(planet);
  }
}

function getEligibleDropShips(
  world: SimWorld,
  planet: SimPlanet,
  rules: CaptureRulesConfig
): readonly SimUnit[] {
  const minRadius = planet.radius * rules.orbitMinRadiusMultiplier;
  const maxRadius = planet.radius * rules.orbitMaxRadiusMultiplier;
  const minRadiusSquared = minRadius * minRadius;
  const maxRadiusSquared = maxRadius * maxRadius;

  return getUnitsInStableOrder(world).filter((unit) => {
    if (
      unit.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      unit.health.current <= 0 ||
      !unit.orbit.isOrbiting ||
      !unit.orbit.planet ||
      !sameHandle(unit.orbit.planet, planet.handle)
    ) {
      return false;
    }

    const distance = distanceSquared(unit.position, planet.position);
    return distance >= minRadiusSquared && distance <= maxRadiusSquared;
  });
}

function spawnCapturedPlanetDropShip(
  world: SimWorld,
  planet: SimPlanet,
  owner: SimUnit["owner"],
  tick: number
): void {
  const dropShip = spawnUnit(world, {
    owner,
    templateId: TEMPLATE_IDS.dropShip,
    position: computeCapturedDropShipPosition(planet, owner, tick),
    moveOrder: {
      type: "orbitPlanet",
      planet: planet.handle,
    },
    spawnedTick: tick,
  });

  world.events.push({
    type: "unitSpawned",
    tick,
    unit: dropShip.handle,
    owner,
    parent: null,
  });
}

function computeCapturedDropShipPosition(
  planet: SimPlanet,
  owner: SimUnit["owner"],
  tick: number
): Vec3Data {
  const angle =
    ((planet.handle.id * 53 + owner * 97 + tick * 11) % 360) *
    (SIM_TAU / 360);
  const radius = planet.radius * 2.38;

  return {
    x: planet.position.x + deterministicSin(angle) * radius,
    y: planet.position.y + planet.radius * 0.08,
    z: planet.position.z + deterministicCos(angle) * radius,
  };
}

function handleCaptureBreak(planet: SimPlanet, rules: CaptureRulesConfig): void {
  if (
    planet.control.capturingDropShip &&
    planet.control.breakTicks < rules.breakGraceTicks
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
