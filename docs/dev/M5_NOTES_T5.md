# M5 notes: T5 · tier tuning

Stream T5 measures GAME_SPEC §15's per-tier budgets on a quiet GPU, adds the awake-body column and checks 8M grains on
the 32 GB tier. Vite 5309, host 8909 (own `KNOCKON_DATA` in the session scratchpad); both stopped at hand-back.
Plan: [M5_PLAN.md](M5_PLAN.md). Status: **done** (2026-10-25, after every other M5 stream finished).

**Hardware (every number here):** RTX 5090 (32 GB, Chrome 155 D3D12, headless over CDP), Intel Core Ultra 9 285K
(24 cores), 64 GB RAM, Node 24.2. **The GPU was quiet:** nvidia-smi showed 0 % utilization, ≈ 6.4 GB used by the
desktop and ≈ 30 W before every run. The low tiers' numbers are **measured on the RTX 5090 at that tier's settings**:
they show what the settings and the content cost relative to each other, not what a GTX 1650 or an RTX 4060 would do.

## Method

**Frames:** the perf harness (`apps/game/bench/`) in headless Chrome, driven over CDP by `tools/vendor-matrix/cdp.mjs`
(so the browser pane's 1 Hz rAF throttling doesn't apply). One run per tier at that tier's limits, with the M5
environments where the preset hosts them:

| Tier | Output | Internal (auto) | World | Parts | Matter grains | Environment |
|---|---|---|---|---|---|---|
| 4 GB | 1920 × 1080 | 1920 × 1080 (native) | Room | 20,000 | 250,000 | MOON BASE; Tinker Lab |
| 8 GB | 2560 × 1440 | 1920 × 1080 (TAA) | Warehouse | 100,000 | 1,000,000 | MOON BASE; ORBITAL HANGAR |
| 12 GB | 2560 × 1440 | 2560 × 1440 (native) | Arena | 400,000 | 2,000,000 | MOON BASE; ORBITAL HANGAR |
| 16 GB | 3840 × 2160 | 2560 × 1440 (TAA) | Megastructure | 1,000,000 | 4,000,000 | Backlot preset, no terrain (below) |
| 32 GB | 3840 × 2160 | 3200 × 1800 (TAA) | Megastructure | 2,000,000 | 8,000,000 | Backlot preset, no terrain |

- **Parts:** `bigWorld(count, preset)`, the harness's mixed grid (BRIK, TOPPLE TILES, BOING, LEDGE, SLOPE, THUD), over
  the whole floor. On Room and Warehouse the cap packs it densely (parts overlap; static frames only, so that's harmless).
- **Grains:** MX's GPU backend on the renderer's device (D92) running a settled sand box (`sandBox(n)`) at the origin,
  plus a second backend for VRAM only (in-game GPU Matter keeps a playback replica, `matterhost.ts`). Drawn by the
  `MatterRenderer`, frozen after the tick measurement.
- **Cameras:** the preset camera, a whole-world camera, and a Matter close-up (the sand box fills the frame), with
  Matter on and off.
- **Governors off** (`&gov=0`): the tier's settings as configured. A second set with them on, after 30 s of settling
  (`&settle=30`), shows what ships.
- **What "GPU ms" is:** throughput with two frames in flight (draw, keep ≤ 2 submitted, time 90 frames). That's
  max(CPU, GPU) per frame with everything included, which is what a 60 fps budget is about. The timestamp sum the
  harness also reports **over-counts** when Matter is on (see "Found", item 1), and a draw-then-wait wall time carries
  ≈ 3 ms of completion latency, so neither is used for the verdicts.
- **CPU ms:** the main thread's `fx.frame` + `renderer.draw` per frame (median).

**Spectacle:** Kiloton (3,917 parts, a 424-charge blast; Arena) in Bake & Watch at every tier and its target
resolution, 20 s of playback, worst 1 s window of the timestamp sum (no Matter, so the sum is sound there).

**Awake bodies:** `apps/game/bench/sim-bench.ts` in Node, the multithreaded Jolt build at 1–12 threads (D99), two
scenes. **Chain reaction:** Domino Day with unbroken lanes (`domino … 0`: no BOING relays, so every fallen tile stays
awake and the count climbs ≈ 2.8k/s on 256 lanes, 1.4k/s on 128). **Dense pile:** `awakePile(n)`: n THUDs, BOINGs and
TOPPLE TILES dropped in 8 lattice layers; they land, pile and stay one awake island. The ceiling is the awake count
where the 1 s window's mean tick crosses SIMULATION §12's **7.5 ms** (120 Hz real time is 8.33 ms), interpolated
between windows against each window's mean awake count. Each result is the same Jolt build and Machine as the sim worker.

**Matter ticks:** the harness above (`msPerTick`, MX's method: 3 ticks in flight, wall over 60 ticks after 10) and
MX's own harness (`packages/matter/harness ?mode=perf&profile=1`, M4_NOTES_MX's method) for the comparison with M4.

## Per-tier frame times (RTX 5090 at each tier's settings, governors off)

GPU ms = throughput (two frames in flight); target 16.7 ms (60 fps).

| Tier | Output → internal | Scene | Preset camera | Whole world | Matter close-up (off) | CPU ms | Meets target on the 5090? |
|---|---|---|---|---|---|---|---|
| 4 GB | 1080p native | Room, 20k parts, 250k grains, Moon | **8.1** | 7.3 | 3.9 (3.7) | 0.5 | **Yes** (1080p60) |
| | | same, Tinker Lab | 9.0 | 8.3 | 4.4 (3.9) | 0.5 | Yes |
| 8 GB | 1440p → 1080p | Warehouse, 100k parts, 1M grains, Moon | **20.2** | 19.0 | 5.1 (4.1) | 0.5 | **No** |
| | | same, Hangar | 23.2 | 21.6 | 5.5 (4.0) | 0.5 | No |
| 12 GB | 1440p native | Arena, 400k parts, 2M grains, Moon | **29.0** | 18.6 | 7.6 (3.5) | 0.5 | **No** |
| | | same, Hangar | 21.8 | 19.1 | 8.2 (9.7) | **7.4–8.0** | No |
| 16 GB | 4K → 1440p | Megastructure, 1M parts, 4M grains | **10.3** | 13.4 | 9.0 (1.8) | 0.5 | **Yes** (4K60 upscaled) |
| 32 GB | 4K → 1800p | Megastructure, 2M parts, 8M grains | **22.6** | 28.6 | 31.4 (3.0) | 0.5 | **No** |

**Where the time goes (decomposition runs, timestamp passes without Matter):**
- **8 GB:** the 100k parts are the cost. Parts alone 18.9 ms (main 11.2, shadow 3.7, AO prepass 3.5); grains alone
  2.7 ms; the empty Warehouse with the Moon set 1.6–3.1 ms. Impostors forced on (24 px) change nothing (20.0 ms): from
  the Warehouse's cameras the parts project bigger than the threshold.
- **12 GB:** the 400k parts' key-light shadow (9.8 ms at the preset camera, 14–15 ms whole world: `shadowMatrix` covers
  up to 300 m, so the whole Arena goes into the one 4096² map) and the main pass (14 ms). Grains alone 5.0 ms.
- **12 GB Hangar:** the CPU cost is the shadowed practical lamp: `drawSpotShadow` (renderer.ts) tests every scene
  instance against the cone on the CPU each frame; 1k parts 0.6 ms, 400k parts 7.4–8 ms. The Moon's lamps are off by
  default ("Base lights"), so it doesn't pay this.
- **32 GB:** parts alone 10.9 / 14.6 ms (shadow 4.6 / 11.6); grains alone 13 / 15 ms at the preset / whole-world camera
  and **27 ms in the close-up** (main pass 20 ms: 8M grains at 3200 × 1800). With 4M grains instead: 16.8 / 21.7 / 16.8 ms.
- The tier settings themselves are cheap: the empty worlds cost 1.1–3.1 ms at every tier. The misses come from the
  content at each tier's caps, all in view at once.

**With the governors on (what ships), settled 30 s:**

| Tier | Preset | Whole world | Matter close-up | Look governor level | Internal resolution |
|---|---|---|---|---|---|
| 8 GB | 16.8 | 15.4 | 4.5 | 6–7 of 7 | 1344 × 756 → 1152 × 648 |
| 12 GB | 16.5 | 17.6 | 5.1 | 7 of 7 | 1536 × 864 |
| 32 GB | 18.7 | 28.8 | 15.2 | 7 of 7 | 1920 × 1080 |

The governor reaches 60 fps on 8 GB and 12 GB on the 5090 only at its last step (shafts, DOF and GI off, 60 %
resolution). The whole-world camera on 32 GB stays at 29 ms because its cost is shadow geometry, which resolution doesn't touch.

**Spectacle (Kiloton, Bake & Watch playback, worst 1 s window: median (max) GPU ms):**

| | 4 GB | 8 GB | 12 GB | 16 GB | 32 GB |
|---|---|---|---|---|---|
| Blast second | 2.2 (2.3) | 2.6 (3.7) | 4.5 (5.6) | 5.8 (6.3) | 12.7 (14.6) |
| Playback | 60 fps throughout | 60 fps | 60 fps | 60 fps | 60 fps |
| Bake (browser, Jolt multi) | 396 ticks/s | 444 | 424 | 431 | 425 |

M3's "Kiloton 35 ms frames on 32 GB" is gone; the 32 GB blast now costs 12.7 ms. The bake is ≈ 9× M3's single-thread rate.

**VRAM (the ledger, `gfx/vram.ts`):**

| Tier | Ledger total / budget | Matter pool | Largest other pools |
|---|---|---|---|
| 4 GB | 1.38 / 2.80 GB | 198 MB | textures 721 MB, targets 225 MB |
| 8 GB | 2.09 / 5.50 GB | 474 MB | textures 721 MB, volumes 280 MB |
| 12 GB | 3.66 / 8.00 GB (Moon) | 846 MB | textures 1,489 MB, volumes 396 MB |
| 16 GB | 5.35 / 10.4 GB | 1,588 MB | textures 1,489 MB, volumes 773 MB, particles 640 MB |
| 32 GB | 8.92 / 22.0 GB | 3,042 MB | volumes 1,728 MB, textures 1,489 MB, particles 1,280 MB |

No WebGPU validation errors in any run.

## Awake bodies at 1× (multithreaded Jolt, D99; Node, Core Ultra 9 285K)

The awake ceiling depends on the CPU and Jolt's thread count, not the GPU tier. Jolt gets `hardwareConcurrency − 3`
threads, clamped 2..12 (`joltThreadsFor`); without cross-origin isolation it falls back to the single-threaded build.

| Jolt threads | Chain reaction (Domino wave): awake at 7.5 ms per tick | Dense pile: awake at 7.5 ms | Pile 16k awake: ms per tick |
|---|---|---|---|
| 1 (single-thread build) | ≈ 1,600 | < 1,800 (1,820 awake: 9.5–11.4 ms) | 137–142 |
| 2 | ≈ 7,000 | ≈ 3,900 | 34–36 |
| 4 | ≈ 11,300 | ≈ 4,900 | 25–26 |
| 5 | ≈ 13,000 | ≈ 5,200 | — |
| 6 | ≈ 13,500 | ≈ 5,700 | 22–23 |
| 8 | ≈ 14,300 | ≈ 6,000 | 20–21 |
| 9 | ≈ 13,700 | ≈ 5,700 | — |
| 12 | ≈ 14,600 (16,100 on 512 lanes) | ≈ 6,000 | 19.3–20.0 |

- Past 5–6 threads it flattens: Jolt's step doesn't scale further on these scenes.
- The chain reaction costs ≈ 0.5 ms per 1,000 awake bodies at 8–12 threads; a dense pile (one island, every body in
  contact) costs ≈ 2.4× that.
- **Per tier (column for GAME_SPEC §15.2).** This uses a CPU class per tier, an assumption for the producer: 4 GB
  laptops and older desktops have 4–8 hardware threads (2–5 Jolt threads); 8 GB 8 threads (5); 12 GB 8–12 (5–9);
  16 GB and 32 GB 12–16+ (9–12).

| | 4 GB | 8 GB | 12 GB | 16 GB | 32 GB |
|---|---|---|---|---|---|
| Jolt threads (reference CPU class) | 2–5 | 5 | 5–9 | 9–12 | 12 |
| Awake at 1×, chain reaction | 7k–13k | 13k | 13k–14k | ≈ 14k–15k | ≈ 15k |
| Awake at 1×, dense pile | 3.9k–5.2k | 5.2k | 5.2k–5.7k | ≈ 6k | ≈ 6k |

The M0 estimate ("about 10k awake on 8 cores") holds for chain reactions from 4 Jolt threads up, and is about 1.7×
too high for a dense pile.

## 8M grains on the 32 GB tier

| Check | Result |
|---|---|
| VRAM | Ledger **8.92 GB of 22 GB** with 2M parts and 8M grains; the Matter pool is 3.04 GB (two backends + the renderer's Matter buffers). The boot probe's `reserve` mode then allocated and touched a further 2.73 GB: **fits**. The governor stayed at L0. |
| Validation | **0 errors** (harness and MX harness) |
| ms per Matter tick, settled box | **130.8 ms** (MX harness; 50 layers; sand contacts 109 ms) · 130.7–131.5 ms on the renderer's device |
| ms per Matter tick, Sandstorm ticks 11–70 | **201 ms** (4M: 103 ms) |
| Matter render cost | Close-up **31.4 ms** vs 3.0 ms with Matter off (≈ 28 ms for the grains at 3200 × 1800); at the preset / whole-world camera grains alone cost 13 / 15 ms |
| Real-time factor (60 Hz Matter ticks = 16.7 ms) | **≈ 0.13×** settled, **≈ 0.08×** in an avalanche, before any rendering |

**Verdict: 8M grains fit and run correctly on 32 GB but are not real time.** They only work time-dilated (D92: ≈ 8× slow
motion) or as Bake & Watch. A 600-tick (10 s) settled 8M bake is ≈ 79 s of GPU time; Sandstorm at 8M is ≈ 2 min.
**Recommendation (producer call):** keep 8M as the 32 GB *capacity* for Bake & Watch worlds, and say plainly in the UI
that worlds over ≈ 1M grains run dilated. The alternative is capping 32 GB at 4M (the 16 GB budget): 54 ms per tick,
0.31×. Nothing short of the M4 solver work (fewer passes, shared-memory neighbour tiles: M4_NOTES_MX) gets 4M+ to real time.

**Re-measured on the quiet GPU (MX harness, settled box):**

| Grains | M4 (quiet) | X5 (contended) | **T5 (quiet)** |
|---|---|---|---|
| 250k | — | — | 3.9–4.5 ms (harness) |
| 1M | 11.4 ms | 26–29 ms | **11.38 ms** (sand 9.32) |
| 2M | — | — | 24.0–24.4 ms (harness) |
| 4M | 54.5 ms | — | **53.9 ms** (sand 43.5) |
| 8M | not measured | — | **130.8 ms** (sand 109.2) |

X5's 26–29 ms at 1M was contention: the kernels are unchanged in cost. 1M (the 8 GB budget) is the largest real-time
grain count. **D98's sink fill is a fixed 1M water particles** whatever the tier (≥ 16 GB), so it's unaffected by the
8M question: it's 25 % of the 16 GB budget and 12.5 % of 32 GB's.

## Tuning: what changed

**No render-setting change was applied.** Each miss was traced to its passes (above), and none is in what
`LOOK_TIERS` / `GI_TIERS` / `VOLUME_TIERS` / the dynamic-resolution defaults control:
- The empty worlds cost 1.1–3.1 ms at every tier's settings.
- The look governor already drops shafts, DOF, GI and resolution to 60 %. With all of that, 8 GB and 12 GB reach
  ≈ 16.5–17.6 ms on a 5090.
- **Tried:**
  - 32 GB at 1440p internal (`&up=0.667`): 22.6 → 21.0 ms (preset), 31.4 → 24.6 ms (close-up). Still over, and against D85's ≥ 1800p.
  - Impostors on the Warehouse: no change.
- The remaining cost is geometry (main pass, key-light shadow, AO prepass) for hundreds of thousands of parts in view,
  and the grains. Those are renderer work or caps (recommendations below).

**Harness changes** (all marked `T5 (M5)`):

| File | Change |
|---|---|
| `apps/game/bench/bench.ts` | Every tier (`tier=4|8|12|16|32`). New parameters: `&preset=` (scene=big), `&env=` (the set via `EnvView`: look, IBL, practicals, GI statics), `&grains=` / `&mscene=box|storm` / `&mticks` / `&mwarm` / `&replica=0` (Matter on the renderer's device, ms per tick, `MatterRenderer`), `&gov=0`, `&settle=`, `&impforce=`, `&up=`, `&probe=1`. New outputs: throughput and wall per frame, internal size, governor levels, the VRAM ledger by pool, validation errors, and a Matter close-up camera (on/off). The GPU sum now covers only the passes that frame ran (the timer's EMA map keeps stale names). Yields use a MessageChannel, because nested `setTimeout(0)` clamps to 4 ms. |
| `apps/game/bench/scenes.ts` | `bigWorld` takes Room / Warehouse and an environment; new `awakePile(n, layers, preset)` |
| `apps/game/bench/sim-bench.ts` | `domino … [gap] [segment]` (segment 0 = unbroken lanes), `pile [seconds] [count] [layers] [preset]` |
| `apps/game/bench/index.html` | Query hint |

Checks: bench / game / root typecheck clean; determinism lint clean; `packages/sim/test/threads.test.ts`, which
imports the bench scenes, passes (127 tests). No game runtime file changed.

**Reproduce:** start Vite with `KN_BENCH_PORT=5309 KN_BENCH_HOST=8909 npx vite --config bench/vite.config.ts` (in
`apps/game`). Then run headless Chrome over CDP (`tools/vendor-matrix/cdp.mjs` `runPage`, `expr: 'window.__bench'`) on, for example:
- `/bench/?scene=big&preset=warehouse&count=100000&env=moon&grains=1000000&tier=8&res=2560x1440&mode=load&gov=0`
- `/bench/?scene=big&preset=megastructure&count=2000000&grains=8000000&tier=32&res=3840x2160&mode=load&gov=0&probe=1`

Awake: `node --disable-warning=ExperimentalWarning apps/game/bench/sim-bench.ts domino 8 76800 256 1.5 0 --threads=12`
and `… sim-bench.ts pile 4 8000 8 --threads=12`.

## Found (reports; other streams' files, not fixed here)

1. **The GPU timer over-counts with Matter on** (`gfx/gpu.ts`, `renderer.ts`):
   - **What:** the `look.spot` pass reads 5–14 ms whenever grains are drawn, but turning Matter off changes frame
     throughput by only 0.2–1.5 ms (4 GB: 3.9 vs 3.7 ms). The pair likely brackets untimed work queued before it.
   - **Second cause:** `GpuTimer.total()` also sums every pass name ever seen (an EMA map with no expiry).
   - **Effect:** the look governor, the Spectacle governor and the VRAM governor's spike detector all read
     `timer.total()`, so Matter scenes step quality down early. 8 GB Moon: the sum says 29.9 ms; the real frame is 20.2 ms.
   - **Owner:** renderer / R5.
2. **The spot-shadow cone test is O(instances) on the CPU every frame** (`renderer.ts` `drawSpotShadow`): 7.4–8 ms per
   frame with 400k parts under the Hangar's shadowed lamp. A GPU cull, or a cached list rebuilt when the scene changes,
   would remove it.
3. **The key-light shadow draws the whole world when zoomed out:** the single ortho map spans up to 300 m, so Arena and
   Megastructure put every part (and grain) into it: 14–15 ms on 12 GB and 32 GB. Coarser LODs or impostors in the
   shadow pass, or a distance cut, are the levers (M3's "later: impostor shadows").
4. **Rigid checkpoints hitch on worlds over 20k parts** (`checkpointPlan`: every 240 ticks): 43–80 ms ticks at 6k–23k
   awake in a 77k-part world, up to 180 ms at 68k awake in a 154k-part world. Bake-ahead hides them; a live run at the
   ceiling drops a frame every 2 s.
5. **Jolt heap OOM:** the 154k-part unbroken-domino world aborted with `Aborted(OOM)` at ≈ 74k awake bodies (Jolt heap
   640 MB from `joltHeapMB`). That's past the real-time ceiling, but in a browser it would kill the sim worker; dilation
   is the promised behaviour (GAME_SPEC §5.3). **Owner:** sim / A5.
6. **VRAM `RESERVE.matter` is below what Matter allocates:** 16 GB 1.59 GB measured vs 1.35 GB reserved; 32 GB 3.04 vs
   2.70 GB. Matter rewind checkpoints live in CPU memory, so the gap is the playback replica. There's plenty of
   headroom at both tiers. Suggest 1.6 / 3.1 GB.

## Recommendations (orchestrator / producer decisions)

1. **8M grains (32 GB):** capacity only (Bake & Watch / dilated, ≈ 0.13×), or cap at 4M. Producer call. `TIER_CAPS` untouched.
2. **Tier targets in §15.2 are met on the 5090 only at 4 GB and 16 GB with everything at its cap in view.** 8 GB and
   12 GB need the governor's last step, and 32 GB misses (whole-world shadow geometry, 8M grains). Either:
   - accept that the targets are for typical worlds (Kiloton plays at 60 fps on every tier, 2–13 ms), or
   - fund renderer work: found items 1–3. Item 1 is the cheapest and helps every Matter scene.
3. **Reference-hardware check:** the 5090 is several times an RTX 4060 or GTX 1650. With 8 GB at 20 ms here, the max
   Warehouse world will not hold 60 fps on an 8 GB card. A real reference-GPU pass (borrowed hardware, D91 matrix
   style) is the only way to state the low tiers' targets as met.
4. **Awake column:** adopt the measured per-thread values (GAME_SPEC §5.3, §15.2) and the CPU-class mapping above, or
   pick another mapping.
