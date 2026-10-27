// KNOCK-ON perf harness (PRODUCTION §2 M3 exit; GAME_SPEC §13, §15; RENDERING §12; SIMULATION §12): runs a
// benchmark scene through the game's real pieces and reports what M3_PLAN rule 7 asks for, measured:
//
//   load    the world-load stages: host open + snapshot encode, transfer, decode, DocStore, scene build + instance
//           upload to the first drawn frame, and (run start) the Machine build in the sim worker
//   frames  GPU frame time from timestamp queries (sum of the renderer's timed passes) and CPU time per frame,
//           at a fixed camera and with the director camera
//   run     a live run: playback frame times, the sim's bake rate (ticks/s) and time dilation
//   watch   Bake & Watch: full bake time and rate, then playback frame times at 1×
//
// Query: ?scene=kiloton|domino|big &count=1000000 &tier=4|8|12|16|32 &res=2560x1440 &mode=load|run|watch &seconds=20
//        &src=host (load through a local test server: share upload → import → join; default: in-page)
// Results land in window.__bench and the side panel.

import { DocStore, WorldDoc } from '@knockon/docstore';
import { decodeWorld, encodeWorld, posToMetres, type PartRecord, type WorldSnapshot } from '@knockon/format';
import { coveProfile, presetEye, presetOf, studioCove } from '@knockon/parts-data';
import { DEMOS } from '../../../packages/parts-data/src/demos.ts'; // RENDER (beta polish)
import type { BodyInfo, SimEvent } from '@knockon/sim';
import { ART_PARTS } from '../src/artlist.ts';
import { CameraRig, type CameraRun, type CamEvent } from '../src/cameras.ts';
import { Fx } from '../src/gfx/fx.ts';
import { loadPartMesh } from '../src/gfx/glbmesh.ts';
import { coveMesh } from '../src/gfx/meshes.ts';
import { InstanceData, Renderer, type SceneItem } from '../src/gfx/renderer.ts';
import type { V3 } from '../src/math.ts';
import { NetClient } from '../src/net.ts';
import { fillBuildScene, fillRunScene, partPose, type Pose } from '../src/scene.ts';
import type { FromWorker, ToWorker } from '../src/sim.worker.ts';
import { bigWorld, demoWorld, dominoDay, kiloton, lodMix } from './scenes.ts';
import { EnvView } from '../src/gfx/environment.ts'; // T5 (M5)
import { MatterRenderer } from '../src/gfx/matter/index.ts';
import { vramGovernor, vramLedger, TIER_BUDGET } from '../src/gfx/vram.ts';
import { MatterGpu } from '@knockon/matter/gpu';
import { prepareTick } from '../../../packages/matter/src/prep.ts';
import { sandBox, sandstorm as sandstormMatter } from '../../../packages/matter/src/scenes.ts';

// T5 (M5): every tier (4 | 8 | 12 | 16 | 32), and per-tier representative worlds:
//   &preset=room|warehouse|arena|megastructure (scene=big)   &env=moon|hangar|tinker|kitchen|backlot (the world's environment, drawn)
//   &grains=N (MX's GPU backend on the renderer's device, a settled sand box (&mscene=box) or Sandstorm (&mscene=storm):
//   ms per Matter tick over &mticks after &mwarm, then drawn by the MatterRenderer, frozen, with a close-up camera)
//   &gov=0 (the look and Spectacle governors off: the tier's settings as configured)
// and the VRAM ledger, both governors' levels and WebGPU validation errors in the result.
const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'kiloton';
const tier = Number(q.get('tier') ?? 16) as 4 | 8 | 12 | 16 | 32;
const presetArg = (q.get('preset') ?? 'megastructure') as 'megastructure' | 'arena' | 'warehouse' | 'room';
const envArg = q.get('env');
const grains = Number(q.get('grains') ?? 0);
const [W, H] = (q.get('res') ?? '2560x1440').split('x').map(Number) as [number, number];
const mode = q.get('mode') ?? 'run';
const seconds = Number(q.get('seconds') ?? 20);
const src = q.get('src') ?? 'page';
const logEl = document.getElementById('log')!;
const out: Record<string, unknown> = { scene, tier, res: `${W}x${H}`, mode, src, gpu: '', when: new Date().toISOString() };
(window as unknown as { __bench: unknown }).__bench = out;
const log = (s: string): void => { logEl.textContent += `\n${s}`; logEl.scrollTop = 1e9; console.log(`[bench] ${s}`); };
const ms = (t: number): number => Math.round(t * 10) / 10;
const frameDone = (r: Renderer): Promise<void> => r.device.queue.onSubmittedWorkDone();
/**
 * Next frame: requestAnimationFrame, or ~16 ms of MessageChannel yields when the window is occluded and the browser
 * throttles rAF and timers to ~1 Hz (the desktop app's pane does this when it loses focus). GPU timings come from
 * timestamp queries either way; frame intervals are only meaningful while rAF runs (reported as `paced`).
 */
let lastFrameAt = 0;
let throttled = false;
const raf = (): Promise<number> => new Promise((res) => {
  let done = false;
  const go = (): void => { if (!done) { done = true; lastFrameAt = performance.now(); res(lastFrameAt); } };
  requestAnimationFrame(() => { throttled = false; go(); });
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    if (done) return;
    if (performance.now() - lastFrameAt >= 20) { throttled = true; go(); } else ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
});

/** T5 (M5): one macrotask yield without the 4 ms nested-timer clamp. */
const yieldTask = (): Promise<void> => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });

function makeWorld(): WorldSnapshot {
  const w = scene === 'domino' ? dominoDay(Number(q.get('count') ?? 100_000))
    : scene === 'big' ? bigWorld(Number(q.get('count') ?? 1_000_000), presetArg)
    : scene === 'demo' ? demoWorld(q.get('demo') ?? 'grabber') // RENDER (beta polish): Library demos, visual checks
    : scene === 'lodmix' ? lodMix(Number(q.get('half') ?? 40)) : kiloton(); // RENDER (beta polish): the LOD dolly scene
  return envArg ? { ...w, env: { ...w.env, environment: envArg } } : w; // T5 (M5)
}

/** Loads the world through a local test server, the way a player joins: upload, import, join, snapshot. */
async function viaHost(bytes: Uint8Array, stages: Record<string, number>): Promise<{ net: NetClient; doc: WorldDoc }> {
  let t = performance.now();
  const up = await fetch('/share', { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' } });
  if (!up.ok) throw new Error(`share upload ${up.status}: ${await up.text()}`);
  const { id } = await up.json() as { id: string };
  const imp = await fetch(`/share/${id}/import`, { method: 'POST' });
  if (!imp.ok) throw new Error(`share import ${imp.status}: ${await imp.text()}`);
  const { worldId } = await imp.json() as { worldId: string };
  stages.setupUploadImportMs = ms(performance.now() - t);
  const net = new NetClient(tier, 'bench');
  await new Promise<void>((res) => { const off = net.on((e) => { if (e.type === 'world') { off(); res(); } }); net.connect(); });
  if (!net.me?.isHost) throw new Error('the harness must be the host player (is another client connected?)');
  // join: the host compacts, opens world.knockon (decode + journal), encodes the snapshot, sends it; we decode
  t = performance.now();
  await new Promise<void>((res) => { const off = net.on((e) => { if (e.type === 'world' && net.worldId === worldId) { off(); res(); } }); net.send(['join', { worldId }]); });
  stages.hostJoinToDocMs = ms(performance.now() - t);
  return { net, doc: net.store!.doc };
}

/**
 * Workaround while another stream's renderer change binds 17 sampled textures in the part pipelines' fragment stage
 * (the default limit is 16; this adapter allows 48): ask for the adapter's limit. Reported to the orchestrator.
 */
function liftTextureLimit(): void {
  const proto = GPUAdapter.prototype as unknown as { requestDevice: (d?: GPUDeviceDescriptor) => Promise<GPUDevice> };
  const orig = proto.requestDevice;
  proto.requestDevice = function (this: GPUAdapter, d: GPUDeviceDescriptor = {}) {
    const lim = { ...(d.requiredLimits ?? {}), maxSampledTexturesPerShaderStage: this.limits.maxSampledTexturesPerShaderStage };
    return orig.call(this, { ...d, requiredLimits: lim });
  };
}

async function main(): Promise<void> {
  if (q.get('lift') !== '0') liftTextureLimit();
  const view = document.getElementById('view')!;
  const canvas = view.querySelector('canvas')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${W / Math.min(dpr, 2)}px`;
  canvas.style.height = `${H / Math.min(dpr, 2)}px`;
  const renderer = new Renderer(canvas, { tier } as ConstructorParameters<typeof Renderer>[1]);
  await renderer.init();
  (window as unknown as { __r: unknown }).__r = renderer;
  out.gpu = renderer.gpu.description;
  log(`<b>${scene}</b> tier ${tier} ${W}×${H} (${renderer.gpu.description})`);
  let t = performance.now();
  const art = new Set<string>();
  await Promise.all([...ART_PARTS.map(async (a) => { if (await loadPartMesh(renderer, a)) art.add(a); }), renderer.loadDecalAtlas('/kit/decals_atlas.png')]);
  out.assetsMs = ms(performance.now() - t);
  const artMesh = (n: string): number | null => (renderer.lib.has(n) && (art.has(n) || art.has(n.split(':')[0]!)) ? renderer.lib.id(n) : null);
  const fx = new Fx(renderer, tier as never);
  // T5 (M5): validation errors, governors off (&gov=0), Matter on the renderer's device (&grains=N)
  const errors: string[] = [];
  out.errors = errors;
  renderer.device.addEventListener('uncapturederror', (e) => { if (errors.length < 20) errors.push((e as GPUUncapturedErrorEvent).error.message.slice(0, 300)); });
  if (q.get('gov') === '0') { renderer.lookPass.governor.enabled = false; fx.governor.enabled = false; }
  if (q.get('shfit') === '0') renderer.shadowFit = false; // RENDER (beta polish): the M5 single shadow map, for before/after
  if (q.get('lodmesh') === '0') renderer.lodByMesh = false; // RENDER (beta polish): M5's LOD sizing by inst.radius, for before/after
  const matterR = grains > 0 ? new MatterRenderer(renderer, tier) : null;
  let matterBe: MatterGpu | null = null;
  if (grains > 0) {
    const sc = q.get('mscene') === 'storm' ? sandstormMatter({ grains }) : sandBox(grains);
    const mticks = Number(q.get('mticks') ?? 60), mwarm = Number(q.get('mwarm') ?? 10);
    t = performance.now();
    matterBe = new MatterGpu(renderer.device);
    await matterBe.init({ capacity: sc.capacity, seed: sc.seed });
    if (sc.init) await matterBe.restore(sc.init);
    // the playback replica (matterhost.ts: in-game GPU Matter keeps a second backend for what's drawn): VRAM only
    const replica = q.get('replica') !== '0' ? new MatterGpu(renderer.device) : null;
    if (replica) { await replica.init({ capacity: sc.capacity, seed: sc.seed }); if (sc.init) await replica.restore(sc.init); }
    const initMs = ms(performance.now() - t);
    // MX's perf method (M4_NOTES_MX): ticks queued 3 deep, wall time over `mticks` after `mwarm`, GPU-bound
    const inflight: Promise<unknown>[] = [];
    let t0 = 0;
    for (let k = 0; k < mwarm + mticks; k++) {
      if (k === mwarm) { await Promise.all(inflight); inflight.length = 0; await frameDone(renderer); t0 = performance.now(); }
      inflight.push(matterBe.stepPacked(prepareTick(sc.input(k + 1))));
      if (inflight.length >= 3) await inflight.shift();
    }
    await Promise.all(inflight);
    const msPerTick = (performance.now() - t0) / mticks;
    out.matter = { scene: sc.name, grains, initMs, ticks: mticks, warm: mwarm, msPerTick: Math.round(msPerTick * 100) / 100, replica: !!replica, matterMB: Math.round(vramLedger.bytes('matter') / 1048576) };
    log(`Matter: ${JSON.stringify(out.matter)}`);
    const be = matterBe;
    matterR!.source = { view: () => be.view() };
  }
  // warm-up: compile every pipeline on an empty scene, so the load timing below is the world's, not the shaders'
  t = performance.now();
  renderer.setCamera([0, 2, 5], [0, 0, 0], 40);
  for (let i = 0; i < 3; i++) { renderer.draw(); await frameDone(renderer); }
  out.pipelineWarmupMs = ms(performance.now() - t);
  /** GPU ms of the passes the last resolved frame ran (G5 (M5): the timer itself now drops stale names and unwritten slots). */
  const gpuTotal = (): number => renderer.timer.total();

  // ---- the world --------------------------------------------------------------------------------------
  t = performance.now();
  const world = makeWorld();
  out.generateMs = ms(performance.now() - t);
  out.parts = world.parts.length;
  log(`generated ${world.parts.length.toLocaleString()} parts in ${out.generateMs} ms`);
  const stages: Record<string, number> = {};
  out.load = stages;
  const t0 = performance.now();
  let doc: WorldDoc;
  t = performance.now();
  const bytes = encodeWorld(world);
  stages.encodeMs = ms(performance.now() - t);
  stages.fileMB = Math.round((bytes.length / 1048576) * 100) / 100;
  let tLoad = performance.now();
  if (src === 'host') {
    doc = (await viaHost(bytes, stages)).doc;
    tLoad = performance.now() - stages.hostJoinToDocMs!;
  } else {
    t = performance.now();
    const snap = decodeWorld(bytes);
    stages.decodeMs = ms(performance.now() - t);
    t = performance.now();
    doc = new DocStore(1, WorldDoc.fromSnapshot(snap)).doc;
    stages.docstoreMs = ms(performance.now() - t);
  }
  const preset = presetOf(doc.env.preset);
  t = performance.now();
  const parts = [...doc.parts.values()];
  const data = new InstanceData();
  fillBuildScene(data, parts, { artMesh }, () => null);
  stages.sceneBuildMs = ms(performance.now() - t);
  stages.instances = data.count;
  // impostors for far parts on Arena and Megastructure (RENDERING §5: < 24 px); ?imp=0 turns them off to compare
  if (renderer.impostors) renderer.impostors.thresholdPx = preset.impostors && q.get('imp') !== '0' ? Number(q.get('imp') ?? 24) : 0;
  // T5 (M5): &impforce=24 turns impostors on for a preset without them; &up=0.667 sets the TAA upscale (internal / output)
  if (renderer.impostors && q.has('impforce')) renderer.impostors.thresholdPx = Number(q.get('impforce'));
  if (q.has('up')) { renderer.upscale = Number(q.get('up')); renderer.resize(); }
  out.impostorPx = renderer.impostors?.thresholdPx ?? 0;
  t = performance.now();
  renderer.setScene(data);
  const target = preset.camera.target as V3;
  renderer.setCamera(presetEye(preset) as V3, target, 40);
  const overlay: SceneItem[] = [];
  const cove = envArg ? null : studioCove(doc.env.preset); // T5 (M5): a set brings its own floor
  if (envArg) {
    // T5 (M5): the environment's set, its look (light rig, IBL, set shadow, practicals) and its GI statics
    const envView = new EnvView(renderer);
    const until = performance.now() + 30_000;
    const tmp: SceneItem[] = [];
    while (!envView.items({ environment: envArg, preset: doc.env.preset }, tmp) && performance.now() < until) { tmp.length = 0; renderer.draw(); await new Promise((r) => setTimeout(r, 50)); }
    // RENDER (beta polish): the set's per-frame items (far LODs, the spinning Earth) on demand: window.__envItems()
    (window as unknown as { __envView: unknown }).__envView = envView;
    (window as unknown as { __envItems: unknown }).__envItems = (): void => { const t: SceneItem[] = []; envView.items({ environment: envArg, preset: doc.env.preset }, t); renderer.setOverlay(t); };
    out.envDrawn = envView.drawn(envArg, doc.env.preset);
    out.envStandIn = envView.standIn(envArg, doc.env.preset);
    overlay.push(...tmp);
  }
  if (cove) overlay.push({ pos: [0, 0, 0], size: [1, 1, 1], mesh: renderer.addMesh(`cove:${doc.env.preset}`, [coveMesh(cove, coveProfile(cove.radius, 12))]), color: [0.46, 0.44, 0.41], rough: 0.72 });
  renderer.setOverlay(overlay);
  renderer.draw();
  await frameDone(renderer);
  stages.uploadFirstFrameMs = ms(performance.now() - t);
  stages.loadToFirstFrameMs = ms(performance.now() - (src === 'host' ? tLoad : t0) + (src === 'host' ? 0 : 0));
  if (src !== 'host') stages.loadToFirstFrameMs = ms((stages.decodeMs ?? 0) + (stages.docstoreMs ?? 0) + stages.sceneBuildMs! + stages.uploadFirstFrameMs!);
  else stages.loadToFirstFrameMs = ms(stages.hostJoinToDocMs! + stages.sceneBuildMs! + stages.uploadFirstFrameMs!);
  log(`load: ${JSON.stringify(stages)}`);

  // ---- still frames ----------------------------------------------------------------------------------
  const frames = async (n: number, cam: () => { eye: V3; target: V3 }, label: string): Promise<Record<string, number>> => {
    const gpu: number[] = [], gpuFrame: number[] = [], cpu: number[] = [], intv: number[] = [];
    let last = await raf();
    for (let i = 0; i < n; i++) {
      const now = await raf();
      intv.push(now - last); last = now;
      const c = cam();
      renderer.setCamera(c.eye, c.target, 40);
      const a = performance.now();
      fx.frame(1 / 60);
      renderer.draw();
      cpu.push(performance.now() - a);
      if (i > 10) { gpu.push(gpuTotal()); gpuFrame.push(renderer.timer.frameMs); } // T5 (M5): the passes this frame ran; G5: the GPU frame span (what the governors read)
    }
    await frameDone(renderer);
    // T5 (M5): wall time per frame paced by GPU completion (draw, wait for the queue): everything the frame costs,
    // timed passes or not (+ ~0.1–0.3 ms submit latency); the timestamp sum above only sees the timed passes
    const wall: number[] = [];
    for (let i = 0; i < 60; i++) {
      const c = cam();
      renderer.setCamera(c.eye, c.target, 40);
      const a = performance.now();
      fx.frame(1 / 60);
      renderer.draw();
      await frameDone(renderer);
      if (i >= 10) wall.push(performance.now() - a);
      await yieldTask(); // not setTimeout(0): nested timers clamp to 4 ms
    }
    // throughput with two frames in flight (the submit / completion latency hidden, as in a pipelined frame loop):
    // ms per frame = max(CPU, GPU) per frame, everything included
    const inflight: Promise<void>[] = [];
    let tq = 0;
    const NQ = 90, WQ = 10;
    for (let i = 0; i < WQ + NQ; i++) {
      if (i === WQ) { await Promise.all(inflight); inflight.length = 0; tq = performance.now(); }
      const c = cam();
      renderer.setCamera(c.eye, c.target, 40);
      fx.frame(1 / 60);
      renderer.draw();
      inflight.push(frameDone(renderer));
      if (inflight.length >= 2) await inflight.shift();
      await yieldTask();
    }
    await Promise.all(inflight);
    const throughputMs = ms((performance.now() - tq) / NQ);
    const med = (x: number[]): number => { const s = [...x].sort((p, r) => p - r); return ms(s[Math.floor(s.length / 2)] ?? 0); };
    const p95 = (x: number[]): number => { const s = [...x].sort((p, r) => p - r); return ms(s[Math.floor(s.length * 0.95)] ?? 0); };
    const r = { gpuMedianMs: med(gpu), gpuP95Ms: p95(gpu), gpuFrameMedianMs: med(gpuFrame), cpuMedianMs: med(cpu), frameIntervalMedianMs: med(intv), wallMedianMs: med(wall), wallP95Ms: p95(wall), throughputMs, timedPasses: renderer.timer.live.length };
    const ran = new Set(renderer.timer.live); // T5 (M5): this frame's passes only (G5: the passes that really ran)
    const passes = Object.fromEntries([...renderer.timer.ms].filter(([k]) => ran.has(k)).map(([k, v]) => [k, ms(v)]));
    const [iw, ih] = renderer.internalSize;
    log(`${label}: ${JSON.stringify(r)} internal ${iw}×${ih} passes ${JSON.stringify(passes)}`);
    return { ...r, internalW: iw, internalH: ih, lookGov: renderer.lookPass.governor.level, fxGov: fx.governor.level, ...Object.fromEntries(Object.entries(passes).map(([k, v]) => [`pass_${k}`, v])) };
  };
  const eye0 = presetEye(preset) as V3;
  // T5 (M5): &settle=S renders S seconds at the preset camera first (with the governors on, they settle to their level)
  for (const until = performance.now() + Number(q.get('settle') ?? 0) * 1000; performance.now() < until;) { await raf(); fx.frame(1 / 60); renderer.draw(); }
  out.stillDefaultCam = await frames(240, () => ({ eye: eye0, target }), 'still, preset camera');
  const span = Math.max(...doc.env.preset === 'megastructure' ? [500] : [preset.size[0] / 2]);
  out.stillWideCam = await frames(240, () => ({ eye: [0, span * 0.9, span * 1.2], target: [0, 0, 0] }), 'still, whole-world camera');
  // T5 (M5): a close-up on the grains (the sand box / Sandstorm valley at the origin), Matter surfaces filling the frame
  if (matterR) {
    const storm = q.get('mscene') === 'storm';
    const mEye: V3 = storm ? [0.6, 1.6, 3.6] : [1.6, 1.2, 1.9], mTgt: V3 = storm ? [-0.2, 0.3, 0] : [0, 0.08, 0];
    out.stillMatterCam = await frames(240, () => ({ eye: mEye, target: mTgt }), 'still, Matter close-up');
    matterR.enabled = false;
    out.stillMatterCamOff = await frames(120, () => ({ eye: mEye, target: mTgt }), 'still, Matter close-up, Matter off');
    matterR.enabled = true;
  }
  // T5 (M5): the VRAM ledger against the tier budget, and the VRAM governor's state
  out.vram = {
    totalMB: Math.round(vramLedger.total / 1048576), peakMB: Math.round(vramLedger.peak / 1048576), budgetMB: Math.round(TIER_BUDGET[tier] / 1048576),
    pools: Object.fromEntries([...vramLedger.pools].map(([k, v]) => [k, Math.round(v / 1048576)])),
    governorLevel: vramGovernor.level, governor: vramGovernor.describe(), line: renderer.vramLine(),
  };
  log(`VRAM: ${JSON.stringify(out.vram)}`);
  if (q.get('probe') === '1') { const pr = await renderer.runVramProbe('reserve'); out.vramProbe = pr ? { reason: pr.reason, fittedMB: Math.round(pr.fitted / 1048576), targetMB: Math.round(pr.target / 1048576), ok: pr.ok } : null; log(`VRAM probe: ${JSON.stringify(out.vramProbe)}`); }

  // debug: a downscaled JPEG of a frame from a camera, for looking at the result (window.__snap(eye, target))
  (window as unknown as { __snap: unknown }).__snap = (eye: V3 = eye0, tgt: V3 = target, w = 640): string => {
    renderer.setCamera(eye, tgt, 40);
    renderer.draw();
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = Math.round((w * canvas.height) / canvas.width);
    c2.getContext('2d')!.drawImage(canvas, 0, 0, c2.width, c2.height);
    return c2.toDataURL('image/jpeg', 0.85);
  };
  (window as unknown as { __save: unknown }).__save = (name: string, body: string): Promise<string> => fetch(`/bench-out/${name}`, { method: 'POST', body }).then((r) => r.text());
  if (mode === 'load') {
    out.done = true; log('<b>done</b>');
    void fetch(`/bench-out/${scene}-${mode}-t${tier}-${W}x${H}.json`, { method: 'POST', body: JSON.stringify(out, null, 1) });
    return;
  }

  // ---- run (live or Bake & Watch) ----------------------------------------------------------------------
  const worker = new Worker(new URL('../src/sim.worker.ts', import.meta.url), { type: 'module' });
  const tell = (m: ToWorker): void => worker.postMessage(m);
  const runState = { bodies: [] as BodyInfo[], partIds: [] as number[], transforms: new Float32Array(0), flags: new Uint8Array(0), meters: new Uint8Array(0), tick: 0, baked: 0, rate: 0, waiting: false };
  const evListeners: ((e: readonly CamEvent[]) => void)[] = [];
  const run: CameraRun = {
    get phase() { return runState.bodies.length ? 'running' : 'build'; }, get bodies() { return runState.bodies; },
    get transforms() { return runState.transforms; }, get tick() { return runState.tick; }, tickRate: 120,
    onEvents: (fn) => { evListeners.push(fn); },
  };
  const partMap = new Map(parts.map((p) => [p.id, p] as const));
  const bodyOf = new Map<number, number>();
  const poseOf = (p: PartRecord): Pose => {
    const b = bodyOf.get(p.id);
    const tr = runState.transforms;
    if (b === undefined || tr.length < b * 7 + 7) return partPose(p);
    return { pos: [tr[b * 7]!, tr[b * 7 + 1]!, tr[b * 7 + 2]!], rot: [tr[b * 7 + 3]!, tr[b * 7 + 4]!, tr[b * 7 + 5]!, tr[b * 7 + 6]!] };
  };
  const cam = { yaw: 0, pitch: (preset.camera.elevation * Math.PI) / 180, dist: preset.camera.distance, target: [...target] as V3, trauma: 0 };
  const rig = new CameraRig(cam, { run, parts: () => partMap.values(), poseOf, selected: () => [], hover: () => null });
  rig.setMode('director');
  let ready = false;
  let onReady: () => void = () => {};
  const readyP = new Promise<void>((res) => { onReady = res; });
  let bakeDone = mode !== 'watch';
  const bakeLog: Record<string, number>[] = [];
  let flagsKey = -1;
  let tStart = 0;
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'error') { log(`worker error: ${m.message}`); return; }
    if (m.type === 'ready') {
      stages.machineBuildMs = ms(performance.now() - tStart);
      runState.bodies = m.bodies; runState.partIds = m.parts;
      m.bodies.forEach((b, i) => { if (b.role === 'base') bodyOf.set(b.part, i); });
      ready = true;
      onReady();
      log(`run start: Machine built in ${stages.machineBuildMs} ms (${m.bodies.length.toLocaleString()} bodies)`);
      if (mode === 'watch') tell({ type: 'watch', seconds });
      return;
    }
    if (m.type === 'frame') {
      if (m.transforms.length) { runState.transforms = m.transforms; renderer.setBodyTransforms(m.transforms); }
      runState.tick = m.tick; runState.baked = m.baked; runState.rate = m.rate; runState.waiting = m.waiting;
      // part flags changed (lit, dead, broken…): rebuild the run scene (checksum, not a 100k-char join)
      let k = 0;
      for (let i = 0; i < m.flags.length; i++) k = (k * 31 + m.flags[i]!) | 0;
      if (k !== flagsKey) {
        flagsKey = k;
        runState.flags = m.flags; runState.meters = m.meters;
        const d = new InstanceData();
        fillRunScene(d, runState.bodies, partMap, new Map(runState.partIds.map((id, i) => [id, i])), m.flags, { artMesh }, m.meters);
        renderer.setScene(d);
        renderer.runMode = true;
      }
      if (m.events.length) {
        for (const e of m.events as SimEvent[]) if (e.kind === 'Detonate') fx.boom(e.pos as V3, e.mag);
        for (const fn of evListeners) fn(m.events);
      }
      return;
    }
    if (m.type === 'bakeProgress') {
      bakeLog.push({ baked: m.baked, rate: m.rate, keyframeMB: m.keyframeMB, wallS: ms((performance.now() - tStart) / 1000) });
      if (m.done) {
        bakeDone = true;
        out.bake = { bakedTicks: m.baked, bakedS: ms(m.baked / 120), wallS: ms((performance.now() - tStart) / 1000), meanRate: Math.round(m.baked / ((performance.now() - tStart) / 1000)), settled: m.settled, keyframeMB: m.keyframeMB };
        log(`Bake & Watch done: ${JSON.stringify(out.bake)}`);
        tell({ type: 'play', play: { tick: 0, speed: 1, paused: false, at: performance.timeOrigin + performance.now() + 100 } });
      }
    }
  };
  tStart = performance.now();
  tell({
    type: 'start', runId: 'bench', parts, links: [...doc.links.values()], gravity: doc.env.gravity, air: doc.env.air, preset: doc.env.preset, environment: doc.env.environment,
    seed: [world.seed[0], world.seed[1]], tickRate: 120, play: { tick: 0, speed: 1, paused: mode === 'watch', at: performance.timeOrigin + performance.now() + 300 },
    terrain: doc.activeTerrain(),
  });
  await readyP; // no frame loop while the worker builds: the harness mustn't compete for CPU with the stage it times
  while (!bakeDone) { await raf(); renderer.draw(); }
  // playback: per-second windows of GPU / CPU frame time, playhead, bake head and rate
  const windows: Record<string, number>[] = [];
  let last = performance.now(), winStart = last;
  let gpu: number[] = [], cpu: number[] = [], intv: number[] = [], camT: number[] = [];
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await raf();
    const now = performance.now();
    intv.push(now - last);
    const ca = performance.now();
    let shot = rig.update((now - last) / 1000, now);
    // RENDER (beta polish): scene=demo films from the demo's own orbit camera and grabs frames at &snapAt=s,s (out.snaps)
    const dc = scene === 'demo' ? DEMOS[q.get('demo') ?? 'grabber']?.camera : undefined;
    if (dc) {
      const t3 = dc.target as V3, cp = Math.cos(dc.pitch), dd = dc.dist * Number(q.get('camScale') ?? 1);
      shot = { ...shot, eye: [t3[0] + dd * cp * Math.sin(dc.yaw), t3[1] + dd * Math.sin(dc.pitch), t3[2] + dd * cp * Math.cos(dc.yaw)], target: t3, fov: 40 };
    }
    camT.push(performance.now() - ca);
    last = now;
    renderer.setCamera(shot.eye, shot.target, shot.fov);
    const a = performance.now();
    fx.frame(1 / 60);
    renderer.draw();
    cpu.push(performance.now() - a);
    gpu.push(gpuTotal()); // T5 (M5)
    if (dc) {
      const ph = runState.tick / 120, due = (q.get('snapAt') ?? '').split(',').filter(Boolean).map(Number);
      const snaps = (out.snaps ??= []) as { t: number; png: string }[];
      for (const tS of due) if (ph >= tS && !snaps.some((x) => x.t === tS)) snaps.push({ t: tS, png: canvas.toDataURL('image/png') });
    }
    if (now - winStart >= 1000) {
      const med = (x: number[]): number => { const s = [...x].sort((p, r) => p - r); return ms(s[Math.floor(s.length / 2)] ?? 0); };
      const max = (x: number[]): number => ms(Math.max(...x));
      windows.push({ s: windows.length + 1, paced: throttled ? 1 : 0, gpuMs: med(gpu), gpuMaxMs: max(gpu), cpuMs: med(cpu), camMs: med(camT), intervalMs: med(intv), fps: Math.round(1000 / med(intv)), playheadS: ms(runState.tick / 120), bakedS: ms(runState.baked / 120), rate: runState.rate, waiting: runState.waiting ? 1 : 0, overlay: renderer.stats.overlay, instances: renderer.stats.instances });
      log(`t=${windows.length}s ${JSON.stringify(windows.at(-1))}`);
      gpu = []; cpu = []; intv = []; camT = []; winStart = now;
    }
  }
  out.run = windows;
  out.bakeProgress = bakeLog;
  const worst = windows.reduce((w, x) => (x.gpuMs! > w.gpuMs! ? x : w), windows[0] ?? {});
  out.runSummary = { worstGpuMs: worst.gpuMs, worstGpuS: worst.s, medianFps: windows.map((w) => w.fps!).sort((a, b) => a - b)[Math.floor(windows.length / 2)], finalBakedS: ms(runState.baked / 120), finalPlayheadS: ms(runState.tick / 120) };
  log(`run summary: ${JSON.stringify(out.runSummary)}`);
  worker.terminate();
  out.done = true;
  log('<b>done</b>');
  void fetch(`/bench-out/${scene}-${mode}-t${tier}-${W}x${H}.json`, { method: 'POST', body: JSON.stringify(out, null, 1) });
  void posToMetres;
}

main().catch((err: unknown) => { out.error = String(err); log(`ERROR ${String(err)}`); console.error(err); });
