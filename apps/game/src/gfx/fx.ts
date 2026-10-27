// Spectacle effect composites (art/briefs/vfx.md): explosions, fuse sparks, smoke, dust, debris, shock
// rings and the flash limiter. Counts per tier follow vfx.md §2.1–2.7 (canonical); tier 32 (D85) doubles
// the 16 GB counts.
//
// M3 (stream G3): this is the event router for the Spectacle systems. A blast now spawns a volumetric
// fireball (a mushroom for the Powder Keg) in a pooled fluid grid (volume.ts; particles stay as the
// fallback when no grid is free), debris chunklets (debris.ts), a shock ring with its refraction shell and
// dust kick-up (shockwave.ts), and asks main.ts for hitstop / auto slow-mo (wall clock only). Every
// exposure flash and large light goes through the flash limiter (GAME_SPEC §20, RENDERING §9). Nothing
// here feeds back into the sim.

import type { V3 } from '../math.ts';
import { Beams } from './beams.ts';
import { Debris, type DebrisBurst } from './debris.ts';
import type { GTier } from './gi.ts';
import { Kind } from './particles.ts';
import type { Renderer } from './renderer.ts';
import { Shockwaves } from './shockwave.ts';
import { Volumes } from './volume.ts';
import { Arcs } from './matter/arcs.ts'; // R4 (M4): electric arcs

const TIER_INDEX = { 4: 0, 8: 1, 12: 2, 16: 3, 32: 4 } as const;
type Tier = keyof typeof TIER_INDEX;
type Counts = readonly [number, number, number, number] | readonly [number, number, number, number, number];

const SPARK_HOT: [number, number, number, number] = [1.0, 0.78, 0.44, 9]; // #FFC870 core, HDR
const SPARK_GLOW: [number, number, number, number] = [1.0, 0.54, 0.16, 6]; // #FF8A2A
const EMBER: [number, number, number, number] = [1.0, 0.42, 0.12, 4]; // #FF6A1F
const SMOKE: [number, number, number, number] = [0.105, 0.122, 0.162, 1]; // #5B6270 linear
const SMOKE_CORE: [number, number, number, number] = [0.068, 0.08, 0.117, 1]; // #4A5060
/** Flash colour clip (vfx §0.3): #FFF4E0 in linear. */
const FLASH_CLIP: V3 = [1.0, 0.905, 0.745];

/** Comfort settings the effects respect (ui/settings.ts `comfort`, passed in by main.ts). */
export interface FxComfort {
  readonly reduceFlashing: boolean;
  readonly reducedMotion: boolean;
  /** 0..1, 0.5 default = vfx §2.1 hitstop (60 / 80 / 100 ms). */
  readonly hitstop: number;
  /** 0..1, 0.5 default = 0.25× for 0.8 s. */
  readonly slowmo: number;
}

/** Debris looks by part type (vfx §2.7 / shared_kit §8 masters, approximated by colour and shape). */
const SHATTER: Record<string, { color: V3; color2: V3; shape: 0 | 1 | 2 | 3; size: [number, number] }> = {
  brik: { color: [0.47, 0.13, 0.07], color2: [0.62, 0.25, 0.14], shape: 0, size: [0.008, 0.03] },
  plank: { color: [0.5, 0.3, 0.13], color2: [0.32, 0.17, 0.07], shape: 1, size: [0.01, 0.035] },
  pane: { color: [0.75, 0.86, 0.9], color2: [0.6, 0.75, 0.82], shape: 2, size: [0.006, 0.025] },
  vase: { color: [0.82, 0.78, 0.7], color2: [0.12, 0.3, 0.62], shape: 2, size: [0.006, 0.022] },
  fishbowl: { color: [0.75, 0.86, 0.9], color2: [0.6, 0.75, 0.82], shape: 2, size: [0.006, 0.022] },
  yolk: { color: [0.95, 0.66, 0.08], color2: [0.98, 0.92, 0.8], shape: 3, size: [0.006, 0.018] },
  stackers: { color: [0.0, 0.42, 1.0], color2: [1.0, 0.11, 0.02], shape: 0, size: [0.006, 0.02] },
  powder_keg: { color: [0.42, 0.25, 0.1], color2: [0.25, 0.14, 0.06], shape: 1, size: [0.012, 0.045] },
  bangstick: { color: [0.85, 0.12, 0.06], color2: [0.93, 0.88, 0.78], shape: 3, size: [0.006, 0.018] },
};

/**
 * Flash limiter (GAME_SPEC §20, RENDERING §9, vfx §0.3). Event layer: every exposure flash and every
 * light covering > 25 % of the screen is *large*; with Reduce flashing on, a 4th large flash inside the
 * rolling second merges into the running one (extends its decay, no new peak). Peaks are capped at
 * +0.6 EV (on) / +1.5 EV (off), rise ≥ 50 ms and decay 300 ms (on) / 1 frame and 200 ms (off).
 * Measured layer (the safety net): the frame-average luminance from the HDR meter; a rise of more than
 * 2.5× within 100 ms more than 3 times a second clamps exposure for half a second, and counts as large.
 */
export class FlashLimiter {
  reduce = true;
  /** Wall-clock times (ms) of large-flash peaks inside the rolling second. */
  private peaks: number[] = [];
  private level = 0;
  private peak = 0;
  private phase: 'idle' | 'rise' | 'decay' = 'idle';
  private t = 0;
  private lum: { t: number; l: number }[] = [];
  private trips: number[] = [];
  private clampEv = 0;
  private clampUntil = 0;
  stats = { large: 0, merged: 0, trips: 0 };

  /** A large flash with this EV peak (before the cap). Returns false when it merged into the running one. */
  large(ev: number, now: number): boolean {
    this.peaks = this.peaks.filter((t) => now - t < 1000);
    if (this.reduce && this.peaks.length >= 3) {
      // merge: hold the current level and restart the decay from it
      if (this.phase !== 'idle') { this.peak = Math.max(this.level, 0.05); this.phase = 'decay'; this.t = 0; }
      this.stats.merged++;
      return false;
    }
    this.peaks.push(now);
    this.stats.large++;
    const cap = this.reduce ? 0.6 : 1.5;
    this.peak = Math.max(this.level, Math.min(cap, ev));
    this.phase = 'rise';
    this.t = 0;
    return true;
  }

  /** Remaining large-flash budget inside the rolling second (Reduce flashing on). */
  budget(now: number): number { return this.reduce ? Math.max(0, 3 - this.peaks.filter((t) => now - t < 1000).length) : 99; }

  /** Feeds one measured frame-average luminance (pre-exposure). */
  measure(l: number, now: number): void {
    this.lum = this.lum.filter((s) => now - s.t < 1000);
    const recent = this.lum.filter((s) => now - s.t <= 100);
    const base = recent.length ? Math.min(...recent.map((s) => s.l)) : l;
    this.lum.push({ t: now, l });
    if (!this.reduce || base <= 1e-4) return;
    if (l > base * 2.5 && (!this.trips.length || now - this.trips.at(-1)! > 120)) {
      this.trips.push(now);
      this.peaks.push(now); // a trip counts as a large flash even if it wasn't tagged
      this.stats.trips++;
    }
    this.trips = this.trips.filter((t) => now - t < 1000);
    if (this.trips.length > 3) {
      this.clampEv = Math.max(this.clampEv, Math.log2(l / (base * 2.5)) + 0.25);
      this.clampUntil = now + 500;
    }
  }

  /** Advances the envelope; returns the exposure boost (EV) for this frame. */
  update(dt: number, now: number): number {
    const rise = this.reduce ? 0.05 : 0;
    const decay = this.reduce ? 0.3 : 0.2;
    this.t += dt;
    if (this.phase === 'rise') {
      this.level = rise > 0 ? Math.min(this.peak, this.level + (this.peak / rise) * dt) : this.peak;
      if (this.level >= this.peak - 1e-4) { this.phase = 'decay'; this.t = 0; }
    } else if (this.phase === 'decay') {
      const u = Math.min(1, this.t / decay);
      this.level = this.peak * (1 - u) * (1 - u);
      if (u >= 1) { this.phase = 'idle'; this.level = 0; }
    }
    if (now > this.clampUntil) this.clampEv = Math.max(0, this.clampEv - dt * 2);
    return this.level - this.clampEv;
  }

  clear(): void { this.peaks = []; this.level = 0; this.phase = 'idle'; this.trips = []; this.clampEv = 0; }
}

export class Fx {
  private readonly r: Renderer;
  private readonly t: number;
  readonly tier: GTier;
  readonly volumes: Volumes;
  readonly debris: Debris;
  readonly shock: Shockwaves;
  readonly beams: Beams;
  /** R4 (M4): electric arcs (vfx §4.1). */
  readonly arcs: Arcs;
  readonly flashes = new FlashLimiter();
  /** Multiplier on every count (the "Unlimited Mayhem" / benchmark knob). */
  mayhem = 1;
  comfort: FxComfort = { reduceFlashing: true, reducedMotion: false, hitstop: 0.5, slowmo: 0.5 };
  /** Volumetric grids on (false = the particle fallback everywhere; the live governor's knob). */
  volumetrics = true;
  /** Benchmark A/B: true = the M2 composites only (no grids, debris, shock rings, GI). */
  legacy = false;
  /**
   * Spectacle governor: the effects spend the tier's headroom only while there is frame time. When the GPU
   * frame time (`timer.frameMs`, G5) stays over 85 % of 16.7 ms for 0.4 s it steps down; under 60 % for 3 s it steps
   * back up. 0 = full; 1 = coarser march, fewer Jacobi iterations, 60 % counts; 2 = grids at half rate and
   * 70 % resolution, 35 % counts; 3 = new blasts use the particle fallback, 20 % counts. Never touches the sim.
   */
  governor = { enabled: true, level: 0, budgetMs: 16.7 };
  private gov = { over: 0, under: 0, last: 0 };
  private readonly baseJacobi: number;
  /** Hitstop / auto slow-mo requests (wall clock): main.ts forwards them to the run's local playhead. */
  onTimeWarp: ((factor: number, seconds: number, kind: 'hitstop' | 'slowmo') => void) | null = null;
  private yields: { t: number; y: number }[] = [];
  private slowmoUntil = 0;
  private lastHitstop = 0;
  private stems: { pos: V3; left: number }[] = [];
  private recent: { p: V3; t: number }[] = [];
  private readonly fireCap: number;

  constructor(renderer: Renderer, tier: Tier, rebuilt = false) {
    // M4 (V4): a device loss drops this hook and the systems' GPU resources; the renderer rebuilds itself and
    // calls back here: rebuild the systems on the new device (CPU settings on `this` carry over)
    if (!rebuilt) {
      renderer.onRestore(() => {
        this.volumes.dispose();
        const f = new Fx(renderer, tier, true);
        Object.assign(this, { volumes: f.volumes, debris: f.debris, shock: f.shock, beams: f.beams, arcs: f.arcs, flashes: f.flashes });
      });
    }
    this.r = renderer;
    this.t = TIER_INDEX[tier] ?? 3;
    this.tier = tier;
    const s = renderer.spectacleTargets();
    this.volumes = new Volumes(s.device, tier, s.frameBuf, s.colorFormat, s.msaa);
    this.debris = new Debris(s.device, tier, s.gi, s.frameBuf, s.shadowView, s.shadowSampler, s.colorFormat, s.msaa);
    this.shock = new Shockwaves(s.device, s.frameBuf, s.colorFormat, s.msaa);
    this.beams = new Beams(s.device, s.frameBuf, s.colorFormat, s.msaa);
    this.beams.motesPerBeam = [100, 250, 500, 1000, 2000][this.t]!;
    this.arcs = new Arcs(s.device, s.frameBuf, s.colorFormat, s.msaa); // R4 (M4): vfx §4.1 budgets by tier
    this.arcs.segments = [64, 128, 192, 256, 256][this.t]!;
    this.arcs.branches = [2, 3, 4, 5, 5][this.t]!;
    this.arcs.maxBolts = [4, 8, 16, 32, 32][this.t]!;
    this.fireCap = [1, 2, 3, 4, 5][this.t]!;
    this.baseJacobi = this.volumes.jacobi;
    renderer.taa.onLuminance = (l) => this.flashes.measure(l, performance.now());
    const vol = this.volumes, deb = this.debris, sh = this.shock, bm = this.beams, arcs = this.arcs;
    renderer.addHook({
      simulate: (pass, dt) => {
        vol.update(pass, dt, renderer.keyDir);
        deb.update(pass, dt, performance.now() / 1000);
      },
      drawShadow: (pass) => deb.drawShadow(pass),
      drawOpaque: (pass) => deb.draw(pass),
      needsDepth: () => vol.anyActive || sh.active,
      afterOpaque: (enc, depth) => { sh.prepare(); vol.march(enc, depth, renderer.eye, () => renderer.timer.render('volume')); }, // G5 (M5): only when it marches
      drawLate: (pass) => { sh.drawLate(pass); vol.composite(pass); bm.drawLate(pass); arcs.draw(pass); },
      shells: () => sh.shells(renderer.viewProj, renderer.eye, renderer.camRight, renderer.camUp),
      clear: () => { vol.clear(); deb.clear(); sh.clear(); bm.clear(); arcs.clear(); this.flashes.clear(); this.stems = []; },
    });
  }

  private pick(v: Counts): number {
    const k = Math.min(this.t, v.length - 1);
    const base = v[k]! * (this.t === 4 && v.length === 4 ? 2 : 1);
    return Math.round(base * this.mayhem * this.govScale);
  }

  /** Wall-clock per-frame work: the flash envelope (→ renderer.exposureBoost), shock rings, keg stems. */
  frame(wallDt: number): void {
    const now = performance.now();
    this.flashes.reduce = this.comfort.reduceFlashing;
    this.shock.shellsOn = !this.legacy;
    this.shock.shellScale = this.comfort.reducedMotion ? 0.3 : 1;
    this.r.exposureBoost = this.flashes.update(wallDt, now);
    this.r.gi.enabled = !this.legacy;
    this.govern(now);
    this.volumes.eye = this.r.eye;
    this.volumes.tanHalfFov = Math.tan((this.r.fovDeg * Math.PI) / 360);
    this.debris.screenH = this.r.internalSize[1];
    const dt = wallDt * this.r.timeScale;
    this.shock.frame(dt, this.r.particles, this.volumetrics ? this.volumes : null);
    this.frameArcs(dt); // R4 (M4)
    // Powder Keg stems: fuel keeps feeding the base for half a second so the cap gets a stem
    for (let i = this.stems.length - 1; i >= 0; i--) {
      const s = this.stems[i]!;
      s.left -= dt;
      if (s.left <= 0) { this.stems.splice(i, 1); continue; }
      this.volumes.inject('fire', { pos: s.pos, radius: 0.45, fuel: 7, temp: 2.4, density: 0.6, vel: [0, 3.5, 0] }, 6, 14, { lift: 0.04 });
    }
  }

  /** This frame's light beams (run.beams in a run, empty otherwise); `dt` = the wall frame time. */
  setBeams(beams: Float32Array, wallDt: number): void {
    const h = Math.max(1, this.r.internalSize[1]);
    this.beams.set(beams, wallDt * this.r.timeScale, performance.now() / 1000, (2 * Math.tan((this.r.fovDeg * Math.PI) / 360)) / h, this.r.particles);
  }

  private govern(now: number): void {
    const g = this.governor, s = this.gov;
    const dt = s.last ? Math.min(0.25, (now - s.last) / 1000) : 0;
    s.last = now;
    if (!g.enabled || !this.r.timer.enabled) { this.applyGovernor(0); return; }
    const gpu = this.r.timer.frameMs; // G5 (M5): the GPU frame time, stale timer slots and names excluded
    if (!(gpu > 0)) return; // no frame resolved yet
    if (gpu > g.budgetMs * 0.85) { s.over += dt; s.under = 0; } else if (gpu < g.budgetMs * 0.6) { s.under += dt; s.over = 0; } else { s.over = 0; s.under = 0; }
    if (s.over > 0.4 && g.level < 3) { g.level++; s.over = 0; }
    if (s.under > 3 && g.level > 0) { g.level--; s.under = 0; }
    this.applyGovernor(g.level);
  }

  private applyGovernor(level: number): void {
    this.volumes.stepScale = level >= 1 ? 1.6 : 1;
    this.volumes.jacobi = level >= 1 ? Math.max(6, Math.round(this.baseJacobi * 0.6 / 2) * 2) : this.baseJacobi;
    this.volumes.forceHalf = level >= 2;
    this.volumes.cellScale = level >= 2 ? 0.7 : 1;
    this.govScale = [1, 0.6, 0.35, 0.2][level]!;
    this.govVolOff = level >= 3;
  }
  private govVolOff = false;
  private govScale = 1;

  /** Drops every live effect (Stop: a perfect reset). */
  clear(): void { this.r.particles.clear(); this.r.clearHooks(); }

  /** A point light flash through the limiter: colour clipped at #FFF4E0; with Reduce flashing the peak is
   * capped, a light covering > 25 % of the screen counts as large, and a merged one stays dim.
   * `large`: the caller already ran the limiter for this flash (a blast's light shares its exposure flash). */
  private flashLight(p: V3, color: V3, radius: number, dur: number, now: number, large?: boolean): void {
    const m = Math.max(color[0], color[1], color[2], 1e-4);
    const c: [number, number, number] = [0, 1, 2].map((i) => Math.min(color[i]! / m, FLASH_CLIP[i]!) * m) as [number, number, number];
    let k = 1;
    if (this.comfort.reduceFlashing) {
      k = 0.6;
      let fresh = large;
      if (fresh === undefined) {
        const e = this.r.eye;
        const dist = Math.max(0.05, Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]) - radius * 0.5);
        const rNdc = (radius * 0.5) / dist / Math.tan((this.r.fovDeg * Math.PI) / 360);
        const aspect = this.r.canvas.width / Math.max(1, this.r.canvas.height);
        const cover = Math.min(1, (Math.PI * rNdc * rNdc) / (4 * aspect));
        fresh = cover > 0.25 ? this.flashes.large(0, now) : true;
      }
      if (!fresh) k *= 0.35;
    }
    this.r.flash(p, [c[0] * k, c[1] * k, c[2] * k], radius, dur);
  }

  /**
   * R5 (M5): a Future Tech flash light (Coilgun exit, Stasis node flare, the Singularity's collapse) through the limiter.
   * `largeEv`: an exposure flash of that EV (counts toward the ≤ 3 large flashes a second); omitted, it's a light only
   * (large only if it covers > 25 % of the screen).
   */
  fieldFlash(p: V3, color: V3, radius: number, dur: number, largeEv?: number): void {
    const now = performance.now();
    const fresh = largeEv !== undefined ? this.flashes.large(largeEv, now) : undefined;
    this.flashLight(p, color, radius, dur, now, fresh);
  }

  /** Detonation (vfx §2.1–2.3) for yield Y at P. `type` = the part type (powder_keg gets the mushroom). */
  boom(p: V3, yieldY: number, type = ''): void {
    const now = performance.now();
    const p0 = this.r.particles;
    // vfx §0.2: blasts within 1.0 m and ~3 ticks merge into one composite (the grid merges on its own);
    // hero counts scale with distance, clamp((30 m / d)², 0.1, 1)
    this.recent = this.recent.filter((b) => now - b.t < 60);
    const merged = !this.legacy && this.recent.some((b) => Math.hypot(b.p[0] - p[0], b.p[1] - p[1], b.p[2] - p[2]) < 1.0);
    if (!merged) this.recent.push({ p, t: now });
    const e = this.r.eye;
    const far = this.legacy ? 1 : Math.min(1, Math.max(0.1, (30 / Math.max(1, Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]))) ** 2));
    const hero = far * (merged ? 0.25 : 1);
    const s = Math.cbrt(Math.max(yieldY, 0.1));
    const keg = /keg/.test(type) || yieldY >= 3;
    const big = keg, med = yieldY >= 1.5 && !big;
    const scale = big ? 2.5 : med ? 1.3 : 1;
    const fireball = (big ? 2.4 : med ? 1.5 : 1.2) * Math.max(1, s / (big ? 1.44 : 1));
    const up: V3 = [0, 1, 0];
    // volumetric fireball (vfx §2.1: 2 m cube; keg 5–6 m mushroom); particles are the fallback
    let vol = false;
    if (this.volumetrics && !this.legacy && !this.govVolOff) {
      if (keg) {
        vol = this.volumes.inject('fire', { pos: p, radius: 0.8 * s / 1.44, temp: 3.0, fuel: 5, density: 0.5, expand: 3, burst: true }, 6.5, 16, { lift: 0.05 });
        if (vol) this.stems.push({ pos: [p[0], Math.max(0.2, p[1]), p[2]], left: 0.5 });
      } else {
        vol = this.volumes.inject('fire', { pos: p, radius: 0.32 * s, temp: 2.4, fuel: 3, density: 0.3, expand: 1.6, burst: true }, 2.2 * Math.max(1, s), 4.5, { cells: Math.round(this.volumes.n * 0.6), lift: 0.3 });
      }
    }
    const fb = vol ? 0.25 : 1;
    if (!merged) p0.emit({ pos: p, count: Math.round(this.pick([64, 96, 128, 192]) * scale * fb * far), kind: Kind.fire, dir: up, spread: 1, speed: [0.6 * s, 3.2 * s], life: [0.35, 0.75], size: [0.25 * s, 0.6 * s], color: [1, 0.75, 0.4, 6], color2: [1, 0.45, 0.12, 4], gravity: -0.1, drag: 4.5, jitter: fireball * 0.15 });
    if (!merged) p0.emit({ pos: p, count: Math.round(this.pick([12, 20, 32, 48]) * scale), kind: Kind.glow, dir: up, spread: 1, speed: [0, 0.4], life: [0.12, 0.22], size: [fireball * 1.2, fireball * 1.8], color: [1, 0.9, 0.7, 12] });
    // sparks + embers
    p0.emit({ pos: p, count: Math.round(this.pick(big ? [3000, 6000, 12000, 24000] : med ? [1500, 3000, 6000, 12000] : [1000, 2000, 4000, 8000]) * hero), kind: Kind.spark, dir: up, spread: 0.85, speed: [3 * s, 13 * s], life: [0.25, 0.9], size: [0.008, 0.016], color: SPARK_HOT, color2: SPARK_GLOW, gravity: 1, drag: 1.2, jitter: 0.05 });
    p0.emit({ pos: p, count: Math.round(this.pick(big ? [500, 1000, 2000, 4000] : med ? [200, 400, 800, 1500] : [150, 300, 600, 1000]) * hero), kind: Kind.ember, dir: up, spread: 0.9, speed: [1 * s, 6 * s], life: [0.8, 2.2], size: [0.012, 0.03], color: EMBER, color2: SPARK_GLOW, gravity: 0.6, drag: 1.5, jitter: 0.1 });
    // smoke: puff → lingering column (thinned when the grid carries the smoke)
    const sm = vol ? 0.35 : 1;
    p0.emit({ pos: p, count: Math.round(this.pick([10, 16, 24, 32]) * scale * sm), kind: Kind.smoke, dir: up, spread: 1, speed: [0.2 * s, 1.0 * s], life: [1.0, 2.0], size: [0.14 * s, 0.3 * s], color: SMOKE, color2: SMOKE_CORE, gravity: 0, drag: 2.5, jitter: fireball * 0.2 });
    p0.emit({ pos: [p[0], p[1] + 0.2 * s, p[2]], count: Math.round(this.pick([6, 10, 14, 20]) * scale * sm), kind: Kind.smoke, dir: up, spread: 0.15, speed: [0.3, 0.9], life: [2.0, big ? 6 : 3], size: [0.1 * s, 0.22 * s], color: SMOKE, color2: SMOKE_CORE, gravity: 0, drag: 0.8, jitter: 0.08 * s });
    // debris micro (vfx §2.7: per yield unit × Y; keg: wood + paper)
    const per = this.pick([40, 80, 160, 300]) * Math.max(1, yieldY) * far * (merged ? 0.5 : 1);
    const look = SHATTER[keg ? 'powder_keg' : 'bangstick']!;
    if (!this.legacy) this.debris.emit({ pos: p, count: Math.round(per * (keg ? 0.7 : 1)), extent: [0.06 * s, 0.1 * s, 0.06 * s], dir: up, spread: 0.95, speed: [2 * s, 7 * s], size: look.size, life: this.debrisLife(), color: look.color, color2: look.color2, shape: look.shape, persist: this.persistShare(), spin: 18 });
    if (keg && !this.legacy) this.debris.emit({ pos: p, count: Math.round(per * 0.3), extent: [0.1, 0.1, 0.1], dir: up, spread: 1, speed: [1.5, 6], size: SHATTER.bangstick!.size, life: this.debrisLife(), color: [0.9, 0.86, 0.76], color2: [0.85, 0.12, 0.06], shape: 3, persist: this.persistShare(), spin: 22 });
    if (merged) { this.timeWarp(yieldY, 0, now); return; }
    // shock ring, refraction shell, dust kick-up
    if (!this.legacy) this.shock.spawn(p, keg ? Math.max(3, yieldY) : yieldY, keg && this.volumetrics);
    // flash light (vfx table: 2,800 K r 6 m 0.25 s; keg 2,600 K r 12 m 0.4 s) and the exposure flash
    const ev = this.comfort.reduceFlashing ? (big ? 0.6 : med ? 0.5 : 0.4) : (big ? 1.5 : med ? 1.2 : 1.0);
    const fresh = this.flashes.large(ev, now);
    this.flashLight([p[0], p[1] + 0.3, p[2]], big ? [12, 6.5, 3] : [9, 5.5, 2.6], big ? 12 : med ? 7 : 6, big ? 0.4 : 0.25, now, fresh);
    // scorch + soot decals on the floor (vfx §2.8: Ø = fireball Ø, 1–3 soot)
    if (p[1] < 0.6) {
      p0.emit({ pos: [p[0], 0, p[2]], count: 1, kind: Kind.decal, speed: [0, 0], life: [600, 600], size: [fireball, fireball], color: [0.03, 0.025, 0.02, 1], gravity: 0 });
      // soot splats around it: offset on the floor here (the particle jitter is 3D and would float them)
      for (let k = big ? 3 : med ? 2 : 1; k > 0; k--) {
        const a = Math.random() * Math.PI * 2, rr = fireball * 0.6 * Math.sqrt(Math.random());
        p0.emit({ pos: [p[0] + Math.cos(a) * rr, 0, p[2] + Math.sin(a) * rr], count: 1, kind: Kind.decal, speed: [0, 0], life: [600, 600], size: [fireball * 0.4, fireball * 0.7], color: [0.05, 0.045, 0.04, 1], gravity: 0 });
      }
    }
    this.timeWarp(yieldY, big ? 0.1 : med ? 0.08 : 0.06, now);
  }

  /** Hitstop per blast and auto slow-mo when yield in a 0.5 s window reaches 3 (GAME_SPEC §13). */
  private timeWarp(yieldY: number, hitstop: number, now: number): void {
    const c = this.comfort;
    this.yields = this.yields.filter((e) => now - e.t < 500);
    this.yields.push({ t: now, y: yieldY });
    const total = this.yields.reduce((a, e) => a + e.y, 0);
    if (!this.onTimeWarp) return;
    if (!c.reducedMotion && c.slowmo > 0 && total >= 3 && now > this.slowmoUntil) {
      const factor = 1 - 0.75 * Math.min(1, c.slowmo * 2);
      const secs = 0.8 * (c.slowmo > 0.5 ? 1 + (c.slowmo - 0.5) : 1);
      this.slowmoUntil = now + secs * 1000 + 2000; // a cooldown, or a chain would stay slow forever
      this.yields = [];
      this.onTimeWarp(factor, secs, 'slowmo');
      return;
    }
    if (!c.reducedMotion && c.hitstop > 0 && hitstop > 0 && now - this.lastHitstop > 300 && now > this.slowmoUntil - 2000) {
      this.lastHitstop = now;
      this.onTimeWarp(0, hitstop * Math.min(1, c.hitstop * 2), 'hitstop');
    }
  }

  private debrisLife(): [number, number] {
    // vfx §2.7: Low fades after 8 s, Medium 20 s, High / Ultra persist as rubble
    return this.t === 0 ? [6, 8] : this.t === 1 ? [16, 20] : [20, 30];
  }

  private persistShare(): number { return this.t >= 2 ? 0.85 : 0; }

  /** A part broke (Break): chunklets in its master's look from inside its bounds, plus a dust puff. */
  shatter(p: V3, type: string, half: V3 = [0.05, 0.05, 0.05], color?: V3): void {
    const look = SHATTER[type] ?? { color: color ?? [0.5, 0.5, 0.5], color2: color ?? [0.4, 0.4, 0.4], shape: 0 as const, size: [0.006, 0.02] as [number, number] };
    const vol = half[0] * half[1] * half[2] * 8;
    const m = vol > 0.02 ? [30, 60, 120, 250] as const : [20, 40, 80, 150] as const;
    const b: DebrisBurst = {
      pos: p, count: this.pick(m), extent: half, dir: [0, 1, 0], spread: 1, speed: [0.3, 2.2], size: look.size,
      life: this.debrisLife(), color: look.color, color2: look.color2, shape: look.shape, persist: this.persistShare(), spin: 10,
    };
    this.debris.emit(b);
    this.dust(p, 0.4);
    this.puff(p);
    if (this.volumetrics && (type === 'brik' || type === 'vase')) {
      this.volumes.inject('dust', { pos: p, radius: Math.max(0.12, Math.max(...half)), density: 0.9, expand: 1.2, burst: true }, 1.6, 3.5, { cells: 64, lift: 0.3 });
    }
  }

  /** Ignition (Ignite / FuseLit): a puff and a small warm flash (never large). */
  ignite(p: V3): void {
    this.puff(p);
    this.flashLight(p, [1.6, 0.9, 0.4], 0.6, 0.3, performance.now());
  }

  /** Fuse sparks for one frame at a burning point (vfx §1.1); call every frame while burning. */
  fuseSparks(p: V3, dt: number): void {
    const rate = this.pick([150, 300, 500, 800]);
    const n = Math.max(1, Math.round(rate * dt));
    this.r.particles.emit({ pos: p, count: n, kind: Kind.spark, dir: [0, 1, 0], spread: 0.6, speed: [0.4, 1.6], life: [0.08, 0.25], size: [0.004, 0.008], color: SPARK_HOT, color2: SPARK_GLOW, gravity: 0.8, drag: 0.5 });
    if (Math.random() < dt * 40) this.r.particles.emit({ pos: p, count: 1, kind: Kind.ember, dir: [0, 1, 0], spread: 0.5, speed: [0.2, 0.6], life: [0.4, 0.9], size: [0.006, 0.01], color: EMBER, gravity: 0.5, drag: 0.6 });
  }

  /** A burning surface (PLANK on fire): call every frame per flame point. Fire volume (vfx §1.6) when a grid
   * is free (max 1 / 2 / 3 / 4 / 5 fire grids by tier), else the particle fallback. */
  flame(p: V3, dt: number): void {
    let vol = false;
    if (this.volumetrics) {
      const fires = this.volumes.countOf('smoke');
      vol = this.volumes.inject('smoke', { pos: p, radius: 0.09, temp: 1.4, fuel: 9, density: 0.25, vel: [0, 0.9, 0] }, 2.2, 3, { cells: 96, lift: 0.12, cap: fires >= this.fireCap });
    }
    const n = Math.max(1, Math.round(this.pick([30, 50, 80, 120]) * dt * (vol ? 0.3 : 1)));
    this.r.particles.emit({ pos: p, count: n, kind: Kind.fire, dir: [0, 1, 0], spread: 0.25, speed: [0.2, 0.6], life: [0.3, 0.6], size: [0.05, 0.1], color: [1, 0.7, 0.35, 4], color2: [1, 0.4, 0.1, 3], gravity: -0.2, drag: 2, jitter: 0.04 });
    if (!vol && Math.random() < dt * 6) this.r.particles.emit({ pos: p, count: 1, kind: Kind.smoke, dir: [0, 1, 0], spread: 0.2, speed: [0.3, 0.6], life: [1.2, 2], size: [0.06, 0.12], color: SMOKE, gravity: 0, drag: 1 });
    this.r.light(p, [1.1, 0.55, 0.2], 0.9);
  }

  /** Small smoke puff (vfx §1.7). */
  puff(p: V3): void {
    this.r.particles.emit({ pos: p, count: this.pick([8, 16, 24, 32]), kind: Kind.smoke, dir: [0, 1, 0], spread: 1, speed: [0.1, 0.5], life: [0.8, 1.5], size: [0.05, 0.12], color: SMOKE, color2: SMOKE_CORE, gravity: 0, drag: 2 });
  }

  /** Heavy landing dust (vfx §2.6). */
  dust(p: V3, strength: number): void {
    this.r.particles.emit({ pos: [p[0], 0.02, p[2]], count: Math.round(this.pick([6, 10, 16, 24]) * Math.min(1, strength)), kind: Kind.dust, dir: [0, 1, 0], spread: 0.15, speed: [0.1, 0.5], life: [0.8, 1.6], size: [0.04, 0.1], color: [0.62, 0.6, 0.56, 1], gravity: 0, drag: 2.5, jitter: 0.1 });
  }

  // ---- R4 (M4): the M4 VFX rows (vfx §1.3, §3.1–3.3, §4.1) --------------------------------------------------

  /** True while the run has Matter gameplay (main.ts): Matter draws real water where the M2 effects faked it. */
  matterOn = false;
  private arcPhase = 0;
  private frameArcs(dt: number): void {
    this.arcs.update(dt, this.r.eye);
    if (!this.arcs.active) return;
    // one point light per bolt at its midpoint: 30 Hz ± 50 % with the bolt, or (Reduce flashing) ≤ 3 Hz ± 15 %
    this.arcPhase += dt;
    const reduce = this.comfort.reduceFlashing;
    this.arcs.lights().forEach((l, i) => {
      const f = reduce ? 1 + 0.15 * Math.sin(this.arcPhase * Math.PI * 2 * 2.5 + i) : 1 + 0.5 * Math.sin(Math.floor(this.arcPhase * 30 + i * 7) * 12.9898);
      const k = 1.6 * l.strength * Math.max(0.2, f);
      this.r.light(l.pos, [0.55 * k, 0.8 * k, 1.0 * k], 0.9);
    });
  }

  /**
   * An electric arc from a to b (ARC TOWER strike, motor overload, MAINS short): the bolt, crackle sprites at both
   * contacts and an arc-spark burst at the strike point. `dur` seconds (vfx §4.1: 0.15–0.6 s); a continuous discharge
   * calls this every frame with the same ends (the sparks then only re-burst now and then).
   */
  arc(a: V3, b: V3, dur = 0.3, strength = 1): void {
    const fresh = !this.arcs.has(a, b) || Math.random() < 0.08;
    this.arcs.strike(a, b, dur, strength);
    if (!fresh) return;
    const p0 = this.r.particles;
    for (const p of [a, b]) p0.emit({ pos: p, count: 3, kind: Kind.crackle, speed: [0, 0.05], life: [0.08, 0.18], size: [0.012, 0.03], color: [0.75, 0.9, 1.0, 6], gravity: 0, jitter: 0.008 });
    p0.emit({ pos: b, count: this.pick([60, 120, 240, 400]), kind: Kind.arc, dir: [a[0] - b[0], a[1] - b[1], a[2] - b[2]], spread: 0.9, speed: [1.5, 5], life: [0.04, 0.1], size: [0.002, 0.004], color: [0.96, 0.97, 1.0, 10], color2: [0.18, 0.84, 1.0, 8], gravity: 0.6, drag: 1.5, jitter: 0.004 });
  }

  /** YOLK breaks (vfx §3.1): splat decal and the domed yolk (until Stop) and a droplet crown; shell shards come from Break. */
  eggSplat(p: V3, surfaceY = p[1] - 0.02): void {
    const p0 = this.r.particles;
    const at: V3 = [p[0], surfaceY, p[2]];
    const d = 0.25 + Math.random() * 0.15;
    p0.emit({ pos: at, count: 1, kind: Kind.splat, speed: [0, 0], life: [600, 600], size: [d, d], color: [1, 1, 1, 1], gravity: 0 });
    p0.emit({ pos: [at[0] + 0.006, at[1] + 0.012, at[2] - 0.004], count: 1, kind: Kind.blob, speed: [0, 0], life: [600, 600], size: [0.045, 0.045], color: [1.0, 0.45, 0.024, 1], gravity: 0 }); // #FFB53D
    p0.emit({ pos: [at[0], at[1] + 0.01, at[2]], count: this.pick([20, 40, 80, 120]), kind: Kind.droplet, dir: [0, 1, 0], spread: 0.55, speed: [0.6, 2.2], life: [0.4, 0.6], size: [0.004, 0.009], color: [1.0, 0.9, 0.6, 1.5], color2: [1.0, 0.55, 0.08, 1.5], gravity: 1, drag: 0.4, jitter: 0.02 });
  }

  /**
   * Water splash (vfx §3.2): a crown of 12–24 fingers with droplet tips scaled by entry speed, spray, a foam puff
   * and a wet stain that dries over 20 s. `speed` = entry speed (m/s); Matter `Splash` events carry it as mag.
   */
  splash(p: V3, speed = 2): void {
    const p0 = this.r.particles;
    const k = Math.min(3, Math.max(0.5, speed / 2));
    const amb = this.ambientScale(p);
    p0.emit({ pos: p, count: Math.round(this.pick([200, 500, 1000, 2000]) * Math.min(1, k / 1.5) * amb * 0.5), kind: Kind.droplet, dir: [0, 1, 0], spread: 0.3, speed: [0.4 * k, 1.5 * k], life: [0.4, 0.9], size: [0.0015, 0.004], color: [0.85, 0.95, 1.0, 0.9], gravity: 1, drag: 0.6, jitter: 0.02 });
    const fingers = 12 + Math.round(Math.min(12, k * 4));
    for (let i = 0; i < fingers; i++) {
      const a = (i / fingers) * Math.PI * 2 + Math.random() * 0.2;
      const r = 0.02 * k;
      p0.emit({ pos: [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], count: 8, kind: Kind.droplet, dir: [Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55], spread: 0.02, speed: [0.6 * k, 1.3 * k], life: [0.35, 0.45], size: [0.004, 0.007], color: [0.9, 0.97, 1.0, 1.4], gravity: 1, drag: 0.2, jitter: 0.002 });
    }
    p0.emit({ pos: p, count: Math.round(this.pick([6, 10, 16, 24]) * amb), kind: Kind.foam, dir: [0, 1, 0], spread: 0.5, speed: [0.05, 0.25], life: [2, 6], size: [0.02, 0.05], color: [0.96, 0.98, 1.0, 1], gravity: 0, drag: 2, jitter: 0.03 });
    if (p[1] < 0.05) p0.emit({ pos: [p[0], 0, p[2]], count: 1, kind: Kind.stain, speed: [0, 0], life: [20, 20], size: [0.15 * k, 0.25 * k], color: [0, 0, 0, 1], gravity: 0 });
  }

  /** Sand puff (vfx §3.3): warm beige dust where fast grains land, avalanches, GRIT HOPPER start, HOURGLASS flip. */
  sandPuff(p: V3, strength = 1): void {
    const n = Math.round(this.pick([16, 32, 64, 96]) * Math.min(1.5, strength) * this.ambientScale(p));
    if (n <= 0) return;
    this.r.particles.emit({ pos: p, count: n, kind: Kind.dust, dir: [0, 1, 0], spread: 0.6, speed: [0.05, 0.35], life: [1, 2.5], size: [0.015, 0.05], color: [0.72, 0.58, 0.36, 1], color2: [0.66, 0.52, 0.3, 1], gravity: 0, drag: 2.2, jitter: 0.02 });
  }

  /** vfx §0.2: Ambient effects scale with distance, clamp((30 m / d)², 0.1, 1). */
  private ambientScale(p: V3): number {
    const e = this.r.eye;
    return Math.min(1, Math.max(0.1, (30 / Math.max(1, Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]))) ** 2));
  }

  /**
   * Routes the M4 sim events by name (A4 / B4 / MI append them to EventKind; unknown kinds are ignored). `other` =
   * the other part's world position when the event names one (an arc's target). True when handled here.
   */
  simEvent(kind: string, pos: V3, mag: number, partType = '', other: V3 | null = null): boolean {
    switch (kind) {
      case 'Splash':
        // with Matter on, a shattered FISHBOWL pours real Matter water: no cosmetic burst on top (MI)
        if (this.matterOn && partType === 'fishbowl') return true;
        this.splash(pos, mag > 0 ? mag : 2);
        return true;
      case 'Arc': case 'ArcStrike': case 'Zap': case 'Discharge':
        this.arc(pos, other ?? [pos[0], Math.max(0, pos[1] - 0.3), pos[2]], 0.15 + 0.45 * Math.min(1, Math.max(0, mag || 0.3)), 1);
        return true;
      case 'Splat': this.eggSplat(pos); return true;
      case 'SandPuff': case 'Avalanche': case 'GrainImpact': this.sandPuff(pos, mag > 0 ? mag : 1); return true;
      case 'Break': if (partType === 'yolk') this.eggSplat(pos); return false; // the debris still comes from shatter()
      default: return false;
    }
  }

  /** A continuous fountain: keeps roughly `live` sparks alive (benchmarks, the "brrr" spike). */
  fountain(p: V3, live: number, dt: number): void {
    const life = 1.6;
    const n = Math.round((live / life) * dt);
    if (n <= 0) return;
    this.r.particles.emit({ pos: p, count: n, kind: Kind.spark, dir: [0, 1, 0], spread: 0.12, speed: [6, 11], life: [life * 0.7, life * 1.3], size: [0.01, 0.02], color: SPARK_HOT, color2: SPARK_GLOW, gravity: 1, drag: 0.15, jitter: 0.05 });
  }
}
