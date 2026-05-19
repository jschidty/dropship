import * as THREE from "three";
import type { ShipStats } from "@drop-ship/content";
import {
  handleKey,
  type EntityHandle,
  type PlanetAppearanceConfig,
  type PlayerId,
} from "@drop-ship/protocol";
import { hashWorld, type SimWorld } from "@drop-ship/sim";
import type { PlanetViewModel, UnitViewModel } from "../types";

type MutableUnitViewModel = {
  handle: EntityHandle;
  key: string;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  health: {
    current: number;
    max: number;
  };
  stats: ShipStats;
};

type MutablePlanetViewModel = {
  key: string;
  label: string;
  position: THREE.Vector3;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  appearance: PlanetAppearanceConfig;
  orbitAxis: THREE.Vector3;
  parentPlanetIndex: number | null;
};

type ViewModelCache = {
  world: SimWorld | null;
  unitTick: number;
  planetTick: number;
  units: MutableUnitViewModel[];
  planets: MutablePlanetViewModel[];
};

type HashCache = {
  world: SimWorld | null;
  tick: number;
  hash: string;
};

export function createViewModelCache(): ViewModelCache {
  return {
    world: null,
    unitTick: -1,
    planetTick: -1,
    units: [],
    planets: [],
  };
}

export function readCachedUnitViewModels(
  world: SimWorld,
  cache: ViewModelCache
): readonly UnitViewModel[] {
  if (cache.world !== world) {
    cache.world = world;
    cache.unitTick = -1;
    cache.planetTick = -1;
  }

  if (cache.unitTick !== world.tick || cache.units.length !== world.units.length) {
    syncUnitViewModels(cache.units, world);
    cache.unitTick = world.tick;
  }

  return cache.units;
}

function syncUnitViewModels(
  target: MutableUnitViewModel[],
  world: SimWorld
): void {
  target.length = world.units.length;

  for (let index = 0; index < world.units.length; index += 1) {
    const unit = world.units[index];
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);
    const key = handleKey(unit.handle);
    let view = target[index];

    if (!view || view.key !== key) {
      view = {
        handle: unit.handle,
        key,
        label: template.displayName,
        owner: unit.owner,
        ownerName: player?.name ?? `Player ${unit.owner}`,
        color: player?.color ?? "#ffffff",
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        health: {
          current: unit.health.current,
          max: unit.health.max,
        },
        stats: template.stats,
      };
      target[index] = view;
    }

    view.handle = unit.handle;
    view.label = template.displayName;
    view.owner = unit.owner;
    view.ownerName = player?.name ?? `Player ${unit.owner}`;
    view.color = player?.color ?? "#ffffff";
    view.position.set(unit.position.x, unit.position.y, unit.position.z);
    view.prevPosition.set(
      unit.prevPosition.x,
      unit.prevPosition.y,
      unit.prevPosition.z
    );
    view.rotation.set(
      unit.rotation.x,
      unit.rotation.y,
      unit.rotation.z,
      unit.rotation.w
    );
    view.health.current = unit.health.current;
    view.health.max = unit.health.max;
    view.stats = template.stats;
  }
}

export function readCachedPlanetViewModels(
  world: SimWorld,
  cache: ViewModelCache
): readonly PlanetViewModel[] {
  if (cache.world !== world) {
    cache.world = world;
    cache.unitTick = -1;
    cache.planetTick = -1;
  }

  if (
    cache.planetTick !== world.tick ||
    cache.planets.length !== world.planets.length
  ) {
    syncPlanetViewModels(cache.planets, world);
    cache.planetTick = world.tick;
  }

  return cache.planets;
}

function syncPlanetViewModels(
  target: MutablePlanetViewModel[],
  world: SimWorld
): void {
  target.length = world.planets.length;

  for (let index = 0; index < world.planets.length; index += 1) {
    const planet = world.planets[index];
    const template = world.content.getPlanetTemplate(planet.templateId);
    const key = handleKey(planet.handle);
    let view = target[index];

    if (!view || view.key !== key) {
      view = {
        key,
        label: planet.name || template.displayName,
        position: new THREE.Vector3(),
        mass: planet.mass,
        radius: planet.radius,
        color: planet.color,
        hasAtmosphere: planet.hasAtmosphere,
        appearance: planet.appearance,
        orbitAxis: new THREE.Vector3(),
        parentPlanetIndex: planet.parentPlanetIndex,
      };
      target[index] = view;
    }

    view.label = planet.name || template.displayName;
    view.position.set(planet.position.x, planet.position.y, planet.position.z);
    view.mass = planet.mass;
    view.radius = planet.radius;
    view.color = planet.color;
    view.hasAtmosphere = planet.hasAtmosphere;
    view.appearance = planet.appearance;
    view.orbitAxis.set(planet.orbitAxis.x, planet.orbitAxis.y, planet.orbitAxis.z);
    view.parentPlanetIndex = planet.parentPlanetIndex;
  }
}

export function createHashCache(): HashCache {
  return {
    world: null,
    tick: -1,
    hash: "",
  };
}

export function readCachedHash(world: SimWorld, cache: HashCache): string {
  if (cache.world !== world || cache.tick !== world.tick) {
    cache.world = world;
    cache.tick = world.tick;
    cache.hash = hashWorld(world);
  }

  return cache.hash;
}

export function readUnitViewModels(world: SimWorld): readonly UnitViewModel[] {
  return world.units.map((unit) => {
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);

    return {
      handle: unit.handle,
      key: handleKey(unit.handle),
      label: template.displayName,
      owner: unit.owner,
      ownerName: player?.name ?? `Player ${unit.owner}`,
      color: player?.color ?? "#ffffff",
      position: toVector3(unit.position),
      prevPosition: toVector3(unit.prevPosition),
      rotation: toQuaternion(unit.rotation),
      health: {
        current: unit.health.current,
        max: unit.health.max,
      },
      stats: template.stats,
    };
  });
}

export function readPlanetViewModels(world: SimWorld): readonly PlanetViewModel[] {
  return world.planets.map((planet) => {
    const template = world.content.getPlanetTemplate(planet.templateId);

    return {
      key: handleKey(planet.handle),
      label: planet.name || template.displayName,
      position: toVector3(planet.position),
      mass: planet.mass,
      radius: planet.radius,
      color: planet.color,
      hasAtmosphere: planet.hasAtmosphere,
      appearance: planet.appearance,
      orbitAxis: toVector3(planet.orbitAxis),
      parentPlanetIndex: planet.parentPlanetIndex,
    };
  });
}

function toVector3(vector: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

function toQuaternion(quaternion: {
  x: number;
  y: number;
  z: number;
  w: number;
}): THREE.Quaternion {
  return new THREE.Quaternion(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  );
}
