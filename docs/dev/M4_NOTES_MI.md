# M4 notes: MI · Matter integration

Stream MI owns `packages/sim/src/matter/**`, `apps/game/src/matterhost.ts` and Matter in the format. Plan: [M4_PLAN.md](M4_PLAN.md) contract 2.

Status: **done** (2026-10-24/25). All of contract 2, the browser path, format and net, the part hooks except the Kitchen sink, and the Sandstorm world are in; Node and browser proofs below.

## Files

| File | What |
|---|---|
| `packages/sim/src/matter/host.ts` | `machine.matter` (`MatterHost`): the contract-2 API, stages 7 and 13, proxies, region, checkpoints, hash |
| `packages/sim/src/matter/contract.ts` | Structural copy of MX's `backend.ts` types (sim doesn't depend on `@knockon/matter`; backends are injected) |
| `packages/sim/src/matter/link.ts` | `MatterLink` (the host's synchronous view of a backend), `SyncBackendLink` (Node: MX's `stepSync` twins) |
| `packages/sim/src/matter/proxies.ts` | Part shapes → sphere / capsule / OBB proxies; 22-word proxy records |
| `packages/sim/src/matter/pack.ts` | Flat i32 codecs for step inputs and outputs (browser link, MATR) |
| `packages/sim/src/matter/checkpoint.ts` | A checkpoint's Matter record ↔ the MATR section |
| `packages/sim/src/matter/parts.ts` | FISHBOWL and SCOOP Matter hooks |
| `packages/sim/src/matter/budget.ts` | `matterGrains(parts)` (counts.grains) and the backend capacity |
| `packages/sim/src/matter/sandstorm.ts` | The full rigid + Matter Sandstorm world builder |
| `packages/sim/src/matter/units.ts` | Metres ↔ units, particle masses, impulse scale |
| `packages/format/src/matter.ts` | `SimFlags`, `requiredTier`, tier caps, `readSimFlags` |
| `packages/format/src/checkpoint.ts` | KNCP checkpoints (JOLT, ECS, MATR) and the MATR section codec |
| `apps/game/src/matterhost.ts` | Browser: `MatterHostMain` (main thread: bake backend, playback replica, snapshot store), `MatterWorkerLink` / `MirrorLink` (sim worker), `matterView()` for R4 and F4 |
| Tests | `packages/sim/test/matter_host.test.ts` (toy backend), `matter_cpu.test.ts`, `matter_sandstorm.test.ts` (MX's CPU backend), `matter_toy.ts`; `packages/format/test/matter_header.test.ts` |

Shared-file edits (Edit tool, all marked `MI (M4)`): `machine.ts` (options, `st.matter`, stage 7 / 13 calls, checkpoint / restore / export / import / hash / destroy / blast hooks, env set boxes for static proxies, `matterFill`), `critters/system.ts` (GOBY's rescue bubble: 3 lines), `format/src/{world,index}.ts`, `docstore/src/{world,store}.ts`, `net/src/protocol.ts`, `apps/host/src/session.ts`, `apps/game/src/{sim.worker,run,net,bakestore}.ts`, `apps/game/test/bakestore.test.ts` (fixture), `apps/game/src/main.ts` (one line: `run.attachMatter(renderer.device, caps.tier)`).

## `machine.matter` as built (contract 2)

`part` is always a **part index** (what channels and critters use). Everything is a no-op (or 0 / null) while `matterGameplay` is off.

| Member | Meaning |
|---|---|
| `active`, `started` | Matter on for this run; the first emit has happened (Matter is dormant, with no commands at all, until then) |
| `emit(part, kind, count, localPos, localVel, spread = 0.05)` | Queues a lattice block of `count` grains centred on `localPos` (part space, m: the spout), moving at `localVel` (part space, m/s) with ±`spread` **m/s** of per-axis jitter (MX's emit rules). Goes out with the next command, in call order (= part order). |
| `intake(part, localBox, kindMask, capacity = 0, persistent = false)` | A sensor box (part space, m). Per tick (A4's use): call it in stage 6 every tick it should be live, `capacity` = room left (0 = closed); a sensor nobody opened since the last command is closed. `persistent` (MI's containers): live while the part is alive and unbroken; `capacity` 0 = what fits its container, −1 = unlimited (the container overflows itself). Same part + box = same intake. |
| `absorbed(part)` | `[sand, water, marble]` taken in at the last coupling tick: set in stage 7 of rigid tick 2N + 4, visible until the next stage 7 (so stage 6 of 2N + 5 sees it). |
| `blast(center, radius, dv)` | Radial kick (m, m, peak m/s); `Machine.blast` calls it with min(8, 8·Y) m/s (D53's cap). |
| `count(kind)`, `checksumHex()` | Live grains, Matter checksum (last applied result). |
| `container(part, capacityMl, kind, initial)`, `stored(part, kind?)`, `take(part, kind, n)`, `capacityMl(part)`, `fill(part)` | MI's container store (volume in mL: sand ≈ 18 grains/mL, water 1, marble 0.29). A4 keeps its own stores in `st.m2.m4.q`. |
| `waterNear(p, radius, minMl = 2000)` | Nearest live container with ≥ 2 L of water (GOBY). Loose particles live on the backend, so only stored water counts. |
| `Machine.matterFill(out)` | Fill per part (0–1, MI's containers) for keyframes; the worker sends it × 255 as `frame.fill` / `RunController.fill`. |

**Automatic:** proxies for every pushable dynamic body (not ghost, hidden or dormant: rule 8) whose bounds reach the Matter-active region, ≤ 4,096, sub-shape by sub-shape from the part's shapes (cylinders → capsules when long, boxes when squat); bodies without a shape list (critters, chunks, pieces) get an axis-aligned box on their Jolt bounds. Static proxies: the floor plane (always), the environment set's boxes and spheres, and static parts' shapes, inside the region. The region is the backend's live-particle bounds padded 1 m, plus containers and intakes padded 1 m, plus `MatterOptions.region`. Impulses are applied in proxy-id order (Jolt sums floats, so order matters) at the proxy's centre on the body's current pose. Container contents beyond their starting load weigh on the body (a constant force per tick).

**Options:** `MachineOptions.simFlags = { matterGameplay }`, `MachineOptions.matter = { backend | link, capacity, checkpointEvery = 240, keepSnapshots = 8, region, impulseScale, maxProxies }`. With the flag on and no backend the Machine throws (clients must never silently differ).

## Latency (SIMULATION §8.5)

- Stage 13 of rigid tick 2N: capture the proxy snapshot S(2N); submit Matter tick N built from S(2N − 4), the emits and blasts queued since the last command and the live intakes.
- Stage 7 of rigid tick 2N + 4: take tick N's result and apply impulses and absorbed counts. The link blocks only if it isn't back (time dilation); nothing ever skips.
- The backend numbers its ticks from the first command (backend tick = N − `st.matter.first`), so it always starts from its own tick 0 (MX's CPU backend requires consecutive ticks).
- Test: `matter_host.test.ts` "submits Matter tick N at rigid tick 2N …" checks every submit, every take (≤ 2N + 4), `st.matter.applied` per tick (exactly 2N + 4), and that the FUZZ's proxy in tick N sits where the FUZZ was after rigid tick 2N − 4.

## Rollback

- `st.matter` (plain, JSON-safe) holds everything gameplay sees: queues, intakes, absorbed, containers, counts, checksum, bounds, first.
- Every `checkpointEvery` rigid ticks (240 = 2 s; tests use 60) the rigid checkpoint also carries a Matter record: the backend snapshot (after Matter tick T/2 − 1), the two results already computed but not applied (T/2 − 2, T/2 − 1: they can't be recomputed after the snapshot, so they're fetched early, which is the only extra wait), and the proxy ring. Only checkpoints with a record are restorable while Matter runs (`Machine.restore` / `oldestCheckpoint` / `exportCheckpoint` skip the rest), so a rollback may reach back 2 s.
- `keepSnapshots` (8) bounds the records; older ones are released (`link.release`), newer ones are released on restore.
- Tests: late-poke rollback matches the straight run (toy and MX's CPU on Sandstorm), restore picks the newest Matter checkpoint, desync repair continues bit for bit.

## Hash, format, net

- `Machine.hash()` adds the Matter checksum, live counts, container contents and `first` (only with Matter on, so every existing golden is unchanged).
- The worker's `hash` message carries `mc` (the Matter checksum, already inside `h`); the host logs whether Matter checksums differ on a desync.
- **Checkpoints on the wire are now KNCP** (DATA_FORMATS §6): `JOLT`, `ECS ` (the JSON state) and `MATR`, deflated. `MATR` = MX's snapshot payload (MTR1) + the pending results + the proxy ring (`format/src/checkpoint.ts`, `encodeMatrSection`).
- **Size limit:** J4 raised the host's WebSocket cap to 64 MB. `decodeClient` now lets `checkpoint` messages (only those) reach `MAX_CHECKPOINT_MESSAGE_BYTES` = 64 MB; every other client message stays under `MAX_MESSAGE_BYTES` (4 MB); `MAX_CHECKPOINT_BYTES` = 64 MB − 4 KB is what the worker checks before sending (`packages/net/test/checkpoint_size.test.ts`). **Measured:** the 1M-water Kitchen sink world's checkpoint at tick 480 is **7.7 MB** (7,718,435 B, KNCP deflated; export 1.06 s in the browser, GPU snapshot pulled through the chunked reply); a partner that adopted it continued with identical hash + Matter checksum on all 11 hashes from tick 540 to 1,140. By that ratio (≈ 7.7 B per grain deflated for settled water) about 8M grains fit under 64 MB; a bigger world's authority reports "can't re-sync … over the limit" and the run carries on.
- Header: `simFlags` (absent = written as `DEFAULT_SIM_FLAGS`; a file without it reads as Matter off, so pre-M4 saves keep their M2 behaviour and hashes), `counts.grains` (`WorldSnapshot.grains`), `requiredTier` (GAME_SPEC §15.2 from parts and grains). `WorldDoc.simFlags`, `WorldDoc.countGrains` (set by the game in `net.ts` and lazily by the host session from `@knockon/sim`), `DocStore.confirmed().simFlags`. New worlds (`EMPTY_WORLD`) run Matter.

## Browser path (D92) and Bake & Watch

- `run.ts` computes the world's grains (`matterGrains`), warns when `requiredTier` exceeds this client's tier, and makes a `MatterHostMain` on the renderer's device; its channel (MessagePort + SharedArrayBuffer) goes to the worker in `start`.
- **'gpu' mode** (any world with more than `MATTER_CPU_GRAINS` = 300 grains and a device): the worker's `MatterWorkerLink` posts each command (one transferable Int32Array); the main thread runs it on MX's `MatterGpu` and writes the result into one of 8 SAB slots; the worker `Atomics.wait`s only when it reaches tick 2N + 4 first. Snapshots stay on the main thread (byte budget 1 GB) and are referenced by id; export pulls bytes through a 4 MB chunked reply area.
- **'cpu' mode** (no device, or tiny worlds): MX's CPU backend runs in the worker; `MirrorLink` mirrors commands and snapshots to the main thread. MX's CPU reference measured ≈ 47 µs per water particle per Matter tick, so this is a fallback, not a fast path.
- **Playback replica:** the bake runs ahead of the playhead (4 s live, the whole run in Bake & Watch), so the bake backend's buffers show the future. A second `MatterGpu` on the same device replays the logged commands up to the playhead's Matter tick (≤ 4 per frame), and `view()` / `matterView()` return the replica's buffers. Scrubbing back, or a rollback that rewrote ticks it already showed, restores the newest snapshot at or before the target and replays (≤ 240 ticks per seek). Cost: up to 2× the Matter GPU time while baking ahead; in Bake & Watch playback only the replica runs. Memory: the command log (≈ 76 B per proxy per tick) plus the snapshots. No particle frames are stored (4M grains = 112 MB per frame).
- `RunController`: `attachMatter(device, tier)`, `matter` (the host), `fill` (`Machine.partFill`, A4's merge of every container's fill, 0–1 Float32 per part, through the BakeStore's new `mf` array), `matterGrains`, `matterMode`, `matterWaitMs`, and `matterCounts` (Int32Array `[sand, water, marble]` live at the playhead, keyframed through the BakeStore's `mc` array, so it's right in Bake & Watch and when scrubbing; empty while Matter is off; U4's world-card meter). `matterView()` (module function in `matterhost.ts`) is what R4 and F4 read.
- **Ordering on the main thread:** steps go to the backend as they arrive (two in flight under the fixed latency; MX's GPU backend queues ticks back to back); init, snapshot, restore and export are full barriers. The first version awaited each step's readback before issuing the next, which halved throughput. Snapshot must be a full barrier: with the snapshot call alone ordered (not its readback), the browser's late-poke rollback diverged (MX's `snapshot()` reads state asynchronously, so a step issued right after it could change what it copied); fixed and re-proven below.
- **Dilated runs:** when the playhead is within 2 Matter ticks of the bake head, `view()` shows the bake backend and the replica rests (no double GPU cost); it re-seeks when the bake pulls ahead again.

## Parts

- **FISHBOWL** (with Matter on): a container of 11.7 L of water (fill 1); a persistent top intake over the mouth (unlimited: anything poured in spills back out over the lip, ≤ 400 per tick, round the rim); on break, everything in it bursts as 8 blocks flying out at 1.2 m/s (+0.4 up, ±0.25 jitter). The `Splash` event (mag 11.7) still fires for audio and FX; with Matter on, the renderer should skip its cosmetic water burst.
- **SCOOP:** a 3.5 L container with a persistent intake inside the bucket; contents weigh on it; tipped past 70° it pours 120 per tick from the rim.
- **FUZZ:** floats (or not) from the particle contacts alone; nothing in code.
- **GOBY:** the rescue bubble goes to the nearest container with ≥ 2 L of water within 3 m (`waterNear`), else the empty cradle as before.
- **Kitchen "Fill the sink" (D98):** see its own section below.

## Fill the sink (D98)

- **World setting:** `EnvSettings.sinkFill` (boolean), changed with the existing `EnvUpdate` op, so it's undoable, synced, journaled and saved in the header's `env` (an undo of "never set" sends null, which reads as off). Settings › World shows a "Fill the sink" checkbox while the environment is the Mega Kitchen (`settingspanel.ts` + the host hook in `buildtools.ts`, marked MI (M4)).
- **Budget and tier:** `SINK_FILL_PARTICLES` = 1,000,000 and `SINK_FILL_TIER` = 16 (`format/src/matter.ts`). `sinkFilled(env)` is true only in the Kitchen. `matterGrains(parts, env)` adds the 1M; `worldRequiredTier(parts, grains, env)` returns at least 16 for such a world (1M alone would fit 8 GB). The header writer, the docstore's grain hook and `run.ts` all use them.
- **Sim:** the start message carries `sinkFill`; the worker passes `MatterOptions.sinkFill` = 1M (tests pass less). `parts.ts` `sinkPlan()` reads the basin from the Kitchen preset's `sink_floor` collider (room or warehouse, as `buildKitchen` chooses), and tiles it with 12³-particle cubes on MX's water lattice (655 units), layer by layer, never above 0.7 m over the floor (Z 4.2 m). 1M = 579 blocks (33 × 16 per layer, 2 layers), emitted 64 per even tick, so the fill is done by Matter tick 10, identically everywhere. `st.matter.sink` counts the blocks emitted, so rollback replays the fill exactly.
- **Wet-darkening material:** skipped: there's no engine wetness mask to drive (nothing in the renderer reads one yet). Art's roughness −0.3 / albedo −15 % state needs that hook first (R4 / the look owner).
- **Tests** (`matter_sink.test.ts`, plus two in `matter_header.test.ts`): 1M counted only for a Kitchen with the sink on; the plan is 579 blocks inside the basin and under the fill line; the full 1M goes out over the first 10 Matter commands, identically in two runs (toy backend, capacity 1,000, so it drops the particles but sees every emit); on MX's CPU backend with a 2,000-particle cap the water stays in the basin, two runs match, and a late poke rolls back to tick 0 (before the fill) and matches. The header test checks `requiredTier` 16, `counts.grains` 1M and the op round trip.
- **Browser, the real 1M:** a Kitchen world with the sink on ("MI sink", a FUZZ dropped in), live run, 'gpu' mode, GPU at 100 % with other streams (`nvidia-smi` 100 %, 16.9 GB): all 1,000,000 particles alive within 1 s and still 1,000,000 after 40 s (`run.matterCounts`), the replica drawing 1M; the run held 0.44–0.82× real time, with the Matter step round trip at 43–80 ms (worst in the first 6 s while the water settles). No errors.

## near() (requested by B4, needs MX)

`machine.matter.near(at, radius, kindMask)`: `at` is a world point or a part index (its centre of mass). It returns `[centroid x, y, z (world m), count]` or null, which is the shape B4's DUSTY code already calls. Asking registers a query for the next Matter command (deduplicated per 5 cm cell, radius and kinds, ≤ 256 per command); the answer lands with the fixed latency (2N + 4), and near() returns the newest answer to a query of the same radius and kinds centred within max(0.25 m, r/2) of `at`. Queries in flight and answers are plain state (`st.matter.queries / qflight / answers`), so rollback is exact; answers are hashed. The wire shape is the one the orchestrator asked MX for: `MatterStepIn.queries {id, center, radius, kindMask}` → `MatterStepOut.near {id, count, centroid}` (both optional, packed by `pack.ts`). Tested on the toy backend (latency, finding the FISHBOWL water, rollback). **MX's backends don't answer queries yet** (nothing in `backend.ts` / `cpu.ts`), so with MX's CPU or GPU backend near() returns null and DUSTY falls back to B4's lure patches; the DUSTY-on-a-sand-pile test waits for MX.

## Sandstorm

`sandstorm({ hoppers, capacity, start, rate })`: a row of WATERWHEELs (A4's def, hubs 0.5 m up so the heap under them can't jam the buckets) on a valley floor walled by 35° SLOPEs, a GRIT HOPPER (open at start) over each wheel's descending side, a COG on a BAND per wheel. Full scale: 4 × 1M grains at 50k/s. A first layout with a 0.2 m-wide SLOPE chute spilled most of the stream over its sides before the wheel (measured: the wheel didn't turn), so the hoppers pour straight onto the buckets.

Node proof (`matter_sandstorm.test.ts`, MX's CPU backend, 1 lane, 5,000 grains, 420 ticks): the wheel turns (< −0.3 rad), two runs give the same hash sequence (hash + Matter checksum every 60 ticks), and a poke delivered at tick 330 for tick 250 rolls back to the Matter checkpoint at 240 and matches the straight run.

## Device loss (V4)

`main.ts` passes `renderer.onRestore` to `run.attachMatter`. On `device.lost` the main-thread host stops issuing (commands keep being logged; a failure in flight waits 300 ms to see whether it was a loss before failing the worker). When the renderer has rebuilt itself, `MatterHostMain.deviceRestored()` makes a new bake backend on the new device, restores the newest CPU snapshot at or before the last tick received (or the empty start), re-runs the logged commands from there (taking any snapshot the worker asked for meanwhile when its tick comes, and starting over if the worker rolled back meanwhile), rewrites their results into the SAB, and makes a new replica. The worker never sees a gap; it only waits. Matter's buffers are all labelled `matter.*` by MX, so V4's ledger counts them (and the governor leaves them alone).

Browser proof: the FISHBOWL run with `renderer.simulateDeviceLoss()` at bake tick 311 (Matter running since ≈ tick 55) recovered (renderer and Matter, one recovery each), showed grains again, raised no error, and its hash + Matter checksum sequence to tick 1,200 equalled the same run without the loss.

## Browser proof (Chrome in the desktop app's pane, local Vite 5202 + host 8802, `?debug` + `window.__kn.run`)

GPU shared with the other streams: `nvidia-smi` showed 57–100 % utilisation and 21–22 GB used during these runs, so every timing here is provisional (rule 11). The sim worker was started with `joltThreads: 0` (see J4 below).

- **MatterGpu round trip** (11,700 water particles, main thread, 57 % busy GPU): one tick submitted and awaited at a time 12.8 ms median (16.9 max); 30 ticks queued back to back 4.5 ms per tick; a snapshot (327,632 B) 15.7 ms.
- **FISHBOWL world, live run, 'gpu' mode:** the bowl breaks at ≈ 0.45 s; the burst second runs at 0.8–0.89× (Matter wait 35–44 ms per frame, step round trip 40–46 ms, falling to ≈ 10 ms), then 1× with the bake 4 s ahead; the replica stays 1–3 Matter ticks behind the playhead; no console errors.
- **Bake & Watch** (same world, 10 s): baked at ≈ 320 ticks/s (2.7× real time) with Matter on the GPU, then played back with the replica 1–2 Matter ticks behind.
- **Determinism and rollback in the browser:** two runs (an early poke at tick 400) gave identical hash + Matter checksum sequences (20 hashes to tick 1,200); a run whose poke for tick 400 arrived when the bake was at tick 700 rolled back and matched the straight run on every hash re-sent after the rollback (ticks 840–1,440). Before the snapshot-barrier fix that comparison failed from tick 840.
- **Sandstorm, one lane × 50k grains:** ≈ 1× (step round trip 20–35 ms) with one 3 s stall at 150 ms per step (GPU contention).
- **Sandstorm, full scale (4 × 1M):** runs, dilated as D92 expects: 20 s of wall time reached tick 935 with 1.55M grains alive, 0.33–0.8× real time (step round trip 44–102 ms, growing with the grain count), on a GPU at 100 % with other streams. Before the follow-the-bake change it reached tick 705 (1.16M grains) in the same 20 s. Full Sandstorm is a Bake & Watch scene on a busy GPU (D89 / D92).

## Test results

(2026-10-24, GPU and CPU shared with the other streams; times are provisional)

- `matter_host.test.ts` 11/11 (≈ 15–26 s), `matter_cpu.test.ts` 1/1 (≈ 35 s), `matter_sandstorm.test.ts` 1/1 (≈ 124 s under contention), `format/test/matter_header.test.ts` 4/4.
- Final run (2026-10-25): sim, format, docstore, net, game and host suites **47 files, 662 tests, all pass**, including every existing golden with **no re-pins** and A4's Matter-on tests. `pnpm -s lint` clean. `tsc -p tsconfig.json`: only MX's `packages/matter/test/matter.test.ts` errors (the M0 spike API it imports moved); `tsc -p apps/game` and `apps/game/bench` clean.
- Demo files: `apps/game/bench/demos/sandstorm.knockon` (4 × 1M) and `sandstorm_small.knockon` (4 × 50k), written by `apps/game/bench/make-sandstorm.ts`; `scenes.ts` has `sandstormWorld()`.
- Private browser runs used a throwaway Vite config (port 5202, proxy to 8802, HMR off: other streams' edits otherwise reload the page every few seconds) and a scratch `KNOCKON_DATA`; both are gone.

## Fixes from other streams' reports

- **A4: a resting body re-hit every 62 ticks once Matter had grains.** MX reports an impulse for every dynamic proxy, zeros included, and `BodyInterface::AddImpulse` wakes a sleeping body; each time a resting body near Matter fell asleep (0.5 s) the next Matter tick woke it, which re-added its contacts and replayed their Impact / Press. Now impulses are summed per body and zero sums are skipped, so only bodies the particles touch are pushed. (A wake threshold of Jolt's 0.03 m/s was tried too and dropped: it kept a WATERWHEEL asleep under a slowly filling bucket; A4's WATERWHEEL test and the Sandstorm test caught it.) Regression test: "a THUD resting on THE BUTTON presses it once …" (10 presses before the fix, 1 after).
- **A4: QUACK flung by water.** Not reproduced with MX's current kernels (with or without the fix above): in A4's basin scene the duck rides the water at y ≈ 0.05 m (floor rest 0.028) through 2 s, with summed Matter impulses ≤ 0.009 N·s per tick (traced per coupling tick). If it comes back, the suspects are the 8-tick loop delay on a very light body (MI could cap Δv per coupling) or the kernels (MX).
- **A4: `fill` link kind** appended to `LinkKinds` (append-only).
- **C4:** `run.ts` imports MX's GPU module lazily (it touches `GPUBufferUsage` at load), so `run.ts` loads in Node again; `bakestore.test.ts` fixture has `mf`.
- **F4: 0.035–0.05× with Matter on.** Before `main.ts` handed the renderer's device to the RunController, every Matter run used MX's CPU backend in the worker ('cpu' mode, ≈ 47 µs per particle per Matter tick), which matches F4's slowdown. With the device attached runs use the GPU ('gpu' mode); plus the pipelining and follow-the-bake fixes above. Numbers: "Browser proof". The "paused after LET IT RIP" F4 saw is consistent with playback held at a bake head crawling on the CPU path; it didn't happen on the GPU path here (phase `running` within 100 ms, playhead moving).

## For other streams

- **A4:** your `intake()` per-tick use matches; `spread` is **m/s** of velocity jitter (MX's emit rule), not metres. Matter parts' goldens: MX's CPU backend is ≈ 47 µs per water particle per Matter tick (sand is cheaper), so keep golden pours to a few thousand grains. If your defs carry `matterGrains(props)`, `matterGrains()` uses it; until then budget.ts mirrors your capacity / start props.
- **B4:** `machine.matter` satisfies `CritterMatter` (DUSTY: an intake under it is the way to vacuum; `near()` can't exist on the sim side, the particles live on the backend).
- **R4:** draw `matterView()` (from `apps/game/src/matterhost.ts`): MX's `MatterView` of the playback replica, already at the playhead's Matter tick (null before Matter starts or without a device). Container fill: `RunController.fill` (× 255 per part, partIds order; MI's containers) plus A4's meters. With Matter on, suppress the cosmetic FISHBOWL water burst.
- **F4:** you already read `matterView()`; it follows the playhead.
- **C4:** offline capture should drive `run.matter?.playback(tick)` per captured frame (it's called on every worker frame already).
- **MX:** thanks for requests 1–3. Open: the CPU reference's speed (above) limits Node goldens.

- **J4:** in this checkout the sim worker's multithreaded Jolt fails under Vite dev: the run worker's nested pthread Workers raise 16 × "Uncaught [object Event]" and the run never becomes ready (no `ready` message). Single-threaded (`joltThreads: 0` in `start`) works. Reproduced with a plain `start` message (Matter off), so it isn't Matter.
- **MX:** `snapshot()` must be awaited before the next `step()` if the snapshot is to be exact (MI now does); worth documenting in backend.ts.

## Status at hand-back (2026-10-25 00:00)

MX changed `constants.ts` / `cpu.ts` / `wgsl.ts` at 23:27–23:29 (the grain queries landed then). Since that change, free-flying particles are heavily damped on MX's CPU backend: measured backend-only, 200 water particles emitted at 1 m/s horizontally travel 0.07 m in 0.33 s (should be ≈ 0.33 m), and part of the blob barely falls. With that, four tests that pour water or sand fail: A4's TANK → TANK, SPONGE and WATERWHEEL tests in `m4_matter.test.ts`, and MI's `matter_sandstorm.test.ts` (the wheel turns −0.016 rad instead of < −0.3). They passed with the kernels before 23:27 (19 / 19 at 23:1x), and MI's host code on those paths didn't change. Reported to MX through the orchestrator.

B4's `critters_m4.test.ts` "Matter vacuuming replays and survives a late-poke rollback" now fails because near() works: DUSTY beelines to the sand straight away instead of finding it at ≈ 4 s, so its "bin is 0 at tick 420" assumption no longer holds. It's B4's test (move the sand outside DUSTY's 1.5 m vision, or check the bin later).

## Open issues

- **near()** needs MX's `queries` in both backends (above).
- **Sink wetness mask** needs an engine hook (above).
- **V4 ledger:** nothing to do: MX labels every Matter buffer `matter.*`.
- **No in-game toggle** for `matterGameplay` (it's per world, in the header; an op would be needed for a Settings switch).
- Matter-active region for big worlds iterates every body each even tick (a cheap origin test); a broadphase query would scale better past 100k bodies.
