// C4 (M4): saved camera paths for the capture dialog's "Saved path" source (UI_UX §4.11). Keys are added from photo
// mode (eye, target, field of view, at a time in seconds); playback is a cubic Hermite (Catmull-Rom tangents over
// the keys' own spacing) through every key, held before the first and after the last. Stored per world.

import type { V3 } from '../math.ts';

export interface CamKey { readonly t: number; readonly eye: V3; readonly target: V3; readonly fov: number }
export interface CamShot { readonly eye: V3; readonly target: V3; readonly fov: number }

const lerpN = (a: number[], b: number[], u: number): number[] => a.map((v, i) => v + (b[i]! - v) * u);

export class CameraPath {
  readonly keys: readonly CamKey[];

  constructor(keys: readonly CamKey[]) {
    this.keys = [...keys].sort((a, b) => a.t - b.t);
  }

  get duration(): number { return this.keys.length ? this.keys.at(-1)!.t - this.keys[0]!.t : 0; }

  at(t: number): CamShot {
    const K = this.keys;
    if (!K.length) return { eye: [0, 2, 4], target: [0, 0, 0], fov: 40 };
    const flat = (k: CamKey): number[] => [...k.eye, ...k.target, k.fov];
    const shot = (v: number[]): CamShot => ({ eye: [v[0]!, v[1]!, v[2]!], target: [v[3]!, v[4]!, v[5]!], fov: v[6]! });
    if (t <= K[0]!.t || K.length === 1) return shot(flat(K[0]!));
    if (t >= K.at(-1)!.t) return shot(flat(K.at(-1)!));
    let i = 0;
    while (K[i + 1]!.t < t) i++;
    const k0 = K[i]!, k1 = K[i + 1]!;
    const h = k1.t - k0.t;
    if (h <= 1e-9) return shot(flat(k1));
    const u = (t - k0.t) / h;
    const p0 = flat(k0), p1 = flat(k1);
    // tangents (per second) from the neighbours, one-sided at the ends
    const tan = (j: number): number[] => {
      const a = K[Math.max(0, j - 1)]!, b = K[Math.min(K.length - 1, j + 1)]!;
      const dt = b.t - a.t;
      return dt > 1e-9 ? flat(b).map((v, c) => (v - flat(a)[c]!) / dt) : flat(a).map(() => 0);
    };
    const m0 = tan(i), m1 = tan(i + 1);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return shot(p0.map((v, c) => h00 * v + h10 * h * m0[c]! + h01 * p1[c]! + h11 * h * m1[c]!));
  }

  /** Linear blend (for previews): the same as `at` at the keys. */
  linear(t: number): CamShot {
    const K = this.keys;
    if (K.length < 2) return this.at(t);
    const i = Math.max(0, Math.min(K.length - 2, K.findIndex((k) => k.t > t) - 1));
    const a = K[i]!, b = K[i + 1]!;
    const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1)));
    const v = lerpN([...a.eye, ...a.target, a.fov], [...b.eye, ...b.target, b.fov], u);
    return { eye: [v[0]!, v[1]!, v[2]!], target: [v[3]!, v[4]!, v[5]!], fov: v[6]! };
  }

  toJSON(): { keys: CamKey[] } { return { keys: this.keys.map((k) => ({ t: k.t, eye: [...k.eye] as V3, target: [...k.target] as V3, fov: k.fov })) }; }

  static fromJSON(j: unknown): CameraPath {
    const keys = (j as { keys?: unknown })?.keys;
    if (!Array.isArray(keys)) return new CameraPath([]);
    const ok = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    return new CameraPath(keys.filter((k: { t?: unknown; eye?: unknown; target?: unknown; fov?: unknown }) => typeof k?.t === 'number' && ok(k.eye, 3) && ok(k.target, 3) && typeof k.fov === 'number')
      .map((k: CamKey) => ({ t: k.t, eye: [...k.eye] as V3, target: [...k.target] as V3, fov: k.fov })));
  }
}

const storeKey = (world: string): string => `kn.campath.${world || 'local'}`;

export function loadPath(world: string): CameraPath {
  try { const s = localStorage.getItem(storeKey(world)); return s ? CameraPath.fromJSON(JSON.parse(s)) : new CameraPath([]); } catch { return new CameraPath([]); }
}

export function savePath(world: string, p: CameraPath): void {
  try { localStorage.setItem(storeKey(world), JSON.stringify(p.toJSON())); } catch { /* storage full or blocked */ }
}
