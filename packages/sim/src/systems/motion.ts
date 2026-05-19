import { integrateUnitMotion, steerUnits } from "../steering";
import type { SimSystem } from "../world";

export const SteeringSystem: SimSystem = {
  name: "SteeringSystem",
  run(world, tick) {
    steerUnits(world, tick);
  },
};

export const PhysicsSystem: SimSystem = {
  name: "PhysicsSystem",
  run(world) {
    integrateUnitMotion(world);
  },
};
