// Part shape keys (M2): glTF morph targets on six part types, driven per instance from sim state the client
// already receives (part flags and body transforms). The renderer lists the morphing scene instances
// (`renderer.morphInstances`) and takes their weights through `setMorph`; this module eases them.
//
//   SPRONG       sk_depress            pressed flag (a bounce), eased in and out
//   PUFFER       sk_squash, sk_spring  the pressed pulse: squash while pressed, a decaying spring after
//   CORK BLASTER sk_compress           cocked (flag 'lit') until fired
//   GOTCHA BOX   sk_stretch            the head piece's height above the box / GOTCHA.rise
//   BIG TOP      sk_iris               closes toward the loaded roller's diameter (flag 'pressed' = loaded)
//   PUNCHLINE    sk_compress           1 − the glove's extension / 0.5 m
//
// Build mode shows the rest pose: CORK BLASTER and PUNCHLINE start compressed, the rest open.

import type { PartRecord } from '@knockon/format';
import { BIG_TOP, bigTopAxis, GOTCHA, propValues } from '@knockon/parts-data';
import { PartFlagBits } from '@knockon/sim';
import { partDef } from '../catalog.ts';
import { pieceExtras } from './pieces.ts';
import type { Renderer, SceneItem } from './renderer.ts';

export interface MorphRun {
  readonly phase: string;
  readonly bodies: readonly { readonly part: number; readonly type: string; readonly role: string }[];
  readonly transforms: Float32Array;
  readonly partIds: readonly number[];
  readonly flags: Uint8Array;
  readonly paused: boolean;
  readonly speed: number;
}

/** Rest weights (build mode) per type and key. */
const REST: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  cork_blaster: { sk_compress: 1 },
  punchline: { sk_compress: 1 },
};

const qinvRot = (q: ArrayLike<number>, v: readonly number[]): [number, number, number] => {
  const x = -q[0]!, y = -q[1]!, z = -q[2]!, w = q[3]!;
  const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
  return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
};
/** conj(a) × b: b's rotation relative to a. */
const qmulInv = (a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number, number] => {
  const ax = -a[0]!, ay = -a[1]!, az = -a[2]!, aw = a[3]!, bx = b[0]!, by = b[1]!, bz = b[2]!, bw = b[3]!;
  return [aw * bx + bw * ax + ay * bz - az * by, aw * by + bw * ay + az * bx - ax * bz, aw * bz + bw * az + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
};
const ease = (cur: number, want: number, rateIn: number, rateOut: number, dt: number): number =>
  cur + (want - cur) * Math.min(1, dt * (want > cur ? rateIn : rateOut));

interface Slot { w: number[]; pressed: boolean; since: number }

export class PartMorphs {
  private forList: unknown = null;
  private slots: Slot[] = [];
  private bodiesFor: unknown = null;
  private bodyOf = new Map<number, { base: number; arm: number; piece: number }>();
  private time = 0;

  /** Per frame: drive every morphing instance, then draw the procedural extras the art doesn't cover. */
  frame(r: Renderer, dt: number, run: MorphRun, parts: ReadonlyMap<number, PartRecord> | undefined, overlay: SceneItem[]): void {
    const list = r.morphInstances;
    const running = run.phase === 'running' && run.transforms.length > 0 && run.bodies.length > 0;
    const clock = running ? (run.paused ? 0 : dt * run.speed) : dt;
    this.time += clock;
    if (this.forList !== list) {
      this.forList = list;
      this.slots = list.map((m) => ({ w: m.names.map(() => 0), pressed: false, since: -1e9 }));
    }
    if (running && this.bodiesFor !== run.bodies) {
      this.bodiesFor = run.bodies;
      this.bodyOf = new Map();
      run.bodies.forEach((b, i) => {
        const e = this.bodyOf.get(b.part) ?? { base: -1, arm: -1, piece: -1 };
        if (b.role === 'base') e.base = i; else if (b.role === 'arm') e.arm = i; else if (b.role === 'piece') e.piece = i;
        this.bodyOf.set(b.part, e);
      });
    }
    const pIndex = running ? new Map(run.partIds.map((id, i) => [id, i])) : null;
    let gotchaArtSpring = false;
    list.forEach((m, si) => {
      const st = this.slots[si]!;
      const type = r.lib.meshes[m.mesh]?.name.split(':')[0] ?? '';
      if (type === 'gotcha_box' && m.names.includes('sk_stretch')) gotchaArtSpring = true;
      const body = running && m.body >= 0 ? run.bodies[m.body] : undefined;
      if (!body || !pIndex) {
        m.names.forEach((n, k) => { st.w[k] = REST[type]?.[n] ?? 0; r.setMorph(m.slot, k, st.w[k]!); });
        return;
      }
      const flags = run.flags[pIndex.get(body.part) ?? -1] ?? 0;
      const pressed = (flags & PartFlagBits.pressed) !== 0;
      if (pressed !== st.pressed) { st.pressed = pressed; st.since = this.time; }
      const xf = run.transforms, ids = this.bodyOf.get(body.part);
      const local = (b: number): [number, number, number] | null => {
        if (!ids || ids.base < 0 || b < 0) return null;
        const o = ids.base * 7;
        return qinvRot(xf.subarray(o + 3, o + 7), [xf[b * 7]! - xf[o]!, xf[b * 7 + 1]! - xf[o + 1]!, xf[b * 7 + 2]! - xf[o + 2]!]);
      };
      m.names.forEach((n, k) => {
        let w = st.w[k]!;
        switch (`${type}/${n}`) {
          case 'sprong/sk_depress': w = ease(w, pressed ? 1 : 0, 30, 10, clock); break;
          case 'puffer/sk_squash': w = ease(w, pressed ? 1 : 0, 30, 8, clock); break;
          case 'puffer/sk_spring': {
            const t = this.time - st.since; // after release: one decaying overshoot
            w = !pressed && t < 0.5 ? Math.sin((t / 0.5) * Math.PI) * (1 - t / 0.5) : 0;
            break;
          }
          case 'cork_blaster/sk_compress': w = ease(w, flags & PartFlagBits.lit ? 1 : 0, 20, 40, clock); break;
          case 'gotcha_box/sk_stretch': {
            // the head's rise along its leaned axis: undo the lean about GOTCHA.pivot, read y
            const pc = ids?.piece ?? -1, l = local(pc);
            if (!l || !ids) { w = 0; break; }
            const bq = xf.subarray(ids.base * 7 + 3, ids.base * 7 + 7), pq = xf.subarray(pc * 7 + 3, pc * 7 + 7);
            const rel = qmulInv(bq, pq);
            const v = qinvRot(rel, [l[0] - GOTCHA.pivot[0], l[1] - GOTCHA.pivot[1], l[2] - GOTCHA.pivot[2]]);
            w = Math.max(0, Math.min(1, (v[1] + GOTCHA.pivot[1]) / GOTCHA.rise));
            break;
          }
          case 'punchline/sk_compress': {
            const l = local(ids?.arm ?? -1);
            w = l ? 1 - Math.max(0, Math.min(1, l[0] / 0.5)) : 1;
            break;
          }
          case 'big_top/sk_iris': w = ease(w, pressed ? this.iris(run, body.part, parts) : 0, 8, 8, clock); break;
          default: w = REST[type]?.[n] ?? 0;
        }
        st.w[k] = w;
        r.setMorph(m.slot, k, w);
      });
    });
    // GOTCHA BOX: a procedural coil until the art's spring stretches by itself
    if (!gotchaArtSpring) pieceExtras(run, overlay);
  }

  /** BIG TOP: how far to close the iris for the roller sitting in its bore (0 open … 1 shut). */
  private iris(run: MorphRun, part: number, parts: ReadonlyMap<number, PartRecord> | undefined): number {
    const ids = this.bodyOf.get(part);
    const p = parts?.get(part);
    const def = partDef('big_top');
    if (!ids || ids.base < 0 || !def) return 0;
    const elev = p ? propValues(def, p.props).elevation ?? 30 : 30;
    const { dir } = bigTopAxis(elev);
    const along = (BIG_TOP.back + BIG_TOP.muzzle) / 2;
    const xf = run.transforms, o = ids.base * 7;
    const q = xf.subarray(o + 3, o + 7);
    const c = [BIG_TOP.trunnion[0] + dir[0] * along, BIG_TOP.trunnion[1] + dir[1] * along, BIG_TOP.trunnion[2]];
    let best = Infinity, size = 0;
    run.bodies.forEach((b, i) => {
      if (b.role !== 'base' || b.part === part) return;
      const d = partDef(b.type);
      if (!d || d.family !== 'rollers') return;
      const l = qinvRot(q, [xf[i * 7]! - xf[o]!, xf[i * 7 + 1]! - xf[o + 1]!, xf[i * 7 + 2]! - xf[o + 2]!]);
      const dist = Math.hypot(l[0] - c[0]!, l[1] - c[1]!, l[2] - c[2]!);
      if (dist < best) { best = dist; size = d.bounds.max[0] - d.bounds.min[0]; }
    });
    if (best > BIG_TOP.boreR * 2) return 0;
    return Math.max(0, Math.min(1, 1 - size / (2 * BIG_TOP.boreR)));
  }
}
