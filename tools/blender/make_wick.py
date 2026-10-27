"""Procedurally build the WICK source file (docs/art/briefs/boom.md, "WICK: Candle on a graphite stand").

Usage: blender -b --factory-startup -P tools/blender/make_wick.py -- [out.blend]
Default output: assets/src/boom/wick.blend

A graphite chamberstick puck (Ø 0.10 x 0.035, rounded rim, 35 mm front flat for the PR-S heat ring) on three
4 mm rubber feet, a raised drip cup, a kn_wax column (Ø 0.045, z 0.035-0.165, soft rim and a shallow molten
pool) and a kn_rope wick (Ø 3 mm) with a 4 mm charred kn_rubber tip ending at z 0.181. The flame is VFX
(EMIT__flame__wick at z 0.18), never geometry; the candle top stays 15 mm under the flame base.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'wick'
PUCK_R, PUCK_TOP, FACET_Y, FEET_H = 0.05, 0.035, -0.047, 0.004
WAX_R, WAX_TOP = 0.0225, 0.165
GRAPHITE, RUBBER, WAX, ROPE = 'kn_powder_graphite', 'kn_rubber', 'kn_wax', 'kn_rope'
MASTERS = [GRAPHITE, RUBBER, WAX, ROPE]
FLAME = (0.0, 0.0, 0.18)


def build(lod, q):
    stand = Kit()
    n = seg(64, q, 8)
    bseg = (3, 2, 1, 1)[lod]
    stand.prism(kit.outline_circle_flat(PUCK_R, n, FACET_Y), FEET_H, PUCK_TOP, GRAPHITE,
                bt=(0.004, 0.004, 0.003, 0.0)[lod], bb=(0.0015, 0.001, 0.0, 0.0)[lod], bseg=bseg)
    # drip cup: raised rim round the candle foot
    cup = [(0.0, 0.0330), (0.0340, 0.0330), (0.0356, 0.0350), (0.0356, 0.0383), (0.0346, 0.0396),
           (0.0326, 0.0396), (0.0314, 0.0384), (0.0314, 0.0366), (0.0, 0.0366)]
    if lod >= 2:
        cup = [(0.0, 0.0330), (0.0356, 0.0330), (0.0356, 0.0396), (0.0314, 0.0396), (0.0314, 0.0366), (0.0, 0.0366)]
    stand.lathe([(r, z, GRAPHITE) for r, z in cup], seg(56, q, 8))
    if lod < 3:  # three FOOT_M-style bumpers, removed at LOD3 (shared_kit §3)
        for k in range(3):
            a = math.radians(90 + 120 * k)
            fx, fy = 0.034 * math.cos(a), 0.034 * math.sin(a)
            stand.sphere(0.006, RUBBER, seg(14, q, 6), (6, 4, 2, 2)[lod], m=kit.at(fx, fy, FEET_H + 0.0005),
                         sz_top=0.8, sz_bot=0.75)
    candle = Kit()
    b = 0.0022
    wax = [(0.0, 0.0345, WAX), (WAX_R, 0.0345, WAX)]
    wax += kit.arc_pts(WAX_R, WAX_TOP, b, bseg, False, WAX, WAX)
    if lod < 3:  # molten pool: a shallow dish toward the wick
        wax += [(0.012, WAX_TOP - 0.0006, WAX), (0.004, WAX_TOP - 0.0016, WAX), (0.0, WAX_TOP - 0.0018, WAX)]
    else:
        wax += [(0.0, WAX_TOP, WAX)]
    candle.lathe(kit.dedupe(wax), seg(56, q, 8))
    ws = (10, 8, 6, 4)[lod]
    wick = [(0.0, 0.1615, ROPE), (0.0015, 0.1615, ROPE), (0.0015, 0.1770, RUBBER), (0.0017, 0.1785, RUBBER),
            (0.0011, 0.1803, RUBBER), (0.0, 0.1810, RUBBER)]
    candle.lathe(wick, ws)
    # Amber / graphite stripe ring on the puck side, broken by the front port facet (320° from the back);
    # the flammable pictogram sits on the puck top, front-left of the drip cup. No name plate (not in the brief).
    span = 2 * math.pi - 2 * math.acos(-FACET_Y / PUCK_R) - 0.04
    band_h = 0.014
    tile_v = band_h / (span * PUCK_R) * 1016 / 120          # keep the stripes square: px/m equal in u and v
    decals = [
        kit.decal_cylinder('trim.hazard_r', (0, 0, 0.0195), (0, 0, 1), PUCK_R, (0, 1, 0), 0, band_h, nu=48,
                           span=span, sub=(0.0, 0.0, 1.0, tile_v)),
        kit.decal_plane('picto.flammable.warn', (-0.029, -0.029, PUCK_TOP), (0, 0, 1), (0, 1, 0), 0.007, 0.007),
    ]
    return kit.add_decals({'stand': stand, 'candle': candle}, lod, decals)


def capsule_pts(r, z0, z1, n=10):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        for z in (z0, z1):
            pts.append((r * math.cos(a), r * math.sin(a), z))
    pts += [(0, 0, z0 - r), (0, 0, z1 + r)]
    for k in range(n):
        a = 2 * math.pi * k / n
        for z, s in ((z0, -1), (z1, 1)):
            pts.append((r * 0.7 * math.cos(a), r * 0.7 * math.sin(a), z + s * r * 0.7))
    return pts


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '1,2,1', 0.35, 'bottom', 3500,
        'Candle on a graphite stand. Brief: docs/art/briefs/boom.md#wick. Wax uses the kn_wax master '
        '(bone default, skins tint it; "classic" red is a tint). Decals: rim stripe ring + flammable '
        'pictogram (no name plate in the brief); sk_drip / sk_pool shape keys deferred.',
        MASTERS)
    part.build_lods(build, lod0_q=1.15)
    part.col_cyl('base', PUCK_R, PUCK_TOP, (0, 0, PUCK_TOP / 2), 'z', phys='powder', restitution=0.2, friction=0.7)
    part.col_cyl('candle', WAX_R, WAX_TOP - PUCK_TOP, (0, 0, (WAX_TOP + PUCK_TOP) / 2), 'z', phys='paper',
                 restitution=0.2, friction=0.7)
    part.port('heat', 'flame', (0, FACET_Y, 0.019), (0, -1, 0), 'S', 'both')
    # ignition volume round the 25 mm hot core (z 0.18-0.205); capsule r 0.02, z 0.17-0.215
    part.sensor('heat', 'flame', capsule_pts(0.02, 0.19, 0.195))
    part.sensor('air', 'douse', capsule_pts(0.02, 0.19, 0.195), threshold=4.0)
    sph = Kit()
    sph.sphere(0.03, 'x', 12, 6, m=kit.at(*FLAME))
    part.sensor('fluid', 'douse', [tuple(v.co) for v in sph.bm.verts], threshold=0.005)
    sph.free()
    part.emit('flame', 'wick', FLAME, (0, 0, 1))
    part.emit('smoke', 'wick', FLAME, (0, 0, 1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
