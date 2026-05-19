# Art Direction

## Purpose

Space should feel readable, massive, and hostile without making Phase 1 simulation unpredictable. Art direction supports orientation, scale, tactical readability, and spectacle; it does not add hidden gameplay systems.

## Map orientation

- Each map has one sun as the main visual orienting device.
- The sun sits in the background or far distance.
- The sun does not affect gameplay in Phase 1.
- Some maps can stage it visually closer, others farther, but it remains non-interactive.
- Lighting, silhouettes, lens response, and color temperature should use the sun to help players understand facing and map direction.

## Render modes and asset scalability

- Render mode should be selectable per entity or entity class, not only as a global renderer switch.
- Each important entity should be able to choose between cinematic shaders/assets and cheaper interactive shaders/assets based on device class, camera distance, gameplay readability, and performance budget.
- Asset swaps can include shader variants, geometry LOD, impostors, particle proxies, texture sets, glow/atmosphere layers, animation detail, and UI-style tactical icons.
- Low-end and battery-constrained devices should get intentionally authored playable representations, not merely degraded high-end assets.
- High-cost visual features should be optional layers on the entity, so interactive modes can remove them while cinematic modes keep them for screenshots, trailers, close camera work, and high-end hardware.
- Swapping render modes or assets must not change simulation state, collision, targeting, selection, or command readability.
- The same entity should preserve its tactical identity across all representations through silhouette, faction color, scale cues, and motion language.

## Dust and debris

- Volumetric dust and debris vary by map.
- Low-detail dust fields should be broadly deterministic from map seed, enough for players to share the same tactical readability.
- FirstPerson/cockpit dust detail can be more presentational and does not need exact particle-level determinism.
- Dust should support scattering, occlusion, and depth cues without hiding critical RTS information.

## Scale language

### Planetary

- Planets, moons, and very large bodies.
- Only this tier creates gravity wells.
- Atmospheric scattering and horizon glow sell scale.
- Landing and surface approach are out of scope.
- If a ship or megastructure is caught in a gravity well and de-orbits, the result is a large cinematic explosion, not a landing sequence.

### Megastructure

- Stations, rings, docks, wrecks, gates, and carved asteroids.
- Megastructures should be porous: tunnels, ribs, arches, hangars, cylinders, gaps, and negative space.
- Examples: cylindrical stations with open cores; asteroids with arching features; skeletal docks ships can pass around or through.
- Porosity is a visual and navigational identity, but collision should stay simple and readable.

### Ship / Humanoid

- Ships, drones, missiles, turrets, cargo pods, and other small tactical objects.
- Lowest LOD can collapse these objects into particle systems, impostors, or icon-like glints.
- Silhouette and faction readability matter more than surface detail at tactical zoom.

## Mass and gravity

- Asteroids, ships, megastructures, and some weapons have mass for inertia, collision, thrust limits, and impact feel.
- Mass does not imply gravity.
- Gravity is reserved for Planetary scale objects to keep movement predictable.
- Massive weapons do not cause recoil, spin, or torque on ships in Phase 1.

## Scattering

- Ships need atmospheric-style scattering and rim response so they read against space, dust, and sun glare.
- Volumetric dust should scatter light from the sun and large explosions.
- Scattering is primarily visual. It must not become a hidden gameplay fog system unless explicitly promoted later.

## Explosions

- De-orbiting into a planetary gravity well should be rare and spectacular.
- Megastructure or capital-scale destruction should use layered debris, light bloom, shock glow, and dust illumination.
- Visual debris can be rich; sim debris remains bounded by the 1,000-entity Phase 1 budget.

## Phase 1 boundaries

- No landing.
- No planetary surface gameplay.
- No sun gameplay effects.
- No ship recoil from massive weapons.
- No non-planetary gravity.
- No particle-level determinism requirement for cockpit dust.
- No visual effect may obscure command readability for long.
