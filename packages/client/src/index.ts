import * as THREE from "three";
import {
  DEFAULT_CONTENT_REGISTRY,
  createMinimalSkirmishConfig,
  type ShipStats,
} from "@drop-ship/content";
import {
  type ClientMessage,
  type CommandBatch,
  createEmptyCommandBatch,
  type EntityHandle,
  handleKey,
  type MatchConfig,
  type PlayerId,
  type ScheduledCommand,
  type ServerMessage,
  type SunConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  PLANET_GRAVITY_MAX_STRENGTH,
  SIM_DT_MS,
  computePlanetGravityVector,
  createWorld,
  hashWorld,
  hydrateWorldFromSnapshot,
  runTick,
  serializeWorld,
  type SimWorld,
} from "@drop-ship/sim";

export type UnitViewModel = Readonly<{
  handle: EntityHandle;
  key: string;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  health: Readonly<{
    current: number;
    max: number;
  }>;
  stats: ShipStats;
}>;

export type PlanetViewModel = Readonly<{
  key: string;
  label: string;
  position: THREE.Vector3;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  orbitAxis: THREE.Vector3;
  parentPlanetIndex: number | null;
}>;

export type LocalGameRuntime = Readonly<{
  playerId: PlayerId;
  world: SimWorld;
  stepTick: () => void;
  enqueueRandomTurn: () => void;
  enqueueMoveUnits: (
    unitHandles: readonly EntityHandle[],
    target: Vec3Data
  ) => void;
  readUnits: () => readonly UnitViewModel[];
  readPlanets: () => readonly PlanetViewModel[];
  readHash: () => string;
  readSnapshot: () => ReturnType<typeof serializeWorld>;
  readConnectionStatus: () => RuntimeConnectionStatus;
  dispose: () => void;
}>;

export type MountedGame = Readonly<{
  runtime: LocalGameRuntime;
  dispose: () => void;
}>;

export type RuntimeConnectionStatus = Readonly<{
  mode: "local" | "network";
  state: "local" | "connecting" | "open" | "closed" | "error";
  playerId: PlayerId;
  matchId?: string;
  serverTick?: number;
  running?: boolean;
  lastAckTick?: number;
  lastError?: string;
  players?: readonly Readonly<{
    playerId: PlayerId;
    connected: boolean;
  }>[];
}>;

export type MountMinimalGameOptions = Readonly<{
  playerId?: PlayerId;
  matchId?: string;
  serverUrl?: string;
  network?: boolean;
  seed?: number;
  stressUnits?: number;
}>;

type MutableUnitViewModel = {
  handle: EntityHandle;
  key: string;
  label: string;
  owner: PlayerId;
  ownerName: string;
  color: string;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  rotation: THREE.Quaternion;
  health: {
    current: number;
    max: number;
  };
  stats: ShipStats;
};

type MutablePlanetViewModel = {
  key: string;
  label: string;
  position: THREE.Vector3;
  mass: number;
  radius: number;
  color: string;
  hasAtmosphere: boolean;
  orbitAxis: THREE.Vector3;
  parentPlanetIndex: number | null;
};

type ViewModelCache = {
  world: SimWorld | null;
  unitTick: number;
  planetTick: number;
  units: MutableUnitViewModel[];
  planets: MutablePlanetViewModel[];
};

type HashCache = {
  world: SimWorld | null;
  tick: number;
  hash: string;
};

type UnitBatchRenderer = {
  root: THREE.Group;
  geometry: THREE.PlaneGeometry;
  selectionMaterial: THREE.MeshBasicMaterial;
  selectionMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  selectionCapacity: number;
  symbolMaterials: Map<PlayerId, THREE.MeshBasicMaterial>;
  symbolMeshes: Map<
    PlayerId,
    THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  >;
  symbolCapacities: Map<PlayerId, number>;
  symbolCounts: Map<PlayerId, number>;
  matrix: THREE.Matrix4;
  billboardQuaternion: THREE.Quaternion;
  iconQuaternion: THREE.Quaternion;
  localRotation: THREE.Quaternion;
  instancePosition: THREE.Vector3;
  scale: THREE.Vector3;
};

type PlanetProxy = {
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  lastSeenFrame: number;
};

type TacticalGrid = THREE.GridHelper;

type SkyDome = Readonly<{
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  material: THREE.ShaderMaterial;
  geometry: THREE.SphereGeometry;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
}>;

type FullscreenPass = Readonly<{
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.ShaderMaterial;
  geometry: THREE.PlaneGeometry;
}>;

type LightingRig = Readonly<{
  group: THREE.Group;
  sunLight: THREE.DirectionalLight;
}>;

type RenderScratch = {
  focus: THREE.Vector3;
  worldUp: THREE.Vector3;
  horizontal: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  pointer: THREE.Vector2;
  raycaster: THREE.Raycaster;
  rayTarget: THREE.Vector3;
  tacticalPlaneNormal: THREE.Vector3;
  tacticalPlane: THREE.Plane;
  projected: THREE.Vector3;
  sunPosition: THREE.Vector3;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  cameraDirection: THREE.Vector3;
  screenPosition: THREE.Vector2;
  sunScreenPosition: THREE.Vector4;
  sunViewDirection: THREE.Vector3;
};

type CameraPresetControls = Readonly<{
  root: HTMLElement;
  buttons: Record<CameraPreset, HTMLButtonElement>;
}>;

type GravityOverlayControls = Readonly<{
  root: HTMLElement;
  input: HTMLInputElement;
}>;

type GravityOverlay = {
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  alphas: Float32Array;
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  sample: THREE.Vector3;
  gravityVector: THREE.Vector3;
  gravityResult: { x: number; y: number; z: number };
  end: THREE.Vector3;
  headBase: THREE.Vector3;
  side: THREE.Vector3;
  headLeft: THREE.Vector3;
  headRight: THREE.Vector3;
  enabled: boolean;
};

type CameraMode = "tactical" | "strategic";

type CameraModeConfig = Readonly<{
  label: string;
  defaultViewHeight: number;
  minViewHeight: number;
  maxViewHeight: number;
  pitch: number;
}>;

type CameraControls = {
  mode: CameraMode;
  preset: CameraPreset | null;
  yaw: number;
  pitch: number;
  viewHeights: Record<CameraMode, number>;
  isDragging: boolean;
  dragMode: "camera" | "select" | null;
  pointerId: number | null;
  startPointerX: number;
  startPointerY: number;
  lastPointerX: number;
  lastPointerY: number;
  dragDistancePx: number;
};

type CameraFocusTween = {
  current: THREE.Vector3;
  from: THREE.Vector3;
  activeContextKey: string | null;
  startAt: number;
  initialized: boolean;
};

type CameraPreset = "top" | "left" | "isometric";

const DEFAULT_LOCAL_PLAYER_ID = 1 satisfies PlayerId;
const MAX_RENDER_PIXEL_RATIO = 1.25;
const MIN_RENDER_PIXEL_RATIO = 1;
const HUD_UPDATE_INTERVAL_MS = 500;
const PERF_DATASET_INTERVAL_MS = 500;
const PIXEL_RATIO_ADJUST_INTERVAL_MS = 1500;
const PIXEL_RATIO_STEP = 0.1;
const LOW_FPS_PIXEL_RATIO_THRESHOLD = 55;
const MAX_SIM_STEPS_PER_FRAME = 5;
const MAX_SIM_FRAME_DELTA_MS = 250;
const INITIAL_INSTANCE_CAPACITY = 64;
const UNIT_SYMBOL_SCALE = 2.4;
const SELECTION_RING_SCALE = 4;
const PLANET_SELECTION_MIN_RADIUS_PX = 10;
const CAMERA_FOCUS_TWEEN_MS = 720;
const GRAVITY_OVERLAY_GRID_SIZE = 11;
const GRAVITY_OVERLAY_MIN_STRENGTH = 0.006;
const GRAVITY_OVERLAY_SEGMENTS_PER_VECTOR = 3;
const GRAVITY_OVERLAY_VERTICES_PER_VECTOR = GRAVITY_OVERLAY_SEGMENTS_PER_VECTOR * 2;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(-0.252, -0.827, -0.502).normalize();
const DEFAULT_SUN_COLOR = new THREE.Color().setRGB(0.643, 0.494, 0.867);
const CAMERA_MODES: Record<CameraMode, CameraModeConfig> = {
  tactical: {
    label: "Tactical",
    defaultViewHeight: 76,
    minViewHeight: 24,
    maxViewHeight: 220,
    pitch: 0.82,
  },
  strategic: {
    label: "Strategic",
    defaultViewHeight: 280,
    minViewHeight: 110,
    maxViewHeight: 900,
    pitch: 1,
  },
};
const CAMERA_PRESETS: Record<
  CameraPreset,
  Readonly<{ label: string; yaw: number; pitch: number }>
> = {
  top: {
    label: "Top",
    yaw: 0,
    pitch: 1.48,
  },
  left: {
    label: "Left",
    yaw: -Math.PI / 2,
    pitch: 0.42,
  },
  isometric: {
    label: "Iso",
    yaw: 0.55,
    pitch: CAMERA_MODES.strategic.pitch,
  },
};

export function createMinimalLocalGame(
  playerId: PlayerId = DEFAULT_LOCAL_PLAYER_ID,
  options: { seed?: number; stressUnits?: number } = {}
): LocalGameRuntime {
  const config = createLocalMatchConfig(options.seed, options.stressUnits);
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const pendingCommands: ScheduledCommand[] = [];
  const viewModelCache = createViewModelCache();
  const hashCache = createHashCache();
  let clientSeq = 0;

  return {
    playerId,
    world,
    stepTick() {
      const commands = pendingCommands.splice(0);
      runTick(
        world,
        commands.length > 0
          ? {
              tick: world.tick,
              commands,
            }
          : createEmptyCommandBatch(world.tick)
      );
    },
    enqueueRandomTurn() {
      clientSeq += 1;
      pendingCommands.push({
        playerId,
        clientSeq,
        command: {
          type: "randomTurnOwnedUnits",
        },
      });
    },
    enqueueMoveUnits(unitHandles, target) {
      if (unitHandles.length === 0) {
        return;
      }

      clientSeq += 1;
      pendingCommands.push({
        playerId,
        clientSeq,
        command: {
          type: "moveUnits",
          unitHandles,
          target,
        },
      });
    },
    readUnits() {
      return readCachedUnitViewModels(world, viewModelCache);
    },
    readPlanets() {
      return readCachedPlanetViewModels(world, viewModelCache);
    },
    readHash() {
      return readCachedHash(world, hashCache);
    },
    readSnapshot() {
      return serializeWorld(world);
    },
    readConnectionStatus() {
      return {
        mode: "local",
        state: "local",
        playerId,
      };
    },
    dispose() {
      pendingCommands.splice(0);
    },
  };
}

export function createNetworkedGame(options: {
  matchId: string;
  playerId: PlayerId;
  serverUrl?: string;
  seed?: number;
}): LocalGameRuntime {
  let world = createWorld({
    config: createMinimalSkirmishConfig({
      matchId: options.matchId,
      seed: options.seed,
    }),
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const queuedBatches = new Map<number, CommandBatch>();
  const outbox: string[] = [];
  let socket: WebSocket | null = null;
  let clientSeq = 0;
  let disposed = false;
  let status: RuntimeConnectionStatus = {
    mode: "network",
    state: "connecting",
    playerId: options.playerId,
    matchId: options.matchId,
    running: false,
  };
  const viewModelCache = createViewModelCache();
  const hashCache = createHashCache();

  const runtime: LocalGameRuntime = {
    playerId: options.playerId,
    get world() {
      return world;
    },
    stepTick() {
      let processed = 0;

      while (processed < 8) {
        const batch = queuedBatches.get(world.tick);

        if (!batch) {
          break;
        }

        queuedBatches.delete(world.tick);
        runTick(world, batch);
        processed += 1;

        if (world.tick % 30 === 0) {
          sendClientMessage({
            type: "hash",
            playerId: options.playerId,
            tick: world.tick,
            hash: readCachedHash(world, hashCache),
          });
        }

        if (options.playerId === 1 && world.tick % 600 === 0) {
          sendClientMessage({
            type: "snapshot",
            playerId: options.playerId,
            tick: world.tick,
            snapshot: serializeWorld(world),
          });
        }
      }
    },
    enqueueRandomTurn() {
      clientSeq += 1;
      sendClientMessage({
        type: "command",
        playerId: options.playerId,
        clientSeq,
        localTick: world.tick,
        command: {
          type: "randomTurnOwnedUnits",
        },
      });
    },
    enqueueMoveUnits(unitHandles, target) {
      if (unitHandles.length === 0) {
        return;
      }

      clientSeq += 1;
      sendClientMessage({
        type: "command",
        playerId: options.playerId,
        clientSeq,
        localTick: world.tick,
        command: {
          type: "moveUnits",
          unitHandles,
          target,
        },
      });
    },
    readUnits() {
      return readCachedUnitViewModels(world, viewModelCache);
    },
    readPlanets() {
      return readCachedPlanetViewModels(world, viewModelCache);
    },
    readHash() {
      return readCachedHash(world, hashCache);
    },
    readSnapshot() {
      return serializeWorld(world);
    },
    readConnectionStatus() {
      return status;
    },
    dispose() {
      disposed = true;
      queuedBatches.clear();
      outbox.splice(0);
      socket?.close();
      socket = null;
    },
  };

  connect();
  return runtime;

  function connect(): void {
    const url = createMatchWebSocketUrl(
      options.matchId,
      options.playerId,
      options.serverUrl,
      options.seed
    );
    socket = new WebSocket(url);
    status = {
      ...status,
      state: "connecting",
    };

    socket.addEventListener("open", () => {
      status = {
        ...status,
        state: "open",
        lastError: undefined,
      };
      sendClientMessage({
        type: "ready",
        playerId: options.playerId,
      });
      flushOutbox();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        receiveServerMessage(event.data);
      }
    });
    socket.addEventListener("close", () => {
      if (!disposed) {
        status = {
          ...status,
          state: "closed",
          running: false,
        };
      }
    });
    socket.addEventListener("error", () => {
      status = {
        ...status,
        state: "error",
        running: false,
        lastError: "WebSocket error",
      };
    });
  }

  function receiveServerMessage(data: string): void {
    const message = JSON.parse(data) as ServerMessage | { type: "error"; code: string };

    if (message.type === "error") {
      status = {
        ...status,
        state: "error",
        lastError: message.code,
      };
      return;
    }

    if (message.type === "matchStart") {
      world = createWorld({
        config: message.config as MatchConfig,
        content: DEFAULT_CONTENT_REGISTRY,
      });
      queuedBatches.clear();
      status = {
        ...status,
        playerId: message.playerId,
        serverTick: message.serverTick,
      };

      if (message.serverTick > world.tick) {
        sendClientMessage({
          type: "reconnect",
          playerId: options.playerId,
          lastTick: world.tick,
        });
      }
      return;
    }

    if (message.type === "tickCommands") {
      if (message.batch.tick >= world.tick) {
        queuedBatches.set(message.batch.tick, message.batch);
      }
      return;
    }

    if (message.type === "commandAck") {
      status = {
        ...status,
        lastAckTick: message.executeTick,
      };
      return;
    }

    if (message.type === "connectionStatus") {
      status = {
        ...status,
        serverTick: message.serverTick,
        running: message.running,
        players: message.players,
      };
      return;
    }

    if (message.type === "catchup") {
      applyCatchup(message);
      return;
    }

    if (message.type === "resyncHard") {
      world = hydrateWorldFromSnapshot(message.snapshot, DEFAULT_CONTENT_REGISTRY);
      queuedBatches.clear();
    }
  }

  function applyCatchup(message: Extract<ServerMessage, { type: "catchup" }>): void {
    world = message.snapshot
      ? hydrateWorldFromSnapshot(message.snapshot, DEFAULT_CONTENT_REGISTRY)
      : createWorld({
          config: world.config,
          content: DEFAULT_CONTENT_REGISTRY,
        });

    queuedBatches.clear();

    const catchupBatches = new Map(
      message.commands.map((batch) => [batch.tick, batch])
    );

    while (world.tick < message.serverTick) {
      runTick(
        world,
        catchupBatches.get(world.tick) ?? createEmptyCommandBatch(world.tick)
      );
    }

    status = {
      ...status,
      serverTick: message.serverTick,
    };
  }

  function sendClientMessage(message: ClientMessage): void {
    const encoded = JSON.stringify(message);

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encoded);
      return;
    }

    outbox.push(encoded);
  }

  function flushOutbox(): void {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (outbox.length > 0) {
      socket.send(outbox.shift() ?? "");
    }
  }
}

function createMatchWebSocketUrl(
  matchId: string,
  playerId: PlayerId,
  serverUrl?: string,
  seed?: number
): string {
  const base =
    serverUrl ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
      window.location.host
    }`;
  const url = new URL(`/api/matches/${encodeURIComponent(matchId)}/ws`, base);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.searchParams.set("player", playerId.toString());

  if (seed !== undefined) {
    url.searchParams.set("seed", seed.toString());
  }

  return url.toString();
}

function createLocalMatchConfig(seed?: number, stressUnits?: number): MatchConfig {
  const config = createMinimalSkirmishConfig({ seed });
  const totalUnits = Math.max(0, Math.floor(stressUnits ?? 0));

  if (totalUnits <= config.initialUnits.length) {
    return config;
  }

  const templateId = config.initialUnits[0]?.templateId ?? 1;
  const initialUnits = [...config.initialUnits];

  for (let index = initialUnits.length; index < totalUnits; index += 1) {
    const owner: PlayerId = index % 2 === 0 ? 1 : 2;
    const ring = Math.floor(index / 48);
    const angle = index * 2.399963229728653;
    const radius = 42 + ring * 7 + (index % 7) * 0.4;

    initialUnits.push({
      owner,
      templateId,
      position: {
        x: Math.cos(angle) * radius,
        y: ((index % 9) - 4) * 1.4,
        z: -60 + Math.sin(angle) * radius,
      },
    });
  }

  return {
    ...config,
    matchId: `${config.matchId}-stress-${totalUnits}`,
    initialUnits,
  };
}

function createViewModelCache(): ViewModelCache {
  return {
    world: null,
    unitTick: -1,
    planetTick: -1,
    units: [],
    planets: [],
  };
}

function readCachedUnitViewModels(
  world: SimWorld,
  cache: ViewModelCache
): readonly UnitViewModel[] {
  if (cache.world !== world) {
    cache.world = world;
    cache.unitTick = -1;
    cache.planetTick = -1;
  }

  if (cache.unitTick !== world.tick || cache.units.length !== world.units.length) {
    syncUnitViewModels(cache.units, world);
    cache.unitTick = world.tick;
  }

  return cache.units;
}

function syncUnitViewModels(
  target: MutableUnitViewModel[],
  world: SimWorld
): void {
  target.length = world.units.length;

  for (let index = 0; index < world.units.length; index += 1) {
    const unit = world.units[index];
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);
    const key = handleKey(unit.handle);
    let view = target[index];

    if (!view || view.key !== key) {
      view = {
        handle: unit.handle,
        key,
        label: template.displayName,
        owner: unit.owner,
        ownerName: player?.name ?? `Player ${unit.owner}`,
        color: player?.color ?? "#ffffff",
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        health: {
          current: unit.health.current,
          max: unit.health.max,
        },
        stats: template.stats,
      };
      target[index] = view;
    }

    view.handle = unit.handle;
    view.label = template.displayName;
    view.owner = unit.owner;
    view.ownerName = player?.name ?? `Player ${unit.owner}`;
    view.color = player?.color ?? "#ffffff";
    view.position.set(unit.position.x, unit.position.y, unit.position.z);
    view.prevPosition.set(
      unit.prevPosition.x,
      unit.prevPosition.y,
      unit.prevPosition.z
    );
    view.rotation.set(
      unit.rotation.x,
      unit.rotation.y,
      unit.rotation.z,
      unit.rotation.w
    );
    view.health.current = unit.health.current;
    view.health.max = unit.health.max;
    view.stats = template.stats;
  }
}

function readCachedPlanetViewModels(
  world: SimWorld,
  cache: ViewModelCache
): readonly PlanetViewModel[] {
  if (cache.world !== world) {
    cache.world = world;
    cache.unitTick = -1;
    cache.planetTick = -1;
  }

  if (
    cache.planetTick !== world.tick ||
    cache.planets.length !== world.planets.length
  ) {
    syncPlanetViewModels(cache.planets, world);
    cache.planetTick = world.tick;
  }

  return cache.planets;
}

function syncPlanetViewModels(
  target: MutablePlanetViewModel[],
  world: SimWorld
): void {
  target.length = world.planets.length;

  for (let index = 0; index < world.planets.length; index += 1) {
    const planet = world.planets[index];
    const template = world.content.getPlanetTemplate(planet.templateId);
    const key = handleKey(planet.handle);
    let view = target[index];

    if (!view || view.key !== key) {
      view = {
        key,
        label: planet.name || template.displayName,
        position: new THREE.Vector3(),
        mass: planet.mass,
        radius: planet.radius,
        color: planet.color,
        hasAtmosphere: planet.hasAtmosphere,
        orbitAxis: new THREE.Vector3(),
        parentPlanetIndex: planet.parentPlanetIndex,
      };
      target[index] = view;
    }

    view.label = planet.name || template.displayName;
    view.position.set(planet.position.x, planet.position.y, planet.position.z);
    view.mass = planet.mass;
    view.radius = planet.radius;
    view.color = planet.color;
    view.hasAtmosphere = planet.hasAtmosphere;
    view.orbitAxis.set(planet.orbitAxis.x, planet.orbitAxis.y, planet.orbitAxis.z);
    view.parentPlanetIndex = planet.parentPlanetIndex;
  }
}

function createHashCache(): HashCache {
  return {
    world: null,
    tick: -1,
    hash: "",
  };
}

function readCachedHash(world: SimWorld, cache: HashCache): string {
  if (cache.world !== world || cache.tick !== world.tick) {
    cache.world = world;
    cache.tick = world.tick;
    cache.hash = hashWorld(world);
  }

  return cache.hash;
}

export function readUnitViewModels(world: SimWorld): readonly UnitViewModel[] {
  return world.units.map((unit) => {
    const player = world.config.players.find((entry) => entry.id === unit.owner);
    const template = world.content.getUnitTemplate(unit.templateId);

    return {
      handle: unit.handle,
      key: handleKey(unit.handle),
      label: template.displayName,
      owner: unit.owner,
      ownerName: player?.name ?? `Player ${unit.owner}`,
      color: player?.color ?? "#ffffff",
      position: toVector3(unit.position),
      prevPosition: toVector3(unit.prevPosition),
      rotation: toQuaternion(unit.rotation),
      health: {
        current: unit.health.current,
        max: unit.health.max,
      },
      stats: template.stats,
    };
  });
}

export function readPlanetViewModels(world: SimWorld): readonly PlanetViewModel[] {
  return world.planets.map((planet) => {
    const template = world.content.getPlanetTemplate(planet.templateId);

    return {
      key: handleKey(planet.handle),
      label: planet.name || template.displayName,
      position: toVector3(planet.position),
      mass: planet.mass,
      radius: planet.radius,
      color: planet.color,
      hasAtmosphere: planet.hasAtmosphere,
      orbitAxis: toVector3(planet.orbitAxis),
      parentPlanetIndex: planet.parentPlanetIndex,
    };
  });
}

export function mountMinimalGame(
  container: HTMLElement,
  options: MountMinimalGameOptions = {}
): MountedGame {
  const playerId = options.playerId ?? DEFAULT_LOCAL_PLAYER_ID;
  const runtime =
    options.network || options.matchId
      ? createNetworkedGame({
          matchId: options.matchId ?? "demo",
          playerId,
          serverUrl: options.serverUrl,
          seed: options.seed,
        })
      : createMinimalLocalGame(playerId, {
          seed: options.seed,
          stressUnits: options.stressUnits,
        });
  const scene = new THREE.Scene();
  const nebulaSkyDome = createNebulaSkyDome();
  const sunFlarePass = createSunFlarePass();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  const cameraControls: CameraControls = {
    mode: "strategic",
    preset: "isometric",
    yaw: CAMERA_PRESETS.isometric.yaw,
    pitch: CAMERA_PRESETS.isometric.pitch,
    viewHeights: {
      tactical: CAMERA_MODES.tactical.defaultViewHeight,
      strategic: CAMERA_MODES.strategic.defaultViewHeight,
    },
    isDragging: false,
    dragMode: null,
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    dragDistancePx: 0,
  };

  let activeRenderPixelRatio = getPreferredRenderPixelRatio();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(activeRenderPixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x01020a, 1);
  renderer.domElement.className = "game-canvas";
  container.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  worldGroup.name = "sim-world";
  scene.add(worldGroup);

  const unitBatches = createUnitBatchRenderer();
  worldGroup.add(unitBatches.root);
  const planetProxies = new Map<string, PlanetProxy>();
  const planetGeometry = new THREE.PlaneGeometry(1, 1);
  const planetMaterial = createPlanetBillboardMaterial();
  const gravityOverlay = createGravityOverlay();
  worldGroup.add(gravityOverlay.root);
  const selectedUnitKeys = new Set<string>();
  let selectedPlanetKey: string | null = null;
  const statsLayer = createStatsLayer(container);
  const selectionBox = createSelectionBox(container);
  const cameraPresetControls = createCameraPresetControls(container, (preset) => {
    applyCameraPreset(cameraControls, preset);
  });
  const gravityOverlayControls = createGravityOverlayControls(
    container,
    (enabled) => {
      setGravityOverlayEnabled(gravityOverlay, gravityOverlayControls, enabled);
    }
  );
  const renderResolution = new THREE.Vector2();
  const scratch = createRenderScratch();
  const cameraFocusTween = createCameraFocusTween();

  const lighting = createLighting(
    writeSunDirection(scratch.sunDirection, runtime.world.config),
    writeSunColor(scratch.sunColor, runtime.world.config)
  );
  scene.add(lighting.group);
  const tacticalGrid = createTacticalPlane();
  scene.add(tacticalGrid);

  const startedAt = performance.now();
  let frameId = 0;
  let disposed = false;
  let lastFrameAt = startedAt;
  let estimatedFps = 60;
  let observedSimHz = 0;
  let simAccumulatorMs = 0;
  let lastSimSampleAt = startedAt;
  let simTicksSinceSample = 0;
  let estimatedRenderMs = 0;
  let lastHudUpdateAt = -HUD_UPDATE_INTERVAL_MS;
  let lastPerfDatasetUpdateAt = -PERF_DATASET_INTERVAL_MS;
  let lastPixelRatioAdjustAt = startedAt;
  let renderFrameIndex = 0;
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "r") {
      runtime.enqueueRandomTurn();
      return;
    }

    if (key === "1") {
      selectedUnitKeys.clear();

      for (const unit of runtime.readUnits()) {
        if (unit.owner === runtime.playerId) {
          selectedUnitKeys.add(unit.key);
        }
      }

      return;
    }

    if (key === "d") {
      selectedUnitKeys.clear();
      selectedPlanetKey = null;
      return;
    }

    if (key === "g") {
      setGravityOverlayEnabled(
        gravityOverlay,
        gravityOverlayControls,
        !gravityOverlay.enabled
      );
      return;
    }

    if (key === "2") {
      setCameraMode(cameraControls, "strategic");
      return;
    }

    if (key === "tab") {
      event.preventDefault();
      setCameraMode(
        cameraControls,
        cameraControls.mode === "tactical" ? "strategic" : "tactical"
      );
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
      return;
    }

    event.preventDefault();
    cameraControls.isDragging = true;
    cameraControls.dragMode =
      event.button !== 0 || event.altKey ? "camera" : "select";
    cameraControls.pointerId = event.pointerId;
    cameraControls.startPointerX = event.clientX;
    cameraControls.startPointerY = event.clientY;
    cameraControls.lastPointerX = event.clientX;
    cameraControls.lastPointerY = event.clientY;
    cameraControls.dragDistancePx = 0;
    hideSelectionBox(selectionBox);
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!cameraControls.isDragging || cameraControls.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - cameraControls.lastPointerX;
    const dy = event.clientY - cameraControls.lastPointerY;
    cameraControls.dragDistancePx += Math.hypot(dx, dy);
    cameraControls.lastPointerX = event.clientX;
    cameraControls.lastPointerY = event.clientY;

    if (cameraControls.dragMode === "camera") {
      cameraControls.preset = null;
      cameraControls.yaw -= dx * 0.006;
      cameraControls.pitch = clamp(cameraControls.pitch + dy * 0.004, 0.28, 1.38);
      updateCameraPresetControls(cameraPresetControls, cameraControls.preset);
      return;
    }

    if (
      cameraControls.dragMode === "select" &&
      cameraControls.dragDistancePx > 5
    ) {
      updateSelectionBox(
        selectionBox,
        container,
        cameraControls.startPointerX,
        cameraControls.startPointerY,
        event.clientX,
        event.clientY
      );
    }
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (cameraControls.pointerId !== event.pointerId) {
      return;
    }

    const wasClick = cameraControls.dragDistancePx <= 5;
    const dragMode = cameraControls.dragMode;
    cameraControls.isDragging = false;
    cameraControls.dragMode = null;
    cameraControls.pointerId = null;
    hideSelectionBox(selectionBox);

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (event.type !== "pointerup") {
      return;
    }

    if (dragMode === "select" && !wasClick) {
      selectOwnedUnitsInBox(
        selectedUnitKeys,
        runtime.readUnits(),
        runtime.playerId,
        camera,
        renderer.domElement,
        cameraControls.startPointerX,
        cameraControls.startPointerY,
        event.clientX,
        event.clientY,
        scratch
      );
      return;
    }

    if (dragMode === "select" && wasClick) {
      const selectedPlanet = findPlanetAtPointer(
        event,
        renderer.domElement,
        camera,
        runtime.readPlanets(),
        scratch
      );

      if (selectedPlanet) {
        selectedPlanetKey = selectedPlanet.key;
        setGravityOverlayEnabled(
          gravityOverlay,
          gravityOverlayControls,
          true
        );
        return;
      }

      issueMoveCommandFromClick(
        event,
        renderer.domElement,
        camera,
        runtime,
        selectedUnitKeys,
        selectedPlanetKey,
        scratch
      );
    }
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const config = CAMERA_MODES[cameraControls.mode];
    const currentHeight = cameraControls.viewHeights[cameraControls.mode];
    const nextHeight = clamp(
      currentHeight * Math.exp(event.deltaY * 0.001),
      config.minViewHeight,
      config.maxViewHeight
    );
    cameraControls.viewHeights[cameraControls.mode] = nextHeight;
  };

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    applyCameraControls(
      camera,
      cameraControls,
      container,
      writeResizeCameraFocus(
        cameraFocusTween,
        scratch.focus,
        runtime.readUnits(),
        runtime.readPlanets(),
        selectedPlanetKey
      ),
      scratch
    );
    renderer.setSize(clientWidth, clientHeight, false);
  };

  const adjustRenderPixelRatio = (now: number) => {
    if (now - lastPixelRatioAdjustAt < PIXEL_RATIO_ADJUST_INTERVAL_MS) {
      return;
    }

    lastPixelRatioAdjustAt = now;

    if (
      estimatedFps >= LOW_FPS_PIXEL_RATIO_THRESHOLD ||
      activeRenderPixelRatio <= MIN_RENDER_PIXEL_RATIO
    ) {
      return;
    }

    activeRenderPixelRatio = Math.max(
      MIN_RENDER_PIXEL_RATIO,
      Number((activeRenderPixelRatio - PIXEL_RATIO_STEP).toFixed(2))
    );
    renderer.setPixelRatio(activeRenderPixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
  };

  const advanceSimulation = (now: number, frameDeltaMs: number): number => {
    simAccumulatorMs += Math.min(frameDeltaMs, MAX_SIM_FRAME_DELTA_MS);
    let simSteps = 0;

    while (
      simAccumulatorMs >= SIM_DT_MS &&
      simSteps < MAX_SIM_STEPS_PER_FRAME
    ) {
      runtime.stepTick();
      simAccumulatorMs -= SIM_DT_MS;
      simSteps += 1;
      simTicksSinceSample += 1;
    }

    if (simSteps === MAX_SIM_STEPS_PER_FRAME && simAccumulatorMs >= SIM_DT_MS) {
      simAccumulatorMs %= SIM_DT_MS;
    }

    if (now - lastSimSampleAt >= 1000) {
      observedSimHz = (simTicksSinceSample * 1000) / (now - lastSimSampleAt);
      simTicksSinceSample = 0;
      lastSimSampleAt = now;
    }

    return clamp(simAccumulatorMs / SIM_DT_MS, 0, 1);
  };

  const renderCurrentFrame = (
    now = performance.now(),
    interpolationAlpha = 1
  ) => {
    const renderStartedAt = performance.now();
    const units = runtime.readUnits();
    const planets = runtime.readPlanets();
    selectedPlanetKey = pruneSelectedPlanetKey(selectedPlanetKey, planets);
    const planetaryContext = getCurrentPlanetaryContext(
      planets,
      selectedPlanetKey
    );
    const focus = writeCameraFocusPosition(
      scratch.focus,
      units,
      planets,
      selectedPlanetKey
    );
    const displayedFocus = updateCameraFocusTween(
      cameraFocusTween,
      planetaryContext?.key ?? null,
      focus,
      now
    );
    const sunDirection = writeSunDirection(scratch.sunDirection, runtime.world.config);
    const sunColor = writeSunColor(scratch.sunColor, runtime.world.config);
    const sunDistance = readSunDistance(runtime.world.config.environment.sun);
    const elapsedSeconds = (now - startedAt) / 1000;
    renderFrameIndex += 1;

    pruneSelectedUnitKeys(selectedUnitKeys, units);

    updatePlanetProxies(
      worldGroup,
      planetProxies,
      planets,
      planetaryContext?.key ?? null,
      renderFrameIndex,
      planetGeometry,
      planetMaterial
    );
    applyCameraControls(camera, cameraControls, container, displayedFocus, scratch);
    camera.updateMatrixWorld();
    updateLighting(lighting, sunDirection, sunColor);
    updateUnitBatches(
      unitBatches,
      units,
      selectedUnitKeys,
      camera,
      interpolationAlpha
    );
    adjustRenderPixelRatio(now);
    renderer.getDrawingBufferSize(renderResolution);
    updateNebulaSkyDome(
      nebulaSkyDome,
      elapsedSeconds,
      camera,
      renderResolution
    );
    updatePlanetBillboards(
      planetProxies,
      camera,
      elapsedSeconds,
      sunDirection,
      scratch
    );
    updateTacticalGrid(tacticalGrid, planetaryContext);
    updateGravityOverlay(
      gravityOverlay,
      planetaryContext,
      planetaryContext ? [planetaryContext] : []
    );
    const sunScreenPosition = updateSunFlarePass(
      sunFlarePass,
      camera,
      displayedFocus,
      planets,
      sunDirection,
      sunDistance,
      sunColor,
      renderResolution,
      elapsedSeconds,
      scratch
    );

    if (now - lastHudUpdateAt >= HUD_UPDATE_INTERVAL_MS) {
      container.dataset.cameraMode = cameraControls.mode;
      container.dataset.cameraFocus = planetaryContext?.label ?? "none";
      container.dataset.selectedPlanet = planetaryContext?.label ?? "none";
      container.dataset.cameraYaw = cameraControls.yaw.toFixed(4);
      container.dataset.cameraPitch = cameraControls.pitch.toFixed(4);
      container.dataset.cameraViewHeight =
        cameraControls.viewHeights[cameraControls.mode].toFixed(2);
      container.dataset.sunScreenX = sunScreenPosition.x.toFixed(3);
      container.dataset.sunScreenY = sunScreenPosition.y.toFixed(3);
      container.dataset.sunVisible = sunScreenPosition.z.toFixed(3);
      container.dataset.sunOcclusion = sunScreenPosition.w.toFixed(3);
      container.dataset.unitCount = units.length.toString();
      container.dataset.selectedUnitCount = selectedUnitKeys.size.toString();
      container.dataset.gravityOverlay = gravityOverlay.enabled ? "on" : "off";
      container.dataset.playerId = runtime.playerId.toString();
      container.dataset.connectionState = runtime.readConnectionStatus().state;
      container.dataset.simHz = observedSimHz.toFixed(1);
      container.dataset.simInterpolationAlpha = interpolationAlpha.toFixed(3);
      updateCameraPresetControls(cameraPresetControls, cameraControls.preset);
      lastHudUpdateAt = now;
    }

    renderer.info.reset();
    renderer.clear();
    renderer.render(nebulaSkyDome.scene, nebulaSkyDome.camera);
    renderer.clearDepth();
    renderer.render(scene, camera);

    if (sunScreenPosition.z > 0.002) {
      renderer.clearDepth();
      renderer.render(sunFlarePass.scene, sunFlarePass.camera);
    }

    const renderMs = performance.now() - renderStartedAt;
    estimatedRenderMs =
      estimatedRenderMs === 0 ? renderMs : estimatedRenderMs * 0.9 + renderMs * 0.1;

    if (now - lastPerfDatasetUpdateAt >= PERF_DATASET_INTERVAL_MS) {
      container.dataset.fps = estimatedFps.toFixed(1);
      container.dataset.renderMs = estimatedRenderMs.toFixed(2);
      container.dataset.renderPixelRatio = renderer.getPixelRatio().toFixed(2);
      container.dataset.drawCalls = renderer.info.render.calls.toString();
      container.dataset.triangles = renderer.info.render.triangles.toString();
      updateStatsLayer(
        statsLayer,
        runtime,
        estimatedFps,
        observedSimHz,
        estimatedRenderMs,
        renderer.info.render.calls,
        renderer.getPixelRatio(),
        planetaryContext?.label ?? "none",
        selectedUnitKeys.size
      );
      lastPerfDatasetUpdateAt = now;
    }
  };

  const frame = (now: number) => {
    if (disposed) {
      return;
    }

    frameId = requestAnimationFrame(frame);
    const frameDelta = Math.max(now - lastFrameAt, 1);
    const instantaneousFps = 1000 / frameDelta;
    estimatedFps = estimatedFps * 0.92 + instantaneousFps * 0.08;
    lastFrameAt = now;
    const interpolationAlpha = advanceSimulation(now, frameDelta);
    renderCurrentFrame(now, interpolationAlpha);
  };

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", handleKeyDown);
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointercancel", handlePointerUp);
  renderer.domElement.addEventListener("contextmenu", handleContextMenu);
  renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
  applyCameraControls(
    camera,
    cameraControls,
    container,
    writeResizeCameraFocus(
      cameraFocusTween,
      scratch.focus,
      runtime.readUnits(),
      runtime.readPlanets(),
      selectedPlanetKey
    ),
    scratch
  );
  resize();
  renderCurrentFrame(startedAt, 1);
  frameId = requestAnimationFrame(frame);

  return {
    runtime,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKeyDown);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      disposeUnitBatchRenderer(unitBatches);
      disposeGravityOverlay(gravityOverlay);
      disposePlanetProxies(worldGroup, planetProxies);
      planetGeometry.dispose();
      planetMaterial.dispose();
      renderer.dispose();
      disposeSkyDome(nebulaSkyDome);
      disposeFullscreenPass(sunFlarePass);
      runtime.dispose();
      container.replaceChildren();
    },
  };
}

function setCameraMode(cameraControls: CameraControls, mode: CameraMode): void {
  cameraControls.mode = mode;
  cameraControls.preset = null;
  cameraControls.pitch = CAMERA_MODES[mode].pitch;
}

function applyCameraPreset(
  cameraControls: CameraControls,
  preset: CameraPreset
): void {
  const cameraPreset = CAMERA_PRESETS[preset];
  cameraControls.preset = preset;
  cameraControls.yaw = cameraPreset.yaw;
  cameraControls.pitch = cameraPreset.pitch;
}

function getPreferredRenderPixelRatio(): number {
  return clamp(
    window.devicePixelRatio,
    MIN_RENDER_PIXEL_RATIO,
    MAX_RENDER_PIXEL_RATIO
  );
}

function createRenderScratch(): RenderScratch {
  return {
    focus: new THREE.Vector3(),
    worldUp: new THREE.Vector3(0, 1, 0),
    horizontal: new THREE.Vector3(),
    cameraOffset: new THREE.Vector3(),
    pointer: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    rayTarget: new THREE.Vector3(),
    tacticalPlaneNormal: new THREE.Vector3(0, 1, 0),
    tacticalPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    projected: new THREE.Vector3(),
    sunPosition: new THREE.Vector3(),
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    cameraDirection: new THREE.Vector3(),
    screenPosition: new THREE.Vector2(),
    sunScreenPosition: new THREE.Vector4(),
    sunViewDirection: new THREE.Vector3(),
  };
}

function createCameraFocusTween(): CameraFocusTween {
  return {
    current: new THREE.Vector3(),
    from: new THREE.Vector3(),
    activeContextKey: null,
    startAt: 0,
    initialized: false,
  };
}

function writeResizeCameraFocus(
  tween: CameraFocusTween,
  target: THREE.Vector3,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null
): THREE.Vector3 {
  if (tween.initialized) {
    return target.copy(tween.current);
  }

  return writeCameraFocusPosition(target, units, planets, selectedPlanetKey);
}

function updateCameraFocusTween(
  tween: CameraFocusTween,
  contextKey: string | null,
  targetFocus: THREE.Vector3,
  now: number
): THREE.Vector3 {
  if (!tween.initialized) {
    tween.current.copy(targetFocus);
    tween.from.copy(targetFocus);
    tween.activeContextKey = contextKey;
    tween.startAt = now;
    tween.initialized = true;
    return tween.current;
  }

  if (tween.activeContextKey !== contextKey) {
    tween.from.copy(tween.current);
    tween.activeContextKey = contextKey;
    tween.startAt = now;
  }

  const progress = clamp((now - tween.startAt) / CAMERA_FOCUS_TWEEN_MS, 0, 1);

  if (progress >= 1) {
    return tween.current.copy(targetFocus);
  }

  return tween.current.lerpVectors(
    tween.from,
    targetFocus,
    smoothstep(0, 1, progress)
  );
}

function applyCameraControls(
  camera: THREE.OrthographicCamera,
  cameraControls: CameraControls,
  container: HTMLElement,
  focus: THREE.Vector3,
  scratch: RenderScratch
): void {
  const { clientWidth, clientHeight } = container;
  const aspect = clientWidth / Math.max(clientHeight, 1);
  const viewHeight = cameraControls.viewHeights[cameraControls.mode];
  const halfHeight = viewHeight / 2;
  const halfWidth = halfHeight * aspect;
  const worldUp = scratch.worldUp.set(0, 1, 0);
  const horizontal = scratch.horizontal.set(
    Math.sin(cameraControls.yaw),
    0,
    Math.cos(cameraControls.yaw)
  ).normalize();
  const orbitDistance = viewHeight * 1.45;
  const cameraOffset = scratch.cameraOffset
    .copy(worldUp)
    .multiplyScalar(Math.sin(cameraControls.pitch) * orbitDistance)
    .add(horizontal.multiplyScalar(Math.cos(cameraControls.pitch) * orbitDistance));

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.up.copy(worldUp);
  camera.position.copy(focus).add(cameraOffset);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();
}

function writeCameraFocusPosition(
  target: THREE.Vector3,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null
): THREE.Vector3 {
  const planet = getCurrentPlanetaryContext(planets, selectedPlanetKey);

  if (planet) {
    return target.copy(planet.position);
  }

  return writeLocalFocusPosition(target, units, DEFAULT_LOCAL_PLAYER_ID);
}

function getCurrentPlanetaryContext(
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null
): PlanetViewModel | null {
  if (selectedPlanetKey) {
    const selected = planets.find((planet) => planet.key === selectedPlanetKey);

    if (selected) {
      return selected;
    }
  }

  return planets.find((planet) => planet.label === "Aurora") ?? planets[0] ?? null;
}

function writeLocalFocusPosition(
  target: THREE.Vector3,
  units: readonly UnitViewModel[],
  playerId: PlayerId
): THREE.Vector3 {
  const localUnit = units.find((unit) => unit.owner === playerId) ?? units[0];
  return localUnit ? target.copy(localUnit.position) : target.set(0, 0, 0);
}

function issueMoveCommandFromClick(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  selectedPlanetKey: string | null,
  scratch: RenderScratch
): boolean {
  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );

  if (selectedUnits.length === 0) {
    return false;
  }

  const target = getPointerMoveTarget(
    event,
    canvas,
    camera,
    runtime.readPlanets(),
    selectedPlanetKey,
    scratch
  );

  if (!target) {
    return false;
  }

  runtime.enqueueMoveUnits(
    selectedUnits.map((unit) => unit.handle),
    toVec3Data(target)
  );
  return true;
}

function getPointerMoveTarget(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null,
  scratch: RenderScratch
): THREE.Vector3 | null {
  const bounds = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
  const y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1);
  const context = getCurrentPlanetaryContext(planets, selectedPlanetKey);
  const tacticalPlane = scratch.tacticalPlane.set(
    scratch.tacticalPlaneNormal.set(0, 1, 0),
    -(context?.position.y ?? 0)
  );

  scratch.pointer.set(x, y);
  scratch.raycaster.setFromCamera(scratch.pointer, camera);
  return scratch.raycaster.ray.intersectPlane(tacticalPlane, scratch.rayTarget)
    ? scratch.rayTarget
    : null;
}

function findPlanetAtPointer(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  planets: readonly PlanetViewModel[],
  scratch: RenderScratch
): PlanetViewModel | null {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  const viewHeight = Math.max(camera.top - camera.bottom, 1);
  const pointerX = event.clientX - bounds.left;
  const pointerY = event.clientY - bounds.top;
  let bestPlanet: PlanetViewModel | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const planet of planets) {
    const projected = scratch.projected.copy(planet.position).project(camera);

    if (projected.z < -1 || projected.z > 1) {
      continue;
    }

    const screenX = (projected.x * 0.5 + 0.5) * bounds.width;
    const screenY = (-projected.y * 0.5 + 0.5) * bounds.height;
    const screenRadius = Math.max(
      (planet.radius * 1.08 * bounds.height) / viewHeight,
      PLANET_SELECTION_MIN_RADIUS_PX
    );
    const screenDistance = Math.hypot(pointerX - screenX, pointerY - screenY);

    if (screenDistance > screenRadius) {
      continue;
    }

    const score = screenDistance / screenRadius;

    if (score < bestScore) {
      bestPlanet = planet;
      bestScore = score;
    }
  }

  return bestPlanet;
}

function selectOwnedUnitsInBox(
  selectedUnitKeys: Set<string>,
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  scratch: RenderScratch
): void {
  const bounds = canvas.getBoundingClientRect();
  const minX = Math.min(startClientX, endClientX);
  const maxX = Math.max(startClientX, endClientX);
  const minY = Math.min(startClientY, endClientY);
  const maxY = Math.max(startClientY, endClientY);

  selectedUnitKeys.clear();

  for (const unit of units) {
    if (unit.owner !== playerId) {
      continue;
    }

    const projected = scratch.projected.copy(unit.position).project(camera);

    if (projected.z < -1 || projected.z > 1) {
      continue;
    }

    const clientX = bounds.left + (projected.x * 0.5 + 0.5) * bounds.width;
    const clientY = bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height;

    if (
      clientX >= minX &&
      clientX <= maxX &&
      clientY >= minY &&
      clientY <= maxY
    ) {
      selectedUnitKeys.add(unit.key);
    }
  }
}

function pruneSelectedPlanetKey(
  selectedPlanetKey: string | null,
  planets: readonly PlanetViewModel[]
): string | null {
  return selectedPlanetKey &&
    planets.some((planet) => planet.key === selectedPlanetKey)
    ? selectedPlanetKey
    : null;
}

function pruneSelectedUnitKeys(
  selectedUnitKeys: Set<string>,
  units: readonly UnitViewModel[]
): void {
  if (selectedUnitKeys.size === 0) {
    return;
  }

  for (const selectedKey of selectedUnitKeys) {
    let isLive = false;

    for (const unit of units) {
      if (unit.key === selectedKey) {
        isLive = true;
        break;
      }
    }

    if (!isLive) {
      selectedUnitKeys.delete(selectedKey);
    }
  }
}

function updatePlanetProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, PlanetProxy>,
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null,
  frameIndex: number,
  geometry: THREE.PlaneGeometry,
  material: THREE.ShaderMaterial
): void {
  for (const planet of planets) {
    let proxy = proxies.get(planet.key);

    if (!proxy) {
      proxy = createPlanetProxy(planet, geometry, material);
      proxies.set(planet.key, proxy);
      worldGroup.add(proxy.body);
    }

    proxy.lastSeenFrame = frameIndex;
    proxy.body.position.copy(planet.position);
    proxy.body.scale.setScalar(planet.radius * 2.12);
    proxy.body.material.uniforms.uPlanetColor.value.set(planet.color);
    proxy.body.material.uniforms.uHasAtmosphere.value = planet.hasAtmosphere ? 1 : 0;
    proxy.body.material.uniforms.uSelected.value =
      planet.key === selectedPlanetKey ? 1 : 0;
  }

  for (const [key, proxy] of proxies) {
    if (proxy.lastSeenFrame !== frameIndex) {
      worldGroup.remove(proxy.body);
      proxy.body.material.dispose();
      proxies.delete(key);
    }
  }
}

function createUnitBatchRenderer(): UnitBatchRenderer {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    map: createSelectionRingTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const root = new THREE.Group();
  root.name = "unit-batches";

  return {
    root,
    geometry,
    selectionMaterial,
    selectionMesh: null,
    selectionCapacity: 0,
    symbolMaterials: new Map(),
    symbolMeshes: new Map(),
    symbolCapacities: new Map(),
    symbolCounts: new Map(),
    matrix: new THREE.Matrix4(),
    billboardQuaternion: new THREE.Quaternion(),
    iconQuaternion: new THREE.Quaternion(),
    localRotation: new THREE.Quaternion(),
    instancePosition: new THREE.Vector3(),
    scale: new THREE.Vector3(),
  };
}

function updateUnitBatches(
  batches: UnitBatchRenderer,
  units: readonly UnitViewModel[],
  selectedUnitKeys: ReadonlySet<string>,
  camera: THREE.Camera,
  interpolationAlpha: number
): void {
  for (const key of batches.symbolCounts.keys()) {
    batches.symbolCounts.set(key, 0);
  }

  for (const unit of units) {
    const key = getUnitSymbolBatchKey(unit);
    batches.symbolCounts.set(key, (batches.symbolCounts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of batches.symbolCounts) {
    if (count > 0) {
      const unit = units.find((entry) => getUnitSymbolBatchKey(entry) === key);

      if (unit) {
        ensureSymbolMeshCapacity(batches, key, unit, count);
      }
    }
  }

  ensureSelectionMeshCapacity(batches, selectedUnitKeys.size);
  batches.billboardQuaternion.copy(camera.quaternion);

  for (const key of batches.symbolCounts.keys()) {
    batches.symbolCounts.set(key, 0);
  }

  let selectedCount = 0;

  for (const unit of units) {
    const key = getUnitSymbolBatchKey(unit);
    const symbolMesh = batches.symbolMeshes.get(key);
    const symbolIndex = batches.symbolCounts.get(key) ?? 0;

    if (!symbolMesh) {
      continue;
    }

    const position = batches.instancePosition.lerpVectors(
      unit.prevPosition,
      unit.position,
      interpolationAlpha
    );
    writeUnitInstanceMatrix(
      batches,
      position,
      UNIT_SYMBOL_SCALE,
      yawFromQuaternion(unit.rotation)
    );
    symbolMesh.setMatrixAt(symbolIndex, batches.matrix);
    batches.symbolCounts.set(key, symbolIndex + 1);

    if (selectedUnitKeys.has(unit.key) && batches.selectionMesh) {
      writeUnitInstanceMatrix(
        batches,
        position,
        SELECTION_RING_SCALE,
        0
      );
      batches.selectionMesh.setMatrixAt(selectedCount, batches.matrix);
      selectedCount += 1;
    }
  }

  for (const [key, mesh] of batches.symbolMeshes) {
    mesh.count = batches.symbolCounts.get(key) ?? 0;
    mesh.instanceMatrix.needsUpdate = mesh.count > 0;
  }

  if (batches.selectionMesh) {
    batches.selectionMesh.count = selectedCount;
    batches.selectionMesh.instanceMatrix.needsUpdate = selectedCount > 0;
  }
}

function ensureSymbolMeshCapacity(
  batches: UnitBatchRenderer,
  key: PlayerId,
  unit: UnitViewModel,
  requiredCount: number
): void {
  const capacity = batches.symbolCapacities.get(key) ?? 0;

  if (capacity >= requiredCount) {
    return;
  }

  const material = getUnitSymbolMaterial(batches, key, unit);
  const nextCapacity = nextInstanceCapacity(requiredCount);
  const previousMesh = batches.symbolMeshes.get(key);

  if (previousMesh) {
    batches.root.remove(previousMesh);
    previousMesh.dispose();
  }

  const mesh = new THREE.InstancedMesh(
    batches.geometry,
    material,
    nextCapacity
  );
  mesh.name = `${unit.ownerName} ${unit.label} symbol batch`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  batches.symbolMeshes.set(key, mesh);
  batches.symbolCapacities.set(key, nextCapacity);
  batches.root.add(mesh);
}

function ensureSelectionMeshCapacity(
  batches: UnitBatchRenderer,
  requiredCount: number
): void {
  if (batches.selectionCapacity >= requiredCount) {
    return;
  }

  const nextCapacity = nextInstanceCapacity(requiredCount);

  if (batches.selectionMesh) {
    batches.root.remove(batches.selectionMesh);
    batches.selectionMesh.dispose();
  }

  const mesh = new THREE.InstancedMesh(
    batches.geometry,
    batches.selectionMaterial,
    nextCapacity
  );
  mesh.name = "selected unit ring batch";
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  batches.selectionMesh = mesh;
  batches.selectionCapacity = nextCapacity;
  batches.root.add(mesh);
}

function getUnitSymbolMaterial(
  batches: UnitBatchRenderer,
  key: PlayerId,
  unit: UnitViewModel
): THREE.MeshBasicMaterial {
  let material = batches.symbolMaterials.get(key);

  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: createUnitSymbolTexture(unit.color, unit.owner),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    batches.symbolMaterials.set(key, material);
  }

  return material;
}

function writeUnitInstanceMatrix(
  batches: UnitBatchRenderer,
  position: THREE.Vector3,
  scale: number,
  screenRotation: number
): void {
  batches.localRotation.setFromAxisAngle(Z_AXIS, screenRotation);
  batches.iconQuaternion
    .copy(batches.billboardQuaternion)
    .multiply(batches.localRotation);
  batches.scale.set(scale, scale, 1);
  batches.matrix.compose(position, batches.iconQuaternion, batches.scale);
}

function getUnitSymbolBatchKey(unit: UnitViewModel): PlayerId {
  return unit.owner;
}

function nextInstanceCapacity(requiredCount: number): number {
  let capacity = INITIAL_INSTANCE_CAPACITY;

  while (capacity < requiredCount) {
    capacity *= 2;
  }

  return capacity;
}

function disposeUnitBatchRenderer(batches: UnitBatchRenderer): void {
  for (const mesh of batches.symbolMeshes.values()) {
    batches.root.remove(mesh);
    mesh.dispose();
  }

  if (batches.selectionMesh) {
    batches.root.remove(batches.selectionMesh);
    batches.selectionMesh.dispose();
    batches.selectionMesh = null;
  }

  for (const material of batches.symbolMaterials.values()) {
    material.map?.dispose();
    material.dispose();
  }

  batches.selectionMaterial.map?.dispose();
  batches.selectionMaterial.dispose();
  batches.geometry.dispose();
  batches.symbolMeshes.clear();
  batches.symbolMaterials.clear();
  batches.symbolCapacities.clear();
  batches.symbolCounts.clear();
}

function disposePlanetProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, PlanetProxy>
): void {
  for (const proxy of proxies.values()) {
    worldGroup.remove(proxy.body);
    proxy.body.material.dispose();
  }

  proxies.clear();
}

function createPlanetProxy(
  planet: PlanetViewModel,
  geometry: THREE.PlaneGeometry,
  material: THREE.ShaderMaterial
): PlanetProxy {
  const planetMaterial = material.clone();
  planetMaterial.uniforms.uPlanetColor.value.set(planet.color);
  planetMaterial.uniforms.uHasAtmosphere.value = planet.hasAtmosphere ? 1 : 0;
  planetMaterial.uniforms.uSelected.value = 0;
  const body = new THREE.Mesh(
    geometry,
    planetMaterial
  );
  body.name = `${planet.label} shaded billboard planet`;
  body.position.copy(planet.position);
  body.scale.setScalar(planet.radius * 2.12);
  body.renderOrder = -5;

  return {
    body,
    lastSeenFrame: 0,
  };
}

function writeSunDirection(
  target: THREE.Vector3,
  config: MatchConfig
): THREE.Vector3 {
  const { position } = config.environment.sun;
  target.set(position.x, position.y, position.z);

  if (target.lengthSq() <= 0.000001) {
    return target.copy(DEFAULT_SUN_DIRECTION);
  }

  return target.normalize();
}

function writeSunColor(target: THREE.Color, config: MatchConfig): THREE.Color {
  return target.set(config.environment.sun.color);
}

function readSunDistance(sun: SunConfig): number {
  return Math.max(sun.distance, 1);
}

function createLighting(
  sunDirection: THREE.Vector3,
  sunColor: THREE.Color
): LightingRig {
  const group = new THREE.Group();

  const sunLight = new THREE.DirectionalLight(sunColor, 1.65);
  sunLight.position.copy(sunDirection).multiplyScalar(1000);
  group.add(sunLight);
  group.add(sunLight.target);
  group.add(new THREE.AmbientLight(0xdbe7ff, 0.42));

  return {
    group,
    sunLight,
  };
}

function updateLighting(
  lighting: LightingRig,
  sunDirection: THREE.Vector3,
  sunColor: THREE.Color
): void {
  lighting.sunLight.color.copy(sunColor);
  lighting.sunLight.position.copy(sunDirection).multiplyScalar(1000);
}

function createTacticalPlane(): TacticalGrid {
  const grid = new THREE.GridHelper(180, 36, 0x293044, 0x151b29);
  grid.name = "selected-planet-tactical-grid";
  grid.renderOrder = 2;
  return grid;
}

function updateTacticalGrid(
  grid: TacticalGrid,
  context: PlanetViewModel | null
): void {
  grid.visible = !!context;

  if (!context) {
    return;
  }

  const scale = Math.max(context.radius * 0.016, 0.8);

  grid.position.set(
    context.position.x,
    context.position.y + 0.55,
    context.position.z
  );
  grid.scale.setScalar(scale);
}

function createGravityOverlay(): GravityOverlay {
  const root = new THREE.Group();
  root.name = "planet-gravity-vector-field";
  const sampleCount = GRAVITY_OVERLAY_GRID_SIZE ** 2;
  const vertexCount = sampleCount * GRAVITY_OVERLAY_VERTICES_PER_VECTOR;
  const positions = new Float32Array(vertexCount * 3);
  const alphas = new Float32Array(vertexCount);
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x83f7ff) },
    },
    vertexShader: GRAVITY_VECTOR_VERTEX_SHADER,
    fragmentShader: GRAVITY_VECTOR_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute(
    "aAlpha",
    new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage)
  );
  lines.name = "gravity vector field lines";
  lines.frustumCulled = false;
  lines.renderOrder = 8;
  root.add(lines);
  root.visible = true;

  return {
    root,
    geometry,
    material,
    positions,
    alphas,
    lines,
    sample: new THREE.Vector3(),
    gravityVector: new THREE.Vector3(),
    gravityResult: { x: 0, y: 0, z: 0 },
    end: new THREE.Vector3(),
    headBase: new THREE.Vector3(),
    side: new THREE.Vector3(),
    headLeft: new THREE.Vector3(),
    headRight: new THREE.Vector3(),
    enabled: true,
  };
}

function updateGravityOverlay(
  overlay: GravityOverlay,
  context: PlanetViewModel | null,
  planets: readonly PlanetViewModel[]
): void {
  overlay.root.visible = overlay.enabled && !!context && planets.length > 0;

  if (!overlay.root.visible || !context) {
    clearGravityOverlay(overlay);
    return;
  }

  const halfGrid = (GRAVITY_OVERLAY_GRID_SIZE - 1) / 2;
  const spacing = Math.max(context.radius * 0.56, 9);
  let arrowIndex = 0;

  for (let zIndex = 0; zIndex < GRAVITY_OVERLAY_GRID_SIZE; zIndex += 1) {
    for (let xIndex = 0; xIndex < GRAVITY_OVERLAY_GRID_SIZE; xIndex += 1) {
      const vectorIndex = arrowIndex;
      arrowIndex += 1;
      const x = (xIndex - halfGrid) * spacing;
      const z = (zIndex - halfGrid) * spacing;
      const sample = overlay.sample.set(
        context.position.x + x,
        context.position.y + 0.55,
        context.position.z + z
      );
      const surfaceDistance = sample.distanceTo(context.position);

      if (surfaceDistance < context.radius * 1.08) {
        writeGravityVectorAlpha(overlay, vectorIndex, 0);
        continue;
      }

      const gravity = computePlanetGravityVector(
        sample,
        planets,
        overlay.gravityResult
      );
      const gravityVector = overlay.gravityVector.set(
        gravity.x,
        gravity.y,
        gravity.z
      );
      const strength = gravityVector.length();
      const normalizedStrength = clamp(
        strength / PLANET_GRAVITY_MAX_STRENGTH,
        0,
        1
      );

      if (normalizedStrength < GRAVITY_OVERLAY_MIN_STRENGTH) {
        writeGravityVectorAlpha(overlay, vectorIndex, 0);
        continue;
      }

      const opacity = 0.06 + smoothstep(0.02, 0.75, normalizedStrength) * 0.64;
      const length = 2.6 + normalizedStrength * 9.4;
      const headLength = Math.min(length * 0.35, 2.2);

      writeGravityVector(
        overlay,
        vectorIndex,
        sample,
        gravityVector.normalize(),
        length,
        headLength,
        opacity
      );
    }
  }

  overlay.geometry.attributes.position.needsUpdate = true;
  overlay.geometry.attributes.aAlpha.needsUpdate = true;
}

function disposeGravityOverlay(overlay: GravityOverlay): void {
  overlay.geometry.dispose();
  overlay.material.dispose();
  overlay.root.clear();
}

function clearGravityOverlay(overlay: GravityOverlay): void {
  overlay.alphas.fill(0);
  overlay.geometry.attributes.aAlpha.needsUpdate = true;
}

function writeGravityVector(
  overlay: GravityOverlay,
  vectorIndex: number,
  sample: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  headLength: number,
  opacity: number
): void {
  const end = overlay.end.copy(sample).addScaledVector(direction, length);
  const headBase = overlay.headBase
    .copy(end)
    .addScaledVector(direction, -headLength);
  const side = overlay.side.set(-direction.z, 0, direction.x);

  if (side.lengthSq() < 0.000001) {
    side.set(1, 0, 0);
  } else {
    side.normalize();
  }

  const headWidth = headLength * 0.54;
  const headLeft = overlay.headLeft.copy(headBase).addScaledVector(side, headWidth);
  const headRight = overlay.headRight
    .copy(headBase)
    .addScaledVector(side, -headWidth);
  const firstVertex = vectorIndex * GRAVITY_OVERLAY_VERTICES_PER_VECTOR;

  writeGravityVertex(overlay, firstVertex, sample, opacity);
  writeGravityVertex(overlay, firstVertex + 1, end, opacity);
  writeGravityVertex(overlay, firstVertex + 2, end, opacity);
  writeGravityVertex(overlay, firstVertex + 3, headLeft, opacity);
  writeGravityVertex(overlay, firstVertex + 4, end, opacity);
  writeGravityVertex(overlay, firstVertex + 5, headRight, opacity);
}

function writeGravityVertex(
  overlay: GravityOverlay,
  vertexIndex: number,
  position: THREE.Vector3,
  opacity: number
): void {
  const positionIndex = vertexIndex * 3;

  overlay.positions[positionIndex] = position.x;
  overlay.positions[positionIndex + 1] = position.y;
  overlay.positions[positionIndex + 2] = position.z;
  overlay.alphas[vertexIndex] = opacity;
}

function writeGravityVectorAlpha(
  overlay: GravityOverlay,
  vectorIndex: number,
  opacity: number
): void {
  const firstVertex = vectorIndex * GRAVITY_OVERLAY_VERTICES_PER_VECTOR;

  for (
    let offset = 0;
    offset < GRAVITY_OVERLAY_VERTICES_PER_VECTOR;
    offset += 1
  ) {
    overlay.alphas[firstVertex + offset] = opacity;
  }
}

function createNebulaSkyDome(): SkyDome {
  const geometry = new THREE.SphereGeometry(4500, 64, 32);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: SKY_DOME_VERTEX_SHADER,
    fragmentShader: NEBULA_BACKGROUND_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "procedural nebula sky dome";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 50000);
  scene.add(mesh);

  return {
    scene,
    camera,
    material,
    geometry,
    mesh,
  };
}

function createSunFlarePass(): FullscreenPass {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSunPosition: { value: new THREE.Vector2(0.5, 0.5) },
      uSunColor: { value: DEFAULT_SUN_COLOR.clone() },
      uVisibility: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: SUN_FLARE_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(mesh);

  return {
    scene,
    camera,
    material,
    geometry,
  };
}

function createPlanetBillboardMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: DEFAULT_SUN_DIRECTION.clone() },
      uSunColor: { value: DEFAULT_SUN_COLOR.clone() },
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uHasAtmosphere: { value: 1 },
      uSelected: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: PLANET_BILLBOARD_VERTEX_SHADER,
    fragmentShader: PLANET_BILLBOARD_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function updateNebulaSkyDome(
  skyDome: SkyDome,
  elapsedSeconds: number,
  camera: THREE.Camera,
  resolution: THREE.Vector2
): void {
  skyDome.camera.quaternion.copy(camera.quaternion);
  skyDome.camera.aspect = resolution.x / Math.max(resolution.y, 1);
  skyDome.camera.updateProjectionMatrix();
  skyDome.material.uniforms.uTime.value = elapsedSeconds;
}

function updateSunFlarePass(
  pass: FullscreenPass,
  camera: THREE.Camera,
  focus: THREE.Vector3,
  planets: readonly PlanetViewModel[],
  sunDirection: THREE.Vector3,
  sunDistance: number,
  sunColor: THREE.Color,
  resolution: THREE.Vector2,
  elapsedSeconds: number,
  scratch: RenderScratch
): THREE.Vector4 {
  const projectedSun = scratch.sunPosition
    .copy(focus)
    .addScaledVector(sunDirection, sunDistance)
    .project(camera);
  camera.getWorldDirection(scratch.cameraDirection);
  const visibility =
    projectedSun.z >= -1 && projectedSun.z <= 1
      ? clamp(scratch.cameraDirection.dot(sunDirection), 0, 1)
      : 0;
  const screenPosition = scratch.screenPosition.set(
    0.5 + projectedSun.x * 0.5,
    0.5 + projectedSun.y * 0.5
  );
  const screenDistance = Math.max(
    Math.abs(screenPosition.x - 0.5),
    Math.abs(screenPosition.y - 0.5)
  );
  const screenFade = 1 - smoothstep(0.58, 0.82, screenDistance);
  const occlusion = computeSunPlanetOcclusion(
    camera,
    screenPosition,
    planets,
    scratch
  );
  const visibleSun = visibility * screenFade * (1 - occlusion);

  pass.material.uniforms.uResolution.value.copy(resolution);
  pass.material.uniforms.uSunPosition.value.copy(screenPosition);
  pass.material.uniforms.uSunColor.value.copy(sunColor);
  pass.material.uniforms.uVisibility.value = visibleSun;
  pass.material.uniforms.uTime.value = elapsedSeconds;

  return scratch.sunScreenPosition.set(
    screenPosition.x,
    screenPosition.y,
    visibleSun,
    occlusion
  );
}

function computeSunPlanetOcclusion(
  camera: THREE.Camera,
  sunScreenPosition: THREE.Vector2,
  planets: readonly PlanetViewModel[],
  scratch: RenderScratch
): number {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return 0;
  }

  const viewHeight = camera.top - camera.bottom;
  const viewWidth = camera.right - camera.left;
  let occlusion = 0;

  for (const planet of planets) {
    const projectedPlanet = scratch.projected.copy(planet.position).project(camera);

    if (projectedPlanet.z < -1 || projectedPlanet.z > 1) {
      continue;
    }

    const planetScreenX = 0.5 + projectedPlanet.x * 0.5;
    const planetScreenY = 0.5 + projectedPlanet.y * 0.5;
    const occlusionRadius = planet.radius * 1.03;
    const radiusX = occlusionRadius / viewWidth;
    const radiusY = occlusionRadius / viewHeight;
    const normalizedDistance = Math.hypot(
      (sunScreenPosition.x - planetScreenX) / radiusX,
      (sunScreenPosition.y - planetScreenY) / radiusY
    );
    occlusion = Math.max(
      occlusion,
      1 - smoothstep(0.94, 1.08, normalizedDistance)
    );
  }

  return clamp(occlusion, 0, 1);
}

function updatePlanetBillboards(
  proxies: Map<string, PlanetProxy>,
  camera: THREE.Camera,
  elapsedSeconds: number,
  sunDirection: THREE.Vector3,
  scratch: RenderScratch
): void {
  const sunViewDirection = scratch.sunViewDirection
    .copy(sunDirection)
    .transformDirection(camera.matrixWorldInverse)
    .normalize();

  for (const proxy of proxies.values()) {
    proxy.body.quaternion.copy(camera.quaternion);
    proxy.body.material.uniforms.uSunDirection.value.copy(sunViewDirection);
    proxy.body.material.uniforms.uTime.value = elapsedSeconds;
  }
}

function disposeSkyDome(skyDome: SkyDome): void {
  skyDome.geometry.dispose();
  skyDome.material.dispose();
}

function disposeFullscreenPass(pass: FullscreenPass): void {
  pass.geometry.dispose();
  pass.material.dispose();
}

function createUnitSymbolTexture(colorValue: string, owner: PlayerId): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create unit symbol canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(4, 8, 16, 0.76)";
  context.fillRect(20, 20, 88, 88);

  context.strokeStyle = colorValue;
  context.lineWidth = 8;
  context.strokeRect(20, 20, 88, 88);

  context.fillStyle = colorValue;
  context.beginPath();

  if (owner === 1) {
    context.moveTo(64, 32);
    context.lineTo(92, 92);
    context.lineTo(64, 80);
    context.lineTo(36, 92);
  } else {
    context.moveTo(64, 30);
    context.lineTo(96, 64);
    context.lineTo(64, 98);
    context.lineTo(32, 64);
  }

  context.closePath();
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSelectionRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create selection ring canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 224, 76, 0.98)";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(64, 64, 48, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "rgba(255, 247, 174, 0.45)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStatsLayer(container: HTMLElement): HTMLElement {
  const statsLayer = document.createElement("div");
  statsLayer.className = "game-stats";
  container.appendChild(statsLayer);
  return statsLayer;
}

function updateStatsLayer(
  statsLayer: HTMLElement,
  runtime: LocalGameRuntime,
  estimatedFps: number,
  observedSimHz: number,
  estimatedRenderMs: number,
  drawCalls: number,
  pixelRatio: number,
  selectedPlanetLabel: string,
  selectedUnitCount: number
): void {
  statsLayer.textContent = `Planet ${selectedPlanetLabel} / Units ${runtime.world.units.length} / Selected ${selectedUnitCount} / Tick ${runtime.world.tick
    .toString()
    .padStart(5, "0")} / ${estimatedFps.toFixed(0)} fps / ${observedSimHz.toFixed(1)} sim / ${drawCalls} calls / ${estimatedRenderMs.toFixed(2)} ms / ${pixelRatio.toFixed(2)}x / Hash ${runtime.readHash()}`;
}

function createCameraPresetControls(
  container: HTMLElement,
  onSelect: (preset: CameraPreset) => void
): CameraPresetControls {
  const root = document.createElement("div");
  root.className = "camera-presets";
  root.setAttribute("aria-label", "Camera views");
  const buttons = {} as Record<CameraPreset, HTMLButtonElement>;

  for (const preset of Object.keys(CAMERA_PRESETS) as CameraPreset[]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-preset-button";
    button.textContent = CAMERA_PRESETS[preset].label;
    button.dataset.cameraPreset = preset;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(preset);
      updateCameraPresetControls({ root, buttons }, preset);
    });
    buttons[preset] = button;
    root.appendChild(button);
  }

  container.appendChild(root);
  updateCameraPresetControls({ root, buttons }, "isometric");
  return { root, buttons };
}

function updateCameraPresetControls(
  controls: CameraPresetControls,
  activePreset: CameraPreset | null
): void {
  for (const preset of Object.keys(controls.buttons) as CameraPreset[]) {
    const isActive = preset === activePreset;
    controls.buttons[preset].setAttribute("aria-pressed", String(isActive));
    controls.buttons[preset].classList.toggle("is-active", isActive);
  }
}

function createGravityOverlayControls(
  container: HTMLElement,
  onChange: (enabled: boolean) => void
): GravityOverlayControls {
  const root = document.createElement("label");
  root.className = "gravity-toggle";
  const input = document.createElement("input");
  const label = document.createElement("span");

  input.type = "checkbox";
  input.checked = true;
  input.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  label.textContent = "Gravity";
  root.append(input, label);
  container.appendChild(root);

  return {
    root,
    input,
  };
}

function setGravityOverlayEnabled(
  overlay: GravityOverlay,
  controls: GravityOverlayControls,
  enabled: boolean
): void {
  overlay.enabled = enabled;
  overlay.root.visible = enabled;
  controls.input.checked = enabled;
}

function createSelectionBox(container: HTMLElement): HTMLElement {
  const selectionBox = document.createElement("div");
  selectionBox.className = "selection-box";
  selectionBox.hidden = true;
  container.appendChild(selectionBox);
  return selectionBox;
}

function updateSelectionBox(
  selectionBox: HTMLElement,
  container: HTMLElement,
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number
): void {
  const bounds = container.getBoundingClientRect();
  const left = Math.min(startClientX, endClientX) - bounds.left;
  const top = Math.min(startClientY, endClientY) - bounds.top;
  const width = Math.abs(endClientX - startClientX);
  const height = Math.abs(endClientY - startClientY);

  selectionBox.hidden = false;
  selectionBox.style.transform = `translate(${left}px, ${top}px)`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

function hideSelectionBox(selectionBox: HTMLElement): void {
  selectionBox.hidden = true;
  selectionBox.style.width = "0";
  selectionBox.style.height = "0";
}

function toVector3(vector: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

function toVec3Data(vector: THREE.Vector3): Vec3Data {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function toQuaternion(quaternion: {
  x: number;
  y: number;
  z: number;
  w: number;
}): THREE.Quaternion {
  return new THREE.Quaternion(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  );
}

function yawFromQuaternion(quaternion: THREE.Quaternion): number {
  return Math.atan2(
    2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z)
  );
}

const FULLSCREEN_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GRAVITY_VECTOR_VERTEX_SHADER = `
attribute float aAlpha;

varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRAVITY_VECTOR_FRAGMENT_SHADER = `
uniform vec3 uColor;

varying float vAlpha;

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(uColor, vAlpha);
}
`;

const SKY_DOME_VERTEX_SHADER = `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NEBULA_BACKGROUND_FRAGMENT_SHADER = `
#define OCTAVES 3

uniform float uTime;

varying vec3 vDirection;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec2 rand2(vec2 p) {
  p = vec2(
    dot(p, vec2(12.9898, 78.233)),
    dot(p, vec2(26.65125, 83.054543))
  );
  return fract(sin(p) * 43758.5453);
}

float rand(vec2 p) {
  return fract(sin(dot(p.xy, vec2(54.90898, 18.233))) * 4337.5453);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float stars(vec2 x, float numCells, float size, float br) {
  vec2 n = x * numCells;
  vec2 f = floor(n);
  float d = 1.0e10;

  for (int i = -1; i <= 1; ++i) {
    for (int j = -1; j <= 1; ++j) {
      vec2 g = f + vec2(float(i), float(j));
      g = n - g - rand2(mod(g, numCells)) + rand(g);
      g *= 1.0 / (numCells * size);
      d = min(d, dot(g, g));
    }
  }

  return br * smoothstep(0.95, 1.0, 1.0 - sqrt(d));
}

float fractalNoise(vec2 coord, float persistence, float lacunarity) {
  float n = 0.0;
  float frequency = 1.0;
  float amplitude = 1.0;

  for (int octave = 0; octave < OCTAVES; ++octave) {
    n += amplitude * snoise(coord * frequency);
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return n;
}

vec3 fractalNebula(vec2 coord, vec3 color, float transparency) {
  float n = fractalNoise(coord, 0.5, 2.0);
  n = smoothstep(-0.18, 0.92, n);
  return n * color * transparency;
}

vec3 sampleSkyPlane(vec2 coord, vec2 drift, vec2 offset) {
  vec3 nebulaColor1 = hsv2rgb(vec3(0.54 + 0.03 * sin(uTime * 0.06), 0.48, 0.16));
  vec3 nebulaColor2 = hsv2rgb(vec3(0.70 + 0.02 * sin(uTime * 0.09), 0.62, 0.12));
  vec2 p = coord * 1.85 + offset;
  vec3 result = vec3(0.004, 0.006, 0.016);

  result += fractalNebula(p * 0.72 + vec2(0.12, 0.08) + drift, nebulaColor1, 0.24);
  result += fractalNebula(p * 1.12 + vec2(-0.18, 0.22) - drift, nebulaColor2, 0.15);
  result += stars(p + drift * 0.4, 7.0, 0.060, 1.0) * vec3(0.62, 0.66, 0.78);
  result += stars(p - drift * 0.3, 16.0, 0.030, 0.76) * vec3(0.90, 0.70, 0.82);
  result += stars(p * 1.25, 36.0, 0.014, 0.52) * vec3(0.88, 0.90, 0.98);

  return result;
}

vec3 triplanarWeights(vec3 direction) {
  vec3 weights = pow(abs(direction), vec3(3.0));
  return weights / max(weights.x + weights.y + weights.z, 0.0001);
}

void main() {
  vec3 skyDirection = normalize(vDirection);
  vec3 weights = triplanarWeights(skyDirection);
  vec2 slowDrift = vec2(uTime * 0.002, -uTime * 0.0014);
  vec3 result =
    sampleSkyPlane(skyDirection.yz, slowDrift, vec2(0.00, 0.17)) * weights.x +
    sampleSkyPlane(skyDirection.zx, slowDrift, vec2(0.31, 0.02)) * weights.y +
    sampleSkyPlane(skyDirection.xy, slowDrift, vec2(-0.16, 0.29)) * weights.z;

  gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;

const SUN_FLARE_FRAGMENT_SHADER = `
uniform vec2 uResolution;
uniform vec2 uSunPosition;
uniform vec3 uSunColor;
uniform float uVisibility;
uniform float uTime;

float getSun(vec2 uv) {
  return smoothstep(0.014, 0.0, length(uv));
}

vec3 lensflares(vec2 uv, vec2 pos, out vec3 sunflare, out vec3 lensflare) {
  vec2 main = uv - pos;
  vec2 uvd = uv * length(uv);
  float ang = atan(main.y, main.x);
  float dist = pow(length(main), 0.1);
  float f0 = 1.0 / (length(uv - pos) * 25.0 + 1.0);
  f0 = pow(f0, 2.0);
  f0 = f0 + f0 * (sin((ang + 1.0 / 18.0) * 12.0) * 0.1 + dist * 0.1 + 0.8);

  float f2 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.8 * pos), 2.0)), 0.0) * 0.25;
  float f22 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.85 * pos), 2.0)), 0.0) * 0.23;
  float f23 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.9 * pos), 2.0)), 0.0) * 0.21;
  vec2 uvx = mix(uv, uvd, -0.5);
  float f4 = max(0.01 - pow(length(uvx + 0.4 * pos), 2.4), 0.0) * 6.0;
  float f42 = max(0.01 - pow(length(uvx + 0.45 * pos), 2.4), 0.0) * 5.0;
  float f43 = max(0.01 - pow(length(uvx + 0.5 * pos), 2.4), 0.0) * 3.0;
  uvx = mix(uv, uvd, -0.4);
  float f5 = max(0.01 - pow(length(uvx + 0.2 * pos), 5.5), 0.0) * 2.0;
  float f52 = max(0.01 - pow(length(uvx + 0.4 * pos), 5.5), 0.0) * 2.0;
  float f53 = max(0.01 - pow(length(uvx + 0.6 * pos), 5.5), 0.0) * 2.0;
  uvx = mix(uv, uvd, -0.5);
  float f6 = max(0.01 - pow(length(uvx - 0.3 * pos), 1.6), 0.0) * 6.0;
  float f62 = max(0.01 - pow(length(uvx - 0.325 * pos), 1.6), 0.0) * 3.0;
  float f63 = max(0.01 - pow(length(uvx - 0.35 * pos), 1.6), 0.0) * 5.0;

  sunflare = vec3(f0);
  lensflare = vec3(f2 + f4 + f5 + f6, f22 + f42 + f52 + f62, f23 + f43 + f53 + f63);
  return sunflare + lensflare;
}

vec3 anamorphicFlare(vec2 uv, float intensity, float stretch, float brightness) {
  uv.x *= 1.0 / (intensity * stretch);
  uv.y *= 0.5;
  return vec3(smoothstep(0.009, 0.0, length(uv))) * brightness;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy - 0.5;
  vec2 sun = uSunPosition - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv.x *= aspect;
  sun.x *= aspect;

  vec3 sunflare = vec3(0.0);
  vec3 lensflare = vec3(0.0);
  vec3 flare = lensflares(uv * 1.5, sun * 1.5, sunflare, lensflare);
  vec3 anflare = pow(anamorphicFlare(uv - sun, 0.5, 400.0, 0.09), vec3(4.0));
  vec3 core = vec3(getSun(uv - sun));
  vec3 color = core * 1.55 + (flare + anflare) * uSunColor * 1.85;
  color *= smoothstep(0.0, 0.2, uVisibility);
  color = 1.0 - exp(-color * 1.15);
  color = pow(color, vec3(1.0 / 2.2));

  float alpha = clamp(max(max(color.r, color.g), color.b), 0.0, 0.72);
  gl_FragColor = vec4(color, alpha);
}
`;

const PLANET_BILLBOARD_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PLANET_BILLBOARD_FRAGMENT_SHADER = `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uPlanetColor;
uniform float uHasAtmosphere;
uniform float uSelected;
uniform float uTime;

varying vec2 vUv;

const float PI = 3.14159265359;
const vec3 betaR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const vec3 betaM = vec3(21e-6);
const float g = 0.76;

float rayleighPhase(float mu) {
  return 3.0 * (1.0 + mu * mu) / (16.0 * PI);
}

float henyeyGreensteinPhase(float mu) {
  return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
}

void main() {
  vec2 centered = vUv * 2.0 - 1.0;
  float radius = length(centered);
  const float solidRadius = 0.925;
  float atmosphereRadius = mix(solidRadius, 0.968, uHasAtmosphere);

  if (radius > atmosphereRadius) {
    discard;
  }

  vec2 spherePoint = centered / solidRadius;
  float sphereRadius = length(spherePoint);
  float visibleHemisphere = sqrt(max(1.0 - sphereRadius * sphereRadius, 0.0));
  vec3 normal = normalize(vec3(spherePoint, visibleHemisphere));
  vec3 sunDirection = normalize(uSunDirection);
  float mu = dot(normal, sunDirection);
  float sunSide = smoothstep(-0.28, 0.82, mu);
  float solidMask = 1.0 - smoothstep(solidRadius - 0.004, solidRadius + 0.004, radius);
  float surfaceHaze = smoothstep(solidRadius * 0.58, solidRadius + 0.006, radius);
  float shell = smoothstep(solidRadius - 0.032, solidRadius + 0.004, radius) *
    (1.0 - smoothstep(atmosphereRadius - 0.012, atmosphereRadius, radius));
  float interiorColumn = solidMask * (0.56 + 0.44 * surfaceHaze);
  float innerAir = interiorColumn * (0.34 + 0.48 * sunSide);
  float horizonColumn = pow(max(shell, 0.0), 1.18);
  float phaseR = rayleighPhase(mu);
  float phaseM = henyeyGreensteinPhase(mu);
  vec3 scatter =
    betaR * phaseR * vec3(0.72, 1.08, 1.85) * 210000.0 +
    betaM * phaseM * vec3(1.16, 0.92, 0.74) * 52000.0;
  vec3 forwardSun = uSunColor * pow(max(mu, 0.0), 18.0) * 0.82;
  vec3 lowColor = uPlanetColor * 0.58;
  vec3 highColor = mix(uPlanetColor * 1.24, vec3(0.72), 0.18);
  vec3 earth = mix(uPlanetColor * 0.68, vec3(0.34, 0.25, 0.16), 0.16);
  float continent = smoothstep(
    -0.24,
    0.58,
    sin(centered.x * 7.4 + centered.y * 2.2) +
      0.5 * sin(centered.y * 8.6 - centered.x * 3.1)
  );
  vec3 surface = mix(lowColor, highColor, continent * 0.26);
  surface = mix(surface, earth, continent * smoothstep(-0.15, 0.65, centered.y) * 0.08);
  float limbShade = 1.0 - smoothstep(0.24, solidRadius, radius) * 0.34;
  float lightShade = 0.36 + 0.62 * sunSide;
  vec3 planetColor = surface * limbShade * lightShade;
  planetColor += vec3(0.10, 0.19, 0.36) * (1.0 - sunSide) * 0.42;

  vec3 atmosphereTint = mix(vec3(0.14, 0.34, 0.95), uPlanetColor * 1.18, 0.42);
  vec3 atmosphericVeil = scatter * innerAir * vec3(0.72, 0.88, 1.25) * uHasAtmosphere;
  atmosphericVeil += atmosphereTint * innerAir * (0.55 + 0.45 * sunSide) * uHasAtmosphere;
  vec3 atmosphereColor = (scatter * (0.34 + sunSide * 1.72) + forwardSun) * horizonColumn;
  atmosphereColor += atmosphereTint * horizonColumn * (0.35 + 0.65 * sunSide) * uHasAtmosphere;
  atmosphereColor += atmosphericVeil;
  vec3 color = mix(planetColor * solidMask, planetColor * solidMask * 0.38 + atmosphereColor, uHasAtmosphere);
  float selectedRing = uSelected *
    smoothstep(solidRadius + 0.012, solidRadius + 0.022, radius) *
    (1.0 - smoothstep(atmosphereRadius - 0.014, atmosphereRadius, radius));
  color = mix(color, vec3(1.0, 0.84, 0.22), selectedRing);

  float atmosphereAlpha = clamp(shell * (0.14 + sunSide * 0.36) + innerAir, 0.0, 0.42);
  float alpha = max(max(solidMask, atmosphereAlpha * uHasAtmosphere), selectedRing);
  gl_FragColor = vec4(color, alpha);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
