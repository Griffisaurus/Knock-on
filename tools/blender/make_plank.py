"""Procedurally build the PLANK source file (docs/art/briefs/frame.md, "PLANK: Board / beam").

Usage: blender -b --factory-startup -P tools/blender/make_plank.py -- [out.blend]
Default output: assets/src/frame/plank.blend

The catalogue PLANK (parts-data: 0.10 x 0.10 x 1.00 m, length along Y), origin = centre (free body):
2 x plank__end (0.05 m) + 9 x plank__mid (0.10 m) authored as one oak beam with the 4 mm / 4-segment bevel
following the 0.1 m cross-section, Cobalt-dipped 15 mm at both ends. Grain runs along the length (oak master).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'plank'
W, L, DIP, BEV = 0.10, 1.00, 0.015, 0.004
OAK, COBALT = 'kn_wood_oak', 'kn_powder_cobalt'
MASTERS = [OAK, COBALT]
ALONG_Y = kit.rot_x(-90)  # local z -> Blender +Y


def build(lod, q):
    b = Kit()
    cs, bs = ((4, 4), (3, 2), (1, 2), (0, 1))[lod]
    r = BEV if lod < 3 else 0.0
    cut = L / 2 - DIP
    cuts = (-cut, cut) if lod < 3 else ()   # LOD3: a 12-tri box, the dip survives on the end caps
    b.prism(kit.outline_rrect(W, W, r, cs), -L / 2, L / 2, OAK, bt=r, bb=r, bseg=bs, m=ALONG_Y,
            top=COBALT, bot=COBALT, cuts=cuts, side_fn=lambda z: COBALT if abs(z) > cut else OAK)
    # Bone "PLANK" stencil once per long side (beams >= 0.5 m), reading along the beam.
    decals = [kit.decal_plane('name.plank.bone', (s * W / 2, 0, 0), (s, 0, 0), (0, 0, 1), 0.15) for s in (-1, 1)]
    decals += [kit.decal_plane('name.plank.bone', (0, 0, s * W / 2), (0, 0, s), (-s, 0, 0), 0.15) for s in (-1, 1)]
    return kit.add_decals({'beam': b}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '1,1,10', 6.0, 'com', 960,
        'Board / beam at the catalogue 1.0 m. Brief: docs/art/briefs/frame.md#plank. Modules (end 0.05 + mid '
        '0.1) are one beam here; the engine-side resize, the 1024 oak trim, the walnut '
        'skin and the FRAC__0..9 splinter set are deferred.',
        MASTERS, hints={'kn_break_impulse': 18.0})
    part.build_lods(build, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('0', (W, L, W), (0, 0, 0), phys='wood', convex_radius=0.004, restitution=0.2, friction=0.55)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
