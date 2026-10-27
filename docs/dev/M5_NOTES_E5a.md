# M5 notes: stream E5a (M5 part art)

Status: **done** (2026-10-25). Scope: final art for the 11 M5 parts ([M5_PLAN.md](M5_PLAN.md)), built to
`docs/art/briefs/{future,boom,drive,matter,critters}.md` and aligned with A5's `packages/parts-data/src/defs_m5.ts`
([M5_NOTES_A5.md](M5_NOTES_A5.md)). Blender 4.4 pipeline, E4a house style (`_m2.py`, `_m4.py`, new `_m5.py`).

![M5 parts contact sheet](../../art/style-samples/m5_parts.png)

Warm tactile icons (256²): `art/style-samples/icons/<type>.thumb.webp`, labelled together in
`art/style-samples/m5_parts_icons.png`. Look-dev renders (LOD0 in front of LOD1–3, Cycles): `art/style-samples/<type>_export.png`.

## What was built

Each type has a procedural `tools/blender/make_<type>.py`, a source `assets/src/<family>/<type>.blend`, a unique D78
texture set (`assets/src/<family>/tex/<type>__body__*.png`) and a validated export in `assets/build/parts/<type>/`:
the glb with LOD0–3, `.art.json`, `.shapes.json`, `.tex.{albedo,normal,orm}.png` and the BC7 `.tex.*.ktx2` (`--ktx2`,
D97). All 11 are in `ART_PARTS` (`apps/game/src/artlist.ts`). **Every part validates with 0 errors and 0 warnings**,
rule 13 included.

| Part | LOD0 / 1 / 2 / 3 tris | Budget | Class | Footprint · origin | Bounds (m) | COL | Pivots | Set |
|---|---|---|---|---|---|---|---|---|
| rift_gate | 11,660 / 6,032 / 3,024 / 860 | 12,000 | L | 4,4,0.5 · bottom | 0.390 x 0.401 x 0.053 | 10 | trim_ring (y) | 2048² |
| grav_well | 6,358 / 3,226 / 1,588 / 520 | 6,500 | M | 2,1.5,2 · bottom | 0.200 x 0.160 x 0.200 | 5 | orb_lift (z slide 0–0.020) > orb_spin (z) | 2048² |
| tractor_beam | 5,334 / 2,682 / 1,322 / 420 | 5,500 | M | 1,1,3 · bottom | 0.092 x 0.105 x 0.301 | 3 | dish_spin (y) | 2048² |
| hover_pad | 4,218 / 2,190 / 1,130 / 362 | 4,500 | M | 3,0.5,3 · bottom | 0.302 x 0.050 x 0.303 | 2 | – | 2048² |
| force_wall | 3,824 / 1,936 / 900 / 332 | 4,000 | M | 6,4,0.5 · bottom | 0.600 x 0.405 x 0.050 | 6 | – | 2048² |
| coilgun_ring | 9,346 / 4,562 / 2,458 / 750 | 9,500 | M | 3,3,1 · bottom | 0.285 x 0.300 x 0.101 | 9 | – | 2048² |
| stasis_field | 6,876 / 3,532 / 1,792 / 544 | 7,000 | M | 5,0.5,5 · bottom | 0.500 x 0.065 x 0.500 | 4 | – | 2048² |
| buzz_beacon | 2,454 / 1,198 / 652 / 208 | 2,500 | S | 2,0.5,2 · bottom | 0.200 x 0.043 x 0.200 | 1 | – (RIG socket_dock) | 1024² |
| singularity | 15,542 / 7,732 / 3,974 / 1,306 | 16,000 | L | 2,2,2 · bottom | 0.200 x 0.200 x 0.203 | 6 | ring_outer (z) > ring_inner (x) | 2048² |
| grabber | 14,444 / 7,216 / 3,620 / 1,136 | 20,000 | L | 2,5,2 · bottom | 0.190 x 0.495 x 0.190 | 7 | yaw > shoulder > elbow > wrist_pitch > wrist_roll > finger_l / finger_r | 2048² |
| goo_vat | 7,328 / 3,688 / 1,830 / 576 | 7,500 | M | 3,3,3 · bottom | 0.282 x 0.300 x 0.302 | 3 | stirrer (z), valve_lever (x 0–90°) | 2048² |

Bounds and tris are measured from the build outputs (`.art.json`). LOD1–3 sit on 50 / 25 / 8 % ± 10 %.
Bake time, with the GPU shared with E5b / E5c: 40–140 s per set; the 10-set KTX2 encode took 131 s.

Screens: HOVER PAD `load` (bar 6, plasma), COILGUN RING `charge` (bar 8, power), SINGULARITY `countdown` (7seg 2,
field), GOO VAT `level` (bar 10, fluid), RIFT GATES `membrane` (icon, plasma: a Ø 0.31 disc with planar 0–1 UVs, not a
quad, so it stays inside the ring). Clips: `singularity__collapse` (0.6 s), `grabber__idle` (4 s), `grabber__park`
(1.0 s), `grabber__shrug` (1.5 s). LED groups, emitters and sensors follow the briefs (names in each `.art.json`).

## For A5, R5, B5 and X5

- **Ports and pivots match `defs_m5.ts`** (`parts.test.ts` passes for all 11: LOD0 inside the def bounds, port names,
  channels, places). GRABBER's signal input is `PORT__signal__go` (A5's rename) and always was in the build.
- **GRABBER:** the joint conventions are A5's (`Machine.grabberJoints()`): shoulder / elbow / wrist pitch about local +X
  tilt the next link toward the front; all 0 is the upright park pose the art is modelled in. Art pieces per sim
  `piece` chunk: chunk 0 = `grabber__upper_arm` (PIVOT__shoulder), chunk 1 = `grabber__forearm` (PIVOT__elbow),
  chunk 2 = `grabber__wrist` + `grabber__gripper` + `grabber__finger_l/_r` (PIVOT__wrist_pitch and below). The finger
  pivots slide 0.01–0.04 m (half the grip width) and are modelled at the 0.06 default grip (`rest` 0.03); `finger_l`'s
  axis is −X so a larger value opens both fingers. The device RIG has root + pivot mirrors (yaw … wrist_roll, each
  following its pivot) and `socket_grip` (between the fingers) / `socket_tip`, for the IK playback and a held item.
- **BUZZ BEACON** (`.art.json sockets`): `socket_dock` at engine (0, 0.040, 0); its local +X points engine +Z (the port
  side), as A5's `BEACON.dock` and B5 expect. Mass hint 0.4 kg (A5's def).
- **FORCE WALL** (W 0.6 x H 0.4) and **STASIS FIELD** (0.5³) are built at the def defaults. Each kit piece is its own
  node in every LOD so the renderer can lay them out at any size:
  - FORCE WALL: `force_wall__base_l/_r`, `__column_l/_r` (scale in y about engine y 0.040 to reach H − 0.015),
    `__cap_l/_r` (move to H − 0.015), and **`force_wall__field`**: the field surface, a 4 mm `kn_poly_plasma` slab
    between the column inner faces (x ±(W/2 − 0.032), y 0.040 … H − 0.015) with 0–1 UVs (u along +X, v up) for R5's
    §7.6 lattice. Scale it to (W − 0.064) x (H − 0.055) and hide it while the wall is OFF; it is the art for A5's
    field `piece` body (chunk 0). Pylons sit at x ±(W/2 − 0.020). COL = the six def boxes (base, column, cap per pylon).
  - STASIS FIELD: `stasis_field__node_fl/fr/bl/br` (move to (±(W/2 − 0.02), ±(D/2 − 0.02))) and
    `stasis_field__rail_front/back/left/right` (scale along their length; the LED dashes stretch with them). The
    volume stays engine-drawn (§7.3). COL = the four node boxes.
  - Ports are static (A5): they sit where they belong at the default size.
- **HOVER PAD:** origin = the bottom of the thruster discs; A5's lock-anchor `piece` draws nothing.
- **GOO VAT (X5):** `CAVITY__goo` (matter `goo`, capacity 9 L, 9.08 L inset 3.5 mm, 64-entry fill LUT, closed mesh,
  `kn_slime` fallback) is in `.art.json cavities[]`; `EMIT__spout__nozzle` (0, −0.152, 0.08) aims −Y tilted 30° down;
  `EMIT__bubble__surface` sits at the full level for the engine to move; `SENSOR__intake__lid` is r 0.035 at y 0.06,
  z 0.27–0.30. No def or sim (held).
- **RIFT GATES:** the trim ring runs in a 5.5 mm groove in the bore, so nothing intrudes into the Ø 0.31 aperture in
  front of the backplate (`m5_parts.test.ts` checks every LOD0 vertex). The pair colour is the def's `pair` prop; the
  LED groups are engine-coloured, the anodised trim stays plasma.

## Shared-file changes (Edit tool, additive)

| File | Change |
|---|---|
| `kn_tools/decal_atlas.py` + `build_decals.py` | 11 M5 name plates (both inks) appended to region A; `trim.marks_m5` (region F row 4 col 3, a spare cell of shared_kit §6.3): RIFT pair glyph, BUZZ pad glyph, GRABBER letters A / B, COILGUN chevrons, GOO drop (slime green), FORCE WALL hex, STASIS hourglass-clock. Atlas rebuilt: 375 slots, existing slots unmoved. The Unbounded "T" fault (PIPELINE_STATUS) does not show in the atlas (the bold face is filled with `fill_nonzero`): checked on TANK, RIFT GATE, STASIS FIELD |
| `apps/game/src/artlist.ts` | the 11 M5 types |
| `tools/blender/_m5.py` (new, mine) | strips, ring collision segments, marks |
| `tools/blender/render_m5.py` (new, mine) | runs `render_thumbs.py` / `render_contact.py` unchanged but also draws `.art.json` cavity contents at a cosmetic level (GOO VAT reads full of goo); no shared renderer was edited |
| `packages/assets/test/m5_parts.test.ts` (new) | brief contract per M5 part (11 types, 66 tests) |

## Deviations from the briefs

- **GRAV WELL** footprint h 1.5 cells: the resting orb tops out at z 0.160 (0.180 lifted; 2 cells would fail the
  ± 0.02 bounds check). The gimbal-free orb has two plasma meridian ribs so its spin reads.
- **BUZZ BEACON** source is `assets/src/future/` (brief: `critters/`): it's a device, so it takes the part validator,
  rule 13 and a texture set (the `critters` family runs rule 11 and skips the set). Footprint h 0.5 (brief 0.4 is not
  a half cell; real 0.040).
- **HOVER PAD** grip collider 5.2 mm (brief 5 mm; the validator rejects shapes under 5 mm and 5.0 rounds under).
- **COILGUN RING:** the flanges are an outer and an inner rim joined by six spokes, with `kn_poly_plasma` windows
  behind them, so the copper coils show from the front too ("show the mechanism"); still two clear layers per sight
  line. The charge screen is 0.060 wide (brief 0.070) to stay on the 0.16 plinth face, at the brief's centre. Arc
  emitters are `EMIT__arc__coil_1…6`.
- **RIFT GATES:** the cooldown LED group is a thin ring on the lip chamfer (brief: the same segments dim; a group can't
  share faces).
- **SINGULARITY:** a fourth LED group `core` for the black bead (`kn_led` at emission 0; it needs a group of its own so
  `containment` never lights it). The status LED sits on the plinth top (the front holds the port, screen, name plate
  and pictogram); the amber / graphite band runs along the plinth top's front edge (two 0.068 hazard decals, so the
  stripes stay 45°).
- **FORCE WALL / STASIS FIELD:** a unique 2048² set each (brief: "1024² shared"; D78 gives every part its own set and
  class M is 2048²). Skins: FORCE WALL `plasma,beam`; STASIS FIELD `plasma,cryo`.
- **GOO VAT:** plinth 0.282 wide (0.28 sits exactly on the ± 0.02 bounds limit of 3 cells); a rear refill boss keeps
  the bounds centred against the nozzle; the visible lid hatch is r 0.030 (the intake sensor keeps the brief's r 0.035)
  so it clears the motor pod.
- **TRACTOR BEAM:** the rear cap runs to y +0.146 (bounds centring); front face graphite with a plasma nose band.

## Reports to other streams (not fixed here)

- `pnpm -s typecheck` errors are other streams' work in progress, none in my files. Seen during the run: F5's
  `apps/game/src/audio/m5.ts` (`M5LoopKind` not exported, `LoopKind` arguments; later fixed), then
  `apps/game/src/main.ts(1067)`: `'arm' | 'piece'` passed where `'arm' | 'base'` is expected (A5's new `piece` role
  reaching a render hook).

## Tests

- `pnpm -s vitest run packages/assets`: 19 files, 1,661 passed, 3 skipped. `m5_parts.test.ts` (66) and
  `parts.test.ts` against `defs_m5.ts` pass for all 11 M5 parts.
- `pnpm -s typecheck`: clean for my files (the one remaining error is in `main.ts`, above).

## Rebuild

`node tools/assets.mjs <type> --ktx2` (the set re-bakes automatically once its source PNGs exist; add `--tex` the first
time). Sheets and icons:
`blender -b --factory-startup -P tools/blender/render_m5.py -- contact art/style-samples/m5_parts.png <types> --cols 3 --res 2400x2700`,
`... render_m5.py -- thumbs art/style-samples/icons --types <list> --size 256 --warm --tactile`, look-dev with
`render_lookdev.py -- assets/build/parts/<type>/<type>.glb art/style-samples/<type>_export.png`. To build FORCE WALL or
STASIS FIELD at another reference size, change `W, H` / `W, H, D` at the top of their make scripts.
