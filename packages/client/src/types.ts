import type * as THREE from "three";
import type { ShipStats } from "@drop-ship/content";
import type {
  CompactSimSnapshot,
  EntityHandle,
  PlanetAppearanceConfig,
  PlayerId,
  type MatchSessionRole,
  Vec3Data,
} from "@drop-ship/protocol";
import type { SimWorld } from "@drop-ship/sim";
import type { SimEvent } from "@drop-ship/sim";
import type { UnitOrderIntent } from "@drop-ship/protocol";

export type UnitViewModel = Readonly<{
  handle: EntityHandle;
  key: string;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  shipClassId: number;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  orbit: Readonly<{
    isOrbiting: boolean;
    planet: EntityHandle | null;
    orbitTicks: number;
  }>;
  health: Readonly<{
    current: number;
    max: number;
  }>;
  stats: ShipStats;
}>;

export type PlanetViewModel = Readonly<{
  handle: EntityHandle;
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
  control: Readonly<{
    capturable: boolean;
    owner: PlayerId | 0;
    capturingPlayer: PlayerId | 0;
    captureTicks: number;
    contested: boolean;
  }>;
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
  enqueueUnitOrder: (
    unitHandles: readonly EntityHandle[],
    order: UnitOrderIntent
  ) => void;
  readUnits: () => readonly UnitViewModel[];
  readPlanets: () => readonly PlanetViewModel[];
  drainEvents: () => readonly SimEvent[];
  readHash: () => string;
  readSnapshot: () => CompactSimSnapshot;
  readConnectionStatus: () => RuntimeConnectionStatus;
  readyForMatch: () => void;
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
  role: MatchSessionRole;
  canControl: boolean;
  matchId?: string;
  serverTick?: number;
  running?: boolean;
  lastAckTick?: number;
  lastError?: string;
  spectatorCount?: number;
  players?: readonly Readonly<{
    playerId: PlayerId;
    connected: boolean;
    ready?: boolean;
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
  debugMatchParams?: boolean;
  debugNetworkLogs?: boolean;
  initialPaused?: boolean;
  creatorToken?: string;
  playerToken?: string;
  rememberPlayerToken?: (matchId: string, playerToken: string) => void;
  createTwoPlayerGame?: () => Promise<void>;
}>;
