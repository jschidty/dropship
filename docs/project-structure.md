# Project Repository

## Phase 1 constraints

The repository is organized for a small lockstep RTS first, not a general MMO platform.

- 2 players per match
- Up to 1,000 live sim entities
- 10-15 minute matches
- Friendly play; no Phase 1 cheat resistance
- Client-side deterministic sim, Cloudflare Durable Object coordination
- Compact snapshots must serialize under 2 MB

These constraints keep the codebase tight while still preserving the path to later server authority.

## Structure

Monorepo using pnpm workspaces. Turborepo can wait until build caching is worth the extra moving part.

```text
drop-ship/
|-- package.json
|-- pnpm-workspace.yaml
|-- tsconfig.base.json
|-- .eslintrc.cjs
|-- .github/
|   `-- workflows/
|       |-- ci.yml
|       `-- deploy.yml
|-- packages/
|   |-- protocol/       shared command, message, handle, snapshot types
|   |-- content/        content schemas, validation, generated numeric IDs
|   |-- sim/            pure deterministic simulation; no DOM, no three.js
|   |-- client/         renderer, input, UI, network client
|   |-- server/         Cloudflare Worker + Durable Object coordinator
|   `-- tools/          replay, hash diff, snapshot size, content lint
|-- apps/
|   `-- web/            Vite game entrypoint
|-- content/            raw data files
|   |-- ships/
|   |-- weapons/
|   |-- resources/
|   `-- matches/
|-- tests/
|   |-- replays/
|   |-- snapshots/
|   `-- e2e/
`-- docs/
    |-- art-direction.md
    |-- cloudflare-architecture.md
    |-- command-hierarchy.md
    |-- deploy-demo.md
    |-- determinism.md
    |-- ecs.md
    |-- gameplay-demo.md
    |-- piloting.md
    |-- project-structure.md
    `-- rendering.md
```

## Package boundaries

Boundary rules matter more than directory names. CI must enforce them.

### `packages/protocol`

Shared wire and persistence types. It owns the language spoken by clients, tools, and the server.

```text
protocol/src/
|-- handles.ts          stable entity handles and player IDs
|-- commands.ts         command intent types
|-- orders.ts           serializable sim order types
|-- messages.ts         WebSocket envelopes
|-- snapshot.ts         compact snapshot format
|-- replay.ts           replay file format
|-- matchConfig.ts      seed, player list, content/protocol versions
`-- index.ts
```

Keep runtime dependencies near zero. `zod` is acceptable if shared validation is useful, but do not pull in client, server, renderer, or sim code.

### `packages/content`

Loads and validates raw files from `/content/`. It also generates stable numeric IDs for templates, weapons, resources, order types, and enum-like content.

```text
content/src/
|-- schemas/
|-- registry.ts
|-- numericIds.ts
|-- validate.ts
`-- index.ts
```

The sim should consume validated, numeric, compact content records rather than string-heavy raw data. That keeps snapshots and hashes small.

### `packages/sim`

Pure TypeScript simulation. No browser APIs, no three.js, no Worker-specific APIs.

```text
sim/src/
|-- components/         fixed-size numeric bitECS components
|-- stores/             deterministic side stores for orders, cargo, fleets
|-- systems/            registered fixed-order systems, one feature/system per file
|-- orders/             order interpreters that produce transient sim intent
|-- events/             deterministic sim events
|-- ids.ts              stable handle to runtime eid mapping
|-- world.ts            world creation and system registration
|-- tick.ts             fixed timestep loop
|-- movement.ts         shared deterministic movement/vector helpers
|-- steering.ts         gravity, formation, avoidance, and physics integration helpers
|-- hash.ts             stable state hashing
|-- snapshot.ts         serialize/deserialize compact snapshots
|-- prng.ts             seeded per-system PRNG streams
`-- index.ts
```

Forbidden imports: `three`, `window`, `document`, `navigator`, `localStorage`, `react`, `server`, and `client`.

### `packages/client`

Browser-only code: three.js, Preact/React or DOM UI, input, audio, network client, and render-only prediction experiments.

```text
client/src/
|-- render/             three.js orchestration, render quality, batching, effects
|-- camera/
|-- input/
|-- effects/
|-- audio/
|-- ui/
|-- selection/
|-- net/
|-- runtime/
|-- assets/
`-- index.ts
```

The client may import `sim`, `protocol`, and `content`. It must write to sim state only through command intake or explicit resync APIs.

Renderer modules should stay split by responsibility. The mount loop may orchestrate scene setup, input wiring, and frame scheduling, while reusable render mechanisms such as unit instancing, projectile particles, shader materials, quality presets, and render math live in separate files under `client/src/render/`.

### `packages/server`

Cloudflare Worker and Durable Object coordinator. In Phase 1 it does not import `sim`.

```text
server/src/
|-- worker.ts           HTTP routing and match lookup
|-- matchDO.ts          Durable Object class
|-- tickLoop.ts         server tick scheduler
|-- commandBuffer.ts    receive, schedule, broadcast, persist commands
|-- hashArbiter.ts      collect and compare hashes
|-- snapshotStore.ts    snapshot budget checks and persistence
|-- matchEnd.ts         friendly match-end agreement
|-- retention.ts        archive and storage cleanup
`-- index.ts
```

Dependencies: `protocol` and Cloudflare runtime types. Phase 2 may import `sim` for server authority, but that is a deliberate architecture change.

### `packages/tools`

Dev-only utilities.

```text
tools/src/
|-- headless-match/     reusable headless match runner, metrics, replay output
|-- replay-player/      headless replay to hash stream
|-- hash-diff/          first divergent tick between two hash streams
|-- snapshot-size/      worst-case snapshot size budget test
|-- content-lint/       validate content/*
`-- snapshot-inspect/   inspect compact snapshots
```

Tools may import `sim`, `protocol`, and `content`. They are not deployed.

### `apps/web`

The game entrypoint: Vite, static assets, app bootstrap, environment configuration.

```text
apps/web/
|-- index.html
|-- src/
|   |-- main.ts
|   `-- env.ts
|-- public/
|-- vite.config.ts
`-- package.json
```

Prefer importing `client` only from the app entry. Let `client` own its internal imports of `sim`, `protocol`, and `content`.

## Dependency rules

| Package | May import |
|---|---|
| `protocol` | optional tiny validation helpers only |
| `content` | `protocol`, validation library |
| `sim` | `protocol`, `content`, bitECS, deterministic hash/PRNG libraries |
| `client` | `sim`, `protocol`, `content`, three.js, UI libs |
| `server` | `protocol`, Cloudflare runtime APIs |
| `tools` | `sim`, `protocol`, `content` |
| `apps/web` | `client` |

Forbidden:

- `sim` to `client`, `server`, three.js, DOM APIs, Worker APIs
- `server` to `client`
- `client` to `server`
- `protocol` to gameplay, renderer, or platform code

Use `eslint-plugin-boundaries` or `dependency-cruiser` to fail CI on violations.

## Testing strategy

### Unit tests

Use Vitest. Co-locate tests with the code they cover. Test systems by constructing small worlds, running fixed ticks, and asserting component/store values.

### Replay determinism

Replay files contain:

- match seed
- content/protocol version
- initial match config
- command stream by execution tick
- expected hash stream
- expected final hash

The Node replay harness runs the sim from tick 0 and asserts exact hash matches. If this fails, the sim is non-deterministic or the replay fixture is stale.

### Browser replay checks

Run the same replay in supported browsers through Playwright and compare the quantized hash stream exactly. Do not "tolerate minor hash drift" in pass/fail tests. If a browser diverges, either fix the sim math or narrow supported browsers until fixed.

### Snapshot size

`tools/snapshot-size` builds a pessimistic 1,000-entity Phase 1 world, serializes it with the production snapshot serializer, and reports bytes.

- Warn above 1.5 MB.
- Fail at or above 2 MB.
- If the warning trips, move to chunked snapshots or R2 before expanding state.

### Server tests

Use Cloudflare's Workers Vitest integration for most Worker/DO tests. It runs locally on Miniflare/workerd and gives direct access to bindings. Keep lower-level Miniflare API tests only where they make a case easier.

Test:

- command scheduling and acks
- tick command broadcast order
- non-empty command persistence
- snapshot size rejection
- reconnect catch-up
- hash mismatch flow
- match-end agreement
- retention cleanup with `deleteAll()`

## CI pipeline

`ci.yml` should run:

1. `pnpm install --frozen-lockfile`
2. `pnpm -r typecheck`
3. `pnpm -r lint`
4. `pnpm -r test`
5. `pnpm test:replays`
6. `pnpm test:snapshot-size`
7. `pnpm test:e2e`
8. `pnpm --filter web build`
9. `pnpm --filter server build`

Determinism, boundaries, and snapshot-size tests block merge.

## Deployment

- Web app: Cloudflare Pages or Workers Static Assets
- Server coordinator: Cloudflare Workers via Wrangler
- Replay archives and final snapshots: R2
- Content files: bundled initially; move to R2 only if size or patching demands it

Deploy client and server together when protocol versions change.

## Local dev

```bash
pnpm install
pnpm dev:server          # wrangler dev, Worker + DO on localhost:8787
pnpm dev:web             # Vite web app on localhost:5173
pnpm test
pnpm test:replays
pnpm test:snapshot-size
pnpm tools:replay <file>
pnpm tools:hash-diff <a> <b>
```

## Naming conventions

- Components: singular `PascalCase` (`Position.ts`)
- Systems: `PascalCase` ending in `System` (`PhysicsSystem.ts`)
- Orders: `PascalCase` verb or intent (`MoveTo.ts`, `AttackTarget.ts`)
- Content files: kebab-case (`heavy-fighter.toml`)
- Stable entity handles: never raw bitECS runtime IDs over the wire

## New feature checklist

- Add protocol command/order types if player-visible.
- Add content schema and numeric ID mapping if data-driven.
- Add component/store/system only where sim state needs it.
- Add deterministic replay coverage.
- Add snapshot serialization for any state needed after reconnect.
- Add hash coverage for any state that affects future simulation.
- Keep Phase 1 entity and snapshot budgets visible.

## Why this layout

The layout protects three things:

1. The sim can run in browser, Node tests, and later the DO without platform imports.
2. The protocol is a single source of truth for commands, handles, messages, snapshots, and replays.
3. Testing the sim does not require a browser or Cloudflare runtime.

That is enough structure for Phase 1. Anything more has to earn its keep.
