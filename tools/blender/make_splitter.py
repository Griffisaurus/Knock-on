"""Procedurally build the SPLITTER source file (docs/art/briefs/power_signal.md, "MIRROR / SPLITTER: Optics pair").

Usage: blender -b --factory-startup -P tools/blender/make_splitter.py -- [out.blend]
Default output: assets/src/power/splitter.blend

The cube optic of the pair (1 x 1 x 1, bottom origin): a pillowed graphite plinth 0.1 x 0.1 x 0.025 on four
FOOT_S bumpers carries a kn_anod_beam cage (four square corner posts and a top frame) round a 0.068 kn_glass cube
centred at z 0.065. Inside the cube a kn_poly_beam prism insert shows the fan: three vertical 1.5 mm facets at 0°
and ±12° about Z that meet at the +X face (`optic = split`; a -X -> +X beam leaves as 3 rays). Name plate on the
plinth back. No LEDs or screens. Two transparent layers in the sight line (cube + insert), the maximum.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'splitter'
PL_H = 0.025                       # plinth top (incl. 3 mm feet)
FEET = 0.003
CUBE, CZ = 0.068, 0.065
POST, PX = 0.008, 0.040            # cage post section, post centre offset
TOP = 0.100
G, RUBBER, BEAM, GLASS, PBEAM = 'kn_powder_graphite', 'kn_rubber', 'kn_anod_beam', 'kn_glass', 'kn_poly_beam'
MASTERS = [G, RUBBER, BEAM, GLASS, PBEAM, 'kn_decal']


def build(lod, q):
    cs = (max(1, int(round(3 * q))), max(1, int(round(1.6 * q))), max(1, int(round(1.2 * q))), 0)[lod]
    bev = (0.003, 0.0025, 0.002, 0.0)[lod]
    base = Kit()
    base.rbox((0.1, 0.1, PL_H - FEET), (0, 0, FEET + (PL_H - FEET) / 2), 0.005 if lod < 3 else 0.0, G, cseg=cs,
              rz=bev if lod < 2 else 0.0)
    for x in (-0.036, 0.036):
        for y in (-0.036, 0.036):
            _m2.foot(base, 'S', x, y, min(1.0, q), lod)
    cage = Kit()
    pc = max(1, cs - 1) if lod < 3 else 0
    pr = 0.0015 if lod < 2 else 0.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            cage.rbox((POST, POST, TOP - PL_H), (sx * PX, sy * PX, (PL_H + TOP) / 2 - 0.0005), pr, BEAM, cseg=pc,
                      rz=0.0)
    # top frame: a square ring (outer 0.088, inner 0.066 window)
    if lod < 3:
        fr = Kit()
        fr.rbox((2 * PX + POST, 2 * PX + POST, 0.007), (0, 0, TOP - 0.0035), 0.004 if lod < 2 else 0.0, BEAM, cseg=pc,
                rz=0.0015 if lod < 2 else 0.0)
        win = Kit()
        win.prism(kit.outline_rrect(CUBE - 0.004, CUBE - 0.004, 0.002 if lod < 2 else 0.0, pc), TOP - 0.02, TOP + 0.01,
                  BEAM)
        cage.merge(kit.boolean_diff(fr, [win], bpy.data.materials))
    optic = Kit()
    optic.rbox((CUBE, CUBE, CUBE), (0, 0, CZ), 0.002 if lod < 2 else 0.0, GLASS, cseg=(2, 1, 1, 0)[lod],
               rz=0.002 if lod < 2 else 0.0)
    # prism insert: three 1.5 mm facets meeting at the +X face, at 0 and ±12° about Z
    if True:  # LOD3 keeps the three facets (plain boxes)
        ln, hh = CUBE - 0.006, CUBE - 0.010
        for a in (0.0, 12.0, -12.0):
            m = kit.at(CUBE / 2 - 0.0015, 0, CZ) @ kit.rot_z(a) @ kit.at(-ln / 2, 0, 0)
            optic.rbox((ln, 0.0015, hh), (0, 0, 0), 0.0005 if lod == 0 else 0.0, PBEAM, cseg=1 if lod == 0 else 0,
                       rz=0.0, m=m)
    pieces = {'base': base, 'cage': cage, 'optic': optic}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.splitter.bone', (0, 0.05, 0.014), (0, 1, 0), (0, 0, 1), 0.050),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,1,1', 0.5, 'bottom', 1600,
        'Optics pair, SPLITTER: graphite plinth (0.1 x 0.1 x 0.025) on FOOT_S bumpers, kn_anod_beam cage (4 posts + '
        'top frame) round a 0.068 kn_glass cube at z 0.065 holding a kn_poly_beam prism insert (three vertical '
        '1.5 mm facets at 0 / ±12° about Z meeting at the +X face, optic = split). Name plate on the plinth back. '
        'UV1 authored for the shared 1024² set (bake pending). Brief: docs/art/briefs/power_signal.md#mirror--splitter.',
        MASTERS)
    part.build_lods(build, lod0_q=1.2)
    part.col_box('plinth', (0.1, 0.1, PL_H), (0, 0, PL_H / 2), phys='powder', restitution=0.25, friction=0.6)
    part.col_box('cube', (CUBE, CUBE, CUBE), (0, 0, CZ), phys='glass', restitution=0.2, friction=0.4)
    h = CUBE / 2
    part.sensor('light', 'cube', [(x * h, y * h, CZ + z * h) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)],
                optic='split', rays=3, fan_deg=12.0)
    for lod in ('', '__L1', '__L2', '__L3'):
        bpy.data.objects[TYPE + '__optic' + lod]['optic'] = 'split'
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
