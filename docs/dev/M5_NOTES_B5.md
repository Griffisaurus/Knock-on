# M5 notes, stream B5 (BUZZ, sim)

Scope: BUZZ the courier drone in the sim (GAME_SPEC §11, SIMULATION §7.3, critters.md BUZZ, D105), the `tagged` part flag in the format, BUZZ tests and the critter-soak additions. Same standard as B4's M4 cast ([M4_NOTES_B4.md](M4_NOTES_B4.md)).

**Status: done** (2026-10-25). Test and soak results at the end.

## Contract 3: BUZZ ⇄ BUZZ BEACON (agreed: A5's proposal in M5_NOTES_A5.md, with these points)

B5 takes A5's interface (`self.x.m5`: `beacons()`, `beacon(i)`, `setBeaconStatus(i, s)`, state in `st.m2.m5`). B5 dropped its own first draft (a `Machine.receive` hook): nothing in `machine.ts`'s signal path changes. How B5 uses it:

1. **Index:** `beacon(i)` and `setBeaconStatus(i, s)` take the **part index** (what `beacons()` returns; confirmed in A5's `channels/m5.ts`).
2. **Pairing:** BUZZ has a `pair` prop (int 0–7, default `BUZZ_PAIR_DEFAULT` = 5, Ignition). BUZZes in part order take the first beacon (part order) with their pair that no earlier BUZZ took: one BUZZ per beacon. A BUZZ placed within `BUZZ_BEACON.bindRadius` (0.2 m) of its beacon's dock starts docked (snapped to the dock pose); elsewhere it flies home and docks at the start of the run. No beacon: it stays landed.
3. **Calls:** BUZZ keeps `served` in its state; a call is pending while `calls > served`, and **each job serves one call**, so two Signals give two fetches (a call that arrives mid-job waits its turn). `callCause` is the cause of BUZZ's takeoff `CritterState` event.
4. **Status:** BUZZ calls `setBeaconStatus(part, s)` every tick from its act (stage 6), derived from its state: 1 docked, 2 away (anything else: out on a job, flying home, landed beside, tumbling). Idempotent, so rollback needs nothing more.
5. **The pad:** BUZZ tests the pad itself (5 short rays down onto the pad that ignore BUZZ and ghost bodies), so `padItem` isn't on its path. **A5:** if `padItem` drives anything, skip critter bodies (a docked BUZZ's centre is over the pad) and ghost-layer bodies (a carried item).
6. **Shared data:** `BUZZ_BEACON` in `parts-data/src/critters.ts` (B5) holds the dock offset (0, 0.040, 0) (= A5's `BEACON.dock`), `padRadius` 0.10, the `call` port position (0, 0.022, 0.100) (a test checks it against A5's port) and `bindRadius`. BUZZ's `pair` is an enum over `BUZZ_PAIRS`, the same names as A5's `BEACON_PAIRS` (critters.ts can't import defs_m5.ts; a test keeps them equal).

**Requests to A5:**
- **RIFT GATES** (aperture Ø 0.31 m): BUZZ's collider spans 0.34 m (body + 4 ducts), so the ring blocks it physically. Please also skip critter bodies (`def.critter`) and ghost-layer bodies in the transit test, so a BUZZ, its tumble body or a carried item (a ghost) never teleports.
- **SINGULARITY:** critters are never removed (SIMULATION §7.4: spit out with a comedic launch); BUZZ included.

## For E5b (art)

Taken as proposed: `RAG__body` is one rigid **box** (`RagBone.shape: 'box'`, new `halfExtents` [0.17, 0.045, 0.17], a / b = (0, 0, 0) / (0, 0.090, 0), 1.1 kg); skids `COL__box__5` 0.128 × 0.13 × 0.012 at z 0.006; the six role clips are appended to `CRITTER_CLIPS` exactly as named. The winch pivot is (0, 0, 0.022) and pays out 0–0.60 m; a carried item hangs with its top at the claw.

## Tagging (format, B5)

- **The flag:** `PartFlag.Tagged = 1 << 9` in `packages/format/src/model.ts` (the format's part flags; D105 calls it `PartFlagBits.tagged`). Bits 6–8 of the PART record's wire u16 are HAS_SIZE / HAS_PROPS / HAS_SKIN, so the tag takes the next free bit, 9, and `world.ts`'s `FLAG_MASK` grows to `0x23f`. Old files never set bit 9, so they read unchanged.
- **Doc path:** ops already carry flags as a u16 (PartAdd, PartUpdate). Saved modules keep the tag (`moduleFromSelection`'s `keepFlags`). The canonical world bytes carry it, so the world hash covers it.
- **Sim path:** the Machine keeps each part's snapshot flags (`PartRt.flags`). BUZZ's tagged list comes from them, and the critter hash covers the tagged set (only when there is one, so untagged worlds keep their hashes; a test checks that tagging one STITCH changes the hash even with no BUZZ).
- **Run output:** `PartFlagBits.tagged = 128` in `Machine.partFlags()` on every tagged part (inert ones too), never on a critter. `Machine.critterTargets()` gives pairs [BUZZ part index, item part index] while BUZZ flies to or winches up an item.
- **Critters can't be tagged:** the sim ignores the bit on them.
- **U5:** the Build-mode toggle and the tag glyph set or clear `PartFlag.Tagged` with the usual flag op. In a run, `PartFlagBits.tagged` and `critterTargets()` give the glyph and "the item BUZZ is after".

## Files

| File | What changed |
|---|---|
| `packages/sim/src/critters/m5.ts` (new) | `M5Critters`: BUZZ's pairing, state machine, flight controller, tag scan, winch and claw, carry, drop-off, landings, tumble hooks, clips and flags, and the `BeaconHost` / `BeaconView` types (A5's interface, read structurally). |
| `packages/sim/src/critters/state.ts` | `M5St` (one per critter, only in worlds with a BUZZ), hashed only when present. **M2 / M4 hashes and goldens are unchanged.** |
| `packages/sim/src/critters/system.ts` | Hooks into `M5Critters`, each commented `M5 (B5)`: the drone body (box + 4 duct cylinders + skids), a `box` ragdoll shape (`RagBone.halfExtents`, damped like Dusty's), init, think / act / finish dispatch, `onRagdoll`, `afterRestore`, `carryFollow`, `critterTargets`, `hash`. BUZZ doesn't sulk over a dropped item (`drop()` sets no ignore timer for it). New `CritterHost.beacons?()`, `CritterPartRt.flags?`, event kinds `Fetch` and `Deliver`. |
| `packages/parts-data/src/critters.ts` (shared, Edit) | Appended table entries, `Species` + `'buzz'`, `CritterSpec.drone`, `RagBone.shape: 'box'` + `halfExtents`, the BUZZ spec and ragdoll, `CRITTER_M5`, `BUZZ_BEACON`, `BUZZ_PAIRS` / `BUZZ_PAIR_DEFAULT`, `CRITTER_WINCH_SHIFT`, `BUZZ_ROTORS`, the part def (`pair` prop), the card and the demo. |
| `packages/parts-data/src/defs.ts` (shared, Edit) | `ship` gains `'M5'` (A5 needs it too). |
| `packages/sim/src/machine.ts` (shared, Edit) | Each commented `B5 (M5)`: `EventKind` + `Fetch`, `Deliver`; `PartRt.flags`; `critterHost().beacons` (A5's `self.x.m5`, read structurally); `PartFlagBits.tagged` and `taggedBits()` for `partFlags()`; `critterTargets()`. |
| `packages/format/src/model.ts`, `world.ts`, `module.ts` (shared, Edit) | `PartFlag.Tagged`, `FLAG_MASK`, the module's kept flags. |
| `packages/sim/test/critters_m5.test.ts` (new) | 19 tests: contract data, the format flag (world file, ops, modules), run outputs, 2 goldens, the behaviours, replay / late-poke rollbacks, rule 14 restores, hashes and checkpoint transfer. |
| `packages/sim/test/fuzz_scenes_b5.ts` (new), `fuzz.test.ts` (2 lines) | BUZZ's property-fuzz scene (its `pair` prop). |
| `packages/sim/test/critters.test.ts` | `SPECIES` and the ragdoll table list BUZZ. |
| `apps/host/soak/critters.ts` | Every scenario adds a BUZZ BEACON, BUZZ (docked, or placed away a quarter of the time), 1–3 RINGERs calling it, 2–5 tagged items (STITCH, BOING, TOPPLE TILE, SCOOP; a fifth start on a ledge-height drop), sometimes a tagged THUD (too heavy), a wall of anchored PLANKs (a third of the time) or a pair of RIFT GATES (a quarter). New checks: BUZZ never jumps more than 0.25 m in a tick or flies above 4.5 m, a fetched part is always tagged and ≤ 2 kg, a load at the end is a ghost. New stats (`m5`). |

## Wire tables appended (rule 12)

Indices are wire values; the M2 / M4 entries keep theirs (a test checks).

| Table | New entries (index) |
|---|---|
| `Species` | `buzz` |
| `CRITTER_FSM` (50 → 59) | docked 50, takeoff 51, fly 52, grab 53, carry 54, drop_off 55, deliver_bow 56, land 57, landed 58 (BUZZ also uses `sniff` 36, and the shared `ragdoll`, `getup`, `dizzy`, `trapped`, `idle`) |
| `CRITTER_CLIPS` (53 → 59) | takeoff 53, land 54, grab 55, carry 56, drop_off 57, deliver_bow 58 |
| `CRITTER_EMOTES` (31 → 35) | package 31, pin 32, check 33, clock 34 |
| `EventKind` | `Fetch` (the claw closes on an item: part = BUZZ, other = the item, mag = its kg, pos = the claw), `Deliver` (BUZZ lets the item go on its beacon's pad: part = BUZZ, other = the item, mag = seconds since the call, pos = the item's top) |
| `critterState` byte 1 for BUZZ | bit 4 = `BUZZ_ROTORS` (Dusty's `sucking` bit: rotors spinning), bits 5–7 = winch, `(flags >> CRITTER_WINCH_SHIFT) & 7` sevenths of 0.60 m paid out below `PIVOT__winch`. `asleep` (bit 2) while docked. |
| `PartFlagBits` (sim) | `tagged: 128` |
| `PartFlag` (format) | `Tagged: 1 << 9` |

## For E5b (clips), F5 (voice), U5 (captions), R5 (rendering)

**What each state plays** (`critterState` byte 0):

| FSM | Clip | What happens | Emote |
|---|---|---|---|
| docked | sleep | on its pad, rotors off, visor "zz" (asleep flag) | `zzz` on docking and now and then |
| takeoff | takeoff | rises 0.35 m (≤ 1.5 s) | `!` when a call starts the job |
| sniff | sniff | hovers 0.8 s sweeping ±25° | `package` (found one) or `?` (nothing tagged) at the end |
| fly | walk / run (over 1 m/s) | to the item, or home | |
| grab | grab | hovers over the item, pays the winch out (0.6 m/s) until the claw touches its top, closes (`Fetch`), reels in | `pin` on the grab |
| carry | carry | flies home with the item hanging under it, slower with weight (up to −30 % at 2 kg) | |
| drop_off | drop_off | hovers over the pad, lowers the item until it touches, lets go (`Deliver`), reels in | `clock` (within 15 s of the call) or `check` |
| deliver_bow | deliver_bow | 1 s | |
| land | land | onto the pad if it's clear, else onto clear floor beside the beacon (0.38 m out) | |
| landed | sleep | on the floor, rotors off, not asleep (waiting for the pad to clear, or no beacon) | |
| ragdoll → getup → dizzy | tumble → getup → dizzy | the rigid box tumble, then it takes off again and finishes the job | `stars`, then `!` |
| trapped | trapped | in a TRAP BOX, straining (rotors on) | `!` |

- **Audio / captions:** the takeoff `CritterState` event's `cause` is the beacon's `Call` event (A5), so the Cascade Report reads RINGER → Signal → Call → BUZZ. `Fetch` = claw clack; `Deliver` = the delivery jingle; `CritterState` gives every state change (spin-up on takeoff, landing tap on docked / landed, tumble clatter on ragdoll). The rotor whir can key off `BUZZ_ROTORS`, the winch reel off the winch bits changing.
- **Rendering:** BUZZ's base body is the drone (yaw only: rotation locked about X and Z). A carried item is its own body, a ghost the sim hangs under the claw each tick, so draw it from `transforms()` as usual, plus the tether from `PIVOT__winch` (root (0, 0.022, 0) engine) to the item's top. With no item, the winch bits give the claw's drop. `critterCarry()` lists BUZZ's load too (pairs [BUZZ, item]); unlike Bandit's, it isn't attached to a bone.

## How it works

- **Body:** an upright dynamic compound (rotation locked about X and Z): body box 0.14 × 0.06 × 0.12 at y 0.055, four upright duct cylinders Ø 0.11 × 0.035 at (±0.115, 0.066, ±0.115), and skids 0.128 × 0.012 × 0.13. Its span (0.34 m) is wider than a RIFT GATE's 0.31 m aperture: A5's gates never transit a body wider than the aperture, and the ring blocks it.
- **Flight (D105):**
  - The body's gravity factor is 0 in every flying state (takeoff, sniff, fly, grab, carry, drop_off, deliver_bow, land) and 1 on the ground. It is set every act from the state, and re-derived in `afterRestore` (rule 14).
  - A PD on position sets the velocity each tick: a = 6·(goal − p) + 4.9·(v_goal − v). The horizontal part is capped at 3 m/s², the speed at 0.8 m/s (walk) or 1.6 m/s (run, legs over 2 m), climb and descent at 0.8 m/s. `v_goal` is a rolling item's own velocity, so it keeps station over a moving ball.
  - Yaw turns toward travel (4 rad/s).
- **Cruise and obstacles** (every think):
  - It cruises 0.7 m over whatever is below (a downward ray), with a carried item kept 0.15 m clear of it, never above 3 m over the ground, and 0.25 m under any roof.
  - Forward: 3 parallel rays at the duct tips and the middle, plus one through a hanging item. If any is blocked it climbs (+0.25 m per think, up to 3 m); once 1 m up, or with a roof overhead, it side-steps (±0.9 rad, to the clear side).
  - A second of no progress climbs 0.4 m more and swaps sides.
  - A leg that takes over 25 s gives up: the item is ignored for 20 s, or a load is put down where it is and BUZZ goes home.
- **The scan** (end of sniff): the nearest tagged part within 10 m that it can lift:
  - alive, not broken;
  - a dynamic, non-ghost base body ≤ 2 kg (Jolt's mass);
  - no hinge, no uncut LINE, not a critter, not carried by anyone;
  - not already resting on its own pad;
  - not ignored.
- **Reachable from above:** near the item, the first thing straight down from BUZZ must be the item itself (or a critter). Anything else (a shelf over it) and it gives the item up for 20 s.
- **Grab:**
  - It hovers with the claw 0.3 m over the item's top and pays the winch out. It closes when the claw reaches the top (`SENSOR__catch__claw`), or gives up at 0.60 m.
  - The item becomes a ghost (Bandit's `ghostItem`: ghost layer, gravity 0), hung upright and yawed with BUZZ, with its bottom kept where it was, so a tipped item doesn't drop through the floor.
  - It then reels in to 0.08 m (slower with weight).
- **Drop-off:**
  - It hovers over the pad with the item's bottom 0.1 m up, then lowers it (0.3 m/s) until rays over the item's footprint see a surface ≤ 6 mm under it (the pad, or whatever is already on it).
  - It lets go: un-ghosted, at rest, awake.
- **Landing:**
  - On the pad if it's clear (5 short rays down onto it that ignore BUZZ and ghosts). If not, it lands on the first clear, level spot (5 rays, < 3 cm of relief) at 0.38 m left, right, behind, then in front of the beacon. With no beacon, it lands straight down.
  - Touchdown: within 6 mm of the spot, or touching with no downward speed; a 6 s timeout drops it where it is.
  - Landed beside a full pad, it hops home 1.5 s after the pad clears.
- **Tumble:** the shared ragdoll trigger (a hit or poke over 3 N·s, any blast in radius) moves it to its one rigid box (`RAG__body`, 1.1 kg, damping 0.3 / 2.0, a small flip spin). A load drops with BUZZ's velocity. Recovery is the shared one (still for 1 s, or 8 s), then getup (1 s) → dizzy (1.5 s) → takeoff. With a job open, it scans again and goes back for the nearest item, usually the one it dropped.
- **TRAP BOX:** the shared trap check holds it (it drops its load). Let go, it resumes.
- **Never recycled / removed:** A3's RECYCLER and fields already skip critter parts (`def.critter`). The SINGULARITY is A5's (requested above).
- **Hearing:** none (`hearDb` 200): a robot on a job. It isn't a lure.

## Deviations and choices

1. **Beacon pose from the snapshot:** BUZZ computes its dock from the beacon body's pose and `BUZZ_BEACON.dock`: the same point as A5's `dockPos`. Critters initialise before the channels have their state, so A5's view isn't readable at init. Calls and `callCause` come from A5's view at run time.
2. **`RAG__body` is a box** (E5b's proposal), so `RagBone` gained `shape: 'box'` and `halfExtents`. The tumble body is damped like Dusty's (linear 0.3, angular 2.0).
3. **Skids** follow E5b's 0.128 × 0.13 footprint, not the brief's 0.14 × 0.12 (both fit the Ø 0.20 pad).
4. **The carried item doesn't load the drone physically** (it's a ghost, like Bandit's loot). "Sags with mass" is the clip and the slower speed.
5. **Calls queue:** two Signals give two fetches. The brief doesn't say; this is the machine-like reading.
6. **No startle:** BUZZ has the required `startled` clip but no noise or touch startles it in the sim.

## Found in other streams' code (reported, not fixed)

- Nothing open at hand-back. During the work, `pnpm -s typecheck` failed for a while in E5a's `packages/assets/test/m5_parts.test.ts` and F5's `apps/game/src/audio/m5.ts` (`LoopKind`), and A5's fuzz scenes were missing; all three were fixed by their streams before the final runs.
- A5's SINGULARITY spits critters out by setting their velocity. A flying BUZZ then decelerates under its accel-limited PD (3 m/s² horizontal), so the launch reads as a brief fling, not a tumble. That's fine; noted for A5 in case they want a tumble instead.

## Follow-up: the animal critters transit RIFT GATES (orchestrator request, 2026-10-25)

future.md says the gates' Ø 0.31 aperture passes the animal critters (collision capsules ≤ Ø 0.22: MOCHI, PIP, GOBY, BANDIT, HENNY, BISCUIT); DUSTY (Ø 0.366) and BUZZ (0.34 span) bounce off the frame. A5's transit skipped every critter, so B5 added a critter pass.

- **Hook in A5's `channels/m5_rift.ts`** (small, marked `B5 (M5)`): after each gate's own arrivals, `riftCritters()` runs the same rules on the critters:
  - **Candidates:** the critter system's (`CritterSystem.riftCandidates()`, part order): a free critter by its locomotion capsule, a ragdolled one by its root capsule. It reaches the critter system through the Machine structurally (`h.critters`), so `host.ts` is unchanged.
  - **The test:** the capsule is moving into the gate's front; its centre is within (aperture radius − capsule radius) of the aperture centre, so the whole capsule fits; and its leading surface (the extent along the gate's normal) reaches the membrane this step.
  - **Cooldown:** while the pair's cooldown is on, it bounces (`riftBounce`: inward speed × −0.5, `Bounce` event).
  - **Transit:** A5's B·R·A⁻¹ and exit point, the pair's cooldown, `Teleport` / `Emerge` events. Critters go after the gate's bodies.
- **Moving a critter** (`CritterSystem.riftMove`):
  - **Free critter:** the locomotion body stays upright (yaw only, from R applied to its heading, or its new velocity if that ends up vertical). Its capsule centre lands on the exit point, and its velocity turns by R.
  - **Ragdolled critter:** every capsule moves rigidly by R (pose, velocity, spin) and the ghost base comes along, so the ragdoll stays one piece.
  - **AI state:** its goal point and its ragdoll's still-window point move too, so the AI carries on from the far side.
  - **Arrival:** faster than 1.5 m/s it shows `stars` (future.md: "arrive with dizzy stars if fast (no harm)").
  - **Never:** robots (disc / drone), trapped critters, critters in a device and Goby's rescue bubble.
- **Walking in:** the avoidance rays (`avoidRays`, BISCUIT's `avoidBarge`) treat a middle ray that ends inside a *paired* gate's aperture the critter fits through as clear (`CritterSystem.riftOpen`; the pairing comes from A5 via the new `CritterHost.riftPartner`, `machine.ts`). Otherwise the closed backplate would turn every critter away from the portal. A ray only changes behaviour when it hits a rift gate, so earlier goldens are unchanged.
- **Who can actually pass:** walking, a critter passes if its capsule centre is high enough. MOCHI and BISCUIT are measured walking through (tests); BANDIT and HENNY should too by the geometry (capsule centre high enough, nose reaching the membrane before the legs block reaches the 5 cm ring bottom), not measured on foot. PIP and GOBY are too low on foot and pass when thrown (as ragdolls). Measured: a PIP and a HENNY thrown into the aperture both transit.
- **Rollback:** poses are Jolt state; the cooldown is A5's plain state (`st.m2.m5.cd`); goals are plain `st.crit`. Nothing to re-derive.
- **Tests** (`critters_m5.test.ts`, +4, 23 in all):
  - MOCHI chasing PIP walks into gate A and comes out of gate B, upright, still stalking (PIP doesn't pass).
  - A thrown, tumbling HENNY passes as one ragdoll (capsules within 0.6 m of each other throughout) and gets up near gate B.
  - Data: the robots are too wide, the animals ≤ Ø 0.22.
  - BISCUIT chasing MOCHI through the pair replays identically and survives a late-poke rollback across the transit.
- **Soak:** half the scenarios get a "portal lane" (a second MOCHI 0.8–1.3 m in front of a gate with a snack a metre behind it). New checks: DUSTY or BUZZ through a gate fails the run; a critter's own transit isn't counted as a pass through walls. New stats: `critterRiftTransits`, `critterRiftBounces`.
- **Results:** sim + parts-data + format + docstore suite 41 files, **633 / 633 pass**; tsc, the game typecheck and lint clean. Critter soak `--minutes 10 --run 60 --seed 2001`: **PASS**, 10.15 min, 106 scenarios, 2.29 M ticks (3,758 ticks/s), 25,440 hash checks, **0 desyncs**, 106 / 106 rollbacks matching, 727 / 721 ragdolls / getups (1 forced, Pip), **14 critter rift transits**, 0 bounces, 59 / 59 states, **0 failures**. BUZZ's goldens are unchanged (no gate in them); nothing re-pinned.

## Results (final code, 2026-10-25; CPU shared with the other streams, so throughput is provisional)

**Tests:** `npx vitest run packages/sim packages/parts-data packages/format packages/docstore`: 42 files, **621 / 621 pass** (B5: `critters_m5.test.ts` 19, BUZZ in `critters.test.ts`, BUZZ's fuzz scene). `critters_m5.test.ts` also passes with `KNOCKON_JOLT_THREADS=8`, with the same golden hashes. `pnpm -s typecheck` (tsc + the game) and `pnpm -s lint` are clean. Goldens: demo `525f73cebef3e7fc`, full fetch `3ae33b5ee1878196`. The M2 / M4 critter goldens are unchanged.

**Critter soaks, `pnpm soak:critters -- --minutes 10 --run 60`: both PASS.**

| Measure | single build (`--seed 1`) | `KNOCKON_JOLT_THREADS=8` (`--seed 1001`) |
|---|---|---|
| Duration, scenarios | 10.03 min, 113 (all eight critters each) | 10.04 min, 109 |
| Ticks | 2.44 M, 4,057 ticks/s | 2.35 M, 3,908 ticks/s |
| Hash checks | 27,120, **0 desyncs**; 113 / 113 rollbacks matching | 26,160, **0 desyncs**; 109 / 109 rollbacks matching |
| Ragdolls / getups | 742 / 734 (the rest still tumbling at scenario ends, under 9 s); 1 forced recovery (Pip, as in M2 / M4) | 698 / 695; 1 forced recovery (Pip) |
| BUZZ | 216 calls answered, 212 fetches, 194 deliveries, 68 tumbles, 101 landings beside a full pad | 209 calls, 193 fetches, 178 deliveries, 63 tumbles, 108 landings beside |
| States | 59 / 59 | 58 / 59 (Dusty's `scan`, as in M4) |
| Failures | **0** (finite; nothing through the floor or walls; every tumble recovered; BUZZ never jumped or flew above 4.5 m; every fetch tagged and ≤ 2 kg; loads were ghosts) | **0** |

Fetches outnumber deliveries because a tumble drops the load (BUZZ grabs it again) and a scenario can end mid-carry.
