import {
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "../shipStats";
import { getUnitsInStableOrder, type SimSystem } from "../world";
import { findWeaponTarget } from "./targeting";

export const CombatSystem: SimSystem = {
  name: "CombatSystem",
  run(world, tick) {
    const weaponProfiles = new Map<number, UnitWeaponProfile>();

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.weaponCooldownTicks > 0) {
        unit.weaponCooldownTicks -= 1;
      }
    }

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.health.current <= 0 || unit.weaponCooldownTicks > 0) {
        continue;
      }

      const weapon = readUnitWeaponProfile(world, weaponProfiles, unit);

      if (!weapon) {
        continue;
      }

      const target = findWeaponTarget(world, unit, weapon);

      if (!target) {
        continue;
      }

      target.health.current = Math.max(0, target.health.current - weapon.damage);
      unit.weaponCooldownTicks = weapon.cooldownTicks;
      world.events.push({
        type: "weaponFired",
        tick,
        source: unit.handle,
        target: target.handle,
        owner: unit.owner,
        weaponId: weapon.weaponId,
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
