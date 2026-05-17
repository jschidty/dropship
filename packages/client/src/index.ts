import * as THREE from "three";
import {
  DEFAULT_CONTENT_REGISTRY,
  createMinimalSkirmishConfig,
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
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  SIM_DT_MS,
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
}>;

export type PlanetViewModel = Readonly<{
  key: string;
  label: string;
  position: THREE.Vector3;
  mass: number;
  radius: number;
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
}>;

type UnitProxy = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  selectionRing: THREE.Sprite;
  selectionMaterial: THREE.SpriteMaterial;
};

type PlanetProxy = {
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
};

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
  yaw: number;
  pitch: number;
  viewHeights: Record<CameraMode, number>;
  isDragging: boolean;
  pointerId: number | null;
  lastPointerX: number;
  lastPointerY: number;
  dragDistancePx: number;
};

const DEFAULT_LOCAL_PLAYER_ID = 1 satisfies PlayerId;
const SUN_DIRECTION = new THREE.Vector3(-0.252, -0.827, -0.502).normalize();
const SUN_COLOR = new THREE.Color().setRGB(0.643, 0.494, 0.867);
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

export function createMinimalLocalGame(
  playerId: PlayerId = DEFAULT_LOCAL_PLAYER_ID
): LocalGameRuntime {
  const config = createMinimalSkirmishConfig();
  const world = createWorld({
    config,
    content: DEFAULT_CONTENT_REGISTRY,
  });
  const pendingCommands: ScheduledCommand[] = [];
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
      return readUnitViewModels(world);
    },
    readPlanets() {
      return readPlanetViewModels(world);
    },
    readHash() {
      return hashWorld(world);
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
}): LocalGameRuntime {
  let world = createWorld({
    config: createMinimalSkirmishConfig(),
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
            hash: hashWorld(world),
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
      return readUnitViewModels(world);
    },
    readPlanets() {
      return readPlanetViewModels(world);
    },
    readHash() {
      return hashWorld(world);
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
    const url = createMatchWebSocketUrl(options.matchId, options.playerId, options.serverUrl);
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
  serverUrl?: string
): string {
  const base =
    serverUrl ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
      window.location.host
    }`;
  const url = new URL(`/api/matches/${encodeURIComponent(matchId)}/ws`, base);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.searchParams.set("player", playerId.toString());
  return url.toString();
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
    };
  });
}

export function readPlanetViewModels(world: SimWorld): readonly PlanetViewModel[] {
  return world.planets.map((planet) => {
    const template = world.content.getPlanetTemplate(planet.templateId);

    return {
      key: handleKey(planet.handle),
      label: template.displayName,
      position: toVector3(planet.position),
      mass: planet.mass,
      radius: planet.radius,
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
        })
      : createMinimalLocalGame(playerId);
  const scene = new THREE.Scene();
  const nebulaSkyDome = createNebulaSkyDome();
  const sunFlarePass = createSunFlarePass();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  const cameraControls: CameraControls = {
    mode: "strategic",
    yaw: 0.55,
    pitch: CAMERA_MODES.strategic.pitch,
    viewHeights: {
      tactical: CAMERA_MODES.tactical.defaultViewHeight,
      strategic: CAMERA_MODES.strategic.defaultViewHeight,
    },
    isDragging: false,
    pointerId: null,
    lastPointerX: 0,
    lastPointerY: 0,
    dragDistancePx: 0,
  };

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.setClearColor(0x01020a, 1);
  renderer.domElement.className = "game-canvas";
  container.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  worldGroup.name = "sim-world";
  scene.add(worldGroup);

  const proxies = new Map<string, UnitProxy>();
  const planetProxies = new Map<string, PlanetProxy>();
  const selectedUnitKeys = new Set<string>();
  const hud = createHud(container);
  const renderResolution = new THREE.Vector2();

  scene.add(createLighting(SUN_DIRECTION));
  scene.add(createTacticalPlane());

  const startedAt = performance.now();
  let frameId = 0;
  let disposed = false;
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

      renderCurrentFrame();
      return;
    }

    if (key === "2") {
      setCameraMode(cameraControls, "strategic");
      applyCameraControls(
        camera,
        cameraControls,
        container,
        runtime.readUnits(),
        runtime.readPlanets()
      );
      renderCurrentFrame();
      return;
    }

    if (key === "tab") {
      event.preventDefault();
      setCameraMode(
        cameraControls,
        cameraControls.mode === "tactical" ? "strategic" : "tactical"
      );
      applyCameraControls(
        camera,
        cameraControls,
        container,
        runtime.readUnits(),
        runtime.readPlanets()
      );
      renderCurrentFrame();
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    cameraControls.isDragging = true;
    cameraControls.pointerId = event.pointerId;
    cameraControls.lastPointerX = event.clientX;
    cameraControls.lastPointerY = event.clientY;
    cameraControls.dragDistancePx = 0;
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
    cameraControls.yaw -= dx * 0.006;
    cameraControls.pitch = clamp(cameraControls.pitch + dy * 0.004, 0.28, 1.38);
    renderCurrentFrame();
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (cameraControls.pointerId !== event.pointerId) {
      return;
    }

    const wasClick = cameraControls.dragDistancePx <= 5;
    cameraControls.isDragging = false;
    cameraControls.pointerId = null;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (
      event.type === "pointerup" &&
      wasClick &&
      issueMoveCommandFromClick(
        event,
        renderer.domElement,
        camera,
        runtime,
        selectedUnitKeys
      )
    ) {
      renderCurrentFrame();
    }
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
    renderCurrentFrame();
  };

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    applyCameraControls(
      camera,
      cameraControls,
      container,
      runtime.readUnits(),
      runtime.readPlanets()
    );
    renderer.setSize(clientWidth, clientHeight, false);
  };

  const renderCurrentFrame = () => {
    const units = runtime.readUnits();
    const planets = runtime.readPlanets();
    const planetaryContext = getCurrentPlanetaryContext(planets);
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const liveUnitKeys = new Set(units.map((unit) => unit.key));

    for (const selectedKey of selectedUnitKeys) {
      if (!liveUnitKeys.has(selectedKey)) {
        selectedUnitKeys.delete(selectedKey);
      }
    }

    updatePlanetProxies(worldGroup, planetProxies, planets);
    updateUnitProxies(worldGroup, proxies, units, selectedUnitKeys, 1);
    applyCameraControls(camera, cameraControls, container, units, planets);
    camera.updateMatrixWorld();
    renderer.getDrawingBufferSize(renderResolution);
    updateNebulaSkyDome(
      nebulaSkyDome,
      elapsedSeconds,
      camera,
      renderResolution
    );
    updatePlanetBillboards(planetProxies, camera, elapsedSeconds);
    const sunScreenPosition = updateSunFlarePass(
      sunFlarePass,
      camera,
      getCameraFocusPosition(units, planets),
      planets,
      renderResolution,
      elapsedSeconds
    );
    container.dataset.cameraMode = cameraControls.mode;
    container.dataset.cameraFocus = planetaryContext?.label ?? "none";
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
    container.dataset.playerId = runtime.playerId.toString();
    container.dataset.connectionState = runtime.readConnectionStatus().state;
    updateHud(hud, runtime, CAMERA_MODES[cameraControls.mode].label);
    renderer.clear();
    renderer.render(nebulaSkyDome.scene, nebulaSkyDome.camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(sunFlarePass.scene, sunFlarePass.camera);
  };

  const tickIntervalId = window.setInterval(() => {
    runtime.stepTick();
    renderCurrentFrame();
  }, SIM_DT_MS);

  const frame = () => {
    if (disposed) {
      return;
    }

    frameId = requestAnimationFrame(frame);
    renderCurrentFrame();
  };

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", handleKeyDown);
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointercancel", handlePointerUp);
  renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
  applyCameraControls(
    camera,
    cameraControls,
    container,
    runtime.readUnits(),
    runtime.readPlanets()
  );
  resize();
  renderCurrentFrame();
  frameId = requestAnimationFrame(frame);

  return {
    runtime,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearInterval(tickIntervalId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKeyDown);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
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
  cameraControls.pitch = CAMERA_MODES[mode].pitch;
}

function applyCameraControls(
  camera: THREE.OrthographicCamera,
  cameraControls: CameraControls,
  container: HTMLElement,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[]
): void {
  const { clientWidth, clientHeight } = container;
  const aspect = clientWidth / Math.max(clientHeight, 1);
  const focus = getCameraFocusPosition(units, planets);
  const viewHeight = cameraControls.viewHeights[cameraControls.mode];
  const halfHeight = viewHeight / 2;
  const halfWidth = halfHeight * aspect;
  const worldUp = new THREE.Vector3(0, 1, 0);
  const horizontal = new THREE.Vector3(
    Math.sin(cameraControls.yaw),
    0,
    Math.cos(cameraControls.yaw)
  ).normalize();
  const orbitDistance = viewHeight * 1.45;
  const cameraOffset = worldUp
    .clone()
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

function getCameraFocusPosition(
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[]
): THREE.Vector3 {
  return (
    getCurrentPlanetaryContext(planets)?.position.clone() ??
    getLocalFocusPosition(units, DEFAULT_LOCAL_PLAYER_ID)
  );
}

function getCurrentPlanetaryContext(
  planets: readonly PlanetViewModel[]
): PlanetViewModel | null {
  return planets.find((planet) => planet.label === "Aurora") ?? planets[0] ?? null;
}

function getLocalFocusPosition(
  units: readonly UnitViewModel[],
  playerId: PlayerId
): THREE.Vector3 {
  return (
    units.find((unit) => unit.owner === playerId)?.position.clone() ??
    units[0]?.position.clone() ??
    new THREE.Vector3()
  );
}

function issueMoveCommandFromClick(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>
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
    runtime.readPlanets()
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
  planets: readonly PlanetViewModel[]
): THREE.Vector3 | null {
  const bounds = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
  const y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(x, y);
  const target = new THREE.Vector3();
  const context = getCurrentPlanetaryContext(planets);
  const tacticalPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -(context?.position.y ?? 0)
  );

  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(tacticalPlane, target)
    ? target
    : null;
}

function updatePlanetProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, PlanetProxy>,
  planets: readonly PlanetViewModel[]
): void {
  const liveKeys = new Set<string>();

  for (const planet of planets) {
    liveKeys.add(planet.key);
    let proxy = proxies.get(planet.key);

    if (!proxy) {
      proxy = createPlanetProxy(planet);
      proxies.set(planet.key, proxy);
      worldGroup.add(proxy.body);
    }

    proxy.body.position.copy(planet.position);
    proxy.body.scale.setScalar(planet.radius * 2.12);
  }

  for (const [key, proxy] of proxies) {
    if (!liveKeys.has(key)) {
      worldGroup.remove(proxy.body);
      proxy.body.geometry.dispose();
      proxy.body.material.dispose();
      proxies.delete(key);
    }
  }
}

function updateUnitProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, UnitProxy>,
  units: readonly UnitViewModel[],
  selectedUnitKeys: ReadonlySet<string>,
  alpha: number
): void {
  const liveKeys = new Set<string>();

  for (const unit of units) {
    liveKeys.add(unit.key);
    let proxy = proxies.get(unit.key);

    if (!proxy) {
      proxy = createUnitProxy(unit);
      proxies.set(unit.key, proxy);
      worldGroup.add(proxy.selectionRing);
      worldGroup.add(proxy.sprite);
    }

    const interpolated = unit.prevPosition.clone().lerp(unit.position, alpha);
    proxy.selectionRing.position.copy(interpolated);
    proxy.selectionRing.visible = selectedUnitKeys.has(unit.key);
    proxy.sprite.position.copy(interpolated);
    proxy.material.rotation = yawFromQuaternion(unit.rotation);
  }

  for (const [key, proxy] of proxies) {
    if (!liveKeys.has(key)) {
      worldGroup.remove(proxy.selectionRing);
      worldGroup.remove(proxy.sprite);
      proxy.selectionMaterial.map?.dispose();
      proxy.selectionMaterial.dispose();
      proxy.material.map?.dispose();
      proxy.material.dispose();
      proxies.delete(key);
    }
  }
}

function createUnitProxy(unit: UnitViewModel): UnitProxy {
  const selectionMaterial = new THREE.SpriteMaterial({
    map: createSelectionRingTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const selectionRing = new THREE.Sprite(selectionMaterial);
  selectionRing.name = `${unit.ownerName} ${unit.label} selection ring`;
  selectionRing.scale.set(4, 4, 1);
  selectionRing.visible = false;
  selectionRing.renderOrder = 10;

  const material = new THREE.SpriteMaterial({
    map: createUnitSymbolTexture(unit.color, unit.owner),
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `${unit.ownerName} ${unit.label} tactical symbol`;
  sprite.scale.set(2.4, 2.4, 1);
  sprite.renderOrder = 11;

  return {
    sprite,
    material,
    selectionRing,
    selectionMaterial,
  };
}

function createPlanetProxy(planet: PlanetViewModel): PlanetProxy {
  const body = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createPlanetBillboardMaterial()
  );
  body.name = `${planet.label} shaded billboard planet`;
  body.position.copy(planet.position);
  body.scale.setScalar(planet.radius * 2.12);
  body.renderOrder = -5;

  return {
    body,
  };
}

function createLighting(sunDirection: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();

  const sunLight = new THREE.DirectionalLight(SUN_COLOR, 1.65);
  sunLight.position.copy(sunDirection).multiplyScalar(1000);
  group.add(sunLight);
  group.add(sunLight.target);
  group.add(new THREE.AmbientLight(0xdbe7ff, 0.42));

  return group;
}

function createTacticalPlane(): THREE.Object3D {
  const grid = new THREE.GridHelper(180, 36, 0x293044, 0x151b29);
  grid.position.y = -0.85;
  return grid;
}

function createNebulaSkyDome(): SkyDome {
  const geometry = new THREE.SphereGeometry(4500, 96, 48);
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
      uSunColor: { value: SUN_COLOR.clone() },
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
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
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
  resolution: THREE.Vector2,
  elapsedSeconds: number
): THREE.Vector4 {
  const sunPosition = focus
    .clone()
    .add(SUN_DIRECTION.clone().multiplyScalar(2600));
  const projectedSun = sunPosition.project(camera);
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  const visibility =
    projectedSun.z >= -1 && projectedSun.z <= 1
      ? clamp(cameraDirection.dot(SUN_DIRECTION), 0, 1)
      : 0;
  const screenPosition = new THREE.Vector2(
    0.5 + projectedSun.x * 0.5,
    0.5 + projectedSun.y * 0.5
  );
  const screenDistance = Math.max(
    Math.abs(screenPosition.x - 0.5),
    Math.abs(screenPosition.y - 0.5)
  );
  const screenFade = 1 - smoothstep(0.58, 0.82, screenDistance);
  const occlusion = computeSunPlanetOcclusion(camera, screenPosition, planets);
  const visibleSun = visibility * screenFade * (1 - occlusion);

  pass.material.uniforms.uResolution.value.copy(resolution);
  pass.material.uniforms.uSunPosition.value.copy(screenPosition);
  pass.material.uniforms.uVisibility.value = visibleSun;
  pass.material.uniforms.uTime.value = elapsedSeconds;

  return new THREE.Vector4(screenPosition.x, screenPosition.y, visibleSun, occlusion);
}

function computeSunPlanetOcclusion(
  camera: THREE.Camera,
  sunScreenPosition: THREE.Vector2,
  planets: readonly PlanetViewModel[]
): number {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return 0;
  }

  const viewHeight = camera.top - camera.bottom;
  const viewWidth = camera.right - camera.left;
  let occlusion = 0;

  for (const planet of planets) {
    const projectedPlanet = planet.position.clone().project(camera);

    if (projectedPlanet.z < -1 || projectedPlanet.z > 1) {
      continue;
    }

    const planetScreenPosition = new THREE.Vector2(
      0.5 + projectedPlanet.x * 0.5,
      0.5 + projectedPlanet.y * 0.5
    );
    const occlusionRadius = planet.radius * 1.03;
    const radiusX = occlusionRadius / viewWidth;
    const radiusY = occlusionRadius / viewHeight;
    const normalizedDistance = Math.hypot(
      (sunScreenPosition.x - planetScreenPosition.x) / radiusX,
      (sunScreenPosition.y - planetScreenPosition.y) / radiusY
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
  elapsedSeconds: number
): void {
  const sunViewDirection = SUN_DIRECTION.clone()
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

function createHud(container: HTMLElement): HTMLElement {
  const hud = document.createElement("div");
  hud.className = "game-hud";
  container.appendChild(hud);
  return hud;
}

function updateHud(
  hud: HTMLElement,
  runtime: LocalGameRuntime,
  cameraModeLabel: string
): void {
  const units = runtime.readUnits();
  const planets = runtime.readPlanets();
  const connection = runtime.readConnectionStatus();
  const connectedPlayers = connection.players
    ?.filter((player) => player.connected)
    .map((player) => player.playerId)
    .join(", ");
  const connectionLine =
    connection.mode === "network"
      ? `Match ${connection.matchId} P${connection.playerId} ${connection.state}${
          connection.running ? "" : " waiting"
        }${connectedPlayers ? ` seats ${connectedPlayers}` : ""}`
      : `Local P${connection.playerId}`;
  const unitRows = units
    .map(
      (unit) =>
        `<li data-unit-owner="${unit.owner}" data-pos-x="${unit.position.x.toFixed(3)}" data-pos-y="${unit.position.y.toFixed(3)}" data-pos-z="${unit.position.z.toFixed(3)}" data-rotation-y="${unit.rotation.y.toFixed(6)}"><span style="--unit-color:${unit.color}"></span>${unit.ownerName} ${unit.label} ${unit.health.current}/${unit.health.max}</li>`
    )
    .join("");
  const planetRows = planets
    .map(
      (planet) =>
        `<li><span style="--unit-color:#78efe0"></span>${planet.label} r=${planet.radius.toFixed(1)} m=${planet.mass.toExponential(1)}</li>`
    )
    .join("");

  hud.innerHTML = `<div class="hud-title">Drop Ship</div><div>${connectionLine}</div><div>Mode ${cameraModeLabel}</div><div>Tick ${runtime.world.tick
    .toString()
    .padStart(5, "0")}</div><div>Hash ${runtime.readHash()}</div><ul>${unitRows}${planetRows}</ul>`;
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

const SKY_DOME_VERTEX_SHADER = `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NEBULA_BACKGROUND_FRAGMENT_SHADER = `
#define OCTAVES 5

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
  const float atmosphereRadius = 0.968;

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
  vec3 ocean = vec3(0.05, 0.23, 0.58);
  vec3 land = vec3(0.12, 0.42, 0.30);
  vec3 earth = vec3(0.34, 0.25, 0.16);
  float continent = smoothstep(
    -0.24,
    0.58,
    sin(centered.x * 7.4 + centered.y * 2.2) +
      0.5 * sin(centered.y * 8.6 - centered.x * 3.1)
  );
  vec3 surface = mix(ocean, land, continent * 0.22);
  surface = mix(surface, earth, continent * smoothstep(-0.15, 0.65, centered.y) * 0.08);
  float limbShade = 1.0 - smoothstep(0.24, solidRadius, radius) * 0.34;
  float lightShade = 0.36 + 0.62 * sunSide;
  vec3 planetColor = surface * limbShade * lightShade;
  planetColor += vec3(0.10, 0.19, 0.36) * (1.0 - sunSide) * 0.42;

  vec3 atmosphericVeil = scatter * innerAir * vec3(0.72, 0.88, 1.25);
  atmosphericVeil += vec3(0.10, 0.32, 0.95) * innerAir * (0.55 + 0.45 * sunSide);
  vec3 atmosphereColor = (scatter * (0.34 + sunSide * 1.72) + forwardSun) * horizonColumn;
  atmosphereColor += vec3(0.18, 0.42, 1.0) * horizonColumn * (0.35 + 0.65 * sunSide);
  atmosphereColor += atmosphericVeil;
  vec3 color = planetColor * solidMask * 0.12 + atmosphereColor;

  float alpha = max(solidMask, clamp(shell * (0.14 + sunSide * 0.36) + innerAir, 0.0, 0.42));
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
