# Beta polish notes: RENDER

Stream RENDER owns `apps/game/src/gfx/**` (not `gfx/matter`). Plan: [BETA_POLISH_PLAN.md](BETA_POLISH_PLAN.md). D-numbers D125–D126. Status: **done** (2026-10-25).

**Setup:**
- Vite 5325 (the bench config, HMR off); the host on 8925 wasn't needed (everything loads in-page).
- Headless Chrome over CDP, with a session-keeping driver built on `tools/vendor-matrix/cdp.mjs`'s flags.
- Vite was stopped at hand-back.

**Hardware:** RTX 5090 (Chrome 155, D3D12), Core Ultra 9 285K.
- **The GPU was shared.** Every timing marked *quiet* was taken after nvidia-smi read under 5 % for 3 samples in a row.
- Other runs are marked *contended* and only used for direction.
- **All timings are provisional (rule 11).**

## Summary

| Task | Result |
|---|---|
| 1. Key-light shadow range | Two cascades fitted to the view, a texel-stable ladder, a distance fade, and per-cascade GPU caster LOD. Whole-world shadow pass: **15.2 → 6.0 ms** at 12 GB and **19.7 → 6.8 ms** at 32 GB (quiet A/B). |
| 2. Spot-cone cull | Moved into the GPU cull pass (`views.spot`). Hangar CPU per frame **7.4–8 → 0.6–1.0 ms**. The old CPU loop itself measured 6.4–9.2 ms in-page, and it silently stopped at 4,096 casters. |
| 3. DOF and the gizmo | A gizmo coverage mask at output size. Post keeps fog and DOF off under it, and DOF's gather never spreads it. |
| 4. Earth spins | Runtime lighting from ART's input maps (D128). 1°/min on the wall clock, with the Hangar's 105° phase applied in the renderer. Lifts D112's no-spin. |
| 5. Solar-panel shimmer | Distance LOD per 32 m chunk, using the glb's own LOD2 slabs. The far LOD drops the backplate that z-fought past 150 m and is tinted to the module's area mean. Panel-crop shimmer **3.25 → 1.60** (mean frame-to-frame Δ). |

## 1. Key-light shadows (D125)

**Before (M5):**
- There was one ortho map around the camera focus: half extent 0.9 × the focus distance, capped at 150 m (300 m across).
- Every opaque instance inside it was drawn at fixed LOD1.
- On the whole-world camera, the Arena's 400k and the Megastructure's 2M parts all went in (M5_NOTES_T5 finding 3).

**Now** (`gfx/shadowfit.ts`, `renderer.ts`, `shaders.ts`):
- **Near cascade** (the existing map and binding, so `frame.shadowMat` means what it did for Matter, debris, fog and terrain):
  - The focus box, capped at 80 m half extent (160 m across).
  - Shrunk to the scene's light-space bounds when those are smaller. A small machine in a big world gets much finer texels.
  - Its depth range keeps M5's, so the bias means what it did (`frame.nearP.x` rescales it if the scene's depth range widens it).
- **Far cascade:**
  - A new map (`shadow.far`) at half the near map's size, at binding 13 of the part layout and in `frame.shadowFar` / `shadowFarP`.
  - It covers the camera frustum up to the shadow distance (3 × focus distance + 30, 60–1,500 m), intersected with the scene's bounds.
  - Part shadows fade out over its last 20 %.
  - It's skipped when the near map already holds everything in view, as in close-ups of small scenes.
- **Stability:** both extents step along a 2^(1/8) ladder, and both centres snap to whole texels in light space, so shadows don't crawl while the camera moves or zooms.
- **Scene bounds:** instance centres ± radius at `setScene`. In run mode they grow by up to 32k bodies per frame, round-robin, so flying parts keep their shadows.
- **Shading:**
  - The part shader (`keyShadow`) uses the near map inside its box, blends to the far map over the near map's outer 6 %, then fades with distance. The static set shadow multiplies on top, as before.
  - Terrain samples both maps.
  - Matter, debris and fog still read the near map only.
- **Casters**, culled per cascade on the GPU in the same compute pass as the camera:
  - **LOD:** one LOD coarser than the camera would draw for the near map; the coarsest LOD for the far map.
  - **Box proxies:** a caster becomes its mesh's LOD0 box (`vs_shadow_box`, the library's `box` mesh scaled from a per-mesh centre/half table) when it is under 5 px on screen or under 1.5 near / 3 far texels in its map.
  - **Skip:** a caster is skipped under ½ px on screen or under ⅓ texel in its map.
  - **Out of view:** a caster is skipped when its sphere, swept along the shadow direction for the longest possible shadow, can't reach the camera frustum (with the shadow distance as the far plane).
  - **The section box** turns proxies off, because they aren't clipped.
- **Matter and debris** draw only into the near map, as before. Past it, grains have no shadows, as before.
- **Before/after toggle:** `renderer.shadowFit = false` is M5's single map with LOD1 casters. Bench: `&shfit=0`.

**Measured** (bench `scene=big`, governors off, quiet A/B in one session; shadow = near + far pass, GPU ms; frame = `timer.frameMs`; throughput = 2 frames in flight):

| Scene | Camera | Shadow before → after | Frame before → after | Throughput before → after |
|---|---|---|---|---|
| **12 GB** Arena, 400k parts, 2M grains, Moon, 1440p | preset | 10.4 → **3.4** | 25.0 → 20.4 | 29.7 → **23.2** |
| | whole world | 15.2 → **5.8** | 19.4 → 10.7 | 20.2 → **11.5** |
| | Matter close-up | 1.0 → 1.9 | 7.7 → 10.9 | 9.2 → 10.7 |
| **32 GB** Megastructure, 2M parts, 8M grains, 4K from 1800p | preset | 10.7 → **4.8** | 25.3 → 19.0 | 29.6 → **19.3** |
| | whole world | 19.7 → **6.8** | 35.0 → 20.7 | 37.4 → **20.9** |
| | Matter close-up | 6.2 → **3.6** | 39.1 → 29.3 | 41.0 → 31.5 |

- **The 12 GB close-up costs about 0.9 ms more.** That's the far map giving the background shadows it never had: M5's map stopped 2.9 m from that focus.
- **The main pass is unchanged within noise** (14.6 → 14.7 ms, 12 GB preset).
- **Governed 12 GB** (governors on, 30 s settle): preset 15.7 ms at look step 6 (G5: 16.2–16.5 at step 7 of 7); whole world **10.4 ms at step 5** (G5: 17.6 at step 7). The governor no longer needs its last step.
- **What's left:** 12 GB at the preset camera is the main pass (14.7 ms, 400k LOD1 parts; see "Found" 1). 32 GB whole world is the AO prepass plus the main pass (4.3 + 6.5 ms) and grains.

Shots (Arena, 60k parts; shadows are equivalent near the focus, and continue past M5's box edge):
- `docs/dev/beta_render/shadow_mid_before.png` / `shadow_mid_after.png`
- `shadow_close_before.png` / `shadow_close_after.png`

## 2. Spot-cone cull (D125)

`drawSpotShadow`:
- **Before:** it looped over every scene instance on the CPU each frame (cone + range test, a body-transform compose in run mode), wrote a list and issued one draw per instance at LOD0.
- **Now:** the shadowed lamp is a fourth cull view (`views.spot`). The lamp's frustum planes run in the same compute pass, with the same shadow LOD policy. Box proxies are sized in that perspective map's own texels (`CullView.lamp`: texel = distance from the lamp × 2·tan(fov/2) / 1024).
- **Drawing:** bucket indirect draws through `binds.shadowSpot` (a frame copy whose `shadowMat` is the lamp's).
- **Gating:** the cull is dispatched only when `lookPass.practicalShadowOn` (12 GB and up, a shadowed lamp in the set).

| Hangar, 12 GB, Arena, 400k parts | Before | After |
|---|---|---|
| CPU per frame (`fx.frame` + `renderer.draw`, median) | 7.4–8.0 ms (T5) · the old loop alone: 6.4–9.2 ms in-page | **1.0 / 0.6 / 0.6 ms** (preset / whole / close-up, quiet) |
| Casters | the first 4,096 in index order (a random subset: the Main Hall lamp's 70° cone covers ≈ the whole Arena) | every caster in the frustum, sized by the map |
| `look.spot` GPU | — | 0.7 ms |

## 3. DOF never softens the gizmo (D125)

- **Problem:** D117's gizmo (`SceneItem.top`) is drawn last in the late pass, so it went through TAA, fog and the tilt-shift DOF. The DOF took the depth behind it and blurred it.
- **Fix:**
  - After TAA, the top items draw their coverage into `gizmo.sharp` (output size, r8unorm, un-jittered `frameBufStill`, pipeline `topMask`).
  - The composite skips fog and DOF where it's set.
  - DOF's prep pass zeroes the CoC there, so the gather can't spread the gizmo into the soft background.
- **Cost:** a one-draw pass that runs only while the gizmo is up.
- **Before/after toggle:** `renderer.gizmoSharp = false`.
- **Shots:** `gizmo_dof_before.png` / `gizmo_dof_after.png`, and `gizmo_dof_crop_before_after.png` (DOF focused 40 m behind the scene).

## 4. The Earth spins (D126; lifts D112's no-spin)

- **Inputs** (ART, D128): albedo = unlit reflectance; ORM = data (R cloud cover, G night lights, B water); `earth.lighting: 'runtime'`, `degPerMinute: 1`, `spinAxis [0, 1, 0]`, and the Hangar's `phaseDeg: 105`.
- **Mesh** (`gfx/environment.ts`): with `lighting: 'runtime'`, the env's Earth meshes are split from the set into their own mesh, centred on the planet. They're drawn as an overlay item flagged `earth` through `pipes.earth` (`fs_earth`).
- **Spin:** the angle comes from the wall clock (1°/min, the same for every player). `fs_earth` samples the equirect maps at the surface direction turned back by it, using the glb's own UV convention (checked against the mesh's UVs to 4 decimals).
- **Lighting:** the shader recomputes E5c's bake with the same terms and constants:
  - the soft terminator and the warm sunset band;
  - cloud shadows (the cloud map offset along the sun);
  - clouds lit by the sun;
  - the blue-black night side;
  - city lights gated to the night side;
  - the ocean glint (water mask);
  - limb scattering, stronger when backlit;
  - the bake's display mapping (×1.55, clipped at 1.8).
- **Sun direction:** the set's key light. For the Hangar it's turned toward the viewer until the phase angle at the planet is 105° (D112's art call), about sun × view, as the bake did. The Moon keeps its true sun (≈ 46°, gibbous). `setpieces.ts earthFrame`.
- **Mipmaps:** derivatives come from the computed UV, with the seam handled by the wrapped coordinate.
- **Device loss:** the Earth comes back; `renderer.earth` carries over.

Shots, 1920 × 1080:

| | Before (E5c baked) | After (runtime) |
|---|---|---|
| Hangar Main Hall hero | `art/style-samples/m5_hangar_engine.png` | `docs/dev/beta_render/hangar_engine_after.png` (DOF off), `hangar_engine_after_dof.png` (tilt-shift on) |
| Moon hero | `art/style-samples/m5_moon_engine.png` | `moon_engine_after.png` |
| Spin | — | `hangar_earth_disc.png` / `hangar_earth_disc_spin90.png` (full disc from outside the window: the lit crescent at the top, the terminator, city lights on the night side); `moon_earth_zoom.png` / `moon_earth_zoom_spin90.png` (3° FOV) |

- **Compared with the baked look:** it matches in framing and character: clouds, soft terminator, limb glow, the lit crescent through the Hangar window, and lights only on the night side.
- **Differences:**
  - The continent in view depends on the time of day.
  - At the Moon's 3° zoom, the 1,024² map is soft (texture-limited, as it was baked).
- **Ice caps** (ART's note): with the pole up, the north cap sits along the top of the Hangar's lit crescent and reads as cloud and ice. Fine as is; tightening it is optional.

## 5. Distant solar-panel shimmer (D126)

- **The problem:** the env set draws LOD0 at every distance. After ART's rework (D128: 1 m modules, 8 cm gaps over a darker backplate), the hero views at 50–90 m are clean.
- **What still shimmered past ≈ 130 m:**
  - sub-pixel gaps;
  - and, mostly, the cells z-fighting the backplate 7 cm behind them. At 150 m+ that's under the 24-bit depth buffer's precision with the 0.02 m near plane.
- **The fix** (`setpieces.ts` + `environment.ts`):
  - Meshes matching `__solar_(arrays|cells)__` become their own mesh per chunk, with the glb's LOD chain.
  - Each frame they draw LOD0 while an 8 cm gap spans ≥ ¾ px (10 % hysteresis: ≈ 135 m at 1080p), else LOD2. LOD2 is gap-less slabs, minus the backplate triangles (`dropColour` by the `kn_env_solar_grid` base colour), and tinted 0.9 to the module's area-weighted mean.
  - A first try at 1.5 px dropped the grid at the hero distance, where it reads cleanly, so the threshold is ¾ px.
- **Measured shimmer:** mean frame-to-frame |Δ| over a sub-pixel camera drift, 60 frames, in a crop around the three far panels (240 m, 30° FOV): **3.25 → 1.60**. The hero crop: 1.46 (LOD0 kept).
- **Shot:** `solar_far_before_after.png` (3× crop).
- **ART's textured-plate option** (a second env texture set) isn't needed now. It would still help panels between 90 and 135 m.
- **Debug:** `envView.farLods = false`.

## 6. LOD and impostors by real size (follow-up, D125; orchestrator-approved)

**The bug:** the cull sized every instance by `inst.radius`, which is 0.5 × |size|. That assumes a unit mesh, so every art part at size 1 counted as 0.87 m across, 3–8× its real size (STITCH 0.066 m, THUD 0.19 m, BIG TOP 0.41 m, LIFT 0.62 m). LOD1 started ≈ 4× too far away, and impostors switched in at the wrong size.

**The fix:**
- **Sizing** (`shaders.ts` cull, `MeshEntry` = LOD0 radius + centre):
  - LOD and impostor selection use the mesh radius × the largest scale.
  - The frustum and section tests use the larger of the real sphere (about the mesh centre) and `inst.radius`. Shape keys can grow a part past its LOD0 bounds.
  - The thresholds are unchanged (LOD1 < 0.05, LOD2 < 0.012 of the half-height).
- **Impostor colour:** with real sizes, impostors switched in at the preset's 24 px, and they popped:
  - They were too dark. Textured materials baked their glTF base colour, a placeholder, not their texture set.
  - At 24 px their nearest-of-64-views orientation snapping showed (a BRIK visibly turned).
  - **Bake fix** (`impostor.ts`): textured materials sample their set's albedo (a small mip), and atlases re-bake when the sets' version changes.
  - **Lighting:** re-matched to the meshes (× 1.65, measured on STITCH, PIN and BRIK at the switch: within ≈ 2–5 sRGB levels after).
  - **Size cap:** impostors switch in under **8 px across** (`IMPOSTOR_MAX_PX`; the preset's 24 px stays the ceiling, Arena and Megastructure only).
- **Debug:** `renderer.lodByMesh = false` (bench `&lodmesh=0`) restores M5's sizing.

**Popping checks** (16 GB settings, 1440p, the new bench scene `scene=lodmix`: a dense grid of STITCH, PIN, COG S, BRIK, TOPPLE TILE, THUD, BOING, LEDGE, BIG TOP and LIFT):
- **Dolly:** 2 → 4 → 8 → 15 → 25 → 40 → 65 → 100 m, before (M5 sizing) and after, in `docs/dev/beta_render/lod_dolly/dolly_{before,after}_<d>m.png`, with `dolly_grid_before_after.png`. No visible difference at any step.
- **Per switch:** the same camera just past each switch, old LOD against new, 240 px crops with a ×4 difference image:
  - `switch_mesh_lod1_bigtop_lift.png`, `switch_mesh_lod2_stitch_pin_lift.png`: mesh LOD1 / LOD2 switches. The differences are 1-px silhouette edges, invisible at 1×.
  - `switch_impostor_8px.png`: the impostor switch as shipped. Colour within ≈ 2–4 sRGB levels, edge-level differences.
  - `switch_impostor_24px_rejected.png`: why the cap is 8 px.

**Main pass, quiet A/B in one session** (GPU ms, governors off; throughput in brackets):

| Tier, scene | Preset camera: before → after | Whole world: before → after |
|---|---|---|
| 4 GB, Room, 20k parts, Moon, 1080p | 5.5 → **3.7** (8.3 → 6.2) | 5.0 → **3.6** (7.6 → 5.9) |
| 12 GB, Arena, 400k parts, 2M grains, Moon, 1440p | 14.6 → **6.8** (22.9 → **13.3**) | 2.2 → 2.1 (9.0 → 8.8) |
| 16 GB, Megastructure, 1M parts, 4M grains, 4K from 1440p | 2.8 → 2.3 (9.0 → 8.1) | 2.9 → 2.9 (10.1 → 10.1) |
| 32 GB, Megastructure, 2M parts, 8M grains, 4K from 1800p | 6.8 → **5.0** (19.3 → **16.7**) | 6.5 → 6.5 (20.9 → 20.8) |

- The AO prepass dropped with the main pass (12 GB preset: 3.7 → 2.0 ms).
- **No tier regressed.**
- **12 GB now meets 60 fps ungoverned at both cameras.** 32 GB's preset camera is at the line; its whole world still misses (shadows 6.8, AO prepass 4.4, main 6.5 ms, and the grains).
- **Checks:** 0 validation errors in every run; device loss still recovers (impostors re-bake on the new device).

## Files

| File | Change |
|---|---|
| `gfx/shadowfit.ts` (new) | Cascade fitting: `quantExt`, `fitNear`, `fitFar`, `fitLegacy`, `shadowDistance`, `frustumBox`, `clipPlanes`, the caster thresholds |
| `gfx/setpieces.ts` (new) | `earthFrame` (spin, art phase), `farLod`, `dropColour`, the solar LOD constants |
| `gfx/renderer.ts` | Far map, cascade fits, scene bounds, `views.far` / `views.spot`, proxy buckets and `shadowBoxes`, `drawProxies`, the GPU spot path, `CullView` (320 B), `MeshEntry` (+ radius), the gizmo coverage pass, the Earth pipeline and frame fields, `SceneItem.earth` / `.lod`, toggles `shadowFit` / `gizmoSharp` / `lodByMesh`, `IMPOSTOR_MAX_PX` (§6) |
| `gfx/shaders.ts` | `Frame` + far cascade, near/far biases, Earth (`FRAME_BYTES` 1,136, `FRAME_FAR`); the cull's shadow LOD/proxy/skip/sweep/lamp terms; `vs_shadow_box`; `keyShadow`; `fs_earth`; `fs_top_mask` |
| `gfx/post.ts` | The gizmo coverage at binding 7 (composite + DOF prep), `P.ext` |
| `gfx/terrain.ts` | Samples the far cascade |
| `gfx/environment.ts` | The runtime-lit Earth mesh and frame, the solar arrays' distance LOD |
| `gfx/look/index.ts` | `practicalShadowOn` |
| `gfx/impostor.ts` | The bake samples texture-set albedo (material and UV attributes, the look's albedo arrays) and re-bakes when the sets change; lighting × 1.65 (§6) |
| `bench/scenes.ts` (`lodMix`), `bench/bench.ts` | `scene=lodmix&half=`, `&lodmesh=0` |
| `bench/bench.ts`, `bench/scenes.ts` | `&shfit=0`; `scene=demo&demo=<name>` (Library demos, demo camera, `&camScale`, `&snapAt=` frame grabs); `window.__envView` / `__envItems()` |
| `test/render-beta.test.ts` (new) | 11 tests: ladder, texel stability, scene fit, legacy extent, far cover / skip, shadow distance, frustum box, Earth phase and spin, far LOD hysteresis, `dropColour` |

**Checks:**
- `pnpm -s vitest run apps/game`: 19 files, 266 tests pass.
- `pnpm -s typecheck`: clean. `pnpm -s lint`: determinism lint clean.
- No WebGPU validation errors in any final run (Arena / Megastructure / Hangar / Moon / demo).
- `simulateDeviceLoss()` recovers: 200 ms, Earth, shadows and gizmo pipelines intact, no errors after.
- The game page on 5325 loads with no console errors.

## Found (not fixed here; for the orchestrator)

1. **`inst.radius` assumes a unit mesh** (`InstanceData.set`: 0.5 × |size|, 0.87 m for every art part at size 1). **Fixed in the follow-up, §6.**
   - **Still open:** impostors draw the nearest of 64 views, with no blending (`impostor.ts`'s "later" list). That's why they're capped at 8 px across. View blending would let them go back to 24 px.
2. **GRABBER + STITCH** (PARTSIM's request, Library demo, `docs/dev/beta_render/grabber_stitch_0.9s.png`): the gripper picks up and carries the STITCH. The visible finger tab ends inside the ball's upper hemisphere, so it reads as poking into the ball rather than pinching its sides. That's finger length or hold height (PARTSIM / ART).
3. **Shared scratchpad:** at the start I wrote `drive.mjs`, `bench.mjs` and `probe.mjs` at the scratchpad root, where an earlier stream's `drive.mjs` already was. RENDER's files now live in `scratchpad/render/`. If another stream depends on the root `drive.mjs`, it's now RENDER's driver (same Chrome flags, session API).
