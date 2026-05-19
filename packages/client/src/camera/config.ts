import type * as THREE from "three";

export type CameraMode = "tactical" | "strategic";

export type CameraModeConfig = Readonly<{
  label: string;
  defaultViewHeight: number;
  minViewHeight: number;
  maxViewHeight: number;
  pitch: number;
}>;

export type CameraControls = {
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

export type CameraFocusTween = {
  current: THREE.Vector3;
  from: THREE.Vector3;
  activeContextKey: string | null;
  startAt: number;
  initialized: boolean;
};

export type CameraPreset = "top" | "left" | "isometric";


export const CAMERA_MODES: Record<CameraMode, CameraModeConfig> = {
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
export const CAMERA_PRESETS: Record<
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


export function setCameraMode(cameraControls: CameraControls, mode: CameraMode): void {
  cameraControls.mode = mode;
  cameraControls.preset = null;
  cameraControls.pitch = CAMERA_MODES[mode].pitch;
}

export function applyCameraPreset(
  cameraControls: CameraControls,
  preset: CameraPreset
): void {
  const cameraPreset = CAMERA_PRESETS[preset];
  cameraControls.preset = preset;
  cameraControls.yaw = cameraPreset.yaw;
  cameraControls.pitch = cameraPreset.pitch;
}
