# M2 notes: stream F (audio)

Scope: PRODUCTION §2 M2 Audio, "mechanisms, critters v1, ambience". Everything is still procedural Web Audio from fixed seeds, with no sample files.

## Files

| File | What |
|---|---|
| `apps/game/src/audio/types.ts` (new) | Shared types (`Family`, `LoopKind`, `PlayOpts`, `AudioHost`, `SimEventLike` with optional `id`/`cause`/`other`) and a `Motion` velocity estimator |
| `apps/game/src/audio/mech.ts` (new) | 48 mechanism cues and loops, plus the `Mechanisms` director (events, part state, rollers) |
| `apps/game/src/audio/critters.ts` (new) | 36 critter cues and loops (formant-synth voices, foley), plus the `Critters` director |
| `apps/game/src/audio/ambience.ts` (new) | Studio and Mega Kitchen beds, emitters and one-shots, plus the `Ambience` director on its own bus |
| `audio/index.ts` | Routes events to the sub-directors and adds the M2 hooks, the new loop kinds, doppler, slow-mo pitch, pause handling, the scrub guard and the ambience bus. The M1 behaviour is unchanged |
| `audio/bank.ts` | Exports `impact`, `debris`, `crack`, `relay`, `reverbIR`, `Recipe`. `buildSfxBank(extra)` takes the M2 recipe sets. Adds `keys()` and per-environment IRs (`irs.studio`, `irs.kitchen`) |
| `audio/synth.ts` | Adds `voice()` (polyBLEP glottal source through time-varying formants), `keys()` and `bubble()` |
| `audio-test.ts` | Adds M2 event, loop, critter, critter-event and ambience rows, and an audition row for every M2 bank cue. 11 new offline checks (22 in total, all passing) |

## main.ts hooks (Edit tool, each marked `audio`)

1. Import `ROLLERS` alongside `GameAudio`.
2. After `audio.frame(dt)`:
   - `audio.setPlayback(run.paused || run.waiting, run.speed, run.tick)`
   - `audio.setEnvironment(doc.env.environment, doc.env.preset)`
3. On the phase change to running: `audio.setPaths(...)`, which gets the tube and gutter link polylines in metres.
4. In the running-parts loop: `audio.part(id, type, basePos, flags, meter, armRot, critterBytes)`, with `critterBytes = run.critters.subarray(i*4, i*4+4)`. `run.critters` is read through a cast, so main.ts compiles before and after B's plumbing lands.
5. The M1 floor-only rolling block is replaced by `audio.roller('roll:'+bi, type, pos)` for every type in `ROLLERS` (thud, boing, stitch, fuzz, pig_iron, marble). Audio picks the layer: floor (M1 rule, y < 0.3), tube or gutter path (within 0.2 m, or 0.1 m for slim), or vortex.

## What drives what

### Events (contract 1)

Unknown kinds are ignored.

| Event | Cue |
|---|---|
| `Lit` / `Unlit` | lamp: ping-on tink / off tick · torch: click on / off · suncell: shimmer tick · burning_glass: focus tink · lance: ping. Other types: silent |
| `Toggle` | flap: clack (open rate 1.05, close 0.92, from `mag > 0`) · everything else: lever snap |
| `Ring` | Ringer alarm bell: a 2 s two-bell hammer at 17 Hz plus rattle, prio 1.6 |
| `Launch` | skyrocket: launch roar with a baked doppler-ish downward sweep · big_top: deep fwoomp, confetti flutter and slide whistle · cork_blaster: "thoonk-POP" then string zip and twang · punchline: BOING-whap · gotcha_box: pop and wobbly boing (stops the tune) · sprong: sproing · puffer: bellows whoomph (whistle when mag > 4) · t_plunger: ratchet zip, dynamo whine and clack · otherwise: puff. Gain scales with `mag/20` |
| `Splash` | splash (gain from mag) |
| `Spawn` | silent (the matching Break or Launch carries the sound) |
| `Despawn` | scoop: fill rattle · goby: rescue-bubble pop |
| `Note` | music-box tine. `mag ≥ 24` is a MIDI note; otherwise it is a C-major degree from C5 |
| `Sound` | silent. It only nudges the intensity integrator, because its source has its own cue |
| `Break` (M1 kind, previously unvoiced) | fishbowl: shatter and water burst · pane/vase: shatter · plank: splinter · brik: brick debris |
| `Jam` / `Brownout` (M1 kinds, previously unvoiced) | grinding stall with sparks / sag "wow" |
| `Impact` | sprong (J ≥ 0.5): sproing pitched by J · trap_box (J ≥ 3): cage slam · critters (J ≥ 0.5): bodyfall pitched by species · everything else: M1 material banks (all 29 parts and the critters now have material profiles) |
| `Press` | t_plunger, puffer, toggle |
| `Signal` | flap clack, delay chirp (the relay click still plays) |
| `Pop` | gotcha_box is treated as Launch |
| `CritterState` | silent: `run.critters` carries the clip |
| `Emote` | a bark for the emote's category (mag = `CRITTER_EMOTES` index) |
| `Ragdoll` | startled bark |
| `Getup` | shake-off flap-flap, then an indignant bark |
| `Trapped` | cage slam (unless the impact already played it), the flag's ding at +0.25 s, and a trapped bark at +0.4 s. Works with either `part` = critter / `other` = box, or the reverse |

### Part state (`audio.part`)

These are M1-style loops refreshed every frame. A flag edge fires a one-shot only if the matching event didn't already play that cue within 0.3 s, so the system works whether or not A emits the event.

| Part | Driver |
|---|---|
| dynamo | ω (from the `arm` body rotation) sets pitch, and watts (40ω, capped at 300) set gain. With no measurable ω: `powered` flag at level 0.6 |
| turbine | blade-pass whoosh. Rate ∝ ω, so whoosh pitch and blade-pass rate rise together |
| hamster_drive / pedal_rig | wheel squeak / chain whir, from ω |
| lamp | filament buzz while lit or powered, plus edge fallbacks |
| torch | click on/off fallbacks |
| suncell | shimmer while `lit` (gain from meter if non-zero) |
| cell | warble while `powered`; sag on falling `powered` |
| burning_glass | sizzle while `lit` |
| ringer | 1 Hz tick-tock while `armed`; ×1.6 when meter ≤ 3; wind ratchet on arming; bell fallback on disarm |
| delay | 4 Hz soft tick while `armed` |
| skyrocket | thrust crackle-roar while `lit`, with live doppler (exaggerated c = 90 m/s, factor clamped 0.6–1.6) |
| big_top | fuse hiss while `armed` |
| fishbowl | bubble trickle while intact and within 6 m; shatter fallback on `broken` |
| toggle | snap on a `powered` edge |
| gotcha_box | while cranking (ω > 0.5 or `powered`): a crank ratchet loop, plus the original 8-bar music-box tune (`GOTCHA_TUNE`, 32 notes in C) at 3.2 notes/s × crank level. If the sim sends `Note` events for that box, the internal tune stops in favour of them |
| vortex / vortex_slim | registers the funnel for the rolling layer: a ball inside gets a spiral loop whose rate climbs with orbit ω, rising as the radius shrinks |

### Critters (`audio.part` with the 4 contract-3 bytes)

Clip names come from parts-data `CRITTER_CLIPS` and `CRITTER_EMOTES` (read via namespace import, so audio compiled before B landed them). Flat arrays and per-species records are both accepted, as are `type__clip` names.

| Driver | Result |
|---|---|
| Clip changes | barks per category, from the critter briefs: idle (35 % chance), sniff/confused → curious, chase/stalk, pounce → "hup", startled/arch_scared → Mochi hiss and yowl, flee, dizzy, celebrate, happy, angry → indignant, trapped, steal_grab → snicker, loot_admire → coo, bubble_rescue, getup → shake-off |
| Flag edges | ragdoll → startled · trapped → trapped bark |
| Emote byte change | a bark for the emote's category |
| Asleep (flag bit 2 or clip `sleep`) | Mochi purr loop · Bandit snore · Pip tiny snore |
| In-device (flag bit 3 or wheel/pedal clips) | Pip patter loop at wheel_run 1× / wheel_sprint 2× plus huffs · Bandit pedal-squeak loop plus effort huffs |
| Idle | seeded idle chatter every 4–18 s, depending on species |
| Goby `flop` clip | wet slap every 0.5 s (the clip's cycle) with an occasional comic gasp |
| Footsteps | step rate = measured horizontal speed ÷ species stride (Mochi 0.22 m, Pip 0.05 m, Bandit 0.26 m; Goby none). Only during locomotion clips (or always, if clips are unknown) and never while asleep, ragdolled, trapped or in a device. Positional, with alternating feet |

Cooldowns follow AUDIO §7: 1.5 s per critter and 0.5 s per species. Reactions (startled, trapped, pounce, rescue) use a 0.6 s cooldown and skip the species gate.

Voices are formant-synth stand-ins under the final cue names (`mochi/meow`, `pip/squeak`, `goby/bloop`, `bandit/chitter`, …). AUDIO §7 still plans a voice-actor session.

## Ambience (AUDIO §9; environments.md §1.7, §2.7)

- **Bus:** the ambience bus feeds the master directly and sends 0.25 to the reverb. Its level is sfx² × 0.044, which measures −46.8 dB RMS for the Studio and −47.6 for the Kitchen in the offline renders (target −46/−48).
- **Reverb:** switches per environment. The Kitchen gets its own warmer, shorter 1.3 s IR with denser early reflections.
- **Studio:** room tone with HVAC drift, plus a barely audible ballast hum from the off-screen key light (3D).
- **Mega Kitchen:**
  - warm room tone with two distant traffic swells per 10 s loop;
  - fridge compressor (60 Hz family an octave down) at the fridge (set (−10.25, 30.25)), cycling 40 s on / 60 s off with start and stop shudders;
  - wall clock above the doorway ticking 1 Hz, scheduled on whole seconds;
  - seeded one-shots every 3–11 s: garden birds at the window, the tap drip into the sink, and now and then an appliance (kettle click-off, the ice maker dropping cubes, a distant microwave).
  - Set coordinates convert per preset: Room origin = set (0, +24), Warehouse = set origin.
- **Mode behaviour:**

| Mode | Ambience |
|---|---|
| Build | full level, one-shots on |
| Countdown | −3 dB, one-shots hold off |
| Running | −4 dB baseline, ducked by action down to about −12 dB. "Action" = live sfx voices / 16 + loops / 30 + 0.3 × min(1, heat). One-shots only while action < 0.2 |
| Paused | back to build level |

  Stop doesn't touch ambience. Ducking is fast down (about 0.3 s) and slow up (about 1.5 s).
- **Other environments:** Backlot, Hangar and Moon fall back to the Studio tone. `'off'` silences the room (used by the tests).

## Budget, pause, scrub, Stop

- **Voice budget:** 64 voices, now counting ambience sources too. New family limits: critter 6, step 6, amb 4. Critter loops have their own cap of 6. The stress render (30 mechanism loops, 8 critters, 10 rollers, booms, the Kitchen and music) peaks at exactly 64/64 with no clipping; 570 steals.
- **Pause:**
  - `setPlayback(paused)` (also while waiting on the bake head) stops every run loop. The loops keep being refreshed, so they resume on play.
  - Critter timers freeze.
  - The offline check confirms below −50 dBFS after pause.
- **Slow-mo:** below 1× speed, one-shots and loops drop pitch (0.75 + 0.25 × speed) per AUDIO §1. Toggle with `audio.slowmoPitch`.
- **Scrub:** a batch whose ticks span more than 24 is a forward jump, and only its last 0.2 s of events play (`stats.scrubSkipped`). A playhead jump also suppresses flag-edge one-shots for that frame.
- **Stop:** `setMode('build')` kills all loops and resets the mechanism, critter and roller state.

## Hardening (graphics bug report: `applyLoop` "non-finite value" during a director-camera run)

**Cause.** AudioParam writes throw on NaN or ±Infinity. The `clamp()` helpers passed NaN through, because both comparisons are false for NaN. So a non-finite pose, rotation, meter or level reached `setTargetAtTime` or `positionX.value`. Once a NaN gets into a loop's state it throws on every frame. Reproduced against the pre-fix code: 97 throws in 110 frames, gone after the fix.

**Fixes:**
- **NaN-safe clamp:** `clamp` (types.ts and index.ts) maps NaN to the lower bound and ±Infinity to the bounds. A new helper, `fin(x, fallback)`, substitutes a fallback for non-finite values, and `finite3(v)` checks a vector.
- **Every AudioParam write clamped:** loop gain (0–2), playbackRate (0.05–8, doppler and slow-mo included), cutoff (20 Hz–20 kHz), bus volumes, the music duck and ambience bus gains. Panner positions are written only when finite. `play()` refuses non-finite positions, gains and times, and sanitises the rate.
- **Teleports:** `Motion` ignores non-finite samples and treats a jump over 2 m (`TELEPORT_M`) as a teleport, which resets velocity to 0. That covers rollers, critters, parts and the doppler source. A listener jump over 2 m (camera cut) holds every loop's doppler at 1 for that frame. Non-finite listener poses are ignored.
- **Clamped inputs:** `dt`, `speed`, `tick`, `meter` and quaternions are checked. Measured ω is capped at 200 rad/s, and footsteps at one per frame.
- **No throws escape:** every public GameAudio entry point catches errors, counts them in `stats.faults` and logs once per entry point. The entry points are `frame`, `part`, `roller`, `loop`, `setListener`, `setPlayback`, `setEnvironment`, `setPaths`, `onSimEvents`, `ui`, `cue`, `setMode` and `setVolumes`; the music scheduler timer is guarded too. main.ts needs no change.
- **New offline check**, `robustness: NaN, teleports, dt 0`, feeds:
  - NaN and ±Infinity positions, rotations, meters, levels, speeds, ticks and event magnitudes;
  - a 20 m listener cut every 0.5 s during a Skyrocket doppler loop;
  - dt = 0 and NaN frames.
  
  Result: 0 faults, finite and unclipped output. 23/23 offline checks pass.

## Waiting on A and B (as of hand-back)

- **A (EventKind):** `EventKind` in `machine.ts` doesn't yet list the new kinds. A's channels already emit `Lit`/`Unlit` (light.ts). Audio switches on strings, so nothing breaks either way. Still needed:
  - `Toggle` with mag 1 = on / 0 = off, `Ring`, `Launch` (mag = speed), `Note` (MIDI or scale degree), and `Despawn` on scoop intake.
  - Flags or meters for ringer, delay, skyrocket, big_top and gotcha_box: audio expects `armed` (ringer/delay/big_top countdown), `lit` (skyrocket thrust) and `powered` (gotcha cranking). If A uses different bits, the mapping is one line per part in `mech.ts` `Mechanisms.part()`.
  - ω comes from the rotation of the part's `arm` body. If the turbine, dynamo, wheel or crank rotor is a different role, audio hears no spin. The dynamo falls back to `powered`.
- **B:**
  - `run.critters` isn't on `RunController` yet. main.ts reads it through a cast, and critters fall back to speed-only footsteps and idle chatter until it appears.
  - `CRITTER_CLIPS` and `CRITTER_EMOTES` have landed in parts-data and match the mapping. B's `Trapped` passes the device id as mag and `other`; both forms are handled.
  - While ragdolled, audio positions the critter at its `base` body, because `PoseOf` has no `rag` role.
- **Other streams:**
  - Paths: gutters are detected by link kind containing `gutter` (and `_slim`). If A names them differently, change the filter in main.ts `setPaths`.
  - Repo `pnpm typecheck` currently fails in A's and B's in-progress files (`packages/sim/src/channels/*` missing `./index.ts`; `critters/system.ts:886`) and in C's (`gfx/renderer.ts:528`, `gfx/skin.ts:277`). `apps/game` has no audio or main.ts audio-hook errors.

## Deviations

- **Critter voices** are synthesised, not acted (AUDIO §7 plans voice actors). They're placeholders under the final cue names.
- **One IR per environment** is done for the Studio and Kitchen only.
- **Occlusion and HRTF-by-default** (AUDIO §2) are not in M2.
- **Bank build** is now about 0.85 s on an idle machine (up from M1's), and 1.3–2.5 s while other streams were building. It is async and yields every 8 ms, so frames keep flowing.
- **The M1 `detonate ×1` test window** was too tight: it failed identically with the M1 director. It now allows silence from 1.8 s.
