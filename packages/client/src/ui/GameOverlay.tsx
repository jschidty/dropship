import { Fragment, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  CAMERA_PRESETS,
  type CameraPreset,
  type CameraMode,
  type CameraProjection,
} from "../camera/config";
import {
  PHASE_ONE_SIM_HZ,
  SHIP_CLASS_IDS,
  type ShipClassId,
} from "@drop-ship/protocol";
import { createUnitSymbolImageUrl } from "../render/canvasTextures";
import type { ObjectiveCommandCard } from "../selection/commands";
import type {
  PlanetViewModel,
  RenderQualityMode,
  RuntimeConnectionStatus,
  UnitLoadoutSlotViewModel,
  UnitViewModel,
} from "../types";
import type { UiStore } from "./store";

export type PendingCommandMenuCommand = "orbitPlanet" | null;

export type MatchStatusSnapshot = Readonly<{
  remainingTicks: number;
  playerOneText: string;
  playerTwoText: string;
  playerOneColor: string;
  playerTwoColor: string;
  resultText: string;
  resultKind: "pending" | "win" | "lose" | "draw";
}>;

export type MatchEndPlayerStatsSnapshot = Readonly<{
  label: string;
  color: string;
  planets: number;
  units: number;
}>;

export type MatchEndDialogSnapshot = Readonly<{
  open: boolean;
  resultText: string;
  resultKind: MatchStatusSnapshot["resultKind"];
  reasonText: string;
  durationText: string;
  seedText: string;
  playerOne: MatchEndPlayerStatsSnapshot;
  playerTwo: MatchEndPlayerStatsSnapshot;
  canReplay: boolean;
  replaying: boolean;
}>;

export type TwoPlayerShareSnapshot = Readonly<{
  canCreate: boolean;
  state: "idle" | "creating" | "error";
  message: string;
}>;

export type SelectedPlanetStatsSnapshot = Readonly<{
  planet: PlanetViewModel;
  imageUrl: string;
  controlLabel: string;
  controlColor: string;
  captureLabel: string;
  captureColor: string;
  captureProgress: number | null;
}>;

export type SelectedUnitObjectiveSnapshot = Readonly<{
  orderLabel: string;
  targetLabel: string;
  distanceLabel: string;
  detailLabel: string;
  state: "idle" | "move" | "attack" | "planet" | "escort";
}>;

export type GameOverlaySnapshot = Readonly<{
  activeCameraPreset: CameraPreset | null;
  cameraMode: CameraMode;
  cameraProjection: CameraProjection;
  tacticalOverlayEnabled: boolean;
  gravityOverlayEnabled: boolean;
  renderMode: RenderQualityMode;
  selectedUnits: readonly UnitViewModel[];
  selectedUnitObjective: SelectedUnitObjectiveSnapshot | null;
  selectedPlanet: SelectedPlanetStatsSnapshot | null;
  commandMenuLeaderKey: string | null;
  pendingCommand: PendingCommandMenuCommand;
  objectiveCards: readonly ObjectiveCommandCard[];
  matchStatus: MatchStatusSnapshot;
  matchEnd: MatchEndDialogSnapshot;
  hotkeysOpen: boolean;
  connectionStatus: RuntimeConnectionStatus;
  pauseMenuMessage: string;
  twoPlayerShare: TwoPlayerShareSnapshot;
}>;

export type GameOverlayActions = Readonly<{
  selectCameraPreset: (preset: CameraPreset) => void;
  toggleCameraProjection: () => void;
  zoomToFit: () => void;
  setTacticalOverlayEnabled: (enabled: boolean) => void;
  setGravityOverlayEnabled: (enabled: boolean) => void;
  toggleRenderMode: () => void;
  selectCommandLeader: (unitKey: string) => void;
  deselectUnit: (unitKey: string) => void;
  escortLeader: () => void;
  toggleOrbitPlanetCommand: () => void;
  selectObjectiveCommandCard: (cardId: string) => void;
  closeHotkeysDialog: () => void;
  readyForMatch: () => void;
  replayMatch: () => void;
  createTwoPlayerGame: () => void;
}>;

export function createInitialOverlaySnapshot(
  renderMode: RenderQualityMode,
  connectionStatus: RuntimeConnectionStatus
): GameOverlaySnapshot {
  return {
    activeCameraPreset: "top",
    cameraMode: "tactical",
    cameraProjection: "perspective",
    tacticalOverlayEnabled: true,
    gravityOverlayEnabled: false,
    renderMode,
    selectedUnits: [],
    selectedUnitObjective: null,
    selectedPlanet: null,
    commandMenuLeaderKey: null,
    pendingCommand: null,
    objectiveCards: [],
    matchStatus: {
      remainingTicks: 0,
      playerOneText: "P1 0P 0U",
      playerTwoText: "P2 0P 0U",
      playerOneColor: "#74d9ff",
      playerTwoColor: "#ff4fd8",
      resultText: "",
      resultKind: "pending",
    },
    matchEnd: {
      open: false,
      resultText: "",
      resultKind: "pending",
      reasonText: "",
      durationText: "",
      seedText: "",
      playerOne: {
        label: "Player 1",
        color: "#74d9ff",
        planets: 0,
        units: 0,
      },
      playerTwo: {
        label: "Player 2",
        color: "#ff4fd8",
        planets: 0,
        units: 0,
      },
      canReplay: false,
      replaying: false,
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
      <ObjectiveCommandMenu snapshot={snapshot} actions={actions} />
      <RightSideStack snapshot={snapshot} actions={actions} />
      <RoleBadge snapshot={snapshot} />
      <HotkeysDialog snapshot={snapshot} actions={actions} />
      <MatchEndDialog snapshot={snapshot.matchEnd} actions={actions} />
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
      <button
        type="button"
        className="camera-preset-button camera-projection-button"
        aria-pressed={snapshot.cameraProjection === "perspective"}
        onPointerDown={stopOverlayPointer}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.toggleCameraProjection();
          event.currentTarget.blur();
        }}
      >
        {snapshot.cameraProjection === "perspective" ? "Persp" : "Ortho"}
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
      <label className="tactical-toggle" onPointerDown={stopOverlayPointer}>
        <input
          type="checkbox"
          checked={snapshot.gravityOverlayEnabled}
          onChange={(event) => {
            actions.setGravityOverlayEnabled(event.currentTarget.checked);
            event.currentTarget.blur();
          }}
        />
        <span>Gravity</span>
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

function ObjectiveCommandMenu({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  const hasObjectiveCards = snapshot.objectiveCards.length > 0;

  return (
    <aside
      className="objective-command-menu"
      hidden={!hasObjectiveCards}
      aria-label="Objective groups"
      onPointerDown={stopOverlayPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="objective-command-grid">
        {snapshot.objectiveCards.map((card, index) => (
          <ObjectiveCommandCardButton
            key={card.id}
            card={card}
            hotkey={index < 5 ? index + 1 : null}
            selected={isObjectiveCommandCardSelected(
              card,
              snapshot.selectedUnits
            )}
            actions={actions}
          />
        ))}
      </div>
    </aside>
  );
}

function ObjectiveCommandCardButton({
  card,
  hotkey,
  selected,
  actions,
}: {
  card: ObjectiveCommandCard;
  hotkey: number | null;
  selected: boolean;
  actions: GameOverlayActions;
}) {
  return (
    <button
      type="button"
      className="objective-command-card"
      data-kind={card.kind}
      aria-pressed={selected}
      title={`${card.title} - ${card.detail}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.selectObjectiveCommandCard(card.id);
        event.currentTarget.blur();
      }}
    >
      <span className="objective-command-card-topline">
        <span
          className="objective-command-card-hotkey"
          hidden={hotkey === null}
          aria-hidden="true"
        >
          {hotkey}
        </span>
        <span className="objective-command-card-title">{card.title}</span>
      </span>
      <span className="objective-command-card-detail">{card.detail}</span>
    </button>
  );
}

function RightSideStack({
  snapshot,
  actions,
}: {
  snapshot: GameOverlaySnapshot;
  actions: GameOverlayActions;
}) {
  const hasRightSideContent =
    snapshot.selectedUnits.length > 0 || snapshot.selectedPlanet !== null;

  return (
    <div className="right-side-stack" hidden={!hasRightSideContent}>
      <SelectedObjectStatsPanel snapshot={snapshot} />
      <CommandMenu snapshot={snapshot} actions={actions} />
    </div>
  );
}

function SelectedObjectStatsPanel({
  snapshot,
}: {
  snapshot: GameOverlaySnapshot;
}) {
  const selectedUnit = readSelectedStatsUnit(snapshot);

  if (selectedUnit) {
    return (
      <ShipStatsPanel
        unit={selectedUnit}
        selectedUnits={snapshot.selectedUnits}
        objective={snapshot.selectedUnitObjective}
      />
    );
  }

  if (snapshot.selectedPlanet) {
    return <PlanetStatsPanel snapshot={snapshot.selectedPlanet} />;
  }

  return null;
}

function PlanetStatsPanel({
  snapshot,
}: {
  snapshot: SelectedPlanetStatsSnapshot;
}) {
  const { planet } = snapshot;

  return (
    <aside
      className="selected-object-stats selected-object-stats-planet"
      aria-label="Selected planet stats"
      style={
        {
          "--object-color": planet.color,
          "--control-color": snapshot.controlColor,
          "--capture-color": snapshot.captureColor,
          "--capture-progress": `${clamp01(snapshot.captureProgress ?? 0) * 100}%`,
        } as Record<string, string>
      }
      onPointerDown={stopOverlayPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <img
        className="selected-object-planet-render"
        src={snapshot.imageUrl}
        alt=""
        draggable={false}
        aria-hidden="true"
      />
      <div className="selected-object-header">
        <h2 className="selected-object-title">{planet.label}</h2>
        <div className="selected-object-subtitle">
          {formatPlanetClass(planet.appearance.planetClass)}{" "}
          {formatPlanetKind(planet)}
        </div>
      </div>
      <div className="selected-planet-control">
        <div className="selected-planet-owner">
          <span className="selected-planet-owner-label">Control</span>
          <span className="selected-planet-owner-value">
            {snapshot.controlLabel}
          </span>
        </div>
        <div
          className="selected-planet-capture"
          hidden={snapshot.captureProgress === null}
        >
          <div className="selected-planet-capture-copy">
            {snapshot.captureLabel}
          </div>
          <div className="selected-planet-capture-track" aria-hidden="true">
            <div className="selected-planet-capture-fill" />
          </div>
        </div>
      </div>
      <dl className="selected-object-stat-list">
        <SelectedObjectStat label="Size" value={formatScalar(planet.radius * 2)} />
        <SelectedObjectStat label="Radius" value={formatScalar(planet.radius)} />
        <SelectedObjectStat label="Mass" value={formatScalar(planet.mass)} />
        <SelectedObjectStat
          label="Atmo"
          value={planet.hasAtmosphere ? "Present" : "None"}
        />
      </dl>
    </aside>
  );
}

function ShipStatsPanel({
  unit,
  selectedUnits,
  objective,
}: {
  unit: UnitViewModel;
  selectedUnits: readonly UnitViewModel[];
  objective: SelectedUnitObjectiveSnapshot | null;
}) {
  const totalHealth = selectedUnits.reduce(
    (sum, selectedUnit) => sum + selectedUnit.health.current,
    0
  );
  const totalMaxHealth = selectedUnits.reduce(
    (sum, selectedUnit) => sum + selectedUnit.health.max,
    0
  );

  return (
    <aside
      className="selected-object-stats selected-object-stats-ship"
      aria-label="Selected ship stats"
      style={{ "--object-color": unit.color } as Record<string, string>}
      onPointerDown={stopOverlayPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="selected-object-ship-heading">
        <img
          className="selected-object-ship-symbol"
          src={createUnitSymbolImageUrl(unit.color, unit.owner, unit.shipClassId)}
          alt=""
          draggable={false}
          aria-hidden="true"
        />
        <div className="selected-object-header">
          <h2 className="selected-object-title">
            {unit.label} #{unit.handle.id}
          </h2>
          <div className="selected-object-subtitle">
            {unit.ownerName} / {unit.loadout.displayName}
          </div>
        </div>
      </div>
      <ShipObjectiveSummary objective={objective} />
      <ShipLoadoutGraph unit={unit} />
      <dl className="selected-object-stat-list selected-object-stat-list-ship">
        <SelectedObjectStat
          label={selectedUnits.length > 1 ? "Group HP" : "Hull"}
          value={`${formatScalar(totalHealth)} / ${formatScalar(totalMaxHealth)}`}
        />
        <SelectedObjectStat
          label="Mass"
          value={formatScalar(unit.stats.dryMass)}
        />
        <SelectedObjectStat
          label="Power"
          value={`${formatScalar(unit.stats.powerAvailable)} spare`}
          state={unit.stats.powerAvailable < 0 ? "warn" : "ok"}
        />
        <SelectedObjectStat
          label="Speed"
          value={formatScalar(unit.stats.maxSpeed)}
        />
        <SelectedObjectStat
          label="Accel"
          value={formatScalar(unit.stats.maxAcceleration)}
        />
        <SelectedObjectStat
          label="Weapons"
          value={unit.stats.weaponCount.toString()}
        />
        <SelectedObjectStat
          label="Fuel"
          value={formatScalar(unit.stats.fuelCapacity)}
        />
        <SelectedObjectStat
          label="Cargo"
          value={formatScalar(unit.stats.cargoCapacity)}
        />
      </dl>
      <div
        className="selected-object-selection-count"
        hidden={selectedUnits.length <= 1}
      >
        Selected {selectedUnits.length} ships / focused #{unit.handle.id}
      </div>
    </aside>
  );
}

function ShipObjectiveSummary({
  objective,
}: {
  objective: SelectedUnitObjectiveSnapshot | null;
}) {
  const resolved = objective ?? {
    orderLabel: "Idle",
    targetLabel: "No active objective",
    distanceLabel: "Ready",
    detailLabel: "",
    state: "idle" as const,
  };

  return (
    <section
      className="selected-object-objective"
      data-state={resolved.state}
      aria-label="Current order"
    >
      <div className="selected-object-objective-kicker">Current order</div>
      <div className="selected-object-objective-title">
        {resolved.orderLabel}
      </div>
      <div className="selected-object-objective-distance">
        {resolved.distanceLabel}
      </div>
      <div className="selected-object-objective-target">
        {resolved.targetLabel}
      </div>
      <div
        className="selected-object-objective-detail"
        hidden={!resolved.detailLabel}
      >
        {resolved.detailLabel}
      </div>
    </section>
  );
}

function ShipLoadoutGraph({ unit }: { unit: UnitViewModel }) {
  const midpoint = Math.ceil(unit.loadout.slots.length / 2);
  const leftSlots = unit.loadout.slots.slice(0, midpoint);
  const rightSlots = unit.loadout.slots.slice(midpoint);

  return (
    <div className="selected-object-loadout-graph" aria-label="Ship loadout">
      <div className="selected-object-loadout-column" data-side="left">
        {leftSlots.map((slot) => (
          <LoadoutSlotNode key={slot.slot.id} slot={slot} side="left" />
        ))}
      </div>
      <div className="selected-object-hull-node">
        <span className="selected-object-hull-label">Hull</span>
        <span className="selected-object-hull-value">
          {formatScalar(unit.stats.maxHealth)} HP
        </span>
        <span className="selected-object-hull-value">
          {formatScalar(unit.stats.basePower)} PWR
        </span>
      </div>
      <div className="selected-object-loadout-column" data-side="right">
        {rightSlots.map((slot) => (
          <LoadoutSlotNode key={slot.slot.id} slot={slot} side="right" />
        ))}
      </div>
    </div>
  );
}

function LoadoutSlotNode({
  slot,
  side,
}: {
  slot: UnitLoadoutSlotViewModel;
  side: "left" | "right";
}) {
  return (
    <div
      className="selected-object-loadout-node"
      data-side={side}
      data-slot-type={slot.slot.type}
      data-empty={slot.component ? "false" : "true"}
      style={
        {
          "--slot-color": readLoadoutSlotColor(slot.slot.type),
        } as Record<string, string>
      }
    >
      <span className="selected-object-loadout-slot">
        {formatLoadoutSlotLabel(slot)}
      </span>
      <span className="selected-object-loadout-component">
        {slot.component?.displayName ?? "Empty"}
      </span>
      <span className="selected-object-loadout-metric">
        {formatComponentMetric(slot)}
      </span>
    </div>
  );
}

function SelectedObjectStat({
  label,
  value,
  state = "neutral",
}: {
  label: string;
  value: string;
  state?: "neutral" | "ok" | "warn";
}) {
  return (
    <div className="selected-object-stat" data-state={state}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
  const showReadyButton = shouldShowReadyButton(snapshot.connectionStatus);
  const showCloseButton = shouldShowCloseButton(snapshot.connectionStatus);
  const actionCount =
    (snapshot.twoPlayerShare.canCreate ? 1 : 0) +
    (showReadyButton ? 1 : 0) +
    (showCloseButton ? 1 : 0);
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
          data-columns={actionCount <= 1 ? "1" : "2"}
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
          {showReadyButton ? (
            <button
              type="button"
              className="hotkeys-dialog-ready"
              disabled={
                isCurrentPlayerReady(snapshot.connectionStatus) ||
                snapshot.connectionStatus.state !== "open"
              }
              onPointerDown={stopOverlayPointer}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.readyForMatch();
                event.currentTarget.blur();
              }}
            >
              Ready
            </button>
          ) : null}
          {showCloseButton ? (
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
          ) : null}
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

function MatchEndDialog({
  snapshot,
  actions,
}: {
  snapshot: MatchEndDialogSnapshot;
  actions: GameOverlayActions;
}) {
  return (
    <div className="match-end-dialog" hidden={!snapshot.open}>
      <section className="match-end-dialog-panel" aria-label="Match stats">
        <h2 className="match-end-dialog-title">Match complete</h2>
        <div
          className="match-end-dialog-result"
          data-result={snapshot.resultKind}
        >
          {snapshot.resultText}
        </div>
        <dl className="match-end-dialog-stats">
          <dt>Time</dt>
          <dd>{snapshot.durationText}</dd>
          <dt>Reason</dt>
          <dd>{snapshot.reasonText}</dd>
          <dt>Planets</dt>
          <dd>
            <MatchEndStatPair
              playerOne={snapshot.playerOne}
              playerTwo={snapshot.playerTwo}
              readValue={(player) => player.planets}
            />
          </dd>
          <dt>Ships</dt>
          <dd>
            <MatchEndStatPair
              playerOne={snapshot.playerOne}
              playerTwo={snapshot.playerTwo}
              readValue={(player) => player.units}
            />
          </dd>
          <dt>Seed</dt>
          <dd>{snapshot.seedText}</dd>
        </dl>
        <button
          type="button"
          className="match-end-dialog-replay"
          disabled={!snapshot.canReplay || snapshot.replaying}
          onPointerDown={stopOverlayPointer}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            actions.replayMatch();
            event.currentTarget.blur();
          }}
        >
          {snapshot.replaying ? "Starting..." : "Replay"}
        </button>
      </section>
    </div>
  );
}

function MatchEndStatPair({
  playerOne,
  playerTwo,
  readValue,
}: {
  playerOne: MatchEndPlayerStatsSnapshot;
  playerTwo: MatchEndPlayerStatsSnapshot;
  readValue: (player: MatchEndPlayerStatsSnapshot) => number;
}) {
  return (
    <span className="match-end-stat-pair">
      <span
        className="match-end-stat-player"
        style={{ "--team-color": playerOne.color } as Record<string, string>}
      >
        P1 {readValue(playerOne)}
      </span>
      <span
        className="match-end-stat-player"
        style={{ "--team-color": playerTwo.color } as Record<string, string>}
      >
        P2 {readValue(playerTwo)}
      </span>
    </span>
  );
}

function readSelectedStatsUnit(
  snapshot: GameOverlaySnapshot
): UnitViewModel | null {
  if (snapshot.selectedUnits.length === 0) {
    return null;
  }

  return (
    snapshot.selectedUnits.find(
      (unit) => unit.key === snapshot.commandMenuLeaderKey
    ) ??
    snapshot.selectedUnits
      .slice()
      .sort((first, second) => first.handle.id - second.handle.id)[0] ??
    null
  );
}

function isObjectiveCommandCardSelected(
  card: ObjectiveCommandCard,
  selectedUnits: readonly UnitViewModel[]
): boolean {
  if (
    selectedUnits.length !== card.unitKeys.length ||
    card.unitKeys.length === 0
  ) {
    return false;
  }

  const selectedKeys = new Set(selectedUnits.map((unit) => unit.key));
  return card.unitKeys.every((unitKey) => selectedKeys.has(unitKey));
}

function formatPlanetClass(
  planetClass: PlanetViewModel["appearance"]["planetClass"]
): string {
  switch (planetClass) {
    case "sun":
      return "Sun";
    case "gas-giant":
      return "Gas giant";
    case "terran":
      return "Terran";
    case "ice":
      return "Ice";
    default:
      return planetClass;
  }
}

function formatPlanetKind(planet: PlanetViewModel): string {
  if (planet.appearance.planetClass === "sun") {
    return "star";
  }

  return planet.parentPlanetIndex === null ? "primary" : "moon";
}

function formatLoadoutSlotLabel(slot: UnitLoadoutSlotViewModel): string {
  const slotNumber = slot.slot.id.match(/-(\d+)$/)?.[1];
  const label = formatSlotType(slot.slot.type);

  return slotNumber ? `${label} ${slotNumber}` : label;
}

function formatSlotType(type: UnitLoadoutSlotViewModel["slot"]["type"]): string {
  switch (type) {
    case "engine":
      return "Engine";
    case "fuelTank":
      return "Fuel";
    case "cargo":
      return "Cargo";
    case "weapon":
      return "Weapon";
    default:
      return type;
  }
}

function formatComponentMetric(slot: UnitLoadoutSlotViewModel): string {
  const { component } = slot;

  if (!component) {
    return `${slot.slot.size} slot`;
  }

  if (component.type === "engine") {
    return `${formatScalar(component.thrust)} thrust`;
  }

  if (component.type === "fuelTank") {
    return `${formatScalar(component.fuelCapacity)} fuel`;
  }

  if (component.type === "cargo") {
    return `${formatScalar(component.cargoCapacity)} cargo`;
  }

  return `${formatScalar(component.damage)} dmg / ${component.cooldownTicks}t`;
}

function readLoadoutSlotColor(
  type: UnitLoadoutSlotViewModel["slot"]["type"]
): string {
  switch (type) {
    case "engine":
      return "#74d9ff";
    case "fuelTank":
      return "#86f0a8";
    case "cargo":
      return "#ffd166";
    case "weapon":
      return "#ff4fd8";
    default:
      return "#d6dae8";
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function formatScalar(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(value >= 10 ? 1 : 2);
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
  ["1-5", "Select objective card"],
  ["8", "Filter/select fighters"],
  ["9", "Filter/select battleships"],
  ["0", "Filter/select drop ships"],
  ["D", "Clear selection"],
  ["C", "Capture selected planet"],
  ["G", "Guard selected planet"],
  ["Z", "Zoom to selection"],
  ["F", "Fit to world"],
  ["T", "Toggle tactical overlay"],
  ["P", "Pause and show hotkeys"],
  ["Space", "Reselect previous command group"],
  ["Tab", "Cycle nearby target"],
  ["Shift+Tab", "Cycle previous target"],
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
      return "Player 2";
    case "spectator":
      return "Spectator";
    case "player1":
    default:
      return "Player 1";
  }
}

function shouldShowReadyButton(status: RuntimeConnectionStatus): boolean {
  return (
    status.mode === "network" &&
    status.canControl &&
    status.role !== "spectator" &&
    !status.running
  );
}

function shouldShowCloseButton(status: RuntimeConnectionStatus): boolean {
  return status.mode !== "network" || Boolean(status.running);
}

function isCurrentPlayerReady(status: RuntimeConnectionStatus): boolean {
  const playerId = status.role === "player2" ? 2 : 1;
  return (
    status.players?.find((player) => player.playerId === playerId)?.ready ??
    false
  );
}
