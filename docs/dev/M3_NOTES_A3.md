# M3 notes: stream A3 (sim parts)

Last updated 2026-10-24. Scope: the 30 M3 catalogue rows of GAME_SPEC §12 (35 part types plus the GLIDEPATH link), each with a def, behaviour, card, demo, per-part golden and fuzz entry (PART_SYSTEM §7–8). Plan and rules: [M3_PLAN.md](M3_PLAN.md).

## Where things live

| What | Where |
|---|---|
| Part definitions | `packages/parts-data/src/defs_m3.ts`, spread into `PARTS` by `defs.ts`. It only type-imports `defs.ts`, like `defs_m2.ts`. It also holds the geometry constants the sim reads (`LANCE`, `TRIPWIRE`, `OPTICS`, `MAGLOCK`, `KEG`, `JITTER`, `FLAMER`, `POPPER`, `BUMPER`, `RAM`, `FLINGER`, `SNAPTRAP`, `BOOSTER`, `GLIDEPATH`, `RECYCLER`, `FABRICATOR`, `SPAWNABLE`, `TONEBAR_L`, `ZONE_MODES`, `SKYSHOW`, `SKYSHOW_PATTERNS`, `M3_TYPES`), `CARDS_M3` and `m3Demos()`. `index.ts` re-exports all of it. |
| Cards, demos | `CARDS_M3` is spread into `CARDS` (`cards.ts`); `m3Demos(() => new Demo())` is merged into `DEMOS` (`demos.ts`). |
| Fracture | `index.ts` `FRAC` registers E3a's generated `frac_pane.ts` (24 chunks) and `frac_vase.ts` (16 chunks). PANE and VASE break through the M2 path (`fracOf` + `Machine.shatter`). |
| Channels | `packages/sim/src/channels/`: `m3.ts` (pieces, pools, sliders, `eachPushable`, hash), `m3_motion.ts`, `m3_boom.ts`, `m3_field.ts`, `m3_fun.ts`, `m3_future.ts`, `glidepath.ts`, and `light.ts` (now with LANCE, MIRROR, SPLITTER and TRIPWIRE). `index.ts` dispatches to them from the existing hooks. |
| State | `st.m2.m3` (`M3State` in `channels/host.ts`): pool slots (`live`, `born`, `y0`, `why`), per-part `n`, `heatAt`, `cook`, `hold`, rider slots (`ride`, `rideS`, `rideT`, `rideCd`) and PINS racks (`strike`). M3 parts also use the per-part `st.m2` arrays (`on`, `phase`, `t0`, `val`, `val2`, `cause`). Everything is plain data, so checkpoints and rollback cover it. |
| Tests | `packages/sim/test/goldens_m3.test.ts` (35 goldens), `m3.test.ts` (17 tests), `fuzz_scenes_m3.ts` (wired into `fuzz.test.ts`) |

## Machine hooks (`machine.ts`, all small)

- `EventKind`: the M3 kinds below.
- `buildLinks`: `case 'glidepath': this.x.buildGlidepath(l)`.
- `step()`: `this.x.stageSpawn(t)` after `stageExplosions`. This is stage 12: FABRICATOR spawns, RECYCLER intake and SKYSHOW shell bursts.
- `stagePower` and `partMeters`: consumer demand is `this.x.demand(i, pw.consumer)`. M1 and M2 parts return their rating unchanged; LIFT draws only while moving, and FLAMER only in Powered mode.
- `detonate()` is split: `detonate(i)` calls the new public `blast(P, Y, i, t, cause, kill)`, which does everything the old body did. SKYSHOW shells call `blast` without killing their cake. Inside the blast loop, `this.x.blastHit(k, boom)` lets glass inside R shatter. The refactor leaves every M1/M2 hash bit-identical.
- `lightBeams(): Float32Array`, a read-only output (see "For the renderer").

`channels/host.ts` `Host` now also reaches `signalOut`, `receive`, `queueBoom`, `blast`, `kill`, `cutLine`, `shatter` and `hiddenBody`, plus `armedAt`, `litCause` and `broken` in its state slice. A rename in `machine.ts` must be mirrored there.

## The parts

| Type | What the sim does |
|---|---|
| `glint`, `bearing` | Ø16 mm marbles: glass 5.4 g and steel 16.7 g (magnetic). Real Bandit lures: `lure: {bandit: 1.5 / 1.2}`, 5 m. |
| `glidepath` (link) | A static twin-rail collider swept along the path. A marble that reaches either end, and isn't moving away, joins the rail (`RailOn`), rides it through bends and loops, and leaves past the far end, or the near end if it rolls back (`RailOff`). |
| `glidepath_booster` | Spun on `drive` (axle), it sets riders in its 0.30 m sensor to tyre speed: \|ω\| × 10 (internal gearing) × 0.015 m. The sign of ω picks the direction. Emits `Boost`. |
| `spindeck` | A 1.2 kg platter on a free vertical hinge, turned 1:1 by a BAND. `brake` sets 50 N·m of hinge friction. |
| `lift` | Its deck is the part's kinematic `arm`. A signal on `call` sends it to the other end at `speed` × supply. It draws 150 W only while moving, pulses `arrive` and emits `Arrive` (mag 1 top, 0 bottom). Over 15 kg on the deck, or without power, it stalls (`fault`); a load stall also emits `Jam`. |
| `rack` | The pinion is the hinge `arm` (ghost; a BAND drives it). The bar is a `piece` on a slider (±(L−0.1)/2), coupled by a velocity-only `RackAndPinionConstraint` (40 rad/m), as gears are (D61). |
| `ram` | A rod/head `arm` on a slider. A signal on `fire` extends 0.25 m in 0.08 s (400 N × supply), holds 0.3 s and retracts in 0.4 s. Unpowered, it gives a 0.5 s fault blink. Emits `Extend` and `Retract`. |
| `lance` | Powered (30 W): one ray of intensity 1 along +X. Through a BURNING GLASS its converged segment becomes a line of heat (r 0.015 m every 3 cm, up to 1 m): a cutting beam that burns LINEs, lights fuses and pops HELIOs. |
| `mirror` | A ray on the chrome front face (+Z, above the foot) reflects about the face normal; the back is opaque. |
| `splitter` | A ray into the cube splits into 3: straight, and ±12° about the part's up axis, each at 1/3 intensity. |
| `tripwire` | Light ≥ 0.1 on its −X eye, held 2 ticks, flips its state (`Lit` / `Unlit`). Break mode fires on lit → dark, Lit mode on dark → lit: a `Trip` event plus a pulse on `out`. LAMPs light it as well. |
| `ping` | `pair` (6 colours) and `mode` (Tx/Rx). A Tx's `in` reaches every Rx of its pair in the same tick: each Rx relays through its `out` cables at once (`PingRx`). Each Rx relays once per tick, which stops loops. |
| `maglock` | Dynamic (it can hang from a LINE by `eye`). Powered (150 W), it pulls steel (magnetic or steel material) within 0.6 m of its front face: F = k·f / max(gap, 0.05)², k 0.245, at most 40 m/s². It feels the reaction. At f ≥ 0.75, steel touching the face is held (`Attach` / `Release`). |
| `powder_keg` | Yield 3. It goes off in any of four ways: its stub burns down (a FUSE on `fuse` or a flame at the stub tip lights it, then `fuse` seconds on the Machine's bangstick countdown); `detonator` fires it at once; a nearby blast sets it off sympathetically; or it cooks off after 1.5 s of continuous heat within 0.05 m of its surface (a heatless tick resets the count, and `Cook` marks the start). |
| `jitterjuice` | Yield 1.5. One contact ≥ 0.15 N·s detonates it; 0.08–0.15 N·s gives a `Jostle`. Heat doesn't light it; blasts set it off sympathetically. |
| `skyshow` | Heat at `fuse` or the stub lights the quick-match. Tube k (1…6) fires 0.6·k s later: a pooled shell flies along its splayed tube axis (`Launch`) and bursts at the top of its climb, or `altitude` above the tube, or after 4 s, as a yield-0.2 blast (`Detonate`, then `Burst` with mag = pattern). |
| `flamer` | A 0.6 m heat cone (spheres r = 0.1·s). Gas mode: a signal on `on` toggles the valve. Powered mode: on while f ≥ 0.5, drawing 80 W. It ignites over 0.15 s. Wind over 4 m/s at the nozzle (a GALE, PUFFER or Wind ZONE) puts it out until it's switched off and on again. |
| `popper` | A tug on `string` of ≥ 4 N (or 2.5× its own weight; see Deviations) pops it: `Confetti`, an 82 dB Sound, a hop, and a 0.15 s puff along +Y (1.0 m / 15°) of I = 60·A·(1 − d/R)², capped at Δv 4 m/s. No blast, no heat. |
| `snaptrap` | Dynamic board. A pedal hit ≥ 0.03 N·s, or 0.03 kg resting on it, snaps the bar over (70 rad/s) to 172° (`Snap`). |
| `bonker` | A signal swings the mallet to 95° at 16 rad/s (`Trigger`), holds 0.2 s, then returns (`Retract`). |
| `flinger` | The stop bar is the hinge's upper limit, set from `angle` every tick. A signal on `release`, or ≥ 4 N on the `trigger` LINE, whips the arm with a velocity motor ramped to 25 rad/s over 0.12 s, so the payload rides the whole swing (`Trigger`, then `Fire` at the stop). |
| `wrecker` | A 20 kg steel ball with a `hook`. |
| `pinger` | A signal cocks the striker back 0.06 m over 0.18 s (`Trigger`), then fires it at 4 m/s (`Fire`), then settles. |
| `paddle` | A signal flips the bat from −15° to +30° at 20 rad/s (`Trigger`). It holds until 0.3 s after the last signal, then returns (`Retract`). |
| `bumper` | A hit ≥ 0.05 N·s sends the body straight out from the centre at clamp(1.2 × arrival speed, 1.5, 8) m/s (`Trigger`, mag = speed, other = the body). A `kick` signal kicks whatever touches it at 2.5 m/s. |
| `pin` | A pin. Pins within 0.2 m of each other at the start form a rack. When every pin of a rack is more than 45° from upright, the rack emits `PinsAllDown` (on its first pin, mag = pin count). |
| `stacker` | A plain rigid block. |
| `pane`, `vase` | A hit ≥ 0.8 N·s (pane) or ≥ 0.6 N·s (vase), or any blast reaching them, shatters them into E3a's chunks (`Break` plus an 85 dB Sound). |
| `tonebars` | A hit on the bar (≥ 0.02 N·s, 0.06 s cooldown) gives a `Note` (mag = scale degree + volume) plus a 55 dB Sound. `degree` runs 0–14 (bar length per fun.md); `wood` sets the skin. |
| `ding` | A hit on the plunger (≥ 0.04 N·s) or the dome (≥ 0.10) gives a `Note` plus a 77 dB Sound, which startles every critter within 4 m. Its brass dome makes it shiny bait for Bandit. |
| `fabricator` | `part` (11 spawnable types), `count` 1–20, `interval` (0 = signal only) and `speed`. Each spawn takes the first dormant pool slot and puts it in play at the mouth, or in front of the face for parts wider than 0.10 m, moving +Z (`Spawn`, mag = the spawned part's mass). A body in the way jams it (`Jam`, `fault`); an empty pool drops the queue. |
| `recycler` | Any body whose centre enters the intake box leaves play (`Despawn`, mag = count, other = the part). FABRICATOR parts go back to their pool; other parts are killed and their ropes released. Critters are refused and popped back out. At `target` (`mode`: once, or every target) it pulses `count` and emits `Goal`. |
| `zone` | `mode`: Gravity (s × gravity), Antigrav (net s·g upward), Wind (1.225·air·A·s² along +X; it douses flames when s > 4) or Stasis (velocity zeroed and gravity cancelled every tick). Size is `width`, `height` and `depth`. Critters are exempt. |

## Contract 6: events (for F3, G3 and U3)

New kinds (`EventKind`). Consumers ignore kinds they don't know.

| Kind | Part / other / mag |
|---|---|
| `Trip` | TRIPWIRE fired. mag 0 for Break mode, 1 for Lit mode. Its cause is the `Lit` / `Unlit` edge. |
| `PingRx` | A wireless hop arrived. part = the Rx, other = the Tx, mag = pair index. The Tx itself gets the usual `Signal` on its `in`. |
| `Attach` / `Release` | MAGLOCK holds / lets go of steel. other = the steel part, mag 1 / 0. |
| `RailOn` / `RailOff` | A marble joins / leaves a GLIDEPATH. part = the marble, mag = rail index (link order among GLIDEPATHs). |
| `Boost` | Booster kick. part = booster, other = the marble, mag = tyre speed (m/s). Once per pass. |
| `Confetti` | POPPER popped. mag 1. |
| `Trigger` | A mechanism starts: BONKER swing, PADDLE flip, PINGER cocking, FLINGER release, and BUMPER kicks (mag = kick speed, other = the kicked part). |
| `Fire` | PINGER strike (mag 4) or FLINGER at its stop (mag = cup speed). |
| `Snap` | SNAPTRAP sprung. other = whatever touched the pedal (−1 for weight). |
| `Extend` / `Retract` | RAM out / back. BONKER and PADDLE also use `Retract` on the way back. |
| `Burst` | A SKYSHOW shell burst, right after its `Detonate` (Y 0.2 at the shell, part = the cake). mag = pattern index (`SKYSHOW_PATTERNS`). |
| `PinsAllDown` | A PINS rack is all down. part = its first pin, mag = pin count. |
| `Goal` | RECYCLER reached its goal. mag = count. Cause = the `Despawn`. |
| `Cook` | POWDER KEG starts cooking (continuous heat begins). |
| `Jostle` | JITTERJUICE near miss. mag = J. |
| `Arrive` | LIFT reached an end. mag 1 top, 0 bottom. |

M3 parts also emit existing kinds: `Launch` (SKYSHOW tube, mag = shell speed), `Spawn` (FABRICATOR: part = the fabricator, mag = the spawned part's mass; there is no `other`, because pool bodies aren't parts), `Despawn` (RECYCLER: part = recycler, other = the despawned part, or the FABRICATOR whose piece it was), `Note` (TONEBARS, DING), `Sound` (DING 77 dB, TONEBARS 55, POPPER 82, glass breaking 85), `Lit` / `Unlit` (LANCE, TRIPWIRE), `Ignite` / `Extinguish` (FLAMER, POWDER KEG stub, SKYSHOW), `Detonate`, `Break`, `Jam` and `Signal`.

**`Note.mag` = scale degree (integer part, 0–14) + volume (fraction, 0–0.99).** It is always under 24, so the audio side reads it as a world-key degree. The sim has no world key: it stays audio's setting (AUDIO.md: default C major).

**Audio adaptation (F3, done before this hand-back).** The names `Trigger`, `Fire`, `Snap`, `Extend`, `Retract`, `Burst`, `PinsAllDown` and `PingRx`, and `Release` for MAGLOCK, follow `apps/game/src/audio/m3.ts`. The LIFT deck moves as its `arm`, and the RAM rod as its `arm`. RACK's `arm` is its pinion, whose spin × 0.025 m is the bar speed; the bar itself is a `piece`.

## For the renderer and UI (G3, L3, U3, C)

- **Flags (`PartFlagBits`).**
  - LANCE: `lit` while its beam is on; **`armed` while it is a cutting beam**.
  - POWDER KEG: **`pressed` while cooking**; `lit` / `armed` while its stub burns (the Machine sets these).
  - TRIPWIRE: `lit` while its eye is lit; `pressed` for 0.2 s after a trip.
  - PING, BUMPER, DING, TONEBARS, JITTERJUICE (jostle), POPPER (popped) and RECYCLER (swallow): `pressed` flashes.
  - MAGLOCK: `lit` while it holds steel.
  - BONKER, PINGER, FLINGER: `lit` while ready, `pressed` while out. RAM and PADDLE: `pressed` while out. SNAPTRAP: `pressed` once sprung.
  - LIFT: `lit` while moving, `fault` while stalled. RAM: `fault` during its unpowered blink.
  - FABRICATOR: `powered` while parts remain, `fault` when jammed. Booster: `powered` while spinning.
  - SKYSHOW: `lit` while the quick-match burns, `armed` in that phase. FLAMER: `lit` while burning, `armed` while igniting.
- **Meters (`partMeters`).**
  - TONEBARS and DING: scale degree + 1.
  - FABRICATOR: parts left + 1. RECYCLER: count + 1 (both capped at 31).
  - Wind ZONE: a strength bar, 1 + round(20·s/15). Other zone modes read 0.
- **`Machine.lightBeams()`**: the beam segments traced in the last stage 4, 8 floats each: [x0, y0, z0, x1, y1, z1, intensity, kind]. kind 0 = TORCH ray, 1 = LANCE ray, 2 = LANCE cutting beam. It never feeds back.
- **Pool bodies** (FABRICATOR parts, SKYSHOW shells) are role `'piece'` with `chunk` = slot index. While dormant they wait parked 30 m under their part (ghost, no gravity, asleep). They draw the def's `on: 'piece'` visuals. FABRICATOR's visuals carry the chosen part's visuals as `on: 'piece'`, so in Build mode they overlap the cube.
- **Other bodies.** LIFT's deck is its kinematic `arm`. RAM and PINGER move an `arm` on a slider; RACK has a pinion `arm` and a bar `piece`.
- **GLIDEPATH rails** are static (no part). The renderer sweeps E3a's `glidepath.profile.json` along the link path, rounded at 0.10 m radius (`roundPath(points, 0.1, 12)`). The booster (`glidepath_booster`) is its own part type; there is no E3a build for it yet.
- **Unbuilt chunk art.** A PANE or VASE chunk without built frac art falls back to the M2 "half" drawing in `scene.ts`; E3a's builds exist.
- **New `Family`.** `'future'` (FABRICATOR, RECYCLER, ZONE) is new, and `ship` can be `'M3'`. `catalog.ts` `FAMILY_ORDER` doesn't list `future` yet.
- **ZONE** has no colliders, and its stakes are visuals. The volume outline and glyphs are U3's, drawn from its props.

## Lures

- GLINT `{bandit: 1.5}` and BEARING `{bandit: 1.2}` are tagged lures (5 m), real bait for the M2 steal behaviour. `m3.test.ts` checks that Bandit seeks, grabs and carries a GLINT with no `extraLures`.
- Through `lureOf`, DING (brass, 0.45 kg) and JITTERJUICE (glass, 0.4 kg) are computed shiny lures as well. Bandit may carry off the nitro flask.

## Determinism

- **Pre-built, dormant, never pushed.** Every body a part may put in play is built with the world: FABRICATOR pool, SKYSHOW shells, LIFT deck, RACK bar, RAM and PINGER arms. Nothing is created mid-run. `eachPushable` is the only way M3 forces (MAGLOCK, ZONE, POPPER, BUMPER kick, RECYCLER intake, FABRICATOR jam check) find bodies, and it never yields a dormant slot, a hidden body (`Machine.hiddenBody`), a ghost, a kinematic body, a critter or a BIG TOP's held Roller. `m3.test.ts` checks that a blast beside a FABRICATOR leaves its pool exactly where it was parked.
- **Re-applied after a restore.** Pool object layers and gravity, and the riders' collision groups, aren't in Jolt's saved state, so `afterRestore` re-applies them from `st`. A rollback mid-run across spawns, shells, a rider, a held pig iron and a moving lift rejoins the straight run bit-for-bit, and so does a late poke (`m3.test.ts`).
- **Order and maths.** Part order everywhere; detmath only; `pnpm lint` is clean.
- **The M3 hash block** (`m3.hash`) is added only when the machine has an M3 part or a GLIDEPATH. **Every M1 and M2 golden is bit-identical**, with no re-pins.

## Deviations from the specs

- **Marble friction.** GLINT and BEARING have friction 0.02, not 0.30 / 0.25. A Ø16 mm Jolt sphere gets no rolling torque from its contacts (it slides like a puck; spheres of Ø24 mm and up roll), and with the brief's friction a marble sat still on a 20° slope. With low friction they glide down at about the rolling rate, and their spin is set to no-slip from each contact (persisted contacts), so they look as if they roll; the spin doesn't move them. (Jolt also caps spin at 47 rad/s.)
- **GLIDEPATH follower.** Riders follow the rail with our own follower, not a Jolt `PathConstraint`. The JS bindings can't construct `PathConstraintPathHermite`, and a JS path would be called from Jolt's solver threads. Each tick the follower:
  - turns the rider's velocity onto the path tangent, keeping its along-path speed;
  - adds a pull back onto the line (30/s, ≤ 0.5 m/s);
  - cancels the step's gravity across the path.

  While riding, a marble is in a collision group that ignores rails: speculative contacts with the rail segments' ends braked fast riders by about half. Riders' centres sit 6 mm over the rail tops, where a loose marble rests. Riders join only at the ends; a marble dropped mid-track rolls on the rail collider.
- **Booster.** The booster is a part type, `glidepath_booster`: links have no ports, and the brief gives the booster a spin port. Its origin is mid-length, not at the joint face. It drives at 10× the input ω, because 1:1 gives a MOTOR's 0.14 m/s.
- **RAM** is fixed at D = 0.5 m. Ports are static in the def schema, so a resizable RAM needs per-prop ports (as FLAP did in M2). The signal port is `fire` (the brief named both ports `in`); E3a's build uses `fire` too.
- **POPPER** pops at 4 N, or at 2.5× its own weight (2.9 N), whichever is lower. A 0.12 kg popper is dragged before a string can pull 4 N on it; a HELIO's tug gives 3.4 N. The demo popper is anchored (flags bit 32), so `Demo.add` gained an optional `flags` argument.
- **FLINGER.** Its cup rims collide 0.05 m tall (the brief's cup is 0.035 deep), so a STITCH stays in through the swing. Its fire is ramped (see the parts table), because a motor at full speed in one tick launched the payload at the swing's start.
- **MAGLOCK.** The hold snaps the steel to the magnet's motion and loads the magnet with its weight, instead of a constraint (nothing is created mid-run). Pull acceleration is capped at 40 m/s², so a 17 g bearing isn't fired across the room.
- **ZONE.** Gravity and Antigrav are extra forces, not gravity factors, and Stasis zeroes velocity and cancels gravity rather than switching bodies to kinematic: neither gravity factors nor motion types are in Jolt's saved state. Critters are exempt.
- **SPINDECK and LIFT.** The SPINDECK brake is hinge friction. The LIFT deck is kinematic (MoveKinematic every tick).
- **FABRICATOR.** `count` is at most 20, not 999: the pool is pre-built. Spawnable parts are plain single-body dynamic parts (`SPAWNABLE`).
- **PINS.** A rack is "pins within 0.2 m of each other at the start". The sim has no rack record, so `PinsAllDown` doesn't depend on `PartRecord.group`.
- **TONEBARS and DING** emit scale degrees, not pitches.
- **POWDER KEG and JITTERJUICE** detonations kill the part, as BANGSTICK's do. E3a's `frac_powder_keg.ts` and `frac_jitterjuice.ts` aren't registered in `FRAC`: that would add 16 or 15 dormant bodies per explosive (60 kegs in Kiloton). Flying staves are G3's GPU debris.
- **Collision blockouts.** Collision is still a blockout of boxes, spheres, cylinders and capsules (the brief hulls are approximated) until each part's `.shapes.json` is read. The bounds of POWDER KEG (y to 0.17), SKYSHOW (z −0.16…0.17) and POPPER (z to 0.07) were widened to contain E3a's builds (stub tips, pull tab).

## Shared-file edits (beyond the Machine hooks)

- **`parts-data/defs.ts`:** `ship` adds `'M3'`, `Family` adds `'future'`, it spreads `PARTS_M3`, and it calls `bindPartLookup`.
- **`parts-data/cards.ts`, `parts-data/demos.ts`:** the M3 blocks. `Demo.add` takes an optional `flags` argument.
- **`parts-data/index.ts`:** re-exports `defs_m3.ts`; FRAC adds `pane` and `vase` from E3a's files; it exports `PANE_FRAC` and `VASE_FRAC`.
- **`sim/test/goldens.test.ts`:** `glidepath` joins `LINK_CARDS` and the path-link exception.
- **`sim/test/fuzz.test.ts`:** it spreads `M3_SCENES`, and the no-property loop covers M2 and M3.

## Tests

- `pnpm vitest run packages/sim packages/parts-data`: **257 passed** (13 files). Before this stream it was 170. The new tests:
  - 35 M3 goldens;
  - 17 M3 unit tests;
  - 35 fuzz entries: 13 property fuzzes (20 sets × 2 seeds) and 22 scene runs.
- `pnpm typecheck` and `pnpm lint` are clean.
- **Re-pins: none.** Every M1 and M2 golden hash is unchanged, and the M3 golden hashes are new pins. The PANE and VASE goldens depend on E3a's frac data: if E3a regenerates `frac_pane.ts` or `frac_vase.ts`, re-pin those two (their behaviour checks stand).
- The whole-repo `vitest run` is green except `packages/assets/test/parts.test.ts` while E3a is mid-rebuild: its port and triangle checks flapped as builds landed. E3a's build scripts match these defs (RAM `fire`; `max_links 8` on LIFT `arrive` and RECYCLER `count`).

## Rollback on big brick stacks (S3's M3 finding 1): cause and fix

- **Symptom:** S3's repro (`apps/game/bench/repro-rollback.ts`): 2,100 BRIKs and a BRIK shoved in at tick 70. A late-poke rollback diverged from the straight run at tick 81, the tick the shoved brick hits the stack.
- **Cause:** Jolt's contact-constraint buffer (`mMaxContactConstraints`) overflowed.
  - The S3 budget was 4 per part (8,404 here). A face-to-face BRIK grid needs about 17–21k: every brick is within Jolt's 2 cm speculative distance of up to 26 neighbours.
  - Past the buffer, Jolt silently drops contacts. Which ones it drops depends on the order it finds body pairs, and that order depends on state `SaveState` doesn't record (broadphase layout, active-body order, cache layout). So the restored run drops different contacts.
- **Tested and ruled out:** rebuilding the broadphase (`OptimizeBroadPhase`) at checkpoints, and re-activating bodies in a fixed order after restore. Neither helps.
- **Measured on the repro:** the bug goes away exactly when the buffer covers the demand:
  - at 8 per part (16.8k) it still diverges;
  - at 10 per part (21k) and above it matches;
  - raising the body-pair budget alone doesn't help.
- **Fix:**
  - `packages/sim/src/capacity.ts` `contactEstimate(parts)` estimates the start-state demand. It counts pairs of parts whose bounds, grown by the 2 cm speculative distance, overlap (at least one dynamic), each weighted by up to 4 collider pairs, plus one ground contact per dynamic part. It takes about 10 ms for 2,000 parts, and estimates 20.3k for the repro.
  - `joltCapacity(parts, bodies, contacts)` sizes the contact and body-pair buffers to at least 1.5× that, up to `CONTACTS_MAX` = 2^20.
  - `joltHeapMB(parts, contacts)` adds about 640 B per extra slot, and `sim.worker.ts` passes the estimate.
  - Small worlds keep their old capacities, so every golden is bit-identical.
- **Diagnostic:** `Machine.contactPeak` reports `{count, capacity}`: the busiest step's contact callbacks against the buffer. Near or over 1 means a world grew denser than it started, past the 1.5× margin or the 2^20 cap. That is the only case where exactness still isn't guaranteed, and the JS bindings don't report Jolt's overflow errors.
- **Regression test:** `packages/sim/test/rollback_contacts.test.ts`. It is the repro at 2,100 bricks, trimmed to about 300 ticks (≈ 20 s). It fails on the old budget (it diverges) and passes now.
- **S3's `terrain.test.ts` big-world test** runs three 2,100-brick machines at once, so it now loads a 768 MB heap, as a real run sizes its own. Re-pins: none.
