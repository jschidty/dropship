import type { CompactSimSnapshot } from "@drop-ship/protocol";
import { serializeWorld } from "./snapshot";
import type { SimWorld } from "./world";

export function hashWorld(world: SimWorld): string {
  return hashSnapshot(serializeWorld(world));
}

export function hashSnapshot(snapshot: CompactSimSnapshot): string {
  const hasher = createFnvHasher();
  hashCompactSnapshot(hasher, snapshot);
  return (hasher.value >>> 0).toString(16).padStart(8, "0");
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

type FnvHasher = {
  value: number;
};

function createFnvHasher(): FnvHasher {
  return {
    value: 2166136261,
  };
}

function hashString(hasher: FnvHasher, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    hasher.value ^= value.charCodeAt(index);
    hasher.value = Math.imul(hasher.value, 16777619);
  }
}

type HashObjectState = {
  wroteField: boolean;
};

type HashValueWriter = (hasher: FnvHasher, value: unknown) => void;

function hashCompactSnapshot(
  hasher: FnvHasher,
  snapshot: CompactSimSnapshot
): void {
  hashKnownObject(hasher, snapshot as Record<string, unknown>, [
    ["captureDemoRules"],
    ["commandLeadTicks"],
    ["contentHash"],
    ["contentOverrides"],
    ["contentVersion"],
    ["controllers"],
    ["environment", hashEnvironment],
    ["gameMode"],
    ["matchId"],
    ["matchResult"],
    ["nextEntityId"],
    ["planets", hashPlanets],
    ["players"],
    ["prng"],
    ["protocolVersion"],
    ["rules"],
    ["seed"],
    ["tick"],
    ["tuning"],
    ["units", hashUnits],
    ["version"],
  ]);
}

function hashUnits(hasher: FnvHasher, value: unknown): void {
  hashArray(hasher, value as readonly unknown[], hashUnit);
}

function hashUnit(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["componentsBySlot"],
    ["fighterSpawn", hashFighterSpawn],
    ["handle", hashEntityHandle],
    ["health", hashHealth],
    ["lastOrderEnd", hashUnitOrderEnd],
    ["lastPlayerOrderEnd", hashUnitOrderEnd],
    ["lastPlayerOrderTick"],
    ["moveOrder", hashUnitOrder],
    ["orbit", hashOrbitState],
    ["orderIssuedTick"],
    ["orderQueue", hashUnitOrders],
    ["orderQueueMetadata"],
    ["orderSource"],
    ["owner"],
    ["position", hashQuantizedVec3],
    ["render", hashRender],
    ["rotation", hashQuantizedQuaternion],
    ["shipClassId"],
    ["spawnedTick"],
    ["templateId"],
    ["velocity", hashQuantizedVec3],
    ["weaponCooldownTicks"],
    ["weaponCooldownTicksBySlot"],
  ]);
}

function hashPlanets(hasher: FnvHasher, value: unknown): void {
  hashArray(hasher, value as readonly unknown[], hashPlanet);
}

function hashPlanet(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["appearance", hashAppearance],
    ["color"],
    ["control"],
    ["handle", hashEntityHandle],
    ["hasAtmosphere"],
    ["mass", hashQuantizedNumber],
    ["name"],
    ["orbit", hashPlanetOrbit],
    ["orbitAxis", hashQuantizedVec3],
    ["parentPlanetIndex"],
    ["position", hashQuantizedVec3],
    ["radius", hashQuantizedNumber],
    ["render", hashRender],
    ["spawnedTick"],
    ["templateId"],
  ]);
}

function hashEnvironment(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["sun", hashSun],
  ]);
}

function hashSun(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["color"],
    ["distance", hashQuantizedNumber],
    ["orbitCenter", hashQuantizedVec3],
    ["position", hashQuantizedVec3],
  ]);
}

function hashFighterSpawn(hasher: FnvHasher, value: unknown): void {
  if (!value) {
    hashStableValue(hasher, value);
    return;
  }

  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["nextSpawnTick"],
    ["spawnedFighters"],
  ]);
}

function hashUnitOrders(hasher: FnvHasher, value: unknown): void {
  hashArray(hasher, value as readonly unknown[], hashUnitOrder);
}

function hashUnitOrderEnd(hasher: FnvHasher, value: unknown): void {
  if (!value) {
    hashStableValue(hasher, value);
    return;
  }

  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["endedTick"],
    ["issuedTick"],
    ["order", hashUnitOrder],
    ["outcome"],
    ["reason"],
    ["source"],
  ]);
}

function hashUnitOrder(hasher: FnvHasher, value: unknown): void {
  if (!value) {
    hashStableValue(hasher, value);
    return;
  }

  const order = value as Record<string, unknown>;

  if (order.type === "moveTo") {
    hashKnownObject(hasher, order, [
      ["target", hashQuantizedVec3],
      ["type"],
    ]);
    return;
  }

  if (order.type === "attackTarget" || order.type === "escort") {
    hashKnownObject(hasher, order, [
      ["target", hashEntityHandle],
      ["type"],
    ]);
    return;
  }

  hashKnownObject(hasher, order, [
    ["lane", hashOrbitLaneSpec],
    ["planet", hashEntityHandle],
    ["type"],
  ]);
}

function hashEntityHandle(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["generation"],
    ["id"],
  ]);
}

function hashHealth(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["current"],
    ["max"],
  ]);
}

function hashOrbitState(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["isOrbiting"],
    ["orbitTicks"],
    ["planet", hashNullableEntityHandle],
  ]);
}

function hashOrbitLaneSpec(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["axis", hashQuantizedVec3],
    ["direction"],
    ["radius", hashQuantizedNumber],
  ]);
}

function hashNullableEntityHandle(hasher: FnvHasher, value: unknown): void {
  if (!value) {
    hashStableValue(hasher, value);
    return;
  }

  hashEntityHandle(hasher, value);
}

function hashRender(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["materialId"],
    ["meshId"],
    ["scaleTier"],
  ]);
}

function hashAppearance(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["hasRings"],
    ["planetClass"],
    ["seed"],
  ]);
}

function hashPlanetOrbit(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["angularSpeed", hashQuantizedNumber],
    ["center", hashQuantizedVec3],
    ["eccentricity", hashQuantizedNumberOrZero],
    ["phase", hashQuantizedNumber],
    ["periapsisAngle", hashQuantizedNumberOrZero],
    ["radius", hashQuantizedNumber],
  ]);
}

function hashQuantizedVec3(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["x", hashQuantizedNumber],
    ["y", hashQuantizedNumber],
    ["z", hashQuantizedNumber],
  ]);
}

function hashQuantizedQuaternion(hasher: FnvHasher, value: unknown): void {
  hashKnownObject(hasher, value as Record<string, unknown>, [
    ["w", hashQuantizedNumber],
    ["x", hashQuantizedNumber],
    ["y", hashQuantizedNumber],
    ["z", hashQuantizedNumber],
  ]);
}

function hashQuantizedNumber(hasher: FnvHasher, value: unknown): void {
  hashStableValue(hasher, quantize(value as number));
}

function hashQuantizedNumberOrZero(hasher: FnvHasher, value: unknown): void {
  hashStableValue(hasher, quantize(typeof value === "number" ? value : 0));
}

function hashKnownObject(
  hasher: FnvHasher,
  object: Record<string, unknown>,
  fields: readonly (readonly [string, HashValueWriter?])[]
): void {
  const state: HashObjectState = {
    wroteField: false,
  };

  hashString(hasher, "{");

  for (const [key, writeValue] of fields) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      continue;
    }

    hashObjectField(
      hasher,
      state,
      key,
      object[key],
      writeValue ?? hashStableValue
    );
  }

  hashString(hasher, "}");
}

function hashObjectField(
  hasher: FnvHasher,
  state: HashObjectState,
  key: string,
  value: unknown,
  writeValue: HashValueWriter
): void {
  if (state.wroteField) {
    hashString(hasher, ",");
  }

  hashString(hasher, JSON.stringify(key));
  hashString(hasher, ":");
  writeValue(hasher, value);
  state.wroteField = true;
}

function hashArray(
  hasher: FnvHasher,
  values: readonly unknown[],
  writeValue: HashValueWriter
): void {
  hashString(hasher, "[");

  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      hashString(hasher, ",");
    }

    writeValue(hasher, values[index]);
  }

  hashString(hasher, "]");
}

function hashStableValue(hasher: FnvHasher, value: unknown): void {
  if (Array.isArray(value)) {
    hashString(hasher, "[");

    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        hashString(hasher, ",");
      }

      hashStableValue(hasher, value[index]);
    }

    hashString(hasher, "]");
    return;
  }

  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    hashString(hasher, "{");

    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) {
        hashString(hasher, ",");
      }

      const key = keys[index];
      hashString(hasher, JSON.stringify(key));
      hashString(hasher, ":");
      hashStableValue(hasher, object[key]);
    }

    hashString(hasher, "}");
    return;
  }

  hashString(hasher, JSON.stringify(value) ?? "undefined");
}
