import {
  createMinimalSkirmishConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  CONTENT_VERSION,
  MATERIAL_IDS,
  MESH_IDS,
  SCALE_TIERS,
  TEMPLATE_IDS,
} from "./numericIds";

export type UnitTemplate = Readonly<{
  id: number;
  slug: string;
  displayName: string;
  maxHealth: number;
  colliderRadius: number;
  defaultVelocity: Vec3Data;
  render: Readonly<{
    meshId: number;
    materialIdsByPlayer: Readonly<Record<1 | 2, number>>;
    scaleTier: number;
  }>;
}>;

export type PlanetTemplate = Readonly<{
  id: number;
  slug: string;
  displayName: string;
  defaultMass: number;
  defaultRadius: number;
  render: Readonly<{
    meshId: number;
    materialId: number;
    scaleTier: number;
  }>;
}>;

export type ContentRegistry = Readonly<{
  version: number;
  unitTemplates: readonly UnitTemplate[];
  planetTemplates: readonly PlanetTemplate[];
  getUnitTemplate: (templateId: number) => UnitTemplate;
  getPlanetTemplate: (templateId: number) => PlanetTemplate;
}>;

const SCOUT_SHIP_TEMPLATE: UnitTemplate = {
  id: TEMPLATE_IDS.scoutShip,
  slug: "scout-ship",
  displayName: "Scout",
  maxHealth: 100,
  colliderRadius: 0.9,
  defaultVelocity: { x: 0, y: 0, z: 0 },
  render: {
    meshId: MESH_IDS.scoutShip,
    materialIdsByPlayer: {
      1: MATERIAL_IDS.playerOneHull,
      2: MATERIAL_IDS.playerTwoHull,
    },
    scaleTier: SCALE_TIERS.ship,
  },
};

const BILLBOARD_PLANET_TEMPLATE: PlanetTemplate = {
  id: TEMPLATE_IDS.billboardPlanet,
  slug: "billboard-planet",
  displayName: "Aurora",
  defaultMass: 7_200_000_000,
  defaultRadius: 28,
  render: {
    meshId: MESH_IDS.billboardPlanet,
    materialId: MATERIAL_IDS.palePlanet,
    scaleTier: SCALE_TIERS.planetary,
  },
};

export const DEFAULT_CONTENT_REGISTRY: ContentRegistry = createContentRegistry({
  unitTemplates: [SCOUT_SHIP_TEMPLATE],
  planetTemplates: [BILLBOARD_PLANET_TEMPLATE],
});

export function createContentRegistry(options: {
  unitTemplates: readonly UnitTemplate[];
  planetTemplates: readonly PlanetTemplate[];
}): ContentRegistry {
  const { unitTemplates, planetTemplates } = options;
  const templatesById = new Map(unitTemplates.map((template) => [template.id, template]));
  const planetTemplatesById = new Map(
    planetTemplates.map((template) => [template.id, template])
  );

  return {
    version: CONTENT_VERSION,
    unitTemplates,
    planetTemplates,
    getUnitTemplate(templateId: number): UnitTemplate {
      const template = templatesById.get(templateId);

      if (!template) {
        throw new Error(`Unknown unit template ${templateId}`);
      }

      return template;
    },
    getPlanetTemplate(templateId: number): PlanetTemplate {
      const template = planetTemplatesById.get(templateId);

      if (!template) {
        throw new Error(`Unknown planet template ${templateId}`);
      }

      return template;
    },
  };
}

export { createMinimalSkirmishConfig };
