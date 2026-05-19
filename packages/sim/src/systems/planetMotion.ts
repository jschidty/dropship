import { updatePlanetaryOrbits } from "../orbits";
import type { SimSystem } from "../world";

export const PlanetMotionSystem: SimSystem = {
  name: "PlanetMotionSystem",
  run(world, tick) {
    updatePlanetaryOrbits(world, tick);
  },
};
