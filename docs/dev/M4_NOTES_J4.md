# M4 notes: J4 · multithreaded Jolt + sim leftovers

Stream J4 of [M4_PLAN.md](M4_PLAN.md): multithreaded Jolt (D89, M0 known gap 2), the buffered contact path, the
thread-count harness, and the Megastructure dressing colliders. Measured on the test system (Intel Core Ultra 9 285K,
24 cores; RTX 5090; Windows 11; Node 24.2; Chrome 155.0.8059.86 headless and the desktop pane's Chromium 152) with the
method next to each number (M4_PLAN rule 7). Twelve other streams shared the CPU throughout: timings are provisional,
with the CPU load sampled before each run.

## Status

**Multithreaded Jolt ships.** The sim worker uses the published `jolt-physics` multithreaded build (WASM threads +
SIMD) whenever it is cross-origin isolated, with `hardwareConcurrency − 3` worker threads clamped to 2..12
(SIMULATION §4.1), and the single-threaded build otherwise. Results are hash-identical to the single-threaded build
at 1, 4 and 12 threads, in Node and in Chrome, and between them. Every existing golden is unchanged; none was re-pinned.

**D89 status: done.** Kiloton and Domino Day now simulate in real time on average at 1 worker thread or more, and Domino
Day in its worst second from 4 threads. Kiloton's blast second stays at the 7.5 ms budget from 8 threads (7.1 ms in
Node, 9.5 ms in Chrome at 12). Bake & Watch stays as the fallback for bigger machines and for non-isolated pages.

## 1. What the published build allows (no rebuild needed)

- **The plain listener can't run on Jolt's threads.** Contact callbacks come from whichever thread runs the narrow
  phase. A `ContactListenerJS` made on the sim thread exists only in that thread's JS heap; on a pthread the glue's
  JSImplementation lookup (`Module.getCache(ContactListenerJS)[ptr]`) is undefined and `Step` aborts with `unwind`.
  Reproduced: the M0 box-tower scene with a counting listener aborts at 4 worker threads.
- **The build has a hook for it.** The multithreaded glue (JoltPhysics.js 1.1.1) has
  `Module.configureWorkerScripts(url, params)`. Every Jolt thread imports `url` when it starts and calls its default
  export with its own Module and `params`. The callbacks are installed on every thread that way. Measured: the same
  scene counts 140,320 callbacks at 0 and at 4 worker threads, with no abort.
- **No post-step contact query exists in the bindings.** There is no contact-constraint or per-body contact iteration in
  the IDL, only `WereBodiesInContact`, so the records are gathered during the step, not queried after it.
- **Heap.** The multithreaded glue makes a fixed 128 MB shared memory (`new WebAssembly.Memory({initial: 2048,
  maximum: 2048, shared})`), which `Module` can't override. While the glue starts, `loadJolt('multi', {heapMB})` wraps
  `WebAssembly.Memory` so that one call makes the heap's size, and rewrites the binary's memory import to match. This is
  the same code, so the results are the same (the S3 single-build heap patch works the same way). Headroom: +32 MB
  plus 2 MB per worker thread. Measured: ~0.7 MB of Jolt heap per thread per Machine (2,100-BRIK stack: 56 MB single,
  57 / 60 / 68 MB at 1 / 4 / 12 threads).
- `JPH_CROSS_PLATFORM_DETERMINISTIC` is still off in the published build (M0 known gap 1). That only matters for a
  future native build. WASM-to-WASM determinism holds (below).

So nothing needs a toolchain download. If a rebuild is ever wanted, for cross-platform determinism or a bigger
`mTempAllocatorSize` binding, it needs emscripten + cmake (`build.sh -DCROSS_PLATFORM_DETERMINISTIC=ON`): a producer
decision, not needed for M4.

## 2. The buffered contact path

`packages/jolt/src/contact-script.js` (the callbacks, one copy for every thread), `contacts.ts` (layouts, script URL),
`packages/sim/src/contactbuf.ts` (`ContactBuffer`), and small marked edits in `machine.ts` (`J4`).

- **During the step, on any thread**, the callback:
  - reads the two bodies and the manifold;
  - sets a TREADWAY's `mRelativeLinearSurfaceVelocity` from a per-body table the sim thread writes before each step:
    f32(dir × speed), negated for body 1 (exactly M1's value, since f32(−x) = −f32(x));
  - skips persisted contacts nobody reads (a per-body flag, plus the global `persistAny`);
  - appends a 20-word record to a buffer in the WASM heap, claiming the slot with `Atomics.add`. The record holds the
    bodies, added/persisted, the sub-shape ids, both velocities, the normal, both inverse masses, the contact point
    and `seq`.
- **After the step, on the sim thread**, `ContactBuffer.gather` sorts the records. The order is (lower body index,
  higher body index, added, `seq`, sub-shapes, then the record's own bits), a total order on content. Then it feeds the
  critters' hook and the contact stage, with the impulse estimate computed exactly as before
  (`mred × |vn|`, same f64 operations on the same f32 inputs).
- **`seq` keeps the goldens.** The contact stage's old stable sort keyed only (pair, added). Ties, meaning several
  sub-shape manifolds of one body pair in one step (a GLINT on a SLOPE's compound, TUBE staves), kept Jolt's callback
  order. Sorting ties by sub-shape id instead changed `glint` and `snaptrap` (5071e9e2… → bf1c007e…): a GLINT's spin
  comes from its last contact. Jolt reports all of a body pair's manifolds from one `ProcessBodyPair` call, on one
  thread, in an order that doesn't depend on threads. So each thread numbers a pair's consecutive callbacks (reset per
  step), and that recovers the single-threaded order exactly. Measured on `glint`: 8 tied steps, all reproduced.
  Residual risk: a CCD callback for the same body pair, but a different sub-shape pair, on a different thread in the
  same step would tie on `seq` and fall back to sub-shape order. None seen in any test, soak or benchmark.
- **Overflow:** capacity is Jolt's contact-constraint capacity + 1,024. Past it, the extra records are counted and lost,
  and later steps get room (`ContactBuffer.overflows`, a diagnostic like `contactPeak`). That takes a step past Jolt's
  own buffer, which A3 already sized against.
- **CSP (high priority from the orchestrator, fixed):** the worker script was a `data:` URL at first, and the Host
  Server's CSP (`script-src 'self' 'wasm-unsafe-eval'`) blocked it. It is now a same-origin file.
  `new URL('./contact-script.js?no-inline', import.meta.url)`; `?no-inline` because Vite inlined the 4 KB file as a
  `data:` URL. Checked in a scratch production build of the thread-matrix page served by a local test server
  (:8809, real headers): `assets/contact-script-<hash>.js` emitted, 0 CSP violations, MT runs hash-identical. Also
  checked: the game itself under Vite with the host's exact headers (`SECURITY_HEADERS` imported) in Chrome 155. The
  sim worker logged `[sim] Jolt: multithreaded, 12 worker threads`, a run played (playhead 0.00 → 11.15 s over 11 s,
  final code), and the only CSP report was msgpackr's `eval` feature probe (pre-existing, not Jolt). The loader no
  longer evaluates any script from text.
- **Never stall a run (high priority from the orchestrator, after MI's report; fixed).**
  - What happened: the threaded glue starts a pool of 16 pthread workers at load and resolves only once all of them
    have loaded. In the desktop pane's Chromium 152, with the game's Vite config as shipped (HMR on), those workers fail
    to load. The console shows 16 × "worker sent an error! undefined:undefined" and "Uncaught [object Event]", and
    `loadJolt` never resolved, so the run never got `ready`.
  - Where it works: the same server works in Chrome 155, and the pane works with HMR off (`bench/vite.config.ts`).
    Likely cause: Vite injects `/@vite/client` into each transformed pthread worker (`?worker_file`), and the pane
    can't load 16 of them. Not reproducible in Chrome.
  - Now: `loadJolt('multi')` gives the pool a 10 s deadline. It then checks that every requested worker thread really
    starts: a throwaway `JoltInterface` whose pthreads count themselves in a control word from `contact-script.js`.
    Normal cost: 250–300 ms in Node.
  - On failure it throws. The sim worker then logs `[sim] Jolt worker threads unavailable (…); using the
    single-threaded build`, loads the single build, and stays single for its lifetime. A failed probe is never
    destroyed, because joining threads that never started would hang. The pthread workers' error events are cancelled,
    so they don't surface as uncaught errors.
  - Verified in the pane (HMR on): the bench reports the deadline error after 10 s, and the game's sim worker falls back
    and logs `single-threaded`. Worst case for such a browser is a 10 s delay before its first run, then the pre-J4
    path.

## 3. Determinism evidence (thread-count hash matrix)

| Check | Single build | MT 1 thread | MT 4 | MT 12 | How |
|---|---|---|---|---|---|
| All 111 Library demo machines (every part golden's world): hash every 30 ticks + full event stream | ref | = | = | = | `packages/sim/test/threads.test.ts` |
| Kiloton, 1.5 s (fortress settling, > 5,000 contacts a step) | ref | = | = | = | same |
| Rollback: late poke on a breaking machine, restore + resim vs straight run | — | — | — | = (straight run on the single build) | same |
| Checkpoint exported by the single build → continued threaded (4) → exported → continued single | = | | = | | same |
| Whole sim suite (goldens M1–M4, fuzz, rollback, critters, terrain, Matter host) with `KNOCKON_JOLT_THREADS=N`, final code | 484 / 488 (with jolt, parts-data, host) | 355 / 359 | 356 / 360 | 356 / 360 | the same 4 failures everywhere, all other streams' in-progress Matter tests (m4_matter SPONGE / TANK / WATERWHEEL, matter_sandstorm); earlier runs also showed A4/B4 fuzz-scene and card gaps, identical across builds |
| Kiloton 20 s: per-second hashes, Node | `12c59e5f…` | = | = | = (also 0 and 8) | `sim-bench.ts kiloton 20 [--threads=N]` |
| Domino Day 60 s: per-second hashes, Node | `138ec263…` | = | = | = (also 0 and 8) | `sim-bench.ts domino 60` |
| Kiloton / Domino Day 20 s, Chrome 155 (prod build, real host headers) | = Node | = | = | = | `bench/j4/` via headless Chrome; all 20 per-second hashes equal Node's |
| M0 spike `d36267ef85945df9` | = | | | | unchanged |

The first full threaded-suite run hit `Aborted(OOM)` in `rollback_contacts` (two 2,100-BRIK machines in one 128 MB
heap): the reason for the per-thread headroom above. With it, the test passes at 12 threads.

## 4. Timings: do they simulate in real time? (budget 7.5 ms per tick, SIMULATION §12)

**Node** (`node apps/game/bench/sim-bench.ts kiloton 20 | domino 60 [--threads=N]`; `--threads=0` = the threaded
build with no worker threads, which isolates the build's SIMD from the threading). Mean, p95 and the worst 1 s window,
in ms per tick. Second pass; CPU load before each run in brackets (other streams' soaks and tests).

| Kiloton (3,917 parts) | single [69 %] | MT 0 [71 %] | MT 1 [72 %] | MT 4 [34 %] | MT 8 [28 %] | MT 12 [66 %] |
|---|---|---|---|---|---|---|
| mean | 23.8 | 8.75 | 4.86 | 2.74 | **2.28** | 4.72 |
| p95 | 71.7 | 27.0 | 13.8 | 8.98 | 7.33 | 17.3 |
| worst 1 s (the blast, t = 4 s) | 87.6 | 30.2 | 15.6 | 8.54 | **7.14** | 16.7 |

| Domino Day (102,560 parts, 60 s) | single [88 %] | MT 0 [82 %] | MT 1 [56 %] | MT 4 [27 %] | MT 8 [47 %] | MT 12 [43 %] |
|---|---|---|---|---|---|---|
| mean | 12.8 | 7.95 | 4.18 | 2.14 | **1.62** | 1.64 |
| p95 | 29.4 | 18.7 | 8.54 | 3.98 | 2.78 | 2.72 |
| worst 1 s | 27.7 | 16.7 | 8.37 | 4.07 | 3.02 | **2.99** |

**Chrome 155** (headless, production build of `bench/j4/` on a local test server, one dedicated worker per run like
the sim worker, 20 s each):

| | single | MT 1 | MT 4 | MT 12 |
|---|---|---|---|---|
| Kiloton mean / p95 / worst 1 s | 22.1 / 71.6 / 76.5 | 5.20 / 16.1 / 16.5 | 2.86 / 10.1 / 9.73 | **2.67 / 8.44 / 9.49** |
| Kiloton time inside `Jolt.Step` | 96 % | 84 % | 75 % | 71 % |
| Domino Day mean / p95 / worst 1 s | 14.0 / 31.6 / 29.3 | 4.52 / 9.88 / 8.55 | 2.24 / 4.18 / 3.96 | **1.51 / 2.63 / 2.68** |

Reading them:
- The threaded build is 1.6–2.7× faster with no worker threads at all (SIMD), and 3–4× more from 4–8 threads.
- **Domino Day is real time from 4 threads**, worst second included. **Kiloton is real time on average from 1 thread**,
  and its blast second fits the budget at 8 threads in Node (7.1 ms) but not quite at 12 in Chrome (9.5 ms).
- The 12-thread Node Kiloton run was slower than 8 because of contention (66 % CPU before it started). The S3
  single-build baseline was 13.9 / 9.0 ms on a quieter machine; today's single-build numbers are 1.4–1.7× that, so all
  absolute numbers here are pessimistic.
- With threads, the JS share of a tick grows (Kiloton 29 % outside `Step` at 12 threads, Step share 71 %). The gather
  sort and the contact stage are the next cost if the blast second needs to drop further.

## 5. Megastructure dressing colliders

- `apps/game/bench/gen-env-backlot.ts` now also writes `BACKLOT.megastructure` (+ `BACKLOT.megaLift`) into
  `packages/parts-data/src/env_backlot.ts`.
  - E3b placed the dressing on the Arena lot, each piece at the lowest ground over its footprint ("Arena = Mega origin").
  - On Mega, each placement is lifted by its footprint's lowest Mega ground minus its lowest Arena ground (the boxes'
    x/z bounds, ≤ 0.25 m grid on both `defaultTerrain` lots), so pieces keep the footing they have on the Arena.
  - On the flat pads that is exactly the pad difference: the water tower goes up 12.28 m, its legs on the Mega pad as on
    the Arena pad. Lifts run 2.8–17.4 m.
  - The Arena block is byte-identical to before.
- `machine.ts`: Backlot + Megastructure builds that set through `buildSet`, the same static-set path as the Kitchen,
  the Tinker Lab and the Arena.
- Test `packages/sim/test/backlot_mega.test.ts`:
  - the Mega set is the Arena set lifted (same names, materials, x/z and half extents);
  - the water tower's legs sit on the pad the same way;
  - in the Machine, a ball dropped on the tank stops on it (≈ 45.9 m);
  - a ball on the plateau rests on the heightfield;
  - two runs are identical.
- **For R4 / the renderer:** the dressing art isn't drawn by the game yet. When it is, seat Mega placements with
  `BACKLOT.megaLift` ([placement index in backlot.json, metres]) so the art matches the colliders.
- Like the Arena set, the boxes sit on the *default* lot: sculpting under a piece doesn't move it.

## 6. Soaks with the threaded path (`KNOCKON_JOLT_THREADS=N`)

- **2-player soak, 10 min, 8 threads** (`apps/host/soak/soak.ts --minutes 10 --port 8809`): **PASS**.
  - 15 runs, 75,410 ticks, 1,170 / 1,170 hash checks;
  - 240 pokes (30 % late), 79 / 79 rollbacks;
  - 0 desyncs, 0 resyncs, 0 errors.
- **Critter soak, 5–6 min each:**

  | Run | Threads | Seeds | Failures |
  |---|---|---|---|
  | 1 | 8 | 1–53 | **1**: seed 48, "rollback run C diverged at hash #81 (late poke at tick 4424)" |
  | 2 | 8 | 1–51 | 0 |
  | 3 | 12 | 1–51 | 0 |
  | 4 | 4 | 30–117 | 0 |
  | single build, same period | — | 72 runs | 0 |
  | seed 48 alone | 4, 12 | 6 × each | 0 |

  The one failure didn't reproduce in 190 further threaded runs: seeds 1–51 twice, seed 48 alone 12 times. B4 was
  editing the critter code during that window. It is recorded as an open issue, not explained.

## 7. Host WebSocket frame cap (asked by MI)

`apps/host/src/server.ts`: the `/ws` server's `maxPayload` was net's `MAX_MESSAGE_BYTES` (4 MB, ~150k grains of a
desync-repair checkpoint). It is now `wsMaxPayload()`: 64 MB by default, `KNOCKON_WS_MAX_MB` overrides, never below
net's limit. Sessions are private isolated test network links. **MI still needs to raise `@knockon/net` `MAX_MESSAGE_BYTES`**: it is
also `decodeClient`'s default limit (session.ts) and the source of `MAX_CHECKPOINT_BYTES` (sim.worker), so frames over
4 MB still fail to decode until net matches.

## Files

| File | What |
|---|---|
| `packages/jolt/src/load.ts` | `loadJolt('multi', {heapMB, threads})`: the `wasm-multithread` build with any heap, a load deadline and a thread start check; `joltThreads()`, `joltIsThreaded()`; `KNOCKON_JOLT_THREADS=N` (Node) turns single loads into threaded ones (tests, soaks, benches) |
| `apps/host/src/server.ts` (shared) | `wsMaxPayload()`: the `/ws` frame cap, 64 MB (§7) |
| `packages/jolt/src/contact-script.js` + `.d.ts` | the contact callbacks (every thread) |
| `packages/jolt/src/contacts.ts`, `index.ts` | record and control layouts, the script URL, exports |
| `packages/sim/src/contactbuf.ts` (new) | `ContactBuffer`: body tables, gather, canonical sort |
| `packages/sim/src/machine.ts` (shared) | `J4`-marked: buffer before `JoltInterface`, thread count from the module, `syncContactTables` / `gatherContacts` around `Step`, Megastructure set, destroy |
| `apps/game/src/sim.worker.ts` (shared) | threaded build when isolated (`hardwareConcurrency − 3`, 2..12); falls back to single for good if the threads don't start; `start.joltThreads` override (0 = single); heap rounded to powers of two for the threaded build; one `[sim] Jolt: …` console line |
| `apps/game/bench/sim-bench.ts` | `--threads=N`; per-second hashes in the result |
| `apps/game/bench/j4/` (new) | the in-browser thread matrix (`/bench/j4/?scene=kiloton,domino&seconds=20&threads=0,1,4,12`) |
| `apps/game/bench/gen-env-backlot.ts`, `packages/parts-data/src/env_backlot.ts` | Megastructure dressing set |
| `packages/sim/test/threads.test.ts`, `backlot_mega.test.ts` (new) | the matrix, and the Mega set |
| `.claude/launch.json` | `j4-bench` (Vite :5209) |

The host's headers needed no change for threads: COOP/COEP/CORP and the CSP already allow SharedArrayBuffer, module
workers (`worker-src 'self'`) and WASM (`'wasm-unsafe-eval'`), as long as nothing loads a `data:`/`blob:` script.

## Open issues

1. **A threaded heap is never freed inside one sim worker.** Emscripten's idle pthread workers hold the shared memory
   after a reload, and the glue exposes no way to terminate them. Mitigation: the threaded heap grows in powers of two,
   so there are at most ~5 reloads per worker. A real fix is for `run.ts` (C4 / MI) to recreate the sim worker when the
   heap must grow.
2. **The thread count isn't a setting yet.** `ToWorker.start.joltThreads` exists (0 = single build); U4 could expose it
   in Settings › Performance. `run.ts` doesn't send it today.
3. **CCD tie residual** (§2): theoretical, unobserved.
4. **Kiloton's blast second** is 7.1–9.5 ms at 8–12 threads, at or over budget. Next: profile the JS share (gather sort,
   contact stage, 5,617 mortar joints' breakage checks).
5. **The critter soak's single unreproduced divergence** (§6, seed 48, run 1 of 4 threaded soaks). If it recurs, run
   the same seeds on the single build to separate a threading issue from a critter or rollback issue.
6. **Dev in the desktop pane with HMR on runs single-threaded**: the pthread workers don't load there (§2). Chrome is
   threaded in dev and in production; the pane is threaded with HMR off.
7. SIMULATION §4.5 describes per-thread arrays and an impulse "from the previous tick's cache". The shipped design is
   one atomic-indexed buffer with the impulse estimate from the callback-time velocities, unchanged from M1. The doc
   owner may want to align the text.

## Other streams' issues seen (reported, not fixed)

- **MI:** `packages/sim/src/matter/link.ts` briefly used a TypeScript parameter property (`constructor(private readonly
  be…)`), which Node's type stripping rejects. That broke every plain-`node` entry point that imports the sim:
  `sim-bench.ts`, both soaks, and the host. It was fixed by the time of the final runs.
- **A4 / B4** (in progress during the runs): `fuzz.test.ts` has no fuzz scenes for grit_hopper, hourglass, tank,
  sprinkle_can, sponge, marble_hopper, zippy, toast_cannon, henny and dusty. The `dusty.needs` card text is 63 > 60
  characters. Typecheck errors appeared in `defs_m4.ts` (`'matter'` not a `Family`) and `critters.test.ts` (Species
  record). The same on the single build.
- **Late in the session, still open:**
  - `pnpm lint` flags `Math.hypot` in `packages/sim/src/matter/host.ts:370` (MI).
  - `m4_matter.test.ts` (SPONGE, TANK → TANK, WATERWHEEL) and `matter_sandstorm.test.ts` fail behaviour assertions on
    the single build: water doesn't move parts (A4 / MX / MI, in progress).
  - Matter's GPU path logs WebGPU validation errors in the game: `matter.params0` binding size 48 < 64 (MX / R4).
- An orphaned `vitest run packages/sim` from 21:51, possibly my own stopped first run, was still alive. Killing it was
  refused by the permission layer, so I left it.

## How to run

```bash
npx vitest run packages/sim/test/threads.test.ts                       # the matrix (≈ 40 s)
KNOCKON_JOLT_THREADS=12 npx vitest run packages/sim                    # the whole sim suite threaded
node --disable-warning=ExperimentalWarning apps/game/bench/sim-bench.ts kiloton 20 --threads=8
KNOCKON_JOLT_THREADS=8 node --disable-warning=ExperimentalWarning apps/host/soak/soak.ts --minutes 10 --port 8809
cd apps/game && npx vite --config bench/vite.config.ts --port 5209    # → http://localhost:5209/bench/j4/
node --disable-warning=ExperimentalWarning apps/game/bench/gen-env-backlot.ts   # regenerate env_backlot.ts
```
