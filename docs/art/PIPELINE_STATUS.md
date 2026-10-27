# Art Pipeline Status (M0–M5)

Status: 2026-10-25 · Owner: Tech Art · Contract: [ASSET_PIPELINE.md](ASSET_PIPELINE.md) · Gate: PRODUCTION §2 "Art pipeline"

**Where things stand (M5 docs pass):** the sections below are the history, milestone by milestone, from M0 to M3. Since then:
- **M3 (done):** the look-pivot work listed as "still to do" in its first section all landed: the M1 texture pass and texture-set validation (E3c), THE TINKER LAB, the 45-prop kit, the Kitchen pass and the Backlot art (E3b), and the 34 M3 part types authored textured (E3a, [M3_NOTES_E3a](../dev/M3_NOTES_E3a.md)).
- **M4 (done):** see [§ M4 art](#m4-art-e4a-e4b-e4c-and-ktx2-v4) at the end: the 15 M4 parts plus `toast_slice` (E4a), BISCUIT, HENNY and DUSTY (E4b), the M2 texture pass on all 29 parts (E4c, D100), and **KTX2 / BC7 for every set** from the in-house encoder (V4, D97), which resolves the "KTX2 / BC7: deferred" notes below.
- **M5 (done):** see [§ M5 art](#m5-art-e5a-e5b-e5c) at the end: the 11 M5 parts (E5a), BUZZ (E5b) and the Orbital Hangar and Moon Base sets (E5c).
- **Still deferred:** gltf-transform / meshopt, UASTC and ASTC (Apple), `tools/bake` (per-part SDFs, impostor bakes, turntables, the 2× thumbnail downsample). The engine works without them (RENDERING §0).

**M0 gate met:** THUD goes from Blender to engine files with no manual steps. `node tools/assets.mjs thud` builds the source `.blend`, validates it and exports it. `packages/assets` then parses the output, and vitest checks the result against the brief.

**M1 parts:** 22 more meshes (21 part types; COG ships one mesh per size) are built, validated and exported the same way.

![M1 parts contact sheet](../../art/style-samples/m1_parts.png)

![THUD export look-dev](../../art/style-samples/thud_export.png)

## Commands

| Command | What it does |
|---|---|
| `node tools/assets.mjs` | Every known part (has a `make_<type>.py` or an `assets/src/<family>/<type>.blend`): libs → make → validate → export |
| `node tools/assets.mjs thud --render --selftest` | One part. Also renders `art/style-samples/thud_export.png` from the exported glb and runs the validator self-test |
| `blender -b <part>.blend --factory-startup -P tools/blender/validate_part.py -- [--json r.json]` | Validator v1. Exits 1 on any error |
| `blender -b <part>.blend --factory-startup -P tools/blender/export_part.py -- [--out DIR]` | Validates, then writes `assets/build/parts/<type>/` |
| `blender -b --factory-startup -P tools/blender/build_libs.py -- --force` | Rebuilds `assets/src/lib/materials.blend` and `port_ring.blend` |
| `pnpm test` | Includes `packages/assets/test/thud.test.ts` and `parts.test.ts`. They skip, with a message, when the build output is missing |
| `blender -b --factory-startup -P tools/blender/render_contact.py -- art/style-samples/m1_parts.png` | Contact sheet of every exported part (LOD0, one cell each, labelled with type, size and tris). Also `node tools/assets.mjs --sheet` |
| `pnpm assets:kit` (`node tools/assets.mjs --kit-only`) | Rebuilds the shared decal atlas `assets/build/kit/decals_atlas.png` + `.json`. `node tools/assets.mjs` builds it first when it is missing; `--kit` forces a rebuild before the parts |
| `blender -b --factory-startup -P tools/blender/render_tinker_lab.py -- art/style-samples/tinker_lab_key.png --view hero --strict` | Tinker Lab key art with settling and the overlap check (§ Look and feel pivot below) |
| `blender -b --factory-startup -P tools/blender/render_thumbs.py -- art/style-samples/icons --warm --tactile --size 256` | Warm tactile 3D part icons |

Blender is found through the `BLENDER` env var, or else the default install path (4.5, then 4.4).

## What works

- **`kn_tools` add-on** (`tools/blender/kn_tools/`). Install it by zipping the folder (or symlinking it) into Blender's add-ons. The panel is in Sidebar → KNOCK-ON and offers New Part, Add Port, Snap Port Ring S/M/L, Validate Part, Export Part and Rebuild Libraries. Each operator is a thin wrapper over the plain modules (`template`, `ports`, `validate`, `export`, `library`), and the headless scripts call those same modules.
- **Libraries.** `materials.blend` holds about 95 masters from §5.1, using the capped powder albedos. `port_ring.blend` holds `PR_S/M/L`, built as lathe meshes with the shared_kit §1.1 proportions, +X outward. Parts link from both libraries; nothing is appended.
- **Port ring snap.** The selected `PORT__` empty snaps to the nearest RENDER surface and turns so that +X follows the surface normal. A linked `PR_<size>` collection instance (`PORT__…__ring`) is then parented to it.
- **Export** (§8). Writes `<type>.glb`, which is Y-up, has nodes `LOD0..LOD3` (pivots go under LOD0), uses master ids as material names and carries PBR factors as a fallback. Also writes `.art.json` (DATA_FORMATS §8.1 plus `family`, `origin`, `cavities`, `hints`), `.shapes.json` (§8.2) and `.report.json` (the validation result, sizes and deferred steps).
- **`@knockon/assets`.** `parseGlb` has no dependencies. It returns positions and normals already in part space, optional UVs, Uint16/Uint32 indices, material factors and LOD membership. The package also has strict `parseArtJson` / `parseShapesJson`, plus `loadPartAssets(type, { baseUrl, fetch })`, which cross-checks the LOD triangle counts.

### Validator v1 checks (§9 numbering)

1. Root `kn_*` properties (required, typed, vocabularies), file name = `kn_type`, known collections only (no nesting), one collection per object, name grammar per collection, no stray objects.
2. Metric units at scale 1, no unapplied or negative scale, applied location and rotation on render/sensor meshes (pieces under a pivot are exempt), origin rule from `kn_origin` (`com` checks the centre of the collider, `bottom` checks z = 0 and the footprint centre).
3. LOD0 bounds match `kn_footprint` ± 0.02 m. Placed devices must use whole or half cells.
4. LOD0 is within the class budget or the brief's `kn_tri_budget`, whichever is lower. LOD1/2/3 are 50/25/8 % ± 10 %, with the LOD3 primitive floor allowed.
5. Only masters linked from `materials.blend`, no empty or missing slots, ≤ 12 slots, textured-slot budget per class, no missing libraries.
6. Local images are square 1024/2048/4096, with the colour space checked from the name.
7. COL is present, with ≤ 12 shapes, known kinds, a `phys` vocabulary, restitution and friction within range, sphere check, convexity for box/capsule/cylinder/hull, ≤ 64 hull vertices and ≥ 5 mm thickness. `mesh` shapes are rejected on free bodies.
8. Ports: channel, `dir`, `size`, `kind`, `max_links` limits (including broadcast), a linked ring of the matching size, and +X facing outward. Sensors: kind vocabulary and convexity.
9. Pivots have an `axis`, and each moving piece sits under exactly one pivot.
10. LOD0 meshes are watertight. LOD1–3 only produce a warning.

`node tools/assets.mjs --selftest` checks that the clean THUD passes and that 11 broken variants fail on the expected rule: unapplied scale or rotation, negative scale, a renamed COL, a one-off material, a missing `kn_mass_hint`, no collider, a stray object, a missing LOD, a COL without `phys`, and a wrong footprint. It also checks the port snap: an outward port on the face passes, while a size mismatch or an inward-facing port fails. Finally it confirms that the CLI exits with 1 on a broken copy saved to `assets/build/selftest/`.

## THUD (`assets/src/rollers/thud.blend`, built by `tools/blender/make_thud.py`)

| LOD | Tris | Notes |
|---|---|---|
| LOD0 | 2,230 (brief ≤ 2,400) | Sphere with 40 segments and 10 strips per hemisphere, built in the band's frame. Ignition band 13 mm wide, 1.5 mm proud, on the −18° X / 8° Y great circle. Three Ø 23 mm × 35 mm steel bores with 2 mm bevelled lips. Watertight |
| LOD1 | 1,046 (46.9 %) | 12-segment bores, 1-segment lips |
| LOD2 | 544 (24.4 %) | 8-segment shallow bores. The silhouette stays round |
| LOD3 | 168 (7.5 %) | No holes. The band is kept as flush material |

COL: `COL__sphere__0`, r 0.110, `phys = powder`, restitution 0.12, friction 0.30. These match `packages/parts-data` and the vitest checks them. Root: `kn_mass_hint = 7.0`, footprint 2.2³ cells, `kn_origin = com`.

## M1 parts

Each part has a procedural `tools/blender/make_<type>.py` (COG: `make_cog_s/m/l.py` over the shared `_cog.py`) in the house style of `make_thud.py`, a source `.blend` under `assets/src/<family>/`, an export under `assets/build/parts/<type>/` and a look-dev render `art/style-samples/<type>_export.png` (`--render`).

| Part | LOD0 / 1 / 2 / 3 tris | Brief budget | Footprint (cells) | Pivots (**bold** = arm, on the def hinge) |
|---|---|---|---|---|
| bangstick | 5,044 / 2,548 / 1,270 / 400 | ≤ 5,500 | 3 × 1 × 1 (com) | none (FRAC__1..4 macro chunks authored) |
| the_button | 1,756 / 892 / 442 / 148 | 1,800 | 1 × 1 × 1 | cap (z, −6 mm … 0) |
| wick | 3,442 / 1,712 / 866 / 280 | ≈ 3,500 | 1 × 2 × 1 | none |
| motor | 7,114 / 3,544 / 1,616 / 570 | 8,000 | 2 × 2 × 2 | **armature** (x, on the spin port) |
| cog_s / cog_m / cog_l | 1,560 / 2,346 / 2,914 (LOD3 124 / 204 / 236) | 1,600 / 2,400 / 3,000 | 1 / 2 / 3 square × 0.5 (axle) | **gear** (y, origin) |
| mains | 4,102 / 2,046 / 1,038 / 334 | 4,500 | 2 × 2 × 1 (`kn_bounds = static`) | lever (x, modelled at +30 = "on") |
| stomp_pad | 1,356 / 688 / 334 / 112 | 1,400 | 2 × 0.3 × 2 | plate (z, −6 mm … 0) |
| gale | 5,098 / 2,548 / 1,278 / 410 | 6,000 | 1.5 × 2 × 1 | rotor (y) |
| boing | 1,960 / 928 / 448 / 156 | ≤ 2,000 | 2.4³ (com) | none |
| helio | 5,804 / 2,892 / 1,504 / 480 | ≤ 6,000 | 2.5 × 3 × 2.5 (com) | none (LOD3 = the 242-vert soft-body cage) |
| brik | 252 / 116 / 60 / 12 | ≤ 300 | 2 × 1 × 1 (com) | none |
| plank | 484 / 260 / 124 / 12 | 1.0 m ≈ 960 | 1 × 1 × 10 (com) | none |
| slope | 1,090 / 574 / 260 / 88 | ≤ 1,800 | 6 × 0.5 × 2 (authored flat; the engine tilts it with `artAt`) | none |
| ledge | 542 / 286 / 124 / 44 | ≤ 600 | 4 × 0.5 × 4 | none |
| fulcrum | 3,350 / 1,666 / 836 / 264 | ≤ 4,500 | 6 × 1 × 2 (hinge) | **beam** (y, ±12°) |
| anchor | 680 / 336 / 166 / 58 | ≤ 700 | 0.5³ | eye (z) |
| sheave | 1,658 / 844 / 400 / 140 | ≤ 1,700 | 1 × 1.5 × 0.5 (axle) | swivel (z) and wheel (y), siblings |
| treadway | 3,104 / 1,552 / 812 / 252 | 0.6 m ≈ 3,200 | 6 × 1 × 2 | **drum_l**; drum_r stays in the base |
| snipper | 3,976 / 1,986 / 998 / 320 | ≈ 5,000 | 3 × 1 × 2 (`kn_bounds = origin`) | half_a / half_b (modelled open, ±25°) |
| topple_tile | 252 / 116 / 60 / 12 | ≤ 280 | 0.3 × 1.5 × 0.75 (com) | none (`tint` vertex colour on band / top cap) |

### Pipeline changes for M1

- **`kn_tools/kit.py`**: the procedural kit the make scripts share. Watertight primitives (lathe, partial lathe, prism with rounded rims, extra rows and banded masters, pillowed box, swept tube, ring sweep, hull), EXACT booleans and plane cuts that stay closed, and `Part`, which wraps the template, links masters, adds pivots, ports with linked rings, COL / SENSOR / EMIT / SCREEN objects and builds the LODs: LOD0 is fitted under `kn_tri_budget`, then LOD1..3 are bisected onto 50 / 25 / 8 %.
- **Export**: LOD1..3 moving pieces now export under per-LOD pivot nodes `PIVOT__<name>__L<n>` (same transform), so every LOD keeps the moving / static split. This was the M0 "per-LOD pivot duplication" deferral.
- **Validator**: root `kn_bounds` (`all` by default; `static` judges origin and footprint on the housing, meaning pieces not under a pivot; `origin` judges only the origin that way) for parts whose moving piece sweeps past the housing (MAINS lever, SNIPPER open blades). The whole/half-cell rule now applies to height only from 1 cell up (STOMP PAD is 0.3 cells per its brief). A port passes rule 8 if it faces away from the LOD0 centre or from the static housing's centre (ANCHOR's eye stands over its ring).
- **`render_lookdev.py`** renders with Cycles (GPU when available) so clear poly and glass refract; `--eevee` keeps the quick draft. Framing uses LOD0's width as well as its height.
- **`@knockon/assets`**: `GlbMesh.node` (node index) and `pivotOf(glb, mesh)`. `test/parts.test.ts` checks every `ART_PARTS` build against `@knockon/parts-data`: LOD ratios, LOD0 inside the def bounds (same origin and scale as the sim body), ports (name, channel, dir, position ±1.5 mm, maxLinks, kind), and for hinged parts a pivot on the hinge axis carrying a moving piece in every LOD.
- **Game** (`apps/game/src/gfx/glbmesh.ts`, `artlist.ts`): for a part whose def has a `hinge`, meshes under a `PIVOT__*` node on the hinge axis (±2 mm) register as `<type>:arm` (part space, rest pose) and are left out of `<type>`. Other pivots (TREADWAY's idle drum, the button cap, the MAINS lever) stay in `<type>`. `ART_BASE` maps `cog_s/m/l` to the `cog` def. Transmissive shells (`kn_poly_clear/_beam/_plasma`, `kn_glass`) are skipped in game until the renderer has transmission, so the motor's windings stay visible.

### Brief ↔ parts-data mismatches

MOTOR, TREADWAY and SHEAVE now match the briefs in parts-data. The rest are deliberate or only affect blockout visuals and placement bounds.

| Part | Brief | parts-data |
|---|---|---|
| motor | `COL__cylinder__shaft` on the shaft, engine (0.101, 0.1, 0) | **fixed**: arm collider at (0.101, 0.1, 0) |
| treadway | drum collider on the drum axle, engine (−0.25, 0.058, 0) | **fixed**: drum collider at (−0.25, 0.058, 0) |
| cog | `COL__cylinder__body` at the tip radius, `sharp` | collides at pitch Ø − 8 mm (deliberate, gear constraint) |
| fulcrum | base is a 0.14 × 0.20 prism hull with its apex at the pin | base box 0.06 × 0.05 × 0.16 (visual 0.08 wide) |
| sheave | `COL__box__yoke` 0.07 × 0.10 × 0.046 (W×H×D) at z 0.03, so engine size [0.07, 0.10, 0.046] at y 0.03 | **fixed**: [0.07, 0.10, 0.046] at y 0.03 |
| helio | body top at z 0.1325 (×1.06) | bounds max y 0.155 |
| gale | size 0.20 wide, but the head is outer Ø 0.15 | bounds 0.20 wide (art footprint 1.5) |
| mains | lever (0.055 + Ø 0.022 ball) sweeps about 0.07 m in front of the face | bounds z ±0.05 |
| wick | `kn_wax` (bone by default; "classic" red is a skin tint) | visual colour red `#C9302C` |
| slope | 0.08 m knife-edge nose: the deck top tapers 0.05 → 0.006 m (plus `COL__hull__nose`), rails 0.015 m proud with colliders | **fixed**: the deck collider stops at the nose, and a thin box lies on the nose taper (`slopeParts`, [D71](../dev/DECISIONS_2026-10-24.md)). No rail colliders (no Rails prop yet), so the art rails are a 4 mm lip |

## Decal atlas and screens (M1)

**Atlas** (shared_kit §6): `tools/blender/build_decals.py` writes `assets/build/kit/decals_atlas.png` (4096², RGBA8, sRGB colour + straight linear alpha, transparent background, 4 px gutters, colour dilated 8 px) and `decals_atlas.json` (slot id → `rect` and `live` pixel rects, y down, the glTF UV orientation). The layout and slot ids live in `kn_tools/decal_atlas.py`. The make scripts read the same tables, so a part build never needs the PNG. Text is set in Blender (Workbench, Standard view transform, so the inks are exact: Bone `#E8E2D6`, Graphite `#3A3E47`). Pictograms and trims are numpy signed-distance shapes.

| Region | Contents built | Slot ids |
|---|---|---|
| A names | 28 M1 names × 2 inks (all M1 parts incl. TUBE, BAND, LINE, FUSE, SLOPE, STITCH, POWER / SIGNAL CABLE) | `name.<type>.<bone\|graphite>` (ink = text colour) |
| A2 words | IN OUT ON OFF MIN MAX PUSH PULL LOAD FIRE ARM RESET × 2 | `word.<word>.<ink>` |
| B spec | MOTOR "KN-07 · 24V · 1.5 rps", MAINS "KN-01 · 500 W" × 2 (the only M1 briefs with spec text) | `spec.<type>.<ink>` |
| C numerals | 0–9 . − + × ° % in sans and mono, both inks | `num.<glyph>.<sans\|mono>.<ink>` (glyph: `0`…`9`, `dot`, `minus`, `plus`, `times`, `degree`, `percent`) |
| D (row 4 spare cells) | COG tooth counts 20T / 40T / 60T × 2 inks | `mark.teeth_<n>.<ink>` |
| E pictograms | all 16, warning (Amber triangle, 14 px Graphite border) and mono (Bone outline) | `picto.<name>.<warn\|mono>` |
| F rows 1–2 | hazard 45° right / left / right with left / right round caps; narrow hazard right / left; Graphite tape; perforated grille | `trim.<tile>` |

**Fonts:** all three are the brief's typefaces, SIL OFL, vendored in `assets/src/lib/fonts/` with their licence files and logged in `assets/LICENSES.csv`:
  - **Unbounded Bold** (names, words, numerals, marks). It's the Google Fonts variable font instanced at wght 700 with fontTools.
  - **Inter Medium** (spec text). A local copy from the user font folder.
  - **JetBrains Mono Bold** (technical numerals). A local copy from Android Studio.

  Unbounded's outlines overlap where strokes cross, and Blender fills text even-odd, which punches holes there. So the bold face is rasterized with the non-zero winding rule (`fill_nonzero` in `tools/blender/build_decals.py`, 4×4 supersampled). The other faces are rendered by Blender. Unbounded has no ♯ / ♭, so those slots use DejaVu Sans Bold.

**Decals on parts** (`<type>__decal_<n>`, `kn_decal`, floated 0.2 mm, UV'd into the slot's live rect, LOD0 + LOD1 only; decals on moving pieces hang under that piece's pivot):

| Part | Decals |
|---|---|
| bangstick | label: name plate + explosive pictogram inside a 6 mm narrow hazard border |
| wick | hazard stripe ring round the puck (broken by the port facet) + flammable pictogram on the puck top |
| the_button | name plate wrapped on the base back |
| motor | right cap front: name plate + "KN-07 · 24V · 1.5 rps" |
| cog_s / m / l | "20T" / "40T" / "60T" on the web (under PIVOT__gear) |
| mains | face: name plate + "KN-01 · 500 W" + high-voltage pictogram |
| stomp_pad | name plate on the tray front |
| gale | name plate on the motor pod's +X flank |
| treadway | name plate (right guard) + pinch-point pictogram (left guard) |
| snipper | plinth front: name plate + blades pictogram |
| boing / helio | "BOING" / "HELIO" stamp draped on the ball / shoulder |
| fulcrum / sheave / ledge | name plate (base front / front cheek under PIVOT__swivel / Cobalt fascia) |
| plank | "PLANK" stencil on all four long sides |
| slope | name plate on the front Cobalt fascia |

**Screens**: MAINS `SCREEN__load` (kind `bar`, cells 10, color `power`) is SCR_BAR_10, a 56 × 14 mm quad recessed 1.5 mm in a pocketed graphite bezel (4 mm border, 2 mm / 1 mm radii) under a 1 mm `kn_glass` cover at LOD0. The RENDER quad `mains__screen` (`kn_screen`, all LODs) and the SCREEN object share one builder (`kit.screen_quad`), so `.art.json` `screens[].pos` equals the quad centre. Exported UVs: u = 0 (empty) → 1 (full) left to right, v = 0 at the bottom → 1 at the top.

**Pipeline**: the glTF exporter already writes TEXCOORD_0 for any mesh with a UV map; only decal and screen quads have one. Validator rule 10 exempts single-sided quads whose only masters are `kn_decal` / `kn_screen`. `render_lookdev.py` and `render_contact.py` bind the atlas to `kn_decal` (alpha-tested at 0.5), as the engine does. `parts.test.ts` checks that every `kn_decal` triangle's UVs lie inside one atlas slot, that decals sit only in LOD0/1, and that `kn_screen` quads are UV'd 0–1 and match an `.art.json` screen.

## Deferred (M1)

| Step | Why |
|---|---|
| Decal atlas regions not needed by M1 parts | Region D (channel glyphs, arrows, note names, marks) and F rows 3–4 (vents, panel line, stencils, camera tape) are empty; A has 52 of 240 name slots, B 4 of 256 spec slots |
| Decals at LOD2 | LOD2 should bake decals into the host's base colour; that needs the texture bake step, so LOD2 simply has none |
| Decals on BRIK, TOPPLE TILES, ANCHOR | Their briefs rule them out: the brick's mortar lives in its trim, tiles carry "no decals", the anchor has "no up-only detail" |
| Unique texture sets (BOING ORM + pebble normal, brick trim, oak trim, belt chevrons, blade and shell thickness maps) | Masters only for now |
| Shape keys (`sk_squash`, `sk_inflate`, `sk_pop`, `sk_drip`, `sk_pool`, `sk_wind`) and skins | Need engine hooks and skin bodies |
| Resizable modules (PLANK end/mid, LEDGE 9-slice, TREADWAY end/mid) | Exported at the parts-data catalogue size |
| `led` / `tint` vertex colours in the glb | Authored in the `.blend` (`tint` on TOPPLE TILES, `led` groups on TREADWAY). The exporter keeps the glTF default (no COLOR_0) until the engine reads them |
| SHEAVE lightening holes | The brief puts them entirely behind the Ø 0.07 cheek lobes, so the budget went to the silhouette instead |
| PLANK FRAC splinters, BRIK chip alternates | Need the fracture and chip engine path |

## Deferred in M0 (named hook points; reported as "deferred" in every export)

| Step | Where the hook lives | Why deferred |
|---|---|---|
| gltf-transform dedupe → prune → meshopt, size-budget report | `tools/assets.mjs postprocess()` | Needs `@gltf-transform/cli` pinned in the root `package.json` |
| KTX2 (toktx, ETC1S/UASTC) | `postprocess()` | M0 parts have no unique textures |
| SDF `.sdf.ktx2`, impostor `.impostor.ktx2`, thumbnails `.thumb*.webp` | `kn_tools/export.py DEFERRED` + `postprocess()` | They need `tools/bake` (Node + Dawn), which does not exist yet |
| `.frac.glb`, cavity fill LUTs | `export.py DEFERRED` (only flagged when FRAC/CAVITY objects exist) | No M0 part needs them |
| `KNM_<family>` node groups, shared tiling detail maps, `wear` attribute | `library.py` | Masters use one Principled BSDF plus a preview-only bump for now |
| `kn_decal` atlas (THUD's Bone "THUD 7KG" stamp) | `decals.blend` (M1) | The atlas doesn't exist yet. The slot is noted in the THUD `kn_notes` |
| Validator: front = −Y against the brief's port directions, critter rig checks (11), LICENSES.csv (12), clean quads around the boolean rims | `validate.py` | Need data from the brief or need M3+ content. **Rule 11 done in M2** (see below) |

## M2 parts (stream E1)

All 29 M2 parts are built the M1 way: a procedural `tools/blender/make_<type>.py` → `assets/src/<family>/<type>.blend` → validator (0 errors) → `assets/build/parts/<type>/`. All 29 are in `ART_PARTS`.
- **Shared helpers:** `tools/blender/_m2.py` holds the shared-kit pieces every M2 brief reuses: M3/M5/M8 heads, FOOT_S/M/L, foot bars, LED_D6/8/10, the §5 screen bezel with glass, coil springs and the `led` attribute. It also has the mechanism helpers `nest`, `clip` and `socket_rig`.
- **Contact sheet:** `node tools/assets.mjs --sheet-m2` → `art/style-samples/m2_parts.png`.
- **Brief checks:** `packages/assets/test/m2_parts.test.ts` checks each build against its brief.
- **Def mismatches:** see [M2_NOTES_E1.md](../dev/M2_NOTES_E1.md).

![M2 parts contact sheet](../../art/style-samples/m2_parts.png)

In the table, pivots marked `a<b` hang under pivot `b`.

| Part | LOD0 / 1 / 2 / 3 tris | Brief budget | Footprint (cells) · origin | Pivots | Screens · clips · sockets · cavities |
|---|---|---|---|---|---|
| stitch | 2,120 / 1,104 / 528 / 168 | 2,200 | 0.75³ · com | — | stamp "KN-ST"; LOD0 stitches as geometry |
| fuzz | 1,520 / 778 / 360 / 120 | 1,600 | 0.65³ · com | — | — |
| pig_iron | 1,750 / 886 / 400 / 140 | 1,800 | 1.2³ · com | — | stamp "6.5", hint `kn_magnetic` |
| gutter | 1,882 / 940 / 472 / 164 | kit | demo run 5.46 × 2.84 × 3.16 · **path** | — | kit + `gutter.profile.json` (see below) |
| vortex | 2,672 / 1,352 / 692 / 208 | 2,800 | 8 × 4.5 × 8 | — | `COL__mesh__0` |
| sprong | 6,254 / 2,942 / 1,580 / 492 | 6,500 | 3 × 0.5 × 3 | — | mat + 16 springs in one piece (for `sk_depress`) |
| trap_box | 7,198 / 3,518 / 1,780 / 576 | 8,000 | 7 × 5 × 5 | flag | 44 bars |
| scoop | 2,250 / 1,136 / 576 / 180 | 2,300 | 2 × 2 × 2 | bail (rest −75) | `CAVITY__contents` (fill, 3.5 L); bail port rides the pivot |
| flap | 1,374 / 694 / 352 / 108 | 1,400 | 3 × 0.5 × 3 · hinge | panel (0..+90) | — |
| dynamo | 17,714 / 8,850 / 4,422 / 1,418 | 18,000 | 3 × 2 × 2 | rotor | `output` bar 10 (X15) |
| hamster_drive | 15,736 / 7,878 / 3,944 / 1,252 | 16,000 | 3 × 3 × 2 | wheel, gear_a, gear_b | sockets `socket_pip`, `socket_pip_exit` |
| turbine | 6,660 / 3,326 / 1,658 / 532 | 7,000 | 2.5 × 4 × 1 | rotor, bevel_in, bevel_out | blade colliders at the 25° pitch |
| pedal_rig | 14,514 / 7,262 / 3,628 / 1,196 | 15,000 (XL, under the floor by design) | 4 × 4 × 2 | crank, pedal_l<crank, pedal_r<crank, flywheel | 9-bone device RIG → 7 sockets |
| puffer | 6,830 / 3,376 / 1,716 / 552 | 7,000 | 3 × 2 × 2 | lid | clip `puffer__squeeze` |
| cell | 1,772 / 892 / 430 / 142 | 1,800 | 1 × 2 × 1 | — | `charge` bar 5 (vertical) |
| suncell | 1,178 / 590 / 268 / 96 | 1,200 | 3 × 0.2 × 2 | — | — |
| lamp | 2,158 / 1,078 / 550 / 172 | 2,200 | 1 × 2 × 1 | — | 3-turn LED filament |
| torch | 2,458 / 1,236 / 610 / 198 | 2,500 | 2 × 1 × 1 | switch (slide) | — |
| burning_glass | 2,438 / 1,228 / 612 / 194 | 2,500 | 1 × 3 × 1 | — | biconvex lens |
| toggle | 1,572 / 786 / 394 / 132 | 1,600 | 1 × 2 × 1 (`kn_bounds = origin`) | lever (rest −25) | ports `in`, `out_power`, `out_signal` |
| ringer | 4,430 / 2,212 / 1,106 / 354 | 4,500 | 1 × 1 × 1 | hammer | `countdown` 7seg 4 |
| delay | 2,336 / 1,174 / 582 / 198 | 2,400 | 1 × 1 × 1 | knob, escapement | `delay` 7seg 3; in→out arrow decal |
| t_plunger | 6,888 / 3,428 / 1,724 / 548 | 7,000 | 2 × 3 × 2 | plunger (slide), pinion, armature | broadcast port (64) |
| skyrocket | 4,376 / 2,180 / 1,088 / 376 | 4,500 | 1 × 3 × 1 · com | — | spiral hazard stripe |
| big_top | 23,572 / 11,774 / 5,886 / 1,884 | 24,000 | 6 × 4 × 4 | carriage; elevation<carriage (rest 30); recoil<elevation; ram<recoil; wheel_l/r, flag<carriage | clip `big_top__recoil` |
| cork_blaster | 5,414 / 2,740 / 1,350 / 446 | 5,500 | 3 × 1 × 1 | plunger, piston (slides) | cork on its string (toy, no firearm cues) |
| punchline | 8,366 / 4,186 / 2,084 / 652 | 8,500 | 3 × 2 × 2 | ram_1; ram_2<ram_1; glove<ram_2 (slides) | — |
| gotcha_box | 13,674 / 6,840 / 3,418 / 1,092 | 14,000 | 2 × 2 × 2 (`kn_bounds = origin`) | crank, drum, lid, lean; spring<lean; head<spring | clips `gotcha_box__pop`, `gotcha_box__reset`; face decal |
| fishbowl | 14,686 / 7,290 / 3,690 / 1,184 | 15,000 | 3 × 3 × 3 | — | `CAVITY__water`; 21 FRAC chunks → `fishbowl.frac.glb` + `frac_fishbowl.ts` (`--frac`) |

### Pipeline changes for M2 parts

- **Nested pivots.**
  - Validator rule 9 accepts a pivot hanging directly under another pivot; each piece still belongs to its direct parent pivot.
  - The exporter rebuilds the chain for the LOD1–3 proxies and writes `pivots[].parent`.
  - Every M2 glb was checked: proxy world transforms match LOD0 exactly, including BIG TOP's rotated carriage → elevation → recoil → ram chain.
- **Pivot fields.** `pivots[].motion` is `slide` or `turn`, and `pivots[].rest` is the modelled pose. Items that ride a pivot carry a `pivot` field at their rest-pose position: shapes in `.shapes.json`, and sensors, emitters and ports in `.art.json`. The value comes from the object's `pivot` prop or its nearest PIVOT ancestor.
- **Baked clips** (ASSET_PIPELINE §6).
  - Authoring: `_m2.clip()` bakes `<type>__<clip>` at 30 fps on pivot empties and stores it as muted NLA tracks, so the saved pose stays at rest.
  - Export: one glTF animation per clip, with channels on the pivots of all four LODs. `export_animations` is on only when such actions exist.
- **Device sockets** (§3.9): `_m2.socket_rig()` builds the RIG armature (`root` + `socket_*`, optionally following a pivot) → `.art.json sockets`.
- **Screens:** `_m2.screen_bezel()` makes the §5 bezel, pocket and glass. M2 adds the first `7seg` screens (RINGER, DELAY); the screen's kind is in `.art.json`.
- **Origin kind `path`** for path-drawn kits; it skips the bottom-origin and half-cell checks.
- **Decal atlas** (262 slots):
  - names for the 28 new M2 parts, appended after M1's;
  - region D arrows `mark.arrow_in/out/both/rotate.<ink>`, stamps `mark.kn_st.graphite` and `mark.mass_6_5.bone`, and `mark.star.bone`;
  - `trim.face_gotcha` (F row 4 col 3, sampled through `decal_atlas.FACE_SUB`).
- **GUTTER is procedural like TUBE.**
  - `gutter.glb` is a kit: `gutter__channel`, a 0.5 m straight sweep demo with two masters on one mesh, plus `gutter__strap`, `__stop`, `__spout` and `__saddle`.
  - `gutter.profile.json`, written by `make_gutter.py`, holds the closed wide and slim profiles with per-edge masters, segments per LOD, path rules and piece anchors, for the engine sweep.
- **Tests:** `parts.test.ts` skips def comparisons for parts without a def yet, and compares pivot-riding ports at pivot 0 (`test/pivot_pose.ts`).
- **Part shape keys → glTF morph targets.**
  - Authoring: `Kit.shape_keys[name] = (target, meaning, default)`. The target is either the piece rebuilt in its other state (same vertex order; used for coils and the iris) or a per-vertex fn. `Part._emit` adds Basis + key (`kit.add_shape_keys`); the key value is the default weight.
  - Export: when any exported mesh has shape keys, the exporter turns on `export_morph` (with `export_apply` off, since applying modifiers would drop shape keys). Target names land in `mesh.extras.targetNames`, and `.art.json shapeKeys` lists name, mesh, LODs, default and the range meaning.
  - All six live on LOD0 + LOD1 only:

    | Part | Key | Piece | What it does |
    |---|---|---|---|
    | SPRONG | `sk_depress` | `mat` (now a gridded slab) | The centre dips 0.022 and the springs stretch |
    | PUFFER | `sk_squash` | `pleats` | Folds with the lid to −14 |
    | PUFFER | `sk_spring` | `spring` | Compresses with the lid to −14 |
    | CORK BLASTER | `sk_compress` | `spring` | 1 = cocked, default 1 |
    | PUNCHLINE | `sk_compress` | `spring` | 1 = wound, default 1 |
    | GOTCHA BOX | `sk_stretch` | `spring` | 0 compressed → 1 at the full 0.30 slide |
    | BIG TOP | `sk_iris` | `iris` | 0 open Ø 0.26 → 1 closed Ø 0.045; each leaf turns 46° about a rim pin |
- **Fracture export** (`node tools/assets.mjs <type> --frac`: `tools/blender/export_frac.py` over `kn_tools/frac.py`).
  - `<type>.frac.glb` has one root node per `FRAC__NN` in chunk order. Each node sits at its chunk's centre of mass in part space, the mesh is relative to that node, and there is a single LOD.
  - `packages/parts-data/src/frac_<type>.ts` holds generated literals for the sim's dormant chunk bodies (D66): per chunk its name, centre, volume, mass share and a convex hull of ≤ 32 points (a subset of the chunk's vertices), in engine metres, Y-up.
  - `test/frac.test.ts` matches every `frac_*.ts` against its glb.
  - FISHBOWL is the first user: 21 chunks with 32 hull points each.

### Deferred (M2 parts)

| Step | Why |
|---|---|
| Unique textures (V-stitch, fuzz, pitting, woven mat, wood bakes, thickness maps) | Masters only |
| Cavity fill LUTs | **Done in M4 (E4a):** `kn_tools/cavity.py` bakes volume, the 64-entry LUT, the cavity mesh and tilt LUTs into `.art.json cavities[]` at export; SCOOP, FISHBOWL and JITTERJUICE gain them on their next export ([M4_NOTES_E4a.md](../dev/M4_NOTES_E4a.md)) |
| GUTTER slim kit pieces, `vortex_slim`, 9-slice FLAP / resizable modules | Built at the catalogue size; slim GUTTER is profile-only |
| `led` vertex colours in the glb | As in M1: authored in the `.blend` only |

## M2: critters and the Mega Kitchen (stream E2)

![M2 critters contact sheet](../../art/style-samples/m2_critters.png)

![Mega Kitchen look-dev](../../art/style-samples/m2_kitchen.png)

Notes, deviations and the parts-data cross-check are in [M2_NOTES_E2.md](../dev/M2_NOTES_E2.md).

### Commands

| Command | What it does |
|---|---|
| `node tools/assets.mjs mochi pip goby bandit` | make (`make_<critter>.py` over the shared `_critter.py` / `_critter_anim.py`) → validate (rules 1–11) → skinned export |
| `node tools/assets.mjs --env-kitchen [--render]` | `env_kitchen.py`: writes `assets/src/env/kitchen/kitchen_set.blend`, `assets/build/env/kitchen/kitchen.glb` and `.env.json`, and generates `packages/parts-data/src/env_kitchen.ts`. `--render` also renders `m2_kitchen.png` (`render_kitchen.py --both`) |
| `node tools/assets.mjs --sheet-critters` | `render_critters.py`: imports the exported glbs and poses LOD0 with its own glTF clips (a round-trip check) → `m2_critters.png` |
| `node tools/assets.mjs --selftest` | Also runs `selftest_critter.py`, which breaks a clean critter 10 ways (5 influences, an unweighted vertex, a missing clip, a missing role clip, root motion, no head capsule, wrong ragdoll mass, no swing, 110 bones, 24 fps), each of which must fail rule 11 |

### Critters

| Critter | LOD0 / 1 / 2 / 3 tris | Deform bones | Clips (17 required + role) | Face keys | RAG__ | glb |
|---|---|---|---|---|---|---|
| MOCHI | 37,050 / 18,524 / 9,262 / 2,964 | 44 | 22: + pounce, arch_scared, groom, stalk, shove | 17 + whiskers_fwd, blep, fur_puff | 15 · 4.0 kg | 3.7 MB |
| PIP | 25,348 / 12,674 / 6,336 / 2,026 | 29 | 23: + wheel_run, wheel_sprint, wheel_exit, stuff_cheeks, burrow_enter, burrow_exit | 17 + cheeks_full, nose_twitch, whiskers_fwd | 7 · 0.12 kg | 2.6 MB |
| GOBY | 25,000 / 12,500 / 6,250 / 2,000 | 28 | 20: + swim, flop, bubble_rescue (the required set mapped to a swimmer) | 17 (upper lids only) + pucker, gulp, cheeks_puff | 4 · 0.03 kg | 2.4 MB |
| BANDIT | 43,874 / 21,936 / 10,968 / 3,504 | 43 (+ `prop_r` socket) | 24: + pedal, pedal_mount, pedal_dismount, steal_grab, steal_carry, loot_admire, wash_hands | 17 + grin_sly, whiskers_fwd, eyes_sparkle | 14 · 5.5 kg | 3.9 MB |

How a critter is built (`tools/blender/_critter.py`):

- **Body.** A soft-sculpt metaball body: ellipsoid and capsule elements, each bound to a bone, in the brief's root space. It is built 20× larger because Blender clamps the metaball resolution to 5 mm, then collapse-decimated to the LOD budget. LOD0 is watertight.
- **Fur regions.** Faces get a fur region master from a per-critter region function (points, belly, mask, stripe, tail rings and so on).
- **Skin weights** come from the same metaball field that made the surface: top 4 bones, normalised. Closed accessory pieces are rigid or carry their own field.
- **Face pieces** (eyes with modelled catchlights, thin-shell lids, brows, mouth, nose, tongue, whiskers) are parametric. Each shape key rebuilds them with the same topology, so the keys exist on every LOD; they are exported on LOD0 and LOD1.
- **Rig.** `RIG` armature with the brief's bones and a `root` on the floor under the COM. The part origin is the COM and the locomotion `COL__capsule__0` is centred on it.
- **Ragdoll.** `RAG__<bone>` capsules hold stream B's ragdoll rows (`swing_deg`, `twist_deg`, `mass`, `rag_parent`).
- **Clips** (`_critter_anim.py`) are procedural channel functions (gait, sit, lie, biped, swim wave), mapped to armature-axis bone rotations. Each clip is baked every frame into an action `<type>__<clip>` on its own muted NLA track. Loops are periodic. The root is never keyed.

Export (`kn_tools/rig.py`, dispatched from `export.py` for family `critters`):

- one skin;
- LOD0..3 nodes with one skinned mesh each;
- one glTF animation per action, force-sampled at 30 fps;
- sparse morph targets.

`.art.json` adds `rig`, `skin`, `ragdoll` (B's RagBone fields: `a`, `b`, `rootPos` = `at`, `rot`, `halfHeight`, `parent`), `clipInfo`, `roleClips`, `shapeKeys` and `emitterBones`.

### Mega Kitchen (`tools/blender/env_kitchen.py`)

The set is 5 : 1 in set coordinates, built from one table: each visible piece's call also emits its collider. The set comprises:

- 1.5 m checker floor;
- back and left walls (13.5 m, window, doorway, cornice);
- the back counter run with the sink canyon (1.1 m deep, chrome tap) and the left counter run, both with toe kicks, doors and Graphite pulls;
- uppers, fridge, stove;
- walnut island, oak table, 4 Cobalt chairs, rug;
- mixer, kettle, cereal box, dish rack and plates, spice jars, cookie jar, herb pot, cat bowl, wall clock, 3 pendants on the Z 25 m rail;
- garden and sky backdrop, dark hallway;
- the env_scale_ref per preset.

| | Value |
|---|---|
| LOD0 / 1 / 2 / 3 | 123,104 / 58,028 / 28,994 / 8,552 tris (rebuilt at lower segment counts) · backdrop 4,084 · scale refs 10,552 |
| Colliders | 212 boxes + 6 spheres per preset (215 / 7 authored, with each preset's own scale ref) |
| Masters | 22, including the new `kn_env_floor_tile`, `_floor_tile_grey`, `_counter`, `_wall`, `_foliage`, `_backdrop` (plus `kn_env_cyc_light/_dark` for the Studio) |
| Data | `packages/parts-data/src/env_kitchen.ts` (`KITCHEN`, generated literals, determinism-lint clean) and `assets/build/env/kitchen/kitchen.env.json` |

## Look and feel pivot: look-dev tools and renders (M3 start)

The first tools for the D77–D79 pivot exist ([D78](../dev/DECISIONS_2026-10-24.md)). *(Written at M3 start; the texture pass, the Tinker Lab environment asset, the Kitchen pass, the props kit, the glass UI and the renderer look pass all landed in M3: the sections below and [M3_STATUS](../dev/M3_STATUS.md).)*

![Tinker Lab key art](../../art/style-samples/tinker_lab_key.png)

| Tool | What it does |
|---|---|
| `tools/blender/render_tinker_lab.py` | Tinker Lab key art from the exported part `.glb`s. `blender -b --factory-startup -P tools/blender/render_tinker_lab.py -- <out.png> [--res 1920x1080] [--samples N] [--view hero\|wide\|lobby] [--no-volume] [--check] [--strict]`. It settles every resting part and MOCHI onto its real support from the evaluated (posed) mesh, casting rays three ways (part vertices down, support vertices up, and a 17 × 17 grid over the footprint, because vertex-only rays miss crossed bricks), then runs a triangle-level overlap check (BVH) on everything placed. `--check` prints the report without rendering; `--strict` fails the render on any interpenetrating pair. The final hero render passed with **0 overlapping pairs** |
| `tools/blender/render_thumbs.py` | Part thumbnails per ui_icons.md §6 (azimuth 30°, elevation 20°, vertical FOV 24°, bounding sphere 80 %, or 88 % with `--crop128`, shifted up 6 %, transparent with a shadow catcher). Flags `--warm` (Tinker Lab light), `--tactile` (look-dev surfaces), `--types a,b`, `--size`, `--samples`. Writes `<type>.thumb.webp`. Renders straight at the output size (the 2×-then-Lanczos step is left to `tools/bake`). Critters are skipped |
| `tools/blender/_tactile.py` | Procedural Cycles stand-ins for the D78 texture sets: enamel with worn edges and darkened cavities, wood grain along the longest axis, brass and copper patina, scratched steel, paper fibre, rubber, brick, cord, ceramic. Colours come from the master table. **Look-dev only**: the target for the texture pass, not shipped materials |

**Renders in `art/style-samples/`:** `tinker_lab_key.png` (hero key art, 1920 × 1080), `tinker_lab_lobby.png` (shallow-focus close-up for the lobby and title), `icons/` (28 warm tactile part icons, 256², `.thumb.webp`).

### Known issues (look and feel pivot)

| Issue | Status |
|---|---|
| Blender renders the bundled `assets/src/lib/fonts/Unbounded-Bold.ttf` with "T" drawn as "V". The glyph is present in the cmap (checked with fontTools) | Worked around: the Tinker Lab chalkboard text uses DejaVuSans-Bold. **Open:** the decal atlas (`build_decals.py`) also sets text in Unbounded and must be checked |
| `render_thumbs.py` renders at the output size, not 2× with a Lanczos downsample (ui_icons.md §6) | Left to `tools/bake` |
| No critter thumbnails from `render_thumbs.py` | Critters have their own card art (critters.md) |

## M3 texture pipeline and the M1 texture pass (stream E3c)

Every M1 part now ships a unique D78 texture set ("loved, not grimy"): albedo, normal and ORM, baked from production versions of the `_tactile.py` looks. Notes, file layout for the renderer (L3), sizes and budgets: [M3_NOTES_E3c.md](../dev/M3_NOTES_E3c.md).

![M1 texture pass, before | after](../../art/style-samples/m3_textured_m1.png)

| Command | What it does |
|---|---|
| `node tools/assets.mjs <type> --tex` | make → **tex** (`texture_part.py`: UV1 atlas over LOD0–3, Cycles bake, `assets/src/<family>/tex/<type>__body__{basecolor,normal,orm}.png`) → validate (rule 13) → export (`<type>.tex.{albedo,normal,orm}.png`, `.art.json textures`, glb `extras.texSet`, TANGENT). Once a part has a source set, every rebuild re-bakes it |
| `node tools/assets.mjs --sheet-tex [type ...]` | `render_textured.py` → `art/style-samples/m3_textured_m1.png` (masters only on the left, set bound as the engine binds it on the right) |
| `node tools/assets.mjs --selftest` | Also breaks THUD's set 8 ways (missing map, size mismatch, colour space, grey metallic, albedo over 0.85, hue shift, piece without `kn_set`, −Y normal), each must fail rule 13; a part with no set only warns |

**Validator rule 13** (`kn_tools/textures.py check`): one set `body` per part; three maps present, same size, at the class size (S 1024², M/L 2048², instancing-heavy 1024²); files `tex/<type>__body__<map>.png`, no unlisted `<type>__*` files in `tex/`; colour spaces (basecolor sRGB, normal/ORM Non-Color); every textured piece has UVs in 0..1 and `kn_set`; basecolor linear peak p1 ≥ 0.03, p99 ≤ 0.85; each slot's mean keeps its master's value within ±4 % and hue within 8°; ORM metallic 0 or 1 (soft edges ≤ 4 px); normal map OpenGL +Y and tangent-space. Parts with no set (M2, new M3 parts not yet textured) get a warning, not an error. Critters are skipped.

**Anodised masters read as enamel** (D79 review decision): `kn_anod_*` slots bake as enamel paint over metal (metallic 0, 1 only on worn edges, roughness about 0.45). Close-ups: `art/style-samples/m3_textured_m1_detail.png`.

**KTX2 / BC7: deferred.** No offline transcoder (toktx, basisu, gltf-transform) is installed and nothing was downloaded, so the sets ship as PNG; `postprocess()` and `.report.json` list the KTX2 step as deferred. *(Resolved in M4: the in-house BC7 encoder, D94 / D97; see the M4 section at the end.)*

## M3 environments: THE TINKER LAB, the props kit, the Kitchen pass, Backlot terrain art (stream E3b)

Notes, decisions and the data contracts (L3 renderer, S3 terrain, orchestrator): [M3_NOTES_E3b.md](../dev/M3_NOTES_E3b.md). The brief is [environments.md](briefs/environments.md) §2.8, §3 (now matching D82: real scale, key light from behind-right), §4 and §7.

![Tinker Lab look-dev: the key-art hero frame from the exported set, and the Room view](../../art/style-samples/m3_tinker_lab.png)

![Props kit contact sheet](../../art/style-samples/m3_props.png)

![Mega Kitchen maximalism pass](../../art/style-samples/m3_kitchen_pass.png)

| Command | What it does |
|---|---|
| `node tools/assets.mjs --props [--sheet-props]` | `props/build_props.py`: 45 `kn_prop_*` props (128 variants) → `assets/src/env/_shared/props/kn_prop_<name>.blend` and `assets/build/env/props/kn_props.glb` + `.json`; `--sheet-props` renders `m3_props.png` |
| `node tools/assets.mjs --env-tinker [--render]` | `env_tinker.py` → `assets/src/env/tinker/tinker_set.blend`, `assets/build/env/tinker/tinker.glb` (LOD0–3, BACKDROP, REF__scale__desk/room, PROBES), `.env.json`, `ibl_tinker_lab.hdr` + `.json` (Cycles equirect + SH9), `lut_tinker_lab.png`, and `packages/parts-data/src/env_tinker.ts`. `--render` adds `m3_tinker_lab.png` (`props/render_tinker.py --both`: hero with the key-art machine, and the Room view with the §0.10 value check) |
| `node tools/assets.mjs --env-kitchen` then `--kitchen-pass` | `env_kitchen.py` now carries the maximalism pass (colliders unchanged); `props/render_kitchen_pass.py --both` → `m3_kitchen_pass.png` |
| `node tools/assets.mjs --env-backlot [--render]` | Exports S3's default Arena lot (`props/export_default_lot.ts`), then `props/env_backlot.py` → `assets/build/env/backlot/**` (terrain layers, heightfield copy, dressing glb, `backlot.json`); `--render` adds `m3_backlot.png` |

| Asset | LOD0 / 1 / 2 / 3 tris | Colliders | Notes |
|---|---|---|---|
| THE TINKER LAB (`tinker.glb`, 21 MB before meshopt) | 314,977 / 116,659 / 78,290 / 22,894 · backdrop 6,308 · scale refs 7,640 | 193 boxes + 3 spheres per preset (+ the ambient MOCHI capsule) | 63 masters, 39 kit props placed; the tests check every collider sits on visible LOD0 geometry |
| Mega Kitchen with the pass (`kitchen.glb`) | 153,572 / 73,420 / 43,088 / 16,964 (M2: 123,104 / 58,028 / 28,994 / 8,552) | unchanged: 212 boxes + 6 spheres (Warehouse) | `env_kitchen.ts` boxes and spheres are identical to M2 |
| Props kit (`kn_props.glb`, 5.7 MB) | per prop in `kn_props.json` (e.g. book 360, globe 2,268, microscope 2,908, plant_tall 1,264, shelf_unit 1,540) | per prop (box / sphere), used when placed in reach | 45 props, 128 variants |
| Backlot dressing (`backlot_dressing.glb`, 1.6 MB) | 114,280 LOD0 tris placed in the Arena bounds | 160 boxes over 175 placements | 14 pieces; terrain layers 4 × 3 maps at 1024² |

New masters (additive, `kn_tools/masters.py` `ENV_MASTERS`): `kn_env_floorboards`, `_plaster_warm`, `_bench_oak`, `_cutting_mat`, `_cutting_mat_grid`, `_chalkboard`, `_chalk`, `_pegboard`, `_cork`, `_wainscot`, `_blueprint`, `_terracotta`, `_foliage_dark`, `_book_red/_blue/_mustard/_green/_plum/_navy`, `_backdrop_warm`, `_bulb`, `_enamel_green`, `_grass`, `_dirt`, `_sand`, `_rock`, `_hay`, `_concrete`. `materials.blend` was rebuilt with `--force-libs`.

## M4 art (E4a, E4b, E4c) and KTX2 (V4)

Added in the M5 docs pass; the details, measurements and open issues are in each stream's notes.

| Stream | Built | Commands | Notes |
|---|---|---|---|
| **E4a** M4 part art | The 15 Ship = M4 parts plus `toast_slice` (16 types), each with a procedural `tools/blender/make_<type>.py`, LOD0–3, a D78 texture set and a validated export (0 errors); container **cavities** with 64-entry fill LUTs (`kn_tools/cavity.py`) for the renderer's fill pass. Contact sheets `art/style-samples/m4_parts.png`, `m4_parts_textured.png` | `node tools/assets.mjs <type>` | [M4_NOTES_E4a](../dev/M4_NOTES_E4a.md) |
| **E4b** M4 critters | BISCUIT, HENNY and DUSTY at the M2 critter standard: rigs, 20–23 clips, face keys (DUSTY: an LED face with 12 icons, `faceTracks`), `RAG__` ragdolls matched to the sim, texture sets (4096² for the animals, 2048² for DUSTY). Sheet `art/style-samples/m4_critters.png` | `node tools/assets.mjs biscuit henny dusty` (the make scripts bake their own set) | [M4_NOTES_E4b](../dev/M4_NOTES_E4b.md) |
| **E4c** M2 texture pass | All 29 Ship = M2 parts textured (rule 13, 0 errors), with the bake and calibration fixes. Four large parts sit below the 1,024 px/m density standard at their class set size (GUTTER 704, VORTEX 399, TRAP BOX 794, BIG TOP 811), PEDAL RIG uses 2048², PIG IRON is satin cast iron (D100). Sheet `art/style-samples/m4_textured_m2.png` | `node tools/assets.mjs <type> --tex` | [M4_NOTES_E4c](../dev/M4_NOTES_E4c.md) |
| **V4** KTX2 / BC7 | An in-house BC7 encoder and KTX2 writer (`kn_tools/bc7.py`, `kn_tools/ktx2.py`, driver `tools/blender/encode_ktx2.py`): full mips, zlib supercompression, `<type>.tex.{albedo,normal,orm}.ktx2` next to the PNGs and listed in `.art.json → textures.ktx2`. All 105 sets encoded; albedo ≥ 53.1 dB, normals ≤ 0.48° mean error, ORM ≥ 49.7 dB; the RTX 5090's decode matches the reference bit for bit; VRAM at 16 GB 3.25 GB vs 7.00 GB with PNG; downloads 34 % larger (D97) | `node tools/assets.mjs --ktx2` (after a build) or `--ktx2-only [type …]` (no Blender); `--selftest` includes the encoder | [M4_NOTES_V4](../dev/M4_NOTES_V4.md) |

The engine loads KTX2 when the adapter has `texture-compression-bc` and falls back to the PNG (with a small GPU encoder at load) otherwise. **Still open from M4:** UASTC / ASTC for Apple (no approved toolchain), and the art-side items in M4_STATUS's known limits (DUSTY's face icons, TOAST CANNON's slices node, GUTTER's set in play), which R5 is working through in M5.

## M5 art (E5a, E5b, E5c)

Added in the final M5 docs pass; details in each stream's notes.

| Stream | Built | Commands | Notes |
|---|---|---|---|
| **E5a** M5 part art | The 11 Ship = M5 parts (RIFT GATES, GRAV WELL, TRACTOR BEAM, HOVER PAD, FORCE WALL, COILGUN RING, STASIS FIELD, BUZZ BEACON, SINGULARITY, GRABBER, GOO VAT), each with `tools/blender/make_<type>.py` (house style in the new `_m5.py`), LOD0–3, a D78 texture set and its KTX2 / BC7 build; all in `ART_PARTS`, **0 errors and 0 warnings** (rule 13 included). Resizable FORCE WALL and STASIS FIELD pieces and GRABBER's link pivots are split for the engine (RENDERING §0). Sheets `art/style-samples/m5_parts.png`, `m5_parts_icons.png` | `node tools/assets.mjs <type> [--ktx2]` | [M5_NOTES_E5a](../dev/M5_NOTES_E5a.md) |
| **E5b** BUZZ | A rigid robot critter like DUSTY: 21,760 LOD0 tris, 13 deform bones (rotors, visor, winch, claws, pennant), 23 clips (the 17 required + takeoff, land, grab, carry, drop_off, deliver_bow), an LED visor with `faceTracks`, a rigid `RAG__body` box (1.1 kg), a 2048² set with KTX2. Validator: 0 errors, 1 allowed warning (under the XL tri floor, fine for robot critters). Sheet `art/style-samples/m5_buzz.png` | `node tools/assets.mjs buzz` | [M5_NOTES_E5b](../dev/M5_NOTES_E5b.md) |
| **E5c** environments | ORBITAL HANGAR "Bay 2" (Warehouse, 162k LOD0 tris) and "Main Hall" (Arena, 559k), one glb per bay with per-bay IBLs; MOON BASE (one set for Room, Warehouse and Arena, 285k LOD0 tris, `moon_boulders.glb` tier extras that never touch the sim), authored heightfields (129² / 129² / 513²), terrain textures, LUTs, convex hull colliders, ≤ 8 renderer practicals per preset, the Moon's `lightGroups.baseLights`, the baked backdrop Earth as an environment texture set (`<id>.env.json → textures`; a 105° art-directed phase and no spin, D112), and the generated `env_hangar.ts` / `env_moon.ts` tables. Shared helpers in `kn_tools/envset.py` (new) | `node tools/assets.mjs --env-hangar [--render]`, `--env-moon [--render]` | [M5_NOTES_E5c](../dev/M5_NOTES_E5c.md) |
