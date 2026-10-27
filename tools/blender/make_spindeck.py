"""Procedurally build the SPINDECK source file (docs/art/briefs/frame.md, "SPINDECK: Turntable").

Usage: blender -b --factory-startup -P tools/blender/make_spindeck.py -- [out.blend]
Default output: assets/src/frame/spindeck.blend

A low turntable (⌀4 x 1, origin on the rotation axis at floor level): a Bone drum (⌀0.36, z 0.005 ... 0.065) on four
5 mm FOOT_L bumpers with a 0.14 m flat front facet (chord at y -0.166) carrying the PR-M spin in ring (right,
x 0.035) and a 0.05 m kn_poly_clear window (left, x -0.035) onto the bevel pair: a steel bevel pinion on
PIVOT__pinion (axis y) biting a crown ring under the platter. PIVOT__platter (axis z) carries the kn_anod_cobalt
platter (⌀0.40 x 0.02, z 0.07 ... 0.09), the kn_rubber_grip mat (⌀0.36 x 0.008), the steel hub cap with 4 M5 heads,
the raised Bone index wedge on the rim and Bone tick decals every 30°. The top stays flat and clear.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import decal_atlas, kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'spindeck'
DR, DZ0, DZ1, FLAT_Y = 0.18, 0.005, 0.065, -0.166
PR, PZ0, PZ1 = 0.20, 0.07, 0.09
MR, MZ1 = 0.18, 0.098
PORT = (0.035, FLAT_Y, 0.035)
WIN_X, WIN_W, WIN_H, WIN_Z = -0.035, 0.05, 0.034, 0.035
PIN = (-0.035, -0.128, 0.035)
BONE, COBALT, GRIP, STEEL, POLY, RUBBER = (
    'kn_powder_bone', 'kn_anod_cobalt', 'kn_rubber_grip', 'kn_steel_brushed', 'kn_poly_clear', 'kn_rubber')
MASTERS = [BONE, COBALT, GRIP, STEEL, POLY, RUBBER, 'kn_decal']


def gear_outline(n, r_out, r_root, frac=0.45):
    pts = []
    for i in range(n):
        a0 = 2 * math.pi * i / n
        da = 2 * math.pi / n
        for t, r in ((0.0, r_root), (0.12, r_out), (0.12 + frac, r_out), (0.24 + frac, r_root)):
            a = a0 + da * t
            pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    base = Kit()
    n = seg(120, q, 16)
    base.prism(kit.outline_circle_flat(DR, n, FLAT_Y), DZ0, DZ1, BONE, bt=0.004 if lod < 3 else 0.0,
               bb=0.002 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod])
    if lod < 3:  # window pocket onto the bevel pair
        pk = Kit()
        pk.prism(kit.outline_rrect(WIN_W - 0.006, WIN_H - 0.006, 0.002, max(1, cs)), 0.0, 0.08, BONE,
                 m=kit.at(WIN_X, FLAT_Y + 0.07, WIN_Z) @ kit.FRONT_OUT)
        base = kit.boolean_diff(base, [pk], mats)
    for i in range(4):
        a = math.pi / 4 + math.pi / 2 * i
        _m2.foot(base, 'L', 0.13 * math.cos(a), 0.13 * math.sin(a), min(1.0, q), lod)
    win = Kit()
    win.rbox((WIN_W, 0.002, WIN_H), (WIN_X, FLAT_Y - 0.0005, WIN_Z), 0.003 if lod < 3 else 0.0, POLY,
             cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.0006 if lod < 2 else 0.0)
    # input bevel pinion (seen through the window)
    pin = Kit(pivot='PIVOT__pinion')
    if lod < 3:
        nt = (12, 10, 8)[lod]
        pin.prism(gear_outline(nt, 0.012, 0.0095), -0.006, 0.006, STEEL, m=kit.at(*PIN) @ kit.frame(axis='y'))
        pin.cyl(0.004, -0.04, 0.0, STEEL, seg(10, q, 6), m=kit.at(*PIN) @ kit.frame(axis='-y'))
    # platter: Cobalt disc + grip mat + hub cap + M5 + index wedge + crown ring underneath
    plat = Kit(pivot='PIVOT__platter')
    np_ = seg(80, q, 12)
    plat.cyl(PR, PZ0, PZ1, COBALT, np_, bev=0.004 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
             bev_bot=0.002 if lod < 3 else 0.0)
    plat.cyl(MR, PZ1 - 0.0005, MZ1, GRIP, np_, bev=0.002 if lod < 3 else 0.0, bseg=(2, 1, 1, 1)[lod], bev_bot=0.0)
    plat.cyl(0.025, MZ1 - 0.0005, MZ1 + 0.002, STEEL, seg(32, q, 8), bev=0.0015 if lod < 3 else 0.0, bseg=2)
    for i in range(4):
        a = math.pi / 4 + math.pi / 2 * i
        _m2.screw(plat, 'M5', (0.016 * math.cos(a), 0.016 * math.sin(a), MZ1 + 0.002), (0, 0, 1), q, lod)
    # raised Bone index wedge on the rim, pointing out at -Y (rest)
    wedge = [(0.0, -PR + 0.0015), (0.010, -MR - 0.001), (-0.010, -MR - 0.001)]
    plat.prism(wedge, PZ1 - 0.0005, PZ1 + 0.003, BONE, bt=0.0006 if lod < 2 else 0.0, bseg=1)
    if lod < 3:
        crown = Kit()
        crown.cyl(0.150, 0.054, PZ0 + 0.0005, STEEL, np_)
        holes = Kit()
        holes.cyl(0.124, 0.05, 0.075, STEEL, np_)
        plat.merge(kit.boolean_diff(crown, [holes], mats))
        if lod < 2:
            nt = (24, 12)[lod]
            for i in range(nt):
                a = 2 * math.pi * i / nt
                c = Vector((0.137 * math.cos(a), 0.137 * math.sin(a), 0.0505))
                plat.rbox((0.026, 0.0035, 0.008), (0, 0, 0), 0.0, STEEL, cseg=0, rz=0.0,
                          m=kit.at(*c) @ kit.rot_z(math.degrees(a)))
        plat.cyl(0.012, 0.050, PZ0 + 0.0005, STEEL, seg(16, q, 6))
    ticks = []
    if lod < 2:
        for i in range(1, 12):
            a = -math.pi / 2 + 2 * math.pi * i / 12
            d = Vector((math.cos(a), math.sin(a), 0))
            ticks.append(kit.decal_plane('trim.marks_m3', tuple(d * 0.190 + Vector((0, 0, PZ1))), (0, 0, 1), tuple(d),
                                         0.0035, 0.013, pivot='PIVOT__platter', sub=decal_atlas.marks_sub('tick')))
    pieces = {'base': base, 'window': win, 'pinion': pin, 'platter': plat}
    a = math.radians(-58)
    return kit.add_decals(pieces, lod, ticks + [
        kit.decal_cylinder('name.spindeck.graphite', (0, 0, 0.035), (0, 0, 1), DR, (math.cos(a), math.sin(a), 0), 0.06,
                           nu=8),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '4,1,4', 3.2, 'bottom', 5000,
        'Turntable: Bone drum (⌀0.36) on FOOT_L with a flat front facet holding the PR-M spin in ring and a '
        'kn_poly_clear window onto a steel bevel pinion (PIVOT__pinion, y) biting a crown ring; PIVOT__platter (z) '
        'carries the kn_anod_cobalt platter (⌀0.40), kn_rubber_grip mat, steel hub cap + 4 x M5, the raised Bone index '
        'wedge (rest: pointing -Y) and Bone tick decals every 30° (trim.marks_m3 tick). kn_mass_hint = platter 1.2 + '
        'base 2.0 kg. UV1 authored for the 2048² set (bake pending). Brief: docs/art/briefs/frame.md#spindeck.',
        MASTERS)
    part.pivot('platter', (0, 0, PZ0), 'z', motion='turn')
    part.pivot('pinion', PIN, 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.0)
    _m2.under(part, part.col_cyl('platter', PR, 0.03, (0, 0, 0.085), 'z', phys='rubber', restitution=0.2,
                                 friction=0.9), 'platter')
    part.col_cyl('base', DR, 0.065, (0, 0, 0.0325), 'z', phys='powder', restitution=0.2, friction=0.5)
    part.port('spin', 'in', PORT, (0, -1, 0), 'M', 'in', kind='axle')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
