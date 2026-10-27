# M5 notes: G5 · GPU timing and governors

Stream G5 fixes two things from T5's findings ([M5_NOTES_T5.md](M5_NOTES_T5.md)):
- **Finding 1:** the GPU timer over-counts when Matter is on, so the governors step down early.
- **Finding 6:** `RESERVE.matter` is lower than what Matter actually allocates.

**Setup:** Vite 5310. The host on 8910 wasn't needed: every run loads in-page (`src=page`). Vite was stopped at hand-back.

**Status:** done (2026-10-25). Plan: [M5_PLAN.md](M5_PLAN.md).

**Hardware:** the same as T5.
- RTX 5090 32 GB, Chrome 155 D3D12, headless over CDP. The CDP driver uses the same flags as `tools/vendor-matrix/cdp.mjs`, so the browser pane's 1 Hz rAF throttling never applies.
- Core Ultra 9 285K.
- **The GPU was quiet:** nvidia-smi showed 0 % utilization and ≈ 6.3 GB used before each run.

## Root cause

**1. Unwritten timer slots read an earlier frame's pass (the main cause).**

How the old timer worked:
- `GpuTimer` handed out a query slot, and recorded its name, as soon as a caller *asked* for timestamp writes.
- Some callers asked and then skipped the pass:
  - `LookPass.practicalShadow` evaluated `timer?.render('look.spot')` as an argument, and `Practicals.render` then returned early when there was no shadowed lamp. That covers the Moon (lamps off by default) and every tier under 12 GB.
  - `fx.ts` asked for `'volume'` before `VolumeRenderer.march` found no live grid.
- `resolveQuerySet` on a slot that no pass wrote this frame returns whatever is still in it. D3D12 keeps the query heap, and Dawn zero-fills only slots that have never been written.

Why it showed up with Matter on:
- `matter.prep` is one more timed pass, before the shadow pass. It shifts every later slot by one.
- `look.spot`'s unwritten slot therefore lined up with the slot where `main` had been written while Matter was off. It kept reporting that old `main` time: 5–14 ms.
- With Matter off, the shift goes the other way, and `volume` read Matter-on `main`.

Measured with raw per-slot stamps (4 GB Room, Moon, 250k grains):
- **Matter close-up:** `look.spot` read `-625.000..-622.979` ms relative to the frame's first stamp. That's a 2 ms pair written about 0.6 s earlier, and the 5.5 ms EMA came from the boot layout. `volume` read the same kind of stale pair.
- **Matter off:** `volume` read 2.4 ms, the stale Matter-on `main`, and `look.spot` read 0.

**2. Stale names never left `total()`.** The per-name EMA map had no expiry, so `total()` summed every pass ever seen.

**What it wasn't:** a timestamp pair straddling other submissions. All timed passes are in one command encoder, and Matter solver ticks and `spot.static` are separate submissions that land between frames. The measured gap between one frame's last stamp and the next frame's first was 0.03 ms.

**3. The look governor never read the timer (found here).** The renderer fed it `stats.frameMs`, the *frame interval*, even though `governor.ts` documents "GPU time when available".
- At 60 Hz the interval EMA can't fall below 16.7 ms. The restore threshold is 0.8 × 16.6 = 13.3 ms, so a step is **never restored**, and any pacing jitter above 17.4 ms steps it down.
- Headless Chrome paces rAF at ≈ 17.6 ms, so in T5's governed runs the look governor walked down to step 7 regardless of GPU cost.
- **4 GB proof:** at 7.7 ms of GPU it sat at step 7 (1152 × 648) with the interval input, and stays at step 0 (1920 × 1080) with the GPU time.
- The Spectacle governor and the VRAM governor's spike check did read `timer.total()`, the over-counted sum.

## The fix

**`gfx/gpu.ts` (rewritten `GpuTimer`):**
- **Query regions:** each frame resolves into its own query region, one per readback buffer and at most 3 frames in flight. A 4th frame goes untimed instead of skipping only its readback.
- **Stale slots:** a region is reused only after its previous frame was read back, so every stale value in it is ≤ that frame's largest timestamp, the region floor. `attributeFrame(names, t, floor)` is pure. It keeps a pair only if both stamps are > floor, end ≥ begin and the pass is under 1 s. It sums repeated names and returns the frame span (first begin → last end) and the next floor.
- **Expiry:** `PassTimes` is the pure bookkeeping.
  - `ms` holds the EMA per pass. A name unseen for `STALE_FRAMES` (30) resolved frames is deleted.
  - `live` lists the last resolved frame's passes, and `total()` sums only those.
  - `frameMs` is the smoothed frame span.
- **API:** `GpuTimer` exposes `ms` (read-only), `live`, `total()` and `frameMs`. The resolve buffer is shared, because each frame's resolve → copy runs in queue order.

**Callers ask only when they encode the pass:**
- `Practicals.render` and `VolumeRenderer.march` now take a thunk, `() => GPURenderPassTimestampWrites | undefined`.
- `look/index.ts` and `fx.ts` pass the thunk.
- DOF still asks before `post.ts` knows whether its targets exist. That only matters on the first frames, and the region floor drops it.

**Governors** (they all read `timer.frameMs`, the GPU frame time with untimed work between passes included):
- `renderer.ts`: the VRAM governor gets `frameMs` (or `undefined` before the first resolved frame). The look governor gets `frameMs`, falling back to the frame interval without timestamp queries.
- `fx.ts`: the Spectacle governor reads `frameMs` and skips frames until one has resolved.
- `capture/index.ts`: `estimateMs` uses `frameMs`.
- `look/hero.ts`: uses `timer.live`.

**Matter attribution:**
- Matter's own passes stay `matter.prep` and `matter.water.splat|smooth|shade`.
- Its grains are drawn inside `shadow`, `look.pre` and `main`, and timed there. Splitting them out would mean splitting those passes.
- Solver ticks (`MatterGpu.stepPacked`) are separate submissions and aren't timed. They aren't render work, and no look step changes them.

**Bench (`apps/game/bench/bench.ts`):**
- `gpuMedianMs` is now `timer.total()`.
- New `gpuFrameMedianMs` (`timer.frameMs`).
- `timedPasses` and `pass_*` come from `timer.live`.

## Before / after (RTX 5090, governors off unless noted)

Three ways to measure a frame:
- **Sum:** `total()` (before G5: the old sum).
- **Span:** `frameMs`.
- **Throughput:** two frames in flight, as T5 measured it.

**Before** (the old timer, 4 GB Room, Moon, 250k grains, `r1`):

| Camera | Sum | Throughput | Over |
|---|---|---|---|
| Preset | 13.1 | 7.9 | +66 % |
| Whole world | 12.5 | 7.3 | +71 % |
| Matter close-up | 8.9 | 3.8 | +134 % (phantom `look.spot` 5.5) |
| Close-up, Matter off | 5.8 | 3.8 | +53 % (phantom `volume` 2.4) |

T5 (old timer), 8 GB Moon: sum **29.9** against a **20.2 ms** frame.

**After, bench frames** (rAF-paced loop for sum and span; throughput as T5):

| Scene | Camera | Sum | Span | Throughput |
|---|---|---|---|---|
| 4 GB Room, Moon, 250k grains | preset | 7.5 | 7.6 | 8.0 |
| | whole world | 7.0 | 7.1 | 7.3 |
| | Matter close-up (off) | 3.3 (3.1) | 3.4 (3.2) | 4.0 (4.0) |
| **8 GB Warehouse, Moon, 1M grains** | preset | **19.1** | **19.3** | **19.9** |
| | whole world | 18.4 | 18.5 | 18.6 |
| | Matter close-up (off) | 4.6 (3.2) | 4.7 (3.3) | 5.0 (3.8) |
| **8 GB Warehouse, Moon, Matter off** (no grains) | preset | **18.6** | **19.0** | **18.8** |
| | whole world | 17.7 | 17.8 | 17.8 |
| 8 GB Warehouse, Hangar, 1M grains | preset | 20.4 | 20.7 | 23.1 (see note) |
| | whole world | 21.2 | 21.3 | 21.4 |
| | Matter close-up | 5.3 | 5.4 | 5.4 |

**After, same regime** (the timer read during the throughput loop itself, preset camera):

| Scene | Throughput | `frameMs` | `total()` | Agreement |
|---|---|---|---|---|
| **8 GB Moon, 1M grains** | 20.49 | 20.40 | 20.25 | −0.4 % / −1.2 % |
| **8 GB Moon, Matter off** | 18.19 | 18.13 | 18.00 | −0.3 % / −1.0 % |
| 8 GB Hangar, 1M grains | 22.66 | 22.61 | 22.45 | −0.2 % / −0.9 % |
| 12 GB Hangar, 20k parts, 2M grains (`look.spot` really runs: 0.22 ms) | 12.01 | 11.90 | 11.70 | −0.9 % / −2.6 % |
| 12 GB Arena, Moon, 2M grains, governed | 18.94 | 18.88 | 18.67 | −0.3 % / −1.4 % |

**Reading these tables:**
- **Agreement:** within 10 % everywhere a governor acts (frames ≥ 7 ms), and within ≈ 1 % in the same regime.
- **Small frames:** below ≈ 5 ms, the throughput carries ≈ 0.5 ms of fixed per-frame cost outside the command buffer (present and composite), so the timer reads 10–15 % under it.
- **The Hangar preset gap (20.7 against 23.1):** in the throughput regime, the frame's own GPU span grows to 22.6 ms. Back-to-back frames are slower on the GPU than paced ones, and the timer tracks both. The raw stamps show a 0.03 ms gap between frames, so nothing untimed runs between them.

## Governed (governors on, 30 s settle, then each camera)

| Tier | Preset GPU / throughput | Whole world | Matter close-up | Look step | Internal | T5 (old) |
|---|---|---|---|---|---|---|
| 4 GB (Room, Moon, 250k) | 7.7 / 8.2 | 7.3 | 3.5 | **0 of 7** | 1920 × 1080 | 7 of 7, 1152 × 648 (interval-fed; an interim G5 run) |
| **8 GB** (Warehouse, Moon, 1M) | 16.7 / 17.0; repeat 16.1 / 16.4 | 16.2; 15.6 | 4.5; 4.4 | **6 of 7** both runs (close-up restores to 5) | 1344 × 756 (close-up 1536 × 864) | 16.8 / 15.4 / 4.5, 6–7 of 7, 1344 × 756 → 1152 × 648 |
| **12 GB** (Arena, Moon, 2M) | 16.2 / 16.6 | 17.6 | 4.5 | **7 of 7** (close-up restores to 6) | 1536 × 864 (close-up 1792 × 1007) | 16.5 / 17.6 / 5.1, 7 of 7, 1536 × 864 |

**What changed:**
- **8 GB:** now settles one step higher and holds at step 6. It no longer drifts to step 7, and in the close-up it restores a step, which the interval input never allowed.
- **12 GB:** still needs the last step. Its cost is the 400k parts' key-light shadow (10 ms at the preset camera, 14.4 ms whole world), which no look step touches (T5 found item 3).
- **4 GB:** under the interval input it lost every step for nothing. Now it keeps full quality.
- **Spectacle governor:** it still reaches level 3 on 8 GB and 12 GB, because 16–17 ms is over its 85 % line (14.2 ms).
- **VRAM governor:** stayed at L0 in every run.

**Docs:**
- GAME_SPEC §15.2: the 8 GB "governed" cell is updated. The 12 GB cell is unchanged, because its governed result didn't change.
- RENDERING §2 (Profiling) and §11 (live governor, pool budgets) now describe the timer and what the governors read.

## RESERVE.matter (finding 6)

I re-measured the ledger's `matter` pool at each tier's grain budget. It holds the GPU backend, the playback replica (`replica` on) and the MatterRenderer's draw lists.
- **8 and 12 GB:** the full T5 scenes.
- **16 and 32 GB:** 1,000 parts plus the grains. The pool doesn't depend on parts.
- **Result:** identical to T5 on every tier.

| Tier | Grains | Measured | Old reserve | **New reserve (measured + 5 %)** |
|---|---|---|---|---|
| 4 GB | 250k | 198 MB | 86 MB | **208 MB** |
| 8 GB | 1M | 474 MB | 348 MB | **498 MB** |
| 12 GB | 2M | 846 MB | 696 MB | **889 MB** |
| 16 GB | 4M | 1,588 MB | 1,382 MB | **1,668 MB** (1.63 GB) |
| 32 GB | 8M | 3,042 MB | 2,765 MB | **3,195 MB** (3.12 GB) |

- `vram.ts` now exports `MATTER_MEASURED_MB`, and the `RESERVE` comment is corrected: rewind checkpoints live in CPU memory.
- `matter + keyframes` stays under half of every tier's budget.

## Files

| File | Change |
|---|---|
| `apps/game/src/gfx/gpu.ts` | `GpuTimer` rewritten: query regions with floors, `attributeFrame`, `PassTimes`, `STALE_FRAMES`, `live`, `frameMs` |
| `apps/game/src/gfx/look/practicals.ts` | `render` takes a timestamp thunk, called only when the pass is encoded |
| `apps/game/src/gfx/look/index.ts` | passes `() => timer?.render('look.spot')` |
| `apps/game/src/gfx/volume.ts` | `march` takes a timestamp thunk |
| `apps/game/src/gfx/fx.ts` | passes the `volume` thunk; the Spectacle governor reads `timer.frameMs` |
| `apps/game/src/gfx/renderer.ts` | the VRAM and look governors get `timer.frameMs` (the look governor falls back to the interval) |
| `apps/game/src/capture/index.ts` | `estimateMs` uses `timer.frameMs` |
| `apps/game/src/gfx/look/hero.ts` | `lastNames` uses `timer.live` |
| `apps/game/src/gfx/vram.ts` | `RESERVE.matter` from measurement; `MATTER_MEASURED_MB` |
| `apps/game/bench/bench.ts` | `gpuMedianMs` = `total()`, new `gpuFrameMedianMs`, passes from `live` |
| `apps/game/test/gputimer.test.ts` | new: 9 tests |
| `apps/game/test/vram.test.ts` | `RESERVE.matter` against the measured pools |
| `docs/RENDERING.md`, `GAME_SPEC.md` §15.2 | see above |

**The 9 new tests in `gputimer.test.ts`:**
- `attributeFrame`:
  - floor rejection;
  - zero, reversed and ≥ 1 s pairs;
  - repeated names;
  - empty frames.
- `PassTimes`:
  - `total()` excludes names that stopped;
  - expiry after `STALE_FRAMES`;
  - EMA and span.
- `GpuTimer` on a fake device whose query heap keeps stale values like D3D12:
  - the `look.spot` scenario: a slot asked for, the pass skipped, the indices shifted;
  - expiry end to end;
  - per-frame regions, with the 4th frame in flight untimed.

**Checks:**
- `pnpm -s vitest run apps/game`: 15 files, 181 tests pass.
- `pnpm -s typecheck` and the bench tsconfig: clean.
- Determinism lint: clean.
- No WebGPU validation errors in any final run.

**Reproduce:** the T5 URLs on port 5310, plus `&settle=30` for the governed runs. The scratchpad CDP driver evaluated two probes after `__bench.done`:
- the raw per-slot stamps, with the old-style sum against `total()` and `frameMs`;
- the throughput loop at the preset camera with each frame's first and last stamps, giving the GPU period, span and gap.

## Not done / for others

- **DOF timestamps (`look/index.ts` `post`)** are still asked before `post.ts` checks its DOF targets. The floor makes this harmless, but a thunk like the other two would be tidier (R5).
- **T5 found items 2 and 3 are untouched:**
  - the CPU spot-cone test;
  - whole-world shadow geometry. It's 12 GB's remaining cost at the governor's last step.
- **Each look-governor step costs 2 s, even where it's a no-op** (on 8 GB, step 1 (shafts) and step 3 (probe GI) drop nothing: GAME_SPEC §15.2). Skipping no-op steps would reach resolution sooner. That's a design call, not changed here.
