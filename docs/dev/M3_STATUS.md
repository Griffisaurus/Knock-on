# M3 status: Kaboom + Scale, and the look-and-feel pivot

Last updated 2026-10-24. Plan: [PRODUCTION.md §2 M3](../PRODUCTION.md). Streams, contracts and rules: [M3_PLAN.md](M3_PLAN.md). Per-stream notes: `M3_NOTES_{A3,S3,G3,L3,U3,E3a,E3b,E3c,F3}.md`. Decisions D77–D90: [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md). The review gate: [M3_D79_REVIEW.md](M3_D79_REVIEW.md). Previous milestone: [M2_STATUS.md](M2_STATUS.md).

**M3 is complete on Chrome.** All three exit criteria pass on the 16 GB tier, and the 32 GB tier (D85) is measured alongside it. Every PRODUCTION §2 M3 deliverable is built, apart from the items under "Known limits".

**Producer action:** Chromium hides the GPU name from WebGPU, so the game can't detect the RTX 5090 on its own. To get the 32 GB tier and its GI, open **Settings › Graphics**, set Quality tier to **32 GB**, then reload the page. The choice is saved per viewer. Before the M3 review this setting changed only the glass UI and never reached the renderer; it's fixed now (D90).

## Exit criteria

| Criterion | Result |
|---|---|
| **"Kiloton" and "Domino Day" hit their tier targets** | **PASS**, as Bake & Watch playback (D89). The target is 60 fps, so 16.7 ms GPU per frame, at 4K output. See the table below. |
| **A 1M-part world loads in under 20 s** | **PASS.** On the 16 GB tier it takes 8.6 s from `join` to ready to run with the pane focused, and 19.1 s unfocused (the worst case). On 32 GB, unfocused, it's 17.9 s. The first frame arrives in 1.6 s (focused). |
| **The in-engine Tinker Lab hero frame passes the side-by-side review** | **PASS** at the M3 review, recorded in [M3_D79_REVIEW.md](M3_D79_REVIEW.md) (the producer can overturn it, as with D80–D84). The first pass failed: the bottom third was +1.05 EV too bright and too cold, with the wrong floor colour and wavy grain. After the fixes, whole-frame exposure is +0.04 EV, the worst of 12 regions is 0.72 EV, and warmth and saturation are in range. The gate's 8 GB playtest also passes: legibility at least 4.66:1 over the live render, Reduce transparency works live, GPU 0.6 ms. Images: `art/style-samples/tinker_lab_compare.png`, `tinker_lab_engine.png`, `tinker_lab_review_m3.png` (before and after). |

**Benchmarks** (4K output, Bake & Watch playback, worst 1 s window, median (max)). Methods are in M3_NOTES_S3 and M3_NOTES_G3.

| | Kiloton | Domino Day |
|---|---|---|
| Scene | 400 BANGSTICKs, 60 POWDER KEGs, Brik fortress, Arena · 3,917 parts | 100k TOPPLE TILEs, Megastructure, director cam · 102,560 parts |
| 16 GB tier | **4.0 ms (4.5)**, on a quiet GPU after G3's fixes. S3's earlier run measured 14.3 ms (20.1) while other streams were loading the GPU. | **1.0 ms (1.8)**. The worst GI frame is 1.8 ms. |
| 32 GB tier | **7.8 ms (8.9)**. The worst single spectacle frame is 4.19 ms. | **2.5 ms (2.9)**. The worst GI frame is 3.9 ms. |
| Bake (20 s of sim) | 52 s wall clock (46 ticks/s), 19 MB of keyframes | 42 s wall clock (58 ticks/s), 44 MB |

Neither scene simulates in real time on one core. Single-threaded Jolt manages 46–66 ticks/s against the 120 Hz sim rate. That's why both demo worlds open in Bake & Watch, which bakes first and then plays back (D89). Multithreaded Jolt is M4 work.

**At 2M parts on 32 GB** (D85, unfocused): an 11.2 MB file, first frame in 6.8 s, the Machine built in 30.2 s, and a GPU frame of 10.6 ms at the preset camera.

## Release checks

| Check | Result |
|---|---|
| Typecheck | 0 errors |
| Tests | **1,545 pass** (49 files), with no golden re-pins. Asset tests: 1,127 pass (13 files). |
| `pnpm lint` (sim / parts-data determinism) | clean |
| 2-player soak, 10 minutes, with a late join and pokes | **PASS.** 15 runs, 75k ticks, 1,170 / 1,170 hashes matching, 238 pokes, 76 / 76 rollbacks matching. 0 desyncs, 0 resyncs, 0 errors. |
| Critter soak, 5 minutes plus 2 more | **PASS after the fix below.** The 5-minute pass ran 131 machines, 2.83 M ticks and 31,440 hash checks, with 0 desyncs, 131 / 131 rollbacks matching and 0 failures. It visited all 33 / 33 FSM states, with 70 steals, 69 bowl breaks and 674 ragdolls. A 2-minute pass from seed 125, through the seed that failed, ran 57 machines with 0 desyncs and 0 failures. |
| Chrome, production build, local test server | No console errors. Loading the Tinker Lab world fetches every M3 part's glb, art and texture set. The only 404 is `lut_tinker_lab.cube`, an expected probe before the `.png` LUT. |

**Found and fixed at close-out:**

- **A rollback desync after a Bandit steal.** The first critter soak failed one of its rollback runs (seed 133). When Bandit grabs an item, the item becomes a ghost: a different object layer and gravity 0. Jolt's saved state records neither. After a restore, `CritterSystem.afterRestore` re-ghosted the items carried at the restored tick, but it never un-ghosted an item grabbed *after* the checkpoint. That item stayed a weightless ghost, and the re-simulation diverged two ticks after the checkpoint. The system now remembers which parts it has ever ghosted and hands any that aren't carried back to the world first. Regression test: `critters.test.ts`, "a rollback across the grab…", which fails without the fix.
- **The D79 review's fixes** (details in [M3_D79_REVIEW.md](M3_D79_REVIEW.md)):
  - E3b's floor master now uses the key art's warm brown.
  - The procedural wood is fine and straight.
  - The GI's analytic floor moves to the set's real floor (it sat at the Desk's bench top), and the set's collider boxes join the SDF (`Gi.setStatic`). Probe misses see the set IBL.
  - Inside a set, SDF occlusion covers the rim light, glossy IBL specular and the unshadowed practicals.
  - Cost from 12 GB: about 0.45 ms at 16 GB and 0.9 ms at 32 GB (4K). The Studio is unchanged.
- **Settings › Quality tier didn't reach the renderer.** The renderer, effects and network client used the detected tier, so choosing 32 GB never turned on the 32 GB tier. The choice now applies at boot, with a "reload to switch" toast when it changes. Verified at 8 GB in the playtest.
- **The limiter was blocked by the CSP.** The host's CSP (`script-src 'self' 'wasm-unsafe-eval'`) blocks Blob URLs. F3's master limiter loaded its AudioWorklet from one, so in production builds it quietly fell back to no limiting. The processor is now a same-origin file, `apps/game/src/audio/limiter-processor.js`, imported with Vite's `?url`. Re-checked in Chrome: no CSP error.

## Deliverables (PRODUCTION §2, M3)

| Workstream | Delivered |
|---|---|
| **Sim (A3)** | **Parts:** the 30 M3 catalogue rows, which make 35 part types plus the GLIDEPATH link. Each has a def, behaviour, card, demo, per-part golden and fuzz entry.<br>**Optics:** LANCE, MIRROR, SPLITTER and TRIPWIRE extend the Light channel.<br>**Pools:** pieces and pools are pre-built dormant (D66), with pool slots in plain state.<br>**Fracture:** PANE (24 chunks) and VASE (16) break through `Machine.shatter`.<br>**Rollback:** `Machine.hiddenBody` keeps out-of-play bodies from being pushed (rule 8, `rollback_hidden.test.ts`). |
| **Scale (S3)** | **Presets:** Desk, Room, Warehouse, Arena and Megastructure (`presets.ts`). Jolt capacity scales with the world, including contacts at 4 per part. This fixed Kiloton's bricks sinking when Jolt silently dropped contacts.<br>**Big worlds:** a grown Jolt heap, a checkpoint plan for big worlds, and a cheaper host join (no re-encode or rewrite per join).<br>**Backlot terrain:** the `TERR` format section. M2 hashes are unchanged.<br>**Impostors.**<br>**Bake & Watch** with the BakeStore.<br>**Share links.**<br>**Benchmark harness:** `apps/game/bench/`.<br>**Default environment:** THE TINKER LAB is now the default for Desk and Room. |
| **Spectacle graphics (G3)** | **Effects:** volumetric smoke and fire grids, the debris pool, shockwaves, light beams, the glidepath ribbon, pools, hitstop and slow-mo.<br>**TAA.**<br>**GI:** a probe and SDF clipmap, built as budgeted jobs.<br>**Spectacle governor:** steps quality down when frames run long and back up when they recover.<br>**Init-time priming** of GPU pools. |
| **Look graphics (L3)** | **The D79 look:** texture-set arrays (16-texture fallback), ORM metallic and tangents, GTAO, SDF contact shadows, froxel light shafts, DOF, the LUT, vignette and grain, and IBL.<br>**Cost:** +0.63 ms at 16 GB and +1.85 ms at 32 GB. |
| **Glass Lab UI (U3)** | The HUD rebuilt to UI_UX v1.1 and the six approved mockup boards (D77, D80, D84, D86).<br>**Surfaces:** the world card with the Outliner, the session bar, the view rail, the Inspector, the Library, the command palette, the radial menu, Settings (with the 32 GB tier choice), the lobby and the Cascade Report.<br>**Contrast:** the worst text-on-glass case measures 4.93:1. |
| **Part art (E3a)** | **34 M3 part types:** Blender builders, LOD0–3, all textured (contact sheet `art/style-samples/m3_parts.png`). The glidepath booster art is included.<br>**Fracture meshes:** PANE and VASE. |
| **Environments (E3b)** | **THE TINKER LAB:** LOD0 315k tris, 193 collider boxes and 3 spheres per preset, an IBL bake and a LUT.<br>**Props kit:** 45 props in 128 variants.<br>**Mega Kitchen:** a maximalism pass.<br>**Backlot terrain art:** 4 layers, 175 dressing placements. |
| **Texture pipeline (E3c)** | Validator check 13, plus texture-set export to ASSET_PIPELINE v1.1 §5.2. The PNG files are interim (D88).<br>**M1 texture pass:** all 23 M1 meshes got D78 texture sets. |
| **Audio (F3)** | **Cues:** about 100 recipes for the M3 parts.<br>**Pyro:** chain merging and a barrage mode for Kiloton.<br>**Master limiter:** a −1.05 dBTP true-peak AudioWorklet.<br>**Spectacle hooks:** hitstop and slow-mo.<br>**Ambience:** a Tinker Lab bed with the ambient Mochi.<br>**Music v2.**<br>Everything is still procedural, with no sample files. |
| **Orchestrator** | **Tinker Lab colliders** in the sim: `buildTinker` and `buildKitchen` share `buildSet`, and the ambient Mochi capsule appears only when there's no MOCHI part.<br>**The 32 GB tier** (D85) through `caps`, the host session, the renderer, `fx` and Settings.<br>**World seeds:** each world seeds its runs from its id.<br>**Close-out fixes:** the Bandit steal rollback, the CSP limiter, the Settings tier, and the D79 review's set GI, occlusion and material fixes. |

## Decisions this milestone

D77–D79 are the look pivot. D80–D84 are the kickoff calls. Then:

- **D85:** the 32 GB tier for GI.
- **D86:** the selected-state gradient.
- **D87:** the Tinker Lab Desk build zone is the bench's 2.3 × 0.82 m cutting mat (provisional, waiting on the producer's review).
- **D88:** texture-set details.
- **D89:** the benchmarks run as Bake & Watch.
- **D90:** the D79 review's criteria, environment sets joining the GI, and the Settings tier reaching the renderer.

All are in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md).

## Known limits (carried to M4)

- **The sim isn't real time at Kiloton or Domino Day scale.** Single-threaded Jolt manages 46–66 ticks/s. Both scenes ship as Bake & Watch, and multithreaded Jolt is M4 (D89).
- **GI stalls under VRAM pressure on 32 GB.** When other processes held 26–31 GB of VRAM, Domino Day had 200–450 ms GI frames for about 2 s after load. That pattern fits WDDM paging. The RENDERING §11 VRAM governor isn't built.
- **The tier can't be detected in Chromium.** The adapter name is hidden, so the 32 GB tier has to be chosen in Settings (then reload).
- **Under the bench, the hero frame is still a little cool.** The bottom centre-right is less orange than Cycles' multi-bounce light (a note from the review). A probe for the Kitchen's own IBL would help too: Kitchen GI misses still see the sky.
- **Textures are PNG for now.** KTX2/BC7 transcoding isn't done (D88).
- **The Desk build zone is small** (D87). Widening the bench moves the hero frame away from the key art, so it waits for the producer's review.
- **The Megastructure has no dressing colliders yet.** The Backlot dressing is in the art (160 collider boxes in the Arena bounds), but the sim doesn't load it.
- **G3 left for later:** froxel fog injection for beams and grids, grid-to-particle conversion, the hero smoke sort, debris from the shared library meshes, and motion vectors for TAA.
