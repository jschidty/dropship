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

mountMinimalGame(app, {
  playerId,
  matchId,
  serverUrl,
  network: params.get("network") === "1" || Boolean(matchId),
});

function parsePlayerId(value: string | null): PlayerId {
  return value === "2" ? 2 : 1;
}
