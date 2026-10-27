# Decisions (2026-10-24)

## D51 Chrome first

KNOCK-ON targets **desktop Chrome** (and Edge, which shares the Chromium WebGPU stack) for M0 through beta. Firefox, Safari and ARM devices are best-effort until after beta.

- **Why:** the game is played by two friends over a isolated test network, and both can install Chrome. Chrome has shipped WebGPU, cross-origin isolation, WASM threads + SIMD and timestamp queries the longest. Supporting four browser engines would roughly double test and debug time on the riskiest systems (determinism, Matter, Spectacle) without changing who can play.
- **Gates change:** every "Chrome/Edge/Firefox/Safari × x64/ARM" gate now reads **Chrome on x64**, plus whatever GPU vendors we can borrow. The M1 exit's "replays identically in 4 browsers" becomes "replays identically in Chrome and in Node (the same WASM)".
- **What stays:** determinism rules are unchanged. They are what makes Chrome ↔ Node, thread-count and machine-to-machine replay work, and they keep other browsers possible later.
- **Matter cross-vendor gate:** with one GPU vendor on hand, the stand-in proof is **GPU checksum = CPU reference checksum, bit for bit**. WGSL integer maths is exactly specified, so an independent CPU implementation that matches is the best evidence available on one machine. Cross-vendor runs happen when we can borrow AMD/Intel hardware.
- Unsupported browsers still get the explanation page ([GAME_SPEC §15](../../GAME_SPEC.md)).

## M1 implementation decisions

Taken while building the first M1 slice (`packages/sim/src/machine.ts`). Each one is reflected in the code and in the doc it amends.

- **D52 HELIO effective mass.** The balloon's rigid body uses an effective mass of 0.08 kg (latex + entrained air) with gravity factor 0.05, so its weight is still the real 4 g. Lift stays the toy-helium constant 4.9 N × air %, plus quadratic drag F = −3.4·|v|·v. A 4 g body under 4.9 N is unstable in a 120 Hz solver; with these values a free balloon rises at about 1.2 m/s and one tethered to an empty Scoop (0.45 kg) rises at about 0.4 m/s, as SIMULATION §5.1 intends. Amends SIMULATION §5.1.
- **D53 Blast speed cap.** The SIMULATION §6.1 impulse `J = K·Y·e / max(r, 0.15)^1.5` stands, but no body leaves a blast faster than **8 m/s** (Δv cap). Uncapped, a 0.2 kg domino at 0.5 m gets about 250 m/s and simply vanishes. With the cap, light parts tumble across the set and heavy parts still barely move. This is a tuning value for playtests.
- **D54 Explosion exposure.** The exposure term `e` (9 rays from P against static geometry) is 1 in this slice: blasts aren't shadowed by walls yet. Exposure rays land with breakables.
- **D55 Gear contact.** A COG collides on its pitch circle minus 8 mm, so meshed cogs never touch and only the GearConstraint transmits torque (the engine-side version of "filter contacts between linked cogs"). Teeth stay `sharp` for Helios.
- **D56 Contact impulse estimate.** Impacts use J ≈ m_reduced × closing speed along the normal, measured in `OnContactAdded`. Persisted contacts are only harvested for pressure plates. Jolt's JS bindings return value types in one shared temporary per getter, so contact code reads each result before calling the same getter again.
- **D57 Ropes over a SHEAVE.** The editor draws two LINE links that meet at a sheave's axle port; the sim pairs them into one `PulleyConstraint` through the axle point (SIMULATION §5.4). A sheave with a single line acts as a fixed hook.
- **D58 Part definitions in TypeScript.** M1 part definitions live in `packages/parts-data/src/defs.ts` as typed data with property-dependent shape and visual functions (slopes, cog sizes), instead of `*.part.json`. They follow the PART_SYSTEM §1 schema field for field. A JSON export for tooling comes with the Library cards.
- **D59 Late hash reports.** Clients report the state hash for tick T only once their sim reaches T + 120 (1 s). A poke that arrives late triggers a rollback, and the re-simulated hashes replace the old ones before they're sent, so a late poke never looks like a desync.

## M1 completion decisions

- **D60 Anti-aliasing for M1.** M1 ships **4× MSAA** at native resolution. The FSR 2-style TAA upscaler (RENDERING §9) moves to M3, where it pays for itself: internal-resolution scaling on the big presets and the volumetrics' temporal reprojection. Amends PRODUCTION §2 (M1 Graphics) and RENDERING §9.
- **D61 Drive trains.**
  - Gears and belts use Jolt's gear constraint as a pure velocity coupling (no `SetConstraints`). Its drift correction combines the two hinges' angles, which wrap at ±π. With any non-integer tooth ratio (M↔S, M↔L) that gives a 2π/ratio error jump each turn, and the train explodes. The velocity coupling holds the ratio exactly; the phase drift is invisible, because teeth don't collide.
  - Ratios are always ≥ 1 (the smaller gear goes first). Jolt diverges on chains with ratio < 1, and a negative ratio runs away. A belt, which turns both pulleys the same way, flips the second hinge axis instead; a crossed belt doesn't.
  - Drive-train constraints get 24 velocity and 6 position iterations.
  - Found by the per-part goldens and the property fuzz.
- **D62 Rotors on their axis.** Every hinged arm's collider is centred on its hinge axis (MOTOR armature, TREADWAY drum). The MOTOR armature is a ghost Ø 0.12 m, 0.6 kg disc, so a 2 kg COG L on the other end of a belt is a sane inertia ratio. An off-axis rotor orbits its axle and reached 500 m/s.
- **D63 Impact events.** Every contact start ≥ 0.3 N·s emits `Impact`, so audio hears soft hits and domino runs. Dust effects still need ≥ 20 N·s.
- **D64 Studio cove collision.** Each straight wall of the cyclorama collides as 6 boxes along its quarter-circle cove, plus its vertical part. The swept corners are visual only in M1.
- **D65 Rate-limited ops.** An op over the host's 200 ops/s limit is answered with `op.reject {reason: RATE_LIMIT}`, never silently dropped: a dropped op left the sender's optimistic document waiting forever and broke ack ordering. Clients pace op sends at 150/s, so a 2,000-part paste drains in about 14 s and is never rejected.
- **D66 Breakables before fracture assets.**
  - PLANK breaks into two pre-built halves until `.frac.glb` chunks land. The halves are created dormant with the world, so a rollback never creates or destroys bodies.
  - BRIK mortar uses fully locked six-DOF joints, whose lambdas the JS bindings expose (FixedConstraint's aren't).
- **D67 Stop clears Spectacle.** Smoke, sparks and scorch decals belong to the run: Stop clears the particle pool along with the reset.
- **D68 TUBE.** A TUBE is a path link with no ports. Its corners are rounded into bends (radius 0.3 m, slim 0.12 m), and it collides as 12 staves per segment around the bore. Glass is drawn translucent (no refraction until transmission lands in M2).
- **D69 Decals and screens in the part shader.**
  - The vertex stays 32 bytes. The normal is packed as snorm16 to make room for a unorm16 UV.
  - The vertex material's 4th byte says what a texel is: instance material, master material, `kn_decal` or `kn_screen`.
  - Decal texels sample the shared atlas (`/kit/decals_atlas.png`, sRGB with a full mip chain). They are alpha-tested at 0.5 and resolved with alpha-to-coverage under 4× MSAA. Each decal is pulled 0.03 % along its view ray, so it wins the depth test without shifting on screen.
  - Screens are drawn procedurally in the fragment shader rather than by the compute-drawn screen atlas (RENDERING §4). M1 has one screen kind (MAINS's 10-cell bar), so the atlas waits until the 7-seg, icon and text screens land in M2.
  - The level travels in 5 spare bits of the instance flags. `Machine.partMeters` is a read-only view of the power stage, so it never enters the hash.
- **D70 Start-state checkpoint.** The Machine checkpoints its start state as well as every 60 ticks. Without it, a poke landing late inside a run's first half-second had nothing to roll back to. The hour soak caught it: a tick-21 poke arrived at tick 35 on both clients. The soak now counts any rejected poke as a failure.
- **D71 SLOPE follows its art.**
  - The art is authored flat, and `artAt(props)` tilts it about the low edge to `angle`.
  - The collider is two boxes: a deck that stops 0.08 m short of the low end, and a 20 mm box whose top face lies on the knife-edge nose taper (0.05 → 0.006 m). It replaces the full-thickness box, which left balls riding over an invisible 44 mm step.
  - The sim has no hull collider for the brief's `COL__hull__nose` yet.
  - Four per-part goldens were re-pinned. Their behaviour checks are unchanged.
- **D72 Runs start from the confirmed world.** On `run.start`, each client builds its Machine from `DocStore.confirmed()`: the world at the server's `worldSeq`, without its own unacknowledged edits. An edit still in flight would otherwise put a part in one player's machine and not the other's, and the run would desync from tick 0. Found by the two-machine soak mode.
- **D73 Soak link order and two-machine mode.**
  - The soak's simulated link is a FIFO drained by one timer. Separate timers per message could reorder two messages sent in the same millisecond, because Node starts timers on a whole-millisecond clock.
  - `--player a|b` splits the soak across two machines: `a` hosts and plays, `b` joins with `--url`. Each side fails on any desync or rejected poke.
  - Where a machine's Node can't run TypeScript (Node 20), bundle the soak with the repo's esbuild (`--bundle --platform=node --format=esm`). Jolt's `wasm-compat` build embeds its WASM, so the bundle is one file.

## M2 decisions (orchestrator)

- **D74 MOTOR on a DC torque–speed curve.** The M1 motor gave 30 N·m at any speed, about 283 W of shaft power from a 120 W motor, so a spun-up dynamo loop could run forever.
  - It now follows ω = ω0·(1 − τ/τs): 30 N·m at stall, 0 at 9.42 rad/s, and about 71 W peak. Both stall torque and no-load speed scale with the supply factor (SIMULATION §5.3).
  - It is implemented as a velocity motor capped at stall torque. Its target speed tracks the torque delivered last step, moving halfway each tick, and is kept in run state so rollback covers it. Clamping the torque directly made light rotors oscillate.
  - Ten goldens were re-pinned (listed in M2_NOTES_A); their behaviour assertions are unchanged.
- **D75 Environments in the sim.** `MachineOptions.environment` (`'studio'` or `'kitchen'`) selects the static set.
  - The Mega Kitchen builds the generated colliders from `env_kitchen.ts`: 212 boxes and 6 spheres per preset.
  - Colliders are grouped into one static compound body per physics material, so each keeps its friction and restitution.
  - The worker, the RunController and the soak harness pass `doc.env.environment` through.
- **D76 Goal types as tests.** The M2 exit criterion "every Appendix A goal type can be built" is `packages/sim/test/goal_types.test.ts`. It has one chained machine per goal type, each with a goal predicate. The protect and low-gravity goals also run a negative variant, showing that the goal is met only because of the machine.

## Look and feel pivot (producer, after the M2 review)

The M1/M2 builds and the first UI mockups read as clean but cold. The new target is **"science class maximalism"**: a warm, busy, lived-in tinkering classroom around the machine, and a frosted-glass UI that lets that world show through. Parts keep their shapes, ports and gameplay. Their **surfaces**, the world around them, the light and the UI all change.

- **D77 Glass Lab UI.** UI panels become frosted glass instead of solid Graphite (this replaces UI_UX §1.1 "translucent-free").
  - **Glass recipe:** a dark tint `rgb(16 19 26 / .58)`, `backdrop-filter: blur(22px) saturate(1.4)`, a 1 px inner top highlight `rgb(255 255 255 / .16)`, a 1 px outer edge `rgb(255 255 255 / .07)`, and a soft drop shadow. Radii grow to **16 px** for panels and **10 px** for controls. Accent, channel and player colours are unchanged.
  - **Legibility guard:** text sits on glass with at least .55 tint opacity, so contrast holds over the brightest set (checked against a white backdrop). Small text (< 14 px) never sits directly on glass over the viewport; it sits on a raised glass "well" at .72.
  - **Performance guard:** at most **6** glass surfaces are visible at once, blur ≤ 24 px, and no glass surface animates its size during a run. **Settings › Accessibility › Reduce transparency** (and an automatic fallback on the 4 GB tier, or when UI frame time goes over budget) swaps every glass surface for the solid Graphite tokens.
  - **Parts are shown as 3D renders everywhere in the UI** (dock tray, Library, Inspector header, palette results), rendered by the thumbnail rig (ui_icons §6) with a warm variant of the light. Line icons stay for actions and tools.
  - **Layout changes:** a vertical **view rail** on the left (Orbit, Pan, Zoom, then view modes Normal / X-ray / Section); a **world card** top left (title and the world's one-line blurb); a **parts tray** at the bottom that merges the dock and a compact Library row (family tabs, search, large 3D icons, hotbar numbers 1–0 on the first ten); the **transport cluster** (Reset, back, LET IT RIP / play, forward, sim speed) floats centred above the tray; the **Inspector** docks right as a glass panel with sliders, toggles and collapsible sections; Save, Share and the menu sit top right.
  - **Not adopted:** the reference's goals, part budget and Build → Test → Success progress strip belong to the challenge mode, which stays post-beta (GAME_SPEC §22). The file format already reserves goals.
- **D78 Science class maximalism.** Environments, lighting and key art get a dense, warm, story-filled set dressing, and part surfaces become tactile and textured.
  - **Part materials go tactile ("loved, not grimy").** Silhouettes, port rings, LEDs and the kit stay. Surfaces move from flat powder coat to rich, texture-driven materials: hardwood with visible grain and end grain, enamel-painted steel with soft worn edges, cast iron, brass and copper with patina in recesses, rope and cotton cord, printed paper and card, rubber with moulding marks. Each part gets a **unique texture set** (albedo, normal, ORM at 1–2k, BC7), layered over the master materials, instead of masks alone. This replaces ART_BIBLE rule 5 "Pristine": wear shows on edges, handles and contact points as worn paint and polish. No rust, dirt or grunge.
  - **New environment: THE TINKER LAB.** A science classroom and workshop: a long hardwood workbench with a gridded cutting mat (the build zone), chalkboard and blueprint posters, shelves of books, beakers and jars, a globe, potted plants, pegboard tools, pendant lamps, tall windows with late-afternoon sun, and MOCHI asleep on the bench. Presets **Desk and Room**. It becomes the **default environment** for those presets, and the backdrop for the lobby and title. The Studio stays as the clean "product shot" option.
  - **Density zoning:** the build zone (the cutting mat, and the neutral zone in bigger presets) stays clean and level. A **clutter ring** 0.5–3 m out is maximal. The far background is busy but soft (haze, and depth of field in Photo mode and the lobby). The background sits about **one stop darker and less saturated** than the build zone, so parts and port rings always read first.
  - **Golden-hour lighting:** a warm sun key through the windows (≈ 3,500 K), cool sky fill, practical pendant lamps with bloom, and light shafts on the 12 GB and 16 GB tiers.
  - **Mega Kitchen maximalism pass:** fridge magnets and drawings, cereal boxes, a fruit bowl, plants, utensils, a crayon drawing taped to a cabinet, and window light shafts. It keeps its layout and colliders.
  - **Shared props kit** (`kn_prop_*`, Environment prop class, about 45 props) is used by both rooms. Props are built in the same bevelled toy style, never photoreal, with no readable real-world brands.
  - **Rendered art:** in-engine-matching thumbnails for every part (`tools/blender/render_thumbs.py`), and Tinker Lab key art for the lobby, store page and README (`tools/blender/render_tinker_lab.py`).
  - **Schedule:** the Tinker Lab, the props kit and the Kitchen pass land in **M3**, beside the Backlot. The texture pass on the 50 existing parts starts in M3 (M1 parts first) and new parts are authored textured from M3 on. The glass UI pass lands in M3 Tools/UI.
- **D79 Warm cinematic renderer look.** The custom WebGPU renderer's default look matches the new key art, not the look-dev cyc.
  - **Materials:** the uber material samples per-part texture arrays (albedo, normal, ORM) plus a tiling **detail layer** (wood grain, paint orange-peel, cast-iron pitting) that fades in close to the camera.
  - **Light:** probe GI (RENDERING §7) is the default on 12 GB and up; GTAO everywhere (SSAO on 4 GB); SDF contact shadows; environment IBL baked from each set.
  - **Atmosphere:** froxel fog with sun light shafts through windows, and bloom on practical lamps and LEDs.
  - **Camera:** a gentle **tilt-shift depth of field** in Build and Run (focus on the selection or the run's action, background softly blurred, off in Reduce motion and switchable in Settings › Graphics); a per-environment **warm grading LUT**, a soft vignette and fine film grain after tonemapping.
  - **Cost:** about 2.5 ms extra on the 16 GB tier at 1440p internal. Lower tiers drop light shafts first, then DOF, then GI.
  - **Proof:** an in-engine Tinker Lab frame must sit next to the Cycles key art in a side-by-side review, as the Studio IBL does today.

## M3 kickoff: the open producer calls (provisional)

The /goal directive is to complete M3 without pausing, so the orchestrator took these five calls to unblock work. **Each is marked provisional:** the producer can overturn it at the M3 review, and the work is built so a reversal costs little.

- **D80 Glass contrast (UI_UX §2, Open).** The glass tint for text-bearing surfaces rises from .58 to **.64**. That is the smallest step that measures ≥ 4.5:1 for Paper body text over pure white. Viewport-only chrome with no small text, like the view rail icons, may stay at .58. The CI contrast check measures every glass surface over white and fails under 4.5:1. *Cheap to revert:* it's one token.
- **D81 Frame budget (RENDERING §12, Open).**
  - The 16 GB tier must hold **16.6 ms at 4K output** with the full look. The look pass is measured feature by feature, not estimated.
  - Win-back order:
    1. upscaler internal resolution (1440p → as low as 1296p);
    2. cached static shadow cascades;
    3. light shafts at half resolution;
    4. DOF at quarter resolution;
    5. GI probe update amortisation.
  - The live governor drops light shafts, then DOF, then GI, in that order, before it lowers resolution further.
- **D82 Tinker Lab lighting and scale.** The engine follows the **approved key art** (`tinker_lab_key.png`): the key light comes from behind-right through the windows, the fill is cool sky, and the set is at real scale. The D79 proof gate is a side-by-side with that image, and a brief that disagrees with the gate can't pass it. `environments.md §3` is updated to match. *Cheap to revert:* the set scale is a single preset constant, and the lighting is set data.
- **D83 M3 art capacity (PRODUCTION, the ≈ 60-artist-day overrun).** The work is done by parallel agent streams, so capacity isn't the constraint it is for a human team. M3 keeps its full art scope without slipping:
  - the Tinker Lab, the 45-prop kit and the Kitchen pass;
  - the 30 new parts authored textured;
  - the texture pass on the 25 M1 parts.

  The M2 parts' texture pass stays in M4, as PRODUCTION plans.
- **D84 Mockup vs docs details.**
  - **Radii:** the docs win. Panels are 16 px and controls 10 px (D77), and the mockups' 20–22 px panel radii are treated as illustration.
  - **Stop:** Backspace remains Stop. Esc closes the topmost panel or menu, then cancels the current tool, and stops a run only when nothing else is open. That keeps the mockups' "Esc to stop" feel without stealing Esc from panels.
- **D85 A 32 GB tier for GI (producer call, 2026-10-24).** The producer's dev machine is an RTX 5090 (32 GB), and the producer approved going past the 16 GB tier to get GI. That adds tier **32** ("Max").
  - **GI:** full-rate, multi-bounce probe GI on a higher-resolution global SDF, at about twice the 16 GB tier's SDF resolution and probe density.
  - **Look:** the full D79 look at full resolution (shafts full-res, DOF half-res).
  - **Budgets:** about 22 GB resident; 2M placed parts; 32M spectacle particles; 8M Matter grains; fluid grids 8 × 192³.
  - **Target:** 4K60, upscaled from ≥ 1800p internal.
  - **The 16 GB tier keeps its targets (D81).** The 32 GB tier is additive. M3's benchmarks report the 16 GB and 32 GB tiers separately.
  - **Detection:** browsers don't expose VRAM, so tier 32 is picked from the adapter name (RTX 5090, RTX PRO 6000, RTX A6000 / 6000 Ada, Radeon PRO W7900), or chosen in Settings › Graphics.
- **D86 Selected-state contrast.** White text on the mockups' selected gradient (`#3E86E6` → `#2A66C4`) measured 3.65:1 at the top, under the 4.5:1 target D80 settled for glass. The top stop darkens to **`#3373D0`** (4.66:1), the smallest one-token change that passes. The primary action stays Ignition orange. *Provisional, like D80.*
- **D87 Tinker Lab Desk build zone (a D82 consequence, provisional).** At real scale, following the key art, the Desk preset's build zone is the bench's **2.3 × 0.82 m cutting mat**, not the 4 × 3 m Desk bounds.
  - Widening the bench is one constant in `env_tinker.py`, but it moves the D79 hero frame away from the key art, so it waits for the producer's review.
  - Machines bigger than the mat can still use the Room preset (floor-mat zone) or the Studio.
  - Related: the Tinker Lab's zone-vs-surroundings value check passes (+1.22 EV), but its saturation half fails because the key art's grey-green mat is less saturated than the oak around it. The key art wins (D82).
- **D88 Texture-set details from the M1 texture pass.**
  - **Anodised parts are enamel:** `kn_anod_*` parts (cogs, rails, trims) bake as enamel paint over metal, which is how the approved key art paints them. Metallic is 0 on the paint and 1 only on worn-through edges; roughness is 0.42–0.48. The renderer reads metallic and roughness from the ORM map for texture-set materials (the masters' glb factors stay as before).
  - **Rubber lifts:** rubber comes up to the bible's 0.03 albedo floor (about `#32363C`, same hue), so it reads lighter than the old `#1C1E22` master.
  - **Interim PNG build names:** `<type>.tex.{albedo,normal,orm}.png`, until an offline BC7/KTX2 transcoder is installed. Nothing was downloaded for it. Estimated VRAM with BC7 is about 4 MB per 1024² set and 16 MB per 2048² set.
- **D89 The M3 benchmarks run as Bake & Watch.**
  - **Sim miss:** "Kiloton" (424 charges, 5,617 mortar joints) and "Domino Day" (100k tiles) don't simulate in real time on one core. Kiloton averages 13.9 ms per tick and Domino Day 9.0 ms, against SIMULATION §12's 7.5 ms.
  - **About 90 % of each tick is inside `Jolt.Step`.**
  - **Shipping mode:** both ship as Bake & Watch (GAME_SPEC §6.5): bake ahead (Kiloton 20 s in 52 s), then play back at 60 fps. The M3 tier target is the playback frame (16 GB: Kiloton 14.3 ms, Domino Day 1.0 ms at 4K).
  - **The real-time fix is multithreaded Jolt.** It needs the contact path moved off the JS listener (M0 known gap 2) and is scheduled for **M4**. Until then the Run HUD shows the sim rate, and big machines offer Bake & Watch.
  - **Resting parts no longer start asleep.** That optimisation broke checkpoint import and rollback, so it was removed. Kiloton's first second (the fortress settling) costs about 49 ms per tick until multithreading lands.
- **D90 The D79 review's criteria, and set geometry in the GI (M3 close-out).** The M3 review gate is recorded in [M3_D79_REVIEW.md](M3_D79_REVIEW.md), with verdict PASS.
  - **Criteria:** the shot, D79's features and D82's lighting are judged by eye. Measured on the two frames: whole-frame exposure within ±⅓ stop, every cell of a 4 × 3 grid within ±1 stop with a median within ±⅓, warmth (R/B) within ±½ stop, and saturation within ±10 %. A path tracer and a 60 fps renderer won't match pixel for pixel; these catch a wrong look.
  - **The approved key art's values win over a master** (D82). E3b's `floorboards` master became the key art's warm brown.
  - **Environment sets join the GI.** `Gi.setStatic` stamps the preset's collider boxes into the SDF and moves the analytic floor to the set's floor (it was fixed at y = 0, the Desk's bench top). Probe misses inside a set see the set IBL's mean, not the sky. Inside a set, from 12 GB, the rim light, glossy IBL specular and the practicals without a shadow map are occluded by the SDF (≈ 0.45 ms at 16 GB, ≈ 0.9 ms at 32 GB, 4K). The Studio is unchanged.
  - **Settings › Quality tier now sets the renderer's tier** (it applies at boot). Before, it changed only the glass UI, so the 32 GB tier (D85) couldn't be selected on a machine whose GPU name Chromium hides.

## M4 kickoff: provisional calls

The /goal directive is to complete M4 without pausing, so the orchestrator took these calls to unblock work. **Each is provisional:** the producer can overturn it at the M4 review.

- **D91 The 4-vendor exit runs on the implementations the test system has.** The only GPU is an RTX 5090 (the Intel iGPU isn't exposed), and D51 left cross-vendor runs to borrowed hardware.
  - **Probed** (headless Chrome 155, throwaway profile):
    - the default adapter is NVIDIA through D3D12;
    - `--use-webgpu-adapter=d3d11` is NVIDIA through Dawn's D3D11 backend (a different backend and shader compiler path: no optional features);
    - `--use-webgpu-adapter=swiftshader` is Google SwiftShader (a different vendor's compiler, run on the CPU).
    - WARP isn't reachable from WebGPU, and the Vulkan flag couldn't be confirmed as a distinct backend.
  - **The M4 matrix** is those three, plus the CPU reference in Node, which is an independent implementation of the same integer math.
  - **Determinism holds by construction:** integer-only kernels, a float validator, and GPU = CPU bit for bit, so the matrix tests the implementations, not luck.
  - **Real AMD / Intel / Apple runs** stay open until hardware can be borrowed. The `tools/vendor-matrix` runner takes any adapter, so adding them is a re-run.
- **D92 Matter runs on the renderer's GPU device, commanded by the sim worker.** One device means R4 draws the particle buffers with no copies. The sim worker sends step commands and receives impulses and absorbed counts with SIMULATION §8.5's fixed latency, waiting (time dilation) when a result is late. Node (goldens, fuzz, soaks, headless hosts) uses the bit-identical CPU backend. Sandstorm's exit is determinism; if 4M grains miss the 60 Hz Matter budget, it runs dilated or as Bake & Watch, like Kiloton (D89).
- **D93 M4 Matter materials:** sand, water and marbles. Goo / slime comes with GOO VAT in M5. HOURGLASS is a fill-pass display, not grains (matter.md).
- **D94 No third-party encoders.** Rule 9 (no downloads without the producer's approval) means the MP4 muxer, GIF encoder, animated-WebP writer (C4) and BC7 encoder / KTX2 writer (V4) are written in-house. Video encoding uses the browser's WebCodecs. If the in-house BC7 quality misses ASSET_PIPELINE's bar, PNG stays (D88) and the producer can approve a tool.
- **D95 The M2 parts' texture pass and the M3 leftovers are in M4's scope:**
  - the M2 texture pass (PRODUCTION §3);
  - multithreaded Jolt (D89);
  - the VRAM governor;
  - KTX2;
  - the Megastructure dressing colliders.

  They have their own streams (E4c, J4, V4), so they don't hold up the Matter work.
- **D96 Run HUD text never fades below contrast (M4 accessibility pass, provisional).** U4's WCAG 2.2 AA audit found the run-idle fade to 60 % and the 55 % dim under the Cascade Report taking the run bar's text to 2.5–2.9:1. The K.O. counter and run bar text now stay opaque; only the run bar's buttons and timeline dim (UI_UX §3 updated). Compact layout also switches on below 760 px of effective height (window ÷ UI scale), not only below 1,280 px width; the thresholds are one line in `ui/hud.ts`.
- **D97 BC7 in KTX2 ships (D94 outcome, M4 stream V4).** The in-house BC7 encoder clears the bar set for it on all 81 sets:
  - albedo at least 53.1 dB PSNR and SSIM at least 0.999;
  - normals at most 0.48° mean error and 3.6° p99 on detailed blocks;
  - ORM at least 49.7 dB, with no metallic flips.

  The RTX 5090's hardware decode matches the reference decoder bit for bit. Encoding is byte-deterministic across numpy versions.
  - **VRAM** at the 16 GB tier is 3.25 GB against 7.00 GB with PNGs.
  - **Downloads** are 34 % larger, because zlib BC7 compresses worse than PNG on these bakes. Load time showed no measurable difference.
  - **Loading:** KTX2 loads when the adapter has `texture-compression-bc`; PNG stays the source and the fallback. A small GPU encoder compresses PNG-only sets at load.
  - **Not done:** UASTC (Apple / ASTC) waits for an approved toolchain or an in-house UASTC encoder. ASSET_PIPELINE §5.2 and RENDERING §11 are updated.
- **D98 Kitchen "Fill the sink" is sized for the 16 GB tier (producer call, 2026-10-25).** The toggle spawns Matter water up to Z 4.2 m, capped at **1,000,000 particles**: 25 % of the 16 GB tier's 4M grain budget. The cap is a fixed, world-level amount, the same on every machine, because tiers change capacity, never outcomes (SIMULATION §10.5). The brief's tier-scaled cap (62.5k / 250k / 500k / 1M) is replaced. A world with the sink filled records the water in `counts.grains` and requires the 16 GB tier (`requiredTier`), so lower tiers see "needs 16 GB" instead of a different machine. The toggle is a world env op, undoable and synced like other env changes.
- **D99 Multithreaded Jolt ships (D89 resolved, M4 stream J4).** The installed jolt-physics 1.1.1 threaded build works with no rebuild.
  - **Contact path:** contacts are copied into a shared-heap buffer by a same-origin worker script on whichever Jolt thread finds them (`packages/jolt/src/contact-script.js`, which satisfies the host CSP). They are then sorted into a canonical order after the step, which reproduces the old single-threaded order exactly. No golden was re-pinned.
  - **Determinism:** identical hashes at 1, 4 and 12 threads in Node and Chrome, covering all 111 Library demos, Kiloton, Domino Day, late-poke rollback and checkpoints moved between builds.
  - **Default threads:** `hardwareConcurrency − 3`, clamped 2–12. A browser whose helper workers don't start within 10 s falls back to the single-threaded build for the session.
  - **Speed:** Kiloton runs about 2.3–2.7 ms/tick and Domino Day 1.5–1.6 ms/tick, both in real time. Kiloton's blast second is at or just over 7.5 ms at 8–12 threads. Bake & Watch stays as the fallback.
- **D100 M2 texture pass: size calls (M4 stream E4c, provisional, for the art director).**
  - **Density:** four physically large parts stay below the 1,024 px/m density standard at their class's set size: GUTTER 704, VORTEX 399, TRAP BOX 794 and BIG TOP 811 px/m. The renderer's arrays are 1024² and 2048² only, so the cap is the set size, not the packing. Accepted for M4.
  - **PEDAL RIG:** gets 2048² instead of the brief's 4096², which is the critter class.
  - **PIG IRON:** follows its brief, so it's satin cast iron with pitting, not D88's glossy enamel.
  - **GUTTER in play** is still drawn with flat masters by `gfx/gutter.ts`. Its set shows only in the demo glb, thumbnails and the Library until the gutter renderer gets a tiling trim with UVs.

## M4 follow-ups

- **D101 Water buoyancy comes from a surface map and Jolt, not from the particles (orchestrator call, option A, 2026-10-25).** M4 water held a resting body up with only ≈ 4 % of ρ·g·V, so QUACK and SPONGE floated on noise and the fixed latency. Two reasons: after the QUACK-fling fix the backend books a contact's approach, not steady support, and a PBD fluid at 3 iterations × 4 substeps can't build pressure with depth. Now:
  - **Backend (MX contract addition, CPU = GPU):** `MatterStepIn.surface` asks for a 2D x–z grid; `MatterStepOut.surface` returns per column the water count, the highest and lowest particle centre y, and the mean velocity (64-bit sums). It's optional: without the request nothing changes, and the Sandstorm matrix is identical on all four implementations: CPU over 120 ticks, D3D12 and D3D11 over 600, SwiftShader over 30.
  - **Sim (`matter/buoyancy.ts`, `host.ts`):** each command asks for 2 cm cells around the dynamic bodies in the active region while there's water. The newest map is plain state (`st.matter.surf`, hashed). Every rigid tick, each awake, pushable body beside water gets Jolt's `ApplyBuoyancyImpulse` on its current pose, against the level of the wet cells in a ring around its footprint, at ρ = 1,000 kg/m³ and with drag relative to the water's mean flow. A linear damping of 4/s, scaled by how much of the body is under, makes a bob settle.
  - **No double counting:** for a sub-shape that's in the water, the particle impulse loses its upward part and its torque. That's the same support again, noisy and 67 ms late, and it doubled a light body's lift and rocked it. Downward pushes (water poured on it), sideways flow and splashes stay, and dry sub-shapes keep everything, so a WATERWHEEL turns as before.
  - **Δv limiter (MX's recommendation):** a Matter impulse may change a body's velocity by at most its speed relative to the water plus 1 m/s, and its spin by at most its spin plus 20 rad/s.
  - **Measured:** in a still pond, lift = m·g ± 0.03 % at rest, and float depths match Archimedes (PLANK 60 %, a ρ 679 sphere 62.2 % against an exact 62.1 %). In real Matter water a dropped QUACK floats upright with ≈ 12 % of its hull under, Jolt carries 1.00 m·g, and the particles add 0.00 m·g (it was ≈ 0.5 m·g).
  - **Matter off:** unchanged, and so is any Matter-on world without water near a body. `MatterOptions.buoyancy = false` restores the M4 behaviour.

## M5 kickoff: provisional calls

The producer asked to start M5 while the water-buoyancy session (D101) runs. These calls unblock work, and **each is provisional**. M5_PLAN has the streams.

- **D102 M5 fields act on rigid bodies only.** No doc specifies how GRAV WELL, TRACTOR BEAM, SINGULARITY, STASIS FIELD, RIFT GATES or COILGUN RING should act on Matter grains (SIMULATION §5.12 names bodies only). The backend has no per-region gravity, freeze or teleport, and its blast radius tops out at 8 m (the Singularity needs 20 m). So these fields move Jolt bodies, and grains respond only through contact with those bodies. The Singularity despawns bodies, not grains. GOO VAT is the one M5 part that touches grains. Grain fields can come after beta if playtests ask for them.
- **D103 Rollback-safe mechanisms for FORCE WALL and STASIS FIELD.**
  - **FORCE WALL:** switches between the static and ghost layers, re-derived in `afterRestore`, instead of SIMULATION §5.12's `ActivateBody` / `DeactivateBody`. Deactivating a static body doesn't stop collisions, and Jolt's saved state doesn't record layers (the Bandit-steal lesson).
  - **STASIS FIELD:** uses ZONE's zero-velocity, cancel-gravity approach every tick instead of a kinematic switch.
  - A rollback test across every switch is required (M5 rule 14).
- **D104 Matter gravity follows the world.** Matter gravity is a hard-coded constant (≈ 9.67 m/s²). World gravity % and zero-g zones never reach grains, so sand would fall at Earth gravity on the Moon (16.5 %) and in the Hangar (38 %).
  - **The fix:** grains use the world's gravity, with zero-g zones applied per grain, in integer math and bit-exact.
  - **When:** X5 does it after the water fix lands, re-running the D91 matrix.
- **D105 BUZZ and tagging.**
  - **Tagging:** "tagged" objects carry a new `PartFlagBits.tagged`, set by a Build-mode toggle with the tag glyph.
  - **Flight:** BUZZ flies with a deterministic controller: its capsule's gravity is off and steering is a PD. It docks on its paired BUZZ BEACON.
  - **Carry:** the carried item rides as a ghost body, like Bandit's (critters.md BUZZ, SIMULATION §7).
- **D106 The M5 beta bar.**
  - **Feature-complete** means every Ship ≤ M5 part, critter and environment in GAME_SPEC is playable, with art, audio, captions and HOW_TO_PLAY.
  - **Docs current** means no doc describes code that doesn't exist, or omits shipped behaviour. That covers the phantom packages, the KNCP format, layer counts, the desync sizes and the 8M-grain tier.
  - **Release checks:** a `playtests/` log has started, the full suite and soaks pass, and the D91 matrix is re-run on the final kernels.
  - **Not beta blockers:** the known limits in M4_STATUS that aren't polish (solver depth limits, real AMD / Intel / Apple GPUs) stay open.
- **D107 Designed-but-unbuilt features are post-beta (M5, provisional).** D5's docs pass marked several GAME_SPEC / RENDERING / ENGINEERING design features as "not built". They are post-beta, not M5 blockers, under D106's bar (docs must not describe code that doesn't exist):
  - desync report files;
  - saved replays and `simVersion` bundles;
  - the asset manifest and service worker;
  - Docker hosting;
  - shell fur;
  - Hi-Z culling, SSR, motion blur and clustered decals;
  - `tools/bake` (SDF / impostor bakes);
  - the HOW_TO_PLAY §13 build-UX items.

  Global WIND (D26) is the exception: it is a world setting players see in the Backlot weather presets, so it ships in M5 (stream W5). The host's part caps now come from the format's single tier table: they were missing the 32 GB tier, which capped a 5090 session at 20,000 parts. That bug is fixed, with a regression test.
- **D108 Hash reports carry their poke count; amends D59 (M5).** D59 assumed a late poke always rewrites a hash before it is reported. That doesn't hold for the game client: it bakes up to 480 ticks ahead, so a client usually reports hashes made *before* a poke reached it. That was the cause of the 2026-10-25 playtest "desyncs" (docs/dev/M5_NOTES_DESYNC.md).
  - Every `hash` message now carries `pk`, the number of pokes the state depends on (`packages/net/src/hashes.ts`).
  - Clients re-report every tick they re-bake after a rollback or re-sync.
  - The host compares a tick only when the reports' `pk` values match, so a real divergence (same `pk`, different hash) is still flagged.
  - Reports without `pk` compare as before. The change is additive, so PROTO is unchanged.
  - The host broadcasts `bakedMin` whenever it differs from the last value broadcast, so a partner whose worker hasn't reported yet holds the others at 0. Before, the min never "changed" from 0, so the faster client played on unconstrained.
  - Regression tests: `apps/host/test/latepoke.test.ts`.
- **D109 Goo is a spring fluid (M5, X5).** Goo (Matter kind 3) uses an averaged spring model with weak cohesion, not water's double-density solver, which blew small blobs apart.
  - Goo holds together, flows like syrup and drips. A big blob doesn't hang from a ceiling: one layer sticks and the rest drips off.
  - It sticks to bodies with a yield, booked as impulse (`GOO_STICK` 24).
  - It isn't buoyant: at 1,050 kg/m³ it's outside the water-surface map, so nothing floats in it.
  - Details: docs/dev/M5_NOTES_X5.md decisions 1–3.
- **D110 Matter gravity mapping and the symmetric push (M5, X5; implements D104).**
  - Grain gravity is `G = 192 + 2,624 × p` in Q8, where p is the world's gravity fraction. Earth is bit-identical to M4, and 0 % is exactly 0. A linear `2,816 × p` would let the damping's truncation slow Moon grains to about 53 %.
  - The proxy push now rounds sign-symmetrically. Before, resting grains crept downhill on any tilted surface: 1.1 m in 4 s on the Moon. This re-pinned `GOLDEN_MIX`, and Sandstorm checksums differ from M4's from tick 9. The D91 matrix was re-run on the final kernels and passes.
  - Moon regolith becomes static box tiles under the active region.
  - Grains ignore wind and air %: `env.wind` is rigid-only.
  - Details: M5_NOTES_X5 decisions 4–7, M5_SANDSTORM_MATRIX.md.
- **D111 QUACK's keel (M5, X5).** An optional `PartDef.body.com`, built on Jolt `OffsetCenterOfMassShape`, moves QUACK's centre of mass 10 mm lower so it self-rights. QUACK is the only part that uses it.
- **D112 Hangar Earth phase is art-directed (M5, E5c).** The Hangar's baked Earth uses a 105° phase instead of the true sun's 130°, so the window shows a sunlit crescent. The Moon keeps the true sun.
  - Earth lighting is baked, so Earth doesn't spin. The brief's 1°/min rotation is post-beta: it needs runtime lighting.
  - **Lifted by D126 (beta polish):** the Earth is now lit at runtime and spins 1°/min. The 105° phase is kept, applied by the renderer from the env data's `phaseDeg` (D128).
- **D113 Glass probe waits for steady frames (M5).** The boot probe of the glass cost (UI_UX §8) compared 30 solid frames with 30 glass frames, 2.5 s after launch, while about 150 texture sets were still streaming in. Loading noise read as glass cost (4.5 ms, over the 4 ms budget), and the UI switched to solid Graphite for the session, even on an RTX 5090. Found in the M5 Chrome check.
  - The probe now waits until frame times are steady, which changes nothing on screen. It checks every 3 s, up to 10 times.
  - It then runs one solid → glass → solid measurement and takes the glass round against the mean of the solid rounds either side (`glassCostFrom`). A probe that stays noisy keeps its smallest estimate.
  - If the budget trips because of the glass estimate (the UI work alone is under budget), the glass is re-measured once before falling back to solid.
  - Tests: `apps/game/test/ui-logic.test.ts`.
- **D114 The 32 GB tier keeps 8M grains, time-dilated (M5, producer call).** Measured by T5 on a quiet RTX 5090: 8M grains fit (VRAM ledger 8.92 of 22 GB) but cost 130.8 ms per settled Matter tick, about 0.13× real time. 4M is 53.9 ms, about 0.31×; 1M is 11.38 ms and the largest real-time count. Huge pours at 32 GB run dilated or through Bake & Watch, as D92 allows. `TIER_CAPS` is unchanged.
- **D115 The §15.2 frame targets are for typical worlds (M5, producer call).** At maximum content with everything in view, only 4 GB and 16 GB meet 60 fps on the 5090. 8 GB, 12 GB and 32 GB measured 20–29 ms ungoverned, and governed 8 GB settles about 16 ms (G5). Empty-world settings cost 1–3 ms per tier, so the misses come from drawing 100k–2M parts: key-light shadow range, the CPU spot-cone cull, main pass. The measured max-content numbers are recorded in GAME_SPEC §15.2 and M5_NOTES_T5.md. That renderer work is post-beta, with the D107 list. The targets are a promise for typical-size machines; a max-content machine runs correctly, just below 60 fps.
  - **Update (beta polish, D125):** the shadow range and the spot-cone cull were done after all. The remaining max-content costs are the main pass, the AO prepass and the grains (GAME_SPEC §15.2).
- **D116 Jolt's contact and pair buffers scale with parts (M5; restores D89 on huge chain reactions).** J5 found that two 8-thread runs of a 154k-part domino world diverged at 21 s. The orchestrator verified the cause.
  - **Cause:** `joltCapacity` capped contact constraints at 2^17 and body pairs at 2^18. Once about 117k bodies were awake, Jolt silently dropped contacts, and with job threads which ones it drops varies run to run.
  - **Proof:** with the buffers raised, the two runs are bit-identical for all 24 s, and identical to the old runs for the 20 s before the overflow.
  - **Fix:** 4 contact constraints and 8 body pairs per part, up to `CONTACTS_MAX` (2^20) and `BODY_PAIRS_MAX` (2^21), and never below 1.5× the start-state estimate. The J5 heap formula grows with them. The 154k domino world's heap goes from 2,176 to 2,624 MB.
  - **Known limit:** past those maximums (over 1M contacts awake at once) Jolt can still drop contacts, and threaded runs could then diverge. JoltJS's `Step` returns no error flags to detect it.
  - **Tests:** `packages/parts-data/test/heap.test.ts`.
  - The same pass fixed `contactEstimate` on 1M-part worlds: one string-keyed Map over 2^24 cells threw. It's now a numeric, sharded grid that gives identical totals (`packages/sim/test/capacity_big.test.ts`).

## Beta prep (producer)

- **D117 Drag-to-move and the transform gizmo ship for the beta (producer call, stream DRAG, 2026-10-25).** Moving parts with the mouse was post-beta (D107, HOW_TO_PLAY §13). The producer wanted it before beta testing, then asked for the gizmo too ("I want it to be easy to play"). Both are UI plus document ops: no sim change, no golden hash changes. Notes: [M5_NOTES_DRAG.md](M5_NOTES_DRAG.md).
  - **Drag-to-move (Select tool):** press a part and drag past 4 px; a plain click still selects. A part in the selection moves the whole selection, else it's selected and moves alone. Placement ghosts, grid snap, surface-follow and the red "blocked" tint use the placement code (`ui/dragmove.ts` `overlapOf`, `snap`, `surfaceY`). Ctrl+wheel and PageUp / PageDown raise the work plane mid-drag. Shift moves vertically, Alt is free and Ctrl is 2.5 cm. R / T / Y work mid-drag (with several parts, R turns them about the grabbed part, and T / Y are one-part only).
  - **One gesture is one op.** A `Batch` of the same `PartUpdate`s the keyboard move sends, plus `LinkUpdate`s for waypoints of links whose two ends both moved. That makes it one undo step and one co-op op. The live preview goes to the partner only as presence (`ghost`, already in the protocol, 20 Hz) and soft locks, so they see "Sam · holding PLANK".
  - **Refusals:** locked parts and locked layers, parts the partner holds, a run in progress, an overlap, or a drop outside the world preset.
  - **The gizmo:** axis arrows, plane squares and rings (15°, Shift = 5°, Alt = free) edit the same Euler angles R / T / Y do. A multi-selection turns about its bounds' centre. Corner cubes resize ZONE, FORCE WALL and STASIS FIELD with the sizing handles' maths and limits. While the gizmo is on, its corners replace the face handles.
  - **Gizmo drawing and keys:** it's drawn by the renderer on top of everything (`SceneItem.top`, about 0.003 ms GPU measured at 16 GB). **A** toggles it, because G is the ping key. It's on by default.
  - **A placement fix found on the way:** with a raised work plane and nothing under the cursor, the placement ghost used the plane only for x / z and sat on the floor. It now rests on the plane, as HOW_TO_PLAY §3.2 says, and drag-to-move shares that rule.
  - **Still post-beta:** box select, copy / paste / duplicate keys, mirroring, wall and surface work planes, and port snapping while dragging.
- **D127 Audio reads part props, and Matter in clips runs on the frame clock (beta polish, stream AUDIO, 2026-10-25).** This closes the five audio gaps F5 recorded (M5_NOTES_F5 "Deviations"). There's no sim change and no golden changes. Notes: [BETA_NOTES_AUDIO.md](BETA_NOTES_AUDIO.md).
  - **Static props, not state bytes:** GRAV WELL's attract / repel mode, FORCE WALL's size and RIFT GATE's pair colour are document props that can't change during a run, so no sim state byte was needed. When a run starts, main.ts hands them to the director (`GameAudio.setPartProps`, for `AUDIO_PROP_TYPES` only). A clip's director gets the same list.
  - **GRAV WELL Repel** has its own hum: a fifth higher, brighter, rising where Attract dips, with a brighter spin-up.
  - **FORCE WALL:** the hum's gain goes with √area (0.01–1 m²), and its panner reference distance grows from 0.6 to 1.4 m (the "spread"). Measured span: 18.5 dB at 1.5 m and 17.8 dB at 6 m from 0.1 × 0.1 m to 1 × 1 m. That's within the loop cap and the limiter; it peaks at the old 1 m² level.
  - **RIFT GATE pairs** play one shared loop source (`LoopOpts.sync`), so a pair has one LFO phase: correlation 0.997 at lag 0. The director pairs gates as the sim does.
  - **Zero-g ring drones** follow `env.zones`: `setEnvironment`'s 4th argument, from main.ts.
  - **Matter in clips:** the clip's director probes every frame. `clipSettle()` holds the offline render until that frame's readback is applied and the granular worklet has confirmed it. The lag went from 2.75 frames to 0, the same as an event on the same frame. Clip events also drop the live 10 ms margin.
    - What remains is the master chain's 11 ms lookahead (glue + limiter), common to every clip sound. Compensating it in the clip's cut is left for later.
  - **BUZZ startle (PARTSIM, D121):** a short yelp and rotor surge (`buzz/startle`) on the `startled` state, in place of the alarm whoop.
- **D118 The run state is plain, alias-free data, copied by `clonePlain` (beta polish, stream SIMFIX, 2026-10-25).** Copying `st` with `structuredClone` was half of the rigid-checkpoint hitch on worlds over 20k parts: 20–45 ms at 77k–154k parts. `Machine.checkpoint` and restores now use `clonePlain` (`machine.ts`): arrays of numbers are sliced, nested arrays and objects copied member by member. That's ≈ 5 ms at 77k parts, and checkpoint ticks shrink by 15–45 ms. Notes: [BETA_NOTES_SIMFIX.md](BETA_NOTES_SIMFIX.md).
  - **The contract:** `st` holds only JSON-safe plain data: numbers, booleans, strings, null, arrays and plain objects. No typed arrays (JSON doesn't round-trip them), Maps, Sets, class instances or shared references: a copy doesn't keep two references to one array shared. Desync repair's JSON round trip already required this, and `rollback_rule14.test.ts` checks the copy against `structuredClone` on every part scene.
  - **Not done:** the rest of the hitch is Jolt's own `SaveState` (≈ 20–50 ms at 77k parts). The JoltJS binding can't pre-size or reuse the recorder's stream, and skipping sleeping bodies or contacts would make rollback inexact.
- **D119 Rule 14 is enforced by a three-way test, and path-dependent Jolt values are restored exactly (beta polish, stream SIMFIX, 2026-10-25).** The PING relay lost on rollback (playtest 2026-10-25) was state outside `st` that nothing reset. The audit found four more gaps (FLAP friction, a BIG TOP's caught Roller, SPRINKLE CAN / SPONGE masses, the SPRINKLE CAN latch motor). Two of them desynced the hash. Notes: [BETA_NOTES_SIMFIX.md](BETA_NOTES_SIMFIX.md).
  - **What Jolt saves, by experiment:** positions, velocities, activation, contacts, constraint enables, and motor states and targets. Not saved: object layers, gravity factors, mass and inertia, collision groups, limits, friction, and motor settings. Each module either keeps such a setting every stage 6 before the step, or re-derives it in `afterRestore` from `st`.
  - **Values that depend on their history are written back exactly.** One example is inertia after a chain of Jolt `ScaleToMass` calls. The exact values (`st.m2.m4.mp`) are written back rather than re-derived from `st`, because re-deriving rounds differently. History that only grows (ever held, ever carried) is a build-time set that `afterRestore` reads.
  - **The gate:** `packages/sim/test/rollback_rule14.test.ts` runs every part fuzz scene and every Library demo three ways: straight, rolled back from further on, and adopted by a fresh machine. They must agree on the hash and on a fingerprint of every unrecorded Jolt setting one tick after the restore. A new part, or a new behaviour module, passes it before it ships.
- **D128 Space-set art for the beta: calmer Hangar values, solar modules, Earth inputs for runtime lighting (beta polish, stream ART, 2026-10-25).** There's no sim change: colliders, `env_*.ts` boxes and hulls, and goldens are unchanged. Notes: [BETA_NOTES_ART.md](BETA_NOTES_ART.md).
  - **Hangar tones:** they vary per rib run (the full wall height between two ribs, the ceiling strip between two beams), and the deck varies per rib-sized block of tiles. E5c varied them per panel, which read as a patchwork in engine.
    - The variation masters sit within 0.16 stop of `panel_white` (they were 0.39) and the deck within 0.08 (it was 0.19).
    - The neutral zone and its 2 m margin stay one material (§0.9).
  - **Moon solar arrays:** 6 × 3 one-metre modules with 8 cm gaps over a darker `kn_env_solar_grid` backplate. They were 12 × 6 cells with 3 cm gaps over brushed steel.
    - The engine draws env LOD0 at every distance, and the gaps were sub-pixel at 40–80 m.
    - A textured plate with a mipped cell grid needs the env loader to bind a second texture set per environment. It only binds `textures[0]` (the Earth), so that's left to RENDER as an option.
  - **Earth:** the set ships runtime-lighting inputs:
    - albedo = unlit reflectance;
    - `orm` = data: R clouds, G night-lights (ungated), B water mask;
    - normal flat.
    - The env data gains `earth.lighting: 'runtime'` and `degPerMinute: 1`. The Hangar also gains `phaseDeg: 105` (D112's art phase, applied by the renderer), and its `spinAxis` is `[0, 1, 0]` (it was `[0, 0, 0]`).
    - The lit composite is still baked for Cycles only (look-dev renders and the IBL bakes), to `assets/src/env/<env>/earth_<env>.lit.png`.
    - This lifts D112's no-spin together with RENDER's runtime planet lighting (D125–D126).
- **D120 TURBINE in global wind, GRABBER fingers (beta polish, stream PARTSIM, 2026-10-25).** Global wind turns an intact TURBINE's rotor through its 25° blade pitch instead of pushing it as plain drag. A rotor governor applies to every wind source: the drive fades out between 28 and 32 rad/s, because past about 35 rad/s the rotor stopped dead against its hub. The GRABBER's fingers are their own kinematic bodies that slide shut on the payload. Zone A accepts a height within the payload's bounds ± 1 cm. Re-pinned goldens: `goldens_m5` grabber. Details in [BETA_NOTES_PARTSIM.md](BETA_NOTES_PARTSIM.md).
- **D121 TRACTOR BEAM occlusion and BUZZ startle / load (beta polish, stream PARTSIM, 2026-10-25).**
  - **TRACTOR BEAM:** a body in the cone is shadowed, neither pulled nor counted toward the load, when a closest-hit ray from the lens to its centre of mass first meets something else. A switched-off FORCE WALL doesn't block.
  - **BUZZ startle:** BUZZ startles for 0.6 s at 100 dB or more after distance and occlusion. Touches don't startle it.
  - **BUZZ load:** a carried load sags its hover by up to 5 cm and slows its climb by up to 45 %, by mass.
  - **BUZZ set-down:** if a load pushed down would sink more than 3 cm into a surface, BUZZ sets the item down.
  - **Re-pinned goldens:** the BUZZ demo and the BUZZ full fetch.
- **D122 The playtest's UI and capture bugs (beta polish, stream UIFIX, 2026-10-25).** These are bugs 2–9 of playtests/2026-10-25-autoplay.md and its undo note. There is no sim change, no golden change, and no host or protocol change. Notes: [BETA_NOTES_UIFIX.md](BETA_NOTES_UIFIX.md).
  - **The offline render restarts the auto cameras at the clip start.** It calls `CameraRig.restart(history)` with the run's events up to the first frame. The director also drops its future when the playhead goes back. Clip cuts now match the live cuts to within 0.2 s.
  - **Radial menu:** hold Q, point, let go, at the pointer, also with Keyboard building aids on. A tap shorter than 300 ms stays open (sticky). The menu's subject is fixed when it opens.
  - **GRABBER zone pointing:** clicking a loose part sets the zone to the part's centre and contact height. Static parts and the floor keep the clicked point.
  - **Cascade Report:** only its body scrolls. Chain steps always scrub (`RunController.setPlay(…, ahead)` goes past the bake head); after the run, a step replays to that tick.
  - **Capture:** an encoder whose stream declares another frame size is skipped (NVENC AV1 codes 1080p as 1088 lines), so 1080p takes HEVC. The time estimate is the draw plus a per-frame residual measured on earlier renders (`capture/estimate.ts`).
  - **Stop with Matter:** the host is no longer destroyed under a waiting worker. The worker's 'destroy' releases it, with a 3 s backstop. Released (2) and lost (1) are told apart.
  - **K.O.:** the HUD counts the report's knock-on steps (distinct part A → part B cause edges), at the playhead.
  - **Undo:** goes through the op queue, so it can't overtake an edit still queued by the 150 ops/s window.
- **D123 Box select, copy / paste / duplicate, mirror and gizmo local axes (beta polish, stream BUILDUX, 2026-10-25).** UI and document ops only: no sim, golden or host change. Notes: [BETA_NOTES_BUILDUX.md](BETA_NOTES_BUILDUX.md).
  - **Box select:** in the Select tool, a left drag that starts on empty space draws a marquee. A part is in when the middle of its bounds is inside; a port-less path (TUBE) when all its points are. Plain replaces, Shift adds, Ctrl toggles. Locked, hidden and section-boxed parts aren't pickable, so they're skipped. Left-drag on empty space no longer orbits in the Select tool; right-drag orbits everywhere, and the other tools keep left-drag navigation.
  - **Copy / paste / duplicate:** Ctrl+C copies the parts and every link whose ends and vias are all copied (a TUBE run when it's selected). Positions, turns, props and the Anchored / Tagged flags are kept; Locked, Hidden, layer and group aren't. The clipboard lives in `sessionStorage`, so it crosses worlds in one browser session. Ctrl+V carries the clip as a drag-to-move ghost (`DragMove.carry`): grid, resting surface, work plane, R, red when blocked; a click drops it. Ctrl+D lands the copy one grid step along +X, stepping on (then +Z, −X, −Z) until it overlaps nothing, and selects it. Each is ONE `Batch` (PartAdds, then LinkAdds) with ids from `net.nextId()`: one undo step, synced like any edit.
  - **Pairs re-pair:** a RIFT pair or BUZZ + its beacon copied whole becomes a new pair in a colour nobody uses; same-colour PINGs copied together become a new group; a lone gate, beacon or BUZZ pairs as if just placed (`autoPair`); a lone PING keeps its colour.
  - **Mirror (Alt+X / Y / Z):** across the plane through the selection's bounds centre, snapped to half a grid step. There are no mirrored part variants (`PartFlag.Mirror*` stay reserved), so a part becomes its own mirror image only through a mirror plane of its own: R' = M_a · R · M_b. `partSymmetry` finds the planes from the colliders, blockout visuals, joints (limits must be symmetric where the sense flips), centre of mass and ports (re-indexed when they swap). Planes y = 0 and z = 0 are only used for behaviours with no front or top. A part with no plane keeps its turn, only its origin mirrors, and the toast names it. Refused like a drop when it would overlap a part outside the selection.
  - **Gizmo local axes:** X (remappable, ACTIONS `gizmoAxes`) and the palette toggle world / local for the arrows and squares, per viewer (`kn.gizmoAxes`), world by default. Local = the primary part's own axes; the travel along a turned axis snaps (10 cm, Ctrl 2.5 cm, Alt free). Rings are unchanged.
- **D124 Port snapping and the turned partner ghost (beta polish, stream BUILDUX, 2026-10-25).**
  - **Port snap** (GAME_SPEC §7.2 rule 1) while placing, dragging and carrying a paste: a moved port within 0.5 cells (5 cm) of a compatible port on a still part pulls the move onto it. Compatible = same channel, output ↔ input for Signal and Power, neither port full. Compatible ports within 30 cm glow in their channel colour, the joined one pulses, and the drag badge says "port". Ports sit a few mm inside their faces, so a coincident snap that overlaps the snapped-to part is pushed out along that port's face normal until the parts touch, socket to socket. A snap is only taken when it doesn't make the drop blocked. Alt turns it off for a move; Settings › Controls › "Snap to ports" (on by default) turns it off. The gizmo doesn't port-snap; moves of more than 64 parts don't either.
  - **Partner ghost:** presence `ghost` gains optional `rot` (quaternion) and `parts` (up to 32 held parts as `[type, dx, dy, dz, qx, qy, qz, qw]`: mm offsets from `pos`, quaternion × 10 000). That's append-only, so PROTO stays 1 and old clients still read `type` + `pos`; it is still sent at presence's 20 Hz (about 1 KB at 32 parts). The partner draws every held part turned, and the tag reads "holding 5 parts".
- **D125 The key light's shadows fit the view; the shadowed lamp and gizmo are fixed (beta polish, stream RENDER, 2026-10-25).** Renderer only: no sim, golden or host change. Notes: [BETA_NOTES_RENDER.md](BETA_NOTES_RENDER.md).
  - **Two cascades:**
    - **Near:** M5's focus box, capped at 160 m across and fitted to the scene's light-space bounds.
    - **Far:** half resolution, covering the camera frustum up to 3 × the focus distance + 30 m (60–1,500 m) ∩ the scene. Part shadows fade over its last 20 %, and it's skipped when the near map holds the whole view.
    - Both step along a 2^(1/8) extent ladder and snap to whole texels.
  - **Casters are culled per cascade on the GPU:**
    - one LOD coarser than the camera (the far map: the coarsest LOD);
    - the mesh's box below 5 px on screen or a few texels in that map;
    - nothing below ½ px or ⅓ texel;
    - nothing whose swept shadow can't reach the view.
    - Whole-world shadow pass, quiet A/B on the RTX 5090: 15.2 → 6.0 ms at 12 GB, 19.7 → 6.8 ms at 32 GB (provisional). Governed 12 GB no longer needs the governor's last step.
  - **Matter and debris** still draw into the near map only.
  - **Shadowed practical:** its casters are culled on the GPU in the same pass. That removes the 7.4–8 ms CPU cone test at 400k parts, and the old 4,096-caster cap.
  - **The transform gizmo** (D117) is kept out of fog and DOF by a coverage mask.
  - **LOD and impostor switches use each part's real size** (orchestrator-approved correctness fix): the mesh's LOD0 bounding sphere × its scale. Before, `inst.radius` counted every art part as 0.87 m across.
    - **Impostors:** they switch in under 8 px across (the preset's 24 px is the ceiling), because at 24 px their nearest-view orientation snapping popped.
    - **Impostor bake:** textured materials now bake their set's albedo, and the impostor lighting is re-matched to the meshes.
    - **Measured** (quiet A/B): 12 GB Arena preset main pass 14.6 → 6.8 ms, frame 22.9 → 13.3 ms, and no tier regressed.
    - **Popping:** a 2–100 m dolly and per-switch checks of STITCH, PIN, BIG TOP and LIFT show no visible pops.
- **D126 The backdrop Earth is lit at runtime and spins; distant set detail gets a distance LOD (beta polish, stream RENDER, 2026-10-25). This lifts D112's no-spin.** Notes: [BETA_NOTES_RENDER.md](BETA_NOTES_RENDER.md).
  - **Earth inputs:** with D128's input maps, `fs_earth` relights the Earth every frame from the set's sun, with E5c's bake terms: terminator, sunset band, cloud shadows, night side, city lights, glint and limb glow.
  - **Spin:** `degPerMinute` (1°/min) about `spinAxis`, from the wall clock, so every player sees the same planet.
  - **Phase:** the Hangar keeps D112's art-directed 105°, now applied in the renderer from the env data's `phaseDeg`. The Moon keeps the true sun.
  - **Solar panels:** the Moon's solar arrays draw the glb's gap-less LOD2 slabs once an 8 cm module gap is under ¾ px. That LOD drops the backplate, which z-fought the cells in the 24-bit depth buffer past ≈ 150 m, and is tinted to the module's area mean. Shimmer in a far crop is halved, and the hero views keep the grid.
