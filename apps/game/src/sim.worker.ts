// Sim worker (ARCHITECTURE §2, §5; SIMULATION §11): owns the Machine and bakes ahead of playback.
//
// Bake: the sim runs up to BAKE_AHEAD ticks past the playhead, storing a keyframe every KF ticks
// (transforms, part flags, link state) and every event by tick. Playback: the playhead comes from
// the shared play state {tick, speed, paused, at} (MULTIPLAYER §7.2), never passes the slower
// partner's bake head, and is drawn by interpolating keyframes, so scrubbing back is free.
// Pokes behind the bake head roll back to a checkpoint and re-bake (invisible: playback trails).
// Hashes go out 1 s behind the bake head (D59), each with the number of pokes it saw; a poke landing behind hashes
// already sent re-sends the re-baked ones, and the host compares only reports made with the same pokes (M5 desync fix,
// net hashes.ts: the bake runs up to 4 s ahead, so a poke usually lands behind sent hashes).
//
// S3 (M3 scale): keyframes live in a BakeStore (only what moved, bakestore.ts), the Jolt heap is sized to the world
// (joltHeapMB), the bake runs on a time budget per loop and reports its rate (time dilation, GAME_SPEC §6.5), and
// Bake & Watch bakes a whole run as fast as it can while playback holds, reporting progress, then plays it back.

/// <reference lib="webworker" />
import type { EnvWind, LinkRecord, PartRecord, TerrainRecord } from '@knockon/format'; // W5 (M5): EnvWind
import { isJoltAbort, isJoltOom, joltThreads, loadJolt, type JoltModule } from '@knockon/jolt'; // J5 (M5): aborts
import { joltHeapMB } from '@knockon/parts-data';
import { Machine, contactEstimate, type BodyInfo, type Poke, type SimEvent } from '@knockon/sim';
import { BakeStore, type StateArrays } from './bakestore.ts';
// MI (M4): the Matter layer. 'gpu' runs: commands to the GPU host on the main thread; 'cpu' runs: MX's CPU backend here,
// mirrored to the main thread's playback replica (matterhost.ts)
import { DEFAULT_WORLD_SEED, SyncBackendLink, matterSeed, type MatterLink, type SimFlags } from '@knockon/sim';
import { MatterCpu } from '@knockon/matter';
import { HashReporter, MAX_CHECKPOINT_BYTES } from '@knockon/net';
import { SINK_FILL_PARTICLES, sinkFilled } from '@knockon/format';
import { MatterWorkerLink, MirrorLink, type MatterChannel } from './matterhost.ts';

export interface PlayState { tick: number; speed: number; paused: boolean; at: number /* absolute ms (timeOrigin-based) */ }

export type ToWorker =
  | { type: 'start'; runId: string; parts: PartRecord[]; links: LinkRecord[]; gravity: number; air: number; preset: string; environment?: string; seed?: [number, number]; tickRate: 60 | 120; play: PlayState; terrain?: TerrainRecord | null
    /** MI (M4): sim flags (matterGameplay), and the Matter channel to the main thread with the world's grain capacity. */
    simFlags?: SimFlags; matter?: { channel: MatterChannel | null; capacity: number }; sinkFill?: boolean
    /** W5 (M5): the environment's zero-g zones on (EnvSettings.zones; default on). */
    zones?: boolean
    /** W5 (M5, D26): global wind (EnvSettings.wind). */
    wind?: EnvWind | null
    /** J4 (M4): Jolt worker threads (0 = the single-threaded build); default joltThreadsFor(). Results don't depend on it. */
    joltThreads?: number }
  | { type: 'play'; play: PlayState }
  /** S3 Bake & Watch: bake up to `seconds` of run time (or until everything has been asleep for 2 s) as fast as possible. */
  | { type: 'watch'; seconds: number }
  /** S3: back to live bake-ahead (cancels a Bake & Watch; what's baked stays). */
  | { type: 'live' }
  | { type: 'bakedMin'; tick: number }
  | { type: 'stop' }
  | { type: 'poke'; poke: Poke }
  | { type: 'exportCheckpoint'; tick: number }
  | { type: 'importCheckpoint'; blob: Uint8Array };

export type FromWorker =
  | { type: 'ready'; runId: string; bodies: BodyInfo[]; parts: number[]; links: number[]; joltThreads?: number } // U5 (M5): Jolt worker threads in use (0 = single-threaded)
  // critters: Machine.critterState, 4 bytes per part [clip, flags, emote, fsm] (contract 3);
  // carry: Machine.critterCarry, pairs [critter part index, carried part index]
  // S3: `transforms` is empty when no body moved since the last frame (keep the previous one); `rate` = sim ticks
  // baked per wall second (time dilation = rate / tickRate when the bake head limits playback)
  | { type: 'frame'; runId: string; tick: number; baked: number; waiting: boolean; transforms: Float32Array; flags: Uint8Array; meters: Uint8Array; links: Float32Array; critters: Uint8Array; carry: Int32Array; beams: Float32Array; events: SimEvent[]; rate: number
    /** MI (M4): container fill per part (× 255; empty with Matter off), and ms this frame's bake spent waiting on Matter. */
    fill?: Float32Array; matterCounts?: Int32Array; matterWaitMs?: number
    /** U5 (M5): Machine.critterTargets at the playhead: pairs [BUZZ part index, item part index]. */
    targets?: Int32Array
    /** R5 (M5): Machine.grabberJoints at the playhead: 8 floats per GRABBER [part index, yaw, shoulder, elbow, wrist pitch, wrist roll, finger opening per side, held]. */
    grabbers?: Float32Array }
  | { type: 'hash'; runId: string; tick: number; h: string; mc?: string; pk: number } // MI (M4): mc = Matter checksum (already inside h; diagnostics); M5: pk = pokes it saw
  | { type: 'baked'; runId: string; tick: number; rate?: number }
  /** S3 Bake & Watch progress (4 Hz while baking; `done` once it reaches `target` or the run settles). */
  | { type: 'bakeProgress'; runId: string; baked: number; target: number; rate: number; done: boolean; settled: boolean; keyframeMB: number }
  | { type: 'checkpoint'; runId: string; tick: number; blob: Uint8Array }
  | { type: 'resynced'; runId: string; tick: number }
  /**
   * J5 (M5): `fatal` is set when the run can't go on and the worker has dropped it: 'oom' (Jolt's fixed heap ran out,
   * `Aborted(OOM)`), 'abort' (another Jolt abort or trap) or 'error' (any other exception mid-step). The worker has
   * thrown its Jolt module away (the next start loads a fresh one); the main thread stops the run and replaces the worker.
   */
  | { type: 'error'; message: string; fatal?: { kind: 'oom' | 'abort' | 'error'; runId: string; tick: number; awake: number; heapMB: number } };

const post = (m: FromWorker, transfer: Transferable[] = []): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);
const now = (): number => performance.timeOrigin + performance.now();

const KF = 4;                 // keyframe every 4 ticks (30 Hz at 120 Hz)
const BAKE_AHEAD = 480;       // 4 s: well inside the 8 s checkpoint window, so any poke can roll back
const BAKE_BUDGET_MS = 6;     // S3: live bake time per 8 ms loop (was a fixed 48 ticks)
const WATCH_BUDGET_MS = 40;   // S3: Bake & Watch: bake in long slices, yielding for messages between them
const MAX_KEYFRAMES = 30 * 180; // 3 minutes of scrubbable history
const HASH_EVERY = 60;
const HASH_DELAY = 120;
const SETTLE_TICKS = 240;     // S3: Bake & Watch stops once nothing has moved for 2 s

let Jolt: Promise<JoltModule> | null = null;
let joltHeap = 0;
let joltThreadsNow = 0;
let joltThreadsBroken = false; // J4: the threads failed to start once: single-threaded from then on
let joltLogged = false;

/**
 * J4 (M4, D89): Jolt job threads for the test system. Needs SharedArrayBuffer (cross-origin isolation: the Host Server and
 * Vite send COOP/COEP); otherwise the single-threaded build. Default per SIMULATION §4.1: hardwareConcurrency − 3,
 * clamped 2..12 (measurements: docs/dev/M4_NOTES_J4.md). The count never changes results.
 */
const JOLT_THREADS_MAX = 12;
function joltThreadsFor(asked?: number): number {
  if (!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) return 0;
  if (asked !== undefined) return Math.max(0, Math.min(16, Math.floor(asked)));
  return Math.max(2, Math.min(JOLT_THREADS_MAX, (navigator.hardwareConcurrency || 4) - 3));
}
let m: Machine | null = null;
let runId = '';
let play: PlayState = { tick: 0, speed: 1, paused: true, at: 0 };
let bakedMin = Infinity;
let timer: ReturnType<typeof setInterval> | null = null;
let store: BakeStore | null = null;
/** S3: Bake & Watch target tick (null = live bake-ahead), and how long the machine has been asleep. */
let watch: number | null = null;
let quiet = 0;
let rate = 0;
let lastProgress = 0;
let lastFrameTick = -1;
let lastFramePost = 0;
let events: SimEvent[] = [];
let lastPlayed = -1;
const hashes = new HashReporter(HASH_EVERY, HASH_DELAY); // M5 desync fix: hashes with the pokes they saw
let lastBakedPost = 0;
/** Pokes that arrive while the machine is still being built (a rejoin sends them right after start). */
let earlyPokes: Poke[] = [];
let starting = false;

function stateArrays(): StateArrays {
  return {
    f: m!.partFlags(new Uint8Array(m!.parts.length)),
    m: m!.partMeters(new Uint8Array(m!.parts.length)),
    l: m!.linkState(new Float32Array(m!.links.length * 4)),
    c: m!.critterState(new Uint8Array(m!.parts.length * 4)),
    k: m!.critterCarry(),
    b: m!.lightBeams().slice(), // G3: beam segments for the renderer
    mf: m!.partFill(new Float32Array(m!.parts.length)), // MI (M4): Machine.partFill (A4's containers + MI's), R4's fill pass
    mc: m!.matter.active ? Int32Array.of(m!.matter.count(0), m!.matter.count(1), m!.matter.count(2)) : new Int32Array(0), // MI (M4): U4's meter
    g: m!.critterTargets().slice(), // U5 (M5): the item each BUZZ is after (B5), for the tag glyph
    gj: m!.grabberJoints().slice(), // R5 (M5): GRABBER joints (A5), for the finger pivots
  };
}


/** MI (M4): Machine options for this run's Matter (flag off: none, and the parts keep their cosmetic fallbacks). */
function matterOpts(msg: Extract<ToWorker, { type: 'start' }>): { simFlags?: SimFlags; matter?: { link: MatterLink; capacity: number; sinkFill: number } } {
  const ml = matterLink(msg);
  return ml ? { simFlags: { matterGameplay: true }, matter: ml } : {};
}

/** MI (M4): ms the bake spent blocked on Matter results since the last frame (only in 'gpu' runs). */
function matterWait(): { matterWaitMs?: number } {
  if (!gpuLink) return {};
  const w = gpuLink.waitedMs - gpuWaitSent;
  gpuWaitSent = gpuLink.waitedMs;
  return { matterWaitMs: Math.round(w * 10) / 10 };
}

/** MI (M4): this run's GPU link (its wait time is reported with each frame), or null. */
let gpuLink: MatterWorkerLink | null = null;
let gpuWaitSent = 0;

/** MI (M4): the Matter link for this run (null when Matter is off). */
function matterLink(msg: Extract<ToWorker, { type: 'start' }>): { link: MatterLink; capacity: number; sinkFill: number } | null {
  if (!msg.simFlags?.matterGameplay || !msg.matter) return null;
  const capacity = msg.matter.capacity;
  const seed = matterSeed(msg.seed ?? DEFAULT_WORLD_SEED);
  const ch = msg.matter.channel;
  // D98: the Kitchen sink's water (the Machine ignores it outside the Kitchen)
  const sinkFill = sinkFilled({ environment: msg.environment ?? '', sinkFill: msg.sinkFill === true }) ? SINK_FILL_PARTICLES : 0;
  if (ch?.mode === 'gpu') { const link = new MatterWorkerLink(ch.port, ch.sab, { capacity, seed }); gpuLink = link; return { link, capacity, sinkFill }; }
  const cpu = new MatterCpu();
  cpu.initSync({ capacity, seed });
  const local = new SyncBackendLink(cpu);
  return { link: ch ? new MirrorLink(local, ch.port, { capacity, seed }) : local, capacity, sinkFill };
}

function stepOnce(): void {
  if (!m) return;
  m.step();
  const evs = m.drainEvents();
  for (const e of evs) events.push(e);
  if (m.tick % KF === 0) store!.put(m.tick, m.changedTransforms(), stateArrays());
  if (hashes.due(m.tick)) hashes.record(m.tick, m.hash(), m.matter.active ? m.matter.checksumHex() : undefined); // MI (M4): + Matter checksum
  // S3: Bake & Watch ends once nothing has moved (no awake body, no event) for SETTLE_TICKS
  quiet = evs.length === 0 && m.asleep ? quiet + 1 : 0;
}

/** Forget the baked future after `tick` (rollback or resync re-bakes it, and re-reports its hashes: M5 desync fix). */
function truncate(tick: number): void {
  store?.truncate(tick);
  events = events.filter((e) => e.tick <= tick);
  hashes.rewind(tick);
  if (lastPlayed > tick) lastPlayed = tick;
}

function playhead(): { tick: number; waiting: boolean } {
  if (!m) return { tick: 0, waiting: false };
  const want = play.paused ? play.tick : play.tick + ((now() - play.at) * m.tickRate * play.speed) / 1000;
  // the partner's bake head holds playback but never pulls it backwards (a rejoining partner
  // starts from tick 0 and catches up within a second)
  const limit = Math.max(Math.min(m.tick, bakedMin), Math.min(lastShown, m.tick));
  if (want > limit && !play.paused) {
    // Waiting on the partner's bake head: hold, and resume from here (shared time dilation).
    // Waiting on our own (catching up after a rejoin): show the newest frame but keep the clock,
    // so playback lands back on the shared playhead once the bake catches up.
    // Rebase only for a genuinely slow partner just behind us (< 1 s): a partner (or we) catching
    // up after a rejoin is waited out without moving the shared clock.
    if (m.tick >= want && bakedMin < want && want - bakedMin < m.tickRate) play = { ...play, tick: limit, at: now() };
    return { tick: limit, waiting: true };
  }
  return { tick: Math.max(0, Math.min(want, limit)), waiting: false };
}

let lastShown = 0;

/** J5 (M5): bodies awake at the last loop (read while the module is alive, for a fatal report). */
let awakeNow = 0;

/**
 * J5 (M5): the run can't go on (an exception out of the Machine: a Jolt abort such as `Aborted(OOM)` past the fixed heap,
 * or anything else mid-step). Stops the loop and drops the run without calling into the module again (after an abort its
 * memory is in an unknown state: `destroy()` could trap or hang), throws the module away so the next start loads a fresh
 * one, and tells the main thread, which stops the run and replaces this worker (that also frees a threaded module's
 * shared heap, which its idle pthread workers would otherwise keep alive). Never silent, never a hang.
 */
function fatal(err: unknown, id = runId): void {
  const kind = isJoltOom(err) ? 'oom' : isJoltAbort(err) ? 'abort' : 'error';
  const tick = m?.tick ?? 0, heapMB = joltHeap;
  if (timer) clearInterval(timer);
  timer = null;
  m = null; // not destroyed: see above
  gpuLink = null; gpuWaitSent = 0;
  store = null; watch = null; quiet = 0; rate = 0; lastFrameTick = -1;
  hashes.reset();
  events = [];
  starting = false; earlyPokes = [];
  Jolt = null; joltHeap = 0; joltLogged = false; // (after a plain exception too: the half-stepped machine stays in that heap)
  console.error(`[sim] run stopped at tick ${tick} (${awakeNow} awake, ${heapMB} MB Jolt heap): ${String(err)}`);
  post({ type: 'error', message: String(err instanceof Error ? err.message : err), fatal: { kind, runId: id, tick, awake: awakeNow, heapMB } });
}

function loop(): void {
  // J5 (M5): an exception out of a step (a Jolt abort above all) ends the run with a report instead of an uncaught
  // error every 8 ms
  try { loopNow(); } catch (err) { fatal(err); }
}

function loopNow(): void {
  if (!m || !store) return;
  // bake toward playhead + BAKE_AHEAD, or (Bake & Watch) toward the watch target, on a time budget
  const ph0 = playhead().tick;
  const t0 = performance.now();
  const target = watch ?? ph0 + BAKE_AHEAD;
  const budget = watch !== null ? WATCH_BUDGET_MS : BAKE_BUDGET_MS;
  let n = 0;
  while (m.tick < target && performance.now() - t0 < budget) {
    stepOnce(); n++;
    if (watch !== null && quiet >= SETTLE_TICKS) break;
  }
  const dt = performance.now() - t0;
  if (n > 0) awakeNow = m.awakeBodies(); // J5 (M5)
  // bake rate (ticks per wall second) while the bake is the bottleneck: the time dilation the UI shows
  if (n > 0 && dt > 0.5) rate = rate ? rate * 0.8 + ((n * 1000) / dt) * 0.2 : (n * 1000) / dt;
  if (watch !== null) {
    const settled = quiet >= SETTLE_TICKS;
    const done = settled || m.tick >= watch;
    if (done || now() - lastProgress > 250) {
      lastProgress = now();
      post({ type: 'bakeProgress', runId, baked: m.tick, target: watch, rate: Math.round(rate), done, settled, keyframeMB: Math.round(store.bytes / 1048576) });
    }
    if (done) watch = null;
  }
  // hashes one second behind the bake head
  for (const r of hashes.take(m.tick)) post({ type: 'hash', runId, tick: r.tick, h: r.h, ...(r.mc ? { mc: r.mc } : {}), pk: r.pk });
  if (now() - lastBakedPost > 250) { lastBakedPost = now(); post({ type: 'baked', runId, tick: m.tick, rate: Math.round(rate) }); }
  // playback
  const ph = playhead();
  lastShown = ph.tick;
  const t = Math.floor(ph.tick);
  const due = t > lastPlayed ? events.filter((e) => e.tick > lastPlayed && e.tick <= t) : [];
  if (t < lastPlayed) lastPlayed = t; // scrubbed back: events replay when the playhead passes them again
  else lastPlayed = t;
  // S3: a frame whose bodies can't have moved since the last one (same tick, or nothing moving around it)
  // goes out without transforms, so a still 100k-part scene costs no copies
  if (performance.now() - lastFramePost < 14 && !due.length) return; // ≤ ~70 frames/s to the main thread
  lastFramePost = performance.now();
  const still = ph.tick === lastFrameTick || (lastFrameTick >= 0 && Math.floor(ph.tick / KF) === Math.floor(lastFrameTick / KF) && !store.moving(ph.tick));
  const fr = store.frame(ph.tick, !still);
  lastFrameTick = ph.tick;
  const tr = fr.t, fl = fr.f.slice(), me = fr.m.slice(), li = fr.l.slice(), cr = fr.c.slice(), ca = fr.k.slice(), be = fr.b.slice(), mf = fr.mf.slice(), mc = fr.mc.slice(); // MI: mf, mc
  const tg = fr.g ? fr.g.slice() : new Int32Array(0); // U5 (M5): BUZZ targets
  const gj = fr.gj ? fr.gj.slice() : new Float32Array(0); // R5 (M5): GRABBER joints
  post({ type: 'frame', runId, tick: ph.tick, baked: m.tick, waiting: ph.waiting || watch !== null, transforms: tr, flags: fl, meters: me, links: li, critters: cr, carry: ca, beams: be, events: due, rate: Math.round(rate), fill: mf, matterCounts: mc, targets: tg, grabbers: gj, ...matterWait() }, [tr.buffer, fl.buffer, me.buffer, li.buffer, cr.buffer, ca.buffer, be.buffer, mf.buffer, mc.buffer, tg.buffer, gj.buffer]);
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  m?.destroy();
  gpuLink = null; gpuWaitSent = 0; // MI (M4)
  m = null;
  store = null;
  watch = null;
  quiet = 0;
  rate = 0;
  lastFrameTick = -1;
  hashes.reset();
  events = [];
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'start': {
        stop();
        starting = true;
        // S3: a heap sized to the world (the stock 128 MB holds ~20k bodies); grows, never shrinks, per worker
        // A3: plus the contact buffers sized from the world (overflowing them breaks rollback; sim capacity.ts)
        // SIMFIX: computed once, for the heap and the Machine's contact buffers (it took ≈ 9 s, twice, at 1M parts)
        const contacts = contactEstimate(msg.parts);
        let heap = joltHeapMB(msg.parts.length, contacts);
        // J4 (M4, D89): the multithreaded build when this worker is cross-origin isolated (hash-identical at any count)
        const threads = joltThreadsBroken ? 0 : joltThreadsFor(msg.joltThreads);
        // a threaded module's shared heap stays allocated after a reload (its idle pthread workers hold it), so the
        // threaded heap grows in powers of two: at most a handful of reloads per worker
        if (threads > 0) heap = Math.min(4032, Math.max(128, 2 ** Math.ceil(Math.log2(heap))));
        if (!Jolt || heap > joltHeap || threads !== joltThreadsNow) {
          const heapMB = heap;
          // the threaded loader checks that its worker threads really start; if they don't, this worker runs the
          // single-threaded build from then on (a run must never stall on threads)
          Jolt = threads > 0
            ? loadJolt('multi', { heapMB, threads }).catch((e: unknown) => {
              joltThreadsBroken = true;
              console.warn(`[sim] Jolt worker threads unavailable (${String(e)}); using the single-threaded build`);
              return loadJolt('single', { heapMB });
            })
            : loadJolt('single', { heapMB });
          joltHeap = Math.max(heap, 128);
          joltThreadsNow = threads;
          joltLogged = false;
        }
        const J = await Jolt;
        if (!joltLogged) { joltLogged = true; const n = joltThreads(J) ?? 0; console.info(`[sim] Jolt: ${n > 0 ? `multithreaded, ${n} worker threads` : 'single-threaded'}, ${joltHeap} MB heap`); } // J4
        m = new Machine(J, { parts: msg.parts, links: msg.links }, {
          gravityPercent: msg.gravity, airPercent: msg.air, tickRate: msg.tickRate, preset: msg.preset, ...(msg.environment ? { environment: msg.environment } : {}), ...(msg.seed ? { seed: msg.seed } : {}),
          ...(msg.terrain ? { terrain: msg.terrain } : {}),
          ...(msg.zones === false ? { zones: false } : {}), // W5 (M5): zero-g zones off
          ...(msg.wind ? { wind: msg.wind } : {}), // W5 (M5, D26): global wind
          ...matterOpts(msg), // MI (M4)
          contactEstimate: contacts, // SIMFIX
        });
        runId = msg.runId;
        play = msg.play;
        bakedMin = Infinity;
        lastPlayed = -1;
        lastShown = 0;
        const first = m.changedTransforms(); // every body on the first call
        const t0 = new Float32Array(m.bodies.length * 7);
        first.idx.forEach((b, k) => t0.set(first.xf.subarray(k * 7, k * 7 + 7), b * 7));
        store = new BakeStore(KF, { t: t0, ...stateArrays() }, 768 * 1048576, MAX_KEYFRAMES * KF);
        starting = false;
        for (const pk of earlyPokes) { m.addPoke(pk); hashes.poke(pk.tick); }
        earlyPokes = [];
        post({ type: 'ready', runId, bodies: m.bodyInfo(), parts: m.parts.map((p) => p.id), links: m.links.map((l) => l.id), joltThreads: joltThreads(J) ?? 0 }); // U5 (M5): threads for the perf readout
        timer = setInterval(loop, 8);
        return;
      }
      case 'play': play = msg.play; return;
      case 'watch': {
        // S3 Bake & Watch: the history window bounds how far ahead it can bake (older keyframes fold away)
        if (!m) return;
        watch = Math.min(m.tick + Math.round(msg.seconds * m.tickRate), Math.floor(play.tick) + MAX_KEYFRAMES * KF);
        quiet = 0;
        lastProgress = 0;
        return;
      }
      case 'live': watch = null; return;
      case 'bakedMin': bakedMin = msg.tick; return;
      case 'stop': stop(); starting = false; earlyPokes = []; return;
      case 'poke': {
        if (!m) { if (starting) earlyPokes.push(msg.poke); return; }
        m.addPoke(msg.poke);
        hashes.poke(msg.poke.tick); // M5: later hashes say they saw it
        if (msg.poke.tick < m.tick) {
          const was = m.tick;
          const back = m.restore(msg.poke.tick);
          if (back < 0) { post({ type: 'error', message: `poke at tick ${msg.poke.tick} is older than the rollback window` }); return; }
          truncate(back);
          while (m.tick < was) stepOnce();
        }
        return;
      }
      case 'exportCheckpoint': {
        if (!m) return;
        const cp = m.exportCheckpoint(msg.tick);
        // MI (M4): a checkpoint with a big Matter state can outgrow the client → host message cap (net MAX_CHECKPOINT_BYTES)
        if (cp && cp.blob.length > MAX_CHECKPOINT_BYTES) { post({ type: 'error', message: `can't re-sync: the checkpoint is ${(cp.blob.length / 1048576).toFixed(1)} MB (Matter), over the ${(MAX_CHECKPOINT_BYTES / 1048576).toFixed(0)} MB message limit` }); return; }
        if (cp) post({ type: 'checkpoint', runId, tick: cp.tick, blob: cp.blob }, [cp.blob.buffer]);
        return;
      }
      case 'importCheckpoint': {
        if (!m) return;
        const was = m.tick;
        const t = m.importCheckpoint(msg.blob);
        truncate(t); // (re-reports the re-baked hashes)
        while (m.tick < was) stepOnce();
        post({ type: 'resynced', runId, tick: t });
        return;
      }
    }
  } catch (err) {
    // J5 (M5): a Jolt abort anywhere (building a huge machine can run out of heap too), or any exception while the
    // machine was being built or re-baked (start, a rollback, a re-sync), leaves no run to continue: drop it and report
    if (isJoltAbort(err) || msg.type === 'start' || msg.type === 'poke' || msg.type === 'importCheckpoint') fatal(err, msg.type === 'start' ? msg.runId : runId);
    else post({ type: 'error', message: String(err) });
  }
};
