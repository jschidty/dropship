import { updateShipOrderIntents } from "../orders/shipOrders";
import type { SimSystem } from "../world";

export const ShipOrderSystem: SimSystem = {
  name: "ShipOrderSystem",
  run(world, tick) {
    updateShipOrderIntents(world, tick);
  },
};
