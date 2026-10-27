# M5 notes: W5 · environments (integration)

Stream W5 wires ORBITAL HANGAR (`'hangar'`) and MOON BASE (`'moon'`) end to end (sim, format defaults, `env.zones`,
rendering, the settings list, the ambience hook) and, at the orchestrator's request, D26's global **wind** (`env.wind`).
Vite 5303 (scratch config, HMR off), local test server 8903 (scratch `KNOCKON_DATA`). Status: **done** (hand-back 2026-10-25).

## Data from E5c

E5c's contract ([M5_NOTES_E5c.md](M5_NOTES_E5c.md)) is the plan's (contract 4) and supersedes the draft W5 first posted
here. W5 reads it through `packages/parts-data/src/env_space.ts`:

- **Types** (`SpaceEnv`, `SpacePreset`, `SpaceZone`, `SpaceHull`, `SpaceTerrain`): only the fields W5 reads. E5c's
  `HangarEnv` / `MoonEnv` carry more and are assignable to them.
- **Switched to E5c's data** (both files landed during the stream): `HANGAR_SET = HANGAR`, `MOON_SET = MOON`,
  `moonField(p) = moonTerrain(p)`, the last exports of `env_space.ts`. The names differ on purpose, so the `export *`
  lines in `parts-data/src/index.ts` never clash.
- The renderer loads E5c's glbs (`/env/hangar/hangar_<preset>.glb`, `/env/moon/moon.glb`) through the same path as the
  Tinker Lab: casters minus BACKDROP / noShadow, glass, the scale reference. It uses the per-bay Hangar IBL
  (`ibl_hangar_<preset>.json`, Cycles sun 6), the Moon's IBL (`ibl_moon.json`, 8) and the LUT strips.
- W5's stand-ins (`HANGAR_STANDIN`, `MOON_STANDIN`, `moonFieldStandIn`, the procedural `gfx/look/space.ts`) stay only as
  the fallback when a glb is missing.

## What's wired

| Area | Where | What |
|---|---|---|
| Sim sets | `packages/sim/src/envsets.ts` (new); `machine.ts` (marked `W5 (M5)`) | `spaceSetPlan` → `buildSet` with the new `concrete` (0.75 / 0.10) and `regolith` (0.80 / 0.05) materials and convex `hulls`. The catch-all floor drops to y = −1, so the deck or the regolith is the only surface |
| Moon heightfield | `envsets.ts buildSpaceTerrain` | E5c's authored samples: one static `HeightFieldShape` per 32 m chunk, in chunk-row order, like the Backlot's, with `regolith` friction. A sample whose four surrounding quads lie under the apron's concrete strips is a Jolt no-collision hole, so nothing touches two coplanar surfaces |
| Physics defaults | `format model.ts` | `envPhysics(env)`: Hangar 38 % gravity / 100 % air, Moon 16.5 % / 0 %. `defaultEnvFor(preset, environment?)`. `envSwitchPatch(cur, id)` brings the new environment's values along when the world still has the old one's defaults (one op, one undo). `EnvUpdate.gravity` takes 0.5 % steps. `DEFAULT_ENV` and old saves are unchanged |
| Zero-g zones | `format` `env.zones` (boolean, absent = on); `envsets.ts zeroGZones`; `machine.ts` stage 6 | ZONE-style Antigrav: each awake pushable body whose centre is in a zone gets m·g·gravityFactor·(1 − gravityPercent / 100) upward. Sleeping bodies stay asleep and critters are skipped. Bodies a TRACTOR BEAM holds or a STASIS FIELD freezes this tick are also skipped, since A5's fields already cancel their gravity (otherwise net +1 g). The forces come from plain state only, so rollback needs no `afterRestore`. The hash carries the flag only in worlds that have zones |
| Wind (D26) | `format` `env.wind` + `WIND_PRESETS` + `windSpeedAt`; `envsets.ts globalWind`; `machine.ts` stage 6 | See below |
| Presets | `parts-data presets.ts` | Room: + moon. Warehouse and Arena: + hangar, moon |
| Rendering | `gfx/environment.ts`, `gfx/look/sets.ts`, `gfx/look/space.ts` (new) | Per-preset arts (`hangar:<preset>`, `moon:<preset>`). Hangar look: 5,800 K sun 30° through the window, 6,500 K strip fill, 9,000 K earthlight from below. Moon look: 5,900 K sun 18° from front-left, black sky (`cyc` 0), ground bounce from below, faint earthshine, fixed exposure, no fog |
| UI | U5 did the environment list, the zones switch and the env switch (`ui/settingspanel.ts`, `buildtools.ts`, `lobby.ts`). W5 added Settings › World › Weather (marked `W5 (M5, D26)` in `settingspanel.ts` and `buildtools.ts`) | |
| Ambience | `audio/ambience.ts` (hook) | `ENVS.hangar` / `ENVS.moon`, with emitter positions from the set data. A set whose bed recipe doesn't exist yet plays the Studio's. F5 has since filled in the sounds |
| Worker | `run.ts`, `sim.worker.ts` | `zones` and `wind` ride the start message (solo and multiplayer `run.start`) |

### Wind (D26, SIMULATION §5.8)
- **Setting:** `env.wind = { speed, dir, gusts }`.
  - `speed`: 0–15 m/s, in 0.1 steps.
  - `dir`: 0–359°, the direction it blows **toward** (0 = +X, 90 = −Z).
  - `gusts`: `'none' | 'breezy' | 'gusty' | 'overcast'`.
  - Absent = no wind (every pre-M5 save). `EnvUpdate` carries it; null clears it.
- **Gusts:** `windSpeedAt(w, t, seed)`. Smooth value noise with one knot per period, from an integer hash of the world
  seed and the knot index (+ − × ÷ only).
  - Breezy: ±1 m/s (9 s period).
  - Gusty: +0–4 m/s (5.5 s), so 6–10 m/s.
  - Overcast: ±0.5 m/s (8 s).
- **Presets:** the Backlot's weather presets are `WIND_PRESETS` (Calm 0, Breezy 3, Gusty 6, Overcast 2 m/s; from −X,
  so blowing toward +X).
- **Sim** (end of stage 6): every awake pushable rigid body gets `F = 1.225 · air · A · w²` along the wind, where A is
  the GALE's projected-area rule (`areaOf`). F is capped at 40 m/s² of acceleration, as ZONE's Wind is.
  - Once a second, a sleeping body wakes if F > 0.2 × its weight.
  - Above 4 m/s it blows out lit WICKs and douses FLAMERs.
  - Air 0 % (the Moon) means no wind at all.
  - Zero-g zones don't change it (the brief doesn't say they should).
  - Critters and STASIS-frozen bodies are skipped.
  - The hash carries the setting only when there is wind, so no older golden moves.
- **Not done (v1 gaps):** TURBINE blades get plain drag from global wind, not the pitched-blade tangential torque.
  Trees, grass and flags don't react in the renderer. No gust preview in the HUD.

## Decisions taken here (provisional, for the orchestrator)
- `env.zones` is a boolean: all zones toggle together (brief §5: "players can disable them in world settings").
- Gravity accepts 0.5 % steps (Moon 16.5 %).
- Switching environment brings its gravity and air only when the world still has the old environment's defaults.
- Zero-g zones and wind skip sleeping bodies. Wind wakes them once a second past 0.2 × weight, as §5.8 says.
- In both space sets the sim's catch-all floor box drops to y = −1.

## Tests (all in W5's own files)
- **`packages/sim/test/space_env.test.ts`** (14, on E5c's data):
  - Hangar: colliders in both bays (deck, a container, the shuttle's convex hulls); the 38 % fall; a zero-g zone on, off
    and outside, plus the hash flag; rollback across a zone entry.
  - Moon: THUDs on the apron (exactly y = 0 + r), its edge, rough regolith and the highest ground; two-run determinism
    and rollback on the heightfield; the Room / Warehouse flat pad and the lander's hulls; the 16.5 % fall; a HELIO
    doesn't rise at 0 % air; E5c's samples decode to their generated FNV-1a and are flat on the apron.
  - Wind: a HELIO drifts downwind (+X, −Z); gusty wind is deterministic, rolls back and is in the hash; no effect on the
    Moon; zero wind = no wind; a WICK blows out above 4 m/s only.
  - A5's fields: a TRACTOR BEAM-held and a STASIS-frozen STITCH in a zero-g zone sit where they do with zones off.
    Without the skip, the held one rises 9.3 cm.
- **`packages/format/test/space_env.test.ts`** (8): defaults; the env switch; zones, gravity and wind on the wire; old
  saves unchanged; wind round-trips a save; gust bands and determinism.
- **`packages/docstore/test/space_env.test.ts`** (2): env switch and zones toggle undo / converge.

## Checked in Chrome (Vite 5303, host 8903)
- **Load and run:** both environments load and render from E5c's glbs in every preset (Moon Room / Warehouse / Arena,
  Hangar Warehouse / Arena). A run works in each:
  - Moon: THUDs, BOINGs and a HELIO at 16.5 % gravity and no air.
  - Hangar: THUDs and BOINGs in a zero-g ring.
- **Samples** (`art/style-samples/`): `m5_env_moon_room.png`, `m5_env_moon_arena.png`, `m5_env_moon_run.png`,
  `m5_env_hangar_warehouse.png`, `m5_env_hangar_warehouse_hero.png`, `m5_env_hangar_arena.png`, `m5_env_hangar_run.png`.
- **Found and fixed:** `main.ts` turns `renderer.drawFloor` back on every frame (from the Backlot terrain) before
  `EnvView.items` runs. So the Studio floor, coloured from the look's cyc, was drawn under every set at y = 0 and
  z-fought its floor. On the Moon (black cyc) it turned the apron black past a few metres. `EnvView.items` now keeps it
  off whenever a set is drawn (Kitchen and Tinker Lab included: they bring their own floors).
- **Measured** (provisional: the GPU was shared with R5's dev tab, rule 11):
  - The Hangar Arena glb (36 MB) loads and draws in 1.2 s.
  - The debug readout's GPU time was 0.4–1.9 ms in the Moon Room and Hangar Bay 2, at 1568 × 705.
- **Exposure:** the Hangar look's fixed scale is 0.5 against E5c's bay bake (the brief's EV100 11 is brighter than the
  Lab's 9.5). The Moon's is 0.8, fixed (the engine has no auto exposure yet).

## Follow-up after E5c finished (2026-10-25, second pass)
- **Practicals:** each Hangar / Moon preset's `practicals` (≤ 8, in the renderer's spot format, first one shadowed) now
  light the sets through the Tinker Lab's path. W5's stand-in spots are no longer used. `lights` (the full fixture list)
  isn't read yet.
- **Base lights:** `env.baseLights` (format: boolean, absent / null = off; `EnvUpdate`, so it syncs and undoes;
  cosmetic, not a run input).
  - Settings › World › "Base lights" on the Moon (marked `W5 (M5)` in `settingspanel.ts`; host in `buildtools.ts`).
  - `EnvView` reads `MOON.lightGroups.baseLights`. While the toggle is off it drops those practicals (indices 0 and 1,
    the lander floods).
  - The lens meshes `env_moon__lander_flood_lens*` are transmissive, so they are drawn in the glass pass. While the
    toggle is on, an opaque emissive copy (5,000 K white) is drawn over them.
  - Checked in Chrome: `m5_env_moon_baselights_on.png` / `_off.png`.
- **Re-checked in Chrome:**
  - The Moon's Earth and stars now show (they are inside the 2 km far plane).
  - The Hangar rings read Field pink (cover gone; R5's ring split).
  - All `m5_env_*.png` samples are refreshed, and runs work in both environments.
- **Flagged for E5c:** the two flood practicals' `dir` points **up** (y = +0.342), so they light the sky, not the apron.
  It should probably be −0.342. Not changed here (it's their generated data).
- **Final:** lint clean; typecheck clean (0 errors; E5c's test error is gone). `vitest run packages/sim packages/format
  packages/docstore packages/parts-data apps/game`: 56 files, **817 passed**.

## Gaps for other streams
- **X5 (D104):** Matter grains still use the hard-coded ≈ 9.67 m/s² and ignore zero-g zones and wind. Matter's static
  floor is the y = 0 plane, with no Moon heightfield and no Backlot terrain.
- **E5c:**
  - The two lander flood practicals point up (`dir.y` +0.342): see the follow-up above. (The earlier typecheck, ring LED
    and practicals-format items are resolved.)
- **U5:** Settings › World › Weather and › Base lights are W5's minimal controls; restyle at will. (R5 has since done
  the multiplayer ring recolouring and the zones-off dimming in `EnvView`.)
- **D5:** SIMULATION §5.8 says global wind is "not built yet"; it is now (see above). In DATA_FORMATS §2.1, `wind.dir`
  is the direction it blows toward (0 = +X, 90 = −Z), and `zones` is a boolean, absent = on.
- **Host soak harness** (`apps/host/soak/soak.ts`) builds Machines with only preset and environment: no gravity, air,
  zones or wind. The fix belongs to the soak's owner.
- **SIMULATION `steel` (0.30 / 0.20) vs `Machine.buildSet`'s 0.4 / 0.2:** pre-existing and left unchanged; re-tuning it
  would move other streams' goldens.

## Log
- 2026-10-25:
  - Started and posted a draft contract, then adopted E5c's (theirs is the plan's).
  - Built the sim, format, rendering and ambience hook.
  - Added wind (D26) at the orchestrator's request.
  - Zero-g zones now skip A5's tractor and stasis bodies (A5's finding; also noted in M5_NOTES_A5).
  - Switched to E5c's Hangar and Moon data; Chrome check and samples; hand-back.
  - Final checks:
    - `pnpm -s lint`: clean.
    - `pnpm -s typecheck`: clean for W5's files (one E5c test error, above).
    - `vitest run packages/sim packages/format packages/docstore packages/parts-data apps/game`: 54 files, **782
      passed**.
    - No golden re-pinned: the hash carries `zones` / `wind` only in worlds that have them.
