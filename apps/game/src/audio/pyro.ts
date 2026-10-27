// M3 pyro (AUDIO.md §4): the detonation layer stack, chain merging and the mass-explosion mix for
// "Kiloton" (400 Bangsticks + 60 Powder Kegs). Replaces the M1 single-group merge in index.ts.
//
// Per detonation: transient crack (nitro: glassy) · body (small / medium / keg) · sub (yield ≥ 1.5; the keg
// has its own long sub tail) · material debris tail. Chain handling:
//   - up to 4 merge groups live at once (one per area of the fortress). A detonation within 80 ms and 8 m of a
//     group folds into it (summed yield, a few extra cracks); when the group's window closes it plays one
//     "aftermath" body at the summed yield with extra debris tails.
//   - barrage mode (≥ 5 yield in 0.5 s): windows widen to 150 ms / 14 m, new leads drop their tails and
//     duck under the groups already ringing (1/√n headroom), and a continuous rumble bed (`loop/barrage`)
//     follows the yield rate, so density reads as one huge rolling event instead of 400 stacked voices.
//   - "mega" layer: more than 40 yield in 2 s adds one long rolling sub-thunder (rate-limited), and tells the
//     music to drop.
// Everything is scheduled with the speed-of-sound delay beyond 30 m. The master limiter (limiter.ts) is the
// last line, not the plan: the mix above keeps its gain reduction moderate.

import { debris, type Debris, type Recipe } from './bank';
import { hash01, type Rng } from './rng';
import { SR, alloc, bp, brown, chirp, contact, envAD, envFn, fadeEdges, glide, grains, hp, lp, mixInto, modal, normalize, seamless, softClip, sweep, white } from './synth';
import { clamp, dist, fin, finite3, type LoopKind, type LoopOpts, type PlayOpts, type SimEventLike, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);

// ============================================================================================
// sounds
// ============================================================================================

function kegBody(rng: Rng): Float32Array {
  const len = at(4.4);
  const w = white(len, rng), br = brown(len, rng);
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = w[i]! * 0.45 + br[i]! * 0.95;
  sweep(x, 'lp', (t) => 110 + 3200 * Math.exp(-t / 0.2), 0.8);
  envFn(x, (t) => Math.min(1, t / 0.004) * (0.7 * Math.exp(-t / 0.8) + 0.3 * Math.exp(-t / 2.4)));
  normalize(x, 1);
  mixInto(x, chirp(len, glide(140, 30, 0.15), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.5)), 0, 1.0);
  // the barrel's iron hoops ring as they fly, and the oak staves clatter down
  mixInto(x, normalize(modal(at(1.6), contact(0.0006, rng, 0.3), [{ f: 410, amp: 1, tau: 0.6 }, { f: 1130, amp: 0.7, tau: 0.4 }, { f: 2210, amp: 0.4, tau: 0.25 }]), 0.16), at(0.03));
  mixInto(x, normalize(debris('wood', rng), 0.35), at(0.06));
  const rum = lp(brown(len, rng), 140);
  envFn(rum, (t) => Math.min(1, t / 0.08) * Math.exp(-t / 1.8));
  mixInto(x, normalize(rum, 0.45));
  softClip(normalize(x, 1), 1.5);
  return fadeEdges(normalize(x, 0.5), 0.0002, 0.4);
}

function kegSub(rng: Rng): Float32Array {
  const len = at(3.8);
  const f0 = 46 + rng.bi() * 3;
  const x = chirp(len, glide(f0 * 1.25, f0 * 0.5, 0.6), (t) => Math.min(1, t / 0.015) * Math.exp(-t / 1.1));
  const r = lp(brown(len, rng), 80);
  envFn(r, (t) => Math.min(1, t / 0.1) * Math.exp(-t / 1.4) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 3.1 * t)));
  mixInto(x, normalize(r, 0.4));
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.4);
}

function nitroCrack(rng: Rng): Float32Array {
  const x = alloc(0.9);
  mixInto(x, normalize(hp(envAD(white(at(0.1), rng), 0.0001, 0.006), 1500), 1));
  const glass = modal(at(0.8), contact(0.00008, rng), [
    { f: 3200 * (1 + rng.bi() * 0.03), amp: 1, tau: 0.12 }, { f: 5100, amp: 0.8, tau: 0.09 }, { f: 7300, amp: 0.6, tau: 0.06 }, { f: 9800, amp: 0.4, tau: 0.04 },
  ]);
  mixInto(x, normalize(glass, 0.6), at(0.002));
  grains(x, rng, (t) => (t < 0.15 ? 160 : 0), (r) => normalize(hp(envAD(white(160, r), 0.00003, 0.0005), 3000), 0.2 + 0.5 * r.next()));
  mixInto(x, chirp(at(0.4), glide(170, 55, 0.03), (t) => Math.exp(-t / 0.08)), 0, 0.7);
  softClip(normalize(x, 1), 2.2);
  return fadeEdges(normalize(x, 0.5), 0.00005, 0.1);
}

function megaRoll(rng: Rng): Float32Array {
  const len = at(6.5);
  const x = lp(brown(len, rng), 900);
  sweep(x, 'lp', (t) => 70 + 900 * Math.exp(-t / 0.6), 0.7);
  // rolling thunder: a few slow swells as the far side of the fortress goes up
  const sw = [0, 0.7 + rng.next() * 0.4, 1.6 + rng.next() * 0.6, 2.7 + rng.next() * 0.8];
  envFn(x, (t) => {
    let a = 0;
    for (const s of sw) if (t >= s) a += Math.exp(-(t - s) / 0.9) * Math.min(1, (t - s) / 0.06);
    return Math.min(1, t / 0.08) * (0.4 * a + 0.6 * Math.exp(-t / 2.2));
  });
  normalize(x, 1);
  mixInto(x, chirp(len, glide(44, 22, 0.8), (t) => Math.min(1, t / 0.03) * Math.exp(-t / 1.6)), 0, 0.8);
  grains(x, rng, (t) => (t < 1.5 ? 40 * Math.exp(-t / 0.6) : 0), (r) => normalize(lp(envAD(white(900, r), 0.0002, 0.006), 2500), 0.05 + 0.15 * r.next()));
  softClip(normalize(x, 1), 1.3);
  return fadeEdges(normalize(x, 0.5), 0.001, 0.6);
}

function barrageLoop(rng: Rng): Float32Array {
  return normalize(seamless(4, 0.4, (len) => {
    const x = normalize(lp(brown(len, rng), 160), 0.8);
    const mid = bp(white(len, rng), 420, 0.6);
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.9995 + rng.bi() * 0.02; mid[i] = mid[i]! * (0.3 + 3 * Math.abs(am)); }
    mixInto(x, normalize(mid, 0.3));
    // distant thuds and crackle under the rumble
    grains(x, rng, () => 3, (r) => normalize(chirp(at(0.5), glide(70 + 20 * r.next(), 38, 0.06), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.15)), 0.3 + 0.4 * r.next()));
    grains(x, rng, () => 25, (r) => normalize(hp(envAD(white(240, r), 0.00005, 0.0008), 2000), 0.05 + 0.1 * r.next()));
    return x;
  }), 0.35);
}

export function pyroRecipes(): Recipe[] {
  return [
    ['boom/keg', 2, kegBody], ['sub/keg', 2, kegSub], ['crack/nitro', 3, nitroCrack], ['boom/mega', 1, megaRoll],
    ['loop/barrage', 1, barrageLoop],
  ];
}

// ============================================================================================
// director
// ============================================================================================

export interface PyroHost {
  play(name: string, var01: number, o: PlayOpts): boolean;
  loop(id: string, kind: LoopKind, pos: Vec3, level: number, o?: LoopOpts): void;
  now(): number;
  listener(): Vec3;
  duckMusic(when: number): void;
  /** The music/ambience intensity integrator, and the 2 s yield window for the choir. */
  heat(x: number, yieldAmount: number): void;
  /** > 40 yield in 2 s (the Kiloton moment). */
  mega(when: number): void;
}

interface Group {
  t0: number; when: number; pos: [number, number, number]; first: number; extra: number; count: number; cracks: number;
  debris: Debris[]; keg: boolean; nitro: boolean; win: number;
}

const MERGE_S = 0.08, MERGE_M = 8, BARRAGE_S = 0.15, BARRAGE_M = 14;
const MAX_GROUPS = 4;
const YIELD_CAP = 40;
const MAX_DIST_PYRO = 250;
const SOUND_SPEED = 343;
/** Yield per 0.5 s above which the mix switches to barrage mode. */
const BARRAGE_RATE = 5;

/** Yield when the event doesn't carry one (GAME_SPEC §12.6). */
export function yieldOf(type: string | undefined, mag: number): number {
  if (Number.isFinite(mag) && mag > 0) return Math.min(mag, 100);
  return type === 'powder_keg' || type === 'keg' ? 3 : type === 'jitterjuice' ? 1.5 : 1;
}

export class Pyro {
  private groups: Group[] = [];
  /** Recent detonations: time, yield, position (for rates and the bed centroid). */
  private hist: { t: number; y: number; p: Vec3 }[] = [];
  private lastAfter = -10;
  private lastMega = -10;
  private lastSub = -10;
  private bed = 0;
  private bedPos: [number, number, number] = [0, 0, 0];
  readonly stats = { merged: 0, leads: 0, aftermaths: 0, megas: 0, peakRate: 0 };

  constructor(private readonly h: PyroHost) {}

  reset(): void { this.groups = []; this.hist = []; this.bed = 0; }

  /** Yield in the last `sec` seconds. */
  rate(sec: number): number {
    const now = this.h.now();
    let s = 0;
    for (let i = this.hist.length - 1; i >= 0; i--) { const d = this.hist[i]!; if (now - d.t > sec) break; s += d.y; }
    return s;
  }

  /** 0..1 explosion density for the music (L5) and the ambience duck. */
  density(): number { return clamp(this.rate(0.5) / 12, 0, 1); }

  private boomGain(y: number): number { return clamp(0.72 + 0.11 * Math.log2(Math.max(y, 0.25)), 0.4, 1); }
  private bodySize(y: number): 0 | 1 | 2 { return y < 1.5 ? 0 : y < 4 ? 1 : 2; }
  private delay(pos: Vec3): number { const d = dist(pos, this.h.listener()); return d > 30 ? d / SOUND_SPEED : 0; }

  detonate(e: SimEventLike, type: string | undefined, when: number, var01: number, debrisKind: Debris): void {
    if (!finite3(e.pos)) return;
    const Y = yieldOf(type, e.mag);
    const now = this.h.now();
    const keg = type === 'powder_keg' || type === 'keg' || Y >= 3;
    const nitro = type === 'jitterjuice';
    this.hist.push({ t: now, y: Y, p: [e.pos[0], e.pos[1], e.pos[2]] });
    while (this.hist.length && now - this.hist[0]!.t > 2.5) this.hist.shift();
    const r05 = this.rate(0.5);
    if (r05 > this.stats.peakRate) this.stats.peakRate = r05;
    const barrage = r05 >= BARRAGE_RATE;
    this.h.heat(0.35 * Y, Y);
    if (Y >= 1) this.h.duckMusic(when);
    // close groups whose window has passed (frames can be late: don't wait for update())
    for (let i = this.groups.length - 1; i >= 0; i--) if (now - this.groups[i]!.t0 >= this.groups[i]!.win) this.flush(i);
    const win = barrage ? BARRAGE_S : MERGE_S, rad = barrage ? BARRAGE_M : MERGE_M;
    let gi = -1, best = Infinity;
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i]!;
      const d = dist(g.pos, e.pos);
      if (now - g.t0 < win && d < rad && d < best) { best = d; gi = i; }
    }
    if (gi < 0 && this.groups.length >= MAX_GROUPS) {
      // every slot is ringing: fold into the nearest group regardless of distance
      for (let i = 0; i < this.groups.length; i++) { const d = dist(this.groups[i]!.pos, e.pos); if (d < best) { best = d; gi = i; } }
    }
    const head = 1 / Math.sqrt(1 + 0.7 * this.groups.length) * (barrage ? 0.75 : 1);
    if (gi >= 0) {
      const g = this.groups[gi]!;
      const w = g.count + 1;
      for (let i = 0; i < 3; i++) g.pos[i] = (g.pos[i]! * g.count + e.pos[i]!) / w;
      g.count = w;
      g.extra += Y;
      g.keg ||= keg; g.nitro ||= nitro;
      if (g.debris.length < 4 && !g.debris.includes(debrisKind)) g.debris.push(debrisKind);
      this.stats.merged++;
      if (g.cracks < (barrage ? 1 : 3)) {
        g.cracks++;
        this.h.play(nitro ? 'crack/nitro' : 'crack', var01, { family: 'pyro', pos: e.pos, when: when + this.delay(e.pos), gain: 0.5 * head, rate: 0.9 + 0.2 * var01, maxDist: MAX_DIST_PYRO, key: 'crack' });
      }
      return;
    }
    this.groups.push({ t0: now, when, pos: [e.pos[0], e.pos[1], e.pos[2]], first: Y, extra: 0, count: 1, cracks: 0, debris: [debrisKind], keg, nitro, win });
    this.stats.leads++;
    this.lead(e.pos, Y, when + this.delay(e.pos), var01, debrisKind, keg, nitro, head, barrage ? 0 : 1);
  }

  private lead(pos: Vec3, Y: number, when: number, var01: number, debrisKind: Debris, keg: boolean, nitro: boolean, head: number, tails: number): void {
    const gb = this.boomGain(Y) * head;
    const o = { family: 'pyro' as const, pos, maxDist: MAX_DIST_PYRO };
    if (nitro) this.h.play('crack/nitro', var01, { ...o, when, gain: gb * 0.9, rate: 0.95 + 0.1 * var01, key: 'crack', prio: 1.3 });
    else this.h.play('crack', var01, { ...o, when, gain: gb * 0.8, rate: 0.92 + 0.16 * var01, key: 'crack', prio: 1.2 });
    if (keg) this.h.play('boom/keg', var01, { ...o, when, gain: gb, rate: 0.95 + 0.08 * var01, key: 'body', prio: 1.8 });
    else this.h.play(`body/${this.bodySize(Y)}`, var01, { ...o, when, gain: gb, rate: 0.96 + 0.08 * var01, key: 'body', prio: 1.5 });
    if (Y >= 1.5 && when - this.lastSub > 0.12) {
      this.lastSub = when;
      if (keg) this.h.play('sub/keg', var01, { ...o, when: when + 0.01, gain: clamp(0.6 + 0.1 * Math.log2(Y), 0.5, 0.95) * Math.sqrt(head), key: 'sub', prio: 1.4 });
      else this.h.play('sub', var01, { ...o, when, gain: clamp(0.5 + 0.12 * Math.log2(Y), 0.5, 1) * Math.sqrt(head), key: 'sub' });
    }
    const kinds: Debris[] = [keg ? 'wood' : nitro ? 'glass' : debrisKind, 'brick', 'wood', 'glass'];
    for (let i = 0; i < tails; i++) {
      this.h.play(`debris/${kinds[i % kinds.length]!}`, (var01 + i * 0.37) % 1, {
        family: 'tail', pos, maxDist: MAX_DIST_PYRO, when: when + 0.03 + i * 0.07, gain: 0.5 * gb / Math.sqrt(i + 1), rate: 0.95 + 0.1 * ((var01 * 7 + i) % 1), key: `debris${i}`,
      });
    }
  }

  private flush(i: number): void {
    const g = this.groups[i]!;
    this.groups.splice(i, 1);
    if (g.extra <= 0) return;
    const now = this.h.now();
    const total = Math.min(YIELD_CAP, g.first + g.extra);
    const v = hash01(g.count, Math.round(total * 100));
    const barrage = this.rate(0.5) >= BARRAGE_RATE;
    // aftermaths are spaced: in a barrage the bed carries the density between them
    if (now - this.lastAfter < (barrage ? 0.2 : 0.06)) return;
    this.lastAfter = now;
    this.stats.aftermaths++;
    const tails = Math.min(3, 1 + Math.floor(g.count / 4));
    const when = Math.max(now + 0.005, g.when + g.win * 0.5 + this.delay(g.pos));
    const head = 1 / Math.sqrt(1 + 0.7 * this.groups.length) * (barrage ? 0.8 : 1);
    const o = { family: 'pyro' as const, pos: g.pos, maxDist: MAX_DIST_PYRO };
    const gb = this.boomGain(total) * 0.85 * head;
    if (g.keg) this.h.play('boom/keg', v, { ...o, when, gain: gb, rate: 0.88 + 0.08 * v, key: 'body', prio: 2 });
    else this.h.play(`body/${this.bodySize(total)}`, v, { ...o, when, gain: gb, rate: 0.9 + 0.08 * v, key: 'body', prio: 2 });
    if (total >= 1.5 && when - this.lastSub > 0.12) {
      this.lastSub = when;
      this.h.play(g.keg ? 'sub/keg' : 'sub', v, { ...o, when, gain: clamp(0.55 + 0.12 * Math.log2(total), 0.5, 1) * Math.sqrt(head), key: 'sub', prio: 1.5 });
    }
    const first = g.debris[0] ?? 'wood';
    for (let k = 0; k < tails; k++) {
      const kind = k === 0 ? first : g.debris[k] ?? (['brick', 'wood', 'glass'] as const)[k % 3]!;
      this.h.play(`debris/${kind}`, (v + k * 0.31) % 1, {
        family: 'tail', pos: g.pos, maxDist: MAX_DIST_PYRO, when: when + 0.05 + k * 0.09, gain: 0.45 * gb / Math.sqrt(k + 1), rate: 0.9 + 0.15 * ((v * 5 + k) % 1), key: `debris${k}`,
      });
    }
  }

  /** Per frame: close merge windows, drive the barrage bed and the mega layer. */
  update(dt: number): void {
    const now = this.h.now();
    for (let i = this.groups.length - 1; i >= 0; i--) if (now - this.groups[i]!.t0 >= this.groups[i]!.win) this.flush(i);
    while (this.hist.length && now - this.hist[0]!.t > 2.5) this.hist.shift();
    const r05 = this.rate(0.5);
    const target = clamp((r05 - 3) / 12, 0, 1.3);
    const k = target > this.bed ? 0.35 : 1 - Math.exp(-fin(dt, 0) / 1.5);
    this.bed = clamp(this.bed + (target - this.bed) * k, 0, 1.3);
    if (this.bed > 0.02) {
      // centroid of the last second of detonations
      let n = 0; const c: [number, number, number] = [0, 0, 0];
      for (const d of this.hist) if (now - d.t < 1) { c[0] += d.p[0] * d.y; c[1] += d.p[1] * d.y; c[2] += d.p[2] * d.y; n += d.y; }
      if (n > 0) { this.bedPos = [c[0]! / n, c[1]! / n, c[2]! / n]; }
      this.h.loop('pyro:barrage', 'barrage', this.bedPos, this.bed, { ref: 8 });
    }
    const y2 = this.rate(2);
    if (y2 >= YIELD_CAP && now - this.lastMega > 5) {
      this.lastMega = now;
      this.stats.megas++;
      const when = now + 0.02 + this.delay(this.bedPos);
      this.h.play('boom/mega', 0, { family: 'pyro', pos: this.bedPos, when, gain: 0.9, prio: 3, maxDist: MAX_DIST_PYRO, key: 'mega' });
      this.h.mega(when);
    }
  }
}

/** Debris tail for a part type's material (bank Debris kinds). */
export function debrisFor(type: string | undefined, fallback: Debris): Debris {
  if (type === 'powder_keg' || type === 'keg') return 'wood';
  if (type === 'jitterjuice') return 'glass';
  return fallback;
}

