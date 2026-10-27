# Air briefs

Fans, bellows and blowers from [GAME_SPEC §12.4](../../../GAME_SPEC.md): Bone and Beam housings with amber-tinted poly blades.
Back to the [brief index and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| GALE | `gale` | M | M1 | brief |
| PUFFER | `puffer` | M | M2 | brief |
| BLOWOUT | `blowout` | M | M4 | brief |
| VAC | `vac` | M | M4 | brief |
| INFLATOR | `inflator` | M | M4 | brief |

---

### GALE: Desk fan
`gale` · Air · Class M · Ship M1 · Inspired by (internal only): fan

**Concept.** The approved look-dev GALE: a round fan head on a short steel stalk, with a thick ring housing, a steel front grill (3 rings + 10 spokes) and five amber poly blades round a domed hub. It's re-coloured into the Air family (Bone and Beam) and scaled to fit 2×2×1.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.10 m (2×2×1) · origin: bottom centre. Housing ring torus R 0.0665, r 0.0085 (outer Ø 0.15) at head centre (0, −0.005, 0.122), axis Y; base drum Ø 0.095 × 0.03; steel stem Ø 0.012 at y 0.022 rising to the motor pod (Ø 0.044 × 0.045) behind the head |
| Mass · physics | 0.9 kg · `powder`, `rubber` foot ring |
| Collision | `COL__cylinder__base`, `COL__capsule__stem`, `COL__cylinder__head` (r 0.075, 0.035 deep, axis Y) |
| Materials (60/30/10) | neutral: `kn_powder_bone` base, pod and hub, `kn_steel_brushed` stem and grill, `kn_rubber` foot ring · signature: `kn_powder_beam` housing ring · accent: `kn_poly_amber` blades (5 × 0.046 × 0.022 × 0.003, 25° pitch), `kn_led`, `kn_decal` name plate on the pod |
| Ports | `PORT__power__in` · in · S · (0, −0.048, 0.019) · facing (0, −0.99, 0.15), tilted up as in the look-dev, on a flat facet of the base front |
| Pivots | `PIVOT__rotor` · axis y · unlimited · blades + hub |
| Sensors | none |
| Emitters | `EMIT__wind__front` · (0, −0.015, 0.122) · +X = −Y · wind cone, length 6 m (half-angle owned by the engine) |
| LEDs / screens | `led_groups = "0:status"`: Ø 6 mm dome on the pod top at (0, 0.024, 0.146); power colour when running |
| States | off: blades still, LED 8 % · running: blades blur into an amber disc, LED 100 %, port flowing |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Air (Bone + Beam, default) · Classic (look-dev colours: `kn_powder_graphite` base/pod/hub + `kn_powder_ignition` housing) |
| Budget | 6,000 tris · 2048² + blade thickness map. LOD2 blades → one amber disc; LOD3 opaque |
| Audio hooks | `fan_hum_loop` (pitch ∝ rpm), `fan_air_rush_loop`, `fan_spinup`, `fan_spindown`, `fan_power_click` |

**Read at a glance.** A round head with a cyan ring and a glowing amber blade disc on a little stalk.
**Notes / don'ts.** Keep the look-dev construction exactly: a torus housing, not a box shroud; front grill only; and the stem visible between base and head (≥ 30 mm). The blade disc must face −Y. Never more than the grill plus blades in one sight line (2 layers).

---

### PUFFER: Spring bellows
`puffer` · Air · Class M · Ship M2 · Inspired by (internal only): bellows

**Concept.** A chunky fireside bellows lying on its belly. Drop something on the grippy top pad and it whumps out a puff of air from the steel nozzle; the harder the hit, the bigger the puff. A visible chrome spring pops it back open.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.20 m (3×2×2) · origin: bottom centre. Bottom board x −0.14…0.10, z 0.004–0.026; hinge pin (0.10, 0, 0.09) along Y; top board 0.24 × 0.18 × 0.02 opening 18° at rest; nozzle tip (0.15, 0, 0.055) |
| Mass · physics | 1.6 kg · boards `powder`, pleats and feet `rubber` |
| Collision | `COL__box__base`, `COL__hull__lid` (under the lid pivot), `COL__hull__nozzle` |
| Materials (60/30/10) | neutral: `kn_powder_bone` bottom board and nozzle block, `kn_rubber` pleated sides (4 pleats) and feet, `kn_steel_brushed` nozzle cone · signature: `kn_powder_beam` top board · accent: `kn_rubber_grip` strike pad (0.12 × 0.12) and handles, `kn_chrome` spring, `kn_brass` hinge pin, `kn_led`, `kn_decal` name plate on the nozzle block |
| Ports | none (impact in through the pad, air out through the nozzle emitter) |
| Pivots | `PIVOT__lid` · axis y at the hinge · 0 … −14° (closed) · top board, pad, upper handle |
| Sensors | `SENSOR__trigger__pad` · threshold 0.02 N·s · cooldown 0.15 s · box 0.12 × 0.12 × 0.02 above the pad (puff strength ∝ impulse; an impulse threshold makes it a `trigger`, not a kg-rated `pressure` sensor, ASSET_PIPELINE §3.5) |
| Emitters | `EMIT__wind__nozzle` · (0.15, 0, 0.055) · +X · puff cone, 1.5 m impulse (SIMULATION §5.8) |
| LEDs / screens | `led_groups = "0:puff"`: LED band on the nozzle collar (air colour), flashes on each puff |
| States | open (rest) · squeezed: lid snaps down by an amount ∝ impulse, pleats collapse, puff · recovering: spring reopens it over 0.6 s |
| Animation | procedural lid; shape keys `sk_squash` (pleats) and `sk_spring` (coil), both driven by the lid angle; baked clip `puffer__squeeze` (0.35 s pleat wobble and nozzle flutter, layered on release) |
| Fracture | none |
| Skins / variants | Air (default) · Workshop (`kn_wood_oak` boards) |
| Budget | 7,000 tris · 2048² |
| Audio hooks | `bellows_whoomph` (gain ∝ impulse), `pleat_creak`, `spring_return_boing`, `nozzle_whistle` (strong puffs only) |

**Read at a glance.** A cyan-topped wedge with black accordion sides and a steel spout.
**Notes / don'ts.** Pleats are quads and deform cleanly through `sk_squash`. The strike pad must be the obvious "hit me" target. No leather texture: it's moulded rubber.

---

### BLOWOUT: Hot-air blower
`blowout` · Air · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A retro-futurist hair dryer standing in a little dock. A clear amber window shows the copper heater coil glowing, an amber fan spins behind the rear grille, and a Beam concentrator nozzle pushes hot air.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.10 m (2×2×1) · origin: bottom centre. Dock 0.12 × 0.09 × 0.045; handle leaning 10°; barrel Ø 0.085 along X from x −0.09 to 0.045 at z 0.15; nozzle x 0.045–0.10 flattening to a 0.07 × 0.03 slot |
| Mass · physics | 0.9 kg · `powder`, `rubber` feet |
| Collision | `COL__box__dock`, `COL__capsule__handle`, `COL__cylinder__barrel`, `COL__box__nozzle` |
| Materials (60/30/10) | neutral: `kn_powder_bone` barrel, handle and dock, `kn_steel_brushed` rear grille and M3 screws, `kn_rubber` feet · signature: `kn_powder_beam` nozzle and handle slider · accent: `kn_poly_amber` heater window (x −0.04…0.0) and fan blades (6), `kn_copper` heater coil, `kn_rubber_grip` handle inlay, `kn_led`, `kn_decal` name plate and hot-surface pictogram on the nozzle top |
| Ports | `PORT__power__in` · in · S · (0, −0.046, 0.027) · −Y (dock front; PR-S because a 42 mm ring overruns the 45 mm dock) |
| Pivots | `PIVOT__fan` · axis x · unlimited · rear fan behind the grille |
| Sensors | none |
| Emitters | `EMIT__wind__nozzle` · (0.10, 0, 0.15) · +X · wind cone, 2 m (SIMULATION §5.8). `EMIT__heat__nozzle` · same point · +X · heat cone (same 2 m). `EMIT__haze__nozzle` · same point · heat-shimmer VFX |
| LEDs / screens | `led_groups = "0:heater,1:status"`: LED faces on the heater coil (heat colour, ramps up over 0.5 s); status dome on the handle top (power colour) |
| States | off · on: fan spins, coil glows, shimmer at the nozzle, port flowing · cooling: coil fades over 2 s after power stops |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Air (default) · Graphite (`kn_powder_graphite` body) |
| Budget | 7,500 tris · 2048² |
| Audio hooks | `dryer_whine_loop`, `dryer_air_rush_loop`, `heater_cool_tick`, `dryer_power_click` |

**Read at a glance.** A bone pistol-shape dryer with a cyan snout and a glowing orange window.
**Notes / don'ts.** It must not read as a gun: a rounded barrel, a thick handle dropping into a dock, no trigger guard, and the nozzle visibly flared. The hot-surface pictogram is the only warning label; no hazard stripes (not allowed on Air).

---

### VAC: Suction nozzle
`vac` · Air · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A long bone suction tube with a flared Beam mouth and a rubber lip. A clear window shows an amber impeller whirling, and an LED ring inside the mouth glows when it's sucking. Light things get pulled in and stick to the grille.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.30 m (1×1×3) · origin: bottom centre. Tube Ø 0.08 along Y, centre z 0.052; mouth flare Ø 0.094 at y −0.15…−0.115; impeller window y −0.11…−0.05; motor section y −0.03…0.15 with a flat top boss at z 0.095 |
| Mass · physics | 1.1 kg · `powder`, `rubber` lip and feet |
| Collision | `COL__cylinder__tube` (axis Y), `COL__cylinder__mouth`, `COL__box__cradle` |
| Materials (60/30/10) | neutral: `kn_powder_bone` tube and cradle, `kn_steel_brushed` mouth grille and rear grille, `kn_rubber` lip and feet · signature: `kn_powder_beam` mouth flare and rear cap ring · accent: `kn_poly_clear` window, `kn_poly_amber` impeller (7 blades), `kn_led`, `kn_decal` name plate on the motor section side |
| Ports | `PORT__power__in` · in · M · (0, 0.080, 0.095) · +Z (top boss) |
| Pivots | `PIVOT__impeller` · axis y · unlimited · impeller at (0, −0.08, 0.052) |
| Sensors | `SENSOR__intake__mouth` · cylinder Ø 0.07 × 0.03 at (0, −0.135, 0.052) · bodies that touch it get the hold flag while powered (gameplay sets the mass limit) |
| Emitters | `EMIT__wind__mouth` · (0, −0.15, 0.052) · +X = −Y (out of the mouth); the engine applies inward flow along this axis in a 1.5 m inverted cone (SIMULATION §5.8). `EMIT__exhaust__rear` · (0, 0.15, 0.052) · +Y · cosmetic exhaust puff |
| LEDs / screens | `led_groups = "0:status,1:mouth_ring"`: status dome beside the port; LED ring inside the flare (air colour) |
| States | off · running: impeller blur, mouth ring on, dust motes drawn inward · clogged (body held on the grille): impeller labours, ring pulses |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Air (default) · Graphite (`kn_powder_graphite` tube) |
| Budget | 6,000 tris · 2048² |
| Audio hooks | `vac_suction_loop`, `vac_clog_whine` (pitch up), `vac_grab_thwup`, `vac_release_pop` |

**Read at a glance.** A pale tube with a cyan trumpet mouth that glows inside.
**Notes / don'ts.** The mouth faces −Y so players see the glowing ring head-on. Keep the grille recessed 15 mm behind the lip so held objects sit inside the flare. No hose: it's a self-contained nozzle.

---

### INFLATOR: Helium tank
`inflator` · Air · Class M · Ship M4 · Inspired by (internal only): none

**Concept.** A chunky toy helium cylinder with a brass valve, a needle gauge and a curly rubber hose to a filler nozzle where a Helio's knot plugs in. On a pulse the valve opens, the needle climbs, and too much pops the balloon.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.30 × 0.20 m (2×3×2) · origin: bottom centre. Cradle ring Ø 0.17 × 0.036 (tall enough for the PR-S ring at z 0.019); tank Ø 0.13, body z 0.02–0.22, dome to 0.245; valve z 0.245–0.27; guard ring to z 0.30; nozzle bracket at (0.075, −0.02, 0.27) |
| Mass · physics | 2.4 kg · `powder` tank, `steel` valve, `rubber` hose and feet |
| Collision | `COL__cylinder__tank`, `COL__cylinder__cradle`, `COL__box__valve` |
| Materials (60/30/10) | neutral: `kn_powder_bone` tank and cradle, `kn_steel_brushed` nozzle and M5 screws (cradle), `kn_rubber` hose (Ø 8 mm) and feet · signature: `kn_powder_beam` shoulder band (z 0.19–0.215) and valve guard ring · accent: `kn_brass` valve and knob, `kn_glass` gauge cover, `kn_led`, `kn_decal` gauge dial (Volt band → Amber band) and name plate "INFLATOR · He" |
| Ports | `PORT__signal__in` · in · S · (0, −0.086, 0.019) · −Y (cradle front facet). `PORT__air__fill` · out · S · (0.08, −0.02, 0.285) · +Z (filler nozzle; a Helio's knot seats here) |
| Pivots | `PIVOT__valve_knob` · axis z · 0…90° (opens on signal). `PIVOT__gauge_needle` · axis y · −135…+135° (fill level; past +90° is over-pressure) |
| Sensors | none (the Helio is linked through the fill port) |
| Emitters | `EMIT__hiss__valve` · (0, −0.03, 0.26) · −Y · gas hiss puff VFX + audio |
| LEDs / screens | `led_groups = "0:filling,1:overpressure"`: air-colour dot on the valve front while filling; an amber dot beside it blinks 2 Hz when the needle is in the Amber band |
| States | idle · filling: knob turns, needle climbs, hiss, the Helio swells (its own shape keys) and its toy-helium lift grows with the fill (rollers.md) · full: needle in the Volt band · over-pressure: needle in Amber, LED blinks, the Helio pops, needle drops to 0 |
| Animation | procedural pivots; no clips |
| Fracture | none |
| Skins / variants | Air (default) · Party (`kn_powder_plasma` band and guard) |
| Budget | 6,500 tris · 2048² |
| Audio hooks | `valve_open_squeak`, `gas_hiss_loop` (pitch rises with fill), `gauge_tick`, `overpressure_beep` (the pop belongs to the Helio) |

**Read at a glance.** A pale gas bottle with a cyan collar, a brass valve and a curly hose.
**Notes / don'ts.** Toy, not industrial: no real gas-company marks, no hazard diamonds or stripes (not allowed on Air). The only pictogram allowed is the shared Pressurised mark (shared_kit §6.2), and it's optional. The hose is a fixed sculpted curl, not a sim rope. The filler nozzle sits clear of the guard ring so a 0.25 m Helio can grow without clipping the tank.
