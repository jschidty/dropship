import { SHIP_CLASS_IDS, type PlayerId } from "@drop-ship/protocol";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimSystem,
  type SimWorld,
} from "../world";
import { readMatchEndRules } from "./captureRules";

export const MatchEndSystem: SimSystem = {
  name: "MatchEndSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo" || world.matchResult) {
      return;
    }

    const playerOneHasDropShip = hasLivingDropShip(world, 1);
    const playerTwoHasDropShip = hasLivingDropShip(world, 2);

    if (!playerOneHasDropShip || !playerTwoHasDropShip) {
      world.matchResult = {
        winner:
          playerOneHasDropShip === playerTwoHasDropShip
            ? 0
            : playerOneHasDropShip
              ? 1
              : 2,
        completedTick: tick,
        reason: "dropShipsLost",
      };
      return;
    }

    const capturablePlanets = getPlanetsInStableOrder(world).filter(
      (planet) => planet.control.capturable
    );
    const owner = capturablePlanets[0]?.control.owner ?? 0;

    if (
      owner !== 0 &&
      capturablePlanets.length > 0 &&
      capturablePlanets.every((planet) => planet.control.owner === owner)
    ) {
      world.matchResult = {
        winner: owner,
        completedTick: tick,
        reason: "allPlanetsCaptured",
      };
      return;
    }

    const rules = readMatchEndRules(world);

    if (tick + 1 >= rules.durationTicks) {
      const playerOnePlanets = countOwnedPlanets(world, 1);
      const playerTwoPlanets = countOwnedPlanets(world, 2);

      if (playerOnePlanets !== playerTwoPlanets) {
        world.matchResult = {
          winner: playerOnePlanets > playerTwoPlanets ? 1 : 2,
          completedTick: tick,
          reason: "timerPlanets",
        };
        return;
      }

      const playerOneUnits = countLivingUnits(world, 1);
      const playerTwoUnits = countLivingUnits(world, 2);

      world.matchResult = {
        winner:
          playerOneUnits === playerTwoUnits
            ? 0
            : playerOneUnits > playerTwoUnits
              ? 1
              : 2,
        completedTick: tick,
        reason: playerOneUnits === playerTwoUnits ? "timerTie" : "timerUnits",
      };
    }
  },
};

function countOwnedPlanets(world: SimWorld, playerId: PlayerId): number {
  return getPlanetsInStableOrder(world).filter(
    (planet) => planet.control.capturable && planet.control.owner === playerId
  ).length;
}

function countLivingUnits(world: SimWorld, playerId: PlayerId): number {
  return getUnitsInStableOrder(world).filter(
    (unit) => unit.owner === playerId && unit.health.current > 0
  ).length;
}

function hasLivingDropShip(world: SimWorld, playerId: PlayerId): boolean {
  return getUnitsInStableOrder(world).some(
    (unit) =>
      unit.owner === playerId &&
      unit.shipClassId === SHIP_CLASS_IDS.dropShip &&
      unit.health.current > 0
  );
}
