// M4 rows for the audio test page (audio-test.ts): live audition of every M4 part cue and loop, BISCUIT / HENNY /
// DUSTY, Matter fields (synthetic reductions), the GPU probe on synthetic grains, and the offline checks.

import type { GameAudio, LimiterStats, MatterField, SimEventLike } from './index';
import { critterRecipes } from './critters';
import { m4Recipes } from './m4';
import { emptyField, matterRecipes } from './matter';
import { MatterProbe, POS_SCALE, VEL_SCALE, reduceCpu, toField, type MatterViewLike } from './matterprobe';
import { Rng } from './rng';

type Vec = [number, number, number];
type Quat = [number, number, number, number];

/** M4 test ids (audio-test.ts TYPES). */
export const M4_TEST_TYPES: Record<number, string> = {
  110: 'grit_hopper', 111: 'hourglass', 112: 'tank', 113: 'sprinkle_can', 114: 'waterwheel', 115: 'sponge', 116: 'marble_hopper', 117: 'blowout',
  118: 'vac', 119: 'inflator', 120: 'arc_tower', 121: 'toast_cannon', 122: 'yolk', 123: 'zippy', 124: 'quack', 125: 'toast_slice',
  130: 'biscuit', 131: 'henny', 132: 'dusty',
};

export const M4_EVENTS: [string, string, number, number, number?][] = [
  ['hopper gate open', 'Open', 110, 1], ['hopper gate close', 'Close', 110, 0], ['hopper last trickle', 'Empty', 110, 0], ['hopper intake', 'Refill', 110, 0],
  ['hourglass done', 'Signal', 111, 0], ['hourglass flip', 'Flip', 111, 0], ['hourglass clink', 'Impact', 111, 0.2],
  ['tank valve', 'Open', 112, 1], ['tank gurgle (empty)', 'Empty', 112, 0], ['can tip creak', 'Tip', 113, 0], ['can latch', 'Latch', 113, 0],
  ['waterwheel stall', 'Stall', 114, 0], ['sponge squish', 'Squeeze', 115, 0], ['sponge dry bounce', 'Impact', 115, 1],
  ['marble hopper chute', 'Open', 116, 1], ['marble hopper empty', 'Empty', 116, 0], ['marble refill', 'Refill', 116, 0],
  ['blowout click', 'Powered', 117, 0], ['blowout off + cooling', 'Unpowered', 117, 0], ['vac grab', 'Attach', 118, 1], ['vac release', 'Release', 118, 0],
  ['inflator valve', 'Signal', 119, 0], ['inflator overpressure', 'Overinflate', 119, 0], ['ARC strike', 'Arc', 120, 1], ['arc power down', 'Unpowered', 120, 0],
  ['toast lever', 'Press', 121, 0], ['TOAST POP', 'Launch', 121, 3], ['toast slice lands', 'Impact', 125, 1],
  ['yolk tap', 'Impact', 122, 0.1], ['yolk splat', 'Break', 122, 0], ['yolk laid', 'Spawn', 122, 0],
  ['zippy beep', 'Signal', 123, 0], ['zippy bump', 'Impact', 123, 1], ['zippy flip', 'Flip', 123, 0],
  ['quack soft', 'Impact', 124, 0.2], ['quack med', 'Impact', 124, 1], ['quack hard', 'Impact', 124, 3], ['quack splash', 'Splash', 124, 2],
  ['hopper Valve open (A4)', 'Valve', 110, 1], ['inflator Overfill (A4)', 'Overfill', 119, 1.05], ['quack Squeak 0.9 (A4)', 'Squeak', 124, 0.9],
  ['zippy Drive 1 (A4)', 'Drive', 123, 1], ['zippy Drive −1 (reverse)', 'Drive', 123, -1], ['sponge Squeeze 800 mL', 'Squeeze', 115, 800],
  ['BISCUIT Bark (B4, 70 dB)', 'Bark', 130, 70], ['BISCUIT bark (Sound only)', 'Sound', 130, 70], ['HENNY Lay (B4)', 'Lay', 131, 1], ['henny Splat (laid yolk)', 'Splat', 131, 0.5], ['biscuit getup', 'Getup', 130, 0], ['henny ragdoll', 'Ragdoll', 131, 3],
  ['dusty bonk', 'Impact', 132, 1], ['dusty tipped over', 'Ragdoll', 132, 3], ['dusty self-right', 'Getup', 132, 0],
];

const rotX = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const F = { lit: 1, powered: 2, pressed: 4, armed: 16, fault: 64 };

/** Part loops: [label, id, type, (e 0..1, t) => [flags, meter, rot, pos]]. */
export type M4Loop = [string, number, string, (e: number, t: number) => [number, number, Quat | null, Vec]];
export const M4_LOOPS: M4Loop[] = [
  // A4 conventions: dispensers' meter = 1 + round(20 × fill), `lit` while pouring; see M4_NOTES_F4.md
  ['grit hopper pours (draining)', 110, 'grit_hopper', (e) => [F.lit, 1 + Math.round(20 * (0.9 - 0.5 * e)), null, [0, 0, 0.5]]],
  ['grit hopper refills', 110, 'grit_hopper', (e) => [0, 1 + Math.round(20 * (0.3 + 0.5 * e)), null, [0, 0, 0.5]]],
  ['hourglass running, then signals', 111, 'hourglass', (e) => [e < 0.8 ? F.lit : e < 0.9 ? F.pressed : 0, 0, null, [0, 0.1, 0.8]]],
  ['tank pours to empty (glugs, gurgle)', 112, 'tank', (e) => { const f = Math.max(0, 0.3 * (1 - 1.25 * e)); return [f > 0 ? F.lit : 0, 1 + Math.round(20 * f), null, [0, 0, 0.5]]; }],
  ['sprinkle can sprinkles, re-latches', 113, 'sprinkle_can', (e) => [e < 0.8 ? F.lit : F.armed, 0, null, [0, 0.1, 0.5]]],
  ['waterwheel turning', 114, 'waterwheel', (_e, t) => [0, 0, rotX(t * 3), [0, 0.2, 0.5]]],
  ['sponge soaks (slurp, drips), squeezed', 115, 'sponge', (e) => [(e > 0.15 ? F.lit : 0) | (e > 0.75 ? F.pressed : 0), 0, null, [0, 0.05, 0.6]]],
  ['marble hopper pours', 116, 'marble_hopper', (e) => [F.lit, 1 + Math.round(20 * (0.9 - 0.5 * e)), null, [0, 0, 0.5]]],
  ['blowout warms and blows', 117, 'blowout', (e) => [F.powered | (e < 0.2 ? F.armed : F.lit), 0, null, [0, 0.1, 0.6]]],
  ['vac (holding half way)', 118, 'vac', (e) => [F.powered | (e > 0.5 ? F.pressed : 0), 0, null, [0, 0.1, 0.6]]],
  ['inflator fills to overpressure', 119, 'inflator', (e) => [F.lit | (e > 0.85 ? F.pressed : 0), 0, null, [0, 0.1, 0.6]]],
  ['arc tower charges and arcs', 120, 'arc_tower', (e) => [F.powered | (e < 0.15 ? F.armed : F.lit), 0, null, [0, 0, 0.3]]],
  ['toast cannon toasts, then pops', 121, 'toast_cannon', (e) => [e < 0.7 ? F.armed | F.lit : F.lit, 0, null, [0, 0.05, 0.6]]],
  ['zippy drives a circle', 123, 'zippy', (_e, t) => [F.lit, 0, null, [Math.cos(t * 2) * 1.2, 0.03, Math.sin(t * 2) * 1.2]]],
];

const empty = () => ({ moving: 0, speed: 0, falling: 0, fallSpeed: 0, cx: 0, cy: 0, cz: 0, total: 0 });
/** A synthetic field: per kind, [band, moving, speed, falling, distance in front of the listener (0, 1.2, 3)]. */
export function field(spec: [kind: number, band: number, moving: number, speed: number, falling: number, d: number][]): MatterField {
  const f: MatterField = { bands: [0, 1, 2].map(() => [empty(), empty(), empty()]) };
  for (const [k, b, m, s, fall, d] of spec) f.bands[k]![b] = { moving: m, speed: s, falling: fall, fallSpeed: 1.5, cx: 0.3 * Math.sin(d), cy: 0.6, cz: 3 - d, total: m * 2 };
  return f;
}
export const MATTER_SCENES: [string, (e: number) => MatterField][] = [
  ['sand trickle (near)', (e) => field([[0, 0, 30 + 60 * e, 0.25, 20, 0.8]])],
  ['sand pour (1–3 m)', () => field([[0, 0, 800, 0.5, 600, 1.2], [0, 1, 6000, 0.35, 1500, 2.5]])],
  ['sand avalanche (4 m)', (e) => field([[0, 1, 300000 * e, 0.4, 20000 * e, 4]])],
  ['Sandstorm (4M grains, far)', (e) => field([[0, 1, 200000 + 200000 * e, 0.45, 40000, 6], [0, 2, 2000000, 0.5, 300000, 14]])],
  ['water drips (near)', () => field([[1, 0, 8, 0.3, 6, 0.8]])],
  ['water stream (near + 3 m)', () => field([[1, 0, 300, 0.8, 200, 1.2], [1, 1, 3000, 0.5, 400, 3]])],
  ['water flood (4 m)', (e) => field([[1, 1, 100000 * e, 0.7, 10000 * e, 4]])],
  ['marbles (a few, near)', () => field([[2, 0, 4, 0.4, 1, 1]])],
  ['marble pour (3 m)', () => field([[2, 1, 400, 0.6, 150, 3]])],
  ['marble avalanche (4 m)', (e) => field([[2, 1, 20000 * e, 0.5, 2000 * e, 4]])],
  ['all three at once', () => field([[0, 1, 50000, 0.4, 5000, 3], [1, 0, 300, 0.8, 200, 1.2], [2, 1, 800, 0.6, 200, 3.5]])],
];

// ---------------------------------------------------------------------------------------------
// live
// ---------------------------------------------------------------------------------------------

export interface LiveKit {
  ga: GameAudio;
  btn(label: string, fn: () => void, parent?: HTMLElement): void;
  row(title: string): HTMLElement;
  now(): number;
  simulate(sec: number, fn: (e: number, dt: number) => void): void;
  cueRow(title: string, names: string[]): void;
  ev(t: number, kind: string, part: number, pos: Vec, mag?: number, other?: number): SimEventLike;
  partType(id: number): string | undefined;
  clip(n: string): number;
}

export function liveM4(k: LiveKit): void {
  const { ga, btn, row, now, simulate, ev, partType } = k;
  const r1 = row('M4 events');
  for (const [label, kind, part, mag, other] of M4_EVENTS) btn(label, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), kind, part, [(Math.random() - 0.5) * 2, 0.3, 0], mag, other)], partType); }, r1);
  const r2 = row('M4 loops (simulated run)');
  for (const [label, id, type, f] of M4_LOOPS) {
    btn(label, () => { let t = 0; simulate(5, (e, dt) => { t += dt; const [flags, meter, rot, pos] = f(e, t); ga.part(id, type, pos, flags, meter, rot, null, null); }); }, r2);
  }
  btn('yolk rolls', () => simulate(3, (e) => ga.roller('y1', 'yolk', [-1.5 + 3 * e, 0.03, 0.5])), r2);
  const r3 = row('M4 critters (simulated)');
  const crit = (label: string, id: number, type: string, sec: number, st: (e: number, t: number) => [Vec, number[], number?]): void => {
    btn(label, () => { let t = 0; simulate(sec, (e, dt) => { t += dt; const [p, b, m] = st(e, t); ga.part(id, type, p, 0, m ?? 0, null, b); }); }, r3);
  };
  crit('Biscuit walk-by', 130, 'biscuit', 4, (e) => [[-3 + 6 * e, 0, 0], [k.clip('walk'), 0, 0, 0]]);
  crit('Biscuit chase (barks)', 130, 'biscuit', 4, (e, t) => {
    if (Math.floor(t / 1.5) !== Math.floor((t - 1 / 60) / 1.5)) ga.onSimEvents([ev(now(), 'Sound', 130, [-4 + 9 * e, 0.3, 0], 70)], partType);
    return [[-4 + 9 * e, 0, 0], [k.clip('chase'), 0, 0, 0]];
  });
  crit('Biscuit nap (snore)', 130, 'biscuit', 6, () => [[0, 0, 0], [k.clip('sleep'), 4, 0, 0]]);
  crit('Biscuit happy (pant)', 130, 'biscuit', 4, () => [[0, 0, 0.5], [k.clip('emote_happy'), 0, 0, 0]]);
  crit('Henny idle clucks', 131, 'henny', 8, () => [[0.4, 0, 0], [k.clip('idle'), 0, 0, 0]]);
  crit('Henny startled: flaps up 1 m', 131, 'henny', 2.5, (e) => [[0, e < 0.2 ? 0 : Math.max(0, Math.sin(Math.PI * Math.min(1, (e - 0.2) / 0.5))), 0.5], [k.clip(e < 0.2 ? 'idle' : 'startled'), 0, 0, 0]]);
  btn('Henny lays a Yolk', () => { let t = 0; simulate(3, (e, dt) => { t += dt; ga.part(131, 'henny', [0, 0, 0.5], 0, 0, null, [k.clip('idle'), 0, 0, 0]); if (t > 0.3 && t - dt <= 0.3) ga.onSimEvents([ev(now(), 'Spawn', 122, [0, 0.1, 0.5], 0, 131)], partType); void e; }); }, r3);
  crit('Henny roosts', 131, 'henny', 6, () => [[0, 0, 0], [k.clip('sleep'), 4, 0, 0]]);
  crit('Dusty roams, bin fills → burp', 132, 'dusty', 8, (e, t) => [[Math.cos(t * 0.8) * 1.5, 0, Math.sin(t * 0.8) * 1.5 - 1], [k.clip('walk'), 0, 0, 0], 255 * Math.min(1, e * 1.1)]);
  crit('Dusty idle boops', 132, 'dusty', 8, () => [[0, 0, 0], [k.clip('idle'), 0, 0, 0], 0]);
  const r4 = row('Matter (synthetic fields)');
  for (const [label, f] of MATTER_SCENES) btn(label, () => simulate(5, (e) => ga.matterField(f(e))), r4);
  const pr = row('Matter GPU probe');
  const out = document.createElement('span');
  out.style.cssText = 'font: 12px monospace; margin-left: 8px';
  btn('bench 4M grains', async () => { out.textContent = 'running…'; out.textContent = await probeBench(4_000_000); }, pr);
  btn('bench 1M grains', async () => { out.textContent = 'running…'; out.textContent = await probeBench(1_000_000); }, pr);
  btn('listen: probe → audio (8 s)', () => void probeListen(ga, simulate), pr);
  pr.appendChild(out);
  k.cueRow('All M4 part cues', m4Recipes().map((r) => r[0]));
  k.cueRow('All critter cues (M4 included)', critterRecipes().filter((r) => /^(biscuit|henny|dusty)\/|loop\/(pant|dogsnore|roost|drive|vacuum|binrattle)/.test(r[0])).map((r) => r[0]));
  k.cueRow('Matter fallback beds', matterRecipes().map((r) => r[0]));
}

// ---------------------------------------------------------------------------------------------
// GPU probe on synthetic grains
// ---------------------------------------------------------------------------------------------

/** A synthetic Matter world: an 8 × 8 m valley floor of resting grains, an avalanche slope and a pour column near x = 1 m. */
export function synthGrains(n: number, seed = 'probe'): { pos: Int32Array; vel: Int32Array; mat: Uint32Array } {
  const rng = new Rng(seed);
  const pos = new Int32Array(n * 3), vel = new Int32Array(n * 3), mat = new Uint32Array(n);
  const U = 1 / POS_SCALE, V = 1 / VEL_SCALE;
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    let x: number, y: number, z: number, vx = 0, vy = 0, vz = 0;
    if (r < 0.7) { x = rng.range(-4, 4); z = rng.range(-6, 2); y = rng.range(0, 0.2); } // resting floor
    else if (r < 0.95) { x = rng.range(-3, -1); z = rng.range(-3, 0); y = 0.2 + 0.5 * (x + 3); vx = 0.4 + 0.3 * rng.next(); vy = -0.2; vz = rng.bi() * 0.1; } // avalanche
    else { x = 1 + rng.bi() * 0.03; z = rng.bi() * 0.03; y = rng.range(0.2, 1.2); vy = -1 - 2 * rng.next(); } // pour column
    pos[3 * i] = Math.round(x * U); pos[3 * i + 1] = Math.round(y * U); pos[3 * i + 2] = Math.round(z * U);
    vel[3 * i] = Math.round(vx * V); vel[3 * i + 1] = Math.round(vy * V); vel[3 * i + 2] = Math.round(vz * V);
    mat[i] = r > 0.95 ? (i % 3 === 0 ? 1 : 0) : r > 0.9 ? 2 : 0;
  }
  return { pos, vel, mat };
}

let benchDev: { device: GPUDevice; n: number; view: MatterViewLike; cpu: { pos: Int32Array; vel: Int32Array; mat: Uint32Array } } | null = null;
async function benchWorld(n: number): Promise<NonNullable<typeof benchDev> | string> {
  if (benchDev && benchDev.n === n) return benchDev;
  if (!navigator.gpu) return 'no WebGPU';
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return 'no adapter';
  const device = await adapter.requestDevice(adapter.features.has('timestamp-query') ? { requiredFeatures: ['timestamp-query'] } : {});
  const cpu = synthGrains(n);
  const mk = (a: Int32Array | Uint32Array): GPUBuffer => { const b = device.createBuffer({ size: a.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, a); return b; };
  benchDev?.device.destroy();
  benchDev = { device, n, cpu, view: { device, pos: mk(cpu.pos), vel: mk(cpu.vel), mat: mk(cpu.mat), count: n } };
  return benchDev;
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

/**
 * Times the probe on `n` synthetic grains (own WebGPU device): GPU time per probe = (submit + onSubmittedWorkDone)
 * minus an empty submit, CPU encode time, readback latency; and checks the GPU sums against the CPU reference.
 */
export async function probeBench(n: number): Promise<string> {
  const w = await benchWorld(n);
  if (typeof w === 'string') return w;
  const { device, view, cpu } = w;
  const L: Vec = [0, 1.2, 3];
  const probe = new MatterProbe(device);
  const wait = async (): Promise<MatterField | null> => { for (let k = 0; k < 400; k++) { const f = probe.poll(); if (f) return f; await new Promise((r) => setTimeout(r, 2)); } return null; };
  // correctness: the first probe vs the CPU reference at the same stride and phase
  probe.request(view, L);
  const gpu = await wait();
  const stride = probe.stats.stride, phase = probe.stats.phase;
  const ref = toField(reduceCpu(cpu.pos, cpu.vel, (i) => cpu.mat[i]!, n, L, stride, phase), L, stride);
  let maxRel = 0;
  if (gpu) for (let kk = 0; kk < 3; kk++) for (let b = 0; b < 3; b++) {
    const g = gpu.bands[kk]![b]!, r = ref.bands[kk]![b]!;
    for (const key of ['moving', 'speed', 'falling', 'total'] as const) { const d = Math.abs(g[key] - r[key]) / Math.max(1e-6, Math.abs(r[key])); if (r[key] > 0 && d > maxRel) maxRel = d; }
  }
  // timing
  const gpuMs: number[] = [], baseMs: number[] = [], encMs: number[] = [], lat: number[] = [], tsMs: number[] = [];
  for (let k = 0; k < 24; k++) {
    let a = performance.now();
    device.queue.submit([device.createCommandEncoder().finish()]);
    await device.queue.onSubmittedWorkDone();
    baseMs.push(performance.now() - a);
    a = performance.now();
    probe.request(view, L);
    encMs.push(performance.now() - a);
    await device.queue.onSubmittedWorkDone();
    gpuMs.push(performance.now() - a);
    await wait();
    lat.push(probe.stats.lastMs);
    if (probe.stats.gpuMs >= 0) tsMs.push(probe.stats.gpuMs);
  }
  probe.destroy();
  const g = median(gpuMs.slice(4)) - median(baseMs.slice(4));
  const sand = gpu?.bands[0];
  return `${(n / 1e6).toFixed(1)}M grains, stride ${stride} (${probe.stats.sampled} sampled): GPU timestamps ${tsMs.length ? median(tsMs).toFixed(3) + ' ms' : 'n/a'} (median, min ${tsMs.length ? Math.min(...tsMs).toFixed(3) : '-'}), wall ≈ ${g.toFixed(3)} ms/probe (submit→done ${median(gpuMs.slice(4)).toFixed(3)} − empty ${median(baseMs.slice(4)).toFixed(3)}), encode ${median(encMs).toFixed(3)} ms CPU, readback latency ${median(lat).toFixed(2)} ms; GPU vs CPU ref max rel err ${maxRel.toExponential(2)}; sand moving near/mid/far ${sand ? sand.map((b) => Math.round(b.moving)).join('/') : '?'}`;
}

/** Live: the probe on the synthetic 1M world, listener orbiting it, fed to the game audio (what main.ts does). */
async function probeListen(ga: GameAudio, simulate: LiveKit['simulate']): Promise<void> {
  const w = await benchWorld(1_000_000);
  if (typeof w === 'string') return;
  ga.setMatterView(() => w.view);
  simulate(8, (e) => { const a = e * Math.PI * 2; ga.setListener({ pos: [Math.cos(a) * 4, 1.5, Math.sin(a) * 4 - 1.5], forward: [-Math.cos(a), -0.3, -Math.sin(a)], up: [0, 1, 0] }); });
  setTimeout(() => { ga.setMatterView(null); ga.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] }); }, 8200);
}

// ---------------------------------------------------------------------------------------------
// offline checks
// ---------------------------------------------------------------------------------------------

export interface Expect {
  silentOk?: [number, number][]; minPeakDb?: number; slots?: [number, number][]; env?: string; noWorklet?: boolean;
  check?: (g: GameAudio, buf: AudioBuffer, lim: LimiterStats[]) => string;
  rms?: { from: number; to: number; lo: number; hi: number };
}
export interface OfflineKit {
  render(name: string, sec: number, script: (g: GameAudio, t: number, i: number) => void, expect?: Expect): Promise<unknown>;
  add(r: unknown): void;
  slotted(n: number, w: number, t0?: number): [number, number][];
  atSlot(t: number, w: number, t0?: number): number;
  ev(t: number, kind: string, part: number, pos: Vec, mag?: number, other?: number): SimEventLike;
  partType(id: number): string | undefined;
  clip(n: string): number;
  result(name: string, ok: boolean, note: string): void;
}

export async function offlineM4(k: OfflineKit): Promise<void> {
  const { render, add, slotted, atSlot, ev, partType, clip } = k;

  add(await render('M4 event one-shots', M4_EVENTS.length * 0.7 + 3, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const s = atSlot(t, 0.7);
    if (s >= 0 && s < M4_EVENTS.length) { const [, kind, part, mag, other] = M4_EVENTS[s]!; g.onSimEvents([ev(t, kind, part, [0.5, 0.3, 0.5], mag, other)], partType); }
  }, { slots: slotted(M4_EVENTS.length, 0.7) }));

  add(await render('M4 loops via part()', M4_LOOPS.length * 1.8 + 2.6, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const s = Math.floor((t - 0.2) / 1.8);
    if (t > 0.2 && s < M4_LOOPS.length) {
      const [, id, type, f] = M4_LOOPS[s]!;
      const [flags, meter, rot, pos] = f(((t - 0.2) % 1.8) / 1.8, t);
      g.part(id, type, pos, flags, meter, rot, null, null);
    } else if (t > 0.2 + M4_LOOPS.length * 1.8 && t < 0.2 + M4_LOOPS.length * 1.8 + 2) g.roller('y', 'yolk', [-1 + (t - 0.2 - M4_LOOPS.length * 1.8), 0.03, 0.5]);
  }, { slots: [...M4_LOOPS.map((_, s) => [0.5 + s * 1.8, 0.2 + (s + 1) * 1.8] as [number, number]), [0.5 + M4_LOOPS.length * 1.8, 2.1 + M4_LOOPS.length * 1.8]] }));

  // BISCUIT, HENNY, DUSTY: walk + barks, nap, flap-up, egg, roam + bin fill
  let laidSeen = 0, burps = 0;
  add(await render('M4 critters: Biscuit, Henny, Dusty', 15, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    if (t > 0.2 && t < 3.2) {
      g.part(130, 'biscuit', [-1.5 + (t - 0.2), 0, 0], 0, 0, null, [clip('chase'), 0, 0, 0]);
      if (i % 90 === 30) g.onSimEvents([ev(t, 'Sound', 130, [-1.5 + (t - 0.2), 0.3, 0], 70)], partType);
    } else if (t > 3.2 && t < 5.2) g.part(130, 'biscuit', [1.5, 0, 0], 0, 0, null, [clip('sleep'), 4, 0, 0]);
    else if (t > 5.2 && t < 7.7) {
      const e = (t - 5.2) / 2.5;
      g.part(131, 'henny', [0, e < 0.15 ? 0 : Math.max(0, Math.sin(Math.PI * Math.min(1, (e - 0.15) / 0.4))), 0.5], 0, 0, null, [clip(e < 0.15 ? 'idle' : 'startled'), 0, 0, 0]);
      if (i === 400) { g.onSimEvents([ev(t, 'Spawn', 122, [0, 0.1, 0.5], 0, 131)], partType); laidSeen = 1; }
    } else if (t > 7.7 && t < 14.7) {
      const e = (t - 7.7) / 7;
      g.part(132, 'dusty', [Math.cos(t) * 1.2, 0, Math.sin(t) * 1.2 - 0.5], 0, 255 * Math.min(1, e * 1.15), null, [clip('walk'), 0, 0, 0]);
      if (i === 700) g.onSimEvents([ev(t, 'Impact', 132, [0, 0.05, 0], 1)], partType);
      if (e > 0.9) burps = 1;
    }
  }, { slots: [[0.4, 3.2], [3.4, 5.2], [5.4, 7.7], [7.9, 14.7]], check: (g) => (g.stats.faults ? `!${g.stats.faults} faults` : `egg ${laidSeen}, bin full reached ${burps}`) }));

  // Matter: every synthetic scene, worklet engine and fallback beds; each must be audible and stay sane
  const scenes = MATTER_SCENES;
  const matterRun = (name: string, noWorklet: boolean) => render(name, scenes.length * 1.6 + 1, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const s = Math.floor((t - 0.2) / 1.6);
    if (t > 0.2 && s < scenes.length) g.matterField(scenes[s]![1](((t - 0.2) % 1.6) / 1.6));
  }, {
    noWorklet, slots: scenes.map((_, s) => [0.6 + s * 1.6, 0.2 + (s + 1) * 1.6] as [number, number]),
    check: (g) => (g.stats.faults ? `!${g.stats.faults} faults` : `engine ${g.stats.matterMode}`),
  });
  add(await matterRun('Matter: sand / water / marble fields (granular worklet)', false));
  add(await matterRun('Matter: fallback beds (no AudioWorklet)', true));
  // the field must fall silent when the run pauses, and when the field stops arriving (stale after 0.5 s)
  add(await render('Matter: pause and stale field fall silent', 5, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(t > 1.5 && t < 2.5, 1, t * 120);
    if (t < 3.2) g.matterField(field([[0, 1, 50000, 0.4, 5000, 3]]));
  }, { silentOk: [[0, 9]], check: (g, buf) => {
    const q = (a: number, b: number) => { let p = 0; for (const ch of [buf.getChannelData(0), buf.getChannelData(1)]) for (let j = Math.round(a * 48000); j < b * 48000; j++) p = Math.max(p, Math.abs(ch[j]!)); return 20 * Math.log10(p + 1e-12); };
    const loud = q(0.8, 1.4), paused = q(2.0, 2.4), stale = q(4.4, 4.9);
    return paused > -50 || stale > -50 || loud < -40 ? `!loud ${loud.toFixed(1)} / paused ${paused.toFixed(1)} / stale ${stale.toFixed(1)} dB` : `loud ${loud.toFixed(1)} dB, paused ${paused.toFixed(1)}, stale ${stale.toFixed(1)}, faults ${g.stats.faults}`;
  } }));

  // budget: 30 M4 part loops, the three new critters ×2, every Matter stream, booms, impacts, the Tinker Lab, music
  let maxV = 0, js = 0, jsMax = 0, frames = 0, frameMs = 0;
  add(await render('M4 stress: voice budget + CPU per frame', 6, (g, t, i) => {
    if (i === 1) g.setMode('running');
    const a = performance.now();
    g.setPlayback(false, 1, t * 120);
    for (let s = 0; s < 30; s++) { const [, , type, f] = M4_LOOPS[s % M4_LOOPS.length]!; const [flags, meter, rot] = f((t % 3) / 3, t); g.part(700 + s, type, [Math.sin(s) * 3, 0.3, Math.cos(s) * 3], flags, meter, rot, null, null); }
    const sp = ['biscuit', 'henny', 'dusty'] as const;
    for (let c = 0; c < 6; c++) g.part(800 + c, sp[c % 3]!, [Math.sin(t + c) * 2, 0, Math.cos(t + c) * 2], 0, 128, null, [clip(c % 2 ? 'run' : 'idle'), 0, 0, 0]);
    g.matterField(field([[0, 0, 900, 0.5, 400, 1], [0, 1, 80000, 0.4, 8000, 4], [1, 0, 300, 0.8, 200, 1.2], [1, 1, 20000, 0.6, 3000, 3], [2, 0, 30, 0.5, 5, 1], [2, 1, 2000, 0.5, 300, 3]]));
    for (let r = 0; r < 6; r++) g.roller(`y${r}`, 'yolk', [Math.sin(t * 2 + r) * 1.5, 0.03, Math.cos(t * 2 + r) * 1.5]);
    if (t > 1 && t < 4) g.onSimEvents([ev(t, 'Detonate', 2000 + i, [Math.sin(i) * 4, 0.1, -3], 3), ev(t, 'Impact', 124, [0, 0.1, 0], 1), ev(t, 'Arc', 120, [1, 0.3, 0], 1), ev(t, 'Sound', 800, [0, 0.3, 0], 70)], partType);
    const d = performance.now() - a;
    js += d; jsMax = Math.max(jsMax, d); frames++;
    frameMs = Math.max(frameMs, g.stats.frameMs);
    maxV = Math.max(maxV, g.stats.voices + g.stats.loops + g.stats.ambience + g.stats.matter);
  }, { env: 'tinker', check: (g) => `${maxV > 64 ? '!' : ''}peak voices ${maxV}/64 (matter ${g.stats.matter}), JS part()+events ${(js / frames).toFixed(3)} ms/frame avg (max ${jsMax.toFixed(2)}), frame() EMA max ${frameMs.toFixed(3)} ms, stolen ${g.stats.stolen}, faults ${g.stats.faults}` }));

  add(await render('robustness M4: NaN, Infinity, junk fields', 4, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const N = Number.NaN, I = Number.POSITIVE_INFINITY;
    g.setPlayback(false, 1, t * 120);
    g.part(110, 'grit_hopper', i % 9 === 0 ? [N, 0, 0] : [0, 0, 0], 2, i % 5 === 0 ? N : I, null, null, null);
    g.part(114, 'waterwheel', [0, 0.2, 0], 0, 0, i % 7 === 0 ? [N, N, N, N] : rotX(t * 3), null, null);
    g.part(123, 'zippy', i % 11 === 0 ? [500, 0, 0] : [Math.sin(t), 0, 0], 2, 0, null, null, null);
    g.part(132, 'dusty', i % 13 === 0 ? [N, 0, 0] : [0, 0, 0], 0, i % 3 ? N : 300, null, [clip('walk'), 0, 0, 0]);
    g.roller('yx', 'yolk', i % 4 === 0 ? [I, 0, 0] : [Math.cos(t), 0.03, 0]);
    const bad = emptyField();
    bad.bands[0]![0] = { moving: i % 2 ? N : I, speed: N, falling: -5, fallSpeed: I, cx: N, cy: I, cz: 0, total: N };
    bad.bands[1]![1] = { moving: 1e12, speed: 1e9, falling: 1e12, fallSpeed: 1e9, cx: 1e9, cy: 0, cz: 0, total: 1e12 };
    g.matterField(i % 17 === 0 ? ({ bands: null } as unknown as MatterField) : bad);
    if (i % 20 === 0) g.onSimEvents([ev(t, 'Sound', 130, [0, 0.3, 0], N), ev(t, 'Arc', 120, [N, 0, 0], I), ev(t, 'Impact', 124, [0, 0.1, 0], I), ev(t, 'Spawn', 122, [0, 0.1, 0], N, 131)], partType);
  }, { silentOk: [[0, 9]], check: (g) => (g.stats.faults > 0 ? `!${g.stats.faults} faults caught` : 'no faults') }));

  // the GPU probe (own WebGPU device, synthetic grains): correctness against the CPU reference, and its cost
  for (const n of [1_000_000, 4_000_000]) {
    try {
      const s = await probeBench(n);
      const m = /max rel err ([\d.e+-]+)/.exec(s);
      k.result(`Matter probe: ${n / 1e6}M synthetic grains (GPU vs CPU reference)`, !!m && Number(m[1]) < 1e-3, s);
    } catch (err) { k.result(`Matter probe: ${n / 1e6}M`, false, String(err)); }
  }
}
