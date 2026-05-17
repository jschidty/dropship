import type { PlayerId } from "./handles";

export const PROTOCOL_VERSION = 1;
export const CONTENT_VERSION = 1;
export const DEFAULT_COMMAND_LEAD_TICKS = 4;
export const PHASE_ONE_SIM_HZ = 30;

export const TEMPLATE_IDS = {
  scoutShip: 1,
  billboardPlanet: 100,
} as const;

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

export function createMinimalSkirmishConfig(): MatchConfig {
  const players: readonly PlayerConfig[] = [
    { id: 1, name: "Player 1", color: "#74d9ff" },
    { id: 2, name: "Player 2", color: "#ffb45f" },
  ];
  const initialUnits: readonly InitialUnitConfig[] = [
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -38, y: 2, z: 24 },
    },
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -28, y: 6, z: 36 },
    },
    {
      owner: 1,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: -52, y: -3, z: 16 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 38, y: 2, z: 24 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 28, y: 6, z: 36 },
    },
    {
      owner: 2,
      templateId: TEMPLATE_IDS.scoutShip,
      position: { x: 52, y: -3, z: 16 },
    },
  ];
  const initialPlanets: readonly InitialPlanetConfig[] = [
    {
      templateId: TEMPLATE_IDS.billboardPlanet,
      position: { x: 0, y: -2, z: -60 },
      mass: 7_200_000_000,
      radius: 28,
    },
  ];

  return {
    matchId: "local-minimal-skirmish",
    seed: 1337,
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    commandLeadTicks: DEFAULT_COMMAND_LEAD_TICKS,
    players,
    initialUnits,
    initialPlanets,
  };
}
