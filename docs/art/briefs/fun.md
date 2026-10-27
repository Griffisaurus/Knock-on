# Fun and sound briefs

Dominoes, pins, block towers, breakable glass, tuned bars, a bell, an RC car and a rubber duck: GAME_SPEC §12.9.

Back to the index: [README.md](./README.md)

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| TOPPLE TILES | `topple_tile` | S | M1 | brief |
| PINS | `pin` | S | M3 | brief |
| STACKERS | `stacker` | S | M3 | brief |
| PANE / VASE | `pane`, `vase` | S | M3 | brief |
| TONEBARS | `tonebars` | M | M3 | brief |
| DING | `ding` | S | M3 | brief |
| ZIPPY | `zippy` | M | M4 | brief |
| QUACK | `quack` | S | M4 | brief |

---

### TOPPLE TILES: Brush-laid domino tile
`topple_tile` · Fun · Class S · Ship M1 · Inspired by (internal only): none

**Concept.** A chunky bone-white tile with one coloured band, the approved look-dev shape from `style_samples.py` (`topple_tile()`). Laid by the Brush in lines of thousands, it has to look premium alone and become a rhythmic ribbon of colour at 100k. The band colour is the only decoration, so a curving run reads as a striped line from across a Megastructure.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.03 × 0.15 × 0.075 m (0.3 × 1.5 × 0.75) · origin: centre of mass = box centre (0, 0, 0); base face at z −0.075. Thin axis is X, so a tile falls along ±X |
| Mass · physics | 0.20 kg · `phys = wood` (lacquered hardwood core under bone powder, wood "clack" bank) · restitution 0.15, friction 0.45 · spawns asleep |
| Collision | `COL__box__0` 0.03 × 0.15 × 0.075 (W × H × D, as Size) at origin, `convex_radius` 0.003 |
| Materials (60/30/10) | neutral: `kn_powder_bone` (whole tile) · signature: band tint, per instance · accent: optional top-cap tint (lead tile). **One material slot.** Band and top cap faces carry vertex-colour attribute `tint` = 1. The engine multiplies in an instance colour index (3 bits: none, ignition, cobalt, plasma, amber, beam, volt, graphite), so the Brush can lay patterns without extra materials |
| Ports | none (Impact only, by contact) |
| Pivots | none (free body) |
| Sensors | none |
| Emitters | none (the engine plays contact audio and dust from the contact point) |
| LEDs / screens | none |
| States | standing (asleep) · falling · fallen (re-sleeps after 0.5 s still). Build mode: Brush ghost tiles at 40 % opacity with a spacing tick on the floor |
| Animation | none, pure rigid body |
| Fracture | none |
| Skins / variants | band colour per instance (default Brush pattern alternates ignition/cobalt, as in the `boom` look-dev scene) · **lead** variant: ignition band + ignition top cap (tint on the 2 top faces, no extra geometry), so the start of a run reads from above · **giant** variant: the same mesh scaled ×4 by the engine (0.12 × 0.60 × 0.30 m, 12.8 kg). Bevel scales to 16 mm, which still meets ≥ 1.5 % |
| Budget | LOD0 ≤ 280 tris (bevelled box: 4 mm bevel, 3 segments, plus 2 edge loops at the band edges) · LOD1 140 · LOD2 64 · LOD3 12 (plain box) · impostor beyond 40 m · no unique texture (master + vertex colour) |
| Audio hooks | `tile_clack` (tile on tile, 3 intensities × 4 variants) · `tile_floor_slap` · `tile_cascade_bed` (granular loop driven by the fall rate, so 100k tiles sound like a rushing wave, not 100k clicks) · `tile_giant_thump` |

**Read at a glance.** Tall thin bone slab with a single coloured stripe at upper height. In runs: a dotted line of colour.
**Notes / don'ts.** Band centre at z +0.025 from origin, 12 mm tall, wrapping all four sides. The look-dev band stands 0.6 mm proud; here it is flush colour, because the proud lip costs ~120 tris across 100k instances. No decals, no pips, no numbers (it is not a gaming domino). Keep the base face perfectly flat: tiles must stand on any surface and sleep reliably. No transmission, ever.

---

### PINS: Bowling pin, racked in sets of 10
`pin` · Fun · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A toy-scale bowling pin in bone with two coloured neck stripes. It's placed by the Brush or as a 10-pin rack. It has to wobble, teeter and clatter like a real pin, so the profile and the low centre of mass matter more than detail.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.05 × 0.15 × 0.05 m (0.5 × 1.5 × 0.5) · origin: centre of mass, 0.055 m above the base (base at z −0.055) |
| Mass · physics | 0.10 kg · `phys = wood` · restitution 0.35, friction 0.4 |
| Collision | `COL__hull__0` lathe of the profile, 6 rings × 5 sides = 30 verts (the neck concavity is filled, which is fine for toppling) |
| Materials (60/30/10) | neutral: `kn_powder_bone` · signature: stripe tint (default ignition) · accent: none. **One material slot**. The stripe faces carry `tint` = 1 and the instance colour comes from the Brush or rack |
| Ports | none |
| Pivots | none |
| Sensors | none (the engine fires a `PinsAllDown` event when all 10 of a rack are > 45° from upright) |
| Emitters | none |
| LEDs / screens | none |
| States | standing · wobbling · down. Build mode: the rack ghost shows a 10-pin triangle with the head pin toward −Y |
| Animation | none, rigid body |
| Fracture | none |
| Skins / variants | stripe tint: ignition (default), cobalt, plasma · **rack** placement: 10 pins in a triangle at 0.12 m centre spacing (4 rows, head pin at front) |
| Budget | LOD0 ≤ 290 tris (14 sides × 10 profile rings plus caps) · LOD1 140 · LOD2 70 · LOD3 24 · no unique texture |
| Audio hooks | `pin_clatter` (pin on pin, 3 × 4) · `pin_floor_knock` · `pin_wobble_tick` (low-energy rocking) · `pins_strike_sting` (on `PinsAllDown`, also drives a "STRIKE" toast) |

**Read at a glance.** The universal pin silhouette (belly, neck, round head) in bone, with two bright neck stripes.
**Notes / don'ts.** Keep the base flat and Ø 20 mm so pins stand without jitter. No brand-like crown logos. Stripe loops double as profile rings, so don't add loops for them.

Profile, 10 rings plus the crown pole (height above base → diameter): 0.000 → 0.020 (flat base) · 0.015 → 0.034 · 0.045 → 0.048 (belly) · 0.080 → 0.036 · 0.093 → 0.024 · 0.097 → 0.021 · 0.103 → 0.018 (neck) · 0.107 → 0.019 · 0.126 → 0.025 (head) · 0.142 → 0.020 · 0.150 → 0.0 (rounded crown). Stripes: two 4 mm bands, 0.093–0.097 and 0.103–0.107 above the base (centres 0.095 and 0.105); their edges are the profile rings, so no extra loops are needed.

---

### STACKERS: Hardwood block for wobbly towers
`stacker` · Fun · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A warm oak block, three to a layer, crossed layer on layer into a tower you can nudge, punch or blast apart. The beauty is in the wood: clean grain, soft bevels, a faint hand-polished sheen on the ends.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.03 × 0.30 m (1 × 0.3 × 3) · origin: centre of mass = box centre |
| Mass · physics | 0.60 kg · `phys = wood` · restitution 0.1, friction 0.55 (towers must hold, and blocks must slide when pushed) |
| Collision | `COL__box__0` 0.10 × 0.03 × 0.30 (W × H × D, as Size), `convex_radius` 0.002 |
| Materials (60/30/10) | `kn_wood_oak` throughout (wood is this part's neutral and signature, per ART_BIBLE §4 "Stackers") · accent: none. **One material slot** with a shared 1024² oak trim (baked from the procedural master). Each instance gets a seeded UV offset (engine) so a tower never shows repeated grain |
| Ports | none |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | resting · sliding · falling. Build mode: Brush lays a tower (default 18 layers × 3, alternating 90°) with a height readout |
| Animation | none |
| Fracture | none (blocks are tough; explosions scatter them) |
| Skins / variants | `oak` (default) · `walnut` (swaps the master to `kn_wood_walnut`, still one slot). Brush option alternates oak and walnut per layer |
| Budget | LOD0 ≤ 220 tris (4.5 mm bevel = 1.5 % of 0.30 m per ART_BIBLE §2, 3 segments) · LOD1 110 · LOD2 52 · LOD3 12 · shared 1024² oak trim (BaseColor + ORM + Normal) |
| Audio hooks | `block_knock` (wood on wood, 3 × 4) · `block_slide` (scrape loop, velocity-driven) · `tower_collapse_bed` (granular cascade layer) |

**Read at a glance.** Long, flat, honey-coloured plank-blocks in crossed layers. The tower silhouette is the read.
**Notes / don'ts.** Grain runs along the 0.30 m length. End grain on the 0.10 × 0.03 faces. Hand-polish wear only on the end faces. **Never** use the trademarked tower-game name in any player-facing text, label or file.

---

### PANE / VASE: Hero-shatter glass sheet and vase
`pane` · `vase` · Fun · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** Two breakables made for the slow-mo replay. PANE is a tall sheet of glass with Plasma top and bottom edge channels, so it reads on a bright cyc. VASE is a classic baluster vase in glossy Plasma ceramic with a bone lip, or clear glass as a skin. Both shatter into readable shards and a sparkle of micro-debris.

| Spec | Value |
|---|---|
| Size (W×H×D) | **pane** 0.10 × 0.40 × 0.014 m (1 × 4 × 0.1; channels add 4 mm, within tolerance) · **vase** 0.10 × 0.20 × 0.10 m (1 × 2 × 1) · origin: centre of mass (pane z +0.20 above base; vase z +0.075 above base) |
| Mass · physics | pane 1.0 kg, `phys = glass`, break threshold 0.8 N·s · vase (ceramic) 0.45 kg, `phys = ceramic`, break 0.6 N·s · vase (glass skin) 0.35 kg, `phys = glass`, break 0.5 N·s · restitution 0.2, friction 0.4 |
| Collision | pane: `COL__box__0` 0.10 × 0.40 × 0.014 (W × H × D, as Size) · vase: `COL__hull__0` (lathe, 40 verts), with the mouth closed |
| Materials (60/30/10) | **pane** neutral: `kn_glass` (10 mm sheet, polished 2 mm edge bevels: the ART_BIBLE §2 minimum; 1.5 % of 0.40 m cannot fit a 10 mm sheet) · signature: `kn_powder_plasma` U-channels, 12 mm tall, on top and bottom edges, rubber-lined (`kn_rubber` sliver) · accent: `kn_decal` frosted-etch name plate "PANE" in the lower-left corner · **vase** neutral: `kn_ceramic_bone` interior and lip roll · signature: `kn_ceramic_plasma` outer glaze · accent: `kn_decal` tiny potter's mark on the foot |
| Ports | none |
| Pivots | none |
| Sensors | none (breaks from the impact damage model) |
| Emitters | `EMIT__shatter__centre` (pane (0, 0, 0); vase (0, 0, 0.02)): glass or ceramic micro-debris burst (debris library, 120–200 shards) + sparkle glints |
| LEDs / screens | none |
| States | intact · cracked (pane only: an engine decal crack star appears at 60–99 % of the threshold) · shattered (chunks + debris; chunks fade to rubble after 8 s or persist, as set by the world option) |
| Animation | none |
| Fracture | **pane** 24 chunks (`FRAC__0..23`, the ASSET_PIPELINE §7 maximum): 22 glass chunks in a radial "spider" pattern centred 0.18 m above the base, long sliver shards outward, plus both channels as 2 intact chunks · **vase** 16 chunks: curved wall shards, the foot ring stays one intact chunk (comic "base survives" beat) · interiors `kn_interior_glass` / `kn_interior_ceramic`, each chunk ≤ 1,500 tris |
| Skins / variants | pane: plasma channels (default), cobalt, amber · vase: plasma ceramic (default), cobalt ceramic, amber ceramic, bone ceramic, `glass` (clear `kn_glass` body, bone ceramic lip ring) |
| Budget | pane LOD0 ≈ 600 tris · vase LOD0 ≈ 2,800 tris (48 sides; wall thickness 4 mm modelled) · 1024² per item (decal from the atlas) |
| Audio hooks | `glass_tink` (light knock) · `glass_shatter` (layered: crack transient + shard rain tail, scaled by size) · `ceramic_shatter` · `shard_settle` loop (tinkling debris) · `pane_crack` (pre-break creak) |

**Read at a glance.** PANE: a tall clear slab with two bright Plasma edges. VASE: a fat-bellied Plasma vase with a bone lip.
**Notes / don'ts.** Glass alone vanishes on the light cyc, so the Plasma channels are mandatory on PANE, and VASE defaults to ceramic for the 150 px read. The pane stands on its 14 mm channel and topples easily, on purpose. Never stack the glass vase inside the Fishbowl (that would be 3 transparent layers). No sharp-shard close-ups near critters (ART_BIBLE §8).

Vase profile (height above base → outer diameter): 0.000 → 0.060 (foot) · 0.012 → 0.056 · 0.070 → 0.100 (belly) · 0.140 → 0.060 · 0.160 → 0.045 (neck) · 0.192 → 0.056 · 0.200 → 0.060 (lip roll, Ø 6 mm torus).

---

### TONEBARS: Tuned bar on a node cradle, brush-laid as a scale
`tonebars` · Fun · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** One placed instance = one tuned bar floating on rubber nodes over a slim graphite cradle. The Brush lays them side by side into a two-octave staircase, and a rolling ball plays a melody in the world's key. Anodised colours step around the scale, so a run of bars reads as a song you can see.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.05 × 0.30 m per bar unit (1 × 0.5 × 3; every variant shares this footprint, and only the bar length changes) · origin: bottom centre |
| Mass · physics | 1.2 kg · static when placed · bar `phys = steel` (metal skin) or `wood` (wood skin) · restitution 0.45 on the bar top |
| Collision | `COL__box__0` bar (0.085 × 0.014 × per-variant length L, W × H × D, top at z 0.050) · `COL__box__1` cradle rail 0.07 × 0.020 × 0.30 (W × H × D) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` cradle + `kn_rubber` node grommets and feet · signature: bar in `kn_anod_<degree colour>` (metal skin) or `kn_wood_walnut` (wood skin) · accent: `kn_brass` node pins, LED dome, note screen |
| Ports | none (Sound is broadcast; Impact is by contact) |
| Pivots | `PIVOT__bar` · axis z, translate · min −0.002 / max 0.002 m · damped ring-out wobble of the bar on strike (amplitude ∝ impulse) |
| Sensors | `SENSOR__trigger__bar` (impact trigger kind, SIMULATION §5.1) · threshold 0.02 N·s, cooldown 0.06 s · thin slab over the bar top (z 0.050–0.058) · velocity drives the note volume |
| Emitters | `EMIT__note__bar` (0, 0, 0.058) +X → +Z: audio source + a small sound-ring ripple (Sound channel pink) |
| LEDs / screens | LED group 0 `note`: `LED_D8` dome (bezel Ø 11 mm) on the cradle-rail front face at (−0.020, −0.150, 0.014), flashes on each note · `SCREEN__note` kind `text`, 3 chars, 0.026 × 0.010 m quad (bezel 0.034 × 0.018 with the 4 mm kit border) at (0.010, −0.150, 0.014), so LED and bezel both fit the 0.07 × 0.020 rail face with a 7.5 mm gap: note name in the current world key ("C4", "F#5"), shown in Build, dimmed in Run |
| States | idle · struck (LED flash, bar wobble, ripple) · muted (inspector "mute", LED off, screen shows "--") |
| Animation | procedural pivot only |
| Fracture | none |
| Skins / variants | 15 bar variants `tonebars__bar_00` … `_14` (lengths below) · skin `metal` (default, glockenspiel/chime timbre) · skin `wood` (walnut bars, xylophone/marimba timbre, LED keeps the degree colour) |
| Budget | LOD0 ≈ 3,200 tris (bar 400, cradle 1,800, nodes, feet) · 2048² shared by all 15 variants (bar UVs normalised) |
| Audio hooks | `tonebar_note_metal` / `tonebar_note_wood` (one sample per scale degree × 2 octaves + top tonic, re-pitched to the world key; 3 velocity layers) · `tonebar_damp` (ball resting on the bar) · `tonebar_knock` (side hit on the cradle) |

**Read at a glance.** A coloured metal bar floating on two pegs over a dark rail. Laid in a row: the classic toy-xylophone staircase in a warm-to-cool sweep.
**Notes / don'ts.** Every tonic bar is ignition, so octaves are easy to count. Pentatonic and minor worlds reuse the same 15 bars (colour = degree, not absolute note). Never print absolute note names on the mesh; the screen shows them. Bars are all one colour each (no gradients).

**Two-octave set** (15 scale degrees, scale-agnostic: each step shortens the bar by 2^(−1/14), so length halves over two octaves; the world key and scale choose the actual pitch). Node posts sit at ±0.276 L from the centre (the 22.4 % free-bar nodes):

| Bar | Degree | Length L (m) | Node posts ±y (m) | Colour (`kn_anod_*` / metal) |
|---|---|---|---|---|
| 00 | 1 | 0.300 | 0.083 | ignition |
| 01 | 2 | 0.286 | 0.079 | copper (`kn_copper`) |
| 02 | 3 | 0.272 | 0.075 | brass (`kn_brass`) |
| 03 | 4 | 0.259 | 0.071 | volt |
| 04 | 5 | 0.246 | 0.068 | beam |
| 05 | 6 | 0.234 | 0.065 | cobalt |
| 06 | 7 | 0.223 | 0.062 | plasma |
| 07 | 1′ | 0.212 | 0.059 | ignition |
| 08 | 2′ | 0.202 | 0.056 | copper |
| 09 | 3′ | 0.192 | 0.053 | brass |
| 10 | 4′ | 0.183 | 0.050 | volt |
| 11 | 5′ | 0.174 | 0.048 | beam |
| 12 | 6′ | 0.166 | 0.046 | cobalt |
| 13 | 7′ | 0.158 | 0.044 | plasma |
| 14 | 1″ | 0.150 | 0.041 | ignition |

Bar section 0.085 wide × 0.014 thick, top at z 0.050, 2 mm bevel with a slight arch undercut on the bottom face (real tuning cut, visible from the 3/4 view). Cradle rail 0.07 wide × 0.020 tall, full 0.30 length, on 4 rubber feet (4 mm). Node posts are 12 mm graphite pillars with rubber grommets and brass pins.

---

### DING: Desk bell with a hero plunger
`ding` · Fun · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A chunky service bell: a polished brass dome on a bone base, topped with an oversized Ignition gloss plunger that begs to be hit. Ding! It's tuned to the world key, and it's the loudest small thing in the game: every critter in range startles.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.10 m (1 × 1 × 1) · origin: centre of mass (0.035 above the base) · positions below are from the base centre |
| Mass · physics | 0.45 kg · free body · base `phys = powder` on rubber, dome `phys = steel` · restitution 0.3 |
| Collision | `COL__cylinder__0` base Ø 0.090 × 0.020 · `COL__sphere__1` dome (r 0.042, centre z 0.025, clipped by the base) · `COL__cylinder__2` plunger cap Ø 0.030 × 0.012 |
| Materials (60/30/10) | neutral: `kn_powder_bone` base + `kn_steel_brushed` stem · signature: `kn_brass` dome · accent: `kn_powder_ignition_gloss` plunger cap (a hero button), LED ring, `kn_rubber` foot ring |
| Ports | none |
| Pivots | `PIVOT__plunger` · axis z, translate · min −0.008 / max 0 m · cap + stem dip on strike, spring return 0.08 s · `PIVOT__dome` · axis z, rotate · ±3° · tiny shiver while ringing |
| Sensors | `SENSOR__trigger__plunger` · threshold 0.04 N·s · over the cap (z 0.088–0.100) · `SENSOR__trigger__dome` · threshold 0.10 N·s · shell over the dome (dull "dunk" below 0.25 N·s, full ring above) |
| Emitters | `EMIT__ring__dome` (0, 0, 0.065) +X → +Z: audio + Sound-channel ripple rings (3 expanding pink rings, radius = startle radius 4 m, drawn at 30 % in Run) |
| LEDs / screens | LED group 0 `ring`: 3 mm light bar around the base top edge at z 0.020, flashes Sound pink for the ring duration |
| States | idle · ringing (plunger dip, dome shiver, LED, ripple) · knocked over (rings once on the dome sensor when it lands) |
| Animation | procedural pivots |
| Fracture | none |
| Skins / variants | brass dome (default) · chrome dome (`kn_chrome`, brighter, octave higher by default) |
| Budget | LOD0 ≈ 2,400 tris · 1024² (shared trim) |
| Audio hooks | `ding_strike` (3 intensities × 4, pitched to the world tonic or the inspector's scale degree) · `ding_ring_tail` (long decay, choked when the dome is touched) · `ding_dunk` (side knock) |

**Read at a glance.** Gold dome, bright red-orange nub on top, cream base. Unmistakably "ring me".
**Notes / don'ts.** The plunger cap must stay the largest-reading accent (it's the interaction point). No hotel or brand engraving on the dome. The startle radius is gameplay data (part.json); the ripple VFX must match it.

Layout (from base centre): base Ø 0.090, z 0–0.020 (6 mm pillowed edge) on a rubber foot ring 4 mm · dome Ø 0.084, rising from z 0.020 to 0.068 · stem Ø 0.006 `kn_steel_brushed`, z 0.068–0.088 · plunger cap Ø 0.030 (1.4× real), z 0.088–0.100 · name plate decal "DING" on the base front at (0, −0.044, 0.010).

---

### ZIPPY: Signal-driven RC buggy
`zippy` · Fun · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A stubby toy RC buggy with oversized knobbly tyres, an Ignition shell and a whippy antenna with a ball tip. A Signal sends it off; it drives, bumps, tows a Line and sometimes flips. It should look like the coolest toy on the shelf: big wheels, low nose, visible motor and spur gear at the back.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.10 × 0.10 m (2 × 1 × 1) · long axis X; **nose at +X**, drives toward +X, so the default camera sees the side profile · origin: centre of mass, 0.035 m above the ground (ground at z −0.035) |
| Mass · physics | 0.80 kg · Jolt vehicle · chassis `phys = powder`, tyres `phys = rubber` friction 1.1 · torque and top speed in part.json |
| Collision | `COL__box__0` chassis 0.18 × 0.04 × 0.07 (W × H × D, as Size) at (0, 0, 0.005) · `COL__box__1` shell 0.14 × 0.03 × 0.075 at (0, 0, 0.030) · `COL__wheel__0..3` r 0.030, width 0.022, at (±0.065, ±0.0375, −0.005) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` chassis tub, bumpers and wheel hubs + `kn_rubber_grip` tyres · signature: `kn_powder_ignition` body shell · accent: exposed motor and spur gear at the rear (`kn_steel_brushed`, `kn_copper` windings, `kn_anod_volt` spur), LEDs, antenna ball |
| Ports | `PORT__signal__go` · in · PR-S · (0.010, 0, 0.046) · facing +Z (roof; a wire becomes a slack tether, or the inspector pairs Zippy with a PING Rx) · `PORT__tension__tow` · both · PR-S · `kind = hook` · (−0.100, 0, 0.000) · facing −X (rear hook) |
| Pivots | `PIVOT__wheel_fl/fr/rl/rr` · axis y, continuous · `PIVOT__steer_fl/fr` · axis z · ±25° · `PIVOT__antenna` · axes x/y, spring sway ±20° · `PIVOT__shell_roll` · axis x · ±6° (procedural lean, shell only) · `PIVOT__spur` · axis y, continuous (rear gear, visible) |
| Sensors | `SENSOR__trigger__bumper_front` · 0.02 m slab ahead of the nose, threshold 0.1 N·s (bump-and-stop or bump-and-reverse, as set in the inspector) |
| Emitters | `EMIT__dust__wheel_rl` / `_rr` (−0.065, ±0.0375, −0.035) +X → −X: dust kick and wheel spray (dry, wet, sand) · `EMIT__spark__underbody` (0, 0, −0.015), on the chassis underside: scrape sparks on hard landings · `EMIT__horn__nose` (0.095, 0, 0.010) |
| LEDs / screens | group 0 `headlights`: 2 domes Ø 8 mm at (0.098, ±0.025, 0.012), on while driving · group 1 `tail`: 2 bars at (−0.098, ±0.028, 0.015), brake flash · group 2 `status`: dome next to the roof port, blinks on signal receive |
| States | parked (headlights 25 %) · driving (wheels, dust, motor visible spinning) · blocked (wheels spin in place, dust, port fault blink) · towing (Line taut, tail LEDs on) · flipped (wheels spin in air, antenna wobbles; no self-right) |
| Animation | procedural pivots; Jolt drives the wheels and steering |
| Fracture | none |
| Skins / variants | ignition shell (default) · cobalt shell · plasma "future" shell with a beam-tint headlight bar |
| Budget | LOD0 ≈ 8,500 tris (tyres 4 × 1,200 with real knobs) · 2048² |
| Audio hooks | `zippy_motor_loop` (whine, pitch ∝ wheel speed) · `zippy_start_beep` (cute double "beep-beep" on signal) · `zippy_tyre_scrub` · `zippy_bump` · `zippy_flip_clatter` · `zippy_servo_chirp` (steer) · `zippy_tow_strain` |

**Read at a glance.** Four fat black tyres, a bright orange wedge on top, a wobbling antenna ball. Pure toy.
**Notes / don'ts.** No real-brand liveries or numbers that copy a real RC brand. Keep the tow hook visible from the side. The tyres must touch the ground in the rest pose (validator checks the wheel bottoms at z −0.035).

Layout: wheel Ø 0.060 (1.3× real proportion), 22 mm wide, deep knobs · track 0.075, wheelbase 0.130 · shell top at z +0.045 with a raked windscreen and a roof flat for the port · antenna: 1.5 mm whip at (−0.060, 0.025, 0.015) rising to z +0.062 with an Ø 8 mm ignition ball tip · rear: open frame showing the motor can, copper windings and the volt spur gear.

---

### QUACK: Floating, squeaking rubber duck
`quack` · Fun · Class S · Ship M4 · Inspired by (internal only): none

**Concept.** A glossy vinyl duck with a low, weighted belly, so it always bobs upright on Matter water. Squeeze it, land on it or bonk it and it squeaks and squashes. It's the most innocent object in a world of explosives, and that contrast is the joke.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.082 × 0.093 × 0.114 m (1 × 1 × 1; base to head top, beak tip to body back, per the layout below) · beak faces −Y · origin: centre of mass, 0.028 m above the base (base at z −0.028) |
| Mass · physics | 0.04 kg · hollow, `phys = rubber` · restitution 0.55, friction 0.7 · buoyancy volume from the hull (≈ 2.5 × 10⁻⁴ m³, so 0.04 kg floats ≈ 0.012 m deep, about a quarter of the body height) |
| Collision | `COL__hull__0` body (48 verts) · `COL__sphere__1` head r 0.025 at (0, −0.020, 0.040) |
| Materials (60/30/10) | neutral: `kn_latex_bone` eye whites and underside "keel" mark · signature: `kn_latex_amber` body (the colour is the duck's identity; Fun-family latitude) · accent: `kn_latex_ignition` beak, eyes (`kn_powder_graphite` pupils with a modelled catchlight) |
| Ports | none (Fluid by buoyancy) |
| Pivots | none |
| Sensors | `SENSOR__pressure__squeeze` · threshold 0.06 N·s impact or 0.3 kg sustained load · whole-body hull, slightly inset |
| Emitters | `EMIT__squeak__hole` (0, 0.010, −0.028) +X → −Z: squeak audio + a tiny air puff (bubbles when underwater) · `EMIT__splash__base` (0, 0, −0.028): small splash crown on water landing |
| LEDs / screens | none |
| States | resting · floating (gentle bob from the water surface) · squeezed (shape key + squeak) |
| Animation | shape key `sk_squash` 0–1: body −15 % height, +8 % width, head tips back 6°. The engine drives it from the squeeze impulse (0.12 s in, 0.25 s spring back) |
| Fracture | none (indestructible; blasts send it flying) |
| Skins / variants | amber (default) · plasma "party duck" · bone "ghost duck" · cobalt "deep sea" |
| Budget | LOD0 ≈ 2,200 tris · 1024² |
| Audio hooks | `quack_squeak` (3 intensities × 4; pitch up on short squeezes) · `quack_splash` · `quack_bob_drip` · `quack_bounce` (rubber thud) |

**Read at a glance.** Round amber body, round head, orange beak, upturned tail: the universal duck, chunkier than usual.
**Notes / don'ts.** The squeak is cosmetic audio only: QUACK is Fluid-channel, so it does **not** emit a Sound event or startle critters. Keep the COM low so it self-rights on water. No sailor hats or licensed-character faces.

Layout (relative to origin): body ovoid 0.082 W × 0.098 L × 0.052 H centred (0, 0.002, −0.002), flat-bottomed · head Ø 0.050 at (0, −0.020, 0.040) · beak 0.022 long × 0.030 wide, flattened, centre (0, −0.052, 0.034) · tail flick at (0, 0.047, 0.012) curling up · eyes Ø 0.012 at (±0.018, −0.040, 0.050).
