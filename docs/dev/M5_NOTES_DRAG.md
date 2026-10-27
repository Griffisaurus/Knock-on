# M5 notes: stream DRAG (drag-to-move and the transform gizmo)

2026-10-25. This is a post-close beta-prep stream ([D117](DECISIONS_2026-10-24.md)). The producer asked for mouse drag-to-move before beta testing (phase 1), then for the transform gizmo in the same stream (phase 2).

The scope is UI plus document ops only. There is no sim change and no golden hash change, and the host and protocol are untouched: the presence `ghost` field already existed.

**How it was verified:** on a local test server (`KNOCKON_PORT=8913`, `KNOCKON_STATIC=none`, `KNOCKON_DATA` in a local scratch folder) and local Vite (:5313, the shared config with the proxy pointed at :8913). A headless Chrome drove it over CDP (:9613, throwaway profile, 1920 × 1080, RTX 5090, tier 16 GB). The :8787 host, `apps/game/dist` and the browser pane weren't used.

Status: **done**. Both phases are verified in the browser through real input (`Input.dispatchMouseEvent` / `dispatchKeyEvent`); `Runtime.evaluate` was used only to read state.

## What was built

### Phase 1: drag-to-move (`ui/dragmove.ts`, wired in `main.ts`)

**Picking up a part**
- Use the Select tool and press on a part. Past `DRAG_THRESHOLD_PX` (4 px) the press becomes a drag; below it, it's a click, exactly as before.
- If the part is in the selection, the whole selection moves, including selected port-less path links (TUBE runs). Otherwise the part is selected and moves alone (`dragSet`).

**The preview**
- The moved parts are drawn as **placement ghosts** at the drop spot, with the same `partItems` look, player tint and alpha. The originals stay put until release, so cancelling needs no restore.
- The ghosts re-route links: `poseOf` returns the preview poses in Build, so cables, LINEs, BANDs and FUSEs and their port studs follow.
- A **height stalk** (thin line and floor disc) drops from the grabbed part to the floor.

**Where the parts land**
- **Snapping** uses the grid function placement now uses too (`snap`): 10 cm, Ctrl 2.5 cm, Alt free. The *grabbed* part's origin snaps to the grid, and the others keep their exact offsets: a pure shift adds one rounded delta in position units.
- The grab offset is kept, so a part doesn't jump to the cursor.
- **Surface follow** uses `surfaceY`, the rule placement uses: a part's top face, the top of a part hit on its side, or the hit point on the floor, the terrain or the work plane.
- **Height:** Ctrl + wheel and PageUp / PageDown (Ctrl = 2.5 cm) move the work plane mid-drag, with no toast; the badge shows the height. While dragging, a raised work plane hides what's under it in the pick, so a part can be lifted over others.
- **Shift** = vertical only. The pointer ray is projected onto the vertical line through the part (`closestOnAxis`), and the bottom height snaps to the grid.
- **Floor clamp:** the moved parts' lowest bottom never sinks below the floor (`floorClampY`; none on terrain).

**Rotating mid-drag**
- R / T / Y work as the keys do. With one part they edit its Euler angles.
- With several parts, **R** turns them all about the grabbed part (the offsets rotate and each part's yaw changes). T / Y are one-part only and say so: a world pitch of a group isn't on the 15° grid.

**Blocked drops**
- Every frame, `MoveSession.update` tests each moved part's world AABB against every part that isn't moving, with `overlapOf`. That's THE test placement's `blockedBy` now calls. A union-box broad phase runs first, against obstacle boxes cached at the start.
- Outside the world preset's bounds is blocked too ("outside the Room (16 × 16 m)").
- Blocked shows as red ghosts, and the badge turns red with the reason ("Can't drop here: overlaps LAMP").
- On release the drop is re-validated against the current doc. If it's refused, there's a toast, an assertive announcement and the error sound, and nothing moves.

**Committing**
- One op: a `Batch` of `PartUpdate {pos, rot?}` (the op the keyboard move sends), plus `LinkUpdate {points}` for every link whose two ends both moved and for selected path links.
- That is one undo step, and in co-op one op the partner applies.
- Esc, a right click (a chorded button in `pointermove`), the run starting, or a tool change cancels.

**Refusals**
- Locked parts and locked layers. The pick skips them, so `lockedUnder()` finds a locked part nearest under the pointer and shows `lockedReason`; the camera doesn't orbit either.
- Parts the partner soft-locks ("Sam is holding PLANK").
- A run in progress. Anchored parts *can* be dragged.

**Co-op presence**
- During a gesture the moved parts are soft-locked (`lock` / `unlock`), so the partner sees them outlined in our colour.
- The presence message carries `ghost: {type, pos}`, which was already in the protocol and is sent at 20 Hz by `net.presence`. The partner draws that ghost in our colour, and the marker tag reads "Player 1 · holding PLANK" (`hud.ts`). Only the drop is a document op.

**Accessibility:** the keyboard pick-up / move path is untouched. The live region says "Picked up PLANK. Shift moves up and down, Escape cancels.", "Moved 5 parts", "Can't drop here: overlaps LAMP" and "Move cancelled".

**Camera:** left-drag navigation (the view rail's Orbit / Pan / Zoom) stands down while a press is on a part or a gizmo handle (`HudLinks.holdsPointer`). Left-drag on empty space still orbits.

### Phase 2: the transform gizmo (`ui/gizmo.ts`, renderer `top` pipeline)

**Where and when**
- In the Select tool it sits on the selection's bounds centre: one part or many.
- It's on by default. **A** toggles it and is remappable (`settings.ts` ACTIONS `gizmo`). **G is the ping key**, so G wasn't used. The palette has "Gizmo: show / hide", and the change is announced.
- The toggle is a per-viewer `localStorage` convenience (`kn.gizmo`).

**Handles**
- 3 arrows, 3 plane squares (placed in the quadrant facing the camera), and 3 rings.
- Corner cubes appear on a single ZONE, FORCE WALL or STASIS FIELD. While the gizmo is on, they replace the face handles: `VolumeHost.handles()`. The edges still draw, and Shift + = / − still works.

**Easy to hit and to read**
- Sizes are in screen pixels, constant at any zoom (`metresPerPixel`): arrows 18–102 px, squares 28–52 px, ring radius 124 px, hit tolerance 11 / 10 / 15 px.
- The hovered handle grows 1.2× and brightens (the hot ring swaps to a thicker mesh), and the cursor changes per handle: `move`, `grab` / `grabbing`, `nwse-resize`.
- X / Y / Z letter chips in the axis colours sit at the arrow tips (`overlays.ts` zone chips with a colour).
- `GIZMO_AXIS_HEX` gives each colour preset its own axis colours (orange / white / blue for protanopia and deuteranopia, red / white / teal for tritanopia, lifted RGB for High contrast). A test checks they stay apart under each deficiency.

**Snapping and maths**
- **Arrows:** `axisDelta` (ray onto an axis). The grabbed part snaps on that axis with `snap`, as in drag-to-move.
- **Squares:** `planeDelta` (ray ∩ plane).
- **Rings:** the pointer travel along the ring's screen tangent becomes an angle (`ringTangent`, `ringDegrees`), snapped with `snapAngle`: 15°, Shift 5°, Alt free in 0.5° steps (the format's step).
- On one part the rings are its **gimbal** axes and edit its Euler angles exactly like R / T / Y (`turned(…, 'gimbal')`); the part turns about its origin, as the keys do.
- On several parts the rings are world axes, and the selection turns about its bounds centre. Yaw is exact. A world pitch or roll is read back into Euler angles (`quatToEuler`, stored at 0.5°).
- **Corners:** the drag runs on the plane through the corner facing the camera; the axis along the view is left alone. `cornerResize` reuses `snapSize` and `resizeAxis` from `volumetool.ts`, so the opposite faces stay put and the props' ranges clamp. A resize isn't overlap-checked: volumes overlap parts by design, as with the face handles.

**Gestures**
- A press on a handle becomes a gesture only after 4 px; released before that it's a **click**, so Shift+click on a part under a ring still adds it to the selection.
- **A ring gives way to a part under the pointer.** Without this, a 124 px ring over a multi-selection stole presses meant to drag a part.
- Rings seen nearly edge-on (|axis · view| < 0.22) aren't hit-tested: they'd be a line through the centre, over the part.
- Moves and turns run through the same `MoveSession`, so they get the same ghosts, links following, blocked refusal and one `Batch` op. A resize is one `PartUpdate {props, pos}`, as the face handles send.
- The live readout is the tool badge (`BadgeOverride`): "X +0.40 m", "X +0.30 · Z +0.10 m", "Yaw +45°", "width 0.8 × height 0.6 m".

**Locked parts** never get a gizmo: the selection drops locked parts. A part the partner holds shows the gizmo greyed, and a handle drag says why.

**Rendering**
- `SceneItem.top`: overlay items drawn last in the late pass, after particles, in list order (painter's), by the new `top` pipeline. It uses `fs_top` (flat key light plus rim, emissive boost for the hot handle), premultiplied alpha, depth compare *always*, no depth write.
- It isn't affected by the section box, cutaway, X-ray dimming or the prepass.
- Meshes: a cone and two ring tubes, registered once.
- **GPU cost measured at 16 GB (RTX 5090), over 40 samples:** late pass 0.0155 ms with the gizmo vs 0.0130 ms without. That's about +0.003 ms, under the 0.1 ms budget.

### A placement fix on the way

`ghostPose` used the raised work plane only for x / z: with nothing under the cursor, a part placed on a 1 m work plane sat on the floor. HOW_TO_PLAY §3.2 says it lands on the plane. Placement now uses the shared `surfaceY`, so the plane counts. Checked in the browser: a BOING placed with the work plane at 0.5 m sits on it (bottom 0.500 m).

## Files

| File | What |
|---|---|
| `apps/game/src/ui/dragmove.ts` (new) | Pure pieces: threshold, `dragSet`, `snap` / `snapStep`, `worldBox` / `partBox` / `overlapOf` / `unionBox`, `surfaceY`, `liftBottom` / `floorClampY`, Euler and quaternion helpers (`turned`, `quatToEuler`, `axisQuat`), `movePoint` / `moveUnits`. Also `MoveSession` (preview poses, blocked and bounds tests, the op), `moveRefusal`, `commitMove`, `DragMove` (the pointer state machine) and `BadgeOverride` |
| `apps/game/src/ui/gizmo.ts` (new) | Gizmo geometry, hit-testing, drag maths, `cornerResize`, axis palettes, meshes, the toggle, `GizmoTool` |
| `apps/game/src/main.ts` | The shared host; pointer, key and wheel wiring; pick exclusion and work-plane occlusion mid-drag; `lockedUnder`; `poseOf` preview; ghosts, height stalk and partner ghost; badge; presence `ghost`; palette "Gizmo"; A key. `worldBox` / `blockedBy` / `ghostPose` now use the shared functions |
| `apps/game/src/gfx/renderer.ts`, `gfx/shaders.ts` | `SceneItem.top`, the `top` pipeline, `fs_top` |
| `apps/game/src/ui/hud.ts` | `holdsPointer` (nav stands down), `gizmoLabels`, the partner tag "· holding PLANK" |
| `apps/game/src/ui/overlays.ts` | Zone chips take an optional colour (gizmo letters) |
| `apps/game/src/ui/volumetool.ts`, `ui/buildtools.ts` | `handles()` host flag: face handles give way to the gizmo's corners |
| `apps/game/src/ui/settings.ts` | ACTIONS `gizmo` (A) |
| `apps/game/src/styles.css` | Badge `data-drag` ok / blocked styles |
| `apps/game/test/drag-gizmo.test.ts` (new) | 25 tests |
| Docs | HOW_TO_PLAY §3.2, §3.3, §8 and §13; UI_UX §5.1 and §5.2 *As built*; GAME_SPEC §7 *As built*; RENDERING §10; D117; this file |

## Tests

`pnpm -s vitest run apps/game`: **16 files, 206 tests, all pass**, including the new `drag-gizmo.test.ts` (25 tests). It covers:
- drag threshold vs click; what a drag moves;
- grid snap with Ctrl and Alt; multi-selection offsets (exact in position units); group yaw about the grabbed part;
- vertical-only lift and the floor clamp; the resting surface (a raised work plane counts);
- overlap tolerance; blocked and outside-world refusals; moved parts never block each other;
- links following (both ends, one end, selected path links);
- **one drag = one undo step** (DocStore: the Batch, then one undo restores every part and waypoint, then nothing left to undo); no movement means no op;
- **locked refusal** (locked part, locked layer, partner-held, during a run);
- `quatToEuler` round-trip; gimbal vs world turns.

For the gizmo it covers: constant screen size at three distances, handle hit-testing (arrows, planes, rings, edge-on rings ignored, corners first), the axis and plane ray projections, ring angle with snapping (15°, Shift 5°, Alt free), corner-resize snapping, clamping, Alt and the fixed opposite face, and axis-colour separation per preset.

`pnpm -s typecheck`: clean. `pnpm -s lint` (determinism): clean.

## Browser verification (real input over CDP)

The world was built through the UI: palette, hotbar, clicks, and the Wire tool for the cables.

| Check | Result |
|---|---|
| Drag a single PLANK | Moved (0.5, 0.05, 0.2) → (0.2, 0.05, −0.2), on the grid, resting on the floor. The badge read "PLANK · 0.0 m", "Moved PLANK" was announced, and Ctrl+Z restored it. A plain click still selects, and a 3 px wobble is still a click |
| Esc and right-click cancel | Nothing moved |
| Shift = vertical | (0.5, 0.05, 0.2) → (0.5, 0.55, 0.2), badge "PLANK · ↕ 0.5 m" |
| Alt = free | Landed off the grid |
| R, R mid-drag | Dropped at yaw 30°; one Ctrl+Z restored position and rotation |
| 5-part selection with a cable (waypoint) | All five moved by the same delta (0.6, 0, 0), and the cable's waypoint moved with them. "Moved 5 parts" was announced; **one Ctrl+Z restored all five and the waypoint**. Dragging a part outside the selection selected it and moved it alone |
| Blocked drop | PLANK across a LAMP: red badge "Can't drop here: overlaps LAMP", the drop refused with the toast and the announcement, and nothing moved |
| Locked part (Ctrl+L) | The drag was refused with "That part is locked (unlock it in the Outliner)"; neither the part nor the camera moved |
| **ANCHOR to 2.5 m** | Drag the ANCHOR, 25 × Ctrl + wheel, drop over the TRAP BOX. The ANCHOR landed at (0.5, **2.5**, −1.1), right above the box's hook, with the badge at "ANCHOR · 2.5 m". Then a **LINE** was wired (E) from the ANCHOR's hook to the TRAP BOX's hook |
| During a run | No drag (the doc is unchanged; left-drag orbits as before) |
| **Two clients (MP)** | Tab 2 (slot 2) saw "Player 1 · holding PLANK" and the plank held (lock slot 1) while tab 1 dragged, and its doc was unchanged mid-drag. After the drop both docs matched; undo reached tab 2. Tab 2 dragging a part tab 1 holds was refused: "Player 1 is holding PLANK" |
| Placement on a raised work plane | A BOING sits on the 0.5 m plane (the fix) |
| **65 parts selected, dragged for 3 s** | Frame median 17.6 ms, p95 18.3 ms, max 18.9 ms (headless vsync). **One** scene upload during the whole drag: the lock outline, not per frame |
| Gizmo: hover the X arrow | Hot `axis 0`, cursor `move` |
| Gizmo: move along X | x 0.5 → 0.9 only, on the grid, readout "X +0.40 m"; undo |
| Gizmo: XZ square | (0.5, 0.05, 0.2) → (0.8, 0.05, 0.3), readout "X +0.30 · Z +0.10 m"; undo |
| Gizmo: yaw ring 45° | Yaw 45, position unchanged, readout "Yaw +45°"; undo |
| Gizmo: Shift + ring | 11° of drag → 10° (5° steps); undo |
| Gizmo: FORCE WALL corner cube | Width 0.6 → 0.8, height 0.4 → 0.6, cursor `nwse-resize`, readout "width 0.8 × height 0.6 m"; undo restored props and position |
| Gizmo: multi-select turn | PLANK and LAMP turned 90° about their centre: both yaw 90, spacing 0.70 → 0.70 m, centre unchanged; undo |
| Gizmo: blocked move | X arrow into the LAMP: red readout "Can't drop here: overlaps LAMP", refused, nothing moved |
| A toggles the gizmo | Off and on, "Gizmo off" announced |
| Gizmo GPU cost | +0.003 ms (late pass, 16 GB) |

Phase 1: 25/25. Phase 2: 19/19. MP: 6/6. Perf: 2/2.

**Recordings and stills** are in [playtests/2026-10-25-drag/](../../playtests/2026-10-25-drag/):
- `drag_demo.mp4`: 26 s, H.264 1080p, 15.2 MB.
- `gizmo_demo.mp4`: 31 s, H.264 1080p, 22.0 MB.
- Stills: `01_drag_five_parts_wire_follows.png`, `02_drag_blocked.png`, `03_anchor_lifted_2_5m.png` and `04_gizmo_yaw45.png`.

The F9-style debug readout (`?debug`) was hidden with a style rule for the recordings.

## Left out on purpose, and known limits

- **Port snapping while dragging** (GAME_SPEC §7.2 rule 1). Placement doesn't snap to ports either; HOW_TO_PLAY §13 lists it.
- **Box select, copy / paste / duplicate, mirroring and wall / surface work planes** stay post-beta (§13).
- **Snapping:** the gizmo's arrows and planes move along **world** axes, not part-local ones (grid building).
- **Rotation pivots:**
  - A single part turns about its *origin*, like R / T / Y, while the gizmo is drawn at its bounds centre. For base-origin parts the part tips over its base.
  - Group pitch and roll (gizmo rings with several parts) are re-read as Euler angles to the format's 0.5°, so an odd composite can be off by up to 0.25° per angle. Drag-to-move's T / Y refuse for groups instead.
- **The partner's ghost:** only the grabbed part's type and position are in the presence `ghost` (protocol unchanged). The partner sees one ghost, unturned, plus the held outlines on every moved part, then the real move on drop.
- **No overlap check on resize,** as with the face handles: volumes overlap parts by design.
- **Dense builds:**
  - The blocked test is the placement AABB test, so dragging a part out of a cluster it already overlapped (rotated bounding boxes in demo machines) can read as blocked. That's the same rule placement follows.
  - Critters and multi-body parts move as one part record; their ghost is the part's placement ghost.
- **The world bounds check uses part origins.** It's lenient at the walls and stops drops outside the preset.
- **DOF may soften the gizmo:** it's drawn before post (frame graph pass 20), so depth of field can blur it a little when it's far from the focus.

## How it was driven

The verification scripts are in a local scratch folder, not the repo: `drag/setup.mjs`, `v1.mjs` (phase 1), `v2.mjs` (gizmo), `mp.mjs`, `perf.mjs`, plus `rec.mjs` / `mkvid.mjs` for the screencast. They are adapted from P5's CDP kit and follow the same rule: input only through `Input.*`, `Runtime.evaluate` only to read. All the private processes (host :8913, Vite :5313, Chrome :9613) were stopped afterwards.
