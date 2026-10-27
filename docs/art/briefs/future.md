# Future Tech briefs

The "newer product line": spawners, sinks, portals and field devices from GAME_SPEC §12.10.

Back to the index: [README.md](./README.md)

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| FABRICATOR | `fabricator` | L | M3 | brief |
| RECYCLER | `recycler` | M | M3 | brief |
| RIFT GATES | `rift_gate` | L | M5 | brief |
| GRAV WELL | `grav_well` | M | M5 | brief |
| TRACTOR BEAM | `tractor_beam` | M | M5 | brief |
| HOVER PAD | `hover_pad` | M | M5 | brief |
| FORCE WALL | `force_wall` | M | M5 | brief |
| COILGUN RING | `coilgun_ring` | M | M5 | brief |
| STASIS FIELD | `stasis_field` | M | M5 | brief |
| ZONE | `zone` | proc | M3 | brief |

**Family block.**
- **BUZZ BEACON** (GAME_SPEC §12.10, `buzz_beacon`, 2 × 0.4 × 2 cells, Class S, M5) is briefed with Buzz in [critters.md](critters.md) and tracked in that file's status table.
- **Power draw** on each `PORT__power__in` line is the rated demand from SIMULATION §5.5.
- **Multiplayer readability.** Plasma `#FF3DAE` is Player 2's colour and Beam `#2FD6FF` is Player 1's (MULTIPLAYER §8.1). Solid outlines and smooth translucent ghosts in those colours mean "a player". Plasma *hardware* (anodised trims, poly windows, LEDs) stays as briefed. But every engine-drawn overlay on this page follows the vfx.md §0.4 pattern rule: Build-mode dashed outlines and fills, range shells, Rift pairing arcs, Zone edges, and the Run-mode Force Wall and Stasis volumes. These overlays are always drawn as a pattern (hex lattice, dashes, scanlines), never as a solid uniform outline. In a 2-player session, Build-mode overlays that would be Plasma or Beam switch to dashed `#EEF1F6` plus their glyph, matching the zero-g ring rule in environments.md. That covers antigrav and stasis Zones and plasma or beam Rift pairs. Run-mode Field lattices keep the Field colour, because they're patterns.

---

### FABRICATOR: Part spawner with a preview window and countdown
`fabricator` · Future Tech · Class L · Ship M3 · Inspired by (internal only): none

**Concept.** A smooth graphite cube, like a premium desktop 3D printer from next year's catalogue. Through a Plasma-tinted window you see a hologram of the chosen part turning on a tiny turntable. Below it, a counter shows how many are left and a mouth at the bottom pops the next one out. It should feel generous and magical: plasma light swells, the flap kicks open, the part arrives.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.30 × 0.30 m (3 × 3 × 3) · origin: bottom centre |
| Mass · physics | 9 kg · static (placed device) · `phys = powder` |
| Collision | `COL__box__0` upper body 0.30 × 0.30 × 0.155 (z 0.145–0.300) · `COL__box__1` / `COL__box__2` mouth cheeks, x ±(0.070–0.150), z 0.016–0.145 · `COL__box__3` back block behind the mouth tunnel (y −0.05 to 0.15) · `COL__box__4` mouth floor ramp (top z 0.035, 8° down to front) · `COL__box__5` plinth 0.28 × 0.28 × 0.016 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` shell (seamless, 15 mm pillow radius) · signature: `kn_anod_plasma` mouth bezel, window bezel and top vent trims + `kn_poly_plasma` window and mouth flap · accent: screens, LEDs, `kn_rubber` feet. Fasteners: 2 flush M5 on the rear service panel only |
| Ports | `PORT__signal__spawn` · in · PR-L · (−0.105, −0.150, 0.090) · facing −Y (front face, left of the mouth) |
| Pivots | `PIVOT__mouth_flap` · axis x, hinge at (0, −0.148, 0.145) · 0–75° · smoked plasma flap (0.135 × 0.105 × 0.006) kicks outward on each spawn · `PIVOT__preview` · axis z at (0, −0.090, 0.197) · continuous 20°/s (faster while printing) · turntable disc Ø 0.080 in `kn_anod_graphite` with a plasma LED rim |
| Sensors | `SENSOR__trigger__mouth_clear` · box 0.14 × 0.11 × 0.11 in front of the mouth (y −0.15 to −0.26, z 0.035–0.145) · occupied by a resting body for > 0.5 s = jammed |
| Emitters | `EMIT__spawn__mouth` (0, −0.110, 0.070) +X → −Y: spawn point and launch direction (initial speed is a property) · `EMIT__warp__front` (0, −0.150, 0.150) +X → −Y: anchor for parts too large for the mouth (> 0.10 m on any axis; the opening clears 0.14 × 0.11 and the tunnel is 0.10 deep), which voxel-build in front of the face · `EMIT__puff__mouth` (0, −0.155, 0.090): plasma sparkle + soft puff · `EMIT__print__chamber` (0, −0.090, 0.210): rising plasma motes behind the window · `EMIT__preview__turntable` (0, −0.090, 0.200): bottom centre of a 0.075 m fit cube (top at z 0.275, inside the window opening z 0.1925–0.2775); the engine places the chosen part's LOD2 here, scaled to fit, drawn as a plasma-tinted hologram |
| LEDs / screens | `SCREEN__count` kind `7seg`, 3 digits, color `plasma`, 0.066 × 0.024 m at (0.055, −0.151, 0.165): remaining count (always finite, 1–999, per GAME_SPEC §12.10) · `SCREEN__interval` kind `bar`, 10 cells, color `plasma`, 0.070 × 0.008 m at (−0.055, −0.151, 0.165): time to next spawn · LED group 0 `status` (dome Ø 8 mm at (0.105, −0.151, 0.125)) · group 1 `print_glow` (3 top vent slots 0.18 × 0.008 at y −0.04 / 0 / +0.04) · group 2 `mouth_rim` (light bar inside the mouth bezel) |
| States | idle (preview turns, count shown, vents 25 %) · charging (interval bar fills, vents breathe) · spawning (vents and rim 100 %, flap kicks, puff, count −1) · empty (count "000" blinks amber, preview hologram greys, vents off) · jammed (port fault blink, amber spark puff at the mouth) |
| Animation | procedural pivots + 1 clip `fabricator__spawn_kick` (0.4 s: flap kick and a shell "hiccup" squash of 1 % via `sk_hiccup`) |
| Fracture | none |
| Skins / variants | graphite + plasma (default) · bone + plasma "lab white" (`kn_powder_bone` shell) |
| Budget | LOD0 ≈ 18,000 tris · 2048² + 1024² detail (window bezel, mouth) |
| Audio hooks | `fab_idle_hum` · `fab_charge` (riser synced to the interval bar) · `fab_print` (servo whirr + voxel chirps, 0.4 s) · `fab_spawn_pop` (pitch by spawned mass) · `fab_flap` · `fab_empty` (descending 3-note) · `fab_jam` (buzz + clunk) |

**Read at a glance.** Dark rounded cube, glowing pink window with a tiny turning part, a lit mouth at the bottom. "Things come out of this."
**Notes / don'ts.** Front-face layout (y = −0.150): mouth opening 0.14 W × 0.11 H (x ±0.07, z 0.035–0.145, tunnel 0.10 deep) · window 0.150 × 0.085 centred (0, −0.150, 0.235) in a 6 mm bezel · counter strip at z 0.165 between them · port in the left cheek, status LED and "FABRICATOR" name plate in the right cheek (0.105, −0.151, 0.070). Plinth 0.28 × 0.28 × 0.012 inset 10 mm, on 4 rubber feet Ø 0.020 × 0.004 at (±0.12, ±0.12, 0). Top: 3 vent slots, nothing else. The hologram must never look like a real object inside (always plasma-tinted, 70 % opacity) so players don't think it's spawnable loot. Draw it, and the `EMIT__warp__front` voxel build, as plasma scanlines or voxels (a pattern, never a smooth translucent fill) so it can't read as Player 2's ghost preview (family block). No visible screws on the front, top or sides.

---

### RECYCLER: Despawning sink with a count screen
`recycler` · Future Tech · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A low graphite bin with a Plasma funnel and a dark, swirling core: whatever drops in dissolves into plasma voxels and the counter ticks up. When it reaches its goal it fires a Signal. Think of a sleek kitchen compost caddy from the future. Satisfying, never scary.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.30 m (3 × 2 × 3) · origin: bottom centre |
| Mass · physics | 6 kg · static · `phys = powder` (funnel `phys = steel`) |
| Collision | `COL__mesh__0` funnel and top rim (static, ~600 tris) · `COL__box__1` body below the core (z 0–0.12) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` body (12 mm pillow) · signature: `kn_anod_plasma` funnel walls · accent: core disc, screens, rim LED, `kn_anod_graphite` iris blades, `kn_rubber` feet |
| Ports | `PORT__signal__count` · out · PR-M · (−0.095, −0.150, 0.100) · facing −Y |
| Pivots | `PIVOT__iris` · axis z at (0, 0, 0.125) · 0–25° · 6 iris blades around the core snap shut and open on each swallow ("gulp") |
| Sensors | `SENSOR__intake__mouth` · convex box 0.22 × 0.22 × 0.13 (z 0.130–0.260: the funnel plus 0.06 above the rim) · any body whose centre of mass enters is despawned, **except critters** (refused, see Notes). The box reaches above the rim so that a ball too big to drop down the funnel still counts once it settles in the mouth. Boing (Ø 0.24) settles with its centre at z ≈ 0.25 and Thud at z ≈ 0.24; a box that stopped at the rim would only take balls up to about Ø 0.15 |
| Emitters | `EMIT__dissolve__core` (0, 0, 0.120) +X → +Z: plasma voxel dissolve + sparkle column · `EMIT__refuse__core` (same point): comic "boing" puff that pops a critter back out onto the rim · `EMIT__vent__rear` (0, 0.151, 0.050) +X → +Y: soft exhaust shimmer |
| LEDs / screens | `SCREEN__count` kind `7seg`, 3 digits, color `plasma`, 0.080 × 0.030 m at (0.020, −0.151, 0.105) · `SCREEN__target` kind `7seg`, 3 digits, color `signal`, 0.042 × 0.016 m at (0.105, −0.151, 0.105) (decal captions "IN" / "GOAL" under each) · `SCREEN__core` disc Ø 0.10 at z 0.120: `kn_screen` kind `icon`, an engine-animated plasma swirl · LED group 0 `rim` (light bar around the funnel lip, pulses per swallow) · group 1 `goal` (flashes 3× in signal colour when the target is reached) |
| States | idle (core swirls slowly, rim 25 %) · swallowing (iris gulp, dissolve column, rim pulse, count +1) · goal reached (count blinks, goal LEDs, port flows) · refusing (critter pops out, "nope" puff) |
| Animation | procedural pivot only |
| Fracture | none |
| Skins / variants | graphite + plasma (default) · bone + plasma "lab white" |
| Budget | LOD0 ≈ 7,500 tris · 2048² |
| Audio hooks | `recycler_hum` · `recycler_gulp` (3 size tiers) · `recycler_tick` (count) · `recycler_goal` (chime) · `recycler_refuse` (boing + giggle-puff) · `recycler_iris_snap` |

**Read at a glance.** Wide dark tub, pink funnel, a swirling dark core and a big number on the front.
**Notes / don'ts.** Funnel: 0.22 × 0.22 opening (40 mm corner radius) at z 0.200, sloping to the Ø 0.10 core at z 0.120. Inspector modes: signal once at the target, or every N. **Critters are never despawned** (ART_BIBLE §8): Mochi, Pip, Goby, Bandit, Biscuit, Henny, Dusty and Buzz all trigger the refuse pop. Fluid and grains entering the funnel drain into the core (counted as 1 per 1,000 grains). No trash-can or shredder imagery, no teeth or blades in the iris.

---

### RIFT GATES: Paired single-sided portal frames
`rift_gate` · Future Tech · Class L · Ship M5 · Inspired by (internal only): none

**Concept.** A slim upright ring with a shimmering membrane. Roll a ball into one and it shoots out of its twin with the same momentum. Pairs are colour-coded by their LED ring. The frame is calm, precise hardware; all the drama is in the membrane and the transit flash.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.39 × 0.40 × 0.05 m per gate (4 × 4 × 0.5) · origin: bottom centre · active face = front (−Y) |
| Mass · physics | 4.5 kg · static · `phys = powder` |
| Collision | `COL__box__0..7` ring approximated by 8 segments around the aperture (each 0.155 × 0.050 × 0.040, centred on the ring's r 0.175 midline) · `COL__box__8` plinth 0.20 × 0.05 × 0.025 · `COL__cylinder__9` closed backplate Ø 0.31 × 0.006 at y +0.022 (back side is solid: bodies bounce off) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` ring frame and backplate · signature: `kn_anod_plasma` inner lip bevel and the counter-rotating trim ring · accent: pair LED segments, membrane, `kn_rubber` feet |
| Ports | none (Impact only; pairing is a property) |
| Pivots | `PIVOT__trim_ring` · axis y at (0, −0.010, 0.205) · continuous (thin plasma ring inside the lip turns 30°/s idle, 360°/s on transit) |
| Sensors | `SENSOR__trigger__aperture` · cylinder Ø 0.30 × 0.02 along Y at (0, −0.015, 0.205) · a body's centre crossing it transits (max 1 transit per 0.25 s per gate pair, SIMULATION §5.12) |
| Emitters | `EMIT__exit__aperture` (0, −0.030, 0.205) +X → −Y: exit point and frame for the re-emitted momentum · `EMIT__warp__rim` (same point): ring-shaped sparkle burst + a short lens-ripple on transit · `EMIT__hum__core` (0, 0, 0.205) |
| LEDs / screens | `SCREEN__membrane`: disc Ø 0.31 at y −0.004, `kn_screen` kind `icon` (engine plays an animated swirl; on the 12 GB and 16 GB tiers (High/Ultra) the engine may swap in a live view through the partner gate) · LED group 0 `pair_ring`: 16 segments on the ring front face, pair colour, chase pulse · group 1 `cooldown`: the same segments dim to 30 % during the 0.25 s cooldown · rear decal: name plate "RIFT GATE" + pair glyph |
| States | unpaired (membrane grey and still, ring 8 %) · paired idle (swirl, chase) · transit (ripple ring across both membranes + sparkles, ring spins up; no flash, per vfx.md §7.2) · cooldown (dimmed, 0.25 s, shared by both gates of the pair) · overflow (bodies arriving during the cooldown bounce off the membrane with a "bonk" ripple) |
| Animation | procedural pivot only |
| Fracture | none |
| Skins / variants | pair colours (property, one per pair): plasma, beam, amber, volt, cobalt, ignition. Build mode draws a dashed arc in the pair colour between partners. In a 2-player session, plasma and beam pairs draw their LED ring and arc as dashed `#EEF1F6` + pair glyph (family block) |
| Budget | LOD0 ≈ 12,000 tris · 2048² + 1024² detail |
| Audio hooks | `rift_hum` (pair-locked stereo loop) · `rift_in` (whoosh-suck at the entry gate) · `rift_out` (pop-whoosh at the exit gate, velocity-scaled) · `rift_cooldown_tick` · `rift_bonk` (overflow) |

**Read at a glance.** A dark ring on a little foot, filled with a pink swirl, ringed with coloured lights. Two of them, the same colour.
**Notes / don'ts.** Ring: outer Ø 0.39 centred at z 0.205 (bottom at z 0.010, top at 0.400), radial section 0.040 × 0.050, aperture Ø 0.31. The plinth 0.20 W × 0.025 H cradles the ring bottom, on 4 rubber feet. Backplate 6 mm, set into the rear lip. A chevron notch at the ring top marks the front. Single-sided by design: the back is a closed graphite disc so the active side is never ambiguous. The Ø 0.31 aperture passes **every Roller**: Thud (Ø 0.22), Boing (Ø 0.24), Helio (Ø 0.25 body, 0.30 with knot and clip), Pig Iron, Stitch, Fuzz, Yolk and Glint/Bearing. It also passes the animal critters (collision capsules ≤ Ø 0.22: Pip, Goby, Mochi, Bandit, Henny, Biscuit). Dusty (Ø 0.366) and Buzz (0.34 span) are too big and bounce off the frame. Critters transit like any body and arrive with dizzy stars if fast (no harm).

---

### GRAV WELL: Levitating-orb attractor/repulsor
`grav_well` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** A polished graphite orb floats above a three-armed cradle, spinning, with a glowing plasma seam at its equator. Power it and the orb rises and the room bends toward it (attract) or away (repel). Cut the power and the orb drops back into its cradle with a satisfying clack.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.18 × 0.20 m (2 × 2 × 2) · origin: bottom centre |
| Mass · physics | 3 kg · static · `phys = powder` (orb `phys = steel`) |
| Collision | `COL__box__0` plinth 0.20 × 0.20 × 0.05 · `COL__capsule__1..3` cradle arms · `COL__sphere__4` orb r 0.045 (follows `PIVOT__orb_lift`) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth and arms · signature: `kn_powder_plasma` orb polar caps + `kn_anod_plasma` arm tips · accent: `kn_anod_graphite` polished orb body, seam LED, `kn_rubber` feet |
| Ports | `PORT__power__in` · in · PR-M · (0.055, −0.100, 0.025) · facing −Y · draws 250 W (field strength scales with the supply factor) |
| Pivots | `PIVOT__orb_lift` · axis z, translate · 0 (resting, orb centre z 0.115) to 0.020 m (powered, z 0.135) · `PIVOT__orb_spin` (child of lift) · axis z · continuous, speed ∝ field strength, with a procedural ±0.004 m bob |
| Sensors | none authored (the engine builds the field volume: radius 5 m, `F = s · m / max(r, 0.2)²`, SIMULATION §5.12) |
| Emitters | `EMIT__field__orb` (0, 0, 0.135) +X → +Z: field VFX (attract: plasma motes stream inward along curved paths; repel: outward shells) + a subtle lensing shimmer within 0.3 m · `EMIT__arc__tip_a/b/c` at the 3 arm tips: crackles to the orb during spin-up |
| LEDs / screens | LED group 0 `seam` (4 mm equator band on the orb) · group 1 `tips` (Ø 8 mm domes on the 3 arm tips) · group 2 `mode_ring` (light ring on the plinth top, chases inward = attract, outward = repel) |
| States | unpowered (orb resting in the cradle, LEDs 8 %) · spin-up (0.6 s: orb lifts, arcs, seam ramps) · attract · repel · underpowered (orb wobbles, mode ring amber, port fault blink) |
| Animation | procedural pivots only |
| Fracture | none |
| Skins / variants | graphite + plasma (default) · bone plinth "lab white" |
| Budget | LOD0 ≈ 6,500 tris · 2048² |
| Audio hooks | `grav_spinup` · `grav_loop` (sub-bass hum; attract wobbles down, repel shimmers up; pitch ∝ strength) · `grav_drop_clack` (orb lands in the cradle) · `grav_underpower` (stutter) · `grav_capture_whoomp` (body pulled into the core region) |

**Read at a glance.** A floating dark ball with a pink belt over three claws. It looks like it's thinking about gravity.
**Notes / don'ts.** Plinth 0.20 × 0.05 × 0.20 rounded square (12 mm pillow) on 4 rubber feet. Arms at 90° (rear), 210° and 330° so none blocks the front view. Each is a curved graphite fin rooted at r 0.075 on the plinth top, curling to tips at r 0.035, z 0.085 that cradle the Ø 0.09 orb. Name plate decal at (−0.050, −0.101, 0.025). Build mode: the range sphere is a dashed plasma shell with latitude lines; arrows on it point in or out. Never make the orb look like a bomb (no fuse, no rivets).

---

### TRACTOR BEAM: Pull-and-hold beam projector
`tractor_beam` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** A sleek graphite barrel with a Plasma emitter dish of concentric light rings. It throws a soft volumetric beam that reels objects in or holds them floating at a set distance. It should feel like a sci-fi prop that has been turned into a desk gadget: smooth, confident, a little smug.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.30 m (1 × 1 × 3) · origin: bottom centre · beam fires toward −Y |
| Mass · physics | 2 kg · static · `phys = powder` |
| Collision | `COL__box__0` barrel 0.09 × 0.29 × 0.08 at z 0.06 · `COL__box__1` / `COL__box__2` saddles 0.09 × 0.03 × 0.02 at y −0.08 / +0.08 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` barrel (rounded-square section, 12 mm pillow) and saddles · signature: `kn_anod_plasma` emitter dish + `kn_poly_plasma` lens dome · accent: LED rings, mode LEDs, `kn_rubber` feet |
| Ports | `PORT__power__in` · in · PR-M · (0, 0.070, 0.100) · facing +Z (top flat; visible from any elevated view) · draws 180 W |
| Pivots | `PIVOT__dish_spin` · axis y at (0, −0.145, 0.060) · continuous (dish rings rotate slowly; speed ∝ load) |
| Sensors | none authored (the beam volume and range are properties: 0.5–3 m). Two modes (SIMULATION §5.12): pull (reels bodies toward the lens at 0.5 m/s) and hold (a spring holds the body at a point 0.5–3 m along the beam, default 0.5 m) |
| Emitters | `EMIT__beam__lens` (0, −0.155, 0.060) +X → −Y: volumetric beam origin · `EMIT__hold__focus` (0, −0.655, 0.060): default hold point, 0.50 m from the lens, the shortest beam range (the engine slides it along the beam to the inspector's hold distance, 0.5–3 m) |
| LEDs / screens | LED group 0 `lens_rings` (3 concentric rings on the dish, Ø 0.030 / 0.050 / 0.070) · group 1 `mode` (2 domes on the top at y −0.02 / −0.05: pull / hold) · group 2 `load` (4-segment light bar on the right flank at y 0.02, fills with held mass) |
| States | off (rings 8 %) · pull (beam on, beam rings travel toward the dish per vfx.md §7.4; bodies are reeled in at 0.5 m/s, SIMULATION §5.12) · hold (rings stand still and pulse; the captured body hangs on its spring at the hold point and bobs ±0.01 m with a plasma rim) · strain (load near max: beam flickers, load bar amber) |
| Animation | procedural pivot only |
| Fracture | none |
| Skins / variants | graphite + plasma (default) · bone barrel "lab white" |
| Budget | LOD0 ≈ 5,500 tris · 2048² |
| Audio hooks | `tractor_on` · `tractor_loop` (warble, depth ∝ load) · `tractor_capture` (bloop) · `tractor_release` (soft drop) · `tractor_strain` |

**Read at a glance.** A dark torpedo on two saddles with a glowing ringed dish at the front: a mini satellite dish crossed with a flashlight.
**Notes / don'ts.** Barrel section 0.09 W × 0.08 H, from y −0.150 (dish face) to +0.120, plus a 0.02 rear cap with 3 cooling slots. Barrel centre z 0.060 on two graphite saddles (z 0–0.020) with rubber feet. Beam look (engine): vfx.md `fx/tractor_beam`, a cone Ø 0.12 at the lens widening to Ø 0.18 at 3 m, with Field-colour edges and travelling ring bands. It reads clearly in Run and never hides what it holds. No weapon cues: no barrel bore, no trigger, no sight.

---

### HOVER PAD: Field-levitated platform
`hover_pad` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** A thin graphite deck with a rubber grip top. Power it and it lifts 0.5 m off its base point and hangs there, held up by four plasma thruster discs underneath, carrying whatever you load on it. Cut the power and it drops like a stone, with everything on it. The underside glow and the floor shimmer sell that it's floating.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.05 × 0.30 m (3 × 0.5 × 3) · origin: bottom centre (bottom of the thruster discs) |
| Mass · physics | 2.5 kg · dynamic levitating platform (SIMULATION §5.12): while powered, rotation is locked and a stiff vertical spring-damper holds it 0.5 m above its base (the point where it was placed), with sag ≤ 0.01 m at the 10 kg payload limit (property); bodies on the deck ride it, so it carries loads · rotation unlocks and it falls when unpowered · deck `phys = powder`, top `phys = rubber` |
| Collision | `COL__box__0` slab 0.30 × 0.30 × 0.040 (z 0.006–0.046) · `COL__box__1` grip top 0.26 × 0.26 × 0.005 (z 0.045–0.050) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` slab (10 mm pillow) + `kn_rubber_grip` top inlay · signature: `kn_anod_plasma` thruster discs and edge trim · accent: thruster rings, edge strip, load screen |
| Ports | `PORT__power__in` · in · PR-S (the 40 mm edge cannot hold a PR-M) · (0.100, −0.150, 0.026) · facing −Y · draws 120 W. The power cable dangles from it (engine-drawn) |
| Pivots | none (the whole body moves; light pulses come from the LEDs) |
| Sensors | `SENSOR__pressure__deck` · box 0.26 × 0.26 × 0.02 above the grip (z 0.050–0.070) · threshold 0.05 kg · drives the load screen and thruster intensity |
| Emitters | `EMIT__field__thruster_fl/fr/bl/br` at (±0.090, ±0.090, 0) +X → −Z: downward heat-haze shimmer cones + a floor dust ring when within 0.6 m of a surface (so it shows at the 0.5 m hover height) · `EMIT__spark__edge` (0, −0.150, 0.026): spark spit on power loss |
| LEDs / screens | LED group 0 `edge_strip` (4 mm strip around the slab edge at z 0.020; breaks around the port and the load screen) · group 1 `thrusters` (rings on the 4 discs, intensity ∝ load) · `SCREEN__load` kind `bar`, 6 cells, color `plasma`, 0.060 × 0.010 m at (−0.080, −0.151, 0.026) |
| States | rising (power on: the spring-damper lifts it to 0.5 m above its base) · hovering (0.5 m above its base, thrusters 60 %, floor shimmer) · loaded (thrusters ∝ load, slight sag of 0.01 m at max) · overload (sinks slowly, edge strip amber) · unpowered (all LEDs off, falls) |
| Animation | none on the mesh |
| Fracture | none |
| Skins / variants | graphite + plasma (default) · bone deck "lab white" |
| Budget | LOD0 ≈ 4,500 tris · 2048² |
| Audio hooks | `hover_hum` (pitch ∝ load) · `hover_powerdown` (whine-drop) · `hover_land_clunk` · `hover_overload_warble` · `hover_thruster_flutter` |

**Read at a glance.** A floating dark tile with a pink glow underneath and a light line around its edge.
**Notes / don'ts.** Thruster discs Ø 0.070 × 0.006 at (±0.09, ±0.09), z 0–0.006, each with a plasma ring and a dark centre grille. The grip inlay is inset 20 mm from the edge with a 2 mm chamfer. The underside is the hero view in this asset; model it as carefully as the top. No visible flames or exhaust (it's a field, not a rocket).

---

### FORCE WALL: Signal-toggled energy barrier between two pylons
`force_wall` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** Two slim graphite pylons project a hex-cell plasma barrier between them. Hit it and it ripples; toggle it with a Signal and it zips up or down like a curtain of light. The pylons are the only physical hardware; the wall itself is engine-drawn and resizable from 0.1 to 1 m on each side.

| Spec | Value |
|---|---|
| Size (W×H×D) | (0.1–1.0) × (0.1–1.0) × 0.05 m ((1–10) × (1–10) × 0.5) · origin: bottom centre · pylon centres at x = ±(W/2 − 0.020) |
| Mass · physics | 1.2 kg (pylon pair) · static · `phys = powder` · the field is a static engine box, 0.02 m thick, with engine-set friction 0.3 and restitution 0.6 so bodies bounce off softly (not an authored `phys` material) |
| Collision | per pylon (engine-instanced): `COL__box__0` base 0.040 × 0.050 × 0.040 · `COL__box__1` column 0.024 × 0.030 × (H − 0.055) · field: an engine-generated box spanning the column inner faces (W − 0.064 wide) from z 0.040 to H − 0.015, present only while ON |
| Materials (60/30/10) | neutral: `kn_powder_graphite` pylons · signature: plasma field (engine) + `kn_anod_plasma` cap trims · accent: emitter strips, cap LEDs, `kn_rubber` feet |
| Ports | `PORT__signal__toggle` · in · PR-S · on the left pylon base front at (−W/2 + 0.020, −0.025, 0.022) · facing −Y (the 28 mm ring fits the base's 40 × 36 mm front face: 32 × 28 mm flat inside the 4 mm pillow) |
| Pivots | none |
| Sensors | none authored (the field box is generated from W × H) |
| Emitters | `EMIT__field__left` / `EMIT__field__right` on the column inner faces at mid-height (engine re-places them with H): field origin and edge glow · `EMIT__ripple__contact` is spawned by the engine at each contact |
| LEDs / screens | LED group 0 `emitter_strips` (8 mm plasma strip on each column's inner face, full height) · group 1 `caps` (Ø 8 mm dome on each pylon cap) · no screens |
| States | (field look per vfx.md §7.6) **in Run, ON:** hex lattice plane (cell 0.02 m), Field colour at 15 % with brighter edges, emitter strips 100 %; each contact sends ripple rings from the contact point (2 m/s for 0.6 s, brightness ∝ impulse) and lights nearby cells to at most 80 % (comfort cap) · **in Run, OFF:** no plane, strips 8 % · **toggling:** ON, the lattice prints inward from the pylons in 0.25 s; OFF, it fades in 0.2 s with no flicker · **Build mode:** dashed plasma outline + 10 % hatched fill + an "ON at start / OFF at start" badge on the left cap; resize handles on the right cap (H) and both bases (W) |
| Animation | none (all engine-drawn) |
| Fracture | none |
| Skins / variants | plasma field (default) · beam field (for players separating wall sets; same hardware) |
| Budget | per pylon LOD0 ≈ 1,620 tris at H ≤ 0.155 (base 900 + one 0.1 m column segment 120 + cap 600), + 120 per extra segment (≈ 2,700 at H 1.0) · 1024² shared |
| Audio hooks | `wall_on` (rising zip) · `wall_off` (falling zip) · `wall_hum` (loop, gain ∝ area) · `wall_ripple` (soft "thoom", pitch by impulse) · `wall_critter_boing` |

**Read at a glance.** Two dark posts with pink light strips facing each other and a faint pink honeycomb between them.
**Notes / don'ts.** The pylon is a 3-piece kit: `force_wall__base` (0.040 W × 0.040 H × 0.050 D including 4 mm rubber feet, 4 mm pillow), `force_wall__column_seg` (0.024 × 0.030 section, centred on the pylon, 0.1 m tall, tiles seamlessly) and `force_wall__cap` (0.030 × 0.015 × 0.036, rounded, LED dome). Base + column + cap = H. The engine stacks segments to reach H − 0.055 and trims the top one. Column inner faces sit at x = ±(W/2 − 0.032), so at W = 0.1 the field is 0.036 m wide; that's the minimum. Critters bounce off with a "!" emote, never a shock or zap effect.

---

### COILGUN RING: Steel accelerator ring with visible coils
`coilgun_ring` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** An upright ring whose clear Plasma shell shows six copper coil packs inside. When a steel ball passes through the bore the coils fire in sequence, the LED chase whips around and the ball leaves much faster. It's the Future line's "show the mechanism" piece: you can see what does the work.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.285 × 0.30 × 0.10 m (⌀3, footprint 3 × 3 × 1) · origin: bottom centre · boost axis = Y through the bore |
| Mass · physics | 4 kg · static · `phys = powder` |
| Collision | `COL__box__0..7` ring segments around the bore (8 × 0.11 × 0.08 × 0.06) · `COL__box__8` plinth 0.16 × 0.10 × 0.05 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` front and back flanges (8 mm) + plinth · signature: `kn_poly_plasma` clear tube shell between the flanges + `kn_anod_plasma` bore liner · accent: `kn_copper` coil windings with `kn_steel_brushed` cores (inside the shell), LED chase, charge bar |
| Ports | `PORT__power__in` · in · PR-M · (0.050, −0.050, 0.025) · facing −Y (plinth front) · draws 300 W |
| Pivots | none |
| Sensors | `SENSOR__trigger__bore` · cylinder Ø 0.15 × 0.10 along Y at z 0.1575 · boosts magnetic bodies only (Pig Iron, Bearings, steel parts) by Δv = +3 m/s along the axis, once per pass (SIMULATION §5.12); others pass through untouched |
| Emitters | `EMIT__boost__exit` (0, −0.050, 0.1575) +X → boost direction (flips with the direction property): magnetic ripple ring + exit flash · `EMIT__arc__coils` (6 points on the coil packs): crawling arcs during a fire |
| LEDs / screens | LED group 0 `bore_chase` (12 segments on the front flange inner edge; chase direction = boost direction) · `SCREEN__charge` kind `bar`, 8 cells, color `power`, 0.070 × 0.010 m at (−0.045, −0.0505, 0.025) · decal chevrons on the flange top show direction |
| States | unpowered (LEDs 8 %) · charging (bar fills, rising whine; recharge 0.5 s) · armed (slow idle chase) · firing (coils glow, arcs, chase whips through 360° in 0.1 s, flash) · underpowered (bar stalls amber) |
| Animation | none (LEDs and emitters only) |
| Fracture | none |
| Skins / variants | plasma shell (default) · beam shell (`kn_poly_beam`, for lab-blue builds) |
| Budget | LOD0 ≈ 9,500 tris (coils 6 × 800) · 2048² · LOD2 shows coils as copper blocks, LOD3 shell opaque |
| Audio hooks | `coil_charge` (rising whine) · `coil_ready` (ping) · `coil_fire` (deep thunk + electric snap, pitch by Δv) · `coil_idle_hum` · `coil_pass_dud` (non-steel object passes: soft whoosh) |

**Read at a glance.** A dark-framed hoop with a glowing pink see-through belly full of copper, on a little stand.
**Notes / don'ts.** Ring outer Ø 0.285 centred at z 0.1575, bore Ø 0.16 (fits Pig Iron Ø 0.12 with margin), depth 0.08 (y ±0.04). The plinth 0.16 W × 0.05 H × 0.10 D cradles the ring bottom, on 4 rubber feet. Coil packs sit at 60° steps inside the shell. Keep only 2 transparent layers in any sight line (shell front and back), so no inner clear parts. No barrel or gun cues: it's a ring, never a tube.

---

### STASIS FIELD: Powered freeze volume framed by corner nodes
`stasis_field` · Future Tech · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** Four squat corner nodes, linked by low floor rails, frame a box of space. Power it and everything inside freezes mid-motion under a faint frosted-plasma haze: a ball mid-bounce, sparks mid-flight. The hardware just marks the corners; the volume is engine-drawn and resizable from 0.1 to 1 m on each side.

| Spec | Value |
|---|---|
| Size (W×H×D) | (0.1–1.0)³ m ((1–10)³ cells) · origin: bottom centre of the volume · nodes sit inside the 4 bottom corners |
| Mass · physics | 1.6 kg (hardware) · static · `phys = powder` |
| Collision | per node: `COL__box__0` 0.04 × 0.04 × 0.06 (engine-instanced at the corners) · rails are non-colliding trim · the volume is an engine sensor, not a collider |
| Materials (60/30/10) | neutral: `kn_powder_graphite` nodes and rails · signature: `kn_poly_plasma` node lenses + `kn_anod_plasma` node caps · accent: rail LED dashes, node LEDs, `kn_rubber` feet |
| Ports | `PORT__power__in` · in · PR-S (the 40 mm node face cannot hold a PR-M) · on the front-left node front face, at (−W/2 + 0.020, −D/2, 0.030) · facing −Y · draws 220 W (needs supply factor ≥ 0.75 to engage) |
| Pivots | none |
| Sensors | none authored (the volume comes from the size property; `SENSOR__field__volume`, a 0.1 m reference cube, exists in the blockout only) |
| Emitters | `EMIT__field__node_fl/fr/bl/br` (the lens of each node, pointing up and inward at 45°): lattice sweep origin + a node flare on engage · `EMIT__freeze__volume` (centre): "time grain" motes that drift slowly unpowered and stop dead when engaged |
| LEDs / screens | LED group 0 `nodes` (Ø 8 mm dome on each node top) · group 1 `rail_dashes` (8 mm plasma dashes every 0.05 m along the rails) |
| States | (volume look per vfx.md §7.3) **in Run, powered:** the box drawn as a Field-colour hex lattice (12 % on faces, 60 % on edges, corner brackets; a pattern, never solid edge lines), motes frozen; bodies inside stop and get the "time-stopped" look (50 % desaturation, cool tint, Field rim); particles, flames and smoke inside freeze too · **in Run, unpowered:** no volume, nodes 8 % · **engage / release:** the lattice sweeps in from the nodes in 0.3 s / shatters outward into sparkles with a time-snap · **Build mode:** dashed plasma wireframe + 8 % fill + face handles + a "STASIS · powered" tag |
| Animation | none |
| Fracture | none |
| Skins / variants | plasma (default) · beam "cryo" tint |
| Budget | node LOD0 ≈ 1,500 tris · rail segment 0.1 m ≈ 60 tris · 1024² shared |
| Audio hooks | `stasis_engage` (reverse swell + glassy chime) · `stasis_loop` (low choral drone with a slowed clock tick) · `stasis_release` (time-snap whoosh) · `stasis_body_ting` (a body enters while engaged) |

**Read at a glance.** Four little dark posts on a thin glowing floor frame; when on, a ghostly pink box with frozen things inside.
**Notes / don'ts.** Node: 0.04 × 0.04 × 0.06 graphite post (4 mm pillow, so the front-left node's face keeps a 32 mm flat for the PR-S ring) on rubber feet, with an Ø 0.016 plasma lens on its inner top corner angled 45° up and in. Rails: 0.012 W × 0.008 H graphite strip (`stasis_field__rail_seg`, 0.1 m, tiling) linking the nodes along the bottom perimeter. The top corners have no hardware; their edges are drawn by the engine. Frozen critters keep a calm "?" expression, never a pained one.

---

### ZONE: Invisible-in-run gravity / antigrav / wind / stasis volume
`zone` · Future Tech · Class proc · Ship M3 · Inspired by (internal only): none

**Concept.** A designer's volume: always on, unpowered, and invisible during a run, so physics just behaves differently in there. The only physical hardware is four small corner stakes that show in Build and fade out on LET IT RIP. Everything else is engine-drawn and mode-coded with a glyph and a colour.

| Spec | Value |
|---|---|
| Size (W×H×D) | (0.1–10)³ m ((1–100)³ cells) · origin: bottom centre of the volume · stakes at the 4 bottom corners |
| Mass · physics | stakes: no mass, non-colliding (pure markers) · the volume is an engine field |
| Collision | none (stakes never collide, so a zone can never block a machine) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` stake body · signature: mode LED cap · accent: `kn_decal` mode glyph on the two outward faces |
| Ports | none (Field, always on) |
| Pivots | none |
| Sensors | none authored (the volume comes from the size property) |
| Emitters | `EMIT__glyph__stake` (stake top, +X → +Z): Build-mode glyph particles start here |
| LEDs / screens | LED group 0 `mode_cap` (Ø 10 mm dome on each stake): gravity `#3355FF`, antigrav `#FF3DAE`, wind `#9BE7D8` (air), stasis `#2FD6FF`. Antigrav and stasis share the player colours, so in a 2-player session their cap LEDs show `#EEF1F6` and their edges switch to `#EEF1F6` dashes with the glyph (family block) |
| States | **Build mode:** volume edges drawn as 2 px dashes in the mode colour, 6 % fill, drifting glyph particles (gravity: falling chevrons; antigrav: rising chevrons; wind: streaks along the wind vector; stasis: slow suspended dots), per-face resize handles, a tag "ZONE · ANTIGRAV −0.3 g" · **Run:** fully invisible; stakes fade out over 0.3 s (the world option "show zone stakes in Run" keeps them at 30 %) · **X-ray (Tab):** the volume reappears as in Build, at 50 % |
| Animation | none |
| Fracture | none |
| Skins / variants | modes: gravity, antigrav, wind, stasis (LED colour and glyph swap; one stake mesh) |
| Budget | stake LOD0 ≈ 400 tris · shared 1024² trim |
| Audio hooks | Build: `zone_place` · `zone_resize_tick` · `zone_mode_switch` · Run: wind mode only, `zone_wind_bed` (loop, gain ∝ strength × listener overlap); the other modes are silent by design |

**Read at a glance.** In Build: a coloured glass-box outline with drifting arrows. In Run: nothing; just weird physics.
**Notes / don'ts.** Stake: 0.03 × 0.03 × 0.05 graphite post, 4 mm pillow, glyph decals (down arrow, up arrow, wind streak, snowflake-clock) on its two outward faces (the engine rotates each corner stake so they face out of the volume). ZONE (stasis mode) differs from STASIS FIELD: a zone is invisible, unpowered and always on; the STASIS FIELD is visible hardware you switch with Power. Never draw zones in Photo mode or the Cascade Report card.
