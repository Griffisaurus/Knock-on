// The partner ghost (stream BUILDUX, D124): what a player holds, sent in presence `ghost` (packages/net PresenceGhost)
// and drawn turned on the other screen. D117 sent only the grabbed part's type and position; now the rotation and up to
// PRESENCE_GHOST_MAX held parts go along (offsets in mm and quaternions × 10 000 as integers: about 1 KB at 32 parts),
// still at presence's 20 Hz. Old clients read `type` + `pos` as before.

import { PRESENCE_GHOST_MAX, type PresenceGhost } from '@knockon/net';
import type { Q4 } from '../catalog.ts';
import type { V3 } from '../math.ts';

export interface HeldPart { readonly type: string; readonly pos: V3; readonly rot: Q4 }

const q4 = (q: Q4): [number, number, number, number] => [Math.round(q[0] * 1e4), Math.round(q[1] * 1e4), Math.round(q[2] * 1e4), Math.round(q[3] * 1e4)];

/** Encode the held parts (the first is the grabbed one). Null when nothing is held. */
export function encodeGhost(held: readonly HeldPart[]): PresenceGhost | null {
  const a = held[0];
  if (!a) return null;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  const ghost: PresenceGhost = { type: a.type, pos: [r3(a.pos[0]), r3(a.pos[1]), r3(a.pos[2])], rot: [a.rot[0], a.rot[1], a.rot[2], a.rot[3]].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number] };
  if (held.length > 1) {
    ghost.parts = held.slice(0, PRESENCE_GHOST_MAX).map((p) => [p.type, Math.round((p.pos[0] - ghost.pos[0]) * 1000), Math.round((p.pos[1] - ghost.pos[1]) * 1000), Math.round((p.pos[2] - ghost.pos[2]) * 1000), ...q4(p.rot)]);
  }
  return ghost;
}

const unit = (q: readonly number[]): Q4 => { const l = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1; return [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l]; };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Decode a partner's ghost (tolerant: anything malformed is dropped). An old client's ghost comes back as one unturned part. */
export function decodeGhost(g: PresenceGhost | undefined): HeldPart[] {
  if (!g || typeof g.type !== 'string' || !Array.isArray(g.pos) || !g.pos.every(finite)) return [];
  const pos: V3 = [g.pos[0], g.pos[1], g.pos[2]];
  if (Array.isArray(g.parts) && g.parts.length) {
    const out: HeldPart[] = [];
    for (const t of g.parts.slice(0, PRESENCE_GHOST_MAX)) {
      if (!Array.isArray(t) || typeof t[0] !== 'string' || !t.slice(1, 8).every(finite)) continue;
      out.push({ type: t[0], pos: [pos[0] + t[1] / 1000, pos[1] + t[2] / 1000, pos[2] + t[3] / 1000], rot: unit([t[4] / 1e4, t[5] / 1e4, t[6] / 1e4, t[7] / 1e4]) });
    }
    if (out.length) return out;
  }
  const rot = Array.isArray(g.rot) && g.rot.length === 4 && g.rot.every(finite) ? unit(g.rot) : [0, 0, 0, 1] as Q4;
  return [{ type: g.type, pos, rot }];
}
