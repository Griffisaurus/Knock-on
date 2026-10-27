"""Procedurally build the STACKER source file (docs/art/briefs/fun.md, "STACKERS: Hardwood block for wobbly towers").

Usage: blender -b --factory-startup -P tools/blender/make_stacker.py -- [out.blend]
Default output: assets/src/fun/stacker.blend

A warm oak block (1 x 0.3 x 3, free body, origin = box centre): 0.10 x 0.03 x 0.30 with the grain along the 0.30
length (Blender Y), a 4.5 mm pillowed bevel in three rim segments, one kn_wood_oak slot (skin `walnut` swaps the
master). LOD0 188 tris, LOD1 92, LOD2 44, LOD3 the 12-tri box floor. End grain on the 0.10 x 0.03 faces; the shared
1024² oak trim (grain along Y, polish on the ends) comes from the texture set, with a per-instance UV offset in the
engine.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'stacker'
W, H, D = 0.10, 0.03, 0.30
BEV = 0.0045
OAK = 'kn_wood_oak'
MASTERS = [OAK]


def build(lod, q):
    k = Kit()
    if lod == 0:
        k.prism(kit.outline_rrect(W, D, BEV, 2), -H / 2, H / 2, OAK, bt=BEV, bb=BEV, bseg=3)
    elif lod == 1:
        k.prism(kit.outline_rrect(W, D, BEV, 1), -H / 2, H / 2, OAK, bt=BEV, bb=BEV, bseg=2)
    elif lod == 2:
        k.prism(kit.outline_rrect(W, D, BEV, 1), -H / 2, H / 2, OAK, bt=BEV, bb=0.0, bseg=1)
    else:
        k.prism(kit.outline_rrect(W, D, 0.0, 0), -H / 2, H / 2, OAK)
    return {'body': k}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '1,0.3,3', 0.60, 'com', 220,
        'Hardwood stacking block (free body, origin = box centre): 0.10 x 0.03 x 0.30, grain along the length (Y), '
        '4.5 mm bevel; one kn_wood_oak slot (skin walnut). LOD0 188 / LOD1 92 / LOD2 44 / LOD3 12-tri box. The shared '
        '1024² oak trim with end grain and end-face polish is the texture set (bake pending; UV1 authored). '
        'Brief: docs/art/briefs/fun.md#stackers.',
        MASTERS, skins='oak,walnut')
    part.build_lods(build, lod0_q=1.0, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('0', (W, D, H), (0, 0, 0), phys='wood', restitution=0.1, friction=0.55, convex_radius=0.002)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
