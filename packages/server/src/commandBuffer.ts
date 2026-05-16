import {
  createEmptyCommandBatch,
  type CommandAckMessage,
  type CommandBatch,
  type CommandMessage,
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
        commands: commands
          .slice()
          .sort((a, b) =>
            a.playerId === b.playerId
              ? a.clientSeq - b.clientSeq
              : a.playerId - b.playerId
          ),
      };
    },
    peekScheduledTicks() {
      return [...scheduled.keys()].sort((a, b) => a - b);
    },
  };
}
