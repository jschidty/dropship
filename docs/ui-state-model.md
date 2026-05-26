# UI State Model

## Purpose

Unit control and camera control are core game feel. They need a stronger contract than
"whatever the current input handlers do." This document defines the local UI state
model for tactical play so selection, targeting, command defaults, reticles, and
camera motion stay predictable as the game grows.

The UI state model is client-local. It may choose what to highlight, what a click
means, and where the camera points. It must not become gameplay authority.

## Authority Boundary

Authoritative gameplay changes still follow the normal command path:

```text
DOM input -> local UI state -> command intent -> scheduler/DO -> tick batch -> sim
```

Local UI state may store:

- selected unit handles
- selected planet handle
- hovered or keyboard-cycled scene target
- active pointer gesture
- camera mode, preset, pan offset, zoom, and focus tween
- command history, panels, dialogs, and HUD snapshots

Local UI state must not store future-affecting gameplay truth. Snapshots, hashes,
and replays exclude selection, camera, UI panels, hover state, and particles.

## State Layers

The tactical UI has four layers. Keeping them distinct prevents input bugs from
turning into command bugs.

| Layer | Owns | Examples |
|---|---|---|
| Sim view | Read-only projected game state | units, planets, owners, health, orders |
| Interaction state | Local input interpretation | selection, hover target, cycled target, drag mode |
| Command resolver | Default action from state | move, escort, attack, guard, capture |
| Presentation state | Feedback and camera | reticles, rings, panels, camera tween |

The command resolver should be a pure function over sim view plus interaction
state. Reticle text and click behavior should ask the same resolver.

## Top-Level Input States

Only one top-level pointer state is active at a time.

| State | Entered By | Updates | Exit |
|---|---|---|---|
| `idle` | no active pointer | hover target, Tab cycle target | pointer down or modal opens |
| `selectClickCandidate` | left down on canvas | drag distance, target snapshot | click resolves target or drag starts |
| `boxSelecting` | left drag beyond threshold | selection rectangle | pointer up selects owned units |
| `orbitLaneDragging` | left down on planet with selected units, then drag | orbit lane preview | pointer up emits orbit order |
| `cameraPanning` | pan gesture | camera pan offset | pointer up |
| `cameraRotating` | rotate gesture | yaw, pitch, preset clear | pointer up |
| `modal` | pause/hotkeys/match end | dialog focus only | close dialog |

Pointer capture belongs to the active gesture. A gesture must clean up capture,
hover overrides, selection box, and drag preview on pointer up or cancel.

## Scene Target Model

Scene picking produces one primary target:

```ts
type SceneTarget =
  | { kind: "friendlyUnit"; key: string }
  | { kind: "enemyUnit"; key: string }
  | { kind: "planet"; key: string };
```

Priority matters when targets overlap. Units win over planets so a ship near or
over a planet can still be targeted. Within units, use deterministic ranking by
kind, screen score, screen distance, handle id, and key. Tab cycles through the
same target list as hover so keyboard and pointer targeting do not disagree.

Invariant: only one hover/cycle indicator is visible at a time. If the active
target is a unit, no planet hover ring is shown. If the active target is a
planet, no unit reticle is shown.

## Contextual Command Resolver

The default click action comes from target kind plus current command context.

Command context:

```ts
type CommandContext =
  | { kind: "empty" }
  | { kind: "unitsSelected"; unitKeys: readonly string[] };
```

Default action table:

| Context | Target | Default Action |
|---|---|---|
| empty | empty space | none |
| empty | friendly unit | select |
| empty | enemy unit | target/inspect |
| empty | planet | select/inspect |
| units selected | empty space | move |
| units selected | friendly unit | escort, if at least one selected unit can escort it |
| units selected | enemy unit | attack |
| units selected | owned planet | guard |
| units selected | neutral or enemy planet | capture |

Orbit is intentionally not the default click action. Orbit requires click-drag on
a planet to create an unambiguous lane preview. Releasing a real orbit drag emits
an orbit order with the selected lane. A plain click on a planet emits guard or
capture when units are selected.

Selection modifiers override command defaults only for friendly units:

- plain click: replace/select, unless the resolver has a single command action
- Shift-click: add friendly unit to selection
- Ctrl-click: remove friendly unit from selection
- drag box: select owned units only

The resolver should return both an action kind and a short label. The same result
drives click behavior, reticle copy, and future controller hints.

## Reticle And Target Feedback

Friendly and enemy units use the same reticle component. The color comes from the
target unit owner. The label comes from the contextual action:

- `SELECT Scout 100%`
- `ESCORT Battleship 100%`
- `ATTACK Drop ship 100%`
- `TARGET Drop ship 100%`

Planet feedback uses a planet ring and label. The label should surface owner,
capture state, and distance from selected units. If planet clicks would issue a
command, the label or nearby affordance should make the pending action obvious:
`CAPTURE`, `GUARD`, or `SELECT`.

Reticles are predictive UI, not confirmation. Command history and selected-unit
objective panels show what was actually submitted or what the sim is currently
executing.

## Autonomy Feedback

Fleet autonomy is allowed to help the player only through normal command
provenance. The UI should read order source from sim view models and avoid
inventing a separate local "AI is doing this" state.

Useful labels and states:

- `Player order`: the unit is executing a recent manual command.
- `Autonomous`: the unit is following a helper-issued command.
- `System`: the unit is following setup or spawn behavior, such as initial
  escorting.
- `Idle`: the unit has no active or queued order.

Autonomy feedback should be calm and tactical:

- Selected-unit details may show the active order source and age.
- Command history may separate manual commands from autonomous commands.
- If a player submits a command while autonomy would also command the unit in
  the same tick, the player command is the one to present as active.
- A manual command should visibly reset the grace window so the player
  understands the unit will not immediately be taken back over.
- Autonomy hints should not obscure target reticles, command buttons, selected
  unit health, or contested-planet state.

This feedback is explanatory only. It does not decide whether autonomy can issue
commands; the deterministic controller decides that from snapshotted order
metadata.

## Camera State Model

Camera state is local presentation state:

```ts
type CameraState = {
  mode: "tactical" | "strategic";
  preset: "top" | "left" | "iso" | null;
  yaw: number;
  pitch: number;
  viewHeightByMode: Record<string, number>;
  focusSubject: CameraFocusSubject;
  panOffset: Vec3;
  focusTween: CameraFocusTween;
  zoomTween: CameraZoomTween;
};
```

Focus subjects:

- game centroid
- selected units centroid
- selected planet
- zoom-to-fit centroid
- future follow entity/fleet

Manual pan is an additive offset over the current focus subject. When the focus
subject changes, the camera should start its next tween from the current panned
visual center, then clear the pan offset. This avoids the bad path where
deselecting snaps back to a previously selected unit or planet before easing to
the game centroid.

Camera rules:

- Wheel zoom never changes sim state.
- Pan/rotate cancels active camera zoom tweens.
- Manual rotate clears camera preset.
- Selection changes may update focus, but should not erase the user's current
  visual center with a snap.
- `Fit`, `F`, and `Z` with no selection are explicit world recentering commands.
- Camera animation should be interruptible; new input wins.

## Menus And Hotkeys

Menus should expose commands that are still meaningful as explicit commands. If
the resolver makes one action the obvious click default, avoid duplicating it as
a stale menu button unless the button provides a different explicit workflow.

Required hotkey behavior:

- `Tab`: cycle nearby targetable entities from the same candidate list as hover
- `Shift+Tab`: cycle backward
- `D`: clear selection and return camera focus through the normal focus model
- `Z`: zoom to current selection; with no selection, fit the world center
- `F`: fit the world center
- `1`, `8`, `9`, `0`: deterministic owned-unit selection shortcuts
- `Space`: restore previous command group

Hotkeys should be documented in the pause dialog and in this model when they
change command semantics.

## Testing Expectations

The UI model should be tested at three levels:

- Pure resolver tests for target/context/action tables.
- Input gesture tests for click, drag, cancel, and overlap priority.
- Browser smoke checks for reticle labels, target colors, command history, and
  camera transitions.

Important scenarios:

- enemy unit overlapping planet resolves to attack, not planet command
- friendly unit with selected units resolves to escort
- selected units clicking owned planet resolves to guard
- selected units clicking neutral/enemy planet resolves to capture
- click-drag on planet resolves to orbit lane only after real drag
- only one hover indicator is visible
- Tab cycles unit and planet targets in deterministic order
- deselect after pan eases from current view to centroid without snapping through
  the old selection

## Implementation Notes

The current tactical view lives mostly in `packages/client/src/render/minimalGame.ts`.
As the interaction model grows, move pure pieces out of the mount loop:

```text
packages/client/src/selection/
  interactions.ts       scene target ranking and cycling
  commands.ts           selected-unit command helpers
  targetActions.ts      pure contextual command resolver

packages/client/src/camera/
  config.ts             camera presets and limits
  state.ts              focus, pan, tween state transitions

packages/client/src/input/
  tacticalState.ts      pointer/keyboard gesture state machine
```

The long-term goal is that the render mount loop wires systems together, while
target resolution and camera focus behavior are small pure functions with tests.
