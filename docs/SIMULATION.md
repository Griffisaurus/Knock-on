# KNOCK-ON Simulation

Status: v1.4 · 2026-10-25 (as built through M5: the Future Tech parts, BUZZ, global wind, zero-g zones, the D101 water buoyancy, goo and world-following Matter gravity) · Owner: Sim Lead · Code: `packages/sim/src/` (`machine.ts`, `channels/`, `critters/`, `matter/`)
Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [PART_SYSTEM.md](PART_SYSTEM.md) · [MULTIPLAYER.md](MULTIPLAYER.md) · [GAME_SPEC.md §5–6](../GAME_SPEC.md)

> **The contract:** `outcome = f(runSnapshot, simVersion, seed, inputLog, simFlags)`. Same inputs give the same bits on every supported browser, OS, CPU and GPU. Everything in this document serves that contract.

---

## 1. Units and constants

| Quantity | Unit / value |
|---|---|
| Length | metre (world float32); 1 cell = 0.1 m |
| Tick | **1/120 s** (machines may choose 1/60 s at creation; fixed thereafter) |
| Gravity | 9.81 m/s² × gravity % (GAME_SPEC §5.4) |
| Air density | 1.225 kg/m³ × air % |
| Doc positions | i32, 1/64 cell = 1.5625 mm (DATA_FORMATS §1) |
| Hash quantization | position 1e-5 m, rotation snorm16 (velocities aren't hashed as built, §10.4) |
| Matter fixed point | 1 unit = 1/65,536 m; velocities in units/tick |

---

## 2. Tick pipeline

Every tick runs these stages **in this exact order**, on the sim worker's gameplay thread. Jolt's internal parallelism happens inside stage 8 only.

| # | Stage | What happens |
|---|---|---|
| 0 | **Inputs** | Apply input-log entries (pokes) for this tick, ordered by `seq` |
| 1 | **Timers** | Ringer, Delay, Hourglass and fuse-burn countdowns advance. Due scheduled actions fire. |
| 2 | **Signal** | Resolve pulses from last tick's sensors and timers through the signal graph (§5.2) |
| 3 | **Power** | Solve circuit components, then set consumers' supply factor (§5.5) |
| 4 | **Light** | Cast beams, apply reflect/refract/split/focus, update light receivers (§5.6) |
| 5 | **Heat** | Accumulate exposure, then ignite, burn, melt, douse (§5.7) |
| 6 | **Behaviours + AI** | Part behaviour `preStep` (motors, valves, thrusters), wind and field forces (§5.8, §5.12), critter think (staggered) + steering (§7) |
| 7 | **Matter coupling** | Apply Matter impulses scheduled for this tick (§8.5) |
| 8 | **Physics** | `PhysicsSystem::Update(dt, collisionSteps = 1)` (Jolt, multithreaded) |
| 9 | **Contacts** | Harvest buffered contacts, **sort by (partIdA, partIdB, subShapeA, subShapeB)**, then Impact channel: sensors, damage, pops, cuts, sound events (§5.1) |
| 10 | **Constraints** | Rope tension and breakage, gear jam detection, soft-body pop checks |
| 11 | **Explosions** | Resolve queued detonations (≤ 32/tick, ordered by (tick queued, partId)), apply impulses, damage, sympathetic queueing (§6) |
| 12 | **Spawn / despawn** | Fracture replacement, Fabricator spawns, Recycler and Singularity removals, Yolk laying, Rift teleports. New bodies are created in partId order. |
| 13 | **Matter command** | On even ticks: write the rigid collider snapshot + Matter tick command (§8.5) |
| 14 | **Output** | Flush events, write transforms (live ring + bake keyframes), hash every 60 ticks, checkpoint every 60 ticks |

**No stage may read state written later in the same tick**, except where explicitly documented (Signal → Power → Light → Heat are intentionally same-tick).

*As built:* `Machine.step()` (`machine.ts`) runs stages 0–13 in this order; after Jolt's step it gathers the contact buffer in canonical order (stage 9), lets the critter system handle ragdoll triggers and traps, then stages 10–13. Stage 14 belongs to the caller: the sim worker reads `changedTransforms`, part state and events into its BakeStore, posts frames, and hashes every 60 ticks (`sim.worker.ts`); `Machine` checkpoints itself at the start and every `checkpointEvery` ticks (§11).

---

## 3. Building the run world

On **LET IT RIP**, the sim worker receives the run snapshot (canonical binary, parts sorted by `id`) and builds a fresh Jolt world:

1. Create the `PhysicsSystem` with tier-sized limits (max bodies up to 1,048,576; body pairs and contact constraints scaled by tier). *As built* (`joltCapacity`, parts-data `presets.ts`): 8 body pairs and 4 contact constraints per part, up to 2^21 and 2^20 (`BODY_PAIRS_MAX`, `CONTACTS_MAX`), and never below 1.5× the start-state contact estimate (A3). When those buffers fill, Jolt silently drops contacts, and with job threads *which* ones it drops varies from run to run, so the buffers must cover what can be awake at once (D116).
2. **Shape cache:** shapes per (type, size, mirror) are built once (from `.shapes.json`) and shared.
3. Bodies are created **in ascending partId order** with `BodyInterface::CreateBody` into a batch, then `AddBodiesPrepare/Finalize`. Static parts are merged into a **StaticCompound per 32 m chunk** (a canonical chunk order, children in partId order) to keep body counts down.
4. Constraints, soft bodies, ragdolls and vehicles are created in partId order, then link order.
5. `OptimizeBroadPhase()`, then save **checkpoint 0** (§11).
6. **Run cache:** if the doc hasn't changed since the last run (same `worldSeq`), skip 1–5 and restore checkpoint 0 instead. That's the common "stop, run again" loop.

Budget: Room world < 150 ms. Megastructure (1M parts) ≤ 8 s on an 8-core CPU, with a progress bar.

> Why fresh each time: Jolt is deterministic for identical API call sequences. An incrementally edited world would carry insertion and removal history, so two clients (or one client before and after a reload) could diverge. A canonical rebuild removes history from the equation.

*As built:* the worker's `start` message carries the confirmed part and link records (D72), not snapshot bytes. Jolt's capacities and heap are sized to the world (`joltCapacity`, `contactEstimate` in `capacity.ts`; `joltHeapMB` in `parts-data/src/presets.ts`). Each static part is its own static body, with its shapes in a `StaticCompoundShape` cached per (type, props) and shared; there are **no 32 m static chunks**. The environment set's colliders become one static compound per physics material (D75, `buildSet`), and Backlot terrain a `HeightFieldShape` per 32 m chunk. Breakable pieces and pooled spawns (fracture chunks, corks, YOLKs, FABRICATOR stock) are pre-built dormant at world creation, so a rollback never creates or destroys bodies (D66). The **run cache** (step 6) isn't built: every run rebuilds.

---

## 4. Jolt integration

### 4.1 Settings

| Setting | Value | Note |
|---|---|---|
| Build | `JPH_CROSS_PLATFORM_DETERMINISTIC`, WASM threads, no FMA contraction (`-ffp-contract=off`) | Planned as a pinned custom build (`packages/jolt/BUILD.md`, never written). As shipped (M4, D99): jolt-physics 1.1.1's prebuilt threaded build. Its heap is **fixed** (no growth): the loader rewrites the binary's memory to the size `joltHeapMB` gives the world (`packages/jolt/src/load.ts`). A browser whose helper workers don't start within 10 s uses the single-threaded build. |
| Heap (J5, M5) | `joltHeapMB(parts, contacts)` (`parts-data/src/presets.ts`): 128 MB up to 2,000 parts; above, the **all-awake worst case**: the Machine's build (≈ 560 B per part, 500 B per contact slot, 64 B per body-pair slot, plus Jolt's temp allocator at ≈ 512 B per contact slot) + the rollback ring of in-heap checkpoints, all awake, plus two (≈ 1.2 KB per awake body each: 600 B of saved state at up to 2× recorder slack) + 64 MB; 64 MB steps, capped at 4,032 MB. The threaded worker rounds it up to a power of two (+ 32 MB + 2 MB per thread in the loader) | Measured high-water marks, every part awake in a dense pile: 20k parts 385 MB, 50k 1.27 GB, 100k 2.14 GB, 400k 2.08 GB ([M5_NOTES_J5](dev/M5_NOTES_J5.md)). The size never changes results (`packages/sim/test/heap.test.ts`). A run that outgrows even the cap (≈ 7.4 GB all awake at 1M parts) stops with "This machine ran out of physics memory"; the sim worker is replaced (§11) |
| Velocity / position iterations | 10 / 2 | Increased per-body for gears and chains via constraint overrides |
| Speculative contact distance | 0.01 m | Small parts |
| Penetration slop | 0.004 m | |
| Sleep | time 0.5 s, velocity 0.03 m/s | |
| Motion quality | `LinearCast` for Rollers ≤ ⌀0.12 m, projectiles, marbles | CCD |
| Threads | `hardwareConcurrency − 3`, clamped 2..12 (the main thread, the sim worker and the browser keep a core each; `joltThreadsFor`, `apps/game/src/sim.worker.ts`; ARCHITECTURE §2) | Results must not depend on the count; J4 verified 1/4/12 threads in Node and Chrome (D99) |

### 4.2 Layers

*As built (`machine.ts`: `L_STATIC = 0, L_MOVING = 1, L_GHOST = 2`; an `ObjectLayerPairFilterTable(3)` over two broadphase layers):*

| Object layer | Collides with | Used by |
|---|---|---|
| `STATIC` | MOVING | Static parts, the environment set compounds, terrain heightfields, the floor |
| `MOVING` | STATIC, MOVING | Dynamic parts, fracture chunks, critter capsules and ragdolls, live pieces |
| `GHOST` | nothing | Bodies out of play: dormant pool pieces and chunks, items a critter carries (Bandit, and BUZZ in M5), disabled ragdoll parts, a switched-off FORCE WALL (M5, D103) |

Switching a body between layers is how things leave and enter play. Jolt's saved state doesn't record layers, so every system re-derives them in `afterRestore` from plain state (the Bandit-steal lesson, M3; M5 rule 14), and hidden bodies are never pushed (`Machine.hiddenBody`, M3). Sensors are contacts, overlap tests and ray casts in the stages, not a layer. Finer filtering uses Jolt collision groups (critter ragdolls, GLIDEPATH riders vs the rails); meshed cogs avoid each other by colliding on their pitch circle minus 8 mm (D55). There is no Matter proxy layer: proxies are built from body shapes each command (§8.5).

*Original design (not built):* separate `DEBRIS`, `CRITTER`, `SENSOR` and `MATTER_PROXY` layers, and two object-layer bits reserved for collision lanes (the reserved `lanes` sim flag stays in the format, ARCHITECTURE §9).

### 4.3 Physics materials

| Material | Friction | Restitution | Notes |
|---|---|---|---|
| `powder` | 0.50 | 0.25 | Default device housings; Thud and Stitch shells |
| `rubber` | 0.90 | 0.60 | Feet, bumpers, Boing; Bumper part overrides e = 1.2 (active) |
| `steel` | 0.40 | 0.20 | Pig Iron, Bearing marbles |
| `wood` | 0.50 | 0.25 | |
| `glass` | 0.20 | 0.15 | Pane, Fishbowl, Glint marbles |
| `paper` | 0.60 | 0.10 | |
| `brick` | 0.70 | 0.10 | |
| `latex` | 0.60 | 0.40 | Helio |
| `fur` | 0.70 | 0.10 | Critters |
| `ceramic` | 0.25 | 0.20 | Vase, Yolk shell |
| `fabric` | 0.80 | 0.15 | Fuzz felt, satchels |
| `concrete` / `soil` / `regolith` | 0.75 / 0.85 / 0.80 | 0.10 / 0.05 / 0.05 | Environment ground (heightfields). `concrete` and `regolith` arrived with the Hangar and Moon sets (M5); there is no `soil` in the code |
| Ball overrides | see the ball table below | | |

Combine rule: friction = geometric mean; restitution = max. Both are fixed in the contact listener.

*As built:* a part's friction and restitution come from its def (`body.friction`, `body.restitution`, `packages/parts-data/src/defs*.ts`), so the table above is the authoring guide for them. Environment set colliders use the table in `Machine.buildSet` (`machine.ts`): powder 0.5 / 0.3, wood 0.5 / 0.35, ceramic 0.4 / 0.2, steel 0.4 / 0.2, glass 0.3 / 0.2, rubber 0.9 / 0.6, paper 0.6 / 0.1, fabric 0.8 / 0.1, concrete 0.75 / 0.1, regolith 0.8 / 0.05.

**Balls (Rollers).** Every ball sets its material and per-shape overrides explicitly (source: art/briefs/rollers.md; mirrored in the part defs, `packages/parts-data/src/defs*.ts`, D58):

| Ball | Material | Friction | Restitution | Mass |
|---|---|---|---|---|
| THUD | `powder` | 0.30 | 0.12 | 7.0 kg |
| BOING | `rubber` | 0.60 | 0.82 | 0.6 kg |
| STITCH | `powder` | 0.45 | 0.50 | 0.15 kg |
| FUZZ | `fabric` | 1.20 | 0.70 | 0.058 kg |
| PIG IRON | `steel` (magnetic) | 0.40 | 0.10 | 6.5 kg |
| GLINT | `glass` | 0.30 | 0.60 | 0.0054 kg |
| BEARING | `steel` (magnetic) | 0.25 | 0.65 | 0.0167 kg |
| YOLK | `ceramic` | 0.50 | 0.15 | 0.055 kg (breaks at J ≥ 0.3 N·s) |
| HELIO | `latex` | 0.60 | 0.40 (material default) | 0.004 kg + toy-helium lift (§5.1) |

### 4.4 Part → Jolt mapping (summary; per-part detail is in PART_SYSTEM)

| Kind | Jolt objects |
|---|---|
| Static device | Its own static body (as built; §3), not a child of a chunk StaticCompound |
| Dynamic device | Body (compound of shapes); mass from the part def (override), inertia from shapes |
| Hinged device (Fulcrum, Flap, Bonker, Paddle, Snaptrap, Flinger, Sprinkle Can tilt) | Static base + dynamic arm + `HingeConstraint` with limits (and motor for powered ones) |
| Rotator (Cog, Turbine, Waterwheel, Spindeck, Hamster wheel, Pedal Rig crank, Dynamo rotor) | Body + `HingeConstraint` to the base. Sources use the hinge **velocity motor** with max torque |
| Gear mesh | `GearConstraint` between the two hinges, ratio = −N₁/N₂ (bevel: same, with axes at 90°). *As built (D61):* a pure velocity coupling with ratios always ≥ 1 (the smaller gear first), 24 velocity / 6 position iterations |
| Band (belt) | `GearConstraint` with ratio = r₁/r₂ (crossed: negative). *As built (D61):* a belt flips the second hinge axis instead of using a negative ratio |
| Rack | `RackAndPinionConstraint` |
| Linear (Ram, Lift, Pinger, Punchline) | `SliderConstraint` with position motor and limits |
| Line | `DistanceConstraint` (min 0, max L) or `PulleyConstraint` (§5.4); Bungee: distance spring |
| Glidepath | `PathConstraint` (Hermite path from the link spline) for carts; balls ride the rail collider. *As built:* the rails collide as static boxes, and a rail follower of our own (stage 6, `channels/glidepath.ts`) keeps riding marbles on the line; the JS bindings can't build a Hermite path |
| Helio | Soft body with pressure (`SoftBodySharedSettings`); lift is the constant toy-helium force (§5.1), not a volume buoyancy. *As built:* a rigid body (effective mass 0.08 kg, gravity factor 0.05, D52) with `sk_inflate` as a render-only shape key; no soft bodies are used anywhere |
| Zippy | `VehicleConstraint` with a `WheeledVehicleController` (M4, `channels/m4_vehicle.ts`) |
| Critter | Character body (capsule, motion type dynamic) ↔ Ragdoll (§7.4) |
| M5 Future Tech | `channels/m5.ts`, `m5_field.ts`, `m5_rift.ts`, `m5_misc.ts`, `m5_grabber.ts` (state in `st.m2.m5`): fields are forces on rigid bodies only (D102); FORCE WALL's field is its own static body (role `piece`) switched between the static and ghost layers; HOVER PAD is a dynamic body on a SixDOF lock to an invisible static anchor; GRABBER is a static base with 3 kinematic link bodies; STASIS FIELD and RIFT GATES as in §5.12 |

### 4.5 Contact handling
- Jolt calls `OnContactAdded/Persisted` from worker threads. We **only buffer** them and set material combine and surface velocity (Treadway).
  - **As built (M4, D99):** each Jolt thread imports the same-origin `packages/jolt/src/contact-script.js` through the threaded glue's `configureWorkerScripts` hook. Its callback copies each contact into a record in the shared WASM heap: body pair, sub-shapes, point, normal and a per-thread sequence number. It also sets the belt speed from a table written before the step.
  - **Order within a pair:** Jolt reports all of one pair's contacts from a single call on one thread. The per-thread sequence therefore keeps their order, which is what makes the result identical to the old single-threaded order.
  - **Buffer, not arrays:** this replaces the per-thread arrays and previous-tick impulses originally specified here.
- After the step, the gameplay thread merges, **sorts canonically** (by body pair, then by that per-pair order), and dispatches. Behaviour code never runs inside Jolt callbacks.
- **Proof:** hashes are identical at 1, 4 and 12 threads in Node and Chrome (`packages/sim/test/threads.test.ts`; `KNOCKON_JOLT_THREADS=N` runs any test, soak or bench threaded).
- **Treadway:** `ContactSettings::mRelativeLinearSurfaceVelocity` is set from the belt's driven speed (ω·r along its axis), the same technique as Jolt's conveyor sample.

---

## 5. Channel systems

### 5.1 Impact
- Every harvested contact carries an impulse estimate J (N·s). Behaviours subscribe to their sensors and bodies with thresholds (`SENSOR__trigger__*` threshold from `.art.json`).
- **Damage:** breakables accumulate `max(0, J − J_safe)` per contact. They break when cumulative damage ≥ `hp` or a single hit ≥ `J_break` (§6.2).
- **Pops** (Helio): contact with any sub-shape tagged `sharp` (per-shape authoring property, ASSET_PIPELINE §3.4: e.g. Cog teeth, the Cork Blaster cork), exposure to any heat source (§5.7), or a relative contact speed > 6 m/s (`kn_pop_speed`). An Inflator over-pressure also pops it (§5.8). There is no impulse rule: a 4 g balloon never builds a meaningful J.
- **Helio lift ("toy helium"):** a constant upward force `F = 4.9 N × air%` at the body centre (≈ 0.5 kg-equivalent at Earth gravity), plus normal gravity on its 0.004 kg mass. It is a gameplay constant, not volume × air density: one full Helio slowly lifts an empty Scoop (0.45 kg). The rigid body uses an effective mass of 0.08 kg with gravity factor 0.05 plus quadratic drag 3.4·|v|·v, for solver stability ([D52](dev/DECISIONS_2026-10-24.md)). Lift scales with fill (`sk_inflate`, 0–1) while an Inflator is filling it. At air 0 % (Moon Base) Helios sink.
- **Sound events:** contacts with J above a material-pair threshold emit `Impact {materialA, materialB, J, point}` (for audio and critter hearing).

### 5.2 Signal
- Signals are **pulses**. A source fires on a rising edge (Stomp Pad weight crosses threshold, Button pressed, Toggle flipped either way, Tripwire state change, Ringer reaches zero, Recycler count reached, Hourglass empty).
- **Propagation:** within the same tick, by BFS over the wire graph in partId order. Each node fires at most once per tick (cycle guard). **Delay** schedules a pulse `d` ticks later (`d = round(seconds × tickRate)`). **Ping** pairs act as a wire.
- **Receivers** have a mode property: `trigger` (one action per pulse: Punchline, Snipper, Flinger, Bangstick detonator, Inflator valve) or `toggle | on | off` (stateful: Mains, Flap, Force Wall, Torch).

### 5.3 Spin
- Sources: hinge velocity motors with a target ω and a max torque (Turbine and Waterwheel are driven by forces, not motors):
  - **Motor:** no-load 1.5 rev/s (9.42 rad/s), stall torque 30 N·m, both × supply factor f (§5.5). Its 120 W electrical demand at 60 % efficiency gives a peak shaft power of ≈ 71 W (τ_stall · ω₀ / 4). Direction is a property.
  - **Hamster Drive:** wheel 5.0 rad/s (Pip's 0.6 m/s sprint on the 0.12 m running radius), stall torque 40 N·m (≈ 50 W peak shaft power: toy-strength, so a Hamster Drive into a Dynamo yields ≈ 30 W and dimly lights a Lamp), for a 6 s sprint per bump. Pip's states in the wheel: asleep at rest (no spin) → bumped (the drive's bump sensor) → startled → 6 s sprint (Spin source on) → 1 s coast (motor off, the wheel spins down freely) → asleep. Idle never spins (§7.3).
  - **Pedal Rig:** crank 1.0 rev/s at Bandit's 1× clip; the flywheel and output port turn 3:1, at 3.0 rev/s (18.85 rad/s); stall torque 25 N·m at the output (≈ 118 W peak shaft power, so a Pedal Rig into a Dynamo yields ≈ 70 W and fully lights a Lamp); 8 s of pedalling per stimulus (a shiny Lure in range or on the bait hook, or a Sound startle; §5.10, §5.11), then the flywheel coasts.
- Transmission is **real constraints** (GearConstraint, belts as gear constraints), so torque, load and stalls happen naturally.
- **Jam detection:** if a gear or belt constraint's impulse magnitude exceeds `jamImpulse` for ≥ 30 consecutive ticks while connected sources are at max torque, the component is marked **jammed**. That emits `Jam` (fault LEDs and amber sparks). It clears when the impulse drops below 50 % of the threshold for 30 ticks.
- Consumers read ω from their hinge: Treadway surface speed, Gotcha Box crank revolutions, Dynamo watts (§5.5; the Dynamo brakes its input shaft by the power it delivers).

### 5.4 Tension
- A Line has a fixed length `L` (set at authoring, from the path) and an ordered path through Sheaves and Anchors.
- **Two dynamic endpoints, no sheaves:** `DistanceConstraint(min 0, max L)`.
- **With sheaves** (static in v1): the path is A → P₁ … Pₙ → B. The middle length `M = Σ|Pᵢ Pᵢ₊₁|` is constant, so a Jolt **`PulleyConstraint`** with fixed points P₁, Pₙ and length `L − M` is exact.
- **Endpoint on a static anchor:** a distance constraint to the world.
- **Bungee:** a distance constraint with a spring (`frequency 2 Hz, damping 0.3`) beyond rest length. **Chain:** same as Line, with 4× visual mass, a higher break impulse, and no burning (steel: fireproof).
- **Cutting:** Snipper jaw sensor overlap with a rope segment while closing; Heat exposure ≥ 1.5 s on any Line or Bungee segment (Chain is fireproof); constraint impulse > `breakImpulse` (Line 400 N·s, Chain 2,000). The constraint is removed, and a `Cut {linkId, point}` event lets the renderer spawn the two cosmetic loose ends.
- Ropes **do not collide** with bodies in v1 (only the cosmetic verlet does). Wrapping around arbitrary geometry is out of scope; route ropes over Sheaves. *As built:* the editor draws two LINE links meeting at a sheave's axle port, and the sim pairs them into one `PulleyConstraint` (D57); the cosmetic rope verlet isn't built (RENDERING §0).

### 5.5 Power
- Power components are union-find over cable links (in partId order), rebuilt only when topology changes (Toggle flips, part breaks or despawns, Rift moves). Cables can't be cut.
- **Toggle:** while on, it joins the components on its `in` and `out` ports into one; while off they are separate. A flip (a knob hit ≥ 0.03 N·s, harvested in stage 9) is a topology change, applied in stage 3 of the next tick together with the Signal pulse it fires (§5.2).
- **Supply S:** Mains 500 W (if on) · Dynamo (below) · Suncell `150 × lightIntensity` W · Cell 200 W while `charge > 0` (charge −= W·dt).
- **Dynamo (no free energy):** available output `W = min(300, 40·|ω|, 0.6 · P_shaft)`, where `P_shaft` is the shaft power delivered to its input hinge over the previous tick. The power actually drawn from it, `P_drawn = W · min(1, D/S)` (its share of the component's demand), applies a braking torque on the input hinge `τ = P_drawn / (0.6 · max(|ω|, 1 rad/s))` (60 % efficiency). So a Motor (≈ 71 W peak shaft power) driving a Dynamo yields ≤ 0.6 × 71 ≈ 42 W, and a Dynamo can't power its own Motor.
- **Demand D:** sum of rated watts of consumers that are switched on: Motor 120, Gale 60, Lamp 40, Lance 30, Maglock 150, Arc Tower 400, Toast Cannon 200, Lift 150, Ram 100, Grabber 100, Hover Pad 120, Grav Well 250, Tractor Beam 180, Stasis 220, Coilgun Ring 300, Blowout 80, Vac 90, Flamer 80 (powered mode only; in its default Signal mode it is gas-fed and draws nothing). The Fabricator and Inflator are Signal-only and draw no power.
- **Supply factor** `f = D == 0 ? 1 : min(1, S/D)`. Continuous consumers scale by f (motor torque and speed, fan strength, lamp intensity, Grabber playback speed). Threshold consumers need f ≥ 0.75 (Toast Cannon, Maglock hold, Arc Tower, Stasis).
- Overload (f < 0.5 for 1 s) emits `Brownout` (amber LEDs).

### 5.6 Light
- **Beam emitters:** Torch (cone 20°, i.e. 10° half-angle; 9 rays: 1 centre + 8 at the half angle), Lance (1 ray). Each ray marches up to **8 interactions**, max length 30 m. Global cap: 1,024 ray segments per tick (beyond that, emitters in partId order are skipped and a warning emitted).
- Interactions:
  - **Mirror:** reflect about the surface normal.
  - **Splitter:** 3 child rays, one straight on and two at ±12° about the splitter's up axis, each at 1/3 intensity.
  - **Burning Glass:** the ray continues, converging to a **focus point** at distance `f` along the beam, on the far side from the incoming light (mirrored for light from behind). `f` is the focal-length property: 0.1–1.0 m, step 0.01, default 0.3 m.
  - **Glass and poly:** pass through at 90 % (no refraction offset in v1).
  - Opaque: stop.
- **Omni emitters** (Lamp): each light receiver within 6 m gets `intensity × (1 − d/6)²` if an occlusion ray is clear.
- **Receivers:** Suncell (sum of incident intensity, normalised), Tripwire (beam blocked or lit, edge-triggered). **Focus points** feed Heat (§5.7).

### 5.7 Heat
- **Flammables** have `igniteTime` (seconds of exposure): Fuse 0.05, Bangstick fuse tip 0.05, Wick 0.2, Line and Bungee 1.5 (burn = cut; Chain is fireproof), Plank 4.0 (burn → break after a further 6 s), Paper items 1.0, Powder Keg cook-off 1.5 (→ detonate, §6.1), Helio 0 (any heat source pops it).
- **Heat sources** (spheres or cones, per tick): Wick flame (the 25 mm hot core: capsule r 0.02 m above the wick), Fuse spark head, Flamer cone (0.6 m long, end radius 0.06 m), Blowout hot-air cone (2 m, the same cone as its wind, §5.8), focus point (radius 0.02 m, requires the beam to hit within ±0.03 m of `f`), fireball (explosion radius × 0.4 for 0.3 s), Arc Tower strike points (below), Skyrocket exhaust (0.25 m plume while thrusting). Visual effects may reach up to 1.3× these gameplay extents (art/briefs/vfx.md; the Wick's 40 mm visual flame over its 25 mm core is an accepted exception); the heat test always uses the gameplay extent.
- **Arc Tower:** after a 0.5 s charge with supply factor f ≥ 0.75, it strikes the nearest metal body (physics material `steel`) whose centre is within 2 m of the toroid (ties by partId) every 0.25 s while f stays ≥ 0.75. Each strike is a heat source (sphere r 0.03 m at the hit point, for 0.1 s) and a `Sound` event (§5.10). It applies no impulse. With no target in range it makes cosmetic brush discharges only.
- **Exposure** accumulates while touching any source and decays at 2× rate when not.
- **Fuse burn:** the burn front advances 0.2 m/s along the spline arc length. Branches burn in parallel. Reaching a `PORT__heat__*` endpoint ignites the attached part. Contact with a heat source mid-fuse starts a second front.
- **Douse:** wind speed > 4 m/s at a flame (from an Air emitter, a Wind zone or the global Wind, §5.8), or Fluid contact, extinguishes Wick, Flamer and burning fuses (fuses become `wet` for 5 s).

### 5.8 Air
- Air emitters own convex sensor volumes; cones are given as length / half-angle: Gale 6 m / 15°, Blowout 2 m / 10°, Vac inverted cone 1.5 m / 20°, Puffer 1.5 m / 20° (impulse; strength ∝ the pad impulse), Popper 1.0 m / 15° (its "30° cone") for 0.15 s, blast waves. The Popper is only an Air puff, never a detonation (§6.1).
- For each overlapping dynamic body (sorted by partId), with one occlusion ray from the nozzle to the body centre:
  `F = ρ · C · s · A · falloff(d)` along the cone axis (Vac: towards the nozzle), where s = emitter strength × supply factor, A = projected area (precomputed per shape set), `falloff = (1 − d/R)²`.
- **Wind (global, D26; shipped in M5, stream W5):** an environment setting of 0–15 m/s with a direction (default 0). Backlot weather presets set it, with seeded, deterministic gusts (detmath of `hash(worldSeed, tick)`; art/briefs/environments.md §4.5). It is a world-wide air-flow term added to every Air calculation: each awake dynamic body gets `F = ρ · C · A · w²` along the wind direction (same C and A as above, no occlusion test in v1), Wind zones add their local flow on top (§5.12), and it counts toward flame dousing (§5.7). A sleeping body is woken only when its wind force exceeds 0.2 × its weight (checked once per second, in partId order).
  - *As built:* the setting is `env.wind = {speed, dir, gusts}` (`packages/format/src/model.ts`): speed 0–15 m/s in 0.1 steps; `dir` 0–359°, the direction it blows **toward** (0 = +X, 90 = −Z); gusts `none | breezy | gusty | overcast`. Absent = no wind (every pre-M5 save). Presets `WIND_PRESETS`: Calm 0, Breezy 3, Gusty 6, Overcast 2 m/s, blowing toward +X (Settings › World › Weather).
  - **Gusts** (`windSpeedAt`): smooth value noise with one knot per period from an integer hash of the world seed and the knot index. Breezy ±1 m/s (9 s), Gusty +0–4 m/s (5.5 s, so 6–10 m/s), Overcast ±0.5 m/s (8 s).
  - **Force** (`globalWind`, `packages/sim/src/envsets.ts`, end of stage 6): every awake pushable rigid body gets `F = 1.225 · air% · A · w²` along the wind, with A from the Gale's projected-area rule (`areaOf`), capped at 40 m/s² of acceleration (as ZONE's wind). Once a second a sleeping body wakes if F > 0.2 × its weight. Above 4 m/s it blows out lit WICKs and douses FLAMERs. Air 0 % (the Moon) means no wind. Critters and STASIS-frozen bodies are skipped; zero-g zones don't change it. The hash carries the setting only when there is wind, so no older golden moved.
  - **Rigid bodies only (D110):** Matter grains feel no wind and no air % (§8.7).
  - **TURBINE (beta, D120):** an intact TURBINE's rotor isn't pushed as plain drag: the wind turns it through its blade pitch (*Rotors* below). The wind is uniform, so each blade sees the axial component w·a (a = cos of the angle between the wind and the rotor axis): `F_axial = 1.225 · air% · A_blade · (w·a)²` per blade (the global term's dynamic pressure on the blade's area), and the torque is `3 · 0.38 · F_axial · r_blade`. Wind on the rotor's front turns it forward, from behind backwards, straight across not at all. Seeded gusts are already in w. The drive fades to zero as the blade speed reaches twice the axial wind speed, and (all wind sources) between 28 and 32 rad/s: past ≈ 35 rad/s the blades' inner ends caught the hub block's speculative contacts and the rotor stopped dead, so that governor keeps it under. A sleeping rotor wakes once a second if the torque is over 10⁻⁴ N·m (about a 0.5 m/s breeze on its face). Its Spin output (BAND to a DYNAMO, etc.) works exactly as with a GALE.
  - **v1 gaps:** scenery (trees, grass, flags) doesn't react; there's no gust preview in the HUD.
- **Rotors:** Turbine blades are pitched 25°, so each blade collider receives a tangential force `F_t = 0.38 × F_axial` (sin 25° · cos 25°), where F_axial is the axial wind force on that blade (emitters + global Wind), applied at the blade centre. That gives torque about the hinge; the axial part goes to the hub as thrust. Waterwheel paddles and other flat blades take the force directly, which is already tangential. *As built:* emitters (GALE, BLOWOUT) and PUFFER puffs since M2 (`channels/air.ts`); global Wind since the beta polish (D120, `turbineGlobalWind`). A toy rotor can't outrun the wind (drive → 0 at a blade speed of twice the local wind) and is governed to ≤ 32 rad/s.
- **Vac hold:** while powered, bodies of ≤ 0.5 kg touching the intake sensor are held on the mouth grille (fixed to the Vac) and released when power stops. Heavier bodies only feel the inward flow.
- **Inflator:** each Signal pulse opens the valve for 2.0 s. While it is open, the Helio on its `fill` link (PART_SYSTEM §3) gains fill at 50 %/s, so one pulse fills an empty Helio (needle in the Volt band). Its lift (§5.1) and `sk_inflate` follow the fill. Fill above 110 % (needle past +90°, the Amber band) pops it, so pulsing a full Helio pops it about 0.2 s later. A Helio on a fill link starts the run empty (no lift), with its knot held on the nozzle while linked.

### 5.9 Fluid
Fluid is entirely the Matter layer (§8). Rigid parts interact via coupling: buoyancy and drag on bodies in water, Scoop and Sponge mass gain (Matter grains captured by intake sensors are counted and despawned; their mass is added to the part). With `matterGameplay` off (and before Matter ships in M4), a breaking Fishbowl makes a cosmetic Spectacle water burst and Goby still flops (§7.3); no Matter water is spawned. *As built (M4):* Matter shipped; floating comes from a backend water-surface map and Jolt's `ApplyBuoyancyImpulse` (D101, §8.6), and the M4 Matter parts (GRIT HOPPER, TANK, SPRINKLE CAN, WATERWHEEL, SPONGE, MARBLE HOPPER, HOURGLASS as a fill-pass display) are in `channels/m4_matter.ts`. New worlds run Matter; files from before M4 load with it off.

### 5.10 Sound
Loud events (explosions, Ringer, Ding, barks, Arc Tower strikes, hard impacts) create `Sound {loudness dB, point}`, with the level given at 1 m: Biscuit's bark 70 dB, Ding 77 dB, Ringer 80 dB, an Arc Tower strike 85 dB, an explosion 120 + 10·log10(Y) dB, impacts by material pair and J (AUDIO §3). Effective loudness at a critter = level − 20·log10(max(d, 1 m)), −12 dB if its one occlusion ray is blocked. A critter receives a stimulus if the effective loudness ≥ its threshold: Henny 50 dB (startle), Biscuit 55 dB (wakes from sleep), Pip 60 dB, Mochi 65 dB, Bandit 65 dB (startle; near a Pedal Rig it sends him to pedal), Dusty 70 dB, Buzz 100 dB (a short startle only: a yield-1 boom within 10 m, a Big Top within 1.8 m; beta, D121). So the Ding startles every critter within 4 m, and a bark startles Mochi within about 1.8 m.

### 5.11 Lure
Lure emitters have per-species weights and radii: seeds → Pip (4 m), shiny parts (steel, chrome, brass or glass bodies ≤ 0.5 kg) → Bandit (5 m), Pip → Mochi (8 m), a flopping Goby → Mochi (10 m), a snack → Mochi (3 m), Mochi → Biscuit (10 m). A shiny Lure within a Pedal Rig's 1.5 m range, or hanging from its bait hook, starts Bandit's 8 s pedal run. Critter AI picks the highest `weight / (1 + distance)` target it can perceive.

### 5.12 Field

**M5 status and contracts (D102, D103):** MAGLOCK and ZONE shipped in M3 (`channels/m3_field.ts`). The M5 parts (GRAV WELL, TRACTOR BEAM, HOVER PAD, STASIS FIELD, FORCE WALL, COILGUN RING, RIFT GATES, SINGULARITY; plus GRABBER and BUZZ BEACON, which aren't fields) shipped in M5 (`channels/m5*.ts`; per-part details in [M5_NOTES_A5](dev/M5_NOTES_A5.md)) to these rules:
- **Rigid bodies only (D102).** GRAV WELL, TRACTOR BEAM, SINGULARITY, STASIS FIELD, RIFT GATES and COILGUN RING act on Jolt bodies, not Matter grains; grains respond only through contact with those bodies. The Singularity despawns bodies, not grains. GOO VAT is the only M5 part that touches grains (§8.7).
- **Rollback-safe switches (D103, M5 rule 14).** Anything Jolt's saved state doesn't record (object layers, gravity factors, motion types, constraint enables) is re-derived in `afterRestore` from plain state, with a rollback test across every switch. That replaces two rows below: FORCE WALL switches its static body between the `STATIC` and `GHOST` layers (deactivating a static body doesn't stop collisions), and STASIS FIELD zeroes velocity and cancels gravity every tick like ZONE's stasis, never switching motion type.
- **RIFT GATES** teleport in stage 12, in part order, with the per-pair cooldown, and a test covers rollback across a transit.

| Part | Effect |
|---|---|
| Maglock | Steel bodies within 0.6 m: `F = k / max(d, 0.05)²` toward the face; hold when in contact and f ≥ 0.75 |
| Grav Well | Radial `F = s · m / max(r, 0.2)²`, ±(attract/repel), radius 5 m. *As built:* 250 W, `mode` Attract / Repel, a = s·f / max(r, 0.2)² from the orb with **s = 4 m³/s²**, capped at 40 m/s²; a sleeping body wakes only if a ≥ 0.05 g |
| Tractor Beam | Range 0.5–3 m (property). Two modes (property): **pull**, a spring-damper to the beam axis that reels bodies toward the emitter at 0.5 m/s; **hold**, a spring to a hold point 0.5–3 m along the beam (default 0.5 m). *As built:* 180 W; bodies in the beam's cone are captured in part order up to 2 kg × f (the rest feel nothing: strain, `fault`); each captured body has its gravity cancelled and a spring-damper (k 40 /s², ζ ≈ 0.8) toward the target, capped at 0.5 m/s along the beam (pull) or 1 m/s (hold). **Occlusion (beta, D121):** one closest-hit ray through Jolt's narrow phase from the lens to each in-cone body's centre of mass, in part order (the beam's own body skipped, ghosts never block): if the first thing it meets is another part, a critter or the set, the body is in the beam's shadow and isn't pulled (nor counted toward the load). A held body shadows the ones behind it; a FORCE WALL switched off (ghost layer) doesn't |
| Hover Pad | Dynamic levitating platform. While powered, its rotation is locked and a stiff vertical spring-damper holds it 0.5 m above its base point (its placed position), with sag ≤ 0.01 m at the 10 kg payload limit. Bodies on the deck ride it. Unpowered, the rotation unlocks and it falls. *As built:* 2.5 kg, 120 W; a SixDOF lock to a static anchor, a vertical spring-damper k 10,000 N/m with its weight fed forward, × f; the setpoint rises at 0.5 m/s; measured sag 9.9 mm at 10 kg (past 1 cm: overload `fault`) |
| Stasis Field | While powered (f ≥ 0.75), bodies inside are held: velocity zeroed and gravity cancelled every tick, ZONE's stasis approach (D103; the original kinematic switch is superseded). Dynamic bodies only |
| Force Wall | Static box body switched on or off by Signal: on = `STATIC` layer, off = `GHOST` layer, re-derived in `afterRestore` (D103; replaces `ActivateBody` / `DeactivateBody`); friction 0.3, restitution 0.6 |
| Coilgun Ring | Steel bodies passing through the ring sensor get Δv = +3 m/s along its axis (once per pass), then it recharges for 0.5 s. *As built:* 300 W, `direction` Forward / Back; the charge fills over 0.5 s × f; a pass is a body's centre in the bore or crossing its mid-plane within the step (fast bodies); a non-steel body or an empty charge is a dud (`Boost` mag 0) |
| Rift Gates | A body whose centre crosses gate A's plane is teleported to B, with position and velocity transformed by B·A⁻¹ (mirrored through the gate). At most 1 transit per 0.25 s per gate pair: bodies arriving during that cooldown bounce off the membrane, and a body can't re-enter within 0.25 s of arriving. Processed in stage 12 by partId. *As built:* `pair` colour (6), gates of a colour pair 1st with 2nd, 3rd with 4th in part order; a body transits when its centre is in the Ø 0.31 m aperture moving into the front, half-extent ≤ 0.155 m; it appears 2 cm in front of B, transformed by B·R·A⁻¹ (R = 180° about the gate's up axis); cooldown arrivals bounce (inward speed × −0.5, `Bounce`). Critters and ghost bodies never travel. Events `Teleport` (A) and `Emerge` (B) |
| Singularity | Grav Well (s = 40, radius 20 m) for 6 s; bodies within 0.3 m of the core are despawned (counted). *As built:* opened once by a Signal on `arm`, ramping up over 0.5 s, capped at 60 m/s², with swirl damping (2 /s) so bodies spiral in; a despawned body leaves play (pool slots return to their pool); critters are spat out (up 4 m/s, out 3 m/s, `Launch`), never swallowed; `Collapse` at 6 s. 4 per world (the editor enforces it) |
| Grabber (M5) | Not a field: a static base with three kinematic links (100 W). Each Signal on `go` queues a pick-and-place cycle (≤ 8; `loop` repeats while powered) from zone A to zone B (yaw, reach 0.12–0.30 m, height props), joint-space playback × f; grips the first body ≤ 1 kg between its fingers, carries it with gravity cancelled, sets it down 3 mm over B. Nothing at A: `Jam` and a shrug. `Machine.grabberJoints()` gives the pose. **Beta (D120):** the two fingers are their own kinematic bodies (role `piece`, chunks 3 and 4), slid along the gripper's ±X every tick from a plain opening in the state at 0.2 m/s × f: once a body is gripped they close to its half-width across them (the support of its colliders from its centre of mass) + 1 mm, so they physically flank it, and open again at the set-down; `grabberJoints` reports that opening. Zone A is tolerant: if the `aHeight` prop lies within a grippable body's height (± 1 cm) at the zone, the descent goes to that body's bottom, so pointing zone A at a ball's top still grips it. The carry stays a velocity lock (rule 14: nothing to re-derive) |
| Buzz Beacon (M5) | Static pad; a Signal on `call` counts a call (`Call`) for its paired BUZZ (§7.3) |
| Zones | Gravity / antigrav (per-body gravity factor), wind (constant force field, added to the global Wind), stasis (as above). ZONE parts shipped in M3 (`channels/m3_field.ts`). The Orbital Hangar's authored zero-g zones are world data, `env.zones` (togglable, not movable; hashed only in worlds that have them), acting on rigid bodies (M5: each awake pushable body whose centre is in a zone gets an upward force cancelling its gravity (the zone's 0 %; `zeroGZones`, `envsets.ts`), skipping sleeping bodies, critters and bodies a TRACTOR BEAM or STASIS FIELD already holds) and on Matter grains per grain (§8.7) (D104) |

---

## 6. Explosions and breakage

### 6.1 Detonation
For yield Y at P (Bangstick 1, Jitterjuice 1.5, Powder Keg 3, Skyshow shell 0.2). The Popper is not an explosive (no yield); it is an Air puff (§5.8).
- **Triggers:** fuse burn-out (the fuse property) or a detonator Signal on parts with those ports, and a sympathetic blast (below) for every explosive. Plus: **Jitterjuice** detonates on any single contact with J ≥ 0.15 N·s (a Cork Blaster cork, ≈ 0.37 N·s, always sets it off) and shows near-miss feedback from 0.08 N·s; the **Powder Keg** cooks off after 1.5 s of continuous heat exposure (§5.7).
- Radius `R = 1.2 · Y^(1/3) · (air%)^(0.25)` m.
- For each body overlapping the sphere (broadphase query, sorted by partId):
  - **exposure** e = fraction of 9 rays (centre + 8 bounding-box corners) from P not blocked by static geometry;
  - **impulse** `J = K · Y · e / max(r, 0.15)^1.5` along (body COM − P), with K = 18 N·s·m^1.5, plus an upward bias of 15 %, capped so no body leaves faster than 8 m/s ([D53](dev/DECISIONS_2026-10-24.md)).
- **Damage** to breakables: `D = 60 · Y · e / max(r, 0.15)²`.
- Lines inside R/2 snap. Helios inside R pop. Flammables inside 0.4R ignite. Critters inside R ragdoll.
- **Sympathetic:** explosives within 0.6R are queued to detonate after `2 + ⌊4r/R⌋` ticks.
- Matter gets a radial impulse command (§8).
- Event: `Detonate {partId, Y, P, R}` for Spectacle and audio.

### 6.2 Breakables
`hp`, `J_safe`, `J_break` per part (PART_SYSTEM). On break:
1. Remove the body (or the compound child).
2. Spawn macro chunks from `.frac.glb` hulls in chunk order, with velocity `v + ω × r + n̂ · 0.5 m/s · h`, where `h ∈ [0.5, 1]` is a **hash of (partId, chunkIndex)**. Not random.
3. Emit `Break {partId, material, P, J}` → Spectacle micro-debris.
4. Chunks are `DEBRIS` layer bodies. They despawn after 10 s, or persist if the "rubble" world option is on.

---

## 7. Critter AI

### 7.1 Framework
- Each critter: a `CritterState {fsmState, target, timers, rngStream, mood}`.
- **Think** runs every 4 ticks, staggered by `partId mod 4`: utility scoring over actions (§7.2), then FSM transitions.
- **Act** runs every tick: steering, animation-state selection (a visual-only hint sent to the renderer), special actions.
- Randomness: a per-critter xoshiro128** stream seeded by `hash(worldSeed, partId)`. Used for idle variety only.

### 7.2 Perception
- **Vision:** 110° cone (Mochi 8 m, Pip 4 m, Biscuit 10 m, Bandit 6 m), at most 4 rays per think, to the top candidates by distance.
- **Hearing:** Sound events (§5.10). **Smell:** Lure fields (§5.11).
- **Touch:** contact events with J > 2 N·s → `startled`.

### 7.3 Behaviours (per species; full list in the critter briefs)

| Critter | States |
|---|---|
| Mochi | nap, groom, wander, stalk, chase(Pip/Goby/snack), pounce, startled(arch + jump 0.5 m), flee(Biscuit), trapped, dizzy, getup |
| Pip | wander, seek(seeds/burrow), flee(Mochi < 2.5 m), trapped, dizzy. In a Hamster Drive: sleep (no spin) → bumped → startled → wheel_sprint (6 s, Spin source on) → coast (1 s, Pip pants) → sleep; idle never spins (§5.3) |
| Goby | swim (bowl), flop (8 s on bowl break; a Lure for Mochi), then bubble rescue: the bubble carries Goby to Matter water within 3 m deep enough to swim in, else it pops and Goby waits as an icon in the empty cradle until Stop |
| Bandit | wander, seek_shiny, steal_carry, pedal (8 s per stimulus), startled, flee, dizzy |
| Biscuit | sleep, wake, chase(Mochi), bark (Sound pulse every 1.5 s), sniff, dizzy |
| Henny | peck, wander, startled (Sound, or an impact within 1.5 m) → flap (1.0 m up) + lay_egg (spawn Yolk, cooldown 6 s), dizzy. The flap is suppressed while trapped |
| Dusty | patrol (bounded box from props), bump_turn, vacuum (consumes Matter grains under it, +mass), bin_full, sleep (unpowered on its leash, or idle) |
| Buzz | docked (on its beacon, rotors off), fetch(tagged object ≤ 2 kg) on a beacon Signal → carry to beacon, tumble (on hit > 3 N·s), recover. *As built (M5, `critters/m5.ts`; D105):* flies with its capsule's gravity off and a deterministic PD steering controller; docks on its paired BUZZ BEACON, whose `call` Signal port and dock pose it reads (A5 builds the beacon); the carried item rides as a `GHOST` body like Bandit's loot; "tagged" is `PartFlag.Tagged` (DATA_FORMATS §2.3). Events `Fetch` and `Deliver`. **Beta (D121):** a sound ≥ 100 dB where it is (after distance and occlusion: a big boom nearby) startles it for 0.6 s (`startled`, the Sound as cause, "!"): in the air it bobs 0.12 m up and wobbles, keeping its load; on the ground its rotors blip it off the floor; then it resumes what it was doing. Touches still don't startle it. A carried load weighs on the hover: the PD settles 5 cm × the payload fraction under its goal and the climb is 45 % × that fraction slower (0.44 m/s at 2 kg). Pushed down with a load (a HENNY landing on its back) until the hanging item would sink more than 3 cm into what's under it, it sets the item upright on that surface and scans again, so the ghost carry never passes through the floor |

*As built:* MOCHI, PIP, GOBY and BANDIT (M2), BISCUIT, HENNY and DUSTY (M4) and BUZZ (M5) are in `critters/system.ts` (the framework: bodies, perception, steering, ragdolls), `critters/m4.ts` and `critters/m5.ts`. All critter state is plain state in `st.crit`, so checkpoints, rollback and the hash cover it, and `CritterSystem.afterRestore` re-derives ragdoll layers, joint enables and carried items' ghosting (including un-ghosting items grabbed after the checkpoint: the M3 Bandit-steal fix). The wire tables (FSM states, clips, emotes) grow append-only. Soaked in M4: all 7 critters, 144 scenarios, 0 desyncs (M4_STATUS).

### 7.4 Locomotion and ragdoll
- **Locomotion:** a dynamic capsule body with locked rotation about X and Z (upright). Steering sets horizontal velocity toward the target with max acceleration per species, plus 3 forward avoidance rays. Jumps and pounces are impulses.
- **Ragdoll trigger:** a contact or explosion impulse above the species threshold → switch to the Jolt `Ragdoll` built from `RAG__*` capsules. Thresholds (critter briefs): Goby 0.1, Pip 0.3, Henny 1.2, Mochi 3, Buzz 3, Bandit 4, Dusty 4 (or tipped > 60°), Biscuit 10 N·s. The robots (Dusty, Buzz) tumble as a single rigid body.
  - The ragdoll starts from a **canonical pose** for the current locomotion category (stand, walk, run or sit), not the exact animation frame. That keeps animation out of the sim.
  - The capsule's velocity is transferred to all ragdoll parts.
- **Recover:** when the ragdoll root speed is < 0.1 m/s for 1 s, the capsule respawns at the ragdoll root position (upright), the ragdoll is removed, and the state goes to `getup` then `dizzy`. The renderer blends visually.
- Critters **never die** and are never removed by explosions, the Recycler or the Singularity (the Singularity spits them out with a comedic launch instead).

---

## 8. Matter layer (GPU, deterministic)

High-risk feature behind the `matterGameplay` flag. M0 spike gate: bit-identical checksums on NVIDIA, AMD, Intel and Apple over 10,000 ticks of 1M grains.

> **As built (M4 stream MX, M5 stream X5; `packages/matter/`):** an integer-only solver with two independent implementations, the CPU reference (`src/cpu.ts`, also split across Node `worker_threads` lanes, `src/node/parallel.ts`) and the WebGPU backend (`gpu/index.ts`, WGSL in `src/wgsl.ts`), behind the `MatterBackend` contract (`src/backend.ts`). Every constant lives in `src/constants.ts`, which also generates the WGSL prelude, so the two can't disagree. **Determinism proof (D51, D91):** GPU = CPU bit for bit every tick, and the M4 exit ran Sandstorm (4M sand grains) on four implementations on the test system's one GPU: the Node CPU reference, NVIDIA through Dawn D3D12 and D3D11, and Google SwiftShader, identical on every compared tick (checksum plus all wheel impulses; [M4_SANDSTORM_MATRIX](dev/M4_SANDSTORM_MATRIX.md)), and M5 re-ran it on the final kernels (33 kernels, with goo and world gravity): PASS ([M5_SANDSTORM_MATRIX](dev/M5_SANDSTORM_MATRIX.md); checksums differ from M4's from tick 9 because of the sign-symmetric proxy push, D110). Real AMD, Intel and Apple GPUs are untested until hardware can be borrowed (`tools/vendor-matrix/run.mjs` adds one per entry). The machine side is `packages/sim/src/matter/` (`MatterHost`, proxies, coupling, checkpoints, buoyancy) and the browser host `apps/game/src/matterhost.ts` (D92).
>
> **Materials:** sand (kind 0), water (kind 1) and marbles (kind 2) ship (D93); **goo (kind 3)** ships with GOO VAT (M5, stream X5, §8.7). **Grains follow the world (D104, §8.7):** the world's gravity %, the Hangar's zero-g zones per grain, and the Moon's regolith as terrain proxies. The D91 matrix was re-run on these kernels ([M5_SANDSTORM_MATRIX](dev/M5_SANDSTORM_MATRIX.md)).

### 8.1 Data layout (structure of arrays, storage buffers)

| Buffer | Type | Notes |
|---|---|---|
| `pos` | `array<vec3<i32>>` | 1 unit = 1/65,536 m |
| `vel` | `array<vec3<i32>>` | units per matter tick |
| `mat` | `array<u32>` | material id (sand, water, marble, goo) + flags |
| `key` / `idx` | `array<u32>` ×2 | cell keys and sorted indices (ping-pong) |
| `cellStart/End` | `array<u32>` | for a hashed grid of 2²² cells |
| `delta` | `array<atomic<i32>>` ×3 + `count` | Jacobi accumulators |
| `bodyImpulse` | `array<atomic<u32>>` × (body × 12) | 64-bit accumulators as lo/hi u32 pairs (§8.4) for linear impulse and torque |
| `checksum` | `array<atomic<u32>>` ×2 | wrapping sums of positions |

**Particle sizes** (fixed per material; litre capacities convert to particle counts with these, and the counts set `requiredTier`, GAME_SPEC §15.2):

| Material | Particle | Per litre |
|---|---|---|
| Water | 1 mL (radius 6.2 mm) | 1,000 |
| Goo | radius 8 mm (≈ 2 mL) | ≈ 470 |
| Sand | grain ⌀ 4 mm | ≈ 18,000 (random packing ≈ 0.6) |
| Marble | the real ⌀ 16 mm Glint/Bearing body | ≈ 290 (the Marble Hopper's 9.2 L globe holds ≈ 2.7k) |

So a full Tank (15 L) is 15k particles and a Goo Vat (9 L) ≈ 4.2k; sand dominates grain budgets.

*As built (`backend.ts`, `constants.ts`):*
- **Per particle:** `pos` and `vel` as flat `array<i32>` with stride 3 (byte-identical to the CPU's `Int32Array`s); velocities are in units **per substep**; `mat` is a u32 with the kind in bits 0–7 (bits 8–31 reserved, 0). The first `count` entries are live, in the solver's sorted order, which is part of the state (a restore must reproduce it). Capacity is set per world (`MatterConfig.capacity`, from the world's grain budget), never per device.
- **Kinds and constants:** contact radius sand 131 units (⌀ 4 mm), water 406 (the 1 mL sphere, 6.2 mm), marble 524 (⌀ 16 mm), goo 524 (r 8 mm, resting 845 units = 12.9 mm apart: 470 per litre); mass 89 / 1,000 / 5,362 / 2,234 mg (goo: 1/470 L at 1,050 kg/m³); friction Q8 static / kinetic sand 166 / 128, marble 77 / 51, water and goo 0 (the fluid solve and goo's viscosity handle it).
- **Neighbour grids:** a separate hashed grid **per kind**, each with its own cell size (sand 262 units, the contact distance; water 1,048, the fluid kernel radius; marble 1,048; goo 1,140, its cohesion range), in disjoint key ranges of one table of 2²³ + 2²¹ + 2²⁰ keys (`KEY_BASE`, `TABLE`; goo's range was appended, so the other kinds' keys are unchanged). Cross-kind pairs are found by the larger kind searching the smaller kind's grid over r_big + r_small, so 4M sand grains never pay for a marble-sized cell. Keys keep runs of 16 (sand) or 8 consecutive x cells contiguous and hash the rest of the row, and a 32-bit tag rejects aliased cells, so aliasing costs time, never a wrong pair.
- **Impulse accumulation:** per dynamic proxy, linear and angular reaction summed over the substeps with 64-bit carry (§8.4), then shifted and truncated to i32 (`IMPULSE_LIN_NS` = `IMPULSE_ANG_NMS` = 0.9375 µ per unit).
- **Checksum:** two wrapping u32 sums of per-particle hashes (index, position, velocity, kind), finished with a mix that includes the live count (`finishChecksum`, `payload.ts`). Identical on both backends.
- **Snapshot (`MATR`, MTR1):** a 32-byte header (magic, version, tick, count, capacity, seed) then positions, velocities and kinds: 28 B per particle before deflate. CPU and GPU snapshots of the same state are byte-identical (DATA_FORMATS §6).

### 8.2 Kernels per matter tick (60 Hz)
1. **Emit:** emitters (Grit Hopper, Tank, Sprinkle Can, Marble Hopper, Goo Vat, Sponge squeeze, Fishbowl break burst and overflow lip) spawn particles at lattice positions + integer hash jitter. Order: emitter partId, then index.
2. **Predict:** `x* = x + v + g_units` (gravity precomputed in units/tick²).
3. **Key:** `key = hash(cell(x*))`, with cell size = the largest particle diameter in use in the world (§8.1).
4. **Sort:** stable LSD radix sort (4 × 8-bit passes) on (key, index), then build cell ranges.
5. **Solve** (3 Jacobi iterations): for each particle, for neighbours in 27 cells, compute the integer correction (grain contact, fluid density, slime cohesion). `atomicAdd` into `delta` (order-independent integer sums). Then apply `delta / count` (integer division, truncation toward zero).
6. **Collide** with rigid proxies (integer SDF of spheres, capsules, OBBs and convex planes from the collider snapshot). Push particles out and accumulate the reaction impulse and torque per body (§8.4).
7. **Velocity:** `v = (x_new − x_old)`, damping `v = (v × 250) >> 8`, friction on contact normal components.
8. **Despawn:** particles inside intake sensors (Scoop, Sponge, Dusty, Recycler, Grit Hopper, Tank, Sprinkle Can, Marble Hopper, Goo Vat, Fishbowl) are counted per intake (atomic counters) and removed by stream compaction (deterministic prefix sum).
9. **Checksum:** wrapping sums of x, y, z into 2 u32.

*As built (the order inside a tick, `backend.ts`):* **blasts → emits → 4 substeps × (predict → key + sort → 3 Jacobi iterations of the particle solve with proxy collision → velocity) → intakes + kill + compaction → outputs** (checksum, per-kind counts, live bounds, grain queries, the water-surface map). Differences from the list above:
- **Substeps:** each 60 Hz Matter tick runs **4 substeps** (240 Hz) of **3 Jacobi iterations** each (`SUBSTEPS`, `ITERATIONS`). With one step per tick, gravity alone moved a resting grain 0.7 diameters per tick and piles collapsed (an M0 deviation, kept).
- **Gravity (D104, §8.7):** the world's gravity in Q8 units per substep² (`MatterStepIn.gravity`; Earth = 2,816 = 11 units per substep², 9.67 m/s², the M4 constant bit for bit), split over substeps exactly; a particle whose substep-start position is inside a gravity zone (the Hangar's zero-g zones) gets that zone's gravity instead.
- **Sort:** the GPU uses an **atomic count sort** by cell key, with each cell's internal order rebuilt by rank (the count of smaller original indices), never from the atomic tickets. The CPU reference uses an independent **stable LSD radix sort** (24-bit keys, 3 passes of 8 bits). Same order, two algorithms: that's part of the proof. Keys are grouped by kind, so the sorted order is sand, then water, then marbles, then goo.
- **Solve:** sand and marbles are position-based contacts (a normal push split by pair share: in a stacked pair within 45° of vertical the upper particle takes ¾; cross-kind by inverse mass), then Coulomb friction on the tangential displacement. Water is a **double-density PBD fluid** (kernel radius 16 mm, rest spacing 10 mm, pressure and near-pressure, clamped negative pressure for surface cohesion). Goo is a **cohesive, viscous spring fluid** (§8.7) and searches every other kind for contacts. Proxy collision runs inside the iterations; its push is rounded sign-symmetrically (M5, X5: a floor shift crept resting grains downhill on tilted surfaces, badly at low gravity).
- **Velocity:** `v = x_new − x_old` per substep, clamped to ±512 units per substep per component (1.875 m/s, a CFL guard; faster grains can tunnel), with damping **v × 1018 / 1024 per substep** (`DAMP_NUM`, `DAMP_SHIFT`; 0.9768 per tick, about the 250/256 planned).
- **Emit:** a cubic lattice of `count` particles around the spout (spacing sand 294, water 655, marble 1,100, goo 870 units) with integer hash jitter, at the given velocity plus ±`spread` m/s per axis of hash jitter, in `seq` order (part order, then index); particles over capacity are dropped and show in the counts.
- **Intakes:** axis-aligned boxes in world space. After the substeps, each live particle picks the **first** intake in input order whose kind mask matches, whose capacity is above 0 and whose box contains it; each intake absorbs at most its capacity, lowest particle index first (the GPU finds that threshold by binary search over counts, the CPU counts sequentially), and absorbed particles are removed by stable compaction. Per-intake, per-kind absorbed counts come back with the fixed latency. As built, the intakes are the M4 containers (GRIT HOPPER, TANK, MARBLE HOPPER refills), SPRINKLE CAN and SPONGE (`channels/m4_matter.ts`), FISHBOWL's mouth and SCOOP's bucket (`matter/parts.ts`, persistent; they take goo too), DUSTY's vacuum (`critters/m4.ts`) and GOO VAT's lid hatch (goo only; M5, X5), at most 1,024 per tick. The Recycler doesn't take grains.
- **Kill:** particles below 64 m under the origin or beyond ±8 km are removed.
- **Blast:** a radial velocity change at the start of the tick, Δv = impulse × (1 − d/r) for d < r, r ≤ 8 m; `Machine.blast` calls it with min(8, 8·Y) m/s (D53).
- **Queries (DUSTY's `near()`):** up to 16 per tick, evaluated after the tick, returning a count and a centroid.

### 8.3 Rules for kernel authors
- **No floats** in any matter kernel or helper (lint: a WGSL validator rejects `f32` / `f16` in `packages/matter/kernels`). *As built:* the validator is a test (`packages/matter/test/matter.test.ts`) that rejects any float type, float literal or float builtin in the generated WGSL (`src/wgsl.ts`). Every constant comes from `src/constants.ts`; changing one changes every Matter golden.
- No reliance on workgroup scheduling order. Shared-memory reductions must be associative integer operations.
- Integer division only via the helper `idiv(a, b)` (explicitly truncating, guarding b = 0).
- Overflow: the units choice keeps |x| < 2³¹ for ±32 km. Products use `mulHi` helpers that split into 16-bit halves. *As built (`src/imath.ts`):* `mulShr(a, b, s)` for scaled products (split multiplies on the GPU, exact doubles on the CPU), `shrS` for sign-symmetric shifts (the M5 proxy push, D110), `isqrt`, `idiv`, and `add64` / `sar64` for the 64-bit sums.

### 8.4 64-bit accumulation
Per body and component, `lo` and `hi` u32 in offset-binary. `old = atomicAdd(lo, v_lo)`. If `old + v_lo` overflows, then `atomicAdd(hi, 1)`. Plus `atomicAdd(hi, v_hi)`. Unsigned add-with-carry is exact and order-independent.

### 8.5 Coupling with the rigid layer
- Matter tick N runs between rigid ticks 2N and 2N+1.
- **Input:** the collider snapshot written by rigid tick **2N − 4** (stage 13). Only bodies within matter-active regions (AABBs around live particles, padded 1 m) are included, max 4,096 proxies.
- **Output:** body impulses for tick N are read back and applied at rigid tick **2N + 4** (stage 7), together with mass changes for intakes and the water-surface map that buoyancy reads from then on (§8.6).
- Latency is **fixed**, so the result doesn't depend on GPU speed. If the readback for tick N isn't ready when rigid tick 2N + 4 starts, the sim **waits** (time dilation). It never proceeds without it.
- In multiplayer and checkpoints, the Matter checksum is part of the state hash, and Matter state (positions, velocities, materials, counters) is part of checkpoints. Matter snapshots are taken every 2 s (§11) and kept in the VRAM checkpoint pool (1.0 GB on the 16 GB tier, GAME_SPEC §15.1), with a CPU copy every 10 s.
- *As built (`packages/sim/src/matter/host.ts`, M4 stream MI):*
  - **Timing:** stage 13 of rigid tick 2N captures the proxy snapshot S(2N) and submits Matter tick N built from S(2N − 4), the emits and blasts queued since the last command, the live intakes and the queries; stage 7 of rigid tick 2N + 4 applies tick N's impulses and absorbed counts. Matter is dormant (no commands at all) until the first emit, and the backend counts its own ticks from there.
  - **Proxies:** spheres, capsules, OBBs and planes (half-spaces), built per sub-shape from the part's shapes; bodies without a shape list (critters, chunks, pieces) get a box on their Jolt bounds. At most 4,096, only pushable dynamic bodies (never ghost, hidden or dormant: rule 8) whose bounds reach the active region; the region is the live-particle bounds padded 1 m, plus containers and intakes padded 1 m. Static proxies: the floor plane (at the sim's catch-all floor: y = 0, 1 m under the Hangar's deck and the Moon's regolith), the environment set's boxes and spheres, the Moon's regolith tiles under the region (§8.7), and static parts in the region. Impulses are summed per body in proxy order and zero sums are skipped (so a resting body isn't woken every Matter tick).
  - **Hash:** with Matter on, `Machine.hash()` adds the Matter checksum, live counts, container contents, the Matter start tick and the water-surface map (§8.6); goo's count and stored goo only where there is goo (M5); with it off, nothing changes, so every Matter-off golden is unchanged.
  - **Snapshots:** every 240 rigid ticks (2 s) a rigid checkpoint also carries a Matter record (the backend snapshot, the two results computed but not yet applied, and the proxy ring); at most 8 are kept, and only checkpoints with a record are restorable while Matter runs. In the browser the snapshots stay with the main thread's Matter host as CPU bytes within a 1 GB budget (`matterhost.ts`), not in a VRAM pool; device loss restores from them and replays the logged commands.
  - **Backends:** 'gpu' on the renderer's device for worlds over 300 grains, 'cpu' in the sim worker for tiny worlds or without a device, and the bit-identical CPU reference in Node (goldens, fuzz, soaks, headless hosts). A playback replica on the GPU replays the command log to the playhead for drawing (D92, ARCHITECTURE §5).
  - **Speed (M4):** 1M grains 11.4 ms per Matter tick (fits 60 Hz); 4M grains 54.5 ms settled and 94–189 ms in the Sandstorm avalanche, so big worlds run time-dilated or as Bake & Watch (D92). The sand contact kernel is 80–85 % of a tick. The CPU reference costs ≈ 47 µs per water particle per tick, so Node tests keep pours to a few thousand grains. *M5 (X5, contended GPU, provisional):* goo costs about 2.1× sand per particle (1M settled goo 49 ms per Matter tick); a full GOO VAT (4,230 goo) about 0.3 ms; kernels skip a kind with no particles.
  - **Known limits (M4_STATUS):** deep piles compress and resting beds start sluggishly; no hydrostatic pressure inside the fluid (floating is handled by §8.6); grains over 1.875 m/s per component can tunnel.
- **Δv limiter:** a Matter impulse may change a body's velocity by at most its speed relative to the water around it plus 1 m/s, and its spin by at most its spin plus 20 rad/s. Linear and angular parts scale together. Without the limiter, the fixed latency could hand a light body impulses for motion it no longer had.

### 8.6 Buoyancy (D101)

The particle fluid can't build pressure with depth: 3 Jacobi iterations × 4 substeps don't carry a column's weight down, and contacts book only a particle's approach. So a resting body gets only ≈ 4 % of ρ·g·V from the particles. Floating therefore comes from a water-surface map and Jolt's exact buoyancy. The particles still do flow, splashes and impacts.

- **Map:** each Matter command asks for a 2D x–z grid (`MatterStepIn.surface`) while there's live or queued water. Only water particles count; goo (kind 3) is never in the map, so nothing floats in goo (§8.7, D109).
  - It covers the dynamic bodies in the command, padded 0.1 m, in 2 cm cells, aligned to whole cells. The cells get coarser only when the map would pass 4,096 cells.
  - The backend returns per column the water particles' count, their highest and lowest centre y, and their mean velocity, from 64-bit sums. It's exact integer work, so CPU = GPU.
  - The newest map is plain state (`st.matter.surf`, sparse: only wet cells). It's in checkpoints and in the hash once one exists.
- **Level beside a body:** the mean over the wet cells in a one-cell ring just outside the body's x–z footprint.
  - **Per cell:** the top particle centre plus half the 10 mm lattice spacing.
  - **Sparse columns:** a falling stream or spray counts at the depth its volume would fill the cell to.
  - **Never counted:** a column whose water starts above the body's top (a container overhead), and the footprint itself. Under a floating body the water's top is the body's bottom, and water a body carries, like a WATERWHEEL's buckets, isn't water it floats in.
- **Force:** in stage 7 of every rigid tick, each awake, pushable body (rule 8: never hidden, dormant or ghost) whose level is above its bottom gets:
  - `BodyInterface::ApplyBuoyancyImpulse` on its current pose, at ρ = 1,000 kg/m³ (buoyancy factor ρ·V/m, with V the shape's volume);
  - linear drag 0.5 and angular drag 0.5, relative to the water's mean velocity;
  - a linear damping of 4/s times the submerged share of its height, so a bob settles (Jolt's drag is quadratic and fades at low speed).

  Using the current pose and the newest map avoids the coupling latency, so floating bodies don't bob from it.
- **No double counting:** for each sub-shape whose lowest point is under the level, the particle impulse loses its upward part and its torque. Buoyancy already provides that support, and the particles' copy is weak, noisy and 67 ms late. It doubled a QUACK's lift and rocked it. Downward pushes (water poured onto a body), sideways flow and splashes are kept. Dry sub-shapes keep everything, so a WATERWHEEL over a puddle turns as before.
- **Measured** (`packages/sim/test/matter_buoyancy.test.ts`):
  - In a still pond (exact level): at rest the lift equals m·g ± 0.03 %, and float depths match Archimedes. PLANK (ρ 600) floats 60 % under. A ρ 679 sphere floats 62.2 % under, against an exact 62.1 %. A dry SPONGE floats 2.5 % under, half-soaked 52 %. PIG IRON sinks.
  - A PLANK pushed under rises, overshoots and settles within ≈ 1 s.
  - In real Matter water, a dropped QUACK floats upright and steady with ≈ 12 % of its hull under. Jolt carries 1.00 m·g, and the particles add none. The map's level matches the water's volume within 4 mm.
- **Off switch:** `MatterOptions.buoyancy = false` restores the M4 behaviour (particles alone). With Matter off nothing changes.

### 8.7 Goo and grains that follow the world (M5, stream X5)

**Goo (kind 3, appended: kind ids never move).** Slime from GOO VAT: r 8 mm, 1/470 L, 2,234 mg (1,050 kg/m³). Goo is a spring fluid, position-based like the grain contacts and averaged the same way, which keeps it unconditionally stable (water's double-density solver with a strong cohesion clamp overshot and blew small blobs apart). For a goo pair d apart (`constants.ts`, `GOO_*`):
- **Spring:** below the rest spacing (845 units, 12.9 mm: 470 per litre) the pair is pushed apart by (rest − d) / 2. From rest to the cohesion range (1,140 units, 17.4 mm) it is pulled together by `GOO_KC` × min(d − rest, range − d) / 512: a tent that peaks halfway and fades to 0, so a stretched strand thins, holds, then lets go (a drip). The pull stays small next to the push: under averaging, pulls from the cohesion shell must not outweigh pushes from the core, or a blob has no resistance to being squashed (an early version collapsed into a pancake).
- **Viscosity:** each pair removes `GOO_VISC` / 512 (¼) of its relative displacement this substep, so goo flows like syrup and damps its own splashes. A 1.1 L blob dropped 10 cm settles into a puddle 3 layers deep and keeps creeping slowly; nothing tears off (0 lone particles).
- **Against proxies, goo sticks** (`apply`): within 4 mm of a surface (or touching it) a goo particle loses `GOO_STICK` / 256 of its tangential motion relative to the surface per iteration (viscous drag), and up to `GOO_ADH` (12) units per iteration of its separating motion (adhesion with a yield: one layer hangs under a lid; a heavier drop pulls free and drips). That held motion is booked as impulse like friction, so goo drags on a body moving through it and weighs on what it hangs from. Approach is still the normal push.
- **Measured** (`test/matter.test.ts`, `sim/test/matter_goo.test.ts`): a ball moving at 1 m/s through a 1,000-particle puddle takes ≈ 0.1 N·s per tick of drag (water: ≈ 0.001), and goo stuck to it keeps dragging after it leaves the puddle; GOO VAT's demo STITCH, which rolls 2.2 m without goo, is caught after 1.15 m; a puddle on a 10° ramp creeps under 8 cm in 2 s; the goo scene holds together (under 3 % lone particles).
- **Not buoyant:** goo is denser than water and viscous, so it isn't part of the water-surface map (§8.6): nothing floats in goo, a body sits in it on the particle contacts (and is held by them), and goo poured into water sinks slowly through it.
- **Containers:** GOO VAT (9 L = 4,230 particles, flow 0.1–1 L/s, A4's dispenser with goo: `channels/m4_matter.ts`); FISHBOWL's mouth and SCOOP's bucket take goo too. Stored goo is `st.matter.cont`'s 7th field.

**World gravity (D104).** `MatterStepIn.gravity` is the world's gravity in Q8 units per substep², `G = 192 + 2,624 × p` for gravity % p (`gravityQ8`, the sim's `matterGravityQ8`): Earth is exactly 2,816 (11 units, the M4 constant, so Earth worlds send what M4 sent and every M4 Matter golden that doesn't involve tilted proxies is unchanged), the Moon (16.5 %) 625, the Hangar (38 %) 1,189, and 0 % exactly 0. Why the 192: the damping truncates toward zero, which takes a whole unit per substep from a slow grain and about half a unit from a fast one whatever the gravity, and Earth's calibration includes that loss; keeping ¾ of a unit in every world makes drop times over 5–50 cm Earth's × 1/√p within 4 %. Each substep every particle gets the same whole number of units, a Bresenham split on the global substep index S (`g = ((G mod 256) × (S mod 256) mod 256 + G) >> 8`), so the mean is exact and nothing overflows.

**Gravity zones (D104).** `MatterStepIn.zones` (≤ 16): vertical cylinders (radius, half height, centre at mid-height) or boxes, each with its own gravity; a particle whose substep-start position is inside one (first match) gets that zone's gravity. The radial test runs on positions >> 8 (3.9 mm), in integers. The sim passes the Hangar's zero-g zones (`env.zones`, absent = on) at their own gravity % of the world's (0 %): grains poured in a zone hang there weightless; with zones off they fall to the deck.

**The Moon's regolith.** W5 builds the authored heightfield as Jolt HeightFieldShape chunks, which Matter can't collide with, so `matter/terrain.ts` turns each 0.5 m sample cell under the Matter-active region into a static oriented box whose top is the plane fitted to the cell's corners (≤ 2,048 per command, cached per cell; cells under the concrete apron are skipped: its boxes are already proxies). Grains settle on it within a grain of the heightfield (`matter_gravity.test.ts`), with the Matter floor plane dropped to the catch-all floor's −1 m like the rigid floor.

**Not done (decided):** grains feel no wind (`env.wind` acts on rigid bodies only) and no air %: the damping (0.9768 per tick) is the solver's, so Moon grains still have that drag. The M5 fields stay rigid-only (D102).

**Proof:** GPU = CPU every tick (checksum, counts, bounds, absorbed, impulses, queries) on D3D12, D3D11 and SwiftShader for the harness's `goo` and `lowg` scenes, with byte-identical snapshots and restore round trips; the Node goldens in `test/matter.test.ts`; rollback tests through a GOO VAT pour, a zero-g zone and the Moon's terrain; and the D91 Sandstorm matrix re-run on the final kernels ([M5_SANDSTORM_MATRIX](dev/M5_SANDSTORM_MATRIX.md)).

---

## 9. Events

`Event = {tick, kind, partId, otherId?, pos, magnitude, causeId}`.

`kind ∈ Impact, Signal, Powered, Unpowered, Brownout, Jam, Lit, Unlit, Ignite, Extinguish, FuseBurn, Detonate, Break, Pop, Cut, Splash, Spawn, Despawn, Teleport, Note, Sound, CritterState, Emote, Ragdoll, Getup`.

*As built:* `SimEvent = {id, tick, kind, part, pos, mag, cause, other?}` and the `EventKind` union in `machine.ts`, appended per milestone and never reordered: the M1 set (Signal, Powered, Unpowered, Ignite, Extinguish, FuseLit, FuseEnd, Detonate, Pop, Cut, Impact, Press, Break, Brownout, Jam), M2 (Lit, Unlit, Sound, Toggle, Ring, Launch, Splash, Spawn, Despawn, Note, CritterState, Emote, Ragdoll, Getup, Trapped), M3 (Trip, PingRx, Attach, Release, RailOn, RailOff, Boost, Confetti, Trigger, Fire, Snap, Extend, Retract, Burst, PinsAllDown, Goal, Cook, Jostle, Arrive), M4 (Bark, Lay, Splat, Valve, Empty, Flip, Squeak, Arc, Overfill, Squeeze, Drive) and M5 (Fetch, Deliver for BUZZ; Teleport, Emerge, Bounce, Barrier, Engage, Freeze, Charged, Call, Collapse for the Future Tech parts, whose other events reuse Attach / Release, Boost, Despawn, Launch, Trigger and Jam). Each stream lists its new kinds in its notes for audio, effects and captions ([M5_NOTES_A5](dev/M5_NOTES_A5.md), [M5_NOTES_B5](dev/M5_NOTES_B5.md)). `Impact` fires for every contact start ≥ 0.3 N·s (D63).

**`causeId`** is the event that caused this one. It's propagated through contacts (the other body's last causing event), signals, power topology changes, fuse and heat chains, and explosions. It drives the Cascade Report (GAME_SPEC §6.8) and director-cam scoring.

---

## 10. Determinism

### 10.1 detmath
- `dsin, dcos, datan2, dexp, dlog, dpow, dsqrt` (sqrt maps to `Math.sqrt`, which is correctly rounded), implemented as minimax polynomials using only + − × ÷.
- **Float32 discipline:** values sent to Jolt are `Math.fround`-ed at the boundary. Gameplay maths that feeds Jolt runs in float64 JS, then frounds. Never mix in implicit platform maths.
- PRNG: xoshiro128** with named streams per system (`critter:<id>`, `fabricator:<id>`), seeded from `hash(worldSeed, streamName)`.

### 10.2 Ordering
Everything iterates in **partId order** (or (partId, sub-index)). `Map`/`Set` iteration over JS objects is allowed only when keys were inserted in canonical order. A lint rule flags `for…in` and `Object.keys` in `packages/sim`.

### 10.3 Lint and test gates
- ESLint `kn/determinism`: bans `Math.random`, `Date`, `performance`, `Math.(sin|cos|tan|atan2|exp|log|pow)`, `setTimeout` timing in sim logic, `for…in`, and floating-point `toFixed` in hashing. *As built:* a script, not ESLint: `pnpm lint` runs `tools/lint/determinism.mjs` over `sim`, `docstore`, `format`, `net`, `detmath`, `matter` and `parts-data` (ENGINEERING §4).
- **Golden machines:** ~60 machines covering every channel, part and critter. CI runs 10,000 ticks in Node (the same WASM) and compares hashes to stored goldens. The nightly matrix runs them in Chrome on x64 on every GPU vendor available (for Matter). Chrome is the target browser until after beta ([D51](dev/DECISIONS_2026-10-24.md)). *As built:* a per-part golden plus a fuzz entry for every part and the Library demos (`packages/sim/test/goldens*.test.ts`, `fuzz.test.ts`), the goal-type machines (D76), rollback tests and the threaded hash matrix (`threads.test.ts`), run by Vitest in Node; Chrome runs and the Matter vendor matrix (`tools/vendor-matrix`, D91) are run by hand at each milestone's release checks. Goldens are re-pinned only by the stream that owns them (M4_PLAN rule 13).

### 10.4 State hash
xxHash64 over a canonical byte stream: for every body sorted by partId: quantized position, rotation, linear and angular velocity, plus the motion state; plus channel states (power factors, signal timers, heat exposure, fuse fronts); plus RNG states; plus the Matter checksum. Computed every 60 ticks (~0.3 ms for 10k awake bodies; sleeping bodies contribute a cached hash).

*As built (`Machine.hash()`):* xxHash64 (`detmath/hash.ts`) over the tick; every live body in body order (part id, role, position quantized to 1e-5 m and rotation to 1/32767; velocities aren't hashed); per-part alive / lit / armed / mains / supply state; cut lines, mortar, broken parts and fuse fronts; the critter system's FSMs, timers and RNG streams; M2+ channel state (including the M5 parts' `st.m2.m5`); with Matter on, the Matter checksum, live counts, container contents, the Matter start tick and the water-surface map, plus goo's count and stored goo where there is goo; BUZZ's state and the tagged set only in worlds that have them; and `env.zones` (worlds with zero-g zones) and `env.wind` (worlds with wind). Each M5 addition is hashed only where it's present, so no older golden moved. Every body is hashed every time (no sleeping-body cache).

### 10.5 Tier independence
Tiers change **capacity only** (max parts, grains, particles). No gameplay constant depends on the tier. Machines record `requiredTier` (computed from counts). A machine above the device's tier won't start. *As built:* `requiredTier` is computed by `worldRequiredTier` (`packages/format/src/matter.ts`) from parts and grains, and is at least 16 GB with the Kitchen sink filled (D98: the 1M particles are a fixed world amount, the same on every machine). Tiers include 32 GB (D85). The client warns when the world needs more than its tier (`run.ts`).

---

## 11. Checkpoints, rewind, bake-ahead, pokes
- **Checkpoint:** Jolt `SaveState(StateRecorder, EStateRecorderState::All)` + ECS component state + RNG streams + event-cause tables + Matter reference. Compressed with LZ4 in the worker, kept in CPU RAM. Every 0.5 s (60 ticks at 120 Hz). Kept: the last 120 (60 s) dense, plus 1 per 5 s beyond that, within a memory budget (Room 256 MB, Megastructure 2 GB).
  - *As built (`Machine.checkpoint`):* Jolt's `SaveState` bytes (worlds over 2,000 parts keep a `StateRecorderImpl` inside the WASM heap) plus a copy of the plain state `st` (behaviours, channels, RNG, causes, critters, Matter host), uncompressed in memory. The copy is `clonePlain` (SIMFIX, D118): arrays of numbers are sliced, which is ≈ 5× faster than the `structuredClone` it replaced, so `st` must stay plain, JSON-safe data with no shared references. Desync repair's JSON round trip already required that. Taken at the start state (D70) and every 60 ticks, **keeping the last 16** (an 8 s window); worlds over 20k parts checkpoint every 240 ticks and keep 3–16 within ≈ 256 MB of mostly sleeping state (`checkpointPlan`, `parts-data/src/presets.ts`). Awake bodies cost more: ≈ 600 B each in a checkpoint instead of ≈ 100 B (their contact caches), and an in-heap recorder holds up to 2× its bytes, so an all-awake ring is ≈ 5–12× that; the Jolt heap is sized for it (§4.1, J5).
  - *As built (SIMFIX, beta): what a restore re-derives (M5_PLAN rule 14, D119).* Jolt's `SaveState` holds positions, velocities, activation, the contact cache, constraint enables, and motor states and targets. It doesn't hold object layers, gravity factors, mass and inertia, collision groups, hinge and slider limits, friction, or motor settings (torque and force limits, spring). The beta audit checked this by experiment, then checked every channel and behaviour module (table in `docs/dev/BETA_NOTES_SIMFIX.md`). Everything outside `st` and Jolt is now one of three kinds:
    - build-time wiring;
    - scratch for one tick, emptied before the next (a checkpoint sits between ticks);
    - re-derived in an `afterRestore` from `st`.

    Settings a behaviour sets every stage 6 before the step (motors, FLAP and FLINGER limits, DYNAMO and SPINDECK friction) need nothing more. Masses that a ScaleToMass chain set (SPRINKLE CAN, SPONGE) are written back from exact values kept in `st` (`st.m2.m4.mp`): re-scaling them rounds differently from the straight run. `packages/sim/test/rollback_rule14.test.ts` holds every part's fuzz scene and every Library demo to this. For each one, a rollback from 3–5 s further on and a fresh machine adopting the checkpoint must match the straight run: the state hash, and every unrecorded Jolt setting one tick after the restore.
  - *Cost (SIMFIX, measured on the 8-thread build, apps/game/bench/sim-bench.ts):* on worlds over 20k parts, the checkpoint tick is a hitch every 2 s. Copying `st` was ≈ 20–45 ms of it (77k–154k parts); `clonePlain` takes ≈ 5 ms at 77k. The rest is Jolt's `SaveState` itself: ≈ 20–50 ms at 77k parts (6k–23k awake) and ≈ 45 ms+ at 154k, mostly per-body writes into the recorder's stream. The JoltJS binding has no way to pre-size or reuse that stream. Checkpoint ticks on the 154k-part domino wave went from 94–158 ms to 49–115 ms, and on the 77k-part wave from 41–86 ms to 27–72 ms. Bake-ahead still hides them; a live run at the ceiling still drops a frame every 2 s, but that hitch is 15–45 ms shorter.
  - *As built (J5, M5): a run that can't go on.* An exception out of a step, above all a Jolt abort (`Aborted(OOM)` when a world outgrows its fixed heap), makes the sim worker drop the run without touching the dead module again and post a fatal error (`kind: 'oom' | 'abort' | 'error'`). The main thread stops the run (for both players), says "This machine ran out of physics memory…", and replaces the sim worker, so the next run loads a fresh module on fresh memory (a threaded module's shared heap is only freed when its worker goes). Deflated only when exported for desync repair (KNCP, DATA_FORMATS §6). The worker bakes at most 4 s ahead, inside that window, so any poke can roll back.
- **Matter snapshots** (when the Matter layer is active): every 2 s, in VRAM, referenced by the rigid checkpoint taken at the same tick (§8.5). A restore then uses the nearest checkpoint that has a Matter snapshot, so a rollback may reach back up to 2 s. *As built:* every 240 ticks, at most 8 kept; in the browser the snapshots are held by the main thread's Matter host (byte budget 1 GB) and referenced by id.
- **Rewind/scrub:** restore the nearest checkpoint ≤ target, then re-simulate. Playback reads the keyframe store, so re-simulation is only needed if the store has evicted that range. *As built:* scrubbing reads the BakeStore's 3-minute history; there is no re-simulation for scrubbing.
- **Bake-ahead:** the sim runs ahead of playback up to the keyframe store's capacity (ARCHITECTURE §5; keyframe layout in DATA_FORMATS §6.1). *As built:* up to 4 s ahead live; Bake & Watch bakes the whole run (up to the requested seconds, or until everything has been asleep for 2 s) before playback.
- **Pokes:** a poke at tick T. If the sim has already passed T: restore the checkpoint ≤ T, insert the poke into the input log, re-simulate. Keyframes after T are invalidated and regenerated. Playback, which trails the bake head, never shows the stale frames.
- **Time dilation:** reported as `simRate = simTicksPerSecond / tickRate`.

---

## 12. Performance budgets (sim worker, 8-core reference CPU)

The budgets hold up to **10k awake bodies**, the real-time ceiling in GAME_SPEC §5.3 (that table's per-preset awake counts are M0 estimates and get replaced by measurements).

*Measured (M4, multithreaded Jolt, D99):* Kiloton 2.3–2.7 ms per tick and Domino Day 1.5–1.6 ms per tick, both in real time; Kiloton's blast second sits at or just over 7.5 ms at 8–12 threads. About 90 % of a tick is inside `Jolt.Step`. The awake-body column of GAME_SPEC §5.3 is re-measured by M5 tier tuning (T5, [M5_STATUS](dev/M5_STATUS.md)). *As built:* there are no per-stage timers in a `statsBlock`; the debug perf readout shows the bake rate and time dilation, and the benchmark harness (`apps/game/bench/`) measures ms per tick. There's no nightly perf CI.

*Measured (SIMFIX, beta):*
- **Checkpoints:** amortised over 240 ticks, a checkpoint on a world over 20k parts is ≈ 0.2–0.5 ms per tick, within stage 13–14's budget. But it lands on one tick: 27–72 ms at 77k parts and 49–115 ms at 154k parts (§11).
- **Starting a run:** `contactEstimate` now runs once per start, not twice, at ≈ 1.6–2 s for a 1M-part world (it was ≈ 9.4 s each time).

| Stage | Budget per tick (any preset, ≤ 10k awake) | Megastructure note |
|---|---|---|
| 0–6 | ≤ 0.8 ms | Critter think staggered; light capped at 1,024 segments |
| 7 | ≤ 0.1 ms | |
| 8 (Jolt) | ≤ 5.0 ms at 10k awake bodies | Beyond → time dilation |
| 9–12 | ≤ 1.0 ms | Contacts sorted with radix by key |
| 13–14 | ≤ 0.6 ms (amortised) | Hash and checkpoint off the hot path where possible |
| **Total** | **≤ 7.5 ms** (120 Hz real time = 8.33 ms) | |

Instrumentation: per-stage timers in `statsBlock`. The nightly perf CI runs the benchmark scenes (GAME_SPEC §13) and fails on > 10 % regression.

---

## 13. Sim versioning
`simVersion = <sim package semver>+<jolt build hash>+<parts-data behaviour hash>`. Any change that can alter outcomes bumps it (CI computes the behaviour hash and diffs the golden hashes). Machines store `simVersion`. Old versions are served from `/sim/<version>/` (sim worker module + jolt.wasm), loaded lazily. Two multiplayer clients always load the host's build, so their versions always match.

*As built:* not built yet. Worlds store `simVersion` as `0.0.0-dev`, there are no legacy sim bundles, and replay fidelity across builds is protected by the goldens instead: a change that alters an outcome must re-pin goldens in its own stream, and behaviour switches that would change old worlds are gated by data (for example `simFlags.matterGameplay` is off for files from before M4). The host refuses a client whose `build` differs (MULTIPLAYER §8.4).
