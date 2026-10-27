# M5 notes: R5 · M5 rendering + render polish

Stream R5 owns the vfx.md §7 Future Tech effects (`gfx/future/**`, the M5 kinds in `gfx/fx.ts` / `particles.ts`) and the M4 render polish (M5_PLAN contract 6). Shared files are edited with the Edit tool. Dev server: Vite :5304 (scratch config, HMR off), local test server :8904 (scratch `KNOCKON_DATA`). No `dist/`, no :8787. Dev page: `/src/gfx/future/dev.html?scene=m5|scale|dusty|gutter|water`.

**Status: done** (2026-10-25). `pnpm -s typecheck` clean repo-wide; game tests green (incl. `test/r5-m5.test.ts`, 11). Cross-stream failures seen on the way are listed under "Reports" at the end.

## Render polish (contract 6)

| Item | Status | Where |
|---|---|---|
| Non-1-scale dark patches | **fixed** | `meshes.ts` `MeshInfo.round`, `gi.ts` stamp |
| DUSTY's LED face (12 icons from `faceTracks`) | **done** (BUZZ's visor too) | `gfx/screens.ts`, `skin.ts`, `critters.ts`, `shaders.ts` `screenIcon` |
| TOAST CANNON's `toast_cannon__slices` | **done** | `glbmesh.ts` `STATE_NODES`, `scene.ts` |
| GUTTER texture set | **done** | `gutter.ts` |
| Water shadows | **done** (after the water fix) | `matter/wgsl.ts` (2 small marked edits, X5's file) |
| Kitchen wetness mask | **done** | `gfx/wetness.ts`, `shaders.ts` `wetness`, `renderer.ts` binding 12 |

### Non-1-scale dark patches
- **Cause:** G3's global SDF stamps every instance as its oriented bounding *box*. A round part's surface lies inside its own box near the corners, and the gap grows with scale. The SDF soft shadow toward the key (`giSoftShadow`, first step 1.5 cells + 2 cm along the normal) stayed inside the box once the gap outgrew that step, so the part shadowed itself in facet-shaped patches. Confirmed with `lookPass.force.sdfShadow = false` (patches gone, GI / AO / contact still on).
- **Fix:** `MeshLibrary.add` measures each mesh's roundness (`roundness()`: the largest corner radius, as a fraction of min(half), of a rounded box that still holds every LOD0 vertex within 1 %). `Gi.setMeshBounds` passes it in the bounds' spare `w`; the stamp uses `sdBox(p, h − r) − r`. A sphere stamps as a sphere (thud 0.98, boing 1.00, pig_iron 0.96), a box as a box (0.01), a cylinder nearly as a box (0.02). Set statics keep `w = 0`.
- **Side effect (good):** SDF contact shadows under round parts are round, not square.
- `art/style-samples/m5_polish_scale_before.png` / `_after.png` (scale 1 at the back, 2.5 in front).

### LED icon faces (DUSTY, BUZZ)
- `skinnedFromGlb` takes the `.art.json` `screens`; each `kn_screen` vertex takes its nearest screen. `icon` screens bake `[aspect / 8, 1, side, screen]` (side 0 / 1 = left / right eye, mirrored; 0.5 = a visor drawing both eyes), `bar` screens keep the bar meter. Static art (`glbLods`) does the same, so RIFT GATE / PING / RECYCLER icon screens get the icon path (dark, 5 % dots, until something sets an icon).
- The icon comes per instance: `SceneItem.icon` / `SkinnedItem.face` → the instance's metal byte (art meshes never read it) → `o.look` for screen vertices.
- `shaders.ts` `screenIcon`: a 7-row dot matrix of round LEDs lit where the icon's SDF covers; the 12 icons (`neutral`, `blink`, `happy`, `smug`, `scared`, `angry`, `dizzy`, `sleepy`, `surprised`, `determined`, `scan`, `strain`) are drawn procedurally; `scared`, `dizzy`, `scan`, `strain` animate. `angry` / `smug` mirror per eye.
- `critters.ts`: `.art.json faceTracks` (frame → icon per clip, `clipFps`) are read at load; each frame the playing clip's key at its time (looped or held like the pose) picks the icon; an emote overrides it (`!` surprised, `?` scan, `zzz` sleepy, `stars` dizzy, hearts happy, angry, sweat scared…).
- `art/style-samples/m5_polish_dusty_face.png` (all 12).

### TOAST CANNON slices
- `glbmesh.ts` `STATE_NODES` keeps `toast_cannon__slices` (all LODs) out of `toast_cannon` and registers it as `toast_cannon:slices`; `scene.ts` draws it next to the part, hidden by `toastSlicesHidden(flags, piecesInPlay)`: shown at rest and while toasting (`armed`), hidden once a launch has put this toaster's slice pieces in play, until the next toast starts. Rebuilds ride the existing scene key (flags + pool bits).

### GUTTER texture set
- `GutterView.load` loads the gutter's set (`partTexLook`). Kit pieces keep their UVs and sample it (`texSetKind` per textured master).
- The swept channel: per profile edge, the UVs of its two points at both ends of the glb's 0.5 m demo channel are read from that edge's triangles (`channelUvs`), and the sweep repeats the tile every 0.5 m of arc length. Stations are inserted at the tile seams so each quad lies inside one tile; the tile range is inset 0.8 % so the ends never sample the neighbouring island. `gutter_slim` (no channel in the glb) keeps its masters; its kit is textured.
- `art/style-samples/m5_polish_gutter_textured.png`.

### Water shadows (after the water fix; `matter/wgsl.ts`, X5's file, 2 marked edits)
- `classify` lets water into the shadow lists: only its top layers (a cell with water in the two cells above is inside the body) and half the grains by a fixed per-grain hash (`classify` gained the grain's slot as `seed`). `vs_shadow` / `vs_shadow_point` use the water radius for water entries.
- The shadow map is depth only, so the shadow is full where water covers (no translucency, no caustics).

### Wetness mask (`gfx/wetness.ts`)
- A 256² top-down grid (wetness 0–1, wet-line height) over a world rect: the Kitchen preset's `sink_floor` collider + 0.6 m, elsewhere 8 m round the origin. Each frame (RenderHook.prepare, timed `wetness`): clear a scratch, splat every live water grain of the Matter view (the same GPU buffers the Matter surfaces draw), resolve: wetness = max(previous × e^(−dt / 40 s), count / 3); the wet line jumps to the water's top. No view: it only dries. Stop resets it.
- The part shader and the Studio floor read it through a storage buffer at group 0 binding 12 (no texture: the 16 sampled-texture limit is untouched): albedo −15 %, roughness −0.3 at full wetness, below the wet line + 5–30 mm (environments.md §2.4).
- **Not from the sim's water-surface map:** `MatterStepOut.surface` lives in the sim worker; the render reads the GPU particle view directly, which is the same water and needs no plumbing.
- `art/style-samples/m5_polish_water_shadow_wet.png` (R4's synthetic water on the Studio floor).

## BUZZ (orchestrator's request, `critters.ts`)
- **LED groups:** `gfx/leds.ts` reads the `led` vertex colour (`COLOR_1`: R = group, G = default) from the raw glb for `kn_led` primitives. BUZZ's LED vertices bake the group colour (nav / ducts `#EEF1F6`, cargo `#FFC21A`, strobe `#FFB020`) and an emissive byte 251 + group; the instance's rough byte carries 2 bits per group (`SceneItem.leds` / `SkinnedItem.leds`: off, 8 %, 45 %, 100 %). Driven by state: nav and ducts lit while the `rotors` bit is set (ducts full on fast clips), cargo while carrying (carry / grab / drop_off / deliver_bow, or winch paid out), the amber strobe blinking 1 Hz (0.12 s) in flight. Landed: nav and ducts 8 %.
- **Rotors:** `Rig.evaluate` gained `adjust` (edit the local TRS before the globals). The rotor bones spin for real about +Y (fl / br clockwise, fr / bl anticlockwise) at 45 rps hovering and 90 rps on fast clips, easing up 120 rps/s and down 40 rps/s. Above 20 rps the blades scale to nothing and a translucent blur disc (Ø 96 mm) is drawn in each duct.
- **Winch:** with the sim's payout (critterState bits 5–7, sevenths of 0.60 m) the `winch` bone slides to it (otherwise the clip's own payout). The tether is a Ø 3 mm rope (`#EDE6D8`) from the spool (the winch's rest point on the body) to the winch bone.
- `art/style-samples/m5_polish_buzz_flying.png` (debug flags: rotors on).

## M5 VFX (vfx.md §7): `gfx/future/`
`FutureFx` (`gfx/future/index.ts`, shaders `gfx/future/wgsl.ts`) is one RenderHook: field quads / boxes / cones in `drawLate` (after glass), screen-space warps (lens, shimmer, column, ripple, rift glimpse) in `drawMatter` against an r32float depth resolve (`afterOpaque`, timed `future.depth`, only when a warp is on screen). Particles ride the shared pool (`particles.ts` kinds mote / glint / disk / infall / sparkle, ≤ 4 attractors, ≤ 8 stasis boxes in the uniform). Buffers and the depth texture are in the VRAM ledger pool `spectacle`; `renderer.onRestore` rebuilds them and re-adds the hook (device-loss test: back in 586 ms with 9 field instances, 5 warps, 388k particles). No new sampled textures (the 16 limit is untouched). `main.ts futureFrame` feeds it every M5 part's pose / props / flags / meter each frame and forwards SimEvents whose part or `other` is an M5 type.

| Part | As built |
|---|---|
| SINGULARITY | point-mass lens (β = θ − θE²/θ per pixel, depth-weighted), black core, photon-ring halo, accretion-disk mesh occluded by the core + orbiting disk particles (analytic rotation, budget-scaled), six infall streams, bodies within 1 m stretched along the radius (render only, `shaders.ts`), collapse: implode, shock ring, one flash (+1.2 EV, +0.5 under Reduce flashing). Timed from the `armed` edge on the run playhead; a scrub / mid-cycle start is placed from the meter (seconds left + 1). While the lens is on, shock shells and the other warps are dropped (they would sample the unbent scene). |
| RIFT GATES | swirl membrane while paired (`lit`); transit (`Teleport` / `Emerge` / `pressed`): ripple + sparkles; `Bounce`: a bonk ripple. Glimpse: a 14-step screen-space march out of the partner gate (q = R_B·RotY180·R_A⁻¹), 0 / 0 / 1 / 2 / 4 pairs on tiers 4 / 8 / 12 / 16 / 32, nearest first. |
| STASIS FIELD | hex-lattice box swept in from the corner nodes, node flares, drifting glints, shatter sparkles on release; bodies whose origin is inside get the "time-stopped" look (desaturate, cool tint, dashed plasma rim; per instance via `VOut.stasis`); particles inside freeze. |
| TRACTOR BEAM | soft cone with travelling (pull) or standing (hold) rings and the hold ring, motes; strain flicker (brightness dips 25 % at 2.7 Hz; 15 % under Reduce flashing). Beam on while `powered`. |
| HOVER PAD | underside disc glow, heat-shimmer column warp (tier ≥ 8; half strength on 8), ground ripple rings faster under load, motes. The anchor `piece` draws nothing. |
| FORCE WALL | hex plane prints in from the pylons (0.25 s), impact ripples from `Impact`/`Barrier` contacts (cells to ≤ 80 %), fades in 0.2 s. The field `piece` is engine-drawn (`ENGINE_DRAWN`). |
| COILGUN RING | on `Boost` (mag > 0) or a `pressed` edge: crawling arcs, exit ring + refraction ripple (tier ≥ 8), small flash through the flash limiter (`fx.fieldFlash`), sparkles. |
| GRAV WELL | orb halo, shimmer within 0.3 m (tier ≥ 8), motes streaming in / out by sign, spin-up arcs, a point light. |

- **Budgets:** particle counts per tier come from `pick()` (the vfx.md §7 rows; tier 32 doubles the 16 row). Warps are off on tier 4.
- **Comfort:** Reduced motion: every warp's distortion × 0.3, no body stretch. Reduce flashing: every flash through `fx` flash limiter at the lower EV, flicker amplitudes cut.
- `art/style-samples/m5_vfx_*.png`: `overview`, `singularity`, `singularity_game`, `stasis_wall`, `stasis_game`, `force_wall_game`, `tractor_grav`, `hover`, `coilgun` (ring + sparkles 0.1 s after a kick), `rift_glimpse` (left gate shows the ball in front of the right one).

### Measured cost (GPU timestamps, Chrome 155, RTX 5090, 4K output; provisional)
VFX on vs off, same scene after warm-up (dev page `__r5.measureAB`):

| Case | Δ frame | Notes |
|---|---|---|
| All 10 M5 parts, tier 16 (1440p internal) | +0.18–0.31 ms | late pass +0.12–0.21, depth resolve 0.02–0.05, particle sim +0.02; ~250k particles |
| SINGULARITY close-up, tier 16 | +0.16–0.32 ms | 215–384k particles |
| All parts, tier 32 (1800p) | +0.41–0.48 ms | ~500k particles |
| All parts, tier 4 (1080p) | +0.04–0.06 ms | 15k particles, no warps |

Contention: other streams' sessions on the same GPU (nvidia-smi 23 % util / 27.7 GB, later 11 % / 19.7 GB during the runs). Wetness mask `prepare` (HUD timer, synthetic water, 200k grains): 0.002–0.012 ms.

### What R5 reads (A5's contract, `M5_NOTES_A5.md`)
- **Flags:** `lit` = the field is on (GRAV WELL, HOVER PAD hovering, FORCE WALL up, STASIS FIELD engaged). TRACTOR BEAM: beam on while `powered`, `lit` while carrying. SINGULARITY: `armed` for its 6 s, `lit` once spun up; meter = seconds left + 1. RIFT GATES: `lit` paired, `armed` cooldown, `pressed` 0.2 s on a transit. COILGUN RING: `lit` charged, `pressed` 0.12 s on a kick. HOVER PAD: `fault` overload.
- **Meters:** TRACTOR BEAM / HOVER PAD load (1–21, 31 = overload).
- **Events:** Teleport / Emerge / Bounce (rift), Barrier + `Impact` on the wall (force wall), Engage / Freeze (stasis), Charged / Boost (coilgun), Collapse / Despawn (singularity), Attach / Release (tractor).

## GRABBER links and resizable art (A5's pieces)
- `glbmesh.ts registerLinks` splits GRABBER's art by deepest pivot into `grabber:runbase`, `grabber:turret`, `grabber:link:0..2`; in a run each link `piece` (chunks 0–2) draws its link mesh offset by its joint (`resize.ts ARTICULATED`: y 0.1 / 0.27 / 0.42), the turret yaws with the upper arm (`main.ts grabberTurrets`). `art/style-samples/m5_polish_grabber_game.png`.
- **Fingers (orchestrator follow-up):** `Machine.grabberJoints()` (A5, 8 floats per GRABBER) rides the keyframes like U5's targets: `sim.worker.ts stateArrays().gj` → `BakeStore` (`StateArrays.gj`, shared while unchanged, played back at the playhead) → the `frame` message's `grabbers` → `RunController.grabbers` (all marked `R5 (M5)`). `registerLinks` splits the finger slide pivots (`PIVOT__finger_l/_r`) out of link 2 as `grabber:finger:0/1`; `main.ts grabberTurrets` draws them per frame on the gripper body at `resize.ts fingerOffset`: −the wrist joint + the pivot's axis (finger_l −X, finger_r +X) × (opening − 0.03 rest), clamped to E5a's 0.01–0.04 m. Hidden with the part when dead / broken. Yaw, shoulder, elbow and wrist pitch are already the link bodies' poses; wrist roll is always 0 from A5, so it isn't drawn separately (it would need the gripper split from the wrist).
- `art/style-samples/m5_polish_grabber_grip_open.png` (grip 0.08: 0.04 per side), `_closed.png` (grip 0.02: 0.01 per side), `_held.png` (fingers on the STITCH, 0.038): the Library demo in a run, paused after the put-down / at the carry.
- `registerPieces` + `resize.ts pieceLayout`: FORCE WALL (reference W 0.6 × H 0.4) pylons follow the width, columns stretch, caps ride the top; STASIS FIELD (0.5³) nodes go to the corners, rails stretch. Same layout in build and run.

## Hangar zero-g rings (W5's request, `environment.ts`)
- `EnvView.players` (main.ts: 2 when `net.partner()`, else 1) and `EnvView.zonesOn` (env doc `zones !== false`). The set mesh's ring LEDs are split out (`_ring_led` solid; `_ring_led_dash` / `_ring_glyph` multiplayer): solo draws the solid plasma ring, multiplayer the dashed white ring with glyphs; zones off dims either to 12 %. W5's `drawFloor = false` z-fight fix kept.
- `art/style-samples/m5_polish_hangar_rings_solo.png` / `_mp.png` (dev page `?scene=none&env=hangar&preset=warehouse[&mp]`).

## Magenta glass on Moon / Hangar / Backlot (orchestrator follow-up, `shaders.ts fs_glass`)
- **Symptom:** GOO VAT glass showed magenta bands on its shadow side (also the vat floor through the glass); faint purple fringes in the Tinker Lab too. FISHBOWL, PANE, TANK checked on Moon, Hangar, Backlot, Tinker. (PANE's magenta top is its art: the `kn_powder_plasma` channel.)
- **Cause:** the glass front face refracted with a signed delta, `C += T × (bent − behind)`, blended as `dst × T + C`. That is only right when `dst` equals the opaque copy `behind`. Wherever another transmission layer drew first (a shell's own far wall: back faces draw before front faces; a second shell), `dst` is darker than `behind`, so the sum went negative per channel where the bent sample fell into a darker area. Moon / Hangar hard black shadows next to bright floor made it large; the tonemap clipped green to 0 → magenta. Proof: `renderer.refraction = 0` removes it; it reproduces on a fresh load straight into Moon with the old shader (`m5_polish_glass_moon_freshload_before.png`), and persisted ≥ 10 s after a switch, so it is not stale state from the environment switch (IBL, bind groups and the scene copy are rebuilt / keyed correctly).
- **Fix:** brightening stays additive (`T × max(bent − behind, 0)`), darkening becomes a transmittance factor ≤ 1 (`T × (min(bent, behind) + ε) / (behind + ε)`, ε 0.02). Identical to `T × bent` when `dst == behind`; never negative otherwise. The scalar-T fallback (no dual-source blending) averages the factor.
- Shots (1920 × 1080, Room, two GOO VATs + FISHBOWL + PANE + TANK, same camera): `art/style-samples/m5_polish_glass_{moon,hangar,backlot,tinker}_{before,after}.png`; `m5_polish_glass_moon_switch_after.png` (1.5 s after an in-session Tinker → Moon switch).

## Deviations and open items
- **Rift glimpse is screen-space only** (no second render): it can only show what is on screen; off-screen → the swirl alone.
- No froxel (volumetric) injection for the tractor cone; no ghost smear on a rift transit.
- Water shadow is binary (depth-only map); wetness comes from the GPU particle view, not the sim's surface map.
- Lens: a soft seam remains where the floor crosses the lens depth (accepted).
- Rule slip: `shaders.ts` and `critters.ts` were edited once with a script (python/sed) instead of the Edit tool; the changes are R5's own and reviewed.
- `gfx/matter/wgsl.ts` (X5): three marked `R5 (M5)` edits for water shadows (`classify` seed + water top layers, `vs_shadow`, `vs_shadow_point` radius). `M5_NOTES_X5.md` does not exist yet, so they are listed here for X5.

## Reports (other streams' failures seen during R5; the typecheck ones were gone by the final run, the X5 runtime errors were still live)
- **X5:** at runtime `matter.params*` binding size 64 < 80 and `matter.state` usage ≠ Uniform in the `matter.apply / emit / predict …` bind groups (Matter backend mid-edit); earlier a `GOO_KC` typecheck error in `packages/matter/src/wgsl.ts`.
- **E5c:** typecheck: `env_moon.ts` missing, then `MoonTerrain.data`.
- **F5:** typecheck: `AudioEncoder`, `GameAudio.tap`.
- **A5:** their blockout `when: 'lit'` visuals for STASIS FIELD / FORCE WALL (no-art fallback) double with R5's field effects when the art is absent.
- **E5c / W5:** the Hangar ring LEDs are recoloured per vertex in `environment.ts`; if the set's LED material changes, `ringOf` names must follow.
