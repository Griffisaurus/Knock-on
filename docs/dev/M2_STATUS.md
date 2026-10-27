# M2 status: the full contraption toybox

Last updated 2026-10-24. **Look-and-feel pivot (D77–D79):** the M2 UI (`apps/game/src/ui/*`, `styles.css`) and the Studio look are a working first pass. M3 rebuilds them as the Glass Lab UI, THE TINKER LAB environment and the warm renderer look (PRODUCTION §2 M3). Plan: [PRODUCTION.md §2](../PRODUCTION.md). Streams and contracts: [M2_PLAN.md](M2_PLAN.md). Per-stream notes: `M2_NOTES_{A,B,C,D,E1,E2,F}.md`. Decisions D74–D76: [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md). Previous milestone: [M1_STATUS.md](M1_STATUS.md).

**M2 is complete on Chrome.** Both exit criteria pass, and every PRODUCTION §2 deliverable is built.

## Exit criteria

| Criterion | Result |
|---|---|
| **Every Appendix A goal type can be built** | **PASS.** `packages/sim/test/goal_types.test.ts` has one chained machine per goal type, each with a goal predicate (D76). See the table below. |
| **Critters stable through 30-minute soak runs** | **PASS** (`pnpm soak:critters -- --minutes 30 --run 60`). Results in the second table below. |

**Goal machines:**

| Goal type | Machine | Negative variant |
|---|---|---|
| Deliver | GUTTER → SCOOP | |
| Pop | BUTTON → CORK BLASTER → HELIO | |
| Ignite/launch | WICK → FUSE → SKYROCKET climbs past 10 m | |
| Switch on | STITCH flips a TOGGLE, MAINS lights the LAMP | Without the ball, the lamp stays dark |
| Break | RINGER → DELAY → BANGSTICK cracks a BRIK wall | |
| Protect | A SNIPPER frees a HELIO before a timed blast | Without the snip, it pops |
| Low gravity | At 17 % gravity the BIG TOP lobs a THUD onto a raised STOMP PAD | At 100 % it rolls under |
| Creature | A BOING wakes Pip in the HAMSTER DRIVE → DYNAMO → LAMP; the TRAP BOX traps Mochi | A sleeping Pip never spins the wheel |

**Critter soak (30 minutes):**

| Measure | Result |
|---|---|
| Scenarios | 773 machines with all four critters and the four critter-bound devices, plus bangsticks, loose balls, tiles and pokes. Each runs three times: straight, an identical replay, and a late-poke rollback. |
| Ticks | 16.7 M |
| Hash checks | 185,520, **0 desyncs** |
| Rollbacks | 773, all matching |
| Ragdolls / getups | 3,880 / 3,833. The 47 still tumbling when their scenario ended were all under 9 s. Longest tumble 7.99 s. |
| Failures | **0**: no non-finite body, no fall through the floor, no critter through static geometry (ray-checked every tick) |
| With test lures (3 min) | All **33 / 33** FSM states visited, including 41 steals and 117 eats. 19,680 hash checks with **0 desyncs** and 0 failures. |

## Deliverables (PRODUCTION §2, M2)

| Workstream | Delivered |
|---|---|
| **Sim** | **Channels:** Light (beams, mirrors to come, burning-glass focus, omni lamps, receivers), Sound (per-tick list, critter hearing), Lure (tagged and computed shiny lures), and Air extensions (PUFFER puffs, TURBINE rotor torque).<br>**Events:** each has an `id`, a `cause` and an optional `other`, propagated through contacts, signals, power, heat, fuses and explosions. The Cascade Report and the director camera use them.<br>**Critter AI:** a deterministic FSM, per-critter xoshiro streams, vision/hearing/smell/touch, capsule locomotion, and swing-twist ragdolls built dormant with the world (D66). Critters never die.<br>**Species:** Mochi, Pip, Goby, Bandit.<br>**Mega Kitchen colliders:** 212 boxes and 6 spheres per preset (D75).<br>**MOTOR:** on a DC torque–speed curve, so the toybox has no free energy (D74). |
| **Gameplay** | **The 29 Ship = M2 parts:** STITCH, FUZZ, PIG IRON · GUTTER, VORTEX, SPRONG, TRAP BOX, SCOOP, FLAP · DYNAMO, HAMSTER DRIVE, TURBINE, PEDAL RIG · PUFFER · CELL, SUNCELL, LAMP, TORCH, BURNING GLASS, TOGGLE, RINGER, DELAY · T-PLUNGER, SKYROCKET, BIG TOP, CORK BLASTER · PUNCHLINE, GOTCHA BOX, FISHBOWL. FISHBOWL uses its no-Matter fallback: a cosmetic splash, and Goby flops.<br>Every part has a def, behaviour, Library card, demo machine, and a per-part golden with behaviour assertions. All but the GUTTER link also have a property-fuzz entry. |
| **Graphics** | **Transmission:** a sorted glass pass with tint, Fresnel and refraction on the MSAA target.<br>**GPU skinning:** clip cross-fade, plus ragdoll-driven bones.<br>**X-ray** (links / all), **cutaway**, and a **section box** with hatched caps.<br>**Screen-space selection outlines**, for the selection, partner locks and hover.<br>**Cameras:** orbit, director (event- and cause-chain-scored, respecting the comfort cut rate), ride and overview.<br>**Mega Kitchen rendering** and GUTTER profile sweeps.<br>**Cost:** the 100k-part frame is unchanged (2.26 ms vs 2.32 ms). |
| **Tools/UI** | **Outliner:** layers → groups → parts, search, rename, hide/lock, drag to organise.<br>**Layers and groups:** new `LayerSet` and `GroupSet` ops.<br>**Modules:** the `.knockmod` format, Save/Place ops with deterministic id remapping, and a Library tab.<br>**Section-box tool.**<br>**Settings:** 8 tabs persisted per viewer, including remapping and the environment picker.<br>**Cascade Report v1:** longest cause chain, stats grid, Overreaction Score, click-to-scrub. |
| **Art** | **Parts:** all 29, built in Blender by `node tools/assets.mjs`. They pass validation with LOD0–3, decals, screens, clips and sockets, and appear on the contact sheet `art/style-samples/m2_parts.png`.<br>**Critters:** 4 rigged critters with 20–24 clips each, face shape keys, and `RAG__` capsules locked to the sim's ragdoll data (`m2_critters.png`).<br>**Mega Kitchen** (`m2_kitchen.png`).<br>**Validator rule 11**, for critters. |
| **Audio** | **Mechanisms:** 48 new cues and loops.<br>**Critter voices v1:** formant-synthesised and positional.<br>**Ambience:** Studio and Kitchen beds, ducked under action.<br>All procedural, within the 64-voice budget, and NaN-hardened. |

## Checked in Chrome (16 GB tier, final build)

- **Art:** every M2 part's art mesh is loaded. That's all 28 fixed meshes, including 15 glass shells and 7 moving arms (GUTTER is swept from its profile). A grid of all 28 parts plus the four critters renders with final art.
- **Mega Kitchen:** switching the world to the kitchen draws the real `kitchen.glb` set at kitchen scale. A run there worked with no console errors: 185 bodies, including 76 dormant ragdoll bodies, with critter emotes and states, a ragdoll and getup, a toggle, a ring, a launch, a fishbowl break and splash, and detonations.
- **World seed:** each world now seeds its runs from its id (`worldSeed(worldId)`, the same on both players). Critter variety therefore differs per world while staying deterministic.

## Closed after the first status pass

- **Part shape keys:** SPRONG, PUFFER, CORK BLASTER, GOTCHA BOX, BIG TOP and PUNCHLINE carry seven glTF morph targets. They're driven from sim state on the instanced part path, with no measurable cost at 100k parts.
- **FISHBOWL shatter:** it breaks into its 21 generated fracture chunks (`frac_fishbowl.ts`, `fishbowl.frac.glb`, the reusable `node tools/assets.mjs <type> --frac`). They're pre-built dormant convex-hull bodies at the part pose (D66), placed by the new `Machine.shatter`. Tests cover the scatter, staying above the floor, and replay plus late-poke rollback. A critter soak with 27 bowl breaks had 0 desyncs, and the shatter was checked in Chrome.
- **Critter faces and emotes:** emote bubbles, face shape keys, the CORK BLASTER cork and GOTCHA BOX head, and Bandit's carried item all render.

## How to check it

```bash
pnpm test
```

825 tests across 33 files:
- 24 M2 per-part goldens and 18 channel tests;
- 19 critter tests and 9 goal-type machines;
- the Mega Kitchen tests;
- rollback across a broken part;
- module, organise and cascade tests;
- 541 asset tests.

```bash
pnpm soak:critters -- --minutes 30
```

```bash
pnpm test:mp -- --minutes 60 --late 0.3
```

The M1 two-player soak still passes on the M2 code. A 5-minute regression run had 10 runs, 580 of 580 hashes matching, 43 rollbacks on each side, and 0 desyncs.

## Fixed along the way

- **Free energy:** the M1 MOTOR gave 30 N·m at any speed (D74).
- **Exporter:** LOD1–3 meshes under nested pivots exported offset. The fix is in `kn_tools/export.py`, and all M2 parts were rebuilt with it.
- **Rollback across a broken part (M1):** pokes and blasts could push a broken part's hidden bodies, and a rollback across that desynced. `Machine.hiddenBody` now skips them, with a test that fails without the fix.
- **Audio:** a non-finite AudioParam write could stop the frame loop.

## Known limits (tracked for M3+)

- **Bait parts for stealing and seed-seeking:** Bandit's steal and Pip's seek/eat are built and tested through test- and soak-only lures (`MachineOptions.extraLures`), including replay and rollback. No M2 part is a small shiny body or a seed, so they can't trigger in play until later parts arrive. Some clips aren't selected yet (`wheel_run`, `wheel_exit`, `shove`).
- **Light:** no mirrors or splitters yet (those parts ship later).
- **Matter:** FISHBOWL water and SCOOP intake wait for Matter in M4.
- **Moving colliders:** these are fixed approximations, not colliders that move: PUFFER lid, T-PLUNGER handle, SCOOP bail hook.
- **Art deferred to M4 or later:**
  - per-part texture sets: the D78 texture pass, which PRODUCTION schedules for the M2 parts in M4;
  - cavity fill LUTs (with Matter, M4);
  - slim GUTTER kit pieces and `vortex_slim`.
- **Graphics not done:**
  - overview click-to-jump;
  - x-ray channel-flow ribbons;
  - outlines on skinned critters;
  - critter LODs and the face rig;
  - kitchen shadow casting and image-based lighting.
- **WASM memory:** each `Machine` leaves about 30 KB in the Jolt heap after `destroy()`. It's harmless in play, but long headless soaks reload Jolt every 150 machines.
