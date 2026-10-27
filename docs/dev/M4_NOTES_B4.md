# M4 notes, stream B4 (critters, sim)

Scope: BISCUIT, HENNY and DUSTY in the sim (GAME_SPEC §11, SIMULATION §7, critters.md), plus MOCHI's `flee(Biscuit)`. Same standard as the M2 cast ([M2_NOTES_B.md](M2_NOTES_B.md)): deterministic FSMs on per-critter xoshiro streams, perception, capsule (or disc) locomotion, swing-twist ragdolls built dormant with the world (D66), never die, all run state plain data in `st.crit`.

**Status: done** (2026-10-24). Soak and test results at the end.

## Files

| File | What changed |
|---|---|
| `packages/sim/src/critters/m4.ts` (new) | `M4Critters`: the three species' think / act / clips, HENNY's YOLK pool, DUSTY's zone, bumper, tumble, leash and Matter intake, BISCUIT's bark and barge, MOCHI's `dogThreat`. |
| `packages/sim/src/critters/system.ts` | Hooks into `M4Critters` (each commented `M4 (B4)`): build (disc body, cylinder rag, pool in the critter's collision group), init, contact, postContacts, ragdoll, afterRestore, think / act / finish dispatch, `thinkMochi` (flee Biscuit), `castHit`, and two new Machine hooks `impact()` and `blastPieces()`. Class members lost `private` so m4.ts can use them (nothing outside `critters/` does). |
| `packages/sim/src/critters/state.ts` | `M4St` (one per critter, only in worlds with an M4 critter) and `CritWorld.egg` (pool slots), hashed only when present: **M2 hashes and goldens are unchanged.** |
| `packages/parts-data/src/critters.ts` (shared, Edit) | Appended table entries, `CritterFlagBits.sucking`, `CRITTER_BIN_SHIFT`, `RagBone.shape`, `CritterSpec` optional M4 fields (`disc`, `barge`, `mouth`, `vent`, `intake`), MOCHI `lureAs: 'mochi'`, the three specs and ragdolls, `CRITTER_M4` numbers, part defs, cards, demos. |
| `packages/parts-data/src/defs.ts` (shared, Edit) | `ship` gains `'M4'` (A4 needs it too). |
| `packages/sim/src/machine.ts` (shared, Edit) | `EventKind` += `Bark`, `Lay`, `Splat`; critterHost += `shapeFor`, `sound`, `powerLinked`, `matter`; `critters.impact(...)` after each Impact event; `critters.blastPieces(P, R, boom)` once per blast. All commented `B4 (M4)`. |
| `packages/sim/test/critters_m4.test.ts` (new) | 27 tests: contract data, 3 goldens, per-species behaviour, TRAP BOX fit, Matter (stand-in and MX's CPU backend, a full bin closing the intake, rollback across vacuuming), replay / late-poke rollbacks / checkpoint transfer, a minute of the new cast. |
| `packages/sim/test/matter_fake.ts` (new) | A tiny exact stand-in `MatterBackendSync` (grains drop to the floor, intakes take them), for contract-level Dusty tests. |
| `packages/sim/test/fuzz_scenes_b4.ts` (new), `fuzz.test.ts` (2 lines) | Property-fuzz scenes for HENNY (`eggs`) and DUSTY (zone); BISCUIT's runs once per seed. |
| `packages/sim/test/critters.test.ts` | `SPECIES` and the ragdoll table list the new three. |
| `apps/host/soak/critters.ts` | Every scenario adds BISCUIT, HENNY (random eggs, on a high LEDGE or by the cage sometimes), DUSTY (random zone, grain patches, a charge leash a RINGER switches a third of the time); `--matter N` runs every Nth scenario with MX's CPU backend and real grains for Dusty; new stats; pooled eggs in the checks. |

## Wire tables appended (rule 12)

Indices are wire values; the M2 entries keep theirs (a test checks).

| Table | New entries (index) |
|---|---|
| `Species` | `biscuit`, `henny`, `dusty` |
| `CRITTER_FSM` (33 → 50) | sleep 33, wake 34, bark 35, sniff 36, shake_off 37 · peck 38, scratch 39, flap 40, lay_egg 41, glide_down 42, proud_puff 43 · patrol 44, bump_turn 45, beeline 46, vacuum 47, bin_full 48, scan 49 |
| `CRITTER_CLIPS` (38 → 53) | bark 38, bark_run 39, wake_startle 40, barge 41, tail_wag 42, shake_off 43 · flap 44, lay_egg 45, glide_down 46, peck 47, scratch 48, proud_puff 49 · suck 50, bin_full 51, bump_turn 52 |
| `CRITTER_EMOTES` (23 → 31) | bark 23, eyes_mochi 24, bone 25 · egg 26, !! 27, feather 28 · sparkle_clean 29, bin_full 30 |
| `EventKind` | `Bark` (BISCUIT: mag = dB; it is the `cause` of the 70 dB `Sound` that follows), `Lay` (HENNY: mag = egg number 1…, pos = the vent), `Splat` (a laid YOLK breaks: part = HENNY, mag = J; 0 in a blast; cause = what hit it or the Detonate) |
| `CritterFlagBits` | `sucking: 16` (DUSTY's intake running). Bits 5–7: DUSTY's bin, `(flags >> CRITTER_BIN_SHIFT) & 7` = lit cells (0–5) on `SCREEN__bin` |

## For E4b (clips), F4 (voices), U4 (captions), R4 (rendering)

**What each state plays** (`critterState` byte 0). The sim reports one clip; `bark_run`, `barge` and `tail_wag` are the art's additive layers, so the renderer should lay them over `chase` / `walk` / `idle` when it sees them.

| Critter | FSM → clip |
|---|---|
| BISCUIT | sleep → sleep · wake → wake_startle (0.5 s) · chase → chase, or bark_run for 0.6 s after each bark, or barge for 0.4 s after a shove · bark → bark · sniff → sniff · celebrate → celebrate (play tag) · shake_off → shake_off (after dizzy) · wander → walk (barge after a shove) · idle → idle / tail_wag · lost → emote_confused · trapped, ragdoll (tumble), getup, dizzy |
| HENNY | peck, scratch, nap → sleep, wander → walk, idle / idle_alt · startled → startled (0.2 s, or 0.5 s with the feather puff when trapped) · flap (0.6 s) → lay_egg (0.8 s; the YOLK drops at 0.6 s) → glide_down → proud_puff (1.2 s) · trapped, ragdoll, getup, dizzy, indignant → emote_angry |
| DUSTY | patrol → walk · bump_turn · beeline → chase · vacuum → suck · bin_full (2 s) → sleep · scan → sniff (1.5 s sweep ±25°) · startled (2 cm hop) → flee (1 s, reverse and spin) · trapped (bumps in place, no turn) · ragdoll → tumble (one rigid body) → getup → dizzy → indignant (emote_angry) → patrol |

**Emotes they show:** BISCUIT `!` (wake), `eyes_mochi` (chase starts), `bark` (each bark), `heart` (tag), `?` (lost / a noise to sniff out), `zzz`, `stars`. HENNY `!!` (fright), `feather` (trapped fright, or a flap with no egg), `egg` (laid; again on proud_puff), `zzz`, `stars`, `angry`. DUSTY `!` (startle, beeline), `sparkle_clean` (vacuum), `bin_full`, `?` (scan), `zzz`, `stars`, `angry`. MOCHI shows `dog_alert` when she flees Biscuit (the emote was already in her table).

**Audio / captions:** `Bark` is the bark (and its `Sound`, part = Biscuit, 70 dB); `Lay` → `yolk.laid` + the egg song; `Splat` → `yolk.splat`; `CritterState` gives every state change (flap squawk, bin-full burp beep, wake "boof", …). DUSTY's suction roar can key off `sucking`, the bin rattle off the bin cells.

**Rendering HENNY's YOLKs (R4 / whoever owns `scene.ts` + `gfx/critters.ts`):** the pool is HENNY's `role: 'piece'` bodies (`bodyInfo`), one per egg in her `eggs` property, parked 30 m under her while dormant (the A3 pool convention, so `main.ts`'s `poolInPlay` test works as is). Draw them with the YOLK mesh (`partDef('yolk')`) while in play. Today `scene.ts` returns early for skinned critter types before its piece path, so once HENNY is skinned her eggs need that path (the blockout draws them from HENNY's `on: 'piece'` visual until then). The splat VFX keys off `Splat`.

**Ragdolls (re-sync needed):** E4b copied `BISCUIT_RAG`, `HENNY_RAG` and `DUSTY_RAG` as data and tests for drift (M4_NOTES_E4b). At the orchestrator's request I moved the leg rows onto E4b's built rigs (bone heads and tails read from `make_biscuit.py` / `make_henny.py`): BISCUIT's front legs forward 3.5 cm (elbow 0.10 m up at z 0.142, paw at z 0.15) and his hind legs onto the rig's knee (0.118 m up at z −0.125, foot at z −0.175); HENNY's thighs up 4 cm (0.13 → 0.09 m, as the rig) with the shin running to her foot. Bone names, parents, masses, swing and twist are unchanged; DUSTY is unchanged. **E4b's `packages/assets/test/critters_m4.test.ts` fails until the rows are re-copied into `ragdoll()` in `make_biscuit.py` (upperarm, forearm, thigh, shin ×2) and `make_henny.py` (thigh, shin ×2) and the two critters are rebuilt.** New rows (engine space; the make scripts use brief space (x, −z, y)):

| Bone | a | b | r |
|---|---|---|---|
| BISCUIT upperarm_l/r | (±0.065, 0.16, 0.14) | (±0.066, 0.10, 0.142) | 0.03 |
| BISCUIT forearm_l/r | (±0.066, 0.10, 0.142) | (±0.066, 0.025, 0.15) | 0.025 |
| BISCUIT thigh_l/r | (±0.065, 0.18, −0.155) | (±0.07, 0.118, −0.125) | 0.035 |
| BISCUIT shin_l/r | (±0.07, 0.118, −0.125) | (±0.07, 0.025, −0.175) | 0.025 |
| HENNY thigh_l/r | (±0.035, 0.13, −0.035) | (±0.04, 0.09, −0.012) | 0.02 |
| HENNY shin_l/r | (±0.04, 0.09, −0.012) | (±0.04, 0.012, −0.022) | 0.012 |

## How it works

### BISCUIT (dog, 12 kg)

- Starts asleep. Wakes on a Sound of 55 dB effective (SIMULATION §5.10) or a 2 N·s touch → `wake` (0.5 s, turning to the noise) → sniffs toward the noise, or chases Mochi if he can perceive her.
- **Chase:** Mochi is a `'mochi'` lure (her spec's `lureAs`), smelled at 10 m (vision is also 10 m). Run 1.7 m/s against her 1.6, accel 3.5. A **bark every 1.5 s** from the first tick of the chase: a `Bark` event and a 70 dB `Sound` at `EMIT__bark__mouth`, which other critters hear (Mochi startles within ~1.8 m, Henny within 10 m, Dusty within 1 m). His own bark never startles him (own-noise rule).
- **Ends in play:** within 0.5 m of her (plus his half-length) he `celebrate`s (heart) and ignores her for 10 s. After 15 s without catching her: lost, ignore 8 s. Losing sight: `sniff` to where she was last (5 s), then lost.
- **Trapped or unreachable Mochi** (in a TRAP BOX, or he's stuck within 1.5 m): `bark` state, barking every 1.5 s for 6 s, then he gives up for 20 s (longer than his settle time).
- **Back to sleep:** 10–18 s (random per wake) of idle / wander / lost.
- **Barge:** new contacts with dynamic bodies ≤ 6 kg (not critters) while he moves (chase, sniff, wander, > 0.3 m/s) get a sideways shove (Δv ≈ 0.9 × his speed sideways + 0.4 forward, capped at 8 m/s), applied after the step in body order. His avoidance rays ignore such bodies, so he goes through, not around. Heavier bodies stop him.
- Tumble → getup → dizzy → **shake_off** (instead of indignant). Ragdoll above 10 N·s.

### HENNY (chicken, 1.6 kg)

- Idle life: peck, scratch, wander, idle, an occasional nap.
- **Startles** on a Sound ≥ 50 dB, a 2 N·s touch, or **an Impact (≥ 0.3 N·s) within 1.5 m** (the Machine calls `critters.impact` for every Impact event; her own bodies and eggs don't count).
- **Flap:** `startled` 0.2 s → `flap`: the engine lifts her 1.0 m over 0.6 s (ease-out height target, velocity set per tick), drifting 0.3 m/s away from the fright → `lay_egg` (hover at the apex; the YOLK drops at 0.6 s) → `glide_down` (descent capped at 1.2 m/s) → `proud_puff` on landing.
- **Eggs:** at most one per 6 s (`CRITTER_M4.henny.eggCooldown`) and `eggs` per run (property 0–6, default 3). A fright inside the cooldown, or with the pool empty, flaps without laying (`feather` emote on landing).
- **Trapped:** a startle plays `startled` + `feather` and never flaps (D14, critters.md).
- **The YOLK pool (D66):** `eggs` dormant bodies built with HENNY (`role: 'piece'`), using A4's YOLK def (`partDef('yolk')`: two-sphere egg, 0.055 kg, friction 0.5, restitution 0.15; LinearCast CCD). They're in her collision group, so a fresh egg never hits her; eggs do hit each other. Laying moves one to `EMIT__egg__vent` with her velocity + 0.2 m/s down and puts it on the moving layer with gravity. **Splat:** any contact of ≥ 0.3 N·s (rollers.md, A4's `YOLK.breakJ`), any blast whose radius reaches it (`blastPieces`), or falling out of the world: `Splat`, then the egg parks again, dormant (never pushed: rule 8). Laid from the floor (apex 1.1 m, J ≈ 0.25) an egg survives and rolls; from a 1.5 m shelf it splats (J 0.39).
- State: `st.crit.egg[slot]` 0 dormant / 1 laid / 2 spent; `afterRestore` re-applies layers and gravity (not in Jolt's saved state).

### DUSTY (robot vacuum, 3.2 kg + bin)

- **Body:** an upright **disc** (`disc`: Jolt cylinder Ø 0.366 × 0.055 at y 0.0355) on a thin support box, rotation locked about X and Z, friction 0 (steering owns its speed). Its ragdoll is `RAG__body`, one rigid cylinder, no joints (`RagBone.shape: 'cylinder'`).
- **Zone** (part props `zone_w`, `zone_d` (0.4–8 m, default 2), `zone_x`, `zone_z` (−4…4 m, default 0), in the part's placed frame, so U4's Inspector › Patrol zone tool edits them; defaults 2 × 2 centred on it): it patrols straight on its heading; a look-ahead point leaving the zone → `bump_turn` back toward the centre; pushed outside, it heads back in.
- **Bumper:** a new contact with a horizontal normal in its front arc and J ≥ 0.05 N·s → `bump_turn` away from the hit (30–150°, random magnitude). Stuck for 1 s also turns it.
- **Grains:** (1) `machine.matter.near(pos, 1.5, mask)` if the Matter host ever offers it (requested, below); (2) stand-in grain patches: bodiless `extraLures` with species `{ dusty: w }` (tests and soaks only, like M2's seeds and shinies); (3) the spot where it last took grains in. In-zone grains → `beeline` (0.35 m/s, slower with a full bin) → `vacuum`.
- **Vacuum (Matter):** MI's per-tick intake: Dusty calls `machine.matter.intake(part, box, 0b101 /* sand + marbles, never water */, capacity)` in stage 6 of every tick. Open, the capacity is the bin's room in grains (at its mean grain mass so far) less what the two Matter commands still in flight asked for (at most 500 per Matter tick), so the grains still arriving when it fills always fit; closed (full, asleep, tumbling, trapped, startled) it's 0. Full = room for fewer than 3 grains. The box is the brief's suction box widened and reaching 7 cm past the bumper lip and 5 cm up (part space [−0.12, 0, 0.08] – [0.12, 0.05, 0.26]): measured on MX's CPU backend, the brief's 12 mm box under the body took 8 of 4,000 grains (the bumper shoves the pile along); the wider box takes 3,994. `absorbed(part)` is read in postContacts on even ticks (each Matter result applies at stage 7 of an even tick and stays readable until the next one). Grains → bin (sand 0.089 g, marble 5.4 g) → mass 3.2 + bin on the base (and the tumble body), set from the body's built mass properties (inverse mass 1/m, inverse inertia × m₀/m), never with Jolt's relative `ScaleToMass` (see the desync below); speed × (1 − 0.4 × fill). While grains keep coming it creeps forward with a weave; 1 s after they stop, back to patrol.
- **Vacuum (stand-in patch):** 3 s over the patch at 0.12 kg/s, then that patch is ignored for 30 s.
- **bin_full** within 3 grains of 1.8 kg (2 s, lid pop) → `sleep` until Stop (a startle wakes it briefly).
- **Idle:** a 25–45 s patrol stint ends in a `scan` and a 6–12 s nap. **Charge leash:** with a power cable on `charge` it sleeps whenever its supply is 0 (unlinked: battery, always on). Its def is a 30 W consumer.
- **Startle** at 70 dB: a 2 cm hop, then reverse and spin away for 1 s.
- **Tumble** (rigid, one body): a hit above 4 N·s (the shared ragdoll trigger), falling faster than 1.5 m/s, or its centre running off an edge (no support within 5 cm under its centre: past that it would tip over 60°). The tumble body carries the bin's mass, gets a flip spin and has damping (linear 0.3, angular 2.0: a 10-minute soak without it had 4 Dusty tumbles rolling on the rim until the 8 s forced recovery); recovery is the shared one (still for 1 s, or 8 s), then getup → dizzy → indignant → patrol.
- Never sucks rigid parts or critters: only Matter grains (the intake's kind mask) or stand-in patches.

### MOCHI: flee(Biscuit)

`thinkMochi` first asks `dogThreat`: an awake Biscuit (not asleep, waking, tumbling, dizzy, trapped) within 2.5 m, or one chasing / barking within her 8 m vision cone. She flees (run, leashed to home), refreshing while the threat lasts, with `dog_alert`. It returns at once in worlds without a dog, so M2 behaviour and hashes are unchanged.

### Machine hooks added (machine.ts, all commented `B4 (M4)`)

| Where | Hook |
|---|---|
| `critterHost()` | `shapeFor`, `sound`, `powerLinked`, `matter: () => self.matter` |
| Contact stage, after each `Impact` event | `critters.impact(pos, J, b.part, other part)` |
| `blast()`, after the per-part loop | `critters.blastPieces(P, R, boom)` |
| `EventKind` | `'Bark' \| 'Lay' \| 'Splat'` |

## Deviations and choices

1. **Dusty's intake box** is bigger than the brief's (above, measured). E4b's `SENSOR__intake__suction` mesh can stay as authored; only the sim box differs.
2. **Dusty's "tipped > 60°"** is detected as an unsupported centre (it can't tip while upright-locked) or a fall; then it tumbles as one rigid body that can tip any way.
3. **Grain spotting with Matter** has no spatial query in contract 2: Dusty finds grains by running into them (and remembers the spot). `near()` is requested below; the code already uses it if present.
4. **Barge** shoves on *new* contacts only (the contact hook sees added contacts), so a body pinned against him is shoved once per touch.
5. **Biscuit's** `idle_alt` is `tail_wag` (additive in the art); `emote_happy` and the `bone` emote aren't selected yet.
6. **Egg breakage** for pooled eggs is B4's (same 0.3 N·s rule as A4's placed YOLKs); a placed YOLK part stays A4's.
7. **M3 forces** (`eachPushable`: ZONE, MAGLOCK, RECYCLER…) skip critter parts, so they don't touch laid eggs either. Matter impulses do reach laid eggs (MI's `pushable`), dormant ones never.

## Requests (not blocking)

- ~~MI: an intake that can close~~: done by MI (per-tick intakes, capacity 0 = closed); Dusty uses it, and a test checks a full bin takes nothing more.
- **MI / MX:** an optional deterministic `near(pos, radius, kindMask)` so Dusty can beeline to grains it hasn't touched. MI says it can't exist on the sim side (the particles live on the backend), so it would need MX to report something like a coarse occupancy grid in `MatterStepOut`. Used automatically if present; without it Dusty finds Matter grains by running into them.

## Found in other streams' code (reported, not fixed)

- **`packages/sim/src/matter/link.ts` (MI) used a TypeScript parameter property**, which Node's strip-only mode rejects (so `pnpm soak:critters` failed with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). MI has since fixed it; the final soaks ran with plain `pnpm soak:critters`.
- **`pnpm -s typecheck` fails in other streams' tests** (last run): `packages/matter/test/matter.test.ts` (MX: imports names `index.ts` no longer exports) and `packages/format/test/matter_header.test.ts` (MI: possibly-undefined `simFlags`). Earlier, `packages/assets/test/m4_parts.test.ts` (E4a) too. Everything else, including the game (`pnpm --filter @knockon/game typecheck`), typechecks clean.
- **M4 Matter tests of other streams fail on and off while they're edited:** last run, `m4_matter.test.ts` WATERWHEEL ("turns it clockwise": −0.002 rad, wants < −0.3) and `matter_sandstorm.test.ts` (the wheel doesn't turn); an earlier run passed all 24 sim / parts-data files. No critters are in those machines, and B4's hooks do nothing without them.

## Desync found and fixed by the soak

The first 10-minute soak of the final cast had **3 desyncs in 135 scenarios** (seeds 48, 76, 135: rollback run C diverging ~3–4 s after its rollback). Cause: DUSTY's bin mass was applied with Jolt's `ScaleToMass`, which scales the current inverse mass and inertia by a ratio. Mass isn't in Jolt's saved state, so `afterRestore` re-applies it, and a chain of relative scalings rounds differently after a restore than in the straight run; the inertia differed in the last bits and the runs drifted apart later. `setMass` now writes inverse mass 1/m and the built inverse inertia × m₀/m, a pure function of the bin. Seeds 48, 76 and 135 then pass, and the rerun soak below has 0 desyncs. Regression test: "the bin's mass is a pure function of its contents" (compares the mass properties bit for bit across a rollback mid-vacuum; it fails with `ScaleToMass`).

## Results (final code, 2026-10-24; CPU and GPU shared with the other streams, so throughput is provisional)

**Tests:** `npx vitest run packages/sim packages/parts-data`: 24 files, **470 / 470 pass** (B4: `critters_m4.test.ts` 27, `critters.test.ts` 24, plus the B4 fuzz scenes and cards). `pnpm -s typecheck` and `pnpm -s lint` clean (last run). Goldens (`critters_m4.test.ts`): biscuit `f1b9be978d6f7c94`, henny `5bbcb9d994170ca1`, dusty `e9406fdf01b69958`. The M2 critter goldens are unchanged.

**Critter soak, `pnpm soak:critters -- --minutes 10 --run 60 --seed 1`: PASS.**

| Measure | Result |
|---|---|
| Duration | 10.03 min, 144 scenarios (all seven critters each), 60 s × 3 runs each (straight, replay, late-poke rollback) |
| Ticks | 3.11 M, 5,167 ticks/s |
| Hash checks | 34,560, **0 desyncs**; 144 / 144 rollbacks matching |
| Ragdolls / getups | 905 / 896 (the 9 still tumbling at scenario ends were all under 9 s); longest 7.99 s; 1 forced recovery (Pip, as in M2) |
| M4 | 2,531 barks, 411 eggs laid, 62 splats, 933 vacuums, 124 full bins, 320 bump turns, 5,444 `dog_alert` flee emotes, 96 trapped-Henny feather startles, 1.79 M stand-in grains taken |
| States | 49 / 50; `scan` (Dusty's quiet-stint nap) never happens on the soak's noisy set; a test covers it |
| Failures | **0** (finite, nothing through the floor or walls, every tumble recovered, no bin over 1.8 kg) |

An earlier 10-minute soak (before the leg rows, the tumble damping and the mass fix) had 126 scenarios, 0 desyncs, 0 failures, 4 forced recoveries (all Dusty tumbles rolling on the rim: hence the damping).

**Matter soak** (`--matter 1 --run 20`, MX's CPU backend, 300–1,500 sand grains plus marbles in Dusty's zone): **PASS but small**: MX's CPU backend is slow (one 20 s scenario × 3 runs took 18 s, the next 703 s on the loaded machine), so the final-code run covered only 2 scenarios in 11.7 min: 14,400 ticks, 160 hash checks, **0 desyncs**, 2 / 2 rollbacks matching, 0 failures, 7 vacuums, 2,921 grains taken. An earlier pre-fix run (seed 1001) also passed (1 scenario, 0 desyncs). Matter + Dusty determinism is mainly covered by the tests (rollback across vacuuming on MX's backend, a full bin closing the intake); a longer Matter soak needs the GPU backend or a faster CPU reference.
