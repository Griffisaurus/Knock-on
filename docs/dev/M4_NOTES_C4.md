# M4 notes: C4 · capture

Stream C4 of [M4_PLAN.md](M4_PLAN.md), contract 5: offline render, video, GIF, WebP, photo mode, the capture dialog and the Cascade Report's Share card / Record clip (GAME_SPEC §17.4, RENDERING §13, UI_UX §4.9 / §4.11, D94).

Every number below was measured on the test system (RTX 5090, maxTextureDimension2D 8192; Windows 11; Chrome 155 headless with the GPU, own profile) against my local test server (`KNOCKON_PORT=8806`, scratch `KNOCKON_DATA`, `KNOCKON_STATIC=none`) and Vite :5206 (`bench/vite.config.ts` with `KN_BENCH_PORT=5206 KN_BENCH_HOST=8806`, which also gives `/bench-out/` for saving outputs). Twelve other streams were using the GPU at the same time, so timings are provisional (rule 11). The `nvidia-smi` reading is given next to each one.

## What's there

| Feature | Files | Notes |
|---|---|---|
| **Frame-index clock** | `capture/clock.ts`, `run.ts` (capture API) | **Ticks:** each frame seeks the sim worker's playback to an exact tick over the BakeStore with `run.captureSeek(tick)`. The worker bakes ahead of a held playhead on its own, so a clip streams: bake head ≥ capture head, and the BakeStore's 3-minute span never limits a 5-minute clip. **Time:** the main thread's `performance.now` is replaced by a virtual clock that advances exactly 1/fps per frame. Every Spectacle system (renderer particles and hooks, fx, cameras, critters, the look pass's DOF focus and governor, the flash limiter) reads it, so the spectacle steps a fixed dt per frame however long the frame took. **Warps:** hitstop and slow-mo still play, but they stretch clip time (fewer ticks per frame) rather than wall time. |
| **Offline render** | `capture/offline.ts` | **Quality:** forced to the tier max: governor off and reset, native resolution with 4× MSAA (no TAA upscale). **Size:** the canvas gets an exact-aspect CSS box plus `resolutionScale`, so the drawing buffer is exactly W×H; it doubles as the live preview. **Device limit:** past `maxTextureDimension2D` the frame is downscaled to fit, and the result says so. Tiling is not implemented: the renderer has no sub-frustum hook. **Before rendering:** waits for texture sets to finish streaming, then a 1 s preroll when the clip doesn't start at 0. **Run:** in Build it records a solo preview that only the test system sees, then stops it. **Camera sources:** Current view (fixed), Director, Ride, Saved path. **Length:** up to 5 min. **Safety:** cancel at any frame, and everything is restored afterwards (canvas, quality, clock, camera mode, audio mute, playback). |
| **MP4** | `capture/codecs.ts`, `capture/mp4.ts`, `capture/mp4.worker.ts`, `capture/video.ts` | **Encoder:** WebCodecs `VideoEncoder`, hardware first, AV1 → HEVC → H.264 within hardware, then the same order in software. **Codec level:** picked from the size and rate (8K60 asks for AV1 6.1, HEVC 6.1 or H.264 6.1). **Muxer:** written in-house, running in a worker. It writes `ftyp`, then `mdat` with a 64-bit size patched at the end, then `moov` (stts, stss, ctts only when timestamps are reordered, stsc, stsz, stco/co64), streamed into an **OPFS** file through a sync access handle, with memory as the fallback. **AV1:** av1C is built from the codec string plus the sequence header OBU, and temporal delimiters are stripped. **AVC / HEVC:** length-prefixed samples with the encoder's avcC / hvcC. **Cleanup:** old clips are removed from OPFS at boot and before each new clip. |
| **GIF** | `capture/gif.ts`, `capture/gif.worker.ts` | **Palette:** one 255-colour palette for the whole clip (no palette flicker), from median cut over a 15-bit histogram. **Dither:** 4×4 ordered dither (temporally stable). **Frames:** changed-rectangle frames, with unchanged pixels transparent (disposal 1) and a small colour tolerance so grain doesn't rewrite every frame. **LZW:** our own variable-width encoder with clear at 4096. **Timing:** per-frame delays in cumulative centiseconds; GIF frame rates are 10/20/25/50. Rendered at 2× and downscaled. **Memory:** the dialog caps a GIF at 256 MB of frame data, 2 bytes per pixel per frame. |
| **WebP** | `capture/webp.ts`, `capture/video.ts` | **Stills:** `canvas.toBlob('image/webp')`. **Animated:** our RIFF / VP8X / ANIM / ANMF writer wraps each frame's VP8 / VP8L (+ ALPH) chunks, lifted from the browser's still encoder. Only the changed rectangle (even-aligned) is stored. An unchanged frame lengthens the previous frame's duration instead. |
| **Photo mode (F10)** | `ui/photo.ts`, `capture/index.ts` | **Layout:** HUD hidden; a left glass mini-panel with orbit (yaw, height, distance), focal length (36 × 24 frame), aperture (thin-lens CoC through the look pass's photo DOF, focused on the orbit centre; off = no DOF), exposure (EV), LUT on/off, and a rule-of-thirds grid (DOM, never captured). **Capture:** Screen / 1080p / 1440p / 4K / 8K, as PNG or WebP. **Camera path:** "Add key (K)" stores keys per world for the Saved path source. **Input:** an orbit layer over the viewport (drag orbits, right-drag pans, wheel dollies), so building never sees those clicks. **Time:** time stands still (dt 0), and a run is held on the test system only; the partner's playback carries on. **Exit:** Esc or F10. |
| **Capture dialog** | `ui/capture.ts` | **Fields:** camera source, start / end, format, resolution, fps, the encoder that will be used ("AV1 (hardware)"), and an estimated time (live GPU time × pixel ratio + seek / encode). **While recording:** a progress bar with frame n / N, ms per frame, elapsed / left, and Cancel (Esc). **Result:** preview (`<video>` or `<img>`), file size and codec, Save, and Copy image for stills. **Glass:** a modal glass surface. **Opened by:** Shift+F10, photo mode's "Record clip…", and Cascade Report › Record clip. |
| **Cascade Report** | `ui/cascadepanel.ts`, `capture/sharecard.ts` | **Share card (image):** a 1600 × 900 PNG of the current view at full quality, with the wordmark, world and run, the score, title tier, stats and longest chain in Unbounded / Inter / JetBrains Mono. **Record clip:** opens the dialog. Both buttons are live when main.ts sets `cascade.onShare` / `onClip`; otherwise they stay "(soon)". |
| **Reduce motion** | | **Panels:** no panel transitions. **Results:** a finished clip doesn't autoplay. **Camera:** photo mode's camera has no easing or shake. **Clips:** they follow the comfort settings (shake, hitstop, slow-mo). |

### Shared-file edits (the Edit tool, except where noted)
- **`main.ts`:** creates `CaptureController`, wires the Cascade Report and the debug hook, adds the `capture.keydown` hook, and makes `frame(external)` changes:
  - an offline render skips main's rAF frames;
  - photo mode freezes dt and timeScale;
  - `capture.shot()` overrides the camera rig;
  - `clean` hides the ghost, ports, cursor, hover, pings, trails and partner marker in photos and clips;
  - `ownsQuality` stops the per-frame `renderer.upscale` write;
  - external frames don't schedule another loop.
- **`run.ts`:** `captureBegin` / `captureSeek` / `captureEnd` / `capturing`.
  - **While a capture holds playback:** shared play changes are remembered, not applied; `warp()` goes to the capture clock; the host's bakedMin is held back and restored afterwards; Bake & Watch completion doesn't restart playback; `reset()` ends a capture.
  - **Process note:** one batch of these `run.ts` edits was made with a scripted read-replace-write instead of the Edit tool, within seconds. MI's later `run.ts` changes are intact, and so are mine. Every other shared edit used the Edit tool.
- **`ui/cascadepanel.ts`:** `onShare` / `onClip`, and live buttons when they're set.
- **`ui/glass.ts`** (U4's file, the U3 rule): added `photo` (`#photo`, priority 90) and `capture` (`#capture-dialog`, modal) to `GLASS_SURFACES`. The contrast test covers them and passes.
- **`bakestore.ts`:** no change was needed (the worker's store already serves exact ticks).

## Codecs found on the test system

`VideoEncoder.isConfigSupported` in Chrome 155. `prefer-hardware` is the hardware column; `prefer-software` is the software column.

| Size @ 60 fps | AV1 | HEVC | H.264 |
|---|---|---|---|
| 1920×1080 | hardware ✓, software ✓ | hardware ✓, software ✗ | hardware ✓, software ✓ |
| 3840×2160 | hardware ✗ (✓ with a 30 fps hint), software ✓ | hardware ✗ (✓ with the hint), software ✗ | hardware ✗ (✓ with the hint), software ✓ |
| 7680×4320 | software ✓ only | ✗ | ✗ |

- **Chrome's hardware ceiling:** it lists the hardware encoders only up to **1080p60 and 2160p30**.
  - Measured at 2560×1440: 30 fps passes, 60 fps fails.
  - Measured at 4096×2160: 30 fps fails.
- **The frame-rate hint:** above that ceiling, `chooseCodec` retries hardware with `framerate: 30` and the bitrate scaled by 30 / fps. An offline render feeds frames as fast as it draws them, and the timestamps carry the real rate.
  - Verified: 4K60 hardware AV1 decodes and plays as 60 fps.
- **8K:** there's no hardware path in Chrome, so 8K uses software AV1.

## Measurements

Method: wall time from the first clip frame to the last. A frame's time includes the seek, the draw, the VideoFrame, encoder backpressure and waiting for the GPU queue. Sizes are the saved files. `nvidia-smi` utilisation and memory were read just before each run.

| Clip | Codec | Frames | ms / frame | File | GPU before |
|---|---|---|---|---|---|
| 1080p60, Director, 4 s run (4.6 s clip, slow-mo) | AV1 hardware | 276 | 20 · 30 | 4.2 MB | 99 % / 25.6 GB · 6 % / 31.3 GB |
| 2160p60, Director | AV1 hardware, 30 fps hint | 276 | 26 | 16.3 MB | 11 % / 12.7 GB |
| 4320p60, Director, 1.0–2.5 s with 1 s preroll | AV1 software | 126 | 82 | 16.2 MB | 6 % / 12.4 GB |
| **5:00** 720p30, fixed camera | AV1 hardware, OPFS | 9,000 | 18 (161.7 s total) | 77.4 MB; plays, seeks to 290 s | 7 % / 19.3 GB |
| 360p25 GIF, Director | ours | 116 | 26–33 | 13.4 MB (dither 1, exact) → 11.0 MB (dither 0.75, tolerance 10) | |
| 360p25 GIF, fixed camera | ours | 116 | 33 | 7.0 MB | |
| 360p20 GIF, fixed camera | ours | 92 | 50 | 5.4 MB | 6 % / 31.3 GB |
| 360p30 WebP, Director | ours, lossy q .85 | 138 (all full) | 30 | 5.8 MB | |
| 360p30 WebP, fixed camera | ours | 138 (104 stored, 67 partial) | 55 | 3.0 MB | 6 % / 31.3 GB |

| Still | Time | File |
|---|---|---|
| Photo 8K PNG (7680×4320) | 8.3 s (mostly PNG encode) | 54.2 MB |
| Photo 4K PNG | 2.8 s | 14.5 MB |
| Photo 4K WebP, f/2.8 | 0.97 s | 1.16 MB |
| Share card 1600 × 900 PNG | 0.68 s | 2.8 MB |

Encoder-only checks (synthetic 2D canvas, `VideoSink` + muxer + `<video>`), in ms per frame including drawing the 4K canvas:

| Size @ 60 fps | Encoder | ms / frame |
|---|---|---|
| 1080p60 | H.264 hardware | 6.3 |
| 1080p60 | HEVC hardware | 6.4 |
| 1080p60 | AV1 hardware | 7.4 |
| 4K60 | AV1 hardware, with the hint | 26.5 |
| 4K60 | AV1 software | 43 |
| 8K60 | AV1 software | 67 |

Every file played in `<video>` at full size (`getVideoPlaybackQuality` over 1 s of playback: 0 dropped frames for the 1080p and 4K game clips, 1 for the 8K clip and for each synthetic clip), and every GIF / WebP decoded in `ImageDecoder` with the expected frame count and durations.

## Samples (`art/style-samples/capture/`)

| File | Size | What |
|---|---|---|
| `c4_clip_1080p60_director.mp4` | 4,158,283 B | POWDER KEG demo, Director camera, AV1 hardware, 276 frames |
| `c4_clip_1080p60_director_sheet.png` | 2,326,740 B | 6 frames of it, decoded by Chrome's `<video>` |
| `c4_clip_360p20.gif` | 5,402,753 B | fixed camera, 92 frames, 50 ms delays |
| `c4_clip_360p30.webp` | 3,040,108 B | animated, fixed camera, 104 stored frames |
| `c4_photo_4k_f2.webp` | 1,157,592 B | photo mode, 3840×2160, 50 mm at f/2.8, focus on the debris |
| `c4_share_card.png` | 2,831,606 B | the Cascade Report card after the POWDER KEG run |

The test `apps/game/test/capture.test.ts` parses every sample file back with our own readers.

## Tests

`npx vitest run apps/game/test/capture.test.ts`: **17 tests pass.**
- **MP4 muxer:**
  - writes a file whose boxes walk back with byte-identical samples, 4 chunks and a 64-bit mdat;
  - writes stss only with non-key frames, and ctts only when timestamps are reordered;
  - builds av1C and strips temporal delimiters;
  - refuses to finish without a decoder config;
  - picks timescales and codec levels.
- **GIF:**
  - LZW round-trips 300k symbols across dictionary resets;
  - median cut and the bin LUT;
  - changed-rectangle encoding decodes back pixel for pixel;
  - the tolerance mode is smaller and never further off than its tolerance;
  - the centisecond clock.
- **WebP:**
  - ANMF wrapping of VP8 / VP8L stills parses back;
  - odd offsets and frames outside the canvas are refused.
- **Recorded samples:** every MP4 walks back, AV1 samples carry no temporal delimiters, and every GIF and WebP decodes.
- **Camera path:** keys, holds, JSON.

`npx vitest run apps/game`: 117 pass; 3 fail in 2 files, none of them C4's (see below). `pnpm --filter @knockon/game typecheck`: none of the errors are in C4 files. The remaining errors are in `packages/sim` (other streams).

## For other streams

- **U4:**
  - **Glass:** `photo` and `capture` are registered in `GLASS_SURFACES`.
  - **Styles:** C4's CSS is injected by `ui/capture.ts` (`ensureCaptureStyles`), not `styles.css`. It hides `#viewport`'s children under `:root[data-photo]` / `:root[data-capturing]` with `visibility: hidden`, so GlassManager doesn't count them.
  - **Keys:** F10 / Shift+F10 are taken. Photo mode swallows the build keys after main's chat / palette checks.
  - **Possible conflict:** your `KeyboardBuild` listens on its own and may still steer its cursor in photo mode (harmless, but you may want to check `document.documentElement.hasAttribute('data-photo')`).
- **R4 / V4 (renderer):** two hooks would replace C4 workarounds:
  1. An explicit frame clock (`renderer.clock` or a `now` argument to `draw`). C4 swaps `performance.now` during captures today.
  2. A sub-frustum (projection offset) for tiled renders past `maxTextureDimension2D`. Not needed on the test system, whose 8192 limit fits 8K.
- **F4 (audio):** clips are silent; the game audio is muted while a clip renders.
  - Audio in clips needs offline audio: an OfflineAudioContext render of the same events, driven by tick, then `AudioEncoder` → an MP4 audio track. The muxer is single-track today.
- **MI:** `run.ts` now has the capture API above. Please keep `captureSeek` resolving on the worker's exact `frame.tick`.

## Other streams' failures seen (reported, not fixed)

1. **Black parts (texture arrays).** Around 22:00, every textured part rendered black, live as well as in captures. Chrome logged 576 errors of this form in one load: `WebGPU: Destroyed texture [Texture "set.albedo.1024"] used in a submit` (CopyTextureForBrowser into `set.albedo.1024` / `set.nrmorm.1024`). That's `gfx/look/textures.ts` recreating an array while uploads are in flight. Gone by 22:08; the samples were recorded after that.
2. **Renderer exception.** At about 22:00, `renderer.ts` threw `this.maybeProbe is not a function` in `draw()` on load, so main's frame loop never started. It was transient: someone was mid-edit.
3. **`apps/game/test/worldseed.test.ts` fails to load.** `run.ts` now imports `@knockon/matter/gpu`, which reads `GPUBufferUsage` at module top: `ReferenceError` in Node. MI's change.
4. **`apps/game/test/bakestore.test.ts`: 3 failures.** `StateArrays` gained `mf` (MI), and the test's state arrays don't have it, so `keep()` reads `undefined.length`.
5. **Root `pnpm -s typecheck` fails.**
   - `packages/matter/test/matter.test.ts`: missing exports (MX).
   - `packages/sim/src/channels/m4_*.ts`: new EventKinds not in the table yet (A4).
   - `packages/sim/src/critters/m4.ts` and `machine.ts`: CritterHost (B4 / J4).
   - `packages/sim/test/critters.test.ts`: the new species (B4).
   - Because the root check fails, the game's half of `pnpm -s typecheck` doesn't run. I ran it directly.

## Open issues

- **Clips are silent** (see F4 above).
- **Tiling past the texture limit is not implemented:** it downscales and says so. On the test system 8K fits, so it never triggers.
- **Clock swap side effects:** while a clip renders, the main thread's virtual clock also feeds the net client's presence throttle and RTT samples. They're only read at connect and for presence, so nothing broke in testing, but a long render shows a stale RTT until the next clock sample.
- **GIF size:** GIF of a moving 3D camera is inherently large, about 95 KB per 640×360 frame. The dialog offers 320p–540p and warns past the memory cap. MP4 or WebP is the better share format.
- **Share card from an old report:** clicking Share card on a report left open from the previous run, after a new run has started, uses that report with the new view.
- **Hardware above 1080p60 / 2160p30 relies on the frame-rate hint.** If a future Chrome rejects it, the fallback is software AV1, which is slower but correct.
