export { MatchDurableObject } from "./matchDO";

export type WorkerEnv = {
  MATCHES: DurableObjectNamespace;
  ASSETS?: Fetcher;
};

export async function handleRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({
      ok: true,
      service: "drop-ship-server",
    });
  }

  if (url.pathname === "/api/matches") {
    return handleCreateMatchRequest(request, env, url);
  }

  const matchRoute = parseMatchRoute(url.pathname);

  if (matchRoute) {
    const id = env.MATCHES.idFromName(matchRoute.matchId);
    const stub = env.MATCHES.get(id);
    return stub.fetch(request);
  }

  if (env.ASSETS) {
    const assetResponse = await env.ASSETS.fetch(request);

    if (
      assetResponse.status !== 404 ||
      request.method !== "GET" ||
      !isAppRoute(url.pathname)
    ) {
      return assetResponse;
    }

    return env.ASSETS.fetch(
      new Request(new URL("/", url), {
        method: "GET",
        headers: request.headers,
      })
    );
  }

  return Response.json(
    {
      service: "drop-ship-server",
      status: "missing-assets-binding",
      routes: [
        "/",
        "/play/:gameId",
        "/api/health",
        "POST /api/matches",
        "/api/matches/:matchId/ws",
      ],
    },
    { status: 200 }
  );
}

const worker = {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default worker;

function parseMatchRoute(pathname: string): { matchId: string } | null {
  const match = /^\/api\/matches\/([^/]+)(?:\/ws)?$/.exec(pathname);

  if (!match) {
    return null;
  }

  return {
    matchId: decodeURIComponent(match[1]),
  };
}

function isAppRoute(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/play/");
}

async function handleCreateMatchRequest(
  request: Request,
  env: WorkerEnv,
  url: URL
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CREATE_MATCH_CORS_HEADERS,
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      {
        error: "method-not-allowed",
      },
      {
        status: 405,
        headers: {
          ...CREATE_MATCH_CORS_HEADERS,
          Allow: "POST, OPTIONS",
        },
      }
    );
  }

  const gameId = createGameId();
  const creatorToken = createGameId();
  const id = env.MATCHES.idFromName(gameId);
  const stub = env.MATCHES.get(id);
  const statusUrl = new URL(`/api/matches/${encodeURIComponent(gameId)}`, url);

  await stub.fetch(
    new Request(statusUrl, {
      method: "POST",
      headers: {
        "x-drop-ship-creator-token": creatorToken,
      },
    })
  );

  return Response.json(
    {
      gameId,
      matchId: gameId,
      creatorToken,
    },
    {
      status: 201,
      headers: CREATE_MATCH_CORS_HEADERS,
    }
  );
}

export function createGameId(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}-${Math.random().toString(36).slice(2)}`;

  return `game-${randomId}`;
}

const CREATE_MATCH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
