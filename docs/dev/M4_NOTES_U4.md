# M4 notes: stream U4 (accessibility + UI)

2026-10-24. Scope: the accessibility pass to [GAME_SPEC §20](../../GAME_SPEC.md) and [UI_UX §7](../UI_UX.md) (WCAG 2.2 AA), plus the UI for the M4 content (Matter, the 15 M4 parts, BISCUIT / HENNY / DUSTY). Plan and rules: [M4_PLAN.md](M4_PLAN.md). Builds on U3's Glass Lab UI ([M3_NOTES_U3.md](M3_NOTES_U3.md)).

Status: **done** (hand-back below), except the items under "Open / waiting on other streams".

Verified on a local test server (`KNOCKON_PORT=8807`, `KNOCKON_DATA` in a local scratch folder) and local Vite (:5207, the shared config with the proxy pointed at :8807), driven over CDP by a headless Chrome 155 (NVIDIA D3D12 adapter, throwaway profile). The shared :8787 host and the browser pane weren't used.

## What's built

| Area | Where | What |
|---|---|---|
| **Captions** | `ui/captions.ts` (model), `ui/overlays.ts` (view) | `settings.accessibility.captions` now has a consumer. Notable SimEvents become bracketed captions: `[BOOM] POWDER KEG ×6`, `[crash] PANE breaks`, `[fizz] WICK fuse lit`, `[snip]`, `[ding]`, `[whoosh] … launches`, `[splat] YOLK`, loud `Sound` (≥ 70 dB at 1 m), and critter voices by species and mood from the `Emote` / `Ragdoll` / `Trapped` events and B4's `Bark` / `Lay` (`[Biscuit barks]`, `[Mochi hisses]`, `[Henny lays a YOLK]`, `[Dusty chimes: bin full]`). Repeats within 2.5 s collapse to ×n; at most 3 lines for 3.5 s; at most 4 new lines a second (a burst merges, small ones drop first, big moments stay). Each line has a direction mark from the event's screen position (‹ › at the sides, ◂ ▸ off screen). Placed above the transport in Build and above the run bar in a run, on stand-alone wells (`--surface-well`: 6.6:1 over white, solid in Reduce transparency), 15 px semibold, UI-scaled. New lines also go to the screen-reader announcer. Impacts aren't captioned (far too frequent). |
| **Emote text** | `ui/overlays.ts` | With captions on, every critter showing an emote bubble gets a text tag under it ("Mochi: alarmed!", "Henny: laid an egg!"), from `run.critters` byte 2 and the run's body transforms. Under the critter because the existing emoji bubble (`gfx/emotes.ts`) sits over its head. |
| **Announcer** | `ui/a11y.ts` | Two visually hidden live regions (`#kn-live-polite`, `#kn-live-assertive`), rate-limited (one message per 700 ms, repeats inside 2.5 s dropped, newest 4 kept, assertive first). Fed by: every toast (they used to be per-element `role=status`, inside an `aria-live` container, so some readers spoke them twice), tool changes, run start / countdown / stop, countdown numbers, captions, keyboard-building feedback (cursor over / blocked / port names / placed / picked up), radial wedges, key-capture prompts. |
| **Keyboard building** | `ui/keyboard.ts`, hooks in `main.ts` | `settings.accessibility.keyboardAids` (on by default) now has a consumer. A keyboard cursor in the world: arrows move it one grid step relative to the camera (snapped to the nearer world axis; Ctrl = 2.5 cm), PageUp / PageDown move the work plane. It works by steering main.ts's `pointer` to the cursor's screen position before the per-frame pick, so the ghost, snapping, blocked tint, port glows and partner presence all behave as with the mouse; moving the mouse hands control back. **Enter** places (Place), picks up / puts down (Select), adds a path point (Path; Enter again in place finishes) and connects (Wire). **[ / ]** cycle ports nearest-first in the Wire tool and parts nearest-first in the Select tool (each announced). While a part is picked up the arrows / PageUp / PageDown move it (one `PartUpdate` batch per press, undoable). **Shift+arrows** orbit / tilt, **= / −** zoom in Build, **F** frames. The tool badge follows the cursor and lists the keys. |
| **Sticky radial** | `ui/panels.ts` `Radial.sticky / step / cancel`, `ui/keyboard.ts`, `main.ts` keyup | With the aids on, a tap of Q opens the radial at the cursor (or the view centre) and keeps it open; arrows move the highlight over enabled wedges (announced), Enter confirms, Esc or Q closes. Hold-Q-and-point is unchanged. The highlight gradient now uses D86's `#3373D0` top stop (it still had the mockups' `#3E86E6`). |
| **Tab and focus** | `ui/buildtools.ts`, `ui/a11y.ts`, `ui/hud.ts`, `index.html` | Tab no longer always means X-ray (it trapped keyboard users out of the HUD): on a HUD control it moves focus as usual; from the 3D view a quick tap (< 250 ms) focuses the first HUD control and a hold still peeks. A key remapped to X-ray peeks at once. Esc on a HUD control (outside dialogs) hands focus back to the canvas (now `tabindex=0` with a described keyboard summary). Mouse clicks on HUD buttons give focus back to the page afterwards, so Space lets it rip instead of re-pressing the last button; keyboard activation keeps focus. main.ts lets a focused button take Space / Enter. |
| **Arrow keys in groups** | `ui/a11y.ts` `rovingFocus`, `arrowGroups` | Roving tabindex (one Tab stop, arrows, Home / End) on the tray's family tabs and icon row (now a real listbox with `aria-selected`), the view rail's two radio groups and the Settings tabs (activation follows focus); delegated arrow keys for every other radio group, tab list and segment (Inspector tabs and choices, sim speed, Library tabs, …). |
| **Focus trap and return** | `ui/a11y.ts` `trapFocus`; `settingspanel.ts`, `lobby.ts`, `ask.ts`, `panels.ts` | Settings, the lobby and the ask dialog keep Tab inside and give focus back to the opener on close; the palette returns focus too. Settings is `aria-modal` with `aria-labelledby`, its tabs control a `role=tabpanel`. |
| **Outliner tree keys** | `ui/outliner.ts` | The tree was `role=tree` with no keyboard: now one Tab stop with `aria-activedescendant`; ↑ ↓ Home End move, → ← open / fold, Enter / Space select (Ctrl adds), H hides, L locks. Row buttons are `tabindex=-1` (reached through H / L), so a 300-part world isn't 900 Tab stops. |
| **Labels and roles** | throughout `ui/` | Buttons can't be `listitem`s: the Library grid, lobby worlds and Cascade chain are `role=group` with named buttons. The K.O. counter was `role=status` updating at 15 Hz (a live-region flood) and the event feed a polite `log` updating per event; both are now quiet (captions speak instead). The countdown timer is `aria-live=off` (numbers announced once each). Radial items have ids, `aria-disabled` and `aria-activedescendant`. Run-bar speed / camera buttons carry `aria-pressed`, the timeline `aria-valuetext` and Home / End. Inspector sliders have names and `aria-valuetext` with units; the tray and Library tiles describe themselves with the part card, which keyboard focus now opens like hover. Measured: 0 unnamed controls on 12 screens (`__knAudit.unnamed`). |
| **Port glyphs** | `ui/overlays.ts`, `settings.accessibility.portGlyphs` (new, on) | Wherever the renderer shows ports (Wire tool, the hovered / selected part, X-ray), each also gets its channel glyph on a near-black chip next to it: solid ring = output, dashed = input. Up to 64, nearest the camera first. Colour is never the only channel signal in the 3D view now (GAME_SPEC §20). |
| **Colour presets** | `ui/palettes.ts`, `ui/cvd.ts`, `ui/icons.ts`, `styles.css` | Each preset now swaps the **channel palette** (glyphs in the tray, Library, part card, Inspector, port chips), not only the player / warning tokens U3 had. Method under "Colour presets" below. High contrast also gets a thicker white focus ring, darker key chips and visible control edges. |
| **Focus rings** | `styles.css` | `--focus` is a dark 2 px ring inside the Beam ring (visible on light and dark backdrops); inset in scrolling rows so overflow doesn't clip it; the search wrappers show focus (their inputs had `box-shadow: none`). Switches show a tick when on. |
| **Target sizes** | `styles.css`, `ui/tray.ts` | Sim speed buttons (23 px wide), Settings key buttons (19 px tall) and ↺, the Outliner row buttons, the part card's slot keys and the tray's Library key (a bare `<kbd>` with a click handler, now a button) are ≥ 24 px. Switches are 42 × 24. |
| **Reflow (UI scale 75–200 %)** | `ui/hud.ts` `layout()`, `styles.css` | Compact mode was a `max-width: 1279px` media query, so UI scale never triggered it. Now JS sets `:root[data-compact]` from the *effective* viewport (window ÷ UI scale) under 1280 × 760 and `[data-tight]` under 1000 × 640, plus `--vw-z` / `--vh-z`. The view rail scrolls instead of running into the tray (tight: icon-only tiles), the transport makes room for the Inspector (dropping sim speed while it's open), the Library and Cascade Report take the full width while Build chrome steps aside, the run bar drops its camera labels and the Stop key hint, the world card yields to the session bar. |
| **Reduced motion** | `ui/settings.ts`, `styles.css` | First launch follows the OS `prefers-reduced-motion` (U3 did this only for transparency); the OS preference also stops keyframe animations even before the setting is saved. |
| **Contrast fixes** | `styles.css` | See the audit table. Run-idle no longer fades the K.O. counter and run bar to 60 % (their text fell to 2.9:1); the K.O. label sits on a well; the oldest feed row dims its icon, not its text; the LET IT RIP key hint is full opacity; the bake-head label is on an opaque chip; the Cascade score card's warm glow moved into its own corner layer; Text-2 labels straight on glass are Paper. |
| **Matter indicator** | `ui/matter.ts`, `ui/hud.ts` | World card: `230k / 4M grains` with a meter, from every container's capacity × *Full at start* (the same sum A4's `matterInit` uses: GRIT HOPPER, MARBLE HOPPER, TANK 15 L, SPRINKLE CAN 2 L, SPONGE) against the session tier's budget (format `tierGrains`; the lower of the two players' tiers). Amber over 80 %; over budget it turns red and says which tier it needs (format `requiredTier`), the run refusal's words. Also in the perf readout. During a run it uses `run.matterCounts` if MI adds it (see below). |
| **DUSTY's patrol zone** | `ui/zonetool.ts`, `ui/buildtools.ts`, `ui/inspector.ts` | Inspector › **Patrol zone** (for any part whose def has `zone_w` / `zone_d` props) › *Draw the zone on the floor*: drag a rectangle on the work plane, or Enter at two corners with the keyboard cursor; Esc cancels. Corners go into the part's frame exactly as B4's `onBuild` reads them (heading from the part's forward axis, `yawQ` about +Y), and `zone_x / zone_z / zone_w / zone_d` go out as one undoable `PartUpdate` (clamped to the props' ranges, ≥ 0.4 m). The zone is drawn as a dashed mint outline on the floor while the part is selected or the tool is armed. The four numbers are in the same section for keyboard editing. |
| **M4 parts in the UI** | `ui/panels.ts`, `ui/icons.ts`, `ui/inspector.ts` | A **Matter** family tab (after the spec's families, with a grains icon); unknown families get a capitalised label instead of a blank tab (one appeared as soon as A4's defs landed). Inspector hints for `capacity`, `rate`, `start`, `flow`; values ≥ 10,000 show grouped (`200,000`) and the numeric field accepts commas. New critters and parts appear in the tray, Library and palette from parts-data as their defs land; their 3D icons appear when E4a / E4b export them (family line icon until then). |
| **HOW_TO_PLAY** | `docs/HOW_TO_PLAY.md` | New §3.8 *Building with the keyboard*, §4½ *Matter*, port glyphs (§4), captions and the Cascade Report's Share card / Record clip (§5), capture and Photo mode (§7, from C4's `ui/photo.ts` / `ui/capture.ts` and UI_UX §4.11), controls rows (§8), the M4 parts and critters (§9), the accessibility options (§11), two new troubleshooting rows (§12). |
| **Audit helpers** | `ui/audit.ts` (debug only: `?debug` → `window.__knAudit`) | `texts()`, `targets()`, `reflow()`, `unnamed()`; the CDP drivers that use them are described below. |

## WCAG 2.2 AA audit

### Method (measured; M3_D79_REVIEW §2's legibility method, automated)

- **Contrast:** `__knAudit.texts()` walks every visible text run and records its colour (times the opacity of every ancestor) and the stack of backgrounds under it (gradients contribute every stop) up to the first glass surface or an opaque background. The driver then hides the UI, screenshots the live 3D view, and composites each stack over **the brightest pixel of the render behind that text's box** and over **pure white**; the reported number is the worse of the two, and the target is 4.5:1 for all text (D80 applies body-text AA everywhere, even to large text). Inactive controls are exempt (WCAG 1.4.3), and the perf readout (a debug overlay) is skipped. The glass budget fallback was pinned off so "glass" really was glass (see "Observations").
- **Screens (11):** Build HUD, + Inspector, + Outliner, Library, command palette, Settings › Accessibility, radial (opened from the keyboard), Run HUD, Run HUD with captions, Cascade Report, lobby. Scene: the Tinker Lab Room preset with six parts, 1440 × 900.
- **Modes (6):** glass, solid (Reduce transparency), and the High contrast, Deuteranopia, Protanopia and Tritanopia presets (with glass).
- **Targets:** `__knAudit.targets()` lists every visible pointer target and passes it at ≥ 24 × 24 CSS px or by the 2.5.8 spacing exception (a 24 px circle on its centre touches no other target).
- **Reflow:** `__knAudit.reflow()` at UI scale 75 / 100 / 125 / 150 / 200 % × 1440 × 900, 1920 × 1080 and 1280 × 720, on Build, Inspector, Library, Settings and Run: every HUD surface on screen, not overlapping another (modal dialogs exempt), and not clipping its contents.
- **Names:** `__knAudit.unnamed()` on 12 screens (incl. the menu, Share popover and three Settings tabs).
- **Keyboard:** a CDP script that sends only key events (no mouse at all) and checks the result after each step.
- **CI:** `apps/game/test/contrast.test.ts` (U3's, extended) re-measures every registered glass surface with each colour preset's token overrides and checks both stops of the D86 selected gradient; `apps/game/test/a11y.test.ts` (new) covers the announcer, captions, keyboard maths, the zone tool, the Matter readout and the channel palettes.

### Results

Worst text contrast per screen over all six modes (glass, solid, High contrast, Deuteranopia, Protanopia, Tritanopia), each text taken at the worse of the live backdrop and white. "Before" is the first audit run on the M3 UI as it stood (with my M4 additions), "after" the final run. Target 4.5:1.

| Screen | Texts measured (per mode) | Worst before | Failing texts before (what) | Worst after | Targets ≥ 24 px (glass) |
|---|---|---|---|---|---|
| Build HUD | 69 | 3.87 | 1: LET IT RIP's "Space" hint at 80 % opacity on the dark stop of the Ignition ball | **4.64** | 56 / 56 (sim speed "2" and "4" were 23 px wide before) |
| + Inspector | 89–101 | 3.87 | the same hint | **4.64** | 80 / 80 |
| + Outliner | 113–116 | 4.64 | 0 | **4.64** | 94 / 94 |
| Library | 130 | 4.64 | 0 | **4.64** | 91 / 91 |
| Command palette | 115 | not measured (the driver closed it, fixed) | – | **4.64** | 71 / 71 |
| Settings › Accessibility | 92 | 4.64 | 0 | **4.64** | 78 / 78 |
| Radial (keyboard-opened) | 72–80 | 4.64 (disabled wedges, exempt, at 4.13) | 0 | **4.64** | 56 / 56 |
| Run HUD | 20 | **1.74** | 8: the orange K.O. label straight on glass (1.74); the timer, total, K.O. count, selected speed and camera at the run-idle 60 % fade (2.70–2.88); "at 3.96 s" (4.29); the bake-head label on a translucent chip (4.26) | **4.66** | 16 / 16 |
| Run HUD + captions | 20–25 | 1.74 (as above) | the same 8; the caption lines themselves ≥ 6.6 | **4.66** | 16 / 16 |
| Run HUD under the Cascade Report | 48–57 | **2.51** | 6: the whole run bar at 55 % opacity under the report (time 2.67, selected speed / camera 2.51, Bake & Watch 4.20, Stop 4.14) | **4.64** | 22–24 / 22–24 |
| Cascade Report | 93 | **2.08** | 5: the tier title (#FF9670) and score label, score and progress over the warm glow (2.08–3.91); "Longest chain" in Text-2 on glass (3.57) | **4.64** | 60 / 60 |
| Lobby | 33 | 3.57 | 3: section labels (Size, Environment, Title) in Text-2 straight on glass | **4.64** | 15 / 15 |

The 4.64:1 floor everywhere is white on D86's selected-state blue (`#3373D0`), as intended. Glass, solid and the four presets give the same worst case on every screen after the fixes (the presets only change accents; High contrast raises the glass tint to .78).

**Other criteria:**

| Criterion | Result | How |
|---|---|---|
| 1.4.11 non-text contrast (glyphs, focus) | Pass | Channel glyphs ≥ 3:1 where they sit (well in glass, pop surface, port chip) in every palette (CI); the focus ring is a Void ring inside a Beam ring, so one of the two is ≥ 3:1 against any backdrop. |
| 2.5.8 target size (minimum) | Pass, 0 failures on 11 screens | `targets()`: size or spacing exception. |
| 1.4.4 / 1.4.10 resize and reflow (UI scale 75–200 %) | **71 / 75 pass** | `reflow()` on 3 window sizes × 5 scales × 5 screens. 1440 × 900 and 1920 × 1080 pass at every scale. 1280 × 720 passes to 150 %; at 200 % (an effective 640 × 360 viewport) the view rail touches the transport and the run bar clips its contents. Before the layout change: 64 / 75 (and 1440 × 900 at 150–200 % failed on every screen). |
| 4.1.2 name, role, value | Pass, 0 unnamed controls on 12 screens | `unnamed()`; roles fixed (buttons as listitems, quiet live regions). |
| 2.1.1 keyboard, 2.1.2 no trap, 2.4.3 focus order, 2.4.7 focus visible | Pass, 16 / 16 keyboard-only checks | Table below; Tab no longer swallowed by X-ray; modals trap and return focus; Esc returns to the view. |
| 4.1.3 status messages | Pass | Toasts, chat, captions, tool changes, run start / stop announced through one rate-limited live region; no 15 Hz live regions left. |
| 2.3.1 three flashes, 2.3.3 animation from interactions | Pass (UI) | The UI has no flashing content (the fault LED blinks at 2 Hz, under 3); in-world flashes are R4's `FlashLimiter` (Reduce flashing, on by default, measured from the TAA luminance). Reduced motion follows the OS at first launch and stops keyframe animations; it already turned off DOF, shake, hitstop and slow-mo. |
| 1.4.1 use of colour | Pass | Port glyph chips in the 3D view (solid / dashed rings for out / in), glyphs in every channel list, switches show a tick, the zone outline is dashed, over-budget Matter says so in words. |

## Colour presets (channel palettes)

The default channel colours (UI_UX §2) collapse badly for colour-blind players: simulated with Machado, Oliveira & Fernandes (2009) at full severity, the closest pair of the 12 channels is 4.7 ΔE\*ab for protanopia (spin / fluid), 4.6 for deuteranopia (sound / field) and 6.9 for tritanopia (signal / tension); among the 7 core channels, 9.6 / 9.6 / 6.9. (Around 10 is "noticeable side by side", under 5 is easily confused.)

Each alternate palette came from a simulated-annealing search over sRGB (`scratchpad/u4/palopt.ts`, 6 restarts × 60k steps) that maximised the smallest distance between channel colours as seen with that deficiency, while keeping each colour within 25° of its default hue (heat stays warm, fluid blue, lure green), the normal-vision distances ≥ 15, and every colour ≥ 3.2:1 against a lone well over white (non-text contrast). Results (the CI test asserts ≥ 15 and > 2× the default):

| Preset | Closest pair, all 12 channels (default → preset) | Closest pair, 7 core channels |
|---|---|---|
| Protanopia | 4.7 (spin / fluid) → **17.3** (fluid / sound) | 9.6 → **26.1** |
| Deuteranopia | 4.6 (sound / field) → **15.2** (heat / lure) | 9.6 → **21.6** |
| Tritanopia | 6.9 (signal / tension) → **16.0** (power / light) | 6.9 → **22.0** |

ΔE\*ab with the deficiency simulated; normal-vision distances stay ≥ 15 in every preset. High contrast keeps the default hues, lifted to ≥ 3:1 on a lone well over white.

Every palette colour, the default ones included, is ≥ 3:1 on the port glyph chip and on the surfaces glyphs actually sit on (a well inside glass, the pop surface). Five default colours are under 3:1 on a lone .72 well over white (spin, heat, fluid, sound, field), but no glyph sits on a lone well; the alternate presets pass there too.

## Keyboard-only check (no mouse events at all)

`scratchpad/u4/kbd.mjs` sends key events only (CDP `Input.dispatchKeyEvent`; text for the palette query) on an emptied world, then checks the document after each step. **16 / 16 pass:**

| Step | Keys | Checked |
|---|---|---|
| Into the HUD and back | Tab (tap), Tab, Tab, Esc | focus moves to a HUD control and along; Esc puts it on the canvas |
| Choose a part by name | Ctrl K, "the button", Enter | the badge shows THE BUTTON |
| Place | ← ← ←, Enter | 1 part |
| Choose, rotate, place | 0 (hotbar), → ×6, R R, Enter | BANGSTICK placed at yaw 60° |
| Wire | E, ], Enter, ], Enter | 1 link (THE BUTTON's signal out → BANGSTICK's signal in) |
| Select and move | V, ] (until THE BUTTON), ↓ | its position changed by one cell; Enter puts it down |
| Camera | Shift+←, = | orbits / zooms, no error |
| Radial | Q, →, Esc | opens, stays open on key-up, closes |
| Run and stop | Space … Backspace | countdown → running → build |
| Tray | (focus a tile), → →, Enter | the third tile's part is armed |

Also checked: a mouse click on a tray tile leaves focus on the page, so Space then starts the countdown instead of pressing the tile again.

## Observations and decisions

- **Run-idle fade and the dimmed run bar (UI_UX §3 / §4.9).** At the spec'd 60 % (idle) and 55 % (under the Cascade Report) the run bar's text measured 2.5–2.9:1. The bar and the K.O. counter now stay fully opaque; idle drops their ring, and both cases dim only the transport buttons, the timeline rail and its markers. The pill and feed still fade to 0 when idle (no text left to read). *For the producer:* a spec deviation for WCAG 1.4.3.
- **Height-based compact mode.** Compact now also kicks in under 760 px of effective height (not only under 1280 px of width), so a 1440 × 749 window, or UI scale 125 % on 1080p, gets the compact tray. Cheap to change: the thresholds are in `hud.ts` `layout()`.
- **The glass budget fallback trips under GPU contention.** With other streams holding the GPU at 99 % (nvidia-smi, 23.7 GB used), the boot probe measured the blur at 7.0 ms a frame (14.1 → 21.1 ms intervals) and the UI switched to solid panels with the toast, as U3 designed. The audit pins it off to measure glass; nothing to fix, but the probe will be pessimistic on a busy machine.
- **Tab and X-ray.** UI_UX's "hold Tab for X-ray" is kept, but only from the 3D view: Tab must move focus for keyboard and screen-reader users (WCAG 2.1.1 / 2.4.3).
- **Sticky modifiers.** No action needs a chord without an alternative: Ctrl K (session bar button), Ctrl Z / Shift Z (world card buttons), Shift+R / T / Y (repeat R, or the Inspector's rotation stepper), Ctrl G / L (palette, Outliner). Windows Sticky Keys works with all of them (the handlers read modifier state, not held keys). Hold-to-act keys (Q, Tab) have tap alternatives.
- **Mirror (Alt+X/Y/Z)** stays out: the sim and renderer still ignore the mirror flags (U3's note).

## Shared-file edits (Edit tool only)

- `apps/game/src/main.ts`: import `KeyboardBuild`; create it after `ui.attach` with closures over main's pick / click / ghost / ports / selection (≈ 45 lines, commented U4); `ui.keyboard(kb)`; in the keydown handler, a focused button takes Space / Enter, then `kb.keydown`; Q's keyup leaves a sticky radial open; `kb.frame()` before the per-frame `pick()`.
- `apps/game/src/ui/cascadepanel.ts` (shared with C4): the chain is a named `role=group`; chips aren't `listitem`s.
- `apps/game/src/ui/glass.ts`: untouched by me (C4 added `photo` and `capture`; the CI check covers them).

## Open / waiting on other streams

- **B4:** DUSTY's def needs `zone_w`, `zone_d`, `zone_x`, `zone_z` in its `props` (e.g. `float`, 0.4–20 m and −10–10 m, step 0.1, defaults 2 / 2 / 0 / 0, labels "Zone width (m)" …). Your sim reads `p.props.zone_*`, but `propValues` drops keys the def doesn't declare, so nothing can set them until then; the Inspector section and the tool switch on by themselves when the props exist (`hasZone`).
- **MI:** for a live Matter count during a run, expose the latest per-kind counts on the RunController as `run.matterCounts` (any `ArrayLike<number>`: sand, water, marble). The world card uses it while running and the build-time sum otherwise.
- **gfx/emotes.ts owner (M2 stream C's emote bubbles):** `EMOTE_GLYPH` has no glyphs for B4's new emotes (bark, eyes_mochi, bone, egg, !!, feather, sparkle_clean, bin_full), so those bubbles will be empty. Captions and the emote text tags already cover them.
- **MX / MI:** `pnpm typecheck` has 10 errors in `packages/matter/test/matter.test.ts` and 2 in `packages/format/test/matter_header.test.ts` at hand-back (not mine; apps/game and every UI file are clean).
- **Screenshots:** `scratchpad/u4/shots/` (not copied into `art/style-samples`, to keep the repo small): `a3_*` (audit screens × modes), `a6_*` (run, captions), `m4_zone.png`, `m4_port_glyphs.png`, `m4_hopper_inspector.png`, `m4_matter_over.png`, `kbd_end.png`, `reflow_*`.

## Verification (at hand-back)

- `npx vitest run apps/game`: 11 files, 130 tests pass. New: `test/a11y.test.ts` (15 tests: announcer, captions and emote text, caption rate limits, keyboard arrow maths and port ordering, the three CVD palettes and glyph contrast, the Matter readout, the zone tool's frame maths). Extended: `test/contrast.test.ts` (the four presets re-measured on every glass surface; both D86 gradient stops ≥ 4.5:1).
- `pnpm -s --filter @knockon/game typecheck`: clean. Whole-repo `pnpm -s typecheck`: only the MX / MI test errors listed above.
- In Chrome (local test server :8807, Vite :5207): the WCAG audit (66 screen × mode runs), reflow (75 runs), names (12 screens), the 16-step keyboard-only build, the Matter meter (215k / 4M grains on 16 GB; 615k / 250k "needs 8 GB" on the 4 GB tier), the Matter tray tab (7 parts), port glyph chips in the Wire tool (8 chips for 5 parts), and the zone tool end to end (drag → one PartUpdate with the four props, dashed outline drawn) with the zone props stood in on the client, since B4's DUSTY def doesn't have them yet.
- GPU contention during the runs: nvidia-smi 99 % utilisation, 23.7 GB used (other streams), so no timings are claimed here.
