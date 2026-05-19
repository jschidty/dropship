import {
  PHASE_ONE_SIM_HZ,
  type PlayerId,
  type Vec3Data,
} from "@drop-ship/protocol";
import type { ShipStats } from "@drop-ship/content";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  findPlanetByHandle,
  findUnitByHandle,
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
import {
  readShipStats,
  readUnitShipStats,
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "./shipStats";

export const SIM_DT_SECONDS = 1 / PHASE_ONE_SIM_HZ;
export const PLANET_GRAVITY_MAX_STRENGTH = 14;

const MOVE_ORDER_ARRIVAL_DISTANCE = 1.8;
const MOVE_ORDER_SLOW_RADIUS = 24;
const ESCORT_DESIRED_RANGE = 24;
const ESCORT_INNER_RANGE_MULTIPLIER = 0.72;
const ESCORT_OUTER_RANGE_MULTIPLIER = 1.28;
const ESCORT_MATCH_VELOCITY_WEIGHT = 0.82;
const ESCORT_CORRECTION_SPEED_RATIO = 0.34;
const DEFAULT_ORBIT_WEIGHT = 0.95;
const MOVE_ORDER_WEIGHT = 1.35;
const GRAVITY_STEERING_WEIGHT = 1.15;
const PLANET_GRAVITY_FIELD_SCALE = 0.000003;
const PLANET_GRAVITY_RANGE_MULTIPLIER = 9;
const PLANET_GRAVITY_MIN_DISTANCE_RATIO = 0.8;
const BOID_NEIGHBOR_RADIUS = 34;
const BOID_SEPARATION_RADIUS = 8;
const BOID_SEPARATION_RADIUS_SQUARED =
  BOID_SEPARATION_RADIUS * BOID_SEPARATION_RADIUS;
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

export type GravitySource = Readonly<{
  position: Vec3Data;
  mass: number;
  radius: number;
}>;

type UnitSpatialIndex = Readonly<{
  forEachRadius: (
    center: Vec3Data,
    radius: number,
    visitor: (unit: SimUnit) => void
  ) => void;
  forEachOwnerRadius: (
    owner: PlayerId,
    center: Vec3Data,
    radius: number,
    visitor: (unit: SimUnit) => void
  ) => void;
}>;

type SpatialCells = Map<number, Map<number, Map<number, SimUnit[]>>>;

export function computePlanetGravityVector(
  point: Vec3Data,
  planets: readonly GravitySource[],
  target: MutableVec3 = createZero()
): Vec3Data {
  target.x = 0;
  target.y = 0;
  target.z = 0;

  for (const planet of planets) {
    const towardPlanetX = planet.position.x - point.x;
    const towardPlanetY = planet.position.y - point.y;
    const towardPlanetZ = planet.position.z - point.z;
    const distanceSquaredValue =
      towardPlanetX * towardPlanetX +
      towardPlanetY * towardPlanetY +
      towardPlanetZ * towardPlanetZ;
    const influenceRange = planet.radius * PLANET_GRAVITY_RANGE_MULTIPLIER;

    if (distanceSquaredValue > influenceRange * influenceRange) {
      continue;
    }

    const minimumDistance = Math.max(
      planet.radius * PLANET_GRAVITY_MIN_DISTANCE_RATIO,
      1
    );
    const distance = Math.max(
      deterministicSqrt(distanceSquaredValue),
      minimumDistance
    );

    if (distance <= EPSILON) {
      continue;
    }

    const rangeFalloff = clamp(1 - distance / influenceRange, 0, 1);
    const rawStrength =
      (planet.mass * PLANET_GRAVITY_FIELD_SCALE) / (distance * distance);
    const strength = clamp(
      rawStrength * rangeFalloff,
      0,
      PLANET_GRAVITY_MAX_STRENGTH
    );

    if (strength <= EPSILON) {
      continue;
    }

    const scaledStrength = strength / distance;
    target.x += towardPlanetX * scaledStrength;
    target.y += towardPlanetY * scaledStrength;
    target.z += towardPlanetZ * scaledStrength;
  }

  target.x = quantizeSimFloat(target.x);
  target.y = quantizeSimFloat(target.y);
  target.z = quantizeSimFloat(target.z);

  return target;
}

export function steerUnits(world: SimWorld, tick: number): void {
  const units = getUnitsInStableOrder(world);
  const planets = getPlanetsInStableOrder(world);
  const spatialIndex = createUnitSpatialIndex(units);
  const nextVelocities: Vec3Data[] = [];
  const shipStats = new Map<number, ShipStats>();
  const weaponProfiles = new Map<number, UnitWeaponProfile>();
  const gravityVector = createZero();

  for (const unit of units) {
    const stats = readUnitShipStats(world, shipStats, unit);
    const desiredVelocity = createZero();
    const orderVelocity = computeOrderVelocity(
      unit,
      world,
      tick,
      stats,
      readUnitWeaponProfile(world, weaponProfiles, unit)
    );

    if (orderVelocity) {
      addScaled(desiredVelocity, orderVelocity, MOVE_ORDER_WEIGHT);
    } else {
      addScaled(
        desiredVelocity,
        computeDefaultMotionVelocity(unit, planets, tick, stats),
        DEFAULT_ORBIT_WEIGHT
      );
    }

    addScaled(
      desiredVelocity,
      computePlanetGravityVector(unit.position, planets, gravityVector),
      GRAVITY_STEERING_WEIGHT
    );
    addBoidForces(desiredVelocity, unit, spatialIndex, stats);
    addObjectAvoidance(
      desiredVelocity,
      unit,
      world,
      planets,
      spatialIndex,
      shipStats
    );

    const limitedDesired = limitLength(desiredVelocity, stats.maxSpeed);
    nextVelocities.push(
      approachVelocity(
        unit.velocity,
        limitedDesired,
        stats.maxAcceleration * SIM_DT_SECONDS
      )
    );
  }

  for (let index = 0; index < units.length; index += 1) {
    units[index].velocity = nextVelocities[index] ?? units[index].velocity;
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
      unit.moveOrder?.type === "moveTo" &&
      distanceSquared(unit.position, unit.moveOrder.target) <=
        MOVE_ORDER_ARRIVAL_DISTANCE * MOVE_ORDER_ARRIVAL_DISTANCE
    ) {
      unit.moveOrder = null;
    }
  }
}

function computeOrderVelocity(
  unit: SimUnit,
  world: SimWorld,
  tick: number,
  stats: ShipStats,
  weaponProfile: UnitWeaponProfile | null
): Vec3Data | null {
  const order = unit.moveOrder;

  if (!order) {
    return null;
  }

  if (order.type === "attackTarget") {
    const target = findUnitByHandle(world, order.target);

    if (!target || target.health.current <= 0) {
      unit.moveOrder = null;
      return null;
    }

    return computeApproachVelocity(
      unit,
      target.position,
      stats,
      Math.max((weaponProfile?.range ?? 42) * 0.78, 12)
    );
  }

  if (order.type === "capturePlanet" || order.type === "guardPlanet") {
    const planet = findPlanetByHandle(world, order.planet);

    if (!planet) {
      unit.moveOrder = null;
      return null;
    }

    const targetRadius =
      order.type === "capturePlanet" ? planet.radius * 2.25 : planet.radius * 3.05;

    return computeOrbitVelocityAroundPlanet(unit, planet, tick, stats, targetRadius);
  }

  if (order.type === "escort") {
    const target = findUnitByHandle(world, order.target);

    if (!target || target.health.current <= 0) {
      unit.moveOrder = null;
      return null;
    }

    return computeEscortVelocity(unit, target, stats);
  }

  const target = order.target;

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
    stats.cruiseSpeed *
    clamp(distance / MOVE_ORDER_SLOW_RADIUS, 0.35, 1);

  return scale(normalize(offset), speed);
}

function computeApproachVelocity(
  unit: SimUnit,
  target: Vec3Data,
  stats: ShipStats,
  desiredRange: number
): Vec3Data | null {
  const offset = subtract(target, unit.position);
  const distance = length(offset);

  if (distance <= Math.max(desiredRange, MOVE_ORDER_ARRIVAL_DISTANCE)) {
    return scale(normalize(offset), stats.cruiseSpeed * 0.12);
  }

  const remaining = distance - desiredRange;
  const speed =
    stats.cruiseSpeed *
    clamp(remaining / MOVE_ORDER_SLOW_RADIUS, 0.35, 1);

  return scale(normalize(offset), speed);
}

function computeEscortVelocity(
  unit: SimUnit,
  target: SimUnit,
  stats: ShipStats
): Vec3Data | null {
  const offset = subtract(target.position, unit.position);
  const distance = length(offset);
  const desiredRange =
    ESCORT_DESIRED_RANGE + target.health.max / Math.max(unit.health.max, 1);
  const innerRange = desiredRange * ESCORT_INNER_RANGE_MULTIPLIER;
  const outerRange = desiredRange * ESCORT_OUTER_RANGE_MULTIPLIER;
  const velocity = scale(target.velocity, ESCORT_MATCH_VELOCITY_WEIGHT);

  if (distance <= EPSILON) {
    return velocity;
  }

  if (distance > outerRange) {
    addScaled(
      velocity,
      normalize(offset),
      stats.cruiseSpeed *
        clamp((distance - desiredRange) / MOVE_ORDER_SLOW_RADIUS, 0.28, 1)
    );
    return velocity;
  }

  if (distance < innerRange) {
    addScaled(
      velocity,
      normalize(offset),
      -stats.cruiseSpeed * ESCORT_CORRECTION_SPEED_RATIO
    );
  }

  return velocity;
}

function computeDefaultMotionVelocity(
  unit: SimUnit,
  planets: readonly SimPlanet[],
  tick: number,
  stats: ShipStats
): Vec3Data {
  const planet = findNearestPlanet(unit, planets);

  if (!planet) {
    return scale(forwardFromRotation(unit), stats.cruiseSpeed * 0.55);
  }

  return computeOrbitVelocityAroundPlanet(
    unit,
    planet,
    tick,
    stats,
    planet.radius * (2.65 + unitScalar(unit, 0x9e3779b9) * 1.15)
  );
}

function computeOrbitVelocityAroundPlanet(
  unit: SimUnit,
  planet: SimPlanet,
  tick: number,
  stats: ShipStats,
  targetRadius: number
): Vec3Data {
  const x = unit.position.x - planet.position.x;
  const z = unit.position.z - planet.position.z;
  const radius = Math.max(deterministicSqrt(x * x + z * z), 1);
  const radialX = x / radius;
  const radialZ = z / radius;
  const orbitSign = unit.owner === 1 ? 1 : -1;
  const radialError = radius - targetRadius;
  const radialCorrection =
    -clamp(radialError / Math.max(planet.radius, 1), -0.95, 0.95) * 0.58;
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

  return scale(direction, stats.cruiseSpeed * (0.72 + pulse));
}

function addBoidForces(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  spatialIndex: UnitSpatialIndex,
  stats: ShipStats
): void {
  let separationX = 0;
  let separationY = 0;
  let separationZ = 0;
  let alignmentX = 0;
  let alignmentY = 0;
  let alignmentZ = 0;
  let cohesionX = 0;
  let cohesionY = 0;
  let cohesionZ = 0;
  let neighborCount = 0;

  spatialIndex.forEachOwnerRadius(
    unit.owner,
    unit.position,
    BOID_NEIGHBOR_RADIUS,
    (other) => {
      if (other === unit) {
        return;
      }

      const offsetX = other.position.x - unit.position.x;
      const offsetY = other.position.y - unit.position.y;
      const offsetZ = other.position.z - unit.position.z;
      const distanceSquaredValue =
        offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;

      if (distanceSquaredValue <= EPSILON) {
        return;
      }

      neighborCount += 1;
      cohesionX += other.position.x;
      cohesionY += other.position.y;
      cohesionZ += other.position.z;

      const velocitySquared = lengthSquared(other.velocity);

      if (velocitySquared > EPSILON) {
        alignmentX += other.velocity.x;
        alignmentY += other.velocity.y;
        alignmentZ += other.velocity.z;
      }

      if (distanceSquaredValue < BOID_SEPARATION_RADIUS_SQUARED) {
        const distance = deterministicSqrt(distanceSquaredValue);

        if (distance <= EPSILON) {
          return;
        }

        const separationStrength = deterministicSquare(
          (BOID_SEPARATION_RADIUS - distance) / BOID_SEPARATION_RADIUS
        );
        const inverseDistance = 1 / distance;
        separationX -= offsetX * inverseDistance * separationStrength;
        separationY -= offsetY * inverseDistance * separationStrength;
        separationZ -= offsetZ * inverseDistance * separationStrength;
      }
    }
  );

  if (neighborCount === 0) {
    return;
  }

  addNormalizedScaled(
    desiredVelocity,
    alignmentX,
    alignmentY,
    alignmentZ,
    stats.cruiseSpeed * BOID_ALIGNMENT_WEIGHT
  );
  addNormalizedScaled(
    desiredVelocity,
    cohesionX / neighborCount - unit.position.x,
    cohesionY / neighborCount - unit.position.y,
    cohesionZ / neighborCount - unit.position.z,
    stats.cruiseSpeed * BOID_COHESION_WEIGHT
  );
  addNormalizedScaled(
    desiredVelocity,
    separationX,
    separationY,
    separationZ,
    stats.maxSpeed * BOID_SEPARATION_WEIGHT
  );
}

function addObjectAvoidance(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  world: SimWorld,
  planets: readonly SimPlanet[],
  spatialIndex: UnitSpatialIndex,
  shipStats: Map<number, ShipStats>
): void {
  let avoidanceX = 0;
  let avoidanceY = 0;
  let avoidanceZ = 0;

  for (const planet of planets) {
    const offsetX = unit.position.x - planet.position.x;
    const offsetY = unit.position.y - planet.position.y;
    const offsetZ = unit.position.z - planet.position.z;
    const distanceSquaredValue =
      offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
    const avoidDistance = planet.radius + PLANET_AVOIDANCE_MARGIN;

    if (
      distanceSquaredValue > avoidDistance * avoidDistance ||
      distanceSquaredValue <= EPSILON
    ) {
      continue;
    }

    const distance = deterministicSqrt(distanceSquaredValue);
    const strength =
      deterministicSquare((avoidDistance - distance) / avoidDistance) *
      PLANET_AVOIDANCE_WEIGHT;
    const scaledStrength = strength / distance;
    avoidanceX += offsetX * scaledStrength;
    avoidanceY += offsetY * scaledStrength;
    avoidanceZ += offsetZ * scaledStrength;
  }

  const ownStats = readUnitShipStats(world, shipStats, unit);

  spatialIndex.forEachRadius(unit.position, SHIP_AVOIDANCE_RADIUS, (other) => {
    if (other === unit) {
      return;
    }

    const otherStats = readShipStats(
      world,
      shipStats,
      other.templateId
    );
    const avoidDistance = Math.max(
      SHIP_AVOIDANCE_RADIUS,
      ownStats.colliderRadius + otherStats.colliderRadius + 2.4
    );
    const offsetX = unit.position.x - other.position.x;
    const offsetY = unit.position.y - other.position.y;
    const offsetZ = unit.position.z - other.position.z;
    const distanceSquaredValue =
      offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;

    if (
      distanceSquaredValue > avoidDistance * avoidDistance ||
      distanceSquaredValue <= EPSILON
    ) {
      return;
    }

    const distance = deterministicSqrt(distanceSquaredValue);
    const strength =
      deterministicSquare((avoidDistance - distance) / avoidDistance) *
      SHIP_AVOIDANCE_WEIGHT;
    const scaledStrength = strength / distance;
    avoidanceX += offsetX * scaledStrength;
    avoidanceY += offsetY * scaledStrength;
    avoidanceZ += offsetZ * scaledStrength;
  });

  addNormalizedScaled(
    desiredVelocity,
    avoidanceX,
    avoidanceY,
    avoidanceZ,
    ownStats.maxSpeed
  );
}

function createUnitSpatialIndex(units: readonly SimUnit[]): UnitSpatialIndex {
  if (units.length < SPATIAL_INDEX_MIN_UNITS) {
    return {
      forEachRadius(center, radius, visitor) {
        const radiusSquared = radius * radius;

        for (const unit of units) {
          if (distanceSquared(center, unit.position) <= radiusSquared) {
            visitor(unit);
          }
        }
      },
      forEachOwnerRadius(owner, center, radius, visitor) {
        const radiusSquared = radius * radius;

        for (const unit of units) {
          if (
            unit.owner === owner &&
            distanceSquared(center, unit.position) <= radiusSquared
          ) {
            visitor(unit);
          }
        }
      },
    };
  }

  const cellSize = BOID_NEIGHBOR_RADIUS;
  const cells: SpatialCells = new Map();
  const ownerCells = new Map<PlayerId, SpatialCells>();

  for (const unit of units) {
    const cellX = deterministicFloor(unit.position.x / cellSize);
    const cellY = deterministicFloor(unit.position.y / cellSize);
    const cellZ = deterministicFloor(unit.position.z / cellSize);
    addUnitToSpatialCells(cells, cellX, cellY, cellZ, unit);

    const ownerCellMap = ownerCells.get(unit.owner) ?? new Map();
    addUnitToSpatialCells(ownerCellMap, cellX, cellY, cellZ, unit);
    ownerCells.set(unit.owner, ownerCellMap);
  }

  return {
    forEachRadius(center, radius, visitor) {
      forEachCellRadius(cells, cellSize, center, radius, visitor);
    },
    forEachOwnerRadius(owner, center, radius, visitor) {
      const ownerCellMap = ownerCells.get(owner);

      if (!ownerCellMap) {
        return;
      }

      forEachCellRadius(ownerCellMap, cellSize, center, radius, visitor);
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
  let xCells = cells.get(x);

  if (!xCells) {
    xCells = new Map();
    cells.set(x, xCells);
  }

  let yCells = xCells.get(y);

  if (!yCells) {
    yCells = new Map();
    xCells.set(y, yCells);
  }

  const cell = yCells.get(z) ?? [];
  cell.push(unit);
  yCells.set(z, cell);
}

function forEachCellRadius(
  cells: SpatialCells,
  cellSize: number,
  center: Vec3Data,
  radius: number,
  visitor: (unit: SimUnit) => void
): void {
  const radiusSquared = radius * radius;
  const minX = deterministicFloor((center.x - radius) / cellSize);
  const maxX = deterministicFloor((center.x + radius) / cellSize);
  const minY = deterministicFloor((center.y - radius) / cellSize);
  const maxY = deterministicFloor((center.y + radius) / cellSize);
  const minZ = deterministicFloor((center.z - radius) / cellSize);
  const maxZ = deterministicFloor((center.z + radius) / cellSize);

  for (let x = minX; x <= maxX; x += 1) {
    const xCells = cells.get(x);

    if (!xCells) {
      continue;
    }

    for (let y = minY; y <= maxY; y += 1) {
      const yCells = xCells.get(y);

      if (!yCells) {
        continue;
      }

      for (let z = minZ; z <= maxZ; z += 1) {
        const cell = yCells.get(z);

        if (!cell) {
          continue;
        }

        for (const unit of cell) {
          if (distanceSquared(center, unit.position) <= radiusSquared) {
            visitor(unit);
          }
        }
      }
    }
  }
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

function createZero(): MutableVec3 {
  return {
    x: 0,
    y: 0,
    z: 0,
  };
}

function addScaled(target: MutableVec3, vector: Vec3Data, scalar: number): void {
  target.x += vector.x * scalar;
  target.y += vector.y * scalar;
  target.z += vector.z * scalar;
}

function addNormalizedScaled(
  target: MutableVec3,
  x: number,
  y: number,
  z: number,
  scalar: number
): void {
  const vectorLengthSquared = x * x + y * y + z * z;

  if (vectorLengthSquared <= EPSILON) {
    return;
  }

  const scaled = scalar / deterministicSqrt(vectorLengthSquared);
  target.x += x * scaled;
  target.y += y * scaled;
  target.z += z * scaled;
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
