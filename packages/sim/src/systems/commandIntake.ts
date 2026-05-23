import type { ShipStats } from "@drop-ship/content";
import { sameHandle, type CommandSource } from "@drop-ship/protocol";
import { deterministicCos, deterministicSin, SIM_TAU } from "../deterministicMath";
import { findPrngStream, nextFloat01 } from "../prng";
import { readUnitShipStats } from "../shipStats";
import {
  appendUnitOrder,
  getUnitsInStableOrder,
  replaceUnitOrder,
  yawRotation,
  type SimSystem,
} from "../world";

export const CommandIntakeSystem: SimSystem = {
  name: "CommandIntakeSystem",
  run(world) {
    const commands = world.commandBatch?.commands ?? [];
    const commandPrng = findPrngStream(world.prngStreams, "command");
    const shipStats = new Map<number | string, ShipStats>();

    for (const scheduled of commands) {
      const source: CommandSource = scheduled.source ?? "player";
      const metadata = {
        source,
        issuedTick: world.tick,
      };

      if (scheduled.command.type === "randomTurnOwnedUnits") {
        for (const unit of getUnitsInStableOrder(world)) {
          if (unit.owner !== scheduled.playerId) {
            continue;
          }

          if (source === "player") {
            unit.lastPlayerOrderTick = world.tick;
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

          replaceUnitOrder(
            unit,
            {
              type: "moveTo",
              target: {
                x: scheduled.command.target.x,
                y: scheduled.command.target.y,
                z: scheduled.command.target.z,
              },
            },
            metadata
          );
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

          if (scheduled.command.queueMode === "append") {
            appendUnitOrder(unit, scheduled.command.order, metadata);
          } else {
            replaceUnitOrder(unit, scheduled.command.order, metadata);
          }
        }
      }
    }
  },
};
