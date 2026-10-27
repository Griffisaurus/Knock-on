# Beta polish notes: stream ART (Hangar values, Moon solar arrays, Earth inputs)

Plan: [BETA_POLISH_PLAN](BETA_POLISH_PLAN.md) (stream ART: `art/`, `tools/blender/kn_tools`, `assets/build/env/hangar`; D128).
Built on E5c's pipeline ([M5_NOTES_E5c](M5_NOTES_E5c.md), decisions 9, 10a–10c). Brief: [environments.md](../art/briefs/environments.md) §5.2, §5.3, §6.3.
Status: **done**. Decision: **D128** ([DECISIONS_2026-10-24](DECISIONS_2026-10-24.md)).

## What changed

| Item | Change | Files |
|---|---|---|
| **Hangar wall / ceiling tones** | **Grouping:** one tone per rib run (the full wall height between two ribs: 8 m in Bay 2, 16 m in the Main Hall; on the ceiling, the strip between two beams). E5c picked a tone per panel. Bands of different panel sizes over the same run share its tone. Shares: white 50 %, grey 35 %, warm 15 %. **Spread:** `panel_grey` `#B3B9C0` → `#C2C7CD` (−0.39 → −0.16 stop under `panel_white`). `panel_warm` `#C1BCB3` → `#C9C9C4` (−0.32 → −0.12 stop, and no longer visibly yellow). `panel_white` is unchanged, since the Moon dome uses it too | `tools/blender/env_hangar.py` (`PANEL_TONES`, `panel_tone`, `panel_rect(run=, along=)`), `tools/blender/kn_tools/masters.py` |
| **Hangar deck** | **Grouping:** one tone per rib-sized block of 4 m tiles (2 × 2 in Bay 2, 4 × 4 in the Main Hall). It was per tile. 30 % of blocks use `deck_alt` `#8E949B` → `#93999F` (−0.19 → −0.08 stop). **§0.9:** a block touching the neutral zone or its 2 m margin stays `kn_env_deck`, so the zone is still one material | same (`deck`, `DECK_ALT_SHARE`) |
| **Moon solar arrays** | **Cells:** 6 × 3 one-metre modules with 8 cm gaps. They were 12 × 6 cells with 3 cm gaps. **Backplate:** the new master `kn_env_solar_grid` `#4A5266`, 7 cm behind the modules, replaces brushed steel. There are still no near-coplanar faces (E5c 10c). **Why:** the engine draws env glbs at LOD0 at every distance (`environment.ts`, `glbLods(glb, 1, …)`), so the cell lines get no mips. 3 cm gaps are 0.4–0.6 px at 40–80 m at 1080p, which aliased; 8 cm gaps are 1.3–2.5 px. **Tris:** LOD0 down by about 1,900 | `tools/blender/env_moon.py` (`solar_array`), `masters.py` |
| **Earth (task 3, RENDER's request)** | The shipped set holds runtime-lighting inputs in the same equirect layout, sizes and names. **albedo** (sRGB): the unlit `col` (ocean depth, land and climate colour, relief shading, ice), with no clouds, cloud shadows or lighting; linear peak capped at 0.85 with the hue kept. **orm** (linear data map): R = clouds; G = `0.45·city + 0.6·glow + 0.05·metro·land·(1−ice)` with no night gate; B = `(1−land)(1−ice)`. **normal:** flat. **Data:** `earth.lighting: 'runtime'`, `degPerMinute: 1`; Hangar `phaseDeg: 105` and `spinAxis` `[0,1,0]` (it was `[0,0,0]`). **Cycles:** the lit composite still bakes to `assets/src/env/<env>/earth_<env>.lit.png`. Only the look-dev renders and the IBL bakes use it, so the IBLs still see a lit planet | `env_hangar.py` (`earth_bake(lit_path=)`, `earth_lit_png`, `EnvEarth` TS type), `env_moon.py` |

## Measured (in engine, 1920 × 1080, headless Chrome, local Vite 5327 / host 8927, scratch data)

| Check | Before | After |
|---|---|---|
| Main Hall hero, left wall between two ribs: std of 16 px block medians (log2 luminance; includes lighting and seams) | 0.241 stop (p5–p95 0.66) | **0.138 stop** (0.39) |
| Bay 2 hero, right wall | 0.287 stop (p5–p95 0.91) | **0.176 stop** (0.49) |
| Main Hall hero: window and Earth over the wall (mean luminance) | +1.30 stop | **+1.41 stop** (still the brightest thing in frame) |
| Moon hero, solar panel interiors: mean frame-to-frame change under sub-pixel camera moves (6 frames, target moved 13 mm per frame) | 0.0279 (far array 0.0323) | **0.0177 (−37 %)** (far array 0.0148, −54 %). Terrain reference 0.0046 in both |

How the solar "before" was measured: a temporary rebuild with E5c's `solar_array` code (`build_moon_oldsolar.log`). It was then rebuilt with the new code. A first pass with a lighter backplate (`#6B7385`) measured −19 %, so the final master is darker.

## Shots

All shots are in `art/style-samples/`. The before shots are the E5c assets; the after shots are the regenerated ones.

| Shot | Files |
|---|---|
| Main Hall hero | `polish_hangar_hall_{before,after}.png` |
| Bay 2 hero | `polish_hangar_bay2_{before,after}.png` |
| Moon hero | `polish_moon_{before,after}.png` |
| Solar arrays at 20° FOV | `polish_moon_panels_{before,after}.png` |
| Solar arrays from the hero frame, 3× crop (before on top) | `polish_moon_panels_zoom.png` |
| Earth inputs (albedo, data map, lit look-dev) | `polish_earth_inputs.png` |

Two caveats on the shots:
- The Earth in the after shots (and in the Moon before shot, taken after the Earth rebake) is drawn by **RENDER's interim path**. That path is not the final runtime-lit look, so judge the planet from RENDER's own shots.
- The Moon after shot is frame 0 of the jitter set. A later retake hit a WebGPU invalid-command-buffer error from RENDER's in-progress shader edits (`gfx/shaders.ts`).

## Regenerated (owner pipelines only: `node tools/assets.mjs --env-hangar`, `--env-moon`)

- **Hangar build outputs** (`assets/build/env/hangar/`): `hangar_{warehouse,arena}.glb`, `ibl_hangar_{warehouse,arena}.{hdr,json}`, `earth_hangar.{albedo,orm}.png`, `hangar.env.json`. `earth_hangar.normal.png` and `lut_hangar.png` were rewritten but are byte-identical.
- **Moon build outputs** (`assets/build/env/moon/`): `moon.glb`, `ibl_moon.{hdr,json}`, `earth_moon.{albedo,orm}.png`, `moon.env.json`. The heightfields, terrain textures and `moon_boulders.glb` are byte-identical.
- **Source files:** `assets/src/env/hangar/hangar_{warehouse,arena}.blend`, `assets/src/env/moon/moon_set.blend`, and the new `assets/src/env/{hangar,moon}/earth_*.lit.png`.
- **Generated data:** `packages/parts-data/src/env_hangar.ts`, `env_moon.ts`. The deliberate changes are the `earth` block and the `EnvEarth` type. The colliders, cameras and lights should be the same, because no geometry changed apart from panel materials and the solar modules, and the solar collider uses the same corners. This wasn't diffed: there was no copy of the old `.ts` and the repo has no git. `space_envs.test.ts` passes.

**Checksums:** sha256 of every file under `assets/` and `packages/parts-data/src/`, taken before the first build and after the last.
- Unchanged: `assets/build/env/{backlot (18 files), tinker (5), kitchen (2), props (2)}`, `assets/src/env/{backlot,tinker,kitchen,_shared}`, `assets/src/lib` (`materials.blend` was not rebuilt), and `env_{backlot,tinker,kitchen}.ts`.
- Changed: only the hangar and moon files listed above. Also `packages/parts-data/src/defs_m5.ts` and `critters.ts`, which are PARTSIM's files edited in parallel, not by this stream.

## Validation and tests

- `pnpm -s vitest run packages/assets`: **19 files, 1,663 pass, 3 skipped** (`space_envs.test.ts` included).
- **Validator:** the env scripts don't run the part validator (`kn_tools/validate.py` is for parts). The env checks live in `space_envs.test.ts` (budgets, chunks, master names, colliders, §0.9 zone, 2 km cutoff), and it passes.
- `pnpm -s typecheck`: **clean** on the final run. Earlier runs during the pass failed only in other streams' in-progress files: `ui/gizmo.ts` and `ui/portsnap.ts` (BUILDUX), then `gfx/shaders.ts` (RENDER).

## Notes for other streams

- **RENDER:** the Earth inputs are in place; the coordinator has been told.
  - `phaseDeg` is in the Hangar's data as a convenience.
  - **Ice caps:** E5c's caps start near 53° latitude. Once the planet spins with the pole up, they show along the upper limb. That's unchanged art, but easy to tighten in `earth_bake` if it reads too white.
- **RENDER (option):** a real mipped cell texture on the solar plates would need `environment.ts` to bind a second texture set per environment. Today it binds `texSetsOf(envJson)[0]`, the Earth. If that lands, ART can add a `solar` set and drop the module gaps.
- **Library:** `kn_env_solar_grid` is a new master. Like E5c's, it's built locally from the table until the next `--force-libs`.

## Scratch (not in the repo)

The scratch files live in the scratchpad's `art/` folder:
- `shot.mjs`: the CDP driver. It creates or joins an "ART <preset>" world through `__kn.net`, switches the environment by an `EnvUpdate` op and frames `__kn.camRig.cam`.
- `vite.art.config.ts`: the local Vite config on 5327, proxied to the host on 8927.
- The host data, the jitter frames and the build logs.

Both servers were stopped at hand-back.
