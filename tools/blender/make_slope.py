"""Procedurally build the SLOPE source file (docs/art/briefs/frame.md, "SLOPE: Ramp").

Usage: blender -b --factory-startup -P tools/blender/make_slope.py -- [out.blend]
Default output: assets/src/frame/slope.blend

Authored flat at the default 0.60 x 0.05 x 0.20 (X x H x Y), origin at the bottom centre of the footprint; the
engine tilts the whole mesh by `angle` about the low edge (x = -L/2, z = 0, along Y) with parts-data artAt().
The deck side profile: a Bone deck with the fixed 0.08 m knife-edge nose at -X (top tapers 0.05 -> 0.006, the
bottom stays on z = 0 so the tip stays flush at every angle) and the r 0.02 bullnose at +X; Cobalt side fascia,
two low Cobalt rails stopping 0.08 m short of the nose with M3 screws at their ends, and two 10 x 3 mm rubber
strips underneath. COL__box__deck is exactly the parts-data deck box (0.6 x 0.2 x 0.05 at z 0.025).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'slope'
L, W, H = 0.60, 0.20, 0.05
NOSE, TIP = 0.08, 0.006
BULL = 0.02
RAIL_W, RAIL_H = 0.015, 0.004   # brief rails stand 0.015 proud; parts-data has no rail collider, so they stay low
BONE, COBALT, RUBBER, STEEL = 'kn_powder_bone', 'kn_powder_cobalt', 'kn_rubber', 'kn_steel_brushed'
MASTERS = [BONE, COBALT, RUBBER, STEEL]


def bullnose_profile(cs):
    """Side profile in the Y_AXIS prism frame, points (z, x), CCW: the +X end is two r 0.02 corners joined
    by the flat end face; the -X end is the knife-edge nose."""
    pts = [(0.0, -L / 2), (0.0, L / 2 - BULL)]
    for k in range(1, cs + 1):  # bottom corner: centre (BULL, L/2 - BULL)
        a = -math.pi / 2 + math.pi / 2 * k / cs
        pts.append((BULL + BULL * math.sin(a), L / 2 - BULL + BULL * math.cos(a)))
    for k in range(0, cs + 1):  # top corner: centre (H - BULL, L/2 - BULL)
        a = math.pi / 2 * k / cs
        pts.append((H - BULL + BULL * math.sin(a), L / 2 - BULL + BULL * math.cos(a)))
    pts += [(H, -L / 2 + NOSE), (TIP, -L / 2)]
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > 1e-7 or abs(out[-1][1] - p[1]) > 1e-7:
            out.append(p)
    area = sum(out[i][0] * out[(i + 1) % len(out)][1] - out[(i + 1) % len(out)][0] * out[i][1] for i in range(len(out)))
    return out if area > 0 else list(reversed(out))


def build(lod, q):
    cs = max(1, min(6, int(round(5 * q))))
    deck = Kit()
    bev = (0.002, 0.002, 0.0015, 0.0)[lod]
    deck.prism(bullnose_profile(cs), -W / 2, W / 2, BONE, bt=bev, bb=bev, bseg=max(1, cs - 2), m=kit.Y_AXIS,
               top=COBALT, bot=COBALT)
    x0, x1 = -L / 2 + NOSE, L / 2 - BULL
    if True:  # low Cobalt rails along both edges, stopping 0.08 m short of the nose (plain boxes at LOD3)
        for s in (-1, 1):
            deck.rbox((x1 - x0, RAIL_W, RAIL_H + 0.001),
                      ((x0 + x1) / 2, s * (W / 2 - RAIL_W / 2), H + RAIL_H / 2 - 0.0005),
                      0.002 if lod < 2 else 0.0, COBALT, cseg=max(1, cs - 3) if lod < 2 else 0,
                      rz=0.0015 if lod < 2 else 0.0)
    if lod < 2:  # rubber underside strips 10 x 3 mm, clear of the nose
        for s in (-1, 1):
            deck.rbox((x1 - x0, 0.01, 0.003), ((x0 + x1) / 2, s * 0.06, 0.0015), 0.002, RUBBER, cseg=1, rz=0.0)
    if lod == 0:  # M3 button heads at the rail ends
        prof = [(0.0, -0.0005, STEEL), (0.00275, -0.0005, STEEL), (0.00275, 0.0004, STEEL), (0.0018, 0.0011, STEEL),
                (0.0, 0.00125, STEEL)]
        for x in (x0 + 0.01, x1 - 0.01):
            for s in (-1, 1):
                deck.lathe(prof, 8, kit.at(x, s * (W / 2 - RAIL_W / 2), H + RAIL_H))
    # Name plate on the front fascia (bone ink on Cobalt), in the constant-height part of the deck.
    decals = [kit.decal_plane('name.slope.bone', (0.06, -W / 2, H / 2), (0, -1, 0), (0, 0, 1), 0.12)]
    return kit.add_decals({'deck': deck}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '6,0.5,2', 2.0, 'bottom', 1800,
        'Ramp, authored flat at 0.60 x 0.20; the engine tilts it about the low edge (parts-data artAt). '
        'Brief: docs/art/briefs/frame.md#slope. Rails are a 4 mm Cobalt lip (brief 15 mm) because parts-data has no '
        'rail colliders. Static; kn_mass_hint is a nominal 2 kg. Deferred: 9-slice resize, UV2 grip-rib normal.',
        MASTERS)
    part.build_lods(build, lod0_q=1.2)
    part.col_box('deck', (L, W, H), (0, 0, H / 2), phys='powder', restitution=0.3, friction=0.5)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
