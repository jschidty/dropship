import { PHASE_ONE_SIM_HZ, type PlayerId } from "@drop-ship/protocol";
import type {
  LocalGameRuntime,
  PlanetViewModel,
  UnitViewModel,
} from "../types";
import type { MatchEndDialogSnapshot, MatchStatusSnapshot } from "./GameOverlay";

export function createMatchStatusSnapshot(
  runtime: LocalGameRuntime,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  pendingStatusText = ""
): MatchStatusSnapshot {
  const rules = runtime.world.config.rules.matchEnd;
  const remainingTicks = Math.max(rules.durationTicks - runtime.world.tick, 0);
  const playerOne = runtime.world.config.players.find(
    (player) => player.id === 1
  );
  const playerTwo = runtime.world.config.players.find(
    (player) => player.id === 2
  );

  return {
    remainingTicks,
    playerOneText: createPlayerMatchStatusText(units, planets, 1),
    playerTwoText: createPlayerMatchStatusText(units, planets, 2),
    playerOneColor: playerOne?.color ?? "#74d9ff",
    playerTwoColor: playerTwo?.color ?? "#ff4fd8",
    resultText: formatMatchResult(runtime, pendingStatusText),
    resultKind: readMatchResultKind(runtime),
  };
}

export function createMatchEndDialogSnapshot(
  runtime: LocalGameRuntime,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  options: Readonly<{
    open: boolean;
    replaying: boolean;
  }>
): MatchEndDialogSnapshot {
  const result = runtime.world.matchResult;
  const status = runtime.readConnectionStatus();
  const playerOne = runtime.world.config.players.find(
    (player) => player.id === 1
  );
  const playerTwo = runtime.world.config.players.find(
    (player) => player.id === 2
  );

  if (!options.open || !result) {
    return {
      open: false,
      resultText: "",
      resultKind: "pending",
      reasonText: "",
      durationText: "",
      seedText: "",
      playerOne: {
        label: playerOne?.name ?? "Player 1",
        color: playerOne?.color ?? "#74d9ff",
        planets: 0,
        units: 0,
      },
      playerTwo: {
        label: playerTwo?.name ?? "Player 2",
        color: playerTwo?.color ?? "#ff4fd8",
        planets: 0,
        units: 0,
      },
      canReplay: false,
      replaying: options.replaying,
    };
  }

  return {
    open: true,
    resultText: formatMatchResult(runtime, ""),
    resultKind: readMatchResultKind(runtime),
    reasonText: formatMatchResultReason(result.reason),
    durationText: formatMatchDuration(result.completedTick),
    seedText: runtime.world.config.seed.toString(),
    playerOne: {
      label: playerOne?.name ?? "Player 1",
      color: playerOne?.color ?? "#74d9ff",
      planets: countControlledPlanets(planets, 1),
      units: countLiveUnits(units, 1),
    },
    playerTwo: {
      label: playerTwo?.name ?? "Player 2",
      color: playerTwo?.color ?? "#ff4fd8",
      planets: countControlledPlanets(planets, 2),
      units: countLiveUnits(units, 2),
    },
    canReplay: status.canControl,
    replaying: options.replaying,
  };
}

function createPlayerMatchStatusText(
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  playerId: PlayerId
): string {
  const controlledPlanets = countControlledPlanets(planets, playerId);
  const liveUnits = countLiveUnits(units, playerId);

  return `P${playerId} ${controlledPlanets}P ${liveUnits}U`;
}

function countControlledPlanets(
  planets: readonly PlanetViewModel[],
  playerId: PlayerId
): number {
  return planets.filter(
    (planet) => planet.control.capturable && planet.control.owner === playerId
  ).length;
}

function countLiveUnits(
  units: readonly UnitViewModel[],
  playerId: PlayerId
): number {
  return units.filter(
    (unit) => unit.owner === playerId && unit.health.current > 0
  ).length;
}

function readMatchResultKind(
  runtime: LocalGameRuntime
): MatchStatusSnapshot["resultKind"] {
  const result = runtime.world.matchResult;

  if (!result) {
    return "pending";
  }

  if (result.winner === 0) {
    return "draw";
  }

  if (runtime.readConnectionStatus().role === "spectator") {
    return "pending";
  }

  return result.winner === runtime.playerId ? "win" : "lose";
}

function formatMatchResult(
  runtime: LocalGameRuntime,
  pendingStatusText: string
): string {
  const result = runtime.world.matchResult;

  if (!result) {
    return pendingStatusText;
  }

  const label =
    result.winner === 0
      ? "Draw"
      : runtime.readConnectionStatus().role === "spectator"
        ? `P${result.winner} win`
      : result.winner === runtime.playerId
        ? "Win"
        : "Lose";

  return `${label} ${formatMatchResultReason(result.reason)}`;
}

function formatMatchResultReason(reason: string): string {
  switch (reason) {
    case "allPlanetsCaptured":
      return "all planets";
    case "dropShipsLost":
      return "drop ship lost";
    case "timerPlanets":
      return "planet count";
    case "timerUnits":
      return "unit count";
    case "timerTie":
      return "timer tie";
    default:
      return reason;
  }
}

function formatMatchDuration(ticks: number): string {
  const totalSeconds = Math.max(0, Math.ceil((ticks + 1) / PHASE_ONE_SIM_HZ));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
