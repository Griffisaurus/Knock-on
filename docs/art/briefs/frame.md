# Frame: asset briefs

Structure from GAME_SPEC §12.2: quiet Bone + Cobalt pieces (ART_BIBLE §3.3) that let the moving parts pop. Many are resizable or path-drawn, so each brief states how it is authored for resizing.

Template and conventions: [README](./README.md)

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| BRIK | `brik` | S | M1 | brief |
| PLANK | `plank` | S | M1 | brief |
| SLOPE | `slope` | S | M1 | brief |
| TUBE | `tube` | S | M1 | brief |
| GUTTER | `gutter` | S | M2 | brief |
| VORTEX | `vortex` | S | M2 | brief |
| LEDGE | `ledge` | S | M1 | brief |
| FULCRUM | `fulcrum` | M | M1 | brief |
| SPRONG | `sprong` | M | M2 | brief |
| TRAP BOX | `trap_box` | M | M2 | brief |
| SCOOP | `scoop` | S | M2 | brief |
| ANCHOR | `anchor` | S | M1 | brief |
| SHEAVE | `sheave` | S | M1 | brief |
| FLAP | `flap` | S | M2 | brief |
| GLIDEPATH | `glidepath` | M | M3 | brief |
| SPINDECK | `spindeck` | M | M3 | brief |
| LIFT | `lift` | M | M3 | brief |

---

### BRIK: Brush-laid brick
`brik` · Frame · Class S · Ship M1 · Inspired by (internal only): brick wall

**Concept.** A chunky, matte terracotta brick with tooled mortar edges, laid by the hundred with a brush tool into walls that collapse believably. Every brick is its own body, so a wall reads as solid until it crumbles course by course.

| Spec | Value |
|---|---|
| Size (W×H×D) | full 0.20 × 0.10 × 0.10 m (2×1×1) · half 0.10 × 0.10 × 0.10 m · origin: brick centre (= centre of mass; each brick is a free body) |
| Mass · physics | full 3.6 kg, half 1.8 kg · `phys = brick` · restitution 0.05 · friction 0.70 · root `kn_mortar_break = 12` (N·s, default break impulse of the fixed joints to neighbours; Inspector 4–40) · "Anchored" toggle fixes the bottom course to the world |
| Collision | `COL__box__0` 0.200 × 0.100 × 0.100 (half: 0.100³), convex radius 3 mm |
| Materials (60/30/10) | `kn_brick` only (1 material). Brick face ~85 %, mortar mask ~15 % (Bone-toned mortar, so the Frame Bone note is carried by the joints). Per-instance value jitter of ±4 % comes from the engine instance seed. Brick is the deliberate exception to Frame Bone + Cobalt |
| Ports | none. Impact is resolved by contacts |
| Pivots | none |
| Sensors | none |
| Emitters | none (micro debris spawns at the contact point from the shared `brick` debris set) |
| LEDs / screens | none |
| States | laid (jointed) / loose (mortar broken) / chipped. In Build mode, Anchored bricks show the engine's Cobalt selection tint. There is no geometry for it |
| Animation | none |
| Fracture | **no fracture**. Mortar joints break (constraints). Chips: alternate LOD0 meshes `brik__chip_a` (corner) and `brik__chip_b` (edge), swapped in on a hit ≥ 6 N·s with no collider change, plus 3–6 brick shards from the debris library |
| Skins / variants | full and half bricks. 4 face variants via UV offset in the shared brick trim |
| Budget | **instancing-heavy: LOD0 ≤ 300 tris** (full ~280, half ~200, chips ≤ 300) · 1 material · no transmission · shared 1024² brick trim (BaseColor, ORM and Normal including the mortar mask) |
| Audio hooks | `brik.impact_hard` (clack) · `brik.chip` · `brik.mortar_break` (gritty crunch) · `brik.scrape` · `brik.collapse_rumble` (aggregate, triggered when many joints break in one tick) |

**Read at a glance.** Terracotta blocks with pale joint lines. A wall reads as a wall from across the room.
**Notes / don'ts.** Resizing is done by the brush, not by scaling: it lays modules in running bond (alternate courses offset by half a brick, ends filled with half bricks, corners turned as headers) on the 0.1 m grid. The mortar is visual. Each brick face has a 5 mm 45° tooled chamfer on its perimeter (this chamfer is the edge bevel, 3 segments; ≥ 3 mm = 1.5 % of 0.20 m), and the mortar mask band covers the 5 mm chamfer, so two touching bricks show a 10 mm joint. Bricks touch with no gap, for stable stacking. Never model mortar as separate geometry or as a gap, and never fracture a brick.

---

### PLANK: Board / beam
`plank` · Frame · Class S · Ship M1 · Inspired by (internal only): wood wall

**Concept.** A warm oak beam with Cobalt-dipped end grain, the classic analog building stick. It bridges, props, levers and dominoes, and it burns and splinters believably. The wood grain runs continuously however long the beam is.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.10 × 0.20–4.00 m (1×1×2–40; length along Y as catalogued) · origin: geometric centre (= centre of mass) |
| Mass · physics | 0.6 kg per 0.1 m of length (oak 600 kg/m³; 0.2 m = 1.2 kg, 4 m = 24 kg) · `phys = wood` · restitution 0.20 · friction 0.55 · root `kn_break_impulse = 18` (N·s, halved once char ≥ 0.6) |
| Collision | `COL__box__0`, stretched to length, convex radius 4 mm |
| Materials (60/30/10) | neutral: `kn_wood_oak`, ~90 % (baked to a tiling trim) · signature: `kn_powder_cobalt` end dip, 15 mm deep at both ends, ~7 % · accent: Bone "PLANK" `kn_decal` stencil, once per side on beams ≥ 0.5 m, ~3 % |
| Ports | none. Impact and Heat are resolved by contacts and heat accumulation, so no ring |
| Pivots | none |
| Sensors | none |
| Emitters | `EMIT__flame__seg` at the top centre of each mid module (+X up). The engine uses every 5th one (every 0.5 m) for flames and embers |
| LEDs / screens | none |
| States | clean / charring / burning / broken. Char is engine parameter `char` 0–1: albedo toward `#1E1A17`, roughness 0.9, ember cracks through the Emissive **mask** (colour from the engine) |
| Animation | none |
| Fracture | **splinters**: `FRAC__0..9`, authored for a 0.2 m section. 2 jagged end chunks plus 8 slivers along the grain, each ≤ 600 tris, interior faces `kn_interior_wood`. On a break, the engine splits the beam at the nearest module boundary into two bodies and swaps in the splinter set for the 0.2 m around the break |
| Skins / variants | `kn_skins = "oak,walnut"` (walnut = `kn_wood_walnut`) |
| Budget | end module ≤ 300 tris, mid module 40 tris → a 4 m beam = 2 × 300 + 39 × 40 ≈ 2,160 tris · 2 slots + decal · 1024² tiling wood trim (1 m grain repeat) |
| Audio hooks | `plank.impact_soft` / `plank.impact_hard` (hollow wood knock) · `plank.slide` · `plank.splinter` (crack plus tear) · `plank.ignite` · `plank.burn_loop` (crackle) · `plank.char_collapse` |

**Read at a glance.** A honey-wood stick with blue-tipped ends.
**Notes / don'ts.** Resizing uses **modular segments**: 2 × `plank__end` (0.05 m, end grain, Cobalt dip) + n × `plank__mid` (0.10 m, n = 1–39), so L = 0.1 + 0.1·n. The engine offsets mid-module UV V so the grain runs continuously. The bevel (4 mm, 4 segments) follows the 0.1 m cross-section, not the length; 1.5 % of 4 m would be absurd. No knots, cracks or grime decals. End grain uses ring texture, not a flat colour.

---

### SLOPE: Ramp
`slope` · Frame · Class S · Ship M1 · Inspired by (internal only): incline

**Concept.** A crisp Bone deck with Cobalt side rails and a knife-edge nose that hands balls cleanly onto the floor. It sets at any angle in 5° steps and is the most-used piece in the game, so it must be quiet and perfectly readable.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20–2.00 × 0.05 × 0.20–0.80 m (length 2–20 on X × width 2–8 on Y; default 0.60 × 0.05 × 0.20), authored flat · origin: bottom centre of the flat footprint. The engine tilts it about the low-edge axis (x = −L/2, z = 0) in 5° steps |
| Mass · physics | static (anchored) · `phys = powder` · friction 0.50 · restitution 0.30 |
| Collision | `COL__box__deck` (stretched) · `COL__hull__nose` (8-vertex wedge) · `COL__box__rail_l`, `COL__box__rail_r` (only when Rails is on) |
| Materials (60/30/10) | neutral: `kn_powder_bone` deck, ~62 % · signature: `kn_powder_cobalt` rails and side fascia, ~30 % · accent: `kn_rubber` underside strips, `kn_steel_brushed` M3 screws at rail ends, ~8 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none (the angle is a placement property) |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state. Rails on/off is an Inspector toggle (default on) |
| Animation | none |
| Fracture | none |
| Skins / variants | Rails on / off |
| Budget | LOD0 ≤ 1,800 tris at maximum size · 3 slots · deck top uses a 1024² tiling grip-rib Normal on UV2 |
| Audio hooks | `slope.roll_loop` (per-ball surface layer: hollow powdered deck) · `slope.impact_soft` / `slope.impact_hard` · `slope.rail_clip` (ball hits a rail) |

**Read at a glance.** A pale tilted plank with blue edges and a sharp lip.
**Notes / don'ts.** Resizing is a **9-slice deck**: fixed 0.05 × 0.05 m corners, edges stretch along one axis, centre stretches along both. The low end (−X) is a fixed 0.08 m tapered nose, 0.05 → 0.006 m (ART_BIBLE allows the Slope edge to be a wedge). The high end is a fixed r 0.02 bullnose. Rails are 0.015 wide × 0.015 above the deck (overall 0.065 tall with rails on, inside the ±0.02 m bounds tolerance of the 0.05 footprint), inside the width footprint, and stop 0.08 m short of the nose so balls exit cleanly. Underside: two 10 mm × 3 mm rubber strips along the length. The nose must stay flush with z = 0 at every angle: balls must not bump at the transition.

---

### TUBE: Clear tube (straight, elbow, tee, spiral, loop)
`tube` · Frame · Class S · Ship M1 · Inspired by (internal only): pipe

**Concept.** A crystal-clear polycarbonate tube with Cobalt joint collars, wide enough for **every Roller**, including THUD and BOING. Balls race through it in full view. It is drawn as a path, so it should feel like premium marble-run tubing at any length. A slim variant (`tube_slim`) exists for marble runs and small balls.

| Spec | Value |
|---|---|
| Size (W×H×D) | `tube`: outer ⌀0.300 m (⌀3), wall 6 mm, **bore ⌀0.288 m** · `tube_slim`: outer ⌀0.120 m (⌀1.2), wall 5 mm, bore ⌀0.110 m · path length free (0.1 m minimum segment) · origin: the run's first control point on the centreline. Authored pieces have their origin at the joint-face centre on the centreline |
| Mass · physics | static · `phys = glass` · friction 0.25 · restitution 0.40 |
| Collision | static `COL__mesh` generated from the sweep (16-side inner and outer surfaces), chunked at 2 m or 4k tris, whichever comes first (tight bends hit 4k first; ASSET_PIPELINE §3.4). Authored pieces (tee, mouth, stop) carry their own `COL__mesh__0` |
| Materials (60/30/10) | neutral: `kn_poly_clear` shell, ~72 % · signature: `kn_powder_cobalt` collars and mouth rims, ~22 % · accent: `kn_powder_bone` support clips, `kn_steel_brushed` M3 screws, `kn_rubber` feet, ~6 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state (balls are visible inside). At LOD3 and impostor the shell goes opaque, Beam-tinted |
| Animation | none |
| Fracture | none |
| Skins / variants | Types `tube` (wide, default) and `tube_slim`. A wide ↔ slim **reducer** piece, `tube__reducer` (0.20 m long cone), joins them. `kn_skins = "clear,beam"` (`kn_poly_beam` tint) |
| Budget | straight sweep 64 tris per span (32-side single surface; collars cover the joints) · curved: one ring every 5°, 64 tris per ring step (a 90° elbow ≈ 1,150 tris at any radius) · collar ≤ 600 · mouth ≤ 900 · stop ≤ 700 · tee ≤ 2,400 · clip and post ≤ 500 · 3 slots · 1024² Thickness map (6 mm wide, 5 mm slim) |
| Audio hooks | `tube.roll_loop` (hollow plastic whirr, per ball size) · `tube.impact_soft` · `tube.collar_tick` (ball crosses a joint at speed) · `tube.exit_pop` (ball leaves a mouth) |

**Read at a glance.** A glassy pipe with blue rings at the joints and coloured balls visible inside.
**Notes / don'ts.** **Spline-swept profile**: `tube__profile` is a 32-side circle (24 at LOD1, 16 at LOD2, 8 at LOD3), and the path tool sweeps it. Model the render shell as a **single outer surface** with a Thickness map (6 mm wide, 5 mm slim), so a tube is only two transparent layers (ART_BIBLE §7).

| Piece | Wide `tube` | `tube_slim` |
|---|---|---|
| `__collar` (Cobalt, 2 × M3 on the front, every joint, ≤ 0.5 m apart) | OD 0.320 × 0.030 m | OD 0.132 × 0.024 m |
| `__mouth` (open bell) | bore 0.288 → 0.340 over 0.06 m | bore 0.110 → 0.140 over 0.04 m |
| `__stop` (closed cap, internal rubber bumper) | ✓ | ✓ |
| `__tee` (run + branch) | 0.70 m run + 0.35 m branch, blend r 0.15 | 0.30 m run + 0.15 m branch, blend r 0.06 |
| `__clip` (Bone saddle on a Cobalt post, 0.1 m modules, rubber foot) | post ⌀0.03 | post ⌀0.02 |
| Elbow centreline bend radius (45°/90° presets) | ≥ 0.36 m | ≥ 0.15 m |
| Spiral preset (helix) | centreline r 0.45 m, pitch ≥ 0.36 m/turn | r 0.20 m, pitch ≥ 0.16 m/turn |
| Loop preset (vertical) | centreline ⌀1.20 m, 0.34 m lateral offset | ⌀0.50 m, 0.14 m offset |

The wide bore passes **every Roller**: THUD ⌀0.22, BOING ⌀0.24, PIG IRON, HELIO ⌀0.25 (it floats along the top), and the small balls, which rattle around inside. That is gameplay-critical. `tube_slim` passes only STITCH, FUZZ, YOLK and GLINT/BEARING; larger balls stop at a slim mouth. `tube__reducer` funnels wide → slim, and anything too big jams at the cone (a readable failure).

---

### GUTTER: Open half-pipe
`gutter` · Frame · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** An open, rolled-edge half-pipe: Bone inside, Cobalt outside. It's sized to match the wide TUBE, so every Roller runs inside it. It is drawn as a path, like TUBE, but it reads as an open channel. A slim variant (`gutter_slim`) matches `tube_slim`.

| Spec | Value |
|---|---|
| Size (W×H×D) | `gutter` ⌀3: outer r 0.150, wall 5 mm, channel inner r 0.145, ⌀12 mm out-turned bead lips (overall 0.312 wide × 0.156 tall) · `gutter_slim` ⌀1.2: outer r 0.060, wall 4 mm, inner r 0.056, ⌀8 mm lips (0.128 × 0.064) · path length free · origin: the run's first control point, at the channel floor centre |
| Mass · physics | static · `phys = powder` · friction 0.40 · restitution 0.35 |
| Collision | static `COL__mesh` from the sweep (12-side half profile, lips and outer). Authored pieces carry `COL__mesh__0` |
| Materials (60/30/10) | neutral: `kn_powder_bone` channel interior, ~58 % · signature: `kn_powder_cobalt` exterior and lips, ~32 % · accent: `kn_steel_brushed` joint straps and rivets, `kn_rubber` stop bumper and feet, ~10 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state |
| Animation | none |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | straight sweep ≈ 128 tris per span (≈ 64 profile edges: inner and outer arcs 24 each, two bead lips 8 each) · curved: one ring every 5°, ≈ 128 tris per ring step (a 90° bend ≈ 2,300 tris) · strap ≤ 300 · stop ≤ 600 · spout ≤ 600 · saddle and post ≤ 500 · 3 slots · no unique textures |
| Audio hooks | `gutter.roll_loop` (open, brighter than tube) · `gutter.impact_soft` / `gutter.impact_hard` · `gutter.strap_tick` · `gutter.lip_ride_loop` (big ball rolling on the lips) |

**Read at a glance.** A blue trough with a pale inside and visible balls.
**Notes / don'ts.** **Spline-swept profile**: `gutter__profile` is a semicircle with a wall and bead lips (24 segments on the arc at LOD0). The path tool can bank it up to ±30° on curves, with a minimum centreline bend radius of 0.36 m (slim: 0.15 m) and a maximum gradient of 60°. Pieces: `gutter__strap` (15 mm steel band at every joint, at most 0.5 m apart, 2 rivets); `gutter__stop` (closed Bone end cap with a rubber bumper face); `gutter__spout` (open end, lip extended 0.03 m with a drip nose so balls launch cleanly); `gutter__saddle` (Bone cradle on a Cobalt ⌀0.02 post in 0.1 m modules with a rubber foot). Every Roller runs inside the wide gutter. In `gutter_slim`, balls wider than 0.112 m ride on the lips and fall off on curves. That is intended, so keep the lips round and smooth. Use two material slots on one sweep (in and out), not two meshes.

---

### VORTEX: Funnel
`vortex` · Frame · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** A wide coin-funnel bowl: Bone inside, Cobalt outside. Balls spiral down faster and faster before dropping through the centre. Its outlet is a wide-TUBE socket, so a vortex chains straight into a tube run and passes every Roller. `vortex_slim` (⌀4) has a slim-tube outlet.

| Spec | Value |
|---|---|
| Size (W×H×D) | `vortex` 0.80 × 0.45 × 0.80 m (⌀8) · `vortex_slim` 0.40 × 0.25 × 0.40 m (⌀4) · origin: bottom centre of the outlet spigot |
| Mass · physics | static · `phys = powder` · friction 0.15 (low, so balls keep spiralling) · restitution 0.30 |
| Collision | static `COL__mesh__0`: bowl inner 48 radial × 16 rings (≈ 1,540 tris) + outer 24 × 8 (≈ 380 tris) ≈ 1,920 tris, ≤ 2,000 |
| Materials (60/30/10) | neutral: `kn_powder_bone` bowl interior, ~60 % · signature: `kn_powder_cobalt` exterior and spigot collar, ~30 % · accent: `kn_steel_brushed` rim bead and 3 × M3 mount-tab screws (S part: M3, shared_kit §2), ~10 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state |
| Animation | none |
| Fracture | none |
| Skins / variants | Tripod toggle: `vortex__tripod` adds 3 Cobalt ⌀0.02 legs with rubber feet, raising the bowl 0.30 m |
| Budget | LOD0 ≤ 2,800 tris · 3 slots · 1024² Normal (6 faint helical grooves, 0.8 mm) |
| Audio hooks | `vortex.spiral_loop` (rising-pitch roll that speeds up as the radius shrinks) · `vortex.drop` (ball falls through the throat) · `vortex.impact_soft` |

**Read at a glance.** A big pale bowl with a blue underside: a target from above.
**Notes / don'ts.** Wide bowl profile (r, z): rim (0.395, 0.445) → (0.32, 0.41) → (0.25, 0.35) → (0.20, 0.27) → (0.165, 0.19) → throat (0.144, 0.08), then a straight bore of ⌀0.288 down to z = 0. The spigot is a Cobalt collar with OD 0.320, matching the wide `tube__collar`. Slim profile (r, z): rim (0.195, 0.245) → (0.15, 0.225) → (0.11, 0.195) → (0.08, 0.155) → (0.065, 0.11) → throat (0.055, 0.05), bore ⌀0.110, collar OD 0.132; balls wider than its throat settle in the centre. Both rims have a ⌀12 mm steel bead. The helical grooves are Normal only, with no geometry and no friction effect. The profile must be a smooth curve, because a faceted bowl makes balls hop.

---

### LEDGE: Shelf / platform
`ledge` · Frame · Class S · Ship M1 · Inspired by (internal only): none

**Concept.** A flat Bone platform with a Cobalt fascia and corner screws, the go-to floating floor of any machine. The top is etched with the build grid, so players can line things up by eye.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20–2.00 × 0.05 × 0.20–2.00 m (2–20 × 2–20; default 0.40 × 0.05 × 0.40) · origin: bottom centre |
| Mass · physics | static (anchored) · `phys = powder` · friction 0.50 · restitution 0.30 |
| Collision | `COL__box__0`, stretched, convex radius 4 mm |
| Materials (60/30/10) | neutral: `kn_powder_bone` top and underside, ~65 % · signature: `kn_powder_cobalt` 0.05 m edge fascia, ~28 % · accent: `kn_steel_brushed` M3 screws (one per top corner; S part: M3, shared_kit §2), `kn_rubber` corner pads underneath, ~7 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state |
| Animation | none |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 600 tris at any size · 3 slots · 1024² tiling Normal on UV2 (0.1 m grid etch, 0.6 mm lines) |
| Audio hooks | `ledge.impact_soft` / `ledge.impact_hard` (solid powdered panel) · `ledge.roll_loop` (surface layer) |

**Read at a glance.** A pale slab with a blue edge.
**Notes / don'ts.** Resizing is a **9-slice panel**: fixed 0.05 × 0.05 m corners (with the corner screw and 6 mm pillowed bevel), edges stretch along one axis, centre stretches along both. The grid etch lives on UV2 in world-scale units, so lines always land on the 0.1 m build grid. Never stretch the corners or the screws. Underside pads (4 × Ø 0.03 × 3 mm) sit only under the corners, and they must not add height to the footprint beyond 0.05 m.

---

### FULCRUM: Seesaw
`fulcrum` · Frame · Class M · Ship M1 · Inspired by (internal only): teeter-totter

**Concept.** An oak beam on a chunky Ignition A-frame, held by a fat brass pin. Drop something on one end and the other end flings. Graphite end caps carry Line hooks, so it doubles as a lever that pulls triggers.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.60 × 0.10 × 0.20 m (6×1×2, level pose; the pin ends add 0.01 m each side) · origin: **hinge axis centre** at the pin, 0.065 m above the floor |
| Mass · physics | beam 1.0 kg (dynamic, hinged) · base 2.5 kg (anchored) · beam `phys = wood`, friction 0.55 · caps and base `phys = powder` |
| Collision | `COL__box__beam` 0.56 × 0.025 × 0.10 at (0, 0, 0.022) · `COL__box__cap_l` and `COL__box__cap_r` 0.04 × 0.04 × 0.10 at (±0.28, 0, 0.022) · `COL__hull__base` (6-vertex prism) |
| Materials (60/30/10) | neutral: `kn_wood_oak` beam and `kn_powder_graphite` caps, ~60 % · signature: `kn_powder_ignition` base, ~30 % · accent: `kn_brass` pin ⌀0.018, `kn_rubber` stops and feet, port rings, ~10 % |
| Ports | `PORT__tension__end_l` · dir both · PR-S · kind hook · (−0.28, −0.05, 0.022) · facing −Y · `PORT__tension__end_r` · dir both · PR-S · kind hook · (0.28, −0.05, 0.022) · facing −Y. Both are on the cap fronts and ride the beam pivot |
| Pivots | `PIVOT__beam` · axis y · −12° to +12° · moves the beam, caps and both end ports |
| Sensors | none. Impact is resolved by contacts |
| Emitters | none |
| LEDs / screens | none (the end rings show tension activity) |
| States | level / tipped left / tipped right (resting on a rubber stop) |
| Animation | procedural `PIVOT__beam` only |
| Fracture | none |
| Skins / variants | `kn_skins = "oak,walnut"` (beam wood) |
| Budget | LOD0 ≤ 4,500 tris · 3 slots (+ linked rings) · 1024² baked oak for the beam |
| Audio hooks | `fulcrum.creak_loop` (hinge, speed-scaled) · `fulcrum.stop_knock` (rubber thump at ±12°) · `fulcrum.impact_soft` / `fulcrum.impact_hard` (wood) · `fulcrum.fling_whoosh` (end tip speed > 3 m/s) |

**Read at a glance.** An orange triangle under a wooden bar, with dark tips.
**Notes / don'ts.** Keep the `style_samples.py fulcrum()` read: a solid triangular prism base, a brass pin through the apex, a wood plank and graphite caps. The base is a 0.14 m wide × 0.20 m deep prism with its apex at the pin, 9 mm pillowed bevels, and 4 rubber feet 4 mm high. The beam (0.56 × 0.025 × 0.10) sits on a steel knuckle over the pin. Rubber stop pads on each base flank meet the beam underside at exactly ±12°: with the pin 0.065 m up and a 0.30 m half-length, the cap corner would touch the floor at ±12.9°, so the hinge range is ±12° (GAME_SPEC §12.2; the look-dev `fulcrum(tilt=-12)` uses 12°). The Ignition base is the deliberate Frame exception, called out in ART_BIBLE §3.1. Never make the beam thinner than 0.025 m, and never move the pin off-centre (game balance assumes a symmetric beam).

---

### SPRONG: Trampoline
`sprong` · Frame · Class M · Ship M2 · Inspired by (internal only): trampoline

**Concept.** A low square trampoline: a graphite woven mat slung on visible chrome springs inside a Cobalt frame. Things that land on it come back up harder than they arrived, and the mat dips on every hit.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.30 × 0.05 × 0.30 m (3×0.5×3) · origin: bottom centre |
| Mass · physics | 1.8 kg, anchored by default · mat `phys = rubber`, restitution **1.15**, exit speed capped at 8 m/s by the sensor · frame `phys = powder` |
| Collision | `COL__box__mat` 0.20 × 0.01 × 0.20 (top at z 0.035) · `COL__box__rail_n`, `_s`, `_e`, `_w` (0.30 × 0.03 × 0.025 each) |
| Materials (60/30/10) | neutral: `kn_fabric_graphite` mat (woven Normal) and `kn_powder_bone` corner blocks, ~58 % · signature: `kn_powder_cobalt` frame rails, ~30 % · accent: `kn_chrome` springs, `kn_steel_brushed` M3 screws, `kn_rubber` feet, ~12 % |
| Ports | none. Impact is resolved by contacts |
| Pivots | none (the mat uses a shape key) |
| Sensors | `SENSOR__trigger__mat` · threshold 0.05 N·s · 0.20 × 0.08 × 0.20 box sitting on the mat: bodies leaving it get e 1.15, capped at 8 m/s |
| Emitters | none |
| LEDs / screens | none |
| States | rest / depressed (scaled by impact) / recoil |
| Animation | shape key `sk_depress` (0–1): the mat centre dips 0.022 m (to z 0.008) and the springs stretch 15 %. The engine drives it over 60–120 ms per bounce |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 6,500 tris (16 springs ≈ 3,600) · 3 slots · 1024² woven Normal (tiling) |
| Audio hooks | `sprong.bounce` (springy "sproing", pitch by impulse) · `sprong.spring_rattle` (tail) · `sprong.rim_clank` (hit on the frame) |

**Read at a glance.** A blue square ring with a dark centre and a sparkle of springs.
**Notes / don'ts.** Frame: four Cobalt rails, 0.025 wide × 0.03 tall, on z 0.005–0.035. Bone corner blocks are 0.04 × 0.04 × 0.04, each with one M3 on top, standing on 5 mm rubber feet. The mat is 0.20 × 0.20 at z 0.03 at rest, with 16 chrome springs (4 per side, ⌀8 mm coil, 0.025 long) running from the eyelets to the rail inner faces. The springs must stay visible: there are no pads over them. The springs and mat share one mesh so `sk_depress` moves them together. The capped exit speed is gameplay-critical, so never imply a stronger bounce with oversized springs.

---

### TRAP BOX: Drop cage
`trap_box` · Frame · Class M · Ship M2 · Inspired by (internal only): cage

**Concept.** A chrome-barred cage that hangs from a Line by its top eye, drops when released, and traps whatever is under it. It is sized to fit **every critter**, from Pip up to Biscuit and Dusty. A cheeky little flag pops up when a critter is caught.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.70 × 0.50 × 0.50 m (7×5×5) · interior 0.66 × 0.46 × 0.46 m at floor level · origin: bottom centre (the rim underside) |
| Mass · physics | 5.2 kg (the bars read as thin-wall chrome tube; 44 solid ⌀10 steel bars alone would weigh ≈ 13 kg) · bars and frame `phys = steel` · rim bumper `phys = rubber` · restitution 0.10 |
| Collision | `COL__box__wall_f`, `_b` (0.70 × 0.48 × 0.014) and `COL__box__wall_l`, `_r` (0.014 × 0.48 × 0.50), z 0–0.48, centred in the 0.02 m wall zone (inner faces at x ±0.333, y ±0.233, so 0.666 × 0.466 clear); solid, covering the bar gaps · `COL__box__top` 0.70 × 0.02 × 0.50 at z 0.46–0.48 · open bottom |
| Materials (60/30/10) | neutral: `kn_chrome` bars and `kn_powder_bone` top plate, ~60 % · signature: `kn_powder_cobalt` top and bottom frames and corner posts, ~30 % · accent: `kn_rubber` rim bumper, Bone flag with a paw `kn_decal`, M3 screws, ~10 % |
| Ports | `PORT__tension__hook` · dir both · PR-M · kind hook · (0, 0, 0.492) · facing +Z, on a Cobalt eye boss at the top centre. The Line attaches here, and releasing it drops the box |
| Pivots | `PIVOT__flag` · axis y · 0° (flat on the top plate) to 90° (up) · the trapped flag |
| Sensors | `SENSOR__catch__inside` · triggers when a critter's centre of mass is inside when the rim lands · 0.64 × 0.44 × 0.44 box from z 0.01. On catch, the sim turns the critter to the cage's long (X) axis over 0.2 s, so every species fits (Dusty, a disc, needs no turn) |
| Emitters | `EMIT__dust__rim` at (0, −0.25, 0) (+X down): a landing dust puff |
| LEDs / screens | none |
| States | armed (hanging, flag down) / falling / landed empty / trapped (flag up; the critter plays its `trapped` clip) |
| Animation | procedural `PIVOT__flag`, 0 → 90° in 0.15 s with overshoot |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 8,000 tris (44 bars at ≤ 100 tris each) + linked PR-M ring 900 = 8,900 (M cap 10,000) · 3 slots · no unique textures |
| Audio hooks | `trap_box.release` (line lets go) · `trap_box.land` (metal clang plus rubber thud) · `trap_box.rattle` (critter pushes the bars) · `trap_box.flag_pop` (bright ding) |

**Read at a glance.** A silver-barred box with a blue frame and a hook on top.
**Notes / don'ts.** Bars are ⌀10 mm chrome at ≈ 0.05 m pitch, spaced evenly between Cobalt ⌀20 mm corner posts (post centres at x ±0.34, y ±0.24): 13 on each long side (pitch 0.0486 m, 0.039 m gaps) and 9 on each short side (pitch 0.048 m, 0.038 m gaps), 44 bars in all. The bottom frame is a Cobalt ring 0.020 wide × 0.025 tall (inside the 0.02 m wall zone, so the opening stays 0.66 × 0.46 at floor level) with a 4 mm rubber strip underneath (this is its "feet"). The top frame sits at z 0.46–0.48 with a recessed Bone plate and two Cobalt cross-braces. The walls are solid colliders, so GLINT/BEARING (⌀16 mm) cannot pass even though the gaps look wider; that is an accepted mismatch. The interior (0.66 × 0.46 × 0.46 m) fits the longest critter, Biscuit (0.62 L × 0.40 H × 0.22 W), standing, and the widest, Dusty (Ø 0.366 bumper, 47 mm clear each side from z 0 to 0.07), so every critter's `trapped` clip plays upright and unsquashed. Never show a critter squashed by the rim: if a critter is under the rim at landing, the sim lifts the rim 2 cm.

---

### SCOOP: Bucket
`scoop` · Frame · Class S · Ship M2 · Inspired by (internal only): bucket

**Concept.** A tapered Bone bucket with Cobalt bands and a steel bail. It hangs on a Line, collects sand, water and marbles, gets visibly heavier, and drags its counterweight down. Fill marks inside show how full it is.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.20 × 0.20 × 0.20 m (2×2×2, bail in its rest pose) · origin: bottom centre |
| Mass · physics | 0.45 kg empty, plus contents (capacity 3.5 L: water 3.5 kg, sand ≈ 5.3 kg) · `phys = powder` · friction 0.50 |
| Collision | compound hulls (it moves): `COL__hull__floor` + `COL__hull__wall_0..7` (8 staves forming the open bucket) = 9 shapes. No collider on the bail |
| Materials (60/30/10) | neutral: `kn_powder_bone` body, ~60 % · signature: `kn_powder_cobalt` rim band, base band and bail lugs, ~28 % · accent: `kn_steel_brushed` bail, `kn_rubber_grip` handle sleeve, `kn_rubber` base ring, Graphite fill-mark `kn_decal`, ~12 % |
| Ports | `PORT__tension__bail` · dir both · PR-S · kind hook · (0, 0.097, 0.191) in the rest pose, (0, 0, 0.265) with the bail upright · facing outward along the bail apex (+Z when upright), on a Cobalt hook block. It rides `PIVOT__bail` |
| Pivots | `PIVOT__bail` · axis x · −80° to +80° · rest −75° (lying back toward +Y) · moves the bail, hook block and port |
| Sensors | `SENSOR__intake__mouth` · channel fluid · interior frustum (convex hull) ⌀0.15 at z 0.008 → ⌀0.18 at z 0.178, following the inner wall so it never reaches outside the bucket · counts Matter grains and water entering, up to 3.5 L, and adds their mass |
| Emitters | none (the Matter layer spills the contents when the bucket tips past ~100°) |
| LEDs / screens | none (fill is read from the contents plus the fill marks) |
| States | empty / filling / full (contents at the brim) / tipped and pouring |
| Animation | procedural `PIVOT__bail` (it swings up when the Line pulls) |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 2,300 tris + linked PR-S ring 640 = 2,940 (S cap 3,000; the ring counts inside the host budget, shared_kit §1.5) · 3 slots + decal · no unique textures |
| Audio hooks | `scoop.bail_squeak` · `scoop.fill_loop` (sand hiss / water trickle, scaled by inflow) · `scoop.slosh` · `scoop.impact_hollow` (empty) / `scoop.impact_dull` (full) |

**Read at a glance.** A pale bucket with blue bands, swinging on its handle.
**Notes / don'ts.** Body: top outer ⌀0.20, bottom ⌀0.16, rim at z 0.18 with a ⌀10 mm rolled bead, 4 mm wall, and a 5 mm rubber base ring. The bail is ⌀6 mm with lugs at (±0.10, 0, 0.165), each with one M3. Fill marks are graphite ticks every 0.5 L on the inner back wall, facing the camera. Keep the mouth open and unobstructed: the intake sensor is gameplay-critical. The bail must fold within the 0.20 m bounds at rest. The bucket interior is a closed `CAVITY__contents` mesh (`matter = fill`) so the engine can draw its fill level (ASSET_PIPELINE §3.10).

---

### ANCHOR: Hook point
`anchor` · Frame · Class S · Ship M1 · Inspired by (internal only): eye hook

**Concept.** A small graphite puck with a brass eye that you stick to any floor, wall or ceiling to tie Lines to. The port ring is its whole face, so it reads as "tie here" at a glance.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.05 × 0.05 × 0.05 m (0.5) · origin: bottom centre of the mount face (local +Z = surface normal) |
| Mass · physics | static (mounts to any surface: floor, wall, ceiling, Ledge underside) · `phys = powder` |
| Collision | `COL__cylinder__0` ⌀0.052 × 0.014 (the puck). No collider on the eye |
| Materials (60/30/10) | neutral: `kn_powder_graphite` puck, ~60 % · signature: `kn_powder_cobalt` top face disc around the ring, ~28 % · accent: `kn_brass` eye, `kn_steel_brushed` 3 × M3 screws on the flange, ~12 % |
| Ports | `PORT__tension__hook` · dir both · PR-S · kind hook · (0, 0, 0.014), on the puck top face (the collar's centre plane sits on the housing surface, shared_kit §1.1) · facing +Z · `max_links = 4` (a fan of Lines). The eye shank plugs into the ring socket |
| Pivots | `PIVOT__eye` · axis z · −180° to +180° (free swivel) · the eye turns to face the strongest Line |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none (the ring shows tension activity) |
| States | unlinked / linked / under load (the ring flows with tension) |
| Animation | procedural `PIVOT__eye` |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 700 tris (+ linked ring) · 3 slots · no unique textures |
| Audio hooks | `anchor.attach_click` · `anchor.taut_twang` (a Line snaps tight) · `anchor.load_creak_loop` |

**Read at a glance.** A dark button with a glowing ring and a brass loop.
**Notes / don'ts.** Keep the `style_samples.py helio()` anchor: a Ø 0.052 × 0.014 graphite puck with a 4 mm bevel, and a brass eye (torus R 0.011, tube r 0.0028) standing vertically with its centre at z 0.036, so the top reaches 0.050. Screws sit at 120° on the flange outside the ring (3 per face). The eye stays proud of the ring so a Line visibly loops through it. It must look correct on a ceiling (upside down), so there is no "up-only" detail.

---

### SHEAVE: Pulley
`sheave` · Frame · Class S · Ship M1 · Inspired by (internal only): pulley

**Concept.** A Cobalt anodised grooved wheel spinning between Bone cheek plates, hung from a swivel mount. Lines run over it to turn pulls around corners. The lightening holes make every rotation obvious.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10 × 0.15 × 0.05 m (⌀1 wheel; mount adds 0.05 m on top) · origin: **axle centre** (wheel bottom at z −0.05, mount top at +0.10) |
| Mass · physics | 0.35 kg · static when surface-mounted (default), dynamic when hung from a Line (block-and-tackle) · Jolt PulleyConstraint · wheel `phys = steel` |
| Collision | `COL__cylinder__wheel` ⌀0.10 × 0.022 (axis Y) · `COL__box__yoke` 0.07 × 0.10 × 0.046 at (0, 0, 0.03) |
| Materials (60/30/10) | neutral: `kn_powder_bone` cheeks, ~55 % · signature: `kn_anod_cobalt` wheel, ~35 % · accent: `kn_steel_brushed` axle, swivel and M3 axle caps (S part: M3, shared_kit §2), ~10 % |
| Ports | `PORT__tension__axle` · dir both · PR-S · kind axle · (0, −0.023, 0) · facing −Y, on the front cheek around the axle cap · `max_links = 2` (rope in and out) · `PORT__tension__mount` · dir both · PR-S · kind hook · (0, 0, 0.088) · facing +Z, on the swivel |
| Pivots | `PIVOT__swivel` · axis z · −180° to +180° · moves the cheeks, the wheel and the axle port · `PIVOT__wheel` (child of the swivel) · axis y · continuous (no limits) · the wheel |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none (the rings show tension flow) |
| States | idle / running (wheel spinning; the rings flow) |
| Animation | procedural pivots only |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 1,700 tris + 2 linked PR-S rings 1,280 = 2,980 (S cap 3,000; rings count inside the host budget, shared_kit §1.5) · 3 slots · no unique textures |
| Audio hooks | `sheave.whirr_loop` (speed-scaled, with a spoke tick) · `sheave.rope_rub` · `sheave.squeal` (above 10 rad/s) · `sheave.swivel_clunk` |

**Read at a glance.** A blue wheel with holes in a pale fork. It reads as "pulley" from its outline alone.
**Notes / don'ts.** The wheel is ⌀0.10 × 0.022 with a V-groove (root ⌀0.08, for ⌀6 mm Line) and 5 round lightening holes, like the sample cogs. The cheeks are 6 mm plates spanning |y| 0.017–0.023 (inner faces at ±0.017, matching the 0.046 yoke collider and the axle port at y −0.023): a ⌀0.07 lobe around the axle, tapering up into the mount boss. The cheeks never cover the groove. The wheel turns about Y and faces the camera, so its rotation is always visible. The two rings are 0.09 m apart, which is ≥ 1 ring diameter of clear gap.

---

### FLAP: Hinged door / trapdoor
`flap` · Frame · Class S · Ship M2 · Inspired by (internal only): none

**Concept.** A Bone panel in a Cobalt frame with a chunky steel hinge. It drops open on a Signal pulse, or it works as a passive one-way gate that springs shut. It is authored as a trapdoor; rotate it to make a door.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.10–0.60 × 0.05 × 0.10–0.60 m (1–6 × 1–6, frame included; default 0.30 × 0.05 × 0.30) · origin: **hinge axis centre**: back edge of the panel, mid-thickness. The footprint spans y −(D − 0.02) to +0.02 and z −0.0375 to +0.0125 |
| Mass · physics | panel 4 kg/m² (default 0.27 kg), dynamic on the hinge · frame static · `phys = powder` |
| Collision | `COL__box__panel` (under the pivot, stretched) · `COL__box__rail_f`, `_b`, `_l`, `_r` (static) |
| Materials (60/30/10) | neutral: `kn_powder_bone` panel, ~60 % · signature: `kn_powder_cobalt` frame, ~30 % · accent: `kn_steel_brushed` hinge knuckles and M3 screws, status LED, port ring, ~10 % |
| Ports | `PORT__signal__in` · dir in · PR-S · (W/2 − 0.04, −(D − 0.02), −0.0125); default (0.11, −0.28, −0.0125) · facing −Y on the front rail fascia (the footprint's front face is y = −(D − 0.02)) |
| Pivots | `PIVOT__panel` · axis x · −90° (open, front edge down) to 0° (closed) · the panel |
| Sensors | none (passive mode is physical: it opens when the load torque exceeds 0.15 N·m) |
| Emitters | none |
| LEDs / screens | `led_groups = "0:status"`: a Ø 6 mm dome on the front rail top, directly above the ring, at the front rail's top centreline (W/2 − 0.04, −(D − 0.03), 0.0125); default (0.11, −0.27, 0.0125). Dim = latched, lit = open, slow pulse = passive mode |
| States | closed/latched / open / passive (spring-loaded one-way, closes in 0.4 s) |
| Animation | procedural `PIVOT__panel` (gravity opens it; the spring or latch closes it) |
| Fracture | none |
| Skins / variants | modes are Signal (pulse opens; next pulse or an auto-close timer closes) or Passive one-way. Same asset |
| Budget | LOD0 ≤ 1,400 tris at default size (+ linked ring) · 3 slots · UV2 tiling Bone trim on the panel |
| Audio hooks | `flap.latch_release` (clack) · `flap.swing_slap` (panel hits its open stop) · `flap.close_thud` · `flap.latch_click` · `flap.spring_creak` (passive return) |

**Read at a glance.** A pale square in a blue frame with a silver hinge along one edge.
**Notes / don'ts.** Resizing: a **9-slice frame** (fixed 0.02 × 0.02 corners, rails 0.02 wide stretch) plus a stretched panel. The hinge is modular: one 0.05 m knuckle piece per 0.05 m of width, alternating frame and panel, ⌀14 mm. The front rail holds a fixed 0.06 m latch block at the right end, under the port. Panel = footprint − 0.04 m in each axis, 0.025 thick, flush with the frame top. Ports and LED keep fixed offsets from the front corners at every size. The panel must clear the frame with 2 mm when it swings, with no visual clipping at −90°.

---

### GLIDEPATH: Rail track
`glidepath` · Frame · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A twin chrome rail on a Cobalt spine, drawn as a spline. Bearings and carts glide along it, through loops and banked curves, with powered booster segments that kick them on. It should feel like a precision coaster for marbles.

| Spec | Value |
|---|---|
| Size (W×H×D) | path. Profile 0.030 W × 0.040 H: two ⌀8 mm rails at 14 mm centres on a T-spine. Booster segment 0.30 × 0.09 × 0.05 · origin: the run's first control point, at the rail-top centreline. Authored pieces have their origin at the joint-face centre on the rail-top centreline |
| Mass · physics | static · Jolt PathConstraint for riders (carts, and Bearings that enter at an end) · rails `phys = steel`, friction 0.10 |
| Collision | static `COL__mesh` from the sweep (rails as 6-side tubes, spine as a box section) for loose contacts · booster: `COL__box__housing` |
| Materials (60/30/10) | neutral: `kn_chrome` rails and `kn_powder_bone` ties, posts and booster housing, ~60 % · signature: `kn_anod_cobalt` spine and clamps, ~30 % · accent: `kn_rubber` buffers, feet and booster tyres, `kn_poly_clear` booster window, port ring, ~10 % |
| Ports | booster only: `PORT__spin__drive` · dir in · PR-M · (0, −0.025, −0.055) relative to the booster origin · facing −Y on the housing front. No ports on plain track (Impact is resolved by contacts) |
| Pivots | booster: `PIVOT__tyre_l`, `PIVOT__tyre_r` · axis z · continuous, counter-rotating · friction tyres ⌀0.03 either side of the rail top |
| Sensors | booster: `SENSOR__trigger__booster` · threshold 0 (presence) · 0.30 × 0.03 × 0.03 over the rails. It applies a boost along the path tangent at tyre surface speed (ω·0.015 m) while Spin is present |
| Emitters | none |
| LEDs / screens | none (the booster ring shows spin activity) |
| States | idle / riding / boosting (tyres spinning; the booster ring flows) |
| Animation | procedural booster tyre pivots |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | sweep ≤ 300 tris/m · ties 60 tris every 0.1 m (instanced) · clamp ≤ 200 · post ≤ 400 + 40 per 0.1 m module · buffer ≤ 500 · booster ≤ 4,500 · 3 slots · no unique textures |
| Audio hooks | `glidepath.roll_loop` (bright metallic marble hiss) · `glidepath.cart_rumble_loop` · `glidepath.boost_zip` (rider enters a booster) · `glidepath.booster_whirr_loop` (spin speed) · `glidepath.buffer_clack` · `glidepath.joint_tick` |

**Read at a glance.** Two thin silver lines on a blue backbone, swooping through space.
**Notes / don'ts.** **Spline-swept profile** `glidepath__profile` (2 rail circles + T-spine), with a minimum bend radius of 0.10 m, any bank angle (loops allowed) and any gradient. Pieces: `glidepath__tie` (Bone, 0.03 wide, every 0.1 m); `glidepath__clamp` (steel band at every joint, at most 0.5 m apart); `glidepath__post` (Bone ⌀0.016 in 0.1 m modules, Cobalt clamp head, Ø 0.04 rubber foot); `glidepath__buffer` (rubber bumper on a 0.05 m Cobalt block); `glidepath__booster` (fixed 0.30 m straight, with tyres visible through the poly window on top). The gauge is sized for a ⌀16 mm Bearing to sit between the rails. Carts clamp around the spine coaster-style, but the cart itself is not this asset. Rails stay perfectly smooth: no visible seams in the sweep.

---

### SPINDECK: Turntable
`spindeck` · Frame · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A low Bone drum with a big Cobalt anodised platter and a grippy rubber top. It spins whatever sits on it when driven by Spin, and a raised index wedge plus edge ticks make the rotation readable at a glance.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.40 × 0.10 × 0.40 m (⌀4) · origin: on the rotation axis at floor level (axle centre at z 0) |
| Mass · physics | platter 1.2 kg (its inertia matters for torque) · base 2.0 kg (anchored) · platter top `phys = rubber`, friction 0.90 · base `phys = powder` |
| Collision | `COL__cylinder__platter` ⌀0.40 × 0.03 at z 0.07–0.10 (under the pivot) · `COL__cylinder__base` ⌀0.36 × 0.065 (static) |
| Materials (60/30/10) | neutral: `kn_powder_bone` base drum and `kn_rubber_grip` platter mat, ~60 % · signature: `kn_anod_cobalt` platter, ~30 % · accent: `kn_steel_brushed` hub cap and 4 × M5, `kn_poly_clear` gear window, Bone index wedge and tick `kn_decal`, ~10 % |
| Ports | `PORT__spin__in` · dir in · PR-M · (0.035, −0.166, 0.035) · facing −Y, on a flat facet on the drum front (a 0.14 m chord of the ⌀0.36 drum lies at y −0.166) |
| Pivots | `PIVOT__platter` · axis z · continuous · platter, mat and hub cap · `PIVOT__pinion` · axis y · continuous · the input bevel pinion seen through the window |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none (the spin ring shows drive activity) |
| States | free (unconnected: spins freely, with low bearing friction) / driven (platter speed = input ω, 1:1) / braked (Inspector toggle locks it) |
| Animation | procedural pivots only |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 5,000 tris (+ linked ring) · 3 slots · no unique textures |
| Audio hooks | `spindeck.hum_loop` (speed-scaled) · `spindeck.gear_whine_loop` · `spindeck.start_clunk` / `spindeck.stop_clunk` · `spindeck.brake_clack` |

**Read at a glance.** A big blue disc on a pale drum with a notch marker. Its spin is obvious from any angle.
**Notes / don'ts.** Base: drum ⌀0.36 at z 0.005–0.065 on 4 rubber feet (5 mm), with a 0.14 m wide flat front facet holding the ring (right) and a 0.05 m poly window (left, centre x −0.035) onto the bevel pair. Platter ⌀0.40 × 0.02 at z 0.07–0.09. Mat ⌀0.36 × 0.008. The raised Bone index wedge on the rim plus ticks every 30° carry the rotation read. Keep the top flat and unobstructed, because parts are placed on it.

---

### LIFT: Elevator platform
`lift` · Frame · Class M · Ship M3 · Inspired by (internal only): none

**Concept.** A Bone deck that rides a Cobalt twin-rail mast on an exposed toothed belt, powered from a base housing. A Signal sends it to the other end, and it pulses a Signal when it arrives. The belt and pulleys show exactly how it works.

| Spec | Value |
|---|---|
| Size (W×H×D) | deck 0.30 × 0.05 × 0.30 m (3×0.5×3) · travel 0.10–4.00 m (1–40) · overall 0.30 × (travel + 0.12) × 0.45 m (default travel 1.0 → 0.30 × 1.12 × 0.45) · origin: bottom centre of the deck at the lowest stop. The deck spans y ±0.15, the mast is at y 0.18–0.20, and the housing is at y 0.20–0.30 |
| Mass · physics | deck and carriage 1.5 kg (kinematic on the pivot) · housing 3.0 kg · mast 0.8 kg/m (anchored) · deck top `phys = rubber`, friction 0.9 · payload limit 15 kg |
| Collision | `COL__box__deck` · `COL__box__lip_l`, `_r`, `_b` · `COL__box__carriage` (all under the pivot) · `COL__box__housing` · `COL__box__mast` (stretched with travel) |
| Materials (60/30/10) | neutral: `kn_powder_bone` deck, housing and top cap, ~60 % · signature: `kn_anod_cobalt` mast rails, carriage and deck fascia, ~30 % · accent: `kn_rubber` belt and feet, `kn_rubber_grip` deck mat, `kn_steel_brushed` pulleys and M5 screws, LEDs, ~10 % |
| Ports | `PORT__power__in` · dir in · PR-M · (−0.11, 0.20, 0.08) · facing −Y · `PORT__signal__call` · dir in · PR-M · (0.11, 0.20, 0.08) · facing −Y · `PORT__signal__arrive` · dir out · PR-M · (0.11, 0.25, 0.155) · facing +Z (housing top: 0.15 tall on 5 mm feet) |
| Pivots | `PIVOT__carriage` · axis z · 0 to travel (metres) · deck, lips, carriage · `PIVOT__pulley_drive` (housing top) and `PIVOT__pulley_idle` (top cap) · axis x · continuous. Belt teeth scroll by UV offset, bound to the carriage travel |
| Sensors | `SENSOR__pressure__deck` · threshold 15 kg · 0.26 × 0.02 × 0.26 on the deck. Over the limit, the lift stalls and the rings show the amber fault blink |
| Emitters | none |
| LEDs / screens | `led_groups = "0:status,1:dir_up,2:dir_down"`: a Ø 8 mm status dome at (−0.11, 0.25, 0.155) on the housing top, and ▲/▼ light-bar chevrons on the top cap front |
| States | unpowered / idle at the bottom or top / moving up / moving down / fault (overload or no power) |
| Animation | procedural pivots only. Speed 0.25 m/s (Inspector 0.05–1.0). Rated 150 W, drawn while moving (SIMULATION §5.5; lifting the 15 kg limit at 0.25 m/s needs ≈ 37 W at the deck) |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | housing ≤ 3,000 · deck ≤ 1,000 · carriage ≤ 600 · mast foot ≤ 100 · mast 40 tris per 0.1 m · cap ≤ 900 → default (1 m) ≈ 6,000, 4 m ≈ 7,200; plus 3 linked PR-M rings (2,700, counted inside the host budget, shared_kit §1.5) → 8,700 / 9,900, within the M cap of 10,000 at every travel · 3 slots · no unique textures |
| Audio hooks | `lift.motor_loop` (pitch by speed) · `lift.belt_whirr_loop` · `lift.start_clunk` / `lift.stop_clunk` · `lift.arrive_chime` (soft) · `lift.fault_buzz` |

**Read at a glance.** A pale tray on a tall blue double rail with a dark belt, and a chunky base box at the bottom.
**Notes / don'ts.** Resizing uses **modular mast segments**: a fixed 0.08 m `lift__mast_foot` (rails and belt return around the drive pulley), then `lift__mast_10` (0.1 m) and `lift__mast_50` (0.5 m) rails and belt stacked by the engine to the travel length (so the mast is travel + 0.08 m), then capped by `lift__cap` (Bone, 0.16 × 0.04 × 0.04, open-sided so the idler pulley shows). The housing is 0.30 × 0.15 × 0.10 on 5 mm rubber feet. Rings sit on the housing front above deck level, outside the mast's ±0.08 m, so the deck never hides them at the lowest stop. The deck has 0.01 m lips on the left, right and back, and an open front for loading. Never enclose the belt, because the visible drive is the point.
