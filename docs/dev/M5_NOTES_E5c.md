# M5 notes: stream E5c, environment art (ORBITAL HANGAR, MOON BASE)

Brief: [environments.md](../art/briefs/environments.md) §0, §5, §6. Contract 4 of [M5_PLAN](M5_PLAN.md) (E5c → W5). Built the
way E3b built THE TINKER LAB ([M3_NOTES_E3b](M3_NOTES_E3b.md)): one procedural Blender script per environment writes the
set glb(s), the source .blend, the Cycles-baked IBL, the LUT and a generated TypeScript data file. Status: **done**.

## What was built

| Deliverable | Files | Measured |
|---|---|---|
| ORBITAL HANGAR, "Bay 2" (Warehouse) | `tools/blender/env_hangar.py` → `assets/src/env/hangar/hangar_warehouse.blend`, `assets/build/env/hangar/hangar_warehouse.glb` (13.7 MB), `ibl_hangar_warehouse.hdr/.json` | LOD0–3 162,160 / 48,964 / 13,030 / 11,136 tris (brief ≈ 380k); backdrop 52,363; rings + scale ref 18,164; 47 boxes, 1 sphere, 11 hulls; 68 light fixtures, 8 renderer spots |
| ORBITAL HANGAR, "Main Hall" (Arena) | `hangar_arena.blend`, `hangar_arena.glb` (38.9 MB), `ibl_hangar_arena.hdr/.json` | LOD0–3 559,493 / 216,120 / 51,428 / 47,256 (brief ≈ 850k); backdrop 52,363; rings + ref 42,348; 90 boxes, 1 sphere, 22 hulls; 272 fixtures, 8 spots |
| MOON BASE (Room, Warehouse, Arena; one set) | `tools/blender/env_moon.py` → `assets/src/env/moon/moon_set.blend`, `assets/build/env/moon/moon.glb` (13.9 MB), `moon_boulders.glb` (7.2 MB, tier extras), `ibl_moon.hdr/.json`, `moon_{room,warehouse,arena}.height.r16/.png`, `terrain/terrain_{regolith,sintered}_{basecolor,normal,orm}.png` (2048², 4 m tile) + `terrain_regolith_detail_normal.png` (1024²) | LOD0–3 284,516 / 114,134 / 34,930 / 15,636 (Arena brief ≈ 700k); backdrop 29,537; per preset 31 boxes, 315 spheres, 107 hulls; heightfields 129² / 129² / 513² (Arena max 20.7 m, 33,065 flat samples) |
| LUTs | `lut_hangar.png` (cool shadows, neutral highlights), `lut_moon.png` (neutral, slight cool shadows) | 32³ as the Tinker 1024 × 32 strip |
| Data | `packages/parts-data/src/env_hangar.ts` (225 KB), `env_moon.ts` (610 KB, mostly the heightfield), `hangar.env.json`, `moon.env.json` | exported from `parts-data/src/index.ts` |
| Renders | `art/style-samples/m5_hangar.png` (Bay 2 hero over spawn), `m5_hangar_arena.png`, `m5_moon.png` (hero over Arena spawn), `m5_moon_room.png` (Room over Warehouse spawn); in-engine (1920 × 1080, headless Chrome, solo): `m5_hangar_engine.png`, `m5_hangar_engine_ring.png`, `m5_moon_engine.png` | Cycles on the RTX 5090: `--env-hangar` ≈ 80–95 s (both bays + bakes), `--env-moon` ≈ 85–95 s, renders 25–50 s |
| Tests | `packages/assets/test/space_envs.test.ts` (46) | `pnpm -s vitest run packages/assets`: 19 files, 1,663 pass, 3 skipped. `pnpm -s typecheck`: clean |

Commands: `node tools/assets.mjs --env-hangar [--render]`, `--env-moon [--render]`. The scripts share
`tools/blender/kn_tools/envset.py` (new, additive): chunked export, hull colliders, the IBL bake, the LUT writer, the
heightfield encoder.

## Data contract (as shipped; W5 has wired it)

Same conventions as `env_tinker.ts`: engine space (metres, Y up, the default camera on +Z), every preset's origin
`[0, 0, 0]` (the bounds floor centre), glbs in set coordinates.

Per preset (`HANGAR.presets.warehouse | arena`, `MOON.presets.room | warehouse | arena`):

| Field | Meaning |
|---|---|
| `glb` | Hangar: one per bay (`env/hangar/hangar_<preset>.glb`). Moon: `env/moon/moon.glb` (also `MOON.glb`) |
| `origin`, `bounds`, `neutral`, `camera`, `target`, `cameras.{default, hero, wide, lobby}`, `drones`, `scaleRef` | as Tinker |
| `boxes`, `spheres` | as Tinker. New physics materials: `concrete` (Moon apron strips), `regolith` (boulders) |
| `hulls` | static convex hulls `{ name, points (≤ 32), aabb, phys }`: shuttle (fuselage × 6, wings, fin, engines), gantry hook, lander (stage, bell, cabin, legs × 4, ladder, mast), rover wheels, dome base, solar panels, antenna, 1.2 / 3 m boulders |
| `practicals` | **the renderer's spot table, ≤ 8** (`look/practicals.ts` `MAX_SPOTS`), in the Tinker format: `pos`, `dir`, `kelvin`, `color`, `lumens`, `candela`, `innerConeDeg`, `outerConeDeg`, `rangeM`, `bulbRadiusM`, `cyclesWatts` (Cycles point-light watts against a strength-9 sun, the renderer's intensity), `shadowed` (the first one only casts), `zone`, plus `kind`. Hangar: the 4 zone panels (the first shadowed) + 4 quadrant `fill` spots standing in for the strip field. Moon: the 2 lander floods (first; `toggle: 'baseLights'`), 4 dome-window pools, the beacon (`blinkHz` 0.5) |
| `lights` | every fixture in the same format (Hangar: 48 / 220 strips, 4 zone panels, 16 / 48 sconces), for clustered lighting or GI later |
| `probes`, `giVolume`, `emitters` | as Tinker; emitters = the §5.6 / §6.7 ambience hooks |
| `earth` | backdrop Earth: `center`, `radius`, `spinAxis`, `degPerMinute` (0: lighting is baked), `meshes`, `texture` (the baked set, also `<id>.env.json → textures`) |
| `ibl` | `{ name, file, format, size, probe, sh9, bakeSunStrength }`; `iblScale` = engine sun ÷ `bakeSunStrength` (Hangar 6, Moon 8) |
| Hangar `zones` | `{ name: 'zerog_<n>', field: 'antigrav', gravityPercent: 0, shape: 'cylinder', center (mid-height), radius, halfHeight, box, ring: { center, innerRadius, outerRadius, mesh } }` |
| Moon `terrain` | the authored heightfield in the `TerrainRecord` layout, base64 zigzag-varint row deltas + `fnv1a`; `moonTerrain(preset)` decodes it (integer ops), `heightsFnv1a()` checks it |

Top level: `light` (the §5.3 / §6.4 rig), `lut`, `noShadow`; Hangar `cutaway` (Bay 2's single-sided front wall) and
`zoneColors`; Moon `terrainLayers` (texture files, the 26° rock-slope rule, the apron disc, the render-mesh prefix),
`boulders` (`baked` 400 + tier totals 1,500 / 4,000 / 8,000 from `moon_boulders.glb` roots `TIER8/12/16`, visual only and
outside the Arena bounds, so tiers never change the sim) and **`lightGroups.baseLights`**: `{ label: 'Base lights',
defaultOn: false, practicals: [indices into each preset's practicals], meshes: ['env_moon__lander_flood_lens'] }`. When the
toggle is on, draw those practicals and light those lens meshes; off by default (§6.4).

glb layout: `LOD0..LOD2 > CHUNK__<cx>_<cy> > meshes` (32 m chunks, split by island), `LOD3 > HLOD__<hx>_<hy>` (one merged
proxy per 128 m cell and shadow class), `BACKDROP`, `REF__scale__<preset>`, Hangar `ZONE__field__zerog_<n>` (the floor
rings), `PROBES`. Nothing sits beyond 1,990 m (a test): the renderer's far plane is 2 km.

## Decisions (judgement calls, for the orchestrator)

1. **Hangar spawn camera vs the front wall.** §5.1 puts Bay 2's camera at Y −42, outside the wall at Y −33. The front wall is
   single-sided and faces in (`cutaway`), so the engine's back-face culling lets the spawn view in while the IBL and the
   inside views still see a closed bay. The Main Hall's camera is inside its walls, so it is closed normally.
2. **Earth isn't in either spawn framing.** The brief's spawn cameras (30° down, 40° FOV) can't see Earth: in Bay 2 it fills
   the lower 40 % of the window (§5.3), in the Moon it is 12° up (§6.1). The `hero` cameras frame it.
3. **Moon sun azimuth.** §6.4 says "azimuth 120°, from the front-left". Read as front-left: `sunAzimuthDeg` 240 in the
   Tinker convention (from +Y toward +X). Shadows trail back-right, away from the camera.
4. **The Moon ground never goes below Z 0** (u16 heights). The base sits on the flat floor of a shallow basin; the ground
   rises to ~7 m beyond r 110 m with undulation, an 18 m ridge along the back edge, and the crater field cut into the
   raised ground (large Ø 60 m × 8 m at (80, −70), six medium ones). Room and Warehouse are flat (as §6.1 says).
5. **Backdrops inside 2 km.** The Moon highlands (§6.1: 2–8 km) sit at 1.2–1.9 km, scaled to the same ~4° silhouettes;
   Earth at 1.85 km keeps its 2° size; the stars sit at 1.9–1.95 km. Otherwise the renderer's far plane clipped them.
6. **Colliders.** Each deck is one steel box (no chunk seams for sliding parts to catch on); §5.5's "merged per chunk" is a
   render concern here. The Moon apron is 10 inscribed 4 m `concrete` strips coplanar with the heightfield (W5 punches
   holes in the heightfield under them). Ribs, panels and beams outside the bounds have no colliders (unreachable).
7. **Ring LEDs carry their own colour.** `_led` is the new `kn_env_field_led` (Field pink, emissive); `_led_dash` / `_glyph`
   are `kn_env_led_white`. R5 recolours by mesh name (`ringOf` in `gfx/environment.ts`, names unchanged). In engine the
   brief's clear `kn_poly_clear` cover reflected the bay's IBL over the LED at grazing angles, so the rings ship without it.
8. **New masters** (`kn_tools/masters.py` E5c block): `panel_white`, `deck`, `deck_seam`, `light_strip`, `sconce`, `earth`,
   `earth_land`, `earth_cloud`, `atmosphere`, `star`, `field_led`, `led_white`, `regolith`, `regolith_sintered`,
   `regolith_dark`, `foil_gold`, `window_glow`. `assets/src/lib/materials.blend` was **not** force-rebuilt (other streams
   were running Blender): `envset.materials()` builds any master the library lacks from the same table. The next
   `node tools/assets.mjs --force-libs` puts them in the library.
9. **Earth (second pass, after the orchestrator's review): a baked, lit texture set.** `env_hangar.earth_bake()` (numpy,
   ~30 s at 2048²) bakes a stylised-real planet into `earth_hangar.{albedo,normal,orm}.png` (2048², both bays) and
   `earth_moon.*` (1024²): invented continents with soft coastlines (domain-warped fBm), relief and climate colour
   (plains, forest, desert belts, mountains, snow peaks, ice caps), an ocean depth gradient, wispy domain-warped and
   latitude-streaked clouds with soft shadows, a soft day / night terminator **from each set's own sun** with a warm
   sunset band, pin-point coastal city lights on the night side, an ocean glint toward the viewer and rim scattering
   (stronger when backlit). It's drawn on the UV-mapped hemisphere facing the viewer (`kn_env_earth_tex`, white with
   emissive factor 0.15, so the engine shows texture × 0.15 × 12; glb material `extras.texSet = 'earth'`), plus a thin
   limb ring. **Consequence of the true sun:** seen through Bay 2's / the Main Hall's window, the sun is behind Earth
   (phase ≈ 130°), so the window shows a night continent full of city lights under a bright, scattering sunlit limb (a
   crescent along the top); from the Moon it's gibbous (≈ 46°). Because the lighting is baked, Earth no longer spins
   (`degPerMinute` 0; §5.3's 1°/min would need runtime planet lighting).
   - **Renderer change (marked `E5c (M5)` in `apps/game/src/gfx/environment.ts`):** the loader reads the env's
     `<id>.env.json → textures` (`texSetsOf`), loads it with `lookPass.tex.load('env:<id>', set, '/env/<id>/')` and passes
     the layer to `glbLods` for the set mesh, exactly as parts bind their sets. Only materials flagged `texSet` with UVs
     sample it. `envset.export_tree` now exports texcoords (only the Earth carries a UV map).
   - **Review round 2:** night lights are strictly night-side, gated by the baked night factor, and clustered: sparse
     coastal and river chains plus a few metro clusters, with most land dark. They're small and dim with a soft glow,
     over a blue-black night side. The Hangar bake turns the planet's sun toward the bay to a 105° phase
     (`EARTH_PHASE`), so 35–40 % of the disc is a sunlit crescent: an art call that departs from the true 130°. The
     Moon keeps its true sun.
10a. **Hangar values (review):** panels and deck are mid-greys with deterministic tone variation (`kn_env_panel_white /
   _grey / _warm`, `kn_env_deck / _alt`; the neutral zone stays one material). The Main Hall's IBL bake adds four broad
   ceiling bounce panels for its 220 strips (otherwise its walls went near black in engine). The window and Earth are now
   the brightest thing in frame. The pink rings are the zero-g floor rings in the solo Field colour (brief §5.2, R5's
   recolour), as intended.
10c. **Moon solar panels (review):** separate deep-blue cell tiles (`kn_env_solar_cell`) over a silver backplate 7 cm
   behind, so the gaps read as the grid, inside a border frame. The first pass's per-cell boxes and grid strips sat
   1.5 cm apart and z-fought into noise at 40–80 m with the engine's 0.02–2,000 m depth range.
10b. **Lander floods** aim 20° down onto the apron (`dir.y` −0.342; they pointed up before, W5's catch). Checked in engine
   with Base lights off / on: the lenses light; in full sun the pools barely register (20k lm against a 120k lux sun).
10. **Texture sets.** The environments use masters, like the Tinker Lab; only the Moon terrain layers have tiling sets
    (PNG; no KTX2 for env sets yet, as for the Backlot).
11. **LOD ratios** run below the brief's 50 / 25 / 8 % (Bay 2 30 / 8 / 7 %, Main Hall 39 / 9 / 8 %, Moon 40 / 12 / 5 %):
    cheaper than asked, never more (the E3b precedent).
12. **Shadow zoning** (§0.9): the Bay 2 sun patch ends at Y −3.4 (the zone ends at −4), the Main Hall's at Y +33. On the Moon,
    boulders and props are placed so their 18° shadows never reach a neutral zone (`shadow_hits_zone`).

## Gaps / for other streams

- **W5:** the Hangar `practicals` are now ≤ 8 renderer spots and `lights` has the full fixture list; wire `practicals` the
  way the Tinker Lab's are (W5's stand-in spots can go). Wire `MOON.lightGroups.baseLights` to the "Base lights" toggle. The
  beacon lens mesh is `env_moon__antenna_beacon` (0.5 Hz blink); the dome windows glow by emission.
- **Renderer (R5):** stars and backdrop now fit the 2 km far plane. The multiplayer ring look was checked once by accident
  (a second client was attached): white dashes and glyphs show.
- **Grains (X5):** the Matter floor is still the y = 0 plane (no Moon heightfield), as W5 notes.
- **Not built:** the brief's 1024² micro-pebble *detail* is shipped as a normal map only; footprints and tracks are geometry,
  not decals (no decal cells for them); env KTX2.

## Shared files touched (Edit tool, additive)

- `tools/blender/kn_tools/masters.py` (the E5c `ENV_MASTERS` block), `tools/blender/kn_tools/envset.py` (new module).
- `tools/assets.mjs` (`--env-hangar`, `--env-moon` and the `onlyExtras` flag).
- `packages/parts-data/src/index.ts` (two `export *` lines for my generated files).

## Status log

- 2026-10-25 10:10: first `env_hangar.ts` published (both bays built, IBLs baked); contract posted before the first build.
- 2026-10-25 10:26: **incident, fixed.** My first Moon build imported `tools/blender/props/env_backlot.py` for its
  texture helpers; that module calls `main()` at import, so it rebuilt E3b's Backlot outputs with its art fallback
  heightfield (`assets/build/env/backlot/{backlot.json, backlot_arena.height.r16/.png, backlot_dressing.glb,
  terrain/*.png}`, `assets/src/env/backlot/backlot_dressing.blend`). Restored at 10:28 by the owner's own pipeline,
  `node tools/assets.mjs --env-backlot` (heightfield source back to S3's `defaultTerrain(arena)`); that also rewrote
  `backlot_arena.sim.r16/.json` from the current `defaultTerrain`. The outputs are now exactly what that command
  produces today; the pre-incident files can't be byte-compared (no git). The terrain textures are seeded, so they are
  identical. `env_backlot.ts` (the sim's generated colliders) was never touched. `env_moon.py` now carries its own copy
  of the helpers. **Don't import `props/env_backlot.py`.**
- 2026-10-25 10:40: Moon published.
- 2026-10-25 11:00–11:30: the orchestrator's review items. (1) the test typechecks (`MoonEnv.glb`); (2) the ring LEDs are
  Field pink in engine; (3) practicals in the renderer's spot format; (4) `lightGroups.baseLights`; (5) the Earth is
  smooth (iso-line coastlines, limb glow), checked in engine at 1920 × 1080 (headless Chrome on a local Vite 5303 / host
  8903 with scratch data; both stopped). The engine check also found the 2 km far plane clipping the Moon's sky
  (fixed, decision 5) and the ring cover's reflections (decision 7).
- 2026-10-25 12:00–12:30: the Earth pass (decision 9) and the flood fix (10b), checked in engine at 1920 × 1080:
  `art/style-samples/m5_hangar_engine.png` (Main Hall hero), `m5_hangar_engine_default.png` (spawn: Earth isn't in that
  framing, decision 2), `m5_moon_engine.png` (hero), `m5_moon_engine_baselights_off.png` / `_on.png`; Cycles
  `m5_hangar.png`, `m5_hangar_arena.png`, `m5_moon.png`, `m5_moon_room.png` regenerated. Tests and typecheck green.
