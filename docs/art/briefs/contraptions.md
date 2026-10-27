# Contraptions: asset briefs

Springs, launchers, traps and Goby's bowl (GAME_SPEC §12.7). Family look: Ignition + Bone, chrome springs.

Back to the [brief index, conventions and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| PUNCHLINE | `punchline` | M | M2 | brief |
| GOTCHA BOX | `gotcha_box` | L | M2 | brief |
| SNIPPER | `snipper` | M | M1 | brief |
| SNAPTRAP | `snaptrap` | M | M3 | brief |
| BONKER | `bonker` | M | M3 | brief |
| FLINGER | `flinger` | M | M3 | brief |
| WRECKER | `wrecker` | M | M3 | brief |
| PINGER | `pinger` | M | M3 | brief |
| PADDLE / BUMPER | `paddle`, `bumper` | M / S | M3 | brief |
| TOAST CANNON | `toast_cannon` | M | M4 | brief |
| FISHBOWL | `fishbowl` | L | M2 | brief |

**Family colour rule.** Bone is the neutral body (60 %) and Ignition marks the moving or hitting part (30 %). Springs are always `kn_chrome` and visible. No graphite powder on this family: a third powder would break the two-powders-plus-metal rule (ART_BIBLE §3.2). No hazard stripes or hazard pictograms (ART_BIBLE §6). Strike faces are oversized 1.3× and capped in `kn_rubber`.

---

### PUNCHLINE: Spring boxing glove
`punchline` · Contraptions · Class M · Ship M2 · Inspired by (internal only): Boxing glove

**Concept.** A cream housing with a clear top. Inside, a chrome spring launches a three-stage telescoping ram, punching an oversized orange glove 0.5 m. It's pure slapstick, and the spring you can see sells it.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.20 m (3×2×2), +0.50 m reach along +X · origin: bottom centre |
| Mass · physics | 4 kg · phys `powder` · static · glove rides a slider with a position motor (SIMULATION §4.4, PART_SYSTEM `slider_actuator`): peak 6 m/s, 2 kg moving mass |
| Collision | `COL__box__housing` 0.20 × 0.176 × 0.176 (x −0.15…0.05, z 0.004–0.18) · `COL__capsule__ram` r 0.012 (under `PIVOT__ram_1`) · `COL__sphere__glove` r 0.06 (under `PIVOT__glove`) |
| Materials (60/30/10) | neutral: `kn_powder_bone` housing (pillowed 10 mm radius, 0.176 tall so the part's bounds reach the 0.18 minimum height), `kn_rubber` feet, `kn_steel_brushed` M5 fasteners (4 per side) · signature: `kn_powder_ignition` glove Ø 0.12 (rest centre (0.10, 0, 0.09)), bone cuff · accent: `kn_poly_clear` window (top + upper front, x −0.13…0.03), `kn_chrome` spring Ø 0.05 and ram tubes, name plate on the cuff |
| Ports | `PORT__signal__trigger` · in · PR-M · (−0.10, −0.088, 0.06) · faces −Y (on the housing front face) |
| Pivots | `PIVOT__ram_1` · x · 0–0.17 m · `PIVOT__ram_2` (child) · x · 0–0.17 m · `PIVOT__glove` (child) · x · 0–0.16 m · timing: out 0.08 s (15 mm overshoot), hold 0.25 s, ratchet back 0.6 s |
| Sensors | none (impact comes from the motor-driven glove's contact) |
| Emitters | `EMIT__pow__glove` glove face (0.16, 0, 0.09), +X = +X · comic dust puff + 3 Amber impact stars on contact |
| LEDs / screens | group 0 `ready`: dome Ø 8 mm on the housing top rear |
| States | ready (spring wound behind the window) · punching · holding · retracting (ratchet) · blocked (port fault blink if the glove can't extend) |
| Animation | procedural pivots + spring shape key `sk_compress` (1 = wound) |
| Fracture | none |
| Skins / variants | `classic` · `champ` (bone glove, ignition cuff) |
| Budget | LOD0 ≈ 8,500 tris · 2048² |
| Audio hooks | trigger_click · punch_spring ("BOING-whap") · impact_pow (scaled) · retract_ratchet · blocked_thud |

**Read at a glance.** A cream box with a big orange glove on its nose.
**Notes / don'ts.** The glove is the silhouette: keep it 1.4× real scale. The ram tubes must look sturdy (≥ Ø 20 mm), never spindly. No laces or brand marks on the glove.

---

### GOTCHA BOX: Pop-up spring sprite box
`gotcha_box` · Contraptions · Class L · Ship M2 · Inspired by (internal only): Jack-in-the-box

**Concept.** A cream crank box with an orange lid. Crank it three turns (or whack it) and the lid flies open, and a grinning bone-white "Gotcha" sprite springs up on a chrome coil, lunges forward and bonks whatever is there.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.20 m (2×2×2) closed · origin: bottom centre · popped head top reaches z ≈ 0.47 upright (rest head centre ≤ z 0.11 under the lid + 0.30 spring + 0.055 head radius) |
| Mass · physics | 3 kg · phys `powder` · static · head is kinematic during the pop |
| Collision | `COL__box__box` 0.18 × 0.18 × 0.17 · `COL__box__lid` (under `PIVOT__lid`) · `COL__capsule__spring` (under `PIVOT__lean`) · `COL__sphere__head` r 0.055 (under `PIVOT__spring`) |
| Materials (60/30/10) | neutral: `kn_powder_bone` panels, `kn_rubber` feet, `kn_steel_brushed` M5 corner fasteners · signature: `kn_powder_ignition` lid, corner trims, crank knob, sprite nose and ruff collar · accent: `kn_chrome` spring, `kn_brass` music comb + pin drum seen through a `kn_poly_clear` front window (50 × 80 mm at x −0.08…−0.03), face decal (grin, glossy dark eyes) |
| Ports | `PORT__spin__crank` · in · PR-M · kind `axle` · (0.035, −0.091, 0.095) · faces −Y (the crank axle passes through the socket; arm 0.04, knob Ø 0.025; the knob's sweep, x −0.018…0.088, clears the window edge at x −0.03) |
| Pivots | `PIVOT__crank` · y · continuous · `PIVOT__drum` · y · continuous (geared 1:1) · `PIVOT__lid` · x at the back edge (0, 0.09, 0.174) · 0–115° · `PIVOT__lean` · x · 0 to +35° (tips the spring toward −Y) · `PIVOT__spring` · z · 0–0.30 m · `PIVOT__head` · y · ±25° wobble |
| Sensors | `SENSOR__impact__box` box hull inflated 5 mm · 1.0 N·s · `SENSOR__impact__lid` lid top · 0.5 N·s · pop also fires after 3 crank revolutions on Spin |
| Emitters | `EMIT__pop__lid` (0, 0, 0.19), +X = +Z · confetti puff + "!" pop billboard · `EMIT__pow__head` head front, +X = −Y · impact stars |
| LEDs / screens | group 0 `wind`: 3 LED dots above the window (one per crank turn) |
| States | closed (dots fill as you crank, tune plays) · pop (lid flies, sprite springs up and lunges) · wobbling (damped head wobble) · reset on Stop (lid closes over the compressed sprite) |
| Animation | clips `gotcha_box__pop` (0.6 s: overshoot + damped wobble) and `gotcha_box__reset` (0.4 s) + procedural pivots + spring shape key `sk_stretch` (0 compressed → 1 extended) |
| Fracture | none |
| Skins / variants | `classic` · `pumpkin` (ignition sprite head, bone collar) |
| Budget | LOD0 ≈ 14,000 tris · 2048² + 1024² detail (face decal) |
| Audio hooks | crank_ratchet loop · music_tune (original 8-note ditty on the comb) · pop_boing · head_wobble · impact_bonk · lid_slam (reset) |

**Read at a glance.** A cream cube with an orange lid and a crank on the front. Once it pops, a round white head on a shiny spring.
**Notes / don'ts.** The sprite is cheerful and round (head Ø 0.11, ignition nose, big grin), never a creepy clown: no sharp teeth, no tears, no smeared make-up. The crank is on the front so it reads in the ¾ view. The spring is ≥ Ø 0.05 and fully chrome.

---

### SNIPPER: Big scissors on a plinth
`snipper` · Contraptions · Class M · Ship M1 · Inspired by (internal only): Scissors

**Concept.** Oversized steel scissors lying open on a cream plinth, with orange finger loops and a visible chrome return spring. Signal them, or drop something on the handles, and they snap shut, cutting any Line, Band or Helio in the jaw.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.10 × 0.20 m (3×1×2) · origin: bottom centre · blades point +X |
| Mass · physics | 1.4 kg · phys `powder` (plinth), `steel` (blades) · static |
| Collision | `COL__box__plinth` 0.24 × 0.18 × 0.036 · `COL__box__post` · `COL__hull__half_a` / `COL__hull__half_b` (blade + opposite handle, 8 mm thick, under their pivots; blade edges tagged `sharp`, which pops Helios on contact) |
| Materials (60/30/10) | neutral: `kn_powder_bone` plinth (0.18 deep: the open loops reach y ±0.089, and a 0.16 plinth left the bounds under the 0.18 m minimum depth) with `kn_rubber` feet · `kn_steel_brushed` blades (0.13 long, tips at x 0.15, stacked at z 0.055 / 0.065, real bevelled edges) · signature: `kn_powder_ignition` finger loops (Ø 0.06 outer, reaching x −0.15) and pivot post at (0.02, 0, 0.036–0.07) · accent: `kn_chrome` torsion spring at the pivot, `kn_steel_brushed` M8 pivot screw (top z 0.085), name plate on the plinth front |
| Ports | `PORT__signal__close` · in · PR-S · (−0.06, −0.091, 0.02) · faces −Y (plinth front) |
| Pivots | `PIVOT__half_a` · z at (0.02, 0, 0.06) · 0 (closed) to +25° (open) · `PIVOT__half_b` · same axis · 0 to −25° · close 0.06 s, spring back open 0.4 s |
| Sensors | `SENSOR__trigger__jaw` wedge hull between the open blades, pivot to tips, z 0.045–0.075 (Lines, Bands and Helios inside or swept are cut) · `SENSOR__impact__handle` hull over the loops · 0.4 N·s → close |
| Emitters | `EMIT__snip__jaw` (0.10, 0, 0.06), +X = +X · fibre puff / Band snap fx / tiny steel glint |
| LEDs / screens | group 0 `ready`: dome Ø 6 mm on the post top |
| States | open (ready) · snip (blades shut) · reopen (spring) · cut feedback (whatever was cut whips away) |
| Animation | procedural pivots + spring shape key `sk_wind` |
| Fracture | none |
| Skins / variants | `classic` · `tailor` (bone loops, ignition plinth) |
| Budget | LOD0 ≈ 5,000 tris · 2048² |
| Audio hooks | snip ("shhk") · cut_rope (fibre twang) · cut_band (rubber snap) · spring_return · handle_hit |

**Read at a glance.** Open steel V-blades with two orange loops: unmistakably scissors from above or the ¾ view.
**Notes / don'ts.** Blade edges are the one place sharp wedges are allowed. Keep the jaw wedge sensor matched exactly to the open blade inner edges. Blades never point at the camera in the Library card (yaw 30°).

---

### SNAPTRAP: Fling trap
`snaptrap` · Contraptions · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A mousetrap-style oak board with a chrome snap bar and an orange payload cup. A touch on the pedal snaps the bar 180°, flinging whatever sits in the cup.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.05 × 0.10 m (2×0.5×1) · origin: bottom centre |
| Mass · physics | 0.15 kg · phys `wood` · dynamic (it hops on the snap) · bar tip speed 5 m/s |
| Collision | `COL__box__board` 0.20 × 0.10 × 0.012 · `COL__box__pedal` (under `PIVOT__pedal`) · `COL__hull__bar` bar + cup (under `PIVOT__bar`) |
| Materials (60/30/10) | neutral: `kn_wood_oak` board (z 0.003–0.015), `kn_rubber` corner pads (3 mm) · signature: `kn_powder_ignition` pedal plate 0.03 × 0.05 at (0.04, 0, 0.018) (x 0.025–0.055, clear of the landing cup) with grip dots, payload cup Ø 0.03 × 0.012 on the bar end · accent: `kn_chrome` snap bar (Ø 4 mm wire U-loop, 0.085 × 0.08), torsion springs Ø 0.012 at (0, ±0.035, 0.022), latch wire, `kn_powder_bone` name plate decal on the board end |
| Ports | none (purely mechanical, contact-triggered) |
| Pivots | `PIVOT__bar` · y at (0, 0, 0.022) · 0° (armed, lying on −X, cup at x −0.08) to 175° (sprung, on +X: the upturned cup's rim lands on the board at x ≈ 0.08; a full 180° would drive the 14 mm cup into the board) · snap 0.03 s · `PIVOT__latch` · y · 0–35° · `PIVOT__pedal` · y · −6° to 0° |
| Sensors | `SENSOR__trigger__pedal` box 0.035 × 0.055 × 0.02 over the pedal · 0.03 kg pressure or 0.03 N·s impact |
| Emitters | `EMIT__snap__bar` (0, 0, 0.03), +X = +Z · wood dust puff + motion streak |
| LEDs / screens | none |
| States | armed (bar back, latch on) · sprung (bar slammed on the +X side, springs quiver, payload in flight) · reset on Stop |
| Animation | procedural pivots + spring shape key `sk_wind` (1 = wound) |
| Fracture | none |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 3,500 tris · 2048² (oak bake) |
| Audio hooks | arm_creak (reset) · snap (sharp SNAP) · fling_whoosh · bar_slam (wood clack) · spring_quiver |

**Read at a glance.** A wooden board with a shiny wire loop and an orange cup.
**Notes / don'ts.** No cheese, no bait and no mouse imagery: critters are never trapped or hurt by it. The bar must clear the pedal by 3 mm when sprung.

---

### BONKER: Hinged mallet
`bonker` · Contraptions · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** An oak-handled mallet with a fat orange head, standing upright on a cream hinge block. On Signal it swings forward and bonks the floor zone in front of it.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.40 × 0.10 m (1×4×1) · origin: hinge axis centre, 0.05 above the floor (floor z −0.05, head top z 0.35) |
| Mass · physics | 1.6 kg · phys `powder` · static base + arm on a motorised hinge (SIMULATION §4.4) · head tip 5 m/s |
| Collision | `COL__box__base` 0.10 × 0.10 × 0.07 · `COL__capsule__handle` r 0.011 · `COL__cylinder__head` r 0.04, 0.10 long on Y (handle and head under `PIVOT__arm`) |
| Materials (60/30/10) | neutral: `kn_powder_bone` hinge block with clevis yoke, `kn_rubber` feet · signature: `kn_powder_ignition` head Ø 0.08 × 0.10 (axis Y, centre z 0.31) · accent: `kn_wood_oak` handle Ø 0.022, `kn_rubber` strike caps on both head faces, `kn_chrome` torsion springs either side of the yoke, `kn_steel_brushed` hinge pin |
| Ports | `PORT__signal__swing` · in · PR-S · (0, −0.051, −0.015) · faces −Y |
| Pivots | `PIVOT__arm` · x · 0° (upright) to +100° (toward −Y; stops on contact) · strike 0.12 s, hold 0.2 s, return 0.5 s |
| Sensors | none (the driven head's contact) |
| Emitters | `EMIT__pow__head` strike face (0, −0.05, 0.31), +X = −Y · dust puff + Amber stars |
| LEDs / screens | group 0 `ready`: dome on the block top |
| States | ready (upright) · swinging · bonk (hold) · returning |
| Animation | procedural pivot + spring shape key `sk_wind` |
| Fracture | none |
| Skins / variants | `classic` · `carnival` (bone head, ignition handle bands) |
| Budget | LOD0 ≈ 4,000 tris · 2048² |
| Audio hooks | trigger_click · swing_whoosh · bonk (rubber thock) · return_creak |

**Read at a glance.** A tall stick with a fat orange drum on top: a mallet.
**Notes / don'ts.** The strike zone is 0.25–0.35 m in front of the hinge; keep the head rubber caps facing ±Y exactly. Handle ≥ Ø 22 mm.

---

### FLINGER: Torsion catapult
`flinger` · Contraptions · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A cream A-frame catapult with an oak arm, an orange cup and a fat chrome torsion spring. An adjustable padded stop bar sets the launch angle from 30° to 70°.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.40 × 0.30 × 0.30 m (4×3×3) cocked · origin: bottom centre · throws +X |
| Mass · physics | 5 kg · phys `powder` · static · payload ≤ 3 kg |
| Collision | `COL__box__base` · `COL__box__plate_l` / `COL__box__plate_r` (y ±0.13) · `COL__box__stop` (under `PIVOT__stop`) · `COL__box__arm` + `COL__hull__cup_floor` + `COL__hull__cup_rim_1…4` (under `PIVOT__arm`) = 10 shapes |
| Materials (60/30/10) | neutral: `kn_powder_bone` base rails (0.045 tall, under the side plates, leaving the centre open for the cocked cup) and side plates (15 mm, apex z ≈ 0.29), `kn_rubber` feet, `kn_steel_brushed` axle + M5 fasteners · signature: `kn_powder_ignition` cup (Ø 0.09, 0.035 deep) and stop-bar pads · accent: `kn_wood_oak` arm (0.04 × 0.03, cup centre 0.20 from the axle), `kn_chrome` torsion spring Ø 0.06 on the axle |
| Ports | `PORT__signal__release` · in · PR-M · (−0.12, −0.138, 0.07) · faces −Y · `PORT__tension__trigger` · in · PR-M · kind `hook` · (−0.04, −0.138, 0.07) · faces −Y (both on the front plate) |
| Pivots | `PIVOT__arm` · y at (0.04, 0, 0.12) · θ from vertical, negative toward −X · −105° (cocked: arm 15° below horizontal, cup centre (−0.153, 0, 0.068), between the side plates) to θ_stop · fire 0.12 s · `PIVOT__stop` · y · sets θ_stop from −70° to −30° (the payload leaves along the cup's tangent, so launch elevation = −θ_stop = 70°–30°; set in Build) · `PIVOT__latch` · y · 0–30° |
| Sensors | `SENSOR__catch__cup` cylinder r 0.04 × 0.04 inside the cup (reports the loaded payload) |
| Emitters | `EMIT__launch__cup` cup centre, +X = arm tangent · motion streak + dust puff from the stop bar |
| LEDs / screens | group 0 `ready`: dome on the front plate apex |
| States | cocked (spring wound, cup back) · released (arm whips, slams the stop bar) · spent (arm resting on the stop) · reset on Stop |
| Animation | procedural pivots + spring shape key `sk_wind` |
| Fracture | none |
| Skins / variants | `classic` · `castle` (`kn_wood_walnut` arm, bone cup) |
| Budget | LOD0 ≈ 9,000 tris · 2048² |
| Audio hooks | latch_release · arm_whoosh · stop_slam (padded thunk) · spring_twang · reset_ratchet |

**Read at a glance.** An A-frame with a long arm ending in an orange cup.
**Notes / don'ts.** The stop bar rides a visible arc slot in both side plates, behind and above the axle (it meets the arm at r ≈ 0.12: (−0.073, 0.161) for 70°, (−0.02, 0.224) for 30°), so the angle is readable. A stop past vertical would throw the payload downward: the tangent at θ points at elevation −θ. The arm swings past the 0.30 m height during the run (cup up to z ≈ 0.34 at θ −30°); bounds are validated cocked.

---

### WRECKER: Wrecking ball
`wrecker` · Contraptions · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A 20 kg cream-and-orange ball with a chrome swivel shackle on top, hung from a chain Line. Swing it into anything.

| Spec | Value |
|---|---|
| Size (W×H×D) | Ø 0.19 ball + shackle to z 0.115: 0.19 × 0.21 × 0.19 m (⌀2) · origin: centre of mass = ball centre (free body) · plus a standard LINE (CHAIN variant, default 2.0 m; briefed in drive.md) |
| Mass · physics | 20 kg · phys `steel` · restitution 0.1, friction 0.5 |
| Collision | `COL__sphere__ball` r 0.095 |
| Materials (60/30/10) | neutral: `kn_powder_bone` ball shell with 4 meridian panel lines (0.8 mm) · signature: `kn_powder_ignition` equator band (40 mm) + top boss Ø 0.07 · accent: `kn_chrome` D-shackle (Ø 8 mm stock), "20 KG" spec decal, name plate decal on the band |
| Ports | `PORT__tension__hook` · both · PR-M · kind `hook` · (0, 0, 0.097) · faces +Z (the shackle rises through the socket) |
| Pivots | `PIVOT__swivel` · z · continuous (shackle follows the Line direction, cosmetic) |
| Sensors | none |
| Emitters | `EMIT__dust__contact` (engine places it at each contact point) · `fx/dust_kick` on heavy impacts (≥ 20 N·s), `fx/grind_spark` on steel sliding contacts, `fx/debris_micro` from whatever breaks |
| LEDs / screens | none |
| States | hanging · swinging (motion blur) · impact · resting / rolling |
| Animation | procedural swivel only |
| Fracture | none |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 4,000 tris · masters + decal atlas |
| Audio hooks | swing_whoosh (speed-scaled) · impact_heavy (by material hit) · shackle_rattle · roll_rumble · chain_clank (Line) |

**Read at a glance.** A big pale ball with an orange belt and a shiny loop on top.
**Notes / don'ts.** Must never be confused with THUD (a graphite ball with an orange band and finger holes): the Wrecker is bone, has no holes, and always has the shackle. The ball is Ø 0.19 so the shackle fits inside the 0.02 m tolerance.

---

### PINGER: Spring plunger
`pinger` · Contraptions · Class M · Ship M3 · Inspired by (internal only): none (new)

**Concept.** A pinball plunger in a clear tube on a cream rail. On Signal the orange knob draws back, compressing the chrome spring you can see, then the striker fires forward.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.30 m (1×1×3) · origin: bottom centre · fires −Y |
| Mass · physics | 0.9 kg · phys `powder` · static · striker tip 4 m/s, 0.5 kg effective mass |
| Collision | `COL__box__rail` 0.08 × 0.26 × 0.02 · `COL__box__block_front` / `COL__box__block_rear` · `COL__cylinder__tube` r 0.025 along Y · `COL__cylinder__striker` r 0.0175 (under `PIVOT__plunger`) |
| Materials (60/30/10) | neutral: `kn_powder_bone` rail (z 0.004–0.024) and end blocks (0.08 wide × 0.08 tall, z 0.015–0.095; front block 0.036 deep at y −0.156…−0.12 so its top carries the 35 mm port land, rear block 0.03 deep at y +0.10…+0.13), `kn_rubber` feet · signature: `kn_powder_ignition` striker head Ø 0.035 (rubber face) and rear knob Ø 0.04 · accent: `kn_poly_clear` tube Ø 0.05 (y −0.12…+0.10, z 0.055), `kn_chrome` spring Ø 0.04 + rod Ø 0.01 |
| Ports | `PORT__signal__fire` · in · PR-S · (0, −0.138, 0.095) · faces +Z (centred on the front block top) |
| Pivots | `PIVOT__plunger` · y · +0.06 (cocked) / 0 (rest) / −0.04 (struck) · retract 0.18 s, fire 0.02 s, settle 0.3 s |
| Sensors | none |
| Emitters | `EMIT__pow__tip` (0, −0.16, 0.055), +X = −Y · contact puff |
| LEDs / screens | group 0 `ready`: dome on the rear block top |
| States | rest · cocking (knob slides back, spring compresses) · strike · settle |
| Animation | procedural pivot + spring shape key `sk_compress` |
| Fracture | none |
| Skins / variants | `classic` only |
| Budget | LOD0 ≈ 4,500 tris · 2048² |
| Audio hooks | cock_ratchet · release_ping · strike_thock · settle_rattle |

**Read at a glance.** A clear tube with a coil inside and an orange knob on each end.
**Notes / don'ts.** The 0.18 s anticipation is part of the read; don't cut it. The spring fills the tube's full length.

---

### PADDLE / BUMPER: Pinball flipper and pop bumper
`paddle` (M) · `bumper` (S) · Contraptions · Class M / S · Ship M3 · Inspired by (internal only): none (new)

**Concept.** Two pinball pieces in one brief and two `.blend` files. PADDLE is an orange rubber-rimmed flipper bat that swings on Signal. BUMPER is a round orange body with a lit clear cap that kicks away anything that touches it.

| Spec | Value |
|---|---|
| Size (W×H×D) | Paddle: 0.30 × 0.10 × 0.10 m (3×1×1) · origin: hinge axis centre (hinge at the bat's −X end, mid-thickness; floor z −0.06) · bounds at rest (−15°): x −0.035…0.252, y −0.077…0.035, z −0.06…0.025 · Bumper: Ø 0.15 × 0.10 m (⌀1.5 × 1) · origin: bottom centre |
| Mass · physics | Paddle 0.8 kg, Bumper 0.6 kg · phys `powder` · static · Paddle: static base + bat on a motorised hinge (SIMULATION §4.4), bat rim restitution 0.7 · Bumper: band restitution 1.2, active (SIMULATION §4.3), so the kick scales with what hits it; the ring snap is visual |
| Collision | Paddle: `COL__cylinder__base`, `COL__hull__bat` (under `PIVOT__bat`) · Bumper: `COL__cylinder__skirt` r 0.075 × 0.032, `COL__cylinder__body` r 0.06, z 0.03–0.07 |
| Materials (60/30/10) | neutral: `kn_powder_bone` paddle base puck (Ø 0.07 × 0.045) and bumper skirt, `kn_rubber` feet · signature: `kn_powder_ignition` bat (0.29 long, Ø 0.06 hub → 0.025 tip, hub-to-tip centres 0.2475, 0.03 thick, chrome hub cap to z 0.025) and bumper body · accent: `kn_rubber` rim on the bat edge and band around the bumper (8 mm), `kn_chrome` kicker ring and hub cap, `kn_poly_clear` bumper dome (Ø 0.09, z 0.07–0.10) |
| Ports | Paddle: `PORT__signal__flip` · in · PR-S · (0, −0.036, −0.037) · faces −Y (flat boss on the puck front) · Bumper: `PORT__signal__kick` · in · PR-S · (0, −0.076, 0.019) · faces −Y (flat boss on the skirt) |
| Pivots | Paddle: `PIVOT__bat` · z · −15° (rest) to +30° · flip 0.05 s, hold while signalled + 0.3 s, return 0.15 s · Bumper: `PIVOT__ring` · z · −0.012 to 0 m (kick 0.03 s, visual) |
| Sensors | Bumper: `SENSOR__trigger__skirt` ring volume r 0.055–0.08, z 0.03–0.07 · 0.05 N·s → kick animation + flash · cooldown 0.1 s · Paddle: none (the driven bat's contact) |
| Emitters | Paddle: `EMIT__flip__bat` bat face mid, +X = bat normal · flick streak · Bumper: `EMIT__flash__cap` (0, 0, 0.10), +X = +Z · light pop + sparkle ring |
| LEDs / screens | Paddle: none · Bumper: group 0 `cap` (`kn_led` star under the dome; 25 % idle, 100 % flash for 0.1 s on kick) |
| States | Paddle: rest · flipped (hold) · returning · Bumper: idle (soft glow) · kick (ring snaps down, cap flash, body pulse) · cooldown |
| Animation | procedural pivots only |
| Fracture | none |
| Skins / variants | `classic` · `retro` (bone bat / bone body with ignition rim) |
| Budget | Paddle LOD0 ≈ 3,500 tris · 2048² · Bumper LOD0 ≈ 2,500 tris · 1024² |
| Audio hooks | Paddle: flip_clack · return_tick · bat_hit (rubber thwack) · Bumper: bumper_pop (electro "bonk-ding") · kick_snap |

**Read at a glance.** Paddle: an orange teardrop bat on a puck. Bumper: an orange drum with a glowing clear dome.
**Notes / don'ts.** One brief, two type_ids (`paddle`, `bumper`), because one `.blend` holds exactly one part (ASSET_PIPELINE §3.3). The paddle rests at −15° so its bounds fill 3×1 (0.287 × 0.112 m). At −25° the tip would overhang the 0.12 m depth limit by 20–30 mm, and a 0.26 bat at 0° falls short of the 0.28 m minimum length. No pinball brand art or score text.

---

### TOAST CANNON: Launching toaster
`toast_cannon` · Contraptions · Class M · Ship M4 · Inspired by (internal only): none (new)

**Concept.** A pillowy cream toaster with an orange lever and browning dial. Power it, and 3 s later it pops two toast slices into the air with a ding. Its glowing elements show through a front window.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.10 m (2×2×1) · origin: bottom centre |
| Mass · physics | 1.5 kg · phys `powder` · static · Power consumer 200 W, needs supply factor ≥ 0.75 (SIMULATION §5.5) · slices: 2 bodies, 0.03 kg each, phys `paper`, launched +Z at 3.0 m/s (≈ 0.46 m rise) |
| Collision | `COL__box__body` 0.19 × 0.095 × 0.16 · slices `COL__box__slice` 0.09 × 0.012 × 0.10 each |
| Materials (60/30/10) | neutral: `kn_powder_bone` shell (20 mm pillow radius, z 0.004–0.164), `kn_rubber` feet · signature: `kn_powder_ignition` lever knob (0.03 × 0.02 × 0.015, exaggerated), dial knob, side band · accent: `kn_poly_amber` window (x −0.015…0.045, z 0.06–0.13), `kn_copper` element coils, toast slices `kn_paper_tan` faces + `kn_cardboard` crust |
| Ports | `PORT__power__in` · in · PR-S · (−0.06, −0.048, 0.045) · faces −Y |
| Pivots | `PIVOT__carriage` · z · −0.07 to +0.015 m · `PIVOT__lever` · z · −0.06 to 0 m (lever slot at x 0.075, front face) · `PIVOT__dial` · y · 0–270° over the 3 s cycle |
| Sensors | none |
| Emitters | `EMIT__launch__slot_a` (0, −0.022, 0.165) and `EMIT__launch__slot_b` (0, 0.022, 0.165), +X = +Z · slice spawn + crumb burst · `EMIT__smoke__slots` (0, 0, 0.165) · toast wisps, pop puff (`fx/smoke_puff`) |
| LEDs / screens | group 0 `progress`: 3 dots around the dial (fill over 3 s) · group 1 `elements`: `kn_led` on the element coils, ember-orange ramp 0 → 100 % |
| States | idle (two slices peeking 20 mm above the slots, so the part's bounds reach z 0.184, inside the 0.18–0.22 height tolerance) · toasting (lever down, elements glow, tick, wisps) · launch (POP + ding, slices fly) · cooling (glow fades over 1 s). Each rising power edge starts one cycle with 2 fresh slices; slices from older cycles despawn beyond 6 live. |
| Animation | procedural pivots only |
| Fracture | none |
| Skins / variants | `classic` · `chrome-diner` (`kn_steel_brushed` shell panels, ignition band) |
| Budget | LOD0 ≈ 6,000 tris · 2048² |
| Audio hooks | lever_down (clunk-latch) · toasting_tick loop · element_hum · pop_ding · slice_flutter · slice_land |

**Read at a glance.** A rounded cream box with two slots and bread sticking out.
**Notes / don'ts.** Slices are golden and cartoon-perfect: no burnt-black toast. No real appliance brand cues. Slots run along X so the slices launch side by side.

---

### FISHBOWL: Goby's glass bowl
`fishbowl` · Contraptions · Class L · Ship M2 · Inspired by (internal only): Fishbowl

**Concept.** A round glass bowl of beam-clear water on a cream cradle, with orange-and-cream gravel and a little arch. Goby swims inside. A hard enough hit shatters it into curved shards and dumps the water as real Matter.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.30 × 0.30 m (3×3×3) · origin: bottom centre · bowl sphere R 0.15 centred (0, 0, 0.15), cut flat at z 0.02 (Ø 0.15) and open at z 0.285 (Ø 0.13 with 6 mm rolled lip) |
| Mass · physics | 15.0 kg (2.7 glass + 0.6 cradle + 11.7 water) · phys `glass` · dynamic (heavy) · restitution 0.1 · glass: 4 mm shell from z 0.02 to 0.285 + base disc ≈ 1.06 L × 2,500 kg/m³ ≈ 2.6 kg, plus the rolled lip |
| Collision | `COL__hull__bowl` (64 verts, outer) · `COL__cylinder__cradle` r 0.09, z 0–0.025 |
| Materials (60/30/10) | neutral: `kn_glass` bowl (4 mm wall), `kn_powder_bone` cradle ring with 4 `kn_rubber` feet · signature: water in the container-fill pass (`CAVITY__water`, `matter = water`, ASSET_PIPELINE §3.10) + `kn_powder_ignition` gravel (40 rounded pebbles mixed with bone ones, bed z 0.024–0.04 on the inner glass floor) · accent: `kn_powder_bone` arch ornament (decorative, 60 × 45 mm; Goby, 0.055 m tall, swims over it, never through) standing on the gravel at (0.07, 0, 0.04), top z 0.085, 11 mm under the swim volume there, name plate on the cradle front |
| Ports | none (Impact is resolved by contact) |
| Pivots | none |
| Sensors | `SENSOR__impact__bowl` bowl hull · breakable: a single hit ≥ 1.5 N·s (`jBreak`), or blast damage ≥ 1 (`hp` 1). Blast damage is `D = 60·Y·e / max(r, 0.15)²` (SIMULATION §6.1), which is ≥ 40 at the edge of any blast radius, so any blast that reaches the bowl breaks it · `SENSOR__intake__top` cylinder r 0.06, z 0.27–0.29 (Matter water poured in raises the level; above full it overflows at the lip) · `SENSOR__catch__swim` ellipsoid hull 0.20 × 0.20 × 0.15 centred (0, 0, 0.15), z 0.075–0.225, custom property `critter = goby` (Goby's swim volume: ≥ 20 mm from the glass, 25 mm under the surface) |
| Emitters | `EMIT__burst__water` (0, 0, 0.14), +X = +Z · on break, converts the ≈ 11.7 L under the level plane into Matter water at 1.2 m/s outward. The bowl ships in M2 with a no-Matter fallback: with `matterGameplay` off, or before Matter water arrives in M4, the burst is a cosmetic Spectacle `fx/water_splash` (plus the GAME_SPEC §6.4 CPU stream-packet fallback) and Goby still flops · `EMIT__spout__lip` (0, −0.065, 0.285), +X = −Y · overflow · `EMIT__bubbles__surface` (0, 0, 0.25) · idle bubbles |
| LEDs / screens | none |
| States | intact (surface shimmer, floor caustics, Goby swimming) · sloshing (bumped below threshold: surface wave, ripples, drops over the lip if the wave tops 60 %) · shattered (shards + water burst; Goby flops out for 8 s, a Lure for Mochi, then bubble-rescue, see critters.md) · empty cradle |
| Animation | water surface is engine-driven: world-space level plane at z 0.25 (fill ≈ 0.93 of the 12.5 L capacity to the lip; 0.85 is only the height fraction) with slosh and ripples · no clips |
| Fracture | 21 chunks: `FRAC__01–18` curved glass shards (30–90 mm, larger toward the base, radial split pattern; the engine yaws the set so the small shards face the impact) · `FRAC__19` base disc with a 25 mm wall stub · `FRAC__20–21` lip ring halves · inner faces `kn_interior_glass` · gravel spills as Spectacle debris · cradle survives |
| Skins / variants | `classic` · `tropical` (beam + bone gravel) |
| Budget | LOD0 ≈ 15,000 tris · 2048² + 1024² detail · ≤ 2 transparent layers (glass + water); nothing transparent behind it in the bowl |
| Audio hooks | bubble_loop · slosh · glass_clink (light hits) · shatter (hero glass + water whoosh) · water_splash · overflow_trickle |

**Read at a glance.** A clear ball of water with an orange fish and orange gravel on a cream ring.
**Notes / don'ts.** Goby is briefed in critters.md: the swim volume must clear the arch and gravel (the arch is decorative, not a swim-through), and Goby is never shown hurt (an 8 s comic flop, then bubble rescue). Water is never baked: it's always the engine fill plane while intact, and Matter after the break. Shards are curved, readable pieces, not dust.
