# M5 notes: J5 · Jolt heap

Stream J5 fixes T5's found item 5 ([M5_NOTES_T5.md](M5_NOTES_T5.md)): the Jolt WASM heap ran out (`Aborted(OOM)`) at
≈ 74k awake bodies in a 154k-part world with a 640 MB heap. In the browser that would have killed the sim worker's run
loop instead of dilating time. Plan: [M5_PLAN.md](M5_PLAN.md). Status: **done** (2026-10-25).

**Hardware:** Intel Core Ultra 9 285K (24 cores), 64 GB RAM, Windows 11, Node 24.2. Memory numbers don't depend on the
CPU; tick times in the logs were taken with up to eight benches at once and aren't used for anything.

## Method: the heap's high-water mark

Our Jolt heaps are fixed: the loader rewrites the binary's memory to `joltHeapMB` (no growth), so a run needs exactly
the most memory its allocator ever touched. Jolt exposes no high-water mark (`JoltInterface.sGetFreeMemory` is the
current figure only, sampled between ticks it misses the transients inside a step or a checkpoint), so:

- **`joltHeapHighWater(J)`** (new, `packages/jolt/src/load.ts`) scans the heap down from the top for the last nonzero byte.
  A fixed WASM memory starts zeroed and Emscripten's dlmalloc never gives memory back below its break, so that byte is
  the high-water mark: static data, stack, every allocation and allocator header, freed or not.
- **Check of the method:** T5's domino world (154k parts) crosses 640 MB + the threaded headroom between 68k and 74k awake
  in my run (high-water 668 MB at 68k), which is where T5's single-threaded run aborted in 640 MB.
- **Check on a forced OOM:** an 8k-part pile on the stock 128 MB heap aborts at a checkpoint, as predicted by the
  numbers below.

Runs: `apps/game/bench/sim-bench.ts` (T5's tool) with new flags `--heap=MB`, `--cp=N` (checkpoint interval, so the
rollback ring fills with awake state in seconds instead of 16–32 s; the memory is the same, sooner) and `--keep=N`.
It now reports `heapPeakMB` (the high-water mark), `heapLiveMaxMB` (most in use after any tick), `contactPeak`, and an
abort as `oom` instead of crashing. Its default heap is now the worker's (`joltHeapMB(parts, contactEstimate)`).
`apps/game/bench/heap-bench.ts` (new) splits a scene's cost into the Machine's build and one in-heap checkpoint (heap in
use around each call, the raw `SaveState` bytes, the recorder's slack).

Worst case = **every part awake in one dense pile** (`awakePile(n)`: THUDs, BOINGs, TOPPLE TILES in 8 layers; ≈ 93 % stay
awake as one island) with the ring full of awake checkpoints, plus T5's unbroken-lane domino wave.

## Measured peaks (all awake)

`--cp=30` fills the ring after 2 s of settling; the peak then holds (50k: 1,189 / 1,267 MB at 5 s and 6 s). "Old" is
the pre-J5 `joltHeapMB` for the same world (with its contact estimate, as the worker sizes it).

| Scene | Parts | Awake | Ring kept | Built (MB) | Peak, single (MB) | Peak, 8 threads (MB) | Old heap (MB) | New heap (MB) |
|---|---|---|---|---|---|---|---|---|
| Pile | 20,000 | 18,760 | 16 | 170 / 178 | **377** | **385** | 384 (fits by 7 MB) | 704 |
| Pile | 50,000 | 46,781 | 16 | 422 / 431 | **1,258** | **1,267** | 640 → **OOM** | 1,536 |
| Pile | 100,000 | 93,812 | 12 | 846 / 854 | **2,133** | **2,141** | 1,024 → **OOM** | 2,560 |
| Pile | 154,000 | 143,599 | 8 | 1,131 / 1,139 | **2,059** | **2,067** | 1,216 → **OOM** | 3,072 |
| Pile | 400,000 | 374,911 | 3 | — / 1,352 | not run (≈ 5 s/tick) | **2,079** | 1,408 → **OOM** | 3,712 |
| Domino wave (T5's) | 154,112 | 130,461 | 8 | 319 / 351 | — | **1,244** (32 s, ring still filling) | 704 (640 in T5's bench) → **OOM at ≈ 74k** | 2,176 |
| Pile (test) | 86,000 | 80,634 | 15 | — | — | **1,534** (12 threads) | 896 → **OOM** | 2,432 |

- **Threaded vs single:** the threaded build peaks 8–9 MB higher (pthread stacks and the job system: its baseline high-water
  is 15–20 MB vs 1 MB). The loader already adds 32 MB + 2 MB per thread on top of `heapMB`, so the same formula serves both.
- **Validation at the new heap** (no `--heap`): the 50k pile single-threaded for 15 s with 60 checkpoints of churn
  (peak 1,258 MB in 1,536 MB, flat from 5 s to 15 s); the 100k pile threaded peaks 2,141 MB in 2,560 + 48 MB; the domino wave 1,148 MB in 2,176 + 48 MB;
  the 86k pile 1,534 MB in 2,432 MB (the unit test below). No OOM anywhere.

## Where the memory goes

**The build** (the Machine with its Jolt capacities, measured on 12 worlds of 2.5k–400k parts; fit residual ≤ 6 MB):
Jolt's temp allocator (`joltCapacity.tempBytes` ≈ 512 B per contact slot + 48 B per body) + ≈ 380 B per part + ≈ 480 B
per contact slot + ≈ 60 B per body-pair slot + 5 MB. A dense pile's contact estimate (≈ 5.2 per part) hits the 2^20
contact cap from ≈ 140k parts, so a 154k-part pile builds in 1.13 GB, a mostly static 400k-part `bigWorld` in 0.59 GB.
An empty Machine is 15 MB; Backlot's 2049² terrain adds 9 MB; the environment sets add < 1 MB.

**Each in-heap checkpoint** (worlds over 2,000 parts keep `StateRecorderImpl`s in the heap; ring size from `checkpointPlan`):

| | Raw `SaveState` per body | In-heap footprint |
|---|---|---|
| Asleep (settled `bigWorld`) | 100 B | 126 B (slack 1.25) |
| Half awake (`bigWorld`, first tick) | 167 B | 252 B (1.5) |
| Domino wave, 53 % awake | 305 B (≈ 490 per awake tile) | 314 B (1.03) |
| Dense pile, 93 % awake | 487–543 B (≈ 580 per awake body) | 524–629 B (1.0–1.29) |
| Dense pile at 50k / 100k parts (from the ring growth) | — | ≈ 1,000 / ≈ 940 B (≈ 1.7–1.9) |

The recorder is a growing `std::stringstream`, so its buffer is 1–2× the bytes it holds (a step function of size), and a
growing one briefly holds both buffers. **An awake body costs ≈ 0.5 KB more than a sleeping one in every checkpoint, up
to ≈ 1.2 KB with slack.** `checkpointPlan`'s 201 B per body (its 256 MB ring budget) is a mostly sleeping figure: an
all-awake ring is 5–12× that. Peaks above the live figure (75–180 MB) are the growing recorder plus fragmentation.

**Per awake body, per world size** (what joltHeapMB charges): 2 × 600 B × (ring + 2): ≈ 22 KB at ≤ 50k parts (16 kept),
≈ 17 KB at 100k (12), ≈ 12 KB at 154k (8), ≈ 6 KB at 400k (3).

## The new formula (`parts-data/src/presets.ts`)

```
joltHeapNeedMB(parts, contacts) =                       (128 up to JOLT_BIG_WORLD = 2,000 parts: checkpoints in JS)
  64 MB                                                  static data, stack, fragmentation
+ tempBytes + 8 MB + 560 B·parts + 500 B·maxContacts + 64 B·maxBodyPairs     the build (joltCapacity, as the Machine)
+ (keep + 2) × 2 × 600 B × parts                         the ring all awake, + a desync export, + a growing recorder
rounded up to 64 MB;   joltHeapMB = min(4,032, joltHeapNeedMB)
```

Constants: `JOLT_HEAP_MAX_MB` (4,032) and `JOLT_AWAKE_STATE_BYTES` (600) are exported. Every measured peak has ≥ 19 % to
spare (unit-tested at ≥ 15 %). The coefficients are upper bounds of the fits (560 B per part covers the 400k pile, whose
dynamic bodies cost more than a static world's).

| Parts | Sparse world (≈ 0.67 contacts/part) | Dense pile (≈ 5.2) | Old (dense) |
|---|---|---|---|
| 2,001 | 192 | 192 | 320 |
| 5,000 | 256 | 256 | 320 |
| 20,000 | 640 | 704 | 384 |
| 50,000 | 1,280 | 1,600 | 640 |
| 100,000 | 1,920 | 2,560 | 1,024 |
| 400,000 | 3,072 | 3,712 | 1,408 |
| ≥ ≈ 480,000 | 4,032 (cap) | 4,032 (cap) | — |
| 1,000,000 | 4,032 (needs 7,488) | 4,032 (needs 7,552) | 2,176 |

**Sleeping worlds:** small worlds get less than before (the old 256 MB floor was a guess; 192 MB at 2k–4k parts is
3× their measured all-awake need). Big worlds get more. What that costs a 16 GB machine, measured on Windows (V8): a
fixed WASM heap is **committed** at its full size (a 4,032 MB heap: 4,127 MB private bytes) but only what's touched is
resident (85 MB working set right after load). A settled 100k-part world touches ≈ 0.35 GB with its ring full
(build 192 MB + 12 checkpoints × 12 MB); the same count all awake 2.1 GB. So the cost of sizing for the worst case is
commit charge (RAM + page file), not RAM in use. The threaded worker still rounds its heap up to a power of two (a
threaded module's memory isn't freed on reload), so any heap over 2 GB becomes 4 GB there.

**Above 4 GB the worst case can't fit** (≈ 480k parts and up; at 1M parts the model's cap holds ≈ 0.4M awake bodies).
Those runs work until they really run out, and then stop cleanly (below).

## Running out: the sim worker and run.ts

Measured first: an `Aborted(OOM)` is **catchable** in both builds. It throws a `WebAssembly.RuntimeError` from the calling
thread, at the allocation that failed (every one hit was a checkpoint's recorder growing on the worker's own thread;
Jolt's step allocates from its fixed temp allocator). After it the module's memory is in an unknown state.

- **Before:** `loop()` (a `setInterval`) had no try/catch: an abort became an uncaught error every 8 ms, the main thread
  had no `onerror`, and the run sat frozen with no message.
- **`sim.worker.ts`:** the loop is wrapped; an exception out of a step, a start, a rollback re-bake or a re-sync calls
  `fatal()`: stop the loop, drop the Machine **without** calling into the module (`destroy()` on a dead module could trap),
  drop the module (`Jolt = null`, so the next start loads a fresh one), and post
  `{ type: 'error', fatal: { kind: 'oom' | 'abort' | 'error', runId, tick, awake, heapMB } }`.
- **`run.ts`:** `simFailed()` terminates the worker and makes a new one (so the next run gets fresh memory: a threaded
  module's shared heap is only freed when its worker goes; nested pthread workers die with it), resets to Build, sends
  `run.stop` in multiplayer (a partner's run can't stay in step without ours), and toasts, at error level (assertive live
  region): "This machine ran out of physics memory (4,032 MB at 41.2 s, 380,000 bodies awake). The run stopped: try
  fewer parts moving at once." Other aborts: "The simulation failed at … and the run stopped (…)". The worker also gets
  an `onerror` that toasts anything uncaught.
- **New helpers** in `@knockon/jolt`: `isJoltAbort`, `isJoltOom`, `joltHeapHighWater`, `joltHeapBytes`.
- **Not covered:** an allocation failing on one of Jolt's job threads would abort in a pthread worker, not on the calling
  thread, and the step would wait on it. None of the measured OOMs happened there (Jolt's step uses its preallocated temp
  allocator); a main-thread watchdog on the frame stream would be the guard if it ever does.

## Determinism

The heap size never changes results (`packages/sim/test/heap.test.ts`):
- A 1,500-part awake pile hashes the same, every 30 ticks for 2 s, on the stock 128 MB build, the patched build at
  512 MB and 4,032 MB, and the threaded build (4 threads) at 256 MB and 2,048 MB.
- A 2,101-part world (in-heap checkpoints) with a late poke, rolled back on a 3,072 MB heap, ends identical to the
  straight run on its `joltHeapMB` heap.
- The goldens are untouched and pass; `threads.test.ts` passes (127 tests; Kiloton now loads a 192 MB heap).

**Found while checking (not heap): the threaded build isn't deterministic on T5's domino world past ≈ 20 s.** Two
threaded runs (8 threads) at the **same** 2,176 MB heap, same arguments, hash the same for 20 s and then diverge at
21 s (awake 117,949 vs 117,738; 620 vs 486 Impact events by 24 s), just as the first impacts arrive. A run at 4,000 MB
diverged from one at 2,176 MB at the same second, so the heap isn't the cause. `Machine.contactPeak` stays far under the
buffer (≤ 3,174 of 231,936), so it isn't the A3 contact-overflow case either. Reported below (found 1).

## Tests

- `packages/parts-data/test/heap.test.ts` (5): the 128 MB floor, 64 MB steps, monotonic in parts and contacts, the cap,
  the formula's numbers, every measured peak covered with ≥ 15 %, small worlds smaller and big ones bigger than before.
- `packages/sim/test/heap.test.ts` (4): the two determinism tests above; a 20k-part pile all awake (18.7k) with the ring
  full of awake checkpoints and a desync export on top stays under 90 % of its `joltHeapMB` (≈ 11 s); and **86k parts,
  80,634 awake (past the old OOM point) in its new 2,432 MB heap: high-water 1,534 MB** (≈ 43 s with 12 threads, under
  the 60 s budget, so it's a unit test).
- `apps/game/test/simworker-oom.test.ts` (1): the real sim worker in Node, its heap forced to the stock 128 MB, an
  8k-part pile: one fatal `oom` error for that run (at tick 540, 7,418 awake), no more messages, and the next start
  loads a fresh module and bakes (≈ 50 s).
- `pnpm -s vitest run packages/sim packages/parts-data apps/game`: **50 files, 783 tests, all pass.** `pnpm -s typecheck`
  and the bench typecheck clean; `pnpm -s lint` (determinism) clean.

## Files

| File | Change |
|---|---|
| `packages/parts-data/src/presets.ts` | `joltHeapMB` rewritten on the measured model; `joltHeapNeedMB`, `JOLT_HEAP_MAX_MB`, `JOLT_AWAKE_STATE_BYTES` |
| `packages/jolt/src/load.ts`, `index.ts` | `joltHeapHighWater`, `joltHeapBytes`, `isJoltAbort`, `isJoltOom` |
| `apps/game/src/sim.worker.ts` | `fatal()`; the loop and the message handler catch; `error.fatal` in `FromWorker` |
| `apps/game/src/run.ts` | `newWorker()`, `simFailed()`: stop, replace the worker, toast; worker `onerror` |
| `apps/game/bench/sim-bench.ts` | `--heap`, `--cp`, `--keep`; high-water, live max, contact peak, abort report; the worker's heap by default |
| `apps/game/bench/heap-bench.ts` | new: build / checkpoint calibration |
| tests | `packages/parts-data/test/heap.test.ts`, `packages/sim/test/heap.test.ts`, `apps/game/test/simworker-oom.test.ts` |
| docs | SIMULATION §4.1 (heap row; the threaded build's heap is fixed, not growable), §11 (in-heap checkpoints over 2,000 parts, not 20k; awake checkpoint cost; the fatal-run path); GAME_SPEC §15.2 System RAM |

## Found (other streams' files: reported, not fixed)

1. **Threaded Jolt diverges run to run on T5's 154k-part domino world after ≈ 20 s** (D89 says results never depend on
   threads). Repro: run `node --disable-warning=ExperimentalWarning apps/game/bench/sim-bench.ts domino 24 153600 512 1.5 0 --heap=2176 --threads=8`
   twice and compare the `hashes:` lines. They match through 20 s and differ from 21 s. In multiplayer that's a desync on
   big chain reactions, and a threaded bake won't match a single-threaded partner. Not chased further (it costs ≈ 3 min per run;
   the single-threaded comparison would take ≈ 30 min). Owner: J4 / sim.
2. **`contactEstimate` throws on a 1M-part world** (`packages/sim/src/capacity.ts`): `bigWorld(1_000_000)` overflows its
   cell `Map` ("RangeError: Map maximum size exceeded", > 2^24 cells). The Machine and the worker call it at every start,
   so the 16 GB tier's 1M-part cap can't start a run (with J5 the worker reports it and the run stops; before, the run
   hung in the countdown). A numeric cell key or a sort-based sweep would fix it. Owner: sim (A3's code).
3. **`checkpointPlan` sizes the ring at 201 B per body** (≈ 256 MB budget) while an awake body takes ≈ 600 B (≈ 1.2 KB in the
   heap). J5 sizes the heap for it rather than changing the keep counts (which would change rollback windows). If memory
   matters more than the window, keeping fewer awake checkpoints, or holding them deflated in JS, would cut the ring 5×.
4. **The threaded worker rounds heaps up to a power of two** (`sim.worker.ts`), so every heap over 2 GB commits 4 GB.
   Since J5 replaces the worker after a failure, the same could be done on a world change that needs a bigger heap,
   dropping the rounding.
5. SIMULATION §4.1 said the threaded build has "a growable heap": it's fixed (corrected here).
