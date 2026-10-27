"""Procedurally build the BONKER source file (docs/art/briefs/contraptions.md, "BONKER: Hinged mallet").

Usage: blender -b --factory-startup -P tools/blender/make_bonker.py -- [out.blend]
Default output: assets/src/contraptions/bonker.blend

An upright mallet (1 x 4 x 1; origin = hinge axis centre, 0.05 above the floor; floor z -0.05, head top z 0.35):
a pillowed kn_powder_bone hinge block (0.10 x 0.10 x 0.07) on four FOOT_S bumpers with a clevis yoke on top, a
brushed-steel hinge pin along X and kn_chrome torsion springs either side of the yoke (shape key `sk_wind`, 1 =
wound). PIVOT__arm (axis x, 0 upright ... +100° toward -Y) carries the kn_wood_oak handle (Ø 0.022) and the fat
kn_powder_ignition head (Ø 0.08 x 0.10, axis Y, centre z 0.31) with kn_rubber strike caps facing ±Y exactly. PR-S
signal swing ring on a 1 mm land on the block front; ready LED_D8 (group 0) on the block top; name plate on the back.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'bonker'
FLOOR = -0.05
BLK_Z1 = 0.02
HEAD_Z, HEAD_R, HEAD_L = 0.31, 0.04, 0.10
HANDLE_R = 0.011
CHEEK_X = 0.0215
PORT = (0.0, -0.051, -0.015)
BONE, RUBBER, IGN, OAK, CHROME, STEEL, LED = (
    'kn_powder_bone', 'kn_rubber', 'kn_powder_ignition', 'kn_wood_oak', 'kn_chrome', 'kn_steel_brushed', 'kn_led')
MASTERS = [BONE, RUBBER, IGN, OAK, CHROME, STEEL, LED, 'kn_decal']
XAX = kit.frame(axis='x')


def springs_kit(lod, q, length):
    k = Kit()
    for sx in (-1, 1):
        x0 = sx * (CHEEK_X + 0.006)
        _m2.coil(k, 0.0085, 0.0011, x0 - length / 2, x0 + length / 2, 3.5, CHROME, q, lod, m=XAX)
    return k


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    base = Kit()
    base.rbox((0.10, 0.10, BLK_Z1 - FLOOR - 0.003 - 0.012), (0, 0, (FLOOR + 0.003 + BLK_Z1 - 0.012) / 2),
              0.008 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.006 if lod < 3 else 0.0)
    # clevis yoke: two cheeks round the handle foot, rounded over the pin
    for sx in (-1, 1):
        base.prism(kit.outline_rrect(0.007, 0.05, 0.003 if lod < 3 else 0.0, max(1, cs - 1) if lod < 3 else 0),
                   BLK_Z1 - 0.016, BLK_Z1 + 0.004, BONE, bt=0.003 if lod < 3 else 0.0, bseg=max(1, cs - 1),
                   m=kit.at(sx * CHEEK_X, 0, 0))
    base.cyl(0.004, -CHEEK_X - 0.006, CHEEK_X + 0.006, STEEL, seg(12, q, 6), bev=0.001 if lod < 2 else 0.0, bseg=1,
             m=XAX)
    _m2.land(base, 'S', PORT, (0, -1, 0), 0.001, lod, mat=BONE)
    for x in (-0.035, 0.035):
        for y in (-0.035, 0.035):
            _m2.foot(base, 'S', x, y, min(1.0, q), lod, z0=FLOOR)
    _m2.led_dome(base, 8, (0.03, 0.03, BLK_Z1 - 0.012), (0, 0, 1), q, lod)
    base.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08))
    springs = springs_kit(lod, q, 0.010)
    if lod < 2:
        x0 = CHEEK_X + 0.006 - 0.005

        def unwind(co):  # each coil turns up to 50° about the pin from its inner to its outer end
            s = max(0.0, min(1.0, (abs(co.x) - x0) / 0.010))
            return Matrix.Rotation(math.radians(-50.0 * s), 3, 'X') @ co
        springs.shape_keys['sk_wind'] = (unwind, '1 = wound (ready); 0 = released, each coil unwinds up to 50° about '
                                         'the pin', 1.0)
    arm = Kit(pivot='PIVOT__arm')
    n = seg(20, q, 6)
    arm.cyl(HANDLE_R, -0.008, HEAD_Z - 0.02, OAK, n, bev=0.003 if lod < 3 else 0.0, bseg=1)
    if lod < 3:  # the handle's foot boss round the pin
        arm.cyl(0.0095, -0.0095, 0.0095, OAK, n, bev=0.002 if lod < 2 else 0.0, bseg=1, m=XAX)
    hn = seg(40, q, 8)
    # rubber strike pads (r 0.031, 3 mm proud) set into Ignition end faces with a rounded rim
    hl = HEAD_L / 2 - 0.003
    prof = [(0.0, -HEAD_L / 2, RUBBER), (0.029, -HEAD_L / 2, RUBBER), (0.031, -HEAD_L / 2 + 0.002, RUBBER),
            (0.031, -hl, IGN), (HEAD_R - 0.004, -hl, IGN), (HEAD_R, -hl + 0.004, IGN), (HEAD_R, hl - 0.004, IGN),
            (HEAD_R - 0.004, hl, IGN), (0.031, hl, RUBBER), (0.031, HEAD_L / 2 - 0.002, RUBBER),
            (0.029, HEAD_L / 2, RUBBER), (0.0, HEAD_L / 2, RUBBER)]
    if lod >= 3:
        prof = [(0.0, -HEAD_L / 2, RUBBER), (HEAD_R, -HEAD_L / 2, RUBBER), (HEAD_R, -HEAD_L / 2 + 0.006, IGN),
                (HEAD_R, HEAD_L / 2 - 0.006, RUBBER), (HEAD_R, HEAD_L / 2, RUBBER), (0.0, HEAD_L / 2, RUBBER)]
    arm.lathe(prof, hn, kit.at(0, 0, HEAD_Z) @ kit.frame(axis='y'))
    pieces = {'base': base, 'springs': springs, 'arm': arm}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.bonker.graphite', (0, 0.05, -0.020), (0, 1, 0), (0, 0, 1), 0.052),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '1,4,1', 1.6, 'hinge', 4000,
        'Hinged mallet (origin on the hinge axis, floor z -0.05): pillowed kn_powder_bone hinge block on FOOT_S with a '
        'clevis yoke, steel pin, kn_chrome torsion springs either side (sk_wind, 1 = wound); PIVOT__arm (x, 0 ... +100° '
        'toward -Y) carries the kn_wood_oak handle (Ø 0.022) and the kn_powder_ignition head (Ø 0.08 x 0.10, axis Y, '
        'z 0.31) with kn_rubber strike caps on both ±Y faces. PR-S signal swing on a 1 mm land, ready LED_D8 '
        '(group 0) on the block top, name plate on the back. UV1 authored for the 2048² set (bake pending). '
        'Brief: docs/art/briefs/contraptions.md#bonker.',
        MASTERS, led_groups='0:ready', skins='classic,carnival')
    part.pivot('arm', (0, 0, 0), 'x', 0.0, 100.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('base', (0.10, 0.10, 0.07), (0, 0, FLOOR + 0.035), phys='powder', restitution=0.2, friction=0.6)
    _m2.under(part, part.col_capsule('handle', HANDLE_R, HEAD_Z, (0, 0, HEAD_Z / 2), 'z', phys='wood'), 'arm')
    _m2.under(part, part.col_cyl('head', HEAD_R, HEAD_L, (0, 0, HEAD_Z), 'y', phys='rubber', restitution=0.3,
                                 friction=0.8), 'arm')
    part.port('signal', 'swing', PORT, (0, -1, 0), 'S', 'in')
    _m2.under(part, part.emit('pow', 'head', (0, -0.05, HEAD_Z), (0, -1, 0)), 'arm')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
