// Part catalogue for the client: definitions from @knockon/parts-data plus render-side looks
// (blockout composites from the definitions' visuals, or pipeline art when it's built).

import { PARTS, partDef, type Channel, type PartDef, type Props, type VisualDef } from '@knockon/parts-data';
import type { Rgb } from './gfx/renderer.ts';

export type Q4 = readonly [number, number, number, number];

export const hexLin = (h: string): Rgb => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as unknown as Rgb;
};

/** Dock order: by family, M1 parts first (GAME_SPEC §12). */
const FAMILY_ORDER = ['rollers', 'frame', 'fun', 'drive', 'power', 'air', 'boom', 'contraptions', 'matter', 'future']; // A4: 'matter' (M4)
export const PALETTE: readonly PartDef[] = [...PARTS].sort((a, b) =>
  FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || (a.ship === b.ship ? 0 : a.ship === 'M1' ? -1 : 1));

export const FAMILY_HEX: Record<string, string> = {
  rollers: '#FF5B2E', frame: '#E8E2D6', fun: '#FFB020', drive: '#A78BFA', power: '#C6FF3A', air: '#9BE7D8', boom: '#FF4D5E', contraptions: '#2FD6FF', future: '#FF3DAE', // ART_BIBLE: Future Tech = Plasma
  matter: '#2FD6FF', // A4: ART_BIBLE Matter = clear poly + Beam
};

// GAME_SPEC §9.2 channel colours (always paired with a glyph in UI).
export const CHANNEL_HEX: Record<Channel, string> = {
  impact: '#F2F4F8', signal: '#FFC21A', spin: '#A78BFA', tension: '#E0A96D', power: '#C6FF3A', heat: '#FF5B2E', air: '#9BE7D8',
};
export const CHANNEL_GLYPH: Record<Channel, string> = { impact: '✸', signal: '◆', spin: '⟳', tension: '∿', power: '⚡', heat: '🔥', air: '≋' };
export const CHANNEL_RGB = Object.fromEntries(Object.entries(CHANNEL_HEX).map(([k, v]) => [k, hexLin(v)])) as Record<Channel, Rgb>;

export const PLAYER_RGB: Record<number, Rgb> = { 1: hexLin('#2FD6FF'), 2: hexLin('#FF3DAE') };
export const DANGER_RGB = hexLin('#FF4D5E');

export const MESH_ID: Record<VisualDef['mesh'], number> = { box: 0, sphere: 1, cylinder: 2 };

const H = Math.SQRT1_2;
/** Local rotation of a visual: the unit mesh's axis (Y) turned to x/z, then any slope tilt. */
export function visualQuat(v: { axis?: 'x' | 'y' | 'z'; tiltZ?: number }): Q4 {
  let q: Q4 = [0, 0, 0, 1];
  if (v.axis === 'x') q = [0, 0, -H, H];
  if (v.axis === 'z') q = [H, 0, 0, H];
  if (v.tiltZ) {
    const a = (v.tiltZ * Math.PI) / 360;
    q = qmul([0, 0, Math.sin(a), Math.cos(a)], q);
  }
  return q;
}

export function qmul(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qrot(q: Q4, v: readonly number[]): [number, number, number] {
  const u = [q[0], q[1], q[2]];
  const cx = u[1]! * v[2]! - u[2]! * v[1]!, cy = u[2]! * v[0]! - u[0]! * v[2]!, cz = u[0]! * v[1]! - u[1]! * v[0]!;
  const tx = 2 * cx, ty = 2 * cy, tz = 2 * cz;
  return [
    v[0]! + q[3] * tx + (u[1]! * tz - u[2]! * ty),
    v[1]! + q[3] * ty + (u[2]! * tx - u[0]! * tz),
    v[2]! + q[3] * tz + (u[0]! * ty - u[1]! * tx),
  ];
}

export const qinv = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];

const colorCache = new Map<string, Rgb>();
export function colorOf(hex: string): Rgb {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = hexLin(hex)));
  return c;
}

export { partDef };
export type { PartDef, Props };
