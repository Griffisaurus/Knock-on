# KNOCK-ON Production Plan

Status: v1.3 · 2026-10-25 · Owner: Producer
Related: [GAME_SPEC.md §21–22](../GAME_SPEC.md) · [ENGINEERING.md](ENGINEERING.md) · [art/briefs/](art/briefs/README.md) · look and feel pivot: [D77–D79](dev/DECISIONS_2026-10-24.md) · UI visual reference: [KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4)

## 0. Status (2026-10-25)

| Milestone | State | Record |
|---|---|---|
| M0 Foundations | **Complete on Chrome.** Every gate passes on the test system; cross-vendor GPU runs and the 5-tester usability check wait for borrowed hardware and people | [M0_STATUS](dev/M0_STATUS.md) |
| M1 Vertical slice | **Complete on Chrome.** 40-part replay in Chrome and Node; 1-hour 2-player soak and isolated field check with 0 desyncs; Room at tier target | [M1_STATUS](dev/M1_STATUS.md), D52–D73 |
| M2 Core set | **Complete on Chrome.** Every Appendix A goal type built as a test (D76); 30-minute critter soak passes | [M2_STATUS](dev/M2_STATUS.md), D74–D76 |
| M3 Kaboom + Scale + the look pivot | **Complete on Chrome.** Kiloton and Domino Day pass as Bake & Watch playback (D89); 1M-part load in 8.6 s (19.1 s unfocused); the D79 side-by-side review passes ([M3_D79_REVIEW](dev/M3_D79_REVIEW.md)); the 32 GB tier added (D85) | [M3_STATUS](dev/M3_STATUS.md), D77–D90 |
| M4 Matter | **Complete on Chrome.** Sandstorm deterministic on the D91 matrix (four implementations on one RTX 5090); multithreaded Jolt, the VRAM governor, KTX2 / BC7 and the M2 texture pass carried in and done; water buoyancy fixed by D101 (follow-up session running) | [M4_STATUS](dev/M4_STATUS.md), D91–D101 |
| M5 Future Tech + beta | **Built** (2026-10-25): the ten Future Tech parts (A5) and GOO VAT with goo (X5), BUZZ (B5), the Orbital Hangar and Moon Base with global wind and zero-g zones (W5, E5c), world-following Matter gravity (X5, D104 / D110), the Future Tech effects and M4 render polish (R5), M5 audio and clip sound (F5), UI and beta polish (U5), the co-op hash-report fix (D108), and the docs pass (D5). The D91 matrix was re-run on the final kernels: PASS. Designed-but-unbuilt features are post-beta (D107) | [M5_STATUS](dev/M5_STATUS.md), [M5_PLAN](dev/M5_PLAN.md), D102–D116 |

**How the work actually runs:** not the team in §1. Each milestone is built by parallel agent streams with file ownership and contracts set in its plan (`docs/dev/M<N>_PLAN.md`), on one workstation (RTX 5090), with an orchestrator integrating, running the release checks and writing the status doc. The producer makes the open calls (marked "producer call" in the decisions). Capacity therefore isn't the constraint §3 plans for (D83).

---

## 1. Team

| Role | Count | Owns |
|---|---|---|
| Tech Lead / Sim Lead | 1 | Architecture, `sim`, `jolt`, `format`, determinism |
| Gameplay engineer | 1 | Behaviours, parts, critter AI, channels |
| Graphics engineer | 2 | `gpu-core`, `render`, `spectacle`, `matter` (one leans to compute/Matter) |
| Tools / UI engineer | 1 | `ui`, `editor`, `docstore`, `net`, `apps/host` |
| Tech artist | 1 | Asset pipeline, exporters, validators, shaders with graphics, VFX |
| 3D artists | 3 | Parts, environments (briefs) |
| Animator | 1 | Critters, complex mechanisms |
| UI/UX designer | 1 | UI_UX.md, icons, flows, playtests |
| Producer / designer | 1 | Plan, playtests, part tuning, demo machines |
| Audio (contract) | 1 | AUDIO.md |

Cadence: 2-week sprints · weekly local playtest · milestone review with a playable build and a demo video.

*As built:* this team plan wasn't staffed (§0). The `gpu-core`, `render`, `spectacle`, `ui` and `editor` packages it names don't exist: that work lives in `apps/game/src/{gfx,ui,audio,capture}` (ARCHITECTURE §3).

---

## 2. Milestones and epics (48 weeks to beta)

### M0 Foundations (5 wks): *prove the risky bets*
| Workstream | Deliverables | Exit gate |
|---|---|---|
| Sim | Jolt deterministic MT WASM build; canonical world build; contact sorting; hashing; Node golden harness | 15 greybox machines hash-match in Chrome and Node at 1/4/12 threads (Chrome first, [D51](dev/DECISIONS_2026-10-24.md)) |
| Matter (spike) | Fixed-point PBD: sort, solve, collide, checksum | 1M grains × 10k ticks: GPU checksum = CPU reference checksum and stable run to run (cross-vendor runs when hardware is available), **or** fallback decided |
| Graphics | `gpu-core` (device, limits, tier probe, pools, render graph); GPU-driven instancing at 100k; camera-relative; basic PBR + CSM | 100k instances at 60 fps on the 8 GB tier |
| Tools/UI | Op pipeline + loopback server; work planes; snapping queries; path tool greybox | First-time users place and connect 10 parts in < 5 min (5 testers) |
| Net | Host Server skeleton + `/check`; hello/welcome; presence | Two local browser clients see each other's cursors |
| Art pipeline | `kn_tools` add-on (template, port ring snap, export); validator v1; 1 part end-to-end (THUD) | THUD from Blender → engine with no manual steps |
| Spectacle (spike) | 1M-particle "brrr" test | 1M sparks at 60 fps on the 16 GB tier |

### M1 Vertical slice (10 wks): *two friends can build and blow things up*
| Workstream | Deliverables |
|---|---|
| Sim | Channels: Impact, Signal, Spin, Tension, Power, Heat; explosions; breakage; checkpoints + rewind; bake-ahead v1 |
| Gameplay | The 25 Ship = M1 parts (GAME_SPEC §21 M1 list) with behaviours, cards, demos, goldens |
| Graphics | Uber material + LEDs + screens; clustered lights; particles v1 (sparks, smoke puffs); decals; 4× MSAA (TAA upscaler in M3, [D60](dev/DECISIONS_2026-10-24.md)); tonemap (Khronos PBR Neutral); Studio environment |
| Tools/UI | Build HUD, dock, Library, Inspector, radial, palette, undo; Run HUD; countdown; ghost trails |
| Net | Full MULTIPLAYER v1: ops, locks, presence, chat/pings, shared run + playhead, pokes, desync repair, persistence + journal |
| Art | Final art for the M1 parts; Studio; shared kit (port rings, feet, fasteners, LEDs, decal atlas, materials) |
| Audio | Impacts, rolls, pyro v1, UI sounds, Build/Run music v1 |
| **Exit** | 40-part machine replays identically in Chrome and Node; 2 simulated-latency clients for 1 hour with zero desyncs; Room at tier target |

### M2 Core set (10 wks): *the full contraption toybox*
- Sim: Light, Air, Sound, Lure channels; critter AI framework + Mochi, Pip, Goby, Bandit (with ragdolls).
- Gameplay: every part whose Ship column in GAME_SPEC §12 says M2 (29): the remaining parts with a 1993 ancestor, plus Gutter, Vortex, Flap, Cell, Toggle, Ringer and Delay. FISHBOWL ships with its no-Matter fallback (a cosmetic water burst and Goby's flop); Matter water replaces it in M4.
- Graphics: transmission (poly/glass), skinning, X-ray overlays, cutaway, selection outlines, director/ride/overview cams.
- Tools/UI: outliner, modules, layers, section box, settings, Cascade Report v1.
- Art: those parts + 4 critters + Mega Kitchen. Audio: mechanisms, critters v1, ambience.
- **Exit:** every Appendix A goal type can be built; critters are stable through 30-minute soak runs.

### M3 Kaboom + Scale (9 wks): *the GPU goes brrr*
- Spectacle: volumetric grids, debris chunklets, shock rings, flash limiter, SDF GI + probes, hitstop and slow-mo.
- Gameplay: every Ship = M3 part (30): Fire & Boom and Contraptions expansions, optics and wireless (Lance, Mirror/Splitter, Tripwire, Ping, Maglock), Glint/Bearing, Glidepath, Spindeck, Lift, Rack, Ram, the Fun set (Pins, Stackers, Pane/Vase, Tonebars, Ding), Fabricator/Recycler, Zones.
- Scale: Warehouse/Arena/Megastructure, Backlot terrain, impostors, time dilation + Bake & Watch polish, Share links.
- **Look and feel pivot** ([D77–D79](dev/DECISIONS_2026-10-24.md)):

| Workstream | Deliverables | State (M3 close, 2026-10-24) |
|---|---|---|
| Art | **THE TINKER LAB** environment asset (Desk + Room, the new default; [environments brief §3](art/briefs/environments.md#3-the-tinker-lab)); **shared props kit** (`kn_prop_*`, 45 props, [§7](art/briefs/environments.md#7-shared-props-kit-kn_prop_)); **Mega Kitchen maximalism pass** (same layout and colliders, [§2.8](art/briefs/environments.md#28-maximalism-pass-m3)); **part texture pass** on the existing parts, M1 parts first, and every new part authored textured | **Done** (E3a, E3b, E3c): the Tinker Lab (315k tris, 193 boxes + 3 spheres per preset, IBL, LUT), 45 props in 128 variants, the Kitchen pass, all 34 M3 part types textured, the M1 texture pass on 23 meshes. The M2 texture pass followed in M4 (E4c, D100) |
| Graphics | TAA upscaler ([D60](dev/DECISIONS_2026-10-24.md)); **renderer look pass** ([RENDERING](RENDERING.md)): texture-set arrays + detail layer, GTAO, SDF contact shadows, set IBLs, sun light shafts, tilt-shift DOF, warm LUTs, vignette, grain, and winning back its ~2.5 ms on the 16 GB tier ([RENDERING §12](RENDERING.md#12-frame-budgets-16-gb-tier-4k-output-from-1440p-internal-60-fps--166-ms)) | **Done** (L3, G3): the full look at +0.63 ms on 16 GB and +1.85 ms on 32 GB (D81 win-backs); TAA; SDF probe GI |
| Tools/UI | **Glass Lab UI** ([UI_UX v1.1](UI_UX.md), matching the mockups): world card, session bar, view rail, docked glass Inspector, transport pill, parts tray, glass Library, palette, radial, Run HUD and Cascade Report; Reduce transparency and the automatic solid fallback; 3D part icons everywhere | **Done** (U3): worst text-on-glass case 4.93:1 (D80, D86) |
| Tech art / tools | `tools/blender/render_tinker_lab.py` (key art, settling, overlap check), `tools/blender/render_thumbs.py` (3D part icons, `--warm`, `--tactile`), `tools/blender/_tactile.py` (look-dev stand-ins for the texture sets) ([PIPELINE_STATUS](art/PIPELINE_STATUS.md#look-and-feel-pivot-look-dev-tools-and-renders-m3-start)); texture-set export and validator check 13 ([ASSET_PIPELINE §5.2, §9](art/ASSET_PIPELINE.md#52-texture-sets)) | **Done** (E3c): texture-set export and validator check 13. PNG sets until KTX2 / BC7 shipped in M4 (D88, D97) |

- **Review gate (D79 proof):** an in-engine frame of the Tinker Lab hero shot, reviewed side by side with `art/style-samples/tinker_lab_key.png` at a milestone review, plus a playtest in the Tinker Lab with the glass UI on the 8 GB tier (legibility, Reduce transparency, frame time). **Passed** (D90, [M3_D79_REVIEW](dev/M3_D79_REVIEW.md)).
- **Exit:** "Kiloton" and "Domino Day" at tier targets; a 1M-part world loads in < 20 s; the D79 side-by-side review passes. **Passed** (M3_STATUS).

### M4 Matter (8 wks)
- Matter gameplay + surfaces (Fishbowl switches to Matter water); every Ship = M4 part (15): Matter parts (except Goo Vat, M5), Air expansion, Arc Tower, Toast Cannon, Yolk, Zippy, Quack; Biscuit, Henny, Dusty; capture (offline render, clips, GIF); accessibility pass.
- **Exit:** "Sandstorm" deterministic on 4 vendors at the 16 GB tier. **Passed on the D91 matrix** (M4_STATUS, [M4_SANDSTORM_MATRIX](dev/M4_SANDSTORM_MATRIX.md)). Also delivered in M4: the items carried in from M3 (D95): multithreaded Jolt (D99), the M2 texture pass (D100), the VRAM governor, KTX2 / BC7 (D97) and the Megastructure dressing colliders.

### M5 Future Tech (6 wks)
- Every Ship = M5 part (11): the remaining Future Tech (Rift Gates, Grav Well, Tractor Beam, Hover Pad, Force Wall, Coilgun Ring, Stasis Field, Buzz Beacon), Singularity, Grabber, Goo Vat; Buzz; Orbital Hangar, Moon Base; tier tuning; polish; beta.
- **Exit:** feature-complete sandbox beta; all docs current.
- **As run ([M5_PLAN](dev/M5_PLAN.md), [M5_STATUS](dev/M5_STATUS.md)):** the beta bar is D106: every Ship ≤ M5 part, critter and environment playable with art, audio, captions and HOW_TO_PLAY; no doc describing code that doesn't exist or omitting shipped behaviour; a `playtests/` log started; the full suite and soaks passing; the D91 matrix re-run on the final kernels. M4's known limits that aren't polish (solver depth, real AMD / Intel / Apple GPUs) aren't beta blockers. Provisional kickoff calls: D102 (fields act on rigid bodies only), D103 (FORCE WALL by object layer, STASIS like ZONE), D104 (Matter gravity follows the world), D105 (BUZZ flight and tagging). Calls during M5: D107 (designed-but-unbuilt features are post-beta; global wind ships; the host's 32 GB part cap fixed), D108 (hash reports carry their poke count; `bakedMin` broadcast fix; amends D59), D109 (goo is a spring fluid, not buoyant), D110 (the Matter gravity mapping and the symmetric push; grains ignore wind), D111 (QUACK's keel), D112 (the Hangar's Earth phase; no Earth spin until post-beta).

---

## 3. Asset schedule (from briefs)

| Milestone | Parts | Critters | Environments | Shared |
|---|---|---|---|---|
| M0 | THUD (pipeline proof), greybox everything for M1 | — | grey Studio | port ring v1 |
| M1 | THUD, BOING, HELIO, BRIK, PLANK, SLOPE, TUBE, LEDGE, FULCRUM, ANCHOR, SHEAVE, TREADWAY, BAND, LINE, COG, MOTOR, GALE, MAINS, STOMP PAD, THE BUTTON, WICK, FUSE, BANGSTICK, SNIPPER, TOPPLE TILES | — | Studio | full kit, decal atlas, materials, debris v1 |
| M2 | Remaining parts with a 1993 ancestor + Gutter, Vortex, Flap, Cell, Toggle, Ringer, Delay (29) | Mochi, Pip, Goby, Bandit | Mega Kitchen | — |
| M3 | Boom + Contraptions expansions, Lance, Mirror/Splitter, Tripwire, Ping, Maglock, Glint/Bearing, Glidepath, Spindeck, Lift, Rack, Ram, Fabricator, Recycler, Zone, Pins, Stackers, Pane/Vase, Tonebars, Ding (30), authored textured | — | Backlot, **Tinker Lab**, Mega Kitchen maximalism pass | debris v2, **props kit** (`kn_prop_*`, 45), **part texture pass** (M1 parts first) |
| M4 | Matter family except Goo Vat, Air expansion, Arc Tower, Toast Cannon, Zippy, Quack, Yolk (15) | Biscuit, Henny, Dusty | — | — |
| M5 | Remaining Future Tech (incl. Buzz Beacon), Singularity, Grabber, Goo Vat (11) | Buzz | Orbital Hangar, Moon Base | — |

Throughput assumption: 3 modellers × ~1.6 S/M-equivalents per week. Critters run on a parallel track (modeller + animator, ~3 weeks each). Every part enters the game as a **blockout first** (ASSET_PIPELINE §11), so gameplay never waits on final art.

**Throughput impact of D78** (estimates with this plan's assumptions: ~12 artist-days per environment, GAME_SPEC §19.6 class efforts; the texture set adds about 0.5 / 1 / 2 / 3 days per S / M / L / XL part):

| Item | Basis | Artist-days |
|---|---|---|
| THE TINKER LAB | one environment | ≈ 12 |
| Mega Kitchen maximalism pass | dressing from the kit, light shafts | ≈ 4 |
| Shared props kit | 28 E-S × 0.5 + 15 E-M × 1 + 2 E-L × 2 | ≈ 33 |
| Texture pass, M1 parts | 15 S, 9 M | ≈ 17 |
| Texture pass, M2 parts | 14 S, 9 M, 5 L, 1 XL | ≈ 29 |
| Texture sets on new parts | M3 ≈ 24 · M4 ≈ 14 · M5 ≈ 13 | ≈ 51 |
| **Total** | | **≈ 146** |

- **Resolved by [D83](dev/DECISIONS_2026-10-24.md) (2026-10-24):** the work is done by parallel agent streams, so artist capacity isn't the constraint this table assumed. M3 kept its full art scope without slipping (the Tinker Lab, the 45-prop kit, the Kitchen pass, the 30 new parts authored textured and the M1 texture pass all landed in M3), and the M2 texture pass landed in M4 as planned. The overrun analysis below is kept as the record of the call.
- **M3 doesn't fit as planned.** M3's 9 weeks give the 3 modellers about 135 artist-days, and the 30 M3 parts plus the Backlot already fill most of them (≈ 43 S/M-equivalents of capacity for 30 parts). D78 adds about **90 artist-days** to M3 even with the M2 texture pass left for M4 (Tinker Lab 12, kit 33, Kitchen pass 4, M1 texture pass 17, the M3 parts' sets 24). At 1.6 S/M-equivalents per modeller-week the parts and the Backlot take about 7 of the 9 weeks, so roughly 30 days of slack absorb a third of it and about 60 artist-days remain over.
- **Options** (producer call): (a) a contract environment artist for M3 (Tinker Lab, kit and Kitchen pass ≈ 49 days, about 10 weeks), leaving the team ≈ 41 extra days; (b) also move the M3 parts' texture sets to a texture sprint at the start of M4; (c) slip M3 by about 4 weeks. The M2 parts' texture pass (≈ 29 days) is planned for M4 in every option.
- Whole project: ≈ 395 → **≈ 540 artist-days** (GAME_SPEC §19.6).

---

## 4. Critical path and dependencies
1. **Deterministic Jolt build (M0)** → everything in sim and multiplayer.
2. **Op pipeline + DocStore (M0)** → editor, multiplayer, persistence.
3. **Asset pipeline + shared kit (M0–M1)** → all art throughput.
4. **GPU-driven instancing (M0)** → scale goals (M3).
5. **Matter spike (M0)** → M4 scope (go or fallback).
6. **Critter AI + ragdoll (M2)** → critter-dependent parts (Hamster Drive, Pedal Rig, Fishbowl lures).

---

## 5. Risk burn-down (spikes before commitment)

| Risk (GAME_SPEC §22) | Spike | When |
|---|---|---|
| 3D building UX | Paper prototype (week 1), greybox placement test (M0 week 3) | M0 |
| Jolt determinism in WASM | Build + matrix | M0 week 1–3 |
| Matter determinism + coupling | Kernel spike + 4-vendor run | M0 week 2–5 |
| Rope over sheaves feel | Pulley constraint test machines | M0 week 4 |
| Megastructure build time | 1M-part synthetic world build benchmark | M1 week 2 |
| VRAM probing reliability | Probe on 6 reference machines, induce device loss | M1 |
| Multiplayer over a relay | Soak with a forced relay | M1 |

*Outcome:* Jolt determinism passed in M0 (and at 1 / 4 / 12 threads with the threaded build, D99); the Matter spike passed GPU = CPU in M0 and the D91 matrix in M4; the 1M-part load passed in M3 (8.6 s); the soaks run over a simulated relayed link every milestone, plus one isolated field check (M1). VRAM probing was built in M4 (V4) and tested with simulated device loss on one GPU; the 6-machine probe and the paper and greybox UX tests with outside testers wait for hardware and people.

---

## 6. Playtesting
- **Weekly internal:** a 30-minute themed build ("make Mochi push a Bangstick off a ledge"), timed and recorded, with notes in `playtests/YYYY-MM-DD.md`. *As built:* the `playtests/` log started in M5 (a D106 release check): `playtests/TEMPLATE.md` and the first entry, `playtests/2026-10-25.md`, a 29-minute **automated** two-window co-op session (scripted input, not people) whose desyncs led to the D108 fix; the world is saved beside it for a repro. Through M4 the playtests were the milestone review gates (the M3 8 GB glass playtest) and scripted Chrome runs.
- **Bi-weekly local co-op testing** with two browser clients, using LOCAL_DEVELOPMENT.md verbatim so the docs are exercised too.
- **Metrics to watch** (manual, no telemetry): time to first chain, number of undos per minute, Library searches vs browsing, "what does this part do?" questions, desync count, frame and sim dilation.

---

## 7. Definition of done (feature)
Engineering DoD (ENGINEERING §10) **plus**: design-reviewed in a playtest; card text and demo done; art at least at `blockout` with final scheduled; audio cues mapped (placeholder allowed until the milestone end); HOW_TO_PLAY updated if player-visible.
