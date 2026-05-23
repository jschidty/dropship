import {
  compareScheduledCommands,
  createEmptyCommandBatch,
  type CommandAckMessage,
  type CommandBatch,
  type CommandMessage,
  type ClientCommandSource,
  type ScheduledCommand,
} from "@drop-ship/protocol";

export type CommandBuffer = {
  schedule: (executeTick: number, message: CommandMessage) => CommandAckMessage;
  takeBatch: (tick: number) => CommandBatch;
  peekScheduledTicks: () => readonly number[];
};

export function createCommandBuffer(): CommandBuffer {
  const scheduled = new Map<number, ScheduledCommand[]>();

  return {
    schedule(executeTick, message) {
      const commands = scheduled.get(executeTick) ?? [];
      commands.push({
        playerId: message.playerId,
        clientSeq: message.clientSeq,
        source: readScheduledCommandSource(message),
        command: message.command,
      });
      scheduled.set(executeTick, commands);

      return {
        type: "commandAck",
        clientSeq: message.clientSeq,
        executeTick,
      };
    },
    takeBatch(tick) {
      const commands = scheduled.get(tick);
      scheduled.delete(tick);

      if (!commands) {
        return createEmptyCommandBatch(tick);
      }

      return {
        tick,
        commands: sortScheduledCommands(commands),
      };
    },
    peekScheduledTicks() {
      return [...scheduled.keys()].sort((a, b) => a - b);
    },
  };
}

function readScheduledCommandSource(message: CommandMessage): ClientCommandSource {
  return message.source === "autonomy" ? "autonomy" : "player";
}

function sortScheduledCommands(
  commands: readonly ScheduledCommand[]
): readonly ScheduledCommand[] {
  return commands.slice().sort(compareScheduledCommands);
}
