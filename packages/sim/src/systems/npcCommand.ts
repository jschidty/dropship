import { getPlanetsInStableOrder, getUnitsInStableOrder, type SimSystem } from "../world";
import { readCaptureDemoRules } from "./captureRules";
import { findNearestEnemy } from "./targeting";

export const NpcCommandSystem: SimSystem = {
  name: "NpcCommandSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);

    if (tick % rules.npcThinkIntervalTicks !== 0) {
      return;
    }

    const guardPlanet = getPlanetsInStableOrder(world).find(
      (planet) => planet.control.capturable
    );

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.owner !== 2 || unit.health.current <= 0) {
        continue;
      }

      const target = findNearestEnemy(world, unit, rules.npcAggroRange);

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
