# M2 notes: stream C (graphics)

2026-10-24. Scope: PRODUCTION §2 M2 Graphics plus contracts 3–5 in [M2_PLAN.md](M2_PLAN.md). Everything below was checked in Chrome (NVIDIA Blackwell, 1280×720, 4× MSAA) on a local Vite server (port 5174) against the shared host world. The test parts I added (two GUTTER runs, one MOCHI) were removed afterwards.

## What landed

| Item | Where | Notes |
|---|---|---|
| Transmission | `gfx/shaders.ts` `glassWgsl`, `gfx/renderer.ts` (`prepareGlass`, `drawLate`), `gfx/glbmesh.ts` | `kn_poly_*` and `kn_glass` primitives become `<mesh>:glass` / `<mesh>:arm:glass` meshes flagged `glass`. They never enter the opaque or shadow passes. Each frame the visible glass instances (scene and overlay) are frustum-tested and sorted far to near on the CPU, then drawn back faces first and front faces second. The pass continues on the MSAA colour and depth targets (`loadOp: load`), so coverage stays per sample, and it refracts a resolved copy of the opaque scene (`sceneTex`). With `dual-source-blending` (Chrome has it) the blend is `dst × T + C`, a coloured tint; without it T is a scalar. The shader adds Fresnel (Schlick plus an art-directed rim), key/fill/rim highlights, sky reflection, emissive for lit bulbs, and a screen-space refraction offset along the view-space normal (`renderer.refraction`, default 0.03). When nothing glassy is in view the frame keeps the single M1 main pass. |
| Skinning | `packages/assets/src/glb.ts`, `gfx/skin.ts`, `gfx/critters.ts`, `gfx/skintest.ts` | **Parser:** skins (joints, inverse bind matrices, skeleton), `JOINTS_0`/`WEIGHTS_0` (u8/u16, float/unorm, renormalised), animations (channels and samplers: LINEAR with slerp, STEP, CUBICSPLINE), local TRS on every node (`decomposeTrs` when a node gives a matrix), `sampleAnim`, `slerpInto`, and an `encodeGlb` writer. Skinned vertices stay in bind space, as glTF requires.<br>**Renderer:** `SkinLibrary` has its own vertex, joints/weights (8 B) and index buffers. `renderer.addSkinnedMesh` and `setSkinned(items)` take 3×4 bone matrices in a storage buffer. GPU skinning runs in `vs_skin` and `vs_skin_shadow`, and skinned meshes share `fs_part`, so cutaway, section box and x-ray apply to them too.<br>**Animation:** `Rig` evaluates clips with cross-fade or takes per-bone overrides.<br>**Critters (contract 3):** `CritterView` plays `<type>__<clip>` by `run.critters` byte 0 (`CRITTER_CLIPS`) on the render clock (× speed, frozen when paused), with a 0.25 s cross-fade. When ragdolled (byte 1 bit 0), each `RAG__` bone takes its rag body's transform × inverse(capsule rest `at`/`rot` from the def) × bone rest, and the other bones follow their parent at rest. In build mode critters play `idle` at the part pose. |
| X-ray | `renderer.setXray` | `links` dims and desaturates the art, then draws every `xray` overlay item (links from `linkItems`, ports from `portItems`) as an additive glow at any depth, in full-saturation channel colour. `all` also draws hidden parts' rims through geometry (depth `greater`). In x-ray mode main.ts shows every part's ports. |
| Cutaway | `renderer.setCutaway`, `cutawayFocus`, `cutawayRadius` | A cone from the eye to the focus (default: the camera target; radius auto 0.2 × distance) cuts geometry closer than the focus. The soft edge is dithered across the MSAA samples by alpha-to-coverage. Cut shells show their inner faces, darkened (cull-none pipeline variant, only while it is on). |
| Section box | `renderer.setSectionBox` | Fragments outside the box are discarded in every part pass and in the shadow pass (a `vs_shadow_clip` variant), so the inside is lit. The cull compute skips instances wholly outside the box. Cut solids are **capped**: back faces seen through a cut are shaded as the cap plane, with the box-face normal and a 45° cross-hatch at 3 cm. The Studio floor is not clipped. |
| Selection outlines | `renderer.setSelection`, `gfx/post.ts` | A mask pass draws the selection (strength 1), partner/lock outlines (from `SceneItem.outline`, 0.9) and the hovered instance (0.5) into an rgba8 mask. The composite dilates the mask 2 CSS px (16 taps, two rings) outside the silhouette in that colour, after tonemapping, with a 7 % fill inside. This replaces the M1 Fresnel tint. D's `buildtools.ts` already calls `setSelection`. |
| Cameras | `apps/game/src/cameras.ts` | `CamMode = 'orbit' | 'director' | 'ride' | 'overview'` and `CameraRig`; **C** cycles and **F** frames the selection. See the section below. |
| Mega Kitchen | `gfx/environment.ts`, `artlist.ts` `ART_ENVS`, `vite.config.ts` `buildAssets('env')` | When `doc.env.environment === 'kitchen'`, `/env/kitchen/kitchen.glb` is drawn instead of the Studio cove and its T marks, with a kitchen look (`KITCHEN_MORNING`: 4,300 K sun through the window from −Z, warm haze) and no Studio floor. The set is re-centred per preset on its `BOUNDS__<preset>` node (a mesh's floor centre, or an empty's origin), or on the brief's numbers when there is none (Room: z + 24). Helper nodes (`BOUNDS__`, `COL__`, `EMIT__`, `SPAWN__`, `NEUTRAL__`) are not drawn. The kitchen's glass goes through the glass pass. Until the glb exists, or while it loads, the Studio stays up. |
| GUTTER (orchestrator request) | `gfx/gutter.ts` | `gutter` and `gutter_slim` links sweep the closed profile from `gutter.profile.json` (LOD0, per-edge masters: Bone inside, Cobalt outside and lips) along the same `roundPath` and bend radius as A's colliders, in the sim's frame. Kit pieces from `gutter.glb` are baked into the same mesh: a stop at the start, a spout at the end, straps evenly spaced at most 0.5 m apart, and saddles mid-span under raised, gently sloped runs, with a Cobalt post down to the floor. A plain half-pipe stands in until the art loads. |

## Stream E2's art, checked in Chrome

- **Critters:** `/parts/{mochi,pip,goby,bandit}/` load as skinned art, LOD0 only, with 44, 29, 28 and 44 joints. Idle plays in build mode. A run plays B's clips (pounce, flee, flop, tumble…) and ragdolls on a shove or blast, and the ragdolled bodies stay coherent (no stretched vertices).
  - **Origin:** the glb is authored around the COM, while the sim's base body and B's `RagBone.at/rot` are relative to the `root` bone on the floor. The renderer reads `rootPos` from the glb's `root` rest pose (it matches `.art.json` `rig.rootPos`): it draws the mesh at base × T(−rootPos) and composes each capsule's rest as T(rootPos) × (at, rot).
  - **Ragdoll:** bones above the ragdoll's root capsule (`root`, the armature node) follow the model frame implied by the root capsule's body.
  - **Morph targets:** face targets (sparse accessors) are not read, so they are ignored safely.
- **Sockets:** `critterView.boneWorld(partId, 'prop_r' | 'head')` returns the world pose from this frame's animation. BANDIT's stolen item should follow `prop_r` (a non-deform node the rig now tracks), not `BANDIT_PROP_R`. Whoever draws the carried item (B, or scene.ts once the carry state is exposed) can read it.
- **Mega Kitchen:** `kitchen.glb` (Warehouse coordinates) is drawn at −`KITCHEN.presets[preset].origin` from `env_kitchen.ts` (Room: z + 24). The BACKDROP is drawn. `REF__scale__<preset>` subtrees are split into per-preset meshes, and only the active preset's reference is drawn. The sun matches `KITCHEN.light.sunDir`. Checked with a local, unshared env switch: sink, window and garden, counters, tiles, glass spice jars. Main pass 0.21 ms, glass pass 0.01 ms. Per-preset spawn cameras (`camera`/`target`) aren't applied yet: that is the orchestrator's or D's call, on env change.
- **M2 part defs** (FISHBOWL, LAMP, BURNING GLASS…) don't set `art` yet, so they still draw blockouts. Their `:glass` meshes are registered (18 types), and they go through the transmission pass as soon as the defs point at the art.

## Follow-up: emotes, faces, piece bodies, Bandit's loot

I checked all of this in Chrome against a private dev host (port 8797, its own data directory in a local scratch directory), so the shared world was never touched.

### Face shape keys

**Parser (`glb.ts`):**
- Reads morph targets: POSITION and NORMAL deltas, dense or **sparse** (`readView` handles sparse substitution over a base view or over zeros).
- Reads names from `mesh.extras.targetNames` and default weights from `mesh.weights`.
- Non-skinned deltas get the node's linear transform. Primitives must agree on the target count.
- Five new tests in `glb-skin.test.ts` cover this.

**Renderer:**
- `skinnedFromGlb` stores a delta row (T × (dpos, dnormal)) only for vertices with a nonzero delta. On MOCHI that's about 3k of 19k LOD0 vertices.
- Each vertex gets a u32 vertex stream pointing at its row, or `0xffffffff` when it has none.
- `vs_skin` adds the weighted deltas in bind space before skinning:
  - the delta table is bound in the skin bind group's `visible` slot and read with `bitcast`;
  - weights follow the bones in the `xf` buffer;
  - the instance's `mesh` word holds T and its `outline` word holds the weights offset.
- Only LOD0 is drawn. Critters have no LOD switch yet, so LOD1's targets are parsed but unused.

**Driver (`critters.ts` `expression()`):**
- Each clip and emote sets brief shape keys, e.g. `startled` → `sk_surprised`/`sk_scared`/brows up; `sleep` and `zzz` → `sk_sleepy` + blinks; `emote_angry` and `angry` → `sk_angry` + brows down; `?` and `emote_confused` → asymmetric brows; `heart` → `sk_happy`; `chase`/`stalk` → `sk_determined`.
- Weights ease at 12/s, and there is a per-critter idle blink every 3–5 s.
- A ragdoll shows the `tumble` face (dizzy).
- Checked by forcing angry, happy and neutral on MOCHI: the lids, brows and mouth visibly change.

**GPU cost:** 4 critters with all 20 keys at 0.5 (worst case) cost +0.027 ms in the main pass, about 7 µs per critter. Real expressions use 1–4 keys.

### Emote bubbles (`gfx/emotes.ts`)

- A DOM bubble sits above the head bone (`boneWorld(…, 'head')` plus a lift scaled to the critter's size), showing `CRITTER_EMOTES[byte 2]` as an emoji glyph.
- It pops in and out with a 180 ms overshoot scale. With `settings.comfort.reducedMotion` it fades instead.
- Size is 15–24 px depending on distance. It hides past 30 m, behind the camera, and in photo mode: `critterView.photoMode = true` or `body.photo-mode`. There is no photo mode yet, so that is the hook.
- Seen in Chrome: `?` over MOCHI and `!` over BANDIT.

### Pieces (`role 'piece'`)

- `glbmesh.splitPart` moves a def-with-`piece` part's piece nodes (`*__cork`, `*__head`, anything under `PIVOT__head`) into `<type>:piece`, which removes the static stand-in from the base art.
- `scene.ts`:
  - in a run, piece bodies draw `<art>:piece`, or the def's `on: 'piece'` visuals when there is no art;
  - build mode shows the piece at rest with the part;
  - with blockouts, the base no longer draws `on: 'piece'` visuals in a run.
- `gfx/pieces.ts` draws the GOTCHA BOX spring as a steel coil stretched from the box's pivot to the popped head; the art's own spring stays inside the box.
- Seen in Chrome:
  - the cork leaves the barrel (now empty), flies about 0.6 m and is yanked back by its string;
  - the gotcha head springs up and lunges on its coil.

### Bandit's loot

- `CritterView.carry()` finds the item the sim parks at `BANDIT_PROP_R` (any non-critter base body within 3 mm of that point).
- It redraws the item on the GPU at the animated `prop_r` socket with `renderer.patchBody(body, pos, rot)`, a render-only, per-frame override.
- E2's `prop_r` rest pose is the forepaw on the floor, so the item is placed on the bone itself, not offset by `BANDIT_PROP_R`.
- No small shiny lure exists yet, so B's sim couldn't be made to steal anything. I checked the path by parking a STITCH at the prop point in the page and forcing the `steal_carry` clip: the ball sits in his raised paw.
- **For B:** the sim's collider for the item stays at `BANDIT_PROP_R`, about 0.2 m from the paw in `steal_carry`. Exposing the carried part would let the renderer drop the search, and moving the sim's carry point to follow `prop_r` would line the collider up with the drawn item.

## Close-out: part shape keys and the FISHBOWL shatter

Both E1 exports landed during the work, and both were verified in Chrome with the real art, on my local test server.

- **Shape keys.** All six types register shape keys from their glbs. In a run:
  - SPRONG `sk_depress` goes to 1 on a THUD bounce.
  - PUFFER `sk_squash` goes to 1 on a press.
  - CORK BLASTER `sk_compress` goes from 1 to 0 when it fires.
  - GOTCHA BOX `sk_stretch` goes to 1, and the art's coil spans from the box to the popped head.
  - PUNCHLINE `sk_compress` goes 1 → 0.18 → 1 over a punch.
  - BIG TOP `sk_iris` settles near 0.1 with a BOING loaded, which matches 1 − 0.24 m ÷ 0.27 m.
- **PUFFER `sk_spring`** only plays after a release. In the test the THUD stayed on the bellows, so it never released.
- **Mixed key names in one part.** Each mesh can carry its own keys (PUFFER: the pleats carry `sk_squash`, the spring carries `sk_spring`). `glbLods` merges the names across a LOD's meshes and zero-fills the keys a mesh lacks. A test covers this.
- **GOTCHA spring.** Its `sk_stretch` assumes `PIVOT__spring` rides up with the head, so the whole `PIVOT__spring` subtree (spring plus head) is now the piece mesh. The key's weight is the head's rise, read along the leaned axis after undoing the 35° lean about `GOTCHA.pivot`.
- **FISHBOWL shatter.** `fishbowl.frac.glb` has nodes `FRAC__01`…`FRAC__21`, ordered by number. All 21 chunks are glass: `kn_interior_glass`, the cut faces, now counts as glass. A shove makes the bowl break and the 21 shards fly through the glass pass, which costs 0.013 ms.

### Part shape keys

**Geometry and renderer:**
- `glbLods` keeps a delta row per moving vertex for LOD0 and LOD1 (any LOD whose meshes have morph targets).
- `MeshLibrary` adds a second vertex stream, a u32 per vertex packing (delta offset << 3) | key count, or `0xffffffff` for vertices that never move. It also keeps a storage table of deltas, and `MeshInfo.targetNames`.
- `setScene` gives each scene instance of a morphing mesh a slot.
- A per-instance storage buffer holds a header word, the slot of every instance, and 8 weights per slot.
- `vs_scene`, `vs_shadow`, `vs_shadow_clip` and `vs_mask` apply the deltas (`partMorph` in `shaders.ts`). Overlays and ghosts stay at rest.

**Driver (`gfx/partmorph.ts`):** it eases the weights from part flags and body transforms. Build mode shows the rest pose.

| Part | Shape keys | Driven by |
|---|---|---|
| SPRONG | `sk_depress` | the `pressed` flag |
| PUFFER | `sk_squash`, `sk_spring` | `sk_squash` while `pressed`; `sk_spring` as a decaying overshoot after release |
| CORK BLASTER | `sk_compress` | the cocked `lit` flag |
| GOTCHA BOX | `sk_stretch` | the head piece's height ÷ `GOTCHA.rise` |
| BIG TOP | `sk_iris` | the nearest roller in the bore when `pressed` (loaded): 1 − diameter ÷ bore diameter. No meter byte needed. |
| PUNCHLINE | `sk_compress` | 1 − the glove arm's extension ÷ 0.5 m |

The procedural GOTCHA coil from `pieces.ts` turns off by itself once the art has `sk_stretch`.

**Verified in Chrome** with a SPRONG mesh into which I injected a test `sk_depress` key in the page: a THUD bounce sets `pressed`, the mat sinks (weight 1.0), then it eases back to 0.

**Cost:**
- `/spike-gpu.html` at 100k parts: 2.24 ms after vs 2.26 ms before. The extra stream is 4 bytes per vertex, and vertices without deltas skip the work.
- Morphing instances cost T multiply-adds per moving vertex.

**Tests:** `apps/game/test/gfx-parts.test.ts` covers morph-row extraction and frac chunk order.

### FISHBOWL shatter

- `FRACTURE_PARTS = ['fishbowl']`. `loadFracMesh` reads `/parts/fishbowl/fishbowl.frac.glb` and registers `fishbowl:chunk:<k>` and `fishbowl:chunk:<k>:glass` in chunk order.
- Chunk order comes from the number on each chunk node (`chunk_<n>` or a trailing number), or from node order when the names aren't numbered.
- `fillRunScene` draws chunk k's part-space mesh on the `role: 'chunk'` body with `chunk: k` while the part is broken and not dead. Glass chunks go through the glass pass.
- The orchestrator confirmed chunk bodies start at the part's pose with part-space hulls. PLANK keeps its centroid halves.
- Not yet seen in Chrome: it needs the `.frac.glb` and the sim's 21 chunk bodies.

## APIs for D and B

```ts
// renderer (contract 4)
renderer.setSectionBox(box: { min: V3; max: V3 } | null): void
renderer.setCutaway(on: boolean): void          // + renderer.cutawayFocus: V3 | null, renderer.cutawayRadius (0 = auto)
renderer.setXray(mode: 'off' | 'links' | 'all'): void
renderer.setSelection(instances: readonly number[], rgb: Rgb | null): void
renderer.sectionBox / cutawayOn / xrayMode      // getters
renderer.outlinePx = 2                          // outline width (CSS px)
SceneItem.xray?: boolean                        // overlay item the x-ray view shows through geometry
SceneItem.glass?: boolean                       // overlay item drawn in the transmission pass (colour = tint)

// cameras.ts
type CamMode = 'orbit' | 'director' | 'ride' | 'overview'
class CameraRig { mode; fov; cycle(): CamMode; setMode(m); frame(); update(dt, now): Shot; overlay(out); onEvents(evs) }
// comfort settings read live from ui/settings.ts: comfort.directorCutRate (0 never cuts … 1 one cut per 1.2 s),
// comfort.shake (0..1, default 0.7 = M1 strength), comfort.reducedMotion (no shake)

// critters (contract 3): gfx/critters.ts
new CritterView(renderer).load(types?)           // /parts/<type>/<type>.glb with a skin; else blockout
critterView.boneWorld(partId, 'prop_r' | 'head') // world { pos, rot } of a socket bone this frame, or null
critterView.photoMode = true                     // hides emote bubbles (also body.photo-mode)
renderer.patchBody(body, pos, rot)               // render-only per-frame body override (after setBodyTransforms)
SkinnedItem.morph?: Float32Array                 // shape-key weights in the mesh's targetNames order
critterView.frame(dt, parts, run, overlay)       // reads run.bodies (role 'base' | 'rag' + bone), run.transforms,
                                                 // run.partIds, run.critters (4 B per part), run.paused, run.speed
scene.ts skinnedParts: Set<string>               // critter types drawn skinned (instance fills skip them)
renderer.addSkinnedMesh(name, geom, jointCount); renderer.setSkinned(items)
```

Expected critter glb (stream E): `/parts/<type>/<type>.glb` with one skin. Clips are named `<type>__<clip>` with clip names from `CRITTER_CLIPS`. Bones are named as in the brief (the `RAG__` prefix is stripped to find the bone). Unskinned meshes under a joint ride it rigidly. Clips that play once and hold their last frame: `startled`, `tumble`, `getup`, `wheel_exit`, `burrow_enter/exit`, `pedal_mount/dismount`, `steal_grab`, `pounce`, `bubble_rescue`. Every other clip loops.

## Cameras

- **orbit:** M1's camera. F now frames the selection's world bounds (or the point under the cursor) with a 0.35 s tween.
- **director:**
  - Recent events (2.5 s of run time) are weighted by kind (Detonate 6 + 4·∛mag, Break and Launch 4, Pop 3, Ignite 2.5, …, Impact mag/15 capped at 3). Each event is scored by recency (e^−age) × (1 + 0.2 × causal depth), where depth comes from the `cause` chain. Scored events are clustered within 1.5 m.
  - It cuts when a new cluster beats the current one by 35 % + 1.5 and the minimum hold has passed: lerp(6 s, 1.2 s, cutRate), never under 1.2 s; cutRate 0 never cuts. A big detonation may cut after 1.2 s.
  - Each cut turns 35–70° and changes height. Within a shot the camera follows the cluster, drifts slowly, and punches in on detonations. With no activity it holds a wide establishing shot of the machine.
  - It stays on the open front side of the set (|yaw| ≤ 1.1 rad): from behind, the Studio cyc filled the screen.
- **ride:** a chase camera on the selected part's base body, otherwise the most active dynamic body. Speed is smoothed, and a 1.5 s quiet time or a body 2.5 × faster triggers a switch. Heading follows the motion, the horizon stays level, FOV is 60.
- **overview:** the whole machine from 1.15 rad up, fitted to its bounds, with event-heat discs. Click-to-jump is not done (below).
- Switching modes blends over 0.6 s. Any orbit input while another mode is driving returns to orbit from the current view. Trauma shake now lives in the rig, scaled by `comfort.shake`.

## GPU timings (`/spike-gpu.html`, 1280×720, 100k parts)

| | Before (M1) | After (M2) |
|---|---|---|
| 100k parts, no sparks | **2.32 ms** (cull 0.10 · shadow 1.10 · main 1.04) | **2.26 ms** (cull 0.09 · shadow 1.17 · main 0.95) |
| 100k parts + 1M sparks | **6.40 ms** | **6.78 ms** (spark count varies run to run: 1.28M vs 1.27M live) |
| + x-ray `all` | n/a | 3.10 ms (+0.7: a second draw of the scene's rims) |
| + cutaway | n/a | 2.50 ms (+0.12) |
| + section box (cuts most instances) | n/a | 1.60 ms |
| + outlines on 200 instances | n/a | mask 0.03 ms, post +0.02 ms |

In the game: 96 skinned test critters (4 joints each) cost 0.08 ms GPU for the whole main pass and 0.2 ms CPU per frame to animate. The glass pass in the demo machine (motor shell, MAINS glass, a TUBE) takes 0.01 ms.

## Deviations and decisions

- **Selection outlines** dilate a mask in the composite instead of RENDERING §10's jump flood from the ID buffer: a 2 px outline needs no flood. The mask has no depth test, so outlines also show through occluders, which is useful when the selection is behind something. Selected critters (skinned) get no outline yet.
- **X-ray** renders link and port overlays as glows. RENDERING §10's channel-flow ribbons with glyphs and animated dashes need the sim's channel-graph snapshot and are not done.
- **Cutaway** follows the camera target by default. GAME_SPEC's "between the camera and the cursor or selection" is available through `renderer.cutawayFocus` (D can set it to the selection or the cursor).
- **Glass** casts no shadows, and gets no point lights or IBL.
- **Section caps** use back faces, so they assume closed meshes. Art with open shells (or flipped winding) shows the inner face instead of a cap. Decals and screens never draw back faces.
- **`sweptTube` winding** was flipped to counter-clockwise from outside. The tube was inside-out: harmless as a ghost, wrong for glass.
- **Skinning** has one LOD, with up to 256 joints per mesh (8-bit joint indices) and 4 weights. Shape keys and the face rig (`weights` channels) are parsed but not played.
- **Kitchen:** the 5:1 set is drawn as one overlay mesh. It receives shadows but doesn't cast them. There is no Studio floor or build grid in the kitchen, and no froxel haze, probes or LUT yet. The lighting is a hand-tuned stand-in.
- **GUTTER:** the kit is scaled uniformly by r_slim / r for `gutter_slim`. Straps are spaced evenly (≤ 0.5 m) rather than placed at authored joints. Saddles only go under runs whose floor line is at least 0.131 m up and whose slope is < 45°.
- **Dev server:** I run Vite with a scratchpad config that disables file watching and HMR. Other streams' edits otherwise reloaded the test tab every few seconds. The shared `vite.config.ts` only gained `buildAssets('env')`.
- **Host:** no host was running on :8787, so I started one with `KNOCKON_STATIC=none` (build `dev`, the shared `data/` world). The dist-built host refuses `dev` clients with BUILD_MISMATCH.

## Left for later

- Overview click-to-jump; director picture-in-picture (GAME_SPEC §8).
- X-ray channel-flow ribbons and glyphs; jump-flood outlines (if wider outlines are wanted).
- Outlines and picking for skinned critters; critter LODs; the face rig.
- Kitchen: shadow casting, IBL, probes and haze. Verify against E's real `kitchen.glb` when it lands. It was checked here only with a stand-in glb through the full load, re-centre and look path.
- **Found, not mine:**
  - `audio/index.ts` `applyLoop` threw "non-finite" from `setTargetAtTime` during a run, and the throw stopped main.ts's frame loop. It appeared after director cuts. My guess is the Doppler factor when the listener teleports. Stream F should guard against it.
  - `packages/assets/test/m2_parts.test.ts` (stream E) has 3 failures.
  - `packages/sim/src/channels/*` had typecheck errors mid-session (stream A).
