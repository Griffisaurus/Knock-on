# M3 notes: stream F3 (audio)

Scope: [M3_PLAN](M3_PLAN.md) stream F3. That covers sounds for the 30 M3 parts, spectacle audio for G3's hitstop and slow-mo, Kiloton mass-explosion merging under a −1 dBTP master limiter, THE TINKER LAB ambience, and music v2. Everything is still procedural Web Audio built from fixed seeds, with no sample files.

Stream A3 had not published `M3_NOTES_A3.md` or any new `EventKind`s when this was written. Every M3 part is therefore driven three ways, and whichever arrives first wins: events (M2 kinds plus likely M3 names), part state (flags, meter, the `arm` body), and context (paths, surfaces). Unknown kinds are ignored, and a flag-edge fallback stays quiet if the matching event already played its cue within 0.3 s. Once A3 lands, any mismatch is a one-line change in `m3.ts` `Gadgets.event()` or `Gadgets.part()`.

## Files

| File | What |
|---|---|
| `audio/m3.ts` (new) | Sounds for the 30 M3 parts (about 100 recipes) and the `Gadgets` director: events, part state, marble surfaces, Glidepath rails and boosters, the Tonebars and Ding pitch logic, Skyshow shells |
| `audio/pyro.ts` (new) | Powder Keg and Jitterjuice layer stacks, multi-group chain merging, barrage mode with a rumble bed, the "mega" layer. Replaces the single-group merge that M1 had in index.ts |
| `audio/limiter.ts` (new) | AudioWorklet true-peak limiter, loaded from `limiter-processor.js` via Vite `?url` (orchestrator fix at close-out: the host's CSP `script-src 'self'` blocked the original Blob URL, so the limiter silently fell back to no limiting in production): lookahead 5 ms, ceiling −1.05 dBTP. Also `truePeak()`, the test meter |
| `audio/index.ts` | Routes events (critters → pyro → m3 → mech → M1), installs the limiter, adds the spectacle hooks, pyro far-field compensation, loop reference distance, the M3 part profiles, the per-frame `part()` early-out, `setAmbientMochi`, `setWorldKey`, `musicStats` |
| `audio/ambience.ts` | Adds THE TINKER LAB. Studio and Kitchen are unchanged (the Kitchen logic moved into its own method) |
| `audio/music.ts` | Music v2: Build sections with a stem shuffle; Run gets an A/B form, fills, the L5 barrage layer, boom accents and the Kiloton drop |
| `audio/mech.ts` | `MECH_PART_TYPES`; `pathKind()`; `setPaths` now keeps only tubes and gutters (glidepaths go to m3.ts) |
| `audio/bank.ts` | Adds the Tinker Lab reverb IR (RT60 0.8 s) |
| `audio/types.ts` | New loop kinds, `PlayOpts.farComp` and `LoopOpts.ref` |
| `audio-test.ts` | Live rows for every new feature, an audition row for every M3 cue, and 15 new offline checks (38 in total, all passing). Adds a true-peak column, limiter gain-reduction stats, and `window.__audioOffline(filter)` |

## main.ts hooks (Edit tool, each marked `audio (M3)`)

1. `setPaths` now also passes links whose kind matches `glide`.
2. `audio.part(…)` gets an eighth argument, the `arm` body's position. The `arm` pose is now looked up once and supplies both the rotation (for ω) and the position (lift deck, ram rod, rack).
3. Ambient MOCHI:
   - A `doc` net event sets a dirty flag.
   - In the frame loop, `audioMochiCheck(now)` rescans `doc.parts` for a `mochi` at most every 2 s and calls `audio.setAmbientMochi(!found)`.
   - The scan stops at the first MOCHI it finds.

## Event mapping (M3 parts)

Type ids are the brief ids. Aliases are accepted: `glint`/`bearing` → `marble`, `pins` → `pin`, `stackers` → `stacker`, `tonebar` → `tonebars`, `mirror`/`splitter` → `mirror_splitter`, `keg` → `powder_keg`, `ping_tx`/`ping_rx` → `ping`, and `zone*` → `zone`. "Trigger" below means any of `Signal`, `Launch`, `Press`, `Toggle`, `Fire`, `Snap`, `Trigger` or `Extend`.

| Part | Events | State (part()) |
|---|---|---|
| LANCE | `Lit`/`Powered` → charge whine · `Unlit`/`Unpowered` → off tick · `Ignite`/`Cut`/`Burn`/`Heat` → burn flare | hum loop while lit or powered · burn sizzle loop while lit and (`armed` or meter > 0) · lit edges fall back to charge and off |
| MIRROR / SPLITTER | `Lit` → optic ting | prism shimmer loop while lit · lit-edge ting |
| TRIPWIRE | `Lit` → arm beep · `Signal` → trigger chirp plus a quiet relay | lit-edge arm beep |
| PING | `Signal` from the first ping → tx blip; from a different ping within 150 ms → rx blip. `Send`/`Receive`/`PingTx`/`PingRx` are explicit. Pitch per pair comes from `mag` (the colour) | none |
| MAGLOCK | `Powered` or `Toggle 1` → energise thunk · `Unpowered`, `Toggle 0` or `Release` → release tink · `Attach`/`Grab`/`Latch` or `Impact` with J ≥ 0.3 → steel clack | hum loop while powered · powered-edge fallbacks |
| GLINT / BEARING | `Impact` with `other` = a marble → marble click | rolling: see "Rollers" below |
| GLIDEPATH | `Boost` → booster whoosh | any roller within 0.15 m of a glidepath path gets the rail-rumble loop. A rise of more than 1 m/s within 0.25 s also fires the booster whoosh (0.8 s cooldown) |
| SPINDECK | `Powered`/`Unpowered` → clunk | hum and gear-whine loop from ω (`arm` rotation) · a clunk on measured start and stop |
| LIFT | `Powered`/`Unpowered` → clunk · `Arrive` → chime | motor loop from the speed of the `arm` body · start clunk; stop clunk and arrive chime · with no `arm`: motor loop while powered |
| RACK | none | ratchet loop with clicks proportional to linear speed (from `arm` position, else ω) · end-stop thunk after a fast run stops |
| RAM | trigger or `Powered` → pneumatic fire · `Retract`, `Toggle 0` or `Unpowered` → retract hiss | `powered`/`pressed` edges fall back to fire and hiss |
| POWDER KEG | `Detonate` → pyro keg stack (see below) | fuse loop while `armed` · cook-creak loop while `lit` (heating) |
| JITTERJUICE | `Detonate` → nitro crack-boom stack · `Impact` with J < 0.15 → glass clink | quiet fizz loop within 4 m |
| SKYSHOW | `Launch`/`Shell` → lift thump plus shell whistle, with a burst auto-scheduled 1.5 s later and 12 m up · `Burst`/`Detonate`/`Pop` → that burst (it cancels the pending auto-burst). `mag` 0–8 picks the pattern: peony, ring, heart and starburst → boom; chrysanthemum, glitter → crackle; willow, palm → hiss; crossette → pops | fuse loop while `armed` |
| FLAMER | `Lit`, `Ignite` or `Toggle 1` → piezo tick and whoomph · `Unlit`, `Extinguish` or `Toggle 0` → sputter | roar loop while lit (meter scales it) · lit-edge fallbacks |
| POPPER | `Pop`/`Launch`/`Detonate`/`Fire`/`Burst` → crisp bang plus confetti flutter | none |
| SNAPTRAP | trigger → snap, spring twang and fling whoosh | none |
| BONKER | trigger → swing whoosh · `Impact` with J ≥ 0.4 → rubber bonk | none |
| FLINGER | trigger → latch, arm whoosh, padded stop slam and spring twang | none |
| WRECKER | `Impact` with J ≥ 1 → heavy steel boom and crunch | chain-creak loop above 0.3 m/s · swing-air loop above 1.5 m/s (from base motion) |
| PINGER | trigger → spring release · `Impact` with J ≥ 0.5 → strike thock | none |
| PADDLE | trigger → solenoid flip clack (`Toggle 0` gives a soft return tick) · `Impact` with J ≥ 0.5 → rubber thwack | `powered`/`pressed` edge → flip |
| BUMPER | trigger, `Kick` or `Impact` with J ≥ 0.05 → electro "bonk-ding" (0.1 s cooldown) | none |
| PINS | `Impact` → pin knock (3 tiers × 4); 5 or more hits within 150 ms → one strike-clatter layer · `PinsAllDown`/`Strike` → a short sting | none |
| STACKERS | `Impact` → hardwood knock (3 × 4); 6 or more within 150 ms → tower-collapse layer | none |
| PANE / VASE | `Break`/`Shatter` → hero shatter (pane: crack plus a 2.4 s shard rain; vase: ceramic) and a shard-settle tail · `Impact` → the glass material bank | none |
| TONEBARS | `Note` → a glockenspiel bar (3 velocity layers; velocity from the last `Impact` J). `mag` ≥ 24 is MIDI; otherwise it's a world-key degree from C5 (15 bars = 2 octaves plus the top tonic) · `Impact` with no `Note` within 50 ms → falls back to a degree hashed from the part | none |
| DING | `Note` → the desk bell (degrees start at C7) · `Impact` or `Press` → the bell at the world tonic (C7) after the same 50 ms wait · `Impact` with J < 0.25 → dull dunk | none |
| FABRICATOR | `Spawn` (part = fabricator, `other` = fabricator, or within 0.8 m of a fabricator) → servo whirr, voxel chirps and spawn pop, pitched by the spawned mass | idle hum while `powered` or `armed` |
| RECYCLER | `Despawn` (part = recycler, `other` = recycler, or within 0.8 m of one) → gulp (small, medium or large tier by the swallowed mass) plus a count tick · `Signal`/`Goal` → goal chime | none |
| ZONE | swallowed silently | a faint hum (meter scales it) |

### Rollers (marbles and rails)

- Every roller first goes to `m3.roller()`:
  - **On a glidepath path:** rail rumble. Glint and Bearing play at the full rail rate; heavier balls play lower.
  - **Glint / Bearing elsewhere:** a surface-specific roll loop, used only while rolling rather than flying (|v_y| < 0.35 m/s).
- The surface comes from:
  - the tube or gutter path (tube → glass, gutter → wood);
  - otherwise the nearest surface part within 0.65 m, from a 0.5 m grid fed by `observe()`. The grid covers plank, slope, ledge and the like (wood), pane and mirror (glass), and tonebars, trap box, spindeck, lift and the like (steel);
  - otherwise the environment floor: Tinker Lab and Studio → wood, Kitchen → glass (tile).
- Everything else falls through to `mech.roller()` (floor, tube, gutter, vortex), as in M2.
- `ROLLERS` now includes `glint` and `bearing`.

### Impacts

All 30 M3 types (plus `glint`/`bearing`) have material and mass profiles, so unhandled impacts use the M1 material banks.

## Pyro and Kiloton (AUDIO §4)

- **Stacks:**
  - Bangstick: unchanged.
  - Powder Keg (yield 3): crack, then a dedicated 4.4 s keg body (deep thump, ringing iron hoops, oak stave clatter), then a long 3.8 s keg sub tail, then wood debris.
  - Jitterjuice (yield 1.5): glassy nitro crack, medium body, sub, glass debris.
- **Merging:**
  - Up to 4 groups live at once.
  - A detonation folds into a group within 80 ms and 8 m. When all 4 slots are busy, it folds into the nearest group.
  - When a group closes, it plays an aftermath body at the summed yield (capped at 40), plus 1–3 debris tails.
- **Barrage mode (≥ 5 yield in 0.5 s):**
  - Windows widen to 150 ms and 14 m.
  - New leads drop their tails and get 1/√n headroom under the groups already ringing.
  - Aftermaths are spaced at least 0.2 s apart.
  - The `loop/barrage` rumble bed (reference distance 8 m) follows the yield rate, positioned at the yield-weighted centroid of the last second.
- **Mega layer:**
  - Triggers at > 40 yield in 2 s, at most once per 5 s.
  - Plays a 6.5 s rolling sub-thunder and calls `music.mega()` (the drop).
- **Distance:**
  - Pyro voices get far-field compensation of ×(d / 3 m)^0.85, capped at 8 (reached at about 34 m). The near field is unchanged.
  - Without it, a Kiloton seen from the Arena camera came out quieter than the music.
  - The speed-of-sound delay beyond 30 m is unchanged.
- **Make-up:** a pyro make-up of 1.6×, measured (see below).

### Limiter and gain staging

- **Chain:** `masterIn → glue → +1.36 dB trim → limiter → out`.
- **Glue:** loosened from −16 dB 3:1 to −14 dB 2.5:1. The Web Audio compressor's automatic make-up, (1 / full-range gain)^0.6, was the de facto limiter: it saturated near −1.5 dBFS, so the real limiter never saw a peak, and it pumps (0.3 s release).
- **Trim:** the +1.36 dB trim restores the M2 levels below the glue threshold. Studio ambience max-window RMS is −46.7 dB, against −46.8 in M2.
- **Limiter detection:** linked stereo with 4× polyphase sinc true-peak detection.
- **Limiter gain computer:** a sliding minimum over 5 ms, then a program-dependent release (70 ms; 500 ms once it has been working for a while), then a 5 ms box average. This gain can never exceed what the delayed sample needs, so there is no overshoot. A hard clamp at the ceiling backs it up.
- **Fallback (no AudioWorklet):** a fast compressor, then a smooth sample-peak ceiling at −1 dBFS.
- **Reporting:** stats are posted every 100 ms (`stats.limiterGrDb`, `limiterMaxGrDb`, `limiterTpOut`, `onLimiterStats`).

### Measured limiter peaks

Offline renders at 48 kHz in Chrome (the Claude desktop browser pane) on the test system. True peak was measured independently by `truePeak()`: 4× oversampling, 48-tap Blackman-windowed sinc per phase.

**Kiloton scene:** 400 Bangsticks and 60 Powder Kegs. 64 go off together (the T-Plunger broadcast), then the chain spreads through a 6–12 m ring over 3 s. Six Brik chunk impacts fire per frame, the music is in run mode, and the Tinker Lab ambience is on.

| Render | Sample peak | True peak | Max GR | GR p95 | Release (max) | Voices |
|---|---|---|---|---|---|---|
| Kiloton, Arena camera (35 m) | −3.35 dBFS | −3.35 dBTP | 0.0 dB | 0.0 dB | — | 43/64 |
| **Kiloton, inside the fortress (loudest)** | −1.05 dBFS | **−1.05 dBTP** | 1.9 dB | 1.8 dB (0.9 s above 1 dB) | 1.3 dB / 100 ms | 43/64 |
| Kiloton, inside, fallback limiter | −1.60 dBFS | −1.45 dBTP | n/a | n/a | n/a | 43/64 |
| M3 stress (30 M3 loops, 12 marbles, kegs, pins, tonebars, Tinker Lab, music) | −1.05 | −1.03 dBTP | 2.5 dB | | | 64/64 |
| M2 stress (unchanged scene) | −1.05 | −1.04 dBTP | 1.3 dB | | | 64/64 |
| 400 booms / 2 s + music (M1 scene) | −1.14 | −1.10 dBTP | 0.0 dB | | | |

- The loudest Kiloton peaks at the −1 dBTP ceiling. The limiter's peak gain reduction is under 2 dB, and its release never goes faster than 1.3 dB per 100 ms, so there is no audible pumping.
- In the Kiloton renders, 420 detonations merged into 40 lead stacks, 1 mega layer and 1 music drop.
- Across all 38 renders, the highest true peak is −1.03 dBTP.

## Spectacle (G3 hooks: wall clock only)

New public API, for G3 to call from its main.ts hitstop and slow-mo hooks:

- **`audio.hitstop(ms, strength = 1)`** (GAME_SPEC §13: 60–100 ms; `strength` = comfort setting):
  - pyro, tail and fx voices that started in the last 0.4 s sag in pitch (−20 % × strength across the freeze) and spring back over ~120 ms;
  - the sfx bus low-passes towards 1.8 kHz and dips −4.5 dB;
  - the music dips −8 dB;
  - everything recovers over ~70–150 ms;
  - loops sag their pitch by 10 % while the hitstop lasts.
- **`audio.slowmo(scale, seconds)`** (0.25× for 0.8 s):
  - one-shots and loops pitch to 0.75 + 0.25 × scale;
  - the sfx low-passes (7.25 kHz at 0.25×) and its reverb send rises ×2 (the time-stretch smear);
  - the music low-passes (5.75 kHz at 0.25×) and ducks −3.75 dB;
  - a reverse "time snap" swell lands on the end (only for slow-mo of 0.6 s or more);
  - all of it releases over 0.25–0.4 s.
- **Inferred slow-mo:**
  - Works even without the explicit calls. `setPlayback` measures the playhead's real rate over 0.3 s, and if every frame advanced but slower than 0.9 × speed, that rate becomes the time scale for pitch.
  - Stalls (bake wait, hitstop, run start) are ignored, so they never read as slow-mo.
  - `stats.timeScale` exposes the value. Offline check: a playhead at 0.25× reads 0.25.
- None of this touches sim ticks.

## THE TINKER LAB (environments.md §3.7)

| Hook | Implementation |
|---|---|
| `amb_tinker_room` | 12 s seamless bed: a warm, still room tone plus a distant schoolyard wash through the glass. The wash is wordless: band-limited noise in slow swells, with no formants and no chatter |
| `amb_tinker_clock_tick` | 1 Hz tick-tock above the chalkboard, at set (0, 8.3, 7.4). Lighter than the Kitchen's giant clock |
| `amb_tinker_mochi_purr` | the `loop/purr` bed at the cushion (set (3.6, 6.6, 1.95), ~3 m radius), plus a sleepy `mochi/mrrp` (rate 0.82) every 25–70 s when quiet. Fades out when `setAmbientMochi(false)`; offline check: 4 → 3 ambience voices |
| `amb_tinker_pendant_hum` | filament buzz: one emitter over the bench row, one over the floor-mat row (2 m radius) |
| `amb_tinker_radiator` | a tick or a knock (4 variants) from the radiators under the windows, every 20–60 s (seeded) |
| `amb_tinker_window` | birds and leaf gusts at the left windows, plus distant wordless yard one-shots (a ball bouncing, a gate, a coach's whistle) every 4–12 s when quiet · a far-off school bell every 2.5–5 min |
| Reverb | classroom IR: RT60 0.8 s, soft and warm early reflections |

- **Coordinates:** set coordinates convert per preset. Room uses the set origin; Desk's world origin is set (0, +6.2, +1.8).
- **Mode behaviour:** the same as the Kitchen. Build is full. Countdown is −3 dB with one-shots held. Running is −4 dB, ducked by action, and in M3 also by explosion density. Radiators may still tick in a moderately busy run; the bell holds off during countdown.
- **Levels (offline, Room camera):** RMS −48.6 dB, max 100 ms window −45.7 dB. The brief targets −46 LUFS in-mix. Ambience voices: 4.

## Music v2

- **Build:**
  - The bed is now arranged in 16-bar sections (about 53 s at 72 BPM).
  - Each section shuffles extra stems over the pads and plinks: a marimba arpeggio, an electric-piano comp, soft brushes.
  - Every section from the second on plays at least one of marimba or EP, and the arrangement never repeats twice in a row. Plinks thin out under the marimba.
  - Offline check: the 70 s bed crossed two sections.
- **Run:**
  - The 8-bar vamp becomes a 16-bar A/B form (B: F–G–Em–Am / Dm–Em–F–G).
  - A 16th-note snare fill leads into every 8th bar when intensity > 0.5.
  - New **L5 barrage layer**: on when explosion density (yield per 0.5 s) > 0.25. It plays taiko on 1, the "and" of 2 and 3 (more hits when dense), low brass swells every 2 bars, and crashes every 4 bars.
  - **Boom accents:** kegs (yield ≥ 1.5), or any boom during a barrage, queue a taiko (and a crash when dense) on the next 8th, at most one per beat.
  - **Kiloton drop** (`mega()`): a 2 s riser into the next bar line at least 1.2 s ahead, a one-beat breath with L0–L4 silent, then crash, taiko, swell chord and choir on the downbeat. All layers are forced on for 8 bars.
- New instruments: marimba, EP, taiko, crash, brass swell, riser. All are single pre-rendered notes, as before.
- Offline check: the barrage plus a 40-yield burst gave 1 drop and 13 accents.

## Budget, robustness and performance (measured on the test system)

- **Voices:** 64 is still the cap. The M3 stress render (30 M3 loops, 12 marbles, kegs, pins, Tonebars, the Tinker Lab with 4 ambience voices, music) peaks at exactly 64/64, with 234 steals. Kiloton peaks at 43/64.
- **NaN hardening:**
  - Every new AudioParam write is clamped and finite-checked. That covers `ramp()` for the spectacle, the voice playbackRate warp, the loop reference distance, ambience gains and rates, and music voice rates.
  - The limiter worklet zeroes non-finite input.
  - New offline check `robustness M3`: NaN and Infinity through M3 part, arm, meter and roller inputs, event magnitudes and positions, `hitstop`, `slowmo` and `setWorldKey`. Result: 0 faults, finite output.
  - The M2 robustness check still passes. `hitstop`, `slowmo`, `setAmbientMochi` and `setWorldKey` are guarded entry points.
- **Per-frame `part()` cost:**
  - Only types with per-frame state reach a director: the `MECH_PART_TYPES` / `isM3` early-out.
  - Surface registration is one set lookup.
  - Timed in the browser, 20 frames each, median: 100k Topple Tiles 1.29 ms per frame (p90 1.87); 10k planks (surface index) 0.56 ms; 1k Lances (stateful) 0.21 ms; 1k Bangsticks 0.03 ms.
  - In M2, every part created director state and a velocity estimator.
- **Offline render CPU:** Kiloton 5.9–6.5 % of real time (the render time divided by the audio duration); M3 stress 15.8 %.
- **Bank build:** about 1.45–1.6 s on the test system (M2: about 0.85 s). It is still async and yields every 8 ms.
- **Offline checks:** 38/38 pass in the full suite run in Chrome via the local Vite server.

## How to run

- **Server:** a local Vite on :5186 with HMR off (scratch config `vite.f3.config.ts`, which doesn't touch the shared config).
- **Page:** `http://localhost:5186/audio-test.html`. The live rows are for listening; "Run offline render checks" runs the full suite.
- **Console:** `await __audioOffline('Kiloton')` runs a subset.

## Waiting on other streams

- **A3 (EventKind):** not published yet. Audio switches on strings, so nothing breaks. Things to confirm when A3 lands:
  - **Kind names:** whether A3 uses `Burst`, `Boost`, `Arrive`, `Retract`, `Attach`, `PinsAllDown`, `Send`/`Receive`, or other names.
  - **Note events:** whether Tonebars and Ding emit `Note` (with MIDI or degree in `mag`).
  - **Spawn / Despawn:** whether these carry the fabricator or recycler in `part` or in `other`. Both are handled, with a proximity fallback.
  - **Flags:** which flag bits mark "cutting beam" (assumed `armed`) on LANCE and "cooking" (assumed `lit`) on POWDER KEG.
  - **Moving bodies:** whether the lift deck, ram rod and rack are the `arm` body.
  - **Path kind:** whether the Glidepath path link kind contains `glide`.
  - **Variants:** Glint vs Bearing comes from separate types if A3 uses them. With a single `marble` type, audio plays it as Glint.
- **G3:** nothing calls `audio.hitstop()` or `audio.slowmo()` yet. G3 should call them from its main.ts hooks, wall clock only. Until it does, slow-mo is still heard through the inferred playhead rate.
- **ZONE:** the wind bed from the brief (`zone_wind_bed`) needs the zone's mode, which `audio.part()` doesn't receive. Every zone plays the faint hum for now.
- **World key:** `setWorldKey(root, scale)` exists for Tonebars and Ding (default C major), but nothing sets it because the doc has no key setting yet. The music stays in C.
- **Other streams' typecheck errors (reported, not fixed):** `src/ui/panels.ts` (U3, Candidate/Command types). `src/main.ts` had a transient `inspectorHooks` error mid-session, which later cleared. `apps/game` has no audio or audio-hook errors.

## Deviations

- **Sounds:** all M3 sounds are synthesised stand-ins under the brief cue names, and the marble "pour" (Matter grains) is M4.
- **Distance model:** the pyro far-field compensation is a gain on top of the standard inverse model, not a separate distance model per AUDIO §2.
- **Glue compressor:** its parameters changed (−16 dB 3:1 → −14 dB 2.5:1) and a +1.36 dB trim was added. M2's measured levels are preserved; the change was needed so the limiter, not the glue, sets the ceiling.
- **Glidepath "booster whirr loop":** not built. The booster is the one-shot whoosh, detected from speed or a `Boost` event.
