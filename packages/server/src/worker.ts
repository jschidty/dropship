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

  const matchRoute = parseMatchRoute(url.pathname);

  if (matchRoute) {
    const id = env.MATCHES.idFromName(matchRoute.matchId);
    const stub = env.MATCHES.get(id);
    return stub.fetch(request);
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return Response.json(
    {
      service: "drop-ship-server",
      status: "missing-assets-binding",
      routes: ["/api/health", "/api/matches/:matchId/ws"],
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
