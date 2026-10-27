"""Procedurally build the DING source file (docs/art/briefs/fun.md, "DING: Desk bell with a hero plunger").

Usage: blender -b --factory-startup -P tools/blender/make_ding.py -- [out.blend]
Default output: assets/src/fun/ding.blend

A chunky service bell (1 x 1 x 1, free body; origin = the briefed centre of mass 0.035 above the base,
kn_com_explicit; all brief heights below are from the base): a kn_rubber foot ring (4 mm) under a kn_powder_bone base
(Ø 0.090, to z 0.020, 6 mm pillowed edge) with a 3 mm kn_led light bar round its top edge (group 0 ring); a polished
kn_brass dome (Ø 0.084, z 0.020 ... 0.068) on PIVOT__dome (axis z, ±3° shiver); a kn_steel_brushed stem (Ø 0.006,
z 0.068 ... 0.088) and the oversized kn_powder_ignition_gloss plunger cap (Ø 0.030, z 0.088 ... 0.100) on
PIVOT__plunger (axis z, slide -0.008 ... 0). "DING" name plate on the base front.
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

TYPE = 'ding'
O = -0.035                          # base height relative to the origin (COM)
BASE_R, BASE_Z1 = 0.045, 0.020
DOME_R, DOME_Z0, DOME_Z1 = 0.042, 0.020, 0.068
STEM_Z1, CAP_R, CAP_Z1 = 0.088, 0.015, 0.100
BONE, RUBBER, BRASS, STEEL, IGN, LED = (
    'kn_powder_bone', 'kn_rubber', 'kn_brass', 'kn_steel_brushed', 'kn_powder_ignition_gloss', 'kn_led')
MASTERS = [BONE, RUBBER, BRASS, STEEL, IGN, LED, 'kn_decal']


def z(h):
    return O + h


def build(lod, q, mats):
    n = seg(48, q, 8) if lod < 3 else 7
    base = Kit()
    if lod < 3:
        base.cyl(BASE_R - 0.003, z(0.0), z(0.0045), RUBBER, n, bev=0.001, bseg=1)
    base.cyl(BASE_R, z(0.004) if lod < 3 else z(0.0), z(BASE_Z1), BONE, n, bev=0.006 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
             bev_bot=0.002 if lod < 3 else 0.0)
    # light bar: a 3 mm kn_led ring set into the top edge
    if lod < 3:
        base.torus(BASE_R - 0.007, 0.0015, LED, n, (6, 4, 3)[lod], m=kit.at(0, 0, z(BASE_Z1) + 0.0002))
    else:
        base.cyl(BASE_R - 0.0055, z(BASE_Z1) - 0.0005, z(BASE_Z1) + 0.0008, LED, n)
    base.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.0))
    dome = Kit(pivot='PIVOT__dome')
    cz = DOME_Z1 - DOME_R          # sphere centre so the top lands at z 0.068
    prof = [(0.0, z(DOME_Z0 - 0.001), BRASS)]
    a0 = math.asin((DOME_Z0 - cz) / DOME_R)
    nr = (14, 9, 6, 3)[lod]
    for i in range(nr + 1):
        a = a0 + (math.pi / 2 - a0) * i / nr
        r = DOME_R * math.cos(a)
        prof.append((r if i < nr else 0.0, z(cz + DOME_R * math.sin(a)), BRASS))
    prof.insert(1, (DOME_R * math.cos(a0) + 0.0012, z(DOME_Z0 - 0.001), BRASS))
    dome.lathe(kit.dedupe(prof), n)
    plunger = Kit(pivot='PIVOT__plunger')
    plunger.cyl(0.003, z(DOME_Z1 - 0.012), z(STEM_Z1 + 0.002), STEEL, seg(12, q, 6))
    plunger.lathe([(0.0, z(STEM_Z1), IGN), (CAP_R - 0.003, z(STEM_Z1), IGN), (CAP_R, z(STEM_Z1 + 0.003), IGN),
                   (CAP_R, z(CAP_Z1 - 0.005), IGN), (CAP_R - 0.004, z(CAP_Z1 - 0.001), IGN), (0.0, z(CAP_Z1), IGN)],
                  (40, 24, 14, 7)[lod])
    pieces = {'base': base, 'dome': dome, 'plunger': plunger}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('name.ding.graphite', (0, 0, z(0.011)), (0, 0, 1), BASE_R + 0.0002, (0, -1, 0), 0.034, nu=6),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '1,1,1', 0.45, 'com', 2400,
        'Desk bell (free body; origin = the briefed COM 0.035 above the base, kn_com_explicit): kn_rubber foot ring, '
        'pillowed kn_powder_bone base (Ø 0.090) with a 3 mm kn_led light bar (group 0 ring) on its top edge, polished '
        'kn_brass dome (Ø 0.084, to z 0.068) on PIVOT__dome (z, ±3°), steel stem + oversized kn_powder_ignition_gloss '
        'cap (Ø 0.030, to z 0.100) on PIVOT__plunger (z slide -0.008 ... 0). "DING" name plate on the base front. '
        'UV1 authored for the 1024² set (bake pending). Brief: docs/art/briefs/fun.md#ding.',
        MASTERS, led_groups='0:ring', skins='brass,chrome', pipeline={'kn_com_explicit': True})
    part.pivot('dome', (0, 0, z(DOME_Z0)), 'z', -3.0, 3.0, motion='turn')
    part.pivot('plunger', (0, 0, z(STEM_Z1)), 'z', -0.008, 0.0, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_cyl('0', BASE_R, BASE_Z1, (0, 0, z(BASE_Z1 / 2)), 'z', phys='powder', restitution=0.3, friction=0.5)
    _m2.under(part, part.col_sphere('1', DOME_R, (0, 0, z(0.025)), phys='steel', restitution=0.3, friction=0.4),
              'dome')
    _m2.under(part, part.col_cyl('2', CAP_R, 0.012, (0, 0, z(0.094)), 'z', phys='powder', restitution=0.3,
                                 friction=0.5), 'plunger')
    ring = [(CAP_R * 1.05 * math.cos(2 * math.pi * i / 10), CAP_R * 1.05 * math.sin(2 * math.pi * i / 10), zz)
            for i in range(10) for zz in (z(0.088), z(0.100))]
    _m2.under(part, part.sensor('trigger', 'plunger', ring, threshold=0.04), 'plunger')
    shell = []
    for j in range(4):
        ph = math.radians(10 + 25 * j)
        for i in range(10):
            a = 2 * math.pi * i / 10
            r = (DOME_R + 0.002) * math.cos(ph)
            shell.append((r * math.cos(a), r * math.sin(a), z(0.026 + (DOME_R + 0.002) * math.sin(ph))))
    part.sensor('trigger', 'dome', shell, threshold=0.10, full_ring=0.25)
    part.emit('ring', 'dome', (0, 0, z(0.065)), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
