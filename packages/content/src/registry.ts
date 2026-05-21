import {
  createCaptureDemoConfig,
  createMinimalSkirmishConfig,
  type ShipClassId,
  type Vec3Data,
} from "@drop-ship/protocol";
import { CONTENT_VERSION } from "./numericIds";
import shipComponentsData from "../../../content/ships/components.json";
import scoutShipTemplateData from "../../../content/ships/scout-ship.json";
import dropShipTemplateData from "../../../content/ships/drop-ship.json";
import battleshipTemplateData from "../../../content/ships/battleship.json";
import billboardPlanetTemplateData from "../../../content/planets/billboard-planet.json";

export type ShipComponentType = "engine" | "fuelTank" | "cargo" | "weapon";
export type ShipSlotSize = "small" | "medium" | "large";
export type WeaponArc = "front" | "turret" | "rear";

export type ShipHull = Readonly<{
  maxHealth: number;
  colliderRadius: number;
  baseMass: number;
  basePower: number;
}>;

export type ShipSlot = Readonly<{
  id: string;
  type: ShipComponentType;
  size: ShipSlotSize;
  arc?: WeaponArc;
}>;

export type ShipLoadout = Readonly<{
  slug: string;
  displayName: string;
  componentsBySlot: Readonly<Record<string, number>>;
}>;

type ShipComponentBase = Readonly<{
  id: number;
  slug: string;
  displayName: string;
  type: ShipComponentType;
  size: ShipSlotSize;
  mass: number;
  powerDraw: number;
}>;

export type ShipEngineComponent = ShipComponentBase &
  Readonly<{
    type: "engine";
    thrust: number;
    turnThrust: number;
    fuelUsePerSecond: number;
  }>;

export type ShipFuelTankComponent = ShipComponentBase &
  Readonly<{
    type: "fuelTank";
    fuelCapacity: number;
  }>;

export type ShipCargoComponent = ShipComponentBase &
  Readonly<{
    type: "cargo";
    cargoCapacity: number;
  }>;

export type ShipWeaponComponent = ShipComponentBase &
  Readonly<{
    type: "weapon";
    damage: number;
    cooldownTicks: number;
    range: number;
  }>;

export type ShipComponentTemplate =
  | ShipEngineComponent
  | ShipFuelTankComponent
  | ShipCargoComponent
  | ShipWeaponComponent;

export type ShipStats = Readonly<{
  maxHealth: number;
  colliderRadius: number;
  dryMass: number;
  basePower: number;
  powerDraw: number;
  powerAvailable: number;
  fuelCapacity: number;
  fuelUsePerSecond: number;
  cargoCapacity: number;
  weaponCount: number;
  engineThrust: number;
  turnThrust: number;
  maxAcceleration: number;
  maxSpeed: number;
  cruiseSpeed: number;
}>;

export type ShipTemplateDefinition = Readonly<{
  id: number;
  slug: string;
  displayName: string;
  shipClassId: ShipClassId;
  hull: ShipHull;
  slots: readonly ShipSlot[];
  defaultLoadout: ShipLoadout;
  initialVelocity: Vec3Data;
  render: Readonly<{
    meshId: number;
    materialIdsByPlayer: Readonly<Record<1 | 2, number>>;
    scaleTier: number;
  }>;
}>;

export type ShipTemplate = ShipTemplateDefinition &
  Readonly<{
    stats: ShipStats;
  }>;

export type UnitTemplate = ShipTemplate;

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
  shipComponents: readonly ShipComponentTemplate[];
  unitTemplates: readonly UnitTemplate[];
  planetTemplates: readonly PlanetTemplate[];
  getShipComponent: (componentId: number) => ShipComponentTemplate;
  getUnitTemplate: (templateId: number) => UnitTemplate;
  getPlanetTemplate: (templateId: number) => PlanetTemplate;
}>;

const SHIP_SPEED_MASS_FACTOR = 1.8;
const SHIP_CRUISE_SPEED_RATIO = 22 / 30;

export const DEFAULT_CONTENT_REGISTRY: ContentRegistry = createContentRegistry({
  shipComponents: shipComponentsData as readonly ShipComponentTemplate[],
  unitTemplates: [
    scoutShipTemplateData,
    dropShipTemplateData,
    battleshipTemplateData,
  ] as readonly ShipTemplateDefinition[],
  planetTemplates: [billboardPlanetTemplateData] as readonly PlanetTemplate[],
});

export function createContentRegistry(options: {
  shipComponents: readonly ShipComponentTemplate[];
  unitTemplates: readonly ShipTemplateDefinition[];
  planetTemplates: readonly PlanetTemplate[];
}): ContentRegistry {
  const { shipComponents, planetTemplates } = options;
  const shipComponentsById = new Map(
    shipComponents.map((component) => [component.id, component]),
  );
  const unitTemplates = options.unitTemplates.map((template) =>
    resolveShipTemplate(template, shipComponentsById),
  );
  const templatesById = new Map(
    unitTemplates.map((template) => [template.id, template]),
  );
  const planetTemplatesById = new Map(
    planetTemplates.map((template) => [template.id, template]),
  );

  return {
    version: CONTENT_VERSION,
    shipComponents,
    unitTemplates,
    planetTemplates,
    getShipComponent(componentId: number): ShipComponentTemplate {
      const component = shipComponentsById.get(componentId);

      if (!component) {
        throw new Error(`Unknown ship component ${componentId}`);
      }

      return component;
    },
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

function resolveShipTemplate(
  template: ShipTemplateDefinition,
  componentsById: ReadonlyMap<number, ShipComponentTemplate>,
): ShipTemplate {
  return {
    ...template,
    stats: deriveShipStatsFromLoadout(
      template,
      template.defaultLoadout.componentsBySlot,
      (componentId) => {
        const component = componentsById.get(componentId);

        if (!component) {
          throw new Error(
            `Ship template ${template.slug} references unknown component ${componentId}`,
          );
        }

        return component;
      },
    ),
  };
}

export function deriveShipStatsFromLoadout(
  template: ShipTemplateDefinition,
  componentsBySlot: Readonly<Record<string, number>>,
  getComponent: (componentId: number) => ShipComponentTemplate,
): ShipStats {
  let dryMass = template.hull.baseMass;
  let powerDraw = 0;
  let fuelCapacity = 0;
  let fuelUsePerSecond = 0;
  let cargoCapacity = 0;
  let weaponCount = 0;
  let engineThrust = 0;
  let turnThrust = 0;
  const slotIds = new Set(template.slots.map((slot) => slot.id));

  for (const slotId of Object.keys(componentsBySlot)) {
    if (!slotIds.has(slotId)) {
      throw new Error(
        `Ship template ${template.slug} loadout references unknown slot ${slotId}`,
      );
    }
  }

  for (const slot of template.slots) {
    const componentId = componentsBySlot[slot.id];

    if (componentId === undefined) {
      continue;
    }

    const component = getComponent(componentId);

    if (component.type !== slot.type || component.size !== slot.size) {
      throw new Error(
        `Ship template ${template.slug} slot ${slot.id} cannot mount ${component.slug}`,
      );
    }

    dryMass += component.mass;
    powerDraw += component.powerDraw;

    if (component.type === "engine") {
      engineThrust += component.thrust;
      turnThrust += component.turnThrust;
      fuelUsePerSecond += component.fuelUsePerSecond;
      continue;
    }

    if (component.type === "fuelTank") {
      fuelCapacity += component.fuelCapacity;
      continue;
    }

    if (component.type === "cargo") {
      cargoCapacity += component.cargoCapacity;
      continue;
    }

    weaponCount += 1;
  }

  const maxAcceleration = dryMass > 0 ? engineThrust / dryMass : 0;
  const baseMaxSpeed =
    dryMass > 0 ? engineThrust / (dryMass * SHIP_SPEED_MASS_FACTOR) : 0;
  const maxSpeed = baseMaxSpeed;

  return {
    maxHealth: template.hull.maxHealth,
    colliderRadius: template.hull.colliderRadius,
    dryMass: quantizeStat(dryMass),
    basePower: template.hull.basePower,
    powerDraw: quantizeStat(powerDraw),
    powerAvailable: quantizeStat(template.hull.basePower - powerDraw),
    fuelCapacity: quantizeStat(fuelCapacity),
    fuelUsePerSecond: quantizeStat(fuelUsePerSecond),
    cargoCapacity: quantizeStat(cargoCapacity),
    weaponCount,
    engineThrust: quantizeStat(engineThrust),
    turnThrust: quantizeStat(turnThrust),
    maxAcceleration: quantizeStat(maxAcceleration),
    maxSpeed: quantizeStat(maxSpeed),
    cruiseSpeed: quantizeStat(maxSpeed * SHIP_CRUISE_SPEED_RATIO),
  };
}

function quantizeStat(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export { createCaptureDemoConfig, createMinimalSkirmishConfig };
