"""Procedurally build the SHEAVE source file (docs/art/briefs/frame.md, "SHEAVE: Pulley").

Usage: blender -b --factory-startup -P tools/blender/make_sheave.py -- [out.blend]
Default output: assets/src/frame/sheave.blend

A Cobalt anodised wheel (Ø 0.10 x 0.022, V-groove to a Ø 0.08 root for Ø 6 mm Line) spinning between 6 mm Bone
cheek plates (|y| 0.017-0.023: a Ø 0.07 lobe round the axle
tapering up into the yoke), a steel axle with M3 caps, and a steel swivel boss on top carrying the PR-S mount
hook ring at z 0.088. Origin = axle centre. Pivots: PIVOT__swivel (axis z: cheeks, yoke, axle) and
PIVOT__wheel (axis y: the wheel). The brief nests the wheel pivot under the swivel; validator v1 allows one
pivot per piece, so they are siblings sharing the axle line (the engine composes swivel then wheel).
The brief's five lightening holes (at 0.56 x root r, r <= 0.030) sit entirely behind the Ø 0.07 cheek lobes on
both sides, so they are left out and the budget goes to the wheel and cheek silhouettes.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'sheave'
WHEEL_R, WHEEL_HW, ROOT_R = 0.05, 0.011, 0.04
CHEEK_IN, CHEEK_OUT = 0.017, 0.023
BOSS_TOP = 0.088
COBALT, BONE, STEEL = 'kn_anod_cobalt', 'kn_powder_bone', 'kn_steel_brushed'
MASTERS = [COBALT, BONE, STEEL]


def hull2d(pts):
    pts = sorted(set((round(x, 9), round(y, 9)) for x, y in pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def cheek_outline(n):
    """Lobe r 0.035 round the axle tapering into the yoke (r 0.016 at z 0.058), in the Y_AXIS frame (z, x)."""
    pts = []
    for cz, r in ((0.0, 0.035), (0.058, 0.016)):
        for i in range(n):
            a = 2 * math.pi * i / n
            pts.append((cz + r * math.cos(a), r * math.sin(a)))
    return hull2d(pts)


def build(lod, q, mats=None):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    n = seg(56, q, 8 if lod < 3 else 6)
    wheel = Kit(pivot='PIVOT__wheel')
    prof = [(0.0047, -WHEEL_HW), (0.0465, -WHEEL_HW), (WHEEL_R, -0.0072), (0.0426, -0.0022), (ROOT_R, 0.0),
            (0.0426, 0.0022), (WHEEL_R, 0.0072), (0.0465, WHEEL_HW), (0.0047, WHEEL_HW)]
    if lod == 2:
        prof = [(0.0047, -WHEEL_HW), (WHEEL_R, -WHEEL_HW), (WHEEL_R, -0.0068), (ROOT_R, 0.0), (WHEEL_R, 0.0068),
                (WHEEL_R, WHEEL_HW), (0.0047, WHEEL_HW)]
    elif lod == 3:
        prof = [(0.0047, -WHEEL_HW), (WHEEL_R, -WHEEL_HW), (WHEEL_R, WHEEL_HW), (0.0047, WHEEL_HW)]
    wheel.lathe([(r, h, COBALT) for r, h in prof], n, m=kit.Y_AXIS, closed=True)
    swivel = Kit(pivot='PIVOT__swivel')
    outline = cheek_outline(seg(56, q, 8) if lod < 3 else 6)
    bev = (0.0015, 0.0012, 0.001, 0.0)[lod]
    for s in (-1, 1):
        y0, y1 = (CHEEK_IN, CHEEK_OUT) if s > 0 else (-CHEEK_OUT, -CHEEK_IN)
        swivel.prism(outline, y0, y1, BONE, bt=bev, bb=bev, bseg=1, m=kit.Y_AXIS)
    swivel.rbox((0.032, 2 * CHEEK_IN + 0.002, 0.02), (0, 0, 0.062), 0.006 if lod < 3 else 0.0, BONE,
                cseg=cs if lod < 3 else 0, rz=0.003 if lod < 3 else 0.0)
    if lod < 3:
        swivel.cyl(0.0085, 0.068, 0.0785, STEEL, seg(20, q, 6))
        swivel.cyl(0.0045, -CHEEK_OUT - 0.0015, CHEEK_OUT + 0.0015, STEEL, seg(14, q, 5), m=kit.Y_AXIS)
    if lod < 2:  # M3 axle caps
        for s in (-1, 1):
            swivel.sphere(0.0034, STEEL, seg(12, q, 6), 4, sz_top=0.55, sz_bot=0.2,
                          m=kit.frame((0, s * (CHEEK_OUT + 0.0006), 0), (0, s, 0)))
    base = Kit()
    base.cyl(0.0175, 0.0775 if lod < 3 else 0.06, BOSS_TOP, STEEL, seg(22, q, 8) if lod < 3 else 6,
             bev=0.0015 if lod < 2 else 0.0, bseg=cs)
    # Name plate on the front cheek above the axle ring (graphite ink on bone); it turns with the swivel.
    decals = [kit.decal_plane('name.sheave.graphite', (0, -CHEEK_OUT, 0.033), (0, -1, 0), (0, 0, 1), 0.024,
                              pivot='PIVOT__swivel')]
    return kit.add_decals({'swivel': swivel, 'wheel': wheel, 'mount': base}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '1,1.5,0.5', 0.35, 'axle', 1700,
        'Pulley. Brief: docs/art/briefs/frame.md#sheave. Swivel and wheel pivots are siblings on the axle line '
        '(validator v1: one pivot per piece); the brief nests the wheel under the swivel. Lightening holes '
        'omitted: the cheek lobes hide them from every side.',
        MASTERS)
    part.pivot('swivel', (0, 0, 0), 'z', -180.0, 180.0)
    part.pivot('wheel', (0, 0, 0), 'y')
    part.build_lods(lambda lod, q: build(lod, q, part.mats))
    part.col_cyl('wheel', WHEEL_R, 2 * WHEEL_HW, (0, 0, 0), 'y', phys='steel', restitution=0.2, friction=0.3)
    part.col_box('yoke', (0.07, 0.046, 0.10), (0, 0, 0.03), phys='powder')
    part.port('tension', 'axle', (0, -CHEEK_OUT, 0), (0, -1, 0), 'S', 'both', max_links=2, kind='axle')
    part.port('tension', 'mount', (0, 0, BOSS_TOP), (0, 0, 1), 'S', 'both', kind='hook')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
