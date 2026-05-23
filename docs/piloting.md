# Piloting

## Principle

Piloting is not a separate physics model. It is a ship order whose input source is a player instead of AI.

When a player possesses a ship, the ship receives a `Piloted` order. `ShipOrderSystem` reads `ActivePilotInput` and produces the same kind of desired movement and action flags that any other order produces. Steering, physics, collision, fuel, shields, weapons, and damage are unchanged.

The player's advantage comes from intent and aim, not special stats.

## Phase 1 stance

Phase 1 keeps piloting inside pure lockstep:

- no client-side simulation authority
- no special networking channel
- no server-side cheat checks
- no predictive sim writes
- friendly play only

The expected input delay is roughly 100-150 ms. For heavy ships with inertia, this is acceptable enough to test the core fantasy before adding prediction.

## Commands

Piloting commands are regular protocol commands:

```ts
type Possess = {
  ship: EntityHandle;
};

type Release = {};

type PilotInput = {
  ship: EntityHandle;
  thrustX: number;
  thrustY: number;
  thrustZ: number;
  pitch: number;
  yaw: number;
  roll: number;
  fireFlags: number;
};

type LockTarget = {
  ship: EntityHandle;
  target: EntityHandle | null;
};
```

Use `fireFlags` for continuous firing. Add discrete `FireWeapon` only for weapons that truly need a one-shot command, such as an aimed missile launch or special ability.

All entity references are stable handles, never raw runtime eids.

## Components

```ts
type ActivePilotInput = {
  thrustX: number;
  thrustY: number;
  thrustZ: number;
  pitch: number;
  yaw: number;
  roll: number;
  fireFlags: number;
  lastUpdatedTick: number;
};
```

`ActivePilotInput` is sticky. It holds the last executed input command until another one arrives.

```ts
type Cockpit = {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  rotationW: number;
};
```

`Cockpit` is pure data from content. The renderer uses it for camera placement; the sim treats it as serializable metadata.

## Possession model

When `Possess` executes:

1. Validate owner and ship handle.
2. Save or pause the ship's prior active order if needed.
3. Put `Piloted` at the front of the ship's order queue.
4. Initialize `ActivePilotInput` to neutral if missing.
5. Emit a possession event for UI/camera.

When `Release` executes:

1. Remove or complete the `Piloted` order.
2. Clear or neutralize `ActivePilotInput`.
3. Resume fleet/default behavior.
4. Emit a release event.

If the ship is destroyed, possession ends deterministically and the camera returns to tactical/spectator mode.

## Ship order system

`ShipOrderSystem` has one piloting case:

```ts
if (order.type === "Piloted") {
  const input = ActivePilotInput[eid];

  desiredVelocity = localInputToWorldThrust(eid, input);
  desiredRotation = localInputToRotation(eid, input);
  actionFlags.firingMask = input.fireFlags;
}
```

Everything downstream is unchanged:

- `SteeringSystem` combines desired movement with gravity, formation, and avoidance.
- `PhysicsSystem` integrates.
- `CollisionSystem` resolves collisions.
- `CombatSystem` processes firing flags and cooldowns.

The ship does not need to know whether the input came from AI or a human.

## Input sampling

The client can poll input every render frame for HUD responsiveness, but it sends `PilotInput` commands only on sim tick boundaries and only when state changes.

Rules:

- Accumulate mouse/gamepad deltas between tick samples.
- Quantize input values before sending.
- Send a command when the sampled state changes.
- Consider a low-frequency heartbeat only if testing shows sticky input edge cases.
- Do not stream raw DOM events.

At 30 Hz and 2 players, even worst-case piloting traffic is small. Most ticks send no command because held input is sticky.

## Weapons and aim

Continuous weapons:

- represented by `fireFlags`
- resolved by `CombatSystem`
- use normal cooldowns, heat, ammo, and range checks

Discrete weapons:

- optional `FireWeapon` command
- use stable ship and target/aim data
- execute on the DO-assigned tick like every other command

Hitscan and projectile weapons both live in the sim. The renderer draws beams, tracers, and explosions from events.

## Camera and HUD

`FirstPerson` is a camera mode anchored to the piloted ship's `Cockpit` transform.

HUD elements:

- crosshair
- target reticle
- weapon status
- hull/shield/fuel
- sensor contacts
- lock indicator

Camera transitions are client-only. The actual possession/release takes effect on the sim tick where the command executes. A short zoom animation can hide the lockstep delay.

## Fleet command while piloting

Piloting should create a real tactical tradeoff. The player can still issue fleet orders through a tactical overlay, but attention is limited.

Phase 1 suggestion:

- hold Tab for tactical overlay
- click orders as usual
- release Tab to return to cockpit

The capture demo now has fleet autonomy for unattended tactical units. If
piloting uses that help later, it must use the same command provenance and grace
window rules as tactical autonomy; cockpit code should not directly rewrite
fleet orders.

## Input lag

Pure lockstep means local input waits for the DO-assigned execution tick. In Phase 1, accept this.

Reasons:

- Ships have mass and should not twitch instantly.
- The architecture stays simple.
- Replay and multiplayer remain identical.
- Friendly 2-player matches are the target.

If playtests prove the cockpit feels bad, Phase 2 can add render-only prediction for the local piloted ship. Prediction must not mutate authoritative sim state. It should render a local visual offset and blend back when confirmed ticks arrive.

## Snapshot and hash

Piloting state is normal sim state:

- `Piloted` order is serialized.
- `ActivePilotInput` is serialized.
- locked target is serialized if it affects future simulation.
- camera mode and HUD state are not serialized.

Replays of piloted segments require no special machinery.

## File additions

```text
packages/sim/src/components/
  ActivePilotInput.ts
  Cockpit.ts

packages/sim/src/orders/
  Piloted.ts

packages/protocol/src/commands.ts
  Possess
  Release
  PilotInput
  LockTarget
  optional FireWeapon

packages/client/src/
  input/PilotInputSampler.ts
  camera/FirstPerson.ts
  ui/CockpitHUD.tsx
```

## Non-goals

- No stat boost for piloted ships.
- No piloting-only weapons.
- No separate physics.
- No direct input-to-ECS mutation.
- No Phase 1 anti-cheat.
- No prediction until playtests demand it.
