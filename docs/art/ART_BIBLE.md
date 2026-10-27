# KNOCK-ON Art Bible

Status: v1.1 · 2026-10-24 · Owner: Art Director · Applies to every model, material, texture, effect and icon that ships.
Related: [ASSET_PIPELINE.md](ASSET_PIPELINE.md) (how to build and export) · [briefs/](briefs/README.md) (what to build, per asset) · [GAME_SPEC.md §10, §19](../../GAME_SPEC.md) · Look and feel pivot: [D77–D79](../dev/DECISIONS_2026-10-24.md)

![Lineup look-dev](../../art/style-samples/knockon_lineup.png)

---

## 1. North star: "Lab Toy Futurism" in a science-class world

> **A designer toy that is also a precision instrument, well loved on a busy classroom workbench.** Every part looks like a premium product you'd want on your desk. It's soft, chunky and friendly, but engineered: you can see how it works, and its surfaces invite a touch.

Since the M2 review the target is **"science class maximalism"** ([D78](../dev/DECISIONS_2026-10-24.md)): a warm, busy, lived-in tinkering classroom around the machine. Parts keep their shapes, ports and gameplay. Their **surfaces**, the world around them and the light change.

### The five rules
1. **Readable at 150 px.** A player must recognise a part from its silhouette and one dominant colour at thumbnail size and at mid-zoom in a busy machine. If it reads only up close, it fails.
2. **Show the mechanism.** Where a part *does* something, let the player see it: clear shells over motors and coils, visible springs, exposed gears, fuses you can watch burn.
3. **One kit, many products.** All parts share the same fasteners, feet, port rings, LEDs, label system and material masters. That consistency is what makes 115 parts feel like one product line.
4. **Every part is a character.** Slight exaggeration (oversized buttons, chunky handles, cheeky proportions) gives each part personality without turning it into a cartoon.
5. **Loved, not grimy.** Tactile, texture-rich surfaces: hardwood grain, enamel paint, cast iron, brass and copper patina, cord, print, moulding marks (§4). Wear shows on edges, handles and contact points as worn paint and polish. No rust, dirt or grunge. (Replaces "Pristine" from v1.0.)

### The world rule
**Busy around, calm in the middle.** Sets are maximal, but the machine always reads first: the build zone stays clean and level, the clutter ring around it is dense, and the far background is soft and about one stop darker and less saturated (§9).

---

## 2. Shape language

| Element | Rule |
|---|---|
| **Primary forms** | Rounded rectangles, capsules, cylinders, spheres. Avoid sharp wedges unless a part is *about* a sharp thing (Snipper blades, Slope edge). |
| **Bevels** | Every hard edge is bevelled: **≥ 2 mm or 1.5 % of the part's largest dimension**, whichever is larger, with 3–5 segments and weighted normals. Large housings use a bigger "pillowed" radius (6–15 mm). **Thin and resizable parts** (Plank, Slope, Ledge, Rack, Tube, Pane, Tonebar bars and similar sheets, bars and rails) use **≥ 2 mm or 1.5 % of the smallest cross-section dimension**, whichever is larger, never 1.5 % of the full length (a 4 m Plank does not get a 60 mm bevel; a 10 mm glass edge gets 2 mm). |
| **Proportion** | Functional interaction points are exaggerated **1.2–1.5×** real scale: buttons, levers, handles, fuses, knobs. Housings stay true to scale. |
| **Feet** | Every freestanding device sits on **rubber feet** (`kn_rubber`, 3–5 mm high) or a graphite plinth. Nothing touches the floor with its painted shell. |
| **Fasteners** | Hex-socket button-head screws in 3 sizes only (M3 Ø 5.5 mm, M5 Ø 8.5 mm, M8 Ø 13 mm), always `kn_steel_brushed`. Use them where a real product would have them: corners of housings, caps, brackets. **4 per face maximum.** |
| **Panel lines** | 0.6–1.0 mm grooves where shells meet (from geometry, or a normal map for small parts). Keep them sparse; they add precision, not noise. |
| **Silhouette test** | Fill the part's front orthographic view solid black at 64 px tall. If you can't name it, revise. |

---

## 3. Colour

### 3.1 Powder-coat palette (asset albedo)
Albedo values are sRGB and capped so linear albedo stays ≤ 0.85. The UI palette (GAME_SPEC §9.2) uses the same names, but some asset values are softened for PBR. Since D78 the `kn_powder_*` masters read as **enamel-painted steel** (§4); their IDs and colours are unchanged, and a part's texture set may vary the value by ±4 % (worn edges, polish) but never shifts the hue.

| Master | sRGB | Role on assets |
|---|---|---|
| `kn_powder_graphite` | `#3A3E47` | Default chassis, plinths, caps, end blocks. The "frame" of most devices. |
| `kn_powder_bone` | `#E8E2D6` | Secondary housings, faces, dials, Topple Tiles, Dusty |
| `kn_powder_ignition` | `#FF5B2E` | Action and hero moving parts: buttons, punch glove, Fulcrum base, hazard accents |
| `kn_powder_volt` | `#C6FF3A` | Small accents on power devices only (never large panels) |
| `kn_powder_cobalt` | `#3355FF` | Structural accents: Frame family, cogs, rails |
| `kn_powder_plasma` | `#FF3DAE` | Future Tech accents, Helio latex, playful parts |
| `kn_powder_amber` | `#FFB020` | Heat and warning: hazard stripes, Flamer, Ringer bells |
| `kn_powder_beam` | `#2FD6FF` | Optics: Torch, Lance, Mirror frames, Suncell trim |

### 3.2 The 60 / 30 / 10 rule
Per part: **60 %** neutral (graphite, bone or metal), **30 %** the part's signature colour, **10 %** accent (LEDs, a contrasting knob, a label). A part should never be more than two powder colours plus metal.

### 3.3 Family signature colours
These give the Library and the world a scannable rhythm.

| Family | Signature (30 %) | Notes |
|---|---|---|
| Rollers | Each ball has its own colour | Balls must never be confused with each other at a distance |
| Frame | Bone + Cobalt | Quiet, so moving parts pop against it |
| Drive | Graphite + Ignition | Clear poly shells on motors |
| Air | Bone + Beam | Amber-tinted poly blades |
| Power & Signal | Graphite + Volt accents | Volt only as trim and LEDs |
| Fire & Boom | Paper red + Amber hazard stripes | Graphite tape and hardware |
| Contraptions | Ignition + Bone | Springs in chrome |
| Matter | Clear poly + Beam | Show the contents |
| Fun | Free, playful | Still within the palette |
| Future Tech | Graphite + Plasma + emissive | Smooth, seamless, fewer fasteners: the "newer product line" |
| Critters | Natural stylised colours | §8 |

### 3.4 Channel colours are reserved for light
The 12 channel colours (GAME_SPEC §9.2) appear on assets **only as emissive LEDs, port-ring lights and screen graphics**, never as large painted surfaces. (Brand powders that share a hue, like Volt and Ignition, are fine as paint because LEDs are emissive and pulse.)

---

## 4. Materials

All assets use the **master material library** (`assets/src/lib/materials.blend`). Never make a one-off material. Parts link masters, and since D78 each part also carries its **own texture set** (albedo, normal, ORM at 1–2k) **layered over the masters**: the master fixes the material's response (colour swatch, coat, sheen, transmission), the set adds the surface story (grain, worn edges, patina, print, moulding marks). Masks and vertex colours alone are no longer enough for a final part. Full parameter table and set rules: [ASSET_PIPELINE.md §5](ASSET_PIPELINE.md#5-materials-and-textures).

| Master family | Look | Key parameters |
|---|---|---|
| **Enamel paint on steel** (`kn_powder_*`, IDs kept) | Satin enamel with a faint orange-peel and a thin clearcoat sheen; soft worn edges show steel or undercoat | Roughness 0.40–0.45, coat 0.25 / coat roughness 0.3, orange-peel detail layer |
| **Gloss powder** (`kn_powder_*_gloss`) | Candy-gloss for hero buttons only | Roughness 0.25, coat 1.0 / 0.03 |
| **Anodised / enamelled** (`kn_anod_*`) | Coloured parts: cogs, rails, trims | Since D88: **enamel paint over metal** (as the key art paints them). Metallic 0 on the paint, 1 only where it's worn through on edges; roughness 0.42–0.48. Texture sets carry it in ORM |
| **Brushed steel** (`kn_steel_brushed`) | Fasteners, axles, collars, grills | Metallic 1, roughness 0.22–0.26, anisotropy 0.6 |
| **Chrome** (`kn_chrome`) | Springs, shafts, levers | Roughness 0.05 |
| **Brass / Copper** | Pins, bosses, windings, pulls; warm brown patina in recesses, polished high points | Roughness 0.25–0.3 (patina +0.15) |
| **Cast iron** (`kn_iron_cast`, new in M3) | Weights, vice bodies, brackets, radiators: satin black-grey with fine pitting | Metallic 1, roughness 0.55, pitting detail layer |
| **Polycarbonate** (`kn_poly_*`) | Clear or tinted shells, blades, windows | Transmission 1, IOR 1.58, roughness 0.03–0.06, tint ≤ 25 % saturation |
| **Glass** (`kn_glass`) | Fishbowl, Pane, Vase, lenses | Transmission 1, IOR 1.5, roughness 0 |
| **Rubber** (`kn_rubber`, `_grip`) | Feet, bumpers, belts, cables, seams; moulding marks (parting lines, ejector-pin circles, tiny moulded text) | Roughness 0.8–0.85, sheen 0.3; `_grip` adds knurl normal |
| **Hardwood** (`kn_wood_oak`, `_walnut`) | Planks, Fulcrum, Stackers, handles, the workbench: visible grain on faces and end grain on cut ends | Grain painted in the texture set (procedural rings for look-dev) + clearcoat 0.35, wood-grain detail layer |
| **Paper** (`kn_paper_red`, `_tan`, `kn_cardboard`) | Bangsticks, kegs, boxes: printed graphics and visible fibre | Roughness 0.7–0.8, paper-tooth bump |
| **Rope and cord** (`kn_rope`, `kn_fuse_cord`) | Lines, strings, cotton cord, fuses | Twist / braid normal, fibre fuzz in the set |
| **Latex** (`kn_latex_*`) | Helio | Roughness 0.3, coat 0.7, subsurface 0.12 |
| **Ceramic / Brick** | Vase, Brik | Ceramic glossy; brick matte with tooled mortar faces |
| **Fur / skin** (`kn_fur_*`) | Critters | Stylised clumps, sheen 0.5 |
| **Emissive** (`kn_led`, `kn_screen`) | LEDs, displays | Driven by the engine. Never bake emission colour into textures |

**Detail layer.** On top of the set, the renderer adds a tiling detail layer per master (wood grain, paint orange-peel, cast-iron pitting, brushed steel, paper tooth) that fades in close to the camera ([D79](../dev/DECISIONS_2026-10-24.md), RENDERING §6.1). Artists pick the detail map per master; they never paint it into the set.

**Wear: "loved, not grimy."** Wear tells the story of hands, never of neglect.

| Where | What | Limit |
|---|---|---|
| Exposed edges of painted parts | Enamel worn through to steel or a darker undercoat | Bands ≤ 3 mm wide on edges only, ≤ 5 % of any face; never on flat faces |
| Handles, knobs, buttons, levers, contact points, feet | Hand polish: roughness −5 to −10 %, albedo +4 to +8 % | Curvature- and contact-masked |
| Brass and copper recesses, engraved lines | Warm brown patina: albedo −15 %, roughness +0.15 | Recesses only. No green verdigris |
| Hardwood | Grain on faces, end grain on cut ends, slightly rounded arrises, polish on handles | No splits, stains, water marks or burns |
| Paper and card | Print, fibre, softened corners | No tears, stains or creases across graphics |
| Rubber | Moulding marks | No cracks or perishing |
| Cast iron | Fine pitting, satin sheen on high points | No rust |
| Cavities (all) | Ambient-occlusion darkening in the ORM | Albedo never darkened more than 20 % |

**Never:** rust, dirt, dust, grime, stains, grunge overlays, scratches across faces, chips on flat faces, photo-scanned textures used as-is. The albedo range (linear 0.03–0.85) still holds after wear.

---

## 5. Port rings: the unifying device

Every connection point in the game is the same machined part. Players learn it once and read every machine. **This is the single most important readability element; artists never redesign it.**

```
   side view                      front view
   ┌─┐  collar (kn_steel_brushed)    ╭───────╮
 ──┤ ├── LED ring (kn_led)          │ ╭───╮ │  ← collar
   └─┘  socket (kn_rubber)          │ │ ● │ │  ← socket (dark)
                                    │ ╰───╯ │  ← LED ring between
                                    ╰───────╯
```

| Size | Outer Ø | Use |
|---|---|---|
| **PR-S** | 28 mm | Small parts (Cell, Button, Tripwire...). Rollers never have ports, with one exception: HELIO's string-clip ring (`PORT__tension__knot`), its Tension channel |
| **PR-M** | 42 mm | Most devices |
| **PR-L** | 56 mm | Large devices (Dynamo, Big Top, Fabricator, Arc Tower) |

**Placement rules**
- The ring faces outward from a flat area of the housing, and is **visible from the default front three-quarter view**. Never hide one underneath.
- The ring's centre is at the `PORT__<channel>__<name>` empty (local +X = outward).
- Minimum spacing between rings: 1 ring diameter.
- Linked asset only: `assets/src/lib/port_ring.blend` (collection `PR_S`, `PR_M`, `PR_L`).

**LED states** (driven by the engine; artists only assign the `kn_led` faces):

| State | Look |
|---|---|
| Idle / unconnected | 8 % brightness |
| Connected, inactive | 25 % |
| Active | 100 % with soft bloom |
| Flowing | 100 % with a travelling pulse around the ring |
| Fault (jam, stall, overload) | Amber 2 Hz blink, whatever the channel colour |

---

## 6. LEDs, screens and labels

- **Status LEDs:** small domes (Ø 6–10 mm) or light bars on `kn_led`. They show state physically (Motor "running", Cell charge, Ringer armed). Group them with a vertex-colour index per [ASSET_PIPELINE.md §3.6](ASSET_PIPELINE.md#36-led-groups).
- **Screens:** flat inset panels on `kn_screen`. The engine draws content into them: 7-segment numbers (Ringer, Delay, Recycler count), bar meters (Cell, Tank), and icons. Bezel in graphite, glass cover with `kn_glass`.
- **Labels and decals** come from the shared decal atlas (`kn_decal`). Every product gets:
  - A **name plate** with the part name in *Unbounded* Bold, Bone on Graphite or Graphite on Bone.
  - Optional **spec text** (*Inter*, tiny, e.g. "KN-07 · 24V · 1.5 rps"), purely flavour, 1 line.
  - **Pictograms:** 16 shared marks, never more than one per face. The canonical list and the parts allowed each mark are in [shared_kit.md §6.2](briefs/shared_kit.md#62-pictograms). Key rules: explosive only on Fire & Boom explosives; high voltage only on Arc Tower and Mains (not Dynamo); hot surface only on heat devices.
  - Hazard stripes (Amber/Graphite 45°) only on Fire & Boom items, Flamer and Arc Tower.
- Never more than **one name plate plus one secondary label** per visible face.

---

## 7. Transparency: what to show inside

Clear `kn_poly_*` shells are the signature of powered parts. Rules:
- **What goes inside:** the *working mechanism*: coils and windings (Motor, Dynamo), magnets, a spinning armature, gear trains, the spring (Gotcha Box, Pinger), fluid (Tank), sand (Hourglass, Grit Hopper), Pip's wheel.
- **Interiors get full detail** at LOD0 and LOD1, and are simplified to a coloured silhouette at LOD2. At LOD3 and impostors, the shell is opaque tinted.
- **Tint:** clear by default. Beam tint for optics and electric, Amber tint for heat devices, Plasma tint for Future Tech. Keep saturation low so the interior stays readable.
- **Avoid** stacking more than 2 transparent layers in one sight line (sorting and refraction cost).

---

## 8. Critters

| Rule | Detail |
|---|---|
| **Style** | Stylised "soft-sculpt" collectible figures: smooth primary volumes, fur suggested by big sculpted clumps (no strand fur on the base mesh; shell fur on the 12 GB tier and up, D43; *as built, the renderer's shell-fur pass isn't implemented yet, so every tier shows the base layer*), satin finish |
| **Proportion** | Big heads (head ≈ 40 % of body height), large expressive eyes, short limbs. Readable poses from 10 m away. |
| **Eyes** | Glossy dark iris with two specular catchlights modelled as geometry (they read in any light), lids rigged for blinks and expressions. **No emissive eyes on animals** (Dusty and Buzz are robots, so they get LED eyes). |
| **Expressions** | Face shape keys: neutral, happy, smug, scared, angry, dizzy, sleepy, surprised, determined, plus visemes A/O/E for barks |
| **Colour** | Natural but tuned to sit against the brand palette. Each critter has one signature accessory in a brand colour (§ briefs) so players can spot them in chaos. |
| **Safety** | Critters are **never** shown hurt, bleeding, burnt or squashed. Big hits → ragdoll → dizzy stars → indignant emote → get up. Soot from explosions is a comedic dusting, cleared on Stop. |
| **Scale** | Real animal scale (Mochi ≈ 45 cm long), so the world reads as a giant toy room around them |

---

## 9. Environments

| Environment | Mood | Art notes |
|---|---|---|
| **The Tinker Lab** (default for Desk and Room) | Late afternoon after class | A science classroom and workshop: a long hardwood workbench with a gridded cutting mat (the build zone), chalkboard and blueprint posters, shelves of books, beakers and jars, a globe, potted plants, pegboard tools, pendant lamps, tall windows with golden sun, MOCHI asleep on the bench. Maximal, warm and lived-in, built from the shared props kit. Backdrop for the lobby and title ([D78](../dev/DECISIONS_2026-10-24.md)). |
| **The Studio** | Product launch | Infinite cyclorama (light warm grey `#BDB8AF` or dark `#1C1F26` toggle), soft-box key top-left, cool rim, subtle 1 m floor grid etched into the surface. Zero clutter; the machine is the hero. The clean "product shot" option, exempt from maximalism. |
| **Mega Kitchen** | Saturday morning | Toy-scale player in a full-size kitchen: counters as cliffs, a sink as a lake, a fridge as a skyscraper. Warm window light, morning haze. Real-world props built in the same bevelled toy style (not photoreal). M3 **maximalism pass**: fridge magnets and drawings, cereal boxes, a fruit bowl, plants, utensils, a crayon drawing taped to a cabinet, window light shafts. Layout and colliders unchanged. |
| **Backlot** | Summer afternoon to dusk | Sculptable terrain (grass, dirt, sand, rock layers), distant studio-lot buildings, wind in trees. Time-of-day presets. |
| **Orbital Hangar** | Clean sci-fi | White panelled hangar, Earth through a huge window, zero-g zones marked by floor rings, cool fill with warm accent lights |
| **Moon Base** | Lonely and fun | Grey regolith, hard sun, black sky, a lander and dome as backdrop. Helios sink here, which is a visual gag. |

Every environment includes a **scale reference** near spawn (a 1 m measuring stick and a Thud on a plinth), and keeps a **neutral zone** of at least 8 × 8 m with no props, for building (the Desk preset's zone is the 4 × 3 m mat or floor).

**Density zoning** (Tinker Lab and Mega Kitchen; [D78](../dev/DECISIONS_2026-10-24.md)):

| Zone | Distance from the build zone edge | Rule |
|---|---|---|
| **Build zone** | inside | The cutting mat (Desk) or the neutral zone (bigger presets). Clean, level, one material, no props, no shadows across it in the default light |
| **Clutter ring** | 0.5–3 m | Maximal: books, glassware, plants, tools, drawings, layered and overlapping, at every height. On the sun side, dressing near the zone stays low so its shadows never reach it |
| **Far background** | beyond 3 m | Busy but soft: haze, and depth of field in Photo mode, the lobby and the Build/Run tilt-shift |
| **Value and colour** | everything outside the build zone | About **one stop darker and less saturated** than the build zone, so parts and port rings always read first. Checked from each default camera (environments brief §0.10) |

Props come from the shared props kit (`kn_prop_*`), built in the same bevelled toy style, never photoreal, with no readable real-world brands. No prop may read as a part.

---

## 10. Lighting and look-dev

- **Game default: golden hour** ([D78](../dev/DECISIONS_2026-10-24.md), [D79](../dev/DECISIONS_2026-10-24.md)). The renderer's default look matches the warm key art, not the look-dev cyc. In the Tinker Lab: a warm sun key through the windows (≈ 3,500 K), cool sky fill through the glass, practical pendant lamps with bloom, light shafts on the 12 GB tier and up (full resolution on 32 GB, D85), an IBL baked from the set, then a warm per-environment grade, a soft vignette and fine grain. Exact values: [environments brief §3.4](briefs/environments.md#34-lighting-rig).
- **Look-dev rig** (all asset reviews still use it): `tools/blender/style_samples.py` scenes. Light cyc: key 420 W area 1.6 m top-left, fill 110 W, rim 380 W cool, top 160 W, exposure −0.9. Dark cyc for the mechanism and VFX checks. The cyc stays neutral on purpose, so material and colour problems aren't hidden by the warm grade.
- **Tonemapping:** **Khronos PBR Neutral** for look-dev and the game; it keeps brand colours true. The warmth comes from the light and the per-environment LUT (`lut_tinker_lab`; the Studio's is neutral), not from the tonemapper. AgX is available in Photo mode for cinematic contrast.
- **Turntables:** 36 frames, 3/4 elevation 20°, on the light cyc, plus one dark-cyc frame.
- Assets must look right **under both** cycs, under the in-engine Studio IBL, and in the in-engine **Tinker Lab** golden-hour light.
- **Key art:** `tools/blender/render_tinker_lab.py` renders the Tinker Lab key art (Cycles) from the exported part `.glb`s for the lobby, title, store page and README: `art/style-samples/tinker_lab_key.png` (hero, 1920 × 1080) and `tinker_lab_lobby.png` (the shallow-focus lobby and title close-up). It settles every part and MOCHI onto its real support and runs a triangle-level overlap check, so nothing floats or interpenetrates (`--strict` fails the render on any overlap; the hero passed with none). An in-engine frame of the same shot is reviewed side by side with it, as the Studio IBL is today (D79). Commands: [ASSET_PIPELINE §12](ASSET_PIPELINE.md#12-look-dev-icon-and-key-art-renders).
- **Tactile look-dev:** before the texture pass (done for every part through M5), renders used `tools/blender/_tactile.py`, procedural Cycles stand-ins for the §4 surfaces (enamel with worn edges, wood grain, patina, scratched steel, paper fibre, rubber, brick, cord, ceramic). They are the target for the texture sets, never shipped materials.

![Tinker Lab key art](../../art/style-samples/tinker_lab_key.png)

---

## 11. VFX style: "stylised-real"

| Effect | Direction |
|---|---|
| Sparks | Orange-gold streaks (`#FF8A2A` → `#FFC870` hot core). Velocity-stretched, short life, plenty of them |
| Fire | Real volumetric fire, colour pushed slightly warm and saturated. Blackbody ramp clipped before pure white |
| Smoke | Soft blue-grey (`#5B6270`) with warm underlighting from fire. Comic **smoke rings** for small pops |
| Explosions | Volumetric fireball + a **stylised shock ring** (thin bright ring on the ground plane) + debris + a 1-frame flash (comfort-capped) |
| Confetti | Brand palette only, matte paper, flutter |
| Water | Clear and slightly beam-tinted, bright foam, cartoon-crisp splash crowns |
| Sand | Warm beige grains, dusty puffs |
| Electric | Plasma-white core with a Beam outer glow, branching. Crackle sprites on contact points |
| Critter comedy | Dizzy stars (Amber 5-point), sweat drops, "!" pops, "zzz". 3D billboards that face the camera |
| Jam / fault | Amber sparks + puff from the jammed point, synced to the port-ring fault blink |

---

## 12. UI art
- Icons: 24 px line set, 1.75 px stroke, rounded caps and joins, Paper on dark glass. Line icons are for **actions and tools** only. Channel glyphs are filled (GAME_SPEC §9.2).
- **Parts are 3D renders everywhere in the UI** (parts tray, Library cards, Inspector header, palette results; [D77](../dev/DECISIONS_2026-10-24.md)): rendered at 3/4 by the thumbnail rig (`tools/blender/render_thumbs.py`, [ui_icons.md §6](briefs/ui_icons.md#6-library-card-thumbnail-rig)) with its **warm Tinker Lab light variant**, matched to the engine, 512² and 128², transparent background. They sit on glass wells, so the contact shadow and the warm rim must read on dark glass and on the solid fallback. The live hover turntable stays in-engine (*not built yet*: cards show the static render, UI_UX §4.4). Look-dev set: `art/style-samples/icons/` (28 warm tactile icons, 256²).
- **Fonts:** Blender currently draws the bundled Unbounded Bold "T" as "V" ([PIPELINE_STATUS](PIPELINE_STATUS.md#known-issues-look-and-feel-pivot)); check every baked label set in Unbounded (decal atlas, name plates) until it's fixed.
- Brand mark: "KNOCK-ON" in *Unbounded* Black. The hyphen is an Ignition spark streak.

---

## 13. Do and don't

| ✅ Do | ❌ Don't |
|---|---|
| Rounded, bevelled, chunky | Razor edges, thin fragile spindles (except springs and strings) |
| Let mechanisms show through clear shells | Hide every working part in an opaque box |
| Use the shared port ring, feet, fasteners and labels | Invent a new connector or fastener style |
| Keep each part to ≤ 2 powder colours + metal | Rainbow parts, gradients, patterns on structural pieces |
| Exaggerate interaction points 1.2–1.5× | Exaggerate whole objects into cartoons |
| Tactile surfaces: grain, enamel, patina, print, moulding marks; worn paint and polish on edges, handles and contact points | Rust, grime, dirt, stains, scratches across faces, chips on flat faces, photo-scanned textures |
| Dense, warm clutter ring; clean, level build zone; background a stop darker | Props in the build zone, props that look like parts, a background that outshines the machine |
| Critters cute, expressive, unhurt | Any injury, gore, real weapons, realistic firearms |
| Brand-safe, original designs | Anything traced from or referencing the 1993 sprites, or real brands' logos |

---

## 14. Art review checklist (every asset, before merge)
1. Passes the 64 px silhouette test and the 150 px colour-read test.
2. Matches its brief: size, ports, pivots, sensors, LED groups, clips.
3. Uses only master materials plus its own texture set (ASSET_PIPELINE §5.2); follows the 60/30/10 rule and the §4 wear limits ("loved, not grimy").
4. Port rings are linked, correctly sized, visible from the 3/4 view.
5. Bevels, feet and fasteners follow §2.
6. LOD chain holds its silhouette; the LOD2 interior is simplified.
7. Looks right on the light and dark cycs and in-engine (Studio and Tinker Lab).
8. `validate_part.py` passes (naming, budgets, collision, origin).
9. Provenance logged if any third-party input was used ([ASSET_PIPELINE.md §10](ASSET_PIPELINE.md#10-provenance-and-licensing)).
