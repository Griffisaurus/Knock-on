# M1 status: vertical slice

Last updated 2026-10-24. **M1 is complete on Chrome:** every exit criterion and deliverable below is met. Plan: [PRODUCTION.md §2](../PRODUCTION.md), "two friends can build and blow things up". Chrome first ([D51](DECISIONS_2026-10-24.md)). Implementation decisions: D52–D68 in the same file. M0: [M0_STATUS.md](M0_STATUS.md).

## Exit criteria

| Criterion | Result |
|---|---|
| **A 40-part machine replays identically** | **PASS.** A 42-part, 5-link machine using every M1 channel gives identical hash sequences and identical detonation ticks across replays in Node (golden pinned in `packages/sim/test/machine.test.ts`), and in Chrome. Plus 27 per-part golden machines, each replayed twice. |
| **2 players for 1 hour, zero desyncs** | **PASS** (`pnpm test:mp -- --minutes 60 --late 0.3`). Two headless clients ran against a local Host Server over a simulated relayed link (one-way 40–80 ms with jitter) for 60 minutes on the final code: 76 runs, the machine edited between runs, about 428,000 ticks each, 1,442 pokes (30 % deliberately late), and 389 rollbacks on each side. All 6,688 hash checks matched: **0 desyncs, 0 resyncs, 0 rejected pokes**. Two earlier attempts found bugs, fixed before this run: a missing start-state checkpoint (D70), and runs starting from an unconfirmed world (D72). An isolated two-machine field check also completed 76 runs and 6,688 matching hash checks with **0 desyncs and 0 errors**; machine names and network details are intentionally omitted. |
| **Room at tier target** | **PASS** on the 16 GB tier (NVIDIA Blackwell). A Room-preset machine of 2,288 parts runs in Chrome with explosions. Sim bake: a steady 120 ticks/s with the full 4 s lead and no waiting. GPU: 100k parts + 1M sparks = 6.3 ms at 1280×720, so a Room is far under budget. |

## Deliverables (PRODUCTION §2, M1)

| Workstream | Delivered |
|---|---|
| **Sim** | Channels: Impact, Signal, Spin, Tension, Power, Heat.<br>Explosions with exposure rays and sympathetic chains.<br>Breakage: BRIK mortar joints, PLANK snap and burn-through into pre-built halves.<br>Checkpoints every 0.5 s (Jolt state as bytes plus a plain-data clone), rollback for late pokes, desync repair by checkpoint transfer.<br>Bake-ahead v1: 4 s ahead, keyframes every 4 ticks, 3 minutes scrubbable. |
| **Gameplay** | All **25 Ship = M1 parts**: THUD, BOING, HELIO, BRIK, PLANK, SLOPE, TUBE, LEDGE, FULCRUM, ANCHOR, SHEAVE, TREADWAY, BAND, LINE, COG, MOTOR, GALE, MAINS, STOMP PAD, THE BUTTON, WICK, FUSE, BANGSTICK, SNIPPER and TOPPLE TILES (plus STITCH).<br>Library cards for all of them (`packages/parts-data/src/cards.ts`).<br>A demo machine per part (`demos.ts`).<br>Per-part goldens and property fuzz (`packages/sim/test/goldens.test.ts`, `fuzz.test.ts`). These found 7 drive-train bugs, all fixed (D61, D62). |
| **Graphics** | Uber material v1: PBR, rounded-edge bevel, per-vertex master materials for art meshes, emissive LED states and port-ring LEDs lit by channel activity.<br>Decals from the shared atlas (alpha-to-coverage under MSAA) and engine-drawn screens: MAINS shows its network's load as a 10-cell bar that blinks amber on overload ([D69](DECISIONS_2026-10-24.md)).<br>Clustered forward+ lights: 16×9×24 clusters, up to 1,024 lights (flames, fuse fronts, explosion flashes).<br>Particles v1: sparks, embers, fire, smoke, dust, glow, shock ring.<br>Scorch and soot decals.<br>4× MSAA (TAA upscaler in M3, D60).<br>Khronos PBR Neutral tonemap, bloom.<br>The Studio: light and dark cyc, the swept cyclorama cove per preset, key/fill/rim, stabilised shadows. |
| **Tools/UI** | Build HUD (top bar, settings, hint line, F9 perf HUD).<br>Dock with tools: Place, Select, Wire, Path.<br>Library (L), Inspector, radial menu (hold Q), command palette (Ctrl+K), undo/redo.<br>Rotate (R/T/Y), work plane (Ctrl+wheel), wire waypoints, TUBE path tool (P / Shift+P).<br>Run HUD: transport, speed 0.1–4×, step, timeline with channel-coloured event markers, bake-head shading and drag-to-scrub, K.O. count, event toasts.<br>Countdown. Ghost trails of the last run. |
| **Net** | MULTIPLAYER v1:<ul><li>ops with optimistic apply</li><li>soft locks (the selected part is held)</li><li>presence, chat (/), pings (G)</li><li>shared run start on the server clock</li><li>shared playhead held at the slower partner's bake head</li><li>pokes with rollback</li><li>desync detection and checkpoint repair</li><li>solo preview (Shift+Space)</li><li>rejoining a run in progress (same snapshot, start time and pokes, then catch up to the shared playhead; checked in Chrome: back within 1 tick, 0 desyncs)</li><li>persistence and journal</li></ul>Ops over the host's rate limit are rejected, not dropped, and clients pace sends (D65). |
| **Art** | Final art for **all 21 M1 part types that have a body**, as 23 meshes. COG ships one mesh per size, picked by `artFor(props)`. SLOPE is authored flat and tilted to its `angle` by `artAt(props)`, with colliders that follow its knife-edge nose (D71).<br>Shared kit: port rings, feet, fasteners, LEDs, screen bezels, master materials, and the **4096² decal atlas** (`pnpm assets:kit`). It holds name strips, generic words, spec lines, numerals, all 16 pictograms and hazard trims. 18 parts carry name plates, pictograms and stripes per their briefs. Typefaces per the brief: Unbounded Bold, Inter Medium, JetBrains Mono Bold (all SIL OFL).<br>All of them are made in Blender by `node tools/assets.mjs`, pass the validator, and export LOD0–3 with master materials. Hinged parts split into a static base and a moving `:arm` mesh.<br>`packages/assets/test/parts.test.ts` checks every built part against its brief and parts-data, and every decal UV against an atlas slot. Contact sheet: `art/style-samples/m1_parts.png`.<br>TUBE, BAND, LINE and FUSE are drawn procedurally (swept tube, cables). |
| **Audio** | All procedural Web Audio, built from fixed seeds (no files):<ul><li>material impacts (and domino cascades), rolls</li><li>pyro: yield-sized booms that merge within 80 ms, plus pops, snips, clicks</li><li>loops for fuses, motors, fans and flames</li><li>UI sounds</li><li>music v1: a Build bed, and a Run track that adds layers with explosion density</li></ul>64 voices, compressor and limiter. |

## How to check it

```bash
pnpm test
```

271 tests, including 15 Machine, 7 breakage, 27 per-part goldens, property fuzz, drive-train regressions and the host session tests.

```bash
pnpm test:mp -- --minutes 60 --late 0.3
```

The two-player soak. It runs a real Host Server and two headless clients with the sim over a simulated relayed link (one-way 40–80 ms with jitter). Both players poke at random, 30 % of the pokes deliberately late so the partner must roll back, and the machine is edited between runs. It exits non-zero on any desync.

## Known limits (tracked for M2+)

- **Network:** public deployment and multi-machine setup are intentionally outside the repository's setup instructions. The checked-in soak command runs both clients against a loopback-only Host Server and adds latency in process.
- **Shadows:**
  - One stabilised cascade, with no cached static shadows yet.
  - The shadow pass dominates at 1M parts.
- **TUBE:** glass is translucent but doesn't refract; bends render as overlapping segments.
- **Art:** decals aren't baked into LOD2 yet. SLOPE has no Rails prop, so its rails are a low lip. Unique texture sets, shape keys, skins and resizable modules wait for M2 ([PIPELINE_STATUS](../art/PIPELINE_STATUS.md)).
- **Fracture:** waits for `.frac.glb` chunks (PLANK uses two halves, D66).
- **Drive trains:** gears couple velocities only (D61), so meshed teeth can drift in phase over long runs. Invisible today: teeth don't collide.
