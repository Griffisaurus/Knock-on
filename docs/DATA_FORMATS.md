# KNOCK-ON Data Formats

Status: v1.2 · 2026-10-25 (as built through M5) · Owner: Tech Lead · Code: `packages/format`
Related: [ARCHITECTURE.md §4](ARCHITECTURE.md) · [MULTIPLAYER.md §10–11](MULTIPLAYER.md) · [PART_SYSTEM.md](PART_SYSTEM.md) · [art/ASSET_PIPELINE.md §8](art/ASSET_PIPELINE.md)

All binary formats are **little-endian**. All formats carry a version and are validated before use (counts, ranges, string lengths, unknown enums are rejected). **Never partially load.**

> **v1.1:** this version describes what `packages/format/src/` writes and reads (`container.ts`, `world.ts`, `ops.ts`, `link.ts`, `module.ts`, `terrain.ts`, `checkpoint.ts`, `matter.ts`). Planned fields that nothing writes yet are marked **not built**.

---

## 1. Quantization

| Quantity | Encoding | Resolution |
|---|---|---|
| Position | i32 per axis, units of 1/64 cell | 1.5625 mm; range ±3,355 km |
| Rotation | tagged: `0` identity · `1` snapped Euler (yaw, pitch, roll as i16 in 0.5° units) · `2` free smallest-three: a u8 largest-component index + 3 × i16 components (7 bytes; `quantize.ts`) | Snapped rotations are exact (so gears and tubes mesh perfectly); free ≈ 0.003° |
| Size (resizable) | u16 per axis, units of 1/4 cell | 2.5 cm |
| Spline control points | i32 × 3 (as position); stored as MessagePack arrays inside the `LINK` section (§2.4) | 1.5625 mm |
| Property values | zigzag varint of `step` counts (PART_SYSTEM §2) | per property |
| Seconds in logs | ticks (varint) | 1/tickRate (1/120 s by default, 1/60 s option) |

---

## 2. `.knockon` world container

Used for saves, exports, run snapshots, share links (§7), and the Host Server's `world.knockon`.

```
offset  size  field
0       4     magic "KNON"
4       2     formatVersion (= 1)
6       2     containerFlags (bit0: canonical run snapshot)
8       4     headerLength H
12      H     header (MessagePack map, §2.1)
12+H    2     sectionCount N
...     N×20  section table: tag[4] · offset u32 · length u32 · rawLength u32 · codec u8 · reserved[3] · crc32 is inside each section's trailer
...           sections (each: payload + u32 crc32 of the uncompressed payload)
```
Codecs: `0` none · `1` zstd (reserved: nothing writes it) · `2` deflate (`fflate`, level 6). **As built, every writer uses deflate** (`encodeContainer`, `container.ts`). Magics: `KNON` (worlds), `KNMD` (modules, §4), `KNCP` (checkpoints, §6). At most 64 sections; the header is at most 1 MB.

### 2.1 Header (MessagePack)
As written by `encodeWorld` (`world.ts`):
```jsonc
{
  "simVersion": "0.0.0-dev",
  "tickRate": 120,
  "env": { "preset": "room", "environment": "tinker", "gravity": 100, "air": 100, "feel": "real",
           "sinkFill": false,      // M4 (D98): Mega Kitchen "Fill the sink"; optional
           "zones": true,          // M5: Orbital Hangar zero-g zones on/off (a boolean: all zones together); absent = on
           "wind": { "speed": 6, "dir": 0, "gusts": "gusty" },   // M5 (D26): global wind; absent = none (see below)
           "baseLights": false,    // M5: Moon Base "Base lights" (cosmetic, not a run input); absent = off
           "matter": true },       // M5: per-world override of simFlags.matterGameplay; absent = the header's flag
  "seed": [2654435769, 2135587861], // two u32 words
  "counts": { "parts": 412, "links": 37, "grains": 0 },   // grains: the most the world can ever have alive (sim matter/budget.ts)
  "simFlags": { "matterGameplay": true, "lanes": false }, // M4: absent in a file = made before M4 = Matter off
  "requiredTier": 4,               // smallest GB tier holding counts.parts and counts.grains (TIER_CAPS); ≥ 16 with the sink filled (D98); 0 if none
  "title": "Cat-o-Matic 3000",
  "worldHash": "3f9c2e1a…"         // xxh64 (hex) of the PART + LINK (+ TERR) payloads, in every file
}
```
- **`env`** is `EnvSettings` (`model.ts`). A header without `environment` predates M3 and loads as the Studio (`LEGACY_ENVIRONMENT`).
- **`env.wind`** (`EnvWind`, M5, D26): `speed` 0–15 m/s in 0.1 steps; `dir` 0–359°, the horizontal direction it blows **toward** (0 = +X, 90 = −Z); `gusts` `none | breezy | gusty | overcast` (seeded from the world seed, `windSpeedAt`). The Backlot presets are `WIND_PRESETS` (Calm 0, Breezy 3, Gusty 6, Overcast 2 m/s). A run input, hashed only when there is wind; rigid bodies only (SIMULATION §5.8, D110).
- **`env.zones`** is a run input (hashed only in worlds whose environment has zones); `env.baseLights` is cosmetic (the renderer only). `env.gravity` takes 0.5 % steps (the Moon is 16.5 %). Switching environment through `envSwitchPatch` brings the new environment's gravity and air (Hangar 38 / 100, Moon 16.5 / 0) when the world still had the old one's defaults.
- **Not built:** `bounds`, `authors`, `created`, `modified`. Header `seed` is an array, not 8 raw bytes.

### 2.2 Sections

| Tag | Written | Contents |
|---|---|---|
| `TYPE` | always | MessagePack string table of part type ids used, in first-use order (local index → type). Decouples files from registry order. |
| `PART` | always | Columnar part table, sorted by id ascending (§2.3) |
| `LINK` | always | MessagePack array of links in `LinkAdd` wire form, sorted by id (§2.4) |
| `NOTE` | always | MessagePack array of notes in `NoteAdd` wire form `{id, pos, text, color}` |
| `CNTR` | always | Per-slot id counters `{slot: counter}`, keys sorted (MULTIPLAYER §5.3) |
| `GRUP` | saves with groups or layers | `{groups: [[id, name, parent, memberIds[], 0]], layers: [[id, name, flags]]}` (MessagePack) |
| `MODL` | saves with stored modules | `[[moduleId, name, .knockmod bytes]]`, referenced by `ModulePlace` |
| `TERR` | Backlot worlds with sculpted terrain (S3) | `terrain.ts`: version u8 · preset · origin (2 × i32, 1/64 cell) · nx, nz · maxHeight (mm) · u16 heights as per-row deltas. Absent = the preset's default lot (generated identically everywhere). Moon Base's authored heightfield isn't saved either: it's fixed environment data, `moonTerrain(preset)` in the generated `packages/parts-data/src/env_moon.ts` (E5c), decoded identically on every machine (M5). |

**Not built:** `INPT` (input logs are kept by the Host Server's run state, not in the file), `META` and `THMB`.

### 2.3 `PART` records (`encodeParts`, `world.ts`; one record per part, then the section is deflated)
A varint part count (≤ 2,000,000), then per part, in id order:
1. `id`: varint delta from the previous id (ids ascending).
2. `typeIdx`: varint local index into `TYPE`.
3. `pos.x`, `pos.y`, `pos.z`: zigzag varint delta from the previous part (brush strokes create runs of nearby parts, so this compresses well).
4. `rot`: tag byte + payload (§1).
5. `flags`: u16. Bits 0–2 mirror x/y/z, bit 3 locked, bit 4 hidden, bit 5 anchored (`PartFlag`, `model.ts`); bits 6–8 are the record's own hasSize / hasProps / hasSkin; **bit 9 `Tagged`** (BUZZ fetches tagged objects; M5, D105). Other bits are dropped on write and read.
6. `size`: present if hasSize: 3 × varint.
7. `layer`, `group`: varints (0 = none).
8. `skin`: varint (if hasSkin).
9. `props`: if hasProps, varint count (≤ 64) + `(propIndex varint, value zigzag varint)` pairs.

### 2.4 `LINK` records
Each link is its `LinkAdd` wire form (`ops.ts` `linkToWire`): `[id, kind, from: [partId, portIdx] | null, to: [partId, portIdx] | null, via: [partId…] (sheaves / anchors), points: [[x, y, z]…] (1/64 cell), length (1/64 cell units), props | null]`. Kinds (`LinkKinds`, `model.ts`, append-only): `line`, `chain`, `bungee`, `band`, `band_crossed`, `fuse`, `tube`, `tube_slim`, `gutter`, `gutter_slim`, `glidepath`, `cable_power`, `cable_signal`, `ping`, and `fill` (M4: INFLATOR → HELIO knot, PART_SYSTEM §3).

### 2.5 Canonical run snapshot
`containerFlags.bit0 = 1` (`encodeWorld(…, {canonical: true})`). Sections: `TYPE`, `PART`, `LINK`, `NOTE`, `CNTR` and `TERR` when present; `GRUP` and `MODL` are left out. Same encoder, deterministic output: a given doc state yields identical bytes. `worldHash` = xxh64 over the uncompressed `PART` and `LINK` payloads, plus `TERR` when present (`worldHash()`), and it's written in every file's header. *As built:* runs start from `DocStore.confirmed()` passed to the sim worker as records (D72), not from snapshot bytes, and the run hashes (not `worldHash`) detect a mismatch (MULTIPLAYER §7.3).

---

## 3. Ops (wire and journal)

MessagePack arrays with short keys. One schema per op type, shared by client and server (`packages/format/src/ops.ts`, codes append-only):

| Op | Encoding |
|---|---|
| `PartAdd` | `[1, id, typeStr, pos[3], rot, flags, size?, props?, layer?, group?, skin?]` |
| `PartUpdate` | `[2, id, patchMask, ...fields per mask bit]` (mask bits: pos 1, rot 2, flags 4, size 8, props 16, layer 32, group 64, skin 128) |
| `PartRemove` | `[3, ids[]]` |
| `LinkAdd` / `LinkUpdate` / `LinkRemove` | `[4, link]` / `[5, id, patch]` / `[6, ids[]]` |
| `GroupSet` | `[7, groupId, name \| null, parent, memberIds[] \| null]` |
| `ModuleSave` / `ModulePlace` | `[8, moduleId, name, blob \| null]` / `[9, moduleId, [x, y, z, quarterTurns], idBase, count, layer]` |
| `EnvUpdate` | `[10, patch]` (any `EnvSettings` fields; `sinkFill` M4; `zones`, `wind`, `baseLights` and `matter` M5; null clears an optional field) |
| `TerrainStroke` | `[11, brush, radius, strength, points[]]` |
| `NoteAdd` / `NoteUpdate` / `NoteRemove` | `[12, id, pos, text, color]` / `[13, id, {text, pos, color}]` / `[14, ids]` |
| `Batch` | `[15, ops[]]` (≤ 100,000) |
| `LayerSet` | `[16, layerId, name \| null, flags]` (M2) |
| `TerrainPatch` | `[17, …]`: restores a rectangle of terrain samples (a stroke's inverse; S3) |

**Journal** (`journal.oplog`, append-only, `apps/host/src/storage.ts`): records `varint len · body · u32 crc32(body)`, where body = MessagePack `[seq, slot, unixTime, opWire]`. Replayed on server start after loading `world.knockon`; reading stops at the first torn or corrupt record (MULTIPLAYER §11).

---

## 4. Modules (`.knockmod`)
The same container with magic `KNMD` (`module.ts`, ≤ 1 MB, ≤ 20,000 items). Header `{name, counts: {parts, links, ports}}`. Sections: `TYPE`, `PART` (positions relative to the module origin, ids are local 1..n), `LINK` (internal), `PORT` (exposed external ports: `[localPartId, port, label]`), `META` (name, author, description, tags). No `THMB`. On placement, local ids are remapped into the placing player's id namespace in local id order (deterministic); mirror, anchored and (M5) tagged flags are kept.

---

## 5. Input logs and pokes
```ts
type Poke = { seq: number; tick: number; partId: number; kind: 'impulse' | 'drag' | 'release'; data: number[] /* quantized */ };
```
Impulses are quantized to 1e-3 N·s, drag targets to positions (§1). *As built:* `Poke` is `packages/sim/src/machine.ts`; a run's pokes travel in the run state (`RunState.pokes`, `@knockon/net`) and live in the Host Server's session while the run lasts. They aren't written to `INPT` or to `runs/<runId>.inputs` (not built).

---

## 6. Checkpoints and bake keyframes
As built (M4, `packages/format/src/checkpoint.ts`): the same container as §2 with magic `KNCP`, deflated like every container.
```
magic "KNCP" · formatVersion u16 · flags u16 · header (msgpack: tick, plus meta: simVersion, runId, worldHash, tier, flags when given)
sections (deflate each):
  JOLT  Jolt StateRecorder bytes (EStateRecorderState::All)
  "ECS " the Machine's plain run state, UTF-8 JSON: behaviour, channel, RNG, event-cause, critter and Matter-host state
  MATR  only on checkpoints that carry a Matter snapshot (Matter on):
        u16 version · u32 rigid tick
        snapshot: u32 length · the backend's snapshot bytes (MX's MTR1 layout: 28 B per grain before deflate)
        results:  u16 count · per result: u32 length (i32 words) · i32[]   (the two Matter results computed but not yet applied)
        proxies:  u16 count · per snapshot: i32 rigid tick · u32 proxies · u32 length · i32[]   (the proxy ring)
```
v1.0's separate `CHAN`, `RNG` and `CAUS` sections and LZ4 weren't built: all plain state is the one JSON `ECS ` section (the tag has a trailing space).

Used for rewind, poke rollback, device-loss recovery and multiplayer desync repair (MULTIPLAYER §7.4). Rigid checkpoints are taken at the start state and every 60 ticks (0.5 s at 120 Hz; worlds over 20k parts checkpoint every 2 s and keep fewer, `checkpointPlan` in `packages/parts-data/src/presets.ts`). With Matter on, every 240 ticks (2 s) a checkpoint carries a Matter record, and only those are restorable while Matter runs (SIMULATION §11). In the browser, Matter snapshots stay with the main thread's Matter host and are referenced by id; `exportCheckpoint` pulls the bytes for desync repair. **Measured:** the 1M-water Kitchen sink world's checkpoint is 7.7 MB (about 7.7 B per settled water particle); the wire cap is 64 MB (MULTIPLAYER §7.4).

### 6.1 Bake-ahead keyframes (runtime only, never saved)
*As built (`apps/game/src/bakestore.ts`):* the bake-ahead store lives in the **sim worker's memory**, not VRAM, and is never serialised.
- **Rate:** a keyframe every 4 ticks (30 Hz at 120 Hz). Playback interpolates between keyframes.
- **Base + deltas:** a base frame holds every body; each keyframe holds only the bodies that moved since the last one (`Machine.changedTransforms`), as an index list plus **20 B per body**: position f32 × 3 + rotation snorm16 × 4. Periodic full frames make scrubbing back cheap.
- **Per-part state arrays** (flags, meters, link state, critter state and carry, light beams, container fill `mf`, Matter counts `mc`; M5: BUZZ's targets `g` and GRABBER joints `gj`) are stored only when they change.
- **Events** are stored by tick.
- **Budget:** 3 minutes of scrubbable history; over budget the oldest keyframes fold into the base.
- The worker posts the playhead's interpolated frame to the main thread (7 floats per body) in each `frame` message (ARCHITECTURE §5). There is no `xformRing` or `keyframeStaging`.

---

## 7. Share links
`https://<host>/#m=1<base64url(deflate-raw(canonical .knockon without INPT))>`. The `1` is the link-format version. Optional suffixes: `&t=<seconds>`, `&cam=<mode>`. The Share button offers a link for machines up to ~12 KB compressed (GAME_SPEC §17.2). Larger machines use export or the Host Server. The decoder refuses any link over 64 KB of payload.

*As built (`packages/format/src/link.ts`, M3):* inline links up to `INLINE_LINK_MAX` = 12 KB; anything bigger is stored on the Host Server and shared as **`#s=<16 hex>`** (`apps/host/src/share.ts`), which the partner opens on the same host or another host fetches by URL. Modules share the same way. Opening a link imports the world into the host's list (`apps/game/src/share.ts`).

---

## 8. Asset formats

All positions are **engine Y-up metres relative to the part origin**. The exporter maps the brief's Blender coordinates (x, y, z) to engine (x, z, −y), so Blender's front (−Y) becomes engine +Z. The BANGSTICK example below matches art/briefs/boom.md and PART_SYSTEM §9: a 0.30 × 0.10 × 0.10 m bundle (3×1×1 cells) of three Ø 0.05 × 0.28 m sticks, mass 0.8 kg, origin at the centre of mass (the bundle centroid) 0.039 m above the floor. Brief Blender positions convert as fuse port (0.14, 0, 0.029) → (0.14, 0.029, 0) and detonator port (−0.14, 0, 0) → (−0.14, 0, 0).

### 8.1 `.art.json` (from the Blender exporter)
```jsonc
{
  "type": "bangstick", "version": 4, "class": "M", "footprint": [3, 1, 1],
  "bounds": { "min": [-0.143, -0.039, -0.05], "max": [0.16, 0.061, 0.05] },    // detonator collar … stub loop; floor at y −0.039, stub top at y 0.061
  "ports": [
    { "name": "fuse", "channel": "heat", "dir": "in", "size": "S",
      "pos": [0.14, 0.029, 0.0], "dirVec": [1, 0, 0] },                      // top stick's +X end disc
    { "name": "detonator", "channel": "signal", "dir": "in", "size": "S",
      "pos": [-0.14, 0.0, 0.0], "dirVec": [-1, 0, 0] }                       // −X end, on the centroid
  ],
  "sensors":  [],
  "emitters": [
    { "name": "fuse_tip", "fx": "spark", "pos": [0.125, 0.058, -0.015], "dirVec": [0, 1, 0] },  // stub tip → fx/fuse_spark
    { "name": "fuse_tip", "fx": "smoke", "pos": [0.125, 0.058, -0.015], "dirVec": [0, 1, 0] },
    { "name": "core",     "fx": "boom",  "pos": [0, 0, 0],              "dirVec": [0, 1, 0] }   // → fx/boom_small
  ],
  "pivots":   [],
  "screens":  [],
  "ledGroups": [ { "index": 0, "name": "ember" } ],                           // 8 mm sleeve riding the stub's burn front
  "lods": [ { "tris": 5400 }, { "tris": 2700 }, { "tris": 1350 }, { "tris": 430 } ],   // LOD0 ≤ 5,500
  "clips": [],
  "skins": ["classic", "candy"],
  "massHint": 0.8,
  "materials": ["kn_paper_red", "kn_paper_tan", "kn_powder_graphite", "kn_powder_bone", "kn_fuse_cord", "kn_decal", "kn_led"]
}
```

### 8.2 `.shapes.json`
Jolt capsules run along their local Y, so each is rotated 90° about Z to lie along X. Each stick is 0.28 m long overall: half-height 0.115 + radius 0.025 at each end. Centres are the brief's (y, z) = (−0.025, −0.014), (0.025, −0.014), (0, 0.029) converted to engine axes.
```jsonc
{ "type": "bangstick", "shapes": [
  { "name": "stick_1", "kind": "capsule", "pos": [0, -0.014,  0.025], "rot": [0, 0, 0.7071, 0.7071], "halfHeight": 0.115, "radius": 0.025, "phys": "paper" },
  { "name": "stick_2", "kind": "capsule", "pos": [0, -0.014, -0.025], "rot": [0, 0, 0.7071, 0.7071], "halfHeight": 0.115, "radius": 0.025, "phys": "paper" },
  { "name": "stick_3", "kind": "capsule", "pos": [0,  0.029,  0],     "rot": [0, 0, 0.7071, 0.7071], "halfHeight": 0.115, "radius": 0.025, "phys": "paper" }
] }
```
Shape kinds: `sphere`, `box` (+ `convexRadius`), `capsule`, `cylinder`, `hull` (+ `points[]`), `mesh` (+ `vertices[]`, `indices[]`, static only), `wheel`. Optional per-shape fields: `restitution`, `friction` (overrides) and `sharp: true` (contacts pop Helios, SIMULATION §5.1), from the COL custom properties (ASSET_PIPELINE §3.4).

*As built:* the sim builds bodies from the part defs' `shapes(props)` (`packages/parts-data/src/defs*.ts`), which mirror these files. A def may also give **`body.com`** (M5, [D111](dev/DECISIONS_2026-10-24.md)): an offset (part space, m) that moves the base body's centre of mass from the shapes' uniform-density centre, built on Jolt's `OffsetCenterOfMassShape` (`comShape`, `machine.ts`). Only QUACK uses it (10 mm down, a keel, so it rights itself).

### 8.3 Environment data (`<id>.env.json`, `env_<id>.ts`)
Each environment set is built by its Blender script into `assets/build/env/<id>/` (`<id>.glb`, or one glb per preset for the Hangar: `hangar_<preset>.glb`; the IBL `.hdr` + `.json`; the LUT strip) plus a generated TypeScript table in `packages/parts-data/src/env_<id>.ts` (`env_tinker.ts`, `env_kitchen.ts`, `env_backlot.ts`, and in M5 `env_hangar.ts`, `env_moon.ts`). The table is what the sim reads (per-preset colliders: `boxes`, `spheres`, M5 convex `hulls`; the Hangar's zero-g `zones`; the Moon's authored `terrain`, base64 zigzag-varint rows checked by FNV-1a and decoded by `moonTerrain(preset)`), and the renderer reads cameras, practicals, light rig, IBL and LUT names from it or from `<id>.env.json`. Physics materials on set colliders include `concrete` and `regolith` (M5). M5 additions to `<id>.env.json`:
- **`textures`** (E5c): the environment's own texture set, bound like a part's: `{albedo, normal, orm, size}` file names under `/env/<id>/` (the baked backdrop Earth: `earth_hangar.*` 2048², `earth_moon.*` 1024²), read by `gfx/environment.ts` (`texSetsOf`).
- **`lightGroups.baseLights`** (Moon): the practicals and lens meshes the `env.baseLights` toggle switches.
- **`earth`** (in the generated table): centre, radius, spin axis and `degPerMinute` 0 (the lighting is baked; D112).

### 8.4 Asset manifest (`manifest.<hash>.json`)
**Not built.** Assets are served by path from `assets/build/` (`/parts/<type>/<type>.glb`, `.art.json`, `.shapes.json`, `.frac.glb`, `.tex.<map>.ktx2` / `.png`; `/kit/…`; `/env/<id>/…`), with no hashed manifest (ARCHITECTURE §6.5). The planned shape:
```jsonc
{
  "build": "3f9c2e1", "simVersion": "1.0.0+j5f2a91+b7c03de",
  "textureArrays": { "1024": { "layers": 412 }, "2048": { "layers": 96 }, "4096": { "layers": 12 } },
  "parts": {
    "bangstick": { "glb": "parts/bangstick.9a1c.glb", "art": "…", "shapes": "…", "frac": "…", "sdf": "…",
                   "impostor": "…", "thumb": "…", "bytes": 412331, "tierMin": 4 }
  },
  "environments": { "studio": { "chunks": "env/studio/…", "bytes": 18300000 } },
  "audio": { "banks": { "impacts": "audio/impacts.4b2d.bank" } }
}
```

---

## 9. Versioning and migration
- `formatVersion` bumps on incompatible container changes. `packages/format/migrate/` holds pure migration functions `vN → vN+1`, run on load. Saved files are rewritten in the new format only on the next save.
- Part type renames go through an alias table (`parts-data/aliases.json`). Removed types load as a "missing part" placeholder (inert, preserved on save) with a warning.
- `simVersion` changes never rewrite worlds. They only affect replay fidelity (SIMULATION §13).
- *As built:* `formatVersion` is still 1, and every change so far has been additive, so there is no `migrate/` directory or alias table yet. Additive changes are read with defaults instead: a header without `environment` is a Studio world (pre-M3), without `simFlags` runs with Matter off (pre-M4), a file without `TERR` uses the default lot; new link kinds, op codes and flag bits are appended only.
