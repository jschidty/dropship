import { SHIP_CLASS_IDS, sameHandle } from "@drop-ship/protocol";
import { distanceSquared } from "../movement";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
} from "../world";
import { isPlayerControlledBy } from "../config";
import { readNpcRules } from "./captureRules";
import { findNearestEnemy } from "./targeting";

export const NpcCommandSystem: SimSystem = {
  name: "NpcCommandSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readNpcRules(world);

    if (tick % rules.thinkIntervalTicks !== 0) {
      return;
    }

    for (const unit of getUnitsInStableOrder(world)) {
      if (
        !isPlayerControlledBy(world, unit.owner, "npc") ||
        unit.health.current <= 0
      ) {
        continue;
      }

      const dropShip = findProtectedDropShip(world, unit);

      if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
        const targetPlanet = chooseDropShipTargetPlanet(world, unit);

        if (targetPlanet) {
          unit.moveOrder = {
            type: "capturePlanet",
            planet: targetPlanet.handle,
          };
        }

        continue;
      }

      const dropShipThreat = dropShip
        ? findNearestEnemy(world, dropShip, rules.aggroRangeWorldUnits)
        : null;

      if (dropShipThreat) {
        unit.moveOrder = {
          type: "attackTarget",
          target: dropShipThreat.handle,
        };
        continue;
      }

      if (dropShip && unit.shipClassId === SHIP_CLASS_IDS.fighter) {
        unit.moveOrder = {
          type: "escort",
          target: dropShip.handle,
        };
        continue;
      }

      const target = findNearestEnemy(world, unit, rules.aggroRangeWorldUnits);

      if (target) {
        unit.moveOrder = {
          type: "attackTarget",
          target: target.handle,
        };
        continue;
      }

      const guardPlanet = readDropShipTargetPlanet(world, dropShip);

      if (guardPlanet) {
        unit.moveOrder = {
          type: "guardPlanet",
          planet: guardPlanet.handle,
        };
      }
    }
  },
};

function findProtectedDropShip(world: SimWorld, unit: SimUnit): SimUnit | null {
  if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
    return unit;
  }

  return (
    getUnitsInStableOrder(world).find(
      (candidate) =>
        candidate.owner === unit.owner &&
        candidate.shipClassId === SHIP_CLASS_IDS.dropShip &&
        candidate.health.current > 0
    ) ?? null
  );
}

function chooseDropShipTargetPlanet(
  world: SimWorld,
  dropShip: SimUnit
): SimPlanet | null {
  let best: SimPlanet | null = null;
  let bestScore: PlanetSafetyScore | null = null;

  for (const planet of getPlanetsInStableOrder(world)) {
    if (!planet.control.capturable) {
      continue;
    }

    const score = scorePlanetSafety(world, dropShip, planet);

    if (!bestScore || comparePlanetSafetyScores(score, bestScore) < 0) {
      best = planet;
      bestScore = score;
    }
  }

  return best;
}

type PlanetSafetyScore = Readonly<{
  ownerPriority: number;
  contestedPriority: number;
  enemyDistanceSquared: number;
  dropShipDistanceSquared: number;
}>;

function scorePlanetSafety(
  world: SimWorld,
  dropShip: SimUnit,
  planet: SimPlanet
): PlanetSafetyScore {
  return {
    ownerPriority: planet.control.owner === dropShip.owner ? 1 : 0,
    contestedPriority: isPlanetContestedByEnemy(planet, dropShip) ? 1 : 0,
    enemyDistanceSquared: nearestEnemyDistanceSquared(world, dropShip, planet),
    dropShipDistanceSquared: distanceSquared(dropShip.position, planet.position),
  };
}

function comparePlanetSafetyScores(
  left: PlanetSafetyScore,
  right: PlanetSafetyScore
): number {
  if (left.ownerPriority !== right.ownerPriority) {
    return left.ownerPriority - right.ownerPriority;
  }

  if (left.contestedPriority !== right.contestedPriority) {
    return left.contestedPriority - right.contestedPriority;
  }

  if (left.enemyDistanceSquared !== right.enemyDistanceSquared) {
    return right.enemyDistanceSquared - left.enemyDistanceSquared;
  }

  return left.dropShipDistanceSquared - right.dropShipDistanceSquared;
}

function isPlanetContestedByEnemy(
  planet: SimPlanet,
  dropShip: SimUnit
): boolean {
  return (
    planet.control.contested ||
    (planet.control.capturingPlayer !== 0 &&
      planet.control.capturingPlayer !== dropShip.owner)
  );
}

function nearestEnemyDistanceSquared(
  world: SimWorld,
  unit: SimUnit,
  planet: SimPlanet
): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    nearest = Math.min(
      nearest,
      distanceSquared(candidate.position, planet.position)
    );
  }

  return nearest;
}

function readDropShipTargetPlanet(
  world: SimWorld,
  dropShip: SimUnit | null
): SimPlanet | null {
  if (!dropShip) {
    return (
      getPlanetsInStableOrder(world).find(
        (planet) => planet.control.capturable
      ) ?? null
    );
  }

  const order = dropShip.moveOrder;

  if (
    order &&
    (order.type === "capturePlanet" ||
      order.type === "guardPlanet" ||
      order.type === "orbitPlanet")
  ) {
    const orderedPlanet =
      getPlanetsInStableOrder(world).find((planet) =>
        sameHandle(planet.handle, order.planet)
      ) ?? null;

    if (orderedPlanet) {
      return orderedPlanet;
    }
  }

  return chooseDropShipTargetPlanet(world, dropShip);
}
