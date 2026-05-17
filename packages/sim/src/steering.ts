import {
  PHASE_ONE_SIM_HZ,
  compareHandles,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  type SimPlanet,
  type SimUnit,
  type SimWorld,
  yawRotation,
} from "./world";
import {
  SIM_TAU,
  deterministicAtan2,
  deterministicCos,
  deterministicFloor,
  deterministicSin,
  deterministicSqrt,
  deterministicSquare,
  quantizeSimFloat,
} from "./deterministicMath";

export const SIM_DT_SECONDS = 1 / PHASE_ONE_SIM_HZ;
export const UNIT_CRUISE_SPEED = 22;

const UNIT_MAX_SPEED = 30;
const UNIT_MAX_ACCELERATION = 54;
const MOVE_ORDER_ARRIVAL_DISTANCE = 1.8;
const MOVE_ORDER_SLOW_RADIUS = 24;
const DEFAULT_ORBIT_WEIGHT = 0.95;
const MOVE_ORDER_WEIGHT = 1.35;
const BOID_NEIGHBOR_RADIUS = 34;
const BOID_SEPARATION_RADIUS = 8;
const BOID_ALIGNMENT_WEIGHT = 0.34;
const BOID_COHESION_WEIGHT = 0.22;
const BOID_SEPARATION_WEIGHT = 0.9;
const PLANET_AVOIDANCE_MARGIN = 14;
const PLANET_AVOIDANCE_WEIGHT = 1.9;
const SHIP_AVOIDANCE_RADIUS = 5.5;
const SHIP_AVOIDANCE_WEIGHT = 0.85;
const SPATIAL_INDEX_MIN_UNITS = 48;
const EPSILON = 0.000001;

type MutableVec3 = {
  x: number;
  y: number;
  z: number;
};

type UnitSpatialIndex = Readonly<{
  queryRadius: (center: Vec3Data, radius: number) => readonly SimUnit[];
}>;

export function steerUnits(world: SimWorld, tick: number): void {
  const units = getUnitsInStableOrder(world);
  const planets = getPlanetsInStableOrder(world);
  const spatialIndex = createUnitSpatialIndex(units);
  const nextVelocities = new Map<number, Vec3Data>();

  for (const unit of units) {
    const desiredVelocity = createZero();
    const orderVelocity = computeMoveOrderVelocity(unit);

    if (orderVelocity) {
      addScaled(desiredVelocity, orderVelocity, MOVE_ORDER_WEIGHT);
    } else {
      addScaled(
        desiredVelocity,
        computeDefaultMotionVelocity(unit, planets, tick),
        DEFAULT_ORBIT_WEIGHT
      );
    }

    addBoidForces(desiredVelocity, unit, spatialIndex);
    addObjectAvoidance(desiredVelocity, unit, world, planets, spatialIndex);

    const limitedDesired = limitLength(desiredVelocity, UNIT_MAX_SPEED);
    nextVelocities.set(
      unit.runtimeEntityId,
      approachVelocity(
        unit.velocity,
        limitedDesired,
        UNIT_MAX_ACCELERATION * SIM_DT_SECONDS
      )
    );
  }

  for (const unit of units) {
    unit.velocity = nextVelocities.get(unit.runtimeEntityId) ?? unit.velocity;
  }
}

export function integrateUnitMotion(world: SimWorld): void {
  for (const unit of getUnitsInStableOrder(world)) {
    unit.position = {
      x: quantizeSimFloat(unit.position.x + unit.velocity.x * SIM_DT_SECONDS),
      y: quantizeSimFloat(unit.position.y + unit.velocity.y * SIM_DT_SECONDS),
      z: quantizeSimFloat(unit.position.z + unit.velocity.z * SIM_DT_SECONDS),
    };

    if (lengthSquared(unit.velocity) > EPSILON) {
      unit.rotation = yawRotation(
        deterministicAtan2(unit.velocity.x, unit.velocity.z)
      );
    }

    if (
      unit.moveOrder &&
      distanceSquared(unit.position, unit.moveOrder.target) <=
        MOVE_ORDER_ARRIVAL_DISTANCE * MOVE_ORDER_ARRIVAL_DISTANCE
    ) {
      unit.moveOrder = null;
    }
  }
}

function computeMoveOrderVelocity(unit: SimUnit): Vec3Data | null {
  const target = unit.moveOrder?.target;

  if (!target) {
    return null;
  }

  const offset = subtract(target, unit.position);
  const distance = length(offset);

  if (distance <= MOVE_ORDER_ARRIVAL_DISTANCE) {
    unit.moveOrder = null;
    return null;
  }

  const speed =
    UNIT_CRUISE_SPEED *
    clamp(distance / MOVE_ORDER_SLOW_RADIUS, 0.35, 1);

  return scale(normalize(offset), speed);
}

function computeDefaultMotionVelocity(
  unit: SimUnit,
  planets: readonly SimPlanet[],
  tick: number
): Vec3Data {
  const planet = findNearestPlanet(unit, planets);

  if (!planet) {
    return scale(forwardFromRotation(unit), UNIT_CRUISE_SPEED * 0.55);
  }

  const x = unit.position.x - planet.position.x;
  const z = unit.position.z - planet.position.z;
  const radius = Math.max(deterministicSqrt(x * x + z * z), 1);
  const radialX = x / radius;
  const radialZ = z / radius;
  const orbitSign = unit.owner === 1 ? 1 : -1;
  const targetRadius =
    planet.radius * (2.65 + unitScalar(unit, 0x9e3779b9) * 1.15);
  const radialError = radius - targetRadius;
  const radialCorrection =
    -clamp(radialError / Math.max(planet.radius, 1), -0.8, 0.8) * 0.48;
  const targetY =
    planet.position.y +
    planet.radius * ((unitScalar(unit, 0xc2b2ae35) - 0.5) * 0.28);
  const verticalCorrection = clamp(
    (targetY - unit.position.y) / Math.max(planet.radius * 0.5, 1),
    -0.42,
    0.42
  );
  const pulse =
    deterministicSin(tick * 0.037 + unitScalar(unit, 0x41c64e6d) * SIM_TAU) *
    0.08;
  const direction = normalize({
    x: -radialZ * orbitSign + radialX * radialCorrection,
    y: verticalCorrection + pulse * 0.25,
    z: radialX * orbitSign + radialZ * radialCorrection,
  });

  return scale(direction, UNIT_CRUISE_SPEED * (0.72 + pulse));
}

function addBoidForces(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  spatialIndex: UnitSpatialIndex
): void {
  const separation = createZero();
  const alignment = createZero();
  const cohesion = createZero();
  let neighborCount = 0;

  for (const other of spatialIndex.queryRadius(
    unit.position,
    BOID_NEIGHBOR_RADIUS
  )) {
    if (other === unit || other.owner !== unit.owner) {
      continue;
    }

    const offset = subtract(other.position, unit.position);
    const distance = length(offset);

    if (distance <= EPSILON) {
      continue;
    }

    neighborCount += 1;
    add(cohesion, other.position);

    if (lengthSquared(other.velocity) > EPSILON) {
      add(alignment, normalize(other.velocity));
    }

    if (distance < BOID_SEPARATION_RADIUS) {
      addScaled(
        separation,
        normalize(scale(offset, -1)),
        deterministicSquare(
          (BOID_SEPARATION_RADIUS - distance) / BOID_SEPARATION_RADIUS
        )
      );
    }
  }

  if (neighborCount === 0) {
    return;
  }

  if (lengthSquared(alignment) > EPSILON) {
    addScaled(
      desiredVelocity,
      scale(normalize(alignment), UNIT_CRUISE_SPEED),
      BOID_ALIGNMENT_WEIGHT
    );
  }

  addScaled(
    desiredVelocity,
    scale(
      normalize({
        x: cohesion.x / neighborCount - unit.position.x,
        y: cohesion.y / neighborCount - unit.position.y,
        z: cohesion.z / neighborCount - unit.position.z,
      }),
      UNIT_CRUISE_SPEED
    ),
    BOID_COHESION_WEIGHT
  );

  if (lengthSquared(separation) > EPSILON) {
    addScaled(
      desiredVelocity,
      scale(normalize(separation), UNIT_MAX_SPEED),
      BOID_SEPARATION_WEIGHT
    );
  }
}

function addObjectAvoidance(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  world: SimWorld,
  planets: readonly SimPlanet[],
  spatialIndex: UnitSpatialIndex
): void {
  const avoidance = createZero();

  for (const planet of planets) {
    const offset = subtract(unit.position, planet.position);
    const distance = length(offset);
    const avoidDistance = planet.radius + PLANET_AVOIDANCE_MARGIN;

    if (distance > avoidDistance || distance <= EPSILON) {
      continue;
    }

    addScaled(
      avoidance,
      normalize(offset),
      deterministicSquare((avoidDistance - distance) / avoidDistance) *
        PLANET_AVOIDANCE_WEIGHT
    );
  }

  for (const other of spatialIndex.queryRadius(unit.position, SHIP_AVOIDANCE_RADIUS)) {
    if (other === unit) {
      continue;
    }

    const ownRadius = world.content.getUnitTemplate(unit.templateId).colliderRadius;
    const otherRadius = world.content.getUnitTemplate(other.templateId).colliderRadius;
    const avoidDistance = Math.max(SHIP_AVOIDANCE_RADIUS, ownRadius + otherRadius + 2.4);
    const offset = subtract(unit.position, other.position);
    const distance = length(offset);

    if (distance > avoidDistance || distance <= EPSILON) {
      continue;
    }

    addScaled(
      avoidance,
      normalize(offset),
      deterministicSquare((avoidDistance - distance) / avoidDistance) *
        SHIP_AVOIDANCE_WEIGHT
    );
  }

  if (lengthSquared(avoidance) <= EPSILON) {
    return;
  }

  addScaled(
    desiredVelocity,
    scale(normalize(avoidance), UNIT_MAX_SPEED),
    1
  );
}

function createUnitSpatialIndex(units: readonly SimUnit[]): UnitSpatialIndex {
  if (units.length < SPATIAL_INDEX_MIN_UNITS) {
    return {
      queryRadius(center, radius) {
        const radiusSquared = radius * radius;
        return units.filter(
          (unit) => distanceSquared(center, unit.position) <= radiusSquared
        );
      },
    };
  }

  const cellSize = BOID_NEIGHBOR_RADIUS;
  const cells = new Map<string, SimUnit[]>();

  for (const unit of units) {
    const key = cellKey(unit.position, cellSize);
    const cell = cells.get(key) ?? [];
    cell.push(unit);
    cells.set(key, cell);
  }

  for (const cell of cells.values()) {
    cell.sort((a, b) => compareHandles(a.handle, b.handle));
  }

  return {
    queryRadius(center, radius) {
      const radiusSquared = radius * radius;
      const minX = deterministicFloor((center.x - radius) / cellSize);
      const maxX = deterministicFloor((center.x + radius) / cellSize);
      const minY = deterministicFloor((center.y - radius) / cellSize);
      const maxY = deterministicFloor((center.y + radius) / cellSize);
      const minZ = deterministicFloor((center.z - radius) / cellSize);
      const maxZ = deterministicFloor((center.z + radius) / cellSize);
      const result: SimUnit[] = [];

      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            const cell = cells.get(`${x}:${y}:${z}`);

            if (!cell) {
              continue;
            }

            for (const unit of cell) {
              if (distanceSquared(center, unit.position) <= radiusSquared) {
                result.push(unit);
              }
            }
          }
        }
      }

      return result.sort((a, b) => compareHandles(a.handle, b.handle));
    },
  };
}

function findNearestPlanet(
  unit: SimUnit,
  planets: readonly SimPlanet[]
): SimPlanet | null {
  let nearest: SimPlanet | null = null;
  let nearestDistance = Infinity;

  for (const planet of planets) {
    const distance = distanceSquared(unit.position, planet.position);

    if (distance < nearestDistance) {
      nearest = planet;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function approachVelocity(
  current: Vec3Data,
  target: Vec3Data,
  maxDelta: number
): Vec3Data {
  const delta = {
    x: target.x - current.x,
    y: target.y - current.y,
    z: target.z - current.z,
  };
  const limitedDelta = limitLength(delta, maxDelta);

  return {
    x: quantizeSimFloat(current.x + limitedDelta.x),
    y: quantizeSimFloat(current.y + limitedDelta.y),
    z: quantizeSimFloat(current.z + limitedDelta.z),
  };
}

function forwardFromRotation(unit: SimUnit): Vec3Data {
  const yaw = deterministicAtan2(
    2 * (unit.rotation.w * unit.rotation.y),
    1 - 2 * unit.rotation.y * unit.rotation.y
  );

  return {
    x: deterministicSin(yaw),
    y: 0,
    z: deterministicCos(yaw),
  };
}

function cellKey(position: Vec3Data, cellSize: number): string {
  return `${deterministicFloor(position.x / cellSize)}:${deterministicFloor(
    position.y / cellSize
  )}:${deterministicFloor(position.z / cellSize)}`;
}

function createZero(): MutableVec3 {
  return {
    x: 0,
    y: 0,
    z: 0,
  };
}

function add(target: MutableVec3, vector: Vec3Data): void {
  target.x += vector.x;
  target.y += vector.y;
  target.z += vector.z;
}

function addScaled(target: MutableVec3, vector: Vec3Data, scalar: number): void {
  target.x += vector.x * scalar;
  target.y += vector.y * scalar;
  target.z += vector.z * scalar;
}

function subtract(a: Vec3Data, b: Vec3Data): Vec3Data {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scale(vector: Vec3Data, scalar: number): Vec3Data {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalize(vector: Vec3Data): Vec3Data {
  const vectorLength = length(vector);

  if (vectorLength <= EPSILON) {
    return createZero();
  }

  return scale(vector, 1 / vectorLength);
}

function limitLength(vector: Vec3Data, maxLength: number): Vec3Data {
  const vectorLength = length(vector);

  if (vectorLength <= maxLength || vectorLength <= EPSILON) {
    return {
      x: vector.x,
      y: vector.y,
      z: vector.z,
    };
  }

  return scale(vector, maxLength / vectorLength);
}

function length(vector: Vec3Data): number {
  return deterministicSqrt(lengthSquared(vector));
}

function lengthSquared(vector: Vec3Data): number {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;
}

function distanceSquared(a: Vec3Data, b: Vec3Data): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unitScalar(unit: SimUnit, salt: number): number {
  let value =
    (Math.imul(unit.handle.id, 374761393) ^
      Math.imul(unit.owner, 668265263) ^
      salt) >>>
    0;
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}
