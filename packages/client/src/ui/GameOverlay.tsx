import { Fragment, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { CAMERA_PRESETS, type CameraPreset } from "../camera/config";
import {
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  type ShipClassId,
} from "@drop-ship/protocol";
import { createUnitSymbolImageUrl } from "../render/canvasTextures";
import type {
  RenderQualityMode,
  RuntimeConnectionStatus,
  UnitViewModel,
} from "../types";
import type { UiStore } from "./store";

export type PendingCommandMenuCommand = "orbitPlanet" | null;

export type CommandHistoryEntry = Readonly<{
  id: number;
  label: string;
  detail: string;
  unitCount: number;
}>;

export type MatchStatusSnapshot = Readonly<{
  remainingTicks: number;
  playerOneText: string;
  playerTwoText: string;
  playerOneColor: string;
  playerTwoColor: string;
  resultText: string;
  resultKind: "pending" | "win" | "lose" | "draw";
}>;

export type TwoPlayerShareSnapshot = Readonly<{
  canCreate: boolean;
  state: "idle" | "creating" | "error";
  message: string;
}>;

export type GameOverlaySnapshot = Readonly<{
  activeCameraPreset: CameraPreset | null;
  tacticalOverlayEnabled: boolean;
  renderMode: RenderQualityMode;
  selectedUnits: readonly UnitViewModel[];
  commandMenuLeaderKey: string | null;
  pendingCommand: PendingCommandMenuCommand;
  commandHistory: readonly CommandHistoryEntry[];
  matchStatus: MatchStatusSnapshot;
  hotkeysOpen: boolean;
  connectionStatus: RuntimeConnectionStatus;
  pauseMenuMessage: string;
  twoPlayerShare: TwoPlayerShareSnapshot;
}>;

export type GameOverlayActions = Readonly<{
  selectCameraPreset: (preset: CameraPreset) => void;
  zoomToFit: () => void;
  setTacticalOverlayEnabled: (enabled: boolean) => void;
  toggleRenderMode: () => void;
  selectCommandLeader: (unitKey: string) => void;
  deselectUnit: (unitKey: string) => void;
  escortLeader: () => void;
  toggleOrbitPlanetCommand: () => void;
  selectCommandHistoryEntry: (entryId: number) => void;
  closeHotkeysDialog: () => void;
  createTwoPlayerGame: () => void;
}>;

export function createInitialOverlaySnapshot(
  renderMode: RenderQualityMode,
  connectionStatus: RuntimeConnectionStatus
): GameOverlaySnapshot {
  return {
    activeCameraPreset: "top",
    tacticalOverlayEnabled: true,
    renderMode,
    selectedUnits: [],
    commandMenuLeaderKey: null,
    pendingCommand: null,
    commandHistory: [],
    matchStatus: {
      remainingTicks: 0,
      playerOneText: "P1 0P 0U",
      playerTwoText: "P2 0P 0U",
      playerOneColor: "#74d9ff",
      playerTwoColor: "#ff4fd8",
      resultText: "",
      resultKind: "pending",
    },
    hotkeysOpen: false,
    connectionStatus,
    pauseMenuMessage: "",
    twoPlayerShare: {
      canCreate: false,
      state: "idle",
      message: "",
    },
  };
}

export function mountGameOverlay(
  container: HTMLElement,
  store: UiStore<GameOverlaySnapshot>,
  actions: GameOverlayActions
): { dispose: () => void } {
  const root = document.createElement("div");
  root.className = "game-ui-root";
  container.appendChild(root);
  render(<GameOverlay store={store} actions={actions} />, root);

  return {
    dispose() {
      render(null, root);
      root.remove();
    },
  };
}

function GameOverlay({
  store,
  actions,
}: {
  store: UiStore<GameOverlaySnapshot>;
  actions: GameOverlayActions;
}) {
  const snapshot = useStoreSnapshot(store);

  return (
    <>
      <CameraPresetControls snapshot={snapshot} actions={actions} />
      <TopLeftControls snapshot={snapshot} actions={actions} />
      <MatchStatus snapshot={snapshot.matchStatus} />
      <CommandHistoryMenu snapshot={snapshot} actions={actions} />
      <CommandMenu snapshot={snapshot} actions={actions} />
      <RoleBadge snapshot={snapshot} />
      <HotkeysDialog snapshot={snapshot} actions={actions} />
    </>
  );
}

function useStoreSnapshot<T>(store: UiStore<T>): T {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());

  useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [
    store,
  ]);

  return snapshot;
}

function stopOverlayPointer(event: Event): void {
  event.stopPropagation();
}

function CameraPresetControls({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  return (
    <div className="camera-presets" aria-label="Camera views">
      {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((preset) => (
        <button
          key={preset}
          type="button"
          className={`camera-preset-button${
            snapshot.activeCameraPreset === preset ? " is-active" : ""
          }`}
          data-camera-preset={preset}
          aria-pressed={snapshot.activeCameraPreset === preset}
          onPointerDown={stopOverlayPointer}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            actions.selectCameraPreset(preset);
            event.currentTarget.blur();
          }}
        >
          {CAMERA_PRESETS[preset].label}
        </button>
      ))}
      <button
        type="button"
        className="camera-preset-button camera-fit-button"
        onPointerDown={stopOverlayPointer}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.zoomToFit();
          event.currentTarget.blur();
        }}
      >
        Fit
      </button>
    </div>
  );
}

function TopLeftControls({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  return (
    <div className="top-left-controls">
      <label className="tactical-toggle" onPointerDown={stopOverlayPointer}>
        <input
          type="checkbox"
          checked={snapshot.tacticalOverlayEnabled}
          onChange={(event) => {
            actions.setTacticalOverlayEnabled(event.currentTarget.checked);
            event.currentTarget.blur();
          }}
        />
        <span>Tactical</span>
      </label>
      <button
        type="button"
        className="render-mode-button"
        data-render-mode={snapshot.renderMode}
        aria-pressed={snapshot.renderMode === "cinematic"}
        onPointerDown={stopOverlayPointer}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.toggleRenderMode();
          event.currentTarget.blur();
        }}
      >
        {snapshot.renderMode === "cinematic" ? "Cinematic" : "Interactive"}
      </button>
    </div>
  );
}

function MatchStatus({ snapshot }: { snapshot: MatchStatusSnapshot }) {
  return (
    <section className="match-status" data-result={snapshot.resultKind}>
      <div className="match-status-timer">
        {formatMatchTime(snapshot.remainingTicks)}
      </div>
      <div
        className="match-status-player match-status-player-one"
        style={{ "--team-color": snapshot.playerOneColor } as Record<string, string>}
      >
        {snapshot.playerOneText}
      </div>
      <div
        className="match-status-player match-status-player-two"
        style={{ "--team-color": snapshot.playerTwoColor } as Record<string, string>}
      >
        {snapshot.playerTwoText}
      </div>
      <div className="match-status-result">{snapshot.resultText}</div>
    </section>
  );
}

function CommandHistoryMenu({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  const hasCommandHistory = snapshot.commandHistory.length > 0;

  return (
    <aside
      className="command-menu command-history-menu"
      hidden={!hasCommandHistory}
      aria-label="Recent commands"
      onPointerDown={stopOverlayPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="command-menu-history command-history-stack">
        {snapshot.commandHistory.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="command-menu-history-entry"
            title={`${entry.label} - ${entry.detail}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              actions.selectCommandHistoryEntry(entry.id);
              event.currentTarget.blur();
            }}
          >
            <span className="command-menu-history-label">{entry.label}</span>
            <span className="command-menu-history-detail">{entry.detail}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CommandMenu({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  const selectedLeader = snapshot.selectedUnits.find(
    (unit) => unit.key === snapshot.commandMenuLeaderKey
  );
  const hasSelectedUnits = snapshot.selectedUnits.length > 0;

  return (
    <aside
      className="command-menu"
      hidden={!hasSelectedUnits}
      aria-label="Command menu"
      onPointerDown={stopOverlayPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="command-menu-content">
        <details
          className="command-menu-panel command-menu-commands-panel"
          open
          hidden={!hasSelectedUnits}
        >
          <summary className="command-menu-panel-summary">Commands</summary>
          <div className="command-menu-panel-body command-menu-commands">
            <button
              type="button"
              className="command-menu-command"
              disabled={!selectedLeader || snapshot.selectedUnits.length < 2}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.escortLeader();
                event.currentTarget.blur();
              }}
            >
              {selectedLeader
                ? `Escort ${selectedLeader.label} #${selectedLeader.handle.id}`
                : "Escort leader"}
            </button>
            <button
              type="button"
              className="command-menu-command"
              disabled={snapshot.selectedUnits.length === 0}
              aria-pressed={snapshot.pendingCommand === "orbitPlanet"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.toggleOrbitPlanetCommand();
                event.currentTarget.blur();
              }}
            >
              Orbit planet
            </button>
          </div>
        </details>
        <div
          className="command-menu-unit-list"
          hidden={!hasSelectedUnits}
        >
          {createUnitGroups(snapshot.selectedUnits).map((group) => (
            <CommandUnitGroup
              key={group.definition.id}
              group={group}
              leaderKey={snapshot.commandMenuLeaderKey}
              actions={actions}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function CommandUnitGroup({
  group,
  leaderKey,
  actions,
}: {
  group: CommandUnitGroup;
  leaderKey: string | null;
  actions: GameOverlayActions;
}) {
  return (
    <details className="command-menu-panel command-menu-group" open>
      <summary className="command-menu-panel-summary">
        {group.definition.label} [{group.units.length}]
      </summary>
      <div className="command-menu-panel-body command-menu-list">
        {group.units.map((unit) => (
          <div
            key={unit.key}
            className="command-menu-unit"
            data-unit-key={unit.key}
            aria-selected={unit.key === leaderKey}
          >
            <button
              type="button"
              className="command-menu-unit-select"
              data-unit-key={unit.key}
              aria-pressed={unit.key === leaderKey}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.selectCommandLeader(unit.key);
                event.currentTarget.blur();
              }}
            >
              <img
                className="command-menu-unit-symbol"
                src={createUnitSymbolImageUrl(
                  unit.color,
                  unit.owner,
                  unit.shipClassId
                )}
                alt=""
                draggable={false}
                aria-hidden="true"
              />
              <span className="command-menu-unit-label">
                {unit.label} #{unit.handle.id}
              </span>
            </button>
            <button
              type="button"
              className="command-menu-unit-remove"
              data-unit-key={unit.key}
              aria-label="Deselect unit"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.deselectUnit(unit.key);
                event.currentTarget.blur();
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}

function RoleBadge({ snapshot }: { snapshot: GameOverlaySnapshot }) {
  return (
    <div className="player-role-badge" data-role={snapshot.connectionStatus.role}>
      {formatRoleLabel(snapshot.connectionStatus)}
    </div>
  );
}

function HotkeysDialog({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  const statusMessage =
    snapshot.twoPlayerShare.message || snapshot.pauseMenuMessage;
  const statusState = snapshot.twoPlayerShare.message
    ? snapshot.twoPlayerShare.state
    : "idle";

  return (
    <div className="hotkeys-dialog" hidden={!snapshot.hotkeysOpen}>
      <section className="hotkeys-dialog-panel" aria-label="Hotkeys">
        <h2 className="hotkeys-dialog-title">Hotkeys</h2>
        <dl className="hotkeys-dialog-list">
          {HOTKEYS.map(([key, action]) => (
            <Fragment key={key}>
              <dt>{key}</dt>
              <dd>{action}</dd>
            </Fragment>
          ))}
        </dl>
        <div
          className="hotkeys-dialog-actions"
          data-has-two-player={snapshot.twoPlayerShare.canCreate}
        >
          {snapshot.twoPlayerShare.canCreate ? (
            <button
              type="button"
              className="hotkeys-dialog-two-player"
              disabled={snapshot.twoPlayerShare.state === "creating"}
              onPointerDown={stopOverlayPointer}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.createTwoPlayerGame();
                event.currentTarget.blur();
              }}
            >
              {snapshot.twoPlayerShare.state === "creating"
                ? "Creating..."
                : "Two player"}
            </button>
          ) : null}
          <button
            type="button"
            className="hotkeys-dialog-close"
            onPointerDown={stopOverlayPointer}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              actions.closeHotkeysDialog();
              event.currentTarget.blur();
            }}
          >
            Resume
          </button>
        </div>
        <div
          className="hotkeys-dialog-message"
          data-state={statusState}
          hidden={statusMessage.length === 0}
        >
          {statusMessage}
        </div>
      </section>
    </div>
  );
}

type CommandUnitGroupId = "fighter" | "dropShip" | "battleship";

type CommandUnitGroupDefinition = Readonly<{
  id: CommandUnitGroupId;
  label: string;
  shipClassId: ShipClassId;
  sortIndex: number;
}>;

type CommandUnitGroup = Readonly<{
  definition: CommandUnitGroupDefinition;
  units: readonly UnitViewModel[];
}>;

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

const HOTKEYS: readonly (readonly [string, string])[] = [
  ["1", "Select all owned units"],
  ["8", "Select fighters"],
  ["9", "Select battleships"],
  ["0", "Select drop ships"],
  ["D", "Clear selection"],
  ["C", "Capture selected planet"],
  ["G", "Guard selected planet"],
  ["T", "Toggle tactical overlay"],
  ["P", "Pause and show hotkeys"],
  ["Space", "Reselect previous command group"],
  ["Tab", "Toggle tactical/strategic camera"],
];

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

function formatMatchTime(ticks: number): string {
  const totalSeconds = Math.ceil(ticks / PHASE_ONE_SIM_HZ);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRoleLabel(status: RuntimeConnectionStatus): string {
  switch (status.role) {
    case "player2":
      return "P2";
    case "spectator":
      return "Spectator";
    case "player1":
    default:
      return "P1";
  }
}
