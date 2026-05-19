import {
  DEFAULT_CAPTURE_DEMO_RULES,
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  TEMPLATE_IDS,
  createEmptyCommandBatch,
  sameHandle,
  type CaptureDemoRules,
  type CommandBatch,
  type EntityHandle,
  type PlayerId,
  type Vec3Data,
} from "@drop-ship/protocol";
import type { ShipStats } from "@drop-ship/content";
import { findPrngStream, nextFloat01 } from "./prng";
import {
  capturePrevPositions,
  findPlanetByHandle,
  findUnitByHandle,
  getUnitsInStableOrder,
  getPlanetsInStableOrder,
  installSystems,
  removeUnit,
  spawnUnit,
  copyUnitOrder,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
  yawRotation,
} from "./world";
import {
  integrateUnitMotion,
  steerUnits,
} from "./steering";
import { readUnitShipStats } from "./shipStats";
import {
  readUnitWeaponProfile,
  type UnitWeaponProfile,
} from "./shipStats";
import { updatePlanetaryOrbits } from "./orbits";
import {
  SIM_TAU,
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  quantizeSimFloat,
} from "./deterministicMath";

export const SIM_TICK_RATE = PHASE_ONE_SIM_HZ;
export const SIM_DT_MS = 1000 / SIM_TICK_RATE;
export { SIM_DT_SECONDS } from "./steering";

export const PlanetMotionSystem: SimSystem = {
  name: "PlanetMotionSystem",
  run(world, tick) {
    updatePlanetaryOrbits(world, tick);
  },
};

export const CommandIntakeSystem: SimSystem = {
  name: "CommandIntakeSystem",
  run(world) {
    const commands = world.commandBatch?.commands ?? [];
    const commandPrng = findPrngStream(world.prngStreams, "command");
    const shipStats = new Map<number, ShipStats>();

    for (const scheduled of commands) {
      if (scheduled.command.type === "randomTurnOwnedUnits") {
        for (const unit of getUnitsInStableOrder(world)) {
          if (unit.owner !== scheduled.playerId) {
            continue;
          }

          const yaw = nextFloat01(commandPrng) * SIM_TAU;
          const stats = readUnitShipStats(world, shipStats, unit);
          unit.rotation = yawRotation(yaw);
          unit.velocity = {
            x: deterministicSin(yaw) * stats.cruiseSpeed,
            y: unit.velocity.y,
            z: deterministicCos(yaw) * stats.cruiseSpeed,
          };
        }
      }

      if (scheduled.command.type === "moveUnits") {
        for (const unit of getUnitsInStableOrder(world)) {
          if (
            unit.owner !== scheduled.playerId ||
            !scheduled.command.unitHandles.some((handle) =>
              sameHandle(handle, unit.handle)
            )
          ) {
            continue;
          }

          unit.moveOrder = {
            type: "moveTo",
            target: {
              x: scheduled.command.target.x,
              y: scheduled.command.target.y,
              z: scheduled.command.target.z,
            },
          };
        }
      }

      if (scheduled.command.type === "issueUnitOrder") {
        for (const unit of getUnitsInStableOrder(world)) {
          if (
            unit.owner !== scheduled.playerId ||
            !scheduled.command.unitHandles.some((handle) =>
              sameHandle(handle, unit.handle)
            )
          ) {
            continue;
          }

          unit.moveOrder = copyUnitOrder(scheduled.command.order);
        }
      }
    }
  },
};

export const FleetCommandSystem: SimSystem = {
  name: "FleetCommandSystem",
  run() {
    // Fleet translation is intentionally empty in the two-unit scaffold.
  },
};

export const NpcCommandSystem: SimSystem = {
  name: "NpcCommandSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);

    if (tick % rules.npcThinkIntervalTicks !== 0) {
      return;
    }

    const guardPlanet = getPlanetsInStableOrder(world).find(
      (planet) => planet.control.capturable
    );

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.owner !== 2 || unit.health.current <= 0) {
        continue;
      }

      const target = findNearestEnemy(world, unit, rules.npcAggroRange);

      if (target) {
        unit.moveOrder = {
          type: "attackTarget",
          target: target.handle,
        };
        continue;
      }

      if (guardPlanet) {
        unit.moveOrder = {
          type: "guardPlanet",
          planet: guardPlanet.handle,
        };
      }
    }
  },
};

export const ShipOrderSystem: SimSystem = {
  name: "ShipOrderSystem",
  run() {
    // Unit orders are intentionally empty until commands exist.
  },
};

export const SteeringSystem: SimSystem = {
  name: "SteeringSystem",
  run(world, tick) {
    steerUnits(world, tick);
  },
};

export const PhysicsSystem: SimSystem = {
  name: "PhysicsSystem",
  run(world) {
    integrateUnitMotion(world);
  },
};

export const CollisionSystem: SimSystem = {
  name: "CollisionSystem",
  run(world) {
    resolvePlanetCollisions(world);
  },
};

export const CombatSystem: SimSystem = {
  name: "CombatSystem",
  run(world, tick) {
    const weaponProfiles = new Map<number, UnitWeaponProfile>();

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.weaponCooldownTicks > 0) {
        unit.weaponCooldownTicks -= 1;
      }
    }

    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.health.current <= 0 || unit.weaponCooldownTicks > 0) {
        continue;
      }

      const weapon = readUnitWeaponProfile(world, weaponProfiles, unit);

      if (!weapon) {
        continue;
      }

      const target = findWeaponTarget(world, unit, weapon);

      if (!target) {
        continue;
      }

      target.health.current = Math.max(0, target.health.current - weapon.damage);
      unit.weaponCooldownTicks = weapon.cooldownTicks;
      world.events.push({
        type: "weaponFired",
        tick,
        source: unit.handle,
        target: target.handle,
        owner: unit.owner,
        weaponId: weapon.weaponId,
        start: unit.position,
        end: target.position,
      });

      if (target.health.current <= 0) {
        world.events.push({
          type: "unitDestroyed",
          tick,
          unit: target.handle,
          owner: target.owner,
        });
      }
    }
  },
};

export const MiningSystem: SimSystem = {
  name: "MiningSystem",
  run() {
    // Mining is intentionally absent from the minimal game instance.
  },
};

export const ResourceSystem: SimSystem = {
  name: "ResourceSystem",
  run() {
    // Economy state is intentionally absent from the minimal game instance.
  },
};

export const LifecycleSystem: SimSystem = {
  name: "LifecycleSystem",
  run(world) {
    for (const unit of getUnitsInStableOrder(world)) {
      if (unit.health.current <= 0) {
        removeUnit(world, unit);
      }
    }
  },
};

export const CaptureSystem: SimSystem = {
  name: "CaptureSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);
    const requiredTicks = Math.floor(
      rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ
    );

    for (const planet of getPlanetsInStableOrder(world)) {
      if (!planet.control.capturable) {
        continue;
      }

      updatePlanetCapture(world, planet, rules, requiredTicks, tick);
    }
  },
};

export const DropShipSpawnSystem: SimSystem = {
  name: "DropShipSpawnSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo") {
      return;
    }

    const rules = readCaptureDemoRules(world);

    for (const dropShip of getUnitsInStableOrder(world)) {
      if (
        dropShip.shipClassId !== SHIP_CLASS_IDS.dropShip ||
        dropShip.health.current <= 0
      ) {
        continue;
      }

      if (!dropShip.fighterSpawn) {
        dropShip.fighterSpawn = {
          nextSpawnTick: tick + rules.fighterSpawnIntervalTicks,
          spawnedFighters: [],
        };
      }

      dropShip.fighterSpawn.spawnedFighters =
        dropShip.fighterSpawn.spawnedFighters.filter(
          (handle) => (findUnitByHandle(world, handle)?.health.current ?? 0) > 0
        );

      if (
        dropShip.fighterSpawn.spawnedFighters.length >=
          rules.fighterSpawnCapPerDropShip ||
        tick < dropShip.fighterSpawn.nextSpawnTick
      ) {
        continue;
      }

      const fighter = spawnUnit(world, {
        owner: dropShip.owner,
        templateId: TEMPLATE_IDS.fighterShip,
        position: computeSpawnPosition(dropShip, tick),
        spawnedTick: tick,
      });
      dropShip.fighterSpawn.spawnedFighters.push(fighter.handle);
      dropShip.fighterSpawn.nextSpawnTick =
        tick + rules.fighterSpawnIntervalTicks;
      world.events.push({
        type: "unitSpawned",
        tick,
        unit: fighter.handle,
        owner: fighter.owner,
        parent: dropShip.handle,
      });
    }
  },
};

export const MatchEndSystem: SimSystem = {
  name: "MatchEndSystem",
  run(world, tick) {
    if (world.config.gameMode !== "captureDemo" || world.matchResult) {
      return;
    }

    const capturablePlanets = getPlanetsInStableOrder(world).filter(
      (planet) => planet.control.capturable
    );
    const owner = capturablePlanets[0]?.control.owner ?? 0;

    if (
      owner !== 0 &&
      capturablePlanets.length > 0 &&
      capturablePlanets.every((planet) => planet.control.owner === owner)
    ) {
      world.matchResult = {
        winner: owner,
        completedTick: tick,
        reason: "allPlanetsCaptured",
      };
    }
  },
};

export const EventFlushSystem: SimSystem = {
  name: "EventFlushSystem",
  run() {
    // Events remain available to presentation until the next sim tick begins.
  },
};

export const PHASE_ONE_SYSTEMS: readonly SimSystem[] = [
  PlanetMotionSystem,
  CommandIntakeSystem,
  NpcCommandSystem,
  FleetCommandSystem,
  ShipOrderSystem,
  SteeringSystem,
  PhysicsSystem,
  CollisionSystem,
  CombatSystem,
  CaptureSystem,
  DropShipSpawnSystem,
  MiningSystem,
  ResourceSystem,
  LifecycleSystem,
  MatchEndSystem,
  EventFlushSystem,
];

export function runTick(
  world: SimWorld,
  batch: CommandBatch = createEmptyCommandBatch(world.tick)
): void {
  if (batch.tick !== world.tick) {
    throw new Error(`Expected command batch for tick ${world.tick}, received ${batch.tick}`);
  }

  if (world.systems.length === 0) {
    installSystems(world, PHASE_ONE_SYSTEMS);
  }

  capturePrevPositions(world);
  world.events = [];
  world.commandBatch = batch;

  for (const system of world.systems) {
    system.run(world, world.tick);
  }

  world.commandBatch = null;
  world.tick += 1;
}

function readCaptureDemoRules(world: SimWorld): CaptureDemoRules {
  return world.config.captureDemoRules ?? DEFAULT_CAPTURE_DEMO_RULES;
}

function findNearestEnemy(
  world: SimWorld,
  unit: SimUnit,
  maxRange: number
): SimUnit | null {
  const maxRangeSquared = maxRange * maxRange;
  let best: SimUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    const distance = distanceSquared(unit.position, candidate.position);

    if (distance > maxRangeSquared || distance >= bestDistance) {
      continue;
    }

    best = candidate;
    bestDistance = distance;
  }

  return best;
}

function findWeaponTarget(
  world: SimWorld,
  unit: SimUnit,
  weapon: UnitWeaponProfile
): SimUnit | null {
  const orderedTarget = readOrderedAttackTarget(world, unit);

  if (
    orderedTarget &&
    orderedTarget.owner !== unit.owner &&
    orderedTarget.health.current > 0 &&
    distanceSquared(unit.position, orderedTarget.position) <=
      weapon.range * weapon.range
  ) {
    return orderedTarget;
  }

  return findNearestEnemy(world, unit, weapon.range);
}

function readOrderedAttackTarget(world: SimWorld, unit: SimUnit): SimUnit | null {
  const order = unit.moveOrder;

  if (!order) {
    return null;
  }

  if (order.type === "attackTarget" || order.type === "escort") {
    return findUnitByHandle(world, order.target);
  }

  return null;
}

function updatePlanetCapture(
  world: SimWorld,
  planet: SimPlanet,
  rules: CaptureDemoRules,
  requiredTicks: number,
  tick: number
): void {
  const eligible = getEligibleDropShips(world, planet, rules);
  const playerOneDropShip = eligible.find((unit) => unit.owner === 1) ?? null;
  const playerTwoDropShip = eligible.find((unit) => unit.owner === 2) ?? null;

  planet.control.contested = Boolean(playerOneDropShip && playerTwoDropShip);

  if (planet.control.contested) {
    return;
  }

  const candidate = playerOneDropShip ?? playerTwoDropShip;

  if (!candidate) {
    handleCaptureBreak(planet, rules);
    return;
  }

  if (planet.control.owner === candidate.owner) {
    resetCaptureProgress(planet);
    return;
  }

  if (
    planet.control.capturingPlayer !== candidate.owner ||
    !planet.control.capturingDropShip ||
    !sameHandle(planet.control.capturingDropShip, candidate.handle)
  ) {
    planet.control.capturingPlayer = candidate.owner;
    planet.control.capturingDropShip = candidate.handle;
    planet.control.captureTicks = 1;
    planet.control.breakTicks = 0;
    return;
  }

  planet.control.captureTicks += 1;
  planet.control.breakTicks = 0;

  if (planet.control.captureTicks > requiredTicks) {
    planet.control.owner = candidate.owner;
    world.events.push({
      type: "planetCaptured",
      tick,
      planet: planet.handle,
      owner: candidate.owner,
    });
    resetCaptureProgress(planet);
  }
}

function getEligibleDropShips(
  world: SimWorld,
  planet: SimPlanet,
  rules: CaptureDemoRules
): readonly SimUnit[] {
  const minRadius = planet.radius * rules.captureOrbitMinRadiusMultiplier;
  const maxRadius = planet.radius * rules.captureOrbitMaxRadiusMultiplier;
  const minRadiusSquared = minRadius * minRadius;
  const maxRadiusSquared = maxRadius * maxRadius;

  return getUnitsInStableOrder(world).filter((unit) => {
    if (
      unit.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      unit.health.current <= 0 ||
      unit.moveOrder?.type !== "capturePlanet" ||
      !sameHandle(unit.moveOrder.planet, planet.handle)
    ) {
      return false;
    }

    const distance = distanceSquared(unit.position, planet.position);
    return distance >= minRadiusSquared && distance <= maxRadiusSquared;
  });
}

function handleCaptureBreak(planet: SimPlanet, rules: CaptureDemoRules): void {
  if (
    planet.control.capturingDropShip &&
    planet.control.breakTicks < rules.captureBreakGraceTicks
  ) {
    planet.control.breakTicks += 1;
    return;
  }

  resetCaptureProgress(planet);
}

function resetCaptureProgress(planet: SimPlanet): void {
  planet.control.capturingPlayer = 0;
  planet.control.capturingDropShip = null;
  planet.control.captureTicks = 0;
  planet.control.contested = false;
  planet.control.breakTicks = 0;
}

function computeSpawnPosition(dropShip: SimUnit, tick: number): Vec3Data {
  const angle =
    ((dropShip.handle.id * 97 + tick * 17) % 360) * (SIM_TAU / 360);
  const radius = 7 + (dropShip.handle.id % 5);

  return {
    x: dropShip.position.x + deterministicSin(angle) * radius,
    y: dropShip.position.y + ((dropShip.handle.id % 3) - 1) * 1.5,
    z: dropShip.position.z + deterministicCos(angle) * radius,
  };
}

function resolvePlanetCollisions(world: SimWorld): void {
  const shipStats = new Map<number, ShipStats>();

  for (const unit of getUnitsInStableOrder(world)) {
    const stats = readUnitShipStats(world, shipStats, unit);

    for (const planet of getPlanetsInStableOrder(world)) {
      const minimumDistance = planet.radius + stats.colliderRadius + 0.35;
      const offsetX = unit.position.x - planet.position.x;
      const offsetY = unit.position.y - planet.position.y;
      const offsetZ = unit.position.z - planet.position.z;
      const distanceSquaredValue =
        offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;

      if (distanceSquaredValue >= minimumDistance * minimumDistance) {
        continue;
      }

      let normalX: number;
      let normalY: number;
      let normalZ: number;

      if (distanceSquaredValue <= 0.000001) {
        const angle = unit.handle.id * 2.399963229728653;
        normalX = deterministicSin(angle);
        normalY = 0;
        normalZ = deterministicCos(angle);
      } else {
        const distance = deterministicSqrt(distanceSquaredValue);
        normalX = offsetX / distance;
        normalY = offsetY / distance;
        normalZ = offsetZ / distance;
      }

      unit.position = {
        x: quantizeSimFloat(planet.position.x + normalX * minimumDistance),
        y: quantizeSimFloat(planet.position.y + normalY * minimumDistance),
        z: quantizeSimFloat(planet.position.z + normalZ * minimumDistance),
      };

      const inwardSpeed =
        unit.velocity.x * normalX +
        unit.velocity.y * normalY +
        unit.velocity.z * normalZ;

      if (inwardSpeed < 0) {
        unit.velocity = {
          x: quantizeSimFloat(unit.velocity.x - normalX * inwardSpeed),
          y: quantizeSimFloat(unit.velocity.y - normalY * inwardSpeed),
          z: quantizeSimFloat(unit.velocity.z - normalZ * inwardSpeed),
        };
      }
    }
  }
}

function distanceSquared(a: Vec3Data, b: Vec3Data): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;

  return x * x + y * y + z * z;
}
