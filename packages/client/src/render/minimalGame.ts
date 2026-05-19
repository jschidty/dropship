import * as THREE from "three";
import gasGiantGrungeTextureUrl from "../../../../content/images/red-gas-giant/grunge.jpg?url";
import gasGiantNoiseTextureUrl from "../../../../content/images/red-gas-giant/noise.png?url";
import {
  DEFAULT_CAPTURE_DEMO_RULES,
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  type MatchConfig,
  type PlanetClass,
  type PlayerId,
  type SunConfig,
  type Vec3Data,
} from "@drop-ship/protocol";
import {
  PLANET_GRAVITY_MAX_STRENGTH,
  SIM_DT_MS,
  computePlanetGravityVector,
  type SimEvent,
} from "@drop-ship/sim";
import {
  CAMERA_MODES,
  CAMERA_PRESETS,
  applyCameraPreset,
  setCameraMode,
  type CameraControls,
  type CameraFocusTween,
} from "../camera/config";
import { createNetworkedGame } from "../net/networkedGame";
import { createSelectionRingTexture, createUnitSymbolTexture } from "./canvasTextures";
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
  createCameraPresetControls,
  createRandomSeedControl,
  createRenderModeControl,
  createSelectionBox,
  createStatsLayer,
  createTacticalOverlayControls,
  createCommandMenu,
  createTopLeftControls,
  hideSelectionBox,
  setTacticalOverlayEnabled,
  updateCommandMenu,
  updateCameraPresetControls,
  updateSelectionBox,
  updateStatsLayer,
  type CameraPresetControls,
  type CommandMenuControls,
  type TacticalOverlayControls,
} from "../ui/controls";
import { createMinimalLocalGame } from "../runtime/localGame";
import { DEFAULT_LOCAL_PLAYER_ID } from "../runtime/matchConfig";
import type {
  LocalGameRuntime,
  MountedGame,
  MountMinimalGameOptions,
  PlanetViewModel,
  RenderQualityMode,
  UnitViewModel,
} from "../types";

type UnitBatchRenderer = {
  root: THREE.Group;
  geometry: THREE.PlaneGeometry;
  selectionMaterial: THREE.MeshBasicMaterial;
  selectionMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  selectionCapacity: number;
  symbolMaterials: Map<string, THREE.MeshBasicMaterial>;
  symbolMeshes: Map<
    string,
    THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  >;
  symbolCapacities: Map<string, number>;
  symbolCounts: Map<string, number>;
  matrix: THREE.Matrix4;
  billboardQuaternion: THREE.Quaternion;
  iconQuaternion: THREE.Quaternion;
  localRotation: THREE.Quaternion;
  instancePosition: THREE.Vector3;
  scale: THREE.Vector3;
};

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

type RenderQualityConfig = Readonly<{
  mode: RenderQualityMode;
  maxRenderPixelRatio: number;
  minRenderPixelRatio: number;
  pixelRatioStep: number;
  lowFpsPixelRatioThreshold: number;
  planetGlowEnabled: boolean;
  planetGlowBillboardScale: number;
  ringThetaSegments: number;
  ringPhiSegments: number;
  cullPlanetAtmosphere: boolean;
  cullPlanetRings: boolean;
}>;

type TacticalGrid = Readonly<{
  root: THREE.Group;
  grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  intersection: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}>;

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

type ProjectileParticle = {
  owner: PlayerId;
  start: THREE.Vector3;
  end: THREE.Vector3;
  spawnedAt: number;
  durationMs: number;
};

type ProjectileParticleRenderer = {
  root: THREE.Group;
  geometry: THREE.PlaneGeometry;
  materials: Map<PlayerId, THREE.MeshBasicMaterial>;
  meshes: Map<
    PlayerId,
    THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  >;
  capacities: Map<PlayerId, number>;
  counts: Map<PlayerId, number>;
  particles: ProjectileParticle[];
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  billboardQuaternion: THREE.Quaternion;
};

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
  cameraRight: THREE.Vector3;
  cameraUp: THREE.Vector3;
  cameraForward: THREE.Vector3;
  screenPosition: THREE.Vector2;
  sunScreenPosition: THREE.Vector4;
};

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

const HUD_UPDATE_INTERVAL_MS = 500;
const PERF_DATASET_INTERVAL_MS = 500;
const PIXEL_RATIO_ADJUST_INTERVAL_MS = 1500;
const MAX_SIM_STEPS_PER_FRAME = 5;
const MAX_SIM_FRAME_DELTA_MS = 250;
const INITIAL_INSTANCE_CAPACITY = 64;
const UNIT_SYMBOL_SCALE = 2.4;
const SELECTION_RING_SCALE = 4;
const PROJECTILE_PARTICLE_DURATION_MS = 240;
const PROJECTILE_PARTICLE_SCALE = 1.8;
const CINEMATIC_PROJECTILE_PARTICLE_SCALE = 2.45;
const PLANET_SELECTION_MIN_RADIUS_PX = 10;
const CAMERA_FOCUS_TWEEN_MS = 720;
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
const PLANET_BODY_BILLBOARD_SCALE = 2.12;
const PLANET_RING_INNER_RADIUS = 1.18;
const PLANET_RING_OUTER_RADIUS = 2.05;
const DEFAULT_RENDER_QUALITY_MODE: RenderQualityMode = "interactive";
const RENDER_QUALITY_CONFIGS: Record<RenderQualityMode, RenderQualityConfig> = {
  interactive: {
    mode: "interactive",
    maxRenderPixelRatio: 1,
    minRenderPixelRatio: 0.7,
    pixelRatioStep: 0.15,
    lowFpsPixelRatioThreshold: 58,
    planetGlowEnabled: false,
    planetGlowBillboardScale: 2.42,
    ringThetaSegments: 128,
    ringPhiSegments: 4,
    cullPlanetAtmosphere: true,
    cullPlanetRings: true,
  },
  cinematic: {
    mode: "cinematic",
    maxRenderPixelRatio: 1.25,
    minRenderPixelRatio: 1,
    pixelRatioStep: 0.1,
    lowFpsPixelRatioThreshold: 55,
    planetGlowEnabled: true,
    planetGlowBillboardScale: 3.08,
    ringThetaSegments: 256,
    ringPhiSegments: 8,
    cullPlanetAtmosphere: false,
    cullPlanetRings: false,
  },
};
const GAS_GIANT_PALETTE_THEMES: readonly GasGiantPaletteTheme[] = [
  [0x101a38, 0x315a9e, 0xc8d9ff, 0xe1b46d],
  [0x1a102b, 0x67449b, 0xdfc4ff, 0xe87fa3],
  [0x26140d, 0x9c4e24, 0xf0c06e, 0x7f2e21],
  [0x10241d, 0x4f7e5d, 0xd8d19b, 0x95b75e],
  [0x172232, 0x5d7287, 0xe4d4b6, 0xd09352],
];
const Z_AXIS = new THREE.Vector3(0, 0, 1);
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
  const renderQuality =
    RENDER_QUALITY_CONFIGS[options.renderMode ?? DEFAULT_RENDER_QUALITY_MODE];
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

  let activeRenderPixelRatio = getPreferredRenderPixelRatio(renderQuality);
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
  const projectileParticles = createProjectileParticleRenderer(renderQuality);
  worldGroup.add(projectileParticles.root);
  const planetProxies = new Map<string, PlanetProxy>();
  const planetGeometry = new THREE.PlaneGeometry(1, 1);
  const planetRingGeometry = createPlanetRingGeometry(renderQuality);
  const gasGiantTextures = createGasGiantTextureSet();
  const planetMaterial = createPlanetBillboardMaterial(
    gasGiantTextures,
    renderQuality.mode
  );
  const planetGlowMaterial = renderQuality.planetGlowEnabled
    ? createPlanetGlowMaterial(gasGiantTextures, renderQuality.mode)
    : null;
  const planetRingMaterial = createPlanetRingMaterial();
  const gravityOverlay = createGravityOverlay();
  worldGroup.add(gravityOverlay.root);
  const selectedUnitKeys = new Set<string>();
  let selectedPlanetKey: string | null = null;
  let commandMenuLeaderKey: string | null = null;
  let tacticalOverlayEnabled = false;
  const statsLayer = createStatsLayer(container);
  const selectionBox = createSelectionBox(container);
  const cameraPresetControls = createCameraPresetControls(container, (preset) => {
    applyCameraPreset(cameraControls, preset);
  });
  const topLeftControls = createTopLeftControls(container);
  const tacticalOverlayControls = createTacticalOverlayControls(
    topLeftControls,
    (enabled) => {
      tacticalOverlayEnabled = enabled;
      setTacticalOverlayEnabled(
        gravityOverlay,
        tacticalOverlayControls,
        enabled
      );
    }
  );
  createRandomSeedControl(topLeftControls);
  createRenderModeControl(topLeftControls, renderQuality.mode);
  const leaderArrow = createSelectedLeaderArrow(container);
  const commandMenu = createCommandMenu(container, {
    onSelectLeader(unitKey) {
      commandMenuLeaderKey = unitKey;
    },
    onEscortLeader() {
      issueEscortLeaderOrder(runtime, selectedUnitKeys, commandMenuLeaderKey);
    },
  });
  const renderResolution = new THREE.Vector2();
  const scratch = createRenderScratch();
  const cameraFocusTween = createCameraFocusTween();

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
      commandMenuLeaderKey = null;
      return;
    }

    if (key === "c" || key === "g") {
      if (
        issuePlanetOrderFromSelection(
          runtime,
          selectedUnitKeys,
          selectedPlanetKey,
          key === "c" ? "capturePlanet" : "guardPlanet"
        )
      ) {
        event.preventDefault();
      }
      return;
    }

    if (key === "t") {
      tacticalOverlayEnabled = !tacticalOverlayEnabled;
      setTacticalOverlayEnabled(
        gravityOverlay,
        tacticalOverlayControls,
        tacticalOverlayEnabled
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
      commandMenuLeaderKey = pruneCommandMenuLeaderKey(
        commandMenuLeaderKey,
        selectedUnitKeys
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
        selectedPlanetKey =
          selectedPlanet.key === selectedPlanetKey ? null : selectedPlanet.key;
        issuePlanetOrderFromSelection(
          runtime,
          selectedUnitKeys,
          selectedPlanet.key,
          "capturePlanet"
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
        selectedPlanetKey,
        selectedUnitKeys
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
      estimatedFps >= renderQuality.lowFpsPixelRatioThreshold ||
      activeRenderPixelRatio <= renderQuality.minRenderPixelRatio
    ) {
      return;
    }

    activeRenderPixelRatio = Math.max(
      renderQuality.minRenderPixelRatio,
      Number((activeRenderPixelRatio - renderQuality.pixelRatioStep).toFixed(2))
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
    pruneSelectedUnitKeys(selectedUnitKeys, units);
    commandMenuLeaderKey = pruneCommandMenuLeaderKey(
      commandMenuLeaderKey,
      selectedUnitKeys
    );
    const selectedPlanet = getSelectedPlanet(planets, selectedPlanetKey);
    const focus = writeCameraFocusPosition(
      scratch.focus,
      units,
      planets,
      selectedPlanetKey,
      selectedUnitKeys
    );
    const displayedFocus = updateCameraFocusTween(
      cameraFocusTween,
      readCameraFocusContextKey(selectedPlanetKey, selectedUnitKeys),
      focus,
      now
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
    applyCameraControls(camera, cameraControls, container, displayedFocus, scratch);
    camera.updateMatrixWorld();
    updateSelectedLeaderArrow(
      leaderArrow,
      units.find((unit) => unit.key === commandMenuLeaderKey) ?? null,
      camera,
      container,
      scratch
    );
    updateLighting(lighting, sunDirection, sunColor);
    updateUnitBatches(
      unitBatches,
      units,
      selectedUnitKeys,
      camera,
      interpolationAlpha
    );
    addProjectileEvents(projectileParticles, runtime.drainEvents(), now);
    updateProjectileParticles(
      projectileParticles,
      now,
      camera,
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
    updateTacticalGrid(tacticalGrid, selectedPlanet, tacticalOverlayEnabled);
    updateGravityOverlay(
      gravityOverlay,
      selectedPlanet,
      selectedPlanet ? [selectedPlanet] : []
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
      container.dataset.cameraFocus = selectedPlanet?.label ?? "units";
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
      container.dataset.gravityOverlay = tacticalOverlayEnabled ? "on" : "off";
      container.dataset.renderMode = renderQuality.mode;
      container.dataset.playerId = runtime.playerId.toString();
      container.dataset.connectionState = runtime.readConnectionStatus().state;
      container.dataset.simHz = observedSimHz.toFixed(1);
      container.dataset.simInterpolationAlpha = interpolationAlpha.toFixed(3);
      updateCameraPresetControls(cameraPresetControls, cameraControls.preset);
      updateCommandMenu(
        commandMenu,
        units.filter((unit) => selectedUnitKeys.has(unit.key)),
        commandMenuLeaderKey
      );
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
        renderQuality.mode,
        formatSelectedPlanetStatus(runtime, selectedPlanet),
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
      selectedPlanetKey,
      selectedUnitKeys
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
      disposeProjectileParticleRenderer(projectileParticles);
      disposeGravityOverlay(gravityOverlay);
      disposeTacticalGrid(tacticalGrid);
      disposePlanetProxies(worldGroup, planetProxies);
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

function getPreferredRenderPixelRatio(
  renderQuality: RenderQualityConfig
): number {
  return clamp(
    window.devicePixelRatio,
    renderQuality.minRenderPixelRatio,
    renderQuality.maxRenderPixelRatio
  );
}

function createSelectedLeaderArrow(container: HTMLElement): HTMLElement {
  const arrow = document.createElement("div");
  arrow.className = "selected-leader-arrow";
  arrow.hidden = true;
  container.appendChild(arrow);
  return arrow;
}

function updateSelectedLeaderArrow(
  arrow: HTMLElement,
  leader: UnitViewModel | null,
  camera: THREE.Camera,
  container: HTMLElement,
  scratch: RenderScratch
): void {
  if (!leader) {
    arrow.hidden = true;
    return;
  }

  const projected = scratch.projected.copy(leader.position).project(camera);

  if (projected.z < -1 || projected.z > 1) {
    arrow.hidden = true;
    return;
  }

  const x = (projected.x * 0.5 + 0.5) * container.clientWidth;
  const y = (-projected.y * 0.5 + 0.5) * container.clientHeight - 24;

  arrow.hidden = false;
  arrow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
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
    cameraRight: new THREE.Vector3(1, 0, 0),
    cameraUp: new THREE.Vector3(0, 1, 0),
    cameraForward: new THREE.Vector3(0, 0, 1),
    screenPosition: new THREE.Vector2(),
    sunScreenPosition: new THREE.Vector4(),
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
  selectedPlanetKey: string | null,
  selectedUnitKeys: ReadonlySet<string>
): THREE.Vector3 {
  if (tween.initialized) {
    return target.copy(tween.current);
  }

  return writeCameraFocusPosition(
    target,
    units,
    planets,
    selectedPlanetKey,
    selectedUnitKeys
  );
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
  selectedPlanetKey: string | null,
  selectedUnitKeys: ReadonlySet<string>
): THREE.Vector3 {
  const planet = getSelectedPlanet(planets, selectedPlanetKey);

  if (planet) {
    return target.copy(planet.position);
  }

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

function readCameraFocusContextKey(
  selectedPlanetKey: string | null,
  selectedUnitKeys: ReadonlySet<string>
): string {
  if (selectedPlanetKey) {
    return `planet:${selectedPlanetKey}`;
  }

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

function issuePlanetOrderFromSelection(
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  selectedPlanetKey: string | null,
  orderType: "capturePlanet" | "guardPlanet"
): boolean {
  if (!selectedPlanetKey || selectedUnitKeys.size === 0) {
    return false;
  }

  const planet = runtime
    .readPlanets()
    .find((entry) => entry.key === selectedPlanetKey);

  if (!planet) {
    return false;
  }

  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );

  if (selectedUnits.length === 0) {
    return false;
  }

  runtime.enqueueUnitOrder(
    selectedUnits.map((unit) => unit.handle),
    {
      type: orderType,
      planet: planet.handle,
    }
  );
  return true;
}

function issueEscortLeaderOrder(
  runtime: LocalGameRuntime,
  selectedUnitKeys: ReadonlySet<string>,
  leaderKey: string | null
): boolean {
  if (!leaderKey || selectedUnitKeys.size < 2) {
    return false;
  }

  const selectedUnits = runtime
    .readUnits()
    .filter(
      (unit) =>
        unit.owner === runtime.playerId && selectedUnitKeys.has(unit.key)
    );
  const leader = selectedUnits.find((unit) => unit.key === leaderKey);

  if (!leader) {
    return false;
  }

  const escortUnits = selectedUnits.filter((unit) => unit.key !== leader.key);

  if (escortUnits.length === 0) {
    return false;
  }

  runtime.enqueueUnitOrder(
    escortUnits.map((unit) => unit.handle),
    {
      type: "escort",
      target: leader.handle,
    }
  );
  return true;
}

function formatSelectedPlanetStatus(
  runtime: LocalGameRuntime,
  planet: PlanetViewModel | null
): string {
  if (!planet) {
    return "none";
  }

  if (!planet.control.capturable) {
    return `${planet.label} neutral`;
  }

  const owner =
    planet.control.owner === 0
      ? "Neutral"
      : runtime.world.config.players.find(
          (player) => player.id === planet.control.owner
        )?.name ?? `Player ${planet.control.owner}`;

  if (planet.control.contested) {
    return `${planet.label} ${owner} contested`;
  }

  if (planet.control.capturingPlayer !== 0) {
    const rules =
      runtime.world.config.captureDemoRules ?? DEFAULT_CAPTURE_DEMO_RULES;
    const requiredTicks = rules.planetCaptureSeconds * PHASE_ONE_SIM_HZ;
    const progress = Math.min(
      100,
      (planet.control.captureTicks / Math.max(requiredTicks, 1)) * 100
    );

    return `${planet.label} ${owner} capture ${progress.toFixed(0)}%`;
  }

  return `${planet.label} ${owner}`;
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
      unit.shipClassId === SHIP_CLASS_IDS.fighter
        ? yawFromQuaternion(unit.rotation)
        : 0
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
  key: string,
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
  key: string,
  unit: UnitViewModel
): THREE.MeshBasicMaterial {
  let material = batches.symbolMaterials.get(key);

  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: createUnitSymbolTexture(unit.color, unit.owner, unit.shipClassId),
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

function getUnitSymbolBatchKey(unit: UnitViewModel): string {
  return `${unit.owner}:${unit.shipClassId}`;
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

function createProjectileParticleRenderer(
  renderQuality: RenderQualityConfig
): ProjectileParticleRenderer {
  const root = new THREE.Group();
  root.name = "projectile-particles";

  return {
    root,
    geometry: new THREE.PlaneGeometry(1, 1),
    materials: new Map([
      [1, createProjectileParticleMaterial(0x74d9ff, renderQuality)],
      [2, createProjectileParticleMaterial(0xff4fd8, renderQuality)],
    ]),
    meshes: new Map(),
    capacities: new Map(),
    counts: new Map(),
    particles: [],
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    billboardQuaternion: new THREE.Quaternion(),
  };
}

function createProjectileParticleMaterial(
  color: number,
  renderQuality: RenderQualityConfig
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: renderQuality.mode === "cinematic" ? 0.92 : 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

function addProjectileEvents(
  renderer: ProjectileParticleRenderer,
  events: readonly SimEvent[],
  now: number
): void {
  for (const event of events) {
    if (event.type !== "weaponFired") {
      continue;
    }

    renderer.particles.push({
      owner: event.owner,
      start: new THREE.Vector3(event.start.x, event.start.y, event.start.z),
      end: new THREE.Vector3(event.end.x, event.end.y, event.end.z),
      spawnedAt: now,
      durationMs: PROJECTILE_PARTICLE_DURATION_MS,
    });
  }
}

function updateProjectileParticles(
  renderer: ProjectileParticleRenderer,
  now: number,
  camera: THREE.Camera,
  renderQuality: RenderQualityConfig
): void {
  renderer.particles = renderer.particles.filter(
    (particle) => now - particle.spawnedAt <= particle.durationMs
  );

  for (const key of renderer.counts.keys()) {
    renderer.counts.set(key, 0);
  }

  for (const particle of renderer.particles) {
    renderer.counts.set(
      particle.owner,
      (renderer.counts.get(particle.owner) ?? 0) + 1
    );
  }

  for (const [owner, count] of renderer.counts) {
    if (count > 0) {
      ensureProjectileParticleCapacity(renderer, owner, count);
    }
  }

  renderer.billboardQuaternion.copy(camera.quaternion);

  for (const key of renderer.counts.keys()) {
    renderer.counts.set(key, 0);
  }

  for (const particle of renderer.particles) {
    const mesh = renderer.meshes.get(particle.owner);

    if (!mesh) {
      continue;
    }

    const age = clamp(
      (now - particle.spawnedAt) / Math.max(particle.durationMs, 1),
      0,
      1
    );
    const index = renderer.counts.get(particle.owner) ?? 0;
    const scale =
      renderQuality.mode === "cinematic"
        ? CINEMATIC_PROJECTILE_PARTICLE_SCALE
        : PROJECTILE_PARTICLE_SCALE;

    renderer.position.lerpVectors(particle.start, particle.end, age);
    renderer.scale.setScalar(scale * (1 - age * 0.35));
    renderer.matrix.compose(
      renderer.position,
      renderer.billboardQuaternion,
      renderer.scale
    );
    mesh.setMatrixAt(index, renderer.matrix);
    renderer.counts.set(particle.owner, index + 1);
  }

  for (const [owner, mesh] of renderer.meshes) {
    mesh.count = renderer.counts.get(owner) ?? 0;
    mesh.instanceMatrix.needsUpdate = mesh.count > 0;
  }
}

function ensureProjectileParticleCapacity(
  renderer: ProjectileParticleRenderer,
  owner: PlayerId,
  requiredCount: number
): void {
  const capacity = renderer.capacities.get(owner) ?? 0;

  if (capacity >= requiredCount) {
    return;
  }

  const previousMesh = renderer.meshes.get(owner);

  if (previousMesh) {
    renderer.root.remove(previousMesh);
    previousMesh.dispose();
  }

  const material =
    renderer.materials.get(owner) ??
    createProjectileParticleMaterial(owner === 1 ? 0x74d9ff : 0xff4fd8, {
      ...RENDER_QUALITY_CONFIGS.interactive,
    });
  const nextCapacity = nextInstanceCapacity(requiredCount);
  const mesh = new THREE.InstancedMesh(
    renderer.geometry,
    material,
    nextCapacity
  );
  mesh.name = `Player ${owner} projectile particles`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  renderer.meshes.set(owner, mesh);
  renderer.capacities.set(owner, nextCapacity);
  renderer.root.add(mesh);
}

function disposeProjectileParticleRenderer(
  renderer: ProjectileParticleRenderer
): void {
  for (const mesh of renderer.meshes.values()) {
    renderer.root.remove(mesh);
    mesh.dispose();
  }

  for (const material of renderer.materials.values()) {
    material.dispose();
  }

  renderer.geometry.dispose();
  renderer.meshes.clear();
  renderer.materials.clear();
  renderer.capacities.clear();
  renderer.counts.clear();
  renderer.particles.splice(0);
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
  enabled: boolean
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
  tacticalGrid.root.scale.setScalar(context.radius);
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
        context.position.y,
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

function yawFromQuaternion(quaternion: THREE.Quaternion): number {
  return Math.atan2(
    2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
