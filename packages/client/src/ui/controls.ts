import { CAMERA_PRESETS, type CameraPreset } from "../camera/config";
import { SHIP_CLASS_IDS, type ShipClassId } from "@drop-ship/protocol";
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
  commandsPanel: HTMLDetailsElement;
  commandsBody: HTMLElement;
  escortButton: HTMLButtonElement;
  emptyPanel: HTMLElement;
  unitList: HTMLElement;
  unitGroups: ReadonlyMap<CommandUnitGroupId, CommandUnitGroupControls>;
  onSelectLeader: (unitKey: string) => void;
  onEscortLeader: () => void;
}>;

type CommandUnitGroupId = "fighter" | "dropShip" | "battleship";

type CommandUnitGroupControls = Readonly<{
  definition: CommandUnitGroupDefinition;
  root: HTMLDetailsElement;
  summary: HTMLElement;
  list: HTMLElement;
  buttons: Map<string, HTMLButtonElement>;
}>;

type CommandUnitGroup = Readonly<{
  definition: CommandUnitGroupDefinition;
  units: readonly UnitViewModel[];
}>;

type CommandUnitGroupDefinition = Readonly<{
  id: CommandUnitGroupId;
  label: string;
  shipClassId: ShipClassId;
  sortIndex: number;
}>;

type TacticalOverlayTarget = {
  enabled: boolean;
  root: { visible: boolean };
};

const COMMAND_UNIT_GROUPS: readonly CommandUnitGroupDefinition[] = [
  {
    id: "fighter",
    label: "Scouts",
    shipClassId: SHIP_CLASS_IDS.fighter,
    sortIndex: 0,
  },
  {
    id: "dropShip",
    label: "Drop ships",
    shipClassId: SHIP_CLASS_IDS.dropShip,
    sortIndex: 1,
  },
  {
    id: "battleship",
    label: "Battleships",
    shipClassId: SHIP_CLASS_IDS.battleship,
    sortIndex: 2,
  },
];

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
  const commandsPanel = document.createElement("details");
  const commandsSummary = document.createElement("summary");
  const commandsBody = document.createElement("div");
  const escortButton = document.createElement("button");
  const emptyPanel = document.createElement("div");
  const unitList = document.createElement("div");
  const unitGroups = new Map<CommandUnitGroupId, CommandUnitGroupControls>();

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

  commandsPanel.className =
    "command-menu-panel command-menu-commands-panel";
  commandsPanel.open = true;
  commandsSummary.className = "command-menu-panel-summary";
  commandsSummary.textContent = "Commands";
  commandsBody.className = "command-menu-panel-body command-menu-commands";
  escortButton.type = "button";
  escortButton.className = "command-menu-command";
  escortButton.textContent = "Escort leader";
  escortButton.disabled = true;
  escortButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onEscortLeader();
  });
  commandsBody.appendChild(escortButton);
  commandsPanel.append(commandsSummary, commandsBody);

  emptyPanel.className = "command-menu-panel command-menu-empty";
  emptyPanel.textContent = "No units selected";

  unitList.className = "command-menu-unit-list";
  unitList.hidden = true;

  for (const definition of COMMAND_UNIT_GROUPS) {
    const group = createCommandUnitGroupControls(definition);
    unitGroups.set(definition.id, group);
  }

  content.append(commandsPanel, emptyPanel, unitList);
  root.appendChild(content);
  container.appendChild(root);

  return {
    root,
    content,
    commandsPanel,
    commandsBody,
    escortButton,
    emptyPanel,
    unitList,
    unitGroups,
    onSelectLeader: options.onSelectLeader,
    onEscortLeader: options.onEscortLeader,
  };
}

export function updateCommandMenu(
  controls: CommandMenuControls,
  selectedUnits: readonly UnitViewModel[],
  leaderKey: string | null
): void {
  const selectedLeader = selectedUnits.find((unit) => unit.key === leaderKey);

  controls.escortButton.textContent = selectedLeader
    ? `Escort ${selectedLeader.label} #${selectedLeader.handle.id}`
    : "Escort leader";
  controls.escortButton.disabled = !selectedLeader || selectedUnits.length < 2;

  if (selectedUnits.length === 0) {
    controls.emptyPanel.hidden = false;
    controls.unitList.hidden = true;
    clearUnitGroups(controls);
    return;
  }

  controls.emptyPanel.hidden = true;
  controls.unitList.hidden = false;

  const groups = createUnitGroups(selectedUnits);
  const visibleGroupIds = new Set<CommandUnitGroupId>();

  for (const group of groups) {
    const groupControls = controls.unitGroups.get(group.definition.id);

    if (!groupControls) {
      continue;
    }

    visibleGroupIds.add(group.definition.id);
    groupControls.root.hidden = false;
    groupControls.summary.textContent = `${group.definition.label} [${group.units.length}]`;
    syncUnitButtons(
      groupControls,
      group.units,
      leaderKey,
      controls.onSelectLeader
    );
    controls.unitList.appendChild(groupControls.root);
  }

  for (const [groupId, groupControls] of controls.unitGroups) {
    if (visibleGroupIds.has(groupId)) {
      continue;
    }

    groupControls.root.hidden = true;
    groupControls.summary.textContent = `${groupControls.definition.label} [0]`;
    syncUnitButtons(groupControls, [], leaderKey, controls.onSelectLeader);

    if (groupControls.root.parentElement === controls.unitList) {
      groupControls.root.remove();
    }
  }
}

function createUnitGroups(
  selectedUnits: readonly UnitViewModel[]
): readonly CommandUnitGroup[] {
  return COMMAND_UNIT_GROUPS.map((definition) => ({
    definition,
    units: selectedUnits
      .filter((unit) => unit.shipClassId === definition.shipClassId)
      .sort((first, second) => first.handle.id - second.handle.id),
  }))
    .filter((group) => group.units.length > 0)
    .sort(
      (first, second) =>
        first.units.length - second.units.length ||
        first.definition.sortIndex - second.definition.sortIndex
    );
}

function createCommandUnitGroupControls(
  definition: CommandUnitGroupDefinition
): CommandUnitGroupControls {
  const root = document.createElement("details");
  const summary = document.createElement("summary");
  const list = document.createElement("div");

  root.className = "command-menu-panel command-menu-group";
  root.open = true;
  root.hidden = true;
  summary.className = "command-menu-panel-summary";
  summary.textContent = `${definition.label} [0]`;
  list.className = "command-menu-panel-body command-menu-list";
  root.append(summary, list);

  return {
    definition,
    root,
    summary,
    list,
    buttons: new Map(),
  };
}

function clearUnitGroups(controls: CommandMenuControls): void {
  for (const groupControls of controls.unitGroups.values()) {
    groupControls.root.hidden = true;
    groupControls.summary.textContent = `${groupControls.definition.label} [0]`;
    syncUnitButtons(groupControls, [], null, controls.onSelectLeader);
    groupControls.root.remove();
  }
}

function syncUnitButtons(
  groupControls: CommandUnitGroupControls,
  units: readonly UnitViewModel[],
  leaderKey: string | null,
  onSelectLeader: (unitKey: string) => void
): void {
  const visibleUnitKeys = new Set<string>();

  for (const unit of units) {
    let button = groupControls.buttons.get(unit.key);

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "command-menu-unit";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const unitKey = button?.dataset.unitKey;

        if (unitKey) {
          onSelectLeader(unitKey);
        }
      });
      groupControls.buttons.set(unit.key, button);
    }

    visibleUnitKeys.add(unit.key);
    button.dataset.unitKey = unit.key;
    button.textContent = `${unit.label} #${unit.handle.id}`;
    button.setAttribute("aria-pressed", String(unit.key === leaderKey));
    groupControls.list.appendChild(button);
  }

  for (const [unitKey, button] of groupControls.buttons) {
    if (visibleUnitKeys.has(unitKey)) {
      continue;
    }

    button.remove();
    groupControls.buttons.delete(unitKey);
  }
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
