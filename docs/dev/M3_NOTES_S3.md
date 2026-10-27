# M3 notes: S3 · scale

Stream S3 of [M3_PLAN.md](M3_PLAN.md): world presets, Backlot terrain, impostors, Bake & Watch, share links, the two
exit benchmarks and the 1M-part load target. Every number below was measured on the test system (RTX 5090, 32 GB,
"NVIDIA Blackwell" in WebGPU; Windows 11; Node 24.2; the Claude desktop browser pane, Chromium) with the method
given next to it (M3_PLAN rule 7).

## Results against the targets

### Load: a 1M-part world loads in under 20 s — **PASS** (16 GB and 32 GB tiers)

Method: `apps/game/bench/?scene=big&count=1000000&src=host&mode=run` against a local test server (`bench/host.ts`,
port 8795, its own data folder). The harness uploads the generated world to the share service, imports it as a host
world, connects as the host player and sends `join`; the clock starts at `join` and stops at the first drawn frame.
The world is `bigWorld(1e6)`: 1,000,000 BRIK / TOPPLE TILE / BOING / THUD / SLOPE / LEDGE parts jittered over the
Megastructure, a **5.8 MB** `.knockon` (in the spec's 4–8 MB range; an unjittered grid compressed to 80 KB, which
flattered every stage, so it was rebuilt).

**Pane focus matters.** The desktop browser pane runs pages at lower CPU priority when it isn't focused, and JS runs
2–3× slower there (rAF is also throttled to ~1 Hz, so the harness paces frames with a MessageChannel). Runs are
labelled "focused" or "unfocused"; the unfocused ones are the worst case.

| Stage (1M parts) | 16 GB, focused | 16 GB, unfocused | 32 GB, unfocused | Before S3 |
|---|---|---|---|---|
| `join` → doc (host opens world, sends snapshot; client decodes, builds DocStore) | 870 ms | | | + 1.1 s host re-encode per join, + rewrite on every join (both removed) |
| Scene build (`fillBuildScene`, 1M instances) | 636 ms | | | |
| Instance upload + first frame | 93 ms | | | |
| **Load to first frame** | **1.6 s** | **3.5 s** | **3.5 s** | |
| Run start: Machine build in the sim worker (1M bodies) | 7.0 s | 15.6 s | 14.3 s | could not build: the stock Jolt heap is 128 MB (OOM past ~20k bodies) |
| **Load + ready to run** | **8.6 s** | **19.1 s** | **17.9 s** | |

The target (< 20 s, 16 GB tier) holds even in the unfocused worst case. GPU with the world loaded (impostors on):
16 GB, 4K output, preset camera 3.7–3.8 ms, whole world in view 6.4 ms; 32 GB at 4K: 5.7 ms and 6.4 ms.

**2M parts on the 32 GB tier (D85, unfocused):** a 11.2 MB file; first frame 6.8 s; Machine 30.2 s; GPU 10.6 ms at
the preset camera, 13.7 ms whole world.

Node (`node apps/game/bench/sim-bench.ts big 1000000`, final code): Machine build **4.0 s**, 724 MB of Jolt heap
(1,664 MB reserved). 2M: 12.0 s, 1.32 GB. Before S3 the build took 12.2 s (and couldn't get a heap). The jittered
world spawns ~370k parts touching or overlapping, so its first simulated second has 369k bodies awake (523 ms per
tick); that's the generator's worst case, not a load cost. A hand-built world doesn't do this.

### "Kiloton" (400 BANGSTICKs + 60 kegs in a BRIK fortress, Arena) and "Domino Day" (100k TOPPLE TILES, Megastructure)

Method: `bench/?scene=kiloton|domino&tier=16|32&res=3840x2160&mode=watch&seconds=20`. 4K output; the 16 GB tier
renders 1440p internal and upscales, the 32 GB tier ≥ 1800p. Bake & Watch bakes the whole run first (the progress
hook drives the bar) and then plays it back from the BakeStore. GPU frame time is from timestamp queries, taken as
the median and max of each 1 s playback window; the worst window is reported. Targets: 60 fps → **16.7 ms GPU**
during playback (GAME_SPEC §15, RENDERING §12). The sim's real-time budget is SIMULATION §12's 7.5 ms per tick;
Bake & Watch exists for scenes that miss it (GAME_SPEC §6.5).

| | Kiloton, 16 GB | Kiloton, 32 GB | Domino Day, 16 GB | Domino Day, 32 GB |
|---|---|---|---|---|
| Parts | 3,917 | 3,917 | 102,560 | 102,560 |
| Load to first frame | 153 ms | — | — | — |
| Machine build (worker) | 417 ms | — | 1.65 s | — |
| Bake: sim seconds / wall seconds (rate) | 20 s / 52.1 s (46 ticks/s) | 20 s / 54.5 s | 20.3 s / 41.8 s (58 ticks/s) | 20.3 s / 36.9 s (66 ticks/s) |
| Keyframes for the bake | 19 MB | 19 MB | 44 MB | 44 MB |
| Playback GPU, worst 1 s window: median (max) | **14.3 ms (20.1)** — PASS | 35–36.5 ms, stalls — G3 | **0.9–1.0 ms (1.8)** — PASS | 1.4 ms — PASS (after the GI stall below) |
| Still / whole world in view | — | — | 1.5 ms / 1.6 ms | — |

Both scenes play at 60 fps on the 16 GB tier, which is the exit target. On 32 GB, Kiloton's blasts cost 35 ms
frames and Domino Day had a 186 ms GI pass for several seconds after loading. Both are renderer costs at the
higher tier, reported to G3 below; they aren't sim or harness costs. Neither scene simulates in real time on one
core (table under "Sim numbers"). Bake & Watch is the shipped path for both, and the demo worlds open in it.

## What changed, by area

### Presets (`packages/parts-data/src/presets.ts`)
- `PRESETS` for Desk, Room, Warehouse, Arena, Megastructure: size, bounds, part cap, min tier, cove (`studio` or
  `none`: the Studio stops at Arena), sim floor half-extent, neutral zone, default camera, drone spawns, the
  environments that host it, impostors on/off, max orbit distance. Numbers from GAME_SPEC §5.3 and
  environments.md §0.2, §1.2, §4.1 (Blender y → engine −z).
- The sim's floor is sized by the preset (Megastructure is 2 km across); presets that fit the M2 400 m floor keep it.
- `joltCapacity()`: Jolt bodies / pairs / contact capacities scale with the world. **Found:** Kiloton's fortress has
  ~3.5 contacts per brick, past M2's fixed 8,192 contact limit; Jolt silently drops contacts and the bricks sink
  through the floor. Contacts now scale to 4 per part (cap 128k), pairs 8 per part (cap 256k).
- `joltHeapMB()`, `checkpointPlan()`, `JOLT_BIG_WORLD` (2,000 parts): see "1M parts" below.
- Format: `defaultEnvironment(preset)` / `defaultEnvFor()`: THE TINKER LAB for Desk and Room (contract 2), the
  Studio for Warehouse and Arena, the Backlot for Megastructure. `DEFAULT_ENV` is now Tinker Lab / Room. Old saves
  keep the environment they name; a header with none (pre-M3) loads as the Studio (`format/test/terrain.test.ts`).
  The host's new worlds use `defaultEnvFor(preset)`.

### Backlot terrain
- **Format** (`packages/format/src/terrain.ts`): `TerrainRecord` (u16 samples on the 0.5 m grid over the preset's
  bounds, `maxHeight` = bounds height, preset tag), the `TERR` section (row-delta-coded u16, deflated by the
  container; in saves, canonical snapshots and the world hash only when present, so every M2 hash is unchanged),
  `defaultTerrain(preset)`: the Arena (513²) and Megastructure (2049²) lots from environments.md §4.1 (plateau,
  swells, the back ridge, the creek bed and quarry on Mega, the 0.5 m bedrock and the H − 8 m ceiling), integer
  hashing and IEEE `+ − × ÷ √` only. Flat pads under E3b's water tower, light towers and trailers (their placement
  heights on the Arena lot; the mean ground on Mega).
- **Sculpting:** `TerrainStroke` (op 11, per DATA_FORMATS §3: raise / lower / flatten / smooth, radius 0.5–40 m,
  strength ‰, ≤ 512 stamps) and its inverse `TerrainPatch` (op 17). `applyStroke` is deterministic; the doc
  (`docstore`) applies strokes on the Backlot only, copying the default lot on the first stroke; undo restores the
  samples exactly; `WorldDoc.terrainRev` bumps per change; `DocStore.confirmed()` carries the terrain for runs.
- **Sim** (`packages/sim/src/terrain.ts`): one static Jolt `HeightFieldShape` per 32 m chunk (65 × 65 samples,
  block size 4, 8 bits per sample), samples written straight into the WASM heap, chunk-row order.
  `MachineOptions.terrain`. On the Backlot there's no Studio cove; on Arena the 160 dressing colliders from E3b's
  `backlot.json` load as a static set (`Machine.buildSet`) from the generated `parts-data/src/env_backlot.ts`
  (`node apps/game/bench/gen-env-backlot.ts`). Tests: `packages/sim/test/terrain.test.ts` (rests on plateau, swell
  and pad, replays identically, collides with a sculpted mound, stops on the water tower's tank).
- **Renderer** (`apps/game/src/gfx/terrain.ts`): `TerrainView`, a `RenderHook` drawing one grid mesh (1 m vertices on
  Arena, 2 m on Mega) with its own buffers, rewritten in place on a stroke; layer colours by the brief's rules
  (rock > 38° slope, sand in basins, grass); key light with the shadow map, fill, sky; it also draws into the shadow
  map. `TerrainBrushTool` turns a drag into `TerrainStroke` ops. **Not wired into main.ts** (U3's file): main needs
  `new TerrainView(renderer)` and `terrain.set(doc.activeTerrain(), doc.terrainRev)` each frame, `drawFloor = false`
  on the Backlot, and the brush tool in the dock.

### Impostors (`apps/game/src/gfx/impostor.ts`, via the cull pass)
- An 8 × 8 octahedral atlas per art mesh (64 views × 64 px in one layer of two 512² 2D-array textures: albedo +
  coverage, mesh-space normal), baked on the GPU the first time an impostor-enabled scene uses the mesh.
- The cull pass (shaders.ts `CULL_WGSL`) picks the impostor as the mesh's extra bucket after its LODs when the
  projected size is under `impostors.thresholdPx` (24 px, Arena and Megastructure: `preset.impostors`); renderer.ts
  adds the bucket, skips it in the mesh passes and draws it with one indirect draw per mesh. The view nearest the
  camera direction in the part's own frame (run mode: its body's rotation), key light + fill + sky on the stored
  normal. Checked by eye against the mesh render with every part forced to an impostor (Kiloton at 10 m).
- Measured, 1M parts at 2560×1440, 16 GB: preset camera **16.7 → 3.9 ms** GPU, whole-world camera **100 → 7.1 ms**
  (main + prepass were 33 + 29 ms of it; cull 0.2 ms).
- Later: blending between views, impostor shadows, blockout primitives (instance-scaled, so art meshes only).

### Bake & Watch, time dilation (`apps/game/src/bakestore.ts`, `sim.worker.ts`, `run.ts`)
- **BakeStore:** keyframes hold only the bodies that moved (`Machine.changedTransforms()`: active now or at the last
  call, from Jolt's active list, so a 100k-part scene costs what its awake bodies cost) as f32 position + snorm16
  quaternion, and per-part arrays only when they change; a cursor walks forward through the deltas, full frames
  every few seconds make scrubbing back cheap, and over the 768 MB budget (or the 3-minute span) the oldest
  keyframes fold into the base. M1's full keyframes would have been 15 GB for three minutes of Domino Day; the
  measured store is 44 MB for its first 20 s. Test: `apps/game/test/bakestore.test.ts`.
- **Worker:** the Jolt heap is sized per world; the bake runs on a time budget (6 ms per 8 ms loop) and reports its
  rate; frames without movement go out without transforms; `{type:'watch', seconds}` bakes as fast as it can
  (40 ms slices) until the target or until the machine has been still for 2 s, with `bakeProgress` at 4 Hz.
- **RunController hooks (U3):** `run.bakeAndWatch(on | seconds, speed)`, `run.bakeProgress`, `run.bakeEtaS`,
  `run.onBakeProgress(fn)`, `run.cancelBake()`, `run.simRate` (time dilation), `run.dilated` (the cue to offer it).
  Bake & Watch pauses the shared playhead, bakes locally, then resumes at `speed`.

### Share links (`apps/host/src/share.ts`, `packages/format/src/link.ts`, `apps/game/src/share.ts`)
- **Host:** a content-addressed store in `<data>/shares/` (id = first 16 hex digits of the bytes' SHA-256; same bytes,
  same link). `POST /share` (world or module, fully validated), `POST /share/world` (the session's world),
  `GET /share/:id`, `GET /share/:id/meta`, `POST /share/:id/import` (worlds into the host's list),
  `POST /share/fetch {url}` (another host's `/share/<id>`, size-capped and checked against
  its id). Tests: `apps/host/test/share.test.ts`.
- **Format:** `inlineLink()` / `parseShareLink()` per DATA_FORMATS §7 (`#m=1…` deflate-raw canonical world, ≤ 12 KB
  offered, ≤ 64 KB accepted, `&t=` / `&cam=`), `idLink()` for `#s=<id>`.
- **Client (U3 hooks):** `bindShare(net)` at boot, then `shareWorld(): Promise<string>` (the session bar's button:
  inline when it fits, else through the host), `shareModule(blob)`, `currentShareLink()`, `openShareLink(net, ref)`
  (imports and switches to a world, or stores a module in the Library), `importFromHost(net, url)`.
- Both demo worlds fit in inline links (`apps/game/bench/demos/links.json`).

### 1M parts: what was slow, and what changed
Measured stage by stage (profiles with `node --cpu-prof`):
1. **Jolt couldn't hold the world.** The published builds link a fixed 128 MB heap. `loadJolt('single', {heapMB})`
   rewrites the plain `wasm` build's memory section at load time (same code: Kiloton's hash is identical on both
   builds; the goldens pass). The sim worker sizes it with `joltHeapMB(parts)` (1M → 1.66 GB, 2M → 3 GB).
   JoltJS's 10 MB temp allocator (the per-step contact buffer) is sized through a `JoltSettings` field its IDL
   doesn't bind (offset 12, checked against the struct's defaults).
2. **Tried and removed: starting resting parts asleep.** Starting parts that were built exactly resting asleep cut
   Kiloton's first second from 49 ms to 1 ms per tick. It broke determinism, though. A checkpoint imported into a
   fresh machine didn't match while jointed bricks were asleep, and a late poke on a part that started asleep rolled
   back inexactly. Correctness came first, so every part starts awake again, as in M2.
3. **Machine build: 12.2 → 4.0 s** (Node). BRIK mortar went from all-pairs (O(n²): 1.4·10¹⁰ checks for a 1M world's
   bricks) to a grid with the same joints in the same order; part boxes computed once; one shape-key string per
   type; a reused position/rotation for body creation (a fresh pair per body also leaked 64 MB of Jolt heap).
4. **Per-tick stage loops over every part** (≈ 5 ms per tick at 100k): plain rigid parts (`INERT`: TOPPLE TILES,
   BRIK, THUD, BOING, SLOPE, LEDGE) are skipped by the per-part stages; power, pads and persisted contacts have their
   own lists (persisted-contact callbacks are skipped when nothing reads them).
5. **Checkpoints:** big worlds keep Jolt state in the heap (`StateRecorderImpl`: 30 ms vs 150 ms + GC at 100k bodies),
   checkpoint every 2 s and keep what fits in 256 MB (≥ 3: a ≥ 6 s rollback window); restores only re-apply layers
   for parts whose alive/broken state changed. Small worlds are byte-for-byte as before.
6. **Host joins re-encoded the world (1.1 s at 1M) and compacted it on every join.** The session keeps the encoded
   world while no op has landed (world.knockon as read, or the last compaction) and skips compaction when unchanged.
7. **The director camera** walked every part's box every frame (31 ms at 100k: Domino Day ran at 30 fps); it now
   reuses the extent for 0.5 s and samples ~20k boxes past 20k parts.

## Sim numbers (Node, single-threaded Jolt, `node apps/game/bench/sim-bench.ts <scene> <seconds>`)

| Scene | Parts / bodies | Build | Peak awake | Tick: mean / worst 1 s window | Bake rate (mean) |
|---|---|---|---|---|---|
| Kiloton (20 s) | 3,917 | 86 ms | 3,471 | 13.9 ms (p95 40.6) / **48.9 ms** (first second: the fortress settles) | 72 ticks/s |
| Domino Day (60 s) | 102,560 (64 lanes, BOING relays) | 0.6 s | 4,766 | 9.0 ms / 16.9 ms | 112 ticks/s |
| 1M parts | 1,000,000 | 4.0 s | 369k (jittered spawn, first second) | 523 ms | — |

Kiloton fires 424 charges and breaks 5,617 mortar joints in its 20 s.

SIMULATION §12's budget is ≤ 7.5 ms per tick up to 10k awake bodies. Kiloton's blast (3.5k awake bricks with mortar
joints) and Domino Day's peaks miss it on one core: 90 % of a tick is inside `Jolt.Step` (contacts and the 8k
six-DOF mortar joints), the rest JS contact callbacks. The machines run correctly and slower ("time dilation") and
Bake & Watch hides it. The real fix is the multithreaded Jolt build (M0 verified it deterministic at 1/4/12
threads); it can't take our `ContactListenerJS` callbacks on worker threads, so the contact path has to move off
the listener first (an M4 sim item).

**Domino Day layout.** A Jolt island only sleeps as a whole, and fallen tiles lean on each other, so an unbroken
lane stays awake from its first tile to the wave front (100k awake by the end). Every 40 tiles a BOING sits in the
lane as a relay: the last tile knocks it into the next segment and the old segment falls asleep (measured 4–60
awake per lane). TOPPLE TILES start asleep, so a BRIK stood on end and leaning 35° starts each lane.

## For other streams

- **U3:** `bindShare(net)` + `shareWorld()`; `run.bakeAndWatch(on)` / `run.bakeProgress` / `run.bakeEtaS` /
  `run.simRate`; `TerrainView` + `TerrainBrushTool` need wiring in main.ts (above).
- **G3:** at the 32 GB tier the GI pass took **186 ms** a frame for several seconds after a 100k-part scene loaded
  (Domino Day; 16 GB: 0.1 ms), and Kiloton's blasts measured 35 ms frames (16 GB: 14 ms). A renderer change bound
  17 sampled textures in the part pipelines' fragment stage (default limit 16); the harness asks for the adapter's
  limit (48) until that's fixed.
- **Sim owner / orchestrator: a rollback mismatch predating S3.** `apps/game/bench/repro-rollback.ts` builds a stack
  of 2,100 BRIKs with a BRIK shoved into it at y 0.05, pokes it at tick 70, and has a second machine learn of the
  poke at tick 260. Restore + resimulate doesn't match the straight run. It still fails with S3's big-world paths
  off (`JOLT_BIG_WORLD` raised so 2,100 parts take the M2 JS-recorder checkpoints; earlier also with M2 capacities,
  no settings reuse and the full applyAlive loop). 1,990 BRIKs match, and so does the same 2,100 stack shoved by a
  THUD at 0.11 (the sim test). Scene-dependent; not fixed here.
- **A3:** Kiloton uses `powder_keg` automatically when its def exists (it does now); fortress geometry is in
  `bench/scenes.ts`.
- **E3b:** pads flattened as asked; the Arena colliders are in the sim. Megastructure has the lot and pads but no
  dressing colliders (E3b's boxes are Arena heights).

## How to run it

```bash
node --disable-warning=ExperimentalWarning apps/game/bench/sim-bench.ts kiloton 20   # or: domino 60 · big 1000000
node --disable-warning=ExperimentalWarning apps/game/bench/host.ts                   # local test server :8795
cd apps/game && npx vite --config bench/vite.config.ts                               # harness on :5185
# http://localhost:5185/bench/?scene=kiloton|domino|big&tier=16|32&res=3840x2160&mode=load|run|watch&seconds=20&src=host
node --disable-warning=ExperimentalWarning apps/game/bench/make-demos.ts             # the demo worlds
```

Results land in `window.__bench` and as JSON in `%TEMP%/knockon-bench/`.
