# VFX briefs

Every particle, volumetric, decal, screen-space and mesh effect in the game: what triggers it, how it looks, which system draws it, what it may cost on each GPU tier, and how it behaves under *Reduce flashing*.

Back to the [brief index](./README.md) · Look: [ART_BIBLE §11](../ART_BIBLE.md#11-vfx-style-stylised-real) · Systems and budgets: [GAME_SPEC §13–15, §20](../../../GAME_SPEC.md) · Debris meshes: [shared_kit.md §8](shared_kit.md#8-debris-shard-library-assetssrcfxdebrisblend)

| Effect | ID | System | Ship | Stage |
|---|---|---|---|---|
| Sparks: fuse | `fx/fuse_spark` | GPU particles | M1 | brief |
| Sparks: grind | `fx/grind_spark` | GPU particles | M1 | brief |
| Sparks: arc | `fx/arc_spark` | GPU particles | M4 | brief |
| Flame: wick | `fx/wick_flame` | Mesh flipbook + particles | M1 | brief |
| Flame: flamer jet | `fx/flamer_jet` | GPU particles + screen-space | M3 | brief |
| Rocket exhaust | `fx/rocket_exhaust` | GPU particles + mesh | M2 | brief |
| Fire volume | `fx/fire_volume` | Volumetric grid | M3 | brief |
| Smoke puff / ring / column / plume | `fx/smoke_*` | GPU particles, grid | M1 / M2 / M3 / M3 | brief |
| Explosion small (yield 1) | `fx/boom_small` | Composite | M1 | brief |
| Explosion medium (yield 1.5) | `fx/boom_medium` | Composite | M3 | brief |
| Explosion keg (yield 3) | `fx/boom_keg` | Composite | M3 | brief |
| Firework aerial bursts | `fx/firework_<pattern>` | GPU particles | M3 | brief |
| Shock ring | `fx/shock_ring` | Mesh + screen-space | M1 | brief |
| Dust kick-up | `fx/dust_kick` | GPU particles | M1 | brief |
| Debris (micro) | `fx/debris_micro` | GPU rigid-lite | M3 | brief |
| Scorch, soot, burn trail | `fx/decal_*` | Decals | M3 | brief |
| Egg splat | `fx/egg_splat` | Mesh + decal + particles | M4 | brief |
| Water splash and foam | `fx/water_splash`, `fx/water_foam` | GPU particles + mesh | M4 | brief |
| Sand puffs | `fx/sand_puff` | GPU particles | M4 | brief |
| Confetti | `fx/confetti_burst` | GPU particles (flutter) | M3 | brief |
| Electric arcs and crackle | `fx/arc_bolt`, `fx/arc_crackle` | Compute mesh + sprites | M4 | brief |
| Laser beam and dust motes | `fx/laser_beam`, `fx/beam_motes` | Mesh + froxels + particles | M2 / M3 | brief |
| Bloom halos | `fx/bloom_halo` | Screen-space + sprites | M1 | brief |
| Critter comedy (dizzy, sweat, !, zzz, emote, Goby bubble) | `fx/critter_dizzy`, `_sweat`, `_alert`, `_zzz`, `_emote`, `_goby_bubble` | Mesh + billboards | M2 | brief |
| Rope and band breaks (rubber snap, rope fray, ember creep) | `fx/snap_rubber`, `fx/rope_fray`, `fx/ember_creep` | GPU particles + debris | M1 | brief |
| Jam / fault puff | `fx/jam_puff` | GPU particles | M1 | brief |
| Singularity lensing and accretion disk | `fx/singularity_*` | Screen-space + particles | M5 | brief |
| Rift Gate shimmer | `fx/rift_shimmer` | Mesh + RTT + particles | M5 | brief |
| Stasis field | `fx/stasis_field` | Mesh + material overlay | M5 | brief |
| Tractor beam | `fx/tractor_beam` | Mesh + froxels + particles | M5 | brief |
| Hover pad | `fx/hover_pad` | Mesh + screen-space | M5 | brief |
| Force wall | `fx/force_wall` | Mesh | M5 | brief |
| Port-ring LED pulse | `fx/port_pulse` | Material | M1 | brief |

M1 ships before volumetrics (M3), so M1 fire and booms use their **particle fallback** paths described below; the grid paths switch on in M3 with no content change.

---

## 0. Shared rules

### 0.1 Tiers and pools
Tier names used in this file: **Low = 4 GB · Medium = 8 GB · High = 12 GB · Ultra = 16 GB**. The GB names are the tier IDs (GAME_SPEC §15.2, UI badges); Low / Medium / High / Ultra are declared shorthand only. Every four-value list in this file ("a / b / c / d", "L / M / H / U") is in that order. Values marked † are given by GAME_SPEC (§13 for the 16 GB column, §15.2 for the tier rows); the others are set here.

| Pool | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Spectacle particles live † | 1M | 4M | 8M | 16M |
| Volumetric fluid grids † | 2 × 96³ | 4 × 128³ | 6 × 128³ | 6 × 160³ |
| Grid raymarch | half res + temporal reprojection on every tier (GAME_SPEC §13, RENDERING §8) | same | same | same |
| Matter grains rendered † (context for splash, foam and sand-puff caps) | 250k | 1M | 2M | 4M |
| Debris chunklets | 60k | 150k | 300k | 500k † |
| Clustered decals | 1,024 | 2,048 | 4,096 | 4,096 † |
| Dynamic lights (shadowed) | 1,024 (8) | 2,048 (16) | 4,096 (24) | 4,096 (32) † |
| Confetti flakes | 128k | 256k | 512k | 1M † |
| Screen-space refraction (shock, heat haze) | off | half res | full | full |
| Froxel volumetric injection (beams, haze) | off (beams use mesh only) | on | on | on |

**Unlimited Mayhem** (setting): pool caps go to the device maximum and per-effect counts × 2. Gameplay-readable effects never change.

### 0.2 Budget arbiter
Every emitter has a priority class:
- **Readable** (never culled, minimum 50 % of its count): port pulse, fuse spark, wick flame, jam puff, laser beam, arcs, critter comedy, Field effects.
- **Hero**: explosions, fireworks, Singularity, confetti.
- **Ambient**: dust, motes, foam, sand puffs, smoke tails, debris tails.

Rules: per-effect counts below are **per instance at close range**. Hero and Ambient counts scale by `clamp((30 m / distance)², 0.1, 1)`. When a pool passes 85 %, new Ambient spawns × 0.5; past 95 %, Ambient stops and Hero × 0.5. Detonations within 1.0 m and 3 ticks of each other **merge** into one grid and one composite (GAME_SPEC §13 asks for merged grids on chained blasts; the 1.0 m / 3-tick window is set here. Audio merges on its own 80 ms window, AUDIO §4). Grid slots are assigned keg > medium > small > fire volume > plume (oldest lowest-priority grid is reclaimed and converted to particles).

### 0.3 Comfort: *Reduce flashing* and reduced motion
*Reduce flashing* is **on by default** (GAME_SPEC §20).

| Rule | Reduce flashing ON (default) | OFF |
|---|---|---|
| Large-flash limiter | **≤ 3 large flashes per rolling second** (GAME_SPEC §20). Two layers enforce the one rule. **Event layer** (set here): every exposure flash, and every light or emissive event covering > 25 % of the screen, is tagged *large* at spawn. A 4th tagged flash inside the rolling second merges into the running one (it extends the decay, with no new peak). **Measured layer** (RENDERING §9, the safety net): if frame-average luminance rises > 2.5× within 100 ms more than 3 times in a second, post clamps exposure. Any event that trips the measured layer counts as large even if it wasn't tagged | No frequency limit |
| Exposure flash peak | + 0.6 EV max, rise ≥ 50 ms, decay 300 ms | + 1.5 EV, 1-frame rise, decay 200 ms |
| Flash colour | Clipped at `#FFF4E0`; never pure white, never saturated red | same clip |
| Flicker of any light or emissive covering > 10 % of the screen | ≤ 3 Hz, amplitude ± 15 % | free |
| Bloom contribution | ≤ 1.0 × scene luminance, no lens dirt | ≤ 2.0 × |

**Reduced motion** (separate toggle): no auto slow-mo, no hitstop, camera shake 0, refraction and lensing distortion ≤ 30 % strength, no motion blur or DOF on effects. Camera shake slider default 70 %.

### 0.4 VFX palette (ART_BIBLE §11)

| Use | Colour |
|---|---|
| Spark streak / hot core / ember | `#FF8A2A` / `#FFC870` / `#FF6A1F` (as `style_samples.py`) |
| Fire | Blackbody ramp 1,000–2,600 K pushed warm and saturated, clipped at `#FFE2B0` (before white) |
| Smoke | `#5B6270`, column cores `#4A5060`, warm underlight from fire `#FF8A2A` |
| Shock ring | core `#FFF4E0` → edge `#FFB020` |
| Electric | core `#F4F8FF`, glow Beam `#2FD6FF` |
| Water / foam | clear with 8 % Beam absorption tint / `#F4FBFF` |
| Sand puff / grains | `#DCC9A0` / `#D6BE8E` |
| Confetti | Brand powders only (capped values, shared_kit.md §7.1): Ignition, Volt, Beam, Plasma, Amber, Cobalt, Bone |
| Critter comedy | Stars Amber `#FFB020`, sweat `#BFF0FF`, "!" Ignition on paper `#EEF1F6` |
| Jam / fault | Amber `#FFB020` sparks, `#5B6270` puff |
| Light beams | Light channel `#FFF1A8`, core white |
| Field effects | Field channel `#FF3DAE` + white, **always as a pattern** (hex lattice, rings, dashes), never a solid uniform outline: in multiplayer solid Plasma outlines mean Player 2 (MULTIPLAYER §8.1) |

### 0.5 Sprites and textures (`assets/src/fx/sprites/`, KTX2)

| Texture | Size | Layout | Channels |
|---|---|---|---|
| `fx_spark` | 1024² | 2 × 2: streak, fat streak, ember, star glint | RGBA (premultiplied) |
| `fx_flame` | 2048² | 8 × 8 flipbook, 256² frames, 30 fps loop | RGBA emissive |
| `fx_smoke` | 2048² | 8 × 8 flipbook, 256² frames | RG normal, B density, A alpha (lit) |
| `fx_puff` | 1024² | 2 × 2 soft billows (dust, sand, puff, wisp) | RG normal, B density, A alpha |
| `fx_crackle` | 1024² | 4 × 4 flipbook | RGBA emissive |
| `fx_confetti` | 1024² | 2 × 2: rectangle, circle, 5-point star, squiggle | A alpha + RG fold normal |
| `fx_critter` | 2048² | 8 × 8 cells, 256²: star, sweat drop, "!", "?", Z, heart, anger mark, note, 24 emote glyphs, 2 bubble frames | RGBA |
| `fx_scorch` | 2048² | 2 × 2 variants | albedo + alpha · normal (separate layer) |
| `fx_soot`, `fx_burn_trail`, `fx_water_stain` | 1024² each | 2 × 2 / tiling strip / 2 × 2 | albedo + alpha |
| `fx_splat` | 2048² | 2 × 2 egg splat variants | albedo + alpha · normal · roughness |
| `fx_field_hex` | 1024² | Tiling hex lattice (40 cells across) + edge distance in G | R lattice, G edge, B cell id noise |
| `fx_rift_swirl` | 1024² | Tiling polar swirl noise | R/G |
| `fx_halo` | 1024² | Soft disc + 6-point glint | R disc, G glint |
| `fx_ring` | 1024² | Radial ring gradient (shock, ripples) | R |
| LUTs (exempt from the array sizes) | — | `fx_blackbody` 256 × 1 RGBA16F, `fx_curl_noise` 64³ RGBA16F tiling | — |

Emitters on parts are `EMIT__<fx>__<name>` empties (ASSET_PIPELINE §3.5), +X = emission direction.

### 0.6 Visual reach vs gameplay reach
Where an effect draws a gameplay volume (a heat cone, an ignition zone, a beam), its **hot core matches the gameplay volume exactly** and the visual may extend to at most **1.3 × the gameplay reach** (soft tips, flicker, haze), so players can still judge what will light or push. One accepted exception: the Wick's 40 mm visual flame over its 25 mm hot core (§1.4).

Effects that react to air (flame lean, smoke, confetti flutter, dust motes, foliage in environments.md) sample the same air field as the sim: Air emitters plus the world **Wind** setting (GAME_SPEC §5.4, 0–15 m/s with a direction, default 0; SIMULATION §5.8), scaled by Air density.

---

## 1. Fire, sparks and smoke

### 1.1 Sparks: fuse `fx/fuse_spark`
| | |
|---|---|
| Trigger | A burning Fuse point (0.2 m/s along the path), lit fuses on Bangstick, Powder Keg, Skyrocket, Skyshow. Continuous while burning. Emitter `EMIT__spark__fuse_tip`, or the moving burn point on path fuses |
| Look | Exactly the look-dev `sparks()`: hot core Ø 9 mm `#FFC870`, glow `#FF8A2A`, velocity-stretched streaks 8–50 mm biased upward (+Z × 1.3), small embers that drift and fall. Cartoon-generous |
| System | GPU particles (velocity-stretched billboards) + 1 point light |
| Budget L / M / H / U | Streaks 150 / 300 / 500 / 800 per s (≈ 60 / 120 / 200 / 320 live) · embers 20 / 40 / 60 / 90 live |
| Lifetime | Streak 0.08–0.25 s · ember 0.4–0.9 s |
| Textures | `fx_spark` (streak, ember) |
| Light | Unshadowed point, (1.0, 0.62, 0.3), radius 0.6 m, noise flicker 12 Hz ± 25 % |
| Comfort | ON: flicker ± 10 %. Small area, never a large flash |

### 1.2 Sparks: grind `fx/grind_spark`
| | |
|---|---|
| Trigger | Steel-on-steel or steel-on-stone sliding contact > 1.5 m/s (Wrecker, Zippy, Pig Iron on rails, Coilgun Ring), Motor stall, jammed Cogs |
| Look | Flat fan of long orange streaks (20–80 mm) tangent to the contact, thrown opposite to the slide; 10 % white-hot. One bounce off the global SDF |
| System | GPU particles, SDF collision |
| Budget | 400 / 800 / 1,500 / 3,000 streaks per s per contact · concurrent contacts 8 / 16 / 32 / 64 |
| Lifetime | 0.15–0.4 s |
| Textures | `fx_spark` (fat streak) |
| Light | 1 unshadowed point per contact cluster, cap 4 / 8 / 16 / 32 |
| Comfort | None needed |

### 1.3 Sparks: arc `fx/arc_spark`
| | |
|---|---|
| Trigger | Arc strike points (§4.1), power overloads, Coilgun discharge, Mains shorted to metal |
| Look | Very short (5–25 mm), very fast, blue-white `#F4F8FF` with Beam glow, burst-shaped; paired with crackle sprites |
| System | GPU particles |
| Budget | 60 / 120 / 240 / 400 per strike |
| Lifetime | 0.05–0.15 s |
| Textures | `fx_spark` (streak, tinted) |
| Comfort | Strike light follows the arc rules (§4.1) |

### 1.4 Flame: wick `fx/wick_flame`
| | |
|---|---|
| Trigger | Wick lit (Heat in) until doused by Air or Fluid. Also any lit fuse end resting on a Wick |
| Look | Teardrop flame ≈ 17 × 40 mm rising from the wick tip, with a **25 mm hot core** inside a **40 mm visual flame** (flame base at the wick tip, z 0.18, tip ≈ z 0.22; the Wick's ignition capsule `SENSOR__heat__flame` spans z 0.17–0.215 (boom.md), so the core is well inside it and the visual tip overreaches it by ≤ 5 mm). Translucent blue base `#3A6BFF` at 30 %, core `#FFE2B0`, outer `#FF8A2A`. Leans with the local air vector (§0.6), gentle flicker. Douse → a single curling smoke wisp |
| System | Mesh: 3 camera-facing flipbook cards (`fx_flame`) with vertex noise + tiny ember particles |
| Budget | Embers 4 / 8 / 12 / 16 live · douse wisp 30 / 60 / 90 / 120 sprites |
| Lifetime | Continuous · wisp 2 s |
| Light | Point, 2,000 K, flicker 8 Hz ± 12 %. Shadowed for the nearest 2 / 4 / 6 / 8 wicks, otherwise unshadowed |
| Comfort | None needed |

### 1.5 Flame: flamer jet `fx/flamer_jet`
| | |
|---|---|
| Trigger | Flamer active: gas-fed, opened by its Signal valve (or on while powered in powered mode). Emitter `EMIT__flame__nozzle` |
| Look | Roaring cone whose solid flame body fills the **0.6 m gameplay heat beam** (the Flamer's `SENSOR__heat__beam`, boom.md) and whose tongue tips flicker out to **≤ 0.8 m** (§0.6): blue-white nozzle core `#BFE4FF` (50 mm) → `#FFC870` → `#FF5B2E` → `#FF8A2A` tongue tips, turbulent rolling, smoke curling off the tips, heat haze along the whole jet |
| System | GPU particles (flipbook flame sprites, additive + alpha) + screen-space heat-haze strip + capsule light. On High/Ultra the impact point feeds a fire grid if it hits something burnable |
| Budget | Flame particles 1,500 / 3,000 / 6,000 / 10,000 live · smoke 100 / 200 / 400 / 600 |
| Lifetime | Particle 0.35–0.6 s · ignition puff 0.5 s · shut-off tail 0.4 s |
| Textures | `fx_flame`, `fx_smoke` |
| Light | Spot along the jet, 1,900 K. Shadowed on High/Ultra, unshadowed on Low/Medium |
| Comfort | Ignition "whoomp" is not a large flash. Heat haze off with Reduced motion |

### 1.6 Fire volume `fx/fire_volume`
| | |
|---|---|
| Trigger | A burnable part igniting from heat accumulation (Plank, paper and cardboard items, Line, Helio string), and the lingering burn after a Powder Keg |
| Look | Real volumetric fire, warm and saturated, blackbody clipped before white; dark smoke rising, lit warm from below |
| System | **Volumetric grid** from the pool (temperature / fuel / density, vorticity confinement), domain 1–3 m cube around the burning parts; several nearby fires share one grid. **Fallback** (no free slot, or M1–M2): flame flipbook + lit smoke sprites |
| Budget | Grid at the tier resolution (96³ / 128³ / 128³ / 160³) · concurrent fire grids max 1 / 2 / 3 / 4 (the rest stay free for booms) · fallback 300 / 600 / 1,200 / 2,000 particles per burning part |
| Lifetime | While fuel lasts (sim-driven), + 3 s smoke tail handed to `fx/smoke_column` |
| Light | 1 point per fire cluster, 1,900 K, shadowed if among the nearest shadow slots |
| Comfort | None needed |

### 1.7 Smoke puff `fx/smoke_puff`
| | |
|---|---|
| Trigger | Small pops: fuse ignition, Bangstick fuse fizzle-out, douse, Cork Blaster miss, Toast Cannon pop, hard spark landings |
| Look | Soft blue-grey `#5B6270` cartoon puff of 6–10 round billows; fast expand, slow linger; warm underlight if fire is near |
| System | GPU particles, lit flipbook |
| Budget | 8 / 16 / 24 / 32 sprites per puff |
| Lifetime | 0.8–1.5 s |
| Textures | `fx_smoke`, `fx_puff` |

### 1.8 Smoke ring `fx/smoke_ring`
| | |
|---|---|
| Trigger | Comic rings for small pops: Cork Blaster shot, Big Top fire, Popper (cosmetic only: the Popper is an Air puff, not an explosion), Skyrocket burnout, Bangstick at yield 1 when it detonates in open air (one ring rising from the smoke) |
| Look | A crisp torus Ø 0.15–0.6 m travelling along the muzzle (or upward) at 1.5 m/s, rolling as a vortex ring, slowing and growing to 2× before fading |
| System | GPU particles emitted on a torus with a vortex-ring velocity field |
| Budget | 120 / 240 / 400 / 600 particles per ring |
| Lifetime | 2.0 s |
| Textures | `fx_smoke` |

### 1.9 Smoke column `fx/smoke_column`
| | |
|---|---|
| Trigger | Sustained fire (fire volume tails), Skyrocket exhaust trail, smouldering debris |
| Look | Rising column 0.3–1 m wide, 4–8 m tall, darker core `#4A5060`, lighter curling edges; leans with wind |
| System | GPU particles. The column nearest the camera uses the sorted **hero smoke layer** (bitonic sort, GAME_SPEC §13); others use weighted blended OIT |
| Budget | 2k / 4k / 8k / 16k particles per column · concurrent columns 2 / 4 / 8 / 12 |
| Lifetime | 4–8 s per particle |
| Textures | `fx_smoke` |

### 1.10 Smoke plume `fx/smoke_plume`
| | |
|---|---|
| Trigger | Powder Keg detonation, or chained blasts with total yield ≥ 3 in a 0.5 s window |
| Look | Mushroom-capped billowing plume rising to 6–12 m, glowing inside at first, then cooling grey; slowly dissipates into a local haze |
| System | Continues the explosion's **grid**; when the grid is reclaimed it converts to particles; adds local froxel fog density |
| Budget | Particle conversion 4k / 8k / 16k / 32k · haze lifetime 10 / 15 / 20 / 30 s |
| Lifetime | Plume 10–20 s |
| Textures | `fx_smoke` |

### 1.11 Rope and band breaks `fx/snap_rubber`, `fx/rope_fray`, `fx/ember_creep`
Runtime effects requested by the BAND and LINE briefs ([drive.md](drive.md)). No authored emitters: the engine spawns them at the cut, snap or burn point on the spline.

| | **Rubber snap** `fx/snap_rubber` | **Rope fray** `fx/rope_fray` | **Ember creep** `fx/ember_creep` |
|---|---|---|---|
| Trigger | A BAND cut (Snipper) or overload snap | A LINE / BUNGEE snap or cut (both ends) | A LINE burning (Heat), along the burn front until it snaps or is doused |
| Look | Quick `kn_rubber`-black crumb spurt along the whip direction + a tiny grey `#5B6270` puff; the two band ends whip (the band mesh does that, not the effect) | A burst of short fibre flecks in rope `#EDE6D8` (Bungee: Ignition) from each cut face + 3–5 dust motes; the fray tufts are the LINE mesh caps | A glowing ember ring `#FF6A1F` → `#FFC870` riding the burn front, a thin rising smoke thread `#5B6270`, occasional falling embers |
| System | GPU particles + `DEB_rubber` chunklets | GPU particles (flecks use the `fx_confetti` squiggle, tinted) | GPU particles + 1 unshadowed point light (1,900 K, radius 0.3 m) per burning rope |
| Budget | Crumbs 6 / 10 / 16 / 24 `DEB_rubber` · puff 3 / 4 / 6 / 8 sprites | Flecks 12 / 20 / 30 / 40 per end | Embers 4 / 8 / 12 / 16 live · smoke 20 / 40 / 60 / 80 sprites per rope · concurrent burning ropes lit 4 / 8 / 16 / 32 |
| Lifetime | 0.4 s (crumbs per §2.7 debris rules) | 0.5–0.9 s | While burning; smoke 2 s |
| Textures | `fx_puff` | `fx_confetti`, `fx_puff` | `fx_spark` (ember), `fx_smoke` |
| Comfort | Small area, no flash | Small area, no flash | Small area, no flash; ember light flicker 6 Hz ± 10 % (never near the > 10 % screen-area flicker rule) |

### 1.12 Rocket exhaust `fx/rocket_exhaust`
| | |
|---|---|
| Trigger | Skyrocket thrusting (for 2.0 s once the fuse reaches its port). Emitter `EMIT__exhaust__nozzle` (boom.md), +X out of the nozzle (−Z on the upright rocket) |
| Look | Short, bright plume: blue-white nozzle core `#BFE4FF` (15 mm) → `#FFC870` → `#FF8A2A`, **0.25 m** at full thrust (the Skyrocket-exhaust heat source, SIMULATION §5.7), tips flickering to ≤ 0.32 m (§0.6); a spray of fat sparks thrown back along the trail. The smoke ribbon is `fx/smoke_column` from `EMIT__trail__nozzle`; burnout ends with one `fx/smoke_ring` |
| System | GPU particles (flipbook flame + `fx_spark` streaks) + an additive core cone mesh (200 tris) + 1 unshadowed point light riding the nozzle |
| Budget | Flame 300 / 600 / 1,200 / 2,000 live · sparks 100 / 200 / 400 / 600 per s |
| Lifetime | Thrust 2.0 s · flame particle 0.1–0.25 s · sparks 0.2–0.5 s · plume shrinks over the last 0.2 s |
| Textures | `fx_flame`, `fx_spark` |
| Light | Point, 1,900 K, radius 1.5 m, flicker 15 Hz ± 20 % |
| Comfort | Small area, never a large flash; ON: flicker ± 10 % |

---

## 2. Explosions and aftermath

### 2.1–2.3 Explosions by yield

All booms are composites spawned from the sim's `Detonate` event (yield Y, position, causeId). Visual sizes are cartoon-generous on purpose ("overreaction"); they don't change the deterministic blast (GAME_SPEC §6.7). The per-tier spark, ember and debris counts below are **canonical**: GAME_SPEC's examples (e.g. the Powder Keg in §6.1) quote these values, not their own.

| | **Small** `fx/boom_small` | **Medium** `fx/boom_medium` | **Keg** `fx/boom_keg` |
|---|---|---|---|
| Source | Bangstick (Y 1), Clear world per part | Jitterjuice (Y 1.5) | Powder Keg (Y 3) |
| Character | Punchy orange fireball, paper confetti-like debris, one comic smoke ring | Whiter, sharper, more shock than fire; glass tinkle | **Volumetric mushroom**: fireball rolls up into a cap with a stem |
| Fireball peak Ø | 1.2 m | 1.5 m | 2.4 m, cap rising to 4–5 m |
| Grid domain | 2 m cube | 2.5 m cube | 5 m cube centred 2 m above the ground |
| Grid fallback (no slot / M1) | 64 / 96 / 128 / 192 fireball sprites + 24 / 48 / 96 / 160 smoke | ×1.3 | ×2.5 |
| Sparks | 1k / 2k / 4k / 8k | 1.5k / 3k / 6k / 12k | 3k / 6k / 12k / 24k |
| Embers | 150 / 300 / 600 / 1k | 200 / 400 / 800 / 1.5k | 500 / 1k / 2k / 4k |
| Debris micro (§2.7: per yield unit × Y) | 40 / 80 / 160 / 300 `DEB_paper` | 60 / 120 / 240 / 450 `DEB_glass` | 120 / 240 / 480 / 900 `DEB_wood` + `DEB_paper` |
| Shock ring radius (§2.5) | 1.5 m | 1.85 m | 2.6 m |
| Dust kick-up (§2.6) | radius 1.8 m | 2.2 m | 3.5 m |
| Scorch decal (Ø = fireball Ø, §2.8) | Ø 1.2 m + 1–2 soot | Ø 1.5 m + 2 soot | Ø 2.4 m + 3 soot |
| Smoke | puff → ring → 3 s column | puff → 4 s column | plume (§1.10) |
| Flash light | 2,800 K, radius 6 m, 0.25 s decay, shadowed | 4,000 K, radius 7 m | 2,600 K, radius 12 m, 0.4 s decay |
| Hitstop (wall clock) | 60 ms | 80 ms | 100 ms |
| Camera trauma (× user slider, default 70 %) | 0.25 | 0.35 | 0.6 |
| Exposure flash ON / OFF | + 0.4 / + 1.0 EV | + 0.5 / + 1.2 EV | + 0.6 / + 1.5 EV |
| Lifetime | Fireball 0.6 s, total 4 s | 0.5 s, total 5 s | 1.2 s, total 20 s |

- **Auto slow-mo** (0.25× for 0.8 s) when yield in a 0.5 s window is ≥ 3 (GAME_SPEC §13). Off with Reduced motion.
- **Chains:** 400 Bangsticks (the "Kiloton" benchmark) merge per §0.2; the flash limiter keeps it to ≤ 3 large flashes per second.

### 2.4 Firework aerial bursts `fx/firework_<pattern>`
| | |
|---|---|
| Trigger | Skyshow (6 shells, pattern preset per shell); burst events from the sim |
| Look | Launch: crackling spark trail. Burst at the shell's altitude (default 6 m, capped at world height − 1 m), radius 2.5 m (scales with the Skyshow size property up to 6 m). Stars in brand colours: Ignition, Volt, Beam, Plasma, Amber, Cobalt, Bone-white; willow gold `#FFC870` |
| Patterns | **Peony** (sphere, no trails) · **Chrysanthemum** (sphere, sparkling trails) · **Willow** (gold, long drooping trails, heavy drag, 4 s hang) · **Ring** (planar ring facing the camera at burst) · **Palm** (8 thick comet arms + trunk) · **Crossette** (24 stars, each splits into 4 at 0.6 s) · **Heart** (Plasma outline, matches the Helio heart skin) · **Starburst** (Amber 5-point star outline) · **Glitter** (twinkling stars) |
| System | GPU particles (stars + trail children) |
| Budget | Total particles per burst incl. trails: 600 / 1,500 / 3,000 / 6,000 · launch trail 300 / 600 / 1,000 / 1,500 |
| Lifetime | Stars 1.2–2.5 s, willow 4 s, burst smoke 5 s |
| Textures | `fx_spark` (star glint, streak), `fx_smoke` |
| Light | 1 unshadowed point per burst, star colour, radius 8 m, 0.5 s |
| Comfort | Each burst is a small flash (+ 0.3 EV ON / + 0.6 OFF). ON: shells in one battery are spaced ≥ 0.4 s apart visually (the limiter merges extras). **Glitter** strobes at 8 Hz when OFF; ON it becomes a 2.5 Hz soft twinkle at ± 40 % |

### 2.5 Shock ring `fx/shock_ring`
| | |
|---|---|
| Trigger | Every detonation (radius by yield, §2 table), Big Top fire (0.4 m), heavy landings (Thud dropped > 2 m: 0.5 m, no refraction) |
| Look | Thin bright ring on the ground: core `#FFF4E0` → edge `#FFB020`, width 4 % of radius, expands to full radius in 0.25 s (ease-out), fades over 0.15 s. Conforms to the surface. A matching invisible refraction shell expands with it |
| System | Mesh (surface-projected ring) + screen-space refraction shell (strength 0.02) + hitstop + trauma shake |
| Budget | Refraction off / half res / full / full · concurrent rings 16 / 32 / 64 / 64 (merge beyond) |
| Lifetime | 0.4 s |
| Textures | `fx_ring` |
| Comfort | Not a large flash (thin, small area). Reduced motion: refraction ≤ 30 %, no hitstop, no shake |

### 2.6 Dust kick-up `fx/dust_kick`
| | |
|---|---|
| Trigger | Shockwaves (surfaces within 1.2 × ring radius), heavy impacts (impulse ≥ 20 N·s), Brik wall collapses, Big Top fire, Skyrocket launch |
| Look | Low, wide rolling puffs hugging the surface, coloured by the surface: Studio light `#CFCAC1` · Studio dark `#3A3F4A` · Kitchen tile `#D8D0C2` · Backlot dirt `#9C7A55` · grass `#8FA36A` · sand `#DCC9A0` · Hangar deck `#C5C9CF` (`kn_env_deck`) · Moon regolith `#8C8A85`. **Moon (air 0 %): no billowing**; dust flies in clean ballistic arcs and drops (a deliberate gag) |
| System | GPU particles spawned on global-SDF surface points in the radius, lit flipbook |
| Budget | Per yield-1 boom 200 / 400 / 800 / 1,600 (× 1.3 medium, × 3 keg) · per heavy impact 40 / 80 / 160 / 300 |
| Lifetime | 1.5–3 s (Moon 1.2–2.5 s) |
| Textures | `fx_puff` |

### 2.7 Debris
`fx/debris_micro`

| | |
|---|---|
| Trigger | `Break` events (Brik, Plank, Pane, Vase, Fishbowl, Yolk, Stackers), detonations, Helio pop (latex shreds), Clear world |
| Look | Shards from the shared debris library (shared_kit.md §8) in their masters with interior faces; powder shards in the parent's colour; 10 % of burning wood shards trail thin smoke (High/Ultra) |
| System | GPU rigid-lite chunklets (sphere-approximated, collide with the global SDF, sleep below 0.05 m/s for 0.5 s). Macro chunks are deterministic Rigid bodies from the part's `FRAC` and are not VFX |
| Budget | Per S breakable 20 / 40 / 80 / 150 · per M breakable 30 / 60 / 120 / 250 · per yield unit 40 / 80 / 160 / 300 · pool 60k / 150k / 300k / 500k |
| Lifetime | Low: fade after 8 s · Medium: 20 s · High/Ultra: persist as rubble until Stop (oldest fade over 1 s when the pool passes 85 %) |
| Textures | None (master materials) |

### 2.8 Scorch, soot and burn trails `fx/decal_scorch`, `fx/decal_soot`, `fx/decal_burn_trail`
| | |
|---|---|
| Trigger | Scorch: any surface under a fireball (Ø = fireball Ø). Soot: surfaces within 1.5 × that radius, streaked away from the blast. Burn trail: along burned Fuse paths (6 mm wide) and where a Flamer jet touches |
| Look | Scorch: charcoal `#2A2724` centre, soft irregular rim, ember-glow edge (emissive mask) fading over 2 s. Soot: grey-black `#3A3A3E` at 40 %, radial streaks. Burn trail: thin char line. **Critters** get a comedic soot dusting through a material parameter (`soot` 0–1 on fur), never a decal, never a burn (ART_BIBLE §8) |
| System | Clustered decals (projected boxes) |
| Budget | Pool 1,024 / 2,048 / 4,096 / 4,096; per boom 1 scorch + 1–3 soot |
| Lifetime | Until Stop (FIFO eviction with a 1 s fade when the pool is full). **Everything clears on Stop** |
| Textures | `fx_scorch`, `fx_soot`, `fx_burn_trail` |

---

## 3. Matter, splats and confetti

### 3.1 Egg splat `fx/egg_splat`
| | |
|---|---|
| Trigger | Yolk breaks (impulse ≥ 0.3 N·s, GAME_SPEC §12.1) |
| Look | Cartoon-crisp: domed yolk blob `#FFB53D` (40 mm, squash shape key), glossy clear albumen splash ring (decal with wetness, roughness 0.05) Ø 0.25–0.4 m, eggshell shards, a droplet crown |
| System | Mesh (yolk blob, 600 tris) + decal + GPU particles + debris (`DEB_eggshell`) |
| Budget | Droplets 20 / 40 / 80 / 120 · shell shards 8 / 12 / 14 / 14 |
| Lifetime | Droplets 0.6 s · splat decal and blob until Stop |
| Textures | `fx_splat` |

### 3.2 Water splash and foam `fx/water_splash`, `fx/water_foam`
| | |
|---|---|
| Trigger | Matter `Splash` events: a body entering water > 1 m/s, Fishbowl shatter, Tank valve, Sprinkle Can, Waterwheel paddles. Foam: Matter particles with high speed or vorticity at the surface |
| Look | Clear, slightly Beam-tinted water; cartoon-crisp **splash crowns** (12–24 fingers with droplet tips); bright foam `#F4FBFF`; wet stains on dry surfaces that dry out |
| System | Cosmetic GPU particles advected by the Matter velocity field + a shape-animated crown mesh (2k tris, scaled by entry speed) for big entries + foam drawn into the screen-space fluid pass as white + water-stain decals |
| Budget | Spray per splash 200 / 500 / 1,000 / 2,000 · foam live 20k / 60k / 150k / 300k · crowns concurrent 4 / 8 / 16 / 32 |
| Lifetime | Spray 0.5–1.2 s · foam 2–6 s · crown 0.4 s · stains dry over 20 s |
| Textures | `fx_puff` (mist), `fx_water_stain` |

### 3.3 Sand puffs `fx/sand_puff`
| | |
|---|---|
| Trigger | Matter sand grains hitting > 1.5 m/s, avalanches, Grit Hopper start, Hourglass flip, Dusty suction, blasts in sand |
| Look | Warm beige `#DCC9A0` fine dusty puffs. Moon: no puffs (grains only) |
| System | GPU particles from Matter impact events, rate-limited per hash cell |
| Budget | Per puff 16 / 32 / 64 / 96 · live cap 8k / 30k / 80k / 200k |
| Lifetime | 1–2.5 s |
| Textures | `fx_puff` |

### 3.4 Confetti `fx/confetti_burst`
| | |
|---|---|
| Trigger | Popper (200k flakes at Ultra, GAME_SPEC §12.6); critter `celebrate` (200 flakes). The Popper is an **Air puff, not an explosion**: no `Detonate` event, so no fireball, flash, shock ring, scorch, hitstop or trauma. Its only extras are the comic smoke ring (§1.8) and the 30° × 1.0 m air puff that pushes the flakes (SIMULATION §5.8) |
| Look | Brand palette only; matte paper (roughness 0.75), two-sided. Shapes: rectangles 12 × 6 mm (60 %), circles Ø 8 mm (20 %), 5-point stars 10 mm (10 %), squiggle ribbons 30 mm (10 %). Flutter and tumble, wind-reactive. **Air 0 %** (Moon): no flutter, it drops like grit |
| System | GPU particles with the flutter (tumbling plate + lift) model; settled flakes stay on surfaces |
| Budget | Per Popper 25k / 50k / 100k / 200k · pool 128k / 256k / 512k / 1M |
| Lifetime | Low/Medium: settled + 20 s then fade · High/Ultra: until Stop while the pool allows |
| Textures | `fx_confetti` |

---

## 4. Electric and light

### 4.1 Electric arcs and crackle `fx/arc_bolt`, `fx/arc_crackle`
| | |
|---|---|
| Trigger | Arc Tower (arcs to the nearest metal within 2 m), Motor overload, Coilgun discharge, Mains shorts |
| Look | Plasma-white core `#F4F8FF`, Beam `#2FD6FF` outer glow, main bolt + 2–5 branches, **re-randomised at 30 Hz**; crackle sprites at both contact points; arc sparks (§1.3); faint ozone haze |
| System | Compute-generated bolt geometry (camera-facing ribbons) + crackle flipbooks + 1 point light per bolt at its midpoint + froxel injection (Medium+) |
| Budget | Segments per bolt 64 / 128 / 192 / 256 · concurrent bolts 4 / 8 / 16 / 32 · branches max 2 / 3 / 4 / 5 |
| Lifetime | Strike 0.15–0.6 s; continuous while the tower discharges |
| Textures | `fx_crackle` |
| Comfort | ON: bolt geometry still re-randomises at 30 Hz, but the bolt's light and bloom are smoothed to ≤ 3 Hz at ± 15 % (the §0.3 flicker rule), and a strike counts as a large flash only under the §0.3 limiter rule (covers > 25 % of the screen, or trips the measured layer). OFF: light flickers with the bolt at 30 Hz ± 50 % |

### 4.2 Laser beam and dust motes `fx/laser_beam`, `fx/beam_motes`
| | |
|---|---|
| Trigger | Lance powered; Tripwire beams; Mirror and Splitter bounces; Torch cones (motes only) |
| Look | Lance: white core 1.5 mm, Light-channel `#FFF1A8` glow Ø 12 mm, faint volumetric shaft. Through a Burning Glass it becomes a **cutting beam**: glow shifts to Heat `#FF5B2E`, hot spot with sparks and smoke wisps at the hit point. Tripwire: 1 mm at 40 % so players can see it. Motes: specks lit only inside beams and cones, drifting with the air, glinting when crossing the core |
| System | Mesh (beam ribbons with soft falloff, one segment per bounce, max 16) + froxel injection (Medium+) + GPU particles (motes spawned in a capsule around each beam) |
| Budget | Motes per beam 100 / 250 / 500 / 1,000 · per Torch cone 200 / 500 / 1,000 / 2,000 · cutting sparks 50 / 100 / 200 / 400 per s |
| Lifetime | Beams continuous · motes 4–8 s (recycled) |
| Textures | `fx_halo` (hit spot), `fx_spark` |
| Comfort | Steady, no flicker |

### 4.3 Bloom halos `fx/bloom_halo`
| | |
|---|---|
| Trigger | Any emissive above the bloom threshold: LEDs, port rings, lamps, sparks, flames, screens |
| Look | Tight, neutral bloom (not hazy). Small emitters whose projected size is < 3 px get a 6–12 px soft sprite halo in their colour so state stays readable at distance. Star glints only on sparks and fireworks, never on LEDs |
| System | Screen-space bloom (6-mip dual filter) + sprite halos (1 particle per qualifying emitter) |
| Budget | Halo sprites 2k / 4k / 8k / 16k |
| Lifetime | Per frame (stateless) |
| Textures | `fx_halo` |
| Comfort | ON: bloom ≤ 1.0 × scene luminance, no lens dirt. OFF: ≤ 2.0 × |

---

## 5. Critter comedy

All critter effects are friendly and never imply injury (ART_BIBLE §8). Billboards face the camera and clamp to **24–72 px** on screen. Concurrent critters with comedy FX: 8 / 16 / 32 / 32. No flashes.

| Effect | Trigger | Look | System | Budget L / M / H / U | Lifetime |
|---|---|---|---|---|---|
| **Dizzy stars** `fx/critter_dizzy` | `dizzy` state after a ragdoll `getup` | 3–5 chunky Amber `#FFB020` 5-point stars (rounded points, extruded, 30 % emissive) orbiting the head at 0.6 × head width, 1.2 rev/s, 15° tilt, plus sparkles | Mesh (instanced stars, 400 tris each) + particles | Sparkles 10 / 15 / 20 / 20 | State duration (2–4 s), pop-out at end |
| **Sweat drops** `fx/critter_sweat` | `flee`, `trapped`, `startled`, being chased | 2–3 glossy teardrops `#BFF0FF` popping off the temple, arcing and fading | 3D drop mesh (120 tris) | 3 drops | 0.6 s each, re-emit every 0.8 s while the state lasts |
| **"!" pop** `fx/critter_alert` | `startled`, spotting a target, Sound startle | Ignition "!" in Unbounded Black inside a spiky paper-white `#EEF1F6` pop bubble; scale 0 → 1.25 → 1 in 120 ms | Billboard (`fx_critter`) | 1 | 0.9 s |
| **"zzz"** `fx/critter_zzz` | `sleep` | Three Unbounded Black Z's, paper-white with a Graphite 2 px outline, rising and drifting sideways, growing 0.6 → 1.0 | Billboards | 3 live | 2.4 s each, one every 0.9 s |
| **Emote bubble** `fx/critter_emote` | `CritterState` events (GAME_SPEC §11: "👀 Pip!", "😾", "zzz") | Rounded speech bubble, paper `#EEF1F6` fill, Graphite `#12151C` 3 px outline, tail to the head; one custom emote glyph from the UI set (ui_icons.md §2.12, never system emoji) + optional 1–2 word Inter Semibold label | Billboard, anchored 0.15 m above the head; captioned for accessibility | 1 per critter | 1.5–2.5 s |
| **Goby bubble rescue** `fx/critter_goby_bubble` | Goby's 8 s `flop` ends (SIMULATION §7.3; the flop is Mochi's lure window) | Iridescent soap bubble (thin-film shader, Beam/Plasma swirl) forms around Goby and floats it to Matter water within 3 m, then pops with sparkles. With no water in reach it pops in place and Goby waits as an icon in the empty cradle until Stop (SIMULATION §7.3) | Mesh (sphere, 1k tris) + particles | Sparkles 40 / 80 / 120 / 160 | 1.6 s |
| **Soot dusting** | Critter inside a blast's soot radius | Grey powder on the fur (`soot` material parameter), sneeze puff (`fx/smoke_puff`, 8 sprites) | Material + particles | — | Until Stop |

---

## 6. Fault

### 6.1 Jam / fault puff `fx/jam_puff`
| | |
|---|---|
| Trigger | A part enters Fault (jam, stall, overload). **Synced to the port-ring fault blink: one spurt per blink-on at 2 Hz** (ART_BIBLE §5) |
| Look | Amber `#FFB020` spark spurt + a small grey `#5B6270` puff from the jammed point (the part's main pivot or its fault emitter) |
| System | GPU particles |
| Budget | Per blink: sparks 12 / 24 / 40 / 60, puff 3 / 4 / 6 / 8 sprites |
| Lifetime | Sparks 0.3 s, puff 0.8 s; repeats until the fault clears |
| Textures | `fx_spark`, `fx_puff` |
| Comfort | 2 Hz, small area: allowed |

---

## 7. Future Tech

### 7.1 Singularity `fx/singularity_lens`, `fx/singularity_disk`
| | |
|---|---|
| Trigger | Singularity Signal → 6 s pull of everything within 20 m into the recycle core (GAME_SPEC §12.6) |
| Look | **0–0.5 s:** a pure black core grows Ø 0.05 → 0.3 m with a thin Plasma `#FF3DAE` photon ring. **0.5–6 s:** a flat accretion disk around the device axis, hot white `#FFF4E0` inside → Ignition → Plasma → dark outside, the approaching side 40 % brighter; infalling bodies stretch up to 1.5 × along the radius within 1 m (render-only) and trail dust; screen-space gravitational lensing with an Einstein-ring brightening at 0.6 m, growing to 1.5 m. **6 s:** implosion snap, a Plasma shock ring, one flash, the core vanishes with a pop |
| System | Screen-space lensing pass + GPU particles (disk and infall streams) + mesh core and photon ring |
| Budget | Disk 20k / 60k / 150k / 300k · infall streams 5k / 15k / 40k / 80k · lensing half res on Low, full on Medium+ |
| Lifetime | 6.8 s |
| Textures | `fx_spark`, `fx_ring`, `fx_halo` |
| Comfort | Final flash + 0.5 EV (ON) / + 1.2 EV (OFF), counts toward the limiter. Reduced motion: lensing ≤ 30 % strength, no stretch |

### 7.2 Rift Gate shimmer `fx/rift_shimmer`
| | |
|---|---|
| Trigger | Rift Gates active (idle shimmer); a body teleporting (max 1 per 0.25 s per pair) |
| Look | Round aperture, Ø 0.31 m (the RIFT GATE membrane on the 4 × 4 × 0.5-cell gate, so every Roller passes), with an edge glow in the Field colour. Idle: swirling refractive surface. High/Ultra: shows the view out of the partner gate behind a ripple. Teleport: a ripple ring across both apertures, sparkles at both gates, a 0.15 s ghost smear on the body |
| System | Mesh aperture + render-to-texture of the partner view (High/Ultra) or `fx_rift_swirl` (Low/Medium) + screen-space refraction + particles |
| Budget | Partner views: 0 / 0 / 1 pair at 256² / 2 pairs at 512² (others swirl) · teleport sparkles 120 / 240 / 400 / 600 |
| Lifetime | Continuous · ripple 0.4 s · sparkles 0.6 s |
| Comfort | No flash on teleport |

### 7.3 Stasis Field `fx/stasis_field`
| | |
|---|---|
| Trigger | Stasis Field powered (volume 0.1–1 m per side) |
| Look | Box volume drawn as a Field-colour **hex lattice**: 12 % on faces, 60 % on edges, corner brackets. Bodies inside get a "time-stopped" look: 50 % desaturation, cool tint, crisp Field rim. **Spectacle particles inside freeze in place** (sparks, smoke, confetti hang mid-air), with slow drifting glints. On: the lattice sweeps in from the four corner nodes (`EMIT__field__node_*`, future.md) in 0.3 s. Off: it shatters into sparkles |
| System | Mesh (box shell with lattice shader) + per-instance material overlay on frozen bodies + particles (the particle sim honours stasis volumes) |
| Budget | Glints 100 / 200 / 400 / 800 per field · off-shatter 200 · visible fields 8 / 16 / 32 / 64 |
| Lifetime | While powered |
| Textures | `fx_field_hex` |

### 7.4 Tractor Beam `fx/tractor_beam`
| | |
|---|---|
| Trigger | Tractor Beam powered (pull or hold) |
| Look | Soft cone of light from the emitter, Field-colour edges, 20 % white core. **Pull:** rings travel toward the emitter at 1.5 m/s (deliberately 3 × the 0.5 m/s reel-in, so the direction reads at a glance). **Hold:** rings stand still and breathe, and one brighter ring marks the hold point (0.5–3 m along the beam, the inspector's hold distance). Held objects get a rim glow and orbiting motes |
| System | Mesh (cone with scrolling ring shader, length = the part's beam length) + froxel injection (Medium+) + particles |
| Budget | Motes 200 / 400 / 800 / 1,500 |
| Lifetime | Continuous; a new ring every 0.25 s |
| Textures | `fx_ring`, `fx_halo` |

### 7.5 Hover Pad `fx/hover_pad`
| | |
|---|---|
| Trigger | Hover Pad powered; load on the pad |
| Look | Underside glow disc (Field colour, 40 %), heat-shimmer column between pad and surface, two ground ripple rings expanding 0 → 0.4 m at 1.5 Hz, motes pushed outward. Under load the rings speed up (to 3 Hz) and brighten |
| System | Mesh (disc + surface-projected rings) + screen-space distortion + particles |
| Budget | Motes 50 / 100 / 200 / 400 · distortion off / half / full / full |
| Lifetime | Continuous |
| Textures | `fx_ring` |

### 7.6 Force Wall `fx/force_wall`
| | |
|---|---|
| Trigger | Signal on / off; impacts on the wall |
| Look | Hex-lattice plane (Field colour, 15 % idle, brighter edges) between two emitter posts. Impact: ripple rings from the contact point (2 m/s for 0.6 s, brightness ∝ impulse), nearby cells light to 80 %. On: the lattice prints inward from the posts in 0.25 s. Off: fades in 0.2 s (no flicker) |
| System | Mesh (plane, lattice shader, ripple buffer) + particles |
| Budget | Ripples per wall 4 / 8 / 8 / 8 · sparkles per strong impact 20 / 40 / 80 / 120 · visible walls 16 / 32 / 64 / 128 |
| Lifetime | While on · ripple 0.6 s |
| Textures | `fx_field_hex`, `fx_ring` |
| Comfort | No strobe; impact brightness capped at 80 % |

---

## 8. Port-ring LED pulse
`fx/port_pulse`

| | |
|---|---|
| Trigger | Engine port state (ART_BIBLE §5) |
| Look | **Idle** 8 % · **Connected** 25 % · **Active** 100 % with bloom · **Flowing**: 70 % base + one bright pulse (25 % of the circumference, cosine profile) travelling along the LED UV U at 1 rev/s, scaled by flow rate (0.5–2 rev/s); clockwise for `out`, counter-clockwise for `in`, ping-pong for `both` · **Fault**: Amber `#FFB020`, 2 Hz blink, 50 % duty, 40 ms soft edges, overriding the channel colour · **Connection made**: one-shot 100 % → 25 % over 0.3 s + 8 sparkles in the channel colour |
| System | Material: `kn_led` emissive driven from a per-instance state buffer; sprite halo when < 3 px (§4.3) |
| Budget | Unlimited (material) · connect sparkles 0 / 8 / 8 / 8 |
| Lifetime | Stateless |
| Comfort | Smooth pulse is not a flash; 2 Hz fault blink is small-area and allowed. Player colours are never shown on rings |
