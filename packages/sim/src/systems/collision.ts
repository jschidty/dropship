import type { ShipStats } from "@drop-ship/content";
import {
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  quantizeSimFloat,
} from "../deterministicMath";
import { distanceSquared } from "../movement";
import { readUnitShipStats } from "../shipStats";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimSystem,
  type SimWorld,
} from "../world";

export const CollisionSystem: SimSystem = {
  name: "CollisionSystem",
  run(world) {
    resolvePlanetCollisions(world);
  },
};

function resolvePlanetCollisions(world: SimWorld): void {
  const shipStats = new Map<number, ShipStats>();

  for (const unit of getUnitsInStableOrder(world)) {
    const stats = readUnitShipStats(world, shipStats, unit);

    for (const planet of getPlanetsInStableOrder(world)) {
      const minimumDistance = planet.radius + stats.colliderRadius + 0.35;
      const distanceSquaredValue = distanceSquared(unit.position, planet.position);

      if (distanceSquaredValue >= minimumDistance * minimumDistance) {
        continue;
      }

      const offsetX = unit.position.x - planet.position.x;
      const offsetY = unit.position.y - planet.position.y;
      const offsetZ = unit.position.z - planet.position.z;
      let normalX: number;
      let normalY: number;
      let normalZ: number;

      if (distanceSquaredValue <= 0.000001) {
        const angle = unit.handle.id * 2.399963229728653;
        normalX = deterministicSin(angle);
        normalY = 0;
        normalZ = deterministicCos(angle);
      } else {
        const distance = deterministicSqrt(distanceSquaredValue);
        normalX = offsetX / distance;
        normalY = offsetY / distance;
        normalZ = offsetZ / distance;
      }

      unit.position = {
        x: quantizeSimFloat(planet.position.x + normalX * minimumDistance),
        y: quantizeSimFloat(planet.position.y + normalY * minimumDistance),
        z: quantizeSimFloat(planet.position.z + normalZ * minimumDistance),
      };

      const inwardSpeed =
        unit.velocity.x * normalX +
        unit.velocity.y * normalY +
        unit.velocity.z * normalZ;

      if (inwardSpeed < 0) {
        unit.velocity = {
          x: quantizeSimFloat(unit.velocity.x - normalX * inwardSpeed),
          y: quantizeSimFloat(unit.velocity.y - normalY * inwardSpeed),
          z: quantizeSimFloat(unit.velocity.z - normalZ * inwardSpeed),
        };
      }
    }
  }
}
