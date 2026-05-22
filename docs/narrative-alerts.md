# Narrative Alerts and Chatter

## Goal

Drop Ship should support real-time or near-real-time alerts, comms chatter, and narrative beats without compromising deterministic simulation, replay, reconnect, or multiplayer synchronization.

The right architecture is a sidecar narrative layer fed by deterministic gameplay facts. The simulation produces facts. The client and server route those facts. The UI presents alerts and chatter. An LLM may rewrite, summarize, or embellish low-risk narrative lines, but it must not decide gameplay outcomes or block tactical feedback.

```text
Sim events / sampled world state
-> Narrative facts
-> deterministic alert/template rules
-> optional async LLM rewrite/chatter
-> UI notification and comms feed
```

## Current Architecture Context

The repository is already structured around strict boundaries:

- `packages/sim` owns deterministic simulation state, systems, snapshots, hashes, and sim events.
- `packages/protocol` owns wire, command, snapshot, and replay types.
- `packages/client` owns rendering, UI, input, audio, networking, and presentation-only effects.
- `packages/server` owns the Cloudflare Worker and per-match Durable Object coordinator.

Phase 1 multiplayer is client-side deterministic lockstep. The Durable Object assigns command ticks, broadcasts command batches, stores command logs, coordinates reconnects, collects hashes, and finalizes match end agreement. It does not currently import or run `sim`.

This matters because LLM output is nondeterministic, slow relative to the sim tick, and externally dependent. It should never enter:

- `CommandBatch`
- sim components or side stores
- snapshots
- state hashes
- replay-critical state
- win/loss logic

Narrative output should be presentation state, similar to visual effects and audio.

## Core Principle

Alerts and narrative are not the same thing.

**Alerts are deterministic and immediate.** They should be generated locally from facts with templates, priority rules, dedupe, and cooldowns. The player should never wait on an LLM to learn that a drop ship was destroyed, a planet was captured, or an enemy is attacking a critical objective.

**Chatter is asynchronous and optional.** It can use an LLM to turn structured facts into personality, faction voice, battle commentary, or after-action summaries. If generation fails, arrives late, or is disabled, gameplay remains fully understandable.

## Event Source

The sim already emits deterministic `SimEvent` values such as:

- `weaponFired`
- `unitDestroyed`
- `unitSpawned`
- `planetCaptured`

Both local and network runtimes already collect these into pending event buffers and expose them through `runtime.drainEvents()`. The renderer currently consumes drained events for projectile particles. The same drained batch should be fanned out to a narrative engine before the events are discarded.

Target render loop shape:

```ts
const events = runtime.drainEvents();

addProjectileEvents(projectileParticles, events, now);
narrativeEngine.ingestSimEvents(events, runtime.world, now);
```

If more narrative resolution is needed, add more factual sim events. Good candidates:

- `captureStarted`
- `captureProgressChanged`
- `captureContested`
- `captureBroken`
- `dropShipEnteredOrbit`
- `dropShipLost`
- `fleetUnderAttack`
- `reinforcementsSpawned`
- `timerThresholdReached`

Keep these events compact, deterministic, and factual.

## Narrative Facts

Do not send raw world state to a narrative system. Convert sim events and small world samples into stable, structured facts.

```ts
export type NarrativeFact = Readonly<{
  id: string;
  matchId: string;
  tick: number;
  type: NarrativeFactType;
  priority: "info" | "warning" | "critical";
  subject?: NarrativeEntityRef;
  object?: NarrativeEntityRef;
  playerId?: PlayerId;
  values?: Readonly<Record<string, string | number | boolean>>;
}>;

export type NarrativeEntityRef = Readonly<{
  kind: "unit" | "planet" | "player";
  handleKey?: string;
  label: string;
  owner?: PlayerId | 0;
}>;
```

Fact IDs should be deterministic enough for dedupe. A practical format is:

```text
${matchId}:${tick}:${type}:${subjectKey}:${objectKey}
```

For aggregate facts such as sustained combat, use a window key:

```text
${matchId}:${windowStartTick}-${windowEndTick}:fleetUnderAttack:${playerId}
```

## Narrative Lines

The UI should consume narrative lines, not raw facts.

```ts
export type NarrativeLine = Readonly<{
  id: string;
  sourceFactIds: readonly string[];
  tick: number;
  createdAtMs: number;
  channel: "alert" | "comms" | "story";
  priority: "info" | "warning" | "critical";
  speaker?: string;
  text: string;
  expiresAtTick?: number;
}>;
```

Suggested channels:

- `alert`: tactical notifications that must be clear and immediate.
- `comms`: short in-universe chatter from command, pilots, fleet ops, or sensors.
- `story`: lower-frequency narrative summary or scenario framing.

## Client-Side Implementation

Add a client package area:

```text
packages/client/src/narrative/
|-- facts.ts          convert sim events and world samples to NarrativeFact
|-- templates.ts      deterministic fact-to-line templates
|-- engine.ts         dedupe, cooldowns, queues, LLM request orchestration
|-- llm.ts            provider boundary; browser or server-backed
`-- selectors.ts      UI snapshot helpers
```

The first implementation should be entirely local and template driven:

1. Drain sim events once per render frame.
2. Convert events into `NarrativeFact` values.
3. Apply dedupe and cooldown rules.
4. Create deterministic `NarrativeLine` values.
5. Add those lines to the overlay snapshot.

Extend `GameOverlaySnapshot` with:

```ts
narrative: Readonly<{
  lines: readonly NarrativeLine[];
}>;
```

Render this as a compact notifications/comms stack in `GameOverlay.tsx`.

High-priority alerts should publish the overlay immediately. Lower-priority chatter can ride the existing slower HUD snapshot cadence.

## Multiplayer Shape

There are two viable multiplayer modes.

### Local Narrative

Each client generates narrative locally from its own deterministic sim events.

Benefits:

- simplest to ship
- works offline and in local single-player
- no server or LLM dependency
- compatible with current runtime boundaries

Tradeoff:

- LLM-flavored chatter may differ between players unless generation is disabled or deterministic templates are used

Use this for the first implementation.

### Shared Narrative

For shared multiplayer narrative, one source should author narrative facts or lines and the Durable Object should broadcast them.

Because the Phase 1 Durable Object does not run `sim`, it cannot independently author sim-derived facts without a deliberate architecture change. Instead, use a trusted reporter:

- elected snapshot author, likely Player 1
- match creator
- spectator/headless observer
- future authoritative server runtime

Protocol additions should be separate from commands:

```ts
export type NarrativeFactsMessage = Readonly<{
  type: "narrativeFacts";
  playerId: PlayerId;
  facts: readonly NarrativeFact[];
}>;

export type NarrativeLineMessage = Readonly<{
  type: "narrativeLine";
  line: NarrativeLine;
}>;

export type NarrativeHistoryMessage = Readonly<{
  type: "narrativeHistory";
  lines: readonly NarrativeLine[];
}>;
```

The Durable Object should:

1. authenticate that the session may report narrative facts
2. dedupe by fact ID
3. persist a bounded narrative history
4. broadcast accepted lines or generated lines to players and spectators
5. include recent narrative history during reconnect or spectator catch-up

Narrative history is presentation history. It should not be part of compact sim snapshots or state hashes.

## LLM Use

LLM generation should be an enhancement layer after deterministic templates.

Use the LLM for:

- faction-flavored comms chatter
- short battle commentary
- match opening narration
- periodic summaries
- post-match recap
- varying repeated low-priority lines

Do not use the LLM for:

- critical tactical alerts
- target selection
- order generation
- match result decisions
- hidden state inference
- sim-affecting decisions

The LLM prompt should receive only structured facts and a small amount of recent narrative context.

Example prompt payload:

```json
{
  "tone": "tense fleet command chatter",
  "speaker": "fleet ops",
  "maxWords": 16,
  "recentLines": [
    "Aurora is contested.",
    "Enemy battleships are moving through the outer orbit."
  ],
  "facts": [
    {
      "tick": 3120,
      "type": "planetCaptured",
      "planet": "Aurora",
      "owner": "Player 1"
    }
  ]
}
```

The generated response should be validated before display:

- non-empty
- within length limit
- no unsupported claims
- references only known entities from the input facts
- falls back to deterministic template text on error

Cache generated lines by:

```text
matchId + tick/window + factIds + speaker/profile + promptVersion
```

This makes reconnects, repeated spectators, and retries stable enough for presentation.

## Cloudflare AI Runtime

Cloudflare is the natural first deployment target because the match server already lives in `packages/server` as a Worker plus per-match Durable Object.

Use these resources:

- **Workers AI** for direct model inference through an `env.AI` binding.
- **AI Gateway** for request analytics, logging, caching, rate limiting, retry, and model fallback.
- **Queues** for async LLM jobs so the match Durable Object never waits on model latency inside its 30 Hz tick loop.
- **Durable Object storage** for per-match narrative dedupe and bounded recent history.
- **Vectorize** only later, when authored scenario lore or long-term memory needs retrieval. It is not needed for tactical alerts or first-pass chatter.

Do not call Workers AI directly from `broadcastNextTick` or any code path that needs to keep match tick cadence. The Durable Object should emit immediate template lines, enqueue optional LLM jobs, and continue ticking.

Target Cloudflare shape:

```text
Client or trusted reporter
-> Match Durable Object receives NarrativeFact values
-> DO dedupes facts and broadcasts immediate template alerts
-> DO enqueues optional NarrativeLlmJob
-> Queue consumer Worker calls Workers AI through AI Gateway
-> Worker validates generated line
-> Worker sends NarrativeLine back to match DO
-> DO persists bounded history and broadcasts line
```

### Bindings

Add a Workers AI binding to the deployed server Worker when LLM generation is enabled:

```jsonc
{
  "ai": {
    "binding": "AI"
  }
}
```

The AI provider boundary should be explicit:

```ts
export type NarrativeLlmProvider = Readonly<{
  generateLine: (request: NarrativeLlmRequest) => Promise<NarrativeLlmResult>;
}>;

export type CloudflareNarrativeEnv = Readonly<{
  AI: Ai;
  AI_GATEWAY_ID?: string;
  NARRATIVE_LLM_MODEL_FAST?: string;
  NARRATIVE_LLM_MODEL_BALANCED?: string;
  NARRATIVE_LLM_MODEL_QUALITY?: string;
}>;
```

Workers AI can be called with an AI Gateway options object:

```ts
const response = await env.AI.run(
  model,
  {
    prompt,
    max_tokens: 48,
  },
  env.AI_GATEWAY_ID
    ? {
        gateway: {
          id: env.AI_GATEWAY_ID,
          skipCache: false,
          cacheTtl: 3600,
        },
      }
    : undefined
);
```

If using AI Gateway through the REST path instead of the binding, use the gateway's cache headers and a deterministic cache key based on:

```text
promptVersion + modelProfile + sourceFactIds + speaker + locale
```

With the binding path, keep the prompt body canonical and low-variance so exact-request caching has a chance to hit.

## Cost / Speed / Quality Policy

The product policy should be:

1. Templates first.
2. Fast model for live chatter.
3. Better model only for summaries or rare dramatic beats.
4. No LLM call for critical alerts.

Current Cloudflare pricing is model-dependent and changes over time. As of the docs checked on 2026-05-22, Workers AI includes a daily free neuron allocation and paid usage is metered in neurons. Treat the exact model table as operational config, not source-code truth.

### Model Tiers

Configure model tiers instead of hardcoding one model everywhere.

```ts
export type NarrativeModelTier = "off" | "fast" | "balanced" | "quality";

export type NarrativeModelPolicy = Readonly<{
  liveChatterTier: NarrativeModelTier;
  recapTier: NarrativeModelTier;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxLlmLinesPerMatch: number;
  minTicksBetweenLlmLines: number;
}>;
```

Recommended initial policy:

| Use case | Tier | Behavior |
|---|---|---|
| Critical alert | `off` | deterministic template only |
| Common live chatter | `fast` | short prompt, short output, async |
| Periodic battle summary | `balanced` | every 60-120 seconds at most |
| Post-match recap | `quality` | one request after match end |
| Scenario opening narration | `balanced` or cached `quality` | cache aggressively by scenario/profile |

Initial model candidates should be configured by environment variable so the team can update them without code changes. Start with cheap/fast Workers AI text-generation models for live chatter and test quality using recorded fact fixtures. Promote individual requests to a higher tier only when the line is rare enough to justify the cost.

### Cost Controls

Cost control should be enforced before a model call is made.

Per match:

- cap LLM-generated live chatter lines, for example 20-40 per match
- cap recap calls to one per match
- cap output to 32-64 tokens for live chatter
- skip generation when there are no spectators or local player has disabled narrative
- suppress repeated facts before enqueueing jobs
- batch multiple low-priority facts into one prompt

Per gateway/account:

- enable AI Gateway rate limiting
- use AI Gateway analytics/logging to watch request counts, tokens, errors, and estimated cost
- enable Gateway caching for deterministic prompts
- use model fallback only for noncritical narrative
- keep a kill switch that forces `NarrativeModelTier = "off"`

Per prompt:

- use structured facts, not raw snapshots
- include only the last 3-5 narrative lines
- keep max output small
- avoid asking for multiple alternatives
- set temperature low for shared multiplayer lines

### Speed Controls

Speed matters only for optional flavor; alerts already appear immediately from templates.

Latency targets:

- critical template alert: same render frame or next overlay publish
- live LLM chatter: best effort within 1-3 seconds
- battle summary: 3-10 seconds is acceptable
- post-match recap: can arrive after the match end dialog opens

Implementation rules:

- enqueue LLM jobs instead of awaiting them in the match DO tick loop
- drop stale live-chatter jobs if the source facts are older than a configured tick window
- preserve order by generated line tick, not response arrival time
- if the queue or model is slow, fall back silently to template lines
- never retry live chatter more than once

### Quality Controls

Quality should come from constrained inputs and validation, not from giving the model broad authority.

Before display, validate:

- line length
- no unsupported entity names
- no new gameplay claims absent from facts
- no tactical instruction that looks like a player command
- no hidden-state claims

If validation fails, use the deterministic template line or suppress the LLM line.

For shared multiplayer, generated prose should be treated as canonical only after the Durable Object accepts and broadcasts it. Clients should not independently remix shared narrative lines.

## Cloudflare Storage Choices

Use the smallest storage tool that fits each data type.

| Data | First choice | Reason |
|---|---|---|
| Recent per-match narrative lines | Durable Object storage | already scoped to one match |
| Fact dedupe keys | Durable Object memory plus storage for reconnect | small and match-local |
| Async generation jobs | Queues | decouples inference from match ticks |
| Scenario prompt profiles | static content or Worker env config | rarely changes |
| Long-lived authored lore | R2 or D1 later | content authoring, not hot path |
| Semantic lore retrieval | Vectorize later | only if prompt context needs retrieval |

Avoid D1 or Vectorize for Phase 1 tactical alerts. They add moving parts without improving the core loop.

## Narrative Profiles

Narrative tuning belongs in match config or content only if it affects which facts are emitted or which narrative profile is selected for a match. Generated prose itself does not belong in `MatchConfig`.

Potential config:

```ts
export type NarrativeProfileConfig = Readonly<{
  enabled: boolean;
  mode: "templates" | "llm-assisted";
  tone: "military" | "cinematic" | "minimal";
  frequency: "low" | "medium" | "high";
}>;
```

If this is added to `MatchConfig`, keep it as presentation configuration. It must not affect sim systems, snapshots, or hashes.

## Alert Rules

Start with small, high-signal rules.

Critical:

- own drop ship destroyed
- enemy captured final or near-final planet
- match result confirmed
- desync/resync notice

Warning:

- selected units under sustained fire
- planet capture contested
- enemy drop ship entering orbit around neutral or owned planet
- less than 60 seconds remaining

Info:

- planet captured
- reinforcements spawned
- command acknowledged if useful for debug/UI
- match started

Use cooldowns to prevent spam:

```ts
type NarrativeCooldown = Readonly<{
  key: string;
  untilTick: number;
}>;
```

Example cooldown keys:

```text
planet-contested:${planetHandleKey}
unit-under-attack:${unitHandleKey}
player-reinforcements:${playerId}
timer-threshold:${secondsRemaining}
```

## UI Guidance

The feed should be compact and readable during play.

Recommended layout:

- top-left or lower-left alert stack for tactical notifications
- newest 3-5 visible lines
- critical alerts stay longer
- low-priority chatter fades quickly
- no modal interruption except match end or serious connection/desync issues
- use team color and speaker labels sparingly

Do not let narrative cards obscure command controls, selected unit stats, or match status.

## Persistence and Reconnect

For local narrative:

- no persistence is required
- the feed resets on replay or new match

For shared multiplayer narrative:

- persist a bounded history in Durable Object storage
- keep only recent lines, for example 50-100
- send history on reconnect and spectator catch-up
- prune old lines on match end retention cleanup

Do not include narrative history in compact sim snapshots. Snapshot budget is for deterministic sim state.

## Testing

Template narrative can be unit tested without browser or network:

- sim event -> fact conversion
- fact -> deterministic template line
- dedupe behavior
- cooldown behavior
- priority ordering
- max feed length

Headless match tests can assert generated facts without asserting LLM prose.

LLM-backed tests should use a fake provider:

```ts
type NarrativeLlmProvider = Readonly<{
  generateLine: (request: NarrativeLlmRequest) => Promise<string>;
}>;
```

Browser/UI tests should verify:

- critical alerts appear after corresponding sim events
- alerts fade or prune
- feed does not overlap existing command and stats panels
- disabling LLM still leaves deterministic alerts working

## Phased Plan

### Phase 1: Local deterministic alerts

- Add `NarrativeFact` and `NarrativeLine` client-side types.
- Add event-to-fact conversion for existing sim events.
- Add template lines, dedupe, cooldowns, and max feed length.
- Add `narrative.lines` to the overlay snapshot.
- Render the notification stack.

### Phase 2: Better gameplay facts

- Add higher-level sim events for capture, contesting, drop ship orbit, and timer thresholds.
- Add aggregate fact detection from sampled world state where direct sim events would be too noisy.
- Add headless tests for fact generation.

### Phase 3: Optional LLM chatter

- Add an async provider boundary.
- Add Workers AI binding and AI Gateway configuration.
- Route low-priority comms/story jobs through a Queue consumer.
- Generate low-priority lines from structured facts.
- Add prompt versioning, cache keys, fallback templates, and validation.
- Add model tier config for `fast`, `balanced`, and `quality`.

### Phase 4: Shared multiplayer narrative

- Add protocol messages for narrative facts, lines, and history.
- Add Durable Object dedupe, bounded storage, and broadcast.
- Elect or configure a trusted narrative reporter.
- Include recent narrative history in reconnect/spectator catch-up.
- Use AI Gateway analytics/rate limits to enforce live cost ceilings.

### Phase 5: Scenario narrative

- Add scenario-authored narrative triggers and speaker profiles.
- Support opening narration, mid-match beats, and post-match recaps.
- Keep all scenario triggers factual and presentation-only unless deliberately modeled as gameplay rules.
- Add Vectorize-backed lore retrieval only if authored scenarios need semantic context.

## Cloudflare References

Cloudflare AI pricing, limits, and model availability are operational inputs. Re-check the official docs before implementation or launch.

- Workers AI overview and model catalog: https://developers.cloudflare.com/workers-ai/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI bindings: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- AI Gateway overview: https://developers.cloudflare.com/ai-gateway/
- AI Gateway Workers AI provider: https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/
- AI Gateway caching: https://developers.cloudflare.com/ai-gateway/configuration/caching/
- AI Gateway rate limiting: https://developers.cloudflare.com/ai-gateway/features/rate-limiting/
- AI Gateway limits: https://developers.cloudflare.com/ai-gateway/reference/limits/
- Queues: https://developers.cloudflare.com/queues/
- Vectorize: https://developers.cloudflare.com/vectorize/

## Non-Negotiable Rule

LLM narrative may describe the match, but it must never drive the match.
