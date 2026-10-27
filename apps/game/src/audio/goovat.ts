// GOO VAT's part sounds (stream X5, M5; docs/art/briefs/matter.md "Audio hooks"), registered through F5's `M5_EXTRA`
// hook in m5.ts (docs/dev/M5_NOTES_F5.md "GOO VAT hook"). The goo grains themselves (squelches, a low gloop bed) are
// the 4th kind of matter.ts's granular streams; these are the vat's own cues, driven by A4's dispenser (GOO VAT runs it,
// channels/m4_matter.ts): `Valve` and `Empty` events, the `lit` flag while it pours and the fill meter (1–21).
//
//   valve_clunk   a rubbery thunk on every Valve (open: a little higher)
//   goo_pour      a loop while pouring: a slow train of squelches and a thick low stream, louder with the flow
//   bubble_blorp  an idle loop: big slow bubbles rising through the slime, quieter as it empties
//   stirrer_hum   a small motor hum, faster and louder while it pours (the stirrer speeds up)
//   drip_snap     the last drip string snapping when it runs empty
//   refill_gloop  a gloop when goo lands in the lid hatch (the meter rises)

import type { Recipe } from './bank';
import { M5_EXTRA, type M5Extra } from './m5';
import { F } from './mech';
import { type Rng } from './rng';
import { SR, alloc, bp, bubble, chirp, envAD, fadeEdges, grains, lp, mixInto, normalize, seamless, white } from './synth';
import { clamp, fin, type Vec3 } from './types';

const at = (s: number): number => Math.round(s * SR);
const TAU = Math.PI * 2;

function squelch(rng: Rng, low = 1): Float32Array {
  const dur = 0.05 + 0.06 * rng.next();
  const f0 = (260 + 220 * rng.next()) * low, f1 = (80 + 50 * rng.next()) * low;
  const x = chirp(at(dur), (t) => f1 + (f0 - f1) * Math.exp(-t / (dur * 0.35)), (t) => Math.exp(-t / (dur * 0.45)) * (1 - Math.exp(-t / 0.003)));
  mixInto(x, normalize(lp(envAD(white(at(dur), rng), 0.0008, 0.01), 700), 0.4));
  return fadeEdges(normalize(x, 0.5), 0.0005, 0.01);
}

function valveClunk(rng: Rng): Float32Array {
  const x = alloc(0.25);
  const f = 140 + 60 * rng.next();
  mixInto(x, chirp(at(0.18), (t) => f * (1 - 0.3 * t / 0.18), (t) => Math.exp(-t / 0.035) * (1 - Math.exp(-t / 0.001))));
  mixInto(x, normalize(bp(envAD(white(at(0.06), rng), 0.0005, 0.008), 1800, 1.4), 0.25)); // the lever's click
  mixInto(x, squelch(rng, 0.8), at(0.03), 0.35); // goo in the valve
  return fadeEdges(normalize(x, 0.45));
}

function dripSnap(rng: Rng): Float32Array {
  const x = alloc(0.3);
  const f = 900 + 700 * rng.next();
  mixInto(x, chirp(at(0.04), (t) => f * (1 + 2 * t / 0.04), (t) => Math.exp(-t / 0.01)), 0, 0.5); // the strand snapping back
  mixInto(x, squelch(rng, 1.3), at(0.12 + 0.05 * rng.next()), 0.7); // the drop landing
  return fadeEdges(normalize(x, 0.4));
}

function refillGloop(rng: Rng): Float32Array {
  const x = alloc(0.5);
  mixInto(x, squelch(rng, 0.7));
  mixInto(x, bubble(0.3, 110 + 60 * rng.next(), 0.4, 0.07), at(0.05), 0.6);
  return fadeEdges(normalize(x, 0.42), 0.002, 0.05);
}

function pourLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = normalize(lp(bp(white(len, rng), 260, 0.6), 600), 0.35); // the thick stream
    let am = 0;
    for (let i = 0; i < len; i++) { am = am * 0.9993 + rng.bi() * 0.03; x[i] = x[i]! * (1 + 2.2 * am); }
    grains(x, rng, () => 14, (r) => normalize(squelch(r), 0.25 + 0.35 * r.next()));
    return x;
  }), 0.35);
}

function blorpLoop(rng: Rng): Float32Array {
  return normalize(seamless(4, 0.3, (len) => {
    const x = new Float32Array(len);
    grains(x, rng, () => 1.6, (r) => normalize(bubble(0.25, 70 + 70 * r.next(), 0.6, 0.06), 0.3 + 0.5 * r.next()));
    mixInto(x, normalize(lp(white(len, rng), 120), 0.05));
    return x;
  }), 0.25);
}

function stirLoop(rng: Rng): Float32Array {
  return normalize(seamless(2, 0.2, (len) => {
    const x = new Float32Array(len);
    const f = 118;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      x[i] = 0.5 * Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t) + 0.08 * Math.sin(TAU * 3.02 * f * t);
    }
    mixInto(x, normalize(bp(white(len, rng), 2400, 2), 0.04)); // brushes
    return x;
  }), 0.2);
}

interface VatState { meter: number; refillAt: number }

/** GOO VAT's entry in F5's M5_EXTRA registry (imported once by index.ts, which builds the bank after it). */
export function gooVatAudio(): M5Extra {
  const state = new Map<number, VatState>();
  return {
    types: new Set(['goo_vat']),
    recipes: (): Recipe[] => [
      ['goovat/valve', 3, valveClunk], ['goovat/drip', 4, dripSnap], ['goovat/refill', 3, refillGloop],
      ['loop/goovat/pour', 1, pourLoop], ['loop/goovat/blorp', 1, blorpLoop], ['loop/goovat/stir', 1, stirLoop],
    ],
    event(h, e, _t, when, var01) {
      if (e.kind === 'Valve') {
        h.play('goovat/valve', var01, { family: 'mech', pos: [e.pos[0], e.pos[1], e.pos[2]], when, gain: 0.5, rate: fin(e.mag, 0) > 0 ? 1.06 : 0.92 });
        return true;
      }
      if (e.kind === 'Empty') {
        h.play('goovat/drip', var01, { family: 'mech', pos: [e.pos[0], e.pos[1], e.pos[2]], when, gain: 0.4 });
        return true;
      }
      return false;
    },
    part(h, id, _t, pos, flags, meter, _dt, _edges) {
      const now = h.now();
      const m = clamp(fin(meter, 0), 0, 255);
      const fill = m > 0 ? clamp((m - 1) / 20, 0, 1) : 0;
      const pouring = (flags & F.lit) !== 0;
      let s = state.get(id);
      if (!s) { s = { meter: m, refillAt: -10 }; state.set(id, s); }
      // refill: the meter rose (goo dropped into the lid hatch)
      if (m > s.meter && now - s.refillAt > 0.4) { h.play('goovat/refill', (id * 0.618) % 1, { family: 'mech', pos: [pos[0], pos[1] + 0.29, pos[2] - 0.06], when: now, gain: 0.4 }); s.refillAt = now; }
      s.meter = m;
      const top: Vec3 = [pos[0], pos[1] + 0.06 + 0.19 * fill, pos[2]];
      if (fill > 0.02) h.loop(`goovat:${id}:blorp`, 'matter', top, 0.14 + 0.12 * fill, { variant: 'goovat/blorp' });
      h.loop(`goovat:${id}:stir`, 'matter', [pos[0], pos[1] + 0.295, pos[2]], pouring ? 0.16 : 0.06, { variant: 'goovat/stir', aux: pouring ? 1.25 : 0.8 });
      if (pouring) h.loop(`goovat:${id}:pour`, 'matter', [pos[0], pos[1] + 0.07, pos[2] + 0.17], 0.42, { variant: 'goovat/pour' });
    },
  };
}

M5_EXTRA.push(gooVatAudio());
