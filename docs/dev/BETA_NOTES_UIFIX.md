# Beta notes: stream UIFIX (the playtest's UI and capture bugs)

2026-10-25. Beta polish ([BETA_POLISH_PLAN](BETA_POLISH_PLAN.md)), decision **D122** ([DECISIONS_2026-10-24](DECISIONS_2026-10-24.md)). This stream fixes bugs 2–9 of the autonomous playtest ([playtests/2026-10-25-autoplay.md](../../playtests/2026-10-25-autoplay.md)) and its "undo straight after an edit" note.

There is no sim change and no golden change. The host and the protocol are untouched.

**How it was verified**
- **Setup:**
  - My own Host Server: `KNOCKON_PORT=8923`, `KNOCKON_STATIC=none`, `KNOCKON_DATA` in a local scratch folder.
  - My own Vite on :5323: the shared config with the proxy pointed at :8923. HMR was off, so other streams' edits didn't reload the page mid-check.
  - A headless Chrome 155 over CDP on :9623, with a throwaway profile, 1920 × 1080, RTX 5090, tier 16 GB.
- **Input:** real input only (`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`). `Runtime.evaluate` was used only to read state.
- **The world:** THE GRAND KNOCK-ON (370 parts, 135 links), rebuilt from the playtest spec (`spec/machine_spec.mjs`) into the local test server's data folder as a test fixture. The fixture script is in a local scratch folder.
- **Not used:** the shared :8787 host, `dist/` and the browser pane.

**Tests:** `pnpm -s vitest run apps/game`: 19 files, **266 passed**. `pnpm -s typecheck` and `pnpm -s lint` are clean. New file: `apps/game/test/uifix.test.ts` (19 tests). The old KoMeter test in `ui-logic.test.ts` is updated to the new definition.

Status: **done**. Every fix was checked in the browser.

## The fixes

### 1. Record clip with the Director camera (playtest bug 2)

**Cause.** The offline render rewinds the run to the clip start. The `CameraRig` director kept its live state: the last live cut (`lastCut` ≈ 45 s), its events and its chain depths.
- `since = t − lastCut` stayed negative until the clip passed the old cut time, so the director never cut. It held whatever it was framing: S2's RAM for about 45 s of a 50 s clip.
- The replayed events also landed on top of the live ones, so the scores were counted twice.

**Fix** (`cameras.ts`, `capture/offline.ts`):
- `CameraRig.restart(history)` puts the director (and Ride) back to their fresh-run state. It is fed the run's event log up to the clip's first tick: the worker replays only the events after its first seek, so between them the camera sees exactly the event stream and time that live play gave it.
- The offline render calls it after choosing the Director or Ride.
- The director also handles a rewind by itself (a scrub back, a replay). It drops the events now in the future and a cut that lies there.

**Measured** on the same run (live Director, then Stop, then Record clip › Director, 0–32 s, 1080p30):

| | cuts in 0–32 s | cut times (s) |
|---|---|---|
| live | 9 | 0.0, 3.6, 7.4, 9.5, 12.8, 19.0, 23.9, 27.5, 31.3 |
| clip, before (the playtest) | held one shot (S2's RAM) for ~45 s | — |
| clip, after | 9 | 0.0, 3.6, 7.4, 9.5, 12.8, 19.0, 23.9, 27.5, 31.1 |

The aim points match to 0.1–0.6 m. The small differences come from the clip's per-frame warp (hitstop and slow-mo stretch clip time).

**The clip:** [playtests/2026-10-25-polish/director_clip.mp4](../../playtests/2026-10-25-polish/director_clip.mp4) (19.0 MB, 32.3 s, 1920 × 1080 HEVC with AAC). The contact sheet is `director_clip_sheet.png` (frames at 2, 8, 11, 14, 21, 25, 29 and 32 s: one per station as the chain moves).

**Tests:** a live run of two stations against a rewound rig with `restart()` (identical shots); a mid-run start with `history`; and a plain scrub back. The scrub-back test fails without the rewind handling.

### 2. Radial menu: hold Q, point, let go (bug 4)

**Cause.** With Keyboard building aids on (the default), `KeyboardBuild.keydown` took Q first. It opened the menu sticky, at the keyboard cursor, or at the canvas centre when there was no cursor, and main.ts's key-up skips a sticky menu. On top of that, `radialSlots()` read the live `hover` when a wedge ran, so pointing at a wedge could change the part it acted on.

**Fix**
- `ui/keyboard.ts`: with no keyboard cursor and the pointer over the view, Q opens a non-sticky menu at the pointer.
- `ui/panels.ts` `Radial.keyUp()` / `radialKeyUp()`: on Q's release, a chosen wedge runs. A press under 300 ms with nothing chosen turns sticky, so tap Q + arrows + Enter still works. A longer hold let go over the centre cancels.
- `main.ts`: the key-up calls `keyUp()`, and the radial's subject part is captured when the menu opens.
- With the keyboard cursor on (or the pointer off the view), Q opens it sticky at the cursor as before.

**Checked in the browser** (aids on): hold Q over a SLOPE opens the menu at the pointer (833, 542). Pointing at Inspect and letting go inspected that SLOPE. A tap left it open with Rotate highlighted, → moved to Duplicate, and Esc closed it. A hold let go on the centre closed it with nothing run. The keyboard cursor + Q opened it sticky at the cursor.

### 3. GRABBER "Point zone A" (bug 5)

**Cause.** The click passed the ray's hit point, and for a ball that is its top. Zone A was set 7 cm up, so the arm closed above the STITCH.

**Fix** (`ui/m5tools.ts` `zoneTarget`; `buildtools.ts` passes the hovered part): clicking a loose (dynamic) part points the zone at its centre across the floor and at its contact height (the bottom of its box). Static parts (a LEDGE to put things on) and the floor keep the clicked point. PARTSIM made the sim tolerant too (D120: a zone height within the payload's height ± 1 cm grips), so the two fixes back each other up.

**Checked:** in the playtest world, Point zone A and a click on the upper half of S8's STITCH gave "Zone A: −60°, 25 cm out, 0 cm up" (before: −75°, 23 cm, 7 cm). In the run the GRABBER attached that STITCH at 28.76 s and set it down at 29.89 s. The undo of the zone edit was then used to restore the world.

### 4. Cascade Report (bugs 6 and 7)

**Layout** (`ui/cascadepanel.ts`, `styles.css`): the score, chain and stats sit in a `.cr-body` that scrolls on its own. The header and the REPLAY / Share card / Record clip row stay put. Measured with the 17-link chain:

| viewport | layout | action row (top–bottom px) | tray top | the click at REPLAY hits |
|---|---|---|---|---|
| 1920 × 1080 | normal | 844–894 | 924 | REPLAY |
| 1280 × 720 | compact | 502–552 | 582 | REPLAY |
| 1200 × 700 | compact | 482–532 | 562 | REPLAY |
| 1000 × 640 | compact | 422–472 | 502 | REPLAY |

**Chain steps:**
- **Cause.** The chips were disabled unless a run was going ("Replay to scrub"). During a REPLAY, `setPlay` clamped the tick to the bake head, so a step not baked yet jumped only as far as the bake.
- **Fix.** The chips are always live.
  - During a run, a chip pauses at its tick. `setPlay(…, ahead = true)` keeps a tick past the bake head; the worker shows the newest frame and bakes on to it, as a capture's seek does.
  - After the run, a chip starts a replay. The report stays open over it, and the playhead pauses at the tick once the replay is running (`buildtools.ts` `scrubTo` / `flushScrub`).
  - "Cascade Report (last run)" during such a replay shows the finished report, not the partial log.
- **Checked:**
  - After Stop, clicking step 10 (13.2 s) replayed the machine and paused at 13.18 s, 6.3 s later, with the report still open.
  - Step 2 (7.4 s) then jumped back at once.
  - The last step (14.1 s), past the bake head at the time, landed at 14.04 s within 0.3 s.

### 5. Capture: 1080p size and time estimate (bug 3)

**Size.** NVENC's AV1 writes `max_frame_height_minus_1 = 1087` for a 1920 × 1080 request, with no crop, so players show 1920 × 1088. I checked the sequence header bytes directly; libaom's says 1080. H.264 and HEVC code 1088 too but crop to 1080 in their SPS.

`capture/codecs.ts` now encodes one test frame per candidate when the size isn't a multiple of 16 and reads the AV1 sequence header (`av1SeqSize`). A candidate that declares another size is skipped. So 1080p takes **HEVC (hardware)**, while 720p, 1440p and 4K keep AV1 (hardware). I didn't use cropping or padding, which would change the frame the player asked for. ffprobe of the new clip gives 1920 × 1080; coded 1088 is the usual cropped coding.

**Estimate.** The old estimate was the live GPU time × pixels + 14 ms + encode, about 19 ms a frame. The real cost was 52 ms a frame: the exact-tick seek round trip, Matter's replica, waiting for the GPU queue, encoder back-pressure and the sound track.

`capture/estimate.ts`: the estimate is the draw plus a per-frame **residual**. It starts at 50 ms (the playtest's measurement). After each render, the whole wall time from Render to file per frame, minus the draw, calibrates it per format: the first sample replaces the default, later ones blend 60 / 40. It is kept per viewer in localStorage (`knockon.capture.cost.v1`).

| render | estimate | actual (wall) |
|---|---|---|
| playtest, before | ≈ 29 s | 79 s |
| 32 s at 1080p30, first clip (default residual) | ≈ 52 s | 58.1 s |
| same clip, after two renders | ≈ 43 s | 43.3 s |

### 6. False "device lost?" on Stop (bug 8)

**Cause.** `run.ts` `stopMatter()` destroyed the main-thread Matter host on Stop. `destroy()` set the shared "stopped" flag the worker checks while it waits on a Matter result. The worker was mid-bake, so its wait threw "matter: the GPU host stopped (device lost?)", and `fatal()` logged it, once per Stop.

**Fix**
- `stopMatter()` only detaches the host: no drawing and no playback. The worker's own link sends `destroy` when its machine is torn down on the stop that follows, and that destroys the host. A 3 s timer is the backstop for a dead worker.
- `matterhost.ts` tells the flag values apart: 1 = lost or failed (the message stays), 2 = released at the end of the run ("the run ended while the sim still waited on Matter", seen only if the backstop fires on a stuck worker).

**Checked:** Stop at 52 s during a run with Matter (133k grains) logged nothing (0 console errors).

### 7. K.O. counts (bug 9)

GAME_SPEC §8: the K.O. Count is "number of distinct knock-on steps".
- The **report** counted that: distinct part A → part B edges of the cause graph.
- The **HUD** counted Detonate / Break / Pop / Cut events, a different thing (57 against 256). Replayed events after a scrub were counted again too.

**Fix:** `ui/feed.ts` `KoMeter` now counts the report's edges. It uses the same filter (`cascade.ts` `inCascade`) and the same cause links. Each step counts once, from the tick it first happened, and `runbar.ts` shows the count at the playhead. Both K.O.s have a tooltip saying what they count.

**Checked:** at the end of the main run, the HUD read **270** and the report **K.O. 270**. The run differs a little from the playtest's (PARTSIM's part changes).

### 8. Ctrl+Z right after an edit

**Not reproduced.** With real input on the playtest world, placing with a click, with the keyboard cursor + Enter, and with click-then-move, then Ctrl+Z after 0, 50, 100, 150, 300, 400 or 900 ms: every undo worked. At 0 ms the edit was still unacknowledged (`pendingCount` 1). `DocStore.undo` doesn't need the ack.

**Found and fixed:** the one path that loses an early undo. `net.undo()` sent its op straight out, while edits go through the op queue (≤ 150 ops a second). After a burst, such as a big paste or a brush stroke, the undo overtook the edit it undoes. The host then saw the inverse first and rejected it, so the edit came back, and the acks arrived out of order, so `onAck` threw. The undo now goes through `queueOp`. A unit test covers the queued case.

The playtest's ~0.4 s window most likely came from where the script's focus was. Ctrl+Z in a focused Inspector field undoes the text, by design. That's unconfirmed.

### Also: BUZZ startle tag (PARTSIM hand-off)

BUZZ's startle (D121) shows the "!" emote. BUZZ uses the same emote when it sets off on a job, so the emote alone can't say "startled". `emoteText` now takes the critter's FSM state (critterState byte 3), and `overlays.ts` passes it: an alarm emote while startled reads **"Buzz: startled!"**, or "Pip: startled!" for PIP's wheel startle. The caption strip still says "[Buzz beeps in alarm]". There's a unit test.

## Files

- **Mine:**
  - `capture/offline.ts`, `capture/index.ts`, `capture/codecs.ts`, and the new `capture/estimate.ts`;
  - `cameras.ts` (`restart`, rewind);
  - `ui/cascadepanel.ts`, `ui/m5tools.ts`, `ui/keyboard.ts`, `ui/feed.ts`;
  - `ui/panels.ts` (Radial only), `ui/captions.ts` (`emoteText`);
  - `cascade.ts` (`inCascade`), `matterhost.ts`, `net.ts` (`undo`).
- **Shared, small tagged edits (`UIFIX (D122)`):**
  - `main.ts`: the radial key-up and its subject;
  - `run.ts`: `setPlay(…, ahead)` and `stopMatter`;
  - `ui/buildtools.ts`: the zone click's part and the cascade scrub and replay;
  - `ui/runbar.ts`: `countAt`, the tooltip;
  - `ui/overlays.ts`: the FSM state for the emote tags;
  - `styles.css`: the `.cr-body` rules.
- **Docs:**
  - HOW_TO_PLAY §2, §3.7, §3.8, §5 and §7;
  - UI_UX §4.7, §4.8, §4.9 and §4.11;
  - RENDERING §13 (the capture bullets);
  - the bug table in the playtest log.

## Outside my files (reported, not fixed)

During the checks two other streams' in-progress edits broke the frame loop for a while, and the coordinator passed them on. Both were fixed by their owners before the final checks.
- **BUILDUX:** a shadowed `n` in `hud.ts` `updateOverlay` (TS2448).
- **RENDER:** `gfx/post.ts` `rebind` used an undefined texture.

**Leftovers for others:**
- Recording a clip from the Cascade Report after the run starts a new solo run, so the report reopened afterwards is that run's (the clip's span). This is old behaviour; a future pass could keep the last report.
- The 3 s backstop in `stopMatter` holds a stopped run's Matter buffers that long if the worker never answers (normally it answers within a frame).
