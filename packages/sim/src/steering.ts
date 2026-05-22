import {
  DEFAULT_SIM_TUNING,
  PHASE_ONE_SIM_HZ,
  type SimAvoidanceTuningConfig,
  type SimBoidsTuningConfig,
  type SimGravityTuningConfig,
  type SimTuningConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import type { ShipStats } from "@drop-ship/content";
import {
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  findPlanetByHandle,
  type SimMutableVec3,
  type SimPlanet,
  type SimUnit,
  type SimWorld,
  yawRotation,
} from "./world";
import { readSimTuning } from "./config";
import {
  deterministicAtan2,
  deterministicSqrt,
  deterministicSquare,
  quantizeSimFloat,
} from "./deterministicMath";
import {
  SIM_EPSILON as EPSILON,
  addNormalizedScaled,
  addScaled,
  clamp,
  computeOrbitVelocityAroundPlanet,
  createZero,
  distanceSquared,
  findNearestPlanet,
  forwardFromRotation,
  lengthSquared,
  limitLength,
  scale,
  unitScalar,
  type MutableVec3,
} from "./movement";
import {
  createUnitSpatialIndex,
  type UnitSpatialIndex,
} from "./spatialIndex";
import {
  readUnitShipStats,
} from "./shipStats";

export const SIM_DT_SECONDS = 1 / PHASE_ONE_SIM_HZ;
export const PLANET_GRAVITY_MAX_STRENGTH =
  DEFAULT_SIM_TUNING.gravity.maxStrength;

export type GravitySource = Readonly<{
  position: Vec3Data;
  mass: number;
  radius: number;
}>;

export function computePlanetGravityVector(
  point: Vec3Data,
  planets: readonly GravitySource[],
  target: MutableVec3 = createZero(),
  gravity: SimGravityTuningConfig = DEFAULT_SIM_TUNING.gravity
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
    const influenceRange = planet.radius * gravity.rangeRadiusMultiplier;

    if (distanceSquaredValue > influenceRange * influenceRange) {
      continue;
    }

    const minimumDistance = Math.max(
      planet.radius * gravity.minDistanceRatio,
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
      (planet.mass * gravity.fieldStrengthScale) / (distance * distance);
    const strength = clamp(
      rawStrength * rangeFalloff,
      0,
      gravity.maxStrength
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
  const tuning = readSimTuning(world);
  const spatialIndex = createUnitSpatialIndex(units, {
    cellSize: tuning.boids.neighborRadiusWorldUnits,
  });
  const nextVelocities = nextUnitVelocityBuffer(world);
  const shipStats = new Map<number | string, ShipStats>();
  const gravityVector = createZero();

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const stats = readUnitShipStats(world, shipStats, unit);
    const desiredVelocity = createZero();
    const orderVelocity = unit.desiredVelocity;

    if (orderVelocity) {
      addScaled(desiredVelocity, orderVelocity, tuning.movement.moveOrderWeight);
    } else {
      addScaled(
        desiredVelocity,
        computeDefaultMotionVelocity(unit, planets, tick, stats, tuning),
        tuning.movement.defaultOrbitWeight
      );
    }

    addScaled(
      desiredVelocity,
      computePlanetGravityVector(
        unit.position,
        planets,
        gravityVector,
        tuning.gravity
      ),
      tuning.gravity.steeringWeight
    );
    addBoidForces(desiredVelocity, unit, spatialIndex, stats, tuning.boids);
    addObjectAvoidance(
      desiredVelocity,
      unit,
      world,
      planets,
      spatialIndex,
      shipStats,
      tuning.avoidance
    );

    const limitedDesired = limitLength(desiredVelocity, stats.maxSpeed);
    writeApproachedVelocity(
      unit.velocity,
      limitedDesired,
      stats.maxAcceleration * SIM_DT_SECONDS,
      readBufferedVelocity(nextVelocities, index)
    );
  }

  for (let index = 0; index < units.length; index += 1) {
    units[index].velocity = nextVelocities[index] ?? units[index].velocity;
  }
}

function nextUnitVelocityBuffer(world: SimWorld): SimMutableVec3[] {
  world.scratch.unitVelocityBufferIndex =
    world.scratch.unitVelocityBufferIndex === 0 ? 1 : 0;
  return world.scratch.unitVelocityBuffers[
    world.scratch.unitVelocityBufferIndex
  ];
}

function readBufferedVelocity(
  buffer: SimMutableVec3[],
  index: number
): SimMutableVec3 {
  const velocity = buffer[index];

  if (velocity) {
    return velocity;
  }

  const nextVelocity = createZero();
  buffer[index] = nextVelocity;
  return nextVelocity;
}

function writeApproachedVelocity(
  current: Vec3Data,
  target: Vec3Data,
  maxDelta: number,
  output: SimMutableVec3
): void {
  const deltaX = target.x - current.x;
  const deltaY = target.y - current.y;
  const deltaZ = target.z - current.z;
  const deltaLength = deterministicSqrt(
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
  );
  const scale =
    deltaLength > maxDelta && deltaLength > EPSILON
      ? maxDelta / deltaLength
      : 1;

  output.x = quantizeSimFloat(current.x + deltaX * scale);
  output.y = quantizeSimFloat(current.y + deltaY * scale);
  output.z = quantizeSimFloat(current.z + deltaZ * scale);
}

export function integrateUnitMotion(world: SimWorld): void {
  const tuning = readSimTuning(world);

  for (const unit of getUnitsInStableOrder(world)) {
    unit.position = {
      x: quantizeSimFloat(unit.position.x + unit.velocity.x * SIM_DT_SECONDS),
      y: quantizeSimFloat(unit.position.y + unit.velocity.y * SIM_DT_SECONDS),
      z: quantizeSimFloat(unit.position.z + unit.velocity.z * SIM_DT_SECONDS),
    };

    const orbitPlanet =
      unit.moveOrder?.type === "orbitPlanet"
        ? findPlanetByHandle(world, unit.moveOrder.planet)
        : null;

    if (orbitPlanet) {
      unit.rotation = yawRotation(
        deterministicAtan2(
          unit.position.x - orbitPlanet.position.x,
          unit.position.z - orbitPlanet.position.z
        )
      );
    } else if (lengthSquared(unit.velocity) > EPSILON) {
      unit.rotation = yawRotation(
        deterministicAtan2(unit.velocity.x, unit.velocity.z)
      );
    }

    if (
      unit.moveOrder?.type === "moveTo" &&
      distanceSquared(unit.position, unit.moveOrder.target) <=
        tuning.movement.arrivalDistanceWorldUnits *
          tuning.movement.arrivalDistanceWorldUnits
    ) {
      unit.moveOrder = null;
    }
  }
}

function computeDefaultMotionVelocity(
  unit: SimUnit,
  planets: readonly SimPlanet[],
  tick: number,
  stats: ShipStats,
  tuning: SimTuningConfig
): Vec3Data {
  const planet = findNearestPlanet(unit, planets);

  if (!planet) {
    return scale(
      forwardFromRotation(unit),
      stats.cruiseSpeed * tuning.movement.defaultForwardSpeedRatio
    );
  }

  return computeOrbitVelocityAroundPlanet(
    unit,
    planet,
    tick,
    stats,
    planet.radius *
      (tuning.orbit.defaultMinRadiusMultiplier +
        unitScalar(unit, 0x9e3779b9) * tuning.orbit.defaultRadiusJitterMultiplier),
    tuning.orbit
  );
}

function addBoidForces(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  spatialIndex: UnitSpatialIndex,
  stats: ShipStats,
  boids: SimBoidsTuningConfig
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
    boids.neighborRadiusWorldUnits,
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

      if (
        distanceSquaredValue <
        boids.separationRadiusWorldUnits * boids.separationRadiusWorldUnits
      ) {
        const distance = deterministicSqrt(distanceSquaredValue);

        if (distance <= EPSILON) {
          return;
        }

        const separationStrength = deterministicSquare(
          (boids.separationRadiusWorldUnits - distance) /
            boids.separationRadiusWorldUnits
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
    stats.cruiseSpeed * boids.alignmentWeight
  );
  addNormalizedScaled(
    desiredVelocity,
    cohesionX / neighborCount - unit.position.x,
    cohesionY / neighborCount - unit.position.y,
    cohesionZ / neighborCount - unit.position.z,
    stats.cruiseSpeed * boids.cohesionWeight
  );
  addScaled(
    desiredVelocity,
    limitLength(
      { x: separationX, y: separationY, z: separationZ },
      1
    ),
    stats.maxSpeed * boids.separationWeight
  );
}

function addObjectAvoidance(
  desiredVelocity: MutableVec3,
  unit: SimUnit,
  world: SimWorld,
  planets: readonly SimPlanet[],
  spatialIndex: UnitSpatialIndex,
  shipStats: Map<number | string, ShipStats>,
  avoidance: SimAvoidanceTuningConfig
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
    const avoidDistance = planet.radius + avoidance.planetMarginWorldUnits;

    if (
      distanceSquaredValue > avoidDistance * avoidDistance ||
      distanceSquaredValue <= EPSILON
    ) {
      continue;
    }

    const distance = deterministicSqrt(distanceSquaredValue);
    const strength =
      deterministicSquare((avoidDistance - distance) / avoidDistance) *
      avoidance.planetWeight;
    const scaledStrength = strength / distance;
    avoidanceX += offsetX * scaledStrength;
    avoidanceY += offsetY * scaledStrength;
    avoidanceZ += offsetZ * scaledStrength;
  }

  const ownStats = readUnitShipStats(world, shipStats, unit);

  spatialIndex.forEachRadius(
    unit.position,
    avoidance.shipRadiusWorldUnits,
    (other) => {
      if (other === unit) {
        return;
      }

      const otherStats = readUnitShipStats(world, shipStats, other);
      const avoidDistance = Math.max(
        avoidance.shipRadiusWorldUnits,
        ownStats.colliderRadius +
          otherStats.colliderRadius +
          avoidance.shipPaddingWorldUnits
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
        avoidance.shipWeight;
      const scaledStrength = strength / distance;
      avoidanceX += offsetX * scaledStrength;
      avoidanceY += offsetY * scaledStrength;
      avoidanceZ += offsetZ * scaledStrength;
    }
  );

  addNormalizedScaled(
    desiredVelocity,
    avoidanceX,
    avoidanceY,
    avoidanceZ,
    ownStats.maxSpeed
  );
}
