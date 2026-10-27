# M2 plan: the full contraption toybox

Started 2026-10-24. Scope: [PRODUCTION.md §2 M2](../PRODUCTION.md). Specs: GAME_SPEC §11–12, SIMULATION §5.6–5.11 and §7, PART_SYSTEM, RENDERING §6 and §10, UI_UX §4, AUDIO §5, §7 and §9, and the art briefs.

**Exit:**
- Every Appendix A goal type can be built: deliver, pop, ignite/launch, creature, switch on, break, protect/negative, and low gravity.
- Critters stay stable through 30-minute soak runs.

## Workstreams and file ownership

Six streams work in parallel in one checkout, which is not a git repo, so there are no branches. **Own your files; touch shared files only as described below.**

| Stream | Owns (may create and rewrite) | Shared files it may edit (Edit tool only) |
|---|---|---|
| **A · sim-parts** | `packages/sim/src/channels/**` (new), sim tests for parts | `packages/sim/src/machine.ts`, `packages/sim/src/index.ts`, `packages/parts-data/src/{defs,cards,demos}.ts` (non-critter parts) |
| **B · critters** | `packages/sim/src/critters/**` (new), `packages/parts-data/src/critters.ts` (new), critter tests, `apps/host/soak/critters.ts` (new) | `machine.ts` (narrow hooks), `index.ts`, `defs.ts` (the critter-bound parts), `apps/game/src/sim.worker.ts`, `apps/game/src/run.ts` |
| **C · graphics** | `apps/game/src/gfx/**`, `apps/game/src/cameras.ts` (new), `packages/assets/src/glb.ts` (skins and animations) | `apps/game/src/scene.ts`, `apps/game/src/main.ts`, `apps/game/src/artlist.ts` (the env list) |
| **D · tools/UI** | `apps/game/src/ui/**`, `apps/game/src/cascade.ts` (new), `packages/docstore/**` and `packages/format/**` (module and layer ops) | `apps/game/src/main.ts`, `apps/game/src/styles.css`, `apps/game/index.html` |
| **E · art** (parts, critters, Mega Kitchen) | `assets/**`, `tools/blender/**`, `tools/assets.mjs`, `art/**`, `docs/art/PIPELINE_STATUS.md`, `packages/assets/test/**`, `packages/parts-data/src/env_kitchen.ts` (generated) | `apps/game/src/artlist.ts` (the part list) |
| **F · audio** | `apps/game/src/audio/**`, `apps/game/src/audio-test.ts` | `main.ts` (audio hooks only) |

The orchestrator owns `docs/dev/M2_STATUS.md`, the decisions files, the PRODUCTION and SIMULATION docs, and final integration.

**Rules for shared files:**
1. **Edit them only with the Edit tool** (exact-string replace). Never rewrite a shared file wholesale or with a script; another stream may have changed it since you read it. If an Edit fails because the file changed, re-read it and retry.
2. Keep each change local and small, and add a short comment where another stream will look.
3. `pnpm typecheck` and `pnpm test` run the whole repo. If they fail **in another stream's files**, don't fix them: note it in your hand-back and carry on.
4. **Don't run `pnpm --filter @knockon/game build`**: `dist/` is shared, and the host on :8787 serves it to the orchestrator. To see the game, run your own Vite dev server, which proxies `/ws` to the host on :8787:
   - C uses port **5174**: `pnpm --filter @knockon/game exec vite --port 5174 --strictPort`
   - D uses port **5175**.

   Open your own browser tab. Remove any parts you add to the shared world when you're done.
5. No git. Nothing from the 1993 game ships; use original names only. No realistic firearms.
6. Write notes and deviations to `docs/dev/M2_NOTES_<stream letter>.md`, not to the status or decisions docs.

## Contracts between streams

### 1. Events (A defines; everyone consumes)

`SimEvent` gains `id: number` (per run, increasing in emit order), `cause: number` (the id of the causing event, or −1), and an optional `other: PartId`. SIMULATION §9 defines `causeId`: it propagates through contacts (the other body's last causing event), signals, power, fuse and heat chains, and explosions.

New `EventKind` values:

| Owner | Kinds |
|---|---|
| A | `Lit`, `Unlit`, `Sound` (mag = dB at 1 m), `Toggle`, `Ring`, `Launch`, `Splash`, `Spawn`, `Despawn`, `Note` |
| B | `CritterState`, `Emote`, `Ragdoll`, `Getup`, `Trapped` |

Audio (F) and the Cascade Report (D) switch on `kind`. Unknown kinds must be ignored.

### 2. Sound and Lure (A emits; B perceives)

- **Sound:** A keeps a per-tick list `soundsThisTick: {pos, dB, part}` (SIMULATION §5.10) for explosions, Ringer, impacts above a threshold, and anything else listed there. B reads it in perception.
- **Lure:** A tags lure emitters in parts-data (`lure?: {species: weight}`, radius). That covers seeds, shiny bodies (computed from physics material and mass), and snacks. B also registers critters as lures (Pip → Mochi, Goby → Mochi).

### 3. Critters (B defines; C renders; E builds the art; F voices them)

- **Defs:** critter part types `mochi`, `pip`, `goby`, `bandit` (family `critters`, ship M2) live in `packages/parts-data/src/critters.ts`, exported through `PARTS`.
- **Ragdoll:** each def carries its ragdoll as data, a list of `{bone, capsule radius and half-height, rest transform relative to root, parent, swing_deg, twist_deg, mass}`. It matches the brief's `RAG__<bone>` capsules. E keeps the art in agreement and reports mismatches; it doesn't edit the defs.
- **Bodies:**
  - The locomotion capsule is `BodyInfo.role: 'base'`.
  - Ragdoll bodies are created **dormant with the world** (no bodies are created or destroyed during a run, D66) as `role: 'rag'` with `bone: string`.
  - Bodies a part spawns, like corks and Yolks, are pre-created dormant as `role: 'piece'`.
- **State per keyframe:** `Machine.critterState(out: Uint8Array)` writes 4 bytes per part, in part order:
  - `clip`: an index into `CRITTER_CLIPS` (exported from parts-data);
  - `flags`: bit0 ragdoll, bit1 trapped, bit2 asleep, bit3 in-device (hamster wheel or pedal rig);
  - `emote`: an index into `CRITTER_EMOTES`, 0 = none;
  - `fsm`: a state index, for debugging.
- **Plumbing:** the sim worker adds `critters: Uint8Array` to keyframes and `frame` messages, and `RunController` exposes `run.critters`. B owns this plumbing.
- **Rendering (C):**
  - When not ragdolled, the skinned critter mesh sits at the base body's transform and plays `clip` from the glb (`<type>__<clip>`), timed on the render clock and cross-faded on clip change.
  - When ragdolled, each `RAG__` bone takes its rag body's transform, and the other bones follow their rest pose relative to their parent.
  - C owns `scene.ts`'s critter path.

### 4. Renderer APIs the UI calls (C implements; D calls)

```ts
renderer.setSectionBox(box: { min: V3; max: V3 } | null): void      // clip everything outside the box
renderer.setCutaway(on: boolean): void                                 // cut shells/walls facing the camera (RENDERING §10)
renderer.setXray(mode: 'off' | 'links' | 'all'): void                  // see-through overlay of links/ports/hidden parts
renderer.setSelection(instances: readonly number[], rgb: Rgb | null)  // screen-space selection outline
```

`cameras.ts` exports `type CamMode = 'orbit' | 'director' | 'ride' | 'overview'`, plus a `CameraRig` that main.ts drives. Keys: **C** cycles the mode and **F** frames the selection. D's settings page writes the comfort options (director cut rate, shake) that C reads from a `settings` object exported by `ui/settings.ts`.

### 5. Mega Kitchen (E builds; the orchestrator wires the sim; C renders)

- **E** writes:
  - `assets/build/env/kitchen/kitchen.glb`, served at `/env/kitchen/`. The Vite config needs a `buildAssets('env')`; C adds it.
  - `packages/parts-data/src/env_kitchen.ts`, a generated file of static collider boxes, the neutral zone and spawn points, matching art/briefs/environments.md.
- **C** draws it when `doc.env.environment === 'kitchen'`.
- **D** adds the environment picker as an `EnvUpdate` op.
- **The orchestrator** wires the colliders into the Machine.

### 6. Parts-data vs art

Part sizes, colliders, ports and pivots come from the art briefs (docs/art/briefs/*). A follows them. E builds to them and reports mismatches in `M2_NOTES_E.md` instead of editing parts-data.

## The 29 M2 parts

| Owner | Parts |
|---|---|
| A (25) | FUZZ, PIG IRON (STITCH already exists) · GUTTER, VORTEX, SPRONG, SCOOP, FLAP · DYNAMO, TURBINE · PUFFER · CELL, SUNCELL, LAMP, TORCH, BURNING GLASS, TOGGLE, RINGER, DELAY · T-PLUNGER, SKYROCKET, BIG TOP, CORK BLASTER · PUNCHLINE, GOTCHA BOX |
| B (4, critter-bound) | HAMSTER DRIVE, PEDAL RIG, FISHBOWL, TRAP BOX |

Every part needs a def, behaviours, a Library card, a demo machine, a per-part golden and a fuzz entry (PART_SYSTEM §7–8), plus final art (E).

## Orchestrator log

- **2026-10-24 13:19.** Duplicate art builders were launched by mistake: E1's builders were still alive after E1 handed back. They were stopped within minutes. Side effects to fix at the E1 close-out:
  - `make_pig_iron.py` was replaced by a duplicate's equivalent script (validated; the original's exports are intact).
  - `make_dynamo.py` was overwritten by a duplicate and then deleted, but DYNAMO's exports from the original builder remain. **Re-create `make_dynamo.py`** so the part can be rebuilt.
  - Every part in `assets/build/parts/` must have a matching `tools/blender/make_<type>.py`.
