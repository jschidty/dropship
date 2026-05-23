import { sameHandle } from "@drop-ship/protocol";
import {
  completeUnitOrder,
  findPlanetByHandle,
  findUnitByHandle,
  getUnitsInStableOrder,
  type SimSystem,
} from "../world";

export const OrderCompletionSystem: SimSystem = {
  name: "OrderCompletionSystem",
  run(world, tick) {
    for (const unit of getUnitsInStableOrder(world)) {
      const order = unit.moveOrder;

      if (!order) {
        continue;
      }

      if (order.type === "attackTarget") {
        const target = findUnitByHandle(world, order.target);

        if (target && target.health.current <= 0) {
          completeUnitOrder(unit, tick, "objectiveMet", "targetDestroyed");
        }

        continue;
      }

      if (order.type === "capturePlanet") {
        const planet = findPlanetByHandle(world, order.planet);

        if (planet?.control.owner === unit.owner) {
          completeUnitOrder(unit, tick, "objectiveMet", "planetCaptured");
          continue;
        }

        const captured = world.events.some(
          (event) =>
            event.type === "planetCaptured" &&
            event.owner === unit.owner &&
            sameHandle(event.planet, order.planet)
        );

        if (captured) {
          completeUnitOrder(unit, tick, "objectiveMet", "planetCaptured");
        }
      }
    }
  },
};
