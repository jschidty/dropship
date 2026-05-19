import type { ShipStats } from "@drop-ship/content";
import type { Vec3Data } from "@drop-ship/protocol";
import {
  SIM_TAU,
  deterministicAtan2,
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  quantizeSimFloat,
} from "./deterministicMath";
import type { SimPlanet, SimUnit } from "./world";

export const SIM_EPSILON = 0.000001;
export const MOVE_ORDER_ARRIVAL_DISTANCE = 1.8;
export const MOVE_ORDER_SLOW_RADIUS = 24;

const ESCORT_DESIRED_RANGE = 24;
const ESCORT_INNER_RANGE_MULTIPLIER = 0.72;
const ESCORT_OUTER_RANGE_MULTIPLIER = 1.28;
const ESCORT_MATCH_VELOCITY_WEIGHT = 0.82;
const ESCORT_CORRECTION_SPEED_RATIO = 0.34;

export type MutableVec3 = {
  x: number;
  y: number;
  z: number;
};

export function computeApproachVelocity(
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

export function computeEscortVelocity(
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

  if (distance <= SIM_EPSILON) {
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

export function computeOrbitVelocityAroundPlanet(
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

export function findNearestPlanet(
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

export function approachVelocity(
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

export function forwardFromRotation(unit: SimUnit): Vec3Data {
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

export function createZero(): MutableVec3 {
  return {
    x: 0,
    y: 0,
    z: 0,
  };
}

export function addScaled(
  target: MutableVec3,
  vector: Vec3Data,
  scalar: number
): void {
  target.x += vector.x * scalar;
  target.y += vector.y * scalar;
  target.z += vector.z * scalar;
}

export function addNormalizedScaled(
  target: MutableVec3,
  x: number,
  y: number,
  z: number,
  scalar: number
): void {
  const vectorLengthSquared = x * x + y * y + z * z;

  if (vectorLengthSquared <= SIM_EPSILON) {
    return;
  }

  const scaled = scalar / deterministicSqrt(vectorLengthSquared);
  target.x += x * scaled;
  target.y += y * scaled;
  target.z += z * scaled;
}

export function subtract(a: Vec3Data, b: Vec3Data): Vec3Data {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

export function scale(vector: Vec3Data, scalar: number): Vec3Data {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

export function normalize(vector: Vec3Data): Vec3Data {
  const vectorLength = length(vector);

  if (vectorLength <= SIM_EPSILON) {
    return createZero();
  }

  return scale(vector, 1 / vectorLength);
}

export function limitLength(vector: Vec3Data, maxLength: number): Vec3Data {
  const vectorLength = length(vector);

  if (vectorLength <= maxLength || vectorLength <= SIM_EPSILON) {
    return {
      x: vector.x,
      y: vector.y,
      z: vector.z,
    };
  }

  return scale(vector, maxLength / vectorLength);
}

export function length(vector: Vec3Data): number {
  return deterministicSqrt(lengthSquared(vector));
}

export function lengthSquared(vector: Vec3Data): number {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;
}

export function distanceSquared(a: Vec3Data, b: Vec3Data): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function unitScalar(unit: SimUnit, salt: number): number {
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
