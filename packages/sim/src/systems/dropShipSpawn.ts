import { SHIP_CLASS_IDS, TEMPLATE_IDS, type Vec3Data } from "@drop-ship/protocol";
import { SIM_TAU, deterministicCos, deterministicSin } from "../deterministicMath";
import {
  findUnitByHandle,
  getUnitsInStableOrder,
  spawnUnit,
  type SimSystem,
  type SimUnit,
} from "../world";
import { readCaptureDemoRules } from "./captureRules";

export const DropShipSpawnSystem: SimSystem = {
  name: "DropShipSpawnSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);

    for (const dropShip of getUnitsInStableOrder(world)) {
      if (
        dropShip.shipClassId !== SHIP_CLASS_IDS.dropShip ||
        dropShip.health.current <= 0
      ) {
        continue;
      }

      if (!dropShip.fighterSpawn) {
        dropShip.fighterSpawn = {
          nextSpawnTick: tick + rules.fighterSpawnIntervalTicks,
          spawnedFighters: [],
        };
      }

      dropShip.fighterSpawn.spawnedFighters =
        dropShip.fighterSpawn.spawnedFighters.filter(
          (handle) => (findUnitByHandle(world, handle)?.health.current ?? 0) > 0
        );

      if (
        dropShip.fighterSpawn.spawnedFighters.length >=
          rules.fighterSpawnCapPerDropShip ||
        tick < dropShip.fighterSpawn.nextSpawnTick
      ) {
        continue;
      }

      const fighter = spawnUnit(world, {
        owner: dropShip.owner,
        templateId: TEMPLATE_IDS.fighterShip,
        position: computeSpawnPosition(dropShip, tick),
        moveOrder: {
          type: "escort",
          target: dropShip.handle,
        },
        spawnedTick: tick,
      });
      dropShip.fighterSpawn.spawnedFighters.push(fighter.handle);
      dropShip.fighterSpawn.nextSpawnTick =
        tick + rules.fighterSpawnIntervalTicks;
      world.events.push({
        type: "unitSpawned",
        tick,
        unit: fighter.handle,
        owner: fighter.owner,
        parent: dropShip.handle,
      });
    }
  },
};

function computeSpawnPosition(dropShip: SimUnit, tick: number): Vec3Data {
  const angle =
    ((dropShip.handle.id * 97 + tick * 17) % 360) * (SIM_TAU / 360);
  const radius = 7 + (dropShip.handle.id % 5);

  return {
    x: dropShip.position.x + deterministicSin(angle) * radius,
    y: dropShip.position.y + ((dropShip.handle.id % 3) - 1) * 1.5,
    z: dropShip.position.z + deterministicCos(angle) * radius,
  };
}
