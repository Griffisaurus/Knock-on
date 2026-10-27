# M2 notes: stream D (tools/UI)

2026-10-24. Scope: PRODUCTION §2 M2 Tools/UI (outliner, modules, layers, section box, settings, Cascade Report v1), plus the X-ray and cutaway toggles and the environment picker (M2_PLAN contracts 4 and 5).

## What's built

| Area | Where | Notes |
|---|---|---|
| Ops and format | `packages/format/src/{model,ops,world,module}.ts` | New ops `GroupSet` (7), `ModuleSave` (8), `ModulePlace` (9) and `LayerSet` (16). There are GRUP and MODL sections, and `.knockmod` encode and decode. |
| Apply and invert | `packages/docstore/src/world.ts` | `WorldDoc` gains `groups`, `layers` and `modules`. Every new op is validated, atomic and invertible, so undo and redo work. |
| Host | `apps/host/src/session.ts` (2 lines) | `createdIds` covers `ModulePlace` (namespace check and counter bump). `mutatedIds` covers `GroupSet` members (lock check). |
| Outliner | `ui/outliner.ts` | See "Outliner" below. |
| Layers | `ui/outliner.ts`, `ui/organise.ts` | See "Layers" below. |
| Selection | `ui/selection.ts` | Multi-select of parts and links, shared by the 3D view, the Outliner and the Inspector. In the 3D view, Shift- or Ctrl-click toggles. Del removes the whole selection as one op. |
| Inspector | `inspectorHooks` in `ui/buildtools.ts` | Adds a Layer / Group / Hide / Lock section. With several parts selected, it applies to all of them and shows "—" for mixed values. |
| Groups | `ui/buildtools.ts` | Ctrl+G groups the selection, Ctrl+Shift+G ungroups, and Ctrl+L locks. H hides the selection. |
| Modules | `ui/modules.ts`, the Library's Modules tab (`ui/panels.ts`) | See "Modules" below. |
| Section box | `ui/sectionbox.ts` | See "Section box" below. |
| X-ray, cutaway | `ui/buildtools.ts` | See "X-ray and cutaway" below. |
| Settings | `ui/settings.ts` (model), `ui/settingspanel.ts` (panel) | See "Settings" below. |
| Environment picker | Settings › World, the top-bar chip, the palette | Sends `EnvUpdate {environment: 'studio' \| 'kitchen'}`. |
| Cascade Report v1 | `src/cascade.ts` (logic), `ui/cascadepanel.ts` (panel) | See "Cascade Report v1" below. |
| Dialog | `ui/ask.ts` | An in-app prompt and confirm that replace `window.prompt` and `confirm`. Those block the page and automation. |

### Outliner

- Shows a tree of layers, then groups (nested by parent), then parts, followed by a Links section.
- Each row has an eye and a lock. Clicking a row selects it; Ctrl-click toggles and Shift-click selects a range.
- Double-click a layer or group name to rename it. Double-click a part to frame it in the view.
- Drag parts onto a layer or group row to move them there. There's also a search box.
- Flat lists are capped at 5,000 rows, with a "show more" button.
- Ctrl+\ or « folds it away. It starts folded below 1,280 px wide.

### Layers

- Create, rename, delete, show or hide, and lock layers. The ● marks the active layer: new parts and placed modules go there.
- ⇠ moves the selection to a layer.
- Hidden layers and parts aren't drawn or picked in build mode. Locked ones can't be picked, selected or edited.
- Every change is an op, so the partner sees it.

### Modules

- **Save:** saves the selection as a module.
  - Its origin is the centre of the footprint, at the selection's lowest point.
  - Internal links come along. Links that cross the selection boundary become exposed ports.
- **Place:** shows a ghost.
  - R turns it a quarter turn, Shift-click keeps placing, and Esc cancels.
  - Placement reserves `count` ids from the player's counter.
- **Export / import:** export downloads a `.knockmod` file; import uses a file picker. Both are validated, and a module is never partially loaded.
- **Rename, delete:** both are available from the module's card.

### Section box

- Drag out a box on the work plane, then drag any of the six face handles. Enter or Esc finishes; the palette clears it.
- Calls `renderer.setSectionBox`. Without that call, the build scene and picking skip parts outside the box.

### X-ray and cutaway

- X-ray: a top-bar button cycles off / links / all, or you can hold Tab. Calls `setXray`.
- Cutaway: a toggle. Calls `setCutaway`.
- Both are also in the palette. The selection outline goes to `setSelection`.
- Each call is guarded, and the first use toasts if the renderer is missing it.

### Settings

- **Tabs:** Graphics, Comfort, Accessibility, Controls, Audio, Multiplayer, World, About.
- **Persistence:** saved per viewer in `localStorage['kn.settings.v2']`; the M1 `kn.settings` keys and `kn.nick` migrate in.
- **Controls:** a remapping table with conflict highlighting. `remapKey()` translates through the bindings, so main.ts's handlers keep their default keys.
- **Accessibility:** the UI scale, reduced motion and colour preset are applied to the document.
- **About:** has an "Export diagnostics" button.

### Cascade Report v1

- Slides in when the cascade goes quiet: 3 s of sim time with no notable event. It also opens on Stop if it hasn't shown yet for that run, or from the palette.
- **Chain:** the longest chain is shown as part chips joined by channel-coloured arrows; clicking a chip scrubs the shared playhead there.
- **Stats:** K.O. count, run time, parts used, channels used, biggest boom, and peak simultaneous events.
- **Score:** the Overreaction Score, with six title tiers from "Mild Kerfuffle" to "Absolute Catastrophe".
- **Actions:** Replay works. Share card and Record clip are disabled stubs marked "(soon)".
- **Causes:** uses the sim's `id`, `cause` and `other` when present (stream A's contract 1 is live). Otherwise it infers causes from the nearest earlier event on another part that is linked or within 0.6 m, inside 1.5 s.

### Settings for other streams

- **Stream C (comfort):** reads `settings.comfort.{shake, directorCutRate, hitstop, slowmo, reducedMotion, reduceFlashing}` from `apps/game/src/ui/settings.ts`, and can subscribe with `onSettingsChange((s, path) => …)`.
- **Graphics fields:** `settings.graphics.{tier, renderScale, particleCap, unlimitedMayhem, budgetOverride}` are stored here but nothing reads them yet. Stream C should wire them in.
- **Audio (stream F):** main.ts now feeds `settings.audio` to `audio.setVolumes`.

## Wire format (DATA_FORMATS §3 additions)

| Op | Encoding |
|---|---|
| `GroupSet` | `[7, groupId, name \| null, parent, memberIds[] \| null]`. `name = null` removes the group. `memberIds = null` changes only the name and parent. |
| `ModuleSave` | `[8, moduleId, name, blob \| null]`. `blob = null` removes the module. The blob is a `.knockmod` of at most 1 MB, and the host decodes it to validate it. |
| `ModulePlace` | `[9, moduleId, [x, y, z, quarterTurns], idBase, count, layer]`. The placed ids are `idBase + 1 … idBase + count`, in local id order. |
| `LayerSet` | `[16, layerId, name \| null, flags]`. Flags: bit0 hidden, bit1 locked. `name = null` removes the layer, and its parts move to layer 0. |

Sections:

- **GRUP:** msgpack `{groups: [id, name, parent, memberIds[], 0][], layers: [id, name, flags][]}`. The `memberIds` are derived from `PART.group` when saving; on load, `PART.group` is the source of truth.
- **MODL:** msgpack `[id, name, blob][]`.

Both sections are left out of canonical run snapshots and out of `worldHash`.

`.knockmod` is a `KNMD` container with the sections TYPE, PART (local ids 1..P, positions relative to the origin), LINK (ids P+1..P+L), PORT (`[localPartId, port, label][]`) and META (`{name, author, description, tags}`).

## Deviations and decisions

1. **LayerSet is a new op code (16).** DATA_FORMATS §2.2 folds layers into GRUP but gives no op for them. Layers need a name and visibility/lock flags that both players see, so they got their own op.
2. **Group, layer and module ids are "small ids": `slot × 2^24 + n`.**
   - This fits the u32 `PartRecord.layer` and `group` fields, and the two players never collide.
   - Clients allocate them with a monotonic per-session high-water mark, not the part counter.
   - The host doesn't namespace-check them; a collision only happens if a client forges one.
3. **Group membership lives on `PartRecord.group`** (one group per part). `GroupSet.members` is the exact new membership, and the inverse ops restore each part's previous group.
4. **`ModulePlace` carries `count`** (not in the original `[9, moduleId, transform, idBase]`). This lets the host namespace-check the ids and bump counters without decoding the module. It also carries the target `layer`.
5. **Placement turns only in quarter turns.** Rotated positions are then exact integers. Snapped Euler rotations stay exact (yaw is applied first); free rotations are re-quantized with plain IEEE maths. This is identical on the host and both clients.
6. **Parts can't be renamed.** `PartRecord` has no name field, so rename covers layers, groups and modules; parts show as `TYPE #n`.
7. **Hidden and locked are build-mode concepts.** The sim still runs hidden parts. Run mode draws every body, and Hand-of-God pokes ignore locks.
8. **Locked means inert.** Locked parts can't be hovered, selected, deleted, rotated or used in the radial menu. Rows are italic in the Outliner and are unlocked there.
9. **Placement isn't overlap-checked.** Module placement and the section box don't run main.ts's `blockedBy` check.
10. **The Q radial's release** still reads the raw key, so a remapped radial key opens the menu but releasing it needs Q.
11. **The Cascade Report's K.O. count** is distinct part-to-part knock-on edges in the cause graph. The run bar's live K.O. counts booms, breaks, pops and cuts, so the two numbers differ.

## Shared-file edits (Edit tool only)

- **`main.ts`:**
  - Imports, plus `BuildTools` constructed after the Radial.
  - Settings: `settings.audio` drives the volumes, and the old settings button, panel and loader were removed.
  - Keys: `remapKey` and `tools.keydown` at the top of the key handler; Del removes the multi-selection.
  - Picking: `tools.pickable` in `pick()` and `pickPort()`.
  - Select clicks go through `tools.clickSelect`, and new parts take `...tools.newPartFields()`.
  - Scene: `tools.commands()` in the palette, `tools.visibleParts` and `tools.outline` in `rebuildScene`, `tools.frame(overlay)` before `setOverlay`, and the inspector hook loop.
  - Every hook is commented "stream D".
- **`styles.css`:** the old Settings block was replaced with a stream D block (all new panels, the dialog, UI scale, reduced motion, colour presets).
- **`apps/host/src/session.ts`:** the two `createdIds` / `mutatedIds` cases above.
- **`index.html`:** untouched; the new top-bar controls are inserted from code.

## Verification

- **Commands:** `pnpm typecheck` is clean. `pnpm vitest run packages/format packages/docstore packages/net apps/host apps/game` passes: 8 files, 53 tests.
- **New test files:**
  - `packages/format/test/module.test.ts` (11 tests): op round trips and rejects, small ids, `.knockmod` round trip and determinism, corruption, remap/rotate/offset, quarter turns against the sim's quaternion convention, GRUP/MODL round trip, canonical/hash exclusion.
  - `packages/docstore/test/organise.test.ts` (4 tests): apply and invert every new op, atomic rejects, group cycles, save/load, two-player convergence with modules placed by both, per-player undo.
  - `apps/host/test/modules.test.ts` (1 test): over a real WebSocket, the module ops relay, the namespace check rejects, and counters bump; the journal replays the module blob after a restart.
  - `apps/game/test/cascade.test.ts` (10 tests): the causal chain and channel arrows, input-order independence, inferred causes, a boom in the same tick, the empty run, unknown kinds, score monotonicity, tiers, the peak window.
- **In Chrome, two tabs (two players), on a local test server (:8788, scratch data) and Vite (:5175, HMR off).** The new ops need the new host code, and testing there kept the shared world untouched.
  - Outliner: select, Shift-range, group (Ctrl+G), new layer, move to layer, hide layer (gone from view and picking), lock layer from player 2 (player 1 can't select it), 3D click ↔ Outliner row sync.
  - Inspector: the multi-select section.
  - Modules: save through the dialog; place from the other player with R rotation (ids remapped, both converge).
  - Section box: drag out, then a handle drag; it clips through the renderer.
  - X-ray and cutaway toggles (C's renderer calls are live).
  - Settings: tabs; Controls remap S for Select, persisted across a reload, with V disabled; the UI scale.
  - Environment: switching to Mega Kitchen syncs to the partner.
  - Cascade Report: auto-opens on a real run with sim causes, a chip scrubs to 6.45 s, Replay works, the palette lists the commands.
- **Not exercised in the browser:** `.knockmod` export and import, because they need a file download and a file picker. The codec behind them is unit-tested.
