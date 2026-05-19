# Entity Component System

## Why ECS

The game needs ships, fleets, stations, asteroids, wrecks, projectiles, mining targets, and piloted craft to share behavior without a class hierarchy. ECS gives us composition:

- Entity: a runtime ID used by the ECS library.
- Component: fixed-shape data attached to entities.
- System: deterministic logic over matching entities.
- Store: deterministic side data for variable-length state that does not fit cleanly in typed-array components.

At Phase 1 scale, clarity matters more than clever ECS purity.

## Library

Use bitECS for fixed-size, numeric, frequently accessed state.

Reasons:

- Structure-of-arrays storage.
- Small API surface.
- Good fit for 1,000 live entities.
- Works in browser, Node, and later Cloudflare runtime if needed.

Do not pretend every game datum belongs directly in bitECS typed arrays. Order queues, cargo manifests, fleet member lists, and debug metadata belong in deterministic side stores keyed by stable handles. Runtime-eid-only caches are allowed only when they are rebuilt from canonical state and excluded from snapshots.

## Entity identity

There are two IDs:

1. Runtime eid: bitECS internal entity ID. Fast, local, never persisted.
2. Stable handle: protocol/snapshot/replay identity.

```ts
type EntityHandle = {
  id: number;
  generation: number;
};
```

Every command, order target, replay entry, and snapshot reference uses `EntityHandle`. The sim keeps a mapping:

```text
EntityHandle -> runtime eid
runtime eid -> EntityHandle
```

If a command references a stale generation, it fails deterministically. This prevents delayed commands from affecting a newly spawned entity that reused the same runtime slot.

## Component catalog

Components should be fixed-size and mostly numeric. Use numeric content IDs instead of strings in sim state.

### Identity

- `StableId { id, generation }`
- `Owner { playerId }`
- `Template { templateId }`

### Spatial

- `Position { x, y, z }`
- `PrevPosition { x, y, z }`
- `Velocity { x, y, z }`
- `Rotation { x, y, z, w }`
- `Mass { kg }`

`PrevPosition` is render interpolation state. It is not required in persisted snapshots; set it to `Position` after loading.

### Orders and behavior

- `HasOrders`
- `FleetMember { fleetHandleId, fleetGeneration, roleId }`
- `FlockMember { groupId, slotIndex }`
- `DesiredVelocity { x, y, z }`
- `DesiredRotation { x, y, z, w }`
- `ActionFlags { firingMask, mining, docking }`

Variable-length order queues and fleet rosters live in side stores.

### Combat

- `Health { current, max }`
- `Shield { current, max, regenRate }`
- `WeaponCooldowns` as fixed numeric slots for Phase 1
- `DamageAccumulator { amount, sourceCount }`

Detailed damage sources are transient events or side-store diagnostics. Only include them in hash/snapshot if they can affect future simulation.

### Resources

- `Harvestable { resourceId, amount }`
- `CargoSummary { used, capacity }`
- `MiningLaser { range, rate }`

Detailed cargo contents live in a deterministic `CargoStore` keyed by entity handle.

### Physics

- `Thrust { max, current }`
- `Fuel { current, max, consumptionRate }`
- `GravityWell { strength, range }`
- `Collider { radius }`

Phase 1 scaffold note: `SimPlanet { mass, position, radius }` currently supplies planetary gravity inputs before this component is split out. Non-planetary entities with mass must not become gravity sources.

### Piloting

- `ActivePilotInput { thrustX, thrustY, thrustZ, pitch, yaw, roll, fireFlags, lastUpdatedTick }`
- `Cockpit { offsetX, offsetY, offsetZ, rotationX, rotationY, rotationZ, rotationW }`

### Rendering metadata

- `Render { meshId, materialId }`
- `ScaleTier { tier }`

These are declarative numeric IDs. The sim never imports three.js.

### Lifecycle

- `SpawnedTick { tick }`
- `DespawnPending { tick, reason }`

## Side stores

Use side stores for variable-length state:

```text
OrderStore       EntityHandle -> OrderQueue
FleetStore       FleetHandle -> sorted member handles + doctrine
CargoStore       EntityHandle -> sorted resourceId amounts
ProjectileStore  EntityHandle -> projectile metadata if not fixed-size
```

Store rules:

- Keys serialize as stable handles.
- Iteration order is sorted by handle ID, then generation.
- Values are plain serializable data.
- Stores have explicit snapshot, hash, and reset functions.
- No closures, class instances, live references, DOM objects, or promises.

## System order

Systems run in one registered order. This order is part of replay compatibility.

```ts
const systems: System[] = [
  CommandIntakeSystem,
  FleetCommandSystem,
  ShipOrderSystem,
  SteeringSystem,
  PhysicsSystem,
  CollisionSystem,
  CombatSystem,
  MiningSystem,
  ResourceSystem,
  LifecycleSystem,
  EventFlushSystem,
];
```

Responsibilities:

- `CommandIntakeSystem`: apply tick command batch to order stores and component state.
- `FleetCommandSystem`: translate fleet orders into ship orders deterministically.
- `ShipOrderSystem`: translate ship orders into desired movement and action flags.
- `SteeringSystem`: combine desired movement with gravity, formation, avoidance, and collision intent.
- `PhysicsSystem`: integrate velocity, position, rotation, and fuel.
- `CollisionSystem`: resolve overlaps and collision consequences.
- `CombatSystem`: process firing flags, cooldowns, hits, and damage.
- `MiningSystem`: transfer resources from harvestables to cargo.
- `ResourceSystem`: refining, depletion, and economy bookkeeping.
- `LifecycleSystem`: spawn/despawn and handle-map updates.
- `EventFlushSystem`: publish deterministic events to clients/tools after sim state has advanced.

Current scaffold note: before the full bitECS component split lands, ship order intent is stored as a transient `desiredVelocity` field on each `SimUnit`. It is recomputed every tick by `ShipOrderSystem`, consumed by `SteeringSystem`, and excluded from snapshots and hashes.

## Tick loop

```ts
function runTick(world: SimWorld, tick: number, batch: CommandBatch) {
  capturePrevPositions(world);
  world.commandBatch = batch;

  for (const system of systems) {
    system.run(world, tick);
  }

  world.tick = tick + 1;
}
```

The render loop never calls systems directly. Multiplayer ticks come from DO `tickCommands`. Replay and single-player feed the same `CommandBatch` interface.

## Events

Events are plain data emitted during the tick and flushed at the end.

Examples:

- `DamageDealt { source, target, amount }`
- `EntityDestroyed { entity }`
- `ResourceMined { miner, target, resourceId, amount }`
- `OrderCompleted { entity, orderId }`
- `WeaponFired { source, target, weaponId }`
- `OrderFailed { entity, orderId, reason }`

Events are useful for rendering, audio, UI, debug tools, and replay inspection. They are not a substitute for direct component/store reads inside the same tick.

If an event affects future sim state, that effect must already be represented in components or stores before the tick ends.

## Queries

Use current bitECS query APIs and keep query behavior local to systems.

```ts
import { query, isNested } from "bitecs";

for (const eid of query(world.ecs, [Position, Velocity])) {
  // Fast numeric component work.
}

for (const eid of query(world.ecs, [GravityWell], isNested)) {
  // Nested query inside another loop.
}
```

Guidelines:

- Avoid creating ad hoc abstractions around every query early.
- Use the nested-query option when querying inside another query loop.
- Sort by stable handle when result order can change gameplay.
- Keep render-only queries in the client package.

## Data-driven content

Raw content lives under `/content/` and is validated by `packages/content`.

At build or startup, content should become compact records:

- numeric template IDs
- numeric weapon IDs
- numeric resource IDs
- numeric doctrine/role IDs
- validated component defaults

Spawning from content:

```ts
function spawnFromTemplate(world, templateId, position): EntityHandle {
  const template = content.getTemplate(templateId);
  const handle = world.ids.allocate();
  const eid = addEntity(world.ecs);

  world.ids.bind(handle, eid);
  addComponent(world.ecs, StableId, eid);
  StableId.id[eid] = handle.id;
  StableId.generation[eid] = handle.generation;

  applyTemplateComponents(world, eid, template);
  Position.x[eid] = position.x;
  Position.y[eid] = position.y;
  Position.z[eid] = position.z;

  return handle;
}
```

The exact helper names can change. The invariant is stable handle first, runtime eid second.

## Snapshots and hashes

Every component/store that can affect future simulation needs:

- deterministic serialization
- deterministic deserialization
- stable hash contribution
- size awareness

Snapshot excludes:

- `PrevPosition`
- render proxies
- UI selection
- camera state
- audio/effects
- asset loading state

Snapshot includes:

- tick
- handles and generations
- all future-affecting component values
- side stores
- PRNG stream states
- order queues
- lifecycle state

## Phase 1 entity budget

Target 1,000 live entities total. Suggested soft budget:

| Category | Soft count |
|---|---:|
| Ships and drones | 200-400 |
| Projectiles/missiles | 100-300 |
| Asteroids/wrecks/resources | 200-300 |
| Stations/megastructures | 10-30 |
| Effects represented in sim | near zero |

Visual-only particles, beams, trails, and UI markers are not sim entities.

## Feature workflow

When adding gameplay:

1. Does it affect future sim? Add component/store state.
2. Can the player request it? Add command/order type.
3. Does it run every tick? Add or extend a system.
4. Does it need data? Add content schema and numeric IDs.
5. Does it need visuals/audio? Add client event subscriber.
6. Can it replay, hash, and snapshot? Add tests before calling it done.

This keeps features grounded without turning Phase 1 into a framework project.
