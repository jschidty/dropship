import {
  PHASE_ONE_SIM_HZ,
  createEmptyCommandBatch,
  sameHandle,
  type CommandBatch,
} from "@drop-ship/protocol";
import { findPrngStream, nextFloat01 } from "./prng";
import {
  capturePrevPositions,
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  installSystems,
  type SimPlanet,
  type SimSystem,
  type SimUnit,
  type SimWorld,
  yawRotation,
} from "./world";

export const SIM_TICK_RATE = PHASE_ONE_SIM_HZ;
export const SIM_DT_SECONDS = 1 / SIM_TICK_RATE;
export const SIM_DT_MS = 1000 / SIM_TICK_RATE;
const PLACEHOLDER_MOVE_SPEED = 24;
const MOVE_ORDER_ARRIVAL_DISTANCE = 1.2;

export const CommandIntakeSystem: SimSystem = {
  name: "CommandIntakeSystem",
  run(world) {
    const commands = world.commandBatch?.commands ?? [];
    const commandPrng = findPrngStream(world.prngStreams, "command");

    for (const scheduled of commands) {
      if (scheduled.command.type === "randomTurnOwnedUnits") {
        for (const unit of getUnitsInStableOrder(world)) {
          if (unit.owner !== scheduled.playerId) {
            continue;
          }

          const yaw = nextFloat01(commandPrng) * Math.PI * 2;
          unit.rotation = yawRotation(yaw);
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
    }
  },
};

export const FleetCommandSystem: SimSystem = {
  name: "FleetCommandSystem",
  run() {
    // Fleet translation is intentionally empty in the two-unit scaffold.
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
  run() {
    // Gravity, avoidance, and formation steering are not part of this scaffold.
  },
};

export const PhysicsSystem: SimSystem = {
  name: "PhysicsSystem",
  run(world, tick) {
    const planet = getPlanetsInStableOrder(world)[0];

    if (!planet) {
      return;
    }

    for (const unit of getUnitsInStableOrder(world)) {
      const nextPosition = unit.moveOrder
        ? computeMoveOrderPosition(unit)
        : computePlaceholderOrbitPosition(unit, planet, tick + 1);
      unit.velocity = {
        x: (nextPosition.x - unit.position.x) / SIM_DT_SECONDS,
        y: (nextPosition.y - unit.position.y) / SIM_DT_SECONDS,
        z: (nextPosition.z - unit.position.z) / SIM_DT_SECONDS,
      };
      unit.position = nextPosition;
    }
  },
};

export const CollisionSystem: SimSystem = {
  name: "CollisionSystem",
  run() {
    // Collision is intentionally absent from the minimal game instance.
  },
};

export const CombatSystem: SimSystem = {
  name: "CombatSystem",
  run() {
    // Combat is intentionally absent from the minimal game instance.
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
  run() {
    // Spawn/despawn queues will land here once commands and objectives exist.
  },
};

export const EventFlushSystem: SimSystem = {
  name: "EventFlushSystem",
  run(world) {
    world.events = [];
  },
};

export const PHASE_ONE_SYSTEMS: readonly SimSystem[] = [
  CommandIntakeSystem,
  FleetCommandSystem,
  ShipOrderSystem,
  SteeringSystem,
  PhysicsSystem,
  CollisionSystem,
  CombatSystem,
  MiningSystem,
  ResourceSystem,
  LifecycleSystem,
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
  world.commandBatch = batch;

  for (const system of world.systems) {
    system.run(world, world.tick);
  }

  world.commandBatch = null;
  world.tick += 1;
}

function computePlaceholderOrbitPosition(
  unit: SimUnit,
  planet: SimPlanet,
  tick: number
) {
  const time = tick * SIM_DT_SECONDS;
  const phase = unitScalar(unit, 0x41c64e6d) * Math.PI * 2;
  const orbitRadius = planet.radius * (2.65 + unitScalar(unit, 0x9e3779b9) * 1.1);
  const orbitSpeed =
    (0.018 + unitScalar(unit, 0x85ebca6b) * 0.028) * (unit.owner === 1 ? 1 : -1);
  const verticalOffset = planet.radius * ((unitScalar(unit, 0xc2b2ae35) - 0.5) * 0.34);
  const angle = phase + time * orbitSpeed;

  return {
    x: planet.position.x + Math.cos(angle) * orbitRadius,
    y: planet.position.y + verticalOffset,
    z: planet.position.z + Math.sin(angle) * orbitRadius,
  };
}

function computeMoveOrderPosition(unit: SimUnit) {
  const target = unit.moveOrder?.target;

  if (!target) {
    return unit.position;
  }

  const dx = target.x - unit.position.x;
  const dy = target.y - unit.position.y;
  const dz = target.z - unit.position.z;
  const distance = Math.hypot(dx, dy, dz);

  if (distance <= MOVE_ORDER_ARRIVAL_DISTANCE) {
    return unit.position;
  }

  const step = Math.min(PLACEHOLDER_MOVE_SPEED * SIM_DT_SECONDS, distance);
  const direction = {
    x: dx / distance,
    y: dy / distance,
    z: dz / distance,
  };
  unit.rotation = yawRotation(Math.atan2(direction.x, direction.z));

  return {
    x: unit.position.x + direction.x * step,
    y: unit.position.y + direction.y * step,
    z: unit.position.z + direction.z * step,
  };
}

function unitScalar(unit: SimUnit, salt: number): number {
  let value =
    (Math.imul(unit.handle.id, 374761393) ^
      Math.imul(unit.owner, 668265263) ^
      salt) >>>
    0;
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}
