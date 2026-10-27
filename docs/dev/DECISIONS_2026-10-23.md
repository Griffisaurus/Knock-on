# Reconciliation decisions (2026-10-23)

Binding design decisions from the full numbers audit ([AUDIT_2026-10-23.md](AUDIT_2026-10-23.md)). They are already applied throughout the docs; this file records the reasoning.

These override any conflicting proposal in the A1–A6 audit reports. Apply them everywhere they touch.

## Parts and geometry
- D1 FULCRUM stays 6×1×2 cells; hinge range is ±12° (the beam end meets the floor at ~12.9°). Update GAME_SPEC catalogue text and any "±30°" mention.
- D5 The whole/half-cell footprint rule applies to placed devices. Free bodies (Rollers, critters, Yolk, loose props) are exempt (GAME_SPEC §19, ASSET_PIPELINE §3.1/§3.2).
- D6 ZIPPY channels: Signal → drive, plus Tension (tow port).
- D7 TRAP BOX becomes 7×5×5 cells (0.70 × 0.50 × 0.50 m outer) so every critter fits, including Dusty (Ø 0.366): interior ≈ 0.66 × 0.46 × 0.46 m at floor level. Update GAME_SPEC, frame.md, critters.md (remove "Dusty doesn't fit").
- D9 BUZZ BEACON is 2×0.4×2 cells.
- D10 RIFT GATES are 4×4×0.5 cells each (opening ≥ 0.30 m, passes every Roller).
- D30 BIG TOP keeps 6×4×4 as a squat circus mortar (A3's internal rework is canonical).
- D31 BANGSTICK canonical geometry is boom.md after A3: sticks Ø 0.05 × 0.28 m, three capsules r 0.025 / half-height 0.115, origin at centre of mass 0.039 m above the floor, fuse port (0.14, 0, 0.029), detonator port (−0.14, 0, 0) (Blender Z-up; convert to engine Y-up in DATA_FORMATS). PART_SYSTEM §9 and DATA_FORMATS §8 must match exactly; `macroChunks: 4`, no `breakable` block, fx ids `fx/fuse_spark` and `fx/boom_small`.
- D33 FISHBOWL ships in M2 with a no-Matter fallback (cosmetic water burst + Goby flop); Matter water arrives in M4.
- D38 COG set is Class S (catalogue wins); fix GAME_SPEC §19.6.
- D39 RACK length 2–20 cells.
- D40 RINGER timer range 1–30 s (add to the catalogue row).
- D41 PEDAL RIG is a Spin source in the Drive family (not a "generator"); MAGLOCK and PEDAL RIG get the Tension ports their briefs define.
- D42 Cable diameters: power 9 mm, signal 5 mm (shared_kit).
- D49 LOD3 may go down to a 12-tri box / 20-tri icosahedron; explosives may use 4 macro fracture chunks (minimum 6 elsewhere).
- D50 ART_BIBLE: HELIO is the one Roller with a port ring (its string clip). Bevel rule for thin/resizable parts: ≥ 2 mm or 1.5 % of the smallest cross-section dimension, not of the full length.

## Gameplay numbers (SIMULATION is canonical after these edits)
- D2 HELIO "toy helium": constant buoyant lift F = 4.9 N × air% (≈ 0.5 kg-equivalent at Earth gravity), applied at the body centre, plus normal gravity on its 0.004 kg mass. One Helio lifts an empty Scoop (0.45 kg) slowly. GAME_SPEC §12.1 behaviour text: "toy helium (~0.5 kg of lift)".
- D3 Ball friction/restitution come from rollers.md; SIMULATION §4.3 lists every ball explicitly. GLINT is `glass`, YOLK `ceramic`, FUZZ `fabric`, HELIO `latex`.
- D4 HELIO pops on sharp-tagged contact, any heat source, or contact speed > 6 m/s (replaces J > 2 N·s).
- D8 FABRICATOR has no power draw (Signal only); remove it from the SIMULATION §5.5 demand list.
- D11 HOVER PAD is a dynamic levitating platform held 0.5 m above its base by a spring-damper; it carries loads.
- D12 RIFT GATES: max 1 transit per 0.25 s per gate pair.
- D13 GOBY flops for 8 s (lure for Mochi), then the bubble rescue.
- D14 HENNY flap lifts 1 m.
- D15 TRACTOR BEAM has pull and hold modes (hold = spring to a point 0.5–3 m along the beam).
- D16 DYNAMO no free energy: it applies a braking torque on its input hinge τ = P_drawn / (0.6 · max(|ω|, 1 rad/s)) (60 % efficiency). Output watts = min(300, 40·|ω|) and never more than 0.6 × the shaft power delivered. A 120 W Motor driving a Dynamo yields ≤ 72 W.
- D17 TURBINE torque: each blade collider receives a tangential force F_t = 0.38 × the axial wind force on that blade (25° pitch: sin·cos), giving torque about the hinge. Add this to SIMULATION §5.8.
- D18 Speeds and torques: MOTOR no-load 1.5 rev/s (9.42 rad/s), stall torque 2.0 N·m at full supply; HAMSTER DRIVE wheel 5.0 rad/s, 0.3 N·m, 6 s sprint; PEDAL RIG crank 1.0 rev/s (flywheel and output 3.0 rev/s), 1.0 N·m, 8 s per stimulus; GRABBER draws 100 W.
- D20 PIP in a HAMSTER DRIVE: asleep at rest (no spin) → bumped → 6 s sprint (Spin source) → 1 s coast. Idle never spins.
- D26 New environment setting WIND: 0–15 m/s with a direction (Backlot weather presets set it; default 0). Add to GAME_SPEC §5.4 and SIMULATION §5.8 as a global air-flow term.
- D27 JITTERJUICE triggers at an impact ≥ 0.15 N·s (the Cork Blaster cork, ~0.37 N·s, sets it off); near-miss feedback at 0.08 N·s. Record in SIMULATION §6 and the GAME_SPEC row.
- D28 POPPER is an Air puff only (no yield); it is not an explosive.
- D29 CORK BLASTER cork is tagged `sharp` (pops Helios).
- D34 Matter particle sizes: water particle = 1 mL (radius 6.2 mm), sand grain ⌀ 4 mm, marble = real ⌀ 16 mm body. Litres convert to particle counts with these. Record in SIMULATION §8.
- D35 FLAMER: gas-fed (Signal valve), no power draw unless powered mode is chosen (80 W). POWDER KEG cooks off after 1.5 s of continuous heat.
- D36 VFX vs gameplay reach: visuals may extend up to 1.3× the gameplay reach. Flamer gameplay beam 0.6 m, visual ≤ 0.8 m. Wick: 25 mm hot core, 40 mm visual flame. Add a Skyrocket exhaust effect to vfx.md.
- D37 Spark/splinter counts for kegs: vfx.md is canonical; update the GAME_SPEC example to match.
- D19 BANDIT leg reach 0.20 m with the Pedal Rig geometry from A2 (saddle 0.03 m behind the crank) is canonical.

## Platform, tiers, UI
- D21 Tier IDs are the GB names (4/8/12/16 GB). Low/Medium/High/Ultra are declared shorthand only: Low = 4, Medium = 8, High = 12, Ultra = 16. Add the alias row to GAME_SPEC §15.2; replace "High+"/"High tier" wording with GB names.
- D22 Sim threads: Jolt pool = hardwareConcurrency − 3, clamped 2..12 (GAME_SPEC §15.2 note, §18).
- D23 Keys: chat "/", Perf HUD F9, Shift+R/T/Y rotates the reverse way, Shift gives 5° steps only while rotating with the mouse.
- D24 Dynamic light caps per tier come from vfx.md §0.1 (RENDERING §6.2 must match).
- D25 The Studio supports Desk → Arena.
- D43 Shell fur on the 12 GB and 16 GB tiers.
- D44 The multiplayer partner drone must not read as Buzz ("Buzz-style" removed).
- D47 GAME_SPEC small fixes: fog contrast 8.0:1 on void; 12 GB tier = 2M grains in §6.4; audio "3 intensities × 6 variations"; §18.3 part example matches PART_SYSTEM §9; §5.3 awake-body numbers align with SIMULATION §12 (~10k awake bodies at 1× on the 8-core reference); rendering lives in the GPU worker (§18.1/§18.4).
- D48 GAME_SPEC §21 milestone part lists follow the catalogue's Ship column.
- Node: development is tested on Node 24; the minimum stays Node 22 LTS.

## Amendments (after R4)
- D18a MOTOR: rated 120 W electrical demand, 60 % efficient → peak shaft power ≈ 71 W. No-load 1.5 rev/s (9.42 rad/s), **stall torque 30 N·m** (peak power τ_stall·ω₀/4 ≈ 70.7 W). Replaces "stall torque 2.0 N·m".
- D16a DYNAMO example: a Motor driving a Dynamo yields ≤ 0.6 × 71 ≈ 42 W (not 72 W). The braking-torque rule is unchanged.
- D34a GOO particle radius 8 mm (≈ 2 mL per particle).
- D36a WICK visual flame 40 mm over a 25 mm core is an accepted exception to the 1.3× rule.
- D18b HAMSTER DRIVE stall torque 40 N·m (≈ 50 W peak shaft power) and PEDAL RIG 25 N·m at the 3 rev/s output (≈ 118 W): toy-strength, so a hamster-driven Dynamo dimly lights a Lamp (≈ 30 W) and a raccoon-driven one fully lights it (≈ 70 W).
