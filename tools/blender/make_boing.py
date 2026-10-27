"""Procedurally build the BOING source file (docs/art/briefs/rollers.md, "BOING: Bouncy ball").

Usage: blender -b --factory-startup -P tools/blender/make_boing.py -- [out.blend]
Default output: assets/src/rollers/boing.blend

An Ignition ball r 0.120 with three orthogonal great-circle seams (XY, XZ, YZ planes), 6.4 mm wide and
recessed 1 mm in kn_rubber, so the "beach-ball cross" spins visibly and nothing stands proud of the collider.
Built directly (no booleans): each of the 8 octant patches is a spherical-triangle grid whose edges lie exactly
on the seam planes (|x|, |y|, |z| = 3.2 mm), closed by short radial walls and an inner cap; three rubber seam
rings form the groove floors 1 mm under the surface. LOD3 is a plain sphere (seams read as colour only).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'boing'
R = 0.120
W = 0.0032          # half seam width: 6.4 mm seams
DEPTH = 0.001       # seam recess
IGN, RUBBER = 'kn_powder_ignition', 'kn_rubber'
MASTERS = [IGN, RUBBER]


def octant(kit_, signs, n):
    """Spherical-triangle patch x, y, z >= W (times signs), closed by radial walls and an inner cap."""
    bm = kit_.bm
    h = math.sqrt(R * R - 2 * W * W)
    a, b, c = Vector((h, W, W)), Vector((W, h, W)), Vector((W, W, h))
    sv = Vector(signs)
    grid = {}
    for i in range(n + 1):
        for j in range(n + 1 - i):
            k = n - i - j
            p = (a * i + b * j + c * k).normalized() * R
            # edges sit exactly on their seam plane, then back onto the sphere
            for idx, zero in ((2, k == 0), (0, i == 0), (1, j == 0)):
                if zero:
                    p[idx] = W
            rest = [t for t in range(3) if not ((t == 2 and k == 0) or (t == 0 and i == 0) or (t == 1 and j == 0))]
            fixed = sum(p[t] ** 2 for t in range(3) if t not in rest)
            m = math.sqrt(max(R * R - fixed, 0.0) / max(sum(p[t] ** 2 for t in rest), 1e-12))
            for t in rest:
                p[t] *= m
            grid[(i, j)] = bm.verts.new((p.x * sv.x, p.y * sv.y, p.z * sv.z))
    mi = kit_.mi(IGN)
    for i in range(n):
        for j in range(n - i):
            f = bm.faces.new((grid[(i, j)], grid[(i + 1, j)], grid[(i, j + 1)]))
            f.material_index = mi
            if i + j + 1 < n:
                f = bm.faces.new((grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)]))
                f.material_index = mi
    loop = [grid[(i, n - i)] for i in range(n, -1, -1)]               # A -> B (k = 0)
    loop += [grid[(0, j)] for j in range(n - 1, -1, -1)]               # B -> C (i = 0)
    loop += [grid[(i, 0)] for i in range(1, n)]                        # C -> A (j = 0)
    s = (R - DEPTH - 0.0006) / R
    inner = [bm.verts.new(v.co * s) for v in loop]
    for t in range(len(loop)):
        u = (t + 1) % len(loop)
        f = bm.faces.new((loop[t], loop[u], inner[u], inner[t]))
        f.material_index = mi
    f = bm.faces.new(inner)
    f.material_index = mi


def seam_ring(kit_, axis, segs, n):
    """Groove floor: 1 mm under the surface, lowered by the patch chord sag on coarse LODs."""
    wm = W + 0.0004
    top = min(R - DEPTH, R * math.cos(math.pi / 4 / n) - 0.0003)
    prof = [(R - 0.006, 0.0, RUBBER), (top, -wm, RUBBER), (top, wm, RUBBER)]
    kit_.lathe(prof, segs, kit.frame((0, 0, 0), axis), closed=True)


def build(lod, q):
    ball = Kit()
    if lod == 3:
        ball.sphere(R, IGN, seg(14, q, 8), seg(8, q, 5))
        return {'ball': ball}
    n = seg(9, q, 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                octant(ball, (sx, sy, sz), n)
    rs = seg(56, q, 8)
    for ax in ('x', 'y', 'z'):
        seam_ring(ball, ax, rs, n)
    # Graphite "BOING" stamp inside one octant patch (front, upper right), draped on the sphere.
    decals = [kit.decal_wrap('name.boing.graphite', (0.62, -1.0, 0.45), (0, 0, 1), 0.062, lambda d: d * R,
                             nu=6, nv=2, ref=R)]
    return kit.add_decals({'ball': ball}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'S', '2.4,2.4,2.4', 0.6, 'com', 2000,
        'Bouncy ball. Brief: docs/art/briefs/rollers.md#boing. Seams recessed 1 mm (never proud). Deferred: '
        'the 1024 ORM (roughness 0.62) + pebble Normal set and sk_squash. "BOING" stamp = decal.',
        MASTERS)
    part.build_lods(build, lod0_q=1.0)
    part.col_sphere('0', R, phys='rubber', restitution=0.82, friction=0.6)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
