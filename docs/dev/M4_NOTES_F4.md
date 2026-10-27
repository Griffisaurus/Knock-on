# M4 notes: stream F4 (audio)

Status: **done** (2026-10-24). Scope: [M4_PLAN](M4_PLAN.md) stream F4:

- sounds for the 15 M4 parts;
- BISCUIT, HENNY and DUSTY voices;
- Matter audio: granular sand, water and marbles from a GPU reduction around the listener.

Everything is still procedural Web Audio from fixed seeds. There are no sample files and nothing was downloaded.

## Files

| File | What |
|---|---|
| `audio/m4.ts` (new) | Sounds for the 15 M4 parts (72 bank entries, 164 variations) and the `M4Parts` director: events, part state (A4's flags and fill meter), measured motion. Also `M4_LOOPS`, the loop parameters for every M4 loop kind (index.ts `loopParams` delegates to it) |
| `audio/matter.ts` (new) | Matter audio. Grain tables (sand, water, marble; from fixed seeds), the `MatterField` type, the field → stream mapping (`streamParams`), the `MatterAudio` director and the fallback beds |
| `audio/matter-processor.js` (new) | The granular player: an AudioWorklet with 6 mono outputs. It loads from a same-origin file through Vite `?url`, like the limiter, so it passes the host's CSP (no Blob URLs) |
| `audio/matterprobe.ts` (new) | The GPU reduction (WGSL, 2 passes) plus `reduceCpu()`, a CPU reference of the same sums. It reads back 288 bytes per probe |
| `audio/testm4.ts` (new) | The M4 rows of the audio test page: live audition, the synthetic Matter fields, a GPU probe bench on synthetic grains, and 10 offline checks |
| `audio/critters.ts` | Adds BISCUIT, HENNY and DUSTY: 41 cues and 6 loops, plus their director logic and B4's `Bark` / `Lay` / `Splat` events |
| `audio/index.ts` | Routing (critters → yolk laid → m4 → pyro → m3 → mech → M1), the matter bus, the probe scheduling, the Matter streams in the voice budget and the ambience duck, M4 part profiles, `yolk` added to `ROLLERS`, the `matter` loop family, `setMatterView()` / `matterField()`, `stats.matter*` / `probes` / `probeMs` / `frameMs`, and `globalThis.__knAudio` (the live director, for console checks) |
| `audio/types.ts` | New loop kinds (`M4LoopKind`) |
| `audio/m3.ts` | A3's M3 kinds that M3 audio didn't know yet: `Trip` → tripwire chirp (deduplicated against its out-pulse `Signal`), `Confetti` → popper, `Jostle` → jitterjuice clink, and `Cook` swallowed (the cook loop follows the flag) |
| `audio-test.ts` | Adds the M4 types and calls `liveM4` / `offlineM4` |

### main.ts hooks (Edit tool, marked `audio (M4)`)

1. `import { matterView } from './matterhost.ts'` (MI's accessor for R4).
2. `audio.setMatterView(() => matterView() as MatterViewLike | null)`, called once after `setVolumes`. The cast is needed because `matterhost.ts` types `view()` loosely.

Nothing else changed in main.ts:
- YOLK rolls through the existing `ROLLERS` loop.
- Critters already get the meter through `audio.part`.

## Event and state mapping (A4: `M4_NOTES_A4.md` / `machine.ts` EventKind; flags from `channels/m4*.ts`)

- **The fill meter:** A4's dispenser meter is `1 + round(20 × fill)`. `m4.ts` reads it as fill (`FILL_STEPS`), and its rate of change separates draining from refilling.
- **Flag fallbacks:** a state fallback stays quiet if the event already played the cue within 0.3 s.
- **Unknown kinds** are ignored.

| Part | Events | State (part()) |
|---|---|---|
| GRIT HOPPER | `Valve` 1/0 → gate open / close · `Empty` → last trickle · `Refill` → intake patter | `lit` (pouring) → `loop/pour/sand` at the spout, rate-scaled by the measured drain · rising fill → intake patter · `fault` (low) → soft double beep |
| MARBLE HOPPER | `Valve` → chute clatter / tick · `Empty` → empty clunk (hollow globe + last marbles) | `lit` → pour rattle + rotary feed-clack loop + a counter tick every 0.25 s · rising fill → refill patter · `fault` → beep |
| TANK | `Valve` → valve squeak (rate 1 open, 0.92 close) · `Empty` → gurgle | `lit` → water pour loop (pitch drops as the head falls) · fill < 25 % while pouring → glugs every 0.45–0.95 s · rising fill → fill trickle · `fault` → beep |
| HOURGLASS | `Empty` (its signal) → done chime · `Flip` → flip clunk + sand shift · `Impact` J < 0.6 → glass clink | `lit` → very soft trickle loop · `pressed` edge → chime fallback |
| SPRINKLE CAN | `Trigger` (tip) → tip creak · `Empty` → 4 trailing drips · `Impact` J ≥ 0.15 while it holds water → slosh (plus the material knock) | `lit` → sprinkle loop (rose droplets) · `armed` edge (re-latched) → latch clack · rising fill → refill trickle |
| WATERWHEEL | `Stall`/`Jam` → stall groan | ω of the `arm` body → turn-creak loop. Each of the 5 bucket passes spills at the bottom and sloshes at the top. Drip patter for 3 s after turning; spinning then stopped → stall groan |
| SPONGE | `Squeeze` (mag = mL) → squish, plus drips when wet · `Impact` → wet thud / squish / dry bounce by wetness | `lit` (wet) edge → slurp; drips while wet; `pressed` → squish |
| BLOWOUT | `Powered`/`Unpowered`/`Toggle` → rocker click; off → cooling ticks over 4 s | `powered` or `armed` → dryer whine + air rush (slightly lower while warming) · off edge → click + cooling ticks |
| VAC | `Attach` → suction "thwup" · `Release` → pop · `Unpowered` while holding → pop | `powered` → suction loop · `pressed` (holding, clogged) → the whine climbs ×1.25 · press edges → thwup / pop |
| INFLATOR | `Valve` 1 → brass valve squeak + hiss onset · `Overfill` → overpressure beep | `lit` (valve open) → gas hiss whose pitch climbs with the fill (time since the valve opened; ~3 s to full) + gauge ticks speeding up · `pressed` → beep |
| ARC TOWER | `Arc` (mag = length) → arc crackle (12 variations) at the toroid, plus a zap at the event position when it isn't the tower's · `Unpowered` → power-down whine | `armed` (charging) → the tesla hum rises over 0.5 s · `lit` (arcing) → corona fizz, and crackles every 0.3–0.8 s if no `Arc` arrived · power lost → whine |
| TOAST CANNON | `Trigger` → lever clunk-latch · `Launch` → spring pop + ding + slice flutter · `Impact` on the cannon (its pooled slices) → toast landing | `armed` → toasting loop (4 Hz timer, element hum, crackle) · `armed` fall with no `Launch` → pop fallback |
| YOLK | `Splat` (placed yolk) → crack + wet slap · `Impact` → shell tap · `Spawn` → laid plop | roller: a wobbly shell-tick roll loop while rolling (not flying) |
| ZIPPY | `Drive` mag ±1 from 0 → beep-beep; a reversal → servo chirp + tyre scrub · `Impact` → plastic bump (J ≥ 4 → flip clatter) | `lit` (driving) → motor whine ∝ wheel speed, with doppler · hard acceleration → scrub · a 25° heading change in 0.25 s → servo chirp · `fault` or stalled 0.6 s → tow strain |
| QUACK | `Squeak` (mag 0–1) → squeak in 3 tiers (soft is short and higher; hard is a long falling honk) · `Impact` J ≥ 1 → rubber bounce · `Splash` → splash + bob drips | none |

Once a `Squeak` event arrives, impacts no longer squeak on their own, so QUACK never doubles.

## Critters (B4: `M4_NOTES_B4.md`)

All three are formant or synth stand-ins under final cue names, like the M2 voices. They are positional and follow the AUDIO §7 cooldowns.

| | Voice | Foley and loops |
|---|---|---|
| BISCUIT | `Bark` (B4: mag = dB; it causes the 70 dB sim `Sound`) → woof, or woof-woof 30 % of the time, gain from the dB. The `Bark` / `Sound` pair plays once, whichever arrives first, and skips the bark cooldowns because the sim is authoritative. Barks by category: idle sigh-groan, sniff snuffles, chase yips, `wake_startle` "boof", whine (trapped / flee), comedic grumble, dizzy "awoo-wobble", celebrate yip-howl | heavy paw thumps with nail clicks (stride 0.3 m) · dog snore while asleep · pant loop when happy or running (> 1.2 m/s) · deeper shake-off on getup |
| HENNY | bawk-bawk clucks, curious "buk?", flap squawk (`flap` clip and the startled flap), alarm cackle (flee), indignant squawk, dizzy warble, purr-cluck, proud chortle (`proud_puff`) · `Lay` → laid plop, then the egg song "bawk-bawk-BAGAWK" at +0.5 s, deduplicated against a yolk `Spawn` · `Splat` (a laid yolk breaks) → splat | wing flaps when she rises faster than 1 m/s · a flump when she lands · peck ticks and scratch scrapes on `peck` / `scratch` · roost murmur while asleep · claw steps |
| DUSTY | idle 3-note boops, happy arpeggio, curious "bweep?", alarm warble, error buzz, dizzy descending gliss, celebrate fanfare · `bin_full` clip, or the meter reaching 95 % → burp beep, once per fill | drive-motor loop ∝ speed, with brush ticks · suction roar (louder on the `suck` clip and while the fill rises) · bin rattle ∝ fill while moving · bumper bonk on `Impact` and `bump_turn` · tipped over (ragdoll) → plastic clatter + alarm · getup → self-right whirr |

B4's `bark`, `bark_run` and `lay_egg` clips and the `bark` / `egg` / `bin_full` emotes are silent by design: their events already carry the sound.

## Matter audio design

```
MI matterView() ─▶ MatterProbe (GPU, ≤ 30 Hz) ─▶ 72 floats, read back 1–3 frames late ─▶ MatterField
                                                                                          │
   per kind (sand / water / marble) × band (0–2 m, 2–8 m, 8–40 m around the listener):    ▼
   moving grains (> 0.05 m/s), Σ speed, speed-weighted centroid, falling (vy < −0.3 m/s), Σ fall speed, total
                                                                                          │
MatterAudio: 6 streams = kind × {near band, field = mid + far merged}; activity A = moving × speed
   (water adds falling × fall speed / 2), loudness log10(1 + A/scale)/3.6, field gain × inverse distance of the centroid
   attack 50 ms / release 300 ms (60 ms when paused or the field is stale)
                                                                                          ▼
matter-processor.js (AudioWorklet): per stream, Poisson grains from the tables (rate ∝ A^0.7–0.8, capped 700–1,400/s,
   overlap-normalised gain) crossfading into a band-passed noise bed (smoothstep on log A) ─▶ PannerNode at the centroid
   (rolloff 0: gain already has distance) ─▶ matter bus ─▶ sfx bus (spectacle, reverb send) ─▶ glue ─▶ −1.05 dBTP limiter
```

- **The probe:**
  - Pass 1 is 64 × 256 threads, grid-stride. Each thread sums into a private [kind][band][8] array, then a tree reduction runs in shared memory.
  - Pass 2 adds the 64 rows.
  - At most 2^20 grains are sampled per probe (stride = ⌈count / 2^20⌉), and the phase rotates so every grain counts over time.
  - Positions and velocities follow MX's `MatterView`: i32 × 3 in 1/65,536 m, and units per substep (× 240 / 65,536 → m/s). The kind is in `mat` bits 0–7.
  - A ring of 3 MAP_READ buffers holds the results; a probe is skipped when all 3 are busy.
  - Floats are only used here, never in sim state.
- **Voice budget:** each sounding stream counts as one voice in the 64 (`admit()` adds `matter.active`), so there are at most 6.
- **Ambience:** the ambience duck takes `1.5 × matter.level`.
- **Pause and stale fields:** a paused run, or a field more than 0.5 s old, silences the streams. Silent streams get exact zeros posted.
- **Fallback (no AudioWorklet):** each stream becomes two looped beds (`loop/matter/<kind>/sparse` and `…/dense`, granular renders of the same tables) in their own loop family (cap 6).
- **Determinism:** grain timing in the worklet comes from seeded mulberry32 per stream, never `Math.random`, so offline renders repeat exactly.
- **Part-level Matter sounds** (pour spouts, the sponge, the waterwheel, glugs) are in m4.ts, from A4's state. The field carries landing, flowing and splashing grains.

## Measurements (the test system, 2026-10-24)

The whole machine was contended throughout: CPU load 100 % and GPU 99 % (`nvidia-smi`; RTX 5090, 21.8–23.2 GB in use), with other streams running. **Every timing below is provisional.**

| What | Result | Method |
|---|---|---|
| GPU probe cost | **0.197 ms per probe** median (min 0.131) for 1M grains, and the same for 4M at stride 4 | GPU timestamp queries around the two passes, 20 probes, own WebGPU device, synthetic grains (`probeBench`) |
| GPU probe cost per frame | ≈ 0.1 ms per 60 Hz frame on average (it runs at ≤ 30 Hz) | as above |
| GPU probe readback latency | 3.4–5.2 ms wall (queueing behind other streams' GPU work); encode 0.06–0.09 ms CPU | as above |
| GPU vs CPU reference | max relative error 2.0e-7 (1M), 1.4e-7 (4M) | `reduceCpu()` with the same stride and phase |
| Granular worklet CPU | +6.7 % of one core with all 6 streams dense (median of 3: 10 s renders, 580 ms base → 1,250 ms); fallback beds +1 % | offline render time ÷ audio time |
| Director `frame()` | 0.06–0.36 ms (EMA), in game with the 174-part busy world | `stats.frameMs` |
| `part()` + events | 0.33–0.49 ms per frame average (max 1.4–6.2 ms under contention) | M4 stress render: 30 M4 loops + 6 critters + 6 rollers + all 6 Matter streams + booms |
| Voice budget, offline | M4 stress peaks at **64/64** (matter 6), with 552–663 steals | M4 stress render |
| Voice budget, in game | 174 parts (3 × every M4 demo + BISCUIT, HENNY, DUSTY, MOCHI; Matter off) peaks at **64/64**: 29–32 loops, 3 ambience, the rest one-shots. Limiter GR max 2.5 dB, 0 faults | headless Chrome on Vite :5208 → host :8808 |
| Limiter | max true peak over all 48 offline checks **−1.03 dBTP** | `truePeak()` 4× / 48 taps |
| Bank build | 2.4–2.9 s typical (M3: 1.45–1.6 s on a quiet machine); 4.6–13 s at the worst contention | `stats.buildMs`. M4 adds ≈ 0.55 s (m4), 0.1 s (critters), 0.15 s (matter beds + grain tables) of synthesis. It is async and yields every 8 ms |

### Matter levels (offline, listener at (0, 1.2, 3), 2 s each, the second half measured)

| Field | RMS | Peak |
|---|---|---|
| Sand, 20 grains near | −56 dB | −32 dB |
| Sand, 500 grains near | −37 dB | −20 dB |
| Sand, 300k grains moving at 4 m | ≈ −24 dB | ≈ −8 dB |
| Water, 100k grains at 4 m | ≈ −24 dB | n/a |
| Marbles, 20k at 4 m | ≈ −26 dB | n/a |

- The sand rows come from the calibration pass. The −4 dB trim was applied after it, and the last three rows are estimated from that pass plus the trim.
- The heaviest scenes ("all three at once", the 4M Sandstorm) touch the limiter with 0.5 dB of gain reduction.

## Checks

- **Audio test page:** 48 / 48 offline checks pass (38 from M1–M3 with unchanged results, plus 10 new M4), in 188 s in Chrome.
- **M4 offline checks:**
  - M4 event one-shots (53 slots, every one audible);
  - M4 loops via part() (15 slots);
  - M4 critters (egg song and bin-full reached);
  - Matter with the granular worklet;
  - Matter with the fallback beds;
  - Matter pause and stale fields (paused −55 dB, stale −67 dB);
  - M4 stress (64/64);
  - robustness M4 (NaN / Infinity meters, positions, quaternions, junk fields, bad events: 0 faults);
  - Matter probe at 1M and at 4M (GPU against the CPU reference).
- **Live rows:** every M4 event, loop and critter, 11 synthetic Matter fields, the probe bench, a probe → audio listen, and cue rows for every new bank entry.
- **Game:**
  - Vite :5208 with the host's CSP header and the local test server :8808 (`KNOCKON_STATIC=none`, own `KNOCKON_DATA`), in headless Chrome 155.
  - No console errors from audio. The only errors were favicon 404s and J4's CSP violation, below.
  - The limiter and the Matter worklet both load as `worklet` under the CSP.
  - With Matter on, the probe ran on MI's real view: 7 results, 3 streams sounding.
- **Commands:**
  - `tsc -p apps/game` is clean.
  - `vitest run apps/game/test`: 129 / 129 pass.
  - The repo-wide `pnpm -s typecheck` fails only in other streams' test files (see below).

## How to run

- **Server:** a scratch config `scratchpad/f4/vite.f4.config.ts` runs Vite on :5208 with HMR off, proxies to :8808, and sends the host's CSP header (`NOCSP=1` turns the header off).
- **Pages:** `http://localhost:5208/audio-test.html` has the live rows; "Run offline render checks" runs the full suite.
- **Console:**
  - `await __audioOffline('M4')` or `await __audioOffline('Matter')` runs a subset.
  - In the game, `__knAudio.stats` shows the live director.

## Reported to other streams (not fixed)

- **J4:** multithreaded Jolt loads a `data:text/javascript` module in the worker (`node_modules/.pnpm/jolt-physics@1.1.1`, the contact-callbacks shim), and the host's CSP (`script-src 'self' 'wasm-unsafe-eval'`) blocks it. Under that CSP the run never plays; it happened 8 times in one load. It needs a same-origin file (the limiter's `?url` pattern) or a CSP change by the host owner.
- **MI / MX / A4:**
  - With `simFlags.matterGameplay` on, the 58-part world of all M4 demos bakes at **SIM 0.035–0.05×** in Chrome (2.9 s baked after ~35 s; 13.9 s after 400 s). With Matter off, the same world runs at full speed.
  - Measured while the GPU sat at 99 % with other streams' work, so it may be partly contention.
  - Because of it, the in-game Matter field check is short: 7 probes, up to 3 streams.
- **Repo typecheck** (`pnpm -s typecheck`) fails in:
  - `packages/matter/test/matter.test.ts` (MX: exports renamed: `GRAIN_R`, `SCENE`, `MATTER_WGSL`, `initialState` …);
  - `packages/format/test/matter_header.test.ts` (MI);
  - `packages/assets/test/m4_parts.test.ts` (`max` on a pivot).
- **Run auto-pause (headless only?):** right after LET IT RIP the run showed paused at 0.36 s until Play was pressed. It may be a blur or visibility pause in headless Chrome. Not investigated.

## Deviations and open items

- **Synthesised stand-ins:** all M4 part sounds and critter voices are synthesised under the final cue names. AUDIO §7 still plans voice actors.
- **Matter field:**
  - It comes from a GPU reduction, and there is no CPU field: with the CPU backend in the browser, or no view, only the part-level Matter sounds play.
  - `matterField()` accepts a field computed anywhere, for example from `reduceCpu()` over a CPU snapshot.
- **Arc zap position:** the zap plays at the `Arc` event's position. If A4 puts the event at the tower rather than the target, only the crackle plays (the target is in `other`, and audio doesn't know other parts' positions).
- **WATERWHEEL:** its ω comes from the `arm` body's rotation, assumed to be the wheel. If A4 names the wheel body differently, the turn loop won't hear it; that is a one-line change in main.ts's `poseOf(id, 'arm')`.
- **INFLATOR:** its fill pitch is time-based, because A4's meter is 0 for it. R4's `fill()` holds the real value; feeding it to audio would mean extending `audio.part()`.
- **SPONGE:** wetness is A4's `lit` flag, not a fill level (its meter is 0).
- **Probe sampling:** the probe samples at most 1M grains (stride 4 at 4M). Tiny near trickles in a huge world are statistically thin but smoothed. `PROBE_MAX_SAMPLES` trades cost against fidelity.
