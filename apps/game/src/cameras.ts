// Cameras (GAME_SPEC §8, M2_PLAN contract 4): one rig that main.ts drives every frame.
//
// - orbit:    today's camera (right-drag orbits, middle-drag pans, wheel zooms); F frames the selection.
// - director: auto shots scored from the event stream: energy (event weight × recency), causal-chain
//             depth from SimEvent `cause` (the head of a long chain is where the story is), hysteresis
//             against jumpy cuts, a punch-in on big detonations. Never more than one cut per 1.2 s; the
//             comfort setting `directorCutRate` (0 = never cut, 1 = frantic) stretches the minimum hold.
// - ride:     chase cam on a body: the selected part, else the most active dynamic body; level horizon.
// - overview: the whole machine from high up, with event heat markers.
// C cycles the mode. Any orbit input in another mode drops back to orbit from the current view.
// Camera shake (trauma) is scaled by `settings.comfort.shake` and off with reduced motion.

import type { PartRecord } from '@knockon/format';
import { boundsOf, propValues } from '@knockon/parts-data';
import type { V3 } from './math.ts';
import { compose, partPose, type Pose } from './scene.ts';
import { partDef } from './catalog.ts';
import type { SceneItem } from './gfx/renderer.ts';
import { settings } from './ui/settings.ts';

export type CamMode = 'orbit' | 'director' | 'ride' | 'overview';
export const CAM_MODES: readonly CamMode[] = ['orbit', 'director', 'ride', 'overview'];

/** main.ts's orbit state (mutated by its mouse handlers). */
export interface OrbitCam { yaw: number; pitch: number; dist: number; target: V3; trauma: number }

export interface Shot { readonly eye: V3; readonly target: V3; readonly fov: number }

/** The SimEvent fields the director reads (`id`/`cause` per contract 1; older events lack them). */
export interface CamEvent {
  readonly tick: number;
  readonly kind: string;
  readonly part: number;
  readonly pos: readonly number[];
  readonly mag: number;
  readonly id?: number;
  readonly cause?: number;
}

export interface CameraRun {
  readonly phase: string;
  readonly bodies: readonly { readonly part: number; readonly type: string; readonly role: string }[];
  readonly transforms: Float32Array;
  readonly tick: number;
  readonly tickRate: number;
  onEvents(fn: (e: readonly CamEvent[]) => void): void;
}

export interface CameraContext {
  readonly run: CameraRun;
  /** Every part in the document (bounds for overview and director's establishing shot). */
  parts(): Iterable<PartRecord>;
  /** Current pose of a part (run: its base body; build: the doc). */
  poseOf(p: PartRecord): Pose;
  /** The selected part ids (F frames them; ride follows the first). */
  selected(): readonly number[];
  /** Point under the cursor (F with nothing selected). */
  hover(): V3 | null;
}

/** Event weights for the director (unknown kinds count a little). */
const WEIGHT: Readonly<Record<string, number>> = {
  Detonate: 10, Break: 4, Launch: 4, Pop: 3, Ragdoll: 3, Cut: 2, Ignite: 2.5, FuseLit: 1.5, Splash: 2, Spawn: 1.5,
  Emote: 1.5, CritterState: 1, Trapped: 2.5, Getup: 1, Press: 1, Toggle: 1, Ring: 1.5, Lit: 1, Powered: 0.6,
  Signal: 0.4, Jam: 1, Brownout: 1, Note: 0.5, Sound: 0, Impact: 0, Unlit: 0.3, Unpowered: 0.3, Extinguish: 0.8,
};
const MIN_CUT_S = 1.2; // GAME_SPEC §8: never more than one cut per 1.2 s
const BLEND_S = 0.6;
/** Auto cameras keep |yaw| below this (0 = straight front): the sets are open at the front only. */
const YAW_MAX = 1.1;

interface Ev { t: number; kind: string; pos: V3; w: number; depth: number; id: number }
interface Cluster { c: V3; score: number; r: number; big: boolean }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ease = (t: number): number => t * t * (3 - 2 * t);
const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function orbitEye(target: V3, yaw: number, pitch: number, d: number): V3 {
  return [target[0] + d * Math.cos(pitch) * Math.sin(yaw), target[1] + d * Math.sin(pitch), target[2] + d * Math.cos(pitch) * Math.cos(yaw)];
}

export class CameraRig {
  mode: CamMode = 'orbit';
  /** Orbit field of view (degrees). */
  fov = 40;
  private readonly cam: OrbitCam;
  private readonly ctx: CameraContext;
  private events: Ev[] = [];
  private readonly depthOf = new Map<number, number>();
  private lastShot: Shot | null = null;
  private blendFrom: Shot | null = null;
  private blendT = 1;
  private camSnap = '';
  private tween: { from: V3; to: V3; d0: number; d1: number; t: number } | null = null;
  // director
  private dir = CameraRig.freshDirector();
  /** UIFIX (D122): the director's state at the start of a run (restart() goes back to it). */
  private static freshDirector() { return { target: [0, 0.3, 0] as V3, aim: [0, 0.3, 0] as V3, yaw: 0.6, drift: 0.05, pitch: 0.45, d: 4, dAim: 4, lastCut: -1e9, cuts: 0, score: 0, punch: 0, runT: 0 }; }
  // ride
  private ride = { body: -1, quietFor: 0, eye: null as V3 | null, vel: [0, 0, 1] as V3, prev: new Float32Array(0), speed: new Float32Array(0) };
  private clusters: Cluster[] = [];

  constructor(cam: OrbitCam, ctx: CameraContext) {
    this.cam = cam;
    this.ctx = ctx;
    ctx.run.onEvents((evs) => this.onEvents(evs));
  }

  /** C: orbit → director → ride → overview → orbit. */
  cycle(): CamMode {
    this.setMode(CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length]!);
    return this.mode;
  }

  setMode(m: CamMode): void {
    if (m === this.mode) return;
    if (m === 'orbit' && this.lastShot) this.adoptShot(this.lastShot);
    if (this.lastShot) { this.blendFrom = this.lastShot; this.blendT = 0; }
    if (m === 'director') { this.dir.lastCut = -1e9; this.dir.score = 0; }
    if (m === 'ride') { this.ride.body = -1; this.ride.eye = null; }
    this.mode = m;
    this.camSnap = this.snap();
  }

  /**
   * The editor's view as a run starts. Stop returns to it: the run camera's last shot (a ball's chase) isn't the
   * editor's pivot, and adopting it made the next edit orbit around wherever the ball had rolled.
   */
  private buildView: { target: V3; dist: number; yaw: number; pitch: number } | null = null;
  markBuild(): void {
    this.buildView = { target: [...this.cam.target] as V3, dist: this.cam.dist, yaw: this.cam.yaw, pitch: this.cam.pitch };
  }
  /** Stop: orbit at the editor view from before the run (not the run camera's last shot). */
  restoreBuild(): void {
    const v = this.buildView;
    if (v) { this.cam.target = [...v.target] as V3; this.cam.dist = v.dist; this.cam.yaw = v.yaw; this.cam.pitch = v.pitch; }
    this.tween = null;
    this.blendFrom = null;
    this.blendT = 1;
    this.mode = 'orbit';
    this.camSnap = this.snap();
  }

  /** F: frame the selection (or the point under the cursor) in orbit. */
  frame(): void {
    if (this.mode !== 'orbit') this.setMode('orbit');
    const box = this.selectionBox();
    if (box) {
      const c: V3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      const r = Math.max(0.08, dist(box.min, box.max) / 2);
      const d = Math.min(80, Math.max(0.4, (r / Math.sin((this.fov * Math.PI) / 360)) * 1.25));
      this.tween = { from: [...this.cam.target] as V3, to: c, d0: this.cam.dist, d1: d, t: 0 };
    } else {
      const h = this.ctx.hover();
      if (h) this.tween = { from: [...this.cam.target] as V3, to: [...h] as V3, d0: this.cam.dist, d1: this.cam.dist, t: 0 };
    }
  }

  /**
   * UIFIX (D122): starts the auto cameras afresh, as at the start of a live run. The offline render (capture/
   * offline.ts) rewinds the run to the clip start, so the live run's last cut, events and chain depths lie in the
   * future: without this the director held its last live shot until the clip caught up with the last live cut.
   * `history` is the run's event log up to where playback restarts (events the worker won't replay), so cause depths
   * and the first cluster match the live director's.
   */
  restart(history: readonly CamEvent[] = []): void {
    this.events = [];
    this.depthOf.clear();
    this.clusters = [];
    this.dir = CameraRig.freshDirector();
    this.ride.body = -1; this.ride.eye = null; this.ride.prev = new Float32Array(0); this.ride.quietFor = 0;
    this.lastPos.clear();
    this.blendFrom = null; this.blendT = 1;
    if (history.length) this.onEvents(history);
  }

  /** UIFIX (D122): the playhead went back (scrub, replay, offline render): drop what is now in the future. */
  private rewound(t: number): void {
    this.events = this.events.filter((e) => e.t <= t);
    if (this.dir.lastCut > t) this.dir.lastCut = -1e9;
    this.dir.runT = t;
  }

  /** UIFIX (D122, tests): director state worth asserting on. */
  get directorState(): { readonly cuts: number; readonly lastCut: number; readonly aim: V3; readonly events: number } {
    return { cuts: this.dir.cuts, lastCut: this.dir.lastCut, aim: [...this.dir.aim] as V3, events: this.events.length };
  }

  onEvents(evs: readonly CamEvent[]): void {
    const rate = this.ctx.run.tickRate || 120;
    for (const e of evs) {
      const w0 = WEIGHT[e.kind] ?? 0.5;
      let w = w0;
      if (e.kind === 'Detonate') w = 6 + 4 * Math.cbrt(Math.max(e.mag, 0.01));
      else if (e.kind === 'Impact') w = Math.min(3, e.mag / 15);
      const id = e.id ?? -1, cause = e.cause ?? -1;
      const depth = cause >= 0 ? (this.depthOf.get(cause) ?? 0) + 1 : 0;
      if (id >= 0) this.depthOf.set(id, depth);
      if (w <= 0.05) continue;
      this.events.push({ t: e.tick / rate, kind: e.kind, pos: [e.pos[0] ?? 0, e.pos[1] ?? 0, e.pos[2] ?? 0], w, depth, id });
    }
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
    if (this.depthOf.size > 20000) this.depthOf.clear();
  }

  /** Per frame: the shot to render (trauma shake applied). */
  update(dt: number, now: number): Shot {
    const run = this.ctx.run;
    if (run.phase !== 'running' && this.events.length && run.tick === 0) { this.events = []; this.depthOf.clear(); this.clusters = []; }
    // any orbit input while another mode drives the view hands control back to orbit
    if (this.mode !== 'orbit' && this.snap() !== this.camSnap) {
      const s = this.snap();
      this.setMode('orbit');
      this.camSnap = s;
    }
    let shot: Shot;
    switch (this.mode) {
      case 'director': shot = this.director(dt); break;
      case 'ride': shot = this.rideShot(dt); break;
      case 'overview': shot = this.overview(dt); break;
      default: shot = this.orbit(dt);
    }
    if (this.mode !== 'orbit') this.camSnap = this.snap();
    // mode switches blend; director cuts don't
    if (this.blendFrom && this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / BLEND_S);
      const k = ease(this.blendT);
      shot = { eye: lerpV(this.blendFrom.eye, shot.eye, k), target: lerpV(this.blendFrom.target, shot.target, k), fov: lerp(this.blendFrom.fov, shot.fov, k) };
      if (this.blendT >= 1) this.blendFrom = null;
    }
    this.lastShot = shot;
    // trauma shake (vfx §2.1): ∝ trauma², decays over ~1 s; comfort settings scale it
    const c = this.cam;
    let eye = shot.eye;
    const shake = settings.comfort.reducedMotion ? 0 : settings.comfort.shake;
    if (c.trauma > 0) {
      const s = c.trauma * c.trauma * 0.04 * dist(shot.eye, shot.target) * (shake / 0.7);
      eye = [eye[0] + Math.sin(now * 0.071) * s, eye[1] + Math.sin(now * 0.083 + 1) * s, eye[2] + Math.sin(now * 0.067 + 2) * s];
      c.trauma = Math.max(0, c.trauma - dt * 1.2);
    }
    return { eye, target: shot.target, fov: shot.fov };
  }

  /** Overview heat markers (and nothing in the other modes). */
  overlay(out: SceneItem[]): void {
    if (this.mode !== 'overview') return;
    for (const cl of this.clusters.slice(0, 12)) {
      const s = Math.min(1.5, 0.15 + Math.sqrt(cl.score) * 0.12) * Math.max(0.3, this.dir.d / 12);
      out.push({ pos: [cl.c[0], 0.004, cl.c[2]], size: [s, 0.004, s], mesh: 2, color: [1, 0.36, 0.18], emissive: Math.min(1, 0.2 + cl.score * 0.05), alpha: 0.6 });
    }
  }

  // ---- modes ---------------------------------------------------------------------------------------

  private orbit(dt: number): Shot {
    const c = this.cam;
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.35);
      const k = ease(this.tween.t);
      c.target = lerpV(this.tween.from, this.tween.to, k);
      c.dist = lerp(this.tween.d0, this.tween.d1, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    return { eye: orbitEye(c.target, c.yaw, c.pitch, c.dist), target: [...c.target] as V3, fov: this.fov };
  }

  private director(dt: number): Shot {
    const run = this.ctx.run;
    const D = this.dir;
    const t = run.tick / (run.tickRate || 120);
    if (t < D.runT - 0.25) this.rewound(t); // UIFIX (D122)
    D.runT = t;
    this.clusters = this.cluster(t);
    const rate = Math.max(0, Math.min(1, settings.comfort.directorCutRate));
    const minHold = rate <= 0 ? Infinity : Math.max(MIN_CUT_S, lerp(6, MIN_CUT_S, rate));
    const since = t - D.lastCut;
    const best = this.clusters[0];
    const here = this.clusters.find((cl) => dist(cl.c, D.aim) < Math.max(1, cl.r * 2));
    const hereScore = here?.score ?? 0;
    if (best && run.phase === 'running') {
      const isNew = !here || best !== here;
      const want = isNew && best.score > hereScore * 1.35 + 1.5;
      const bigNow = best.big && since >= MIN_CUT_S && rate > 0;
      if ((want && since >= minHold) || (want && bigNow) || D.lastCut < -1e8) {
        // cut: a fresh angle 35–70° away from the last one, height from a hash
        D.cuts++;
        const turn = (0.6 + 0.6 * hash(D.cuts)) * (hash(D.cuts + 7) < 0.5 ? -1 : 1);
        // stay on the open front side of the set (the Studio cyc and the kitchen walls close the back)
        D.yaw = Math.abs(D.yaw + turn) <= YAW_MAX ? D.yaw + turn : Math.max(-YAW_MAX, Math.min(YAW_MAX, D.yaw - turn));
        D.pitch = 0.3 + 0.35 * hash(D.cuts + 3);
        D.aim = [...best.c] as V3;
        D.target = [...best.c] as V3;
        D.dAim = Math.min(14, Math.max(1.2, 1.1 + best.r * 2.6));
        D.d = D.dAim * (best.big ? 0.8 : 1);
        D.lastCut = t;
        D.score = best.score;
      } else if (here) {
        // follow the action inside the shot
        D.aim = lerpV(D.aim, here.c, Math.min(1, dt * 1.5));
        D.dAim = Math.min(14, Math.max(1.2, 1.1 + here.r * 2.6));
        if (here.big && D.punch <= 0) D.punch = 1;
      }
    } else if (!best) {
      // nothing happening: a slow establishing orbit of the whole machine
      const b = this.bounds();
      if (b) {
        D.aim = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
        D.dAim = Math.min(60, Math.max(2.5, (dist(b.min, b.max) / 2 / Math.sin((40 * Math.PI) / 360)) * 1.05));
      }
    }
    // gentle drift keeps a held shot alive (bouncing between the front-side limits)
    if (Math.abs(D.yaw) >= YAW_MAX) D.drift = -Math.sign(D.yaw) * Math.abs(D.drift);
    D.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, D.yaw + dt * D.drift));
    D.target = lerpV(D.target, D.aim, Math.min(1, dt * 2.5));
    D.punch = Math.max(0, D.punch - dt * 1.6);
    D.d = lerp(D.d, D.dAim * (1 - 0.18 * Math.sin(Math.min(1, D.punch) * Math.PI)), Math.min(1, dt * 2));
    return { eye: orbitEye(D.target, D.yaw, D.pitch, D.d), target: [...D.target] as V3, fov: 38 };
  }

  private rideShot(dt: number): Shot {
    const run = this.ctx.run;
    const R = this.ride;
    const xf = run.transforms;
    if (run.phase !== 'running' || !xf.length) return this.orbit(dt);
    const n = run.bodies.length;
    if (R.prev.length !== n * 3) { R.prev = new Float32Array(n * 3); R.speed = new Float32Array(n); for (let i = 0; i < n; i++) R.prev.set(xf.subarray(i * 7, i * 7 + 3), i * 3); }
    // smoothed speed per body (from the playback, so it matches what's on screen)
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      const v = dt > 0 ? Math.hypot(xf[o]! - R.prev[i * 3]!, xf[o + 1]! - R.prev[i * 3 + 1]!, xf[o + 2]! - R.prev[i * 3 + 2]!) / dt : 0;
      R.speed[i] = R.speed[i]! + (Math.min(v, 50) - R.speed[i]!) * Math.min(1, dt * 4);
    }
    // chosen: the selection's base body; else the most active dynamic base body (with hysteresis)
    const sel = this.ctx.selected()[0];
    let want = sel !== undefined ? run.bodies.findIndex((b) => b.part === sel && b.role === 'base') : -1;
    if (want < 0) {
      let best = -1, bs = 0.05;
      run.bodies.forEach((b, i) => { if (b.role === 'base' && partDef(b.type)?.body.kind === 'dynamic' && R.speed[i]! > bs) { bs = R.speed[i]!; best = i; } });
      const cur = R.body;
      const curS = cur >= 0 && cur < n ? R.speed[cur]! : 0;
      R.quietFor = curS < 0.15 ? R.quietFor + dt : 0;
      want = cur < 0 || cur >= n || (best >= 0 && (R.quietFor > 1.5 || bs > curS * 2.5 + 0.5)) ? best : cur;
    }
    if (want !== R.body) { R.body = want; R.eye = null; }
    for (let i = 0; i < n; i++) R.prev.set(xf.subarray(i * 7, i * 7 + 3), i * 3);
    if (R.body < 0) return this.overview(dt);
    const o = R.body * 7;
    const p: V3 = [xf[o]!, xf[o + 1]!, xf[o + 2]!];
    // heading from the motion (kept while it rests), level horizon
    const b = run.bodies[R.body]!;
    const def = partDef(b.type);
    const size = def ? Math.max(0.1, dist(def.bounds.min as V3, def.bounds.max as V3)) : 0.3;
    const back = Math.max(0.5, size * 3), up = Math.max(0.2, size * 1.2);
    const want3 = this.headingOf(R.body, dt);
    const eyeWant: V3 = [p[0] - want3[0] * back, p[1] + up, p[2] - want3[2] * back];
    R.eye = R.eye ? lerpV(R.eye, eyeWant, Math.min(1, dt * 4)) : eyeWant;
    return { eye: R.eye, target: [p[0] + want3[0] * size, p[1] + size * 0.25, p[2] + want3[2] * size], fov: 60 };
  }

  private lastPos = new Map<number, V3>();
  private headingOf(body: number, dt: number): V3 {
    const xf = this.ctx.run.transforms, o = body * 7;
    const p: V3 = [xf[o]!, xf[o + 1]!, xf[o + 2]!];
    const last = this.lastPos.get(body);
    this.lastPos.set(body, p);
    const R = this.ride;
    if (last && dt > 0) {
      const v: V3 = [(p[0] - last[0]) / dt, 0, (p[2] - last[2]) / dt];
      const s = Math.hypot(v[0], v[2]);
      if (s > 0.08) {
        const k = Math.min(1, dt * 3);
        R.vel = [lerp(R.vel[0], v[0] / s, k), 0, lerp(R.vel[2], v[2] / s, k)];
        const l = Math.hypot(R.vel[0], R.vel[2]) || 1;
        R.vel = [R.vel[0] / l, 0, R.vel[2] / l];
      }
    }
    return R.vel;
  }

  private overview(dt: number): Shot {
    const b = this.bounds() ?? { min: [-2, 0, -2] as V3, max: [2, 1, 2] as V3 };
    const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const r = Math.max(1, dist(b.min, b.max) / 2);
    const d = Math.min(400, (r / Math.sin((40 * Math.PI) / 360)) * 1.1);
    if (this.ctx.run.phase === 'running') this.clusters = this.cluster(this.ctx.run.tick / (this.ctx.run.tickRate || 120));
    this.dir.d = d;
    void dt;
    const yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, Math.atan2(Math.sin(this.cam.yaw), Math.cos(this.cam.yaw))));
    return { eye: orbitEye(c, yaw, 1.15, d), target: c, fov: 40 };
  }

  // ---- helpers --------------------------------------------------------------------------------------

  /** Recent events (last 2.5 s of run time) grouped within 1.5 m, strongest first. */
  private cluster(t: number): Cluster[] {
    const live = this.events.filter((e) => e.t <= t + 0.05 && t - e.t < 2.5);
    const scored = live.map((e) => ({ e, s: e.w * Math.exp(-(t - e.t) / 1.0) * (1 + 0.2 * Math.min(e.depth, 10)) })).sort((a, b) => b.s - a.s);
    const out: Cluster[] = [];
    const used = new Set<number>();
    scored.forEach((a, i) => {
      if (used.has(i)) return;
      let sx = 0, sy = 0, sz = 0, sw = 0, r = 0, big = false;
      scored.forEach((b, j) => {
        if (used.has(j) || dist(a.e.pos, b.e.pos) > 1.5) return;
        used.add(j);
        sx += b.e.pos[0] * b.s; sy += b.e.pos[1] * b.s; sz += b.e.pos[2] * b.s; sw += b.s;
        r = Math.max(r, dist(a.e.pos, b.e.pos));
        if (b.e.kind === 'Detonate' && t - b.e.t < 0.6) big = true;
      });
      if (sw > 0) out.push({ c: [sx / sw, sy / sw, sz / sw], score: sw, r, big });
    });
    return out.sort((a, b) => b.score - a.score);
  }

  private bounds(): { min: V3; max: V3 } | null {
    // S3: every part's box costs ~30 ms per call at 100k parts (Domino Day): reuse it for half a second (the
    // establishing shot and overview only need the machine's rough extent, which moves slowly)
    const nowMs = performance.now();
    if (this.boundsCache && nowMs - this.boundsCache.at < 500) return this.boundsCache.b;
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    let any = false;
    // past 20k parts, a strided sample of ~20k boxes (an extent, not an exact box: no hitch on a 1M-part world)
    const stride = Math.max(1, Math.ceil(this.boundsCount / 20000));
    let k = 0;
    for (const p of this.ctx.parts()) {
      if (k++ % stride) continue;
      const b = this.partBox(p);
      if (!b) continue;
      any = true;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, b.min[i]!); max[i] = Math.max(max[i]!, b.max[i]!); }
    }
    this.boundsCount = k;
    const b = any ? { min, max } : null;
    this.boundsCache = { at: nowMs, b };
    return b;
  }
  private boundsCache: { at: number; b: { min: V3; max: V3 } | null } | null = null;
  private boundsCount = 0;

  private selectionBox(): { min: V3; max: V3 } | null {
    const ids = new Set(this.ctx.selected());
    if (!ids.size) return null;
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const p of this.ctx.parts()) {
      if (!ids.has(p.id)) continue;
      const b = this.partBox(p);
      if (!b) continue;
      any = true;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, b.min[i]!); max[i] = Math.max(max[i]!, b.max[i]!); }
    }
    return any ? { min, max } : null;
  }

  private partBox(p: PartRecord): { min: V3; max: V3 } | null {
    const def = partDef(p.type);
    if (!def) return null;
    const b = boundsOf(def, propValues(def, p.props));
    let pose: Pose;
    try { pose = this.ctx.poseOf(p); } catch { pose = partPose(p); }
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const w = compose(pose, [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]]).pos;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
    }
    return { min, max };
  }

  /** Makes orbit continue from a shot (yaw, pitch, distance around its target). */
  private adoptShot(s: Shot): void {
    const d: V3 = [s.eye[0] - s.target[0], s.eye[1] - s.target[1], s.eye[2] - s.target[2]];
    const len = Math.max(0.3, Math.hypot(d[0], d[1], d[2]));
    this.cam.target = [...s.target] as V3;
    this.cam.dist = Math.min(80, len);
    this.cam.pitch = Math.min(1.5, Math.max(0.05, Math.asin(Math.max(-1, Math.min(1, d[1] / len)))));
    this.cam.yaw = Math.atan2(d[0], d[2]);
    this.tween = null;
  }

  private snap(): string {
    const c = this.cam;
    return `${c.yaw.toFixed(5)}:${c.pitch.toFixed(5)}:${c.dist.toFixed(5)}:${c.target.map((v) => v.toFixed(5)).join(',')}`;
  }
}
