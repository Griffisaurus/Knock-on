// Beta polish (stream AUDIO, D127): offline checks for the five gaps F5 recorded (M5_NOTES_F5.md "Deviations"):
// GRAV WELL repel, FORCE WALL hum by area, the Hangar zero-g ring drones following env.zones, RIFT GATE hums locked
// to their partner, and Matter audio in clips on the frame clock. Run from the audio test page:
// `await __audioOffline('beta')`. Each check measures levels / correlation / onsets in the rendered PCM.

/// <reference types="@webgpu/types" />

import type { GameAudio } from './index';
import { ClipAudio } from './clip';
import { VEL_SCALE } from './matterprobe';
import { UNITS_PER_METRE } from '@knockon/matter';
import type { OfflineKit } from './testm5';
import * as partsData from '@knockon/parts-data';

type Vec = [number, number, number];
const F = { lit: 1, powered: 2, pressed: 4, armed: 16, fault: 64 };
const SR = 48000;
const PD = partsData as unknown as Record<string, readonly string[] | undefined>;
const idx = (table: string) => (n: string): number => Math.max(0, (PD[table] ?? []).indexOf(n));
const clipN = idx('CRITTER_CLIPS'), emoteN = idx('CRITTER_EMOTES'), fsmN = idx('CRITTER_FSM');
const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -200);

/** The beta hooks (setPartProps, zones) through a loose type, so the checks also run against an older director. */
type BetaAudio = GameAudio & {
  setPartProps?: (parts: readonly { id: number; type: string; props: Readonly<Record<string, number>> }[]) => void;
};
const props = (g: GameAudio, parts: { id: number; type: string; props: Record<string, number> }[]): void => { (g as BetaAudio).setPartProps?.(parts); };
const zones = (g: GameAudio, env: string, preset: string, on: boolean): void => {
  (g.setEnvironment as (e: string, p: string, air?: number, zones?: boolean) => void).call(g, env, preset, 100, on);
};

/** RMS (dB) of both channels over [a, b) s. */
function rms(buf: AudioBuffer, a: number, b: number): number {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let s = 0, n = 0;
  for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(L.length, Math.round(b * SR)); i++) { s += L[i]! * L[i]! + R[i]! * R[i]!; n += 2; }
  return db(Math.sqrt(s / Math.max(1, n)));
}
/** Share of the energy above `fc` Hz over [a, b) s (one-pole high-pass, left channel): a brightness measure. */
function above(buf: AudioBuffer, a: number, b: number, fc: number): number {
  const x = buf.getChannelData(0);
  const k = Math.exp(-2 * Math.PI * fc / SR);
  let lp = 0, eAll = 0, eHi = 0;
  for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(x.length, Math.round(b * SR)); i++) { lp = lp * k + x[i]! * (1 - k); const h = x[i]! - lp; eAll += x[i]! * x[i]!; eHi += h * h; }
  return eAll > 0 ? eHi / eAll : 0;
}
/** Level (dB) of a steady tone at `f` Hz over [a, b) s, left channel (Goertzel). */
function tone(buf: AudioBuffer, a: number, b: number, f: number): number {
  const x = buf.getChannelData(0);
  const i0 = Math.max(0, Math.round(a * SR)), i1 = Math.min(x.length, Math.round(b * SR)), n = i1 - i0;
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = i0; i < i1; i++) { const s0 = x[i]! + c * s1 - s2; s2 = s1; s1 = s0; }
  return db((2 / Math.max(1, n)) * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)));
}
/** Mean pitch slope of the hum's fundamental over [a, b): +1 when the period shortens through each half-second wobble. */
function wobbleDir(buf: AudioBuffer, a: number, b: number): number {
  // zero crossings of a 120 Hz low-passed copy give the instantaneous period; correlate its change with time inside
  // each 0.5 s wobble (attract dips down then back, repel bumps up then back: the first half's slope gives the sign)
  const x = buf.getChannelData(0);
  const k = Math.exp(-2 * Math.PI * 120 / SR);
  let l1 = 0, l2 = 0, prev = 0, last = -1;
  const pts: [number, number][] = [];
  for (let i = Math.round(a * SR); i < Math.min(x.length, Math.round(b * SR)); i++) {
    l1 = l1 * k + x[i]! * (1 - k); l2 = l2 * k + l1 * (1 - k);
    if (prev <= 0 && l2 > 0) { if (last >= 0) pts.push([i / SR, SR / (i - last)]); last = i; }
    prev = l2;
  }
  if (pts.length < 8) return 0;
  const mean = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  // deviation from the mean at the middle of each wobble (phase 0.25 of 0.5 s) vs at its ends
  let mid = 0, nm = 0, ends = 0, ne = 0;
  for (const [t, f] of pts) { const ph = ((t * 2) % 1 + 1) % 1; if (Math.abs(ph - 0.5) < 0.15) { mid += f - mean; nm++; } else if (ph < 0.1 || ph > 0.9) { ends += f - mean; ne++; } }
  return (nm ? mid / nm : 0) - (ne ? ends / ne : 0);
}

export async function offlineBeta(k: OfflineKit): Promise<void> {
  const { render, add } = k;
  const want = (n: string): boolean => !k.filter() || n.toLowerCase().includes(k.filter().toLowerCase());

  // ---- 1. GRAV WELL repel: its own sound, picked from the part's Mode prop (attract 0.3–3.3 s, repel 3.5–6.5 s) ----
  let gw = { aHi: 0, rHi: 0, aRms: 0, rRms: 0, aDir: 0, rDir: 0 };
  add(await render('beta GRAV WELL repel (Mode prop): brighter, rising hum', 7, (g, t, i) => {
    if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); props(g, [{ id: 142, type: 'grav_well', props: { mode: 0 } }, { id: 242, type: 'grav_well', props: { mode: 1 } }]); }
    g.setPlayback(false, 1, t * 120);
    if (t > 0.3 && t < 3.3) g.part(142, 'grav_well', [0, 0, 0.5], F.powered | F.lit, 0, null, null, null);
    if (t > 3.5 && t < 6.5) g.part(242, 'grav_well', [0, 0, 0.5], F.powered | F.lit, 0, null, null, null);
  }, {
    silentOk: [[0, 7]],
    check: (_g, buf) => {
      gw = { aHi: above(buf, 1.2, 3.2, 300), rHi: above(buf, 4.4, 6.4, 300), aRms: rms(buf, 1.2, 3.2), rRms: rms(buf, 4.4, 6.4), aDir: wobbleDir(buf, 1.2, 3.2), rDir: wobbleDir(buf, 4.4, 6.4) };
      const ok = gw.rHi > gw.aHi * 1.5 && gw.aRms > -40 && gw.rRms > -40 && Math.abs(gw.aRms - gw.rRms) < 6;
      const s = `energy > 300 Hz: attract ${(100 * gw.aHi).toFixed(1)} %, repel ${(100 * gw.rHi).toFixed(1)} %; RMS attract ${gw.aRms.toFixed(1)} dB, repel ${gw.rRms.toFixed(1)} dB; wobble (Hz, mid − ends) attract ${gw.aDir.toFixed(2)}, repel ${gw.rDir.toFixed(2)}`;
      return ok ? s : `!${s}`;
    },
  }));

  // ---- 2. FORCE WALL hum by area: 0.1 × 0.1, 0.6 × 0.4 (the default) and 1 × 1 m, each 2 s, at 1.5 m and at 6 m ----
  const walls: [number, number][] = [[0.1, 0.1], [0.6, 0.4], [1, 1]];
  for (const d of [1.5, 6]) {
    const lv: number[] = [];
    add(await render(`beta FORCE WALL hum scales with its area (at ${d} m)`, 7, (g, t, i) => {
      if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); props(g, walls.map(([w, h], j) => ({ id: 300 + j, type: 'force_wall', props: { width: w, height: h, start: 1 } }))); }
      g.setPlayback(false, 1, t * 120);
      const j = Math.floor((t - 0.2) / 2.2);
      if (t > 0.2 && j < walls.length && ((t - 0.2) % 2.2) < 2) g.part(300 + j, 'force_wall', [0, 1.2 - 0.3, 3 - d], F.lit, 0, null, null, null);
    }, {
      silentOk: [[0, 7]], minPeakDb: -60,
      check: (_g, buf) => {
        for (let j = 0; j < walls.length; j++) lv.push(rms(buf, 0.2 + j * 2.2 + 0.8, 0.2 + j * 2.2 + 2));
        const ok = lv[0]! < lv[1]! - 3 && lv[1]! < lv[2]! - 2 && lv[2]! - lv[0]! >= 8;
        const s = `hum RMS ${walls.map(([w, h], j) => `${w}×${h} m ${lv[j]!.toFixed(1)} dB`).join(', ')} (span ${(lv[2]! - lv[0]!).toFixed(1)} dB)`;
        return ok ? s : `!${s}`;
      },
    }));
  }

  // ---- 3. Hangar zero-g rings follow env.zones: on 0–4 s, off 4–8 s, on 8–12 s (listener 1.5 m from a Bay 2 ring; the
  //         drone's steady 105.5 Hz fifth is measured, the room bed covers the rest) ----
  {
    let r = { on1: 0, off: 0, on2: 0, amb1: 0, amb2: 0, amb3: 0, room1: 0, room2: 0 };
    add(await render('beta Hangar zero-g ring drones follow env.zones (on → off → on)', 12, (g, t, i) => {
      if (i === 1) { g.setVolumes({ music: 0 }); }
      zones(g, 'hangar', 'warehouse', !(t >= 4 && t < 8));
      const amb = (g.stats as unknown as { ambience: number }).ambience;
      if (Math.abs(t - 3.5) < 0.01) r.amb1 = amb; if (Math.abs(t - 7.5) < 0.01) r.amb2 = amb; if (Math.abs(t - 11.5) < 0.01) r.amb3 = amb;
    }, {
      env: 'hangar', preset: 'warehouse', listener: { pos: [-18, 1.2, -12.9], forward: [0, -0.5, -1] }, silentOk: [[0, 12]], minPeakDb: -70,
      check: (_g, buf) => {
        r = { ...r, on1: tone(buf, 2, 4, 105.5), off: tone(buf, 6, 8, 105.5), on2: tone(buf, 10, 12, 105.5), room1: rms(buf, 2, 4), room2: rms(buf, 6, 8) };
        const ok = r.off < r.on1 - 10 && r.on2 > r.off + 10 && r.amb2 < r.amb1 && r.amb3 === r.amb1;
        const s = `ring drone (105.5 Hz) zones on ${r.on1.toFixed(1)} dB → off ${r.off.toFixed(1)} dB → on ${r.on2.toFixed(1)} dB; room RMS ${r.room1.toFixed(1)} → ${r.room2.toFixed(1)} dB; ambience voices ${r.amb1} → ${r.amb2} → ${r.amb3}`;
        return ok ? s : `!${s}`;
      },
    }));
  }

  // ---- 4. RIFT GATES: a pair's hums share one LFO phase (gates hard left and right of the listener) ----
  {
    let m = { c0: 0, lag: 0, res: 0 };
    add(await render('beta RIFT GATE hums phase-locked across a pair', 7, (g, t, i) => {
      if (i === 1) { g.setVolumes({ music: 0 }); g.setMode('running'); props(g, [{ id: 140, type: 'rift_gate', props: { pair: 0 } }, { id: 141, type: 'rift_gate', props: { pair: 0 } }]); }
      g.setPlayback(false, 1, t * 120);
      if (t > 0.2) {
        g.part(140, 'rift_gate', [-4, 1.2 - 0.205, 3], F.lit, 0, null, null, null);
        // the second gate comes into range 1.3 s later: it must still join its partner's phase
        if (t > 1.5) g.part(141, 'rift_gate', [4, 1.2 - 0.205, 3], F.lit, 0, null, null, null);
      }
    }, {
      env: 'off', listener: { pos: [0, 1.2, 3], forward: [0, 0, -1] }, silentOk: [[0, 7]],
      check: (_g, buf) => {
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        const a = Math.round(3 * SR), b = Math.round(6 * SR);
        let lr = 0, ll = 0, rr = 0, dd = 0;
        for (let i = a; i < b; i++) { lr += L[i]! * R[i]!; ll += L[i]! * L[i]!; rr += R[i]! * R[i]!; dd += (L[i]! - R[i]!) ** 2; }
        // best lag on an 8× decimated copy, ±2 s (half the 4 s loop)
        const D = 8, dec = (x: Float32Array): Float32Array => { const y = new Float32Array(Math.floor(x.length / D)); for (let i = 0; i < y.length; i++) { let s = 0; for (let j = 0; j < D; j++) s += x[i * D + j]!; y[i] = s / D; } return y; };
        const l = dec(L), r2 = dec(R), from = Math.round(3 * SR / D), n = Math.round(1.5 * SR / D), maxLag = Math.round(2 * SR / D);
        let best = -Infinity, lag = 0;
        for (let q = -maxLag; q <= maxLag; q++) { let s = 0; for (let i = from; i < from + n; i++) s += l[i]! * (r2[i + q] ?? 0); if (s > best) { best = s; lag = q; } }
        m = { c0: lr / Math.sqrt(ll * rr || 1), lag: (lag * D) / SR * 1000, res: db(Math.sqrt(dd / Math.max(1e-30, ll))) };
        const ok = m.c0 > 0.9 && Math.abs(m.lag) < 1;
        const s = `L·R correlation at lag 0 ${m.c0.toFixed(3)}, best lag ${m.lag.toFixed(2)} ms, L − R residual ${m.res.toFixed(1)} dB re L (the stereo reverb tail sets its floor)`;
        return ok ? s : `!${s}`;
      },
    }));
  }

  // ---- 5. stress: the new cues at once (big walls, repel wells, rift pairs, the Hangar with zones), voices and ceiling ----
  {
    let maxV = 0;
    add(await render('beta stress (8 big walls, 4 repel wells, 4 rift pairs, Hangar zones on)', 6, (g, t, i) => {
      if (i === 1) {
        g.setMode('running'); zones(g, 'hangar', 'warehouse', true);
        props(g, [
          ...Array.from({ length: 8 }, (_, j) => ({ id: 400 + j, type: 'force_wall', props: { width: 1, height: 1, start: 1 } })),
          ...Array.from({ length: 4 }, (_, j) => ({ id: 420 + j, type: 'grav_well', props: { mode: 1 } })),
          ...Array.from({ length: 8 }, (_, j) => ({ id: 440 + j, type: 'rift_gate', props: { pair: j >> 1 } })),
        ]);
      }
      g.setPlayback(false, 1, t * 120);
      for (let j = 0; j < 8; j++) g.part(400 + j, 'force_wall', [j * 0.5 - 2, 0, 0], F.lit, 0, null, null, null);
      for (let j = 0; j < 4; j++) g.part(420 + j, 'grav_well', [j - 1.5, 0, -1], F.powered | F.lit, 0, null, null, null);
      for (let j = 0; j < 8; j++) g.part(440 + j, 'rift_gate', [j * 0.6 - 2.1, 0, 1], F.lit, 0, null, null, null);
      if (t > 1 && t < 4 && i % 6 === 0) g.onSimEvents([k.ev(t, 'Detonate', 2000 + i, [Math.sin(i) * 3, 0.1, -3], 3), k.ev(t, 'Teleport', 440, [0, 0.2, 1], 4, 152), k.ev(t, 'Emerge', 441, [0, 0.2, 1], 4, 152), k.ev(t, 'Impact', 400, [0, 0.2, 0], 3, 153)], k.partType);
      const s = g.stats as unknown as { voices: number; loops: number; ambience: number; matter: number };
      maxV = Math.max(maxV, s.voices + s.loops + s.ambience + s.matter);
    }, { env: 'hangar', preset: 'warehouse', check: () => (maxV > 64 ? `!voices peaked at ${maxV} > 64` : `peak voices ${maxV}/64`) }));
  }

  // ---- 6. BUZZ startled (PARTSIM D121: 'startled' for 0.6 s, '!' emote) while flying at 1.5 s and parked at 4 s: the short
  //         yelp + rotor surge, not the alarm whoop ----
  {
    const played: [number, string][] = [];
    add(await render('beta BUZZ startle: short yelp + rotor surge (flying, parked)', 6, (g, t, i) => {
      if (i === 1) {
        g.setVolumes({ music: 0 }); g.setMode('running');
        const o = g as unknown as { play: (name: string, ...a: unknown[]) => unknown };
        const orig = o.play.bind(g);
        const ctxOf = g as unknown as { ctx: BaseAudioContext };
        o.play = (name: string, ...a: unknown[]) => { played.push([ctxOf.ctx.currentTime, name]); return orig(name, ...a); };
        g.setCritterNames(PD.CRITTER_CLIPS as never, PD.CRITTER_EMOTES as never); // BUZZ's clip / emote names (B5's tables)
      }
      g.setPlayback(false, 1, t * 120);
      const fly = t < 3, st = (t >= 1.5 && t < 2.1) || (t >= 4 && t < 4.6);
      const pos: Vec = [0.3, fly ? 0.8 : 0, 0.3];
      g.part(151, 'buzz', pos, 0, 0, null, st ? [clipN('startled'), 16, emoteN('!'), fsmN('startled')] : fly ? [clipN('walk'), 16, 0, fsmN('fly')] : [clipN('idle'), 0, 0, fsmN('landed')]);
    }, {
      silentOk: [[0, 6]],
      check: () => {
        const inWin = (a: number, b: number) => played.filter(([t]) => t >= a && t < b).map(([, n]) => n);
        const w1 = inWin(1.5, 2.2), w2 = inWin(4, 4.7);
        const ok = w1.includes('buzz/startle') && w2.includes('buzz/startle') && !w1.includes('buzz/whoop') && !w2.includes('buzz/whoop');
        const s = `cues at the flying startle: ${w1.join(', ') || 'none'}; at the parked startle: ${w2.join(', ') || 'none'}`;
        return ok ? s : `!${s}`;
      },
    }));
  }

  // ---- 7. Matter in clips: the field is measured and applied on the frame it belongs to ----
  if (want('beta clip')) await matterClip(k);
}

/**
 * A synthetic Matter field on the GPU (4,096 sand grains 1 m in front of the listener, at rest, set moving at 1.5 m/s
 * on frame 60) recorded into a clip the way capture/offline.ts records one. The onset of the grains in the clip must
 * land on frame 60 (within a frame), and two renders, one with random wall-clock stalls, must agree.
 */
async function matterClip(k: OfflineKit): Promise<void> {
  const name = 'beta clip: Matter audio on the frame clock (onset, stalls)';
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const adapter = gpu ? await gpu.requestAdapter() : null;
  if (!adapter) { k.result(name, false, 'no WebGPU adapter'); return; }
  const device = await adapter.requestDevice();
  const N = 4096, U = UNITS_PER_METRE;
  const pos = new Int32Array(N * 3), still = new Int32Array(N * 3), moving = new Int32Array(N * 3);
  let seed = 12345;
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    pos[3 * i] = Math.round((rnd() - 0.5) * 0.5 * U); pos[3 * i + 1] = Math.round((1.0 + rnd() * 0.3) * U); pos[3 * i + 2] = Math.round((2 + (rnd() - 0.5) * 0.5) * U);
    moving[3 * i + 1] = Math.round(-1.5 / VEL_SCALE);
  }
  const mk = (data: Int32Array): GPUBuffer => { const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  const pb = mk(pos), vb = mk(still);
  const view = { device, pos: pb, vel: vb, mat: null, count: N };
  const fps = 60, frames = 150, k0 = 60;
  const sync: string[] = [];
  const run = async (stall: boolean, impact = false): Promise<{ pcm: Float32Array[] | null; onset: number; ms: number }> => {
    device.queue.writeBuffer(vb, 0, still);
    const live = k.make();
    live.setVolumes({ music: 0 });
    live.setEnvironment('off', 'room');
    live.setMatterView(() => view);
    const c = live.clip();
    if (!(await c.begin(fps, frames / fps * 2 + 2))) throw new Error(c.note);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      await c.at(i);
      if (i === k0 && !impact) device.queue.writeBuffer(vb, 0, moving);
      if (i === k0 && impact) live.onSimEvents([k.ev(i / fps, 'Impact', 3, [0, 1.1, 2], 4)], k.partType); // the reference: an event on frame k0
      if (i === 0) { live.setMode('running'); live.setListener({ pos: [0, 1.2, 3], forward: [0, -0.3, -1], up: [0, 1, 0] }); }
      live.setPlayback(false, 1, (i / fps) * 120);
      live.frame(1 / fps);
      c.advance(i);
      await device.queue.onSubmittedWorkDone();
      if (stall && i % 3 === 0) await new Promise((r) => setTimeout(r, 1 + (i % 7) * 4));
    }
    ClipAudio.keepPcm = true;
    await c.finish(0, frames / fps);
    ClipAudio.keepPcm = false;
    const pcm = ClipAudio.lastPcm;
    sync.push(`${ClipAudio.last?.probes ?? 0} probes, ${ClipAudio.last?.matterAcks ?? 0} worklet acks, ${ClipAudio.last?.matterAckTimeouts ?? 0} timeouts`);
    live.dispose();
    let onset = -1;
    if (pcm) { const x = pcm[0]!, y = pcm[1]!; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > 1e-5 || Math.abs(y[i]!) > 1e-5) { onset = i; break; } }
    return { pcm, onset, ms: performance.now() - t0 };
  };
  try {
    const a = await run(false), b = await run(true), c = await run(true), ref = await run(false, true);
    const lagF = (o: number): number => (o < 0 ? NaN : (o / SR - k0 / fps) * fps);
    let maxDiff = 0;
    if (a.pcm && b.pcm) for (let ch = 0; ch < 2; ch++) for (let i = 0; i < a.pcm[ch]!.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.pcm[ch]![i]! - (b.pcm[ch]![i] ?? 0)));
    let peak = 0; if (a.pcm) for (const x of a.pcm) for (const v of x) peak = Math.max(peak, Math.abs(v));
    const lags = [a, b, c].map((r) => lagF(r.onset));
    const refLag = lagF(ref.onset);
    const ok = lags.every((l) => l >= -0.05 && l <= 1 && Math.abs(l - refLag) <= 0.1) && maxDiff < 1e-6 && peak > 1e-3;
    k.result(name, ok, `onset lag vs frame ${k0}: ${lags.map((l) => l.toFixed(2)).join(' / ')} frames (no stalls / stalls / stalls); an Impact event on the same frame ${refLag.toFixed(2)} frames (the master chain's lookahead: glue + limiter); max difference between renders ${maxDiff ? db(maxDiff).toFixed(0) + ' dB' : 'none'}; peak ${db(peak).toFixed(1)} dBFS; ${a.ms.toFixed(0)} / ${b.ms.toFixed(0)} / ${c.ms.toFixed(0)} ms for ${frames} frames; ${sync[0] ?? ''}`);
  } catch (e) {
    k.result(name, false, String(e));
  } finally {
    pb.destroy(); vb.destroy(); device.destroy();
  }
}
