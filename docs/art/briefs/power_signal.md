# Power and Signal briefs

Power sources, sensors, logic, light and the Wire-tool cables from [GAME_SPEC §12.5](../../../GAME_SPEC.md): Graphite bodies, Volt only as trim and LEDs, Beam on optics.
Back to the [brief index and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| MAINS | `mains` | M | M1 | brief |
| CELL | `cell` | S | M2 | brief |
| SUNCELL | `suncell` | S | M2 | brief |
| LAMP | `lamp` | S | M2 | brief |
| TORCH | `torch` | S | M2 | brief |
| BURNING GLASS | `burning_glass` | S | M2 | brief |
| LANCE | `lance` | S | M3 | brief |
| MIRROR / SPLITTER | `mirror_splitter` | S | M3 | brief |
| TRIPWIRE | `tripwire` | S | M3 | brief |
| STOMP PAD | `stomp_pad` | S | M1 | brief |
| THE BUTTON | `the_button` | S | M1 | brief |
| TOGGLE | `toggle` | S | M2 | brief |
| RINGER | `ringer` | M | M2 | brief |
| DELAY | `delay` | S | M2 | brief |
| PING | `ping` | S | M3 | brief |
| MAGLOCK | `maglock` | M | M3 | brief |
| ARC TOWER | `arc_tower` | L | M4 | brief |
| Power cable (Wire tool) | `cable_power` | proc | M1 | brief |
| Signal cable (Wire tool) | `cable_signal` | proc | M1 | brief |

---

### MAINS: Power block with toggle
`mains` · Power & Signal · Class M · Ship M1 · Inspired by (internal only): outlet + switch

**Concept.** The approved look-dev MAINS stood upright to fill 2×2×1: a pillowed graphite block with a Bone face, a chunky chrome toggle lever on the left, and a Volt LED bar plus load meter on the right. It's the M1 power source: flip it and everything downstream wakes up.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.10 m (2×2×1) · origin: bottom centre. Body 0.2 × 0.1 × 0.19 on 5 mm feet, 12 mm pillowed bevel; Bone face 0.17 × 0.15 inset at y −0.05 |
| Mass · physics | 1.8 kg · `powder`, `rubber` feet |
| Collision | `COL__box__body`, `COL__capsule__lever` (under the lever pivot) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` body, `kn_steel_brushed` M5 screws (4 on the face corners), `kn_rubber` feet · signature: `kn_powder_bone` face panel · accent: `kn_chrome` lever (0.018 × 0.018 × 0.055, Ø 0.022 ball tip), `kn_anod_volt` lever bezel ring, `kn_led`, `kn_screen`, `kn_decal` name plate, "KN-01 · 500 W" spec text (SIMULATION §5.5 supply) and high-voltage pictogram |
| Ports | `PORT__power__out` · out · M · (0.101, 0, 0.100) · +X · `max_links = 6` (look-dev placement; within the per-port cap of 8, PART_SYSTEM §3). `PORT__signal__in` · in · S · (−0.101, 0, 0.100) · −X |
| Pivots | `PIVOT__lever` · axis x at (−0.045, −0.058, 0.110) · −30° (off) … +30° (on) |
| Sensors | `SENSOR__trigger__lever` · threshold 0.03 N·s · cooldown 0.2 s · hull round the ball tip (a hit flips it) |
| Emitters | `EMIT__spark__face` · (0.045, −0.055, 0.105) · −Y · overload fizz |
| LEDs / screens | `led_groups = "0:power_on"`: light bar 0.06 × 0.008 at (0.045, −0.054, 0.155), power colour. `SCREEN__load` · kind bar · cells 10 · color power · `SCR_BAR_10` (0.056 × 0.014 quad) at (0.045, −0.054, 0.105): demand vs the 500 W supply. High-voltage pictogram at (0.045, −0.054, 0.050) |
| States | off: lever down, LED 8 %, screen dark · on: lever up, LED 100 %, load bar live, port flowing · overload (`Brownout`: supply factor < 0.5 for 1 s, SIMULATION §5.5): bar full + amber blink, port fault, brown-out flicker on the LED |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Lab (default) · Kitchen (`kn_powder_bone` body, `kn_powder_graphite` face) |
| Budget | 4,500 tris · 2048² |
| Audio hooks | `mains_lever_on_clack`, `mains_lever_off_clack`, `mains_hum_loop` (gain ∝ load), `mains_overload_buzz` |

**Read at a glance.** A dark upright block with a pale face, a big silver flip-lever and a lime light bar.
**Notes / don'ts.** Keep the look-dev layout: lever left, light bar right, power port on the +X side. The lever is exaggerated 1.4× and must read at 150 px. This is one of only two parts allowed the high-voltage pictogram; no hazard stripes.

---

### CELL: Battery
`cell` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** A chunky rounded-square battery with a Volt anodised positive cap and a 5-cell charge bar on its front. It's portable power: you can watch it drain.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.20 × 0.10 m (1×2×1) · origin: bottom centre. Body 0.09 × 0.09 × 0.17 (8 mm bevel); Volt cap Ø 0.06 × 0.014; steel nub Ø 0.02 × 0.01 to z 0.198 |
| Mass · physics | 0.6 kg · `powder` (dynamic; can be knocked over) |
| Collision | `COL__box__body` (convex_radius 0.008), `COL__cylinder__cap` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` body, `kn_steel_brushed` nub, `kn_rubber` foot ring · signature: `kn_anod_volt` cap · accent: `kn_screen`, `kn_glass` screen cover, `kn_decal` "+" on the cap, "−" on the base, name plate on the back |
| Ports | `PORT__power__out` · out · S · (0, −0.046, 0.152) · −Y · `max_links = 4` |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | `led_groups = ""` (no discrete LEDs). `SCREEN__charge` · kind bar · cells 5 · color power · `SCR_BAR_5` (0.030 × 0.014 quad) rotated 90° to a vertical 0.014 × 0.030, at (0, −0.0455, 0.110) |
| States | full: 5 cells · draining (200 W while `charge` > 0; charge −= W·dt, SIMULATION §5.5): cells drop in proportion to the capacity property · empty: bar dark, bottom cell blinks amber at 1 Hz, port at 25 % |
| Animation | none (engine-driven screen) |
| Fracture | none |
| Skins / variants | Graphite (default) · Bone (`kn_powder_bone` body) |
| Budget | 1,800 tris · 1024² |
| Audio hooks | `cell_connect_click`, `cell_low_beep`, `cell_empty_thunk` |

**Read at a glance.** A dark battery with a lime top and a lit charge ladder.
**Notes / don'ts.** Flat faces only (the port needs one). No real battery brand or size codes. The cap stays a small accent (≤ 10 % of the surface).

---

### SUNCELL: Solar panel
`suncell` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): solar panel

**Concept.** A slim graphite tray holding a 3 × 2 grid of dark photovoltaic cells under glass, with a Beam trim lip. Shine light on it and power comes out the corner port.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.021 × 0.20 m (3×0.2×2) · origin: bottom centre. Tray 0.3 × 0.2 × 0.018 on 3 mm rubber pads; cell grid 0.24 × 0.16 (6 cells of 0.078) centred at x −0.02; equipment strip x 0.10…0.15 |
| Mass · physics | 0.7 kg · `powder`, `glass` top |
| Collision | `COL__box__panel` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` tray, `kn_anod_graphite` cells (busbar lines via `kn_decal`) · signature: `kn_anod_beam` trim lip · accent: `kn_glass` cover, `kn_led`, `kn_decal` name plate on the strip |
| Ports | `PORT__power__out` · out · S · (0.125, −0.075, 0.019) · +Z (the tray is too thin for a side ring) |
| Pivots | none |
| Sensors | `SENSOR__light__panel` · volume 0.24 × 0.16 × 0.01 over the cells · threshold 0.05 normalised irradiance for the `Lit` event and LED only; output = 150 W × normalised incident intensity, with no cut-off (SIMULATION §5.5, §5.6) |
| Emitters | none |
| LEDs / screens | `led_groups = "0:output"`: Ø 6 mm dot at (0.125, 0.05, 0.019), power colour, brightness ∝ watts |
| States | dark · lit: the glass catches the beam, LED ∝ output, port flowing |
| Animation | none |
| Fracture | none |
| Skins / variants | none |
| Budget | 1,200 tris · 1024² |
| Audio hooks | `suncell_lit_tick`, `suncell_charge_hum` (very soft, gain ∝ W) |

**Read at a glance.** A flat dark tile with a cyan edge and a grid of glossy squares.
**Notes / don'ts.** Keep the cells dark and glossy so incoming beams glint. No Volt on the face (Volt only in the LED). The port ring sits on the strip, never on the cells.

---

### LAMP: Light bulb
`lamp` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): light bulb

**Concept.** An oversized glass bulb with a visible coil filament on a steel screw collar and a graphite base. Power in, real dynamic light out.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.20 × 0.10 m (1×2×1) · origin: bottom centre. Base 0.09 × 0.09 × 0.07; collar Ø 0.042 × 0.024; bulb Ø 0.088 centred z 0.148, tip to 0.196 |
| Mass · physics | 0.5 kg · `powder` base, `glass` bulb |
| Collision | `COL__box__base`, `COL__sphere__bulb` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base, `kn_steel_brushed` collar (thread normal) and filament supports, `kn_rubber` feet · signature: `kn_glass` bulb · accent: `kn_anod_volt` trim band (z 0.068–0.074), `kn_led` filament coil, `kn_decal` name plate on the base back |
| Ports | `PORT__power__in` · in · S · (0, −0.046, 0.036) · −Y |
| Pivots | none |
| Sensors | none |
| Emitters | `EMIT__light__bulb` · (0, 0, 0.148) · point light; gameplay reach 6 m, receivers get intensity × (1 − d/6)² (SIMULATION §5.6); 40 W rated (§5.5) |
| LEDs / screens | `led_groups = "0:filament"`: coil faces in light colour, brightness ∝ power with an 80 ms warm-up |
| States | off · on: filament glows, real light on, port flowing · brown-out: flicker |
| Animation | none |
| Fracture | none (the bulb doesn't break in v1) |
| Skins / variants | Clear (default) · Amber (`kn_poly_amber` bulb, warm look) |
| Budget | 2,200 tris · 1024² |
| Audio hooks | `lamp_on_tink`, `filament_buzz_loop` (very quiet), `lamp_off_tick` |

**Read at a glance.** A big round bulb on a little dark plinth.
**Notes / don'ts.** The filament must be readable through the glass (a 3-turn coil, exaggerated). Never bake glow into the glass; light comes from the LED faces and the engine light.

---

### TORCH: Flashlight
`torch` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): flashlight

**Concept.** A chunky square-bodied flashlight resting in a two-saddle cradle, with a Beam anodised head, a chrome reflector and a fat rubber push switch. A pulse toggles a crisp light cone.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.10 × 0.10 m (2×1×1) · origin: bottom centre. Body 0.065 square section along X (x −0.1…0.06), axis z 0.055; head Ø 0.088 (x 0.06…0.10); saddles at x −0.06 and 0.03 |
| Mass · physics | 0.4 kg · `powder`, `rubber` saddle pads |
| Collision | `COL__box__body` (square section, axis X), `COL__box__cradle` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` body and saddles, `kn_rubber_grip` knurl band, `kn_rubber` pads · signature: `kn_anod_beam` head bezel · accent: `kn_chrome` reflector, `kn_glass` lens, `kn_rubber` switch dome (Ø 0.022), `kn_led`, `kn_decal` name plate on the body side |
| Ports | `PORT__signal__in` · in · S · (−0.015, −0.0335, 0.055) · −Y (between the saddles at x −0.06 and 0.03, so neither covers the ring) |
| Pivots | `PIVOT__switch` · axis z · translation −0.004 … 0 m · switch dome at (−0.03, 0, 0.088) |
| Sensors | none |
| Emitters | `EMIT__beam__lens` · (0.10, 0, 0.055) · +X · light cone 20° (half-angle 10°): 9 rays, 1 centre + 8 at the half angle (SIMULATION §5.6) |
| LEDs / screens | `led_groups = "0:lens"`: emissive disc behind the lens (light colour), 100 % when on |
| States | off · on: lens glows, cone on, switch dips |
| Animation | procedural pivot |
| Fracture | none |
| Skins / variants | Graphite (default) · Bone (`kn_powder_bone` body) |
| Budget | 2,500 tris · 1024² |
| Audio hooks | `torch_click_on`, `torch_click_off` |

**Read at a glance.** A dark stubby flashlight with a cyan head lying in a little cradle.
**Notes / don'ts.** No tactical look: no rail mounts, pistol grip or crenellated bezel. A square body section, so it never rolls and the port has a flat face.

---

### BURNING GLASS: Magnifier
`burning_glass` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): magnifying glass

**Concept.** A classic magnifying glass standing upright: a Beam anodised rim, a fat biconvex lens and a walnut handle planted in a weighted graphite base. It focuses light into a hot spot; with a LANCE it becomes a cutting beam.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.30 × 0.10 m (1×3×1) · origin: bottom centre. Base 0.09 × 0.09 × 0.03; handle Ø 0.02 from z 0.034 to 0.19; rim outer Ø 0.098 (8 mm tube) centred (0, 0, 0.245); lens Ø 0.084, 14 mm thick at the centre; optical axis Y |
| Mass · physics | 0.6 kg · `powder` base, `wood` handle, `glass` lens |
| Collision | `COL__box__base`, `COL__capsule__handle`, `COL__cylinder__lens` (axis Y) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base, `kn_wood_walnut` handle, `kn_steel_brushed` ferrules, `kn_rubber` feet · signature: `kn_anod_beam` rim · accent: `kn_glass` lens, `kn_led`, `kn_decal` name plate on the base front |
| Ports | none (light enters optically; heat leaves at the focal point) |
| Pivots | none (aim by rotating the part) |
| Sensors | `SENSOR__light__lens` · disc r 0.042 × 0.016 at the lens |
| Emitters | `EMIT__focus__lens` · (0, 0, 0.245) · +X = optical axis (the part's +Y); the engine places the focus point at distance `f` (focal-length property) along the beam on the far side from the incoming light, and mirrors it for light from behind; it heats (a 0.02 m spot) only a surface the beam hits within ±0.03 m of `f` (SIMULATION §5.6, §5.7) |
| LEDs / screens | `led_groups = "0:focus"`: Ø 6 mm dot on the base front (heat colour), lit while the focus is above the ignition threshold |
| States | idle · catching light: rim glint, focus VFX dot, LED on · cutting (with LANCE): bright focal streak (VFX) |
| Animation | none |
| Fracture | none |
| Skins / variants | Walnut (default) · Oak (`kn_wood_oak` handle) |
| Budget | 2,500 tris · 1024² |
| Audio hooks | `focus_sizzle_loop` (gain ∝ heat), `focus_lock_tink` (ignition sounds belong to the target) |

**Read at a glance.** A big round lens with a cyan rim on a wooden stick.
**Notes / don'ts.** The lens must refract visibly (real thickness, not a flat disc). Only one glass layer in the sight line. No hot-surface pictogram needed; the focus VFX tells the story.

---

### LANCE: Benchtop laser
`lance` · Power & Signal · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A lab-instrument laser: a graphite housing on skids, steel cooling fins, a clear top window over a glowing glass tube, and a Beam anodised emitter barrel. Power in, a hard straight beam out.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.10 × 0.08 m (2×1×1) · origin: bottom centre. Housing 0.16 × 0.08 × 0.07 (x −0.10…0.06, z 0.012–0.082); fins to z 0.095; barrel Ø 0.04, x 0.06…0.10, axis z 0.047 |
| Mass · physics | 0.9 kg · `powder` |
| Collision | `COL__box__housing`, `COL__cylinder__barrel` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` housing and skids, `kn_steel_brushed` fins and M3 screws (4 on top), `kn_rubber` skid pads · signature: `kn_anod_beam` barrel · accent: `kn_poly_clear` top window (0.09 × 0.05), `kn_glass` tube (Ø 0.016), `kn_led`, `kn_decal` name plate on the housing side |
| Ports | `PORT__power__in` · in · S · (−0.07, −0.041, 0.047) · −Y |
| Pivots | none |
| Sensors | none |
| Emitters | `EMIT__beam__aperture` · (0.10, 0, 0.047) · +X · light beam ray |
| LEDs / screens | `led_groups = "0:status,1:tube,2:aperture"`: status dome on top rear (power colour); tube core (light colour, 0.2 s flicker on start, then steady); aperture dot (light colour) |
| States | off · charging (0.2 s): tube flickers · on: tube steady, beam on, port flowing |
| Animation | none |
| Fracture | none |
| Skins / variants | none |
| Budget | 3,000 tris · 1024² |
| Audio hooks | `lance_charge_whine`, `lance_hum_loop`, `lance_cut_sizzle` (cutting-beam mode), `lance_off_tick` |

**Read at a glance.** A dark lab box with a glowing window and a cyan nozzle.
**Notes / don'ts.** Not a weapon: no grip, trigger, stock, sights or barrel shroud. It sits flat on skids like lab equipment. The beam leaves exactly on the barrel axis.

---

### MIRROR / SPLITTER: Optics pair
`mirror_splitter` · Power & Signal · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** Two clean optics on matching graphite feet with Beam frames. MIRROR is a slim chrome plate that bounces beams; SPLITTER is a glass cube in a Beam cage with a three-facet prism insert that fans one beam into three.

| Spec | Value |
|---|---|
| Size (W×H×D) | `mirror`: 0.10 × 0.20 × 0.036 m (1×2×0.2; the foot sled is within tolerance), plate 0.1 × 0.02 × 0.185 on a 0.1 × 0.036 × 0.012 sled · `splitter`: 0.10 × 0.10 × 0.10 m (1×1×1), plinth 0.1 × 0.1 × 0.025, glass cube 0.068 centred z 0.065 · origin: bottom centre (both) |
| Mass · physics | mirror 0.3 kg · splitter 0.5 kg · `glass` optics, `powder` feet |
| Collision | mirror: `COL__box__plate`, `COL__box__foot` · splitter: `COL__box__plinth`, `COL__box__cube` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` backs and plinths, `kn_rubber` pads · signature: `kn_anod_beam` mirror frame (8 mm) and splitter cage posts · accent: `kn_chrome` mirror face (0.084 × 0.17, `optic = reflect`), `kn_glass` cube, `kn_poly_beam` prism insert (three vertical 1.5 mm facets at 0° and ±12° about Z, meeting at the +X face; `optic = split`), `kn_decal` name plates on the backs |
| Ports | none (optical) |
| Pivots | none (aim by rotating the part, 5° snap) |
| Sensors | `SENSOR__light__face` (mirror, 3 mm over the face) · `SENSOR__light__cube` (splitter, cube volume) |
| Emitters | none (the engine raycasts the optic surfaces). Splitter (SIMULATION §5.6): a beam entering the cube leaves as 3 child rays, one straight on and two at ±12° about the part's Z axis, each at 1/3 intensity; the insert facets show that fan for the default −X → +X beam |
| LEDs / screens | none: optics stay clean so beams read |
| States | idle · beam hit: engine glint sprite at the hit point |
| Animation | none |
| Fracture | none |
| Skins / variants | files `mirror` and `splitter` (one catalogue entry, `mirror_splitter`). No skins |
| Budget | mirror 800, splitter 1,600 tris · shared 1024² |
| Audio hooks | `optic_ting` (first beam contact), `splitter_shimmer` |

**Read at a glance.** A tall silver mirror with a cyan frame; a glass cube in a cyan cage.
**Notes / don'ts.** The mirror face must be perfectly flat (no normal map). The splitter has two transparent layers in the sight line (cube + insert), the maximum allowed; add nothing else transparent behind it. It's a prism fan, not a 90° beam splitter: no diagonal mirror plane.

---

### TRIPWIRE: Beam sensor
`tripwire` · Power & Signal · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A small graphite receiver block with a Beam-hooded "eye" on its left side and a two-position mode slider on top (BREAK / LIT). It fires a signal when its beam is broken, or when light reaches it.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.09 m (1×1×1) · origin: bottom centre. Box 0.085 × 0.09 × 0.085; eye hood Ø 0.044 protruding 0.012 from the −X face at z 0.05 |
| Mass · physics | 0.3 kg · `powder` |
| Collision | `COL__box__body` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` box, `kn_rubber` feet, `kn_steel_brushed` M3 screws · signature: `kn_anod_beam` eye hood · accent: `kn_glass` eye lens, `kn_anod_volt` slider knob, `kn_led`, `kn_decal` BREAK/LIT icons and name plate |
| Ports | `PORT__signal__out` · out · S · (0.015, −0.046, 0.045) · −Y · `max_links = 8` |
| Pivots | `PIVOT__mode_slider` · axis x · translation 0 (break) … 0.02 m (lit) |
| Sensors | `SENSOR__light__eye` · cylinder Ø 0.03 × 0.01 at (−0.0545, 0, 0.05) · threshold 0.1 normalised · debounce 2 ticks |
| Emitters | none |
| LEDs / screens | `led_groups = "0:eye,1:mode_break,2:mode_lit"`: LED ring inside the hood (light colour, on while lit); two dots beside the slider icons (signal colour) |
| States | armed-dark · lit (eye ring on) · triggered: signal pulse, port flash |
| Animation | procedural slider (set in Build) |
| Fracture | none |
| Skins / variants | none |
| Budget | 1,500 tris · 1024² |
| Audio hooks | `tripwire_arm_beep`, `tripwire_trigger_chirp`, `tripwire_mode_click` |

**Read at a glance.** A dark cube with one cyan "eye" on its side.
**Notes / don'ts.** It's a receiver only; it never emits its own beam (pair it with a TORCH or LANCE). The eye faces −X so beams travelling +X in side-view machines land on it by default.

---

### STOMP PAD: Pressure plate
`stomp_pad` · Power & Signal · Class S · Ship M1 · Inspired by (internal only): none

**Concept.** A low graphite tray with a grippy rubber-tread plate that sinks a few millimetres under weight, ringed by a signal-coloured light strip. Heavy enough, and it fires.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.03 × 0.20 m (2×0.3×2) · origin: bottom centre. Tray 0.2 × 0.2 × 0.027 on 3 mm pads (rim top z 0.030); plate 0.14 × 0.14 centred (−0.01, 0.01), top z 0.030, flush with the rim; corner boss at (0.08, −0.08), top flush at z 0.030 |
| Mass · physics | 1.2 kg · tray `powder`, plate `rubber` (friction 1.0) |
| Collision | `COL__box__tray`, `COL__box__plate` (under the plate pivot) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` tray, `kn_rubber` pads · signature: `kn_rubber_grip` plate tread · accent: `kn_anod_volt` corner boss trim, `kn_steel_brushed` M3 screws (4 tray corners), `kn_led` strip, `kn_decal` name plate on the tray front |
| Ports | `PORT__signal__out` · out · S · (0.08, −0.08, 0.030) · +Z (corner boss) · `max_links = 8` |
| Pivots | `PIVOT__plate` · axis z · translation −0.006 … 0 m |
| Sensors | `SENSOR__pressure__plate` · threshold 0.5 kg (default; `weight` property 0.05–20 kg) · cooldown 0.1 s · box 0.14 × 0.14 × 0.02 above the plate |
| Emitters | none |
| LEDs / screens | `led_groups = "0:perimeter"`: light strip in the plate gap (signal colour): 25 % armed, 100 % pressed |
| States | armed · pressed: plate sinks 6 mm, strip 100 %, pulse · released: plate springs up |
| Animation | procedural pivot |
| Fracture | none |
| Skins / variants | Graphite (default) · Bone (`kn_powder_bone` tray) |
| Budget | 1,400 tris · 1024² |
| Audio hooks | `pad_press_thunk`, `pad_release_click`, `pad_signal_chirp` |

**Read at a glance.** A flat dark square with a black tread centre and a glowing gold outline.
**Notes / don'ts.** The plate must be flush with the tray rim at rest so Rollers roll on without bumping. The port goes on the boss, never on the plate.

---

### THE BUTTON: Big red button
`the_button` · Power & Signal · Class S · Ship M1 · Inspired by (internal only): none

**Concept.** The approved look-dev button: a round graphite base, a steel collar with a signal LED ring, and a candy-gloss Ignition dome you can't resist pressing. The most clickable thing in the game.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.084 × 0.10 m (1×1×1; height within tolerance) · origin: bottom centre. Base Ø 0.10 × 0.05 (8 mm bevel) with a flat front facet 0.036 wide; collar torus R 0.041, r 0.006 at z 0.055; dome r 0.038 squashed to 0.55, centre z 0.063 |
| Mass · physics | 0.6 kg · base `powder`, cap `rubber` (e 0.4) |
| Collision | `COL__cylinder__base`, `COL__cylinder__cap` (under the cap pivot) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base, `kn_rubber` foot ring · signature: `kn_powder_ignition_gloss` dome · accent: `kn_steel_brushed` collar, `kn_led` ring, `kn_decal` name plate on the base back |
| Ports | `PORT__signal__out` · out · S · (0, −0.0467, 0.026) · −Y (on the front facet, as in the look-dev: a 36 mm chord of the Ø 0.10 base lies at y −0.0467) · `max_links = 8` |
| Pivots | `PIVOT__cap` · axis z · translation −0.006 … 0 m |
| Sensors | `SENSOR__trigger__cap` · threshold 0.02 N·s · cooldown 0.25 s · dome hull |
| Emitters | none |
| LEDs / screens | `led_groups = "0:collar_ring"`: LED torus R 0.0475 at z 0.0545 (signal colour): 25 % armed, 100 % flash on press |
| States | armed · pressed: dome dips 6 mm, ring flashes, pulse · released: spring back over 0.15 s |
| Animation | procedural pivot |
| Fracture | none |
| Skins / variants | Ignition (default) · Volt (`kn_powder_volt_gloss` dome, for "go" buttons) |
| Budget | 1,800 tris · 1024² |
| Audio hooks | `button_press_clack` (big and satisfying), `button_release_spring`, `button_signal_chirp` |

**Read at a glance.** A glossy orange dome on a dark puck with a gold ring.
**Notes / don'ts.** The look-dev base was 32 mm tall; raise it to 50 mm to meet the 1-cell height. Keep the dome-to-base ratio. Never use a hazard decal or "DO NOT PRESS" text (the shape says it).

---

### TOGGLE: Lever switch
`toggle` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** A graphite box with a tall chrome bat lever and a Volt knob that snaps left (OFF) or right (ON). It both sends a signal and switches a power line passing through it.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.19 × 0.10 m (1×2×1) at rest (lever at ±25°) · origin: bottom centre. Box 0.09 × 0.09 × 0.075; Bone top plate 0.08 × 0.08 × 0.004; lever 0.11 from pivot to knob centre, knob Ø 0.026: at rest the knob reaches x ±0.060 and z 0.193 (at ±35° it would overhang the side to x ±0.076, past the 0.02 tolerance) |
| Mass · physics | 0.4 kg · `powder` |
| Collision | `COL__box__body`, `COL__capsule__lever` (under the lever pivot) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` box, `kn_rubber` feet, `kn_steel_brushed` M3 screws · signature: `kn_powder_bone` top plate (ON / OFF decals) · accent: `kn_chrome` lever, `kn_anod_volt` knob, `kn_led`, `kn_decal` name plate on the back |
| Ports | `PORT__power__in` · in · S · (−0.046, 0, 0.042) · −X. `PORT__power__out` · out · S · (0.046, 0, 0.042) · +X. `PORT__signal__out` · out · S · (0, −0.046, 0.042) · −Y · `max_links = 8` |
| Pivots | `PIVOT__lever` · axis y at (0, 0, 0.080) · −25° (off, left) … +25° (on, right), over-centre snap |
| Sensors | `SENSOR__trigger__knob` · threshold 0.03 N·s · cooldown 0.2 s · knob hull; a hit from either side flips it |
| Emitters | none |
| LEDs / screens | `led_groups = "0:state"`: Ø 6 mm dot beside ON (power colour while on) |
| States | off: lever left, LED 8 % · on: lever right, LED 100 %, power passes (the flip joins or splits the power circuit, a topology change), signal pulse on each flip |
| Animation | procedural pivot (0.08 s snap) |
| Fracture | none |
| Skins / variants | none |
| Budget | 1,600 tris · 1024² |
| Audio hooks | `toggle_snap_on`, `toggle_snap_off` |

**Read at a glance.** A small dark box with a tall silver lever tipped by a lime ball.
**Notes / don'ts.** The lever swings in the XZ plane so side-view machines can hit it. The knob is exaggerated 1.5×. Measure bounds at rest, not mid-swing.

---

### RINGER: Alarm-clock timer
`ringer` · Power & Signal · Class M · Ship M2 · Inspired by (internal only): none

**Concept.** A twin-bell alarm clock reimagined as a lab timer: a graphite body on chrome legs, a 7-segment countdown behind glass, and two Amber bells with a brass hammer. At zero it rings: a signal plus a Sound event that startles critters.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.08 m (1×1×1) · origin: bottom centre. Body 0.09 × 0.06 × 0.062 (z 0.018–0.08) on two chrome legs; bells Ø 0.034 at x ±0.026 (z 0.082–0.099); winding key on the back to y 0.04 |
| Mass · physics | 0.5 kg · `powder` |
| Collision | `COL__box__body`, `COL__box__bells` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` body and screen bezel, `kn_chrome` legs, `kn_steel_brushed` key, `kn_rubber` leg tips · signature: `kn_powder_amber` bells (ART_BIBLE §3.1) · accent: `kn_brass` hammer, `kn_screen`, `kn_glass` cover, `kn_led`, `kn_decal` name plate on the back |
| Ports | `PORT__signal__out` · out · S · (0.046, 0, 0.050) · +X · `max_links = 8` |
| Pivots | `PIVOT__hammer` · axis y at (0, 0, 0.083) · ±25° (18 Hz buzz while ringing) |
| Sensors | none |
| Emitters | `EMIT__sound__bells` · (0, 0, 0.09) · +Z · Sound-channel event origin and ring VFX (shake lines) |
| LEDs / screens | `led_groups = "0:armed"`: Ø 6 mm dome on top front (signal colour). `SCREEN__countdown` · kind 7seg · digits 4 + colon (MM:SS) · color signal · `SCR_7SEG_4` (0.044 × 0.020 quad, 16 mm digits) at (0, −0.031, 0.050) |
| States | armed: counting down from the time property (1–30 s), colon blinks 1 Hz, last 3 s digits flash · ringing: hammer buzzes 2 s, bells shake, pulse + Sound · done: "00:00" steady, armed LED off |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Graphite (default) · Bone (`kn_powder_bone` body) |
| Budget | 4,500 tris · 2048² |
| Audio hooks | `ringer_tick_loop` (1 Hz tick-tock), `ringer_final_ticks` (faster, last 3 s), `ringer_bell_ring` (2 s), `ringer_wind_ratchet` (on arm) |

**Read at a glance.** Two amber bells on top of a dark clock face with gold digits.
**Notes / don'ts.** The bells and hammer are the silhouette and must clear the body top. Digits stay readable at mid-zoom: use the shared `SCR_7SEG_4` at full size (16 mm digits) and never shrink it. No clock hands; it's digital.

---

### DELAY: Signal delay box
`delay` · Power & Signal · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** A graphite logic cube: a 7-segment readout of the delay, a Volt setting knob ringed by a 12-dot progress light, and a small window where a brass escapement ticks while it waits. Signal in left, out right, 0.1–30 s later.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.09 m (1×1×1) · origin: bottom centre. Box 0.09 × 0.09 × 0.08; knob Ø 0.034 × 0.014 on top |
| Mass · physics | 0.35 kg · `powder` |
| Collision | `COL__box__body` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` box and bezel, `kn_rubber` feet, `kn_steel_brushed` M3 screws · signature: `kn_anod_volt` knob · accent: `kn_poly_clear` window (0.05 × 0.025 at (0, −0.0455, 0.028)), `kn_brass` escapement, `kn_screen`, `kn_glass` cover, `kn_led`, `kn_decal` name plate on the back |
| Ports | `PORT__signal__in` · in · S · (−0.046, 0, 0.045) · −X · `max_links = 4`. `PORT__signal__out` · out · S · (0.046, 0, 0.045) · +X · `max_links = 8` |
| Pivots | `PIVOT__escapement` · axis y · unlimited (4 Hz ticks while counting). `PIVOT__knob` · axis z · 0…300° (shows the set time; static during a run) |
| Sensors | none |
| Emitters | none |
| LEDs / screens | `led_groups = "0:status,1:progress"`: status dot by the input port; 12-dot ring round the knob (signal colour) filling with elapsed time. `SCREEN__delay` · kind 7seg · digits 3 + decimal point ("0.1"–"30.0") · color signal · `SCR_7SEG_3` (0.034 × 0.020 quad) at (0, −0.0455, 0.062) |
| States | idle: screen shows the set value at 40 % · counting (the pulse is scheduled round(seconds × tick rate) ticks later, SIMULATION §5.2): screen counts down, ring fills, escapement ticks · fire: output pulse, ring flash |
| Animation | procedural pivots |
| Fracture | none |
| Skins / variants | none |
| Budget | 2,400 tris · 1024² |
| Audio hooks | `delay_tick_loop` (4 Hz, soft), `delay_fire_chirp`, `delay_knob_detent` (Build mode) |

**Read at a glance.** A dark cube with gold digits on the front and a lime knob on top.
**Notes / don'ts.** Keep the in/out direction obvious: add a small arrow decal (`kn_decal`) on the front from the in side to the out side. No more than one name plate.

---

### PING: Wireless transmitter / receiver
`ping` · Power & Signal · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A smooth "newer product line" puck with a clear dome and a whip antenna. The antenna's anodised ball tip shows its pair colour. One model does both jobs: a mode icon on the front shows Tx or Rx.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.09 m (1×1×1) · origin: bottom centre. Base 0.09 × 0.09 × 0.05 (seamless, 7 mm pillowed bevel, leaving a 36 mm flat on each side face for the PR-S rings and their 35 mm land); dome Ø 0.06 × 0.02 (z 0.05–0.07); antenna Ø 3 mm to z 0.090; tip Ø 0.016 centred at z 0.090 (top 0.098) |
| Mass · physics | 0.25 kg · `powder` |
| Collision | `COL__box__base`, `COL__capsule__antenna` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base, `kn_chrome` antenna, `kn_rubber` feet · signature: `kn_anod_*` tip (pair colour) · accent: `kn_poly_clear` dome, `kn_led`, `kn_screen`, `kn_decal` name plate on the back. No visible fasteners |
| Ports | `PORT__signal__in` · in · S · (−0.046, 0, 0.025) · −X (live in Tx mode). `PORT__signal__out` · out · S · (0.046, 0, 0.025) · +X · `max_links = 8` (live in Rx mode). The unused port idles at 8 % |
| Pivots | none |
| Sensors | none |
| Emitters | `EMIT__ping__antenna` · (0, 0, 0.10) · +Z · expanding ring VFX on send and receive |
| LEDs / screens | `led_groups = "0:pair_pulse"`: LED core under the dome (signal colour), pulses on send/receive. `SCREEN__mode` · kind icon · color signal · `SCR_ICON_24` (0.024 × 0.024 quad) at (0, −0.0455, 0.025): Tx (arrow out) or Rx (arrow in) |
| States | idle · sending (Tx): dome pulse + ring VFX · receiving (Rx): dome pulse, output pulse · unpaired: icon blinks |
| Animation | none |
| Fracture | none |
| Skins / variants | pair colour = antenna tip: `kn_anod_ignition`, `_volt`, `_beam`, `_cobalt`, `_plasma`, `_graphite` (6 pairs) |
| Budget | 1,500 tris · 1024² |
| Audio hooks | `ping_send_blip`, `ping_receive_blip` (pitch per pair), `ping_pair_chime` (Build mode) |

**Read at a glance.** A dark puck with a glass bubble and an antenna topped by a coloured bead.
**Notes / don'ts.** The pair colour lives only on the tip bead (plus UI), never on the body. Seamless and screw-free so it reads as newer tech next to the other Power & Signal parts.

---

### MAGLOCK: Electromagnet
`maglock` · Power & Signal · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A pot electromagnet in a graphite yoke: a steel pole face with a chrome centre pole facing front, a clear band showing copper windings, and an eye bolt on top for hanging it from a LINE. Powered, it grabs steel.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.18 m (2×2×2) · origin: bottom centre. Head Ø 0.16 along Y from y −0.09 to 0.09, centre (0, 0, 0.10), trunnions at y 0 in the yoke arms (x ±0.093); base plate 0.18 × 0.18 × 0.016; eye boss to z 0.20 |
| Mass · physics | 3.0 kg · `steel` pole face, `powder` housing |
| Collision | `COL__cylinder__head` (axis Y), `COL__box__base`, `COL__box__yoke_l`, `COL__box__yoke_r` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` yoke, base and rear cap, `kn_steel_brushed` outer pole ring and M5 screws (4 on the base), `kn_rubber` feet · signature: `kn_copper` windings · accent: `kn_poly_clear` coil band (y −0.06…−0.01), `kn_anod_volt` trim ring (y −0.01…−0.004), `kn_chrome` centre pole (Ø 0.06), `kn_led`, `kn_decal` name plate on the rear cap |
| Ports | `PORT__power__in` · in · M · (0.101, 0, 0.055) · +X (right yoke arm). `PORT__tension__eye` · both · S · (0, 0, 0.183) · +Z · `kind = hook` |
| Pivots | none |
| Sensors | `SENSOR__field__pole` · cylinder r 0.12 from the pole face (y −0.09) to y −0.69 (the 0.6 m reach) · steel-only filter; the engine owns the force, F = k / max(d, 0.05)², and holds steel in contact while the supply factor is ≥ 0.75 of its 150 W (SIMULATION §5.5, §5.12) |
| Emitters | `EMIT__clack__pole` · (0, −0.091, 0.10) · −Y · contact-flash VFX when steel snaps on |
| LEDs / screens | `led_groups = "0:field_ring,1:status"`: LED ring between the centre pole and the outer ring (field colour); status dome on the rear cap top (power colour) |
| States | off · energised: field ring 100 %, coil band lit, steel snaps on with a flash · released: ring fades over 0.2 s, held steel drops |
| Animation | none |
| Fracture | none |
| Skins / variants | none |
| Budget | 7,000 tris · 2048² |
| Audio hooks | `magnet_energise_thunk`, `magnet_hum_loop`, `magnet_steel_clack`, `magnet_release_tink` |

**Read at a glance.** A dark drum on a stand with a shiny bullseye face ringed in pink light.
**Notes / don'ts.** The pole face (concentric chrome / rubber / steel rings) is the read: keep it flat, big and front-facing. No horseshoe or red-and-silver cartoon magnet styling. Feet stay under the base plate; the pole face never touches the floor.

---

### ARC TOWER: Tesla coil
`arc_tower` · Power & Signal · Class L · Ship M4 · Inspired by (internal only): none

**Concept.** A tabletop Tesla coil: a hazard-striped graphite plinth, a flat copper primary spiral, a tall clear tube over the copper secondary, and a big steel toroid crowned with a breakout spike. Powered, it throws branching arcs at the nearest metal within 2 m.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.50 × 0.20 m (2×5×2) · origin: bottom centre. Plinth 0.2 × 0.2 × 0.095 on 5 mm feet (top z 0.100; 8 mm pillowed bevel, so the front keeps a flat from z 0.013 to 0.092 for the PR-L ring and the stripe band); primary spiral Ø 0.16 at z 0.102; tube Ø 0.07, z 0.104–0.39; toroid R 0.07, r 0.03 (outer Ø 0.20) at z 0.42; spike to z 0.50 |
| Mass · physics | 6.0 kg · `powder` plinth, `steel` toroid, `glass` tube |
| Collision | `COL__box__plinth`, `COL__cylinder__tube`, `COL__cylinder__toroid` (disc Ø 0.2 × 0.06), `COL__capsule__spike` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth, `kn_steel_brushed` toroid and M8 screws (4 plinth top corners), `kn_rubber` feet · signature: `kn_copper` primary and secondary windings (fine-wire normal) · accent: `kn_poly_clear` tube, `kn_chrome` spike, `kn_led`, `kn_decal` Amber/Graphite hazard stripe band round the plinth (z 0.077–0.091, clear above the port ring), high-voltage pictogram at (0.068, −0.1005, 0.045), name plate on the back |
| Ports | `PORT__power__in` · in · L · (0, −0.101, 0.045) · −Y (ring spans z 0.017–0.073) |
| Pivots | none |
| Sensors | `SENSOR__field__range` · sphere r 2.0 m centred on the toroid · target search for the nearest metal |
| Emitters | `EMIT__arc__breakout` · (0, 0, 0.50) · +Z · preferred arc origin. `EMIT__arc__toroid` · (0, 0, 0.42) · arcs may start anywhere on the torus (root props `arc_torus_R = 0.07`, `arc_torus_r = 0.03`). `EMIT__crackle__primary` · (0, 0, 0.105) · corona sparks |
| LEDs / screens | `led_groups = "0:charge,1:secondary_glow,2:status"`: 4 light-bar segments on the plinth top edges (power colour, fill over the 0.5 s charge); LED ring at the tube foot (power colour, ∝ output); status dome on the plinth back corner |
| States | off · charging (0.5 s; needs supply factor ≥ 0.75 of its 400 W, SIMULATION §5.5): hum rises, charge bars fill, corona on the toroid · arcing: branching plasma-white / Beam arcs to the target, strobe light (comfort-capped) · powered, no target: brush discharges into the air, crackle |
| Animation | none (arcs are VFX) |
| Fracture | none |
| Skins / variants | none |
| Budget | 18,000 tris · 2048² + 1024² detail. LOD2 secondary → copper cylinder block; LOD3 tube opaque |
| Audio hooks | `tesla_hum_loop` (rises with charge), `arc_crackle` (12 variations per strike), `arc_zap_hit`, `corona_fizz_loop`, `tesla_power_down_whine` |

**Read at a glance.** A tall clear column on a striped base with a fat silver doughnut on top.
**Notes / don'ts.** One of only two parts allowed the high-voltage pictogram, and one of the few allowed hazard stripes (plinth band only). The toroid must be the widest element so arcs read as coming from it. No exposed sparks or arcs baked into the mesh.

---

### POWER CABLE: Wire-tool power lead
`cable_power` · Power & Signal · Class proc · Ship M1 · Inspired by (internal only): none

**Concept.** The rubber lead the Wire tool draws between power ports, matching the look-dev power cable: a thick black round cable with a thin LED flow stripe, ending in the shared port-ring plugs behind a Volt ferrule band. It routes itself along surfaces and glows when current flows.

| Spec | Value |
|---|---|
| Size (W×H×D) | connector · round Ø 9 mm swept along the Wire route (centreline 4.5 mm above the surface it follows; min bend radius 20 mm; 1–2 % catenary sag on unsupported spans) · any length · origin: none (world-space spline); plugs use the port centre |
| Mass · physics | none: cosmetic. Power is a logical circuit graph (SIMULATION §5.5); `cable_power` is the only Power link kind (PART_SYSTEM §3); cables have no rigid body and aren't cuttable |
| Collision | none |
| Materials (60/30/10) | neutral: `kn_rubber` jacket (fine-rib tiling normal from the shared connector trim) and the shared plugs' `kn_rubber` boots and `kn_steel_brushed` nose tips · signature: none (a cable stays neutral) · accent: `kn_anod_volt` ferrule band, `kn_led` flow stripe (2 mm wide, inlaid along the top) |
| Ports | End fittings are the shared `PLUG_S` / `PLUG_M` / `PLUG_L` from `port_ring.blend` (shared_kit §1.4), never a custom plug: rubber boot Ø 12/18/24 mm (≤ 0.454 D, inside the collar opening and the LED ring's inner edge), steel nose tip Ø 4.6/7.2/9.7 × 2.1/3.2/4.2 mm in the socket's centre bore (stops short of the 2.2/3.4/4.5 mm bore floor), nose face on the socket face, so the plug never seats deeper than the socket and the port's LED ring stays visible round the boot. The Ø 9 mm cable is narrower than every boot. The cable adds a 4 mm `kn_anod_volt` ferrule band (Ø 10 mm, never wider than the boot) on the jacket 3 mm behind the boot. The plug sits on the port's +X axis |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | `led_groups = "0:flow"` on the stripe: power colour, 25 % when connected, 100 % with a travelling pulse when flowing (speed ∝ watts), amber blink when either end port faults |
| States | connected / idle · flowing · fault |
| Animation | engine-driven stripe pulse (UV offset); no pivots |
| Fracture | none (removed with the Wire tool) |
| Skins / variants | none |
| Budget | LOD rule by projected thickness (same as BAND): ≥ 8 px → 12-vert profile, a ring every 5° of bend, 2 rings per straight run, stripe on · 3–8 px → 8 verts, 10°, stripe on · 1–3 px → 4 verts, 20°, no normal map, stripe baked into a vertex-colour band · < 1 px → engine line pass in mean albedo. Shared plugs 300 / 400 / 500 tris (shared_kit §1.5) + ferrule band ≤ 100 tris per end. Shared 1024² connector trim |
| Audio hooks | `cable_plug_in_click`, `cable_unplug_pop` (Build mode); no run-time sound (the hum belongs to the consumers) |

**Read at a glance.** A fat black cord with a faint lime thread of light and a lime band just behind each plug.
**Notes / don'ts.** Always thicker than `cable_signal` (9 vs 5 mm) so the two read apart without colour. Never route through housings; plugs enter the ring straight along +X for at least 20 mm before bending.

---

### SIGNAL CABLE: Wire-tool signal lead
`cable_signal` · Power & Signal · Class proc · Ship M1 · Inspired by (internal only): none

**Concept.** The thin sibling of `cable_power` for Signal ports: a slim black cord whose inlaid LED thread fires a visible gold pulse every time a signal travels down it, so you can watch the chain reaction run along the wires.

| Spec | Value |
|---|---|
| Size (W×H×D) | connector · round Ø 5 mm swept along the Wire route (centreline 2.5 mm above the surface; min bend radius 12 mm; 1–2 % sag) · any length · origin: none; plugs use the port centre |
| Mass · physics | none: cosmetic (signals are logical pulses resolved within the tick, SIMULATION §5.2); with `ping` it's one of the two Signal link kinds (PART_SYSTEM §3); not cuttable |
| Collision | none |
| Materials (60/30/10) | neutral: `kn_rubber` jacket (fine-rib tiling normal) and the shared plugs' `kn_rubber` boots and `kn_steel_brushed` nose tips · signature: none · accent: `kn_steel_brushed` ferrule band, `kn_led` pulse thread (1.2 mm wide, along the top) |
| Ports | End fittings are the shared `PLUG_S` / `PLUG_M` / `PLUG_L` (shared_kit §1.4), exactly as on `cable_power` (boot Ø 12/18/24 mm, nose tip Ø 4.6/7.2/9.7 × 2.1/3.2/4.2 mm, nose face on the socket face, LED ring visible round the boot); the cable adds a 3 mm `kn_steel_brushed` ferrule band (Ø 6 mm) on the Ø 5 mm jacket 3 mm behind the boot |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | `led_groups = "0:pulse"` on the thread: signal colour, 8 % idle; each Signal event sends a 0.15 m bright pulse from the out plug to the in plug at max(3 m/s, length / 0.1 s), so it never visibly lags the sim; amber blink on fault |
| States | idle · pulse travelling · fault |
| Animation | engine-driven pulse (UV offset); no pivots |
| Fracture | none |
| Skins / variants | none |
| Budget | LOD rule as `cable_power` with an 8 / 6 / 4-vert profile; below 3 px the pulse becomes a vertex-colour flash over the whole cable. Shared plugs 300 / 400 / 500 tris + ferrule band ≤ 100 tris per end. Shared 1024² connector trim |
| Audio hooks | `cable_plug_in_click`, `cable_unplug_pop` (Build mode); optional `signal_tick` per pulse, only when the cable is in camera focus |

**Read at a glance.** A thin black cord with a gold spark racing along it.
**Notes / don'ts.** The steel ferrule band (not Volt) and the thinner cable are what tell signal from power; the plugs are identical. Pulses always travel from the out port toward the in port, never in both directions.
