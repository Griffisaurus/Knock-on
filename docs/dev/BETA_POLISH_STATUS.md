# Beta polish status

Last updated 2026-10-25.
- **Plan:** [BETA_POLISH_PLAN.md](BETA_POLISH_PLAN.md).
- **Before it:** [M5_STATUS.md](M5_STATUS.md); drag-to-move and the gizmo ([D117](DECISIONS_2026-10-24.md), [M5_NOTES_DRAG.md](M5_NOTES_DRAG.md)).
- **Per-stream notes:** `BETA_NOTES_{SIMFIX,PARTSIM,UIFIX,BUILDUX,RENDER,AUDIO,ART}.md`.
- **Decisions:** D117–D128.

**The polish pass is complete.** Every planned polish item and every playtest bug is closed, or deliberately left as a noted known limit (below). The build is ready for beta testing.

## Release checks (final code)

| Check | Result |
|---|---|
| Typecheck, determinism lint | clean |
| Tests | **2,894 pass**, 3 skipped by design, 96 files, 0 errors. `vitest.config.ts` now caps workers at half the cores: suites that start their own thread pools had starved Vitest's RPC ("Timeout calling onTaskUpdate") in full runs. |
| 2-player soak, game-like bake-ahead, 8 threads, 5 min | **PASS.** 10 runs, 110 pokes, 110 / 110 rollbacks, 0 desyncs, 0 errors |
| Moon soak / Hangar soak with 6 m/s wind, 3 min each | **PASS / PASS**, 0 desyncs |
| Critter soak, all 8 critters, 8 threads, 5 min | **PASS**, 0 failures. PARTSIM also ran single and threaded soaks with BUZZ startles: 57 and 66 runs, 0 desyncs. |
| Threaded determinism at scale (154k dominoes, 8 threads, 24 s, twice) | **Identical**, and identical to the pre-polish hashes, so SIMFIX changed no straight run |
| Rule-14 three-way test (straight run, rollback, fresh machine adopting the checkpoint) | All 87 fuzz scenes and 124 Library demos match (`rollback_rule14.test.ts`, D119) |
| PING fix in a real browser run (THE GRAND KNOCK-ON, early poke) | **Verified.** No poke, then Ctrl+click pokes at 6.85 s (the poke that broke it in the playtest), 2.97 s and 7.25 s. Each poked run rolled back over the PING. In every run the S3 → S4 hand-off and stations 4–8 ran, and every hand-off time matched the un-poked run to within 0.01 s (PING 7.38 s … SINGULARITY 37.77 s). Final Director clip: `playtests/2026-10-25-polish/final_run_h264.mp4`. |

## What changed

| Stream | Delivered |
|---|---|
| **SIMFIX** (D118–D119) | **Rollback fixes:**<br>- **PING relay** survives a rollback.<br>- **Rule-14 audit of every channel module.** 4 more gaps fixed, 2 of which diverged the hash:<br>&nbsp;&nbsp;- FLAP friction;<br>&nbsp;&nbsp;- BIG TOP held Rollers;<br>&nbsp;&nbsp;- SPRINKLE CAN and SPONGE mass bits;<br>&nbsp;&nbsp;- the SPRINKLE latch motor after a desync repair.<br>- **Gate:** the three-way test now gates new parts.<br>**Speed:**<br>- Checkpoints use `clonePlain`, cutting the big-world hitch by 15–45 ms.<br>- `contactEstimate` runs once per start and about 5× faster (a 1M-part start went from 18.8 s to 1.8 s). |
| **PARTSIM** (D120–D121) | **TURBINE:** turns from wind through its blade pitch, with a governor. This fixed an old stall at 35 rad/s.<br>**TRACTOR BEAM:** occlusion.<br>**GRABBER:** kinematic fingers close on the payload, and zone A tolerates the payload's height.<br>**BUZZ:** startles at 100 dB or more, sags and slows under load, and sets a sinking item down.<br>**HOVER PAD:** the restore no longer wakes it. |
| **UIFIX** (D122) | **Capture:**<br>- the offline Director cuts exactly as live (9 / 9 cuts);<br>- 1080p is truly 1080 (HEVC; the AV1 encoder declared 1088);<br>- the render estimate is calibrated.<br>**Controls and panels:**<br>- hold Q → point → let go;<br>- GRABBER zone A uses the payload's centre;<br>- the Cascade Report buttons stay visible and chain steps scrub.<br>**Bookkeeping:**<br>- no false "device lost?" on Stop;<br>- HUD and report K.O. agree (270 / 270);<br>- undo can no longer overtake its own edit after a burst;<br>- "Buzz: startled!". |
| **BUILDUX** (D123–D124) | Box select, copy / paste / duplicate (links kept, pairs re-paired, clipboard across worlds), mirror on Alt+X / Y / Z (57 symmetric types), local gizmo axes on X, a rotated multi-part partner ghost, and port snapping within 5 cm (a setting, on by default). 61 real-input browser checks, 14 of them two-player. |
| **RENDER** (D125–D126) | **Shadows:** two fitted, texel-snapped key-light cascades.<br>**Culling:** the spot cone is culled on the GPU (Hangar CPU from 7.4–8.0 ms to 0.6–1.0 ms). Camera LOD and impostors use real part sizes, and impostors were re-baked with texture colours. A pull-back from 2 to 100 m showed no popping.<br>**Gizmo:** stays sharp under DOF.<br>**Earth:** lit at runtime and spinning (lifts D112's no-spin).<br>**Solar arrays:** a far LOD halves the shimmer. |
| **AUDIO** (D127) | GRAV WELL repel has its own sound; FORCE WALL hum follows √area (18.5 dB span); the ring drone follows `env.zones`; RIFT pairs share one source (correlation 0.997); Matter in clips is sync to 0.67 frames (was 2.75); BUZZ startle cue. 77 / 77 offline checks, peak 53 / 64 voices, −1.03 dBTP. |
| **ART** (D128) | **Hangar:** wall tones run per rib, with half the spread.<br>**Moon:** 6×3 solar modules.<br>**Earth:** unlit inputs (albedo, plus clouds / night / water data) for runtime lighting.<br>**Isolation:** the other sets' outputs are byte-identical, checked by checksum. |
| **Orchestrator** | Routed the cross-stream requests: Earth inputs ART → RENDER, findings SIMFIX → PARTSIM, PARTSIM → RENDER / UIFIX. Unblocked two mid-edit breakages. Fixed the Vitest oversubscription. Logged D120–D121. |

## Frame time after the polish (RTX 5090, quiet-GPU A/B, governors off)

| Tier, max-content scene | Preset camera | Whole-world camera |
|---|---|---|
| 4 GB Room, Moon | 6.2 ms | 5.9 ms |
| 8 GB Warehouse | (not re-measured) | |
| 12 GB Arena, Moon, 400k parts, 2M grains | **13.3 ms** (M5: 29.0) | **8.8 ms** (M5: 18.6) |
| 16 GB Megastructure | 8.1 ms | 10.1 ms |
| 32 GB Megastructure, 2M parts, 8M grains | **16.7 ms** (M5: 22.6) | 20.8 ms (M5: 28.6) |

12 GB now holds 60 fps at max content, ungoverned. 32 GB's whole-world camera still misses, from shadows, the AO prepass, the main pass and 8M grains. D115 stands: the frame targets mean typical worlds.

## Known limits (still open, all noted)

- **GRABBER:** the visible finger tabs sit on the top of a small ball rather than pinching its sides. A cosmetic finger-length or hold-height item.
- **Impostors:** they use the nearest of their 64 baked views with no blending, so they only switch in below 8 px. View blending would let them return to 24 px.
- **Mirror:** handed parts (59 types) can't truly mirror; they keep their rotation. Mirrored variants would need sim and renderer work.
- **Port snap:** reaches 5 cm only, and the gizmo doesn't port-snap.
- **Clip audio:** sits 11 ms behind its frame, the master chain's lookahead. A one-line shift is noted in BETA_NOTES_AUDIO; it needs a decode-back re-check.
- **Checkpoints:** the remaining big-world hitch is Jolt's own `SaveState`, which can't be pre-sized through JoltJS.
- **Carried over from M5_STATUS:**
  - the Matter solver limits;
  - wasm32's 4 GB heap ceiling above about 480k parts all awake;
  - over 1M contacts awake (D116);
  - real AMD / Intel / Apple GPUs untested;
  - no real-network co-op yet;
  - no human playtests yet.

## Next: the beta itself

1. **git:** version control before outside testers. A producer OK is needed, because the project has had none by design so far.
2. **Human playtests:** weekly themed builds logged in `playtests/` (the template exists).
3. **Hardware round:** AMD, Intel and Apple GPUs, and real 8 GB and 12 GB cards (D91).
4. **Local co-op** with two browser clients (LOCAL_DEVELOPMENT).
5. **A packaged build** for testers, and the feedback loop.
