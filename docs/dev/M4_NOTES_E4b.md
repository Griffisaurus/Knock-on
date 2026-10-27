# M4 notes: stream E4b (critter art: BISCUIT, HENNY, DUSTY)

2026-10-24. Scope: final art for the three M4 critters at the M2 critter standard (critters.md, ASSET_PIPELINE §6, validator rule 11), with D78 texture sets. **Status: done** (see Open issues).

![M4 critters contact sheet](../../art/style-samples/m4_critters.png)

## What was built

| Critter | LOD0 / 1 / 2 / 3 tris | Deform bones | Clips (17 required + role) | Face | RAG__ | Texture set |
|---|---|---|---|---|---|---|
| BISCUIT | 46,800 / 23,400 / 11,700 / 3,744 | 45 | 23: + bark, bark_run, wake_startle, barge, tail_wag, shake_off | 17 ART_BIBLE §8 keys + sk_tongue_out, sk_jowl_puff, sk_nose_wrinkle | 15 · 12.0 kg | 4096², 7 slots |
| HENNY | 39,000 / 19,500 / 9,750 / 3,118 | 42 | 23: + flap, lay_egg, glide_down, peck, scratch, proud_puff | 17 keys (brows are feather tufts) + sk_beak_wide, sk_feather_fluff, sk_comb_flop | 10 · 1.6 kg | 4096², 8 slots |
| DUSTY | 15,866 / 7,940 / 3,978 / 1,320 | 8 (root, body + 6 pivot mirrors) | 20: + suck, bin_full, bump_turn | LED face: 12 icons, a track per clip | 1 cylinder · 3.2 kg | 2048², 4 textured slots |

Sizes measured on the built LOD0 (W × D × H, metres): BISCUIT 0.236 × 0.669 × 0.404 (nose to tail tip; nose to rump ≈ 0.61), HENNY 0.217 × 0.369 × 0.322, DUSTY 0.366 × 0.366 × 0.071.

**Files** (all mine unless noted):
- Builders: `tools/blender/make_biscuit.py`, `make_henny.py`, `make_dusty.py` (over the shared M2 `_critter.py` / `_critter_anim.py`, unchanged). DUSTY subclasses `_critter.Critter` as a rigid hard-surface `Robot`.
- Sources: `assets/src/critters/{biscuit,henny,dusty}.blend`, `assets/src/critters/tex/<type>__body__{basecolor,normal,orm}.png`.
- Builds: `assets/build/parts/<type>/<type>.{glb,art.json,shapes.json,report.json}` + `<type>.tex.{albedo,normal,orm}.png`.
- Look-dev / contact sheet: `tools/blender/render_critters_m4.py` (new; imports the exported glbs, binds the set like the engine, lights DUSTY's eye screens from `faceTracks`) → `art/style-samples/m4_critters.png` (4 poses each) and `m4_{biscuit,henny,dusty}_turn.png` (front, 3/4, side, back). Re-render: `blender -b --factory-startup -P tools/blender/render_critters_m4.py -- art/style-samples/m4_critters.png --res 2400x1900 --samples 48` (`--turn`, `--clips clip@sec,...`, `--flat` for variants).
- Test: `packages/assets/test/critters_m4.test.ts` (new).
- Shared, additive (Edit tool): `kn_tools/masters.py` (9 `kn_fur_biscuit*` / `kn_fur_henny*` masters; `materials.blend` rebuilt from the table, only that file), `kn_tools/textures.py` ('fur', 'feather', 'plastic' looks; smooth texture-mask regions; `kn_tex_looks` on the part root; DUSTY 2048²; for parts with `kn_tex_looks` only: two extra set-size calibration passes, and a slot whose mean is pinned at the 0.85 albedo cap restarts from gain 1. Tiny slots such as catchlights bled at 512, got the 1.25 gain and stayed clipped at +5 %), `kn_tools/rig.py` (robot critters; cylinder RAG; `faceTracks`; tangents with a set), `kn_tools/export.py` (critters export their set), `kn_tools/validate.py` (rule 13 for critters that declare a set), `apps/game/src/artlist.ts` (`ART_CRITTERS`).

**How to rebuild:** `node tools/assets.mjs biscuit henny dusty` (make → validate → export). The make scripts bake their own D78 set (`textures.texture_part()`), because `assets.mjs` runs `texture_part.py` for non-critters only. `--no-tex` on a make script skips the bake for quick iteration. Measured on the test system with other streams on the GPU (nvidia-smi: 99 % busy, 26 GB used): make + bake ≈ 3 min for BISCUIT / HENNY, 1 min for DUSTY.

## For B4 (critter sim)

- **Clip names** match `CRITTER_CLIPS` exactly; every clip in `CRITTER_SPECS[sp].clips` is in the glb (the test checks).
- **Ragdolls:** the art copies B4's `BISCUIT_RAG`, `HENNY_RAG` and `DUSTY_RAG` rows as data (as M2 did). `critters_m4.test.ts` fails on drift: positions ±1 mm; mass, swing, twist, parent and `shape` exactly. DUSTY's `RAG__body` is exported with `shape: 'cylinder'` (radius 0.183, halfHeight 0.0275), matching B4's `shape` field.
- **Locomotion:** BISCUIT and HENNY `COL__capsule__0` match `capsule`; DUSTY's `COL__cylinder__0` (Ø 0.366 × 0.055, centre 0.0355 above the floor) matches `disc`.
- **Ragdoll leg rows:** E4b suggested moving them onto the built rigs; B4 did (BISCUIT front and hind legs, HENNY thighs and shins), and the art re-copied the new rows (follow-up below).
- **Events:** BISCUIT `bark` peaks on frame 6 (0.2 s), aligned with `EMIT__bark__mouth`; HENNY's `lay_egg` squat peaks for the YOLK on frame 18 (0.6 s = `CRITTER_M4.henny.layAt`), from `EMIT__egg__vent`. Additive layers: `bark_run`, `barge`, `tail_wag` (BISCUIT) only key the bones they move.

## For R4 / the critter renderer (gfx/critters.ts)

- `ART_CRITTERS` in `artlist.ts` lists all seven critters with art. `gfx/critters.ts` still has its own `CRITTER_TYPES = ['mochi', 'pip', 'goby', 'bandit']`, so the M4 three won't load until it reads `ART_CRITTERS` (not my file).
- **Texture sets on skinned meshes:** the three M4 glbs carry `extras.texSet` on their textured materials, TEXCOORD_0 and MikkTSpace TANGENTs, plus `.art.json textures` exactly like parts. The skinned path doesn't sample sets yet. BISCUIT / HENNY are 4096² (ASSET_PIPELINE §4 XL); `TexSets.add` resizes into the 2048² class, so no new array class is needed.
- **New face keys** for `expression()`: BISCUIT `sk_tongue_out` (pant: chase, celebrate, emote_happy), `sk_jowl_puff` (the "boof" of `bark`), `sk_nose_wrinkle` (`sniff`); HENNY `sk_beak_wide` (startled, `lay_egg` cackle), `sk_feather_fluff` (startled, sleep), `sk_comb_flop` (dizzy, sleep). HENNY's visemes open the lower beak.
- **DUSTY** has no morph targets. `.art.json` gives `robot: true`, `faceIcons` (the brief's 12: neutral, blink, happy, smug, scared, angry, dizzy, sleepy, surprised, determined, scan, strain), and `faceTracks[clip] = [[frame, icon], …]` to draw on `SCREEN__eye_l` / `SCREEN__eye_r` (icon screens; `SCREEN__bin` is the 5-cell fill bar on the lid). `pivotBones` maps each `PIVOT__` to the bone it turns (wheel_l/r, brush, bumper, lid, caster): the clips already spin the wheels and brush, compress the bumper and pop the lid, and the engine can drive those bones procedurally (`PIVOT__brush` carries `rps_roam` 6 / `rps_suck` 12; baked clips use 2–4 rps so the three-arm brush doesn't strobe at 30 fps). LED groups: 0 `status_ring`, 1 `charge`.
- One-shot vs loop is in `.art.json clipInfo[].loop`. The renderer's `ONE_SHOT` regex doesn't list the new one-shots (bark, wake_startle, shake_off, lay_egg, proud_puff, suck, bin_full, bump_turn, barge, bark_run).

## For F4 (audio)

Emitters: BISCUIT `EMIT__bark__mouth` (on `jaw`), `EMIT__step__paw_fl/fr/hl/hr`; HENNY `EMIT__voice__mouth`, `EMIT__step__foot_l/r`, `EMIT__egg__vent`, `EMIT__feathers__body`; DUSTY `EMIT__voice__speaker`, `EMIT__suck__intake`, `EMIT__dust__exhaust`. `.art.json emitterBones` names each emitter's bone.

## Deviations from the briefs

- **BISCUIT eyes** sit at (±0.044, −0.283, 0.321), not (±0.040, −0.27, 0.32): the soft-sculpt cheeks and muzzle swell the head past the brief's point and buried the eyes. `eye_centre()` puts each eyeball half a radius proud of the measured surface. `EMIT__look__eyes` stays at the brief's point. Hind paw / toe bones are `hindpaw_l/r`, `hindtoe_l/r` (as Mochi). Neutral lids are opened slightly (lid angles 36° / 30° instead of 50° / 38°) so he never reads sleepy.
- **HENNY** has 42 deform bones: `spine_03` is added to the brief's 41 because the rig standard and rule 11 require `spine_01–03`. Wing bones are `shoulder/upper/fore/hand/primaries_01/primaries_02_<side>`. Eyes are fitted to the head surface the same way (centre (±0.035, −0.126, 0.261)). Wings and the tail fan are separate closed feather clumps on the wing / tail bones, so they lift cleanly off the body when flapping; they are not cards.
- **DUSTY's face:** the brief puts the brow (z 0.0605) and eye covers (z 0.061) inside the 0.0565–0.065 lid, so they stand proud of the lid top instead (brow z 0.0665, bezel pads 0.066–0.0696, screens z 0.0697). Height stays 0.070. The rig adds pivot-mirror bones to the brief's 2 bones (the brief: "pivots parented under body") so clips can move them; a validator-recognised pattern (ASSET_PIPELINE §3.9). `COL__cylinder__0` and `RAG__body` use `phys = rubber`, restitution 0.45 (the bumper is the contact rim); the body's `powder` is the top's look only. `SENSOR__trigger__bumper` is the convex hull of the 180° front arc (sensors must be convex). The face-icon track lives in each action's `kn_face` and `.art.json faceTracks`, because glTF can't carry custom-property animation.
- **Texture-mask regions** (cream, brown, the HENNY breast) are separate `kn_fur_*` slots, as in M2, so each slot keeps its master's mean (rule 13). The D78 set paints their boundaries smoothly by position, from one region definition per critter (`REGIONS` in the make script) that drives both the per-face slot and the bake (`kn_tex_looks`). HENNY's caramel wing tips and tail are whole feather clumps on the caramel slot. Skins are listed in `kn_skins`, without their own basecolor.
- **One set per critter**, not the brief's "4096² + 1024²" (eyes): the eyes, catchlights and accessories share the body atlas (the texture module bakes one set per part).
- **Ragdoll** rows are B4's (see above).

## Validation and tests

- Validator: BISCUIT and HENNY PASS with 0 errors, 0 warnings; DUSTY PASS with 0 errors and 1 warning (LOD0 15,866 tris is under the XL 25k floor, which the brief and ASSET_PIPELINE §4 allow for robot critters). Rule 13 runs on all three.
- `critters_m4.test.ts`: per critter, the LOD ratios and class budget, rig, skinning, clip coverage against `CRITTER_CLIPS` and `CRITTER_SPECS[sp].clips`, brief timings, seamless loops, face keys (or DUSTY's face tracks, pivot bones and screens), ragdoll and locomotion shape against parts-data, the texture set (sizes from the PNG headers, `texSet` on every non-exempt material, TEXCOORD_0 + TANGENT), and the `ART_CRITTERS` entry.

## Follow-up (orchestrator, after the renderer wiring): soft fur, not cracked leather

In engine, BISCUIT's first set read as cracked leather: the 'fur' look's Voronoi distance-to-edge creases put hard cell borders into both albedo and normal, which the small contact sheet hid. Fixed and rebuilt:

- **'fur' look rewritten** (`kn_tools/textures.py`): every field is continuous now. It has three layers, all stretched along the fur flow: low-contrast clumping from smooth noise (albedo ±3.5 %), mid-size tufts (±2 %) and fine directional strands (0.9 mm across, 7 mm along, ±4 %). The normal is a soft height of the same three layers. It has no Voronoi edges and no creases. **'feather'** adds soft scallops from smooth-F1 domes, which are also continuous, and longer 11 mm barbs.
- **HENNY's caramel clumps were inside out.** `clump()` built a left-handed frame, so the wing primaries and tail feathers had inverted normals. In engine they read as see-through, faceted triangles, and 97 % of their faces were classed "interior" by the texture unwrap. The frame is now right-handed.
- **No interior-face strip on animated critters:** `texture_part` skips `mark_hidden` for critters that declare `kn_tex_looks`. Wings spread, jaws open and lids blink, so no face is truly interior, and strip cells would show as flat facets when a pose reveals them.
- **Ragdolls re-synced** with B4's moved leg rows (BISCUIT upperarm / forearm / thigh / shin, HENNY thigh / shin); the test checks them.
- Island padding (push-pull fill) stays in the gutters between islands.
- **DUSTY:** the brow strip's normal map was noise. Its rounded-rect n-gon caps triangulated into slivers whose MikkTSpace frames bake as noise on a thin strip; the brow is now a quad-grid box. The 'plastic' look also lost its Bevel-node normal (the face band's overlapping glass and lid shells made it noisy), and its moulding grain is coarser (700 / m). DUSTY now bakes at 128 samples.
- Rebuilt with `node tools/assets.mjs biscuit henny dusty`. All three validate with 0 errors; DUSTY keeps its one tri-floor warning.
- **DUSTY's eyes (orchestrator's call):** the glass covers are gone, because the skinned renderer draws `kn_screen` as lit Beam panels and has no screen-through-glass pass. Each eye screen (z 0.0697) sits uncovered on a glossy graphite bezel pad (`kn_powder_graphite_gloss`, roughness 0.18 in the set, 0.027 × 0.0125 × 0.0036 m, a quad-grid box), which gives the brief's glossy eye without a separate shell. In engine the eyes now light: `art/style-samples/m4_dusty_engine_face_crop.png`. This supersedes the brief's "under `kn_glass` covers".
- Engine check (hero harness on the orchestrator's Vite 5185, tier 32, 1920 × 1080): `art/style-samples/m4_critters_engine_crop.png` is a 1:1 crop of the default hero view. `m4_biscuit_engine_close.png`, `m4_henny_engine_close.png` and `m4_dusty_engine_close.png` are close views, with the camera swapped in through `renderer.setCamera` and depth of field off.

## Other streams' failures seen (reported, not touched)

`pnpm -s vitest run packages/assets` (2026-10-24 23:50): 1,455 passed, 17 failed, 3 skipped. All 17 failures are in E4c's `textures_m2.test.ts` (normal-map noise in island gaps, M2 parts, work in progress). `critters.test.ts` (M2, 33) and `critters_m4.test.ts` (34 passed, 3 skipped by design) pass. `pnpm -s typecheck` is clean.

## Open issues

- The orchestrator has wired the M4 critters into `gfx/critters.ts` (`ART_CRITTERS`, texture sets on the skinned path, clipInfo loop flags, the new face keys, DUSTY's lit screens). DUSTY's per-icon face tracks and HENNY's pooled YOLKs on the skinned path are still renderer work (B4 notes).
- Source normal maps are 16-bit (ASSET_PIPELINE §5.2): BISCUIT's is 53 MB and HENNY's similar at 4096²; the build normals are 8-bit. KTX2 (V4) will shrink the build.
- Atlas use is low (about 40 % of the tile across the four LODs) because Smart UV Project splits the soft-sculpt bodies into many islands; texel density still beats the 2,048 px/m critter-face target (BISCUIT LOD0 2,930 px/m).
