import * as THREE from "three";

export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const Y_AXIS = new THREE.Vector3(0, 1, 0);
export const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function readWorldUnitsPerPixel(
  camera: THREE.Camera,
  viewportHeight: number
): number {
  return readCameraViewHeight(camera) / Math.max(viewportHeight, 1);
}

export function readCameraViewHeight(camera: THREE.Camera): number {
  if (camera instanceof THREE.OrthographicCamera) {
    return camera.top - camera.bottom;
  }

  const viewHeight = camera.userData.viewHeight;
  return typeof viewHeight === "number" && Number.isFinite(viewHeight)
    ? viewHeight
    : 1;
}

export function yawFromQuaternion(quaternion: THREE.Quaternion): number {
  return Math.atan2(
    2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z)
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
