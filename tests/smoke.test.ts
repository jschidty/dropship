import assert from "node:assert/strict";
import { DEFAULT_CONTENT_REGISTRY } from "../packages/content/src/index";
import {
  DEFAULT_CAPTURE_DEMO_RULES,
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  createEmptyCommandBatch,
  createCaptureDemoConfig,
  createMinimalSkirmishConfig,
  sameHandle,
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
import { selectMoveOrderUnits } from "../packages/client/src/selection/commands";
import type { UnitViewModel } from "../packages/client/src/index";

await testCommandSchedulingAndCatchup();
testDeterministicMathReferenceValues();
testSeededMatchGeneration();
testPlanetaryOrbitMotion();
testPlanetGravityVector();
testDefaultSteeringMovesUnits();
testMoveOrderInfluencesSteering();
testMoveOrderTargetsEscortLeader();
testEscortOrderCommand();
testOrbitPlanetOrderFacesAwayFromGravity();
testCaptureDemoConfig();
testShipsSpawnOutsidePlanets();
testPlanetCollisionKeepsShipsOutside();
testDropShipCapturesPlanet();
testDropShipSpawnsFighters();
testSpawnedFightersEscortParentDropShip();
testDropShipEliminationEndsMatch();
testNpcDefenderIssuesAttackOrders();
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

function testSeededMatchGeneration(): void {
  const first = createMinimalSkirmishConfig({ seed: 4242 });
  const second = createMinimalSkirmishConfig({ seed: 4242 });
  const moonsByParent = new Map<number, number>();
  const moonCount = first.initialPlanets.filter(
    (planet) => planet.parentPlanetIndex !== null
  ).length;
  const planetClasses = new Set<string>();

  assert.deepEqual(first.initialPlanets, second.initialPlanets);
  assert.deepEqual(first.environment, second.environment);
  assert.ok(Number.isFinite(first.environment.sun.orbitCenter.x));
  assert.ok(first.initialPlanets.length >= 1);
  assert.ok(first.initialPlanets.length <= 4);
  assert.ok(moonCount >= 1);
  assert.ok(moonCount <= 3);
  const ringedPlanets = first.initialPlanets.filter(
    (planet) => planet.appearance.hasRings
  );
  assert.equal(ringedPlanets.length, 1);
  assert.equal(ringedPlanets[0]?.parentPlanetIndex, null);

  for (const planet of first.initialPlanets) {
    assert.match(planet.color, /^#[0-9a-f]{6}$/);
    assert.ok(
      ["gas-giant", "terran", "ice"].includes(planet.appearance.planetClass)
    );
    assert.equal(typeof planet.appearance.hasRings, "boolean");
    assert.ok(Number.isFinite(planet.appearance.seed));
    planetClasses.add(planet.appearance.planetClass);
    assert.ok(planet.radius > 0);
    assert.ok(planet.mass > 0);
    assert.ok(planet.orbit.radius > 0);
    assert.notEqual(planet.orbit.angularSpeed, 0);

    if (planet.parentPlanetIndex !== null) {
      assert.equal(planet.hasAtmosphere, false);
      assert.notEqual(planet.appearance.planetClass, "gas-giant");
      moonsByParent.set(
        planet.parentPlanetIndex,
        (moonsByParent.get(planet.parentPlanetIndex) ?? 0) + 1
      );
    }
  }

  assert.ok(planetClasses.size >= 1);

  for (const count of moonsByParent.values()) {
    assert.ok(count <= 2);
  }
}

function testPlanetaryOrbitMotion(): void {
  const config = findConfigWithMoon();
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const planet = world.planets.find((entry) => entry.parentPlanetIndex === null);
  const moon = world.planets.find((entry) => entry.parentPlanetIndex !== null);

  assert.ok(planet);
  assert.ok(moon);
  assert.ok(moon.parentPlanetIndex !== null);

  const initialPlanetPosition = planet.position;

  runBatches(world, [], 45);

  const updatedParent = world.planets[moon.parentPlanetIndex];

  assert.ok(updatedParent);
  assert.ok(distance(planet.position, initialPlanetPosition) > 0.05);
  assert.ok(
    Math.abs(distance(moon.position, updatedParent.position) - moon.orbit.radius) <
      0.5,
    "Expected moon orbit to preserve its seeded parent-relative radius"
  );
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
  assert.equal(first, "fbd8ad16");
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

function testEscortOrderCommand(): void {
  const world = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const playerUnits = world.units.filter((unit) => unit.owner === 1);
  const leader = playerUnits[0];
  const escort = playerUnits[1];

  assert.ok(leader);
  assert.ok(escort);

  runTick(world, {
    tick: 0,
    commands: [
      {
        playerId: 1,
        clientSeq: 42,
        command: {
          type: "issueUnitOrder",
          unitHandles: [escort.handle],
          order: {
            type: "escort",
            target: leader.handle,
          },
          queueMode: "replace",
        },
      },
    ],
  });

  assert.equal(escort.moveOrder?.type, "escort");
  assert.ok(
    escort.moveOrder?.type === "escort" &&
      sameHandle(escort.moveOrder.target, leader.handle)
  );
}

function testOrbitPlanetOrderFacesAwayFromGravity(): void {
  const world = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const unit = world.units.find((entry) => entry.owner === 1);
  const planet =
    world.planets.find((entry) => entry.control.capturable) ??
    world.planets[0];

  assert.ok(unit);
  assert.ok(planet);

  runBatches(
    world,
    [
      {
        tick: 0,
        commands: [
          {
            playerId: 1,
            clientSeq: 43,
            command: {
              type: "issueUnitOrder",
              unitHandles: [unit.handle],
              order: {
                type: "orbitPlanet",
                planet: planet.handle,
              },
              queueMode: "replace",
            },
          },
        ],
      },
    ],
    8
  );

  assert.equal(unit.moveOrder?.type, "orbitPlanet");

  const yaw = Math.atan2(unit.rotation.y, unit.rotation.w) * 2;
  const outwardX = unit.position.x - planet.position.x;
  const outwardZ = unit.position.z - planet.position.z;
  const outwardLength = Math.hypot(outwardX, outwardZ);
  const outwardDot =
    (Math.sin(yaw) * outwardX + Math.cos(yaw) * outwardZ) /
    Math.max(outwardLength, 1);

  assert.ok(
    outwardDot > 0.99,
    "Expected orbit command to orient the ship away from planet gravity"
  );
}

function testMoveOrderTargetsEscortLeader(): void {
  const leader = createTestUnitView("leader", 1, 1);
  const escort = createTestUnitView("escort", 1, 2);
  const enemy = createTestUnitView("enemy", 2, 3);
  const units = [leader, escort, enemy];
  const selectedUnitKeys = new Set(["leader", "escort", "enemy"]);

  assert.deepEqual(
    selectMoveOrderUnits(units, 1, selectedUnitKeys, "leader").map(
      (unit) => unit.key
    ),
    ["leader"]
  );
  assert.deepEqual(
    selectMoveOrderUnits(units, 1, selectedUnitKeys, null).map(
      (unit) => unit.key
    ),
    ["leader", "escort"]
  );
  assert.deepEqual(
    selectMoveOrderUnits(units, 1, selectedUnitKeys, "enemy").map(
      (unit) => unit.key
    ),
    ["leader", "escort"]
  );
}

function testCaptureDemoConfig(): void {
  const config = createCaptureDemoConfig({ seed: 1337 });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });

  assert.equal(config.gameMode, "captureDemo");
  assert.ok(world.units.some((unit) => unit.shipClassId === SHIP_CLASS_IDS.dropShip));
  assert.equal(
    world.units.filter(
      (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
    ).length,
    1
  );
  assert.ok(world.units.some((unit) => unit.shipClassId === SHIP_CLASS_IDS.battleship));
  assert.ok(world.planets.some((planet) => planet.control.capturable));
}

function testShipsSpawnOutsidePlanets(): void {
  const world = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });

  assertUnitsOutsidePlanets(world);
}

function testPlanetCollisionKeepsShipsOutside(): void {
  const world = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const planet = world.planets.find((entry) => entry.control.capturable);
  const unit = world.units[0];

  assert.ok(planet);
  assert.ok(unit);

  unit.position = {
    x: planet.position.x,
    y: planet.position.y,
    z: planet.position.z,
  };
  unit.prevPosition = unit.position;
  unit.velocity = { x: -10, y: 0, z: 0 };

  runTick(world, createEmptyCommandBatch(world.tick));

  assertUnitsOutsidePlanets(world);
}

function testDropShipCapturesPlanet(): void {
  const config = {
    ...createCaptureDemoConfig({ seed: 1337 }),
    captureDemoRules: {
      ...DEFAULT_CAPTURE_DEMO_RULES,
      planetCaptureSeconds: 1,
      fighterSpawnIntervalTicks: 10_000,
    },
  };
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const planet = world.planets.find((entry) => entry.control.capturable);
  const dropShip = world.units.find(
    (entry) => entry.owner === 1 && entry.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(planet);
  assert.ok(dropShip);

  dropShip.position = {
    x: planet.position.x + planet.radius * 2.25,
    y: planet.position.y,
    z: planet.position.z,
  };
  dropShip.prevPosition = dropShip.position;
  dropShip.velocity = { x: 0, y: 0, z: 0 };
  dropShip.moveOrder = {
    type: "capturePlanet",
    planet: planet.handle,
  };

  runBatches(world, [], PHASE_ONE_SIM_HZ + 2);

  assert.equal(planet.control.owner, 1);
}

function testDropShipSpawnsFighters(): void {
  const config = {
    ...createCaptureDemoConfig({ seed: 1337 }),
    captureDemoRules: {
      ...DEFAULT_CAPTURE_DEMO_RULES,
      fighterSpawnIntervalTicks: 2,
      fighterSpawnCapPerDropShip: 2,
    },
  };
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const initialFighters = world.units.filter(
    (unit) => unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.fighter
  ).length;

  runBatches(world, [], 8);

  const spawnedFighters = world.units.filter(
    (unit) => unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.fighter
  ).length - initialFighters;

  assert.equal(spawnedFighters, 2);
}

function testSpawnedFightersEscortParentDropShip(): void {
  const config = {
    ...createCaptureDemoConfig({ seed: 1337 }),
    captureDemoRules: {
      ...DEFAULT_CAPTURE_DEMO_RULES,
      fighterSpawnIntervalTicks: 2,
      fighterSpawnCapPerDropShip: 1,
    },
  };
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const dropShip = world.units.find(
    (unit) => unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(dropShip);

  runBatches(world, [], 4);

  const spawnedFighterHandle = dropShip.fighterSpawn?.spawnedFighters[0];

  assert.ok(spawnedFighterHandle);

  const spawnedFighter = world.units.find((unit) =>
    sameHandle(unit.handle, spawnedFighterHandle)
  );

  assert.ok(spawnedFighter);
  assert.equal(spawnedFighter.moveOrder?.type, "escort");
  assert.ok(
    spawnedFighter.moveOrder?.type === "escort" &&
      sameHandle(spawnedFighter.moveOrder.target, dropShip.handle)
  );
}

function testDropShipEliminationEndsMatch(): void {
  const playerOneLost = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });

  for (const unit of playerOneLost.units) {
    if (unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
      unit.health.current = 0;
    }
  }

  runBatches(playerOneLost, [], 1);

  assert.equal(playerOneLost.matchResult?.winner, 2);
  assert.equal(playerOneLost.matchResult?.reason, "dropShipsDestroyed");

  const playerTwoLost = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });

  for (const unit of playerTwoLost.units) {
    if (unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
      unit.health.current = 0;
    }
  }

  runBatches(playerTwoLost, [], 1);

  assert.equal(playerTwoLost.matchResult?.winner, 1);
  assert.equal(playerTwoLost.matchResult?.reason, "dropShipsDestroyed");
}

function testNpcDefenderIssuesAttackOrders(): void {
  const config = {
    ...createCaptureDemoConfig({ seed: 1337 }),
    captureDemoRules: {
      ...DEFAULT_CAPTURE_DEMO_RULES,
      npcAggroRange: 1_000,
      fighterSpawnIntervalTicks: 10_000,
    },
  };
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });

  runBatches(world, [], 2);

  const defender = world.units.find((unit) => unit.owner === 2);

  assert.ok(defender);
  assert.equal(defender.moveOrder?.type, "attackTarget");
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

function findConfigWithMoon(): MatchConfig {
  for (let seed = 0; seed < 64; seed += 1) {
    const config = createMinimalSkirmishConfig({ seed });

    if (
      config.initialPlanets.some(
        (planet) => planet.parentPlanetIndex !== null
      )
    ) {
      return config;
    }
  }

  throw new Error("Expected at least one moon in the first 64 seeded matches");
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

function createTestUnitView(
  key: string,
  owner: PlayerId,
  id: number
): UnitViewModel {
  return {
    handle: {
      id,
      generation: 1,
    },
    key,
    owner,
  } as UnitViewModel;
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

function assertUnitsOutsidePlanets(world: ReturnType<typeof createWorld>): void {
  for (const unit of world.units) {
    const stats = world.content.getUnitTemplate(unit.templateId).stats;

    for (const planet of world.planets) {
      assert.ok(
        distance(unit.position, planet.position) >=
          planet.radius + stats.colliderRadius,
        `Expected unit ${unit.handle.id} outside planet ${planet.handle.id}`
      );
    }
  }
}

function isCatchupMessage(value: unknown): value is CatchupMessage {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "catchup"
  );
}
