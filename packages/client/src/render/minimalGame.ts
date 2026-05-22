import * as THREE from "three";
import gasGiantGrungeTextureUrl from "../../../../content/images/red-gas-giant/grunge.jpg?url";
import gasGiantNoiseTextureUrl from "../../../../content/images/red-gas-giant/noise.png?url";
import {
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  handleKey,
  type CaptureRulesConfig,
  type MatchConfig,
  type OrbitLaneSpec,
  type PlanetClass,
  type PlayerId,
  type PlayerConfig,
  type SunConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  PLANET_GRAVITY_MAX_STRENGTH,
  SIM_DT_MS,
  computePlanetGravityVector,
  readCaptureRules,
} from "@drop-ship/sim";
import {
  CAMERA_MODES,
  CAMERA_PRESETS,
  applyCameraPreset,
  setCameraMode,
  type CameraPreset,
  type CameraControls,
  type CameraFocusTween,
} from "../camera/config";
import { createNetworkedGame } from "../net/networkedGame";
import {
  FULLSCREEN_VERTEX_SHADER,
  GRAVITY_VECTOR_FRAGMENT_SHADER,
  GRAVITY_VECTOR_VERTEX_SHADER,
  NEBULA_BACKGROUND_FRAGMENT_SHADER,
  PLANET_BILLBOARD_FRAGMENT_SHADER,
  PLANET_BILLBOARD_VERTEX_SHADER,
  PLANET_GLOW_FRAGMENT_SHADER,
  PLANET_RING_FRAGMENT_SHADER,
  PLANET_RING_VERTEX_SHADER,
  SKY_DOME_VERTEX_SHADER,
  SUN_FLARE_FRAGMENT_SHADER,
} from "./shaders";
import {
  addProjectileEvents,
  createProjectileParticleRenderer,
  disposeProjectileParticleRenderer,
  updateProjectileParticleRenderQuality,
  updateProjectileParticles,
} from "./projectileParticles";
import {
  DEFAULT_RENDER_QUALITY_MODE,
  RENDER_QUALITY_CONFIGS,
  getPreferredRenderPixelRatio,
  type RenderQualityConfig,
} from "./renderQuality";
import {
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
  clamp,
  readWorldUnitsPerPixel,
  smoothstep,
} from "./renderMath";
import {
  UNIT_SYMBOL_SIZE_PX,
  createUnitBatchRenderer,
  disposeUnitBatchRenderer,
  readUnitSymbolScale,
  updateUnitBatches,
} from "./unitBatches";
import {
  createSelectionBox,
  hideSelectionBox,
  updateSelectionBox,
} from "../ui/controls";
import { createPlanetStatsRenderCache } from "./planetStatsRender";
import {
  createInitialOverlaySnapshot,
  mountGameOverlay,
  type CommandHistoryEntry,
  type PendingCommandMenuCommand,
  type SelectedPlanetStatsSnapshot,
  type SelectedUnitObjectiveSnapshot,
} from "../ui/GameOverlay";
import {
  createMatchEndDialogSnapshot,
  createMatchStatusSnapshot,
} from "../ui/overlaySelectors";
import { createUiStore } from "../ui/store";
import { createMinimalLocalGame } from "../runtime/localGame";
import { DEFAULT_LOCAL_PLAYER_ID } from "../runtime/matchConfig";
import {
  selectClassHotkeyUnitKeys,
  selectMoveOrderUnits,
} from "../selection/commands";
import {
  selectPrimarySceneSelectionCandidate,
  toSceneSelectionTarget,
  type SceneSelectionCandidate,
  type SceneSelectionTarget,
} from "../selection/interactions";
import {
  rankAttackTargetCandidates,
  selectNextAttackTargetKey,
  type AttackTargetCandidate,
} from "../selection/targeting";
import type {
  LocalGameRuntime,
  MountedGame,
  MountMinimalGameOptions,
  PlanetViewModel,
  RenderQualityMode,
  RuntimeConnectionStatus,
  UnitViewModel,
} from "../types";

type PlanetProxy = {
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  rings: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  lastSeenFrame: number;
};

type GasGiantPaletteTheme = readonly [number, number, number, number];

type GasGiantTextureSet = Readonly<{
  grunge: THREE.Texture;
  noise: THREE.Texture;
}>;

type TacticalGrid = Readonly<{
  root: THREE.Group;
  grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  intersection: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}>;

type CommandHistoryRecord = CommandHistoryEntry &
  Readonly<{
    unitKeys: readonly string[];
  }>;

type IssuedUnitCommand = Readonly<{
  label: string;
  units: readonly UnitViewModel[];
  attackTargetKey?: string;
  orbitLaneSelection?: SelectedOrbitLane;
}>;

type CompleteIssuedCommandOptions = Readonly<{
  preserveSelection?: boolean;
}>;

type CaptureProgressRing = {
  readonly root: THREE.Group;
  readonly track: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly progress: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly progressPositions: Float32Array;
  lastSeenFrame: number;
};

type OrbitLaneRing = {
  readonly root: THREE.Group;
  readonly line: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lastSeenFrame: number;
};

type OrbitLaneVisual = Readonly<{
  key: string;
  planet: PlanetViewModel;
  lane: OrbitLaneSpec;
  color: number;
  opacity: number;
}>;

type OrbitLaneDragState = {
  planetKey: string;
  anchorPoint: THREE.Vector3;
  anchorNormal: THREE.Vector3;
  lane: OrbitLaneSpec;
};

type SelectedOrbitLane = Readonly<{
  planetKey: string;
  lane: OrbitLaneSpec;
}>;

type SelectionMode = "add" | "remove" | "replace";

type CameraZoomTween = {
  active: boolean;
  mode: CameraControls["mode"];
  from: number;
  to: number;
  startAt: number;
};

type ViewportMetrics = {
  width: number;
  height: number;
  aspect: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

type RendererBackBufferMetrics = {
  width: number;
  height: number;
  pixelRatio: number;
};

type SelectedLeaderArrow = {
  element: HTMLElement;
  visible: boolean;
  transform: string;
};

type AttackTargetMarkerState = "hover" | "cycle" | "locked";

type AttackTargetMarker = {
  element: HTMLElement;
  label: HTMLElement;
  visible: boolean;
  transform: string;
  labelText: string;
  state: AttackTargetMarkerState;
  sizePx: number;
};

type PlanetSelectionMarkerState = "selected" | "hover";

type PlanetScreenRing = {
  element: HTMLElement;
  visible: boolean;
  transform: string;
  sizePx: number;
  accentColor: string;
  state: PlanetSelectionMarkerState;
};

type PlanetSelectionMarker = {
  element: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
  visible: boolean;
  transform: string;
  titleText: string;
  detailText: string;
  accentColor: string;
  state: PlanetSelectionMarkerState;
};

type ScreenAttackTargetCandidate = AttackTargetCandidate &
  Readonly<{
    unit: UnitViewModel;
  }>;

type ScreenSceneSelectionCandidate = SceneSelectionCandidate &
  (
    | Readonly<{
        kind: "friendlyUnit" | "enemyUnit";
        unit: UnitViewModel;
      }>
    | Readonly<{
        kind: "planet";
        planet: PlanetViewModel;
      }>
  );

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
  pannedFocus: THREE.Vector3;
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
  cameraRight: THREE.Vector3;
  cameraUp: THREE.Vector3;
  cameraForward: THREE.Vector3;
  screenPosition: THREE.Vector2;
  sunScreenPosition: THREE.Vector4;
  orbitDragPoint: THREE.Vector3;
  orbitDragVector: THREE.Vector3;
  orbitDragTangent: THREE.Vector3;
  orbitDragAxis: THREE.Vector3;
  orbitHeading: THREE.Vector3;
};

type GravityOverlay = {
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  alphas: Float32Array;
  sampleCapacity: number;
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  sample: THREE.Vector3;
  gravityVector: THREE.Vector3;
  gravityResult: { x: number; y: number; z: number };
  end: THREE.Vector3;
  headBase: THREE.Vector3;
  side: THREE.Vector3;
  headLeft: THREE.Vector3;
  headRight: THREE.Vector3;
};

const HUD_UPDATE_INTERVAL_MS = 500;
const PERF_DATASET_INTERVAL_MS = 500;
const PIXEL_RATIO_ADJUST_INTERVAL_MS = 1500;
const RENDERER_RESIZE_MIN_INTERVAL_MS = 100;
const MAX_SIM_STEPS_PER_FRAME = 5;
const MAX_SIM_FRAME_DELTA_MS = 250;
const COMMAND_HISTORY_LIMIT = 10;
const PLANET_SELECTION_MIN_RADIUS_PX = 28;
const PLANET_SELECTION_RADIUS_MULTIPLIER = 2.16;
const PLANET_SELECTION_INDICATOR_RADIUS_MULTIPLIER = 2.28;
const PLANET_SELECTION_LABEL_GAP_PX = 10;
const ATTACK_TARGET_PICK_MIN_RADIUS_PX = 18;
const ATTACK_TARGET_HOVER_RADIUS_MULTIPLIER = 0.78;
const ATTACK_TARGET_TAB_RADIUS_PX = 142;
const ATTACK_TARGET_TAB_FALLBACK_RADIUS_PX = 220;
const FRIENDLY_UNIT_PICK_MIN_RADIUS_PX = 8;
const FRIENDLY_UNIT_HOVER_RADIUS_MULTIPLIER = 0.8;
const CAMERA_FOCUS_TWEEN_MS = 720;
const CAMERA_ZOOM_TWEEN_MS = 560;
const CAMERA_ZOOM_TO_FIT_PADDING = 1.18;
const GRAVITY_OVERLAY_GRID_SIZE = 11;
const GRAVITY_OVERLAY_MIN_STRENGTH = 0.006;
const GRAVITY_OVERLAY_VECTOR_LENGTH = 5.2;
const GRAVITY_OVERLAY_HEAD_LENGTH = 1.45;
const GRAVITY_OVERLAY_SEGMENTS_PER_VECTOR = 3;
const GRAVITY_OVERLAY_VERTICES_PER_VECTOR = GRAVITY_OVERLAY_SEGMENTS_PER_VECTOR * 2;
const TACTICAL_GRID_WORLD_SIZE = 4;
const TACTICAL_GRID_DIVISIONS = 40;
const TACTICAL_GRID_INTERSECTION_SEGMENTS = 128;
const TACTICAL_GRID_MASK_RADIUS = 1;
const TACTICAL_OVERLAY_COLOR_HEX = 0xfc3d21;
const CAPTURE_PROGRESS_SEGMENTS = 96;
const CAPTURE_PROGRESS_RADIUS_MULTIPLIER = 1.42;
const ORBIT_LANE_SEGMENTS = 160;
const ORBIT_LANE_MIN_RADIUS_MULTIPLIER = 1.18;
const ORBIT_LANE_MAX_RADIUS_MULTIPLIER = 8;
const ORBIT_LANE_DRAG_MIN_WORLD_UNITS = 1.5;
const PLANET_BODY_BILLBOARD_SCALE = 2.12;
const PLANET_RING_INNER_RADIUS = 1.18;
const PLANET_RING_OUTER_RADIUS = 2.05;
const GAS_GIANT_PALETTE_THEMES: readonly GasGiantPaletteTheme[] = [
  [0x101a38, 0x315a9e, 0xc8d9ff, 0xe1b46d],
  [0x1a102b, 0x67449b, 0xdfc4ff, 0xe87fa3],
  [0x26140d, 0x9c4e24, 0xf0c06e, 0x7f2e21],
  [0x10241d, 0x4f7e5d, 0xd8d19b, 0x95b75e],
  [0x172232, 0x5d7287, 0xe4d4b6, 0xd09352],
];
const TACTICAL_BASIS_MATRIX = new THREE.Matrix4();
const PLANET_RING_AXIS_SCRATCH = new THREE.Vector3(0, 1, 0);
const GAS_GIANT_BASE_COLOR_SCRATCH = new THREE.Color();
const GAS_GIANT_PALETTE_COLOR_SCRATCH = new THREE.Color();
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(-0.252, -0.827, -0.502).normalize();
const DEFAULT_SUN_COLOR = new THREE.Color().setRGB(0.643, 0.494, 0.867);

export function mountMinimalGame(
  container: HTMLElement,
  options: MountMinimalGameOptions = {}
): MountedGame {
  const playerId = options.playerId ?? DEFAULT_LOCAL_PLAYER_ID;
  let renderQuality =
    RENDER_QUALITY_CONFIGS[options.renderMode ?? DEFAULT_RENDER_QUALITY_MODE];
  const runtime =
    options.network || options.matchId
      ? createNetworkedGame({
          matchId: options.matchId ?? "demo",
          playerId,
          serverUrl: options.serverUrl,
          seed: options.seed,
          debugMatchParams: options.debugMatchParams,
          debugLogs: options.debugNetworkLogs,
          creatorToken: options.creatorToken,
          playerToken: options.playerToken,
          rememberPlayerToken: options.rememberPlayerToken,
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
    mode: "tactical",
    preset: "top",
    yaw: CAMERA_PRESETS.top.yaw,
    pitch: CAMERA_PRESETS.top.pitch,
    panOffset: new THREE.Vector3(),
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

  let activeRenderPixelRatio = getPreferredRenderPixelRatio(renderQuality);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
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
  const projectileParticles = createProjectileParticleRenderer(renderQuality);
  worldGroup.add(projectileParticles.root);
  const planetProxies = new Map<string, PlanetProxy>();
  const planetGeometry = new THREE.PlaneGeometry(1, 1);
  let planetRingGeometry = createPlanetRingGeometry(renderQuality);
  const gasGiantTextures = createGasGiantTextureSet();
  const planetStatsRenderCache = createPlanetStatsRenderCache(
    renderer,
    gasGiantTextures
  );
  const planetStatsSunDirection = new THREE.Vector3();
  let planetMaterial = createPlanetBillboardMaterial(
    gasGiantTextures,
    renderQuality.mode
  );
  let planetGlowMaterial: THREE.ShaderMaterial | null =
    renderQuality.planetGlowEnabled
      ? createPlanetGlowMaterial(gasGiantTextures, renderQuality.mode)
      : null;
  const planetRingMaterial = createPlanetRingMaterial();
  const gravityOverlay = createGravityOverlay();
  worldGroup.add(gravityOverlay.root);
  const selectedPlanetRing = createPlanetScreenRing(container, "selected");
  const hoveredPlanetRing = createPlanetScreenRing(container, "hover");
  const selectedPlanetMarker = createPlanetSelectionMarker(container, "selected");
  const hoveredPlanetMarker = createPlanetSelectionMarker(container, "hover");
  const captureProgressRings = new Map<string, CaptureProgressRing>();
  const orbitLaneRings = new Map<string, OrbitLaneRing>();
  const selectedUnitKeys = new Set<string>();
  const previousCommandSelectionKeys = new Set<string>();
  let selectedPlanetKey: string | null = null;
  let commandMenuLeaderKey: string | null = null;
  let previousCommandLeaderKey: string | null = null;
  let hoveredSelectionTarget: SceneSelectionTarget | null = null;
  let cycledAttackTargetKey: string | null = null;
  let lockedAttackTargetKey: string | null = null;
  let selectedOrbitLane: SelectedOrbitLane | null = null;
  let pendingCommand: PendingCommandMenuCommand = null;
  let tacticalOverlayEnabled = true;
  let singlePlayerPaused =
    runtime.readConnectionStatus().mode === "local" &&
    (options.initialPaused ?? false);
  let hotkeysDialogOpen = options.initialPaused ?? false;
  let networkStartMenuOpen =
    runtime.readConnectionStatus().mode === "network" &&
    (options.initialPaused ?? false);
  let matchEndDialogOpen = runtime.world.matchResult !== null;
  let replayRequestPending = false;
  let twoPlayerShareState: "idle" | "creating" | "error" = "idle";
  let twoPlayerShareMessage = "";
  let nextCommandHistoryId = 1;
  const commandHistory: CommandHistoryRecord[] = [];
  const selectionBox = createSelectionBox(container);
  const leaderArrow = createSelectedLeaderArrow(container);
  const hoveredAttackTargetMarker = createAttackTargetMarker(container, "hover");
  const cycledAttackTargetMarker = createAttackTargetMarker(container, "cycle");
  const lockedAttackTargetMarker = createAttackTargetMarker(container, "locked");
  const overlayStore = createUiStore(
    createInitialOverlaySnapshot(
      renderQuality.mode,
      runtime.readConnectionStatus()
    )
  );
  const overlay = mountGameOverlay(container, overlayStore, {
    selectCameraPreset(preset) {
      cancelCameraZoomTween();
      applyCameraPreset(cameraControls, preset);
      publishOverlaySnapshot();
    },
    zoomToFit() {
      startZoomToFit(performance.now());
    },
    setTacticalOverlayEnabled(enabled) {
      tacticalOverlayEnabled = enabled;
      publishOverlaySnapshot();
    },
    toggleRenderMode() {
      applyRenderMode(
        renderQuality.mode === "cinematic" ? "interactive" : "cinematic"
      );
    },
    selectCommandLeader(unitKey) {
      commandMenuLeaderKey = unitKey;
      publishOverlaySnapshot();
    },
    deselectUnit(unitKey) {
      selectedUnitKeys.delete(unitKey);

      if (commandMenuLeaderKey === unitKey) {
        commandMenuLeaderKey = null;
      }

      if (selectedUnitKeys.size === 0) {
        pendingCommand = null;
        clearHoveredSelectionTarget();
      }
      publishOverlaySnapshot();
    },
    escortLeader() {
      const issuedCommand = issueEscortLeaderOrder(
        runtime,
        selectedUnitKeys,
        commandMenuLeaderKey
      );

      if (issuedCommand) {
        completeIssuedCommand(issuedCommand);
      }
    },
    toggleOrbitPlanetCommand() {
      if (selectedUnitKeys.size === 0) {
        return;
      }

      pendingCommand = pendingCommand === "orbitPlanet" ? null : "orbitPlanet";
      publishOverlaySnapshot();
    },
    selectCommandHistoryEntry(entryId) {
      selectCommandHistoryUnits(entryId);
    },
    closeHotkeysDialog() {
      closeHotkeysDialog();
    },
    readyForMatch() {
      runtime.readyForMatch();
      publishOverlaySnapshot();
    },
    replayMatch() {
      replayMatch();
    },
    createTwoPlayerGame() {
      void createTwoPlayerGameFromPauseMenu();
    },
  });
  const renderResolution = new THREE.Vector2();
  const viewport = createViewportMetrics(container);
  const rendererBackBuffer = createRendererBackBufferMetrics();
  const scratch = createRenderScratch();
  const cameraFocusTween = createCameraFocusTween();
  const zoomToFitFocus = new THREE.Vector3();
  let zoomToFitFocusEnabled = false;
  let zoomToFitContextId = 0;

  const lighting = createLighting(
    writeSunDirection(scratch.sunDirection, runtime.world.config),
    writeSunColor(scratch.sunColor, runtime.world.config)
  );
  scene.add(lighting.group);
  const tacticalGrid = createTacticalPlane();
  scene.add(tacticalGrid.root);

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
  let resizeFrameId: number | null = null;
  let resizeThrottleTimeoutId: number | null = null;
  let lastRendererResizeAt = -RENDERER_RESIZE_MIN_INTERVAL_MS;
  let pendingViewportSize: ViewportSize | null = null;
  let renderFrameIndex = 0;
  let activeSelectionMode: SelectionMode = "replace";
  let selectionDragStarted = false;
  let orbitLaneDragState: OrbitLaneDragState | null = null;
  let previousCameraFocusContextKey: string | null = null;
  let lastPointerClientX: number | null = null;
  let lastPointerClientY: number | null = null;
  const cameraZoomTween: CameraZoomTween = {
    active: false,
    mode: cameraControls.mode,
    from: cameraControls.viewHeights[cameraControls.mode],
    to: cameraControls.viewHeights[cameraControls.mode],
    startAt: startedAt,
  };

  function publishOverlaySnapshot(): void {
    const units = runtime.readUnits();
    const planets = runtime.readPlanets();
    const connectionStatus = runtime.readConnectionStatus();
    syncMatchEndDialog();
    syncNetworkStartMenu(connectionStatus);
    const selectedUnits = units.filter((unit) => selectedUnitKeys.has(unit.key));
    const selectedStatsUnit = readSelectedStatsUnit(
      selectedUnits,
      commandMenuLeaderKey
    );
    const selectedPlanet = getSelectedPlanet(planets, selectedPlanetKey);

    overlayStore.setSnapshot({
      activeCameraPreset: cameraControls.preset,
      tacticalOverlayEnabled,
      renderMode: renderQuality.mode,
      selectedUnits,
      selectedUnitObjective: selectedStatsUnit
        ? createSelectedUnitObjectiveSnapshot(selectedStatsUnit, units, planets)
        : null,
      selectedPlanet: selectedPlanet
        ? createSelectedPlanetStatsSnapshot(
            selectedPlanet,
            planetStatsRenderCache.readImageUrl(
              selectedPlanet,
              writeSunDirection(planetStatsSunDirection, runtime.world.config)
            ),
            runtime.world.config.players,
            readCaptureRules(runtime.world)
          )
        : null,
      commandMenuLeaderKey,
      pendingCommand,
      commandHistory: commandHistory.map(
        ({ id, label, detail, unitCount }) => ({
          id,
          label,
          detail,
          unitCount,
        })
      ),
      matchStatus: createMatchStatusSnapshot(
        runtime,
        units,
        planets,
        readPendingStatusText(connectionStatus, isSinglePlayerPaused())
      ),
      matchEnd: createMatchEndDialogSnapshot(runtime, units, planets, {
        open: matchEndDialogOpen,
        replaying: replayRequestPending,
      }),
      hotkeysOpen: hotkeysDialogOpen && !matchEndDialogOpen,
      connectionStatus,
      pauseMenuMessage: readPauseMenuMessage(connectionStatus),
      twoPlayerShare: {
        canCreate:
          connectionStatus.mode === "local" &&
          options.createTwoPlayerGame !== undefined,
        state: twoPlayerShareState,
        message: twoPlayerShareMessage,
      },
    });
  }

  function applyRenderMode(renderMode: RenderQualityMode): void {
    if (renderMode === renderQuality.mode) {
      return;
    }

    const nextRenderQuality = RENDER_QUALITY_CONFIGS[renderMode];
    const previousPlanetRingGeometry = planetRingGeometry;
    renderQuality = nextRenderQuality;
    planetRingGeometry = createPlanetRingGeometry(renderQuality);
    disposePlanetProxies(worldGroup, planetProxies);
    previousPlanetRingGeometry.dispose();
    planetMaterial.dispose();
    planetMaterial = createPlanetBillboardMaterial(
      gasGiantTextures,
      renderQuality.mode
    );
    planetGlowMaterial?.dispose();
    planetGlowMaterial = renderQuality.planetGlowEnabled
      ? createPlanetGlowMaterial(gasGiantTextures, renderQuality.mode)
      : null;
    updateProjectileParticleRenderQuality(projectileParticles, renderQuality);
    activeRenderPixelRatio = getPreferredRenderPixelRatio(renderQuality);
    lastPixelRatioAdjustAt = performance.now();
    applyViewportResize();
    updateRenderModeQuery(renderQuality.mode);
    container.dataset.renderMode = renderQuality.mode;
    publishOverlaySnapshot();
  }

  function openHotkeysDialog(): void {
    const connectionStatus = runtime.readConnectionStatus();

    if (connectionStatus.mode === "local") {
      singlePlayerPaused = true;
    } else if (!connectionStatus.running) {
      networkStartMenuOpen = true;
    }

    hotkeysDialogOpen = true;
    publishOverlaySnapshot();
    window.requestAnimationFrame(() => {
      if (!hotkeysDialogOpen) {
        return;
      }

      (
        container.querySelector<HTMLButtonElement>(".hotkeys-dialog-ready") ??
        container.querySelector<HTMLButtonElement>(".hotkeys-dialog-close")
      )?.focus();
    });
  }

  function closeHotkeysDialog(): void {
    const connectionStatus = runtime.readConnectionStatus();

    if (connectionStatus.mode === "network" && !connectionStatus.running) {
      hotkeysDialogOpen = true;
      networkStartMenuOpen = true;
      publishOverlaySnapshot();
      return;
    }

    singlePlayerPaused = false;
    hotkeysDialogOpen = false;
    networkStartMenuOpen = false;
    twoPlayerShareState = "idle";
    twoPlayerShareMessage = "";
    publishOverlaySnapshot();
    renderer.domElement.focus();
  }

  function syncNetworkStartMenu(
    connectionStatus = runtime.readConnectionStatus()
  ): boolean {
    if (connectionStatus.mode !== "network") {
      networkStartMenuOpen = false;
      return false;
    }

    if (!connectionStatus.running) {
      return false;
    }

    if (!networkStartMenuOpen) {
      return false;
    }

    networkStartMenuOpen = false;

    if (!hotkeysDialogOpen) {
      return false;
    }

    hotkeysDialogOpen = false;
    twoPlayerShareState = "idle";
    twoPlayerShareMessage = "";
    renderer.domElement.focus();
    return true;
  }

  function syncMatchEndDialog(): void {
    if (!runtime.world.matchResult) {
      matchEndDialogOpen = false;
      replayRequestPending = false;
      return;
    }

    if (replayRequestPending) {
      return;
    }

    matchEndDialogOpen = true;
    hotkeysDialogOpen = false;
    networkStartMenuOpen = false;
    singlePlayerPaused = false;
  }

  function replayMatch(): void {
    if (!runtime.world.matchResult || replayRequestPending) {
      return;
    }

    const connectionStatus = runtime.readConnectionStatus();
    resetInteractionStateForNewMatch();
    matchEndDialogOpen = false;
    replayRequestPending = true;

    if (connectionStatus.mode === "network") {
      hotkeysDialogOpen = true;
      networkStartMenuOpen = true;
    }

    runtime.replayMatch();

    if (connectionStatus.mode === "local") {
      replayRequestPending = false;
      hotkeysDialogOpen = false;
      networkStartMenuOpen = false;
      singlePlayerPaused = false;
      startZoomToFit(performance.now());
      renderer.domElement.focus();
    }

    publishOverlaySnapshot();
  }

  function resetInteractionStateForNewMatch(): void {
    selectedUnitKeys.clear();
    previousCommandSelectionKeys.clear();
    selectedPlanetKey = null;
    commandMenuLeaderKey = null;
    previousCommandLeaderKey = null;
    clearHoveredSelectionTarget();
    pendingCommand = null;
    orbitLaneDragState = null;
    selectedOrbitLane = null;
    commandHistory.length = 0;
    nextCommandHistoryId = 1;
    clearAttackTargeting();
    twoPlayerShareState = "idle";
    twoPlayerShareMessage = "";
    clearZoomToFitFocus();
  }

  async function createTwoPlayerGameFromPauseMenu(): Promise<void> {
    if (!options.createTwoPlayerGame || twoPlayerShareState === "creating") {
      return;
    }

    twoPlayerShareState = "creating";
    twoPlayerShareMessage = "Creating share link...";
    publishOverlaySnapshot();

    try {
      await options.createTwoPlayerGame();
      twoPlayerShareState = "idle";
      twoPlayerShareMessage = "";
      publishOverlaySnapshot();
    } catch (error) {
      twoPlayerShareState = "error";
      twoPlayerShareMessage =
        error instanceof Error
          ? error.message
          : "Could not create a two player game.";
      publishOverlaySnapshot();
    }
  }

  function clearAttackTargeting(): void {
    cycledAttackTargetKey = null;
    lockedAttackTargetKey = null;
  }

  function clearHoveredSelectionTarget(): void {
    hoveredSelectionTarget = null;
  }

  function readHoveredFriendlyUnitKey(): string | null {
    return hoveredSelectionTarget?.kind === "friendlyUnit"
      ? hoveredSelectionTarget.key
      : null;
  }

  function readHoveredAttackTargetKey(): string | null {
    return hoveredSelectionTarget?.kind === "enemyUnit"
      ? hoveredSelectionTarget.key
      : null;
  }

  function readHoveredPlanetKey(): string | null {
    return hoveredSelectionTarget?.kind === "planet"
      ? hoveredSelectionTarget.key
      : null;
  }

  function recordCommandHistory(command: IssuedUnitCommand): void {
    const unitKeys = command.units.map((unit) => unit.key);

    if (unitKeys.length === 0) {
      return;
    }

    commandHistory.unshift({
      id: nextCommandHistoryId,
      label: command.label,
      detail: formatCommandHistoryUnits(command.units),
      unitCount: command.units.length,
      unitKeys,
    });
    nextCommandHistoryId += 1;

    if (commandHistory.length > COMMAND_HISTORY_LIMIT) {
      commandHistory.length = COMMAND_HISTORY_LIMIT;
    }
  }

  function selectCommandHistoryUnits(entryId: number): void {
    const entry = commandHistory.find((candidate) => candidate.id === entryId);

    if (!entry) {
      return;
    }

    clearZoomToFitFocus();
    selectedUnitKeys.clear();

    for (const unitKey of entry.unitKeys) {
      selectedUnitKeys.add(unitKey);
    }

    pruneSelectedUnitKeys(selectedUnitKeys, runtime.readUnits());
    selectedPlanetKey = null;
    commandMenuLeaderKey = pruneCommandMenuLeaderKey(
      commandMenuLeaderKey,
      selectedUnitKeys
    );
    pendingCommand = null;
    clearHoveredSelectionTarget();
    clearAttackTargeting();
    publishOverlaySnapshot();
  }

  function completeIssuedCommand(
    command: IssuedUnitCommand,
    options: CompleteIssuedCommandOptions = {}
  ): void {
    rememberCurrentCommandSelection();
    recordCommandHistory(command);
    if (options.preserveSelection) {
      commandMenuLeaderKey = pruneCommandMenuLeaderKey(
        commandMenuLeaderKey,
        selectedUnitKeys
      );
    } else {
      selectedUnitKeys.clear();
      commandMenuLeaderKey = null;
    }
    pendingCommand = null;
    clearHoveredSelectionTarget();
    cycledAttackTargetKey = command.attackTargetKey ?? null;
    lockedAttackTargetKey = command.attackTargetKey ?? null;
    selectedOrbitLane = command.orbitLaneSelection ?? selectedOrbitLane;
    publishOverlaySnapshot();
  }

  function rememberCurrentCommandSelection(): void {
    previousCommandSelectionKeys.clear();

    for (const unitKey of selectedUnitKeys) {
      previousCommandSelectionKeys.add(unitKey);
    }

    previousCommandLeaderKey = commandMenuLeaderKey;
  }

  function restorePreviousCommandSelection(): void {
    if (previousCommandSelectionKeys.size === 0) {
      return;
    }

    clearZoomToFitFocus();
    selectedUnitKeys.clear();

    for (const unitKey of previousCommandSelectionKeys) {
      selectedUnitKeys.add(unitKey);
    }

    pruneSelectedUnitKeys(selectedUnitKeys, runtime.readUnits());
    commandMenuLeaderKey = pruneCommandMenuLeaderKey(
      previousCommandLeaderKey,
      selectedUnitKeys
    );
    selectedPlanetKey = null;
    pendingCommand = null;
    clearHoveredSelectionTarget();
    clearAttackTargeting();
    publishOverlaySnapshot();
  }

  function isSinglePlayerPaused(): boolean {
    return (
      runtime.readConnectionStatus().mode === "local" &&
      (singlePlayerPaused || hotkeysDialogOpen)
    );
  }

  function canControlUnits(): boolean {
    return runtime.readConnectionStatus().canControl;
  }

  function cancelCameraZoomTween(): void {
    cameraZoomTween.active = false;
  }

  function startZoomToFit(now: number): void {
    const units = runtime.readUnits();
    const planets = runtime.readPlanets();
    const focus = writeZoomToFitFocusPosition(zoomToFitFocus, units, planets);
    const targetHeight = readZoomToFitViewHeight(
      units,
      planets,
      focus,
      viewport,
      cameraControls.mode
    );

    zoomToFitFocusEnabled = true;
    zoomToFitContextId += 1;
    cameraControls.panOffset.set(0, 0, 0);
    cameraZoomTween.active = true;
    cameraZoomTween.mode = cameraControls.mode;
    cameraZoomTween.from = cameraControls.viewHeights[cameraControls.mode];
    cameraZoomTween.to = targetHeight;
    cameraZoomTween.startAt = now;
  }

  function startZoomToSelection(now: number): boolean {
    const units = runtime.readUnits();
    const planets = runtime.readPlanets();
    const selectedPlanet = getSelectedPlanet(planets, selectedPlanetKey);
    const selectedUnits = units.filter((unit) => selectedUnitKeys.has(unit.key));
    let targetHeight: number;

    if (selectedPlanet) {
      zoomToFitFocus.copy(selectedPlanet.position);
      targetHeight = clamp(
        selectedPlanet.radius * 7.2,
        CAMERA_MODES[cameraControls.mode].minViewHeight,
        CAMERA_MODES[cameraControls.mode].maxViewHeight
      );
    } else if (selectedUnits.length > 0) {
      writeUnitCentroidFocus(zoomToFitFocus, selectedUnits);
      targetHeight = readZoomToFitViewHeight(
        selectedUnits,
        [],
        zoomToFitFocus,
        viewport,
        cameraControls.mode
      );
    } else {
      return false;
    }

    zoomToFitFocusEnabled = true;
    zoomToFitContextId += 1;
    cameraControls.panOffset.set(0, 0, 0);
    cameraZoomTween.active = true;
    cameraZoomTween.mode = cameraControls.mode;
    cameraZoomTween.from = cameraControls.viewHeights[cameraControls.mode];
    cameraZoomTween.to = targetHeight;
    cameraZoomTween.startAt = now;
    return true;
  }

  function clearZoomToFitFocus(): void {
    zoomToFitFocusEnabled = false;
  }

  function cycleAttackTargetFromKeyboard(direction: 1 | -1): boolean {
    if (!canControlUnits() || selectedUnitKeys.size === 0) {
      return false;
    }

    const screenPoint = readLastPointerScreenPoint(
      renderer.domElement,
      lastPointerClientX,
      lastPointerClientY
    );
    let candidates = collectAttackTargetCandidates(
      runtime.readUnits(),
      runtime.playerId,
      camera,
      renderer.domElement,
      screenPoint.clientX,
      screenPoint.clientY,
      scratch,
      ATTACK_TARGET_TAB_RADIUS_PX
    );

    if (candidates.length === 0 && screenPoint.source === "pointer") {
      const bounds = renderer.domElement.getBoundingClientRect();

      candidates = collectAttackTargetCandidates(
        runtime.readUnits(),
        runtime.playerId,
        camera,
        renderer.domElement,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        scratch,
        ATTACK_TARGET_TAB_FALLBACK_RADIUS_PX
      );
    }

    const nextKey = selectNextAttackTargetKey(
      candidates,
      cycledAttackTargetKey ??
        readHoveredAttackTargetKey() ??
        lockedAttackTargetKey,
      direction
    );

    if (!nextKey) {
      return false;
    }

    clearZoomToFitFocus();
    cameraZoomTween.active = false;
    selectedPlanetKey = null;
    pendingCommand = null;
    cycledAttackTargetKey = nextKey;
    clearHoveredSelectionTarget();
    publishOverlaySnapshot();
    return true;
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();

    if (hotkeysDialogOpen) {
      if (key === "escape") {
        closeHotkeysDialog();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (key === "p") {
        closeHotkeysDialog();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (key === "escape") {
      pendingCommand = null;
      orbitLaneDragState = null;
      selectedOrbitLane = null;
      clearHoveredSelectionTarget();
      clearAttackTargeting();
      publishOverlaySnapshot();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (
      canControlUnits() &&
      event.code === "Space" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      restorePreviousCommandSelection();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (key === "p") {
      openHotkeysDialog();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (canControlUnits() && key === "1") {
      clearZoomToFitFocus();
      replaceSelectionWithOwnedUnits(selectedUnitKeys, runtime);
      selectedPlanetKey = null;
      commandMenuLeaderKey = pruneCommandMenuLeaderKey(
        commandMenuLeaderKey,
        selectedUnitKeys
      );
      pendingCommand = null;
      clearHoveredSelectionTarget();
      clearAttackTargeting();
      publishOverlaySnapshot();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (canControlUnits() && (key === "8" || key === "9" || key === "0")) {
      clearZoomToFitFocus();
      replaceSelectionWithUnitKeys(
        selectedUnitKeys,
        selectClassHotkeyUnitKeys(
          runtime.readUnits(),
          runtime.playerId,
          selectedUnitKeys,
          key === "8"
            ? SHIP_CLASS_IDS.fighter
            : key === "9"
              ? SHIP_CLASS_IDS.battleship
              : SHIP_CLASS_IDS.dropShip
        )
      );
      selectedPlanetKey = null;
      commandMenuLeaderKey = pruneCommandMenuLeaderKey(
        commandMenuLeaderKey,
        selectedUnitKeys
      );
      pendingCommand = null;
      clearHoveredSelectionTarget();
      clearAttackTargeting();
      publishOverlaySnapshot();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (canControlUnits() && key === "d") {
      clearZoomToFitFocus();
      selectedUnitKeys.clear();
      selectedPlanetKey = null;
      commandMenuLeaderKey = null;
      pendingCommand = null;
      clearHoveredSelectionTarget();
      clearAttackTargeting();
      publishOverlaySnapshot();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (canControlUnits() && (key === "c" || key === "g")) {
      const issuedCommand = issuePlanetOrderFromSelection(
        runtime,
        selectedUnitKeys,
        selectedPlanetKey,
        key === "c" ? "capturePlanet" : "guardPlanet"
      );

      if (issuedCommand) {
        completeIssuedCommand(issuedCommand, { preserveSelection: true });
        event.preventDefault();
      }
      return;
    }

    if (key === "z") {
      if (startZoomToSelection(performance.now())) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (key === "t") {
      tacticalOverlayEnabled = !tacticalOverlayEnabled;
      publishOverlaySnapshot();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (key === "tab") {
      if (cycleAttackTargetFromKeyboard(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      clearZoomToFitFocus();
      cameraZoomTween.active = false;
      setCameraMode(
        cameraControls,
        cameraControls.mode === "tactical" ? "strategic" : "tactical"
      );
      event.stopPropagation();
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
      return;
    }

    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;

    event.preventDefault();

    if (event.button === 2 && canControlUnits()) {
      clearAttackTargeting();
    }

    orbitLaneDragState = beginOrbitLaneDrag(
      event,
      renderer.domElement,
      camera,
      runtime,
      selectedUnitKeys,
      planetProxies,
      scratch
    );

    cameraControls.isDragging = true;
    cameraControls.dragMode = orbitLaneDragState
      ? "orbitLane"
      : readPointerDragMode(event, canControlUnits());
    cameraControls.pointerId = event.pointerId;
    cameraControls.startPointerX = event.clientX;
    cameraControls.startPointerY = event.clientY;
    cameraControls.lastPointerX = event.clientX;
    cameraControls.lastPointerY = event.clientY;
    cameraControls.dragDistancePx = 0;
    activeSelectionMode = readSelectionMode(event);
    selectionDragStarted = false;
    clearZoomToFitFocus();
    if (orbitLaneDragState) {
      selectedPlanetKey = orbitLaneDragState.planetKey;
      pendingCommand = null;
      clearAttackTargeting();
      publishOverlaySnapshot();
    }
    if (cameraControls.dragMode === "pan") {
      previousCameraFocusContextKey =
        readCameraFocusContextKey(selectedUnitKeys);
    }
    hideSelectionBox(selectionBox);
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => {
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;

    hoveredSelectionTarget = readPointerSceneSelectionTarget(
      event,
      renderer.domElement,
      camera,
      runtime.readUnits(),
      runtime.playerId,
      runtime.readPlanets(),
      planetProxies,
      canControlUnits(),
      scratch
    );

    if (!cameraControls.isDragging || cameraControls.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - cameraControls.lastPointerX;
    const dy = event.clientY - cameraControls.lastPointerY;
    cameraControls.dragDistancePx += Math.hypot(dx, dy);
    cameraControls.lastPointerX = event.clientX;
    cameraControls.lastPointerY = event.clientY;

    if (cameraControls.dragMode === "pan") {
      cameraZoomTween.active = false;
      panCameraByScreenDelta(
        cameraControls,
        camera,
        viewport,
        dx,
        dy,
        scratch
      );
      return;
    }

    if (cameraControls.dragMode === "camera") {
      cameraZoomTween.active = false;
      if (cameraControls.preset !== null) {
        cameraControls.preset = null;
        publishOverlaySnapshot();
      }
      cameraControls.yaw -= dx * 0.006;
      cameraControls.pitch = clamp(cameraControls.pitch + dy * 0.004, 0.28, 1.38);
      return;
    }

    if (cameraControls.dragMode === "orbitLane") {
      orbitLaneDragState = updateOrbitLaneDrag(
        orbitLaneDragState,
        event,
        renderer.domElement,
        camera,
        runtime,
        selectedUnitKeys,
        scratch
      );
      return;
    }

    if (
      cameraControls.dragMode === "select" &&
      cameraControls.dragDistancePx > 5
    ) {
      if (!selectionDragStarted) {
        selectionDragStarted = true;

        if (activeSelectionMode === "replace") {
          selectedUnitKeys.clear();
          commandMenuLeaderKey = null;
          pendingCommand = null;
          clearHoveredSelectionTarget();
          clearAttackTargeting();
          publishOverlaySnapshot();
        }
      }

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
    const completedOrbitLaneDrag = orbitLaneDragState;
    cameraControls.isDragging = false;
    cameraControls.dragMode = null;
    cameraControls.pointerId = null;
    orbitLaneDragState = null;
    hideSelectionBox(selectionBox);

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (event.type !== "pointerup") {
      return;
    }

    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;

    if (dragMode === "orbitLane") {
      if (completedOrbitLaneDrag && !wasClick) {
        const issuedCommand = issuePlanetOrderFromSelection(
          runtime,
          selectedUnitKeys,
          completedOrbitLaneDrag.planetKey,
          "orbitPlanet",
          completedOrbitLaneDrag.lane
        );

        if (issuedCommand) {
          completeIssuedCommand(issuedCommand, { preserveSelection: true });
        } else {
          publishOverlaySnapshot();
        }
        return;
      }

      if (completedOrbitLaneDrag) {
        const lane =
          selectedOrbitLane?.planetKey === completedOrbitLaneDrag.planetKey
            ? selectedOrbitLane.lane
            : undefined;
        const issuedCommand = issuePlanetOrderFromSelection(
          runtime,
          selectedUnitKeys,
          completedOrbitLaneDrag.planetKey,
          "orbitPlanet",
          lane
        );

        if (issuedCommand) {
          completeIssuedCommand(issuedCommand, { preserveSelection: true });
          return;
        }
      }

      publishOverlaySnapshot();
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
        scratch,
        activeSelectionMode
      );
      commandMenuLeaderKey = pruneCommandMenuLeaderKey(
        commandMenuLeaderKey,
        selectedUnitKeys
      );

      if (selectedUnitKeys.size === 0) {
        pendingCommand = null;
        clearHoveredSelectionTarget();
        cycledAttackTargetKey = null;
      }
      publishOverlaySnapshot();
      return;
    }

    if (dragMode === "select" && wasClick) {
      const pointerTarget = readPointerSceneSelectionTarget(
        event,
        renderer.domElement,
        camera,
        runtime.readUnits(),
        runtime.playerId,
        runtime.readPlanets(),
        planetProxies,
        true,
        scratch
      );

      hoveredSelectionTarget = pointerTarget
        ? toSceneSelectionTarget(pointerTarget)
        : null;

      if (pointerTarget?.kind === "friendlyUnit") {
        if (activeSelectionMode === "remove") {
          selectedUnitKeys.delete(pointerTarget.key);
        } else if (activeSelectionMode === "replace") {
          selectedUnitKeys.clear();
          selectedUnitKeys.add(pointerTarget.key);
          selectedPlanetKey = null;
          clearAttackTargeting();
        } else {
          selectedUnitKeys.add(pointerTarget.key);
        }

        commandMenuLeaderKey = pruneCommandMenuLeaderKey(
          commandMenuLeaderKey,
          selectedUnitKeys
        );

        if (selectedUnitKeys.size === 0) {
          pendingCommand = null;
          clearHoveredSelectionTarget();
          cycledAttackTargetKey = null;
        }

        publishOverlaySnapshot();
        return;
      }

      if (pointerTarget?.kind === "enemyUnit") {
        const attackTarget = pointerTarget.unit;
        selectedPlanetKey = null;
        pendingCommand = null;
        cycledAttackTargetKey = attackTarget.key;

        if (selectedUnitKeys.size > 0) {
          const issuedCommand = issueAttackOrderFromSelection(
            runtime,
            selectedUnitKeys,
            attackTarget.key
          );

          if (issuedCommand) {
            completeIssuedCommand(issuedCommand);
            return;
          }
        }

        publishOverlaySnapshot();
        return;
      }

      if (pointerTarget?.kind === "planet") {
        const { planet: selectedPlanet } = pointerTarget;
        if (selectedUnitKeys.size > 0) {
          selectedPlanetKey = selectedPlanet.key;
          const issuedCommand = issuePlanetOrderFromSelection(
            runtime,
            selectedUnitKeys,
            selectedPlanet.key,
            "orbitPlanet"
          );

          if (issuedCommand) {
            completeIssuedCommand(issuedCommand, { preserveSelection: true });
            return;
          }
        } else {
          selectedPlanetKey =
            selectedPlanet.key === selectedPlanetKey
              ? null
              : selectedPlanet.key;
        }

        pendingCommand = null;
        publishOverlaySnapshot();
        return;
      }

      const cycledAttackTarget = readAttackTargetByKey(
        runtime.readUnits(),
        runtime.playerId,
        cycledAttackTargetKey
      );

      if (cycledAttackTarget && canControlUnits() && selectedUnitKeys.size > 0) {
        selectedPlanetKey = null;
        pendingCommand = null;

        const issuedCommand = issueAttackOrderFromSelection(
          runtime,
          selectedUnitKeys,
          cycledAttackTarget.key
        );

        if (issuedCommand) {
          completeIssuedCommand(issuedCommand);
          return;
        }

        publishOverlaySnapshot();
        return;
      }

      const issuedCommand = issueMoveCommandFromClick(
        event,
        renderer.domElement,
        camera,
        runtime,
        selectedUnitKeys,
        commandMenuLeaderKey,
        selectedPlanetKey,
        scratch
      );

      if (issuedCommand) {
        completeIssuedCommand(issuedCommand);
      }
    }
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const handlePointerLeave = () => {
    clearHoveredSelectionTarget();
    lastPointerClientX = null;
    lastPointerClientY = null;
  };
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    cameraZoomTween.active = false;
    const config = CAMERA_MODES[cameraControls.mode];
    const currentHeight = cameraControls.viewHeights[cameraControls.mode];
    const nextHeight = clamp(
      currentHeight * Math.exp(event.deltaY * 0.001),
      config.minViewHeight,
      config.maxViewHeight
    );
    cameraControls.viewHeights[cameraControls.mode] = nextHeight;
  };

  const applyViewportResize = (size?: ViewportSize): boolean => {
    const viewportChanged =
      size === undefined
        ? refreshViewportMetrics(viewport, container)
        : writeViewportMetrics(viewport, size);

    if (
      !viewportChanged &&
      isRendererBackBufferCurrent(
        renderer,
        rendererBackBuffer,
        viewport,
        activeRenderPixelRatio
      )
    ) {
      return false;
    }

    applyCameraControls(
      camera,
      cameraControls,
      viewport,
      writePannedCameraFocus(
        scratch.pannedFocus,
        writeResizeCameraFocus(
          cameraFocusTween,
          scratch.focus,
          runtime.readUnits(),
          selectedUnitKeys
        ),
        cameraControls
      ),
      scratch
    );
    return applyRendererBackBufferSize(
      renderer,
      rendererBackBuffer,
      viewport,
      activeRenderPixelRatio
    );
  };

  const applyScheduledViewportResize = () => {
    resizeFrameId = null;
    const size = pendingViewportSize ?? undefined;
    pendingViewportSize = null;
    const now = performance.now();
    const elapsed = now - lastRendererResizeAt;

    if (elapsed < RENDERER_RESIZE_MIN_INTERVAL_MS) {
      if (size) {
        pendingViewportSize = size;
      }

      if (resizeThrottleTimeoutId === null) {
        resizeThrottleTimeoutId = window.setTimeout(() => {
          resizeThrottleTimeoutId = null;
          requestViewportResize();
        }, RENDERER_RESIZE_MIN_INTERVAL_MS - elapsed);
      }
      return;
    }

    if (applyViewportResize(size)) {
      lastRendererResizeAt = now;
    }
  };

  const requestViewportResize = (size?: ViewportSize) => {
    if (disposed) {
      return;
    }

    if (size) {
      pendingViewportSize = size;
    }

    if (resizeThrottleTimeoutId !== null) {
      return;
    }

    if (resizeFrameId === null) {
      resizeFrameId = window.requestAnimationFrame(applyScheduledViewportResize);
    }
  };

  const handleObservedResize = (entries: ResizeObserverEntry[]) => {
    const entry = entries.find(({ target }) => target === container);
    const size = entry ? readResizeObserverEntrySize(entry) : undefined;

    requestViewportResize(size);
  };

  const handleWindowResize = () => {
    requestViewportResize();
  };

  const adjustRenderPixelRatio = (now: number) => {
    if (now - lastPixelRatioAdjustAt < PIXEL_RATIO_ADJUST_INTERVAL_MS) {
      return;
    }

    lastPixelRatioAdjustAt = now;

    if (
      estimatedFps >= renderQuality.lowFpsPixelRatioThreshold ||
      activeRenderPixelRatio <= renderQuality.minRenderPixelRatio
    ) {
      return;
    }

    activeRenderPixelRatio = Math.max(
      renderQuality.minRenderPixelRatio,
      Number((activeRenderPixelRatio - renderQuality.pixelRatioStep).toFixed(2))
    );
    requestViewportResize();
  };

  const advanceSimulation = (now: number, frameDeltaMs: number): number => {
    if (runtime.world.matchResult || isSinglePlayerPaused()) {
      simAccumulatorMs = 0;
      return 0;
    }

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
    pruneSelectedUnitKeys(selectedUnitKeys, units);
    commandMenuLeaderKey = pruneCommandMenuLeaderKey(
      commandMenuLeaderKey,
      selectedUnitKeys
    );
    hoveredSelectionTarget = pruneSceneSelectionTarget(
      hoveredSelectionTarget,
      units,
      planets,
      runtime.playerId
    );
    cycledAttackTargetKey = pruneAttackTargetKey(
      cycledAttackTargetKey,
      units,
      runtime.playerId
    );
    lockedAttackTargetKey = pruneAttackTargetKey(
      lockedAttackTargetKey,
      units,
      runtime.playerId
    );

    if (selectedUnitKeys.size === 0) {
      pendingCommand = null;
    }

    const selectedUnits = units.filter((unit) => selectedUnitKeys.has(unit.key));
    selectedOrbitLane =
      readSelectedOrbitLane(selectedUnits, planets) ?? selectedOrbitLane;
    const selectedPlanet = getSelectedPlanet(planets, selectedPlanetKey);
    const hoveredPlanet = getSelectedPlanet(planets, readHoveredPlanetKey());
    const focus = zoomToFitFocusEnabled
      ? scratch.focus.copy(zoomToFitFocus)
      : writeCameraFocusPosition(scratch.focus, units, selectedUnitKeys);
    const cameraFocusContextKey = zoomToFitFocusEnabled
      ? `fit:${zoomToFitContextId}`
      : readCameraFocusContextKey(selectedUnitKeys);

    if (cameraFocusContextKey !== previousCameraFocusContextKey) {
      cameraControls.panOffset.set(0, 0, 0);
      previousCameraFocusContextKey = cameraFocusContextKey;
    }

    const displayedFocus = updateCameraFocusTween(
      cameraFocusTween,
      cameraFocusContextKey,
      focus,
      now
    );
    const cameraFocus = writePannedCameraFocus(
      scratch.pannedFocus,
      displayedFocus,
      cameraControls
    );
    const sunDirection = writeSunDirection(scratch.sunDirection, runtime.world.config);
    const sunColor = writeSunColor(scratch.sunColor, runtime.world.config);
    const sunDistance = readSunDistance(runtime.world.config.environment.sun);
    const elapsedSeconds = (now - startedAt) / 1000;
    renderFrameIndex += 1;

    updatePlanetProxies(
      worldGroup,
      planetProxies,
      planets,
      renderFrameIndex,
      planetGeometry,
      planetRingGeometry,
      planetMaterial,
      planetGlowMaterial,
      planetRingMaterial,
      renderQuality
    );
    updateCameraZoomTween(cameraZoomTween, cameraControls, now);
    applyCameraControls(camera, cameraControls, viewport, cameraFocus, scratch);
    camera.updateMatrixWorld();
    const worldUnitsPerPixel = readWorldUnitsPerPixel(camera, viewport.height);

    if (commandMenuLeaderKey) {
      updateSelectedLeaderArrow(
        leaderArrow,
        units.find((unit) => unit.key === commandMenuLeaderKey) ?? null,
        camera,
        viewport,
        scratch
      );
    } else {
      hideSelectedLeaderArrow(leaderArrow);
    }

    updateAttackTargetMarkers(
      hoveredAttackTargetMarker,
      cycledAttackTargetMarker,
      lockedAttackTargetMarker,
      units,
      readHoveredAttackTargetKey(),
      cycledAttackTargetKey,
      lockedAttackTargetKey,
      camera,
      viewport,
      scratch
    );

    updateLighting(lighting, sunDirection, sunColor);
    updateUnitBatches(
      unitBatches,
      units,
      selectedUnitKeys,
      readHoveredFriendlyUnitKey(),
      planets,
      camera,
      worldUnitsPerPixel,
      interpolationAlpha
    );
    addProjectileEvents(projectileParticles, runtime.drainEvents(), now);
    updateProjectileParticles(
      projectileParticles,
      now,
      camera,
      worldUnitsPerPixel,
      renderQuality
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
    updateTacticalGrid(
      tacticalGrid,
      selectedPlanet,
      false,
      cameraControls.preset
    );
    updatePlanetScreenRings(
      selectedPlanetRing,
      hoveredPlanetRing,
      cameraControls.mode === "tactical" ? selectedPlanet : null,
      tacticalOverlayEnabled ? hoveredPlanet : null,
      runtime.world.config.players,
      camera,
      viewport,
      scratch
    );
    updatePlanetSelectionMarkers(
      selectedPlanetMarker,
      hoveredPlanetMarker,
      selectedPlanet,
      hoveredPlanet,
      selectedUnits,
      runtime.world.config.players,
      readCaptureRules(runtime.world),
      camera,
      viewport,
      scratch
    );
    updateGravityOverlay(
      gravityOverlay,
      planets,
      tacticalOverlayEnabled,
      cameraControls.preset
    );
    updateCaptureProgressRings(
      worldGroup,
      captureProgressRings,
      planets,
      runtime.world.config.players,
      readCaptureRules(runtime.world),
      renderFrameIndex,
      cameraControls.mode === "tactical" || tacticalOverlayEnabled,
      cameraControls.preset
    );
    updateOrbitLaneRings(
      worldGroup,
      orbitLaneRings,
      selectedUnits,
      planets,
      selectedOrbitLane,
      orbitLaneDragState,
      renderFrameIndex,
      tacticalOverlayEnabled || orbitLaneDragState !== null
    );
    const sunScreenPosition = updateSunFlarePass(
      sunFlarePass,
      camera,
      cameraFocus,
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
      container.dataset.cameraFocus = cameraFocusContextKey;
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
      container.dataset.selectedPlanet = selectedPlanet?.label ?? "none";
      container.dataset.tacticalOverlay = tacticalOverlayEnabled ? "on" : "off";
      container.dataset.gravityOverlay = gravityOverlay.root.visible
        ? "on"
        : "off";
      container.dataset.pendingCommand = pendingCommand ?? "none";
      container.dataset.renderMode = renderQuality.mode;
      container.dataset.simPaused = isSinglePlayerPaused() ? "on" : "off";
      container.dataset.playerId = runtime.playerId.toString();
      container.dataset.connectionState = runtime.readConnectionStatus().state;
      container.dataset.simHz = observedSimHz.toFixed(1);
      container.dataset.simInterpolationAlpha = interpolationAlpha.toFixed(3);
      publishOverlaySnapshot();
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
      publishOverlaySnapshot();
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
    if (syncNetworkStartMenu()) {
      publishOverlaySnapshot();
    }
    renderCurrentFrame(now, interpolationAlpha);
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(handleObservedResize);

  window.addEventListener("resize", handleWindowResize);
  resizeObserver?.observe(container);
  window.addEventListener("keydown", handleKeyDown, { capture: true });
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointercancel", handlePointerUp);
  renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
  renderer.domElement.addEventListener("contextmenu", handleContextMenu);
  renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
  applyCameraControls(
    camera,
    cameraControls,
    viewport,
    writePannedCameraFocus(
      scratch.pannedFocus,
      writeResizeCameraFocus(
        cameraFocusTween,
        scratch.focus,
        runtime.readUnits(),
        selectedUnitKeys
      ),
      cameraControls
    ),
    scratch
  );
  cameraControls.viewHeights[cameraControls.mode] = readZoomToFitViewHeight(
    runtime.readUnits(),
    runtime.readPlanets(),
    writeZoomToFitFocusPosition(
      scratch.focus,
      runtime.readUnits(),
      runtime.readPlanets()
    ),
    viewport,
    cameraControls.mode
  );
  applyViewportResize();
  publishOverlaySnapshot();
  renderCurrentFrame(startedAt, 1);
  frameId = requestAnimationFrame(frame);

  return {
    runtime,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
      }
      if (resizeThrottleTimeoutId !== null) {
        window.clearTimeout(resizeThrottleTimeoutId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      overlay.dispose();
      disposePlanetScreenRing(selectedPlanetRing);
      disposePlanetScreenRing(hoveredPlanetRing);
      disposeUnitBatchRenderer(unitBatches);
      disposeProjectileParticleRenderer(projectileParticles);
      disposeGravityOverlay(gravityOverlay);
      disposeCaptureProgressRings(worldGroup, captureProgressRings);
      disposeOrbitLaneRings(worldGroup, orbitLaneRings);
      disposeTacticalGrid(tacticalGrid);
      disposePlanetProxies(worldGroup, planetProxies);
      planetStatsRenderCache.dispose();
      planetGeometry.dispose();
      planetRingGeometry.dispose();
      planetMaterial.dispose();
      planetGlowMaterial?.dispose();
      planetRingMaterial.dispose();
      disposeGasGiantTextureSet(gasGiantTextures);
      renderer.dispose();
      disposeSkyDome(nebulaSkyDome);
      disposeFullscreenPass(sunFlarePass);
      runtime.dispose();
      container.replaceChildren();
    },
  };
}

function createViewportMetrics(container: HTMLElement): ViewportMetrics {
  const viewport = {
    width: 1,
    height: 1,
    aspect: 1,
  };

  refreshViewportMetrics(viewport, container);
  return viewport;
}

function createRendererBackBufferMetrics(): RendererBackBufferMetrics {
  return {
    width: 0,
    height: 0,
    pixelRatio: 0,
  };
}

function refreshViewportMetrics(
  viewport: ViewportMetrics,
  container: HTMLElement
): boolean {
  return writeViewportMetrics(viewport, {
    width: container.clientWidth,
    height: container.clientHeight,
  });
}

function writeViewportMetrics(
  viewport: ViewportMetrics,
  size: ViewportSize
): boolean {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const changed = viewport.width !== width || viewport.height !== height;

  viewport.width = width;
  viewport.height = height;
  viewport.aspect = viewport.width / Math.max(viewport.height, 1);

  return changed;
}

function readResizeObserverEntrySize(entry: ResizeObserverEntry): ViewportSize {
  const borderSize = readResizeObserverBoxSize(entry.borderBoxSize);

  if (borderSize) {
    return borderSize;
  }

  const contentSize = readResizeObserverBoxSize(entry.contentBoxSize);

  if (contentSize) {
    return contentSize;
  }

  return {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  };
}

function readResizeObserverBoxSize(
  boxSize: ReadonlyArray<ResizeObserverSize> | ResizeObserverSize | undefined
): ViewportSize | null {
  if (!boxSize) {
    return null;
  }

  const size = Array.isArray(boxSize) ? boxSize[0] : boxSize;

  if (!size) {
    return null;
  }

  return {
    width: size.inlineSize,
    height: size.blockSize,
  };
}

function isRendererBackBufferCurrent(
  renderer: THREE.WebGLRenderer,
  metrics: RendererBackBufferMetrics,
  viewport: ViewportMetrics,
  pixelRatio: number
): boolean {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const normalizedPixelRatio = Math.max(0.1, pixelRatio);

  return (
    metrics.width === width &&
    metrics.height === height &&
    metrics.pixelRatio === normalizedPixelRatio &&
    renderer.domElement.width === Math.floor(width * normalizedPixelRatio) &&
    renderer.domElement.height === Math.floor(height * normalizedPixelRatio)
  );
}

function applyRendererBackBufferSize(
  renderer: THREE.WebGLRenderer,
  metrics: RendererBackBufferMetrics,
  viewport: ViewportMetrics,
  pixelRatio: number
): boolean {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const normalizedPixelRatio = Math.max(0.1, pixelRatio);

  if (
    isRendererBackBufferCurrent(
      renderer,
      metrics,
      viewport,
      normalizedPixelRatio
    )
  ) {
    return false;
  }

  renderer.setDrawingBufferSize(width, height, normalizedPixelRatio);
  metrics.width = width;
  metrics.height = height;
  metrics.pixelRatio = normalizedPixelRatio;

  return true;
}

function createSelectedLeaderArrow(container: HTMLElement): SelectedLeaderArrow {
  const arrow = document.createElement("div");
  arrow.className = "selected-leader-arrow";
  arrow.hidden = true;
  container.appendChild(arrow);
  return {
    element: arrow,
    visible: false,
    transform: "",
  };
}

function hideSelectedLeaderArrow(arrow: SelectedLeaderArrow): void {
  if (!arrow.visible) {
    return;
  }

  arrow.element.hidden = true;
  arrow.visible = false;
  arrow.transform = "";
}

function updateSelectedLeaderArrow(
  arrow: SelectedLeaderArrow,
  leader: UnitViewModel | null,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  scratch: RenderScratch
): void {
  if (!leader) {
    hideSelectedLeaderArrow(arrow);
    return;
  }

  const projected = scratch.projected.copy(leader.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    hideSelectedLeaderArrow(arrow);
    return;
  }

  const x = (projected.x * 0.5 + 0.5) * viewport.width;
  const y = (-projected.y * 0.5 + 0.5) * viewport.height - 14;
  const transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;

  if (!arrow.visible) {
    arrow.element.hidden = false;
    arrow.visible = true;
  }

  if (arrow.transform !== transform) {
    arrow.element.style.transform = transform;
    arrow.transform = transform;
  }
}

function createAttackTargetMarker(
  container: HTMLElement,
  state: AttackTargetMarkerState
): AttackTargetMarker {
  const marker = document.createElement("div");
  marker.className = "attack-target-marker";
  marker.dataset.state = state;
  marker.hidden = true;

  const label = document.createElement("div");
  label.className = "attack-target-marker-label";
  marker.appendChild(label);
  container.appendChild(marker);

  return {
    element: marker,
    label,
    visible: false,
    transform: "",
    labelText: "",
    state,
    sizePx: 0,
  };
}

function hideAttackTargetMarker(marker: AttackTargetMarker): void {
  if (!marker.visible) {
    return;
  }

  marker.element.hidden = true;
  marker.visible = false;
  marker.transform = "";
  marker.labelText = "";
  marker.label.textContent = "";
  marker.sizePx = 0;
}

function updateAttackTargetMarkers(
  hoverMarker: AttackTargetMarker,
  cycleMarker: AttackTargetMarker,
  lockedMarker: AttackTargetMarker,
  units: readonly UnitViewModel[],
  hoveredKey: string | null,
  cycledKey: string | null,
  lockedKey: string | null,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  scratch: RenderScratch
): void {
  const lockedTarget = lockedKey
    ? units.find((unit) => unit.key === lockedKey) ?? null
    : null;
  const cycledTarget =
    cycledKey && cycledKey !== lockedKey
      ? units.find((unit) => unit.key === cycledKey) ?? null
      : null;
  const hoveredTarget =
    hoveredKey && hoveredKey !== lockedKey && hoveredKey !== cycledKey
      ? units.find((unit) => unit.key === hoveredKey) ?? null
      : null;

  updateAttackTargetMarker(
    lockedMarker,
    lockedTarget,
    camera,
    viewport,
    scratch
  );
  updateAttackTargetMarker(
    cycleMarker,
    cycledTarget,
    camera,
    viewport,
    scratch
  );
  updateAttackTargetMarker(
    hoverMarker,
    hoveredTarget,
    camera,
    viewport,
    scratch
  );
}

function updateAttackTargetMarker(
  marker: AttackTargetMarker,
  target: UnitViewModel | null,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  scratch: RenderScratch
): void {
  if (!target) {
    hideAttackTargetMarker(marker);
    return;
  }

  const projected = scratch.projected.copy(target.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    hideAttackTargetMarker(marker);
    return;
  }

  const x = (projected.x * 0.5 + 0.5) * viewport.width;
  const y = (-projected.y * 0.5 + 0.5) * viewport.height;
  const sizePx = Math.round(
    Math.max(42, UNIT_SYMBOL_SIZE_PX * readUnitSymbolScale(target) * 1.65)
  );
  const transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  const labelText = formatAttackTargetMarkerLabel(marker.state, target);

  if (!marker.visible) {
    marker.element.hidden = false;
    marker.visible = true;
  }

  if (marker.transform !== transform) {
    marker.element.style.transform = transform;
    marker.transform = transform;
  }

  if (marker.sizePx !== sizePx) {
    marker.element.style.setProperty("--target-size", `${sizePx}px`);
    marker.sizePx = sizePx;
  }

  if (marker.labelText !== labelText) {
    marker.label.textContent = labelText;
    marker.labelText = labelText;
  }
}

function formatAttackTargetMarkerLabel(
  state: AttackTargetMarkerState,
  target: UnitViewModel
): string {
  const status =
    state === "locked" ? "ATTACK" : state === "cycle" ? "TARGET" : "SCAN";
  const healthPercent = Math.max(
    0,
    Math.round((target.health.current / Math.max(target.health.max, 1)) * 100)
  );

  return `${status} ${formatShipClassLabel(target.shipClassId)} ${healthPercent}%`;
}

function formatShipClassLabel(shipClassId: number): string {
  if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    return "Drop ship";
  }

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    return "Battleship";
  }

  if (shipClassId === SHIP_CLASS_IDS.fighter) {
    return "Scout";
  }

  return "Ship";
}

function createPlanetScreenRing(
  container: HTMLElement,
  state: PlanetSelectionMarkerState
): PlanetScreenRing {
  const ring = document.createElement("div");
  ring.className = "planet-screen-ring";
  ring.dataset.state = state;
  ring.hidden = true;
  container.appendChild(ring);

  return {
    element: ring,
    visible: false,
    transform: "",
    sizePx: 0,
    accentColor: "",
    state,
  };
}

function updatePlanetScreenRings(
  selectedRing: PlanetScreenRing,
  hoverRing: PlanetScreenRing,
  selectedPlanet: PlanetViewModel | null,
  hoveredPlanet: PlanetViewModel | null,
  players: readonly PlayerConfig[],
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  scratch: RenderScratch
): void {
  updatePlanetScreenRing(
    hoverRing,
    hoveredPlanet,
    players,
    camera,
    viewport,
    PLANET_SELECTION_RADIUS_MULTIPLIER,
    scratch
  );
  updatePlanetScreenRing(
    selectedRing,
    selectedPlanet && selectedPlanet.key !== hoveredPlanet?.key
      ? selectedPlanet
      : null,
    players,
    camera,
    viewport,
    PLANET_SELECTION_INDICATOR_RADIUS_MULTIPLIER,
    scratch
  );
}

function updatePlanetScreenRing(
  ring: PlanetScreenRing,
  planet: PlanetViewModel | null,
  players: readonly PlayerConfig[],
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  radiusMultiplier: number,
  scratch: RenderScratch
): void {
  if (!planet) {
    hidePlanetScreenRing(ring);
    return;
  }

  const projected = scratch.projected.copy(planet.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    hidePlanetScreenRing(ring);
    return;
  }

  const radiusPx = readPlanetSelectionRingRadiusPx(
    planet,
    camera,
    viewport,
    radiusMultiplier
  );
  const sizePx = Math.round(radiusPx * 2);
  const x = (projected.x * 0.5 + 0.5) * viewport.width;
  const y = (-projected.y * 0.5 + 0.5) * viewport.height;
  const transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  const accentColor = readPlanetStatusColor(planet, players);

  if (!ring.visible) {
    ring.element.hidden = false;
    ring.visible = true;
  }

  if (ring.transform !== transform) {
    ring.element.style.transform = transform;
    ring.transform = transform;
  }

  if (ring.sizePx !== sizePx) {
    ring.element.style.setProperty("--planet-ring-size", `${sizePx}px`);
    ring.sizePx = sizePx;
  }

  if (ring.accentColor !== accentColor) {
    ring.element.style.setProperty("--planet-color", accentColor);
    ring.accentColor = accentColor;
  }
}

function hidePlanetScreenRing(ring: PlanetScreenRing): void {
  if (!ring.visible) {
    return;
  }

  ring.element.hidden = true;
  ring.visible = false;
  ring.transform = "";
  ring.sizePx = 0;
  ring.accentColor = "";
}

function disposePlanetScreenRing(ring: PlanetScreenRing): void {
  ring.element.remove();
}

function createPlanetSelectionMarker(
  container: HTMLElement,
  state: PlanetSelectionMarkerState
): PlanetSelectionMarker {
  const marker = document.createElement("div");
  marker.className = "planet-selection-marker";
  marker.dataset.state = state;
  marker.hidden = true;

  const title = document.createElement("div");
  title.className = "planet-selection-marker-title";
  const detail = document.createElement("div");
  detail.className = "planet-selection-marker-detail";
  marker.append(title, detail);
  container.appendChild(marker);

  return {
    element: marker,
    title,
    detail,
    visible: false,
    transform: "",
    titleText: "",
    detailText: "",
    accentColor: "",
    state,
  };
}

function updatePlanetSelectionMarkers(
  selectedMarker: PlanetSelectionMarker,
  hoverMarker: PlanetSelectionMarker,
  selectedPlanet: PlanetViewModel | null,
  hoveredPlanet: PlanetViewModel | null,
  selectedUnits: readonly UnitViewModel[],
  players: readonly PlayerConfig[],
  rules: CaptureRulesConfig,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  scratch: RenderScratch
): void {
  updatePlanetSelectionMarker(
    hoverMarker,
    hoveredPlanet,
    selectedUnits,
    players,
    rules,
    camera,
    viewport,
    PLANET_SELECTION_RADIUS_MULTIPLIER,
    scratch
  );
  updatePlanetSelectionMarker(
    selectedMarker,
    selectedPlanet && selectedPlanet.key !== hoveredPlanet?.key
      ? selectedPlanet
      : null,
    selectedUnits,
    players,
    rules,
    camera,
    viewport,
    PLANET_SELECTION_INDICATOR_RADIUS_MULTIPLIER,
    scratch
  );
}

function updatePlanetSelectionMarker(
  marker: PlanetSelectionMarker,
  planet: PlanetViewModel | null,
  selectedUnits: readonly UnitViewModel[],
  players: readonly PlayerConfig[],
  rules: CaptureRulesConfig,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  radiusMultiplier: number,
  scratch: RenderScratch
): void {
  if (!planet) {
    hidePlanetSelectionMarker(marker);
    return;
  }

  const projected = scratch.projected.copy(planet.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    hidePlanetSelectionMarker(marker);
    return;
  }

  const ringRadiusPx = readPlanetSelectionRingRadiusPx(
    planet,
    camera,
    viewport,
    radiusMultiplier
  );
  const x = (projected.x * 0.5 + 0.5) * viewport.width;
  const y =
    (-projected.y * 0.5 + 0.5) * viewport.height -
    ringRadiusPx -
    PLANET_SELECTION_LABEL_GAP_PX;
  const transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  const titleText = planet.label;
  const detailText = formatPlanetSelectionMarkerDetail(
    planet,
    selectedUnits,
    players,
    rules
  );
  const accentColor = readPlanetStatusColor(planet, players);

  if (!marker.visible) {
    marker.element.hidden = false;
    marker.visible = true;
  }

  if (marker.transform !== transform) {
    marker.element.style.transform = transform;
    marker.transform = transform;
  }

  if (marker.titleText !== titleText) {
    marker.title.textContent = titleText;
    marker.titleText = titleText;
  }

  if (marker.detailText !== detailText) {
    marker.detail.textContent = detailText;
    marker.detailText = detailText;
  }

  if (marker.accentColor !== accentColor) {
    marker.element.style.setProperty("--planet-color", accentColor);
    marker.accentColor = accentColor;
  }
}

function hidePlanetSelectionMarker(marker: PlanetSelectionMarker): void {
  if (!marker.visible) {
    return;
  }

  marker.element.hidden = true;
  marker.visible = false;
  marker.transform = "";
  marker.titleText = "";
  marker.detailText = "";
  marker.accentColor = "";
  marker.title.textContent = "";
  marker.detail.textContent = "";
}

function readPlanetSelectionRingRadiusPx(
  planet: PlanetViewModel,
  camera: THREE.Camera,
  viewport: ViewportMetrics,
  radiusMultiplier: number
): number {
  if (camera instanceof THREE.OrthographicCamera) {
    const viewHeight = Math.max(camera.top - camera.bottom, 1);

    return Math.max(
      (planet.radius * radiusMultiplier * viewport.height) / viewHeight,
      PLANET_SELECTION_MIN_RADIUS_PX
    );
  }

  return PLANET_SELECTION_MIN_RADIUS_PX;
}

function formatPlanetSelectionMarkerDetail(
  planet: PlanetViewModel,
  selectedUnits: readonly UnitViewModel[],
  players: readonly PlayerConfig[],
  rules: CaptureRulesConfig
): string {
  const parts = [formatPlanetControlMarkerLabel(planet, players)];
  const captureLabel = formatPlanetCaptureProgressMarkerLabel(
    planet,
    rules
  );
  const distanceLabel = formatPlanetSelectedShipDistance(planet, selectedUnits);

  if (captureLabel) {
    parts.push(captureLabel);
  }

  if (distanceLabel) {
    parts.push(distanceLabel);
  }

  return parts.join(" / ");
}

function formatPlanetControlMarkerLabel(
  planet: PlanetViewModel,
  players: readonly PlayerConfig[]
): string {
  if (!planet.control.capturable) {
    return "Unclaimable";
  }

  if (planet.control.owner === 0) {
    return "Neutral";
  }

  return `${formatPlayerName(
    readPlayerConfig(players, planet.control.owner),
    planet.control.owner
  )} control`;
}

function formatPlanetCaptureProgressMarkerLabel(
  planet: PlanetViewModel,
  rules: CaptureRulesConfig
): string | null {
  if (planet.control.capturingPlayer === 0) {
    return null;
  }

  const requiredTicks = rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ;
  const capturePercent = Math.round(
    clamp(planet.control.captureTicks / Math.max(requiredTicks, 1), 0, 1) * 100
  );
  const action = planet.control.contested ? "stalled" : "capture";

  return `P${planet.control.capturingPlayer} ${action} ${capturePercent}%`;
}

function formatPlanetSelectedShipDistance(
  planet: PlanetViewModel,
  selectedUnits: readonly UnitViewModel[]
): string | null {
  if (selectedUnits.length === 0) {
    return null;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  let maxDistance = 0;

  for (const unit of selectedUnits) {
    const distance = Math.max(
      0,
      unit.position.distanceTo(planet.position) - planet.radius
    );
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
  }

  if (!Number.isFinite(minDistance)) {
    return null;
  }

  if (maxDistance - minDistance < 5) {
    return `Distance ${formatWorldDistance(minDistance)}`;
  }

  return `Distance ${formatWorldDistance(minDistance)}-${formatWorldDistance(
    maxDistance
  )}`;
}

function formatWorldDistance(distance: number): string {
  if (distance >= 1_000) {
    return `${(distance / 1_000).toFixed(1)}ku`;
  }

  return `${Math.round(distance)}u`;
}

function updateRenderModeQuery(renderMode: RenderQualityMode): void {
  const url = new URL(window.location.href);
  url.searchParams.set("render", renderMode);
  url.searchParams.delete("renderMode");
  url.searchParams.delete("quality");
  window.history.replaceState(window.history.state, "", url);
}

function readPendingStatusText(
  status: RuntimeConnectionStatus,
  isLocalPaused: boolean
): string {
  if (status.mode === "local") {
    return isLocalPaused ? "Paused" : "";
  }

  if (status.running) {
    return "";
  }

  return readWaitingForPlayerText(status);
}

function readPauseMenuMessage(status: RuntimeConnectionStatus): string {
  if (status.mode === "local") {
    return "";
  }

  if (status.running) {
    return "";
  }

  return readWaitingForPlayerText(status);
}

function readWaitingForPlayerText(status: RuntimeConnectionStatus): string {
  if (status.state === "connecting") {
    return status.serverTick === undefined ? "Connecting..." : "Reconnecting...";
  }

  if (status.state === "closed" || status.state === "error") {
    return "Reconnecting...";
  }

  const missingPlayers =
    status.players?.filter((player) => !player.connected) ?? [];

  if (missingPlayers.length === 0) {
    const waitingForReadyPlayers =
      status.players?.filter((player) => !player.ready) ?? [];

    if (waitingForReadyPlayers.length > 0) {
      const currentPlayerReady = isCurrentPlayerReady(status);

      if (!currentPlayerReady && status.canControl) {
        return "Press Ready when loaded.";
      }

      if (waitingForReadyPlayers.length === 1) {
        return `Ready. Waiting for player ${waitingForReadyPlayers[0].playerId}...`;
      }

      return "Waiting for players to ready...";
    }

    if (status.players && status.players.length > 0) {
      return "Starting...";
    }

    if (status.role === "player1") {
      return "Player 2 has not connected yet.";
    }

    if (status.role === "player2") {
      return "Player 1 has not connected yet.";
    }

    return status.state === "connecting" ? "Connecting..." : "Waiting...";
  }

  if (missingPlayers.length === 1) {
    return `Player ${missingPlayers[0].playerId} has not connected yet.`;
  }

  return "Players have not connected yet.";
}

function isCurrentPlayerReady(status: RuntimeConnectionStatus): boolean {
  if (status.role === "spectator") {
    return false;
  }

  const playerId: PlayerId = status.role === "player2" ? 2 : 1;
  return (
    status.players?.find((player) => player.playerId === playerId)?.ready ??
    false
  );
}

function createRenderScratch(): RenderScratch {
  return {
    focus: new THREE.Vector3(),
    pannedFocus: new THREE.Vector3(),
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
    cameraRight: new THREE.Vector3(1, 0, 0),
    cameraUp: new THREE.Vector3(0, 1, 0),
    cameraForward: new THREE.Vector3(0, 0, 1),
    screenPosition: new THREE.Vector2(),
    sunScreenPosition: new THREE.Vector4(),
    orbitDragPoint: new THREE.Vector3(),
    orbitDragVector: new THREE.Vector3(),
    orbitDragTangent: new THREE.Vector3(),
    orbitDragAxis: new THREE.Vector3(),
    orbitHeading: new THREE.Vector3(),
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
  selectedUnitKeys: ReadonlySet<string>
): THREE.Vector3 {
  if (tween.initialized) {
    return target.copy(tween.current);
  }

  return writeCameraFocusPosition(target, units, selectedUnitKeys);
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

function writePannedCameraFocus(
  target: THREE.Vector3,
  focus: THREE.Vector3,
  cameraControls: CameraControls
): THREE.Vector3 {
  return target.copy(focus).add(cameraControls.panOffset);
}

function panCameraByScreenDelta(
  cameraControls: CameraControls,
  camera: THREE.OrthographicCamera,
  viewport: ViewportMetrics,
  dx: number,
  dy: number,
  scratch: RenderScratch
): void {
  const worldUnitsPerPixel =
    cameraControls.viewHeights[cameraControls.mode] /
    Math.max(viewport.height, 1);
  const screenRight = writeCameraPanAxis(
    scratch.cameraRight,
    camera,
    0,
    Math.cos(cameraControls.yaw),
    -Math.sin(cameraControls.yaw)
  );
  const screenUp = writeCameraPanAxis(
    scratch.cameraUp,
    camera,
    1,
    Math.sin(cameraControls.yaw),
    Math.cos(cameraControls.yaw)
  );

  cameraControls.panOffset
    .addScaledVector(screenRight, -dx * worldUnitsPerPixel)
    .addScaledVector(screenUp, dy * worldUnitsPerPixel);
}

function writeCameraPanAxis(
  target: THREE.Vector3,
  camera: THREE.OrthographicCamera,
  column: number,
  fallbackX: number,
  fallbackZ: number
): THREE.Vector3 {
  target.setFromMatrixColumn(camera.matrixWorld, column);
  target.y = 0;

  if (target.lengthSq() <= 0.000001) {
    target.set(fallbackX, 0, fallbackZ);
  }

  return target.normalize();
}

function applyCameraControls(
  camera: THREE.OrthographicCamera,
  cameraControls: CameraControls,
  viewport: ViewportMetrics,
  focus: THREE.Vector3,
  scratch: RenderScratch
): void {
  const viewHeight = cameraControls.viewHeights[cameraControls.mode];
  const halfHeight = viewHeight / 2;
  const halfWidth = halfHeight * viewport.aspect;
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

function updateCameraZoomTween(
  tween: CameraZoomTween,
  cameraControls: CameraControls,
  now: number
): void {
  if (!tween.active || tween.mode !== cameraControls.mode) {
    return;
  }

  const progress = clamp((now - tween.startAt) / CAMERA_ZOOM_TWEEN_MS, 0, 1);
  const eased = smoothstep(0, 1, progress);

  cameraControls.viewHeights[tween.mode] =
    tween.from + (tween.to - tween.from) * eased;

  if (progress >= 1) {
    tween.active = false;
    cameraControls.viewHeights[tween.mode] = tween.to;
  }
}

function readZoomToFitViewHeight(
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  focus: THREE.Vector3,
  viewport: ViewportMetrics,
  mode: CameraControls["mode"]
): number {
  let halfWidth = 0;
  let halfHeight = 0;

  for (const unit of units) {
    halfWidth = Math.max(halfWidth, Math.abs(unit.position.x - focus.x) + 12);
    halfHeight = Math.max(halfHeight, Math.abs(unit.position.z - focus.z) + 12);
  }

  for (const planet of planets) {
    const fitRadius = planet.radius * PLANET_BODY_BILLBOARD_SCALE;
    halfWidth = Math.max(
      halfWidth,
      Math.abs(planet.position.x - focus.x) + fitRadius
    );
    halfHeight = Math.max(
      halfHeight,
      Math.abs(planet.position.z - focus.z) + fitRadius
    );
  }

  const fitHeight = Math.max(halfHeight, halfWidth / Math.max(viewport.aspect, 0.1)) *
    2 *
    CAMERA_ZOOM_TO_FIT_PADDING;

  return clamp(
    fitHeight,
    CAMERA_MODES[mode].minViewHeight,
    CAMERA_MODES[mode].maxViewHeight
  );
}

function writeZoomToFitFocusPosition(
  target: THREE.Vector3,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[]
): THREE.Vector3 {
  if (units.length === 0 && planets.length === 0) {
    return target.set(0, 0, 0);
  }

  target.set(0, 0, 0);

  for (const unit of units) {
    target.add(unit.position);
  }

  for (const planet of planets) {
    target.add(planet.position);
  }

  return target.multiplyScalar(1 / (units.length + planets.length));
}

function writeCameraFocusPosition(
  target: THREE.Vector3,
  units: readonly UnitViewModel[],
  selectedUnitKeys: ReadonlySet<string>
): THREE.Vector3 {
  const selectedUnits = units.filter((unit) => selectedUnitKeys.has(unit.key));

  return writeUnitCentroidFocus(
    target,
    selectedUnits.length > 0 ? selectedUnits : units
  );
}

function getCurrentPlanetaryContext(
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null
): PlanetViewModel | null {
  const selected = getSelectedPlanet(planets, selectedPlanetKey);

  if (selected) {
    return selected;
  }

  return planets.find((planet) => planet.label === "Aurora") ?? planets[0] ?? null;
}

function getSelectedPlanet(
  planets: readonly PlanetViewModel[],
  selectedPlanetKey: string | null
): PlanetViewModel | null {
  return selectedPlanetKey
    ? planets.find((planet) => planet.key === selectedPlanetKey) ?? null
    : null;
}

function readSelectedOrbitLane(
  selectedUnits: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[]
): SelectedOrbitLane | null {
  for (const unit of selectedUnits) {
    const order = unit.moveOrder;

    if (order?.type !== "orbitPlanet" || !order.lane) {
      continue;
    }

    const planet =
      planets.find((entry) => entry.key === handleKey(order.planet)) ?? null;

    if (!planet) {
      continue;
    }

    return {
      planetKey: planet.key,
      lane: order.lane,
    };
  }

  return null;
}

function readSelectedStatsUnit(
  selectedUnits: readonly UnitViewModel[],
  leaderKey: string | null
): UnitViewModel | null {
  if (selectedUnits.length === 0) {
    return null;
  }

  return (
    selectedUnits.find((unit) => unit.key === leaderKey) ??
    selectedUnits
      .slice()
      .sort((first, second) => first.handle.id - second.handle.id)[0] ??
    null
  );
}

function createSelectedUnitObjectiveSnapshot(
  unit: UnitViewModel,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[]
): SelectedUnitObjectiveSnapshot {
  const queuedDetail = formatSelectedUnitQueuedOrders(unit);
  const order = unit.moveOrder;

  if (!order) {
    if (unit.orbit.isOrbiting && unit.orbit.planet) {
      const planet =
        planets.find((entry) => entry.key === handleKey(unit.orbit.planet!)) ??
        null;

      return {
        orderLabel: "Holding orbit",
        targetLabel: planet?.label ?? "Current orbit",
        distanceLabel: "In orbit",
        detailLabel: queuedDetail,
        state: "idle",
      };
    }

    return {
      orderLabel: "Idle",
      targetLabel: "No active objective",
      distanceLabel: "Ready",
      detailLabel: queuedDetail,
      state: "idle",
    };
  }

  switch (order.type) {
    case "moveTo":
      return {
        orderLabel: "Move",
        targetLabel: "Waypoint",
        distanceLabel: formatWorldDistance(
          readDistanceToVec3Data(unit.position, order.target)
        ),
        detailLabel: queuedDetail,
        state: "move",
      };
    case "attackTarget":
      return createSelectedUnitTargetObjectiveSnapshot(
        unit,
        units.find((entry) => entry.key === handleKey(order.target)) ?? null,
        "Attack",
        "Target unavailable",
        "Target no longer available",
        queuedDetail,
        "attack"
      );
    case "escort":
      return createSelectedUnitTargetObjectiveSnapshot(
        unit,
        units.find((entry) => entry.key === handleKey(order.target)) ?? null,
        "Escort",
        "Escort target unavailable",
        "Escort target no longer available",
        queuedDetail,
        "escort"
      );
    case "capturePlanet":
      return createSelectedUnitPlanetObjectiveSnapshot(
        unit,
        planets.find((planet) => planet.key === handleKey(order.planet)) ?? null,
        "Capture",
        "Capture planet unavailable",
        "Planet no longer available",
        queuedDetail
      );
    case "guardPlanet":
      return createSelectedUnitPlanetObjectiveSnapshot(
        unit,
        planets.find((planet) => planet.key === handleKey(order.planet)) ?? null,
        "Guard",
        "Guard planet unavailable",
        "Planet no longer available",
        queuedDetail
      );
    case "orbitPlanet":
      return createSelectedUnitPlanetObjectiveSnapshot(
        unit,
        planets.find((planet) => planet.key === handleKey(order.planet)) ?? null,
        "Orbit",
        "Orbit planet unavailable",
        "Planet no longer available",
        queuedDetail
      );
  }
}

function createSelectedUnitTargetObjectiveSnapshot(
  unit: UnitViewModel,
  target: UnitViewModel | null,
  orderLabel: string,
  missingTargetLabel: string,
  missingDetail: string,
  queuedDetail: string,
  state: "attack" | "escort"
): SelectedUnitObjectiveSnapshot {
  if (!target) {
    return {
      orderLabel,
      targetLabel: missingTargetLabel,
      distanceLabel: "Unknown",
      detailLabel: joinSelectedUnitObjectiveDetails(missingDetail, queuedDetail),
      state,
    };
  }

  return {
    orderLabel,
    targetLabel: `${target.label} #${target.handle.id}`,
    distanceLabel: formatWorldDistance(unit.position.distanceTo(target.position)),
    detailLabel: queuedDetail,
    state,
  };
}

function createSelectedUnitPlanetObjectiveSnapshot(
  unit: UnitViewModel,
  planet: PlanetViewModel | null,
  orderLabel: string,
  missingTargetLabel: string,
  missingDetail: string,
  queuedDetail: string
): SelectedUnitObjectiveSnapshot {
  if (!planet) {
    return {
      orderLabel,
      targetLabel: missingTargetLabel,
      distanceLabel: "Unknown",
      detailLabel: joinSelectedUnitObjectiveDetails(missingDetail, queuedDetail),
      state: "planet",
    };
  }

  return {
    orderLabel,
    targetLabel: planet.label,
    distanceLabel: formatWorldDistance(
      Math.max(0, unit.position.distanceTo(planet.position) - planet.radius)
    ),
    detailLabel: queuedDetail,
    state: "planet",
  };
}

function formatSelectedUnitQueuedOrders(unit: UnitViewModel): string {
  if (unit.queuedOrderCount <= 0) {
    return "";
  }

  return `${unit.queuedOrderCount} queued order${
    unit.queuedOrderCount === 1 ? "" : "s"
  }`;
}

function joinSelectedUnitObjectiveDetails(
  first: string,
  second: string
): string {
  return [first, second].filter((part) => part.length > 0).join(" / ");
}

function readDistanceToVec3Data(position: THREE.Vector3, target: Vec3Data): number {
  return Math.hypot(
    position.x - target.x,
    position.y - target.y,
    position.z - target.z
  );
}

function createSelectedPlanetStatsSnapshot(
  planet: PlanetViewModel,
  imageUrl: string,
  players: readonly PlayerConfig[],
  rules: CaptureRulesConfig
): SelectedPlanetStatsSnapshot {
  const owner = readPlayerConfig(players, planet.control.owner);
  const controlColor = owner?.color ?? "#d6dae8";
  const capturingPlayer = readPlayerConfig(
    players,
    planet.control.capturingPlayer
  );
  const requiredTicks = rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ;
  const captureProgress =
    planet.control.capturingPlayer === 0
      ? null
      : clamp(planet.control.captureTicks / Math.max(requiredTicks, 1), 0, 1);
  const capturePercent =
    captureProgress === null ? 0 : Math.round(captureProgress * 100);

  return {
    planet,
    imageUrl,
    controlLabel: formatSelectedPlanetControlLabel(planet, owner),
    controlColor,
    captureLabel:
      captureProgress === null
        ? planet.control.contested
          ? "Contested"
          : "Idle"
        : planet.control.contested
          ? `Capture stalled: ${formatPlayerName(
              capturingPlayer,
              planet.control.capturingPlayer
            )} ${capturePercent}%`
          : `${formatPlayerName(
              capturingPlayer,
              planet.control.capturingPlayer
            )} capture ${capturePercent}%`,
    captureColor: capturingPlayer?.color ?? controlColor,
    captureProgress,
  };
}

function formatSelectedPlanetControlLabel(
  planet: PlanetViewModel,
  owner: PlayerConfig | null
): string {
  if (!planet.control.capturable) {
    return "Unclaimable";
  }

  if (!owner) {
    return "Neutral";
  }

  return `Controlled by ${owner.name}`;
}

function formatPlayerName(
  player: PlayerConfig | null,
  playerId: PlayerId | 0
): string {
  return player?.name ?? (playerId === 0 ? "Neutral" : `Player ${playerId}`);
}

function readPlayerConfig(
  players: readonly PlayerConfig[],
  playerId: PlayerId | 0
): PlayerConfig | null {
  return players.find((player) => player.id === playerId) ?? null;
}

function readCameraFocusContextKey(
  selectedUnitKeys: ReadonlySet<string>
): string {
  return selectedUnitKeys.size > 0
    ? `units:${[...selectedUnitKeys].sort().join(",")}`
    : "units:all";
}

function writeUnitCentroidFocus(
  target: THREE.Vector3,
  units: readonly UnitViewModel[]
): THREE.Vector3 {
  if (units.length === 0) {
    return target.set(0, 0, 0);
  }

  target.set(0, 0, 0);

  for (const unit of units) {
    target.add(unit.position);
  }

  return target.multiplyScalar(1 / units.length);
}

function issueMoveCommandFromClick(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  leaderKey: string | null,
  selectedPlanetKey: string | null,
  scratch: RenderScratch
): IssuedUnitCommand | null {
  const units = runtime.readUnits();
  const moveUnits = selectMoveOrderUnits(
    units,
    runtime.playerId,
    selectedUnitKeys,
    leaderKey
  );

  if (moveUnits.length === 0) {
    return null;
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
    return null;
  }

  runtime.enqueueMoveUnits(
    moveUnits.map((unit) => unit.handle),
    toVec3Data(target)
  );
  return {
    label: "Move",
    units: moveUnits,
  };
}

function issuePlanetOrderFromSelection(
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  selectedPlanetKey: string | null,
  orderType: "capturePlanet" | "guardPlanet" | "orbitPlanet",
  lane?: OrbitLaneSpec
): IssuedUnitCommand | null {
  if (!selectedPlanetKey || selectedUnitKeys.size === 0) {
    return null;
  }

  const planet = runtime
    .readPlanets()
    .find((entry) => entry.key === selectedPlanetKey);

  if (!planet) {
    return null;
  }

  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );

  if (selectedUnits.length === 0) {
    return null;
  }

  runtime.enqueueUnitOrder(
    selectedUnits.map((unit) => unit.handle),
    orderType === "orbitPlanet" && lane
      ? {
          type: orderType,
          planet: planet.handle,
          lane,
        }
      : {
          type: orderType,
          planet: planet.handle,
        }
  );
  return {
    label: `${formatPlanetOrderLabel(orderType)} ${planet.label}`,
    units: selectedUnits,
    orbitLaneSelection:
      orderType === "orbitPlanet" && lane
        ? {
            planetKey: planet.key,
            lane,
          }
        : undefined,
  };
}

function issueAttackOrderFromSelection(
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  targetKey: string
): IssuedUnitCommand | null {
  if (selectedUnitKeys.size === 0) {
    return null;
  }

  const units = runtime.readUnits();
  const target = units.find(
    (unit) =>
      unit.key === targetKey &&
      unit.owner !== runtime.playerId &&
      unit.health.current > 0
  );

  if (!target) {
    return null;
  }

  const selectedUnits = units.filter(
    (unit) =>
      unit.owner === runtime.playerId &&
      selectedUnitKeys.has(unit.key) &&
      unit.health.current > 0
  );

  if (selectedUnits.length === 0) {
    return null;
  }

  runtime.enqueueUnitOrder(
    selectedUnits.map((unit) => unit.handle),
    {
      type: "attackTarget",
      target: target.handle,
    }
  );
  return {
    label: `Attack ${target.label} #${target.handle.id}`,
    units: selectedUnits,
    attackTargetKey: target.key,
  };
}

function issueEscortLeaderOrder(
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  leaderKey: string | null
): IssuedUnitCommand | null {
  if (!leaderKey || selectedUnitKeys.size < 2) {
    return null;
  }

  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );
  const leader = selectedUnits.find((unit) => unit.key === leaderKey);

  if (!leader) {
    return null;
  }

  const escortUnits = selectedUnits.filter((unit) => unit.key !== leader.key);

  if (escortUnits.length === 0) {
    return null;
  }

  runtime.enqueueUnitOrder(
    escortUnits.map((unit) => unit.handle),
    {
      type: "escort",
      target: leader.handle,
    }
  );
  return {
    label: `Escort ${leader.label} #${leader.handle.id}`,
    units: escortUnits,
  };
}

function formatPlanetOrderLabel(
  orderType: "capturePlanet" | "guardPlanet" | "orbitPlanet"
): string {
  if (orderType === "capturePlanet") {
    return "Capture";
  }

  if (orderType === "guardPlanet") {
    return "Guard";
  }

  return "Orbit";
}

function formatCommandHistoryUnits(units: readonly UnitViewModel[]): string {
  if (units.length === 1) {
    const unit = units[0];

    return `${unit.label} #${unit.handle.id}`;
  }

  const counts = [
    [SHIP_CLASS_IDS.fighter, "Scout", "Scouts"],
    [SHIP_CLASS_IDS.dropShip, "Drop ship", "Drop ships"],
    [SHIP_CLASS_IDS.battleship, "Battleship", "Battleships"],
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

function beginOrbitLaneDrag(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  proxies: ReadonlyMap<string, PlanetProxy>,
  scratch: RenderScratch
): OrbitLaneDragState | null {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    selectedUnitKeys.size === 0 ||
    !runtime.readConnectionStatus().canControl
  ) {
    return null;
  }

  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );

  if (selectedUnits.length === 0) {
    return null;
  }

  const hit = readPlanetSurfaceHitAtPointer(
    event,
    canvas,
    camera,
    runtime.readPlanets(),
    proxies,
    scratch
  );

  if (!hit) {
    return null;
  }

  const anchorNormal = hit.point.clone().sub(hit.planet.position);

  if (anchorNormal.lengthSq() <= 0.000001) {
    return null;
  }

  anchorNormal.normalize();

  const state: OrbitLaneDragState = {
    planetKey: hit.planet.key,
    anchorPoint: hit.planet.position
      .clone()
      .addScaledVector(anchorNormal, hit.planet.radius),
    anchorNormal,
    lane: {
      radius: hit.planet.radius * 2.7,
      axis: toVec3Data(hit.planet.orbitAxis),
      direction: 1,
    },
  };

  return updateOrbitLaneDrag(
    state,
    event,
    canvas,
    camera,
    runtime,
    selectedUnitKeys,
    scratch
  );
}

function updateOrbitLaneDrag(
  state: OrbitLaneDragState | null,
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  scratch: RenderScratch
): OrbitLaneDragState | null {
  if (!state) {
    return null;
  }

  const planet =
    runtime.readPlanets().find((entry) => entry.key === state.planetKey) ??
    null;

  if (!planet) {
    return null;
  }

  const lane = createOrbitLaneSpecFromDrag(
    state,
    event,
    canvas,
    camera,
    planet,
    runtime.readUnits().filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    ),
    scratch
  );

  if (lane) {
    state.lane = lane;
  }

  return state;
}

function createOrbitLaneSpecFromDrag(
  state: OrbitLaneDragState,
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  planet: PlanetViewModel,
  selectedUnits: readonly UnitViewModel[],
  scratch: RenderScratch
): OrbitLaneSpec | null {
  const planeTarget = readPointerOrbitDragPlaneTarget(
    event,
    canvas,
    camera,
    state,
    scratch
  );

  if (!planeTarget) {
    return null;
  }

  const dragVector = scratch.orbitDragVector
    .copy(planeTarget)
    .sub(state.anchorPoint);
  const tangent = scratch.orbitDragTangent
    .copy(dragVector)
    .addScaledVector(state.anchorNormal, -dragVector.dot(state.anchorNormal));
  const heading = writeAverageSelectedHeading(
    scratch.orbitHeading,
    selectedUnits
  );
  const tangentLength = tangent.length();

  if (tangentLength <= ORBIT_LANE_DRAG_MIN_WORLD_UNITS) {
    tangent
      .copy(heading)
      .addScaledVector(state.anchorNormal, -heading.dot(state.anchorNormal));

    if (tangent.lengthSq() <= 0.000001) {
      writeFallbackTangent(tangent, state.anchorNormal);
    }
  }

  if (tangent.lengthSq() <= 0.000001) {
    return null;
  }

  tangent.normalize();

  const axis = scratch.orbitDragAxis
    .crossVectors(state.anchorNormal, tangent);

  if (axis.lengthSq() <= 0.000001) {
    return null;
  }

  axis.normalize();

  const orbitTangent = scratch.orbitDragVector
    .crossVectors(axis, state.anchorNormal)
    .normalize();
  const projectedHeading = heading.addScaledVector(
    axis,
    -heading.dot(axis)
  );
  const direction: -1 | 1 =
    projectedHeading.lengthSq() <= 0.000001 ||
    orbitTangent.dot(projectedHeading) >= 0
      ? 1
      : -1;
  const radius = clamp(
    planet.radius + Math.max(tangentLength, 0),
    planet.radius * ORBIT_LANE_MIN_RADIUS_MULTIPLIER,
    planet.radius * ORBIT_LANE_MAX_RADIUS_MULTIPLIER
  );

  return {
    radius,
    axis: toVec3Data(axis),
    direction,
  };
}

function readPointerOrbitDragPlaneTarget(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  state: OrbitLaneDragState,
  scratch: RenderScratch
): THREE.Vector3 | null {
  writePointerRay(event, canvas, camera, scratch);
  scratch.tacticalPlane.set(
    state.anchorNormal,
    -state.anchorNormal.dot(state.anchorPoint)
  );

  return scratch.raycaster.ray.intersectPlane(
    scratch.tacticalPlane,
    scratch.orbitDragPoint
  )
    ? scratch.orbitDragPoint
    : null;
}

function readPlanetSurfaceHitAtPointer(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  planets: readonly PlanetViewModel[],
  proxies: ReadonlyMap<string, PlanetProxy>,
  scratch: RenderScratch
): { planet: PlanetViewModel; point: THREE.Vector3 } | null {
  writePointerRay(event, canvas, camera, scratch);

  let bestPlanet: PlanetViewModel | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const bestPoint = new THREE.Vector3();

  for (const planet of planets) {
    scratch.tacticalPlaneNormal.copy(planet.position);
    const surfaceRadius = planet.radius * PLANET_BODY_BILLBOARD_SCALE * 0.5;
    const hit = scratch.raycaster.ray.intersectSphere(
      new THREE.Sphere(scratch.tacticalPlaneNormal, surfaceRadius),
      scratch.rayTarget
    );

    if (!hit) {
      continue;
    }

    const distance = camera.position.distanceTo(hit);

    if (distance < bestDistance) {
      bestPlanet = planet;
      bestDistance = distance;
      bestPoint.copy(hit);
    }
  }

  if (bestPlanet) {
    return {
      planet: bestPlanet,
      point: bestPoint,
    };
  }

  const fallbackPlanet = findPlanetAtPointer(
    event,
    canvas,
    camera,
    planets,
    proxies,
    scratch
  );

  if (!fallbackPlanet) {
    return null;
  }

  return {
    planet: fallbackPlanet,
    point: bestPoint.copy(fallbackPlanet.position).add(Y_AXIS),
  };
}

function writePointerRay(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  scratch: RenderScratch
): void {
  const bounds = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
  const y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1);

  scratch.pointer.set(x, y);
  scratch.raycaster.setFromCamera(scratch.pointer, camera);
}

function writeAverageSelectedHeading(
  target: THREE.Vector3,
  selectedUnits: readonly UnitViewModel[]
): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;

  for (const unit of selectedUnits) {
    const velocityX = unit.position.x - unit.prevPosition.x;
    const velocityY = unit.position.y - unit.prevPosition.y;
    const velocityZ = unit.position.z - unit.prevPosition.z;

    if (
      velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ >
      0.000001
    ) {
      x += velocityX;
      y += velocityY;
      z += velocityZ;
      continue;
    }

    x +=
      2 * (unit.rotation.x * unit.rotation.z + unit.rotation.w * unit.rotation.y);
    y +=
      2 * (unit.rotation.y * unit.rotation.z - unit.rotation.w * unit.rotation.x);
    z +=
      1 - 2 * (unit.rotation.x * unit.rotation.x + unit.rotation.y * unit.rotation.y);
  }

  target.set(x, y, z);

  if (target.lengthSq() > 0.000001) {
    target.normalize();
  }

  return target;
}

function writeFallbackTangent(
  target: THREE.Vector3,
  normal: THREE.Vector3
): THREE.Vector3 {
  const reference = Math.abs(normal.y) < 0.9 ? Y_AXIS : X_AXIS;

  return target.crossVectors(normal, reference).normalize();
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
  proxies: ReadonlyMap<string, PlanetProxy>,
  scratch: RenderScratch
): PlanetViewModel | null {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  const normalizedX =
    ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
  const normalizedY =
    -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1);
  const viewHeight = Math.max(camera.top - camera.bottom, 1);
  const pointerX = event.clientX - bounds.left;
  const pointerY = event.clientY - bounds.top;
  let closestVisualHit: PlanetViewModel | null = null;
  let closestVisualDistance = Number.POSITIVE_INFINITY;
  let bestPlanet: PlanetViewModel | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  scratch.pointer.set(normalizedX, normalizedY);
  scratch.raycaster.setFromCamera(scratch.pointer, camera);

  for (const planet of planets) {
    const proxy = proxies.get(planet.key);

    if (proxy) {
      proxy.body.updateMatrixWorld();

      for (const hit of scratch.raycaster.intersectObject(proxy.body, false)) {
        if (
          hit.uv &&
          Math.hypot(hit.uv.x - 0.5, hit.uv.y - 0.5) > 0.5
        ) {
          continue;
        }

        if (hit.distance < closestVisualDistance) {
          closestVisualHit = planet;
          closestVisualDistance = hit.distance;
        }
      }
    }

    const projected = scratch.projected.copy(planet.position).project(camera);

    if (projected.z < -1 || projected.z > 1) {
      continue;
    }

    const screenX = (projected.x * 0.5 + 0.5) * bounds.width;
    const screenY = (-projected.y * 0.5 + 0.5) * bounds.height;
    const screenRadius = Math.max(
      (planet.radius * PLANET_SELECTION_RADIUS_MULTIPLIER * bounds.height) /
        viewHeight,
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

  return closestVisualHit ?? bestPlanet;
}

function readPointerSceneSelectionTarget(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  planets: readonly PlanetViewModel[],
  proxies: ReadonlyMap<string, PlanetProxy>,
  includeUnits: boolean,
  scratch: RenderScratch
): ScreenSceneSelectionCandidate | null {
  return selectPrimarySceneSelectionCandidate(
    collectPointerSceneSelectionCandidates(
      event,
      canvas,
      camera,
      units,
      playerId,
      planets,
      proxies,
      includeUnits,
      scratch
    )
  );
}

function collectPointerSceneSelectionCandidates(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  planets: readonly PlanetViewModel[],
  proxies: ReadonlyMap<string, PlanetProxy>,
  includeUnits: boolean,
  scratch: RenderScratch
): readonly ScreenSceneSelectionCandidate[] {
  const candidates: ScreenSceneSelectionCandidate[] = [];

  if (includeUnits) {
    candidates.push(
      ...collectUnitSceneSelectionCandidates(
        "friendlyUnit",
        units,
        (unit) => unit.owner === playerId,
        camera,
        canvas,
        event.clientX,
        event.clientY,
        scratch,
        FRIENDLY_UNIT_HOVER_RADIUS_MULTIPLIER,
        FRIENDLY_UNIT_PICK_MIN_RADIUS_PX
      ),
      ...collectUnitSceneSelectionCandidates(
        "enemyUnit",
        units,
        (unit) => unit.owner !== playerId && unit.health.current > 0,
        camera,
        canvas,
        event.clientX,
        event.clientY,
        scratch,
        ATTACK_TARGET_HOVER_RADIUS_MULTIPLIER,
        ATTACK_TARGET_PICK_MIN_RADIUS_PX
      )
    );
  }

  const planetCandidate = readPlanetSceneSelectionCandidate(
    event,
    canvas,
    camera,
    planets,
    proxies,
    scratch
  );

  if (planetCandidate) {
    candidates.push(planetCandidate);
  }

  return candidates;
}

function collectUnitSceneSelectionCandidates(
  kind: "friendlyUnit" | "enemyUnit",
  units: readonly UnitViewModel[],
  includeUnit: (unit: UnitViewModel) => boolean,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  scratch: RenderScratch,
  radiusMultiplier: number,
  minRadiusPx: number
): readonly ScreenSceneSelectionCandidate[] {
  const bounds = canvas.getBoundingClientRect();
  const pointerX = clientX - bounds.left;
  const pointerY = clientY - bounds.top;
  const candidates: ScreenSceneSelectionCandidate[] = [];

  for (const unit of units) {
    if (!includeUnit(unit)) {
      continue;
    }

    const projected = scratch.projected.copy(unit.position).project(camera);

    if (projected.z < -1 || projected.z > 1) {
      continue;
    }

    const screenX = (projected.x * 0.5 + 0.5) * bounds.width;
    const screenY = (-projected.y * 0.5 + 0.5) * bounds.height;
    const screenRadius = Math.max(
      UNIT_SYMBOL_SIZE_PX * readUnitSymbolScale(unit) * radiusMultiplier,
      minRadiusPx
    );
    const screenDistance = Math.hypot(pointerX - screenX, pointerY - screenY);

    if (screenDistance > screenRadius) {
      continue;
    }

    candidates.push({
      kind,
      key: unit.key,
      screenDistancePx: screenDistance,
      screenScore: screenDistance / screenRadius,
      handleId: unit.handle.id,
      unit,
    });
  }

  return candidates;
}

function readPlanetSceneSelectionCandidate(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  planets: readonly PlanetViewModel[],
  proxies: ReadonlyMap<string, PlanetProxy>,
  scratch: RenderScratch
): ScreenSceneSelectionCandidate | null {
  const planet = findPlanetAtPointer(
    event,
    canvas,
    camera,
    planets,
    proxies,
    scratch
  );

  if (!planet) {
    return null;
  }

  if (!(camera instanceof THREE.OrthographicCamera)) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  const projected = scratch.projected.copy(planet.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    return null;
  }

  const viewHeight = Math.max(camera.top - camera.bottom, 1);
  const screenX = (projected.x * 0.5 + 0.5) * bounds.width;
  const screenY = (-projected.y * 0.5 + 0.5) * bounds.height;
  const screenRadius = Math.max(
    (planet.radius * PLANET_SELECTION_RADIUS_MULTIPLIER * bounds.height) /
      viewHeight,
    PLANET_SELECTION_MIN_RADIUS_PX
  );
  const screenDistance = Math.hypot(
    event.clientX - bounds.left - screenX,
    event.clientY - bounds.top - screenY
  );

  return {
    kind: "planet",
    key: planet.key,
    screenDistancePx: screenDistance,
    screenScore: screenDistance / screenRadius,
    planet,
  };
}

function readAttackTargetByKey(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  targetKey: string | null
): UnitViewModel | null {
  return targetKey
    ? units.find(
        (unit) =>
          unit.key === targetKey &&
          unit.owner !== playerId &&
          unit.health.current > 0
      ) ?? null
    : null;
}

function collectAttackTargetCandidates(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  scratch: RenderScratch,
  maxScreenDistancePx: number
): readonly ScreenAttackTargetCandidate[] {
  const bounds = canvas.getBoundingClientRect();
  const pointerX = clientX - bounds.left;
  const pointerY = clientY - bounds.top;
  const candidates: ScreenAttackTargetCandidate[] = [];

  for (const unit of units) {
    if (unit.owner === playerId || unit.health.current <= 0) {
      continue;
    }

    const projected = scratch.projected.copy(unit.position).project(camera);

    if (projected.z < -1 || projected.z > 1) {
      continue;
    }

    const screenX = (projected.x * 0.5 + 0.5) * bounds.width;
    const screenY = (-projected.y * 0.5 + 0.5) * bounds.height;
    const screenDistance = Math.hypot(pointerX - screenX, pointerY - screenY);
    const unitPickRadius = Math.max(
      UNIT_SYMBOL_SIZE_PX *
        readUnitSymbolScale(unit) *
        ATTACK_TARGET_HOVER_RADIUS_MULTIPLIER,
      ATTACK_TARGET_PICK_MIN_RADIUS_PX
    );
    const allowedDistance = Math.max(maxScreenDistancePx, unitPickRadius);

    if (screenDistance > allowedDistance) {
      continue;
    }

    candidates.push({
      key: unit.key,
      shipClassId: unit.shipClassId,
      screenDistancePx: screenDistance,
      worldDistance: unit.position.distanceTo(camera.position),
      handleId: unit.handle.id,
      unit,
    });
  }

  return rankAttackTargetCandidates(candidates) as readonly ScreenAttackTargetCandidate[];
}

function readLastPointerScreenPoint(
  canvas: HTMLCanvasElement,
  clientX: number | null,
  clientY: number | null
): { clientX: number; clientY: number; source: "pointer" | "center" } {
  const bounds = canvas.getBoundingClientRect();

  if (
    clientX !== null &&
    clientY !== null &&
    clientX >= bounds.left &&
    clientX <= bounds.right &&
    clientY >= bounds.top &&
    clientY <= bounds.bottom
  ) {
    return {
      clientX,
      clientY,
      source: "pointer",
    };
  }

  return {
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
    source: "center",
  };
}

function pruneAttackTargetKey(
  targetKey: string | null,
  units: readonly UnitViewModel[],
  playerId: PlayerId
): string | null {
  return targetKey &&
    units.some(
      (unit) =>
        unit.key === targetKey &&
        unit.owner !== playerId &&
        unit.health.current > 0
    )
    ? targetKey
    : null;
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
  scratch: RenderScratch,
  mode: "add" | "remove" | "replace"
): void {
  const bounds = canvas.getBoundingClientRect();
  const minX = Math.min(startClientX, endClientX);
  const maxX = Math.max(startClientX, endClientX);
  const minY = Math.min(startClientY, endClientY);
  const maxY = Math.max(startClientY, endClientY);

  if (mode === "replace") {
    selectedUnitKeys.clear();
  }

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
      if (mode === "remove") {
        selectedUnitKeys.delete(unit.key);
      } else {
        selectedUnitKeys.add(unit.key);
      }
    }
  }
}

function replaceSelectionWithOwnedUnits(
  selectedUnitKeys: Set<string>,
  runtime: LocalGameRuntime,
  shipClassId?: number
): void {
  selectedUnitKeys.clear();

  for (const unit of runtime.readUnits()) {
    if (
      unit.owner === runtime.playerId &&
      (shipClassId === undefined || unit.shipClassId === shipClassId)
    ) {
      selectedUnitKeys.add(unit.key);
    }
  }
}

function replaceSelectionWithUnitKeys(
  selectedUnitKeys: Set<string>,
  unitKeys: readonly string[]
): void {
  selectedUnitKeys.clear();

  for (const unitKey of unitKeys) {
    selectedUnitKeys.add(unitKey);
  }
}

function isSelectionRemoveModifier(event: PointerEvent): boolean {
  return event.ctrlKey;
}

function readPointerDragMode(
  event: PointerEvent,
  canControlUnits: boolean
): CameraControls["dragMode"] {
  if (event.button === 2 && event.shiftKey) {
    return "pan";
  }

  return !canControlUnits || event.button !== 0 || event.altKey
    ? "camera"
    : "select";
}

function readSelectionMode(event: PointerEvent): SelectionMode {
  if (isSelectionRemoveModifier(event)) {
    return "remove";
  }

  return event.shiftKey ? "add" : "replace";
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

function pruneSceneSelectionTarget(
  target: SceneSelectionTarget | null,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  playerId: PlayerId
): SceneSelectionTarget | null {
  if (!target) {
    return null;
  }

  if (target.kind === "planet") {
    return pruneSelectedPlanetKey(target.key, planets)
      ? target
      : null;
  }

  return units.some(
    (unit) =>
      unit.key === target.key &&
      (target.kind === "friendlyUnit"
        ? unit.owner === playerId
        : unit.owner !== playerId && unit.health.current > 0)
  )
    ? target
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

function pruneCommandMenuLeaderKey(
  leaderKey: string | null,
  selectedUnitKeys: ReadonlySet<string>
): string | null {
  return leaderKey && selectedUnitKeys.has(leaderKey) ? leaderKey : null;
}

function updatePlanetProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, PlanetProxy>,
  planets: readonly PlanetViewModel[],
  frameIndex: number,
  geometry: THREE.PlaneGeometry,
  ringGeometry: THREE.RingGeometry,
  material: THREE.ShaderMaterial,
  glowMaterial: THREE.ShaderMaterial | null,
  ringMaterial: THREE.ShaderMaterial,
  renderQuality: RenderQualityConfig
): void {
  const shaderRenderMode = renderQualityToShaderValue(renderQuality.mode);

  for (const planet of planets) {
    let proxy = proxies.get(planet.key);

    if (!proxy) {
      proxy = createPlanetProxy(
        planet,
        geometry,
        ringGeometry,
        material,
        glowMaterial,
        ringMaterial,
        renderQuality
      );
      proxies.set(planet.key, proxy);
      if (proxy.glow) {
        worldGroup.add(proxy.glow);
      }
      worldGroup.add(proxy.body);
      worldGroup.add(proxy.rings);
    }

    proxy.lastSeenFrame = frameIndex;
    if (proxy.glow) {
      proxy.glow.position.copy(planet.position);
      proxy.glow.scale.setScalar(
        readPlanetGlowBillboardScale(planet, renderQuality)
      );
      proxy.glow.frustumCulled = renderQuality.cullPlanetAtmosphere;
      proxy.glow.material.uniforms.uPlanetColor.value.set(planet.color);
      writeGasGiantPaletteUniforms(proxy.glow.material, planet);
      proxy.glow.material.uniforms.uPlanetClass.value = planetClassToShaderValue(
        planet.appearance.planetClass
      );
      proxy.glow.material.uniforms.uPlanetSeed.value = planet.appearance.seed;
      proxy.glow.material.uniforms.uRenderMode.value = shaderRenderMode;
    }
    proxy.body.position.copy(planet.position);
    proxy.body.scale.setScalar(readPlanetBodyBillboardScale(planet));
    proxy.body.material.uniforms.uPlanetColor.value.set(planet.color);
    writeGasGiantPaletteUniforms(proxy.body.material, planet);
    proxy.body.material.uniforms.uPlanetClass.value = planetClassToShaderValue(
      planet.appearance.planetClass
    );
    proxy.body.material.uniforms.uPlanetSeed.value = planet.appearance.seed;
    proxy.body.material.uniforms.uRenderMode.value = shaderRenderMode;
    proxy.rings.visible = planet.appearance.hasRings;
    proxy.rings.frustumCulled = renderQuality.cullPlanetRings;
    proxy.rings.position.copy(planet.position);
    proxy.rings.scale.setScalar(planet.radius);
    writePlanetRingOrientation(proxy.rings.quaternion, planet.orbitAxis);
    proxy.rings.material.uniforms.uPlanetColor.value.set(planet.color);
    proxy.rings.material.uniforms.uPlanetSeed.value = planet.appearance.seed;
    writePlanetRingEllipse(
      proxy.rings.material.uniforms.uRingEllipse.value,
      planet.appearance.seed
    );
  }

  for (const [key, proxy] of proxies) {
    if (proxy.lastSeenFrame !== frameIndex) {
      if (proxy.glow) {
        worldGroup.remove(proxy.glow);
        proxy.glow.material.dispose();
      }
      worldGroup.remove(proxy.body);
      worldGroup.remove(proxy.rings);
      proxy.body.material.dispose();
      proxy.rings.material.dispose();
      proxies.delete(key);
    }
  }
}

function disposePlanetProxies(
  worldGroup: THREE.Group,
  proxies: Map<string, PlanetProxy>
): void {
  for (const proxy of proxies.values()) {
    if (proxy.glow) {
      worldGroup.remove(proxy.glow);
      proxy.glow.material.dispose();
    }
    worldGroup.remove(proxy.body);
    worldGroup.remove(proxy.rings);
    proxy.body.material.dispose();
    proxy.rings.material.dispose();
  }

  proxies.clear();
}

function createPlanetProxy(
  planet: PlanetViewModel,
  geometry: THREE.PlaneGeometry,
  ringGeometry: THREE.RingGeometry,
  material: THREE.ShaderMaterial,
  glowMaterial: THREE.ShaderMaterial | null,
  ringMaterial: THREE.ShaderMaterial,
  renderQuality: RenderQualityConfig
): PlanetProxy {
  const shaderRenderMode = renderQualityToShaderValue(renderQuality.mode);
  const glow = glowMaterial
    ? createPlanetGlowMesh(
        planet,
        geometry,
        glowMaterial,
        renderQuality,
        shaderRenderMode
      )
    : null;

  const planetMaterial = material.clone();
  planetMaterial.uniforms.uPlanetColor.value.set(planet.color);
  writeGasGiantPaletteUniforms(planetMaterial, planet);
  planetMaterial.uniforms.uPlanetClass.value = planetClassToShaderValue(
    planet.appearance.planetClass
  );
  planetMaterial.uniforms.uPlanetSeed.value = planet.appearance.seed;
  planetMaterial.uniforms.uRenderMode.value = shaderRenderMode;
  const body = new THREE.Mesh(
    geometry,
    planetMaterial
  );
  body.name = `${planet.label} shaded billboard planet`;
  body.position.copy(planet.position);
  body.scale.setScalar(readPlanetBodyBillboardScale(planet));
  body.renderOrder = -5;

  const ringsMaterial = ringMaterial.clone();
  ringsMaterial.uniforms.uPlanetColor.value.set(planet.color);
  ringsMaterial.uniforms.uPlanetSeed.value = planet.appearance.seed;
  writePlanetRingEllipse(ringsMaterial.uniforms.uRingEllipse.value, planet.appearance.seed);
  const rings = new THREE.Mesh(ringGeometry, ringsMaterial);
  rings.name = `${planet.label} shaded ring mesh`;
  rings.position.copy(planet.position);
  rings.scale.setScalar(planet.radius);
  writePlanetRingOrientation(rings.quaternion, planet.orbitAxis);
  rings.renderOrder = -4;
  rings.visible = planet.appearance.hasRings;
  rings.frustumCulled = renderQuality.cullPlanetRings;

  return {
    glow,
    body,
    rings,
    lastSeenFrame: 0,
  };
}

function createPlanetGlowMesh(
  planet: PlanetViewModel,
  geometry: THREE.PlaneGeometry,
  glowMaterial: THREE.ShaderMaterial,
  renderQuality: RenderQualityConfig,
  shaderRenderMode: number
): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const planetGlowMaterial = glowMaterial.clone();
  planetGlowMaterial.uniforms.uPlanetColor.value.set(planet.color);
  writeGasGiantPaletteUniforms(planetGlowMaterial, planet);
  planetGlowMaterial.uniforms.uPlanetClass.value = planetClassToShaderValue(
    planet.appearance.planetClass
  );
  planetGlowMaterial.uniforms.uPlanetSeed.value = planet.appearance.seed;
  planetGlowMaterial.uniforms.uRenderMode.value = shaderRenderMode;

  const glow = new THREE.Mesh(geometry, planetGlowMaterial);
  glow.name = `${planet.label} subtle planet glow`;
  glow.position.copy(planet.position);
  glow.scale.setScalar(readPlanetGlowBillboardScale(planet, renderQuality));
  glow.renderOrder = -4.5;
  glow.frustumCulled = renderQuality.cullPlanetAtmosphere;

  return glow;
}

function readPlanetGlowBillboardScale(
  planet: PlanetViewModel,
  renderQuality: RenderQualityConfig
): number {
  return planet.radius * renderQuality.planetGlowBillboardScale;
}

function readPlanetBodyBillboardScale(planet: PlanetViewModel): number {
  return planet.radius * PLANET_BODY_BILLBOARD_SCALE;
}

function createPlanetRingGeometry(
  renderQuality: RenderQualityConfig
): THREE.RingGeometry {
  return new THREE.RingGeometry(
    PLANET_RING_INNER_RADIUS,
    PLANET_RING_OUTER_RADIUS,
    renderQuality.ringThetaSegments,
    renderQuality.ringPhiSegments
  );
}

function writePlanetRingOrientation(
  target: THREE.Quaternion,
  orbitAxis: THREE.Vector3
): THREE.Quaternion {
  PLANET_RING_AXIS_SCRATCH.copy(orbitAxis);

  if (PLANET_RING_AXIS_SCRATCH.lengthSq() <= 0.000001) {
    PLANET_RING_AXIS_SCRATCH.set(0, 1, 0);
  } else {
    PLANET_RING_AXIS_SCRATCH.normalize();
  }

  return target.setFromUnitVectors(Z_AXIS, PLANET_RING_AXIS_SCRATCH);
}

function writePlanetRingEllipse(target: THREE.Vector2, seed: number): THREE.Vector2 {
  const scaleSeed = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453;
  const scale = 1.035 + (scaleSeed - Math.floor(scaleSeed)) * 0.085;

  return target.set(scale, 1 / scale);
}

function writeGasGiantPaletteUniforms(
  material: THREE.ShaderMaterial,
  planet: PlanetViewModel
): void {
  const baseColor = GAS_GIANT_BASE_COLOR_SCRATCH.set(planet.color);
  const primaryIndex = Math.floor(
    readSeededFraction(planet.appearance.seed, 2.731) * GAS_GIANT_PALETTE_THEMES.length
  );
  const secondaryOffset = 1 + Math.floor(
    readSeededFraction(planet.appearance.seed, 8.193) *
      (GAS_GIANT_PALETTE_THEMES.length - 1)
  );
  const secondaryIndex =
    (primaryIndex + secondaryOffset) % GAS_GIANT_PALETTE_THEMES.length;
  const primary = GAS_GIANT_PALETTE_THEMES[primaryIndex];
  const secondary = GAS_GIANT_PALETTE_THEMES[secondaryIndex];
  const paletteMix = 0.12 + readSeededFraction(planet.appearance.seed, 13.917) * 0.34;
  const baseMix = 0.1 + readSeededFraction(planet.appearance.seed, 19.441) * 0.16;

  writeGasGiantPaletteColor(
    material.uniforms.uGasPaletteShadow.value,
    primary[0],
    secondary[0],
    baseColor,
    paletteMix,
    baseMix * 0.45,
    0.92
  );
  writeGasGiantPaletteColor(
    material.uniforms.uGasPaletteLow.value,
    primary[1],
    secondary[1],
    baseColor,
    paletteMix,
    baseMix,
    1
  );
  writeGasGiantPaletteColor(
    material.uniforms.uGasPaletteHigh.value,
    primary[2],
    secondary[2],
    baseColor,
    paletteMix * 0.65,
    baseMix * 0.55,
    1.08
  );
  writeGasGiantPaletteColor(
    material.uniforms.uGasPaletteAccent.value,
    primary[3],
    secondary[3],
    baseColor,
    paletteMix,
    baseMix * 0.7,
    1.02
  );
}

function writeGasGiantPaletteColor(
  target: THREE.Color,
  primaryHex: number,
  secondaryHex: number,
  baseColor: THREE.Color,
  paletteMix: number,
  baseMix: number,
  exposure: number
): void {
  target.setHex(primaryHex);
  GAS_GIANT_PALETTE_COLOR_SCRATCH.setHex(secondaryHex);
  target.lerp(GAS_GIANT_PALETTE_COLOR_SCRATCH, paletteMix);
  target.lerp(baseColor, baseMix);
  target.multiplyScalar(exposure);
}

function readSeededFraction(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function planetClassToShaderValue(planetClass: PlanetClass): number {
  switch (planetClass) {
    case "gas-giant":
      return 0;
    case "terran":
      return 1;
    case "ice":
      return 2;
  }
}

function renderQualityToShaderValue(renderMode: RenderQualityMode): number {
  return renderMode === "cinematic" ? 1 : 0;
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
  const root = new THREE.Group();
  const gridGeometry = createTacticalGridGeometry();
  const gridMaterial = new THREE.LineBasicMaterial({
    color: TACTICAL_OVERLAY_COLOR_HEX,
    transparent: true,
    opacity: 0.42,
    depthTest: false,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  const intersectionGeometry = createTacticalIntersectionGeometry();
  const intersectionMaterial = new THREE.LineBasicMaterial({
    color: TACTICAL_OVERLAY_COLOR_HEX,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const intersection = new THREE.LineLoop(
    intersectionGeometry,
    intersectionMaterial
  );

  root.name = "selected-planet-tactical-overlay";
  root.visible = false;
  grid.name = "selected-planet-tactical-grid";
  grid.frustumCulled = false;
  grid.renderOrder = 7;
  intersection.name = "selected-planet-intersection-circle";
  intersection.frustumCulled = false;
  intersection.renderOrder = 7.1;

  root.add(grid, intersection);

  return {
    root,
    grid,
    intersection,
  };
}

function createTacticalGridGeometry(): THREE.BufferGeometry {
  const halfGridSize = TACTICAL_GRID_WORLD_SIZE / 2;
  const spacing = TACTICAL_GRID_WORLD_SIZE / TACTICAL_GRID_DIVISIONS;
  const positions: number[] = [];

  for (let index = 0; index <= TACTICAL_GRID_DIVISIONS; index += 1) {
    const offset = -halfGridSize + index * spacing;

    if (Math.abs(offset) >= TACTICAL_GRID_MASK_RADIUS) {
      writeTacticalGridLine(
        positions,
        offset,
        -halfGridSize,
        offset,
        halfGridSize
      );
      writeTacticalGridLine(
        positions,
        -halfGridSize,
        offset,
        halfGridSize,
        offset
      );
      continue;
    }

    const chordHalfLength = Math.sqrt(
      TACTICAL_GRID_MASK_RADIUS ** 2 - offset ** 2
    );

    writeTacticalGridLine(
      positions,
      offset,
      -halfGridSize,
      offset,
      -chordHalfLength
    );
    writeTacticalGridLine(
      positions,
      offset,
      chordHalfLength,
      offset,
      halfGridSize
    );
    writeTacticalGridLine(
      positions,
      -halfGridSize,
      offset,
      -chordHalfLength,
      offset
    );
    writeTacticalGridLine(
      positions,
      chordHalfLength,
      offset,
      halfGridSize,
      offset
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return geometry;
}

function writeTacticalGridLine(
  positions: number[],
  startX: number,
  startZ: number,
  endX: number,
  endZ: number
): void {
  positions.push(startX, 0, startZ, endX, 0, endZ);
}

function createTacticalIntersectionGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(TACTICAL_GRID_INTERSECTION_SEGMENTS * 3);

  for (
    let index = 0;
    index < TACTICAL_GRID_INTERSECTION_SEGMENTS;
    index += 1
  ) {
    const angle =
      (index / TACTICAL_GRID_INTERSECTION_SEGMENTS) * Math.PI * 2;
    const positionIndex = index * 3;

    positions[positionIndex] =
      Math.cos(angle) * TACTICAL_GRID_MASK_RADIUS;
    positions[positionIndex + 1] = 0;
    positions[positionIndex + 2] =
      Math.sin(angle) * TACTICAL_GRID_MASK_RADIUS;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function updateTacticalGrid(
  tacticalGrid: TacticalGrid,
  context: PlanetViewModel | null,
  enabled: boolean,
  cameraPreset: CameraPreset | null
): void {
  tacticalGrid.root.visible = enabled && !!context;

  if (!tacticalGrid.root.visible || !context) {
    return;
  }

  tacticalGrid.root.position.set(
    context.position.x,
    context.position.y,
    context.position.z
  );
  writeTacticalPlaneQuaternion(tacticalGrid.root.quaternion, cameraPreset);
  tacticalGrid.root.scale.setScalar(context.radius);
}

function updateCaptureProgressRings(
  worldGroup: THREE.Group,
  rings: Map<string, CaptureProgressRing>,
  planets: readonly PlanetViewModel[],
  players: readonly PlayerConfig[],
  rules: CaptureRulesConfig,
  frameIndex: number,
  enabled: boolean,
  cameraPreset: CameraPreset | null
): void {
  for (const planet of planets) {
    if (!planet.control.capturable) {
      continue;
    }

    let ring = rings.get(planet.key);

    if (!ring) {
      ring = createCaptureProgressRing();
      rings.set(planet.key, ring);
      worldGroup.add(ring.root);
    }

    ring.lastSeenFrame = frameIndex;
    ring.root.visible = enabled;
    ring.root.position.copy(planet.position);
    ring.root.scale.setScalar(
      planet.radius * CAPTURE_PROGRESS_RADIUS_MULTIPLIER
    );
    writeTacticalPlaneQuaternion(ring.root.quaternion, cameraPreset);
    ring.track.material.color.set(readPlanetStatusColor(planet, players));
    ring.progress.material.color.set(
      readPlayerColor(players, planet.control.capturingPlayer, "#ffffff")
    );
    ring.progress.visible =
      enabled &&
      planet.control.capturingPlayer !== 0 &&
      !planet.control.contested;
    writeCaptureProgressGeometry(
      ring,
      readPlanetCaptureProgress(planet, rules)
    );
  }

  for (const [key, ring] of rings) {
    if (ring.lastSeenFrame === frameIndex) {
      continue;
    }

    disposeCaptureProgressRing(worldGroup, ring);
    rings.delete(key);
  }
}

function updateOrbitLaneRings(
  worldGroup: THREE.Group,
  rings: Map<string, OrbitLaneRing>,
  selectedUnits: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  selectedLane: SelectedOrbitLane | null,
  preview: OrbitLaneDragState | null,
  frameIndex: number,
  enabled: boolean
): void {
  const visuals = enabled
    ? collectOrbitLaneVisuals(selectedUnits, planets, selectedLane, preview)
    : [];

  for (const visual of visuals) {
    let ring = rings.get(visual.key);

    if (!ring) {
      ring = createOrbitLaneRing();
      rings.set(visual.key, ring);
      worldGroup.add(ring.root);
    }

    ring.lastSeenFrame = frameIndex;
    ring.root.visible = true;
    ring.root.position.copy(visual.planet.position);
    ring.root.scale.setScalar(visual.lane.radius);
    writeOrbitLaneQuaternion(ring.root.quaternion, visual.lane.axis);
    ring.line.material.color.setHex(visual.color);
    ring.line.material.opacity = visual.opacity;
  }

  for (const [key, ring] of rings) {
    if (ring.lastSeenFrame === frameIndex) {
      continue;
    }

    disposeOrbitLaneRing(worldGroup, ring);
    rings.delete(key);
  }
}

function collectOrbitLaneVisuals(
  selectedUnits: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  selectedLane: SelectedOrbitLane | null,
  preview: OrbitLaneDragState | null
): OrbitLaneVisual[] {
  const visuals = new Map<string, OrbitLaneVisual>();

  for (const unit of selectedUnits) {
    const order = unit.moveOrder;

    if (order?.type !== "orbitPlanet" || !order.lane) {
      continue;
    }

    const planet =
      planets.find((entry) => entry.key === handleKey(order.planet)) ?? null;

    if (!planet) {
      continue;
    }

    const key = readOrbitLaneVisualKey("active", planet, order.lane);
    visuals.set(key, {
      key,
      planet,
      lane: order.lane,
      color: 0x79d7ff,
      opacity: 0.58,
    });
  }

  if (selectedLane) {
    const planet =
      planets.find((entry) => entry.key === selectedLane.planetKey) ?? null;

    if (planet) {
      const key = readOrbitLaneVisualKey("selected", planet, selectedLane.lane);
      visuals.set(key, {
        key,
        planet,
        lane: selectedLane.lane,
        color: 0xffd36b,
        opacity: 0.78,
      });
    }
  }

  if (preview) {
    const planet =
      planets.find((entry) => entry.key === preview.planetKey) ?? null;

    if (planet) {
      visuals.set("preview", {
        key: "preview",
        planet,
        lane: preview.lane,
        color: TACTICAL_OVERLAY_COLOR_HEX,
        opacity: 0.92,
      });
    }
  }

  return [...visuals.values()];
}

function readOrbitLaneVisualKey(
  prefix: string,
  planet: PlanetViewModel,
  lane: OrbitLaneSpec
): string {
  return [
    prefix,
    planet.key,
    lane.radius.toFixed(2),
    lane.axis.x.toFixed(3),
    lane.axis.y.toFixed(3),
    lane.axis.z.toFixed(3),
    lane.direction,
  ].join(":");
}

function createOrbitLaneRing(): OrbitLaneRing {
  const root = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x79d7ff,
    transparent: true,
    opacity: 0.58,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.LineLoop(createOrbitLaneGeometry(), material);

  root.name = "ship-orbit-lane-ring";
  root.visible = false;
  line.name = "ship orbit lane";
  line.frustumCulled = false;
  line.renderOrder = 9.4;
  root.add(line);

  return {
    root,
    line,
    lastSeenFrame: 0,
  };
}

function createOrbitLaneGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(ORBIT_LANE_SEGMENTS * 3);

  for (let index = 0; index < ORBIT_LANE_SEGMENTS; index += 1) {
    const angle = (index / ORBIT_LANE_SEGMENTS) * Math.PI * 2;
    const positionIndex = index * 3;

    positions[positionIndex] = Math.cos(angle);
    positions[positionIndex + 1] = 0;
    positions[positionIndex + 2] = Math.sin(angle);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function writeOrbitLaneQuaternion(
  target: THREE.Quaternion,
  axis: Vec3Data
): THREE.Quaternion {
  PLANET_RING_AXIS_SCRATCH.set(axis.x, axis.y, axis.z);

  if (PLANET_RING_AXIS_SCRATCH.lengthSq() <= 0.000001) {
    PLANET_RING_AXIS_SCRATCH.copy(Y_AXIS);
  } else {
    PLANET_RING_AXIS_SCRATCH.normalize();
  }

  return target.setFromUnitVectors(Y_AXIS, PLANET_RING_AXIS_SCRATCH);
}

function createCaptureProgressRing(): CaptureProgressRing {
  const root = new THREE.Group();
  const trackMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.36,
    depthTest: false,
    depthWrite: false,
  });
  const progressMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
  });
  const track = new THREE.LineLoop(
    createTacticalIntersectionGeometry(),
    trackMaterial
  );
  const progressPositions = new Float32Array(
    (CAPTURE_PROGRESS_SEGMENTS + 1) * 3
  );
  const progressGeometry = new THREE.BufferGeometry();
  const progress = new THREE.Line(progressGeometry, progressMaterial);

  root.name = "planet-capture-progress-ring";
  root.visible = false;
  track.name = "planet capture status track";
  track.frustumCulled = false;
  track.renderOrder = 9.2;
  progressGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(progressPositions, 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  progressGeometry.setDrawRange(0, 0);
  progress.name = "planet capture radial progress";
  progress.frustumCulled = false;
  progress.renderOrder = 9.3;
  root.add(track, progress);

  return {
    root,
    track,
    progress,
    progressPositions,
    lastSeenFrame: 0,
  };
}

function writeCaptureProgressGeometry(
  ring: CaptureProgressRing,
  progress: number
): void {
  const clampedProgress = clamp(progress, 0, 1);
  const vertexCount =
    clampedProgress <= 0
      ? 0
      : Math.max(2, Math.ceil(clampedProgress * CAPTURE_PROGRESS_SEGMENTS) + 1);

  for (let index = 0; index < vertexCount; index += 1) {
    const t =
      vertexCount <= 1
        ? 0
        : Math.min(index / CAPTURE_PROGRESS_SEGMENTS, clampedProgress);
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    const positionIndex = index * 3;

    ring.progressPositions[positionIndex] = Math.cos(angle);
    ring.progressPositions[positionIndex + 1] = 0;
    ring.progressPositions[positionIndex + 2] = Math.sin(angle);
  }

  ring.progress.geometry.setDrawRange(0, vertexCount);
  ring.progress.geometry.attributes.position.needsUpdate = true;
}

function readPlanetCaptureProgress(
  planet: PlanetViewModel,
  rules: CaptureRulesConfig
): number {
  if (planet.control.capturingPlayer === 0 || planet.control.contested) {
    return 0;
  }

  const requiredTicks = rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ;
  return planet.control.captureTicks / Math.max(requiredTicks, 1);
}

function readPlanetStatusColor(
  planet: PlanetViewModel,
  players: readonly PlayerConfig[]
): string {
  if (planet.control.capturingPlayer !== 0) {
    return readPlayerColor(players, planet.control.capturingPlayer, "#ffffff");
  }

  return readPlayerColor(players, planet.control.owner, "#d6dae8");
}

function readPlayerColor(
  players: readonly PlayerConfig[],
  playerId: PlayerId | 0,
  fallback: string
): string {
  return players.find((player) => player.id === playerId)?.color ?? fallback;
}

function disposeCaptureProgressRings(
  worldGroup: THREE.Group,
  rings: Map<string, CaptureProgressRing>
): void {
  for (const ring of rings.values()) {
    disposeCaptureProgressRing(worldGroup, ring);
  }

  rings.clear();
}

function disposeCaptureProgressRing(
  worldGroup: THREE.Group,
  ring: CaptureProgressRing
): void {
  worldGroup.remove(ring.root);
  ring.track.geometry.dispose();
  ring.track.material.dispose();
  ring.progress.geometry.dispose();
  ring.progress.material.dispose();
  ring.root.clear();
}

function disposeOrbitLaneRings(
  worldGroup: THREE.Group,
  rings: Map<string, OrbitLaneRing>
): void {
  for (const ring of rings.values()) {
    disposeOrbitLaneRing(worldGroup, ring);
  }

  rings.clear();
}

function disposeOrbitLaneRing(
  worldGroup: THREE.Group,
  ring: OrbitLaneRing
): void {
  worldGroup.remove(ring.root);
  ring.line.geometry.dispose();
  ring.line.material.dispose();
  ring.root.clear();
}

function writeTacticalPlaneQuaternion(
  target: THREE.Quaternion,
  cameraPreset: CameraPreset | null
): THREE.Quaternion {
  if (cameraPreset !== "left") {
    return target.identity();
  }

  TACTICAL_BASIS_MATRIX.makeBasis(Z_AXIS, X_AXIS, Y_AXIS);
  return target.setFromRotationMatrix(TACTICAL_BASIS_MATRIX);
}

function writeTacticalPlaneSample(
  target: THREE.Vector3,
  center: THREE.Vector3,
  x: number,
  z: number,
  cameraPreset: CameraPreset | null
): THREE.Vector3 {
  if (cameraPreset === "left") {
    return target.set(center.x, center.y + z, center.z + x);
  }

  return target.set(center.x + x, center.y, center.z + z);
}

function disposeTacticalGrid(tacticalGrid: TacticalGrid): void {
  tacticalGrid.grid.geometry.dispose();
  tacticalGrid.grid.material.dispose();
  tacticalGrid.intersection.geometry.dispose();
  tacticalGrid.intersection.material.dispose();

  tacticalGrid.root.clear();
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
      uColor: { value: new THREE.Color(TACTICAL_OVERLAY_COLOR_HEX) },
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
  root.visible = false;

  return {
    root,
    geometry,
    material,
    positions,
    alphas,
    sampleCapacity: sampleCount,
    lines,
    sample: new THREE.Vector3(),
    gravityVector: new THREE.Vector3(),
    gravityResult: { x: 0, y: 0, z: 0 },
    end: new THREE.Vector3(),
    headBase: new THREE.Vector3(),
    side: new THREE.Vector3(),
    headLeft: new THREE.Vector3(),
    headRight: new THREE.Vector3(),
  };
}

function updateGravityOverlay(
  overlay: GravityOverlay,
  planets: readonly PlanetViewModel[],
  enabled: boolean,
  cameraPreset: CameraPreset | null
): void {
  overlay.root.visible = enabled && planets.length > 0;

  if (!overlay.root.visible) {
    clearGravityOverlay(overlay);
    return;
  }

  ensureGravityOverlayCapacity(
    overlay,
    planets.length * GRAVITY_OVERLAY_GRID_SIZE ** 2
  );
  overlay.alphas.fill(0);

  const halfGrid = (GRAVITY_OVERLAY_GRID_SIZE - 1) / 2;
  let arrowIndex = 0;

  for (const context of planets) {
    const spacing = Math.max(context.radius * 0.56, 9);

    for (let zIndex = 0; zIndex < GRAVITY_OVERLAY_GRID_SIZE; zIndex += 1) {
      for (let xIndex = 0; xIndex < GRAVITY_OVERLAY_GRID_SIZE; xIndex += 1) {
        const vectorIndex = arrowIndex;
        arrowIndex += 1;
        const x = (xIndex - halfGrid) * spacing;
        const z = (zIndex - halfGrid) * spacing;
        const sample = writeTacticalPlaneSample(
          overlay.sample,
          context.position,
          x,
          z,
          cameraPreset
        );
        const surfaceDistance = sample.distanceTo(context.position);

        if (surfaceDistance < context.radius * 1.08) {
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
          continue;
        }

        const opacity =
          0.06 + smoothstep(0.02, 0.75, normalizedStrength) * 0.64;

        writeGravityVector(
          overlay,
          vectorIndex,
          sample,
          gravityVector.normalize(),
          GRAVITY_OVERLAY_VECTOR_LENGTH,
          GRAVITY_OVERLAY_HEAD_LENGTH,
          opacity
        );
      }
    }
  }

  overlay.geometry.setDrawRange(
    0,
    arrowIndex * GRAVITY_OVERLAY_VERTICES_PER_VECTOR
  );
  overlay.geometry.attributes.position.needsUpdate = true;
  overlay.geometry.attributes.aAlpha.needsUpdate = true;
}

function ensureGravityOverlayCapacity(
  overlay: GravityOverlay,
  sampleCount: number
): void {
  if (sampleCount <= overlay.sampleCapacity) {
    return;
  }

  const vertexCount = sampleCount * GRAVITY_OVERLAY_VERTICES_PER_VECTOR;
  overlay.positions = new Float32Array(vertexCount * 3);
  overlay.alphas = new Float32Array(vertexCount);
  overlay.geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(overlay.positions, 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  overlay.geometry.setAttribute(
    "aAlpha",
    new THREE.BufferAttribute(overlay.alphas, 1).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  overlay.sampleCapacity = sampleCount;
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

function createGasGiantTextureSet(): GasGiantTextureSet {
  const loader = new THREE.TextureLoader();
  const grunge = loader.load(gasGiantGrungeTextureUrl);
  const noise = loader.load(gasGiantNoiseTextureUrl);

  for (const texture of [grunge, noise]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
  }

  return { grunge, noise };
}

function disposeGasGiantTextureSet(textures: GasGiantTextureSet): void {
  textures.grunge.dispose();
  textures.noise.dispose();
}

function createPlanetBillboardMaterial(
  gasGiantTextures: GasGiantTextureSet,
  renderMode: RenderQualityMode
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: renderMode === "cinematic" ? { CINEMATIC_RENDER: "1" } : {},
    uniforms: {
      uSunDirection: { value: DEFAULT_SUN_DIRECTION.clone() },
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uGasPaletteShadow: { value: new THREE.Color(0x101a38) },
      uGasPaletteLow: { value: new THREE.Color(0x315a9e) },
      uGasPaletteHigh: { value: new THREE.Color(0xc8d9ff) },
      uGasPaletteAccent: { value: new THREE.Color(0xe1b46d) },
      uGasGrungeTexture: { value: gasGiantTextures.grunge },
      uGasNoiseTexture: { value: gasGiantTextures.noise },
      uPlanetClass: { value: 1 },
      uPlanetSeed: { value: 113 },
      uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uCameraForward: { value: new THREE.Vector3(0, 0, 1) },
      uTime: { value: 0 },
      uRenderMode: { value: renderQualityToShaderValue(renderMode) },
    },
    vertexShader: PLANET_BILLBOARD_VERTEX_SHADER,
    fragmentShader: PLANET_BILLBOARD_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

function createPlanetGlowMaterial(
  gasGiantTextures: GasGiantTextureSet,
  renderMode: RenderQualityMode
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uGasPaletteShadow: { value: new THREE.Color(0x101a38) },
      uGasPaletteLow: { value: new THREE.Color(0x315a9e) },
      uGasPaletteHigh: { value: new THREE.Color(0xc8d9ff) },
      uGasPaletteAccent: { value: new THREE.Color(0xe1b46d) },
      uSunDirection: { value: DEFAULT_SUN_DIRECTION.clone() },
      uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uCameraForward: { value: new THREE.Vector3(0, 0, 1) },
      uGasNoiseTexture: { value: gasGiantTextures.noise },
      uPlanetClass: { value: 1 },
      uPlanetSeed: { value: 113 },
      uTime: { value: 0 },
      uRenderMode: { value: renderQualityToShaderValue(renderMode) },
      uGlowNoiseScale: { value: 1 },
      uGlowNoiseStrength: { value: 1 },
      uGlowOpacityFalloff: { value: 0 },
    },
    vertexShader: PLANET_BILLBOARD_VERTEX_SHADER,
    fragmentShader: PLANET_GLOW_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createPlanetRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: DEFAULT_SUN_DIRECTION.clone() },
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uPlanetSeed: { value: 113 },
      uRingEllipse: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: PLANET_RING_VERTEX_SHADER,
    fragmentShader: PLANET_RING_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
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
  const cameraRight = scratch.cameraRight
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .normalize();
  const cameraUp = scratch.cameraUp
    .setFromMatrixColumn(camera.matrixWorld, 1)
    .normalize();
  const cameraForward = scratch.cameraForward
    .setFromMatrixColumn(camera.matrixWorld, 2)
    .normalize();

  for (const proxy of proxies.values()) {
    if (proxy.glow) {
      proxy.glow.quaternion.copy(camera.quaternion);
      proxy.glow.material.uniforms.uSunDirection.value.copy(sunDirection);
      proxy.glow.material.uniforms.uCameraRight.value.copy(cameraRight);
      proxy.glow.material.uniforms.uCameraUp.value.copy(cameraUp);
      proxy.glow.material.uniforms.uCameraForward.value.copy(cameraForward);
      proxy.glow.material.uniforms.uTime.value = elapsedSeconds;
    }
    proxy.body.quaternion.copy(camera.quaternion);
    proxy.body.material.uniforms.uSunDirection.value.copy(sunDirection);
    proxy.body.material.uniforms.uCameraRight.value.copy(cameraRight);
    proxy.body.material.uniforms.uCameraUp.value.copy(cameraUp);
    proxy.body.material.uniforms.uCameraForward.value.copy(cameraForward);
    proxy.body.material.uniforms.uTime.value = elapsedSeconds;
    proxy.rings.material.uniforms.uSunDirection.value.copy(sunDirection);
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

function toVec3Data(vector: THREE.Vector3): Vec3Data {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}
