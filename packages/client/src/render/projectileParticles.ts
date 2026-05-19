import * as THREE from "three";
import type { PlayerId } from "@drop-ship/protocol";
import type { SimEvent } from "@drop-ship/sim";
import { nextInstanceCapacity } from "./instancing";
import {
  RENDER_QUALITY_CONFIGS,
  type RenderQualityConfig,
} from "./renderQuality";
import { Z_AXIS, clamp, readWorldUnitsPerPixel } from "./renderMath";

type ProjectileParticle = {
  owner: PlayerId;
  start: THREE.Vector3;
  end: THREE.Vector3;
  spawnedAt: number;
  durationMs: number;
};

export type ProjectileParticleRenderer = {
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
  projectileQuaternion: THREE.Quaternion;
  localRotation: THREE.Quaternion;
  projectedStart: THREE.Vector3;
  projectedEnd: THREE.Vector3;
};

const PROJECTILE_PARTICLE_DURATION_MS = 240;
const PROJECTILE_PARTICLE_LENGTH_PX = 20;
const PROJECTILE_PARTICLE_WIDTH_PX = 2.4;
const CINEMATIC_PROJECTILE_PARTICLE_LENGTH_PX = 24;
const CINEMATIC_PROJECTILE_PARTICLE_WIDTH_PX = 3;

export function createProjectileParticleRenderer(
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
    projectileQuaternion: new THREE.Quaternion(),
    localRotation: new THREE.Quaternion(),
    projectedStart: new THREE.Vector3(),
    projectedEnd: new THREE.Vector3(),
  };
}

function createProjectileParticleMaterial(
  color: number,
  renderQuality: RenderQualityConfig
): THREE.MeshBasicMaterial {
  const map = createProjectileParticleTexture(color, renderQuality);

  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: renderQuality.mode === "cinematic" ? 0.96 : 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

function createProjectileParticleTexture(
  color: number,
  renderQuality: RenderQualityConfig
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create projectile particle canvas");
  }

  const projectileColor = new THREE.Color(color);
  const r = Math.round(projectileColor.r * 255);
  const g = Math.round(projectileColor.g * 255);
  const b = Math.round(projectileColor.b * 255);
  const alpha = renderQuality.mode === "cinematic" ? 0.92 : 0.76;
  const glowAlpha = renderQuality.mode === "cinematic" ? 0.22 : 0.1;
  const gradient = context.createLinearGradient(0, 16, 256, 16);

  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  gradient.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, ${alpha * 0.42})`);
  gradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`);
  gradient.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, ${alpha * 0.42})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  context.clearRect(0, 0, 256, 32);
  context.fillStyle = `rgba(${r}, ${g}, ${b}, ${glowAlpha})`;
  context.fillRect(24, 10, 208, 12);
  context.fillStyle = gradient;
  context.fillRect(0, 13, 256, 6);
  context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  context.fillRect(80, 14, 96, 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function addProjectileEvents(
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

export function updateProjectileParticles(
  renderer: ProjectileParticleRenderer,
  now: number,
  camera: THREE.Camera,
  container: HTMLElement,
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
  const worldUnitsPerPixel = readWorldUnitsPerPixel(camera, container);
  const projectileLengthPx =
    renderQuality.mode === "cinematic"
      ? CINEMATIC_PROJECTILE_PARTICLE_LENGTH_PX
      : PROJECTILE_PARTICLE_LENGTH_PX;
  const projectileWidthPx =
    renderQuality.mode === "cinematic"
      ? CINEMATIC_PROJECTILE_PARTICLE_WIDTH_PX
      : PROJECTILE_PARTICLE_WIDTH_PX;

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
    const fadeScale = 1 - age * 0.35;
    const screenRotation = readProjectileScreenRotation(renderer, particle, camera);

    renderer.position.lerpVectors(particle.start, particle.end, age);
    renderer.localRotation.setFromAxisAngle(Z_AXIS, screenRotation);
    renderer.projectileQuaternion
      .copy(renderer.billboardQuaternion)
      .multiply(renderer.localRotation);
    renderer.scale.set(
      projectileLengthPx * worldUnitsPerPixel * fadeScale,
      projectileWidthPx * worldUnitsPerPixel * fadeScale,
      1
    );
    renderer.matrix.compose(
      renderer.position,
      renderer.projectileQuaternion,
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

function readProjectileScreenRotation(
  renderer: ProjectileParticleRenderer,
  particle: ProjectileParticle,
  camera: THREE.Camera
): number {
  renderer.projectedStart.copy(particle.start).project(camera);
  renderer.projectedEnd.copy(particle.end).project(camera);

  const dx = renderer.projectedEnd.x - renderer.projectedStart.x;
  const dy = renderer.projectedEnd.y - renderer.projectedStart.y;

  if (dx * dx + dy * dy < 0.000001) {
    return 0;
  }

  return Math.atan2(dy, dx);
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

export function disposeProjectileParticleRenderer(
  renderer: ProjectileParticleRenderer
): void {
  for (const mesh of renderer.meshes.values()) {
    renderer.root.remove(mesh);
    mesh.dispose();
  }

  for (const material of renderer.materials.values()) {
    material.map?.dispose();
    material.dispose();
  }

  renderer.geometry.dispose();
  renderer.meshes.clear();
  renderer.materials.clear();
  renderer.capacities.clear();
  renderer.counts.clear();
  renderer.particles.splice(0);
}
