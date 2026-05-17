export { CONTENT_VERSION, TEMPLATE_IDS } from "@drop-ship/protocol";

export const MESH_IDS = {
  scoutShip: 1,
  billboardPlanet: 100,
} as const;

export const MATERIAL_IDS = {
  playerOneHull: 1,
  playerTwoHull: 2,
  palePlanet: 100,
} as const;

export const SCALE_TIERS = {
  ship: 1,
  planetary: 3,
} as const;
