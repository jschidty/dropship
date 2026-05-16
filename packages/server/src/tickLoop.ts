import type { CommandBatch } from "@drop-ship/protocol";

export type TickLoop = Readonly<{
  currentTick: () => number;
  nextBatch: () => CommandBatch;
}>;

export function createTickLoop(options: {
  initialTick?: number;
  takeBatch: (tick: number) => CommandBatch;
}): TickLoop {
  let tick = options.initialTick ?? 0;

  return {
    currentTick() {
      return tick;
    },
    nextBatch() {
      const batch = options.takeBatch(tick);
      tick += 1;
      return batch;
    },
  };
}
