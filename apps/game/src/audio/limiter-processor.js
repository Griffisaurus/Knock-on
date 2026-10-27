// AudioWorklet processor for the M3 master limiter (limiter.ts). A real file served same-origin, so the host's
// CSP (script-src 'self') allows it: a Blob URL is blocked there.

const TAPS = 16, HALF = 8;
class KnLimiter extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const p = (opts && opts.processorOptions) || {};
    this.ceil = Math.pow(10, (p.ceilingDb ?? -1) / 20);
    this.L = Math.max(16, Math.round((p.lookahead ?? 0.005) * sampleRate));
    this.D = this.L - 1 + HALF;              // audio delay (samples)
    this.fastK = 1 - Math.exp(-1 / (0.07 * sampleRate));
    this.slowK = 1 - Math.exp(-1 / (0.5 * sampleRate));
    this.workK = 1 - Math.exp(-1 / (1.0 * sampleRate));
    // 4x interpolator: phases 1..3 (phase 0 is the sample itself), windowed sinc centred HALF samples back
    this.coef = [];
    for (let k = 1; k < 4; k++) {
      const c = new Float32Array(TAPS);
      let s = 0;
      for (let i = 0; i < TAPS; i++) {
        const u = k / 4 - (i - (HALF - 1));
        const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
        const w = Math.abs(u) < HALF + 0.5 ? 0.5 + 0.5 * Math.cos(Math.PI * u / (HALF + 0.5)) : 0;
        c[i] = sinc * w; s += c[i];
      }
      for (let i = 0; i < TAPS; i++) c[i] /= s;
      this.coef.push(c);
    }
    this.hist = [new Float32Array(TAPS * 2), new Float32Array(TAPS * 2)]; // doubled ring: contiguous window
    this.hpos = 0;
    const N = this.D + 2;
    this.dl = [new Float32Array(N), new Float32Array(N)];
    this.dpos = 0; this.dN = N;
    // sliding-minimum deque over the last L required gains
    this.qv = new Float64Array(this.L + 1); this.qi = new Float64Array(this.L + 1);
    this.qh = 0; this.qt = 0; this.n = 0;
    // box average ring
    this.box = new Float64Array(this.L); this.bpos = 0; this.bsum = this.L; this.box.fill(1);
    this.r = 1; this.work = 0;
    this.stat = { gr: 1, tpIn: 0, tpOut: 0, cnt: 0 };
    this.statEvery = Math.round(sampleRate * 0.1);
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length;
    const iL = inp && inp[0] ? inp[0] : null, iR = inp && inp[1] ? inp[1] : iL;
    const oL = out[0], oR = out[1] || null;
    const hL = this.hist[0], hR = this.hist[1], c1 = this.coef[0], c2 = this.coef[1], c3 = this.coef[2];
    const L = this.L, ceil = this.ceil, st = this.stat;
    for (let i = 0; i < n; i++) {
      let xl = iL ? iL[i] : 0, xr = iR ? iR[i] : 0;
      if (!(xl === xl) || xl > 1e4 || xl < -1e4) xl = 0;   // NaN / runaway guard
      if (!(xr === xr) || xr > 1e4 || xr < -1e4) xr = 0;
      // ---- detector: true peak around the sample HALF back ----
      const hp = this.hpos;
      hL[hp] = hL[hp + TAPS] = xl; hR[hp] = hR[hp + TAPS] = xr;
      this.hpos = (hp + 1) % TAPS;
      const b = this.hpos; // window hist[b .. b+TAPS-1] = oldest .. newest
      let pk = Math.max(Math.abs(hL[b + HALF - 1]), Math.abs(hR[b + HALF - 1]));
      let a1 = 0, a2 = 0, a3 = 0, b1 = 0, b2 = 0, b3 = 0;
      for (let j = 0; j < TAPS; j++) {
        const l = hL[b + j], r = hR[b + j];
        a1 += c1[j] * l; a2 += c2[j] * l; a3 += c3[j] * l;
        b1 += c1[j] * r; b2 += c2[j] * r; b3 += c3[j] * r;
      }
      pk = Math.max(pk, Math.abs(a1), Math.abs(a2), Math.abs(a3), Math.abs(b1), Math.abs(b2), Math.abs(b3));
      if (pk > st.tpIn) st.tpIn = pk;
      const g = pk > ceil ? ceil / pk : 1;
      // ---- sliding minimum over the last L ----
      const idx = this.n++;
      while (this.qt > this.qh && this.qv[(this.qt - 1) % (L + 1)] >= g) this.qt--;
      this.qv[this.qt % (L + 1)] = g; this.qi[this.qt % (L + 1)] = idx; this.qt++;
      while (this.qi[this.qh % (L + 1)] <= idx - L) this.qh++;
      const m = this.qv[this.qh % (L + 1)];
      // ---- program-dependent release (never above m, so the guarantee holds) ----
      this.work += ((1 - m) - this.work) * this.workK;
      if (m <= this.r) this.r = m;
      else {
        const k = this.fastK + (this.slowK - this.fastK) * Math.min(1, this.work * 8);
        this.r += (m - this.r) * k;
      }
      // ---- box average over L ----
      this.bsum += this.r - this.box[this.bpos];
      this.box[this.bpos] = this.r;
      this.bpos = (this.bpos + 1) % L;
      if (this.bpos === 0) { let s = 0; for (let q = 0; q < L; q++) s += this.box[q]; this.bsum = s; }
      const gs = Math.min(1, this.bsum / L);
      // ---- delayed audio ----
      const dp = this.dpos, rp = (dp + this.dN - this.D) % this.dN;
      this.dl[0][dp] = xl; this.dl[1][dp] = xr;
      this.dpos = (dp + 1) % this.dN;
      let yl = this.dl[0][rp] * gs, yr = this.dl[1][rp] * gs;
      // belt and braces: nothing leaves above the ceiling, even if the detector missed something
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      oL[i] = yl; if (oR) oR[i] = yr;
      if (gs < st.gr) st.gr = gs;
      const ao = Math.max(Math.abs(yl), Math.abs(yr));
      if (ao > st.tpOut) st.tpOut = ao;
      if (++st.cnt >= this.statEvery) {
        this.port.postMessage({ gr: -20 * Math.log10(Math.max(st.gr, 1e-6)), tpIn: st.tpIn, tpOut: st.tpOut });
        st.gr = 1; st.tpIn = 0; st.tpOut = 0; st.cnt = 0;
      }
    }
    return true;
  }
}
registerProcessor('kn-limiter', KnLimiter);
