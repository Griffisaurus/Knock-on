# M2 notes: stream E2 (critter and environment art)

2026-10-24. Scope: MOCHI, PIP, GOBY and BANDIT (critters.md) and the MEGA KITCHEN (environments.md §2). Pipeline details are in [PIPELINE_STATUS.md](../art/PIPELINE_STATUS.md#m2-critters-and-the-mega-kitchen-stream-e2).

## What other streams need to know

### Stream C (renderer)

- **Critter glbs** live at `assets/build/parts/<critter>/<critter>.glb`. Each has:
  - nodes `LOD0..LOD3`, each holding one skinned mesh `<type>__body[__L<n>]`;
  - one skin made from the `RIG` armature. All bones are joints, including Bandit's non-deform `prop_r` socket;
  - one glTF animation per clip, named `<type>__<clip>`. Clips are sampled every frame at 30 fps, and `root` never moves.
- **Origin and the root bone:** the part origin is the centre of mass, which is the locomotion capsule's centre. The `root` bone sits on the floor at `.art.json → rig.rootPos` (part space, engine axes).
  - The skinned mesh therefore sits directly at the base body's transform.
  - For root-space data from parts-data (`RagBone.at`, `capsule.at`), use part = root-space + `rig.rootPos`.
- **Face morph targets** are on LOD0 and LOD1 only: 17 ART_BIBLE §8 keys plus 3 extras per critter, positions only. Names are in the mesh `extras.targetNames` and in `.art.json → shapeKeys`.
  - The Blender exporter writes them as **sparse accessors**. `parseGlb` doesn't read targets today; when it does, it needs sparse support.
  - Dense targets would cost about 5–10 MB per critter.
- **Materials are master ids.** The brief's texture-mask regions are separate flat masters until the 4096 body sets are baked: `kn_fur_<critter>` plus `_points`, `_white`, `_rose`, `_stripe`, `_cream`, `_pink`, `_belly`, `_fin`, `_fin_edge`, `_mask` and `_hands`. They are in `materials.blend` and `kn_tools/masters.py → FUR_HEX`.
- **`.art.json` extras for critters:**
  - `rig` (bones with parent, head, tail and deform; `rootPos`);
  - `ragdoll` (see below);
  - `clipInfo` (frames, seconds, loop);
  - `roleClips`, `shapeKeys`, `emitterBones` (EMIT__ → bone), `comRoot`;
  - `skin.morphLods`.
- **Kitchen:** `assets/build/env/kitchen/kitchen.glb` has these top-level nodes:
  - `LOD0..LOD3` (123,104 / 58,028 / 28,994 / 8,552 tris);
  - `BACKDROP` (garden, sky card, hallway; 4,084 tris);
  - `REF__scale__room` and `REF__scale__warehouse` (the env_scale_ref prefab per preset; show only the active preset's).

  The glb is in **set (Warehouse) coordinates**. For the Room preset, draw it at `-KITCHEN.presets.room.origin` = (0, 0, +24). `KITCHEN.light` carries the §2.3 morning rig: sun direction, 4300 K, haze and EV.

### Orchestrator (sim wiring)

- `packages/parts-data/src/env_kitchen.ts` is generated (literals only, so it passes the determinism lint). It contains `KITCHEN.presets.{room,warehouse}`, each with:
  - `boxes`: 212 static AABBs per preset, as `{name, center, half, phys}`;
  - `spheres`: 6 per preset (the 5 fruit-bowl oranges and the scale-ref THUD);
  - `bounds`, `neutral`, `camera`, `target`, `drones` and `scaleRef`.

  Every value is in that preset's own world coordinates.
- Not yet exported from `parts-data/src/index.ts`, which is not my file. Add `export * from './env_kitchen.ts';` when you wire it.
- Physics materials used: `powder`, `wood`, `ceramic` (the floor), `steel`, `glass`, `rubber` and `paper`.

## Contract 3 (ragdoll) vs `packages/parts-data/src/critters.ts`

**The ragdolls agree.** The RAG__ capsules in all four critters are stream B's `MOCHI_RAG` / `PIP_RAG` / `GOBY_RAG` / `BANDIT_RAG` rows, copied as data into `make_<critter>.py → ragdoll()`. That covers bone, parent, joint `a`, end `b`, radius, mass, swing and twist. `packages/assets/test/critters.test.ts` fails if they drift: positions are checked to ±1 mm, and mass, swing, twist and parent must match exactly.

**The locomotion capsule (`COL__capsule__0`) agrees** with `CritterSpec.capsule` (radius, length, centre).

| Critter | Capsules (bone ← parent: mass kg, swing° / twist°) | Total |
|---|---|---|
| MOCHI | hips (root) 0.93 20/10 · spine_02←hips 0.70 25/15 · spine_03←spine_02 0.70 25/15 · neck_01←spine_03 0.15 35/25 · head←neck_01 0.50 40/30 · upperarm_l/r←spine_03 0.12 70/20 · forearm_l/r←upperarm 0.06 70/10 · thigh_l/r←hips 0.20 70/20 · shin_l/r←thigh 0.08 70/10 · tail_01←hips 0.06 60/30 · tail_04←tail_01 0.04 60/30 | 15 · 4.000 |
| PIP | hips (root) 0.035 20/10 · spine_02←hips 0.035 25/15 · head←spine_02 0.03 40/30 · upperarm_l/r←spine_02 0.005 70/20 · thigh_l/r←hips 0.005 70/20 (one per limb, r 4.2–4.5 mm) | 7 · 0.120 |
| GOBY | spine_02 (root) 0.009 · head←spine_02 0.009 · spine_04←spine_02 0.008 · tail_c_01←spine_04 0.004 (all 30/10) | 4 · 0.030 |
| BANDIT | hips (root) 1.5 20/10 · spine_02←hips 1.0 25/15 · spine_03←spine_02 0.94 25/15 · head←spine_03 0.7 40/30 · upperarm_l/r←spine_03 0.15 70/20 · forearm_l/r←upperarm 0.08 70/20 · thigh_l/r←hips 0.25 70/20 · shin_l/r←thigh 0.1 70/20 · tail_01←hips 0.12 60/30 · tail_04←tail_01 0.08 60/30 | 14 · 5.500 |

### Mismatches to resolve (not edited; parts-data is stream B's)

| Item | Art | parts-data | Note |
|---|---|---|---|
| Brief masses | Pip: none. Bandit: none (as B) | B sets Pip hips 0.035 / spine 0.035 / head 0.03, and Bandit hips 1.5 / spine 1.0 / 0.94 / head 0.7 | The brief only gives the totals (0.12 / 5.5 kg). The art follows B |
| MOCHI spine_03 swing | 25° (follows B) | 25° | The brief reads "spine_02 / _03 (0.70 each, 25° / 15°)" as swing / twist for both. Agreed |
| Def bounds (`critterDef(...)` min / max) | MOCHI rest pose 0.18 W × 0.45 H × 0.56 D (tail tip at 0.44 m, whiskers ±0.09) · BANDIT 0.22 × 0.31 × 0.72 (with the tail) · PIP 0.083 × 0.087 × 0.132 · GOBY 0.053 × 0.057 × 0.095 | MOCHI x ±0.08, y 0..0.37, z −0.22..0.26 · BANDIT x ±0.09, z −0.45..0.26 | The bounds leave out the tail tips (Mochi's tail rises to 0.44 m) and the whiskers. Only placement / selection bounds; widen them if the editor box should enclose the art |
| `BANDIT_PROP_R` | `prop_r` bone at rest (quadruped, palm on the floor): root space (−0.06, 0.012, 0.13) engine; posed by the clips | [−0.05, 0.22, 0.17] (bipedal carry) | The sim value is a pose-specific point. The renderer should attach stolen items to the animated `prop_r` joint |
| BANDIT eyes | Eye spheres at root (±0.032, −0.213, 0.236), 8 mm forward of the brief so they clear the head | `eye: bl(0, −0.205, 0.235)` | `EMIT__look__eyes` stays at the brief's point; the vision origin is unaffected |

## Deviations from the briefs

- **Bone names.** MOCHI's hind paw and toe bones are `hindpaw_l/r` and `hindtoe_l/r`, because the brief names both front and hind `paw_l/r` / `toe_l/r`, which can't coexist. The other critters follow their briefs exactly.
- **Texture masks.** The texture-mask regions (points, belly, stripe, mask, fins' peach → cream fade, tail rings) are flat `kn_fur_*` region masters, not one textured master. Slot counts:

  | Critter | Slots | Brief |
  |---|---|---|
  | MOCHI | 7 | 4 |
  | PIP | 7 | 3 |
  | GOBY | 7 | 3 |
  | BANDIT | 8 | 4 |

  All are within the 12-slot hard cap and use no textured slots.
- **Shell fur and sculpted clumps are not modelled.** The body is a smooth soft-sculpt metaball surface (ART_BIBLE §8 "smooth primary volumes").
- **BANDIT's satchel** is centred at x 0.098, not 0.07: the 0.07 centre is inside his 0.08 m flank.
- **Face keys.** There are 20 per critter: the 17 of ART_BIBLE §8 (blink l/r, happy, smug, scared, angry, dizzy, sleepy, surprised, determined, vis a/o/e, brow up/down l/r) plus the brief's 3 extras.
  - GOBY has upper lids only.
  - The ears are bones.
  - The mouth is a dark lozenge on the jaw bone.
- **Procedural springs** (tail, ears, collar tag, satchel) are not baked. The engine layers them over the clips (briefs: "procedural spring").
- **Kitchen collisions.**
  - All colliders are boxes, as contract 5 asks. The brief's `COL__mesh` sink basin and fruit bowl and `COL__hull` / `COL__capsule` props (mixer, kettle, dish rack, tap, handles) are approximated by boxes that hug the visible shapes; the oranges and the THUD are spheres.
  - The pulls on the lower and upper cabinets have box colliders (§2.6 "balls can catch on them").
- **Kitchen layout.**
  - The left counter runs Y −24…+29 to meet the back run at the corner; the brief's +26 left a 3 m gap. The stove sits at Y −2…+2.
  - The chairs have 6 boxes each (seat, back, 4 legs) instead of 5.
- **Kitchen deferred work.**
  - The "MORNING CRUNCH" and "MOCHI" decals, because the atlas has no such slots.
  - Chunking (CHUNK__ empties, HLOD), reflection probes, the under-cabinet LED strip and the sink's baked stain mask.
  - The window light shafts, which need the engine's froxel fog.
- **Kitchen budget.** LOD0 is 123k tris. The brief's budget for the Warehouse is 420k, so there is room for detail later.
- **Kitchen LODs** are re-built at a lower segment count, not decimated, so they land at 47 / 24 / 7 %. Environments have no ±10 % LOD rule.

## Tests and checks

- `packages/assets/test/critters.test.ts` has 33 tests, 8 per critter plus 1 that runs the shared reader over every critter. Per critter it checks:
  - the LOD ratios and the XL budget;
  - the rig: ≤ 80 deform bones, the standard bones, one root on the floor, and skin joints equal to the rig;
  - that every LOD is skinned with normalised influences, ≤ 4 per vertex and no JOINTS_1;
  - that every sim clip is present, sampled at 30 fps, with no root motion and sane scale;
  - that loops are seamless;
  - the face morph targets;
  - the ragdoll against parts-data;
  - the locomotion capsule against parts-data.
- `packages/assets/test/kitchen.test.ts` has 10 tests:
  - the preset sizes and origins;
  - collider validity (≥ 5 mm, known phys, floor top at y = 0, unique names);
  - the neutral zones are ≥ 8 × 8 m and free of colliders;
  - spawn, camera elevation 30°, drones, and the scale ref within 6 m of the zone's front-right corner;
  - the Room preset is the Warehouse set shifted;
  - glb LODs, backdrop and refs;
  - every collider box matches visible LOD0 geometry.
- **Validator rule 11** is in `tools/blender/kn_tools/rig.py` and called from `validate.py`. It checks:
  - bone count, root, head and spine, the tail ≤ 8 and naming;
  - every LOD skinned to RIG, ≤ 4 normalised influences, weights only on deform bones, and Armature as the only modifier;
  - shape-key naming, with a warning if the face set is incomplete;
  - 30 fps, the required clips plus `kn_role_clips` as NLA-tracked actions, and no root motion;
  - the RAG__ capsules: deform bone, swing / twist / mass, ≥ 5 mm, convex, one tree, every major bone covered, and masses summing to `kn_mass_hint`.

  `tools/blender/selftest_critter.py` breaks a clean PIP 10 ways and expects rule 11 to catch every one. It runs from `node tools/assets.mjs --selftest`.
- `pnpm vitest run packages/assets`: 359 passed, 3 failed. All 3 failures are in `m2_parts.test.ts` (stream E1: stitch is not in ART_PARTS, the turbine footprint, the scoop bail facing).
- `pnpm lint`: `env_kitchen.ts` is clean. The one finding is in `defs_m2.ts` (stream A, `Math.atan2`).
