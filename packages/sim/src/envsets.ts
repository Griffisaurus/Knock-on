// W5 (M5): ORBITAL HANGAR and MOON BASE in the sim (environments.md §5, §6; M5_PLAN contract 4).
//   - the sets' static colliders (parts-data env_space.ts: E5c's generated data, or W5's stand-ins until it lands), built
//     by Machine.buildSet with the environment-ground materials `concrete` and `regolith` (SIMULATION §4.3);
//   - the Moon's fixed, authored regolith heightfield: one static Jolt HeightFieldShape per 32 m chunk, like the Backlot's
//     (terrain.ts), with no-collision holes under the concrete apron so nothing sits on two coplanar surfaces;
//   - the Hangar's zero-g zones (`env.zones`): ZONE-style Antigrav fields on rigid bodies, end of stage 6. They add a force
//     each tick from plain state (body positions), so rollback needs nothing extra (M5 rule 14);
//   - D26's global wind (`env.wind`, SIMULATION §5.8): a world-wide air-flow term on rigid bodies, same drag model as ZONE's Wind.

import { dcos, dsin, f32 } from '@knockon/detmath';
import { TERRAIN_CHUNK, TERRAIN_SPACING, windSpeedAt, type EnvWind } from '@knockon/format';
import type { JoltModule } from '@knockon/jolt';
import {
  HANGAR_SET, MOON_SET, moonField, spacePreset, type SpaceBox, type SpaceHull, type SpaceSphere, type SpaceTerrain, type SpaceZone,
} from '@knockon/parts-data';
import type { PartChannels } from './channels/index.ts';
import { areaOf, eachPushable } from './channels/m3.ts';
import { douseFlamer } from './channels/m3_boom.ts';
import { turbineGlobalWind } from './channels/air.ts';

/** `regolith` (SIMULATION §4.3, environments.md §6.2). */
const REGOLITH = { friction: 0.8, restitution: 0.05 } as const;
/** HeightFieldShapeConstants::cNoCollisionValue (FLT_MAX): a hole sample. */
const HOLE = 3.4028234663852886e38;

export interface SpaceSetPlan {
  readonly set: { readonly boxes: readonly SpaceBox[]; readonly spheres: readonly SpaceSphere[]; readonly hulls: readonly SpaceHull[] };
  readonly zones: readonly SpaceZone[];
  /** Moon: the regolith heightfield. */
  readonly field: SpaceTerrain | null;
  /** Footprints (x0, z0, x1, z1) of the apron slabs (concrete boxes whose top is at y = 0): the heightfield has holes there. */
  readonly holes: readonly (readonly [number, number, number, number])[];
  /** Top of the sim's catch-all floor box: below the set, so the deck or the regolith is the only surface. */
  readonly floorTop: number;
}

/** The Hangar or Moon plan for a preset (presets the set isn't built for use its first), or null for other environments. */
export function spaceSetPlan(environment: string | undefined, preset: string | undefined): SpaceSetPlan | null {
  const env = environment === 'hangar' ? HANGAR_SET : environment === 'moon' ? MOON_SET : null;
  if (!env) return null;
  const own = spacePreset(env, preset);
  const name = own ? preset! : (Object.keys(env.presets)[0] ?? 'room');
  const p = own ?? spacePreset(env, name)!;
  const field = env.env === 'moon' ? moonField(name) : null;
  const holes = field ? p.boxes.filter((b) => b.phys === 'concrete' && Math.abs(b.center[1] + b.half[1]) < 0.01)
    .map((b) => [b.center[0] - b.half[0], b.center[2] - b.half[2], b.center[0] + b.half[0], b.center[2] + b.half[2]] as const) : [];
  return { set: { boxes: p.boxes, spheres: p.spheres, hulls: p.hulls ?? [] }, zones: p.zones ?? [], field, holes, floorTop: -1 };
}

/**
 * Adds the Moon field's static bodies (one per 32 m chunk, chunk-row order) and returns how many it made. A sample whose
 * four surrounding quads lie under the apron's slabs is a hole, so every quad Jolt removes around it is covered.
 */
export function buildSpaceTerrain(J: JoltModule, bi: JoltModule, t: SpaceTerrain, holes: SpaceSetPlan['holes'], layer: number): number {
  const cx = Math.ceil((t.nx - 1) / TERRAIN_CHUNK), cz = Math.ceil((t.nz - 1) / TERRAIN_CHUNK);
  const n = TERRAIN_CHUNK + 1;
  const buf = new Float32Array(n * n);
  const scale = t.maxHeight / 65535, s1 = TERRAIN_SPACING;
  // a sample is a hole when the four quads around it lie under the apron's slabs (E5c's apron is a stack of 4 m strips,
  // so test the square's four corners against the union; each strip is a rectangle, so the corners decide it)
  const under = (x: number, z: number): boolean => holes.some((h) => x >= h[0] && x <= h[2] && z >= h[1] && z <= h[3]);
  const hole = (x: number, z: number): boolean => under(x - s1, z - s1) && under(x + s1, z - s1) && under(x - s1, z + s1) && under(x + s1, z + s1);
  let made = 0;
  for (let jz = 0; jz < cz; jz++) {
    for (let jx = 0; jx < cx; jx++) {
      const x0 = jx * TERRAIN_CHUNK, z0 = jz * TERRAIN_CHUNK;
      for (let z = 0; z < n; z++) {
        const sz = Math.min(t.nz - 1, z0 + z);
        for (let x = 0; x < n; x++) {
          const sx = Math.min(t.nx - 1, x0 + x);
          buf[z * n + x] = hole(t.origin[0] + sx * s1, t.origin[1] + sz * s1) ? HOLE : t.heights[sz * t.nx + sx]! * scale;
        }
      }
      const s = new J.HeightFieldShapeSettings();
      s.mSampleCount = n;
      s.mBlockSize = 4;
      s.mBitsPerSample = 8;
      s.mOffset = new J.Vec3(f32(t.origin[0] + x0 * s1), 0, f32(t.origin[1] + z0 * s1));
      s.mScale = new J.Vec3(f32(s1), 1, f32(s1));
      const arr = s.mHeightSamples;
      arr.resize(n * n);
      J.HEAPF32.set(buf, J.getPointer(arr.data()) >> 2);
      const res = s.Create();
      J.destroy(s);
      if (!res.IsValid()) continue; // a chunk that is all holes (under the apron) has no shape
      const bcs = new J.BodyCreationSettings(res.Get(), new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, layer);
      bcs.mFriction = f32(REGOLITH.friction);
      bcs.mRestitution = f32(REGOLITH.restitution);
      bcs.mUserData = 0x7fffffff;
      const body = bi.CreateBody(bcs);
      J.destroy(bcs);
      bi.AddBody(body.GetID(), J.EActivation_DontActivate);
      made++;
    }
  }
  return made;
}

/**
 * Bodies an M5 field already cancels gravity for this tick (A5, channels/m5_field.ts: the TRACTOR BEAM's captured set and,
 * with `tractor`, the STASIS FIELD's frozen set; both updated by the fields earlier in stage 6), or null without M5 parts.
 * The zero-g zones skip them (else a held / frozen body gets +1 g up), and wind skips frozen bodies.
 */
function m5Held(c: PartChannels, tractor: boolean): Set<number> | null {
  const s5 = c.h.st.m2.m5;
  if (!s5) return null;
  const out = new Set<number>();
  for (const t of tractor ? ['tractor_beam', 'stasis_field'] : ['stasis_field']) for (const i of c.list(t)) for (const k of s5.inside[i] ?? []) out.add(k);
  return out;
}

/** Is world point (x, y, z) inside zero-g zone `zn`? */
export function inZone(zn: SpaceZone, x: number, y: number, z: number): boolean {
  if (zn.shape === 'box') return x >= zn.box.min[0] && x <= zn.box.max[0] && y >= zn.box.min[1] && y <= zn.box.max[1] && z >= zn.box.min[2] && z <= zn.box.max[2];
  const dx = x - zn.center[0], dz = z - zn.center[2], dy = y - zn.center[1];
  return dy >= -zn.halfHeight && dy <= zn.halfHeight && dx * dx + dz * dz <= zn.radius * zn.radius;
}

/**
 * Zero-g zones (end of stage 6, after the ZONE parts): every awake, pushable rigid body whose centre of mass is inside a
 * zone gets m·g·gravityFactor·(1 − gravityPercent / 100) up, so it feels the zone's gravity (0 % = weightless; the first
 * zone that holds it counts). Sleeping bodies stay asleep; critters are skipped, as ZONE does. `g` = the world's gravity.
 */
export function zeroGZones(c: PartChannels, zones: readonly SpaceZone[], g: number): void {
  if (!zones.length || g === 0) return;
  const h = c.h, J = h.Jolt;
  const held = m5Held(c, true);
  eachPushable(c, (pb) => {
    if (held?.has(pb.body)) return; // A5's TRACTOR BEAM / STASIS FIELD already cancel its gravity this tick
    const b = h.bodies[pb.body]!.body;
    if (!b.IsActive()) return;
    const com = b.GetCenterOfMassPosition();
    const x = com.GetX(), y = com.GetY(), z = com.GetZ();
    let zn: SpaceZone | null = null;
    for (const q of zones) if (inZone(q, x, y, z)) { zn = q; break; }
    if (!zn) return;
    const mp = b.GetMotionProperties();
    const inv = mp.GetInverseMass(), gf = mp.GetGravityFactor(); // the body's own factor (0 for gravity-free pieces and flyers)
    if (inv <= 0 || gf === 0) return;
    h.bi.AddForce(b.GetID(), h.v3(0, (g * gf * (1 - zn.gravityPercent / 100)) / inv, 0), J.EActivation_DontActivate);
  });
}

// ---- W5 (M5, D26): global wind (SIMULATION §5.8) -----------------------------------------------------------------------

export interface WindRun {
  /** Unit direction it blows toward (horizontal). */
  readonly dir: readonly [number, number, number];
  readonly setting: EnvWind;
  readonly seed: number;
}

/** The run's wind, or null when there is none (no setting, zero speed without gusts, or no air). */
export function windRun(w: EnvWind | null | undefined, air: number, seed: readonly [number, number]): WindRun | null {
  if (!w || air <= 0 || !(w.speed > 0 || (w.gusts && w.gusts !== 'none'))) return null;
  const a = (w.dir * Math.PI) / 180;
  return { dir: [dcos(a), 0, -dsin(a)], setting: w, seed: (seed[0] ^ seed[1]) | 0 };
}

/**
 * The global air-flow term (end of stage 6): every awake pushable rigid body gets F = ρ·A·w² along the wind (ρ = 1.225 ×
 * air, A = its projected area by the GALE's rule, at most 40 m/s² of acceleration, as ZONE's Wind); once a second (tick %
 * tickRate = 0) a sleeping body is woken when that force exceeds 0.2 × its weight. Above 4 m/s it blows out lit WICKs and
 * douses FLAMERs (§5.7), as a Wind ZONE does. Critters are skipped (their own spec). Returns the speed used (m/s).
 */
export function globalWind(c: PartChannels, wr: WindRun, tick: number, g: number): number {
  const h = c.h, J = h.Jolt, st = h.st;
  const w = windSpeedAt(wr.setting, tick / h.tickRate, wr.seed);
  if (w <= 0) return 0;
  const q = 1.225 * h.air * w * w;
  const wake = tick % h.tickRate === 0;
  const frozen = m5Held(c, false); // A5's STASIS FIELD holds its bodies still: no wind on them
  eachPushable(c, (pb) => {
    if (frozen?.has(pb.body)) return;
    // PARTSIM (D120): an intact TURBINE's rotor is turned by its pitched blades, not pushed as plain drag
    const p = h.parts[pb.part]!;
    if (pb.body === p.arm && p.def.type === 'turbine' && !st.broken[pb.part]) { turbineGlobalWind(c, pb.part, wr.dir, w, wake); return; }
    const b = h.bodies[pb.body]!.body;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0) return;
    const m = 1 / inv;
    const F = Math.min(q * areaOf(pb.def), 40 * m);
    if (!b.IsActive()) {
      if (!wake || F <= 0.2 * m * g) return;
      h.bi.ActivateBody(b.GetID());
    }
    h.bi.AddForce(b.GetID(), h.v3(wr.dir[0] * F, 0, wr.dir[2] * F), J.EActivation_DontActivate);
  });
  if (w > 4) {
    for (let k = 0; k < h.parts.length; k++) {
      if (!st.alive[k]) continue;
      const t = h.parts[k]!.def.type;
      if (t === 'wick' && st.lit[k]) { st.lit[k] = false; h.emit('Extinguish', k, h.local(k, [0, 0.19, 0]), 0, -1); }
      if (t === 'flamer') douseFlamer(c, k, w, -1);
    }
  }
  return w;
}
