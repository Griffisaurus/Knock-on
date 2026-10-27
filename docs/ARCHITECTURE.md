# KNOCK-ON Technical Architecture

Status: v1.2 · 2026-10-25 (as built through M5) · Owner: Tech Lead
Deeper dives: [SIMULATION.md](SIMULATION.md) · [RENDERING.md](RENDERING.md) · [PART_SYSTEM.md](PART_SYSTEM.md) · [DATA_FORMATS.md](DATA_FORMATS.md) · [MULTIPLAYER.md](MULTIPLAYER.md) · [UI_UX.md](UI_UX.md) · [AUDIO.md](AUDIO.md) · [ENGINEERING.md](ENGINEERING.md)

> **v1.1 (M5 docs pass):** v1.0 described a planned design with a GPU worker, asset workers, shared-memory rings and a dozen packages. What shipped is simpler: rendering, Spectacle and the Matter GPU backend run on the **main thread** on one `GPUDevice`; the sim runs in one worker with Jolt's job threads; the sim and the main thread talk by `postMessage` (plus one SharedArrayBuffer for Matter results). This version describes the code as built. Planned-but-not-built items are marked as such.

---

## 1. System overview

```
┌──────────────────────────────── Browser tab (cross-origin isolated, HTTPS) ──────────────────────────────────┐
│                                                                                                               │
│  MAIN THREAD                                               SIM WORKER (sim.worker.ts)                         │
│  ┌───────────────────────────────────────────┐  start/     ┌───────────────────────────────────┐             │
│  │ UI (plain TS + DOM, apps/game/src/ui)      │  poke/play  │ Machine (packages/sim): run world │             │
│  │ Input, editor tools, picking + snapping    │───────────▶ │   on Jolt, channels, critters,    │             │
│  │ DocStore (packages/docstore) + NetClient   │             │   checkpoints, hashing            │             │
│  │ RunController (run.ts)                     │◀─────────── │ BakeStore: bake-ahead keyframes   │             │
│  │ Renderer on the one GPUDevice (gfx/**):    │  frame/hash/│ Matter: MatterWorkerLink ('gpu')  │             │
│  │   scene, look, GI, Spectacle, capture      │  checkpoint │   or MatterCpu in-worker ('cpu')  │             │
│  │ Matter GPU backend + playback replica      │◀═══SAB═════▶└──────────────┬────────────────────┘             │
│  │   (matterhost.ts, D92)                     │  Matter cmds/results       │ pthreads                         │
│  │ Audio graph (WebAudio)                     │                ┌───────────▼───────────────┐                 │
│  └──────┬─────────────────────────┬───────────┘                │ Jolt job threads (N)      │                 │
│         │ AudioWorklets           │ capture                    │ + contact-script.js (D99) │                 │
│         ▼                         ▼                            └───────────────────────────┘                 │
│  ┌───────────────────────┐  ┌──────────────────────────────┐                                                 │
│  │ limiter, Matter grains│  │ MP4 muxer worker, GIF worker │                                                 │
│  └───────────────────────┘  └──────────────────────────────┘                                                 │
└──────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                               │ WebSocket (MessagePack) over isolated test network HTTPS
                                       ┌───────▼────────┐
                                       │ Host Server    │ static files · session relay · ordering · persistence
                                       └────────────────┘   (apps/host)
```

**Design principles**
1. **The world document is the single source of truth while building.** Every change is an op (MULTIPLAYER §5). Single player uses the same pipeline against a Host Server on the same machine.
2. **The sim is a pure function** of (world snapshot, sim version, seed, sim flags, input log). No other inputs exist.
3. **Rendering never blocks simulation.** The sim bakes ahead of the playhead in its worker (up to 4 s live, a whole run in Bake & Watch) and the main thread draws interpolated keyframes. The one exception is Matter (D92): when a Matter result is late, the sim worker waits (time dilation), it never skips (SIMULATION §8.5).
4. **One `GPUDevice`, owned by the renderer on the main thread.** Rendering, Spectacle, capture and the Matter GPU backend share it, so the Matter renderer draws the particle buffers with no copies (D92).
5. **No DOM in the sim worker or the sim packages. No wall clock or platform maths inside the sim** (the determinism lint, ENGINEERING §4).

---

## 2. Threads and responsibilities

| Thread | Owns | Must not |
|---|---|---|
| **Main** | DOM UI, input, editor tools, picking (ray vs part bounds, `main.ts`) and grid snapping, **DocStore**, **NetClient** (`net.ts`), the **RunController** (`run.ts`), the **renderer** and everything on the `GPUDevice` (`gfx/**`: scene, look, GI, Spectacle, Matter rendering, VRAM governor), the Matter GPU bake backend and playback replica (`matterhost.ts`), asset fetch and decode (glb, `.art.json`, KTX2), the AudioContext and its scheduling, capture (`capture/**`) | Run physics; block the frame on the sim |
| **Sim worker** (`apps/game/src/sim.worker.ts`) | The run `Machine` (Jolt run world, gameplay systems, channels, critters, checkpoints, state hashing), the bake-ahead **BakeStore** (`bakestore.ts`), pokes and rollback, Bake & Watch, the Matter link (`MatterWorkerLink` in 'gpu' mode, or MX's `MatterCpu` plus a `MirrorLink` in 'cpu' mode) | Read the wall clock in sim code; touch the DOM; touch the GPU |
| **Jolt job threads** | Jolt's job system (WASM pthreads of the installed `jolt-physics` 1.1.1 multithreaded build, D99). Default `hardwareConcurrency − 3`, clamped 2..12 (`joltThreadsFor`, `sim.worker.ts`), so the main thread, the sim worker and the browser each keep a core. Each thread imports `packages/jolt/src/contact-script.js` and writes contacts into a shared buffer, sorted canonically after the step. If the threads don't start within 10 s, the session falls back to the single-threaded build. | Run anything but Jolt jobs |
| **Capture workers** (`capture/mp4.worker.ts`, `capture/gif.worker.ts`) | The in-house MP4 muxer (streams to an OPFS file) and the GIF encoder (D94) | Touch the GPU or the sim |
| **AudioWorklets** (`audio/limiter-processor.js`, `audio/matter-processor.js`) | The −1.05 dBTP master limiter and the Matter granular player. Both are same-origin files, because the CSP blocks Blob URLs. | Allocate during `process()` |

**Not built:** v1.0's GPU worker (OffscreenCanvas, `InThreadPort`) and the two asset workers. Rendering on the main thread has been fast enough at every tier (M3/M4 benchmarks), and assets decode on the main thread on first use. **Node** runs the same sim with no workers except Jolt's threads and, for the Matter CPU reference, optional `worker_threads` lanes (`packages/matter/src/node/parallel.ts`).

---

## 3. Package map and dependency rules

```
apps/game ──▶ assets, docstore, format, jolt, matter, net, parts-data, sim
apps/host ──▶ docstore, format, net   (+ sim, loaded by the session for grain counts)
packages/
  detmath      (pure TS)   deterministic trig, PRNG, hashing. No deps.
  format       (pure TS)   .knockon container and world codec, op schemas and wire form, quantization, links, modules,
                           terrain (TERR), KNCP checkpoints (JOLT / ECS / MATR), sim
                           flags and tier caps, env settings incl. wind presets. → detmath
  net          (pure TS)   wire protocol (MessagePack via msgpackr), message size caps, clock sync, hash-report
                           bookkeeping (hashes.ts: `pk`, re-reports, the host's compare rule, D108). → format
  docstore     (pure TS)   WorldDoc (maps of part / link / note records), validated op apply and inverse,
                           optimistic ops, rebase, per-player undo. → format
  parts-data   (data + TS) part defs (defs.ts, defs_m2/m3/m4/m5.ts, defs_m5_matter.ts), cards, demos, critters,
                           presets, environment data (env_*.ts, generated; env_space.ts), fracture data (frac_*.ts). → detmath
  sim          (TS)        Machine (machine.ts), channels (channels/**), critters (critters/**), Matter host
                           (matter/**), Hangar / Moon sets, zones and wind (envsets.ts), contact buffer, capacity
                           planning. → detmath, format, jolt, parts-data
  jolt         (WASM + TS) loads the installed jolt-physics 1.1.1 build (single- or multithreaded), the contact
                           path (contacts.ts, contact-script.js) and the M0 determinism spike. → detmath
  matter       (TS + WGSL) the integer Matter layer: MatterBackend contract, CPU reference, WGSL kernels, the WebGPU
                           backend (gpu/), payload codec. No workspace deps (sim injects a backend).
  assets       (pure TS)   readers for the art pipeline's outputs (.glb, .art.json, shapes). No deps.
apps/game/src/
  ui/          main-thread UI (plain TypeScript and DOM; no framework), glass tokens in styles.css
  gfx/         the renderer: scene, look/, matter/, future/ (M5 effects), GI, TAA, particles, volumes,
               wetness, VRAM governor, KTX2
  audio/       procedural WebAudio engine and worklets; offline clip audio (clip.ts)
  capture/     photo mode, offline clips, MP4 (video + AAC / Opus sound) / GIF / WebP encoders
```

**Not built:** v1.0's `gpu-core`, `render`, `spectacle`, `audio`, `ui`, `editor`, `render-client` and `sim-client` packages. Their work lives in `apps/game/src/{gfx,audio,ui}` and `main.ts`. bitECS was never adopted; the sim keeps plain, JSON-safe state on `Machine` (`st`), which is what checkpoints serialise (DATA_FORMATS §6).

**Enforced in CI:**
- `pnpm lint` (`tools/lint/determinism.mjs`) scans `sim`, `docstore`, `format`, `net`, `detmath`, `matter` and `parts-data` for `Math.random`, `Date.now`, `performance.now`, platform transcendentals (`Math.sin` and friends; `detmath/trig.ts` is the allowed implementation), `for…in`, float formatting in hashes and timers. `net/clock.ts` may read real time (it never feeds the sim). ENGINEERING §4.
- Package dependencies are declared in each `package.json` (workspace deps). There is no `dependency-cruiser` step; sim-side packages simply don't depend on `apps/*`, and `sim` doesn't depend on `matter` (backends are injected through `matter/contract.ts`).

---

## 4. Core data model

### 4.1 WorldDoc (DocStore)
`packages/docstore/src/world.ts`. `Map`s of records keyed by id: `parts: Map<PartId, PartRecord>`, `links`, `notes`, `groups`, `layers`, `modules`, plus `env` (EnvSettings), `terrain` (Backlot), `simFlags` and the grain-count hook (`WorldDoc.countGrains`, for the header's `counts.grains` and `requiredTier`). The same class runs in the client and the Host Server, so both accept and reject exactly the same ops. Part records follow DATA_FORMATS §2.

| Field (`PartRecord`) | Notes |
|---|---|
| `id` | f64 safe integer, `slot × 2³² + counter` (MULTIPLAYER §5.3) |
| `type` | part type string (the file stores a type table and indices) |
| `pos` | i32×3, 1/64-cell fixed point (≈ 1.56 mm) |
| `rot` | snapped Euler (exact) or free smallest-three (DATA_FORMATS §1) |
| `size`, `props` | resizable dims and the part's properties (PART_SYSTEM §2) |
| `flags` | `PartFlag` (`packages/format/src/model.ts`): MirrorX/Y/Z, Locked, Hidden, Anchored (bits 0–5), plus `Tagged` (bit 9) for BUZZ (M5, D105). Stored bits: `FLAG_MASK` in `world.ts` (DATA_FORMATS §2.3). The sim's run-time `PartFlagBits` (lit, powered, pressed, …, `machine.ts`) are a different set. |
| `layer`, `group` | organisation (the sim ignores them) |

The editor never builds a Jolt "edit world": picking and snapping are main-thread maths on part bounds and the grid (`main.ts`). The sim worker builds a world only for a run.

### 4.2 Ops
`Op = PartAdd | PartUpdate | PartRemove | LinkAdd | LinkUpdate | LinkRemove | EnvUpdate | NoteAdd | NoteUpdate | NoteRemove | GroupSet | LayerSet | ModuleSave | ModulePlace | Batch | TerrainStroke | TerrainPatch` (`packages/format/src/ops.ts`; wire codes in DATA_FORMATS §3).

Every op has an inverse computed **before** apply (`docstore` `tryApply`). The Host Server validates with the same code (`apps/host/src/session.ts`).

### 4.3 Who mirrors what

| Consumer | How it stays in sync |
|---|---|
| UI read models (outliner, inspector, tray) | `DocStore.on(...)` events (`applied`, `dropped`) |
| Renderer scene | `main.ts` rebuilds instance records when the document changes; during a run the sim's transforms are uploaded as-is |
| Sim worker | Doesn't mirror the doc. On `run.start` the client sends the **confirmed** world (`DocStore.confirmed()`, D72) in the worker's `start` message |
| Host Server | Authoritative op order and persistence (`storage.ts`) |

---

## 5. Messages and shared memory

v1.0 planned six SharedArrayBuffer rings. As built, the sim worker and the main thread exchange **messages** (types `ToWorker` / `FromWorker` in `sim.worker.ts`):

| Message | Direction | Contents |
|---|---|---|
| `start` | main → sim | run id, confirmed parts / links / terrain, gravity, air, preset, environment, seed, tick rate, play state, sim flags, the Matter channel and capacity, `sinkFill`, Jolt threads; M5 adds `zones` and `wind` |
| `play`, `watch`, `live`, `bakedMin`, `stop` | main → sim | the shared play state (MULTIPLAYER §7.2), Bake & Watch control, the partner's bake head |
| `poke`, `exportCheckpoint`, `importCheckpoint` | main → sim | pokes (may roll back) and desync repair |
| `frame` | sim → main | per frame: the playhead's interpolated transforms (empty when nothing moved), part flags, meters, link state, critter state and carry, light beams, events due, bake rate, container fill and Matter counts; M5 adds `targets` (BUZZ's current item, `critterTargets()`) and `grabbers` (`grabberJoints()`). Typed arrays are transferred, not copied. `ready` reports the Jolt threads in use (M5). |
| `hash`, `baked`, `bakeProgress`, `checkpoint`, `resynced`, `error` | sim → main | state hashes (1 s behind the bake head, D59; `mc` = the Matter checksum, already inside the hash; `pk` = pokes the hash saw, M5), bake head, Bake & Watch progress, KNCP checkpoints |

**Keyframes** live in the sim worker's BakeStore (CPU memory): a base frame plus per-keyframe deltas of only the bodies that moved, 20 B per body (f32 position + snorm16 quaternion), every 4 ticks, with 3 minutes of scrubbable history; over budget the oldest fold into the base (`bakestore.ts`). There is no VRAM keyframe store.

**The one shared buffer is Matter's** (`matterhost.ts`, D92). In 'gpu' mode each Matter command goes to the main thread as one transferable `Int32Array` on a `MessagePort`; results come back in one of 8 SAB slots (256 KB each), plus a 4 MB chunked reply area for snapshots, and the worker `Atomics.wait`s only when the rigid tick that needs a result arrives first. In 'cpu' mode (no device, or ≤ 300 grains) the worker runs MX's CPU backend and only mirrors commands to the main thread's playback replica.

---

## 6. Key flows

### 6.1 Local edit (optimistic)
```
pointer drag ─▶ editor tool ─▶ pick (ray vs part bounds) + grid snap (main thread)
            ─▶ ghost drawn by the renderer                        [no op yet]
pointer up  ─▶ Op ─▶ DocStore.applyLocal ─▶ UI and renderer update
                   └▶ NetClient sends the op ─▶ Host: validate, seq, broadcast
            ◀─ op.ack(seq)            → DocStore.onAck: confirmed
            ◀─ op.reject              → DocStore.onReject: rolled back
```

### 6.2 Remote edit
`NetClient ◀ op {seq, by}` → `DocStore.onRemote` rebases pending local ops (re-applied on top of confirmed) → UI and renderer update.

### 6.3 Run
1. LET IT RIP → (multiplayer countdown) → `run.start {runId, worldSeq}`.
2. The RunController takes `DocStore.confirmed()` at `worldSeq` (D72), computes the world's grains and tier, attaches the Matter host on the renderer's device, and posts `start` to the sim worker.
3. Sim worker: build the run `Machine` (SIMULATION §3) → bake ahead of the playhead into the BakeStore → post `frame`s for the playhead → hash every 60 ticks, sent 120 ticks late (D59) with the pokes it saw, re-sent after a rollback (M5 desync fix) → checkpoint every 60 ticks (plus the start state, D70).
4. Main thread: the shared playhead (local or partner-held, MULTIPLAYER §7.2) never passes the slower partner's bake head. The renderer draws the frame's transforms; Spectacle and audio consume the frame's events. The Matter playback replica replays the command log up to the playhead's Matter tick.
5. Stop → the worker discards the run `Machine` (the document was never touched) → the renderer clears run state and Spectacle pools (D67).

### 6.4 Placement and snapping
Main thread only (`main.ts`): the pointer ray is tested against every part's oriented bounds, then the terrain (`ui/terrainpick.ts`) and the floor; the ghost snaps to the grid step and rests on the hit surface. Port glows come from the part defs. Keyboard building drives the same path (`ui/keyboard.ts`, UI_UX §7).

### 6.5 Asset loading
Assets are served from `assets/build/` at `/parts/<type>/…`, `/kit/…` and `/env/<id>/…` (the Vite plugin in `apps/game/vite.config.ts` in dev; copied into `dist/` on build). A part's `.glb`, `.art.json` and texture set (KTX2 / BC7 when the adapter has `texture-compression-bc`, PNG otherwise; D97) are fetched and decoded on the main thread on first use (`gfx/glbmesh.ts`, `gfx/ktx2.ts`, `packages/assets`). **Gameplay never waits on art:** the sim uses the part defs only. **Not built:** a hashed `manifest.json`, Cache Storage and a service worker.

### 6.6 Save and load
The Host Server persists every world, solo or multiplayer: a compacted `world.knockon`, an append-only journal and backups (`apps/host/src/storage.ts`, MULTIPLAYER §11). Clients can export. **Not built:** a client-side IndexedDB journal.

---

## 7. Application state machine

```
Boot ─▶ Check ─▶ Lobby ─▶ Loading(world) ─▶ BUILD ⇄ (TestRun | SoloPreview)
                                              │  ▲
                                LET IT RIP ─▶ Countdown ─▶ RUN ─▶ (Report) ─▶ BUILD
                                              │                ▲
                                              └── cancel ──────┘
Any state ─▶ Error(recoverable: device lost / worker crash / disconnect) ─▶ Recover ─▶ previous state
```

---

## 8. Failure handling

| Failure | Detection | Recovery |
|---|---|---|
| **GPU device lost** | `device.lost` promise (`gfx/renderer.ts`) | The renderer rebuilds itself on a new device (≈ 0.3 s, V4). The Matter host stops issuing, then makes a new bake backend, restores the newest snapshot at or before the last tick and re-runs the logged commands; the sim worker only waits (`MatterHostMain.deviceRestored`). Outcomes are unchanged. If recovery fails: a "Graphics restarted" blocker asks for a reload. |
| **WASM OOM** in the sim | Allocation failure | The worker posts `error`; the run stops with a toast. The Jolt heap is sized to the world beforehand (`joltHeapMB`). |
| **Jolt threads fail to start** | 10 s timeout | Single-threaded build for the rest of the session (D99) |
| **Net disconnect** | WebSocket close / missed pong | Reconnect and resnapshot (MULTIPLAYER §8.3) |
| **Desync** | Hash mismatch | Checkpoint repair (MULTIPLAYER §7.4), up to 64 MB per checkpoint |
| **Corrupt world file** | Codec validation (bounds, counts, unknown types) | Refuse to load with a clear error. Never partially load. |
| **Asset missing or failed** | Fetch or decode error | The part draws as a blockout; gameplay unaffected |

---

## 9. Capabilities, tiers and flags
- **Capability probe** (`apps/game/src/caps.ts`, shared by `/check` and boot): secure context, `navigator.gpu`, adapter info and limits, features, `crossOriginIsolated`, SharedArrayBuffer, WASM threads, `hardwareConcurrency`, `deviceMemory`.
- **Tiers:** 4 / 8 / 12 / 16 / **32 GB** (D85; `Tier` in `caps.ts`, `TIER_CAPS` in `packages/format/src/matter.ts`, `TIER_BUDGET` in `gfx/vram.ts`). `estimateTier` guesses from the adapter name (32 GB class: RTX 5090, RTX PRO 6000, RTX A6000 / 6000 Ada, Radeon PRO W7900) and binding limits. Chromium hides the adapter name, so the 32 GB tier is usually chosen in **Settings › Graphics › Quality tier**, which applies at boot (D90). At boot the VRAM probe checks that the tier's later pools fit (`probeHeadroom`, RENDERING §11). **Tier caps capacity, never rules** (SIMULATION §10.5): a world records `requiredTier`, and a smaller tier sees "needs N GB" instead of a different machine.
- **Sim flags** (`SimFlags`, `packages/format/src/matter.ts`): `matterGameplay` (new worlds on; files from before M4 read as off) and `lanes` (reserved: collision lanes, SIMULATION §4.2). They live in the world header, so both clients run the same rules. Since M5, Settings › World › "Sand, water and marbles" overrides `matterGameplay` per world through `env.matter` (an `EnvUpdate`, synced and undoable; `WorldDoc.simFlags` applies it). There is no `flags.json`.
- **Physics threads** (M5): Settings › Performance picks the Jolt thread count ('auto' or 0 / 2–16), read at boot and sent in the run's `start.joltThreads`; results don't depend on it (D99).
- **Debug query flags** (not sim inputs): `?debug` (perf readout, `window.__kn`), `?lobby`, and renderer test switches such as `?taa`, `?governor`, `?still`.

---

## 10. Observability
- **Perf readout** (F9, or `?debug`; F11 is reserved by browsers for fullscreen): frame and sim timings, bake rate and time dilation, VRAM per pool (`vramSummary`), Matter wait.
- **Console logging** in the client and the host. No third-party telemetry. Self-hosted builds send nothing anywhere.
- **Host Server logs:** session events, op rates, desync reports (including whether Matter checksums differed).

---

## 11. Security
- Served with `COOP: same-origin`, `COEP: require-corp`, `CORP: same-origin` and a strict CSP (`SECURITY_HEADERS` in `apps/host/src/server.ts`): `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'`. Worklets and Jolt's contact script are same-origin files because `script-src 'self'` blocks Blob URLs.
- **No `eval`, no remote code.** Behaviours are compiled into the build. Modules and worlds are pure data.
- **Untrusted input:** world files, modules and network messages are validated by the shared `format` and `docstore` code (limits on counts, sizes, string lengths, enum ranges, nesting). The Host Server applies the same validation before relaying. Messages are capped at 4 MB, except desync-repair checkpoints (64 MB, MULTIPLAYER §10).
- **Identity** uses client-supplied nicknames. Proxy-provided identity headers are not trusted.

---

## 12. Key interfaces (as built)

```ts
// packages/docstore/src/store.ts — the client DocStore
export class DocStore {
  constructor(slot: number, doc?: WorldDoc, seq?: number, caps?: Caps);
  on(fn: (e: DocEvent) => void): () => void;              // 'applied' | 'dropped'
  applyLocal(op: Op, opts?: { recordUndo?: boolean }): { clientOpId: string } | { error: string };
  onAck(clientOpId: string, seq: number): void;
  onReject(clientOpId: string, reason: string): void;
  onRemote(seq: number, slot: number, op: Op): void;
  undo(): UndoResult; redo(): UndoResult;                 // per-player stacks
  confirmed(): { parts; links; env; terrain; simFlags };  // the world at the server's seq (D72)
}

// apps/game/src/run.ts — the main-thread side of a run (wraps the sim worker)
export class RunController {
  phase: 'build' | 'countdown' | 'running';
  tick: number; baked: number; simRate: number;           // playhead, bake head, time dilation
  transforms: Float32Array; flags: Uint8Array; critters: Uint8Array; /* … per-frame state */
  attachMatter(device: GPUDevice, tier: number, onRestore?: (cb: (device: GPUDevice) => void) => void): void; // D92
  // pokes, play state, Bake & Watch, desync repair: MULTIPLAYER §7
}

// packages/sim/src/machine.ts — the simulation (worker and Node)
export class Machine {
  step(): void; hash(): string;
  checkpoint(): void; restore(tick: number): number;
  exportCheckpoint(tick: number): { tick: number; blob: Uint8Array } | null;  // KNCP, DATA_FORMATS §6
  importCheckpoint(blob: Uint8Array): number;
  readonly matter: MatterHost;                            // SIMULATION §8
}
```

The renderer's API is `apps/game/src/gfx/renderer.ts` (`Renderer`); capture is `CaptureController` (`capture/index.ts`).
