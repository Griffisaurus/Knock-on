# Environment briefs

The six worlds machines are built in: THE STUDIO, MEGA KITCHEN, THE TINKER LAB, BACKLOT, ORBITAL HANGAR and MOON BASE, plus the shared props kit that dresses them (§7). Each brief is the contract for the set, its lighting, physics defaults, streaming and collision. Since the look and feel pivot ([D78](../../dev/DECISIONS_2026-10-24.md)) the Tinker Lab is the default for Desk and Room, and the Lab and the Kitchen are dressed "science class maximalism" (§0.10).

Back to the [brief index](./README.md) · Look: [ART_BIBLE §9–10](../ART_BIBLE.md#9-environments) · Build rules: [ASSET_PIPELINE](../ASSET_PIPELINE.md) · Gameplay: [GAME_SPEC §5, §10.2, §15](../../../GAME_SPEC.md)

| Asset | Class | Ship | Stage |
|---|---|---|---|
| `env_studio`: THE STUDIO | Environment | M1 | brief |
| `env_kitchen`: MEGA KITCHEN | Environment | M2 | brief |
| `env_kitchen`: maximalism pass (§2.8) | Environment | M3 | brief |
| `env_tinker`: THE TINKER LAB | Environment | M3 | brief |
| `env_backlot`: BACKLOT | Environment | M3 | brief |
| `env_hangar`: ORBITAL HANGAR | Environment | M5 | brief |
| `env_moon`: MOON BASE | Environment | M5 | brief |
| `env_scale_ref`: scale reference (shared prefab) | Environment prop | M1 | brief |
| `kn_prop_*`: shared props kit, 45 props (§7) | Environment prop | M3 | brief |

---

## 0. Rules shared by every environment

### 0.1 Coordinates and files
- Blender metres, Z-up, **origin = centre of the active preset's bounds floor** (this is the engine world origin, GAME_SPEC §5.2). +X right, **+Y back (away from the default camera)**, +Z up. The exporter converts to engine Y-up.
- Preset sizes in GAME_SPEC are W × H × D. In Blender that is **X × Z × Y**.
- Files: `assets/src/env/<env>/<env>_set.blend` (shell, terrain, landmarks), `<env>_props.blend` (dressing), `<env>_light.blend` (rigs, probes, ToD). Shared pieces: `assets/src/env/_shared/` (scale reference, floor-ring marker, practical lamps).
- Where one set serves several presets (Kitchen, Backlot), coordinates are given in **set coordinates** (the origin of the largest preset), and each smaller preset's bounds are given as a box in the same coordinates. The engine re-centres on the active preset's `BOUNDS__` box.

### 0.2 Exact playable bounds (GAME_SPEC §5.3)

| Preset | Size W × H × D (m) | Blender box (X, Y, Z) | Cells | Placed-part cap | Min tier |
|---|---|---|---|---|---|
| Desk | 4 × 3 × 3 | X −2…+2 · Y −1.5…+1.5 · Z 0…3 | 40 × 30 × 30 | 2,000 | 4 GB |
| Room | 16 × 8 × 16 | X −8…+8 · Y −8…+8 · Z 0…8 | 160 × 80 × 160 | 20,000 | 4 GB |
| Warehouse | 64 × 24 × 64 | X −32…+32 · Y −32…+32 · Z 0…24 | 640 × 240 × 640 | 100,000 | 8 GB |
| Arena | 256 × 64 × 256 | X −128…+128 · Y −128…+128 · Z 0…64 | 2,560 × 640 × 2,560 | 400,000 | 12 GB |
| Megastructure | 1,024 × 256 × 1,024 | X −512…+512 · Y −512…+512 · Z 0…256 | 10,240 × 2,560 × 10,240 | 1,000,000 | 16 GB |

### 0.3 Environment collections and object names

| Collection | Object names | Contents |
|---|---|---|
| `ENV_RENDER` | `env_<env>__<piece>` | LOD0 set and prop meshes, grouped under `CHUNK__<cx>_<cy>` empties (chunk index = floor(x / 32), floor(y / 32)) |
| `LOD1`–`LOD3`, `HLOD` | `…__L1` … / `HLOD__<hx>_<hy>` | 50 % / 25 % / 8 % of LOD0; HLOD = one merged proxy per 4 × 4 chunks (128 m) |
| `COL` | `COL__box/hull/mesh__n`, `COL__heightfield__<cx>_<cy>` | Static collision only. `COL__mesh` ≤ 4k tris per object (split if larger). Heightfield is new for environments (§0.6) |
| `BOUNDS` | `BOUNDS__desk/room/warehouse/arena/mega` | One box per supported preset, exactly the §0.2 size |
| `SPAWN` | `SPAWN__camera__<preset>`, `SPAWN__target__<preset>`, `SPAWN__drone__p1/p2__<preset>` | Default orbit camera, its orbit target, and multiplayer drone start points |
| `ZONE` | `ZONE__neutral__<preset>`, `ZONE__field__<name>` | The neutral build zone (flat box, ≥ 8 × 8 m) and any environment-authored Field zones |
| `REF` | `REF__scale__<preset>` | Placement empty for the linked `env_scale_ref` prefab |
| `LIGHT` | `LIGHT__sun`, `LIGHT__key/fill/rim`, `LIGHT__practical__n` | Light rig. ToD presets are custom properties on `LIGHT__sun` |
| `PROBE` | `PROBE__reflect__n`, `PROBE__gi_volume__n` | Box-projected reflection probes and the GI probe volume |
| `EMIT` | `EMIT__amb__<name>` | Ambience emitters (audio and ambient VFX), +X = facing |
| `BACKDROP` | `env_<env>__bd_<piece>` | Outside-bounds scenery: no collision, never streamed out |

Root custom properties: `kn_env` (id) · `kn_presets` (comma list) · `kn_gravity` (preset name) · `kn_air` (%) · `kn_feel` · `kn_tod_default` (Backlot) · `kn_notes`.

### 0.4 Environment prop classes

| Class | Use | LOD0 tris | Textures | Materials | Collision |
|---|---|---|---|---|---|
| **E-S** dressing | Small repeated props, instanced | 300–2,000 | Shared env trim 2048² | ≤ 2 | `COL__box`/`hull` or none |
| **E-M** prop | Furniture, single props | 2,000–8,000 | Trim + 1024² unique | ≤ 3 | ≤ 6 primitives |
| **E-L** set piece | Large buildable set pieces | 8,000–30,000 | 2048² hero set | ≤ 3 | Primitives, then `COL__mesh` |
| **E-H** landmark | One-per-world hero | 30,000–80,000 | 2048² hero + 1024² detail | ≤ 4 | Primitives + `COL__mesh` |
| **E-B** backdrop | Outside bounds | 5,000–40,000 | 2048² (baked AO allowed) | ≤ 2 | none |

All props use master materials ([ASSET_PIPELINE §5.1](../ASSET_PIPELINE.md#51-master-materials)) plus the environment masters `kn_env_*` defined in [shared_kit.md §7.3](shared_kit.md#73-environment-masters-kn_env_), with the textures above layered over them and the "loved, not grimy" wear of ART_BIBLE §4 (D78). Same bevel rules as parts (ART_BIBLE §2): environment props are built in the bevelled toy style, never photoreal. Shared dressing comes from the props kit (§7).

### 0.5 Streaming and tier budgets (all environments)
- **Tier names:** the tier IDs are the GB names, **4 GB · 8 GB · 12 GB · 16 GB** (GAME_SPEC §15.2; the UI shows them as tier badges). Tables in this file add the declared shorthand in brackets (Low = 4 GB · Medium = 8 GB · High = 12 GB · Ultra = 16 GB), as vfx.md §0.1 does.
- **Chunk = 32 × 32 m column, full height**, aligned to the world origin. It matches the engine's 32 m merged static compounds (GAME_SPEC §5.3), so one chunk = one static compound + one render package.
- Desk and Room: one resident package, no streaming. Warehouse: 2 × 2 chunks, all resident. Arena: 8 × 8 = 64 chunks, streamed. Megastructure: 32 × 32 = 1,024 chunks, streamed.
- Chunk package ≤ 6 MB compressed (meshopt + KTX2). Prefetch along the camera velocity, 2 s ahead.

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Environment VRAM pool | 0.25 GB | 0.5 GB | 0.75 GB | 1.0 GB (GAME_SPEC §15.1) |
| Resident env tris (LOD-weighted, in view) | 200k | 400k | 700k | 1.0M |
| LOD0 / LOD1 / LOD2 / LOD3 ring radius (m) | 32 / 64 / 96 / 128 | 48 / 96 / 160 / 256 | 64 / 128 / 192 / 320 | 96 / 192 / 320 / 512 |
| HLOD (128 m proxies) beyond | n/a | 256 m | 320 m | 512 m, to the world edge |
| Hero texture top mip | 1024² (2048² mip dropped) | 2048² | 2048² | 2048² |
| Reflection probes resident | 4 | 8 | 16 | 32 |
| Sky / IBL cube | 256² per face, 8 mips + SH9 diffuse (RENDERING §6.2), all tiers | same | same | same |
| Shadow cascades for sun or key | 2 × 2048² | 4 × 2048² | 4 × 4096² | 4 × 4096² (GAME_SPEC §14) |

### 0.6 Collision authoring
- Prefer primitives (`COL__box`) for everything flat: floors, counters, decks, walls. `COL__mesh` (static, ≤ 4k tris per object) only for curved, walkable or ball-guiding surfaces (sink basin, cove, lander legs).
- **Heightfields** (Backlot, Moon): `COL__heightfield__<cx>_<cy>`, one per 32 m chunk, **65 × 65 samples (64 × 64 quads, 0.5 m spacing)**, edge samples shared with neighbours, heights quantized to u16 over the bounds height. The exporter writes a Jolt `HeightFieldShape` (block size 4). The Backlot heightfield is **sim state** (sculpted by deterministic `terrain.stroke` ops, MULTIPLAYER §5.1), so art authors only the default; the render mesh is regenerated from it.
- Physics material per shape: custom property `phys` (`powder`, `wood`, `steel`, `ceramic`, `rubber`, `concrete`, `soil`, `regolith`). Friction and restitution come from the sim's table ([SIMULATION §4.3](../../SIMULATION.md)); `concrete` / `soil` / `regolith` are the environment-ground materials there (friction 0.75 / 0.85 / 0.80, restitution 0.10 / 0.05 / 0.05). Values quoted in this file are copies of that table; if they ever differ, SIMULATION wins.
- Nothing thinner than 5 mm. No collision on `BACKDROP`, foliage leaves, light shafts or decals.
- Bounds walls are not collision; the engine clamps placement to `BOUNDS__` and sleeps bodies that leave it.

### 0.7 The scale reference (shared prefab `env_scale_ref`)
Every environment places it near spawn (ART_BIBLE §9): outside the neutral zone, **within 6 m of the zone's front-right corner** (the +X corner on the default-camera side), inside the default camera view, facing −Y (toward the default camera). (A fixed distance from the camera target can't work: on Warehouse and Arena the target sits inside a 16–32 m zone.) File: `assets/src/env/_shared/scale_ref.blend`.

| Piece | Spec |
|---|---|
| Measuring stick | 1.000 × 0.040 × 0.020 m (H × W × D), standing vertically. `kn_powder_bone` with ten 0.1 m bands alternating Bone / `kn_powder_graphite`; the 0.5 m band is `kn_powder_ignition`. Decimetre numerals 1–9 from the decal atlas (Unbounded Bold, 14 mm). 3 mm bevels |
| Stick foot | 0.12 × 0.12 × 0.02 m `kn_powder_graphite` plate, 4 × M5 screws, 4 rubber feet FOOT_S |
| Plinth | 0.40 × 0.40 × 0.45 m (W × D × H) `kn_powder_graphite`, 12 mm pillowed bevel, top inlay 0.36 × 0.36 m `kn_powder_bone`, centre cup Ø 0.12 × 0.015 m seating the Thud. Name plate on the −Y face: "THUD · 7 kg · Ø 22 cm" (Bone on Graphite) |
| Thud | Linked `rollers/thud.blend` LOD chain, static display copy (no rigid body) |
| Layout | Stick foot centre 0.35 m to the +X side of the plinth centre |
| Collision | `COL__box` plinth, `COL__sphere` Thud, `COL__box` stick + foot. `phys = powder` |
| Budget | ≈ 4.5k tris LOD0 (stick 600, foot 400, plinth 1,500, Thud 2,000). Uses the shared decal atlas only |

### 0.8 Audio levels in the ambience tables
Loudness values given for ambience beds (−44 to −50 LUFS) are **in-mix playback targets** at the default camera on the `ambience` bus. Source loops are still mastered at −18 LUFS-S ([AUDIO §10](../../AUDIO.md)) and attenuated in `audio/cues.json`. Reverb baselines describe the environment's convolution IR, which is capped at 2 s (AUDIO §1).

### 0.9 The neutral build zone
`ZONE__neutral__<preset>`: a flat, level, single-material floor area of **at least 8 × 8 m** (the Desk preset is the only exception, see THE STUDIO and THE TINKER LAB), with no props, no slope, no environment shadows falling across it in the default lighting, and no ambience emitters inside. Bake checks fail if any `ENV_RENDER` or `COL` object intersects it.

### 0.10 Density zoning ("science class maximalism")
From M3 the Tinker Lab and the Mega Kitchen are dressed maximal, warm and lived-in, but zoned so the machine always reads first ([D78](../../dev/DECISIONS_2026-10-24.md), ART_BIBLE §9). The Studio is exempt (clean by design). The Backlot, Orbital Hangar and Moon Base keep their briefs as written.

| Zone | Extent | Rule |
|---|---|---|
| **Build zone** | The Desk mat, or `ZONE__neutral__<preset>` | Clean and level, §0.9. No dressing, no environment shadows across it |
| **Clutter ring** | 0.5–3 m out from the build zone edge | Maximal: layered kit props at every height. On the sun side, dressing within 1 m of the zone stays ≤ 0.2 m tall (set scale) so its shadows stop short of it; tall dressing goes to the shade side and the back |
| **Far background** | Beyond 3 m | Busy but soft: haze, depth of field in Photo mode and the lobby, the Build/Run tilt-shift |
| **Value and saturation** | Everything outside the build zone | About **one stop darker and less saturated** than the build zone |

**Bake checks** (from each `SPAWN__camera__<preset>`, default lighting): no `ENV_RENDER` shadow crosses the build zone; the mean luminance outside the zone is 1 EV ± 0.3 below the zone's and its mean saturation is ≥ 15 % lower. Fix the set (albedo, light, placement), never the grade.

---

## 1. THE STUDIO
`env_studio` · Environment · Ship M1 · default for Warehouse and Arena; the clean "product shot" option on Desk and Room (default for all presets until THE TINKER LAB ships in M3)

**Concept and mood.** A product-launch photo studio that never ends. An infinite seamless cyclorama, soft-box light from the top left, a cool rim from behind, and a floor with a faint etched 1 m grid. Zero clutter: the machine is the hero. It should feel like the look-dev renders in `art/style-samples/` made playable.

| Spec | Value |
|---|---|
| Presets | **Desk, Room (default), Warehouse, Arena** (GAME_SPEC §10.2: the Studio supports Desk → Arena). The Studio and THE TINKER LAB host Desk |
| Bounds | Per §0.2 for each preset |
| Cyc variants | **Light** `#BDB8AF` (default) and **Dark** `#1C1F26`, toggled in world settings (`env.update`), no reload |
| Physics defaults | Gravity **Earth 100 %** · Air **100 %** · Feel **Real** · no zones |
| Surfaces | Floor and cove `kn_env_cyc_light` / `kn_env_cyc_dark` with the grid-etch mask |
| Budget | ≤ 40k tris LOD0 in total (deliberately under the 200k floor of the Environment class: the Studio is empty by design; the exception is recorded in ASSET_PIPELINE §4). Textures: grid etch mask 2048² tiling, Studio IBL cubes |

### 1.1 Set geometry

| Element | Spec |
|---|---|
| Floor | Flat plane at Z = 0, extending to the horizon. Rendered as a camera-centred clipmap; colour fades into the cove colour beyond 3 × the bounds width, so there is never a visible edge |
| Cove (cyc sweep) | U-shaped sweep wrapping the back and both sides (270°), open toward −Y (the default camera side). Profile as in `style_samples.py cyc()`: flat run, quarter-circle cove, vertical wall |
| Cove placement per preset | Desk: cove starts at 1.0 m outside the bounds, radius 1.5 m, wall height 6 m · Room: 4 m outside, radius 4 m, height 20 m · Warehouse: 16 m outside, radius 12 m, height 60 m · Arena: 48 m outside, radius 40 m, height 200 m |
| Grid etch | 1 m minor lines 4 mm wide, 10 m major lines 8 mm wide, origin cross 0.6 m long × 12 mm. Grooves 0.6 mm deep in a tiling normal + roughness mask (roughness +0.08 in the groove). Albedo −6 % in the groove on Light, +4 % on Dark |
| Floor marks | Four Ignition "T" camera marks (decal, 0.15 × 0.15 m, 20 mm stroke) at the corners of the neutral zone. The only dressing |
| Front | Nothing. The −Y side is open floor fading into the gradient sky dome of the same colour |

### 1.2 Layout per preset

| Preset | Neutral zone | Camera target | Default camera | Scale reference | Drone spawns P1 / P2 |
|---|---|---|---|---|---|
| Desk | **The whole 4 × 3 m floor** (an 8 × 8 m zone cannot fit; nothing else is placed inside the bounds) | (0, 0, 0.3) | (0, −4.63, 2.66), orbit distance 5.2 m, elevation 27° | (+2.6, −1.0, 0), just outside the +X bound | (−1.2, −2.4, 1.6) / (+1.2, −2.4, 1.6) |
| Room | X −4…+4 · Y −5…+3 (8 × 8 m) | (0, −1, 0.5) | (0, −12.5, 7.15), distance 13.3 m, elevation 30° | (+5.5, −6.0, 0) | (−3, −9, 3) / (+3, −9, 3) |
| Warehouse | X −8…+8 · Y −12…+4 (16 × 16 m) | (0, −4, 1) | (0, −34.3, 18.5), distance 35 m, elevation 30° | (+10.5, −13.5, 0) | (−5, −26, 8) / (+5, −26, 8) |
| Arena | X −16…+16 · Y −24…+8 (32 × 32 m) | (0, −8, 2) | (0, −76, 41), distance 78 m, elevation 30° | (+18.5, −25.5, 0) | (−8, −60, 20) / (+8, −60, 20) |

The rest of each preset's bounds is open floor. Default camera azimuth is straight front (−Y), matching the look-dev lineup camera.

### 1.3 Landmark props

| Prop | Class | Tris | Notes |
|---|---|---|---|
| `env_scale_ref` | shared | 4.5k | §0.7 |
| Cyclorama cove (per preset) | E-B budget, but in `ENV_RENDER` (not `BACKDROP`) because it keeps `COL__mesh` collision (§1.6) | 6k | Generated from the profile; 48 segments around the 270° wrap. The one backdrop-class piece with collision |
| Floor T-marks ×4 | decal | — | Decal atlas, hazard-free Ignition mark |

### 1.4 Lighting rig
Derived from the look-dev rigs in `tools/blender/style_samples.py` (lineup = Light, materials = Dark). In-engine the softbox area lights become shadowed or unshadowed directionals plus a **Studio IBL** baked in Blender from the same rig (emissive softbox cards inside the cyc), so reflections show soft rectangular highlights.

| Light | Light cyc (from `scene_lineup`) | Dark cyc (from `scene_materials`) | Engine implementation |
|---|---|---|---|
| Key | 420 W area 1.6 m at (−1.6, −1.5, 1.9) → front-left, elevation 37°, azimuth 46° left of front. White | 160 W area 1.0 m at (−0.9, −0.9, 1.3) → front-left, elevation 44°, azimuth 44° left of front. White | Directional, CSM, soft shadow (light angle 6°). Relative intensity 1.0 |
| Fill | 110 W area 2.0 m at (1.9, −1.1, 0.9) → front-right, elevation 18°. White | none | Directional, unshadowed, 0.26 × key |
| Rim | 380 W area 1.5 m at (0.3, 1.8, 1.5) → back, elevation 36°. Colour (0.86, 0.94, 1.0) ≈ 7,500 K | 130 W area 1.0 m at (0.7, 0.9, 0.8). Colour (0.6, 0.85, 1.0) | Directional, unshadowed. Light 0.90 × key · Dark 0.81 × key |
| Top | 160 W area 3.0 m overhead | 90 W area 1.6 m overhead | IBL only (softbox card in the Studio IBL) |
| World | (0.5, 0.5, 0.52) × 0.3 | (0.012, 0.013, 0.016) × 1.0 | Sky dome colour = cove colour |
| Exposure | −0.9 EV (look-dev) → engine EV100 9.0 | −0.6 EV → EV100 8.0 | Auto exposure off; fixed |
| IBL | `ibl_studio_light` cube 256², 8 mips + SH9 (RENDERING §6.2; equirect source 2048 × 1024 EXR) | `ibl_studio_dark` | Baked by `tools/blender` from the rig so it matches the Cycles look-dev exactly; no third-party HDRI |
| Tonemap | Khronos PBR Neutral (ART_BIBLE §10) | same | |

Rig scale: light directions are fixed; the rig is direction-only so it works unchanged from Desk to Arena. Contact grounding per GAME_SPEC §15.2 and RENDERING §7: GTAO + full probe GI on 16 GB, GTAO + SDF AO + probe GI (half rate) on 12 GB, GTAO + SDF AO on 8 GB, SSAO only on 4 GB. The Studio is exempt from density zoning (§0.10) and keeps a neutral LUT.

### 1.5 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets available | Desk, Room | + Warehouse | + Arena | all four |
| Packages | 1 resident | 1 resident (Warehouse 2 × 2 chunks, all resident) | Arena 64 chunks (floor clipmap only; trivial) | same |
| Env VRAM used | ≤ 60 MB | ≤ 80 MB | ≤ 120 MB | ≤ 160 MB |

### 1.6 Collision
- Floor: one `COL__box` per 32 m chunk, 1 m thick, top at Z = 0, `phys = powder` (cyc paint: friction 0.50, restitution 0.25, SIMULATION §4.3). Desk/Room: a single 64 × 64 m box.
- Cove: `COL__mesh` (≤ 4k tris per side) so balls that leave the bounds roll up the sweep and back, which reads as playful instead of a hard wall.
- Scale reference: §0.7.

### 1.7 Audio ambience hooks

| Hook | Emitter | Notes |
|---|---|---|
| `amb_studio_roomtone` | global bed | Very quiet large-room tone with soft HVAC air, −48 LUFS. Light and Dark share it |
| `amb_studio_lamp_hum` | `EMIT__amb__key` (off-screen key) | Barely audible ballast hum, 3D, 30 m radius |
| Reverb baseline | — | Large dry studio, RT60 0.9 s (SDF ray probes refine it) |
| `amb_studio_toggle` | UI | Soft "lights changing" clunk when switching Light / Dark cyc |

**Notes / don'ts.** No props inside the bounds besides the scale reference and the floor marks. Never let the cove edge, a seam or a light fixture show in any default camera. The grid etch must stay subtle: under the Build-mode `beam` grid overlay it must never compete.

---

## 2. MEGA KITCHEN
`env_kitchen` · Environment · Ship M2

**Concept and mood.** Saturday morning in a giant kitchen. Your machines are toy-sized; the counters are cliffs, the sink is a canyon (later a lake), the fridge is a skyscraper. Warm low sun through the window, morning haze, the smell of toast. Every kitchen object is built in the same bevelled designer-toy style as the parts, never photoreal.

| Spec | Value |
|---|---|
| Presets | **Room, Warehouse** |
| Scale | The whole set is built at **5 : 1** (a 0.92 m real counter = 4.6 m). Parts and critters stay real size (Mochi ≈ 0.45 m), so the kitchen reads giant |
| Set coordinates | Origin = Warehouse bounds floor centre. Back wall plane Y = +32, left wall plane X = −32 |
| Warehouse bounds | X −32…+32 · Y −32…+32 · Z 0…24 (set coords) |
| Room bounds | **X −8…+8 · Y +16…+32 · Z 0…8** (set coords): the sink corner. Room world origin = set (0, +24, 0) |
| Ceiling | **None.** The set is an open-top dollhouse cutaway: back and left walls rise to 13.5 m (2.7 m real) and end in a cornice. Above, a warm haze gradient dome. This keeps the full 24 m Warehouse height playable |
| Physics defaults | Gravity **Earth 100 %** · Air **100 %** · Feel **Real** · no zones |
| Budget | Warehouse ≈ 420k tris LOD0 (set 160k, props 260k) · Room ≈ 230k |

### 2.1 Layout (set coordinates)

| Element | Position / size (5 : 1) | Notes |
|---|---|---|
| Floor | Whole set, Z = 0. 1.5 m ceramic tiles (0.3 m real), Bone / warm-grey checker | `kn_env_floor_tile`, grout 30 mm |
| Back counter run | Y +29…+32, X −32…+32 except the fridge gap; top Z = 4.6 m | Lower cabinets Bone doors, Oak toe kick, countertop `kn_env_counter` (warm speckled laminate) |
| Sink | Basin X −2…+2, Y +29.5…+31.5, 1.1 m deep below the counter top. Tap rises to Z 7.8 m at X 0, Y +31.8 | `kn_steel_brushed` basin, `kn_chrome` tap. Drain grille Ø 0.45 m. Dry by default (§2.4) |
| Window | Back wall above the sink: X −3…+3, Z 5.6…11.0 | Garden backdrop card + sky behind; source of the key light |
| Fridge | **X −12.5…−8, Y +28.5…+32**, H 9.0 m | Just left of the Room bounds so it towers over the Room preset. Bone, chrome bar handle, 4 Amber magnet discs |
| Upper cabinets | Back wall, Z 7.25…9.75 m (bottom 1.45 m real) | Bone doors, Graphite pulls |
| Stove + oven | Left wall X −32…−29, Y −2…+2, top Z 4.6 m | Graphite hob, Ignition knobs (exaggerated 1.3×) |
| Left counter | X −32…−29, Y −24…+26 (gap for the stove) | Same as the back run |
| Island | Centre (+6, +10), 10 × 5 m, top Z 4.6 m | Walnut top `kn_wood_walnut`, Bone sides |
| Dining table + 4 chairs | Table centre (+16, −14), 8 × 4.5 m, top Z 3.75 m; chairs seat Z 2.3 m | Oak, Cobalt chair seats |
| Doorway | Left wall gap Y −32…−24 | Darker hallway beyond (backdrop) |
| Neutral zone (Room) | **X −4…+4 · Y +17…+25** (8 × 8 m), 4 m clear of the counter front | |
| Neutral zone (Warehouse) | **X −24…−8 · Y −28…−12** (16 × 16 m) | Floor between the stove wall and the table |
| Spawn (Room) | Target (0, +21, 0.5) · camera (0, +9.5, 7.2), distance 13.3 m, elevation 30° | Faces the sink and window |
| Spawn (Warehouse) | Target (−4, −8, 1) · camera (−4, −40, 19.5), distance 37 m, elevation 30° | Sees fridge, island and window |
| Scale reference | Room (+5.5, +17.5, 0) · Warehouse (−6, −27, 0) | |
| Drone spawns | Room (∓3, +12, 3) · Warehouse (∓5, −32, 8) | P1 −X, P2 +X |

### 2.2 Props

| Prop | Class | LOD0 tris | Materials | Collision |
|---|---|---|---|---|
| Counter run module (per 3 m) | E-L | 9,000 | `kn_powder_bone`, `kn_env_counter`, `kn_wood_oak` | `COL__box` ×2 |
| Sink + tap | **E-H** | 42,000 | `kn_steel_brushed`, `kn_chrome`, `kn_rubber` | `COL__mesh` basin (3.6k), `COL__capsule` tap |
| Fridge | **E-H** | 34,000 | `kn_powder_bone`, `kn_chrome`, `kn_powder_amber` magnets | `COL__box` ×3 |
| Stove + oven | E-L | 22,000 | `kn_powder_graphite`, `kn_powder_ignition` knobs, `kn_glass` door | `COL__box` ×4 |
| Upper cabinet module (per 3 m) | E-L | 8,000 | Bone, Graphite pulls | `COL__box` |
| Island | E-L | 16,000 | `kn_wood_walnut`, Bone | `COL__box` ×2 |
| Dining table | E-L | 10,000 | `kn_wood_oak` | `COL__box` top + `COL__box` ×4 legs |
| Chair ×4 (instanced) | E-M | 6,000 | Oak, `kn_powder_cobalt` seat | `COL__box` ×5 |
| Stand mixer (on back counter at X +14) | E-L | 18,000 | `kn_powder_ignition` body, `kn_steel_brushed` bowl | `COL__hull` ×4 |
| Kettle (back counter X −20) | E-M | 7,000 | `kn_powder_beam` body, `kn_rubber` handle | `COL__hull` ×3 |
| Fruit bowl with 5 oranges (island) | E-M | 8,000 | `kn_ceramic_bone`, `kn_powder_ignition` oranges | `COL__mesh` bowl, `COL__sphere` ×5 |
| Cookie jar (left counter Y +20) | E-M | 4,000 | `kn_ceramic_plasma`, `kn_wood_oak` lid | `COL__cylinder` |
| Cereal box "MORNING CRUNCH" (invented, no real brand) | E-S | 800 | `kn_cardboard` + decal | `COL__box` |
| Dish rack with 4 plates | E-M | 7,500 | `kn_steel_brushed`, `kn_ceramic_bone` | `COL__hull` ×6 |
| Spice jars ×6 (instanced) | E-S | 900 | `kn_glass`, `kn_powder_graphite` lids | `COL__cylinder` |
| Potted herb on the sill | E-M | 5,000 | `kn_ceramic_ignition`, `kn_env_foliage` | `COL__cylinder` pot |
| Wall clock (above the doorway) | E-M | 3,000 | Bone face, Graphite rim | none (out of reach) |
| Pendant lamp ×3 over the island | E-M | 3,000 | `kn_powder_amber` shade, emissive bulb | none (hung from a graphite rail spanning wall to wall at Z 25 m, above the Warehouse bounds) |
| Floor rug under the table | E-S | 500 | `kn_fabric_cobalt` | flat, part of the floor box |
| Cat bowl with "MOCHI" decal (gag) | E-S | 1,200 | `kn_ceramic_bone` | `COL__cylinder` |
| Window frame + garden backdrop card | E-M + E-B | 6,000 + 10,000 | `kn_powder_bone`, `kn_glass`, backdrop 2048² | none |

**Interactive rule:** set pieces are static. Nothing in the kitchen is a part (no giant toaster: it would read as TOAST CANNON).

### 2.3 Lighting rig

| Element | Morning (default) | Evening |
|---|---|---|
| Sun (through window) | Directional, elevation 22°, from +Y (through the window) and 20° toward +X. **4,300 K**, illuminance 60k lux, CSM | Off |
| Window sky | Emissive card behind the window, sRGB `#CFE6FF` × 1.0 | `#3A4A7A` × 0.4 (blue hour) |
| Volumetric haze | Froxel fog density 0.012 / m, anisotropy 0.6 → visible god rays through the window | 0.004 / m |
| Interior fill | Box-projected reflection probes (Room 2, Warehouse 6) + probe GI; warm bounce from the Bone cabinets | same |
| Practicals | Under-cabinet LED strip 3,000 K (on, 200 lm/m), pendants off | Pendants on: 2,700 K, 1,800 lm each, 1 shadowed; under-cabinet on |
| Exposure | EV100 10.5, auto exposure ±0.7 EV | EV100 7.5 |
| LUT | `lut_kitchen_morning`: +4 % warmth in highlights | `lut_kitchen_evening` |

### 2.4 The sink
- **M2–M3:** the sink is **dry**: a 1.1 m deep steel canyon with a drain. The only wet look is a static stain mask baked into the sink's own 1024² detail texture around the drain (roughness −0.15, albedo −8 %). It is not a `kn_decal` (the atlas has no water-stain cell) and not a clustered `fx_water_stain` decal (those clear on Stop).
- **M4 (Matter):** world toggle "Fill the sink" spawns Matter water up to Z 4.2 m, capped at **1M particles: 25 % of the 16 GB tier's 4M budget, the same on every machine** (D98; a tier-scaled cap would make outcomes device-dependent). A world with the sink filled requires the 16 GB tier (header `requiredTier`). Art supplies the basin's wet-darkening material state (roughness −0.3, albedo −15 %, driven by the engine wetness mask).

### 2.5 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets | Room | + Warehouse | Room, Warehouse | Room, Warehouse |
| Packages | Room: 1 resident (all props of the Room box + the fridge + window) | Warehouse: 2 × 2 chunks, all resident | same | same |
| Env VRAM | ≤ 220 MB (2048² top mips dropped, §0.5) | ≤ 420 MB | ≤ 480 MB | ≤ 560 MB |
| Props outside the active bounds | Room: everything beyond 8 m of the bounds is LOD2 | — | — | — |

### 2.6 Collision
All counters, cabinets, fridge, stove and table are `COL__box` (`phys = powder` for painted surfaces, `wood` for wooden tops, `ceramic` for the floor tile: friction 0.25, restitution 0.20, SIMULATION §4.3). Sink basin and fruit bowl are `COL__mesh`. Cabinet door handles have collision (balls can catch on them) as `COL__capsule`.

### 2.7 Audio ambience hooks

| Hook | Emitter | Notes |
|---|---|---|
| `amb_kitchen_room` | global | Warm small-room tone, distant morning traffic through glass, −46 LUFS |
| `amb_kitchen_fridge_hum` | `EMIT__amb__fridge` | Compressor hum cycling 40 s on / 60 s off, pitched down one octave (5 : 1 world) |
| `amb_kitchen_clock_tick` | `EMIT__amb__clock` | 1 Hz tick, slow and heavy (scaled) |
| `amb_kitchen_birds` | `EMIT__amb__window` | Garden birds, Morning only |
| `amb_kitchen_tap_drip` | `EMIT__amb__tap` | Irregular drip every 6–14 s (seeded), dry sink plink |
| `amb_kitchen_evening` | global | Evening variant: crickets through glass, a pendant buzz |
| Reverb baseline | — | Tiled room, RT60 0.7 s, bright early reflections |

**Read at a glance.** From the Room camera: the steel sink canyon, the window glow and the Bone fridge tower on the left. **Don'ts.** No real brands or logos on packaging. No food mess, crumbs or grime: loved and toy-like, never dirty (ART_BIBLE §4). Nothing sharp (no knives on display).

### 2.8 Maximalism pass (M3)
The Kitchen gets the "science class maximalism" dressing ([D78](../../dev/DECISIONS_2026-10-24.md)). **It keeps its layout and its colliders** (`env_kitchen.ts` is unchanged), so every addition is visual-only and goes where a missing collider can't be felt:
- flush on vertical faces (≤ 0.3 m proud at 5 : 1) with the wall or door box behind it;
- on top of the fridge and the upper cabinets (Z ≥ 9.75 m);
- outside the active bounds, or hung above them;
- or it re-dresses an existing prop in place and reuses that prop's collider (the fruit bowl, the cereal box).

| Addition | Where | Source |
|---|---|---|
| Fridge magnets ×20 and 6 kids' drawings | Fridge door | `kn_prop_magnet`, `kn_prop_paper_sheet` (crayon-drawing decals) |
| A crayon drawing taped to a cabinet | Upper cabinet door left of the window | `kn_prop_paper_sheet` |
| Cereal boxes ×3 (invented designs) | On top of the fridge, plus the existing "MORNING CRUNCH" box re-dressed | `kn_prop_cereal_box` |
| Fruit bowl | The existing island bowl, re-dressed (more fruit, a banana) | existing prop |
| Plants | Trailing plants on the upper cabinets, a tall plant by the doorway (outside the Room bounds), herbs on the sill (existing pot) | `kn_prop_plant_trailing`, `kn_prop_plant_tall` |
| Utensils | Wall rail above the stove (spoons, spatula, ladle, whisk; no knives) | `kn_prop_utensil_rail` |
| Cookbooks and mugs | A wall shelf above the back counter | `kn_prop_wall_shelf`, `kn_prop_book`, `kn_prop_mug` |
| Tea towel | Oven door rail | `kn_prop_tea_towel` |
| Calendar and notes | Beside the doorway | `kn_prop_paper_sheet` |
| Window light shafts | Through the window | The existing haze (§2.3) becomes D79 sun shafts on 12 GB and up; 4 GB and 8 GB keep a uniform haze at 0.004 / m |

- **Scale:** kit props are authored 1 : 1 and instanced at **5 : 1** here (§7).
- **Grade:** `lut_kitchen_morning` stays; density zoning (§0.10) applies, so the dressing sits a stop under the neutral zone.
- **Streaming with the pass:** Env VRAM ≤ 245 MB (4 GB, kit sets at 512²) · ≤ 480 MB (8 GB) · ≤ 560 MB (12 GB) · ≤ 660 MB (16 GB).
- Counter tops stay as they are: dressing there would need new colliders, which D78 rules out.
- **Built (M3, E3b):** in `env_kitchen.py` `maximalism()`, render-only through the props kit at 5 : 1. The existing "MORNING CRUNCH" box and the fruit bowl are re-dressed in place on their M2 colliders; the cookbook-and-mug shelf sits **above the uppers** (board top Z 11.5) instead of over the counter, so it is out of reach as the rule above requires; the tall plant stands by the doorway at (−27, −25.5). `env_kitchen.ts` boxes and spheres are byte-identical to M2 (diffed); only the stats comment and two additive light fields (`shaftsMinTierGB`, `lowTierHaze`) changed. LOD0 123,104 → 153,572 tris.

---

## 3. THE TINKER LAB
`env_tinker` · Environment · Ship M3 · default environment for Desk and Room ([D78](../../dev/DECISIONS_2026-10-24.md))

**Concept and mood.** Late afternoon in a science classroom that doubles as a workshop, after everyone has gone home. A long hardwood workbench with a gridded cutting mat, a green chalkboard and blueprint posters behind it, shelves of books, beakers and jars, a globe, potted plants, pegboard tools, enamel pendant lamps, and a wall of tall windows letting in low golden sun. MOCHI is asleep at the end of the bench. Warm, busy and lived-in ("science class maximalism"), but the mat in the middle is clean: the machine is still the hero. Everything is built in the bevelled toy style, never photoreal. It is also the backdrop for the lobby and the title.

| Spec | Value |
|---|---|
| Presets | **Desk, Room.** The default environment for both (the Studio stays the clean "product shot" option). Until it ships in M3, the Studio is the default |
| Scale | **Real scale (1 : 1)** ([D82](../../dev/DECISIONS_2026-10-24.md): the engine follows the approved key art `art/style-samples/tinker_lab_key.png`). The bench is the key art's 3.0 × 1.0 m bench with its top at 0.90 m. Parts, critters and kit props (§7) are all real size. *Cheap to revert:* the set scale is one constant in `env_tinker.py` |
| Set coordinates | Origin = Room bounds floor centre. Back wall face Y = +8.4 (its right half is the window wall, so the key light comes from **behind-right**), side wall faces X = −8.4 / +8.4. Front open (cutaway). The key art's bench-centred frame maps to set space by (−0.05, +6.45, 0) |
| Room bounds | X −8…+8 · Y −8…+8 · Z 0…8 (set coords) |
| Desk bounds | **X −2…+2 · Y +4.93…+7.93 · Z 0.904…3.904** (set coords), centred on the cutting mat. Desk world origin = the mat top centre, set (0, +6.43, +0.904) |
| Ceiling | **None.** Open-top cutaway like the Kitchen; the walls stop at 3.2 m (oak-capped). Walnut beams at the wall top carry the pendants. An invisible **shadow-only roof** (`__shadowonly`, drawn into the sun's shadow maps only) keeps the sun coming in through the windows, with a **lantern opening** placed so the sun also lands on the Room build zone (§3.4) |
| Physics defaults | Gravity **Earth 100 %** · Air **100 %** · Feel **Real** · no zones |
| Surfaces | Floor `kn_env_floorboards` (a muted, limed oak so the zone out-saturates it, §0.10) · walls `kn_env_plaster_warm` over a green enamel wainscot `kn_env_wainscot` to 0.95 m with an oak chair rail (the key art's wall) · bench top `kn_env_bench_oak` · mats `kn_env_cutting_mat` + `_grid` · chalkboard `kn_env_chalkboard` with `kn_env_chalk` (shared_kit §7.3) |
| Density zoning | §0.10: the mat (Desk) and the floor mat (Room) are the build zones; the bench ends, the flanking cabinets, stools and shelves are the clutter ring; the back wall, bookcases and windows are the far background |
| Budget | Room ≈ 380k tris LOD0. **Built: 314,977 LOD0** (LOD1–3 116,659 / 78,290 / 22,894), backdrop 6.3k, scale references 7.6k. Desk uses the same package |

### 3.1 Set geometry (set coordinates)

| Element | Position / size (2 : 1) | Notes |
|---|---|---|
| Floor | Whole room, Z = 0; oak boards 0.15 m wide running along X, staggered seams, over a walnut subfloor (the cutaway edge) | `kn_env_floorboards`, satin, 3 mm board-edge chamfers (LOD0) |
| Floor mat (Room build zone) | X −4.2…+4.2 · Y −5.2…+3.2 (8.4 × 8.4 m), 3 mm proud of the floor | `kn_env_cutting_mat` + `_grid`: the same green, grid and ruler ticks as the bench mat, the grid aligned to the Room origin |
| Long workbench (the key art's) | X −1.55…+1.45 · Y +5.95…+6.95, top Z 0.90 m, 0.07 m thick | Butcher-block oak top `kn_env_bench_oak`, walnut legs, back rail and a lower shelf at 0.18 m. The landmark |
| Cutting mat (Desk build zone) | X −1.15…+1.15 · Y +6.02…+6.84 (2.3 × 0.82 m, the key art's mat) on the bench top, top Z 0.904 | Self-healing green mat. **Its printed grid is the build grid:** minor lines every 0.1 m (one cell), major every 0.5 m, aligned to the Desk origin, ruler ticks along the front edge. Low contrast so the Build-mode `beam` grid always wins |
| Flanking cabinets | Left X −3.45…−2.05 (shade side), right X +2.35…+3.65 (sun side, top 0.904 = the mat), Y +5.95…+6.9 | Bone drawer banks, oak tops, brass pulls. Left: the tall dressing (globe, microscope, book stack, test-tube rack, glassware). Right: low things and the Desk scale reference |
| Back wall | Y +8.4, X −8.55…+8.55, to Z 3.2 (oak cap) | Plaster over the green enamel wainscot (0.95 m), oak chair rail and skirting |
| Chalkboard | Back wall, X −0.75…+1.55, Z 1.275…2.425 (the key art's board), oak frame and chalk tray | Chalk as flat geometry (`kn_env_chalk`, DejaVu Sans Bold): "EVERY ACTION HAS AN / OVERREACTION!", "F = m · a → KABOOM", "Δt ≈ 0.42 s", the ramp-ball-domino sketch and a doodle of MOCHI |
| Posters and pinboard | Blueprint (cog drawing, "BUILD RUN REWIND") at X −1.55; "SAFETY FIRST* / *then fuses" at X −2.6; corkboard at X −2.65; kit posters on the left run and the side walls | Invented designs only |
| Wall shelf | Behind the bench, X −2.35…+1.65, board top Z 1.075 (the key art's shelf) | 4 × `kn_prop_wall_shelf` filled with books, jars, beakers, trailing plants |
| Window wall | Back wall right half: five windows X +1.7…+7.9 (1.0 m wide, 0.3 m piers), sill Z 1.0, head Z 2.85 | Oak frames, centre mullion and two transoms, `kn_glass`, oak sills with plants. Frames and glass cast **no shadow** (`__noshadow`), so the sun patches are clean |
| Radiators and window seat | Cast-iron radiators under the first two windows; an oak window seat with `kn_fabric_cobalt` cushions under the other three (Y +7.85…+8.4, seat 0.4 m) | `kn_anod_graphite` stands in for `kn_iron_cast` until that master exists |
| Bookcases | Back wall left run (X −4.1, −5.15) and the whole left wall (8 units, Y −3.5…+3.6) | `kn_prop_shelf_unit` filled with books, jars, beakers, spools; a globe, an orrery, crates and trailing plants on top |
| Pegboard workshop | Back wall X −8.3…−5.8: a low cabinet run with two pegboards and hung tools | `kn_prop_pegboard`, `kn_prop_hand_tool`, toolbox, vice, parts drawers, clamp |
| Right wall | Coat hooks, the wall clock (Z 2.35), a corkboard, a poster; the teacher's trolley at (+6.6, +3.0) | Kit props; the trolley carries glassware |
| Beams | Two walnut beams at the wall top (Z 3.2) over the bench (Y +6.55, +7.05), two along Y over the side aisles (X ±6) | The bench beams hang over the Desk zone and are visual only; the side beams collide |
| Pendant lamps ×7 | Over the bench at the key art's positions (bulbs at (−0.40, +6.50, 2.0), (+0.90, +6.60, 2.05), (+2.55, +7.05, 2.2)), plus four over the side aisles (X ±6, bulbs at 2.5) | `kn_prop_lamp_pendant` variant 0 (the key art's green enamel), cords to the beams, `__noshadow`. Visual only |
| Window backdrop | Outside the windows | Sunlit schoolyard: a warm sky card (`kn_env_backdrop_warm`), soft trees, a low fence, grass; `__noshadow` (the sun is behind it) |

### 3.2 Layout per preset

| Preset | Build zone (neutral zone) | Camera target | Default camera | Scale reference | Drone spawns P1 / P2 |
|---|---|---|---|---|---|
| Desk | **The key art's 2.3 × 0.82 m cutting mat** (D82: real scale; the mat, not the whole 4 × 3 m bounds, is the zone; a body that leaves the bench leaves the bounds and sleeps) | Desk (0, 0, 0.3) = set (0, +6.43, 1.204) | Desk (0, −4.63, 2.66), distance 5.2 m, elevation 27° (the Studio's Desk camera). **Hero camera = the key art's** (`cameras.hero`: set (−0.50, +4.00, 1.78) → (+0.03, +6.67, 1.08), 30 mm, focus 2.75 m, f/2.4), plus `wide` and `lobby` | Set (+3.0, +6.30, 0.904): on the right cabinet, 1.85 m from the mat's front-right corner, off the hero frame | Desk (−1.2, −2.4, 1.6) / (+1.2, −2.4, 1.6) |
| Room | The floor mat, **X −4…+4 · Y −5…+3** (8 × 8 m inside the 8.4 m mat) | (0, −1, 0.5) | (0, −12.5, 7.15), distance 13.3 m, elevation 30° (through the open front) | (+5.5, −6.0, 0) | (−3, −9, 3) / (+3, −9, 3) |

Clutter ring per preset (§0.10; the sun now comes from behind-right, so the sun side is +X and the back):
- **Desk:** the bench ends and the flanking cabinets. **Sun side (+X end and the right cabinet):** low things only near the mat (a mug, a pencil cup, a book stack, a notebook, the tape dispenser), so their shadows fall away from it. **Shade side (−X end and the left cabinet):** the tall dressing: the globe, a microscope, a book stack, a test-tube rack, glassware, a succulent, and **MOCHI asleep** at the bench's left end (glb origin set (−1.36, +6.30, 1.0), clip `sleep`), off the mat. Behind the mat: the wall shelf and the chalkboard (far background, soft in DOF).
- **Room:** stools at the bench ends, the bench and its cabinets, the teacher's trolley on the right (X +6.15…+7.05), the window seat and a rug under the windows, the left wall of bookcases with a reading rug and two chairs, tall plants on the side walls at Y ≈ −4.8. **Front edge (Y < −5.5):** floor dressing only (crates, card boxes, nothing over 0.6 m), so the default camera sees in.

### 3.3 Landmark props

| Prop | Class | LOD0 tris | Materials | Collision |
|---|---|---|---|---|
| Long workbench (key art) | **E-H** | 48,000 | `kn_env_bench_oak`, `kn_wood_walnut`, `kn_env_cutting_mat` | `COL__box` top, mat, legs ×4, rail, lower shelf (`wood`) |
| Window wall (frames, sashes, sills) | **E-H** | 40,000 | `kn_wood_oak`, `kn_glass` | `COL__box` sills, glass planes (`glass`) |
| Chalkboard with frame and tray | E-L | 12,000 | `kn_env_chalkboard`, `kn_wood_oak`, decals | part of the back-wall `COL__box` |
| Window seat + radiators | E-L | 14,000 | `kn_wood_oak`, `kn_fabric_cobalt`, `kn_iron_cast` | `COL__box` ×3 |
| Teacher's trolley with glassware | E-M | 7,000 + kit | `kn_powder_bone`, `kn_rubber` wheels, kit glassware | `COL__box` |
| Timber beams ×6 | E-M | 2,000 each | `kn_wood_walnut` | none (above the bounds) |
| Walls and dado | E-L | 20,000 | `kn_env_plaster_warm`, `kn_wood_oak` | `COL__box` per wall |
| **MOCHI asleep** (ambient display copy) | linked `critters/mochi.blend` LOD chain | — | Mochi's own set | static `COL__capsule` (`fur`) |
| Window backdrop card | E-B | 10,000 | baked 2048² | none |
| Dressing | kit | — | §7 | §7 |

**The ambient MOCHI** is a display copy, like the THUD on the scale reference: not a critter, not in the sim's AI, never saved. It loops the `sleep` clip and twitches an ear on nearby impacts (cosmetic, from the event stream). It **hides whenever the world contains a MOCHI part**, so there is never a second cat.

**Interactive rule:** as in the Kitchen, set pieces are static and nothing reads as a part (§7).

### 3.4 Lighting rig
Golden hour ([D78](../../dev/DECISIONS_2026-10-24.md), [D79](../../dev/DECISIONS_2026-10-24.md)). One preset in M3.

| Element | Spec |
|---|---|
| Sun (through the windows) | Directional, **from behind-right through the back-wall windows** (D82, the key art's sun): it travels along set (−0.5, −1.0, −0.42), i.e. engine `sunDir` (−0.418, −0.351, 0.837): elevation ≈ 20.6°, 26.6° right of straight back. **3,500 K** (colour (1.0, 0.74, 0.47)), 30k lux, light angle 1.2°, CSM. Window frames, beams, pendants and the yard backdrop are `__noshadow`. The **shadow-only roof** (Z 3.32) stops the sun coming in over the cutaway walls; its **lantern opening** (set X −0.05…+7.95 · Y +2.9…+8.55, the Room zone pushed back along the sun ray) puts the sun on the Room build zone. Result: the Room zone is sunlit over its front 5.7 m and catches the window patches on its back 2.3 m; the Desk mat gets the key art's light (window patch on its right half, the pendants overhead) |
| Window sky | Emissive card behind the windows, warm `#FFD9A0` (`kn_env_backdrop_warm`; the key art's sunlit sky); **the fill is the cool sky** `#AEBACF` (world / IBL), as in the key art |
| Practicals | The 7 pendants: **2,700 K**, 1,600 lm each, unshadowed except the centre bench pendant (shadowed on 12 GB and up); bloom on the bulbs (`kn_env_bulb`) |
| Interior fill | Probe GI (12 GB and up) + box-projected reflection probes (4: bench, left, right, centre) and a GI volume over the room (`env_tinker.ts` `probes` / `giVolume`); warm bounce from the oak and the Bone drawers |
| Volumetrics | Froxel fog 0.010 / m, anisotropy 0.65: **light shafts** through the windows on 12 GB and up, with dust motes in the shafts (≤ 2k ambient particles; hand to vfx.md). 4 GB and 8 GB: a uniform haze at 0.003 / m, no shafts |
| IBL | `ibl_tinker_lab`: **baked by `tools/blender/env_tinker.py`** from this set (LOD0 + backdrop) and the key-art rig with Cycles: `assets/build/env/tinker/ibl_tinker_lab.hdr` (equirect 2048 × 1024 Radiance HDR, centre column facing the back wall) + `.json` with SH9 (also in `env_tinker.ts`). The renderer derives its 256² cube and mips from it (RENDERING §6.2) |
| Exposure | EV100 9.5, auto exposure ±0.5 EV |
| Grade | Khronos PBR Neutral, then `lut_tinker_lab` (`lut_tinker_lab.png`, 32³ as a 1024 × 32 strip, display space): **the key art's grade** (D82 wins over the old "teal shadows" note): lift (1.0, 0.99, 0.97) and gain (1.05, 1.0, 0.93) as in `render_tinker_lab.py`, a gentle S-curve toward AgX High Contrast, saturation 1.04. Vignette 0.15, grain 0.02 (RENDERING §9) |
| Camera | Tilt-shift DOF in Build and Run (RENDERING §9); full DOF in Photo mode and the lobby. The hero / wide / lobby views carry focus distance and f-stop |
| Value check | §0.10, measured on the Cycles look-dev from the Room spawn camera (`render_tinker.py --value-check`): the zone sits **1.3 EV brighter** than the set around it (pass, 1 ± 0.3) and its display chroma is higher than the set's. HSV saturation over-rates the dark oak, so the check uses chroma (max − min); see M3_NOTES_E3b |

**Key art.** `tools/blender/render_tinker_lab.py` builds the Cycles key art from the exported part `.glb`s (views `hero`, `wide`, `lobby`): `art/style-samples/tinker_lab_key.png` (hero, 1920 × 1080) and `tinker_lab_lobby.png` (the shallow-focus lobby and title backdrop). The in-engine frame of the hero shot is reviewed side by side with it (D79 proof).

### 3.5 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets | Desk, Room | Desk, Room | Desk, Room | Desk, Room |
| Packages | 1 resident (one set serves both presets) | same | same | same |
| Env VRAM (incl. kit) | ≤ 0.24 GB (2048² top mips dropped; kit trims and E-M sets at 1024²) | ≤ 0.42 GB | ≤ 0.5 GB | ≤ 0.6 GB |
| Light shafts / dust motes | — / — | — / — | on / 1k | on / 2k |
| Props far from the active bounds | Desk: everything more than 8 m from the bench is LOD2 | same | same | same |

### 3.6 Collision
- Floor: one `COL__box` 64 × 64 m, 1 m thick, top at Z = 0, `phys = wood` (friction 0.50, restitution 0.25, SIMULATION §4.3). The floor mat is printed on it; PVC uses the same values, so no separate shape.
- Bench: `COL__box` top, the cutting mat (9 mm, its top is the Desk floor y = 0), legs, rail and lower shelf. In the Desk preset a body that falls off the bench leaves the bounds and sleeps (§0.6); in Room it lands on the floor.
- Walls, window sills and glass, window seat, cabinets, bookcases, stools, chairs, trolley, side beams: `COL__box`. The bench's back edge is 1.45 m from the wall, so a ball can drop behind it.
- Kit props on the bench and the cabinets use their kit collision (§7); shelf contents, sill plants, wall art and everything above the build height or outside the bounds have none. **The bench beams, the pendants and their cords hang over the Desk zone and are visual only** (as the Kitchen's pendants are), so the zone stays collider-free.
- The ambient MOCHI: a capsule in `env_tinker.ts` `mochi.capsule` (r 0.10, half-height 0.08, `phys = fabric`; the sim has no `fur` material), kept out of `boxes` so it can be removed with the display copy.
- Built: **193 boxes + 3 spheres per preset** (190 shared + each preset's scale reference), plus the MOCHI capsule. `packages/assets/test/tinker.test.ts` checks every one sits on visible LOD0 geometry.

### 3.7 Audio ambience hooks

| Hook | Emitter | Notes |
|---|---|---|
| `amb_tinker_room` | global | Warm, still classroom tone; a distant, wordless playground murmur through the glass (AUDIO §9), −46 LUFS |
| `amb_tinker_clock_tick` | `EMIT__amb__clock` | 1 Hz tick from the wall clock above the chalkboard |
| `amb_tinker_mochi_purr` | `EMIT__amb__mochi` | Soft purr and an occasional sleepy chirp, 3 m radius. Silent while the ambient MOCHI is hidden |
| `amb_tinker_pendant_hum` | `EMIT__amb__pendant_n` | Faint filament buzz, 2 m radius |
| `amb_tinker_radiator` | `EMIT__amb__radiator_n` | An occasional tick or knock (seeded, every 20–60 s) |
| `amb_tinker_window` | `EMIT__amb__window` | Birds and leaves outside, a far-off school bell every few minutes (seeded) |
| Reverb baseline | — | Classroom, RT60 0.8 s, wood and plaster |

**Read at a glance.** From the Room camera: the golden window wall on the left, the long oak bench and the green chalkboard behind the mat, bookcases on the right, MOCHI curled up at the bench end. **Don'ts.** No real brands, logos, school names or real textbook covers; invented text only. Nothing that reads as a part within reach (no balls, dominoes, candles, burners, batteries, fans, desk lamps, magnifiers, scissors, knives or saws). Nothing on the mats. No grime, chalk mess, graffiti or wear beyond ART_BIBLE §4.

---

## 4. BACKLOT
`env_backlot` · Environment · Ship M3

**Concept and mood.** A film studio's outdoor backlot on a summer afternoon: rolling sculptable grass between soundstages, a water tower, a western street facade, light towers and apple boxes. Wind moves the trees and drives Air. It's the world for kilometre-scale machines, and it runs from afternoon to dusk and night.

| Spec | Value |
|---|---|
| Presets | **Arena, Megastructure.** Arena = the central 256 m of the same lot |
| Scale | Real (1 : 1) |
| Set coordinates | Origin = Megastructure bounds floor centre. Arena bounds X −128…+128 · Y −128…+128 · Z 0…64 (set coords, same origin) |
| Physics defaults | Gravity **Earth 100 %** · Air **100 %** · Feel **Real** · **Wind** world setting set by the Weather preset (§4.5; default Calm, 0 m/s) |
| Terrain | Sculptable heightfield (§4.2). Terrain tool (raise / lower / flatten / smooth) is enabled in this environment only |
| Default ToD | **Afternoon** (§4.4) |
| Budget | Arena ≈ 650k tris LOD0 in the bounds + backdrop · Megastructure ≈ 1.0M resident (streamed, HLOD beyond rings) |

### 4.1 Layout (set coordinates)

| Element | Position | Notes |
|---|---|---|
| Default ground | **Z = 4.0 m (Arena) / Z = 16.0 m (Megastructure)** above the bounds floor, so players can dig 3.5 / 15.5 m down (a 0.5 m bedrock skin is never removable) | Max raise: Z = H − 8 m (56 m Arena, 248 m Mega) |
| Central plateau | 64 × 64 m flat at default ground, centred on the origin | Contains both neutral zones |
| Neutral zone (Arena) | X −16…+16 · Y −16…+16 (32 × 32 m) | Short mown grass, perfectly level |
| Neutral zone (Mega) | X −32…+32 · Y −32…+32 (64 × 64 m) | Same |
| Spawn (Arena) | Target (0, −8, 5) · camera (0, −62, 36), distance 62 m, elevation 30° | Looks north at the water tower |
| Spawn (Mega) | Target (0, −8, 17) · camera (0, −98, 69), distance 104 m, elevation 30° | |
| Scale reference | (+19, −19, default ground) (Arena) · (+35, −35, default ground) (Mega), beside a director's chair prop | |
| Drone spawns | Arena (∓8, −50, 24) · Mega (∓12, −80, 45) | |
| Water tower (landmark) | (+70, +82), 30 m to the tank top | Inside Arena bounds; buildable legs and catwalk |
| Light towers ×4 | (±96, ±96), 18 m | Practical lights for Dusk / Night |
| Camera crane | (−42, +34) | Arm 12 m, static pose |
| Trailer row ×3 | (−92, −60) … (−92, −20) | |
| Rolling terrain | ±3 m swells outside the plateau (Arena); a 20 m ridge along Y +110…+128 | |
| Soundstage row ×6 | Y +170…+230, X −250…+250 | **Backdrop for Arena** (outside bounds, no collision); **inside Mega bounds** with `COL__box` walls and roofs (buildable) |
| Western street (8 facades) | X −380…−260, Y −120…+40 | Mega only (inside bounds, buildable porches and roofs) |
| City-street facades (6) | X +260…+400, Y −200…−60 | Mega only |
| Dry creek bed | Meanders from (−512, +300) to (+512, −280), 6 m deep in the default terrain | Mega only. A ready-made canyon for runs |
| Quarry pit | Centre (+260, +330), 120 m across, floor at Z 4 m | Mega only. The deepest default dig |
| Tree belts | Y > +100 and X < −110 (Arena); scattered groves (Mega) | Never within 20 m of a neutral zone |
| Backdrop | Hills to 600 m out + a stylised city skyline card at 2 km, haze-faded | E-B, no collision |

### 4.2 Terrain spec

| Spec | Value |
|---|---|
| Heightfield resolution | **0.5 m** (GAME_SPEC §7.3). Arena 512 × 512 quads (513² samples); Megastructure 2,048 × 2,048 quads (2,049² samples) |
| Storage | u16 over the bounds height: 0.98 mm steps (Arena), 3.9 mm steps (Mega). Sim-owned and deterministic; strokes are `terrain.stroke` ops |
| Physics | `COL__heightfield__<cx>_<cy>` per 32 m chunk, 65 × 65 samples, `phys = soil` (rock layer areas `phys = concrete`), §0.6 |
| Render mesh | GPU geometry clipmap sampling the same height texture: 6 levels, 128² vertices per level, finest 0.25 m (bicubic-refined between samples), plus a 1024² tiling detail normal per layer |
| Layers (4) | **Grass** `kn_env_grass` · **Dirt** `kn_env_dirt` · **Sand** `kn_env_sand` · **Rock** `kn_env_rock`. Each: 2048² BaseColor / Normal / ORM tiling (+ height in BaseColor alpha for height-blending). Stylised: flattened albedo, chunky toy-like normal detail, no photo noise |
| Layer rules (procedural; there is no paint tool) | Rock where slope > 38° (8° soft blend) · Sand in basins below default ground − 1.0 m and in the creek bed · Dirt on the "disturbed" mask (§ below) and on paths · Grass everywhere else |
| Disturbed mask | R8 texture at heightfield resolution. Raise / lower strokes write 1.0 under the brush, which decays back to grass over 3 run-stop cycles. Cosmetic only (never read by the sim) |
| Splat / mask textures | Arena 512² RGBA8; Mega 2048² RGBA8, at 0.5 m per texel. These and the r16 height textures are runtime engine textures generated from sim state, outside the authored texture arrays (so the ASSET_PIPELINE §5.3 size classes don't apply) |
| Triplanar | Rock layer triplanar above 50° slope; the others planar |
| Grass cover | GPU-instanced blade clumps (3 cards, 24 tris each) within the radius below, wind-driven, cleared under placed parts' footprints |
| Paths | Dirt service roads (6 m wide) are spline-authored dirt bias in the default mask, not geometry |

| | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|
| Grass clump radius | 40 m | 80 m |
| Grass clumps resident | 150k | 400k |
| Clipmap levels | 6 | 7 |

### 4.3 Props

| Prop | Class | LOD0 tris | Materials | Collision |
|---|---|---|---|---|
| Water tower | **E-H** | 60,000 | `kn_powder_bone` tank with an Ignition band, `kn_steel_brushed` legs, `kn_wood_oak` catwalk | `COL__cylinder` tank, `COL__box` legs ×4, catwalk `COL__box` |
| Soundstage (each, 6 variants by door and sign) | E-L (Mega) / E-B (Arena) | 18,000 | `kn_env_concrete`, `kn_powder_graphite` doors, decal "STAGE 1–12" | `COL__box` ×3 (Mega only) |
| Western facade (each, 8) | E-L | 20,000 | `kn_wood_oak`, `kn_wood_walnut`, `kn_powder_amber` signs | `COL__box` ×6 |
| City facade (each, 6) | E-L | 22,000 | `kn_brick`, `kn_powder_cobalt` trims, `kn_glass` | `COL__box` ×5 |
| Light tower ×4 | E-L | 12,000 | `kn_steel_brushed`, `kn_powder_graphite` lamp heads | `COL__box` ×2 |
| Camera crane | E-L | 18,000 | `kn_powder_graphite`, `kn_powder_ignition` counterweight | `COL__box` ×3, `COL__capsule` arm |
| Trailer ×3 | E-L | 15,000 | `kn_powder_bone`, `kn_steel_brushed` | `COL__box` ×2 |
| Director's chair (by the scale reference) | E-S | 1,500 | `kn_wood_oak`, `kn_fabric_ignition` | `COL__box` |
| Apple boxes (full, half, quarter, pancake) | E-S | 300 | `kn_wood_oak` | `COL__box` |
| Sandbag | E-S | 400 | `kn_fabric_bone` | `COL__hull` |
| Hay bale | E-S | 800 | `kn_env_hay` | `COL__box` |
| Fence (4 m section) | E-S | 600 | `kn_wood_oak` | `COL__box` ×2 |
| Oak tree (3 variants) | E-M | 8,000 + impostor | `kn_wood_walnut` bark, `kn_env_foliage` | `COL__capsule` trunk only |
| Poplar tree (2 variants) | E-M | 6,000 + impostor | same | `COL__capsule` |
| Bush (4 variants) | E-S | 1,500 | `kn_env_foliage` | none |
| Rock outcrop (6 variants) | E-M | 5,000 | `kn_env_rock` | `COL__hull` ×1–3 |
| Road signs, cones, cable ramps | E-S | 300–900 | Powder + decals | `COL__box` |
| Backdrop hills, skyline card | E-B | 40,000 total | baked 2048² | none |

Trees beyond 60 m are octahedral impostors (12 × 12 views, 2048²), same baker as parts.

**Built (M3, E3b; `tools/blender/props/env_backlot.py`, `node tools/assets.mjs --env-backlot`):** the four terrain layer sets (`assets/build/env/backlot/terrain/terrain_<layer>_{basecolor,normal,orm}.png`, 1024² tiling over 4 m, height in base-colour alpha), the dressing kit `backlot_dressing.glb` (water tower, light towers, trailers, director's chair, apple boxes, sandbags, hay bales, fences, oaks, poplars, bushes, rock outcrops, cones, soundstages) and `backlot.json`: the layer rules, grass cover, roads and 175 Arena placements with their colliders, set on **S3's own default lot** (`packages/format` `defaultTerrain('arena')`, exported by `export_default_lot.ts`). The camera crane, city / western facades and Megastructure-only features are not built yet.

### 4.4 Lighting rig and time-of-day presets
Sun + physically based procedural sky (single-scattering atmosphere), baked to the IBL cube on ToD change and on every 5° of sun movement. CC0 HDRIs are not required.

| Preset | Sun elev. / azimuth | Sun colour | Sun illuminance | Sky | Fog (froxel) | Exposure EV100 | Practicals |
|---|---|---|---|---|---|---|---|
| Morning 08:30 | 25° / 100° (east-southeast) | 4,800 K | 60k lux | Turbidity 2.5, cool zenith | 0.006 / m low ground mist (first 3 m) | 14.0 | off |
| **Afternoon 15:00 (default)** | 50° / 220° | 5,600 K | 100k lux | Turbidity 2.2 | 0.0015 / m | 15.0 | off |
| Golden hour 18:45 | 8° / 285° | 3,400 K | 25k lux | Turbidity 3.0, warm horizon | 0.004 / m, anisotropy 0.7 | 13.0 | off |
| Dusk 19:45 | −4° / 295° (below horizon) | sky only: zenith 7,500 K, horizon glow 2,800 K | sky 400 lux | Afterglow | 0.003 / m | 9.0 | Light towers + 12 lot lamps on |
| Night 23:00 | Moon 40° / 160° | `#9DB4FF` (stylised blue; real moonlight is ≈ 4,100 K) | 4 lux (stylised; real moonlight is ~0.3) | Star field, no Milky Way | 0.002 / m | 4.0 | Light towers 6,500 K, 40k lm, 4 shadowed; lot lamps 3,000 K |

- Auto exposure range ±1 EV around the preset. LUT per preset (`lut_backlot_<tod>`).
- ToD is a world setting (`env.update`), cosmetic only; it never changes the sim.
- Shadow: 4-cascade CSM, splits 8 / 32 / 128 / 512 m on 16 GB (Mega) and 6 / 24 / 80 / 256 m on 12 GB (Arena).

### 4.5 Weather presets (wind feeds the Air channel)

| Preset | Mean wind | Gusts (seeded, deterministic) | Direction default | Art response |
|---|---|---|---|---|
| **Calm (default)** | 0 m/s | none | — | Trees idle sway only, grass still |
| Breezy | 3 m/s | ±1 m/s, 6–12 s period | from −X (west) | Leaves flutter, grass waves at 0.3 Hz |
| Gusty | 6 m/s | to 10 m/s, 3–8 s period | from −X | Strong sway, grass bend 30°, dust motes stream |
| Overcast | 2 m/s | ±0.5 m/s | from −X | Sun illuminance × 0.25, sky turbidity 8, soft shadows (light angle 12°) |

Each preset writes the world **Wind** setting (GAME_SPEC §5.4: 0–15 m/s with a direction, default 0 m/s), which SIMULATION §5.8 applies as a global air-flow term scaled by the world's Air density; the gusts are seeded, so runs stay deterministic. Players can also set Wind directly in world settings; the presets are just named starting points. Gameplay force values are owned by SIMULATION. Art drives sway, grass, motes and flags from the same wind sample, so what you see matches what the Air channel does.

### 4.6 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets | — (needs 12 GB) | — | Arena | Arena, Megastructure |
| Chunks | — | — | 64 (8 × 8) streamed | Arena 64 · Mega 1,024 (32 × 32) streamed |
| Env VRAM | — | — | ≤ 0.75 GB | ≤ 1.0 GB |
| LOD rings | — | — | 64 / 128 / 192 / 320 m + HLOD | 96 / 192 / 320 / 512 m + HLOD to the edge |
| Terrain clipmap resident | — | — | 6 levels | 7 levels |
| Height + mask textures | — | — | Arena 513² r16 + 512² RGBA8 | Mega 2,049² r16 (8.4 MB) + 2048² RGBA8 |

### 4.7 Collision
- Terrain: heightfields per chunk (§4.2). Tree trunks `COL__capsule`; leaves none.
- Buildings (Mega): `COL__box` walls and roofs, so machines can run across rooftops.
- Water tower legs and catwalk: `COL__box`. Tank: `COL__cylinder`.
- Rocks: `COL__hull`.

### 4.8 Audio ambience hooks

| Hook | Emitter | Notes |
|---|---|---|
| `amb_backlot_wind` | global | Wind bed whose gain and filter follow the wind sample (Calm → Gusty) |
| `amb_backlot_trees` | `EMIT__amb__grove_n` (one per grove) | Leaf rustle, gain from wind speed |
| `amb_backlot_birds_day` | groves | Morning, Afternoon, Golden hour |
| `amb_backlot_crickets` | groves | Dusk, Night |
| `amb_backlot_lot_distant` | `EMIT__amb__stages` | Distant studio-lot life: a wordless crew-chatter murmur (AUDIO §9), a golf cart, a far-off "quiet on set" bell, hammering. Sparse, seeded |
| `amb_backlot_water_tower` | `EMIT__amb__tower` | Metal creak in Gusty |
| `amb_backlot_lamp_buzz` | light towers | Dusk, Night only |
| Reverb baseline | — | Open air, slapback from soundstage walls (SDF probes) |

**Read at a glance.** Green plateau, white water tower with an Ignition band, Bone soundstages on the horizon. **Don'ts.** No real studio names or logos (stage signs are numbers only). No litter, ruins or grime.

---

## 5. ORBITAL HANGAR
`env_hangar` · Environment · Ship M5

**Concept and mood.** A clean, bright hangar on an orbital station. White panelled walls, a huge window with Earth turning slowly outside (as built: runtime-lit and turning 1° per minute, D128; M5 shipped a baked, fixed crescent, D112), cool ceiling light strips, warm amber accents at the airlocks, and glowing floor rings that mark zero-g zones. Sci-fi, but the same friendly toy-product language: rounded panels, chunky clamps, visible fasteners.

| Spec | Value |
|---|---|
| Presets | **Warehouse, Arena** |
| Scale | Real (1 : 1) |
| Bounds | Per §0.2 (each preset is its own hangar bay built to fit: Warehouse = "Bay 2", Arena = "Main Hall") |
| Physics defaults | Gravity **38 %** (the "Mars" preset value; the hangar's spin gravity) · Air **100 %** (pressurised) · Feel **Real** |
| Zones | Environment-authored **zero-g zones** (`ZONE__field__zerog_n`, Antigrav volumes at 0 % g), marked by floor rings. Players can disable them in world settings; they cannot be moved |
| Budget | Warehouse ≈ 380k tris LOD0 · Arena ≈ 850k (streamed) |

### 5.1 Layout

| Element | Warehouse ("Bay 2") | Arena ("Main Hall") |
|---|---|---|
| Shell | Floor at Z 0; walls just outside the bounds at X ±33, Y ±33; ceiling at Z 26 | Walls at X ±130, Y ±130; ceiling at Z 68 |
| Window | Back wall (Y +33): 56 × 18 m, Z 3…21, 4 × 2 mullion grid | Back wall: 220 × 50 m, Z 6…56, 8 × 3 grid |
| Neutral zone | X −8…+8 · Y −20…−4 (16 × 16 m) | X −16…+16 · Y −40…−8 (32 × 32 m) |
| Spawn | Target (0, −10, 1) · camera (0, −42, 19.5), distance 37 m, elevation 30° | Target (0, −20, 2) · camera (0, −88, 41), distance 78 m, elevation 30° |
| Scale reference | (+10.5, −21.5, 0) | (+18.5, −41.5, 0) |
| Drone spawns | (∓5, −34, 8) | (∓8, −72, 20) |
| Zero-g zones | 2 × cylinders Ø 12 m × 20 m tall at (−18, +14) and (+18, +14) | 4 × cylinders Ø 24 m × 50 m tall at (±60, +40), (±60, −60) |
| Shuttle (landmark) | Parked on docking clamps at (0, +20), nose toward −Y | Two shuttles at (−70, +80) and (+70, +80) |
| Gantry crane | Ceiling rail along X at Y +6, Z 22 | Rails along X at Y 0 and Y +60, Z 62 |
| Airlock doors | Left and right walls, centred Y −10 | 4 doors, one per wall |
| Cargo containers | Stacks at (−26, −24) and (+26, −24) | 6 stacks along the side walls |

### 5.2 Props

| Prop | Class | LOD0 tris | Materials | Collision |
|---|---|---|---|---|
| Wall panel module 4 × 4 m (instanced) | E-S | 1,800 | `kn_env_panel_white`, `kn_steel_brushed` M8 screws, panel lines 1 mm. *As built (D128):* tone variation per rib run (the full wall height between two ribs; on the ceiling, the strip between two beams), never per panel: 50 % `kn_env_panel_white` `#CCD1D6`, 35 % `_grey` `#C2C7CD` (−0.16 stop), 15 % `_warm` `#C9C9C4` (−0.12 stop) | `COL__box` (wall run, merged per chunk) |
| Floor deck tile 4 × 4 m (instanced) | E-S | 1,200 | `kn_env_deck` (light grey anti-slip) + hazard-stripe decals at zone edges. *As built (D128):* 30 % of rib-sized blocks of tiles in `kn_env_deck_alt` `#93999F` (−0.08 stop); a block touching the neutral zone or its 2 m margin stays `kn_env_deck` (§0.9) | merged `COL__box` per chunk |
| Structural rib (every 8 m) | E-M | 4,000 | `kn_powder_graphite`, `kn_powder_cobalt` accents | `COL__box` ×2 |
| Window frame + mullions | E-L | 20,000 (W) / 30,000 (A) | `kn_powder_graphite`, `kn_glass` | `COL__box` mullions, `COL__box` glass plane |
| Shuttle | **E-H** | 70,000 | `kn_powder_bone`, `kn_powder_ignition` stripe, `kn_anod_graphite` engines, `kn_poly_beam` cockpit | `COL__hull` ×8 + `COL__box` wings |
| Docking clamp ×4 per shuttle | E-L | 12,000 | `kn_powder_amber` (satin: `_gloss` is for hero buttons only, ASSET_PIPELINE §5.1), `kn_steel_brushed` | `COL__box` ×3 |
| Gantry crane + hook | E-L | 25,000 | `kn_powder_cobalt`, `kn_chrome` cable | `COL__box` rail; hook `COL__hull` |
| Airlock door | E-L | 15,000 | Graphite, Amber/Graphite hazard stripes, `kn_screen` status panel | `COL__box` |
| Cargo container 2 × 2 × 4 m (3 colourways: Bone, Cobalt, Ignition) | E-M | 3,000 | Powder + decals "KN-BAY" stencils | `COL__box` |
| Tool cart | E-M | 4,000 | Graphite, `kn_rubber` wheels | `COL__box` |
| Zero-g floor ring | E-M | 4,000 | `kn_steel_brushed` collar, `kn_led` ring (Field colour), `kn_poly_clear` cover | flush with the deck, part of the deck box |
| Wall screen 2 × 1.2 m (×6) | E-S | 600 | `kn_screen`, graphite bezel | none |
| Ceiling light strip 8 m (instanced) | E-S | 400 | `kn_led` driven white | none |
| Earth + atmosphere + clouds | E-B | 20,000 sphere + shell | `kn_env_earth` (stylised: Beam oceans, Volt-tinted-down land `#7DA35A`, Bone clouds) | none |

**Zero-g ring colour:** single player uses the Field colour `#FF3DAE`. In multiplayer, Plasma is Player 2's colour (MULTIPLAYER §8.1), so the rings switch to a dashed white `#EEF1F6` LED pattern plus Field glyph decals every 45°, mirroring the X-ray overlay rule.

### 5.3 Lighting rig

| Element | Spec |
|---|---|
| Sun (through the window) | Directional, elevation 30°, entering from +Y. **5,800 K**, 90k lux, hard (light angle 0.53°), CSM. Grazes the shuttle and draws long window-frame shadows across the deck |
| Earthlight | Large unshadowed directional from +Y, elevation −10° (from below the window line), **9,000 K** `#9CC8FF`, 0.06 × sun. Blue fill on undersides |
| Ceiling strips | Cool **6,500 K** strip lights every 8 m, clustered (Warehouse 48, Arena 220), unshadowed; 4 shadowed area-approximations over the neutral zone |
| Warm accents | **2,700 K** sconces at airlocks and docking clamps (`kn_powder_amber` housings), 16 (W) / 48 (A), unshadowed |
| Floor rings | Emissive only, contribute via GI |
| Window backdrop | Black space with a sparse star field (no nebula), Earth filling the lower 40 % of the window, rotating 1° per minute. *As built (beta, D128):* the renderer lights Earth at runtime with the art-directed 105° phase (a sunlit crescent, D112) and turns it 1° per minute. The texture set holds inputs only: unlit albedo, and a data map with cloud coverage (R), night-lights intensity (G) and a water mask (B). M5 had baked the lighting into the albedo, so the planet didn't rotate |
| IBL | Captured in-engine from the hangar (cube 256², 8 mips, RENDERING §6.2) + box probes up to the tier cap (§0.5: 8 / 16 / 32 on 8 / 12 / 16 GB) |
| Exposure | EV100 11.0, auto ±0.5 EV |
| LUT | `lut_hangar`: slightly cool shadows, neutral highlights |

### 5.4 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets | — (needs 8 GB) | Warehouse | Warehouse, Arena | Warehouse, Arena |
| Chunks | — | 2 × 2, all resident | Arena: 64 streamed | same |
| Env VRAM | — | ≤ 0.45 GB | ≤ 0.7 GB | ≤ 0.95 GB |
| Earth backdrop | — | 2048² albedo + 1024² clouds | 2048² + 2048² | 4096² albedo + 2048² clouds (the one 4096² env texture) |

### 5.5 Collision
Deck: merged `COL__box` per chunk, `phys = steel` (friction 0.40, restitution 0.20, SIMULATION §4.3). Walls and window: `COL__box`. Shuttle: hulls (≤ 12 shapes). Containers and carts: boxes. Zero-g zones are Field zones, not collision.

### 5.6 Audio ambience hooks

| Hook | Emitter | Notes |
|---|---|---|
| `amb_hangar_life_support` | global | Steady air-handler hum and soft vent flow, −44 LUFS |
| `amb_hangar_pa_chime` | `EMIT__amb__pa_n` | Two-tone chime + wordless PA murmur every 60–120 s, plus sparse radio beeps (AUDIO §9) between them (seeded) |
| `amb_hangar_gantry` | gantry | Occasional servo whir (gantry is static; sound only) |
| `amb_hangar_zerog_ring` | each floor ring | Low soft drone, 6 m radius |
| `amb_hangar_window` | window | Silence pocket: ducks the bed by 3 dB within 10 m of the glass |
| Reverb baseline | — | Large metal hall, RT60 2.0 s, the AUDIO §1 IR cap (Warehouse 1.6 s) |

**Don'ts.** No national flags or real agency logos. No grime, scorch or wear on the white panels (soot decals from play are fine and clear on Stop).

---

## 6. MOON BASE
`env_moon` · Environment · Ship M5

**Concept and mood.** Lonely and funny. Flat grey regolith under a hard white sun and a black sky, a lander and a habitat dome as backdrop, Earth low on the horizon. There's no air: Helios sink and Gales do nothing, and that's the joke and the lesson.

| Spec | Value |
|---|---|
| Presets | **Room, Warehouse, Arena** |
| Scale | Real (1 : 1) |
| Physics defaults | Gravity **Moon 16.5 %** · Air **0 %** · Feel **Real** |
| Terrain | **Fixed authored heightfield** (the Terrain tool is Backlot-only, GAME_SPEC §7.3): the base apron is flat, craters and ridges beyond it |
| Budget | Room ≈ 220k tris LOD0 (mostly backdrop) · Warehouse ≈ 380k · Arena ≈ 700k |

### 6.1 Layout (Arena set coordinates; all presets share the origin)

| Element | Position | Notes |
|---|---|---|
| Base apron | Ø 48 m sintered-regolith pad centred on the origin, Z 0 | Covers the Room bounds entirely and the Warehouse neutral zone |
| Neutral zone (Room) | X −4…+4 · Y −5…+3 (8 × 8 m) | On the apron |
| Neutral zone (Warehouse) | X −8…+8 · Y −12…+4 (16 × 16 m) | On the apron |
| Neutral zone (Arena) | X −16…+16 · Y −20…+12 (32 × 32 m) | Apron + flattened regolith ring |
| Spawn | Room: target (0, −1, 0.5), camera (0, −12.5, 7.15), 13.3 m · Warehouse: target (0, −4, 1), camera (0, −34.3, 18.5), 35 m · Arena: target (0, −8, 2), camera (0, −76, 41), 78 m. All elevation 30° (same as the Studio, §1.2) | Earth sits just above the horizon in the default framing |
| Scale reference | Room (+5.5, −6, 0) · Warehouse (+10.5, −13.5, 0) · Arena (+18.5, −21.5, 0) | |
| Drone spawns | Room (∓3, −9, 3) · Warehouse (∓5, −26, 8) · Arena (∓8, −60, 20) | |
| Habitat dome (landmark) | Centre (0, +40), Ø 30 m, 15 m tall | Backdrop in Room (outside), inside Warehouse bounds edge (Y +32 cuts it: collision on), fully inside Arena |
| Lander (landmark) | (−22, +18), 12 m tall | Outside Room, inside Warehouse and Arena |
| Rover | (+20, +6) | Inside Warehouse and Arena |
| Solar arrays ×3 | (+40…+70, +40) | Arena; backdrop for Warehouse |
| Antenna mast | (−60, +60), 25 m | Arena |
| Craters | 1 large (Ø 60 m, 8 m deep) at (+80, −70); 6 medium (Ø 12–25 m); scattered small (Ø 1–4 m, decal + 0.5 m dip) | Large and medium are heightfield; small are normal-map decals |
| Ridges | Along Y +100…+128 (Arena), up to 18 m high | |
| Earth | Elevation 12°, azimuth 25° right of the default view direction, apparent Ø 2° | Backdrop sphere |
| Distant highlands | Backdrop mountains 2–8 km out, no atmosphere haze (crisp) | E-B |

Because the bounds floor is Z 0 and the apron is flat, the Room and Warehouse presets are a flat landing pad with the base around them; the Arena adds craters and ridges.

### 6.2 Regolith terrain spec

| Spec | Value |
|---|---|
| Heightfield | 0.5 m, 65 × 65 samples per 32 m chunk, `phys = regolith` (friction 0.80, restitution 0.05, SIMULATION §4.3). Room uses one 64 × 64 m patch |
| Render | Clipmap like the Backlot (5 levels Warehouse, 6 Arena); finest 0.25 m |
| Material | `kn_env_regolith`: base `#8C8A85` (linear albedo ≈ 0.25; real regolith is darker, lifted for readability), roughness 0.95, Lommel-Seeliger-style retroreflective lift at low phase angles (+15 % near opposition), 2048² tiling BaseColor/Normal/ORM, 1024² micro-pebble detail normal |
| Apron | `kn_env_regolith_sintered`: `#9A968E`, roughness 0.8, 2 m hex-tile seams 15 mm, graphite tie-down rings every 8 m |
| Footprints and tracks | Decals (rover tracks around the apron, astronaut-boot prints near the lander) |
| Boulders | 4 shapes × 3 sizes (0.4, 1.2, 3 m), instanced, `kn_env_rock` with a regolith dust top (vertex-colour blend) |

### 6.3 Props

| Prop | Class | LOD0 tris | Materials | Collision |
|---|---|---|---|---|
| Lander | **E-H** | 60,000 | `kn_powder_bone`, gold foil `kn_env_foil_gold`, `kn_powder_graphite`, `kn_steel_brushed` legs | `COL__hull` ×6, `COL__mesh` legs (2.8k) |
| Habitat dome | **E-H** | 50,000 | `kn_env_panel_white` segments, `kn_poly_amber` windows (glowing warm inside), graphite base ring | `COL__mesh` (3.9k) |
| Rover | E-L | 20,000 | Bone, `kn_powder_ignition` fenders, `kn_rubber_grip` wheels, mesh-wheel look via alpha-free geometry | `COL__box` ×3, `COL__cylinder` ×6 |
| Solar array (each) | E-L | 12,000 | `kn_anod_cobalt` cells, `kn_steel_brushed` frame. *As built (D128):* 6 × 3 one-metre `kn_env_solar_cell` modules with 8 cm gaps over a `kn_env_solar_grid` `#4A5266` backplate 7 cm behind (no fine cell grid: it shimmered at 40–80 m) | `COL__box` ×2 |
| Antenna mast | E-L | 10,000 | Bone, `kn_powder_amber` beacon (slow 0.5 Hz blink) | `COL__box` |
| Supply crates (3 sizes) | E-S | 900 | Bone, Graphite, stencils | `COL__box` |
| Boulders | E-S / E-M | 600–3,000 | `kn_env_rock` | `COL__hull` |
| KNOCK-ON lab pennant (no national flags) | E-S | 800 | `kn_fabric_ignition` (stiffened, no wind), Graphite pole | `COL__capsule` pole |
| Earth | E-B | 20,000 | `kn_env_earth` | none |
| Highlands | E-B | 30,000 | baked 2048² | none |

### 6.4 Lighting rig

| Element | Spec |
|---|---|
| Sun | Directional, elevation **18°**, azimuth 120° (from front-left, raking), **5,900 K**, 120k lux, hard (light angle 0.53°), CSM. Long black shadows are part of the look |
| Sky | Pure black. Sky IBL = star field only (≈ 0 radiance) |
| Earthshine | Unshadowed directional from Earth's direction, `#A8C4FF`, 0.002 × sun |
| Ground bounce | SDF GI from the regolith is the main fill (12 GB and 16 GB). 4 GB and 8 GB: a fixed hemispheric bounce term, 0.08 × sun, from below |
| Practicals | Dome windows emissive 3,000 K; lander floodlights 2 × 5,000 K, 20k lm, shadowed, on a "Base lights" world toggle (off by default) |
| Exposure | EV100 15.0 fixed (no auto exposure: the hard contrast is intentional) |
| LUT | `lut_moon`: neutral, slight cool shadows |

### 6.5 Streaming

| | 4 GB (Low) | 8 GB (Medium) | 12 GB (High) | 16 GB (Ultra) |
|---|---|---|---|---|
| Presets | Room | Room, Warehouse | + Arena | Room, Warehouse, Arena |
| Packages | Room: 1 resident | Warehouse 2 × 2 resident | Arena 64 chunks streamed | same |
| Env VRAM | ≤ 0.2 GB | ≤ 0.4 GB | ≤ 0.65 GB | ≤ 0.85 GB |
| Boulder instances | 400 | 1,500 | 4,000 | 8,000 |

### 6.6 Collision
Heightfield chunks (`regolith`), `COL__box` apron slab (`phys = concrete`), props as listed. Dome and lander legs are `COL__mesh`, so balls roll around them.

### 6.7 Audio ambience hooks
No air means no airborne sound. The audio direction is "listening through a suit radio".

| Hook | Emitter | Notes |
|---|---|---|
| `amb_moon_suit` | global | Faint suit-radio static textures, a slow breathing-fan loop and a very low drone (AUDIO §9), −50 LUFS |
| `amb_moon_dome_hum` | `EMIT__amb__dome` | Low habitat hum, audible within 20 m only (structure-borne) |
| `amb_moon_beacon` | antenna | Soft radio blip synced to the 0.5 Hz beacon |
| Impact treatment | — | Hand to audio: with air 0 %, impacts play as low-passed (800 Hz) structure-borne thumps. If players raise air above 0 %, the normal banks fade back in |
| Reverb baseline | — | None (vacuum). SDF probes disabled for airborne paths |

**Don'ts.** No national flags or agency logos, no real lander designs (keep it an original rounded toy lander). Never add atmosphere haze: the crisp black horizon is the point.

---

## 7. SHARED PROPS KIT (`kn_prop_*`)
`kn_prop_*` · Environment prop · Ship M3 · used by THE TINKER LAB and the MEGA KITCHEN pass ([D78](../../dev/DECISIONS_2026-10-24.md))

**Concept.** About 45 small, well-loved classroom and kitchen things that make the clutter ring maximal: books, glassware, plants, tools, stationery, furniture. Same bevelled toy style and master materials as the parts, never photoreal, no readable real-world brands.

**Rules for every kit prop**
- **Files:** `assets/src/env/_shared/props/kn_prop_<name>.blend`, one prop per file (variants as collections inside). Objects `kn_prop_<name>__<piece>`, with the environment collections of §0.3 (`ENV_RENDER`, `LOD1`–`LOD3`, `COL`). Root properties `kn_prop_class` (E-S / E-M / E-L) and `kn_prop_used_in`.
- **Scale:** authored **1 : 1** (real size). Instanced at **2 : 1** in the Tinker Lab and **5 : 1** in the Kitchen. The bevel rule (ART_BIBLE §2) is measured at 1 : 1.
- **Textures:** texel density 2,048 px/m at 1 : 1 (1,024 px/m in the Lab, ≈ 410 px/m in the Kitchen, where kit props sit in the clutter ring and background). E-S props share four 2048² **kit trims** (paper and card; glass and ceramic; wood and metal; fabric and plants); E-M props add a 1024² unique set; E-L props get a 2048² set (§0.4). All layered over the masters, with the "loved, not grimy" wear of ART_BIBLE §4.
- **Collision:** as listed, used only where the prop stands inside a playable bounds and can be reached; `phys` from the main material. Visual-only placements follow each environment's rules (§2.8, §3.6).
- **Never reads as a part.** No balls, dominoes or tiles, candles, burners, batteries, fans, desk lamps, magnifiers, bells, balloons, loose springs, scissors, knives, saws or toasters. Review every prop next to the Library at 150 px.
- **Text:** invented words only (book spines like "LEVERS" or "MAGNETS", labels, packaging), set in Inter or Unbounded from the decal atlas.
- **LOD:** 50 / 25 / 8 %; E-S props may end at a 12-tri box.

| Prop | Class | LOD0 tris | Materials | Collision | Used in |
|---|---|---|---|---|---|
| `kn_prop_book`: hardback, 3 sizes × 8 cloth tints, closed or open face-up; stacks are instanced groups | E-S | 600 | `kn_cardboard` boards, `kn_paper_tan` pages, spine decals | `COL__box` | Both |
| `kn_prop_notebook`: spiral notebook, closed / open | E-S | 500 | `kn_paper_tan`, `kn_steel_brushed` spiral | `COL__box` | Both |
| `kn_prop_paper_sheet`: loose sheet with tape corners; 12 decals (crayon drawings, sketches, blueprints, notes) | E-S | 50 | `kn_paper_tan`, `kn_decal` | none (flat) | Both |
| `kn_prop_poster`: 0.6 × 0.9 m wall poster, 6 invented designs (simple machines, solar system, parts of a lever, channel glyph chart, cat cartoon, blueprint) | E-S | 100 | `kn_paper_tan` print | none (flush) | Lab |
| `kn_prop_corkboard`: 0.9 × 0.6 m pinboard with notes and pins | E-M | 3,000 | `kn_wood_oak`, cork, `kn_paper_tan`, powder pin heads | none (flush) | Both |
| `kn_prop_cardboard_box`: open / closed / flattened, 3 sizes | E-S | 400 | `kn_cardboard`, tape decal | `COL__box` | Both |
| `kn_prop_cereal_box`: 3 invented designs ("MORNING CRUNCH", "OAT ROCKETS", "COCOA COGS") | E-S | 800 | `kn_cardboard` print | `COL__box` | Kitchen |
| `kn_prop_crayon_box`: open box of crayons in brand colours | E-S | 900 | `kn_cardboard`, `kn_wax` | `COL__box` | Both |
| `kn_prop_beaker`: 3 sizes, optional coloured liquid at a fixed level | E-S | 700 | `kn_glass`, graduation decals, `kn_poly_*` liquid | `COL__cylinder` | Lab |
| `kn_prop_flask`: conical and round-bottom, cork stopper | E-S | 900 | `kn_glass`, `kn_wood_oak` | `COL__cylinder` | Lab |
| `kn_prop_test_tube_rack`: 6 tubes, 3 filled | E-S | 1,500 | `kn_wood_oak`, `kn_glass` | `COL__box` | Lab |
| `kn_prop_jar`: screw-lid jar of buttons, springs, cotton reels or pebbles (never loose) | E-S | 1,200 | `kn_glass`, powder lids | `COL__cylinder` | Both |
| `kn_prop_rock_tray`: compartment tray of labelled mineral samples | E-S | 1,800 | `kn_wood_walnut`, `kn_env_rock`, `kn_paper_tan` | `COL__box` | Lab |
| `kn_prop_microscope`: student microscope | E-M | 6,000 | `kn_powder_bone`, `kn_powder_graphite`, `kn_chrome`, `kn_glass` | `COL__box` ×2 | Lab |
| `kn_prop_globe`: tilted globe on a brass meridian, stylised continents, no labels | E-M | 5,000 | printed globe, `kn_brass`, `kn_wood_walnut` | `COL__sphere` + `COL__cylinder` | Lab |
| `kn_prop_orrery`: static brass solar-system model | E-M | 7,000 | `kn_brass`, `kn_ceramic_*` planets, `kn_wood_walnut` | `COL__cylinder` base | Lab |
| `kn_prop_plant_succulent`: small pot, 3 variants | E-S | 1,500 | `kn_ceramic_*`, `kn_env_foliage` | `COL__cylinder` pot | Both |
| `kn_prop_plant_fern`: medium pot | E-M | 5,000 | `kn_ceramic_*`, `kn_env_foliage` | `COL__cylinder` pot | Both |
| `kn_prop_plant_trailing`: trailing plant for shelf edges and cabinet tops, 2 lengths | E-M | 6,000 | `kn_ceramic_*`, `kn_env_foliage` | `COL__cylinder` pot | Both |
| `kn_prop_plant_tall`: 1.4 m (real) large-leaf floor plant | E-L | 12,000 | `kn_ceramic_bone`, `kn_env_foliage` | `COL__cylinder` pot | Both |
| `kn_prop_pegboard`: 1.2 × 0.6 m hardboard panel with hooks | E-M | 2,500 | `kn_env_pegboard`, `kn_steel_brushed` | none (flush) | Lab |
| `kn_prop_hand_tool`: hammer, screwdriver, pliers, spanner, hand drill (no blades) | E-S | 800 each | `kn_wood_oak`, `kn_steel_brushed`, `kn_iron_cast` | none on the pegboard, `COL__box` on surfaces | Lab |
| `kn_prop_toolbox`: cantilever toolbox, closed | E-M | 4,000 | `kn_powder_ignition`, `kn_steel_brushed` | `COL__box` | Lab |
| `kn_prop_clamp`: F-clamp and C-clamp | E-S | 1,200 | `kn_iron_cast`, `kn_powder_cobalt`, `kn_wood_oak` | `COL__box` | Lab |
| `kn_prop_vice`: bench vice | E-M | 5,000 | `kn_iron_cast`, `kn_powder_cobalt`, `kn_steel_brushed` | `COL__box` ×2 | Lab |
| `kn_prop_spool`: thread and cotton-cord spools, 3 sizes | E-S | 600 | `kn_wood_oak`, `kn_rope` | `COL__cylinder` | Both |
| `kn_prop_parts_drawers`: 12-drawer unit with screw labels | E-S | 1,800 | `kn_poly_clear`, `kn_powder_graphite` | `COL__box` | Lab |
| `kn_prop_paint_tin`: tins (3 sizes) and a jar of brushes | E-S | 900 | `kn_steel_brushed`, print, `kn_wood_oak` | `COL__cylinder` | Lab |
| `kn_prop_crate`: wooden crate, open / lidded | E-S | 700 | `kn_wood_oak` | `COL__box` | Both |
| `kn_prop_pencil_cup`: pencils, rulers, crayons in a tin | E-S | 1,500 | `kn_steel_brushed`, `kn_wood_oak`, `kn_wax` | `COL__cylinder` | Both |
| `kn_prop_mug`: 6 tints, empty or holding pens | E-S | 700 | `kn_ceramic_*` | `COL__cylinder` | Both |
| `kn_prop_drafting_set`: set square, protractor, closed compass, steel rule | E-S | 600 | `kn_poly_clear`, `kn_steel_brushed` | none (flat) | Lab |
| `kn_prop_tape_dispenser` | E-S | 600 | `kn_powder_graphite`, `kn_poly_amber` | `COL__box` | Both |
| `kn_prop_magnet`: fridge-magnet set (fruit, letters, stars) | E-S | 150 each | `kn_ceramic_*`, powders | none (flush) | Both |
| `kn_prop_clock_wall`: school wall clock | E-M | 3,000 | `kn_powder_bone`, `kn_powder_graphite`, `kn_glass` | none (out of reach) | Both |
| `kn_prop_stool`: lab stool | E-M | 3,500 | `kn_wood_oak`, `kn_powder_cobalt`, `kn_rubber` | `COL__box` + `COL__cylinder` | Lab |
| `kn_prop_chair_school` | E-M | 4,000 | `kn_wood_oak`, `kn_powder_ignition` | `COL__box` ×3 | Lab |
| `kn_prop_shelf_unit`: 1 × 2 m (real) open bookcase module | E-L | 9,000 (empty) | `kn_wood_oak`, `kn_powder_bone` | `COL__box` ×5 | Both |
| `kn_prop_wall_shelf`: 1 m (real) shelf on brackets | E-M | 2,000 | `kn_wood_oak`, `kn_iron_cast` | `COL__box` | Both |
| `kn_prop_lamp_pendant`: enamel pendant shade with bulb; a practical light | E-M | 3,000 | `kn_powder_amber` / `_bone`, emissive bulb | none (hung above the bounds) | Both |
| `kn_prop_rug`: 3 sizes, woven stripes | E-S | 500 | `kn_fabric_*` | none (part of the floor box) | Both |
| `kn_prop_coat_hook`: hook rail with a lab coat and a backpack | E-M | 6,000 | `kn_wood_oak`, `kn_fabric_bone`, `kn_fabric_cobalt` | none (flush) | Lab |
| `kn_prop_utensil_rail`: wooden spoons, spatula, ladle, whisk (no knives) | E-S | 1,800 | `kn_wood_oak`, `kn_steel_brushed` | none (on the wall) | Kitchen |
| `kn_prop_tea_towel`: folded / hung | E-S | 400 | `kn_fabric_*` | none | Kitchen |
| `kn_prop_lunchbox`: kid's lunchbox with stickers | E-S | 1,000 | `kn_powder_cobalt`, sticker decals | `COL__box` | Both |

**Count and effort:** 45 props, 28 E-S + 15 E-M + 2 E-L ≈ **33 artist-days** at 0.5 / 1 / 2 days each (PRODUCTION §3).

**Built (M3, E3b):** all 45, 128 variants, procedural in `tools/blender/props/` (`core.py` context + registry; `stationery`, `lab`, `plants`, `workshop`, `furniture`), one `assets/src/env/_shared/props/kn_prop_<name>.blend` each and the kit `assets/build/env/props/kn_props.glb` + `.json` (`node tools/assets.mjs --props --sheet-props` → `art/style-samples/m3_props.png`). Environments bake them into their sets through `SetBuilder.prop()` with the same call emitting the prop's colliders. Four sit over the LOD0 budget because their printed art is geometry until the decal cells exist: `paper_sheet` (236 / 50), `poster` (≤ 780 / 100), `magnet` (≤ 240 / 150) and the springs `jar` (1,352 / 1,200). Cast iron uses `kn_anod_graphite` until `kn_iron_cast` is a master.
