"""Procedurally build the HELIO source file (docs/art/briefs/rollers.md, "HELIO: Balloon").

Usage: blender -b --factory-startup -P tools/blender/make_helio.py -- [out.blend]
Default output: assets/src/rollers/helio.blend

The look-dev helio() body at catalogue scale: sphere r 0.125, Z x1.06 above the equator, Z x1.18 below with the
neck pinch k = 1 - 0.38 (-z)^1.6, as an all-quad latitude grid (deforms cleanly). A 0.020 m latex knot leans
to the PR-S clip ring (PORT__tension__knot, facing down and to the front), the only Roller port. LOD3 is the
soft-body cage: exactly 242 vertices (20 x 12 rows + 2 poles), clean and manifold. Origin = body sphere centre.
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

TYPE = 'helio'
R, TOP_SQ, BOT_SQ = 0.125, 1.06, 1.18
LATEX = 'kn_latex_plasma'
MASTERS = [LATEX]
KNOT_TOP, KNOT_TIP = Vector((0.0, 0.0, -0.138)), Vector((0.0, -0.0045, -0.1665))
PORT, PORT_DIR = (0.0, -0.006, -0.172), (0.0, -0.707, -0.707)


def pinch(z):
    return 1.0 - 0.38 * (max(0.0, -z) ** 1.6)


def build(lod, q):
    body = Kit()
    if lod == 3:  # the soft-body cage: 20 x 13 -> 242 verts
        body.sphere(R, LATEX, 20, 13, sz_top=TOP_SQ, sz_bot=BOT_SQ, pinch=pinch)
        return {'body': body}
    body.sphere(R, LATEX, seg(64, q, 12, 2), seg(46, q, 8, 2), sz_top=TOP_SQ, sz_bot=BOT_SQ, pinch=pinch)
    d = KNOT_TIP - KNOT_TOP
    L = d.length
    prof = [(0.0, 0.0), (0.0062, 0.002), (0.0078, 0.008), (0.0068, 0.0135), (0.0046, 0.019), (0.0034, 0.0235),
            (0.0022, L - 0.0012), (0.0, L)]
    if lod >= 2:
        prof = [(0.0, 0.0), (0.0075, 0.008), (0.0045, 0.019), (0.0, L)]
    body.lathe([(r, h, LATEX) for r, h in prof], seg(16, q, 6), kit.frame(KNOT_TOP, d))
    # Bone "HELIO" printed on the front shoulder, draped on the upper (x1.06) half of the body.
    decals = [kit.decal_wrap('name.helio.bone', (0.0, -1.0, 0.62), (0, 0, 1), 0.07, shoulder, nu=8, nv=2, ref=R)]
    return kit.add_decals({'body': body}, lod, decals)


def shoulder(d):
    """Body surface along unit direction d (upper half: sphere r 0.125 stretched x1.06 in Z)."""
    t = R / math.sqrt(d.x * d.x + d.y * d.y + (d.z / TOP_SQ) ** 2)
    return d * t


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'M', '2.5,3,2.5', 0.004, 'com', 6000,
        'Balloon: look-dev helio() body at r 0.125. Brief: docs/art/briefs/rollers.md#helio. LOD3 is the '
        '242-vert soft-body cage. Deferred: sk_inflate / sk_pop shape keys and the '
        'heart / pumpkin / star skin bodies.',
        MASTERS, hints={'kn_pop_speed': 6.0, 'kn_pop_heat': 0.0})
    part.build_lods(build, lod0_q=1.0)
    part.col_sphere('0', R, phys='latex', restitution=0.4, friction=0.6)
    part.port('tension', 'knot', PORT, PORT_DIR, 'S', 'both', kind='hook')
    part.emit('pop', 'centre', (0, 0, 0), (0, 0, 1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
