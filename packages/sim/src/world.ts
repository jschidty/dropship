import {
  DEFAULT_CONTENT_REGISTRY,
  createMinimalSkirmishConfig,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  compareHandles,
  SHIP_CLASS_IDS,
  type CommandBatch,
  type CommandSource,
  type EntityHandle,
  type MatchEndReason,
  type MatchConfig,
  type PlanetAppearanceConfig,
  type PlanetOrbitConfig,
  type PlayerId,
  type QuaternionData,
  type UnitOrderIntent,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  allocateHandle,
  bindHandle,
  createEntityIdAllocator,
  unbindHandle,
  type EntityIdAllocator,
  type RuntimeEntityId,
} from "./ids";
import { createPrngStream, type PrngStream } from "./prng";
import { readSimTuning, validateResolvedMatchConfig } from "./config";
import { readShipStatsForLoadout } from "./shipStats";
import {
  deterministicCos,
  deterministicSqrt,
  deterministicSin,
  quantizeSimFloat,
} from "./deterministicMath";
import { distanceSquared } from "./movement";

export type SimUnitMoveOrder = {
  type: "moveTo";
  target: Vec3Data;
};

export type SimUnitOrder = UnitOrderIntent;

export type SimUnitOrderMetadata = {
  source: CommandSource;
  issuedTick: number;
};

export type SimFighterSpawnState = {
  nextSpawnTick: number;
  spawnedFighters: EntityHandle[];
};

export type SimOrbitState = {
  isOrbiting: boolean;
  planet: EntityHandle | null;
  orbitTicks: number;
};

export type SimEvent =
  | Readonly<{
      type: "weaponFired";
      tick: number;
      source: EntityHandle;
      target: EntityHandle;
      owner: PlayerId;
      weaponId: number;
      weaponSlotId: string;
      sourceShipClassId: number;
      targetShipClassId: number;
      damage: number;
      start: Vec3Data;
      end: Vec3Data;
    }>
  | Readonly<{
      type: "unitDestroyed";
      tick: number;
      unit: EntityHandle;
      owner: PlayerId;
    }>
  | Readonly<{
      type: "unitSpawned";
      tick: number;
      unit: EntityHandle;
      owner: PlayerId;
      parent: EntityHandle | null;
    }>
  | Readonly<{
      type: "planetCaptured";
      tick: number;
      planet: EntityHandle;
      owner: PlayerId;
    }>;

export type SimUnit = {
  runtimeEntityId: RuntimeEntityId;
  handle: EntityHandle;
  owner: PlayerId;
  templateId: number;
  shipClassId: number;
  componentsBySlot: Readonly<Record<string, number>> | null;
  position: Vec3Data;
  prevPosition: Vec3Data;
  velocity: Vec3Data;
  desiredVelocity: Vec3Data | null;
  rotation: QuaternionData;
  moveOrder: SimUnitOrder | null;
  orderSource: CommandSource | null;
  orderIssuedTick: number | null;
  lastPlayerOrderTick: number | null;
  orderQueue: SimUnitOrder[];
  orderQueueMetadata: SimUnitOrderMetadata[];
  health: {
    current: number;
    max: number;
  };
  weaponCooldownTicks: number;
  weaponCooldownTicksBySlot: Record<string, number>;
  orbit: SimOrbitState;
  fighterSpawn: SimFighterSpawnState | null;
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
  name: string;
  position: Vec3Data;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  appearance: PlanetAppearanceConfig;
  orbitAxis: Vec3Data;
  orbit: PlanetOrbitConfig;
  parentPlanetIndex: number | null;
  control: {
    capturable: boolean;
    owner: PlayerId | 0;
    capturingPlayer: PlayerId | 0;
    capturingDropShip: EntityHandle | null;
    captureTicks: number;
    contested: boolean;
    breakTicks: number;
  };
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

export type SimMutableVec3 = {
  x: number;
  y: number;
  z: number;
};

type StableOrderCache = {
  unitMutation: number;
  planetMutation: number;
  orderedUnitsMutation: number;
  orderedPlanetsMutation: number;
  orderedUnits: readonly SimUnit[];
  orderedPlanets: readonly SimPlanet[];
};

type SimScratch = {
  unitVelocityBuffers: [SimMutableVec3[], SimMutableVec3[]];
  unitVelocityBufferIndex: 0 | 1;
};

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
  matchResult: {
    winner: PlayerId | 0;
    completedTick: number;
    reason: MatchEndReason;
  } | null;
  stableOrderCache: StableOrderCache;
  scratch: SimScratch;
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
        componentsBySlot: initialUnit.componentsBySlot,
        position: initialUnit.position,
        rotation: initialUnit.rotation,
        moveOrder: initialUnit.initialOrder ?? null,
      });
    }

    for (const initialPlanet of config.initialPlanets) {
      spawnPlanet(world, {
        templateId: initialPlanet.templateId,
        name: initialPlanet.name,
        position: initialPlanet.position,
        mass: initialPlanet.mass,
        radius: initialPlanet.radius,
        color: initialPlanet.color,
        hasAtmosphere: initialPlanet.hasAtmosphere,
        appearance: initialPlanet.appearance,
        orbitAxis: initialPlanet.orbitAxis,
        orbit: initialPlanet.orbit,
        parentPlanetIndex: initialPlanet.parentPlanetIndex,
        capturable: initialPlanet.capturable,
        initialOwner: initialPlanet.initialOwner,
      });
    }

    assignInitialCaptureDemoOrders(world);
    keepAllUnitsOutsidePlanets(world);
  }

  return world;
}

export function createEmptyWorld(options: {
  config: MatchConfig;
  content: ContentRegistry;
  nextEntityId?: number;
}): SimWorld {
  validateResolvedMatchConfig(options.config, options.content);

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
    matchResult: null,
    stableOrderCache: createStableOrderCache(),
    scratch: createSimScratch(),
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
    componentsBySlot?: Readonly<Record<string, number>> | null;
    position: Vec3Data;
    handle?: EntityHandle;
    velocity?: Vec3Data;
    rotation?: QuaternionData;
    moveOrder?: SimUnitOrder | null;
    orderSource?: CommandSource | null;
    orderIssuedTick?: number | null;
    lastPlayerOrderTick?: number | null;
    orderQueue?: readonly SimUnitOrder[];
    orderQueueMetadata?: readonly SimUnitOrderMetadata[];
    health?: { current: number; max: number };
    weaponCooldownTicks?: number;
    weaponCooldownTicksBySlot?: Readonly<Record<string, number>> | null;
    orbit?: SimOrbitState;
    fighterSpawn?: SimFighterSpawnState | null;
    spawnedTick?: number;
  }>
): SimUnit {
  const template = world.content.getUnitTemplate(options.templateId);
  const componentsBySlot = copyComponentsBySlot(options.componentsBySlot ?? null);
  const stats = readShipStatsForLoadout(
    world,
    new Map(),
    options.templateId,
    componentsBySlot
  );
  const handle = options.handle ?? allocateHandle(world.ids);
  const runtimeEntityId = allocateRuntimeEntityId(world);
  const position = keepPositionOutsidePlanets(
    world,
    options.position,
    stats.colliderRadius,
    handle.id
  );
  const health = options.health ?? {
    current: stats.maxHealth,
    max: stats.maxHealth,
  };
  const spawnedTick = options.spawnedTick ?? world.tick;
  const moveOrder = copyUnitOrder(options.moveOrder ?? null);
  const unit: SimUnit = {
    runtimeEntityId,
    handle,
    owner: options.owner,
    templateId: options.templateId,
    shipClassId: template.shipClassId,
    componentsBySlot,
    position,
    prevPosition: copyVec3(position),
    velocity: copyVec3(options.velocity ?? template.initialVelocity),
    desiredVelocity: null,
    rotation:
      options.rotation ??
      yawRotation(options.owner === 1 ? Math.PI / 2 : -Math.PI / 2),
    moveOrder,
    orderSource: options.orderSource ?? (moveOrder ? "system" : null),
    orderIssuedTick:
      options.orderIssuedTick ?? (moveOrder ? spawnedTick : null),
    lastPlayerOrderTick: options.lastPlayerOrderTick ?? null,
    orderQueue: copyUnitOrders(options.orderQueue ?? []),
    orderQueueMetadata: copyUnitOrderMetadata(
      options.orderQueueMetadata ?? [],
      options.orderQueue?.length ?? 0
    ),
    health: {
      current: health.current,
      max: health.max,
    },
    weaponCooldownTicks: options.weaponCooldownTicks ?? 0,
    weaponCooldownTicksBySlot: copyWeaponCooldownTicksBySlot(
      options.weaponCooldownTicksBySlot
    ),
    orbit: copyOrbitState(options.orbit ?? null),
    fighterSpawn: copyFighterSpawnState(options.fighterSpawn ?? null),
    render: {
      meshId: template.render.meshId,
      materialId: template.render.materialIdsByPlayer[options.owner],
      scaleTier: template.render.scaleTier,
    },
    spawnedTick,
  };

  world.units.push(unit);
  invalidateUnitStableOrder(world);
  bindHandle(world.ids, handle, runtimeEntityId);
  return unit;
}

export function spawnPlanet(
  world: SimWorld,
  options: Readonly<{
    templateId: number;
    name: string;
    position: Vec3Data;
    mass: number;
    radius: number;
    color: string;
    hasAtmosphere: boolean;
    appearance?: PlanetAppearanceConfig;
    orbitAxis: Vec3Data;
    orbit: PlanetOrbitConfig;
    parentPlanetIndex: number | null;
    capturable?: boolean;
    initialOwner?: PlayerId | 0;
    control?: SimPlanet["control"];
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
    name: options.name,
    position: copyVec3(options.position),
    mass: options.mass,
    radius: options.radius,
    color: options.color,
    hasAtmosphere: options.hasAtmosphere,
    appearance:
      options.appearance ??
      createFallbackPlanetAppearance(options.hasAtmosphere, options.parentPlanetIndex),
    orbitAxis: copyVec3(options.orbitAxis),
    orbit: copyPlanetOrbit(options.orbit),
    parentPlanetIndex: options.parentPlanetIndex,
    control: copyPlanetControl(
      options.control ?? {
        capturable: options.capturable ?? options.parentPlanetIndex === null,
        owner: options.initialOwner ?? 0,
        capturingPlayer: 0,
        capturingDropShip: null,
        captureTicks: 0,
        contested: false,
        breakTicks: 0,
      }
    ),
    render: {
      meshId: template.render.meshId,
      materialId: template.render.materialId,
      scaleTier: template.render.scaleTier,
    },
    spawnedTick: options.spawnedTick ?? world.tick,
  };

  world.planets.push(planet);
  invalidatePlanetStableOrder(world);
  bindHandle(world.ids, handle, runtimeEntityId);
  return planet;
}

export function getUnitsInStableOrder(world: SimWorld): readonly SimUnit[] {
  if (
    world.stableOrderCache.orderedUnitsMutation !==
    world.stableOrderCache.unitMutation
  ) {
    world.stableOrderCache.orderedUnits = world.units
      .slice()
      .sort((a, b) => compareHandles(a.handle, b.handle));
    world.stableOrderCache.orderedUnitsMutation =
      world.stableOrderCache.unitMutation;
  }

  return world.stableOrderCache.orderedUnits;
}

export function getPlanetsInStableOrder(world: SimWorld): readonly SimPlanet[] {
  if (
    world.stableOrderCache.orderedPlanetsMutation !==
    world.stableOrderCache.planetMutation
  ) {
    world.stableOrderCache.orderedPlanets = world.planets
      .slice()
      .sort((a, b) => compareHandles(a.handle, b.handle));
    world.stableOrderCache.orderedPlanetsMutation =
      world.stableOrderCache.planetMutation;
  }

  return world.stableOrderCache.orderedPlanets;
}

export function findUnitByHandle(
  world: SimWorld,
  handle: EntityHandle | null
): SimUnit | null {
  if (!handle) {
    return null;
  }

  return world.units.find((unit) => compareHandles(unit.handle, handle) === 0) ?? null;
}

export function findPlanetByHandle(
  world: SimWorld,
  handle: EntityHandle | null
): SimPlanet | null {
  if (!handle) {
    return null;
  }

  return (
    world.planets.find((planet) => compareHandles(planet.handle, handle) === 0) ??
    null
  );
}

export function removeUnit(world: SimWorld, unit: SimUnit): void {
  const index = world.units.indexOf(unit);

  if (index === -1) {
    return;
  }

  world.units.splice(index, 1);
  invalidateUnitStableOrder(world);
  unbindHandle(world.ids, unit.handle, unit.runtimeEntityId);
}

function createStableOrderCache(): StableOrderCache {
  return {
    unitMutation: 0,
    planetMutation: 0,
    orderedUnitsMutation: -1,
    orderedPlanetsMutation: -1,
    orderedUnits: [],
    orderedPlanets: [],
  };
}

function invalidateUnitStableOrder(world: SimWorld): void {
  world.stableOrderCache.unitMutation += 1;
}

function invalidatePlanetStableOrder(world: SimWorld): void {
  world.stableOrderCache.planetMutation += 1;
}

function createSimScratch(): SimScratch {
  return {
    unitVelocityBuffers: [[], []],
    unitVelocityBufferIndex: 0,
  };
}

export function capturePrevPositions(world: SimWorld): void {
  for (const unit of world.units) {
    unit.prevPosition = copyVec3(unit.position);
  }
}

export function keepAllUnitsOutsidePlanets(world: SimWorld): void {
  const shipStats = new Map<number | string, ReturnType<typeof readShipStatsForLoadout>>();

  for (const unit of getUnitsInStableOrder(world)) {
    const stats = readShipStatsForLoadout(
      world,
      shipStats,
      unit.templateId,
      unit.componentsBySlot
    );
    unit.position = keepPositionOutsidePlanets(
      world,
      unit.position,
      stats.colliderRadius,
      unit.handle.id
    );
    unit.prevPosition = copyVec3(unit.position);
  }
}

export function keepPositionOutsidePlanets(
  world: SimWorld,
  position: Vec3Data,
  colliderRadius: number,
  fallbackSeed: number
): Vec3Data {
  let adjusted = copyVec3(position);
  const tuning = readSimTuning(world);

  for (const planet of getPlanetsInStableOrder(world)) {
    const minimumDistance =
      planet.radius +
      colliderRadius +
      tuning.avoidance.collisionPaddingWorldUnits;
    const offsetX = adjusted.x - planet.position.x;
    const offsetY = adjusted.y - planet.position.y;
    const offsetZ = adjusted.z - planet.position.z;
    const distanceSquaredValue =
      offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;

    if (distanceSquaredValue >= minimumDistance * minimumDistance) {
      continue;
    }

    if (distanceSquaredValue <= 0.000001) {
      const angle = fallbackSeed * 2.399963229728653;
      adjusted = {
        x: quantizeSimFloat(planet.position.x + deterministicSin(angle) * minimumDistance),
        y: quantizeSimFloat(planet.position.y),
        z: quantizeSimFloat(planet.position.z + deterministicCos(angle) * minimumDistance),
      };
      continue;
    }

    const distance = deterministicSqrt(distanceSquaredValue);
    const scale = minimumDistance / distance;
    adjusted = {
      x: quantizeSimFloat(planet.position.x + offsetX * scale),
      y: quantizeSimFloat(planet.position.y + offsetY * scale),
      z: quantizeSimFloat(planet.position.z + offsetZ * scale),
    };
  }

  return adjusted;
}

export function copyVec3(vector: Vec3Data): Vec3Data {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

export function copyComponentsBySlot(
  componentsBySlot: Readonly<Record<string, number>> | null | undefined
): Readonly<Record<string, number>> | null {
  return componentsBySlot ? { ...componentsBySlot } : null;
}

export function copyWeaponCooldownTicksBySlot(
  cooldowns: Readonly<Record<string, number>> | null | undefined
): Record<string, number> {
  const copied: Record<string, number> = {};

  if (!cooldowns) {
    return copied;
  }

  for (const slotId of Object.keys(cooldowns)) {
    const cooldown = cooldowns[slotId];

    if (cooldown > 0) {
      copied[slotId] = cooldown;
    }
  }

  return copied;
}

export function copyPlanetOrbit(orbit: PlanetOrbitConfig): PlanetOrbitConfig {
  return {
    center: copyVec3(orbit.center),
    radius: orbit.radius,
    phase: orbit.phase,
    angularSpeed: orbit.angularSpeed,
    eccentricity: orbit.eccentricity ?? 0,
    periapsisAngle: orbit.periapsisAngle ?? 0,
  };
}

function createFallbackPlanetAppearance(
  hasAtmosphere: boolean,
  parentPlanetIndex: number | null
): PlanetAppearanceConfig {
  return {
    planetClass:
      parentPlanetIndex !== null || !hasAtmosphere ? "ice" : "terran",
    hasRings: false,
    seed: 113,
  };
}

export function copyMoveOrder(moveOrder: SimUnitOrder | null): SimUnitOrder | null {
  return copyUnitOrder(moveOrder);
}

export function copyUnitOrder(order: SimUnitOrder | null): SimUnitOrder | null {
  if (!order) {
    return null;
  }

  if (order.type === "moveTo") {
    return {
      type: order.type,
      target: copyVec3(order.target),
    };
  }

  if (order.type === "attackTarget" || order.type === "escort") {
    return {
      type: order.type,
      target: order.target,
    };
  }

  if (
    order.type === "capturePlanet" ||
    order.type === "guardPlanet" ||
    order.type === "orbitPlanet"
  ) {
    return order.lane
      ? {
          type: order.type,
          planet: order.planet,
          lane: {
            radius: order.lane.radius,
            axis: copyVec3(order.lane.axis),
            direction: order.lane.direction,
          },
        }
      : {
          type: order.type,
          planet: order.planet,
        };
  }

  return order;
}

export function copyUnitOrders(
  orders: readonly SimUnitOrder[]
): SimUnitOrder[] {
  return orders
    .map((order) => copyUnitOrder(order))
    .filter((order): order is SimUnitOrder => order !== null);
}

export function copyUnitOrderMetadata(
  metadata: readonly SimUnitOrderMetadata[],
  orderCount: number
): SimUnitOrderMetadata[] {
  return metadata.slice(0, orderCount).map((entry) => ({
    source: entry.source,
    issuedTick: entry.issuedTick,
  }));
}

export function replaceUnitOrder(
  unit: SimUnit,
  order: SimUnitOrder | null,
  metadata: SimUnitOrderMetadata | null = null
): void {
  unit.moveOrder = copyUnitOrder(order);
  unit.orderSource = unit.moveOrder ? (metadata?.source ?? "system") : null;
  unit.orderIssuedTick = unit.moveOrder ? (metadata?.issuedTick ?? 0) : null;
  if (metadata?.source === "player") {
    unit.lastPlayerOrderTick = metadata.issuedTick;
  }
  unit.orderQueue = [];
  unit.orderQueueMetadata = [];
}

export function appendUnitOrder(
  unit: SimUnit,
  order: SimUnitOrder,
  metadata: SimUnitOrderMetadata = { source: "system", issuedTick: 0 }
): void {
  const copiedOrder = copyUnitOrder(order);

  if (!copiedOrder) {
    return;
  }

  if (metadata.source === "player") {
    unit.lastPlayerOrderTick = metadata.issuedTick;
  }

  if (!unit.moveOrder) {
    unit.moveOrder = copiedOrder;
    unit.orderSource = metadata.source;
    unit.orderIssuedTick = metadata.issuedTick;
    return;
  }

  unit.orderQueue.push(copiedOrder);
  unit.orderQueueMetadata.push({
    source: metadata.source,
    issuedTick: metadata.issuedTick,
  });
}

export function promoteQueuedUnitOrder(unit: SimUnit): void {
  if (unit.moveOrder || unit.orderQueue.length === 0) {
    return;
  }

  unit.moveOrder = unit.orderQueue.shift() ?? null;
  const metadata = unit.orderQueueMetadata.shift() ?? null;
  unit.orderSource = unit.moveOrder ? (metadata?.source ?? "system") : null;
  unit.orderIssuedTick = unit.moveOrder ? (metadata?.issuedTick ?? 0) : null;
}

export function clearUnitOrder(unit: SimUnit): void {
  unit.moveOrder = null;
  unit.orderSource = null;
  unit.orderIssuedTick = null;
}

export function copyFighterSpawnState(
  state: SimFighterSpawnState | null
): SimFighterSpawnState | null {
  return state
    ? {
        nextSpawnTick: state.nextSpawnTick,
        spawnedFighters: state.spawnedFighters.map((handle) => ({ ...handle })),
      }
    : null;
}

export function copyOrbitState(state: SimOrbitState | null): SimOrbitState {
  return state
    ? {
        isOrbiting: state.isOrbiting,
        planet: state.planet ? { ...state.planet } : null,
        orbitTicks: state.orbitTicks,
      }
    : {
        isOrbiting: false,
        planet: null,
        orbitTicks: 0,
      };
}

export function copyPlanetControl(
  control: SimPlanet["control"]
): SimPlanet["control"] {
  return {
    capturable: control.capturable,
    owner: control.owner,
    capturingPlayer: control.capturingPlayer,
    capturingDropShip: control.capturingDropShip
      ? { ...control.capturingDropShip }
      : null,
    captureTicks: control.captureTicks,
    contested: control.contested,
    breakTicks: control.breakTicks,
  };
}

function assignInitialCaptureDemoOrders(world: SimWorld): void {
  if (world.config.gameMode !== "captureDemo") {
    return;
  }

  for (const player of world.config.players) {
    for (const unit of getUnitsInStableOrder(world)) {
      if (
        unit.owner !== player.id ||
        unit.shipClassId !== SHIP_CLASS_IDS.fighter ||
        unit.moveOrder
      ) {
        continue;
      }

      const dropShip = findNearestFriendlyDropShip(world, unit);

      if (dropShip) {
        replaceUnitOrder(
          unit,
          {
            type: "escort",
            target: dropShip.handle,
          },
          { source: "system", issuedTick: world.tick }
        );
      }
    }
  }
}

function findNearestFriendlyDropShip(
  world: SimWorld,
  unit: SimUnit
): SimUnit | null {
  let nearest: SimUnit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner !== unit.owner ||
      candidate.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      candidate.health.current <= 0
    ) {
      continue;
    }

    const candidateDistance = distanceSquared(unit.position, candidate.position);

    if (candidateDistance >= nearestDistance) {
      continue;
    }

    nearest = candidate;
    nearestDistance = candidateDistance;
  }

  return nearest;
}

function allocateRuntimeEntityId(world: SimWorld): RuntimeEntityId {
  const runtimeEntityId = world.nextRuntimeEntityId;
  world.nextRuntimeEntityId += 1;
  return runtimeEntityId;
}

export function yawRotation(yawRadians: number): QuaternionData {
  return {
    x: 0,
    y: deterministicSin(yawRadians / 2),
    z: 0,
    w: deterministicCos(yawRadians / 2),
  };
}
