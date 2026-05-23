# Determinism

## Goal

Lockstep multiplayer works only if every client produces the same state from the same inputs. Phase 1 uses strict deterministic simulation with continuous hash checking and trusted resync.

Friendly play lets us avoid server authority for now. It does not let us be casual inside the sim.

## Simulation contract

All code that affects future simulation state must obey these rules:

- Fixed timestep.
- Integer tick counter.
- Seeded PRNG only.
- Deterministic entity handles.
- Deterministic system order.
- Deterministic iteration order.
- Stable snapshot and hash serialization.
- No browser, renderer, audio, UI, or wall-clock dependency.

Presentation code is free to be non-deterministic because it never feeds back into sim state.

## Fixed timestep

- Phase 1 sim rate: 30 Hz.
- `dt = 1 / 30`, always.
- Events and commands are timestamped by tick number, not wall-clock time.
- Multiplayer clients advance only from ordered DO tick batches.
- Single-player and replay may use a local scheduler, but it must feed the same command-batch interface.

Forbidden in the sim path:

- `Date.now()`
- `performance.now()`
- frame delta
- network arrival time
- animation time

## Commands and execution ticks

The Durable Object assigns execution ticks. Clients submit intent; they do not get to choose the authoritative execution tick.

Phase 1 scheduling:

```ts
executeTick = serverTickAtReceive + commandLeadTicks;
```

Default `commandLeadTicks` is 4 at 30 Hz, about 133 ms.

The replay log records the assigned execution tick. Replaying a match means starting from seed + initial config, then applying the recorded command batch on each recorded tick.

## Entity identity

Never put raw bitECS runtime entity IDs on the wire, in replay files, or inside persisted snapshots.

Use stable handles:

```ts
type EntityHandle = {
  id: number;
  generation: number;
};
```

Rules:

- `id` is stable for the logical entity.
- `generation` changes when an ID slot is reused.
- Commands resolve handles only if both `id` and `generation` match.
- Stale commands fail deterministically and emit an order failure event if needed.
- Hashes and snapshots serialize stable handles, not runtime eids.

At Phase 1 scale, it is also acceptable to avoid stable ID reuse entirely for ships, fleets, stations, asteroids, and other long-lived objects. Short-lived projectiles can use generations.

## Seeded PRNG

`Math.random()` is forbidden in simulation code.

Use deterministic PRNG streams:

- Master seed comes from match start.
- Each system gets a named stream derived from `masterSeed + hash(systemId)`.
- The PRNG state for every stream is part of the snapshot and state hash.

Per-system streams prevent unrelated feature additions from shifting combat, loot, AI, or spawn rolls.

## Iteration order

Iteration order must be explicit and stable.

Safe patterns:

- Iterate query results sorted by stable handle ID when order affects results.
- Iterate fixed numeric arrays by index.
- Iterate side-store keys after numeric sort.
- Iterate fleet members by sorted stable handle.

Unsafe patterns in sim code:

- Iterating a `Set`.
- Iterating a `Map` whose insertion order comes from network, async, object key order, or content load order.
- Relying on bitECS query order where the result changes behavior and has not been verified.
- Nested bitECS queries without the library's safe nested-query option.

If order affects gameplay, sort. At 1,000 entities this is fine.

## System order

System order is registered once at world creation and is part of the determinism contract.

Recommended Phase 1 order:

1. `CommandIntakeSystem`
2. `FleetCommandSystem`
3. `ShipOrderSystem`
4. `SteeringSystem`
5. `PhysicsSystem`
6. `CollisionSystem`
7. `CombatSystem`
8. `MiningSystem`
9. `ResourceSystem`
10. `LifecycleSystem`
11. `EventFlushSystem`

Do not parallelize systems whose outputs can affect one another.

## Floating-point policy

JavaScript number math is good enough for Phase 1 if we keep it disciplined.

Rules:

- Sum forces in fixed contributor order.
- Sort contributors when they come from multiple entities.
- Keep units bounded where possible.
- Avoid long chains of tiny incremental corrections.
- Quantize values before hashing.

Avoid transcendental functions in hot deterministic paths when a vector approximation is easy. If `Math.sin`, `Math.cos`, `Math.sqrt`, or `Math.atan2` becomes a drift source across browsers, replace that path with lookup tables, deterministic approximations, or fixed-point math locally. Do not rewrite the whole sim preemptively.

## Hashing

Every 30 ticks, each client computes a stable state hash and sends it to the DO.

The hash serializer should share code with snapshot serialization where practical. It must walk state in deterministic order and include every value that can affect future simulation.

Include:

- tick
- content/protocol versions
- stable entity handles and generations
- relevant component values
- deterministic side stores
- order queues
- active and queued order provenance when future controller behavior depends on it
- active pilot input
- PRNG stream states
- lifecycle state

Exclude:

- `PrevPosition`
- render proxies
- camera
- UI selection
- audio
- visual effects
- asset load state
- wall-clock timestamps

Quantize float values before hashing. Example: position and velocity to millimeter or centimeter precision, depending on gameplay scale. Hashes must still match exactly after quantization.

## Snapshots

Snapshots are the resumable sim state. They serve reconnect, spectator catch-up, hard resync, and replay convenience.

Snapshot rules:

- Must serialize under 2 MB in Phase 1.
- Use stable handles, numeric content IDs, and compact arrays.
- Include PRNG states, order queues, and order provenance.
- Exclude raw content files and render-only state.
- On load, rebuild runtime eid mappings and set `PrevPosition = Position`.

The snapshot serializer is also a determinism tool. A replay should be able to:

1. Run from tick 0 to snapshot tick.
2. Serialize snapshot.
3. Deserialize into a fresh world.
4. Continue from the same command stream.
5. Produce the same future hashes.

## Resync ladder

When the DO sees mismatched hashes for the same tick:

1. Broadcast `desync` with the observed hashes.
2. Request compact state dumps or snapshots from both clients.
3. Compare enough state for diagnostics.
4. Trust the elected snapshot author for Phase 1.
5. Send `resyncSoft` for small entity-level correction.
6. Send `resyncHard` with a full snapshot for larger divergence.

This is friendly recovery, not anti-cheat.

## Debugging tools

Build these early:

- Replay runner: command log to final hash.
- Hash dump: per-tick hash stream.
- Hash diff: first divergent tick between two runs.
- Snapshot round-trip: serialize, deserialize, continue, compare hashes.
- Snapshot size: worst-case 1,000-entity serialized byte count.
- Desync capture: save both clients' state at mismatch tick for offline diff.

## Review checklist

Use this for sim-path code review:

- [ ] No wall-clock reads.
- [ ] No `Math.random()`.
- [ ] Commands use DO-assigned execution ticks.
- [ ] Wire/log/snapshot references use stable handles, not runtime eids.
- [ ] Iteration order is explicit where behavior depends on it.
- [ ] Systems run in fixed order.
- [ ] Force and damage contributors are sorted or otherwise fixed.
- [ ] PRNG state is snapshotted and hashed.
- [ ] New persistent state participates in snapshot and hash.
- [ ] Controller decisions that depend on previous orders use snapshotted
      provenance, not local UI memory.
- [ ] New replay fixture covers the behavior.

## Stance

Phase 1 should be deterministic enough that a 15 minute, 1,000-entity, 2-player match replays exactly from its command log on supported browsers. When drift appears, fix the drift or resync cleanly; do not make the test suite accept fuzzy hashes.
