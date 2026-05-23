import * as THREE from "three";
import {
  type PlanetClass,
} from "@drop-ship/protocol";
import {
  FULLSCREEN_VERTEX_SHADER,
  PLANET_BILLBOARD_FRAGMENT_SHADER,
  PLANET_BILLBOARD_VERTEX_SHADER,
  PLANET_GLOW_FRAGMENT_SHADER,
  PLANET_RING_FRAGMENT_SHADER,
  PLANET_RING_VERTEX_SHADER,
  SUN_FLARE_FRAGMENT_SHADER,
} from "./shaders";
import type { PlanetViewModel, RenderQualityMode } from "../types";

type GasGiantTextureSet = Readonly<{
  grunge: THREE.Texture;
  noise: THREE.Texture;
}>;

type PlanetStatsRenderCacheEntry = Readonly<{
  imageUrl: string;
  renderTarget: THREE.WebGLRenderTarget;
}>;

export type PlanetStatsRenderCache = Readonly<{
  readImageUrl: (
    planet: PlanetViewModel,
    sunDirection: THREE.Vector3
  ) => string;
  dispose: () => void;
}>;

const PLANET_STATS_RENDER_WIDTH = 384;
const PLANET_STATS_RENDER_HEIGHT = 192;
const PLANET_STATS_ASPECT = PLANET_STATS_RENDER_WIDTH / PLANET_STATS_RENDER_HEIGHT;
const PLANET_PREVIEW_TIME_SECONDS = 41.7;
const PLANET_PREVIEW_BODY_SCALE = 0.94;
const PLANET_PREVIEW_GLOW_SCALE = 1.56;
const PLANET_PREVIEW_RING_SCALE = 0.37;
const PLANET_PREVIEW_GLOW_NOISE_SCALE = 2.85;
const PLANET_PREVIEW_GLOW_NOISE_STRENGTH = 2.45;
const PLANET_PREVIEW_GLOW_OPACITY_FALLOFF = 0.82;
const PLANET_RING_INNER_RADIUS = 1.18;
const PLANET_RING_OUTER_RADIUS = 2.05;
const GAS_GIANT_PALETTE_THEMES: readonly GasGiantPaletteTheme[] = [
  [0x101a38, 0x315a9e, 0xc8d9ff, 0xe1b46d],
  [0x1a102b, 0x67449b, 0xdfc4ff, 0xe87fa3],
  [0x26140d, 0x9c4e24, 0xf0c06e, 0x7f2e21],
  [0x10241d, 0x4f7e5d, 0xd8d19b, 0x95b75e],
  [0x172232, 0x5d7287, 0xe4d4b6, 0xd09352],
];
const PREVIEW_CAMERA_RIGHT = new THREE.Vector3(1, 0, 0);
const PREVIEW_CAMERA_UP = new THREE.Vector3(0, 1, 0);
const PREVIEW_CAMERA_FORWARD = new THREE.Vector3(0, 0, 1);
const PREVIEW_CLEAR_COLOR = new THREE.Color(0x030611);
const PREVIEW_SUN_DIRECTION = new THREE.Vector3();
const PREVIEW_PREVIOUS_CLEAR_COLOR = new THREE.Color();
const GAS_GIANT_BASE_COLOR_SCRATCH = new THREE.Color();
const GAS_GIANT_PALETTE_COLOR_SCRATCH = new THREE.Color();
const PIXEL_READ_BUFFER = new Uint8Array(
  PLANET_STATS_RENDER_WIDTH * PLANET_STATS_RENDER_HEIGHT * 4
);

type GasGiantPaletteTheme = readonly [number, number, number, number];

export function createPlanetStatsRenderCache(
  renderer: THREE.WebGLRenderer,
  gasGiantTextures: GasGiantTextureSet
): PlanetStatsRenderCache {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    -PLANET_STATS_ASPECT,
    PLANET_STATS_ASPECT,
    1,
    -1,
    0.1,
    10
  );
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const geometry = new THREE.PlaneGeometry(1, 1);
  const sunFlareGeometry = new THREE.PlaneGeometry(2, 2);
  const ringGeometry = new THREE.RingGeometry(
    PLANET_RING_INNER_RADIUS,
    PLANET_RING_OUTER_RADIUS,
    256,
    8
  );
  const glowMaterial = createPlanetGlowMaterial(gasGiantTextures);
  const bodyMaterial = createPlanetBillboardMaterial(gasGiantTextures);
  const ringMaterial = createPlanetRingMaterial();
  const sunFlareMaterial = createSunFlarePreviewMaterial();
  const glow = new THREE.Mesh(geometry, glowMaterial);
  const body = new THREE.Mesh(geometry, bodyMaterial);
  const rings = new THREE.Mesh(ringGeometry, ringMaterial);
  const sunFlare = new THREE.Mesh(sunFlareGeometry, sunFlareMaterial);
  const entries = new Map<string, PlanetStatsRenderCacheEntry>();
  const canvas = document.createElement("canvas");
  canvas.width = PLANET_STATS_RENDER_WIDTH;
  canvas.height = PLANET_STATS_RENDER_HEIGHT;
  const canvasContext = canvas.getContext("2d");

  if (!canvasContext) {
    throw new Error("Unable to create planet stats preview canvas");
  }

  const imageData = canvasContext.createImageData(
    PLANET_STATS_RENDER_WIDTH,
    PLANET_STATS_RENDER_HEIGHT
  );

  glow.name = "selected planet stats preview glow";
  glow.scale.setScalar(PLANET_PREVIEW_GLOW_SCALE);
  glow.renderOrder = 1;
  body.name = "selected planet stats preview billboard";
  body.scale.setScalar(PLANET_PREVIEW_BODY_SCALE);
  body.renderOrder = 2;
  rings.name = "selected planet stats preview rings";
  rings.scale.setScalar(PLANET_PREVIEW_RING_SCALE);
  rings.rotation.set(-0.92, 0.18, -0.18);
  rings.renderOrder = 3;
  rings.visible = false;
  sunFlare.name = "selected sun stats preview flare";
  sunFlare.renderOrder = 4;
  sunFlare.visible = false;
  scene.add(glow, body, rings, sunFlare);

  function readImageUrl(
    planet: PlanetViewModel,
    sunDirection: THREE.Vector3
  ): string {
    const key = createPlanetStatsRenderKey(planet, sunDirection);
    const cached = entries.get(key);

    if (cached) {
      return cached.imageUrl;
    }

    const renderTarget = new THREE.WebGLRenderTarget(
      PLANET_STATS_RENDER_WIDTH,
      PLANET_STATS_RENDER_HEIGHT,
      {
        depthBuffer: true,
        stencilBuffer: false,
      }
    );
    renderTarget.texture.name = `${planet.label} selected stats render`;
    renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    renderTarget.texture.generateMipmaps = false;
    renderTarget.texture.minFilter = THREE.LinearFilter;
    renderTarget.texture.magFilter = THREE.LinearFilter;

    renderPlanetStatsPreview(
      renderer,
      scene,
      camera,
      renderTarget,
      planet,
      sunDirection,
      glow,
      body,
      bodyMaterial,
      glowMaterial,
      ringMaterial,
      rings,
      sunFlare,
      sunFlareMaterial
    );

    const entry = {
      imageUrl: readRenderTargetImageUrl(
        renderer,
        renderTarget,
        canvas,
        canvasContext,
        imageData
      ),
      renderTarget,
    };
    entries.set(key, entry);
    return entry.imageUrl;
  }

  function dispose(): void {
    for (const entry of entries.values()) {
      entry.renderTarget.dispose();
    }

    entries.clear();
    geometry.dispose();
    sunFlareGeometry.dispose();
    ringGeometry.dispose();
    glowMaterial.dispose();
    bodyMaterial.dispose();
    ringMaterial.dispose();
    sunFlareMaterial.dispose();
  }

  return {
    readImageUrl,
    dispose,
  };
}

function renderPlanetStatsPreview(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  renderTarget: THREE.WebGLRenderTarget,
  planet: PlanetViewModel,
  sunDirection: THREE.Vector3,
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  bodyMaterial: THREE.ShaderMaterial,
  glowMaterial: THREE.ShaderMaterial,
  ringMaterial: THREE.ShaderMaterial,
  rings: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>,
  sunFlare: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  sunFlareMaterial: THREE.ShaderMaterial
): void {
  PREVIEW_SUN_DIRECTION.copy(sunDirection);

  if (PREVIEW_SUN_DIRECTION.lengthSq() <= 0.000001) {
    PREVIEW_SUN_DIRECTION.set(-0.3, 0.45, 0.84);
  }

  PREVIEW_SUN_DIRECTION.normalize();

  if (isSunPlanetView(planet)) {
    glow.visible = false;
    body.visible = false;
    rings.visible = false;
    sunFlare.visible = true;
    sunFlareMaterial.uniforms.uResolution.value.set(
      PLANET_STATS_RENDER_WIDTH,
      PLANET_STATS_RENDER_HEIGHT
    );
    sunFlareMaterial.uniforms.uSunPosition.value.set(0.5, 0.5);
    sunFlareMaterial.uniforms.uSunColor.value.set(planet.color);
    sunFlareMaterial.uniforms.uVisibility.value = 1;
    sunFlareMaterial.uniforms.uTime.value = PLANET_PREVIEW_TIME_SECONDS;
  } else {
    glow.visible = true;
    body.visible = true;
    sunFlare.visible = false;
    writeBillboardUniforms(bodyMaterial, planet, PREVIEW_SUN_DIRECTION);
    writeBillboardUniforms(glowMaterial, planet, PREVIEW_SUN_DIRECTION, {
      previewGlow: true,
    });
    ringMaterial.uniforms.uSunDirection.value.copy(PREVIEW_SUN_DIRECTION);
    ringMaterial.uniforms.uPlanetColor.value.set(planet.color);
    ringMaterial.uniforms.uPlanetSeed.value = planet.appearance.seed;
    writePlanetRingEllipse(
      ringMaterial.uniforms.uRingEllipse.value,
      planet.appearance.seed
    );
    rings.visible = planet.appearance.hasRings;
  }

  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousClearAlpha = renderer.getClearAlpha();
  renderer.getClearColor(PREVIEW_PREVIOUS_CLEAR_COLOR);

  renderer.setRenderTarget(renderTarget);
  renderer.setClearColor(PREVIEW_CLEAR_COLOR, 1);
  renderer.autoClear = true;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(PREVIEW_PREVIOUS_CLEAR_COLOR, previousClearAlpha);
  renderer.autoClear = previousAutoClear;
}

function isSunPlanetView(planet: PlanetViewModel): boolean {
  return planet.appearance.planetClass === "sun";
}

function readRenderTargetImageUrl(
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  imageData: ImageData
): string {
  renderer.readRenderTargetPixels(
    renderTarget,
    0,
    0,
    PLANET_STATS_RENDER_WIDTH,
    PLANET_STATS_RENDER_HEIGHT,
    PIXEL_READ_BUFFER
  );

  for (let y = 0; y < PLANET_STATS_RENDER_HEIGHT; y += 1) {
    const sourceRow = PLANET_STATS_RENDER_HEIGHT - 1 - y;
    const sourceOffset = sourceRow * PLANET_STATS_RENDER_WIDTH * 4;
    const targetOffset = y * PLANET_STATS_RENDER_WIDTH * 4;
    imageData.data.set(
      PIXEL_READ_BUFFER.subarray(
        sourceOffset,
        sourceOffset + PLANET_STATS_RENDER_WIDTH * 4
      ),
      targetOffset
    );
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function writeBillboardUniforms(
  material: THREE.ShaderMaterial,
  planet: PlanetViewModel,
  sunDirection: THREE.Vector3,
  options: Readonly<{
    previewGlow: boolean;
  }> = { previewGlow: false }
): void {
  material.uniforms.uSunDirection.value.copy(sunDirection);
  material.uniforms.uPlanetColor.value.set(planet.color);
  writeGasGiantPaletteUniforms(material, planet);
  material.uniforms.uPlanetClass.value = planetClassToShaderValue(
    planet.appearance.planetClass
  );
  material.uniforms.uPlanetSeed.value = planet.appearance.seed;
  material.uniforms.uCameraRight.value.copy(PREVIEW_CAMERA_RIGHT);
  material.uniforms.uCameraUp.value.copy(PREVIEW_CAMERA_UP);
  material.uniforms.uCameraForward.value.copy(PREVIEW_CAMERA_FORWARD);
  material.uniforms.uTime.value = PLANET_PREVIEW_TIME_SECONDS;
  material.uniforms.uRenderMode.value = renderQualityToShaderValue("cinematic");

  if (material.uniforms.uGlowNoiseScale) {
    material.uniforms.uGlowNoiseScale.value = options.previewGlow
      ? PLANET_PREVIEW_GLOW_NOISE_SCALE
      : 1;
  }

  if (material.uniforms.uGlowNoiseStrength) {
    material.uniforms.uGlowNoiseStrength.value = options.previewGlow
      ? PLANET_PREVIEW_GLOW_NOISE_STRENGTH
      : 1;
  }

  if (material.uniforms.uGlowOpacityFalloff) {
    material.uniforms.uGlowOpacityFalloff.value = options.previewGlow
      ? PLANET_PREVIEW_GLOW_OPACITY_FALLOFF
      : 0;
  }
}

function createPlanetBillboardMaterial(
  gasGiantTextures: GasGiantTextureSet
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { CINEMATIC_RENDER: "1" },
    uniforms: {
      uSunDirection: { value: PREVIEW_SUN_DIRECTION.clone() },
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uGasPaletteShadow: { value: new THREE.Color(0x101a38) },
      uGasPaletteLow: { value: new THREE.Color(0x315a9e) },
      uGasPaletteHigh: { value: new THREE.Color(0xc8d9ff) },
      uGasPaletteAccent: { value: new THREE.Color(0xe1b46d) },
      uGasGrungeTexture: { value: gasGiantTextures.grunge },
      uGasNoiseTexture: { value: gasGiantTextures.noise },
      uPlanetClass: { value: 1 },
      uPlanetSeed: { value: 113 },
      uCameraRight: { value: PREVIEW_CAMERA_RIGHT.clone() },
      uCameraUp: { value: PREVIEW_CAMERA_UP.clone() },
      uCameraForward: { value: PREVIEW_CAMERA_FORWARD.clone() },
      uTime: { value: PLANET_PREVIEW_TIME_SECONDS },
      uRenderMode: { value: renderQualityToShaderValue("cinematic") },
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
  gasGiantTextures: GasGiantTextureSet
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPlanetColor: { value: new THREE.Color(0x376fae) },
      uGasPaletteShadow: { value: new THREE.Color(0x101a38) },
      uGasPaletteLow: { value: new THREE.Color(0x315a9e) },
      uGasPaletteHigh: { value: new THREE.Color(0xc8d9ff) },
      uGasPaletteAccent: { value: new THREE.Color(0xe1b46d) },
      uSunDirection: { value: PREVIEW_SUN_DIRECTION.clone() },
      uCameraRight: { value: PREVIEW_CAMERA_RIGHT.clone() },
      uCameraUp: { value: PREVIEW_CAMERA_UP.clone() },
      uCameraForward: { value: PREVIEW_CAMERA_FORWARD.clone() },
      uGasNoiseTexture: { value: gasGiantTextures.noise },
      uPlanetClass: { value: 1 },
      uPlanetSeed: { value: 113 },
      uTime: { value: PLANET_PREVIEW_TIME_SECONDS },
      uRenderMode: { value: renderQualityToShaderValue("cinematic") },
      uGlowNoiseScale: { value: PLANET_PREVIEW_GLOW_NOISE_SCALE },
      uGlowNoiseStrength: { value: PLANET_PREVIEW_GLOW_NOISE_STRENGTH },
      uGlowOpacityFalloff: { value: PLANET_PREVIEW_GLOW_OPACITY_FALLOFF },
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
      uSunDirection: { value: PREVIEW_SUN_DIRECTION.clone() },
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

function createSunFlarePreviewMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uResolution: {
        value: new THREE.Vector2(
          PLANET_STATS_RENDER_WIDTH,
          PLANET_STATS_RENDER_HEIGHT
        ),
      },
      uSunPosition: { value: new THREE.Vector2(0.5, 0.5) },
      uSunColor: { value: new THREE.Color(0xffd27a) },
      uVisibility: { value: 1 },
      uTime: { value: PLANET_PREVIEW_TIME_SECONDS },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: SUN_FLARE_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
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
    readSeededFraction(planet.appearance.seed, 2.731) *
      GAS_GIANT_PALETTE_THEMES.length
  );
  const secondaryOffset =
    1 +
    Math.floor(
      readSeededFraction(planet.appearance.seed, 8.193) *
        (GAS_GIANT_PALETTE_THEMES.length - 1)
    );
  const secondaryIndex =
    (primaryIndex + secondaryOffset) % GAS_GIANT_PALETTE_THEMES.length;
  const primary = GAS_GIANT_PALETTE_THEMES[primaryIndex];
  const secondary = GAS_GIANT_PALETTE_THEMES[secondaryIndex];
  const paletteMix =
    0.12 + readSeededFraction(planet.appearance.seed, 13.917) * 0.34;
  const baseMix =
    0.1 + readSeededFraction(planet.appearance.seed, 19.441) * 0.16;

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

function createPlanetStatsRenderKey(
  planet: PlanetViewModel,
  sunDirection: THREE.Vector3
): string {
  return [
    planet.color.trim().toLowerCase(),
    planet.hasAtmosphere ? "atmosphere" : "vacuum",
    planet.appearance.planetClass,
    planet.appearance.hasRings ? "rings" : "plain",
    planet.appearance.seed.toFixed(4),
    sunDirection.x.toFixed(3),
    sunDirection.y.toFixed(3),
    sunDirection.z.toFixed(3),
  ].join(":");
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
    case "sun":
      return 0;
  }
}

function renderQualityToShaderValue(renderMode: RenderQualityMode): number {
  return renderMode === "cinematic" ? 1 : 0;
}
