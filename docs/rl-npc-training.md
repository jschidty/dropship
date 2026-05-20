# RL NPC Training And Headless Balance Runs

## Goal

Use a small, cheap reinforcement learning policy to produce a capable NPC opponent for single-player mode and to run headless games for game-balance tuning.

The policy should act at the tactical command layer, not at the renderer, physics, or low-level steering layer. Drop Ship already has the right boundary for this: player input becomes protocol commands, commands become sim orders, and `runTick(world, batch)` advances the deterministic sim from command batches.

Relevant architecture references:

- [Command hierarchy](command-hierarchy.md) defines the `Input -> Command -> tick batch -> OrderQueue -> desired movement/actions -> steering -> physics/combat` path.
- [Determinism](determinism.md) defines fixed ticks, command execution ticks, snapshots, hashes, and replay constraints.
- [Gameplay demo](gameplay-demo.md) defines the capture-demo NPC and says local single-player may skip Durable Object transport, but must still feed the same `CommandBatch` interface.
- [Cloudflare architecture](cloudflare-architecture.md#headless-games) treats headless matches as a first-class runtime for tuning, CI, replay generation, and future server-authority experiments.
- [Project structure](project-structure.md) reserves `packages/tools` for replay, hash diff, snapshot-size, and other headless utilities.

## Current Headless Runner Status

There is already a headless sim path, but it currently lives mostly in the smoke test harness rather than a reusable tool package.

Existing pieces:

- [`tests/run-smoke.mjs`](../tests/run-smoke.mjs) bundles and executes [`tests/smoke.test.ts`](../tests/smoke.test.ts) in Node.
- [`tests/smoke.test.ts`](../tests/smoke.test.ts) creates worlds with `createWorld`, advances them with `runTick`, builds fixed `CommandBatch` streams, computes hashes with `hashWorld`, and tests snapshot round trips.
- [`packages/sim/src/tick.ts`](../packages/sim/src/tick.ts) exposes the core `runTick(world, batch)` contract.
- [`packages/sim/src/snapshot.ts`](../packages/sim/src/snapshot.ts) and [`packages/sim/src/hash.ts`](../packages/sim/src/hash.ts) serialize and hash the same sim state a headless run should report.
- [`packages/protocol/src/replay.ts`](../packages/protocol/src/replay.ts) defines the replay file shape: resolved match config, command batches, and expected hashes.

Planned but not implemented as reusable tools yet:

- [`packages/tools/src/replay-player`](../packages/tools/src/replay-player/.gitkeep)
- [`packages/tools/src/hash-diff`](../packages/tools/src/hash-diff/.gitkeep)
- [`packages/tools/src/snapshot-size`](../packages/tools/src/snapshot-size/.gitkeep)

For RL work, start by extracting the smoke-test style headless loop into a proper `packages/tools/src/rl-runner` or `packages/tools/src/headless-match` module instead of growing more test-only helpers.

## Recommended Model Shape

Train a tactical command policy:

```text
SimWorld observation
  -> small policy
  -> masked tactical action
  -> ScheduledCommand[]
  -> CommandBatch
  -> runTick(world, batch)
  -> reward and metrics
```

Do not train from pixels. The renderer is intentionally outside the deterministic sim path, and the policy only needs compact game-state features.

Use a small MLP or recurrent MLP policy. A transformer, vision model, or continuous-control policy is unnecessary for the current game scale.

Recommended decision cadence:

- Decide every `rules.npc.thinkIntervalTicks`, usually 15-30 ticks.
- Hold orders between decisions.
- Let `ShipOrderSystem`, `SteeringSystem`, `PhysicsSystem`, `CombatSystem`, and capture/spawn systems do the detailed execution.

## Observation Features

Build observations from `SimWorld` and keep them stable, numeric, and compact.

Useful features:

- Match phase: current tick, remaining ticks, match result state.
- Planet state: position relative to controlled units, radius, owner, capturable flag, capture progress, contested flag.
- Friendly units: class, health ratio, position, velocity, current order type, orbit state, cooldown state.
- Enemy units: same fields, possibly capped to nearest N enemies by stable distance and handle ordering.
- Drop-ship context: distance to capturable planets, whether a drop ship is capture-eligible, nearby escort count.
- Local tactical context: nearest enemy to each friendly unit, nearest friendly drop ship, nearest owned/neutral/hostile planet.

Use stable sorting and fixed caps. If more units exist than the policy consumes, sort by tactical relevance with deterministic tie-breakers using stable handles.

Do not include:

- Render data, camera, UI selection, visual effects, wall-clock time, DOM state, WebSocket state, or browser APIs.
- Raw runtime entity IDs. Use stable handles only when identity is needed. See [ECS identity rules](ecs.md#entity-identity).

## Action Space

Keep the action space high-level and masked.

Useful actions for the capture demo:

- Drop ship: `capturePlanet`, `orbitPlanet`, `moveTo` a safe rally point.
- Fighter: `escort` a friendly drop ship, `attackTarget`, `guardPlanet`.
- Battleship: `attackTarget`, `guardPlanet`, `moveTo` an orbit or firing slot.
- Group actions: all fighters escort drop ship, all combat ships focus nearest hostile drop ship, split escort/attack by class.

Map every selected action to existing protocol commands from [`packages/protocol/src/commands.ts`](../packages/protocol/src/commands.ts), especially `issueUnitOrder`.

Avoid adding model-only sim actions. If the player cannot express an action through the command/order path, the RL policy should not use it until the protocol supports it.

## Reward Design

Use dense shaping only to guide the policy toward the real objective. Keep terminal win/loss as the dominant signal.

Recommended reward components:

- Win: large positive terminal reward.
- Loss: large negative terminal reward.
- Planet captured: positive reward.
- Planet lost: negative reward.
- Capture progress gained: small positive reward.
- Own drop ship destroyed: large negative reward.
- Enemy drop ship destroyed: large positive reward.
- Damage dealt minus damage taken: small reward.
- Friendly drop ship in valid capture orbit: small reward.
- Command churn: small penalty when the policy repeatedly rewrites equivalent orders.
- Stalemate or timer tie: small negative reward if it indicates non-play.

For balance runs, also log these as metrics instead of only using them as rewards.

## Baselines

Keep the existing scripted NPC as the first baseline. The current implementation is [`packages/sim/src/systems/npcCommand.ts`](../packages/sim/src/systems/npcCommand.ts): every NPC think interval, it scans units in stable order, attacks the nearest enemy in aggro range, otherwise guards a capturable planet.

Before PPO or self-play, build:

1. `scripted-v1`: the current deterministic NPC behavior as a command-producing policy.
2. `bc-v1`: behavior cloning from scripted-v1 demonstrations.
3. `rl-small-v1`: PPO or masked PPO fine-tuned from bc-v1.
4. `rl-small-v1-frozen`: an exported, versioned policy used by single-player and balance sweeps.

This keeps the first learned policy cheap and gives every training run a known regression target.

## Important Refactor

The current `NpcCommandSystem` mutates `unit.moveOrder` directly inside the sim. That is acceptable for the simple baseline, but learned policies should run as controllers that produce normal `ScheduledCommand` entries.

Preferred target:

```text
controller profile
  -> policy decides
  -> ScheduledCommand[]
  -> CommandBatch
  -> CommandIntakeSystem
  -> unit orders
```

Relevant code:

- [`packages/protocol/src/matchConfig.ts`](../packages/protocol/src/matchConfig.ts) already has `PlayerControllerConfig` and controller types: `human`, `npc`, `tool`, and `script`.
- [`packages/server/src/commandBuffer.ts`](../packages/server/src/commandBuffer.ts) shows the authoritative command sorting behavior.
- [`packages/client/src/runtime/localGame.ts`](../packages/client/src/runtime/localGame.ts) already queues local commands and feeds them to `runTick`.
- [`packages/sim/src/systems/commandIntake.ts`](../packages/sim/src/systems/commandIntake.ts) applies scheduled commands to sim orders.

The learned policy should not bypass this path. That keeps single-player, replay, multiplayer, and headless balance runs aligned.

## Headless Runner Procedure

Create a reusable runner under `packages/tools/src/headless-match` or `packages/tools/src/rl-runner`.

Suggested modules:

- `environment.ts`: wraps `createWorld`, `runTick`, reset, step, observation, reward, done, and metrics.
- `policy.ts`: interface for scripted, random, loaded-model, and remote-training policies.
- `actions.ts`: action masks and action-to-command conversion.
- `observations.ts`: fixed observation vector builder.
- `metrics.ts`: match-level and tick-level balance metrics.
- `league.ts`: runs policy-vs-policy batches over seeds and config variants.
- `replay.ts`: writes `ReplayFile` records using the protocol replay type.

Minimal step flow:

```ts
const world = createWorld({ config, content });

while (!world.matchResult && world.tick < maxTicks) {
  const commands = policyController.commandsForTick(world);
  runTick(world, {
    tick: world.tick,
    commands,
  });
  metrics.record(world);
}
```

The runner should also support empty batches with `createEmptyCommandBatch(world.tick)`, mirroring the smoke tests.

## Training Procedure

1. Build the headless environment wrapper.
2. Reimplement the current scripted NPC as an external command-producing `scripted-v1` policy.
3. Validate `scripted-v1` against the current `NpcCommandSystem` on a fixed seed set.
4. Generate demonstration trajectories from `scripted-v1`.
5. Behavior-clone a compact policy from demonstrations.
6. Fine-tune with PPO or masked PPO against scripted opponents and prior frozen policies.
7. Evaluate every checkpoint in deterministic leagues across fixed seed suites.
8. Export the chosen policy with a policy ID, model architecture version, input schema version, action schema version, and weights hash.
9. Add a replay fixture and hash baseline for the frozen policy on a small fixed scenario.

Training can happen outside the game repo if that is more convenient, but the exported model must target the observation and action schemas in this repo.

## Single-Player Integration

Single-player should use the same local command queue pattern as [`createMinimalLocalGame`](../packages/client/src/runtime/localGame.ts).

Recommended flow:

1. Match config marks Player 1 as `human`.
2. Match config marks Player 2 as `npc` with `profile: "rl-small-v1"`.
3. Local runtime creates the same `SimWorld`.
4. Before each local `runTick`, the policy controller appends Player 2 commands to the pending command batch when its think interval fires.
5. Human Player 1 commands and NPC Player 2 commands enter the same batch path.

If model inference is not deterministic across runtimes, keep the learned policy out of multiplayer lockstep. For single-player this is acceptable if replays record the actual command batches generated by the policy.

If the learned policy must be part of deterministic replay from only seed + config, then the policy weights, inference implementation, input schema, action schema, and any policy PRNG state must be versioned and included in snapshot/hash compatibility.

## Balance Sweep Procedure

Use the headless runner to evaluate game mechanics, not just policy strength.

Sweep config through existing serialized knobs:

- Rules: capture timing, orbit radius multipliers, spawn interval, spawn cap, NPC think interval, aggro range.
- Sim tuning: movement, gravity, boids, escort, orbit, and avoidance values.
- Content overrides: ship component health, thrust, weapon damage, cooldown, range.

These are already part of `MatchConfig` and serialized snapshots through [`packages/sim/src/snapshot.ts`](../packages/sim/src/snapshot.ts), so they are suitable for replayable experiments.

For each candidate config, run:

- scripted-v1 vs scripted-v1
- rl-small-v1 vs scripted-v1
- scripted-v1 vs rl-small-v1
- rl-small-v1 vs rl-small-v1
- current frozen policy vs previous frozen policy

Track:

- Win rate by side.
- Average match duration.
- Timer tie and stalemate rate.
- First planet capture tick.
- Planet ownership over time.
- Drop ship survival time.
- Kills and damage by ship class.
- Command volume per policy.
- Final hash and replay file path for representative matches.

Treat dominant exploits as balance signals. If a small policy reliably wins with one degenerate pattern across many seeds, tune mechanics or command affordances before making the NPC smarter.

## Verification Requirements

Every policy or balance-run change should have deterministic verification:

- Fixed-seed headless smoke run.
- Replay file with expected hash stream for at least one short match.
- Snapshot round trip mid-match, then continued identical hash.
- League summary over a small fixed seed set.
- Policy schema/version check before loading model weights.

Use the existing smoke tests as the immediate reference for how to run fixed batches, assert deterministic hashes, and snapshot round-trip state.

## Non-Goals

- Pixel-based RL.
- Per-frame or per-tick low-level thrust control.
- Model actions that bypass protocol commands.
- Renderer, UI, audio, browser, or network dependencies in training.
- Large model inference in the sim hot path.
- Balance conclusions from one seed or one matchup.
