import type { EntityHandle, PlayerId } from "./handles";
import type {
  MatchEnvironmentConfig,
  PlayerConfig,
  PlanetAppearanceConfig,
  PlanetOrbitConfig,
  QuaternionData,
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

export type UnitSnapshot = Readonly<{
  handle: EntityHandle;
  owner: PlayerId;
  templateId: number;
  position: Vec3Data;
  velocity: Vec3Data;
  rotation: QuaternionData;
  moveOrder: UnitMoveOrderSnapshot | null;
  health: HealthSnapshot;
  render: RenderSnapshot;
  spawnedTick: number;
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
  commandLeadTicks: number;
  nextEntityId: number;
  players: readonly PlayerConfig[];
  environment: MatchEnvironmentConfig;
  units: readonly UnitSnapshot[];
  planets: readonly PlanetSnapshot[];
  prng: readonly PrngSnapshot[];
}>;
