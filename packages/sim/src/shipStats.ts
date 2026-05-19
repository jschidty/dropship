import type { ShipStats } from "@drop-ship/content";
import type { SimUnit, SimWorld } from "./world";

export type UnitWeaponProfile = Readonly<{
  weaponId: number;
  damage: number;
  cooldownTicks: number;
  range: number;
}>;

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

export function readUnitWeaponProfile(
  world: SimWorld,
  cache: Map<number, UnitWeaponProfile>,
  unit: SimUnit
): UnitWeaponProfile | null {
  const cached = cache.get(unit.templateId);

  if (cached) {
    return cached.weaponId === 0 ? null : cached;
  }

  const template = world.content.getUnitTemplate(unit.templateId);
  let weaponId = 0;
  let damage = 0;
  let cooldownTicks = Number.POSITIVE_INFINITY;
  let range = 0;

  for (const slot of template.slots) {
    const componentId = template.defaultLoadout.componentsBySlot[slot.id];

    if (componentId === undefined) {
      continue;
    }

    const component = world.content.getShipComponent(componentId);

    if (component.type !== "weapon") {
      continue;
    }

    weaponId = weaponId === 0 ? component.id : Math.min(weaponId, component.id);
    damage += component.damage;
    cooldownTicks = Math.min(cooldownTicks, component.cooldownTicks);
    range = Math.max(range, component.range);
  }

  const profile: UnitWeaponProfile = {
    weaponId,
    damage,
    cooldownTicks: Number.isFinite(cooldownTicks) ? cooldownTicks : 0,
    range,
  };

  cache.set(unit.templateId, profile);
  return profile.weaponId === 0 ? null : profile;
}
