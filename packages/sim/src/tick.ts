import {
  PHASE_ONE_SIM_HZ,
  createEmptyCommandBatch,
  sameHandle,
  type CommandBatch,
} from "@drop-ship/protocol";
import { findPrngStream, nextFloat01 } from "./prng";
import {
  capturePrevPositions,
  getUnitsInStableOrder,
  installSystems,
  type SimSystem,
  type SimWorld,
  yawRotation,
} from "./world";
import {
  UNIT_CRUISE_SPEED,
  integrateUnitMotion,
  steerUnits,
} from "./steering";

export const SIM_TICK_RATE = PHASE_ONE_SIM_HZ;
export const SIM_DT_MS = 1000 / SIM_TICK_RATE;
export { SIM_DT_SECONDS } from "./steering";

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
          unit.velocity = {
            x: Math.sin(yaw) * UNIT_CRUISE_SPEED,
            y: unit.velocity.y,
            z: Math.cos(yaw) * UNIT_CRUISE_SPEED,
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
