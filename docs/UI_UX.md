# KNOCK-ON UI / UX Specification

Status: v1.2 · 2026-10-25 (as built through M5: U3 Glass Lab, U4 accessibility, U5 M5 UI and beta polish) · Owner: UI/UX Designer · Code: `apps/game/src/ui/`, `apps/game/src/styles.css`, `apps/game/index.html`
Related: [GAME_SPEC.md §7–9](../GAME_SPEC.md) · [HOW_TO_PLAY.md](HOW_TO_PLAY.md) (player-facing controls) · [art/briefs/ui_icons.md](art/briefs/ui_icons.md) · [MULTIPLAYER.md §6–8](MULTIPLAYER.md) · [AUDIO.md §6](AUDIO.md) · [D77 Glass Lab UI](dev/DECISIONS_2026-10-24.md) · visual reference: [KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4)

UI is DOM over the WebGPU canvas, written in plain TypeScript with no UI framework (`apps/game/src/ui/`: `hud.ts`, `panels.ts`, `inspector.ts`, `runbar.ts`, `settingspanel.ts`, `glass.ts`, …; v1.0 planned Solid.js, which wasn't adopted). In-world UI (gizmos, port glows, ghosts, partner drones, labels, emote bubbles) is drawn by the renderer (RENDERING §10). v1.1 adopts the **Glass Lab** UI ([D77](dev/DECISIONS_2026-10-24.md)): frosted-glass panels that let the warm, busy world show through, with solid Graphite as the fallback.

> **As built (M5 docs pass):** the Glass Lab surfaces, the Library, Inspector, palette, radial, Run HUD, Cascade Report, Settings, photo mode, capture and the accessibility work are built (M3 U3, M4 U4, C4, M5 U5). Interaction specs in this doc that **aren't built** are post-beta (D107); they're the ones HOW_TO_PLAY §13 lists for players: the Brush and Measure tools, wall and surface work planes, the move / rotate / resize gizmo, box select, copy / paste / duplicate, mirroring keys, Isolate, Test-run selection, the History panel, world export / import, skins, the Fly camera and ortho views, Follow / Jump to partner (F2 / F3), the partner's laser, off-screen arrow, held-part outline and ping radial, and the Graphics *Budget override*, *Particle cap* and *Unlimited Mayhem* settings and Multiplayer › *Show partner laser* (nothing consumes them, so M5 hid them; the settings keys stay). Other gaps are marked *As built* in place.

---

## 1. Principles
1. **The machine is the hero.** Chrome is slim frosted glass that lets the world show through (the legibility and performance guards in §2 and §8 keep it readable and cheap), and it collapses during a run.
2. **Keyboard-first, mouse-fast.** Every action is reachable from the command palette. Every frequent action has a key.
3. **Show cause and effect.** Hover, X-ray and cards explain channels. Errors say what to do next.
4. **Tactile.** Every interaction has a visual response within 1 frame and a designed sound (AUDIO §6).
5. **Calm by default, loud on purpose.** Only LET IT RIP, detonations and the Cascade Report get big moments.

---

## 2. Design tokens (`apps/game/src/styles.css`, `:root`)

The tokens live at the top of `apps/game/src/styles.css` (there is no `packages/ui`). Channel colours for the canvas and overlays are in `apps/game/src/catalog.ts` (`CHANNEL_HEX`), and the colour-blind channel palettes in `ui/palettes.ts` and `ui/cvd.ts` (U4). The block below is the design; **as built** the differences are:
- `--glass-tint` is **`rgb(16 19 26 / .64)`** on text-bearing surfaces (D80), with a separate `--glass-tint-chrome` (.58) and `--surface-chrome` for viewport chrome without small text (the view rail);
- `--focus` is a two-ring focus, `0 0 0 2px var(--kn-void), 0 0 0 4px var(--kn-beam)` (U4: the dark inner ring keeps the Beam ring ≥ 3:1 over light backdrops), plus `--focus-inset`;
- `--glass-shadow` is `0 12px 32px rgb(0 0 0 / .32)`; layout tokens (`--tray-h`, `--rail-w`, `--ins-w`, …) and `--kbd-bg` / `--pop-bg` were added;
- reduced motion also stops keyframe animations (U4).

```css
:root {
  /* neutrals */
  --kn-void:#0B0D12; --kn-graphite:#12151C; --kn-slate:#1B1F29; --kn-steel:#2A303D;
  --kn-fog:#8A93A6; --kn-paper:#EEF1F6;
  /* brand */
  --kn-ignition:#FF5B2E; --kn-volt:#C6FF3A; --kn-beam:#2FD6FF; --kn-plasma:#FF3DAE;
  --kn-amber:#FFB020; --kn-danger:#FF4D5E;
  --kn-select:linear-gradient(180deg,#3373D0,#2A66C4);   /* selected tabs, segments, options (mockups) */
  /* channels */
  --ch-impact:#F2F4F8; --ch-signal:#FFC21A; --ch-spin:#A78BFA; --ch-tension:#E0A96D;
  --ch-power:#C6FF3A; --ch-light:#FFF1A8; --ch-heat:#FF5B2E; --ch-air:#9BE7D8;
  --ch-fluid:#4C8DFF; --ch-sound:#F472B6; --ch-lure:#34D399; --ch-field:#FF3DAE;
  /* players */
  --kn-p1:#2FD6FF; --kn-p2:#FF3DAE;
  /* type */
  --font-display:'Unbounded', system-ui, sans-serif;
  --font-ui:'Inter', system-ui, sans-serif;
  --font-mono:'JetBrains Mono', ui-monospace, monospace;
  --fs-xs:11px; --fs-sm:12px; --fs-md:14px; --fs-lg:16px; --fs-xl:20px; --fs-2xl:28px; --fs-hero:48px;
  /* spacing (4px base) */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px; --sp-7:48px;
  /* shape (D77: 16 / 10) */
  --r-ctl:10px; --r-panel:16px; --r-pill:999px; --border:1px solid var(--kn-steel);
  --focus:0 0 0 2px var(--kn-beam);
  --shadow-1:0 2px 8px rgb(0 0 0 / .35); --shadow-2:0 8px 32px rgb(0 0 0 / .45);
  /* glass (D77) */
  --glass-tint:rgb(16 19 26 / .58);        /* panel fill; never below .55 where text sits */
  --glass-well:rgb(16 19 26 / .72);        /* raised well behind small text (< 14px) */
  --glass-blur:blur(22px) saturate(1.4);   /* backdrop-filter; blur ≤ 24px */
  --glass-highlight:inset 0 1px 0 rgb(255 255 255 / .16);  /* 1px inner top line */
  --glass-edge:0 0 0 1px rgb(255 255 255 / .07);           /* 1px outer edge */
  --glass-shadow:var(--shadow-2);
  /* surfaces: glass by default, solid Graphite in the fallback */
  --surface:var(--glass-tint); --surface-well:var(--glass-well); --surface-filter:var(--glass-blur);
  --surface-ring:var(--glass-highlight), var(--glass-edge), var(--glass-shadow);
  /* motion */
  --t-fast:120ms; --t-med:200ms; --t-slow:320ms; --ease-out:cubic-bezier(.2,.8,.2,1);
  --spring:cubic-bezier(.34,1.56,.64,1);
}
/* Reduce transparency (Settings › Accessibility), the 4 GB tier, or the frame-budget fallback (§8) */
:root[data-solid] {
  --surface:var(--kn-graphite); --surface-well:var(--kn-slate); --surface-filter:none;
  --surface-ring:inset 0 0 0 1px var(--kn-steel), var(--shadow-2);
}
@media (prefers-reduced-motion: reduce) { :root { --t-fast:0ms; --t-med:0ms; --t-slow:0ms; } }
```
Components only use the `--surface*` tokens, never the glass or Graphite values directly, so the fallback is one attribute on `:root`. The OS `prefers-reduced-transparency` preference turns the setting on at first launch.

**Contrast:** all text ≥ 4.5:1 and all accents ≥ 5:1 on `--kn-graphite`. Text on `--kn-ignition` buttons uses `--kn-void` (6.3:1). Never put white text on Ignition.

**Legibility guard on glass** ([D77](dev/DECISIONS_2026-10-24.md)):
- Text sits on glass with at least **.55** tint opacity. The check renders each surface over a **white backdrop** (the worst case of the brightest set) as well as over the default view of every environment.
- Small text (**< 14 px**) never sits directly on glass over the viewport. It sits on a raised `--glass-well` (.72).
- Part icons, chips and controls keep their own solid or well backgrounds; only panel fills are see-through.
- **Resolved (D80, M3):** measured over pure white, Paper text on the .58 tint was about 4.0:1, under the 4.5:1 target, so text-bearing glass uses .64 (≥ 4.5:1) and only text-free chrome keeps .58. Body text on glass uses Paper (never Fog). The contrast test (`apps/game/test/contrast.test.ts`, `ui/contrast.ts`) measures every surface registered in `ui/glass.ts` over white and fails under 4.5:1. M3 measured the worst text-on-glass case at 4.93:1; U4's WCAG 2.2 AA audit (11 screens × 6 modes) found every case ≥ 4.64:1 after fixes (M4).

**Scale:** UI scale setting 75–200 % multiplies the root font size. All sizes are in `rem` in the components.

---

## 3. Layout
The viewport is full-bleed; glass surfaces float over it with a 16 px margin from the window edge. **Visual reference:** the approved [KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4) (six boards: Build HUD, Library, Command palette + radial, Run HUD, Cascade Report, Lobby). Diagram: [GAME_SPEC §9.5](../GAME_SPEC.md).

**Build HUD** (6 glass surfaces):

| Surface | Place | Size | Contents |
|---|---|---|---|
| **World card** | Top left | 320 px wide | World title (inline rename), the world's one-line blurb, save state (`saved` / `saving…` / `offline – 3 changes queued`), undo / redo, environment chip (gravity and air; click opens Env). The Outliner opens below it as part of the same surface (360 px wide, down to the transport pill) |
| **Session bar** | Top right | 48 px tall | Partner chip (MP: avatar, name, `direct · 9 ms`), **BUILD │ RUN** mode switch, **Save**, **Share**, **Ctrl K** (palette), menu ☰ (settings, help, Clear world) |
| **View rail** | Left, vertical, under the world card | 64 px wide | Orbit, Pan, Zoom, then the view modes Normal / X-ray / Section, then the Outliner toggle (Ctrl+\\) |
| **Inspector** | Docked right, under the session bar | 340 px wide | Glass panel; appears on selection, slides out when nothing is selected (§4.5) |
| **Transport pill** | Centred, floating 12 px above the tray | 72 px tall | Reset · step back · the round **LET IT RIP** button (80 px Ø, Ignition, label and "Space" hint) · step forward · sim-speed segment (§4.3) |
| **Parts tray** | Bottom, full width minus margins | 140 px | Merges the old dock and a compact Library row (§4.3) |

**Run HUD** (4 glass surfaces, §4.8): partner / camera pill (top left), **K.O.** counter (top centre), event feed (top right), run bar (bottom). The world card, session bar, view rail, Inspector and tray give way to them while the run plays.

- No screen shows more than **6 glass surfaces** (§8). The Library and the Cascade Report take the Inspector's place while open; modal surfaces (command palette, Settings, dialogs) dim the viewport and turn the others to solid wells until they close.
- Small transient surfaces (tooltips, menus, chat, name tags) use `--surface-well` without backdrop blur and don't count as glass surfaces. Toasts live in the event feed (Run) or under the session bar (Build).
- **Selected state:** selected tabs, segments, options and palette rows use a blue gradient `#3373D0` → `#2A66C4` with white text (`--kn-select`, §2; the top stop darkened from the mockups' `#3E86E6` so white text holds 4.5:1, D86). The primary action stays **Ignition** (LET IT RIP, Join, Replay); focus rings stay `--kn-beam`.
- **Minimum viewport** 1024 × 640. Compact mode below 1280 px wide or 760 px tall, measured on the effective viewport (window ÷ UI scale, so UI scale reflows it; D96, `ui/hud.ts`): the world card shows the title only, the Outliner auto-collapses, tray icons drop to 64 px and lose their labels, and the Inspector becomes an overlay sheet over the right third of the viewport.
- During a run, after 2 s without mouse movement, the partner / camera pill and the event feed fade to 0 % (they come back on mouse move). The K.O. counter and the run bar stay fully opaque; only the run bar's buttons and timeline dim (D96: fading text to 60 % broke the 4.5:1 contrast floor).
- Not in the layout: the reference mockup's goals, part budget and Build → Test → Success strip. They belong to the challenge mode, which stays post-beta (GAME_SPEC §22); the file format already reserves goals.

---

## 4. Screens and surfaces

### 4.1 Boot and `/check`
A full-screen checklist (secure context, WebGPU, cross-origin isolation, threads, GPU tier and local host latency). Each row has a status dot, label, detail and a local troubleshooting hint. The primary button is disabled when blockers exist, with a "Continue anyway (limited)" option only for non-blocking failures.

### 4.2 Lobby
The backdrop is the shallow-focus Tinker Lab render (`art/style-samples/tinker_lab_lobby.png`, from `tools/blender/render_tinker_lab.py --view lobby`), which the title screen shares; the panels are glass over it ([D78](dev/DECISIONS_2026-10-24.md)).
- **Top left:** the wordmark and the tagline "Every action has an overreaction." **Top right:** an identity pill (you, your tier, the host name).
- **Left:** the *Live session* card (world thumbnail, title, environment · preset · part count, the partner with avatar and colour, connection, and a **JOIN SAM** button in Ignition) or *Start a session*.
- **Centre:** the *Your worlds* grid (thumbnail, title, environment · preset · last modified), with search and sort, plus a "Try a demo machine" tile. Actions: Open, Duplicate, Export, Delete (host only, confirm).
- **Right:** *New World* panel: size (Desk…Megastructure, tier-gated with a lock icon and "needs 16 GB"; Room is the default), environment (**Tinker Lab** is the default for Desk and Room, the Studio for Warehouse and Arena; Mega Kitchen; later environments show their milestone), physics preset, title, then **CREATE WORLD**.
- Solo play uses the same lobby. *As built:* the world library is the Host Server's (solo runs against a host on the same machine; `apps/host/src/storage.ts`), not a local IndexedDB store.

### 4.3 Build HUD
- **World card** and **session bar:** as in §3. The BUILD │ RUN switch mirrors the transport (Run = LET IT RIP, Build = Stop).
- **View rail:** Orbit / Pan / Zoom set what a left-drag does (right-drag always orbits, middle-drag always pans, the wheel always zooms); Normal / X-ray / Section switch the view mode (Section shows the section-box handles). The active item uses the selected-state gradient.
- **Outliner:** tree (groups, modules, layers), below the world card in the same surface. Eye and lock toggles per row, search, select-in-world on click, drag to regroup.
- **Parts tray** (merges the dock and a compact Library row):
  - top row: family tabs (All parts · Rollers · Frame · Drive · Air · Power · Boom · Contraptions · Fun · Modules · Favourites) · search · L (opens the Library, §4.4);
  - icon row: large **3D part icons** for the selected tab, scrolling sideways. The first ten tiles carry the hotbar numbers 1–0 (drag a part onto one to assign it, right-click to clear). Each tile shows the part's 3D render on a well with its name under it; the selected part's tile is outlined in `--kn-beam`;
  - clicking a tile arms placement, dragging it into the viewport places it, and hover opens the part card (§4.4).
- **Tools** (V/P/B/E/M) are keys, palette actions and radial actions. The mockups draw no tool switch, so the active tool shows as the cursor (ui_icons §5) and the badge at the cursor.
- **Transport pill:** Reset (disabled while stopped) · step back · **LET IT RIP** (80 px Ø round Ignition button with the play glyph, the label and a "Space" hint) · step forward · sim-speed segment (0.1 0.25 0.5 1× 2 4).
- **Viewport overlays:** snap-step badge at the cursor (`10 cm`), work-plane name and height (`Wall · 1.2 m`), a blocked-placement reason ("Overlaps PLANK"), the active-port glow legend while dragging, and the partner's drone with a "Sam · holding COG M" tag.

### 4.4 Library (overlay, L)
- Full-height glass panel from the right (780 px), in the Inspector's place, or full screen in compact mode. The parts tray stays, so drag-to-hotbar works from the Library.
- Header: "Library", the part and module count, a search field ("Search by name, channel or what it does"), close.
- Tabs: All · families · Modules · Favourites (Recent lives in the palette). Filter chips by channel (glyph + colour). Footer hints: click to arm · drag into the world · 1–0 assign to slot · F favourite · L close.
- **Part card** (about 180 × 212, on a well with a warm radial glow): the part's 3D render (static thumbnail, a live turntable on hover), its hotbar number and favourite star if set, name (Unbounded 14), tag (Inter 12, fog), channel glyphs (in → out), class badge for XL critters.
- **Hover detail** (glass popover, 400 ms delay): 3 s demo clip with its timer, the 3D icon, name and tag, *Needs / Does* in plain English, one or two tips, "Assign to slot (1–0)".
- *As built:* cards and the hover detail show the static Blender thumbnail; the hover turntable and the demo clip aren't built (no `tools/bake` clips, PART_SYSTEM §6).
- Drag a card into the viewport to place, or click to arm the placement tool.

### 4.5 Inspector (docked right, glass)
Docked as a glass panel on the right (340 px), not a popover. It slides in on selection (`--t-med`) and out when nothing is selected; it isn't shown in a run. Header: the part's **3D render** + name + tag ("Ramp · Frame") + pin + delete. Collapsible sections (open state remembered per part type): **Properties** (from the part definition, using the property controls in PART_SYSTEM §2: sliders with a numeric field and a plain hint such as "steeper is faster", toggles, segmented choices) · **Skin** · **Transform** (position in cells, rotation, mirror toggles, size steppers, a **Snap to grid** toggle) · **Connections** (ports with channel glyph, linked-to part, unlink) · **Layer/Group**, then **Lock part** and a one-line plain-English note ("No ports. Balls roll down it and hand on their impact."). Labels and values under 14 px sit on wells (§2). Multi-select shows shared properties only; mixed values display "—".

### 4.6 Command palette (⌘K / Ctrl K)
A centred glass dialog (660 px). Fuzzy search over actions, parts, settings, worlds and help topics, grouped (Recent · Actions · Parts in scene · Help) with the matched letters highlighted. Part results show the part's 3D icon and what it's connected to; others show a line icon. Results show a key hint. `>` prefix = actions only, `@` = parts in the scene, `?` = help. Footer: ↑ ↓ move · Enter run · Esc close.

### 4.7 Radial menu (hold Q)
8 glass wedges around the selection: Mirror X · Rotate · Duplicate · Connect · Isolate · Lock · Group · Delete (red tint). The highlighted wedge uses the selected-state gradient; a small pill above shows the part's 3D icon, its name and "hold Q". Mouse direction selects; release to confirm. 150 ms open animation, centre "cancel" zone. *As built (UIFIX, D122):* it opens at the pointer, also with Keyboard building aids on (the aids used to take Q and open a sticky menu at the canvas centre that ignored the release). The part it acts on is fixed when it opens, so pointing across other parts doesn't change it. On Q's release: a highlighted wedge runs; a press shorter than 300 ms with nothing chosen keeps the menu open (sticky: arrows, Enter, Esc or Q); a longer hold released on the centre cancels. With the keyboard cursor on (or the pointer off the view), Q opens it sticky at the cursor as before (`ui/panels.ts` `radialKeyUp`, `ui/keyboard.ts`).

### 4.8 Run HUD
- **Partner / camera pill** (top left): who started the run ("Sam started the run") and the live camera ("Director cam").
- **K.O. counter** (top centre): "K.O." in Unbounded and the count in JetBrains Mono 44 px (ticks up with a spring), with "+6 this second" and the run time. *As built (UIFIX, D122):* it counts what the Cascade Report's K.O. counts (GAME_SPEC §8: distinct knock-on steps, one per part A → part B edge of the cause graph; `ui/feed.ts` `KoMeter`, `cascade.ts` `inCascade`), at the playhead, so a scrub back shows the count then. It used to count booms, breaks, pops and cuts (57 against the report's 256 in the 2026-10-25 playtest).
- **Event feed** (top right, 300 px): one glass panel of event toasts, each with the part's 3D icon, the event ("FUSE LIT", "TOPPLE TILES ×9") and a detail; repeats collapse to a count; 3 visible at most, the newest outlined in Ignition.
- **Run bar** (bottom, full width): the **timeline** row (time, event markers coloured by channel, bake-head shading with "baked 8.5 s", the playhead, the partner's playhead dot, total time; drag to scrub), then the controls row: ◀◀ (back 1 s) · ❚❚ / ▶ (60 px round Ignition) · ▶▶ (forward 1 s) · speed segment (0.1 0.25 0.5 1× 2 4) · **SIM 0.42×** amber badge (only when < 1×) with the "Bake & Watch" toggle · camera segment (Director / Orbit / Ride / Drone / Overview; *as built*, Director / Orbit / Ride / Overview: the Drone camera isn't built, GAME_SPEC §8) · **Stop**. Neither the run bar nor the feed changes size during a run (§8).
- **Countdown overlay:** a giant 3 · 2 · 1 in Unbounded with an Ignition ring, "Cancel (Esc)", and in multiplayer "started by Sam".

### 4.9 Cascade Report (end of run)
A slide-in glass panel (584 px) from the right, over the run bar (whose buttons and timeline dim; its text stays at full contrast, D96), with:
- a header (run number, "with Sam", close);
- the **Overreaction Score** card with a playful title tier ("Mild Kerfuffle" → "Absolute Catastrophe") and the progress to the next tier;
- the **longest chain** as a flow of part chips (3D icon + name + time) joined by channel-coloured arrows (animated on open). Click a chip to scrub to it; *as built (UIFIX, D122):* the chips are always live. During a run a chip pauses at its tick, even past the bake head (the worker bakes on to it). After the run, it starts a replay, keeps the report open over it and pauses at the tick. "Cascade Report (last run)" during such a replay shows the finished report, not the partial log;
- stats grid: K.O. count, run time, parts used, biggest boom (with its icon), peak simultaneous events, channels used (glyph row);
- actions: **REPLAY** (Ignition), Share card (image), Record clip. *As built (UIFIX, D122):* the header and the action row stay put and only the body between them scrolls (`.cr-body`), so the actions are on screen at 1920 × 1080 and in the compact layout, whatever the chain length.

### 4.10 Settings
Tabs: Graphics (tier, budget override, render scale, particle cap, **depth of field** in Build and Run (on by default; off with reduced motion), Unlimited Mayhem with a warning) · Comfort (reduce flashing, shake, hitstop, slow-mo, director cut rate, reduced motion) · Accessibility (**Reduce transparency**, colour presets, UI scale, captions, keyboard building aids) · Controls (remapping table, conflicts highlighted) · Audio · Multiplayer (nickname, show partner laser, ping sounds) · About (build, simVersion, diagnostics export).

*As built (`ui/settingspanel.ts`, `ui/settings.ts`):* tabs Graphics (including **Quality tier** 4 / 8 / 12 / 16 / 32 GB, applied at boot with a "reload to switch" toast, D90) · Performance · Comfort · Accessibility · Controls · Audio (master, music, SFX, mute) · Multiplayer · **World** · About. The World tab edits shared world state through `EnvUpdate` ops (synced and undoable): environment, gravity, air and feel, and "Fill the sink" in the Mega Kitchen (D98). Per-viewer settings are stored in the browser. *M5 (U5, W5):* the **Performance** tab's physics-thread count ('auto' = hardwareConcurrency − 3, clamped 2–12, or 0 / 2–16; `settings.performance.joltThreads`, read at boot and sent as the run's `joltThreads`, with a reload toast; the count in use shows in the tab, About and F9). The **World** tab: the Orbital Hangar and Moon Base (environments a world's size doesn't host are greyed and name the sizes that do; switching uses `envSwitchPatch`, so gravity and air come along in one undo step), **Zero-g zones** (`env.zones`, shown where the environment has zones), **Weather** (`env.wind` presets), **Base lights** on the Moon (`env.baseLights`) and **Sand, water and marbles** (`env.matter`, overriding `simFlags.matterGameplay`; the world card then says "Matter off"). The dialog is 760 px wide so its nine tabs fit one row. Hidden for having no consumer: Budget override, Particle cap, Unlimited Mayhem, Show partner laser.

### 4.11 Photo mode (F10) and Capture
Photo: UI hidden; left glass mini-panel with camera orbit, focal length, aperture, exposure, LUT, grid overlay, Capture (resolution presets up to 8K). Capture dialog: camera source, start/end time, resolution, fps, format, estimated render time, then a progress bar with cancel. *As built (M4, C4):* `ui/photo.ts` (F10; Esc or F10 exits; "Add key (K)" stores camera-path keys) and `ui/capture.ts` (Shift+F10, photo mode's "Record clip…" or Cascade Report › Record clip), both registered glass surfaces; details in RENDERING §13. *UIFIX (D122):* the estimated time is the draw (the live GPU time scaled by pixels) plus a per-frame residual measured on this viewer's earlier renders (`capture/estimate.ts`, localStorage), defaulting to the playtest's measured cost; it was about 2.7× low.

### 4.12 Multiplayer surfaces
- **Partner chip** (session bar; in a run, the partner / camera pill): avatar, name, colour ring, connection quality (direct/relay, RTT). Click: Jump to (F2), Follow (F3).
- **Chat:** bottom left above the parts tray, 320 px, on a well. Fades after 8 s; / to focus, Enter to send, Esc to blur. (Enter alone stays free for keyboard building and finishing paths.) During a run, only the last 3 lines are shown.
- **Ping radial** (hold G): Look · Help · Nice! · Boom incoming! In-world marker + edge arrow when off-screen.
- **Lock indicator:** a hovered part held by the partner shows their name tag; attempting an edit shakes the cursor and shows "Sam is holding this".
- **Toasts:** "Sam joined", "Sam paused", "Re-synced at 12.4 s", "The host updated the game. Reload".

### 4.13 Empty, loading and error states
| State | Treatment |
|---|---|
| Empty world | Centre hint: "Press 1 for a THUD, then click to place it", plus the "Try a demo machine" button |
| Loading world | Progress with phases (Downloading / Decoding / Building physics / Warming shaders) and a looping part turntable |
| Asset still streaming | Part shows as a blockout with a subtle shimmer. Never blocks interaction |
| Tier-gated | Lock icon + "Needs 16 GB tier" + Learn more |
| Recoverable error | Toast with an action ("Graphics restarted", "Reconnecting…") |
| Fatal | Full-screen card: what happened, what to try, "Export diagnostics" |

---

## 5. Interaction specs

### 5.1 Placement
1. Pick a part (hotbar key or Library). The cursor shows the ghost at the snapped transform, updated every frame (snap query ≤ 1 frame).
2. Snap feedback: compatible ports within range pulse in their channel colour, and a thin guide line joins the two ports. The snap-step badge shows the current step.
3. Blocked: the ghost tints `--kn-danger`, the reason shows at the cursor, and clicking does nothing (a soft error sound).
4. Click places. **Click-drag** places then rotates around the surface normal (15° detents, Shift = 5°).
5. After placing, the tool stays armed (place multiples). Esc or right-click disarms.

*As built (D117, stream DRAG):* steps 1 and 3 also govern **drag-to-move**. In the Select tool, press a part and drag past 4 px; a shorter press is still a click. The selection moves together if the part is in it; otherwise the part is selected and moves alone. The moved parts show as placement ghosts at the drop spot (the originals stay put until release) with the same grid snap, resting surface and red blocked tint. The function is shared: `ui/dragmove.ts` `overlapOf` / `snap` / `surfaceY`.
- **Modifiers and keys:** Shift moves vertically, Alt is free, Ctrl is 2.5 cm. Ctrl + wheel and PageUp / PageDown move the work plane mid-drag; a raised plane hides what's under it. R / T / Y turn the part.
- **Readout:** the tool badge shows the name and height ("PLANK · 1.2 m"), turns red with the reason when blocked ("Can't drop here: overlaps LAMP"), and a height stalk drops to the floor. Release drops; Esc or right-click cancels.
- **Undo and co-op:** one gesture is one `Batch` op, so one undo step. Links whose two ends moved take their waypoints along; the others re-route to the ghosts. The partner sees presence `ghost` ("Sam · holding PLANK") and the soft-locked parts.
- **Announcements:** "Picked up…", "Moved 3 parts", "Can't drop here: …".
- Click-drag to rotate while placing (step 4) is still not built.

*As built (D124, stream BUILDUX):* step 2's **port snap** is in for placing, dragging and carrying a paste (`ui/portsnap.ts`). A moved port within 0.5 cells (5 cm) of a compatible port (same channel, output ↔ input for Signal and Power, neither full) pulls the move onto it; a coincident snap that overlaps the snapped-to part is pushed out along that port's face normal, so the two parts end socket to socket, just touching. Compatible ports within 30 cm glow in their channel colour and the joined port pulses (no guide line: the ports end a few mm apart). A snap that would make the drop blocked isn't taken. Alt, or Settings › Controls › "Snap to ports", turns it off; the gizmo doesn't port-snap.

*As built (D123): box select, copy / paste / duplicate and mirror* (Select tool):
- **Box select** (`ui/boxselect.ts`): a left drag from empty space past 4 px draws a dashed marquee in the player colour; a part is in when the middle of its bounds is inside (a TUBE when all its points are). Plain replaces, Shift adds, Ctrl toggles; locked, hidden and section-boxed parts aren't pickable. The badge counts live ("Select · 3 parts"), and the result is toasted and announced ("3 parts selected"). Esc or a right click cancels. A press on a part is still drag-to-move and on a gizmo handle still the gizmo; right-drag orbits, and the other tools keep left-drag navigation.
- **Copy / paste / duplicate** (`ui/clipboard.ts`): Ctrl+C copies the parts with every link whose ends and vias are all copied; the clipboard lives in `sessionStorage` (it crosses worlds). Ctrl+V carries the clip as a §5.1 drag ghost (`DragMove.carry`: grid, resting surface, work plane, R, red when blocked; the badge reads "Paste 3 parts · 0.0 m"), and a click drops it. Ctrl+D lands the copy one grid step along +X, stepping on until it overlaps nothing, and selects it. One `Batch` each (one undo step, synced); RIFT / BUZZ / PING pairs copied whole become new pairs.
- **Mirror** (`ui/mirror.ts`): Alt+X / Y / Z mirror the selection across its bounds' centre plane. Parts with a mirror plane of their own become their mirror image (R' = M_a · R · M_b); handed parts keep their turn and are named in the toast. Refused when it would overlap a part outside the selection.

### 5.2 Gizmo
Arrows (move along axis), rings (rotate), corner cubes (resize, resizable parts only), plane squares (move in plane). Hover enlarges the handle by 1.2×. Values are shown live in a floating readout. Snapping follows §5.1 rules.

*As built (D117, `ui/gizmo.ts`):* on in the Select tool by default; **A** toggles it (G is the ping key), and so does the palette's "Gizmo" entry.
- **Layout:** it sits at the centre of the selection's bounds. Handles keep a constant screen size: arrows about 100 px, rings 124 px. Corner cubes appear only on a single ZONE, FORCE WALL or STASIS FIELD; while the gizmo is on they replace the face handles.
- **Drawing:** the renderer draws it on top of everything (`SceneItem.top`, about 0.003 ms GPU at 16 GB). Each axis has X / Y / Z letter chips and a colour palette per colour preset (CVD presets and High contrast; checked under each deficiency in `test/drag-gizmo.test.ts`). The hovered handle grows 1.2× and brightens, and the cursor changes per handle.
- **Snapping:** moves use §5.1's grid (10 cm, Ctrl 2.5 cm, Alt free). Rings use 15° steps, Shift 5°, Alt free, and edit the same Euler angles as R / T / Y (one part: its gimbal axes; several: world axes about the centre). Corners use the sizing handles' snap and limits.
- **Axes (D123):** **X** (remappable) and the palette's "Gizmo: local axes" switch the arrows and squares between world axes (default) and the primary part's own axes; the per-viewer choice is kept (`kn.gizmoAxes`). In local mode the squares turn with the part and the travel along each turned axis snaps (10 cm, Ctrl 2.5 cm, Alt free); the readout says "local X +0.20 m". The rings are the same in both modes.
- **Gestures:** a gesture starts after 4 px, so a click on a handle still selects. A ring that crosses a part gives way to the part. Rings seen edge-on aren't hit-tested. Every gesture previews as ghosts, refuses a blocked drop with the reason, and lands as one op. The readout is the tool badge ("X +0.40 m", "Yaw +45°", "width 0.8 × height 0.6 m").

### 5.3 Path tool
Click to add control points. Hover a point to show handles. Drag vertically with Ctrl to raise. Points snap to ports (start/end) and to surfaces. Enter finishes, Backspace removes the last point. Length and slope readout. Invalid segments (too steep for a Gutter, a Tube bend radius too small) show red.

### 5.4 Wire tool
Drag from a port: a curve follows the cursor, compatible ports glow, and the cable routes along surfaces on release. Hovering a wire shows both endpoints; Del removes it.

### 5.5 Undo feedback
Ctrl+Z briefly flashes the outline of affected parts in `--kn-fog` and toasts "Undid: Move 3 parts". In multiplayer, a skipped undo explains why (MULTIPLAYER §5.5).

---

## 6. Microcopy and localisation
- **Voice:** playful, brief, active. Parts and critters can be cheeky; errors are plain and helpful.
  - ✅ "Too heavy for this tier. Try Arena or smaller." ✅ "Biscuit is asleep. Make some noise!"
  - ❌ "Error 0x83: capacity exceeded." ❌ jokes inside error messages.
- **Strings:** ICU MessageFormat, keys like `ui.run.dilation`, `part.bangstick.does`. English (en-US) ships first. Pseudo-localisation (+35 % length, accents) runs in CI screenshots. RTL is not in v1. *As built:* strings are plain English in code and in `parts-data/src/cards.ts`; there's no message catalogue or pseudo-localisation yet.
- **Numbers:** locale-formatted, except the K.O. count and timers (JetBrains Mono, tabular figures).

---

## 7. Accessibility
- All DOM controls are keyboard-reachable in a logical order, with visible `--focus`, ARIA roles and labels, and live regions for toasts and chat.
- Colour is never the only signal: channels use glyphs, players use name tags, errors use icons + text.
- Reduced motion: no springs, no auto camera cuts, no slow-mo, instant panels, no Build/Run depth of field.
- **Reduce transparency** (Settings › Accessibility; on at first launch when the OS asks for it): every glass surface becomes solid Graphite (`:root[data-solid]`, §2) with the same layout, radii and contrast as the rest of the solid UI. It is also forced on the 4 GB tier and by the frame-budget fallback (§8); the setting shows "On (automatic)" then.
- Captions: event captions and critter emote text (Settings → Accessibility).
- Keyboard building aids: [ / ] cycle parts, arrows nudge by the snap step, Enter picks up or places, R/T/Y rotate 15° (Shift+R/T/Y the other way), Alt+X/Y/Z mirror (HOW_TO_PLAY §8).
- Targets: WCAG 2.2 AA for the DOM UI. Photosensitivity limits per GAME_SPEC §20.
- *As built (M4, stream U4; `ui/a11y.ts`, `ui/captions.ts`, `ui/keyboard.ts`, `ui/cvd.ts`, `ui/audit.ts`):* a WCAG 2.2 AA audit of 11 screens × 6 modes, every text case ≥ 4.64:1 after fixes (D96: run HUD text never fades below contrast); **captions** for sim events with a rate-limited ARIA live region (new event kinds get a caption line from each stream's notes); **full keyboard building** (16 of 16 scripted steps with no mouse); colour-blind-optimised channel palettes plus port glyphs; reduced motion stops keyframe animations too. *M5 (U5):* the audit re-ran on 16 screens × 6 modes (0 failing texts, floor still 4.64:1), keyboard-only building 21 / 21 steps, reflow 72 / 75. New UI: a **Tagged for BUZZ** switch (Inspector, palette "Tag selection for BUZZ"; loose non-critter parts, a warning over 2 kg) and an Amber tag glyph over tagged parts in Build and Run (the item BUZZ is after pulses, from `critterTargets()`); **sizing handles** for parts with width / height / depth props (ZONE, FORCE WALL, STASIS FIELD; Shift+= / Shift+− by keyboard; `ui/volumetool.ts`); **pair chips** and dashed pair lines for RIFT GATES, BUZZ BEACON and BUZZ, with auto-pairing on placement (`ui/m5tools.ts`); the GRABBER **zone tool** (point zone A / B, rings and A / B chips); SINGULARITY's 4-per-world cap (`MAX_PER_WORLD`, `ui/buildtools.ts`); captions for every A5 and B5 event; the capture preview plays with sound. The first playtest log is `playtests/2026-10-25.md`.

---

## 8. UI performance budgets
- UI work on the main thread ≤ 2 ms per frame average, ≤ 4 ms peak. No per-frame re-renders of whole panels; the K.O. counter and the run bar's timeline update at a throttled rate (v1.0 said Solid signals at 15 Hz; as built, plain DOM updates in `ui/runbar.ts` / `ui/hud.ts`).
- Library: virtualised grid; thumbnails lazy-loaded (WebP 128², then 512² on hover). Tray tiles use the 128² render at 1× and the 512² render on HiDPI screens.
- Outliner: virtualised tree (1M parts are represented through groups; flat lists are capped at 5,000 rows with "show more").
- **Glass** ([D77](dev/DECISIONS_2026-10-24.md)). The browser compositor blurs the WebGPU canvas behind every glass surface each frame, so glass has a GPU cost outside the renderer's budget:
  - at most **6** glass surfaces (a `backdrop-filter`) are visible at once (§3);
  - blur radius ≤ **24 px** (the token is 22 px);
  - no glass surface animates its size during a run (fades and slides only; a size change re-allocates the blur target);
  - **Fallback rule:** the solid surfaces (§2) replace glass on the 4 GB tier, when Reduce transparency is on, and when UI frame time goes over budget. UI frame time is the main-thread UI work above plus the compositor cost of glass, measured at boot and after every tier change by drawing 30 frames with and without blur. If it stays over 4 ms for 2 s, the UI switches to solid, shows a toast ("Switched to solid panels to keep the frame rate") and stays solid until the next launch or tier change.
  - *As built (`GlassManager`, `apps/game/src/ui/glass.ts`; [D113](dev/DECISIONS_2026-10-24.md)):*
    - **Probe** (`probe()`, at boot and after a tier change): it first waits, changing nothing on screen, until frame times are steady: three 20-frame rounds whose spread is within 25 % (or 2 ms). It checks every 3 s, up to 10 times, so boot-time texture streaming and shader compiles can't pass for glass cost. Then it runs one **solid → glass → solid** measurement of 20 frames per round, by frame interval. The glass cost is the glass round minus the mean of the two solid rounds either side (`glassCostFrom`; 0 when it hides in vsync). A probe that stays noisy keeps its smallest estimate, since load only inflates it.
    - **Budget** (`FrameBudget`): each frame's UI work plus the estimated glass cost feeds an average (EMA, α 0.1). Over 4 ms for 2 s trips it.
    - **Re-check:** if the trip is down to the glass estimate (the UI work alone is under budget), the glass is re-measured once before giving up on it. Only a second trip, or a trip from the UI work itself, switches to solid with the toast, until the next launch or tier change.
    - Tests: `apps/game/test/ui-logic.test.ts`.
