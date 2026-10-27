# KNOCK-ON Engineering Handbook

Status: v1.2 · 2026-10-25 (as built through M5) · Owner: Tech Lead
Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [SIMULATION.md](SIMULATION.md) · [PRODUCTION.md](PRODUCTION.md)

> **As built (M5 docs pass):** the project was developed through parallel workstreams following each milestone plan (`docs/dev/M*_PLAN.md`). GitHub CI now runs the portable typecheck, lint and unit-test gates. GPU, browser and long-running soak checks still run manually because they need specialized hardware or extended runtime.

---

## 1. Toolchain

*As built* (`package.json`, `apps/game/package.json`, `tsconfig.base.json`):

| Tool | Version |
|---|---|
| Node.js | 22 LTS minimum (`engines`); development is tested on Node 24 |
| pnpm | 9.15.9 (`packageManager`; workspaces in `pnpm-workspace.yaml`) |
| TypeScript | 5.6.3, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; `.ts` files run directly in Node (no build step for packages) |
| Vite | 6.0.7 (`apps/game`), with plugins in `vite.config.ts` that serve `assets/build/` and write `build.json` |
| Vitest | 2.1.8, unit and integration (`vitest.config.ts`) |
| Jolt | the published `jolt-physics` 1.1.1 WASM builds (no Emscripten build here; D99) |
| Determinism lint | `tools/lint/determinism.mjs` (a script, §4.1) |
| Blender | 4.5 LTS (asset builders, headless) |
| Runtime libraries | `msgpackr`, `fflate`, Fastify, `ws` (host). No third-party encoders (D94) |

**Planned, not set up:** `.tool-versions`, `vite-plugin-wasm`, Emscripten / `packages/jolt/BUILD.md`, Playwright, ESLint and an `@knockon/eslint-plugin`, dependency-cruiser, Git LFS.

---

## 2. Getting started (dev)

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` (`tools/dev.mjs`) starts the Host Server (API + `/ws` only) on `127.0.0.1:8787` and the Vite dev server **with COOP/COEP headers** on `http://localhost:5173`. `localhost` counts as a secure context, so WebGPU and threads work. Open two tabs to try co-op locally. (Parallel streams use their own Vite and host ports, M5_PLAN.)

*As built* (root `package.json` scripts):

| Script | Does |
|---|---|
| `pnpm dev` | Host Server + Vite with hot reload |
| `pnpm build` | `vite build` of `apps/game` into `apps/game/dist` (with `build.json`, which the host uses to refuse mismatched clients) |
| `pnpm host` | Run the Host Server (serves `dist/`; LOCAL_DEVELOPMENT §4) |
| `pnpm test` / `pnpm test:watch` | Vitest over every package and app: unit, goldens, fuzz, rollback, Matter CPU = GPU contracts, asset tests (`KNOCKON_JOLT_THREADS=N` runs tests threaded) |
| `pnpm soak` / `pnpm test:mp` | Two-client multiplayer soak: a real Host Server and two headless clients running the sim over a simulated relayed link, with random and deliberately late pokes (`-- --minutes 60`; `--player a\|b` splits it across two machines; `apps/host/soak/soak.ts`) |
| `pnpm soak:critters` | The critter rollback soak (`apps/host/soak/critters.ts`, `--matter N` adds Matter scenarios) |
| `pnpm assets` / `pnpm assets:build` | Blender make → validate → export for every part with art (`tools/assets.mjs`); `assets:check` runs its self-test, `assets:kit` the shared kit only |
| `pnpm lint` | The determinism lint (§4.1) |
| `pnpm typecheck` | `tsc` for the workspace and `apps/game` |

Benchmarks run from `apps/game/bench/` (a Vite page with its own config), and the Matter matrix from `node tools/vendor-matrix/run.mjs` (D91). KTX2 encoding is `python tools/blender/encode_ktx2.py` (D97). **Not built:** `test:golden` and `validate:parts` as separate scripts (goldens and def ↔ art checks run inside `pnpm test`), `test:browser`, `perf`, `jolt:build`, and an asset manifest.

---

## 3. Repository conventions
- Monorepo layout per ARCHITECTURE §3 and GAME_SPEC §18.2.
- **Branches:** `main` is always releasable. Feature branches are `feat/<area>-<short>`, art branches `art/<type>-<stage>`. Squash-merge via PR.
- **Commits:** Conventional Commits (`feat(sim): …`, `fix(render): …`, `art(drive): …`). A `sim!:` prefix marks a `simVersion`-bumping change.
- **Code owners:** `packages/sim`, `packages/jolt`, `packages/matter`, `packages/format` require the Sim Lead's review. `gpu-core`, `render`, `spectacle` require the Graphics Lead's review.
- **Docs:** the docs in `docs/` are part of the product. A PR that changes behaviour updates the relevant doc in the same PR. ADRs (architecture decision records) go in `docs/adr/NNNN-title.md`.
- *As built:* no branches, PRs or commits (no git, by project rule). Decisions are numbered D1–D106 in `docs/dev/DECISIONS_*.md` instead of ADRs. Each stream owns files listed in its milestone plan; shared files are changed with small, marked edits (`A5 (M5)`-style comments) through the Edit tool; streams write `docs/dev/M<N>_NOTES_<stream>.md`; the orchestrator writes the status doc. Code-owner review is the orchestrator's integration pass.

---

## 4. Coding standards
- **TypeScript:** no `any` (use `unknown` + narrowing), no default exports, explicit return types on exported functions, `readonly` by default for shared data.
- **Hot paths** (sim stages, render passes, AudioWorklet): no allocation per tick or frame. Pre-size typed arrays. No closures created per call. No `Array.prototype.map/filter` in loops over bodies or instances.
- **Workers** communicate through typed message schemas (`packages/*/protocol.ts`) and SAB rings. No ad-hoc `postMessage` payloads. *As built:* typed unions next to each worker (`ToWorker` / `FromWorker` in `apps/game/src/sim.worker.ts`, `MatterMsg` in `matterhost.ts`, the capture workers' message types), with the one SAB for Matter results (ARCHITECTURE §5); the wire protocol is `packages/net/src/protocol.ts`.
- **WGSL:** one module per file, `#include` for shared code, snake_case, explicit workgroup sizes as override constants. **Matter kernels: no `f32` or `f16`** (validator, SIMULATION §8.3). *As built:* WGSL lives in TypeScript template strings (`gfx/shaders.ts`, `gfx/look/wgsl.ts`, `packages/matter/src/wgsl.ts`, …), shared code spliced in at markers; no `#include` preprocessor. The Matter float validator is enforced by MX's tests.
- **Errors:** never swallow. Recoverable errors go through the `Recover` paths (ARCHITECTURE §8); unexpected ones crash the worker loudly in dev and trigger recovery in prod.

### 4.1 Determinism lint (`pnpm lint` = `tools/lint/determinism.mjs`, over `packages/{sim,docstore,format,net,detmath,matter,parts-data}/src`)
A regex scan of every `.ts` file in those packages; it exits non-zero on any finding. Allowed exceptions are listed in the script: `detmath/src/trig.ts` (it implements the replacements) and `net/src/clock.ts` (clock sync reads real time and never feeds the sim).

| Rule | Bans | As built |
|---|---|---|
| `no-nondeterministic-globals` | `Math.random`, `Date`, `performance`, `crypto.getRandomValues` | `Math.random()`, `Date.now()`, `new Date()`, `performance.now()`, `crypto.getRandomValues` |
| `no-platform-transcendentals` | `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/cbrt/hypot` (use `detmath`) | the same, plus `expm1`, `log1p`, `log2`, `log10`, `sinh`, `cosh`, `tanh` |
| `no-unordered-iteration` | `for…in`, `Object.keys/values/entries` over non-canonical objects | `for…in` only |
| `no-float-format-in-hash` | `toFixed`, `toPrecision`, `String(number)` in hashing or encoding | `.toFixed(` and `.toPrecision(` |
| `no-timers` | `setTimeout`, `setInterval`, `requestAnimationFrame` | the same |
| `fround-at-boundary` | Values passed to Jolt bindings must be wrapped by `f32()` | not linted; a convention in `machine.ts` and the channel code (`f32 = Math.fround`, `detmath/trig.ts`) |

---

## 5. Testing strategy

| Layer | What | Where | When |
|---|---|---|---|
| Unit | detmath accuracy, codecs, op apply/invert, behaviours (harness), protocol | Vitest (Node) | Every PR |
| Golden determinism | ~60 machines × 10,000 ticks, hash per 60 ticks vs stored | Node (WASM) | Every PR |
| Cross-platform determinism | Goldens on Chrome (x64) and Node × every available GPU vendor (Matter) | Playwright on GPU runners | Nightly + release |
| Part fuzz | Random props/placements per part, energy and NaN guards | Node | Nightly |
| Multiplayer soak | 2 headless clients, random ops/runs/pokes, 150 ms latency, 2 % loss, 30 min, zero desyncs | Node + host | Nightly |
| Visual regression | Look-dev scenes and UI screens, perceptual diff (FLIP) thresholds | Playwright GPU runners | Nightly |
| Performance | Kiloton, Sandstorm, Domino Day, Room-typical: frame and tick timings per tier | GPU runners | Nightly, fail on > 10 % regression |
| Asset validation | `validate_part.py` + `validate:parts` | Blender headless + Node | On asset PRs |
| Accessibility | axe-core on DOM screens, keyboard path tests | Playwright | Every PR (smoke) |

**Golden machines** live in `tests/goldens/<name>.knockon` with `<name>.hashes`. Updating goldens requires the `sim!:` commit marker and Sim Lead approval.

*As built:*
| Layer | Where | Run |
|---|---|---|
| Unit and integration | `packages/*/test/`, `apps/game/test/`, `apps/host/test/` (Vitest) | `pnpm test`, every stream before hand-back and at each release check |
| Goldens | Per-part goldens from `DEMOS` plus per-milestone sets, hashes pinned in the test files (`packages/sim/test/goldens*.test.ts`); the goal-type machines (`goal_types.test.ts`, D76) | `pnpm test`. A golden is re-pinned only by the stream that owns it, with the reason in its notes (M4_PLAN rule 13) |
| Thread independence | `threads.test.ts` (1 / 4 / 12 threads); Chrome runs of the same (J4, D99) | `pnpm test`; Chrome by hand |
| Part fuzz | `fuzz.test.ts` with `fuzz_scenes_{m2,m3,m4,b4,m5,b5,x5}.ts` | `pnpm test` |
| Rollback | `rollback_*.test.ts`, the critters and Matter tests (late pokes across every state switch, M5 rule 14) | `pnpm test` |
| Matter CPU = GPU | `packages/matter/test/`; the vendor matrix `tools/vendor-matrix/run.mjs` (D91) | `pnpm test`; the matrix at milestone exits |
| Multiplayer and critter soaks | `apps/host/soak/` (`soak.ts --ahead / --ahead-b` bakes ahead like the browser, M5; the critter soak includes BUZZ, its beacon, tagged items and RIFT GATES) and `apps/host/test/latepoke.test.ts` (late pokes against a real host session, D108) | Release checks (10 min, plus longer runs) |
| Accessibility | `apps/game/test/a11y.test.ts`, `contrast.test.ts` (every glass surface over white, ≥ 4.5:1) | `pnpm test` |
| Asset validation | `tools/blender/kn_tools/validate.py`, `packages/assets/test/` | `pnpm assets`, `pnpm test` |
| Browser and performance | Chrome 155 against a production build on a local test server; `apps/game/bench/` | By hand at release checks |

**Not built:** Playwright, visual regression (FLIP), axe-core, nightly runs, parser fuzzing, and the `tests/goldens/*.knockon` files (goldens are built from `DEMOS` in code).

---

## 6. CI/CD

| Pipeline | Trigger | Steps |
|---|---|---|
| **PR** | push | install → lint → typecheck → dependency rules → unit → goldens (Node) → build → browser smoke (Chromium + WebKit, SwiftShader allowed for non-GPU checks) → asset validation for touched assets |
| **Nightly** | 02:00 | Full cross-platform determinism matrix, multiplayer soak, visual regression, perf, fuzz |
| **Assets** | changes in `assets/src/**` | Blender export → gltf-transform → bake (SDF, impostor, thumbs) → upload artefacts → size report comment on the PR |
| **Release** | tag `v*` | Build → full matrix → package `apps/host` (zip + Docker image) → release notes from Conventional Commits |

**GPU runners:** local machines, connected over the team isolated test network:
- Windows + NVIDIA (RTX 40/50);
- Linux + AMD (RX 7000/9000);
- macOS + Apple Silicon (M-series);
- Windows laptop + Intel Arc/Xe.

Browsers run headed (WebGPU needs a real GPU context), using the stable channel plus the current beta.

*As built:* none of these pipelines or runners exist. The one GPU is the producer's RTX 5090; cross-vendor coverage comes from the D91 matrix (NVIDIA D3D12 and D3D11, SwiftShader, the CPU reference) until AMD, Intel and Apple hardware can be borrowed. Chrome runs headless with the GPU for scripted checks (`tools/vendor-matrix` drives it over its own CDP client). Since the GPU is shared by parallel streams, timings are provisional unless measured on a quiet GPU (M4_PLAN rule 11).

---

## 7. Performance practice
- Perf budgets live in SIMULATION §12, RENDERING §12 and UI_UX §8. They're checked in nightly perf runs on reference GPUs and fail on > 10 % regression.
- Every frame pass and sim stage has a named timer. Never ship a pass without one.
- Use the Perf HUD (F9) and "Export diagnostics" for bug reports. Attach them to issues.
- *As built:* "measure, don't estimate" (M4_PLAN rule 7). GPU passes are timed with timestamp queries (`gfx/gpu.ts` `GpuTimer`) and shown in the F9 / `?debug` readout with the VRAM ledger; the sim reports bake rate and time dilation. There are no per-stage sim timers or nightly regression gates yet; benchmark numbers live in the milestone status docs.

---

## 8. Versioning and release
- **App version:** SemVer `vMAJOR.MINOR.PATCH`.
- **`simVersion`** is independent (SIMULATION §13). Any outcome-changing change bumps it.
- **`formatVersion`** follows DATA_FORMATS §9.
- **Protocol `proto`** bumps on any wire change. The Host Server and client always ship together (the host serves the client), so mismatches only happen with stale tabs (MULTIPLAYER §8.4).
- Release artefacts: `knockon-host-<ver>.zip` (built game + host server + `README`), Docker image `knockon-host:<ver>`.
- *As built:* every package is version 0.1.0, `simVersion` is `0.0.0-dev` (SIMULATION §13), `formatVersion` is 1 and `PROTO` is 1. The client build id (`build.json`) is what the host checks. No release artefacts are packaged yet; the beta runs from `pnpm build` + `pnpm host` (LOCAL_DEVELOPMENT).

---

## 9. Security and privacy
- No third-party scripts, analytics or fonts at runtime (fonts are local, OFL).
- Dependencies: lockfile pinned, `pnpm audit` in CI, Renovate weekly with grouped updates. Jolt and other third-party WASM are vendored with checksums.
- All parsers (format, net) are fuzzed nightly (malformed `.knockon`, oversize messages).
- *As built:* no downloads without the producer's approval (project rule; D94 — the encoders are in-house). Jolt comes from the pinned npm package in `pnpm-lock.yaml`. The parsers validate counts, ranges and sizes and have unit tests for malformed input; there's no nightly fuzzing, `pnpm audit` step or Renovate.

---

## 10. Definition of done (engineering)
- Code reviewed, typed, linted; tests added; goldens updated if needed (with the `sim!:` marker).
- Perf timers present; no budget regressions.
- Docs updated (the affected doc and HOW_TO_PLAY if player-visible).
- Works in solo **and** multiplayer (op pipeline, presence where relevant).
- Accessible (keyboard path, labels, colour-independent signals).
- *M5 additions (M5_PLAN rules 14–15):* any state Jolt's saved state doesn't record is re-derived in an `afterRestore` and covered by a rollback test across the switch; it shows in the debug perf readout if it costs anything; captions for new events; HOW_TO_PLAY updated if a player can see it.
