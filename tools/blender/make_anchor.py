"""Procedurally build the ANCHOR source file (docs/art/briefs/frame.md, "ANCHOR: Hook point").

Usage: blender -b --factory-startup -P tools/blender/make_anchor.py -- [out.blend]
Default output: assets/src/frame/anchor.blend

The look-dev helio() anchor at catalogue size: a graphite puck Ø 0.052 x 0.014 with a 4 mm bevel, a Cobalt top
disc round the PR-S hook ring (whose collar sits on the puck top, z 0.014), three M3 screws at 120° on the
flange, and under PIVOT__eye (axis z, free swivel) a brass eye (torus R 0.011, r 0.0028) standing vertical with
its centre at z 0.036 (top at 0.050) on a shank that plugs into the ring socket. Origin = bottom centre of the
mount face (+Z = surface normal); no up-only detail, so it reads on a ceiling too.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'anchor'
PUCK_R, PUCK_H = 0.026, 0.014
EYE_Z, EYE_R, EYE_r = 0.036, 0.011, 0.0028
G, COBALT, BRASS, STEEL = 'kn_powder_graphite', 'kn_powder_cobalt', 'kn_brass', 'kn_steel_brushed'
MASTERS = [G, COBALT, BRASS, STEEL]


def build(lod, q):
    base = Kit()
    n = seg(40, q, 7)
    base.cyl(PUCK_R, 0.0, PUCK_H, G, n, bev=(0.004, 0.004, 0.003, 0.0)[lod], bseg=max(1, min(3, round(3 * q))),
             bev_bot=(0.0008, 0.0, 0.0, 0.0)[lod])
    if lod < 3:
        base.cyl(0.0215, PUCK_H - 0.0012, PUCK_H + 0.0009, COBALT, n, bev=0.0006 if lod < 2 else 0.0, bseg=1)
    if lod == 0:  # M3 heads at 120° on the flange, outside the ring
        prof = [(0.0, -0.0005, STEEL), (0.00275, -0.0005, STEEL), (0.00275, 0.0005, STEEL), (0.0021, 0.0012, STEEL),
                (0.0011, 0.0016, STEEL), (0.0, 0.00165, STEEL)]
        for k in range(3):
            a = math.radians(90 + 120 * k)
            base.lathe(prof, seg(12, q, 6), kit.at(0.0178 * math.cos(a), 0.0178 * math.sin(a), PUCK_H + 0.0009))
    eye = Kit(pivot='PIVOT__eye')
    eye.torus(EYE_R, EYE_r, BRASS, seg(28, q, 5), (8, 6, 4, 3)[lod], m=kit.at(0, 0, EYE_Z) @ kit.Y_AXIS)
    if lod < 3:
        eye.cyl(0.0024, PUCK_H - 0.002, EYE_Z - EYE_R, BRASS, seg(12, q, 5))
    return {'puck': base, 'eye': eye}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '0.5,0.5,0.5', 0.06, 'bottom', 700,
        'Hook point: look-dev helio() anchor. Brief: docs/art/briefs/frame.md#anchor. Static mount; '
        'kn_mass_hint is a nominal 60 g.',
        MASTERS)
    part.pivot('eye', (0, 0, PUCK_H), 'z', -180.0, 180.0)
    part.build_lods(build, lod0_q=1.0)
    part.col_cyl('0', PUCK_R, PUCK_H, (0, 0, PUCK_H / 2), 'z', phys='powder', restitution=0.25, friction=0.5)
    part.port('tension', 'hook', (0, 0, PUCK_H), (0, 0, 1), 'S', 'both', max_links=4, kind='hook')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
