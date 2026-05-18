import type { ShipStats } from "@drop-ship/content";
import type { SimUnit, SimWorld } from "./world";

export function readShipStats(
  world: SimWorld,
  cache: Map<number, ShipStats>,
  templateId: number
): ShipStats {
  const cached = cache.get(templateId);

  if (cached) {
    return cached;
  }

  const stats = world.content.getUnitTemplate(templateId).stats;
  cache.set(templateId, stats);
  return stats;
}

export function readUnitShipStats(
  world: SimWorld,
  cache: Map<number, ShipStats>,
  unit: SimUnit
): ShipStats {
  return readShipStats(world, cache, unit.templateId);
}
