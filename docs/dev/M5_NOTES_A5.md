# M5 notes: stream A5 (Future Tech parts, sim)

Status: **done** (hand-back 2026-10-25). Scope: the 10 non-Matter Ship = M5 rows of GAME_SPEC §12, each with a def, behaviour, card, demo, per-part golden with behaviour assertions and a fuzz entry (PART_SYSTEM §7–8). GOO VAT is X5's (held). Plan and rules: [M5_PLAN.md](M5_PLAN.md).

## Where things live

| What | Where |
|---|---|
| Part definitions | `packages/parts-data/src/defs_m5.ts`, spread into `PARTS` by `defs.ts` (it only type-imports `defs.ts`). Also the constants the sim reads (`RIFT`, `RIFT_PAIRS`, `GRAV_WELL`, `TRACTOR`, `HOVER`, `FORCE_WALL` + `forceWallField()`, `COILGUN`, `STASIS`, `BEACON`, `BEACON_PAIRS`, `SINGULARITY`, `GRABBER` + `grabberLinks()` / `grabberZone()`), `M5_TYPES`, `CARDS_M5`, `m5Demos()`. `index.ts` re-exports it. |
| Channels | `packages/sim/src/channels/`: `m5.ts` (state, build, dispatch, hash, restore, outputs, the BUZZ interface), `m5_field.ts` (GRAV WELL, TRACTOR BEAM, COILGUN RING, STASIS FIELD, the SINGULARITY's pull, `eachLive`), `m5_rift.ts`, `m5_misc.ts` (FORCE WALL, HOVER PAD, BUZZ BEACON, the SINGULARITY's clock and despawns), `m5_grabber.ts`. |
| State | `st.m2.m5` (`M5State`, module augmentation like M4): per part `on`, `t0`, `val`, `val2`, `n`, `cause`, `aux`, `cd`, `inside` (body lists), plus `arm` (GRABBER playback, 12 numbers per GRABBER). Plain data: checkpoints, rollback and desync repair carry it. |
| Tests | `packages/sim/test/goldens_m5.test.ts` (10 goldens), `m5.test.ts` (15 rule / rollback tests), `fuzz_scenes_m5.ts` (wired into `fuzz.test.ts`). |

## Shared-file edits (all small, marked `A5`)

- `machine.ts`: the A5 `EventKind`s (end of the union); `grabberJoints()` (read-only output).
- `channels/index.ts`: `m5: M5Parts`; calls in `onBuild` (M5 types register like M3 / M4 ones), `init`, `onSignal`, `behave`, `afterBehaviours`, `stageSpawn`, `afterRestore`, `hash`, `flags`, `meter`. `afterBehaviours` and `stageSpawn` lost their early `if (!this.m3.active) return` (now an `if` block) so the M5 hooks run after the M3 ones either way; behaviour unchanged.
- `parts-data/{defs,cards,demos,index}.ts`: the spreads and the re-export. (`ship: 'M5'` was already added by B5.)
- `sim/test/fuzz.test.ts`: spreads `M5_SCENES` (property sweep and the no-property loop).
- Not edited: `apps/game/src/catalog.ts` (no new family: the parts are `future`, plus SINGULARITY `boom` and GRABBER `drive`).

## The parts

| Type | What the sim does |
|---|---|
| `rift_gate` | Static. `pair` (6 colours, `RIFT_PAIRS`): gates of a colour pair up in part order, 1st with 2nd, 3rd with 4th; an odd one is unpaired. Stage 12, pairs in part order: a body moving into a gate's front (+Z), centre inside the Ø 0.31 aperture, half-extent ≤ 0.155 m, whose leading surface reaches the membrane within the next step, transits: centre, orientation, velocity and spin carried by B·R·A⁻¹ (R = 180° about the gate's up axis), appearing 2 cm in front of B's membrane, mirrored across (x → −x). `Teleport` at A, `Emerge` at B. One transit per pair per 0.25 s (the cooldown starts when a body arrives): during it, arrivals at either gate bounce off the membrane (inward speed × −0.5, `Bounce`). Only free bodies travel (see Determinism); others bounce. |
| `grav_well` | Static, 250 W, `mode` Attract / Repel. Powered: every pushable body within 5 m of the orb (0.135 m up) feels a = s·f / max(r, 0.2)², **s = 4 m³/s²**, at most 40 m/s². A sleeping body is woken only if a ≥ 0.05 g. |
| `tractor_beam` | Static, 180 W, `mode` Pull / Hold, `range` 0.5–3 m, `hold` 0.5–3 m. Powered: bodies whose centre is in the beam (a cone along +Z from the lens: r 0.06 m → 0.09 m at 3 m, plus up to 0.05 m of the body's size), up to `range`, are captured in part order until the load would pass **2 kg × f**; the rest feel nothing (strain). Each captured body: gravity cancelled, and a = 10·(v_target − v) (≤ 30 m/s²) with v_target = 4/s × offset, capped 0.5 m/s along the beam (Pull) or 1 m/s (Hold), 1 m/s across: a spring-damper, k 40 /s², ζ ≈ 0.8. Pull's target is the lens (stopping 3 cm short); Hold's is `hold` m along the beam. `Attach` / `Release` as bodies enter / leave. |
| `hover_pad` | Dynamic, 2.5 kg, 120 W. Powered: a SixDOF constraint to an invisible static anchor locks its rotation; the setpoint rises at 0.5 m/s (easing in over the last 10 cm) to 0.5 m above the placed position; a vertical spring-damper (**k 10,000 N/m**; damping critical for the empty pad, capped at 0.9·m/dt) plus its own weight fed forward holds it, × f; a soft horizontal spring (40 /s², critically damped) keeps it over its base point; stretch clamped ±5 cm. **Measured sag: 9.9 mm at 10 kg** (THUD + MAGLOCK), 6.9 mm at 7 kg, 19.6 mm at 20 kg (overload `fault`). Unpowered: the lock releases and it falls; the setpoint follows its height. |
| `force_wall` | Static pylons, `width` / `height` 0.1–1 m, `start` (on at start). The field is its own static body (role `piece`, chunk 0) between the pylons' inner faces, z 0.04 to H − 0.015, 2 cm thick, friction 0.3, restitution 0.6. Each Signal on `toggle` switches it (`Barrier` mag 1 / 0): the body moves between the static and ghost layers (D103), and bodies at the wall are woken. |
| `coilgun_ring` | Static, 300 W, `direction` Forward (+Z) / Back. The charge fills over 0.5 s × f (`Charged`). A pass = a body's centre in the bore (r 0.075 × 0.10 m), or crossing its mid-plane inside that radius during the step (fast bodies). At the start of a pass a steel body (magnetic or `steel`) gets Δv = +3 m/s along the boost direction if charged and powered (`Boost` mag 3, other = it; the charge empties); anything else is a dud (`Boost` mag 0). Once per pass. |
| `stasis_field` | Static corner nodes, `width` / `height` / `depth` 0.1–1 m, 220 W. At f ≥ 0.75 (`Engage` mag 1; mag 0 when it drops): every pushable body whose centre is inside has this tick's forces and torques dropped, its velocity zeroed and its gravity cancelled, every tick (ZONE's way, D103: no motion-type switch). New arrivals: `Freeze` (other = it). On release every frozen body is woken. |
| `buzz_beacon` | Static pad, `pair` (6 colours, `BEACON_PAIRS`, default 5 Ignition). A Signal on `call` counts a call (`Call`, mag = call number). Everything else is BUZZ's (B5): see the interface below. |
| `singularity` | Static, family `boom`. A Signal on `arm` opens it once (`Engage` mag 1; later arms do nothing): for 6 s a Grav Well with **s = 40**, radius 20 m from the core (0.115 m up), ramping up over the first 0.5 s, ≤ 60 m/s², with swirl damping (2 /s on the velocity across the radius) so bodies spiral in. Live critters' capsules are pulled too. Stage 12: a pushable body whose centre is within 0.3 m of the core leaves play (`Despawn`, part = the singularity, other = it, mag = count): a pool slot goes back to its pool, a part's base (or a chunk of a broken part) takes the part out (its LINEs let go); parts owning pieces or pools stay. A critter there is spat out (up 4 m/s, out 3 m/s, `Launch`, other = it), never swallowed. At 6 s: `Collapse` (mag = count), spent. Static, never pushed: immune to its own pull and to blasts. |
| `grabber` | Static base + 3 kinematic link bodies (upper arm, forearm, gripper: role `piece`, chunk 0–2), 100 W. Props: zones A and B (`aYaw` / `bYaw` from the front about +Y, `aReach` / `bReach` 0.12–0.30 m, `aHeight` / `bHeight` 0–0.2 m), `grip` 0.02–0.08 m, `loop`. Each Signal on `go` queues a cycle (max 8); `loop` repeats while powered (`Trigger` at each start). The cycle plays joint-space segments (end poses from an analytic two-link IK with the gripper pointing down; durations from the largest joint move at 3 rad/s; smoothstep easing), with progress × f (a weak supply slows it, f = 0 freezes it). Descending at A it grips the first body between the fingers (≤ grip/2 + 2 mm radius, ≤ 1 kg) once its top meets the palm (`Attach`), carries it (velocity to the jaw each step, gravity cancelled), sets it down 3 mm over B (`Release`), and parks. Nothing at A: `Jam`, a 1.5 s shrug (`fault`), then park. |

## Chosen constants (no spec value existed)

- **GRAV WELL s = 4 m³/s²** (× f): 4 m/s² (0.41 g) at 1 m, 1 g at 0.64 m, 0.16 m/s² at its 5 m edge. Cap 40 m/s² (MAGLOCK's).
- **SINGULARITY** cap 60 m/s² and swirl 2 /s (s = 40 and 20 m are the spec's).
- **TRACTOR BEAM** max load 2 kg × f; beam radius 0.06 → 0.09 m (the vfx cone); gains above.
- **HOVER PAD** k = 10,000 N/m (sag 9.8 mm at 10 kg by construction; 9.9 mm measured).
- **RIFT GATES** exit gap 2 cm, overflow bounce 0.5.
- **GRABBER** joint speed 3 rad/s, dwell 0.15 s, lift 0.12 m, payload 1 kg; pointing down, the tips reach 0.32 m at shoulder level.

## Events (for F5 audio, R5 VFX, U5 captions)

Appended at the end of `EventKind`. Consumers ignore kinds they don't know.

| Kind | Part / other / mag |
|---|---|
| `Teleport` | RIFT GATES: part = the entry gate, other = the body's part, mag = speed (m/s), pos = the entry aperture. |
| `Emerge` | part = the exit gate, other = the body's part, mag = speed, pos = the exit aperture, cause = the `Teleport`. |
| `Bounce` | A body hit a pair's membrane during its cooldown (or a body that can't travel): part = the gate, other = it, mag = its inward speed. |
| `Barrier` | FORCE WALL switched: mag 1 on, 0 off; pos = the field's centre. |
| `Engage` | STASIS FIELD engaged / released (mag 1 / 0); SINGULARITY armed (mag 1). |
| `Freeze` | STASIS FIELD: a body entered while engaged (other = it). |
| `Charged` | COILGUN RING ready (mag 1). |
| `Call` | BUZZ BEACON called (mag = call number). BUZZ's takeoff takes it as cause. |
| `Collapse` | SINGULARITY at 6 s (mag = bodies swallowed). |

Existing kinds the M5 parts emit: `Attach` / `Release` (TRACTOR BEAM capture / loss; GRABBER grip / set-down; other = the body's part), `Boost` (COILGUN RING: mag 3 a kick, 0 a dud pass), `Despawn` (SINGULARITY: other = the part, mag = count), `Launch` (SINGULARITY spits a critter: other = it, mag = speed), `Trigger` (GRABBER cycle start), `Jam` (GRABBER: nothing at zone A), `Powered` / `Unpowered`, `Signal`.

**GRABBER captions (U5):** `Trigger` = starts a pick, `Attach` = grabs X, `Release` = puts X down, `Jam` = shrugs: nothing at A.

**F5:** `apps/game/src/audio/m5.ts` currently listens for guessed names (`Transit`, `RiftIn` / `RiftOut`, `WallOn` / `WallOff`, `Capture`, `Grab`, `Place`, `Shrug`, `Spit`, `Recycle`, `Overflow`, `Stasis`, `Thaw` …). The real ones are above: rift in/out = `Teleport` / `Emerge`, overflow bonk = `Bounce`, wall zip = `Barrier` mag, coil fire / dud = `Boost` mag 3 / 0, coil ready = `Charged`, stasis engage / release = `Engage` mag on a STASIS FIELD, body ting = `Freeze`, tractor capture / release and gripper close / open = `Attach` / `Release`, shrug = `Jam` on a GRABBER, recycle pop = `Despawn` on a SINGULARITY, spit = `Launch` on a SINGULARITY, collapse = `Collapse`, spin-up = `Engage` on a SINGULARITY. Strain / overload are flags (`fault`), not events.

## For R5 (rendering) and U5 (UI)

- **Flags (`PartFlagBits`).** RIFT GATES: `lit` while paired, `armed` during the pair's cooldown (LEDs at 30 %), `pressed` 0.2 s at a transit (both gates). GRAV WELL: `lit` while its field is on. TRACTOR BEAM: `lit` while it carries something, `fault` on strain. HOVER PAD: `lit` while hovering, `fault` while overloaded (sag past 1 cm). FORCE WALL: `lit` while on (its field visual is `when: 'lit'`). COILGUN RING: `lit` while charged and powered, `pressed` 0.12 s at a kick. STASIS FIELD: `lit` while engaged (volume visual `when: 'lit'`). BUZZ BEACON: `pressed` 0.3 s at a call, `powered` while its BUZZ is docked, `armed` while BUZZ is away. SINGULARITY: `armed` while active, `lit` once spun up (0.5 s), `pressed` 3 s after the collapse (the cap vents). GRABBER: `lit` while holding, `fault` during the shrug.
- **Meters (`partMeters`, 1–21 like CELL unless stated).** COILGUN RING charge; TRACTOR BEAM load of 2 kg; HOVER PAD load of 10 kg (k·sag / g); SINGULARITY seconds left + 1 while active (7 → 1), 1 once spent ("0").
- **`Machine.grabberJoints()`**: 8 floats per GRABBER, part order: [part index, yaw, shoulder, elbow, wrist pitch, wrist roll (0), finger opening per side (m), held 0 / 1]. Joint conventions: yaw about +Y from the front (+Z); shoulder, elbow, wrist pitch tilt the next link from vertical toward the arm's forward direction (about local +X); all 0 = the upright park pose. The link bodies (role `piece`, chunk 0 upper arm, 1 forearm, 2 gripper) carry the same poses for anything drawn per body; they have no `on: 'piece'` visuals.
- **Other `piece` bodies:** FORCE WALL's field (static; drawn by its `when: 'lit'` base visual or R5's §7.6 effect) and HOVER PAD's lock anchor (an invisible static pin at the placed pose: draw nothing).
- **Pairing:** RIFT GATES pairs are the `pair` colour, 1st + 2nd, 3rd + 4th in part order (U5's pairing arcs can use the same rule). BUZZ BEACON pair colours are `BEACON_PAIRS`.
- **Ports are static** in the def schema: FORCE WALL's `toggle` and STASIS FIELD's `in` sit where they belong at the default size (W 0.6 m; W = D = 0.5 m). A resized part keeps them there (as RAM in M3); a `portsFor(props)` would need U5 + R5.
- **Caps:** PART_SYSTEM's "Singularity 4 per world" isn't modelled in `PartDef` (no `caps` field); the card says it. U5's editor would enforce it.

## BUZZ BEACON interface (contract 3, agreed with B5: M5_NOTES_B5.md)

The beacon is a static part (`buzz_beacon`) with one Signal port, `call`. A5 owns its state; BUZZ reads it, plus one status setter. B5 wires it as `critterHost().beacons` → `self.x.m5` (read structurally).

- **State (plain, in `st.m2.m5`):** per beacon, `calls`, the tick of the latest call and the id of its `Call` event.
- **Read API** on `M5Parts` (`channels/m5.ts`):
  - `beacons(): readonly number[]`: BUZZ BEACON part indices, part order.
  - `beacon(i): BeaconView | null` (null if `i` isn't a live beacon): `part`, `pair` (index into `BEACON_PAIRS`), `dockPos` / `dockRot` (world pose of `socket_dock`, part-local (0, 0.040, 0), facing part-local +Z, the port side), `calls`, `callTick` (−1 none), `callCause` (the latest `Call` id), `padItem` (a pushable body's part whose centre is over the pad disc, r ≤ 0.10 m, ≤ 0.25 m above it; −1 clear; never a critter or a ghost-layer body).
- **Pending call:** BUZZ keeps its own `served` count; a call is pending while `calls > served`.
- **Status setter:** `setBeaconStatus(i, s)`: 1 docked, 2 away (0 = none reported). Stored in `st.m2.m5` (rollback-safe); drives the beacon's flags only.
- **Calls arrive in stage 2**; critters think in stage 6, so BUZZ sees a call in the same tick.
- **B5's requests, done:** RIFT GATES and every other M5 mechanism skip critters and ghost-layer bodies (`eachLive`: A3's `eachPushable` minus bodies on the ghost layer at run time, so a carried item is never pushed, transited, frozen or gripped); the SINGULARITY never removes a critter (BUZZ included).

## Ports (E5a: the art must match)

| Part | Ports |
|---|---|
| RIFT GATES | none |
| GRAV WELL, TRACTOR BEAM, HOVER PAD, COILGUN RING, STASIS FIELD | `in` power |
| FORCE WALL | `toggle` signal in |
| BUZZ BEACON | `call` signal in |
| SINGULARITY | `arm` signal in |
| GRABBER | `in` power, **`go` signal in**. The brief names both `PORT__power__in` and `PORT__signal__in`; port names must be unique (`portIndex` is a name map), so the signal port is `PORT__signal__go`. **E5a's table still lists `signal:in`: please rename it.** |

## Determinism (M5 rule 14)

- **Re-derived after a restore:** FORCE WALL field layers (static / ghost) and HOVER PAD lock enables, from `st.m2.m5.on` and `alive`. The FORCE WALL test fails without its re-derivation (checked by removing it). **Finding:** the HOVER PAD test passes even without its re-derivation: jolt-physics 1.1.1's `SaveState` does record constraint enables (Jolt's `Constraint::SaveState` writes `mEnabled`). Object layers and gravity factors it doesn't. The re-derivation stays (cheap, and rule 14 asks for it).
- **Nothing to re-derive:** STASIS (forces and velocities every tick, ZONE's way), the fields, the GRABBER (kinematic links posed from plain joints every tick; the held body is a normal dynamic body tracked by velocity), RIFT transits (`SetPositionRotationAndVelocity` + a cooldown tick in `st`), SINGULARITY despawns (A3's pool `despawn` and the Machine's `kill`, which already restore).
- **Never pushed (rule 8):** everything goes through `eachLive`. Tested: a SINGULARITY placed next to a FABRICATOR's parked pool leaves every dormant body exactly where it was.
- **Transits** take only free bodies: dynamic bases of parts with no hinge arm, slider, piece or pool, not tied by an intact LINE, not a seated HELIO, not a HOVER PAD; live pool slots; broken parts' chunks. Critters don't transit (`eachLive` skips them; open item below).
- **Power topology:** SIMULATION §5.5 lists "Rift moves" as a topology change. Components are union-find over cable links, which follow parts, not positions, so a transit changes nothing and `powerTopology` isn't rebuilt: a powered part keeps its supply through a gate.
- **Tested:** rollback across a transit, a freeze, a beam hold, a coilgun kick, a rising HOVER PAD and a GRABBER mid-carry (restore to 0 and to 60 from later ticks); FORCE WALL layer and HOVER PAD lock both ways; GRABBER and SINGULARITY across despawns. Hashes are identical at 1 and 4 Jolt threads (the M5 goldens, rule tests and fuzz at `KNOCKON_JOLT_THREADS=4`). 60 Hz: every M5 demo and fuzz scene runs and stays under 60 m/s.
- **The M5 hash block** is added only when the machine has an M5 part: every M1–M4 golden is bit-identical.

## Deviations from the specs

- **RIFT GATES trigger:** "a body whose centre crosses gate A's plane" can't happen with the brief's closed backplate 2.2 cm behind the membrane (a Ø 0.075 STITCH would stop with its centre 6 cm out). A body transits when its leading surface reaches the membrane within the step. The mapping is a 180° turn about the gate's up axis (handedness kept), not a reflection; position is mirrored across (x → −x).
- **STASIS FIELD** (D103): ZONE's approach, not kinematic; it also drops the tick's other forces, so a frozen body ignores wells and beams. Velocity isn't restored on release: bodies drop from rest.
- **FORCE WALL** (D103): static ↔ ghost layer, not Activate / Deactivate.
- **HOVER PAD:** a soft horizontal spring holds it over its base point (the spec has only the vertical one; without it a loaded pad drifted). A sphere on a pad loaded off-centre to 10 kg creeps off after ≈ 3.5 s: the lock (a soft Jolt constraint) holds the deck level to ≈ 0.1°, enough to roll a ball.
- **TRACTOR BEAM** has no occlusion test: it reaches through things in its cone.
- **GRABBER:** signal port `go` (above); zones are props, not world picks; links collide as capsules / boxes (kinematic: they push what they touch); the fingers don't close (the hold is a velocity lock; `grabberJoints` gives the finger opening for the art); zone reach is capped at 0.30 m because the gripper points down.
- **BUZZ BEACON** has no flight logic: BUZZ is B5's. Its demo shows only the call; BUZZ's demo shows the flight.
- **Collision** is a blockout of primitives until each part's `.shapes.json` is read (as in M3 / M4).

## Reports to other streams

- **E5a:** rename GRABBER's `PORT__signal__in` to `PORT__signal__go` (above). Everything else in your table matches the defs (positions converted to engine space).
- **W5:** `zeroGZones` runs after the M5 fields (end of stage 6) and cancels gravity for every body in a zero-g zone. TRACTOR BEAM (captured bodies) and STASIS FIELD (frozen bodies) cancel gravity themselves, so inside a Hangar zero-g zone such a body gets +1 g net (drifts up in a beam; a frozen one is re-zeroed every tick but creeps ≈ 0.7 mm/tick at 120 Hz). Suggest `zeroGZones` skip bodies the M5 parts hold, or expose an `inZeroG(x, y, z)` A5 can call; tell me which and I'll adapt.
- **U5:** BUZZ's `pair` prop (B5) is an `int` 0–7 while `BEACON_PAIRS` has 6 colours (U5's note); B5's to fix. GRABBER event captions above.
- **F5:** event names above.
- **B5:** critters don't go through RIFT GATES (`eachLive` skips them, and BUZZ is wider than the aperture anyway). If the animal critters (Ø ≤ 0.22) should transit as future.md says, the capsule, its ragdoll and the AI's remembered positions would have to move together: a critter-system hook, after beta if playtests ask.
- **Transient (not mine, seen mid-run, gone on re-run):** `PartFlag is not defined` in `machine.ts` while B5 was editing; F5's `apps/game/src/audio/m5.ts` type errors (`M5LoopKind`) during `pnpm typecheck` at one point.

## Performance

Measured in Node, single-threaded Jolt, CPU shared with the other streams (provisional, rule 11): 500 STITCHes asleep around an idle SINGULARITY cost 0.057 ms/tick; armed, with all 500 pulled in, 2.25 ms/tick in total, almost all of it Jolt stepping 500 awake, colliding bodies. The M5 fields run inside stage 6, so any stage-6 timer in the perf readout includes them; nothing else needs a row.

## Tests

- `goldens_m5.test.ts`: 10 goldens, each run twice with identical hashes and events, behaviour assertions (events, cause chains, flags, meters, joints, poses), pinned hashes. Re-pinned during the stream: only my own `hover_pad` (after the lock and setpoint changes).
- `m5.test.ts`: 15 tests: 4 rollback tests (rule 14) and 11 rules (dormant pool, RIFT cooldown / bounce / unpaired / tethered, GRAV WELL repel, TRACTOR max load, HOVER PAD sag and overload, COILGUN steel-only / once per pass / recharge, STASIS 75 %, GRABBER shrug and supply-scaled speed (≈ 1.6–2× slower at f 0.56), SINGULARITY collapse / single use / critter spat out, the BUZZ BEACON interface).
- Fuzz: 10 entries (8 property sweeps of 20 sets × 2 seeds; HOVER PAD and SINGULARITY scene runs).

## Final check (hand-back)

- `pnpm vitest run packages/sim packages/parts-data`: **569 passed** (31 files).
- M5 goldens, rule tests and fuzz with `KNOCKON_JOLT_THREADS=4`: 35 passed, same hashes.
- `pnpm -s lint`: clean. `pnpm -s typecheck`: clean.
- Re-pins: none of anyone else's. Every M1–M4 golden is unchanged.

## W5 follow-up (added by W5): the Hangar's zero-g zones and the M5 fields
- The zero-g zones (`packages/sim/src/envsets.ts zeroGZones`) run after `fields()` in stage 6 and now skip every body in
  a TRACTOR BEAM's captured set or a STASIS FIELD's frozen set (`st.m2.m5.inside`, read only; `m5_field.ts` unchanged), so
  a held / frozen body in a zone feels net 0 g, not +1 g. Global wind skips STASIS-frozen bodies too. Test:
  `space_env.test.ts` "zero-g zones with the M5 fields" (it fails without the skip: the held STITCH rises 9.3 cm).
