# M3 notes: stream E3c, texture pipeline + M1 texture pass

Status: 2026-10-24 · Stream E3c · Plan: [M3_PLAN.md](M3_PLAN.md) contract 1 · Decisions: [D78](DECISIONS_2026-10-24.md) · Contract docs: [ASSET_PIPELINE v1.1 §5.2, §9](../art/ASSET_PIPELINE.md), [ART_BIBLE v1.1 §3.1, §4](../art/ART_BIBLE.md)

All 23 M1 meshes (21 part types; COG ships S/M/L) now carry a unique D78 texture set: albedo, normal and ORM, baked in Cycles from production versions of the `_tactile.py` looks and held to the ART_BIBLE §4 wear limits ("loved, not grimy": no rust, dirt or grime). Each part was rebuilt, validated (rule 13 included, 0 errors) and exported.

![M1 texture pass, before | after](../../art/style-samples/m3_textured_m1.png)

Close-ups (FULCRUM, PLANK, BRIK, MOTOR, COG_M, WICK): `art/style-samples/m3_textured_m1_detail.png`.

## For stream L3: the file layout and colour spaces

Per part, next to `<type>.glb` in `assets/build/parts/<type>/` (served as `/parts/<type>/…`):

| File | Content | Colour space / encoding |
|---|---|---|
| `<type>.tex.albedo.png` | Base colour, final (cavities, polish and worn edges included). Linear peak channel 0.03–0.85 | **sRGB**, 8-bit RGB (no alpha) |
| `<type>.tex.normal.png` | Tangent-space normal, **OpenGL +Y** (green = +bitangent), unsigned `n * 0.5 + 0.5` | **linear**, 8-bit RGB |
| `<type>.tex.orm.png` | R ambient/cavity occlusion (1 = open), G roughness, B metallic (exactly 0 or 1) | **linear**, 8-bit RGB |

- **Sizes:** every map of a set is square and the same size: **1024²** (class S and the instancing-heavy BRIK / TOPPLE TILE) or **2048²** (class M). So L3 needs two array sizes (1024 and 2048) × three maps (albedo sRGB, normal, ORM), one layer per part set (ASSET_PIPELINE §5.3).
- **Orientation:** PNG rows are top-first in glTF UV orientation, so sample `(u, v)` from TEXCOORD_0 as-is (the same convention as `decals_atlas.png`). No flip.
- **Index:** `.art.json → textures`:
  ```json
  "textures": { "albedo": "thud.tex.albedo.png", "normal": "thud.tex.normal.png", "orm": "thud.tex.orm.png",
    "size": 1024, "set": "body", "format": "png",
    "colorSpace": { "albedo": "srgb", "normal": "linear", "orm": "linear" }, "normalY": "+Y",
    "orm_channels": "occlusion,roughness,metallic", "uv": "TEXCOORD_0",
    "slots": ["kn_powder_graphite", "kn_powder_ignition", "kn_steel_brushed"], "bytes": { … } }
  ```
  `@knockon/assets` parses it: `ArtJson.textures?: ArtTextures` (`albedo`, `normal`, `orm`, `size`, `set`, `format`, `slots`).
- **Which primitives sample it:** a glb material whose master is in `textures.slots` carries **`extras.texSet = "body"`** (`GlbMaterial.texSet` in `parseGlb`). Every primitive drawn with such a material has **TEXCOORD_0** (in 0..1) on **all four LODs**. Materials without `texSet` (`kn_poly_*`, `kn_glass`, `kn_chrome`, `kn_led`, `kn_screen`, `kn_decal`, `kn_interior_*`) keep today's master path; their UVs, where a mesh has any, are parked on texel (0, 0) and must not be sampled.
- **Tangents:** textured parts export glTF **TANGENT** (MikkTSpace, the frame the bake used; w = handedness). Use them; deriving tangents in the shader instead gives small seams. Meshes with n-gons are triangulated by the tex step so the tangents are exact (tri counts unchanged).
- **How the set layers over the master** (ASSET_PIPELINE §5.2): the set replaces the master's base colour, roughness and metallic constants; the master keeps coat, sheen, transmission, IOR, anisotropy and the tiling detail layer (orange peel, brushed, wood grain, pitting), which goes on top of the set normal. ORM R is cavity occlusion for the indirect / ambient term only (do not darken direct light with it). In the Cycles look-dev binding (`render_textured.py`) albedo is multiplied by `mix(1, R, 0.5)`.
- **Decals** (`kn_decal`) are unchanged: their own UVs into the shared atlas, no set.
- **KTX2 / BC7 not yet:** no offline transcoder is installed (`toktx`, `basisu`, gltf-transform, compressonator: none found; nothing downloaded), so the sets ship as PNG. The file names will become `<type>.tex.<map>.ktx2` (UASTC + RDO + zstd, full mips, BC7 on desktop) when `toktx` is pinned; `.art.json textures.format` will say `ktx2`. Until then L3 decodes PNG and generates mips itself.

## The pipeline

| Piece | Where |
|---|---|
| Module | `tools/blender/kn_tools/textures.py`: looks, UV1 atlas, bake, calibration, PNG writer, export (`export_set`, `patch_glb`), validator rule 13 (`check`) |
| Headless step | `tools/blender/texture_part.py` (`blender -b <part>.blend -P texture_part.py -- [--size N] [--samples N] [--no-save]`) |
| Driver | `node tools/assets.mjs <type> --tex`: make → **tex** → validate → export. Once `assets/src/<family>/tex/<type>__body__basecolor.png` exists, every rebuild re-bakes the part (deterministic: same mesh, same seedless bake) |
| Sheet | `node tools/assets.mjs --sheet-tex [type ...]` → `tools/blender/render_textured.py` → `art/style-samples/m3_textured_m1.png` |
| Hooks (additive) | `validate.py` calls `textures.check` (rule 13); `export.py` writes the build set, `.art.json textures`, glb extras and turns on `export_tangents` for textured parts; `conventions.ROOT_PIPELINE` gains `kn_tex_size`, `kn_tex_version` (so they are not exported as hints) |

What the tex step does, per part:

1. **Triangulate n-gons** of textured pieces (MikkTSpace needs tris / quads).
2. **Hidden faces:** every textured face casts 16 rays over its outer hemisphere, from its centroid and from each corner pulled 15 % inward, against the opaque geometry of its LOD (clear poly and glass don't occlude). Faces whose rays all hit (BOING's octant closing caps, pieces sunk into others) are flagged in a boolean face attribute `kn_hidden` (never exported) and are laid out in a strip of 4-texel cells along the top of the tile (one cell per face), so they still bake their own colour (cutaways, folded triangles) but cost almost no atlas space and never enter the pack. Counts are in the table below.
3. **UV1 atlas:** one Smart UV Project (60°) over the visible textured faces of LOD0–3, LOD1/2/3 islands scaled 0.5 / 0.35 / 0.25 (a second Smart UV Project would re-pack and undo this), then one concave pack of the visible islands only, then a refit that keeps them inside the tile below the hidden-face strip (`fit_unit_tile`: `pack_islands(CLOSEST_UDIM)` can spill past 1.0) with 2 × padding gaps (8 px at 1024², 16 px at 2048²). LOD0 gets ≈ 70 % of the used area. Every LOD is baked from its own geometry, so occlusion and wear are exact per LOD and the LOD switch shows no texture swim.
4. **Bake** (Cycles, OptiX on the test system): normal (tangent, OpenGL +Y, 24 spp), albedo and ORM via emission (24 spp), bake margin 2 × padding; every texel the bake never wrote is then filled by a push-pull pass from its nearest baked neighbours (normals re-normalised), so mips never pull in black and sliver triangles the rasteriser missed still read their own colour.
5. **Calibration:** albedo is baked twice more at low samples (512², then the set size; unwritten texels ignored) and each master's gain is set so its slot mean matches the master value (rule 13 ±4 %); a hue-preserving clamp in the bake shader and again on the image keeps every texel inside linear 0.03–0.85. The final slot means are logged (`final <master>: mean peak … (±x %)`). Metallic is snapped to exactly 0 / 1.
6. **Write** `assets/src/<family>/tex/<type>__body__{basecolor (sRGB 8-bit), normal (16-bit), orm (8-bit)}.png`, image datablocks (relative paths, fake user, colour space by map, `kn_normal_y = '+Y'`), `kn_set = 'body'` on every textured piece, root `kn_tex_set / kn_tex_size / kn_tex_version`. Export copies albedo and ORM and writes the normal at 8-bit.

### The looks (D78, ART_BIBLE §4)

All looks work in part space (object coordinates), so patterns line up across LODs and across pieces. Cavity darkening is at most 15 % (limit 20 %). Worn edges come from Pointiness × a Bevel-vs-shading-normal edge mask × breakup noise, so wear stays in bands of ≤ 3 mm on arrises and never on flat faces.

| Look | Masters | Surface story |
|---|---|---|
| enamel | `kn_powder_*` (+ `_gloss` with less wear) | ±3.5 % broad + ±2 % fine mottle, cavity darkening, hand polish on convex areas (albedo +5 %, roughness −0.04), enamel worn through to steel on arrises (metallic 1, roughness 0.30), worn-edge rounding and a faint flow ripple in the normal |
| pebble | BOING's `kn_powder_ignition` (rollers.md: own ORM, roughness 0.62, pebble normal) | 0.8 mm pebbles in the normal, slightly darker valleys, no metal wear (rubber read) |
| anod (**changed after the D79 review**) | `kn_anod_*` (COG gears, SHEAVE cheeks, MAINS / STOMP PAD trims) | Treated as **enamel paint over metal**, like the Tinker Lab key art: the enamel look on the master colour, metallic **0** on the paint and **1** only where worn through at the arrises (bare aluminium `0.78, 0.79, 0.81`), roughness 0.42–0.48. The old bare-metal look is kept in code as `anod_metal`. Re-baked: cog_s, cog_m, cog_l, sheave, mains, stomp_pad |
| steel / iron | `kn_steel_brushed`, `kn_iron_cast` (ready for E3a; no M1 user) | Streaked roughness along the piece, polished high points; cast iron: satin high points (−0.1 roughness) and fine pitting in the normal. No scratches across faces |
| patina | `kn_brass`, `kn_copper` | Warm brown patina in recesses (about −15 % value, roughness +0.15, never green), polished high points |
| wood | `kn_wood_oak / _walnut` | Flat-sawn rings around an off-piece pith along the grain axis (longest axis; PLANK forced to Y), pores, broad colour drift, end grain darker and rougher on cut ends, polished arrises, grain and pores in the normal |
| paper | `kn_paper_*`, `kn_cardboard` | Fibre in albedo and normal, softened lighter corners; BANGSTICK sticks get a printed double rule near each end in a darker same-hue ink |
| rubber | `kn_rubber`, `_grip` | Mould marks: a parting-line ridge across the piece's thin axis (slightly glossy) and ejector-pin rings on the underside; master lifted hue-preserving to the 0.03 albedo floor (see below) |
| brick | `kn_brick` | Sand grain and dark speckle, the tooled 5 mm perimeter round reads as the mortar band (`#CFC6B8`, roughness 0.95, −normal step) |
| cord | `kn_rope`, `kn_fuse_cord` | Twist bands, fibre fuzz |
| wax / latex / ceramic / fabric | `kn_wax`, `kn_latex_*`, … | Soft mottle; wax drip ripple, latex near-smooth |

## Texture sizes, budgets and texel density

| Part | Class | Set | Slots covered | LOD0 px/m | Atlas used | Hidden faces | PNG MB (3 maps) | BC7 MB est. (3 maps + mips) | glb KB | Tex step s |
|---|---|---|---|---|---|---|---|---|---|---|
| thud | S | 1024² | kn_powder_graphite, kn_powder_ignition, kn_steel_brushed | 1452 | 46 % | 1 / 2300 | 0.85 | 4.0 | 191 | 22.4 |
| boing | S | 1024² | kn_powder_ignition, kn_rubber | 798 | 18 % | 688 / 2215 | 1.22 | 4.0 | 273 | 14.5 |
| helio | M | 2048² | kn_latex_plasma | 2936 | 59 % | 147 / 5501 | 1.30 | 16.0 | 379 | 80.9 |
| brik | S (inst.) | 1024² | kn_brick | 2396 | 76 % | 8 / 250 | 1.75 | 4.0 | 26 | 81.3 |
| plank | S | 1024² | kn_wood_oak, kn_powder_cobalt | 1007 | 57 % | 24 / 470 | 1.06 | 4.0 | 60 | 11.8 |
| slope | S | 1024² | kn_powder_bone, kn_powder_cobalt, kn_rubber, kn_steel_brushed | 1058 | 51 % | 222 / 1164 | 0.98 | 4.0 | 134 | 13.7 |
| ledge | S | 1024² | kn_powder_cobalt, kn_powder_bone, kn_rubber, kn_steel_brushed | 1190 | 76 % | 80 / 624 | 0.98 | 4.0 | 89 | 17.0 |
| fulcrum | M | 2048² | kn_powder_ignition, kn_brass, kn_rubber, kn_wood_oak, kn_powder_graphite, kn_steel_brushed | 1876 | 29 % | 829 / 3709 | 2.92 | 16.0 | 419 | 44.2 |
| anchor | S | 1024² | kn_powder_graphite, kn_powder_cobalt, kn_steel_brushed, kn_brass | 6474 | 44 % | 154 / 745 | 0.90 | 4.0 | 109 | 28.6 |
| sheave | S | 1024² | kn_powder_bone, kn_steel_brushed, kn_anod_cobalt | 2354 | 41 % | 210 / 1776 | 1.06 | 4.0 | 207 | 51.3 |
| treadway | M | 2048² | kn_powder_graphite, kn_powder_ignition, kn_rubber_grip, kn_rubber, kn_steel_brushed | 1079 | 24 % | 1143 / 3270 | 2.57 | 16.0 | 542 | 62.1 |
| cog_s | S | 1024² | kn_anod_cobalt, kn_steel_brushed | 2693 | 37 % | 116 / 1812 | 1.27 | 4.0 | 218 | 29.9 |
| cog_m | S | 1024² | kn_anod_cobalt, kn_steel_brushed | 1554 | 33 % | 158 / 2791 | 1.31 | 4.0 | 321 | 26.0 |
| cog_l | S | 1024² | kn_anod_cobalt, kn_steel_brushed | 1129 | 33 % | 157 / 3525 | 1.35 | 4.0 | 398 | 22.8 |
| motor | M | 2048² | kn_powder_graphite, kn_powder_ignition, kn_rubber, kn_steel_brushed, kn_copper, kn_brass | 1359 | 20 % | 1786 / 6413 | 1.90 | 16.0 | 835 | 43.6 |
| gale | M | 2048² | kn_powder_bone, kn_rubber, kn_steel_brushed, kn_powder_beam | 2792 | 18 % | 301 / 4464 | 3.22 | 16.0 | 548 | 47.0 |
| mains | M | 2048² | kn_powder_graphite, kn_powder_bone, kn_anod_volt, kn_steel_brushed, kn_rubber | 2535 | 33 % | 987 / 2757 | 2.06 | 16.0 | 439 | 56.1 |
| stomp_pad | S | 1024² | kn_powder_graphite, kn_anod_volt, kn_rubber, kn_steel_brushed, kn_rubber_grip | 1711 | 45 % | 304 / 1459 | 0.78 | 4.0 | 212 | 61.3 |
| the_button | S | 1024² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_powder_ignition_gloss | 2510 | 36 % | 335 / 1504 | 0.93 | 4.0 | 224 | 31.1 |
| wick | M | 2048² | kn_powder_graphite, kn_rubber, kn_wax, kn_rope | 5026 | 44 % | 639 / 3610 | 2.27 | 16.0 | 377 | 47.6 |
| bangstick | M | 2048² | kn_paper_tan, kn_paper_red, kn_powder_graphite, kn_powder_bone, kn_fuse_cord | 2563 | 34 % | 158 / 5201 | 4.04 | 16.0 | 488 | 33.2 |
| snipper | M | 2048² | kn_powder_bone, kn_rubber, kn_powder_ignition, kn_steel_brushed | 2750 | 36 % | 665 / 3473 | 2.70 | 16.0 | 522 | 64.9 |
| topple_tile | S (inst.) | 1024² | kn_powder_bone | 4049 | 77 % | 8 / 250 | 0.77 | 4.0 | 40 | 21.6 |

Totals: 14 sets at 1024², 9 at 2048²; PNG on disk 38.2 MB; BC7 estimate 200 MB.

- **Class budgets (ASSET_PIPELINE §4 / §5.2):** every part has exactly **1 set** (S allows 2 textured, M 3); S and instancing-heavy parts are at 1024², M at 2048², as §5.2 requires. Instancing-heavy BRIK and TOPPLE TILE keep exactly 1 slot and 1 set.
- **Texel density:** standard 1,024 px/m on LOD0. All parts meet it except **BOING at 798 px/m** (its octant patches fragment into many islands and 688 interior faces; a 72° Smart UV angle only reached 816). LOD1 / LOD2 / LOD3 run at 0.5 / 0.35 / 0.25 of LOD0 (checked on SLOPE: 1,058 / 529 / 370 / 265 px/m).
- **Atlas used** is the UV area of visible textured faces over the whole square; the rest is island gaps (2 × padding), concave-island holes and the 5 % hidden-face islands.
- **Download / memory:** PNG on disk is measured; BC7 is the estimate (1 byte per texel × 3 maps × 4/3 for mips), i.e. 4 MB per 1024² set and 16 MB per 2048² set resident. KTX2 UASTC + zstd on the wire should land near §5.3's 2 / 7 MB per set.
- **Bake time** (OptiX, the test system's NVIDIA Blackwell 16 GB, measured from the driver log of the final run): 12–81 s per part, about 16 minutes for all 23 including make, validate and export.
- **glb size** grows because UV seams split vertices and TANGENT (VEC4) is added on every textured mesh; the glb column is the textured size (not measured against the untextured M1 glbs, which the rebuild replaced).

## Validator rule 13 and the self-test

Rule 13 (`kn_tools/textures.py check`, called from `validate.py` for every non-critter part):

- one set per part named `body` (`kn_tex_set`); `basecolor`, `normal`, `orm` image datablocks present;
- files `tex/<type>__body__<map>.png` next to the .blend and on disk; no unlisted `<type>__*` files in `tex/`;
- colour spaces: basecolor sRGB, normal and ORM Non-Color;
- all maps the same size, square, at the class size (S 1024², M / L 2048², instancing-heavy 1024²), and equal to `kn_tex_size`;
- every textured piece has UVs, all within 0..1, and `kn_set = 'body'`;
- basecolor linear peak channel: p1 ≥ 0.03, p99 ≤ 0.85;
- per slot: mean over the texels the slot's visible LOD0 faces own (texel centre inside one of the slot's triangles, `slot_texels`), the same measure calibration uses, so thin islands are never dragged by a neighbour's edge texels; mean value within ±4 % of the master, mean hue within 8° (masters with saturation ≥ 0.15);
- ORM metallic 0 or 1, transition texels within 4 px of both a 0 and a 1 texel;
- normal map flagged OpenGL +Y (`kn_normal_y`), mean ≈ (0.5, 0.5, ≥ 0.85).

A part with non-exempt masters and no set gets a **warning** ("awaiting the texture pass"), so the 29 M2 parts and untextured M3 parts still pass. Critters are skipped (their sets come with the critter pass).

`node tools/assets.mjs --selftest` (`selftest.py`) now also breaks THUD's set 8 ways, each must fail rule 13: missing normal map, maps of different sizes, basecolor not sRGB, grey metallic, albedo above 0.85, hue shift (R↔B), a textured piece without `kn_set`, a normal map flagged −Y; plus "a part without a set only warns". Result: **27 checks, 0 failures** (18 before), plus the CLI broken-copy exit check and the critter self-test (11 cases, 0 failures).

## Tests

- `pnpm vitest run packages/assets`: **1,127 passed, 13 files** (this includes other streams' new files). The new `packages/assets/test/textures.test.ts` has **70 tests** (1 parser test + 3 per part × 23). It decodes the PNGs with `node:zlib`, independent of Blender, and checks: names, square class size, 8-bit RGB; `texSet` on exactly the covered masters; TEXCOORD_0 in 0..1 on every textured primitive of all four LODs; albedo p1/p99 inside 0.03–0.85; metallic binary; a tangent-space normal with no back-facing texels.
- `node tools/assets.mjs <all 23 M1> --tex --selftest`: every part validates with 0 errors (rule 13 included). The M2 parts STITCH, FISHBOWL and DYNAMO still pass, with the rule 13 warning; PIP (critter) passes, with rule 13 skipped.
- `tsc -p tsconfig.json`: clean.

## Deviations and decisions for the orchestrator

- **Build file names.** The orchestrator brief names `<type>.tex.{albedo,normal,orm}.png` (M3_PLAN contract 1); ASSET_PIPELINE §5.2 / §8 name build output `<type>__<set>.<map>.ktx2` with `basecolor`. I followed the brief for build output and §5.2 for sources (`<type>__body__basecolor.png`). ASSET_PIPELINE §5.2 / §8 should be updated to the brief's names (or the other way round) — not edited here.
- **Normal maps are 8-bit in the build.** Sources are 16-bit per §5.2; the engine-facing PNG is 8-bit (KTX2 UASTC would quantise anyway).
- **Rubber albedo floor.** `kn_rubber` `#1C1E22` has a linear peak of 0.016, below the ART_BIBLE 0.03 floor. The set lifts it hue-preserving to a 0.045 peak (sRGB ≈ `#32363C`, a dark slate); rule 13 measures rubber slots against that lifted value. The master in `materials.blend` is unchanged. If the art director prefers the darker rubber, the floor or the master must change.
- **`kn_anod_*` reads as enamel** (coordinator decision from the D79 side-by-side review): the set's ORM metallic is 0 on anodised slots except at worn edges, although the master (and its glb `metallicFactor`) stays 1. **L3: for `texSet` materials take metallic and roughness from ORM, never from the factors.** The ART_BIBLE / shared_kit §7.2 "Anodised" rows still describe bare metal and should be updated by the doc owner.
- **One set covers all LODs** (LOD1–3 islands in the same atlas, at lower density) rather than LOD2 baking from LOD0; a LOD switch shows no swim.
- **Interiors.** `kn_interior_*` is treated as exempt: those masters only ride FRAC chunks (`.frac.glb`), which are not textured yet.
- **Observed M1 geometry quirk (not fixed, not mine):** BRIK's top / bottom 16-gons have their corner rounds out of order (a sub-millimetre zig-zag), so any triangulation of them folds 8 triangles inward. They are back-facing from outside and harmless; the tex step flags them hidden. Worth fixing in `kit.prism` / `make_brik.py` when someone touches it.
- **Shared files touched (Edit tool, additive):** `kn_tools/validate.py` (rule 13 hook, docstring), `kn_tools/export.py` (tangents, build set, report), `kn_tools/conventions.py` (`ROOT_PIPELINE`), `tools/assets.mjs` (`--tex`, `--sheet-tex`, KTX2 deferral text), `tools/blender/selftest.py` (rule 13 cases), `packages/assets/src/{art,glb}.ts` (optional `textures`, `texSet`), `docs/art/PIPELINE_STATUS.md` (new section). No `make_<M1 type>.py` needed changes: per-part look choices live in `textures.OVERRIDES`.

## For stream E3a (new M3 parts)

New parts get their set with `node tools/assets.mjs <type> --tex` after their make script exists; nothing else is needed. Per-part look choices go in `textures.OVERRIDES[(type, master)]` (`look`, `rough`, `wear`, `axis`, `print`). `kn_iron_cast` already has a look; it needs its master added to `masters.py` / `conventions._MASTER_PATTERNS` by whoever introduces it.

## Follow-up for E3a (tool fixes, 2026-10-24)

E3a's FABRICATOR, POWDER KEG, SKYSHOW and RECYCLER failed check 13 because of `textures.py`. Fixed and re-baked; all four validate:

| Part | Was | Fix | Now |
|---|---|---|---|
| FABRICATOR | UVs reached 1.4: its 4,269 hidden faces were each a one-face island, and `pack_islands` collapsed everything and spilled past the tile | Hidden faces left out of the pack and laid out in a strip of 4-texel cells along the top; `fit_unit_tile` refits the visible islands into the tile below it (NaN-safe; UVs written as float32, since `foreach_set` reads a float64 buffer raw) | UVs inside 0..1, 1,124 px/m, 52 px strip |
| POWDER KEG, SKYSHOW | thin `kn_fuse_cord` slot at −8.1 % / −4.3 % | Check 13 and calibration now share one measure: the mean over texels whose centres fall inside the slot's own visible LOD0 triangles (`slot_texels`) | −0.1 % / +0.0 % |
| RECYCLER | thin `kn_anod_graphite` iris blades at +5.2 % | same | +3.0 % |

- `textures.INSTANCING` now names the real art ids: `brik`, `topple_tile`, `stacker`, `pin`, `marble` (plus the `glint` / `bearing` def ids, harmless).
- All 57 parts that carry a set (the 23 M1 meshes and E3a's 34 M3 parts) re-validate with 0 errors under the new measure. THUD, BOING, BRIK, LEDGE and WICK were re-baked with the new unwrap as a regression check; the self-test still runs 27 checks with 0 failures; `pnpm vitest run packages/assets`: 1,127 passed. The other 18 M1 sets are from the previous unwrap (hidden faces at 5 % density) and stay valid; the next rebuild moves them to the strip layout.
- `KN_TEX_DEBUG=1` logs each object's UV extent before the pack.
