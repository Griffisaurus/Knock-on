# M4 notes: stream A4 (M4 parts, sim)

Status: **done** (hand-back 2026-10-24). Scope: the 15 Ship = M4 rows of GAME_SPEC §12, each with a def, behaviour, card, demo, per-part golden and fuzz entry (PART_SYSTEM §7–8). Plan and rules: [M4_PLAN.md](M4_PLAN.md).

## Where things live

| What | Where |
|---|---|
| Part definitions | `packages/parts-data/src/defs_m4.ts`, spread into `PARTS` by `defs.ts` (it only type-imports `defs.ts`). Also: the tuning and geometry constants the sim reads (`GRIT_HOPPER`, `TANK`, `MARBLE_HOPPER`, `SPRINKLE`, `SPONGE`, `WATERWHEEL`, `HOURGLASS`, `BLOWOUT`, `VAC`, `INFLATOR`, `ARC_TOWER`, `TOAST`, `YOLK`, `ZIPPY`, `QUACK`, `MATTER_KIND`), `M4_TYPES`, `M4_CONTAINERS`, `CARDS_M4`, `m4Demos()` and `helioOnInflator()`. `index.ts` re-exports it. |
| Cards, demos | `CARDS_M4` spread into `CARDS` (`cards.ts`); `m4Demos(() => new Demo())` merged into `DEMOS` (`demos.ts`). |
| New family | `Family` adds `'matter'` (the seven Matter parts). `catalog.ts` lists it after `contraptions` with Beam `#2FD6FF` (ART_BIBLE: Matter = clear poly + Beam). |
| Channels | `packages/sim/src/channels/`: `m4.ts` (state, pools, dispatch, hash, restore, outputs), `m4_matter.ts`, `m4_air.ts`, `m4_misc.ts`, `m4_vehicle.ts`. `index.ts` calls them from the existing hooks. |
| State | `st.m2.m4` (`M4State` in `m4.ts`, declared onto `M2State` by module augmentation): per part `q` (stored quantity), `acc` (emission remainder), `open`, `ph`, `t0`, `n`, `cause`, `hold`, `aux`, plus `heat` (ARC TOWER strike spots). Plain data: checkpoints, rollback and desync repair carry it. |
| Tests | `packages/sim/test/goldens_m4.test.ts` (15 goldens, Matter off), `m4.test.ts` (8 rule / rollback tests), `m4_matter.test.ts` (7 Matter-on tests on MX's `MatterCpu`), `fuzz_scenes_m4.ts` (wired into `fuzz.test.ts`). |

## Shared-file edits (all small and marked `A4`)

- `machine.ts`: the M4 `EventKind`s (end of the union); `partFill(out)` and `vehicleWheels()` (read-only outputs).
- `channels/index.ts`: `m4: M4Parts`; calls in `onBuild`, `init`, `onSignal`, `heatSources`, `behave`, `onContact`, `afterContacts`, `wantsPersisted`, `afterRestore`, `hash`, `flags`, `meter`, `stageSpawn`; `fill(i)`. M4 types register in `byType` like M3 ones.
- `parts-data/{defs,cards,demos,index}.ts`: the spreads and re-export; `Family` gains `'matter'`.
- `apps/game/src/catalog.ts`: `FAMILY_ORDER` and `FAMILY_HEX` gain `matter`.
- `sim/test/fuzz.test.ts`: spreads `M4_SCENES` (property sweep and the no-property loop).
- No edits to `host.ts`, `m3.ts` or anything of MI's: M4 reaches `Machine.pop` / `matter` through the Host cast (`M4Host` in `m4.ts`), and TOAST CANNON slices join A3's public pool arrays (below).

## The parts

| Type | What the sim does |
|---|---|
| `grit_hopper` | Static. `capacity` 50k–1M grains, `rate` grains/s, `start` %, `open` (at start). Each pulse on `open` toggles the gate (`Valve`). Open, it takes `rate`/s from its store and emits them as Matter sand at the outlet; `Empty` when it runs out. The top grille is an intake that refills it, up to capacity. |
| `hourglass` | Dynamic, 0.5 kg, `duration` 1–120 s. A fill-pass display, no grains (D93): `q` = ticks of sand left in the local-top bulb. Upright (tilt < 70°) the top drains; past 110° the bulbs swap (it fills back); in between it pauses. Each time the running bulb empties it pulses `out` (`Empty`); a change of direction is a `Flip`. Placed upside down, its sand is already at the bottom: it waits (no signal) until turned upright. |
| `tank` | Static, 15 L. `flow` 0.1–2 L/s, `start`, `open`. Like the hopper, with Matter water from the valve spout (spout speed = flow / pipe area, at least 0.5 m/s). The funnel on top refills it. |
| `sprinkle_can` | Static cradle + hinged can (`arm`). A knock of ≥ 0.3 N·s on the can, or a push past the 20° detent, latches it (`Trigger`): a position motor drives it to its pour stop and holds it. While the level reaches the spout (tilt ≥ 6° + 32° × (1 − fill)) it sprinkles 0.25 L/s from the rose (7-jet spread). The can's mass is 0.5 kg + its water. Upright, its fill hole refills it. |
| `waterwheel` | Static stand + free hinged wheel (`arm`, 1.2 kg), 5 L-section buckets (10 plates, a tangential floor at r 0.145 and a radial lip). No code: Matter water pushes the plates. `axle` drives a BAND. Measured: 1.5 L poured at 1 L/s from just above the top bucket turns it −2.17 rad (clockwise, +X side down) in 2.5 s. |
| `sponge` | Dynamic, 0.05 kg dry. Absorbs Matter water through its skin up to 2 L; mass = 0.05 kg + 1 g per mL (set on the Jolt body, re-applied after restore). Squeezed (≥ 5 kg resting on its top, or a ≥ 2 N·s hit for 0.25 s) it releases 1 L/s from both ends (`Squeeze`, mag = mL held), and its skin stops absorbing until 0.5 s after. `start` = soaked %. |
| `marble_hopper` | Static. `capacity` 100–100k marbles, `rate` 10–1,000 /s, `start`, `open`. Like the hopper, Matter marbles from the chute; the lid hatch refills it. The 6-digit counter is `round(fill × capacity)`. |
| `blowout` | Static, 80 W. Powered: a 2 m / 10° wind cone along +X (the GALE's force rule, C·s = 9; it turns TURBINEs). After 0.5 s at power the heater is warm and the same cone is a heat source (spheres every 5 cm, r = d·tan 10°): it pops HELIOs, lights fuses and wicks, burns ropes. |
| `vac` | Static, 90 W. Powered: a 1.5 m / 20° inverted cone pulls bodies toward the mouth; a body of ≤ 0.5 kg at the mouth is held there (`Attach`, other = it) until the power stops (`Release`). |
| `inflator` | Static, Signal only. The HELIO whose knot sits on its filler nozzle at the start (within 0.06 m; or joined by a `fill` link once the format has the kind) is seated: held on the nozzle by a pre-built distance constraint, starting empty. Each pulse on `in` opens the valve for 2 s (`Valve` 1 / 0); open, the HELIO gains 50 %/s, and its lift follows the fill (the unfilled share of the 4.9 N is cancelled). Past 100 %: `Overfill` (other = the HELIO); past 110 % it pops. |
| `arc_tower` | Static, 400 W. At supply ≥ 0.75 it charges 0.5 s, then every 0.25 s strikes the nearest steel body (material steel or magnetic) within 2 m of the toroid (ties: part order): `Arc` (other = target, mag = distance, pos = the hit point on the target's near side), an 85 dB Sound, and a 0.1 s heat spot r 0.03 m there. No impulse. |
| `toast_cannon` | Static, 200 W. Each rising edge of its supply through 0.75 starts a toast (`Trigger`, lever down); it toasts only while the supply holds; after `toast` s (1–5, default 3: the browning dial) stage 12 pops two slices up at 3 m/s (`Launch`, mag 3). The slices are a pool of 6 (D66); a fourth round reuses the oldest two (`Despawn` first). |
| `yolk` | Dynamic, 0.055 kg ceramic, an egg of two spheres (blunt end up). Any single contact of ≥ 0.3 N·s splats it (`Splat`, mag = J, other = what hit it) and it leaves play. |
| `zippy` | Dynamic, 0.8 kg: a Jolt `VehicleConstraint` + `WheeledVehicleController` (4 ray wheels r 0.03, rear drive, no steering). A pulse on `go` starts it forward (+X) or stops it (`Drive`, mag 1 / −1 / 0). A speed hold keeps it at `speed` (0.2–3 m/s). A ≥ 0.1 N·s hit on its nose stops it, reverses it or is ignored (`bump`). `start` drives from tick 0. The rear `tow` hook takes a LINE. |
| `quack` | Dynamic, 0.04 kg latex. Floats by Matter buoyancy (no code). An impact of ≥ 0.06 N·s, or 0.3 kg coming to rest on it, squeaks (`Squeak`, mag 0–1, 0.15 s cooldown). No Sound event: critters never hear it. |

## New events (for F4 audio, R4 VFX, U4 captions, C4)

Appended at the end of `EventKind`. Consumers ignore kinds they don't know.

| Kind | Who / part / other / mag |
|---|---|
| `Valve` | GRIT HOPPER gate, TANK valve, MARBLE HOPPER feed, INFLATOR valve. mag 1 opened, 0 closed. pos = the spout (INFLATOR: the valve). |
| `Empty` | A dispenser or SPRINKLE CAN ran out (cause = its `Valve` / `Trigger`); HOURGLASS's running bulb emptied (this is its signal; a `Signal` follows on the receiver). |
| `Flip` | HOURGLASS bulbs swapped roles. mag = new running direction (1 upright, −1 inverted). |
| `Squeak` | QUACK. mag 0–1 intensity (J / 0.5 N·s, or 0.5 for a load). Cosmetic only. |
| `Arc` | ARC TOWER strike. other = the target, mag = distance (m), pos = the hit point. Followed by an 85 dB `Sound`. The arc starts at the breakout spike (tower-local (0, 0.5, 0)). |
| `Overfill` | INFLATOR past 100 % (the gauge's amber band). other = the HELIO, mag = fill. The HELIO's `Pop` follows past 110 %. |
| `Squeeze` | SPONGE squeezed with water in it. mag = mL held at that moment. |
| `Drive` | ZIPPY. mag 1 forward, −1 reverse (a bump in Reverse mode), 0 stopped. |

They also use existing kinds: `Splat` (B4's kind, same meaning; a placed YOLK: part = the YOLK, mag = J), `Trigger` (SPRINKLE CAN latch, TOAST CANNON lever), `Launch` (toast pop, mag = 3), `Despawn` (a reused slice), `Attach` / `Release` (VAC), `Pop` (HELIO), `Sound` (ARC TOWER, 85 dB), `Powered` / `Unpowered`, `Signal`.

F4 note: `apps/game/src/audio/m4.ts` already listens for most of these names. `Valve` mag > 0 is open; HOURGLASS's done cue should key on `Empty` (it also fires on its receivers' `Signal`); SPRINKLE CAN has no `Latch` / `PourEnd` (`Trigger` = latch; the pour is `lit` in the flags); YOLK splat is `Splat` only (no `Break`).

## For R4 (rendering) and U4 (UI)

- **`Machine.partFill(out)`** (part order, 0–1): Matter containers' stored quantity / capacity (GRIT HOPPER, TANK, SPRINKLE CAN, SPONGE, MARBLE HOPPER), HOURGLASS's local-top bulb (the bottom bulb is 1 − fill), a HELIO seated on an INFLATOR (its `sk_inflate`, up to 1.1), and MI's FISHBOWL / SCOOP (it merges MI's `matterFill`). One array for every container: put it in keyframes.
- **Flags (`PartFlagBits`).** Dispensers: `lit` while pouring, `fault` while under 10 % (amber blink). HOURGLASS: `lit` while its stream runs, `pressed` 0.2 s at its signal. SPRINKLE CAN: `lit` while sprinkling, `armed` once latched. SPONGE: `lit` while ≥ 20 % wet (darker), `pressed` while squeezed (drive `sk_squash`). BLOWOUT: `armed` while warming, `lit` while the coil glows (warm, and 2 s of cooling). VAC: `powered` (mouth ring), `pressed` while holding (clogged). INFLATOR: `lit` while the valve is open, `pressed` while over-filled. ARC TOWER: `armed` while charging, `lit` while arcing (brush discharges if no `Arc`). TOAST CANNON: `armed` + `lit` while toasting, `lit` while cooling 1 s. ZIPPY: `lit` (headlights) while driving, `fault` while blocked 0.5 s, `pressed` 0.2 s after a signal. QUACK: `pressed` 0.12 s per squeak (`sk_squash`).
- **Meters (`partMeters`)**: GRIT HOPPER, TANK, MARBLE HOPPER fill bars as 1–21 (level (n − 1) / 20, like CELL).
- **`Machine.vehicleWheels()`**: 9 floats per ZIPPY: [part index, wheel angle × 4 (rad), suspension length × 4 (m)], wheels FL, FR, RL, RR.
- **Bodies.** TOAST CANNON slices are role `'piece'`, `chunk` = pool index 0–5, parked dormant under the toaster until popped; they draw the def's `on: 'piece'` visuals (E4a's `toast_slice`). SPRINKLE CAN's can and WATERWHEEL's wheel are the part's `arm`. ZIPPY is one body (its wheels are Jolt's, see above).
- **Matter emit points** are part-local `spout`s in the constants (`TANK.spout` etc.); R4's spout VFX can read them.

## For B4 (HENNY's YOLKs)

B4 built HENNY's egg pool in `critters/m4.ts` with the YOLK def's shapes (`partDef('yolk').shapes({})`), mass, friction and restitution, and splats laid eggs by the same 0.3 N·s rule (`YOLK.breakJ`). A4 needs nothing else from B4. The YOLK def and `YOLK` constants are the contract: change them only together.

## Matter API usage (MI's `machine.matter`, contract 2)

- `emit(part, kind, count, localPos, localVel, spread)`: dispensers, SPRINKLE CAN (rose position and direction taken from the tilted can, converted to the static base's frame), SPONGE (both ends). Counts are whole particles per rigid tick from an integer remainder, so the store and the particles always agree (`m4_matter.test.ts` checks it).
- `intake(part, box, 1 << kind, room)`: every stage 6, with the room left (0 = closed); SPONGE closes while squeezing and for 0.5 s after; SPRINKLE CAN only while upright.
- `absorbed(part)[kind]`: added to the store each stage 6.
- With Matter off (MatterHost inactive) the calls are no-ops and the stores still drain at the same rate.
- Not used: MI's `container()` / `take()` (A4 keeps its stores in `st.m2.m4`).

## Determinism

- **Pre-built, dormant, never pushed.** TOAST CANNON slices are registered as A3 pool slots (`M3Parts.slotBody` / `pools` …, via `M4Parts.poolSlot`), so `spawn` / `despawn`, object layers, `afterRestore`, the M3 hash, blasts (`livePieces`), `eachPushable` and RECYCLER treat them like FABRICATOR parts; their parks sit at x + 0.25 beside A3's. INFLATOR seat constraints and the ZIPPY vehicle are built with the world (part order); no bodies or constraints are created mid-run.
- **Re-applied after a restore:** body masses (SPONGE, SPRINKLE CAN) from the stored water, seat-constraint enables. The vehicle's wheel and controller state is in Jolt's SaveState; its driver input is set from `st` every tick.
- **Tested:** a rollback mid-run across a toast cycle, a driving ZIPPY, a filling INFLATOR, a squeezed SPONGE, an HOURGLASS, ARC TOWER strikes, a VAC hold and a draining hopper rejoins the straight run bit for bit (`m4.test.ts`); with Matter on, a restore mid-pour (two TANKs and a hopper) does too (`m4_matter.test.ts`). A blast beside a TOAST CANNON leaves its dormant slices exactly where they were parked.
- **The M4 hash block** is added only when the machine has an M4 part, so every M1–M3 golden is bit-identical.

## Deviations from the specs

- **SPRINKLE CAN pour stop 45°, not 60°.** At 60° the rose (from the hinge at 0.07 m) would dig into the floor; 45° is the deepest the brief's geometry allows. The pour threshold is scaled to match. The cradle collides as two rails under the yokes: a full plate stopped the can's front edge as it tipped. E4a's build already follows (PIVOT__tilt max 45).
- **SPONGE intake 12 mm proud, not 5 mm.** A water particle's centre never comes within its 6.2 mm radius of the skin, so a 5 mm sensor caught nothing.
- **BLOWOUT doesn't blow flames out.** It is a hot-air jet whose cone is a heat source; dousing (SIMULATION §5.7) and lighting in the same cone would flicker. Its wind still pushes and turns turbines.
- **TOAST CANNON `toast` prop (1–5 s, default 3).** The brief's browning dial; the demo uses 1.5 s so the pop fits the 3 s demo limit. Toasting pauses while the supply is under 0.75.
- **Dispensers' `open` prop** ("Open at start"), like FLAMER's.
- **INFLATOR pairing.** The format has no `fill` link kind yet (PART_SYSTEM §3), so a HELIO seats by position (knot within 0.06 m of the nozzle; `helioOnInflator(at)` places one). A `fill` link is honoured as soon as the kind exists. The seated HELIO stays held on the nozzle (SIMULATION §5.8: "held while linked"), so it floats there when full rather than flying off.
- **ARC TOWER targets** dynamic steel bodies (A3's `eachPushable`), not static steel parts.
- **YOLK** collides as two spheres (blunt and pointed ends), not a 48-vertex hull (ShapeDef has no hulls).
- **ZIPPY** drives straight (no steering input); its bumper sensor is "a hit at local x ≥ 0.06 above the wheels", not a separate sensor shape.
- **Spout points** moved ≥ 1 cm clear of the colliders (TANK z 0.178, MARBLE HOPPER z 0.172): a lattice block spawned inside the valve box sprayed water everywhere.
- **Collision blockouts.** As in M3, collision is a blockout of primitives until each part's `.shapes.json` is read.

## Reports to other streams

- **MI (Matter host): a resting body is re-hit every 62 ticks once Matter has grains.** Repro (Node, MX's `MatterCpu`): FISHBOWL at the origin, a THUD dropped on it from 1.1 m, and THE BUTTON at (−0.6, 0, 0.3) with a THUD resting on it (0.2 m). With `matterGameplay` on, the second THUD produces `Press` + `Impact` (J 0.572, its first landing's) at ticks 0, 62, 124, 186… as if dropped again. With Matter off, or before any grain is emitted, it presses once. The GRIT HOPPER demo shows it too, so it isn't the part. Until it's fixed, A4's Matter-on tests avoid buttons (`open` at start).
- **MI / MX: light bodies get flung by water.** A QUACK (0.04 kg) floating in a basin of 1.6 L of Matter water rides it for ~1 s, then is thrown to y 0.94 m at ≈ 1.5 s (`m4_matter.test.ts` QUACK scene; that test stops at 1.1 s because of it).
- **MI (format): `fill` link kind.** PART_SYSTEM §3 has an Air `fill` link (INFLATOR → HELIO knot). Appending `'fill'` to `LinkKinds` is enough: `m4_air.ts` already honours it.
- **E4a:** `m4_parts.test.ts` expects SPRINKLE CAN LUTs to 45° (the build has 60) and a ZIPPY wheel bottom at −0.035 (−0.0356); its D78 texture checks run before the textures exist. A4 aligned to E4a: VAC `in` y 0.095, MARBLE HOPPER `open` z 0.115, TOAST CANNON bounds z to 0.07 (the lever knob).

## Tests

- `goldens_m4.test.ts`: 15 goldens (Matter off), each run twice with identical hashes and events, behaviour assertions (events, cause chains, fill, flags, poses), and pinned hashes.
- `m4.test.ts`: 8 tests (rollback, dormant pool, 75 % thresholds, HOURGLASS orientation, ZIPPY bump modes, VAC release, SPONGE mass, INFLATOR seating).
- `m4_matter.test.ts`: 7 Matter-on tests on MX's CPU backend (≤ 3,000 particles each): emitted = drained (sand, marbles, water), TANK → TANK refill through the funnel, SPONGE soaking and mass, WATERWHEEL turning, QUACK floating, rollback with Matter. No hashes pinned there: they depend on MX's kernels, which are still changing.
- Fuzz: 15 entries (8 property sweeps of 20 sets × 2 seeds, 7 scene runs).

## Final check (hand-back)

- `pnpm vitest run packages/sim packages/parts-data`: **466 passed** (24 files).
- `pnpm -s lint`: clean. `pnpm --filter @knockon/game typecheck`: clean. Root `tsc -p tsconfig.json`: only other streams' errors (MX `packages/matter/test/matter.test.ts`, E4a `packages/assets/test/m4_parts.test.ts`).
- Re-pins: none of anyone else's. Every M1–M3 golden is unchanged.
