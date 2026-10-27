# M5 notes: stream E5b (BUZZ art)

2026-10-25. Scope: BUZZ (critters.md "BUZZ: Ducted courier drone") at the M4 critter standard: a rigid robot critter like DUSTY (M4_NOTES_E4b), with a D78 texture set, LODs, KTX2 and the sim data agreed with B5. **Status: done.**

![BUZZ contact sheet](../../art/style-samples/m5_buzz.png)

## What was built

| | |
|---|---|
| Size (built LOD0, W × D × H) | 0.340 × 0.344 × 0.147 m: the duct span (the front nav domes add 3.5 mm in D), skids at z 0 to the whip's tip ball. The body top is z 0.085 |
| Tris LOD0 / 1 / 2 / 3 | 21,760 / 10,878 / 5,418 / 1,722 (50 / 25 / 7.9 %) |
| Rig | 13 deform bones: the brief's `root`, `body`, `pennant_01` (the whip antenna), `pennant_02` (the flag's tail half), plus the pivot-mirror bones `rotor_fl/fr/bl/br`, `visor`, `winch`, `claw_a/b/c` (the claws hang under `winch`) |
| Clips | 23: the 17 required, as drone behaviours, plus the role clips `takeoff`, `land`, `grab`, `carry`, `drop_off`, `deliver_bow` |
| Face | the LED visor `SCREEN__face` (icon, beam, 0.070 × 0.025); `faceTracks` on every clip with DUSTY's 12 icons |
| RAG__ | one rigid box, 1.1 kg |
| Texture set | 2048², 5 textured slots (bone, graphite, graphite gloss, ignition fabric, rubber), LOD0 2,262 px/m; KTX2 / BC7 built (`--ktx2`) |
| Validator | PASS, 0 errors, 1 warning: LOD0 is under the XL 25k floor, which the brief and ASSET_PIPELINE §4 allow for robot critters |

**Files:**
- Mine: `tools/blender/make_buzz.py`, `tools/blender/render_buzz.py` (look-dev and contact sheet), `assets/src/critters/buzz.blend`, `assets/src/critters/tex/buzz__body__*.png`, `assets/build/parts/buzz/*`, and `packages/assets/test/critters_m5.test.ts` (13 tests).
- Renders in `art/style-samples/`: `m5_buzz.png` (8 poses), `m5_buzz_turn.png` (front, 3/4, side, back), `m5_buzz_close.png` (hero close-up) and `m5_buzz_engine_close.png` (in engine, see below).
- Shared, additive edits made with the Edit tool:
  - `kn_tools/textures.py`: `SIZE_OVERRIDES` gives `buzz` 2048². A new `ONE_GAP = ('buzz',)` packs BUZZ's many small islands at the 1× padding gap. At 2× the gaps took most of the tile: 1,461 px/m, rising to 2,262 at 1×.
  - `kn_tools/rig.py`: a `rag_shape: 'box'` RAG exports `halfExtents` (engine axes), with `radius` set to half the X span.
  - `apps/game/src/artlist.ts`: `ART_CRITTERS` gets `'buzz'`.

**Rebuild:**
- Full build: `node tools/assets.mjs buzz --ktx2` takes about 2 min. As with DUSTY, the make script bakes its own set.
- Quick geometry pass: `make_buzz.py -- --no-tex`.
- Re-render: `blender -b --factory-startup -P tools/blender/render_buzz.py -- <out.png>` with `--turn`, `--close`, `--flat` or `--clips 'clip@sec,...'`.

## Agreed with B5 (M5_NOTES_B5 "For E5b")

B5 adopted these numbers, and `critters_m5.test.ts` checks the built art against `CRITTER_SPECS.buzz`.

**Ragdoll and collision**
- **Ragdoll:** `RAG__body` is one box, `shape: 'box'`, `halfExtents` [0.17, 0.045, 0.17]. Its a / b are (0, 0, 0) / (0, 0.09, 0), so it runs from the skids to the folded antenna. It is 1.1 kg, swing / twist 0, `phys = powder`.
- **Collision** (the brief; B5's `drone`):
  - `COL__box__0`: the body, 0.14 × 0.12 × 0.06 at z 0.055.
  - `COL__cylinder__1..4`: the ducts, Ø 0.11 × 0.035 at (±0.115, ±0.115, 0.066), `rubber`.
  - `COL__box__5`: the skids, 0.128 × 0.13 × 0.012 at z 0.006.

**Clips and the winch**
- **Clip names:** B5 appended the six role clips to `CRITTER_CLIPS` exactly as named.
- **Winch:** `PIVOT__winch` sits at (0, 0, 0.022), axis z, −0.60 … 0, `motion: 'slide'`, bone `winch`.
- **Carry clip:** it pays out 0.08 m (`CRITTER_M5.buzz.carryWinch`).
- **`grab` and `drop_off`:** they pay out 0.08 / 0.10 m and open the claw.
- **Altitude and travel are the sim's.** The one-shots end at their start height, except `getup`, which starts inverted on the floor and ends upright at rest.

**Claw and emitters**
- **`SENSOR__catch__claw`:** a sphere Ø 0.06 at root (0, 0, 0.008), riding the winch (`pivot: 'winch'`).
- **`EMIT__carry__claw`:** at (0, 0, 0.003), on the `winch` bone.
- **The visor emitter moved:** `EMIT__voice__visor` is now at (0, −0.068, 0.065), not −0.062 (see Deviations). B5's `eye` is `bl(0, −0.062, 0.065)`. That 6 mm is harmless, but B5 can align it.

## For R5 / the critter renderer

- **LED visor:** one `SCREEN__face` icon screen, drawn wider for the visor. It already draws in engine with R5's dot-matrix icons (`m5_buzz_engine_close.png`).
- **Pivot props on `PIVOT__rotor_*`:** `continuous`, `spin` cw / ccw (fl and br clockwise), `rps_idle` 45, `rps_max` 90 and `blur_rps` 20 (the brief's blur-disc swap).
- **Baked rotor speeds:** the clips bake slow whole-revolution spins (2–4 rps) so the three blades don't strobe. The renderer should spin them for real.
- **No blur-disc mesh is authored.**

**Winch and claw**
- **The winch is a translate pivot.** The sim's winch length comes in critterState bits 5–7 (B5).
- **The tether:** draw it as an engine rope (`kn_rope`, Ø 3 mm) from the spool to the `winch` bone head. The pivot carries `rope` / `rope_d`.
- **Claw fingers:** `claw_a/b/c` open 0–40° about their tangent hinges. These are nested pivots with `parent: 'winch'`.

**LED groups** (`ledGroups`, the `led` attribute)

| Group | Name | What it is | Default |
|---|---|---|---|
| 0 | `nav` | the white domes on the front ducts | |
| 1 | `ducts` | the white ring inside each lip | 0.8, ∝ thrust |
| 2 | `cargo` | the ring on the claw hub | off; Signal amber `#FFC21A` while carrying |
| 3 | `strobe` | the amber rear strobe | |

These aren't lit on the skinned path in engine yet.

- **One-shots:** `takeoff`, `land`, `grab`, `drop_off`, `deliver_bow` and `startled` are one-shots (`clipInfo.loop`).

## Deviations from the brief

- **The visor has no glass cover** (the M4 DUSTY call). The screen sits on a glossy graphite bezel (`kn_powder_graphite_gloss`, a quad-grid superellipsoid).
- **The screen is 6.9 mm more proud.** It sits at y −0.0679, not −0.061. At the brief's depth the bezel sat flush with the pebble's front, and the ±12° visor nod sank its lower edge into the body. The bezel now stands forward of the body.
- **Amber strobe in its own group.** It is LED group 3 `strobe`, not part of group 0 `nav`, because the engine tints a whole group one colour.
- **Antenna rig.** `pennant_01` is the whip itself, weighted from its boss up, so it can bend with airspeed and fold flat in `tumble` / `getup`. The flag blends smoothly from `pennant_01` to `pennant_02`.
- **One texture set**, not "2048² + 1024²" (as DUSTY).

## Engine check

I started my own bench Vite on :5395 (the shared :5185 wasn't running) and stopped it afterwards. The view is the hero harness, `?tier=32&w=1920&h=1080&critters=buzz,dusty&tilt&clean`, with:
- the camera swapped through `renderer.setCamera`;
- depth of field off;
- the BUZZ skinned item moved off the key-art machine. The harness lines extra critters up inside the plank and ball.

The capture is `art/style-samples/m5_buzz_engine_close.png`. The texture set, ducts, rotors, pennant and the lit LED visor read as in Cycles. Under the warm grade the graphite ducts read near-black, like DUSTY's lid.

## Validation and tests

- **Validator:** PASS, 0 errors, 1 warning (the robot tri floor).
- **`pnpm -s vitest run packages/assets`:** 17 files, 1,485 passed, 3 skipped.
- **`critters_m5.test.ts` covers:**
  - LOD ratios and budget, and the brief size;
  - the rig tree, skinning, clips against `CRITTER_CLIPS` and the spec, seamless loops and one-shot end heights;
  - face tracks and icons, the screen and LED groups;
  - pivots (rotors, visor, winch, claws), the claw sensor and emitters;
  - collision against B5's `drone`, and the ragdoll against `BUZZ_RAG`;
  - the 2048² set with KTX2, texSet and TANGENT;
  - `ART_CRITTERS`.
- **`pnpm -s typecheck`:** 2 errors, both in A5's `packages/sim/src/channels/m5_misc.ts` (`hoverC` is not on `M5Parts`). They are not mine and I didn't touch them.

## Open issues

- **Hero harness placement:** it puts extra critters inside the key-art machine. Every M4 / M5 close check has had to move them by hand.
- **Lighting the LED groups on the skinned path** (nav, ducts, cargo, strobe) is renderer work.
