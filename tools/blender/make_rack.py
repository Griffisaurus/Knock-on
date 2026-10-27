"""Procedurally build the RACK source file (docs/art/briefs/drive.md, "RACK: Rack and pinion").

Usage: blender -b --factory-startup -P tools/blender/make_rack.py -- [out.blend]
Default output: assets/src/drive/rack.blend

Built at the 1 m reference length (L = 1.0, footprint 10 x 1 x 1; origin = bottom centre of the guide block). A
pillowed graphite guide block (0.1 x 0.1 x 0.11 at x = 0) on four FOOT_S bumpers, with a slot along X for the bar
(kn_rubber lips at both mouths), 4 M3 heads on the front face, the PR-S spin axle port on a 1 mm land and a
kn_poly_clear top window (top z 0.110) over a pocket where the 10 T steel pinion (module 5 mm, pitch Ø 0.05,
centre z 0.075, tips to z 0.105) turns on PIVOT__pinion (axis y). The kn_anod_ignition bar (body z 0.016 ... 0.044,
pitch line z 0.050, tooth tops z 0.055) slides on PIVOT__bar (axis x, ±0.45 m): 61 `rack__tooth` pitches
(π x 5 mm, 12 tris each) centred, with kn_rubber end pads. Name plate and pinch-point pictogram on the block back.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'rack'
L = 1.0
P = math.pi * 0.005                       # tooth pitch 15.708 mm
NT = int((L - 0.03) // P)                 # 61
BZ0, BZ1, PITCH_Z, TIP_Z = 0.016, 0.04375, 0.050, 0.055
BAR_D = 0.030
BLK_W, BLK_D, BLK_H, FEET = 0.10, 0.10, 0.11, 0.003
PIN_Z, PIN_R, PIN_ROOT = 0.075, 0.030, 0.01875
PORT = (0.0, -0.051, PIN_Z)
G, STEEL, IGN, POLY, RUBBER = 'kn_powder_graphite', 'kn_steel_brushed', 'kn_anod_ignition', 'kn_poly_clear', 'kn_rubber'
MASTERS = [G, STEEL, IGN, POLY, RUBBER, 'kn_decal']


def gear_outline(n, r_out, r_root, lod=0):
    prof = ((0.0, r_root), (0.16, r_out * 0.97), (0.22, r_out), (0.42, r_out), (0.48, r_out * 0.97), (0.64, r_root))
    if lod >= 1:
        prof = ((0.0, r_root), (0.2, r_out), (0.44, r_out), (0.64, r_root))
    pts = []
    for i in range(n):
        a0, da = 2 * math.pi * i / n, 2 * math.pi / n
        for t, r in prof:
            a = a0 + da * t
            pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def build(lod, q, mats):
    cs = (2, 1, 1, 0)[lod]
    block = Kit()
    block.rbox((BLK_W, BLK_D, BLK_H - FEET), (0, 0, FEET + (BLK_H - FEET) / 2), 0.007 if lod < 3 else 0.0, G, cseg=cs,
               rz=0.006 if lod < 3 else 0.0)
    if lod < 3:
        cut = Kit()
        cut.rbox((BLK_W + 0.02, BAR_D + 0.004, TIP_Z - BZ0 + 0.006), (0, 0, (BZ0 + TIP_Z) / 2 + 0.001), 0.002, G,
                 cseg=1, rz=0.0)
        cut.rbox((0.074, 0.044, 0.06), (0, 0, PIN_Z + 0.02), 0.006 if lod < 2 else 0.0, G, cseg=max(1, cs - 1), rz=0.0)
        block = kit.boolean_diff(block, [cut], mats)
    _m2.land(block, 'S', PORT, (0, -1, 0), 0.001, lod)
    for x in (-0.037, 0.037):
        for z in (0.016, 0.095):
            _m2.screw(block, 'M3', (x, -BLK_D / 2, z), (0, -1, 0), min(1.0, q), lod)
    for x in (-0.036, 0.036):
        for y in (-0.036, 0.036):
            _m2.foot(block, 'S', x, y, min(1.0, q), lod if lod == 0 else lod + 1)
    lips = Kit()
    if lod < 2:  # rubber lips framing both slot mouths
        for sx in (-1, 1):
            o = kit.outline_rrect(BAR_D + 0.012, TIP_Z - BZ0 + 0.014, 0.004, max(1, cs - 1))
            i = kit.outline_rrect(BAR_D + 0.001, TIP_Z - BZ0 + 0.003, 0.0015, max(1, cs - 1))
            fr = Kit()
            fr.prism(o, -0.002, 0.0015, RUBBER, m=kit.at(sx * BLK_W / 2, 0, (BZ0 + TIP_Z) / 2 + 0.001) @
                     kit.frame(axis='x' if sx > 0 else '-x'))
            hole = Kit()
            hole.prism(i, -0.01, 0.01, RUBBER, m=kit.at(sx * BLK_W / 2, 0, (BZ0 + TIP_Z) / 2 + 0.001) @
                       kit.frame(axis='x' if sx > 0 else '-x'))
            lips.merge(kit.boolean_diff(fr, [hole], mats))
    win = Kit()
    win.rbox((0.080, 0.050, 0.002), (0, 0, BLK_H - 0.001), 0.005 if lod < 3 else 0.0, POLY,
             cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.0006 if lod < 2 else 0.0)
    pin = Kit(pivot='PIVOT__pinion')
    if lod < 3:
        pin.prism(gear_outline(10, PIN_R, PIN_ROOT, lod), -0.009, 0.009, STEEL, bt=0.0008 if lod < 2 else 0.0,
                  bb=0.0008 if lod < 2 else 0.0, bseg=1, m=kit.at(0, 0, PIN_Z) @ kit.frame(axis='-y'))
    else:
        pin.cyl(0.026, -0.009, 0.009, STEEL, 8, m=kit.at(0, 0, PIN_Z) @ kit.frame(axis='-y'))
    pin.cyl(0.006, -0.009, 0.042, STEEL, seg(16, q, 6), m=kit.at(0, 0, PIN_Z) @ kit.frame(axis='-y'))
    bar = Kit(pivot='PIVOT__bar')
    bar.rbox((L - 0.03, BAR_D, BZ1 - BZ0), (0, 0, (BZ0 + BZ1) / 2), 0.002 if lod < 3 else 0.0, IGN,
             cseg=1 if lod < 3 else 0, rz=0.0015 if lod < 3 else 0.0)
    if lod < 3:
        step = (1, 2, 4)[lod]
        x0 = -(NT - 1) * P / 2
        for i in range(0, NT, step):
            h = TIP_Z - BZ1
            hr = P * 0.30 * (1.0, 1.6, 2.8)[lod]
            ht = hr - h * math.tan(math.radians(20))
            x = x0 + i * P + P * (step - 1) / 2
            bar.prism([(x - hr, BZ1 - 0.0005), (x + hr, BZ1 - 0.0005), (x + ht, TIP_Z), (x - ht, TIP_Z)],
                      -BAR_D / 2, BAR_D / 2, IGN, m=kit.FRONT_OUT)
    else:
        bar.rbox((L - 0.03, BAR_D, TIP_Z - BZ1), (0, 0, (BZ1 + TIP_Z) / 2), 0.0, IGN, cseg=0, rz=0.0)
    for sx in (-1, 1):
        bar.rbox((0.015, BAR_D + 0.004, TIP_Z - BZ0 + 0.004), (sx * (L / 2 - 0.0075), 0, (BZ0 + TIP_Z) / 2),
                 0.004 if lod < 3 else 0.0, RUBBER, cseg=(2, 1, 1, 0)[lod], rz=0.003 if lod < 3 else 0.0)
    pieces = {'block': block, 'lips': lips, 'window': win, 'pinion': pin, 'bar': bar}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.rack.bone', (0, BLK_D / 2, 0.082), (0, 1, 0), (0, 0, 1), 0.056),
        kit.decal_plane('picto.pinch_point.mono', (0, BLK_D / 2, 0.030), (0, 1, 0), (0, 0, 1), 0.026, 0.026),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'S', '10,1,1', 1.9, 'bottom', 2900,
        'Rack and pinion at the 1 m reference: pillowed graphite guide block (0.1 x 0.1 x 0.11) on FOOT_S with a bar '
        'slot (rubber lips), 4 x M3 on the front, PR-S spin axle port on a 1 mm land, kn_poly_clear top window over the '
        '10 T steel pinion (PIVOT__pinion, y; module 5, pitch Ø 0.05, z 0.075, tips z 0.105). kn_anod_ignition bar on '
        'PIVOT__bar (x, ±0.45): 61 trapezoid teeth (pitch π·5 mm, 12 tris each; LOD2 draws every other one double '
        'width, LOD3 a flat strip) and rubber end pads. Name plate + pinch-point pictogram (mono) on the block back. '
        'Other lengths: the engine instances rack__tooth (deferred: one bar mesh at L = 1). kn_mass_hint = block 0.7 + '
        'bar 1.2. UV1 authored for the 1024² set (bake pending). Brief: docs/art/briefs/drive.md#rack.',
        MASTERS, skins='ignition,cobalt')
    part.pivot('bar', (0, 0, (BZ0 + TIP_Z) / 2), 'x', -(L - 0.1) / 2, (L - 0.1) / 2, motion='slide')
    part.pivot('pinion', (0, 0, PIN_Z), 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.0)
    part.col_box('block', (BLK_W, BLK_D, BLK_H), (0, 0, BLK_H / 2), phys='powder', restitution=0.2, friction=0.5)
    _m2.under(part, part.col_box('bar', (L - 0.03, BAR_D, TIP_Z - BZ0), (0, 0, (BZ0 + TIP_Z) / 2), phys='steel',
                                 restitution=0.2, friction=0.4), 'bar')
    for sx, nm in ((-1, 'pad_l'), (1, 'pad_r')):
        _m2.under(part, part.col_box(nm, (0.015, BAR_D + 0.004, TIP_Z - BZ0 + 0.004),
                                     (sx * (L / 2 - 0.0075), 0, (BZ0 + TIP_Z) / 2), phys='rubber', restitution=0.3,
                                     friction=0.8), 'bar')
    part.port('spin', 'pinion', PORT, (0, -1, 0), 'S', 'both', kind='axle')
    part.emit('jam', 'pinion', (0, 0, 0.050), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
