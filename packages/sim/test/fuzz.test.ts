// Property fuzz (PART_SYSTEM §8): for every part with properties, random property sets within range
// (deterministic PRNG), each run in a small scene that exercises the part: no exceptions, no NaN
// positions, no body faster than 60 m/s.

import { describe, expect, it } from 'vitest';
import { Rng, hashString32 } from '@knockon/detmath';
import { snappedEuler } from '@knockon/format';
import { PARTS, cogSize, type PartDef, type Props } from '@knockon/parts-data';
import { Machine } from '../src/index.ts';
import { Build, jolt } from './harness.ts';
import { M2_SCENES } from './fuzz_scenes_m2.ts';
import { M3_SCENES } from './fuzz_scenes_m3.ts';
import { M4_SCENES } from './fuzz_scenes_m4.ts'; // A4
import { B4_SCENES } from './fuzz_scenes_b4.ts'; // B4: the M4 critters
import { B5_SCENES } from './fuzz_scenes_b5.ts'; // B5: BUZZ
import { M5_SCENES } from './fuzz_scenes_m5.ts'; // A5: the M5 parts
import { X5_SCENES } from './fuzz_scenes_x5.ts'; // X5: GOO VAT

const SETS = 20;
const SEEDS = [1, 2] as const;
const TICKS = 240;
const MAX_SPEED = 60;

/** A random value for every property of a part, within its range and on its step grid. */
function randomProps(def: PartDef, rng: Rng): Props {
  const out: Record<string, number> = {};
  for (const [k, spec] of Object.entries(def.props)) {
    if (spec.type === 'enum') out[k] = rng.nextInt(spec.values!.length);
    else if (spec.type === 'bool') out[k] = rng.nextInt(2);
    else {
      const step = spec.step ?? 1, lo = spec.min ?? 0, hi = spec.max ?? lo;
      const first = Math.ceil(lo / step - 1e-9), last = Math.floor(hi / step + 1e-9);
      out[k] = (first + rng.nextInt(last - first + 1)) * step;
    }
  }
  return out;
}

/** Small scenes, one per part with properties, built around the part under test (props `p`). */
const SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  slope: (b, p) => {
    b.add('slope', 0, 0, 0, p);
    b.add('boing', 0, 1.0, 0);
    b.add('thud', -0.1, 1.4, 0.02);
  },
  brik: (b, p) => {
    for (let row = 0; row < 3; row++) for (const x of row % 2 ? [-0.1, 0.1] : [-0.2, 0, 0.2]) b.add('brik', x, 0.05 + row * 0.1, 0, p);
    b.add('thud', 0.18, 1.2, 0.03);
    const stick = b.add('bangstick', 0, 0.039, 0.4, { fuse: 1 });
    const wick = b.add('wick', 0.3, 0, 0.5);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
  cog: (b, p) => {
    // the part under test, driven by a motor, meshed with a COG M (L → S is a known blow-up below)
    const mains = b.add('mains', -0.8, 0, 0);
    const motor = b.add('motor', -0.4, 0, 0);
    const c1 = b.add('cog', 0.2, 0.45, 0, p);
    const other = { size: 1 };
    b.add('cog', 0.2 + (cogSize(p).pitch + cogSize(other).pitch) / 2, 0.45, 0, other);
    b.add('helio', 0.2, 0.1, 0.0);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', c1, 'axle');
  },
  motor: (b, p) => {
    // one motor per driven part (a motor banded to both a COG and a TREADWAY is a known blow-up)
    const mains = b.add('mains', -0.5, 0, 0);
    const m1 = b.add('motor', 0, 0, 0, p);
    const m2 = b.add('motor', -0.5, 0, 0.5, p);
    const cog = b.add('cog', 0.5, 0.4, 0, { size: 2 });
    const belt = b.add('treadway', 0.2, 0, 0.5);
    b.add('brik', 0.2, 0.15, 0.5);
    b.link('cable_power', mains, 'out', m1, 'in');
    b.link('cable_power', mains, 'out', m2, 'in');
    b.link('band', m1, 'out', cog, 'axle');
    b.link('band', m2, 'out', belt, 'drive_l');
  },
  mains: (b, p) => {
    const mains = b.add('mains', -0.5, 0, 0, p);
    const fan = b.add('gale', 0, 0, 0);
    const motor = b.add('motor', -0.5, 0, -0.5);
    b.add('boing', 0, 0.12, 0.5);
    const button = b.add('the_button', -0.9, 0, 0);
    b.add('thud', -0.9, 0.4, 0);
    b.link('cable_power', mains, 'out', fan, 'in');
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('cable_signal', button, 'out', mains, 'in');
  },
  stomp_pad: (b, p) => {
    const pad = b.add('stomp_pad', 0, 0, 0, p);
    b.add('boing', 0, 0.3, 0);
    b.add('thud', 0.02, 0.9, 0);
    const stick = b.add('bangstick', 0, 0.039, 0.6);
    b.add('brik', 0.3, 0.05, 0.6);
    b.link('cable_signal', pad, 'out', stick, 'detonator');
  },
  wick: (b, p) => {
    const wick = b.add('wick', 0, 0, 0, p);
    const stick = b.add('bangstick', -0.14, 0.039, 0.2, { fuse: 0.5 });
    b.add('plank', 0.3, 0.05, 0, {}, snappedEuler(0, 0, 0));
    b.add('helio', 0.1, 0.5, -0.3);
    b.link('fuse', wick, 'flame', stick, 'fuse');
  },
  bangstick: (b, p) => {
    const wick = b.add('wick', 0, 0, 0);
    const s1 = b.add('bangstick', -0.14, 0.039, 0.2, p);
    b.add('bangstick', -0.14, 0.039, 0.6, p);
    for (const x of [-0.3, -0.1, 0.1]) b.add('brik', x, 0.05, 0.9);
    b.add('helio', 0.3, 0.4, 0.3);
    b.add('topple_tile', 0.4, 0.075, 0);
    b.link('fuse', wick, 'flame', s1, 'fuse');
  },
  ...M2_SCENES,
  ...M3_SCENES,
  ...M4_SCENES, // A4
  ...B4_SCENES, // B4
  ...B5_SCENES, // B5
  ...M5_SCENES, // A5
  ...X5_SCENES, // X5
};

/** Steps the machine, checking every body every tick. Returns the first problem, or null. */
function check(m: Machine, ticks: number): string | null {
  for (let t = 1; t <= ticks; t++) {
    m.step();
    m.drainEvents();
    for (let i = 0; i < m.bodies.length; i++) {
      const body = m.bodies[i]!.body;
      const p = body.GetPosition();
      const px = p.GetX(), py = p.GetY(), pz = p.GetZ();
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return `tick ${t}: body ${i} position not finite`;
      const v = body.GetLinearVelocity();
      const s = Math.hypot(v.GetX(), v.GetY(), v.GetZ());
      if (!(s <= MAX_SPEED)) return `tick ${t}: body ${i} (${m.bodyInfo()[i]!.type}) at ${s.toFixed(1)} m/s`;
    }
  }
  return null;
}

describe('property fuzz (PART_SYSTEM §8)', () => {
  const withProps = PARTS.filter((d) => Object.keys(d.props).length > 0);

  it('has a scene for every part with properties', () => {
    // M2 parts without properties have a scene too (run once per seed below)
    expect(withProps.map((d) => d.type).filter((t) => !SCENES[t])).toEqual([]);
  });

  // M2 and M3 parts without properties (streams A, A3): their scene, once per seed
  const NO_PROPS: Readonly<Record<string, (b: Build, p: Props) => void>> = { ...M2_SCENES, ...M3_SCENES, ...M4_SCENES, ...B4_SCENES, ...M5_SCENES }; // A4: M4 too; B4: BISCUIT; A5: HOVER PAD, SINGULARITY
  for (const type of Object.keys(NO_PROPS).filter((t) => !withProps.some((d) => d.type === t))) {
    it(`${type}: its scene stays finite and under ${MAX_SPEED} m/s`, async () => {
      const J = await jolt();
      const b = new Build();
      NO_PROPS[type]!(b, {});
      const m = new Machine(J, b);
      let problem: string | null;
      try { problem = check(m, TICKS * 2); } finally { m.destroy(); }
      expect(problem, type).toBeNull();
    }, 120_000);
  }

  for (const def of withProps) {
    it(`${def.type}: ${SETS} property sets × ${SEEDS.length} seeds stay finite and under ${MAX_SPEED} m/s`, async () => {
      const J = await jolt();
      const scene = SCENES[def.type];
      expect(scene, `no fuzz scene for ${def.type}`).toBeDefined();
      for (const seed of SEEDS) {
        const rng = new Rng(seed, hashString32(def.type));
        for (let k = 0; k < SETS; k++) {
          const props = randomProps(def, rng);
          for (const [key, spec] of Object.entries(def.props)) {
            const v = props[key]!;
            if (spec.min !== undefined) expect(v).toBeGreaterThanOrEqual(spec.min - 1e-9);
            if (spec.max !== undefined) expect(v).toBeLessThanOrEqual(spec.max + 1e-9);
          }
          const b = new Build();
          scene!(b, props);
          let problem: string | null;
          const m = new Machine(J, b);
          try {
            problem = check(m, TICKS);
          } finally {
            m.destroy();
          }
          expect(problem, `${def.type} seed ${seed} set ${k} ${JSON.stringify(props)}`).toBeNull();
        }
      }
    }, 120_000);
  }
});

// Blow-ups the fuzz once found (gear ratios < 1, belts as negative ratios, off-axis rotors): regression guards.
describe('drive-train stability regressions (found by fuzz, fixed)', () => {
  const runs = async (build: (b: Build) => void): Promise<string | null> => {
    const b = new Build();
    build(b);
    const m = new Machine(await jolt(), b);
    try { return check(m, TICKS * 1.5); } finally { m.destroy(); }
  };

  it('MOTOR → BAND → COG L meshed with a COG S stays finite', async () => {
    // observed: angular velocities go NaN (bodies at the 500 m/s cap) within ~14 ticks
    expect(await runs((b) => {
      const mains = b.add('mains', -0.8, 0, 0);
      const motor = b.add('motor', -0.4, 0, 0);
      const big = b.add('cog', 0.2, 0.45, 0, { size: 2 });
      b.add('cog', 0.4, 0.45, 0, { size: 0 });
      b.link('cable_power', mains, 'out', motor, 'in');
      b.link('band', motor, 'out', big, 'axle');
    })).toBeNull();
  });

  it('one MOTOR with BANDs to a COG and a TREADWAY stays under 60 m/s', async () => {
    // observed: the motor shaft reaches the 500 m/s cap after ≈ 2.4 s
    expect(await runs((b) => {
      const mains = b.add('mains', -0.5, 0, 0);
      const motor = b.add('motor', 0, 0, 0);
      const cog = b.add('cog', 0.5, 0.4, 0, { size: 2 });
      const belt = b.add('treadway', 0.2, 0, 0.5);
      b.link('cable_power', mains, 'out', motor, 'in');
      b.link('band', motor, 'out', cog, 'axle');
      b.link('band', motor, 'out', belt, 'drive_l');
    })).toBeNull();
  });
});
