# Capture the Flag Demo

## Goal

The first playable demo is a small capture-the-flag style match where players fight over planets. A player captures a planet by keeping a drop ship in orbit long enough while protecting it with fighters and battleships.

This mode must sit on the same deterministic lockstep architecture as the rest of the game:

- commands come from players, AI, or tools and execute on assigned ticks
- orders are serializable sim state
- movement, combat, spawning, and capture all run inside fixed-order sim systems
- snapshots and hashes include every gameplay value that can affect the future
- client UI, camera, effects, and audio read sim state but never become sim authority

See [determinism.md](determinism.md), [command-hierarchy.md](command-hierarchy.md), [ecs.md](ecs.md), and [rendering.md](rendering.md) for the underlying contracts. First-person piloting remains a future feature and is intentionally out of scope for this demo.

## Game Shape

Phase 1 target:

- 2 players
- 5 minute match length for the current demo tuning
- 1-4 capturable planets from match config
- up to 1,000 live sim entities
- one energy weapon family
- tactical-view controls and UI only
- no economy yet
- no Phase 1 anti-cheat

Default objective:

1. Player 1 and Player 2 begin with ships near the planetary system.
2. Each planet has a capture owner or is neutral.
3. A drop ship can start capture while in a valid orbit band around a planet.
4. If the same drop ship remains eligible for more than `PLANET_CAPTURE_SECONDS`, that planet changes owner.
5. A captured planet spawns a new friendly drop ship in orbit.
6. A match can end when one player owns all capturable planets, loses all drop ships, or the demo timer expires.
7. Timer resolution compares captured planets first, then living units, then declares a draw if still tied.

The demo should support both multiplayer and a local single-player attacker/defender mode. Single-player is not a different simulation path; it injects deterministic commands for Player 2.

## Tunable Rules

Put demo rules in serializable config, not hardcoded client state. The first implementation can keep defaults near the sim, but the target shape is:

```ts
type CaptureDemoRules = {
  matchDurationTicks: number;
  planetCaptureSeconds: number;
  captureOrbitMinRadiusMultiplier: number;
  captureOrbitMaxRadiusMultiplier: number;
  captureBreakGraceTicks: number;
  fighterSpawnIntervalTicks: number;
  fighterSpawnCapPerDropShip: number;
  npcThinkIntervalTicks: number;
  npcAggroRange: number;
};
```

Required default:

```ts
const MATCH_DURATION_TICKS = 5 * 60 * PHASE_ONE_SIM_HZ;
const PLANET_CAPTURE_SECONDS = 25;
const PLANET_CAPTURE_TICKS = PLANET_CAPTURE_SECONDS * PHASE_ONE_SIM_HZ;
```

Any rule that affects sim outcomes must be included in match config, content, snapshot, and hash. The renderer may duplicate values for display only, but display copies are not authoritative.

## Ship Classes

Ship class is content data, not a TypeScript class hierarchy. The sim should know a unit's `shipClassId` or equivalent numeric role from its validated template.

### Fighter

Role:

- fast escort and interceptor
- light health
- short-to-medium energy weapon range
- useful against drop ships and other fighters

Sim behavior:

- can receive `MoveTo`, `AttackTarget`, `Orbit`, and `Escort` orders
- no capture ability
- no spawning ability

### Drop Ship

Role:

- planet capture unit
- relatively defenseless
- should feel valuable and vulnerable
- spawns fighters to create a light defensive screen

Sim behavior:

- can receive `MoveTo`, `Orbit`, `CapturePlanet`, and `Escort` orders
- contributes capture only while capture-eligible
- spawns fighters on deterministic intervals while alive and under cap
- may have weak or no weapons in the initial content

### Battleship

Role:

- slow capital ship with massive firepower
- area denial and siege support
- vulnerable to positioning mistakes because of low mobility

Sim behavior:

- can receive `MoveTo`, `AttackTarget`, `Orbit`, and `GuardPlanet` orders
- large collider and mass
- long range energy weapons
- slow acceleration and turn rate

## Energy Weapons

The first weapon family is a deterministic energy weapon. Keep it data-driven so fighter and battleship weapons differ by content values rather than system branches.

Suggested content fields:

```ts
type EnergyWeaponStats = {
  weaponId: number;
  damage: number;
  cooldownTicks: number;
  range: number;
  firingArc: "front" | "turret";
};
```

Combat rules:

- `ShipOrderSystem` sets firing intent from tactical-view orders.
- `CombatSystem` resolves range, arc, cooldown, target validity, and damage.
- Iterate shooters in stable handle order.
- If multiple damage sources hit a target in the same tick, aggregate or apply them in stable source order.
- Weapon cooldowns are sim state and must serialize.
- Weapon projectile visuals are events; they do not decide hits.

For Phase 1, hitscan-style resolution is the simplest deterministic choice even if the renderer draws a short-lived projectile particle for readability. Sim projectiles can be added later as normal entities if weapon travel time becomes important.

## Projectile Particles

Energy weapons need a very cheap visual projectile layer so combat is readable in tactical view.

Rendering rules:

- `CombatSystem` emits deterministic `WeaponFired` or `WeaponHit` events with source, target or impact point, owner, and weapon ID.
- The client effects manager turns those events into visual-only particles.
- Particles are not sim entities, are not serialized, and do not affect hit resolution.
- Player 1 projectiles use cyan, matching the existing Player 1 color.
- Player 2 projectiles use magenta, replacing the previous orange identity.
- Interactive mode uses tiny pooled billboards or instanced quads with additive color.
- Cinematic mode may add a small emissive glow or bloom-friendly halo.
- Glow must be an optional material/layer flag, not extra gameplay state.

Keep the effect intentionally small: one pooled particle per shot is enough for the first demo, with optional short trail/fade in render time.

## Capture Model

Capture is planet state plus deterministic per-planet progress. It should not depend on renderer orbit visuals or wall-clock time.

Suggested state:

```ts
type PlanetControlState = {
  planet: EntityHandle;
  owner: PlayerId | 0;
  capturingPlayer: PlayerId | 0;
  capturingDropShip: EntityHandle | null;
  captureTicks: number;
  contested: boolean;
};
```

Eligibility for a drop ship:

- unit owner matches the capturing player
- unit template has the drop ship class
- unit is alive
- unit has active `isOrbiting` state for the planet from `OrbitTrackingSystem`
- orbit tracking comes from a `CapturePlanet`, `GuardPlanet`, or `Orbit` order targeting that planet
- unit position is inside the configured orbit band
- unit is not inside the planet collider or despawn state

Capture tick rule:

1. For each capturable planet in stable handle order, collect eligible drop ships in stable handle order.
2. If ships from more than one player are eligible, mark contested and do not advance progress.
3. If no ships are eligible, clear or decay progress according to the configured rule.
4. If the current tracked drop ship is still eligible, increment `captureTicks`.
5. If not, choose the first eligible drop ship in stable order for the capturing player and reset `captureTicks` to 1.
6. When `captureTicks > PLANET_CAPTURE_TICKS`, assign planet owner, emit `PlanetCaptured`, spawn a friendly drop ship in orbit, and clear capture progress.

This implements "a drop ship remains in orbit" literally: the same stable drop ship handle must maintain eligibility. A future design can switch to team-level capture progress, but that is a different rule and should change replay expectations.

Recommended initial neutral behavior:

- neutral planets can be captured by either player
- owned planets can be captured by the opponent
- owner ships do not reverse-capture their own planet; they only contest hostile capture

## Fighter Spawning

Drop ships spawn fighters, but spawning must be deterministic and bounded.

Suggested state:

```ts
type FighterSpawnState = {
  parentDropShip: EntityHandle;
  nextSpawnTick: number;
  spawnedFighters: readonly EntityHandle[];
};
```

Rules:

- Spawn systems own bounded spawn mutations through `spawnUnit` and emit deterministic `unitSpawned` events.
- `LifecycleSystem` removes destroyed units in stable order.
- Spawn positions are generated from stable parent handle, tick, and a named PRNG stream or deterministic formation offsets.
- Spawned fighters inherit owner from the drop ship.
- Keep a per-drop-ship cap so the demo cannot create unbounded entities.
- Remove destroyed fighter handles from the parent spawn list in stable order.

If spawned fighters are free in the demo, that rule belongs in `CaptureDemoRules`. If they later consume cargo, crew, or energy, those costs must become sim state before spawning.

## Commands And Orders

Commands stay small and external. Orders carry the serializable task state.

Initial commands:

```ts
type IssueUnitOrderCommand = {
  units: readonly EntityHandle[];
  order: UnitOrderIntent;
  queueMode: "replace" | "append";
};

type UnitOrderIntent =
  | { type: "MoveTo"; target: Vec3Data }
  | { type: "AttackTarget"; target: EntityHandle }
  | { type: "CapturePlanet"; planet: EntityHandle }
  | { type: "GuardPlanet"; planet: EntityHandle }
  | { type: "Escort"; target: EntityHandle };
```

Order interpretation:

- `CapturePlanet` moves the drop ship into the planet's capture orbit band, then maintains orbit and sets capture intent.
- `GuardPlanet` keeps battleships near a planet and attacks enemies in range.
- `Escort` keeps fighters near a friendly ship and attacks threats in range.
- `AttackTarget` approaches weapon range and sets firing intent.

All first-demo commands come from tactical view selection, command buttons, map clicks, or hotkeys. FPV possession and cockpit input are not part of this demo.

## System Integration

The current sim already has deterministic system slots. Gameplay should fill them without changing the core shape.

Recommended order:

1. `PlanetMotionSystem`
2. `CommandIntakeSystem`
3. `NpcCommandSystem`
4. `FleetCommandSystem`
5. `ShipOrderSystem`
6. `SteeringSystem`
7. `PhysicsSystem`
8. `CollisionSystem`
9. `OrbitTrackingSystem`
10. `CombatSystem`
11. `CaptureSystem`
12. `DropShipSpawnSystem`
13. `MiningSystem`
14. `ResourceSystem`
15. `LifecycleSystem`
16. `MatchEndSystem`
17. `EventFlushSystem`

Notes:

- `NpcCommandSystem` must emit or apply the same order data as player commands. It may be compiled into local single-player only at first, but its outputs still have to be deterministic.
- `OrbitTrackingSystem` runs after collision so `CaptureSystem` consumes one stable orbit state.
- `DropShipSpawnSystem` runs after combat so destroyed drop ships do not spawn fighters on the same tick.
- `LifecycleSystem` removes destroyed units after capture and spawn systems have completed their deterministic mutations.
- `MatchEndSystem` reads planet ownership and timer state, then emits deterministic match-result events.

Do not let UI buttons, local debug controls, or NPC code mutate units directly. They should all enter through command batches or deterministic systems.

## Single-Player Test Mode

Single-player attacker/defender mode is a match config preset:

- Player 1 is the attacker and can use the normal tactical controls.
- Player 2 is an NPC defender.
- Player 2 starts with a bunch of fighters and battleships near one or more planets.
- Player 2 does not need strategy yet.

NPC behavior:

- every `npcThinkIntervalTicks`, scan Player 2 ships in stable handle order
- find the nearest enemy within `npcAggroRange`
- if one exists, issue or maintain `AttackTarget`
- otherwise fighters maintain `GuardPlanet` or `Escort`
- battleships maintain `GuardPlanet`
- fire when target is in range and arc through normal `CombatSystem`

The NPC should not use `Date.now()`, render frames, array insertion order from async loading, or `Math.random()`. If it needs variety, use a named PRNG stream included in snapshot and hash. For the first defender, stable nearest-target selection is enough.

Important: local single-player can skip the Durable Object transport, but it must feed the same `CommandBatch` interface that multiplayer and replay use. That keeps single-player, multiplayer, and replay behavior aligned.

## Match Config And Content

Add demo-specific initial state through content and match config:

```ts
type InitialUnitConfig = {
  owner: PlayerId;
  templateId: number;
  position: Vec3Data;
  initialOrder?: UnitOrderIntent;
};

type InitialPlanetConfig = {
  ...
  capturable?: boolean;
  initialOwner?: PlayerId | 0;
};

type MatchConfig = {
  ...
  gameMode?: "minimalSkirmish" | "captureDemo";
  captureDemoRules?: CaptureDemoRules;
};
```

Content additions:

- fighter template
- drop ship template
- battleship template
- small energy weapon
- heavy energy weapon
- ship class numeric IDs

The existing scout ship can temporarily stand in for fighter while the real templates land, but capture and battleship behavior should be keyed off explicit ship classes instead of display names or template IDs scattered through systems.

## Snapshot And Hash

New deterministic state must round-trip through snapshots and participate in hashes:

- ship class or template-derived class ID
- order queues and active order state
- weapon cooldowns
- health and pending despawn state
- unit orbit state
- planet ownership
- capture progress and tracked drop ship handle
- contested state if it affects future behavior
- drop ship fighter spawn timers and spawned fighter handles
- NPC state, if any state persists between think ticks
- match timer and match result
- PRNG streams for combat, spawn, and NPC decisions

Exclude:

- selection
- camera mode
- HUD capture bars derived from sim state
- energy projectile particles
- impact effects
- audio

Replay fixtures should cover at least:

- uninterrupted drop ship capture after `PLANET_CAPTURE_TICKS + 1`
- capture reset when the tracked drop ship leaves orbit
- contested orbit pausing capture
- drop ship fighter spawning cap
- NPC defender firing at a nearby attacker
- snapshot round-trip mid-capture continuing to the same final hash

## Client Responsibilities

The client renders and controls the demo, but does not own gameplay truth.

Client reads:

- unit positions, rotations, health, classes, and owners
- planet owner and capture progress
- weapon fire and capture events
- match result

Client sends:

- selected unit order commands
- debug match-start preset choice

Client-only tactical UI:

- planet capture ring and progress bar
- owner coloring
- target brackets
- attack warnings
- spawn indicators
- tactical command panel
- selected-unit details
- match result overlay

The capture UI should display `captureTicks / PLANET_CAPTURE_TICKS` from sim state. It should not run its own timer.

## Implementation Milestones

1. Content: add fighter, drop ship, battleship, and energy weapon templates with numeric IDs.
2. Protocol: add generic unit order commands, capture demo rules, and snapshot fields.
3. Sim state: add order queues or extend current unit order scaffold, weapon cooldowns, planet control state, and spawn state.
4. Systems: implement ship order interpretation, combat, capture, drop ship spawning, lifecycle spawn/despawn, and match end.
5. Single-player preset: create attacker/defender match config and deterministic Player 2 NPC behavior.
6. Tests: add replay and snapshot cases before expanding UI.
7. Client: expose tactical-view unit selection orders, planet capture UI, health bars, and simple combat projectile particles.

Keep each milestone replayable. The fastest way to find architecture drift is to make every gameplay step produce a stable hash from a small fixture.

## Non-Goals

- no economy or resource cost for the first demo
- no fog of war
- no server authority
- no client-predicted combat or capture
- no per-frame AI
- no non-deterministic spawning
- no special-case physics for ship classes
- no renderer-only gameplay conditions
- no first-person view, cockpit HUD, possession, or piloting controls in the first demo
