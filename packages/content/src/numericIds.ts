export {
  CONTENT_VERSION,
  SHIP_CLASS_IDS,
  TEMPLATE_IDS,
} from "@drop-ship/protocol";

export const SHIP_COMPONENT_IDS = {
  ionEngineSmall: 1,
  fuelTankSmall: 2,
  cargoBaySmall: 3,
  pulseLaserSmall: 4,
} as const;

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
