import {
  DEFAULT_CONTENT_REGISTRY,
  createMinimalSkirmishConfig,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  compareHandles,
  type CommandBatch,
  type EntityHandle,
  type MatchConfig,
  type PlayerId,
  type QuaternionData,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  allocateHandle,
  bindHandle,
  createEntityIdAllocator,
  type EntityIdAllocator,
  type RuntimeEntityId,
} from "./ids";
import { createPrngStream, type PrngStream } from "./prng";

export type SimUnitMoveOrder = {
  type: "moveTo";
  target: Vec3Data;
};

export type SimEvent = Readonly<{
  type: "stub";
  tick: number;
}>;

export type SimUnit = {
  runtimeEntityId: RuntimeEntityId;
  handle: EntityHandle;
  owner: PlayerId;
  templateId: number;
  position: Vec3Data;
  prevPosition: Vec3Data;
  velocity: Vec3Data;
  rotation: QuaternionData;
  moveOrder: SimUnitMoveOrder | null;
  health: {
    current: number;
    max: number;
  };
  render: {
    meshId: number;
    materialId: number;
    scaleTier: number;
  };
  spawnedTick: number;
};

export type SimPlanet = {
  runtimeEntityId: RuntimeEntityId;
  handle: EntityHandle;
  templateId: number;
  position: Vec3Data;
  mass: number;
  radius: number;
  render: {
    meshId: number;
    materialId: number;
    scaleTier: number;
  };
  spawnedTick: number;
};

export type SimSystem = Readonly<{
  name: string;
  run: (world: SimWorld, tick: number) => void;
}>;

export type SimWorld = {
  config: MatchConfig;
  content: ContentRegistry;
  tick: number;
  nextRuntimeEntityId: RuntimeEntityId;
  ids: EntityIdAllocator;
  units: SimUnit[];
  planets: SimPlanet[];
  events: SimEvent[];
  commandBatch: CommandBatch | null;
  systems: readonly SimSystem[];
  prngStreams: readonly PrngStream[];
};

export type CreateWorldOptions = Readonly<{
  config?: MatchConfig;
  content?: ContentRegistry;
  nextEntityId?: number;
  spawnInitialUnits?: boolean;
}>;

export function createWorld(options: CreateWorldOptions = {}): SimWorld {
  const config = options.config ?? createMinimalSkirmishConfig();
  const content = options.content ?? DEFAULT_CONTENT_REGISTRY;
  const world = createEmptyWorld({
    config,
    content,
    nextEntityId: options.nextEntityId,
  });

  if (options.spawnInitialUnits ?? true) {
    for (const initialUnit of config.initialUnits) {
      spawnUnit(world, {
        owner: initialUnit.owner,
        templateId: initialUnit.templateId,
        position: initialUnit.position,
      });
    }

    for (const initialPlanet of config.initialPlanets) {
      spawnPlanet(world, {
        templateId: initialPlanet.templateId,
        position: initialPlanet.position,
        mass: initialPlanet.mass,
        radius: initialPlanet.radius,
      });
    }
  }

  return world;
}

export function createEmptyWorld(options: {
  config: MatchConfig;
  content: ContentRegistry;
  nextEntityId?: number;
}): SimWorld {
  return {
    config: options.config,
    content: options.content,
    tick: 0,
    nextRuntimeEntityId: 0,
    ids: createEntityIdAllocator(options.nextEntityId),
    units: [],
    planets: [],
    events: [],
    commandBatch: null,
    systems: [],
    prngStreams: [
      createPrngStream(options.config.seed, "command"),
      createPrngStream(options.config.seed, "spawn"),
    ],
  };
}

export function installSystems(world: SimWorld, systems: readonly SimSystem[]): void {
  world.systems = systems;
}

export function spawnUnit(
  world: SimWorld,
  options: Readonly<{
    owner: PlayerId;
    templateId: number;
    position: Vec3Data;
    handle?: EntityHandle;
    velocity?: Vec3Data;
    rotation?: QuaternionData;
    moveOrder?: SimUnitMoveOrder | null;
    health?: { current: number; max: number };
    spawnedTick?: number;
  }>
): SimUnit {
  const template = world.content.getUnitTemplate(options.templateId);
  const handle = options.handle ?? allocateHandle(world.ids);
  const runtimeEntityId = allocateRuntimeEntityId(world);
  const health = options.health ?? {
    current: template.maxHealth,
    max: template.maxHealth,
  };
  const unit: SimUnit = {
    runtimeEntityId,
    handle,
    owner: options.owner,
    templateId: options.templateId,
    position: copyVec3(options.position),
    prevPosition: copyVec3(options.position),
    velocity: copyVec3(options.velocity ?? template.defaultVelocity),
    rotation: options.rotation ?? yawRotation(options.owner === 1 ? Math.PI / 2 : -Math.PI / 2),
    moveOrder: copyMoveOrder(options.moveOrder ?? null),
    health: {
      current: health.current,
      max: health.max,
    },
    render: {
      meshId: template.render.meshId,
      materialId: template.render.materialIdsByPlayer[options.owner],
      scaleTier: template.render.scaleTier,
    },
    spawnedTick: options.spawnedTick ?? world.tick,
  };

  world.units.push(unit);
  bindHandle(world.ids, handle, runtimeEntityId);
  return unit;
}

export function spawnPlanet(
  world: SimWorld,
  options: Readonly<{
    templateId: number;
    position: Vec3Data;
    mass: number;
    radius: number;
    handle?: EntityHandle;
    spawnedTick?: number;
  }>
): SimPlanet {
  const template = world.content.getPlanetTemplate(options.templateId);
  const handle = options.handle ?? allocateHandle(world.ids);
  const runtimeEntityId = allocateRuntimeEntityId(world);
  const planet: SimPlanet = {
    runtimeEntityId,
    handle,
    templateId: options.templateId,
    position: copyVec3(options.position),
    mass: options.mass,
    radius: options.radius,
    render: {
      meshId: template.render.meshId,
      materialId: template.render.materialId,
      scaleTier: template.render.scaleTier,
    },
    spawnedTick: options.spawnedTick ?? world.tick,
  };

  world.planets.push(planet);
  bindHandle(world.ids, handle, runtimeEntityId);
  return planet;
}

export function getUnitsInStableOrder(world: SimWorld): readonly SimUnit[] {
  return world.units
    .slice()
    .sort((a, b) => compareHandles(a.handle, b.handle));
}

export function getPlanetsInStableOrder(world: SimWorld): readonly SimPlanet[] {
  return world.planets
    .slice()
    .sort((a, b) => compareHandles(a.handle, b.handle));
}

export function capturePrevPositions(world: SimWorld): void {
  for (const unit of world.units) {
    unit.prevPosition = copyVec3(unit.position);
  }
}

export function copyVec3(vector: Vec3Data): Vec3Data {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

export function copyMoveOrder(
  moveOrder: SimUnitMoveOrder | null
): SimUnitMoveOrder | null {
  return moveOrder
    ? {
        type: moveOrder.type,
        target: copyVec3(moveOrder.target),
      }
    : null;
}

function allocateRuntimeEntityId(world: SimWorld): RuntimeEntityId {
  const runtimeEntityId = world.nextRuntimeEntityId;
  world.nextRuntimeEntityId += 1;
  return runtimeEntityId;
}

export function yawRotation(yawRadians: number): QuaternionData {
  return {
    x: 0,
    y: Math.sin(yawRadians / 2),
    z: 0,
    w: Math.cos(yawRadians / 2),
  };
}
