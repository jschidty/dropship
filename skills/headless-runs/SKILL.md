---
name: headless-runs
description: Guidance for this drop-ship repository's headless match workflow and gameplay tuning. Use when Codex is asked to run headless games, compare balance changes, tune ship loadouts, adjust gameplay constants, track combat metrics, or report simulation outcomes from `packages/tools/src/headless-match`.
---

# Headless Runs

Use this skill for balance work in the `drop-ship` repo.

## Workflow

1. Inspect the relevant sim/content path before tuning:
   - Ship loadouts and derived stats: `packages/content/src/registry.ts`
   - Combat events and damage application: `packages/sim/src/systems/combat.ts`
   - Headless runner and metrics: `packages/tools/src/headless-match/`
   - Match setup: `packages/protocol/src/matchConfig.ts`

2. Prefer headless batches over single-match impressions. Run fixed seeds before and after a tuning change, and report totals plus per-seed outliers.

3. Track effective damage, not theoretical damage. Use `result.metrics.damageDone`, especially `damageDone.battleship.total`, `damageDone.byOwner`, and `damageDone.bySourceShipClass`.

4. Keep tuning scoped. For loadout problems, adjust hull stats, slots, default components, or component stats before changing steering/combat systems.

5. Validate with `npm test` after sim, content, protocol, or metrics changes. If content changes shift deterministic hashes, update the fixture only after confirming the new hash is stable across two runs.

## Running Headless Games

Bundle a temporary TypeScript harness with the local esbuild binary, then run it with Node:

```bash
./node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/bin/esbuild /private/tmp/balance.ts --bundle --platform=node --format=esm --outfile=/private/tmp/balance.mjs
node /private/tmp/balance.mjs
```

In the harness, import from local source paths or workspace aliases, create configs with `createCaptureDemoConfig`, run `createHeadlessMatchRunner({ config, content }).run()`, and print compact JSON.

## Reporting

Include:

- Seeds and game mode.
- The tuning change and resulting derived stats.
- Total damage, target unit/class damage, average per game, and share of total damage.
- Win reasons and notable outlier seeds.
- Verification command results.
