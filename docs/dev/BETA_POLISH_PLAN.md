# Beta polish plan (pre-beta, after M5)

Started 2026-10-25, after [M5_STATUS](M5_STATUS.md), the autonomous playtest ([playtests/2026-10-25-autoplay.md](../../playtests/2026-10-25-autoplay.md)) and drag + gizmo (D117). The producer asked for the planned polish before beta testing starts.

**Goal:** close the known polish items and playtest bugs, and make building easy, without new systems. The exit bar is the D106 checks again: the full suite and soaks green, every touched doc current, and a short re-run of the autonomous playtest.

## Streams

| Stream | Owns (files) | Scope | Ports (Vite / host) | D-numbers |
|---|---|---|---|---|
| **SIMFIX** | `packages/sim/src/channels/m3*.ts`, `machine.ts` checkpoint/restore paths, `packages/sim/src/capacity.ts`, `apps/game/src/sim.worker.ts`, `packages/parts-data/src/presets.ts` (checkpointPlan) | **The PING relay is lost on rollback.** Then a rule-14 audit of **all** channel and behaviour state, the rigid-checkpoint hitch on worlds over 20k parts, and computing `contactEstimate` once per start (it's slow at 1M parts) | 5321 / 8921 | D118–D119 |
| **PARTSIM** | `packages/sim/src/channels/m5*.ts`, `packages/sim/src/critters/m5.ts` (BUZZ), wind code (`envsets.ts` / wherever `globalWind` lives), part defs for the parts it touches | TURBINE blade torque from wind; TRACTOR BEAM occlusion; GRABBER fingers that really close; BUZZ startle and carried load; GRABBER zone pointing, sim side if needed | 5322 / 8922 | D120–D121 |
| **UIFIX** | `apps/game/src/capture/**`, the radial menu (`ui/hud.ts` / `ui/keyboard.ts` radial code), `ui/m5tools*` (GRABBER zone pointing), the Cascade Report panel, the run HUD K.O., undo timing, the matterhost Stop log | The playtest UI and capture bugs (see "UIFIX bugs" below) | 5323 / 8923 | D122 |
| **BUILDUX** | `ui/selection.ts`, `ui/dragmove.ts`, `ui/gizmo.ts`, the build keybinds | Box select, copy / paste / duplicate (Ctrl+C / V / D), mirror (Alt+X / Y / Z), a gizmo local/world axis toggle, and a rotated partner ghost | 5324 / 8924 | D123–D124 |
| **RENDER** | `apps/game/src/gfx/**` (not `gfx/matter`) | Fit the key-light shadow range to the view (it covers 300 m today); a GPU or spatially indexed spot-cone cull (7–8 ms CPU at 400k); DOF never softens the gizmo; a runtime-lit, slowly spinning Earth (lifts D112's no-spin); distant solar-panel shimmer (mips / LOD) | 5325 / 8925 | D125–D126 |
| **AUDIO** | `apps/game/src/audio/**` | GRAV WELL repel has its own sound; FORCE WALL hum scales with its size; the zero-g ring drone follows `env.zones`; RIFT hums phase-locked to their partner gate; Matter in clips lags 1–3 frames | 5326 / 8926 | D127 |
| **ART** | `art/`, `kn_tools/`, `assets/build/env/hangar` | The hangar wall-panel tones are too busy; check the solar-panel geometry and mips with RENDER | — | D128 |

## UIFIX bugs (from the playtest log)

1. Record clip with the Director camera stays on one part.
2. Holding Q opens a sticky radial menu that ignores the release.
3. GRABBER "Point zone A" on a ball sets the zone at the ball's top.
4. The Cascade Report's buttons are below the fold at 1080p.
5. Smaller ones:
   - clicking a chain step doesn't scrub;
   - the clip comes out 1920×1088;
   - the clip time estimate is about 2.7× low;
   - a false "device lost?" log on every Stop;
   - the HUD K.O. (57) and the Cascade Report K.O. (256) disagree;
   - Ctrl+Z within 0.4 s of an edit is ignored.

## Rules

M5_PLAN rules 1–15 carry over. In particular:
- Edit tool only for shared files.
- Report other streams' failures; don't fix them.
- No `dist/` and no `:8787`.
- No git and no downloads.
- No sub-agents.
- Measure, don't estimate.
- The GPU is shared, so timings are provisional.
- Rule 14: rollback-safe state.
- Rule 15: the beta definition of done.

Also:
- **Goldens:** a stream re-pins only goldens of parts it deliberately changed, with the reason in its notes. SIMFIX must not move any straight-run golden.
- **Shared hot files** (`machine.ts`, `main.ts`, `hud.ts`, `settings.ts`): small edits with the Edit tool, each tagged with the stream name. Re-read the file just before editing.
- **Notes:** `docs/dev/BETA_NOTES_<STREAM>.md`. Docs (HOW_TO_PLAY, UI_UX, SIMULATION, RENDERING, AUDIO) are updated by the stream that changed the behaviour.

## Close-out (orchestrator)

- Full suite, typecheck and lint.
- Soaks: 2-player threaded with game-like bake-ahead, critters, Moon and Hangar.
- The 154k-domino threaded determinism check.
- A short re-run of the autonomous playtest machine (`playtests/2026-10-25-autoplay/spec/`), with an early poke to confirm the PING fix.
- `docs/dev/BETA_POLISH_STATUS.md`.
