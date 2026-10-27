# M4 status: Matter

Last updated 2026-10-25.
- **Plan and scope:** [PRODUCTION.md §2 M4](../PRODUCTION.md); streams, ownership and contracts in [M4_PLAN.md](M4_PLAN.md).
- **Per-stream notes:** `M4_NOTES_{MX,MI,A4,B4,R4,C4,U4,F4,J4,V4,E4a,E4b,E4c}.md`.
- **Decisions:** D91–D100 in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md), plus the follow-up D101 (water buoyancy).
- **Exit report:** [M4_SANDSTORM_MATRIX.md](M4_SANDSTORM_MATRIX.md).
- **Previous milestone:** [M3_STATUS.md](M3_STATUS.md).

**M4 is complete on Chrome.** The exit criterion passes on the D91 matrix, and every PRODUCTION §2 M4 deliverable is built. Everything carried into M4 is done too: multithreaded Jolt, the M2 texture pass, the VRAM governor, KTX2 and the Megastructure colliders. What's left is under "Known limits".

## Exit criterion

| Criterion | Result |
|---|---|
| **"Sandstorm" deterministic on 4 vendors at the 16 GB tier** | **PASS on the D91 matrix.** The scene is 4,000,000 sand grains (the 16 GB tier's budget) avalanching down a 36° valley through a turning WATERWHEEL. It ran on four independent implementations: the Node CPU reference, NVIDIA D3D12, NVIDIA D3D11 and Google SwiftShader. Every pair is identical on every compared tick: the Matter checksum, plus all 9 wheel proxies' 64-bit impulse sums. Ranges: all four over ticks 1–30, which covers the release, the landing and the first wheel impacts; CPU = D3D12 = D3D11 over 1–120; D3D12 = D3D11 over 1–600. Re-run on the final kernels (a kernel file changed after the first GPU legs): bit-identical again, and identical to the first run. |

**What "4 vendors" means here (D91):** the test system has one GPU (RTX 5090). The four implementations are two NVIDIA driver and compiler paths (Dawn D3D12 and D3D11), Google's SwiftShader (a different vendor's compiler, run on the CPU), and the integer CPU reference, which is an independent implementation of the same algorithm. Real AMD, Intel and Apple runs stay open until hardware can be borrowed (D51). Adding one is another entry in `tools/vendor-matrix/run.mjs`.

**Speed:** determinism is the exit, and 4M grains don't fit the 60 Hz Matter budget.
- **1M grains:** 11.4 ms per Matter tick, which fits.
- **4M grains:** 54.5 ms per tick for a settled box, and 94–189 ms for the Sandstorm avalanche on D3D12. In-game Sandstorm runs time-dilated (0.33–0.8× real time), as D92 allows.
- **Rendering:** Matter rendering costs 1.49 ms at 4M grains on the 16 GB tier (budget 1.5 ms).

## Release checks

| Check | Result |
|---|---|
| Typecheck | 0 errors |
| `pnpm lint` (determinism) | clean |
| Tests | **2,174 pass**, 3 skipped by design, in 69 files, including the asset suite (1,472 pass, 16 files). No golden re-pinned outside its own stream; every M1–M3 hash is unchanged. |
| Threaded Jolt hash matrix (J4) | Identical at 1, 4 and 12 threads in Node and Chrome: all 111 Library demos, Kiloton, Domino Day, late-poke rollback, checkpoints moved between builds |
| 2-player soak, 10 min, 8 Jolt threads | **PASS.** 15 runs, 75k ticks, 1,170 / 1,170 hashes matching, 245 pokes, 75 / 75 rollbacks matching. 0 desyncs, 0 resyncs, 0 errors. |
| Critter soak (B4, 10 min, all 7 critters) | **PASS.** 144 scenarios, 3.11 M ticks, 34,560 hash checks, 0 desyncs, 144 / 144 rollbacks, 0 failures |
| Critter soak, 8 Jolt threads (orchestrator, 15 min) | **PASS.** 25 scenarios, 6,000 hash checks, 0 desyncs, 25 / 25 rollbacks, 0 failures. Coverage is thin because the CPU was loaded by the KTX2 encode. J4's one unexplained threaded divergence (1 in 194 runs, while B4 was editing critter code) did not recur. |
| Chrome 155, production build, local test server | Cross-origin isolated; no console errors (the only 404 is the expected `.cube` LUT probe); all 105 texture sets load as KTX2 / BC7. A run with a dropped FISHBOWL, the new critters, QUACK and ZIPPY: 11,251 Matter water particles on the GPU backend, Biscuit barks, Henny lays a YOLK, QUACK squeaks in the water. |

## Deliverables (PRODUCTION §2, M4)

| Workstream | Delivered |
|---|---|
| **Matter core (MX)** | The production solver, integer-only, in `packages/matter`.<br>**Materials:** sand, water (a double-density PBD fluid) and marbles.<br>**Mechanics:** emits, intakes with capacity, blasts, and the four proxy shapes with 64-bit impulse sums. Grain queries (`near`) are in.<br>**CPU = GPU proof:** the CPU reference (also split across worker threads) and `MatterGpu` (31 kernels) give the same bits every tick, and MATR snapshots are byte-identical.<br>**Exit runner:** `tools/vendor-matrix` drives headless Chrome over its own CDP client, with no dependencies. |
| **Matter in the game (MI)** | **API:** `machine.matter` (contract 2) with SIMULATION §8.5's fixed latency, automatic proxies (at most 4,096) and static set proxies.<br>**Browser path:** the GPU backend runs on the renderer device (D92). Commands go through a SharedArrayBuffer with `Atomics`, and the sim waits rather than skips.<br>**State:** a Bake & Watch playback replica, rollback with Matter records, and the Matter checksum in the state hash. Checkpoints use KNCP (JOLT/ECS/MATR). Device-loss replay leaves outcomes unchanged.<br>**Header:** `simFlags` / `requiredTier` / `counts.grains`. Desync repair goes up to 64 MB (a 1M-grain world took 7.7 MB).<br>**Matter hooks:** FISHBOWL breaks into Matter water; GOBY rides his bubble to water; SCOOP intakes; FUZZ floats.<br>**Kitchen "Fill the sink" (D98):** 1M particles, the same on every machine, and requires the 16 GB tier.<br>**Sandstorm** is a demo world. |
| **Parts (A4)** | **The 15 Ship = M4 parts:** GRIT HOPPER, HOURGLASS, TANK, SPRINKLE CAN, WATERWHEEL, SPONGE, MARBLE HOPPER, BLOWOUT, VAC, INFLATOR, ARC TOWER, TOAST CANNON, YOLK, ZIPPY (a real Jolt `WheeledVehicleController`) and QUACK. Each has a def, behaviour, card, demo, golden and fuzz entry, plus Matter-on tests on the CPU backend.<br>**Events:** Valve, Empty, Flip, Squeak, Arc, Overfill, Squeeze, Drive.<br>**Format:** a `fill` link kind. |
| **Critters (B4)** | **BISCUIT** wakes, chases MOCHI (who now flees him), barks (a 70 dB Sound) and barges.<br>**HENNY** startles, flaps and lays YOLKs from a dormant pool.<br>**DUSTY** patrols a drawn zone, finds grains with `near()`, vacuums them (getting heavier and slower), bump-turns and tumbles.<br>Wire tables grew by append only (FSM 50, clips 53, emotes 31). B4 also fixed a rollback desync from Jolt's relative `ScaleToMass`. |
| **Rendering + VFX (R4)** | **Matter:** sand and marble impostors (exact spheres up close, buried grains culled, GLINT/BEARING meshes near the camera) and SSFR water (refraction, Beam tint, Fresnel, meniscus, foam, seen through glass shells).<br>**Fill pass:** clips E4a's cavity meshes at any tilt.<br>**VFX:** arc bolts and sparks, egg splat, splash and foam, sand puffs.<br>**Recovery:** rebuilt after device loss. |
| **Capture (C4)** | **Offline render** at a frame-exact clock.<br>**Formats:** MP4 through WebCodecs (AV1 → HEVC → H.264) with our own muxer; GIF and animated WebP with our own encoders (D94).<br>**Photo mode (F10)** up to 8K.<br>**Capture dialog**, plus the Cascade Report's Share card and Record clip.<br>**Matter in capture:** the replica waits for each frame's exact tick (orchestrator fix). |
| **Accessibility + UI (U4)** | **WCAG 2.2 AA audit:** 11 screens × 6 modes, all ≥ 4.64:1 after fixes (D96).<br>**Captions**, a rate-limited live region, and full keyboard building (16 of 16 scripted steps with no mouse).<br>**Colour-blind support:** CVD-optimised channel palettes plus port glyphs.<br>**M4 UI:** the Matter tray and grain meter, Dusty's patrol-zone tool, and inspector fields.<br>**HOW_TO_PLAY.md** updated. |
| **Audio (F4)** | Cues for the 15 parts, three critter voices, and Matter granular audio from a 288-byte GPU reduction around the listener. Within 64 voices and under the −1.05 dBTP limiter (worst −1.03). |
| **Multithreaded Jolt (J4)** | **Shipped (D99)** with the installed build: a contact buffer filled by a same-origin worker script and sorted canonically.<br>**Speed:** Kiloton 2.3–2.7 ms/tick and Domino Day 1.5–1.6 ms/tick, both in real time.<br>**Safety:** a 10 s single-thread fallback.<br>**Megastructure:** dressing colliders now load (160 boxes). |
| **VRAM + KTX2 (V4)** | **Governor:** a VRAM ledger, a boot probe, a step-down governor, and device-loss recovery (≈ 0.3 s).<br>**KTX2 / BC7 ships (D97)** from an in-house encoder: albedo ≥ 53 dB and normals ≤ 0.48° mean error. It is bit-exact with the 5090's hardware decode, and VRAM drops from 7.00 GB to 3.25 GB at 16 GB. All 105 sets are encoded. |
| **Art (E4a, E4b, E4c)** | **E4a:** the 15 parts plus `toast_slice`, validated with 0 errors, with cavities and 64-entry fill LUTs (`kn_tools/cavity.py`).<br>**E4b:** BISCUIT, HENNY and DUSTY, rigged, with clips, face keys or an LED face, ragdolls matched to the sim, and texture sets.<br>**E4c:** the M2 texture pass on all 29 parts (D100), plus the bake and calibration fixes.<br>**Sheets:** `m4_parts_textured.png`, `m4_critters.png`, `m4_textured_m2.png`. |
| **Orchestrator** | **Critters in game:** the skinned path renders the M4 critters with their texture sets, `clipInfo` loop flags, new face keys and lit LED panels.<br>**Pooled pieces:** TOAST CANNON slices and HENNY's eggs draw with their art.<br>**Emote glyphs** for the new emotes.<br>**Frame-exact capture of Matter** (`playbackTo`).<br>**Dusty test:** the rollback test is independent of find timing.<br>**Tooling and assets:** a `?critters=` option on the hero harness, the full KTX2 encode, the M2 icon re-render, and JITTERJUICE's cavity re-export.<br>**Docs:** D96–D100 recorded; RENDERING §11, ASSET_PIPELINE §5.2, SIMULATION §4 and UI_UX §3 updated. |

## Decisions this milestone

- **D91** The 4-vendor exit runs on the test system's four implementations; real AMD, Intel and Apple GPUs stay open.
- **D92** Matter runs on the renderer device, commanded by the sim worker; time dilation is allowed.
- **D93** The materials are sand, water and marbles; goo comes in M5.
- **D94** No third-party encoders.
- **D95** The carried-in items are in scope.
- **D96** Run HUD text never fades below 4.5:1, and the compact layout switches on by height too.
- **D97** BC7 in KTX2 ships.
- **D98** Fill the sink: 1M particles, sized for 16 GB and the same on every machine (producer call).
- **D99** Multithreaded Jolt ships.
- **D100** The M2 texture size calls.
- **D101** (follow-up) Water buoyancy comes from a backend water-surface map and Jolt's `ApplyBuoyancyImpulse`, not from the particles.

## Known limits (carried to M5)

**Matter solver** (M4_NOTES_MX):
- 4M grains run dilated. The sand contact kernel is 80–85 % of a tick.
- Deep piles compress, and resting beds start sluggishly.
- Water still has little hydrostatic pressure inside the fluid: the particles alone give a resting body ≈ 4 % of ρgV. **Floating is fixed by D101:** bodies float on Jolt's buoyancy against a backend water-surface map (SIMULATION §8.6). Measured: lift = m·g, and Archimedes' depths. Still open:
  - pressure inside the fluid (a column's weight on a sluice gate);
  - a body in a container barely wider than itself: the level is read in a 2 cm ring around the body, which then lies outside the water, so it gets no buoyancy;
  - one level per body, so a long body across two water levels uses their mean;
  - ~~QUACK's hull is a uniform box, so it also floats stably on its side or upside down.~~ **Done in M5 (X5):** QUACK's def carries a weighted keel (`body.com`, the centre of mass 10 mm lower), so it rights itself from any landing; its golden was re-pinned (M5_NOTES_X5).
- Above 1.875 m/s per component, grains can tunnel.
- Light bodies over-reacting to the fixed two-tick coupling latency: **done by D101.** The host's Δv limiter is in, and in-water sub-shapes no longer take the particles' delayed upward push and torque.

**Coverage:**
- Real AMD, Intel and Apple GPUs are untested (D91).
- The Matter-on critter soak covered only 2 scenarios, because the CPU backend is slow. Matter rollback is covered by tests.
- A4's Matter-on part tests assert behaviour but don't pin hashes.

**Rendering:**
- Water casts no shadows and has no caustics.
- Cutting through a pile shows it hollow, because buried grains are culled.
- Arcs are built on the CPU.
- MARBLE HOPPER's contents are relief only.
- DUSTY's LED face doesn't switch between its 12 icons; it shows lit panels.
- TOAST CANNON's loaded-slices node stays visible after launch.
- Kitchen wet-darkening has no wetness mask yet.
- GUTTER in play still uses flat masters.
- Instances at a non-1 scale show dark patches.

**Capture:**
- Clips are silent; that needs offline audio and a second MP4 track.
- Capture above the 8192 texture limit downscales instead of tiling.

**Threads:**
- The thread count isn't a player setting yet (`start.joltThreads` exists).
- The browser pane with Vite HMR falls back to single-threaded.
- Kiloton's blast second sits at or just over 7.5 ms at 8–12 threads.

**Other:**
- There is no in-game `matterGameplay` toggle: new worlds are on, and pre-M4 files are off.
- Over 100k bodies, the Matter active-region check should use the broadphase.
- UASTC / ASTC (Apple) isn't done.
- Downloads are 34 % larger with KTX2.
- Four large M2 parts sit below the texture-density standard (D100).
