// M3 fun parts (stream A3): PANE / VASE (breakables through the generated-fracture path: fracOf + Machine.shatter),
// TONEBARS and DING (music: `Note` events in scale degrees, plus Sounds critters hear) and PINS (rack strikes).

import { TONEBAR_L } from '@knockon/parts-data';
import { qrot, vcross, vdot, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { bodyPos, bodyRot, bodyVel, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import { DB3 } from './m3_boom.ts';
import type { PartChannels } from './index.ts';

/** Single-hit break thresholds (fun.md): PANE 0.8 N·s, VASE 0.6 N·s. */
const BREAK_J: Readonly<Record<string, number>> = { pane: 0.8, vase: 0.6 };

/** Shatters a PANE or VASE: its pre-built chunks take over (Machine.shatter), a `Break` event and a Sound. */
function shatterGlass(c: PartChannels, i: number, at: readonly number[], cause: number): void {
  const h = c.h;
  if (!h.st.alive[i] || h.st.broken[i] || !h.shatter(i)) return;
  const id = h.emit('Break', i, at, 0, cause);
  h.sound(at, DB3.shatter, i, id);
}

/** Inside a blast's radius, glass shatters (the impulse then throws its chunks). */
export function funBlastHit(c: PartChannels, k: number, cause: number): void {
  const t = c.h.parts[k]!.def.type;
  if (t === 'pane' || t === 'vase') shatterGlass(c, k, c.h.com(k), cause);
}

/** Degree (0–14) + volume (0–0.99) in one `Note` magnitude: the audio side picks the pitch in the world key. */
const noteMag = (degree: number, J: number, full: number): number => degree + Math.min(0.99, J / full);

export function funContact(c: PartChannels, pi: number, mb: HostBody, J: number, pos: Vec, added: boolean, cause: number, other: number): boolean {
  const h = c.h, st = h.st, p = h.parts[pi]!;
  switch (p.def.type) {
    case 'glint': case 'bearing': {
      // marbles roll: Jolt gives a ⌀16 mm sphere no rolling torque, so they glide on low friction and their spin is
      // set to no-slip from each contact (looks like rolling; the spin doesn't feed back into their motion)
      if (mb.role !== 'base' || c.glide.riding(pi)) return true;
      const b = mb.body, c0 = bodyPos(b), v = bodyVel(b);
      const n = vnorm(vsub(c0, pos));
      const vt = vsub(v, vscale(n, vdot(v, n)));
      const w = vscale(vcross(n, vt), 1 / 0.008);
      h.bi.SetAngularVelocity(b.GetID(), h.v3(w[0], w[1], w[2]));
      return true;
    }
    case 'pane': case 'vase':
      if (added && mb.role === 'base' && J >= BREAK_J[p.def.type]!) shatterGlass(c, pi, pos, cause);
      return true;
    case 'tonebars': {
      if (!added || mb.role !== 'base' || J < 0.02 || st.cooldown[pi]! > 0) return true;
      const l = toLocal(c, pi, pos);
      const deg = Math.max(0, Math.min(14, Math.round(p.props.degree ?? 0)));
      if (l[1] < 0.035 || Math.abs(l[2]) > TONEBAR_L[deg]! / 2 + 0.01) return true; // the bar's top, not the rail
      st.cooldown[pi] = Math.round(0.06 * h.tickRate);
      st.pressed[pi] = Math.round(0.12 * h.tickRate);
      const at = h.local(pi, [0, 0.058, 0]);
      const id = h.emit('Note', pi, at, noteMag(deg, J, 0.5), cause, other);
      h.sound(at, DB3.tonebar, pi, id);
      return true;
    }
    case 'ding': {
      if (!added || mb.role !== 'base' || st.cooldown[pi]! > 0) return true;
      const l = toLocal(c, pi, pos);
      const plunger = l[1] >= 0.05;
      if (J < (plunger ? 0.04 : 0.1)) return true;
      st.cooldown[pi] = Math.round(0.15 * h.tickRate);
      st.pressed[pi] = Math.round(0.5 * h.tickRate);
      const at = h.local(pi, [0, 0.03, 0]);
      const id = h.emit('Note', pi, at, noteMag(Math.max(0, Math.min(14, Math.round(p.props.degree ?? 0))), J, plunger ? 0.3 : 0.6), cause, other);
      h.sound(at, DB3.ding, pi, id); // 77 dB: every critter within 4 m startles (SIMULATION §5.10)
      return true;
    }
    default: return false;
  }
}

/** After contacts: a PINS rack whose pins are all more than 45° from upright emits one `PinsAllDown` (on its first pin). */
export function funAfterContacts(c: PartChannels): void {
  const h = c.h, st = h.st, m3 = st.m2.m3, racks = c.m3.racks;
  for (let r = 0; r < racks.length; r++) {
    if (m3.strike[r]) continue;
    let down = 0, cause = -1;
    for (const i of racks[r]!) {
      const up = qrot(bodyRot(h.bodies[h.parts[i]!.base]!.body), [0, 1, 0]);
      if (!st.alive[i] || vdot(up, [0, 1, 0]) < 0.7071) { down++; cause = Math.max(cause, st.lastEv[i] ?? -1); }
    }
    if (down < racks[r]!.length) continue;
    m3.strike[r] = 1;
    h.emit('PinsAllDown', racks[r]![0]!, h.com(racks[r]![0]!), down, cause);
  }
}

/**
 * Screen readouts: TONEBARS and DING show their scale degree + 1. A Wind ZONE reads its strength as a 1–21 bar
 * (1 + 20·s/15, so audio can whoosh it); other ZONE modes read 0 (silent by design).
 */
export function funMeter(c: PartChannels, i: number): number {
  const p = c.h.parts[i]!;
  if (p.def.type === 'zone') return (p.props.mode ?? 0) === 2 ? 1 + Math.round((20 * Math.min(15, Math.max(0, p.props.strength ?? 1))) / 15) : 0;
  return p.def.type === 'tonebars' || p.def.type === 'ding' ? 1 + Math.max(0, Math.min(14, Math.round(p.props.degree ?? 0))) : 0;
}
