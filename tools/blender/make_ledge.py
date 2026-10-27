"""Procedurally build the LEDGE source file (docs/art/briefs/frame.md, "LEDGE: Shelf / platform").

Usage: blender -b --factory-startup -P tools/blender/make_ledge.py -- [out.blend]
Default output: assets/src/frame/ledge.blend

The catalogue LEDGE (0.40 x 0.05 x 0.40, origin bottom centre): a Bone panel with a 6 mm pillowed rim and the
Cobalt 0.05 m edge fascia, an M3 screw in each top corner, and four Ø 0.03 x 3 mm rubber pads under the
corners that stay inside the 0.05 m height. The 0.1 m grid etch is a UV2 tiling normal (deferred).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'ledge'
W, H, PAD = 0.40, 0.05, 0.003
BONE, COBALT, STEEL, RUBBER = 'kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed', 'kn_rubber'
MASTERS = [BONE, COBALT, STEEL, RUBBER]


def build(lod, q):
    b = Kit()
    cs = max(1, min(3, int(round(3 * q)))) if lod == 0 else (0, 2, 2, 1)[lod]
    bs = cs if lod == 0 else (0, 2, 1, 1)[lod]
    r = 0.006 if lod < 3 else 0.0
    b.prism(kit.outline_rrect(W, W, 0.012, cs + 1), PAD, H, BONE, bt=r, bb=r * 0.5, bseg=bs, side=COBALT, top=BONE,
            bot=BONE)
    if lod < 2:  # corner pads; dropped from LOD2 (hidden under the panel)
        for x in (-0.175, 0.175):
            for y in (-0.175, 0.175):
                b.cyl(0.015, 0.0, PAD + 0.0006, RUBBER, seg(16, q, 6) if lod < 2 else 6,
                      bev=0.0008 if lod == 0 else 0.0, bseg=1, bev_bot=0.0008 if lod == 0 else 0.0, m=kit.at(x, y, 0))
    if lod == 0:  # M3 heads: LOD1+ bakes them away (shared_kit §2)
        prof = [(0.0, -0.0005, STEEL), (0.00275, -0.0005, STEEL), (0.00275, 0.0005, STEEL), (0.0021, 0.0012, STEEL),
                (0.0011, 0.0016, STEEL), (0.0, 0.00165, STEEL)]
        for x in (-0.175, 0.175):
            for y in (-0.175, 0.175):
                b.lathe(prof, seg(12, q, 6), kit.at(x, y, H))
    # Name plate on the Cobalt front fascia (bone ink).
    decals = [kit.decal_plane('name.ledge.bone', (0.1, -W / 2, 0.025), (0, -1, 0), (0, 0, 1), 0.08)]
    return kit.add_decals({'panel': b}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '4,0.5,4', 1.5, 'bottom', 600,
        'Shelf / platform at the catalogue 0.40 x 0.40. Brief: docs/art/briefs/frame.md#ledge. Static (anchored); '
        'kn_mass_hint is a nominal 1.5 kg. Deferred: 9-slice resize, UV2 grid-etch normal.',
        MASTERS)
    part.build_lods(build)
    part.col_box('0', (W, W, H), (0, 0, H / 2), phys='powder', convex_radius=0.004, restitution=0.3, friction=0.5)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
