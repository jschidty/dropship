import { type PlayerId, type Vec3Data } from "@drop-ship/protocol";
import { deterministicFloor } from "./deterministicMath";
import { distanceSquared } from "./movement";
import type { SimUnit } from "./world";

export type UnitSpatialIndex = Readonly<{
  forEachRadius: (
    center: Vec3Data,
    radius: number,
    visitor: (unit: SimUnit, distanceSquared: number) => void
  ) => void;
  forEachOwnerRadius: (
    owner: PlayerId,
    center: Vec3Data,
    radius: number,
    visitor: (unit: SimUnit, distanceSquared: number) => void
  ) => void;
  forEachEnemyRadius: (
    owner: PlayerId,
    center: Vec3Data,
    radius: number,
    visitor: (unit: SimUnit, distanceSquared: number) => void
  ) => void;
}>;

type SpatialCell = {
  x: number;
  y: number;
  z: number;
  units: SimUnit[];
};
type SpatialCells = Map<number, SpatialCell[]>;
type SpatialDimensions = "xyz" | "xz";

const DEFAULT_SPATIAL_INDEX_MIN_UNITS = 48;

export function createUnitSpatialIndex(
  units: readonly SimUnit[],
  options: Readonly<{
    cellSize: number;
    minUnits?: number;
    dimensions?: SpatialDimensions;
  }>
): UnitSpatialIndex {
  const minUnits = options.minUnits ?? DEFAULT_SPATIAL_INDEX_MIN_UNITS;

  if (units.length < minUnits) {
    return createLinearUnitSpatialIndex(units);
  }

  const cellSize = Math.max(options.cellSize, 1);
  const dimensions = options.dimensions ?? "xyz";
  const cells: SpatialCells = new Map();
  const ownerCells = new Map<PlayerId, SpatialCells>();

  for (const unit of units) {
    const cellX = deterministicFloor(unit.position.x / cellSize);
    const cellY =
      dimensions === "xz" ? 0 : deterministicFloor(unit.position.y / cellSize);
    const cellZ = deterministicFloor(unit.position.z / cellSize);
    addUnitToSpatialCells(cells, cellX, cellY, cellZ, unit);

    const ownerCellMap = ownerCells.get(unit.owner) ?? new Map();
    addUnitToSpatialCells(ownerCellMap, cellX, cellY, cellZ, unit);
    ownerCells.set(unit.owner, ownerCellMap);
  }

  return {
    forEachRadius(center, radius, visitor) {
      forEachCellRadius(cells, cellSize, dimensions, center, radius, visitor);
    },
    forEachOwnerRadius(owner, center, radius, visitor) {
      const ownerCellMap = ownerCells.get(owner);

      if (!ownerCellMap) {
        return;
      }

      forEachCellRadius(
        ownerCellMap,
        cellSize,
        dimensions,
        center,
        radius,
        visitor
      );
    },
    forEachEnemyRadius(owner, center, radius, visitor) {
      for (const [candidateOwner, ownerCellMap] of ownerCells) {
        if (candidateOwner === owner) {
          continue;
        }

        forEachCellRadius(
          ownerCellMap,
          cellSize,
          dimensions,
          center,
          radius,
          visitor
        );
      }
    },
  };
}

function createLinearUnitSpatialIndex(
  units: readonly SimUnit[]
): UnitSpatialIndex {
  return {
    forEachRadius(center, radius, visitor) {
      const radiusSquared = radius * radius;

      for (const unit of units) {
        const unitDistanceSquared = distanceSquared(center, unit.position);

        if (unitDistanceSquared <= radiusSquared) {
          visitor(unit, unitDistanceSquared);
        }
      }
    },
    forEachOwnerRadius(owner, center, radius, visitor) {
      const radiusSquared = radius * radius;

      for (const unit of units) {
        const unitDistanceSquared = distanceSquared(center, unit.position);

        if (
          unit.owner === owner &&
          unitDistanceSquared <= radiusSquared
        ) {
          visitor(unit, unitDistanceSquared);
        }
      }
    },
    forEachEnemyRadius(owner, center, radius, visitor) {
      const radiusSquared = radius * radius;

      for (const unit of units) {
        const unitDistanceSquared = distanceSquared(center, unit.position);

        if (
          unit.owner !== owner &&
          unitDistanceSquared <= radiusSquared
        ) {
          visitor(unit, unitDistanceSquared);
        }
      }
    },
  };
}

function addUnitToSpatialCells(
  cells: SpatialCells,
  x: number,
  y: number,
  z: number,
  unit: SimUnit
): void {
  const key = cellHash(x, y, z);
  const bucket = cells.get(key);

  if (!bucket) {
    cells.set(key, [{ x, y, z, units: [unit] }]);
    return;
  }

  const cell = bucket.find(
    (candidate) => candidate.x === x && candidate.y === y && candidate.z === z
  );

  if (cell) {
    cell.units.push(unit);
    return;
  }

  bucket.push({ x, y, z, units: [unit] });
}

function forEachCellRadius(
  cells: SpatialCells,
  cellSize: number,
  dimensions: SpatialDimensions,
  center: Vec3Data,
  radius: number,
  visitor: (unit: SimUnit, distanceSquared: number) => void
): void {
  const radiusSquared = radius * radius;
  const minX = deterministicFloor((center.x - radius) / cellSize);
  const maxX = deterministicFloor((center.x + radius) / cellSize);
  const minY =
    dimensions === "xz" ? 0 : deterministicFloor((center.y - radius) / cellSize);
  const maxY =
    dimensions === "xz" ? 0 : deterministicFloor((center.y + radius) / cellSize);
  const minZ = deterministicFloor((center.z - radius) / cellSize);
  const maxZ = deterministicFloor((center.z + radius) / cellSize);

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const bucket = cells.get(cellHash(x, y, z));

        if (!bucket) {
          continue;
        }

        for (const cell of bucket) {
          if (cell.x !== x || cell.y !== y || cell.z !== z) {
            continue;
          }

          for (const unit of cell.units) {
            const unitDistanceSquared = distanceSquared(center, unit.position);

            if (unitDistanceSquared <= radiusSquared) {
              visitor(unit, unitDistanceSquared);
            }
          }
        }
      }
    }
  }
}

function cellHash(x: number, y: number, z: number): number {
  return (
    Math.imul(x, 73856093) ^
    Math.imul(y, 19349663) ^
    Math.imul(z, 83492791)
  );
}
