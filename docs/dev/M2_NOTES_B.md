# M2 notes, stream B (critters)

Scope: the critter framework (SIMULATION §7), MOCHI, PIP, GOBY and BANDIT, and the four critter-bound parts: HAMSTER DRIVE, PEDAL RIG, FISHBOWL and TRAP BOX. Also contract 3, the worker and RunController plumbing, and the 30-minute critter soak.

## Files

| File | What it holds |
|---|---|
| `packages/parts-data/src/critters.ts` (new) | Critter part defs (`CRITTER_PARTS`, spread into `PARTS`), `CRITTER_SPECS` (AI numbers, locomotion capsule, ragdoll), `CRITTER_CLIPS`, `CRITTER_EMOTES`, `CRITTER_FSM`, `CritterFlagBits`, `DeviceFlagBits`, `DEVICE_SPECS` (sockets, timers, speeds), Library cards (`CRITTER_CARDS`) and demo machines (`critterDemos`) for all 8 types. |
| `packages/parts-data/src/defs.ts` (shared) | `Family` gains `'critters'` and `PartDef` gains `critter?: CritterSpec`. Adds the defs for `hamster_drive`, `pedal_rig`, `fishbowl` and `trap_box`. |
| `cards.ts`, `demos.ts`, `index.ts` (shared) | One line each, spreading in the critter cards, demos and exports. |
| `packages/sim/src/critters/state.ts` (new) | Plain-data run state (`CritSt`, `DevSt`, `CritWorld`) and its hash. |
| `packages/sim/src/critters/system.ts` (new) | `CritterSystem`: building, perception, FSMs, steering, ragdolls, devices and the hooks. |
| `packages/sim/src/machine.ts` (shared) | Narrow hooks, each commented `critters`. Details below. |
| `apps/game/src/sim.worker.ts`, `apps/game/src/run.ts` (shared) | `critters: Uint8Array` in keyframes and `frame` messages, and `RunController.critters`. |
| `packages/sim/test/critters.test.ts` (new) | 23 tests: contract data, the framework in the Machine, 8 goldens, and Bandit's steal and Pip's seek/eat through extra lures. |
| `apps/host/soak/critters.ts` (new), root script `soak:critters` | The headless critter soak. |

## Contract 3 as built

### `Machine.critterState(out: Uint8Array)`

The output is 4 bytes per part, in part order (`Machine.parts`, which is the same as `RunController.partIds`).

**Critters** write `[clip, flags, emote, fsm]`:

- **clip:** an index into `CRITTER_CLIPS`. The renderer plays `<type>__<clip>`. A species only gets clips listed in its `CRITTER_SPECS[sp].clips`; anything else falls back to `idle`.
- **flags:** `CritterFlagBits`:

  | Bit | Value | Meaning |
  |---|---|---|
  | `ragdoll` | 1 | |
  | `trapped` | 2 | |
  | `asleep` | 4 | |
  | `inDevice` | 8 | Pip in a wheel, Bandit on a rig, Goby in his bowl |

- **emote:** an index into `CRITTER_EMOTES`; 0 is none.
- **fsm:** an index into `CRITTER_FSM`.

**Critter-bound devices** write `[timer, flags, 0, phase]`:

- **timer:** whole seconds left on the run timer, for the 6 LED dots on the HAMSTER DRIVE and the 8 segments on the PEDAL RIG.
- **flags:** `DeviceFlagBits`:

  | Bit | Value | Meaning |
  |---|---|---|
  | `running` | 1 | |
  | `caught` | 2 | TRAP BOX holding a critter: flag up |
  | `lureSeen` | 4 | PEDAL RIG console dot |
  | `occupied` | 8 | |

- **phase:**

  | Device | Phases |
  |---|---|
  | Drive | 0 sleep, 1 startled, 2 sprint, 3 coast |
  | Rig | 0 idle, 1 pedalling |
  | Bowl | 0 intact, 1 broken |
  | Trap | 0 empty, 1 caught |

  The run LEDs are also driven through the existing `pressed` part flag. `VisualDef.when: 'pressed'` draws them in the blockout.

All other parts write zeros.

### `Machine.critterCarry()`

Returns an `Int32Array` of pairs `[critter part index, carried part index]` in part order, one pair per critter that is carrying something (Bandit's loot). It is usually empty.

The worker sends it as `frame.carry` (keyframed like `critters`), and `RunController.carry` holds it. The renderer draws the item at Bandit's animated `prop_r` bone. In the sim the item is a ghost parked at `BANDIT_PROP_R` = (−0.071, 0.369, 0.089) in root space: the `prop_r` pose in `steal_carry`, sampled in Blender from E2's `bandit.blend` (mean over the 48-frame loop, within ±6 mm). The two line up.

### Name tables

These lists are append-only, because the indices are wire values.

- **`CRITTER_CLIPS` (38):**
  - The 17 required clips: idle, idle_alt, walk, run, chase, flee, startled, tumble, getup, dizzy, trapped, celebrate, sleep, sniff, emote_happy, emote_angry, emote_confused.
  - Mochi: pounce, arch_scared, groom, stalk, shove.
  - Pip: wheel_run, wheel_sprint, wheel_exit, stuff_cheeks, burrow_enter, burrow_exit.
  - Goby: swim, flop, bubble_rescue.
  - Bandit: pedal, pedal_mount, pedal_dismount, steal_grab, steal_carry, loot_admire, wash_hands.
- **`CRITTER_EMOTES` (23):** none, !, ?, zzz, stars, heart, angry, sweat, eyes_pip, snack_heart, grumpy, steam, dog_alert, seed, cat_alert, stopwatch, bubbles, water_drop, food_flake, kiss, sparkle, grin, pedal.
- **`CRITTER_FSM` (33):** idle, wander, nap, groom, stalk, chase, pounce, startled, flee, trapped, ragdoll, getup, dizzy, indignant, celebrate, seek, eat, lost, wheel_sleep, wheel_startled, wheel_sprint, wheel_coast, swim, flop, bubble, home, steal_grab, steal_carry, admire, goto_rig, pedal_mount, pedal, pedal_dismount.

### Ragdoll data

Each spec carries `CRITTER_SPECS[sp].ragdoll: RagBone[]`, in root space (engine Y-up, nose toward +Z, floor at y = 0). A `RagBone` has these fields:

| Field | Meaning |
|---|---|
| `bone` | `'RAG__<name>'` |
| `parent` | Bone index; −1 for the root. The root is always index 0 and parents always come first. |
| `a`, `b` | The capsule's joint end (where it hangs on its parent) and its far end. |
| `radius`, `halfHeight` | The Jolt capsule: its cylinder runs from `a` to `b`. |
| `at`, `rot` | The rest transform: capsule centre and quaternion, with local +Y along `a` → `b`. |
| `swing`, `twist` | Degrees, at the joint with the parent. |
| `mass` | |

Bone counts and masses, from the briefs:

| Critter | Bones | Mass |
|---|---|---|
| Mochi | 15 | 4.0 kg |
| Pip | 7 | 0.12 kg |
| Goby | 4 | 0.03 kg |
| Bandit | 14 | 5.5 kg |

E should build the `RAG__` capsules to match and report any mismatch here. I authored the positions from the briefs' proportions, not from a rig, so expect E to ask for tweaks.

### Bodies

- Each critter is one `role: 'base'` locomotion body: the brief's `COL__capsule__0` along Z, plus a low-friction leg block for Mochi and Bandit. It is followed by one `role: 'rag'` body per bone, with `BodyInfo.bone` set, in `ragdoll` order.
- Ragdoll bodies are created dormant on the ghost layer with the world (D66); no body is ever created or destroyed during a run.
- While a critter is ragdolled, its base is a weightless ghost that follows the root capsule, so cameras, picking and the audio position (F) track it.
- While a critter is bound to a device, the base sits at the device socket:

  | Device | Socket | Facing |
  |---|---|---|
  | HAMSTER DRIVE | `socket_pip` | +X |
  | PEDAL RIG | `socket_seat` (saddle top) | +X |
  | FISHBOWL | Goby's swim point inside the bowl | |

- The blockout visual is a capsule built from cylinders and spheres on the base body, until C's skinned path lands. A ragdolled critter's blockout floats upright at its root, so the `RAG__` transforms are what the skinned path should use.

## How it runs (SIMULATION §7)

### Framework

- **Think and act.** Each critter thinks every 4 ticks (`tick % 4 === partId % 4`) and acts every tick.
- **RNG.** Each critter has its own xoshiro128** stream, `stream(worldSeed, 'critter:<partId>')`, kept as 4 words in `st.crit`. It is used only for idle variety, wander goals and flop hops.
- **Seed.** The new `MachineOptions.seed` defaults to the format's default world seed.

### Perception

- **Vision.** A 110° cone with each species' range and static-geometry occlusion rays, at most 4 per think. Pip notices Mochi inside 2.5 m in any direction, or inside 4 m when he can see her.
- **Hearing.** Stream A's `soundsThisTick` is read at the start of stage 6.
  - Effective loudness is dB − 20·log10(max(d, 1)). The loudest sound gets one occlusion ray at think, −12 dB if blocked.
  - A critter's own noise is ignored: any sound from its own part, or from within its body length. Otherwise a startle hop's landing would startle it again, forever.
- **Smell.** `lureOf` tags (stream A) plus critter lures: Pip → Mochi at 8 m, a flopping Goby → Mochi at 10 m (weight 1.5). The target is the best weight / (1 + d).
- **Touch.** A contact with J > 2 N·s from a dynamic body causes `startled`.

### Locomotion

- The base capsule has its rotation locked about X and Z (`mAllowedDOFs`) and no friction.
- **Steering** sets horizontal velocity toward the goal at the species' acceleration, and turns toward travel. It runs only when grounded (|vy| < 0.6). Landing from leaps and hops brakes at 2 × acceleration.
- **Avoidance** uses 3 forward rays (±0.5 rad) at mid-body height, never longer than the distance to the goal.
- **Pounces and startles** are velocity impulses: Mochi's arch is 0.5 m up, her pounce 2.4 + 2.2 m/s.
- **Leash.** Flee, startle and loot-hiding directions bend back toward home past 3 m, and Mochi won't chase prey more than 6 m from her home. Critters live on the set, and the Studio's swept corners don't collide yet (D64).

### Ragdoll

- **Triggers:**
  - A hit above the species threshold. Only the other body's motion toward the critter counts: J = m_red × min(closing, other's approach speed). So walking into things never tumbles a critter.
  - Landings above 4 m/s closing speed: J = m × (v − 4).
  - Any blast that reaches it, with J from SIMULATION §6.1 and the 8 m/s cap (D53). The critter's own wheel, rig or bowl doesn't shield it (exposure is at least 0.5 while bound).
  - A Hand-of-God poke at or above the threshold.
- **Exclusions.** Carried items and TRAP BOX hits never tumble a critter (no squashing).
- **Entering** the ragdoll places the capsules at the rest pose around the base (yaw only), gives each one the base velocity + Δv, enables the joints and puts the capsules on the moving layer.
- **CCD.** Every ragdoll capsule uses LinearCast, so a blasted limb at 8 m/s can't pass a SLOPE's 20 mm nose or the drive's plinth.
- **Thrown out of a device**, the tumble starts at the device's exit point rather than inside it: `socket_pip_exit` for the drive, the rig's approach point for the rig. Starting inside the solid wheel collider, or over the handlebars, pushed small capsules through thin parts.
- **Recovery** happens when the root has moved less than 0.1 m over the last second (mean speed < 0.1 m/s), or after 8 s regardless. A per-tick speed test let Pip's 5 g limbs' contact jitter keep him "tumbling" until the 8 s timeout. A ray down from the root finds the ground, the upright capsule respawns there, the joints are disabled and the capsules go back to sleep on the ghost layer. Then `getup` (1 s) → `dizzy` (2 s, stars) → `indignant` (1 s, the species' huff emote) → normal life. Goby goes back to flopping instead.
- **Events:**
  - `Ragdoll`: mag = J; cause = the blast's Detonate, the hitting part's last event, or the bowl's Break.
  - `Getup`: mag = seconds tumbling; cause = the Ragdoll.
  - `CritterState`: mag = fsm.
  - `Emote`: mag = emote.
  - `Trapped`: other = the box; cause = the box's last event.

### Species

**Mochi.** idle, wander, nap or groom; stalk when the prey is more than 2.2 m away, chase when closer, pounce inside 0.85 m. The pounce ends in celebrate if she touched the target, otherwise lost. She gives up a chase after 10 s (grumpy, then ignores the prey for 8 s).

**Pip.** wander; flee Mochi; seek and eat lures tagged for pip. In a drive, the device runs his FSM: wheel_sleep → bump (≥ 0.05 N·s, 0.5 s cooldown) or a loud Sound → wheel_startled (0.5 s) → wheel_sprint (6 s; the hinge velocity motor runs at 5 rad/s with 40 N·m) → wheel_coast (1 s, motor off) → wheel_sleep. While he sleeps the wheel brakes at 2 N·m, so it never spins. A 2 N·s knock or a blast throws him out (ragdoll).

**Goby.** He swims inside the bowl's swim volume (0.05 m clear of the boundary) and darts when startled. The bowl breaks on a 1.5 N·s hit or any blast. For hits against static geometry, only the bowl's own momentum above 0.5 m/s counts, so setting it down never breaks it. On a break:

1. `Break` and a cosmetic `Splash` event (mag 11.7 L); no Matter water before M4.
2. Goby ragdolls with the burst velocity.
3. He flops for 8 s, as a lure for Mochi. A Mochi pounce that lands on him ends the flop early.
4. bubble (1.2 s): he floats to the broken bowl's spot.
5. home: he waits there, a ghost, until Stop.

Goby placed outside a bowl flops, then goes home to his spawn spot.

**Bandit.**

- **Rig calls.** A shiny lure entering the rig's 1.5 m range (or tied to its `bait` hook), or a Sound of 65 dB or more at the saddle:
  - with Bandit on the saddle: he pedals 8 s, and each new stimulus adds 8 s up to 16 s;
  - otherwise: the nearest free Bandit within 3.5 m runs to `socket_mount`, mounts (0.6 s) and pedals.
- **Pedalling** drives the flywheel motor at 3 rev/s with 25 N·m. A lure that stays in range keeps him going ("carrot on a stick"). When the timer runs out: pedal_dismount (0.6 s) → he stands at the mount point.
- **Stealing.** Off the rig he steals small shiny parts:
  - It applies to dynamic parts of ≤ 0.5 kg with a computed shiny lure (`lureOf`) that are not tied to any uncut line.
  - Sequence: seek → steal_grab (0.7 s) → steal_carry (the item becomes a ghost held at `prop_r`) to a hideout 2.5 m away → drop → admire, then he ignores that item for 30 s.

**TRAP BOX.** A resting, upright cage (speed < 0.2 m/s, up·Y > 0.9) traps any critter whose centre is in the catch volume. The critter turns to the cage's X axis and plays `trapped`, and the flag goes up. It is freed when its centre leaves the volume or the cage tips.

### Machine hooks (all commented `critters` in machine.ts)

| Where | Hook |
|---|---|
| Fields, constructor | `critters: CritterSystem` built from `critterHost()`; `crit: emptyCritWorld()` in `st`; `critters.init()` after `buildStatics()` |
| `buildPart` | `if (def.critter) { critters.buildCritter(idx); return; }` |
| Contact listener | `critters.contact(...)` for added contacts (velocities, normal, inverse masses). It keeps only per-tick maxima, so callback order doesn't matter. |
| Stage 0 | `critters.poke(i, data)` before the generic impulse |
| Stage 6 | `critters.preStep(tick)` at the end of `stageBehaviours`, which hears stream A's `soundsThisTick` first |
| After stage 9 | `critters.postContacts(t)` |
| `detonate` | `critters.blast(k, P, Y, e, r, i)`, called before the `e <= 0` check |
| `applyCheckpoint` | `critters.afterRestore()`: layers, gravity factors and joint enables, which Jolt doesn't record |
| `hash` | `critters.hash(h)`: every CritSt and DevSt field. It is skipped when a machine has no critters or devices, so M1 hashes didn't change. |
| Outputs | `bodyInfo` carries `bone`; `critterState(out)`; `critterCarry()` |
| Options | `MachineOptions.extraLures` (tests and soaks only), passed to the critter host |

## Deviations and choices

1. **Swing-twist constraints between capsule bodies, not Jolt `Ragdoll`.**
   - The bindings expose `Ragdoll`/`RagdollSettings`, but `Ragdoll` adds and removes its bodies from the system and owns its group filter.
   - Dormant bodies switched by object layer, like the M1 PLANK halves, keep the body set fixed for SaveState/RestoreState and rollback. They also let `afterRestore` re-apply state exactly.
   - Each critter has its own `GroupFilterTable`, so its capsules never collide with each other.
2. **One canonical pose (standing) for every locomotion category.** SIMULATION §7.4 allows per-category poses (stand, walk, run, sit). The difference isn't visible at the speeds involved; more poses can be added later as data.
3. **The locomotion capsule has friction 0, not the fur 0.8.** Steering owns its horizontal speed, and friction ate most of each tick's acceleration. The ragdoll capsules carry the briefs' fur friction and restitution.
4. **Ragdoll triggers measure the hit, not the closing speed** (see Ragdoll above). Otherwise Mochi (3 N·s) would tumble walking into a wall at 0.75 m/s.
5. **PEDAL RIG approach point.** It is 0.07 m further out than the brief's `socket_mount` (engine z 0.22), so Bandit's capsule and ragdoll clear the base plate. E should move the rig socket to match, or tell me.
6. **The Trap Box rim lift is not done.** The brief's "lift the rim 2 cm if a critter is under it at landing" isn't implemented: cage hits are excluded from ragdoll triggers instead, so a critter under the rim is pushed aside, not squashed.
7. **Worker seed.** The worker doesn't pass `doc.seed` yet, because `DocStore.confirmed()` has no seed. Machines use the default world seed, which is the same on both clients.
8. **Clip coverage.** `wheel_run`, `wheel_exit`, `shove`, `sniff`, `burrow_*` and `emote_happy` are in the tables but no FSM state selects them yet.
9. **Stealing and eating are exercised through test- and soak-only extra lures.** No M2 part is a small shiny body (A's `lureOf` needs steel, chrome, brass or glass at ≤ 0.5 kg), and seed and snack parts come in later milestones. `MachineOptions.extraLures?: ExtraLure[]` (exported from `@knockon/sim`) adds lures for one run. Play is unchanged: the game never passes them.
   - `{ part, radius, species }` turns a placed part into a lure, replacing its own tag. A small dynamic part with a `bandit` weight counts as shiny, so Bandit steals it.
   - `{ pos, radius, species }` is a bodiless lure at a point (seeds, a snack). It is keyed after the parts, never dies and can't be carried.
   - Lures are a run input like the snapshot, so they're the same on both clients. Everything they cause (target, carried item, ignore timer) lives in `st.crit`. The hash also covers bodiless lure positions, so runs with different lures can't collide. Runs without extra lures hash exactly as before.

## Found in other streams' code (not fixed, not mine)

- **The M1 Machine zeroes the velocity of hidden bodies on restore.**
  - `applyAlive` zeroes velocity for bodies that are "off" (broken or dead) on every restore.
  - Stage 0 pokes and blast impulses still push the hidden base of a broken part (a PLANK's original body), because it is alive and dynamic.
  - So a poke or blast on a broken PLANK, followed by a rollback across it, desyncs. The soak caught the same thing on a broken FISHBOWL; the critter system now swallows pokes and blasts on a broken bowl.
  - The general fix belongs in the Machine: skip pokes and impulses on "off" bodies, or don't zero velocities in `applyAlive` during restore.
- **`packages/sim/src/channels/light.ts` uses a TypeScript parameter property** (`constructor(private readonly h: Host)`). Node's strip-only TypeScript mode rejects it, so `node apps/host/soak/*.ts` (and `pnpm soak`) fail while it's there. I ran the critter soak from an esbuild bundle (D73); `pnpm soak:critters` works directly once that line is a plain field.
- **Each `Machine` leaves about 30 KB in the WASM heap after `destroy()`.** The sources are mostly M1's per-body `new RVec3/Quat` and the shape settings and results that are never destroyed; the critter system's own per-body allocations now reuse scratch objects. One machine per run doesn't matter, but the soak's thousands of machines ran Jolt out of memory after about 2,300. The soak now loads a fresh Jolt instance every 150 machines.

## Soak and tests

**Follow-up 10-minute run (`pnpm soak:critters -- --minutes 10`, with extra lures):** see "Extra-lure soak" below.

**Result (final code, 2026-10-24): PASS.** The command was `--minutes 30 --run 60 --seed 2000`, run from an esbuild bundle of the same file; see the light.ts note above for why.

| Measure | Result |
|---|---|
| Duration | 30.0 min |
| Scenarios | 773, each 60 s × 3 runs |
| Ticks | 16.7 M, about 9,300 ticks/s |
| Hash checks | 185,520, **0 desyncs** |
| Rollbacks | 773, all reproducing the straight run |
| Ragdolls / getups | 3,880 / 3,833. The 47 still tumbling at a scenario's end were all younger than 9 s. |
| Longest tumble | 7.99 s. 12 Pip ragdolls (0.3 %) hit the 8 s forced recovery: rolling slowly, never quite settled. |
| Other events | 109 traps, 345 bowl breaks, 698 flops, 1,795 wheel sprints, 1,567 pedal runs, 5,047 pounces, 13,906 startles |
| States | 28 of 33 FSM states visited. The 5 not visited are the stealing states, which no M2 part can trigger, plus `seek` and `eat`, which have no lure-tagged parts. |
| Failures | 0: no non-finite position, nothing through the floor or walls, no critter left tumbling |

Tests: `packages/sim/test/critters.test.ts` has 19 tests, all passing; the sim and parts-data suites pass 161/161.

`pnpm soak:critters -- --minutes 30 [--run 60] [--seed 1]` runs the scenarios in the Room preset:

- **Cast and set.** Each scenario has all four critters plus a free Pip, Pip in a banded HAMSTER DRIVE, Goby in a FISHBOWL, Bandit on or near a banded PEDAL RIG, and a TRAP BOX on a SNIPPER line. Half the time Mochi starts under the cage.
- **Hazards.** Three timed BANGSTICKs on wick-lit fuses, loose THUDs and BOINGs, TOPPLE TILES, a SLOPE, and 4–11 Hand-of-God pokes. Pokes on loose parts are capped at 6 m/s.
- **Runs.** Every machine runs three times: A straight, B straight (identical hash sequence required), and C with its middle poke delivered 90 ticks late. Run C rolls back and its hashes must match A's.
- **Checks on run A:**
  - every body finite, nothing below the floor or off the 400 m floor;
  - no critter body passing through static geometry. Every tick, a Jolt ray against the static layer runs between a simulated critter body's centres of mass on consecutive ticks, both ways. A centre that goes in one side and out the other is a pass-through; being pushed back out after penetrating is not. Ghost bases (bound, ragdolled, rescued) are skipped. Critters may leave the set through the open front or the Studio's non-colliding corners (D64): that is not tunnelling.
  - every Ragdoll answered by a Getup within 9 s, with no second Ragdoll before it;
  - no critter still tumbling at the end.
