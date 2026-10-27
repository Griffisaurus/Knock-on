"""Procedurally build the TOPPLE TILES source file (docs/art/briefs/fun.md, "TOPPLE TILES").

Usage: blender -b --factory-startup -P tools/blender/make_topple_tile.py -- [out.blend]
Default output: assets/src/fun/topple_tile.blend

The look-dev topple_tile() shape: a bone tile 0.03 x 0.15 x 0.075 (thin axis X, so it falls along +-X),
origin = box centre, 4 mm bevel, plus two edge loops at the band edges (band centre z +0.025, 12 mm tall,
flush colour). One slot (kn_powder_bone); the band and top-cap faces carry the vertex colour `tint`
(R = band, G = lead-tile top cap) that the engine multiplies by the instance colour. LOD3 is a 12-tri box.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'topple_tile'
W, D, H = 0.03, 0.075, 0.15
BAND_Z, BAND_H = 0.025, 0.012
BONE = 'kn_powder_bone'
MASTERS = [BONE]


def tint(centre, normal, _master=None):
    band = abs(centre.z - BAND_Z) < BAND_H / 2 and abs(normal.z) < 0.7
    top = centre.z > H / 2 - 0.0045 and normal.z > 0.3
    return (1.0 if band else 0.0, 1.0 if top else 0.0, 0.0, 1.0)


def build(lod, q):
    b = Kit()
    if lod == 3:
        b.prism(kit.outline_rrect(W, D, 0.0, 0), -H / 2, H / 2, BONE)
    else:  # the band-edge loops survive to LOD2 so a run still reads as a dotted line of colour
        cs, bt, bb, bs = ((3, 0.004, 0.004, 2), (2, 0.004, 0.0, 1), (1, 0.0, 0.0, 1))[lod]
        b.prism(kit.outline_rrect(W, D, 0.004, cs), -H / 2, H / 2, BONE, bt=bt, bb=bb, bseg=bs,
                cuts=(BAND_Z - BAND_H / 2, BAND_Z + BAND_H / 2))
    b.colors['tint'] = tint
    return {'tile': b}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '0.3,1.5,0.75', 0.2, 'com', 280,
        'Brush-laid domino tile. Brief: docs/art/briefs/fun.md#topple-tiles. Band is flush colour via the '
        '`tint` vertex colour (R band, G lead-tile top cap); exporting it as COLOR_0 waits for the engine side.',
        MASTERS)
    part.build_lods(build, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('0', (W, D, H), (0, 0, 0), phys='wood', convex_radius=0.003, restitution=0.15, friction=0.45)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
