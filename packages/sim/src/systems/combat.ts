import {
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "../shipStats";
import { createUnitSpatialIndex, type UnitSpatialIndex } from "../spatialIndex";
import { getUnitsInStableOrder, type SimSystem, type SimUnit } from "../world";
import { findWeaponTarget } from "./targeting";

type ArmedUnit = Readonly<{
  unit: SimUnit;
  weapon: UnitWeaponProfile;
}>;

export const CombatSystem: SimSystem = {
  name: "CombatSystem",
  run(world, tick) {
    const weaponProfiles = new Map<number | string, UnitWeaponProfile>();
    const units = getUnitsInStableOrder(world);
    const armedUnits: ArmedUnit[] = [];
    let maxWeaponRange = 0;

    for (const unit of units) {
      if (unit.weaponCooldownTicks > 0) {
        unit.weaponCooldownTicks -= 1;
      }
    }

    for (const unit of units) {
      if (unit.health.current <= 0 || unit.weaponCooldownTicks > 0) {
        continue;
      }

      const weapon = readUnitWeaponProfile(world, weaponProfiles, unit);

      if (!weapon) {
        continue;
      }

      armedUnits.push({ unit, weapon });
      maxWeaponRange = Math.max(maxWeaponRange, weapon.range);
    }

    const spatialIndex: UnitSpatialIndex | null =
      maxWeaponRange > 0
        ? createUnitSpatialIndex(units, {
            cellSize: maxWeaponRange,
            dimensions: "xz",
          })
        : null;

    for (const { unit, weapon } of armedUnits) {
      if (unit.health.current <= 0 || unit.weaponCooldownTicks > 0) {
        continue;
      }

      const target = findWeaponTarget(world, units, spatialIndex, unit, weapon);

      if (!target) {
        continue;
      }

      const damage = Math.min(target.health.current, weapon.damage);

      target.health.current = Math.max(0, target.health.current - damage);
      unit.weaponCooldownTicks = weapon.cooldownTicks;
      world.events.push({
        type: "weaponFired",
        tick,
        source: unit.handle,
        target: target.handle,
        owner: unit.owner,
        weaponId: weapon.weaponId,
        sourceShipClassId: unit.shipClassId,
        targetShipClassId: target.shipClassId,
        damage,
        start: unit.position,
        end: target.position,
      });

      if (target.health.current <= 0) {
        world.events.push({
          type: "unitDestroyed",
          tick,
          unit: target.handle,
          owner: target.owner,
        });
      }
    }
  },
};
