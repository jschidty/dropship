import {
  PHASE_ONE_SIM_HZ,
  createEmptyCommandBatch,
  type CommandBatch,
} from "@drop-ship/protocol";
import { PHASE_ONE_SYSTEMS } from "./systems";
import {
  capturePrevPositions,
  installSystems,
  type SimWorld,
} from "./world";

export const SIM_TICK_RATE = PHASE_ONE_SIM_HZ;
export const SIM_DT_MS = 1000 / SIM_TICK_RATE;
export { SIM_DT_SECONDS } from "./steering";
export * from "./systems";

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
