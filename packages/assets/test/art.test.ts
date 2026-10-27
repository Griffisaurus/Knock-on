import { describe, expect, it } from 'vitest';
import { AssetFormatError, parseArtJson, parseShapesJson, partAssetUrls } from '../src/index.ts';

// DATA_FORMATS §8.1 / §8.2 BANGSTICK example, in the exporter's field layout.
const ART = {
  type: 'bangstick', version: 4, class: 'M', family: 'boom', origin: 'com', footprint: [3, 1, 1],
  bounds: { min: [-0.143, -0.039, -0.05], max: [0.16, 0.061, 0.05] },
  ports: [
    { name: 'fuse', channel: 'heat', dir: 'in', size: 'S', pos: [0.14, 0.029, 0], dirVec: [1, 0, 0] },
    { name: 'detonator', channel: 'signal', dir: 'in', size: 'S', pos: [-0.14, 0, 0], dirVec: [-1, 0, 0], maxLinks: 1 },
  ],
  sensors: [],
  emitters: [{ name: 'fuse_tip', fx: 'spark', pos: [0.125, 0.058, -0.015], dirVec: [0, 1, 0] }],
  pivots: [], screens: [], cavities: [],
  ledGroups: [{ index: 0, name: 'ember' }],
  lods: [{ tris: 5400 }, { tris: 2700 }, { tris: 1350 }, { tris: 430 }],
  clips: [], skins: ['classic', 'candy'], massHint: 0.8,
  materials: ['kn_paper_red', 'kn_led'], hints: { kn_break_impulse: 0.3 },
};

const SHAPES = {
  type: 'bangstick',
  shapes: [{ name: 'stick_1', kind: 'capsule', pos: [0, -0.014, 0.025], rot: [0, 0, 0.7071, 0.7071], halfHeight: 0.115, radius: 0.025, phys: 'paper' }],
};

describe('art.json / shapes.json parsers', () => {
  it('parse the documented examples', () => {
    const art = parseArtJson(ART);
    expect(art.ports[1]).toMatchObject({ name: 'detonator', channel: 'signal', maxLinks: 1 });
    expect('maxLinks' in art.ports[0]!).toBe(false);
    expect(art.hints).toEqual({ kn_break_impulse: 0.3 });
    const shapes = parseShapesJson(SHAPES);
    expect(shapes.shapes[0]).toMatchObject({ kind: 'capsule', halfHeight: 0.115 });
  });

  it('reject bad data with a path to the field', () => {
    expect(() => parseArtJson({ ...ART, ports: [{ ...ART.ports[0], channel: 'magic' }] })).toThrow(/art\.ports\[0\]\.channel/);
    expect(() => parseArtJson({ ...ART, footprint: [3, 1] })).toThrow(AssetFormatError);
    expect(() => parseShapesJson({ type: 'x', shapes: [] })).toThrow(/at least one/);
    expect(() => parseShapesJson({ type: 'x', shapes: [{ ...SHAPES.shapes[0], kind: 'torus' }] })).toThrow(/kind/);
  });

  it('builds build-folder URLs', () => {
    expect(partAssetUrls('/assets/', 'thud')).toEqual({
      glb: '/assets/parts/thud/thud.glb', art: '/assets/parts/thud/thud.art.json', shapes: '/assets/parts/thud/thud.shapes.json',
    });
  });
});
