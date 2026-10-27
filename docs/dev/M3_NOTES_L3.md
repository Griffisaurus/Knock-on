# M3 notes: stream L3, look graphics

2026-10-24. Scope: PRODUCTION §2 M3 renderer look pass, [M3_PLAN.md](M3_PLAN.md) contracts 1–3, [D79](DECISIONS_2026-10-24.md) (the warm look), D81 (the budget), D82 (follow the key art), D85 (tier 32). Everything below was checked in Chrome (NVIDIA RTX 5090, 32 GB) on a local Vite server (port 5191) and, for the game, a local test server on port 8797 with its own data folder. The shared host, the shared world and `dist/` were never touched.

**The D79 proof:** `art/style-samples/tinker_lab_engine.png` (in engine, tier 32, 1920 × 1080, the key art's camera) and `art/style-samples/tinker_lab_compare.png` (side by side with `tinker_lab_key.png`).

![Key art | engine](../../art/style-samples/tinker_lab_compare.png)

## What landed

All new code is in `apps/game/src/gfx/look/`. The shared files took small, additive Edit-tool changes, each marked `L3 (M3)`.

| Item | Where | Notes |
|---|---|---|
| **LookPass** | `look/index.ts` | Owns everything the look adds and is the renderer's only entry point (`renderer.lookPass`). Bind group 2 of the part, glass, sky and floor shaders; per-frame uniforms; the set bake; AO, fog and DOF inputs; the governor; `force` switches for measuring. |
| **Texture sets** (contract 1) | `look/textures.ts`, `look/materials.ts`, `glbmesh.ts` (`partTexLook`, `glbLods(…, look)`), `look/wgsl.ts` `lookSurface` | `.art.json → textures` is read raw (albedo, normal, ORM, size), and the maps are loaded into **two size classes**, 1024², plus 2048² from 12 GB. Each class has an albedo array (sRGB) and one shared normal + ORM array (layers 2i and 2i + 1). A layer code's bit 15 selects the class. 4 and 8 GB put every set in the 1024² class. Arrays grow by doubling with a GPU copy, and mips are generated per layer. A primitive samples its set when its glb material carries `extras.texSet` (E3c, `GlbMaterial.texSet`) and it has UVs. Masters without a set keep the master path.<br>**Vertex encoding:** the D69 kind byte keeps 0, 64 and 128. Kinds 224–255 are a master with a detail id (255 = none, so old meshes are unchanged). Kinds 192–223 are a textured master, with the layer code in the red and green bytes; the set supplies roughness and metal.<br>**Shading:** ORM G and B give roughness and metal; ORM R is cavity occlusion on the indirect term only. The normal map (OpenGL +Y) uses the exported MikkTSpace tangents, or a derivative frame where a primitive has none. 17 sets load in the hero scene (10 at 1024², 7 at 2048²). |
| **Detail layer** | `look/textures.ts` (procedural, generated at init), `look/wgsl.ts` `detailAt` | Twelve tiling layers of 512² (normal xy, roughness offset, albedo variation), generated on the GPU at boot: wood grain (along X, Y or Z, taken from the primitive's long axis), orange peel, cast-iron pitting, brushed, paper tooth, rubber, twist, plaster, brick.<br>It is picked per master (`detailFor`). It is sampled triplanar in object space with explicit gradients, and fades from full at 1 m to nothing at 4 m.<br>**WOOD_PROC:** wood grain also goes into the albedo at every distance, but only where there is no texture set (the look-dev fallback for the set's bench, floor and trim). |
| **GTAO / SSAO** | `look/ao.ts`, `renderer.ts` `drawLookPrepass` | A half-res depth prepass (vertex-only pipelines for the scene buckets, critters and opaque overlays, the set included), then one compute pass.<br>**GTAO** (XeGTAO-style): visible-arc integration, slices × steps per tier, radius 0.22 m, normals from depth. **SSAO** on 4 GB.<br>Then a depth-aware 4 × 4 blur. The part shader upsamples with depth weights. AO multiplies the IBL or hemisphere ambient, and half of it the fill and rim. |
| **Contact shadows** | `look/ao.ts` (screen space), `look/wgsl.ts` `lookSdfShadow` (G3's SDF) | **Screen space:** 12 steps over 0.14 m toward the key light through the half-res depth. **SDF:** G3's `giSoftShadow` toward the key light over 0.35 m, at weight 0.7 on 12 GB and up.<br>Both multiply the key light. The SDF is stamped from oriented boxes, so it is coarse; the screen-space term keeps the small detail. |
| **Probe GI consumption** (contract 3) | `look/ao.ts`, `look/wgsl.ts` `lookGiDiffuse`, `renderer.ts` | G3's `giWgsl` is spliced into the shading modules at a marker (a direct import would make a module cycle), and the GI bind group is group 3 of the part and glass layouts.<br>**D81 win-back 5:** `giIrradiance` is evaluated **at half resolution in the AO pass** and upsampled with depth weights. Per pixel in the main pass it cost about 3.1 ms at 3200 × 1800.<br>**Blend:** probe GI fully replaces the Studio's hemisphere ambient, and blends at 0.35 over a set's baked IBL. The SDF holds the parts but not the set, so GI alone would light the Tinker Lab like an open field.<br>G3's SDF AO is applied at weight 0.6 from 8 GB. |
| **Set IBL** | `look/setbake.ts`, `look/hdr.ts` | Loads E3b's **Cycles-baked `ibl_tinker_lab`** (the `.json` descriptor and a 2048 × 1024 equirect `.hdr`, RGBE RLE reader) into a cube. u = 0.5 faces −Z, checked against where the windows and pendants are in the HDR.<br>The cube is then GGX-prefiltered (one roughness per mip, filtered importance sampling) and cosine-convolved into a 16² irradiance cube. Cycles radiance is scaled into engine units (× π·keyI / 9).<br>**Fallback:** sets without a file (Kitchen, the stand-in) are baked in engine: a cube rendered from the set's probe with the sun, the set shadow, a hemisphere and emissives. The Studio keeps its hemisphere ambient (no `ibl_studio_*` file yet). Split-sum specular uses Karis' analytic DFG and specular occlusion from AO. |
| **Set shadow** (D81 win-back 2) | `look/setbake.ts` | A cached orthographic sun shadow of the whole set (4096² from 16 GB), re-rendered only when the set changes. It is the far cascade and is multiplied into `shadowAt`: the near map holds the parts and the set map holds the walls, so the windows shape the sun.<br>Casters are the set minus E3b's `noShadow` nodes and the `BACKDROP`; the sky card and trees would otherwise block the sun. Its extent is the Room preset's bounds from `tinker.env.json`. |
| **Froxel fog + shafts** | `look/fog.ts`, `post.ts` | A camera-aligned grid of screen tiles × exponential slices (0.1–80 m): 16 px tiles × 128 slices on tier 32, 32 px × 64 on 12/16 GB (D81 win-back 3: shafts at half resolution).<br>Each froxel is lit by the shadowed sun (near map × set map) with Henyey–Greenstein g = 0.65, plus ambient. Then a front-to-back integration, applied in post at the scene depth.<br>4 and 8 GB get an analytic uniform haze instead (no volume). Tinker values: 0.012 /m (brief: 0.010), sun scale 0.35. |
| **Tilt-shift DOF** | `post.ts`, `look/index.ts` | **CoC:** the in-focus band is ±35 % of the focus distance; the radius cap is 6 px at 1440p, scaled to the output. Photo mode uses a thin-lens CoC (`photoCoc`), which the proof frame uses for the key art's f/2.4 at 2.75 m.<br>**Passes:** downsample with fog and CoC, then a 32-tap golden-angle gather where a tap counts only if its own blur reaches the pixel, then a mix in the composite. Half-res gather on tier 32, quarter-res on 4–16 GB (D81 win-back 4).<br>**Focus** is the selection's centre in Build and the camera target in Run (the director's action), eased over 0.4 s; `lookPass.focusPoint` overrides it.<br>**Off** when U3's `dofEnabled()` says so (Settings › Graphics › DOF, or Reduce motion) and on 4 GB. |
| **Grade** | `look/lut.ts`, `post.ts` | **LUT:** 32³ after the PBR Neutral tonemap in display space. Loaded from E3b's `lut_tinker_lab.png` (a 1024 × 32 strip, x = r + 32·b, y = g) or a `.cube` file; otherwise generated from grade parameters (lift/gamma/gain, highlight warmth, shadow teal, saturation, S-curve). The Studio's is neutral.<br>**Finish:** vignette 0.15 and luma-weighted grain 0.02 on every tier. |
| **Tinker Lab render path** (contract 2) | `environment.ts`, `look/sets.ts`, `look/tinker.ts` | Draws `assets/build/env/tinker/tinker.glb` when `env.environment === 'tinker'`.<br>**Data from `tinker.env.json`:** preset origins (Desk at −(0, 0.904, −6.43)), the named cameras (`envView.camera('tinker', 'desk', 'hero')`), `noShadow` and the Room bounds.<br>**Set look (`TINKER_SET` and `TINKER_LIGHT`):** sun from behind-right, 20.6° up, 3,500 K-ish; cool fill; three 2,700 K pendant practicals; IBL, LUT and fog.<br>Until the glb landed it drew the **procedural stand-in** in `look/tinker.ts`, built from the key art script's own layout: room, windows and sky card, chalkboard with a 5 × 7 stroke font, blueprint, shelves, bench, mat grid, clutter and lamps. That path stays as the fallback. ART_ENVS doesn't list `'tinker'`; `EnvView` adds it. |
| **glTF tangents + ORM** (follow-up) | `look/tangents.ts`, `glbmesh.ts`, `meshes.ts` (`Geometry.tangentCodes` into the normal's w), `shaders.ts` (`vtxTanCode`, `VOut.tan`), `look/wgsl.ts` | See Deviations: MikkTSpace frames from the file, packed into the vertex's free slot; metal and roughness from ORM only; cavity on the indirect term only. |
| **Practical lamps** (follow-up) | `look/practicals.ts`, `look/wgsl.ts` `lookPracticals`, `renderer.ts` `drawSpotShadow`, `environment.ts` | Spot practicals from E3b's `presets.<p>.practicals`: position, direction, colour, 45°/70° cones (half-angles; 387 cd = 1600 lm over the 70° cone), 8 m range and bulb radius. Up to 8 lamps in the look uniform, shaded in `shade()` with a smooth cone falloff, inverse square clamped at the bulb radius and a windowed range.<br>**Intensity** follows the key art (D82): `cyclesWatts` / 4π × keyI / 9, × `practicalScale` 0.35, matched to the key art.<br>**The shadowed lamp** (the centre bench pendant, `shadowed: true`, 12 GB and up): a 1024² perspective depth map. The set casters are cached (re-rendered only when the set changes) and copied in each frame; the scene's opaque instances inside the cone are drawn on top through `vs_shadow` and a copy of the frame uniform. 4-tap PCF.<br>The stand-in set gets three downward stand-in spots. The old unshadowed point-light practicals are gone. |
| **Set shadow flags** (follow-up) | `environment.ts` | `__shadowonly` meshes (the invisible roof that keeps the sun to the windows) go into the set-shadow casters and are never drawn. `__noshadow` meshes (window frames, beams, pendants, the yard backdrop) are drawn and never cast. The `shadowOnly` and `noShadow` prefix lists in `tinker.env.json` are honoured as well. |
| **Governor** (D81) | `look/governor.ts`, `renderer.ts` | It drops a step after 2 s over 16.6 ms (frame-interval EMA) and restores one after 5 s under 80 %. The order: light shafts → DOF → **GI** (G3's probes stop updating, and the shading blend goes to 0) → internal resolution 0.9 / 0.8 / 0.7 / 0.6. G3's resize multiplies the TAA internal scale by `lookPass.renderScale`. |
| **Proof harness** | `look/hero.html`, `look/hero.ts`, `look/measure.js` | `/src/gfx/look/hero.html?tier=32&w=1920&h=1080` reproduces `render_tinker_lab.py`'s `build_machine()`. Parts are placed in key-art coordinates (shifted by E3b's mat re-centre of (−0.05, 0, −0.02)) and **settled** onto their supports with a 4 mm top-surface height field, as the script settles them. It adds the fuse spark, the balloon string and MOCHI (skinned, idle) at the key art's pose, and uses E3b's `hero` camera.<br>`__hero.snap(name)` uploads a PNG to the private dev server; `__hero.measure(force)` and `measure.js` `__ab()` time the GPU. |
| Tests | `apps/game/test/look.test.ts` | Governor order and restore, the `.art.json` index, kind-byte encoding, detail picking, the neutral LUT and `.cube` parsing, tier table, and the HDR reader (8 tests). |

## The D79 proof

The `?tier=32&w=1920&h=1080` frame matches the key art's camera exactly: E3b's `hero` camera is the key art's, re-centred on the mat.

**Region means against the key art** (display-referred luminance; `cmp.py` in a local scratch directory, same crops):

| Region | Key art | Engine |
|---|---|---|
| Wall and board | 0.293 | 0.287 |
| Shelf | 0.317 | 0.406 |
| Bench and mat | 0.376 | 0.426 |
| Bench front | 0.311 | 0.407 |
| Right window | 0.488 | 0.539 |
| Left (MOCHI, bricks) | 0.439 | 0.413 |
| Whole-frame mean RGB | 0.50 / 0.36 / 0.19 | 0.53 / 0.39 / 0.23 |

These numbers are from the **second render** (18:3x), after E3b's fixes (closed chalk glyphs, the key art's grey-green mat, the shadow-only roof, data practicals) and E3c's re-bake of the cogs as enamel. The exposure (now 1.15), fill (0.8), the practicals' scale (0.35 of the key art's 70 W) and the fog were set by this comparison, one change at a time.

**What reads the same:** the warm golden-hour key from the back-right windows, sun shafts and a hot patch on the bench's right end, the chalkboard text, the cool board and wall, the oak grain on the bench, the light-blue enamel cogs, the grey-green mat with its white grid, the pendants' warm pools on the bench, contact shadows and AO under the parts, and soft background focus.

**M3 review (orchestrator, close-out):** the first frame failed in the bottom third, and the fixes are in [M3_D79_REVIEW.md](M3_D79_REVIEW.md): the floor master, the procedural wood, set geometry and the real floor in the GI, and SDF occlusion of the rim, IBL specular and unshadowed practicals inside a set. `tinker_lab_engine.png` and `tinker_lab_compare.png` are now the reviewed frame. The list below describes the first frame.

**Differences the reviewer will see**, and whose they are:
- **The wall pool and the plate's shadow cone** behind the cog plate are fainter than the key art's. The data cone (45° inner, 70° outer half-angles) puts the wall at the cone's edge, while the Cycles lamp is a bare point light inside the shade, which is nearly a hemisphere. Widening `outerConeDeg` in E3b's data would brighten the pool; the renderer follows the data.
- **The bench front and the mat are about 0.05–0.1 brighter** than the key art (display luminance). The pendant pools are broader than the Cycles shade's.
- **The set's composition differs a little** (shelf height, window detail): that is E3b's set, not the camera.
- **Grain on the procedural wood** (the set's bench and floor) is wavier than Cycles' tactile wood. It goes away when E3b's env materials get texture sets.

## Timings

**Method (rule 7).** Chrome on the test system (RTX 5090, 32 GB), the hero scene (`hero.html`, E3b's full `tinker.glb` at 315k LOD0 triangles, 30 parts, MOCHI), output **3840 × 2160**. G3's TAA upscales from 3200 × 1800 on tier 32 and 2560 × 1440 on tier 16 (`?tier=16` forces the 16 GB settings).

- **What is timed:** per-pass GPU timestamps (`GpuTimer`). Bloom and the selection mask aren't timed passes. Chrome quantises timestamps to 65.5 µs.
- **Totals:** `__hero.measure()`, the mean over 150 frames after 30 warm-up frames, one frame in flight (paced by `onSubmittedWorkDone`, because Chrome throttles rAF to 2 Hz when the window isn't composited). Two runs of the tier-16 full look agree to 6 µs.
- **Per-feature costs:** `measure.js` `__ab()`, interleaved A/B. Each frame alternates the full look with the full look minus one feature; each sample is read back before the next frame. The reported value is the trimmed mean (middle half) of per-pass differences over 240 pairs, which cancels the shared-GPU contention and averages out the quantisation.
- **Contention:** the GPU was **not idle**. E3c's Cycles bakes and other streams' GPU spikes ran throughout, and per-frame wall times are inflated by that. The per-pass A/B differences are the reliable numbers; the main-pass column is noisy to about ±0.1 ms.

**Frame totals, timed GPU passes (ms):**

| Tier, 4K output | Look off | Full look | Look cost | Submit → done (wall, contended) |
|---|---|---|---|---|
| 16 (1440p internal) | 0.49 | **1.12** | **+0.63** | 4.2 → 4.8–5.4 |
| 32 (1800p internal) | 0.61 | **2.46** | **+1.85** | 4.4 → 5.5 |
| **16, final** (practicals, glTF tangents, new set) | 0.51 | **1.25** | **+0.74** (A/B +0.70) | 4.5 → 4.4 |
| **32, final** (practicals, glTF tangents, new set) | 0.64 | **2.51** | **+1.87** (A/B +1.75) | 4.2 → 5.5 |

**Practical lamps (A/B, final):**
- **Tier 32:** +0.15 ms. Main pass +0.14; the shadowed lamp's `look.spot` pass is 0.005 (set casters cached, 4 parts in its cone).
- **Tier 16:** +0.10 ms. Main pass +0.08.

**Whole look (A/B, final), tier 32:** G3's `gi` 0.63, `look.ao` 0.39, `look.fog` 0.08, main pass +0.56, post 0.03.

**Per feature, tier 32 at 4K** (A/B, the passes that moved; in ms):

| Feature | Cost | Where |
|---|---|---|
| Probe GI consumption + G3's GI pass | 0.86 | `gi` 0.655 (G3's pass) + half-res irradiance in `look.ao` 0.13 + main 0.2. Per pixel in main it was ≈ 3.1 ms before the half-res change |
| GTAO 4 × 8 + contact + blur | 0.26 (`look.ao` minus GI) | half res |
| SDF contact shadows (G3 SDF) | 0.16 | main |
| Froxel fog + shafts (200 × 113 × 128 froxels) | 0.17 | `look.fog` 0.08 + composite |
| Set shadow (far cascade) | 0.04 | main (map cached; re-baked only on a set change) |
| Texture sets (17 sets, 2 classes) | ≤ 0.03 | main, at the noise floor |
| Detail layer | ≤ 0.03 | main, at the noise floor |
| Set IBL | 0.01 | main |
| Tilt-shift DOF (half res) | 0.04 | `look.dof` + `look.dof.blur` |
| LUT + vignette + grain | ≈ 0 | composite |
| Depth prepass (half res) | 0.02–0.03 | `look.pre`; always on, not in the A/B |

**Per feature, tier 16 at 4K:** the whole look is +0.55 ms (A/B): `look.ao` 0.20 (3 × 6 GTAO, contact, half-res GI), main +0.20, G3's `gi` 0.07 (stride-4 updates), `look.fog` 0.05 (half-res shafts, 120 × 68 × 64), post 0.03, DOF (quarter res) 0.03. Each feature alone is ≤ 0.05 ms except probe GI (0.25).

**D81 budget.** The 16 GB tier's look costs **0.63 ms at 4K** on this GPU, against RENDERING §12's +2.5 ms allowance. The whole frame's timed passes are 1.1 ms.
- **Win-backs applied by default:** 2 (cached static set shadow), 3 (shafts at half resolution, 32 px froxels on 12/16 GB), 4 (DOF at quarter resolution on 4–16 GB) and 5 (GI amortised: half-res probe irradiance). Win-back 1 (upscaler internal resolution) is G3's TAA: 1440p at 4K on 16 GB.
- **Not measured:** the absolute budget on a real 16 GB-class card. There isn't one here, and the 5090 isn't a proxy for it. Perf CI on reference GPUs (RENDERING §12) should re-run `measure.js`.
- **Tier 32 (D85):** full-resolution shafts (16 px froxels × 128 slices), half-res DOF, 4 × 8 GTAO, full-rate multi-bounce GI. **2.46 ms** total at 4K from 1800p.

**Live governor:** order checked in `look.test.ts` (shafts → DOF → GI → 0.9 / 0.8 / 0.7 / 0.6). The resolution step goes through G3's TAA internal scale. The GI step stops G3's probe updates (`gi.probesOn`).

## Deviations and decisions

- **Texture sets in two size classes.** Resampling every 1024² set up to 2048² would have cost about 67 MB per layer. Sets go to their own class instead, and bit 15 of the layer code picks the arrays (3 more bindings).
- **glTF tangents are used (follow-up).** The typed parser doesn't read TANGENT, so `look/tangents.ts` reads the accessors from the raw glb (same node and primitive order as `ParsedGlb`, transformed by each node's world matrix). That covers 16 primitives on COG L, for example.
  - **Packing:** each tangent is stored as one number in the vertex's free 16-bit slot (the normal's snorm16 w): its angle around the normal against a basis derived from the normal, with the handedness in the sign. No vertex-format change.
  - **Shader:** the vertex shader decodes it into a new varying (location 11), and the texture-set normal map uses that MikkTSpace frame. The derivative frame stays as the fallback for primitives without tangents. Round-trip error < 1e-3 rad (test).
- **Texture-set metal and roughness come from ORM only** (E3c). Textured vertices never carry the material factors, so the anod masters' `metallicFactor` of 1 is ignored. ORM R (cavity) multiplies **only the indirect term**, through `lookCavity` in `shade()`, and no longer darkens the albedo.
- **The depth prepass is half resolution and vertex-only.** Decal alpha and the cutaway's discards aren't in it, so AO, fog and DOF see cut-away geometry as present. That is minor; the full-resolution depth isn't readable under MSAA.
- **Practicals are look spots,** not clustered lights. There are at most 8 per set, and one is shadowed from 12 GB. Their bulbs bloom from the set's emissive meshes.
- **Sampled-texture budget:** the part shader now reads 14 sampled textures (glass 15) against WebGPU's default limit of 16. The texture sets keep normal and ORM in one array (layers 2i and 2i + 1), and the practical's shadow takes the freed slot.
  - **Checked at the default limit:** `hero.html?limit16` forces `maxSampledTexturesPerShaderStage = 16`. With 4 glass draws in view, the console is clean and the frame renders.
  - **Why it matters:** G3 raised the requested limit in `gpu.ts`, and this adapter allows 48. Devices that stop at 16 now work without a variant pipeline.
- **Governor input is the frame interval,** not GPU time: the GpuTimer keeps stale pass names, so its total over-counts. It is disabled in the harness (`?governor` turns it on).
- **The Studio keeps its hemisphere ambient** (no Studio IBL file). Probe GI replaces it from 12 GB.
- **ART_ENVS:** `EnvView` treats `'tinker'` as drawable without editing `artlist.ts` (E3a's file).
- **DOF switch:** read through U3's `dofEnabled()` (`ui/settings.ts`), which also covers Reduce motion.
- **The `detail` WGSL module failed to compile** in early builds (`*` mixed with `^`, reported by U3). It is parenthesised now, and the hero page and the game load with a clean console. Pages opened before the fix need a reload.

## For other streams

- **G3:**
  - `renderer.lookPass.giAllowed` (tier ≥ 12, governor step) and `governor.state.gi` gate `gi.probesOn`; that is done in the renderer right before `gi.update`.
  - The look reads the GI through `giWgsl(3)` (fragment) and `giWgsl(1)` (the AO compute), so please keep those functions' signatures stable.
  - `giIrradiance` per pixel was expensive (≈ 3.1 ms at 1800p); it is now half-res.
  - Your GI pass itself measured 0.74 ms at 4K on tier 32.
- **E3b:**
  - Chalk text in `tinker.glb` renders nearly black: check `kn_env_chalk` emission or albedo.
  - Pendant positions are taken from the key art script. If yours differ, put them in `tinker.env.json` (`light.practicals: [{pos, color, radius}]`) and I'll read them.
- **E3c:** anod as metal vs. enamel (above). Texture sets load and render; 17 sets in the hero scene.
- **U3:**
  - DOF follows `dofEnabled()`, read live every frame.
  - Photo mode can set `renderer.lookPass.photoCoc` (px per dioptre at 1080p) and `focusPoint`.
- **Orchestrator:**
  - `envView.camera('tinker', preset, 'default' | 'hero' | 'wide' | 'lobby')` returns E3b's spawn and hero cameras, for applying on an environment change.
  - Parts-data's index doesn't export `env_tinker.ts` yet. The renderer reads `tinker.env.json` instead, so nothing is blocked.

## Found, not mine

- `pnpm typecheck` was red during the session from other streams' mid-edit files (audio, ui/panels, main.ts, gfx/volume.ts). It is **green** at hand-back (17:59), and `vitest apps/game/test` passes 71 / 71 (including `look.test.ts`).
- The GPU was shared during all measurements, with E3c's Cycles texture bakes and another stream's GPU spike, 100k parts at 4K, running. See Timings.
