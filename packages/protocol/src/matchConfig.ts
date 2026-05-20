import type { PlayerId } from "./handles";
import type { UnitOrderIntent } from "./commands";

export const PROTOCOL_VERSION = 1;
export const CONTENT_VERSION = 1;
export const DEFAULT_COMMAND_LEAD_TICKS = 4;
export const PHASE_ONE_SIM_HZ = 30;

export const TEMPLATE_IDS = {
  scoutShip: 1,
  fighterShip: 1,
  dropShip: 2,
  battleship: 3,
  billboardPlanet: 100,
} as const;

export const SHIP_CLASS_IDS = {
  fighter: 1,
  dropShip: 2,
  battleship: 3,
} as const;

export type ShipClassId =
  (typeof SHIP_CLASS_IDS)[keyof typeof SHIP_CLASS_IDS];

export type Vec3Data = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type QuaternionData = Readonly<{
  x: number;
  y: number;
  z: number;
  w: number;
}>;

export type PlayerConfig = Readonly<{
  id: PlayerId;
  name: string;
  color: string;
}>;

export type PlayerControllerType = "human" | "npc" | "tool" | "script";

export type PlayerControllerConfig = Readonly<{
  playerId: PlayerId;
  type: PlayerControllerType;
  profile?: string;
}>;

export type SunConfig = Readonly<{
  position: Vec3Data;
  orbitCenter: Vec3Data;
  distance: number;
  color: string;
}>;

export type MatchEnvironmentConfig = Readonly<{
  sun: SunConfig;
}>;

export type InitialUnitConfig = Readonly<{
  owner: PlayerId;
  templateId: number;
  componentsBySlot?: Readonly<Record<string, number>>;
  position: Vec3Data;
  rotation?: QuaternionData;
  initialOrder?: UnitOrderIntent;
}>;

export type PlanetOrbitConfig = Readonly<{
  center: Vec3Data;
  radius: number;
  phase: number;
  angularSpeed: number;
}>;

export type PlanetClass = "gas-giant" | "terran" | "ice";

export type PlanetAppearanceConfig = Readonly<{
  planetClass: PlanetClass;
  hasRings: boolean;
  seed: number;
}>;

export type InitialPlanetConfig = Readonly<{
  templateId: number;
  name: string;
  position: Vec3Data;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  appearance: PlanetAppearanceConfig;
  orbitAxis: Vec3Data;
  orbit: PlanetOrbitConfig;
  parentPlanetIndex: number | null;
  capturable?: boolean;
  initialOwner?: PlayerId | 0;
}>;

export type GameMode = "minimalSkirmish" | "captureDemo";

export type CaptureRulesConfig = Readonly<{
  planetCaptureSeconds: number;
  orbitMinRadiusMultiplier: number;
  orbitMaxRadiusMultiplier: number;
  breakGraceTicks: number;
}>;

export type SpawningRulesConfig = Readonly<{
  fighterSpawnIntervalTicks: number;
  fighterSpawnCapPerDropShip: number;
}>;

export type MatchEndRulesConfig = Readonly<{
  durationTicks: number;
}>;

export type NpcRulesConfig = Readonly<{
  thinkIntervalTicks: number;
  aggroRangeWorldUnits: number;
}>;

export type CaptureDemoRules = Readonly<{
  matchDurationTicks: number;
  planetCaptureSeconds: number;
  captureOrbitMinRadiusMultiplier: number;
  captureOrbitMaxRadiusMultiplier: number;
  captureBreakGraceTicks: number;
  fighterSpawnIntervalTicks: number;
  fighterSpawnCapPerDropShip: number;
  npcThinkIntervalTicks: number;
  npcAggroRange: number;
}>;

export type MatchRulesConfig = Readonly<{
  capture: CaptureRulesConfig;
  spawning: SpawningRulesConfig;
  matchEnd: MatchEndRulesConfig;
  npc: NpcRulesConfig;
}>;

export type SimMovementTuningConfig = Readonly<{
  arrivalDistanceWorldUnits: number;
  slowRadiusWorldUnits: number;
  moveOrderWeight: number;
  defaultOrbitWeight: number;
  approachHoldSpeedRatio: number;
  approachMinSpeedRatio: number;
  defaultForwardSpeedRatio: number;
}>;

export type SimGravityTuningConfig = Readonly<{
  fieldStrengthScale: number;
  rangeRadiusMultiplier: number;
  minDistanceRatio: number;
  maxStrength: number;
  steeringWeight: number;
}>;

export type SimBoidsTuningConfig = Readonly<{
  neighborRadiusWorldUnits: number;
  separationRadiusWorldUnits: number;
  alignmentWeight: number;
  cohesionWeight: number;
  separationWeight: number;
}>;

export type SimEscortTuningConfig = Readonly<{
  desiredRangeWorldUnits: number;
  targetHealthRangeWeight: number;
  innerRangeMultiplier: number;
  outerRangeMultiplier: number;
  matchVelocityWeight: number;
  correctionSpeedRatio: number;
  catchUpMinSpeedRatio: number;
}>;

export type SimOrbitTuningConfig = Readonly<{
  captureRadiusMultiplier: number;
  guardRadiusMultiplier: number;
  activeOrbitBaseMultiplier: number;
  activeOrbitJitterMultiplier: number;
  defaultMinRadiusMultiplier: number;
  defaultRadiusJitterMultiplier: number;
  radialCorrectionMax: number;
  radialCorrectionWeight: number;
  verticalBandMultiplier: number;
  verticalCorrectionRangeMultiplier: number;
  verticalCorrectionMax: number;
  pulseFrequencyPerTick: number;
  pulseAmplitude: number;
  pulseVerticalWeight: number;
  speedBaseRatio: number;
}>;

export type SimAvoidanceTuningConfig = Readonly<{
  planetMarginWorldUnits: number;
  planetWeight: number;
  shipRadiusWorldUnits: number;
  shipWeight: number;
  shipPaddingWorldUnits: number;
  collisionPaddingWorldUnits: number;
}>;

export type SimTuningConfig = Readonly<{
  movement: SimMovementTuningConfig;
  gravity: SimGravityTuningConfig;
  boids: SimBoidsTuningConfig;
  escort: SimEscortTuningConfig;
  orbit: SimOrbitTuningConfig;
  avoidance: SimAvoidanceTuningConfig;
}>;

export type ShipComponentStatOverride = Readonly<{
  componentId: number;
  mass?: number;
  powerDraw?: number;
  thrust?: number;
  turnThrust?: number;
  fuelUsePerSecond?: number;
  fuelCapacity?: number;
  cargoCapacity?: number;
  damage?: number;
  cooldownTicks?: number;
  range?: number;
}>;

export type MatchContentOverrides = Readonly<{
  shipComponents?: readonly ShipComponentStatOverride[];
}>;

export const DEFAULT_MATCH_RULES: MatchRulesConfig = {
  capture: {
    planetCaptureSeconds: 25,
    orbitMinRadiusMultiplier: 1.55,
    orbitMaxRadiusMultiplier: 3.4,
    breakGraceTicks: 30,
  },
  spawning: {
    fighterSpawnIntervalTicks: 180,
    fighterSpawnCapPerDropShip: 4,
  },
  matchEnd: {
    durationTicks: 5 * 60 * PHASE_ONE_SIM_HZ,
  },
  npc: {
    thinkIntervalTicks: 15,
    aggroRangeWorldUnits: 130,
  },
};

export const DEFAULT_CAPTURE_DEMO_RULES: CaptureDemoRules = {
  matchDurationTicks: DEFAULT_MATCH_RULES.matchEnd.durationTicks,
  planetCaptureSeconds: DEFAULT_MATCH_RULES.capture.planetCaptureSeconds,
  captureOrbitMinRadiusMultiplier:
    DEFAULT_MATCH_RULES.capture.orbitMinRadiusMultiplier,
  captureOrbitMaxRadiusMultiplier:
    DEFAULT_MATCH_RULES.capture.orbitMaxRadiusMultiplier,
  captureBreakGraceTicks: DEFAULT_MATCH_RULES.capture.breakGraceTicks,
  fighterSpawnIntervalTicks:
    DEFAULT_MATCH_RULES.spawning.fighterSpawnIntervalTicks,
  fighterSpawnCapPerDropShip:
    DEFAULT_MATCH_RULES.spawning.fighterSpawnCapPerDropShip,
  npcThinkIntervalTicks: DEFAULT_MATCH_RULES.npc.thinkIntervalTicks,
  npcAggroRange: DEFAULT_MATCH_RULES.npc.aggroRangeWorldUnits,
};

export const DEFAULT_SIM_TUNING: SimTuningConfig = {
  movement: {
    arrivalDistanceWorldUnits: 1.8,
    slowRadiusWorldUnits: 24,
    moveOrderWeight: 1.35,
    defaultOrbitWeight: 0.95,
    approachHoldSpeedRatio: 0.12,
    approachMinSpeedRatio: 0.35,
    defaultForwardSpeedRatio: 0.55,
  },
  gravity: {
    fieldStrengthScale: 0.000003,
    rangeRadiusMultiplier: 9,
    minDistanceRatio: 0.8,
    maxStrength: 14,
    steeringWeight: 1.15,
  },
  boids: {
    neighborRadiusWorldUnits: 34,
    separationRadiusWorldUnits: 8,
    alignmentWeight: 0.34,
    cohesionWeight: 0.22,
    separationWeight: 0.9,
  },
  escort: {
    desiredRangeWorldUnits: 24,
    targetHealthRangeWeight: 1,
    innerRangeMultiplier: 0.72,
    outerRangeMultiplier: 1.28,
    matchVelocityWeight: 0.82,
    correctionSpeedRatio: 0.34,
    catchUpMinSpeedRatio: 0.28,
  },
  orbit: {
    captureRadiusMultiplier: 2.25,
    guardRadiusMultiplier: 3.05,
    activeOrbitBaseMultiplier: 2.62,
    activeOrbitJitterMultiplier: 0.32,
    defaultMinRadiusMultiplier: 2.65,
    defaultRadiusJitterMultiplier: 1.15,
    radialCorrectionMax: 0.95,
    radialCorrectionWeight: 0.58,
    verticalBandMultiplier: 0.28,
    verticalCorrectionRangeMultiplier: 0.5,
    verticalCorrectionMax: 0.42,
    pulseFrequencyPerTick: 0.037,
    pulseAmplitude: 0.08,
    pulseVerticalWeight: 0.25,
    speedBaseRatio: 0.72,
  },
  avoidance: {
    planetMarginWorldUnits: 14,
    planetWeight: 1.9,
    shipRadiusWorldUnits: 5.5,
    shipWeight: 0.85,
    shipPaddingWorldUnits: 2.4,
    collisionPaddingWorldUnits: 0.35,
  },
};

export type MatchEndReason =
  | "allPlanetsCaptured"
  | "dropShipsLost"
  | "timerPlanets"
  | "timerUnits"
  | "timerTie";

export type MatchConfig = Readonly<{
  matchId: string;
  seed: number;
  protocolVersion: number;
  contentVersion: number;
  contentHash?: string;
  commandLeadTicks: number;
  gameMode?: GameMode;
  controllers: readonly PlayerControllerConfig[];
  rules: MatchRulesConfig;
  tuning: SimTuningConfig;
  contentOverrides?: MatchContentOverrides;
  players: readonly PlayerConfig[];
  environment: MatchEnvironmentConfig;
  initialUnits: readonly InitialUnitConfig[];
  initialPlanets: readonly InitialPlanetConfig[];
}>;

export type CreateMinimalSkirmishConfigOptions = Readonly<{
  matchId?: string;
  seed?: number;
  contentHash?: string;
  players?: readonly PlayerConfig[];
  controllers?: readonly PlayerControllerConfig[];
  rules?: PartialMatchRulesConfig;
  tuning?: PartialSimTuningConfig;
  contentOverrides?: MatchContentOverrides;
  initialUnits?: readonly InitialUnitConfig[];
  initialPlanets?: readonly InitialPlanetConfig[];
}>;

export type PartialMatchRulesConfig = Readonly<{
  capture?: Partial<CaptureRulesConfig>;
  spawning?: Partial<SpawningRulesConfig>;
  matchEnd?: Partial<MatchEndRulesConfig>;
  npc?: Partial<NpcRulesConfig>;
}>;

export type PartialSimTuningConfig = Readonly<{
  movement?: Partial<SimMovementTuningConfig>;
  gravity?: Partial<SimGravityTuningConfig>;
  boids?: Partial<SimBoidsTuningConfig>;
  escort?: Partial<SimEscortTuningConfig>;
  orbit?: Partial<SimOrbitTuningConfig>;
  avoidance?: Partial<SimAvoidanceTuningConfig>;
}>;

const DEFAULT_MATCH_SEED = 1337;
const PLANET_NAMES = ["Aurora", "Vesper", "Caldera"];
const MATCH_TAU = Math.PI * 2;
const DEFAULT_PLANET_DISTANCE_MULTIPLIER = 1.25;
const DEFAULT_PLAYERS: readonly PlayerConfig[] = [
  { id: 1, name: "Player 1", color: "#74d9ff" },
  { id: 2, name: "Player 2", color: "#ff4fd8" },
];

export function createMinimalSkirmishConfig(
  options: CreateMinimalSkirmishConfigOptions | number = {}
): MatchConfig {
  const normalizedOptions =
    typeof options === "number" ? { seed: options } : options;
  const seed = normalizeSeed(normalizedOptions.seed);
  const matchId =
    !normalizedOptions.matchId
      ? `local-minimal-skirmish-${seed}`
      : normalizedOptions.matchId;
  const players = normalizedOptions.players ?? DEFAULT_PLAYERS;
  const generated = generatePlanetarySystem(seed);
  const initialUnits =
    normalizedOptions.initialUnits ??
    createInitialUnits(generated.planets[0]?.position ?? { x: 0, y: 0, z: 0 });
  const rules = resolveMatchRules(normalizedOptions.rules);
  const tuning = resolveSimTuning(normalizedOptions.tuning);

  return {
    matchId,
    seed,
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    contentHash: normalizedOptions.contentHash,
    commandLeadTicks: DEFAULT_COMMAND_LEAD_TICKS,
    gameMode: "minimalSkirmish",
    controllers:
      normalizedOptions.controllers ??
      createDefaultControllersForGame(players, "minimalSkirmish"),
    rules,
    tuning,
    contentOverrides: normalizedOptions.contentOverrides,
    players,
    environment: generated.environment,
    initialUnits,
    initialPlanets: normalizedOptions.initialPlanets ?? generated.planets,
  };
}

export function createCaptureDemoConfig(
  options: CreateMinimalSkirmishConfigOptions | number = {}
): MatchConfig {
  const normalizedOptions =
    typeof options === "number" ? { seed: options } : options;
  const base = createMinimalSkirmishConfig(options);
  const primaryPlanet = base.initialPlanets.find(
    (planet) => planet.parentPlanetIndex === null
  ) ?? base.initialPlanets[0];
  const center = primaryPlanet?.position ?? { x: 0, y: 0, z: 0 };
  const initialUnits = createCaptureDemoUnits(center);

  return {
    ...base,
    matchId: base.matchId.replace("minimal-skirmish", "capture-demo"),
    gameMode: "captureDemo",
    controllers:
      normalizedOptions.controllers ??
      createDefaultControllersForGame(base.players, "captureDemo"),
    rules: base.rules,
    initialUnits:
      normalizedOptions.initialUnits ? normalizedOptions.initialUnits : initialUnits,
    initialPlanets:
      normalizedOptions.initialPlanets
        ? normalizedOptions.initialPlanets
        : base.initialPlanets.map((planet, index) => ({
            ...planet,
            capturable: planet.parentPlanetIndex === null,
            initialOwner: index === 0 ? 0 : undefined,
          })),
  };
}

export function createDefaultControllersForGame(
  players: readonly PlayerConfig[],
  gameMode: GameMode | undefined
): readonly PlayerControllerConfig[] {
  return createDefaultControllers(
    players,
    "human",
    gameMode === "captureDemo"
      ? new Map<PlayerId, PlayerControllerType>([[2, "npc"]])
      : new Map<PlayerId, PlayerControllerType>()
  );
}

export function createDefaultControllers(
  players: readonly PlayerConfig[],
  fallbackType: PlayerControllerType,
  overrides: ReadonlyMap<PlayerId, PlayerControllerType> = new Map()
): readonly PlayerControllerConfig[] {
  return players.map((player) => ({
    playerId: player.id,
    type: overrides.get(player.id) ?? fallbackType,
  }));
}

export function resolveMatchRules(
  overrides: PartialMatchRulesConfig | undefined,
  legacyCaptureDemoRules?: CaptureDemoRules
): MatchRulesConfig {
  const legacyRules = legacyCaptureDemoRules
    ? captureDemoRulesToMatchRules(legacyCaptureDemoRules)
    : undefined;

  return {
    capture: {
      ...DEFAULT_MATCH_RULES.capture,
      ...legacyRules?.capture,
      ...overrides?.capture,
    },
    spawning: {
      ...DEFAULT_MATCH_RULES.spawning,
      ...legacyRules?.spawning,
      ...overrides?.spawning,
    },
    matchEnd: {
      ...DEFAULT_MATCH_RULES.matchEnd,
      ...legacyRules?.matchEnd,
      ...overrides?.matchEnd,
    },
    npc: {
      ...DEFAULT_MATCH_RULES.npc,
      ...legacyRules?.npc,
      ...overrides?.npc,
    },
  };
}

function captureDemoRulesToMatchRules(
  rules: CaptureDemoRules
): MatchRulesConfig {
  return {
    capture: {
      planetCaptureSeconds: rules.planetCaptureSeconds,
      orbitMinRadiusMultiplier: rules.captureOrbitMinRadiusMultiplier,
      orbitMaxRadiusMultiplier: rules.captureOrbitMaxRadiusMultiplier,
      breakGraceTicks: rules.captureBreakGraceTicks,
    },
    spawning: {
      fighterSpawnIntervalTicks: rules.fighterSpawnIntervalTicks,
      fighterSpawnCapPerDropShip: rules.fighterSpawnCapPerDropShip,
    },
    matchEnd: {
      durationTicks: rules.matchDurationTicks,
    },
    npc: {
      thinkIntervalTicks: rules.npcThinkIntervalTicks,
      aggroRangeWorldUnits: rules.npcAggroRange,
    },
  };
}

export function resolveSimTuning(
  overrides: PartialSimTuningConfig | undefined
): SimTuningConfig {
  return {
    movement: {
      ...DEFAULT_SIM_TUNING.movement,
      ...overrides?.movement,
    },
    gravity: {
      ...DEFAULT_SIM_TUNING.gravity,
      ...overrides?.gravity,
    },
    boids: {
      ...DEFAULT_SIM_TUNING.boids,
      ...overrides?.boids,
    },
    escort: {
      ...DEFAULT_SIM_TUNING.escort,
      ...overrides?.escort,
    },
    orbit: {
      ...DEFAULT_SIM_TUNING.orbit,
      ...overrides?.orbit,
    },
    avoidance: {
      ...DEFAULT_SIM_TUNING.avoidance,
      ...overrides?.avoidance,
    },
  };
}

function createCaptureDemoUnits(
  primaryPlanetPosition: Vec3Data
): readonly InitialUnitConfig[] {
  const offsets: InitialUnitConfig[] = [];
  const addFleet = (
    owner: PlayerId,
    anchor: Vec3Data,
    facing: 1 | -1
  ): void => {
    offsets.push({
      owner,
      templateId: TEMPLATE_IDS.dropShip,
      position: anchor,
    });

    const fighterOffsets: readonly Vec3Data[] = [
      { x: -18, y: 5, z: -12 },
      { x: -12, y: -5, z: 8 },
      { x: 0, y: 8, z: -18 },
      { x: 8, y: -7, z: 14 },
      { x: 16, y: 4, z: -6 },
      { x: 22, y: -3, z: 10 },
    ];

    for (const offset of fighterOffsets) {
      offsets.push({
        owner,
        templateId: TEMPLATE_IDS.fighterShip,
        position: {
          x: anchor.x + offset.x * facing,
          y: anchor.y + offset.y,
          z: anchor.z + offset.z,
        },
      });
    }

    offsets.push(
      {
        owner,
        templateId: TEMPLATE_IDS.battleship,
        position: {
          x: anchor.x - 32 * facing,
          y: anchor.y,
          z: anchor.z + 24,
        },
      },
      {
        owner,
        templateId: TEMPLATE_IDS.battleship,
        position: {
          x: anchor.x + 34 * facing,
          y: anchor.y + 2,
          z: anchor.z + 30,
        },
      }
    );
  };

  addFleet(1, { x: -360, y: 8, z: -260 }, 1);
  addFleet(2, { x: 360, y: 8, z: 260 }, -1);

  return offsets.map((unit) => ({
    ...unit,
    position: {
      x: quantize(primaryPlanetPosition.x + unit.position.x),
      y: quantize(primaryPlanetPosition.y + unit.position.y),
      z: quantize(primaryPlanetPosition.z + unit.position.z),
    },
  }));
}

function generatePlanetarySystem(seed: number): {
  environment: MatchEnvironmentConfig;
  planets: readonly InitialPlanetConfig[];
} {
  const random = createSeededRandom(seed, "match-system");
  const planetCount = 1 + randomInt(random, 3);
  const sunDirection = sampleOrbitAxis(random);
  const sunDistance = quantize(1800 + random() * 1800);
  const sunOrbitCenter = {
    x: quantize(sunDirection.x * 36),
    y: quantize(sunDirection.y * 12),
    z: quantize(sunDirection.z * 36),
  };
  const planets: InitialPlanetConfig[] = [];
  let remainingBodies = 4 - planetCount;
  let generatedMoonCount = 0;

  for (let index = 0; index < planetCount; index += 1) {
    const radius = quantize(24 + random() * 20);
    const appearance = samplePlanetAppearance(random, radius, false);
    const orbitAxis = sampleOrbitAxis(random);
    const orbitRadius =
      (index === 0 ? 64 : 126 + index * 82 + random() * 34) *
      DEFAULT_PLANET_DISTANCE_MULTIPLIER;
    const orbit: PlanetOrbitConfig = {
      center: sunOrbitCenter,
      radius: quantize(orbitRadius),
      phase: quantize(index === 0 ? -Math.PI / 2 : random() * MATCH_TAU),
      angularSpeed: sampleAngularSpeed(random, false),
    };
    const position = positionOnOrbit(
      orbit.center,
      orbitAxis,
      orbit.radius,
      orbit.phase
    );
    const parentPlanetIndex = planets.length;
    const planet: InitialPlanetConfig = {
      templateId: TEMPLATE_IDS.billboardPlanet,
      name: PLANET_NAMES[index] ?? `Planet ${index + 1}`,
      position,
      mass: quantize(
        7_200_000_000 * Math.pow(radius / 28, 3) * (0.9 + random() * 0.22)
      ),
      radius,
      color: samplePlanetColor(random, index, false, appearance.planetClass),
      hasAtmosphere:
        appearance.planetClass !== "ice" || random() < 0.42,
      appearance,
      orbitAxis,
      orbit,
      parentPlanetIndex: null,
    };

    planets.push(planet);

    const maxMoons = Math.min(2, remainingBodies);
    let moonCount = randomInt(random, maxMoons + 1);

    if (generatedMoonCount === 0 && maxMoons > 0) {
      moonCount = Math.max(moonCount, 1);
    }

    remainingBodies -= moonCount;
    generatedMoonCount += moonCount;

    for (let moonIndex = 0; moonIndex < moonCount; moonIndex += 1) {
      const moonRadius = quantize(radius * (0.22 + random() * 0.16));
      const appearance = samplePlanetAppearance(random, moonRadius, true);
      const moonAxis = sampleOrbitAxis(random);
      const moonDistance =
        (radius * (2.05 + random() * 1.2) + moonRadius) *
        DEFAULT_PLANET_DISTANCE_MULTIPLIER;
      const moonOrbit: PlanetOrbitConfig = {
        center: position,
        radius: quantize(moonDistance),
        phase: quantize(random() * MATCH_TAU),
        angularSpeed: sampleAngularSpeed(random, true),
      };
      planets.push({
        templateId: TEMPLATE_IDS.billboardPlanet,
        name: `${planet.name} ${moonIndex + 1}`,
        position: positionOnOrbit(
          position,
          moonAxis,
          moonOrbit.radius,
          moonOrbit.phase
        ),
        mass: quantize(
          planet.mass * Math.pow(moonRadius / Math.max(radius, 1), 3) * 0.8
        ),
        radius: moonRadius,
        color: samplePlanetColor(
          random,
          planets.length,
          true,
          appearance.planetClass
        ),
        hasAtmosphere: false,
        appearance,
        orbitAxis: moonAxis,
        orbit: moonOrbit,
        parentPlanetIndex,
      });
    }
  }

  enforceSingleRingedPlanet(planets);

  return {
    environment: {
      sun: {
        position: {
          x: quantize(sunDirection.x * sunDistance),
          y: quantize(sunDirection.y * sunDistance),
          z: quantize(sunDirection.z * sunDistance),
        },
        orbitCenter: sunOrbitCenter,
        distance: sunDistance,
        color: "#b99cff",
      },
    },
    planets,
  };
}

function enforceSingleRingedPlanet(planets: InitialPlanetConfig[]): void {
  const ringedIndex = selectRingedPlanetIndex(planets);

  if (ringedIndex === -1) {
    return;
  }

  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];
    const hasRings = index === ringedIndex;

    if (planet.appearance.hasRings === hasRings) {
      continue;
    }

    planets[index] = {
      ...planet,
      appearance: {
        ...planet.appearance,
        hasRings,
      },
    };
  }
}

function selectRingedPlanetIndex(planets: readonly InitialPlanetConfig[]): number {
  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];

    if (planet.parentPlanetIndex === null && planet.appearance.hasRings) {
      return index;
    }
  }

  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];

    if (
      planet.parentPlanetIndex === null &&
      planet.appearance.planetClass === "gas-giant"
    ) {
      return index;
    }
  }

  return planets.findIndex((planet) => planet.parentPlanetIndex === null);
}

function createInitialUnits(
  primaryPlanetPosition: Vec3Data
): readonly InitialUnitConfig[] {
  const offsets: readonly InitialUnitConfig[] = [
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -38, y: 2, z: 84 },
    },
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -28, y: 6, z: 96 },
    },
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -52, y: -3, z: 76 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 38, y: 2, z: 84 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 28, y: 6, z: 96 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 52, y: -3, z: 76 },
    },
  ];

  return offsets.map((unit) => ({
    ...unit,
    position: {
      x: quantize(primaryPlanetPosition.x + unit.position.x),
      y: quantize(primaryPlanetPosition.y + unit.position.y),
      z: quantize(primaryPlanetPosition.z + unit.position.z),
    },
  }));
}

function samplePlanetColor(
  random: () => number,
  index: number,
  muted: boolean,
  planetClass: PlanetClass
): string {
  const goldenRatioConjugate = 0.618033988749895;
  let hue: number;
  let saturation: number;
  let value: number;

  if (planetClass === "gas-giant") {
    const palette = random();
    if (palette < 0.25) {
      hue = 0.55 + random() * 0.08;
    } else if (palette < 0.5) {
      hue = 0.72 + random() * 0.08;
    } else if (palette < 0.75) {
      hue = 0.035 + random() * 0.08;
    } else {
      hue = 0.22 + random() * 0.08;
    }
    saturation = muted ? 0.24 + random() * 0.16 : 0.38 + random() * 0.26;
    value = muted ? 0.46 + random() * 0.18 : 0.58 + random() * 0.26;
  } else if (planetClass === "ice") {
    hue = 0.52 + random() * 0.12;
    saturation = muted ? 0.12 + random() * 0.1 : 0.18 + random() * 0.16;
    value = muted ? 0.54 + random() * 0.16 : 0.66 + random() * 0.2;
  } else {
    hue = (0.36 + index * goldenRatioConjugate + random() * 0.16) % 1;
    saturation = muted ? 0.2 + random() * 0.14 : 0.42 + random() * 0.24;
    value = muted ? 0.42 + random() * 0.16 : 0.48 + random() * 0.24;
  }

  const rgb = hsvToRgb(hue, saturation, value);

  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function samplePlanetAppearance(
  random: () => number,
  radius: number,
  moon: boolean
): PlanetAppearanceConfig {
  const sizeBias = moon
    ? clamp((radius - 6) / 10, 0, 1)
    : clamp((radius - 24) / 20, 0, 1);
  const roll = random();
  let planetClass: PlanetClass;

  if (moon) {
    planetClass = roll < 0.72 + sizeBias * 0.08 ? "ice" : "terran";
  } else if (roll < 0.26 + sizeBias * 0.26) {
    planetClass = "gas-giant";
  } else if (roll < 0.76) {
    planetClass = "terran";
  } else {
    planetClass = "ice";
  }

  const ringChance =
    planetClass === "gas-giant" ? 0.62 : planetClass === "ice" ? 0.16 : 0.07;
  const hasRings = random() < (moon ? ringChance * 0.12 : ringChance);

  return {
    planetClass,
    hasRings,
    seed: quantize(17 + random() * 983),
  };
}

function sampleOrbitAxis(random: () => number): Vec3Data {
  const z = random() * 1.7 - 0.85;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(1 - z * z, 0.01));

  return {
    x: quantize(Math.cos(angle) * radius),
    y: quantize(z),
    z: quantize(Math.sin(angle) * radius),
  };
}

function sampleAngularSpeed(random: () => number, moon: boolean): number {
  const magnitude = moon ? 0.032 + random() * 0.038 : 0.006 + random() * 0.009;
  const direction = random() < 0.5 ? -1 : 1;

  return quantize(magnitude * direction);
}

function positionOnOrbit(
  center: Vec3Data,
  axis: Vec3Data,
  radius: number,
  phase: number
): Vec3Data {
  const basis = orbitBasis(axis);
  const phaseCos = Math.cos(phase);
  const phaseSin = Math.sin(phase);

  return {
    x: quantize(
      center.x +
        (basis.tangent.x * phaseCos + basis.bitangent.x * phaseSin) * radius
    ),
    y: quantize(
      center.y +
        (basis.tangent.y * phaseCos + basis.bitangent.y * phaseSin) * radius
    ),
    z: quantize(
      center.z +
        (basis.tangent.z * phaseCos + basis.bitangent.z * phaseSin) * radius
    ),
  };
}

function orbitBasis(axis: Vec3Data): {
  tangent: Vec3Data;
  bitangent: Vec3Data;
} {
  const normal = normalizeVec3(axis);
  const reference =
    Math.abs(normal.y) < 0.82 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const tangent = normalizeVec3(crossVec3(reference, normal));

  return {
    tangent,
    bitangent: normalizeVec3(crossVec3(normal, tangent)),
  };
}

function normalizeVec3(vector: Vec3Data): Vec3Data {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 0.000001) {
    return { x: 0, y: 1, z: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function crossVec3(a: Vec3Data, b: Vec3Data): Vec3Data {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function hsvToRgb(
  hue: number,
  saturation: number,
  value: number
): { r: number; g: number; b: number } {
  const sector = Math.floor(hue * 6);
  const fraction = hue * 6 - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);

  switch (sector % 6) {
    case 0:
      return { r: value, g: t, b: p };
    case 1:
      return { r: q, g: value, b: p };
    case 2:
      return { r: p, g: value, b: t };
    case 3:
      return { r: p, g: q, b: value };
    case 4:
      return { r: t, g: p, b: value };
    default:
      return { r: value, g: p, b: q };
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function toHexByte(value: number): string {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

function createSeededRandom(seed: number, salt: string): () => number {
  let state = mixSeed(seed, salt);

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function mixSeed(seed: number, salt: string): number {
  let hash = seed >>> 0;

  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash || 0x9e3779b9;
}

function randomInt(random: () => number, exclusiveMax: number): number {
  return Math.floor(random() * exclusiveMax);
}

function normalizeSeed(seed: number | undefined): number {
  return seed !== undefined && Number.isFinite(seed)
    ? Math.floor(seed) >>> 0
    : DEFAULT_MATCH_SEED;
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
