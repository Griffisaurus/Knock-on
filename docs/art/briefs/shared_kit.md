# Shared kit briefs

The shared library in `assets/src/lib/` (plus the debris library in `assets/src/fx/`) that every part links: port rings, fasteners, feet, LEDs, screen bezels, the decal atlas, the master materials, debris shards and the look-dev rigs. Parts never redesign any of these.

Back to the [brief index](./README.md) · Rules: [ART_BIBLE §2, §4–6, §10](../ART_BIBLE.md) · [ASSET_PIPELINE §2–5, §7](../ASSET_PIPELINE.md) · Look-dev source: `tools/blender/style_samples.py`

| Asset | Class | Ship | Stage |
|---|---|---|---|
| `port_ring.blend`: PR_S, PR_M, PR_L + plugs | S (library) | M0 | brief |
| `fasteners.blend`: M3, M5, M8, rivets R4, R6 | S (library) | M0 | brief |
| `feet.blend`: rubber feet set | S (library) | M0 | brief |
| `led_parts.blend`: LED domes, light bars, screen bezels | S (library) | M1 | brief |
| `decals.blend` + `decals_atlas.png` | atlas | M1 | brief |
| `materials.blend`: master materials | library | M0 | brief |
| `fx/debris.blend`: micro-debris shards | library | M3 | brief |
| Look-dev turntable and review rigs | tool scenes | M0 | brief |

Coordinates follow the [brief conventions](./README.md#conventions-used-in-briefs). Dimensions are millimetres unless marked. All library pieces are **linked**, never appended, so a fix here updates every part.

---

## 1. Port rings (`port_ring.blend`)

The single most important readability element (ART_BIBLE §5). One machined part in three sizes. Proportions are taken from the look-dev helper `port_ring(name, loc, direction, led, R)` in `style_samples.py`, where `R` is the collar's major radius: collar torus minor radius 0.3 R, LED torus major 0.7 R / minor 0.11 R offset 0.16 R outward, socket cylinder radius 0.62 R and depth 0.25 R offset 0.02 R inward. The collar's outer edge is at R + 0.3 R, so **outer Ø D = 2.6 R exactly**, and production rings are built from D (R = D / 2.6), which gives exactly the ART_BIBLE §5 outer diameters of 28 / 42 / 56 mm. Every other row is a fixed ratio of D (right-hand column), rounded to 0.1 mm. Production meshes are lathe profiles with these exact proportions (cleaner topology than primitive tori). The only additions to the look-dev helper are the centre bore and the plug, which it doesn't model.

### 1.1 Dimensions

| | **PR-S** | **PR-M** | **PR-L** | Ratio to D |
|---|---|---|---|---|
| Outer Ø D | 28.0 | 42.0 | 56.0 | 1 |
| R (look-dev `R`) = D / 2.6 | 10.77 | 16.15 | 21.54 | 0.3846 |
| **Collar** inner Ø (opening) | 15.1 | 22.6 | 30.2 | 0.538 |
| Collar section (round, along the port axis) | Ø 6.5 | Ø 9.7 | Ø 12.9 | 0.231 |
| Collar proud of the housing | 3.2 | 4.8 | 6.5 | 0.115 |
| **LED ring** centreline Ø | 15.1 | 22.6 | 30.2 | 0.538 |
| LED tube Ø | 2.4 | 3.6 | 4.7 | 0.085 |
| LED front, proud of the housing | 2.9 | 4.4 | 5.8 | 0.104 |
| **Socket** Ø | 13.4 | 20.0 | 26.7 | 0.477 |
| Socket thickness | 2.7 | 4.0 | 5.4 | 0.096 |
| Socket face, proud of the housing | 1.1 | 1.7 | 2.3 | 0.040 |
| Socket recess (collar top → socket face) | 2.1 | 3.2 | 4.2 | 0.075 |
| Socket centre bore Ø × depth (blind: leaves a 0.016 D floor, so it never pierces the 0.096 D socket) | 5.0 × 2.2 | 7.6 × 3.4 | 10.1 × 4.5 | 0.18 × 0.08 |
| Min. centre spacing between rings (1 Ø) | 28 | 42 | 56 | 1 |

- **Mounting:** the collar's centre plane lies on the housing surface. The hidden back half of the collar is deleted and capped flat (saves 40 % of its tris). The ring centre is the `PORT__<channel>__<name>` empty; local **+X is outward**.
- **Housing prep:** the host part provides a flat land ≥ 1.25 D across around the empty. No boolean cut is needed; the ring sits on the surface.
- Exaggeration: none. Port rings are true scale; they read because they're consistent.

### 1.2 Materials, UVs and LED

| Piece | Master | Notes |
|---|---|---|
| Collar | `kn_steel_brushed` | UV U runs **circumferentially** so the anisotropic brushing reads as a lathe finish |
| LED ring | `kn_led` | UV **U = angle around the ring, 0 at local +Z (top), increasing clockwise seen from the front (looking along −X)**; V around the tube. The engine's travelling "Flowing" pulse reads U. Do not add the ring to the part's `led_groups` (ASSET_PIPELINE §3.6) |
| Socket | `kn_rubber` | Planar UV. Centre bore uses `kn_rubber` too, reading as the dark "●" |

LED states are engine-driven (ART_BIBLE §5): idle 8 %, connected 25 %, active 100 % + bloom, flowing 100 % + travelling pulse (see [vfx.md §8](vfx.md#8-port-ring-led-pulse)), fault Amber 2 Hz blink.

### 1.3 Socket variants
Each size ships three sockets, chosen by the port's `kind` custom property (ASSET_PIPELINE §3.5). Collar and LED are identical in all three.

| Variant | Used for | Look |
|---|---|---|
| `socket_plug` (default) | Signal, Power, Light, Heat, Air, Fluid, Sound, Lure, Field, Impact | Rubber disc with centre bore |
| `socket_axle` (`kind = axle`) | Spin ports (Cogs, Bands, shafts) and Sheave axles | `kn_steel_brushed` bearing insert, bore = 0.18 D, 6 tiny ball bumps in normal map |
| `socket_hook` (`kind = hook` / `end`) | Tension ports (Lines, Anchors) | `kn_brass` eye ring (torus, Ø 0.36 D, section 0.06 D) standing 0.05 D proud of the rubber |

### 1.4 Plugs and how they seat
Wires (Signal) and cables (Power) end in a plug. Plugs live in the same file: `PLUG_S`, `PLUG_M`, `PLUG_L`.

| | PLUG_S | PLUG_M | PLUG_L |
|---|---|---|---|
| Boot Ø (must stay ≤ LED inner edge 0.454 D) | 12.0 | 18.0 | 24.0 |
| Boot length | 15.4 | 23.1 | 30.8 |
| Nose tip Ø × length (`kn_steel_brushed`; 0.4 mm radial clearance in the bore, length 0.075 D so it stops short of the bore floor) | 4.6 × 2.1 | 7.2 × 3.2 | 9.7 × 4.2 |
| Strain-relief ribs | 3 | 3 | 4 |
| Cable Ø | Signal wire 5.0 · Power cable 9.0 (any plug size; `cable_signal` / `cable_power` in power_signal.md, look-dev `power_cable` radius 4.5 mm) | | |

**Seating:** the plug origin is the boot's nose face. The engine places it on the port's +X axis with the nose face **on the socket face** and the tip in the centre bore. The boot sits inside the collar opening, so the **LED ring stays fully visible around the boot** (radial gap ≈ 0.3 / 0.5 / 0.7 mm). The cable leaves along +X, then routes along surfaces (Wire tool). Boot `kn_rubber`, cable `kn_rubber`. Plugs have no collision.

Mechanical connections don't use plugs: shafts pass through `socket_axle`, Line hooks clip into `socket_hook`, and Tubes weld end-to-end over the collar.

### 1.5 LOD and budget (counted inside the host part's budget)

| | LOD0 | LOD1 (50 %) | LOD2 (25 %) | LOD3 (8 %) |
|---|---|---|---|---|
| PR-S | 640 tris: 24 radial segments, collar profile 8, LED tube 4 sides | 320 | 160 | 52 |
| PR-M | 900 tris: 32 radial | 450 | 225 | 72 |
| PR-L | 1,300 tris: 48 radial | 650 | 325 | 104 |
| Plug (each size) | 300 / 400 / 500 | 50 % | 25 % | hidden |

- LOD2: LED tube becomes a flat emissive annulus between collar and socket; centre bore removed.
- LOD3: one flat disc, 12-sided on PR-M / PR-L (24 + 24 + 10 = 58 tris) and **10-sided on PR-S** (20 + 20 + 8 = 48 tris, to fit its 52-tri LOD3): collar annulus + emissive annulus + socket disc (3 materials kept so the LED state still reads).
- The ring switches LOD with its host part.

**Don'ts.** Never scale a ring non-uniformly, recolour the collar, add a custom bezel, or place one where the default front three-quarter view can't see it.

---

## 2. Fasteners (`fasteners.blend`)

Hex-socket button-head screws in three sizes only (ART_BIBLE §2), plus two dome rivets. All are `kn_steel_brushed` (UV U circumferential), except rivets on hardwood parts, which may use `kn_brass`.

| ID | Head Ø | Head height | Dome | Hex socket AF × depth | LOD0 tris | LOD1 | LOD2 | LOD3 |
|---|---|---|---|---|---|---|---|---|
| `FAST_M3` | 5.5 | 1.65 | ISO 7380 profile, 0.5 mm edge fillet | 2.0 × 1.0 | 96 | removed (baked into the part's normal map) | — | — |
| `FAST_M5` | 8.5 | 2.6 | same | 3.0 × 1.5 | 128 | 48 (socket in normal map) | removed | — |
| `FAST_M8` | 13.0 | 4.0 | same | 5.0 × 2.5 | 192 | 64 | 16 (flat cap) | removed |
| `RIVET_R4` | 4.0 | 1.2 | hemispherical | — | 48 | removed | — | — |
| `RIVET_R6` | 6.0 | 1.8 | hemispherical | — | 64 | removed | — | — |

**Usage rules**
- Size by part class: S parts M3, M parts M3/M5, L parts M5/M8, environment props M8.
- **Max 4 per face.** Inset ≥ 1 head Ø from any edge. Patterns: rectangle corners, or 90° / 120° on round caps.
- Seat with the underside 0.1 mm below the surface (no gap, no shank modelled).
- Socket rotation randomised in 15° steps (Geometry Nodes scatter from `FASTPTS__m3/m5/m8` vertex helpers; the exporter realises and merges them into the host piece per LOD).
- Future Tech parts use **half** the usual count (ART_BIBLE §3.3: "fewer fasteners").
- Rivets: sheet-metal seams and paper/cardboard explosives' graphite tape bands only.

---

## 3. Rubber feet (`feet.blend`)

Every freestanding device sits on feet 3–5 mm high (ART_BIBLE §2). Master `kn_rubber`. Feet are not in `COL` (the part's base shape covers them); the part origin's z = 0 is the feet's bottom.

| ID | Size | Shape | LOD0 tris | Use |
|---|---|---|---|---|
| `FOOT_S` | Ø 8 × 3 high | Domed bumper, 1 mm fillet | 48 | S parts, the scale-reference stick foot |
| `FOOT_M` | Ø 14 × 4 | Domed bumper, 1.5 mm fillet | 64 | M parts |
| `FOOT_L` | Ø 22 × 5 | Domed bumper with a 2 mm step ring | 96 | L parts |
| `FOOT_BAR_<len>` / `FOOT_BAR5_<len>` | 10 wide × 4 high (`FOOT_BAR5`: 5 high) × 30–200 long (10 mm steps) | Stadium section, rounded ends | 120 | Long bases (Treadway frames). The 5 mm bar is for the Motor family and Mains (MOTOR, DYNAMO, MAINS sit on 5 mm feet) |
| `FOOT_RING_<Ø>` | 4 wide × 3 high, inner Ø 40–400 (10 mm steps) | Skirt ring | 256 (32 radial) | Round bases (Gale, The Button, Dusty) |

- ≥ 3 contact points. Inset ≥ 0.5 × foot Ø from the base edge. Painted shells sit ≥ 1 mm above the floor.
- LOD1 50 %; LOD2 feet become a single 8-sided prism each; LOD3 removed (the plinth shadow carries the read).

---

## 4. LED domes and light bars (`led_parts.blend`)

Status LEDs show state physically (ART_BIBLE §6). Emissive faces use `kn_led` with the vertex colour attribute **`led`**: R = group index / 255 (0–15), G = default brightness (ASSET_PIPELINE §3.6). The engine owns colour and intensity; never bake an emission colour.

### 4.1 Domes

| ID | Dome Ø × height | Bezel (`kn_steel_brushed`) outer Ø × height | LOD0 tris | LOD1 | LOD2 | LOD3 |
|---|---|---|---|---|---|---|
| `LED_D6` | 6 × 3.3 | 9 × 1.2 | 80 | 40 (flat 16-gon dome) | 16 | 2 (one quad) |
| `LED_D8` | 8 × 4.4 | 11 × 1.2 | 100 | 50 | 20 | 2 |
| `LED_D10` | 10 × 5.5 | 13 × 1.5 | 120 | 60 | 24 | 2 |

The LED face never disappears at any LOD, so state stays readable at distance.

### 4.2 Light bars
Single-group status bars (e.g. MAINS "on" bar, Motor running strip). Section: 4 high × 3 deep stadium, `kn_led`, in a 1.5 mm `kn_powder_graphite` surround frame.

| ID | Length | LOD0 tris |
|---|---|---|
| `LEDBAR_20` / `_40` / `_60` / `_80` | 20 / 40 / 60 / 80 | 96 / 128 / 160 / 192 |

Segmented meters (charge, level) are **not** light bars: use a `bar` screen (§5) so the engine can draw any fill level.

---

## 5. Screen bezels (`led_parts.blend`)

Screens are flat `SCREEN__<name>` quads on `kn_screen`, UV 0–1, with properties `kind`, `digits` or `cells`, and `color` (ASSET_PIPELINE §3.7). The bezel is `kn_powder_graphite` (4 mm border, 2 mm outer corner radius, 1 mm inner), the quad is inset 1.5 mm, and a 1 mm `kn_glass` cover sits 0.3 mm below the bezel face.

| ID | `kind` | Quad size (W × H) | Content grid | Bezel LOD0 tris | Example |
|---|---|---|---|---|---|
| `SCR_7SEG_2` | `7seg` | 24 × 20 | 2 digits, 10 × 16 cell, 2 mm margin | 400 | Any 2-digit readout; SINGULARITY countdown ("6.0") |
| `SCR_7SEG_3` | `7seg` | 34 × 20 | 3 digits | 450 | RECYCLER count, DELAY seconds ("0.1"–"30.0") |
| `SCR_7SEG_4` | `7seg` | 44 × 20 | 4 digits + optional colon | 500 | RINGER mm:ss |
| `SCR_7SEG_6` | `7seg` | 64 × 20 | 6 digits | 550 | MARBLE HOPPER count (up to 100,000) |
| `SCR_BAR_5` | `bar` | 30 × 14 | 5 cells 4 × 10, 1 mm gap | 400 | CELL charge |
| `SCR_BAR_10` | `bar` | 56 × 14 | 10 cells | 400 | TANK level |
| `SCR_ICON_24` | `icon` | 24 × 24 | one icon from the UI set (ui_icons.md) | 300 | PING Tx / Rx mode |
| `SCR_ICON_32` | `icon` | 32 × 32 | one icon | 300 | FABRICATOR selected part |
| `SCR_TEXT_3` | `text` | 26 × 10 | 3 chars JetBrains Mono | 300 | TONEBARS note name ("C4", "F#5"); bezel 34 × 18 fits the 70 × 20 mm rail face |
| `SCR_TEXT_64` | `text` | 64 × 16 | 8 chars JetBrains Mono | 450 | Flavour readouts |

**Future Tech exception.** Future Tech parts (future.md) may scale a kit screen's cells and segments by up to 2× to suit their larger, bezel-less faces (FABRICATOR, RECYCLER, HOVER PAD, COILGUN RING). They keep the kit's `kind`, segment style and colour rules. Full-surface engine-animated `icon` screens (RECYCLER core, RIFT GATES membrane) are engine surfaces, not bezel screens, and need no kit ID.

- Each bezel has a ×1.5 variant (`…_X15`) for L parts. Bars may be rotated 90° for vertical meters.
- Every `7seg` screen may show a **decimal point** after any digit (engine-drawn in the digit cell's lower-right corner, no extra width).
- Unlit segments render at 6 % ("ghost segments") so a 7-seg reads as a display even when off.
- Content colour: the `color` property, a channel colour or brand colour. Engine-drawn; nothing baked.

---

## 6. Decal atlas (`decals.blend` + `decals_atlas.png`)

All labels, pictograms, stripes and numerals for every part come from **one 4096² atlas** on `kn_decal` (alpha-tested at 0.5, roughness 0.5, polygon offset in engine; ASSET_PIPELINE §5.1). RGBA8: sRGB colour + linear alpha. Encoded UASTC (BC7 / ASTC 4×4 at runtime) with full mips.

- **Grid:** 64 px base unit. Every cell keeps a **4 px transparent gutter** inside its rect; colour is dilated 8 px into the gutter so mips don't bleed.
- **Texel density on parts:** labels and stripes 3,200–8,000 px/m (labels are close-up detail; they must stay crisp at 150 px card size).
- Decal geometry: separate quads floated 0.2 mm off the surface, in the `RENDER` collection, named `<type>__decal_<n>`. At LOD2 decals merge into the host's base colour bake; at LOD3 they're dropped.
- Typefaces (SIL OFL): **Unbounded** Bold (names, numerals), **Inter** Medium (spec text), **JetBrains Mono** Bold (technical numerals).
- Colourways: **Bone `#E8E2D6` on Graphite `#3A3E47`** and **Graphite on Bone**. Text is drawn with a transparent background; the plate itself is geometry in powder coat.

### 6.1 Layout

| Region | Rect (x, y, w, h) px | Cell | Slots | Contents |
|---|---|---|---|---|
| **A. Name strips** | 0, 0, 3840, 1536 | 384 × 64 | 240 (10 × 24) | Part names in Unbounded Bold, all caps, cap height 30 px, tracking +2 %. Any name that doesn't fit the 376 px live width at that size (check the long two-word names, e.g. HAMSTER DRIVE, BURNING GLASS) is scaled down uniformly, to a minimum cap height of 22 px; never condensed or wrapped. Two colourways per part (Bone text / Graphite text): ~115 names × 2 + 10 spare |
| **A2. Generic words** | 3840, 0, 256, 1536 | 256 × 64 | 24 | IN · OUT · ON · OFF · MIN · MAX · PUSH · PULL · LOAD · FIRE · ARM · RESET, each in both colourways |
| **B. Spec strips** | 0, 1536, 4096, 1024 | 512 × 32 | 256 (8 × 32) | One flavour line per part, Inter Medium, cap height 14 px, e.g. "KN-07 · 24V · 1.5 rps". Both colourways. Fog-grey `#8A93A6` is **not** used on parts (too low contrast on Bone) |
| **C. Numerals** | 0, 2560, 2048, 512 | 128 × 128 | 64 (16 × 4) | Rows: Unbounded Bold Bone · Unbounded Bold Graphite · JetBrains Mono Bold Bone · JetBrains Mono Bold Graphite. Columns: 0 1 2 3 4 5 6 7 8 9 . − + × ° % |
| **D. Glyphs and marks** | 2048, 2560, 2048, 512 | 128 × 128 | 64 (16 × 4) | Row 1: the 12 filled channel glyphs (ui_icons.md §3) in Bone + arrows in / out / both / rotate-CW. Row 2: same in Graphite. Row 3: note names C D E F G A B ♯ ♭ (Tonebars) in Bone + Ignition camera T-mark, registration cross, tie-down ring, KN lab mark, scale tick + 2 spare. Row 4: same note names in Graphite + 7 spare |
| **E. Pictograms** | 0, 3072, 4096, 512 | 256 × 256 | 32 (16 × 2) | 16 pictograms (§6.2). Row 1: **warning style** (rounded triangle, Amber `#FFB020` fill, 14 px Graphite border, Graphite symbol). Row 2: **mono style** (Bone outline and symbol on transparent, for dark plates) |
| **F. Stripes and trims** | 0, 3584, 4096, 512 | 1024 × 128 | 16 (4 × 4) | §6.3 |

### 6.2 Pictograms

| # | Pictogram | Shape | Allowed on |
|---|---|---|---|
| 1 | Explosive | Round bomb with a 3-ray spark | Fire & Boom explosives and their detonator only (Bangstick, T-Plunger, Powder Keg, Jitterjuice, Skyshow). Never on POPPER, which is an Air puff, not an explosive |
| 2 | Flammable | Flame with base line | Fire & Boom, Wick, Flamer |
| 3 | Hot surface | Three wavy lines over a flat bar | Flamer, Blowout, Burning Glass, Lamp |
| 4 | High voltage | Lightning bolt | Arc Tower, Mains only (ART_BIBLE §6; the Dynamo does not carry it) |
| 5 | Rotating parts | Gear with a circular arrow | Drive family, Gale, Turbine |
| 6 | Pinch point | Two rollers with an inward arrow | Treadway, Cog sets, Rack |
| 7 | Light beam | Small star emitting a straight beam | Lance, Torch |
| 8 | Magnetic field | Horseshoe magnet with arcs | Maglock, Coilgun Ring, Pig Iron |
| 9 | Fragile | Pane with a crack line | Pane, Vase, Fishbowl, Jitterjuice |
| 10 | Pressurised | Gas cylinder with a valve | Inflator, Tank |
| 11 | Wireless | Three concentric arcs from a dot | Ping |
| 12 | Recycle | Three chasing rounded arrows | Recycler |
| 13 | Critter-friendly | Paw print | Trap Box, Pedal Rig, Hamster Drive |
| 14 | Keep clear | Square with four outward arrows | Big Top, Flinger, Punchline reach |
| 15 | Blades | Open scissors | Snipper |
| 16 | Launch | Curved arc arrow from a base | Skyrocket, Toast Cannon, Cork Blaster |

This table is the canonical pictogram list that ART_BIBLE §6 points to. Pictograms are optional: "allowed on" never means "required on". Symbol stroke 16 px at 256 (≈ 1/16 of the cell), rounded caps, geometry on a 16 px grid. Never more than one pictogram per face.

### 6.3 Stripes and trims (region F, 1024 × 128 tiles)

| Row | Tiles |
|---|---|
| 1 | Hazard stripes **Amber / Graphite 45° right**, pitch 64 px (32 px per stripe), seamless in U · same 45° left · right with rounded end cap (left end) · right with rounded end cap (right end) |
| 2 | Narrow hazard (pitch 32 px) right · left · Graphite tape band (matte, for Bangstick / Keg straps) · perforated grille alpha (Ø 10 px holes, 16 px pitch) |
| 3 | Vent slots alpha (8 × 48 px slots) · panel-line groove strip (normal-only look via darker 2 px line) · "KN-BAY" container stencil (hangar) · stage-number stencil base (backlot) |
| 4 | Ignition camera tape (studio floor marks) · Bone measuring-stick band numerals strip · 2 spare |

At 3,200 px/m one stripe is 10 mm wide. Hazard stripes are allowed **only** on Fire & Boom items, Flamer and Arc Tower (ART_BIBLE §6), plus environment hazard edges (hangar, airlocks).

---

## 7. Master material library (`materials.blend`)

### 7.1 Verification against ASSET_PIPELINE §5.1
The §5.1 table is canonical. Checked against ART_BIBLE §3–4, GAME_SPEC §19.7 and `style_samples.py`:

| Item | Finding | Resolution |
|---|---|---|
| Material IDs | GAME_SPEC §19.7 uses `kn_led`, `kn_screen`, `kn_decal`, `kn_interior_*` and the powder swatches `kn_powder_ignition`, `kn_powder_volt` … | Consistent. **Canonical IDs are ASSET_PIPELINE's:** `kn_powder_<colour>` (not `kn_<colour>`). The exporter rejects `mat_*` and bare `kn_<colour>` swatch names |
| Powder colours | GAME_SPEC §19.7 lists all 8 (Ignition, Volt, Cobalt, Plasma, Bone, Graphite, Amber, Beam) | **8 powders**, as in ASSET_PIPELINE and ART_BIBLE §3.1: consistent |
| Fuse cord and wax | §5.1 lists `kn_fuse_cord` and `kn_wax`; GAME_SPEC §19.7 lists "fuse cord, wax" | Both are masters here (values and node chains below) |
| Albedo cap | ART_BIBLE caps linear albedo at 0.85; colours with an `FF` channel exceed it | Library stores the **capped** value (peak channel scaled to 0.85 linear, hue kept), exactly as `hexcol()` in `style_samples.py`. Effective values below |
| Anodised tints | §5.1 lists the six colours (graphite, beam, volt, cobalt, plasma, ignition) but no values | Beam, volt, cobalt and plasma take the look-dev script's values; graphite and ignition (not in the script) are set here, below |
| Anodised roughness | ART_BIBLE 0.28–0.35 vs §5.1 0.30 | **0.30** fixed. No per-part override |
| Polycarbonate tints | ART_BIBLE: tint ≤ 25 % saturation; look-dev `polycarbonate_amber` is `#FFC266` (60 %) | Masters use low-saturation tints, below. The look-dev amber is too strong and is not used |
| Wear | ART_BIBLE §4 asks for curvature-masked wear without unique textures on most parts | Wear is driven by a **vertex colour attribute `wear`** (0–1), so powder parts still need no texture set |
| Environment surfaces | §5.1 has only a `kn_env_*` placeholder row that points here | The `kn_env_*` family is defined in §7.3 (the canonical list of its IDs). Not used on parts |

**Effective (capped) albedo of the powders**

| Master | Spec sRGB | Stored sRGB (≈) | | Master | Spec sRGB | Stored sRGB (≈) |
|---|---|---|---|---|---|---|
| `kn_powder_graphite` | `#3A3E47` | `#3A3E47` | | `kn_powder_cobalt` | `#3355FF` | `#2F4FED` |
| `kn_powder_bone` | `#E8E2D6` | `#E8E2D6` | | `kn_powder_plasma` | `#FF3DAE` | `#ED38A2` |
| `kn_powder_ignition` | `#FF5B2E` | `#ED542A` | | `kn_powder_amber` | `#FFB020` | `#EDA41D` |
| `kn_powder_volt` | `#C6FF3A` | `#B8ED35` | | `kn_powder_beam` | `#2FD6FF` | `#2BC7ED` |

**Anodised tints (`kn_anod_<c>`; since D88 baked as enamel over metal: metallic 0 on the paint, 1 at worn edges, roughness 0.42–0.48 in the texture set's ORM):** graphite `#5A606B` · beam `#4FC3E8` · volt `#B5E043` · cobalt `#4A6BFF` · plasma `#F04FA8` · ignition `#F0663E`.

**Polycarbonate tints (`kn_poly_<c>`, transmission 1, IOR 1.58, roughness 0.04):** clear `#F4F7FA` · beam `#D2F4FF` · amber `#FFE6C0` · plasma `#FFD6EE`.

**Other values confirmed as in §5.1:** steel `#C9CDD3` r 0.24 aniso 0.6 · chrome `#E6E8EB` r 0.05 · brass `#E3B261` r 0.25 · copper `#D9824A` r 0.28 · glass IOR 1.5 r 0 · rubber `#1C1E22` r 0.82 sheen 0.3 · wood r 0.45 coat 0.35 · paper red `#D93A2B` r 0.72, tan `#D8C39A` r 0.8, cardboard `#B88A5A` r 0.78 · latex r 0.30 coat 0.7/0.06 SSS 0.12 · ceramic r 0.15 coat 0.5 · brick `#B5553B` r 0.85 · rope `#EDE6D8` r 0.85 · fuse cord `#4A3524` r 0.9, braided normal · wax `#F3E9D2` r 0.45, SSS 0.35, coat 0.2 · fabric r 0.9 sheen 0.6 · fur r 0.6 sheen 0.5 · slime `#7DFF7A` r 0.1 transmission 0.6 · LED and screen black r 0.3 / 0.2 · decal r 0.5.

### 7.2 Shader-node structure

**Rules for every master**
1. Exactly **one Principled BSDF** (Blender 4.x) → Material Output. Its inputs map to the engine's Uber shader feature bits: Coat → clearcoat, Transmission (+ Thickness map) → transmission, Sheen → sheen, Subsurface → SSS-lite, Anisotropic → aniso, Emission → engine-driven emissive.
2. All logic sits in one node group **`KNM_<family>`** in front of the BSDF. Its inputs are the only things a part may drive: `Wear` (attribute `wear`), `Mask` (attribute or the part's mask texture), `LED` (attribute `led`, emissives only), and from M3 the part's **texture set**: `Set BaseColor`, `Set ORM`, `Set Normal` and `Set Factor` (1 = the set replaces the constants below, 0 = master only). D78 makes the set mandatory for final parts (ASSET_PIPELINE §5.2); the "Export" column below describes the master alone.
3. Allowed nodes: Image Texture, Texture Coordinate, Mapping, UV Map, Color Attribute / Attribute, Normal Map, Mix (colour and float), Map Range, Math, Separate / Combine Color. **Authoring-only** (baked at export or replaced by a shared tiling map): Noise, Wave, Voronoi, Color Ramp, Bump.
4. Forbidden: Mix Shader, Add Shader, Emission shader node, Shader to RGB, Light Path, Ambient Occlusion, Geometry → Pointiness, Displacement. They don't exist in the engine.
5. Shared tiling detail maps (1024², UASTC, in `materials.blend` as packed images): `kn_detail_orangepeel_n` (0.1 m tile), `kn_detail_brushed_n` (0.05 m), `kn_detail_knurl_n` (0.02 m), `kn_detail_paper_n` (0.05 m), `kn_detail_twist_n` (rope, 0.02 m along U), and from M3 `kn_detail_woodgrain_n` (0.2 m along the grain) and `kn_detail_pitting_n` (cast iron, 0.05 m). Applied on UV2 or object-space triplanar (set per master). In the engine these are the **detail layer** that fades in close to the camera (RENDERING §6.1, D79).
6. **Look-dev stand-ins:** until a part has its set, `tools/blender/_tactile.py` swaps in procedural Cycles versions of the D78 surfaces for renders (enamel with worn edges and darkened cavities, wood grain along the longest axis, brass and copper patina, scratched steel, paper fibre, rubber, brick, cord, ceramic), coloured from this master table. They use nodes rule 4 forbids (Pointiness, Ambient Occlusion), so they are look-dev only: the target for the texture pass, never shipped.

| Family | Node chain (inside `KNM_<family>` → BSDF) | Export |
|---|---|---|
| **Powder** `kn_powder_*` | Base RGB constant (capped) → Mix(Value +4 %, factor = `Wear`) → Base Color · Roughness 0.42 → Map Range(`Wear` 0→1 ⇒ 0.42→0.38) → Roughness · Coat 0.25 / coat roughness 0.30 · Normal: `kn_detail_orangepeel_n` strength 0.35. Preview equivalent (look-dev): Noise scale 1400, detail 6 → Bump strength 0.035, distance 0.0004 | No unique textures |
| **Gloss powder** `kn_powder_<c>_gloss` | As powder; Roughness 0.25, Coat 1.0 / 0.03, orange peel strength 0.15 | Hero buttons only |
| **Anodised** `kn_anod_*` | Metallic 1 · Base = tint · Roughness 0.30 (− 0.03 × `Wear`) · Anisotropic 0.2, tangent from UV U (brush direction) · `kn_detail_brushed_n` 0.15 | No unique textures |
| **Brushed steel** `kn_steel_brushed` | Metallic 1 · `#C9CDD3` · Roughness 0.24 · Anisotropic 0.6, tangent from UV U · `kn_detail_brushed_n` 0.25. UV U must follow the brush: straight along bars, circumferential on round parts | No unique textures |
| **Chrome** | Metallic 1 · `#E6E8EB` · Roughness 0.05 · no detail | — |
| **Brass / Copper** | Metallic 1 · base constant · Roughness 0.25 / 0.28 (× (1 − 0.1 × `Wear`), the ART_BIBLE §4 5–10 % wear limit) | — |
| **Cast iron** `kn_iron_cast` (M3) | Metallic 1 · `#3B3D40` · Roughness 0.55 (− 0.1 × `Wear` on high points) · `kn_detail_pitting_n` 0.4 | Set per part |
| **Polycarbonate** `kn_poly_*` | Transmission 1 · IOR 1.58 · Roughness 0.04 · Base = tint · Thickness from the part's `Thickness` map (metres, linear) · no coat. Shells are closed manifold with **real 1.5–3 mm modelled thickness**. One exception: the path-swept TUBE (frame.md) is a single outer surface plus a Thickness map (6 mm wide / 5 mm slim), so a tube stays at 2 transparent layers per sight line (ART_BIBLE §7) | Thickness map per part |
| **Glass** | Transmission 1 · IOR 1.5 · Roughness 0 · Base white · Thickness map optional | — |
| **Rubber** `kn_rubber` / `_grip` | `#1C1E22` · Roughness 0.82 · Sheen 0.3 (sheen roughness 0.5) · `_grip`: `kn_detail_knurl_n` 0.6 | — |
| **Hardwood** `kn_wood_oak` / `_walnut` | Texture Coordinate (Object) → Mapping (scale 0.12, 1, 1) → Wave (Rings, scale 9, distortion 6, detail 3) → Color Ramp (oak `#9A6338` → `#D7A86E`; walnut `#4A2E1F` → `#7A5236`) → Base · Roughness 0.45 · Coat 0.35 / 0.15. Grain direction = object X | **Baked** to the part's BaseColor + Normal at export (§5.1) |
| **Paper / cardboard** | Base constant · Roughness 0.72–0.80 · `kn_detail_paper_n` 0.5 (look-dev: Noise 500 → Bump 0.08 / 0.001) | — |
| **Latex** `kn_latex_*` | Base brand colour (capped) · Roughness 0.30 · Coat 0.7 / 0.06 · Subsurface 0.12, radius (1.0, 0.4, 0.3) × 10 mm | — |
| **Ceramic** `kn_ceramic_*` | Base colour · Roughness 0.15 · Coat 0.5 / 0.05 | — |
| **Brick** `kn_brick` | Base `#B5553B`, roughness 0.85; `Mask` (UV2 mortar mask) mixes in mortar `#CFC6B8`, roughness 0.95, and a −1 mm normal step | Mortar mask texture (trim) |
| **Rope** `kn_rope` | `#EDE6D8` · Roughness 0.85 · `kn_detail_twist_n` 0.8 along U | — |
| **Fuse cord** `kn_fuse_cord` | `#4A3524` · Roughness 0.9 · `kn_detail_twist_n` 0.6 along U (braid). Look-dev preview: Noise 800 → Bump 0.3 / 0.001 (`fuse_cord` in the script). Burnt state = engine material swap (ASSET_PIPELINE §5.1) | — |
| **Wax** `kn_wax` | `#F3E9D2` (tintable per skin) · Roughness 0.45 · Subsurface 0.35, radius (1.0, 0.6, 0.4) × 5 mm · Coat 0.2 / 0.3 | — |
| **Fabric** `kn_fabric_*` | Base colour · Roughness 0.9 · Sheen 0.6 | — |
| **Fur** `kn_fur_<critter>` | Base from the critter's texture set · Roughness 0.6 · Sheen 0.5 · custom property `kn_shell_fur = 1` (shell fur on the 12 GB and 16 GB tiers only, ART_BIBLE §8) | Per critter |
| **Slime** `kn_slime` | `#7DFF7A` · Roughness 0.1 · Transmission 0.6 · Subsurface 0.3 | — |
| **LED** `kn_led` | Base black · Roughness 0.3 · Emission Strength 0 at export. Look-dev preview: emission colour = channel colour, strength 14 (as `emissive()` in the script) | Engine-driven via `led` attribute |
| **Screen** `kn_screen` | Base black · Roughness 0.2 · emission engine-driven | — |
| **Decal** `kn_decal` | Atlas Image (RGBA) → Base Color; Alpha → Alpha (clip 0.5) · Roughness 0.5 | Atlas only |
| **Interior** `kn_interior_*` | wood `#E2C08F` r 0.7 · brick `#C2694D` r 0.95 · glass = glass with `#E8F5EE` edge tint · ceramic `#EDE6DA` r 0.9 · metal `#B8BCC2` metallic 1 r 0.4 · paper `#E8DCC2` r 0.9 | Fracture inner faces only |

### 7.3 Environment masters (`kn_env_*`)
New family for sets (environments.md). Same node rules. Environments may use part masters too.

| ID | Base | Rough. | Extras | Used by |
|---|---|---|---|---|
| `kn_env_cyc_light` | `#BDB8AF` | 0.92 | Grid-etch mask (2048² tiling): groove roughness +0.08, albedo −6 % | Studio |
| `kn_env_cyc_dark` | `#1C1F26` | 0.85 | Same mask, albedo +4 % | Studio |
| `kn_env_floor_tile` | Bone `#E3DCCD` / warm grey `#B9B1A3` checker (UV2 trim) | 0.35 | Coat 0.3 / 0.1; grout `#9C958A` r 0.9 | Kitchen |
| `kn_env_counter` | `#D9D2C3` speckled (baked 2048²) | 0.40 | Coat 0.2 | Kitchen |
| `kn_env_grass` / `_dirt` / `_sand` / `_rock` | `#6E9A48` / `#8E6B4A` / `#D6BE8E` / `#8B8580` | 0.85 / 0.9 / 0.9 / 0.75 | 2048² tiling BaseColor (+ height in alpha) / Normal / ORM; grass sheen 0.2 | Backlot terrain, boulders |
| `kn_env_hay` | `#D9B65E` | 0.85 | Straw normal | Backlot |
| `kn_env_concrete` | `#A7A39B` | 0.80 | Tiling normal | Backlot, apron |
| `kn_env_panel_white` | `#E9ECEF` | 0.35 | Coat 0.25 / 0.2 | Hangar, Moon dome |
| `kn_env_deck` | `#C5C9CF` | 0.60 | Anti-slip tiling normal | Hangar |
| `kn_env_regolith` | `#8C8A85` | 0.95 | Opposition lift +15 % at low phase angles (engine feature bit); micro-pebble detail normal | Moon |
| `kn_env_regolith_sintered` | `#9A968E` | 0.80 | Hex seams | Moon apron |
| `kn_env_foil_gold` | `#E0B04A` | 0.20 | Metallic 1, crinkle normal | Lander |
| `kn_env_foliage` | `#5E8F3E` | 0.70 | Alpha-tested cards, two-sided, translucency 0.35 | Trees, herbs |
| `kn_env_earth` | Stylised albedo 4096² + cloud layer + atmosphere rim | 0.6 | Backdrop only | Hangar, Moon |
| `kn_env_backdrop` | Baked albedo | 1.0 | Receives fog; baked AO allowed | All `BACKDROP` pieces |
| `kn_env_floorboards` | Oak boards `#A9784A` → `#C99A64` (2048² tiling set) | 0.50 | Coat 0.2 / 0.3; board seams, soft edge bevels | Tinker Lab floor |
| `kn_env_plaster_warm` | `#E6D8BF` | 0.85 | Fine trowel normal | Tinker Lab walls |
| `kn_env_bench_oak` | Butcher-block oak (2048² hero set, end grain on the ends) | 0.45 | Coat 0.35 / 0.15 | Tinker Lab workbench |
| `kn_env_cutting_mat` | Green `#2F6B5A`, grid `#7FB8A4` (0.1 m minor, 0.5 m major), ruler numbers | 0.70 | Self-healing PVC; faint knife-score normal; floor variant for the Room mat | Tinker Lab build zones |
| `kn_env_chalkboard` | Slate green `#2C3A34` | 0.90 | Faint erased-chalk haze (albedo +4 %); chalk sketches are decals | Tinker Lab |
| `kn_env_pegboard` | Hardboard `#B98E5E` | 0.80 | Hole pattern in the trim (25 mm real pitch) | Tinker Lab |

---

## 8. Debris shard library (`assets/src/fx/debris.blend`)

Micro debris for fracture and explosions (ASSET_PIPELINE §7, GAME_SPEC §13: GPU rigid-lite chunklets, sphere-approximated, colliding with the global SDF). 12–20 shards per material, 20–200 tris each.

- Collections `DEB_<material>`; objects `deb_<material>__<nn>`. Manifold, origin at centre of mass.
- Custom properties: `r` (bounding-sphere radius used by the GPU sim), `phys` (density and bounce from the phys material), `surface` (impact-sound bank).
- Two material slots: outer master + `kn_interior_*` on broken faces (one slot only where the table lists no inner master: poly, rubber, latex, rock, soil). No unique textures. Powder shards take the parent part's colour from a per-instance colour; wood shards take a per-instance `char` (0–1) that blends to burnt `#2A2420`, r 0.9, for fire-damaged planks.
- LODs: LOD0 authored · LOD1 40 % (meshopt) · LOD2 a 12-tri proxy (tetra or box).

| Set | Masters (outer / inner) | Shards | Tris | Size | Shapes |
|---|---|---|---|---|---|
| `DEB_wood` | `kn_wood_oak` / `_walnut` · `kn_interior_wood` | 18 | 20–160 | 5–60 mm | 8 splinters (3:1–8:1), 6 chunks, 4 slivers |
| `DEB_brick` | `kn_brick` · `kn_interior_brick` | 16 | 20–200 | 8–50 mm | 10 chunks with one tooled face, 6 mortar crumbs |
| `DEB_glass` | `kn_glass` · `kn_interior_glass` | 20 | 20–80 | 4–60 mm | Curved and flat shards, 3 mm thick |
| `DEB_ceramic` | `kn_ceramic_*` · `kn_interior_ceramic` | 16 | 40–150 | 6–50 mm | Curved shards, glaze outside |
| `DEB_metal` | `kn_steel_brushed` / `kn_anod_*` · `kn_interior_metal` | 14 | 40–200 | 4–40 mm | 6 bent plates, 4 screws/nuts (from `FAST_M3` LOD0 and `FAST_M5` LOD1; M3 has no LOD1, §2), 2 spring bits, 2 washers |
| `DEB_powder` | `kn_powder_*` (instance colour) · `kn_interior_metal` | 14 | 40–140 | 8–60 mm | Housing plate fragments with pillowed edges (used by Clear world and blasted devices) |
| `DEB_poly` | `kn_poly_*` · none | 12 | 30–100 | 6–50 mm | Clear shell shards, 2 mm thick |
| `DEB_paper` | `kn_paper_red` / `_tan` / `kn_cardboard` · `kn_interior_paper` | 18 | 20–200 | 6–50 mm | 12 torn flakes (0.5 mm), 6 crumpled wads |
| `DEB_rubber` | `kn_rubber` | 12 | 20–80 | 4–30 mm | Crumbs and strips |
| `DEB_latex` | `kn_latex_*` (instance colour) | 12 | 40–120 | 10–60 mm | Curled balloon shreds, 0.6 mm (Helio pop) |
| `DEB_eggshell` | `kn_paper_tan` · `kn_interior_ceramic` | 14 | 20–60 | 4–20 mm | Curved shell pieces (Yolk). Outer face in tan paper to match the YOLK shell (tan, deliberately not Bone so it isn't confused with STITCH) |
| `DEB_rock` | `kn_env_rock` / `kn_env_regolith` | 20 | 40–200 | 5–80 mm | Angular rocks (Backlot, Moon, craters) |
| `DEB_soil` | `kn_env_dirt` | 12 | 30–120 | 5–40 mm | Clods (terrain blasts) |
| **Total** | | **198** | | | |

Spawn counts per tier are in [vfx.md §2.7](vfx.md#27-debris).

---

## 9. Look-dev turntable and review rigs

Every asset review uses the scenes in `tools/blender/style_samples.py` (ART_BIBLE §10). The rigs below are its exact values; `kn_tools → Review` builds them around the selected part.

### 9.1 Render settings (all rigs)

| Setting | Value |
|---|---|
| Engine | Cycles, GPU (OptiX, then CUDA, then CPU) |
| Samples | 64 preview · 512 final · 128 turntable frames |
| Denoise | On |
| Bounces | max 16 · glossy 8 · transmission 16 · transparent 16 |
| View transform | **Khronos PBR Neutral** (fallback AgX + "Punchy" only on Blender builds without it) |
| Resolution | 960 × 540 preview · 1920 × 1080 final · 1080 × 1080 turntable |
| Output | PNG, `review/<type>/<type>__<rig>_<frame>.png` |

### 9.2 Rigs

| | **LIGHT-CYC** (`scene_lineup`) | **DARK-CYC** (`scene_materials`) | **DARK-MECH** (`scene_mechanism`) | **DARK-FX** (`scene_boom`) |
|---|---|---|---|---|
| Purpose | Default look, turntables, Library-card match | Material and colour check on dark | Transparency, interiors, LEDs | VFX, emissives, sparks |
| Cyc material | `#BDB8AF`, roughness 0.92 | `#1C1F26`, roughness 0.85 | same | same |
| World colour × strength | (0.5, 0.5, 0.52) × 0.3 | (0.012, 0.013, 0.016) × 1.0 | (0.012, 0.013, 0.016) × 1.0 | (0.008, 0.009, 0.012) × 1.0 |
| Exposure | −0.9 | −0.6 | −0.4 | 0.0 |
| Key | 420 W, 1.6 m, at (−1.6, −1.5, 1.9), white | 160 W, 1.0 m, at (−0.9, −0.9, 1.3), white | 120 W, 0.7 m, at (−0.7, −0.75, 0.85), (0.95, 0.97, 1.0) | 90 W, 1.2 m, at (−1.2, −1.4, 1.4), (0.75, 0.82, 1.0) |
| Fill | 110 W, 2.0 m, at (1.9, −1.1, 0.9) | — | — | — |
| Rim | 380 W, 1.5 m, at (0.3, 1.8, 1.5), (0.86, 0.94, 1.0) | 130 W, 1.0 m, at (0.7, 0.9, 0.8), (0.6, 0.85, 1.0) | 150 W, 0.5 m, at (0.6, 0.55, 0.55), (0.55, 0.85, 1.0) | 120 W, 1.0 m, at (0.8, 1.2, 0.9), (0.5, 0.75, 1.0) |
| Kick | — | — | 60 W, 0.4 m, at (−0.5, 0.6, 0.25), warm (1.0, 0.6, 0.45) | — |
| Top | 160 W, 3.0 m, at (0, 0.2, 2.8) | 90 W, 1.6 m, at (0, 0, 1.6) | 40 W, 1.0 m, at (0, 0, 1.2) | — |
| Haze volume | — | — | Volume scatter density 0.05, 3 × 3 × 1.5 m | Density 0.07, 4 × 4 × 1.5 m |
| Light target | (0.02, 0.06, 0.2) | (0, 0.02, 0.05) | (0.02, 0, 0.1) | (−0.1, 0.06, 0.08) |
| Reference camera | (0.02, −1.95, 0.6), 42 mm, f/7.1 | (0, −1.2, 1.3), 45 mm, f/8 | (−0.12, −0.9, 0.36), 55 mm, f/4.0 | (0.62, −1.02, 0.24), 40 mm, f/2.8 |

All lights are area lights aimed at the target (square unless stated). **Cyclorama** (`cyc()`): width 12 m, flat run from 6 m in front to 1.2 m behind the target, cove radius 1.5 m, wall height 6 m, built at the origin facing −Y.

### 9.3 Scaling the rig to a part
The reference rigs were tuned for a subject with a bounding-sphere radius of ≈ 0.7 m (the lineup). For one part:
- `s = max(0.1, part bounding-sphere radius / 0.7 m)`.
- Multiply every light position, light size, cyc dimension and haze size by `s`. Multiply light power by `s²`, so irradiance at the part is unchanged.
- Light target = the part's bounding-sphere centre.

### 9.4 Turntable

| Spec | Value |
|---|---|
| Rig | LIGHT-CYC, scaled (§9.3) |
| Frames | **36** (10° steps), starting at the front (−Y), rotating the part clockwise seen from above |
| Camera | 50 mm, elevation **20°**, distance auto-fitted so the bounding sphere fills 75 % of the frame height, f/8, focus on the bounding-sphere centre |
| Extra frames | 1 × **DARK-CYC** at the front-right three-quarter (azimuth 30°), 1 × DARK-MECH for parts with clear shells, 1 × DARK-FX for parts with emitters (lit state) |
| LEDs | Preview emission at "active" (strength 14) in the part's channel colours |
| In-engine check | `tools/bake turntable <type>` in the engine's Studio (Light and Dark), same 36-frame path. The asset must look right in all three (ART_BIBLE §10) |
| Deliverable | `review/<type>/<type>__turn_light_00..35.png`, `__dark.png`, `__mech.png`, `__fx.png`, plus an MP4 of the 36 frames at 12 fps |

**Notes.** Review renders are never shipped and never used as textures. The Library thumbnails (the UI's 3D part icons) come from the thumbnail rig in [ui_icons.md §6](ui_icons.md#6-library-card-thumbnail-rig), rendered by `tools/blender/render_thumbs.py` with the warm Tinker Lab light. From M3 every asset is also checked in the in-engine Tinker Lab (ART_BIBLE §10).
