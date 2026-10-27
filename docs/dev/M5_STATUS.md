# M5 status: Future Tech and the beta

Last updated 2026-10-25.
- **Plan and scope:** [PRODUCTION.md §2 M5](../PRODUCTION.md); streams, ownership, rules 14–15 and contracts in [M5_PLAN.md](M5_PLAN.md).
- **Per-stream notes:** `M5_NOTES_{A5,B5,W5,R5,F5,U5,X5,D5,T5,G5,J5,E5a,E5b,E5c,DESYNC}.md`.
- **Decisions:** D102–D116 in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md).
- **Matrix re-run:** [M5_SANDSTORM_MATRIX.md](M5_SANDSTORM_MATRIX.md).
- **Previous milestone:** [M4_STATUS.md](M4_STATUS.md).

**M5 is complete on Chrome: KNOCK-ON is a feature-complete sandbox beta (D106).** All the Ship ≤ M5 content is playable, with art, audio, captions and HOW_TO_PLAY: every part, all 8 critters and all 6 environments. The docs describe the code as built. The release checks below pass. It is a beta, not a release: see "Known limits" and "What the beta still needs".

## Exit criterion (D106, the beta bar)

| Bar | Result |
|---|---|
| **Content complete** | **PASS.** The 11 Ship = M5 parts work end to end: def, behaviour, card, demo, golden, fuzz, art, VFX, audio, captions and UI. They are RIFT GATES, GRAV WELL, TRACTOR BEAM, HOVER PAD, FORCE WALL, COILGUN RING, STASIS FIELD, BUZZ BEACON, SINGULARITY, GRABBER and GOO VAT. BUZZ, the 8th critter, flies, fetches tagged items and delivers them. ORBITAL HANGAR (38 % gravity, zero-g rings) and MOON BASE (16.5 % gravity, no air) are full environments, sim and render. Global wind (D26) ships as a world setting. |
| **Docs current** | **PASS.** D5's final pass rewrote about 30 doc sections to match the code, resolved 10 contradictions and removed every "in progress" marker. It swept every backticked path and identifier against `apps/`, `packages/` and `tools/`. Designed-but-unbuilt features are marked post-beta (D107). |
| **Release checks** | **PASS.** See below: the full suite, soaks, the D91 matrix on the final kernels, and the `playtests/` log. |

## Release checks

| Check | Result |
|---|---|
| Typecheck | 0 errors |
| `pnpm lint` (determinism) | clean |
| Tests | **2,578 pass**, 3 skipped by design, in 90 files. That includes the asset suite (with the Backlot tests that E5c's regeneration incident touched) and the new J5, G5, glass-probe, capacity and late-poke tests. This final run was after every M5 fix. No golden was re-pinned outside its own stream: `GOLDEN_MIX` and QUACK for X5, for the reasons in M5_NOTES_X5. Raising the contact buffers (D116) moved no hash. |
| **D91 Sandstorm matrix, final kernels** | **PASS** (X5). CPU reference, NVIDIA D3D12, NVIDIA D3D11 and SwiftShader are identical on every compared tick: the Matter checksum plus all 9 wheel proxies' impulse sums. Ranges: all four over 1–30, CPU = D3D12 = D3D11 over 1–120, D3D12 = D3D11 over 1–600. The orchestrator re-verified this from the raw per-tick JSON (0 differences across 6 pairs), and no `packages/matter/src` file is newer than the GPU legs. Checksums differ from M4's from tick 9 because of the symmetric push fix (D110), as expected. The goo and low-g scenes also pass CPU = GPU on all three GPU backends. |
| 2-player soak, 8 Jolt threads (5 min, alternating starter) | **PASS.** 10 runs, 37.9k ticks, 580 / 580 hashes, 112 pokes, 43 / 43 rollbacks, 0 desyncs, 0 resyncs, 0 errors. |
| 2-player soak, game-like bake-ahead (`--ahead 480 --ahead-b 120`, 5 min) | **PASS.** 10 runs, 111 pokes, 110 / 110 rollbacks, 0 desyncs. This is the case behind the playtest's false desyncs (D108). |
| Threaded determinism at scale (D116), 154k-domino wave, 8 Jolt threads, 24 s, run twice with the shipped capacities and heap (2,624 MB) | **PASS.** Bit-identical across all 24 hashes, and identical to the raised-buffer runs that proved the cause. Before the fix the runs diverged from 21 s. |
| Final 2-player soak on the final code (game-like bake-ahead, 8 threads, 3 min) | **PASS.** 6 runs, 68 pokes, 68 / 68 rollbacks, 0 desyncs, 0 errors. |
| Moon soak (3 min) / Hangar soak with 6 m/s wind (3 min) | **PASS / PASS.** 70 and 71 pokes, 25 / 25 rollbacks each, 0 desyncs. The soak builds each Machine with the world's gravity, air, zones and wind. |
| Critter soak, all 8 critters incl. BUZZ (5 min, single-threaded and 8 threads) | **PASS / PASS**, 0 failures. B5's 10-minute soaks: 113 scenarios, 2.44 M ticks, 194 deliveries, 0 desyncs; threaded 109 scenarios; the rift soak had 14 critter transits. |
| Browser co-op repro of the playtest (DESYNC) | 38 P2-poke runs plus 4 P1-poke runs, **0 desyncs**. Before the fix: 3 of 9. |
| Chrome 152, production build, local test server | Cross-origin isolated. Every part's KTX2 set and GLB loads (200); the only 404 is the expected `.cube` LUT probe. GOO VAT places and runs; switching to Moon Base works; the Moon and Hangar sets, heightfields and baked Earths are in the build. Fixed during the check: focusing a tray field scrolled the HUD sideways (`#viewport` is now `overflow: clip`); `vite.config.ts` wrote `build.json` and the asset folders into `apps/game/dist` whatever `--outDir` said (it now uses the real outDir); and the glass UI fell back to solid at boot on an RTX 5090 (D113). |
| Accessibility (U5) | WCAG 2.2 AA: 16 screens × 6 modes, 0 failing texts, worst contrast 4.64:1. 0 unnamed controls on 18 screens; keyboard-only 21 / 21; reflow 72 / 75 (the 3 failures are below the minimum window size). |
| `playtests/` log | Started: `TEMPLATE.md` and `2026-10-25.md` ("Portal Express"), a 29-minute automated two-player session with 21 runs. It found the co-op desync that DESYNC fixed. |

## Tier tuning (T5)

Measured by T5 on a quiet RTX 5090 with headless Chrome 155. Each tier ran at its own settings with its maximum world, part cap and grain budget, everything in view. Details are in [M5_NOTES_T5.md](M5_NOTES_T5.md) and [M5_NOTES_G5.md](M5_NOTES_G5.md).

| Tier | Output → internal | Max-content scene | GPU ms (preset / whole world / Matter close-up), governors off | Governed (G5) | 60 fps at max content? |
|---|---|---|---|---|---|
| 4 GB | 1080p native | Room, 20k parts, 250k grains | 8.1 / 7.3 / 3.9 | 7.7 at full quality | Yes |
| 8 GB | 1440p → 1080p | Warehouse, 100k parts, 1M grains | 20.2 / 19.0 / 5.1 | 16.1–16.7 at step 6 | Governed, yes, at reduced resolution |
| 12 GB | 1440p native | Arena, 400k parts, 2M grains | 29.0 / 18.6 / 7.6 | 16.2 / 17.6 at step 7 | Borderline |
| 16 GB | 4K → 1440p | Megastructure, 1M parts, 4M grains | 10.3 / 13.4 / 9.0 | — | Yes |
| 32 GB | 4K → 1800p | Megastructure, 2M parts, 8M grains | 22.6 / 28.6 / 31.4 | 18.7 / 28.8 | No |

- **Where the frame time goes:** settings are cheap, at 1–3 ms per empty world on every tier. The misses come from drawing 100k–2M parts in view: the key-light shadow range covers up to 300 m, the spot-light cone test runs on the CPU, and the main pass. Per **D115** the targets apply to typical worlds, and that renderer work is post-beta.
- **Kiloton** plays at 60 fps on every tier: 2.2–12.7 ms in its blast second.
- **VRAM:** the ledger reads 1.4 / 2.1 / 3.7 / 5.4 / 8.9 GB against budgets of 2.8 / 5.5 / 8 / 10.4 / 22 GB. No validation errors.
- **Matter speed (quiet GPU):** 1M grains take 11.38 ms per Matter tick, the largest real-time count. 2M take 24 ms, 4M 53.9 ms and 8M 130.8 ms (about 0.13×).
- **8M grains at 32 GB** fit in memory. Per **D114** they stay, running time-dilated or through Bake & Watch.
- **Awake bodies at 1×** (ceiling = the awake count at a 7.5 ms tick, multithreaded Jolt): chain reactions reach about 11k at 4 threads and about 14–15k at 8–12. Dense piles reach about 4.9k at 4 threads and about 6k at 8–12. Scaling flattens past 5–6 threads. The M0 estimate of about 10k holds for chain reactions and is about 1.7× too high for dense piles. The per-tier column is in GAME_SPEC §15.2.

**Fixed as a result (G5):**
- **The GPU timer over-counted.** Query slots that a skipped pass never wrote returned an earlier frame's `main` time, so Matter scenes read up to +134 %. The look governor also read the frame interval, which can't fall below 16.7 ms at 60 Hz, so it never restored quality.
- The governors now read a per-frame GPU span that matches throughput within about 1 %. 8 GB settles one quality step higher, and 4 GB stays at full quality.
- `RESERVE.matter` is now the measured Matter pool plus 5 % on every tier.

**Physics memory and threaded determinism (J5, verified by the orchestrator):**
- **The heap is sized for every part awake at once** (`joltHeapNeedMB`, measured peaks with at least 19 % to spare). Before, a 154k-part world ran out at about 74k awake.
- **A run that still runs out stops with a message** instead of freezing: "This machine ran out of physics memory…". The sim worker is recreated. Above about 480k parts all awake, the worst case doesn't fit in wasm32's 4 GB.
- **J5 found two bugs elsewhere:**
  - **Threaded runs diverged on huge chain reactions** (a 154k-domino wave, from 21 s). The cause was Jolt's fixed contact cap of 2^17. The buffers now scale with parts (**D116**), and two 8-thread runs are bit-identical for all 24 s.
  - **`contactEstimate` threw on 1M-part worlds**, so the 16 GB tier's cap couldn't start a run. It's now a numeric, sharded grid that gives identical totals.

## Deliverables (PRODUCTION §2, M5)

| Workstream | Delivered |
|---|---|
| **Future Tech parts (A5)** | **10 parts:** RIFT GATES, GRAV WELL, TRACTOR BEAM, HOVER PAD, FORCE WALL, COILGUN RING, STASIS FIELD, BUZZ BEACON, SINGULARITY and GRABBER, each with def, behaviour, card, demo, golden and fuzz entry. 569 tests; threaded hashes are identical; no M1–M4 golden moved.<br>**Rules:** fields act on bodies only (D102); FORCE WALL switches by object layer and STASIS works like ZONE (D103), re-derived in `afterRestore` (rule 14).<br>**Measured:** HOVER PAD sags 9.9 mm at 10 kg. An idle SINGULARITY with 500 STITCHes costs 0.057 ms/tick; armed, 2.25 ms/tick. |
| **BUZZ (B5)** | A drone critter with a fetch FSM, PD flight (D105), a tag scan, winch and ghost carry, and `PartFlag.Tagged` (bit 9). RINGERs call it and two Signals queue two fetches. Animal critters now walk or fly through RIFT GATES. 633 tests. |
| **Goo and Matter in M5 (X5)** | **Goo** (Matter kind 3) is a spring fluid that oozes, strings and drips, sticks to bodies with a yield, and doesn't float things (D109).<br>**GOO VAT:** a 9 L slime dispenser with a lid hatch that soaks goo back up.<br>**Gravity:** grains follow the world's gravity and the zero-g zones (D104, D110). Moon regolith becomes grain colliders.<br>**Solver fix:** a sign-symmetric push stops resting grains creeping downhill (Moon sand slid 1.1 m in 4 s, now 0).<br>**Browser wire fix:** the sim ↔ GPU link carries all kinds, gravity and zones.<br>**QUACK** rights itself thanks to a 10 mm keel (D111). Goo has its own audio, and the metaball-style surface is shaded as kn_slime. |
| **Environments (W5, E5c)** | **ORBITAL HANGAR:** two bays, zero-g rings and a baked Earth through the window, at a 105° phase (D112).<br>**MOON BASE:** heightfield terrain, a lander, dome and rover, Earth in the sky, and a Base lights toggle.<br>**Physics:** `envPhysics` sets gravity and air per environment.<br>**Global wind (D26):** presets and seeded gusts, rigid bodies only.<br>**Art:** the Main Hall is 559k LOD0 tris, Bay 2 162k and the Moon 285k. All backdrops sit inside the 1.95 km rule. |
| **Rendering and VFX (R5)** | **VFX:** effects for every Future Tech part (singularity lens, rift glimpse, stasis, tractor, hover, force wall, coilgun, grav well), BUZZ rotors, LEDs and winch, GRABBER links and fingers, and the Hangar rings.<br>**Cost:** +0.18–0.31 ms at 16 GB, +0.41–0.48 at 32 GB.<br>**M4 polish closed:** dark patches at non-1 scale, DUSTY and BUZZ LED faces (12 icons), TOAST slices, GUTTER textures, water shadows, the Kitchen wetness mask.<br>**Glass shader fix:** refraction could go negative per channel and showed magenta behind glass in hard-shadowed environments; brightening is now additive and darkening a transmittance.<br>**Device-loss recovery:** 586 ms. |
| **Audio (F5)** | **Parts:** 51 bank entries (107 variations) and 12 loop kinds.<br>**BUZZ:** 20 cues (44 variations).<br>**Environments:** Hangar and Moon beds, and with 0 % air there's no airborne sound.<br>**Clips now have sound:** AAC-LC 192 kbps with an Opus fallback, sample-aligned, at −14.5 LUFS.<br>**Checks:** 69 / 69 offline checks; the stress test peaks at 53 / 64 voices. |
| **UI and beta polish (U5)** | **New settings:** a physics-threads setting, the Matter switch, the environment picker, Weather.<br>**New controls:** sizing handles, RIFT and BUZZ pair chips with auto-pair, the GRABBER zone tool, BUZZ tagging, a SINGULARITY cap of 4.<br>**Captions** for every M5 event.<br>**Cleanup:** settings that don't drive anything yet are hidden.<br>**Docs and playtests:** HOW_TO_PLAY rewritten, plus the `playtests/` log and template. |
| **Part and critter art (E5a, E5b)** | **E5a:** 11 parts including GOO VAT, every one with 0 validator errors and 0 warnings, KTX2, 66 tests.<br>**E5b:** BUZZ with 13 bones, 23 clips, a visor face and a matched ragdoll. |
| **Co-op desync fix (DESYNC, orchestrator)** | **The cause:** the playtest's desyncs were false alarms, not divergence. The client bakes up to 480 ticks ahead, so a client could report a hash computed before a poke reached it, while the other client's report for that tick came after.<br>**The fix:** hash reports carry `pk`, and re-baked ticks are reported again. A host-side `bakedMin` fix holds a fast client until a slow partner's worker has started (D108, amends D59).<br>**Tests:** `apps/host/test/latepoke.test.ts`. |
| **Tier tuning and close-out fixes (T5, G5, J5)** | **T5:** measured tiers on a quiet GPU, the awake-body ceiling and 8M grains (see "Tier tuning"). The perf bench now takes all five tiers, environments, grains and governor options.<br>**G5:** the GPU timer reads true pass times and the governors read real frame cost; `RESERVE.matter` comes from measurement.<br>**J5:** the all-awake heap formula, graceful out-of-memory stops and a heap high-water tool.<br>**Orchestrator:** the contact-buffer fix (D116) and the 1M-part `contactEstimate` fix. |
| **Docs (D5)** | Final pass: ARCHITECTURE, DATA_FORMATS, SIMULATION §4/§5.8/§5.12/§7–§10, MULTIPLAYER §5.6/§7, AUDIO, RENDERING, UI_UX §8, GAME_SPEC and both READMEs. |
| **Orchestrator** | **Host and build fixes:**<br>- the host's part caps come from the format's tier table, which adds the missing 32 GB tier;<br>- CSP `media-src blob:` for the clip preview;<br>- the outDir-safe `vite.config.ts`;<br>- `#viewport` clip.<br>**Soak harness:** `soak.ts` builds Machines with the world's physics and has `--env`, `--wind` and `--starter`.<br>**UI and in-game rendering:**<br>- the glass probe (D113);<br>- BUZZ emote glyphs;<br>- HOW_TO_PLAY for goo and low-gravity grains.<br>**Reviews:** E5c's Earth and Moon art went back twice (city lights, solar-panel z-fighting, hangar values).<br>**Decisions:** D107–D113. |

## Decisions this milestone

- **D102** Fields act on rigid bodies only; GOO VAT is the only M5 part that touches grains.
- **D103** FORCE WALL switches by object layer; STASIS FIELD works like ZONE.
- **D104** Matter gravity follows the world (built by X5, D110).
- **D105** BUZZ flies with PD control, and tagging is `PartFlag.Tagged = 1 << 9`.
- **D106** The beta bar.
- **D107** Designed-but-unbuilt features are post-beta. Global wind ships. The host's part caps come from the format's tier table.
- **D108** Hash reports carry their poke count (amends D59), and `bakedMin` is broadcast at once.
- **D109** Goo is a spring fluid, sticky with a yield, and non-buoyant.
- **D110** The Matter gravity mapping `G = 192 + 2,624 × p` and the symmetric push. Moon regolith tiles; grains ignore wind and air %.
- **D111** QUACK's keel (`PartDef.body.com`).
- **D112** The Hangar's Earth phase is art-directed (105°); Earth doesn't spin in the beta.
- **D113** The glass probe waits for steady frames.
- **D114** The 32 GB tier keeps 8M grains, time-dilated (producer call).
- **D115** The §15.2 frame targets are for typical worlds; the max-content renderer work is post-beta (producer call).
- **D116** Jolt's contact and pair buffers scale with parts (restores D89 on huge chain reactions).

## Known limits (carried into the beta)

**Simulation:**
- **Matter solver limits from M4:** deep piles compress, there's no hydrostatic pressure inside the fluid, and grains can tunnel above 1.875 m/s.
- **4M or more grains run time-dilated** (D92).
- **Goo:** a big blob won't hang from a ceiling (one layer sticks, the rest drips off). 1M goo particles cost 49 ms per Matter tick, measured under load.
- **Water:** a 27-particle water cube flies apart at zero g. Water in containers is unaffected.
- **Grains** feel no wind and no air % (D110).
- **TURBINE** gets plain drag from wind, not blade torque.
- **Hangar and Moon physics:** zones and wind skip sleeping bodies, and `env.zones` is all-or-nothing.
- **A5's part limits:**
  - TRACTOR BEAM has no occlusion;
  - GRABBER's fingers don't physically close;
  - ports stay where they are on resized parts;
  - an off-centre ball on a 10 kg HOVER PAD creeps off after about 3.5 s;
  - some collision shapes are primitive blockouts.
- **BUZZ:** no startle trigger; a carried item doesn't physically load the drone.

**Scale (found by T5 and J5):**
- **Rigid checkpoints hitch on worlds over 20k parts:** 43–80 ms ticks every 240 ticks at 77k parts, up to 180 ms at 154k. Bake-ahead hides most of it.
- **Starting a 1M-part world** spends about 10 s in `contactEstimate`, which is called by the worker and again by the Machine.
- **Physics memory:**
  - above about 480k parts, an all-awake worst case can't fit in wasm32's 4 GB, so the run stops with a message;
  - over 1M contacts awake at once, Jolt can still drop contacts, and threaded runs could then diverge (D116);
  - the threaded worker rounds its heap up to a power of two, so heaps over 2 GB commit 4 GB of address space (only touched memory is resident).
- **Max-content rendering** (D115): the key-light shadow covers up to 300 m, and the spot-light cone test runs on the CPU (7–8 ms at 400k parts in the Hangar).

**Multiplayer:**
- With both players as tabs in one browser window under CPU load, the hidden tab's worker can starve. Two windows are fine.
- No real-network (WAN) session has been played. All co-op testing has been on one machine.

**Rendering and art:**
- Earth is baked, so it doesn't spin (D112).
- The rift glimpse is screen-space only; there's no volumetric tractor cone.
- Water shadows are binary.
- Distant Moon solar panels shimmer slightly.
- The Hangar's wall-panel tones are a little busy.
- Environment textures aren't KTX2.
- Moon micro-pebbles are a normal map only.

**Audio:**
- GRAV WELL's repel mode doesn't change its sound.
- FORCE WALL's hum doesn't scale with its size.
- The zero-g ring drone ignores the zones switch.
- Matter in clips lags 1–3 frames.

**Coverage:**
- Real AMD, Intel and Apple GPUs are still untested (D91).
- The only playtest so far is automated. Its median frame was 33.3 ms, with two clients and a shared GPU. No human playtests yet.
- The hidden Graphics settings have no consumer: Budget override, Particle cap and Unlimited Mayhem.

## What the beta still needs (not M5)

- **Human playtests:** the PRODUCTION §6 metrics, with people instead of scripts.
- **Real hardware:** AMD, Intel and Apple GPUs and lower-end machines, including the 8 GB and 12 GB tiers on their own hardware.
- **Additional multiplayer field testing.**
- **Max-content rendering (D115):** the key-light shadow range, the GPU spot-cone cull, and part-geometry cost at 100k–2M parts.
- **D107's post-beta features:** replays, desync report files, Docker hosting, shell fur, SSR / Hi-Z / motion blur, `tools/bake`, and the HOW_TO_PLAY §13 build-UX items.
- **Provisional decisions** to confirm or revisit after playtests (D102–D113 are all marked provisional).
- **Distribution:** there's no version control (git) yet, and no packaged release.
