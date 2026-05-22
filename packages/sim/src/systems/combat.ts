import {
  readUnitWeaponSlots,
  type UnitWeaponSlotProfile,
} from "../shipStats";
import { createUnitSpatialIndex, type UnitSpatialIndex } from "../spatialIndex";
import { getUnitsInStableOrder, type SimSystem, type SimUnit } from "../world";
import { findWeaponTarget } from "./targeting";

type ArmedWeaponSlot = Readonly<{
  unit: SimUnit;
  weapon: UnitWeaponSlotProfile;
}>;

export const CombatSystem: SimSystem = {
  name: "CombatSystem",
  run(world, tick) {
    const weaponSlotsByLoadout = new Map<
      number | string,
      readonly UnitWeaponSlotProfile[]
    >();
    const units = getUnitsInStableOrder(world);
    const armedWeaponSlots: ArmedWeaponSlot[] = [];
    let maxWeaponRange = 0;

    for (const unit of units) {
      if (unit.weaponCooldownTicks > 0) {
        unit.weaponCooldownTicks -= 1;
      }

      for (const slotId of Object.keys(unit.weaponCooldownTicksBySlot)) {
        const cooldown = unit.weaponCooldownTicksBySlot[slotId] - 1;

        if (cooldown > 0) {
          unit.weaponCooldownTicksBySlot[slotId] = cooldown;
        } else {
          delete unit.weaponCooldownTicksBySlot[slotId];
        }
      }

      if (Object.keys(unit.weaponCooldownTicksBySlot).length > 0) {
        unit.weaponCooldownTicks = Math.max(
          ...Object.values(unit.weaponCooldownTicksBySlot)
        );
      }
    }

    for (const unit of units) {
      if (unit.health.current <= 0) {
        continue;
      }

      const weaponSlots = readUnitWeaponSlots(world, weaponSlotsByLoadout, unit);

      for (const weapon of weaponSlots) {
        if (readWeaponSlotCooldown(unit, weapon.slotId) > 0) {
          continue;
        }

        armedWeaponSlots.push({ unit, weapon });
        maxWeaponRange = Math.max(maxWeaponRange, weapon.range);
      }
    }

    const spatialIndex: UnitSpatialIndex | null =
      maxWeaponRange > 0
        ? createUnitSpatialIndex(units, {
            cellSize: maxWeaponRange,
            dimensions: "xz",
          })
        : null;

    for (const { unit, weapon } of armedWeaponSlots) {
      if (
        unit.health.current <= 0 ||
        readWeaponSlotCooldown(unit, weapon.slotId) > 0
      ) {
        continue;
      }

      const target = findWeaponTarget(world, units, spatialIndex, unit, weapon);

      if (!target) {
        continue;
      }

      const damage = Math.min(target.health.current, weapon.damage);

      target.health.current = Math.max(0, target.health.current - damage);
      setWeaponSlotCooldown(unit, weapon.slotId, weapon.cooldownTicks);
      world.events.push({
        type: "weaponFired",
        tick,
        source: unit.handle,
        target: target.handle,
        owner: unit.owner,
        weaponId: weapon.weaponId,
        weaponSlotId: weapon.slotId,
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

function readWeaponSlotCooldown(unit: SimUnit, slotId: string): number {
  if (
    Object.prototype.hasOwnProperty.call(unit.weaponCooldownTicksBySlot, slotId)
  ) {
    return unit.weaponCooldownTicksBySlot[slotId];
  }

  return Object.keys(unit.weaponCooldownTicksBySlot).length === 0
    ? unit.weaponCooldownTicks
    : 0;
}

function setWeaponSlotCooldown(
  unit: SimUnit,
  slotId: string,
  cooldownTicks: number
): void {
  unit.weaponCooldownTicksBySlot[slotId] = cooldownTicks;
  unit.weaponCooldownTicks = Math.max(
    unit.weaponCooldownTicks,
    ...Object.values(unit.weaponCooldownTicksBySlot)
  );
}
