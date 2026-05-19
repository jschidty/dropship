import { getUnitsInStableOrder, removeUnit, type SimSystem } from "../world";

export const LifecycleSystem: SimSystem = {
  name: "LifecycleSystem",
  run(world) {
    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.health.current <= 0) {
        removeUnit(world, unit);
      }
    }
  },
};
