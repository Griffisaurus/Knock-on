# KNOCK-ON Part System

Status: v1.2 · 2026-10-25 (as built through M5) · Owner: Gameplay Lead
Related: [SIMULATION.md](SIMULATION.md) · [art/ASSET_PIPELINE.md](art/ASSET_PIPELINE.md) · [art/briefs/](art/briefs/README.md) · [DATA_FORMATS.md](DATA_FORMATS.md)

A **part** is assembled from five things. *As built* is what the code has (M5 docs pass); the design column is kept where it differs.

| Piece | As built | Design (not built where different) |
|---|---|---|
| Art | `assets/build/parts/<type>/`: `<type>.glb`, `.art.json`, `.shapes.json`, `.frac.glb` (breakables), `.tex.{albedo,normal,orm}.ktx2` / `.png` texture sets, thumbnails | also `.sdf.ktx2` and `.impostor.ktx2` (not baked: the GI stamps boxes, impostors are baked on the GPU at first use) |
| **Definition** | Typed TypeScript data: `packages/parts-data/src/defs.ts`, `defs_m2.ts`, `defs_m3.ts`, `defs_m4.ts`, `defs_m5.ts` (the ten Future Tech parts) and `defs_m5_matter.ts` (GOO VAT), with property-dependent `shapes` / `visuals` / `boundsFor` functions ([D58](dev/DECISIONS_2026-10-24.md)); critter specs in `critters.ts` | `<type>.part.json` in `packages/parts-data/parts/` |
| **Behaviours** | Per-stage channel systems in `packages/sim/src/channels/` (`devices.ts`, `power.ts`, `light.ts`, `air.ts`, `m3*.ts`, `m4*.ts`, `m5*.ts`, …) and critters in `packages/sim/src/critters/`, dispatched by part type (§4) | `Behaviour` components in `packages/sim/behaviours/` |
| Card text and demo | `cards.ts` (card text) and `demos.ts` (`DEMOS`: one tiny machine per part type and link kind, which is also the part's golden) | `<type>.demo.knockon` in `packages/parts-data/demos/` |
| Audio / FX mapping | In the client: `apps/game/src/audio/` (event → cue) and `gfx/fx.ts` (event → effect), keyed by event kind and part type | in the definition |

---

## 1. Definition schema (`part.schema.json`)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string (lower_snake) | ✓ | Unique id; equals the art file name |
| `family` | enum | ✓ | rollers, frame, drive, air, power, boom, contraptions, matter, fun, future, critters |
| `name` / `tag` | string (i18n keys) | ✓ | "THUD" / "Heavy ball" |
| `class` / `ship` | S, M, L, XL / M0–M5 | ✓ | |
| `size` | [w, h, d] cells | ✓ | Must match `.art.json` footprint |
| `resize` | `{axes: "x" \| "xz" \| ..., min, max, step, mode: "scale" \| "nineSlice" \| "modular" \| "spline"}` | | Resizable parts |
| `mirror` | ["x", "y", "z"] subset | | Allowed mirror axes |
| `body` | `{kind: "static" \| "dynamic" \| "kinematic" \| "hinged" \| "slider" \| "softbody" \| "vehicle" \| "critter", mass, material, overrides}` | ✓ | Jolt mapping (SIMULATION §4.4) |
| `ports` | `[{name, channel, dir, maxLinks?, broadcast?, kind?}]` | | Must match the `.art.json` ports exactly. `maxLinks` rule in §3 |
| `behaviours` | `[{id, params}]` | ✓ | Ordered list of behaviour components (§4) |
| `props` | `{key: PropSpec}` | | Player-editable properties (§2) |
| `breakable` | `{hp, jSafe, jBreak, material, macroChunks}` | | `macroChunks` = number of `.frac.glb` chunks spawned on break (validated against the file; 6–24) |
| `flammable` | `{igniteTime, burnTime, onBurnt: "break" \| "cut" \| "pop" \| "detonate" \| "none"}` | | `detonate` = heat cook-off (Powder Keg, SIMULATION §5.7) |
| `explosive` | `{yield, sympathetic, fuseProp, macroChunks}` | | `macroChunks` = `.frac.glb` chunks spawned on detonation (0 = none; explosives may use as few as 4) |
| `power` | `{source?: {watts, mode}, consumer?: {watts, threshold}}` | | |
| `fx` / `audio` | `{eventKey: assetId}` | | Event → effect and sound mapping (art/briefs/vfx.md, AUDIO.md) |
| `card` | `{needs, does, tips[]}` (i18n keys) | ✓ | Library card text |
| `skins` | `[{id, label, ship}]` | | Cosmetic skins (no gameplay change) |
| `caps` | `{maxPerWorld?}` | | e.g. Singularity 4, Fabricator 64 |
| `requires` | `["matterGameplay"]` | | Feature flags the part depends on |

*As built (`PartDef`, `packages/parts-data/src/defs.ts`):* `type`, `family`, `name`, `tag` (plain strings, no i18n keys yet), `ship` (M1–M5), `bounds` / `boundsFor(props)`, `body {kind: 'static' | 'dynamic', mass, friction, restitution, ccd?, gravityFactor?, sharp?, material?, magnetic?, com?}` (`com`, M5, D111: an offset that moves the base body's centre of mass, via Jolt's `OffsetCenterOfMassShape`; only QUACK's 10 mm keel uses it), optional `hinge`, `slider`, `piece` (a pre-built dormant spawn: cork, head, slices), `lure`, `critter` (critter spec), `shapes(props)` and `visuals(props)` functions, `ports` (`PortDef`), `props` (`PropSpec`), `behaviours` (descriptive ids, §4.3), `explosive {yield}`, `flammable {igniteTime}`, `power {source?, consumer?}` (watts), and `art` / `artFor` / `artAt` for the pipeline mesh. Breakage tuning and fracture data live with the channel code and `frac_*.ts`. **Not built:** `class`, `size` (bounds stand in), `resize`, `mirror`, `breakable`, `fx` / `audio`, `card` (in `cards.ts`), `skins`, `caps` (SINGULARITY's 4 per world is enforced by the editor instead: `MAX_PER_WORLD`, `apps/game/src/ui/buildtools.ts`), `requires`, and a JSON schema.

---

## 2. Properties

```jsonc
"props": {
  "fuse":   { "type": "seconds", "min": 0.5, "max": 5, "step": 0.1, "default": 2.0 },
  "mode":   { "type": "enum", "values": ["trigger", "toggle", "on", "off"], "default": "trigger" },
  "color":  { "type": "brandColor", "default": "ignition" },
  "target": { "type": "partRef", "filter": { "family": "rollers" } }
}
```

| Type | Encoding | UI |
|---|---|---|
| `float`, `seconds`, `angle`, `metres`, `percent` | Quantized to `step`, stored as a varint of steps | Slider + numeric field, with units |
| `int` | varint | Stepper |
| `bool` | bit | Toggle |
| `enum` | varint index | Segmented control (≤ 4 values) or dropdown |
| `brandColor` | enum of palette names | Swatches (cosmetic only) |
| `partRef` | part id | Pick-in-world button |
| `text` | utf-8 ≤ 64 B | Text field (sticky notes, labels) |

Rules: properties are **quantized at edit time**, so the sim only ever sees canonical values. Every property must be safe at every value in its range (fuzz-tested, §8). Cosmetic properties are flagged `"cosmetic": true` and excluded from the sim hash.

---

## 3. Ports and links
- The definition's ports must equal `.art.json`'s ports (name, channel, dir). `validate:parts` fails otherwise.
- Allowed link kinds by channel: Signal → `cable_signal` or `ping`; Power → `cable_power`; Spin → `band` (axle ports) or gear mesh (automatic, no link); Tension → `line`, `chain`, `bungee`; Heat → `fuse`; Fluid → `tube` (Matter routing, M4); Air → none, except `fill`, which joins an Inflator's `fill` port to one Helio's `knot` port (no cable: the knot seats on the filler nozzle; SIMULATION §5.8). Lure has no link kind (bait hangs from a Tension hook).
- **`maxLinks`** is declared **per port** in the definition and must equal the `.art.json` port's `max_links` (ASSET_PIPELINE §3.5). Default **1**, cap **8**. That covers rope in/out on a Sheave (2), a fan of Lines on an Anchor (4), daisy-chained power outputs (4–6; a source's links share its watts through the supply factor, so more branches don't add supply) and signal fan-out (8).
- **Broadcast exception:** a Signal **output** port flagged `"broadcast": true` may declare up to **64** links. T-PLUNGER's `out` ("wired to any number of explosives") is the only v1 user.
- `validate:parts` rejects values outside these limits. Gear meshes and Impact contacts aren't links, so they have no limit.

---

## 4. Behaviours

### 4.1 The API

> **As built:** the `Behaviour` component API below was the plan and wasn't built. Behaviour code lives in **channel systems** (`packages/sim/src/channels/`, `PartChannels` in `channels/index.ts`, plus the critter system), each a set of stage functions called by `Machine.step()` in the SIMULATION §2 order, iterating parts of the types it owns in part order. A part def's `behaviours` list is descriptive (nothing dispatches on it). What the rules in §4.2 asked for still holds, by other means:
> - **State** is plain, JSON-safe data on `Machine.st` (per-part arrays, plus `st.m2` / `st.m2.m4` / `st.m2.m5` and `st.crit` for later milestones), so a checkpoint is `structuredClone(st)` plus Jolt's state (DATA_FORMATS §6). There are no `save` / `load` methods.
> - **Hash:** each system contributes to `Machine.hash()` (`x.hash`, `critters.hash`, `matter.hash`).
> - **Rollback:** what Jolt's saved state doesn't record (object layers, gravity factors, motion types, constraint enables) is re-derived in each system's `afterRestore` from plain state (M5 rule 14).
> - **Determinism:** detmath only, part-order iteration, the lint (SIMULATION §10).
> - **Visual state** goes out as per-part arrays (§5).
>
> Adding a part means a def, a branch in the channel system for its stage(s), a card, a demo (also its golden) and a fuzz entry.

*Original design:*

```ts
// packages/sim/behaviours/types.ts
export interface Behaviour<S, P = unknown> {
  id: string;                                     // 'explosive', 'flammable', 'rotator_source', ...
  version: number;                                // bump on any outcome-changing change → simVersion
  create(ctx: SimCtx, part: PartInstance, params: P): S;   // allocate state (plain data only)
  preStep?(ctx: SimCtx, s: S): void;              // stage 6
  onContact?(ctx: SimCtx, s: S, c: ContactInfo): void;     // stage 9 (sorted)
  onSignal?(ctx: SimCtx, s: S, port: string, pulse: Pulse): void;  // stage 2
  onPower?(ctx: SimCtx, s: S, factor: number): void;       // stage 3
  onLight?(ctx: SimCtx, s: S, intensity: number, focus?: FocusHit): void; // stage 4
  onHeat?(ctx: SimCtx, s: S, exposure: number): void;     // stage 5
  onTimer?(ctx: SimCtx, s: S, timerId: number): void;     // stage 1
  onBreak?(ctx: SimCtx, s: S): void;              // stage 12
  postStep?(ctx: SimCtx, s: S): void;             // after stage 12
  visual(s: S, out: VisualState): void;           // pivots, LEDs, screens, clip hints (renderer only)
  save(s: S, w: StateWriter): void;               // checkpoint
  load(r: StateReader): S;
  hash(s: S, h: Hasher): void;                    // state hash contribution
}
```

`SimCtx` gives behaviours exactly these capabilities:
- `ctx.tick`, `ctx.dt`, `ctx.env` (gravity, air);
- `ctx.math` (detmath) and `ctx.rng(stream)`;
- `ctx.body(partId)` (Jolt helpers: add impulse/force, set motor target, enable/disable);
- `ctx.emit(event)` and `ctx.schedule(ticks, timerId)`;
- `ctx.signal(port, pulse)`;
- `ctx.spawn(type, transform, props, velocity)` and `ctx.despawn(partId)`;
- `ctx.detonate()` (uses the part's `explosive.yield`), `ctx.ignite(partId)`, `ctx.cut(linkId)`;
- `ctx.query` (raycast, overlap: sorted results only).

### 4.2 Rules
1. State `S` is plain data (numbers, typed arrays, fixed-size records). No closures, no class instances with hidden state, no references to Jolt objects (use ids).
2. Deterministic only (SIMULATION §10): `ctx.math`, `ctx.rng`, sorted queries.
3. No allocation in `preStep`, `onContact` or `postStep` (pre-size in `create`).
4. Behaviours never read another part's state directly. They communicate through channels, events and signals.
5. Every outcome-affecting change bumps `version`. CI recomputes the behaviour hash and requires a `simVersion` bump plus golden updates.

### 4.3 Behaviour library (reusable components)

| Behaviour | Used by | Params |
|---|---|---|
| `rigid_basic` | Rollers, Plank, Ledge, Topple Tiles | — |
| `breakable` | Brik (mortar joints), Plank, Pane, Vase, Fishbowl, Yolk, crates | from `breakable` |
| `flammable` | Fuse, Line, Bungee, Plank, paper items, Helio, Powder Keg (cook-off) | from `flammable` |
| `explosive` | Bangstick, Powder Keg, Jitterjuice, Skyshow shells | from `explosive`, fuse prop |
| `fuse_line` | Fuse links | burn speed, branches |
| `hinge_passive` / `hinge_triggered` | Fulcrum, Flap, Bonker, Paddle, Snaptrap, Flinger | limits, spring, trigger torque |
| `rotator_source` | Motor, Hamster Drive (via critter), Pedal Rig | target ω, max torque, power input |
| `rotator_driven` | Cog, Turbine, Waterwheel, Spindeck, Treadway | — |
| `slider_actuator` | Ram, Lift, Pinger, Punchline | stroke, speed, spring |
| `sensor_pulse` | Stomp Pad, The Button, Toggle, Tripwire, T-Plunger | threshold, mode |
| `timer` | Ringer, Delay, Hourglass (time-driven; its sand is a fill-pass display, no Matter grains) | seconds |
| `power_source` / `power_consumer` | Mains, Cell, Dynamo (shaft braking, SIMULATION §5.5), Suncell / Motor, Lamp, Gale, Grabber... | watts |
| `power_switch` | Toggle (joins its power `in` and `out` components while on) | — |
| `light_emitter` / `light_optic` / `light_receiver` | Torch, Lance, Lamp / Mirror, Splitter, Burning Glass / Suncell, Tripwire | cone, rays, focal length |
| `air_emitter` | Gale, Puffer, Blowout, Vac, Popper | volume, strength |
| `field_emitter` | Maglock, Grav Well, Tractor Beam, Hover Pad, Stasis, Coilgun, Zones | per kind |
| `launcher` | Big Top, Flinger, Toast Cannon, Cork Blaster, Skyrocket (thrust) | speed, angle |
| `cutter` | Snipper | jaw sensor |
| `rack_pinion` | Rack (bar on a `RackAndPinionConstraint`, end stops) | length, pinion teeth |
| `ik_playback` | Grabber (kinematic links play a pick-A / place-B path; speed × supply factor) | zones A and B, grip width |
| `inflator` | Inflator (valve pulse → Helio fill, over-pressure pop; SIMULATION §5.8) | valve time, fill rate |
| `arc_emitter` | Arc Tower (charge, nearest-metal strikes as heat points; SIMULATION §5.7) | range, strike interval |
| `wireless_pair` | Ping (Tx/Rx pair acts as a wire, SIMULATION §5.2) | pair id, mode |
| `container` | Scoop, Tank, Sponge, Fishbowl, and the intakes of the Matter emitters | capacity, intake sensor |
| `matter_emitter` | Grit Hopper, Tank valve, Marble Hopper, Goo Vat, Sprinkle Can, Sponge (squeeze), Fishbowl (break burst) | rate, material |
| `spawner` / `sink` | Fabricator / Recycler, Singularity core | part type, count |
| `teleporter` | Rift Gates | pair id |
| `vehicle` | Zippy | speed |
| `critter_<species>` | Critters | species tuning |
| `music_note` | Tonebars, Ding | pitch |

A part's `behaviours` list composes these. Example: Bangstick = `rigid_basic` + `flammable(fuse)` + `explosive`.

*As built:* the defs also use `heat_source` (Wick, Arc Tower), `critter_device` (devices a critter drives or is caught by: Hamster Drive, Pedal Rig, Trap Box, Fishbowl), `hinged` (Sprinkle Can tilt), `sprong`, `conveyor` (Treadway), `helio`, `buoyant` (QUACK) and, in M5, `beacon` (BUZZ BEACON) and `teleporter` (RIFT GATES); critter defs use `critter` specs instead of `critter_<species>` ids. These ids label the parts (the Library, tests and tooling read them); the code that implements them is in the channel systems (§4.1).

---

## 5. Visual state contract (sim → renderer)
Each tick, for each awake part with visual behaviours:
- **Pivots:** up to 8 local transforms (matching `PIVOT__` order in `.art.json`).
- **Morph weights:** up to 4 shape-key weights (0–1), e.g. Big Top `sk_iris`, Helio inflate, Sprong `sk_depress`.
- **LEDs:** 16 groups × 4-bit state (off, idle, connected, active, flowing, fault). Port-ring LEDs are not part of these groups: the engine derives one 4-bit state per port from channel activity (RENDERING §6.1).
- **Screens:** up to 4 values (number, bar fraction, icon id).
- **Material swaps:** `burnt`, `wet`, `charged`, `cracked` (bit flags; the renderer picks the variant parameters).
- **Clip hint** (critters, complex mechanisms): clip id + normalized phase + blend weight. Visual only, not part of the hash.
- **Visibility:** a part stays visible while it's carried or held. A carried item is drawn where its carrier holds it: Bandit's loot at his animated `prop_r` bone (`gfx/critters.ts`), and BUZZ's load hanging under its claw on the winch tether (M5). Bodies inside a powered STASIS FIELD stay visible with the brief's "time-stopped" look (desaturated, cool tint, dashed rim; `gfx/future/`, M5). *(v1.0 said "hidden while carried by Buzz or in stasis", which contradicted the briefs.)* Only parts that leave play are hidden: dormant pool pieces before they spawn, despawned parts, broken parts replaced by chunks.

*As built:* the sim worker sends these per part, in part order, in each `frame` message and keyframes them in the BakeStore when they change (ARCHITECTURE §5, DATA_FORMATS §6.1): `flags` (`PartFlagBits`: lit, powered, pressed, dead, armed, broken, fault, and `tagged` 128 from M5; plus a level in spare bits for screens, D69), `meters` (screen readouts, `Machine.partMeters`), link state, critter state (4 bytes: clip, flags, emote, FSM state; or timer, flags and phase for critter-bound devices), carry pairs, light beams, container fill and, in M5, BUZZ's targets (`critterTargets()`) and GRABBER joint poses (`grabberJoints()`). Arms and moving sub-parts are their own bodies, so their transforms carry pivots. The client derives LEDs, morph weights (`gfx/partmorph.ts`) and port-ring states from these. There's no `xformRing`.

---

## 6. Cards and demos
- **Card text** comes from `card.needs` and `card.does` (i18n), plus up to 2 tips.
- **Demo:** `<type>.demo.knockon` is a tiny machine (≤ 30 parts, ≤ 3 s) showing the part's main interaction. `tools/bake` renders it to a looping 512² WebM for the Library hover and to the 3 s card clip.
- *As built:* card text is in `packages/parts-data/src/cards.ts` (plain English, no i18n keys yet). Demos are `DEMOS` in `demos.ts` (≤ 30 parts, ≤ 360 ticks), used as the per-part goldens and in the channel and critter tests. `tools/bake` and the WebM clips aren't built: the Library card shows the part's Blender thumbnail and its card text.

---

## 7. Adding a new part: checklist
1. **Brief** written and approved ([art/briefs/](art/briefs/README.md)), including ports, pivots, sensors and emitters.
2. **Blockout** `.blend` with COL, PORT, PIVOT, SENSOR and EMIT, exported → greybox art in engine.
3. **Definition** `<type>.part.json` (schema-valid, ports match).
4. **Behaviours:** compose existing ones; write a new one only if necessary (with unit tests).
5. **Golden machine** `goldens/<type>.knockon`, exercising every port and state, added to the determinism suite.
6. **Card demo** + i18n strings (name, tag, needs, does, tips).
7. **Audio and FX mapping** entries + asset requests (AUDIO.md, vfx brief).
8. Run `pnpm validate:parts`, `pnpm test:sim`, `pnpm test:golden`.
9. Final art lands later and swaps in **without code changes**.

*As built (M2–M4 streams' checklist):* a def in `defs_m<N>.ts` (exported through `parts-data/src/index.ts` and the game's `catalog.ts`), its channel-system code, a card in `cards.ts`, a demo in `demos.ts` (= its per-part golden, `packages/sim/test/goldens_m<N>.test.ts`), a fuzz entry (`fuzz_scenes_m<N>.ts`), new `EventKind`s appended and listed in the stream notes for audio, effects and captions, art via `tools/blender/make_<type>.py` and `pnpm assets`, and HOW_TO_PLAY updated (M5 rule 15). Run `pnpm test`, `pnpm lint` and `pnpm typecheck`.

---

## 8. Testing parts
- **Unit:** headless sim harness (`packages/sim/test/harness.ts`) builds a world from a snippet, steps N ticks, and asserts events and state.
- **Property fuzz:** for every part, 200 random property sets within range × 3 seeds: no NaN, no explosion of energy (kinetic energy bounded), no stuck states.
- **Golden:** hash match over 10,000 ticks (SIMULATION §10.3).
- **Multiplayer op tests:** every property and link op round-trips through `format`, applies, and inverts cleanly.

---

## 9. Full example

The schema example (as built, BANGSTICK is a `PartDef` in `defs.ts` with the same numbers; its behaviour is in the boom code, not an `explosive.ts` component):

```jsonc
// packages/parts-data/parts/bangstick.part.json
{
  "type": "bangstick", "family": "boom", "name": "part.bangstick.name", "tag": "part.bangstick.tag",
  "class": "M", "ship": "M1",
  "size": [3, 1, 1], "mirror": ["x"],                          // 0.30 × 0.10 × 0.10 m bundle of three Ø 0.05 × 0.28 m sticks; origin = centre of mass, 0.039 m above the floor
  "body": { "kind": "dynamic", "mass": 0.8, "material": "paper",
            "overrides": { "restitution": 0.2, "friction": 0.6 } }, // shapes come from bangstick.shapes.json (DATA_FORMATS §8.2)
  "ports": [                                                     // maxLinks defaults to 1 (§3)
    { "name": "fuse",      "channel": "heat",   "dir": "in" },  // PR-S on the top stick's +X end disc, engine (0.14, 0.029, 0)
    { "name": "detonator", "channel": "signal", "dir": "in" }   // PR-S at the −X end, on the centroid, engine (−0.14, 0, 0)
  ],
  "behaviours": [
    { "id": "rigid_basic" },
    { "id": "flammable", "params": { "region": "fuse_tip" } },
    { "id": "explosive" }
  ],
  "props": { "fuse": { "type": "seconds", "min": 0.5, "max": 5, "step": 0.1, "default": 2.0 } },
  "flammable": { "igniteTime": 0.05, "burnTime": 0, "onBurnt": "none" },
  "explosive": { "yield": 1.0, "sympathetic": true, "fuseProp": "fuse", "macroChunks": 4 },
  "fx":    { "ignite": "fx/fuse_spark", "detonate": "fx/boom_small" },
  "audio": { "ignite": "sfx/fuse_light", "burn": "sfx/fuse_hiss", "signal": "sfx/detonator_click",
             "detonate": "sfx/boom_small", "impact": "sfx/knock_paper", "debris": "sfx/debris_patter" },
  "card":  { "needs": "part.bangstick.needs", "does": "part.bangstick.does", "tips": ["part.bangstick.tip1"] }
}
```
It detonates on stub burn-out, a detonator Signal or a sympathetic blast (art/briefs/boom.md), so it has no `breakable` block. Its 4 macro chunks (torn tape bands and charred tube halves) spawn on detonation.

```ts
// packages/sim/behaviours/explosive.ts (excerpt)
export const explosive: Behaviour<ExplosiveState, ExplosiveParams> = {
  id: 'explosive', version: 1,
  create: (ctx, part) => ({ armedAtTick: -1, fuseTicks: ctx.secondsToTicks(part.prop('fuse')), done: false }),
  onHeat: (ctx, s) => { if (s.armedAtTick < 0 && !s.done) { s.armedAtTick = ctx.tick; ctx.emit({ kind: 'FuseBurn' }); } },
  onSignal: (ctx, s, port) => { if (port === 'detonator' && !s.done) { s.done = true; ctx.detonate(); } },
  preStep: (ctx, s) => {
    if (!s.done && s.armedAtTick >= 0 && ctx.tick - s.armedAtTick >= s.fuseTicks) { s.done = true; ctx.detonate(); }
  },
  visual: (s, out) => { out.led(0, s.armedAtTick >= 0 ? 'active' : 'idle'); },
  save: (s, w) => { w.i32(s.armedAtTick); w.i32(s.fuseTicks); w.bool(s.done); },
  load: (r) => ({ armedAtTick: r.i32(), fuseTicks: r.i32(), done: r.bool() }),
  hash: (s, h) => { h.i32(s.armedAtTick); h.bool(s.done); },
};
```
