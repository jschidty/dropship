import {
  DEFAULT_CONTENT_REGISTRY,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  DEFAULT_COMMAND_LEAD_TICKS,
  type CompactSimSnapshot,
  type MatchConfig,
  type PlanetSnapshot,
  type UnitSnapshot,
} from "@drop-ship/protocol";
import {
  createEmptyWorld,
  copyMoveOrder,
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
    commandLeadTicks: world.config.commandLeadTicks,
    nextEntityId: world.ids.nextId,
    players: world.config.players,
    units: getUnitsInStableOrder(world).map(unitToSnapshot),
    planets: getPlanetsInStableOrder(world).map(planetToSnapshot),
    prng: snapshotPrngStreams(world.prngStreams),
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
    commandLeadTicks: snapshot.commandLeadTicks ?? DEFAULT_COMMAND_LEAD_TICKS,
    players: snapshot.players,
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

  for (const unit of snapshot.units) {
    spawnUnit(world, {
      owner: unit.owner,
      templateId: unit.templateId,
      position: unit.position,
      handle: unit.handle,
      velocity: unit.velocity,
      rotation: unit.rotation,
      moveOrder: copyMoveOrder(unit.moveOrder),
      health: unit.health,
      spawnedTick: unit.spawnedTick,
    });
  }

  for (const planet of snapshot.planets) {
    spawnPlanet(world, {
      templateId: planet.templateId,
      position: planet.position,
      mass: planet.mass,
      radius: planet.radius,
      handle: planet.handle,
      spawnedTick: planet.spawnedTick,
    });
  }

  return world;
}

function unitToSnapshot(unit: SimWorld["units"][number]): UnitSnapshot {
  return {
    handle: unit.handle,
    owner: unit.owner,
    templateId: unit.templateId,
    position: unit.position,
    velocity: unit.velocity,
    rotation: unit.rotation,
    moveOrder: copyMoveOrder(unit.moveOrder),
    health: {
      current: unit.health.current,
      max: unit.health.max,
    },
    render: unit.render,
    spawnedTick: unit.spawnedTick,
  };
}

function planetToSnapshot(planet: SimWorld["planets"][number]): PlanetSnapshot {
  return {
    handle: planet.handle,
    templateId: planet.templateId,
    position: planet.position,
    mass: planet.mass,
    radius: planet.radius,
    render: planet.render,
    spawnedTick: planet.spawnedTick,
  };
}
