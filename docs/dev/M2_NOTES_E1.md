# M2 notes: stream E1 (art for parts)

Status 2026-10-24. Scope: final art for the 29 M2 parts (M2_PLAN). Pipeline details: [PIPELINE_STATUS.md, M2 parts](../art/PIPELINE_STATUS.md#m2-parts-stream-e1).

**State:**
- All 29 types are built: STITCH, FUZZ, PIG IRON · GUTTER, VORTEX, SPRONG, TRAP BOX, SCOOP, FLAP · DYNAMO, HAMSTER DRIVE, TURBINE, PEDAL RIG · PUFFER · CELL, SUNCELL, LAMP, TORCH, BURNING GLASS, TOGGLE, RINGER, DELAY · T-PLUNGER, SKYROCKET, BIG TOP, CORK BLASTER · PUNCHLINE, GOTCHA BOX, FISHBOWL.
- Each was rebuilt from its `tools/blender/make_<type>.py` with the final exporter, and every one validates with 0 errors. The only warning is PEDAL RIG at 14,514 tris, which is under the XL floor by design (brief).
- All 29 are appended to `ART_PARTS`.
- Tests: `pnpm vitest run packages/assets` gives 577 passed across 9 files. That includes `m2_parts.test.ts`, which checks every M2 build against its brief, and `parts.test.ts`, which compares every part that has a def (all M2 parts except GUTTER).
- Contact sheet: `art/style-samples/m2_parts.png` (`node tools/assets.mjs --sheet-m2`).

## For stream A (defs_m2.ts)

| Part | Art (built to the brief) | parts-data | Suggested fix |
|---|---|---|---|
| TOGGLE | Ports are named `in`, `out_power` and `out_signal`. The brief names both outputs `out`, but port names must be unique. | Already `out_power` / `out_signal` | none (the brief should be updated) |
| TOGGLE | Lever travel −25..+25° (brief) about Blender +Y. Modelled at −25 (OFF) with `rest = −25` in `.art.json`. | hinge limits [−50, 50], axis engine +Z (= Blender −Y, so the sign is opposite) | Use limits ±25. Note the axis sign: a positive def angle is a negative art angle. |
| FLAP | Pivot limits 0..+90. +90 is open with the front edge down: positive is right-handed about +X in both Blender and the engine. The brief's "−90 (open, front edge down)" has the wrong sign, so the art follows the def. | hinge [0, 90] ✓ | Brief text: frame.md FLAP should say 0..+90. |
| FLAP | `kn_mass_hint` 0.27 kg is the panel only (brief: 4 kg/m², default 0.27 kg; the frame is static). | body mass 0.6 | Check whether 0.6 is meant to cover the frame. |
| SCOOP | The bail port rides `PIVOT__bail`. It is exported at the modelled rest pose (−75°), (0, 0.097, 0.191) facing along the lying bail. `.art.json` carries `ports[].pivot = 'bail'` and `pivots[].rest = −75`. At pivot 0 this is exactly the def's upright (0, 0.265, 0) facing +Y (engine). | port at the upright position ✓ | none. The tests turn pivot-riding ports to pivot 0 before comparing (`packages/assets/test/pivot_pose.ts`). |
| TURBINE | LOD0 width is 0.25 m, because three blades at rest span 2 × 0.145 × cos 30°. `kn_footprint` is 2.5. The brief's 3 cells is the swept disc (tip r 0.145). | bounds x ±0.13 ✓ | none |
| GUTTER | Path kit: `gutter.glb` holds the kit pieces on a 0.5 m demo run, plus `gutter.profile.json` for the sweep. | no def | When the def lands, don't set `art` until the path sweeper reads `gutter.profile.json`. |
| SPRONG | The mat collider carries restitution ≤ 1.0, because the validator caps restitution at 1. The brief's 1.15 and the 8 m/s exit cap belong to the sim (sensor behaviour). | sim-side | Keep the bounce in the def or behaviour. |
| GOTCHA BOX | The crank knob stands 28.5 mm proud of the front face (to y −0.1195). | bounds max z 0.12 ✓ | none |
| VORTEX | `kn_mass_hint` 2.5 is nominal (static part). | mass 0 (static) | none |

The colliders follow the briefs. Some defs approximate them with other kinds, which is fine for the sim but is listed here so nobody is surprised:
- SCOOP: the art uses 9 hulls where the def uses boxes.
- VORTEX: the art's `COL__mesh__0` is about 2,000 tris; the def uses a box ring.
- SKYROCKET: the art's fins are one hull; the def uses 3 boxes.
- BURNING GLASS: the art uses a capsule handle and a cylinder lens.
- TORCH: the art has 2 boxes where the def has 3 shapes.

## For stream B (critter-bound defs)

HAMSTER DRIVE, PEDAL RIG, TRAP BOX and FISHBOWL match their defs on ports, hinge axis and position, and bounds. PEDAL RIG needed one art fix: its console was lowered 6 mm so the top LED stays under the def's 0.40 m height (+12 mm tolerance).

Device sockets are now exported in `.art.json sockets` (name, pos, rot, parent bone, `follow` pivot):
- HAMSTER DRIVE: `socket_pip`, `socket_pip_exit`.
- PEDAL RIG: `root`, `crank`, `socket_pedal_l/r` (following the pedal pivots), `socket_seat`, `socket_grip_l/r`, `socket_mount`, `socket_lure_look`.

## For stream C (renderer)

- **Nested pivots.** `.art.json pivots[].parent` names the parent pivot, and the glb keeps the chain at every LOD (`PIVOT__x__L1..3` proxies are parented the same way). The chains are:
  - BIG TOP: carriage → elevation → recoil → ram; wheels and flag hang under carriage.
  - PUNCHLINE: ram_1 → ram_2 → glove.
  - GOTCHA BOX: lean → spring → head.
  - PEDAL RIG: crank → pedal_l / pedal_r.

  I checked every M2 glb: proxy world transforms equal LOD0's to 0, and moving-piece centres differ by at most 4.5 mm (simplification only).
- **New pivot fields.** `pivots[].motion` is `slide` (metres) or `turn` (degrees). `pivots[].rest` is the modelled pose: SCOOP −75, TOGGLE −25, BIG TOP elevation 30.
- **Pivot-riding items.** `pivot` on `.shapes.json` shapes and on `.art.json` sensors, emitters and ports names the pivot the item rides; its position is given at the rest pose.
- **Baked clips** are glTF animations named `<type>__<clip>`, with channels on the pivot nodes of all four LODs: `gotcha_box__pop` (0.6 s), `gotcha_box__reset` (0.4 s), `big_top__recoil` (0.5 s) and `puffer__squeeze` (0.35 s). The clips are 30 fps and keyframe from frame 1, and the saved pose is rest.
- **Screens.**
  - CELL `charge`: bar, 5 cells, power; vertical, filling bottom→top.
  - DYNAMO `output`: bar, 10 cells, power; X15 variant on the cap top.
  - RINGER `countdown`: 7seg, 4 digits, signal. It has no colon property (the brief says "digits 4 + colon"), so the engine draws the colon for MM:SS.
  - DELAY `delay`: 7seg, 3 digits, signal.
- **Cavities:** SCOOP `contents` (fill, 3.5 L) and FISHBOWL `water` (water).
- **Shape keys** are glTF morph targets on LOD0 + LOD1 meshes, named in `mesh.extras.targetNames`; default weights are the glTF mesh weights. `.art.json shapeKeys` gives `{name, mesh, lods, default, range}`:
  - SPRONG `sk_depress` on `sprong__mat`;
  - PUFFER `sk_squash` on `puffer__pleats` and `sk_spring` on `puffer__spring`, both driven by lid angle / −14;
  - CORK BLASTER `sk_compress` on `cork_blaster__spring` (default 1 = cocked; 0 = released as the piston fires);
  - PUNCHLINE `sk_compress` on `punchline__spring` (default 1 = wound);
  - GOTCHA BOX `sk_stretch` on `gotcha_box__spring` (drive with the spring slide / 0.30);
  - BIG TOP `sk_iris` on `big_top__iris`, with weight = (0.26 − (roller Ø + 0.004)) / 0.215.

  The coils and the iris are separate pieces now, so each key touches only its own mesh.

## For stream A / the sim: FISHBOWL fracture

`node tools/assets.mjs fishbowl --frac` writes two files:
- `assets/build/parts/fishbowl/fishbowl.frac.glb`: 21 root nodes `FRAC__01..21` in chunk order, each at its chunk's centre of mass, single LOD, `kn_glass` + `kn_interior_glass`.
- `packages/parts-data/src/frac_fishbowl.ts`: `FISHBOWL_FRAC.chunks[]` with name, centre (engine metres, Y-up, part space), volume (m³), massShare (volume fraction, sums to 1) and hull (32 points each, part space).

The chunk masses should be massShare × the glass mass (2.7 kg per the brief; the 11.7 kg of water becomes Matter or splash). The chunks are 18 curved wall shards, the base disc with its stub (19) and two lip halves (20–21). The file is not re-exported from `parts-data/src/index.ts`; import it directly, or add it to the index when the sim wires it.

## Deviations and deferrals (art)

- **Shape keys: done.** The PUFFER `puffer__squeeze` clip is still lid-only; pleat wobble needs a morph-weight channel in the clip.
- **Unique textures are deferred:** stitch V-stitch normal, fuzz normal, pig-iron pitting, woven mat, oak/walnut bakes, window and shell thickness maps.
- **BIG TOP** gained `PIVOT__carriage` (slide on z, 0..0.01) so the recoil clip can hop the carriage 10 mm.
- **Bounds are judged on the static housing.** Two parts set `kn_bounds` so origin and footprint are measured without their moving piece:
  - TOGGLE (`kn_bounds = origin`): the resting lever shifts the bounds 7 mm to −X.
  - GOTCHA BOX (`kn_bounds = origin`): the crank knob.
- **Name plates and pictograms** follow the shared_kit §6.2 table. PUNCHLINE has no pictogram (contraptions family rule). FUZZ has no decal, since the brief has no accent. STITCH and PIG IRON carry stamps.
- **GUTTER** ships only the wide kit pieces. The slim variant exists as a profile in `gutter.profile.json`; its kit pieces and the `vortex_slim` mesh are not built.

## Shared-file changes (all additive, Edit tool)

- **`kn_tools/decal_atlas.py` + `build_decals.py`:**
  - names for the 28 new M2 parts, appended so M1 slots keep their place;
  - region D arrows (`mark.arrow_in/out/both/rotate.<ink>`), stamps `mark.kn_st.graphite` and `mark.mass_6_5.bone`, and `mark.star.bone`;
  - `trim.face_gotcha` (F row 4 col 3, sampled with `FACE_SUB`).

  The atlas is rebuilt and has 262 slots.
- **`kn_tools/conventions.py` / `validate.py`:** the new origin kind `path` (exempt from the bottom-origin and half-cell checks), and rule 9 now allows pivots nested directly under pivots.
- **`kn_tools/export.py`:**
  - nested pivot proxies per LOD (with the orchestrator's `view_layer.update()` fix);
  - clip export: `export_animations` is on only when `<type>__*` actions exist;
  - `pivots[].parent / motion / rest`;
  - `pivot` on shapes, sensors, emitters and ports (taken from the `pivot` prop or the nearest PIVOT ancestor);
  - `.art.json sockets`.
- **`tools/assets.mjs`:** `--sheet-m2`.
- **New files:**
  - `tools/blender/_m2.py`: shared-kit helpers, `nest`, `clip`, `socket_rig`, `grid_slab`, `axial_remap`;
  - the 29 `make_<type>.py`;
  - `kn_tools/frac.py` + `tools/blender/export_frac.py`;
  - generated `packages/parts-data/src/frac_fishbowl.ts`;
  - `packages/assets/test/m2_parts.test.ts`, `frac.test.ts` and `pivot_pose.ts`.
- **`kn_tools/kit.py`:** `Kit.shape_keys`, plus `add_shape_keys()` called from `Part._emit`. `export.py` adds conditional `export_morph`, `.art.json shapeKeys`, and marks the frac step as a separate `--frac` step. `tools/assets.mjs` adds `--frac`.
- **`parts.test.ts`:** def comparisons skip parts that don't have a def yet (with a message); port positions are compared at pivot 0.
