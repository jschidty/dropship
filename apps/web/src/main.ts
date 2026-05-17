import "./styles.css";
import type { PlayerId } from "@drop-ship/protocol";
import { mountMinimalGame } from "@drop-ship/client";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app mount point");
}

const params = new URLSearchParams(window.location.search);
const matchId = params.get("match") ?? undefined;
const serverUrl = params.get("server") ?? undefined;
const playerId = parsePlayerId(params.get("player") ?? params.get("p"));
const stressUnits = parsePositiveInteger(
  params.get("stressUnits") ?? params.get("units")
);

mountMinimalGame(app, {
  playerId,
  matchId,
  serverUrl,
  network: params.get("network") === "1" || Boolean(matchId),
  stressUnits,
});

function parsePlayerId(value: string | null): PlayerId {
  return value === "2" ? 2 : 1;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}
