# M3 plan: Kaboom + Scale, and the look-and-feel pivot

Started 2026-10-24. Scope: [PRODUCTION.md §2 M3](../PRODUCTION.md). Decisions: D77–D79 (the look pivot) and D80–D84 (the provisional kickoff calls) in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md). M2: [M2_STATUS.md](M2_STATUS.md). Same working model as [M2_PLAN.md](M2_PLAN.md), whose rules carry over.

**Exit:**
- "Kiloton" (400 Bangsticks and 60 Powder Kegs in a Brik fortress inside an Arena) and "Domino Day" (100k Topple Tiles across a Megastructure, director cam on) hit their tier targets.
- A 1M-part world loads in under 20 s.
- An in-engine Tinker Lab hero frame passes the side-by-side review against `art/style-samples/tinker_lab_key.png`.

## Rules (carried over from M2, plus three)

1. **Shared files: Edit tool only.** Exact-string replaces, never wholesale rewrites or scripts. Re-read and retry when the file has changed.
2. **Other streams' failures.** If typecheck or test fails in another stream's files, report it; don't fix it.
3. **Don't build `dist/`.** It's shared, and the :8787 host serves the orchestrator's builds. Use your own Vite server and, where needed, a local test server on your own port with its own data folder (`KNOCKON_STATIC=none`, `KNOCKON_PORT`, `KNOCKON_DATA`). Never edit the shared world.
4. **Project rules.** No git. Nothing from the 1993 game; original names only. No realistic firearms. Determinism rules for sim and parts-data (`pnpm lint`).
5. **Notes.** Write them to `docs/dev/M3_NOTES_<stream>.md`.
6. **New: don't spawn sub-agents.** A stream's children die when it stops (M2 lost builders this way). Do the work yourself and hand back only when complete or blocked.
7. **New: measure, don't estimate.** Every performance claim in a hand-back is a measurement on the test system (NVIDIA Blackwell, 16 GB tier), with the method.
8. **New: hidden bodies are never pushed.** Pre-built dormant bodies (chunks, pieces, pools) must be skipped by impulses while out of play (`Machine.hiddenBody`). Rollback depends on it.

## Streams and file ownership

| Stream | Owns | Shared files (Edit tool only) |
|---|---|---|
| **A3 · sim parts** | `packages/sim/src/channels/**`, `packages/parts-data/src/defs_m3.ts` (new), sim tests for M3 parts | `machine.ts`, `packages/sim/src/index.ts`, `packages/parts-data/src/{defs,cards,demos,index}.ts` |
| **S3 · scale** | `packages/sim/src/terrain.ts` (new), `apps/host/src/share*.ts` (new), `apps/game/src/share.ts` (new), `apps/game/src/gfx/terrain.ts` (new), `apps/game/src/gfx/impostor.ts` (new), benchmark scenes and harness (`apps/game/bench/**`, `packages/parts-data/src/presets.ts`) | `machine.ts`, `sim.worker.ts`, `run.ts`, `packages/format/**`, `packages/docstore/**`, `apps/host/src/{server,session}.ts`, `env.ts` |
| **G3 · spectacle graphics** | `apps/game/src/gfx/{volume,debris,gi,taa,shockwave}.ts` (new), `particles.ts`, `fx.ts` | `renderer.ts`, `shaders.ts`, `main.ts` (hitstop/slow-mo hooks) |
| **L3 · look graphics** | `apps/game/src/gfx/look/**` (new: texture arrays, detail layer, GTAO, contact shadows, IBL, froxel shafts, DOF, LUT/vignette/grain), `post.ts`, `environment.ts` | `renderer.ts`, `shaders.ts`, `glbmesh.ts` |
| **U3 · Glass Lab UI** | `apps/game/src/ui/**`, `styles.css`, `index.html`, `apps/game/src/cascade.ts` | `main.ts` |
| **E3a · M3 part art** | `tools/blender/make_<M3 type>.py`, `assets/src/<family>/<M3 type>.blend`, their builds | `tools/blender/_m2.py`, `kn_tools/*` (additive), `apps/game/src/artlist.ts` |
| **E3b · environments** | `tools/blender/env_tinker.py`, `env_kitchen.py`, `tools/blender/props/**`, `assets/src/env/**`, `assets/build/env/**`, `packages/parts-data/src/env_tinker.ts` (generated) | `kn_tools/*` (additive), `tools/assets.mjs` |
| **E3c · texture pipeline + M1 texture pass** | `kn_tools/textures.py` (new), validator check 13, texture-set export, `assets/build/parts/<M1 type>/*.tex.*` | `kn_tools/{export,validate}.py`, `make_<M1 type>.py` |
| **F3 · audio** | `apps/game/src/audio/**`, `audio-test.ts` | `main.ts` (audio hooks) |

## Contracts

1. **Texture sets (E3c → L3, E3a).** Per ASSET_PIPELINE v1.1 §5.2:
   - **Files:** `<type>.tex.ktx2`, or `.png` while there's no transcoder, with albedo, normal and ORM layers at 1–2k.
   - **Index:** listed in `.art.json` `textures: {albedo, normal, orm, size}`.
   - **Mesh data:** UVs on TEXCOORD_0 for every textured primitive, plus a `texSet` flag on the material extras.
   - **Rendering:** L3 loads them into texture arrays (one layer per part set) and samples them in the uber material, with a per-vertex flag in the material kind byte (D69 has a spare value). Parts with no set fall back to today's master materials.
2. **Environments (E3b → L3, S3, orchestrator).**
   - **Files:** E3b writes `assets/build/env/tinker/tinker.glb` with LODs, backdrop and probes, plus `env_tinker.ts` (colliders, neutral zone, camera, light rig, LUT and IBL names) shaped like `env_kitchen.ts`. It adds `ibl_tinker_lab` and `lut_tinker_lab` as files under `assets/build/env/tinker/`.
   - **Environment id:** `'tinker'` becomes the default for the Desk and Room presets; `DEFAULT_ENV` changes in format (S3).
   - **Sim:** the orchestrator wires the colliders, as for the kitchen (D75).
   - **Rendering:** L3 draws the set, its IBL and LUT.
3. **Spectacle (G3).**
   - **Inputs:** the visual effects read `SimEvent`s (`Detonate`, `Break`, `Ignite`, and so on) and never feed back into the sim.
   - **Wall-clock only:** hitstop and slow-mo apply to wall time. They change the playhead speed locally and never touch sim ticks (GAME_SPEC §13).
   - **Debris chunklets** are GPU-only (rigid-lite against the global SDF).
   - **GI owner:** the SDF GI and probes are G3's; L3 uses them as "probe GI by default on 12 GB and up" (D79).
4. **Scale (S3).**
   - **Presets:** Warehouse, Arena and Megastructure go in parts-data (bounds, cove or none, camera).
   - **Terrain:** Backlot terrain is a heightfield in the sim (a Jolt HeightFieldShape, deterministic) and a mesh in gfx.
   - **Impostors:** for distant parts, via the cull pass's LOD 4.
   - **Load target:** a 1M-part world loads in under 20 s. S3 profiles decode, docstore, instance upload and Machine build, and fixes whatever is slowest.
   - **Share links:** host service plus client.
   - **Benchmarks:** "Kiloton" and "Domino Day" ship as demo worlds, plus a perf harness reporting frame and tick timings.
5. **UI (U3).**
   - **Spec:** the Glass Lab UI per UI_UX v1.1 and the mockups (ask the orchestrator if you can't open the artifact), with D80 tint and D84 radii and Stop.
   - **Keep working:** every M2 tool keeps working: outliner, layers, modules, section box, settings, Cascade Report, X-ray and cutaway.
   - **Settings:** add Reduce transparency (Accessibility) and DOF (Graphics).
   - **Icons:** 3D part icons come from `art/style-samples/icons/*.thumb.webp` (and `render_thumbs.py` for the rest); the build pipeline copies them to `/parts/<type>/<type>.thumb.webp`.
6. **Events (A3 → F3, G3, U3).** New kinds go in `EventKind`, and consumers ignore kinds they don't know. A3 lists them in its notes.

## The 30 M3 parts (A3 sim, E3a art)

- **Optics:** LANCE, MIRROR / SPLITTER, TRIPWIRE.
- **Wireless and field:** PING, MAGLOCK.
- **Rollers and tracks:** GLINT / BEARING, GLIDEPATH (a path link).
- **Motion:** SPINDECK, LIFT, RACK, RAM.
- **Fire and boom:** POWDER KEG, JITTERJUICE, SKYSHOW, FLAMER, POPPER.
- **Contraptions:** SNAPTRAP, BONKER, FLINGER, WRECKER, PINGER, PADDLE / BUMPER.
- **Fun:** PINS, STACKERS, PANE / VASE, TONEBARS, DING.
- **Future:** FABRICATOR, RECYCLER, ZONE (gravity, antigrav, wind and stasis).

Every part gets a def, behaviour, card, demo, golden and fuzz entry (PART_SYSTEM §7–8), plus textured final art (D78).
