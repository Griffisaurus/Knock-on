# M4 notes: MX · Matter core

Stream MX owns `packages/matter/**` and `tools/vendor-matrix/**`. Plan: [M4_PLAN.md](M4_PLAN.md) contracts 1, 3 and 6.

Status: **done** (2026-10-25). Exit matrix: **PASS** ([M4_SANDSTORM_MATRIX.md](M4_SANDSTORM_MATRIX.md)).

## Published: `packages/matter/src/backend.ts` (2026-10-24, first working hour)

The contract-1 interface, exactly as in M4_PLAN, plus these optional/additive members:

- `MatterStepOut.bounds?: Int32Array` (MI request 2): live-particle min xyz, max xyz in units after the tick (zeros when empty). Both backends fill it.
- `MatterBackendSync` (MI request 1): `initSync`, `stepSync`, `snapshotSync`, `restoreSync`. `MatterCpu` implements it.
- `MatterConfig` (named type for the `init` argument) and `MatterView` (the `view()` result; adds `state: GPUBuffer` whose word 0 is the GPU-resident live count, for indirect draws).
- Constants: `UNITS_PER_METRE`, `MATTER_HZ`, `Q14`, `ANG_SCALE`, `KIND_*`, `IMPULSE_LIN_NS`, `IMPULSE_ANG_NMS`, `MATR_*`.

Conventions (MI request 3: all of MI's assumptions are confirmed): `ang` = rad per Matter tick × 65,536; `rot` = Q14 (x, y, z, w); sphere `[r,0,0]`, capsule `[r, halfLength, 0]` along local +Y, obb half extents, plane = point `pos` with normal local +Y (solid below); impulse `ang` about the proxy `pos`; ids are opaque. **Impulse units:** `lin` × `IMPULSE_LIN_NS` (0.9375 µN·s) = N·s; `ang` × `IMPULSE_ANG_NMS` = N·m·s. Impulses are reported only for `dynamic` proxies, in input order. Emit, intake, blast and kill semantics are spelled out at the top of `backend.ts`.

Usage in Node:

```ts
import { MatterCpu } from '@knockon/matter';
const be = new MatterCpu();
be.initSync({ capacity: 20000, seed: 1 });
const out = be.stepSync({ tick: 1, proxies, emits, intakes: [], blasts: [] });
```

The browser backend is `MatterGpu` from `@knockon/matter/gpu`: `const be = new MatterGpu(device); await be.init({ capacity, seed })`. It runs on the device you pass (D92: the renderer's), needs only default WebGPU limits up to 8M particles, keeps the live count GPU-resident (indirect dispatches), and lets ticks be queued back to back (each `step()` promise resolves when that tick's results are read back). `view()` returns the canonical `pos`/`vel`/`mat` buffers (layouts in `MatterView`), `count` after the last completed step, and `state` (word 0 = live count of the newest submitted tick, for indirect draws).

**Capacity must come from the machine, not the device** (GAME_SPEC §6.3 rule 5): the particle order, and so the outcome, never depends on capacity, but emit truncation at capacity does.

## QUACK fling (A4 report via the orchestrator): fixed in the solver, 2026-10-24

**Cause (backend side, two bugs).** Proxy impulses booked every position push as momentum (−m × push per Jacobi iteration):
1. Pushing a particle out of a deep or *trapped* overlap (water between a resting body and the floor: the floor plane pushes it up, the body pushes it down, every iteration) was booked as impulse. Measured ≈ 36 mN·s per trapped particle per tick; 30 particles → a 30 m/s kick for a 40 g body.
2. The same approach was re-booked in every Jacobi iteration (3 per substep).

**Fix (CPU and GPU, still bit-exact).** A proxy contact now books only the particle's normal *approach* relative to the moving surface (particle displacement since the substep start minus the surface's own displacement v + ω × r, capped at the penetration), at most once per particle per substep (a per-particle budget), plus the friction displacement. Position repair is no longer momentum. A4's QUACK scene in the real Machine now runs 4 s with the duck steady at y ≈ 40 mm (it was thrown ≈ 0.9 m at 1.5 s); A4's existing QUACK test still passes.

**Still open — needs MI (coupling side), not fixable in the backend:**
- **Latency loop:** with SIMULATION §8.5's fixed latency the backend sees a body's pose from 2 Matter ticks back and its impulse lands 2 Matter ticks later, so a light, stiffly coupled body (QUACK: 40 g, 400 cm³) can still get impulses for motion it no longer has (e.g. 4 ticks of "still falling" after it landed). In my standalone repro (scratch mini-integrator, drop onto standing water) single impulses still reach several m/s for a 40 g body. Recommendation for MI: a per-body limiter when applying a Matter impulse, e.g. clamp so the Matter Δv can at most cancel the body's velocity relative to the fluid plus a small bound (≈ 1 m/s); the backend can't do this because it doesn't know body mass.
- **Buoyancy is weak:** the position-based fluid exerts almost no hydrostatic pressure on a resting surface. Measured with a box held at 15 mm submersion in settled water: the time-averaged impulse is 4 % of ρ·g·V (the old accounting gave 7 %, and the old QUACK "float" came mostly from the trapped-particle bug). Impact and flow impulses (a stream turning a WATERWHEEL, sand hitting paddles) are fine. Floating parts (QUACK, SPONGE) need either a boundary-pressure term from the fluid (I'm looking at it; it would change goldens) or a host-side buoyancy model. Tracked below.

## Free-flight regression (MI report, 2026-10-24 23:27 → fixed 2026-10-25)

- **Cause:** an "energy guard" I added at 23:2x (contacts may not raise a particle's speed above its predicted speed) clamped each particle's speed. That doesn't conserve momentum: the internal pressure jitter of a moving water blob (or a flowing sand bed) bled its common velocity (MI: 200 particles at 1 m/s travelled 0.07 m in 0.33 s). It broke A4's TANK→TANK, SPONGE, WATERWHEEL and MI's matter_sandstorm.
- **Fix:** the guard is gone. It was a workaround for a slab of sand "erupting" after landing, whose real cause was the stacking rule (below), now fixed. Two friction experiments from the same hour (a cap on the Coulomb normal measure, kinetic friction split across iterations) also made sand slide out of WATERWHEEL buckets (MI's wheel turned −0.015 rad instead of < −0.3); both are reverted, friction is back to the original law.
- **Regression test:** `test/matter.test.ts` "free flight": a thrown particle flies 0.226 m / falls 0.419 m in 19 ticks (1 m/s, SIMULATION's air damping), and a thrown 200-particle water blob and sand blob fly the same arc (± 1 cm). The GPU proof runs the same "ballistic" scene (GPU = CPU every tick).
- **Re-run:** A4's `m4_matter.test.ts` (7/7) and MI's `matter_sandstorm.test.ts` pass on the current kernels, unchanged (wheel −1.05 rad in my probe of MI's world).

## Solver changes since the first GPU proof (all CPU = GPU, goldens re-pinned 2026-10-25)

- **Stacking rule (shock propagation):** a same-kind pair counts as stacked (upper particle takes 3/4) only when its contact normal is within 45° of vertical. The old rule (height difference > 65 units) made same-layer neighbours on a slope count as stacked; in a compressed bed that pushed mass upslope every substep (the 4M Sandstorm bed crept *up* the 36° slope into the back wall) and, landing, made a dropped slab erupt.
- **Impulse booking (QUACK):** only the normal approach relative to the moving surface, at most once per particle per substep, and only for dynamic proxies (see the QUACK section).
- **Coincident particles** (d = 0) separate horizontally along a pair-hashed axis (they used to separate along ±y, i.e. into the floor, and never parted).
- **Contact maths:** one division per contact (k = pen·w·256/d, sign-symmetric shifts) and an exact `isqrt` start from the top bit pair: same physics, cheaper kernels.
- **Cell keys:** hashed rows (16-cell x runs kept contiguous, the rest hashed into a 2^23-key sand table) instead of the M0 modular key, which aliased 3.4–4.6× more candidate cells at 1M–4M grains.

## Contract addition: water-surface map (D101, 2026-10-25)

`MatterStepIn.surface?: { x0, z0, cell, nx, nz }` (units; cell 256 … 2^20, nx·nz ≤ `MAX_SURFACE_CELLS` = 16,384) → `MatterStepOut.surface?: { …the request, count, top, bottom, vel }`.
- **Per x–z column** (row-major, iz·nx + ix), water particles only, by centre, on the state after the tick: the count; the highest and lowest centre y (`SURFACE_EMPTY` = i32 min when empty); the mean velocity in units per Matter tick (per-substep velocity sums ×4 ÷ count, truncated toward zero).
- **Optional:** absent input → absent output, nothing else changes.
- **CPU:** exact sums.
- **GPU:** one extra kernel (`surface`, after `reduce`). It uses offset-binary `atomicMax` for the top, the max of the complement for the bottom, and 64-bit carry adds for the velocity sums, all order-independent. Both backends fill the same raw layout, which `prep.ts` `surfaceResult` converts.
- **Proof:** GPU = CPU on every tick on D3D12, D3D11 and SwiftShader in the harness's new `pool` scene (4,000 mL poured into a box, a dynamic box pushed through the surface, a stream, two grid layouts) and in `mix` (an off-grid map straddling the walls). A Node brute-force check against the snapshot is in `test/matter.test.ts`.
- **Sandstorm:** doesn't ask for a map. Re-run on the new kernels, every leg is identical to the M4 results: CPU over 120 ticks, D3D12 and D3D11 over 600, SwiftShader over 30.

The sim uses the map for buoyancy (SIMULATION §8.6). The "Buoyancy is weak" item above is closed that way.

## Contract addition: grain queries (orchestrator-approved, for DUSTY / B4)

`MatterStepIn.queries?: MatterQuery[]` (`{ id, center, radius, kindMask }`, ≤ `MAX_QUERIES` = 16, radius ≤ 2^20 units) → `MatterStepOut.near?: { id, count, centroid }[]` in input order: particles of those kinds with |p − center| < radius on the state after the tick; centroid = 64-bit position sums ÷ count, truncated toward zero (zeros when count = 0). Optional: absent input → absent output, nothing else changes. CPU: exact sums; GPU: workgroup-reduced 64-bit carry atomics in the output pass (≈ free). Tested: Node brute-force check vs a snapshot, and GPU = CPU every tick in the mix scene's proof (two queries per tick).

## Performance (GPU, RTX 5090, Chrome 155 D3D12)

**Method:** MX harness `?mode=perf` (`tools/vendor-matrix/page.mjs "http://localhost:5201/?mode=perf&n=…&ticks=60&warm=10&profile=1"`): ticks are queued 3 deep with no readback stalls; ms per Matter tick = wall time over 60 ticks after 10 warm-up ticks, waiting for the GPU (GPU-bound, so wall ≈ GPU time). The per-kernel split comes from timestamp queries with one pass per dispatch (5 extra ticks). **Contention:** nvidia-smi before the final runs showed 1 % utilization / 39 W (the other streams were idle); earlier runs on a busy GPU (Blender, other Chromes, 380 W) varied by up to 1.6×, so every earlier figure in this file is provisional.

| Scene | Grains | ms per Matter tick | Of which: sand contacts / apply / sort+permute |
|---|---:|---:|---|
| Settled sand box (25 layers) | 1,000,000 | **11.4** | 9.2 / 0.7 / 0.6 |
| Settled sand box (40 layers) | 4,000,000 | **54.5** | 44.2 / 3.3 / 3.0 |
| Sandstorm, ticks 1–120 (fall, landing, avalanche) | 4,000,000 | 94–99 | — |
| Sandstorm, ticks 1–600 average (incl. the deposit at the slope foot) | 4,000,000 | 189 (D3D12), 255 (D3D11) | — |

- **Budget:** 60 Hz = 16.7 ms. 1M grains fits. 4M (the 16 GB tier) doesn't: ≈ 3.3× over in a settled box and more while the Sandstorm deposit is piled up (compressed piles have 2–3× the contacts per grain). Per D92 it runs dilated or as Bake & Watch. 8M (32 GB tier) wasn't measured end to end (the buffers fit default limits: the largest binding is 128 MiB at 8M).
- **What was done:** hashed-row cell keys (3.4× fewer aliased candidates at 1M), a vec4 predicted-position + tag layout (one 16-byte load per candidate), one division per contact, an exact `isqrt` that starts at the top bit pair, a physically sorted particle order each substep (neighbours contiguous), indirect dispatches sized on the GPU (no readbacks between ticks). The M0 spike measured 9.2 ms at 1M with much simpler physics (no friction, no proxies list, fixed scene); this is 11.4 ms with everything.
- **Where the time goes:** the same-kind contact gather is 80–85 % of a tick (27 neighbour cells, ≈ 20–30 candidates and 6–12 contacts per grain, 12 passes per tick = 4 substeps × 3 Jacobi iterations). The next steps, in order of payoff: fewer passes (e.g. 6 substeps × 1 iteration; needs a physics re-validation and new goldens), a shared-memory tile per workgroup for the neighbour rows, and a half-pair scatter variant.
- **CPU reference** (Node, 20 worker threads, same machine): ≈ 9–11 s per tick at 4M; single-threaded ≈ 10 µs per grain per tick.

## Known solver limitations (measured; candidates for M5)

- **Deep stacks compress.** Jacobi with 3 iterations × 4 substeps can't carry a tall column's weight: a 60-layer sand column settles at packing 0.66 with 12 % mean overlap (box test, CPU). Shallow piles are fine. Same root cause: **deep beds start sluggishly** (static friction everywhere, shear barely transmitted through a resting bed) — the Sandstorm slab is released 0.2 m above the slope so it lands moving (a cornice letting go).
- **Little hydrostatic pressure in water.** The double-density fluid holds volume (1 L of particles fills ≈ 1.05 L) and flows, splashes and pours correctly, but its pressure doesn't grow with depth, so a resting lid feels ≈ 4 % of ρ·g·V (see the QUACK section). Impact/flow impulses are right.
- **Fast impacts.** VMAX = 1.875 m/s per component (≈ 2 sand diameters per substep); faster relative motion than that can tunnel a grain into a pile. Thin proxies should be ≥ 2 cm thick against fast sand.
- **Marbles stack in columns** if emitted on a perfect lattice (PBD friction has no rolling); emit with spread/jitter.

## M0 spike deviations (M0_STATUS) — resolved

| M0 deviation | M4 |
|---|---|
| Grain ⌀ 256 units (3.9 mm), cell = x >> 8 | **Fixed:** sand ⌀ 262 units (4.0 mm), water r 406 (6.2 mm, 1 mL), marble ⌀ 1,048 (16 mm) per D34/SIMULATION §8.1. Cells use offset-binary floor division (`ucell`), so any size works. |
| 4 substeps per 60 Hz tick | **Kept, documented** (`constants.ts`): with 1 step, gravity alone moves a grain 0.7 diameters per tick and stacks collapse. Velocities are units per substep; `MatterView.vel` says so. |
| Velocity clamp ½ diameter per substep (0.47 m/s) | **Raised** to 512 units per substep per component (1.875 m/s); falls no longer look like syrup. |
| Damping 254/256 per substep | **Matched to the spec:** 1018/1024 per substep = 0.9768 per tick ≈ SIMULATION's 250/256. |
| 3 radix passes (22-bit key) | GPU: an atomic **count sort** over the cell table + a rank pass (order rebuilt from original indices, so tickets never matter) and a physical permute of the particle arrays each substep (neighbours become contiguous). CPU: a stable 3-pass LSD radix (24-bit keys). Independent implementations, same order. |
| Piles settle compressed; friction only on the floor | Coulomb friction on every grain–grain and grain–proxy contact; stacking rule fixed (45° cone). Deep stacks still compress (limitations above). |
| No emit/despawn, sand only, no impulses | Emits (lattice + hash jitter, seq order), intakes with capacity (lowest index first), kill box, stable compaction, blasts; sand, water (double-density PBD fluid), marbles; per-proxy linear + angular impulses with 64-bit carry; grain queries. |
| Proxies hard-coded in the WGSL prelude | Passed per tick (`MatterProxy[]`): sphere, capsule, OBB, plane; per-substep poses integrated on the host (integer quaternions), coarse 0.5 m proxy grid. |

## The M0 spike

Moved unchanged to `packages/matter/src/spike/` and `gpu/spike.ts` (exports `@knockon/matter/spike`, `@knockon/matter/spike/gpu`); `apps/game/src/spike-matter.ts` now imports from there (2-line import edit, nothing else).

## Exit: Sandstorm and the D91 matrix (2026-10-25) — PASS

- **Scene** (`packages/matter/src/scenes.ts` `sandstorm()`): 4,000,000 grains in a 1.16 m × 0.1 m slab let go 0.2 m above a 36° valley; lands at tick ≈ 15, avalanches through a WATERWHEEL on the slope (8 scripted OBB paddles + capsule hub, 0.5 rev/s, dynamic proxies → impulses compared), past a boulder, onto a flat run-out. After 600 ticks 69 % of the grains are past the wheel axle and the wheel took impulses on 581 ticks.
- **Runner** (`tools/vendor-matrix/`): `run.mjs` (legs, comparison, report), `cdp.mjs` (headless Chrome over CDP with Node's built-in WebSocket, throwaway profile in the OS temp dir), `page.mjs` (run any harness page), `cpu.ts` (the Node CPU leg on worker threads). Results: `tools/vendor-matrix/results/*.json`.
- **Result:** CPU reference = NVIDIA D3D12 = NVIDIA D3D11 = SwiftShader on every tick 1–30 (checksum + all wheel impulses); CPU = D3D12 = D3D11 through tick 120; D3D12 = D3D11 through tick 600. SwiftShader runs at ≈ 100 s per tick at 4M, so its range covers release, landing and the first wheel impacts. Before this, the full CPU = GPU proof (ballistic, mix with every input path, sand box, Sandstorm cut, snapshots, restores) passed on all three adapters.
- **D3D11 note:** Dawn's D3D11 backend compiles with FXC, which rejected workgroup-shared atomics (`blockCount`, `reduce`: "FXC compile failed: E_FAIL"); both now use plain shared-memory tree reductions. All 31 kernels compile on D3D12, D3D11 and SwiftShader (`?mode=compile`).
- **Not done here:** the full rigid + Matter Sandstorm *world* is MI's (`packages/sim/src/matter/sandstorm.ts`, test `matter_sandstorm.test.ts`); I did not add it to `apps/game/bench/scenes.ts`.

## How to run

```bash
apps/game/node_modules/.bin/vite --config packages/matter/harness/vite.config.mjs   # MX harness, http://localhost:5201
node tools/vendor-matrix/page.mjs "http://localhost:5201/?mode=proof" [--use-webgpu-adapter=d3d11|swiftshader]
node tools/vendor-matrix/page.mjs "http://localhost:5201/?mode=perf&n=1000000&profile=1"
node tools/vendor-matrix/run.mjs [--ticks=600 --cpuTicks=120 --swiftTicks=30] [--reuse]
```

## For other streams

- **R4 (rendering):** `MatterGpu.view()` → `pos` (array<i32> stride 3, units), `vel` (array<i32> stride 3, units per *substep*: × 4 × 60 / 65,536 = m/s), `mat` (array<u32>, bits 0–7 = kind), `count` (live count after the last *completed* step) and `state` (word 0 = live count after the newest *submitted* step, GPU-resident: copy it into your indirect-draw args with a tiny compute pass). Draw the first `state[0]` entries. These buffers are canonical between ticks; Matter's work and your draws share the queue, so a draw submitted after `step()` sees that tick. Particles are re-sorted every substep: there is no per-particle identity across frames (use `vel` for streaks, not history). Radii per kind: `RADIUS` in `@knockon/matter`.
- **MI (integration):** CPU sync twins; `snapshot()` is order-correct on its own; `restore()` affects only later steps; grain queries for `machine.matter.near()`; impulse units in backend.ts; for multi-million CPU runs in Node, `MatterCpuParallel` (`packages/matter/src/node/parallel.ts`, `await init()`, bit-identical). A per-body Δv limiter for light bodies under the fixed latency is recommended (QUACK section).
- **F4 (audio):** per-kind activity near the listener: one grain query per kind (`kindMask` 1/2/4, radius ≈ 1 m) gives count + centroid with the usual latency, deterministic and nearly free; or reduce over `view()` buffers yourself on the GPU (cosmetic, any method).
- **B4 (DUSTY):** grain queries (contract addition above).

## Orchestrator requests (2026-10-24)

- **`pnpm -s typecheck`:** fixed. `packages/matter/test/matter.test.ts` now tests the production backend (helpers, MATR, CPU determinism, goldens, snapshot/restore, capacity/kill, parallel = serial, WGSL float validator incl. the spike kernels) and keeps the M0 spike golden via `src/spike`.
- **Snapshot ordering:** `MatterGpu.snapshot()` is now order-correct by itself: it enqueues its copies synchronously when called, so steps issued afterwards (even before the promise resolves) never leak in. Contract documented on `MatterBackend.snapshot()` / `restore()` in backend.ts. MI's await-as-barrier stays valid.
- **VRAM ledger (V4):** every Matter GPU buffer / query set is labelled `matter.<name>` (`matter.posA`, `matter.kt`, `matter.tscan0`, `matter.pdata`, `matter.staging`, `matter.snapshot` …). Device loss: `destroy()` frees everything; make a new `MatterGpu` on the new device, `init()`, `restore()` from the MATR CPU copy (an instance is never moved between devices; `init()` on a destroyed instance also works).

## Log

- 2026-10-24: **GPU backend landed** (`gpu/index.ts`, kernels in `src/wgsl.ts`). First browser proof on NVIDIA D3D12: GPU = CPU on every tick (checksum, counts, bounds, absorbed, impulses) and byte-identical MATR snapshots for the mix scene (300 ticks, all proxy shapes, emits of all three kinds, a capacity-limited intake, a blast), a 20k sand box and a 60k Sandstorm; GPU snapshots restore into fresh CPU and GPU backends and continue identically.

- 2026-10-24: backend.ts, constants, integer helpers, shared tick prep (`prep.ts`), MATR payload (`payload.ts`) and the CPU reference backend (`cpu.ts`) with sand/water/marble contacts, friction, water double-density fluid, proxies (sphere, capsule, OBB, plane) with 64-bit impulse sums, emits, intakes with capacity, blasts, kill box, compaction, checksum, bounds.
