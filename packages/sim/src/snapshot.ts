import {
  DEFAULT_CONTENT_REGISTRY,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  createDefaultControllersForGame,
  DEFAULT_COMMAND_LEAD_TICKS,
  resolveMatchRules,
  resolveSimTuning,
  type CompactSimSnapshot,
  type MatchConfig,
  type PlanetSnapshot,
  type UnitSnapshot,
} from "@drop-ship/protocol";
import {
  createEmptyWorld,
  copyComponentsBySlot,
  copyMoveOrder,
  copyUnitOrders,
  copyOrbitState,
  copyPlanetOrbit,
  copyPlanetControl,
  copyWeaponCooldownTicksBySlot,
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  spawnPlanet,
  spawnUnit,
  type SimWorld,
} from "./world";
import { restorePrngStreams, snapshotPrngStreams } from "./prng";

export function serializeWorld(world: SimWorld): CompactSimSnapshot {
  return {
    version: 1,
    matchId: world.config.matchId,
    tick: world.tick,
    seed: world.config.seed,
    protocolVersion: world.config.protocolVersion,
    contentVersion: world.config.contentVersion,
    contentHash: world.config.contentHash,
    commandLeadTicks: world.config.commandLeadTicks,
    gameMode: world.config.gameMode,
    controllers: world.config.controllers,
    rules: world.config.rules,
    tuning: world.config.tuning,
    contentOverrides: world.config.contentOverrides,
    nextEntityId: world.ids.nextId,
    players: world.config.players,
    environment: world.config.environment,
    units: getUnitsInStableOrder(world).map(unitToSnapshot),
    planets: getPlanetsInStableOrder(world).map(planetToSnapshot),
    prng: snapshotPrngStreams(world.prngStreams),
    matchResult: world.matchResult,
  };
}

export function hydrateWorldFromSnapshot(
  snapshot: CompactSimSnapshot,
  content: ContentRegistry = DEFAULT_CONTENT_REGISTRY
): SimWorld {
  const config: MatchConfig = {
    matchId: snapshot.matchId,
    seed: snapshot.seed,
    protocolVersion: snapshot.protocolVersion,
    contentVersion: snapshot.contentVersion,
    contentHash: snapshot.contentHash,
    commandLeadTicks: snapshot.commandLeadTicks ?? DEFAULT_COMMAND_LEAD_TICKS,
    gameMode: snapshot.gameMode,
    controllers:
      snapshot.controllers ??
      createDefaultControllersForGame(snapshot.players, snapshot.gameMode),
    rules: resolveMatchRules(snapshot.rules, snapshot.captureDemoRules),
    tuning: snapshot.tuning ?? resolveSimTuning(undefined),
    contentOverrides: snapshot.contentOverrides,
    players: snapshot.players,
    environment: snapshot.environment,
    initialUnits: [],
    initialPlanets: [],
  };
  const world = createEmptyWorld({
    config,
    content,
    nextEntityId: snapshot.nextEntityId,
  });

  world.tick = snapshot.tick;
  world.prngStreams = restorePrngStreams(snapshot.prng);
  world.matchResult = snapshot.matchResult ?? null;

  for (const unit of snapshot.units) {
    spawnUnit(world, {
      owner: unit.owner,
      templateId: unit.templateId,
      componentsBySlot: unit.componentsBySlot ?? null,
      position: unit.position,
      handle: unit.handle,
      velocity: unit.velocity,
      rotation: unit.rotation,
      moveOrder: copyMoveOrder(unit.moveOrder),
      orderQueue: copyUnitOrders(unit.orderQueue ?? []),
      health: unit.health,
      weaponCooldownTicks: unit.weaponCooldownTicks,
      weaponCooldownTicksBySlot: unit.weaponCooldownTicksBySlot,
      orbit: copyOrbitState(unit.orbit ?? null),
      fighterSpawn: unit.fighterSpawn
        ? {
            nextSpawnTick: unit.fighterSpawn.nextSpawnTick,
            spawnedFighters: unit.fighterSpawn.spawnedFighters.map((handle) => ({
              ...handle,
            })),
          }
        : null,
      spawnedTick: unit.spawnedTick,
    });
  }

  for (const planet of snapshot.planets) {
    spawnPlanet(world, {
      templateId: planet.templateId,
      name: planet.name,
      position: planet.position,
      mass: planet.mass,
      radius: planet.radius,
      color: planet.color,
      hasAtmosphere: planet.hasAtmosphere,
      appearance: planet.appearance,
      orbitAxis: planet.orbitAxis,
      orbit: copyPlanetOrbit(planet.orbit),
      parentPlanetIndex: planet.parentPlanetIndex,
      control: copyPlanetControl(planet.control),
      handle: planet.handle,
      spawnedTick: planet.spawnedTick,
    });
  }

  return world;
}

function unitToSnapshot(unit: SimWorld["units"][number]): UnitSnapshot {
  const weaponCooldownTicksBySlot = copyWeaponCooldownTicksBySlot(
    unit.weaponCooldownTicksBySlot
  );
  const snapshot: UnitSnapshot = {
    handle: unit.handle,
    owner: unit.owner,
    templateId: unit.templateId,
    shipClassId: unit.shipClassId,
    componentsBySlot: copyComponentsBySlot(unit.componentsBySlot),
    position: unit.position,
    velocity: unit.velocity,
    rotation: unit.rotation,
    moveOrder: copyMoveOrder(unit.moveOrder),
    health: {
      current: unit.health.current,
      max: unit.health.max,
    },
    weaponCooldownTicks: unit.weaponCooldownTicks,
    orbit: copyOrbitState(unit.orbit),
    fighterSpawn: unit.fighterSpawn
      ? {
          nextSpawnTick: unit.fighterSpawn.nextSpawnTick,
          spawnedFighters: unit.fighterSpawn.spawnedFighters.map((handle) => ({
            ...handle,
          })),
        }
      : null,
    render: unit.render,
    spawnedTick: unit.spawnedTick,
  };

  const snapshotWithCooldowns =
    Object.keys(weaponCooldownTicksBySlot).length > 0
      ? {
          ...snapshot,
          weaponCooldownTicksBySlot,
        }
      : snapshot;

  return unit.orderQueue.length > 0
    ? {
        ...snapshotWithCooldowns,
        orderQueue: copyUnitOrders(unit.orderQueue),
      }
    : snapshotWithCooldowns;
}

function planetToSnapshot(planet: SimWorld["planets"][number]): PlanetSnapshot {
  return {
    handle: planet.handle,
    templateId: planet.templateId,
    name: planet.name,
    position: planet.position,
    mass: planet.mass,
    radius: planet.radius,
    color: planet.color,
    hasAtmosphere: planet.hasAtmosphere,
    appearance: planet.appearance,
    orbitAxis: planet.orbitAxis,
    orbit: copyPlanetOrbit(planet.orbit),
    parentPlanetIndex: planet.parentPlanetIndex,
    control: copyPlanetControl(planet.control),
    render: planet.render,
    spawnedTick: planet.spawnedTick,
  };
}
