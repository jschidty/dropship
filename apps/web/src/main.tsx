import "./styles.css";
import { useEffect, useMemo, useRef } from "preact/hooks";
import {
  ErrorBoundary,
  LocationProvider,
  Route,
  Router,
  hydrate,
  useLocation,
  type RoutePropsForPath,
} from "preact-iso";
import { mountMinimalGame, type RenderQualityMode } from "@drop-ship/client";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app mount point");
}

hydrate(<App />, app);

function App() {
  return (
    <LocationProvider>
      <ErrorBoundary>
        <Router>
          <Route path="/" component={GameRoute} />
          <Route path="/play/:gameId" component={GameRoute} />
          <Route default component={NotFoundRoute} />
        </Router>
      </ErrorBoundary>
    </LocationProvider>
  );
}

type PlayRouteProps = Partial<RoutePropsForPath<"/play/:gameId">>;

function GameRoute({ gameId: routeGameId }: PlayRouteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const defaultLocalSeedRef = useRef<number | null>(null);
  const location = useLocation();
  const defaultLocalSeed =
    defaultLocalSeedRef.current ??
    (defaultLocalSeedRef.current = createRandomSeed());

  const mountOptions = useMemo(() => {
    const query = location.query;
    const serverUrl = query.server ?? undefined;
    const seedParam = parseInteger(query.seed ?? null);
    const wantsNetwork = query.network === "1";
    const gameId = parseGameId(routeGameId ?? query.gameId ?? null);
    const legacyMatchId = wantsNetwork
      ? parseGameId(query.match ?? null)
      : undefined;
    const matchId =
      gameId ??
      legacyMatchId ??
      (wantsNetwork
        ? seedParam !== undefined
          ? `seed-${seedParam}`
          : "demo"
        : undefined);
    const seed =
      seedParam ?? (matchId === undefined ? defaultLocalSeed : undefined);
    const creatorToken = gameId ? readCreatorToken(gameId) : undefined;
    const playerToken = gameId ? readPlayerToken(gameId) : undefined;
    const stressUnits = parsePositiveInteger(
      query.stressUnits ?? query.units ?? null
    );
    const renderMode = parseRenderMode(
      query.render ?? query.renderMode ?? query.quality ?? null
    );
    const debugNetworkLogs =
      parseOptionalBoolean(query.debugNetworkLogs ?? query.netLogs ?? null) ??
      (import.meta.env.DEV || isLocalHostname(window.location.hostname));
    const debugMatchParams =
      import.meta.env.DEV ||
      isLocalHostname(window.location.hostname) ||
      query.debugMatch === "1" ||
      query.debugSeat === "1";

    return {
      key: [
        location.path,
        matchId ?? "local",
        seed ?? "seed-default",
        stressUnits ?? "units-default",
        renderMode ?? "render-default",
        serverUrl ?? "same-origin",
        debugMatchParams ? "debug-match" : "release-match",
        debugNetworkLogs ? "net-logs" : "net-quiet",
        creatorToken ? "creator" : "public",
        playerToken ? "player-token" : "no-player-token",
      ].join("|"),
      matchId,
      serverUrl,
      network: Boolean(matchId),
      seed,
      stressUnits,
      renderMode,
      debugMatchParams,
      debugNetworkLogs,
      initialPaused: true,
      creatorToken,
      playerToken,
    };
  }, [defaultLocalSeed, location.path, location.query, routeGameId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const mountedGame = mountMinimalGame(containerRef.current, {
      matchId: mountOptions.matchId,
      serverUrl: mountOptions.serverUrl,
      network: mountOptions.network,
      seed: mountOptions.seed,
      stressUnits: mountOptions.stressUnits,
      renderMode: mountOptions.renderMode,
      debugMatchParams: mountOptions.debugMatchParams,
      debugNetworkLogs: mountOptions.debugNetworkLogs,
      initialPaused: mountOptions.initialPaused,
      creatorToken: mountOptions.creatorToken,
      playerToken: mountOptions.playerToken,
      rememberPlayerToken,
      createTwoPlayerGame: () =>
        createTwoPlayerGame({
          route: location.route,
          serverUrl: mountOptions.serverUrl,
        }),
    });

    return () => {
      mountedGame.dispose();
    };
  }, [mountOptions.key]);

  return <div className="game-route" ref={containerRef} />;
}

function NotFoundRoute() {
  const location = useLocation();

  useEffect(() => {
    location.route("/", true);
  }, [location]);

  return null;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parseInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function parseGameId(value: string | null): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function parseRenderMode(value: string | null): RenderQualityMode | undefined {
  return value === "cinematic" || value === "interactive" ? value : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }

  return undefined;
}

function createRandomSeed(): number {
  if (globalThis.crypto?.getRandomValues) {
    return (
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000_000
    );
  }

  return Math.floor(Math.random() * 1_000_000_000);
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

async function createTwoPlayerGame(options: {
  route: (url: string, replace?: boolean) => void;
  serverUrl?: string;
}): Promise<void> {
  const response = await fetch(createApiUrl("/api/matches", options.serverUrl), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Could not create a two player game.");
  }

  const payload = (await response.json()) as {
    gameId?: unknown;
    matchId?: unknown;
    creatorToken?: unknown;
  };
  const gameId =
    typeof payload.gameId === "string"
      ? payload.gameId
      : typeof payload.matchId === "string"
        ? payload.matchId
        : "";

  if (!gameId) {
    throw new Error("The server did not return a game id.");
  }

  if (typeof payload.creatorToken === "string" && payload.creatorToken) {
    rememberCreatorToken(gameId, payload.creatorToken);
  }

  const sharePath = createTwoPlayerSharePath(gameId);
  const shareUrl = new URL(sharePath, window.location.href).toString();

  try {
    await copyShareLink(shareUrl);
  } catch {
    // The URL still becomes the share link so the creator can copy it manually.
  }

  options.route(sharePath);
}

function createApiUrl(path: string, serverUrl: string | undefined): string {
  const url = new URL(serverUrl ?? window.location.origin, window.location.href);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  return new URL(path, url).toString();
}

function createTwoPlayerSharePath(gameId: string): string {
  const url = new URL(window.location.href);

  url.pathname = `/play/${encodeURIComponent(gameId)}`;
  url.searchParams.delete("gameId");
  url.searchParams.delete("network");
  url.searchParams.delete("match");
  url.searchParams.delete("player");
  url.searchParams.delete("p");
  url.searchParams.delete("player1");
  url.searchParams.delete("player2");
  url.searchParams.delete("debugSeat");
  url.searchParams.delete("debugMatch");
  url.searchParams.delete("stressUnits");
  url.searchParams.delete("units");

  return `${url.pathname}${url.search}${url.hash}`;
}

async function copyShareLink(shareUrl: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(shareUrl);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = shareUrl;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed");
    }
  } finally {
    textarea.remove();
  }
}

function rememberCreatorToken(gameId: string, creatorToken: string): void {
  try {
    window.localStorage.setItem(creatorTokenStorageKey(gameId), creatorToken);
  } catch {
    try {
      window.sessionStorage.setItem(creatorTokenStorageKey(gameId), creatorToken);
    } catch {
      // Without storage, the creator can still use the copied spectator link.
    }
  }
}

function readCreatorToken(gameId: string): string | undefined {
  try {
    const token = window.localStorage.getItem(creatorTokenStorageKey(gameId));

    if (token) {
      return token;
    }
  } catch {
    // Fall back to session storage below.
  }

  try {
    return window.sessionStorage.getItem(creatorTokenStorageKey(gameId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function creatorTokenStorageKey(gameId: string): string {
  return `drop-ship:creator-token:${gameId}`;
}

function rememberPlayerToken(gameId: string, playerToken: string): void {
  try {
    window.localStorage.setItem(playerTokenStorageKey(gameId), playerToken);
  } catch {
    try {
      window.sessionStorage.setItem(playerTokenStorageKey(gameId), playerToken);
    } catch {
      // Without storage, player 2 can still play until the current socket drops.
    }
  }
}

function readPlayerToken(gameId: string): string | undefined {
  try {
    const token = window.localStorage.getItem(playerTokenStorageKey(gameId));

    if (token) {
      return token;
    }
  } catch {
    // Fall back to session storage below.
  }

  try {
    return window.sessionStorage.getItem(playerTokenStorageKey(gameId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function playerTokenStorageKey(gameId: string): string {
  return `drop-ship:player-token:${gameId}`;
}
