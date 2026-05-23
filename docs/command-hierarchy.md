# Command Hierarchy

## Core principle

Player input never mutates entities directly. Input becomes a command, the DO assigns an execution tick, and the sim turns that command into orders and movement.

The hierarchy is:

```text
Input -> Command -> tick batch -> OrderQueue -> desired movement/actions -> steering -> physics/combat
```

This keeps networking, replay, AI, fleets, and piloting on the same path.

## Commands vs orders

Use two words deliberately:

- **Command**: external intent sent to the DO and stored in the replay log.
- **Order**: serializable sim task stored on an entity or fleet.

Commands and orders are both plain data, but they live at different layers.

Example command:

```ts
type Command = {
  id: CommandId;
  issuedBy: PlayerId;
  type: "IssueOrder" | "Possess" | "Release" | "PilotInput" | "LockTarget";
  params: CommandParams;
};
```

Example order:

```ts
type CommandSource = "player" | "npc" | "autonomy" | "system";

type Order = {
  id: OrderId;
  issuedTick: number;
  source: CommandSource;
  type: "MoveTo" | "AttackTarget" | "Mine" | "Dock" | "Orbit" | "Piloted";
  params: OrderParams;
  state: "pending" | "active" | "completed" | "failed";
  parentOrderId?: OrderId;
};
```

Both use stable entity handles:

```ts
type EntityHandle = {
  id: number;
  generation: number;
};
```

Never use raw bitECS runtime eids in commands, orders, snapshots, or replays.

## Command Source And Provenance

Every scheduled command may carry a source:

- `player`: direct human input. Legacy commands without a source are treated as
  player commands.
- `npc`: an opponent controller acting for an NPC-owned player.
- `autonomy`: a deterministic helper controller acting for a human player's
  unattended fleet.
- `system`: setup or deterministic sim-side initialization, such as starting
  escort orders.

The active order and queued orders store provenance metadata: source and issued
tick. That metadata is sim state, not UI state, because future controllers may
use it to decide whether they are allowed to replace an order. It must
round-trip through snapshots and participate in replay hashes.

The current fleet-autonomy controller uses this contract to keep player agency
intact: it may command units with no unresolved player intent, and it may resume
after a player-authored terminal order records an `objectiveMet` ending. It must
not replace active or queued player orders, and standing player orders such as
escort, guard, and orbit remain player intent until the player changes them or
their target becomes invalid. In local and headless command batches, non-player
sources sort before `player` for the same player and tick, so a same-tick click
remains the last applied command.

Provenance is not a permission system by itself. Seat ownership, network
validation, and replay authority still live at the command scheduling layer.

## Order queues

Any commandable entity can have an order queue. The queue itself lives in `OrderStore`, not directly in a typed-array component.

```ts
type OrderQueue = {
  orders: Order[];
  currentIndex: number;
};
```

Rules:

- Default click replaces the queue.
- Shift-click appends.
- Standing orders can loop.
- Completed or failed active orders advance `currentIndex`.
- Empty queue means idle.
- Failed child orders bubble to the parent order deterministically.

## Fleet layer

A fleet is a commandable entity with:

- an `OrderQueue`
- a deterministic sorted member list
- a doctrine ID

The `FleetCommandSystem` interprets the fleet's active order and maintains child ship orders.

Example:

| Fleet order | Frigates | Capitals | Miners |
|---|---|---|---|
| `AttackTarget` | `Orbit { range }` | `AttackTarget` | `MoveTo { rearSlot }` |
| `MoveTo` | `MoveTo { screenSlot }` | `MoveTo { formationSlot }` | `MoveTo { centerSlot }` |

Fleet decomposition is continuous but idempotent. The system may reevaluate every tick, but it should only rewrite child orders when the desired child order actually changes. This avoids pointless queue churn while still responding to target movement, destroyed ships, or formation drift.

Member iteration is always sorted by stable handle.

## Ship layer

The `ShipOrderSystem` interprets the active ship order:

- `MoveTo`: desired velocity toward target point.
- `AttackTarget`: approach range, face target, set firing flags.
- `Mine`: approach harvestable, maintain range, set mining flag.
- `Orbit`: desired tangent velocity around target.
- `Dock`: approach and transition to docked state.
- `Piloted`: read `ActivePilotInput`; see `piloting.md`.

Output is desired movement and action intent for this tick. The system does not directly integrate positions or apply damage.

## Steering layer

The `SteeringSystem` combines intent with environmental forces and constraints in fixed order:

1. Desired movement from active order.
2. Gravity from `GravityWell` entities, sorted by stable handle.
3. Formation/boids forces.
4. Obstacle avoidance.
5. Collision avoidance intent.

In the current minimal sim, planetary records with `mass`, `position`, and `radius` are the `GravityWell` source of truth until the fuller ECS component split exists. Ships do not emit gravity.

It writes steering outputs such as desired acceleration or adjusted velocity. The `PhysicsSystem` performs integration.

This separation matters: orders express intent, steering expresses feasible motion, physics applies it.

## Physics and combat

The `PhysicsSystem` integrates velocity, position, rotation, fuel, and thrust. The `CollisionSystem` resolves overlaps and collision consequences. The `CombatSystem` reads firing flags, cooldowns, targets, and weapon data, then applies damage and emits events.

Keep these responsibilities separate. It makes replay diffs easier and avoids hidden cross-system dependencies.

## Intent vs ability

`desiredVelocity` is what the order wants. Actual motion is what mass, thrust, gravity, collision, and fuel permit.

That means a mining barge in a deep gravity well may fail a `MoveTo` order because it genuinely cannot escape. Failure is a gameplay outcome, not an exception.

Order failure rules:

- Track progress by tick count, not wall-clock time.
- Use deterministic thresholds.
- Emit `OrderFailed` when progress is impossible or timeout expires.
- Parent fleet order can reissue, choose another tactic, or fail.

## Network flow

Example: player right-clicks an enemy station with a fleet selected.

1. Client sends a command intent with stable fleet and target handles.
2. DO receives it at server tick 1250.
3. DO schedules it for tick 1254 using the Phase 1 4-tick command lead.
4. DO stores it in the tick-1254 command batch.
5. All clients receive `tickCommands { tick: 1254, commands: [...] }`.
6. All clients execute tick 1254 by applying the command to the fleet order queue.
7. `FleetCommandSystem` creates or updates child ship orders.
8. `ShipOrderSystem` produces movement and action intent.
9. `SteeringSystem`, `PhysicsSystem`, `CollisionSystem`, and `CombatSystem` advance the world.
10. Renderer displays the result from ECS state and emitted events.

The command log contains the small tick-1254 command. Everything else is deterministic local computation.

## Feature mapping

- Mining/salvaging: `Mine` targets any `Harvestable`.
- Fleet control: commands target fleet handles, fleet system updates ship orders.
- Formations: fleet slots plus steering cohesion.
- Gravity: steering contributor, order layer unaware.
- First-person piloting: `Piloted` order reads `ActivePilotInput`; same physics and combat.
- Replays: command log plus seed reproduces order queues and sim state.

## Design rules

- Commands and orders are data, never behavior.
- Behavior lives in systems.
- All entity references use stable handles.
- The DO assigns execution ticks.
- Fleet decomposition is deterministic and idempotent.
- Steering contributor order is fixed.
- Physics integration lives in `PhysicsSystem`.
- An impossible order fails visibly and deterministically.
