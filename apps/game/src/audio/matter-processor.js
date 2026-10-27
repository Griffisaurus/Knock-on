// KNOCK-ON Matter granular player (AUDIO.md §1: "granular player (Matter)"). Loaded from this same-origin file
// via Vite `?url`, like limiter-processor.js: the host's CSP blocks Blob URLs.
//
// Eight mono outputs, one per stream (kind × {near, field}: sand, water, marble, goo (X5, M5)). Each stream is:
//   grains  Poisson-scheduled playback of the grain tables handed over in processorOptions (rendered from fixed
//           seeds in matter.ts), each grain re-pitched by pitch ± spread and given a random level; per-grain level
//           is normalised by the expected overlap so `grainGain` is the stream's loudness at any density
//   bed     band-passed noise (TPT state-variable filter) with a kind-specific slow modulation: the dense end of a
//           flow (pour hiss, rushing water, a marble rattle)
// Params arrive as one Float32Array per post: [rate, grainGain, pitch, spread, bedGain, bedFreq, bedQ] × stream
// (a clip's director adds a sequence number at the end, posted back once applied: beta, D127).
// Grain timing uses a seeded mulberry32 per stream (never Math.random), so an offline render repeats exactly.

const MAXG = 40;

class KnMatter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.S = o.streams | 0 || 8;
    this.P = o.params | 0 || 7;
    this.tables = Array.isArray(o.tables) ? o.tables : [[], [], [], []];
    this.meanSec = this.tables.map((list) => {
      if (!list || !list.length) return 0.005;
      let s = 0;
      for (const t of list) s += t.length;
      return s / list.length / sampleRate;
    });
    const S = this.S, P = this.P;
    this.target = new Float32Array(S * P);
    this.cur = new Float32Array(S * P);
    this.gOn = new Uint8Array(S * MAXG);
    this.gTab = new Uint16Array(S * MAXG);
    this.gPos = new Float64Array(S * MAXG);
    this.gInc = new Float32Array(S * MAXG);
    this.gAmp = new Float32Array(S * MAXG);
    this.gStart = new Uint16Array(S * MAXG);
    this.gAge = new Uint32Array(S * MAXG);
    this.next = new Float64Array(S);
    this.rng = new Uint32Array(S);
    const seed = (o.seed >>> 0) || 0x6d2b79f5;
    for (let s = 0; s < S; s++) this.rng[s] = (seed + Math.imul(s + 1, 0x9e3779b9)) >>> 0;
    this.ic1 = new Float64Array(S);
    this.ic2 = new Float64Array(S);
    this.am = new Float64Array(S);
    this.serial = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      // S × P params; a clip's director (beta, D127) appends a sequence number, echoed back once the params are in
      if (!d || (d.length !== S * P && d.length !== S * P + 1)) return;
      for (let i = 0; i < S * P; i++) { const v = d[i]; if (Number.isFinite(v)) this.target[i] = v; }
      if (d.length === S * P + 1) this.port.postMessage(d[S * P]);
    };
  }

  rand(s) {
    let t = (this.rng[s] = (this.rng[s] + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  spawn(s, kind, start, pitch, spread, amp) {
    const list = this.tables[kind];
    if (!list || !list.length) return;
    const base = s * MAXG;
    // a free slot, else steal the oldest grain
    let slot = -1, oldest = -1, age = Infinity;
    for (let g = 0; g < MAXG; g++) {
      const i = base + g;
      if (!this.gOn[i]) { slot = i; break; }
      if (this.gAge[i] < age) { age = this.gAge[i]; oldest = i; }
    }
    if (slot < 0) slot = oldest;
    const r = this.rand(s);
    this.gOn[slot] = 1;
    this.gTab[slot] = Math.floor(r * list.length) % list.length;
    this.gPos[slot] = 0;
    const p = pitch * (1 + spread * (2 * this.rand(s) - 1));
    this.gInc[slot] = p > 0.1 ? (p < 4 ? p : 4) : 0.1;
    const u = this.rand(s);
    this.gAmp[slot] = amp * (0.3 + 0.7 * u * u);
    this.gStart[slot] = start;
    this.gAge[slot] = this.serial++;
  }

  process(_inputs, outputs) {
    const S = this.S, P = this.P;
    for (let s = 0; s < S; s++) {
      const out = outputs[s] && outputs[s][0];
      if (!out) continue;
      const n = out.length;
      out.fill(0);
      const o = s * P, T = this.target, C = this.cur;
      const kind = (s / 2) | 0;
      // block-rate smoothing of the two gains (the main thread smooths too; this only removes zipper steps)
      const g0 = C[o + 1], b0 = C[o + 4];
      for (let j = 0; j < P; j++) C[o + j] = j === 1 || j === 4 ? C[o + j] + (T[o + j] - C[o + j]) * 0.5 : T[o + j];
      const g1 = C[o + 1] > 0 ? C[o + 1] : 0, b1 = C[o + 4] > 0 ? C[o + 4] : 0;
      const rate = C[o] > 0 ? (C[o] < 4000 ? C[o] : 4000) : 0;
      const pitch = C[o + 2] > 0.1 ? C[o + 2] : 0.1, spread = C[o + 3] > 0 ? (C[o + 3] < 0.9 ? C[o + 3] : 0.9) : 0;

      // ---- spawn ----
      if (g1 > 0.002 && rate > 0.5) {
        const norm = 1 / Math.sqrt(1 + rate * this.meanSec[kind]);
        let t = this.next[s];
        let guard = 0;
        while (t < n && guard++ < 256) {
          this.spawn(s, kind, t > 0 ? t | 0 : 0, pitch, spread, g1 * norm);
          t += -Math.log(1 - this.rand(s) * 0.9999) * sampleRate / rate;
        }
        this.next[s] = t - n;
      } else this.next[s] = this.rand(s) * 64;

      // ---- render grains ----
      const base = s * MAXG, list = this.tables[kind];
      let any = false;
      for (let g = 0; g < MAXG; g++) {
        const i = base + g;
        if (!this.gOn[i]) continue;
        any = true;
        const tab = list[this.gTab[i]];
        const len = tab.length - 1;
        let pos = this.gPos[i];
        const inc = this.gInc[i], amp = this.gAmp[i];
        for (let k = this.gStart[i]; k < n; k++) {
          const ip = pos | 0;
          if (ip >= len) { this.gOn[i] = 0; break; }
          const fr = pos - ip;
          out[k] += (tab[ip] + (tab[ip + 1] - tab[ip]) * fr) * amp;
          pos += inc;
        }
        this.gPos[i] = pos;
        this.gStart[i] = 0;
      }

      // ---- bed ----
      if (b0 > 0.0005 || b1 > 0.0005) {
        const f = C[o + 5] > 40 ? (C[o + 5] < 16000 ? C[o + 5] : 16000) : 40;
        const q = C[o + 6] > 0.3 ? C[o + 6] : 0.3;
        const gg = Math.tan(Math.PI * f / sampleRate), kk = 1 / q;
        const a1 = 1 / (1 + gg * (gg + kk)), a2 = gg * a1, a3 = gg * a2;
        let ic1 = this.ic1[s], ic2 = this.ic2[s], am = this.am[s];
        // kind texture: sand drifts slowly, water bubbles, marbles rattle, goo (X5) gloops in slow heavy surges
        const leak = kind === 0 ? 0.9996 : kind === 1 ? 0.998 : kind === 3 ? 0.9993 : 0.99;
        const step = kind === 0 ? 0.012 : kind === 1 ? 0.05 : kind === 3 ? 0.03 : 0.12;
        const depth = kind === 0 ? 1.2 : kind === 1 ? 2.2 : kind === 3 ? 2.8 : 2.5;
        const db = (b1 - b0) / n;
        let bg = b0;
        for (let k = 0; k < n; k++) {
          const x = 2 * this.rand(s) - 1;
          const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
          am = am * leak + (2 * this.rand(s) - 1) * step;
          let m = 1 + depth * am;
          if (m < 0) m = 0;
          out[k] += kk * v1 * bg * m * 2.4;
          bg += db;
        }
        if (!Number.isFinite(ic1) || !Number.isFinite(ic2)) { ic1 = 0; ic2 = 0; }
        this.ic1[s] = ic1; this.ic2[s] = ic2; this.am[s] = Number.isFinite(am) ? am : 0;
        any = true;
      }
      if (any) for (let k = 0; k < n; k++) if (!Number.isFinite(out[k])) out[k] = 0;
    }
    return true;
  }
}

registerProcessor('kn-matter', KnMatter);
