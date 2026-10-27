# Beta notes: SIMFIX · rollback-safe state, checkpoint cost, contact estimate

Stream SIMFIX of the [beta polish plan](BETA_POLISH_PLAN.md). Ports 5321 / 8921 (the soak's host ran on 8921).
Decisions: D118, D119 ([DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md)). No straight-run golden moved.

## 1. The PING relay lost on rollback (fixed)

- **Cause:** `M3Parts.wTick` / `wFired` (`channels/m3.ts`) is PING's guard against a loop of pairs running away: each
  Rx relays at most once per tick. It wasn't in `st`, and nothing reset it on restore. Take a rollback that re-ran the
  tick a PING had fired on. The guard still held that tick's number and Rx set, so the Rx was skipped: no `PingRx`, and
  whatever hung off its `out` never fired. That was also a co-op desync, because the partner (no rollback) did relay.
- **Repro:** `playtests/2026-10-25-autoplay/spec/ping_rollback_repro.ts`.
  - Before: first pass `Ring@240 PingRx@240 Detonate@240`; after `restore(180)`, only `Ring@240`.
  - Now: both passes match.
- **Fix:** `M3Parts.afterRestore` empties the guard (`wTick = −1`, `wFired.clear()`). The guard is scratch for one tick,
  and checkpoints sit between ticks, where it is always empty.
- **Tests** (`packages/sim/test/rollback_rule14.test.ts`, "the SIMFIX fixes"):
  - A poke for tick 230, delivered at tick 400, rolls back to the tick-180 checkpoint, across the PING at tick 240. It
    must relay again (`PingRx@240`, `Detonate@240`) and end on the straight run's hash.
  - Rollback and adoption across a two-Rx relay match the straight run.
  - With the fix removed, both tests fail.

## 2. Rule-14 audit

### Method

1. **What Jolt's `SaveState` holds, checked by experiment** (a FLAP hinge changed after a checkpoint, then restored):
   - **Restored:** positions, velocities, activation, the contact cache, constraint enables, and motor states and
     targets.
   - **Not restored:** object layers, gravity factors, mass and inertia, collision groups, hinge and slider limits,
     friction, and motor settings (torque and force limits, spring).
2. **Every channel and behaviour module read for state outside `st` and Jolt:** Maps, Sets, counters, timers,
   fired / last flags, RNG cursors, and every Jolt setter in the list above.
3. **A test that holds every part to it:** `rollback_rule14.test.ts`. Each of the 87 part fuzz scenes (`fuzz_scenes_*.ts`)
   and each of the 124 Library demos is reached three ways:
   - a straight run;
   - a rollback to tick 60 from 3–5 s further on, so a future that no longer happens has touched Jolt;
   - a fresh machine adopting the straight run's tick-60 checkpoint (desync repair's KNCP path).

   The three must agree on the state hash at the checkpoint and at the end. They must also agree on a fingerprint of
   every unrecorded Jolt setting one tick after the restore: per body the layer, activation, collision group, gravity
   factor, inverse mass and inverse inertia; per constraint the enable, limits, friction, motor state, and motor
   settings while the motor runs. A test-only hook on `PhysicsSystem.AddConstraint` lists the constraints. One tick is
   enough for every behaviour to have had its stage 6, so a setting a module failed to re-derive shows up even before
   it moves a body.

   The whole file (217 tests) runs in ≈ 10 s. With each fix below reverted, its tests fail: hash, fingerprint or both.

### Gaps found and fixed (each with a rollback test)

| # | Where | State | Effect | Fix | Test |
|---|---|---|---|---|---|
| 1 | `m3.ts` / `m3_field.ts` | PING relay guard `wTick` / `wFired` | The relay is lost when a rollback re-runs the PING's tick (co-op desync) | Emptied in `M3Parts.afterRestore` | PING late poke; PING rollback and adoption; the `ping` scene and demo |
| 2 | `devices.ts` FLAP | Hinge friction torque: 0.05 from the first opening and never cleared (history, not state) | A rollback to before the opening keeps the friction; a partner's checkpoint lacks it | Set every stage 6 from `t0 ≥ 0` ("has opened"), the same values as the straight run | FLAP test (rollback to tick 0 from 400, adoption at 180); the `tripwire` scene caught it too |
| 3 | `launch.ts` / `index.ts` BIG TOP | A caught Roller is a gravity-free ghost; `afterRestore` re-applied only current holds | A Roller caught after the checkpoint stays a floating ghost after the rollback | `PartChannels.everHeld` (grows only, like the critters' `everCarried`): `afterRestore` hands back every Roller not held at the restored tick, unless it's out of play or in a critter's hands | BIG TOP test (caught at tick 77, rollback to 60) |
| 4 | `m4.ts` / `m4_matter.ts` SPRINKLE CAN, SPONGE | Mass and inertia from `ScaleToMass` chains; `afterRestore` re-scaled from `q` | Inverse inertia off in the last bits (97.57658 vs 97.57654): **the hash diverged** by tick 300–420. The critter soak found the same thing on DUSTY in M4 | Exact `[1/m, invI.xyz]` per mass body kept in `st.m2.m4.mp` (not hashed), written back with `SetInverseMass` / `SetInverseInertia`. The straight run still uses `ScaleToMass` | SPRINKLE CAN test (3 plans); the `sprinkle_can` scene |
| 5 | `m4_matter.ts` SPRINKLE CAN latch | Motor settings (6 N·m, 4 Hz) set once, at the latch | Harmless on rollback (the latch is one-way), but a fresh machine adopting a latched can drove it at Jolt's defaults (FLT_MAX, 2 Hz): **hash diverged** | `sprinkleRestore` re-applies them for latched cans | SPRINKLE CAN adoption; the `sprinkle_can` scene |

### The audit table

Kinds:
- **saved:** in `st`, so it's checkpointed and in KNCP's ECS chunk.
- **Jolt:** in `SaveState`.
- **build:** fixed after the world is built.
- **tick:** scratch for one tick, emptied before the next tick or at the start of its stage.
- **derived:** re-applied in `afterRestore` from `st`.
- **per-step:** set every stage 6 before the step.
- **output:** for the renderer or audio, never read by the sim.

| Module | Mutable state outside `st` and Jolt | Kind |
|---|---|---|
| `machine.ts` | `pokes` (the input log, kept on purpose so a re-run replays it), `events` (drained each step; `evId` is in `st`), `checkpoints` | input / output / mechanism |
| | `contactsThisStep`, `contactMax` (`contactPeak`), `windNow` | output |
| | `wasActive`, `allDirty`, `joltToBody`, `activeVec` (`changedTransforms`) | output (`allDirty` set on restore) |
| | shape, bcs, box, prop, port and bit caches; `busy` / `powerParts` / `pads`; `zeroG`, `gWorld`, `wind`, `zonesHash` | build / run inputs |
| | `powerComp` | derived (`powerTopology` in `afterRestore`, and every tick with TOGGLEs) |
| | layers and gravity of parts (`applyAlive`); line, mortar and band enables | derived |
| | motor torque limits | per-step |
| `contactbuf.ts` | records, order, call count; belt surfaces | tick (belts rewritten every step from `st.beltSpeed`) |
| `channels/index.ts` | `focus` | tick (cleared at the start of stage 4) |
| | `handleMass`, `handleCause`, `bounced` | tick (cleared in `afterContacts`) |
| | `everHeld` (new) | build-like (grows only), read by `afterRestore` |
| `devices.ts` | FLAP limits and motor; TOGGLE and PUNCHLINE motors | per-step |
| | FLAP friction | per-step (fixed, #2) |
| `launch.ts` | cork layer and gravity | derived (both ways) |
| | held Roller layer and gravity | derived (fixed, #3) |
| `power.ts` | DYNAMO brake (hinge friction) | per-step |
| `light.ts` | `RayCaster` | build |
| | per-pass maps | tick |
| `sound.ts`, `air.ts` | (all in `st.m2`: `snd`, `sndNow`, `puffs`) | saved |
| `gutter.ts` | colliders | build |
| `glidepath.ts` | rails, riders, group filter | build |
| | riders' collision groups | derived |
| `m3.ts` | pools, parks, pieces, sliders, `racks`; `gravity` (read once) | build |
| | `heatRef` | tick (stage 5) |
| | `beams` | output (rewritten each stage 4) |
| | `deckMass`, `pedalMass`, `pedalCause`, `kicked` | tick (cleared in `afterContacts`) |
| | `wTick` / `wFired` | tick (fixed, #1) |
| | pool layers and gravity | derived |
| `m3_motion.ts` | hinge and slider motors by phase; FLINGER limits; SPINDECK friction | per-step |
| `m3_field.ts`, `m3_boom.ts`, `m3_fun.ts`, `m3_future.ts` | none outside `st.m2.m3` (MAGLOCK hold, cook, strike, counters, pool slots) | saved |
| `m4.ts` | vehicles, seats, `massBody` | build |
| | `load`, `loadCause` | tick |
| | masses | derived exactly (fixed, #4) |
| `m4_air.ts` | INFLATOR seat enables | derived (Jolt also saves enables) |
| `m4_matter.ts` | latch motor settings | derived (fixed, #5) |
| | stored quantities and phases | saved |
| `m4_misc.ts` | (all in `st.m2.m4`) | saved |
| `m4_vehicle.ts` | ZIPPY wheels and controller | Jolt (VehicleConstraint state) |
| | driver input | per-step |
| `critters/system.ts` | `crits`, `devs`, `lures`, maps, ray filters | build |
| | `everCarried` | grows only, read by `afterRestore` |
| | `tHit`, `tTouch`, `tPounce`, `dBump` … | tick (cleared at the end of `postContacts`) |
| | RNG cursors | saved (`r0`–`r3` in `st.crit`) |
| | rag layers, joint enables, base layer, carried items | derived |
| | HAMSTER DRIVE / PEDAL RIG motors | per-step |
| `critters/m4.ts` | egg pool, zones; `massRef` (built mass: absolute `setMass`) | build |
| | `tEgg`, `tBarge`, `tBump` | tick |
| | egg layers; DUSTY's mass | derived |
| `envsets.ts` (W5 / PARTSIM) | `zeroGZones`, `globalWind`: pure functions of tick, seed and `st` | stateless |
| `matter/*` | the snapshot ref, early results and proxy ring | own checkpoint (`MatterCp`, restored in `afterRestore`) |
| | `bodyBox` | tick (stage 13) |
| | proxy, static, surface and terrain caches | build / derived from `st` |

### Found in PARTSIM's files (reported, not changed)

The M5 modules (`channels/m5*.ts`, `critters/m5.ts`) pass the same harness: the scenes `rift_gate`, `grav_well`,
`tractor_beam`, `hover_pad`, `force_wall`, `coilgun_ring`, `stasis_field`, `buzz_beacon`, `singularity`, `grabber`,
`buzz`, and their demos. FORCE WALL layers, HOVER PAD lock enables and BUZZ's flight gravity are re-derived. Their state
is in `st.m2.m5` / `st.crit`.

One watch item: `hoverLock` (`m5_misc.ts`), called from `M5Parts.afterRestore`, calls `ActivateBody` on a powered pad's
base. If the pad's base could ever be asleep at a checkpoint tick while powered, a restore would wake it where the
straight run didn't. The fingerprint (it compares activation) shows no difference in the `hover_pad` scene or demo, so
today's pad seems to stay awake while powered. Making the restore path skip the wake would remove the risk.

## 3. The rigid-checkpoint hitch over 20k parts

**Profile** (77k-part unbroken domino wave, `dominoDay(76800, 256, 1.5, 1e9)`, 8 threads, at each 240-tick checkpoint):

| Awake | `SaveState(All)` into a `StateRecorderImpl` | of which bodies / contacts | `structuredClone(st)` | `clonePlain(st)` |
|---|---|---|---|---|
| 6,144 | 24 ms (12.3 MB) | 14 / 5 ms | 21 ms | — |
| 11,700 | 33 ms (14.1 MB) | 14 / 9 ms | 20 ms | — |
| 17,155 | 42 ms (15.8 MB) | 19 / 17 ms | 23 ms | — |
| 22,784 | 46 ms (17.7 MB) | 21 / 19 ms | 25 ms | 4.6–5.0 ms |

- **Copying `st`** (≈ 35 per-part arrays) was half the hitch.
- **The rest is Jolt's `SaveState`:** per-body and per-contact writes into the recorder's `std::stringstream`.
  - Saving twice into fresh recorders costs about the same, so buffer growth is a small part of it.
  - The JoltJS binding has no way to pre-size or reuse that stream: `StateRecorderImpl.Clear` frees it, and `Rewind`
    moves only the read pointer.
  - A `StateRecorderFilterJS` would add a JS callback per body.
  - Leaving out sleeping bodies or contacts would make rollback inexact.
  - So this part stays.
- **Fix:** `Machine.checkpoint` and `applyCheckpoint` copy `st` with `clonePlain` (`machine.ts`):
  - arrays of primitives are sliced, nested arrays and objects copied member by member, typed arrays sliced;
  - it equals `structuredClone` on every scene's state, with no shared containers (test: "checkpoints copy st
    exactly");
  - restores and desync repair benefit too.

**Before → after** (`apps/game/bench/sim-bench.ts domino <s> <count> 256 1.5 0 --threads=8`; the max tick of each
2-second window is its checkpoint tick):

| World | Before (ms) | After (ms) |
|---|---|---|
| 77k parts, 8 s (3k–23k awake) | 40.9 / 63.7 / 72.3 / 85.7 | 26.5 / 46.2 / 58.7 / 72.4 |
| 154k parts, 12 s (6k–34k awake), run 1 | 110.5 / 116.0 / 146.0 / 141.4 / 147.5 / 158.3 | 49.4 / 51.3 / 86.5 / 93.1 / 98.2 / 110.8 |
| 154k parts, 12 s, run 2 | 94.0 / 111.3 / 121.1 / 113.5 / 127.0 / 151.4 | 53.1 / 51.9 / 78.7 / 114.9 / 94.4 / 112.5 |

- The hashes are unchanged: the 77k run's per-second hashes are identical before and after, and the goldens pass.
- Ticks between checkpoints are unchanged.
- The CPU is shared with six other streams, so the timings are provisional (rule 11). T5 measured on 12 threads.

## 4. `contactEstimate` once per start, and faster

- **Once per start:** the sim worker computed it for `joltHeapMB` and the Machine computed it again for its buffers.
  The Machine now takes it in `MachineOptions.contactEstimate`, which must be exactly that value; it computes it when
  absent. The worker computes it once and passes it.
- **Faster** (`capacity.ts`):
  - typed arrays instead of an object and three arrays per part;
  - a per-def cache of collider count and bounds for parts with default props;
  - the 8-corner bounds in inline arithmetic, operation for operation as `vec.ts` `qrot`, so they're bit-identical;
  - instead of 16 Maps of arrays keyed by doubles: a numeric open-addressing table (Fibonacci hashing), with each
    cell's entries grouped by a counting sort;
  - `big.includes` replaced by a flag array.

  Each pair is still counted once, in the same cell, and the total is a sum of small integers, so the order cells are
  visited in can't change it.

| World | Parts | Total (unchanged) | Before | After |
|---|---|---|---|---|
| kiloton | 3,917 | 15,875 | 24 ms | 14 ms |
| dominoDay(20k) | 20,512 | 21,024 | 37 ms | 37 ms |
| awakePile(5k) | 5,000 | 24,622 | 19 ms | 12 ms |
| dominoDay(154k, unbroken) | 153,856 | 154,112 | 146 ms | 143–185 ms |
| bigWorld(200k) | 200,000 | 133,337 | 1,445 ms | 338–492 ms |
| bigWorld(1M) | 1,000,000 | 666,209 | 9,415 ms | 1,637–1,982 ms |

A 1M-part start spent ≈ 18.8 s here (twice 9.4 s) and now spends ≈ 1.8 s. `capacity_big.test.ts` pins the
154k / 200k / 1M totals and checks that a Machine given the estimate equals one that computes it (hash and contact
capacity).

## Checks

- `pnpm -s vitest run packages/sim packages/parts-data apps/game`: 1,090 tests pass.
  - The goldens are unchanged.
  - In the full run, `m4_matter.test.ts` hit a vitest worker RPC timeout (`onTaskUpdate`) under load; its 7 tests pass
    when run alone.
- `pnpm -s typecheck` clean; `pnpm -s lint` (determinism) clean.
- Soak: `KNOCKON_JOLT_THREADS=8 … soak.ts --minutes 3 --run 30 --starter alt --ahead 480 --ahead-b 120 --port 8921`
  passed. 6 runs, 60,834 / 32,851 ticks, 72 pokes, 72 / 72 rollbacks, 0 desyncs, 0 resyncs, 0 errors.

## Files

- **Sim:**
  - `channels/m3.ts`: PING guard reset.
  - `channels/devices.ts`: FLAP friction.
  - `channels/launch.ts`, `channels/index.ts`, `channels/host.ts`: BIG TOP `everHeld`, `HostState.crit`.
  - `channels/m4.ts`, `channels/m4_matter.ts`: exact masses, latch motor.
  - `machine.ts`: `clonePlain`, `MachineOptions.contactEstimate`.
  - `capacity.ts`: the faster estimate.
- **Game:** `apps/game/src/sim.worker.ts`: the estimate once.
- **Tests:** `packages/sim/test/rollback_rule14.test.ts` (new), `packages/sim/test/capacity_big.test.ts`.
- **Docs:** SIMULATION §11 and §12.
