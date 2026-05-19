import type * as THREE from "three";
import type { ShipStats } from "@drop-ship/content";
import type {
  CompactSimSnapshot,
  EntityHandle,
  PlanetAppearanceConfig,
  PlayerId,
  Vec3Data,
} from "@drop-ship/protocol";
import type { SimWorld } from "@drop-ship/sim";

export type UnitViewModel = Readonly<{
  handle: EntityHandle;
  key: string;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  health: Readonly<{
    current: number;
    max: number;
  }>;
  stats: ShipStats;
}>;

export type PlanetViewModel = Readonly<{
  key: string;
  label: string;
  position: THREE.Vector3;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  appearance: PlanetAppearanceConfig;
  orbitAxis: THREE.Vector3;
  parentPlanetIndex: number | null;
}>;

export type LocalGameRuntime = Readonly<{
  playerId: PlayerId;
  world: SimWorld;
  stepTick: () => void;
  enqueueRandomTurn: () => void;
  enqueueMoveUnits: (
    unitHandles: readonly EntityHandle[],
    target: Vec3Data
  ) => void;
  readUnits: () => readonly UnitViewModel[];
  readPlanets: () => readonly PlanetViewModel[];
  readHash: () => string;
  readSnapshot: () => CompactSimSnapshot;
  readConnectionStatus: () => RuntimeConnectionStatus;
  dispose: () => void;
}>;

export type MountedGame = Readonly<{
  runtime: LocalGameRuntime;
  dispose: () => void;
}>;

export type RenderQualityMode = "interactive" | "cinematic";

export type RuntimeConnectionStatus = Readonly<{
  mode: "local" | "network";
  state: "local" | "connecting" | "open" | "closed" | "error";
  playerId: PlayerId;
  matchId?: string;
  serverTick?: number;
  running?: boolean;
  lastAckTick?: number;
  lastError?: string;
  players?: readonly Readonly<{
    playerId: PlayerId;
    connected: boolean;
  }>[];
}>;

export type MountMinimalGameOptions = Readonly<{
  playerId?: PlayerId;
  matchId?: string;
  serverUrl?: string;
  network?: boolean;
  seed?: number;
  stressUnits?: number;
  renderMode?: RenderQualityMode;
}>;
