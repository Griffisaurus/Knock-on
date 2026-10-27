# M5 plan: Future Tech, polish, beta

Started 2026-10-25.
- **Scope:** [PRODUCTION.md §2 M5](../PRODUCTION.md).
- **Decisions:** D102–D106 (provisional kickoff calls) in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md).
- **Previous milestone:** [M4_STATUS.md](M4_STATUS.md).
- **Working model:** the same as [M4_PLAN.md](M4_PLAN.md). Its rules 1–13 carry over.

**Scope:**
- **The 11 Ship = M5 parts:** RIFT GATES, GRAV WELL, TRACTOR BEAM, HOVER PAD, FORCE WALL, COILGUN RING, STASIS FIELD, BUZZ BEACON, SINGULARITY, GRABBER and GOO VAT.
- **Critter:** BUZZ.
- **Environments:** ORBITAL HANGAR and MOON BASE.
- Tier tuning, polish and the beta.

**Exit:** a feature-complete sandbox beta, with all docs current.

## Running alongside: the water-buoyancy session (D101)

A separate session is fixing Matter buoyancy. It edits `packages/matter/**` (solver, GPU, WGSL), `packages/sim/src/matter/**`, SIMULATION §8 and the M4_STATUS known limits, and it re-runs the Sandstorm vendor matrix.

**Held until it lands:**
- the **X5 Matter stream**: goo, Matter gravity per world and per zone, and GOO VAT's sim;
- **tier tuning** (T5): it needs a quiet GPU;
- doc edits to SIMULATION §8.

**Until then:**
- **No Matter files:** no stream touches `packages/matter/**` or `packages/sim/src/matter/**`.
- **No Matter-on hashes:** no stream pins a Matter-on hash.
- **Decision numbers:** D101 is the water session's.

## Rules

M4_PLAN's rules 1–13 carry over:
1. **Shared files:** Edit tool only.
2. **Other streams' failures:** report them; don't fix them.
3. **No `dist/` and no `:8787` host.**
4. **Project rules:** no git; nothing from the 1993 game; no realistic firearms; the determinism lint.
5. **Notes** go in `docs/dev/M5_NOTES_<stream>.md`.
6. **No sub-agents.**
7. **Measure, don't estimate.**
8. **Hidden bodies are never pushed.**
9. **No downloads.**
10. **Private ports.**
11. **The GPU is shared:** timings are provisional.
12. **Append-only wire tables.**
13. **Goldens:** re-pin only for your own stream.

Plus two new rules:

14. **Rollback-safe state changes.** Anything Jolt's saved state doesn't record must be re-derived in an `afterRestore` from plain state, and covered by a rollback test across the switch. That means object layers, gravity factors, motion types and constraint enables. This is the Bandit-steal lesson (M3).
15. **Beta definition of done.** Every feature follows PRODUCTION §7 and ENGINEERING §10. It must:
    - work solo and in two-player multiplayer;
    - be accessible (captions, keyboard, contrast);
    - show in the debug perf readout if it costs anything;
    - have HOW_TO_PLAY updated if a player can see it.

| Stream | Vite | Host |
|---|---|---|
| A5 | 5301 | 8901 |
| B5 | 5302 | 8902 |
| W5 | 5303 | 8903 |
| R5 | 5304 | 8904 |
| F5 | 5305 | 8905 |
| U5 | 5306 | 8906 |
| D5 | 5307 | 8907 |
| X5 (held) | 5308 | 8908 |

The art streams E5a, E5b and E5c use Blender only.

## Streams and file ownership

| Stream | Owns | Shared (Edit tool only) |
|---|---|---|
| **A5 · Future Tech parts (sim)** | `packages/parts-data/src/defs_m5.ts`, `packages/sim/src/channels/m5*.ts`, M5 part tests | `machine.ts`, `packages/sim/src/index.ts`, `channels/index.ts`, `parts-data/src/{defs,cards,demos,index}.ts`, `catalog.ts` |
| **B5 · BUZZ (sim)** | `packages/sim/src/critters/m5.ts`, BUZZ tests, the critter soak additions | `parts-data/src/critters.ts` (append-only), `machine.ts`, `packages/format/**` (the `tagged` part flag) |
| **W5 · environments (integration)** | the Hangar and Moon wiring: `machine.ts` environment dispatch, environment physics defaults, `env.zones` (zero-g), the Moon's authored heightfield in the sim, `gfx/look/sets.ts` looks, `gfx/environment.ts` | `machine.ts`, `packages/format/**`, `packages/parts-data/src/presets.ts`, `ui/settingspanel.ts` (environment list), `audio/ambience.ts` (hook only) |
| **R5 · M5 rendering + render polish** | the vfx.md §7 effects (Singularity lensing, rift shimmer, stasis, tractor beam, hover pad, force wall, coilgun ripple, grav well distortion), `gfx/fx.ts` / `particles.ts` M5 kinds; plus the M4 render polish (below) | `renderer.ts`, `shaders.ts`, `glbmesh.ts`, `gfx/critters.ts`, `scene.ts`, `main.ts` render hooks |
| **F5 · audio** | `apps/game/src/audio/**`: the M5 parts, BUZZ, Hangar and Moon ambience (air 0 % means low-passed impacts and no reverb), and **offline audio for capture** (clips are silent today) | `capture/**` (C4's muxer: the audio track), `main.ts` audio hooks |
| **U5 · UI + beta polish** | `apps/game/src/ui/**`, `styles.css`, `index.html`, `docs/HOW_TO_PLAY.md`, `playtests/` (template + first entry) | `main.ts` UI hooks |
| **D5 · docs currency** | every doc in `docs/` except HOW_TO_PLAY (U5), `docs/dev/*_NOTES_*` (streams) and SIMULATION §8 (after the water fix) | — |
| **E5a · M5 part art** | `tools/blender/make_<M5 type>.py`, `assets/src/<family>/<M5 type>.blend` and their builds (GOO VAT art included) | `kn_tools/*` (additive), `artlist.ts` |
| **E5b · BUZZ art** | `tools/blender/make_buzz.py`, `assets/src/critters/buzz.blend`, its build | `kn_tools/*` (additive), `artlist.ts` |
| **E5c · environment art** | `tools/blender/env_hangar.py`, `env_moon.py`, `assets/src/env/{hangar,moon}/**`, `assets/build/env/{hangar,moon}/**`, the generated `packages/parts-data/src/env_{hangar,moon}.ts` | `kn_tools/*` (additive), `tools/assets.mjs` |
| **X5 · Matter M5 (held)** | goo, Matter gravity, and GOO VAT in sim, rendering and audio | `packages/matter/**`, `packages/sim/src/matter/**`, `gfx/matter/**` |
| **T5 · tier tuning (orchestrator, last)** | the per-tier budgets in GAME_SPEC §15 measured on a quiet GPU, the awake-body column, the 8M-grain 32 GB check | — |

## Contracts

1. **Fields act on rigid bodies only (D102).** GRAV WELL, TRACTOR BEAM, SINGULARITY, STASIS FIELD, RIFT GATES and COILGUN RING act on Jolt bodies, not Matter grains. GOO VAT is the only M5 part that touches grains (X5).
2. **Rollback-safe mechanisms (D103).**
   - FORCE WALL switches by object layer: its own static body moves between the static and ghost layers, re-derived in `afterRestore` from plain state.
   - STASIS uses ZONE's approach: zero velocity and cancel gravity every tick (`m3_field.ts`). It never switches motion type.
   - RIFT GATES teleport in stage 12, in part order (SIMULATION §5.12), with a cooldown per pair. A test covers rollback across a transit.
3. **BUZZ (B5) and BUZZ BEACON (A5).**
   - **Beacon:** a stateful part with a `call` Signal port. A5 builds the part; B5 builds the critter.
   - **Interface:** the beacon exposes its dock pose and a pending call; BUZZ reads them. Agree it in the notes (`M5_NOTES_A5.md` / `M5_NOTES_B5.md`).
   - **Tagging:** "tagged" objects carry a new `PartFlagBits.tagged` (B5, format). U5 adds the Build-mode toggle and the tag glyph.
4. **Environments (E5c → W5).** E5c writes `env_{hangar,moon}.ts` shaped like `env_tinker.ts`: colliders per preset, cameras, light rig, LUT and IBL names, zero-g zone boxes (Hangar), and the Moon's authored heightfield samples. W5 wires them:
   - **Sim:** `buildSet` with new physics materials `regolith` and `concrete`.
   - **World defaults:** Hangar 38 % gravity; Moon 16.5 % gravity and 0 % air.
   - **Zero-g zones:** `env.zones`, togglable but not movable.
   - **Rendering:** the looks.
   - **Matter gravity:** W5 doesn't touch it. Grains following world gravity is X5's (D104).
5. **Events.** New `EventKind`s are appended at the end, and each stream lists its own in its notes for F5, R5 and U5 (captions).
6. **M4 render polish (R5):**
   - water casts shadows;
   - DUSTY's LED face animates its icons (`.art.json faceTracks`);
   - TOAST CANNON's `toast_cannon__slices` node hides after launch;
   - non-1-scale instances lose their dark patches;
   - Kitchen wet-darkening comes from a wetness mask driven by Matter water;
   - GUTTER in play uses its texture set.

   Any item that would touch Matter rendering internals (`gfx/matter/**`) waits for the water fix.

## Order

1. **Start now:** A5, B5, W5, R5, F5, U5, D5, E5a, E5b, E5c.
2. **When the water session lands:** X5 starts, D5 updates SIMULATION §8, and the D91 matrix is re-checked.
3. **Last:** T5 tier tuning, the release checks, and the M5 status doc.
