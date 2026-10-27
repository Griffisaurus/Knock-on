# M4 plan: Matter

Started 2026-10-24. Scope: [PRODUCTION.md §2 M4](../PRODUCTION.md). Decisions D91–D95 (the provisional kickoff calls) are in [DECISIONS_2026-10-24.md](DECISIONS_2026-10-24.md). M3: [M3_STATUS.md](M3_STATUS.md). The working model is the same as [M3_PLAN.md](M3_PLAN.md), and its rules carry over.

**Scope:**
- **Matter gameplay and surfaces:** sand, water and marbles, two-way coupled with the rigid sim. FISHBOWL switches to Matter water.
- **The 15 Ship = M4 parts:** GRIT HOPPER, HOURGLASS, TANK, SPRINKLE CAN, WATERWHEEL, SPONGE, MARBLE HOPPER, BLOWOUT, VAC, INFLATOR, ARC TOWER, TOAST CANNON, YOLK, ZIPPY, QUACK.
- **Critters:** BISCUIT, HENNY and DUSTY.
- **Capture:** offline render, clips, GIF.
- **Accessibility pass.**
- **Carried in:**
  - multithreaded Jolt (D89);
  - the M2 parts' texture pass (PRODUCTION §3);
  - the RENDERING §11 VRAM governor;
  - KTX2 / BC7 textures (D88);
  - the Megastructure dressing colliders (M3_STATUS).

**Exit:** "Sandstorm" (4M sand grains avalanching through a WATERWHEEL valley, GAME_SPEC §13 perf scenes) is deterministic on 4 vendors at the 16 GB tier. On the test system the four implementations are the D91 matrix: NVIDIA D3D12, NVIDIA D3D11, Google SwiftShader, and the CPU reference in Node.

## Rules

M3_PLAN's rules 1–8 carry over:
1. **Shared files:** Edit tool only.
2. **Other streams' failures:** report them; don't fix them.
3. **`dist/` and the shared host:** don't build `dist/`, and don't touch the shared host.
4. **Project rules:**
   - no git;
   - nothing from the 1993 game;
   - no realistic firearms;
   - the determinism lint.
5. **Notes** go in `docs/dev/M4_NOTES_<stream>.md`.
6. **No sub-agents.**
7. **Measure, don't estimate**, with the method stated.
8. **Hidden bodies are never pushed.**

Plus:

9. **No downloads.** No new npm, pip or binary dependencies, and no fetching files from the internet: the producer approves every download. Write what you need (encoders, muxers) yourself.
10. **Private ports.** Each stream uses only its own ports (table below), with `KNOCKON_DATA` in its own scratch folder. The shared `:8787` host and the browser pane's other tabs aren't yours.
11. **The GPU is shared.** Every timing taken while other streams run is provisional. Record GPU contention (`nvidia-smi`) next to final numbers, or re-measure when the GPU is quiet.
12. **Append-only wire tables.** `EventKind`, `CRITTER_FSM`, `CRITTER_CLIPS`, `CRITTER_EMOTES` and `Species` only grow. Never reorder them.
13. **Goldens:**
    - Re-pin an existing golden only when your change explains it, and say so in your notes.
    - Never re-pin another stream's golden.

| Stream | Vite | Host |
|---|---|---|
| MX | 5201 | 8801 |
| MI | 5202 | 8802 |
| A4 | 5203 | 8803 |
| B4 | 5204 | 8804 |
| R4 | 5205 | 8805 |
| C4 | 5206 | 8806 |
| U4 | 5207 | 8807 |
| F4 | 5208 | 8808 |
| J4 | 5209 | 8809 |
| V4 | 5210 | 8810 |

The art streams E4a, E4b and E4c use Blender only.

## Streams and file ownership

| Stream | Owns | Shared files (Edit tool only) |
|---|---|---|
| **MX · Matter core** | `packages/matter/**`, `tools/vendor-matrix/**` (new), the Sandstorm Matter scene and its determinism runs | `apps/game/bench/scenes.ts` (add Sandstorm), `apps/game/vite.config.ts` (spike pages) |
| **MI · Matter integration** | `packages/sim/src/matter/**` (new), `apps/game/src/matterhost.ts` (new; the browser GPU host), Matter in the format (`MATR`, header `simFlags` / `requiredTier` / `counts.grains`) | `machine.ts`, `sim.worker.ts`, `run.ts`, `net.ts`, `packages/format/**`, `packages/docstore/**`, `packages/net/**`, `apps/host/src/session.ts`, FISHBOWL / SCOOP / FUZZ behaviour in `channels/**` (Matter hooks only) |
| **A4 · M4 parts (sim)** | `packages/parts-data/src/defs_m4.ts` (new), `packages/sim/src/channels/m4*.ts` (new), sim tests for M4 parts | `machine.ts`, `packages/sim/src/index.ts`, `channels/index.ts`, `packages/parts-data/src/{defs,cards,demos,index}.ts`, `catalog.ts` |
| **B4 · critters (sim)** | `packages/sim/src/critters/**` (new species code), critter tests, `apps/host/soak/critters.ts` | `packages/parts-data/src/critters.ts` (append-only tables), `machine.ts` |
| **R4 · Matter rendering + M4 VFX** | `apps/game/src/gfx/matter/**` (new), the M4 VFX in `particles.ts` / `fx.ts` | `renderer.ts`, `shaders.ts`, `glbmesh.ts` (cavity fill), `main.ts` (render hooks) |
| **C4 · capture** | `apps/game/src/capture/**` (new), `ui/capture*.ts`, `ui/photo*.ts` (new) | `main.ts`, `ui/cascadepanel.ts` (Share card, Record clip), `bakestore.ts`, `run.ts` (frame-indexed playback clock) |
| **U4 · accessibility + UI** | `apps/game/src/ui/**` except C4's files, `styles.css`, `index.html`, `docs/HOW_TO_PLAY.md` | `main.ts` (keyboard and UI hooks) |
| **F4 · audio** | `apps/game/src/audio/**` | `main.ts` (audio hooks) |
| **J4 · multithreaded Jolt + sim leftovers** | `packages/jolt/**`, the contact path (`machine.ts` contact listener → buffered), the thread-count harness, the Megastructure dressing colliders | `machine.ts`, `sim.worker.ts`, `apps/host/src/server.ts` (COOP/COEP headers if needed), `packages/parts-data/src/presets.ts` |
| **V4 · VRAM governor + KTX2/BC7** | `apps/game/src/gfx/vram.ts` (new), `tools/blender/kn_tools/bc7.py` + KTX2 writer (new), the KTX2 loader | `gfx/look/textures.ts`, `gfx/gi.ts` / `volume.ts` (allocation hooks), `renderer.ts`, `tools/assets.mjs` |
| **E4a · M4 part art** | `tools/blender/make_<M4 type>.py`, `assets/src/<family>/<M4 type>.blend` and their builds | `kn_tools/*` (additive), `apps/game/src/artlist.ts` |
| **E4b · critter art** | `tools/blender/make_{biscuit,henny,dusty}.py`, `assets/src/critters/{biscuit,henny,dusty}.blend` and their builds | `kn_tools/*` (additive), `artlist.ts` |
| **E4c · M2 parts texture pass** | the `assets/build/parts/<M2 type>/*.tex.*` sets, `make_<M2 type>.py` texture hooks | `kn_tools/{textures,export,validate}.py` (additive) |

## Contracts

### 1. The Matter backend (MX → MI, A4, B4, R4, F4)

MX publishes `packages/matter/src/backend.ts` first: within its first working hour, before anything else. MI, A4 and B4 code against it, using the CPU backend in Node until the GPU one lands. Changing the interface after that needs the orchestrator.

```ts
export type MatterKind = 0 | 1 | 2;                    // sand, water, marble (goo/slime: M5 with GOO VAT)
// all fixed point: positions in units (1/65536 m), velocities in units per matter tick
export interface MatterProxy { id: number; shape: 0 | 1 | 2 | 3; /* sphere, capsule, obb, plane */ pos: Int32Array; rot: Int32Array; /* Q14 quat */ size: Int32Array; vel: Int32Array; ang: Int32Array; dynamic: boolean }
export interface MatterEmit { seq: number; kind: MatterKind; count: number; pos: Int32Array; vel: Int32Array; spread: number; seed: number }
export interface MatterIntake { id: number; min: Int32Array; max: Int32Array; kindMask: number; capacity: number }
export interface MatterBlast { center: Int32Array; radius: number; impulse: number }
export interface MatterStepIn { tick: number; proxies: MatterProxy[]; emits: MatterEmit[]; intakes: MatterIntake[]; blasts: MatterBlast[] }
export interface MatterStepOut {
  tick: number;
  impulses: { id: number; lin: Int32Array; ang: Int32Array }[];   // summed with 64-bit carry, truncated to i32 at the end
  absorbed: { id: number; counts: Int32Array }[];                  // per intake, per kind
  counts: Int32Array;                                              // live grains per kind
  checksum: [number, number];
}
export interface MatterBackend {
  readonly kind: 'gpu' | 'cpu';
  init(cfg: { capacity: number; seed: number }): Promise<void>;
  step(input: MatterStepIn): Promise<MatterStepOut>;   // results are consumed with the fixed latency below
  snapshot(): Promise<Uint8Array>;                     // the MATR payload (DATA_FORMATS)
  restore(bytes: Uint8Array): Promise<void>;
  view?(): { device: GPUDevice; pos: GPUBuffer; vel: GPUBuffer; mat: GPUBuffer; count: number; tick: number };  // GPU only, for R4
  destroy(): void;
}
```

- **Bit-exact:** the CPU and GPU backends give identical `checksum`, `impulses`, `absorbed` and `counts` for identical inputs at every tick. That's the determinism proof (D91).
- **No floats in kernels:** integer only, checked by MX's validator.
- **Timing:** Matter ticks on every 2nd rigid tick (60 Hz). Per SIMULATION §8.5, Matter tick N reads the proxy snapshot of rigid tick 2N−4, and its impulses and absorbed counts apply at rigid tick 2N+4. A late result makes the sim wait (time dilation); it never skips.

### 2. Matter in the Machine (MI → A4, B4, F4)

MI exposes `machine.matter` (`packages/sim/src/matter/host.ts`). Part behaviours and critters only use this API; they never call the backend.

- **`emit(part, kind, count, localPos, localVel, spread)`** queues particles for the next Matter tick, in part order. Stored contents are quantities in plain state (`st`). Grains become particles only at the spout, within 0.03 m (matter.md).
- **`intake(part, localBox, kindMask, capacity)`** registers a sensor while the part is alive. `absorbed(part)` returns this rigid tick's counts per kind, with the latency above.
- **`blast(center, radius, impulse)`** is used by detonations (SIMULATION §6).
- **Body impulses are automatic** for every dynamic body inside a Matter-active AABB (padded 1 m, at most 4,096 proxies). Buoyancy, drag and grains pushing parts all come out of the particle contacts; no part computes them itself.
- **Static proxies:** the environment's collider boxes and the floor plane.
- **Queries:** `count(kind)` returns live grains, and `fill(part)` returns a container's stored quantity (0–1), which also goes in keyframes for R4.
- **Node:** goldens and fuzz run on the CPU backend with small grain counts (≤ 20k).
- **Browser:** the GPU backend runs on the renderer's GPUDevice, commanded by the sim worker (D92).
- **Checkpoints:** `MATR` sections; the Matter checksum goes into the state hash (SIMULATION §10.4); rollback restores the Matter snapshot at or before the target tick (VRAM pool, plus a CPU copy).
- **Feature flag:** `matterGameplay`. Format header fields: `requiredTier` and `counts.grains`.

### 3. Rendering (MI, MX → R4)

- **Particles:** R4 draws them straight from `backend.view()` buffers on the shared device: water with SSFR, sand and marbles as impostors, marbles as meshes at LOD0 (RENDERING §8).
- **Container fill:** from `fill(part)` in keyframes plus the art's `CAVITY__` mesh and fill LUT (matter.md fill pass). E4a supplies the cavities and LUTs.
- **Budget:** transmission plus Matter surfaces within 1.5 ms on the 16 GB tier (RENDERING §12).

### 4. Parts and critters (A4, B4)

- **Every M4 part gets the full set** (PART_SYSTEM §7–8): a def, behaviour, card, demo, golden with behaviour assertions, and a fuzz entry. Matter parts' goldens use the CPU backend.
- **Pools:**
  - YOLK is a part type (A4), and HENNY lays YOLKs as pre-built dormant pooled bodies (D66). B4 reserves the pool through A4's YOLK def.
  - TOAST CANNON slices work the same way.
- **New events:** new `EventKind`s go at the end of the table, and each stream lists its own in its notes.

### 5. Capture (C4)

- **The offline clock** is frame-indexed playback over the BakeStore, with spectacle at a fixed dt per frame and quality forced to the tier max (RENDERING §13).
- **Video:** `VideoEncoder` AV1 → HEVC → H.264, written by our own MP4 (ISO-BMFF) muxer in a worker. GIF uses our own LZW encoder; WebP stills use `canvas.toBlob`, and animated WebP uses our own RIFF writer.
- **Photo mode (F10)** and the capture dialog follow UI_UX §4.11. The Cascade Report's Share card and Record clip become live.

### 6. Exit: the D91 matrix (MX)

- **Scene:** `tools/vendor-matrix/` launches headless Chrome with a throwaway profile on adapters `default` (NVIDIA D3D12), `--use-webgpu-adapter=d3d11` and `--use-webgpu-adapter=swiftshader`, and runs the Node CPU reference. All four run the Sandstorm Matter scene: 4M sand grains and the WATERWHEEL valley proxies, from a fixed seed.
- **Comparison:** per-tick checksums over the same tick range, in a report.
- **SwiftShader is a CPU:** a shorter tick range on it is fine, as long as it covers the avalanche's start, and every implementation is compared over the shared range.
- **The full rigid + Matter Sandstorm world** (the WATERWHEEL turning) also runs in the game, with its hash sequence matching across two runs and a rollback.

## Order

1. MX publishes `backend.ts` and the CPU backend skeleton.
2. MI, A4 and B4 start against it.
3. E4a / E4b / E4c, C4, U4, F4, J4 and V4 start at once; they're independent.
4. R4 starts on fill passes and impostors with synthetic buffers, and switches to `view()` when MX's GPU backend lands.
