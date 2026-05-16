# Cloudflare Architecture

## Phase 1 shape

Phase 1 is a small, friendly lockstep game:

- 2 players per match
- Up to 1,000 live simulation entities
- 10-15 minute match length
- Friendly play; cheat resistance is explicitly out of scope
- Client-side deterministic simulation, coordinated by one Durable Object per match

The goal is to keep the platform design boring: small WebSocket messages, compact command logs, compact trusted snapshots, and no server-side simulation until the game proves it needs it.

## Where positions are calculated

Positions, combat, mining, projectiles, AI, and win conditions are calculated on each client by the shared sim package.

The Durable Object (DO) is a coordinator:

1. Maintains the server tick counter.
2. Receives commands and assigns execution ticks.
3. Broadcasts one ordered command batch per tick.
4. Stores the command log for replay and reconnect.
5. Collects state hashes and detects desync.
6. Stores compact snapshots from the trusted snapshot author.
7. Coordinates reconnect, spectator catch-up, match end agreement, and retention cleanup.

The DO does not run physics or validate winners in Phase 1. If both clients report the same match end tick, winner, and final hash, the DO records and broadcasts `matchEnd`. If one player disconnects, the remaining player can finish locally and the DO records the host/client result as trusted.

## Per-match Durable Object

One DO represents one match. The Worker routes HTTP and WebSocket requests to the DO by match ID.

The DO is single-threaded, which is useful for match coordination. It is also a single throughput point, so Phase 1 keeps the scope intentionally small. At 2 players and command-only traffic, this is comfortably inside Durable Object limits.

During active play, the DO runs a 30 Hz tick loop and will not hibernate. That is acceptable for 10-15 minute matches. Hibernation can matter for idle lobbies later, but it is not a Phase 1 complexity target.

## WebSocket protocol

JSON is fine for the first playable build. Keep message shapes compact and numeric where practical. A binary codec can wait until profiling says otherwise.

### Client to DO

| Message | Purpose |
|---|---|
| `{ type: "ready" }` | Lobby ready signal |
| `{ type: "command", clientSeq, localTick, command }` | Player command intent |
| `{ type: "hash", tick, hash }` | Periodic state hash |
| `{ type: "snapshot", tick, snapshot }` | Trusted full snapshot from the elected author |
| `{ type: "matchEndReport", tick, winner, finalHash }` | Client-reported deterministic match end |
| `{ type: "reconnect", playerId, lastTick }` | Resume from disconnect |

### DO to client

| Message | Purpose |
|---|---|
| `{ type: "matchStart", seed, players, initialState }` | Begin match at tick 0 |
| `{ type: "tickCommands", tick, commands }` | The complete command batch for tick N |
| `{ type: "commandAck", clientSeq, executeTick }` | Optional UI/debug acknowledgement |
| `{ type: "desync", tick, hashes }` | Hash mismatch detected |
| `{ type: "resyncSoft", tick, diffs }` | Trusted small correction |
| `{ type: "resyncHard", tick, snapshot }` | Trusted full state reload |
| `{ type: "catchup", snapshotTick, snapshot, commands }` | Reconnect/spectator catch-up |
| `{ type: "matchEnd", tick, winner, finalHash }` | Agreed or trusted match end |

## Tick model

The DO owns the match tick number. Clients do not advance multiplayer simulation from wall-clock time. They execute tick N only after receiving `tickCommands` for tick N.

At 30 Hz:

- Tick duration: 33.333 ms
- Phase 1 command lead: 4 ticks by default, about 133 ms
- Hash interval: every 30 ticks, about once per second
- Snapshot interval: every 600 ticks, about every 20 seconds

When the DO receives a command at server tick `S`, it schedules:

```ts
executeTick = S + commandLeadTicks;
```

`localTick` is diagnostic only in Phase 1. It helps measure skew and input delay, but the DO does not trust it for scheduling. This avoids the edge case where a client asks for an execution tick that is already too close for reliable fan-out.

The DO sends a `tickCommands` message for every tick, including empty batches. For storage, only non-empty command batches are persisted; missing ticks mean no commands.

Slow clients naturally fall behind because they wait for ordered tick batches. If a client falls too far behind, it reconnects through the snapshot + command-log path.

## Command log

The command log is the replay source of truth:

- Store commands by execution tick.
- Store only non-empty command batches.
- Include command protocol version and content version in match metadata.
- Never store render state, UI state, audio state, or transient effects.

For a 15 minute match at 30 Hz, there are about 27,000 ticks. With 2 players and command-only traffic, the command log should stay tiny. Empty tick rows are unnecessary.

## Snapshot budget

Durable Object storage values/rows have a 2 MB size limit, so Phase 1 snapshots must stay well below that. The target is:

- Warning threshold: 1.5 MB serialized
- Hard failure: 2.0 MB serialized
- CI test: serialize a worst-case 1,000-entity snapshot and assert it stays under the threshold

Snapshots are trusted Phase 1 state dumps from the elected author. They are for reconnect, spectator catch-up, resync, and replay convenience. They are not anti-cheat evidence.

A compact 1,000-entity snapshot should fit comfortably:

| Data | Rough budget |
|---|---:|
| Header, versions, tick, seed | < 4 KB |
| Entity handles, generations, owners, templates, component masks | ~32-64 KB |
| Position, velocity, rotation, health, shields, physics fields | ~150-250 KB |
| Fleet membership, cargo, current orders, pilot input | ~100-350 KB |
| PRNG states and sim bookkeeping | < 32 KB |
| Serialization overhead | ~2x if JSON, much lower if binary |

Expected Phase 1 range: 500 KB to 1.2 MB serialized if IDs and enum values are numeric and large repeated data stays out of the snapshot. If the size test crosses 1.5 MB, switch snapshots to chunked rows or R2 before adding more gameplay state.

Snapshot contents:

- Include deterministic sim state needed to resume exactly.
- Include stable entity handles and generations, not raw bitECS runtime IDs.
- Include order queues and PRNG states.
- Exclude assets, content files, render proxies, `PrevPosition`, effects, UI selection, camera, and audio.
- On load, set `PrevPosition = Position` for all entities.

## Snapshot author

For friendly Phase 1, elect one trusted snapshot author:

1. Lowest player ID if both players are present.
2. Remaining connected player if the other disconnects.

The author uploads a compact snapshot every 600 ticks. The DO stores the last 10 snapshots, which gives roughly 3 minutes of rollback/catch-up at 30 Hz.

If the author disconnects, the DO elects the remaining player after a short grace period. This is trust-based and acceptable for Phase 1.

## Storage layout

Use SQLite-backed Durable Objects for new namespaces. Keep rows below 2 MB.

Suggested tables:

```sql
match_meta(match_id, status, seed, content_version, protocol_version, started_at, ended_at)
command_batches(tick INTEGER PRIMARY KEY, commands_json TEXT)
hash_reports(tick INTEGER, player_id TEXT, hash TEXT, PRIMARY KEY (tick, player_id))
snapshots(tick INTEGER PRIMARY KEY, author_player_id TEXT, snapshot_blob BLOB, byte_length INTEGER)
match_end_reports(player_id TEXT PRIMARY KEY, tick INTEGER, winner TEXT, final_hash TEXT)
```

If `snapshot_blob` approaches 2 MB, replace `snapshots` with chunked rows:

```sql
snapshot_chunks(tick, chunk_index, chunk_blob, PRIMARY KEY (tick, chunk_index))
```

After match end and retention, archive the command log plus final snapshot to R2, delete any alarm, and call `storage.deleteAll()` so the DO's storage can be removed.

## Reconnect

1. Client sends `{ type: "reconnect", playerId, lastTick }`.
2. DO finds the latest snapshot at or before current tick.
3. DO sends that snapshot plus all non-empty command batches after it.
4. Client loads the snapshot, fast-simulates to the latest tick batch it has, and resumes.

If no snapshot exists yet, reconnect starts from `matchStart` plus command batches from tick 0.

## Spectator

Spectator mode uses the same catch-up path as reconnect. A spectator runs the sim locally, never sends player commands, and can join from the latest trusted snapshot plus command log.

## Desync handling

Every client sends a hash every 30 ticks. The DO compares hashes for the same tick:

1. If both hashes match, continue.
2. If hashes differ, broadcast `desync`.
3. Request a snapshot or focused state dump from both clients.
4. Use the snapshot author's state as trusted.
5. Send a soft diff when small, or a hard snapshot reload when large.

This is not cheat-resistant. It is a recovery tool for friendly play and determinism bugs.

## Match lifecycle

1. **Create**: Worker creates or resolves the match DO and returns a match ID.
2. **Lobby**: players connect and ready up.
3. **Start**: DO chooses seed, broadcasts `matchStart`, starts server tick at 0.
4. **Play**: DO broadcasts tick command batches, stores non-empty commands, checks hashes, stores snapshots.
5. **End**: clients report deterministic match end; DO records agreement or trusted remaining-player result.
6. **Archive**: final command log and final snapshot are written to R2.
7. **Cleanup**: after retention, DO clears alarms and storage.

## Topology

```text
[ Client ]---ws---\
[ Client ]---ws----+--> [ Worker routing ] --> [ Match Durable Object ] --> [ R2 archive ]
[ Spectator ]-ws---/                                      |
                                                          v
                                                     [ DO SQLite ]
```

## Phase 2 escape hatch

If public competitive play or stronger cheat resistance becomes important, add server authority:

- Import the platform-independent sim into the DO or a separate compute target.
- Have the server compute its own hash.
- Treat server state as authoritative on mismatch.
- Revisit CPU cost; complex sim may need sharding or Cloudflare Containers.

Do not build this until Phase 1 is fun.
