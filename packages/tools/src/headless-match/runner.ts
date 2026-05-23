import {
  DEFAULT_CONTENT_REGISTRY,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  createScriptedNpcController,
  type CommandController,
} from "@drop-ship/controllers";
import {
  compareScheduledCommands,
  createEmptyCommandBatch,
  type CommandBatch,
  type MatchConfig,
  type ReplayFile,
  type ReplayHash,
  type ScheduledCommand,
} from "@drop-ship/protocol";
import {
  createWorld,
  hashWorld,
  runTick,
  type SimEvent,
  type SimWorld,
} from "@drop-ship/sim";
import {
  createHeadlessMatchMetricsDraft,
  finalizeHeadlessMatchMetrics,
  recordHeadlessMatchStep,
  type HeadlessMatchMetrics,
  type HeadlessMatchMetricsDraft,
} from "./metrics";
import { createHeadlessReplayFile } from "./replay";

export type HeadlessMatchController = CommandController;

export type HeadlessMatchRunnerOptions = Readonly<{
  config: MatchConfig;
  content?: ContentRegistry;
  controllers?: readonly HeadlessMatchController[];
  maxTicks?: number;
  hashIntervalTicks?: number;
  recordEmptyBatches?: boolean;
}>;

export type HeadlessMatchResetOptions = Readonly<{
  config?: MatchConfig;
  content?: ContentRegistry;
}>;

export type HeadlessMatchStepOptions = Readonly<{
  commands?: readonly ScheduledCommand[];
}>;

export type HeadlessMatchRunOptions = Readonly<{
  commandBatches?: readonly CommandBatch[];
  maxTicks?: number;
}>;

export type HeadlessMatchStepResult = Readonly<{
  tick: number;
  batch: CommandBatch;
  events: readonly SimEvent[];
  hash: ReplayHash | null;
  done: boolean;
}>;

export type HeadlessMatchRunResult = Readonly<{
  world: SimWorld;
  commandBatches: readonly CommandBatch[];
  hashes: readonly ReplayHash[];
  metrics: HeadlessMatchMetrics;
  finalHash: string;
  replay: ReplayFile;
}>;

export type HeadlessMatchRunner = Readonly<{
  world: SimWorld;
  reset: (options?: HeadlessMatchResetOptions) => SimWorld;
  step: (options?: HeadlessMatchStepOptions) => HeadlessMatchStepResult;
  run: (options?: HeadlessMatchRunOptions) => HeadlessMatchRunResult;
  readCommandBatches: () => readonly CommandBatch[];
  readHashes: () => readonly ReplayHash[];
  readMetrics: () => HeadlessMatchMetrics;
  readReplay: () => ReplayFile;
}>;

export function createHeadlessMatchRunner(
  options: HeadlessMatchRunnerOptions
): HeadlessMatchRunner {
  let config = options.config;
  let content = options.content ?? DEFAULT_CONTENT_REGISTRY;
  let world = createWorld({ config, content });
  let metrics = createHeadlessMatchMetricsDraft(world);
  const commandBatches: CommandBatch[] = [];
  const hashes: ReplayHash[] = [];
  const controllers = options.controllers ?? [createScriptedNpcController()];
  const hashIntervalTicks = options.hashIntervalTicks ?? 30;
  const recordEmptyBatches = options.recordEmptyBatches ?? false;

  resetControllers(controllers, world);

  const runner: HeadlessMatchRunner = {
    get world() {
      return world;
    },
    reset(resetOptions = {}) {
      config = resetOptions.config ?? config;
      content = resetOptions.content ?? content;
      world = createWorld({ config, content });
      metrics = createHeadlessMatchMetricsDraft(world);
      commandBatches.splice(0);
      hashes.splice(0);
      resetControllers(controllers, world);
      return world;
    },
    step(stepOptions = {}) {
      if (world.matchResult) {
        return {
          tick: world.tick,
          batch: createEmptyCommandBatch(world.tick),
          events: [],
          hash: null,
          done: true,
        };
      }

      const batch = createBatchForTick(
        world,
        collectScheduledCommands(world, controllers, stepOptions.commands ?? [])
      );
      const executedTick = world.tick;

      runTick(world, batch);

      const events = world.events.slice();
      const hash =
        hashIntervalTicks > 0 && world.tick % hashIntervalTicks === 0
          ? {
              tick: world.tick,
              hash: hashWorld(world),
            }
          : null;

      if (recordEmptyBatches || batch.commands.length > 0) {
        commandBatches.push(batch);
      }

      if (hash) {
        hashes.push(hash);
      }

      recordHeadlessMatchStep(metrics, batch, events, hash);

      return {
        tick: executedTick,
        batch,
        events,
        hash,
        done: world.matchResult !== null,
      };
    },
    run(runOptions = {}) {
      const maxTicks =
        runOptions.maxTicks ??
        options.maxTicks ??
        config.rules.matchEnd.durationTicks;
      const commandsByTick = collectCommandBatchesByTick(
        runOptions.commandBatches ?? []
      );

      while (!world.matchResult && world.tick < maxTicks) {
        const commands = commandsByTick.get(world.tick) ?? [];
        runner.step({ commands });
      }

      return createRunResult(config, world, commandBatches, hashes, metrics);
    },
    readCommandBatches() {
      return commandBatches.slice();
    },
    readHashes() {
      return hashes.slice();
    },
    readMetrics() {
      return finalizeHeadlessMatchMetrics(metrics, world, hashWorld(world));
    },
    readReplay() {
      return createHeadlessReplayFile({
        match: config,
        commandBatches,
        expectedHashes: hashes,
      });
    },
  };

  return runner;
}

function collectScheduledCommands(
  world: SimWorld,
  controllers: readonly HeadlessMatchController[],
  commands: readonly ScheduledCommand[]
): readonly ScheduledCommand[] {
  const collected: ScheduledCommand[] = [...commands];

  for (const controller of controllers) {
    collected.push(...controller.commandsForTick(world));
  }

  return collected;
}

function createBatchForTick(
  world: SimWorld,
  commands: readonly ScheduledCommand[]
): CommandBatch {
  if (commands.length === 0) {
    return createEmptyCommandBatch(world.tick);
  }

  return {
    tick: world.tick,
    commands: sortScheduledCommands(commands),
  };
}

function sortScheduledCommands(
  commands: readonly ScheduledCommand[]
): readonly ScheduledCommand[] {
  return commands.slice().sort(compareScheduledCommands);
}

function collectCommandBatchesByTick(
  batches: readonly CommandBatch[]
): ReadonlyMap<number, readonly ScheduledCommand[]> {
  const byTick = new Map<number, ScheduledCommand[]>();

  for (const batch of batches) {
    const commands = byTick.get(batch.tick) ?? [];
    commands.push(...batch.commands);
    byTick.set(batch.tick, commands);
  }

  return byTick;
}

function createRunResult(
  match: MatchConfig,
  world: SimWorld,
  commandBatches: readonly CommandBatch[],
  hashes: readonly ReplayHash[],
  metrics: HeadlessMatchMetricsDraft
): HeadlessMatchRunResult {
  const finalHash = hashWorld(world);

  return {
    world,
    commandBatches: commandBatches.slice(),
    hashes: hashes.slice(),
    metrics: finalizeHeadlessMatchMetrics(metrics, world, finalHash),
    finalHash,
    replay: createHeadlessReplayFile({
      match,
      commandBatches,
      expectedHashes: hashes,
    }),
  };
}

function resetControllers(
  controllers: readonly HeadlessMatchController[],
  world: SimWorld
): void {
  for (const controller of controllers) {
    controller.reset?.(world);
  }
}
