# Rollers: asset briefs

Balls and loose bodies from GAME_SPEC §12.1. Rollers are free bodies: origin = centre of mass, no feet, no fasteners, and no port rings except HELIO's string clip.

Template and conventions: [README](./README.md)

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| THUD | `thud` | S | M1 | brief |
| BOING | `boing` | S | M1 | brief |
| STITCH | `stitch` | S | M2 | brief |
| FUZZ | `fuzz` | S | M2 | brief |
| PIG IRON | `pig_iron` | S | M2 | brief |
| GLINT / BEARING | `marble` (variants `glint`, `bearing`) | S | M3 | brief |
| YOLK | `yolk` | S | M4 | brief |
| HELIO | `helio` | M | M1 | brief |

---

### THUD: Heavy ball
`thud` · Rollers · Class S · Ship M1 · Inspired by (internal only): bowling ball

**Concept.** A dense, satin-graphite ball that knocks over anything in its path. Three finger holes and a tilted Ignition band make it read as heavy, and they make its spin visible when it rolls. It should feel like the most expensive object on the desk.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.22 × 0.22 × 0.22 m (⌀2.2) · origin: sphere centre (= centre of mass) |
| Mass · physics | 7.0 kg · `phys = powder` · restitution 0.12 · friction 0.30 (custom properties on the COL shape; SIMULATION §4.3 ball override) |
| Collision | `COL__sphere__0` r 0.110 |
| Materials (60/30/10) | neutral: `kn_powder_graphite` shell, ~88 % · signature: `kn_powder_ignition` band, ~9 % · accent: `kn_steel_brushed` finger-hole liners plus a Bone "THUD 7KG" `kn_decal` stamp, ~3 % |
| Ports | none (Roller: no port rings). Impact is resolved by contacts |
| Pivots | none (the whole body is simulated) |
| Sensors | none |
| Emitters | none (the engine spawns contact dust and sparks at contact points) |
| LEDs / screens | none |
| States | single state. Engine motion blur only |
| Animation | none |
| Fracture | none (unbreakable) |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 2,400 tris · 3 slots (graphite, ignition, steel) + decal · no unique textures |
| Audio hooks | `thud.roll_loop` (low rumble, speed-scaled, per surface phys) · `thud.impact_hard` · `thud.impact_soft` · `thud.drop_floor` (heavy, with sub thump) · `thud.skid` |

**Read at a glance.** The darkest big ball. A dark disc with an orange stripe and a triangle of three holes.
**Notes / don'ts.** Match `style_samples.py thud()`. Finger holes are three Ø 0.023 m bores, 0.035 m deep, with 2 mm rounded lips, centred on unit directions (−0.16, −0.55, 0.82), (0.16, −0.55, 0.82) and (0, −0.80, 0.60), so they sit on the upper front at rest. The band is 0.013 m wide, inlaid on a great circle tilted −18° about X and 8° about Y, and stands **≤ 1.5 mm proud**, because the collider is a pure sphere. Keep the shell satin, with no gloss and no "marbled" bowling swirl. The holes are a boolean with clean quads around each rim and must not dimple the silhouette at LOD2.

---

### BOING: Bouncy ball
`boing` · Rollers · Class S · Ship M1 · Inspired by (internal only): basketball

**Concept.** A big, light, pebbled orange rubber ball that bounces almost forever. Three black great-circle seams spin visibly, and a short squash on every hit sells the elasticity.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.24 × 0.24 × 0.24 m (⌀2.4) · origin: sphere centre |
| Mass · physics | 0.6 kg · `phys = rubber` · restitution 0.82 · friction 0.60 (SIMULATION §4.3 ball override). Snappy Feel adds restitution at runtime, so author the Real value |
| Collision | `COL__sphere__0` r 0.120 |
| Materials (60/30/10) | signature: `kn_powder_ignition` body, ~93 %, with this part's own ORM (roughness 0.62) and a pebble Normal (0.8 mm pebbles) for a rubber read · neutral: `kn_rubber` seams, ~6 % · accent: Graphite "BOING" `kn_decal` stamp between two seams, ~1 % |
| Ports | none (Roller) |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | rest / squash. Squash is driven by impact impulse |
| Animation | shape key `sk_squash` (0–1). At 1 the ball flattens 22 % along the contact normal and bulges 10 % around it (volume preserving). The engine plays it over 90 ms, scaled by impulse |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 2,000 tris · 2 slots · 1024² ORM + Normal (pebble), with BaseColor taken from the master |
| Audio hooks | `boing.bounce` (pitch and volume by impulse, the signature "boing") · `boing.roll_loop` (light rubber) · `boing.scuff` · `boing.impact_soft` |

**Read at a glance.** The biggest ball: orange, with a black "beach-ball cross" of seams.
**Notes / don'ts.** Seams are three orthogonal great circles (XY, XZ and YZ planes), 6.4 mm wide, recessed 1 mm (the sample's proud tori would float the ball off its collider). No basketball panel pattern and no brand-like lines. At full `sk_squash` the flattened contact face must stay within 3 mm of the contact plane (the collider's tangent point), so the ball never visibly sinks into or floats above the surface it hits. `style_samples.py` uses a one-off `boing_rubber` (`#FF6A33`). Replace it with the Ignition master plus this part's ORM and Normal, as above.

---

### STITCH: Hard ball
`stitch` · Rollers · Class S · Ship M2 · Inspired by (internal only): baseball

**Concept.** A small, hard, palm-sized ball with a raised two-lobe seam of chunky stitches. Clean Bone with an orange seam makes it the "white" ball of the set, and the seam curve shows spin even at small size.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.075 × 0.075 × 0.075 m (⌀0.75) · origin: sphere centre |
| Mass · physics | 0.15 kg · `phys = powder` · restitution 0.50 · friction 0.45 |
| Collision | `COL__sphere__0` r 0.0375 |
| Materials (60/30/10) | neutral: `kn_powder_bone` shell, ~85 % · signature: `kn_fabric_ignition` stitch band, ~13 % · accent: tiny Graphite "KN-ST" `kn_decal` stamp, ~2 % |
| Ports | none (Roller) |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state |
| Animation | none |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 2,200 tris · 2 slots · 1024² Normal for the V-stitch pattern (shared trim layer) |
| Audio hooks | `stitch.impact_hard` (crisp "tock") · `stitch.roll_loop` (small, bright) · `stitch.bounce` |

**Read at a glance.** The smallest white ball, with an orange squiggle.
**Notes / don'ts.** The seam is a continuous two-lobe curve: a 4 mm band raised 0.8 mm, carrying 2 × 44 V-chevron stitches. Model the stitches as geometry at LOD0 (exaggerated 1.3×) and as normal map only from LOD1 down. No red-on-white sports palette: Ignition on Bone is ours. The stitches must not change the round silhouette. Keep the shell satin, because leather grain reads as dirt at this scale.

---

### FUZZ: Fuzzy ball
`fuzz` · Rollers · Class S · Ship M2 · Inspired by (internal only): tennis ball

**Concept.** A small felt-covered ball that grips, bounces softly and floats on water. Warm Amber felt with a dark seam curve. Its soft, sheen-lit fuzz reads differently from every hard ball.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.065 × 0.065 × 0.065 m (⌀0.65) · origin: sphere centre |
| Mass · physics | 0.058 kg (density ≈ 400 kg/m³, so it floats) · `phys = fabric` (SIMULATION §4.3: Fuzz felt) · restitution 0.70 · friction 1.20 (high), as per-shape overrides |
| Collision | `COL__sphere__0` r 0.0325 |
| Materials (60/30/10) | signature: `kn_fabric_amber` felt, ~92 % (sheen 0.6 plus a fuzz Normal) · neutral: `kn_rubber` seam, ~8 % · accent: none |
| Ports | none (Roller). The Fluid channel = buoyancy in Matter water, computed by the engine from the collider volume |
| Pivots | none |
| Sensors | none |
| Emitters | none (Matter splash is engine-side) |
| LEDs / screens | none |
| States | dry / wet. Wet = albedo −20 % and sheen 0.6 → 0.2 (engine `wet` parameter), drying back over 20 s |
| Animation | none |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 1,600 tris · 2 slots · 1024² Normal (fuzz, shared trim layer) |
| Audio hooks | `fuzz.bounce` (soft "pock") · `fuzz.roll_loop` (muffled) · `fuzz.splash_small` · `fuzz.impact_soft` |

**Read at a glance.** A small, matte, warm Amber ball. It is the only fuzzy silhouette in the set.
**Notes / don'ts.** Volt is reserved for power trim (ART_BIBLE §3.1), so this ball is **Amber, not tennis yellow-green**. The seam is a two-lobe curve, 3 mm wide and recessed 0.6 mm. Push the felt shell 0.7 mm outward from the seam so that the seam reads as a groove. No strand or shell fur: sheen plus the Normal carry the fuzz. No white seam, because dark contrast reads better at distance and avoids sports trade dress.

---

### PIG IRON: Iron ball
`pig_iron` · Rollers · Class S · Ship M2 · Inspired by (internal only): cannonball

**Concept.** A compact, very dense cast-iron ball that magnets grab. Dark metal with a polished machined belt and a stamped boss. It is smaller than THUD but nearly as heavy, and its metallic sheen is the tell.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.12 × 0.12 × 0.12 m (⌀1.2) · origin: sphere centre |
| Mass · physics | 6.5 kg · `phys = steel` · restitution 0.10 · friction 0.40 · root `kn_magnetic = true` |
| Collision | `COL__sphere__0` r 0.060 |
| Materials (60/30/10) | neutral: `kn_anod_graphite` cast body, ~85 % (part Normal with 0.3 mm cast pitting) · signature: `kn_steel_brushed` equator belt, ~12 % · accent: raised sprue boss with a Bone "6.5" `kn_decal`, ~3 % |
| Ports | none (Roller). The Field channel = `kn_magnetic` (Maglock, Grav Well and Tractor Beam act on it) |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | single state. In a Field volume the engine draws field-line VFX (no asset change) |
| Animation | none |
| Fracture | none |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 1,800 tris · 2 slots · 1024² Normal (pitting, shared trim layer) |
| Audio hooks | `pig_iron.roll_loop` (gritty, heavy) · `pig_iron.impact_hard` (metallic clank) · `pig_iron.drop_floor` · `pig_iron.magnet_clack` (snaps onto a Field source) |

**Read at a glance.** A small, dark, shiny ball with a bright silver stripe. THUD has an orange band and holes; PIG IRON has a silver belt and no holes.
**Notes / don'ts.** The belt is a 0.012 m band around the equator, flush, with anisotropy along the band. The boss is a flattened Ø 0.022 m disc at the top pole, 1 mm proud. No rust colour or grime (ART_BIBLE §1.5): pitting is Normal only. No fuse hole, because this is not a bomb. Never use graphite powder here: it must read as metal against THUD's satin.

---

### GLINT / BEARING: Glass and steel marble
`marble` (variants `glint`, `bearing`) · Rollers · Class S · Ship M3 · Inspired by (internal only): none

**Concept.** A tiny marble that comes in two variants: GLINT, a beam-blue glassy bead, and BEARING, a chrome ball bearing. As loose rigid bodies they rattle down runs and ride Glidepath. In hoppers they become Matter grains by the thousand, so they are built as the cheapest possible instance.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.016 × 0.016 × 0.016 m (⌀0.16) · origin: sphere centre |
| Mass · physics | glint 0.0054 kg, `phys = glass`, restitution 0.60, friction 0.30 · bearing 0.0167 kg, `phys = steel`, restitution 0.65, friction 0.25, `kn_magnetic = true` |
| Collision | `COL__sphere__0` r 0.008 (Rigid mode). Matter mode uses the same radius for the grain |
| Materials (60/30/10) | glint: `kn_ceramic_beam` (gloss, coat 0.5) with a 1024² BaseColor "cat's-eye swirl" from a shared trim layer · bearing: `kn_chrome`. One material per variant, so the split does not apply |
| Ports | none (Roller). Field channel: bearing only, via `kn_magnetic` |
| Pivots | none |
| Sensors | none |
| Emitters | none |
| LEDs / screens | none |
| States | Rigid body, or a Matter grain inside hoppers (renders through the instanced-grain path using LOD2) |
| Animation | none |
| Fracture | none (glint does not shatter) |
| Skins / variants | `kn_skins = "glint,bearing"`: material swaps on one mesh. Mass, phys and magnetism per variant live in `marble.part.json` |
| Budget | **instancing-heavy: LOD0 ≤ 288 tris** (16 × 10 UV sphere) · LOD1 144 · LOD2 72 (the grain mesh) · LOD3 20 (icosahedron) · 1 material · **no transmission** |
| Audio hooks | `marble.roll_loop` (glint: glassy; bearing: steel hiss) · `marble.click` (marble on marble) · `marble.impact_hard` · `marble.pour_loop` (Matter grain stream, aggregate) |

**Read at a glance.** Pinpoints of beam-blue or chrome highlight. They read as a colour and a sparkle, not as a shape.
**Notes / don'ts.** No transmission, refraction or inner geometry (ASSET_PIPELINE §4, instancing-heavy). The "glass" look is gloss plus the baked swirl, oriented so that the swirl faces −Y when the marble is unrotated. LOD2 must remain a convincing sphere, because it is the Matter grain. GLINT is the only Beam-coloured Roller, and BEARING the only chrome one.

---

### YOLK: Egg
`yolk` · Rollers · Class S · Ship M4 · Inspired by (internal only): none

**Concept.** A warm tan hen's egg that wobbles when it rolls and splats if you look at it wrong. Henny lays them. It is fragile, comic and instantly recognisable from its egg shape and colour.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.045 × 0.060 × 0.045 m (⌀0.45 × 0.6 long, long axis on Z) · origin: centre of mass, 2 mm toward the blunt end (+Z) from the geometric centre |
| Mass · physics | 0.055 kg · `phys = ceramic` · restitution 0.15 · friction 0.50 · root `kn_break_impulse = 0.3` (N·s) |
| Collision | `COL__hull__0`: an egg hull with 48 vertices, so it rolls in curves |
| Materials (60/30/10) | signature: `kn_paper_tan` shell, ~97 % (the paper-tooth normal reads as eggshell grain) · accent: a small Ignition-ink "KN" stamp `kn_decal` on the side, ~3 % · neutral: none (one-piece shell) |
| Ports | none (Roller) |
| Pivots | none |
| Sensors | none. Breakage is evaluated on contact against `kn_break_impulse` |
| Emitters | `EMIT__splat__centre` at the origin (the engine orients +X to the contact normal at the break) |
| LEDs / screens | none |
| States | intact / splatted. A contact of ≥ 0.3 N·s removes the body and spawns the splat |
| Animation | none |
| Fracture | **splat, no chunks**: a splat decal (white plus yolk-amber, Ø 0.10–0.20 m, scaled by impulse) from the vfx decal set, plus 10–14 eggshell bits from the shared debris library (`DEB_eggshell`, shared_kit.md §8: 14 curved shards of 20–60 tris, 4–20 mm, tan `kn_paper_tan` outside and `kn_interior_ceramic` inside). Both are Spectacle |
| Skins / variants | none at launch |
| Budget | LOD0 ≤ 900 tris · 1 slot + decal · no unique textures |
| Audio hooks | `yolk.roll_loop` (wobbly tick) · `yolk.tap` (sub-break contact) · `yolk.splat` (crack plus wet slap) · `yolk.laid` (soft plop when Henny lays it) |

**Read at a glance.** A tan egg silhouette. No other part has this outline.
**Notes / don'ts.** Keep a true egg profile (blunt end up, pointed end down, aspect 0.75). A symmetrical ellipsoid reads as a pill. Tan separates it from STITCH's Bone at the same scale. Splats are decal plus shell bits only: no goo volume, no yolk mesh, no chick. The shell bits come from `DEB_eggshell` in `shared_kit.md` §8; its outer master must match this shell (`kn_paper_tan`).

---

### HELIO: Balloon
`helio` · Rollers · Class M · Ship M1 · Inspired by (internal only): balloon

**Concept.** A glossy plasma-pink latex balloon. It squishes when it bumps into things, drifts in the wind, slowly lifts light parts (up to an empty SCOOP) on its string, and pops with a satisfying bang. It is the most "alive" Roller: it bobs and is soft, and it is the lightest thing in the game.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.25 × 0.30 × 0.25 m (⌀2.5 body; 0.28 m body height plus knot) · origin: balloon volume centroid (the body's sphere centre) |
| Mass · physics | 0.004 kg (latex ≈ 3 g, knot and clip ≈ 1 g) · pressure soft body. **Toy helium** (GAME_SPEC §12.1, SIMULATION §5.1): a constant buoyant lift F = 4.9 N × air % (≈ 0.5 kg-equivalent at Earth gravity) applied at the body centre, plus normal gravity on the 0.004 kg mass, so one full HELIO slowly lifts an empty SCOOP (0.45 kg). Lift scales with `sk_inflate` while the Inflator fills it · `phys = latex` (SIMULATION §4.3) · friction 0.6 · root `kn_pop_speed = 6.0` (m/s relative contact speed), `kn_pop_heat = 0` (any heat source pops it). Pops on contact with a `sharp`-tagged shape, on any heat source, or at a contact speed > 6 m/s |
| Collision | soft body. **LOD3 doubles as the soft-body cage**: a clean, manifold, even-edged cage of ≈ 242 verts. Also `COL__sphere__0` r 0.125 for broadphase and spawn placement |
| Materials (60/30/10) | signature: `kn_latex_plasma` body and knot, ~94 % · neutral: steel collar of the PR-S clip, ~4 % · accent: Bone "HELIO" `kn_decal` printed on the shoulder, ~2 % |
| Ports | `PORT__tension__knot` · dir both · PR-S · kind hook · (0, −0.006, −0.172) · facing (0, −0.707, −0.707), down and to the front. The PR-S ring doubles as the balloon clip under the knot. LINE attaches here |
| Pivots | none (soft body) |
| Sensors | none. Pop is evaluated on contact speed (> 6 m/s), sharp contact and any heat |
| Emitters | `EMIT__pop__centre` at the origin: 12–16 shredded plasma latex flakes, a small air puff and a comic smoke ring |
| LEDs / screens | none (the clip ring LED shows tension activity) |
| States | idle bob / squished / drifting / popped. When popped, the knot, clip and a 3-strip shred remnant fall as one Spectacle debris body that is cleared after 5 s |
| Animation | shape keys `sk_inflate` (0 = empty, 1 = full; used at spawn and by the Inflator) and `sk_pop` (0 → 1 over 3 frames: the body crumples into shreds, then hides) |
| Fracture | **pop**: `sk_pop` plus latex shred particles from `EMIT__pop__centre`. No FRAC chunks |
| Skins / variants | `kn_skins = "round,heart,pumpkin,star"`. Round (default) and heart use `kn_latex_plasma`, pumpkin uses `kn_latex_ignition` (six ribs), star uses `kn_latex_amber` (five puffy points). Each skin is its own body mesh with the same cage vertex count |
| Budget | LOD0 ≤ 6,000 tris (quads that deform cleanly) · 1 slot + decal · no unique textures |
| Audio hooks | `helio.squeak` (rubbery contact) · `helio.bump_soft` · `helio.pop` (sharp bang plus latex flutter) · `helio.string_taut` (snap when the line goes tight) · `helio.inflate_loop` |

**Read at a glance.** A glossy pink teardrop on a string. It is the only Roller that floats.
**Notes / don'ts.** Shape per `style_samples.py helio()`: sphere r 0.125. Above the equator, scale Z ×1.06. Below it, scale Z ×1.18 and pinch toward the neck (radial k = 1 − 0.38·(−z)^1.6). The knot is a 0.020 m latex cone ending at the clip. HELIO is the **only Roller with a port ring**, and that ring is the clip: never add a second one. The string is not part of the asset. Unconnected HELIOs get a 0.15 m cosmetic `kn_rope` tail from the engine, and connected ones use the LINE. Keep it glossy on both cycs, never matte. On the Moon Base HELIOs sink (air 0 %, so no lift), and that is intended.
