import {
  createMinimalSkirmishConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  CONTENT_VERSION,
  MATERIAL_IDS,
  MESH_IDS,
  SCALE_TIERS,
  SHIP_COMPONENT_IDS,
  TEMPLATE_IDS,
} from "./numericIds";

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

const ION_ENGINE_SMALL: ShipEngineComponent = {
  id: SHIP_COMPONENT_IDS.ionEngineSmall,
  slug: "ion-engine-small",
  displayName: "Small Ion Engine",
  type: "engine",
  size: "small",
  mass: 2,
  powerDraw: 3,
  thrust: 648,
  turnThrust: 24,
  fuelUsePerSecond: 0.2,
};

const FUEL_TANK_SMALL: ShipFuelTankComponent = {
  id: SHIP_COMPONENT_IDS.fuelTankSmall,
  slug: "fuel-tank-small",
  displayName: "Small Fuel Tank",
  type: "fuelTank",
  size: "small",
  mass: 1,
  powerDraw: 0,
  fuelCapacity: 80,
};

const CARGO_BAY_SMALL: ShipCargoComponent = {
  id: SHIP_COMPONENT_IDS.cargoBaySmall,
  slug: "cargo-bay-small",
  displayName: "Small Cargo Bay",
  type: "cargo",
  size: "small",
  mass: 1,
  powerDraw: 0,
  cargoCapacity: 16,
};

const PULSE_LASER_SMALL: ShipWeaponComponent = {
  id: SHIP_COMPONENT_IDS.pulseLaserSmall,
  slug: "pulse-laser-small",
  displayName: "Small Pulse Laser",
  type: "weapon",
  size: "small",
  mass: 0,
  powerDraw: 2,
  damage: 8,
  cooldownTicks: 12,
  range: 90,
};

const SCOUT_SHIP_TEMPLATE: ShipTemplateDefinition = {
  id: TEMPLATE_IDS.scoutShip,
  slug: "scout-ship",
  displayName: "Scout",
  hull: {
    maxHealth: 100,
    colliderRadius: 0.9,
    baseMass: 18,
    basePower: 10,
  },
  slots: [
    { id: "main-engine-1", type: "engine", size: "small" },
    { id: "main-engine-2", type: "engine", size: "small" },
    { id: "fuel-1", type: "fuelTank", size: "small" },
    { id: "cargo-1", type: "cargo", size: "small" },
    { id: "weapon-1", type: "weapon", size: "small", arc: "front" },
  ],
  defaultLoadout: {
    slug: "scout-default",
    displayName: "Scout Patrol",
    componentsBySlot: {
      "main-engine-1": SHIP_COMPONENT_IDS.ionEngineSmall,
      "main-engine-2": SHIP_COMPONENT_IDS.ionEngineSmall,
      "fuel-1": SHIP_COMPONENT_IDS.fuelTankSmall,
      "cargo-1": SHIP_COMPONENT_IDS.cargoBaySmall,
      "weapon-1": SHIP_COMPONENT_IDS.pulseLaserSmall,
    },
  },
  initialVelocity: { x: 0, y: 0, z: 0 },
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
  shipComponents: [
    ION_ENGINE_SMALL,
    FUEL_TANK_SMALL,
    CARGO_BAY_SMALL,
    PULSE_LASER_SMALL,
  ],
  unitTemplates: [SCOUT_SHIP_TEMPLATE],
  planetTemplates: [BILLBOARD_PLANET_TEMPLATE],
});

export function createContentRegistry(options: {
  shipComponents: readonly ShipComponentTemplate[];
  unitTemplates: readonly ShipTemplateDefinition[];
  planetTemplates: readonly PlanetTemplate[];
}): ContentRegistry {
  const { shipComponents, planetTemplates } = options;
  const shipComponentsById = new Map(
    shipComponents.map((component) => [component.id, component])
  );
  const unitTemplates = options.unitTemplates.map((template) =>
    resolveShipTemplate(template, shipComponentsById)
  );
  const templatesById = new Map(unitTemplates.map((template) => [template.id, template]));
  const planetTemplatesById = new Map(
    planetTemplates.map((template) => [template.id, template])
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
  componentsById: ReadonlyMap<number, ShipComponentTemplate>
): ShipTemplate {
  return {
    ...template,
    stats: deriveShipStats(template, componentsById),
  };
}

function deriveShipStats(
  template: ShipTemplateDefinition,
  componentsById: ReadonlyMap<number, ShipComponentTemplate>
): ShipStats {
  let dryMass = template.hull.baseMass;
  let powerDraw = 0;
  let fuelCapacity = 0;
  let fuelUsePerSecond = 0;
  let cargoCapacity = 0;
  let weaponCount = 0;
  let engineThrust = 0;
  let turnThrust = 0;

  for (const slot of template.slots) {
    const componentId = template.defaultLoadout.componentsBySlot[slot.id];

    if (componentId === undefined) {
      continue;
    }

    const component = componentsById.get(componentId);

    if (!component) {
      throw new Error(
        `Ship template ${template.slug} references unknown component ${componentId}`
      );
    }

    if (component.type !== slot.type || component.size !== slot.size) {
      throw new Error(
        `Ship template ${template.slug} slot ${slot.id} cannot mount ${component.slug}`
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
  const maxSpeed =
    dryMass > 0 ? engineThrust / (dryMass * SHIP_SPEED_MASS_FACTOR) : 0;

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

export { createMinimalSkirmishConfig };
