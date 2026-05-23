import {
  SHIP_CLASS_IDS,
  handleKey,
  sameHandle,
  type CommandSource,
  type EntityHandle,
  type OrbitLaneSpec,
  type PlayerId,
  type ScheduledCommand,
  type StableHandleKey,
  type UnitOrderIntent,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  distanceSquared,
  getPlanetsInStableOrder,
  getUnitsInStableOrder,
  isPlayerControlledBy,
  readCaptureRules,
  readNpcRules,
  readUnitShipStats,
  readUnitWeaponProfile,
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
  orbitLaneHeuristics?: boolean;
}>;

export type FleetAutonomyControllerOptions = Readonly<{
  id?: string;
  playerIds: readonly PlayerId[];
  dedupeOrders?: boolean;
  orbitLaneHeuristics?: boolean;
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
        orbitLaneHeuristics: options.orbitLaneHeuristics,
        nextClientSeq(playerId) {
          const clientSeq = (clientSeqByPlayer.get(playerId) ?? 0) + 1;
          clientSeqByPlayer.set(playerId, clientSeq);
          return clientSeq;
        },
      });
    },
  };
}

export function createFleetAutonomyController(
  options: FleetAutonomyControllerOptions
): CommandController {
  const clientSeqByPlayer = new Map<PlayerId, number>();

  return {
    id: options.id ?? "fleet-autonomy-v1",
    reset() {
      clientSeqByPlayer.clear();
    },
    commandsForTick(world) {
      return createScriptedNpcCommands(world, {
        playerIds: options.playerIds,
        source: "autonomy",
        dedupeOrders: options.dedupeOrders,
        orbitLaneHeuristics: options.orbitLaneHeuristics,
        canCommandUnit: (_candidateWorld, unit) =>
          isFleetAutonomyEligibleUnit(unit),
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
  source?: CommandSource;
  dedupeOrders?: boolean;
  orbitLaneHeuristics?: boolean;
  canCommandUnit?: (world: SimWorld, unit: SimUnit) => boolean;
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
  const source = options.source ?? "npc";
  const dedupeOrders = options.dedupeOrders ?? true;
  const orbitLaneHeuristics = options.orbitLaneHeuristics ?? true;

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
    if (
      !isScriptedNpcUnit(world, unit, options.playerIds) ||
      (options.canCommandUnit && !options.canCommandUnit(world, unit))
    ) {
      continue;
    }

    const order = chooseScriptedNpcOrder(
      world,
      unit,
      {
        aggroRangeWorldUnits: rules.aggroRangeWorldUnits,
        dropShipThreatRangeWorldUnits: rules.dropShipThreatRangeWorldUnits,
        orbitLaneHeuristics,
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
      source,
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

function isFleetAutonomyEligibleUnit(unit: SimUnit): boolean {
  if (
    unit.orderQueueMetadata.some(
      (metadata) => metadata.source === "player"
    )
  ) {
    return false;
  }

  if (unit.orderSource === "player") {
    return false;
  }

  if (unit.moveOrder || unit.orderQueue.length > 0) {
    return true;
  }

  if (!unit.lastPlayerOrderEnd) {
    return true;
  }

  return unit.lastPlayerOrderEnd.outcome === "objectiveMet";
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
  > &
    Readonly<{
      orbitLaneHeuristics: boolean;
    }>,
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
      ? withNpcOrbitLane(
          world,
          unit,
          targetPlanet,
          {
            type: "capturePlanet",
            planet: targetPlanet.handle,
          },
          rules.orbitLaneHeuristics
        )
      : null;
  }

  const dropShipThreat = dropShip
    ? findNearestEnemy(world, dropShip, rules.dropShipThreatRangeWorldUnits)
    : null;

  const guardPlanet = readDropShipTargetPlanet(world, dropShip);

  if (
    rules.orbitLaneHeuristics &&
    guardPlanet &&
    unit.shipClassId === SHIP_CLASS_IDS.battleship
  ) {
    return withNpcOrbitLane(
      world,
      unit,
      guardPlanet,
      {
        type: "orbitPlanet",
        planet: guardPlanet.handle,
      },
      true
    );
  }

  if (dropShipThreat) {
    return {
      type: "attackTarget",
      target: dropShipThreat.handle,
    };
  }

  if (
    rules.orbitLaneHeuristics &&
    guardPlanet &&
    unit.shipClassId === SHIP_CLASS_IDS.fighter
  ) {
    return withNpcOrbitLane(
      world,
      unit,
      guardPlanet,
      {
        type: "orbitPlanet",
        planet: guardPlanet.handle,
      },
      true
    );
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

  return guardPlanet
    ? withNpcOrbitLane(
        world,
        unit,
        guardPlanet,
        {
          type: "guardPlanet",
          planet: guardPlanet.handle,
        },
        rules.orbitLaneHeuristics
      )
    : null;
}

type PlanetUnitOrder = Extract<UnitOrderIntent, { planet: EntityHandle }>;

function withNpcOrbitLane<TOrder extends PlanetUnitOrder>(
  world: SimWorld,
  unit: SimUnit,
  planet: SimPlanet,
  order: TOrder,
  enabled: boolean
): TOrder {
  if (!enabled) {
    return order;
  }

  return {
    ...order,
    lane: createNpcOrbitLane(world, unit, planet),
  };
}

function createNpcOrbitLane(
  world: SimWorld,
  unit: SimUnit,
  planet: SimPlanet
): OrbitLaneSpec {
  const stats = readUnitShipStats(world, new Map(), unit);
  const weapon = readUnitWeaponProfile(world, new Map(), unit);
  const axis = createNpcOrbitAxis(unit, planet);
  const radius = readNpcOrbitRadius(
    world,
    unit,
    planet,
    stats.maxAcceleration,
    weapon?.range ?? 0
  );

  return {
    radius,
    axis,
    direction: readNpcOrbitDirection(unit, planet, axis),
  };
}

function readNpcOrbitRadius(
  world: SimWorld,
  unit: SimUnit,
  planet: SimPlanet,
  maxAcceleration: number,
  weaponRange: number
): number {
  const agility = clamp01((maxAcceleration - 34) / 24);

  if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
    const rules = readCaptureRules(world);
    const minRadius = planet.radius * rules.orbitMinRadiusMultiplier;
    const maxRadius = planet.radius * rules.orbitMaxRadiusMultiplier;
    const radius = planet.radius * (1.28 + (1 - agility) * 0.24);

    return clamp(radius, minRadius * 1.03, maxRadius * 0.72);
  }

  if (unit.shipClassId === SHIP_CLASS_IDS.fighter) {
    return clamp(
      planet.radius + weaponRange * (0.42 + agility * 0.16),
      planet.radius * 1.75,
      planet.radius * 3.35
    );
  }

  if (unit.shipClassId === SHIP_CLASS_IDS.battleship) {
    return clamp(
      planet.radius + weaponRange * (0.78 + (1 - agility) * 0.18),
      planet.radius * 2.35,
      planet.radius * 5.6
    );
  }

  return planet.radius * 3;
}

function createNpcOrbitAxis(unit: SimUnit, planet: SimPlanet): Vec3Data {
  const baseAxis = normalizeOrFallback(planet.orbitAxis, { x: 0, y: 1, z: 0 });
  const spreadAxis = stablePerpendicular(baseAxis, unit.shipClassId);
  const side =
    ((unit.handle.id + unit.owner + unit.shipClassId) & 1) === 0 ? 1 : -1;
  const tilt =
    unit.shipClassId === SHIP_CLASS_IDS.dropShip
      ? 0.08
      : unit.shipClassId === SHIP_CLASS_IDS.fighter
        ? 0.34
        : unit.shipClassId === SHIP_CLASS_IDS.battleship
          ? 0.58
          : 0.2;

  return normalizeOrFallback(
    {
      x: baseAxis.x + spreadAxis.x * tilt * side,
      y: baseAxis.y + spreadAxis.y * tilt * side,
      z: baseAxis.z + spreadAxis.z * tilt * side,
    },
    baseAxis
  );
}

function readNpcOrbitDirection(
  unit: SimUnit,
  planet: SimPlanet,
  axis: Vec3Data
): -1 | 1 {
  const offset = subtract(unit.position, planet.position);
  const radial = projectOntoPlane(offset, axis);
  const radialDirection =
    lengthSquared(radial) > 0.000001
      ? normalizeOrFallback(radial, stablePerpendicular(axis, unit.shipClassId))
      : stablePerpendicular(axis, unit.shipClassId);
  const tangent = cross(axis, radialDirection);
  const heading =
    lengthSquared(unit.velocity) > 0.000001
      ? normalizeOrFallback(unit.velocity, tangent)
      : yawForward(unit);

  if (lengthSquared(tangent) <= 0.000001 || lengthSquared(heading) <= 0.000001) {
    return unit.owner === 1 ? 1 : -1;
  }

  return dot(tangent, heading) >= 0 ? 1 : -1;
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
    return (
      sameHandle(left.planet, right.planet) &&
      sameOrbitLane(left.lane, right.lane)
    );
  }

  return false;
}

function sameOrbitLane(
  left: OrbitLaneSpec | undefined,
  right: OrbitLaneSpec | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    Math.abs(left.radius - right.radius) < 0.01 &&
    left.direction === right.direction &&
    Math.abs(left.axis.x - right.axis.x) < 0.001 &&
    Math.abs(left.axis.y - right.axis.y) < 0.001 &&
    Math.abs(left.axis.z - right.axis.z) < 0.001
  );
}

function findProtectedDropShip(world: SimWorld, unit: SimUnit): SimUnit | null {
  if (unit.shipClassId === SHIP_CLASS_IDS.dropShip) {
    return unit;
  }

  const escortedDropShip = findEscortedFriendlyDropShip(world, unit);

  if (escortedDropShip) {
    return escortedDropShip;
  }

  return findNearestFriendlyDropShip(world, unit);
}

function findEscortedFriendlyDropShip(
  world: SimWorld,
  unit: SimUnit
): SimUnit | null {
  if (unit.moveOrder?.type !== "escort") {
    return null;
  }

  const escortedTarget = unit.moveOrder.target;

  return (
    getUnitsInStableOrder(world).find(
      (candidate) =>
        candidate.owner === unit.owner &&
        candidate.shipClassId === SHIP_CLASS_IDS.dropShip &&
        candidate.health.current > 0 &&
        sameHandle(candidate.handle, escortedTarget)
    ) ?? null
  );
}

function findNearestFriendlyDropShip(
  world: SimWorld,
  unit: SimUnit
): SimUnit | null {
  let nearest: SimUnit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of getUnitsInStableOrder(world)) {
    if (
      candidate.owner !== unit.owner ||
      candidate.shipClassId !== SHIP_CLASS_IDS.dropShip ||
      candidate.health.current <= 0 ||
      sameHandle(candidate.handle, unit.handle)
    ) {
      continue;
    }

    const candidateDistance = distanceSquared(unit.position, candidate.position);

    if (candidateDistance >= nearestDistance) {
      continue;
    }

    nearest = candidate;
    nearestDistance = candidateDistance;
  }

  return nearest;
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
  sunPriority: number;
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
    sunPriority: planet.appearance.planetClass === "sun" ? 1 : 0,
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

  if (left.sunPriority !== right.sunPriority) {
    return left.sunPriority - right.sunPriority;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function subtract(left: Vec3Data, right: Vec3Data): Vec3Data {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function dot(left: Vec3Data, right: Vec3Data): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vec3Data, right: Vec3Data): Vec3Data {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function projectOntoPlane(vector: Vec3Data, normal: Vec3Data): Vec3Data {
  const planeOffset = dot(vector, normal);

  return {
    x: vector.x - normal.x * planeOffset,
    y: vector.y - normal.y * planeOffset,
    z: vector.z - normal.z * planeOffset,
  };
}

function lengthSquared(vector: Vec3Data): number {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;
}

function normalizeOrFallback(vector: Vec3Data, fallback: Vec3Data): Vec3Data {
  const vectorLengthSquared = lengthSquared(vector);

  if (vectorLengthSquared <= 0.000001) {
    const fallbackLengthSquared = lengthSquared(fallback);

    return fallbackLengthSquared <= 0.000001
      ? { x: 0, y: 1, z: 0 }
      : scale(fallback, 1 / Math.sqrt(fallbackLengthSquared));
  }

  return scale(vector, 1 / Math.sqrt(vectorLengthSquared));
}

function scale(vector: Vec3Data, scalar: number): Vec3Data {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function stablePerpendicular(axis: Vec3Data, salt: number): Vec3Data {
  const references: readonly Vec3Data[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 0 },
  ];
  const primary = references[Math.abs(salt) % references.length];
  let perpendicular = cross(axis, primary);

  if (lengthSquared(perpendicular) <= 0.000001) {
    perpendicular = cross(
      axis,
      references[(Math.abs(salt) + 1) % references.length]
    );
  }

  return normalizeOrFallback(perpendicular, { x: 1, y: 0, z: 0 });
}

function yawForward(unit: SimUnit): Vec3Data {
  return normalizeOrFallback(
    {
      x:
        2 *
        (unit.rotation.x * unit.rotation.z +
          unit.rotation.w * unit.rotation.y),
      y:
        2 *
        (unit.rotation.y * unit.rotation.z -
          unit.rotation.w * unit.rotation.x),
      z:
        1 -
        2 *
          (unit.rotation.x * unit.rotation.x +
            unit.rotation.y * unit.rotation.y),
    },
    { x: unit.owner === 1 ? 1 : -1, y: 0, z: 0 }
  );
}
