import {
  deriveShipStatsFromLoadout,
  type ShipComponentTemplate,
  type ShipStats,
} from "@drop-ship/content";
import type { ShipComponentStatOverride } from "@drop-ship/protocol";
import type { SimUnit, SimWorld } from "./world";

export type UnitWeaponProfile = Readonly<{
  weaponId: number;
  damage: number;
  cooldownTicks: number;
  minRange: number;
  range: number;
}>;

export type UnitWeaponSlotProfile = UnitWeaponProfile &
  Readonly<{
    slotId: string;
  }>;

export function readShipStats(
  world: SimWorld,
  cache: Map<number | string, ShipStats>,
  templateId: number
): ShipStats {
  return readShipStatsForLoadout(world, cache, templateId, null);
}

export function readShipStatsForLoadout(
  world: SimWorld,
  cache: Map<number | string, ShipStats>,
  templateId: number,
  componentsBySlot: Readonly<Record<string, number>> | null
): ShipStats {
  const cacheKey = createShipStatsCacheKey(templateId, componentsBySlot);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const template = world.content.getUnitTemplate(templateId);
  const shouldDeriveStats =
    Boolean(componentsBySlot) ||
    Boolean(world.config.contentOverrides?.shipComponents?.length);
  const stats = shouldDeriveStats
    ? deriveShipStatsFromLoadout(
        template,
        componentsBySlot ?? template.defaultLoadout.componentsBySlot,
        (componentId) => readShipComponent(world, componentId)
      )
    : template.stats;
  cache.set(cacheKey, stats);
  return stats;
}

export function readUnitShipStats(
  world: SimWorld,
  cache: Map<number | string, ShipStats>,
  unit: SimUnit
): ShipStats {
  return readShipStatsForLoadout(
    world,
    cache,
    unit.templateId,
    unit.componentsBySlot
  );
}

export function readUnitWeaponProfile(
  world: SimWorld,
  cache: Map<number | string, UnitWeaponProfile>,
  unit: SimUnit
): UnitWeaponProfile | null {
  const cacheKey = createShipStatsCacheKey(unit.templateId, unit.componentsBySlot);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached.weaponId === 0 ? null : cached;
  }

  let weaponId = 0;
  let damage = 0;
  let cooldownTicks = Number.POSITIVE_INFINITY;
  let minRange = Number.POSITIVE_INFINITY;
  let range = 0;

  for (const weapon of readUnitWeaponSlots(world, new Map(), unit)) {
    weaponId =
      weaponId === 0 ? weapon.weaponId : Math.min(weaponId, weapon.weaponId);
    damage += weapon.damage;
    cooldownTicks = Math.min(cooldownTicks, weapon.cooldownTicks);
    minRange = Math.min(minRange, weapon.minRange);
    range = Math.max(range, weapon.range);
  }

  const profile: UnitWeaponProfile = {
    weaponId,
    damage,
    cooldownTicks: Number.isFinite(cooldownTicks) ? cooldownTicks : 0,
    minRange: Number.isFinite(minRange) ? minRange : 0,
    range,
  };

  cache.set(cacheKey, profile);
  return profile.weaponId === 0 ? null : profile;
}

export function readUnitWeaponSlots(
  world: SimWorld,
  cache: Map<number | string, readonly UnitWeaponSlotProfile[]>,
  unit: SimUnit
): readonly UnitWeaponSlotProfile[] {
  const cacheKey = createShipStatsCacheKey(unit.templateId, unit.componentsBySlot);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const template = world.content.getUnitTemplate(unit.templateId);
  const componentsBySlot =
    unit.componentsBySlot ?? template.defaultLoadout.componentsBySlot;
  const weapons: UnitWeaponSlotProfile[] = [];

  for (const slot of template.slots) {
    const componentId = componentsBySlot[slot.id];

    if (componentId === undefined) {
      continue;
    }

    const component = readShipComponent(world, componentId);

    if (component.type !== "weapon") {
      continue;
    }

    weapons.push({
      slotId: slot.id,
      weaponId: component.id,
      damage: component.damage,
      cooldownTicks: component.cooldownTicks,
      minRange: component.minRange ?? 0,
      range: component.range,
    });
  }

  cache.set(cacheKey, weapons);
  return weapons;
}

function readShipComponent(
  world: SimWorld,
  componentId: number
): ShipComponentTemplate {
  const component = world.content.getShipComponent(componentId);
  const override = world.config.contentOverrides?.shipComponents?.find(
    (entry) => entry.componentId === componentId
  );

  if (!override) {
    return component;
  }

  return applyShipComponentOverride(component, override);
}

export function validateShipComponentOverride(
  component: ShipComponentTemplate,
  override: ShipComponentStatOverride
): void {
  for (const key of [
    "mass",
    "powerDraw",
    "thrust",
    "turnThrust",
    "fuelUsePerSecond",
    "fuelCapacity",
    "cargoCapacity",
    "damage",
    "cooldownTicks",
    "minRange",
    "range",
  ] as const) {
    const value = override[key];

    if (value === undefined) {
      continue;
    }

    if (
      !(key in component) &&
      !(component.type === "weapon" && key === "minRange")
    ) {
      throw new Error(
        `Ship component ${component.slug} cannot override ${key}`
      );
    }

    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `Ship component ${component.slug} override ${key} must be a non-negative finite number`
      );
    }
  }

  if (component.type === "weapon") {
    const minRange = override.minRange ?? component.minRange ?? 0;
    const range = override.range ?? component.range;

    if (minRange > range) {
      throw new Error(
        `Ship component ${component.slug} override minRange must not exceed range`
      );
    }
  }
}

export function applyShipComponentOverride<T extends ShipComponentTemplate>(
  component: T,
  override: ShipComponentStatOverride
): T {
  const merged = { ...component } as Record<string, unknown>;

  validateShipComponentOverride(component, override);

  for (const key of [
    "mass",
    "powerDraw",
    "thrust",
    "turnThrust",
    "fuelUsePerSecond",
    "fuelCapacity",
    "cargoCapacity",
    "damage",
    "cooldownTicks",
    "minRange",
    "range",
  ] as const) {
    const value = override[key];

    if (
      value !== undefined &&
      (key in merged || (component.type === "weapon" && key === "minRange"))
    ) {
      merged[key] = value;
    }
  }

  return merged as T;
}

function createShipStatsCacheKey(
  templateId: number,
  componentsBySlot: Readonly<Record<string, number>> | null
): number | string {
  if (!componentsBySlot) {
    return templateId;
  }

  return `${templateId}:${Object.keys(componentsBySlot)
    .sort()
    .map((slotId) => `${slotId}=${componentsBySlot[slotId]}`)
    .join("|")}`;
}
