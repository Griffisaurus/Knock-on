# M5 notes: X5 · Matter M5

Stream X5 owns `packages/matter/**`, `packages/sim/src/matter/**` and `apps/game/src/gfx/matter/**` (goo). Vite 5308,
host 8908 with its own `KNOCKON_DATA` (scratch configs, removed at hand-back); the MX harness on 5201.
Plan: [M5_PLAN.md](M5_PLAN.md). Status: **done** (2026-10-25, started 10:20 after the D101 water-buoyancy session
landed). D91 matrix on the final kernels: **PASS** ([M5_SANDSTORM_MATRIX.md](M5_SANDSTORM_MATRIX.md)).

## What landed

| Area | Files | Summary |
|---|---|---|
| Goo (kind 3) | `packages/matter/src/{backend,constants,cpu,wgsl,prep}.ts`, `gpu/index.ts`, `node/parallel.ts` | Appended kind (ids never move), own grid range appended to the key table (sand / water / marble keys unchanged), spring + viscosity solve, sticky proxy contact. CPU = GPU on D3D12, D3D11, SwiftShader |
| D104 world gravity + zones | same, plus `packages/sim/src/matter/{host,units,contract}.ts` | `MatterStepIn.gravity` (Q8, exact Bresenham split per substep; Earth = the M4 constant bit for bit) and `MatterStepIn.zones` (cylinders / boxes, per grain) |
| Moon regolith for grains | `packages/sim/src/matter/terrain.ts` (new) | Heightfield cells under the active region as static oriented-box tiles |
| GOO VAT | `packages/parts-data/src/defs_m5_matter.ts` (new); `channels/m4_matter.ts`, `channels/m4.ts` (Edit) | A4's dispenser with goo: def, card, demo; Matter on and off |
| QUACK keel | `parts-data/defs.ts` `body.com` (Edit), `defs_m4.ts` QUACK (Edit), `sim/machine.ts` `comShape` (Edit) | COM 10 mm lower: rights itself from any landing |
| Rendering | `apps/game/src/gfx/matter/{wgsl,index,fill,containers,types,dev}.ts` | Goo through the screen-space fluid surface with a kn_slime composite; GOO VAT fill pass |
| Audio | `apps/game/src/audio/{matter,matterprobe}.ts`, `matter-processor.js` (Edit); `audio/goovat.ts` (new), `audio/index.ts` (one import, Edit) | Goo as the probe's 4th kind (8 granular streams); GOO VAT part cues through F5's `M5_EXTRA` hook |
| Tests | `packages/matter/test/matter.test.ts`; `packages/sim/test/{matter_goo,matter_gravity}.test.ts`, `fuzz_scenes_x5.ts` (new); `fuzz.test.ts`, `goldens_m4.test.ts` (Edit) | Goldens, CPU = GPU scenes, rollback, fuzz |
| Docs | SIMULATION §8 (banner, §8.1, §8.2, §8.5, new §8.7) | As built |

## Decisions (provisional, for the orchestrator; no new D-numbers taken)

1. **Goo model: a spring fluid, not water's double-density solver.** Tried first: water's solver with a 3× cohesion
   clamp; it overshot and blew small blobs apart (a 27-particle cube of *water* does the same at zero g; water in M4
   always sits in containers so it never showed). The spring model is averaged like the grain contacts, so it's stable.
   Its cohesion stays weak next to its push (else a blob has no resistance to squashing: an early version collapsed
   into a pancake), so goo holds together, flows like syrup and drips, but a big blob doesn't hang from a ceiling (one
   layer sticks, the rest drips off within ≈ 0.1 s).
2. **Goo sticks to proxies with a yield**, booked as impulse like friction: drag on bodies moving through it, the weight
   of goo hanging under a lid. `GOO_STICK` was tuned from 96 down to 24: at 96 a ball at 1 m/s took 36 N of drag.
3. **Goo isn't buoyant and isn't in the water-surface map** (denser than water, 1,050 kg/m³, and viscous): nothing
   floats in it; bodies sit in it on the particle contacts.
4. **Gravity mapping `G = 192 + 2,624 × p`** (Q8): the damping's truncation removes ≈ ¾ unit per substep from any
   moving grain whatever the gravity, and Earth's calibration contains it; a pure `2,816 × p` made Moon grains fall at
   ≈ 53 % of the intended rate. With the mapping, drop times over 5–50 cm are Earth's × 1/√p within 4 %. 0 % is exactly
   0 so zero-g grains never drift.
5. **Proxy push rounding made sign-symmetric** (`shrS` instead of `>>`), a solver fix with golden fallout: the floor
   shift pushed every resting grain one unit toward the downhill side of any tilted surface per iteration; at Moon
   gravity (pen ≈ 2 units, kinetic friction rounding to 0) sand piles slid off a 2.3° slope like ice (1.1 m in 4 s;
   now 0). Earth worlds change only where grains touch tilted or rotating proxies.
6. **Moon terrain as tiles** (orchestrator's item 3): one static oriented box per 0.5 m heightfield cell under the
   active region (≤ 2,048), top = the fitted plane, skipped under the apron. The Matter floor plane moved to the
   catch-all floor (−1 m in both space sets), matching Jolt.
7. **No wind and no air % for grains** (orchestrator's item 4): `env.wind` stays rigid-only; Matter's damping is a
   solver constant, so Moon grains keep it.
8. **QUACK's keel** is a new optional `PartDef.body.com` (Jolt `OffsetCenterOfMassShape`), used only by QUACK
   (10 mm down). 18 mm also self-righted but rocked ±1° for seconds in a still pond; 10 mm settles cleanly.

## Goldens re-pinned (reasons)

| Golden | Why |
|---|---|
| `packages/matter/test` `GOLDEN_MIX` | Decision 5 (the mix scene's tilted ramp and spinning paddle). `GOLDEN_STORM_20K` (30 ticks) is unchanged: the slope's normal has no negative components and the slab doesn't reach the wheel |
| `goldens_m4` `quack` (hash) and the QUACK demo (STITCH from 1.2 m, was 0.8) | Decision 8: with the keel the duck's bounce changed and the STITCH's bonk fell inside the 0.15 s squeak cooldown (one squeak instead of two); the demo now drops it later so it still shows both |
| New: `GOLDEN_GOO`, `GOLDEN_LOWG`, `goo_vat` demo hash | First pins |

Unchanged: every Matter-off golden (M1–M4), and every sim Matter-on test and pinned hash (`matter_host`, `matter_cpu`,
`m4_matter`, `matter_buoyancy`, `matter_sink`, `matter_near`, `matter_sandstorm`, `critters_m4`) on the final kernels.
Earth worlds send exactly the M4 command (no `gravity`, no `zones`), and Matter worlds without goo hash as in M4.

## Proofs

- **CPU = GPU** (harness `?mode=m5`, also in `?mode=proof`): `goo` (260 ticks: rope, puddle, hanging lid, rolling ball,
  all four kinds, a goo intake, a blast, a query) and `lowg` (300 ticks: Moon gravity, a zero-g cylinder zone, a
  half-g box zone, a spinning paddle) are equal every tick (checksum, counts, bounds, absorbed, impulses, queries),
  with byte-identical snapshots and restore round trips, on **D3D12, D3D11 and SwiftShader**. The CPU reference is the
  4th implementation. Re-run on the final kernels: the full `?mode=proof` (ballistic, mix, pool, goo, lowg, sand box,
  Sandstorm 60k cut) PASS on D3D12 and D3D11, `?mode=m5` PASS on SwiftShader.
- **D91 Sandstorm matrix** (4M grains, final kernels): CPU reference = D3D12 = D3D11 over ticks 1–120, D3D12 = D3D11
  over 1–600, all four (with SwiftShader) over 1–30, checksums and all wheel impulses: **PASS**
  ([M5_SANDSTORM_MATRIX.md](M5_SANDSTORM_MATRIX.md)). Checksums differ from M4's from tick 9 (decision 5), as
  expected; M4's result files are kept in `tools/vendor-matrix/results/m4/`. Times (contended): CPU 18.5 s/tick,
  D3D12 285 ms, D3D11 360 ms, SwiftShader 102 s.
- **Node** (`packages/matter/test`): goldens, goo cohesion / intake / drag / lid weight / ramp creep, gravity split
  exactness, Earth-explicit = default, fall times vs 1/√p, no creep on tilted surfaces at any gravity, zones, the
  parallel driver = serial on goo and zones.
- **Sim** (`matter_goo.test.ts`, `matter_gravity.test.ts`): GOO VAT golden (Matter off), Valve toggling, pour → live
  goo, a STITCH caught (1.15 m vs 2.2 m without goo), lid refill (goo only), replay + late-poke rollback through a
  pour; world gravity in the command (Earth omitted), Moon / Hangar slower falls, zero-g zone floats (off: falls),
  rollback through a zone, Moon sand on the regolith + rollback, QUACK rights itself from 5 orientations.
- **In the game** (local Vite 5308 + host 8908, `?debug`, a GOO VAT, TANK and GRIT HOPPER placed with `__kn.net` and
  run): the goo pours into a green puddle, sand and water pour beside it, **no console errors or WebGPU validation
  errors**. R5's reported `matter.params*` 64 < 80 and `matter.state` usage errors were from a few minutes mid-edit
  (the WGSL `Params` grew before `gpu/index.ts` was updated); `GOO_KC` likewise existed again once the goo model
  settled. Both files agree now; the harness compiles all 33 kernels on D3D12.

- **Moon in the game:** the same world switched to MOON BASE (`EnvUpdate` environment moon, gravity 16.5 %, air 0 %)
  with an open GOO VAT and GRIT HOPPER: the sand falls as a slow, spreading column and piles on the apron, the goo drools
  into a puddle; no console errors.
- **Browser wire fix found on the way:** `matter/pack.ts` (sim worker ↔ GPU host) carried 3 kinds and no gravity or
  zones, so in the browser goo absorption, goo counts and D104 would have been lost (a desync against the CPU path).
  It now carries 4 kinds, `gravity` and `zones` (round-trip test in `matter_gravity.test.ts`).

## Performance (measured; GPU shared: nvidia-smi 55–66 % utilisation, 135–180 W from other streams, so provisional)

| Run | Result |
|---|---|
| Harness perf, settled sand box 1M (reference) | 26.2–28.7 ms per Matter tick (M4 measured 11.4 on a quiet GPU) |
| Harness perf, settled goo box 100k | 6.7 ms per Matter tick |
| Harness perf, settled goo box 1M | 49.0 ms (goo kernel 41.4 ms, profiled): ≈ 2.1× sand's cost per particle under the same contention (≈ 60 candidates in 27 goo cells, a sqrt and a division per pair) |
| Empty-kind skip (goo / marble / water kernels don't walk a kind with no particles) | goo 1M 61.1 → 49.0 ms, goo 100k 9.4 → 6.7 ms; results identical (same checksums) |
| A full GOO VAT (4,230 goo) | ≈ 0.3 ms of goo kernel per Matter tick (scaled from the 100k box) |
| Dev page `?scene=realgoo` (1.3k goo + sand + water on screen) | Matter on − off: 0.44 ms per frame (interleaved A/B) |

## Rendering (gfx/matter)

- **Free goo:** kind 3 goes to the fluid list with water. The splat uses goo's radius and writes a goo thickness into a
  new third channel of the thickness target (now `rgba16float`); the smoothing pass packs the goo share into the
  water texture's `w` (1 + share); the composite blends the water look into kn_slime: albedo #7DFF7A, transmission 0.6
  (Beer–Lambert, 55 /m), a wrapped-light subsurface glow, a glossy F0 0.04 skin, firmer edges. Goo casts shadows.
  `MATTER_LOOK.goo / gooAbsorb / gooSss / gooTransmission` tune it live (dev page `?scene=realgoo` runs the goo scene on
  MX's GPU backend; `reallowg` the low-g one).
- **GOO VAT fill pass:** `CONTAINER_TYPES` + `goo_vat`, contents kind 4 (kn_slime + subsurface), `DEFAULT_FILL` 0.85,
  a built-in cavity (the art's `CAVITY__goo` wins when it loads).
- **Cost:** goo rides the water passes (no new targets; the thickness target grew from rg16 to rgba16). Device loss:
  nothing new to rebuild (the renderer's `init()` path covers it). VRAM ledger: the existing `matter.*` labels.

## Audio

- `matter.ts`: `MATTER_KINDS` + `goo` (squelch grains: a falling-pitch suction pop with a low smack, 18 variants;
  fallback beds `loop/matter/goo/{sparse,dense}`), `MATTER_STREAMS` = kinds × 2 = 8 (still one voice each).
- `matterprobe.ts`: kind clamp 0–3 (the probe's arrays grow from 72 to 96 sums: kinds × bands × 8).
- `matter-processor.js`: 8 outputs by default; goo's bed modulation (slow heavy surges).
- `goovat.ts` registers GOO VAT in F5's `M5_EXTRA`: `goovat/valve` on Valve, `goovat/drip` on Empty, a refill gloop when
  the meter rises, and loops `goovat/pour` (while lit), `goovat/blorp` (idle, by fill) and `goovat/stir` (faster while
  pouring). F5: please give them a listen; they follow your m4.ts TANK cues' levels.

## For other streams

- **R5:** your three `R5 (M5)` edits in `gfx/matter/wgsl.ts` are kept (the shadow radius is now one helper, `sRadius`,
  which still includes your water radius, marked).
- **F5:** see "Audio". The worklet's default stream count is 8 and `MATTER_STREAMS` follows `MATTER_KINDS`.
- **W5:** grains follow `gravityPercent` and the Hangar zones (`env.zones` passed to the Matter host through the
  Machine's options), and the Moon's regolith; the env object the Machine hands `MatterHost` grew
  `gravityPercent` / `zones` (one-line Edit in `machine.ts`).
- **A5 / U5:** GOO VAT is registered after your PARTS_M5 / CARDS_M5 / m5Demos (`defs_m5_matter.ts`); `M5_TYPES` doesn't
  include it (its sim runs in M4Parts). HOW_TO_PLAY: the card says what it does (U5's file, untouched).
- **D5:** SIMULATION §8 is as built (§8.7 new); other docs still say "X5, in progress" in places (GAME_SPEC §6.4,
  RENDERING §0 slime, AUDIO §0) — yours to sweep.
- **T5:** goo costs the water passes (render) and one gather kernel per iteration (sim); see "Performance".

## Log

- 2026-10-25 10:20 started; read the plan, decisions, SIMULATION §8, the MX / MI / R4 / F4 notes and the code.
- 11:10 goo + gravity + zones in the core; M4 goldens unchanged. Water's double-density model for goo rejected
  (unstable), spring model in.
- 11:40 GOO VAT, sim plumbing (kinds 4, containers 7 wide), Moon tiles; the sloped-tile creep found and fixed
  (decision 5); gravity mapping re-derived (decision 4).
- 12:30 QUACK keel; rendering; audio; the in-game checks (Tinker, Moon); the browser wire fix (pack.ts).
- 13:30 perf; the empty-kind skip; final proofs on D3D12 / D3D11 / SwiftShader; D91 matrix PASS.
- Hand-back: `pnpm -s typecheck` clean, `pnpm -s lint` clean, `pnpm -s vitest run` 85 files pass.
