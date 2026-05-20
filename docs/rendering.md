# Rendering Architecture

## Core principle

The sim is authoritative. Rendering is presentation.

The renderer reads ECS state, side stores, and sim events. It never mutates future-affecting sim state. Input flows back through commands, not direct component writes.

```text
Input -> command intent -> DO/local scheduler -> tick command batch -> sim -> ECS/stores/events -> renderer
```

This keeps live play, single-player, replay, and spectator mode on the same path.

## Two clocks

There are two clocks:

- Sim tick: fixed 30 Hz.
- Render frame: variable, driven by `requestAnimationFrame`.

In multiplayer, the sim advances only when the client receives the next ordered `tickCommands` batch from the DO. In single-player and replay, a local scheduler produces the same command-batch stream.

The render frame may run 0, 1, or many times between sim ticks.

## Interpolation

At the start of each sim tick, copy `Position` to `PrevPosition`. The renderer interpolates:

```ts
const alpha = clamp((renderNow - lastSimStepTime) / SIM_DT_MS, 0, 1);
const renderedPos = lerp(prevPosition, position, alpha);
```

`PrevPosition` is render support state. Do not persist it in snapshots. After loading a snapshot, initialize `PrevPosition = Position`.

If multiplayer tick batches arrive late, clamp rather than advancing the sim locally. Visual extrapolation is allowed only as render-only presentation and must not write back to sim state.

## Frame loop

```ts
function frame(now: number) {
  requestAnimationFrame(frame);

  while (runtime.hasNextTickBatch()) {
    const batch = runtime.takeNextTickBatch();
    runTick(world, batch.tick, batch);
    lastSimStepTime = now;
  }

  const alpha = computeRenderAlpha(now, lastSimStepTime);

  renderingSystem.update(world, alpha);
  commandVizSystem.update(world, alpha);
  effectsManager.update(now);
  audioManager.update(now);
  cameraSystem.update(now);

  renderer.render(scene, camera);
}
```

The key point is that runtime tick batches drive sim advancement. Wall-clock time only drives presentation.

## Scene structure

One three.js scene per match.

```text
scene
|-- world          sim-rendered entities, offset by floating origin
|-- effects        transient beams, explosions, particles
|-- selection      outlines, highlights, order visualization
`-- env            skybox, stars, ambient lighting
```

HUD, command panels, minimap, and resource counters are DOM/canvas overlays.

## Floating origin

Keep the camera near origin and offset the rendered world:

```ts
worldGroup.position.copy(cameraFocusWorldSpace).multiplyScalar(-1);
```

Sim coordinates remain in simulation space. Rendering converts `simPos - floatingOrigin` to three.js coordinates.

Shift the floating origin in chunks rather than every frame if the map becomes large. For Phase 1, keep maps modest and avoid solving galaxy-scale precision before the game needs it.

## Renderer setup

Use three.js with a depth strategy suited to large spaces:

```ts
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
});
```

`logarithmicDepthBuffer` helps when ships, stations, and planetary objects share one scene. Still keep Phase 1 scale bands restrained; not every object needs to be visible at every zoom.

## LOD by scale tier

`ScaleTier` is numeric sim/render metadata that picks a render strategy.

### Planetary

- Few per match.
- Billboard or low-poly sphere at distance.
- High-detail sphere and atmosphere shader up close.

### Megastructure

- Stations, gates, large wrecks.
- Impostor at long range.
- Mesh LOD near the tactical camera.

### Ship-scale

- Fighters, frigates, miners, drones, projectiles.
- Frustum culling.
- Distance culling.
- `InstancedMesh` for repeated ship/projectile types.
- Impostors for distant groups.

Visual-only particles and beams are not sim entities and do not count toward the 1,000 live sim entity budget.

## Render proxies

Three.js objects live in client-side render proxies keyed by stable handle or runtime eid plus generation check.

Proxy types:

- `MeshProxy`
- `InstancedMeshProxy`
- `BillboardProxy`
- `LightProxy`
- `LODProxy`

`RenderingSystem`:

1. Reads renderable ECS entities.
2. Creates missing proxies.
3. Disposes proxies for despawned entities.
4. Updates transforms from interpolated state.
5. Updates LOD and instanced buffers in batches.

Proxies are not ECS components and are never serialized.

## Camera system

Camera state is local to each client.

Modes:

- Tactical
- Free fly
- Follow entity/fleet
- Cinematic replay/spectator

Camera transitions are presentation only. The first capture demo uses tactical-view UI and controls only; first-person piloting is outside its scope.

## Input system

The input system is the only code that touches DOM pointer, keyboard, mouse, or gamepad events.

Flow:

1. DOM/gamepad events update local input state.
2. Input system interprets state with camera mode, selection, hover, and modifiers.
3. It emits command intents with stable handles.
4. Network client sends those intents to the DO.
5. DO assigns execution ticks and broadcasts tick batches.
6. `CommandIntakeSystem` applies the commands.

Single-player uses a local scheduler with the same command-batch interface. Do not special-case direct ECS mutation for solo play.

## Selection

Selection is local-only client state.

It can be a set of stable handles:

- click to select
- shift-click to add/remove
- drag-box to select rendered positions
- hotkey groups
- double-click type in viewport

Selection drives outlines, command panels, target defaults, and local UI. It is not part of sim snapshots or hashes.

## Effects

Visual effects are event-driven and presentation-only.

Example:

1. `CombatSystem` emits `WeaponFired`.
2. Effects manager spawns a pooled energy projectile, impact flash, or muzzle flash.
3. Effect updates on render time.
4. Effect expires and disposes.

Effect randomness is allowed if it never affects sim. Use object pools for frequent effects.

Energy projectile particles:

- are visual-only particles created from sim combat events
- use cyan for Player 1 and magenta for Player 2
- should be pooled billboards or instanced quads in interactive mode
- may add a small emissive glow or halo in cinematic mode
- must stay cheap enough for many simultaneous shots
- never determine whether a weapon hit

## Audio

Audio follows the same event pattern as effects. Positional audio uses interpolated render positions, not raw sim mutation. Audio may outlive the entity that triggered it.

## Order visualization

Order visualization reads `OrderStore`, `Owner`, selection, and stable handles.

Examples:

- `MoveTo`: line and waypoint.
- `AttackTarget`: arc or reticle.
- `Mine`: target marker.
- `Orbit`: radius circle.
- Fleet order: formation slots and group boundary.

By default, show local-player orders. Spectator mode can show all.

## UI overlay

UI uses Preact for DOM overlays, and plain DOM remains acceptable for narrow render/input affordances such as drag selection. It reads sim through selector functions and local client state. Preact components receive snapshots and action callbacks, not the sim world or three.js objects.

Phase 1 UI:

- resources
- selected entity details
- fleet roster
- command buttons
- minimap at 4-10 Hz
- match timer/objective/winner
- desync/resync notice for debugging

The first capture demo implements all player-facing controls in tactical view. Cockpit HUD and first-person piloting UI are reserved for a later milestone.

UI click handlers produce command intents. They do not write ECS state.

## Network client

`packages/client/src/net/` owns WebSocket connection state.

Responsibilities:

- connect/reconnect to the match DO
- send command intents
- receive ordered `tickCommands`
- buffer tick batches
- report periodic hashes
- upload snapshots if this client is the elected author
- apply `resyncSoft` and `resyncHard`
- expose connection status to UI

The network client may call explicit sim runtime APIs for command delivery and resync. It should not reach around those APIs to mutate arbitrary components.

## System placement

| System | Lives in | Reads | Writes |
|---|---|---|---|
| `RuntimeTickQueue` | client | WebSocket/local scheduler | queued command batches |
| `CommandIntakeSystem` | sim | tick command batch | sim components/stores |
| `RenderingSystem` | client | ECS render components, positions | three.js proxies |
| `CommandVizSystem` | client | order stores, selection | selection scene group |
| `CameraSystem` | client | input, selection, optional focus handle | camera transform |
| `InputSystem` | client | DOM/gamepad, hover, selection | command intents |
| `EffectsManager` | client | sim events | transient visual objects |
| `AudioManager` | client | sim events | Web Audio graph |
| `UISelectors` | client | ECS/stores read-only | UI state |
| `HashReportSystem` | sim/runtime | snapshot/hash serializer | hash messages |

## Performance notes

- Use instancing for repeated ship/projectile meshes.
- Use pooled billboard or instanced-quad particles for energy projectile visuals.
- Avoid per-frame allocation.
- Pool vectors, matrices, particles, and effect objects.
- Update UI and minimap slower than render frames.
- Split LOD evaluation across frames if needed.
- Keep sim entity count separate from visual effect count.

## What this gives us

- Live multiplayer, replay, spectator, and single-player share the same sim path.
- The renderer can be replaced without changing gameplay.
- Snapshot/resync can reload sim state without caring about three.js objects.
- Tactical-view UI can grow without becoming gameplay authority.
