# M3 notes: stream U3 (Glass Lab UI)

2026-10-24. Scope: PRODUCTION §2 M3 Tools/UI, the Glass Lab rebuild of the HUD to [UI_UX v1.1](../UI_UX.md) and the approved mockups ([KNOCK-ON Final UI Mockups](https://claude.ai/artifact/AH1uPc4UVH822qNvEV4CH4), six boards, read from the artifact's files), with D77 (glass), D80 (tint .64), D84 (radii 16/10; Esc/Backspace) and D85 (32 GB tier). Contract 5 in [M3_PLAN](M3_PLAN.md).

Screenshots (1440×900 unless noted, local test server and world, Tinker Lab set): `art/style-samples/ui_m3_{build, inspector, outliner, library, palette, radial, settings, solid, lobby, run, cascade_run, cascade}.png`, plus `ui_m3_compact.png` (1180×760).

## What's built

| Area | Where | Notes |
|---|---|---|
| Layout and HUD | `ui/hud.ts` (new), `index.html`, `styles.css` (rewritten) | `buildHud(net)` replaces M2's `buildUi` in main.ts, with the same interface plus `attach()`, `hotbar()`, `escape()`. Six glass surfaces in Build. |
| World card | `ui/hud.ts` | Top left, 320–420 px. Logo, title, a well with preset · parts and the save state (`saved` / `saving…` / `offline · n changes queued`), undo / redo, environment chip (gravity, air; opens Settings › World). The Outliner opens below it **inside the same surface**. |
| Session bar | `ui/hud.ts` | 48 px. Partner chip (avatar, name, RTT), BUILD │ RUN (Run = LET IT RIP, Build = Stop), Save (`save` to the host), Share (copies the session link until S3's share links land), Ctrl K, Menu (Settings, Worlds & lobby, Library, Cascade Report, shortcuts, reset hotbar, Clear world with confirm and undo). |
| View rail | `ui/hud.ts` | Orbit / Pan / Zoom set what a **left-drag** does (right-drag orbits, middle pans, the wheel zooms, as before); Normal / X-ray (again for "all") / Section; Cutaway; Outliner. The active item uses the selection blue. |
| Inspector | `ui/inspector.ts` (new) | 340 px, docked right, slides in on selection. Header: 3D render, name, "tag · family", pin, delete. Properties / Skin tabs. Collapsible sections (open state remembered per part type): Properties (slider + numeric field + plain hint, segmented choices, switches), Transform (X/Y/Z in 10 cm cells, rotation ±15°, Snap to grid, Anchored), Connections (glyph, port, linked parts as unlink chips), Layer / Group (BuildTools' section). Then Lock part and a plain-English note. Small text sits on wells. |
| Transport pill | `ui/hud.ts` | Reset · step back · the 80 px **LET IT RIP** (Ignition, Void glyph and label, "Space") · step forward · sim speed (0.1 … 4, applied to runs this player starts). Countdown turns it into CANCEL. |
| Parts tray | `ui/tray.ts` (new) | Replaces the dock. Family tabs (spec list plus Future and Critters, which parts-data now has) · search · L. 3D icon tiles; in "All parts" the first ten tiles are the **hotbar 1–0**: drag any tile (tray or Library) onto one to assign it, right-click clears, keys 1–0 follow it. Click arms, drag into the viewport places, hover opens the part card. Modules tab places modules. |
| Hotbar, favourites | `ui/hotbar.ts` (new) | Per viewer (`kn.hotbar`, `kn.favourites`). Defaults to the mockup's ten (THUD … BANGSTICK). Assigning a part that's already on the bar swaps the two. |
| Library | `ui/panels.ts` | 780 px glass panel in the Inspector's place. Header with counts and search; tabs; channel filter chips; 180 × 212 cards (3D render on a warm well, hotbar number, favourite star, name, tag, glyphs in → out); footer hints. 1–0 assigns and F favourites the hovered card. Hover card (400 ms): big render, Needs / Does, tips, "Assign to slot" keys. Modules tab kept. |
| Command palette | `ui/panels.ts`, `ui/fuzzy.ts` (new) | 660 px, modal. Groups Recent · Actions · Parts in scene · Parts · Settings · Help, highlighted letters, 3D icons for parts, key hints. `>` actions, `@` parts in the scene ("connected to …"; Enter selects and frames), `?` help. Adds the mockup's Connect ports / Show all connections / Unlink the selection's connections. |
| Radial | `ui/panels.ts` | SVG glass wedges with a masked blur ring, selection-blue highlight, red Delete, centre cancel, pill with the part's 3D icon and "hold Q", 150 ms open. |
| Run HUD | `ui/runbar.ts` (rewritten, same constructor) | Partner / camera pill, K.O. counter ("+N this second", time), event feed (3 rows, 3D icons, repeats collapse to ×n, newest outlined in Ignition, toasts land here during a run), run bar (timeline with channel markers, bake shading and "baked n s", playhead, scrub; back / play-pause / forward; speed; SIM badge; SOLO badge; camera segment; Stop · Backspace). Fixed sizes, 15 Hz updates; after 2 s idle the pill and feed fade out and the counter and bar drop to 60 %. |
| Cascade Report | `ui/cascadepanel.ts` | 584 px glass, in the Inspector's place (over the dimmed run bar during a run). Header "run n · with Sam"; score card with tier and progress; chain chips with 3D icons, times and channel arrows (click scrubs during a run); stats incl. biggest-boom icon and the channel glyph row; REPLAY (Ignition), Share card, Record clip (stubs as in M2). |
| Lobby | `ui/lobby.ts` (new) | Over `tinker_lab_lobby.png`: wordmark, identity pill (you, tier, host), Live session (JOIN / BACK TO BUILDING), Your worlds (search, sort, open), New world (size with tier locks, environment with **Tinker Lab default for Desk and Room**, title, CREATE). Host-only actions say so. Opened from the menu, the palette or `?lobby`. |
| Glass system | `ui/glass.ts` (new) | Registry of every glass surface, `planGlass` (≤ 6 blurred; a modal keeps the only blur, others become solid wells), `FrameBudget` (UI cost over 4 ms for 2 s trips), `GlassManager` (`:root[data-solid]`, boot / tier-change probe, per-frame UI timing). |
| Reduce transparency | `ui/settings.ts`, `ui/settingspanel.ts` | `settings.accessibility.reduceTransparency` (first launch follows `prefers-reduced-transparency`). Forced on the 4 GB tier and by the frame-budget fallback, shown as "On (automatic)". |
| Depth of field | `ui/settings.ts`, `ui/settingspanel.ts` | **`settings.graphics.dof`** (default on), toggle in Settings › Graphics. L3: read `dofEnabled()` from `ui/settings.ts`, which also turns it off under reduced motion (UI_UX §7), and subscribe with `onSettingsChange`. |
| 32 GB tier (D85) | `ui/settings.ts`, `ui/settingspanel.ts`, `ui/lobby.ts`, `ui/hud.ts` | "32 GB (Max)" in Settings › Graphics; `merge` accepts 32; `tierLabel()` shows "32 GB" in the lobby pill, size locks and the partner chip. |
| Environment picker | `ui/settingspanel.ts` | Adds `'tinker'` "The Tinker Lab" (first). Palette and Settings › World send `EnvUpdate`. |
| Icons | `ui/icons.ts` (new), `vite.config.ts` | 3D renders at `/parts/<art>/<art>.thumb.webp` (art name from the def: COG sizes have their own), line icon by family as the fallback, remembered per session. SVG channel glyphs for all 12 channels. |
| Contrast CI check | `test/contrast.test.ts` (new), `ui/contrast.ts` (new) | See "Contrast" below. |

## Part icons

- **Vite plugin `partThumbs()`** (`apps/game/vite.config.ts`): in dev it serves `/parts/<x>/<x>.thumb.webp` from `art/style-samples/icons/` unless the pipeline has built `assets/build/parts/<x>/<x>.thumb.webp`. On build it copies the icon set into `dist/parts/<x>/` without overwriting pipeline renders.
- **24 icons rendered**, the parts with built art but no icon: big_top, burning_glass, cog_l, cog_s, cork_blaster, delay, dynamo, fishbowl, flap, fuzz, gotcha_box, hamster_drive, pedal_rig, pig_iron, puffer, punchline, scoop, sprong, suncell, t_plunger, torch, trap_box, turbine, vortex.
  - Command: `blender -b --factory-startup -P tools/blender/render_thumbs.py -- <out> --types … --size 256 --warm`, the same rig and size as the existing 28.
  - They were copied into `art/style-samples/icons/` without overwriting, so the set is now 52.
  - Parts without built art (the M3 parts E3a hasn't exported, and critters, which the rig skips) show the family line icon until their render exists.

## Glass budget (measured)

`GlassManager` re-plans on every panel change. The number blurred is on `:root[data-glass]`.

| Screen | Visible glass | Blurred |
|---|---|---|
| Build HUD, nothing selected | world card, session bar, view rail, transport, tray | 5 |
| Build HUD + Inspector | + Inspector | 6 |
| Library open | the Library replaces the Inspector | 6 |
| Cascade Report after Stop | the report replaces the Inspector | 6 |
| Radial menu over the full Build HUD | 7 surfaces | 6 (the view rail is demoted to a solid well) |
| Palette, Settings, a dialog | modal | 1, the others solid wells under a scrim |
| Run HUD | pill, K.O., feed, run bar | 4 |
| Run HUD + Cascade Report | the feed hides under the report | 4 |
| Lobby | identity, live session, worlds, new world | 4 |
| Reduce transparency / 4 GB / budget fallback | all solid | 0 |

Blur is `blur(22px) saturate(1.4)` everywhere (≤ 24 px). Run surfaces have fixed sizes and only fade or slide.

## Contrast (D80; the CI check is `apps/game/test/contrast.test.ts`)

The test reads the `:root` tokens from `styles.css` and composites each registered glass surface over **pure white** (a uniform white stays white under blur and saturation). It fails if any text it lists is under 4.5:1.

| Text on … over white | Ratio |
|---|---|
| Paper on the glass tint (.64), every surface | **4.93:1** |
| Paper on a well inside glass (.64 + .72) | 12.55:1 |
| `--text-2` (#C9CFDB) on a well inside glass | 9.09:1 |
| Paper on a key hint (`--kbd-bg` on .64 glass) | 10.97:1 |
| Paper on a stand-alone .72 well (toasts, chat) | 6.58:1 |
| `--text-2` on a stand-alone .72 well | 4.77:1 |
| Paper / `--text-2` on the pop surface (menus, part card) | 14.66 / 10.62:1 |
| Paper / `--text-2` on solid Graphite (fallback) | 16.13 / 11.68:1 |
| Reference: Paper on the old .58 tint | 4.01:1 (fails, as UI_UX §2 says) |

Rules that keep it true:

- Text drawn straight on glass is Paper only.
- Secondary text (`--text-2`, never Fog) and small text sit on wells. Controls have well backgrounds.
- Key hints sit on a dark chip.

**Finding: the selected-state gradient.** White text on `#3E86E6 → #2A66C4` measures 3.65:1 at the top stop, 4.47:1 mid-gradient and 5.53:1 at the bottom. It carries 12–13 px semibold labels (tabs, segments, palette rows), so it's under 4.5:1 for most of its height. I kept the spec value. If AA matters there, a top stop of **#3373D0** gives 4.66:1 and looks almost the same. That's one token (`--kn-select`), and the test has an informational line for it.

## UI frame cost (rule 7: measured)

**Method:**

- Test environment: Chrome headless with a WebGPU adapter, `--disable-gpu-vsync --disable-frame-rate-limit`, using a local 49-part Tinker Lab world.
- Glass cost: rAF frame intervals with `:root[data-solid]` on vs off, the same scene and camera, the cursor still. 12 alternating pairs of 240 frames each; reported as the median of the paired p50 differences, with the IQR.
- Main-thread UI work: `GlassManager.measure` around the HUD's per-frame calls (`setRunState`, `setHud`, `updateOverlay`, `runBar.update`, `inspect`).
- Caveat: other streams' GPU work was running on the same machine, so the uncapped frame times are noisy (p95 2–24 ms).

| Screen | 1440×900 | 2560×1440 | 3840×2160 |
|---|---|---|---|
| Build HUD (5 blurred) | **+0.19 ms** [0.15…0.24] | −0.01 [−0.06…0.03] | +0.21 [−0.24…0.81] |
| Build + Inspector (6) | **+0.14 ms** [0.05…0.16] | +0.04 [−0.09…0.08] | −0.06 [−0.38…0.21] |
| Library (6) | +0.11 [−0.15…0.19] | −0.05 [−0.17…0.01] | −0.74 [−2.51…0.63] |
| Lobby (4, full-screen image) | **+0.23 ms** [0.16…0.26] | **+0.43** [0.20…0.53] | −0.01 [−1.12…0.35] |

- **Glass compositor cost.** About 0.1–0.25 ms per frame at 1440×900, and 0.4 ms for the lobby at 1440p. At 4K the cost is inside the background-load noise: from the IQRs it's at most about 0.8 ms. It isn't resolvable on a shared machine.
- **Main-thread UI work.** 0.007–0.022 ms per frame on average in every screen and resolution; the peak was 0.5 ms (one 3.3 ms outlier during a boot-time probe frame). Moving the pointer: 0.007–0.019 ms on average. The budget is 2 ms average and 4 ms peak.
- **Runtime guard.** At boot (and after a tier change) the probe does 30 frames solid and 30 with glass. On the test system it measured 0–0.84 ms (vsync-bound or uncapped). If UI work plus glass stays over 4 ms for 2 s, the UI switches to solid with the toast. Verified by injecting a 10 ms glass cost: it trips after 2 s, Settings shows "On (automatic)", and a tier change clears it.

## Shared-file edits (Edit tool only)

- **`apps/game/src/main.ts`:**
  - Import and `buildHud(net)` in place of `buildUi(net)`. The old `buildUi`, its inspector and `escapeHtml` were removed (≈ 250 lines, in four exact-text edits).
  - `ui.attach({...})` after `ui.setTool`.
  - Digit keys go through `ui.hotbar(i)`.
  - **D84 Esc:** `ui.escape()` closes the menu, lobby, part card or Library first. Then Esc cancels the wire or path, then cancels the countdown or stops the run, and otherwise returns to Place. Backspace still stops.
- **`apps/game/vite.config.ts`:** `partThumbs()` plugin (above). It also imports `mkdirSync` and `readdirSync`.
- **Owned files rewritten:** `index.html` (no top bar or dock; the HUD skeleton) and `styles.css` (tokens per UI_UX v1.1 with the D80 tint, plus every surface). The fonts are local from `assets/src/lib/fonts` (Unbounded Bold, Inter Medium, JetBrains Mono Bold).
- **`ui/buildtools.ts`:**
  - The top-bar toolbar is gone. The rail and world card subscribe with `onView`, and use `viewMode()`, `xrayShown`, `envLabel()` and the public `toggleSection()`.
  - The Outliner mounts in `#worldcard .wc-outliner` and remembers its open state (`kn.outliner`). It starts folded, as on the Build HUD board.
  - The Inspector hook appends into its section.
  - The Cascade host adds `partType` and `runLabel`.
  - The palette gains Reduce transparency, DOF, Accessibility and Graphics entries.
- `inspectorHooks` now lives in `ui/inspector.ts` and is re-exported from `buildtools.ts`.

## Board-by-board against the mockups

| Board | Match | Differences (why) |
|---|---|---|
| **Build HUD** | World card, session bar, view rail with Normal / X-ray / Section, docked Inspector with Properties / Skin tabs, the transport pill with the 80 px LET IT RIP and sim speed, and the parts tray with family tabs, search and 1–0 hotbar tiles, all as drawn. | **World card:** blurb is preset · parts (worlds have no description field); no inline rename (there's no world-title op in format; needs S3 or format). **Radii:** 16 / 10 per D84, not the mockup's 20. **Session bar:** 48 px tall with inline icon + label, per the spec. **Rail:** adds Cutaway and Outliner. **Inspector:** no mirror toggles (`PartFlag.Mirror*` exists, but neither the sim nor the renderer honours it, so a toggle would lie); Skin is a placeholder until the D78 texture pass; Lock part is a real flag op. |
| **Library** | 780 px panel, header with counts and search, tabs, channel chips, 4-column cards with renders, slot numbers, stars and glyph rows, footer hints, and the hover card with Needs / Does / tips / assign row. | **Hover card:** a static 3D render, not a demo clip or live turntable (no clip pipeline yet); it's a solid well (no blur) so the Library screen stays at 6 blurred surfaces. **Placement:** the panel sits under the session bar and above the tray, as the spec keeps them on screen. |
| **Palette + radial** | Centred 660 px palette with grouped results, highlighted letters, 3D icons for parts, prefixes and footer. Radial with 8 glass wedges, blue highlight, red Delete, cancel centre and the icon pill. | **Radial slots:** the set is main.ts's M2 slots (Rotate, Duplicate, Connect, Anchor, Lock, Inspect, Library, Delete), not the mockup's Mirror X / Isolate / Group. Mirror isn't supported, and changing the slot list is a main.ts gameplay change. The icon and style map already covers the mockup's labels. |
| **Run HUD** | Partner / camera pill, K.O. with "+N this second", 3-row feed with renders and ×n, the run bar with markers, bake shading and "baked n s", playhead, transport, speed, camera segment and Stop. | **Camera segment:** no Drone (CameraRig has no drone mode). **Bake & Watch:** no toggle (RunController has none); the SIM badge shows "SIM waiting" when it waits. **Playhead:** no partner playhead dot (the playhead is shared). **Stop hint:** shows Backspace, per D84. |
| **Cascade Report** | Header with run number and partner, score card with tier and progress, chain chips with renders, times and coloured arrows, 6-stat grid with the biggest-boom icon and glyphs, REPLAY / Share card / Record clip. | **Actions:** in one row so the report fits between the session bar and the tray in Build. **Stubs:** Share card and Record clip stay "(soon)", as in M2. |
| **Lobby** | Backdrop render, wordmark and tagline, identity pill, Live session card, Your worlds grid with search and sort, New world with sizes, environments, title and CREATE. | **World tiles:** coloured placeholders (no world thumbnails exist yet). **Demo tile:** no "Try a demo machine" tile (no demo-world loader yet; S3's benchmark worlds could feed it). **Not at boot:** the lobby doesn't open by itself, which keeps the current boot-into-the-world flow and other streams' automation. Open it from Menu › Worlds & lobby, the palette, or `?lobby`. |

## Verification

- **Typecheck:** `pnpm typecheck` is clean (all packages, at hand-back time).
- **Tests:** `npx vitest run apps/game` passes, 6 files and 71 tests. New:
  - `test/contrast.test.ts`: colour maths, the D80 check for 20 surfaces, the stand-alone wells and solid fallback, and the accents.
  - `test/ui-logic.test.ts`, 19 tests:
    - the glass budget (6 in Build, demotion order, modal, run, lobby);
    - the frame-budget trip, reset and spike smoothing;
    - hotbar swap, persistence and de-duplication, and favourites;
    - palette prefixes, ranking, highlights, grouping and scene hiding;
    - the K.O. window and feed collapse and expiry.
- **In Chrome:** a local test server (`KNOCKON_PORT=8833`, scratch data) and local Vite (:5233), driven by a headless Chrome over CDP.
  - The shared Browser pane is used by other streams, so it wasn't reliable for this.
  - All checks below passed.
- **Interactions (24 checks):**
  - tray click arms and places;
  - dragging a tile into the viewport places it;
  - dragging onto slot 1 assigns it, and key 1 follows;
  - rail X-ray (links → all), Section, Normal, Cutaway, Outliner inside the world card;
  - left-drag orbits;
  - D84 Esc order (menu → Library → tool);
  - Settings › World Tinker Lab sets `env.environment = 'tinker'`;
  - Reduce transparency: `data-solid`, no `backdrop-filter`, then back;
  - DOF default and `dofEnabled()`;
  - chat;
  - never more than 6 blurred surfaces.
- **Inspector and two players (14 checks):**
  - Inspector: opens with the render; the numeric field edits a property; X moves 2 cells with snap; rotation steps 15°; section state remembered per type; Layer / Group present; Lock part locks and deselects.
  - Two players: partner chips on both; the partner's cursor marker; chat both ways; ping toast.
- **M2 regression (12 checks):**
  - Shift-click multi-select; Ctrl+G, then undo and redo;
  - save a module through the palette and the in-app dialog, then place it from the tray's Modules tab;
  - Outliner + Layer;
  - draw a section box from the rail, Enter finishes;
  - Library Modules tab.
- **Fallbacks (8 checks):**
  - tier 4 gives solid and "On (automatic)";
  - 32 GB (Max) offered, persisted, and shown in the lobby;
  - the frame-budget trip gives solid and the toast;
  - a tier change clears it.
- **Run:** a real run on a seeded world (the part demos for TOPPLE TILES, BANGSTICK, THE BUTTON, BRIK, HELIO and SLOPE). Countdown → Run HUD → the Cascade Report auto-opens when the cascade goes quiet → Stop → the report in Build.
- **Bug fixed along the way:** Enter in the palette ran the command during keydown. A command that opens a dialog then received the same Enter's keypress and submitted the dialog at once (an unnamed module). It now prevents the default and runs after the key event.

## For other streams

- **L3:**
  - `settings.graphics.dof` / `dofEnabled()` (`apps/game/src/ui/settings.ts`).
  - The WGSL module "detail" fails to compile: `detail:14:20 mixing '*' and '^' requires parenthesis` (`u32(q.x) * 1597334677u ^ …`). It floods the console with invalid-pipeline errors.
- **G3:** `Buffer "debris.args" usage (CopySrc|Storage|Indirect) doesn't include CopyDst`, from a write to that buffer.
- **A3 (resolved during this session):** for a while `Machine.step` threw `this.x.stageSpawn is not a function` and no run advanced. It was fixed by the time of the final run tests.
- **S3:**
  - `DEFAULT_ENV` (format) is still `'studio'`. The UI already defaults new Desk and Room worlds to `'tinker'` through the lobby.
  - Share links: the session bar's Share copies the session URL until `apps/game/src/share.ts` exists; then it should call that.
- **Everyone:** `apps/game/src/ui/glass.ts` `GLASS_SURFACES` is the registry. A new frosted surface must be added there (with its tint and the text it carries), or the CI contrast check won't cover it and the budget won't count it.

## S3 integration: share links, Backlot terrain, Bake & Watch (follow-up)

Wired after S3 landed (`docs/dev/M3_NOTES_S3.md`). Verified on a local test server (:8833) with local Vite and headless Chrome; the 20 checks below all pass.

| Area | Where | What |
|---|---|---|
| **Share** | `ui/hud.ts`, `vite.config.ts` | `bindShare(net)` at boot. The session bar's Share opens a popover: `shareWorld()` makes the link, which shows with **Copy** and a line saying whether it's inline (`#m=`, nothing stored) or stored on this host (`#s=<id>`). **Open a link** takes a pasted link: this host's links go through `openShareLink`, other hosts' through `importFromHost`. Worlds join the host's list (the host switches to them; a guest is told to ask the host), and modules go into the Library. A share link in the URL (on load or on hashchange) asks "Open the shared machine from this link?", opens it, and strips the hash. The dev config now proxies `/share` to the host, as the bench config does. |
| **Terrain** | `main.ts`, `ui/tray.ts`, `ui/hud.ts`, `ui/terrainpick.ts` | main.ts creates `new TerrainView(renderer)` and each frame calls `set(doc.activeTerrain(), doc.terrainRev)` (a no-op unless the terrain changed). It sets `renderer.drawFloor = !terrainView.active` and skips the Studio cove while terrain is drawn. The tray gets a **Terrain** tab, shown only when the world has terrain: Raise / Lower / Flatten / Smooth tiles, radius (1 / 3 / 8 / 20 m) and strength (Soft / Normal / Strong) feeding `TerrainBrushTool`. While a brush is armed, a left-drag on the ground ray-marches the heightfield for the hit point and submits `TerrainStroke` ops. The capture-phase handler stops main.ts placing or selecting, and the badge reads "Sculpt · Raise · 8 m". Undo works per stroke; Esc, picking a part, or starting a run disarms the brush. |
| **Camera** | `ui/hud.ts` | Warehouse, Arena, Megastructure and any Backlot world open on the preset's camera (`presetOf(preset).camera`), lifted onto the terrain height at the target. Without this the Studio framing put the eye under the Arena lot. Desk and Room keep, or go back to, main.ts's Studio framing. |
| **Bake & Watch** | `ui/runbar.ts` | The mockup's pill in the run bar: a **SIM 0.42×** amber badge when `run.simRate < 0.95` while playback waits, and a **Bake & Watch** switch (`run.bakeAndWatch(true)` / `run.cancelBake()`). While baking, a readout shows "Baking ▬ 8.3 s · 2 s left" with **Play now**; the tooltip carries the target, the rate (× real time) and the keyframe MB. When the bake finishes, playback resumes. All of this is inside the fixed-size run bar. |
| **Lobby, Settings** | `ui/lobby.ts`, `ui/settingspanel.ts` | Sizes, tier gates and each size's environments come from S3's `PRESETS`, and defaults from format's `defaultEnvironment` (Megastructure → Backlot). The Backlot is enabled (Arena and Megastructure only); options a size can't host say which sizes can. Settings › World lists The Backlot. |

**Checks:**

- **Share:**
  - an inline link (882 chars) with its explanation;
  - Copy works;
  - a host-stored `#s=` link;
  - a pasted host link imports and switches;
  - a link in the URL prompts and opens.
- **Backlot:**
  - Lobby › Arena offers the Backlot and creates an Arena on the Backlot;
  - terrain is drawn and the floor is off;
  - the Terrain tab shows;
  - Raise armed: four drags gave terrainRev 0 → 21 and placed no parts;
  - Ctrl+Z undoes a stroke; Esc disarms.
- **Bake & Watch:**
  - the toggle starts a bake, with the readout and ETA;
  - the bake ends early once the machine is still (≈ 87–92× real time on this world), then playback resumes.
- **SIM badge:** checked by pinning `simRate` to 0.42. A world this small sims faster than real time on the test system, so it can't show dilation by itself.
- **Regression:** the 24 interaction checks pass again; `pnpm typecheck` is clean; `npx vitest run apps/game` passes 7 files and 75 tests.

**Screenshots:** `art/style-samples/ui_m3_{share, lobby_backlot, backlot_sculpt, bake, simrate}.png`.

**Placement on the Backlot (also done):** `ui/terrainpick.ts` `terrainHit()` (ray vs heightfield: march, then bisect) serves the sculpt tool and main.ts's `pick()`. With no part under the cursor, the cursor lands on the terrain before the flat work plane, and the placement ghost sits on it (two small main.ts edits, commented U3). Checked: a THUD placed on the Arena lot sits at y 4.82 m over ground 4.71 m (its radius is 0.11 m).

**Not done:**

- **Brush ring:** there's no on-ground brush ring yet; the badge gives the radius.
- **Camera range:** the wheel clamp in main.ts (80 m) is under Megastructure's 104 m preset distance.
