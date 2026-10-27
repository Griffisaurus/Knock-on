// R4 (M4): the container fill pass's CPU geometry (level plane by exact volume, LUT cavities) and the container
// profile logic. The GPU passes are checked in Chrome (docs/dev/M4_NOTES_R4.md).
import { describe, expect, it } from 'vitest';
import { cavityFromArtMesh, cavityFromLut, loft, meshVolume } from '../src/gfx/matter/fill.ts';
import { ContainerFills } from '../src/gfx/matter/containers.ts';
import { LIST, ARGS_SOLID, CTL, LISTS } from '../src/gfx/matter/wgsl.ts';

describe('fill pass geometry', () => {
  const cyl = loft([{ y: 0, rx: 0.1, rz: 0.1 }, { y: 0.3, rx: 0.1, rz: 0.1 }], false, 64);
  const exact = Math.PI * 0.01 * 0.3 * (64 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 64); // inscribed 64-gon prism

  it('measures a closed loft (outward, positive volume)', () => {
    expect(meshVolume(cyl.positions, cyl.indices, Infinity, null)).toBeCloseTo(exact, 6);
  });

  it('measures the volume under a world plane', () => {
    expect(meshVolume(cyl.positions, cyl.indices, 0.15, null)).toBeCloseTo(exact / 2, 6);
    expect(meshVolume(cyl.positions, cyl.indices, -1, null)).toBe(0);
    expect(meshVolume(cyl.positions, cyl.indices, 0.3, null)).toBeCloseTo(exact, 6);
  });

  it('keeps the volume when the cavity tilts (plane stays level)', () => {
    const a = 0.4, c = Math.cos(a), s = Math.sin(a);
    const rot = (i: number): [number, number, number] => {
      const x = cyl.positions[i * 3]!, y = cyl.positions[i * 3 + 1]!, z = cyl.positions[i * 3 + 2]!;
      return [x * c - y * s, x * s + y * c, z];
    };
    expect(meshVolume(cyl.positions, cyl.indices, Infinity, rot)).toBeCloseTo(exact, 6);
    // a tilted half-full cylinder: the level through its centre still holds half (point symmetry)
    const centreY = 0.15 * c;
    expect(meshVolume(cyl.positions, cyl.indices, centreY, rot)).toBeCloseTo(exact / 2, 5);
  });

  it('rebuilds a cavity from an art LUT with the art volume', () => {
    // a cone-ish funnel: area grows with height
    const V = 2; // litres
    const lut = Array.from({ length: 64 }, (_, i) => 0.05 + 0.2 * Math.sqrt(i / 63));
    const cav = cavityFromLut({ name: 'sand', matter: 'sand', lut, volume: V, min: [-0.1, 0.05, -0.1], max: [0.1, 0.25, 0.1] }, false)!;
    expect(cav).not.toBeNull();
    const vol = meshVolume(cav.positions, cav.indices, Infinity, null) * 1000;
    expect(vol).toBeGreaterThan(V * 0.85);
    expect(vol).toBeLessThan(V * 1.15);
  });

  it('accepts E4a cavity meshes and fixes their winding', () => {
    const inv = { vertices: [...cyl.positions], indices: [...cyl.indices].map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]!]!) };
    const cav = cavityFromArtMesh({ name: 'water', matter: 'water', mesh: inv })!;
    expect(meshVolume(cav.positions, cav.indices, Infinity, null)).toBeCloseTo(exact, 6);
    expect(cav.matter).toBe('water');
  });
});

describe('container profiles', () => {
  it('craters while draining, piles while filling, flat at rest', () => {
    const cf = new ContainerFills();
    const parts = [{ id: 1, type: 'grit_hopper' }];
    const pose = () => ({ pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0, 1] as const });
    let f = 0.8;
    const items = (t: number) => cf.items(parts, pose, () => f, () => false, t);
    expect(items(0)[0]!.profile).toBe('flat');
    f = 0.7;
    expect(items(16)[0]!.profile).toBe('crater');
    f = 0.75;
    expect(items(32)[0]!.profile).toBe('pile');
    expect(items(2000)[0]!.profile).toBe('flat');
  });

  it('skips broken containers and unknown types', () => {
    const cf = new ContainerFills();
    const pose = () => ({ pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0, 1] as const });
    expect(cf.items([{ id: 1, type: 'fishbowl' }, { id: 2, type: 'boing' }], pose, () => null, (id) => id === 1)).toHaveLength(0);
    expect(cf.items([{ id: 1, type: 'fishbowl' }], pose, () => null, () => false)[0]!.fill).toBeCloseTo(0.82);
  });
});

describe('draw-list layout', () => {
  it('keeps the quad camera lists contiguous for the prepass draw', () => {
    expect(LIST.near).toBe(LIST.sandFar + 1);
    expect(LIST.marbleMesh).toBe(LIST.near + 1);
    expect(ARGS_SOLID).toBeGreaterThanOrEqual(LISTS);
    expect(CTL.args + (ARGS_SOLID + 1) * 5).toBeLessThanOrEqual(CTL.words);
    expect(LISTS).toBeLessThanOrEqual(8); // the workgroup counters
  });
});
