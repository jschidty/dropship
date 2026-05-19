import { CAMERA_PRESETS, type CameraPreset } from "../camera/config";
import type { LocalGameRuntime, RenderQualityMode } from "../types";

export type CameraPresetControls = Readonly<{
  root: HTMLElement;
  buttons: Record<CameraPreset, HTMLButtonElement>;
}>;

export type TacticalOverlayControls = Readonly<{
  root: HTMLElement;
  input: HTMLInputElement;
}>;



type TacticalOverlayTarget = {
  enabled: boolean;
  root: { visible: boolean };
};

export function createStatsLayer(container: HTMLElement): HTMLElement {
  const statsLayer = document.createElement("div");
  statsLayer.className = "game-stats";
  container.appendChild(statsLayer);
  return statsLayer;
}

export function updateStatsLayer(
  statsLayer: HTMLElement,
  runtime: LocalGameRuntime,
  estimatedFps: number,
  observedSimHz: number,
  estimatedRenderMs: number,
  drawCalls: number,
  pixelRatio: number,
  renderMode: RenderQualityMode,
  selectedPlanetLabel: string,
  selectedUnitCount: number
): void {
  statsLayer.textContent = `Planet ${selectedPlanetLabel} / Units ${runtime.world.units.length} / Selected ${selectedUnitCount} / Tick ${runtime.world.tick
    .toString()
    .padStart(5, "0")} / ${renderMode} / ${estimatedFps.toFixed(0)} fps / ${observedSimHz.toFixed(1)} sim / ${drawCalls} calls / ${estimatedRenderMs.toFixed(2)} ms / ${pixelRatio.toFixed(2)}x / Hash ${runtime.readHash()}`;
}

export function createCameraPresetControls(
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

export function updateCameraPresetControls(
  controls: CameraPresetControls,
  activePreset: CameraPreset | null
): void {
  for (const preset of Object.keys(controls.buttons) as CameraPreset[]) {
    const isActive = preset === activePreset;
    controls.buttons[preset].setAttribute("aria-pressed", String(isActive));
    controls.buttons[preset].classList.toggle("is-active", isActive);
  }
}

export function createTopLeftControls(container: HTMLElement): HTMLElement {
  const root = document.createElement("div");
  root.className = "top-left-controls";
  container.appendChild(root);
  return root;
}

export function createTacticalOverlayControls(
  container: HTMLElement,
  onChange: (enabled: boolean) => void
): TacticalOverlayControls {
  const root = document.createElement("label");
  root.className = "tactical-toggle";
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
  label.textContent = "Tactical";
  root.append(input, label);
  container.appendChild(root);

  return {
    root,
    input,
  };
}

export function createRandomSeedControl(container: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "random-seed-button";
  button.textContent = "Random seed";
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigateToRandomSeed();
  });
  container.appendChild(button);
  return button;
}

export function createRenderModeControl(
  container: HTMLElement,
  renderMode: RenderQualityMode
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "render-mode-button";
  button.textContent = renderMode === "cinematic" ? "Cinematic" : "Interactive";
  button.setAttribute("aria-pressed", String(renderMode === "cinematic"));
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigateToRenderMode(
      renderMode === "cinematic" ? "interactive" : "cinematic"
    );
  });
  container.appendChild(button);
  return button;
}

function navigateToRandomSeed(): void {
  const url = new URL(window.location.href);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const matchId = url.searchParams.get("match");

  url.searchParams.set("seed", seed.toString());

  if (matchId?.startsWith("seed-")) {
    url.searchParams.set("match", `seed-${seed}`);
  }

  window.location.assign(url.toString());
}

function navigateToRenderMode(renderMode: RenderQualityMode): void {
  const url = new URL(window.location.href);
  url.searchParams.set("render", renderMode);
  url.searchParams.delete("renderMode");
  url.searchParams.delete("quality");
  window.location.assign(url.toString());
}

export function setTacticalOverlayEnabled(
  overlay: TacticalOverlayTarget,
  controls: TacticalOverlayControls,
  enabled: boolean
): void {
  overlay.enabled = enabled;
  overlay.root.visible = enabled;
  controls.input.checked = enabled;
}

export function createSelectionBox(container: HTMLElement): HTMLElement {
  const selectionBox = document.createElement("div");
  selectionBox.className = "selection-box";
  selectionBox.hidden = true;
  container.appendChild(selectionBox);
  return selectionBox;
}

export function updateSelectionBox(
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

export function hideSelectionBox(selectionBox: HTMLElement): void {
  selectionBox.hidden = true;
  selectionBox.style.width = "0";
  selectionBox.style.height = "0";
}
