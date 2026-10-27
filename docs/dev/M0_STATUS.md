# M0 status: foundations

Last updated 2026-10-24. Milestone plan: [PRODUCTION.md §2](../PRODUCTION.md). Chrome first: [D51](DECISIONS_2026-10-24.md). M1 progress: [M1_STATUS.md](M1_STATUS.md).

**M0 is complete on Chrome.** Every exit gate below passed on the primary development system. Cross-vendor GPU runs and the 5-tester usability check wait for additional hardware and people.

## Exit gates

| Workstream | Gate | Result |
|---|---|---|
| Sim | Greybox machines hash-match in Chrome and Node at 1/4/12 threads | **PASS.** 400 bodies × 600 ticks give `d36267ef85945df9` in Node and in Chrome (single-threaded, and multithreaded WASM+SIMD at 1, 4 and 12 workers). Save → restore → re-simulate matches. |
| Matter (spike) | 1M grains × 10k ticks: GPU = CPU reference and stable run to run | **PASS.** 16k grains × 600 ticks: 60/60 checksums equal GPU vs CPU, byte-identical final state. 1M × 30 ticks (≈ 3.9M contacts): GPU = CPU (and = Node). 1M × 10,000 ticks run twice: 100/100 checksums equal. **9.2 ms per matter tick** at 1M grains. See [Matter spike](#matter-spike) for the deviations. |
| Graphics | 100k instances at 60 fps on the 8 GB tier | **PASS.** GPU-driven renderer (compute frustum cull + LOD into per-(mesh, LOD) buckets, one indirect draw each): 100k parts + 1M live sparks = **6.3 ms GPU** at 1280×720, 4× MSAA, shadows, bloom. 1M parts + 1M sparks = 17.4 ms (the shadow pass dominates; cached static shadows come in M1). |
| Spectacle (spike) | 1M sparks at 60 fps on the 16 GB tier | **PASS.** 1M live sparks cost 0.9 ms of simulate; the full **16.7M** pool runs at **13.8 ms GPU total** with 100k parts. Open `/spike-gpu.html?n=100000&sparks=1000000`. |
| Art pipeline | THUD from Blender → engine with no manual steps | **PASS.** `node tools/assets.mjs thud` makes, validates and exports; the game loads `/parts/thud/thud.glb` and renders it with its master materials. [PIPELINE_STATUS.md](../art/PIPELINE_STATUS.md). |
| Net | Two machines see each other's cursors via `the local development server` | **PASS** (two Chrome tabs, same host). M1 also ran an hour-long session between two physical machines on the isolated test network with 0 desyncs ([M1_STATUS](M1_STATUS.md)). |
| Tools/UI | Place and connect 10 parts in < 5 min (5 testers) | **Built** (place, rotate, wire, inspect, undo; see M1_STATUS). Tester sessions pending. |

## Run it

```bash
pnpm install
```

```bash
pnpm --filter @knockon/game build
```

```bash
pnpm host
```

Open `http://localhost:8787` in two Chrome tabs. See [LOCAL_DEVELOPMENT.md](../LOCAL_DEVELOPMENT.md). The host re-reads the game's build id on every join, so a rebuild needs no host restart.

| Page | What it is |
|---|---|
| `/` | The game |
| `/check` | Secure context, WebGPU, cross-origin isolation, WASM threads, tier estimate, host reachability |
| `/spike-jolt.html` | Jolt determinism across builds and thread counts |
| `/spike-matter.html` | Matter GPU vs CPU reference, and the 1M × 10k stability run (`?big=0` skips it) |
| `/spike-gpu.html` | 100k–1M parts and 1M–16M sparks with per-pass GPU timings (`?n=`, `?sparks=`) |

## Matter spike

`packages/matter`: integer fixed-point granular PBD in WGSL (`src/wgsl.ts`, no floats anywhere: a test scans for `f32`/`f16`), an independent CPU reference written as per-grain gathers (`src/cpu.ts`), and the WebGPU host (`gpu/index.ts`).

Pipeline per tick: predict → 22-bit cell key → stable 8-bit-digit radix sort (3 passes) → cell ranges → 3 Jacobi passes with order-independent `atomicAdd` corrections and `idiv(delta, count)` → static sphere/box proxies → container clamp → damped velocity → checksum (x, y, z sums plus a per-grain hash, so a swapped pair is caught).

Deviations from SIMULATION §8, to revisit in M4:
- 4 substeps per 60 Hz tick (with one, gravity alone moves a grain 0.7 diameters and a pile collapses into one layer).
- Grain diameter 256 units (3.9 mm) instead of exactly 4 mm; velocity clamped to half a diameter per substep; damping 254/256 per substep.
- Piles settle somewhat compressed (stacking stiffness needs work); friction only on the floor.
- Emit/despawn, materials other than sand, and rigid-body impulses (§8.4) aren't built yet.

## Tests

```bash
pnpm test
```

271 tests across 15 files (at M1): detmath, format, net, docstore, host (end-to-end sessions, rate-limit rejects), jolt (determinism + rollback), sim (Machine, breakage, 27 per-part goldens, property fuzz, drive-train regressions, desync repair), matter (integer maths, CPU determinism, settling, golden checksum, no-float WGSL), assets (glb parser, art/shapes JSON, every built part vs its brief and parts-data).

```bash
pnpm typecheck
```

```bash
pnpm lint
```

`pnpm lint` runs the determinism lint ([ENGINEERING.md §4.1](../ENGINEERING.md)) over sim, docstore, format, net, detmath, matter and parts-data.

## Known gaps carried into M1

1. The published `jolt-physics` build isn't compiled with `JPH_CROSS_PLATFORM_DETERMINISTIC`. WASM-to-WASM determinism passes (above); this only matters for a future native build.
2. The sim worker uses the single-threaded Jolt build (the multithreaded one is verified and ready; switching it on is a one-line change once contact callbacks are moved off the listener).
3. Cross-vendor GPU runs (AMD, Intel, Apple) for Matter: when hardware is available.
