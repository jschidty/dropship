import type { EntityHandle, PlayerId } from "./handles";
import type { UnitOrderIntent } from "./commands";
import type {
  CaptureDemoRules,
  GameMode,
  MatchContentOverrides,
  MatchEndReason,
  MatchEnvironmentConfig,
  MatchRulesConfig,
  PlayerConfig,
  PlayerControllerConfig,
  PlanetAppearanceConfig,
  PlanetOrbitConfig,
  QuaternionData,
  SimTuningConfig,
  Vec3Data,
} from "./matchConfig";

export type HealthSnapshot = Readonly<{
  current: number;
  max: number;
}>;

export type RenderSnapshot = Readonly<{
  meshId: number;
  materialId: number;
  scaleTier: number;
}>;

export type UnitMoveOrderSnapshot = Readonly<{
  type: "moveTo";
  target: Vec3Data;
}>;

export type UnitOrderSnapshot = UnitOrderIntent;

export type UnitFighterSpawnSnapshot = Readonly<{
  nextSpawnTick: number;
  spawnedFighters: readonly EntityHandle[];
}>;

export type UnitOrbitStateSnapshot = Readonly<{
  isOrbiting: boolean;
  planet: EntityHandle | null;
  orbitTicks: number;
}>;

export type UnitSnapshot = Readonly<{
  handle: EntityHandle;
  owner: PlayerId;
  templateId: number;
  shipClassId: number;
  componentsBySlot: Readonly<Record<string, number>> | null;
  position: Vec3Data;
  velocity: Vec3Data;
  rotation: QuaternionData;
  moveOrder: UnitOrderSnapshot | null;
  health: HealthSnapshot;
  weaponCooldownTicks: number;
  orbit: UnitOrbitStateSnapshot;
  fighterSpawn: UnitFighterSpawnSnapshot | null;
  render: RenderSnapshot;
  spawnedTick: number;
}>;

export type PlanetControlSnapshot = Readonly<{
  capturable: boolean;
  owner: PlayerId | 0;
  capturingPlayer: PlayerId | 0;
  capturingDropShip: EntityHandle | null;
  captureTicks: number;
  contested: boolean;
  breakTicks: number;
}>;

export type PlanetSnapshot = Readonly<{
  handle: EntityHandle;
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
  control: PlanetControlSnapshot;
  render: RenderSnapshot;
  spawnedTick: number;
}>;

export type PrngSnapshot = Readonly<{
  name: string;
  state: number;
}>;

export type CompactSimSnapshot = Readonly<{
  version: 1;
  matchId: string;
  tick: number;
  seed: number;
  protocolVersion: number;
  contentVersion: number;
  contentHash?: string;
  commandLeadTicks: number;
  gameMode?: GameMode;
  controllers?: readonly PlayerControllerConfig[];
  rules?: MatchRulesConfig;
  tuning?: SimTuningConfig;
  contentOverrides?: MatchContentOverrides;
  captureDemoRules?: CaptureDemoRules;
  nextEntityId: number;
  players: readonly PlayerConfig[];
  environment: MatchEnvironmentConfig;
  units: readonly UnitSnapshot[];
  planets: readonly PlanetSnapshot[];
  prng: readonly PrngSnapshot[];
  matchResult?: Readonly<{
    winner: PlayerId | 0;
    completedTick: number;
    reason: MatchEndReason;
  }> | null;
}>;
