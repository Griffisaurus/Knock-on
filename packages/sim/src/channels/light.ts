// Light channel (SIMULATION §5.6), stage 4. Beam emitters march rays up to 8 interactions / 30 m:
//   - TORCH: 20° cone, 1 centre ray + 8 at the 10° half angle, each 1/9 intensity (M2);
//   - LANCE (M3): one ray of intensity 1 along +X from its aperture while powered.
// Omni emitters (LAMP) light every receiver within 6 m with f·(1 − d/6)² past one occlusion ray. Interactions:
//   - BURNING GLASS lens: the ray continues toward the focus point `focal` m beyond the lens (on the far side from the
//     light); a surface it hits within ±0.03 m of the focal distance gets a heat spot (r 0.02 m) that stage 5 reads.
//     A LANCE ray through a lens is a cutting beam (M3): its converged segment is a line of heat (r 0.015 m, up to 1 m).
//   - MIRROR (M3): a ray on its chrome face (front, +Z) reflects about the face normal; the back is opaque.
//   - SPLITTER (M3): a ray into the cube leaves as 3 rays, straight on and ±12° about the part's up axis, 1/3 each.
//   - glass-material bodies: pass through at 90 %.
//   - SUNCELL: absorbs; its light sums into its supply for the next tick's power stage.
//   - TRIPWIRE (M3): light on its −X eye (≥ 0.1, held 2 ticks) arms it; Break / Lit mode pulse on the edges.
//   - anything else (and the environment): opaque.
// Global cap: 1,024 ray segments per tick; emitters past it are skipped in part order. The traced segments are kept
// for the renderer (Machine.lightBeams); they never feed back into the sim.

import { dcos, dsin, f32 } from '@knockon/detmath';
import type { JoltModule } from '@knockon/jolt';
import { LANCE, OPTICS, TRIPWIRE } from '@knockon/parts-data';
import { qrot, vadd, vcross, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { L_MOVING, type Host } from './host.ts';
import { toLocal } from './devices.ts';
import type { PartChannels } from './index.ts';

const MAX_SEGMENTS = 1024, MAX_HOPS = 8, MAX_LEN = 30;
const LAMP_RANGE = 6;
const SUNCELL_LIT = 0.05;

interface Hit { readonly body: number; readonly dist: number; readonly point: Vec }

/** Closest-hit raycasts against everything but ghosts, skipping a list of bodies. */
export class RayCaster {
  private readonly bpFilter: JoltModule;
  private readonly olFilter: JoltModule;
  private readonly shapeFilter: JoltModule;
  private readonly settings: JoltModule;
  private readonly h: Host;
  // a plain field, not a parameter property: Node's strip-only TypeScript (the soak scripts) rejects those
  constructor(h: Host) {
    this.h = h;
    const J = h.Jolt;
    this.bpFilter = new J.DefaultBroadPhaseLayerFilter(h.jolt.GetObjectVsBroadPhaseLayerFilter(), L_MOVING);
    this.olFilter = new J.DefaultObjectLayerFilter(h.jolt.GetObjectLayerPairFilter(), L_MOVING);
    this.shapeFilter = new J.ShapeFilter();
    this.settings = new J.RayCastSettings();
  }

  cast(from: Vec, dir: Vec, len: number, ignore: readonly number[]): Hit | null {
    const J = this.h.Jolt;
    const o = new J.RVec3(f32(from[0]), f32(from[1]), f32(from[2])), d = new J.Vec3(f32(dir[0] * len), f32(dir[1] * len), f32(dir[2] * len));
    const ray = new J.RRayCast(o, d);
    const col = new J.CastRayClosestHitCollisionCollector();
    const bodies = new J.IgnoreMultipleBodiesFilter();
    for (const b of ignore) if (b >= 0) bodies.IgnoreBody(this.h.bodies[b]!.body.GetID());
    this.h.system.GetNarrowPhaseQuery().CastRay(ray, this.settings, col, this.bpFilter, this.olFilter, bodies, this.shapeFilter);
    let out: Hit | null = null;
    if (col.HadHit()) {
      const hit = col.mHit;
      const frac = hit.mFraction;
      const ud = this.h.bi.GetUserData(hit.mBodyID);
      const dist = frac * len;
      out = { body: ud === 0x7fffffff ? -1 : ud, dist, point: vadd(from, vscale(dir, dist)) };
    }
    J.destroy(bodies); J.destroy(col); J.destroy(ray); J.destroy(o); J.destroy(d);
    return out;
  }
}

/** A ray in flight: its start, direction, intensity, length left, bodies to skip, hops used, cause, kind. */
interface Ray { from: Vec; dir: Vec; intensity: number; left: number; ignore: number[]; hops: number; cause: number; kind: number; src: number }

/** One stage-4 pass: segment budget, receiver light, focused lenses. */
interface Pass { segments: number; readonly light: Map<number, number>; readonly focused: Set<number> }

/** Stage 4. Fills `c.focus` (heat spots for stage 5) and updates receivers, emitting Lit / Unlit on edges. */
export function stageLight(c: PartChannels): void {
  const h = c.h, st = h.st, m2 = st.m2;
  c.focus.length = 0;
  c.m3.beams.length = 0;
  const torches = c.list('torch'), lamps = c.list('lamp'), suncells = c.list('suncell'), glasses = c.list('burning_glass');
  const lances = c.list('lance'), trips = c.list('tripwire');
  for (const i of lances) { emitterLit(c, i, st.alive[i]! && st.supply[i]! > 0, LANCE.aperture); m2.val2[i] = 0; }
  const lancing = lances.some((i) => m2.on[i] === 1);
  if (!torches.length && !lamps.length && !lancing) {
    for (const i of suncells) receive(c, i, 0);
    for (const i of glasses) focusLit(c, i, false);
    for (const i of trips) tripReceive(c, i, 0);
    return;
  }
  const pass: Pass = { segments: 0, light: new Map(), focused: new Set() }; // receiver part → incident intensity
  const light = pass.light;
  const rc = c.rays();
  // lamps: omni, 6 m, one occlusion ray per receiver
  for (const i of lamps) {
    const on = st.alive[i]! && st.supply[i]! > 0;
    lampLit(c, i, on);
    if (!on) continue;
    const bulb = h.local(i, [0, 0.148, 0]);
    const lampTo = (r: number, target: Vec): boolean => {
      const d = vlen(vsub(target, bulb));
      if (d >= LAMP_RANGE || d < 1e-6) return true;
      const dir = vscale(vsub(target, bulb), 1 / d);
      if (pass.segments++ >= MAX_SEGMENTS) return false;
      const hit = rc.cast(vadd(bulb, vscale(dir, 0.05)), dir, d, [h.parts[i]!.base]);
      if (hit && hit.body >= 0 && h.bodies[hit.body]!.part !== r) return true;
      const fall = (1 - d / LAMP_RANGE) * (1 - d / LAMP_RANGE);
      light.set(r, (light.get(r) ?? 0) + st.supply[i]! * fall);
      return true;
    };
    let ok = true;
    for (const r of suncells) {
      if (!st.alive[r]) continue;
      if (!lampTo(r, h.local(r, [-0.02, 0.0215, 0]))) { ok = false; break; }
    }
    if (ok) for (const r of trips) if (st.alive[r] && !lampTo(r, h.local(r, TRIPWIRE.eye))) break;
  }
  // torches: 9 rays each
  for (const i of torches) {
    const on = st.alive[i]! && m2.on[i]! === 1;
    if (!on) continue;
    const p = h.parts[i]!;
    const brot = bodyQ(h, p.base);
    const ax = qrot(brot, [1, 0, 0]), u = qrot(brot, [0, 1, 0]), w = qrot(brot, [0, 0, 1]);
    const lens = h.local(i, [0.1, 0.055, 0]);
    const ch = dcos(10 * Math.PI / 180), sh = dsin(10 * Math.PI / 180);
    for (let k = 0; k < 9; k++) {
      let dir: Vec = ax;
      if (k > 0) {
        const a = ((k - 1) * Math.PI) / 4;
        dir = vnorm(vadd(vscale(ax, ch), vadd(vscale(u, sh * dcos(a)), vscale(w, sh * dsin(a)))));
      }
      march(c, pass, { from: vadd(lens, vscale(dir, 0.004)), dir, intensity: 1 / 9, left: MAX_LEN, ignore: [p.base], hops: 0, cause: m2.cause[i]!, kind: 0, src: i });
    }
  }
  // lances: 1 ray each (M3)
  for (const i of lances) {
    if (m2.on[i] !== 1) continue;
    const p = h.parts[i]!;
    const dir = vnorm(qrot(bodyQ(h, p.base), [1, 0, 0]));
    march(c, pass, { from: vadd(h.local(i, LANCE.aperture), vscale(dir, 0.004)), dir, intensity: 1, left: MAX_LEN, ignore: [p.base], hops: 0, cause: st.lastEv[i] ?? -1, kind: 1, src: i });
  }
  for (const i of suncells) receive(c, i, light.get(i) ?? 0);
  for (const i of glasses) focusLit(c, i, pass.focused.has(i));
  for (const i of trips) tripReceive(c, i, light.get(i) ?? 0);
}

/** Marches one ray (and any rays a SPLITTER fans it into) through its interactions. */
function march(c: PartChannels, pass: Pass, ray0: Ray): void {
  const h = c.h, st = h.st, rc = c.rays(), light = pass.light;
  const stack: Ray[] = [ray0];
  while (stack.length) {
    const r = stack.pop()!;
    let from = r.from, dir = r.dir, intensity = r.intensity, left = r.left, hop = r.hops, kind = r.kind;
    const ignore = r.ignore;
    // set by a lens: the next cast checks the focus (and a second lens straight after it is opaque, as in M2)
    let lens: { lc: Vec; n: Vec; f: number; part: number } | null = null;
    while (hop < MAX_HOPS && left > 0 && intensity > 1e-4) {
      if (pass.segments++ >= MAX_SEGMENTS) break;
      const hit = rc.cast(from, dir, left, ignore);
      const end = hit ? hit.point : vadd(from, vscale(dir, left));
      c.m3.beams.push(from[0], from[1], from[2], end[0], end[1], end[2], intensity, kind);
      if (kind === 2 && lens) {
        // a LANCE's cutting beam: heat along the converged segment (stride 5: x, y, z, r, cause)
        const len = Math.min(1, vlen(vsub(end, from)));
        for (let s = 0.015; s <= len; s += 0.03) c.focus.push(...vadd(from, vscale(dir, s)), 0.015, r.cause);
      }
      if (!hit) break;
      left -= hit.dist;
      const afterLens = lens;
      if (lens) {
        const along = Math.abs(vdot(vsub(hit.point, lens.lc), lens.n));
        if (Math.abs(along - lens.f) <= 0.03) {
          c.focus.push(hit.point[0], hit.point[1], hit.point[2], 0.02, r.cause);
          pass.focused.add(lens.part);
        }
        lens = null;
      }
      if (hit.body < 0) break; // environment: opaque
      const part = h.bodies[hit.body]!.part;
      const def = h.parts[part]!.def;
      if (def.type === 'suncell') { light.set(part, (light.get(part) ?? 0) + intensity); break; }
      if (def.type === 'burning_glass') {
        if (afterLens) break;
        const lc = h.local(part, [0, 0.245, 0]);
        if (vlen(vsub(hit.point, lc)) > 0.05) break; // the stand, not the lens
        const n0 = qrot(bodyQ(h, h.parts[part]!.base), [0, 0, 1]);
        const n: Vec = vdot(dir, n0) >= 0 ? n0 : vscale(n0, -1);
        const f = h.parts[part]!.props.focal ?? 0.3;
        const F = vadd(lc, vscale(n, f));
        light.set(part, (light.get(part) ?? 0) + intensity);
        // the lens converges the ray onto F; a surface near the focal distance gets the heat spot
        dir = vnorm(vsub(F, hit.point));
        from = hit.point;
        ignore.push(h.parts[part]!.base);
        lens = { lc, n, f, part };
        if (kind === 1) { kind = 2; st.m2.val2[r.src] = 1; } // the LANCE's `armed` flag: cutting
        continue; // the converged cast belongs to this hop (M2)
      }
      if (def.type === 'tripwire') {
        if (toLocal(c, part, hit.point)[0] <= TRIPWIRE.face) light.set(part, (light.get(part) ?? 0) + intensity);
        break;
      }
      if (def.type === 'mirror') {
        const base = h.parts[part]!.base;
        const n = qrot(bodyQ(h, base), [0, 0, 1]);
        if (vdot(dir, n) >= 0 || toLocal(c, part, hit.point)[1] < OPTICS.plateY) break; // the back, or the foot
        dir = vnorm(vsub(dir, vscale(n, 2 * vdot(dir, n))));
        from = hit.point;
        ignore.push(base);
        hop++;
        continue;
      }
      if (def.type === 'splitter') {
        if (toLocal(c, part, hit.point)[1] < OPTICS.cubeY) break; // the plinth
        const up = vnorm(qrot(bodyQ(h, h.parts[part]!.base), [0, 1, 0]));
        const ign = [...ignore, h.parts[part]!.base];
        for (const deg of [-OPTICS.fanDeg, OPTICS.fanDeg, 0]) {
          stack.push({ from: hit.point, dir: rotateAbout(dir, up, deg), intensity: intensity / 3, left, ignore: [...ign], hops: hop + 1, cause: r.cause, kind, src: r.src });
        }
        break;
      }
      if (def.body.material === 'glass') { ignore.push(hit.body); from = hit.point; intensity *= 0.9; hop++; continue; }
      break;
    }
  }
}

/** Rotates a unit vector about a unit axis by `deg` degrees (Rodrigues). */
function rotateAbout(v: Vec, k: Vec, deg: number): Vec {
  if (deg === 0) return v;
  const a = (deg * Math.PI) / 180, cs = dcos(a), sn = dsin(a);
  return vnorm(vadd(vadd(vscale(v, cs), vscale(vcross(k, v), sn)), vscale(k, vdot(k, v) * (1 - cs))));
}

function bodyQ(h: Host, b: number): [number, number, number, number] {
  const r = h.bodies[b]!.body.GetRotation();
  return [r.GetX(), r.GetY(), r.GetZ(), r.GetW()];
}

/** SUNCELL: normalised light for next tick's supply; Lit / Unlit at 0.05. */
function receive(c: PartChannels, i: number, intensity: number): void {
  const h = c.h, m2 = h.st.m2;
  m2.val[i] = h.st.alive[i] ? Math.min(1, intensity) : 0;
  const lit = m2.val[i]! >= SUNCELL_LIT ? 1 : 0;
  if (lit !== m2.on[i]) { m2.on[i] = lit; h.emit(lit ? 'Lit' : 'Unlit', i, h.local(i, [-0.02, 0.0215, 0]), m2.val[i]!, h.st.lastEv[i] ?? -1); }
}

/**
 * TRIPWIRE: the eye's light (≥ 0.1) must hold 2 ticks to change its state (debounce, m3.n counts). The edges are
 * Lit / Unlit events; in Break mode the lit → dark edge fires (a `Trip` event and a pulse on `out`), in Lit mode the
 * dark → lit edge does.
 */
function tripReceive(c: PartChannels, i: number, intensity: number): void {
  const h = c.h, st = h.st, m2 = st.m2, m3 = m2.m3;
  m2.val[i] = st.alive[i] ? Math.min(1, intensity) : 0;
  const raw = m2.val[i]! >= TRIPWIRE.threshold ? 1 : 0;
  if (raw === m2.on[i]) { m3.n[i] = 0; return; }
  m3.n[i] = m3.n[i]! + 1;
  if (m3.n[i]! < TRIPWIRE.debounce) return;
  m3.n[i] = 0;
  m2.on[i] = raw;
  const eye = h.local(i, TRIPWIRE.eye);
  const edge = h.emit(raw ? 'Lit' : 'Unlit', i, eye, m2.val[i]!, st.lastEv[i] ?? -1);
  const mode = h.parts[i]!.props.mode ?? 0;
  if ((mode === 0 && raw === 0) || (mode === 1 && raw === 1)) {
    const id = h.emit('Trip', i, eye, mode, edge);
    st.lastEv[i] = id;
    st.pressed[i] = Math.round(0.2 * h.tickRate);
    h.pulse(i, 'out', id);
  }
}

function lampLit(c: PartChannels, i: number, on: boolean): void {
  const h = c.h, m2 = h.st.m2;
  const v = on ? 1 : 0;
  if (v !== m2.on[i]) { m2.on[i] = v; h.emit(on ? 'Lit' : 'Unlit', i, h.local(i, [0, 0.148, 0]), on ? h.st.supply[i]! : 0, h.st.lastEv[i] ?? -1); }
}

/** LANCE (M3): beam on while powered; Lit / Unlit on the edges. */
function emitterLit(c: PartChannels, i: number, on: boolean, at: readonly number[]): void {
  const h = c.h, m2 = h.st.m2;
  const v = on ? 1 : 0;
  if (v !== m2.on[i]) { m2.on[i] = v; m2.cause[i] = h.emit(on ? 'Lit' : 'Unlit', i, h.local(i, at), on ? 1 : 0, h.st.lastEv[i] ?? -1); }
}

function focusLit(c: PartChannels, i: number, on: boolean): void {
  const h = c.h, m2 = h.st.m2;
  const v = on ? 1 : 0;
  if (v !== m2.on[i]) { m2.on[i] = v; h.emit(on ? 'Lit' : 'Unlit', i, h.local(i, [0, 0.245, 0]), 0, h.st.lastEv[i] ?? -1); }
}
