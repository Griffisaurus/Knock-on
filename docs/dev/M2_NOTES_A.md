# M2 notes: stream A (sim-parts)

Last updated 2026-10-24. Scope: the 24 non-critter M2 parts, the Light, Sound and Lure channels, the M2 Power and Air additions, and contract 1 (events and causes) and contract 2 (Sound and Lure) from [M2_PLAN.md](M2_PLAN.md).

## Where things live

| What | Where |
|---|---|
| Part definitions | `packages/parts-data/src/defs_m2.ts`, spread into `PARTS` by `defs.ts`. It also exports `lureOf`, `qAxis`, `qBasis`, `qMul`, `BIG_TOP`, `TURBINE`, `GOTCHA`, `FLAP` and `VORTEX_PROFILES`. |
| Cards and demos | `cards.ts` and `demos.ts`, in the "M2 machine parts (stream A)" blocks. `Demo.path()` adds path links such as GUTTER. |
| Channels | `packages/sim/src/channels/`: `host.ts` (the Machine as seen by the channels, and `st.m2`), `index.ts` (`PartChannels`, the hooks), `power.ts`, `light.ts`, `air.ts`, `sound.ts`, `devices.ts`, `launch.ts`, `gutter.ts` |
| Machine hooks | `machine.ts`: one-line calls to `this.x.*` at each stage, each with a comment. `this.x` reaches Machine internals through `channels/host.ts` `Host`, so a renamed Machine member must be renamed there too. |
| Tests | `packages/sim/test/goldens_m2.test.ts` (24 goldens), `channels.test.ts` (18 tests), `fuzz_scenes_m2.ts` (wired into `fuzz.test.ts`), `golden_helper.ts` |

## Contract 1: events

- `SimEvent` has three new fields:
  - `id`: per run, increasing in emit order. It lives in `st.evId`, so a rollback re-emits the same ids.
  - `cause`: the id of the causing event, or −1.
  - `other?`: the other part involved, as a `PartId`.
- **New kinds:** `Lit`, `Unlit`, `Sound`, `Toggle`, `Ring`, `Launch`, `Splash`, `Spawn`, `Despawn`, `Note`.
  - `Sound`: mag = dB at 1 m.
  - `Toggle`: mag 1 for on, 0 for off.
  - `Launch`: mag = launch speed in m/s; `other` = the launched Roller (BIG TOP).
  - `Spawn`: a pre-built piece enters play (the cork).
  - `Lit` / `Unlit`: TORCH, LAMP, SUNCELL (at 0.05 light) and BURNING GLASS (focus on or off).
  - A emits no `Splash`, `Note` or `Despawn` yet: Matter intake, Tonebars and Recycler don't exist yet. B's FISHBOWL emits `Splash`.
- **causeId** (SIMULATION §9). Each part has a "last causing event", `st.lastEv`, which every event on that part updates. Causes then propagate as follows:
  - **Contacts:**
    - A sensor's event takes the other body's `lastEv`.
    - An `Impact` takes the newer of the two bodies' `lastEv`, and both bodies then adopt the Impact.
  - **Signals:** pulses carry the event that fired them. `st.pulses` is now `[part, port, cause]` triples.
  - **Power:** `Powered` and `Unpowered` take `st.powerCause`, the last topology change: a MAINS flip, a TOGGLE flip, or a CELL running flat.
  - **Heat:**
    - Heat sources carry a cause (stride 5).
    - Fuses carry `st.fuseCause`: `FuseLit` → `FuseEnd` → `Ignite`.
    - Lit parts keep `st.litCause`, which feeds their flame and the bangstick fuse.
  - **Explosions:**
    - `st.booms` entries carry a cause (stride 4) and fireballs carry their Detonate (stride 6).
    - Everything inside R adopts the Detonate.
    - Pops, ignitions, cuts and cracks inside R take the Detonate as their cause.
  - **Cuts:** the parts at either end of a cut rope adopt the `Cut`.

## Contract 2: Sound and Lure (for stream B)

- **Making a sound:** `machine.sound(pos, dB, partIndex, cause)` emits a `Sound` event and queues the sound.
  - A already makes these sounds:
    - explosions: 120 + 10·log10(Y);
    - RINGER: 80;
    - hard impacts (J ≥ 2 N·s): 60 + 20·log10(J), capped at 110;
    - BIG TOP: 105; CORK BLASTER: 90; SKYROCKET launch: 85; GOTCHA BOX pop: 75.
  - B can call it for barks.
- **Hearing sounds:** `machine.soundsThisTick: Sound[]` returns `{pos, dB, part: PartId, cause}`, where `cause` is the id of the Sound event.
  - The queue swaps at the start of stage 6 (`stageBehaviours`), so stage-6 perception sees each sound exactly once.
  - That covers everything from the previous tick's stage 6 through this tick's stage 5.
  - Sounds made during stage 6 are heard next tick.
  - Both buffers live in `st.m2`, so rollback covers them.
- **Lures:**
  - `PartDef.lure?: {species: Record<string, weight>, radius}` tags a part as a Lure.
  - `lureOf(def)` returns that tag. Failing that, it computes a shiny Lure (`{bandit: 1}`, 5 m) for dynamic bodies of `material` steel, chrome, brass or glass at ≤ 0.5 kg.
  - `machine.lureEmitters()` lists live lure parts in part order as `{part, index, pos, radius, species}`.
  - No M2 machine part is a Lure: PIG IRON is steel but 6.5 kg. Seeds and snacks come later.
- `PartDef.body.material` (`PhysMaterial`) is set on every A part.

## For the other streams

- **Body roles.** `BodyInfo.role 'piece'` marks the CORK BLASTER cork (dynamic) and the GOTCHA BOX head (kinematic). Both are built with the world:
  - The cork is a ghost with no gravity until it is fired.
  - The head stays parked inside the box until it pops.
  - Their visuals are the def visuals with `on: 'piece'`, in part space like arm visuals.
- **Rotors.** DYNAMO, TURBINE, GOTCHA BOX crank and TOGGLE lever use role `'arm'`. PUNCHLINE's glove is its `'arm'`, on a slider.
- **Shape rotation.** `ShapeDef.rot` (a quaternion) is used by colliders only: funnel staves, scoop staves, turbine blades and rocket fins. The blockout visuals avoid it.
- **Flags (C, F):**
  - `lit`:
    - TORCH, LAMP and BURNING GLASS (focus on), and SUNCELL (≥ 0.05 light);
    - TOGGLE (on) and FLAP (open);
    - SKYROCKET while thrusting, and BIG TOP while its touch-hole burns.
  - `armed`: RINGER and DELAY while counting down, SKYROCKET while its stub burns, BIG TOP while its touch-hole burns.
  - `pressed`: BIG TOP while loaded, a fired T-PLUNGER, a popped GOTCHA BOX, and the PUFFER and SPRONG on a hit.
  - `powered`: CELL and DYNAMO while supplying, and a GOTCHA BOX while it's cranked.
- **Meters.** `partMeters` reads CELL charge, DYNAMO and SUNCELL output as 1–21, and RINGER whole seconds left.
- **Links.** GUTTER is a path link (`gutter`, `gutter_slim`) with no ports, built like TUBE. Its section follows `assets/build/parts/gutter/gutter.profile.json`. `GUTTERS` is exported from `@knockon/sim`.

## Deviations from the specs

- **SimEvent and the hash.** M2 channel state enters the state hash only when a machine contains an M2 part, so the M1 hashes don't change.
  - Before the MOTOR fix, a temporary recompute of the original M1 hash showed the event, cause and channel changes leave every M1 demo's state bit-identical. The MOTOR fix re-pinned the drive goldens listed under MOTOR.
  - The M1 golden hashes did change once, when stream B's critter hash started appending its counts to every machine.
- **SPRONG.** Jolt can't do restitution above 1. After the step, a body that landed on the mat (J ≥ 0.05 N·s, contact inside the mat) gets its normal velocity set to min(8, 1.15 × arrival speed). The mat has no shape key: C reads the `pressed` flag.
- **VORTEX.**
  - Size is a property, Wide or Slim.
  - The collider is a ring of thin boxes per profile segment (24 or 16 around), plus a 12-stave bore. The art's mesh collider replaces it later.
  - No tripod option yet.
- **SCOOP.**
  - There's no bail pivot body: the `bail` hook is fixed at the upright pose (0, 0.265, 0), so a hanging bucket stays level.
  - Matter intake waits for M4: Rollers simply land in it.
- **FLAP.**
  - The size is fixed at 0.30 × 0.30: ports are static in the def schema, so a resizable flap would need per-part ports.
  - An `Auto-close` property (0–30 s, 0 = close on the next pulse) is added.
  - The back rail collider is only its rear 6 mm, so the hanging panel swings past it.
  - Latched means hard hinge limits at 0°. Open means free, with 0.05 N·m of knuckle friction. Closing drives a motor to 0°.
  - Passive mode is a stiff spring carrying the panel's own weight plus 0.15 N·m.
- **DYNAMO.**
  - **Output.** It follows W = min(300, 40·|ω|, 0.6·P_shaft + 2 W).
    - P_shaft is measured right after the physics step, from the belts' gear impulses.
    - The 2 W per tick lets output ramp up to meet a load. Without it, any output level is its own fixed point, and a dynamo stays stuck at whatever its spin-up gave it.
  - **Brake.** The brake τ = P_drawn / (0.6·max(|ω|, 1)) is applied as hinge friction. It can't reverse the rotor, and every drawn watt costs 1/0.6 W of shaft power.
  - With the MOTOR fixed (below), a MOTOR driving a DYNAMO settles where the motor gives ≈ 67 W of shaft power (ω ≈ 5.8 rad/s), and the dynamo yields 40 W to a lamp. Its most is ≈ 42 W, as SIMULATION §5.5 says.
- **MOTOR (fixed in M2, at the orchestrator's request).** It now follows the linear DC torque–speed curve τ = τs·(1 − ω/ω0), with τs = 30 N·m × f and ω0 = 9.42 rad/s × f (SIMULATION §5.3: both × f). Peak shaft power is ≈ 71 W.
  - Computing τ from ω explicitly oscillates on these tiny rotor inertias (the dynamo lamp flickered every 2 ticks). Instead, the hinge's rigid velocity motor, limited to stall torque, holds the curve's speed for the torque it delivered last step, ω = ω0·(1 − τ/τs). The target relaxes by half each tick and is kept in `st.m2.val[motor]`.
  - Transients can overshoot the 71 W peak by a few watts for a tick or two; the steady state stays on the curve (tested).
  - A dynamo-driven loop that an outside push spins up to full speed runs itself down (tested).
  - **Re-pinned goldens** (behaviour checks unchanged and passing):
    - `goldens.test.ts`: treadway `07be2ed3a44963c1` → `0a49f7dd46ce323d`, cog `7c1952cd7e0f4aed` → `7420123b969da775`, motor `d0473c9d0fdc04c9` → `443699844a6f9881`, band `4e07c5d29db8607e` → `ebde8b6cd2fbc5da`, cable_power `381f4f8581069c27` → `53586c5eef2a6dc1`.
    - `machine.test.ts`, the 42-part M1 exit golden: `4a3613edfe31eb34` → `102ef0dd2eaa19ab`.
    - `goldens_m2.test.ts`: dynamo `b93fdf03ee86c4ce` → `d40815781eebb424`, cell `91540b060689920a` → `786930c2bc7f537d`, suncell `a5382972afe076eb` → `dbb11ea06bc375f5`, gotcha_box `7374bf0800b64d60` → `adc285a0880751be`.
- **TURBINE.**
  - Blade force uses the GALE's formula per blade, with 0.38 of it tangential.
  - The drive fades to zero as blade speed reaches twice the local wind speed (6·s·(1 − d/R) m/s). A toy rotor needs this terminal speed.
  - PUFFER puffs kick it through the same pitch term.
  - The global Wind isn't in the sim yet.
  - Bounds follow the art: 0.26 m wide at rest.
- **PUFFER.**
  - The lid is a fixed collider at its 18° rest angle. A hit counts as a pad hit when it lands on the lid (local y > 0.1), with J ≥ 0.02 N·s and a 0.15 s cooldown.
  - The puff is an impulse along the nozzle axis on each body in its 1.5 m / 20° cone: I = 12·min(J, 10)·A·(1 − d/R)², capped at Δv 8 m/s. It douses flames when 6·min(1, J/2)·(1 − d/R) > 4 m/s.
  - There's no occlusion ray (the GALE has none either).
- **CELL.**
  - Charge drains by the power actually drawn, not a flat 200 W, so an unconnected cell keeps its charge.
  - Capacity is given in seconds at 200 W (5–120 s).
- **SUNCELL.** Light runs after power (stages 3 then 4), so its supply lags its light by one tick.
- **LAMP and TORCH.**
  - Both are static devices.
  - Lamp brightness is its supply factor.
  - TORCH has `On at start` and a Signal mode (Toggle, On or Off). It needs no power: a flashlight has its own battery.
- **Light.**
  - Glass-material parts pass beams at 90 %.
  - TUBE and GUTTER bodies are opaque to light for now: environment colliders have no part to read a material from.
  - The focus spot needs at least one ray converged within ±0.03 m of `focal`.
- **TOGGLE.**
  - Port names follow the art (E1): `in`, `out_power`, `out_signal`.
  - The lever is a hinge arm driven by a position motor to ±25° (0.4 N·m), so a ball can push it.
  - Any knob hit of 0.03 N·s or more flips it, from either side.
- **RINGER.** Counts down from the run start (it has no input). Its time is 1–30 s in 0.5 s steps.
- **T-PLUNGER.** The handle is a fixed collider: it doesn't travel down physically, and the `pressed` flag shows it down. It fires on a hit of 0.3 N·s or more, or on 1 kg or more resting on it (persisted contacts).
- **SKYROCKET.**
  - Has a `Fuse` stub property (0.2–5 s); the brief has none.
  - Thrust is 6 N along its axis for 2.0 s, with drag 0.015·|v|·v (≈ 14 m/s climb).
  - No fin torque.
  - No payload lock: deck friction carries light loads. Fixing a body to it would mean creating a constraint mid-run.
  - The exhaust heat source is three r 0.045 m spheres along the 0.25 m plume.
- **BIG TOP.**
  - A Roller whose centre enters the bell (bore axis from the ram plate to 0.03 m past the muzzle, within r 0.15) is caught. It becomes a ghost with no gravity and is held on the axis every tick. Its layer is re-applied after a rollback.
  - It fires 0.5 s after heat reaches the touch-hole stub or the fuse port.
  - A just-fired ball can't be re-caught for 0.25 s.
  - Not yet: the marble spread (marbles are M3), recoil, and elevation during a run.
- **CORK BLASTER.** The pull fires when the LINE on the `pull` hook carries 4 N or more, read from the distance constraint's impulse. Pulley lines to it are ignored.
- **PUNCHLINE.**
  - One slider instead of three telescoping stages.
  - The glove collider is r 0.055 at rest x 0.115 (brief: r 0.06 at 0.10), so it doesn't overlap the housing.
  - It punches out at 6 m/s (600 N), holds 0.25 s at 0.5 m, then retracts at 0.83 m/s.
  - A blocked punch flags `fault`.
- **GOTCHA BOX.**
  - Pops after 3 crank revolutions, or a whack (box ≥ 1.0 N·s, lid ≥ 0.5 N·s).
  - The head follows a scripted kinematic path: rise 0.30 m in 0.12 s, lean 35° forward over 0.15 s, then a damped wobble.
  - The lid is visual only.
  - Bounds include the front crank.
- **GUTTER.** Banking isn't supported: the channel opens toward world up along the path.
- **FUZZ and PIG IRON.** FUZZ has no buoyancy until Matter (M4). PIG IRON carries `magnetic: true` for the M3 Field parts.

## Known issues in other streams (not fixed here)

- `pnpm typecheck` fails in `apps/game/src/sim.worker.ts:179`: `environment: string | undefined` doesn't satisfy `MachineOptions` under `exactOptionalPropertyTypes`. This is the Mega Kitchen wiring, in progress.
- `pnpm lint` and the whole `pnpm vitest run` (31 files, 772 tests) were green on my last run.
