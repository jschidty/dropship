import assert from "node:assert/strict";
import { createScriptedNpcController } from "../packages/controllers/src/index";
import {
  DEFAULT_CONTENT_HASH,
  DEFAULT_CONTENT_REGISTRY,
  SHIP_COMPONENT_IDS,
  TEMPLATE_IDS,
  validateContentRegistry,
} from "../packages/content/src/index";
import {
  DEFAULT_CAPTURE_DEMO_RULES,
  DEFAULT_SIM_TUNING,
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
  assignMatchSession,
  createCommandLogStore,
  createMatchCoordinator,
  createMatchEndStore,
  createSnapshotStore,
  handleRequest,
  readOrCreateStoredMatchConfig,
} from "../packages/server/src/index";
import {
  createWorld,
  deterministicAtan2,
  deterministicCos,
  deterministicSin,
  deterministicSqrt,
  computeOrbitVelocityAroundPlanet,
  computePlanetGravityVector,
  hashWorld,
  hydrateWorldFromSnapshot,
  readUnitShipStats,
  readUnitWeaponProfile,
  runTick,
  serializeWorld,
} from "../packages/sim/src/index";
import {
  createHeadlessMatchRunner,
  type HeadlessMatchController,
} from "../packages/tools/src/index";
import { createMinimalLocalGame } from "../packages/client/src/runtime/localGame";
import {
  selectClassHotkeyUnitKeys,
  selectMoveOrderUnits,
} from "../packages/client/src/selection/commands";
import {
  selectPrimarySceneSelectionCandidate,
  type SceneSelectionCandidate,
} from "../packages/client/src/selection/interactions";
import {
  rankAttackTargetCandidates,
  selectNextAttackTargetKey,
} from "../packages/client/src/selection/targeting";
import type { UnitViewModel } from "../packages/client/src/index";

await testCommandSchedulingAndCatchup();
await testWorkerCreatesGameId();
await testWorkerFallsBackToAppShellForPlayRoutes();
testMatchSessionRoleAssignment();
await testStoredMatchConfigPersistsResolvedConfig();
await testMatchEndAgreementPersistsAndBroadcasts();
await testMatchEndConflictAndTrustedFinalization();
await testSnapshotStoreDeletesPrunedRows();
testDefaultContentRegistryLoadsRawTemplates();
testDeterministicMathReferenceValues();
testSeededMatchGeneration();
testPlanetaryOrbitMotion();
testPlanetGravityVector();
testDefaultSteeringMovesUnits();
testMoveOrderInfluencesSteering();
testCloseRangeBoidSeparationPreservesFalloff();
testAppendOrderAdvancesAfterCurrentOrderCompletes();
testMoveOrderTargetsEscortLeader();
testEscortOrderCommand();
testOrbitPlanetOrderFacesAwayFromGravity();
testOrbitLaneOrderPreservesLaneSpec();
testOrbitLaneVelocityUsesLanePlaneAndDirection();
testCaptureDemoConfig();
testClassHotkeySelectionFiltersSelectedUnits();
testAttackTargetPriorityRanking();
testSceneSelectionCandidateRanking();
testShipsSpawnOutsidePlanets();
testPlanetCollisionKeepsShipsOutside();
testOrbitTrackingState();
testDropShipCapturesPlanet();
testDropShipCaptureContinuesNearInnerOrbit();
testCapturedPlanetSpawnsDropShip();
testDropShipSpawnsFighters();
testSpawnedFightersEscortParentDropShip();
testDropShipEliminationEndsMatch();
testTimerPlanetCountWinner();
testTimerUnitCountWinner();
testLocalRuntimeStopsAfterMatchEnd();
testLocalRuntimeReplayStartsFreshSeed();
testLocalRuntimeKeepsFiniteViewModels();
testLocalRuntimeViewModelsExposeOrders();
testLocalRuntimeUsesScriptedNpcController();
testNpcDefenderIssuesAttackOrders();
testNpcDropShipChoosesSafePlanetBeforeContestedPlanet();
testNpcDropShipsClaimDifferentCapturePlanets();
testNpcFightersHoldEscortWhenDropShipIsNotThreatened();
testNpcControllersCanOwnEveryPlayer();
testLegacySnapshotHydratesResolvedConfig();
testInitialLoadoutOverridesShipStats();
testInvalidInitialLoadoutSlotRejected();
testComponentStatOverridesAffectShipStats();
testInvalidComponentStatOverrideRejected();
testInvalidDerivedStatsFromComponentOverrideRejected();
testDuplicateComponentStatOverrideRejected();
testSimTuningAffectsHeadlessMotion();
testDeterministicReplayHash();
testHeadlessRunnerMatchesSmokeReplayHash();
testHeadlessControllerCommandsUseCommandBatches();
testHeadlessMetricsTracksBattleshipDamage();
testHeadlessRunnerRunsAllNpcMatch();
testNpcOrbitLaneHeuristicsIssueLaneOrders();
testHeadlessDropShipOnlyMatchCapturesPlanets();
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

async function testWorkerCreatesGameId(): Promise<void> {
  const routedGameIds: string[] = [];
  const fetchedPaths: string[] = [];
  const creatorTokens: string[] = [];
  const env = {
    MATCHES: {
      idFromName(gameId: string) {
        routedGameIds.push(gameId);
        return gameId;
      },
      get(id: DurableObjectId) {
        return {
          async fetch(request: Request) {
            fetchedPaths.push(new URL(request.url).pathname);
            creatorTokens.push(
              request.headers.get("x-drop-ship-creator-token") ?? ""
            );
            return Response.json({
              id,
            });
          },
        };
      },
    },
  };

  const response = await handleRequest(
    new Request("https://drop.test/api/matches", {
      method: "POST",
    }),
    env
  );
  const payload = (await response.json()) as {
    gameId: string;
    matchId: string;
    creatorToken: string;
  };

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(payload.gameId, /^game-/);
  assert.match(payload.creatorToken, /^game-/);
  assert.equal(payload.matchId, payload.gameId);
  assert.notEqual(payload.creatorToken, payload.gameId);
  assert.deepEqual(routedGameIds, [payload.gameId]);
  assert.deepEqual(fetchedPaths, [`/api/matches/${payload.gameId}`]);
  assert.deepEqual(creatorTokens, [payload.creatorToken]);

  const optionsResponse = await handleRequest(
    new Request("https://drop.test/api/matches", {
      method: "OPTIONS",
    }),
    env
  );

  assert.equal(optionsResponse.status, 204);
}

async function testWorkerFallsBackToAppShellForPlayRoutes(): Promise<void> {
  const fetchedPaths: string[] = [];
  const env = {
    MATCHES: {
      idFromName(gameId: string) {
        return gameId;
      },
      get(id: DurableObjectId) {
        return {
          async fetch() {
            return Response.json({ id });
          },
        };
      },
    },
    ASSETS: {
      async fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        fetchedPaths.push(pathname);

        return pathname === "/"
          ? new Response("<!doctype html>", {
              status: 200,
              headers: {
                "content-type": "text/html",
              },
            })
          : new Response("not found", { status: 404 });
      },
    },
  };

  const response = await handleRequest(
    new Request("https://drop.test/play/game-abc"),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html");
  assert.deepEqual(fetchedPaths, ["/play/game-abc", "/"]);
}

function testMatchSessionRoleAssignment(): void {
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      creatorToken: "creator",
      connectedPlayerIds: [],
    }),
    {
      seat: 1,
      playerId: 1,
      role: "player1",
      canControl: true,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      connectedPlayerIds: [],
    }),
    {
      seat: 2,
      playerId: 2,
      role: "player2",
      canControl: true,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      connectedPlayerIds: [1],
    }),
    {
      seat: 2,
      playerId: 2,
      role: "player2",
      canControl: true,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      connectedPlayerIds: [1, 2],
    }),
    {
      seat: null,
      playerId: 1,
      role: "spectator",
      canControl: false,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      newPlayerTwoToken: "p2-token",
      connectedPlayerIds: [1],
    }),
    {
      seat: 2,
      playerId: 2,
      role: "player2",
      canControl: true,
      seatToken: "p2-token",
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      storedPlayerTwoToken: "p2-token",
      playerToken: "p2-token",
      connectedPlayerIds: [1],
    }),
    {
      seat: 2,
      playerId: 2,
      role: "player2",
      canControl: true,
      seatToken: "p2-token",
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      storedPlayerTwoToken: "p2-token",
      connectedPlayerIds: [1],
    }),
    {
      seat: null,
      playerId: 1,
      role: "spectator",
      canControl: false,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      storedCreatorToken: "creator",
      creatorToken: "creator",
      connectedPlayerIds: [1],
    }),
    {
      seat: null,
      playerId: 1,
      role: "spectator",
      canControl: false,
    }
  );
  assert.deepEqual(
    assignMatchSession({
      requestedPlayerId: 1,
      connectedPlayerIds: [1],
    }),
    {
      seat: null,
      playerId: 1,
      role: "spectator",
      canControl: false,
    }
  );
}

async function testStoredMatchConfigPersistsResolvedConfig(): Promise<void> {
  const storage = createMemoryStorage();
  const first = await readOrCreateStoredMatchConfig(storage, () =>
    createCaptureDemoConfig({
      matchId: "stored-config",
      seed: 11,
    })
  );
  const second = await readOrCreateStoredMatchConfig(storage, () =>
    createCaptureDemoConfig({
      matchId: "stored-config",
      seed: 99,
    })
  );

  assert.equal(first.matchId, "stored-config");
  assert.equal(first.seed, 11);
  assert.deepEqual(second, first);
}

async function testMatchEndAgreementPersistsAndBroadcasts(): Promise<void> {
  const storage = createMemoryStorage();
  const matchEndStore = createMatchEndStore(storage);
  const coordinator = createMatchCoordinator({
    matchEndStore,
  });
  const firstReport = {
    type: "matchEndReport" as const,
    playerId: 1 as const,
    tick: 42,
    winner: 1 as const,
    reason: "timerUnits" as const,
    finalHash: "abcd1234",
  };
  const secondReport = {
    ...firstReport,
    playerId: 2 as const,
  };

  assert.equal(await coordinator.receive(firstReport), null);
  assert.deepEqual(await coordinator.receive(secondReport), {
    type: "matchEnd",
    tick: 42,
    winner: 1,
    reason: "timerUnits",
    finalHash: "abcd1234",
    source: "agreed",
    reports: [
      {
        playerId: 1,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
      {
        playerId: 2,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
    ],
  });

  const reloadedStore = createMatchEndStore(storage);

  assert.deepEqual(await reloadedStore.readFinal(), {
    type: "matchEnd",
    tick: 42,
    winner: 1,
    reason: "timerUnits",
    finalHash: "abcd1234",
    source: "agreed",
    reports: [
      {
        playerId: 1,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
      {
        playerId: 2,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
    ],
  });
  assert.deepEqual(await reloadedStore.listReports(), [
    firstReport,
    secondReport,
  ]);
}

async function testMatchEndConflictAndTrustedFinalization(): Promise<void> {
  const conflictStore = createMatchEndStore(createMemoryStorage());
  const firstReport = {
    type: "matchEndReport" as const,
    playerId: 1 as const,
    tick: 42,
    winner: 1 as const,
    reason: "timerUnits" as const,
    finalHash: "abcd1234",
  };
  const conflictingReport = {
    ...firstReport,
    playerId: 2 as const,
    winner: 2 as const,
    reason: "timerPlanets" as const,
    finalHash: "ffff0000",
  };

  assert.equal(await conflictStore.record(firstReport), null);
  assert.deepEqual(await conflictStore.record(conflictingReport), {
    type: "matchEnd",
    tick: 42,
    winner: 0,
    reason: "desync",
    finalHash: null,
    source: "conflict",
    reports: [
      {
        playerId: 1,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
      {
        playerId: 2,
        tick: 42,
        winner: 2,
        reason: "timerPlanets",
        finalHash: "ffff0000",
      },
    ],
  });

  const trustedStore = createMatchEndStore(createMemoryStorage());

  assert.deepEqual(await trustedStore.recordTrusted(firstReport), {
    type: "matchEnd",
    tick: 42,
    winner: 1,
    reason: "timerUnits",
    finalHash: "abcd1234",
    source: "trusted",
    reports: [
      {
        playerId: 1,
        tick: 42,
        winner: 1,
        reason: "timerUnits",
        finalHash: "abcd1234",
      },
    ],
  });
}

async function testSnapshotStoreDeletesPrunedRows(): Promise<void> {
  const storage = createMemoryStorage();
  const store = createSnapshotStore({
    maxSnapshots: 2,
    storage,
  });
  const world = createWorld({
    config: createMinimalSkirmishConfig(),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const baseSnapshot = serializeWorld(world);

  await store.write(1, { ...baseSnapshot, tick: 1 });
  await store.write(1, { ...baseSnapshot, tick: 2 });
  await store.write(1, { ...baseSnapshot, tick: 3 });

  assert.deepEqual(
    (await store.list()).map((snapshot) => snapshot.tick),
    [2, 3]
  );

  const reloadedStore = createSnapshotStore({
    maxSnapshots: 2,
    storage,
  });
  const storedRows = await storage.list({ prefix: "snapshot:" });

  assert.deepEqual(
    (await reloadedStore.list()).map((snapshot) => snapshot.tick),
    [2, 3]
  );
  assert.deepEqual([...storedRows.keys()], [
    "snapshot:0000000002",
    "snapshot:0000000003",
  ]);
}

function testDefaultContentRegistryLoadsRawTemplates(): void {
  const validation = validateContentRegistry(DEFAULT_CONTENT_REGISTRY);
  const fighter = DEFAULT_CONTENT_REGISTRY.getUnitTemplate(TEMPLATE_IDS.fighterShip);
  const dropShip = DEFAULT_CONTENT_REGISTRY.getUnitTemplate(TEMPLATE_IDS.dropShip);
  const battleship = DEFAULT_CONTENT_REGISTRY.getUnitTemplate(TEMPLATE_IDS.battleship);
  const engine = DEFAULT_CONTENT_REGISTRY.getShipComponent(
    SHIP_COMPONENT_IDS.ionEngineSmall
  );
  const pulseLaser = DEFAULT_CONTENT_REGISTRY.getShipComponent(
    SHIP_COMPONENT_IDS.pulseLaserSmall
  );
  const bombardLaser = DEFAULT_CONTENT_REGISTRY.getShipComponent(
    SHIP_COMPONENT_IDS.bombardLaserSmall
  );

  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(DEFAULT_CONTENT_REGISTRY.contentHash, DEFAULT_CONTENT_HASH);
  assert.equal(fighter.slug, "scout-ship");
  assert.equal(dropShip.slug, "drop-ship");
  assert.equal(battleship.slug, "battleship");
  assert.equal(engine.slug, "ion-engine-small");
  assert.equal(bombardLaser.slug, "bombard-laser-small");
  assert.ok(pulseLaser.type === "weapon");
  assert.ok(bombardLaser.type === "weapon");
  assert.equal(bombardLaser.damage, pulseLaser.damage);
  assert.equal(bombardLaser.cooldownTicks, pulseLaser.cooldownTicks);
  assert.ok(bombardLaser.range > pulseLaser.range);
  assert.equal(dropShip.defaultLoadout.componentsBySlot["main-engine-4"], 1);
  assert.equal(
    battleship.defaultLoadout.componentsBySlot["weapon-5"],
    SHIP_COMPONENT_IDS.bombardLaserSmall
  );
}

function testDeterministicMathReferenceValues(): void {
  assert.equal(deterministicSin(0), 0);
  assert.equal(deterministicSin(Math.PI / 2), 1);
  assert.equal(deterministicSin(-2.7755575615628914e-17), 0);
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
  const parentPlanetCount = first.initialPlanets.length - moonCount;
  const planetClasses = new Set<string>();

  assert.deepEqual(first.initialPlanets, second.initialPlanets);
  assert.deepEqual(first.environment, second.environment);
  assert.ok(Number.isFinite(first.environment.sun.orbitCenter.x));
  assert.ok(first.initialPlanets.length >= 8);
  assert.ok(first.initialPlanets.length <= 11);
  assert.ok(parentPlanetCount >= 7);
  assert.ok(moonCount <= 4);
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

  for (let seed = 0; seed < 128; seed += 1) {
    const config = createMinimalSkirmishConfig({ seed });
    const parentCount = config.initialPlanets.filter(
      (planet) => planet.parentPlanetIndex === null
    ).length;

    assert.ok(config.initialPlanets.length >= 8);
    assert.ok(config.initialPlanets.length <= 11);
    assert.ok(parentCount >= 7);
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
  assert.equal(first, "afa03075");
}

function testHeadlessRunnerMatchesSmokeReplayHash(): void {
  const runner = createHeadlessMatchRunner({
    config: createMinimalSkirmishConfig(),
    content: DEFAULT_CONTENT_REGISTRY,
    maxTicks: 24,
    hashIntervalTicks: 24,
  });
  const result = runner.run({
    commandBatches: createReplayBatches(runner.world),
  });

  assert.equal(result.finalHash, "afa03075");
  assert.deepEqual(result.hashes, [
    {
      tick: 24,
      hash: "afa03075",
    },
  ]);
  assert.equal(result.metrics.commandCount, 2);
  assert.equal(result.metrics.nonEmptyCommandBatches, 2);
  assert.equal(result.replay.version, 1);
  assert.deepEqual(
    result.replay.commandBatches,
    createReplayBatches(runner.world)
  );
  assert.deepEqual(result.replay.expectedHashes, result.hashes);
}

function testHeadlessControllerCommandsUseCommandBatches(): void {
  const target = {
    x: -90,
    y: 0,
    z: -20,
  };
  const controller: HeadlessMatchController = {
    id: "test-tool-controller",
    commandsForTick(world) {
      if (world.tick !== 0) {
        return [];
      }

      const unit = world.units.find((entry) => entry.owner === 1);

      assert.ok(unit);

      return [
        {
          playerId: 1,
          clientSeq: 1,
          command: {
            type: "moveUnits",
            unitHandles: [unit.handle],
            target,
          },
        },
      ];
    },
  };
  const runner = createHeadlessMatchRunner({
    config: createMinimalSkirmishConfig(),
    controllers: [controller],
    maxTicks: 1,
    hashIntervalTicks: 1,
  });
  const result = runner.run();
  const unit = result.world.units.find((entry) => entry.owner === 1);

  assert.ok(unit);
  assert.equal(result.commandBatches.length, 1);
  assert.equal(result.commandBatches[0]?.tick, 0);
  assert.equal(result.commandBatches[0]?.commands[0]?.playerId, 1);
  assert.equal(unit.moveOrder?.type, "moveTo");
  assert.deepEqual(
    unit.moveOrder?.type === "moveTo" ? unit.moveOrder.target : null,
    target
  );
  assert.equal(result.hashes.length, 1);
  assert.equal(result.metrics.commandCount, 1);
}

function testHeadlessMetricsTracksBattleshipDamage(): void {
  const runner = createHeadlessMatchRunner({
    config: createMinimalSkirmishConfig({
      seed: 1337,
      initialPlanets: [],
      initialUnits: [
        {
          owner: 1,
          templateId: TEMPLATE_IDS.battleship,
          position: { x: 0, y: 0, z: 0 },
        },
        {
          owner: 2,
          templateId: TEMPLATE_IDS.dropShip,
          position: { x: 42, y: 0, z: 0 },
        },
      ],
    }),
    maxTicks: 1,
    hashIntervalTicks: 0,
  });
  const result = runner.run();
  const battleshipClassKey = String(SHIP_CLASS_IDS.battleship);

  assert.equal(result.metrics.eventCounts.weaponFired, 1);
  assert.ok(result.metrics.damageDone.battleship.total > 0);
  assert.equal(
    result.metrics.damageDone.bySourceShipClass[battleshipClassKey],
    result.metrics.damageDone.battleship.total
  );
  assert.equal(
    result.metrics.damageDone.battleship.byOwner["1"],
    result.metrics.damageDone.battleship.total
  );
}

function testHeadlessRunnerRunsAllNpcMatch(): void {
  const runner = createHeadlessMatchRunner({
    config: createCaptureDemoConfig({
      seed: 1337,
      controllers: [
        { playerId: 1, type: "npc" },
        { playerId: 2, type: "npc" },
      ],
      rules: {
        matchEnd: {
          durationTicks: 3,
        },
        npc: {
          aggroRangeWorldUnits: 1_000,
        },
        spawning: {
          fighterSpawnIntervalTicks: 10_000,
        },
      },
    }),
    maxTicks: 3,
    hashIntervalTicks: 1,
  });
  const result = runner.run();

  assert.equal(result.metrics.completed, true);
  assert.equal(result.metrics.ticksElapsed, 3);
  assert.equal(result.hashes.length, 3);
  assert.ok(result.commandBatches.length > 0);
  assert.ok(result.metrics.commandCount > 0);
  assert.ok(result.metrics.laneOrderCount > 0);
}

function testNpcOrbitLaneHeuristicsIssueLaneOrders(): void {
  const config = createCaptureDemoConfig({
    seed: 7331,
    controllers: [
      { playerId: 1, type: "npc" },
      { playerId: 2, type: "npc" },
    ],
    rules: {
      matchEnd: {
        durationTicks: 2,
      },
      npc: {
        aggroRangeWorldUnits: 1_000,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const legacy = createHeadlessMatchRunner({
    config,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: false }),
    ],
    maxTicks: 1,
    hashIntervalTicks: 0,
  }).run();
  const enhanced = createHeadlessMatchRunner({
    config,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: true }),
    ],
    maxTicks: 1,
    hashIntervalTicks: 0,
  }).run();

  assert.equal(legacy.metrics.laneOrderCount, 0);
  assert.ok(enhanced.metrics.laneOrderCount > 0);
  assert.ok(
    enhanced.world.units.some(
      (unit) =>
        unit.shipClassId === SHIP_CLASS_IDS.dropShip &&
        unit.moveOrder?.type === "capturePlanet" &&
        !!unit.moveOrder.lane
    )
  );
  assert.ok(
    enhanced.world.units.some(
      (unit) =>
        unit.shipClassId === SHIP_CLASS_IDS.battleship &&
        unit.moveOrder?.type === "orbitPlanet" &&
        !!unit.moveOrder.lane
    )
  );
}

function testHeadlessDropShipOnlyMatchCapturesPlanets(): void {
  const baseConfig = createCaptureDemoConfig({
    seed: 202,
    controllers: [
      { playerId: 1, type: "npc" },
      { playerId: 2, type: "npc" },
    ],
    rules: {
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
        fighterSpawnCapPerDropShip: 0,
      },
    },
  });
  const runner = createHeadlessMatchRunner({
    config: {
      ...baseConfig,
      initialUnits: baseConfig.initialUnits.filter(
        (unit) => unit.templateId === TEMPLATE_IDS.dropShip
      ),
    },
    hashIntervalTicks: PHASE_ONE_SIM_HZ,
  });
  const result = runner.run();

  assert.ok(
    result.metrics.eventCounts.planetCaptured >= 2,
    "Expected NPC drop ships to capture planets without combat escorts"
  );
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

function testCloseRangeBoidSeparationPreservesFalloff(): void {
  const target = { x: 1000, y: 0, z: 0 };
  const world = createWorld({
    config: createMinimalSkirmishConfig({
      seed: 62001,
      initialPlanets: [],
      initialUnits: [
        {
          owner: 1,
          templateId: TEMPLATE_IDS.battleship,
          position: { x: 0, y: 0, z: 0 },
          initialOrder: { type: "moveTo", target },
        },
        ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x, index) => ({
          owner: 1 as const,
          templateId: TEMPLATE_IDS.fighterShip,
          position: {
            x,
            y: (index % 3) - 1,
            z: 7,
          },
          initialOrder: { type: "moveTo" as const, target },
        })),
      ],
    }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const battleship = world.units.find(
    (unit) => unit.shipClassId === SHIP_CLASS_IDS.battleship
  );

  assert.ok(battleship);

  runTick(world, createEmptyCommandBatch(world.tick));

  assert.ok(
    angleFromPositiveX(battleship.velocity) < 6,
    "Expected close fighter separation to preserve falloff instead of overpowering move intent"
  );
}

function testAppendOrderAdvancesAfterCurrentOrderCompletes(): void {
  const world = createWorld({
    config: createMinimalSkirmishConfig(),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const unit = world.units.find((entry) => entry.owner === 1);

  assert.ok(unit);

  const firstTarget = {
    x: unit.position.x + 32,
    y: unit.position.y,
    z: unit.position.z,
  };
  const secondTarget = {
    x: unit.position.x + 72,
    y: unit.position.y,
    z: unit.position.z + 12,
  };

  runTick(world, {
    tick: 0,
    commands: [
      {
        playerId: 1,
        clientSeq: 1,
        command: {
          type: "issueUnitOrder",
          unitHandles: [unit.handle],
          order: {
            type: "moveTo",
            target: firstTarget,
          },
          queueMode: "replace",
        },
      },
      {
        playerId: 1,
        clientSeq: 2,
        command: {
          type: "issueUnitOrder",
          unitHandles: [unit.handle],
          order: {
            type: "moveTo",
            target: secondTarget,
          },
          queueMode: "append",
        },
      },
    ],
  });

  assert.equal(unit.moveOrder?.type, "moveTo");
  assert.deepEqual(
    unit.moveOrder?.type === "moveTo" ? unit.moveOrder.target : null,
    firstTarget
  );
  assert.equal(unit.orderQueue.length, 1);

  unit.position = firstTarget;
  unit.prevPosition = firstTarget;
  unit.velocity = { x: 0, y: 0, z: 0 };

  runTick(world, createEmptyCommandBatch(world.tick));
  runTick(world, createEmptyCommandBatch(world.tick));

  assert.equal(unit.moveOrder?.type, "moveTo");
  assert.deepEqual(
    unit.moveOrder?.type === "moveTo" ? unit.moveOrder.target : null,
    secondTarget
  );
  assert.equal(unit.orderQueue.length, 0);
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

function testOrbitLaneOrderPreservesLaneSpec(): void {
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
            clientSeq: 44,
            command: {
              type: "issueUnitOrder",
              unitHandles: [unit.handle],
              order: {
                type: "orbitPlanet",
                planet: planet.handle,
                lane: {
                  radius: planet.radius * 4.5,
                  axis: { x: 0, y: 0, z: 1 },
                  direction: -1,
                },
              },
              queueMode: "replace",
            },
          },
        ],
      },
    ],
    1
  );

  assert.equal(unit.moveOrder?.type, "orbitPlanet");
  assert.equal(
    unit.moveOrder?.type === "orbitPlanet" && unit.moveOrder.lane?.direction,
    -1
  );
  assert.equal(
    unit.moveOrder?.type === "orbitPlanet" && unit.moveOrder.lane?.axis.z,
    1
  );

  const hashWithLane = hashWorld(world);
  const snapshot = serializeWorld(world);
  const restored = hydrateWorldFromSnapshot(snapshot, DEFAULT_CONTENT_REGISTRY);
  const restoredUnit = restored.units.find((entry) =>
    sameHandle(entry.handle, unit.handle)
  );

  assert.ok(restoredUnit?.moveOrder?.type === "orbitPlanet");
  assert.equal(restoredUnit.moveOrder.lane?.radius, planet.radius * 4.5);
  assert.equal(hashWorld(restored), hashWithLane);
}

function testOrbitLaneVelocityUsesLanePlaneAndDirection(): void {
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

  const stats = readUnitShipStats(world, new Map(), unit);
  const lane = {
    radius: planet.radius * 4,
    axis: { x: 0, y: 0, z: 1 },
    direction: 1 as const,
  };

  unit.position = {
    x: planet.position.x + lane.radius * 1.35,
    y: planet.position.y,
    z: planet.position.z + planet.radius * 0.4,
  };

  const forwardVelocity = computeOrbitVelocityAroundPlanet(
    unit,
    planet,
    0,
    stats,
    lane.radius,
    DEFAULT_SIM_TUNING.orbit,
    lane
  );
  const reverseVelocity = computeOrbitVelocityAroundPlanet(
    unit,
    planet,
    0,
    stats,
    lane.radius,
    DEFAULT_SIM_TUNING.orbit,
    {
      ...lane,
      direction: -1,
    }
  );

  assert.ok(
    forwardVelocity.y > 0,
    "Expected lane direction +1 to move along the lane tangent"
  );
  assert.ok(
    reverseVelocity.y < 0,
    "Expected lane direction -1 to reverse lane tangent"
  );
  assert.ok(
    forwardVelocity.x < 0,
    "Expected custom lane to correct excessive orbital radius"
  );
  assert.ok(
    forwardVelocity.z < 0,
    "Expected custom lane to correct displacement out of its plane"
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

function testClassHotkeySelectionFiltersSelectedUnits(): void {
  const units = [
    createTestUnitView("fighter-a", 1, 1, SHIP_CLASS_IDS.fighter),
    createTestUnitView("fighter-b", 1, 2, SHIP_CLASS_IDS.fighter),
    createTestUnitView("battleship-a", 1, 3, SHIP_CLASS_IDS.battleship),
    createTestUnitView("drop-ship-a", 1, 4, SHIP_CLASS_IDS.dropShip),
    createTestUnitView("enemy-fighter", 2, 5, SHIP_CLASS_IDS.fighter),
  ];
  const selectedUnitKeys = new Set(["fighter-a", "battleship-a"]);

  assert.deepEqual(
    selectClassHotkeyUnitKeys(
      units,
      1,
      selectedUnitKeys,
      SHIP_CLASS_IDS.fighter
    ),
    ["fighter-a"]
  );
  assert.deepEqual(
    selectClassHotkeyUnitKeys(
      units,
      1,
      selectedUnitKeys,
      SHIP_CLASS_IDS.battleship
    ),
    ["battleship-a"]
  );
  assert.deepEqual(
    selectClassHotkeyUnitKeys(
      units,
      1,
      selectedUnitKeys,
      SHIP_CLASS_IDS.dropShip
    ),
    []
  );
  assert.deepEqual(
    selectClassHotkeyUnitKeys(units, 1, new Set(), SHIP_CLASS_IDS.fighter),
    ["fighter-a", "fighter-b"]
  );
}

function testAttackTargetPriorityRanking(): void {
  const candidates = [
    {
      key: "fighter-close",
      shipClassId: SHIP_CLASS_IDS.fighter,
      screenDistancePx: 8,
      worldDistance: 90,
      handleId: 4,
    },
    {
      key: "battleship-mid",
      shipClassId: SHIP_CLASS_IDS.battleship,
      screenDistancePx: 42,
      worldDistance: 120,
      handleId: 3,
    },
    {
      key: "drop-ship-far",
      shipClassId: SHIP_CLASS_IDS.dropShip,
      screenDistancePx: 64,
      worldDistance: 140,
      handleId: 2,
    },
    {
      key: "drop-ship-near",
      shipClassId: SHIP_CLASS_IDS.dropShip,
      screenDistancePx: 24,
      worldDistance: 160,
      handleId: 1,
    },
  ];

  assert.deepEqual(
    rankAttackTargetCandidates(candidates).map((candidate) => candidate.key),
    ["drop-ship-near", "drop-ship-far", "battleship-mid", "fighter-close"]
  );
  assert.equal(
    selectNextAttackTargetKey(candidates, "drop-ship-near", 1),
    "drop-ship-far"
  );
  assert.equal(
    selectNextAttackTargetKey(candidates, "drop-ship-near", -1),
    "fighter-close"
  );
}

function testSceneSelectionCandidateRanking(): void {
  const candidates: SceneSelectionCandidate[] = [
    {
      kind: "planet",
      key: "planet-under-pointer",
      screenDistancePx: 0,
      screenScore: 0,
    },
    {
      kind: "enemyUnit",
      key: "enemy-close",
      screenDistancePx: 2,
      screenScore: 0.08,
      handleId: 9,
    },
    {
      kind: "friendlyUnit",
      key: "friendly-offset",
      screenDistancePx: 9,
      screenScore: 0.5,
      handleId: 3,
    },
    {
      kind: "friendlyUnit",
      key: "friendly-center",
      screenDistancePx: 3,
      screenScore: 0.1,
      handleId: 4,
    },
  ];

  assert.equal(
    selectPrimarySceneSelectionCandidate(candidates)?.key,
    "friendly-center"
  );
  assert.equal(
    selectPrimarySceneSelectionCandidate(
      candidates.filter((candidate) => candidate.kind !== "friendlyUnit")
    )?.key,
    "enemy-close"
  );
}

function testCaptureDemoConfig(): void {
  const config = createCaptureDemoConfig({ seed: 1337 });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });

  assert.equal(config.gameMode, "captureDemo");
  const parentPlanets = world.planets.filter(
    (planet) => planet.parentPlanetIndex === null
  );
  const capturablePlanets = world.planets.filter(
    (planet) => planet.control.capturable
  );

  assert.ok(capturablePlanets.length >= 7);
  assert.equal(
    capturablePlanets.length,
    parentPlanets.length,
    "Expected every primary planet to be capturable"
  );
  assert.ok(
    world.planets.every(
      (planet) => planet.parentPlanetIndex === null || !planet.control.capturable
    ),
    "Expected moons to remain non-capturable"
  );

  const playerOneDropShip = assertCaptureDemoFleet(world, 1);
  const playerTwoDropShip = assertCaptureDemoFleet(world, 2);

  assertEqualPlayerFleetStats(world);

  assert.ok(
    distance(playerOneDropShip.position, playerTwoDropShip.position) > 450,
    "Expected starting fleets to begin separated around the primary planet"
  );

  for (const unit of world.units) {
    for (const planet of world.planets) {
      assert.ok(
        distance(unit.position, planet.position) > planet.radius + 120,
        "Expected capture demo fleets to begin away from planets"
      );
    }
  }
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

function testOrbitTrackingState(): void {
  const world = createWorld({
    config: createCaptureDemoConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const planet = world.planets.find((entry) => entry.control.capturable);
  const dropShip = world.units.find(
    (entry) => entry.owner === 1 && entry.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(planet);
  assert.ok(dropShip);

  placeDropShipInCaptureOrbit(dropShip, planet);
  runBatches(world, [], 1);

  assert.equal(dropShip.orbit.isOrbiting, true);
  assert.ok(dropShip.orbit.planet);
  assert.ok(sameHandle(dropShip.orbit.planet, planet.handle));
  assert.equal(dropShip.orbit.orbitTicks, 1);
}

function testDropShipCapturesPlanet(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      capture: {
        planetCaptureSeconds: 1,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
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

  placeDropShipInCaptureOrbit(dropShip, planet);

  runBatches(world, [], PHASE_ONE_SIM_HZ + 2);

  assert.equal(planet.control.owner, 1);
}

function testDropShipCaptureContinuesNearInnerOrbit(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
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

  placeDropShipInCaptureOrbit(dropShip, planet, 1.35);
  planet.control.capturingPlayer = dropShip.owner;
  planet.control.capturingDropShip = dropShip.handle;
  planet.control.captureTicks = 12;

  runTick(world, createEmptyCommandBatch(world.tick));

  assert.ok(dropShip.orbit.isOrbiting);
  assert.equal(planet.control.breakTicks, 0);
  assert.ok(planet.control.captureTicks > 12);
}

function testCapturedPlanetSpawnsDropShip(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      capture: {
        planetCaptureSeconds: 1,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
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

  const initialDropShips = world.units.filter(
    (unit) => unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  ).length;

  placeDropShipInCaptureOrbit(dropShip, planet);
  runBatches(world, [], PHASE_ONE_SIM_HZ + 2);

  const playerDropShips = world.units.filter(
    (unit) => unit.owner === 1 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );
  const spawnedDropShip = playerDropShips.find(
    (unit) => unit.spawnedTick > 0 && unit.moveOrder?.type === "orbitPlanet"
  );

  assert.equal(planet.control.owner, 1);
  assert.equal(playerDropShips.length, initialDropShips + 1);
  assert.ok(spawnedDropShip);
  assert.equal(spawnedDropShip.moveOrder?.type, "orbitPlanet");
  assert.ok(
    spawnedDropShip.moveOrder?.type === "orbitPlanet" &&
      sameHandle(spawnedDropShip.moveOrder.planet, planet.handle)
  );
  assert.ok(
    distance(spawnedDropShip.position, planet.position) > planet.radius,
    "Expected captured-planet drop ship to spawn outside the planet body"
  );
}

function testDropShipSpawnsFighters(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      spawning: {
        fighterSpawnIntervalTicks: 2,
        fighterSpawnCapPerDropShip: 2,
      },
    },
  });
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

  assert.equal(spawnedFighters, 8);
}

function testSpawnedFightersEscortParentDropShip(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      spawning: {
        fighterSpawnIntervalTicks: 2,
        fighterSpawnCapPerDropShip: 1,
      },
    },
  });
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
  assert.equal(playerOneLost.matchResult?.reason, "dropShipsLost");

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
  assert.equal(playerTwoLost.matchResult?.reason, "dropShipsLost");
}

function testTimerPlanetCountWinner(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      matchEnd: {
        durationTicks: 3,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const playerOnePlanet = world.planets[0];
  const neutralPlanet = world.planets[1];

  assert.ok(playerOnePlanet);
  assert.ok(neutralPlanet);

  for (const planet of world.planets) {
    planet.control.capturable = false;
    planet.control.owner = 0;
  }

  playerOnePlanet.control.capturable = true;
  playerOnePlanet.control.owner = 1;
  neutralPlanet.control.capturable = true;
  neutralPlanet.control.owner = 0;

  runBatches(world, [], 3);

  assert.equal(world.matchResult?.winner, 1);
  assert.equal(world.matchResult?.completedTick, 2);
  assert.equal(world.matchResult?.reason, "timerPlanets");
}

function testTimerUnitCountWinner(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      matchEnd: {
        durationTicks: 3,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const playerTwoFighter = world.units.find(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.fighter
  );

  assert.ok(playerTwoFighter);

  for (const planet of world.planets) {
    planet.control.capturable = true;
    planet.control.owner = 0;
  }

  playerTwoFighter.health.current = 0;

  runBatches(world, [], 3);

  assert.equal(world.matchResult?.winner, 1);
  assert.equal(world.matchResult?.completedTick, 2);
  assert.equal(world.matchResult?.reason, "timerUnits");
}

function testLocalRuntimeStopsAfterMatchEnd(): void {
  const runtime = createMinimalLocalGame(1, { seed: 1337 });
  const playerTwoDropShips = runtime.world.units.filter(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(playerTwoDropShips.length > 0);

  for (const unit of playerTwoDropShips) {
    unit.health.current = 0;
  }

  runtime.stepTick();

  const completedTick = runtime.world.tick;

  assert.equal(runtime.world.matchResult?.winner, 1);

  runtime.enqueueRandomTurn();
  runtime.stepTick();

  assert.equal(runtime.world.tick, completedTick);
  runtime.dispose();
}

function testLocalRuntimeReplayStartsFreshSeed(): void {
  const runtime = createMinimalLocalGame(1, { seed: 1337 });
  const originalSeed = runtime.world.config.seed;
  const playerTwoDropShips = runtime.world.units.filter(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(playerTwoDropShips.length > 0);

  for (const unit of playerTwoDropShips) {
    unit.health.current = 0;
  }

  runtime.stepTick();
  assert.ok(runtime.world.matchResult);

  runtime.replayMatch();

  assert.equal(runtime.world.tick, 0);
  assert.equal(runtime.world.matchResult, null);
  assert.notEqual(runtime.world.config.seed, originalSeed);
  runtime.dispose();
}

function testLocalRuntimeKeepsFiniteViewModels(): void {
  const runtime = createMinimalLocalGame(1, { seed: 1337 });

  try {
    for (let step = 0; step < PHASE_ONE_SIM_HZ * 40; step += 1) {
      runtime.stepTick();

      for (const unit of runtime.readUnits()) {
        assertFiniteVec3(
          unit.position,
          `tick ${runtime.world.tick} unit ${unit.key} position`
        );
        assertFiniteVec3(
          unit.prevPosition,
          `tick ${runtime.world.tick} unit ${unit.key} previous position`
        );
      }

      for (const planet of runtime.readPlanets()) {
        assertFiniteVec3(
          planet.position,
          `tick ${runtime.world.tick} planet ${planet.key} position`
        );
      }
    }
  } finally {
    runtime.dispose();
  }
}

function testLocalRuntimeViewModelsExposeOrders(): void {
  const runtime = createMinimalLocalGame(1, { seed: 2024 });

  try {
    const unit = runtime.readUnits().find((entry) => entry.owner === runtime.playerId);

    assert.ok(unit);

    const target = {
      x: unit.position.x + 160,
      y: unit.position.y,
      z: unit.position.z - 90,
    };

    runtime.enqueueUnitOrder([unit.handle], {
      type: "moveTo",
      target,
    });
    runtime.stepTick();

    const orderedUnit = runtime
      .readUnits()
      .find((entry) => sameHandle(entry.handle, unit.handle));

    assert.ok(orderedUnit);
    assert.equal(orderedUnit.moveOrder?.type, "moveTo");
    assert.deepEqual(
      orderedUnit.moveOrder?.type === "moveTo"
        ? orderedUnit.moveOrder.target
        : null,
      target
    );
    assert.equal(orderedUnit.queuedOrderCount, 0);
  } finally {
    runtime.dispose();
  }
}

function testLocalRuntimeUsesScriptedNpcController(): void {
  const runtime = createMinimalLocalGame(1, { seed: 1337 });
  const controller = createScriptedNpcController();
  const expectedCommands = controller.commandsForTick(runtime.world);

  assert.ok(expectedCommands.length > 0);
  assert.ok(expectedCommands.every((scheduled) => scheduled.playerId === 2));

  runtime.stepTick();

  for (const scheduled of expectedCommands) {
    const command = scheduled.command;

    assert.equal(command.type, "issueUnitOrder");

    if (command.type !== "issueUnitOrder") {
      continue;
    }

    const unit = runtime.world.units.find((entry) =>
      sameHandle(entry.handle, command.unitHandles[0])
    );

    assert.ok(unit);
    assert.deepEqual(unit.moveOrder, command.order);
  }

  runtime.dispose();
}

function testNpcDefenderIssuesAttackOrders(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      npc: {
        aggroRangeWorldUnits: 1_000,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const runner = createHeadlessMatchRunner({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: false }),
    ],
    maxTicks: 2,
  });
  const result = runner.run();

  const defender = result.world.units.find(
    (unit) =>
      unit.owner === 2 &&
      unit.shipClassId !== SHIP_CLASS_IDS.dropShip &&
      unit.moveOrder?.type === "attackTarget"
  );

  assert.ok(result.commandBatches.length > 0);
  assert.ok(defender);
}

function testNpcDropShipChoosesSafePlanetBeforeContestedPlanet(): void {
  const base = createCaptureDemoConfig({ seed: 1337 });
  const planetTemplate = base.initialPlanets.find(
    (planet) => planet.parentPlanetIndex === null
  );

  assert.ok(planetTemplate);

  const config = createCaptureDemoConfig({
    seed: 1337,
    initialPlanets: [
      createStaticTestPlanet(planetTemplate, "Exposed", { x: 0, y: 0, z: 0 }),
      createStaticTestPlanet(planetTemplate, "Safe", { x: 420, y: 0, z: 0 }),
      createStaticTestPlanet(planetTemplate, "Contested", {
        x: 840,
        y: 0,
        z: 0,
      }),
    ],
    initialUnits: [
      {
        owner: 1,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 0, y: 8, z: 95 },
      },
      {
        owner: 1,
        templateId: TEMPLATE_IDS.fighterShip,
        position: { x: 30, y: 8, z: 100 },
      },
      {
        owner: 2,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 360, y: 8, z: 0 },
      },
      {
        owner: 2,
        templateId: TEMPLATE_IDS.fighterShip,
        position: { x: 372, y: 8, z: 12 },
      },
    ],
    rules: {
      npc: {
        aggroRangeWorldUnits: 1_000,
        thinkIntervalTicks: 1,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const runner = createHeadlessMatchRunner({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: false }),
    ],
  });
  const safePlanet = runner.world.planets.find(
    (planet) => planet.name === "Safe"
  );
  const contestedPlanet = runner.world.planets.find(
    (planet) => planet.name === "Contested"
  );
  const dropShip = runner.world.units.find(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );

  assert.ok(safePlanet);
  assert.ok(contestedPlanet);
  assert.ok(dropShip);

  contestedPlanet.control.contested = true;

  const step = runner.step();

  assert.ok(step.batch.commands.length > 0);
  assert.equal(dropShip.moveOrder?.type, "capturePlanet");
  assert.ok(
    dropShip.moveOrder?.type === "capturePlanet" &&
      sameHandle(dropShip.moveOrder.planet, safePlanet.handle)
  );
}

function testNpcDropShipsClaimDifferentCapturePlanets(): void {
  const base = createCaptureDemoConfig({ seed: 1337 });
  const planetTemplate = base.initialPlanets.find(
    (planet) => planet.parentPlanetIndex === null
  );

  assert.ok(planetTemplate);

  const config = createCaptureDemoConfig({
    seed: 1337,
    controllers: [
      { playerId: 1, type: "npc" },
      { playerId: 2, type: "npc" },
    ],
    initialPlanets: [
      createStaticTestPlanet(planetTemplate, "Near", { x: 0, y: 0, z: 0 }),
      createStaticTestPlanet(planetTemplate, "Second", { x: 120, y: 0, z: 0 }),
      createStaticTestPlanet(planetTemplate, "Third", { x: 240, y: 0, z: 0 }),
    ],
    initialUnits: [
      {
        owner: 2,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 30, y: 8, z: 0 },
      },
      {
        owner: 2,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 34, y: 8, z: 6 },
      },
    ],
    rules: {
      npc: {
        thinkIntervalTicks: 1,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
        fighterSpawnCapPerDropShip: 0,
      },
    },
  });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const controller = createScriptedNpcController({ playerIds: [2] });
  const targets = controller
    .commandsForTick(world)
    .flatMap((scheduled) => {
      const command = scheduled.command;

      return command.type === "issueUnitOrder" &&
        command.order.type === "capturePlanet"
        ? [command.order.planet]
        : [];
    });
  const targetKeys = new Set(
    targets.map((target) => `${target.id}:${target.generation}`)
  );

  assert.equal(targets.length, 2);
  assert.equal(
    targetKeys.size,
    2,
    "Expected NPC drop ships to spread across capture targets"
  );
}

function testNpcFightersHoldEscortWhenDropShipIsNotThreatened(): void {
  const base = createCaptureDemoConfig({ seed: 1337 });
  const planetTemplate = base.initialPlanets.find(
    (planet) => planet.parentPlanetIndex === null
  );

  assert.ok(planetTemplate);

  const config = createCaptureDemoConfig({
    seed: 1337,
    initialPlanets: [
      createStaticTestPlanet(planetTemplate, "Remote", { x: 600, y: 0, z: 0 }),
    ],
    initialUnits: [
      {
        owner: 1,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 500, y: 8, z: 0 },
      },
      {
        owner: 1,
        templateId: TEMPLATE_IDS.fighterShip,
        position: { x: 220, y: 8, z: 0 },
      },
      {
        owner: 2,
        templateId: TEMPLATE_IDS.dropShip,
        position: { x: 0, y: 8, z: 120 },
      },
      {
        owner: 2,
        templateId: TEMPLATE_IDS.fighterShip,
        position: { x: 140, y: 8, z: 0 },
      },
    ],
    rules: {
      npc: {
        aggroRangeWorldUnits: 120,
        dropShipThreatRangeWorldUnits: 120,
        thinkIntervalTicks: 1,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const runner = createHeadlessMatchRunner({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: false }),
    ],
  });
  const dropShip = runner.world.units.find(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );
  const fighter = runner.world.units.find(
    (unit) => unit.owner === 2 && unit.shipClassId === SHIP_CLASS_IDS.fighter
  );

  assert.ok(dropShip);
  assert.ok(fighter);

  const step = runner.step();

  assert.ok(step.batch.commands.length > 0);
  assert.equal(fighter.moveOrder?.type, "escort");
  assert.ok(
    fighter.moveOrder?.type === "escort" &&
      sameHandle(fighter.moveOrder.target, dropShip.handle)
  );
}

function testNpcControllersCanOwnEveryPlayer(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    controllers: [
      { playerId: 1, type: "npc" },
      { playerId: 2, type: "npc" },
    ],
    rules: {
      npc: {
        aggroRangeWorldUnits: 1_000,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const runner = createHeadlessMatchRunner({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
    controllers: [
      createScriptedNpcController({ orbitLaneHeuristics: false }),
    ],
    maxTicks: 2,
  });
  const result = runner.run();

  assert.ok(result.commandBatches.length > 0);
  assert.ok(
    result.world.units.some(
      (unit) => unit.owner === 1 && unit.moveOrder?.type === "attackTarget"
    )
  );
  assert.ok(
    result.world.units.some(
      (unit) => unit.owner === 2 && unit.moveOrder?.type === "attackTarget"
    )
  );
}

function testLegacySnapshotHydratesResolvedConfig(): void {
  const config = createCaptureDemoConfig({
    seed: 1337,
    rules: {
      npc: {
        aggroRangeWorldUnits: 1_000,
      },
      spawning: {
        fighterSpawnIntervalTicks: 10_000,
      },
    },
  });
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const legacySnapshot = {
    ...serializeWorld(world),
    controllers: undefined,
    rules: undefined,
    tuning: undefined,
    captureDemoRules: {
      ...DEFAULT_CAPTURE_DEMO_RULES,
      fighterSpawnIntervalTicks: config.rules.spawning.fighterSpawnIntervalTicks,
      npcAggroRange: config.rules.npc.aggroRangeWorldUnits,
      npcDropShipThreatRange: config.rules.npc.dropShipThreatRangeWorldUnits,
    },
  };
  const hydrated = hydrateWorldFromSnapshot(
    legacySnapshot,
    DEFAULT_CONTENT_REGISTRY
  );

  assert.equal(
    hydrated.config.controllers.find((controller) => controller.playerId === 2)
      ?.type,
    "npc"
  );
  assert.equal(hydrated.config.rules.npc.aggroRangeWorldUnits, 1_000);
  assert.equal(hydrated.config.rules.npc.dropShipThreatRangeWorldUnits, 300);

  const scriptedNpcController = createScriptedNpcController({
    orbitLaneHeuristics: false,
  });
  const commands = scriptedNpcController.commandsForTick(hydrated);

  assert.ok(commands.length > 0);

  runTick(hydrated, {
    tick: hydrated.tick,
    commands,
  });

  assert.ok(
    hydrated.units.some(
      (unit) => unit.owner === 2 && unit.moveOrder?.type === "attackTarget"
    )
  );
}

function testInitialLoadoutOverridesShipStats(): void {
  const baseConfig = createMinimalSkirmishConfig({ seed: 1337 });
  const firstUnit = baseConfig.initialUnits[0];

  assert.ok(firstUnit);

  const template = DEFAULT_CONTENT_REGISTRY.getUnitTemplate(firstUnit.templateId);
  const componentsBySlot: Record<string, number> = {
    ...template.defaultLoadout.componentsBySlot,
  };
  delete componentsBySlot["weapon-1"];

  const world = createWorld({
    config: {
      ...baseConfig,
      initialUnits: [
        {
          ...firstUnit,
          componentsBySlot,
        },
      ],
    },
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const unit = world.units[0];

  assert.ok(unit);
  assert.equal(unit.componentsBySlot?.["weapon-1"], undefined);
  assert.equal(
    readUnitShipStats(world, new Map(), unit).weaponCount,
    template.stats.weaponCount - 1
  );
  assert.equal(readUnitWeaponProfile(world, new Map(), unit), null);
}

function testInvalidInitialLoadoutSlotRejected(): void {
  const baseConfig = createMinimalSkirmishConfig({ seed: 1337 });
  const firstUnit = baseConfig.initialUnits[0];

  assert.ok(firstUnit);

  const template = DEFAULT_CONTENT_REGISTRY.getUnitTemplate(firstUnit.templateId);

  assert.throws(
    () =>
      createWorld({
        config: {
          ...baseConfig,
          initialUnits: [
            {
              ...firstUnit,
              componentsBySlot: {
                ...template.defaultLoadout.componentsBySlot,
                "not-a-slot": SHIP_COMPONENT_IDS.ionEngineSmall,
              },
            },
          ],
        },
        content: DEFAULT_CONTENT_REGISTRY,
      }),
    /unknown slot/
  );
}

function testComponentStatOverridesAffectShipStats(): void {
  const baseWorld = createWorld({
    config: createMinimalSkirmishConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const tunedWorld = createWorld({
    config: createMinimalSkirmishConfig({
      seed: 1337,
      contentOverrides: {
        shipComponents: [
          {
            componentId: SHIP_COMPONENT_IDS.ionEngineSmall,
            thrust: 1_296,
          },
        ],
      },
    }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const baseUnit = baseWorld.units[0];
  const tunedUnit = tunedWorld.units[0];

  assert.ok(baseUnit);
  assert.ok(tunedUnit);

  const baseStats = readUnitShipStats(baseWorld, new Map(), baseUnit);
  const tunedStats = readUnitShipStats(tunedWorld, new Map(), tunedUnit);

  assert.ok(tunedStats.maxSpeed > baseStats.maxSpeed);
  assert.ok(tunedStats.maxAcceleration > baseStats.maxAcceleration);
}

function testInvalidComponentStatOverrideRejected(): void {
  assert.throws(
    () =>
      createWorld({
        config: createMinimalSkirmishConfig({
          seed: 1337,
          contentOverrides: {
            shipComponents: [
              {
                componentId: SHIP_COMPONENT_IDS.ionEngineSmall,
                damage: 1,
              },
            ],
          },
        }),
        content: DEFAULT_CONTENT_REGISTRY,
      }),
    /cannot override damage/
  );
}

function testInvalidDerivedStatsFromComponentOverrideRejected(): void {
  assert.throws(
    () =>
      createWorld({
        config: createMinimalSkirmishConfig({
          seed: 1337,
          contentOverrides: {
            shipComponents: [
              {
                componentId: SHIP_COMPONENT_IDS.ionEngineSmall,
                powerDraw: 1_000,
              },
            ],
          },
        }),
        content: DEFAULT_CONTENT_REGISTRY,
      }),
    /derived stat powerAvailable/
  );
}

function testDuplicateComponentStatOverrideRejected(): void {
  assert.throws(
    () =>
      createWorld({
        config: createMinimalSkirmishConfig({
          seed: 1337,
          contentOverrides: {
            shipComponents: [
              {
                componentId: SHIP_COMPONENT_IDS.ionEngineSmall,
                thrust: 1_296,
              },
              {
                componentId: SHIP_COMPONENT_IDS.ionEngineSmall,
                thrust: 1_944,
              },
            ],
          },
        }),
        content: DEFAULT_CONTENT_REGISTRY,
      }),
    /multiple stat overrides/
  );
}

function testSimTuningAffectsHeadlessMotion(): void {
  const defaultWorld = createWorld({
    config: createMinimalSkirmishConfig({ seed: 1337 }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const tunedWorld = createWorld({
    config: createMinimalSkirmishConfig({
      seed: 1337,
      tuning: {
        movement: {
          defaultOrbitWeight: 0,
        },
        gravity: {
          steeringWeight: 0,
        },
        boids: {
          alignmentWeight: 0,
          cohesionWeight: 0,
          separationWeight: 0,
        },
        avoidance: {
          planetWeight: 0,
          shipWeight: 0,
        },
      },
    }),
    content: DEFAULT_CONTENT_REGISTRY,
  });

  runTick(defaultWorld, createEmptyCommandBatch(defaultWorld.tick));
  runTick(tunedWorld, createEmptyCommandBatch(tunedWorld.tick));

  const defaultUnit = defaultWorld.units[0];
  const tunedUnit = tunedWorld.units[0];

  assert.ok(defaultUnit);
  assert.ok(tunedUnit);
  assert.ok(distance(defaultUnit.velocity, { x: 0, y: 0, z: 0 }) > 0);
  assert.deepEqual(tunedUnit.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(
    tunedWorld.config.tuning?.movement.arrivalDistanceWorldUnits,
    DEFAULT_SIM_TUNING.movement.arrivalDistanceWorldUnits
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

function assertCaptureDemoFleet(
  world: ReturnType<typeof createWorld>,
  playerId: PlayerId
): ReturnType<typeof createWorld>["units"][number] {
  const playerUnits = world.units.filter((unit) => unit.owner === playerId);
  const dropShips = playerUnits.filter(
    (unit) => unit.shipClassId === SHIP_CLASS_IDS.dropShip
  );
  const fighters = playerUnits.filter(
    (unit) => unit.shipClassId === SHIP_CLASS_IDS.fighter
  );
  const battleships = playerUnits.filter(
    (unit) => unit.shipClassId === SHIP_CLASS_IDS.battleship
  );
  const dropShip = dropShips[0];

  assert.equal(dropShips.length, 4);
  assert.equal(fighters.length, 24);
  assert.equal(battleships.length, 5);
  assert.ok(dropShip);
  assert.ok(dropShips[1]);
  assert.ok(
    distance(dropShip.position, dropShips[1].position) > 90,
    "Expected capture demo to start with two separated drop-ship squadrons"
  );

  for (const fighter of fighters) {
    const order = fighter.moveOrder;

    assert.equal(order?.type, "escort");
    assert.ok(
      order?.type === "escort" &&
        dropShips.some((candidate) => sameHandle(order.target, candidate.handle))
    );
  }

  for (const dropShip of dropShips) {
    const escortedFighters = fighters.filter(
      (fighter) =>
        fighter.moveOrder?.type === "escort" &&
        sameHandle(fighter.moveOrder.target, dropShip.handle)
    );

    assert.equal(
      escortedFighters.length,
      6,
      "Expected every starting drop-ship squadron to have six fighter escorts"
    );
  }

  for (const unit of playerUnits) {
    assert.ok(
      dropShips.some((candidate) => distance(unit.position, candidate.position) < 90),
      "Expected every starting ship to spawn near one of its drop ships"
    );
  }

  return dropShip;
}

function assertEqualPlayerFleetStats(world: ReturnType<typeof createWorld>): void {
  assert.deepEqual(
    readPlayerFleetStatSignature(world, 1),
    readPlayerFleetStatSignature(world, 2),
    "Expected both players to start with matching unit counts and derived ship stats"
  );
}

function readPlayerFleetStatSignature(
  world: ReturnType<typeof createWorld>,
  playerId: PlayerId
): readonly string[] {
  return world.units
    .filter((unit) => unit.owner === playerId)
    .map((unit) => {
      const stats = readUnitShipStats(world, new Map(), unit);

      return JSON.stringify({
        templateId: unit.templateId,
        shipClassId: unit.shipClassId,
        componentsBySlot: unit.componentsBySlot,
        health: unit.health.max,
        stats,
      });
    })
    .sort();
}

function placeDropShipInCaptureOrbit(
  dropShip: ReturnType<typeof createWorld>["units"][number],
  planet: ReturnType<typeof createWorld>["planets"][number],
  radiusMultiplier = 3
): void {
  dropShip.position = {
    x: planet.position.x + planet.radius * radiusMultiplier,
    y: planet.position.y,
    z: planet.position.z,
  };
  dropShip.prevPosition = { ...dropShip.position };
  dropShip.velocity = { x: 0, y: 0, z: 0 };
  dropShip.desiredVelocity = null;
  dropShip.orbit = {
    isOrbiting: false,
    planet: null,
    orbitTicks: 0,
  };
  dropShip.moveOrder = {
    type: "capturePlanet",
    planet: planet.handle,
  };
}

function createStaticTestPlanet(
  source: MatchConfig["initialPlanets"][number],
  name: string,
  position: MatchConfig["initialPlanets"][number]["position"]
): MatchConfig["initialPlanets"][number] {
  return {
    ...source,
    name,
    position,
    orbitAxis: { x: 0, y: 1, z: 0 },
    orbit: {
      center: position,
      radius: 0,
      phase: 0,
      angularSpeed: 0,
    },
    parentPlanetIndex: null,
    capturable: true,
    initialOwner: 0,
  };
}

function createTestUnitView(
  key: string,
  owner: PlayerId,
  id: number,
  shipClassId = SHIP_CLASS_IDS.fighter
): UnitViewModel {
  return {
    handle: {
      id,
      generation: 1,
    },
    key,
    owner,
    shipClassId,
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
    async delete(key: string) {
      return values.delete(key);
    },
    async list<T = unknown>(options?: DurableObjectStorageListOptions) {
      const entries = [...values.entries()].filter(([key]) =>
        options?.prefix ? key.startsWith(options.prefix) : true
      );

      return new Map(entries) as Map<string, T>;
    },
  };
}

function assertFiniteVec3(
  value: Readonly<{ x: number; y: number; z: number }>,
  label: string
): void {
  assert.ok(Number.isFinite(value.x), `${label}.x must be finite`);
  assert.ok(Number.isFinite(value.y), `${label}.y must be finite`);
  assert.ok(Number.isFinite(value.z), `${label}.z must be finite`);
}

function distance(
  a: Readonly<{ x: number; y: number; z: number }>,
  b: Readonly<{ x: number; y: number; z: number }>
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function angleFromPositiveX(
  vector: Readonly<{ x: number; y: number; z: number }>
): number {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);

  if (magnitude <= 0.000001) {
    return 0;
  }

  return (
    Math.acos(Math.max(-1, Math.min(1, vector.x / magnitude))) *
    180 /
    Math.PI
  );
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
