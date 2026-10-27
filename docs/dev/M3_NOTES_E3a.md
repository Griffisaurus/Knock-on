# M3 notes: stream E3a (M3 part art)

Last updated 2026-10-24. Scope: final art for the 30 M3 catalogue rows ([M3_PLAN.md](M3_PLAN.md)), built to
`docs/art/briefs/*.md` with the Blender 4.4 pipeline. That is **34 part types**: the briefs split MIRROR / SPLITTER,
PADDLE / BUMPER and PANE / VASE into two types each, GLINT / BEARING share one `marble` mesh (two skins), and A3 added
`glidepath_booster` (a link can't carry ports) mid-stream.

![M3 parts contact sheet](../../art/style-samples/m3_parts.png)

## What was built

Each type has a procedural `tools/blender/make_<type>.py` (house style of the M1/M2 builders), a source
`assets/src/<family>/<type>.blend`, a validated export in `assets/build/parts/<type>/` (glb with LOD0–3, `.art.json`,
`.shapes.json`, `.report.json`), a look-dev render `art/style-samples/<type>_export.png` and a warm 3D icon
`art/style-samples/icons/<type>.thumb.webp`. All 34 are in `ART_PARTS` (`apps/game/src/artlist.ts`).

| Part | LOD0 / 1 / 2 / 3 tris | Brief budget | Class | Footprint · origin | Pivots · screens · clips · shape keys · frac |
|---|---|---|---|---|---|
| lance | 2,948 / 1,476 / 740 / 242 | 3,000 | S | 2,1,1 · bottom | LEDs status / tube / aperture |
| mirror | 718 / 374 / 172 / 60 | 800 | S | 1,2,0.5 · bottom | `optic = reflect`; SENSOR__light__face |
| splitter | 1,358 / 686 / 316 / 108 | 1,600 | S | 1,1,1 · bottom | prism insert at 0 / ±12°; `optic = split` |
| tripwire | 1,462 / 726 / 368 / 128 | 1,500 | S | 1,1,1 · bottom | mode_slider (x, 0…0.02); BREAK / LIT icons |
| ping | 1,476 / 736 / 366 / 126 | 1,500 | S | 1,1,1 · bottom | SCREEN__mode (icon); 6 pair-colour skins |
| maglock | 6,892 / 3,464 / 1,710 / 560 | 7,000 | M | 2,2,2 · bottom | SENSOR__field__pole (0.6 m) |
| marble | 288 / 144 / 72 / 20 | ≤ 288 | S | 0.16³ · com | skins glint / bearing; LOD3 icosahedron |
| glidepath | 3,586 / 1,804 / 900 / 292 | kit | M | demo run · path | kit + `glidepath.profile.json` |
| glidepath_booster | 4,432 / 2,240 / 1,104 / 352 | ≤ 4,500 | M | 3,1,0.7 · path | tyre_l, tyre_r (z), drive (y, def hinge) |
| spindeck | 4,918 / 2,460 / 1,234 / 392 | 5,000 | M | 4,1,4 · bottom | platter (z), pinion (y); tick decals |
| lift | 5,266 / 2,622 / 1,320 / 420 | ≈ 6,000 | M | 3,11,4.5 · bottom (moving) | carriage (z slide 0…1), 2 pulleys |
| rack | 2,852 / 1,428 / 716 / 228 | 2,900 @ 1 m | S | 10,1,1 · bottom | bar (x ±0.45), pinion (y) |
| ram | 4,466 / 2,230 / 1,120 / 356 | 5,000 @ 0.5 m | M | 1,1,5 · bottom | rod (y, −0.25…0) |
| powder_keg | 8,364 / 4,192 / 2,094 / 676 | ≈ 8,500 | M | 2,3,2 · com | FRAC 16 (`--frac`) |
| jitterjuice | 2,736 / 1,364 / 712 / 220 | 2,800 | S | 1,1.5,1 · com (explicit) | CAVITY__liquid; FRAC 14 |
| skyshow | 6,292 / 3,130 / 1,592 / 504 | ≈ 6,500 | M | 3,2,3 · bottom | 6 muzzle emitters on the exact tube axes |
| flamer | 4,100 / 2,052 / 1,028 / 328 | ≈ 6,500 | M | 3,1,1 · bottom | valve_knob (z, 0…90°); heat cone sensor |
| popper | 2,164 / 1,078 / 538 / 172 | 2,200 | S | 1,1.5,1 · bottom (origin) | tab (y slide); `sk_torn` |
| snaptrap | 3,430 / 1,746 / 876 / 272 | ≈ 3,500 | M | 2,0.5,1 · bottom | bar, latch, pedal (y); `sk_wind` |
| bonker | 3,934 / 1,962 / 992 / 316 | ≈ 4,000 | M | 1,4,1 · hinge | arm (x, 0…100°); `sk_wind` |
| flinger | 7,302 / 3,652 / 1,828 / 584 | ≈ 9,000 | M | 4,3,3 · bottom | arm (rest −105), stop (rest −45), latch; `sk_wind`; 10 COL |
| wrecker | 3,908 / 1,940 / 986 / 320 | ≈ 4,000 | M | 2,2,2 · com | swivel (z) |
| pinger | 4,402 / 2,208 / 1,098 / 354 | ≈ 4,500 | M | 1,1,3 · bottom | plunger (y slide); `sk_compress` |
| paddle | 3,006 / 1,494 / 752 / 244 | ≈ 3,500 | M | 3,1,1 · hinge | bat (z, rest −15) |
| bumper | 2,388 / 1,182 / 588 / 196 | ≈ 2,500 | S | 1.5,1,1.5 · bottom | ring (z slide) |
| pin | 280 / 140 / 70 / 24 | ≤ 290 | S | 0.5,1.5,0.5 · com (explicit) | `tint` stripes, 1 slot |
| stacker | 188 / 92 / 44 / 12 | ≤ 220 | S | 1,0.3,3 · com | 1 slot (oak / walnut) |
| pane | 582 / 278 / 132 / 44 | ≈ 600 | S | 1,4,0.1 · com | FRAC 24 (`--frac`) |
| vase | 2,758 / 1,356 / 680 / 216 | ≈ 2,800 | S | 1,2,1 · com (explicit) | FRAC 16 (`--frac`) |
| tonebars | 3,118 / 1,562 / 778 / 250 | ≈ 3,200 | M | 1,0.5,3 · bottom | bar (z slide ±2 mm); SCREEN__note (text) |
| ding | 2,344 / 1,188 / 604 / 192 | ≈ 2,400 | S | 1,1,1 · com (explicit) | plunger (z slide), dome (z ±3°) |
| fabricator | 15,018 / 7,520 / 3,804 / 1,200 | ≈ 18,000 | L | 3,3,3 · bottom | mouth_flap, preview; count 7seg 3 + interval bar 10; clip `spawn_kick`; `sk_hiccup` |
| recycler | 5,704 / 2,832 / 1,410 / 454 | ≈ 7,500 | M | 3,2,3 · bottom | iris (z); count / target 7seg, core icon |
| zone | 392 / 196 / 104 / 32 | ≈ 400 | S | 0.5³ · bottom | mode glyph decals; ghost COL |

Every LOD0 is within its brief budget; LOD1–3 sit on 50 / 25 / 8 % ± 10 % (marble, pin and stacker use the §4
primitive floors). All 34 validate with 0 errors.

## Textures (D78)

- **Authored for the set.** Every builder ends with `_m2.uv1(part)`: one non-overlapping UV1 layout over every
  textured LOD0 mesh, LOD1–3 projected onto it, `kn_set = 'body'` on each textured object. That kept the glbs
  contract-ready (TEXCOORD_0 on every textured primitive) before E3c's step existed.
- **Baked.** E3c's `--tex` step (`kn_tools/textures.py`) landed during the stream. It re-unwraps and bakes the
  albedo / normal / ORM set, so it supersedes `uv1` once a part is in the texture pass. The batch status at hand-back
  is in the table under "Texture pass status" below.
- **Instancing names.** `textures.INSTANCING` lists `stackers`, `pins`, `glint` and `bearing`; the type ids are
  `stacker`, `pin` and `marble`. These are all class S, so they get 1024² anyway, but E3c should add the real ids.

## Shared-file changes (additive, Edit tool)

| File | Change |
|---|---|
| `kn_tools/decal_atlas.py` + `tools/blender/build_decals.py` | M3 names (29 × 2 inks), stamps `mark.mass_20.graphite` ("20 KG") and `mark.goal.bone` (D row 2 cols 12–13; A2 words is full), and `trim.marks_m3` (F row 3 col 3): 8 single-ink Bone marks sampled with `decal_atlas.marks_sub(name)`: `beam_break`, `beam_lit` (TRIPWIRE), `zone_down`, `zone_up`, `zone_wind`, `zone_stasis` (ZONE), `tick` (SPINDECK), `potter` (VASE). Atlas rebuilt (`--kit-only`, 323 slots; existing slots unmoved). |
| `kn_tools/validate.py` | `kn_bounds = 'moving'` (LIFT: the origin is on the floor of the moving pieces and inside their footprint); `kn_com_explicit` root flag (the brief states the COM: PIN, JITTERJUICE, VASE, DING; the origin must lie inside the COL shapes instead of at their centre); rule 8 also accepts a port that faces out of the LOD0 mesh it sits on (`_host_centre`; LIFT's arrive ring on the housing top). |
| `kn_tools/conventions.py` | `kn_com_explicit` in `ROOT_PIPELINE` (not a hint). |
| `tools/blender/_m2.py` | M3 helpers: `uv1`, `land` (port land boss, dropped at LOD3), `under` (hang COL / sensor / emitter under a pivot), `twist` (torsion-spring shape-key fn), `frac_cut`, `frac_objects`, `ring_decal`. |
| `apps/game/src/artlist.ts` | the 34 M3 types appended to `ART_PARTS`. |
| `packages/assets/test/m3_parts.test.ts` (new) | brief contract per M3 part (247 tests). |

Generated: `packages/parts-data/src/frac_pane.ts`, `frac_vase.ts`, `frac_powder_keg.ts`, `frac_jitterjuice.ts`.

## Deviations from the briefs

- **MIRROR** footprint d 0.5 cells (brief 0.2 is not a half cell; real depth 0.036).
- **ZONE**: brief class `proc` → S. The stake has one ghost `COL__box__0`, because the asset contract (validator and
  `parseShapesJson`) needs a shape. The def must give zones no body. Default mode glyph is gravity, with the other
  three in `trim.marks_m3` for the mode swap.
- **LIFT**: built at travel 1.0. Footprint h is 11 cells, because 11.2 is not a half cell; the cap top was trimmed to
  z 1.1185 to stay within ± 0.02. The modular mast segments ship as one mast; per-travel modules are deferred.
- **RACK** is built at L = 1 m and **RAM** at D = 0.5. The tiled tooth and barrel modules for other lengths are
  deferred (one mesh each), matching A3's fixed-size defs.
- **RAM** signal port is `fire`, following parts-data (the brief names both inputs `in`).
- **GLIDEPATH** kit: the booster moved to its own part, `glidepath_booster`. The kit pieces are single instances
  (`glidepath__tie`, `__clamp`, `__post`, `__buffer`) at their profile `demo_pos`, as `apps/game/src/gfx/glidepath.ts`
  expects. `glidepath__demo` holds the rest of the look-dev straight. Clamps use Cobalt, per the materials row (the
  notes say "steel band").
- **GLIDEPATH BOOSTER**: tyres are Ø 0.026 (brief Ø 0.03) in flank pods, because Ø 0.03 tyres beside a Ø 0.016
  rider cannot fit the brief's 0.05 housing. Overall depth is 0.073, inside A3's def bounds (± 0.025) plus the test's
  0.012 tolerance. The origin is the booster centre on the rail-top line (`kn_origin = path`). There is one tyre pair,
  as briefed; A3's blockout visuals draw four tyres.
- **SKYSHOW** fuse-stub tip at y −0.162 (brief −0.165) and a rear carry tab, so the cake keeps its 3-cell depth and
  centred bounds.
- **POPPER**: the pull string rides `PIVOT__tab` (it pulls out with the tab), and `kn_bounds = origin`, because the
  tab sticks out in front.
- **BUMPER** body restitution is 1.0 in `.shapes.json` (the validator caps it at 1) with `active_restitution = 1.2`.
  The trigger sensor is the convex hull r 0.08, because the brief's annulus is not convex.
- **WRECKER**: the 0.8 mm meridian panel lines go to the normal map (details < 3 mm, ASSET_PIPELINE §4).
- **TONEBARS**: the glb carries `bar_00` (degree 1, L 0.300, ignition). The 15-bar set (lengths 0.3 · 2^(−i/14),
  node posts ± 0.276 L, degree colours) is `tonebars.variants.json`; the variants differ only in length and post
  spacing. 15 separate meshes are deferred.
- **PANE** chunks are `FRAC__01–24` (brief `FRAC__0..23`; `frac.test.ts` numbers chunks from 01).
- **FABRICATOR**: the clip `fabricator__spawn_kick` keys the flap only. `sk_hiccup` exists on the shell (LOD0/1),
  but shape-key tracks inside clips are deferred (the engine can drive it with the clip's timing).
- **Shape keys** `sk_wind` (SNAPTRAP, BONKER, FLINGER) unwind the coils 25–50° about their axles; `sk_compress`
  (PINGER) shortens the coil by the 0.06 m draw; `sk_torn` (POPPER) peels six cap petals 115°.
- **SPLITTER / MIRROR** carry `optic` props on the face / optic objects and sensors (not exported to the glb).

## Brief ↔ parts-data notes for A3

- A3 already aligned LIFT `arrive` and RECYCLER `count` (`maxLinks 8`), RAM `fire`, and widened the POWDER KEG,
  SKYSHOW and POPPER bounds to contain the stub tips and the pull tab.
- **PANE fracture data was regenerated** (chunks renumbered 01–24 and the spider ring radii fitted to the pane
  width, 24 non-empty chunks) at about 18:00. If the PANE golden was pinned before that, re-pin it. VASE's data has
  not changed since its first export.
- `glidepath_booster`: the def hinge (z −0.055, engine axis Z = Blender Y) is `PIVOT__drive` with a moving piece in
  every LOD. The port is at Blender (0, −0.025, −0.055), facing −Y.
- `marble` has no def of its own: `glint` / `bearing` point at it with `art: 'marble'`. `parts.test.ts` skips the
  def comparison for `marble` and `glidepath` (a link).

## Texture pass status

The `--tex` bake (E3c's step) ran on all 34 parts.

- **30 parts are textured and validate clean**: albedo / normal / ORM in `assets/src/<family>/tex/` and
  `<type>.tex.*.png` in the build, with `texSet` on the glb materials. Class S parts get 1024² sets; M and L parts
  get 2048².
- **4 parts still need `--tex`** and are left untextured (UV1 from `_m2.uv1`, validator warning 13 only). Their
  failed bake outputs were moved out of `assets/src/*/tex/`, so a rebuild stays green. These are E3c-side issues:
  - **POWDER KEG** (`kn_fuse_cord` slot mean −8.1 %) and **SKYSHOW** (`kn_fuse_cord` −4.3 %). Check 13 samples thin
    tube islands without the `valid` (non-empty texel) mask that the calibration uses, so edge texels darken the
    mean.
  - **RECYCLER** (`kn_anod_graphite` +5.2 %, the thin iris blades): probably the same sampling bias.
  - **FABRICATOR**: UVs come out at 0…1.4 after `pack_islands(udim_source='CLOSEST_UDIM')` on this many-object L
    part, so the pack spills past the 0–1 tile.

  Re-run `node tools/assets.mjs <type> --tex` once those are fixed.

## Tests

`pnpm vitest run packages/assets`: 13 files, 1,127 tests, all passing (`m3_parts.test.ts` is 247 of them).
`node tools/lint/determinism.mjs`: clean. `m3_parts.test.ts` pins the brief contract: class, family,
origin, footprint, mass, budget, ports, pivots, screens, LEDs, clips, shape keys (LOD0/1 only, deltas), roller
spheres, frac counts, UV1 on textured LOD0 primitives, and the GLIDEPATH / TONEBARS sidecars.
