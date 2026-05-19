import { SHIP_CLASS_IDS, type PlayerId } from "@drop-ship/protocol";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimSystem,
  type SimWorld,
} from "../world";

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
        reason: "dropShipsDestroyed",
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
    }
  },
};

function hasLivingDropShip(world: SimWorld, playerId: PlayerId): boolean {
  return getUnitsInStableOrder(world).some(
    (unit) =>
      unit.owner === playerId &&
      unit.shipClassId === SHIP_CLASS_IDS.dropShip &&
      unit.health.current > 0
  );
}
