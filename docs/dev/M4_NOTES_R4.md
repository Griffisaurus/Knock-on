# M4 notes: R4 · Matter rendering + M4 VFX

Stream R4 owns `apps/game/src/gfx/matter/**` and the M4 VFX in `particles.ts` / `fx.ts`. Shared files, edited with the Edit tool only: `renderer.ts`, `glbmesh.ts` and `main.ts` (render hooks). Plan: [M4_PLAN.md](M4_PLAN.md) contract 3. Dev server: Vite :5205 (scratch config, HMR off) and a local test server on :8805 (scratch `KNOCKON_DATA`). I didn't build `dist/` and didn't touch :8787.

**Status: done for this pass** (2026-10-24, about 23:15). Open items are at the end.

## What's drawn

| Item | Where | Summary |
|---|---|---|
| Matter source | `matter/types.ts` | `setMatterSource(src)` / `matterSource()` take anything with `view()` (MX's `MatterView`). main.ts registers MI's `matterView()` (matterhost.ts).<br>**Layout read:** `pos` / `vel` are `array<i32>`, stride 3 (units, and units per substep → m/s × 240 / 65,536). `mat` is u32: kind in bits 0–7 (0 sand, 1 water, 2 marble), variant in bits 8–15 (marble 1 = BEARING). The first `count` slots are scanned.<br>A view on another device is ignored. |
| Prepare (cull, LOD, compaction) | `matter/wgsl.ts` `PREPARE_WGSL`, `index.ts` | Its own timed compute pass, `matter.prep`, after Spectacle and before shadows: clear → splat → count → plan → scatter.<br>**Positions:** integer camera-relative maths, exact at any world size.<br>**Occupancy hash grid:** 1.56 cm cells, 8M cells on 16 / 32 GB, plus a 1M-cell velocity grid for water.<br>**Culling:** frustum and shadow box first, then **buried-grain culling**. A sand grain or marble under full cells above and on all four sides is neither drawn nor shadow-cast; that is 3.2M of the 4M grains in Sandstorm.<br>**Compaction:** per-grain lists are cached between count and scatter, and workgroup-aggregated atomics compact 16-byte entries with indirect args.<br>**Lists:** points (< 0.5 px); far grains (one triangle at 1.35× radius so a packed surface covers, ≤ 1.5 px); near grains and marble impostors (exact ray-sphere); GLINT meshes; water; shadow quads; shadow points.<br>**Sand puffs:** up to 16 fast sand landings per frame are sampled here and read back with the list counts. |
| Sand + marbles | `wgsl.ts` `MATTER_SHADE_WGSL` | Spliced after the part shader, so grains use its `shade()`: key, fill, rim, shadow map, set shadow, IBL, probe GI, GTAO and practicals.<br>**Near grains:** exact sphere depth and normal, with the silhouette anti-aliased through alpha-to-coverage.<br>**Far grains and points:** a lite path (key + one shadow-map tap + set shadow + IBL / hemisphere + GTAO + probe GI).<br>**Sand:** `#D6BE8E` with per-grain brightness and warmth, plus a few odd grains.<br>**Contact darkening:** from the burial grid, and from GTAO (grains go into the look's half-res depth prepass).<br>**Marbles:** GLINT near the camera is the real `marble` mesh (texture set) through `vertexWith()` + `fs_part`; BEARING is chrome.<br>Grains cast into the key shadow map. |
| Water | `wgsl.ts` `FLUID_*`, `index.ts` | Screen-space fluid, in four steps:<br>1. **Splats:** sphere depth (nearest wins, occluded by the opaque MSAA depth), then half-res additive thickness + foam.<br>2. **Smoothing:** linearise, then a separable bilateral filter whose radius follows the particle's projected size (2 rounds on 12 GB+).<br>3. **Resolve** (non-MSAA, into a copy of the opaque scene): normals from the smoothed depth (NaN-safe); refraction by thickness; Beer–Lambert absorption (Beam tint); Beam-tinted in-scattering; Fresnel reflection of the set IBL (the Studio uses its sky); key / fill highlights; a meniscus edge; foam (speed + velocity divergence at the free surface) as a lit white layer.<br>4. **Blit** into the MSAA late pass before transmission, at the water's depth.<br>Glass refracts the copy with the water in it (`glassScene` hook), so a TANK or FISHBOWL shows its water through the glass. |
| Container fill pass | `matter/fill.ts`, `containers.ts` | See below. |
| M4 VFX | `particles.ts`, `fx.ts`, `matter/arcs.ts` | See below. |

## Container fill pass

- **Cavities:** E4a's `.art.json → cavities[].mesh` (closed, part space) is used directly. The fallbacks, in order, are a glb `CAVITY__*` node, a mesh rebuilt from the 64-entry LUT + bounds, then the briefs' built-in shapes.
  - FISHBOWL and JITTERJUICE are old exports with no mesh yet. They get a radial profile measured from their glass shell until E4a re-exports them.
- **Level plane:** world-space, solved on the CPU by bisection on the exact volume of the cavity below a horizontal plane (triangles clipped to the half-space, tetrahedra to a point on the plane).
  - Per orientation, a 33-height volume table is cached; a fill change then costs a table lookup and 6 refining steps.
  - So the contents stay level and keep their volume at any tilt. The LUT only holds upright.
- **Surface:** the plane ∩ cavity loop (CPU), fanned into 5 rings and displaced by the profile: `flat`, `crater` (draining granular, centre lower) or `pile` (receiving granular).
  - Walls: front faces, clipped above the surface.
  - HOURGLASS: the top bulb craters and the bottom one piles while it runs, plus the Ø 1.5 mm stream from the neck to the pile.
  - glbmesh.ts `ENGINE_DRAWN` keeps `hourglass__stream` and `CAVITY__*` out of the part geometry.
- **Shading:**
  - Sand: round grains on a 3.9 mm world lattice (bump + gap darkening), fading to their mean colour once under ~2 px.
  - Marbles: packed-sphere relief on a 16 mm lattice.
  - Water: drawn into the fluid targets (depth + signed thickness, +back / −front), so the water passes treat it like free water.
  - `fill` liquids (JITTERJUICE amber): a glossy colour with a little glow.
  - Contents cast shadows and go into the AO prepass.
- **Data (main.ts):** `ContainerFills.items()` lists GRIT HOPPER, HOURGLASS, TANK, SPRINKLE CAN, MARBLE HOPPER, FISHBOWL and JITTERJUICE.
  - `fill` comes from `run.fill` while running (A4's `Machine.partFill` via MI: 0–1 in partIds order); otherwise from a `fill` prop or the brief's "full" default.
  - The profile follows the fill's trend.
  - Broken parts (a shattered FISHBOWL) hide their contents.
  - SPRINKLE CAN's cavity rides its `arm` body (`pivotPose`).
- **Cost:** about 0.5–1 ms CPU per frame for 7 animated containers (table lookups when only the fill changes; a rebuild when a container rotates).

## M4 VFX (vfx.md rows marked M4)

| Row | Implementation |
|---|---|
| `fx/arc_bolt` | `matter/arcs.ts`. A main bolt plus 2–5 branches (by tier), made by midpoint displacement and re-randomised at 30 Hz, drawn as camera-facing additive ribbons (core `#F4F8FF`, Beam glow). 64–256 segments and 4–32 bolts by tier.<br>One point light per bolt at its midpoint: 30 Hz ± 50 %, or ≤ 3 Hz ± 15 % under Reduce flashing.<br>A continuous discharge calls it every frame. |
| `fx/arc_crackle`, `fx/arc_spark` | Particles `crackle` (a flickering emissive star at both contacts) and `arc` (5–25 mm blue-white streaks, 60 / 120 / 240 / 400 per strike). |
| `fx/egg_splat` | `fx.eggSplat()`: a `splat` decal (glossy albumen ring with lobes and a yolk smear, Ø 0.25–0.4 m) and the domed `blob` yolk (`#FFB53D`, 40 mm), both until Stop, plus a droplet crown of 20 / 40 / 80 / 120. Shell shards come from G3's YOLK debris on `Break`. |
| `fx/water_splash`, `fx/water_foam` | `fx.splash(p, speed)`: spray scaled by entry speed, a crown of 12–24 droplet jets, foam puffs (2–6 s) and a wet stain that dries over 20 s. Foam also shows in the fluid passes. |
| `fx/sand_puff` | `fx.sandPuff()`: warm `#DCC9A0` dust, 16 / 32 / 64 / 96 per puff, distance-scaled (vfx §0.2 Ambient).<br>Driven by the prepare pass's GPU samples of fast grains landing on a resting pile or the floor, one per 6 cm cell per 0.4 s (`matter.onImpacts`), and by events. |
| Event routing | `fx.simEvent(kind, pos, mag, partType, otherPos)`, called from the `default` of main.ts's event switch:<br>- `Splash` (mag = speed);<br>- `Arc` / `ArcStrike` / `Zap` / `Discharge` (pos = source, `other` = the target part);<br>- `Splat` (B4);<br>- `SandPuff` / `Avalanche` / `GrainImpact`.<br>`Break` of a `yolk` adds the splat. Unknown kinds are ignored. |

## Renderer hooks added (renderer.ts, Edit tool)

`RenderHook` gained:
- `prepare(enc)`: its own compute pass after Spectacle;
- `needsScene()`: the main pass resolves into the sampleable scene copy, as it does for glass;
- `drawPrepass(pass)`: draws into the look's half-res depth prepass;
- `drawMatter(pass)`: the late pass, before transmission;
- `glassScene()`: the copy glass refracts.

`afterOpaque(enc, depth, scene)` now gets the resolved scene. `renderer.matterTargets()` hands out the part pipeline's group layouts and this frame's bind groups (group 0 part, 2 look, 3 GI). With no hook using them, every existing draw is unchanged.

## Device loss (V4)

- **Matter:** `MatterRenderer` rebuilds everything on `renderer.onRestore`: pipelines, buffers, layouts and the hook. FillPass keeps its CPU cavities and items.
- **Checked:** `renderer.simulateDeviceLoss()` in the dev page. Contents render again with a clean console (`m4_matter_fill_studio.png` was taken after it).
- **Arcs** come back with V4's Fx restore.
- **Ledger:** allocations are labelled `matter.*`.
- **MI's backend** stays on the old device after a loss. `prepare` ignores a view on another device, so Matter simply doesn't draw until MI re-creates its host.

## Timings

**Method (rule 7).**
- **Setup:** Chrome 155, RTX 5090, tier 16 forced, **3840 × 2160 output at 1440p internal** (G3's TAA), in the dev page (`/src/gfx/matter/dev.html`).
- **What is timed:** per-pass GPU timestamps (`GpuTimer`).
- **Sampling:** `__matter.measureAB(blocks, 25, 15)` alternates Matter on and off in blocks. Each block runs 25 frames to settle the timer's EMA, then samples 15; the result is the median of the block means.
- **Pacing:** frames are paced by `onSubmittedWorkDone`. The tab isn't composited, so rAF and wall times mean nothing here; only timestamps count.
- **Grains:** from **MX's real GPU backend** (`MatterGpu` on the renderer's device, `packages/matter` `sandstorm()`), stepped 240 Matter ticks into the avalanche, then paused for the measurement.

**Contention.** The GPU was shared throughout. During the 1M run and the first 4M run, other streams held it at 99 % utilisation (22–26 GB used). During the final 4M run, others used 1–36 % (`nvidia-smi` every 20 s). Every number is provisional.

| Scene (16 GB, 4K / 1440p) | Prep | Shadow Δ | AO prepass Δ | Main Δ | Water | Matter total | Drawn |
|---|---|---|---|---|---|---|---|
| Sandstorm 1M, tick 240 (99 % contention) | 0.25 | +0.18 | +0.14 | +0.21 | — | **0.78 ms** | 126k points + 166k triangles (707k buried) |
| Sandstorm 4M, tick 240 (99 % contention) | 0.56 | +0.46 | +0.39 | +1.13 | — | 2.54 ms | 817k triangles (3.2M buried) |
| **Sandstorm 4M, tick 240 (≤ 36 % contention)** | 0.45 | +0.34 | +0.32 | +0.38 | — | **1.49 ms** | 815k triangles |
| Look-dev demo: 45k sand, 7.6k water, 244 marbles, close | 0.08 | +0.02 | +0.02 | +0.25 | 0.35 (splat 0.06, smooth 0.22, resolve 0.06) | **0.72 ms** | 33k spheres, 181 GLINT meshes |
| No Matter, no containers | 0 | 0 | 0 | 0 | 0 | **0** | nothing recorded: no pass, and no pipeline until first use |

- **Against RENDERING §12** ("transmission + Matter surfaces", 1.5 ms on 16 GB):
  - The surfaces themselves (main-pass Δ + water) are 0.38 ms at 4M and about 0.6 ms in the water demo.
  - The whole Matter cost at 4M is 1.49 ms. Of that, 0.45 ms is the prepare pass (pass 5, "Matter (when commanded)") and 0.66 ms lands in the shadow and AO-prepass budget lines.
  - So it fits on this GPU, but this isn't a 16 GB-class card: perf CI on a reference GPU should re-run `measureAB`.
- **What bought it:**
  - buried-grain culling (4M → 0.8M drawn);
  - the point and one-triangle LODs with a lite shading path;
  - points into the shadow map and the AO prepass;
  - the per-grain list cache.

  Before these, a synthetic 1M field (sparse lattice, nothing buried) cost 4.3 ms under contention.
- **The table sums only the passes Matter owns or adds to.** Interleaved A/B whole-frame deltas also pick up passes Matter doesn't touch: `volume` and `taa` wander by ±0.4 ms between blocks under contention.

## Screenshots (`art/style-samples/`)

- `m4_matter_sandstorm_1m.png`, `m4_matter_sandstorm_4m.png`: MX's Sandstorm at tick 240 (4K) from real `view()` buffers, with the valley's slope, boulder and glass side walls drawn for context.
- `m4_matter_demo.png` (Studio, 4K):
  - a sand pile with a stream and GPU-sampled sand puffs;
  - marbles: GLINT meshes and impostors, BEARING chrome;
  - a water basin with a pour.
- `m4_matter_fill.png` (Tinker Lab) and `m4_matter_fill_studio.png` (Studio, after a simulated device loss and recovery): all seven containers from E4a's cavity meshes:
  - GRIT HOPPER cratering;
  - HOURGLASS split between its bulbs;
  - water in TANK, SPRINKLE CAN and FISHBOWL;
  - MARBLE HOPPER's packed marbles;
  - JITTERJUICE amber.
- `m4_matter_vfx.png` (Tinker Lab): arc bolt with crackle and arc sparks, egg splat with the yolk dome, splash droplets, sand puff.
- `m4_matter_game_build.png`: the game itself (main.ts on the local test server :8805) in build mode in the Tinker Lab. Containers were placed with `__kn.net`; their contents are the build defaults, and the TANK water is visible through the glass.

## Open issues / requests

- **MI:**
  1. After a device loss, re-create the Matter host on the new device (R4 skips views from another device).
  2. I read `run.fill` (Machine.partFill, 0–1 in partIds order) and assume `run.flags` is in the same order for the `broken` bit.
  3. A `Splash` event (mag = entry speed) when a body enters water, if the sim can see it. R4 draws it.
- **A4 / B4:**
  - R4 routes these kinds by name through `fx.simEvent`: `Splash`, `Arc` / `ArcStrike` / `Zap` / `Discharge` (pos = source, `other` = the struck part), `Splat`, `SandPuff` / `Avalanche` / `GrainImpact`. B4 has claimed `Splat`.
  - A4: if ARC TOWER's event has a different name, or keeps a discharge alive, tell me. A continuous discharge means re-sending the event, or re-calling `fx.arc`, every frame.
  - YOLK's `Break` also gets the splat.
- **E4a:**
  - The cavity `mesh` in `.art.json` is what R4 draws. SPRINKLE CAN's cavity has a `pivot`, so R4 places it on the part's `arm` body.
  - FISHBOWL, JITTERJUICE and SCOOP still have no mesh or LUT (the re-export is pending, as your notes say). R4 measures a radial profile from their glass meanwhile.
  - `hourglass__stream` and `CAVITY__*` nodes are no longer drawn as part geometry.
- **MX:** nothing blocking; R4 reads the `view()` layout as published (stride 3, kind in `mat` bits 0–7).
- **Found, not mine:**
  - Root `pnpm -s typecheck` fails in `packages/matter/test/matter.test.ts` (MX's test against old exports). The game's typecheck is clean.
  - Early in the session, loading many textured parts in parallel with `loadPartMesh` raced in `look/textures.ts` (a destroyed texture used in a submit). My dev page loads parts one at a time.
  - For a few minutes mid-session, `gi.ts` threw `vramGovernor is not defined` (V4 mid-edit). It's gone now.
- **Not done, and deviations:**
  - Arcs are built on the CPU (≤ 32 bolts × 256 segments), not by a compute pass.
  - There is no splash crown mesh; the crown is 12–24 droplet jets.
  - MARBLE HOPPER's contents are packed-sphere relief only, with no instanced marble meshes in the top 30 mm.
  - Water particles cast no shadows, and there are no caustics.
  - Crater and pile profiles assume the cavity's centre. The level plane itself is exact at any tilt.
  - The egg splat and wet stains are flat decals at the impact height. RENDERING's clustered decals don't exist yet.
  - Buried grains are culled before the section box and cutaway, so a cut through a pile shows it hollow.
  - Re-measure on a quiet GPU and on a 16 GB-class card.

## Files

- **New:**
  - `apps/game/src/gfx/matter/{index,types,wgsl,fill,containers,arcs,synthetic}.ts`;
  - `matter/dev.{html,ts}` (dev page: synthetic scenes plus `?scene=real|realmix` on MX's `MatterGpu`);
  - `apps/game/test/matter-render.test.ts` (8 tests).
- **Edited (mine):**
  - `gfx/particles.ts`: kinds `arc`, `droplet`, `foam`, `splat`, `blob`, `crackle`, `stain`;
  - `gfx/fx.ts`: `arcs`, `eggSplat`, `splash`, `sandPuff`, `simEvent`.
- **Shared (Edit tool):**
  - `gfx/renderer.ts`: the hooks above and `matterTargets()`;
  - `gfx/glbmesh.ts`: `ENGINE_DRAWN`;
  - `main.ts`:
    - `MatterRenderer` + `setMatterSource(matterView)`;
    - the sand-puff hook;
    - container fills per frame;
    - `fx.simEvent` in the event switch;
    - `__kn.matter` under `?debug`.

## Late updates

- **E4a finished:** the fill pass uses each cavity's `mesh` (GRIT HOPPER 14.86 L, TANK 14.36 L, MARBLE HOPPER 7.80 L, SPRINKLE CAN 1.75 L on its pivot, HOURGLASS top / bottom 0.12 L). The per-angle `tilt` LUTs aren't needed: the level is solved from the mesh at the actual pose. `hourglass__stream` is hidden from the part mesh and the fill pass draws the stream while sand flows.
- **TOAST CANNON's `toast_cannon__slices`** (hide after launch) isn't a fill-pass item; it belongs with the part's piece / pool drawing (scene.ts), so I've left it to whoever owns TOAST CANNON's visuals.
- **`run.fill` is now a Float32Array 0–1** (Machine.partFill); main.ts reads it as such.
- **MI finished:** `matterView()` is read through `setMatterSource` every frame, so after a device loss the re-created backend's view is picked up as soon as its device matches the renderer's. With Matter on (`run.matterMode`), a FISHBOWL `Splash` no longer adds the cosmetic water burst (`fx.matterOn`); the real Matter water draws instead.
