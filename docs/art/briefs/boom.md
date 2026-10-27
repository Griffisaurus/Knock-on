# Fire and Boom: asset briefs

Fire sources, fuses and explosives (GAME_SPEC §12.6). Family look: paper red + amber hazard stripes, graphite tape and hardware.

Back to the [brief index, conventions and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| WICK | `wick` | M | M1 | brief |
| FUSE | `fuse` | proc | M1 | brief |
| BANGSTICK | `bangstick` | M | M1 | brief |
| T-PLUNGER | `t_plunger` | M | M2 | brief |
| POWDER KEG | `powder_keg` | M | M3 | brief |
| JITTERJUICE | `jitterjuice` | S | M3 | brief |
| SKYROCKET | `skyrocket` | M | M2 | brief |
| SKYSHOW | `skyshow` | M | M3 | brief |
| BIG TOP | `big_top` | L | M2 | brief |
| CORK BLASTER | `cork_blaster` | M | M2 | brief |
| FLAMER | `flamer` | M | M3 | brief |
| POPPER | `popper` | S | M3 | brief |
| SINGULARITY | `singularity` | L | M5 | brief |

**Family colour rule.** `kn_paper_red` goes on paper and fibre-case items (sticks, keg wrap, rocket, cake, popper, T-Plunger case). Powder-coated metal that has to read as the family red (Big Top barrel, Cork Blaster barrel) uses `kn_powder_ignition`, because the master list has no red powder. Flamer is amber (ART_BIBLE §3.1). Singularity is graphite + plasma. Hazard stripes are always `kn_decal` (Amber/Graphite at 45°) and never count as a powder colour.
**Fuse convention.** A player-drawn FUSE plugs into a `PORT__heat__fuse` ring. Explosives also carry a short built-in stub that uses the FUSE profile and burn logic, with `EMIT__spark__fuse_tip` at its free end.

---

### WICK: Candle on a graphite stand
`wick` · Fire & Boom · Class M · Ship M1 · Inspired by (internal only): Candle

**Concept.** A chunky red candle in a graphite chamberstick: the friendliest fire source in the game. It's always ready to light a fuse, and it goes out with a satisfying smoke curl when blown on or splashed.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.20 × 0.10 m (1×2×1) · origin: bottom centre (placed device) · mesh top 0.18 (wick tip); hot core to 0.205, visual flame to 0.22 (VFX, not counted in the mesh bounds) |
| Mass · physics | 0.35 kg · phys `powder` (base), `paper` (candle) · restitution 0.2, friction 0.7 · dynamic: it can be knocked over and stays lit |
| Collision | `COL__cylinder__base` r 0.05, z 0–0.035 · `COL__cylinder__candle` r 0.0225, z 0.035–0.165 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base puck Ø 0.10 × 0.035 with drip cup and a 35 mm flat land on the front for the port, `kn_rubber` feet (3 × 4 mm) · signature: wax column Ø 0.045 in `kn_wax` (Bone-tinted default; skins tint it) · accent: wick `kn_rope` Ø 3 mm × 12 mm with a 4 mm `kn_rubber` charred tip, amber/graphite stripe ring decal on the puck rim, flammable pictogram (decal atlas #2; the hot-surface pictogram is not allowed on the Wick) |
| Ports | `PORT__heat__flame` · both · PR-S · (0, −0.047, 0.019) · faces −Y, on the puck's front flat (in: relights from a fuse or flame; out: starts a wired FUSE) |
| Pivots | none |
| Sensors | `SENSOR__heat__flame` capsule r 0.02, z 0.17–0.215 (ignition volume around the 25 mm hot core, z 0.18–0.205: anything inside heats, fuse tips light; Wick igniteTime 0.2 s, SIMULATION §5.7) · `SENSOR__air__douse` same volume, wind > 4 m/s (SIMULATION §5.7) · `SENSOR__fluid__douse` sphere r 0.03 at (0, 0, 0.18), ≥ 5 mL of Matter water |
| Emitters | `EMIT__flame__wick` (0, 0, 0.18), +X = +Z · `fx/wick_flame`: stylised flame 40 mm tall (z 0.18–0.22) drawn round the 25 mm gameplay hot core (the visual flame may exceed the hot core; 40 mm is its cap) + warm point light (2,000 K, 0.6 m range) · `EMIT__smoke__wick` same point · douse smoke curl / comic smoke ring (`fx/smoke_puff`) |
| LEDs / screens | none; the flame is the status light |
| States | unlit · lit (flicker, light, wax glistens) · doused by air (smoke curl, wick tip glows 1 s) · doused by water (steam puff, wet wick) · relit |
| Animation | shape keys `sk_drip` (wax drips grow over 60 s lit; cosmetic, reset on Stop) and `sk_pool` (molten cup at the top). The candle never shortens in gameplay. |
| Fracture | none |
| Skins / variants | `classic` (red) · `birthday` (bone wax, amber stripe spiral decal) |
| Budget | LOD0 ≈ 3,500 tris · masters + decal atlas (no unique set) |
| Audio hooks | ignite (soft whoomph) · flame_loop (gentle flutter) · douse_air (puff) · douse_water (hiss) · relight · knock_over (clatter) |

**Read at a glance.** A red column with a flame on a dark round base; the flame point light is the hero at any zoom.
**Notes / don'ts.** Keep the flame clear of geometry: the candle top (z 0.165) sits 15 mm below the flame base (z 0.18) and 5 mm below the ignition capsule; only the wick enters it. No dripping wax on the floor (no decals). A candle knocked over stays lit and ignites what its flame volume touches: that's a feature.

---

### FUSE: Drawable burning cord
`fuse` · Fire & Boom · Class proc · Ship M1 · Inspired by (internal only): none (new)

**Concept.** A spline-drawn cord with a white-hot spark crawling along it at 0.2 m/s, leaving a black trail. It's the most-watched object in the game, so the burn front must be legible from across a room.

| Spec | Value |
|---|---|
| Size (W×H×D) | path, 0.05–50 m · cord Ø 6 mm (1.5× exaggerated) · min bend radius 15 mm · origin: spline start (engine-generated). `fuse.blend` holds the kit: profile, tip, plug, tee, ember sleeve. |
| Mass · physics | no rigid body: it's a Heat-channel path drawn on surfaces or in the air (Path tool). Burns at 0.2 m/s; every branch burns on independently at 0.2 m/s. |
| Collision | none (path entity; drawn in X-ray as a fuse path) |
| Materials (60/30/10) | neutral: unburnt cord `kn_fuse_cord` (`#4A3524`, matches the look-dev) · signature: burnt cord = `kn_fuse_cord` burnt variant (engine `burnt` material swap, ASSET_PIPELINE §5.1) · accent: `kn_powder_graphite` crimp collars on tees and plugs, `kn_led` ember sleeve |
| Ports | none of its own. Ends snap to any `PORT__heat__*` socket via `fuse__plug` (rubber-sheathed Ø 8 × 12 mm, seats in the ring's socket). A free end gets `fuse__tip` (10 mm frayed lighter core). |
| Pivots | none |
| Sensors | `SENSOR__heat__tip` sphere r 0.015 at each free tip (Fuse igniteTime 0.05 s, SIMULATION §5.7). The engine also samples heat every 50 mm along the path; fire anywhere on the cord lights it there, and it burns both ways. |
| Emitters | `EMIT__spark__fuse_tip` travels with the burn front, +X = path tangent · `fx/fuse_spark`: spray matches the approved look-dev (`#FF8A2A` streaks, `#FFC870` core, embers, unshadowed point light r 0.6 m) · `EMIT__smoke__burn` 30 mm behind the front, thin wisp |
| LEDs / screens | `fuse__ember` sleeve: 12 mm long, Ø 6.6 mm, `kn_led` group 0 `ember` (engine drives `#FF6A1F` flicker), slides along the spline at the burn front |
| States | unlit · burning (spark + ember at the front; the cord behind is re-tessellated with the `burnt` material swap, profile radius × 0.85, braid normal faded out, 8 mm scorch transition at the boundary; `fx/decal_burn_trail` marks any surface under the path) · branch split at a tee (two fronts) · reached a port (spark dives into the socket) · doused by Matter water or wind > 4 m/s (steam puff; the front stops, the cord is `wet` for 5 s, then it can relight; SIMULATION §5.7) · burnt out |
| Animation | procedural regeneration only: 8-sided tube at LOD0 / 6 / 4 / flat ribbon at LOD3, one ring every 10 mm on curves and every 50 mm on straights. The 6-lobe twist (lobe 1 mm, pitch 18 mm) comes from the `kn_fuse_cord` braided normal: 8 radial verts can't carry 6 geometric lobes, and rings every 50 mm can't carry an 18 mm twist |
| Fracture | none |
| Skins / variants | `classic` · `party` (amber/graphite 45° stripe wrap via `kn_decal` trim on the unburnt section) |
| Budget | LOD0 ≈ 32 tris per 0.1 m straight (2 rings × 8 sides × 2), ≈ 160 per 0.1 m on tight curves · kit meshes ≤ 1,500 tris total · masters only |
| Audio hooks | ignite (fizz-pop) · burn_loop (hiss, follows the front as a spatial source) · branch_split (tick) · enter_port (sputter-thunk) · douse (hiss) · burn_out (pfft) |

**Read at a glance.** A warm brown line that turns black behind a bright spark ball.
**Notes / don'ts.** The cord uses the `kn_fuse_cord` master (ASSET_PIPELINE §5.1), matching the look-dev colour. The tee collar (Ø 10 × 14 mm, up to 3 outputs) must be visible at every branch. Never let the spark sprite sit inside the cord geometry; offset it 3 mm along the path normal.

---

### BANGSTICK: Three-stick paper charge
`bangstick` · Fire & Boom · Class M · Ship M1 · Inspired by (internal only): Dynamite

**Concept.** The game's signature explosive: three red paper sticks taped together, with a cream label and a curly fuse. Built from the approved procedural look-dev (`style_samples.py` → `bangstick()`) at catalogue scale.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.10 × 0.10 m (3×1×1) · origin: centre of mass = bundle centroid, 0.039 above the floor (free body) · bounds x −0.143 (detonator collar) … +0.16 (stub loop), y ±0.05, z −0.039 … +0.061 (stub top) |
| Mass · physics | 0.8 kg · phys `paper` · restitution 0.2, friction 0.6 (`bangstick.part.json`) |
| Collision | `COL__capsule__stick_1/2/3` r 0.025, 0.28 long overall on X (cylinder half-height 0.115), centres (y, z) = (−0.025, −0.014), (0.025, −0.014), (0, 0.029) · phys `paper` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` tape bands ×2 (x ±0.07, 21 mm wide, wrapping the rounded-triangle hull 2.5 mm proud on the top and sides and pressed flush on the underside, so the bundle rests on its capsules at z −0.039 and the tape never sinks into the floor), `kn_paper_tan` end discs (4 mm, inside the 0.28 length) · signature: `kn_paper_red` sticks Ø 0.05 × 0.28 (end faces at x ±0.14) · accent: `kn_powder_bone` label (75 × 27 mm, front face, tilted 25° up) carrying the name plate, explosive pictogram (#1) and a 6 mm amber/graphite stripe border; fuse stub `kn_fuse_cord` |
| Ports | `PORT__signal__detonator` · in · PR-S · (−0.14, 0, 0) · faces −X (look-dev position, on the centroid where the end discs meet) · `PORT__heat__fuse` · in · PR-S · (0.14, 0, 0.029) · faces +X (look-dev position, centred on the top stick's end disc; the stub leaves through the ring) |
| Pivots | none |
| Sensors | none authored; it detonates on stub burn-out, a detonator Signal, or a sympathetic blast (§6.7, in code). Stub tip igniteTime 0.05 s (SIMULATION §5.7) |
| Emitters | `EMIT__spark__fuse_tip` at the stub tip (0.125, 0.015, 0.058), +X = +Z · `fx/fuse_spark` (look-dev spray), travels down the stub as it burns · `EMIT__smoke__fuse_tip` same point · `EMIT__boom__core` (0, 0, 0) → `fx/boom_small` (yield 1) |
| LEDs / screens | none; `kn_led` ember sleeve (8 mm, group 0 `ember`) rides the stub's burn front |
| States | idle · fuse lit (spark + ember travel the 70 mm stub over the fuse time, 0.5–5 s, default 2.0 s; the stub is display-scaled, not 0.2 m/s; the burnt section takes the `kn_fuse_cord` burnt swap) · detonator received (instant) · detonated (mesh hidden, chunks + Spectacle spawn) |
| Animation | none; stub burn is procedural (FUSE profile + material swap) |
| Fracture | 4 macro chunks (`macroChunks: 4`, GAME_SPEC §18.3): `FRAC__1–2` tape bands torn into C-shapes; `FRAC__3–4` charred paper tube halves split lengthwise (`kn_interior_paper` inner faces). Charred state: chunks spawn with the engine scorch decal. Micro: `DEB_paper` scraps (shared_kit §8) via `fx/debris_micro`. |
| Skins / variants | `classic` · `candy` (amber/graphite 45° stripe wrap decal on the sticks) |
| Budget | LOD0 ≤ 5,500 tris · masters + decal atlas (no unique set) · chunks ≤ 800 tris each |
| Audio hooks | fuse_light · fuse_hiss loop (`sfx/fuse_hiss`) · detonator_click · detonate (`sfx/boom_small`) · knock (paper thump) · debris_patter |

**Read at a glance.** Three red tubes, two dark bands, a cream label and a curly fuse. When it's lit, a white-hot spark crawls down that fuse.
**Notes / don'ts.** The look-dev is approved, so keep the triangle stack, graphite tape, bone label, −X signal ring and the fuse leaving the top stick's +X cap. Only the scale changes (look-dev sticks 0.17 × Ø 0.038 → 0.28 × Ø 0.05; with the collars and stub loop the bounds are 0.30 m). The stub exits the fuse ring at (0.143, 0, 0.029), loops out to x 0.16 and up over the top stick, and its tip stays at z 0.058, inside the bounds. The worked examples in PART_SYSTEM §9 and DATA_FORMATS §8 must match these numbers. The tape bands follow the bundle hull, because the look-dev's round bands poke through the floor. No clock, wires or digital timer: it's a paper stick.

---

### T-PLUNGER: Push-handle detonator box
`t_plunger` · Fire & Boom · Class M · Ship M2 · Inspired by (internal only): Dynamite plunger

**Concept.** A red fibre-case box with a big T-handle. Slam the handle down and every wired explosive goes. Through a front window you can see a brass rack spinning a copper dynamo.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.30 × 0.20 m (2×3×2) · origin: bottom centre · handle up = top at z 0.30 |
| Mass · physics | 2.5 kg · phys `powder` · static device |
| Collision | `COL__box__plinth` 0.20 × 0.20 × 0.024 · `COL__box__case` 0.18 × 0.18 × 0.135 (z 0.024–0.159) · `COL__cylinder__rod` r 0.008 · `COL__box__handle` 0.16 × 0.035 × 0.035 (under `PIVOT__plunger`) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth, corner caps, top plate, T-bar · `kn_steel_brushed` M5 corner fasteners · `kn_chrome` rod · signature: `kn_paper_red` case panels (red fibreboard) + hazard stripe band decal · accent: `kn_powder_graphite` T-bar with `kn_rubber_grip` grips, `kn_poly_amber` window, `kn_brass` rack, `kn_copper` windings |
| Ports | `PORT__signal__out` · out · PR-M · (0.055, −0.091, 0.075) · faces −Y · `max_links = 64`, `broadcast = true` ("up to 64 explosives"; the broadcast exception to the per-port cap, PART_SYSTEM §3) |
| Pivots | `PIVOT__plunger` · z · −0.10 to 0 m · rod + T-handle (fully down, the T-bar's underside stops at z 0.165, 6 mm above the case top at 0.159) · `PIVOT__pinion` · x · continuous (2,400° per stroke, geared to the plunger) · `PIVOT__armature` · x · continuous (dynamo inside the window) |
| Sensors | `SENSOR__impact__handle` box over the T-bar top · 0.3 N·s or ≥ 1 kg pressure · cooldown: one-shot until Stop |
| Emitters | `EMIT__spark__window` (−0.05, −0.092, 0.075), +X = −Y · tiny spark crackle in the window on fire · `EMIT__fire__port` at the ring · signal flash (audio anchor) |
| LEDs / screens | group 0 `armed`: amber dome on the top plate front (steady when ≥ 1 explosive is linked, 4 Hz blink while the handle travels, off after firing) · group 1 `coil`: `kn_led` strip behind the dynamo, flashes in signal colour on fire |
| States | unlinked (LED off) · armed (LED on) · plunging (0.08 s handle drop, rack spins) · fired (signal pulse to every link, handle stays down) · reset on Stop |
| Animation | procedural pivots only |
| Fracture | none (blast-proof; takes scorch decals) |
| Skins / variants | `classic` · `mine-cart` (`kn_wood_walnut` case panels, same layout) |
| Budget | LOD0 ≈ 7,000 tris · 2048² set (window interior AO bake) + decal atlas |
| Audio hooks | handle_hit · plunge (ratchet zip + dynamo whine) · fire_clack · handle_bottom (thunk) · armed_tick · reset |

**Read at a glance.** A red box with a dark T-handle sticking up: the classic detonator silhouette, even at 64 px.
**Notes / don'ts.** The window (60 × 80 mm, centred x −0.05, z 0.075) sits left of the port ring with ≥ 54 mm (more than one PR-M diameter) between them. Exaggerate the T-bar grips 1.3×. No wire spools, no skull pictograms: the hazard pictogram from the decal atlas is the only warning mark.

---

### POWDER KEG: Big oak barrel charge
`powder_keg` · Fire & Boom · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A fat oak keg with a red paper belly wrap and a brass bung fuse. It's the "Kiloton" benchmark hero: yield 3, a volumetric mushroom, and staves flying everywhere.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.30 × 0.20 m (2×3×2) · origin: centre of mass at mid-height (free body); floor contact z −0.15 |
| Mass · physics | 6 kg · phys `wood` · restitution 0.15, friction 0.6 · rolls when on its side |
| Collision | `COL__hull__body` (48-vert barrel hull: belly Ø 0.20 at z 0, heads Ø 0.17 at z ±0.15) |
| Materials (60/30/10) | neutral: `kn_wood_oak` 12 staves + 2 lids (recessed 8 mm inside the chime) · signature: `kn_paper_red` belly wrap z −0.07…+0.07 (faces on each stave) + hoops `kn_powder_graphite` (20 mm wide at z ±0.10, one M5 fastener each at the front) · accent: `kn_brass` bung collar Ø 0.012 (in the fuse ring), amber/graphite stripe ring decal on the top lid rim (12 mm), name plate on the front stave, explosive pictogram (#1) on the next stave |
| Ports | `PORT__heat__fuse` · in · PR-S · (0.045, 0, 0.142) · faces +Z (a `kn_brass` bung collar Ø 0.012, the size of a PLUG_S boot, sits on the socket face and the stub exits through it) · `PORT__signal__detonator` · in · PR-S · (−0.045, 0, 0.142) · faces +Z (both on the lid surface, 8 mm below the chime at z 0.15) |
| Pivots | none |
| Sensors | none authored; detonates on fuse, Signal, sympathetic blast, or cook-off: 1.5 s of continuous heat exposure (SIMULATION §5.7) |
| Emitters | `EMIT__spark__fuse_tip` at the stub tip (0.065, −0.02, 0.165), +X = +Z · `fx/fuse_spark` · `EMIT__smoke__bung` (0.045, 0, 0.15) · cook-off wisps · `EMIT__boom__core` (0, 0, 0) → `fx/boom_keg` (yield 3: volumetric mushroom, shock ring, sparks, `DEB_wood` + `DEB_paper` splinters; counts per tier in vfx.md §2.1–2.3) |
| LEDs / screens | none; `kn_led` ember sleeve on the 60 mm bung stub |
| States | idle · cooking (continuous heat: scorch decal creeps over the wrap, wisps from the bung, staves creak; it cooks off after 1.5 s, and the timer resets when the heat stops) · fuse lit · detonated |
| Animation | none |
| Fracture | 16 macro chunks: `FRAC__01–12` staves (each ≈ 0.052 wide × 0.30, oak + wrap segment, `kn_interior_wood` torn ends) · `FRAC__13–14` hoops sprung open into 290° C-shapes · `FRAC__15–16` lids (top keeps the bung and baked copies of both PR-S rings, LEDs off). Charred state: all chunks spawn with the engine soot decal (60 % coverage on inner faces). Micro: `DEB_wood` splinters via `fx/debris_micro`. |
| Skins / variants | `classic` · `xxx` (bone wrap with "XXX" stencil decal) |
| Budget | LOD0 ≈ 8,500 tris · 2048² set (oak bake) · chunks ≤ 900 tris each |
| Audio hooks | fuse_light · fuse_hiss · cook_creak · detonate_large (yield 3, distance-delayed) · hoop_clang · stave_clatter · knock (hollow wood) · roll_loop |

**Read at a glance.** A barrel with a red belly band and a fuse curling out of the top.
**Notes / don'ts.** Staves must split along the grain: no Voronoi crumbs. Keep both port rings on the top lid, 90 mm apart (x ±0.045; each ring's 35 mm land ends at r 0.063, inside the lid and clear of the 12 mm stripe ring at r 0.063–0.075). A Ø 0.03 bung can't sit in a PR-S socket (Ø 13.4 mm), so the bung is the Ø 0.012 collar above. The stub tip may rise to z 0.165, which is within the 0.02 m tolerance. No skulls or "TNT" text.

---

### JITTERJUICE: Shock-sensitive nitro flask
`jitterjuice` · Fire & Boom · Class S · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A round-bottom glass flask of glowing amber liquid, held in a graphite safety cage and corked like champagne. It looks nervous: the liquid fizzes and sloshes at the slightest bump. Hit it and it goes (yield 1.5).

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.15 × 0.10 m (1×1.5×1) · origin: centre of mass, 0.05 above the floor (free body) · top at z 0.10 |
| Mass · physics | 0.4 kg · phys `glass` · restitution 0.3, friction 0.4 |
| Collision | `COL__sphere__bulb` r 0.0425 at (0, 0, −0.005) · `COL__cylinder__neck` r 0.016, z 0.035–0.095 · `COL__cylinder__base` r 0.05, z −0.05…−0.03 |
| Materials (60/30/10) | neutral: `kn_glass` flask, `kn_powder_graphite` cage (base ring, 3 bails, neck collar), `kn_rubber` feet ×3 · signature: liquid via the container-fill pass, shaded `kn_poly_amber`, plus a `kn_paper_red` label sleeve on the neck (z 0.035–0.065) · accent: `kn_cardboard` cork, `kn_steel_brushed` wire twist, fragile pictogram (#9) on the sleeve |
| Ports | none (impact is resolved by contact; no wired inputs) |
| Pivots | none |
| Sensors | `SENSOR__impact__shock` hull = whole body · detonates on a single contact J ≥ 0.15 N·s (more sensitive than a Yolk at 0.3; a Cork Blaster cork carries 0.24 N·s and delivers ≈ 0.37 N·s with its e 0.6 bounce, so it always sets it off; that's about a 4 mm drop for this 0.4 kg flask) · near-miss feedback from 0.08 N·s (above the steady support impulse of a resting flask, m·g·dt ≈ 0.033 N·s per tick at 120 Hz and 0.065 at 60 Hz, so a resting flask never flickers) · also detonates sympathetically (§6.7) |
| Emitters | `EMIT__boom__core` (0, 0, 0) → `fx/boom_medium` (yield 1.5, `DEB_glass` shard layer) · `EMIT__fizz__surface` at the liquid level (engine moves it), +X = +Z · rising bubbles |
| LEDs / screens | group 0 `agitation`: `kn_led` disc in the cage base under the bulb, shining amber up through the liquid; brightness tracks recent impulse (flares on near-misses) |
| States | idle (slow bubbles, soft glow) · jostled (0.08–0.15 N·s: slosh, bubble burst, LED flare) · detonated |
| Animation | none; liquid is `CAVITY__liquid` (`matter = fill`, ASSET_PIPELINE §3.10) in the container-fill pass (fill fixed at 0.75, world-space level plane, engine slosh) |
| Fracture | 14 chunks: `FRAC__01–10` glass shards (8 bulb + 2 neck, `kn_interior_glass`) · `FRAC__11` cork · `FRAC__12–14` cage base ring + 2 bent bails. The liquid vanishes into the fireball (no Matter). |
| Skins / variants | `classic` only |
| Budget | LOD0 ≤ 2,800 tris · 1024² · ≤ 2 transparent layers (glass + liquid) |
| Audio hooks | fizz_loop (quiet) · jostle_fizz · glass_clink (contacts < 0.08 N·s) · detonate_mid (yield 1.5, glass layer) |

**Read at a glance.** A glowing amber bulb in a dark cage with a cork on top: "handle with care".
**Notes / don'ts.** There's no fuse attachment by design: impact only, and heat doesn't ignite it. Don't use green liquid; that's Goo's identity. Keep the cage open enough that the liquid is readable from every side.

---

### SKYROCKET: Finned paper rocket
`skyrocket` · Fire & Boom · Class M · Ship M2 · Inspired by (internal only): Rocket

**Concept.** A chunky red paper rocket on three graphite fins. Light it and it flies for real in 3D, carrying a small payload on its nose deck.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.30 × 0.10 m (1×3×1) · origin: centre of mass at the body axis, 0.12 above the floor (free body) · nose tip z 0.18 |
| Mass · physics | 0.3 kg · phys `paper` · restitution 0.25, friction 0.5 · thrust 2.0 s, then coasts |
| Collision | `COL__capsule__body` r 0.03, z −0.10…0.17 · `COL__hull__fins` (one 30-vert hull around the 3 fins) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` fins, nozzle bell, base collar · signature: `kn_paper_red` body tube Ø 0.05, z −0.09…0.09, with amber/graphite 45° spiral stripe decal · accent: `kn_powder_amber` nose cone (z 0.09–0.165) topped by a `kn_rubber_grip` payload deck Ø 0.03, `kn_rubber` fin tip pads (feet), name plate on the body |
| Ports | `PORT__heat__fuse` · in · PR-S · (0, −0.032, −0.045) · faces −Y (flat boss on the base collar between the front fins) |
| Pivots | none |
| Sensors | `SENSOR__catch__payload` box 0.04 × 0.04 × 0.03 above the deck (z 0.18–0.21): at ignition, bodies ≤ 0.5 kg resting there are fixed to the rocket for the flight |
| Emitters | `EMIT__spark__fuse_tip` (0, −0.05, −0.08), +X = −Z · `fx/fuse_spark`, stub hangs from the port · `EMIT__exhaust__nozzle` (0, 0, −0.11), +X = −Z · `fx/rocket_exhaust` (vfx.md): flame plume 0.25 m at full thrust + sparks for the 2.0 s burn (also the Skyrocket-exhaust heat source, SIMULATION §5.7) · `EMIT__trail__nozzle` same point · smoke ribbon (`fx/smoke_column`) · burnout ring (`fx/smoke_ring`) |
| LEDs / screens | group 0 `nozzle_heat`: `kn_led` ring inside the nozzle bell, glows orange while thrusting and fades over 2 s after burnout |
| States | idle (upright on fins) · fuse lit · thrusting (plume, trail, nozzle glow) · burnout (pop + comic smoke ring) · spent (scorched nozzle decal, tumbles as a body) |
| Animation | none |
| Fracture | none |
| Skins / variants | `classic` · `comet` (bone body, amber stripe) |
| Budget | LOD0 ≈ 4,500 tris · masters + decal atlas |
| Audio hooks | fuse_hiss · ignite_whoosh · thrust_loop (crackle-roar, Doppler) · burnout_pop · impact_paper · payload_clunk |

**Read at a glance.** A red tube with a yellow nose and three dark fins, plus a smoke trail when it's flying.
**Notes / don'ts.** Fins sit at 90° (back), 210° and 330°, so the front stays clear for the port ring. The nozzle clears the floor by 10 mm. No warheads and no military markings: this is a firework.

---

### SKYSHOW: Six-shot firework cake
`skyshow` · Fire & Boom · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** Six splayed red mortar tubes on a graphite tray, linked by a visible quick-match fuse. Light it once and it fires 6 aerial bursts in order, so you can watch the burn hop from tube to tube.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.30 m (3×2×3) · origin: bottom centre |
| Mass · physics | 1.6 kg · phys `paper` (tubes), `powder` (tray) · dynamic: recoil nudges it 2 mm per shot |
| Collision | `COL__box__tray` 0.30 × 0.30 × 0.04 · `COL__hull__cake` (one hull around the 6 tubes) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` tray (z 0.004–0.04) with `kn_rubber` feet, `kn_cardboard` tube rims · signature: `kn_paper_red` tube wraps Ø 0.075 · accent: `kn_paper_tan` caps, amber/graphite stripe band decal on the tray front, hazard pictogram, name plate on the tray top front |
| Ports | `PORT__heat__fuse` · in · PR-S · (0, −0.151, 0.022) · faces −Y |
| Pivots | none |
| Sensors | none |
| Emitters | `EMIT__spark__fuse_tip` at the stub tip (0.03, −0.165, 0.03) · `fx/fuse_spark` · `EMIT__muzzle__tube_1…6` at each tube top along its axis. Base centres: 1 (−0.085, −0.065), 2 (0, −0.065), 3 (0.085, −0.065), 4 (0.085, 0.065), 5 (0, 0.065), 6 (−0.085, 0.065); tops at z 0.195; rows splay ±10° on Y, outer columns ±8° on X (splayed tube tops stay inside x ±0.145, y ±0.13) · lift flash + smoke column + shell trail. Shells are deterministic bodies; each detonates at its burst altitude (default 6 m, capped at world height − 1 m) as a yield-0.2 blast (SIMULATION §6.1, R ≈ 0.70 m), and the burst visuals are Spectacle (`fx/firework_<pattern>`) · `EMIT__smoke__tray` (0, 0, 0.05) |
| LEDs / screens | none; the 6 caps and the quick-match show progress |
| States | idle (6 caps) · lit (quick-match burns port → 1 → 6 on the tray top, 0.6 s per hop) · firing (cap pops off, flash, scorch decal on the rim) · spent (all tubes open, smoke wisps for 4 s) |
| Animation | quick-match is a static FUSE-profile spline on the tray top, burned at the standard 0.2 m/s: the port → tube 1 run and each hop are 0.12 m of cord (0.6 s), routed in a shallow S between tube bases · caps hide on fire (Spectacle cap flip) |
| Fracture | none (stays as a charred cake) |
| Skins / variants | `classic` · `gala` (bone wraps, amber stripes) · burst pattern presets (vfx.md §2.4: peony, chrysanthemum, willow, ring, palm, crossette, heart, starburst, glitter; brand palette only) are data, not skins |
| Budget | LOD0 ≈ 6,500 tris · masters + decal atlas |
| Audio hooks | fuse_hiss · lift_thump ×6 · shell_whistle · burst_{peony, chrysanthemum, willow, ring, palm, crossette, heart, starburst, glitter} · crackle_tail · spent_hiss |

**Read at a glance.** A fan of red tubes on a dark tray.
**Notes / don'ts.** The splay is gameplay-visible, because shell trajectories follow the tube axes, so model the tube angles exactly. Burst colours come from the brand palette only. No real firework brand look or Chinese-character labels.

---

### BIG TOP: Circus cannon
`big_top` · Fire & Boom · Class L · Ship M2 · Inspired by (internal only): Cannon

**Concept.** A fat red circus cannon on a graphite wheeled carriage, with a flared bell muzzle and a **variable-bore iris**: eight anodised leaves inside the bell close like a camera aperture around whatever Roller you load, from a marble to a THUD. Light the touch-hole and it fires the Roller in a burst of confetti and a smoke ring.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.60 × 0.40 × 0.40 m (6×4×4) at the default 30° elevation · origin: bottom centre · muzzle points +X · bounds at 30°: x −0.30 (trail spade) … +0.29 (bell lip), y ±0.205 (tyres), z 0 … 0.416 (bell top) |
| Mass · physics | 18 kg · phys `powder` · static device · `power` property 1–5 (launch energy 4–40 J); muzzle speed `v = clamp(√(2E/m), 2, 14) m/s`, so heavy balls lob and light ones zip |
| Collision | `COL__box__cheek_l/r` (x −0.24…0.12) · `COL__cylinder__wheel_l/r` · `COL__box__trail` · `COL__cylinder__barrel` (outer only: r 0.15, barrel-local −0.06…+0.16) = 6 shapes. There's no bore collider: a loaded Roller is held kinematically on the bore axis until it fires (see Notes) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` cheeks (inner faces y ±0.17, 16 mm thick, outer faces y ±0.186), trail, cascabel knob, spoked wheels Ø 0.18 with 16 mm `kn_rubber` tyres · signature: `kn_powder_ignition` barrel (Ø 0.30, bore Ø 0.27, barrel-local −0.06 to +0.06) flaring to the bell (Ø 0.36 at the muzzle face, barrel-local +0.16), with an amber/graphite stripe band decal at mid-barrel · accent: `kn_anod_ignition` iris leaves ×8 (iris plane barrel-local +0.12; open leaves stow in the flare between Ø 0.27 and 0.34), `kn_steel_brushed` iris ring, trunnion caps and M8 fasteners, `kn_powder_graphite` loaded-flag with a bone decal star, name plate on the front cheek |
| Ports | `PORT__heat__fuse` · in · PR-L · (−0.20, −0.186, 0.10) · faces −Y (front cheek's outer face, behind the wheel; 70 mm land at x −0.235…−0.165) |
| Pivots | `PIVOT__elevation` · y at trunnion (0.06, 0, 0.18) · 15°–55° (default 30°, set in Build) · `PIVOT__recoil` · barrel-local −X · 0 to −0.03 m · `PIVOT__ram` · barrel-local +X · 0–0.16 m (pusher plate Ø 0.25, rest face at barrel-local −0.05) · `PIVOT__wheel_l/r` · y · continuous (axle (0.02, ±0.197, 0.09)) · `PIVOT__flag` · y · 0–80° (6 pivots) |
| Sensors | `SENSOR__catch__bore` · cylinder r 0.135, barrel-local −0.05 to +0.16 · accepts **one Roller of any size** (YOLK 0.045 × 0.06, FUZZ Ø 0.065, STITCH Ø 0.075 … up to HELIO Ø 0.25), or **up to 12 GLINT/BEARING marbles**, which fire as a spread (±6° cone, deterministic pattern) |
| Emitters | `EMIT__spark__fuse_tip` at the touch-hole stub tip (−0.04, 0, 0.313), +X = barrel normal · `fx/fuse_spark` · `EMIT__smoke__touch_hole` (−0.03, 0, 0.30), on the barrel top near the breech · both ride `PIVOT__elevation` (positions at 30°) · `EMIT__muzzle__barrel` at barrel-local +0.16, +X = bore axis · smoke ring (`fx/smoke_ring`) + brand-palette confetti (`fx/confetti_burst`) + flash, 0.4 m `fx/shock_ring` and `fx/dust_kick` |
| LEDs / screens | none (pyro, not electric); the pop-up loaded flag and the iris are the indicators |
| States | empty (iris fully open Ø 0.26, flag down) · loaded (iris closes to the Roller in 0.25 s with a ratchet click, flag up) · lit (touch-hole sparks) · fire (ram shoves the Roller, iris snaps open, confetti, smoke ring, recoil) · spent (re-arms when another Roller enters; needs heat again) |
| Animation | shape key `sk_iris` (0 = open Ø 0.26 → 1 = closed Ø 0.05), engine-driven: loaded Roller's diameter + 4 mm (YOLK 0.045 + 4 mm ≈ the Ø 0.05 stop; a marble load closes to the Ø 0.05 stop) · clip `big_top__recoil` (0.5 s: carriage hop 10 mm, wheels roll back 15°, barrel kick and return) · procedural pivots |
| Fracture | none |
| Skins / variants | `classic` · `midway` (bone barrel, amber stripes, brass iris) |
| Budget | LOD0 ≈ 24,000 tris (iris ≈ 3,000) · 2048² + 1024² detail |
| Audio hooks | load_clunk · iris_ratchet (pitch by closing distance) · flag_flip · fuse_hiss · fire_boom (deep "fwoomp" + confetti flutter; body scaled by Roller mass) · iris_snap_open · recoil_creak · wheel_roll |

**Read at a glance.** A big red bell-mouthed barrel tilted up on wheels, with an orange camera-iris inside the bell: circus, not war.
**Notes / don'ts.** The iris is the hero detail. Its leaves must be readable from the default 3/4 view at 150 px, and they're always lit by a small internal bounce card so the bell never reads as a black hole. Gameplay hold: the loaded Roller is switched to kinematic on the bore axis with its back against the ram plate (iris diameter = Roller diameter + 4 mm, a retainer in front of small balls), so no tight bore collision is needed for any size. The bore is only 0.21 m deep, so THUD, BOING and HELIO peek 10–40 mm out of the bell, which reads as "loaded". At fire it returns to dynamic with the muzzle velocity along the bore axis. HELIO fires too (it flies, then floats off; a comedy beat); a YOLK fires intact (no contact impulse) and splats on landing. Bell flare, stripes and confetti are mandatory. Bounds are validated at 30°. **The 4-cell height forces a squat barrel**: the bell (Ø 0.36) alone spans 0.31 m vertically at 30°, so the barrel is 0.22 m long (−0.06…+0.16 from the trunnion). Checked across the whole range: the bell top stays ≤ 0.416 from 15° to 55°, and the breech clears the floor by ≥ 5 mm even at full recoil. Play it as a chunky toy mortar on a long carriage. Never a naval or military cannon look: no ropes, rammers or cannonball piles.

---

### CORK BLASTER: Toy cork pop-gun on a stand
`cork_blaster` · Fire & Boom · Class M · Ship M2 · Inspired by (internal only): Gun (replaced)

**Concept.** A fat, bright pop tube on a cream saddle stand. You can see its chrome spring through a clear window, and it fires a cork on a string with a comic POP. It must read as a toy at first glance and never as a firearm.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.10 × 0.10 m (3×1×1) · origin: bottom centre · fires +X |
| Mass · physics | 0.9 kg · phys `powder` · static · cork: separate 0.02 kg body, phys `rubber`, e 0.6, launched at 12 m/s (0.24 N·s), tethered by a 1.5 m string (distance constraint) |
| Collision | `COL__box__stand` 0.18 × 0.08 × 0.039 · `COL__cylinder__barrel` r 0.03, x −0.12…0.11 at z 0.06 · cork `COL__capsule__cork` r 0.014, 0.035 long, tagged `sharp` so it always pops Helios as GAME_SPEC §12.6 requires (SIMULATION §5.1: sharp contact pops a Helio at any speed, so it still pops one on a slow, dangling touch; it delivers ≈ 0.37 N·s, so it presses The Button at 0.02 N·s and sets off Jitterjuice at 0.15 N·s) |
| Materials (60/30/10) | neutral: `kn_powder_bone` saddle stand + muzzle bell (Ø 0.075) + −X end cap, `kn_rubber` feet · signature: `kn_powder_ignition` barrel Ø 0.06 with a `kn_poly_clear` window (x −0.06…+0.02, front half) showing a `kn_chrome` spring and piston · accent: `kn_powder_ignition_gloss` pull ring (torus Ø 0.045), `kn_cardboard` cork, `kn_rope` string Ø 2 mm, amber stripe decal ring behind the bell |
| Ports | `PORT__signal__fire` · in · PR-S · (−0.03, −0.041, 0.021) · faces −Y (stand front) · `PORT__tension__pull` · in · PR-S · kind `hook` · (−0.128, 0, 0.06) · faces −X (end cap; the plunger shaft passes through the socket to the pull ring) · fires at ≥ 4 N |
| Pivots | `PIVOT__plunger` · x · −0.025 (cocked) to 0 · pull ring + shaft · `PIVOT__piston` · x · 0–0.06 (inside the window) |
| Sensors | none (triggers come through the ports) |
| Emitters | `EMIT__muzzle__barrel` (0.135, 0, 0.06), +X = +X · comic smoke ring (`fx/smoke_ring`) + 6 confetti flakes (`fx/confetti_burst`). **No flash, no fire.** · `EMIT__string__eyelet` (0.12, 0, 0.03) · string anchor |
| LEDs / screens | group 0 `ready`: dome Ø 8 mm on the stand top (signal colour when cocked) |
| States | cocked (cork seated, spring compressed in the window) · fired (cork flies, string pays out, POP ring) · dangling (cork hangs on its taut string) · reset on Stop |
| Animation | procedural pivots + shape key `sk_compress` on the spring (1 = cocked) |
| Fracture | none |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 5,500 tris · masters + decal atlas |
| Audio hooks | cock_click (reset) · fire_pop ("thoonk-POP") · string_taut (twang) · cork_bounce · cork_dangle (ticks) |

**Read at a glance.** A short, fat orange tube with a cream bell mouth on a cream stand, and a cork on a visible string.
**Notes / don'ts.** No pistol grip, trigger, trigger guard, magazine, sights, stock or rails, and nothing black or gunmetal. It's always on its stand, the cork is always visibly tied on, and the barrel stays shorter and fatter than any real gun (length:diameter ≤ 4:1). Wherever it appears in ratings material, it shows the cork on its string.

---

### FLAMER: Cradle blowtorch
`flamer` · Fire & Boom · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** An amber gas canister in a graphite cradle, with a brass burner that throws a 0.6 m heat beam. It's gas-fed: a Signal opens the valve, and it needs no power unless you choose powered mode. Through a sight glass you can see the piezo igniter click.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.10 × 0.10 m (3×1×1) · origin: bottom centre · flame points +X |
| Mass · physics | 1.2 kg · phys `powder` · static |
| Collision | `COL__box__cradle` 0.20 × 0.08 × 0.035 (x −0.10…0.10) · `COL__cylinder__canister` r 0.0325, x −0.14…0 at z 0.05 · `COL__capsule__burner` r 0.012, x 0.04–0.15 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` cradle, regulator block (x 0–0.04) and oversized valve knob · `kn_steel_brushed` nozzle shroud Ø 0.024 with vents · signature: `kn_powder_amber` canister Ø 0.065 + amber/graphite hazard stripe band · accent: `kn_brass` burner tube Ø 0.014, `kn_poly_amber` sight glass on the regulator front, flammable pictogram (#2) on the canister and hot-surface pictogram (#3) on the shroud (one per face) |
| Ports | `PORT__signal__on` · in · PR-S · (−0.07, −0.041, 0.019) · faces −Y (gas mode, the default: a pulse toggles the valve; no power draw) · `PORT__power__in` · in · PR-S · (−0.03, −0.041, 0.019) · faces −Y (powered mode only, an Inspector choice: on while powered, draws 80 W, SIMULATION §5.5) · both on the cradle front; at x −0.10 the first ring overhung the cradle end |
| Pivots | `PIVOT__valve_knob` · z · 0–90° · turns open when active |
| Sensors | `SENSOR__heat__beam` cone hull from (0.15, 0, 0.05) along +X, 0.6 m long, end radius 0.06 · ignites fuses and Wicks, burns Planks, pops Helios |
| Emitters | `EMIT__flame__nozzle` (0.15, 0, 0.05), +X = +X · `fx/flamer_jet`: blue-white nozzle core 50 mm + stylised orange flame to ≤ 0.8 m (visuals may reach up to 1.3× the 0.6 m heat cone) + heat shimmer + dynamic light · `EMIT__spark__igniter` behind the sight glass |
| LEDs / screens | group 0 `status` (dome on the regulator top, heat colour when on) · group 1 `igniter` (spark-gap flash in the sight glass) |
| States | off · igniting (0.15 s click, visible spark) · on (roar, shimmer along the beam) · shutting off (flame shrinks over 0.2 s, smoke puff) · doused (wind > 4 m/s at the nozzle or Matter water: flame out with a smoke puff until the next on-pulse or power edge; SIMULATION §5.7) |
| Animation | procedural pivot only |
| Fracture | none |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 6,500 tris · masters + decal atlas |
| Audio hooks | valve_click · ignite (piezo tick + whoomph) · flame_loop (roar) · off_sputter · contact_sizzle |

**Read at a glance.** A yellow canister with stripes and a brass nozzle, with a long flame when it's on.
**Notes / don'ts.** Hazard stripes are allowed here (ART_BIBLE §6). No pistol-grip torch or "flamethrower" read: it lies in its cradle like a bench tool. The 0.6 m sensor cone is the gameplay reach; the visual flame may run on to 0.8 m at most (the bright core of the flame ends near 0.6 m, so players read the reach), never further.

---

### POPPER: Party popper on a base
`popper` · Fire & Boom · Class S · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A red striped party-popper cone standing in a graphite cup. Pull its string and it fires 200k confetti flakes and a puff of air.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.15 × 0.10 m (1×1.5×1) · origin: bottom centre |
| Mass · physics | 0.12 kg · phys `paper` · dynamic (it hops on pop) |
| Collision | `COL__cylinder__base` r 0.04, z 0–0.045 · `COL__hull__cone` (z 0.045–0.145) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base cup Ø 0.08 × 0.045 with 3 `kn_rubber` feet · signature: `kn_paper_red` cone (Ø 0.03 at z 0.05 → Ø 0.06 at z 0.14) with amber/graphite spiral stripe decal · accent: `kn_paper_tan` foil cap, `kn_rope` pull string Ø 2.5 mm, `kn_powder_bone` pull tab 20 × 12 mm |
| Ports | `PORT__tension__string` · in · PR-S · kind `hook` · (0, −0.041, 0.022) · faces −Y (on a flat boss on the cup front; the string exits through the socket) · pops at ≥ 4 N |
| Pivots | `PIVOT__tab` · y · 0 to −0.03 m · string + tab pull out on pop |
| Sensors | none |
| Emitters | `EMIT__confetti__mouth` (0, 0, 0.145), +X = +Z · `fx/confetti_burst`: 200k flakes at Ultra (25k / 50k / 100k by lower tier, vfx.md §3.4), 25° cone, brand palette, matte paper flutter · `EMIT__wind__mouth` same point · Air puff: 30° cone, 1.0 m, 0.15 s |
| LEDs / screens | none |
| States | armed (cap intact, string slack) · popped (cap tears open into petals, comic smoke ring (`fx/smoke_ring`), base hops) · spent · reset on Stop |
| Animation | shape key `sk_torn` (0 sealed → 1 petals open) |
| Fracture | none (one-shot) |
| Skins / variants | `classic` · `gold` (amber cone, graphite stripes) |
| Budget | LOD0 ≤ 2,200 tris · 1024² |
| Audio hooks | string_tug (creak) · pop (crisp bang) · confetti_flutter (scaled by count) · cap_tear |

**Read at a glance.** A striped red cone pointing up from a dark cup.
**Notes / don'ts.** Confetti colours come from the brand palette only. The cone axis is the puff axis: keep it exactly +Z. The POPPER is an Air puff only, not an explosive: no yield, no blast, no heat, so by itself it never pops Helios, snaps Lines or lights anything (its puff only pushes light bodies).

---

### SINGULARITY: Micro black-hole containment unit
`singularity` · Fire & Boom · Class L · Ship M5 · Inspired by (internal only): none (new, future)

**Concept.** The finale piece: a graphite containment cage with a pink gimbal of plasma rings spinning around a black bead in a clear shell. Armed, it opens the bead into a lensing singularity that pulls everything within 20 m into its recycle core over 6 s.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.20 m (2×2×2) · origin: bottom centre · core centre (0, 0, 0.115) |
| Mass · physics | 7 kg · phys `powder` · static · immune to its own field and to blasts |
| Collision | `COL__box__plinth` 0.20 × 0.20 × 0.05 · `COL__box__cap` 0.20 × 0.20 × 0.02 (z 0.18–0.20, with an open aperture) · `COL__cylinder__post_1…4` r 0.01 at (±0.085, ±0.085) · the core region is open so bodies can fly in |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth (z 0.004–0.05), 4 posts, top cap ring, `kn_rubber` feet · signature: `kn_anod_plasma` gimbal rings (outer Ø 0.15, inner Ø 0.12) + `kn_poly_plasma` containment shell Ø 0.08 · accent: core Ø 0.03 on `kn_led` driven pure black (emission 0), 4 `kn_copper` coil pods on the posts aimed inward, amber/graphite stripe band + explosive pictogram (#1) + name plate on the plinth front |
| Ports | `PORT__signal__arm` · in · PR-M · (0.06, −0.101, 0.027) · faces −Y |
| Pivots | `PIVOT__ring_outer` · z · continuous (0 → 6 rps on arm) · `PIVOT__ring_inner` · x · continuous (counter-spin) |
| Sensors | `SENSOR__field__core` sphere r 0.30 at the core (SIMULATION §5.12: bodies whose centre comes within 0.3 m are recycled, counted and despawned with implosion fx). The lensing disc hides the moment, and big Rollers never have to squeeze through the cage. Critters are never recycled: they're spat out with a comedic launch (SIMULATION §7.4). The device itself is immune |
| Emitters | `EMIT__field__core` (0, 0, 0.115) · 20 m pull field (Grav Well s = 40, radius in data) · `EMIT__lens__core` same point · `fx/singularity_lens`: black core Ø 0.05 → 0.3 m, Einstein ring 0.6 → 1.5 m · `EMIT__disk__core` · `fx/singularity_disk`, accretion particles in the inner-ring plane · `EMIT__vent__cap` (0, 0, 0.20), +X = +Z · steam after collapse |
| LEDs / screens | group 0 `containment` (coil pod tips) · group 1 `charge` (4 vertical bars on the posts' inner faces, fill during spin-up) · group 2 `status` · `SCREEN__countdown` `SCR_7SEG_2` with decimal point, field colour, (−0.045, −0.101, 0.027), graphite bezel + `kn_glass` cover ("6.0" → "0.0") |
| States | idle (rings still, dull bead, LEDs 8 %) · armed: the field runs for 6.0 s from the Signal tick (SIMULATION §5.12) · spin-up, the first 0.5 s (rings accelerate, bars fill, hum rises; matches the vfx core growth) · pull, to 6.0 s (lensing grows, accretion disk, debris streams in, countdown) · collapse at 6.0 s (implosion, rings snap-align and brake, comfort-capped 1-frame flash) · spent (core dim, cap vents for 3 s, screen "00") |
| Animation | procedural ring pivots + clip `singularity__collapse` (0.6 s: rings snap-align, posts shudder) |
| Fracture | none (finale piece; never destroyed or recycled) |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 16,000 tris · 2048² + 1024² detail |
| Audio hooks | arm_click · spin_up (rising whine) · pull_loop (sub-bass drone + reverse whoosh, scaled by captured mass) · recycle_pop (per body, rate-limited) · collapse (implosion + 150 ms silence) · vent_hiss |

**Read at a glance.** A dark cube cage with a pink gyroscope around a black bead. While it's active, the world bends around it.
**Notes / don'ts.** The engine disables shell refraction while lensing is active, to avoid double distortion. Keep ≤ 2 transparent layers in any sight line (shell only; the core is opaque). It's the "newer product line" family member: smooth, few fasteners (M3 only, 4 on the plinth front). No glowing eyes, skulls or space-horror cues.
