// M5 rows for the audio test page (audio-test.ts): live audition of the M5 parts, BUZZ, the Hangar and Moon rooms
// and the air-0 % treatment, plus the offline checks, including the clip sound track (render → encode → mux →
// decode back → play in <video>).

import type { GameAudio, LimiterStats, SimEventLike } from './index';
import { ClipAudio, encodeAudio, preferAudioCodec } from './clip';
import { VideoSink } from '../capture/video.ts';
import { readMp4 } from '../capture/mp4.ts';
import { m5Recipes } from './m5';
import { buzzRecipes } from './buzz';
import { spaceAmbienceRecipes } from './ambience_m5';
import * as partsData from '@knockon/parts-data';

type Vec = [number, number, number];

/** audio-test.ts render() expectations (the subset the M5 checks use). */
export interface Expect5 {
  silentOk?: [number, number][]; minPeakDb?: number; slots?: [number, number][]; quiet?: [number, number][]; env?: string; preset?: string;
  check?: (g: GameAudio, buf: AudioBuffer, lim: LimiterStats[]) => string; noWorklet?: boolean; listener?: { pos: Vec; forward: Vec };
  rms?: { from: number; to: number; lo: number; hi: number };
}

export interface OfflineKit {
  render(name: string, sec: number, script: (g: GameAudio, t: number, i: number) => void, expect?: Expect5): Promise<unknown>;
  add(r: unknown): void;
  result(name: string, ok: boolean, note: string): void;
  ev(t: number, kind: string, part: number, pos: Vec, mag?: number, other?: number): SimEventLike;
  partType(id: number): string | undefined;
  filter(): string;
  make(share?: GameAudio): GameAudio;
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -200);

/** M5 test ids (audio-test.ts TYPES). */
export const M5_TEST_TYPES: Record<number, string> = {
  140: 'rift_gate', 141: 'rift_gate', 142: 'grav_well', 143: 'tractor_beam', 144: 'hover_pad', 145: 'force_wall', 146: 'coilgun_ring',
  147: 'stasis_field', 148: 'buzz_beacon', 149: 'singularity', 150: 'grabber', 151: 'buzz', 152: 'stitch', 153: 'pig_iron',
};

const F = { lit: 1, powered: 2, pressed: 4, armed: 16, fault: 64 };
type Quat = [number, number, number, number];
const rotY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

/** [label, kind, part, mag, other?] */
export const M5_EVENTS: [string, string, number, number, number?][] = [
  ['RIFT Teleport (entry gate, 3 m/s)', 'Teleport', 140, 3, 152], ['rift Emerge (exit gate)', 'Emerge', 141, 3, 152], ['rift Bounce (cooldown overflow)', 'Bounce', 140, 1, 152],
  ['GRAV WELL powered (spin-up)', 'Powered', 142, 0], ['grav well unpowered (orb clack)', 'Unpowered', 142, 0], ['grav underpower stutter', 'Brownout', 142, 0],
  ['TRACTOR powered', 'Powered', 143, 0], ['tractor Attach (capture bloop)', 'Attach', 143, 1, 153], ['tractor Release', 'Release', 143, 0, 153],
  ['HOVER PAD powered', 'Powered', 144, 0], ['hover power-down (whine-drop)', 'Unpowered', 144, 0], ['hover lands (clunk)', 'Impact', 144, 3],
  ['FORCE WALL Barrier on (zip up)', 'Barrier', 145, 1], ['force wall ripple', 'Impact', 145, 2, 153], ['force wall: critter boing', 'Impact', 145, 1, 151], ['force wall Barrier off (zip down)', 'Barrier', 145, 0],
  ['COILGUN powered (charging)', 'Powered', 146, 0], ['coilgun Charged (ready ping)', 'Charged', 146, 1], ['COILGUN Boost (Δv 3)', 'Boost', 146, 3, 153], ['coilgun Boost 0 (dud pass)', 'Boost', 146, 0, 152],
  ['STASIS Engage', 'Engage', 147, 1], ['stasis Freeze (a body caught)', 'Freeze', 147, 1, 152], ['stasis Engage 0 (time snap)', 'Engage', 147, 0],
  ['BEACON Call', 'Call', 148, 1],
  ['SINGULARITY Despawn (recycle pop)', 'Despawn', 149, 1, 152], ['singularity Launch (spits a critter)', 'Launch', 149, 3, 151],
  ['GRABBER Trigger', 'Trigger', 150, 1], ['grabber Attach (grip)', 'Attach', 150, 1, 152], ['grabber Release', 'Release', 150, 0, 152], ['grabber Jam (shrug)', 'Jam', 150, 0],
  ['BUZZ Fetch (claw, 1.2 kg)', 'Fetch', 151, 1.2, 152], ['BUZZ Deliver (jingle)', 'Deliver', 151, 9, 152], ['buzz impact plink', 'Impact', 151, 0.8], ['buzz tumble', 'Ragdoll', 151, 4], ['buzz getup', 'Getup', 151, 0],
];

/** Part loops: [label, id, type, (e 0..1, t) => [flags, meter, rot, pos, arm]]. */
export type M5Loop = [string, number, string, (e: number, t: number) => [number, number, Quat | null, Vec, Vec | null]];
export const M5_LOOPS: M5Loop[] = [
  ['rift gates humming (a pair)', 140, 'rift_gate', () => [F.lit, 0, null, [-0.8, 0, 0.3], null]],
  ['grav well: spin-up, attract', 142, 'grav_well', (e) => [e > 0.05 ? F.powered | F.lit : 0, 0, null, [0, 0, 0.5], null]],
  ['grav well: repel', 142, 'grav_well', () => [F.powered | F.lit | F.armed, 0, null, [0, 0, 0.5], null]],
  ['tractor: on, then loading up', 143, 'tractor_beam', (e) => [F.powered | (e > 0.4 ? F.lit : 0), 1 + Math.round(20 * Math.max(0, e - 0.4) / 0.6), null, [0, 0.1, 0.5], null]],
  ['hover pad: hovering, then loaded', 144, 'hover_pad', (e, t) => [F.powered | F.lit, 1 + Math.round(20 * e), null, [0, 0.5 + 0.02 * Math.sin(t * 3), 0.5], null]],
  ['force wall: on (1 m²)', 145, 'force_wall', (e) => [e > 0.1 ? F.lit : 0, 100, null, [0, 0, 0.5], null]],
  ['coilgun: charging → idle hum', 146, 'coilgun_ring', (e) => [e > 0.05 ? F.powered : 0, 0, null, [0, 0, 0.5], null]],
  ['stasis: engaged, then released', 147, 'stasis_field', (e) => [e < 0.75 ? F.lit | F.powered : 0, 0, null, [0, 0, 0.5], null]],
  ['grabber: moving, then parking', 150, 'grabber', (e, t) => [F.powered | (e > 0.3 && e < 0.6 ? F.lit : 0), 0, rotY(e < 0.75 ? t * 2 : 1.5), [0, 0, 0.5], e < 0.75 ? [0.3 * Math.cos(t * 2), 0.35, 0.5 + 0.3 * Math.sin(t * 2)] : [0, 0.45, 0.5]]],
];

/** BUZZ's fetch job as B5's critterState bytes over time: [clip, flags, emote, fsm] and a position. */
export function buzzJob(t: number, clip: (n: string) => number, emote: (n: string) => number, fsm: (n: string) => number): { pos: Vec; bytes: number[]; ev: [string, number] | null } {
  const R = 16, W = (k: number) => (k & 7) << 5;
  const home: Vec = [-0.8, 0, 0.6], item: Vec = [0.9, 0, -0.2];
  const lerp = (a: Vec, b: Vec, u: number): Vec => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  if (t < 1) return { pos: home, bytes: [clip('sleep'), 4, 0, fsm('docked')], ev: null };
  if (t < 2) return { pos: [home[0], 0.35 * (t - 1), home[2]], bytes: [clip('takeoff'), R, emote('!'), fsm('takeoff')], ev: null };
  if (t < 2.8) return { pos: [home[0], 0.35, home[2]], bytes: [clip('sniff'), R, t > 2.6 ? emote('package') : 0, fsm('sniff')], ev: null };
  if (t < 4.3) return { pos: lerp([home[0], 0.35, home[2]], [item[0], 0.7, item[2]], (t - 2.8) / 1.5), bytes: [clip('walk'), R, 0, fsm('fly')], ev: null };
  if (t < 5.8) { const w = t < 5 ? Math.round(7 * (t - 4.3) / 0.7) : Math.round(7 * (5.8 - t) / 0.8); return { pos: [item[0], 0.7, item[2]], bytes: [clip('grab'), R | W(w), t > 5 ? emote('pin') : 0, fsm('grab')], ev: Math.abs(t - 5) < 1 / 120 ? ['Fetch', 0.6] : null }; }
  if (t < 7.3) return { pos: lerp([item[0], 0.7, item[2]], [home[0], 0.6, home[2]], (t - 5.8) / 1.5), bytes: [clip('carry'), R | W(1), 0, fsm('carry')], ev: null };
  if (t < 8.3) return { pos: [home[0], 0.6, home[2]], bytes: [clip('drop_off'), R | W(t < 7.8 ? 4 : 1), t > 7.8 ? emote('clock') : 0, fsm('drop_off')], ev: Math.abs(t - 7.8) < 1 / 120 ? ['Deliver', 6] : null };
  if (t < 9.3) return { pos: [home[0], 0.6, home[2]], bytes: [clip('deliver_bow'), R, 0, fsm('deliver_bow')], ev: null };
  if (t < 10.3) return { pos: [home[0], 0.6 * (10.3 - t), home[2]], bytes: [clip('land'), R, 0, fsm('land')], ev: null };
  return { pos: home, bytes: [clip('sleep'), 4, emote('zzz'), fsm('docked')], ev: null };
}

const slotted = (n: number, w: number, t0 = 0.3): [number, number][] => Array.from({ length: n }, (_, k) => [t0 + k * w, t0 + k * w + w * 0.85] as [number, number]);
const atSlot = (t: number, w: number, t0 = 0.3): number => { const k = Math.round((t - t0) / w); return Math.abs(t - t0 - k * w) < 0.5 / 60 ? k : -1; };

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

const PD = partsData as unknown as Record<string, readonly string[] | undefined>;
const idx = (table: string) => (n: string): number => Math.max(0, (PD[table] ?? []).indexOf(n));
const clipN = idx('CRITTER_CLIPS'), emoteN = idx('CRITTER_EMOTES'), fsmN = idx('CRITTER_FSM');

export function liveM5(k: LiveKit): void {
  const { ga, btn, row, now, simulate, ev, partType } = k;
  const r1 = row('M5 events');
  for (const [label, kind, part, mag, other] of M5_EVENTS) btn(label, () => { ga.setMode('running'); ga.onSimEvents([ev(now(), kind, part, [(Math.random() - 0.5) * 2, 0.3, 0], mag, other)], partType); }, r1);
  const r2 = row('M5 loops (simulated run)');
  for (const [label, id, type, f] of M5_LOOPS) {
    btn(label, () => { let t = 0; simulate(5, (e, dt) => { t += dt; const [flags, meter, rot, pos, arm] = f(e, t); ga.part(id, type, pos, flags, meter, rot, null, arm); if (id === 140) ga.part(141, type, [0.8, 0, 0.3], flags, meter, rot, null, null); }); }, r2);
  }
  btn('SINGULARITY: arm → 6 s pull (recycling) → collapse', () => {
    let t = 0, fired = false, n = 0;
    ga.onSimEvents([ev(now(), 'Engage', 149, [0, 0.1, 0], 1)], partType);
    simulate(9, (_e, dt) => {
      t += dt;
      ga.part(149, 'singularity', [0, 0, 0], t < 6 ? F.armed : 0, 0, null, null, null);
      if (t > 1 && t < 6 && Math.floor(t * 4) !== n) { n = Math.floor(t * 4); ga.onSimEvents([ev(now(), 'Despawn', 149, [Math.sin(n) * 0.3, 0.2, 0], n, 152)], partType); }
      if (t >= 6 && !fired) { fired = true; ga.onSimEvents([ev(now(), 'Collapse', 149, [0, 0.1, 0], 0)], partType); }
    });
  }, r2);
  const r3 = row('BUZZ (simulated)');
  btn('BUZZ fetch job (dock → takeoff → scan → grab → carry → deliver → land)', () => {
    let t = 0;
    simulate(11.5, (_e, dt) => {
      t += dt;
      const j = buzzJob(t, clipN, emoteN, fsmN);
      ga.part(151, 'buzz', j.pos, 0, 0, null, j.bytes);
      if (j.ev) ga.onSimEvents([ev(now(), j.ev[0], 151, j.pos, j.ev[1], 152)], partType);
    });
  }, r3);
  btn('BUZZ dash past (doppler)', () => simulate(3, (e) => ga.part(151, 'buzz', [-4 + 8 * e, 0.8, 0.4], 0, 0, null, [clipN('run'), 16, 0, fsmN('fly')])), r3);
  btn('BUZZ knocked out of the air', () => {
    let t = 0;
    simulate(5, (_e, dt) => {
      t += dt;
      const rag = t > 1 && t < 2.5;
      ga.part(151, 'buzz', [0, rag ? Math.max(0, 0.8 - (t - 1) * 2) : t < 1 ? 0.8 : 0.4, 0.4], 0, 0, null, [clipN(rag ? 'tumble' : t < 1 ? 'walk' : t < 3.5 ? 'getup' : 'dizzy'), rag ? 1 : 16, rag ? emoteN('stars') : 0, fsmN(rag ? 'ragdoll' : 'getup')]);
    });
  }, r3);
  const r4 = row('ORBITAL HANGAR / MOON BASE · air 0 %');
  btn('hangar (Bay 2)', () => ga.setEnvironment('hangar', 'warehouse', 100), r4);
  btn('hangar (Main Hall)', () => ga.setEnvironment('hangar', 'arena', 100), r4);
  btn('listener at the hangar window', () => ga.setListener({ pos: [0, 2, -26], forward: [0, 0, -1], up: [0, 1, 0] }), r4);
  btn('listener: hangar camera', () => ga.setListener({ pos: [0, 19.5, 42], forward: [0, -0.5, -0.87], up: [0, 1, 0] }), r4);
  btn('moon (Room, air 0 %)', () => ga.setEnvironment('moon', 'room', 0), r4);
  btn('moon (Arena, air 0 %)', () => ga.setEnvironment('moon', 'arena', 0), r4);
  btn('listener near the dome', () => ga.setListener({ pos: [0, 2, -20], forward: [0, 0, -1], up: [0, 1, 0] }), r4);
  btn('listener: default', () => ga.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] }), r4);
  for (const air of [0, 5, 10, 100]) btn(`air ${air} %`, () => ga.setEnvironment('moon', 'room', air), r4);
  btn('impacts near and far (brik)', () => { ga.setMode('running'); for (let i = 0; i < 4; i++) setTimeout(() => ga.onSimEvents([ev(now(), 'Impact', 3, [0, 0.1, -1 - i * 6], 6)], partType), i * 450); }, r4);
  btn('a bang across the Moon', () => { ga.setMode('running'); ga.onSimEvents([ev(now(), 'Detonate', 1000, [0, 0.1, -15], 1)], partType); }, r4);
  k.cueRow('All M5 part cues', m5Recipes().map((r) => r[0]));
  k.cueRow('All BUZZ cues', buzzRecipes().map((r) => r[0]));
  k.cueRow('All Hangar / Moon ambience cues', spaceAmbienceRecipes().map((r) => r[0]));
}

/** RMS (dB) of both channels over [a, b) seconds. */
function rmsDb(buf: AudioBuffer, a: number, b: number): number {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let s = 0, n = 0;
  for (let i = Math.max(0, Math.round(a * 48000)); i < Math.min(L.length, Math.round(b * 48000)); i++) { s += L[i]! * L[i]! + R[i]! * R[i]!; n += 2; }
  return db(Math.sqrt(s / Math.max(1, n)));
}
/** Share of energy above 2 kHz over [a, b) (a crude brightness measure: one-pole high-pass). */
function hiShare(buf: AudioBuffer, a: number, b: number): number {
  const x = buf.getChannelData(0);
  const k = Math.exp(-2 * Math.PI * 2000 / 48000);
  let lp = 0, eAll = 0, eHi = 0;
  for (let i = Math.max(0, Math.round(a * 48000)); i < Math.min(x.length, Math.round(b * 48000)); i++) { lp = lp * k + x[i]! * (1 - k); const h = x[i]! - lp; eAll += x[i]! * x[i]!; eHi += h * h; }
  return eAll > 0 ? eHi / eAll : 0;
}

export async function offlineM5(k: OfflineKit): Promise<void> {
  const { render, add, ev, partType } = k;

  add(await render('M5 event one-shots', M5_EVENTS.length * 0.7 + 3, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const s = atSlot(t, 0.7);
    if (s >= 0 && s < M5_EVENTS.length) {
      const [, kind, part, mag, other] = M5_EVENTS[s]!;
      // the hover pad lands after a power-down: tell it it's falling first
      if (part === 144 && kind === 'Impact') g.onSimEvents([ev(t - 0.3, 'Unpowered', 144, [0.5, 0.3, 0.5], 0)], partType);
      g.onSimEvents([ev(t, kind, part, [0.5, 0.3, 0.5], mag, other)], partType);
    }
  }, { slots: slotted(M5_EVENTS.length, 0.7) }));

  add(await render('M5 loops via part()', M5_LOOPS.length * 1.8 + 0.6, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const s = Math.floor((t - 0.2) / 1.8);
    if (t > 0.2 && s < M5_LOOPS.length) {
      const [, id, type, f] = M5_LOOPS[s]!;
      const [flags, meter, rot, pos, arm] = f(((t - 0.2) % 1.8) / 1.8, t);
      g.part(id, type, pos, flags, meter, rot, null, arm);
    }
  }, { slots: M5_LOOPS.map((_, s) => [0.5 + s * 1.8, 0.2 + (s + 1) * 1.8] as [number, number]) }));

  // SINGULARITY: arm at 0.5 s → spin-up, pull loop growing with recycled bodies, the implosion landing on the collapse at
  // 6.5 s, 150 ms of true silence (everything, music included), the aftermath and the vent
  let collapses = 0;
  add(await render('M5 SINGULARITY: arm → pull → implosion → 150 ms silence → aftermath', 11, (g, t, i) => {
    if (i === 1) { g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    if (atSlot(t, 100, 0.5) === 0) g.onSimEvents([ev(t, 'Engage', 149, [0, 0.1, 0], 1)], partType);
    if (t > 0.5 && t < 7) g.part(149, 'singularity', [0, 0, 0], t < 6.5 ? F.armed : 0, 0, null, null, null);
    if (t > 1.5 && t < 6.3 && i % 20 === 0) g.onSimEvents([ev(t, 'Despawn', 149, [Math.sin(i) * 0.3, 0.2, 0], i, 152)], partType);
    if (atSlot(t, 100, 6.5) === 0) g.onSimEvents([ev(t, 'Collapse', 149, [0, 0.1, 0], 0)], partType);
    collapses = (g.stats as unknown as { m5Cues: number }).m5Cues;
  }, {
    env: 'tinker', silentOk: [[0, 11]], quiet: [[6.55, 6.645]], // the limiter's 5 ms lookahead delays the hush
    check: (_g, buf) => {
      const pull = rmsDb(buf, 4, 6), sil = rmsDb(buf, 6.55, 6.645), after = rmsDb(buf, 6.7, 7.5);
      return pull > -40 && after > -40 ? `pull ${pull.toFixed(1)} dB, silence ${sil.toFixed(1)} dB, aftermath ${after.toFixed(1)} dB, ${collapses} M5 cues` : `!pull ${pull.toFixed(1)} / aftermath ${after.toFixed(1)} dB too quiet`;
    },
  }));

  // BUZZ: the whole fetch job
  add(await render('M5 BUZZ: fetch job (takeoff, scan, grab, carry, deliver, land, dock)', 12, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    g.setPlayback(false, 1, t * 120);
    const j = buzzJob(t, clipN, emoteN, fsmN);
    g.part(151, 'buzz', j.pos, 0, 0, null, j.bytes);
    if (j.ev) g.onSimEvents([ev(t, j.ev[0], 151, j.pos, j.ev[1], 152)], partType);
  }, { slots: [[1.05, 2], [2, 2.8], [2.8, 4.3], [4.3, 5.8], [5.8, 7.3], [7.3, 8.3], [9.3, 10.6]], check: (g) => `${(g.stats as unknown as { buzzCues: number }).buzzCues} BUZZ cues` }));

  // the rooms
  for (const [name, env, preset, air, pos, lo, hi] of [
    ['M5 ORBITAL HANGAR (Bay 2) ambience', 'hangar', 'warehouse', 100, [0, 19.5, 42], -52, -38],
    ['M5 ORBITAL HANGAR (Main Hall) ambience', 'hangar', 'arena', 100, [0, 41, 88], -52, -38],
    ['M5 ORBITAL HANGAR at the window (silence pocket)', 'hangar', 'warehouse', 100, [0, 3, -26], -56, -40],
    ['M5 MOON BASE (Room) ambience, air 0 %', 'moon', 'room', 0, [0, 7.15, 12.5], -60, -44],
    ['M5 MOON BASE by the dome (structure-borne hum)', 'moon', 'warehouse', 0, [0, 2, -22], -60, -40],
  ] as const) {
    add(await render(name, 8, (g, _t, i) => { if (i === 1) { g.setVolumes({ music: 0 }); g.setEnvironment(env, preset, air); } }, {
      env, preset, listener: { pos: [...pos] as Vec, forward: [0, -0.3, -1] }, silentOk: [[0, 3]], rms: { from: 3, to: 8, lo, hi }, minPeakDb: -70,
    }));
  }

  // air 0 %: the same impacts and blast at 100 % and at 0 % air: darker, drier, the far one much quieter
  const airRun = async (air: number): Promise<{ near: number; far: number; hi: number; tail: number } | null> => {
    let out: { near: number; far: number; hi: number; tail: number } | null = null;
    await render(`M5 air ${air} %: impacts near / far, a bang at 15 m`, 6, (g, t, i) => {
      if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); g.setEnvironment('off', 'room', air); }
      g.setPlayback(false, 1, t * 120);
      if (atSlot(t, 100, 0.5) === 0) g.onSimEvents([ev(t, 'Impact', 3, [0, 0.1, 1.5], 8)], partType);
      if (atSlot(t, 100, 2) === 0) g.onSimEvents([ev(t, 'Impact', 3, [0, 0.1, -20], 8)], partType);
      if (atSlot(t, 100, 3.5) === 0) g.onSimEvents([ev(t, 'Detonate', 1000, [0, 0.1, -12], 1)], partType);
    }, { env: 'off', silentOk: [[0, 6]], check: (_g, buf) => { out = { near: rmsDb(buf, 0.5, 0.8), far: rmsDb(buf, 2, 2.4), hi: hiShare(buf, 0.5, 0.8), tail: rmsDb(buf, 0.9, 1.6) }; return ''; } }).then((r) => add(r));
    return out;
  };
  const a100 = await airRun(100), a0 = await airRun(0);
  if (a100 && a0) {
    const ok = a0.hi < a100.hi * 0.5 && a0.far < a100.far - 6 && a0.tail < a100.tail - 6;
    k.result('M5 air 0 %: impacts low-passed, no reverb, quieter far field', ok,
      `brightness (energy > 2 kHz) ${(100 * a100.hi).toFixed(1)} % → ${(100 * a0.hi).toFixed(1)} %; near impact ${a100.near.toFixed(1)} → ${a0.near.toFixed(1)} dB; far (21 m) ${a100.far.toFixed(1)} → ${a0.far.toFixed(1)} dB; reverb tail ${a100.tail.toFixed(1)} → ${a0.tail.toFixed(1)} dB`);
  }

  // stress: every M5 loop at once, BUZZ, a singularity, booms, the Hangar: the voice budget and the ceiling
  let maxV = 0;
  add(await render('M5 stress (every M5 loop ×3, BUZZ ×2, singularity, booms, Hangar)', 8, (g, t, i) => {
    if (i === 1) { g.setMode('running'); g.setEnvironment('hangar', 'warehouse', 100); }
    g.setPlayback(false, 1, t * 120);
    for (let c = 0; c < 3; c++) for (const [, id, type, f] of M5_LOOPS) { const [flags, meter, rot, pos, arm] = f(0.5, t); g.part(id + 1000 * (c + 1), type, [pos[0] + c * 1.2 - 1.2, pos[1], pos[2] - c], flags, meter, rot, null, arm); }
    for (let b = 0; b < 2; b++) g.part(151 + 1000 * (b + 1), 'buzz', [Math.sin(t + b * 3) * 2, 0.8, Math.cos(t + b * 3)], 0, 0, null, [clipN('walk'), 16, 0, fsmN('fly')]);
    if (atSlot(t, 100, 1) === 0) g.onSimEvents([ev(t, 'Engage', 149, [0, 0.1, -1], 1)], partType);
    g.part(149, 'singularity', [0, 0, -1], t > 1 && t < 7 ? F.armed : 0, 0, null, null, null);
    if (t > 2 && t < 5 && i % 4 === 0) g.onSimEvents([ev(t, 'Detonate', 2000 + i, [Math.sin(i) * 3, 0.1, -3], 3), ev(t, 'Impact', 3, [0, 0.1, 0], 4), ev(t, 'Boost', 146 + 1000, [0, 0.15, 0.5], 3)], partType);
    const s = g.stats as unknown as { voices: number; loops: number; ambience: number; matter: number };
    maxV = Math.max(maxV, s.voices + s.loops + s.ambience + s.matter);
  }, { env: 'hangar', preset: 'warehouse', check: () => (maxV > 64 ? `!voices peaked at ${maxV} > 64` : `peak voices ${maxV}/64`) }));

  add(await render('robustness M5: NaN, Infinity, junk bytes, bad events', 4, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); }
    const N = Number.NaN, I = Number.POSITIVE_INFINITY;
    g.setPlayback(false, 1, t * 120);
    for (const [, id, type, f] of M5_LOOPS) { const [flags, , rot, pos, arm] = f(0.5, t); g.part(id, type, i % 7 === 0 ? [N, 0, 0] : pos, flags, i % 5 === 0 ? I : N, i % 9 === 0 ? [N, N, N, N] : rot, null, i % 11 === 0 ? [I, 0, 0] : arm); }
    g.part(151, 'buzz', i % 6 === 0 ? [N, N, N] : [0, 0.5, 0], 0, N, null, i % 4 === 0 ? [999, 255, 999, 999] : [N, N, N, N]);
    g.part(149, 'singularity', [0, 0, 0], 255, I, null, null, null);
    if (i % 15 === 0) {
      g.onSimEvents([ev(t, 'Transit', 140, [0, 0.2, 0], N, 999999), ev(t, 'Collapse', 149, [N, 0, 0], I), ev(t, 'Fetch', 151, [0, 0.2, 0], I, -5), ev(t, 'Boost', 146, [0, 0.2, 0], N),
        ev(t, 'Despawn', 149, [0, 0.2, 0], N, 152), ev(t, 'Impact', 145, [0, 0.2, 0], I, 151), ev(t, 'Nonsense', 150, [0, 0, 0], 1)], partType);
      g.setEnvironment(i % 30 === 0 ? 'moon' : 'hangar', 'room', i % 45 === 0 ? N : I);
    }
  }, { silentOk: [[0, 9]], check: (g) => (g.stats.faults > 0 ? `!${g.stats.faults} faults caught` : 'no faults') }));
}

/** The scripted "run" a clip hears: an impact every 0.5 s, a motor loop sweeping past, three booms. */
function clipScript(g: GameAudio, t: number, i: number, ev: OfflineKit['ev'], partType: OfflineKit['partType']): void {
  if (i === 0) { g.setMode('running'); g.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] }); }
  g.setPlayback(false, 1, t * 120);
  if (i % 30 === 0) g.onSimEvents([ev(t, 'Impact', 3, [Math.sin(i) * 1.5, 0.1, 0], 4)], partType);
  if (i === 90 || i === 150 || i === 200) g.onSimEvents([ev(t, 'Detonate', 1000 + i, [0, 0.1, -1], 1)], partType);
  g.loop('clipmotor', 'motor', [Math.sin(t) * 2, 0.3, 0], 0.8);
}

/**
 * Drives a clip exactly like capture/offline.ts does: per frame at(i) → the frame's hooks → advance(i), with a
 * random wall-clock stall per frame (the render must not care how long a frame took).
 */
async function renderClip(k: OfflineKit, live: GameAudio, frames: number, fps: number, pre: number, stall: boolean): Promise<{ track: Awaited<ReturnType<ClipAudio['finish']>>; ms: number }> {
  const t0 = performance.now();
  const c = live.clip();
  if (!(await c.begin(fps, (frames + pre) / fps * 2 + 2))) throw new Error(`clip begin failed: ${c.note}`);
  for (let i = 0; i < frames + pre; i++) {
    await c.at(i);
    const t = i / fps;
    clipScript(live, t, i, k.ev, k.partType); // hooks on the LIVE director: forwarded to the clip's offline director
    live.frame(1 / fps);
    c.advance(i);
    if (stall && i % 7 === 0) await new Promise((r) => setTimeout(r, 2 + (i % 5) * 3));
  }
  const track = await c.finish(pre / fps, (frames + pre) / fps);
  return { track, ms: performance.now() - t0 };
}

/** Clip sound track: offline render on a frame clock, determinism, encode, mux, decode back, sync, <video> playback. */
export async function clipChecks(k: OfflineKit): Promise<void> {
  const want = (n: string) => !k.filter() || n.toLowerCase().includes(k.filter().toLowerCase());
  if (!want('clip')) return;
  const live = k.make();
  const fps = 60, frames = 240, pre = 30;
  // 1. determinism: the same frames twice (one with random stalls) give the same PCM; each run starts from a fresh
  //    live director in the same state (the banks are shared). Chrome sums a node's inputs in an unspecified order,
  //    so two renders agree to float rounding (~1e-8), not bit for bit: the check is a −120 dB bound on the difference.
  ClipAudio.keepPcm = true;
  const a = await renderClip(k, live, frames, fps, pre, false);
  const ha = ClipAudio.last, pa = ClipAudio.lastPcm;
  const b = await renderClip(k, k.make(live), frames, fps, pre, true);
  const hb = ClipAudio.last, pb = ClipAudio.lastPcm;
  ClipAudio.keepPcm = false;
  let maxDiff = 0, nDiff = 0;
  if (pa && pb) for (let c = 0; c < 2; c++) { const x = pa[c]!, y = pb[c]!; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i]! - (y[i] ?? 0)); if (d > 0) { nDiff++; if (d > maxDiff) maxDiff = d; } } }
  k.result('clip: offline render on the frame clock is deterministic', !!pa && !!pb && pa[0]!.length === pb[0]!.length && maxDiff < 1e-6 && (ha?.peak ?? 0) > 0.01,
    `max difference ${maxDiff ? db(maxDiff).toFixed(0) + ' dB' : 'none'} (${nDiff} samples differ in the last bits; hashes ${ha?.hash} / ${hb?.hash}; second run with stalls), ${ha?.seconds.toFixed(2)} s, peak ${db(ha?.peak ?? 0).toFixed(1)} dBFS, finish ${ha?.tailMs.toFixed(0)} ms + encode ${ha?.encodeMs.toFixed(0)} ms, ${ha?.codec}`);
  if (!a.track || !b.track) { k.result('clip: encode', false, 'no encoded track'); return; }
  // 2. for each codec: mux with a synthetic video, walk the boxes, decode the file's audio back (Chrome decodes MP4
  //    through the same demuxer <video> uses) and line it up with the PCM, then play it in <video>
  for (const codec of ['aac', 'opus'] as const) {
    preferAudioCodec(codec);
    const track = codec === 'aac' && a.track.cfg.codec === 'aac' ? a.track : pa ? await encodeAudio(pa) : null;
    preferAudioCodec(null);
    if (!track || track.cfg.codec !== codec) { k.result(`clip (${codec}): encode`, false, `no ${codec} encoder`); continue; }
    const res = await muxTest(track, frames, fps);
    const bytes = new Uint8Array(await res.blob.arrayBuffer());
    let info: ReturnType<typeof readMp4> | null = null, err = '';
    try { info = readMp4(bytes); } catch (e) { err = String(e); }
    const au = info?.audio;
    k.result(`clip (${codec}): MP4 carries the sound track (box walk)`, !!au && au.sampleCount === track.samples.length && au.channels === 2 && au.sampleRate === 48000,
      au ? `${res.codec}; ${au.entry} ${au.channels} ch ${au.sampleRate} Hz, ${au.sampleCount} samples, ${au.duration.toFixed(3)} s, edit list skips ${au.priming}, video ${info!.sampleCount} frames ${info!.duration.toFixed(3)} s, ${(bytes.length / 1e3).toFixed(0)} kB` : `no audio track ${err}`);
    try {
      const actx = new OfflineAudioContext(2, 48000, 48000);
      const dec = await actx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
      const x = dec.getChannelData(0), ref = pa![0]!;
      let o1 = -1; for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i]!) > 0.05) { o1 = i; break; }
      const lag = xcorrLag(ref, x, Math.max(0, o1), 9600, 2400);
      k.result(`clip (${codec}): decoded sound lines up with the picture`, Math.abs(lag) <= 48 && Math.abs(dec.duration - frames / fps) < 0.03,
        `decoded ${dec.duration.toFixed(3)} s at ${dec.sampleRate} Hz (clip ${(frames / fps).toFixed(3)} s); cross-correlation lag ${lag} samples (${(lag / 48).toFixed(2)} ms)`);
    } catch (e) { k.result(`clip (${codec}): decoded sound lines up with the picture`, false, `decodeAudioData failed: ${e}`); }
    await playTest(k, `clip (${codec}): plays with sound in <video>`, res.blob);
  }  live.dispose();
}

/** A synthetic 320×180 video (a moving square) with `track` muxed in. */
async function muxTest(track: NonNullable<Awaited<ReturnType<typeof encodeAudio>>>, frames: number, fps: number): Promise<Awaited<ReturnType<VideoSink['finish']>>> {
  const W = 320, H = 180;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g2 = canvas.getContext('2d')!;
  const sink = await VideoSink.create(W, H, fps, `f5-test-${Date.now().toString(36)}.mp4`);
  for (let i = 0; i < frames; i++) {
    g2.fillStyle = `hsl(${(i * 3) % 360} 60% 50%)`; g2.fillRect(0, 0, W, H);
    g2.fillStyle = '#fff'; g2.fillRect((i * 4) % W, 80, 20, 20);
    sink.add(canvas as unknown as HTMLCanvasElement, i);
    await sink.ready();
  }
  sink.setAudio(track);
  return sink.finish();
}

/** Plays `blob` in a <video> through a MediaElementSource: audio bytes decoded and a non-silent level. */
async function playTest(k: OfflineKit, name: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  const ac = new AudioContext();
  try {
    v.src = url; v.muted = false; v.volume = 1; v.playsInline = true;
    document.body.appendChild(v);
    const an = ac.createAnalyser(); an.fftSize = 2048;
    ac.createMediaElementSource(v).connect(an);
    an.connect(ac.destination);
    await ac.resume();
    await new Promise<void>((r, j) => { v.onloadedmetadata = () => r(); v.onerror = () => j(new Error(`video error ${v.error?.code} ${v.error?.message}`)); setTimeout(() => j(new Error('no metadata in 5 s')), 5000); });
    await v.play();
    let maxRms = 0;
    const buf = new Float32Array(2048);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const q of buf) s += q * q;
      maxRms = Math.max(maxRms, Math.sqrt(s / buf.length));
    }
    const vq = v.getVideoPlaybackQuality?.();
    const decodedAudio = (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? -1;
    k.result(name, decodedAudio > 0 && maxRms > 0.003,
      `duration ${v.duration.toFixed(2)} s, ${v.videoWidth}×${v.videoHeight}, audio decoded ${decodedAudio} B, max RMS ${db(maxRms).toFixed(1)} dBFS over 3 s, video frames ${vq?.totalVideoFrames ?? '?'} (${vq?.droppedVideoFrames ?? '?'} dropped)`);
  } catch (e) {
    const csp = /safety check|Content Security/i.test(String(e));
    k.result(name, false, csp ? `blocked by the page's CSP (no media-src for blob: URLs): ${e}` : String(e));
  } finally {
    v.pause(); v.remove(); URL.revokeObjectURL(url); await ac.close();
  }
}
/** The clip's reference PCM (left channel), rendered directly. */
async function refPcm(k: OfflineKit, live: GameAudio, frames: number, fps: number, pre: number): Promise<Float32Array> {
  const c = live.clip();
  await c.begin(fps, (frames + pre) / fps * 2 + 2);
  for (let i = 0; i < frames + pre; i++) { await c.at(i); clipScript(live, i / fps, i, k.ev, k.partType); live.frame(1 / fps); c.advance(i); }
  ClipAudio.keepPcm = true;
  await c.finish(pre / fps, (frames + pre) / fps);
  ClipAudio.keepPcm = false;
  return ClipAudio.lastPcm?.[0] ?? new Float32Array(0);
}

/** Lag (samples) of y against x around [from, from + n), searching ±maxLag. */
function xcorrLag(x: Float32Array, y: Float32Array, from: number, n: number, maxLag: number): number {
  let best = -Infinity, lag = 0;
  for (let L = -maxLag; L <= maxLag; L++) {
    let s = 0;
    for (let i = from; i < from + n; i++) { const j = i + L; if (j >= 0 && j < y.length && i < x.length) s += x[i]! * y[j]!; }
    if (s > best) { best = s; lag = L; }
  }
  return lag;
}

export type { LimiterStats };
