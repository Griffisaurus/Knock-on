# Drive briefs

Motion and power-transmission parts from [GAME_SPEC §12.3](../../../GAME_SPEC.md): conveyors, belts, ropes, gears, motors and the critter-powered drives.
Back to the [brief index and template](./README.md).

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| TREADWAY | `treadway` | M | M1 | brief |
| BAND | `band` | S | M1 | brief |
| LINE (+ CHAIN, BUNGEE) | `line` | S | M1 | brief |
| COG (S/M/L + bevel) | `cog` | S | M1 | brief |
| RACK | `rack` | S | M3 | brief |
| MOTOR | `motor` | M | M1 | brief |
| DYNAMO | `dynamo` | L | M2 | brief |
| HAMSTER DRIVE | `hamster_drive` | L | M2 | brief |
| TURBINE | `turbine` | M | M2 | brief |
| PEDAL RIG | `pedal_rig` | XL | M2 | brief |
| RAM | `ram` | M | M3 | brief |
| GRABBER | `grabber` | L | M5 | brief |

---

### TREADWAY: Modular conveyor
`treadway` · Drive · Class M · Ship M1 · Inspired by (internal only): conveyor belt

**Concept.** A low, chunky conveyor: graphite side rails, a black ribbed belt and Ignition drum guards at both ends. It's built from two end modules and a 0.1 m mid module that tiles, so every length from 0.2 m to 4 m looks like the same product.

| Spec | Value |
|---|---|
| Size (W×H×D) | (0.20–4.00) × 0.10 × 0.20 m ((2–40)×1×2), resizable along X in 0.1 m steps · origin: bottom centre of footprint. Modules: `treadway__end_l`, `treadway__end_r` (0.1 m each), `treadway__mid` (0.1 m, instanced L/0.1 − 2 times) |
| Mass · physics | 0.8 kg (ends) + 2.5 kg/m · belt `rubber` friction 1.0, e 0.2 · rails `powder` |
| Collision | `COL__box__belt` (top at z 0.092, 12 mm thick, custom prop `surface_velocity = x`), `COL__box__rail_l`, `COL__box__rail_r`, `COL__box__base`. Authored at the 0.4 m reference length; the engine stretches all four along X |
| Materials (60/30/10) | neutral: `kn_powder_graphite` rails/base, `kn_rubber_grip` belt (chevron normal), `kn_rubber` feet · signature: `kn_powder_ignition` end guards · accent: `kn_steel_brushed` axle caps and M5 screws (2 per guard face), `kn_led` chevrons, `kn_decal` name plate on the right guard |
| Ports | `PORT__spin__drive_l` · both · M · `kind = axle` · (−L/2 + 0.05, −0.101, 0.058) · −Y. `PORT__spin__drive_r` · both · M · `kind = axle` · (L/2 − 0.05, −0.101, 0.058) · −Y. Both sit on the front rail over the drum axles |
| Pivots | `PIVOT__drum_l`, `PIVOT__drum_r` · axis y · unlimited · drum (Ø 0.06, centre z 0.058) and axle caps. Belt has no pivot: the engine scrolls belt UVs (`uv_scroll = u`, 1 UV unit = 0.1 m) at ω·r, with r = 0.034 m (drum 0.030 + belt 0.004) |
| Sensors | none (conveying comes from the belt collider's surface velocity) |
| Emitters | `EMIT__jam__drum_l`, `EMIT__jam__drum_r` · drum axles, +X = +Z · jam sparks and puff |
| LEDs / screens | `led_groups = "0:dir_fwd,1:dir_rev"`: two chevron light bars (spin colour) on the top of each end guard, pointing +X and −X |
| States | idle: belt still, chevrons 8 % · running: belt scrolls, drums turn, chevrons in the travel direction 100 % · stalled: belt stops, jam puff, port amber blink |
| Animation | procedural pivots + UV scroll; no clips |
| Fracture | none |
| Skins / variants | Factory (default) · Bone (`kn_powder_bone` rails, matches Frame) · Workshop (`kn_wood_walnut` rails) |
| Budget | end ≤ 1,200 tris each, mid ≤ 200 tris (belt ribs in the normal map only); ≤ 4,000 at the 1 m reference · 2048² set shared by the three modules |
| Audio hooks | `treadway_run_loop` (pitch ∝ surface speed), `treadway_start_squeak`, `treadway_stall_grind`, `treadway_jam_puff` |

**Read at a glance.** A long, low graphite slab with a black ribbed top and orange rounded ends; the lit chevrons show which way it runs.
**Notes / don'ts.** Keep the belt top dead flat (ribs in normals only) so Topple Tiles and Rollers ride cleanly. The rail lip is only 8 mm above the belt; don't make a trough. The mid module must tile seamlessly (UV U continuous, panel line at each 0.1 m joint). Never put ports on mid modules. Every module gets a 4 mm rubber foot strip underneath.

---

### BAND: Rubber drive belt
`band` · Drive · Class S · Ship M1 · Inspired by (internal only): belt

**Concept.** A fat black rubber belt looping between two spin ports, riding on small grooved pulleys whose stub shafts seat in the port rings' bearing sockets. Moulded chevrons show the direction of travel. The crossed option twists it into a figure-8 so the far end turns backwards.

| Spec | Value |
|---|---|
| Size (W×H×D) | connector · closed loop swept along a generated path (two straight spans + two pulley wraps) · profile 16 × 4 mm rounded rectangle (r 1.5 mm) · any span the Path tool allows (art tested 0.1–10 m) · origin: none (world-space spline); end fittings use the port centre |
| Mass · physics | 0.12 kg/m (cosmetic) · `rubber` · constraint only: a `GearConstraint` between the two host hinges with ratio r₁/r₂ of the pulley grooves, negative when crossed (SIMULATION §4.4); no rigid body |
| Collision | none on the band. The engine builds a cut-test capsule chain (r 8 mm, sensor layer) from the spline for Snipper |
| Materials (60/30/10) | neutral: `kn_rubber` band (chevron tiling normal from the shared connector trim) · signature: `kn_anod_ignition` pulley flanges · accent: `kn_steel_brushed` pulley hub and stub shaft |
| Ports | End fitting `band__pulley_s/m/l`, one per end, on a spin port's `socket_axle` (shared_kit §1.3): sized like the shared plugs (shared_kit §1.4): a steel shaft tip Ø 4.8/7.1/9.5 mm (≤ 0.17 D) × 2.1/3.2/4.2 mm long (0.075 D) enters the bearing bore (0.18 D = 5.0/7.6/10.1 mm, 2.2/3.4/4.5 mm deep) and stops short of its floor, and a steel thrust collar with the PLUG boot Ø 12/18/24 mm (≤ 0.454 D, inside the LED ring's inner edge) sits on the socket face inside the collar opening, so it never seats deeper than the socket and the LED ring stays visible round it; a 24 mm stub shaft (no wider than the collar) carries the pulley 30 mm out along the port's +X; groove Ø 21/32/42 mm (0.75 × ring Ø) so the ring LED stays visible behind it from the 3/4 view. Both host ports must face the same way (engine validates) |
| Pivots | `PIVOT__pulley` per fitting · axis x (port outward) · unlimited · pulley + flanges |
| Sensors | none |
| Emitters | none authored; on a cut the engine spawns `fx/snap_rubber` at the cut point |
| LEDs / screens | none (host port rings show flow) |
| States | idle: still · running: chevrons scroll at ω·r_pulley (1 UV repeat = 0.05 m) · crossed: 180° twist at the span midpoint, 2 mm clearance where the spans cross · jammed (SIMULATION §5.3; belts never slip): chevrons stop with a shudder, host port rings blink amber · cut: two tails fall (soft rope for 1.5 s, then sleep) |
| Animation | UV scroll + pulley pivots; no clips |
| Fracture | cut by a Snipper (bands don't snap under load; they jam) → two open ribbons, ends capped with `band__fray` (≤ 80 tris) |
| Skins / variants | crossed is a property, not a skin; no skins |
| Budget | LOD rule by projected thickness: ≥ 8 px → 12-vert profile, a ring every 5° on wraps, 2 rings per straight span · 3–8 px → 8 verts, 10° · 1–3 px → 4 verts, 20°, no normal map · < 1 px → engine 1 px line in mean albedo. Pulleys ≤ 600 tris. Shared 1024² connector trim (rows: band chevrons, rope twist, bungee braid, cable ribs) |
| Audio hooks | `band_run_loop` (rubber flutter, pitch ∝ speed), `band_jam_squeal`, `band_snap` (on a cut), `band_attach_click` |

**Read at a glance.** A thick black loop with orange pulley rims at each end; moving chevrons say "this is transmitting spin".
**Notes / don'ts.** Never thinner than 16 mm: thin belts vanish at 150 px. The band plane is always 30 mm off the host face so it clears neighbouring rings. Don't texture any wear or cracks onto the rubber.

---

### LINE: Rope, chain and bungee
`line` · Drive · Class S · Ship M1 · Inspired by (internal only): rope

**Concept.** A natural three-strand rope with chunky snap hooks that clip onto tension ports. Two variants share the catalogue entry: steel CHAIN (heavy, rattly) and Ignition-braided BUNGEE (stretchy). Ropes can be cut, burned or snapped, and the frayed ends show it.

| Spec | Value |
|---|---|
| Size (W×H×D) | connector ≤ 50 m · LINE: round Ø 10 mm, 10-vert profile · CHAIN: oval links 42 × 24 mm, wire Ø 7 mm, pitch 28 mm, alternate links at 90° · BUNGEE: round Ø 12 mm · origin: none (render sweep through the engine's cosmetic verlet nodes, Catmull-Rom, a ring every 10 mm where curvature > 5°, else every 0.1 m) |
| Mass · physics | constraint only, no rigid body: `DistanceConstraint` (min 0, max L), or a `PulleyConstraint` when routed over Sheaves; BUNGEE adds a spring beyond rest length (2 Hz, damping 0.3); break impulse LINE 400 N·s, CHAIN 2,000 N·s (SIMULATION §4.4, §5.4). Cosmetic verlet mass: LINE 0.08 kg/m · CHAIN 0.32 kg/m (4× LINE) · BUNGEE 0.12 kg/m |
| Collision | none: ropes don't collide with bodies in v1 (SIMULATION §5.4). The engine builds a sensor-layer test chain along the rope (r 5 / 7 / 6 mm) for Snipper cuts and heat exposure. Hooks have none |
| Materials (60/30/10) | LINE: neutral `kn_rope` (twist normal) · signature `kn_powder_ignition` hook bodies · accent `kn_brass` thimble, `kn_steel_brushed` ferrule and gate. CHAIN: `kn_steel_brushed` links + Ignition hooks. BUNGEE: `kn_fabric_ignition` sheath (braid normal) + `kn_steel_brushed` hooks with `kn_rubber` dipped tips |
| Ports | End fitting `line__hook_s/m/l`, sized to the shared plug envelope (shared_kit §1.4): an Ignition snap-hook body whose steel gate clips over the port's `socket_hook` brass eye ring (Ø 10.1/15.1/20.2 mm, standing 0.05 D proud of the rubber, shared_kit §1.3; mechanical links never use plugs), then a brass thimble eye (Ø 18 mm loop) and a 20 mm steel crimp ferrule on the rope. The hook body stays inside the PLUG boot section, Ø 12/18/24 mm (≤ 0.454 D, inside the LED ring's inner edge), and the gate jaw hooks the eye ring from above, never entering the socket bore, so the fitting never seats deeper than the socket and the LED ring stays visible round it. Hook body length: `_s` 28 mm (1 D, so the Ø 18 mm thimble, wider than the 12 mm envelope, starts ≥ 1 D out), `_m` 23 mm and `_l` 31 mm (the boot lengths; the thimble fits inside their envelope). It clips onto `kind = hook` and `end` tension ports. Over `kind = axle` ports (Sheave) the rope runs in the groove with no fitting. BUNGEE uses `line_bungee__hook_s/m/l` (same gate) |
| Pivots | `PIVOT__swivel` per hook · axis x · unlimited · eye + ferrule, so rope twist never spins the hook |
| Sensors | none authored (heat and cut tests run on the engine's test chain) |
| Emitters | runtime only: `fx/rope_fray` at a snap or cut, `fx/ember_creep` along a burning rope |
| LEDs / screens | none |
| States | slack / taut: same look (tension shows in X-ray) · near snap: radius −10 %, creak · burning (1.5 s of heat exposure cuts it): travelling ember ring + `kn_decal` scorch band left behind · cut / snapped: `line__fray` tuft caps on both ends, tails swing. CHAIN: no burn state (fireproof); snaps to `line_chain__link_open`. BUNGEE: radius = r0 / √stretch (clamped ≥ 0.6 r0), braid UVs stretch with it |
| Animation | sweep follows the cosmetic verlet; no clips |
| Fracture | snap or cut anywhere → the constraint is removed and the `Cut` event spawns two cosmetic loose ends with end caps (SIMULATION §5.4) |
| Skins / variants | separate `kn_type`s under one catalogue entry: `line`, `line_chain`, `line_bungee`. No skins |
| Budget | rope and bungee: profile 10 / 6 / 4 verts by the BAND thickness rule, < 1 px → engine line. Chain: `line_chain__link` 96 / 40 tris instanced at the pitch; the 1–3 px band swaps to a swept 8 × 8 mm square with a chain-link normal. Hooks ≤ 800 tris. Shared 1024² connector trim |
| Audio hooks | `rope_creak_loop` (∝ tension), `rope_snap`, `rope_burn_hiss`, `rope_cut_snip`, `chain_rattle_loop` (∝ velocity), `chain_snap_clank`, `bungee_stretch_squeak`, `bungee_twang` |

**Read at a glance.** Cream rope, steel chain or orange bungee, always ending in an orange snap hook with a brass eye.
**Notes / don'ts.** Rope must stay ≥ 10 mm thick (ART_BIBLE allows strings to be thin, but Lines carry gameplay and must read). Twist direction is consistent (Z-lay). Never model knots; the hook is the only termination.

---

### COG: Spur and bevel gears
`cog` · Drive · Class S · Ship M1 · Inspired by (internal only): gear

**Concept.** CNC-anodised gears from the approved look-dev generator: chunky trapezoid teeth, five lightening holes, a steel hub and a chrome axle. All cogs share one module, so any cog meshes with any other cog and with RACK, and meshing centre distances land on half cells.

| Spec | Value |
|---|---|
| Size (W×H×D) | module 5 mm, face width 0.025 m, hub depth 0.04 m, chrome axle stub +0.015 m out the back · `cog_s`: 20 T, pitch Ø 0.10, tip Ø 0.11 → 0.11 × 0.11 × 0.055 m (⌀1) · `cog_m`: 40 T, pitch 0.20, tip 0.21 (⌀2) · `cog_l`: 60 T, pitch 0.30, tip 0.31 (⌀3) · `cog_bevel`: 20 T mitre, 45° pitch cone, pitch Ø 0.10 at heel, face 0.018 → 0.11 × 0.11 × 0.07 m · origin: axle centre |
| Mass · physics | S 0.25 · M 0.9 · L 2.0 · bevel 0.3 kg · `steel` (anodised aluminium read) |
| Collision | `COL__cylinder__body` (tip radius, 0.025 thick, custom prop `sharp = true`: teeth pop Helios on contact, SIMULATION §5.1), `COL__cylinder__hub`. The engine filters contacts between cogs linked by a GearConstraint |
| Materials (60/30/10) | neutral: `kn_steel_brushed` hub and bearing collar, `kn_chrome` axle · signature: `kn_anod_cobalt` gear body (ART_BIBLE §3.1, look-dev) · accent: `kn_decal` tooth count ("20T") on the web, spin LED in the port ring |
| Ports | `PORT__spin__axle` · both · S (`cog_s`, `cog_bevel`) / M (`cog_m`, `cog_l`) · `kind = axle` · (0, −0.0205, 0) · −Y, on a static bearing collar on the hub front (hub Ø 34 mm for S, 50 mm for M/L) |
| Pivots | `PIVOT__gear` · axis y (bevel: axis y, meshes with another bevel whose axis is at 90°, the axes meeting 0.05 m in front of each origin) · unlimited · gear body, hub, axle. The collar and port ring stay on the root |
| Sensors | none (Helio popping comes from contact with the `sharp` body collider) |
| Emitters | none authored; jam sparks spawn at the engine-computed mesh point |
| LEDs / screens | none beyond the port ring |
| States | idle · spinning (engine motion blur above 4 rps) · stalled (port amber blink, jam sparks at the mesh point) |
| Animation | procedural pivot. Root custom props `module = 0.005`, `teeth`, `pitch_r`; tooth 0 is centred on +X at rest so the engine can phase-match neighbours |
| Fracture | none |
| Skins / variants | files `cog_s`, `cog_m`, `cog_l`, `cog_bevel` (one catalogue entry with a size property). Skins: Cobalt (default), Ignition, Volt, Plasma, Graphite (all `kn_anod_*`) |
| Budget | S 1,600 · M 2,400 · L 3,000 · bevel 2,000 tris (tooth bevel 2 segments, 24-sided holes) · shared 1024² gear set |
| Audio hooks | `gear_whir_loop` (pitch = tooth-mesh frequency, teeth × rps), `gear_engage_clack`, `gear_stall_grind` |

**Read at a glance.** A blue toothed disc with five holes and a silver hub; the size is obvious from tooth count and diameter.
**Notes / don'ts.** Copy the look-dev tooth profile (root 0–15 %, rising flank to 28 %, tip land 28–47 %, falling flank to 60 %, root to 100 %; root r = pitch − 1.25 m, tip r = pitch + m; holes at 0.56 × root r, hole r 0.2 × root r). Teeth keep the look-dev 0.9 mm bevel (the tip land is only about 3.3 mm wide); every other edge gets ≥ 2 mm. Never change the module per size, or meshing breaks.

---

### RACK: Rack and pinion
`rack` · Drive · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** An Ignition toothed bar slides through a graphite guide block with a built-in pinion, turning spin into a straight push. The bar uses the cog module, so any COG can also drive its exposed teeth. A clear top window shows the pinion biting.

| Spec | Value |
|---|---|
| Size (W×H×D) | L × 0.11 × 0.10 m at rest, L = 0.2–2.0 m (2–20 cells; a 1-cell bar would have zero stroke); height 0.11 is within the +0.02 tolerance; guide block 0.1 wide × 0.1 deep × 0.11 tall at x = 0 · origin: bottom centre of the guide block |
| Mass · physics | block 0.7 kg + bar 1.2 kg/m · block `powder`, bar `steel`, end pads `rubber` (e 0.3) · `RackAndPinionConstraint` (SIMULATION §4.4) |
| Collision | `COL__box__block`, `COL__box__bar` (under the bar pivot, stretched with L), `COL__box__pad_l`, `COL__box__pad_r` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` block, `kn_steel_brushed` pinion and M3 screws (4 on the front face) · signature: `kn_anod_ignition` bar · accent: `kn_poly_clear` top window, `kn_rubber` end pads and slot lips, `kn_decal` name plate |
| Ports | `PORT__spin__pinion` · both · S · `kind = axle` · (0, −0.051, 0.075) · −Y, on the pinion axle |
| Pivots | `PIVOT__bar` · axis x · translation −(L − 0.1)/2 … +(L − 0.1)/2 m · bar + pads. `PIVOT__pinion` · axis y · unlimited · 10 T pinion (module 5 mm, pitch Ø 0.05, centre z 0.075) |
| Sensors | none |
| Emitters | `EMIT__jam__pinion` · (0, 0, 0.050) · +Z · jam sparks |
| LEDs / screens | none beyond the port ring |
| States | idle · driving: bar slides, pinion turns · end-stop: pad squash, port amber blink while still driven |
| Animation | procedural pivots. The bar is built from `rack__tooth` (one pitch, π × 5 mm = 15.708 mm, ≤ 16 tris) instanced ⌊(L − 0.03)/p⌋ times, centred, plus `rack__end_l` / `rack__end_r` pads, so any length works. Bar body z 0.016–0.044 (root line 0.04375), pitch line z 0.050, tooth tops z 0.055 |
| Fracture | none |
| Skins / variants | Ignition (default) · Cobalt (`kn_anod_cobalt` bar) |
| Budget | block ≤ 1,500 tris, ends ≤ 200 each, teeth 61 × 16; ≤ 2,900 at the 1 m reference (≤ 3,900 at 2 m) · 1024² |
| Audio hooks | `rack_ratchet_loop` (one click per tooth passing), `rack_endstop_thunk`, `rack_stall_grind` |

**Read at a glance.** A graphite block skewered by a long orange toothed bar.
**Notes / don'ts.** Teeth stay visible along the whole bar top (players mesh cogs there). The pitch line sits at z 0.050 so a COG meshing on top has its axle on the grid (centre z 0.10 / 0.15 / 0.20 for S / M / L). The pinion top reaches z 0.105, under a window whose top is z 0.110; don't let it poke through. Rubber lips at the ±X slots hide the bar's entry gap.

---

### MOTOR: Clear-shell electric motor
`motor` · Drive · Class M · Ship M1 · Inspired by (internal only): electric motor

**Concept.** The approved look-dev MOTOR, scaled to fill 2×2×2: two graphite end caps, a clear polycarbonate shell, a steel core wrapped in 14 copper winding bands, Ignition field magnets top and bottom, and a chrome shaft out of the right cap. You can watch it spin. It's the face of the Drive family.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.19 m (2×2×2); +12 mm shaft stub at +X · origin: bottom centre. Caps 0.05 × 0.19 × 0.19 at x ±0.075, centre z 0.100, 7 mm pillowed bevel (leaves a 36 mm flat on the 50 mm cap front for the PR-S power ring and its 35 mm land); shell 0.15 × 0.175 × 0.175 |
| Mass · physics | 1.6 kg · `powder` body, `rubber` feet |
| Collision | `COL__box__body`, `COL__cylinder__shaft` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` caps, `kn_steel_brushed` core and M5 screws (4 per cap front), `kn_rubber` feet (two 5 mm bars) · signature: `kn_powder_ignition` magnets (0.1 × 0.1 × 0.017 at z 0.100 ± 0.072, inner faces 1.5 mm clear of the windings), `kn_copper` windings (torus R 0.057, r 0.005, outer radius 0.062, 14 bands from x −0.048 to +0.048) · accent: `kn_poly_clear` shell, `kn_brass` commutator, `kn_chrome` shaft, `kn_led`, `kn_decal` name plate "MOTOR" + "KN-07 · 24V · 1.5 rps" on the right cap front |
| Ports | `PORT__power__in` · in · S · (−0.075, −0.096, 0.100) · −Y (front of the left cap, as in the look-dev; PR-S because a 42 mm ring doesn't fit the 50 mm cap face). `PORT__spin__out` · out · M · `kind = axle` · (0.101, 0, 0.100) · +X (right cap face; the chrome shaft stub (Ø ≤ 7.6 mm, the PR-M bearing bore) and hex coupler come out through the socket) |
| Pivots | `PIVOT__armature` · axis x · unlimited · core, windings, commutator, shaft, coupler |
| Sensors | none |
| Emitters | `EMIT__spark__brushes` · (−0.060, 0, 0.100) · +Z · stall sparks |
| LEDs / screens | `led_groups = "0:status"`: Ø 8 mm dome on top of the right cap at (0.075, −0.05, 0.196); power colour when running, amber when stalled |
| States | off: still, LED 8 % · running: armature spins (visual clamp 30 rps + blur), LED 100 %, power port flowing · stalled: armature jitters ±3°, brush sparks every 0.3 s, LED and port amber blink |
| Animation | procedural pivot. The core has 3 visible slots and a 6-segment commutator so rotation reads even though the windings are round |
| Fracture | none |
| Skins / variants | Clear (`kn_poly_clear`, default) · Beam (`kn_poly_beam`, the look-dev tint) |
| Budget | 8,000 tris · 2048² + shell thickness map. LOD2 interior → copper cylinder + two Ignition slabs; LOD3 shell opaque tinted |
| Audio hooks | `motor_hum_loop` (pitch ∝ ω, gain ∝ load), `motor_spinup`, `motor_spindown`, `motor_stall_whine`, `motor_brush_crackle`, `motor_power_click` |

**Read at a glance.** A clear box between two dark caps with a warm copper-and-orange core and a shaft sticking out the right.
**Notes / don'ts.** The look-dev cog on the shaft is not part of this asset (cogs attach through the spin port). The look-dev rings are about 52 mm; use the shared PR-M (spin) and PR-S (power). The "1.5 rps" spec text matches the gameplay numbers: no-load speed 1.5 rev/s (9.42 rad/s) and stall torque 30 N·m at full supply (≈ 71 W peak shaft power: 120 W electrical at 60 % efficiency), both scaled by the supply factor (SIMULATION §5.3); rated 120 W demand (§5.5). Feet follow ART_BIBLE (5 mm), not the 12 mm look-dev blocks. Only one clear layer sits between the camera and the windings.

---

### DYNAMO: Flywheel generator
`dynamo` · Drive · Class L · Ship M2 · Inspired by (internal only): generator

**Concept.** The MOTOR's big sibling run in reverse: it turns spin into power, and the load it carries brakes the shaft that drives it. A spoked Ignition flywheel takes spin on the left; under a clear shell, a four-pole rotor whirls inside six fat copper coils that glow brighter as output rises. A 10-cell meter on top reads the watts.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.20 × 0.19 m (3×2×2) · origin: bottom centre. Flywheel Ø 0.17 × 0.024 at x −0.136; left cap x −0.124…−0.084; shell x −0.084…0.066; right cap x 0.066…0.150 (84 mm, so its 70 mm flat inside the 7 mm cap bevels gives the PR-L ring its full land); all centred at z 0.100 |
| Mass · physics | 4.5 kg · `powder`, `rubber` feet |
| Collision | `COL__box__body`, `COL__cylinder__flywheel` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` caps, `kn_steel_brushed` hub/collars/M8 screws, `kn_rubber` feet · signature: `kn_powder_ignition` flywheel (5 spokes) and rotor poles (alternating with graphite), `kn_copper` coil bobbins · accent: `kn_poly_clear` shell, `kn_led` coil glow, `kn_screen`, `kn_decal` name plate on the right cap |
| Ports | `PORT__spin__in` · in · L · `kind = axle` · (−0.151, 0, 0.100) · −X (static bearing collar on the flywheel hub). `PORT__power__out` · out · L · (0.108, −0.096, 0.100) · −Y · `max_links = 4` |
| Pivots | `PIVOT__rotor` · axis x · unlimited · flywheel, shaft, 4-pole rotor (Ø 0.09 × 0.12). Coils stay static |
| Sensors | none |
| Emitters | `EMIT__spark__shell` · (0, 0, 0.190) · +Z · overspeed fizz (cosmetic) |
| LEDs / screens | `led_groups = "0:coil_glow,1:status"`: LED spacer strips between the coils (power colour, brightness ∝ watts); status dome on top of the left cap. `SCREEN__output` · kind bar · cells 10 · color power · `SCR_BAR_10_X15` (0.084 × 0.021 quad) rotated 90° (long axis along Y) on top of the right cap at (0.108, 0, 0.196), facing +Z |
| States | idle: still, meter dark · generating: rotor spins, coils glow ∝ W, meter cells = 10 × W/300, where W = min(300, 40 · abs(ω)) and never more than 0.6 × the shaft power delivered (SIMULATION §5.5: no free energy, 60 % efficiency; a MOTOR (≈ 71 W peak shaft power) driving it yields ≤ ≈ 42 W), port flowing. Drawing power applies a braking torque on the input hinge, τ = P_drawn / (0.6 · max(abs(ω), 1 rad/s)), so the flywheel visibly slows under load · coasting: glow fades with ω |
| Animation | procedural pivot |
| Fracture | none |
| Skins / variants | Clear (default) · Beam (`kn_poly_beam` shell) |
| Budget | 18,000 tris · 2048² + 1024² detail. LOD2 coils → copper ring block; LOD3 shell opaque |
| Audio hooks | `dynamo_whine_loop` (pitch ∝ ω), `dynamo_coil_buzz_loop` (gain ∝ W), `flywheel_whoosh`, `meter_cell_tick` |

**Read at a glance.** A wide clear drum with an orange flywheel on the left and coils that light up as it spins.
**Notes / don'ts.** Keep it visibly related to the MOTOR (same caps, shell, feet and fasteners), only bigger. The coil glow is LED faces driven by the engine; never bake emission into the copper. PR-L on both ports.

---

### HAMSTER DRIVE: Pip's wheel motor
`hamster_drive` · Drive · Class L · Ship M2 · Inspired by (internal only): mouse-cage motor

**Concept.** Pip's home and job: a big open-fronted running wheel cantilevered from a graphite stand, with a little gearbox behind a clear cover. Bump it and Pip sprints for 6 s; spin comes out the side. Brief covers the device only (Pip is in critters.md).

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.30 × 0.20 m (3×3×2) · origin: bottom centre. Wheel Ø 0.25 (inner running surface Ø 0.24), 0.10 wide, axle (0, 0.005, 0.162) along Y; base plinth 0.3 × 0.2 × 0.02; back pillar at y 0.075 |
| Mass · physics | 3.2 kg (without Pip) · `powder` stand, `steel` rungs |
| Collision | `COL__box__base`, `COL__box__pillar`, `COL__cylinder__wheel` (axis Y, under the wheel pivot), `COL__box__gearbox` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` stand/plinth, `kn_steel_brushed` rungs (24 × Ø 3 mm) and M5 screws, `kn_rubber` feet · signature: `kn_powder_ignition` back disc and front rim · accent: `kn_poly_clear` gearbox cover, `kn_brass` gears, `kn_led`, `kn_decal` name plate on the pillar |
| Ports | `PORT__spin__out` · out · M · `kind = axle` · (0.151, 0.084, 0.065) · +X, on the gearbox pod (x 0.10…0.15, y 0.058…0.110, z 0.036…0.094: a 52 mm square land for the PR-M ring; the pod clears the wheel, which ends at y 0.055, and stays within the +0.02 depth tolerance) |
| Pivots | `PIVOT__wheel` · axis y · unlimited (Spin source while Pip sprints: 5.0 rad/s, from Pip's 0.6 m/s on the 0.12 m running radius, 40 N·m stall (≈ 50 W peak shaft power), for 6 s; SIMULATION §5.3) · back disc, rim, rungs. `PIVOT__gear_a`, `PIVOT__gear_b` · axis y · unlimited · 2-stage train |
| Sensors | `SENSOR__trigger__bump` · threshold 0.05 N·s · cooldown 0.5 s · hull around the whole frame and wheel |
| Emitters | `EMIT__emote__wheel` · (0, 0, 0.32) · +Z · Pip's "zzz" / "!" bubble anchor |
| LEDs / screens | `led_groups = "0:run_timer"`: 6 LED dots (spin colour) on the plinth front lip, x −0.05…0.05, z 0.014; one goes out per second of sprint |
| States | idle: Pip curled asleep at the wheel bottom, wheel still (idle never spins, no Spin output) · bumped: Pip startles · running: 6 s sprint, wheel spins at 5.0 rad/s, timer counts 6 → 0, port flowing · winding down: wheel coasts 1 s, Pip sits and pants, then sleeps again |
| Animation | procedural pivots. Device RIG `hamster_drive_rig` (2 bones): `socket_pip` at (0, 0.005, 0.042), the bottom of the 0.24 m inner running surface (axle z 0.162 − 0.120), +X forward (Pip's `root` binds here for `sleep`, `wheel_run` and `wheel_sprint`); `socket_pip_exit` at (−0.10, −0.08, 0.024) (hop-out landing for ragdoll and recovery) |
| Fracture | none |
| Skins / variants | Classic (Ignition) · Bone (`kn_powder_bone` disc and rim) |
| Budget | 16,000 tris excluding Pip · 2048² + 1024² detail |
| Audio hooks | `wheel_squeak_loop` (rate ∝ ω), `wheel_patter_loop` (synced to Pip's run cycle), `gearbox_whir_loop`, `bump_thunk`, `wind_down_click` |

**Read at a glance.** A big orange-backed wheel with a little critter running inside it.
**Notes / don'ts.** Leave the front completely open: no spokes or rim braces in front of Pip. Fit agreed with critters.md: Pip (0.13 m long, 0.085 m tall) runs on the 0.24 m inner running surface, body centred 0.04 m above it. The axle stub ends at the back disc (no through-axle), so nothing crosses Pip's space. Rungs are evenly spaced so the footfall sync reads.

---

### TURBINE: Toy wind turbine
`turbine` · Drive · Class M · Ship M2 · Inspired by (internal only): windmill

**Concept.** A desk-toy wind turbine: three chunky Ignition paddle blades on a graphite nacelle and tapered mast. A clear window in the base shows a bevel pair turning the drive down to the spin port. Wind in, spin out.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.40 × 0.10 m (3×4×1) · origin: bottom centre. Rotor tip radius 0.145, hub at (0, −0.03, 0.25), axis Y; base 0.14 × 0.10 × 0.06 |
| Mass · physics | 1.4 kg · `powder` |
| Collision | `COL__box__base`, `COL__capsule__mast`, `COL__box__blade_a`, `COL__box__blade_b`, `COL__box__blade_c` (one 0.115 × 0.04 × 0.006 box per blade at the 25° blade pitch, under the rotor pivot: SIMULATION §5.8 gives each blade sub-shape a tangential force F_t = 0.38 × the axial wind force on it (sin 25° · cos 25°), which is the torque about the hub) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` base/mast/nacelle, `kn_chrome` nose cone, `kn_steel_brushed` M5 screws, `kn_rubber` feet · signature: `kn_powder_ignition` blades (0.115 long, root chord 0.045 → tip 0.03, 6 mm, 25° pitch at mid-span with 8° twist root to tip) · accent: `kn_poly_clear` base window, `kn_anod_cobalt` bevel pair, `kn_led`, `kn_decal` name plate on the base side |
| Ports | `PORT__spin__out` · out · M · `kind = axle` · (0, −0.051, 0.034) · −Y (base front, below the blade sweep, which starts at z 0.105) |
| Pivots | `PIVOT__rotor` · axis y · unlimited · blades, hub, nose. `PIVOT__bevel_in` · axis z and `PIVOT__bevel_out` · axis y · unlimited · in the base window |
| Sensors | none (wind acts on the blade colliders through the 25° pitch term, SIMULATION §5.8; no cut-in speed) |
| Emitters | none |
| LEDs / screens | `led_groups = "0:status"`: Ø 6 mm dome on the nacelle top (spin colour, on while turning) |
| States | still · turning: rotor ω follows wind (blur above 4 rps), bevels visible in the window, port flowing |
| Animation | procedural pivots |
| Fracture | none |
| Skins / variants | Ignition (default) · Bone (`kn_powder_bone` blades) |
| Budget | 7,000 tris · 2048² |
| Audio hooks | `turbine_whoosh_loop` (blade-pass rate = 3 × rps), `turbine_gear_whir`, `turbine_start_creak` |

**Read at a glance.** An orange three-bladed pinwheel on a dark pole.
**Notes / don'ts.** Paddle blades with rounded tips, never thin aerofoils (silhouette). The 25° pitch is gameplay: the blade colliders must match the render blades' pitch. The rotor faces −Y so wind from the front drives it. No tail fin beyond y 0.05 (depth budget).

---

### PEDAL RIG: Raccoon pedal drive
`pedal_rig` · Drive · Class XL · Ship M2 · Inspired by (internal only): monkey bike

**Concept.** A raccoon-sized exercise bike on a graphite frame, and a Spin source (it makes spin, not power): rubber saddle, chunky Ignition chainring, a spoked flywheel at the back, and a lure boom (carrot-on-a-stick) over the handlebars. Bandit pedals for 8 s per lure or fright. Brief covers the device and sockets only (Bandit is in critters.md).

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.40 × 0.40 × 0.20 m (4×4×2) · origin: bottom centre. Crank axle (0.03, 0, 0.07) along Y, crank radius 0.035; saddle top (0.00, 0, 0.18) (0.11 above and 0.03 behind the crank axis, a 73° seat angle); grips at (0.13, ±0.07, 0.39) (0.21 above the saddle); flywheel Ø 0.12 at (−0.13, −0.055, 0.08); lure boom tip (0.19, 0, 0.395) |
| Mass · physics | 5.0 kg (without Bandit) · `powder` frame, `rubber` saddle and feet |
| Collision | `COL__box__base`, `COL__hull__frame`, `COL__box__seat`, `COL__capsule__bar`, `COL__cylinder__flywheel` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` frame, `kn_steel_brushed` boom/axles/M5 screws, `kn_rubber` saddle/feet, `kn_rubber_grip` grips and pedals · signature: `kn_anod_ignition` chainring (Ø 0.09) and crank arms (0.035), `kn_powder_ignition` flywheel spokes · accent: `kn_brass` bell, `kn_led` console, `kn_decal` name plate on the console |
| Ports | `PORT__spin__out` · out · M · `kind = axle` · (−0.13, −0.076, 0.08) · −Y (static collar on the flywheel hub). `PORT__tension__bait` · both · S · `kind = hook` · (0.195, 0, 0.385) · +X (hang any shiny part from it on a LINE and it dangles in front of Bandit as the lure; the Lure channel has no link kind, PART_SYSTEM §3) |
| Pivots | `PIVOT__crank` · axis y · unlimited (1.0 rev/s while Bandit pedals at 1×) · chainring + arms. `PIVOT__pedal_l`, `PIVOT__pedal_r` · axis y · counter-rotate to stay level. `PIVOT__flywheel` · axis y · unlimited (3:1 to the crank: 3.0 rev/s, the Spin output speed at the port, 25 N·m stall (≈ 118 W peak shaft power), 8 s per stimulus; SIMULATION §5.3). The chain is a swept band with a chain-link normal, UV-scrolled with the crank |
| Sensors | `SENSOR__lure__range` · sphere r 1.5 m centred on the saddle · a shiny Lure (SIMULATION §5.11) in range, or hanging from the bait hook, starts an 8 s run. `SENSOR__sound__ear` · r 0.05 at the saddle · listener point for Sound events (startles when the effective loudness reaches Bandit's dB threshold, SIMULATION §5.10) |
| Emitters | `EMIT__emote__seat` · (0.00, 0, 0.68) · +Z · Bandit's emote anchor, above his seated ear tips (≈ 0.56: saddle 0.18 + shoulder 0.24 + neck and 0.12 m head) |
| LEDs / screens | `led_groups = "0:timer,1:lure_seen"`: 8 LED segments on the handlebar console (spin colour, one goes out per second); one lure-colour dot that lights when a lure is detected |
| States | idle: empty rig, or Bandit lounging on the saddle · triggered: Bandit mounts · pedalling: crank and flywheel spin, timer 8 → 0, port flowing · coasting: flywheel spins down over 1.5 s |
| Animation | procedural pivots. Device RIG `pedal_rig_rig` (9 bones): `root`; `crank` (copies `PIVOT__crank`); `socket_pedal_l` (+Y side) and `socket_pedal_r` (children of `crank`, r 0.035, kept level) → Bandit `foot_l` / `foot_r` IK; `socket_seat` → `spine_01` / pelvis; `socket_grip_l` / `socket_grip_r` → `hand_l` / `hand_r` IK; `socket_mount` at (−0.25, −0.15, 0) (approach point); `socket_lure_look` at the boom tip (gaze target). Bandit faces +X. Bandit clips needed: `pedal` (one cycle = one crank turn), `pedal_mount`, `pedal_dismount` |
| Fracture | none |
| Skins / variants | Ignition (default) · Bone (`kn_powder_bone` flywheel spokes) |
| Budget | device 15,000 tris, validated on its own (Bandit's ≈ 45,000 is budgeted in critters.md). It sits in the XL row only because GAME_SPEC §19.6 lists "Bandit + Pedal Rig" there; at 15,000 it is below the 25,000 XL floor by design (a device with a critter rig socket, not a critter) · 2048² + 1024² detail |
| Audio hooks | `pedal_crank_loop` (rate ∝ ω), `chain_whir_loop`, `flywheel_whoosh`, `bell_ding` (on start; cosmetic, not a Sound event), `saddle_squeak` |

**Read at a glance.** A small dark exercise bike with an orange chainring and a dangling shiny on a stick.
**Notes / don'ts.** Fit agreed with critters.md (Bandit): the saddle is 0.11 m above the crank axis, the crank radius is 0.035 m, and the grips are 0.21 m above the saddle (seated shoulder height 0.24 m). Keep the saddle close over the crank (0.03 m behind it): the pedals then sweep 0.08–0.15 m from the saddle top, inside Bandit's 0.20 m hip-to-sole reach (critters.md; the far pedal is at ≈ 75 % extension), so never move it further back. Keep the front (−Y) side clear of the frame between crank and saddle so Bandit's legs read in side view. The lure boom is steel and thin, so the dangling item is the hero.

---

### RAM: Pneumatic piston
`ram` · Drive · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A square graphite cylinder with a chrome rod and a fat Ignition pusher head. A clear window along the barrel shows the piston slide. It fires forward on a pulse and retracts with a hiss.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × D m, D = 0.2–1.0 (1×1×(2–10)), resizable in 0.1 m steps; stroke = D/2 · origin: bottom centre (retracted). Modules: `ram__cap_rear` (0.05), `ram__barrel` (0.1, tiled), `ram__cap_front` (0.05 incl. head) |
| Mass · physics | 0.8 kg + 0.6 kg/m · body `powder`, head `rubber` (e 0.3, friction 0.9) · rod + head are a body on a `SliderConstraint` with a position motor and limits (SIMULATION §4.4); rated 100 W (§5.5) |
| Collision | `COL__box__body` (stretched with D), `COL__cylinder__rod`, `COL__cylinder__head` (both under the rod pivot, on the slider body) |
| Materials (60/30/10) | neutral: `kn_powder_graphite` barrel, `kn_steel_brushed` front cap and M5 screws (4 per cap side), `kn_chrome` rod (Ø 0.024), `kn_rubber` feet · signature: `kn_powder_ignition` pusher head (Ø 0.08 × 0.025) and rear cap · accent: `kn_poly_clear` side window (both ±X faces), `kn_rubber_grip` head face, `kn_led`, `kn_decal` name plate |
| Ports | `PORT__power__in` · in · S · (0, D/2 − 0.030, 0.100) · +Z. `PORT__signal__in` · in · S · (0, D/2 − 0.075, 0.100) · +Z |
| Pivots | `PIVOT__rod` · axis y · translation −stroke … 0 m (negative = toward the front) · rod, head, piston |
| Sensors | none (impact comes from the motor-driven head) |
| Emitters | `EMIT__exhaust__vent` · (0, D/2, 0.05) · +Y · retract hiss puff |
| LEDs / screens | `led_groups = "0:armed,1:extended"`: two Ø 6 mm domes on the top face near the front (power and signal colours) |
| States | retracted · firing: extends in 0.08 s · extended: holds · retracting: 0.4 s, vent puff |
| Animation | procedural pivot; no clips |
| Fracture | none |
| Skins / variants | Ignition (default) · Bone (`kn_powder_bone` head and rear cap) |
| Budget | 5,000 tris at D = 0.5 · 2048² |
| Audio hooks | `ram_fire_thump`, `ram_retract_hiss`, `ram_endstop_clunk` |

**Read at a glance.** A dark rectangular tube with a big orange punch-pad on the front.
**Notes / don'ts.** The barrel module tiles cleanly (window segments join at the panel lines). The head (Ø 0.08) can't be wider than the 0.10 square barrel, so it reads as the business end through colour and roundness: the only bright, round element on the front face. No hydraulic hoses; the ports are the only connections.

---

### GRABBER: Desktop robot arm
`grabber` · Drive · Class L · Ship M5 · Inspired by (internal only): none

**Concept.** A friendly desktop robot arm with Ignition links, graphite joints and clear joint caps showing servo gears. It picks from zone A and places at zone B with deterministic IK. It parks upright and does a small idle "scan".

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.50 × 0.20 m (2×5×2) in park pose · origin: bottom centre (yaw axis). Plinth 0.19 × 0.19 × 0.06 (tall enough for the PR-M ring); turntable Ø 0.15 on top of it; shoulder z 0.10; upper arm 0.17; forearm 0.15; wrist z 0.42; gripper tip z 0.495; reach 0.39 m from the shoulder |
| Mass · physics | 3.5 kg · `powder` (all links kinematic) |
| Collision | `COL__box__plinth`, `COL__cylinder__turntable`, `COL__capsule__upper`, `COL__capsule__fore`, `COL__box__gripper`, `COL__box__finger_l`, `COL__box__finger_r` |
| Materials (60/30/10) | neutral: `kn_powder_graphite` plinth/turntable/joint housings, `kn_steel_brushed` M5 screws and servo gears, `kn_rubber` feet · signature: `kn_powder_ignition` upper arm and forearm · accent: `kn_poly_clear` joint caps, `kn_rubber_grip` finger pads, `kn_led`, `kn_decal` name plate on the plinth front |
| Ports | `PORT__power__in` · in · M · (−0.045, −0.096, 0.032) · −Y · draws 100 W (SIMULATION §5.5; a weak supply slows the IK playback by the supply factor). `PORT__signal__in` · in · S · (0.050, −0.096, 0.032) · −Y |
| Pivots | `PIVOT__yaw` · z · ±180°. `PIVOT__shoulder` · local x · −15…+105°. `PIVOT__elbow` · local x · −140…+140°. `PIVOT__wrist_pitch` · local x · ±110°. `PIVOT__wrist_roll` · local z · ±180°. `PIVOT__finger_l`, `PIVOT__finger_r` · local x translation 0.01…0.04 m (grip width 0.02–0.08 m) |
| Sensors | `SENSOR__catch__jaw` · box 0.06 × 0.03 × 0.04 between the fingers · detects the body to grip |
| Emitters | `EMIT__fault__gripper` · gripper tip · +Z · amber puff when zone A is empty |
| LEDs / screens | `led_groups = "0:status,1:holding,2:zone_a,3:zone_b"`: status dome on the turntable; holding ring on the wrist; two dots marked A and B on the plinth top (signal colour, lit while targeting) |
| States | park/idle · seeking A · gripping (fingers close, holding LED) · carrying · placing at B · returning · fault (target missing: shrug + amber) |
| Animation | IK playback drives the pivots. Baked clips: `grabber__idle` (4 s scan loop), `grabber__park` (1.0 s), `grabber__shrug` (1.5 s) |
| Fracture | none |
| Skins / variants | Factory (Ignition links, default) · Lab (`kn_powder_bone` links) |
| Budget | 20,000 tris · 2048² + 1024² detail |
| Audio hooks | `servo_whine_loop` (per joint, pitch ∝ joint speed), `gripper_close_click`, `gripper_open`, `grabber_park_clunk`, `grabber_shrug_beep` |

**Read at a glance.** An upright orange robot arm on a dark round base, claws at the top.
**Notes / don'ts.** The zone A/B markers are UI overlays (ui_icons.md), not modelled. The link proportions must allow the folded park pose to fit within 0.5 m. No humanoid face or eyes: it's a tool with charm, not a critter.
