# KNOCK-ON Audio Design

Status: v1.3 · 2026-10-25 (as-built notes through M5 and the beta polish in §0) · Owner: Audio Lead (contract)
Related: [GAME_SPEC.md §16](../GAME_SPEC.md) · [SIMULATION.md §9](SIMULATION.md) (events) · [PART_SYSTEM.md §1](PART_SYSTEM.md) (`audio` mapping) · [art/briefs/](art/briefs/README.md) (each brief lists "Audio hooks")

> **Sound pillar:** every cause has an audible effect. Players should be able to close their eyes and follow the chain.

## 0. As built (through M5 and the beta polish, 2026-10-25)

This doc is the design. The shipped engine (`apps/game/src/audio/`) differs in these ways:

- **Everything is procedural.** Every cue, the music and the ambience are synthesised at load from recipes (`bank.ts`, `synth.ts`, `music.ts`, `ambience.ts`, plus `mech.ts`, `m3.ts`, `m4.ts`, `m5.ts`, `goovat.ts`, `pyro.ts`, `critters.ts`, `buzz.ts`, `ambience_m5.ts`), from fixed seeds. There are **no sample files, Opus banks, `cues.json` or voice-actor recordings** yet (§7, §10, §12 are the plan for real assets).
- **Graph:** a WebAudio node graph on the main thread, not an AudioWorklet mixer (`index.ts` header). Voices → optional panner (`equalpower` by default, `HRTF` as an option) → buses (sfx, music, ui, ambience, matter) → a glue stage → the **true-peak limiter**, an AudioWorklet at **−1.05 dBTP** (`limiter.ts`, `limiter-processor.js`; a same-origin file because the CSP blocks Blob URLs). One convolution reverb send.
- **Events:** the AudioDirector consumes the sim events that arrive with each `frame` message at the playhead (there is no event ring; ARCHITECTURE §5), so scrubbing and replays sound right.
- **Voices:** 64 (`MAX_VOICES`), with ambience and Matter streams counted against the budget. **Not built:** SDF-ray occlusion (§2). The speed-of-sound delay is in for pyro (`pyro.ts`, 343 m/s).
- **Pyro:** chain merging and a barrage bed for Kiloton (`pyro.ts`, M3).
- **Matter (M4):** `matterprobe.ts` reduces the particles around the listener on the GPU (a 288-byte readback), and `matter.ts` drives the granular streams in `matter-processor.js`, on the matter bus under the limiter: 6 in M4 (sand, water, marble × near, field), 8 since goo joined as the probe's 4th kind in M5 (squelch grains; the probe reads 96 sums).
- **Critters:** synthesised voices and footsteps for the 7 M2–M4 critters (`critters.ts`), and BUZZ (M5, `buzz.ts`): 12 voice cues, the 4-fan rotor whir following thrust and load, the winch reel and claw clacks, driven by its critter-state bytes and its `Fetch` / `Deliver` events. Beta (D127): when a big boom startles it (PARTSIM's 0.6 s `startled` state, D121) it gives a short yelp over a rotor surge (`buzz/startle`, about 0.3 s) instead of the alarm whoop.
- **M5 parts (`m5.ts`):** cues and loops for the ten Future Tech parts on their events and flags (rift whoosh and pop on `Teleport` / `Emerge`, the force wall zip on `Barrier`, the coilgun chase on `Boost`, the stasis chime and drone, the tractor warble, the hover hum by load, the grabber servos, the beacon chirp on `Call`). The SINGULARITY's `Collapse` lands its implosion swell into **150 ms of true silence** (a `hush` node before the glue and limiter, music included), then the aftermath. GOO VAT's cues (`goovat.ts`) plug into the same director (`M5_EXTRA`).
- **Part props (beta, D127):** when a run starts, main.ts hands the director the static props of the parts whose sound depends on them (`setPartProps`, `AUDIO_PROP_TYPES`):
  - **GRAV WELL Mode:** Repel has its own hum, the attract hum turned inside out. It sits a fifth higher (75 Hz) with brighter partials, its pitch bumps up twice a second where Attract dips down, glints sweep upward, and air is pushed out. The spin-up is brighter too.
  - **FORCE WALL width × height:** the hum scales with the field's area (0.01–1 m²). Its gain goes with √area, +11 dB across the range. The panner's reference distance grows from 0.6 to 1.4 m, so a big field fills more of the room and carries further, and it hums a little deeper. Measured at 1.5 m: 0.1 × 0.1 m −40.0 dB, 0.6 × 0.4 m −28.9 dB, 1 × 1 m −21.5 dB RMS.
  - **RIFT GATE pair colour:** the director pairs gates the way the sim does (one colour in part order: 1st with 2nd, 3rd with 4th). A pair's hums play from **one shared source** into each gate's own filter, gain and panner (`LoopOpts.sync`), so the pair has one LFO phase even when a gate comes into range later. The two gates also share the transit spin-up. Measured with the gates hard left and right: L·R correlation 0.997 at lag 0, best lag 0 ms (before: −0.04, 1.47 s apart).
- **Music:** adaptive Build / countdown / Run beds with intensity layers and a choir layer on big yields (`music.ts`, "music v2" in M3). The manual 12-track picker (§8) isn't built; Settings › Audio has master, music and SFX volumes and mute (`ui/settings.ts`).
- **Ambience:** Studio, Mega Kitchen and Tinker Lab beds (`ambience.ts`), and in M5 the Orbital Hangar (a life-support bed, PA chimes, gantry servos, a drone per zero-g ring, the window ducking the bed; Bay 2 and Main Hall reverbs, 1.6 s and 2.0 s) and the Moon Base (a suit-radio bed, the dome hum within 20 m, the beacon blip; `ambience_m5.ts`). The Backlot still uses the Studio's tone. Beta (D127): the zero-g ring drones follow the world's `env.zones` (`setEnvironment(…, zones)`). Switched off, each drone fades out in 0.5 s and frees its voice; switched on, it fades back in. Measured 1.5 m from a ring, its 105.5 Hz fifth went −57.8 → −74.8 → −58.2 dB through on → off → on.
- **Air 0 % (any world; the Moon's default):** "listening through a suit radio". Contact sounds go through an impact bus low-passed to 800 Hz with a low shelf, the rest of the sfx is low-passed to 1.6 kHz, the reverb sends close and the far field drops away, cross-faded up to 20 % air. Music and UI are untouched.
- **Capture (M5):** MP4 clips carry the game's own sound (`clip.ts`). While a clip renders, the live director forwards every world hook to a second director on an `OfflineAudioContext` stepped on the capture's frame clock, so the sound is a function of the frames, not of how long they took (two renders differ by at most −134 dB). It's encoded by WebCodecs `AudioEncoder` as **AAC-LC 192 kbps**, or Opus 160 kbps as the fallback, and muxed as a second MP4 track (`capture/mp4.ts`), in sync to the sample. UI sounds stay out of clips; GIF and WebP have no sound.
  - **Matter in clips is on the frame clock (beta, D127).** It used to land 2.75 frames late (measured at 60 fps). There were three causes: the live 30 Hz probe throttle, the GPU readback arriving during later frames, and the worklet's message port being asynchronous. Now the clip's director probes every frame. After each frame (`ClipAudio.advance`), `GameAudio.clipSettle()` waits for that probe's readback and applies it at the frame's time. It then posts it to the granular worklet with a sequence number and waits for the worklet to echo it before the offline render moves on.
  - Matter grains now start on the same sample as an event on the same frame. Two renders, one with random wall-clock stalls, are identical.
  - A clip's events also lose the live mix's 10 ms scheduling margin, because the offline context is suspended exactly on the frame.
  - Every clip sound, Matter included, now sits 0.67 frames (11 ms) after its frame. That's the master chain's lookahead: the glue compressor's and the limiter's.

---

## 1. Architecture

```
Sim events (eventRing) ──▶ main-thread AudioDirector ──▶ AudioWorklet mixer
                              │ map event → cue (part def `audio`)          │ voices (64), DSP
                              │ priority, culling, concurrency              │ buses → limiter → out
                              ▼                                             ▼
                        listener = active camera                      HRTF (optional) / stereo pan
```

- **AudioDirector** (main thread) reads the event ring at playback time (so scrubbing and replays sound right). It resolves cues, schedules voices with `AudioContext.currentTime` offsets matched to playback ticks, and handles pause, speed and slow-mo by time-stretching scheduling (pitch drops at slow-mo via playbackRate, configurable).
- **Mixer** (AudioWorklet): sample playback, granular player (Matter), simple synth (UI blips, arc crackle), filters, per-voice EQ for occlusion, convolution reverb send (1 IR per environment, 2 s max).
- **Buses:** `master` → `limiter` ← { `sfx` ← (`impacts`, `mechanisms`, `pyro`, `critters`, `matter`, `ambience`), `music`, `ui`, `mp` (pings, chat) }. Music ducks −6 dB on pyro events ≥ yield 1 for 1.5 s.

## 2. Voice management
- 64 voices. Priority = base cue priority × loudness × proximity × novelty (first-of-kind in 0.5 s gets +50 %).
- **Concurrency limits** per cue family: impacts 24, rolls 12, mechanism loops 16, pyro 8 (+ the layered tail system §4), critters 6, UI 4.
- **Distance model:** inverse, ref 1 m, rolloff 1.2, max 60 m (Megastructure: up to 250 m for pyro). Beyond max, cues are culled at schedule time.
- **Occlusion:** one SDF ray per voice every 100 ms (RENDERING §7 clipmap). Blocked → −9 dB + 1.2 kHz low-pass, smoothed.
- **Speed of sound:** for pyro beyond 30 m, delay = d / 343 s (see the flash, then hear the boom).

## 3. Impacts and rolling
- Banks per **material pair class**: {wood, metal, poly/glass, rubber/fabric, brick/ceramic, paper, critter} × {wood, metal, poly/glass, rubber/fabric, brick/ceramic, paper, floor} → collapsed to 18 pair banks by similarity.
- Each bank: 3 intensity tiers × 6 variations (round-robin, no immediate repeat).
- Intensity from impulse J: `tier = J < 0.5 → soft, < 5 → medium, else hard`. Gain = `clamp(log10(1 + J·k_mass))`. Pitch ± 6 % by mass (lighter = higher) + 2 % random from a hash of (partId, tick), not `Math.random`, so replays sound identical.
- **Rolling and sliding:** loops per material, gain and pitch from tangential velocity, cross-faded across 3 speed layers. Rollers have a rolling bank keyed to their material (THUD rumble, BOING rubber patter, marble glass trill).
- **Topple Tiles and Pins:** a dedicated "clack" bank with fast-retrigger design and a cluster mode (≥ 8 hits in 100 ms → plays a "cascade" layer instead of 8 voices).

## 4. Pyro
- **Layer stack per detonation:** transient crack (0–40 ms) · body boom (yield-scaled: small / medium / keg) · low-end sub (yield ≥ 1.5) · debris tail (material-aware: wood splinter, brick rubble, glass) · environment slapback (IR-based, delayed by room size).
- **Chain handling:** detonations within 80 ms merge into one "big" event with summed yield (up to a cap) plus extra debris tails. This keeps 400 Bangsticks feeling *huge*, not clipped.
- Fuse: ignite *fft* + hiss loop (pitch rises slightly as it nears the end) + travelling crackle. Flamer: whoosh loop. Skyrocket: launch roar + whistle tail. Skyshow: lift thump + aerial bursts from 4 banks (boom, crackle, hiss-crackle, crossette pops) mapped to the 9 visual patterns (§11).
- The master limiter (lookahead 5 ms, −1 dBTP ceiling) is set so the loudest Kiloton benchmark peaks at −1 dBTP with no audible pumping on music. *As built:* the ceiling is −1.05 dBTP (M3); the worst M4 measurement was −1.03 dBTP (M4_STATUS).

## 5. Mechanisms, power, light
- Every powered device has a **state loop**: off (silent) → spin-up one-shot → running loop (pitch by ω or supply factor) → spin-down one-shot. Motors whine with load (pitch drops under torque), Dynamo hums with output watts, Gale's airflow noise scales with strength.
- Jams: grinding stall loop + amber spark crackle. Brownout: electrical sag "wow" + flicker buzz.
- Signal: crisp relay click per pulse (pitch by receiver type). Ringer: bell alarm (startles critters). Delay: soft tick.
- Light: Lance hum, Torch click, Burning Glass sizzle on focus dwell, Suncell faint shimmer when lit.
- Arc Tower: charge-up rising buzz, branching crackle bursts, strike snap.
- Matter: granular synthesis from sand, water and marble grain banks. Density and velocity of particles near the listener (GPU reduction per frame: count and mean speed in 3 radius bands) drive grain rate and gain.

## 6. UI sounds
| Action | Sound |
|---|---|
| Hover card / button | Very soft tick (−30 dBFS) |
| Pick part / arm tool | Plastic click-up |
| Place (valid) | Satisfying "chunk" (scaled by part class) |
| Snap to port | Magnetic "thup" with a channel-tinted overtone |
| Blocked | Soft double "bonk" |
| Undo / redo | Tape-rewind blip / forward blip |
| LET IT RIP countdown | 3 rising tones + an ignition whoosh at 0 |
| Stop | Reverse-swell + snap back |
| Cascade Report | Ascending arpeggio per chain step (pitched in the world key), then a score sting |
| Ping (MP) | Look: sonar blip · Help: two-note question · Nice: bright chord · Boom incoming: low rising alarm |
| Chat | Soft pop |

## 7. Critters
- Each critter has an original voice set: 8–12 barks per state (idle, curious, startled, chase, flee, trapped, dizzy, happy, angry) + species actions (Mochi hiss and purr, Pip squeak and wheel patter, Goby bloop and flop slaps, Bandit chitter and pedal squeak, Biscuit woof and sniff, Henny cluck and egg "pop", Dusty beeps and vacuum whirr, Buzz rotor hum and chirps).
- Vocalisations are **performed by voice actors** (cartoon-stylised, never realistic distress). Run through formant and pitch processing for character.
- Barks have cooldowns (per critter 1.5 s; per species 0.5 s) and lip-sync visemes (A/O/E) from simple amplitude analysis baked at import.

## 8. Music
- **Adaptive score:** 3 base themes (Build, Run, Report). Run has **5 intensity layers** that add with the K.O. count rate and peak with yield (bass → drums → brass stabs → synth lead → choir "whoa" for > yield 10 in 2 s). Style: modern electro-funk meets big band, 100–124 BPM.
- **Build** music is calm, loopable for hours (60 min of non-repeating stems via a stem shuffle).
- **Report sting** is in the same key as the Run theme's current section.
- **World key** (default C major) is shared with Tonebars and Ding, so player-made melodies sit in the music. Musical parts are quantised to the beat only if "Quantize sound to beat" is on, which delays the audio only, never the sim.
- A manual track picker (Settings → Audio) offers 12 tracks; "Adaptive" is the default.

## 9. Ambience
Per environment: Studio (soft room tone, distant HVAC), Tinker Lab (still classroom tone, clock tick, MOCHI purring, radiator knocks, birds and a far-off school bell outside), Mega Kitchen (fridge hum, clock tick, birds outside), Backlot (wind, birds, distant crew chatter murmur, time-of-day variants), Orbital Hangar (air recyclers, servo whirs, radio beeps), Moon Base (near silence, suit-radio static textures, a low drone). 2–4 layered loops + random one-shots.

## 10. Asset specifications
| Item | Spec |
|---|---|
| Delivery | 48 kHz / 24-bit WAV masters in `audio/src/` (Git LFS) |
| Runtime | Opus in WebM/Ogg (VBR ~96 kbps SFX, 128 kbps music stems), packed into **banks** (`.bank` = header + Opus frames) |
| Loudness | SFX one-shots peak −6 dBFS; loops −18 LUFS-S; music stems mixed to −16 LUFS integrated; UI −24 LUFS |
| Naming | `<bus>_<family>_<object>_<action>_<variant>.wav`, e.g. `sfx_boom_bangstick_detonate_03.wav` |
| Loops | Sample-accurate loop points in WAV `smpl` chunk; tail-free |
| Metadata | `audio/cues.json`: cue id → files, gain, pitch range, priority, concurrency, bus, distance model |
| Budget | Core banks ≤ 18 MB, streamed music stems separate, environment ambience ≤ 4 MB each |

## 11. Asset list (by family; quantities are variations)

| Family | Cues |
|---|---|
| Rollers | roll loops ×8 materials × 3 speeds; impact banks via §3; Helio squeak ×4, pop ×6, deflate flutter ×3; Yolk crack ×4, splat ×4 |
| Frame | Brik mortar crack ×6, collapse cluster ×3; Plank creak ×4, splinter ×6; Tube ball-roll loop (resonant) ×3; Fulcrum pivot thunk ×4; Sprong boing ×6; Flap open/close ×4; Lift motor loop + stop clunk; Glidepath rail ring loop |
| Drive | Treadway loop ×3 speeds; Cog mesh tick loop (rate by ω); Band slap loop; Motor spin-up/loop/down; Dynamo hum; Hamster wheel patter loop; Turbine whoosh loop; Pedal Rig chain loop; Ram piston hiss ×4; Grabber servo set ×8 |
| Air | Gale airflow loop ×3; Puffer wheeze ×6; Blowout loop; Vac suction loop + "thoop" ×4; Inflator hiss loop + overinflate pop |
| Power & Signal | relay clicks ×8; Mains toggle ×4; Cell drain warble; Lamp ping-on ×3; Torch click; Lance hum; Burning Glass sizzle; Tripwire chirp; Stomp Pad press ×4; Button press ×4 (big satisfying click); Ringer bell loop; Delay tick; Ping chirp pair; Maglock clamp ×3; Arc Tower charge/crackle/strike ×12 |
| Fire & Boom | §4 stacks: small, medium, keg, nitro (glassy crack), aerial shells: 4 burst banks mapped to the 9 visual patterns (vfx.md §2.4: peony + ring + heart + starburst → boom; chrysanthemum + glitter → crackle; willow + palm → hiss-crackle; crossette → pops); Wick ignite + flicker loop; Fuse ignite/hiss/crackle; Skyrocket launch/whistle; Big Top boom + whistle; Cork Blaster pop ×6 + cork string zip; Flamer whoosh; Popper ×4; Singularity hum swell / suck / implosion stinger |
| Contraptions | Punchline spring whack ×6; Gotcha Box crank tune (music-box melody, 8 bars in world key) + pop + boing; Snipper snip ×6; Snaptrap snap ×4; Bonker bonk ×6; Flinger release ×4; Wrecker chain creak loop + impact boom; Pinger spring ×4; Paddle flip ×4, Bumper ding ×6; Toast Cannon tick loop + pop ×3; Fishbowl shatter ×4 + water slosh |
| Matter | grain banks (sand, marble, water droplets, slime squelch) for granular synthesis; Tank valve squeak; Waterwheel splash loop; Sponge squish ×4; Hourglass trickle loop + empty chime |
| Fun | Topple Tiles clack bank + cascade layers; Pins strike (strike/spare variants); Stackers wood clatter; Pane/Vase shatter ×6 each; Tonebars ×2 octaves × 3 velocities; Ding ×3; Zippy motor loop + bump; Quack squeak ×4 |
| Future | Fabricator print whirr + eject ×3; Recycler gulp ×4 + counter beep; Rift Gate hum + whoosh transit ×4; Grav Well / Tractor / Hover / Stasis / Force Wall / Coilgun loops + on/off; Zone enter chime (build mode only) |
| Critters | §7 per species |
| UI / MP | §6 |
| Ambience | §9 |
| Music | §8: 3 themes × stems, 12 tracks, stingers |

## 12. Sourcing
Original recordings (Foley sessions with real springs, dominoes, toys, motors, paper, glass), commissioned music and voice acting. CC0 libraries (Freesound with the CC0 filter) are allowed **as raw material** only and logged in `assets/LICENSES.csv`. No third-party music.
