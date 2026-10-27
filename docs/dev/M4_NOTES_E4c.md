# M4 notes: stream E4c, the M2 parts' texture pass

Status: 2026-10-25 · Stream E4c · **done** · Plan: [M4_PLAN.md](M4_PLAN.md) · Decisions: [D78, D88, D95](DECISIONS_2026-10-24.md) · Contract docs: [ASSET_PIPELINE §5.2, §9](../art/ASSET_PIPELINE.md), [ART_BIBLE §3.1, §4](../art/ART_BIBLE.md) · Pipeline: [M3_NOTES_E3c.md](M3_NOTES_E3c.md)

All 29 Ship = M2 parts now carry a unique D78 texture set: albedo, normal and ORM, baked in Cycles (OptiX) from the production tactile looks and held to the ART_BIBLE §4 wear limits. Each part was rebuilt (`node tools/assets.mjs <type> --tex`: make → tex → validate → export), validates with **0 errors** (rule 13 included), and exports with its glass shells, shape keys, clips, screens, decals, sockets, cavities and FISHBOWL's fracture set intact. The file layout and colour spaces are E3c's (`<type>.tex.{albedo,normal,orm}.png` next to the glb, `.art.json → textures`, `extras.texSet`, TANGENT), so the renderer's existing texture-set path (L3) loads them unchanged.

![M2 texture pass, before | after (Cycles, engine binding)](../../art/style-samples/m4_textured_m2.png)

- Close-ups (FUZZ felt, PIG IRON cast iron, HAMSTER DRIVE, BURNING GLASS walnut, RINGER brass and amber enamel, SKYROCKET printed paper): `art/style-samples/m4_textured_m2_detail.png`.
- In engine, sets off | on (Chrome, WebGPU, tier 32, Studio): `art/style-samples/m4_textured_m2_ingame.png`.

## Parts, sets and budgets

Measured from the final build logs (`--tex` run with the final `textures.py`) and the build files. "Worst slot" is the slot whose mean albedo value sits furthest from its master (rule 13 allows ±4 %). glb sizes are before (the M2 build, backed up before the pass) and after. Tex step times were taken while E4a and E4b also baked on the same GPU (rule 11): `nvidia-smi` showed 99 % utilisation and 22–30 GB in use during most of the run, so read them as upper bounds.

| Part | Class | Set | Slots covered | LOD0 px/m | Atlas used | Hidden faces | Worst slot | PNG MB (3 maps) | BC7 MB est. | glb KB before → after | Tex step s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| stitch | S | 1024² | kn_powder_bone, kn_fabric_ignition | 3784 | 40 % | 506 / 2280 | kn_fabric_ignition -0.9 % | 1.01 | 4.0 | 137 → 304 | 43.5 |
| fuzz | S | 1024² | kn_fabric_amber, kn_rubber | 4712 | 41 % | 38 / 1985 | kn_fabric_amber -0.2 % | 1.44 | 4.0 | 75 → 153 | 34.8 |
| pig_iron | S | 1024² | kn_anod_graphite, kn_steel_brushed | 3344 | 69 % | 0 / 1680 | kn_anod_graphite +0 % | 0.99 | 4.0 | 73 → 142 | 40.9 |
| gutter | S | 1024² | kn_powder_bone, kn_powder_cobalt, kn_steel_brushed, kn_rubber | **704** | 46 % | 500 / 2134 | kn_powder_cobalt -0.4 % | 0.95 | 4.0 | 142 → 305 | 67.7 |
| vortex | S | 1024² | kn_powder_bone, kn_powder_cobalt, kn_steel_brushed | **399** | 37 % | 277 / 2562 | kn_powder_cobalt -0.7 % | 0.91 | 4.0 | 135 → 293 | 25.0 |
| sprong | M | 2048² | kn_powder_cobalt, kn_powder_bone, kn_steel_brushed, kn_rubber, kn_fabric_graphite | 2950 | 63 % | 368 / 2962 | kn_powder_cobalt -0.3 % | 4.92 | 16.0 | 691 → 1130 | 53.0 |
| trap_box | M | 2048² | kn_rubber, kn_powder_cobalt, kn_powder_bone, kn_steel_brushed | **794** | 26 % | 1148 / 4024 | kn_powder_cobalt -0.9 % | 2.31 | 16.0 | 418 → 914 | 88.0 |
| scoop | S | 1024² | kn_powder_bone, kn_powder_cobalt, kn_rubber, kn_steel_brushed, kn_rubber_grip | 1210 | 53 % | 129 / 2182 | kn_powder_cobalt -0.8 % | 1.04 | 4.0 | 147 → 285 | 47.9 |
| flap | S | 1024² | kn_powder_cobalt, kn_steel_brushed, kn_rubber, kn_powder_bone | 1151 | 56 % | 276 / 1559 | kn_powder_cobalt -0.8 % | 1.01 | 4.0 | 143 → 271 | 36.7 |
| dynamo | L | 2048² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_copper, kn_powder_ignition | 1394 | 32 % | 5221 / 16959 | kn_powder_ignition -1.1 % | 3.01 | 16.0 | 1087 → 2558 | 68.9 |
| hamster_drive | L | 2048² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_powder_ignition, kn_brass | 1752 | 36 % | 3425 / 15933 | kn_powder_ignition -0.6 % | 2.75 | 16.0 | 890 → 2008 | 108.5 |
| turbine | M | 2048² | kn_powder_graphite, kn_steel_brushed, kn_rubber, kn_powder_ignition, kn_anod_cobalt | 3305 | 50 % | 1853 / 6935 | kn_anod_cobalt -0.9 % | 2.89 | 16.0 | 415 → 945 | 195.2 |
| pedal_rig | XL | 2048² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_rubber_grip, kn_brass, kn_anod_ignition, kn_powder_ignition | 2034 | 30 % | 3116 / 15303 | kn_powder_ignition -1.1 % | 3.28 | 16.0 | 944 → 1993 | 140.5 |
| puffer | M | 2048² | kn_powder_bone, kn_rubber_grip, kn_rubber, kn_brass, kn_steel_brushed, kn_powder_beam | 2064 | 50 % | 1778 / 5595 | kn_powder_beam -1.2 % | 3.35 | 16.0 | 535 → 1045 | 84.7 |
| cell | S | 1024² | kn_powder_graphite, kn_anod_volt, kn_steel_brushed, kn_rubber | 2401 | 66 % | 389 / 1883 | kn_anod_volt +0 % | 0.91 | 4.0 | 105 → 235 | 46.9 |
| suncell | S | 1024² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_anod_graphite, kn_anod_beam | 1326 | 43 % | 210 / 1139 | kn_anod_beam -0.1 % | 0.64 | 4.0 | 124 → 222 | 42.2 |
| lamp | S | 1024² | kn_powder_graphite, kn_rubber, kn_anod_volt, kn_steel_brushed | 3011 | 59 % | 225 / 1180 | kn_anod_volt +0 % | 0.91 | 4.0 | 149 → 254 | 35.1 |
| torch | S | 1024² | kn_powder_graphite, kn_rubber_grip, kn_steel_brushed, kn_anod_beam, kn_rubber | 2047 | 49 % | 361 / 2211 | kn_anod_beam +0 % | 0.96 | 4.0 | 171 → 353 | 51.2 |
| burning_glass | S | 1024² | kn_powder_graphite, kn_rubber, kn_steel_brushed, kn_wood_walnut, kn_anod_beam | 2930 | 52 % | 293 / 1736 | kn_anod_beam +0 % | 1.04 | 4.0 | 162 → 315 | 74.1 |
| toggle | S | 1024² | kn_powder_graphite, kn_powder_bone, kn_steel_brushed, kn_rubber, kn_anod_volt | 3044 | 58 % | 284 / 1458 | kn_anod_volt -0.1 % | 0.81 | 4.0 | 140 → 273 | 31.8 |
| ringer | M | 2048² | kn_powder_graphite, kn_steel_brushed, kn_powder_amber, kn_rubber, kn_brass | 6766 | 57 % | 763 / 3975 | kn_powder_amber -1 % | 2.87 | 16.0 | 314 → 678 | 66.7 |
| delay | S | 1024² | kn_powder_graphite, kn_steel_brushed, kn_rubber, kn_anod_volt, kn_brass | 3127 | 65 % | 524 / 2199 | kn_brass +0.1 % | 0.91 | 4.0 | 216 → 415 | 43.0 |
| t_plunger | M | 2048² | kn_powder_graphite, kn_rubber, kn_paper_red, kn_powder_bone, kn_steel_brushed, kn_rubber_grip, kn_brass, kn_copper | 2010 | 36 % | 2484 / 7326 | kn_brass +0 % | 3.14 | 16.0 | 466 → 1090 | 82.4 |
| skyrocket | M | 2048² | kn_paper_red, kn_powder_amber, kn_rubber_grip, kn_powder_graphite, kn_rubber, kn_fuse_cord | 4792 | 56 % | 945 / 4137 | kn_powder_amber -0.3 % | 4.28 | 16.0 | 246 → 524 | 31.4 |
| big_top | L | 2048² | kn_powder_graphite, kn_steel_brushed, kn_rubber, kn_powder_ignition, kn_fuse_cord, kn_anod_ignition | **811** | 30 % | 7060 / 24183 | kn_powder_ignition -1.3 % | 2.93 | 16.0 | 1234 → 3092 | 274.4 |
| cork_blaster | M | 2048² | kn_powder_bone, kn_rubber, kn_steel_brushed, kn_powder_ignition, kn_powder_ignition_gloss, kn_cardboard, kn_rope | 3382 | 47 % | 1081 / 4633 | kn_powder_ignition -1 % | 3.22 | 16.0 | 418 → 814 | 119.0 |
| punchline | M | 2048² | kn_powder_bone, kn_steel_brushed, kn_rubber, kn_powder_ignition | 2223 | 59 % | 1846 / 6093 | kn_powder_ignition -0.7 % | 3.27 | 16.0 | 541 → 1072 | 80.6 |
| gotcha_box | L | 2048² | kn_powder_bone, kn_powder_ignition, kn_steel_brushed, kn_rubber, kn_brass | 2016 | 39 % | 7327 / 12736 | kn_powder_ignition -0.8 % | 2.82 | 16.0 | 883 → 2273 | 182.3 |
| fishbowl | L | 2048² | kn_powder_bone, kn_rubber, kn_powder_ignition | 3252 | 47 % | 1284 / 7949 | kn_powder_ignition -1.1 % | 3.47 | 16.0 | 608 → 1142 | 90.5 |

**Totals:** 14 sets at 1024², 15 at 2048²; 62.0 MB of build PNG; BC7 estimate 296 MB resident (E3c's estimate: 1 byte per texel × 3 maps × 4/3 for mips). The 29 parts took 40.2 minutes for make, tex, validate and export (sum of the drivers' "built in" times; tex steps alone 2,287 s), with the GPU shared.

- **One set per part,** at the §5.2 class size: S at 1024², M and L at 2048². PEDAL RIG is brief class XL (the critter row, 4096²), but it is a 14.5k-tri part, and the renderer's set arrays are 1024² / 2048² only (L3), so it gets L's 2048² (`textures.SIZE_OVERRIDES`; check 13 uses the same size).
- **Texel density** (1,024 px/m standard): 25 parts meet it. Four miss: GUTTER 704, VORTEX 399, TRAP BOX 794 and BIG TOP 811. They are physically large for their class's set: VORTEX is a 0.8 m funnel (about 1.7 m² of textured LOD0 surface) on an S-class 1024² set, and TRAP BOX a 0.7 × 0.5 × 0.5 m cage. At 100 % packing, 1.7 m² on 1024² tops out near 790 px/m, so the class size, not the packing, sets the limit. Raising them to 2048² would break §5.2's class sizes, so this needs the art director's call (the same kind of exception as E3c's BOING).
- **Atlas used** is the UV area of visible textured faces over the whole tile, as in E3c's table. The M2 parts carry hundreds of small islands (TRAP BOX has 850 at LOD0: cage bars, rivets, coils), so the island gap matters a lot. See "Island gap" below.

## The looks and per-part choices

The looks are E3c's (`textures.build_look`). Per-part choices are `textures.OVERRIDES` entries keyed by (M2 type, master), so the M1 and M3 sets re-bake unchanged.

| Part · master | Look | Why |
|---|---|---|
| FUZZ `kn_fabric_amber` | **felt** (new) | rollers.md: felt with a fuzz normal. Fibre fuzz (~0.5 mm) over felting clumps (~4 mm), lighter fibre tips, roughness 0.88–0.95, no wear, no metal |
| SPRONG `kn_fabric_graphite` | felt (fuzz 0.6) | the landing mat: tighter felt |
| STITCH `kn_fabric_ignition` | cord | rollers.md: chunky stitches read as waxed thread (twist bands, fibre fuzz) |
| every M2 `kn_rubber_grip` slot (SCOOP, PEDAL RIG, PUFFER, TORCH, T-PLUNGER, SKYROCKET) | **grip** (new) | ART_BIBLE §4: "`_grip` adds knurl normal". A 1.6 mm diamond knurl (two crossed diagonal ridges in part space), peaks a touch polished (roughness 0.74 against 0.82–0.86) |
| PIG IRON `kn_anod_graphite` | iron | rollers.md: "cast body … 0.3 mm cast pitting". Satin cast iron with fine pitting in the normal and metallic 1. It replaces D88's anod-as-enamel for this one slot because the brief names cast iron; the result is satin (ART_BIBLE cast iron: roughness 0.55) rather than the old glossy black |
| SKYROCKET `kn_paper_red` | paper + print | printed double rules near each tube end, like BANGSTICK |
| CORK BLASTER `kn_powder_ignition_gloss` | enamel, wear 0.6 | hero trigger cap: polish, little edge wear (as THE BUTTON) |
| SUNCELL `kn_anod_graphite` | anod, wear 0 | the photocell's thin graphite cell strips are almost all arris. Edge wear turned about 60 % of them to bare aluminium (slot +69 %, check 13 failed). A cell face is never handled, so it gets no wear |

Everything else uses the defaults: enamel on `kn_powder_*`, enamel over metal on `kn_anod_*` (D88), and steel, patina (brass, copper), walnut, paper / card, rubber, cord (rope, fuse) and so on.

## GUTTER (the swept link)

GUTTER ships as a kit + profile. In the engine, `gfx/gutter.ts` sweeps `gutter.profile.json` along the link and places the glb's kit pieces (stop, strap, spout, saddle). That code draws everything with the masters' constant colours (`MAT_KIND.master` vertex colours) and never samples a texture set.

- **What I did:** gave `gutter.glb` (the kit pieces on the 0.5 m demo run) a normal 1024² set. That covers the Library and Inspector renders, thumbnails and the art checks, and it makes rule 13 pass.
- **What still uses masters:** the swept channel in play.
  - A unique baked set can't follow a path of arbitrary length.
  - The channel would need a tiling trim on UV channel 2 (ASSET_PIPELINE §4: "Channel 2 (optional): tileable trims").
  - The kit pieces could sample the existing set if `gutter.ts` kept their UVs and `texSet`.
  - Both are renderer changes for the `gfx/gutter.ts` owner. Not done here (not my file).
- `gutter.profile.json` is regenerated by `make_gutter.py` and is unchanged in content (byte comparison with the pre-pass backup).

## Kept intact (checked against a backup of the M2 builds taken before the pass)

`scratchpad/cmpglb.mjs` compared each part's glb and `.art.json` with the backup. The glb checks are node names, morph targets per mesh with target names, animations and channel counts, material names and node extras. The `.art.json` checks are every key except `textures` and `generator`, plus `shapes.json`, `profile.json` and `frac.glb` byte for byte.

- **All 29 have the same structure.** That includes:
  - the 15 glass shells (exempt masters, no set);
  - **shape keys** on SPRONG, PUFFER, BIG TOP, CORK BLASTER, PUNCHLINE and GOTCHA BOX (LOD0 + LOD1 morph targets with unchanged vertex counts and delta magnitudes; checked numerically on SPRONG);
  - clips (PUFFER 1, GOTCHA BOX 2);
  - screens, decals (own atlas UVs), sockets and ports.
- **One expected difference:** SCOOP's and FISHBOWL's `.art.json cavities` gain `volume`, `min`, `max` and a fill `lut`. That comes from the current shared `export.py` (the M4 fill pass, not my change), which every rebuild now writes.
- **FISHBOWL fracture:** the shipped `fishbowl.frac.glb` is untouched by the pass. A scratch `export_frac.py` run from the rebuilt `.blend` produced a **byte-identical** `fishbowl.frac.glb` (21 chunks). The scratch `frac_fishbowl.ts` lists the same hull points, with a few hull vertices in a different order. The shipped `packages/parts-data/src/frac_fishbowl.ts` was not rewritten. The fracture chunks stay untextured (glass + `kn_interior_*`, exempt).
- **Determinism:** CELL rebuilt twice gives a byte-identical glb (UVs, tangents) and maps within ±1 of 255 on 0.02 % of ORM texels and none elsewhere (GPU float noise in Cycles).

## Pipeline changes (shared `kn_tools/textures.py`, additive, Edit tool)

The first one only affects the M2 parts. Changes 2–4 apply to every part on its next `--tex` rebuild: they fix measurement and noise problems that E4a, E4b and V4 also hit. M1 and M3 sets on disk are untouched until someone rebuilds them.

1. **Island gap (M2 only, `island_gap`).**
   - **Before:** E3c packs with a gap of 2 × padding (8 px at 1024², 16 px at 2048²).
   - **The problem:** with hundreds of small islands, the gaps ate the tile. TRAP BOX: 16 % atlas use and 626 px/m.
   - **Now:** the M2 parts use the §4 / §5.2 padding itself as the gap (4 px / 8 px) and the same bake margin. Push-pull keeps gap texels at the neighbouring island's colour.
   - **Measured on TRAP BOX's unwrap** (UV-only runs, no bake): 626 → 794 px/m and 16 → 26 % used, island count unchanged. A 4 px gap would reach 872 px/m, but that is below the §5.2 padding, so it wasn't taken.
2. **Calibration passes.**
   - Up to two more set-size albedo passes while any slot is more than 1 % off. They stop as soon as all slots are within 1 %, so a set that already calibrates bakes exactly as before.
   - **The fix it makes:** BIG TOP's thin fuse cord read 75 % high at 512 through neighbour bleed. The 0.8 gain floor then left it at −7.2 % (check 13 failed). It is now +0.2 %.
   - E4b also hooks this loop for critters (their branch is unchanged).
3. **Map rebuild from inside texels (`fill_slots` + post-process).** Every map is rebuilt from the texels whose centres lie inside a visible island triangle. That is the same `slot_texels` measure check 13 and calibration use.
   - Inside texels the bake left unwritten are filled from **their own slot's** texels, never a neighbour's. The log line `inside texels the bake left unwritten` counts them: **0 on all 29 M2 parts.** So this is not what caused E4a's mismatch on the M2 parts; it guards against that cause if their bakes leave texels unwritten.
   - Gap texels are push-pulled from inside texels only, never from bake-margin texels.
   - The hidden-face strip keeps its baked colour (cutaways) but gets a **flat normal**. Its per-cell normals were the "noise strips" V4 saw.
   - **Measured on the M2 sets:** 0 lone outlier texels (more than 30° off all 4 neighbours) in the gutters of all 29 normal maps, and a flat strip. Texels hugging an island edge are excluded from that count; PEDAL RIG and PUFFER have one such texel each.
4. **`hiddenRows` in `.art.json textures`** (`hidden_rows`, export): the height in texels of the interior-face strip along the top of the PNG.
   - It lets checks outside Blender skip those cells, as check 13 does.
   - Without it, a Node check reads small dark slots 5–12 % high: interior cells bleed between their 4-texel neighbours. Measured on FLAP's rubber: 0.0485 over all texels against 0.0449 excluding the strip, a master value of 0.045.
5. `SIZE_OVERRIDES` (PEDAL RIG 2048²), `M2_TYPES`, the `felt` and `grip` looks, and the M2 `OVERRIDES`.

**For E4a and E4b (the check-13 vs calibration report).** Both measures use `slot_texels` over the visible LOD0 faces. Check 13 reads the saved PNG, calibration reads the raw bake. The two could differ only where the post-process changed inside texels. Changes 2 and 3 close those paths: unwritten inside texels now take their own slot's colour, and thin slots get the extra calibration passes. Parts baked before these changes keep their old maps; re-run `node tools/assets.mjs <type> --tex` to pick them up.

- **BLOWOUT, as it is on disk now** (read-only probe, nothing saved): every slot is within ±2 % (rubber grip strip +1.8 %, graphite +0.9 %).
- **No mismatch reproduced:** I could not reproduce one on any M2 part. Every final log value and check 13 agree, and no inside texels were unwritten.
- **If one persists after a re-bake,** the new log line tells whether unwritten texels are involved.

`export.py` and `validate.py` needed no change. Not touched: `make_<M2 type>.py`. Every per-part choice fits in `textures.OVERRIDES`, so the make scripts need no texture hooks.

## Checked in the engine (Chrome, local Vite on :5211)

- **Setup:** a private dev server on **:5211** (rule 10). It runs the game's own `vite.config.ts` through a scratch wrapper config, with no proxy to the shared host, plus a scratch check page. That page loads every M2 part through `loadPartMesh` (L3's texture-set path), places them in the Studio, and can strip `.art.json textures` (`?notex`) for the before view.
- **Result:** at tier 32, **29 / 29 parts load, 29 / 29 with their set** (`partTexLook` returned a layer for each), with no console or page errors.
- **What changed visibly:**
  - enamel anod trims (TORCH and BURNING GLASS beam parts read as paint, not metal, per D88);
  - walnut grain on BURNING GLASS;
  - satin cast iron on PIG IRON;
  - print on SKYROCKET.

  The tiling detail layer (the blotchy close-range pattern on the plates) is the renderer's own and shows with and without sets.
- **Renderer observation (not mine, low priority):** instances drawn with a non-unit `size` scale show large dark facet-shaped patches on spheres, with and without texture sets. At real scale the same parts render cleanly. Game parts are drawn at scale 1, so it only affects tools that scale parts (a grid or icon rig).

## Tests

- **`packages/assets/test/textures_m2.test.ts` (new, 124 tests, 5 per part plus shared checks).** PNGs are decoded with `node:zlib` and triangles rasterised from the glb, independent of Blender. It checks:
  - all 29 parts carry a set;
  - names, 8-bit RGB, square, the class size (PEDAL RIG 2048²);
  - `texSet` exactly on the covered masters;
  - TEXCOORD_0 in 0..1 on all four LODs, and TANGENT on every textured glTF primitive;
  - albedo p1 / p99 inside linear 0.03–0.85;
  - **each slot's mean within ±4 % of its master,** measured independently of rule 13;
  - metallic binary;
  - a tangent-space normal map;
  - **no lone noisy texels in the island gaps,** and a flat interior strip;
  - shape keys present and moving on the six morph parts;
  - FISHBOWL's 21 untextured fracture chunks;
  - GUTTER's two sweep profiles.
- **`pnpm -s vitest run packages/assets`:** 16 files, **1,472 passed**, 3 skipped (other streams' files included).
- **`pnpm -s typecheck`:** clean.
- **Validator self-test** (`selftest.py`, run directly into a scratch folder, so no M1 part was rebuilt): PASS, 0 failures.

## Open issues / for the orchestrator

- **Texel density on four large parts** (GUTTER 704, VORTEX 399, TRAP BOX 794, BIG TOP 811 px/m) is limited by the §5.2 class set size. This needs an art-director call: accept them, or allow 2048² for physically large S / M / L parts.
- **GUTTER's swept channel and kit pieces don't sample the set in play** (`gfx/gutter.ts` draws master colours). The follow-up belongs to the gutter renderer owner: a tiling trim for the sweep, plus UVs and `texSet` on the kit pieces.
- **The M2 part icons** (`art/style-samples/icons/*.thumb.webp`, `render_thumbs.py`) were rendered before the pass. Re-rendering them with the sets belongs to the thumbnail owner.
- **KTX2:** the sets are final PNGs. The orchestrator's `node tools/assets.mjs --ktx2-only` (V4) can encode them now.
- **PIG IRON's look is satin, not gloss** (brief: cast iron with pitting; ART_BIBLE cast iron: roughness 0.55). Flip the override if the art director wants the old glossy black.
- No other stream's process or file was stopped, deleted or edited. Blender jobs from E4a and E4b ran alongside mine.
