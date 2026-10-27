"""Procedurally build the PINGER source file (docs/art/briefs/contraptions.md, "PINGER: Spring plunger").

Usage: blender -b --factory-startup -P tools/blender/make_pinger.py -- [out.blend]
Default output: assets/src/contraptions/pinger.blend

A pinball plunger on a cream rail (1 x 1 x 3, bottom origin, fires -Y): a kn_powder_bone rail (0.08 wide, z 0.004 ...
0.024) on FOOT_M bumpers carries the front block (0.08 x 0.08, y -0.156 ... -0.12, PR-S signal fire ring on its top)
and the rear block (y 0.10 ... 0.13, ready LED_D8 group 0 on top), joined by a kn_poly_clear tube (Ø 0.05, axis z
0.055) filled end to end by the kn_chrome spring (Ø 0.04) round the chrome rod (Ø 0.01). PIVOT__plunger (axis y;
+0.06 cocked / 0 rest / -0.04 struck) carries the rod, the kn_powder_ignition striker head (Ø 0.035, kn_rubber face)
out of the front block and the Ignition rear knob (Ø 0.04). The spring carries `sk_compress` (0 rest -> 1 cocked).
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

TYPE = 'pinger'
AXZ = 0.055
RAIL_Z0, RAIL_Z1 = 0.004, 0.024
FB_Y0, FB_Y1 = -0.156, -0.12
RB_Y0, RB_Y1 = 0.10, 0.13
BLK_Z0, BLK_Z1 = 0.015, 0.095
TUBE_R = 0.025
TIP_Y = -0.16
KNOB_Y1 = 0.152
SPR_Y0, SPR_Y1 = -0.112, RB_Y0         # the spring fills the tube from the striker collar to the rear block
COCK = 0.06
BONE, RUBBER, IGN, POLY, CHROME, LED = (
    'kn_powder_bone', 'kn_rubber', 'kn_powder_ignition', 'kn_poly_clear', 'kn_chrome', 'kn_led')
MASTERS = [BONE, RUBBER, IGN, POLY, CHROME, LED, 'kn_steel_brushed', 'kn_decal']
YAX = kit.at(0, 0, AXZ) @ kit.frame(axis='y')     # local z = +Y along the plunger axis


def spring_kit(lod, q, y0, y1):
    k = Kit()
    _m2.coil(k, 0.018, 0.0016, y0, y1, (14.0, 14.0, 8.0, 8.0)[lod], CHROME, q, lod, m=YAX)
    return k


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    body = Kit()
    body.rbox((0.08, 0.30 - 0.02, RAIL_Z1 - RAIL_Z0), (0, -0.0125, (RAIL_Z0 + RAIL_Z1) / 2), 0.006 if lod < 3 else 0.0,
              BONE, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    for y0, y1 in ((FB_Y0, FB_Y1), (RB_Y0, RB_Y1)):
        blk = Kit()
        blk.rbox((0.08, y1 - y0, BLK_Z1 - BLK_Z0), (0, (y0 + y1) / 2, (BLK_Z0 + BLK_Z1) / 2), 0.008 if lod < 3 else 0.0,
                 BONE, cseg=cs, rz=0.006 if lod < 3 else 0.0)
        if lod < 3:  # bores for the rod / striker
            bore = Kit()
            bore.cyl(0.0185 if y0 < 0 else 0.0065, -0.2, 0.2, BONE, seg(24, q, 8), m=YAX)
            blk = kit.boolean_diff(blk, [bore], mats)
        body.merge(blk)
        blk.free()
    for x in (-0.03, 0.03):
        for y in (-0.13, 0.11):
            _m2.foot(body, 'M', x, y, min(1.0, q), lod, z0=0.0)
    _m2.led_dome(body, 8, (0.0, (RB_Y0 + RB_Y1) / 2, BLK_Z1), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08))
    tube = Kit()
    n = seg(32, q, 8)
    tube.lathe([(TUBE_R - 0.002, FB_Y1 - 0.002, POLY), (TUBE_R, FB_Y1 - 0.002, POLY), (TUBE_R, RB_Y0 + 0.002, POLY),
                (TUBE_R - 0.002, RB_Y0 + 0.002, POLY)], n, YAX, closed=True)
    spring = spring_kit(lod, q, SPR_Y0, SPR_Y1)
    if lod < 2:
        spring.shape_keys['sk_compress'] = (spring_kit(lod, q, SPR_Y0 + COCK, SPR_Y1),
                                            '0 rest -> 1 cocked: the coil shortens by the 0.06 m draw', 0.0)
    plunger = Kit(pivot='PIVOT__plunger')
    plunger.cyl(0.005, TIP_Y + 0.02, KNOB_Y1 - 0.01, CHROME, seg(12, q, 6), m=kit.at(0, 0, AXZ) @ kit.frame(axis='y'))
    # striker head: Ignition body with a rubber face, collar inside the tube
    hp = [(0.0, TIP_Y, RUBBER), (0.0095, TIP_Y, RUBBER), (0.0105, TIP_Y + 0.001, IGN), (0.0155, TIP_Y + 0.0012, IGN),
          (0.0175, TIP_Y + 0.003, IGN), (0.0175, SPR_Y0, IGN), (0.0, SPR_Y0, IGN)]
    if lod >= 3:
        hp = [(0.0, TIP_Y, RUBBER), (0.0175, TIP_Y, RUBBER), (0.0175, TIP_Y + 0.004, IGN), (0.0175, SPR_Y0, IGN),
              (0.0, SPR_Y0, IGN)]
    plunger.lathe(hp, seg(28, q, 8), kit.at(0, 0, AXZ) @ kit.frame(axis='y'))
    kp = [(0.0, RB_Y1 + 0.002, IGN), (0.012, RB_Y1 + 0.002, IGN), (0.02, RB_Y1 + 0.006, IGN),
          (0.02, KNOB_Y1 - 0.006, IGN), (0.016, KNOB_Y1 - 0.001, IGN), (0.0, KNOB_Y1, IGN)]
    plunger.lathe(kp, seg(28, q, 8), kit.at(0, 0, AXZ) @ kit.frame(axis='y'))
    pieces = {'body': body, 'tube': tube, 'spring': spring, 'plunger': plunger}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.pinger.graphite', (0.04, -0.01, (RAIL_Z0 + RAIL_Z1) / 2), (1, 0, 0), (0, 0, 1), 0.06,
                        0.009),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '1,1,3', 0.9, 'bottom', 4500,
        'Spring plunger (fires -Y): kn_powder_bone rail on FOOT_M with front / rear blocks (PR-S signal fire on the '
        'front top, ready LED_D8 group 0 on the rear top), kn_poly_clear tube (Ø 0.05) filled by the kn_chrome spring '
        '(Ø 0.04, sk_compress 0 rest -> 1 cocked) round the chrome rod; PIVOT__plunger (y: +0.06 cocked / 0 rest / '
        '-0.04 struck) carries the rod, the Ignition striker (Ø 0.035, rubber face) and the Ignition rear knob '
        '(Ø 0.04). Name plate on the rail +X side. UV1 authored for the 2048² set (bake pending). '
        'Brief: docs/art/briefs/contraptions.md#pinger.',
        MASTERS, led_groups='0:ready', skins='classic')
    part.pivot('plunger', (0, 0, AXZ), 'y', -0.04, COCK, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('rail', (0.08, 0.26, 0.02), (0, -0.0125, (RAIL_Z0 + RAIL_Z1) / 2), phys='powder', restitution=0.2,
                 friction=0.6)
    part.col_box('block_front', (0.08, FB_Y1 - FB_Y0, BLK_Z1 - BLK_Z0), (0, (FB_Y0 + FB_Y1) / 2, (BLK_Z0 + BLK_Z1) / 2),
                 phys='powder')
    part.col_box('block_rear', (0.08, RB_Y1 - RB_Y0, BLK_Z1 - BLK_Z0), (0, (RB_Y0 + RB_Y1) / 2, (BLK_Z0 + BLK_Z1) / 2),
                 phys='powder')
    part.col_cyl('tube', TUBE_R, RB_Y0 - FB_Y1, (0, (FB_Y1 + RB_Y0) / 2, AXZ), 'y', phys='powder')
    _m2.under(part, part.col_cyl('striker', 0.0175, SPR_Y0 - TIP_Y, (0, (TIP_Y + SPR_Y0) / 2, AXZ), 'y',
                                 phys='rubber', restitution=0.3, friction=0.8), 'plunger')
    part.port('signal', 'fire', (0, -0.138, BLK_Z1), (0, 0, 1), 'S', 'in')
    _m2.under(part, part.emit('pow', 'tip', (0, TIP_Y, AXZ), (0, -1, 0)), 'plunger')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
