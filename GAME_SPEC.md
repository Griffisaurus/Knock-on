# KNOCK-ON: Game Spec v0.3 (Sandbox + 2-player co-op)

*Every action has an overreaction.*
Working title. A WebGPU-native 3D chain-reaction sandbox that starts from **The Incredible Machine** (Dynamix, 1993) and jumps 30 years ahead.
Status: design spec, with as-built notes · last updated 2026-10-25 (M5 docs pass)

> **Changed since v0.1:** gameplay physics moved from 2D to **full 3D** (Jolt, deterministic, multithreaded). Worlds now scale to **1 km-wide "Megastructure" builds**, budgeted for a **16 GB VRAM** reference GPU. New UI, palette and art direction (no more EGA heritage). Every part, character, channel and mode has an original name. A new deterministic **GPU Matter layer** (sand, water, marbles at million scale) is added as a high-risk feature behind a technical spike. The parts catalogue grew from 87 to ~115.
>
> **Development docs:** full engineering, art and production documentation lives in [docs/README.md](docs/README.md).
>
> **Changed in v0.3:** **2-player co-op** (§17.5, [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md), [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)). Player manual added ([docs/HOW_TO_PLAY.md](docs/HOW_TO_PLAY.md)). Key-binding conflicts resolved (roll = Y, ping = G, chat = /, Perf HUD = F9, keyboard part-cycling = [ / ]). Art style samples are in `art/style-samples/`. M1 now includes multiplayer.
>
> **Look and feel pivot (2026-10-24, [D77–D79](docs/dev/DECISIONS_2026-10-24.md)):** a frosted-glass **"Glass Lab" UI** (§9), tactile textured part materials and **"science class maximalism"** with a new default environment for Desk and Room, **THE TINKER LAB** (§10), and a warm cinematic renderer look (§14). Parts keep their shapes, ports and gameplay. It landed in M3 (§21).
>
> **As built (M5 docs pass, 2026-10-25):** M0–M5 are built on Chrome: the M5 beta adds the Future Tech parts, GOO VAT and goo, BUZZ, the Orbital Hangar and Moon Base, global wind and world-following Matter gravity ([docs/dev/M5_STATUS.md](docs/dev/M5_STATUS.md), [M5_PLAN.md](docs/dev/M5_PLAN.md)). Designed features that aren't built are post-beta ([D107](docs/dev/DECISIONS_2026-10-24.md)). This spec is the design; where the shipped code differs, a short **As built** note says so and points at the doc that describes the code. The biggest differences: rendering, Spectacle and the Matter GPU backend run on the **main thread** (no GPU worker); there's no ECS library or UI framework (§18); bake-ahead keyframes live in the sim worker's memory, not VRAM (§6.5); a **32 GB tier** exists (D85: 8M grains, 2M parts); and the tested determinism matrix is Chrome + Node on one NVIDIA GPU plus SwiftShader (D51, D91).

---

## 0. TL;DR

- **What it is:** a browser sandbox for building absurd 3D chain-reaction machines. You place parts, wire them, hit **LET IT RIP** and watch the cascade. Hit Stop and everything resets perfectly.
- **Scale:** from a desk-sized gadget up to a **1,024 × 256 × 1,024 m Megastructure** holding **1 million parts**, on a 10 cm 3D build grid. Megastructures need the 16 GB tier; smaller worlds scale down to 4 GB GPUs.
- **Physics:** full 3D, **deterministic across machines** (Jolt Physics WASM, multithreaded; the same hashes in Chrome and Node at any thread count, D99). Real constraints: gears that transmit torque, pulleys, rails, pistons, buoyant balloons and ragdolling critters. When a machine gets too big for real time, the sim **slows down instead of getting sloppy** ("time dilation"). It also **bakes ahead** of playback, so playback stays smooth anyway.
- **GPU goes brrr in two layers:**
  - **Matter** (gameplay, deterministic): millions of sand grains, water particles and marbles. These run in fixed-point integer maths on the GPU, so the result is identical on every GPU (proven so far on the D91 matrix: NVIDIA D3D12, D3D11, SwiftShader and the CPU reference; real AMD, Intel and Apple runs are open).
  - **Spectacle** (cosmetic, free-running): 16M+ particles, volumetric fire and smoke, fracture debris, shockwaves and SDF global illumination. It never changes the outcome.
- **Parts:** ~115 across 11 families, all talking through **12 channels** (Impact, Signal, Spin, Tension, Power, Light, Heat, Air, Fluid, Sound, Lure, Field). Any emitter works with any receiver.
- **Look:** "Lab Toy Futurism" in a world of **science class maximalism**. Designer-toy industrial design with tactile, textured surfaces (hardwood grain, enamel-painted steel with worn edges, brass, cast iron, print), see-through polycarbonate with visible mechanisms, and colour-coded **port rings** with status LEDs as the shared visual language. Machines are built in a warm, busy, lived-in tinkering classroom (THE TINKER LAB) under golden-hour light. Frosted-glass **"Glass Lab" UI** with Ignition-orange actions, falling back to solid Graphite.
- **Together:** 2-player co-op. A small loopback-only Host Server coordinates two local browser clients. Determinism means no physics is streamed, only edits and run controls (< 10 KB/s).
- **Art:** every model is built to spec in Blender (§19). CC0 is only for HDRIs, base textures and raw sound. Look-dev renders are in `art/style-samples/`: the Tinker Lab key art (`tools/blender/render_tinker_lab.py`), warm 3D part icons (`tools/blender/render_thumbs.py`) and the lineup studies (`tools/blender/style_samples.py`).

---

## 1. Vision and pillars

> "Drop a ball into a funnel. It spins a turbine, which powers a laser, which cuts a rope, which drops a raccoon onto a pedal rig, which cranks a fabricator that spits out 2,000 marbles into a valley full of powder kegs. Then watch it from a drone cam at 0.2× while my GPU fans scream."

| # | Pillar | In practice |
|---|---|---|
| 1 | **Overreaction is the point** | Small inputs, huge cascades. Every part is a little drama with a clear cause and a big effect. |
| 2 | **Readable in 3D** | However big the machine, you can always see *why*: channel overlays, cutaways, cause tracing and the Cascade Report. |
| 3 | **Same machine, same result** | Deterministic simulation. A shared machine *is* its replay. |
| 4 | **Scale with your hardware** | A bigger GPU means bigger worlds, more matter and more spectacle. Gameplay rules are identical on every tier. Only capacity changes. |
| 5 | **Systemic, not scripted** | 12 shared channels. New parts combine with old ones without special cases. |
| 6 | **Builder-first UX** | Placing things in 3D should feel as fast as placing them in 2D did in 1993. |

---

## 2. Design decision: why full 3D now

v0.1 used 2D gameplay physics for three reasons:

1. 2D engines make cross-browser determinism easier.
2. A single plane is easy to read and easy to build on with a mouse.
3. It was faithful to the original.

Since we're no longer recreating the original, reason 3 is gone. Reasons 1 and 2 can be solved:

| v0.1 concern | How 3D solves it |
|---|---|
| Determinism | **Jolt Physics** supports cross-platform determinism (`JPH_CROSS_PLATFORM_DETERMINISTIC`) and stays deterministic regardless of thread count. We prove it with a hash matrix (§6.3). *As built:* the published `jolt-physics` 1.1.1 WASM build (single- and multithreaded) is used as is; WASM-to-WASM determinism holds without the flag, which only matters for a future native build (M0_STATUS known gap 1, D99). |
| Building with a mouse | **Work planes** (§7.1). Build on the floor, on any surface, or on a vertical "wall plane", which is the old 2D experience, now one option among several. Plus magnetic port snapping and path tools. |
| Readability | Auto-cutaway, X-ray channel overlays, section boxes, isolate mode, and a director camera that understands causality (§7.5, §8). |
| Cost | Multithreaded sim workers, aggressive sleeping, time dilation and bake-ahead playback (§6.5). |

What 3D unlocks: real gear trains and bevel gears, spiral tubes, rails that loop and corkscrew, machines that wrap around rooms and terrain, critters that ragdoll, soft-body balloons, true volumetric explosions, fluids that pool, and camera shots worth sharing.

---

## 3. Lineage: what we take from the 1993 game, and how we evolve it

The original was studied from the zip in this folder. Decoded data is in `reference/tim1/` and the formats are in Appendix A. **It is a reference, not a template.**

| The 1993 idea | KNOCK-ON evolution |
|---|---|
| Parts bin + drag onto a side-view board | 3D library + hotbar dock, magnetic snapping, work planes |
| Build ↔ Run with perfect reset | Same, plus pause, step, speed, **rewind scrubber**, bake-ahead, time dilation |
| ~45 everyday parts with simple rules | ~115 parts, 12 systemic channels, analog + electric + future tech |
| Cat, mouse, fish, monkey characters | An original cast (Mochi, Pip, Goby, Bandit, Biscuit, Henny, Dusty, Buzz) with ragdolls and emotes |
| Gravity and air-pressure sliders | Kept, because they're great levers. Plus environment presets and per-zone fields |
| 8 px snap grid | 10 cm 3D grid with adaptive coarse snaps for huge worlds |
| Freeform mode | *Is* the game (sandbox). Puzzle mode comes later; the data model reserves goals |
| Jukebox hotkeys | A dynamic soundtrack, plus musical parts that play in key |

---

## 4. Core loop and modes

```
        ┌────────────────── BUILD ──────────────────┐            ┌──────────────── RUN ────────────────┐
 open → place · snap · draw paths · wire · tweak ·    LET IT RIP  bake-ahead sim · director cam ·       STOP → perfect
 world  modules · undo · test-run a selection      ───────────▶  pause/step/speed/rewind · ride-cam   ──────▶ reset
        └────────────────────────────────────────────┘            └──────────────────────────────────────┘
                       ▲                                                        │
                       └────────── iterate (ghost trails, Cascade Report) ◀─────┘
```

### 4.1 Build
- Place parts from the parts tray or Library. They snap to ports, then surfaces, then the grid (§7.2).
- **Path tools:** draw splines for Lines, Bands, Fuses, Glidepaths, Tubes, cables, and Topple-tile and Brik brushes.
- **Ghost trails** from the last run show where everything went.
- **Test-run selection** (Ctrl+Enter) runs only the selected subassembly for 5 s, a fast inner loop for tuning one gadget inside a megastructure.
- **Modules:** save any selection as a reusable module (prefab) and share it.
- Undo/redo (500 steps, transactional), multi-select, copy/paste, mirror (X/Y/Z), array duplicate, groups, layers and lock.

### 4.2 Run
- **LET IT RIP** snapshots the build state and starts the sim at tick 0. **Stop** restores the snapshot exactly.
- Pause · step (1 tick / 10 ticks) · speed 0.1×–4× · **rewind scrubber** (§6.5).
- **Time dilation indicator:** shows sim speed vs real time ("SIM 0.42×") whenever the machine outgrows real time.
- **Bake & Watch:** for megastructures, pre-simulate the whole run (or the next N seconds) into the keyframe store, then play back smoothly at any speed and camera.
- **Poke mode** (toggle): grab, fling and nudge bodies during a run. Pokes are recorded to the input log, so replays stay deterministic.
- When the run ends (everything asleep for 3 s, or Stop), the **Cascade Report** opens (§6.8).

---

## 5. World scale and limits ("as big as is realistic")

### 5.1 What actually limits world size
In a browser on a 16 GB GPU, **empty space is nearly free**. All world structures are sparse. The real limits are:

1. **Awake simulation load:** how many bodies are moving at once. This is CPU-bound and handled by time dilation (§6.5).
2. **Placed-part count:** CPU memory for physics bodies, GPU instance data and save-file size.
3. **Float precision:** Jolt single precision is comfortable within about 1 km of the origin. At 1,024 m, float32 spacing is ~0.12 mm, two orders of magnitude below Jolt's contact tolerances. Beyond that we'd need Jolt's double-precision build, which is slower. Not worth it.
4. **Human scale:** a ball crossing 1 km takes minutes. Past this point, bigger stops being more fun.
5. **Browser limits:** WebGPU doesn't report VRAM. Per-buffer limits are typically 1–4 GiB. WASM32 memory is 4 GiB. The browser may kill a tab that over-allocates ("device lost").

So the ceiling is a **1 km class world with 1 M parts**, and we budget VRAM to fill it (§15).

### 5.2 Grid
- **Build grid: 1 cell = 10 cm in all three axes.** Fine snap: 2.5 cm (hold Shift). Free placement (hold Alt) is quantized to 1/64 cell on save.
- **Adaptive coarse snap:** the snap step grows with camera distance (10 cm → 50 cm → 1 m → 5 m) so megastructure blocking is fast. The current step is always shown on the cursor.
- **Coordinates:** world origin at the centre of the floor. +Y up, right-handed. Rendering is camera-relative, so precision holds everywhere.

### 5.3 World presets

| Preset | Size (m, W × H × D) | Size (cells) | Placed-part cap | Awake bodies at 1× * | Min tier |
|---|---|---|---|---|---|
| **Desk** | 4 × 3 × 3 | 40 × 30 × 30 | 2,000 | all | 4 GB |
| **Room** (default) | 16 × 8 × 16 | 160 × 80 × 160 | 20,000 | ~14k (dense pile ~6k) | 4 GB |
| **Warehouse** | 64 × 24 × 64 | 640 × 240 × 640 | 100,000 | ~14k (dense pile ~6k) | 8 GB |
| **Arena** | 256 × 64 × 256 | 2,560 × 640 × 2,560 | 400,000 | ~14k (dense pile ~6k) | 12 GB |
| **Megastructure** | 1,024 × 256 × 1,024 | 10,240 × 2,560 × 10,240 | **1,000,000** | ~14k (dense pile ~6k), then time dilation | **16 GB** |

\* The real-time ceiling at 1× is the awake count where a tick reaches the 7.5 ms budget ([docs/SIMULATION.md §12](docs/SIMULATION.md); 120 Hz is 8.33 ms), on any preset. Beyond it the machine still runs correctly, just slower, and bake-ahead hides it. It depends on the CPU's Jolt threads (D99), not the GPU tier. *Measured (M5 T5, multithreaded Jolt, Core Ultra 9 285K, [M5_NOTES_T5](docs/dev/M5_NOTES_T5.md)):*
- **Chain reaction** (an unbroken domino wave): ≈ 14k–15k awake at 8–12 threads; ≈ 13k at 5; ≈ 11k at 4; ≈ 7k at 2; ≈ 1.6k on the single-threaded fallback.
- **Dense pile** (every body in one contact island): ≈ 6k at 8–12 threads; ≈ 5.2k at 5; ≈ 3.9k at 2.
- Past 5–6 threads it flattens. The table's figure is for 8+ Jolt threads; per-tier values are in §15.2.
- Kiloton (3,917 parts, a 424-charge blast) runs 2.3–2.7 ms per tick, its blast second at or just over 7.5 ms (M4), and Domino Day (102,560 parts) 1.5–1.6 ms per tick, both in real time.
- M0 estimated 10k on 8 cores.

*As built:* the preset caps are in `packages/parts-data/src/presets.ts` (`cap`, `minTier`). The Megastructure preset caps at 1M parts; the 32 GB tier's 2M (§15.2) is a tier capacity (`TIER_CAPS`, `packages/format/src/matter.ts`).

Placed parts that aren't moving are cheap: sleeping bodies, merged static compounds per 32 m chunk, and GPU-culled instances. A megastructure is typically 99 % asleep at any moment.

### 5.4 Physics constants (per world, editable)

| Setting | Range | Default | Notes |
|---|---|---|---|
| Gravity | 0–300 % | 100 % = 9.81 m/s² | Presets: Earth, Moon (16.5 %), Mars (38 %), Zero-G, Heavy (200 %) |
| Air density | 0–300 % | 100 % | Drives drag, Helio lift, Gale/Puffer strength and blast propagation. Helios use **toy helium**: a constant lift of 4.9 N × air % at the body centre (≈ 0.5 kg at Earth gravity), so one Helio slowly lifts an empty Scoop (0.45 kg) |
| Wind | 0–15 m/s + direction | 0 | A global air flow added to every Air calculation (SIMULATION §5.8); its force scales with Air density. Backlot weather presets set it (Breezy 3 m/s, Gusty 6 m/s gusting to 10, with seeded, deterministic gusts; environments brief §4.5). *As built (M5, D26):* `env.wind {speed, dir, gusts}`, Settings › World › Weather (Calm, Breezy, Gusty, Overcast); it pushes rigid bodies only, not Matter grains (D110), and does nothing at air 0 % |
| Feel | Real / Floaty / Snappy | Real | Floaty = 70 % g plus 1.3× air; Snappy = 130 % g plus extra restitution on Rollers |
| Tick rate | 120 Hz (60 Hz option) | 120 | Fixed per machine, saved in the file |
| Zones | Gravity, Antigrav, Wind, Stasis volumes | — | Placeable Field parts (§12.10: ZONE, M3). Environment zero-g zones (Orbital Hangar) are world data, `env.zones`, togglable but not movable (M5), acting on rigid bodies and Matter grains |

---

## 6. Simulation architecture

### 6.1 Three layers

| | **Rigid** (gameplay) | **Matter** (gameplay) | **Spectacle** (cosmetic) |
|---|---|---|---|
| Runs on | CPU: WASM threads (Jolt) | GPU: WebGPU compute | GPU: WebGPU compute |
| Determinism | Bit-exact cross-platform | Bit-exact: **integer fixed-point only** | Not required |
| Contents | Parts, critters, constraints, ropes, vehicles, power and signal graphs, light rays, explosions, macro fracture | Sand, water, mass marbles (M4); goo / slime with GOO VAT (M5, D109). Up to 4M grains at 16 GB, 8M at 32 GB (§15.2) | Sparks, smoke, fire volumes, micro debris, decals, confetti, splashes, GI |
| Rate | 120 Hz fixed | Every 2nd rigid tick (60 Hz on 120 Hz machines) | Per frame |
| Feeds | Matter + Spectacle | Rigid (fixed latency) + Spectacle | Nothing (read-only) |

**Hard rule:** Spectacle never writes into gameplay. A Powder Keg's 16 macro chunks (12 staves, 2 hoops, 2 lids) are Rigid bodies. Its splinters and up to 24k sparks (16 GB tier, `fx/boom_keg` in [docs/art/briefs/vfx.md](docs/art/briefs/vfx.md)) are Spectacle.

### 6.2 Rigid layer: Jolt Physics
- **Engine:** Jolt Physics through JoltPhysics.js, pinned, WASM threads via SharedArrayBuffer. *As built:* the published `jolt-physics` 1.1.1 build (single-threaded, and the multithreaded build from M4, D99), not a custom build; the M0 matrix passed, so the Rapier3D fallback wasn't needed. `JPH_CROSS_PLATFORM_DETERMINISTIC` is off in the published build; WASM-to-WASM determinism doesn't need it (M0_STATUS).
- Jolt features we lean on:
  - Hinge, Slider, Fixed, Point, Distance, Cone, SwingTwist and SixDOF constraints
  - **GearConstraint** (Cogs with real torque transfer and stalls) and **RackAndPinionConstraint**
  - **PulleyConstraint** (Sheaves)
  - **PathConstraint** (Glidepath rails). *As built:* a rail follower of our own in stage 6 (`packages/sim/src/channels/glidepath.ts`); the JS bindings can't build a Hermite path.
  - **Soft bodies with pressure** (Helio balloons that squish and pop) and soft-body ropes and cloth. *As built:* none. HELIO is a rigid body with toy-helium lift (D52), and Lines are distance or pulley constraints (SIMULATION §5.4).
  - **WheeledVehicle** (Zippy: a `VehicleConstraint` with a wheeled controller, M4)
  - **Ragdolls** (critters on big hits)
  - Sensors, broadphase queries and raycasts
- **Breakable joints:** Brik walls are individual bricks held by fixed constraints with a break impulse ("mortar"), which gives deterministic structural collapse.

### 6.3 Determinism rules (lint- and CI-enforced)
1. Jolt runs multithreaded, but **all gameplay logic runs single-threaded in a fixed order**. Contact callbacks from Jolt's worker threads are buffered, then sorted by (bodyA, bodyB, subShape) before behaviours see them.
2. No `Math.random`, wall-clock time or `Math.sin/cos/tan/atan2/exp/pow/log` in sim code. Use `detmath` (polynomials over `+ − × ÷ sqrt`, which IEEE-754 guarantees) and a seeded xoshiro128** PRNG.
3. Stable part-ID ordering for creation, iteration and event processing.
4. Machine data is quantized to integers (1/64 cell positions, smallest-three quaternions).
5. **Capacity never changes outcomes.** Every tier runs identical rules. A machine that exceeds a tier's capacity (e.g. 3M grains on an 8 GB GPU) refuses to run with "Needs 16 GB tier"; it never runs differently.
6. `simVersion` is pinned per machine. Legacy sim bundles load lazily for old machines.
7. **CI matrix:** ~60 golden machines on Chrome (x64) and headless Node (the same WASM), on every GPU vendor we can get (Matter layer). Chrome first (D51): Firefox, Safari and ARM are best-effort until after beta. Each run hashes state every 60 ticks and must match exactly. *As built:* per-part and per-milestone goldens run in Vitest on Node (`packages/sim/test/goldens*.test.ts`); the threaded hash matrix (1, 4 and 12 threads, Node and Chrome, all Library demos) is J4's (D99); the Matter matrix is `tools/vendor-matrix` (D91). There's no hosted CI runner; the release checks in each milestone status doc are run by hand.

### 6.4 Matter layer: deterministic GPU granular and fluid sim (high risk, spike in M0)
GPU floating-point maths isn't guaranteed bit-identical across vendors, but **integer maths is**: WGSL defines wrapping two's-complement `i32`/`u32` arithmetic and exact shifts. Integer `atomicAdd` gives the same result in any thread order. So:
- **State:** positions and velocities in fixed point (1 unit = 1/65,536 m, range ±32 km), as `i32×3` plus a material ID. No floats anywhere in matter kernels.
- **Neighbours:** a spatial hash built by a **stable radix sort** on (cell key, particle ID), which is deterministic regardless of scheduling.
- **Solver:** Jacobi position-based dynamics (density constraint for fluid, contact and friction for grains, cohesion for slime). Corrections accumulate with integer atomics, so order doesn't matter. Integer square root by Newton iteration.
- **Coupling with Rigid:**
  - Each matter tick N reads a quantized snapshot of nearby rigid colliders (spheres, boxes, capsules, convex planes) from rigid tick 2N − 4.
  - Matter → rigid forces are summed per body with `atomicAdd` into an impulse buffer that is read back and applied at rigid tick 2N + 4.
  - That **fixed latency** makes the result independent of GPU speed. If a readback is late, the rigid sim waits (time dilation) rather than diverging.
- **Budget:** 8M grains on the 32 GB tier (D85), 4M on 16 GB, 2M at 12 GB, 1M at 8 GB, 250k at 4 GB (`TIER_CAPS`, `packages/format/src/matter.ts`). A world records its grains (`counts.grains`) and the tier it needs (`requiredTier`). *Measured (M4):* 1M grains fit the 60 Hz budget (11.4 ms per Matter tick); 4M run time-dilated (Sandstorm 0.33–0.8× real time), as D92 allows. The 8M check at 32 GB is part of M5 tier tuning (T5, [M5_STATUS](docs/dev/M5_STATUS.md)).
- **Rendering:** water as a screen-space fluid surface or GPU marching cubes; sand as instanced grains with SDF-AO; slime as metaball surface. *As built:* sand and marble impostors and SSFR water (M4); goo (M5) through the same screen-space fluid surface with a translucent green `kn_slime` composite, not metaballs (RENDERING §0).
- **Fallback if the spike fails:** Matter becomes Spectacle-only, and gameplay fluid falls back to v0.1's deterministic "stream packets" on the CPU (≤ 256 packets). *Not needed:* the spike passed (M0) and Matter shipped as gameplay in M4.
- *As built:* 4 substeps × 3 Jacobi iterations per 60 Hz tick, a hashed grid per kind, an atomic count sort on the GPU and a radix sort in the CPU reference (the same order: SIMULATION §8.2). Matter runs on the renderer's GPU device, commanded by the sim worker (D92); Node and small worlds use the bit-identical CPU reference. Floating comes from a water-surface map and Jolt's buoyancy, not from particle pressure (D101, SIMULATION §8.6). M5 fields act on rigid bodies only (D102). Grains follow the world's gravity % and the Hangar's zero-g zones and settle on the Moon's regolith (D104, D110: `G = 192 + 2,624 × p` in Q8, Earth bit-identical to M4), but feel no wind and no air % (D110). Goo (kind 3) is a cohesive, viscous spring fluid that sticks to bodies and isn't buoyant (D109). The D91 matrix was re-run on the final M5 kernels: PASS ([M5_SANDSTORM_MATRIX](docs/dev/M5_SANDSTORM_MATRIX.md)).

### 6.5 Time dilation, bake-ahead and rewind
- The sim never drops accuracy to keep up. If a tick costs more than real time, the **sim clock runs slower** and the UI shows the dilation factor.
- **Bake-ahead:** the sim runs as fast as it can into a **keyframe store**, plus events. Playback reads from that store, so it's smooth at any camera and speed even if the sim is slower than real time. *As built:* the store is the sim worker's BakeStore in CPU memory (`apps/game/src/bakestore.ts`), not VRAM: a keyframe every 4 ticks (30 Hz), holding only the bodies that moved (f32 position + snorm16 quaternion, 20 B each), with 3 minutes of scrubbable history; over budget the oldest keyframes fold into the base. Live runs bake up to 4 s ahead; Bake & Watch bakes the whole run first.
- **Rewind:** full rigid checkpoints every 0.5 s (60 ticks, compressed, CPU RAM) and Matter checkpoints every 2 s (240 ticks). Scrubbing within the baked range reads keyframes; a poke behind the bake head restores the nearest checkpoint and re-simulates forward. *As built:* Matter snapshots are held by the main thread's Matter host (byte budget 1 GB), and the playback replica replays Matter commands to the playhead (`apps/game/src/matterhost.ts`).

### 6.6 Channels

| Channel | Glyph | Resolved by | Examples |
|---|---|---|---|
| **Impact** | ✸ | Rigid contacts and impulses | Anything → Fulcrum, Stomp Pad, Topple Tiles, Pane |
| **Signal** | ◆ | Discrete pulses over wires (or wireless Ping); sensors fire on thresholds | Stomp Pad, The Button, Tripwire, Ringer → Punchline, Flap, Bangstick |
| **Spin** | ⟳ | Jolt gear, belt and shaft constraints with real torque | Motor, Turbine, Hamster Drive → Treadway, Cog, Dynamo |
| **Tension** | ∿ | Jolt pulley, distance and soft-rope constraints | Helio lifts an empty Scoop; falling Thud pulls a trigger |
| **Power** | ⚡ | Circuit graph over cables; sources have a wattage budget, consumers draw it | Mains, Dynamo, Suncell, Cell → Motor, Lamp, Arc Tower |
| **Light** | ☀ | 3D raycasts: reflect, refract, split, focus | Torch, Lance → Mirror, Burning Glass, Suncell, Tripwire |
| **Heat** | 🔥 | Ignition points + per-part heat accumulation | Wick, Fuse, focused light, Flamer, arcs → fuses, wood, ice, Helio |
| **Air** | ≋ | 3D wind volumes, force ∝ air density × exposed area | Gale, Puffer, Blowout, blasts → Helio, Turbine, light Rollers |
| **Fluid** | 💧 | Matter layer | Tank, Grit Hopper → Waterwheel, Scoop, Sponge, Wick (douse) |
| **Sound** | ♪ | Event radius check with occlusion ray | Ringer, Ding, explosions, Biscuit's bark → critters startle |
| **Lure** | ◎ | Attractor fields for critter AI | Snack, mouse hole, shiny things → critters |
| **Field** | ⊛ | Force volumes (magnetic, gravity, tractor, stasis) | Maglock, Grav Well, Tractor Beam, Singularity |

### 6.7 Explosions (deterministic)
For yield Y at point P:
- **Impulse** = `K·Y / max(r, r₀)^1.5` along (body − P), scaled by **exposure**, the fraction of 9 rays from P to the body's bounds that aren't blocked.
- **Damage** to breakables = `D·Y/r²`. Lines snap, Helios pop and Brik mortar breaks.
- **Sympathetic detonation:** explosives within 0.6 × radius go off after a delay of `2 + ⌊4r/R⌋` ticks.
- At most 32 detonations resolve per tick; the rest queue in ID order.
- Matter in the radius gets a radial integer impulse field (sand craters, water blasts).

### 6.8 Events, causality and the Cascade Report
- The sim emits typed events (`Impact`, `Signal`, `Ignite`, `Detonate`, `Pop`, `Break`, `Cut`, `Powered`, `Lit`, `Splash`, `Note`, `CritterState`...) with tick, position, magnitude and `causeId`.
- Renderer, audio, Spectacle, director cam and analytics all consume one event stream.
- **Cascade Report** (end of run): a causal graph of the run. It highlights the longest chain as an animated flow you can click to jump the replay. It shows the **K.O. Count** (number of distinct knock-on steps), channels used, parts used, peak simultaneous events and the biggest boom, plus a playful **Overreaction Score**. The report is shareable as a card image.

---

## 7. Build UX in 3D

Building in 3D is the biggest design risk in this spec. It gets a paper prototype in week 1 and a greybox prototype in M0, with weekly playtests.

*As built (through M5):* placing from the tray and Library onto surfaces with grid snapping (placement doesn't snap to ports), rotation keys, the Path tool (TUBEs) and the Wire tool (cables, FUSEs, LINEs and BANDs between ports), the outliner with layers and groups, modules, the section box, cutaway and X-ray, Terrain on the Backlot, full keyboard building and, in M5, sizing handles for resizable volumes, pair chips and auto-pairing for RIFT GATES and BUZZ, the GRABBER zone tool and the Tagged-for-BUZZ switch are in. For the beta (D117), **drag-to-move** and the **transform gizmo** are in too.
- **Drag-to-move:** Select tool, drag a part or the selection. It uses placement's ghosts, grid snap, resting surface and blocked test. Shift moves vertically, Alt is free, and Ctrl + wheel raises the work plane mid-drag.
- **The gizmo:** arrows, plane squares, rings with 15° steps (Shift 5°, Alt free, as rule 4 of §7.2), and corner cubes on resizable volumes. **A** toggles it.
- Both land as one undoable op and sync like any edit.

In the beta polish (D123–D124), the rest of the select-and-edit set is in:
- **Box select:** Select tool, drag on empty space; Shift adds, Ctrl toggles; locked and hidden parts are skipped.
- **Copy / paste / duplicate:** Ctrl+C / Ctrl+V (a carried drag ghost, click drops) / Ctrl+D (next to the original, selected). Links among the copied parts come along, pairs re-pair as new pairs, one op each, and the clipboard crosses worlds in a session.
- **Mirroring keys** (rule 4's Alt+X / Y / Z): across the selection's centre; a part becomes its own mirror image when its shape has a mirror plane, otherwise it keeps its turn and is named.
- **Rule 1, port snapping:** placing, dragging and pasting snap a port onto a compatible port within 0.5 cells, face to face; compatible ports glow; Alt or a Controls setting turns it off. The gizmo stays grid-only.
- **The gizmo** gains a world / local axis toggle (X).

Not built, post-beta (D107; the player list is HOW_TO_PLAY §13): the Brush and Measure tools, wall and surface work planes, Isolate, Test-run selection and the History panel.

### 7.1 Work planes
- **Floor plane** (default): place on the ground or on top of anything.
- **Wall plane** (W): a vertical plane facing the camera. This is the classic side-view building mode, great for a long chain along one wall.
- **Surface plane** (Shift+W, then click a face): aligns the work plane to any surface, including sloped ones.
- Raise and lower the plane with the mouse wheel while holding Ctrl (in grid steps). The current plane's height is shown as a thin glowing slab.

### 7.2 Snapping priority
1. **Ports:** magnetic within 0.5 cells. Compatible ports glow in their channel colour, and incompatible ones grey out. Example: dragging a Tube end near another Tube end snaps and welds them.
2. **Surfaces:** a part's base aligns to the face normal under the cursor (toggle off with N).
3. **Grid:** the work plane grid, with an adaptive step.
4. **Rotation:** R/T/Y rotate +15° around the yaw/pitch/roll axes (Shift+R/T/Y = the other way). When rotating with the mouse (gizmo rings or click-drag), Shift = 5° steps and Alt = free. Alt+X/Y/Z mirror.

### 7.3 Tools

| Tool | Key | Notes |
|---|---|---|
| Place | (from the parts tray) | Ghost preview, red if blocked, footprint shadow on the floor |
| Select / Move | V | Compact gizmo (move, rotate, scale for resizable parts), box select, "select connected" (double-click) |
| **Path** | P | Draws splines on surfaces or in the air with height handles. Used by Line, Band, Fuse, Glidepath, Tube, Gutter and cables. Handles are editable afterwards. |
| **Brush** | B | Brik walls (auto bond pattern), Topple Tiles (spacing, curve-follow), Stackers, Pins |
| **Wire** | E | Drag from port to port for Signal and Power. Wires route along surfaces automatically. |
| **Terrain** | — | Backlot only: raise, lower, flatten, smooth (heightfield, 0.5 m) |
| Measure | M | Distances, heights, drop-time preview |

### 7.4 Organisation
**Outliner** (tree of groups, modules and layers) · **layers** with visibility and lock · named **bookmarks** for camera positions · **search** parts in the scene by type or name.

### 7.5 Seeing inside 3D machines
- **Auto-cutaway:** geometry between the camera and the cursor or selection fades out with a dither.
- **Section box:** clip the world to a box to work inside dense areas.
- **Isolate** (I): show only the selection and its direct connections.
- **X-ray overlay** (hold Tab): art dims, and channels draw as coloured flows with glyphs: torque arrows on Spin, tension colour on Lines, power current, light rays, wind volumes, fuse paths, lure fields and trigger zones.

---

## 8. Cameras

| Camera | Use |
|---|---|
| **Orbit** (default, Build) | Right-drag orbits, middle-drag pans, wheel zooms, F focuses the selection |
| **Fly** | Hold right mouse + WASD/QE (Unreal-style), with speed scaling by world size |
| **Ortho views** | Numpad 1/3/7 = front/side/top orthographic. Front ortho on a wall plane is the 1993 look. |
| **Director** (Run) | Picks shots from the event stream by energy, novelty and causal-chain head. It cuts between them across megastructures, dollies in on detonations, and holds on critter moments. Never more than one cut per 1.2 s. |
| **Ride-cam** | Attach the camera to any body (first-person on a Thud rolling through the machine). Stabilised horizon option. |
| **Drone** | Free cinematic camera during Bake & Watch playback, with recordable keyframed paths |
| **Photo mode** | Paused; depth of field, exposure, LUTs, hide UI, 8K capture |
| **Overview** | Live map of the whole machine with event heat, showing where the action is in a 1 km build. Click to jump there. |

Picture-in-picture (up to 2): when two branches fire at once, the director can split the screen.

*As built (through M5):* Orbit, Director, Ride-cam and Overview (C cycles them; `apps/game/src/cameras.ts`) and Photo mode (F10, up to 8K, M4 capture). Fly, the ortho views, the Drone with keyframed paths and picture-in-picture aren't built.

---

## 9. UI and visual design system

### 9.1 Principles
**Glass Lab** ([D77](docs/dev/DECISIONS_2026-10-24.md)): dark frosted-glass panels float over the viewport and let the warm, busy world show through. Content-forward, minimal chrome. Panels appear when needed and get out of the way during a run. Keyboard-first with a command palette. Tactile micro-interactions, and every UI sound is designed. Parts appear as **3D renders** everywhere in the UI; line icons are for actions and tools.

### 9.2 Palette: "Glass Lab" over "Graphite Lab"
Panels are frosted glass (tokens below). The Graphite neutrals are the **solid fallback**: Settings › Accessibility › **Reduce transparency**, the 4 GB tier, or a UI over its frame budget swaps every glass surface for them ([docs/UI_UX.md §2, §8](docs/UI_UX.md)).

**Glass**

| Token | Value | Use |
|---|---|---|
| `glass-tint` | `rgb(16 19 26 / .64)` on text-bearing surfaces ([D80](docs/dev/DECISIONS_2026-10-24.md)); `.58` only on viewport chrome with no small text (the view rail) | Panel fill |
| `glass-well` | `rgb(16 19 26 / .72)` | Raised well behind small text (< 14 px) over the viewport |
| `glass-blur` | `blur(22px) saturate(1.4)` | Backdrop filter (≤ 24 px) |
| `glass-highlight` | 1 px inner top line, `rgb(255 255 255 / .16)` | Top edge of every glass surface |
| `glass-edge` | 1 px outer line, `rgb(255 255 255 / .07)` | Panel border (replaces the `steel` border on glass) |
| `glass-shadow` | soft drop shadow | Lifts panels off the world |

*Accent contrast is measured on the solid panel surfaces. Primary buttons use dark text on Ignition (6.3:1). Text on glass follows the legibility guard in UI_UX §2.*

**Neutrals** (the solid fallback; `void`, `fog` and `paper` are used on glass too)

| Token | Hex | Use |
|---|---|---|
| `void` | `#0B0D12` | App background, viewport letterbox |
| `graphite` | `#12151C` | Panels (solid fallback) |
| `slate` | `#1B1F29` | Raised surfaces, cards (solid fallback) |
| `steel` | `#2A303D` | Borders, dividers |
| `fog` | `#8A93A6` | Secondary text (8.0:1 on void) |
| `paper` | `#EEF1F6` | Primary text (16:1 on graphite) |

**Brand accents**

| Token | Hex | Use |
|---|---|---|
| `ignition` | `#FF5B2E` | Primary action: **LET IT RIP**, record, destructive confirm |
| `volt` | `#C6FF3A` | Success, "powered", positive state |
| `beam` | `#2FD6FF` | Selection, focus rings, Build-mode grid lines |
| `plasma` | `#FF3DAE` | Special and future-tech highlights |
| `amber` | `#FFB020` | Warnings, time-dilation badge |
| `danger` | `#FF4D5E` | Errors, invalid placement |

**Channel colours** (always paired with a glyph; never colour alone)

| Channel | Hex | | Channel | Hex |
|---|---|---|---|---|
| Impact ✸ | `#F2F4F8` | | Heat 🔥 | `#FF5B2E` |
| Signal ◆ | `#FFC21A` | | Air ≋ | `#9BE7D8` |
| Spin ⟳ | `#A78BFA` | | Fluid 💧 | `#4C8DFF` |
| Tension ∿ | `#E0A96D` | | Sound ♪ | `#F472B6` |
| Power ⚡ | `#C6FF3A` | | Lure ◎ | `#34D399` |
| Light ☀ | `#FFF1A8` | | Field ⊛ | `#FF3DAE` |

There's an alternate colour-blind set for X-ray (deuteranopia/protanopia/tritanopia presets), and glyph shapes carry the meaning regardless.

### 9.3 Type (all SIL OFL)
- **Display:** *Unbounded* (logo, mode titles, the Cascade Report)
- **UI:** *Inter* (labels, body, inspector)
- **Numeric:** *JetBrains Mono* (timers, coordinates, K.O. Count)

### 9.4 Shape and motion
- **16 px radius on panels, 10 px on controls** ([D77](docs/dev/DECISIONS_2026-10-24.md)). Glass surfaces get the 1 px `glass-edge` border and `glass-highlight` top line; the solid fallback uses 1 px `steel` borders. Soft inner highlight on hover, `beam` 2 px focus ring.
- Iconography: custom 24 px line set, 1.75 px stroke, rounded caps, for actions and tools. Channel glyphs are filled. **Parts are always 3D renders** (dock tray, Library, Inspector header, palette results), made by the thumbnail rig with its warm Tinker Lab light ([docs/art/briefs/ui_icons.md §6](docs/art/briefs/ui_icons.md#6-library-card-thumbnail-rig)).
- Motion: 120–200 ms ease-out for UI, springs for drawers. All of it respects reduced motion. No glass surface animates its size during a run.

### 9.5 Layout (desktop 16:9)
Glass panels float over a full-bleed viewport ([D77](docs/dev/DECISIONS_2026-10-24.md)). No screen shows more than **6 glass surfaces** (UI_UX §8). Visual reference: the approved [KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4) (Build HUD, Library, Command palette + radial, Run HUD, Cascade Report, Lobby).
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ╭────────────────────────────────╮    ╭────────────────────────────────────────────────────╮ │
│ │ Mochi's Breakfast Run        ✎ │    │ ● Sam 9 ms │ BUILD│RUN │ Save │ Share │ Ctrl K │ ☰ │ │  ← world card · session bar
│ │ Roll THUD down the slope...    │    ╰────────────────────────────────────────────────────╯ │
│ │ saved · ↶ ↷ · Earth · Air 100% │                           ╭─────────────────────────────╮ │
│ ╰────────────────────────────────╯                           │ [3D] SLOPE · Ramp    pin ✕  │ │  ← Inspector (docked glass)
│ ╭───╮                                                        │ ▾ Properties                │ │
│ │ ⟲ │  orbit                                                 │   Angle    ━━━━━●━━━   30°  │ │
│ │ ✥ │  pan                                                   │ ▸ Skin                      │ │
│ │ ⌕ │  zoom                       3D VIEWPORT                │ ▾ Transform                 │ │
│ ├───┤                (the warm, busy world shows through)    │   Snap to grid       ━━○    │ │
│ │ ◉ │  normal                                                │   Lock part          ○━━    │ │
│ │ ◎ │  x-ray                                                 ╰─────────────────────────────╯ │
│ │ ◫ │  section                                                                               │
│ │ ☰ │  outliner                                                                              │
│ ╰───╯ ← view rail                                                                            │
│                      ╭──────────────────────────────────────────────────────────────╮        │
│                      │ ↺ Reset   ◀◀   (( ▶ LET IT RIP ))   ▶▶   0.1 .25 .5 [1×] 2 4 │        │  ← transport pill
│                      ╰──────────────────────────────────────────────────────────────╯        │
│ ╭──────────────────────────────────────────────────────────────────────────────────────────╮ │
│ │ All parts · Rollers · Frame · Drive · Air · Power · … · Modules · ★ │ ⌕ search │ L       │ │  ← parts tray
│ │ [1 ][2 ][3 ][4 ][5 ][6 ][7 ][8 ][9 ][0 ] │ [  ][  ][  ][  ][  ][  ][  ][  ][  ][  ] ›    │ │    (big 3D part icons; 1–0 = hotbar)
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
RUN HUD (4 glass surfaces): partner/camera pill top left · K.O. counter top centre · event feed top right
  (toasts with 3D part icons) · run bar at the bottom:
  ▕ 6.45 s ━━━●━━━◆━━✸━━━ event markers · bake head  12.0 s ▏
  ▕ ◀◀ (❚❚) ▶▶ │ 0.1 .25 .5 [1×] 2 4 │ SIM 0.42× Bake & Watch │ [Director] Orbit Ride Drone Overview │ ■ Stop ▏
```
- **World card** (top left): the world title (inline rename), its one-line blurb, the save state, undo/redo and the environment chip (gravity and air at a glance; click opens Env). The Outliner opens below it as part of the same surface.
- **Session bar** (top right): the partner chip (MP: name, connection), the **BUILD │ RUN** mode switch, **Save**, **Share**, **Ctrl K** (command palette) and the menu (☰).
- **View rail** (left): Orbit, Pan and Zoom, then the view modes Normal / X-ray / Section, then the Outliner toggle.
- **Parts tray** (bottom) merges the old dock and a compact Library row: family tabs (All parts, the families, Modules, Favourites), search, and one row of large **3D part icons**. The first ten tiles are the hotbar (keys 1–0; drag a part onto a tile to assign it). L opens the full **Library** (glass overlay) with family tabs, search, filters by channel, favourites, recent and modules. Cards show the 3D render, which becomes a live turntable on hover, the name, a type tag and channel chips.
- **Transport pill** (centred above the tray): Reset, step back, the big round **LET IT RIP** button (80 px, Ignition) and step forward, plus the sim-speed segment.
- **Run HUD:** the Build panels give way to four surfaces: a partner / camera pill, the **K.O.** counter, one event feed (toasts with 3D part icons) and the run bar (timeline with event markers and bake head; back, pause, forward, speed, SIM badge with Bake & Watch, camera switcher, Stop).
- **Selected state** (tabs, segments, chosen options): a blue gradient `#3373D0` → `#2A66C4` (the top stop darkened from the mockups' `#3E86E6` for 4.5:1, [D86](docs/dev/DECISIONS_2026-10-24.md)). The primary action stays Ignition orange.
- **Part card** (hover): a 3 s looping demo rendered by the engine, plain-English "Needs / Does", properties and channel ports.
- **Inspector:** docked right as a glass panel when something is selected: a 3D render header with name, tag, pin and delete, then collapsible sections (Properties, Skin, Transform, Connections, Layer) with sliders and toggles. Multi-select edits shared properties.
- **Command palette** (Ctrl/⌘K): every action and part, searchable; part results show their 3D icon.
- **Radial menu** (hold Q or right-click and hold): glass wedges for mirror, rotate, duplicate, connect, isolate, lock, group, delete.
- **Toasts** for events ("POWDER KEG ×6 detonated"), collected in the event feed during a run.
- **Clear world** (Bomb icon, in the menu): asks for confirmation, then every part detonates in a staggered wave. Undoable, and the best button in the game.
- **Not adopted from the reference:** goals, a part budget and a Build → Test → Success strip belong to the challenge mode, which stays post-beta (§22). The file format already reserves goals.

### 9.6 Responsiveness
Desktop-first (mouse and keyboard). Gamepad and touch builds are post-v1; the component system and input map are designed so they can be added.

---

## 10. Art direction: "Lab Toy Futurism" in a science-class world

Parts keep their shapes, ports and gameplay. Their **surfaces**, the world around them, the light and the UI follow the look and feel pivot ([D77–D79](docs/dev/DECISIONS_2026-10-24.md)). Full rules: [docs/art/ART_BIBLE.md](docs/art/ART_BIBLE.md).

### 10.1 Look
- **Designer-toy industrial design:** soft-rounded primary forms, crisp chamfers, satisfying proportions. Think premium consumer hardware crossed with a toy shop.
- **Tactile materials, "loved, not grimy"** ([D78](docs/dev/DECISIONS_2026-10-24.md)): rich, texture-driven surfaces in the brand colours. Hardwood with visible grain and end grain, enamel-painted steel with soft worn edges, cast iron, brass and copper with patina in recesses, rope and cotton cord, printed paper and card, rubber with moulding marks, anodised aluminium, glass, and **translucent polycarbonate shells that show the mechanisms inside** (you can see a Motor's armature spinning and a Dynamo's coils glowing). Each part has its own texture set layered over the shared masters (§19.7). Wear shows on edges, handles and contact points as worn paint and polish. No rust, dirt or grunge.
- **Science class maximalism:** machines are built in a warm, busy, lived-in tinkering classroom. **Density zoning** keeps the machine readable: the build zone stays clean and level, a clutter ring 0.5–3 m out is maximal, and the far background is busy but soft (haze, depth of field), about one stop darker and less saturated than the build zone, so parts and port rings always read first.
- **Golden-hour light:** a warm sun key through tall windows (≈ 3,500 K), cool sky fill, practical pendant lamps with bloom, and light shafts on the 12 GB and 16 GB tiers. The renderer adds a gentle tilt-shift depth of field and a warm grade (§14).
- **Port rings:** every connection point is the same machined collar with an LED ring in its channel colour. **Off** = dim, **active** = lit and pulsing with flow. This is the single most important readability device in the game.
- **Status LEDs and screens:** parts show state physically. A Ringer has a 7-segment countdown, a Cell has a charge bar, and a Bangstick's fuse burns visibly.
- **Pyro and slapstick stay cartoon-real:** exaggerated fuse sparks, comic smoke rings, "K.O." stars on ragdolled critters.

### 10.2 Environments

| Environment | Scale | Notes |
|---|---|---|
| **The Tinker Lab** (default for Desk and Room) | Desk → Room | A science classroom and workshop: a long hardwood workbench with a gridded cutting mat (the Desk build zone), chalkboard and blueprint posters, shelves of books, beakers and jars, a globe, potted plants, pegboard tools, pendant lamps, tall windows with late-afternoon sun, and MOCHI asleep on the bench. Also the backdrop for the lobby and title. Shipped in M3. At real scale the Desk build zone is the bench's 2.3 × 0.82 m cutting mat ([D87](docs/dev/DECISIONS_2026-10-24.md), provisional); bigger machines use the Room preset or the Studio. |
| **The Studio** (default for Warehouse and Arena) | Desk → Arena | Infinite cyclorama with soft-box lighting and a subtle grid floor. The clean "product shot" option on every preset; machines are the hero. |
| **Mega Kitchen** | Room → Warehouse | Toy-scale machines in a giant kitchen with counters, sink and fridge as terrain. M3 maximalism pass: fridge magnets and drawings, cereal boxes, plants, utensils, a crayon drawing taped to a cabinet, window light shafts; same layout and colliders. **Fill the sink** (M4, [D98](docs/dev/DECISIONS_2026-10-24.md)): a world toggle that starts the run with 1,000,000 Matter water particles in the basin, the same on every machine; such a world requires the 16 GB tier |
| **Backlot** | Arena → Megastructure | Outdoor sculptable terrain, day/night, weather (its wind sets the Wind setting, §5.4, and drives Air) |
| **Orbital Hangar** | Warehouse → Arena | Low-gravity hangar (38 % g by default) with Earth through the window, zero-g zones (`env.zones`, togglable, not movable; they float rigid bodies and Matter grains). Two sets: "Bay 2" (Warehouse) and the "Main Hall" (Arena). *As built (M5):* Earth's lighting is baked with an art-directed 105° phase so the window shows a sunlit crescent, and Earth doesn't spin; the brief's 1°/min rotation is post-beta, since it needs runtime lighting ([D112](docs/dev/DECISIONS_2026-10-24.md)) |
| **Moon Base** | Room → Arena | 16.5 % g, no air (Helios sink, Gales do nothing, wind does nothing: a fun lesson). An authored regolith heightfield (not sculptable) around a concrete apron; new physics materials `regolith` and `concrete`. Matter grains fall at Moon gravity and settle on the regolith (D104, D110). Settings › World › "Base lights" switches the lander floods (cosmetic). Shipped in M5 |

---

## 11. Characters ("Critters")

Original cast. The roles are inspired by the 1993 trio-and-a-monkey, but they share no names, designs or likenesses. All are deterministic FSMs with seeded variety. They're physics bodies with Jolt ragdoll on hits above a threshold, then get up and shake it off. **Nobody gets hurt**: worst case is dizzy stars and an indignant emote.

| Critter | What | Inspired by | Behaviour |
|---|---|---|---|
| **Mochi** | Cat | Cat | Naps → spots Pip (vision cone, 8 m) or smells a snack → chases. Startles at loud Sound (arched-back jump). Flees Biscuit. Shoves light parts while walking. Can be caught by a Trap Box. |
| **Pip** | Hamster | Mouse | Wanders → runs to Lures (seeds, burrow) → flees Mochi. In a **Hamster Drive** it sleeps until the wheel is bumped, then sprints for 6 s (Spin source) and coasts for 1 s. |
| **Goby** | Goldfish | Fish | Lives in a Fishbowl. When the bowl breaks, it splashes out in a water burst (Matter water from M4; a cosmetic splash before that), flops for 8 s (a Lure for Mochi) and is then carried to safety by a little bubble effect. |
| **Bandit** | Raccoon | Monkey | Pedals the **Pedal Rig** when lured (shiny object) or startled. Off the rig, steals small shiny parts and carries them off. Chaos agent. |
| **Biscuit** | Dog | new | Sleeps → wakes on Sound → chases Mochi → barks (Sound pulse every 1.5 s). Heavy (12 kg), so he barges through. |
| **Henny** | Chicken | new | Startled → flaps up 1 m and lays a **Yolk** (fragile Roller). |
| **Dusty** | Robot vacuum | new (future) | Roams a bounded zone, bumps and pushes small things, and **sucks up Matter grains** (sand, marbles) into its bin, getting heavier. |
| **Buzz** | Courier drone | new (future) | On Signal, picks up the nearest tagged object (≤ 2 kg) and flies it to its paired beacon. Tumbles if hit. *As built (M5):* flies by a deterministic PD controller with its capsule's gravity off, docks on its BUZZ BEACON, and carries its load as a ghost body like Bandit's; "tagged" is a new part flag set in Build mode ([D105](docs/dev/DECISIONS_2026-10-24.md)). *Beta (D121):* a big boom nearby startles it for a moment (it keeps its load), and a heavy load makes it hover lower and climb slower. |

Each critter has 12+ animation states (§19.4), voice barks, a face rig for expressions, and an emote bubble that explains what it's doing ("👀 Pip!", "😾", "zzz").

---

## 12. Parts catalogue (~115)

Sizes are in cells (W × H × D, 10 cm). Class: S/M/L/XL (§19.6). **Ship** = milestone (§21). *Inspired by* names the 1993 part where there is one (for internal tracking only; never in player-facing text).

### 12.1 Rollers (balls and loose bodies)

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **THUD** | Heavy ball | Bowling ball | ⌀2.2 | Impact | 7 kg, e 0.12. Knocks everything over | S | M1 |
| **BOING** | Bouncy ball | Basketball | ⌀2.4 | Impact | 0.6 kg, e 0.82 | S | M1 |
| **STITCH** | Hard ball | Baseball | ⌀0.75 | Impact | 0.15 kg, e 0.5 | S | M2 |
| **FUZZ** | Fuzzy ball | Tennis ball | ⌀0.65 | Impact, Fluid | High friction; floats | S | M2 |
| **PIG IRON** | Iron ball | Cannonball | ⌀1.2 | Impact, Field | 6.5 kg, magnetic | S | M2 |
| **GLINT / BEARING** | Glass / steel marble | new | ⌀0.16 | Impact, Field (steel) | Rigid, or Matter grains in hoppers | S | M3 |
| **YOLK** | Egg | new | 0.45 × 0.6 | Impact | Breaks at 0.3 N·s with a splat decal | S | M4 |
| **HELIO** | Balloon | Balloon | ⌀2.5 (2.5 × 3 × 2.5 with knot and clip) | Air, Tension, Heat | Pressure soft body filled with toy helium (~0.5 kg of lift, §5.4): squishes, drifts, pops on sharp or hot contact or above 6 m/s. Skins: heart, pumpkin, star | M | M1 |

### 12.2 Frame (structure)

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **BRIK** | Brick, brush-laid | Brick wall | 2×1×1 (+half) | Impact | Each brick is a body; mortar = breakable joints; "Anchored" toggle | S | M1 |
| **PLANK** | Board / beam | Wood wall | 1×1×(2–40) | Impact, Heat | Burns, splinters | S | M1 |
| **SLOPE** | Ramp | Incline | 2–20 long × 2–8 wide | Impact | Any angle in 5° steps | S | M1 |
| **TUBE** | Clear tube: straight, elbow, tee, spiral, loop | Pipe | ⌀3 (bore 0.288 m, fits every Roller); `tube_slim` ⌀1.2 for marbles and small balls | Impact | Path-drawn; balls visible inside; reducer joins wide and slim | S | M1 |
| **GUTTER** | Open half-pipe | new | ⌀3 (`gutter_slim` ⌀1.2) | Impact | Path-drawn | S | M2 |
| **VORTEX** | Funnel | new | ⌀8 (`vortex_slim` ⌀4) | Impact | Spirals balls down to centre; outlet fits the matching tube | S | M2 |
| **LEDGE** | Shelf / platform | new | 2–20 × 2–20 | Impact | | S | M1 |
| **FULCRUM** | Seesaw | Teeter-totter | 6×1×2 | Impact, Tension | Hinge ±12° (the beam rests on its stops) | M | M1 |
| **SPRONG** | Trampoline | Trampoline | 3×0.5×3 | Impact | e 1.15, capped exit speed | M | M2 |
| **TRAP BOX** | Drop cage | Cage | 7×5×5 | Tension | Falls when its Line is released; traps any critter (interior ≈ 0.66 × 0.46 × 0.46 m: fits Biscuit standing and Dusty) | M | M2 |
| **SCOOP** | Bucket | Bucket | 2×2×2 | Tension, Fluid | Collects grains and water; gets heavy | S | M2 |
| **ANCHOR** | Hook point | Eye hook | 0.5 | Tension | | S | M1 |
| **SHEAVE** | Pulley | Pulley | ⌀1 (1 × 1.5 × 0.5 with mount) | Tension | Jolt pulley constraint | S | M1 |
| **FLAP** | Hinged door / trapdoor | new | 1–6 × 1–6 | Signal | Opens on Signal, or passive one-way | S | M2 |
| **GLIDEPATH** | Rail track (spline) | new | path | Impact, Spin | Carts and Bearings ride it (path constraint); booster segments | M | M3 |
| **SPINDECK** | Turntable | new | ⌀4 | Spin | | M | M3 |
| **LIFT** | Elevator platform | new | 3×0.5×3 deck, 1–40 travel (overall 3 × (travel + 1.2) × 4.5) | Power, Signal | | M | M3 |

### 12.3 Drive (motion and power transmission)

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **TREADWAY** | Conveyor | Conveyor belt | (2–40)×1×2 | Spin → Impact | Surface speed = ω·r | M | M1 |
| **BAND** | Drive belt | Belt | connector | Spin | Crossed option reverses direction | S | M1 |
| **LINE** | Rope (+ CHAIN, BUNGEE) | Rope | connector ≤ 50 m | Tension, Heat | Cut, burn or snap | S | M1 |
| **COG** | Gear S/M/L + bevel | Gear | ⌀1/2/3 | Spin | Real torque; bevel turns 90°; sharp teeth pop Helios | S | M1 |
| **RACK** | Rack & pinion | new | 2–20 long | Spin ↔ linear | | S | M3 |
| **MOTOR** | Electric motor | Electric motor | 2×2×2 | Power → Spin | 1.5 rev/s no-load, 30 N·m stall torque at full supply (120 W demand, ≈ 71 W peak shaft power); can stall (sparks) | M | M1 |
| **DYNAMO** | Generator | Generator | 3×2×2 | Spin → Power | Watts = min(300, 40·\|ω\|), never more than 60 % of the shaft power in: it brakes whatever drives it (no free energy) | L | M2 |
| **HAMSTER DRIVE** | Hamster wheel motor (Pip) | Mouse-cage motor | 3×3×2 | Impact → Spin | Pip sleeps until bumped, then sprints 6 s (wheel 5.0 rad/s, 40 N·m stall, ≈ 50 W peak shaft power) | L | M2 |
| **TURBINE** | Wind turbine | Windmill | 3×4×1 | Air → Spin | Pitched blades turn wind into torque. *Beta (D120):* global weather wind turns it too (forward on its face, backwards from behind), governed under 32 rad/s | M | M2 |
| **PEDAL RIG** | Raccoon pedal drive (Bandit) | Monkey bike | 4×4×2 | Lure, Sound → Spin (Tension bait hook) | 8 s per stimulus; crank 1 rev/s, flywheel and output 3 rev/s, 25 N·m stall (≈ 118 W peak shaft power) | XL | M2 |
| **RAM** | Piston | new | 1×1×(2–10) | Signal/Power → Impact | | M | M3 |
| **GRABBER** | Robot arm | new | 2×5×2 | Signal, Power | Picks from zone A, places at B (deterministic IK playback); draws 100 W. *Beta (D120):* its fingers really close on the payload; zone A pointed at a payload's top still grips it | L | M5 |

### 12.4 Air

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **GALE** | Fan | Fan | 2×2×1 | Power → Air | 3D cone, 6 m | M | M1 |
| **PUFFER** | Bellows | Bellows | 3×2×2 | Impact → Air | Puff ∝ press force | M | M2 |
| **BLOWOUT** | Hair dryer | new | 2×2×1 | Power → Air + Heat | | M | M4 |
| **VAC** | Suction nozzle | new | 1×1×3 | Power → Air (inward) | | M | M4 |
| **INFLATOR** | Helium tank | new | 2×3×2 | Signal → inflates a Helio | Over-inflation pops it | M | M4 |

### 12.5 Power and Signal

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **MAINS** | Power block + toggle | Outlet + switch | 2×2×1 | Impact/Signal → Power | | M | M1 |
| **CELL** | Battery | new | 1×2×1 | → Power | Capacity property | S | M2 |
| **SUNCELL** | Solar panel | Solar panel | 3×0.2×2 | Light → Power | | S | M2 |
| **LAMP** | Bulb | Light bulb | 1×2×1 | Power → Light | Real dynamic light | S | M2 |
| **TORCH** | Flashlight | Flashlight | 2×1×1 | Signal → Light (cone) | | S | M2 |
| **BURNING GLASS** | Magnifier | Magnifying glass | 1×3×1 | Light → Heat | Focal-length property | S | M2 |
| **LANCE** | Laser | new | 2×1×1 | Power → Light (beam) | With Burning Glass it becomes a cutting beam | S | M3 |
| **MIRROR / SPLITTER** | Mirror / prism | new | 1×2×0.2 / 1×1×1 | Light | | S | M3 |
| **TRIPWIRE** | Beam sensor | new | 1×1×1 | Light → Signal | On-break / on-lit | S | M3 |
| **STOMP PAD** | Pressure plate | new | 2×0.3×2 | Impact → Signal | Weight threshold | S | M1 |
| **THE BUTTON** | Big red button | new | 1×1×1 | Impact → Signal | | S | M1 |
| **TOGGLE** | Lever switch | new | 1×2×1 | Impact → Signal/Power | | S | M2 |
| **RINGER** | Alarm-clock timer | new | 1×1×1 | Time → Signal + Sound | 7-segment countdown, 1–30 s | M | M2 |
| **DELAY** | Signal delay box | new | 1×1×1 | Signal → Signal | 0.1–30 s | S | M2 |
| **PING** | Wireless Tx/Rx pair | new (future) | 1×1×1 | Signal | Paired by colour | S | M3 |
| **MAGLOCK** | Electromagnet | new | 2×2×2 | Power → Field (Tension eye) | Steel only; can hang from a Line as a crane magnet | M | M3 |
| **ARC TOWER** | Tesla coil | new | 2×5×2 | Power → Heat/Power arcs | Arcs to nearest metal within 2 m | L | M4 |

### 12.6 Fire and Boom

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **WICK** | Candle | Candle | 1×2×1 | Heat | Douse with Air or Fluid | M | M1 |
| **FUSE** | Drawable fuse | new | path | Heat | 0.2 m/s burn, branches | proc | M1 |
| **BANGSTICK** | Dynamite | Dynamite | 3×1×1 | Heat/Signal/Boom → Boom | Yield 1, fuse 0.5–5 s | M | M1 |
| **T-PLUNGER** | Detonator | Dynamite plunger | 2×3×2 | Impact → Signal | Wired to up to 64 explosives (broadcast Signal port) | M | M2 |
| **POWDER KEG** | Big barrel | new | 2×3×2 | → Boom | Yield 3, volumetric mushroom; cooks off after 1.5 s of continuous heat | M | M3 |
| **JITTERJUICE** | Nitro flask | new | 1×1.5×1 | Impact → Boom | Shock-sensitive: any knock ≥ 0.15 N·s sets it off; yield 1.5 | S | M3 |
| **SKYROCKET** | Rocket | Rocket | 1×3×1 | Heat → Thrust | 3D flight, fins, carries light loads | M | M2 |
| **SKYSHOW** | Firework battery | new | 3×2×3 | Heat → shells | 6 aerial bursts, pattern presets | M | M3 |
| **BIG TOP** | Circus cannon | Cannon | 6×4×4 | Heat → launch | **Variable-bore iris** closes around any loaded Roller (Yolk to Helio, Ø 0.045–0.25 m) or up to 12 marbles; heavier balls fly slower | L | M2 |
| **CORK BLASTER** | Cork pop-gun | Gun (replaced) | 3×1×1 | Signal/Tension → projectile | Its sharp cork pops Helios, presses Buttons, sets off Jitterjuice. *No realistic firearms: ratings- and brand-safe.* | M | M2 |
| **FLAMER** | Blowtorch | new | 3×1×1 | Signal (+ optional Power) → Heat beam | Gas-fed (Signal valve), 0.6 m flame; optional powered mode draws 80 W | M | M3 |
| **POPPER** | Confetti popper | new | 1×1.5×1 | Tension → Air puff | A short air puff plus confetti; not an explosive (no yield) | S | M3 |
| **SINGULARITY** | Micro black hole (finale) | new (future) | 2×2×2 | Signal → Field | Pulls everything within 20 m into a recycle core over 6 s; screen-space lensing | L | M5 |

### 12.7 Contraptions

| Name | What | Inspired by | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|---|
| **PUNCHLINE** | Spring boxing glove | Boxing glove | 3×2×2 (+5 reach) | Signal → Impact | | M | M2 |
| **GOTCHA BOX** | Pop-up clown box | Jack-in-the-box | 2×2×2 | Spin/Impact → Impact | | L | M2 |
| **SNIPPER** | Scissors | Scissors | 3×1×2 | Impact/Signal → Cut | Cuts Lines, Bands, Helios | M | M1 |
| **SNAPTRAP** | Mousetrap | new | 2×0.5×1 | Impact → Impact | Flings its payload | M | M3 |
| **BONKER** | Hinged mallet | new | 1×4×1 | Signal → Impact | | M | M3 |
| **FLINGER** | Catapult | new | 4×3×3 | Signal/Tension → launch | Angle 30–70° | M | M3 |
| **WRECKER** | Wrecking ball | new | ⌀2 + Line | Tension, Impact | 20 kg | M | M3 |
| **PINGER** | Spring plunger | new | 1×1×3 | Signal → Impact | | M | M3 |
| **PADDLE / BUMPER** | Pinball flipper / bumper | new | 3×1×1 / ⌀1.5 | Signal → Impact | | M/S | M3 |
| **TOAST CANNON** | Toaster | new | 2×2×1 | Power → launch | 3 s, then 2 slices | M | M4 |
| **FISHBOWL** | Goby's bowl | Fishbowl | 3×3×3 | Impact → Break + Fluid | Shatter + Matter water (before M4, or with Matter gameplay off: a cosmetic water burst and Goby's flop) | L | M2 |

### 12.8 Matter (Matter layer; see §6.4)

| Name | What | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|
| **GRIT HOPPER** | Sand dispenser | 3×4×3 | Signal → grains | 50k–1M grains | M | M4 |
| **HOURGLASS** | Sand timer | 1×2×1 | Time → Signal | Signals when the top bulb empties | S | M4 |
| **TANK** | Water tank + valve | 3×4×3 | Signal → Fluid | | M | M4 |
| **SPRINKLE CAN** | Watering can | 3×2×2 | Impact (tilt) → Fluid | | M | M4 |
| **WATERWHEEL** | | ⌀4 × 2 | Fluid → Spin | | M | M4 |
| **SPONGE** | | 2×1×1 | Fluid → mass | Up to 2 kg | S | M4 |
| **MARBLE HOPPER** | Mass marbles | 3×4×3 | Signal → grains | Up to 100k marbles | M | M4 |
| **GOO VAT** | Slime | 3×3×3 | Signal → Fluid (cohesive) | Sticky, slows Rollers. *As built:* 9 L of goo (4,230 particles), flow 0.1–1 L/s; goo holds together, flows like syrup, drips, drags on bodies and isn't buoyant ([D109](docs/dev/DECISIONS_2026-10-24.md)) | M | M5 |

### 12.9 Fun and sound

| Name | What | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|
| **TOPPLE TILES** | Dominoes, brush-laid | 0.3×1.5×0.75 each | Impact | Up to 100k per world (instanced, sleeping); giant and lead variants | S | M1 |
| **PINS** | Bowling pins (set of 10) | 0.5×1.5×0.5 | Impact | | S | M3 |
| **STACKERS** | Block tower | 1×0.3×3 | Impact | Jenga-style | S | M3 |
| **PANE / VASE** | Glass | 1×4×0.1 / 1×2×1 | Impact → Break | Hero shatter | S | M3 |
| **TONEBARS** | Xylophone / chimes, brush-laid in a scale | 1×0.5×3 per bar | Impact → Sound | Tuned to the world key | M | M3 |
| **DING** | Bell | 1×1×1 | Impact → Sound | Startles critters | S | M3 |
| **ZIPPY** | RC car | 2×1×1 | Signal → drive, Tension (tow) | Jolt vehicle; tows Lines | M | M4 |
| **QUACK** | Rubber duck | 1×1×1 | Fluid | Floats, squeaks. *As built:* a keel (its centre of mass 10 mm low, `PartDef.body.com`) makes it right itself from any landing (M5, [D111](docs/dev/DECISIONS_2026-10-24.md)) | S | M4 |

### 12.10 Future Tech

| Name | What | Size | Channels | Behaviour | Class | Ship |
|---|---|---|---|---|---|---|
| **FABRICATOR** | Spawner | 3×3×3 | Signal → spawns | Spits a chosen part every N s or per Signal (finite count) | L | M3 |
| **RECYCLER** | Sink | 3×2×3 | → Signal (count) | Despawns whatever enters; signals on count | M | M3 |
| **RIFT GATES** | Paired portals | 4×4×0.5 each | Impact | Teleports bodies, keeping relative momentum; opening ≥ 0.30 m passes every Roller; max 1 transit per 0.25 s per gate pair | L | M5 |
| **GRAV WELL** | Attractor/repulsor | 2×2×2 | Power → Field | | M | M5 |
| **TRACTOR BEAM** | Pull/hold beam | 1×1×3 | Power → Field | Pull mode reels bodies in; hold mode springs them to a point 0.5–3 m along the beam. *Beta (D121):* it can't reach a body behind something in its beam | M | M5 |
| **HOVER PAD** | Levitating platform | 3×0.5×3 | Power → Field | Dynamic platform held 0.5 m above its base by a spring-damper while powered; carries loads | M | M5 |
| **FORCE WALL** | Energy barrier | 1–10 × 1–10 × 0.5 | Signal | Solid while switched on by Signal | M | M5 |
| **COILGUN RING** | Accelerator ring | ⌀3 (3×3×1) | Power → Field | Boosts steel objects passing through | M | M5 |
| **STASIS FIELD** | Freeze volume | 1–10³ | Power → Field | Bodies inside freeze while powered | M | M5 |
| **ZONE** | Gravity / Antigrav / Wind / Stasis volume | 1–100³ | Field | Invisible-in-run volumes | proc | M3 |
| **BUZZ BEACON** | Courier drone dock and target | 2×0.4×2 | Signal | A Signal sends Buzz to fetch the nearest tagged object and deliver it here | S | M5 |

**Counts:** ~115 placeable items (including variants and the critters in §11). By Ship milestone: M1 25 · M2 29 · M3 30 · M4 15 · M5 11 catalogue rows, plus the critters (§21). All M1–M5 rows have shipped (the M5 rows in the beta: A5's ten Future Tech parts, X5's GOO VAT).

**M5 Future Tech as built ([D102](docs/dev/DECISIONS_2026-10-24.md), [D103](docs/dev/DECISIONS_2026-10-24.md); per-part numbers in SIMULATION §5.12 and [M5_NOTES_A5](docs/dev/M5_NOTES_A5.md)):** GRAV WELL, TRACTOR BEAM, SINGULARITY, STASIS FIELD, RIFT GATES and COILGUN RING act on rigid bodies only; grains respond only through contact (the Singularity despawns bodies, not grains). FORCE WALL switches its static body between the static and ghost object layers; STASIS FIELD zeroes velocity and cancels gravity every tick, like ZONE, and never changes a body's motion type. RIFT GATES teleport in stage 12 in part order, at most one transit per 0.25 s per pair (SIMULATION §5.12).

---

## 13. Spectacle systems ("make the GPU go brrrr")

All of these are GPU compute, cosmetic, scaled by tier, and spawned from the sim event stream.

| System | Approach | 16 GB tier budget |
|---|---|---|
| **Particles** | Pooled structure-of-arrays storage buffers (f16 packed). Emit → simulate (gravity, drag × air, curl noise, buoyancy, global-SDF collision) → compact (subgroup prefix sums where available) → indirect draw. Weighted blended OIT for most layers; bitonic sort for the hero smoke layer. | **16M live** (Unlimited Mayhem: device max) |
| **Volumetric fire and smoke** | Pooled 3D fluid grids (stable fluids, vorticity confinement, temperature/fuel/density), merged for chained blasts, raymarched at half res with temporal reprojection, blackbody emission + scattering from key and sky lights | 6 × 160³ live |
| **Fracture debris** | Macro chunks are Rigid (deterministic). Micro chunklets are GPU rigid-lite (sphere-approximated, collide with the global SDF, sleep, fade or persist as rubble) | 500k |
| **Shockwaves** | Screen-space refraction shell, dust kick-up from surfaces in the radius, **hitstop** 60–100 ms (wall-clock only), trauma camera shake, exposure flash | — |
| **Dynamic lights** | Clustered (froxel) light lists: flashes, flames, lamps, arcs, fireworks | 4,096 lights, 32 shadowed |
| **Decals** | Clustered decals: scorch, soot, splats, water stains, burn trails | 4,096 |
| **Arcs and beams** | Compute-generated branching lightning (30 Hz re-randomize), volumetric laser beams with dust | — |
| **Matter rendering** | Screen-space fluid or marching cubes for water, instanced grains, metaball slime. *As built:* SSFR water and sand / marble impostors (M4), goo through the same fluid surface with a `kn_slime` composite (M5; `apps/game/src/gfx/matter/`) | 4M grains (8M at 32 GB) |
| **Confetti and cloth** | Flutter model, 2-sided, wind-reactive | 1M flakes |
| **Singularity** | Screen-space gravitational lensing + accretion-disk particles | — |
| **Auto slow-mo** | 0.25× for 0.8 s when yield in a 0.5 s window is ≥ 3 (toggle, on by default; wall clock only) | — |

**Benchmark scenes** (shipped demos and performance CI):
- **"Kiloton":** 400 Bangsticks and 60 Powder Kegs in a Brik fortress inside an Arena.
- **"Sandstorm":** 4M sand grains avalanching through a Waterwheel valley.
- **"Domino Day":** 100k Topple Tiles across a Megastructure, director cam on.

*As built:* the tier budgets in this table match the code (`gfx/renderer.ts` particle pools, `gfx/volume.ts` `VOLUME_TIERS`, `gfx/debris.ts` `DEBRIS_CAP`; the 32 GB tier doubles them, D85). All three scenes exist as demo worlds (`apps/game/bench/`). Kiloton and Domino Day passed M3 as Bake & Watch playback (D89) and simulate in real time since multithreaded Jolt (D99); Sandstorm passed M4 on determinism and runs time-dilated (D92). Results: [M3_STATUS](docs/dev/M3_STATUS.md), [M4_STATUS](docs/dev/M4_STATUS.md).

---

## 14. Rendering architecture

**A custom, GPU-driven WebGPU renderer** (TypeScript + WGSL). Three.js was the v0.1 choice. A purpose-built renderer is justified now by four things: 1M-instance GPU culling, SDF GI, the Matter layer, and heavy compute integration. Off-the-shelf pieces we still use are the meshoptimizer decoder, the Basis Universal transcoder, and gl-matrix-style maths.

- **Render graph** with transient resource aliasing (saves hundreds of MB of VRAM), async-compute-style overlap where the browser allows it, and timestamp-query profiling.
- **GPU-driven instancing:** all part instances live in one structure-of-arrays buffer. Compute culling (frustum + two-pass Hi-Z occlusion + LOD select) writes per-(mesh, LOD) instance lists, which are drawn with `drawIndexedIndirect` per bucket (~600 buckets). Multi-draw-indirect is used when the browser exposes it.
- **LODs:** 4 mesh LODs plus **octahedral impostors** for far instances in Arena and Megastructure worlds.
- **Forward+** with a depth prepass. Clustered lights and decals. Visibility-buffer shading is an M5 research item.
- **Shadows:** 4-cascade CSM (4,096²) for sun/key + an 8,192² atlas for up to 32 local shadow-casting lights + SDF soft-shadow contact hardening.
- **Global illumination:** a **global SDF clipmap** (4 levels × 256³) composed from per-part baked SDFs (§19). It's used for DDGI-style probe GI (software-traced against the SDF), AO, soft shadows, particle collision and volumetric occlusion. Explosions light the room.
- **Reflections:** SSR + probe fallback.
- **Volumetrics:** froxel fog (sun light shafts through windows on the 12 GB and 16 GB tiers, and smoke) + raymarched fluid grids.
- **Temporal upscaling:** WGSL temporal upscaler (an FSR 2-style algorithm, MIT-licensed reference) for 4K output from 1440p internal.
- **Post:** bloom (practical lamps and LEDs), per-object motion blur, a gentle **tilt-shift depth of field in Build and Run** (focus on the selection or the run's action; off in reduced motion, switchable in Settings) plus the Photo-mode DOF, Khronos PBR Neutral tonemap (keeps brand colours true; AgX in photo mode), a per-environment **warm grading LUT**, a soft vignette, lensing (Singularity) and fine film grain.
- **Materials:** a single physically based "Uber" shader with feature bits (clearcoat for enamel paint, transmission and thickness for polycarbonate and glass, sheen for fabric and fur, emissive LEDs driven by part state). It samples each part's **texture set** (albedo, normal, ORM) from **2D texture arrays** grouped by size class (no bindless in WebGPU), plus a tiling **detail layer** (wood grain, paint orange-peel, cast-iron pitting) that fades in close to the camera.
- **Default look** ([D79](docs/dev/DECISIONS_2026-10-24.md)): the renderer matches the warm key art, not the look-dev cyc. Probe GI is the default on 12 GB and up, GTAO everywhere (SSAO on 4 GB), SDF contact shadows, and an IBL baked from each set. It costs about 2.5 ms extra on the 16 GB tier at 1440p internal; lower tiers drop light shafts first, then DOF, then GI ([docs/RENDERING.md §12](docs/RENDERING.md)). Proof: an in-engine Tinker Lab frame next to the Cycles key art in a side-by-side review.
- **WebGPU features used when present:** `shader-f16`, `subgroups`, `timestamp-query`, `texture-compression-bc` / `-astc`, `float32-filterable`, `indirect-first-instance`.
- **WebGPU-only by design.** No WebGL path. Unsupported browsers get an explanation page with a capture reel.

*As built (through M5; details in [docs/RENDERING.md §0](docs/RENDERING.md)):* the renderer runs on the main thread (`apps/game/src/gfx/`). It has GPU frustum culling and LOD into per-(mesh, LOD) indirect buckets, octahedral impostors in Arena and Megastructure, clustered forward+, the full D79 look (texture-set arrays + detail layer, GTAO / SSAO, SDF contact shadows, set IBLs, froxel shafts, tilt-shift DOF, LUT, vignette, grain), SDF probe GI, the TAA upscaler, bloom and PBR Neutral. Shadows are one key-light map plus a cached static set shadow, not 4-cascade CSM. **Not built:** the render-graph compiler and aliasing, Hi-Z occlusion, SSR, motion blur, clustered projected decals, the local-light shadow atlas and the visibility buffer (post-beta, D107). The M5 Future Tech effects (Singularity lensing, rift shimmer and glimpse, stasis, tractor, hover, force wall, coilgun, grav well) shipped in M5. Textures are KTX2 / BC7 from an in-house encoder (D94, D97), not Basis Universal; meshes aren't meshopt-compressed.

---

## 15. VRAM budget (16 GB reference) and tiers

Browsers don't report VRAM. We estimate the tier from adapter info and limits, then **probe-allocate** carefully, with device-lost recovery (rebuild GPU state from the CPU sim and the last Matter checkpoint). Players can override the tier with a "GPU memory budget" setting. *As built:* `estimateTier` (`apps/game/src/caps.ts`), the boot probe and pressure governor (`gfx/vram.ts`, M4 V4), and **Settings › Graphics › Quality tier**, which applies at boot (D90). Chromium hides the adapter name, so the 32 GB tier is usually chosen there.

### 15.1 16 GB tier resident budget: ~10.4 GB (≈ 5.5 GB headroom for browser, OS and compositor)

| Pool | Budget |
|---|---|
| Part library textures (2D arrays, BC7/ASTC, full mips): one unique set per part (albedo, normal, ORM at 1–2k, [D78](docs/dev/DECISIONS_2026-10-24.md)) ≈ 1.9 GB for the whole catalogue and the 8 critters (S 1k, M/L 2k, critters 4k, some second slots), + shared detail-layer arrays ≈ 0.03 GB; the rest is headroom for skins | 2.5 GB |
| Part meshes (LOD0–3) + impostor atlases | 0.4 GB |
| Environment (terrain, backdrops, sky/IBL, the shared props kit) | 1.0 GB |
| Scene instances (1M × transforms, previous transforms, state, bounds) + culling lists | 0.26 GB |
| **Bake-ahead keyframe buffer** (≈ 60 s × 20k awake bodies). *As built:* keyframes live in the sim worker's CPU memory (§6.5); the VRAM probe still reserves this as headroom | 1.5 GB |
| Matter state (4M grains) + radix-sort/hash scratch | 0.35 GB |
| Matter rewind checkpoints | 1.0 GB |
| Spectacle particles (16M) + emit/compaction scratch | 0.7 GB |
| Volumetric grids (6 × 160³, double-buffered) | 0.8 GB |
| Debris chunklets + meshes | 0.1 GB |
| Global SDF clipmaps + per-part SDF atlas + GI probes | 0.5 GB |
| Render targets (1440p internal → 4K output, history, motion, bloom, froxels) | 0.9 GB |
| Shadows (CSM + local atlas) | 0.4 GB |
| **Total** | **~10.4 GB** |

Design rule: no single buffer > 1 GiB (chunk anything larger). Respect `maxStorageBufferBindingSize` and `maxBufferSize` as reported. Request the adapter's maximum limits up front.

### 15.2 Tiers

| | **4 GB** | **8 GB** | **12 GB** | **16 GB** (reference) | **32 GB** ([D85](docs/dev/DECISIONS_2026-10-24.md)) |
|---|---|---|---|---|---|
| Alias (art and VFX docs) | Low | Medium | High | Ultra | Max |
| Reference GPUs | GTX 1650, Iris Xe, Apple M1 (8 GB) | RTX 3060 Ti/4060, RX 6600, M2 (16 GB) | RTX 4070, RX 7700 XT, M3 Pro | RTX 4070 Ti Super/4080/5080, RX 7800 XT/9070 XT, M-series Pro/Max | RTX 5090, RTX PRO 6000, RTX 6000 Ada, Radeon PRO W7900 |
| Resident budget | 2.8 GB | 5.5 GB | 8 GB | 10.4 GB | ≈ 22 GB |
| Max world | Room | Warehouse | Arena | Megastructure | Megastructure |
| Max placed parts | 20k | 100k | 400k | 1M | 2M |
| Matter grains | 250k | 1M | 2M | 4M | 8M |
| Spectacle particles | 1M | 4M | 8M | 16M | 32M |
| Fluid grids | 2 × 96³ | 4 × 128³ | 6 × 128³ | 6 × 160³ | 8 × 192³ |
| GI | SSAO only | GTAO + SDF AO | GTAO + SDF AO + probe GI (half rate) | GTAO + full SDF GI | GTAO + full-rate multi-bounce SDF GI at ~2× SDF and probe resolution |
| Look ([D79](docs/dev/DECISIONS_2026-10-24.md)) | Detail layer, LUT, vignette, grain | + tilt-shift DOF | + light shafts, SDF contact shadows | everything | everything at full resolution |
| UI | Solid Graphite panels (glass fallback, [D77](docs/dev/DECISIONS_2026-10-24.md)) | Glass | Glass | Glass | Glass |
| Target | 1080p60 (dynamic res) | 1440p60 | 1440p60–120 | 4K60 (upscaled) | 4K60 (upscaled from ≥ 1800p) |
| **Measured frame, RTX 5090 at this tier's settings** (T5: max world, part cap and grain budget all in view; preset / whole-world camera, GPU ms, governors off) | 8.1 / 7.3 at 1080p native (Room, Moon): **meets**. *Polish pass (D125, real LOD sizes):* 6.2 / 5.9 | 20.2 / 19.0 at 1440p from 1080p (Warehouse, Moon): **misses**; governed: 16.1–16.7 / 15.6–16.2 at the governor's step 6 of 7 (70 % resolution; G5 re-measure after the GPU-timer fix) | 29.0 / 18.6 at 1440p (Arena, Moon): **misses**; 16.5 / 17.6 with the governor at its last step. *Polish pass (D125):* shadows fitted: 23.2 / **11.5**, governed 15.7 / 10.4 at steps 6 / 5 of 7; with real LOD sizes, **13.3 / 8.8: meets** ungoverned | 10.3 / 13.4 at 4K from 1440p (Megastructure): **meets**. *Polish pass (D125):* 8.1 / 10.1 | 22.6 / 28.6 at 4K from 1800p (Megastructure, 8M grains): **misses**; 18.7 / 28.8 with the governor at its last step. *Polish pass (D125):* 16.7 / 20.8: the preset camera is at the line, the whole world still **misses** (shadows 6.8, AO prepass 4.4, main 6.5 ms, and the grains) |
| Measured CPU per frame (main thread) | 0.5 ms | 0.5 ms | 0.5 ms (Hangar: 7.4–8 ms, the shadowed lamp's cone test; *polish pass, D125:* 0.6–1.0 ms, culled on the GPU) | 0.5 ms | 0.5 ms |
| Measured Matter tick at the grain budget (60 Hz = 16.7 ms) | 3.9–4.5 ms | 11.4 ms: real time | 24 ms: ≈ 0.7× | 54 ms: ≈ 0.31× | 131 ms (Sandstorm 201 ms): ≈ 0.13× |
| **Awake bodies at 1× (measured)**: chain reaction / dense pile, at the reference CPU's Jolt threads | 7k–13k / 3.9k–5.2k (2–5 threads) | 13k / 5.2k (5) | 13k–14k / 5.2k–5.7k (5–9) | ≈ 14k–15k / ≈ 6k (9–12) | ≈ 15k / ≈ 6k (12) |

The GB names are the canonical tier IDs (UI badges, `hello.tier`, `requiredTier`). Low / Medium / High / Ultra are declared shorthand only, used in the art and VFX docs: Low = 4 GB, Medium = 8 GB, High = 12 GB, Ultra = 16 GB, Max = 32 GB.

**System RAM:** 16 GB recommended for Megastructure. The Jolt WASM heap is sized for the world's worst case, every part awake with a full rewind ring (J5, [docs/SIMULATION.md §4.1](docs/SIMULATION.md)): 0.6–0.7 GB at 20k parts, 1.9–2.5 GB at 100k, 3.1–3.7 GB at 400k (sparse to dense), and the 4 GB cap (4,032 MB) from ≈ 480k parts; the threaded build rounds up to a power of two, so above 2 GB it takes the cap. That much is reserved and committed (measured on Windows: commit charge ≈ the heap size), but only what the run touches is resident: a settled 100k-part world ≈ 0.35 GB with its rewind ring full, the same count all awake 2.1 GB ([M5_NOTES_J5](docs/dev/M5_NOTES_J5.md)). Past ≈ 480k parts the worst case doesn't fit 4 GB (≈ 7.4 GB all awake at 1M parts; by the model the cap holds ≈ 0.4M awake bodies there); a run that runs out stops with "This machine ran out of physics memory" instead of crashing. **CPU:** 8+ cores recommended. Jolt's job pool uses `hardwareConcurrency − 3` threads, clamped to 2..12 (the main thread, the sim worker and the browser keep a core each; `joltThreadsFor` in `apps/game/src/sim.worker.ts`, D99; [docs/ARCHITECTURE.md §2](docs/ARCHITECTURE.md), [docs/SIMULATION.md §4.1](docs/SIMULATION.md)).

*As built:* the grain and part caps per tier are `TIER_CAPS` (`packages/format/src/matter.ts`), the resident budgets `TIER_BUDGET` (`gfx/vram.ts`), the look per tier `LOOK_TIERS` (`gfx/look/tiers.ts`), GI `GI_TIERS` (`gfx/gi.ts`) and fluid grids `VOLUME_TIERS` (`gfx/volume.ts`). *Measured (M5 T5, [M5_NOTES_T5](docs/dev/M5_NOTES_T5.md)):* RTX 5090 (quiet GPU, headless Chrome 155), Core Ultra 9 285K.
- **What the measured rows show:** each tier's settings and content relative to each other on one card. They don't show reference-GPU performance; a pass on real reference GPUs is still owed.
- **The settings are cheap:** empty worlds cost 1–3 ms at every tier. The misses are content at the caps: main-pass, key-light shadow and AO-prepass geometry for 100k–2M parts in view, and the grains.
- **Polish pass (RENDER, D125, [BETA_NOTES_RENDER](docs/dev/BETA_NOTES_RENDER.md)):** the key-light shadows fit the view in two cascades with GPU caster LOD.
  - Whole-world shadow pass: 15.2 → 6.0 ms at 12 GB and 19.7 → 6.8 ms at 32 GB. The shadowed lamp's cone test moved to the GPU.
  - Same harness and throughput method as T5; quiet-GPU A/B, provisional.
  - The 12 GB and 32 GB "before" in that A/B measured 29.7 / 20.2 and 29.6 / 37.4 ms.
  - **LOD and impostor switches now use each part's real size.** Before, every art part counted as 0.87 m across. Main pass at the preset camera: 12 GB 14.6 → 6.8 ms, 4 GB 5.5 → 3.7, 16 GB 2.8 → 2.3, 32 GB 6.8 → 5.0. At the whole-world camera, 4 GB went 5.0 → 3.6 ms and the other tiers are unchanged (± 0.1 ms).
- **Spectacle:** Kiloton plays back at 60 fps on every tier, 2.2–12.7 ms in its blast second.
- **VRAM:** the ledger peaks at 1.4 / 2.1 / 3.7 / 5.4 / 8.9 GB against the 2.8 / 5.5 / 8 / 10.4 / 22 GB budgets.
- **8M grains on 32 GB** fit (Matter 3.0 GB, the boot probe passes, no validation errors) but run at ≈ 0.13× real time. They're a Bake & Watch / time-dilated capacity (D92), not live play.
- The awake-body row assumes a CPU class per tier (4 GB: 4–8 hardware threads; 8 GB: 8; 12 GB: 8–12; 16 and 32 GB: 12–16+). The ceiling itself depends only on the CPU (§5.3).

---

## 16. Audio
- **Engine:** Web Audio + AudioWorklet mixer, 64 voices with priority, HRTF option. Occlusion and reverb per environment come from SDF ray probes.
- **Impacts:** material-pair banks (wood, metal, polycarbonate/glass, rubber/fabric, brick/ceramic, paper, critter; [docs/AUDIO.md §3](docs/AUDIO.md)). 3 intensities × 6 variations, with pitch and gain from impulse and mass. Rolling and sliding loops are velocity-driven. Matter has granular synthesis for sand hiss and water.
- **Explosions:** layered transient + body + debris tail + environment slapback, scaled by yield. Distance delay in big worlds (you see the flash, then hear the boom). A master limiter keeps 400 Bangsticks *huge* rather than clipped.
- **Critters:** original voice barks, 8–12 per state.
- **Music:** an adaptive score with layers that build with the K.O. Count and peak on big detonations. Style: modern electronic funk and big-band hybrid. There's also a manual track picker.
- **Musical parts:** Tonebars and Ding are tuned to the world key and scale. "Quantize sound to beat" delays only the *audio* (never the sim).
- Sources: original recordings and commissions. CC0 is used as raw material only, and everything is logged in `assets/LICENSES.csv`.
- *As built (through M5):* every sound is synthesised procedurally at load (no recordings yet), on a WebAudio graph with a −1.05 dBTP AudioWorklet limiter, 64 voices and granular Matter audio (goo included), with cues for every part and critter through BUZZ, Hangar and Moon ambience, the air-0 % "suit radio" treatment, and sound in MP4 clips. SDF occlusion and the manual track picker aren't built (post-beta). Details: [docs/AUDIO.md §0](docs/AUDIO.md).

---

## 17. Save, share and capture

### 17.1 Machine file: `.knockon` (binary)
- Header (format, version, `simVersion`, tick rate, environment, seed, required tier), then **chunked sections**: parts, links (paths, wires), modules, notes, input log and goals (reserved). Compressed with zstd (WASM) or deflate.
- Parts: type, position 3 × fixed-point (1/64 cell), rotation as exact snapped Euler or 48-bit smallest-three, size, flags and properties (varint). Full layout: [docs/DATA_FORMATS.md](docs/DATA_FORMATS.md). About 16–24 B per part, so 1M parts ≈ 20 MB raw, ~4–8 MB compressed. Topple Tile lines compress extremely well.
- A JSON export/import (debug and modding) mirrors the binary schema one to one.
- *As built:* sections are deflated (`fflate`); the container reserves a zstd codec id but nothing writes it. The header also carries `simFlags`, `counts.grains` and `requiredTier` (M4). The JSON mirror isn't built. Layout: [docs/DATA_FORMATS.md §2](docs/DATA_FORMATS.md).

### 17.2 Sharing
- **Small machines** (≤ ~12 KB compressed): the whole machine rides in the URL fragment (`#m=…`). No server is needed, and the data stays out of server logs.
- **Large machines:** in local co-op, the **Host Server** (§17.5) stores and serves worlds. A public **Share service** (content-addressed blob store, machine ID = hash) is optional and comes later.
- A shared machine is also a replay. `&t=42.5&cam=director` deep-links to a moment and a camera.
- **Modules** are shareable on their own (copy-paste strings or links).

### 17.3 Persistence
IndexedDB autosave (debounced), a local "My Machines" gallery, per-machine version history (last 50) and crash-safe journaling. *As built:* the Host Server persists every world, solo included: a compacted `world.knockon`, an append-only journal and backups (`apps/host/src/storage.ts`); the lobby lists the host's worlds. There's no client-side IndexedDB store.

### 17.4 Capture
- **Offline render:** bake the run, then render any camera path frame-perfect at up to 8K60 regardless of live performance. Encoding uses WebCodecs (AV1/HEVC/H.264 hardware) + an MP4 muxer.
- Clips up to 5 min, GIF and WebP export, photo mode at 8K, and a **Cascade Report card** image.
- *As built (M4):* all of the above, with an in-house MP4 muxer, GIF and animated WebP encoders (D94; `apps/game/src/capture/`). Since M5, MP4 clips carry the game's own sound, rendered offline on the capture's frame clock (AAC-LC 192 kbps, Opus as the fallback); GIF and WebP have none. Past the device's 8,192 px texture limit frames are downscaled, not tiled. [docs/RENDERING.md §13](docs/RENDERING.md).

### 17.5 Multiplayer (2-player co-op, local)
Full design: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md). Setup guide: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).
- **Topology:** a small **Host Server** (Node: static files with COOP/COEP headers, WebSocket relay, world storage) bound to `127.0.0.1`. Browsers treat localhost as a secure development context, and players supply their own nicknames.
- **Build:** a shared op log. The server sets the global order. Clients apply their own edits optimistically, use per-player ID namespaces (sim order depends on IDs) and soft part locks, and undo only their own ops.
- **Run:** no physics on the wire. Both clients simulate the same machine deterministically. A shared playhead is capped by the slower client's bake head. Pokes are scheduled with input delay and handled by rollback. State hashes every 60 ticks; on mismatch the host's checkpoint repairs the other client and a desync report is written.
- **Session capacity** is the lower of the two players' GPU tiers. Both players always run the same build (served by the host).
- The single-player editor uses the same op pipeline through a loopback server, so multiplayer is never a second code path.

---

## 18. Technical architecture

### 18.1 Stack

As built (M5 docs pass). The original plan's choices that didn't ship are in the last column; the real thread and package map is [docs/ARCHITECTURE.md §2–3](docs/ARCHITECTURE.md).

| Concern | As built | Planned, not built |
|---|---|---|
| Language and build | TypeScript (strict), Vite, pnpm workspaces | |
| Rendering | Custom WebGPU renderer in `apps/game/src/gfx/`, on the **main thread** on the page canvas, sharing its `GPUDevice` with the Matter GPU backend (D92) | `packages/gpu-core`, `packages/render`, `packages/spectacle`; a GPU worker on an OffscreenCanvas |
| Rigid physics | Jolt Physics: the published `jolt-physics` 1.1.1 WASM build, single- and multithreaded (D99), pinned | A custom cross-platform-deterministic build; the Rapier3D fallback (not needed) |
| Matter | Integer kernels in WGSL plus a bit-identical CPU reference (`packages/matter`) | |
| Sim state | Plain, JSON-safe state on `Machine` (`packages/sim/src/machine.ts`), serialised into KNCP checkpoints | bitECS |
| UI | Plain TypeScript and DOM (`apps/game/src/ui/`), design tokens as CSS custom properties in `apps/game/src/styles.css`; in-world UI (ghosts, ports, outlines) drawn by the renderer | Solid.js; `packages/ui`, `packages/editor` |
| Threads | Main (UI, input, DocStore, net, run controller, renderer, Matter GPU backend, audio graph) · **sim worker** (Machine, bake-ahead, rollback) · **Jolt job threads** (`hardwareConcurrency − 3`, clamped 2..12) · MP4 muxer and GIF encoder workers · AudioWorklets (limiter, Matter granular) | GPU worker; asset decode workers |
| Sim ↔ render | `postMessage` with transferred typed arrays (a `frame` per draw), one SharedArrayBuffer for Matter results; keyframes in the sim worker's BakeStore. **Requires COOP/COEP** (cross-origin isolation) | SharedArrayBuffer rings; a VRAM keyframe buffer |
| Assets | glTF 2.0 `.glb` + `.art.json` + shapes; texture sets as KTX2 / BC7 (in-house encoder, D94, D97) with PNG as source and fallback | `EXT_meshopt_compression`, Basis Universal / UASTC, SDF and impostor sidecars |
| Tests | Vitest (Node: goldens, fuzz, rollback, Matter CPU = GPU), hand-run Chrome checks, the 2-player and critter soaks, `tools/vendor-matrix` (D91) | Playwright on GPU runners; nightly perf CI |
| Multiplayer | Loopback-only Host Server `apps/host`: Node 22 LTS minimum (development is tested on Node 24), Fastify, `ws`, `msgpackr`, deflate (§17.5) | zstd |
| Deployment | Local development only in this repository | External deployment is out of scope |

### 18.2 Repo layout

*As built:*
```
apps/game/              boot, UI (src/ui), renderer (src/gfx), audio, capture, sim worker, run controller, bench/
apps/host/              Host Server: static + COOP/COEP, WebSocket session relay, world storage, share store, soaks
packages/assets/        readers for the art pipeline's outputs (.glb, .art.json, shapes)
packages/detmath/       deterministic trig, PRNG, hashing
packages/docstore/      WorldDoc, validated op apply / inverse, optimistic ops, undo
packages/format/        .knockon container and codecs, ops, terrain, KNCP checkpoints, sim flags and tier caps
packages/jolt/          loads the published jolt-physics 1.1.1 build; contact path; M0 spike
packages/matter/        integer Matter layer: CPU reference, WGSL kernels, WebGPU backend
packages/net/           protocol (MessagePack), size caps, clock sync
packages/parts-data/    part defs (TypeScript, D58), cards, demos, critters, presets, generated env colliders
packages/sim/           Machine, channels, critters, Matter host
assets/src/, assets/build/   .blend sources and built glb / art.json / texture sets
tools/blender/          part, environment and texture builders + validators (kn_tools); encode_ktx2.py
tools/assets.mjs        asset build and self-test
tools/lint/             the determinism lint
tools/vendor-matrix/    the Matter determinism matrix runner (D91)
tools/tim1-extract/     1993 data extractor (reference only)
reference/tim1/         decoded 1993 data (never shipped)
```

*Original plan (superseded):*
```
apps/game/              boot, UI, input, frame loop
apps/host/              Host Server: static + COOP/COEP, WebSocket session relay, world storage
packages/net/           protocol, MessagePack codec, clock sync, op queue + reconciliation
packages/sim/           deterministic gameplay: coordinator, channels, behaviours, critter AI, detmath
packages/jolt/          custom WASM build scripts + typed bindings
packages/matter/        GPU fixed-point Matter layer + coupling
packages/gpu-core/      device, limits/tier probe, render graph, resource pools, profiling
packages/render/        scene, culling, materials, lighting, GI, post, cameras
packages/spectacle/     particles, fluids, debris, decals, arcs, lensing
packages/audio/
packages/parts-data/    *.part.json (generated from Blender + hand-authored behaviour config)
packages/format/        .knockon binary codec + JSON mirror
assets/src/             .blend sources (Git LFS)
tools/blender/          export + validate (headless CI)
tools/bake/             SDF baker, impostor baker, thumbnail renderer
tools/tim1-extract/     1993 data extractor (reference only)
reference/tim1/         decoded 1993 data (never shipped)
```

### 18.3 Part definition (data-driven)
The schema, shown as JSON (as built it's TypeScript data; see the note after the example):
```jsonc
// packages/parts-data/parts/bangstick.part.json (the same example as docs/PART_SYSTEM.md §9, which owns the schema)
{
  "type": "bangstick", "family": "boom", "name": "part.bangstick.name", "tag": "part.bangstick.tag",
  "class": "M", "ship": "M1",
  "size": [3, 1, 1], "mirror": ["x"],                          // no "resize" field = not resizable
  "body": { "kind": "dynamic", "mass": 0.8, "material": "paper",
            "overrides": { "restitution": 0.2, "friction": 0.6 } }, // shapes load from bangstick.shapes.json by naming convention
  "ports": [
    { "name": "fuse",      "channel": "heat",   "dir": "in" },
    { "name": "detonator", "channel": "signal", "dir": "in" }
  ],
  "behaviours": [
    { "id": "rigid_basic" },
    { "id": "flammable", "params": { "region": "fuse_tip" } },
    { "id": "explosive" }
  ],
  "props": { "fuse": { "type": "seconds", "min": 0.5, "max": 5, "step": 0.1, "default": 2.0 } },
  "flammable": { "igniteTime": 0.05, "burnTime": 0, "onBurnt": "none" },
  "explosive": { "yield": 1.0, "sympathetic": true, "fuseProp": "fuse", "macroChunks": 4 },
  "fx":    { "ignite": "fx/fuse_spark", "detonate": "fx/boom_small" },
  "audio": { "ignite": "sfx/fuse_light", "burn": "sfx/fuse_hiss", "signal": "sfx/detonator_click",
             "detonate": "sfx/boom_small", "impact": "sfx/knock_paper", "debris": "sfx/debris_patter" },
  "card":  { "needs": "part.bangstick.needs", "does": "part.bangstick.does", "tips": ["part.bangstick.tip1"] }
}
```
Card text is localised through string keys ("Needs: fire on the fuse, a detonator signal or a nearby blast · Does: BOOM, yield 1").

*As built:* part definitions are typed TypeScript data in `packages/parts-data/src/defs.ts` and `defs_m2.ts` / `defs_m3.ts` / `defs_m4.ts` (M5: `defs_m5.ts` and `defs_m5_matter.ts`), following the PART_SYSTEM §1 schema field for field, with property-dependent shape and visual functions ([D58](docs/dev/DECISIONS_2026-10-24.md)). Cards are in `cards.ts`; behaviours are code in `packages/sim/src/channels/`. There are no `*.part.json` files.

### 18.4 Frame loop
*Original plan (superseded; as built below):*
```
GPU worker (rAF on the OffscreenCanvas)            Sim coordinator worker            Jolt pool / GPU Matter
 ├ read keyframes (VRAM) or SAB ring  ◀──────────── ├ tick N: apply inputs, behaviours ─▶ Jolt step (MT, deterministic)
 ├ interpolate, cull (GPU), render graph            ├ sort contacts, resolve channels    Matter tick (every 2nd), fixed-latency coupling
 ├ drain events → Spectacle emit, decals            ├ write transforms + events (bake-ahead)
 └ present                                          └ checkpoint / hash every 60 ticks
```
The main thread reads the same event ring for UI signals, toasts and audio scheduling ([docs/ARCHITECTURE.md §2, §5](docs/ARCHITECTURE.md)).

*As built:*
```
Main thread (rAF)                                   Sim worker                           Jolt threads / Matter
 ├ apply the latest `frame` message: transforms,    ├ tick N: inputs, behaviours ──────▶ Jolt step (MT, deterministic)
 │   flags, meters, critter state, events           ├ contacts sorted canonically         Matter tick (every 2nd) on the main
 ├ cull (GPU), draw, Spectacle from events, audio   ├ keyframes into the BakeStore          thread's GPU backend (or the
 ├ Matter playback replica to the playhead          ├ post `frame` for the playhead         worker's CPU backend), fixed latency
 └ present                                          └ checkpoint / hash every 60 ticks
```

---

## 19. Asset specification (Blender, built to spec)

### 19.1 Tooling
- **Blender 4.5 LTS** (pinned). Sources in `assets/src/` (Git LFS).
- `tools/blender/export_part.py` (headless) writes `<type>.glb`, `<type>.shapes.json` (Jolt collision shapes), and port, sensor, emitter, pivot and LED metadata.
- Post-processing: gltf-transform (meshopt, KTX2: **UASTC + RDO for every part texture set**, which transcodes to BC7 on desktop; ETC1S only for environment backdrops), then `tools/bake` (per-part **SDF** 32³–64³ r16f, octahedral **impostor** 12×12 views and turntables, rendered in-engine).
- Library **thumbnails** (the 3D part icons used across the UI) are rendered by `tools/blender/render_thumbs.py` with the thumbnail rig, matched to the engine look ([D78](docs/dev/DECISIONS_2026-10-24.md), [docs/art/briefs/ui_icons.md §6](docs/art/briefs/ui_icons.md#6-library-card-thumbnail-rig)). Tinker Lab key art comes from `tools/blender/render_tinker_lab.py`.
- `validate_part.py` runs in CI and fails on naming, scale, origin, budget, collision, texture or LED-slot violations.
- *As built:* parts are built by Python builders (`tools/blender/make_<type>.py` with the `kn_tools` package) and exported and validated in Blender; `pnpm assets` (`tools/assets.mjs`) builds and self-tests the outputs. Texture sets ship as **KTX2 / BC7** from the in-house encoder (`tools/blender/encode_ktx2.py`, D94, D97), with the PNGs as source and fallback; no gltf-transform, meshopt, UASTC or ETC1S (UASTC for Apple is open). `tools/bake` (per-part SDFs, impostor bakes, turntables) isn't built: the GI stamps oriented boxes, and impostors are baked on the GPU at first use. Details: [docs/art/ASSET_PIPELINE.md](docs/art/ASSET_PIPELINE.md).

### 19.2 Scene conventions
- Metric, 1 BU = 1 m, **1 cell = 0.1 m** (set the grid overlay to 0.1). Blender Z-up; the exporter converts to Y-up.
- **Origin = physical pivot:** axle centre (rotating parts), hinge (Fulcrum, Flap), centre of mass (free bodies), base centre (static props, and placed devices that are dynamic, such as Wick, Hourglass, Skyshow, Popper, Snaptrap and Fishbowl; the engine computes their centre of mass from the shapes).
- Bounds fit the catalogue size (§12) within ±0.02 m. Placed devices have whole- or half-cell footprints. Free bodies (Rollers, Yolk, critters, free explosives such as Bangstick and Powder Keg, and loose props such as Topple Tiles, Stackers, Pins and Pane/Vase) are exempt and use their catalogue size, which may be fractional.
- **Forward = −Y in Blender** (the part's "front" faces the default camera). Ports point along their local +X.
- Transforms applied, no negative scale (mirroring happens in engine), manifold meshes for SDF baking.

### 19.3 Collections and naming (`assets/src/<family>/<type>.blend`)

| Collection / prefix | Purpose | Rules |
|---|---|---|
| `RENDER` → `<type>__<piece>` | LOD0 render meshes | Material slots per ASSET_PIPELINE §4 (including `kn_led`). Moving sub-parts parented to `PIVOT__*` |
| `LOD1–3` | Lower LODs | 50 % / 25 % / 8 % of LOD0 (LOD3 may stop at a 12-tri box or a 20-tri icosahedron). meshoptimizer + manual fixes |
| `COL` | **3D collision** | Prefer primitives: `COL__box/sphere/capsule/cylinder__n` (fitted meshes, converted). Then `COL__hull__n` (convex, ≤ 64 verts). `COL__mesh` only for static parts |
| `PORT` → `PORT__<channel>__<name>` | Connection points | Empties at the port ring's centre, +X outward. Use the **linked Port Ring asset** from `lib/port_ring.blend`, never a custom one |
| `SENSOR` → `SENSOR__<kind>__<name>` | Trigger and pressure volumes | Convex meshes |
| `EMIT` → `EMIT__<fx>__<name>` | VFX and audio spawn points (`muzzle`, `flame`, `fuse_tip`, `exhaust`, `spout`, `vent`) | Empties, +X = direction |
| `PIVOT` → `PIVOT__<name>` | Code-driven motion | Empties; the axis is named in a custom property (`axis: x/y/z`) |
| `LED` | Status emissives | Faces assigned to `kn_led`; vertex colour R channel = LED group index (the engine drives colour and intensity) |
| `FRAC` → `FRAC__n` | Pre-fractured chunks | §19.5 |
| `RIG` / `RAG` | Armature / ragdoll proxies | §19.4 |

### 19.4 Animation and rigs
- **Procedural first:** gears, wheels, pistons, levers, fans, blades and the clown spring are driven by sim state through `PIVOT__` empties. No baked clips.
- **Baked clips** only for critters and organic or complex motion (Puffer squeeze, Helio inflate via shape keys, Big Top recoil, Grabber idle).
- **Critters:** ≤ 80 bones, ≤ 4 weights per vertex, a face rig as ~20 shape keys (blink, happy, angry, scared, dizzy, sleepy, visemes for barks), no root motion. Required clips: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped`, `celebrate`, `sleep`, `emote_*`, plus role clips (`pedal`, `wheel_run`, `swim`, `flap`, `lay_egg`, `bark`, `sniff`). 30 fps authored; loops are seamless.
- **Ragdoll:** `RAG__<bone>` capsules matched to the bones, plus joint limits as custom properties. The exporter emits a Jolt ragdoll definition.

### 19.5 Fracture
- 6–24 chunks per breakable (explosives may use 4 macro chunks; Cell Fracture add-on or a Geometry Nodes Voronoi setup), biased toward readable silhouettes. Interiors use `kn_interior_<material>`.
- Each chunk: ≤ 1,500 tris, with an auto-generated convex hull unless one is authored.
- Shared **micro-debris library** (`assets/src/fx/debris.blend`): 12–20 shards per material, 20–200 tris each. *Not built (post-beta):* the debris chunklets are procedural shards drawn by `gfx/debris.ts`.

### 19.6 Budgets by class (16 GB reference; lower tiers stream lower mips and LODs)

| Class | Examples | LOD0 tris | Texture sets | Rig / anim | Effort |
|---|---|---|---|---|---|
| **S** | Rollers, Brik, Slope, Sheave, Cog set, Cell, Topple Tile | 500–3,000 (Topple Tile ≤ 300) | 1,024² unique set | none / procedural | ~1 day |
| **M** | Gale, Motor, Bangstick, Snipper, Fulcrum | 3,000–10,000 | 2,048² | pivots (+ ≤ 3 clips) | ~2.5 days |
| **L** | Big Top, Dynamo, Gotcha Box, Fishbowl, Arc Tower, Fabricator | 10,000–25,000 | 2,048² + 1,024² detail | pivots + 2–6 clips | ~5 days |
| **XL** | Mochi, Pip, Bandit + Pedal Rig, Biscuit, Henny, Goby; robot critters Dusty and Buzz (15,000–25,000 tris, 2,048² set) | 25,000–60,000 | 4,096² hero set (streamed) | full rig, face, ragdoll, 20+ clips | ~10–12 days (+ animator) |
| **Environment** | Studio, Tinker Lab, Mega Kitchen, Backlot, Orbital Hangar, Moon Base | 200k–1M (+ terrain); the Studio is ≤ 40k by design | trims + hero sets | — | ~12 days each |
| **Environment prop** | Shared props kit `kn_prop_*` (~45: books, glassware, plants, tools, furniture) | 300–30,000 by prop class (E-S / E-M / E-L) | kit trims, 1,024² or 2,048² sets | — | ~0.5 / 1 / 2 days |

From M3 every class is authored with its own texture set ([D78](docs/dev/DECISIONS_2026-10-24.md)). The efforts above are the pre-pivot figures; the texture work is counted separately below.

**Volume:** ~115 items ≈ 48 S, 50 M, 11 L, 8 XL ≈ **48 + 125 + 55 + 90 ≈ 320 artist-days**, plus environments ≈ **72** (six) and the shared library (Port Ring, material masters, debris) ≈ **15**: **≈ 407 before the pivot**. D78 adds the props kit (≈ 33), the Kitchen maximalism pass (≈ 4), the texture pass on the ~53 parts made before M3 (≈ 45) and texture work on the ~60 parts made from M3 on (≈ 50). **Total ≈ 540 artist-days**: about 3 modellers + 1 animator for ~9.5 months, or 4 modellers for ~7.5 months, plus 1 tech artist ([docs/PRODUCTION.md §3](docs/PRODUCTION.md)).

### 19.7 Materials and textures
- **Master material library** `lib/materials.blend`: powder coat in 8 brand colours (Ignition, Volt, Cobalt, Plasma, Bone, Graphite, Amber, Beam; they now read as enamel-painted steel, IDs unchanged), anodised aluminium, brushed steel, chrome, brass, copper, cast iron, **tinted polycarbonate** (transmission + thickness), glass, rubber, hardwood ×2, paper/cardboard, fuse cord, wax, latex, ceramic, brick, rope fibre, fabric, critter fur (stylised, shell-fur ready), slime, `kn_led`, `kn_screen`, `kn_decal`, `kn_interior_*`, and the `kn_env_*` environment family. The canonical list is [docs/art/ASSET_PIPELINE.md §5.1](docs/art/ASSET_PIPELINE.md). Parts **link** masters and layer a **unique texture set** over them (grain, worn edges, patina, print, moulding marks), instead of masks alone ([D78](docs/dev/DECISIONS_2026-10-24.md)).
- Principled BSDF only (clearcoat, transmission and sheen map to our Uber shader). Texture maps: BaseColor (sRGB), ORM, Normal (OpenGL +Y), optional Emissive and Thickness. Set sizes: S 1,024², M and L 2,048², all UASTC → BC7.
- **Texel density 1,024 px/m** (parts) and 2,048 px/m (critter faces). Size classes match the texture-array layer sizes (1,024² / 2,048² / 4,096²). *As built:* the renderer's arrays are 1024² and 2048² (`gfx/look/tiers.ts`), so four physically large M2 parts sit below the density standard at their class size (GUTTER 704, VORTEX 399, TRAP BOX 794, BIG TOP 811 px/m), accepted in [D100](docs/dev/DECISIONS_2026-10-24.md). Sets ship as KTX2 / BC7 from the in-house encoder, with PNG as source and fallback (D97); UASTC isn't used.
- Albedo stays within linear 0.03–0.85. Powder-coat colours are swatches in the library (`kn_powder_ignition`, `kn_powder_volt` ...).
- Bevels: every hard edge ≥ 2 mm or 1.5 % of the part's size, with weighted normals. For thin or resizable parts, the 1.5 % is of the smallest cross-section dimension, not the full length. Toy-premium read.
- **Wear, "loved, not grimy":** worn paint and polish on edges, handles and contact points only. No rust, dirt or grunge (ART_BIBLE §4).

### 19.8 CC0 and provenance
- **Ship-allowed:** CC0 HDRIs (Poly Haven), CC0 tileable textures as inputs to our masters (Poly Haven, ambientCG), and CC0 audio as raw material.
- **Placeholder only:** CC0 models (Kenney, Quaternius, Poly Pizza CC0) for M0/M1 greybox. CI blocks them from release builds.
- **Never:** anything traced from or derived from the 1993 sprites, names or audio.
- `assets/LICENSES.csv` logs every third-party input (asset, URL, licence, date, used by). CI fails on unlisted files in `assets/src/third_party/`.

---

## 20. Accessibility and comfort
- **Photosensitivity:** "Reduce flashing" is on by default (≤ 3 large flashes per second, capped flash luminance). Booms stay huge, flashes get capped.
- Sliders for camera shake (default 70 %), hitstop, auto slow-mo and director cut rate. Reduced-motion mode removes auto-cuts, slow-mo and heavy post FX, including the Build/Run depth of field (which also has its own switch in Settings › Graphics).
- **Reduce transparency** (Settings › Accessibility) swaps every glass panel for solid Graphite. It is automatic on the 4 GB tier and when the UI goes over its frame budget ([D77](docs/dev/DECISIONS_2026-10-24.md)).
- Channel overlays are colour-blind-safe (glyph-coded, with alternate palettes).
- Full keyboard building: [ / ] cycle parts, arrows nudge by the snap step, Enter picks up and places, and the command palette reaches everything. All keys are remappable. UI scale 75–200 %.
- Event captions ("💥 Powder Keg ×6"), critter emote text and screen-reader labels on all DOM UI.

---

## 21. Milestones

Assumed team: 2 graphics/engine, 2 sim/gameplay, 1 tools/UI engineer, 1 tech artist, 3 modellers, 1 animator, 1 UI/UX designer, 1 producer/designer, audio contractor ([docs/PRODUCTION.md §1](docs/PRODUCTION.md)). Durations are rough. Part lists follow the **Ship** column of §12.

| Milestone | Length | Scope | Exit criteria |
|---|---|---|---|
| **M0 Foundations** | 5 wks | `gpu-core` + tier probe; GPU-driven instancing at 100k; Jolt deterministic MT WASM build + 4-browser hash matrix; coordinator ordering; bake-ahead prototype; **Matter determinism spike** (fixed-point PBD, 4 GPU vendors); **3D build UX greybox** (work planes, snapping, path tool); Blender → engine for 1 part | Hash match on 15 greybox machines; Matter spike match (or fallback decided); first-time users place and connect 10 parts in < 5 min |
| **M1 Vertical slice** | 10 wks | **2-player co-op** (Host Server, op log, locks, presence, shared run, hash checks); Build/Run/Stop, dock, library, inspector, undo; channels Impact/Signal/Spin/Tension/Power/Heat + explosions; **every Ship = M1 part (25)** (Thud, Boing, Helio, Brik, Plank, Slope, Tube, Ledge, Fulcrum, Anchor, Sheave, Treadway, Band, Line, Cog, Motor, Gale, Mains, Stomp Pad, The Button, Wick, Fuse, Bangstick, Snipper, Topple Tiles); Studio; UI design system v1; URL sharing; audio v1 | A 40-part machine replays identically in 4 browsers; two simulated-latency clients build and run together for 1 hour with zero desyncs; Room world at tier target |
| **M2 Core set** | 10 wks | Every Ship = M2 part (29): the remaining parts that have a 1993 ancestor plus Gutter, Vortex, Flap, Cell, Toggle, Ringer, Delay (Fishbowl uses a cosmetic water burst until M4) + Mochi, Pip, Goby, Bandit; Light/Air/Sound/Lure channels; X-ray, cutaway, outliner, modules; director, ride and overview cams; Mega Kitchen | Every goal type in the Appendix A taxonomy can be built |
| **M3 Kaboom + Scale** | 9 wks | Every Ship = M3 part (30): pyro and contraption expansions, optics and wireless (Lance, Mirror/Splitter, Tripwire, Ping, Maglock), Glint/Bearing, Glidepath, Spindeck, Lift, Rack, Ram, the Fun set (Pins, Stackers, Pane/Vase, Tonebars, Ding), Fabricator/Recycler, Zones; fracture, volumetrics, decals, SDF GI; Warehouse/Arena/**Megastructure** + Backlot terrain; time dilation and bake-ahead polish; Share service; Cascade Report. **Look and feel pivot** ([D77–D79](docs/dev/DECISIONS_2026-10-24.md)): **THE TINKER LAB** (Desk, Room; the new default), the shared props kit, the Mega Kitchen maximalism pass, the part texture pass (M1 parts first; new parts authored textured), the Glass Lab UI, and the renderer look pass (texture arrays + detail layer, light shafts, tilt-shift DOF, warm LUTs) | "Kiloton" and "Domino Day" hit tier targets; a 1M-part world loads in < 20 s; an in-engine Tinker Lab frame passes the side-by-side review against the Cycles key art |
| **M4 Matter** | 8 wks | Every Ship = M4 part (15): Matter gameplay parts (except Goo Vat), Blowout/Vac/Inflator, Arc Tower, Toast Cannon, Yolk, Zippy, Quack + Biscuit, Henny, Dusty; offline render capture; accessibility pass | "Sandstorm" deterministic on 4 vendors at the 16 GB tier |
| **M5 Future Tech** | 6 wks | Every Ship = M5 part (11): Rift Gates, Grav Well, Tractor Beam, Hover Pad, Force Wall, Coilgun Ring, Stasis Field, Buzz Beacon, Singularity, Grabber, Goo Vat + Buzz; Orbital Hangar, Moon Base; tier tuning; polish and the beta | Feature-complete sandbox beta, with all docs current ([D106](docs/dev/DECISIONS_2026-10-24.md)): every Ship ≤ M5 part, critter and environment playable with art, audio, captions and HOW_TO_PLAY; a `playtests/` log started; the full suite and soaks pass; the D91 matrix re-run on the final kernels |

**Total ≈ 48 weeks to beta.**

**Status (2026-10-25):** M0–M5 are complete on Chrome (status docs in [docs/dev/](docs/dev/)); the work ran as parallel agent streams, not the team above (D83). Exits as run: M1's "4 browsers" became Chrome + Node (D51); M3's benchmarks passed as Bake & Watch playback (D89) and now simulate in real time (D99); M4's "4 vendors" ran on the test system's four implementations (D91). **M5** ([M5_PLAN.md](docs/dev/M5_PLAN.md), [M5_STATUS.md](docs/dev/M5_STATUS.md)) delivered the parts (A5), BUZZ (B5), the Hangar and Moon with global wind (W5, E5c), the Future Tech effects and M4 render polish (R5), audio and clip sound (F5), UI and beta polish with the first `playtests/` entry (U5), goo, GOO VAT and world-following Matter gravity (X5), the co-op hash-report fix (D108) and this docs pass (D5). Designed-but-unbuilt features are post-beta (D107).

---

## 22. Risks and open questions

| Risk / question | Mitigation |
|---|---|
| **3D building feels slower than 2D** | Highest design risk. Paper prototype in week 1, greybox in M0, weekly playtests, wall-plane mode as the comfort fallback. Measure time-to-first-chain. |
| Jolt cross-platform determinism in our WASM build | M0 matrix gate. Fallback: Rapier3D deterministic (single-threaded, lower ceilings). *Passed:* Chrome = Node, and 1 / 4 / 12 threads give identical hashes (M0, D99). |
| **Matter-layer determinism and coupling** | M0 spike across 4 GPU vendors. Fallback: Matter goes cosmetic, and gameplay fluids use CPU packets. *Passed* on the D91 matrix (M4); real AMD / Intel / Apple GPUs are still untested. |
| VRAM is unknowable in browsers; device loss | Conservative probing, tiers, user override, no single buffer > 1 GiB, device-lost recovery from CPU state and checkpoints. |
| Megastructure sim cost | Sleeping, merged static compounds, time dilation, bake-ahead, Test-run selection. Communicate "SIM 0.3×" as a feature, not a bug. |
| COOP/COEP required (threads, SAB) | The hosted build sets the headers. Embeds get a "pop out to play" link. |
| Content volume (~540 artist-days after the D78 texture pass, props kit and Tinker Lab; ~395 before) | Strict class budgets, a shared Port Ring, material library and props kit, procedural animation first, greybox-first gameplay. *Resolved by D83:* the art is built by parallel agent streams, so M3 and M4 kept their full art scope without slipping ([docs/PRODUCTION.md §3](docs/PRODUCTION.md)). |
| Busy sets and glass UI hurt readability or frame time | Density zoning (clean build zone, background a stop darker), the glass legibility guard, at most 6 glass surfaces, Reduce transparency and the automatic solid fallback, the D79 tier drop order. |
| Name and trademark | Run a trademark search on "KNOCK-ON" and the part names before any public use (alternatives: OVERREACTION, CASCADE LAB). Nothing from the 1993 game ships. |
| Removing the gun | Cork Blaster keeps the gameplay role without realistic firearms. Confirm with design. |
| Multiplayer desyncs | Same determinism gates as single player, plus a two-client soak test in CI (random ops, runs and pokes, 150 ms latency, 2 % loss). Automatic checkpoint repair and desync reports. |
| WebGPU needs a secure context | Use `http://localhost:8787`, which browsers treat as secure for development; the `/check` page diagnoses it. |
| Uneven hardware between friends | Session capacity = lower tier; shared playhead waits for the slower bake head; Solo preview for local iteration. |
| Open | 3–4 builders and spectators, WebRTC voice, puzzle and challenge mode, gamepad/touch, monetisation. Post-beta. |

---

## Appendix A: Origins research (1993 data, reference only)

Decoded from `The-Incredible-Machine_DOS_EN.zip` with `tools/tim1-extract/tim1_extract.py`. Outputs are in `reference/tim1/`.

- **Archive:** `RESOURCE.MAP` indexes 4 data files (159 resources: 58 bitmaps, 87 levels, palettes, fonts, sound bank, overlays). Each map entry is (u32 hash, u32 offset); each resource is a 13-byte name, a u32 size, then the payload.
- **Sprites:** `BMP:` → `INF:` (frame count, widths, heights) → `SCN:` → `OFF:` (frame offsets). SCN row opcodes (top 2 bits, 6-bit n): `00` next row, x −= n; `01` skip n; `10` run of n pixels in the next byte's colour; `11` n literal 4-bit pixels. 16 colours.
- **Levels:** magic `ED AC 02 01`, title, goal text, two bonus values, **gravity** (67 standard; 0–1 on the moon), **air pressure** (≈268–272 standard; ≈145 on the moon), music, then fixed-size part records.
- **Freeform saves (`.TIM`):** the same magic, gravity, air, music, part count, then 48-byte part records (type, flags, size, position on an 8 px grid, link slots).
- **Part IDs** (index: part): 0 bowling ball · 1 brick wall · 2 incline · 3 teeter-totter · 4 balloon · 5 conveyor · 6 mouse-cage motor · 7 pulley · 8 belt · 9 basketball · 10 rope · 11 cage · 12 cat · 13 jack-in-the-box · 14 gear · 15 fishbowl · 16 bellows · 17 bucket · 18 cannon · 19 dynamite · 20 bullet FX · 21 outlet + switch · 22 dynamite + plunger · 23 eye hook* · 24 fan · 25 flashlight · 26 generator · 27 gun · 28 baseball · 29 light bulb · 30 magnifying glass · 31 monkey bike · 32 jack-o-lantern · 33 heart balloon · 34 Christmas tree · 35 boxing glove · 36 rocket · 37 scissors · 38 solar panel* · 39 trampoline · 40 windmill · 41 explosion FX · 42 mouse · 43 cannonball · 44 tennis ball · 45 candle · 46 pipe · 47 pipe elbow · 48 wood wall · 50 electric motor · 56 mouse hole. (*inferred)
- **Goal taxonomy** (87 levels, for a future challenge mode): deliver to a place (~22), pop (~12), ignite/launch (~16), creature goals (~14), switch on (~7), break (~4), protect / negative goals (~6), low-gravity variants (4).
