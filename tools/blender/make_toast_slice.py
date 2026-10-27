"""Procedurally build the TOAST SLICE source file: the free body TOAST CANNON launches (docs/art/briefs/
contraptions.md, "TOAST CANNON": slices are 2 bodies, 0.03 kg each, phys paper, COL__box__slice 0.09 x 0.012 x 0.10;
pooled like YOLK, M4_PLAN contract 4).

Usage: blender -b --factory-startup -P tools/blender/make_toast_slice.py -- [out.blend]
Default output: assets/src/contraptions/toast_slice.blend

A golden, cartoon-perfect slice (never burnt): a convex loaf silhouette (0.09 wide, 0.10 tall, domed top) 12 mm
thick, kn_paper_tan faces with a rounded kn_cardboard crust. Origin = centre of mass (the slice centre). The same
slice_kit() builds the two slices riding TOAST CANNON's carriage, so the launched body matches the loaded one.
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

TYPE = 'toast_slice'
TAN, CARD = 'kn_paper_tan', 'kn_cardboard'
MASTERS = [TAN, CARD]
W, H, T = 0.09, 0.10, 0.012


def outline(n_side, n_dome):
    """Convex loaf silhouette in (x, z) about the slice centre, CCW: flat-ish bottom with 8 mm corners, straight
    sides flaring slightly, a domed top that spans the full width."""
    hw, hb = W / 2, W / 2 - 0.004
    zb, zs = -H / 2, H / 2 - 0.030          # bottom, top of the straight sides
    pts = []
    rc = 0.008
    for k in range(n_side + 1):              # bottom-right corner
        a = -math.pi / 2 + math.pi / 2 * k / n_side
        pts.append((hb - rc + rc * math.cos(a), zb + rc + rc * math.sin(a)))
    for k in range(n_dome + 1):              # dome: an ellipse arc from the right shoulder over the top
        a = math.pi * k / n_dome
        pts.append((hw * math.cos(a), zs + 0.030 * math.sin(a)))
    for k in range(n_side + 1):              # bottom-left corner
        a = math.pi + math.pi / 2 * k / n_side
        pts.append((-hb + rc + rc * math.cos(a), zb + rc + rc * math.sin(a)))
    return kit.dedupe([(x, z, None) for x, z in pts])


def slice_kit(k, lod, q, centre=(0.0, 0.0, 0.0)):
    """One slice into kit k at `centre` (faces toward ±Y)."""
    if lod >= 3:
        k.rbox((W, T, H), centre, 0.0, TAN, cseg=1)
        return
    pts = [(x, z) for x, z, _ in outline(seg(3, q, 1), seg(12, q, 4))]
    # FRONT_OUT: local (x, y) -> Blender (x, z), local z -> -Y, so the loaf stands upright facing -Y
    k.prism(pts, -T / 2, T / 2, TAN, side=CARD, bt=0.0018 if lod < 2 else 0.0, bb=0.0018 if lod < 2 else 0.0,
            bseg=(2, 1, 1)[lod], m=kit.at(*centre) @ kit.FRONT_OUT)


def build(lod, q):
    k = Kit()
    slice_kit(k, lod, q)
    return {'slice': k}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'S', '0.9,1,0.12', 0.03, 'com', 400,
        'Launched toast slice (free body, origin = COM, pooled dormant like YOLK): convex loaf silhouette 0.09 x 0.10 '
        'with a domed top, 12 mm thick, kn_paper_tan faces, rounded kn_cardboard crust; golden, never burnt. The '
        'loaded slices on TOAST CANNON use the same mesh. Brief: docs/art/briefs/contraptions.md#toast-cannon.',
        MASTERS)
    part.build_lods(build, lod0_q=1.0)
    part.col_box('slice', (W, T, H), (0, 0, 0), phys='paper', restitution=0.2, friction=0.6)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
