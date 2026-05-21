# Minimal Cloudflare Demo

This is the current deployable multiplayer slice. It is intentionally small:

- one Worker serves the built web app as static assets
- one `MatchDurableObject` coordinates a match over WebSockets
- the app opens in paused local single-player by default
- the pause menu can create a two-player `gameId` link backed by a `MatchDurableObject`
- both browsers run the deterministic sim locally from ordered tick batches

## Local Worker Smoke Test

```bash
pnpm install
pnpm build
pnpm dev:server
```

Open the app:

```text
http://127.0.0.1:8787/
```

The game starts paused. Use the pause menu's **Two player** button to create a
unique `/play/:gameId` share link. The link uses `gameId`, not `player`; the
creator keeps a local creator claim and takes P1, the first guest takes P2, and
later opens of the same link join as spectators. The match starts ticking once
P1 and P2 are connected.

## Deploy

Set a Cloudflare API token with permission to deploy Workers and Durable Objects, then run:

```bash
CLOUDFLARE_API_TOKEN=... pnpm deploy
```

After deploy, open the deployed Worker URL and create the share link from the
pause menu:

```text
https://<worker-host>/
```

## Current Limits

- no lobby UI yet
- no Durable Object SQLite persistence yet
- no auth, accounts, or matchmaking yet
- spectators can watch from the share link but cannot control units
- the DO pauses ticking until both player seats are connected
