# Beta polish notes: stream PARTSIM (sim behaviour polish)

Scope ([BETA_POLISH_PLAN.md](BETA_POLISH_PLAN.md)): TURBINE turned by global wind, TRACTOR BEAM occlusion, GRABBER fingers that really close (and a tolerant zone A), BUZZ's startle and carried load. Ports 5322 / 8922. D-numbers D120–D121. M5_PLAN rules 1–15 apply (rule 14: rollback-safe state). The gaps came from [M5_NOTES_W5](M5_NOTES_W5.md) (TURBINE), [M5_NOTES_A5](M5_NOTES_A5.md) (TRACTOR occlusion, GRABBER fingers) and [M5_NOTES_B5](M5_NOTES_B5.md) (BUZZ: no startle, no physical load).

**Status: done** (2026-10-25). Results at the end.

## Decisions (for the orchestrator's log)

- **D120 TURBINE in global wind, GRABBER fingers (beta, PARTSIM).**
  - Global wind turns an intact TURBINE's rotor through its 25° blade pitch instead of pushing it as plain drag. A rotor governor (drive fades out between 28 and 32 rad/s) applies to every wind source, because past ≈ 35 rad/s the rotor stopped dead.
  - The GRABBER's fingers are their own kinematic bodies that slide shut on the payload. Zone A tolerates a height inside the payload's bounds.
- **D121 TRACTOR BEAM occlusion and BUZZ startle / load (beta, PARTSIM).**
  - TRACTOR BEAM: a body in the cone is shadowed when a narrow-phase ray from the lens to its COM first meets something else.
  - BUZZ: it startles (0.6 s) at ≥ 100 dB after distance and occlusion. A carried load sags its hover and slows its climb by mass. If it's pushed down with a load until the item would sink into the ground, it sets the item down.

## 1. TURBINE turns in global wind (D120)

**What it was:** W5's `globalWind` (`envsets.ts`) pushed the rotor arm as one more pushable body: plain drag at its COM (the hub), so almost no torque.

**What it does now** (`channels/air.ts turbineGlobalWind`, called from `globalWind` for an intact TURBINE's arm instead of the drag):
- **Axial share.** The wind is uniform, so every blade sees the axial component w·a, where a = −(wind dir · rotor axis).
- **Force and torque.** Per blade, `F = 1.225 · air · w² · A_blade · a²` (the global term's dynamic pressure), and the torque is `s · 3 · r_blade · 0.38 · F · drive`, with s = sign(a).
  - Wind on the front turns it forward; from behind, backwards; straight across, not at all.
  - Seeded gusts are already in w (`windSpeedAt`).
- **Drive fade.** The drive fades as the blade speed reaches twice the axial wind speed, as for a GALE.
- **Wake.** A sleeping rotor wakes only on the global term's once-a-second tick, and only if the torque is ≥ 1e-4 N·m (about a 0.5 m/s breeze).
- **Governor (all sources, `governor()`).**
  - **Measured problem:** under any steady drive (a constant 0.02 N·m test torque, or wind of 6 m/s or more), the rotor hit about 35 rad/s and stopped dead to −0.7 rad/s. That repeated every 2.5 s. The cause: the hinged arm collides with its own static base. At that speed the pitched blades' inner ends catch the hub block's speculative contacts.
  - **Fix:** the wind drive fades out between 28 and 32 rad/s.
  - **Measured after the fix:** 20 s at 3 / 6 / 12 / 15 m/s tops out at 29.3 / 31.5 / 31.9 / 31.9 rad/s, with no stops.
  - **No other golden moved:** below 28 rad/s the drive is unchanged, so the M2 `turbine` golden (GALE) is bit-identical.
- **Output.** The Spin output is unchanged: the BAND / DYNAMO path is the same as with a GALE.
  - **Note:** a DYNAMO driving a LAMP stalls a toy rotor in any wind. That's the DYNAMO's brake rule (τ = P / (0.6·max(ω, 1))), as it is with a GALE. The test drives an unloaded DYNAMO.
- **Rollback:** no new state. Forces come from plain state each tick.

## 2. TRACTOR BEAM occlusion (D121)

`channels/m5_field.ts`: `tractor()` calls `shadowed()` for each body in the cone, before the load check.
- **The ray:** one closest-hit ray through Jolt's narrow phase (`PartChannels.rays()`, the light channel's `RayCaster`: moving-layer filter, so ghosts never block), from the lens to the body's COM. The beam's own base is skipped.
- **Shadowed:** the first hit belongs to another part, a critter or the set. A miss counts as clear.
- **Order:** bodies are visited in `eachLive` order (part order), so the casts run in canonical order on every peer.
- **Load:** a shadowed body isn't captured and doesn't count toward the 2 kg load.
- **Consequences:**
  - A held body shadows the ones behind it.
  - A strained (too heavy) body still blocks.
  - A FORCE WALL switched off is on the ghost layer, so it doesn't block. The wall layer's re-derivation in `afterRestore` therefore matters for the beam too, and the test covers it.
- **Rollback:** no new state. The ray reads Jolt state and the (re-derived) layers.

## 3. GRABBER fingers and zone A (D120)

**Physical fingers** (`channels/m5_grabber.ts`, `parts-data defs_m5.ts`):
- **Bodies.** `grabberLinks()`'s gripper is now the palm only. `GRABBER_FINGER` is one finger's collider: an 8 × 45 × 30 mm plate. There are two finger bodies per GRABBER: kinematic, role `piece`, **chunks 3 and 4**, appended to `M5Parts.links[i]`. Every tick they are posed with `MoveKinematic` at the gripper frame ± (opening + 4 mm) along its X, so the inner faces sit at the opening.
- **Opening state:** `st.m2.m5.arm`: `ARM_STRIDE` 12 → 15, adding `fing` (the opening now), `fingT` (its target while holding) and `za` (below).
  - It slides at 0.2 m/s × f toward its goal: `fingT` while holding, `grip/2` otherwise.
  - `fingT` = the payload's half-width across the fingers + 1 mm, clamped to [2 mm, grip/2].
  - The half-width is the support of the payload's own colliders (its base `ShapeDef`s, or a pool piece's def) along the finger axis, measured from the COM. So a STITCH is its radius however it has rolled. A broken part's chunk uses its def's bounds box.
- **Carry.** The carry is still the velocity lock (rule 14: nothing to re-derive). The fingers flank the payload 1 mm clear, so they never fight it.
- **Output.** `grabberJoints()` float 6 (opening per side) is now the sliding `fing`, not a jump to the held radius. RENDER's finger pivots (`gfx/resize.ts fingerOffset`, `main.ts`) draw from it unchanged. They clamp to the art's 0.01–0.04 m.
- **Measured:**
  - A GLINT in a 0.08 grip: 0.040 → 0.009 m per side, and the finger bodies' separation equals 2 × the opening to 0.1 mm.
  - A STITCH in a 0.08 grip: 0.040 → 0.0385.
- **Renderer guard** (`apps/game/src/scene.ts`, one line, tagged PARTSIM):
  - **Why:** the articulated-part branch indexed `ar.joints[k]` for every `piece` chunk, so chunks 3 and 4 would have thrown a TypeError in every run with a GRABBER.
  - **Fix:** they now return early and draw nothing; the finger meshes still ride link 2.
  - **Note:** scene.ts isn't in RENDER's `gfx/**`, but this is a render-side line, so RENDER should know.

**Tolerant zone A (the playtest bug):**
- **Rule.** At the start of the descent (toA → downA), `zoneSurface()` looks for the first grippable body at zone A (part order, `tryGrip`'s rules: centre within the jaw footprint, half ≤ grip/2 + 2 mm, ≤ 1 kg). If `aHeight` lies within that body's height ± 1 cm (its world AABB's height about its COM), the descent goes to the body's bottom (`za`). The palm then meets its top and grips.
- **Measured:** `aHeight` 0.07 or 0.075 on a STITCH now grips (it shrugged before); 0.2 still shrugs.
- **UIFIX** fixes the pointing itself; this is the sim-side tolerance.

## 4. BUZZ: startle and carried load (D121)

`critters/m5.ts`, `critters/state.ts` (M5St `pre`, hashed), one shared line in `critters/system.ts` (tagged PARTSIM), and constants in `parts-data critters.ts` `CRITTER_M5.buzz`: `startleDb` 100, `startle` 0.6 s, `hop` 0.12 m, `sagM` 0.05 m, `climbLoad` 0.45.

**Startle:**
- **Trigger.** `system.think` passes BUZZ the loudest sound it heard this think: the effective dB after distance and the −12 dB occlusion ray, plus that sound's cause.
  - BUZZ's own `hearDb` stays 200, so the shared startle path still never fires for it. Touches still don't startle it.
  - At ≥ 100 dB, in a flying state or docked / landed / idle, it goes `startled` for 0.6 s: CritterState with the Sound event as cause, and the "!" emote.
  - 100 dB is a yield-1 boom within 10 m, a BIG TOP within 1.8 m, or the hardest impacts within 3 m. Inside a blast radius the shared ragdoll wins.
- **In the air:** it bobs `hop` up and away from the noise and wobbles in yaw. Gravity stays 0 (`flying()` = a flying state, or a startle that interrupted one). The load stays on the winch.
- **On the ground:** a 0.9 m/s rotor blip off its skids, then it brakes back down.
- **Afterwards** (`endStartle`): it resumes the interrupted state.
  - fly / grab / carry / drop_off: the same state again, with the hover goal set back under the bob.
  - takeoff → sniff (or home); sniff → sniff again; land / deliver_bow → a fresh landing; docked / landed / idle → the same.
  - A startle cut short (a tumble, a TRAP BOX) clears `pre`.
- **Rotors bit:** on during the startle.

**Load:**
- **Sag.** In `pd()`, the carried item's mass fraction lf (≤ 1 at 2 kg) adds −kp·sagM·lf to the vertical acceleration, so the hover settles sagM·lf under its goal (5 cm at 2 kg).
- **Climb.** The climb cap and the upward-acceleration cap scale by (1 − 0.45·lf): 0.44 m/s at 2 kg instead of 0.8.
- **Arrival check.** The carry → drop_off arrival check allows for the sag.
- **Measured:** with a 0.8 kg BANGSTICK, the level cruise sits 1.9 cm lower than the same run with the model off (expected 0.05 × 0.4 = 2.0 cm). The max climb is ≤ 0.656 m/s.

**Sunk-load set-down** (found by the critter soak; see Results):
- **The case:** a HENNY landed on BUZZ's back mid-carry and pushed it to the floor at about 14 m/s². The PD's 4 m/s² can't hold that. The ghost-carried SCOOP hung 26 cm under the floor, and the soak's "left the world" check fired.
- **Not new:** the HENNY interaction was there before; the startle only changed that scenario's trajectory.
- **Fix:** while carrying (not in drop_off or startled), one ray each tick from the claw down through the item's height (BUZZ and ghosts ignored). If the item has sunk more than 3 cm into a surface, BUZZ sets it upright on that surface, un-ghosted and ignored for 2 s, and scans again (or goes home without a job).

**Rollback:** all new state (`pre`, the goals) is plain `st.crit`. Gravity follows the state through `applyGravity`, which `afterRestore` already re-derives.

## 5. HOVER PAD restore wake (SIMFIX's rule-14 audit finding)

**The issue:** `hoverLock` (`channels/m5_misc.ts`), called from `M5Parts.afterRestore`, woke every powered HOVER PAD. A pad asleep at the checkpoint tick in the straight run would wake after a restore: a latent desync.

**The fix:** `hoverLock(m, i, wake = true)` still wakes on a live power switch. The restore path passes `wake = false`, so Jolt's saved activation stands.

**Checks:**
- `rollback_rule14.test.ts` (SIMFIX's D119 gate: straight run vs rollback vs a fresh machine adopting the checkpoint, over every fuzz scene and Library demo, including activation) passes with all of this stream's changes.
- The new state (GRABBER `arm` numbers, BUZZ `pre`) is plain numbers, safe for `clonePlain` (D118).
- No history-dependent Jolt setting is touched: no mass, motor, limit or friction changes. The fingers are kinematic bodies posed each tick; the rest is forces, velocities and rays.

## Goldens re-pinned (only parts this stream changed)

| Golden | Old → new | Why |
|---|---|---|
| `goldens_m5` grabber | `6df5f3a4fea6f0e5` → `43b0667de0dc49d6` | Two finger bodies added; ARM_STRIDE 12 → 15 (finger opening, target, zone A surface) in the hashed state. The behaviour assertions still pass, plus two new ones: open at 0.04 m, closed on the STITCH at 0.0385 m. |
| `critters_m5` BUZZ demo | `525f73cebef3e7fc` → `dea90d0d968cad3f` | The new hashed M5St field `pre` only. Checked by hashing without it: the old hash came back, so the behaviour is identical. |
| `critters_m5` BUZZ full fetch | `3ae33b5ee1878196` → `aaeb509178d19772` | `pre`, plus the load model: the BOING sags the hover and slows the climb. Every behaviour assertion still passes. |

No other golden moved:
- the M2 `turbine` golden (GALE) is unchanged: the governor acts only above 28 rad/s;
- the `tractor_beam` golden is unchanged: no obstacle;
- the threads suite (every Library demo at 1 / 4 / 12 threads) passes.

## Tests

- **`packages/sim/test/partsim.test.ts` (new, 11 tests):**
  - **TURBINE:**
    - wind on its face, from behind and across, plus a stronger wind;
    - its Spin output to a DYNAMO;
    - a 20 s, 15 m/s gusty gale stays under 32 rad/s with no stops;
    - gusty determinism, two rollbacks and a threaded check.
  - **TRACTOR:** a 7 kg THUD in the beam shadows a STITCH; poked aside, the STITCH is pulled; threaded check.
  - **GRABBER:**
    - five link bodies, the fingers' chunk numbers;
    - the opening closes to the payload, and the finger bodies sit at it;
    - it opens again;
    - zone A heights 0.07 / 0.075 / 0.2;
    - rollbacks across the grip, the closing and the set-down, plus a threaded check.
  - **BUZZ:**
    - a boom at 3 m startles it on the pad (Sound as cause, a blip, no tumble); one 13 m away doesn't;
    - mid-carry, a boom bobs it: carry → startled → carry, the load kept, still delivered;
    - sag and climb against the model switched off;
    - rollbacks across a startle in the air and on the pad, plus a threaded check.
  - **The threaded checks** compare the single-threaded build with the threaded build at 4 workers (`workerThreads: 4`), hash by hash.
- **`m5.test.ts`:**
  - **Rewritten** (the old "a STITCH behind it is held" encoded the no-occlusion rule): "TRACTOR BEAM carries at most 2 kg". A MAGLOCK off the axis but in the cone still strains. A STITCH on the axis passes beside it and is held; one in its shadow isn't.
  - **New:** a STITCH behind a FORCE WALL is pulled only after the wall switches off at 1 s, with two rollbacks across the switch.
- **`goldens_m5.test.ts` grabber:** two finger-opening assertions, re-pinned (above).
- **Fuzz:** the TURBINE (M2), TRACTOR BEAM / GRABBER (A5) and BUZZ (B5) entries pass unchanged.
- **Critter soak** (`apps/host/soak/critters.ts`, B5's): a new `m5.buzzStartles` stat.

## Results

**Suite and checks:**
- **Suite:** `pnpm -s vitest run packages/sim packages/parts-data`: **38 files, 833 / 833 passed** after the re-pins. Before them, the only failures were the 3 goldens above. My earlier baseline run had one environmental `onTaskUpdate` RPC timeout in `matter_sandstorm.test.ts` under load.
- **Threaded:** `KNOCKON_JOLT_THREADS=4` on `goldens_m5`, `m5`, `critters_m5`, `partsim`, `goldens_m2`, `fuzz` and `space_env`: **7 files, 196 / 196 passed**, with the same pinned hashes.
- **Static checks:** `pnpm -s typecheck` clean; `pnpm -s lint` (the determinism lint) clean.

**Critter soak, 5 min:**
- **First run** (before the sunk-load fix): 55 runs, 1.19 M ticks, 0 desyncs, 55 / 55 rollbacks, 117 BUZZ startles, **1 failure**. Seed 3: the ghost-carried SCOOP left the world under a HENNY-ridden BUZZ (above).
  - Bisected by switching the startle off: the failure went away. The startle changed the scenario's path into a pre-existing HENNY-on-BUZZ case.
  - Fixed with the set-down. Seed 3 then passes.
- **Final runs** (all fixes; the HOVER PAD restore change came after these, and the critter soak has no HOVER PAD):

| | single build (`--minutes 5`, seed 1) | `KNOCKON_JOLT_THREADS=8` (`--seed 1001`) |
|---|---|---|
| Duration, runs | 5.02 min, 57 | 5.05 min, 66 |
| Ticks | 1.23 M, 4,088 ticks/s | 1.43 M, 4,701 ticks/s |
| Hash checks | 13,680, **0 desyncs**, 57 / 57 rollbacks matching | 15,840, **0 desyncs**, 66 / 66 rollbacks matching |
| Ragdolls / getups | 397 / 395, 0 forced | 464 / 460, 2 forced (Pip, as in M2–M5) |
| BUZZ | 110 calls, 110 fetches, 86 deliveries, 31 tumbles, **120 startles** | 132 calls, 130 fetches, 109 deliveries, 39 tumbles, **126 startles** |
| States | 58 / 59 (Dusty's `scan`, as before) | 59 / 59 |
| Failures | **0: PASS** | **0: PASS** |

- **Final suite** (after the HOVER PAD fix): `pnpm -s vitest run packages/sim packages/parts-data`: **38 files, 836 / 836 passed**, `rollback_rule14.test.ts` included. Typecheck and lint are clean.

## Browser check (Vite 5322, local test server 8922, scratch data)

- **Setup:** I loaded the GRABBER Library demo through an inline share link (`#m=…`, made from `DEMOS.grabber`) into the game on local Vite (5322: the shared config with the proxy pointed at 8922, HMR off) and a local test server (8922, `KNOCKON_STATIC=none`, scratch `KNOCKON_DATA`).
- **Result:** the run starts, the timeline plays, and no JS error came from the scene code with the finger bodies.
- **Couldn't check visually:** the canvas was black, because the `parts` WGSL shader module was invalid at the time (`[Invalid ShaderModule "parts"]` for every pipeline). That's RENDER's area, presumably mid-edit, and reported, not touched. The GRABBER finger look needs a re-check once it renders.

## For other streams

- **RENDER:**
  - (1) `scene.ts` now skips GRABBER `piece` chunks ≥ 3 (the finger bodies). Please keep that guard if you touch the articulated branch.
  - (2) The finger opening in `grabberJoints` now slides at 0.2 m/s × supply instead of jumping. Nothing to change on your side.
  - (3) When I checked, the `parts` shader module failed to compile (black canvas).
- **AUDIO:** BUZZ's startle is a `CritterState` event with mag = `startled` (index of `CRITTER_FSM`) on a BUZZ part, cause = the Sound.
  - **Request:** a short rotor "hiccup" / surprised servo chirp for it.
  - **Captions:** "Buzz: startled!" (the "!" emote already fires).
- **UIFIX:** GRABBER zone A pointing: the sim now tolerates a zone height anywhere within the payload's height ± 1 cm. Pointing at the support surface is still the right fix.
- **Orchestrator:** D120 / D121 text is above for the decision log.
