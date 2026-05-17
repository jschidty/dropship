import type { CommandBatch } from "@drop-ship/protocol";

const COMMAND_BATCH_PREFIX = "commandBatch:";

export type CommandLogStore = {
  record: (batch: CommandBatch) => Promise<void>;
  readRange: (
    startTick: number,
    endTickExclusive: number
  ) => Promise<readonly CommandBatch[]>;
  list: () => Promise<readonly CommandBatch[]>;
};

export function createCommandLogStore(
  storage?: DurableObjectStorage
): CommandLogStore {
  let loaded = false;
  const batches = new Map<number, CommandBatch>();

  async function load(): Promise<void> {
    if (loaded) {
      return;
    }

    loaded = true;

    if (!storage) {
      return;
    }

    const stored = await storage.list<CommandBatch>({
      prefix: COMMAND_BATCH_PREFIX,
    });

    for (const batch of stored.values()) {
      batches.set(batch.tick, batch);
    }
  }

  return {
    async record(batch) {
      await load();

      if (batch.commands.length === 0) {
        return;
      }

      batches.set(batch.tick, batch);
      await storage?.put(commandBatchKey(batch.tick), batch);
    },
    async readRange(startTick, endTickExclusive) {
      await load();

      return [...batches.values()]
        .filter(
          (batch) => batch.tick >= startTick && batch.tick < endTickExclusive
        )
        .sort((a, b) => a.tick - b.tick);
    },
    async list() {
      await load();

      return [...batches.values()].sort((a, b) => a.tick - b.tick);
    },
  };
}

function commandBatchKey(tick: number): string {
  return `${COMMAND_BATCH_PREFIX}${tick.toString().padStart(10, "0")}`;
}
