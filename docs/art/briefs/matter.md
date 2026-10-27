# Matter: asset briefs

Sand, water, marble and slime parts that feed the GPU Matter layer (GAME_SPEC §12.8, §6.4). Family look: clear poly + Beam, showing the contents.

Back to the [brief index, conventions and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| GRIT HOPPER | `grit_hopper` | M | M4 | brief |
| HOURGLASS | `hourglass` | S | M4 | brief |
| TANK | `tank` | M | M4 | brief |
| SPRINKLE CAN | `sprinkle_can` | M | M4 | brief |
| WATERWHEEL | `waterwheel` | M | M4 | brief |
| SPONGE | `sponge` | S | M4 | brief |
| MARBLE HOPPER | `marble_hopper` | M | M4 | brief |
| GOO VAT | `goo_vat` | M | M5 | brief |

**Contents rendering (all containers).** Stored contents are a deterministic quantity, never baked fluid and never resident particles:
- **Cavity.** Each container ships a `CAVITY__<name>` mesh (ASSET_PIPELINE §3.10): closed, manifold, inset 3–4 mm from the inner wall, with custom properties `matter = sand|water|marble|goo` (the Matter material ids, SIMULATION §8.1) and `capacity`.
- **Fill pass.** The exporter bakes a 64-entry fill LUT (fill fraction by volume → level-plane height) into `.art.json → cavities` (ASSET_PIPELINE §3.10). The engine's container-fill pass clips the cavity with a **world-space level plane** (it stays level when the part tilts), using surface profile `flat`, `crater` (draining granular) or `pile` (receiving granular). It shades the result with the same Matter surface shader as the free contents.
- **Pass-through.** Within the pass-through zone at an outlet (≤ 0.03 m from the `EMIT__spout__*`), contents become real Matter particles. `SENSOR__intake__*` volumes absorb incoming particles back into the quantity, up to `capacity`.
- **Tier budget.** Emitted contents are live Matter particles and count toward the machine's grain total, which sets `requiredTier` (GAME_SPEC §15.2: 250k / 1M / 2M / 4M at 4 / 8 / 12 / 16 GB). A stored quantity costs nothing until it's emitted. Litres convert to particles with the SIMULATION §8 sizes: water 1 mL per particle (radius 6.2 mm), sand grain Ø 4 mm (≈ 18k grains per packed litre), marble Ø 16 mm (≈ 290 per packed litre). So a full TANK (15 L) emits 15k particles, a SPRINKLE CAN (2 L) or a saturated SPONGE (2 L) 2k.
- **LODs.** LOD2 shows the contents as a flat-coloured block at the current level. At LOD3 the shell goes opaque with a tinted level band. Fallback masters for thumbnails and impostors: sand `kn_paper_tan`, water `kn_poly_beam`, marbles `kn_glass`, slime `kn_slime`.

**Family colour rule.** Each part uses one neutral powder (graphite or bone) plus `kn_powder_beam` / `kn_anod_beam` as its signature. Windows and shells are `kn_poly_clear`, so the contents are the 10 % accent. No hazard stripes or hazard pictograms.

---

### GRIT HOPPER: Sand dispenser bin
`grit_hopper` · Matter · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A square clear bin on graphite legs, funnelling to a beam slide-gate. You watch the sand level crater and drop as a hissing stream pours out.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.40 × 0.30 m (3×4×3) · origin: bottom centre |
| Mass · physics | 4 kg dry · phys `powder` · static · capacity property 50k–1M grains (abstract: the ≈ 16 L cavity physically holds ≈ 290k Ø 4 mm grains, so the fill shows the fraction of the capacity) · emptying a full 1M hopper needs the 8 GB tier, and anything over 250k needs more than the 4 GB tier · rate property, default 20k grains/s (a 1M hopper empties in 50 s) |
| Collision | `COL__box__leg_1…4` (0.025 square at (±0.125, ±0.125), z 0.004–0.20) · `COL__mesh__bin` (static outer shell, ≤ 1.5k tris) · `COL__box__gate` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` legs, front brace and gate housing, `kn_rubber` feet, `kn_steel_brushed` M5 fasteners + top grille · signature: `kn_poly_clear` bin (0.28 × 0.28, z 0.20–0.385, 20 mm corner radius) and funnel (z 0.12–0.20 → Ø 0.05 neck), `kn_powder_beam` top rim collar (z 0.385–0.40) + funnel collar + gate slide · accent: sand contents, name plate on the brace |
| Ports | `PORT__signal__open` · in · PR-M · (0, −0.046, 0.11) · faces −Y (gate housing front, 0.09 × 0.06, z 0.08–0.14, tall enough for the PR-M's 52.5 mm land) · each pulse toggles the gate |
| Pivots | `PIVOT__gate` · x · 0 (closed) to 0.04 m (open) · 0.15 s |
| Sensors | `SENSOR__intake__top` box 0.26 × 0.26 × 0.03, z 0.37–0.40 (grains through the grille are absorbed) |
| Emitters | `EMIT__spout__outlet` (0, 0, 0.08), +X = −Z · Matter sand at the rate property · `EMIT__dust__outlet` same point · Spectacle dust puffs (`fx/sand_puff`) |
| LEDs / screens | `SCREEN__fill` · `SCR_BAR_10` (bar, 10 cells, quad 0.056 × 0.014) · beam · on the front brace (0, −0.126, 0.16) · group 0 `flowing` (dome on the gate housing top) |
| States | full (flat level at the top) · draining (crater profile, stream, bar counts down) · low (< 10 %: bar blinks amber) · empty (dust film on the walls via the engine residue overlay) · refilling (pile profile under the intake) |
| Animation | procedural gate only · contents via the fill pass (`CAVITY__sand`, `matter = sand`, profile `crater` while draining, `pile` while refilling) |
| Fracture | none |
| Skins / variants | `classic` · `desert` (bone legs instead of graphite) |
| Budget | LOD0 ≈ 7,500 tris · 2048² |
| Audio hooks | gate_open · gate_close · pour_loop (sand hiss, rate-scaled) · intake_patter · last_trickle · low_beep |

**Read at a glance.** A clear square funnel full of beige sand on four dark legs.
**Notes / don'ts.** Square bin vs MARBLE HOPPER's round globe: keep the silhouettes distinct. The outlet nozzle points straight down. Never model sand inside the bin.

---

### HOURGLASS: Sand timer
`hourglass` · Matter · Class S · Ship M4 · Inspired by (internal only): none

**Concept.** A classic two-bulb timer with bone caps and beam pillars. Sand pours visibly from top to bottom, and the timer fires a Signal when the top bulb empties. Flip it and it runs again.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.20 × 0.10 m (1×2×1) · origin: bottom centre (dynamic; engine computes COM) |
| Mass · physics | 0.5 kg · phys `powder` · restitution 0.2 · duration property 1–120 s (default 10 s) |
| Collision | `COL__box__cap_bottom` 0.10 × 0.10 × 0.022 · `COL__box__cap_top` (z 0.178–0.20) · `COL__hull__bulbs` (one 40-vert hull) |
| Materials (60/30/10) | neutral: `kn_powder_bone` caps (rounded squares, 18 mm thick), neck collar and port boss, `kn_rubber` feet (top cap too, so it stands either way up) · signature: `kn_anod_beam` pillars Ø 0.01 at r 0.044 (90°, 210°, 330°; at r 0.04 they cut 2.5 mm into the Ø 0.075 bulbs, and at r 0.044 they clear them by 1.5 mm and stay inside the 0.10 cap) + `kn_poly_clear` bulbs Ø 0.075 (z 0.022–0.10 and 0.10–0.178, neck Ø 0.008) · accent: sand contents, name plate on the top cap front |
| Ports | `PORT__signal__out` · out · PR-S · (0, −0.032, 0.10) · faces −Y (boss on the neck collar, which stays mid-height either way up) |
| Pivots | none |
| Sensors | none (time-driven) |
| Emitters | `EMIT__stream__neck` (0, 0, 0.10), +X = gravity · sparkle grains along the stream |
| LEDs / screens | none; the port ring flashes on the Signal |
| States | running (top level falls with a `crater` profile, bottom grows as a `pile`, stream visible) · paused (tilt 70°–110°: stream stops) · done (top empty, Signal pulse) · flipped (tilt > 110°: roles swap, the remaining time carries over) |
| Animation | two cavities in the fill pass (`CAVITY__top` / `CAVITY__bottom`, `matter = sand`) + `hourglass__stream` cylinder Ø 1.5 mm, length set by the engine to the pile surface, hidden when not flowing |
| Fracture | none |
| Skins / variants | `classic` · `night` (graphite caps instead of bone) |
| Budget | LOD0 ≤ 2,800 tris · 1024² |
| Audio hooks | flow_loop (very soft hiss) · done_chime ("tink") · flip_clunk · glass_clink |

**Read at a glance.** Two clear bulbs pinched at the waist between cream caps.
**Notes / don'ts.** The sand is an internal timer drawn by the fill pass. It isn't Matter grains, so it costs nothing on the Matter budget and stays deterministic. Keep both caps identical so it reads the same either way up.

---

### TANK: Water tank and valve
`tank` · Matter · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A tall clear cylinder of water strapped with beam bands on a graphite plinth, with a front valve and a fat beam handwheel. The water level drops visibly and a crisp stream pours from the spout.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.40 × 0.30 m (3×4×3) · origin: bottom centre |
| Mass · physics | 5 kg dry · phys `powder` · static · capacity 15 L (inner Ø 0.252 × 0.312 m ≈ 15.6 L; the inset cavity holds ≈ 14.3–15 L) · flow property 0.1–2 L/s (default 0.5; full to empty in 30 s) |
| Collision | `COL__cylinder__tank` r 0.13, z 0.054–0.40 · `COL__cylinder__plinth` r 0.14, z 0–0.054 · `COL__box__valve` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth (z 0.004–0.054), top cap with funnel intake Ø 0.12, valve body, `kn_rubber` feet, `kn_steel_brushed` strainer mesh + M5 strap fasteners · signature: `kn_poly_clear` tank Ø 0.26 (z 0.054–0.37, 4 mm wall), `kn_powder_beam` strap bands (z 0.12 and 0.29) and spout pipe Ø 0.03, `kn_anod_beam` handwheel Ø 0.06 · accent: water contents, name plate on the plinth |
| Ports | `PORT__signal__open` · in · PR-M · (0.04, −0.122, 0.029) · faces −Y (on a flat land milled across the plinth front at y −0.122, which is 0.137 wide on the r 0.14 plinth; at x 0.08 the ring fell off the flat) · each pulse toggles the valve |
| Pivots | `PIVOT__handwheel` · z · 0–270° · 0.3 s (on top of the valve at (0, −0.14, 0.10)) |
| Sensors | `SENSOR__intake__top` cylinder r 0.06, z 0.37–0.40 (absorbs Matter water; at capacity it stops absorbing and the water spills naturally) |
| Emitters | `EMIT__spout__valve` (0, −0.152, 0.065), +X = −Y tilted 15° down · Matter water at the flow property · `EMIT__drip__valve` same point · cosmetic drips for 2 s after closing |
| LEDs / screens | `SCREEN__level` · `SCR_BAR_10` (bar, 10 cells, quad 0.056 × 0.014; there is no 12-cell bezel) · fluid · (−0.035, −0.122, 0.029), on the same flat land · group 0 `valve_open` (dome beside the handwheel) |
| States | full · draining (level falls, vortex dimple over the outlet, stream) · low (< 10 %: bar blinks amber) · empty (droplet residue overlay on the walls) · filling (inflow ripple rings) |
| Animation | procedural handwheel · contents via the fill pass (`CAVITY__water`, `matter = water`, profile `flat` + engine ripples) |
| Fracture | none |
| Skins / variants | `classic` · `lab` (bone plinth and cap) |
| Budget | LOD0 ≈ 7,000 tris · 2048² |
| Audio hooks | valve_squeak · pour_loop (rate-scaled) · glug (below 25 %) · fill_trickle · empty_gurgle · low_beep |

**Read at a glance.** A clear column of blue-white water with beam bands and a wheel valve at the bottom.
**Notes / don'ts.** The tank shell is a single clear layer, so no inner sleeve (≤ 2 transparent layers including the water). The spout sits below the lowest band so the stream is never hidden.

---

### SPRINKLE CAN: Tipping watering can
`sprinkle_can` · Matter · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A clear watering can on a cream tilt cradle. Knock it past its detent and it tips to pour, sprinkling Matter water from a steel rose. The tilting water level shows you exactly when it will pour.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.20 m (3×2×2) · origin: bottom centre (cradle) · spout points +X |
| Mass · physics | 0.8 kg dry · phys `powder` · static cradle with a hinged can · capacity 2 L (fill mass adds to the can's inertia; empties in 8 s at the pour rate) |
| Collision | `COL__box__cradle` 0.16 × 0.18 × 0.02 · `COL__hull__body` and `COL__capsule__spout` (under `PIVOT__tilt`) |
| Materials (60/30/10) | neutral: `kn_powder_bone` cradle + yokes (y ±0.085, outer faces ±0.092, so the depth reaches the 0.18 m minimum), `kn_rubber` feet · signature: `kn_poly_clear` can body (oval-section tub 0.16 × 0.14 in plan, 0.13 tall, centre x −0.06 so x −0.14…0.02, z 0.025–0.145: ≈ 2.3 L gross, ≈ 2 L cavity), `kn_powder_beam` handle arch (top z 0.19), rim and spout tube Ø 0.02 · accent: `kn_steel_brushed` rose Ø 0.04 (7 holes) at (0.14, 0, 0.15), water contents, name plate on the cradle front |
| Ports | none (Impact tilts it) |
| Pivots | `PIVOT__tilt` · y at (−0.02, 0, 0.07) · 0° to +60° (positive dips the spout) · detent: past 20° it falls to the 60° pour stop and latches until Stop |
| Sensors | `SENSOR__impact__push` hull over the body back + handle · 0.3 N·s kicks it past the detent · `SENSOR__intake__fill` ellipse 0.06 × 0.05 at the top-rear fill opening |
| Emitters | `EMIT__spout__rose` (0.15, 0, 0.15), +X = spout axis · 7-jet spray, 25° cone, Matter water at 0.25 L/s while the level reaches the spout inlet in the tilted frame · `EMIT__drip__rose` · cosmetic |
| LEDs / screens | none (contents visible through the body) |
| States | full upright · tipping · pouring (spray arcs, level slides toward the spout) · empty (latched tilted, drips) · refilled (resumes pouring if still tilted) |
| Animation | procedural tilt · contents via the fill pass (`CAVITY__water`, `matter = water`) |
| Fracture | none |
| Skins / variants | `classic` · `garden` (`kn_powder_bone` handle, beam cradle) |
| Budget | LOD0 ≈ 6,000 tris · 2048² |
| Audio hooks | tip_creak · latch_clack · sprinkle_loop · slosh · empty_drip · refill_trickle |

**Read at a glance.** A clear can with a long beam spout and a round rose, sitting in a cream cradle.
**Notes / don'ts.** The cradle stops it rolling away, so the pour is aimable. The rose face must point along the spout axis.

---

### WATERWHEEL: Bucket wheel
`waterwheel` · Matter · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A beam-rimmed wheel with clear buckets on a cream A-frame stand. Pour water over it and it turns, spinning its axle port. The water in the buckets is real Matter you can watch slosh and spill.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.40 × 0.40 × 0.20 m (⌀4 × 2 deep) · origin: axle centre (floor z −0.20) · bucket tips Ø 0.39, 5 mm floor clearance |
| Mass · physics | 1.2 kg wheel (dynamic hinge body) + 2.5 kg stand (static) · phys `powder` · Matter couples to the bucket plates (OBB proxies, SIMULATION §8.2) |
| Collision | per bucket, two 5 mm plates under `PIVOT__wheel`: `COL__box__bucket_1…5_floor` + `COL__box__bucket_1…5_wall` (an L-section, so Matter water can actually sit in the scoop; one solid box per bucket would just shed it) · `COL__box__leg_l` / `COL__box__leg_r` = 12 shapes (the limit). The hub has no collider; the spokes are clear of the pour |
| Materials (60/30/10) | neutral: `kn_powder_bone` A-frame leg plates (12 mm, y ±0.085…0.097, feet at x ±0.15), bearing blocks and hub Ø 0.06, `kn_rubber` feet, `kn_steel_brushed` axle Ø 0.016 · signature: `kn_anod_beam` rims Ø 0.36 (y ±0.05) + 5 spokes per side · accent: 5 `kn_poly_clear` buckets at 72° (0.10 wide × 0.05 deep scoops) |
| Ports | `PORT__spin__axle` · out · PR-M · kind `axle` · (0, −0.10, 0) · faces −Y (front bearing block; the axle end sits in the socket) |
| Pivots | `PIVOT__wheel` · y · continuous (driven by the rigid sim) |
| Sensors | none (driven by physical Matter coupling, no intake or outlet) |
| Emitters | `EMIT__drip__rim` (0, 0, 0.19), +X = −Z · cosmetic drips from buckets cresting the top · splash crowns come from engine Splash events (`fx/water_splash`) |
| LEDs / screens | none beyond the port ring |
| States | idle · turning (spoke motion blur at speed, drips) · stalled (load above the output torque: port ring fault blink) · dry |
| Animation | procedural wheel pivot only |
| Fracture | none |
| Skins / variants | `classic` · `mill` (`kn_wood_oak` buckets instead of clear; contents hidden) |
| Budget | LOD0 ≈ 8,000 tris · 2048² |
| Audio hooks | turn_creak loop (speed) · bucket_slosh · spill_splash · drip_patter · stall_groan |

**Read at a glance.** A spoked beam wheel with clear cups on a cream stand.
**Notes / don'ts.** There are 5 buckets, not more: each needs two plates to hold water, and 5 × 2 + 2 legs is exactly the 12-shape limit. Eight single-box buckets (11 shapes) would fit the limit, but they can't hold Matter. Water in the buckets is pass-through Matter, never a fill plane. Keep the bucket lip angle at 25° so they visibly tip at the bottom.

---

### SPONGE: Absorbing foam block
`sponge` · Matter · Class S · Ship M4 · Inspired by (internal only): none

**Concept.** A chunky cream foam block with a beam scourer top. It soaks up Matter water, turning darker and heavier (up to 2 kg), and squirts it back out when squashed.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.10 × 0.10 m (2×1×1) · origin: centre of mass (free body; floor z −0.05) |
| Mass · physics | 0.05 kg dry → 2.05 kg saturated (engine sets mass = dry + absorbed) · phys `rubber` · restitution 0.05, friction 0.9 |
| Collision | `COL__box__body` 0.20 × 0.10 × 0.10 |
| Materials (60/30/10) | neutral: `kn_fabric_bone` foam body (z −0.05…+0.035) with 24 modelled stylised pores (Ø 6–14 mm) · signature: `kn_fabric_beam` scourer layer (z 0.035–0.05) · accent: name tag decal on the front face |
| Ports | none (Fluid is resolved by contact) |
| Pivots | none |
| Sensors | `SENSOR__intake__body` box 0.21 × 0.11 × 0.11 (5 mm proud): absorbs Matter water until 2 kg |
| Emitters | `EMIT__drip__bottom` (0, 0, −0.05), +X = −Z · cosmetic drips while wet ≥ 20 % · `EMIT__squeeze__body` same point · releases absorbed water as Matter at 1 L/s when squashed (≥ 5 kg pressure or ≥ 2 N·s) |
| LEDs / screens | none |
| States | dry (light, bouncy) · absorbing (darkens progressively, swells) · saturated (dark, dripping, heavy) · squeezed (flattens and gushes, then recovers) |
| Animation | shape keys `sk_swell` (+6 % at saturation) and `sk_squash` (−35 % height) · wet look from the engine wetness overlay (`wet` 0–1: albedo −25 %, roughness → 0.35) |
| Fracture | none |
| Skins / variants | `classic` · `sea` (beam body, bone scourer) |
| Budget | LOD0 ≤ 2,500 tris · 1024² (pore normal bake) |
| Audio hooks | absorb_slurp (rate-scaled) · drip · squish · wet_thud · dry_bounce |

**Read at a glance.** A pale porous block with a beam top layer, darkening as it drinks.
**Notes / don'ts.** No foam or sponge master exists, so `kn_fabric_*` (rough 0.9, sheen 0.6) carries the soft read. Pores must be big enough to see at mid-zoom. No real cleaning-product branding.

---

### MARBLE HOPPER: Gumball-style marble dispenser
`marble_hopper` · Matter · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A clear globe packed with glinting marbles on a cream pedestal. On Signal, a beam star-wheel clacks round and marbles rattle out of the chute. A 6-digit counter ticks down from as many as 100k.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.40 × 0.30 m (3×4×3) · origin: bottom centre |
| Mass · physics | 6 kg · phys `powder` · static · capacity property up to 100k marbles (Glint glass or Bearing steel; abstract volume: the 9.2 L globe physically holds ≈ 2.7k Ø 0.016 marbles, so above that the fill shows the fraction) · 100k emitted marbles fit inside the 4 GB tier's 250k · rate property, default 400/s (100k empties in ≈ 4 min) |
| Collision | `COL__hull__pedestal` (frustum 0.28 → 0.18 square, z 0–0.15; a 0.24 base left the bounds 0.26 m wide, under the 0.28 m minimum) · `COL__sphere__globe` r 0.13 at (0, 0, 0.27) |
| Materials (60/30/10) | neutral: `kn_powder_bone` pedestal, `kn_rubber` feet, `kn_steel_brushed` M5 fasteners · signature: `kn_poly_clear` globe Ø 0.26 (z 0.14–0.40), `kn_powder_beam` neck collar (z 0.14–0.15) and lid cap Ø 0.10, `kn_anod_beam` star-wheel (6 pockets) + chute · accent: marble contents, `kn_poly_clear` pedestal window (0.06 × 0.06 at x −0.04, z 0.09), name plate |
| Ports | `PORT__signal__open` · in · PR-M · (0.07, −0.115, 0.075) · faces (0, −0.95, 0.32), flat on the pedestal's sloped front (the face normal of the 0.28 → 0.18 frustum); its 52.5 mm land ends 23 mm below the counter bezel and clear of the window · each pulse toggles dispensing |
| Pivots | `PIVOT__feed_wheel` · y · continuous while open, behind the window (visual speed = rate ÷ 6 pockets, capped at 4 rps) · `PIVOT__chute_flap` · x · 0–60° |
| Sensors | `SENSOR__intake__top` cylinder r 0.045, z 0.385–0.415 (lid hatch; marbles entering are absorbed) |
| Emitters | `EMIT__spout__chute` (0, −0.14, 0.05), +X = −Y tilted 20° down · Matter marbles at the rate property (default 400/s) |
| LEDs / screens | `SCREEN__count` · 7seg · 6 digits (`SCR_7SEG_6`, quad ≈ 0.064 × 0.020; shared_kit §5) · beam · pedestal top band (0, −0.095, 0.135) · group 0 `flowing` (dome beside the counter) |
| States | full (packed globe with glints) · dispensing (level drops, star-wheel clacks, counter ticks) · empty (clear globe, "000000") · refilling |
| Animation | procedural pivots · contents via the fill pass (`CAVITY__marbles`, `matter = marble`): packed-sphere impostor below the level plane + instanced Glint/Bearing LOD meshes in the top 30 mm |
| Fracture | none |
| Skins / variants | `classic` · `arcade` (graphite pedestal instead of bone) |
| Budget | LOD0 ≈ 8,500 tris · 2048² |
| Audio hooks | feed_clack loop · pour_rattle (rate-scaled) · chute_clatter · refill_patter · empty_clunk · counter_tick |

**Read at a glance.** A clear ball of shiny marbles on a cream pedestal: a gumball machine.
**Notes / don'ts.** The round globe sets it apart from GRIT HOPPER's square bin. Don't use gumball colours: marbles are Glint/Bearing only. No coin slot.

---

### GOO VAT: Slime dispenser
`goo_vat` · Matter · Class M · Ship M5 · Inspired by (internal only): none

**Concept.** A squat clear vat of glossy green slime with a slowly turning stirrer. On Signal, a beam duckbill nozzle drools cohesive, sticky goo that slows any Roller it catches.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.30 × 0.30 m (3×3×3) · origin: bottom centre · bounds x ±0.14 (plinth), y −0.152 (nozzle) … +0.14, z 0 … 0.30 |
| Mass · physics | 6 kg · phys `powder` · static · capacity 9 L (inner Ø 0.252 × 0.20 m ≈ 10 L, the inset cavity ≈ 9.1 L) · flow property 0.1–1 L/s (default 0.3; full to empty in 30 s) |
| Collision | `COL__box__plinth` 0.28 × 0.28 × 0.06 · `COL__cylinder__vat` r 0.13, z 0.06–0.29 · `COL__box__nozzle` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth (rounded square 0.28 × 0.28, 30 mm corner radius, z 0.004–0.06, flat front face at y −0.14; a Ø 0.26 footprint left the bounds under the 0.28 m minimum and gave the port and screen no flat land) and lid ring (z 0.26–0.29), `kn_rubber` feet, `kn_steel_brushed` stirrer paddles + M5 fasteners · signature: `kn_poly_clear` vat Ø 0.26 (z 0.06–0.26), `kn_powder_beam` stirrer motor pod Ø 0.06 (z 0.29–0.30), `kn_anod_beam` duckbill nozzle + valve lever · accent: slime contents (`kn_slime` look), name plate on the plinth |
| Ports | `PORT__signal__open` · in · PR-M · (0.075, −0.14, 0.032) · faces −Y (plinth front face) · each pulse toggles the valve |
| Pivots | `PIVOT__stirrer` · z · continuous (0.2 rps idle, 1 rps while flowing) · `PIVOT__valve_lever` · x · 0–90° |
| Sensors | `SENSOR__intake__lid` cylinder r 0.035 at (0, 0.06), z 0.27–0.30 (lid hatch behind the central motor pod, which it used to overlap; absorbs goo particles) |
| Emitters | `EMIT__spout__nozzle` (0, −0.152, 0.08), +X = −Y tilted 30° down · cohesive Matter goo at the flow property · `EMIT__bubble__surface` at the level plane (engine moves it with the level), +X = +Z · rising and popping bubbles |
| LEDs / screens | `SCREEN__level` · `SCR_BAR_10` (bar, 10 cells, quad 0.056 × 0.014; there is no 8-cell bezel) · fluid · (−0.07, −0.14, 0.032), plinth front face · group 0 `valve_open` (dome on the lid ring front) |
| States | full (glossy green, slow bubbles) · flowing (nozzle drools a rope of goo, level drops, stirrer speeds up) · low / empty (slime film on the walls via the residue overlay, last drip string) · refilling |
| Animation | procedural pivots · contents via the fill pass (`CAVITY__goo`, `matter = goo`, profile `flat` with an 8 mm wall meniscus and a stirrer vortex dimple) |
| Fracture | none |
| Skins / variants | `classic` · `lab` (bone plinth and lid instead of graphite) |
| Budget | LOD0 ≈ 7,500 tris · 2048² |
| Audio hooks | bubble_blorp loop · stirrer_hum · valve_clunk · goo_pour (thick squelch, rate-scaled) · drip_snap · refill_gloop |

**Read at a glance.** A fat clear drum of bright green goo with a stirrer and a beam nozzle.
**Notes / don'ts.** Slime green belongs to this part (and its Matter output) only. The nozzle lip is wide (40 × 12 mm) so the goo rope reads. Keep the stirrer visible through the front at every fill level.
