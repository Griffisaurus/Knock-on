# M4 notes: stream E4a (M4 part art)

Status: **done** (2026-10-24). Scope: final art for the 15 M4 parts ([M4_PLAN.md](M4_PLAN.md)) built to
`docs/art/briefs/{matter,air,power_signal,contraptions,rollers,fun}.md`, plus `toast_slice` (the launched TOAST
CANNON slice body) and YOLK's DEB_eggshell shell bits: **16 part types**, Blender 4.4 pipeline.

![M4 parts contact sheet](../../art/style-samples/m4_parts.png)

Textured (D78 sets bound the way the engine binds them): `art/style-samples/m4_parts_textured.png`. Look-dev renders:
`art/style-samples/<type>_export.png`; warm tactile 3D icons (256²): `art/style-samples/icons/<type>.thumb.webp`.

## What was built

Each type has a procedural `tools/blender/make_<type>.py`, a source `assets/src/<family>/<type>.blend`, a D78 texture
set (`assets/src/<family>/tex/<type>__body__*.png`) and a validated export in `assets/build/parts/<type>/` (glb with
LOD0–3, `.art.json`, `.shapes.json`, `.tex.{albedo,normal,orm}.png`). All 16 are in `ART_PARTS`
(`apps/game/src/artlist.ts`). Every part validates with **0 errors and 0 warnings** (rule 13 included), except
`toast_slice`: 0 errors, 1 warning (248 LOD0 tris, under the class S range of 300; its brief size is a 12 mm slice).

| Part | LOD0 / 1 / 2 / 3 tris | Brief budget | Class | Footprint · origin | Bounds (m) | COL | Pivots | Cavities | Set |
|---|---|---|---|---|---|---|---|---|---|
| grit_hopper | 7,356 / 3,662 / 1,714 / 598 | 7,500 | M | 3,4,3 · bottom | 0.292 x 0.403 x 0.292 | 6 | gate (x slide 0–0.04) | sand 14.86 L | 2048² |
| hourglass | 2,758 / 1,398 / 680 / 212 | 2,800 | S | 1,2,1 · bottom | 0.100 x 0.201 x 0.100 | 3 | – | top / bottom sand 0.12 L each | 1024² |
| tank | 6,886 / 3,444 / 1,636 / 602 | 7,000 | M | 3,4,3 · bottom | 0.290 x 0.403 x 0.320 | 3 | handwheel (z 0–270°) | water 14.36 L | 2048² |
| sprinkle_can | 5,738 / 2,936 / 1,432 / 452 | 6,000 | M | 3,2,2 · bottom | 0.300 x 0.196 x 0.192 | 5 | tilt (y 0–45°) | water 1.75 L + tilt LUTs | 2048² |
| waterwheel | 6,902 / 3,422 / 1,696 / 544 | 8,000 | M | 4,4,2 · axle | 0.388 x 0.389 x 0.200 | 12 | wheel (y) | – (pass-through Matter) | 2048² |
| sponge | 2,366 / 1,136 / 586 / 200 | 2,500 | S | 2,1,1 · com | 0.200 x 0.100 x 0.101 | 1 | – | – (wetness overlay) | 1024² |
| marble_hopper | 8,082 / 4,068 / 2,034 / 630 | 8,500 | M | 3,4,3 · bottom | 0.281 x 0.402 x 0.287 | 2 | feed_wheel (y), chute_flap (x 0–60°) | marbles 7.80 L | 2048² |
| blowout | 7,380 / 3,686 / 1,852 / 584 | 7,500 | M | 2,2,1 · bottom | 0.193 x 0.196 x 0.090 | 4 | fan (x) | – | 2048² |
| vac | 5,678 / 2,758 / 1,300 / 448 | 6,000 | M | 1,1,3 · bottom | 0.094 x 0.099 x 0.299 | 3 | impeller (y) | – | 2048² |
| inflator | 6,390 / 3,142 / 1,594 / 542 | 6,500 | M | 2,3,2 · bottom | 0.190 x 0.299 x 0.181 | 3 | valve_knob (z 0–90°), gauge_needle (y ±135°) | – | 2048² |
| arc_tower | 17,652 / 8,824 / 4,340 / 1,400 | 18,000 | L | 2,5,2 · bottom | 0.200 x 0.500 x 0.205 | 4 | – | – | 2048² |
| toast_cannon | 4,928 / 2,704 / 1,232 / 396 | 6,000 | M | 2,2,1 · bottom | 0.192 x 0.183 x 0.110 | 1 | carriage (z −0.07…+0.015), lever (z −0.06…0), dial (y 0–270°) | – | 2048² |
| toast_slice | 248 / 124 / 64 / 12 | ≈ 400 | S | 0.9,1,0.12 · com | 0.090 x 0.100 x 0.012 | 1 | – | – | 1024² |
| yolk | 838 / 428 / 224 / 70 | 900 | S | 0.45,0.6,0.45 · com (explicit) | 0.045 x 0.060 x 0.045 | 1 (47-pt hull) | – | – · 14 shell bits | 1024² |
| zippy | 8,166 / 4,088 / 2,088 / 668 | 8,500 | M | 2,1,1 · com | 0.206 x 0.097 x 0.097 | 6 (2 box + 4 wheel) | wheel_fl/fr/rl/rr (y), steer_fl/fr (z ±25°, wheels nested), shell_roll (x ±6°), spur (y), antenna (x, `axes = xy`) | – | 2048² |
| quack | 2,128 / 1,068 / 538 / 186 | 2,200 | S | 1,1,1 · com (explicit) | 0.082 x 0.094 x 0.114 | 2 | – | – | 1024² |

Every LOD0 is within its brief budget; LOD1–3 sit on 50 / 25 / 8 % ± 10 %. Measured from the build outputs
(`.art.json lods`, bounds) after the final export. Bake time (OptiX, GPU shared with E4b / E4c, `nvidia-smi` 100 % /
22.8 GB used by other processes during the run): 90–290 s per part.

Screens: GRIT HOPPER `fill` (bar 10, beam), TANK `level` (bar 10, fluid), MARBLE HOPPER `count` (7seg 6, beam).
Shape keys (LOD0/1, glTF morphs): SPONGE `sk_swell` / `sk_squash` on foam + scourer, QUACK `sk_squash` on every piece.
Emitters, sensors and LED groups follow the briefs (names in each `.art.json`).

## Container fill pass (for R4) and the exporter change

- New `tools/blender/kn_tools/cavity.py`, hooked into `export.py` (additive): every `CAVITY__` exports in
  `.art.json -> cavities[]` (engine Y-up, part space, rest pose):
  - `name`, `matter`, `capacity?`, `fill?` (fixed cosmetic level),
  - `volume` (litres), `min` / `max` (cavity bounds),
  - `lut`: 64 level-plane heights (engine y): `lut[i]` encloses `i / 63` of the volume with the part upright. Exact
    closed-mesh volume integral (divergence theorem with F = (0, 0, z − h), which vanishes on the cap), sampled at
    1,024 heights and inverted; verified against a cylinder (half volume at mid-height to 1e-15) and a cone
    (h ∝ f^(1/3) to 4 decimals). `m4_parts.test.ts` recomputes the volume below `lut[16/32/48]` from the mesh in TS.
  - `mesh`: `{vertices: flat xyz, indices: triangles}` — the closed cavity, to clip at any tilt (HOURGLASS flips, the
    sim tilts free containers),
  - `pivot` + `tilt` for a cavity under a pivot (SPRINKLE CAN): the LUT at 7 angles across the pivot's min..max
    (`tilt.angles` 0…45°, `tilt.luts`, `tilt.axis`, `tilt.origin`), world-y heights in part space.
- `ArtCavity` in `packages/assets/src/art.ts` gained these fields as optionals (old exports still parse).
- Validator rule `10.cavity` (`validate.py` hook): closed and consistently wound, positive volume, known `matter`,
  positive `capacity`.
- SCOOP, FISHBOWL and JITTERJUICE gain the same data on their next export (not re-exported here: not my parts).
- Matter fallback masters on the cavity meshes (thumbnails / impostors): sand `kn_paper_tan`, water `kn_poly_beam`,
  marbles `kn_glass`.
- HOURGLASS: two sand cavities (`top`, `bottom`, 0.12 L each) are the timer display; `hourglass__stream` (Ø 1.5 mm
  `kn_paper_tan` thread from the neck to the bottom cap) is the node to scale to the pile / hide.
- MARBLE HOPPER, GRIT HOPPER: the capacity property is abstract (100k marbles / 1M grains); the cavity holds the
  physical fraction (matter.md).

## For A4 (sim)

- Port, pivot and bounds checks against `defs_m4.ts` pass (`parts.test.ts`), after A4 moved VAC's `in` port to the
  brief's z 0.095, MARBLE HOPPER's `open` to the brief's y −0.115 and widened TOAST CANNON's bounds for the knobs.
- Art aligned to A4: SPRINKLE CAN `PIVOT__tilt` 0–45° (the 45° pour stop) and the rose axis 25° up
  (`EMIT__spout__rose` dir = `SPRINKLE.roseDir`); WATERWHEEL buckets use A4's `bucketShapes()` geometry (tangential
  floor at r 0.145, radial lip at the bucket angle − 18°, to r 0.195) in the mesh and in the 10
  `COL__box__bucket_*_{wall,floor}` plates (5.2 mm: the validator rejects shapes under 5 mm, and 5.0 rounds under).
- `EMIT__spout__*` sit at the brief points (the outlet); A4's `spout` constants emit up to 0.03 m past them, as
  matter.md allows.
- **`toast_slice`** is a new art type (`ART_PARTS`); it has no def yet. If A4 adds one: `art: 'toast_slice'`, origin =
  centre of mass, `COL__box__slice` 0.09 x 0.012 x 0.10, phys paper. TOAST CANNON's loaded slices are the
  `toast_cannon__slices` node under `PIVOT__carriage` (hide it after a launch; respawn with the next cycle).
- **YOLK shell bits** are Spectacle debris, not sim chunks (rollers.md: "splat, no chunks"): `FRAC__01–14` export to
  `assets/build/parts/yolk/yolk.frac.glb` + `.frac.json` + `frac_yolk.ts` **in the build folder**, deliberately not in
  `packages/parts-data/src` (so the sim never pre-creates them as dormant bodies). Shards carry `r`, `phys = ceramic`,
  `surface = eggshell`; 24–36 tris each, 4–20 mm, `kn_paper_tan` outside, `kn_interior_ceramic` inside.
- ZIPPY: `COL__wheel__0..3` = fl, fr, rl, rr (custom prop `wheel`), r 0.030, width 0.022, bottoms at z −0.035 (the
  same order and places as `ZIPPY.wheels`); tyre knobs reach the Ø 0.060 tread line (LOD0 min y −0.0352).

## Shared-file changes (Edit tool, additive)

| File | Change |
|---|---|
| `kn_tools/cavity.py` (new) | fill LUT bake, tilt LUTs, cavity validator check |
| `kn_tools/export.py` | cavities from `cavity.art_entries`; `cavity_lut` step reported as `baked` |
| `kn_tools/validate.py` | `cavity.check` hook (rule 10.cavity); `COL__wheel` no longer warns on ZIPPY |
| `kn_tools/decal_atlas.py` + `build_decals.py` | 14 M4 name plates (both inks) appended to region A; `trim.marks_m4` (F row 2 col 2): YOLK Ignition "KN" stamp, INFLATOR gauge dial (Volt → Amber band), TOAST CANNON browning dial, Beam drop, sand grains (3 cells spare). Atlas rebuilt: 352 slots, existing slots unmoved |
| `packages/assets/src/art.ts` | optional `ArtCavity` fill-pass fields + parser |
| `apps/game/src/artlist.ts` | the 16 M4 types |
| `tools/blender/_m4.py` (new, mine) | lofts, polar-sampled outlines, superellipse, cavity / wheel-collider helpers, Catmull-Rom paths |
| `packages/assets/test/m4_parts.test.ts` (new) | brief contract per M4 part (16 types, 91 tests) |
| `docs/art/ASSET_PIPELINE.md` §3.10, `docs/art/PIPELINE_STATUS.md` | the cavity fields; "cavity fill LUTs" no longer deferred |

## Deviations from the briefs

- **INFLATOR** cradle Ø 0.19 (brief Ø 0.17 is under the 0.18 m minimum of its 2-cell footprint); the front facet at
  y −0.0855 plus a 0.8 mm land puts the PR-S `in` ring exactly at the brief's y −0.086.
- **SPRINKLE CAN**: pour stop 45° (A4) and the rose axis 25° up (A4's `roseDir`); the brief says 60° and "+X = spout
  axis". The cradle is a U (rear bar + side rails) so the tipping tub clears it; `COL__box__cradle` is still the
  briefed 0.16 x 0.18 x 0.02 slab. The rose holes are the shared grille decal (modelled graphite dots starved check
  13's slot mean, +163 %). The cavity is 1.75 L in the briefed tub (capacity property 2 L).
- **WATERWHEEL**: buckets follow A4's sim geometry (above), not a 25° lip; foot skids run to x ±0.19 so the bounds
  reach the 0.38 m minimum (feet stay at x ±0.15).
- **TANK**: the valve is 15.5 mm deep with its back on the tube (the brief's centre would cut into the clear wall);
  a rear drain boss balances the static bounds (`kn_bounds = origin`, the handwheel judged out).
- **GRIT HOPPER**: legs stop under a graphite cradle frame that hugs the funnel (the COL boxes keep the brief's z
  0.004–0.20).
- **MARBLE HOPPER**: the pedestal base flares to 0.281 (the frustum's own 0.277 at z 0.004 is under 0.28).
- **TOAST CANNON**: the lever knob sits directly on the slot plate (front at engine z 0.062, inside A4's bounds).
  Skin `chrome_diner` (lower snake for the brief's "chrome-diner").
- **BLOWOUT**: the handle inlay is `kn_rubber`, 8 mm wide (brief `kn_rubber_grip`): the thin grip strip failed check
  13 (+46 %, then +5 % as plain rubber at 20 mm) — see the E4c report below.
- **QUACK** pupils and squeak hole are `kn_rubber` (brief `kn_powder_graphite`): the tiny graphite islands failed check
  13 (+59 %).
- **ARC TOWER** arc torus props are hints `kn_arc_torus_R` / `kn_arc_torus_r` (the exporter only copies `kn_*`).
- **YOLK** has a 1024² set (the brief predates D78's "every part gets a unique set").

## Reports to other streams (not fixed here)

- **E4c / textures.py:** check 13's slot mean disagrees with the calibration's own "final" mean on thin or tiny
  islands (BLOWOUT `kn_rubber_grip` strip: calibration −0.0 %, check +46 %; SPRINKLE CAN graphite dots +163 %; QUACK
  graphite pupils +59 %). The same symptom shows in `textures_m2.test.ts` (turbine, puffer, burning_glass).
- **MX / MI:** `pnpm -s typecheck` fails in `packages/matter/test/matter.test.ts` (missing exports `GRAIN_R`,
  `MATTER_WGSL`, `SCENE`, …) and `packages/format/test/matter_header.test.ts` (possibly-undefined); none in my files.

## Tests

- `pnpm -s vitest run packages/assets`: 16 files, 1,440 passed, 3 failed (E4c's `textures_m2.test.ts`, above), 3
  skipped. `m4_parts.test.ts`, `parts.test.ts` (against `defs_m4.ts`), `frac.test.ts`, `art.test.ts`: all pass.
- `selftest.py` (validator self-test): PASS, 0 failures, with the new hooks.
- `pnpm -s typecheck`: clean for my files (the remaining errors are MX / MI's, above).

## Rebuild

`node tools/assets.mjs <type>` (the set re-bakes automatically once its source PNGs exist), YOLK's shell bits with
`blender -b assets/src/rollers/yolk.blend --factory-startup -P tools/blender/export_frac.py -- --ts
assets/build/parts/yolk/frac_yolk.ts`, the sheets with `render_contact.py -- art/style-samples/m4_parts.png <types>
--cols 4 --res 2400x2200` and `render_textured.py -- art/style-samples/m4_parts_textured.png <types> --cols 6
--after-only`, icons with `render_thumbs.py -- art/style-samples/icons --types <list> --size 256 --warm --tactile`.
