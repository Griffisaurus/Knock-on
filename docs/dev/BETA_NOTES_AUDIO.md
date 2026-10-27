# Beta notes: stream AUDIO

Status: **done** (2026-10-25). Decision: **D127** ([DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md)).

**Scope** ([BETA_POLISH_PLAN](BETA_POLISH_PLAN.md)): the five audio gaps F5 recorded ([M5_NOTES_F5](M5_NOTES_F5.md) "Deviations"), plus the optional BUZZ startle cue now that PARTSIM's startle (D121) exists.

**What changed:** everything stays procedural. There's no sim change, no golden change, and nothing in `capture/**`.

## What changed

| Gap | Fix |
|---|---|
| **GRAV WELL repel had no sound of its own.** Audio never saw the mode. | **No state byte is needed.** Attract / Repel is the part's `mode` prop (static during a run; `channels/m5_field.ts` reads `p.props.mode`). When a run starts, main.ts hands the director the props of `AUDIO_PROP_TYPES` (`GameAudio.setPartProps`). The repel loop was rebuilt as the attract hum turned inside out: a fifth higher (75 Hz) with brighter partials, the pitch bumping **up** twice a second where Attract dips, glints sweeping up and outward, and air pushed out. The spin-up plays 22 % faster (brighter). Without props, F5's `armed` stand-in still picks Repel. |
| **FORCE WALL hum was fixed at 0.3 m².** | Area = `width × height` props (0.01–1 m²). Loudness: the gain goes with √area (a radiator's power goes with its area), +11 dB across the range. Spread: the panner's reference distance grows with √area, 0.6 → 1.4 m, so a big field fills more of the room and carries further. Big walls also hum a little deeper (rate 1.04 → 0.95). The on / off zip scales with √area too. |
| **The zero-g ring drones ignored `env.zones`.** | `setEnvironment(env, preset, air, zones)`. main.ts passes `doc.env.zones`, where undefined means on. `Ambience.setZones`: off fades each ring drone out (0.5 s) and frees its voice; on fades them back in. |
| **RIFT GATE hums were hashed per gate.** | The director pairs gates the way the sim does (`riftInit`: one colour in part order, the 1st with the 2nd, the 3rd with the 4th). A pair's loops carry `LoopOpts.sync = rift:<colour>:<pair>`. A synced group plays **one shared `AudioBufferSourceNode`** into each member's own filter, gain and panner. The phase lock is exact, even when one gate comes into range later, and it costs one source less. The pair also shares its transit spin-up (the max of both gates' boost), so the shared playback rate never fights. A member that stops fades for 0.4 s, then its chain is disconnected (`sweepShared`); the source stops with its last member. |
| **Matter in clips lagged 1–3 frames** (measured: 2.75 frames at 60 fps). | See "Matter in clips" below. |
| **BUZZ startle** (optional, PARTSIM D121) | **No event is needed.** PARTSIM puts BUZZ in the shared `startled` FSM state for 0.6 s with a `!` emote. On that state edge, `buzz.ts` plays `buzz/startle`: a short yelp ("bip-BIP!", up a sixth) over a rotor surge (blade-pass 300 → 240 Hz, a gust of duct air), about 0.3 s, 3 variations. It stands in for the alarm whoop the `startled` clip and the emote would bark, which is kept for tumbles. The rotor loop adds +0.25 thrust during the bob. |

### Matter in clips

The cause was in the offline audio path: three separate delays.

1. **The live probe is throttled to 30 Hz** (`PROBE_EVERY`), so at 60 fps the probe skipped every other frame.
2. **The probe's GPU readback** (`mapAsync`) resolves during a later frame, and the field was applied whenever it arrived.
3. **The granular worklet gets its params through its message port**, which is asynchronous to the offline render. Posts were also throttled to one per 20 ms of audio time, which is less than once a frame at 60 fps.

**The fix** stays inside `audio/**`. capture/offline.ts already awaits `track.at(i)`, so no capture-side hook was needed.

- A clip's director (`clipSync`) probes on every frame, and `matter.update` moves out of `frame()` into `GameAudio.clipSettle()`.
- `ClipAudio.advance(i)` now chains: `clipSettle()`, then `suspend((i + 1) / fps)`, then resume.
  - `clipSettle()` awaits the readback of that frame's probe (`MatterProbe.pending`) and applies it at the frame's time, i / fps.
  - It posts the params with a sequence number appended. `matter-processor.js` echoes the number once the params are in. `MatterAudio.synced()` waits for that echo, with a 250 ms timeout; after three timeouts it stops waiting, which is the old behaviour.
- The next frame's `at(i + 1)` waits on that chain, as before.
- A clip's events also lose the live mix's 10 ms scheduling margin, because the offline context is suspended exactly on the frame.

**Result:** Matter grains start on the same sample as an Impact event on the same frame. Both sit 0.67 frames (11 ms) after the frame. That's the master chain's lookahead (the glue `DynamicsCompressorNode`'s and the limiter's 5 ms), common to every clip sound. Two renders, one with random wall-clock stalls, are identical.

## Files

| File | What |
|---|---|
| `audio/m5.ts` | `PartProps`, `AUDIO_PROP_TYPES`, `wallArea`; `M5Parts.setProps`, `repel()`, `riftPair()`; the GRAV WELL, FORCE WALL and RIFT GATE branches; the rebuilt `loop/grav_repel`; the `wall` loop law |
| `audio/index.ts` | `setPartProps` (forwarded to a clip's director); `setEnvironment(…, zones)`; shared loop sources (`LoopOpts.sync`, `shared`, `sweepShared`); `clipSync`, `clipSettle()`, per-frame probing in clips; no 10 ms margin on clip events; stats `clipSettles`, `matterAcks`, `matterAckTimeouts` |
| `audio/types.ts` | `LoopOpts.sync` |
| `audio/ambience.ts` | `setZones()`: the ring drones follow `env.zones` |
| `audio/matter.ts`, `audio/matter-processor.js` | Sync mode: a post every update with a sequence number, the worklet's echo, `synced()` |
| `audio/matterprobe.ts` | `pending`: the newest request's readback |
| `audio/clip.ts` | `advance()` settles the frame first; `ClipAudio.last` carries `probes`, `matterAcks`, `matterAckTimeouts` |
| `audio/buzz.ts` | `buzz/startle` (3 variations) on the `startled` state edge; the bob's thrust |
| `audio/testbeta.ts` (new) | 8 offline checks (below) |
| `audio-test.ts` (Edit, 2 lines, tagged) | Runs `offlineBeta` after the clip checks |
| `main.ts` (Edit, 3 small edits, tagged `AUDIO (beta, D127)`) | Imports `AUDIO_PROP_TYPES`; `audio.setPartProps(…)` on the switch to running, next to `setPaths`; `doc.env.zones` as `setEnvironment`'s 4th argument |

## Measurements (the test system, 2026-10-25)

Offline renders in headless Chrome 155 over CDP, on local Vite at :5326 (no CSP). Other streams were sharing the GPU and CPU, so the timings are provisional (rule 11).

| What | Before | After | Method |
|---|---|---|---|
| GRAV WELL: energy above 300 Hz | attract 5.5 %, "repel" 5.5 % (the same loop) | attract 5.5 %, repel **21.3 %**; RMS −23.8 vs −26.2 dB | the Mode prop 0 then 1, 2 s windows |
| FORCE WALL hum RMS at 1.5 m (0.1 × 0.1 / 0.6 × 0.4 / 1 × 1 m) | −27.3 / −27.3 / −27.6 dB | **−40.0 / −28.9 / −21.5 dB** (span 18.5 dB) | sizes from props |
| The same at 6 m | −40.2 / −40.2 / −40.4 dB | **−52.5 / −41.7 / −34.6 dB** (span 17.8 dB) | |
| Zero-g ring drone at 1.5 m from a Bay 2 ring, zones on → off → on (its 105.5 Hz fifth, Goertzel) | no change (voices 3 → 3 → 3) | **−57.8 → −74.8 → −58.2 dB**; ambience voices 3 → 1 → 3 | `setEnvironment(…, zones)` toggled at 4 s and 8 s |
| RIFT pair, gates hard left and right: L·R correlation at lag 0, best lag | −0.038, 1,467 ms apart | **0.997, 0 ms**; L − R residual −21.5 dB (the stereo reverb tail) | the second gate joins 1.3 s after the first |
| Matter onset in a clip vs its frame (60 fps), three renders | 2.75 / 2.75 / 2.75 frames | **0.67 / 0.67 / 0.67 frames, equal to an Impact event on the same frame**; renders identical with stalls; 150 probes, 90 worklet acks, 0 timeouts | a synthetic GPU field (4,096 grains, set moving on frame 60) through `GameAudio.clip()` the way capture/offline.ts drives it |
| Clip-render cost of the Matter settle | — | offline harness: about +3 ms per frame of wall time (the readback wait), overlapped by the capture's own `onSubmittedWorkDone`. In game (720p30 Director, a GRIT HOPPER pouring): 60.3 / 42.0 ms per frame with sound vs 55.9 / 47.5 without (A/B twice): **no measurable cost** | `capture.startClip` with `host.clipAudio` on and off |
| Voices and the ceiling | M5 stress 53 / 64, −1.05 dBTP | M5 stress **53 / 64**, −1.05 dBTP; beta stress (8 × 1 m² walls, 4 repel wells, 4 rift pairs, the Hangar) **35 / 64**, −1.05 dBTP, GR max 0.8 dB; max true peak over all 77 checks **−1.03 dBTP** (M4 stress, unchanged) | the audio test page |
| Clip determinism (F5's check) | −134 dB | −132 to −135 dB (bound −120) | two renders, one with stalls |

## Checks

- **Audio test page:** **77 / 77** offline checks pass: F5's 69, unchanged, plus 8 new. Run `await __audioOffline('beta')` for the new ones alone.
  - `beta GRAV WELL repel (Mode prop): brighter, rising hum`
  - `beta FORCE WALL hum scales with its area (at 1.5 m)` and `(at 6 m)`
  - `beta Hangar zero-g ring drones follow env.zones (on → off → on)`
  - `beta RIFT GATE hums phase-locked across a pair`
  - `beta stress (8 big walls, 4 repel wells, 4 rift pairs, Hangar zones on)`: voices ≤ 64 and the ceiling
  - `beta BUZZ startle: short yelp + rotor surge (flying, parked)`: `buzz/startle` plays, `buzz/whoop` doesn't
  - `beta clip: Matter audio on the frame clock (onset, stalls)`
- **In game:** local test server :8926 (`KNOCKON_STATIC=none`, scratch `KNOCKON_DATA`) and Vite :5326 with `?debug`, headless Chrome. I built a Hangar world through net ops: a RIFT pair, a 1 × 1 m FORCE WALL, a GRAV WELL on Repel and a GRIT HOPPER. Then I started a solo run.
  - `__knAudio.lastProps` held the four parts' real props (pair 0, width 1 / height 1, mode 1).
  - Both gates' loops played from one shared source (`rift:0:0|rift`, 2 refs).
  - The wall loop had level 1 (m²) and reference distance 1.4 m.
  - `EnvUpdate {zones: false}` then `{zones: true}` took the ambience voices 3 → 1 → 3.
  - 720p30 Director clips with sand pouring: AV1 + AAC, 120 frames, decoded RMS −33 → −19 dB as the pour builds. 0 audio faults.
- **Commands:** `pnpm -s typecheck` clean; `pnpm -s lint` clean; `pnpm -s vitest run apps/game` **254 / 254**.

## How to run

- Vite: `apps/game/node_modules/.bin/vite --config <scratch>/audio/vite.audio.mjs`. It's the shared config with port 5326, HMR off and the proxy pointed at :8926.
- Host (in-game checks only): `KNOCKON_PORT=8926 KNOCKON_DATA=<scratch>/audio/hostdata KNOCKON_STATIC=none node apps/host/src/main.ts`.
- `http://localhost:5326/audio-test.html`, then `await __audioOffline('beta')` (or `''` for all 77). My CDP driver is `<scratch>/audio/run.mjs`, and the in-game scripts are `game.mjs` and `game2.mjs`–`game4.mjs` (a local scratch folder).

## Cross-stream

- **main.ts (shared hot file):** 3 small edits, tagged `AUDIO (beta, D127)`, next to the existing audio hooks: the import, `setPartProps` on the switch to running, and `env.zones` passed to `setEnvironment`.
- **audio-test.ts:** 2 lines, tagged.
- **UIFIX / capture:** no capture-side hook was needed. The sync lives in `ClipAudio.advance` / `at`, which capture/offline.ts already awaits. The `ClipAudioTrack` interface is unchanged.
- **PARTSIM:** the startle cue keys on the `startled` FSM state (D121's `setFsm(k, 'startled', …)`), so no event name was needed. If PARTSIM later emits a dedicated event, `Buzz.event` can take it with a one-line case.

## Open items

- **The master chain's lookahead (11 ms, 0.67 frames at 60 fps) delays every clip sound equally.** That covers Matter and events. Shifting the clip's cut by it would put sounds exactly on their frames. That's a one-line change in `ClipAudio.finish`, but it moves every clip's sync and needs the decode-back check re-run, so it's left as a note.
- **The FORCE WALL's emitter stays at the part's base offset.** Audio gets no part orientation, so a wide wall's "spread" is its reference distance, not two emitters at its pylons.
