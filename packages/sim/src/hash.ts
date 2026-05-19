import type { CompactSimSnapshot } from "@drop-ship/protocol";
import { serializeWorld } from "./snapshot";
import type { SimWorld } from "./world";

export function hashWorld(world: SimWorld): string {
  return hashSnapshot(serializeWorld(world));
}

export function hashSnapshot(snapshot: CompactSimSnapshot): string {
  const stable = stableStringify(quantizeSnapshot(snapshot));
  let hash = 2166136261;

  for (let i = 0; i < stable.length; i += 1) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function quantizeSnapshot(snapshot: CompactSimSnapshot): CompactSimSnapshot {
  return {
    ...snapshot,
    units: snapshot.units.map((unit) => ({
      ...unit,
      position: quantizeVec3(unit.position),
      velocity: quantizeVec3(unit.velocity),
      rotation: {
        x: quantize(unit.rotation.x),
        y: quantize(unit.rotation.y),
        z: quantize(unit.rotation.z),
        w: quantize(unit.rotation.w),
      },
      moveOrder: quantizeUnitOrder(unit.moveOrder),
    })),
    planets: snapshot.planets.map((planet) => ({
      ...planet,
      position: quantizeVec3(planet.position),
      mass: quantize(planet.mass),
      radius: quantize(planet.radius),
      orbitAxis: quantizeVec3(planet.orbitAxis),
      orbit: {
        ...planet.orbit,
        center: quantizeVec3(planet.orbit.center),
        radius: quantize(planet.orbit.radius),
        phase: quantize(planet.orbit.phase),
        angularSpeed: quantize(planet.orbit.angularSpeed),
      },
    })),
    environment: {
      ...snapshot.environment,
      sun: {
        ...snapshot.environment.sun,
        position: quantizeVec3(snapshot.environment.sun.position),
        orbitCenter: quantizeVec3(snapshot.environment.sun.orbitCenter),
        distance: quantize(snapshot.environment.sun.distance),
      },
    },
  };
}

function quantizeVec3(vector: { x: number; y: number; z: number }) {
  return {
    x: quantize(vector.x),
    y: quantize(vector.y),
    z: quantize(vector.z),
  };
}

function quantizeUnitOrder<T extends CompactSimSnapshot["units"][number]["moveOrder"]>(
  order: T
): T {
  if (!order || order.type !== "moveTo") {
    return order;
  }

  return {
    ...order,
    target: quantizeVec3(order.target),
  } as T;
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
