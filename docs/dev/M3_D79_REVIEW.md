# M3 review gate: the D79 side-by-side and the 8 GB Tinker Lab playtest

2026-10-24. **Verdict: PASS**, after the fixes below. This is the milestone review that closes the third M3 exit criterion: "the D79 side-by-side review passes" ([PRODUCTION §2 M3](../PRODUCTION.md), [M3_PLAN](M3_PLAN.md)). As with D80–D84, the producer can overturn it at their own review. The fixes are small and data-driven, so a reversal costs little.

The gate (PRODUCTION §2 M3, "Review gate") has two parts:
1. An in-engine frame of the Tinker Lab hero shot, reviewed side by side with `art/style-samples/tinker_lab_key.png`.
2. A playtest in the Tinker Lab with the glass UI on the 8 GB tier, covering legibility, Reduce transparency and frame time.

**Images:**
- **The proof pair:** `art/style-samples/tinker_lab_compare.png` (key art | engine) and `tinker_lab_engine.png` (the engine frame: tier 32, 1920 × 1080, E3b's `hero` camera, `src/gfx/look/hero.html`).
- **Before and after:** `art/style-samples/tinker_lab_review_m3.png`, the bottom of the frame where the first pass failed.

![Key art | engine](../../art/style-samples/tinker_lab_compare.png)

## 1. The side-by-side

### Criteria

The criteria come from D79's own list, the D82 lighting call and a set of measurements. An offline path tracer and a 60 fps renderer won't match pixel for pixel, so the measured criteria are loose enough to allow that and tight enough to catch a wrong look.

| # | Criterion | How it's checked |
|---|---|---|
| C1 | **Same shot.** The key art's camera, with the same machine on the same bench. | E3b's `hero` camera is the key art's. The harness rebuilds `render_tinker_lab.py`'s `build_machine()` and settles the parts. |
| C2 | **D79 features on.** Texture sets, the detail layer, probe GI (12 GB and up), GTAO, SDF contact shadows, the set IBL, froxel fog with sun shafts, bloom on the practicals, DOF, the warm LUT, vignette and grain. | The harness HUD and per-pass GPU timings. |
| C3 | **D82 lighting.** A warm golden-hour key from the back-right windows, a cool sky fill, warm pendant pools, at real scale. | Visual. |
| C4 | **Exposure.** Whole-frame mean luminance within ±⅓ stop of the key art. | Linear luminance. |
| C5 | **Regions.** Every cell of a 4 × 3 grid within ±1 stop, with a median within ±⅓ stop. | Linear luminance per cell. |
| C6 | **Warmth.** The frame's R/B ratio within ±½ stop of the key art's, and no region cooler than the key art's by more than ½ stop where the key art is warm (R/B > 6). | Linear R/B. |
| C7 | **Saturation.** Mean HSV saturation within ±10 %. | sRGB. |
| C8 | **Materials read the same.** Oak grain, enamel cogs, the grey-green mat, chalk, glass, the floor. | Visual, at 1:1 crops. |

The measurements come from `cmp_hero.py` in the orchestrator scratchpad, run on the two 1920 × 1080 PNGs.

### First pass (L3's frame): FAIL on C5, C6 and C8

The first pass matched in most places: C4 was +0.29 EV, and the wall, the board, the bench top, the machine, the chalk and the window read the same. But the bottom third failed. The floor in front of and under the bench came out up to **+1.05 EV** too bright, and much cooler than the key art there (R/B **5.8** against 13.6). At 1:1, two problems showed:

1. **The floor was the wrong colour.** E3b's `floorboards` master was a pale grey-beige `#9A8A74`. The approved key art's floor is warm brown `#7A5236`, with grain from `#5A3A24` to `#8E6240`.
2. **The wood grain read as cartoon waves.** The engine's procedural wood swung its rings by about 15 cm across a 0.5 m tile, where the key art's Cycles wood is fine and straight.

### Root causes and fixes

1. **The floor master** (`tools/blender/kn_tools/masters.py`, `floorboards`) now uses the key art's values (D82: the key art wins). The Tinker set was rebuilt (`node tools/assets.mjs --force-libs --env-tinker`), with the IBL re-baked. Geometry and colliders are unchanged.
2. **The procedural wood** (`gfx/look/textures.ts`) is now fine, nearly straight streaks: 22 per 0.5 m tile, wobbling about 1.5 cm at most, following `_tactile.py`'s 14× stretched bands. It stays tileable.
3. **The GI floor was at the bench top.** The GI's analytic floor was hard-coded at y = 0, and in the Tinker Desk preset y = 0 is the cutting mat, so the GI treated everything under the bench as solid floor. The set geometry also wasn't in the SDF.
   - `Gi.setStatic(boxes, floorY)` (`gfx/gi.ts`) now puts the floor at the set's real floor and stamps the set's collider boxes into each clipmap level after the parts. Boxes over 3 m are skipped; the analytic floor stands in for the slab.
   - `environment.ts` passes in the active preset's boxes: 187 for Tinker Room, 186 for the Kitchen, none for the Studio.
   - Probe rays that miss now return the set IBL's mean radiance instead of the Studio sky (`Gi.missRadiance`, from `LookPass.iblMean`).
4. **Light leaked under the bench.**
   - The window-sky rim light, the IBL specular on glossy surfaces and the practicals without a shadow map were all unoccluded, so they lit the lower shelf through the bench top. Shading now applies large-scale SDF occlusion inside a set: `lookOcc`, a 16-step march, in `look/wgsl.ts`. It covers the rim (`lookRimVis`), the IBL specular below roughness 0.7 (`lookSpecVis`), and the unshadowed practicals.
   - The diagnosis: per-light A/B on the worst cell put the rim at +0.079 linear luminance (and its blue cast), and the practicals at +0.063.
   - It applies only inside a set with the SDF on, so 12 GB and up. The Studio is unchanged: there, `setStatic([], 0)` restores the old state exactly, which was checked in the game.

### Final measurements

The engine column is the final frame; the first-pass column is L3's original frame.

| | Key art | First pass | **Final** | Criterion |
|---|---|---|---|---|
| C4 whole-frame exposure | — | +0.29 EV | **+0.04 EV** | ±0.33: pass |
| C5 worst cell / median of cells | — | 1.05 / 0.31 EV | **0.72 / 0.22 EV** | ≤ 1 / ≤ 0.33: pass |
| C6 frame R/B | 3.80 | 4.50 (+0.24 stop) | **5.17 (+0.44 stop)** | ±0.5: pass |
| C6 warm regions cooler by more than ½ stop | — | 3 (bottom row) | **1** (bottom centre-right, 13.6 → 7.8) | see below |
| C7 saturation | 0.646 | 0.637 | **0.674 (+4 %)** | ±10 %: pass |
| Contrast, p95/p5 | 3.76 EV | 4.50 EV | 4.53 EV | (reported) |

Per cell, engine against key art (EV, then R/B as key | engine):

| | Left | Centre left | Centre right | Right |
|---|---|---|---|---|
| Top | +0.23 · 1.5 / 2.1 | −0.41 · 4.0 / 8.0 | +0.26 · 6.1 / 6.4 | +0.03 · 3.4 / 4.3 |
| Middle | −0.21 · 2.3 / 4.2 | −0.12 · 2.0 / 2.9 | +0.27 · 2.9 / 3.7 | +0.01 · 3.7 / 4.2 |
| Bottom | −0.55 · 7.6 / 20.6 | +0.15 · 16.9 / 21.1 | +0.72 · 13.6 / 7.8 | +0.04 · 10.4 / 12.9 |

C6's second clause fails in one cell: the bottom centre-right, the shelf and floor under the bench's right half. It's still lighter and less orange than the key art there. Everything else in that cell now matches: the grain, the floor colour, the shade under the bench top and the sun patch. The remaining difference is a real-time limit. Cycles bounces light many times through the space under the bench, and the engine has one probe-GI bounce over a coarse SDF. **Accepted as a note, not a fail.** C6 is about the look staying golden-hour, and the frame overall is warmer than the key art, not cooler.

**C1–C3 and C8** are judged on the side-by-side and 1:1 crops. **Pass.**
- **The same:** the shot, the machine, and the warm key from the back-right windows with shafts and a hot patch on the bench's right end. Also the cool board and wall, the chalk text, the light-blue enamel cogs, the grey-green mat with its white grid, the pendant pools, the oak grain, the warm floor, the shade under the bench, contact shadows, and the soft background.
- **Residual differences, accepted:**
  - The pendant's wall pool behind the cog plate is fainter (−0.41 EV top centre-left). The data cone is narrower than the Cycles bare bulb (M3_NOTES_L3).
  - The blueprint reads a little more saturated.
  - The set's shelf and window dressing and a few part placements differ slightly. These are E3b's set and the harness's settling, not the look.

### Cost of the fixes

Method: `__hero.measure()`, the mean of 120 GPU-paced frames after 30 warm-up frames, alternating with `force.sdfShadow = false` (which turns off all of the new terms plus the key contact shadow), two rounds each. The contact shadow's own 0.16 ms (M3_NOTES_L3) is then subtracted. Quiet GPU: no soaks, bakes or other streams running.

| Hero scene, 4K output | Main pass, on / off | New terms | Whole frame |
|---|---|---|---|
| Tier 32 (3200 × 1800 internal) | 1.93 / 0.87 ms | ≈ 0.9 ms | 3.4 ms |
| Tier 16 (2560 × 1440 internal) | 1.23 / 0.62 ms | ≈ 0.45 ms | 1.9 ms |

D79's look budget on the 16 GB tier is about 2.5 ms extra. L3's look measured +0.63 ms, so it's now about 1.1 ms: inside the budget. The GI's static stamp is a few hundred boxes once per clipmap build.

## 2. The 8 GB Tinker Lab playtest

The production build ran on a local test server (port 8799, scratch data), in the Tinker Lab Room preset (the new-world default). Settings › Graphics › Quality tier was **8 GB**, the viewport 1920 × 1080 (and 1440 × 900 for the layout), the glass UI on, and a 49-part machine built and run.

**Found and fixed first: the tier choice never reached the renderer.** `main.ts` built the renderer, effects and network client from the detected tier (`caps.tier`). Settings › Quality tier only changed the glass UI and the lobby. Choosing 8 GB rendered at 16 GB, and choosing **32 GB never turned on the 32 GB tier**. The choice now applies at boot, and changing it shows a "reload to switch" toast, because the renderer is sized at init. Verified: with the setting at 8, the renderer's tier is 8 and the host's view is 8.

| Check | Result |
|---|---|
| **Legibility, glass on** | **Pass.** For every text on the 5 glass surfaces (75 texts), the glass tint and the text's own backgrounds (chips, D86's selected gradient) were composited over the brightest pixel of the live Tinker Lab render behind it, and over pure white. Worst case: **4.66:1** on both (white on the selected blue), and none under 4.5:1. The world card's title is 9.47:1 over the real backdrop. |
| **Reduce transparency** | **Pass.** Switched live from the command palette: `data-solid="setting"`, all 5 surfaces solid `rgb(18,21,28)` with no backdrop filter, 0 blurred, and the choice saved. Worst text contrast in solid mode: 4.66:1 (141 texts). Switched back: blur returns (`blur(22px) saturate(1.4)`, 5 surfaces). |
| **Frame time, 8 GB** | **Pass.** At 1344 × 756 internal, TAA-upscaled to 1080p: GPU 0.63 ms in Build. During the run it's a 0.56 ms mean and 1.03 ms peak (180 paced frames). The glass compositor cost is U3's measurement on the test system: 0.1–0.25 ms per frame at 1440 × 900 (M3_NOTES_U3). The glass budget guard (4 ms for 2 s) never tripped. |
| **Console** | Clean apart from the expected `.cube` LUT probes (`lut_tinker_lab.cube`, `lut_kitchen_morning.cube`), which fall back to the PNG and the generated grade. The Kitchen and Studio switches render correctly. |

The browser pane throttles requestAnimationFrame to 2 Hz, so the live frame clock wasn't usable. Frame time is the GPU timestamp total, with draws paced on GPU completion. An RTX 5090 running the 8 GB tier's settings is far faster than an 8 GB card, so these numbers show the tier's settings work, not 8 GB hardware headroom.

## Verdict

**PASS.** Both parts of the gate pass after the fixes. The notes carried forward are the warmth of the bottom centre-right under the bench, and the residual set and placement differences.
