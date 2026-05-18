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
      planet.orbit.phase + planet.orbit.angularSpeed * elapsedSeconds
    );
  }
}

function positionOnOrbit(
  center: Vec3Data,
  axis: Vec3Data,
  radius: number,
  phase: number
): Vec3Data {
  const basis = orbitBasis(axis);
  const phaseCos = deterministicCos(phase);
  const phaseSin = deterministicSin(phase);

  return {
    x: quantizeSimFloat(
      center.x +
        (basis.tangent.x * phaseCos + basis.bitangent.x * phaseSin) * radius
    ),
    y: quantizeSimFloat(
      center.y +
        (basis.tangent.y * phaseCos + basis.bitangent.y * phaseSin) * radius
    ),
    z: quantizeSimFloat(
      center.z +
        (basis.tangent.z * phaseCos + basis.bitangent.z * phaseSin) * radius
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
