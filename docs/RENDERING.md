# KNOCK-ON Rendering

Status: v1.3 · 2026-10-25 (as built through M5) · Owner: Graphics Lead
Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [art/ASSET_PIPELINE.md](art/ASSET_PIPELINE.md) · [art/briefs/vfx.md](art/briefs/vfx.md) · [GAME_SPEC.md §13–15](../GAME_SPEC.md) · [D79 Warm cinematic renderer look](dev/DECISIONS_2026-10-24.md)

A custom, GPU-driven WebGPU renderer in TypeScript + WGSL (`apps/game/src/gfx/`), running on the **main thread** on the page's canvas; the GPU worker and OffscreenCanvas of v1.0 weren't built (ARCHITECTURE §2). The Matter GPU backend shares its `GPUDevice` (D92). Its default look matches the warm Tinker Lab key art, not the look-dev cyc ([D79](dev/DECISIONS_2026-10-24.md)): per-part texture sets with a detail layer, probe GI, GTAO, SDF contact shadows, set IBLs, sun light shafts, a tilt-shift depth of field in Build and Run, a warm grade, vignette and grain. The look landed in M3 and passed the side-by-side review ([M3_D79_REVIEW.md](dev/M3_D79_REVIEW.md)).

## 0. As built (M5 docs pass)

Sections 1–13 are the design. This table says where the code differs; the code paths are under `apps/game/src/gfx/`.

| § | As built |
|---|---|
| 2 gpu-core | `gpu.ts` creates the device with the adapter's max limits and the optional features (incl. `texture-compression-bc`, M4) and times passes with timestamp queries. There's **no render-graph compiler, transient aliasing, `BufferArena`, `TexArrayPool` or staging/readback rings**: `renderer.ts` records its passes in a fixed order, and each module owns its buffers. WGSL lives in TypeScript strings (`shaders.ts`, `look/wgsl.ts`, …) spliced at markers, with no `#include` preprocessor. Every allocation goes through the V4 ledger (`vram.ts`). |
| 3 Frame graph | Order as built: key-light shadow maps (near, then far: beta polish, D125) → look half-res depth prepass → AO / contact / GI irradiance (`look/ao.ts`) → froxel fog (`look/fog.ts`) → main pass (parts, skinned critters, impostors, Matter grains, environment) → water and glass (transmission) → volumes, particles, beams, arcs, debris → TAA resolve + shock refraction (`taa.ts`) → post (`post.ts`). Culling is one compute pass (frustum + LOD + impostor select into per-(mesh, LOD) buckets); **no Hi-Z two-phase occlusion** and no visibility/ID buffer. |
| 4 Scene | The vertex is **32 B** (normal snorm16, unorm16 UV; D69), not ~36 B. Moving sub-parts are separate sim bodies or `armPivots` splits (`glbmesh.ts`), not per-vertex pivot indices. Critters skin on the GPU from CPU-evaluated bone matrices (`skin.ts`). Part shape keys drive six part types (`partmorph.ts`). During a run the sim's transforms are uploaded as-is (7 floats per body) and resolved on the GPU. |
| 5 Culling | Frustum + LOD on the GPU; octahedral impostors (8 × 8 views) in Arena and Megastructure (`impostor.ts`, S3; under ~24 px until the polish pass, under 8 px since). No Hi-Z, no compact small-instance format. *Beta polish (D125):* the same compute pass culls up to four views: the camera, the near and far shadow cascades, and the shadowed practical (§6.3). Every view now sizes instances by their mesh's own LOD0 bounding sphere (`MeshEntry` radius and centre × size). Before, `inst.radius` was 0.5 × \|size\|, which assumes a unit mesh: 0.87 m for every art part. Impostors switch in under 8 px across (§5). |
| 6.2 Lights | Clustered forward+ 16 × 9 × 24, **≤ 64 lights per cluster**, `MAX_LIGHTS` 1,024 (`shaders.ts`). Set practicals are look spots (≤ 8 per set, one shadowed from 12 GB), not clustered lights. |
| 6.3 Shadows | **Two key-light cascades for parts** (beta polish, D125; below) plus a **cached static set shadow** (1,024–4,096² by tier, re-rendered only when the set changes: D81 win-back 2; `look/tiers.ts`). Until the polish pass this was one stabilised map (2,048², 4,096² from 12 GB), up to 300 m across. No 4-cascade CSM and no local-light shadow atlas. SDF contact shadows from 12 GB. |
| 7 GI | `gi.ts`: a global SDF clipmap (4 levels, level 0 = 8 m, ×4 per level; 64³–128³ cells, **256³ on 32 GB**) stamped from instances' oriented boxes and the set's colliders (`Gi.setStatic`, D90), stored as rgba8 (distance + albedo). Probes 16 × 8 × 16 per level (**32 × 16 × 32 on 32 GB**), 128 rays, irradiance as **L1 SH** (not octahedral irradiance + visibility), multi-bounce only on 32 GB. Tiers in `GI_TIERS`: SDF from 8 GB, probes from 12 GB. Per-part baked SDFs aren't used. |
| 8 Spectacle | Particles: one pooled ring, 1M / 4M / 8M / 16M / 32M by tier (`renderer.ts`, `particles.ts`); **no WBOIT and no hero smoke sort**. Volumes: `volume.ts` (`VOLUME_TIERS`, 8 × 192³ on 32 GB). Debris: `debris.ts` (`DEBRIS_CAP`, 500k at 16 GB). Shock rings: `shockwave.ts`. Beams: `beams.ts` ribbons with dust motes (no froxel in-scattering). Arcs are built on the CPU (≤ 32 bolts × 256 segments), not in a compute pass. Matter surfaces: `gfx/matter/` (sand / marble impostors with GLINT / BEARING meshes near the camera, SSFR water, which casts shadows from M5 (its top layers, depth-only: no translucency or caustics), the fill pass for containers incl. GOO VAT) and **goo** (M5, X5): kind 3 rides the water passes (its thickness in a third channel of the now `rgba16float` thickness target) and composites as `kn_slime` (green albedo, Beer–Lambert transmission, a wrapped-light subsurface glow, a glossy skin), not metaballs; goo casts shadows. The Kitchen **wetness mask** (M5, `wetness.ts`): a 256² top-down grid splatted from the live water grains, read by the part shader and floor (albedo −15 %, roughness −0.3 under the wet line), drying over 40 s. The M5 Future Tech effects are in `gfx/future/` (below). **Not built (post-beta, D107):** clustered projected decals (splats and stains are flat decals), rope verlet visuals. |
| 9 Post | TAA upscaler (`taa.ts`, M3) at a tier internal resolution (16 GB: 1296p for 4K; 32 GB: ≥ 1800p; D81, D85), 4× MSAA at internal resolution; no motion vectors yet (a reactive term covers moving parts). Bloom, tilt-shift DOF, PBR Neutral, LUT, vignette, grain and the flash limiter (`fx.ts`, `taa.ts` luminance meter) are built; **per-object motion blur and SSR are not**. AgX is used only by the look-dev sets (`look/sets.ts`). |
| 10 Overlays | **Picking is on the CPU**: the pointer ray against every part's oriented bounds (`main.ts`), not an ID-buffer readback. Selection outlines come from a screen-space mask (`post.ts`). X-ray, section box and cutaway are in the part shader. |
| 11 VRAM | As built (V4) is in §11. The tier list includes **32 GB** (`TIER_BUDGET` ≈ 22 GB). |
| 12 Budgets | Resolved by D81 and measured in M3: the full look costs +0.63 ms at 16 GB and +1.85 ms at 32 GB (M3_NOTES_L3); Kiloton plays back at 4.0 ms and Domino Day at 1.0 ms per frame at 4K on 16 GB (M3_STATUS). There's no nightly perf CI on reference GPUs; the benchmark harness is `apps/game/bench/`. |
| 13 Capture | As built (C4) is in §13. |

**M5 (stream R5, as built; [M5_NOTES_R5](dev/M5_NOTES_R5.md)):**
- **Future Tech effects** (vfx.md §7, `gfx/future/index.ts` + `wgsl.ts`, one RenderHook): field quads, boxes and cones in the late pass after glass; screen-space warps (lens, shimmer, column, ripple, rift glimpse) against an r32float depth resolve, only when a warp is on screen; particles on the shared pool (mote, glint, disk, infall, sparkle kinds). SINGULARITY: a point-mass lens with a black core, photon ring, accretion disk and infall streams, bodies within 1 m stretched (render only), the collapse flash through the flash limiter. RIFT GATES: a swirl membrane, transit ripples, and a screen-space **glimpse** through the partner gate (0 / 0 / 1 / 2 / 4 pairs on tiers 4 / 8 / 12 / 16 / 32; on-screen content only). STASIS FIELD: a hex lattice, and the "time-stopped" look on bodies inside (desaturated, cool tint, dashed rim). TRACTOR BEAM, HOVER PAD (a shimmer column from 8 GB), FORCE WALL (a hex plane with impact ripples), COILGUN RING, GRAV WELL. Warps are off on 4 GB; reduced motion cuts distortion to 30 %. Measured +0.18–0.31 ms at 16 GB and +0.41–0.48 ms at 32 GB with all ten parts (provisional). Buffers are in the VRAM ledger's `spectacle` pool and rebuilt after device loss.
- **M4 render polish:** non-1-scale dark patches fixed (the GI stamps a rounded box per mesh, `MeshInfo.round`); DUSTY's and BUZZ's LED faces draw the 12 icons from `faceTracks` (`screens.ts`, `shaders.ts` `screenIcon`); TOAST CANNON's slices node hides after launch (`glbmesh.ts` `STATE_NODES`); GUTTER in play uses its texture set (`gutter.ts`); water shadows; the Kitchen wetness mask.
- **BUZZ:** LED groups from the glb's `led` vertex colour (`gfx/leds.ts`), real rotor spin with blur discs above 20 rps, the winch tether from the sim's payout.
- **GRABBER and resizable parts:** the arm's links, turret and fingers draw from `Machine.grabberJoints()` (keyframed); FORCE WALL pylons and STASIS FIELD nodes follow their size props (`resize.ts`).
- **Environments (M5, W5 / E5c):** the Orbital Hangar (one glb per bay, per-bay IBL) and Moon Base sets with their looks (`gfx/environment.ts`, `look/sets.ts`, stand-ins in `look/space.ts`), set practicals (≤ 8), the Moon's "Base lights" toggle, the Hangar's zero-g rings (solid plasma solo, dashed white with glyphs in multiplayer, dimmed with zones off), and the environment texture set (the Earth, `<id>.env.json → textures`; baked and fixed in M5, D112; runtime-lit and spinning since the beta polish, D126, below).
- **Not built:** froxel injection for the tractor cone, a ghost smear on rift transit.

**Beta polish (stream RENDER, D125–D126; [BETA_NOTES_RENDER](dev/BETA_NOTES_RENDER.md)):**
- **Key-light shadows** (`gfx/shadowfit.ts`, `renderer.ts`):
  - **Near map** (`frame.shadowMat`, binding 4: what Matter, debris and fog read): the focus box (0.9 × the focus distance, at most 160 m across), shrunk to the scene's light-space bounds.
  - **Far map** (`frame.shadowFar`, binding 13, half resolution): the camera frustum up to the shadow distance (3 × focus distance + 30 m, 60–1,500 m) ∩ the scene. Part shadows fade over its last 20 %. Skipped when the near map holds the whole view.
  - **Stability:** extents on a 2^(1/8) ladder, centres snapped to whole texels.
  - **Scene bounds:** from the instances at `setScene`; in run mode, grown by up to 32k bodies per frame.
  - **Shading:** the part shader (`keyShadow`) blends near → far over the near map's outer 6 %; terrain samples both.
  - **Casters per cascade, on the GPU:**
    - one LOD coarser than the camera (the far map: the coarsest);
    - the mesh's LOD0 box (`vs_shadow_box`) under 5 px on screen or 1.5 / 3 texels in that map;
    - nothing under ½ px or ⅓ texel;
    - nothing whose shadow, swept along the light, can't reach the view.
  - **Matter and debris** draw into the near map only.
  - **Measured:** whole-world shadow pass 15.2 → 6.0 ms (12 GB Arena), 19.7 → 6.8 ms (32 GB Megastructure). `renderer.shadowFit = false` restores M5's map for comparisons.
- **The shadowed practical's casters** are a cull view of their own (`views.spot`), sized in the lamp map's texels and drawn indirect. There's no CPU cone test (it was 7.4–8 ms at 400k parts) and no 4,096-caster cap.
- **The gizmo stays sharp:** top overlay items also draw their coverage at output size (`gizmo.sharp`), and post keeps fog and DOF off under it (§10).
- **The backdrop Earth** (D126, lifts D112's no-spin):
  - Its own overlay mesh, centred on the planet, drawn by `fs_earth` from ART's input maps (D128: albedo, ORM = clouds / night lights / water).
  - It turns `degPerMinute` about `spinAxis` on the wall clock.
  - E5c's bake terms are recomputed from the set's sun: terminator, sunset band, cloud shadows, night side, city lights, glint, limb glow. The Hangar's 105° phase comes from the env data's `phaseDeg`.
- **Set detail by distance:** the Moon's solar arrays draw the glb's gap-less LOD2 once an 8 cm gap is under ¾ px. It drops the backplate, which z-fought past 150 m, and is tinted to the module mean (`gfx/setpieces.ts`). `SceneItem.lod` picks an overlay item's LOD.

---

## 1. Constraints we design around

| WebGPU reality | Our answer |
|---|---|
| No bindless textures | **2D texture arrays per size class and map** (1024², 2048², 4096² × albedo, normal, ORM), with the material table holding layer indices |
| No core multi-draw-indirect | **One `drawIndexedIndirect` per (mesh, LOD) bucket** (~600 buckets). Use MDI when the browser exposes it |
| No mesh shaders | Compute culling + compaction, then indirect draws |
| No hardware ray tracing | **SDF-based** GI, AO, soft shadows (software tracing) |
| No VRAM query | Probe-allocate, tiers, user override (§11) |
| Per-binding size limits | No buffer > 1 GiB. Large pools are chunked |
| Device loss happens | Every GPU resource can be rebuilt from CPU-side state (ARCHITECTURE §8) |

---

## 2. gpu-core

- **Device creation:** request the adapter with `powerPreference: 'high-performance'`, then the device with the adapter's **max limits** for: `maxBufferSize`, `maxStorageBufferBindingSize`, `maxStorageBuffersPerShaderStage`, `maxComputeWorkgroupStorageSize`, `maxComputeInvocationsPerWorkgroup`, `maxTextureArrayLayers`, `maxColorAttachmentBytesPerSample`.
- **Optional features:** `shader-f16`, `subgroups`, `timestamp-query`, `texture-compression-bc`, `texture-compression-astc`, `float32-filterable`, `indirect-first-instance`, `rg11b10ufloat-renderable`.
- **Pools:**
  - `BufferArena` (sub-allocated, 256 B aligned, free-list per size class);
  - `TexArrayPool` (layers per size class with an LRU for streamed mips);
  - `StagingRing` (mapped upload buffers, 64 MB);
  - `ReadbackRing` (picking, Matter impulses, checksums).
- **Render graph** (§3): passes declare reads and writes. The compiler orders them, inserts no barriers (WebGPU handles that), and **aliases transient textures** with non-overlapping lifetimes.
- **Profiling:** timestamp queries per pass (when available), resolved to the Perf HUD and `statsBlock`.
  - *As built (`GpuTimer`, `gfx/gpu.ts`; G5, M5):* each frame resolves into its own query region (one per readback buffer, at most 3 frames in flight; a 4th frame goes untimed). A pair counts only when it's newer than that region's largest earlier timestamp, because a slot a pass asked for but didn't write still holds an older frame's stamps (D3D12 keeps the query heap). Callers ask for timestamp writes only when they encode the pass.
  - `timer.ms` is the smoothed time per pass; a name unseen for 30 resolved frames drops out. `timer.total()` sums only the last resolved frame's passes. `timer.frameMs` is the smoothed GPU frame span (first timed pass begin → last end, so untimed work between passes counts).
  - Matter's draws are timed inside `shadow`, `look.pre` and `main`; its own passes are `matter.prep` and `matter.water.*`. Solver ticks are separate submissions and aren't timed.
  - Before G5, an unwritten slot could read 5–14 ms of phantom time, and the governors over-read Matter scenes (8 GB Moon: 29.9 ms against a 20.2 ms frame). Now `frameMs` and `total()` are within ≈ 1 % of frame throughput (two frames in flight) with Matter on or off. M5_NOTES_G5 has the numbers.
- **Shader system:** WGSL modules with a build-time `#include` preprocessor. Permutations via **override constants** (feature bits) wherever possible to avoid pipeline explosion. Pipelines are compiled async at load (`createRenderPipelineAsync`), with a warm-up list per tier. Dev hot reload.

---

## 3. Frame graph (in order)

| # | Pass | Type | Reads → writes |
|---|---|---|---|
| 1 | Upload | copy | staging → instance, keyframe, LED, pivot, decal, light buffers |
| 2 | Playback resolve | compute | keyframe store / xform ring → instance transforms (interpolated) and previous transforms |
| 3 | Skinning | compute | critter poses → skinned vertex buffers |
| 4 | Spectacle simulate | compute | particles, debris, fluid grids, arcs (dt = frame) |
| 5 | Matter (when commanded) | compute | Matter kernels (SIMULATION §8), not tied to the frame |
| 6 | Cull phase 1 | compute | instances × previous HiZ → visible lists, LOD/impostor selection, indirect args |
| 7 | Depth prepass (phase 1) | render | visible-last-frame opaque → depth, velocity, IDs (visibility) |
| 8 | HiZ build | compute | depth → HiZ pyramid |
| 9 | Cull phase 2 | compute | rejected instances × new HiZ → newly visible lists |
| 10 | Depth prepass (phase 2) | render | newly visible → depth, velocity, IDs |
| 11 | Shadows | render | CSM 4 cascades + local atlas (cached for static casters, §6.3); SDF contact shadows are traced in pass 14 |
| 12 | Light and decal clustering | compute | lights, decals → froxel lists |
| 13 | GI update | compute | global SDF clipmap updates → probe tracing → irradiance (budgeted, §7) |
| 14 | AO / SSR / contact shadows | compute | depth, normal, HiZ, global SDF → GTAO (SSAO on 4 GB), SDF contact shadows (12 GB and up), reflections |
| 15 | Opaque shading | render | forward+ with clusters; per-part texture-array sets + the detail layer (§6.1), GI, AO, set IBL → HDR colour |
| 16 | Matter surfaces | render/compute | screen-space fluid, grains, slime |
| 17 | Transmission | render | poly/glass shells, sorted back-to-front, sampling a mip-chained opaque colour copy |
| 18 | Volumetrics | compute | froxel fog with sun light shafts (shadowed sun sampled per froxel; 12 GB and up) + raymarch of fluid grids (half res) → composite |
| 19 | Particles / OIT | render | WBOIT accumulation (sparks, smoke, confetti), then resolve; hero smoke sorted |
| 20 | Editor and presence overlays | render | grid, work plane, gizmos, X-ray flows, ghosts, partner drones and lasers, selection outlines |
| 21 | TAA upscale | compute | HDR + velocity + history → output resolution |
| 22 | Post | compute | bloom, motion blur, DOF (tilt-shift in Build/Run, full in photo), lensing, tonemap, warm LUT, vignette, grain, **flash limiter** (§9) |
| 23 | UI composite | render | in-canvas UI elements (labels, emote bubbles) → swapchain |

The DOM's glass panels (UI_UX §2) are blurred by the browser compositor after this graph, from the swapchain image. That cost is outside these passes and is budgeted in UI_UX §8.

---

## 4. Scene representation

### 4.1 Geometry
- **One global vertex buffer and one index buffer per vertex format** (static PBR, skinned, impostor). Every mesh LOD is a range (`firstIndex`, `baseVertex`), which enables bucketed indirect draws.
- Vertex format (static): position f32×3, normal oct16, tangent oct16 + sign, uv0 unorm16×2, uv1 unorm16×2, **pivot u8**, **led u8**, color unorm8×4. ~36 B.
- **Pivots without sub-instances:** each vertex stores its pivot index (0 = root). Per instance, a `pivotPose` buffer slice holds up to 8 local transforms (quat + translation, f16). The vertex shader composes them (hierarchy is depth-first, ≤ 3 levels). So a Motor with a spinning armature is still **one instance**.
- Skinned critters use compute skinning into a per-instance vertex range. ≤ 64 skinned instances per frame (critters only).
- **Morph targets** (Blender shape keys: Helio inflate, Puffer squeeze, Sponge, Sprong mat, Big Top iris, critter faces) are applied in the same compute pass into the instance's vertex range. A part may have at most 4 active morphs; weights come from the sim's visual state (PART_SYSTEM §5). Critter face keys (~20 authored, GAME_SPEC §19.4) are driven by the renderer's animation state from the clip hint, also ≤ 4 active at once. Instances with all weights at 0 skip the pass and use the shared mesh.

### 4.2 Instance buffer (structure of arrays)
`transform` (f32 3×4) · `prevTransform` · `meshId` (u16) · `materialSetId` (u16) · `flags` (mirror, selected-by, hidden, ghost, xray) · `ledState` (16 groups × 4 bits) · `portLedState` (16 ports × 4 bits) · `pivotPoseOffset` · `boundsRadius` · `lodBias`. ~128 B per instance → 1M instances ≈ 128 MB.

### 4.3 Camera-relative rendering
World positions are f32, so transforms are uploaded **relative to the camera** each frame (f64 camera origin on the CPU, rebased in the playback-resolve pass). Precision is sub-millimetre at 1 km (GAME_SPEC §5.1).

---

## 5. GPU-driven culling and LOD
- **Phase 1** tests every instance against the frustum and **last frame's HiZ** (reprojected). It selects the LOD by projected sphere size (thresholds per class, × tier bias) and switches to an **octahedral impostor** when the projected size is < 24 px (Arena and Megastructure only).
- Survivors are compacted into per-(mesh, LOD) lists with a prefix sum (subgroup operations when available), and indirect args are written.
- **Phase 2** retests the phase-1 rejects against the fresh HiZ (two-pass occlusion culling, no popping).
- Small-instance fast path: Topple Tiles, Brik, Pins, Stackers and marbles use dedicated buckets with a compact instance format (pos + quat + material index, 32 B).
- **Budget:** 1M instances culled in ≤ 0.6 ms on the 16 GB tier.
- *As built (beta polish, D125, [BETA_NOTES_RENDER](dev/BETA_NOTES_RENDER.md) §6):*
  - **Real sizes:** LOD and impostor selection use each instance's real projected size: its mesh's LOD0 bounding radius × its largest scale. The frustum test uses the larger of that sphere (about the mesh centre) and `inst.radius`.
    - Until the polish pass every art part counted as 0.87 m across (`inst.radius` = 0.5 × \|size\| assumes a unit mesh). LOD1 started ≈ 4× too far away, and impostors appeared at the wrong size.
  - **Thresholds,** unchanged from the art pipeline (fractions of the half-height): LOD1 below 0.05 (36 px radius at 1440p), LOD2 below 0.012 (≈ 9 px).
  - **Impostors:** below 8 px across, capped there under the preset's 24 px ceiling (`IMPOSTOR_MAX_PX`, `renderer.ts`). At 24 px their nearest-of-64-views orientation snapping showed.
  - **Impostor bake:** textured materials now bake their texture set's albedo (they used to bake the glTF base colour, so textured parts came out dark), and the bake re-runs when the sets change. The impostor's lighting is re-matched to the meshes (× 1.65).
  - **Measured:** the 12 GB Arena preset main pass went 14.6 → 6.8 ms (frame 22.9 → 13.3 ms). The dolly and the switch-by-switch checks (`docs/dev/beta_render/lod_dolly/`) show no visible pops.
  - **Debug:** `renderer.lodByMesh = false` (bench `&lodmesh=0`) restores M5's sizing.

---

## 6. Materials, lighting and shadows

### 6.1 Uber material
- One PBR shader with feature bits: `COAT`, `TRANSMISSION`, `SHEEN`, `ANISO`, `EMISSIVE_LED`, `SCREEN`, `DECAL_ATLAS`, `PART_SET`, `DETAIL_LAYER` (replaces `DETAIL_NORMAL`), `WOOD_PROC` (look-dev fallback for parts still without a set), `FUR_SHELL` (critter shell fur, on the 12 GB tier and up; lower tiers use the fur master's base layer). *As built:* the part shader has no feature-bit permutations; the texel kind in the vertex material byte selects instance, master, decal or screen (D69), and texture sets, the detail layer and the procedural wood come from the look pass. Shell fur, `ANISO` and `SHEEN` aren't implemented.
- The material table (storage buffer) holds the **master material** parameters (ASSET_PIPELINE §5.1) plus, per part and slot, the texture set's layer indices, the detail map id and its tile size.
- **Per-part texture sets** (`PART_SET`, [D78](dev/DECISIONS_2026-10-24.md), ASSET_PIPELINE §5.2): albedo, normal and ORM are sampled from three arrays per size class (1024², 2048², 4096²; albedo sRGB, normal and ORM linear; BC7 on desktop, ASTC on Apple). The set gives final albedo, normal and ORM; the master keeps coat, sheen, transmission, IOR and anisotropy. Each array holds at most `maxTextureArrayLayers` layers (256 guaranteed); beyond that the pool opens a second array of the same class.
- **Detail layer** (`DETAIL_LAYER`, [D79](dev/DECISIONS_2026-10-24.md)): a tiling detail normal + roughness from a shared 1024² array (`kn_detail_*`: wood grain, paint orange-peel, cast-iron pitting, brushed metal, paper tooth, knurl, twist), chosen per master, in UV2 or object-space triplanar. It fades in close to the camera: full strength within 1 m of the shaded point, gone beyond 4 m, so it costs nothing in wide shots.
- **LEDs:** `kn_led` faces read `ledState[instance][group]` (from the vertex `led` index) → channel colour × state curve (ART_BIBLE §5). Part LED groups are 0–15 (ASSET_PIPELINE §3.6). Port-ring LEDs are separate: the linked ring's `kn_led` faces read `portLedState[instance][portIndex]`, which the engine derives from channel activity.
- **Screens:** `kn_screen` samples a shared **screen atlas** (2048², 256 slots) that a compute pass draws each frame for visible screens (7-seg, bars, icons). M1 draws its one screen kind (bar meters) procedurally in the part shader; the atlas lands with the 7-seg, icon and text screens in M2 ([D69](dev/DECISIONS_2026-10-24.md)).
- **Decals** (labels and pictograms) come from the decal atlas via UV1 on decal geometry. Projected decals (scorch, splat) come from clustered decals.

### 6.2 Lights
- Clustered forward+: froxel grid 16×9×24 (logarithmic depth), max 256 lights per cluster, global caps by tier: 1,024 / 2,048 / 4,096 / 4,096 lights (8 / 16 / 24 / 32 shadowed) on the 4 / 8 / 12 / 16 GB tiers (GAME_SPEC §13 sets the 16 GB values; the rest are in art/briefs/vfx.md §0.1).
- **IBL** per environment, **baked from each set**: prefiltered specular cube (256², 8 mips) + SH9 diffuse. The Studio uses a softbox IBL (`ibl_studio_light` / `ibl_studio_dark`) baked by `tools/blender` from the look-dev rig, so it matches the Cycles reference exactly (art/briefs/environments.md §1.4, ART_BIBLE §10). The Tinker Lab's `ibl_tinker_lab` is baked the same way from its set and golden-hour rig (environments.md §3.4).
- **Practical lamps** (pendants, window sky cards) are clustered lights with an emissive bulb mesh; their bloom comes from the post bloom, not a sprite.

### 6.3 Shadows
- **Sun/key:** 4-cascade CSM, 4,096² each (16 GB tier), stabilised, with **cached static cascades**: static casters are re-rendered only when the doc changes, and dynamic casters are composited each frame.
- **Local lights:** an 8,192² atlas, up to 32 shadowed lights, prioritised by screen contribution (explosion flashes get priority for 0.3 s).
- **Contact hardening and SDF contact shadows:** SDF soft shadows for the key light within 2 m of the camera focus, and short SDF contact shadows under parts resting on surfaces (12 GB tier and up, D79).

---

## 7. Global illumination (SDF)
- **Per-part SDFs** (baked, ASSET_PIPELINE §8) are stamped into a **global SDF clipmap** (4 levels × 256³ r16f, level 0 = 8 m extent, ×4 per level).
  - Static instances are stamped when the doc changes, incrementally per dirty 8³ brick.
  - Moving instances are re-stamped each frame within a budget (≤ 512 bodies per frame, prioritised by screen size and velocity), with conservative dilation.
- **Probe GI (DDGI-style):** per level, a 16×8×16 probe grid. Rays are sphere-traced against the clipmap (128 rays per probe per update, ¼ of the probes updated per frame). Each probe stores octahedral irradiance (8×8) + visibility (16×16), with hysteresis 0.97.
- **Emissive bursts** (explosions, fireworks) inject into probes through the light list, so a blast lights up the room within a few frames.
- **Defaults by tier** ([D79](dev/DECISIONS_2026-10-24.md)): probe GI is on by default from 12 GB up, and GTAO (screen-space, pass 14) runs on every tier except 4 GB, which keeps SSAO.

| | 4 GB | 8 GB | 12 GB | 16 GB | 32 GB (D85) |
|---|---|---|---|---|---|
| Screen-space AO | SSAO | GTAO | GTAO | GTAO | GTAO (4 slices × 8 steps) |
| SDF AO | — | on | on | on | on |
| Probe GI | — | — | on, half rate | on, full rate | full rate, multi-bounce, 256³ SDF, 32 × 16 × 32 probes |
| SDF contact shadows | — | — | on | on | on |
| Set IBL | on | on | on | on | on |

As built: `GI_TIERS` (`gi.ts`) and `LOOK_TIERS` (`look/tiers.ts`) hold these per tier.

---

## 8. Spectacle implementations
Spawned from the sim event stream. Budgets per tier come from GAME_SPEC §13/§15 and [art/briefs/vfx.md](art/briefs/vfx.md).

| System | Implementation |
|---|---|
| **Particle engine** | Single pool. Structure of arrays (pos f32×3, vel f16×3, age/life f16, size f16, rot f16, colour/temperature u32, type u8, flags u8). Emit (from the event buffer via an emitter table) → simulate (gravity, drag × air, curl noise from a 3D noise texture, buoyancy by temperature, collision vs depth buffer + global SDF) → compact (prefix sum) → draw indirect (velocity-stretched quads for sparks, soft quads for smoke, oriented quads for confetti) |
| **Volumetric fire and smoke** | Pooled 3D grids (stable fluids: semi-Lagrangian advection (MacCormack on the 12 GB tier and up), vorticity confinement, buoyancy, 20–40 Jacobi pressure iterations). Density, temperature, fuel, velocity in f16. Raymarched at half res with blue-noise jitter + temporal reprojection. Blackbody emission ramp. Self-shadow via a light-direction density march (8 steps) |
| **Debris chunklets** | Instanced shards from the debris library. Sphere-proxy rigid-lite integration, collision vs global SDF + floor. Sleep, then fade or persist. Never touch gameplay bodies |
| **Decals** | Clustered projected decals (box projection), atlas-based, fade policy per type; persist until Stop |
| **Arcs** | A compute pass generates branching polylines (midpoint displacement, 5 levels), re-randomised at 30 Hz, drawn as camera-facing ribbons with an HDR core and glow |
| **Beams** | Cylinder ribbons for Lance and Torch beams with froxel-fog in-scattering ("dust motes" as particles inside the beam) |
| **Matter surfaces** | Water: point-splat depth → bilateral smoothing → normal reconstruction → refraction + foam from velocity divergence. Sand and marbles: instanced impostor spheres (marbles: real mesh at LOD0 near the camera). Slime: metaball field to screen-space surface |
| **Lensing** | Singularity: screen-space distortion with an Einstein-ring term + accretion-disk particles |
| **Shock ring** | An expanding ground-projected ring decal + screen-space refraction shell |
| **Rope and cable visuals** | GPU verlet (32 nodes per span) for slack sag and cut-end flailing. Taut spans render straight from sim endpoints |

---

## 9. Post and comfort
- **TAA upscaler:** FSR 2-style temporal upscaling (MIT reference algorithm, reimplemented in WGSL): reactive mask for particles and transparency, motion-vector dilation, lanczos upsample. Internal resolution by tier (16 GB: 1440p → 4K). Lands in M3; until then the main pass renders at native resolution with 4× MSAA ([D60](dev/DECISIONS_2026-10-24.md)).
- **Bloom:** 6-level dual-filter; in the warm sets the practical lamps, LEDs and port rings are its main sources. **Motion blur:** per-object velocity, tile max (12 GB tier and up).
- **Depth of field** ([D79](dev/DECISIONS_2026-10-24.md)), two modes:
  - **Tilt-shift** (Build and Run, on by default from 8 GB up): a gentle blur so the background goes soft. Focus is the selection or the cursor's hit point in Build and the director's target (the run's action) in Run, eased over 0.4 s. The in-focus band is ±35 % of the focus distance, and the blur radius is capped at 6 px at 1440p internal (scaled with resolution). Half-res gather. Off with Reduce motion; switchable in Settings › Graphics.
  - **Photo:** the full aperture model, in photo mode and director punch-ins.
- **Light shafts:** froxel fog lit by the shadowed sun (pass 18), so windows throw visible shafts; 12 GB and up. Lower tiers keep a uniform haze.
- **Tonemap:** **Khronos PBR Neutral** (default; preserves brand colours, ART_BIBLE §10). AgX in photo mode. Then the per-environment **warm grading LUT** (32³; `lut_tinker_lab`, `lut_kitchen_*`; the Studio's is neutral), a soft **vignette** (strength 0.15) and fine **film grain** (blue-noise, 0.02), all tiers.

| Look feature (D79) | 4 GB | 8 GB | 12 GB | 16 GB | 32 GB (D85) |
|---|---|---|---|---|---|
| Texture sets + detail layer | on (1024² sets) | on (1024²) | on (2048²) | on (2048²) | on (2048²) |
| LUT, vignette, grain | on | on | on | on | on |
| Tilt-shift DOF (Build/Run) | — | on (¼ res) | on (¼ res) | on (¼ res) | on (½ res) |
| Light shafts | — | — | on | on (half-res froxels) | on (full res) |
| Probe GI | — | — | half rate | full rate | full rate, multi-bounce |

Lower tiers and the live governor (§11) drop the look in D79's order: **light shafts first, then DOF, then GI**.
- **Flash limiter** ("Reduce flashing", on by default; ≤ 3 large flashes per rolling second, GAME_SPEC §20). With it on, flash peaks are capped at +0.6 EV (+1.5 EV off); flash colour is always clipped at `#FFF4E0`. Two layers enforce the one rule (art/briefs/vfx.md §0.3):
  1. **Event layer:** every exposure flash, and every light or emissive event covering > 25 % of the screen, is tagged *large* at spawn. A 4th tagged flash inside the rolling second merges into the running one (it extends the decay, with no new peak).
  2. **Measured layer** (the safety net): tracks frame-average luminance. If it rises by > 2.5× within 100 ms more than 3 times per second, exposure is temporarily clamped, so the boom stays and the strobe goes. Any event that trips this layer counts as large even if it wasn't tagged.
- **Hitstop and slow-mo** are playback-clock effects (wall clock only), handled in pass 2.

---

## 10. Editor and multiplayer overlays
- **Grid:** analytic infinite grid on the work plane, with the adaptive step (GAME_SPEC §5.2). The plane slab is a soft glow.
- **Ghosts:** the instance flag `ghost` renders translucent in the player colour (beam = P1, plasma = P2) with a pulsing edge, and red when blocked.
- *As built (D117):* drag-to-move and gizmo gestures preview the moved parts as these ghosts, through the per-frame overlay. The build scene isn't rebuilt while dragging (one rebuild at most, when the soft locks outline the held parts).
  - Links and ports follow, because `main.ts` `poseOf` returns the preview poses.
  - The **gizmo** is overlay items flagged `SceneItem.top`. They're drawn last in the late pass by the `top` pipeline (`fs_top`: flat key light and rim, premultiplied, depth compare *always*), in list order, so parts never hide it. The section box, cutaway and X-ray dimming don't touch it.
  - Cost: measured +0.003 ms on the late pass at 16 GB, RTX 5090.
  - *Beta polish (D125):* after TAA, the top items also draw their coverage into `gizmo.sharp` (output size, r8unorm, un-jittered). Post's composite skips fog and DOF there, and DOF's prep zeroes the CoC there, so the gizmo is never softened or spread into the background. This pass runs only while the gizmo is up.
- **Selection outlines:** jump-flood outlines from the ID buffer, coloured by the selecting player.
- **X-ray:** desaturate + darken the scene, then draw channel flows as instanced ribbons with glyph sprites and animated dashes (data from the sim worker's channel graph snapshot).
- **Partner presence:** drone mesh (ui_icons brief) at the interpolated partner camera + a laser beam to their cursor + a name label (SDF text).
- **Picking:** the ID buffer (`r32uint` instance id + `r8uint` sub-part) is read back asynchronously (1-frame latency). Precise snapping queries go to the sim worker instead (ARCHITECTURE §6.4). *As built:* neither. Picking and snapping are main-thread maths: the pointer ray against every part's oriented bounds, then the terrain and the floor (`main.ts` `pick()`, `ui/terrainpick.ts`).

---

## 11. VRAM management and tiers
- **Probe-allocate at boot:** allocate pools in priority order (render targets → core arrays → instances → particles → GI → keyframes → Matter). After each step, verify with a tiny write/read and watch for `device.lost` or validation errors. Stop at the first failure, roll back one step, and pick the tier that fits.
- **As built (M4, stream V4, `gfx/vram.ts`):**
  - **Ledger:** a ledger wraps buffer and texture creation on the renderer device, so every allocation is sized and attributed to a pool. Label Matter allocations `matter.*`.
  - **Boot probe:** the probe allocates the later pools in chunks with timed touches. It stops on out-of-memory, a failed read-back or a bandwidth collapse (paging). It's on in builds, and opt-in on the dev server with `?vramprobe=1`.
  - **Pressure governor:** triggered by out-of-memory errors, device loss, a short probe, ≥ 3 stall frames in 3 s, or a sustained slowdown where GPU time grew too. It steps down volume slots ½ → GI half resolution → 2048² textures to 1024² → volumes ¼ → GI off → volumes off. It restores one level after 20 s quiet.
  - **Device loss:** the renderer rebuilds itself on a new device and replays texture sets, the environment look and GI state. Subscribers re-create their resources via `renderer.onRestore` (Matter: from the MATR CPU copy).
  - **Readout:** the debug perf readout shows the ledger, the governor level and recoveries.
- **Pool budgets** follow GAME_SPEC §15.1 (16 GB tier ≈ 10.4 GB resident; 2.8 / 5.5 / 8 GB on the 4 / 8 / 12 GB tiers, ≈ 22 GB on the 32 GB tier, §15.2; `TIER_BUDGET` in `vram.ts`). The probe also reserves room for the Matter pools and a `keyframes` pool (`RESERVE`). The Matter reservation is the measured `matter` pool at each tier's grain budget plus 5 % (G5, M5): 208 MB / 498 MB / 889 MB / 1.63 GB / 3.12 GB for 4 / 8 / 12 / 16 / 32 GB. That pool holds the backend, its playback replica and the renderer's draw lists. Bake-ahead keyframes actually live in the sim worker's memory (ARCHITECTURE §5), so the keyframes reservation is headroom.
- **Tier names:** this doc uses the GB names (4 / 8 / 12 / 16 / 32 GB). Art and VFX docs use the aliases Low / Medium / High / Ultra / Max for the same five tiers (art/briefs/vfx.md §0.1, D85).
- **Streaming as built:** texture sets load whole on first use (KTX2 / BC7 from `assets/build`, or PNG plus a small GPU BC7 encoder at load, D97), into the size-class arrays the tier allows (1024² on 4 and 8 GB, 2048² above; `look/tiers.ts`); the governor can drop 2048² sets to 1024². No per-mip LRU and no 32 m environment chunks.
- **Streaming:** texture-array layers stream mips on demand (LRU by last-visible frame). Environments stream in 32 m chunks.
- **Live governor:** if frame time > target for 2 s, first lower dynamic resolution (down to 60 %), then drop light shafts, then particle caps, then the Build/Run DOF, then GI update rate (the D79 order for the look features, §9). Restore slowly. Never touch Matter or anything gameplay. The DOM glass has its own fallback (UI_UX §8).
  - *What the governors read (as built, G5, M5):* the look governor (`look/governor.ts`), the Spectacle governor (`fx.ts`) and the VRAM governor's spike and slowdown checks (`vram.ts`) all read `timer.frameMs`, the GPU frame time (§2 Profiling). Without timestamp queries the look governor falls back to the frame interval.
  - Before G5 the look governor read the frame interval even when GPU times were available. At 60 Hz the interval never falls below 16.7 ms, which is above the 13.3 ms restore threshold, so a step was never restored, and pacing jitter stepped it down. The Spectacle and VRAM governors read the old `total()`, which over-counted.
  - Governed on the RTX 5090 after 30 s: 8 GB (Warehouse, Moon, 1M grains) settles at step 6 of 7 (T5: 6–7), and 12 GB (Arena, Moon, 2M grains) stays at step 7, because its cost is key-light shadow geometry that no step touches. *Beta polish (D125):* with the fitted cascades, 12 GB settles at step 6 at the preset camera (15.7 ms) and step 5 at the whole-world camera (10.4 ms).

---

## 12. Frame budgets (16 GB tier, 4K output from 1440p internal, 60 fps = 16.6 ms)

| Pass group | Budget (v1.0) | + D79 look (M3) |
|---|---|---|
| Upload + playback + skinning | 0.6 ms | — |
| Culling (both phases) + HiZ | 0.9 ms | — |
| Depth prepasses | 1.2 ms | — |
| Shadows (cached static) | 1.5 ms | — |
| GI + AO + SSR | 2.5 ms | +0.4 ms (GTAO, SDF contact shadows) |
| Opaque shading | 3.0 ms | +0.5 ms (texture-set arrays, detail layer) |
| Transmission + Matter surfaces | 1.5 ms | — |
| Spectacle sim (16M particles, 6 grids) | 2.5 ms (async to graphics where possible) | — |
| Volumetrics + particles draw | 1.8 ms | +0.8 ms (sun light shafts) |
| TAA upscale + post | 1.1 ms | +0.8 ms (tilt-shift DOF 0.6, LUT + vignette + grain 0.1, practical bloom 0.1) |
| **Total** | **≈ 16.6 ms** | **+2.5 ms → ≈ 19.1 ms** |

**Resolved (D81, M3):** D79 put the look at about 2.5 ms extra on the 16 GB tier at 1440p internal. D81 set the win-back order (internal resolution down to 1296p, cached static set shadows, shafts at half resolution, DOF at quarter resolution, GI irradiance at half resolution in the AO pass), and M3 measured the full look at **+0.63 ms on 16 GB and +1.85 ms on 32 GB** (M3_NOTES_L3). The live governor drops light shafts, then DOF, then GI, then internal resolution (`look/governor.ts`).

Lower tiers scale passes per GAME_SPEC §15.2. The benchmark scenes ("Kiloton", "Sandstorm", "Domino Day") run from the harness in `apps/game/bench/`; there is no nightly perf CI and no reference-GPU farm yet (only the RTX 5090; the 16 GB numbers are measured on it at the 16 GB tier's settings). M5 tier tuning (T5) re-measures the per-tier budgets on a quiet GPU ([M5_STATUS](dev/M5_STATUS.md)).

---

## 13. Capture and offline rendering
- **Offline mode:** the playback clock is driven by frame index, not wall time. Spectacle uses a fixed dt per frame, and quality is forced to the max of the device tier (it can exceed real-time budgets).
- Encoding uses WebCodecs `VideoEncoder` (AV1 → HEVC → H.264 by support) + an MP4 muxer in a worker. Frames come from `copyExternalImageToTexture`-free paths (`VideoFrame` from the OffscreenCanvas).
- **As built (M4, stream C4, `apps/game/src/capture/`):**
  - **Clock:** `capture/clock.ts` replaces the main thread's time with a virtual clock that advances exactly 1/fps per frame; every frame seeks the sim worker's playback to an exact tick (`run.captureSeek`). Hitstop and slow-mo stretch clip time. Matter in clips waits for each frame's exact tick on the playback replica.
  - **Offline render** (`offline.ts`): the governor off, native resolution with 4× MSAA (no TAA upscale), the canvas sized to the exact output; frames are `VideoFrame`s from the page canvas. Past `maxTextureDimension2D` (8,192 here) the frame is downscaled; tiling isn't built. Clips up to 5 minutes; cameras: current view, Director, Ride or a saved path. *UIFIX (D122):* the render rewinds the run to the clip start, so it restarts the auto cameras there (`CameraRig.restart`, handed the run's events up to the first frame); the director also drops its future when the playhead goes back. Before, the live run's last cut lay in the clip's future and the director held one shot until the clip passed it (a RAM for 45 s of a 50 s clip in the 2026-10-25 playtest); it now cuts at the live cut times.
  - **Encoders (D94, all in-house):** MP4 through WebCodecs (hardware first: AV1 → HEVC → H.264, then software) with our muxer in `mp4.worker.ts`, streaming to an OPFS file; GIF (`gif.ts`, `gif.worker.ts`: one palette per clip, ordered dither, changed rectangles); animated WebP (`webp.ts`: our RIFF / ANIM writer around the browser's still encoder). 8K has no hardware path in Chrome, so it uses software AV1. *UIFIX (D122):* an encoder whose stream declares another frame size than asked is skipped (`codecs.ts` `codedSizeOk`, one test frame at choose time, `av1SeqSize`): the test system's NVENC AV1 codes 1080p as 1088 lines with no crop (players showed 1920 × 1088), so 1080p takes HEVC (hardware), which crops to 1080 in its SPS like H.264; 720p, 1440p and 4K (multiples of 16) keep AV1.
  - **Photo mode** (F10, `ui/photo.ts`): orbit, focal length, aperture (the look pass's photo DOF), exposure, LUT; stills at screen size up to 8K as PNG or WebP. The Cascade Report's Share card is a 1600 × 900 PNG (`sharecard.ts`).
  - **Audio (M5, stream F5):** MP4 clips carry the game's sound as a second track: an offline director on an `OfflineAudioContext` stepped by the same frame clock (`audio/clip.ts`; `track.at(i)` before each frame's seek, `advance(i)` after its draw), encoded by WebCodecs `AudioEncoder` as AAC-LC 192 kbps (Opus 160 kbps fallback) and muxed by `capture/mp4.ts` (`mp4a` + `esds` or `Opus` + `dOps`, an edit list; sync measured at 0 samples). No measurable capture cost. The capture dialog's preview plays with sound. GIF and WebP stay silent.
  - **Turntables** (`tools/bake`) aren't built, and the Library cards show the static Blender thumbnails.
- **Turntables** (build-time, `tools/bake`) use the same renderer in headless Chrome/Dawn with the Library card rig (ui_icons brief). Static **part thumbnails** (the UI's 3D icons) are rendered in Blender by `tools/blender/render_thumbs.py` with the same rig and the warm Tinker Lab light, matched to this renderer (ui_icons §6).
- **Look proof** (D79): an in-engine frame of the Tinker Lab key-art shot is reviewed side by side with `art/style-samples/tinker_lab_key.png` (Cycles, `tools/blender/render_tinker_lab.py`), as the Studio IBL is reviewed against the look-dev cyc today.
