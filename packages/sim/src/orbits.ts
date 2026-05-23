import {
  PHASE_ONE_SIM_HZ,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  quantizeSimFloat,
} from "./deterministicMath";
import type { SimWorld } from "./world";

export function updatePlanetaryOrbits(world: SimWorld, tick: number): void {
  const elapsedSeconds = tick / PHASE_ONE_SIM_HZ;

  for (let index = 0; index < world.planets.length; index += 1) {
    const planet = world.planets[index];
    const parent =
      planet.parentPlanetIndex === null
        ? null
        : world.planets[planet.parentPlanetIndex] ?? null;
    const center = parent?.position ?? planet.orbit.center;

    planet.position = positionOnOrbit(
      center,
      planet.orbitAxis,
      planet.orbit.radius,
      planet.orbit.phase + planet.orbit.angularSpeed * elapsedSeconds,
      planet.orbit.eccentricity,
      planet.orbit.periapsisAngle
    );
  }
}

function positionOnOrbit(
  center: Vec3Data,
  axis: Vec3Data,
  radius: number,
  phase: number,
  eccentricity = 0,
  periapsisAngle = 0
): Vec3Data {
  const basis = orbitBasis(axis);
  const phaseCos = deterministicCos(phase);
  const phaseSin = deterministicSin(phase);
  const clampedEccentricity = clamp(eccentricity, 0, 0.8);
  const semiMinorRadius =
    radius *
    deterministicSqrt(
      Math.max(1 - clampedEccentricity * clampedEccentricity, 0)
    );
  const apsisCos = deterministicCos(periapsisAngle);
  const apsisSin = deterministicSin(periapsisAngle);
  const majorAxis = {
    x: quantizeSimFloat(basis.tangent.x * apsisCos + basis.bitangent.x * apsisSin),
    y: quantizeSimFloat(basis.tangent.y * apsisCos + basis.bitangent.y * apsisSin),
    z: quantizeSimFloat(basis.tangent.z * apsisCos + basis.bitangent.z * apsisSin),
  };
  const minorAxis = {
    x: quantizeSimFloat(
      -basis.tangent.x * apsisSin + basis.bitangent.x * apsisCos
    ),
    y: quantizeSimFloat(
      -basis.tangent.y * apsisSin + basis.bitangent.y * apsisCos
    ),
    z: quantizeSimFloat(
      -basis.tangent.z * apsisSin + basis.bitangent.z * apsisCos
    ),
  };
  const majorOffset = radius * (phaseCos - clampedEccentricity);
  const minorOffset = semiMinorRadius * phaseSin;

  return {
    x: quantizeSimFloat(
      center.x + majorAxis.x * majorOffset + minorAxis.x * minorOffset
    ),
    y: quantizeSimFloat(
      center.y + majorAxis.y * majorOffset + minorAxis.y * minorOffset
    ),
    z: quantizeSimFloat(
      center.z + majorAxis.z * majorOffset + minorAxis.z * minorOffset
    ),
  };
}

function orbitBasis(axis: Vec3Data): {
  tangent: Vec3Data;
  bitangent: Vec3Data;
} {
  const normal = normalizeVec3(axis);
  const reference =
    Math.abs(normal.y) < 0.82 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const tangent = normalizeVec3(crossVec3(reference, normal));

  return {
    tangent,
    bitangent: normalizeVec3(crossVec3(normal, tangent)),
  };
}

function normalizeVec3(vector: Vec3Data): Vec3Data {
  const length = deterministicSqrt(
    vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
  );

  if (length <= 0.000001) {
    return { x: 0, y: 1, z: 0 };
  }

  return {
    x: quantizeSimFloat(vector.x / length),
    y: quantizeSimFloat(vector.y / length),
    z: quantizeSimFloat(vector.z / length),
  };
}

function crossVec3(a: Vec3Data, b: Vec3Data): Vec3Data {
  return {
    x: quantizeSimFloat(a.y * b.z - a.z * b.y),
    y: quantizeSimFloat(a.z * b.x - a.x * b.z),
    z: quantizeSimFloat(a.x * b.y - a.y * b.x),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
