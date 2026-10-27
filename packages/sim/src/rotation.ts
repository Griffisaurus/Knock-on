// Rotation codes → quaternions, deterministically (detmath only; SIMULATION §10.1).

import { dcos, dsin } from '@knockon/detmath';
import type { Rotation } from '@knockon/format';

export type Quat = [number, number, number, number]; // x, y, z, w

const HALF_DEG_TO_HALF_RAD = Math.PI / 720; // (half-degree units → radians) / 2
const ST_SCALE = 32767 / 0.7071067811865476;

function mulQ(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Yaw about +Y, then pitch about +X, then roll about +Z (engine Y-up). */
export function rotationToQuat(r: Rotation): Quat {
  if (r.tag === 0) return [0, 0, 0, 1];
  if (r.tag === 1) {
    const y = r.yaw * HALF_DEG_TO_HALF_RAD, p = r.pitch * HALF_DEG_TO_HALF_RAD, z = r.roll * HALF_DEG_TO_HALF_RAD;
    const qy: Quat = [0, dsin(y), 0, dcos(y)];
    const qx: Quat = [dsin(p), 0, 0, dcos(p)];
    const qz: Quat = [0, 0, dsin(z), dcos(z)];
    return mulQ(mulQ(qy, qx), qz);
  }
  const rest = [r.a / ST_SCALE, r.b / ST_SCALE, r.c / ST_SCALE];
  const largest = Math.sqrt(Math.max(0, 1 - rest[0]! * rest[0]! - rest[1]! * rest[1]! - rest[2]! * rest[2]!));
  const q: number[] = [];
  let k = 0;
  for (let i = 0; i < 4; i++) q.push(i === r.index ? largest : rest[k++]!);
  return q as Quat;
}
