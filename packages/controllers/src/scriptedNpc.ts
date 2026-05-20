import {
  SHIP_CLASS_IDS,
  handleKey,
  sameHandle,
  type EntityHandle,
  type PlayerId,
  type ScheduledCommand,
  type StableHandleKey,
  type UnitOrderIntent,
} from "@drop-ship/protocol";
import {
  distanceSquared,
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  isPlayerControlledBy,
  readNpcRules,
  type SimPlanet,
  type SimUnit,
  type SimWorld,
} from "@drop-ship/sim";

export type CommandController = Readonly<{
  id: string;
  commandsForTick: (world: SimWorld) => readonly ScheduledCommand[];
  reset?: (world: SimWorld) => void;
}>;

export type ScriptedNpcControllerOptions = Readonly<{
  id?: string;
  playerIds?: readonly PlayerId[];
  dedupeOrders?: boolean;
}>;

export function createScriptedNpcController(
  options: ScriptedNpcControllerOptions = {}
): CommandController {
  const clientSeqByPlayer = new Map<PlayerId, number>();

  return {
    id: options.id ?? "scripted-v1",
    reset() {
      clientSeqByPlayer.clear();
    },
    commandsForTick(world) {
      return createScriptedNpcCommands(world, {
        playerIds: options.playerIds,
        dedupeOrders: options.dedupeOrders,
        nextClientSeq(playerId) {
          const clientSeq = (clientSeqByPlayer.get(playerId) ?? 0) + 1;
          clientSeqByPlayer.set(playerId, clientSeq);
          return clientSeq;
        },
      });
    },
  };
}

export type CreateScriptedNpcCommandsOptions = Readonly<{
  playerIds?: readonly PlayerId[];
  dedupeOrders?: boolean;
  nextClientSeq?: (playerId: PlayerId) => number;
}>;

export function createScriptedNpcCommands(
  world: SimWorld,
  options: CreateScriptedNpcCommandsOptions = {}
): readonly ScheduledCommand[] {
  if (world.config.gameMode !== "captureDemo") {
    return [];
  }

  const rules = readNpcRules(world);
  const dedupeOrders = options.dedupeOrders ?? true;

  if (world.tick % rules.thinkIntervalTicks !== 0) {
    return [];
  }

  const commands: ScheduledCommand[] = [];
  const localClientSeqByPlayer = new Map<PlayerId, number>();
  const plannedDropShipTargets = new Map<StableHandleKey, EntityHandle>();
  const nextClientSeq =
    options.nextClientSeq ??
    ((playerId: PlayerId) => {
      const clientSeq = (localClientSeqByPlayer.get(playerId) ?? 0) + 1;
      localClientSeqByPlayer.set(playerId, clientSeq);
      return clientSeq;
    });

  for (const unit of getUnitsInStableOrder(world)) {
    if (!isScriptedNpcUnit(world, unit, options.playerIds)) {
      continue;
    }

    const order = chooseScriptedNpcOrder(
      world,
      unit,
      {
        aggroRangeWorldUnits: rules.aggroRangeWorldUnits,
        dropShipThreatRangeWorldUnits: rules.dropShipThreatRangeWorldUnits,
      },
      plannedDropShipTargets
    );

    if (!order) {
      continue;
    }

    if (
      unit.shipClassId === SHIP_CLASS_IDS.dropShip &&
      order.type === "capturePlanet"
    ) {
      plannedDropShipTargets.set(handleKey(unit.handle), order.planet);
    }

    if (dedupeOrders && unit.moveOrder && sameUnitOrder(unit.moveOrder, order)) {
      continue;
    }

    commands.push({
      playerId: unit.owner,
      clientSeq: nextClientSeq(unit.owner),
      command: {
        type: "issueUnitOrder",
        unitHandles: [unit.handle],
        order,
        queueMode: "replace",
      },
    });
  }

  return commands;
}

function isScriptedNpcUnit(
  world: SimWorld,
  unit: SimUnit,
  playerIds: readonly PlayerId[] | undefined
): boolean {
  if (unit.health.current <= 0) {
    return false;
  }

  if (playerIds) {
    return playerIds.includes(unit.owner);
  }

  return isPlayerControlledBy(world, unit.owner, "npc");
}

function chooseScriptedNpcOrder(
  world: SimWorld,
  unit: SimUnit,
  rules: Pick<
    ReturnType<typeof readNpcRules>,
    "aggroRangeWorldUnits" | "dropShipThreatRangeWorldUnits"
  >,
  plannedDropShipTargets: ReadonlyMap<StableHandleKey, EntityHandle>
): UnitOrderIntent | null {
  const dropShip = findProtectedDropShip(world, unit);

  if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
    const targetPlanet = chooseDropShipTargetPlanet(
      world,
      unit,
      plannedDropShipTargets
    );

    return targetPlanet
      ? {
          type: "capturePlanet",
          planet: targetPlanet.handle,
        }
      : null;
  }

  const dropShipThreat = dropShip
    ? findNearestEnemy(world, dropShip, rules.dropShipThreatRangeWorldUnits)
    : null;

  if (dropShipThreat) {
    return {
      type: "attackTarget",
      target: dropShipThreat.handle,
    };
  }

  if (dropShip && unit.shipClassId === SHIP_CLASS_IDS.fighter) {
    return {
      type: "escort",
      target: dropShip.handle,
    };
  }

  const target = findNearestEnemy(world, unit, rules.aggroRangeWorldUnits);

  if (target) {
    return {
      type: "attackTarget",
      target: target.handle,
    };
  }

  const guardPlanet = readDropShipTargetPlanet(world, dropShip);

  return guardPlanet
    ? {
        type: "guardPlanet",
        planet: guardPlanet.handle,
      }
    : null;
}

function sameUnitOrder(
  left: UnitOrderIntent,
  right: UnitOrderIntent
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "moveTo" && right.type === "moveTo") {
    return (
      left.target.x === right.target.x &&
      left.target.y === right.target.y &&
      left.target.z === right.target.z
    );
  }

  if (
    (left.type === "attackTarget" || left.type === "escort") &&
    (right.type === "attackTarget" || right.type === "escort")
  ) {
    return sameHandle(left.target, right.target);
  }

  if (
    (left.type === "capturePlanet" ||
      left.type === "guardPlanet" ||
      left.type === "orbitPlanet") &&
    (right.type === "capturePlanet" ||
      right.type === "guardPlanet" ||
      right.type === "orbitPlanet")
  ) {
    return sameHandle(left.planet, right.planet);
  }

  return false;
}

function findProtectedDropShip(world: SimWorld, unit: SimUnit): SimUnit | null {
  if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
    return unit;
  }

  return (
    getUnitsInStableOrder(world).find(
      (candidate) =>
        candidate.owner === unit.owner &&
        candidate.shipClassId === SHIP_CLASS_IDS.dropShip &&
        candidate.health.current > 0
    ) ?? null
  );
}

function chooseDropShipTargetPlanet(
  world: SimWorld,
  dropShip: SimUnit,
  plannedDropShipTargets: ReadonlyMap<StableHandleKey, EntityHandle>
): SimPlanet | null {
  let best: SimPlanet | null = null;
  let bestScore: PlanetCaptureScore | null = null;

  for (const planet of getPlanetsInStableOrder(world)) {
    if (!planet.control.capturable) {
      continue;
    }

    const score = scorePlanetCaptureOpportunity(
      world,
      dropShip,
      planet,
      plannedDropShipTargets
    );

    if (!bestScore || comparePlanetCaptureScores(score, bestScore) < 0) {
      best = planet;
      bestScore = score;
    }
  }

  return best;
}

type PlanetCaptureScore = Readonly<{
  ownerPriority: number;
  friendlyAssignmentCount: number;
  currentTargetPriority: number;
  contestedPriority: number;
  dropShipDistanceSquared: number;
  enemyDistanceSquared: number;
}>;

function scorePlanetCaptureOpportunity(
  world: SimWorld,
  dropShip: SimUnit,
  planet: SimPlanet,
  plannedDropShipTargets: ReadonlyMap<StableHandleKey, EntityHandle>
): PlanetCaptureScore {
  return {
    ownerPriority: planet.control.owner === dropShip.owner ? 1 : 0,
    friendlyAssignmentCount: countFriendlyDropShipAssignments(
      world,
      dropShip,
      planet,
      plannedDropShipTargets
    ),
    currentTargetPriority: isDropShipTargetingPlanet(dropShip, planet) ? 0 : 1,
    contestedPriority: isPlanetContestedByEnemy(planet, dropShip) ? 1 : 0,
    dropShipDistanceSquared: distanceSquared(dropShip.position, planet.position),
    enemyDistanceSquared: nearestEnemyDistanceSquared(world, dropShip, planet),
  };
}

function comparePlanetCaptureScores(
  left: PlanetCaptureScore,
  right: PlanetCaptureScore
): number {
  if (left.ownerPriority !== right.ownerPriority) {
    return left.ownerPriority - right.ownerPriority;
  }

  if (left.friendlyAssignmentCount !== right.friendlyAssignmentCount) {
    return left.friendlyAssignmentCount - right.friendlyAssignmentCount;
  }

  if (left.currentTargetPriority !== right.currentTargetPriority) {
    return left.currentTargetPriority - right.currentTargetPriority;
  }

  if (left.contestedPriority !== right.contestedPriority) {
    return left.contestedPriority - right.contestedPriority;
  }

  if (left.dropShipDistanceSquared !== right.dropShipDistanceSquared) {
    return left.dropShipDistanceSquared - right.dropShipDistanceSquared;
  }

  return right.enemyDistanceSquared - left.enemyDistanceSquared;
}

function isPlanetContestedByEnemy(
  planet: SimPlanet,
  dropShip: SimUnit
): boolean {
  return (
    planet.control.contested ||
    (planet.control.capturingPlayer !== 0 &&
      planet.control.capturingPlayer !== dropShip.owner)
  );
}

function countFriendlyDropShipAssignments(
  world: SimWorld,
  dropShip: SimUnit,
  planet: SimPlanet,
  plannedDropShipTargets: ReadonlyMap<StableHandleKey, EntityHandle>
): number {
  let count = 0;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner !== dropShip.owner ||
      candidate.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, dropShip.handle)
    ) {
      continue;
    }

    const plannedTarget = plannedDropShipTargets.get(handleKey(candidate.handle));
    const target = plannedTarget ?? readDropShipTargetHandle(candidate);

    if (target && sameHandle(target, planet.handle)) {
      count += 1;
    }
  }

  return count;
}

function isDropShipTargetingPlanet(
  dropShip: SimUnit,
  planet: SimPlanet
): boolean {
  const target = readDropShipTargetHandle(dropShip);

  return Boolean(target && sameHandle(target, planet.handle));
}

function readDropShipTargetHandle(dropShip: SimUnit): EntityHandle | null {
  const order = dropShip.moveOrder;

  return order &&
    (order.type === "capturePlanet" ||
      order.type === "guardPlanet" ||
      order.type === "orbitPlanet")
    ? order.planet
    : null;
}

function nearestEnemyDistanceSquared(
  world: SimWorld,
  unit: SimUnit,
  planet: SimPlanet
): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    nearest = Math.min(
      nearest,
      distanceSquared(candidate.position, planet.position)
    );
  }

  return nearest;
}

function readDropShipTargetPlanet(
  world: SimWorld,
  dropShip: SimUnit | null
): SimPlanet | null {
  if (!dropShip) {
    return (
      getPlanetsInStableOrder(world).find(
        (planet) => planet.control.capturable
      ) ?? null
    );
  }

  const order = dropShip.moveOrder;

  if (
    order &&
    (order.type === "capturePlanet" ||
      order.type === "guardPlanet" ||
      order.type === "orbitPlanet")
  ) {
    const orderedPlanet =
      getPlanetsInStableOrder(world).find((planet) =>
        sameHandle(planet.handle, order.planet)
      ) ?? null;

    if (orderedPlanet) {
      return orderedPlanet;
    }
  }

  return chooseDropShipTargetPlanet(world, dropShip, new Map());
}

function findNearestEnemy(
  world: SimWorld,
  unit: SimUnit,
  maxRange: number
): SimUnit | null {
  const maxRangeSquared = maxRange * maxRange;
  let best: SimUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner === unit.owner ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    const distance = distanceSquared(unit.position, candidate.position);

    if (distance > maxRangeSquared || distance >= bestDistance) {
      continue;
    }

    best = candidate;
    bestDistance = distance;
  }

  return best;
}
