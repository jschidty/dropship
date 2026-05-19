import { CAMERA_PRESETS, type CameraPreset } from "../camera/config";
import { SHIP_CLASS_IDS } from "@drop-ship/protocol";
import type { LocalGameRuntime, RenderQualityMode, UnitViewModel } from "../types";

export type CameraPresetControls = Readonly<{
  root: HTMLElement;
  buttons: Record<CameraPreset, HTMLButtonElement>;
}>;

export type TacticalOverlayControls = Readonly<{
  root: HTMLElement;
  input: HTMLInputElement;
}>;

export type CommandMenuControls = Readonly<{
  root: HTMLElement;
  content: HTMLElement;
  onSelectLeader: (unitKey: string) => void;
  onEscortLeader: () => void;
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
  input.checked = false;
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

export function createCommandMenu(
  container: HTMLElement,
  options: Readonly<{
    onSelectLeader: (unitKey: string) => void;
    onEscortLeader: () => void;
  }>
): CommandMenuControls {
  const root = document.createElement("aside");
  const content = document.createElement("div");

  root.className = "command-menu";
  root.setAttribute("aria-label", "Command menu");
  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  root.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  content.className = "command-menu-content";
  root.appendChild(content);
  container.appendChild(root);

  return {
    root,
    content,
    onSelectLeader: options.onSelectLeader,
    onEscortLeader: options.onEscortLeader,
  };
}

export function updateCommandMenu(
  controls: CommandMenuControls,
  selectedUnits: readonly UnitViewModel[],
  leaderKey: string | null
): void {
  controls.content.replaceChildren();

  const title = document.createElement("div");
  title.className = "command-menu-title";
  title.textContent = "Command";
  controls.content.appendChild(title);

  if (selectedUnits.length === 0) {
    const empty = document.createElement("div");
    empty.className = "command-menu-empty";
    empty.textContent = "No units selected";
    controls.content.appendChild(empty);
    return;
  }

  for (const group of createUnitGroups(selectedUnits)) {
    const section = document.createElement("details");
    const summary = document.createElement("summary");
    const list = document.createElement("div");

    section.className = "command-menu-group";
    section.open = group.units.length > 0;
    summary.textContent = `${group.label} ${group.units.length}`;
    list.className = "command-menu-list";
    section.append(summary, list);

    for (const unit of group.units) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-menu-unit";
      button.textContent = `${unit.label} #${unit.handle.id}`;
      button.setAttribute("aria-pressed", String(unit.key === leaderKey));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        controls.onSelectLeader(unit.key);
      });
      list.appendChild(button);
    }

    controls.content.appendChild(section);
  }

  const commands = document.createElement("div");
  const commandTitle = document.createElement("div");
  const escort = document.createElement("button");
  const selectedLeader = selectedUnits.find((unit) => unit.key === leaderKey);

  commands.className = "command-menu-commands";
  commandTitle.className = "command-menu-subtitle";
  commandTitle.textContent = "Commands";
  escort.type = "button";
  escort.className = "command-menu-command";
  escort.textContent = selectedLeader
    ? `Escort ${selectedLeader.label} #${selectedLeader.handle.id}`
    : "Escort leader";
  escort.disabled = !selectedLeader || selectedUnits.length < 2;
  escort.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    controls.onEscortLeader();
  });
  commands.append(commandTitle, escort);
  controls.content.appendChild(commands);
}

function createUnitGroups(
  selectedUnits: readonly UnitViewModel[]
): readonly Readonly<{
  label: string;
  units: readonly UnitViewModel[];
}>[] {
  return [
    {
      label: "Scouts",
      units: selectedUnits.filter(
        (unit) => unit.shipClassId === SHIP_CLASS_IDS.fighter
      ),
    },
    {
      label: "Drop ships",
      units: selectedUnits.filter(
        (unit) => unit.shipClassId === SHIP_CLASS_IDS.dropShip
      ),
    },
    {
      label: "Battleships",
      units: selectedUnits.filter(
        (unit) => unit.shipClassId === SHIP_CLASS_IDS.battleship
      ),
    },
  ];
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
