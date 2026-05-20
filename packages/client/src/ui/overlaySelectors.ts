import type { PlayerId } from "@drop-ship/protocol";
import type {
  LocalGameRuntime,
  PlanetViewModel,
  RenderQualityMode,
  UnitViewModel,
} from "../types";
import type { MatchStatusSnapshot } from "./GameOverlay";

export function createMatchStatusSnapshot(
  runtime: LocalGameRuntime,
  units: readonly UnitViewModel[],
  planets: readonly PlanetViewModel[],
  isPaused = false
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
    resultText: formatMatchResult(runtime, isPaused),
    resultKind: readMatchResultKind(runtime),
  };
}

export function createStatsText(
  runtime: LocalGameRuntime,
  estimatedFps: number,
  observedSimHz: number,
  estimatedRenderMs: number,
  drawCalls: number,
  pixelRatio: number,
  renderMode: RenderQualityMode,
  selectedPlanetLabel: string,
  selectedUnitCount: number
): string {
  return `Planet ${selectedPlanetLabel} / Units ${runtime.world.units.length} / Selected ${selectedUnitCount} / Tick ${runtime.world.tick
    .toString()
    .padStart(5, "0")} / ${renderMode} / ${estimatedFps.toFixed(0)} fps / ${observedSimHz.toFixed(1)} sim / ${drawCalls} calls / ${estimatedRenderMs.toFixed(2)} ms / ${pixelRatio.toFixed(2)}x / Hash ${runtime.readHash()}`;
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

  return result.winner === runtime.playerId ? "win" : "lose";
}

function formatMatchResult(
  runtime: LocalGameRuntime,
  isPaused: boolean
): string {
  const result = runtime.world.matchResult;

  if (!result) {
    return isPaused ? "Paused" : "";
  }

  const label =
    result.winner === 0
      ? "Draw"
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
