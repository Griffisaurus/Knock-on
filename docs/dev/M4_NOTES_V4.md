# M4 notes: stream V4, VRAM governor + KTX2 / BC7

Status: done (2026-10-24). RENDERING §11's ledger, boot probe, governor and device-loss recovery are built and wired into the renderer. The in-house BC7 encoder and KTX2 writer (D94) pass the quality bar by a wide margin, so **KTX2 / BC7 becomes the shipped texture path when the adapter has `texture-compression-bc`**. PNG stays as the fallback and as the source of truth (D88). The 81 texture sets that were finished when I ran it are encoded and listed in their `.art.json`.

All work used local Vite server (:5210, HMR off, scratchpad config, its own deps cache), my own host (:8810, `KNOCKON_STATIC=none`, `KNOCKON_DATA` in a local scratch directory), the browser pane (Chromium 152), and one Chrome 155 tab that I closed afterwards. I never used :8787 and never built `dist/`.

**Shared GPU.** Every timing below was taken while other streams ran: `nvidia-smi` showed 17–31 GB in use and mostly 80–100 % utilisation. Treat the timings as provisional.

**My VRAM-pressure runs.** These ran in my own page only. Each was a second `GPUDevice` holding 4–16 GB for 10–30 s: 22:15:07, 22:16:08, 22:18:13, 22:20:37, 22:22:50, 22:25:02, 22:25:59, 22:27:02, 22:41:30 and 22:42:21 (local time). Other streams' measurements taken in those windows may show paging.

## 1. KTX2 / BC7

### Encoder and writer (`tools/blender/kn_tools/bc7.py`, `ktx2.py`)

- **Modes:**
  - mode 6 (one subset, RGBA 7777 + p-bits, 4-bit indices);
  - modes 1 and 3 (two subsets, 64 partitions);
  - mode 5 (rotation: any one of R, G or B gets its own endpoints and indices, which suits ORM).
- **Per block:** the encoder picks the mode with the lowest error.
- **Partition search:** the two-subset modes first rank the 64 partitions by their exact integer line-fit residual. The 4 best are then fully quantised: p-bits are searched, and 2 least-squares refits are run.
- **Speed-ups:**
  - Identical blocks are encoded once (flat atlas padding is 30–80 % of a set).
  - The two-subset modes run only where the best one-subset error is above 16.
- **Determinism:**
  - Block statistics use exact integer sums.
  - Floating point is element-wise only, with no BLAS, matmul or unordered reductions. Ties break in a fixed order.
  - Same PNGs give the same bytes. This was checked between system Python 3.10 / numpy 2.2.6 (PIL PNG reader) and Blender 4.4's Python 3.11 / numpy 2.3.4 (built-in PNG reader): the KTX2s match byte for byte, and so does the `--selftest` digest `67b5f1fad7c0cef6`.
- **Mips:** built from the PNG with integer tables.
  - Albedo is averaged in linear light (16-bit tables, CRC-guarded).
  - Normals are renormalised.
  - ORM is a rounded box filter.
  - The chain runs down to 1×1.
- **KTX2:**
  - vkFormat `BC7_SRGB_BLOCK` (albedo) or `BC7_UNORM_BLOCK` (normal, ORM);
  - a Basic DFD with colour model BC7 and an sRGB or linear transfer function;
  - KV pairs `KTXorientation`, `KTXwriter`, `KNmap` and `KNsource`;
  - levels stored smallest first, with **ZLIB supercompression (scheme 3)**, which the browser inflates with `DecompressionStream`;
  - `kn_tools/ktx2.read` round-trips it.
- **Alpha:** these maps are opaque and the engine never reads alpha, so the encoder may spend alpha precision on RGB. A few mode-6 blocks decode to alpha 254.

**Driver.** `tools/blender/encode_ktx2.py` handles the PNG read, the mips, a parallel encode per map, `--check` (re-read and decode), `--report` and `--selftest`. `.art.json → textures.ktx2` is patched only if the PNGs didn't change while encoding, so a re-bake landing mid-run is never listed.

**`tools/assets.mjs`:**
- `--ktx2` encodes after the build.
- `--ktx2-only [type …]` encodes existing builds without Blender, using Blender's bundled Python.
- `--selftest` now also runs the encoder self-test.

**Hardware check.** The GPU decode matches my decoder bit for bit. I uploaded 48 KTX2 levels (thud, motor, bangstick and plank; albedo, normal and ORM; levels 0, 3, 9 and 10, including the 2×2 and 1×1 mips), decoded them on the RTX 5090 (`textureLoad`, `bc7-rgba-unorm`) and compared with `bc7.decode_image`: **0 mismatched bytes**, in the pane and in Chrome 155. This covers all 4 modes, thousands of mode 1 and mode 3 blocks across the partitions, and the anchor and p-bit handling. The errors reported below are therefore what the hardware shows.

### Quality: 81 sets (43 at 1024², 38 at 2048²), level 0 against the PNG

**Bar** (ASSET_PIPELINE states none, so I set one):
- albedo: PSNR ≥ 38 dB and SSIM ≥ 0.97;
- normals: mean angular error ≤ 1° and p99 ≤ 4°;
- ORM: every channel PSNR ≥ 38 dB, and binary metallic never flips.

**Metrics:**
- **"busy"** = texels in 4×4 blocks whose source varies by more than 2 in some channel, i.e. not flat padding. Whole-image PSNR is flattered by flat regions; busy PSNR is the honest number.
- **PSNR** is on 8-bit stored values (sRGB for albedo).
- **SSIM** is Wang 2004 with an 11-tap Gaussian, averaged per channel.

| Map | Whole image (min / median) | Busy texels (min / median) | Other |
|---|---|---|---|
| Albedo (sRGB) | PSNR 53.1 / 58.5 dB | PSNR 49.7 / 52.9 dB | SSIM ≥ 0.9992 on every set |
| Normal | mean angle 0.08–0.44°; p99 0.45–2.02° | mean ≤ 0.48°; p99 ≤ 3.59° | See the note below |
| ORM R / G / B | 54.0 / 53.9 / 57.8 dB minimum | 49.7 / 50.3 / 55.0 dB minimum | 0 metallic flips; worst binary-metal error 36 levels |

- **Every set passes the bar.** Worst cases:
  - albedo: zone, busy 49.7 dB;
  - normal: delay, busy p99 3.59°;
  - ORM: stitch, busy R 49.7 dB.
- **Mode mix:** mode 5 68.8 %, mode 6 25.0 %, mode 3 4.4 %, mode 1 1.8 % of blocks.
- **Outlier normals.** Some normal maps have single texels off by up to 120°: treadway 0.09 % of texels over 10°; torch and puffer fewer. I looked at them: they sit in strips of per-texel noise in the source normal map (bake artefacts in island gaps). They are not detail, and k = 16 or 64 partition candidates don't change them. See §5.
- **On a photographic Cycles crop** (512² of `tinker_lab_key.png`), as a check that the encoder isn't just lucky on easy content:
  - modes 6/1/3/5: 48.4 dB, SSIM 0.9965;
  - mode 6 alone: 42.5 dB.

**Runtime GPU fallback** (`gpuBc7`, BC7 mode 6 in WGSL) for PNG-only sets in BC7 arrays (16 maps tested):
- 45.8–53.1 dB whole image against the PNG (lowest: plank albedo);
- 8–18 ms per 2048² map including mips (the first call compiles the pipeline);
- every map above the bar.

Without it, one PNG-only set would force the whole class back to rgba8.

**Side by side.** `art/style-samples/m4_bc7_compare.png` shows motor, bangstick, plank, treadway, cog_m and mains; each row is the PNG / rgba8 render, the KTX2 / BC7 render, and |diff| × 8.
- **Settings:** in engine, tier 32, 1600 × 1200, the same camera, 30 frames settled.
- **Result:** frame PSNR between the two renders is 37.5–41.4 dB, which is the film grain and TAA jitter floor. The only structured differences are specular glints on motor's copper coil.
- **By eye:** no visible difference.

### VRAM, download and load time

- **In game** (`/?debug`, F9; the 16 GB tier was auto-detected; 92 sets loaded):

  | | VRAM total | Texture pool |
  |---|---|---|
  | KTX2 / BC7 | **3.25 GB** | **1.45 GB** |
  | `?ktx2=0` (PNG / rgba8) | **7.00 GB** | **5.20 GB** |

  - The BC7 texture pool includes 200 MB of impostor atlases and the 17 MB detail array.
  - With rgba8 the growth copies peak at 8.80 GB.
- **Set arrays only** (88 sets, `__v4.texBench`):

  | | Used | Allocated (capacity doubling) |
  |---|---|---|
  | BC7 | **880 MB** | 1,280 MB |
  | rgba8 | **3,520 MB** | 5,120 MB |

  That is a 4.0× reduction.
- **Download** for the 81 + 7 sets: KTX2 + zlib 243.5 MB fetched, against 182.0 MB of PNG (**+34 %**). On disk the 81 encoded sets are 221 MB of KTX2 against 166 MB of their PNGs. Zlib-compressed BC7 compresses worse than PNG on these flat bakes. ASSET_PIPELINE §5.3's "≈ 2 / 7 MB per set" assumed UASTC + RDO + zstd, which needs an encoder we don't have (D94).
- **Load time** (all 88 sets into a fresh TexSets, wall time to GPU done, art.json fetches excluded, 3 alternating runs each):

  | | Run times |
  |---|---|
  | KTX2 | 9.4, 7.3, 5.8 s |
  | PNG | 8.7, 8.8, 4.0 s |

  This is **no measurable difference** under heavy CPU and GPU contention. Decode work moves from the browser's PNG decoder (rgba8 upload plus GPU mips) to `DecompressionStream` plus a raw `writeTexture`. Re-measure on a quiet machine.
- **Encode time:** 12,761 CPU-seconds for 243 maps, with 12 processes on a shared CPU, 1,372 s wall. The worst single map took 187 s (a 2048² normal).

### Decision (proposed record: D94 outcome)

- **Ship KTX2 / BC7 as the desktop path:**
  - quality is far above the bar;
  - the hardware decode is verified exact;
  - VRAM is 4× smaller.
- **PNG stays** as the source, the fallback (no BC feature, `?ktx2=0`, or a set without KTX2) and the input of the GPU fallback encoder.
- **Normals stay three-channel BC7.** A BC5-style two-channel path isn't needed: the angular error bound holds, and dropping Z would need a shader change.
- **Not delivered:** no UASTC or Basis supercompression, so there is no ASTC transcode for Apple. That needs a tool approval or more in-house work.

## 2. Engine: KTX2 loader and BC7 arrays

**`gfx/ktx2.ts` (new).** It parses KTX2 (header, level index, DFD transfer function, KV), inflates ZLIB levels with `DecompressionStream`, and provides `bcLayout`.

**`look/textures.ts` (shared, Edit).**
- **When BC7 is used:** when `texture-compression-bc` is present and `TexSets.ktx2` is set (`?ktx2=0` turns it off), the size-class arrays are `bc7-rgba-unorm-srgb` (albedo) and `bc7-rgba-unorm` (normal + ORM).
- **Uploads:**
  - Sets with `textures.ktx2` write their levels as they are. Levels above the class size are skipped, so a 2048² KTX2 fills the 1024² class on the 4 and 8 GB tiers (checked on tier 8).
  - PNG-only sets go through `gpuBc7`.
  - Without the feature, nothing changes.
- **Layer codes** are reserved synchronously in call order and journalled, so replay can reproduce them.
- **Live destinations:** a class can grow while a set is downloading. This was a real bug in my first version; it is fixed with live destinations.
- **The 'textures' VRAM knob:**
  - Level 1 shrinks the 2048² class to 1024² by copying mips 1 onwards. Layer codes don't change because the shader samples by UV.
  - Level 0 rebuilds the 2048² arrays off to the side from the journal and swaps them in when complete.
  - Checked in Chrome: the 2048 class went to 1024 and back.

**`gpu.ts`.** Requests `texture-compression-bc`. This is the one line in a file nobody owns in M4.

## 3. VRAM ledger, probe and governor (`gfx/vram.ts`, new)

### Ledger

- **What it sees:** `attach(device)` wraps `createBuffer` / `createTexture`, so every allocation on the renderer's device is recorded. That includes other streams' allocations, Matter's on the shared device (D92), and allocations by modules nobody edited.
- **Sizes** come from the descriptor: format bytes or BC blocks, mips, layers, 3D depth and samples.
- **Release:** `destroy()` (patched per object) or garbage collection (`FinalizationRegistry`).
- **Pools:**
  - by label first: `gi.*`, `vol*`, `set.albedo|nrmorm`, `impostor*`, `*shadow*`, `matter*`, `keyframe*`;
  - otherwise by the innermost `vramLedger.scope(pool, fn)`, which the renderer wraps around the look, GI, particles, impostors, `setScene` (instances) and mesh uploads;
  - otherwise render target (`RENDER_ATTACHMENT`) or other.
- **Manual entries:** `register / update / release` cover memory the ledger can't see, and reservations.

### Boot probe (`probeHeadroom`, `Renderer.runVramProbe`)

**Target:**
- `'reserve'` (the default in builds): the pools allocated later, from vram.ts `RESERVE`:
  - Matter: GAME_SPEC §15.1's 0.35 + 1.0 GB, scaled by grains (2.7 GB at tier 32);
  - keyframes: 1.5 GB at 16 GB, scaled;
  - minus what Matter and keyframes already registered;
  - capped by the tier budget minus the ledger.
- `'full'`: the whole rest of the tier budget.

**Method:**
1. Allocate it as 256 MB chunks.
2. After each chunk, clear all chunks so far, timed with GPU timestamps when available.
3. Write and read back a pattern in the newest chunk.

**Stops on:**
- an out-of-memory or validation error scope;
- a failed read-back;
- two steps in a row slower per byte than 25 % of the best GPU bandwidth (with a floor);
- a long submit-to-done wall time (WDDM residency waits aren't GPU time);
- the time limit.

Everything is freed at once. A short probe pre-steps the governor to the first level whose knobs free the shortfall.

**Measured:**
- **Calm:** 5.70 GB fits in 392 ms (about 1.5 TB/s); 2.85 GB in 134–271 ms.
- **Under 10 GB of pressure:** `paging` at 0.50 GB after 1.7 s (GPU time per step jumped from 0.3 ms to 84–94 ms per GB, PCIe-class bandwidth). The governor pre-stepped to L6 and the ledger fell from 5.10 to 1.88 GB.

**Dev default.** The probe is **off on the dev server** (`import.meta.env.DEV`) while M4's streams share one GPU, because every game page boot would otherwise allocate GBs. `?vramprobe=1` or `=full` turns it on. Builds default to `'reserve'`.

### Governor (`vramGovernor`)

**Knobs.** Each registers itself with discrete levels and an estimate of the bytes it frees:

| Knob | Levels | Notes |
|---|---|---|
| Volumes (volume.ts) | slots full, ½, ¼, none | none: blasts use their particle fallback; freed slots end their grids, and returning slots are primed |
| GI (gi.ts) | full, half resolution, off | half: 256³ → 128³ and probe grid 32 → 16 at tier 32; off: no SDF or probes, consumers use their fallbacks; layouts don't change, so no pipeline is rebuilt |
| Textures | full, 1k | see §2 |

**Schedule** (1 = the first step down): volumes ½ → GI ½ → textures 1k → volumes ¼ → GI off → volumes off. It **never touches Matter, the sim or gameplay**.

**Pressure signals:**
- an uncaptured `GPUOutOfMemoryError`;
- device loss;
- a probe shortfall;
- **spikes:** 3 frames over max(100 ms, 4 × the healthy frame) within 3 s;
- **sustained slowdown:** the median of the last 30 frames over max(2.5 × healthy, healthy + 25 ms) for 1.5 s.

**Qualifier.** With GPU timestamps, a slow frame counts only if the timed GPU work grew with it. Paging stretches the passes; a throttled presentation (an occluded window, the hidden dev pane) stretches only the interval. Without this rule, the hidden pane's 60 ms rAF frames tripped the governor at boot. Pressure is rate-limited to one step a second, except device loss.

**Restore.** One level up after 20 s without pressure. If pressure returns within 10 s of a step up, that level is pinned for 120 s.

### Reproducing M3's oversubscription stall

Set-up: my dev page (`src/gfx/vramtest.html`) at tier 32 with 86 textured parts, smoke volumes and GI (5.1 GB in the ledger). Pressure came from a second device holding 8–16 GB and clearing one 256 MB chunk per frame in rotation, so its working set over a second is all of it.

**Reproduced, governor off:**
- **22:18:13–22:18:34** (14 GB): frames averaged 30–200 ms with spikes to 905 ms and 1–2 s gaps. Before and after: 16.9 ms.
- **22:22:50–22:23:21** (8 GB, with others holding 29–31 GB): the page froze completely for the whole 20 s.
- **Shortly after load at 22:14** (no pressure of mine; others holding about 30 GB): 470–680 ms frames for several seconds, the M3 pattern.

**Governor on:**
- **22:20:37** (first rule set, spikes only): it stepped once (volumes ½, ledger 5.14 → 4.30 GB). Frames stayed slow (71 ms average): the median-based spike rule missed uniformly slow frames.
- That run led to the sustained rule and the GPU qualifier.
- **22:27:02** (16 GB): one step. The external load then varied (others swung between 10 and 31 GB) and there was no further paging of my page.

**Honest conclusion:**
- The stall reproduces.
- The governor detects it and frees memory as designed: up to 3.2 GB at tier 32, measured in the ledger.
- A clean governor-off / governor-on frame-time comparison wasn't possible. WDDM's choice of whom to evict among processes, and other streams' load (17–31 GB, 80–100 %), dominated run-to-run variance.
- I stopped after 10 bursts so as not to keep disturbing other streams.
- Re-measuring on a quiet GPU is an open item (§5).

### Device-lost recovery

**`Renderer.recover()`:**
1. On `device.lost` (any reason except an intentional destroy; `simulateDeviceLoss()` counts as a loss), a fresh Renderer is initialised on a new adapter and device.
2. Its GPU state is moved into this one. The CPU state stays: meshes and skins (re-uploaded), scene, camera, view modes and look settings.
3. Then these are replayed: the look environment and practicals, GI switches and set statics (`Gi.restoreFrom`), the texture sets (journal replay, same layer codes, so meshes stay valid), and the decal atlas.
4. RenderHooks are dropped, and `onRestore(cb)` subscribers rebuild their own GPU resources:
   - **Fx** rebuilds its volumes, debris, rings, beams and arcs (a small edit in fx.ts);
   - **TerrainView** too (terrain.ts).
5. The sim worker is untouched. `main.ts` didn't need a change: draw() is a no-op while recovering, and `lostReason` (main's blocker) is set only if recovery fails.

**Measured** (simulated loss):

| Where | Rebuild | Notes |
|---|---|---|
| Game page (`/?debug`), Chromium 152 pane | 314 ms and 1,933 ms (two losses in a row) | no console errors; Fx rebuilt on the new device |
| Game page, Chrome 155 | 293 ms | sets reloaded after 874 ms; no errors |
| Dev page, tier 32, 84 sets | 436 ms | sets reloaded after 4.6 s |

- **Render check:** the frame before and after a loss matches at 41.7 dB, the grain floor (`scratchpad/v4/out/loss_pair.png`).
- **Two bugs found and fixed on the way:**
  - critters' `setSkinned` re-uploaded skins to the dying device mid-recovery;
  - the skins' old buffers were seen by the first rebind.

### Debug perf readout

F9 or `?debug` adds a VRAM line to `ui/hud.ts`'s perf line (`Renderer.vramLine()`), for example:

`VRAM 3.25 GB of 10.40 GB (peak 3.55 GB): tex 1.45 GB · vol 773 MB · gi 40 MB · part 640 MB · rt 87 MB · shadow 136 MB · mesh 77 MB · … · governor L0 full · probe off · sets 91 BC7 (81 ktx2, 10 png, 10 gpu-encoded)`

It also shows pressure signal counts, the probe result and `device restored ×N`.

## 4. Files

**Mine (new):**
- `apps/game/src/gfx/vram.ts`, `apps/game/src/gfx/ktx2.ts`;
- `apps/game/src/gfx/vramtest.html` / `.ts` (dev page: `__v4.pressure / release / loss / decodeCheck / gpuEncodeCheck / texBench / view / snap`);
- `apps/game/test/vram.test.ts`: 8 tests covering texture sizes, the ledger, the governor's schedule, rate limit, sustained rule, GPU qualifier and probe pre-step, and every listed KTX2 being a full BC7 chain;
- `tools/blender/kn_tools/bc7.py`, `tools/blender/kn_tools/ktx2.py`, `tools/blender/encode_ktx2.py`;
- `art/style-samples/m4_bc7_compare.png`.

**Shared, by Edit:**

| File | Change |
|---|---|
| `gfx/look/textures.ts` | BC7 arrays, KTX2 upload, `gpuBc7`, journal and replay, knob |
| `gfx/gi.ts` | `reconfigure`, knob, `restoreFrom`, `dispose` |
| `gfx/volume.ts` | slot limit, knob, `dispose` |
| `gfx/renderer.ts` | ledger attach and scopes, OOM to pressure, governor per frame, probe, `vramLine`, `recover` / `onRestore` / `simulateDeviceLoss`, `setSkinned` guard |
| `tools/assets.mjs` | `--ktx2`, `--ktx2-only`, encoder self-test |

**Outside my list, minimal additive edits** (listed so their owners know):

| File | Owner | Change |
|---|---|---|
| `gfx/gpu.ts` | none in M4 | requests `texture-compression-bc` |
| `ui/hud.ts` | U4 | one line: the VRAM readout |
| `gfx/fx.ts` | R4 | `onRestore` rebuild in the constructor |
| `gfx/terrain.ts` | none in M4 | `onRestore` |

**Build outputs:** 81 sets got `<type>.tex.{albedo,normal,orm}.ktx2` and a `textures.ktx2` entry in their `.art.json`. The rest of the art.json is unchanged, in export.py's layout.

## 5. Open issues and hand-offs

- **MX / MI / R4: Matter and device loss.**
  - Matter runs on the renderer's device (D92). After a loss its buffers are gone. MI should subscribe with `renderer.onRestore(cb)` and restore from the MATR CPU copy.
  - R4's `gfx/matter` RenderHook isn't re-added after a loss; it needs `onRestore` too, as Fx and TerrainView do.
  - **Ledger:** label Matter buffers `matter.*`, or wrap creation in `vramLedger.scope('matter', …)`. Use `vramLedger.register('matter', …)` for anything allocated elsewhere. The probe then subtracts it from its reserve, and the governor never touches it.
- **Sets without KTX2 yet** (other streams still building, so I left them alone): arc_tower, biscuit, cork_blaster, dusty, fishbowl, gotcha_box, grit_hopper, henny, hourglass, inflator, marble_hopper, punchline, sponge, sprinkle_can, suncell, vac and waterwheel. They load through the GPU fallback encoder.
  - When E4a / E4b / E4c land: `node tools/assets.mjs --ktx2-only` (or build with `--ktx2`).
  - A re-export drops `textures.ktx2` from the art.json, so a stale KTX2 is never used, but re-exported sets also lose the BC7 path until re-encoded.
  - Consider making `--ktx2` the default (orchestrator call).
- **Particles aren't a governor knob.** The pool (1.25 GB at tier 32, 640 MB at 16) is R4's `particles.ts`; it could join the schedule with a resize.
- **Docs to update** (not my files):
  - **ASSET_PIPELINE §5.2 / §5.3 / §8 and §1** (toktx, UASTC + RDO + zstd): the shipped format is in-house BC7 in KTX2 with ZLIB, `<type>.tex.<map>.ktx2`, listed in `.art.json → textures.ktx2`. The download estimate becomes about 1.1 MB per 1024² set and 2.4–7 MB per 2048² set.
  - **RENDERING §11:** the governor's VRAM schedule and signals as built, next to the look governor.
  - **DECISIONS:** D94's outcome (§1 above).
- **Source normal maps** carry noise strips (bake artefacts in island gaps, for example treadway). It's harmless, but it inflates PNG and KTX2 size and shows up as angular-error outliers (E3c / E4c texture step).
- **Re-measure on a quiet GPU:**
  - KTX2 against PNG load time;
  - the governor on / off frame-time A/B under a controlled oversubscription.
- **Encode cost:** a full re-encode is about 12,800 CPU-seconds (23 min wall on 12 processes). It's deterministic, so CI can cache per PNG hash.
- **Other streams' failures** (reported, not fixed):
  - `pnpm -s typecheck` fails in `packages/format/test/matter_header.test.ts` (2 errors) and `packages/matter/test/matter.test.ts` (10 errors). Both are MI / MX tests in progress, and because of them the root script stops before the game typecheck. `tsc -p apps/game` on its own is clean.
  - `vitest apps/game packages/assets`: 1,555 passed, 18 failed, 3 skipped. The failures are all in `packages/assets/test/m4_parts.test.ts` (E4a, 8: M4 part texture sets and ZIPPY's colliders) and `textures_m2.test.ts` (E4c, 10: big_top's missing set, slot-mean hue checks). My tests pass.
