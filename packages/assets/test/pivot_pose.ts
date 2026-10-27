// Test helper (M2, stream E1): ports that ride a pivot (.art.json `ports[].pivot`) are exported where the art is
// modelled, at the pivot's `rest` value. Gameplay defs and briefs give them at pivot value 0 (e.g. the SCOOP bail
// upright). poseAtZero() turns such a port back to pivot value 0 (turn pivots; slide pivots move along the axis).
type V3 = readonly [number, number, number];
export interface RawPivot { name: string; pos: V3; axis: V3; rest?: number; motion?: string; parent?: string }
export interface RawPort { name: string; channel: string; pos: V3; dirVec: V3; pivot?: string }

function rotate(v: V3, axis: V3, deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = axis;
  const d = v[0] * x + v[1] * y + v[2] * z;
  const cr = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  return [0, 1, 2].map((i) => v[i]! * c + cr[i]! * s + axis[i]! * d * (1 - c)) as [number, number, number];
}

export function poseAtZero(port: RawPort, pivots: readonly RawPivot[]): { pos: V3; dirVec: V3 } {
  const p = port.pivot ? pivots.find((x) => x.name === port.pivot) : undefined;
  if (!p || !p.rest) return { pos: port.pos, dirVec: port.dirVec };
  if (p.motion === 'slide') {
    return { pos: [0, 1, 2].map((i) => port.pos[i]! - p.axis[i]! * p.rest!) as unknown as V3, dirVec: port.dirVec };
  }
  const rel = [0, 1, 2].map((i) => port.pos[i]! - p.pos[i]!) as unknown as V3;
  const r = rotate(rel, p.axis, -p.rest);
  return { pos: [0, 1, 2].map((i) => r[i]! + p.pos[i]!) as unknown as V3, dirVec: rotate(port.dirVec, p.axis, -p.rest) };
}
