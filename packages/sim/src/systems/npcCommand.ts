import { getPlanetsInStableOrder, getUnitsInStableOrder, type SimSystem } from "../world";
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

    const guardPlanet = getPlanetsInStableOrder(world).find(
      (planet) => planet.control.capturable
    );

    for (const unit of getUnitsInStableOrder(world)) {
      if (
        !isPlayerControlledBy(world, unit.owner, "npc") ||
        unit.health.current <= 0
      ) {
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

      if (guardPlanet) {
        unit.moveOrder = {
          type: "guardPlanet",
          planet: guardPlanet.handle,
        };
      }
    }
  },
};
