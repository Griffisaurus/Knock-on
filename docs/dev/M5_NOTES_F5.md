# M5 notes: stream F5 (audio)

Status: **done** (2026-10-25). Scope: [M5_PLAN](M5_PLAN.md) stream F5:

- sounds for the 10 non-Matter M5 parts (GOO VAT is X5's: the hook is ready, below);
- BUZZ's voice and motors;
- ORBITAL HANGAR and MOON BASE ambience, and the air-0 % rule;
- **offline audio for capture**: MP4 clips now carry the game's own sound.

Everything is still procedural Web Audio from fixed seeds: no samples, nothing downloaded, no new dependencies.

## Files

| File | What |
|---|---|
| `audio/m5.ts` (new) | The 10 M5 parts: 51 bank entries (107 variations), `M5_LOOPS` (12 loop kinds incl. BUZZ's), and the `M5Parts` director on A5's events and flags. `M5_EXTRA`: the GOO VAT hook for X5 |
| `audio/buzz.ts` (new) | BUZZ: 12 voice cues + 8 foley cues and loops (44 variations) and the `Buzz` director on B5's critterState bytes and events |
| `audio/ambience_m5.ts` (new) | ORBITAL HANGAR and MOON BASE sounds (9 bank entries, 17 variations) |
| `audio/clip.ts` (new) | Clip sound: `ClipAudio` (offline render on the capture's frame clock), `encodeAudio` (WebCodecs AudioEncoder: AAC-LC, else Opus), `pcmHash` |
| `audio/testm5.ts` (new) | M5 rows of the audio test page (live audition of every new cue, loop, BUZZ job, room, air setting) and 21 offline checks (M5 + clip) |
| `audio/index.ts` | Routing (BUZZ → critters → M5 → M4 → pyro …), the air-0 % treatment (impact bus, air low-pass, sends, far field), the `hush` node (the collapse's silence), the clip tap (`clip()`, forwarding while a capture runs, `share` option), M5 part profiles, stats `vacuum` / `m5Cues` / `buzzCues` |
| `audio/ambience.ts` | `Ambience.hangar()` / `moon()`, the window pocket and the dome's 20 m reach (`AmbienceState.listener`), the Main Hall IR, the Moon's radio beacon. W5's hook (ENVS entries, `spaceEmitters`) kept; the gantry and the beacon left its looped-emitter map (they're one-shots / suit radio) |
| `audio/bank.ts` | IRs `hangar` (1.6 s), `hangar_arena` (2.0 s), `moon` (0.25 s ground slap, only heard if players add air); a NaN guard that zeroes and reports any non-finite sample a recipe makes |
| `audio/types.ts`, `m4.ts`, `critters.ts` | `M5LoopKind`; m4's synth helpers exported; `Critters.names()` |
| `audio-test.ts` (Edit) | M5 types, `liveM5`, `offlineM5`, `clipChecks` |
| `capture/mp4.ts` (Edit) | The sound track: `addAudioTrack` / `addAudioSample`, an `mp4a` + `esds` (AAC) or `Opus` + `dOps` sample entry, `smhd`, an edit list, chunks as runs of contiguous samples (tracks may interleave), `next_track_ID` 3; `readMp4().audio` reads it back |
| `capture/mp4.worker.ts` (Edit) | `audio` / `asample` messages |
| `capture/video.ts` (Edit) | `ClipSink.setAudio?`; `VideoSink` muxes the track at `finish`; `ClipResult.audio` |
| `capture/offline.ts` (Edit) | `CaptureHost.clipAudio?()`, the `ClipAudioTrack` interface, `at(i)` before each frame's seek and `advance(i)` after its draw (preroll included), `finish` → `setAudio` |
| `test/capture.test.ts` (Edit) | 2 new tests: AAC and Opus tracks walk back (after the video and interleaved), refusals |
| `main.ts` (Edit, audio hooks) | `setEnvironment(…, doc.env.air)`; `clipAudio: () => audio.clip()` on the capture host; GRABBER's gripper link (its last `piece` body) as the `arm` pose |

## The M5 parts (A5's real event kinds, `M5_NOTES_A5.md`; flags and meters from `channels/m5_*.ts`)

Every part is driven by events first and by state as the fallback (a state edge stays quiet if the event played the cue within 0.3 s). Unknown kinds are ignored.

| Part | Events | State (`part()`) |
|---|---|---|
| RIFT GATES | `Teleport` (entry gate, mag = speed) → whoosh-suck · `Emerge` (exit gate) → pop-whoosh, rate by speed · both: the cooldown tick 0.25 s later · `Bounce` → membrane bonk | `lit` (paired) → the portal hum, which spins up for a moment after a transit (`armed` = cooldown) |
| GRAV WELL | `Powered` / `Unpowered` / `Brownout` | field on (`lit`, else `powered`) edges → spin-up (arcs, rising whir) and, when it goes off, the orb's clack into its cradle · on → the sub-bass attract hum (wobbles down) · `fault` → stutter. Repel (shimmers up) exists and plays on `armed`, but A5 keeps the mode in a prop audio doesn't see |
| TRACTOR BEAM | `Attach` → capture bloop · `Release` → soft drop · `Powered` → on-sweep | powered → the warble; the meter (load against 2 kg, 1–21) and `lit` (carrying) add the deep warble layer · `fault` → strain whine |
| HOVER PAD | `Unpowered` → whine-drop · `Impact` after the drop → landing clunk | on (`lit`/`powered`) → the hum, pitch ∝ load (meter against 10 kg) · thruster flutter while it rises or sinks · `fault` → overload warble · landing also detected from motion (falling, then stopped) |
| FORCE WALL | `Barrier` (mag 1 / 0) → rising / falling zip · `Impact` on the field (while `lit`) → soft "thoom", pitch by impulse; a critter → cartoon boing | `lit` → electric hum (0.3 m² level: A5 has no size meter) |
| COILGUN RING | `Boost` mag 3 → six-coil chase, deep thunk, electric snap, zap tail; recharge whine after · `Boost` mag 0 → dud whoosh · `Charged` → ready ping · `Powered` → charge whine | powered → idle hum · `lit` (charged) edge → ping fallback |
| STASIS FIELD | `Engage` mag 1 → short reverse swell into a glassy chime · `Engage` mag 0 → time-snap whoosh · `Freeze` (a body caught) → glass ting | `lit` (engaged) → low choral drone with a slowed clock tick |
| BUZZ BEACON | `Call` → radio double chirp | `pressed` (0.3 s at a call) → chirp fallback · BUZZ docking (B5 `docked`) → the pad's latch clunk (buzz.ts) |
| SINGULARITY | arming (`Engage`, or the `armed` flag rising) → arm click + spin-up, and the 1.0 s implosion swell scheduled to end exactly at 6.0 s · `Despawn` (a body recycled) → hollow pop (≤ 12/s); each also grows the pull loop · `Launch` (a critter spat out) → comic "ptoo" + boing · `Collapse` → the swell lands, **150 ms of true silence (everything, music included: the `hush` node before the glue and limiter)**, then the low aftermath and the rings braking, then a 3 s vent hiss | `armed` → the pull loop (sub-bass drone + reverse whooshes), growing with A5's countdown meter (seconds left + 1) and the recycled count · fallbacks: the `armed` fall, or the clock at 6.12 s, collapse it |
| GRABBER | `Trigger` → servo relay blip, a cycle starts · `Attach` → gripper close click · `Release` → open click · `Jam` → "uh-uh" shrug beep | the servo whine follows the gripper link's motion (rotation and travel, main.ts hook); without one, a cycle timer from `Trigger` · `lit` (holding) edges → close / open · parked after moving → park clunk |

**GOO VAT hook (for X5):** `M5_EXTRA` in `m5.ts` is a registry. An entry gives `types`, `recipes()` (added to the bank at build: index.ts), `event()` and `part()`; `M5Parts` hands it GOO VAT's events and frames first, and `isM5()` routes its type. The brief's cues (`bubble_blorp` loop, `stirrer_hum`, `valve_clunk`, `goo_pour`, `drip_snap`, `refill_gloop`) go in its recipes; loops can reuse a generic kind with their own `variant`. The goo grains: matter.ts / matterprobe.ts reduce 3 kinds (sand, water, marbles; `mat` bits 0–7); goo is a 4th kind in the probe's `[kind][band]` arrays, a grain table in `tablesOnce()`, and 2 more outputs on `matter-processor.js` (6 → 8 streams, still one voice each in the 64).

## BUZZ (B5's states and events, `M5_NOTES_B5.md`)

All synth chirps under the brief's cue names (`buzz/*`): brighter, quicker and more officious than DUSTY's. Positional, with the AUDIO §7 cooldowns (1.5 s; urgent 0.6 s).

| | |
|---|---|
| Voice | `takeoff` → "on it!" double beep · `sniff` → scan trill · `Deliver` → the 3-note delivery jingle · `startled` / `flee` / ragdoll → alarm whoop · carrying ≥ 1.4 kg or `trapped` → strained whine · `getup` / `emote_angry` → indignant buzz · `dizzy` → warble · `sleep` → power-down · `celebrate` → fanfare roll · emotes: `package` → beep, `?` → curious "bweep?", `check` / `clock` → happy arpeggio, `stars` → dizzy · idle boops now and then |
| Rotors | the 4-fan whir (blade-pass ~240 Hz, four rotors beating, duct air) while the `BUZZ_ROTORS` bit is set; level and pitch follow thrust (climbing, dashing), a load (from `Fetch`'s kg) sags the pitch; doppler. Spin-up / spin-down on the bit's edges |
| Winch, claw | the reel loop while the winch bits move (rate from their change) · `Fetch` → claw clack at the claw · `Deliver` → release clack |
| Contact | `Impact` → plastic plink · ragdoll → tumble clatter (knocks + spin-down) · FSM `landed` → landing tap · FSM `docked` → the beacon's latch clunk |

## ORBITAL HANGAR and MOON BASE (environments.md §5.6, §6.7; W5's emitters)

| Hook | Implementation |
|---|---|
| `amb_hangar_life_support` | 12 s bed: low air-handler rumble, two fans' blade-pass tones wobbling, vent flow in slow swells, a faint hiss. **In-mix −46.0 dB RMS** at the Bay 2 camera (Tinker Lab −48.6: the brief's 2 dB louder) |
| `amb_hangar_pa_chime` | a two-tone chime + wordless murmur (formant-coloured noise bursts through a small-speaker band; no words, no pitch) every 60–120 s at a PA emitter; sparse radio beeps between (15–35 s), only when the machine is quiet |
| `amb_hangar_gantry` | an occasional servo whir and clunk along the rail, every 25–60 s (one-shots, not a loop) |
| `amb_hangar_zerog_ring` | a low soft drone per ring (a fifth, slowly beating, faint shimmer), ref 2.5 m |
| `amb_hangar_window` | the bed ducks 3 dB within 10 m of the glass (measured −48.2 dB vs −46.0) |
| Reverb | Bay 2 1.6 s, Main Hall 2.0 s (the AUDIO §1 cap) |
| `amb_moon_suit` | 12 s bed: faint radio static, the suit fan on a 4 s breathing cycle, a 45 Hz drone. **In-mix −52.5 dB RMS** (the brief's 4 dB under the Tinker Lab) |
| `amb_moon_dome_hum` | low habitat machinery, gated to within 20 m of the dome's skin (fades out 20 → 28 m) |
| `amb_moon_beacon` | a 2 s suit-radio loop with one soft blip: the antenna's 0.5 Hz blink; non-positional (it's radio) |
| radio static | a burst now and then (12–37 s) when quiet |

**Air 0 % (any world, from `doc.env.air`; the Moon defaults to 0 %).** "Listening through a suit radio": vacuum amount = 1 − air / 20 % (full at 0 %, gone from 20 % up, cross-faded between):

- contact sounds (impacts, steps, rolls, Matter grains) go through an impact bus: low-passed to **800 Hz** with a +5 dB low shelf at 160 Hz (structure-borne thumps);
- the rest of the sfx bus is low-passed to 1.6 kHz;
- the sfx and ambience reverb sends close (no room);
- the far field drops away: an extra (4 m / d) beyond 4 m on every positional voice and loop, and pyro loses its far-field compensation.

Measured (offline, same impacts and blast at 100 % and 0 %): energy above 2 kHz 3.6 % → 1.7 %; the near impact −20.6 → −17.3 dB (the shelf); the far one (21 m) −45.4 → −56.7 dB; the reverb tail −59.3 → −75.0 dB. Music and UI are untouched.

## Clip sound (offline audio for capture)

```
capture/offline.ts renderClip, per frame i (preroll included):
  track.at(i)            ← the OfflineAudioContext is suspended at exactly i / fps
  seek(tick)             ← the frame's sim events arrive (run.onEvents → audio.onSimEvents)
  renderFrame()          ← main.ts's frame: listener, part(), roller(), loop(), setPlayback(), frame(dt)
  track.advance(i)       ← suspend(i + 1 / fps), resume
GameAudio (live, muted) ──tap──▶ GameAudio (offline: the same banks, the live state copied) ──▶ OfflineAudioContext
end: run out the buffer (director cut off: silence renders fast) → [preroll, last frame) → AudioEncoder → mp4 worker
```

- **The tap:** while a clip renders, the live director forwards every world hook to the clip's director: events, part state, rollers, loops, listener, spectacle. Playback is forced to unpaused at 1× (the capture steps it by tick; slow-mo and hitstop stretch clip time and are heard). State setters (mode, room, air, paths, key, mochi) go to both, so the live mix is in step afterwards. UI sounds stay out of clips. Volumes: the player's music and sfx balance at the default master, unmuted.
- **Determinism:** the audio is a function of the frames, not of how long they took: two renders of one clip, one with random wall-clock stalls between frames, differ by at most **−134 dB** (≈ 2e-7). They aren't bit-identical because Chrome sums a node's inputs in an unspecified order (measured: a bare OfflineAudioContext harness is bit-exact; three looping pads into one GainNode differ in the last bits, max 2e-8).
- **Codec:** `AudioEncoder.isConfigSupported` in this Chrome 155: AAC-LC (`mp4a.40.2`) ✓, HE-AAC ✗, Opus ✓, FLAC ✗. Clips use **AAC-LC 192 kbps** (plays wherever MP4 does), with Opus 160 kbps as the fallback.
- **Sync:** measured by decoding the finished MP4 (`decodeAudioData`, the same demuxer `<video>` uses) and cross-correlating with the PCM: **lag 0 samples** for AAC and for Opus. Chrome's AAC encoder adds no delay its decoder doesn't remove (a click comes back on the same sample), so the AAC edit list skips 0; Opus's 312-sample pre-skip goes in `dOps` only (with it in the edit list too, Chrome skipped it twice: −312 samples). The edit list ends at the PCM's length, so the track is exactly the clip's length (4.000 s decoded for a 4.000 s clip).
- **Room:** the offline context holds its whole buffer (stereo float, 23 MB a minute), sized for the clip × 2 + 2 s (slow-mo stretching); a clip that outruns it goes silent from there and the result note says so. GIF and WebP have no sound.

### Verified

- **Unit:** `capture.test.ts` 19 / 19 (2 new): AAC and Opus tracks, after the video and interleaved with it; entries, `esds` ASC, `dOps`, edit lists, `next_track_ID`; every sample byte-identical at its offset; refusals.
- **Audio test page:** `clip` checks 7 / 7: determinism, AAC and Opus mux / box walk, decode-back sync (lag 0), and playback in `<video>` (audio bytes decoded, −16 dBFS RMS through a MediaElementSource).
- **In the game:** a 720p30 Director clip of a 56-part world (POWDER KEG, RIFT GATES, COILGUN, FORCE WALL, STASIS, TRACTOR, SINGULARITY, GRABBER, BUZZ demos), captured through the real capture path (`capture.startClip`), under the host's CSP and without it:
  - AV1 (hardware) + AAC-LC 192 kbps, 198 frames, sound track 6.600 s, decodes at −14.0 dB RMS, −1.0 dBFS peak (the limiter's ceiling);
  - plays in `<video>` with sound (61,854 audio bytes decoded in 2.5 s, −8.9 dBFS RMS through a MediaElementSource) on a page without the CSP;
  - **ffprobe 8.1.1** (installed locally): `av1` 1280×720 30 fps 198 frames + `aac` 48 kHz stereo 310 frames, both 6.600 s; `ffmpeg -xerror` decodes it with no error; ebur128 **−14.5 LUFS integrated, true peak −1.1 dBTP**.

## Measurements (the test system, 2026-10-25)

Other streams were using the GPU and CPU (nvidia-smi 27–45 %, 24–25 GB): timings are provisional (rule 11).

| What | Result | Method |
|---|---|---|
| Capture cost of the sound track | **none measurable**: 1080p60 Director, 276 frames: 16.8 / 16.4 ms per frame with sound vs 16.8 / 16.5 without (A/B twice) | `capture.startClip` with `host.clipAudio` on and off |
| Clip finish | 21–45 ms to run out the buffer + 28–49 ms AAC encode for 4.6–6.6 s of audio | `ClipAudio.last` (wall clock) |
| Offline render CPU, M5 checks | 3.3–7.7 % of real time (one-shots 4.5 %, loops 4.8 %, BUZZ job 5.2 %, rooms 3.3–5.0 %) | render time ÷ audio time, audio test page |
| M5 stress | **11.3 %**; peaks at **53 / 64 voices**; true peak −1.05 dBTP; limiter GR max 1.2 dB | every M5 loop × 3, BUZZ × 2, a SINGULARITY, booms, coilgun fire, the Hangar |
| Director `frame()` in the game | 0.05–0.24 ms (EMA) | `__knAudio.stats.frameMs`, the 56-part world running, peak 48 voices |
| Limiter | max true peak over all 69 offline checks **−1.03 dBTP** (M4 stress) | `truePeak()` 4× / 48 taps |
| Bank build | 2.9–3.7 s (M4: 2.4–2.9 s); M5 adds ≈ 0.9 s of synthesis (parts 0.37 s, BUZZ 0.15 s, rooms 0.37 s, timed per recipe) | `stats.buildMs`; async, yields every 8 ms. A clip's director shares the live banks (no rebuild) |

## Checks

- **Audio test page:** **69 / 69** offline checks pass (48 from M1–M4, unchanged; 14 M5; 7 clip) in Chrome 155 against Vite :5305 (the full run without the CSP, for the `<video>` rows; the M5 checks and the clip checks short of `<video>` also passed under the host's CSP, where `<video>` of a blob is blocked: see below).
- **M5 offline checks:** M5 event one-shots (35 slots) · M5 loops (9) · SINGULARITY sequence (pull −22 dB, the silence −126 dB, aftermath −22 dB) · BUZZ fetch job (7 phases) · Hangar Bay 2 / Main Hall / window pocket · Moon Room / by the dome · air 100 % vs 0 % · M5 stress · robustness M5 (NaN / Infinity positions, meters, quaternions, junk critter bytes, bad events and environments: 0 faults).
- **Game:** the limiter and Matter worklets load as `worklet` under the host's CSP; switching Tinker → Moon → Hangar → Moon → Tinker in a live session sets the room, the IR and the vacuum amount each time; 0 audio faults.
- **Commands:** `pnpm -s typecheck` clean; `vitest run apps/game`: **165 / 165**.

## How to run

- Scratch config `scratchpad/f5/vite.f5.config.ts`: Vite :5305, HMR off, the host's CSP (`NOCSP=1` drops it), proxy to the local test server :8905 (`KNOCKON_DATA` = `scratchpad/f5/hostdata`, `KNOCKON_STATIC=none`). `scratchpad/f5/mkworld.ts` writes the test world from demos.
- `http://localhost:5305/audio-test.html`: the M5 rows (events, loops, the SINGULARITY sequence, BUZZ jobs, Hangar / Moon / air) and every new cue; `await __audioOffline('M5')` or `('clip')`.
- In the game (`?debug`): `__knAudio.stats` (`vacuum`, `m5Cues`, `buzzCues`); `await __kn.capture.startClip({ source: 'director', start: 0, end: 6, res: '720p', fps: 30, format: 'mp4' })`, then `__kn.capture.last`.

## Reported to other streams (not fixed)

- **Host CSP / capture dialog (host owner, U5, C4's dialog):** the host's CSP has no `media-src`, so `default-src 'self'` blocks `<video src="blob:…">`: the capture dialog's clip preview can't load in production ("Media load rejected by URL safety check"; reproduced on Vite with the exact host CSP). Saving the file is unaffected. A fix is `media-src 'self' blob:` in `apps/host`'s CSP. Also, the preview `<video>` is created `muted` (ui/capture.ts): now that clips have sound, it may want to start unmuted (or show the sound control).

## Deviations and open items

> **Beta polish (D127, [BETA_NOTES_AUDIO.md](BETA_NOTES_AUDIO.md)):** the GRAV WELL mode, the FORCE WALL area, the zero-g rings and `env.zones`, the RIFT pair lock and the Matter clip lag below are closed.

- **GRAV WELL mode:** attract only; A5 keeps attract / repel in a prop that `audio.part()` doesn't receive (the repel loop is built and plays on `armed`).
- **FORCE WALL area:** fixed at the 0.3 m² level (no size meter); the hum's "gain ∝ area" needs one.
- **Zero-g rings** hum whether or not `env.zones` switched them off (audio doesn't see the toggle).
- **RIFT GATES "pair-locked" hum:** each gate loops on its own (the loop offset is hashed per gate), not phase-locked to its partner.
- **SINGULARITY implosion:** it starts 1 s before the clock's 6.0 s. A collapse the sim brings earlier cuts it short and plays a fast version (rate ×3.3) into the collapse.
- **Synthesised stand-ins:** BUZZ's voice is synth chirps by design (the brief); the PA "voice" is a wordless murmur (AUDIO §9: no intelligible speech).
- **Clips:** the Matter field in a clip comes from the same GPU probe as the live game (read back 1–3 frames late, so it is the only part of a clip's sound that isn't strictly a function of the frames). Clips use the default master volume and the player's music / sfx balance; UI sounds are left out.
