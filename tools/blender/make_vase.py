"""Procedurally build the VASE source file (docs/art/briefs/fun.md, "PANE / VASE: Hero-shatter glass sheet and vase").

Usage: blender -b --factory-startup -P tools/blender/make_vase.py -- [out.blend]
Default output: assets/src/fun/vase.blend

A classic baluster vase (1 x 2 x 1, free body, origin = centre of mass 0.075 above the base, kn_com_explicit): one
48-side lathe of the brief's outer profile with a modelled 4 mm wall, kn_ceramic_plasma glaze outside,
kn_ceramic_bone inside, a Ø 6 mm kn_ceramic_bone lip roll and a tiny potter's mark on the foot. FRAC__01-16: 15
curved wall shards (3 bands x 5 sectors, kn_interior_ceramic edges) and the foot ring intact (the "base survives"
beat).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import decal_atlas, kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'vase'
BASE = -0.075
WALL = 0.004
# (height above the base, outer diameter) from the brief
PROFILE = [(0.000, 0.060), (0.012, 0.056), (0.040, 0.088), (0.070, 0.100), (0.105, 0.088), (0.140, 0.060),
           (0.160, 0.045), (0.180, 0.050), (0.192, 0.056)]
LIP_R, LIP_Z = 0.003, 0.197
PLASMA, BONE, ICER = 'kn_ceramic_plasma', 'kn_ceramic_bone', 'kn_interior_ceramic'
MASTERS = [PLASMA, BONE, ICER, 'kn_decal']
FOOT_TOP = 0.014                    # foot ring chunk: everything below this height


def r_out(h):
    """Outer radius at height h: a Catmull-Rom curve through the brief's control rings (smooth, no kinks)."""
    P = PROFILE
    for i in range(len(P) - 1):
        (h0, d0), (h1, d1) = P[i], P[i + 1]
        if h0 <= h <= h1:
            dm = P[i - 1][1] if i > 0 else 2 * d0 - d1
            dp = P[i + 2][1] if i + 2 < len(P) else 2 * d1 - d0
            t = (h - h0) / (h1 - h0)
            t2, t3 = t * t, t * t * t
            d = 0.5 * ((2 * d0) + (-dm + d1) * t + (2 * dm - 5 * d0 + 4 * d1 - dp) * t2 + (-dm + 3 * d0 - 3 * d1 + dp)
                       * t3)
            return d / 2
    return P[-1][1] / 2


def vessel_profile(nh):
    hs = [0.0] + [PROFILE[-1][0] * (i / nh) for i in range(1, nh + 1)]
    out = [(0.0, BASE, PLASMA), (r_out(0.0) - 0.002, BASE, PLASMA)]
    for h in hs:
        out.append((r_out(h), BASE + h + (0.0015 if h == 0 else 0.0), PLASMA))
    top = BASE + PROFILE[-1][0]
    out += [(r_out(PROFILE[-1][0]) - 0.0005, top + 0.002, BONE), (r_out(PROFILE[-1][0]) - WALL, top + 0.002, BONE)]
    for h in reversed(hs[1:]):
        if h < 0.010:
            break
        out.append((max(0.004, r_out(h) - WALL), BASE + h, BONE))
    out.append((0.0, BASE + 0.008, BONE))
    return out


def vessel(lod, q):
    k = Kit()
    n = seg(48, q, 8) if lod < 3 else 9
    k.lathe(vessel_profile((11, 8, 6, 4)[lod]), n)
    if lod < 3:
        k.torus(r_out(PROFILE[-1][0]) - WALL / 2 + 0.0005, LIP_R, BONE, n, (6, 5, 4)[lod],
                m=kit.at(0, 0, BASE + LIP_Z))
    return k


def build(lod, q):
    pieces = {'body': vessel(lod, q)}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('trim.marks_m3', (0, 0, BASE + 0.006), (0, 0, 1), r_out(0.006) + 0.0003, (0, -1, 0), 0.008,
                           0.0076, nu=3, sub=decal_atlas.marks_sub('potter')),
    ])


def frac_kits():
    out = []
    bands = [FOOT_TOP, 0.065, 0.125, 0.25]
    sectors = 5
    for b in range(3):
        for s in range(sectors):
            k = vessel(0, 0.8)
            mi = k.mi(ICER)
            _m2.frac_cut(k, (0, 0, BASE + bands[b]), (0, 0, -1), mi, bridge=True)
            if bands[b + 1] < 0.2:
                _m2.frac_cut(k, (0, 0, BASE + bands[b + 1]), (0, 0, 1), mi, bridge=True)
            a0 = 2 * math.pi * (s + 0.3 * b) / sectors
            a1 = a0 + 2 * math.pi / sectors
            _m2.frac_cut(k, (0, 0, 0), (math.sin(a0), -math.cos(a0), 0), mi)
            _m2.frac_cut(k, (0, 0, 0), (-math.sin(a1), math.cos(a1), 0), mi)
            out.append(k)
    k = vessel(0, 0.8)  # foot ring (and floor) intact
    _m2.frac_cut(k, (0, 0, BASE + FOOT_TOP), (0, 0, 1), k.mi(ICER), bridge=True)
    out.append(k)
    return out


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '1,2,1', 0.45, 'com', 2800,
        'Baluster vase (free body; origin = the briefed COM 0.075 above the base, kn_com_explicit): one 48-side lathe '
        'of the brief profile with a 4 mm wall, kn_ceramic_plasma glaze outside, kn_ceramic_bone inside and a Ø 6 mm '
        'bone lip roll; potter\'s mark (trim.marks_m3) on the foot. FRAC__01-16: 15 wall shards (3 bands x 5 '
        'sectors, kn_interior_ceramic) + the foot ring intact. Break 0.6 N·s (ceramic). Skin glass = kn_glass body. '
        'UV1 authored for the 1024² set (bake pending). Brief: docs/art/briefs/fun.md#pane--vase.',
        MASTERS, skins='plasma,cobalt,amber,bone,glass', hints={'kn_break_impulse': 0.6, 'kn_macro_chunks': 16},
        pipeline={'kn_com_explicit': True})
    part.build_lods(build, lod0_q=1.0)
    pts = []
    for h in (0.0, 0.04, 0.07, 0.12, 0.2):
        r = (r_out(h) + (LIP_R if h > 0.19 else 0.0)) / math.cos(math.pi / 8)
        for i in range(8):
            a = 2 * math.pi * i / 8
            pts.append((r * math.cos(a), r * math.sin(a), BASE + h))
    part.col_hull('0', pts, phys='ceramic', restitution=0.2, friction=0.4)
    part.emit('shatter', 'centre', (0, 0, 0.02), (0, 0, 1))
    _m2.frac_objects(part, frac_kits())
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
