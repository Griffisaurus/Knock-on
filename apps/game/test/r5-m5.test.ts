// R5 (M5): the pure parts of the M5 rendering and the M4 render polish (docs/dev/M5_NOTES_R5.md).

import { describe, expect, it } from 'vitest';
import { roundness } from '../src/gfx/meshes.ts';
import { toastSlicesHidden } from '../src/scene.ts';
import { faceIconAt, type FaceArt } from '../src/gfx/critters.ts';
import { iconCode, screenVm, FACE_ICONS } from '../src/gfx/screens.ts';
import { ledCode, LED_MARK } from '../src/gfx/leds.ts';
import { pieceLayout, ARTICULATED, fingerOffset, gripOf } from '../src/gfx/resize.ts';
import { BakeStore } from '../src/bakestore.ts';
import { MAT_KIND } from '../src/gfx/meshes.ts';

describe('mesh roundness (the SDF stamp; the non-1-scale dark patches)', () => {
  it('a sphere is round, a box is square', () => {
    const sphere: number[] = [];
    for (let i = 0; i <= 24; i++) for (let j = 0; j < 48; j++) {
      const th = (i / 24) * Math.PI, ph = (j / 48) * Math.PI * 2;
      sphere.push(Math.sin(th) * Math.cos(ph) * 0.1, Math.cos(th) * 0.1, Math.sin(th) * Math.sin(ph) * 0.1);
    }
    expect(roundness(sphere, [0, 0, 0], [0.1, 0.1, 0.1])).toBeGreaterThan(0.97);
    const box: number[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) box.push(x * 0.2, y * 0.05, z * 0.1);
    expect(roundness(box, [0, 0, 0], [0.2, 0.05, 0.1])).toBeLessThan(0.02);
  });
});

describe('TOAST CANNON slices', () => {
  it('show at rest and while toasting, hide once launched slices are in play', () => {
    expect(toastSlicesHidden(0, false)).toBe(false);
    expect(toastSlicesHidden(16 | 1, true)).toBe(false); // armed: toasting a fresh pair
    expect(toastSlicesHidden(1, true)).toBe(true); // cooling after the pop
    expect(toastSlicesHidden(0, true)).toBe(true); // idle, slices out on the floor
  });
});

describe('LED icon faces', () => {
  const face: FaceArt = {
    screens: [], fps: 30,
    tracks: new Map([['idle', [[0, iconCode('neutral')], [40, iconCode('blink')], [43, iconCode('neutral')]]], ['startled', [[0, iconCode('surprised')], [20, iconCode('neutral')]]]]),
  };
  it('picks the clip key at the clip time, looping or held', () => {
    expect(faceIconAt(face, 'idle', 0, 3, false)).toBe(iconCode('neutral'));
    expect(faceIconAt(face, 'idle', 41 / 30, 3, false)).toBe(iconCode('blink'));
    expect(faceIconAt(face, 'idle', 3 + 41 / 30, 3, false)).toBe(iconCode('blink')); // looped
    expect(faceIconAt(face, 'startled', 5, 1, true)).toBe(iconCode('neutral')); // one-shot holds its end
    expect(faceIconAt(face, 'nope', 0, 1, false)).toBe(iconCode('neutral')); // unknown clip: idle's
  });
  it('an emote overrides the clip', () => {
    expect(faceIconAt(face, 'idle', 0, 3, false, 'zzz')).toBe(iconCode('sleepy'));
    expect(faceIconAt(face, 'idle', 0, 3, false, 'wave')).toBe(iconCode('neutral'));
  });
  it('codes are 1 + the FACE_ICONS index; icon screens bake their aspect and side', () => {
    expect(iconCode('strain')).toBe(FACE_ICONS.length);
    expect(screenVm({ name: 'eye_l', kind: 'icon', pos: [0, 0, 0], size: [0.026, 0, 0.012] })).toEqual([0.026 / 0.012 / 8, 1, 0, MAT_KIND.screen]);
    expect(screenVm({ name: 'eye_r', kind: 'icon', pos: [0, 0, 0], size: [0.026, 0, 0.012] })[2]).toBe(1);
    expect(screenVm({ name: 'face', kind: 'icon', pos: [0, 0, 0], size: [0.07, 0.025, 0] })[2]).toBe(0.5);
    expect(screenVm({ name: 'bin', kind: 'bar', pos: [0, 0, 0], size: [0.04, 0, 0.008], cells: 5 })).toEqual([5 / 255, 0, 0, MAT_KIND.screen]);
  });
});

describe('LED groups', () => {
  it('packs 2 bits per group into the instance byte', () => {
    expect(ledCode([3, 1, 0, 2])).toBe(3 | (1 << 2) | (2 << 6));
    expect(ledCode([9, -1])).toBe(3);
    expect(LED_MARK + 3).toBeLessThanOrEqual(255);
  });
});

describe('resizable and articulated art', () => {
  it('FORCE WALL pylons follow the width, columns stretch, caps ride the top', () => {
    const p = { width: 0.4, height: 0.3 };
    expect(pieceLayout('force_wall', 'force_wall__base_l', [-0.28, 0.02, 0], p).shift[0]).toBeCloseTo(0.1);
    expect(pieceLayout('force_wall', 'force_wall__base_r', [0.28, 0.02, 0], p).shift[0]).toBeCloseTo(-0.1);
    const col = pieceLayout('force_wall', 'force_wall__column_l', [-0.28, 0.2, 0], p);
    expect(col.scale[1]).toBeCloseTo((0.3 - 0.055) / (0.4 - 0.055));
    expect(0.04 * col.scale[1] + col.shift[1]).toBeCloseTo(0.04); // the foot stays put
    expect(pieceLayout('force_wall', 'force_wall__cap_r', [0.28, 0.39, 0], p).shift[1]).toBeCloseTo(-0.1);
  });
  it('STASIS FIELD nodes go to the corners, rails stretch along their length', () => {
    const p = { width: 1, height: 0.5, depth: 0.3 };
    expect(pieceLayout('stasis_field', 'stasis_field__node_fr', [0.23, 0.03, 0.23], p).shift).toEqual([0.25, 0, -0.1]);
    const front = pieceLayout('stasis_field', 'stasis_field__rail_front', [0, 0.004, 0.23], p);
    expect(front.scale[0]).toBeCloseTo((1 - 0.076) / (0.5 - 0.076));
    expect(front.shift[2]).toBeCloseTo(-0.1);
    const left = pieceLayout('stasis_field', 'stasis_field__rail_left', [-0.23, 0.004, 0], p);
    expect(left.scale[2]).toBeCloseTo((0.3 - 0.076) / (0.5 - 0.076));
    expect(left.shift[0]).toBeCloseTo(-0.25);
  });
  it('GRABBER links: three, joints up the arm at the park pose', () => {
    const g = ARTICULATED.grabber!;
    expect(g.links.length).toBe(3);
    expect(g.joints.map((j) => j[1])).toEqual([0.1, 0.27, 0.42]);
  });
  it('GRABBER fingers slide by the grip opening from Machine.grabberJoints, clamped to the art range', () => {
    // two GRABBERs: part 3 open at the 0.06 default grip, part 7 holding a 0.032 m item
    const joints = Float32Array.of(3, 0, 0, 0, 0, 0, 0.03, 0, 7, 0.5, 1, -0.4, 0.2, 0, 0.016, 1);
    const grip = gripOf(joints);
    expect(grip.get(3)!.open).toBeCloseTo(0.03);
    expect(grip.get(3)!.held).toBe(false);
    expect(grip.get(7)!.open).toBeCloseTo(0.016);
    expect(grip.get(7)!.held).toBe(true);
    // rest: the park pose the art is modelled in (−the wrist joint, no slide)
    fingerOffset('grabber', 0, 0.03).forEach((v, c) => expect(v).toBeCloseTo([0, -0.42, 0][c]!));
    // closing: finger_l (axis −X) moves +X, finger_r (+X) moves −X, both toward the middle
    expect(fingerOffset('grabber', 0, 0.016)[0]).toBeCloseTo(0.014);
    expect(fingerOffset('grabber', 1, 0.016)[0]).toBeCloseTo(-0.014);
    // past the art range: clamped to 0.01–0.04
    expect(fingerOffset('grabber', 1, 0.002)[0]).toBeCloseTo(-0.02);
    expect(fingerOffset('grabber', 1, 0.2)[0]).toBeCloseTo(0.01);
  });
});

describe('BakeStore carries GRABBER joints (R5 finger pivots)', () => {
  it('plays back Machine.grabberJoints at the playhead, keyframe by keyframe', () => {
    const N = 2, KF = 4;
    const st = (gj: number[]) => ({ f: new Uint8Array(N), m: new Uint8Array(N), l: new Float32Array(0), c: new Uint8Array(N * 4), k: new Int32Array(0), b: new Float32Array(0), mf: new Float32Array(0), mc: new Int32Array(0), gj: Float32Array.from(gj) });
    const open = [1, 0, 0, 0, 0, 0, 0.03, 0], shut = [1, 0, 0.8, -0.6, 0.3, 0, 0.012, 1];
    const s = new BakeStore(KF, { t: new Float32Array(N * 7), ...st(open) });
    const none = { idx: new Int32Array(0), xf: new Float32Array(0) };
    s.put(4, none, st(open));
    s.put(8, none, st(shut));
    expect(s.frame(4).gj![6]).toBeCloseTo(0.03);
    expect(s.frame(7).gj![6]).toBeCloseTo(0.012); // past halfway to the next keyframe: its state
    expect(s.frame(8).gj![7]).toBe(1);
    expect(s.frame(0).gj![6]).toBeCloseTo(0.03);
  });
});
