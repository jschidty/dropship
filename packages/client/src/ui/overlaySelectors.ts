import type { PlayerId } from "@drop-ship/protocol";
import type {
  LocalGameRuntime,
  PlanetViewModel,
  UnitViewModel,
} from "../types";
import type { MatchStatusSnapshot } from "./GameOverlay";

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

function createPlayerMatchStatusText(
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  playerId: PlayerId
): string {
  const controlledPlanets = planets
    .filter(
      (planet) =>
        planet.control.capturable && planet.control.owner === playerId
    )
    .length;
  const liveUnits = units
    .filter((unit) => unit.owner === playerId && unit.health.current > 0)
    .length;

  return `P${playerId} ${controlledPlanets}P ${liveUnits}U`;
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
