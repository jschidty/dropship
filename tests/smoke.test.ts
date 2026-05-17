import assert from "node:assert/strict";
import { DEFAULT_CONTENT_REGISTRY } from "../packages/content/src/index";
import {
  createEmptyCommandBatch,
  createMinimalSkirmishConfig,
  type CatchupMessage,
  type CommandBatch,
  type MatchConfig,
  type PlayerId,
} from "../packages/protocol/src/index";
import {
  SNAPSHOT_WARN_BYTES,
  createCommandLogStore,
  createMatchCoordinator,
} from "../packages/server/src/index";
import {
  createWorld,
  deterministicAtan2,
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  computePlanetGravityVector,
  hashWorld,
  hydrateWorldFromSnapshot,
  runTick,
  serializeWorld,
} from "../packages/sim/src/index";

await testCommandSchedulingAndCatchup();
testDeterministicMathReferenceValues();
testPlanetGravityVector();
testDefaultSteeringMovesUnits();
testMoveOrderInfluencesSteering();
testDeterministicReplayHash();
testSnapshotRoundTrip();
testSnapshotSizeBudget();

console.log("Smoke tests passed");

async function testCommandSchedulingAndCatchup(): Promise<void> {
  const storage = createMemoryStorage();
  const commandLogStore = createCommandLogStore(storage);
  const coordinator = createMatchCoordinator({
    commandLeadTicks: 2,
    commandLogStore,
  });
  const ack = await coordinator.receive({
    type: "command",
    playerId: 1,
    clientSeq: 7,
    localTick: 0,
    command: {
      type: "randomTurnOwnedUnits",
    },
  });

  assert.deepEqual(ack, {
    type: "commandAck",
    clientSeq: 7,
    executeTick: 2,
  });

  await commandLogStore.record(coordinator.nextTick());
  await commandLogStore.record(coordinator.nextTick());
  const commandBatch = coordinator.nextTick();
  await commandLogStore.record(commandBatch);

  assert.equal(commandBatch.tick, 2);
  assert.equal(commandBatch.commands.length, 1);

  const reloadedLog = createCommandLogStore(storage);
  const persisted = await reloadedLog.readRange(0, 3);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].tick, 2);

  const catchup = await coordinator.receive({
    type: "reconnect",
    playerId: 1,
    lastTick: 0,
  });

  assert.ok(isCatchupMessage(catchup));
  assert.equal(catchup.serverTick, 3);
  assert.equal(catchup.commands.length, 1);
  assert.equal(catchup.commands[0].tick, 2);
}

function testDeterministicMathReferenceValues(): void {
  assert.equal(deterministicSin(0), 0);
  assert.equal(deterministicSin(Math.PI / 2), 1);
  assert.equal(deterministicCos(0), 1);
  assert.equal(deterministicAtan2(1, 0), Math.PI / 2);
  assert.equal(deterministicSqrt(9), 3);
}

function testPlanetGravityVector(): void {
  const planet = {
    position: {
      x: 0,
      y: 0,
      z: 0,
    },
    mass: 7_200_000_000,
    radius: 28,
  };
  const near = computePlanetGravityVector(
    {
      x: 80,
      y: 0,
      z: 0,
    },
    [planet]
  );
  const far = computePlanetGravityVector(
    {
      x: 180,
      y: 0,
      z: 0,
    },
    [planet]
  );
  const noPlanets = computePlanetGravityVector(
    {
      x: 80,
      y: 0,
      z: 0,
    },
    []
  );
  const reusableTarget = { x: 99, y: 99, z: 99 };
  const reused = computePlanetGravityVector(
    {
      x: 80,
      y: 0,
      z: 0,
    },
    [planet],
    reusableTarget
  );

  assert.ok(near.x < 0);
  assert.ok(Math.abs(near.x) > Math.abs(far.x));
  assert.deepEqual(noPlanets, { x: 0, y: 0, z: 0 });
  assert.equal(reused, reusableTarget);
}

function testDeterministicReplayHash(): void {
  const first = replayFixedBatches();
  const second = replayFixedBatches();

  assert.equal(first, second);
  assert.equal(first, "fbcee6c3");
}

function testDefaultSteeringMovesUnits(): void {
  const world = createWorld({
    config: createMinimalSkirmishConfig(),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const startPositions = new Map(
    world.units.map((unit) => [unit.handle.id, unit.position])
  );

  runBatches(world, [], 30);

  for (const unit of world.units) {
    const start = startPositions.get(unit.handle.id);

    assert.ok(start);
    assert.ok(
      distance(unit.position, start) > 0.5,
      "Expected default steering to keep every unit in motion"
    );
  }
}

function testMoveOrderInfluencesSteering(): void {
  const world = createWorld({
    config: createMinimalSkirmishConfig(),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const unit = world.units.find((entry) => entry.owner === 1);

  assert.ok(unit);

  const target = {
    x: unit.position.x + 40,
    y: unit.position.y,
    z: unit.position.z,
  };
  const initialDistance = distance(unit.position, target);

  runBatches(
    world,
    [
      {
        tick: 0,
        commands: [
          {
            playerId: 1,
            clientSeq: 99,
            command: {
              type: "moveUnits",
              unitHandles: [unit.handle],
              target,
            },
          },
        ],
      },
    ],
    20
  );

  assert.ok(
    distance(unit.position, target) < initialDistance,
    "Expected move command intent to pull the selected unit toward its target"
  );
}

function testSnapshotRoundTrip(): void {
  const config = createMinimalSkirmishConfig();
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });

  runBatches(world, createReplayBatches(world));

  const snapshot = serializeWorld(world);
  const hydrated = hydrateWorldFromSnapshot(snapshot, DEFAULT_CONTENT_REGISTRY);

  assert.equal(hashWorld(hydrated), hashWorld(world));

  runTick(world, createEmptyCommandBatch(world.tick));
  runTick(hydrated, createEmptyCommandBatch(hydrated.tick));

  assert.equal(hashWorld(hydrated), hashWorld(world));
}

function testSnapshotSizeBudget(): void {
  const config = createBudgetConfig(1_000);
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const snapshot = serializeWorld(world);
  const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

  assert.ok(
    byteLength < SNAPSHOT_WARN_BYTES,
    `Expected 1,000-unit snapshot under ${SNAPSHOT_WARN_BYTES} bytes, got ${byteLength}`
  );
}

function replayFixedBatches(): string {
  const config = createMinimalSkirmishConfig();
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });

  runBatches(world, createReplayBatches(world));

  return hashWorld(world);
}

function createReplayBatches(
  world: ReturnType<typeof createWorld>
): readonly CommandBatch[] {
  const firstPlayerHandle = world.units.find((unit) => unit.owner === 1)?.handle;

  assert.ok(firstPlayerHandle);

  return [
    {
      tick: 0,
      commands: [
        {
          playerId: 1,
          clientSeq: 1,
          command: {
            type: "randomTurnOwnedUnits",
          },
        },
      ],
    },
    {
      tick: 4,
      commands: [
        {
          playerId: 1,
          clientSeq: 2,
          command: {
            type: "moveUnits",
            unitHandles: [firstPlayerHandle],
            target: {
              x: -90,
              y: 0,
              z: -20,
            },
          },
        },
      ],
    },
  ];
}

function runBatches(
  world: ReturnType<typeof createWorld>,
  batches: readonly CommandBatch[],
  untilTick = 24
): void {
  const byTick = new Map(batches.map((batch) => [batch.tick, batch]));

  while (world.tick < untilTick) {
    runTick(world, byTick.get(world.tick) ?? createEmptyCommandBatch(world.tick));
  }
}

function createBudgetConfig(unitCount: number): MatchConfig {
  const config = createMinimalSkirmishConfig();
  const initialUnits = [...config.initialUnits];
  const templateId = initialUnits[0]?.templateId ?? 1;

  for (let index = initialUnits.length; index < unitCount; index += 1) {
    const owner: PlayerId = index % 2 === 0 ? 1 : 2;
    const angle = index * 2.399963229728653;
    const radius = 48 + Math.floor(index / 64) * 4;

    initialUnits.push({
      owner,
      templateId,
      position: {
        x: Math.cos(angle) * radius,
        y: ((index % 11) - 5) * 0.8,
        z: -60 + Math.sin(angle) * radius,
      },
    });
  }

  return {
    ...config,
    matchId: `${config.matchId}-budget-${unitCount}`,
    initialUnits,
  };
}

function createMemoryStorage(): DurableObjectStorage {
  const values = new Map<string, unknown>();

  return {
    async get<T = unknown>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T = unknown>(key: string, value: T) {
      values.set(key, value);
    },
    async list<T = unknown>(options?: DurableObjectStorageListOptions) {
      const entries = [...values.entries()].filter(([key]) =>
        options?.prefix ? key.startsWith(options.prefix) : true
      );

      return new Map(entries) as Map<string, T>;
    },
  };
}

function distance(
  a: Readonly<{ x: number; y: number; z: number }>,
  b: Readonly<{ x: number; y: number; z: number }>
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isCatchupMessage(value: unknown): value is CatchupMessage {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "catchup"
  );
}
