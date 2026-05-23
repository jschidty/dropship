import * as THREE from "three";
import { SHIP_CLASS_IDS } from "@drop-ship/protocol";
import type { PlanetViewModel, UnitViewModel } from "../types";
import { createSelectionRingTexture, createUnitSymbolTexture } from "./canvasTextures";
import { nextInstanceCapacity } from "./instancing";
import {
  Z_AXIS,
  readCameraViewHeight,
  yawFromQuaternion,
} from "./renderMath";

export type UnitBatchRenderer = {
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
  directionPosition: THREE.Vector3;
  projectedPosition: THREE.Vector3;
  projectedOccluder: THREE.Vector3;
  projectedDirection: THREE.Vector3;
  scale: THREE.Vector3;
};

export const UNIT_SYMBOL_SIZE_PX = 31.05;
const UNIT_SYMBOL_SCALE_BY_CLASS: Readonly<Record<number, number>> = {
  [SHIP_CLASS_IDS.fighter]: 0.75,
  [SHIP_CLASS_IDS.dropShip]: 1.3,
  [SHIP_CLASS_IDS.battleship]: 1.2,
};
const SELECTION_RING_SIZE_PX = 39.15;

export function createUnitBatchRenderer(): UnitBatchRenderer {
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
    directionPosition: new THREE.Vector3(),
    projectedPosition: new THREE.Vector3(),
    projectedOccluder: new THREE.Vector3(),
    projectedDirection: new THREE.Vector3(),
    scale: new THREE.Vector3(),
  };
}

export function updateUnitBatches(
  batches: UnitBatchRenderer,
  units: readonly UnitViewModel[],
  selectedUnitKeys: ReadonlySet<string>,
  hoveredUnitKey: string | null,
  planets: readonly PlanetViewModel[],
  camera: THREE.Camera,
  worldUnitsPerPixel: number,
  interpolationAlpha: number
): void {
  const symbolUnits = new Map<string, UnitViewModel>();
  const symbolOcclusion = new Map<string, boolean>();

  for (const key of batches.symbolCounts.keys()) {
    batches.symbolCounts.set(key, 0);
  }

  for (const unit of units) {
    const position = batches.instancePosition.lerpVectors(
      unit.prevPosition,
      unit.position,
      interpolationAlpha
    );
    const occluded = isUnitSymbolOccludedByPlanet(
      batches,
      position,
      planets,
      camera
    );
    const key = getUnitSymbolBatchKey(unit, occluded);
    batches.symbolCounts.set(key, (batches.symbolCounts.get(key) ?? 0) + 1);
    symbolUnits.set(key, unit);
    symbolOcclusion.set(key, occluded);
  }

  for (const [key, count] of batches.symbolCounts) {
    if (count > 0) {
      const unit = symbolUnits.get(key);
      const occluded = symbolOcclusion.get(key) ?? false;

      if (unit) {
        ensureSymbolMeshCapacity(batches, key, unit, count, occluded);
      }
    }
  }

  const selectionRingCount =
    selectedUnitKeys.size +
    (hoveredUnitKey && !selectedUnitKeys.has(hoveredUnitKey) ? 1 : 0);
  ensureSelectionMeshCapacity(batches, selectionRingCount);
  batches.billboardQuaternion.copy(camera.quaternion);

  for (const key of batches.symbolCounts.keys()) {
    batches.symbolCounts.set(key, 0);
  }

  let selectedCount = 0;

  for (const unit of units) {
    const position = batches.instancePosition.lerpVectors(
      unit.prevPosition,
      unit.position,
      interpolationAlpha
    );
    const symbolWorldUnitsPerPixel = readUnitBillboardWorldUnitsPerPixel(
      batches,
      position,
      camera,
      worldUnitsPerPixel
    );

    if (symbolWorldUnitsPerPixel <= 0) {
      continue;
    }

    const key = getUnitSymbolBatchKey(
      unit,
      isUnitSymbolOccludedByPlanet(batches, position, planets, camera)
    );
    const symbolMesh = batches.symbolMeshes.get(key);
    const symbolIndex = batches.symbolCounts.get(key) ?? 0;
    const symbolScale = UNIT_SYMBOL_SIZE_PX * symbolWorldUnitsPerPixel;
    const selectionScale = SELECTION_RING_SIZE_PX * symbolWorldUnitsPerPixel;

    if (symbolMesh) {
      writeUnitInstanceMatrix(
        batches,
        position,
        symbolScale * readUnitSymbolScale(unit),
        unit.shipClassId === SHIP_CLASS_IDS.fighter
          ? readUnitScreenRotation(batches, unit, position, camera)
          : 0
      );
      symbolMesh.setMatrixAt(symbolIndex, batches.matrix);
      batches.symbolCounts.set(key, symbolIndex + 1);
    }

    if (
      (selectedUnitKeys.has(unit.key) || unit.key === hoveredUnitKey) &&
      batches.selectionMesh
    ) {
      writeUnitInstanceMatrix(batches, position, selectionScale, 0);
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

function readUnitBillboardWorldUnitsPerPixel(
  batches: UnitBatchRenderer,
  position: THREE.Vector3,
  camera: THREE.Camera,
  focusWorldUnitsPerPixel: number
): number {
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    return focusWorldUnitsPerPixel;
  }

  batches.projectedPosition.copy(position).applyMatrix4(camera.matrixWorldInverse);
  const depth = -batches.projectedPosition.z;

  if (depth <= 0.0001) {
    return 0;
  }

  const viewHeight = Math.max(readCameraViewHeight(camera), 1);
  const focusDistance =
    viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

  return focusWorldUnitsPerPixel * (depth / Math.max(focusDistance, 1));
}

function ensureSymbolMeshCapacity(
  batches: UnitBatchRenderer,
  key: string,
  unit: UnitViewModel,
  requiredCount: number,
  occluded: boolean
): void {
  const capacity = batches.symbolCapacities.get(key) ?? 0;

  if (capacity >= requiredCount) {
    return;
  }

  const material = getUnitSymbolMaterial(batches, key, unit, occluded);
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
  unit: UnitViewModel,
  occluded: boolean
): THREE.MeshBasicMaterial {
  let material = batches.symbolMaterials.get(key);

  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: createUnitSymbolTexture(unit.color, unit.owner, unit.shipClassId),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: occluded ? 0.24 : 0.96,
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

function readUnitScreenRotation(
  batches: UnitBatchRenderer,
  unit: UnitViewModel,
  position: THREE.Vector3,
  camera: THREE.Camera
): number {
  const yaw = yawFromQuaternion(unit.rotation);

  batches.directionPosition.set(
    position.x + Math.sin(yaw),
    position.y,
    position.z + Math.cos(yaw)
  );
  batches.projectedPosition.copy(position).project(camera);
  batches.projectedDirection
    .copy(batches.directionPosition)
    .project(camera)
    .sub(batches.projectedPosition);

  const dx = batches.projectedDirection.x;
  const dy = batches.projectedDirection.y;

  if (dx * dx + dy * dy < 0.000001) {
    return 0;
  }

  return Math.atan2(dy, dx) - Math.PI / 2;
}

export function readUnitSymbolScale(unit: UnitViewModel): number {
  return UNIT_SYMBOL_SCALE_BY_CLASS[unit.shipClassId] ?? 1;
}

function isUnitSymbolOccludedByPlanet(
  batches: UnitBatchRenderer,
  position: THREE.Vector3,
  planets: readonly PlanetViewModel[],
  camera: THREE.Camera
): boolean {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return false;
  }

  const viewWidth = Math.max(camera.right - camera.left, 1);
  const viewHeight = Math.max(camera.top - camera.bottom, 1);
  const projectedUnit = batches.projectedPosition.copy(position).project(camera);

  if (projectedUnit.z < -1 || projectedUnit.z > 1) {
    return false;
  }

  for (const planet of planets) {
    const projectedPlanet = batches.projectedOccluder
      .copy(planet.position)
      .project(camera);

    if (projectedPlanet.z < -1 || projectedPlanet.z > 1) {
      continue;
    }

    if (projectedPlanet.z >= projectedUnit.z - 0.002) {
      continue;
    }

    const radiusX = (planet.radius * 2.06) / viewWidth;
    const radiusY = (planet.radius * 2.06) / viewHeight;

    if (radiusX <= 0 || radiusY <= 0) {
      continue;
    }

    const normalizedDistance = Math.hypot(
      (projectedUnit.x - projectedPlanet.x) / radiusX,
      (projectedUnit.y - projectedPlanet.y) / radiusY
    );

    if (normalizedDistance <= 1) {
      return true;
    }
  }

  return false;
}

function getUnitSymbolBatchKey(unit: UnitViewModel, occluded: boolean): string {
  const visibility = occluded ? "occluded" : "visible";

  return `${unit.owner}:${unit.shipClassId}:${visibility}`;
}

export function disposeUnitBatchRenderer(batches: UnitBatchRenderer): void {
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
