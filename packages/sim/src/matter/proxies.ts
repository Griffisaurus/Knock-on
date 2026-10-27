// Rigid colliders as Matter proxies (SIMULATION §8.5, M4_PLAN contract 2): part shapes become spheres, capsules and
// oriented boxes in Matter units; bodies with no shape list (critters, chunks, pieces) use their Jolt world bounds.
//
// A proxy record is 22 i32s: [id, shape, dynamic, px, py, pz, qx, qy, qz, qw (Q14), sx, sy, sz, vx, vy, vz,
// ax, ay, az, lx, ly, lz]: id, the MatterProxy fields, then the proxy centre in its body's frame (units), which the
// impulse step needs to find the lever arm on the body's pose 8 rigid ticks later.

import { dcos, dsin } from '@knockon/detmath';
import type { ShapeDef } from '@knockon/parts-data';
import { qmul, qrot, type Q, type Vec } from '../vec.ts';
import type { MatterProxy } from './contract.ts';
import { mToU, mpsToU, qToQ14, radpsToU } from './units.ts';

export const PROXY_STRIDE = 22;
export const SHAPE_SPHERE = 0, SHAPE_CAPSULE = 1, SHAPE_OBB = 2, SHAPE_PLANE = 3;
/** Dynamic proxy ids are body × 64 + sub-shape; static proxies count up from here (they never get impulses). */
export const STATIC_ID_BASE = 0x40000000;
export const MAX_SUB = 64;

/** A proxy in its body's frame (metres): shape, centre, rotation, size per the contract's conventions. */
export interface LocalProxy {
  readonly shape: 0 | 1 | 2;
  readonly at: Vec;
  readonly rot: Q;
  /** sphere [r, 0, 0]; capsule [r, halfHeight, 0] (local Y); obb half extents. */
  readonly size: Vec;
}

const H = Math.SQRT1_2;

/** The local rotation Machine.shapeFor gives a shape (axis, tiltZ, rot), so proxies sit exactly on the colliders. */
function shapeRot(s: ShapeDef): Q {
  let q: Q = [0, 0, 0, 1];
  if (s.axis === 'x') q = [0, 0, -H, H];
  if (s.axis === 'z') q = [H, 0, 0, H];
  if (s.tiltZ) { const half = (s.tiltZ * Math.PI) / 360; q = qmul([0, 0, dsin(half), dcos(half)], q); }
  if (s.rot) q = qmul(s.rot as Q, q);
  return q;
}

/** Part shapes → local proxies. Cylinders become capsules when long, boxes when squat (discs, hubs). */
export function localProxies(shapes: readonly ShapeDef[]): LocalProxy[] {
  const out: LocalProxy[] = [];
  for (const s of shapes) {
    const at: Vec = s.at ? [s.at[0], s.at[1], s.at[2]] : [0, 0, 0];
    const rot = shapeRot(s);
    switch (s.kind) {
      case 'sphere': out.push({ shape: SHAPE_SPHERE, at, rot, size: [s.size[0] / 2, 0, 0] }); break;
      case 'box': out.push({ shape: SHAPE_OBB, at, rot, size: [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2] }); break;
      case 'capsule': {
        const r = s.size[0] / 2;
        out.push({ shape: SHAPE_CAPSULE, at, rot, size: [r, Math.max(0.001, s.size[1] / 2 - r), 0] });
        break;
      }
      case 'cylinder': {
        const r = s.size[0] / 2, h = s.size[1] / 2;
        out.push(h > r ? { shape: SHAPE_CAPSULE, at, rot, size: [r, h - r, 0] } : { shape: SHAPE_OBB, at, rot, size: [r, h, r] });
        break;
      }
    }
  }
  return out;
}

/** Writes one proxy record at `o`. Pose, velocities in metres / seconds; `local` is the centre in the body frame. */
export function writeProxy(rec: Int32Array, o: number, id: number, shape: number, dynamic: boolean, c: Vec, q: Q, size: Vec, v: Vec, w: Vec, local: Vec): void {
  rec[o] = id; rec[o + 1] = shape; rec[o + 2] = dynamic ? 1 : 0;
  rec[o + 3] = mToU(c[0]); rec[o + 4] = mToU(c[1]); rec[o + 5] = mToU(c[2]);
  rec[o + 6] = qToQ14(q[0]); rec[o + 7] = qToQ14(q[1]); rec[o + 8] = qToQ14(q[2]); rec[o + 9] = qToQ14(q[3]);
  rec[o + 10] = mToU(size[0]); rec[o + 11] = mToU(size[1]); rec[o + 12] = mToU(size[2]);
  rec[o + 13] = mpsToU(v[0]); rec[o + 14] = mpsToU(v[1]); rec[o + 15] = mpsToU(v[2]);
  rec[o + 16] = radpsToU(w[0]); rec[o + 17] = radpsToU(w[1]); rec[o + 18] = radpsToU(w[2]);
  rec[o + 19] = mToU(local[0]); rec[o + 20] = mToU(local[1]); rec[o + 21] = mToU(local[2]);
}

/** World centre of a local proxy on a body pose. */
export function proxyWorld(pos: Vec, rot: Q, lp: LocalProxy): { c: Vec; q: Q } {
  const r = qrot(rot, lp.at);
  return { c: [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]], q: qmul(rot, lp.rot) };
}

/** Records → the contract's MatterProxy objects (views into the record, no copies). */
export function toProxies(rec: Int32Array, n: number): MatterProxy[] {
  const out: MatterProxy[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const o = k * PROXY_STRIDE;
    out[k] = {
      id: rec[o]!, shape: rec[o + 1]! as 0 | 1 | 2 | 3, dynamic: rec[o + 2] === 1,
      pos: rec.subarray(o + 3, o + 6), rot: rec.subarray(o + 6, o + 10), size: rec.subarray(o + 10, o + 13),
      vel: rec.subarray(o + 13, o + 16), ang: rec.subarray(o + 16, o + 19),
    };
  }
  return out;
}
