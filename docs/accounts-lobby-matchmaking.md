# Accounts, Lobby, and Matchmaking

## Goal

The next product layer turns the current URL-driven multiplayer demo into a friendly game shell:

- Google sign-in through Better Auth
- local single-player remains available
- a first-run / returning splash screen with the provided "how to play" graphic
- authenticated profiles with a rudimentary Elo-like rating
- lobbies for friend games and ready checks
- matchmaking for quick 1v1 games
- server-assigned player seats instead of `player=1` / `player=2` in URLs

This is still friendly play. The goal is to stop trusting obvious client-controlled identity and seat fields, not to build cheat-proof competitive infrastructure. Deterministic clients, trusted snapshots, and agreed match ends remain acceptable for this phase.

## Product Shape

First screen:

1. Show the splash experience with the provided graphic, concise "how to play" controls, and primary actions.
2. Offer **Play Solo** immediately, without requiring sign-in.
3. Offer **Sign in with Google** for multiplayer, rating, and match history.
4. After sign-in, show the player card, current rating, quick play, create lobby, and join lobby.

Initial modes:

| Mode | Auth | Rated | Runtime |
|---|---|---:|---|
| Solo vs NPC | optional | no | local deterministic scheduler |
| Private lobby | required | no by default | Match Durable Object |
| Quick match | required | yes | Matchmaker Durable Object creates Match Durable Object |

Solo play must keep using the same command-batch path described in [gameplay-demo.md](gameplay-demo.md#single-player-test-mode). It can skip Worker and Durable Object transport, but it must not mutate sim state through a separate shortcut.

## Platform Direction

Keep the app on Cloudflare:

- Worker serves the Vite app, API routes, and Better Auth routes.
- D1 stores Better Auth tables plus profiles, ratings, lobbies, match records, and rating events.
- Durable Objects coordinate live lobby, matchmaking, and match WebSockets.
- The existing `MatchDurableObject` remains the live match coordinator.
- R2 can still be added later for archived replays / command logs.

Recommended new bindings:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "drop_ship",
      "database_id": "..."
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "MATCHES", "class_name": "MatchDurableObject" },
      { "name": "LOBBIES", "class_name": "LobbyDurableObject" },
      { "name": "MATCHMAKERS", "class_name": "MatchmakerDurableObject" }
    ]
  }
}
```

Add Durable Object migrations for `LobbyDurableObject` and `MatchmakerDurableObject` when those classes are introduced. Use SQLite-backed classes if they persist queue/lobby state or set cleanup alarms.

The current `MatchDurableObject` constructor only receives `state`. It can already record final match status in DO storage, but when D1 result persistence lands, pass `env` into the DO class so it can write D1 rows or call a shared finalization helper.

## Authentication

Use Better Auth with Google as the only multiplayer sign-in method for the first pass.

Server setup:

- mount Better Auth at `/api/auth/*`
- configure `socialProviders.google`
- disable email/password
- set `baseURL` explicitly per environment
- add `nodejs_als` or `nodejs_compat` in Wrangler for Cloudflare Workers
- store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` as secrets

Database adapter:

- Prefer a normal D1-backed relational path rather than auth-only custom storage.
- Either use Better Auth's Kysely-compatible path with the Cloudflare D1 dialect, or Drizzle with `@better-auth/drizzle-adapter`.
- Generate Better Auth's schema into a committed migration and apply it through Wrangler / D1 migrations.

Session rules:

- `/api/me`, lobby APIs, matchmaking APIs, and match WebSockets read the Better Auth session.
- Multiplayer APIs return `401` when no session exists.
- Solo play does not create a server user and does not write ratings.
- Request only the Google scopes needed for identity. Do not add Google Drive, Contacts, or broad account scopes.
- Do not store OAuth access tokens unless a later feature needs them. If tokens are stored, enable encryption or add database hooks before launch.

## App Tables

Better Auth owns its core user, session, account, and verification tables. Add app-specific tables next to them.

```sql
profiles(
  user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  image_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

player_ratings(
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  rating INTEGER NOT NULL,
  games_played INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  provisional_games_remaining INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode)
);

lobbies(
  lobby_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  access_code TEXT UNIQUE,
  rated INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

lobby_members(
  lobby_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seat INTEGER,
  ready INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (lobby_id, user_id)
);

matchmaking_tickets(
  ticket_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  rating_snapshot INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

matches(
  match_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  seed INTEGER NOT NULL,
  lobby_id TEXT,
  rated INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  winner_user_id TEXT,
  end_reason TEXT
);

match_participants(
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  rating_before INTEGER,
  rating_after INTEGER,
  result TEXT,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, player_id)
);

rating_events(
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
```

Use integer timestamps initially. D1 stores SQLite values, so keep schemas strict and avoid relying on `undefined` values in prepared statements.

## Seat And URL Hardening

Current v1 public two-player URLs encode only the game in the path:

```text
/play/game-...
```

The pause menu creates the `gameId` through `POST /api/matches`, routes to
`/play/:gameId`, and copies that share link. The browser still accepts
`?gameId=...` for compatibility, but generated links use the route param. It
ignores `player`, `p`, `player1`, and `player2` query params in normal app
startup; without a route/query game id it assumes local single-player.

For this v1 pre-lobby flow, the create response also returns a creator token
stored only in the creator's browser. The copied share link does not include that
token. The creator claims P1, the first non-creator connection claims P2, and
later connections become spectators by default.

Target public URLs:

```text
/solo
/lobby/:accessCode
/play/:matchId
```

Rules:

- The browser never decides `PlayerId` for multiplayer.
- The WebSocket URL is `/api/matches/:matchId/ws`, with no `player` query param.
- Until accounts/lobbies exist, the match DO assigns seats from the creator token
  and active connections, then assigns spectators after P1/P2 are occupied.
- The Worker authenticates the request, strips any client-supplied internal identity headers, resolves the user session, and forwards a server-authored identity context to the DO with `x-drop-ship-player-id`.
- The DO maps `user_id` to `player_id` from `match_participants`.
- `matchStart` remains the moment where the server tells the client its `playerId`.
- Client messages should eventually omit `playerId`. During migration, keep the field for compatibility but have the DO overwrite it from the session assignment.
- Reconnect uses session plus `match_id`; it does not accept `playerId` from the client.
- Debug seed and direct-seat URLs may remain only behind local development flags such as `debugSeat=1`; production app paths should not emit them.

This blocks casual seat stealing and accidental wrong-link bugs. It does not stop a modified client from sending bad commands for its assigned seat, which is acceptable for this phase.

## Lobby Flow

Private lobby is the friend-game path.

1. Signed-in user creates a lobby.
2. Worker inserts `lobbies` and owner `lobby_members` rows.
3. Browser navigates to `/lobby/:accessCode`.
4. `LobbyDurableObject` owns live member presence, ready state, and start countdown.
5. Invited user signs in, joins with the access code, and appears in the lobby.
6. When both users are ready, the lobby creates a match row, assigns seats, initializes the match DO, and sends `matchCreated`.
7. Clients navigate to `/play/:matchId`.

Lobby state:

- mode / ruleset
- owner
- two member slots
- ready flags
- rated flag, default `false`
- created match ID, once started
- expiry alarm for abandoned lobbies

Private lobbies should be unrated until there is a reason to trust them more. If rated private games are allowed later, show the rating effect clearly before ready-up.

## Matchmaking Flow

Quick match is the rated path.

1. Signed-in user clicks quick match.
2. Worker creates or refreshes a `matchmaking_tickets` row with the current rating snapshot.
3. The request routes to a queue-specific `MatchmakerDurableObject`, for example `captureDemo:ranked:v1`.
4. The matchmaker keeps active tickets in memory, backed by D1 rows for reconnect and cleanup.
5. It pairs the oldest compatible tickets, creates a match, assigns seats, and notifies both clients.
6. Clients navigate to `/play/:matchId`.

Initial matching rule:

- start with a rating window of `100`
- widen by `50` every `10` seconds
- cap at `400`
- after `60` seconds, offer to keep waiting or switch to solo
- do not fill rated matches with NPCs

Seat assignment can be random from the match seed:

```text
hash(matchId + userA + userB) % 2
```

Store the chosen assignment in `match_participants` before either client receives the match ID.

## Rudimentary Elo

This is a friendly rating, not a serious ladder.

Defaults:

- starting rating: `1000`
- normal K-factor: `32`
- provisional K-factor: `48` for the first `10` rated games
- win score: `1`
- draw score: `0.5`
- loss score: `0`

Formula:

```text
expectedA = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
ratingA' = ratingA + K * (scoreA - expectedA)
```

Update rules:

- update ratings only for `rated = 1` matches
- update exactly once per match participant, enforced by `rating_events`
- store `rating_before` and `rating_after` on `match_participants`
- count agreed deterministic match results normally
- treat a disconnect after match start as a loss only after a short reconnect grace period
- do not rate matches that fail before both players receive `matchStart`
- do not rate solo or private unrated lobby games

Because the match result is still client/trusted-snapshot based, the UI should call this "rating" rather than promising a cheat-resistant competitive ladder.

## Match DO Changes

The match coordinator should receive match metadata before accepting player sockets:

```ts
type MatchInit = Readonly<{
  matchId: string;
  seed: number;
  mode: "captureDemo";
  rated: boolean;
  participants: readonly {
    userId: string;
    playerId: PlayerId;
    displayName: string;
    color: string;
  }[];
}>;
```

`MatchConfig.players` should use profile names instead of `Player 1` / `Player 2` where available. Controllers remain `human` for both seats in multiplayer. The match DO should reject a WebSocket when:

- the match is unknown or expired
- the session user is not a participant
- that user already has an active socket and the reconnect policy denies another
- the match already ended

During the migration before the match results API exists, the DO may accept a late ended-match socket only long enough to send the stored `matchEnd` payload and stop gameplay. The account shell should eventually use `GET /api/matches/:matchId` for ended-match results instead of reopening a play socket.

On match end:

1. record final match status in DO storage
2. persist `matches.ended_at`, `winner_user_id`, and `end_reason`
3. update participant results
4. apply Elo for rated matches in one idempotent transaction
5. broadcast final status including rating deltas when available

The final `matchEnd` payload carries:

```ts
type MatchEndSource = "agreed" | "trusted" | "conflict";

type MatchEndMessage = Readonly<{
  type: "matchEnd";
  tick: number;
  winner: PlayerId | 0;
  reason: MatchEndReason;
  finalHash: string | null;
  source: MatchEndSource;
  reports?: readonly MatchEndReportSummary[];
  ratingDeltas?: readonly MatchRatingDelta[];
}>;
```

Use `source = "agreed"` when both clients report the same deterministic result. Use `source = "trusted"` when the remaining connected player reports a result after the opponent disconnects or after the reconnect grace policy chooses a forfeit. Use `source = "conflict"` with `reason = "desync"` when client reports disagree; that terminal state should stop the live match and keep the report summaries for debugging and moderation.

## Client Screens

Add a light app shell before mounting the game canvas:

- splash / how-to-play
- signed-out home
- signed-in home
- lobby
- matchmaking queue
- active match
- match results

The splash graphic should live under `apps/web/public/` or a client asset folder once supplied. The shell can hide it after first view using local storage, but the home screen should keep a way to open it again.

Do not let the app shell leak gameplay authority:

- UI chooses mode, queue, lobby readiness, and local settings.
- Match creation resolves a serializable `MatchConfig`.
- During play, the sim still advances only from command batches.

## API Sketch

```text
GET  /api/me
POST /api/lobbies
GET  /api/lobbies/:accessCode
POST /api/lobbies/:accessCode/join
POST /api/lobbies/:lobbyId/ready
POST /api/lobbies/:lobbyId/leave
GET  /api/lobbies/:lobbyId/ws

POST /api/matchmaking/tickets
GET  /api/matchmaking/tickets/:ticketId
POST /api/matchmaking/tickets/:ticketId/cancel
GET  /api/matchmaking/:ticketId/ws

GET  /api/matches/:matchId
GET  /api/matches/:matchId/ws
```

Use WebSockets for lobby and matchmaking status because the app already depends on them. Plain polling is acceptable as a fallback if the first UI pass is simpler.

## Implementation Milestones

1. **App shell and solo path**: add splash, signed-out home, and local solo launch without URL seat params.
2. **Better Auth on Worker**: add `/api/auth/*`, D1 binding, Google-only config, secrets, session helper, and `/api/me`.
3. **Schema**: add D1 migrations for profiles, ratings, lobbies, matchmaking tickets, matches, participants, and rating events.
4. **Profile bootstrap**: create `profiles` and `player_ratings` defaults after first Google sign-in.
5. **Seat hardening**: remove public `player` query dependency, resolve multiplayer seats from `match_participants`, forward `x-drop-ship-player-id` internally, and have the DO overwrite client `playerId`.
6. **Private lobby**: implement create / join / ready / start flow with `LobbyDurableObject`.
7. **Matchmaking**: implement queue tickets, widening rating windows, match creation, cancellation, and reconnect.
8. **Results and Elo**: persist match end, apply idempotent rating updates, and show rating deltas.
9. **Docs and smoke tests**: update deploy instructions, add auth/lobby API tests, and keep existing deterministic smoke tests green.

## Non-Goals

- no server-authoritative simulation
- no anti-cheat command validation beyond seat ownership and basic message limits
- no email/password auth
- no guest multiplayer
- no ranked private matches by default
- no global leaderboard
- no paid account, inventory, or cosmetics system
- no social graph or chat

## References

- [Better Auth basic usage](https://better-auth.com/docs/basic-usage): social providers such as Google and client session APIs.
- [Better Auth installation](https://better-auth.com/docs/installation): `/api/auth/*` handler shape and Cloudflare Workers AsyncLocalStorage flags.
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) and [other relational databases](https://better-auth.com/docs/adapters/other-relational-databases): D1-compatible relational adapter options.
- [Cloudflare D1](https://developers.cloudflare.com/d1/) and [D1 Worker Binding API](https://developers.cloudflare.com/d1/worker-api/): Worker-backed SQL storage.
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) and [Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/): stateful coordination and SQLite-backed object storage.
