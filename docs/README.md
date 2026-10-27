# KNOCK-ON documentation

Start with [GAME_SPEC.md](../GAME_SPEC.md) (what we're making and why), then read the docs for your role.

**Status (2026-10-25):** M0–M5 are built on Chrome: M5 is the feature-complete sandbox beta ([dev/M5_STATUS.md](dev/M5_STATUS.md), [PRODUCTION §0](PRODUCTION.md)), followed by the pre-beta polish pass ([dev/BETA_POLISH_STATUS.md](dev/BETA_POLISH_STATUS.md)). The design docs carry **As built** notes with code paths wherever the shipped code differs from the design; [ARCHITECTURE](ARCHITECTURE.md), [DATA_FORMATS](DATA_FORMATS.md) and [MULTIPLAYER §10](MULTIPLAYER.md) describe the code directly. Designed features that aren't built are post-beta ([D107](dev/DECISIONS_2026-10-24.md)).

## Everyone
| Doc | What's in it |
|---|---|
| [GAME_SPEC.md](../GAME_SPEC.md) | Vision, pillars, scale, systems overview, parts catalogue, milestones, risks |
| [HOW_TO_PLAY.md](HOW_TO_PLAY.md) | Player manual: building, channels, running, co-op, controls, parts glossary, recipes, what's not in the beta yet (§13) |
| [`playtests/`](../playtests/TEMPLATE.md) | Playtest log: the template and the first entry ([2026-10-25](../playtests/2026-10-25.md), an automated co-op session) |
| [PRODUCTION.md](PRODUCTION.md) | Milestone status (§0), milestones and epics, asset schedule, critical path, playtesting |

## Engineering
| Doc | What's in it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | As built: threads (main-thread renderer, sim worker, Jolt threads), the nine packages, data model, worker messages and the Matter SAB, key flows, failure handling, tiers, interfaces |
| [SIMULATION.md](SIMULATION.md) | Tick pipeline, Jolt integration, channel algorithms, explosions, critter AI, Matter layer, determinism, checkpoints |
| [RENDERING.md](RENDERING.md) | GPU-driven renderer, frame graph, materials, lighting, SDF GI, Spectacle, post, VRAM tiers, budgets |
| [PART_SYSTEM.md](PART_SYSTEM.md) | Part definitions (TypeScript `PartDef`), properties, ports and links, behaviours (as built: per-stage channel systems), visual state, adding a part |
| [DATA_FORMATS.md](DATA_FORMATS.md) | `.knockon` container, ops, modules, input logs, checkpoints, share links, asset JSON |
| [MULTIPLAYER.md](MULTIPLAYER.md) | 2-player co-op design and wire protocol |
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Loopback-only setup, configuration and local saves |
| [ENGINEERING.md](ENGINEERING.md) | Toolchain, scripts, standards, determinism lint, testing, CI, releases |

## Art, UI and audio
| Doc | What's in it |
|---|---|
| [art/ART_BIBLE.md](art/ART_BIBLE.md) | Look ("Lab Toy Futurism" in a science-class world), shape language, palette, tactile materials and wear, port rings, critters, environments and density zoning, golden-hour lighting, VFX style, review checklist |
| [art/ASSET_PIPELINE.md](art/ASSET_PIPELINE.md) | Blender conventions, naming, collision, ports, LODs, materials, rigging, export, validation |
| [art/briefs/](art/briefs/README.md) | Per-asset briefs: every part, critter, environment (incl. THE TINKER LAB and the shared props kit), effect, shared kit piece and icon |
| [UI_UX.md](UI_UX.md) | Glass Lab design tokens and solid fallback, screens, components, interaction specs, microcopy, accessibility (Reduce transparency); visual reference: [KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4) |
| [AUDIO.md](AUDIO.md) | Audio architecture, impacts, pyro, music, critter voice, asset specs and list |

## Development

Milestone records, newest first. Each milestone has a plan (streams, file ownership, contracts), per-stream notes and a status doc (exit criteria, release checks, known limits).

| Doc | What's in it |
|---|---|
| [dev/M5_STATUS.md](dev/M5_STATUS.md) | M5 Future Tech, polish and the beta: the D106 beta bar, deliverables per stream, release checks, known limits |
| [dev/BETA_POLISH_STATUS.md](dev/BETA_POLISH_STATUS.md) | The pre-beta polish pass (plan: [BETA_POLISH_PLAN.md](dev/BETA_POLISH_PLAN.md)): drag, gizmo, box select, copy/paste, mirror, port snap; the rollback audit; render, audio and art polish; playtest fixes; per-stream notes `dev/BETA_NOTES_*.md`; D117–D128 |
| [dev/M5_SANDSTORM_MATRIX.md](dev/M5_SANDSTORM_MATRIX.md) | The D91 matrix re-run on the final M5 kernels (goo, world gravity, the symmetric push): Sandstorm on the CPU reference, NVIDIA D3D12, D3D11 and SwiftShader, PASS |
| [dev/M5_PLAN.md](dev/M5_PLAN.md) | How M5 was split into streams (A5, B5, W5, R5, F5, U5, D5, E5a–c, then X5 after the water fix, and T5 tier tuning), rules 14–15, contracts, D102–D106 |
| `dev/M5_NOTES_*.md` | M5 per-stream notes: [A5](dev/M5_NOTES_A5.md) Future Tech parts and the BUZZ BEACON interface, [B5](dev/M5_NOTES_B5.md) BUZZ and tagging, [W5](dev/M5_NOTES_W5.md) Hangar / Moon wiring and global wind, [X5](dev/M5_NOTES_X5.md) goo, GOO VAT, world-following Matter gravity and QUACK's keel, [R5](dev/M5_NOTES_R5.md) Future Tech effects and render polish, [F5](dev/M5_NOTES_F5.md) M5 audio and clip sound, [U5](dev/M5_NOTES_U5.md) UI and beta polish, [D5](dev/M5_NOTES_D5.md) docs currency (the change log of this docs pass), [E5a](dev/M5_NOTES_E5a.md) / [E5b](dev/M5_NOTES_E5b.md) / [E5c](dev/M5_NOTES_E5c.md) art, and the close-out streams [T5](dev/M5_NOTES_T5.md) tier tuning (measured tiers, awake-body ceiling, 8M grains), [G5](dev/M5_NOTES_G5.md) GPU timer and governors, [J5](dev/M5_NOTES_J5.md) Jolt heap and out-of-memory handling |
| [dev/M5_NOTES_DESYNC.md](dev/M5_NOTES_DESYNC.md) | The "Player 2 pokes" co-op desync from the first playtest: stale hash reports, not a divergence; the `pk` fix and the `bakedMin` change (D108) |
| [dev/M4_STATUS.md](dev/M4_STATUS.md) | M4 Matter: the Sandstorm 4-implementation exit matrix, deliverables per stream, release checks, known limits |
| [dev/M4_SANDSTORM_MATRIX.md](dev/M4_SANDSTORM_MATRIX.md) | The exit report: Sandstorm (4M grains) per-tick checksums and impulses on the Node CPU reference, NVIDIA D3D12, NVIDIA D3D11 and SwiftShader |
| [dev/M4_PLAN.md](dev/M4_PLAN.md) | How M4 (Matter) is split into streams: ownership, the Matter backend and Machine contracts, the D91 vendor matrix |
| `dev/M4_NOTES_*.md` | M4 per-stream notes: [MX](dev/M4_NOTES_MX.md) Matter core, [MI](dev/M4_NOTES_MI.md) Matter in the game (KNCP checkpoints, header, desync sizes, sink fill), [A4](dev/M4_NOTES_A4.md) parts, [B4](dev/M4_NOTES_B4.md) critters, [R4](dev/M4_NOTES_R4.md) Matter rendering, [C4](dev/M4_NOTES_C4.md) capture, [U4](dev/M4_NOTES_U4.md) accessibility, [F4](dev/M4_NOTES_F4.md) audio, [J4](dev/M4_NOTES_J4.md) multithreaded Jolt, [V4](dev/M4_NOTES_V4.md) VRAM and KTX2, [E4a](dev/M4_NOTES_E4a.md) / [E4b](dev/M4_NOTES_E4b.md) / [E4c](dev/M4_NOTES_E4c.md) art |
| [dev/M3_STATUS.md](dev/M3_STATUS.md) | M3 Kaboom + Scale and the look pivot: exit benchmarks (Kiloton, Domino Day, 1M-part load), the D79 side-by-side, deliverables, known limits |
| [dev/M3_D79_REVIEW.md](dev/M3_D79_REVIEW.md) | The M3 review gate: the Tinker Lab hero side-by-side (criteria, measurements, fixes) and the 8 GB glass UI playtest |
| [dev/M3_PLAN.md](dev/M3_PLAN.md) | How M3 was split into nine streams (A3, S3, G3, L3, U3, E3a–c, F3); per-stream notes in `dev/M3_NOTES_*.md` |
| [dev/M2_STATUS.md](dev/M2_STATUS.md) | M2 core set: 29 parts, critters, Light/Sound/Lure, editor tools, goal-type machines, critter soak |
| [dev/M2_PLAN.md](dev/M2_PLAN.md) | How M2 was split into parallel streams: file ownership and the cross-stream contracts; per-stream notes in `dev/M2_NOTES_*.md` |
| [dev/M1_STATUS.md](dev/M1_STATUS.md) | M1 vertical slice: parts, channels, editor, multiplayer run, what's left |
| [dev/M0_STATUS.md](dev/M0_STATUS.md) | M0 exit gates and spike results (Jolt, Matter, GPU, Spectacle, art pipeline), how to run it, tests |
| [art/PIPELINE_STATUS.md](art/PIPELINE_STATUS.md) | Blender → engine pipeline: `kn_tools`, validator, exporter; per-milestone part, critter and environment builds (M0–M5); texture sets and KTX2 / BC7; look-dev tools; known issues |
| [dev/AUDIT_2026-10-23.md](dev/AUDIT_2026-10-23.md) | The full numbers audit and what it caught |
| [dev/DECISIONS_2026-10-23.md](dev/DECISIONS_2026-10-23.md) | D1–D50: binding design decisions from the audit |
| [dev/DECISIONS_2026-10-24.md](dev/DECISIONS_2026-10-24.md) | D51 Chrome first; D52–D73 M1 decisions; D74–D76 M2; D77–D79 look and feel pivot (Glass Lab UI, science class maximalism and THE TINKER LAB, warm renderer look); D80–D90 M3 (glass contrast, frame budget, Tinker Lab lighting, the 32 GB tier, Bake & Watch benchmarks, the D79 review); D91–D100 M4 (vendor matrix, Matter on the render device, materials, in-house encoders, carried scope, run HUD contrast, BC7/KTX2, sink fill, multithreaded Jolt, M2 texture sizes); D101 water buoyancy from a surface map and Jolt; D102–D106 M5 kickoff (fields on rigid bodies only, rollback-safe FORCE WALL and STASIS, Matter gravity follows the world, BUZZ and tagging, the beta bar); D107–D112 M5 (designed-but-unbuilt features are post-beta and global wind ships, hash reports carry their poke count, goo is a spring fluid, the Matter gravity mapping and symmetric push, QUACK's keel, the Hangar's Earth phase); D113–D116 M5 close-out (the glass probe waits for steady frames, 32 GB keeps 8M grains time-dilated, frame targets are for typical worlds, Jolt's contact buffers scale with parts) |

## Reference
| Path | What's in it |
|---|---|
| [`art/style-samples/`](../art/style-samples/) | Look-dev renders: Tinker Lab key art (`tinker_lab_key.png`, `tinker_lab_lobby.png`, from `tools/blender/render_tinker_lab.py`), 28 warm part icons in `icons/` (`tools/blender/render_thumbs.py`), lineup and material studies (`tools/blender/style_samples.py`) |
| [`reference/tim1/`](../reference/tim1/README.md) | Decoded 1993 data. Design research only, never shipped |
