# Beta notes: stream BUILDUX (box select, copy / paste / duplicate, mirror, gizmo axes, partner ghost, port snap)

2026-10-25. Beta polish ([BETA_POLISH_PLAN](BETA_POLISH_PLAN.md)), decisions **D123** and **D124** ([DECISIONS_2026-10-24](DECISIONS_2026-10-24.md)). The producer's goal is "easy to play". This stream builds on drag-to-move and the gizmo ([M5_NOTES_DRAG](M5_NOTES_DRAG.md), D117).

The scope is UI and document ops only. There is no sim change, no golden change and no host change. One protocol type grew: presence `ghost` gained two optional fields. That's append-only, so PROTO stays 1.

Status: **done**. Everything below was verified in the browser with real input over CDP (`Input.dispatchMouseEvent` / `dispatchKeyEvent`); `Runtime.evaluate` was used only to read state.

## What shipped

### Box select (D123, `ui/boxselect.ts`)
- **The gesture:** in the Select tool, a left press on empty space that moves past 4 px draws a marquee: a dashed rectangle in the player colour.
- **What it selects:** every part whose bounds' middle is inside the marquee. A port-less path (a TUBE run) counts when all its points are inside.
- **Modifiers:** plain replaces the selection, Shift adds, Ctrl toggles. The mode can change mid-drag.
- **Skipped:** locked, hidden and section-boxed parts, because the marquee only offers `tools.pickable` parts.
- **Readout:** the tool badge counts live ("Select · 3 parts"). On release, "3 parts selected" is toasted and announced.
- **Cancelling:** Esc or a right click cancels.
- **No clashes with the other gestures:**
  - A press on a part is still drag-to-move, and a press on a gizmo handle is still the gizmo.
  - Right-drag orbits and middle-drag pans everywhere.
  - In the other tools, left-drag on empty space still orbits (view rail). In the Select tool it now draws the marquee instead: `HudLinks.holdsPointer` includes the marquee.

### Copy / paste / duplicate (D123, `ui/clipboard.ts`)
- **Ctrl+C** (`copyClip`) copies the selected parts and every link whose ends and vias are all copied; a port-less TUBE comes along when it's selected.
  - Kept: relative positions (exact, in position units), turns and props, and the MirrorX/Y/Z, Anchored and **Tagged (BUZZ)** flags.
  - Dropped: Locked and Hidden. Layer and group are dropped too: pasted parts go on the active layer, ungrouped.
- **The clipboard** is per browser session (`sessionStorage`), so it crosses worlds. The pure pieces are `remapClip`, `repairPairs`, `pasteOp` and `duplicateOffsets`.
- **Ctrl+V** carries the clip as a drag-to-move ghost under the cursor (`DragMove.carry`; the cursor holds the clip's middle, and its lowest part rests on the surface).
  - It behaves like a drag: grid snap (Ctrl fine, Alt free), resting surface, the work plane (Ctrl + wheel, PageUp / PageDown), R turns the clip and Shift moves it vertically.
  - It's red with the reason when blocked; port snapping applies.
  - **A click drops it.** A blocked click is refused (toast, announcement, error sound) and the ghost stays. Esc, a right click, a tool change or the run starting cancels it.
- **Ctrl+D** duplicates the selection.
  - The copy goes one grid step (10 cm) along +X, then keeps stepping (then along +Z, −X, −Z) until it overlaps nothing and is inside the world. It's selected, ready to drag.
  - If there's no clear spot within the selection's size plus 3 steps, it becomes a paste ghost.
- **Ops:** every paste and duplicate is ONE `Batch` (PartAdds, then LinkAdds) with fresh ids from `net.nextId()`. That's one undo step, synced in co-op like any edit. The per-world caps (SINGULARITY 4) are checked for the whole paste.
- **Pairs re-pair** (`repairPairs`, using `pairsOf` / `autoPair` from `ui/m5tools.ts`):
  - A RIFT pair or a BUZZ with its beacon, copied whole, becomes a **new pair** in a colour nobody uses yet.
  - PINGs of one colour copied together become a new group in an unused colour.
  - A lone RIFT GATE, BUZZ BEACON or BUZZ pairs as if just placed.
  - A lone PING keeps its colour, so a copied sender talks to the same receivers.
  - When every colour is taken, the parts keep their source colour.

### Mirror (D123, `ui/mirror.ts`)
**Keys and the mirror plane.** Alt+X / Alt+Y / Alt+Z mirror the selection across the plane through its bounds' centre. The plane snaps to half a grid step, so parts on the grid stay on it. The palette has "Mirror selection across X / Y / Z".

**Positions** reflect exactly, in integer position units.

**Rotations.** There are no mirrored part variants: `PartFlag.MirrorX/Y/Z` exist in the format, but neither the sim nor the renderer reads them. So a part becomes its own mirror image only through a mirror plane of its own.
- If part-local plane b (x = 0, y = 0 or z = 0) is one, the mirror image is the same part turned by **R' = M_a · R · M_b**, placed at the mirrored origin. That's a proper rotation, stored as snapped Euler.
- Of the planes the part has, the one whose axis lies closest to world axis a is used, so an upright part stays upright.

**Finding the planes** (`partSymmetry`, cached per type and props). Plane b counts when every one of these maps onto itself:
- every collider (shapes and piece shapes) and every blockout visual, including its colour;
- the hinge and the slider: the pivot stays put and the axis stays on its line. Where the sense flips, the limits must be symmetric;
- the centre of mass;
- the ports: same channel, direction, kind, body, maxLinks and broadcast. Ports that swap places are re-indexed, and links follow the swap.

Planes y = 0 and z = 0 are only used for behaviours with no front or top (rigid bodies, sensors, timers, PING…). A fan, beam, launcher, field or critter mirrored through its own front would face backwards, so those only use x = 0.

**Prop rewrites.** MOTOR's CW / CCW flips when its spin sense does; GRABBER's zone yaws and DUSTY's patrol offset mirror. Today all three come out handed for other reasons (asymmetric ports or arms), so these rules wait for a symmetric variant.

**What mirrors.** 57 part types have a usable plane: blocks, balls, PLANK, SLOPE, LEDGE, ANCHOR, SHEAVE, COG, CELL, LAMP, PING, RIFT GATES, BUZZ BEACON, most critters… The other 59 are handed: MOTOR, GALE, TORCH, T-PLUNGER, TRAP BOX, GRABBER, DUSTY…
- A handed part keeps its turn and only its origin mirrors.
- The toast names it: "Mirrored 2 parts across X · MOTOR kept its turn (no mirror image)". It's a warning toast.

**Links.** Waypoints of links inside the selection mirror. Link ends on re-indexed ports are updated.

**The checks and the op.** A mirror is checked like a drop: it's refused when a mirrored part would overlap a part outside the selection, or sink through the floor. It lands as one `Batch`.

### Gizmo local / world axes (D123, `ui/gizmo.ts`)
- **The toggle:** **X**, plus the palette's "Gizmo: local axes" / "Gizmo: world axes".
  - X was free: Alt+X is mirror, and Unity uses X for the same toggle.
  - It's remappable: ACTIONS `gizmoAxes`.
  - It's per viewer (`localStorage` `kn.gizmoAxes`), world by default, and announced.
- **Local mode:**
  - The arrows and plane squares follow the primary part's own axes (`GizmoGeom.moveAxes` / `axesQ`). The squares turn with the part, the letters sit on the turned arrow tips, and hit-testing uses the turned axes.
  - The travel along a turned axis is what snaps, by the same steps (10 cm, Ctrl 2.5 cm, Alt free): `localAxisMove`, `localPlaneMove`.
  - The readout says "local X +0.20 m".
- **World mode** is unchanged: the grabbed part's world coordinate snaps.
- **The rings** are the same in both modes: one part turns on its gimbal axes, several on world axes.

### The partner ghost (D124, `ui/presenceghost.ts`, `packages/net` `PresenceGhost`)
- **What's sent:** presence `ghost` keeps `type` + `pos` and appends two optional fields:
  - `rot`: the held part's quaternion;
  - `parts`: up to 32 held parts, the grabbed one first, each `[type, dx, dy, dz, qx, qy, qz, qw]`, with offsets from `pos` in whole mm and the quaternion × 10 000, as integers.
  - That's about 1 KB at 32 parts, still at presence's 20 Hz.
- **Compatibility:** old clients ignore the new fields and still draw one ghost. A new client reading an old ghost draws it unturned.
- **What the partner sees:**
  - every held part (drag-to-move, a gizmo move or a paste ghost), turned as it's being turned;
  - their tag reads "holding 3 parts" for a set (`hud.ts`).
- **The document** only changes on the drop.

### Port snapping (D124, `ui/portsnap.ts`)
GAME_SPEC §7.2 rule 1, for placing, dragging and carrying a paste.

**When it snaps.** A moved port within **0.5 cells (5 cm)** of a **compatible** port on a part that isn't moving pulls the move onto it. Compatible means:
- the same channel;
- for Signal and Power, an output to an input (or a "both" port);
- neither port full (maxLinks).

The search is a 10 cm uniform grid over the still parts' ports (`PortIndex`):
- built once per drag;
- for placing, once per doc change.

**Face to face.** Ports sit a few mm inside a face of their part: a socket, a hook. Two ports made to coincide would leave the parts overlapping, so every such snap would be red.
- When the coincident snap overlaps the snapped-to part and its port is on a face (within 12 mm), the move is pushed out along that face's normal until the two parts just touch (`matePush`).
- The ports then line up across the contact: socket to socket.

**When it doesn't snap.**
- A snap that would make the drop blocked (when the unsnapped one isn't) isn't taken.
- The gizmo doesn't port-snap: it's the precise, axis-locked tool.
- Moves of more than 64 parts don't port-snap.

**Feedback.** Compatible ports within 30 cm glow in their channel colour and the joined port pulses (drawn on top). The drag badge adds "port ⦿".
- There's no guide line: after mating the ports end about 8 mm apart.

**Switching it off.**
- Alt turns it off for the move, as Alt already means "free".
- Settings › Controls › **Snap to ports** (`settings.controls.portSnap`, on by default) turns it off everywhere. The palette has "Snap to ports: on / off" too.

**Why it ships behind a setting.** It moves parts the player didn't aim at exactly, and pulls a part off its resting surface (a LAMP lifts 1.6 cm to meet a CELL's socket). The guard rails above (5 cm reach, never into a blocked spot, Alt) make that rare and visible, and the setting is the way out if it ever gets in the way.

**Limits.**
- The radius limits how far a port can pull. A port high on a part (a CELL's output at 15 cm) is only reached with the work plane raised to about that height.
- Placement still prefers a part anywhere under the cursor over the raised work plane. That's existing behaviour; only drags let a raised plane hide what's under it.

## Files

| File | What |
|---|---|
| `apps/game/src/ui/boxselect.ts` (new) | Pure: `normRect`, `marqueeHits`, `marqueeSelection`, `marqueeMode`. Plus the `BoxSelect` controller: the DOM marquee, the badge and the readout |
| `apps/game/src/ui/clipboard.ts` (new) | Pure: `copyClip`, `remapClip`, `repairPairs`, `pasteOp`, `duplicateOffsets`, `ghostLinkDraws`. Also the session clipboard and `ClipTool` (copy, paste through `DragMove.carry`, duplicate, commit) |
| `apps/game/src/ui/mirror.ts` (new) | Pure: quaternion ↔ matrix, `mirroredQuat`, `partSymmetry`, `mirrorPlane`, `mirroredProps`, `propsWith`, `mirrorSelection` |
| `apps/game/src/ui/portsnap.ts` (new) | Pure: `portsCompatible`, `PortIndex`, `findSnap`, `portFaceNormal`, `matePush`, `partPorts`. Also `snapSession` (drags and pastes), `snapPlacement`, `portSnapItems` (glow) and the Alt tracker |
| `apps/game/src/ui/presenceghost.ts` (new) | `encodeGhost` / `decodeGhost` |
| `apps/game/src/ui/dragmove.ts` | `DragMove.carry` / `pressWhileCarrying` / `carrying`, the `DragHost.snap` hook, `MoveSession.portSnap`, and the badge "port ⦿" |
| `apps/game/src/ui/gizmo.ts` | Local / world axes: `moveAxes`, `axesQ`, `localAxes`, `localAxisMove`, `localPlaneMove`, `toggleAxes` |
| `packages/net/src/protocol.ts` | `PresenceGhost` (optional `rot`, `parts`) and `PRESENCE_GHOST_MAX` |
| `apps/game/src/main.ts` (shared, tagged `BUILDUX`) | Wiring only: imports; `boxSel` / `clipTool`; pointer down / move / up / cancel; `buildKey` (Ctrl+C / V / D, Alt+X / Y / Z, X) and `mirrorSel`; `ghostPose` port snap; palette entries; port index invalidation; ghost glow and paste-link drawing; partner ghost decode; presence encode; badge |
| `apps/game/src/ui/hud.ts` (shared, tagged) | The partner tag "holding N parts" |
| `apps/game/src/ui/settings.ts` (shared, tagged) | `controls.portSnap`; ACTIONS `gizmoAxes` (X) and the fixed copy / paste / duplicate / mirror rows |
| `apps/game/src/ui/settingspanel.ts` (tagged) | The Controls tab's "Snap to ports" switch |
| `apps/game/test/buildux.test.ts` (new) | 30 tests |
| Docs | HOW_TO_PLAY §3.1, §3.3, §6, §8 and §13; UI_UX §5.1 and §5.2 *As built*; GAME_SPEC §7 *As built*; MULTIPLAYER §6 and §10 (presence); D123–D124; this file |

## Tests

`pnpm -s vitest run apps/game`: **19 files, 266 tests, all pass**. That includes `buildux.test.ts` (30 tests):
- **Box select:** the marquee hit-test (inside, behind the camera, paths that stick out), any drag direction, and replace / add / toggle.
- **The clip:** internal links only (a path only when selected), flags filtered, layer and group stripped. The id and link-end remap keeps relative positions.
- **Pastes:** a paste into another world; a paste as one Batch that one undo removes.
- **Pairs:** RIFT, BUZZ + beacon and PING re-pairing; a lone copied gate pairs with the lonely original.
- **Duplicate:** through `ClipTool` with a fake host, the first step is blocked by an ANCHOR, so it lands 2 steps over, selected, clear of everything, and one undo removes it. Also the duplicate offset order.
- **Mirror maths:** quaternion ↔ matrix, and M_a · R · M_b against point reflection for every a, b and four rotations. A yaw mirrors to −yaw.
- **Mirror planes:** a block mirrors through all three; PING only through z = 0, with ports staying put; GALE only through x = 0; MOTOR through none; and the plane choice for a part at 90°.
- **Mirror selection:** positions about the half-grid centre plane, one undo step, PING turning 180° with its cable kept, the MOTOR kept and named, waypoints mirrored, and a refusal on overlap.
- **Gizmo:** the local frame, snapped local axis and plane moves, and the arrow hit-test following the local axes.
- **Port snap:** compatibility rules, the index search with its 5 cm radius, the face normal and `matePush`. A dragged LAMP mates with a CELL's output (lined up across the contact, faces touching); Alt turns it off.
- **Partner ghost:** encoding round-trip (mm, 1e-4), the 32 cap, an old client's ghost, and junk dropped.

`pnpm -s typecheck`: clean. `pnpm -s lint` (determinism): clean. `pnpm -s vitest run packages/net apps/host`: 7 files, 24 tests, all pass.

## Browser verification (real input over CDP)

**The setup:**
- A local test server, started fresh for each script (`KNOCKON_PORT=8924`, `KNOCKON_STATIC=none`, `KNOCKON_DATA` in a local scratch folder).
- My own Vite (:5324, a scratch config over the shared one with the proxy pointed at :8924, and HMR off so other streams' edits don't reload the page mid-check).
- Headless Chrome over CDP (:9624 and :9625, throwaway profiles, 1920 × 1080, RTX 5090, tier 16 GB).

The :8787 host, `apps/game/dist` and the in-app pane weren't used. Everything was built through the UI: the hotbar, the palette, clicks and the Wire tool.

**One client** (41 / 41):

| Check | Result |
|---|---|
| Marquee from empty space over 3 of 4 parts | 3 selected; badge "Select · 3 parts"; toast and live region "3 parts selected"; the camera didn't orbit |
| Shift + marquee / Ctrl + marquee | 4 selected / back to 3 |
| A locked BRIK, a hidden THUD | Both skipped by a marquee over everything |
| Press on a part / right-drag / Esc mid-marquee | Drag-to-move as before / orbit (yaw 0 → −1.2), selection unchanged / cancelled |
| Two PINGs + a cable (Wire tool), Ctrl+C | "Copied 2 parts and 1 link" |
| Ctrl+V, move, click | Carried ghost (badge "Paste 2 parts · 0.00 m"); 2 new parts with new ids and the cable re-linked to them; Δx 0.400 kept; the pasted parts selected and near the cursor; one Ctrl+Z removed parts and link |
| Paste over the originals | Red, badge "Can't drop here: overlaps PING", click refused and the ghost stays; Esc cancels |
| R R while carrying | Both pasted PINGs at yaw 30° |
| Ctrl+D on a PING | Copy at Δx 0.100 (touching is fine), selected, "Duplicated 1 part"; one undo |
| Two RIFT GATES copied and pasted | Old pair colour 0, new pair colour 1 |
| Alt+X on a PLANK at 30° + a THUD | Mirrored about the half-grid plane x = 0.2; PLANK at −30°; "Mirrored 2 parts across X"; one undo |
| Alt+Z | Mirrored about the centre z; PLANK at −30° (its own mirror image) |
| MOTOR + PING, Alt+X | MOTOR moved, kept yaw 0, "MOTOR kept its turn (no mirror image)"; PING at 180° |
| X, local X arrow drag on a PLANK at 30° | Moved Δ (0.606, −0.350) = 0.700 m, along its own X in whole steps |
| X again, world X arrow | Moved along world X only |
| Placing a LAMP (turned 180°) by a CELL on a 10 cm work plane | Snapped to (0, 0.116, 0.1): socket to socket, faces touching |
| Same with Alt held | No snap (0, 0.100, 0.100) |
| Dragging a LAMP to the CELL | Snapped on the drop; badge "LAMP · 0.1 m · port ⦿" |

**Two clients** (14 / 14, slots 1 and 2 in one world):

| Check | Result |
|---|---|
| A drags a PLANK at yaw 30° | B's presence ghost is `{type: plank, rot: [0, 0.2588, 0, 0.9659]}` (turned) |
| A carries a 3-part paste, turned by R | B gets all 3 in `parts` with their turns; B's tag reads "Player 1 · holding 3 parts"; nothing reaches B's doc before the drop |
| A drops | B has the same 6 parts (ids and poses); ids are slot 1; B's ghost clears |
| A's Ctrl+Z | Removed on both |
| B copies and pastes | Lands on A with slot-2 ids, no clash |
| A's Alt+X and Ctrl+D | Both reach B, docs equal |

**Extras** (6 / 6):

| Check | Result |
|---|---|
| Copy in one world, CREATE WORLD in the lobby, Ctrl+V | The PLANK and THUD pasted in the new world |
| A 56-part paste ghost carried for 3 s | Frame median 17.6 ms, p95 18.2 ms, max 19.0 ms (headless vsync) |
| Dropping it | One op (+56); one Ctrl+Z removed all 56 |

**Video:** [playtests/2026-10-25-polish/buildux_demo.mp4](../../playtests/2026-10-25-polish/buildux_demo.mp4).
- 63 s, H.264 1080p30, 16.4 MB, recorded from `Page.startScreencast` frames.
- Captions are a DOM banner; `#perf` was hidden with a style rule.
- It shows box select (+ Shift), copy / paste with R and the drop, a blocked paste and Esc, Ctrl+D, Alt+X / Alt+Z, the gizmo's local axes, and port snapping.

**Stills** in the same folder: `buildux_partner_paste_ghost.png` (B's view of A's turned 3-part paste), `buildux_paste_blocked.png` and `buildux_portsnap_ghost.png`.

## Left out, limits, notes for other streams
- **The partner ghost is capped at 32 parts.** A bigger held set shows its first 32 and the tag says "holding 32 parts".
- **Mirror rotations for handed parts:** there are no mirrored variants. Making `PartFlag.Mirror*` real would need the sim (colliders, ports, behaviours) and the renderer (negative-scale instances, winding). That's a post-beta call; until then, those 59 part types keep their turn.
- **Symmetry comes from the definitions,** not from the art meshes. A decal or detail only in the GLB can flip.
- **Box select uses the part's bounds middle,** not "fully inside" or "touching". Big parts are picked by their middle.
- **Paste placement:** the clip's lowest part rests on the surface under the cursor and the others keep their offsets, so a paste lands like a drag (the floor clamp applies).
- **Shared-file incident (fixed at once):** my first `hud.ts` edit named a local `n`, which shadowed `updateOverlay`'s `n: NetClient` parameter. That was a temporal-dead-zone throw on every frame and TS2448. The coordinator flagged it, and it's renamed (`ghostCount`); typecheck is clean.
- **Seen while verifying (other streams, not touched):** for a few minutes mid-session the `parts` WGSL module failed to parse (`let gxb = dpdx(ub), gyb = dpdy(ub);` at line 1330), so the scene drew black. It was gone on the next load. That's RENDER's in-flight work.

## How it was driven
The scripts are in a local scratch folder, not the repo:
- `bux/cdp2.mjs`: the CDP kit (input only through `Input.*`, `Runtime.evaluate` only to read).
- `lib.mjs`: helpers, plus a fresh host per run.
- `v1.mjs` and `sections.mjs`: one client.
- `v2.mjs`: two clients.
- `v3.mjs`: across worlds, and perf.
- `demo.mjs`: the screencast.

All the private processes (host :8924, Vite :5324, Chrome :9624 / :9625) were stopped afterwards.
