// Interleaved A/B: per frame, alternate "full look" and "full look minus one feature"; one frame in flight,
// each frame's GPU pass timestamps read back before the next (so every sample belongs to its config).
// A feature's cost = median over pairs of (total_full − total_without). Contention hits both halves alike.
window.__ab = async (feats, pairs = 120) => {
  const h = window.__hero, r = h.renderer, lp = r.lookPass, t = r.timer;
  lp.photoCoc = 0; lp.governor.enabled = false;
  const m = t.ms, orig = m.set.bind(m); let cur = {};
  m.set = (k, v) => { const old = m.get(k); cur[k] = old === undefined ? v : (v - 0.9 * old) / 0.1; return orig(k, v); };
  const frameTotal = async () => {
    cur = {};
    h.frame();
    await r.device.queue.onSubmittedWorkDone();
    for (let i = 0; i < 40 && t.readBufs.some((b) => b.busy); i++) await new Promise((res) => setTimeout(res, 1));
    const names = t.names ?? [];
    let s = 0; const per = {};
    for (const n of names) { const v = cur[n]; if (v !== undefined) { s += v; per[n] = v; } }
    return { s, per, ok: names.every((n) => cur[n] !== undefined) };
  };
  // trimmed mean (middle half): robust to contention spikes, and averages out the 65.5 µs timestamp quantization
  const med = (a) => { const s = [...a].sort((x, y) => x - y); const q = s.slice(Math.floor(s.length / 4), Math.ceil((s.length * 3) / 4)); return q.length ? q.reduce((x, y) => x + y, 0) / q.length : NaN; };
  const out = {};
  for (const [name, off] of feats) {
    const d = [], full = [], perB = {}, perA = {};
    for (let i = 0; i < pairs + 10; i++) {
      lp.force = {}; const b = await frameTotal();
      lp.force = off; const a = await frameTotal();
      if (i < 10 || !a.ok || !b.ok) continue;
      d.push(b.s - a.s); full.push(b.s);
      for (const [k, v] of Object.entries(b.per)) (perB[k] ??= []).push(v);
      for (const [k, v] of Object.entries(a.per)) (perA[k] ??= []).push(v);
    }
    const passes = {};
    for (const k of new Set([...Object.keys(perB), ...Object.keys(perA)])) { const x = (perB[k] ? med(perB[k]) : 0) - (perA[k] ? med(perA[k]) : 0); if (Math.abs(x) > 0.004) passes[k] = +x.toFixed(3); }
    out[name] = { cost: +med(d).toFixed(3), fullMedian: +med(full).toFixed(3), n: d.length, passes };
    window.__prog = name;
  }
  m.set = orig; lp.force = {};
  return out;
};
window.__feats = [
  ['practical spots (+ shadowed lamp)', { practicals: false }],
  ['texture sets', { texSets: false }], ['detail layer', { detail: false }], ['GTAO/SSAO', { ao: false }], ['SS contact', { contact: false }],
  ['SDF contact (G3 SDF)', { sdfShadow: false }], ['probe GI (G3 pass + shading)', { gi: false }], ['set IBL', { ibl: false }], ['set shadow (far cascade)', { setShadow: false }],
  ['froxel fog + shafts', { shafts: false }], ['tilt-shift DOF', { dof: false }], ['LUT + vignette + grain', { lut: false, vignette: false }],
  ['whole look', { practicals: false, texSets: false, detail: false, ao: false, contact: false, sdfShadow: false, gi: false, ibl: false, setShadow: false, shafts: false, fog: false, dof: false, lut: false, vignette: false }],
];
'ok'
