import type { PlayerId } from "./handles";
import type { UnitOrderIntent } from "./commands";

export const PROTOCOL_VERSION = 1;
export const CONTENT_VERSION = 3;
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

export type ShipClassId = (typeof SHIP_CLASS_IDS)[keyof typeof SHIP_CLASS_IDS];

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
  eccentricity?: number;
  periapsisAngle?: number;
}>;

export type PlanetClass = "gas-giant" | "terran" | "ice" | "sun";

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
  dropShipThreatRangeWorldUnits: number;
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
  npcDropShipThreatRange?: number;
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
  minRange?: number;
  range?: number;
}>;

export type MatchContentOverrides = Readonly<{
  shipComponents?: readonly ShipComponentStatOverride[];
}>;

const DEFAULT_MATCH_DURATION_MINUTES = 8;

export const DEFAULT_MATCH_RULES: MatchRulesConfig = {
  capture: {
    planetCaptureSeconds: 15,
    orbitMinRadiusMultiplier: 1,
    orbitMaxRadiusMultiplier: 3,
    breakGraceTicks: 30,
  },
  spawning: {
    fighterSpawnIntervalTicks: 75,
    fighterSpawnCapPerDropShip: 7,
  },
  matchEnd: {
    durationTicks: DEFAULT_MATCH_DURATION_MINUTES * 60 * PHASE_ONE_SIM_HZ,
  },
  npc: {
    thinkIntervalTicks: 30,
    aggroRangeWorldUnits: 220,
    dropShipThreatRangeWorldUnits: 300,
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
  npcDropShipThreatRange: DEFAULT_MATCH_RULES.npc.dropShipThreatRangeWorldUnits,
};

export const DEFAULT_SIM_TUNING: SimTuningConfig = {
  movement: {
    arrivalDistanceWorldUnits: 1.8,
    slowRadiusWorldUnits: 24,
    moveOrderWeight: 2.3,
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
    alignmentWeight: 0.17,
    cohesionWeight: 0.11,
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
    captureRadiusMultiplier: 3,
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
  | "timerTie"
  | "disconnect"
  | "desync";

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

type SunColorStop = Readonly<{
  position: number;
  color: readonly [number, number, number];
}>;

const DEFAULT_MATCH_SEED = 1337;
const PLANET_NAMES = [
  "Aurora",
  "Vesper",
  "Caldera",
  "Meridian",
  "Lumen",
  "Nadir",
  "Zenith",
  "Obsidian",
  "Solace",
  "Icarus",
];
const MATCH_TAU = Math.PI * 2;
const DEFAULT_PLANET_DISTANCE_MULTIPLIER = 1.5;
const PARENT_PLANET_RADIUS_SCALE = 9.75;
const PARENT_PLANET_RADIUS_VARIANCE = 0.2;
const MOON_RADIUS_SCALE = 0.85;
const MOON_DISTANCE_SCALE = 1.2;
const SUN_PLANET_RADIUS = 1200;
const SUN_PLANET_MASS = 900_000_000_000_000;
const PARENT_PLANET_INNER_ORBIT_RADIUS = 4200;
const PARENT_PLANET_OUTER_ORBIT_RADIUS = 12500;
const PARENT_PLANET_OUTER_ORBIT_COUNT_BONUS = 420;
const PARENT_PLANET_ORBIT_EXPONENT = 1.18;
const PARENT_PLANET_ORBIT_JITTER = 260;
const PARENT_PLANET_PHASE_JITTER = 0.24;
const PARENT_PLANET_MIN_ECCENTRICITY = 0.035;
const PARENT_PLANET_ECCENTRICITY_RANGE = 0.17;
const PARENT_PLANET_INCLINATION_JITTER = 0.035;
const CAPTURE_DEMO_RIM_SPAWN_PADDING = 60;
const CAPTURE_DEMO_FRONTLINE_CAPTURE_ORBIT_EXTRA = 900;
const CAPTURE_DEMO_FLEET_DEPTH_SCALE = 0.75;
const CAPTURE_DEMO_FLEET_LATERAL_SCALE = 0.9;
const MINIMAL_SKIRMISH_PLANET_SPAWN_PADDING = 95;
const SUN_COLOR_STOPS: readonly SunColorStop[] = [
  { position: 0, color: [0.42, 0.68, 1] },
  { position: 0.22, color: [0.7, 0.86, 1] },
  { position: 0.45, color: [1, 0.97, 0.86] },
  { position: 0.66, color: [1, 0.82, 0.48] },
  { position: 0.84, color: [1, 0.58, 0.27] },
  { position: 1, color: [1, 0.28, 0.22] },
];
const MIN_GENERATED_PLANETS = 7;
const MAX_GENERATED_PLANETS = 10;
const MIN_PARENT_PLANETS = 6;
const MAX_MOONS_PER_PLANET = 2;
const SYSTEM_SUN_POSITION: Vec3Data = { x: 0, y: 0, z: 0 };
const DEFAULT_PLAYERS: readonly PlayerConfig[] = [
  { id: 1, name: "Player 1", color: "#74d9ff" },
  { id: 2, name: "Player 2", color: "#ff4fd8" },
];

export function createMinimalSkirmishConfig(
  options: CreateMinimalSkirmishConfigOptions | number = {},
): MatchConfig {
  const normalizedOptions =
    typeof options === "number" ? { seed: options } : options;
  const seed = normalizeSeed(normalizedOptions.seed);
  const matchId = !normalizedOptions.matchId
    ? `local-minimal-skirmish-${seed}`
    : normalizedOptions.matchId;
  const players = normalizedOptions.players ?? DEFAULT_PLAYERS;
  const generated = generatePlanetarySystem(seed);
  const primaryPlanet = readFirstPrimaryPlanet(generated.planets);
  const primaryPlanetPosition =
    primaryPlanet?.position ?? ({ x: 0, y: 0, z: 0 } as const);
  const initialUnits =
    normalizedOptions.initialUnits ??
    createInitialUnits(primaryPlanetPosition, primaryPlanet?.radius ?? 0);
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
  options: CreateMinimalSkirmishConfigOptions | number = {},
): MatchConfig {
  const normalizedOptions =
    typeof options === "number" ? { seed: options } : options;
  const base = createMinimalSkirmishConfig(options);
  const initialUnits = createCaptureDemoUnits(
    base.initialPlanets,
    base.rules.capture.orbitMaxRadiusMultiplier,
  );

  return {
    ...base,
    matchId: base.matchId.replace("minimal-skirmish", "capture-demo"),
    gameMode: "captureDemo",
    controllers:
      normalizedOptions.controllers ??
      createDefaultControllersForGame(base.players, "captureDemo"),
    rules: base.rules,
    initialUnits: normalizedOptions.initialUnits
      ? normalizedOptions.initialUnits
      : initialUnits,
    initialPlanets: normalizedOptions.initialPlanets
      ? normalizedOptions.initialPlanets
      : createCaptureDemoPlanets(base.initialPlanets),
  };
}

function createCaptureDemoPlanets(
  planets: readonly InitialPlanetConfig[],
): readonly InitialPlanetConfig[] {
  return planets.map((planet) => {
    if (planet.parentPlanetIndex !== null) {
      return {
        ...planet,
        capturable: false,
        initialOwner: undefined,
      };
    }

    return {
      ...planet,
      capturable: true,
      initialOwner: 0,
    };
  });
}

export function createDefaultControllersForGame(
  players: readonly PlayerConfig[],
  gameMode: GameMode | undefined,
): readonly PlayerControllerConfig[] {
  return createDefaultControllers(
    players,
    "human",
    gameMode === "captureDemo"
      ? new Map<PlayerId, PlayerControllerType>([[2, "npc"]])
      : new Map<PlayerId, PlayerControllerType>(),
  );
}

export function createDefaultControllers(
  players: readonly PlayerConfig[],
  fallbackType: PlayerControllerType,
  overrides: ReadonlyMap<PlayerId, PlayerControllerType> = new Map(),
): readonly PlayerControllerConfig[] {
  return players.map((player) => ({
    playerId: player.id,
    type: overrides.get(player.id) ?? fallbackType,
  }));
}

export function resolveMatchRules(
  overrides: PartialMatchRulesConfig | undefined,
  legacyCaptureDemoRules?: CaptureDemoRules,
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
  rules: CaptureDemoRules,
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
      dropShipThreatRangeWorldUnits:
        rules.npcDropShipThreatRange ?? rules.npcAggroRange,
    },
  };
}

export function resolveSimTuning(
  overrides: PartialSimTuningConfig | undefined,
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
  planets: readonly InitialPlanetConfig[],
  captureOrbitMaxRadiusMultiplier =
    DEFAULT_MATCH_RULES.capture.orbitMaxRadiusMultiplier,
): readonly InitialUnitConfig[] {
  const primaryPlanetPosition =
    readFirstPrimaryPlanet(planets)?.position ??
    planets[0]?.position ??
    ({ x: 0, y: 0, z: 0 } as const);
  const offsets: InitialUnitConfig[] = [];
  const addSquadron = (
    owner: PlayerId,
    anchor: Vec3Data,
    facing: 1 | -1,
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
          z: anchor.z + offset.z * facing,
        },
      });
    }
  };

  const addBattleships = (
    owner: PlayerId,
    anchors: readonly Vec3Data[],
    facing: 1 | -1,
  ): void => {
    const battleshipOffsets: readonly (Vec3Data & { anchorIndex: number })[] = [
      { anchorIndex: 0, x: -32, y: 0, z: 24 },
      { anchorIndex: 0, x: 34, y: 2, z: 30 },
      { anchorIndex: 1, x: -38, y: 4, z: -24 },
      { anchorIndex: 2, x: 30, y: -2, z: 26 },
      { anchorIndex: 3, x: -28, y: 3, z: -30 },
      { anchorIndex: 4, x: 36, y: -1, z: 22 },
      { anchorIndex: 5, x: -34, y: 5, z: 28 },
      { anchorIndex: 6, x: 32, y: 1, z: -26 },
    ];

    for (const offset of battleshipOffsets) {
      const anchor = anchors[offset.anchorIndex] ?? anchors[0];

      if (!anchor) {
        continue;
      }

      offsets.push({
        owner,
        templateId: TEMPLATE_IDS.battleship,
        position: {
          x: anchor.x + offset.x * facing,
          y: anchor.y + offset.y,
          z: anchor.z + offset.z * facing,
        },
      });
    }
  };

  const playerOneAnchors: readonly Vec3Data[] = [
    { x: -2140, y: 8, z: -1520 },
    { x: -1760, y: 12, z: 260 },
    { x: -1320, y: 10, z: 1820 },
    { x: -360, y: 14, z: -2180 },
    { x: 260, y: 9, z: -520 },
    { x: 860, y: 13, z: 1320 },
    { x: 1840, y: 11, z: -1040 },
  ];
  const playerTwoAnchors: readonly Vec3Data[] = [
    { x: 2140, y: 8, z: 1520 },
    { x: 1760, y: 12, z: -260 },
    { x: 1320, y: 10, z: -1820 },
    { x: 360, y: 14, z: 2180 },
    { x: -260, y: 9, z: 520 },
    { x: -860, y: 13, z: -1320 },
    { x: -1840, y: 11, z: 1040 },
  ];

  for (const anchor of playerOneAnchors) {
    addSquadron(1, anchor, 1);
  }

  addBattleships(1, playerOneAnchors, 1);

  for (const anchor of playerTwoAnchors) {
    addSquadron(2, anchor, -1);
  }

  addBattleships(2, playerTwoAnchors, -1);

  const centeredUnits = offsets.map((unit) => ({
    ...unit,
    position: {
      x: quantize(primaryPlanetPosition.x + unit.position.x),
      y: quantize(primaryPlanetPosition.y + unit.position.y),
      z: quantize(primaryPlanetPosition.z + unit.position.z),
    },
  }));

  return moveCaptureDemoFleetsToOuterRim(
    centeredUnits,
    planets,
    captureOrbitMaxRadiusMultiplier,
  );
}

function moveCaptureDemoFleetsToOuterRim(
  units: readonly InitialUnitConfig[],
  planets: readonly InitialPlanetConfig[],
  captureOrbitMaxRadiusMultiplier: number,
): readonly InitialUnitConfig[] {
  const center = readPlanetarySystemCenter(planets);
  const mapRadius = readParentPlanetMapRadius(planets, center);
  const playerOneCentroid = averagePosition(
    units.filter((unit) => unit.owner === 1).map((unit) => unit.position),
  );
  const playerTwoCentroid = averagePosition(
    units.filter((unit) => unit.owner === 2).map((unit) => unit.position),
  );
  const axis = normalizeVec3OrFallback(
    subtractVec3(playerTwoCentroid, playerOneCentroid),
    { x: 1, y: 0, z: 1 },
  );
  const outerPlanets = readOutermostOpposingPlanets(
    planets,
    center,
    axis,
    mapRadius,
  );

  if (!outerPlanets) {
    const spawnDistance = mapRadius + CAPTURE_DEMO_RIM_SPAWN_PADDING;
    const targetCentroids: Readonly<Record<1 | 2, Vec3Data>> = {
      1: addVec3(center, scaleVec3(axis, -spawnDistance)),
      2: addVec3(center, scaleVec3(axis, spawnDistance)),
    };
    const sourceCentroids: Readonly<Record<1 | 2, Vec3Data>> = {
      1: playerOneCentroid,
      2: playerTwoCentroid,
    };

    return units.map((unit) => {
      const owner = unit.owner === 1 ? 1 : 2;
      const offset = subtractVec3(unit.position, sourceCentroids[owner]);

      return {
        ...unit,
        position: addVec3(targetCentroids[owner], offset),
      };
    });
  }

  const outerDeploymentAxis = normalizeVec3OrFallback(
    subtractVec3(outerPlanets[2].position, outerPlanets[1].position),
    axis,
  );
  const sourceCentroids: Readonly<Record<1 | 2, Vec3Data>> = {
    1: playerOneCentroid,
    2: playerTwoCentroid,
  };
  const outerDeployment: Readonly<
    Record<1 | 2, CaptureDemoPlayerDeployment>
  > = {
    1: readPlayerDeployment(
      units,
      sourceCentroids[1],
      outerPlanets[1],
      center,
      outerDeploymentAxis,
      1,
      captureOrbitMaxRadiusMultiplier,
    ),
    2: readPlayerDeployment(
      units,
      sourceCentroids[2],
      outerPlanets[2],
      center,
      outerDeploymentAxis,
      2,
      captureOrbitMaxRadiusMultiplier,
    ),
  };
  const outerUnits = units.map((unit) => ({
    ...unit,
    position: readCaptureDemoDeployedUnitPosition(
      unit.position,
      outerDeployment[unit.owner === 1 ? 1 : 2],
      1,
      1,
    ),
  }));
  const outerPlayerOneCentroid = averagePosition(
    outerUnits.filter((unit) => unit.owner === 1).map((unit) => unit.position),
  );
  const outerPlayerTwoCentroid = averagePosition(
    outerUnits.filter((unit) => unit.owner === 2).map((unit) => unit.position),
  );
  const closePairAxis = normalizeVec3OrFallback(
    subtractVec3(outerPlayerTwoCentroid, outerPlayerOneCentroid),
    outerDeploymentAxis,
  );
  const closePlanets =
    readClosestOpposedOuterPlanets(
      planets,
      center,
      closePairAxis,
      mapRadius,
    ) ?? outerPlanets;
  const primaryPlanets = planets.filter(isPrimaryPlanet);
  const closeDeployment: Readonly<
    Record<1 | 2, CaptureDemoPlayerDeployment>
  > = {
    1: readClosePairDeployment(
      outerUnits,
      primaryPlanets,
      closePlanets[1],
      center,
      closePairAxis,
      1,
      captureOrbitMaxRadiusMultiplier,
    ),
    2: readClosePairDeployment(
      outerUnits,
      primaryPlanets,
      closePlanets[2],
      center,
      closePairAxis,
      2,
      captureOrbitMaxRadiusMultiplier,
    ),
  };

  return outerUnits.map((unit) => ({
    ...unit,
    position: readCaptureDemoDeployedUnitPosition(
      unit.position,
      closeDeployment[unit.owner === 1 ? 1 : 2],
      CAPTURE_DEMO_FLEET_DEPTH_SCALE,
      CAPTURE_DEMO_FLEET_LATERAL_SCALE,
    ),
  }));
}

type CaptureDemoPlayerDeployment = Readonly<{
  sourceFrontline: Vec3Data;
  targetFrontline: Vec3Data;
  outward: Vec3Data;
}>;

function readOutermostOpposingPlanets(
  planets: readonly InitialPlanetConfig[],
  center: Vec3Data,
  axis: Vec3Data,
  mapRadius: number,
): Readonly<Record<1 | 2, InitialPlanetConfig>> | null {
  const candidates = planets.filter(isPrimaryPlanet);

  if (candidates.length < 2) {
    return null;
  }

  let bestPair: readonly [InitialPlanetConfig, InitialPlanetConfig] | null =
    null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const left of candidates) {
    for (const right of candidates) {
      if (left === right) {
        continue;
      }

      const leftOffset = subtractVec3(left.position, center);
      const rightOffset = subtractVec3(right.position, center);
      const leftDirection = normalizeVec3OrFallback(leftOffset, axis);
      const rightDirection = normalizeVec3OrFallback(
        rightOffset,
        scaleVec3(axis, -1),
      );
      const opposition = (1 - dotVec3(leftDirection, rightDirection)) / 2;
      const leftSurfaceRadius = lengthVec3(leftOffset) + left.radius;
      const rightSurfaceRadius = lengthVec3(rightOffset) + right.radius;
      const minSurfaceRadius = Math.min(leftSurfaceRadius, rightSurfaceRadius);
      const averageSurfaceRadius =
        (leftSurfaceRadius + rightSurfaceRadius) / 2;
      const score =
        minSurfaceRadius +
        averageSurfaceRadius * 0.15 +
        opposition * mapRadius * 0.35;

      if (score > bestScore) {
        bestPair = [left, right];
        bestScore = score;
      }
    }
  }

  if (!bestPair) {
    return null;
  }

  const firstProjection = dotVec3(
    subtractVec3(bestPair[0].position, center),
    axis,
  );
  const secondProjection = dotVec3(
    subtractVec3(bestPair[1].position, center),
    axis,
  );

  return firstProjection <= secondProjection
    ? { 1: bestPair[0], 2: bestPair[1] }
    : { 1: bestPair[1], 2: bestPair[0] };
}

function readClosestOpposedOuterPlanets(
  planets: readonly InitialPlanetConfig[],
  center: Vec3Data,
  axis: Vec3Data,
  mapRadius: number,
): Readonly<Record<1 | 2, InitialPlanetConfig>> | null {
  const candidates = planets.filter(isPrimaryPlanet);

  let bestPair:
    | Readonly<{
        left: InitialPlanetConfig;
        right: InitialPlanetConfig;
      }>
    | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const left of candidates) {
    const leftOffset = subtractVec3(left.position, center);
    const leftProjection = dotVec3(leftOffset, axis);
    const leftSurfaceRadius = lengthVec3(leftOffset) + left.radius;

    if (leftProjection >= 0 || leftSurfaceRadius < mapRadius * 0.48) {
      continue;
    }

    for (const right of candidates) {
      const rightOffset = subtractVec3(right.position, center);
      const rightProjection = dotVec3(rightOffset, axis);
      const rightSurfaceRadius = lengthVec3(rightOffset) + right.radius;

      if (
        left === right ||
        rightProjection <= 0 ||
        rightSurfaceRadius < mapRadius * 0.48
      ) {
        continue;
      }

      const pairDistance = distanceVec3(left.position, right.position);
      const outerness =
        Math.min(leftSurfaceRadius, rightSurfaceRadius) / mapRadius;
      const opposition =
        Math.min(Math.abs(leftProjection) + Math.abs(rightProjection), mapRadius * 2) /
        (mapRadius * 2);
      const score =
        -pairDistance +
        outerness * mapRadius * 0.65 +
        opposition * mapRadius * 0.35;

      if (score > bestScore) {
        bestPair = { left, right };
        bestScore = score;
      }
    }
  }

  if (!bestPair) {
    return null;
  }

  return { 1: bestPair.left, 2: bestPair.right };
}

function readPlayerDeployment(
  units: readonly InitialUnitConfig[],
  sourceCentroid: Vec3Data,
  planet: InitialPlanetConfig,
  center: Vec3Data,
  axis: Vec3Data,
  owner: PlayerId,
  captureOrbitMaxRadiusMultiplier: number,
): CaptureDemoPlayerDeployment {
  const outward = normalizeVec3OrFallback(
    subtractVec3(planet.position, center),
    owner === 1 ? scaleVec3(axis, -1) : axis,
  );
  const frontlineDropShip =
    units
      .filter(
        (unit) =>
          unit.owner === owner && unit.templateId === TEMPLATE_IDS.dropShip,
      )
      .sort((left, right) => {
        const leftOffset = subtractVec3(left.position, sourceCentroid);
        const rightOffset = subtractVec3(right.position, sourceCentroid);

        return dotVec3(leftOffset, outward) - dotVec3(rightOffset, outward);
      })[0] ?? null;
  const sourceOffset = frontlineDropShip
    ? subtractVec3(frontlineDropShip.position, sourceCentroid)
    : ({ x: 0, y: 0, z: 0 } as const);
  const frontlineTarget = addVec3(
    planet.position,
    scaleVec3(
      outward,
      planet.radius * captureOrbitMaxRadiusMultiplier +
        CAPTURE_DEMO_FRONTLINE_CAPTURE_ORBIT_EXTRA,
    ),
  );

  return {
    sourceFrontline: addVec3(sourceCentroid, sourceOffset),
    targetFrontline: frontlineTarget,
    outward,
  };
}

function readClosePairDeployment(
  units: readonly InitialUnitConfig[],
  planets: readonly InitialPlanetConfig[],
  planet: InitialPlanetConfig,
  center: Vec3Data,
  axis: Vec3Data,
  owner: PlayerId,
  captureOrbitMaxRadiusMultiplier: number,
): CaptureDemoPlayerDeployment {
  const sourceFrontline =
    readNearestDropShipPosition(units, planets, owner) ??
    averagePosition(
      units.filter((unit) => unit.owner === owner).map((unit) => unit.position),
    );
  const outward = normalizeVec3OrFallback(
    subtractVec3(planet.position, center),
    owner === 1 ? scaleVec3(axis, -1) : axis,
  );
  const targetFrontline = addVec3(
    planet.position,
    scaleVec3(
      outward,
      planet.radius * captureOrbitMaxRadiusMultiplier +
        CAPTURE_DEMO_FRONTLINE_CAPTURE_ORBIT_EXTRA,
    ),
  );

  return {
    sourceFrontline,
    targetFrontline,
    outward,
  };
}

function readNearestDropShipPosition(
  units: readonly InitialUnitConfig[],
  planets: readonly InitialPlanetConfig[],
  owner: PlayerId,
): Vec3Data | null {
  let nearest: Vec3Data | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;

  for (const unit of units) {
    if (unit.owner !== owner || unit.templateId !== TEMPLATE_IDS.dropShip) {
      continue;
    }

    for (const planet of planets) {
      const gap = distanceVec3(unit.position, planet.position) - planet.radius;

      if (gap < nearestGap) {
        nearest = unit.position;
        nearestGap = gap;
      }
    }
  }

  return nearest;
}

function readCaptureDemoDeployedUnitPosition(
  position: Vec3Data,
  deployment: CaptureDemoPlayerDeployment,
  depthScale: number,
  lateralScale: number,
): Vec3Data {
  const offset = subtractVec3(position, deployment.sourceFrontline);
  const depth = dotVec3(offset, deployment.outward);
  const depthVector = scaleVec3(deployment.outward, depth);
  const lateralVector = subtractVec3(offset, depthVector);

  return addVec3(
    deployment.targetFrontline,
    addVec3(
      scaleVec3(depthVector, depthScale),
      scaleVec3(lateralVector, lateralScale),
    ),
  );
}

function readPlanetarySystemCenter(
  planets: readonly InitialPlanetConfig[],
): Vec3Data {
  const parentPlanets = planets.filter(
    (planet) => planet.parentPlanetIndex === null,
  );

  return parentPlanets.length > 0
    ? averagePosition(parentPlanets.map((planet) => planet.orbit.center))
    : averagePosition(planets.map((planet) => planet.position));
}

function readParentPlanetMapRadius(
  planets: readonly InitialPlanetConfig[],
  center: Vec3Data,
): number {
  const parentPlanets = planets.filter(
    (planet) => planet.parentPlanetIndex === null,
  );
  const candidates = parentPlanets.length > 0 ? parentPlanets : planets;

  return Math.max(
    1,
    ...candidates.map(
      (planet) => lengthVec3(subtractVec3(planet.position, center)) + planet.radius,
    ),
  );
}

function readFirstPrimaryPlanet(
  planets: readonly InitialPlanetConfig[],
): InitialPlanetConfig | undefined {
  return planets.find(isPrimaryPlanet);
}

function isPrimaryPlanet(planet: InitialPlanetConfig): boolean {
  return planet.parentPlanetIndex === null && !isSunPlanet(planet);
}

function isSunPlanet(planet: InitialPlanetConfig): boolean {
  return planet.appearance.planetClass === "sun";
}

function averagePosition(points: readonly Vec3Data[]): Vec3Data {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  );

  return scaleVec3(total, 1 / points.length);
}

function addVec3(left: Vec3Data, right: Vec3Data): Vec3Data {
  return {
    x: quantize(left.x + right.x),
    y: quantize(left.y + right.y),
    z: quantize(left.z + right.z),
  };
}

function subtractVec3(left: Vec3Data, right: Vec3Data): Vec3Data {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVec3(vector: Vec3Data, scalar: number): Vec3Data {
  return {
    x: quantize(vector.x * scalar),
    y: quantize(vector.y * scalar),
    z: quantize(vector.z * scalar),
  };
}

function dotVec3(left: Vec3Data, right: Vec3Data): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function lengthVec3(vector: Vec3Data): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distanceVec3(left: Vec3Data, right: Vec3Data): number {
  return lengthVec3(subtractVec3(left, right));
}

function normalizeVec3OrFallback(vector: Vec3Data, fallback: Vec3Data): Vec3Data {
  const length = lengthVec3(vector);

  if (length > 0.000001) {
    return scaleVec3(vector, 1 / length);
  }

  const fallbackLength = Math.max(lengthVec3(fallback), 1);
  return scaleVec3(fallback, 1 / fallbackLength);
}

function generatePlanetarySystem(seed: number): {
  environment: MatchEnvironmentConfig;
  planets: readonly InitialPlanetConfig[];
} {
  const random = createSeededRandom(seed, "match-system");
  const targetPlanetCount =
    MIN_GENERATED_PLANETS +
    randomInt(random, MAX_GENERATED_PLANETS - MIN_GENERATED_PLANETS + 1);
  const targetMoonCount = randomInt(
    random,
    targetPlanetCount - MIN_PARENT_PLANETS + 1,
  );
  const planetCount = targetPlanetCount - targetMoonCount;
  const sunPosition = SYSTEM_SUN_POSITION;
  const sunColor = sampleSunColor(seed);
  const systemOrbitAxis = sampleSolarPlaneAxis(random);
  const systemPhaseOffset = quantize(random() * MATCH_TAU);
  const systemPeriapsisAngle = quantize(random() * MATCH_TAU);
  const planets: InitialPlanetConfig[] = [
    createSunPlanetConfig(sunPosition, systemOrbitAxis, sunColor),
  ];
  let remainingMoons = targetMoonCount;

  for (let index = 0; index < planetCount; index += 1) {
    const baseRadius = 24 + random() * 20;
    const radius = scaleParentPlanetRadius(baseRadius);
    const appearance = samplePlanetAppearance(random, baseRadius, false);
    const orbitAxis = sampleCoplanarOrbitAxis(random, systemOrbitAxis);
    const orbitRadius = sampleParentOrbitRadius(random, index, planetCount);
    const phaseStep = MATCH_TAU / Math.max(planetCount, 1);
    const phaseJitter = Math.min(PARENT_PLANET_PHASE_JITTER, phaseStep * 0.28);
    const phase =
      systemPhaseOffset + index * phaseStep + (random() - 0.5) * phaseJitter;
    const orbit: PlanetOrbitConfig = {
      center: sunPosition,
      radius: quantize(orbitRadius),
      phase: quantize(phase),
      angularSpeed: sampleParentAngularSpeed(random, orbitRadius),
      eccentricity: sampleParentOrbitEccentricity(random, index),
      periapsisAngle: quantize(
        systemPeriapsisAngle + index * 0.17 + (random() - 0.5) * 0.28,
      ),
    };
    const position = positionOnOrbit(
      orbit.center,
      orbitAxis,
      orbit.radius,
      orbit.phase,
      orbit.eccentricity,
      orbit.periapsisAngle,
    );
    const parentPlanetIndex = planets.length;
    const planet: InitialPlanetConfig = {
      templateId: TEMPLATE_IDS.billboardPlanet,
      name: PLANET_NAMES[index] ?? `Planet ${index + 1}`,
      position,
      mass: quantize(
        7_200_000_000 * Math.pow(radius / 28, 3) * (0.9 + random() * 0.22),
      ),
      radius,
      color: samplePlanetColor(random, index, false, appearance.planetClass),
      hasAtmosphere: appearance.planetClass !== "ice" || random() < 0.42,
      appearance,
      orbitAxis,
      orbit,
      parentPlanetIndex: null,
    };

    planets.push(planet);

    const remainingParentPlanets = planetCount - index - 1;
    const maxMoons = Math.min(MAX_MOONS_PER_PLANET, remainingMoons);
    const minMoons = Math.max(
      0,
      remainingMoons - remainingParentPlanets * MAX_MOONS_PER_PLANET,
    );
    const moonCount = minMoons + randomInt(random, maxMoons - minMoons + 1);

    remainingMoons -= moonCount;

    for (let moonIndex = 0; moonIndex < moonCount; moonIndex += 1) {
      const baseMoonRadius = baseRadius * (0.22 + random() * 0.16);
      const moonRadius = quantize(
        baseMoonRadius * PARENT_PLANET_RADIUS_SCALE * MOON_RADIUS_SCALE,
      );
      const appearance = samplePlanetAppearance(random, baseMoonRadius, true);
      const moonAxis = sampleOrbitAxis(random);
      const moonDistance =
        (radius * (2.05 + random() * 1.2) + moonRadius) *
        MOON_DISTANCE_SCALE;
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
          moonOrbit.phase,
        ),
        mass: quantize(
          planet.mass * Math.pow(moonRadius / Math.max(radius, 1), 3) * 0.8,
        ),
        radius: moonRadius,
        color: samplePlanetColor(
          random,
          planets.length,
          true,
          appearance.planetClass,
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
        position: sunPosition,
        orbitCenter: sunPosition,
        distance: PARENT_PLANET_OUTER_ORBIT_RADIUS,
        color: sunColor,
      },
    },
    planets,
  };
}

function createSunPlanetConfig(
  position: Vec3Data,
  orbitAxis: Vec3Data,
  color: string,
): InitialPlanetConfig {
  return {
    templateId: TEMPLATE_IDS.billboardPlanet,
    name: "Sun",
    position,
    mass: SUN_PLANET_MASS,
    radius: SUN_PLANET_RADIUS,
    color,
    hasAtmosphere: true,
    appearance: {
      planetClass: "sun",
      hasRings: false,
      seed: 1,
    },
    orbitAxis,
    orbit: {
      center: position,
      radius: 0,
      phase: 0,
      angularSpeed: 0,
      eccentricity: 0,
      periapsisAngle: 0,
    },
    parentPlanetIndex: null,
    capturable: true,
    initialOwner: 0,
  };
}

function scaleParentPlanetRadius(baseRadius: number): number {
  const midpoint = 34;
  const relative = (baseRadius - midpoint) / midpoint;
  const varianceMultiplier = Math.max(
    0.75,
    1 + relative * PARENT_PLANET_RADIUS_VARIANCE,
  );

  return quantize(baseRadius * PARENT_PLANET_RADIUS_SCALE * varianceMultiplier);
}

function sampleSolarPlaneAxis(random: () => number): Vec3Data {
  const tilt = 0.035 + random() * 0.115;
  const angle = random() * MATCH_TAU;

  return normalizeVec3({
    x: Math.cos(angle) * tilt,
    y: 1,
    z: Math.sin(angle) * tilt,
  });
}

function sampleCoplanarOrbitAxis(
  random: () => number,
  systemOrbitAxis: Vec3Data,
): Vec3Data {
  const basis = orbitBasis(systemOrbitAxis);
  const tangentTilt = (random() - 0.5) * PARENT_PLANET_INCLINATION_JITTER;
  const bitangentTilt = (random() - 0.5) * PARENT_PLANET_INCLINATION_JITTER;

  return normalizeVec3({
    x:
      systemOrbitAxis.x +
      basis.tangent.x * tangentTilt +
      basis.bitangent.x * bitangentTilt,
    y:
      systemOrbitAxis.y +
      basis.tangent.y * tangentTilt +
      basis.bitangent.y * bitangentTilt,
    z:
      systemOrbitAxis.z +
      basis.tangent.z * tangentTilt +
      basis.bitangent.z * bitangentTilt,
  });
}

function sampleParentOrbitRadius(
  random: () => number,
  index: number,
  planetCount: number,
): number {
  const orbitSpan =
    PARENT_PLANET_OUTER_ORBIT_RADIUS +
    Math.max(0, planetCount - MIN_PARENT_PLANETS) *
      PARENT_PLANET_OUTER_ORBIT_COUNT_BONUS -
    PARENT_PLANET_INNER_ORBIT_RADIUS;
  const normalizedOrbit =
    planetCount <= 1 ? 0 : index / Math.max(planetCount - 1, 1);
  const spread = Math.pow(normalizedOrbit, PARENT_PLANET_ORBIT_EXPONENT);
  const jitter = index === 0 ? 0 : (random() - 0.5) * PARENT_PLANET_ORBIT_JITTER;

  return Math.max(
    PARENT_PLANET_INNER_ORBIT_RADIUS,
    PARENT_PLANET_INNER_ORBIT_RADIUS + orbitSpan * spread + jitter,
  );
}

function sampleParentOrbitEccentricity(
  random: () => number,
  index: number,
): number {
  const innerOrbitBias = index === 0 ? 0.55 : 1;

  return quantize(
    PARENT_PLANET_MIN_ECCENTRICITY +
      random() * PARENT_PLANET_ECCENTRICITY_RANGE * innerOrbitBias,
  );
}

function sampleParentAngularSpeed(
  random: () => number,
  orbitRadius: number,
): number {
  const relativeRadius = Math.max(
    orbitRadius / PARENT_PLANET_INNER_ORBIT_RADIUS,
    1,
  );
  const magnitude =
    (0.00028 + random() * 0.00018) / Math.pow(relativeRadius, 1.5);
  const direction = random() < 0.5 ? -1 : 1;

  return quantizeAngularSpeed(magnitude * direction);
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

function selectRingedPlanetIndex(
  planets: readonly InitialPlanetConfig[],
): number {
  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];

    if (isPrimaryPlanet(planet) && planet.appearance.hasRings) {
      return index;
    }
  }

  for (let index = 0; index < planets.length; index += 1) {
    const planet = planets[index];

    if (
      isPrimaryPlanet(planet) &&
      planet.appearance.planetClass === "gas-giant"
    ) {
      return index;
    }
  }

  return planets.findIndex(isPrimaryPlanet);
}

function createInitialUnits(
  primaryPlanetPosition: Vec3Data,
  primaryPlanetRadius: number,
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
    position: addVec3(
      primaryPlanetPosition,
      scaleInitialUnitOffset(unit.position, primaryPlanetRadius),
    ),
  }));
}

function scaleInitialUnitOffset(
  offset: Vec3Data,
  primaryPlanetRadius: number,
): Vec3Data {
  const distance = Math.max(lengthVec3(offset), 1);
  const targetDistance = Math.max(
    distance,
    primaryPlanetRadius + MINIMAL_SKIRMISH_PLANET_SPAWN_PADDING,
  );

  return scaleVec3(offset, targetDistance / distance);
}

function sampleSunColor(seed: number): string {
  const random = createSeededRandom(seed, "match-sun-color");
  const position = random();
  let previous = SUN_COLOR_STOPS[0];

  for (let index = 1; index < SUN_COLOR_STOPS.length; index += 1) {
    const next = SUN_COLOR_STOPS[index];

    if (position > next.position) {
      previous = next;
      continue;
    }

    const span = Math.max(next.position - previous.position, 0.000001);
    const amount = clamp((position - previous.position) / span, 0, 1);

    return rgbToHex(
      lerp(previous.color[0], next.color[0], amount),
      lerp(previous.color[1], next.color[1], amount),
      lerp(previous.color[2], next.color[2], amount),
    );
  }

  const last = SUN_COLOR_STOPS[SUN_COLOR_STOPS.length - 1];
  return rgbToHex(last.color[0], last.color[1], last.color[2]);
}

function samplePlanetColor(
  random: () => number,
  index: number,
  muted: boolean,
  planetClass: PlanetClass,
): string {
  if (planetClass === "sun") {
    return "#ffd27a";
  }

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
  moon: boolean,
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

  return quantizeAngularSpeed(magnitude * direction);
}

function positionOnOrbit(
  center: Vec3Data,
  axis: Vec3Data,
  radius: number,
  phase: number,
  eccentricity = 0,
  periapsisAngle = 0,
): Vec3Data {
  const basis = orbitBasis(axis);
  const phaseCos = Math.cos(phase);
  const phaseSin = Math.sin(phase);
  const clampedEccentricity = clamp(eccentricity, 0, 0.8);
  const semiMinorRadius =
    radius * Math.sqrt(Math.max(1 - clampedEccentricity * clampedEccentricity, 0));
  const apsisCos = Math.cos(periapsisAngle);
  const apsisSin = Math.sin(periapsisAngle);
  const majorAxis = {
    x: basis.tangent.x * apsisCos + basis.bitangent.x * apsisSin,
    y: basis.tangent.y * apsisCos + basis.bitangent.y * apsisSin,
    z: basis.tangent.z * apsisCos + basis.bitangent.z * apsisSin,
  };
  const minorAxis = {
    x: -basis.tangent.x * apsisSin + basis.bitangent.x * apsisCos,
    y: -basis.tangent.y * apsisSin + basis.bitangent.y * apsisCos,
    z: -basis.tangent.z * apsisSin + basis.bitangent.z * apsisCos,
  };
  const majorOffset = radius * (phaseCos - clampedEccentricity);
  const minorOffset = semiMinorRadius * phaseSin;

  return {
    x: quantize(
      center.x + majorAxis.x * majorOffset + minorAxis.x * minorOffset,
    ),
    y: quantize(
      center.y + majorAxis.y * majorOffset + minorAxis.y * minorOffset,
    ),
    z: quantize(
      center.z + majorAxis.z * majorOffset + minorAxis.z * minorOffset,
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
  value: number,
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

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
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

function quantizeAngularSpeed(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
