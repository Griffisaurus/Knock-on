# Asset briefs

One brief per asset. A brief is the **contract** between design, art and engineering. If the model matches the brief and passes `validate_part.py`, it works in the game.

Read first: [ART_BIBLE.md](../ART_BIBLE.md) (look) · [ASSET_PIPELINE.md](../ASSET_PIPELINE.md) (conventions, naming, budgets) · [GAME_SPEC.md §11–12](../../../GAME_SPEC.md) (gameplay).

## Index

| File | Contents | Briefs (asset types) |
|---|---|---|
| [rollers.md](rollers.md) | Balls and loose bodies | 8 (8: Glint / Bearing are skins of `marble`) |
| [frame.md](frame.md) | Structure | 17 (17) |
| [drive.md](drive.md) | Motion and transmission | 12 (17: `line`, `line_chain`, `line_bungee`; `cog_s`, `cog_m`, `cog_l`, `cog_bevel`) |
| [air.md](air.md) | Fans, bellows, blowers | 5 (5) |
| [power_signal.md](power_signal.md) | Power sources, sensors, logic, light, plus power/signal cables | 19 (20: `mirror`, `splitter`) |
| [boom.md](boom.md) | Fire and explosives (plus the Singularity) | 13 (13) |
| [contraptions.md](contraptions.md) | Springs, launchers, traps | 11 (12: `paddle`, `bumper`) |
| [matter.md](matter.md) | Sand, water, marbles, slime emitters | 8 (8) |
| [fun.md](fun.md) | Dominoes, pins, glass, music, toys | 8 (9: `pane`, `vase`) |
| [future.md](future.md) | Future Tech | 10 (10) |
| [critters.md](critters.md) | Mochi, Pip, Goby, Bandit, Biscuit, Henny, Dusty, Buzz, plus the Buzz beacon | 8 + `buzz_beacon` companion (9) |
| [environments.md](environments.md) | Studio, Mega Kitchen (+ M3 maximalism pass), Tinker Lab, Backlot, Orbital Hangar, Moon Base, shared props kit `kn_prop_*` | 6 + `env_scale_ref` prefab + 45 kit props (52) |
| [shared_kit.md](shared_kit.md) | Port rings, fasteners, feet, LEDs, screens, decal atlas, master materials, debris library | — |
| [vfx.md](vfx.md) | Particle, volumetric and decal effects | — |
| [ui_icons.md](ui_icons.md) | Icon set, channel glyphs, brand mark, Library card rig | — |

**Variants.** A variant part is one brief. Where the variants differ in shape or physics they are separate `type_id`s with one `.blend` each (ASSET_PIPELINE §3.3): Cog S / M / L / bevel, Line / Chain / Bungee, Mirror / Splitter, Paddle / Bumper, Pane / Vase. Where only the material or a sub-mesh changes they stay one type: Glint / Bearing are material skins of `marble`, and the 15 Tonebars bar lengths are meshes inside `tonebars.blend`.

**Family block.** A family file may add a short block between the status table and the first brief, headed **Family block.** or **Family colour rule.** It holds rules shared by every brief in that file (colour split, content limits, AI references) and applies to all of them.

Each family file starts with a status table (`Asset · Class · Ship · Stage`), where Stage is one of: `brief` → `blockout` → `model` → `surface` → `rig/anim` → `lod/frac` → `final`. Update it in the same PR as the asset.

## Conventions used in briefs
- **Coordinates** are Blender metres relative to the part origin: **+X right, +Y back (front faces −Y), +Z up**.
- **Sizes** are W × H × D in metres (game cells in brackets; 1 cell = 0.1 m).
- **Materials** use master IDs from [ASSET_PIPELINE.md §5.1](../ASSET_PIPELINE.md#51-master-materials).
- **Port sizes:** PR-S, PR-M, PR-L ([ART_BIBLE §5](../ART_BIBLE.md#5-port-rings-the-unifying-device)).
- **Box dimensions** in Collision and Sensors rows are **W × H × D** like sizes (X × Z × Y in Blender); cylinders and capsules are given as r or ⌀ × length with the axis named.
- **Channels:** impact, signal, spin, tension, power, light, heat, air, fluid, sound, lure, field.
- **Sensor kinds:** `trigger`, `pressure`, `intake`, `catch`, or the name of the channel the volume receives ([ASSET_PIPELINE §3.3](../ASSET_PIPELINE.md#33-collections-and-object-naming)).

## Template

Copy this block for each asset.

```markdown
### NAME: Short descriptor
`type_id` · Family · Class S/M/L/XL · Ship M# · Inspired by (internal only): … / none

**Concept.** 2–3 sentences: what it is, how it should feel, what makes it read instantly.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.00 × 0.00 × 0.00 m (cells) · origin: … |
| Mass · physics | 0.0 kg · phys material(s) · notable values (restitution, friction) |
| Collision | COL__… list |
| Materials (60/30/10) | neutral: … · signature: … · accent: … |
| Ports | `PORT__channel__name` · dir · size · position (x, y, z) · facing |
| Pivots | `PIVOT__name` · axis · limits · what moves |
| Sensors | `SENSOR__kind__name` · threshold · where |
| Emitters | `EMIT__fx__name` · where · what spawns |
| LEDs / screens | groups and screens with meaning |
| States | idle / active / … : what the player sees in each |
| Animation | procedural pivots / shape keys / clips (names) |
| Fracture | none / N chunks: how it breaks |
| Skins / variants | … |
| Budget | LOD0 tris · texture set |
| Audio hooks | events that need sounds (handed to audio) |

**Read at a glance.** Silhouette and colour cues that make it recognisable at 150 px.
**Notes / don'ts.** Gotchas, gameplay-critical shapes, things to avoid.
```
