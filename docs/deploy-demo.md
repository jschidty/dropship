# Minimal Cloudflare Demo

This is the current deployable multiplayer slice. It is intentionally small:

- one Worker serves the built web app as static assets
- one `MatchDurableObject` coordinates a match over WebSockets
- two browser seats join with URL params
- both browsers run the deterministic sim locally from ordered tick batches

## Local Worker Smoke Test

```bash
pnpm install
pnpm build
pnpm dev:server
```

Open two browser windows:

```text
http://127.0.0.1:8787/?match=demo&player=1
http://127.0.0.1:8787/?match=demo&player=2
```

The match starts ticking once both seats are connected.

## Deploy

Set a Cloudflare API token with permission to deploy Workers and Durable Objects, then run:

```bash
CLOUDFLARE_API_TOKEN=... pnpm deploy
```

After deploy, use the deployed Worker URL with the same match/player params:

```text
https://<worker-host>/?match=demo&player=1
https://<worker-host>/?match=demo&player=2
```

## Current Limits

- no lobby UI yet
- no reconnect/catch-up command log yet
- no Durable Object SQLite persistence yet
- no auth or seat locking beyond the URL param
- the DO pauses ticking until both player seats are connected
