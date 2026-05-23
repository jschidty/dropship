import * as THREE from "three";
import type {
  ShipStats,
  UnitTemplate,
} from "@drop-ship/content";
import {
  handleKey,
  type CommandSource,
  type EntityHandle,
  type PlanetAppearanceConfig,
  type PlayerId,
  type UnitOrderIntent,
} from "@drop-ship/protocol";
import { hashWorld, readUnitShipStats, type SimWorld } from "@drop-ship/sim";
import type {
  PlanetViewModel,
  UnitLoadoutViewModel,
  UnitViewModel,
} from "../types";

type MutableUnitViewModel = {
  handle: EntityHandle;
  key: string;
  templateId: number;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  shipClassId: number;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  orbit: {
    isOrbiting: boolean;
    planet: EntityHandle | null;
    orbitTicks: number;
  };
  moveOrder: UnitOrderIntent | null;
  orderSource: CommandSource | null;
  orderIssuedTick: number | null;
  lastPlayerOrderTick: number | null;
  queuedOrderCount: number;
  health: {
    current: number;
    max: number;
  };
  stats: ShipStats;
  loadout: UnitLoadoutViewModel;
};

type MutablePlanetViewModel = {
  handle: EntityHandle;
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
  control: {
    capturable: boolean;
    owner: PlayerId | 0;
    capturingPlayer: PlayerId | 0;
    captureTicks: number;
    contested: boolean;
  };
};

type ViewModelCache = {
  world: SimWorld | null;
  unitTick: number;
  planetTick: number;
  units: MutableUnitViewModel[];
  planets: MutablePlanetViewModel[];
  shipStats: Map<number | string, ShipStats>;
  loadouts: Map<string, UnitLoadoutViewModel>;
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
    shipStats: new Map(),
    loadouts: new Map(),
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
    cache.shipStats.clear();
    cache.loadouts.clear();
  }

  if (cache.unitTick !== world.tick || cache.units.length !== world.units.length) {
    syncUnitViewModels(cache.units, world, cache);
    cache.unitTick = world.tick;
  }

  return cache.units;
}

function syncUnitViewModels(
  target: MutableUnitViewModel[],
  world: SimWorld,
  cache: ViewModelCache
): void {
  target.length = world.units.length;

  for (let index = 0; index < world.units.length; index += 1) {
    const unit = world.units[index];
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);
    const stats = readUnitShipStats(world, cache.shipStats, unit);
    const loadout = readUnitLoadoutViewModel(
      world,
      template,
      unit.componentsBySlot,
      cache.loadouts
    );
    const key = handleKey(unit.handle);
    let view = target[index];

    if (!view || view.key !== key) {
      view = {
        handle: unit.handle,
        key,
        templateId: unit.templateId,
        label: template.displayName,
        owner: unit.owner,
        ownerName: player?.name ?? `Player ${unit.owner}`,
        color: player?.color ?? "#ffffff",
        shipClassId: unit.shipClassId,
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        orbit: {
          isOrbiting: unit.orbit.isOrbiting,
          planet: unit.orbit.planet ? { ...unit.orbit.planet } : null,
          orbitTicks: unit.orbit.orbitTicks,
        },
        moveOrder: copyUnitOrderIntent(unit.moveOrder),
        orderSource: unit.orderSource,
        orderIssuedTick: unit.orderIssuedTick,
        lastPlayerOrderTick: unit.lastPlayerOrderTick,
        queuedOrderCount: unit.orderQueue.length,
        health: {
          current: unit.health.current,
          max: unit.health.max,
        },
        stats,
        loadout,
      };
      target[index] = view;
    }

    view.handle = unit.handle;
    view.templateId = unit.templateId;
    view.label = template.displayName;
    view.owner = unit.owner;
    view.ownerName = player?.name ?? `Player ${unit.owner}`;
    view.color = player?.color ?? "#ffffff";
    view.shipClassId = unit.shipClassId;
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
    view.orbit.isOrbiting = unit.orbit.isOrbiting;
    view.orbit.planet = unit.orbit.planet ? { ...unit.orbit.planet } : null;
    view.orbit.orbitTicks = unit.orbit.orbitTicks;
    view.moveOrder = copyUnitOrderIntent(unit.moveOrder);
    view.orderSource = unit.orderSource;
    view.orderIssuedTick = unit.orderIssuedTick;
    view.lastPlayerOrderTick = unit.lastPlayerOrderTick;
    view.queuedOrderCount = unit.orderQueue.length;
    view.health.current = unit.health.current;
    view.health.max = unit.health.max;
    view.stats = stats;
    view.loadout = loadout;
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
    cache.shipStats.clear();
    cache.loadouts.clear();
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
        handle: planet.handle,
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
        control: {
          capturable: planet.control.capturable,
          owner: planet.control.owner,
          capturingPlayer: planet.control.capturingPlayer,
          captureTicks: planet.control.captureTicks,
          contested: planet.control.contested,
        },
      };
      target[index] = view;
    }

    view.handle = planet.handle;
    view.label = planet.name || template.displayName;
    view.position.set(planet.position.x, planet.position.y, planet.position.z);
    view.mass = planet.mass;
    view.radius = planet.radius;
    view.color = planet.color;
    view.hasAtmosphere = planet.hasAtmosphere;
    view.appearance = planet.appearance;
    view.orbitAxis.set(planet.orbitAxis.x, planet.orbitAxis.y, planet.orbitAxis.z);
    view.parentPlanetIndex = planet.parentPlanetIndex;
    view.control.capturable = planet.control.capturable;
    view.control.owner = planet.control.owner;
    view.control.capturingPlayer = planet.control.capturingPlayer;
    view.control.captureTicks = planet.control.captureTicks;
    view.control.contested = planet.control.contested;
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
  const shipStats = new Map<number | string, ShipStats>();
  const loadouts = new Map<string, UnitLoadoutViewModel>();

  return world.units.map((unit) => {
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);
    const stats = readUnitShipStats(world, shipStats, unit);

    return {
      handle: unit.handle,
      key: handleKey(unit.handle),
      templateId: unit.templateId,
      label: template.displayName,
      owner: unit.owner,
      ownerName: player?.name ?? `Player ${unit.owner}`,
      color: player?.color ?? "#ffffff",
      shipClassId: unit.shipClassId,
      position: toVector3(unit.position),
      prevPosition: toVector3(unit.prevPosition),
      rotation: toQuaternion(unit.rotation),
      orbit: {
        isOrbiting: unit.orbit.isOrbiting,
        planet: unit.orbit.planet ? { ...unit.orbit.planet } : null,
        orbitTicks: unit.orbit.orbitTicks,
      },
      moveOrder: copyUnitOrderIntent(unit.moveOrder),
      queuedOrderCount: unit.orderQueue.length,
      health: {
        current: unit.health.current,
        max: unit.health.max,
      },
      stats,
      loadout: readUnitLoadoutViewModel(
        world,
        template,
        unit.componentsBySlot,
        loadouts
      ),
    };
  });
}

function copyUnitOrderIntent(order: UnitOrderIntent | null): UnitOrderIntent | null {
  if (!order) {
    return null;
  }

  switch (order.type) {
    case "moveTo":
      return {
        type: order.type,
        target: { ...order.target },
      };
    case "attackTarget":
    case "escort":
      return {
        type: order.type,
        target: { ...order.target },
      };
    case "capturePlanet":
    case "guardPlanet":
    case "orbitPlanet":
      return order.lane
        ? {
            type: order.type,
            planet: { ...order.planet },
            lane: {
              radius: order.lane.radius,
              axis: { ...order.lane.axis },
              direction: order.lane.direction,
            },
          }
        : {
            type: order.type,
            planet: { ...order.planet },
          };
  }
}

function readUnitLoadoutViewModel(
  world: SimWorld,
  template: UnitTemplate,
  componentsBySlotOverride: Readonly<Record<string, number>> | null,
  cache: Map<string, UnitLoadoutViewModel>
): UnitLoadoutViewModel {
  const componentsBySlot =
    componentsBySlotOverride ?? template.defaultLoadout.componentsBySlot;
  const cacheKey = createLoadoutCacheKey(template.id, componentsBySlotOverride);
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const loadout: UnitLoadoutViewModel = {
    displayName: componentsBySlotOverride
      ? "Custom Loadout"
      : template.defaultLoadout.displayName,
    slots: template.slots.map((slot) => {
      const componentId = componentsBySlot[slot.id];

      return {
        slot,
        component:
          componentId === undefined ? null : world.content.getShipComponent(componentId),
      };
    }),
  };

  cache.set(cacheKey, loadout);
  return loadout;
}

function createLoadoutCacheKey(
  templateId: number,
  componentsBySlot: Readonly<Record<string, number>> | null
): string {
  if (!componentsBySlot) {
    return templateId.toString();
  }

  return `${templateId}:${Object.keys(componentsBySlot)
    .sort()
    .map((slotId) => `${slotId}=${componentsBySlot[slotId]}`)
    .join(",")}`;
}

export function readPlanetViewModels(world: SimWorld): readonly PlanetViewModel[] {
  return world.planets.map((planet) => {
    const template = world.content.getPlanetTemplate(planet.templateId);

    return {
      handle: planet.handle,
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
      control: {
        capturable: planet.control.capturable,
        owner: planet.control.owner,
        capturingPlayer: planet.control.capturingPlayer,
        captureTicks: planet.control.captureTicks,
        contested: planet.control.contested,
      },
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
