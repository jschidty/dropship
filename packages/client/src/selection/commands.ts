import {
  SHIP_CLASS_IDS,
  handleKey,
  type PlayerId,
  type UnitOrderIntent,
  type Vec3Data,
} from "@drop-ship/protocol";
import type { PlanetViewModel, UnitViewModel } from "../types";

export type ObjectiveCommandCardKind =
  | "planet"
  | "attack"
  | "escort"
  | "move"
  | "idle";

export type ObjectiveCommandCard = Readonly<{
  id: string;
  kind: ObjectiveCommandCardKind;
  title: string;
  detail: string;
  unitCount: number;
  unitKeys: readonly string[];
}>;

type ObjectiveGroupOrderType =
  | "attackTarget"
  | "capturePlanet"
  | "escort"
  | "guardPlanet"
  | "holdOrbit"
  | "idle"
  | "moveTo"
  | "orbitPlanet";

type ObjectiveGroupDraft = {
  id: string;
  kind: ObjectiveCommandCardKind;
  targetLabel: string;
  orderTypes: Set<ObjectiveGroupOrderType>;
  units: UnitViewModel[];
};

type UnitObjectiveGrouping = Readonly<{
  id: string;
  kind: ObjectiveCommandCardKind;
  targetLabel: string;
  orderType: ObjectiveGroupOrderType;
}>;

export function selectMoveOrderUnits(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  selectedUnitKeys: ReadonlySet<string>,
  leaderKey: string | null
): readonly UnitViewModel[] {
  const selectedUnits = units.filter(
    (unit) => unit.owner === playerId && selectedUnitKeys.has(unit.key)
  );

  if (selectedUnits.length === 0) {
    return [];
  }

  const leader = leaderKey
    ? selectedUnits.find((unit) => unit.key === leaderKey)
    : null;

  return leader ? [leader] : selectedUnits;
}

export function selectClassHotkeyUnitKeys(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  selectedUnitKeys: ReadonlySet<string>,
  shipClassId: number
): readonly string[] {
  const ownedClassUnitKeys = units
    .filter(
      (unit) => unit.owner === playerId && unit.shipClassId === shipClassId
    )
    .map((unit) => unit.key);

  if (selectedUnitKeys.size === 0) {
    return ownedClassUnitKeys;
  }

  return ownedClassUnitKeys.filter((unitKey) => selectedUnitKeys.has(unitKey));
}

export function createObjectiveCommandCards(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  planets: readonly PlanetViewModel[]
): readonly ObjectiveCommandCard[] {
  const planetsByKey = new Map(planets.map((planet) => [planet.key, planet]));
  const unitsByKey = new Map(
    units.map((unit) => [handleKey(unit.handle), unit])
  );
  const groups = new Map<string, ObjectiveGroupDraft>();

  for (const unit of units) {
    if (unit.owner !== playerId || (unit.health?.current ?? 1) <= 0) {
      continue;
    }

    const grouping = readUnitObjectiveGrouping(unit, planetsByKey, unitsByKey);
    let group = groups.get(grouping.id);

    if (!group) {
      group = {
        id: grouping.id,
        kind: grouping.kind,
        targetLabel: grouping.targetLabel,
        orderTypes: new Set(),
        units: [],
      };
      groups.set(grouping.id, group);
    }

    group.orderTypes.add(grouping.orderType);
    group.units.push(unit);
  }

  return [...groups.values()]
    .map(createObjectiveCommandCard)
    .sort(compareObjectiveCommandCards);
}

function readUnitObjectiveGrouping(
  unit: UnitViewModel,
  planetsByKey: ReadonlyMap<string, PlanetViewModel>,
  unitsByKey: ReadonlyMap<string, UnitViewModel>
): UnitObjectiveGrouping {
  const order = unit.moveOrder;

  if (order) {
    return readOrderObjectiveGrouping(order, planetsByKey, unitsByKey);
  }

  if (unit.orbit?.isOrbiting && unit.orbit.planet) {
    const planetKey = handleKey(unit.orbit.planet);
    const planet = planetsByKey.get(planetKey);
    const targetLabel = planet?.label ?? "Unknown planet";

    return {
      id: `planet:${planetKey}`,
      kind: "planet",
      targetLabel,
      orderType: "holdOrbit",
    };
  }

  return {
    id: "idle",
    kind: "idle",
    targetLabel: "Idle",
    orderType: "idle",
  };
}

function readOrderObjectiveGrouping(
  order: UnitOrderIntent,
  planetsByKey: ReadonlyMap<string, PlanetViewModel>,
  unitsByKey: ReadonlyMap<string, UnitViewModel>
): UnitObjectiveGrouping {
  switch (order.type) {
    case "capturePlanet":
    case "guardPlanet":
    case "orbitPlanet": {
      const planetKey = handleKey(order.planet);
      const planet = planetsByKey.get(planetKey);
      const targetLabel = planet?.label ?? "Unknown planet";

      return {
        id: `planet:${planetKey}`,
        kind: "planet",
        targetLabel,
        orderType: order.type,
      };
    }
    case "attackTarget": {
      const targetKey = handleKey(order.target);
      const target = unitsByKey.get(targetKey);
      const targetLabel = target
        ? formatObjectiveUnitTargetLabel(target)
        : "Target unavailable";

      return {
        id: `attack:${targetKey}`,
        kind: "attack",
        targetLabel,
        orderType: order.type,
      };
    }
    case "escort": {
      const targetKey = handleKey(order.target);
      const target = unitsByKey.get(targetKey);
      const targetLabel = target
        ? formatObjectiveUnitTargetLabel(target)
        : "Escort unavailable";

      return {
        id: `escort:${targetKey}`,
        kind: "escort",
        targetLabel,
        orderType: order.type,
      };
    }
    case "moveTo":
      return {
        id: `move:${formatObjectiveMoveTargetKey(order.target)}`,
        kind: "move",
        targetLabel: "Waypoint",
        orderType: order.type,
      };
  }
}

function createObjectiveCommandCard(
  group: ObjectiveGroupDraft
): ObjectiveCommandCard {
  const units = group.units
    .slice()
    .sort((first, second) => first.handle.id - second.handle.id);

  return {
    id: group.id,
    kind: group.kind,
    title: formatObjectiveCardTitle(group),
    detail: formatObjectiveCardUnits(units),
    unitCount: units.length,
    unitKeys: units.map((unit) => unit.key),
  };
}

function compareObjectiveCommandCards(
  first: ObjectiveCommandCard,
  second: ObjectiveCommandCard
): number {
  const firstParts = readObjectiveCardSortParts(first);
  const secondParts = readObjectiveCardSortParts(second);

  return (
    firstParts.priority - secondParts.priority ||
    firstParts.label.localeCompare(secondParts.label) ||
    first.id.localeCompare(second.id)
  );
}

function readObjectiveCardSortParts(
  card: ObjectiveCommandCard
): Readonly<{ priority: number; label: string }> {
  const [kind] = card.id.split(":", 1);

  switch (kind) {
    case "planet":
      return { priority: 10, label: card.title };
    case "attack":
      return { priority: 20, label: card.title };
    case "escort":
      return { priority: 30, label: card.title };
    case "move":
      return { priority: 40, label: card.title };
    default:
      return { priority: 50, label: card.title };
  }
}

function formatObjectiveCardTitle(group: ObjectiveGroupDraft): string {
  switch (group.kind) {
    case "planet":
      return formatPlanetObjectiveCardTitle(group);
    case "attack":
      return `Attack ${group.targetLabel}`;
    case "escort":
      return `Escort ${group.targetLabel}`;
    case "move":
      return "Move Waypoint";
    case "idle":
      return "Idle";
  }
}

function formatPlanetObjectiveCardTitle(group: ObjectiveGroupDraft): string {
  const orderTypes = group.orderTypes;

  if (
    orderTypes.size === 1 &&
    (orderTypes.has("orbitPlanet") || orderTypes.has("holdOrbit"))
  ) {
    return `Orbit ${group.targetLabel}`;
  }

  if (orderTypes.size === 1 && orderTypes.has("capturePlanet")) {
    return `Capture ${group.targetLabel}`;
  }

  if (orderTypes.size === 1 && orderTypes.has("guardPlanet")) {
    return `Guard ${group.targetLabel}`;
  }

  if (
    orderTypes.size === 2 &&
    orderTypes.has("orbitPlanet") &&
    orderTypes.has("holdOrbit")
  ) {
    return `Orbit ${group.targetLabel}`;
  }

  return `${group.targetLabel} Operations`;
}

function formatObjectiveCardUnits(units: readonly UnitViewModel[]): string {
  const counts = [
    [SHIP_CLASS_IDS.dropShip, "dropship", "dropships"],
    [SHIP_CLASS_IDS.fighter, "scout", "scouts"],
    [SHIP_CLASS_IDS.battleship, "battleship", "battleships"],
  ] as const;
  const parts = counts
    .map(([shipClassId, singular, plural]) => {
      const count = units.filter((unit) => unit.shipClassId === shipClassId)
        .length;

      if (count === 0) {
        return null;
      }

      return `${count} ${count === 1 ? singular : plural}`;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : `${units.length} units`;
}

function formatObjectiveUnitTargetLabel(unit: UnitViewModel): string {
  return `${unit.label} #${unit.handle.id}`;
}

function formatObjectiveMoveTargetKey(target: Vec3Data): string {
  return `${target.x.toFixed(1)},${target.y.toFixed(1)},${target.z.toFixed(1)}`;
}
