"""Procedurally build the BRIK source file (docs/art/briefs/frame.md, "BRIK: Brush-laid brick").

Usage: blender -b --factory-startup -P tools/blender/make_brik.py -- [out.blend]
Default output: assets/src/frame/brik.blend

A full brick 0.20 x 0.10 x 0.10 (W x H x D), origin = centre (free body), kn_brick only (one slot, the
instancing-heavy rule). Every face has the 5 mm tooled perimeter chamfer as a 3-segment round, which the
shared brick trim's mortar band covers, so two touching bricks read a 10 mm joint. LOD3 is the 12-tri box.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'brik'
SIZE = (0.20, 0.10, 0.10)   # x, y, z
BRICK = 'kn_brick'
MASTERS = [BRICK]


def build(lod, q):
    b = Kit()
    cs = (3, 2, 1, 0)[lod]
    r = 0.005 if lod < 3 else 0.0
    # LOD1 keeps the 2-segment round on top and chamfers the (rarely seen) underside
    b.prism(kit.outline_rrect(SIZE[0], SIZE[1], r, cs), -SIZE[2] / 2, SIZE[2] / 2, BRICK, bt=r, bb=r,
            bseg=1 if lod == 1 else cs, bseg_top=cs)
    return {'brick': b}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '2,1,1', 3.6, 'com', 300,
        'Brush-laid brick (full). Brief: docs/art/briefs/frame.md#brik. Deferred: the shared 1024 brick trim '
        '(BaseColor/ORM/Normal + mortar mask), the half brick and the chip_a / chip_b alternates.',
        MASTERS, hints={'kn_mortar_break': 12.0})
    part.build_lods(build, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('0', SIZE, (0, 0, 0), phys='brick', convex_radius=0.003, restitution=0.05, friction=0.7)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
