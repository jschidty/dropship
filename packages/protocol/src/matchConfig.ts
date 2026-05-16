import type { PlayerId } from "./handles";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_COMMAND_LEAD_TICKS = 4;
export const PHASE_ONE_SIM_HZ = 30;

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

export type InitialUnitConfig = Readonly<{
  owner: PlayerId;
  templateId: number;
  position: Vec3Data;
}>;

export type InitialPlanetConfig = Readonly<{
  templateId: number;
  position: Vec3Data;
  mass: number;
  radius: number;
}>;

export type MatchConfig = Readonly<{
  matchId: string;
  seed: number;
  protocolVersion: number;
  contentVersion: number;
  commandLeadTicks: number;
  players: readonly PlayerConfig[];
  initialUnits: readonly InitialUnitConfig[];
  initialPlanets: readonly InitialPlanetConfig[];
}>;
