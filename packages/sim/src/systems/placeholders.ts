import type { SimSystem } from "../world";

export const FleetCommandSystem: SimSystem = {
  name: "FleetCommandSystem",
  run() {
    // Fleet translation is intentionally empty in the two-unit scaffold.
  },
};

export const MiningSystem: SimSystem = {
  name: "MiningSystem",
  run() {
    // Mining is intentionally absent from the minimal game instance.
  },
};

export const ResourceSystem: SimSystem = {
  name: "ResourceSystem",
  run() {
    // Economy state is intentionally absent from the minimal game instance.
  },
};

export const EventFlushSystem: SimSystem = {
  name: "EventFlushSystem",
  run() {
    // Events remain available to presentation until the next sim tick begins.
  },
};
