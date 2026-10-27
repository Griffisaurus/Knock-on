"""Procedurally build the JITTERJUICE source file (docs/art/briefs/boom.md, "JITTERJUICE: Shock-sensitive nitro
flask").

Usage: blender -b --factory-startup -P tools/blender/make_jitterjuice.py -- [out.blend]
Default output: assets/src/boom/jitterjuice.blend

A round-bottom kn_glass flask (1 x 1.5 x 1, free body, origin = the briefed COM 0.05 above the floor, top z 0.10):
a 2.5 mm shell, bulb r 0.0425 at z -0.005 and neck r 0.016 to the lip at z 0.093, corked with a kn_cardboard cork
under a kn_steel_brushed wire twist. A kn_powder_graphite safety cage holds it: a base ring (r 0.05, z -0.05 ...
-0.03) on three FOOT_S bumpers with the kn_led agitation disc (group 0) under the bulb, three open bails and a
neck collar. A kn_paper_red label sleeve on the neck carries the fragile pictogram. CAVITY__liquid (matter fill,
kn_poly_amber, inset 3.5 mm) is the glowing liquid for the container-fill pass. FRAC__01-14: 8 bulb shards and 2
neck halves (kn_interior_glass edges), the cork, the base ring and two bails.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import geom, kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'jitterjuice'
BR, BZ = 0.0425, -0.005          # bulb radius / centre
NR, NZ1 = 0.016, 0.093           # neck radius / lip
T = 0.0025                       # glass wall
FLOOR = -0.05
RING_Z0, RING_Z1, RING_R = -0.047, -0.03, 0.05
COLLAR_Z = (0.028, 0.036)
SLEEVE_Z = (0.037, 0.065)
GLASS, G, RUBBER, RED, CARD, STEEL, LED, AMBER, IGLASS = (
    'kn_glass', 'kn_powder_graphite', 'kn_rubber', 'kn_paper_red', 'kn_cardboard', 'kn_steel_brushed', 'kn_led',
    'kn_poly_amber', 'kn_interior_glass')
MASTERS = [GLASS, G, RUBBER, RED, CARD, STEEL, LED, AMBER, IGLASS, 'kn_decal']
ZJ = BZ + math.sqrt(BR * BR - NR * NR)   # where the bulb meets the neck (outer)


def flask_profile(nb, mat=GLASS):
    """Closed vessel profile (r, z): outer bulb up from the bottom pole, neck, rolled lip, inner surface back down."""
    out = [(0.0, BZ - BR, mat)]
    a_top = math.asin((ZJ - BZ) / BR)
    for i in range(1, nb + 1):
        a = -math.pi / 2 + (a_top + math.pi / 2) * i / nb
        out.append((BR * math.cos(a), BZ + BR * math.sin(a), mat))
    out += [(NR, ZJ + 0.004, mat), (NR, NZ1 - 0.002, mat), (NR + 0.0012, NZ1 - 0.0005, mat), (NR - 0.0005, NZ1, mat),
            (NR - T, NZ1 - 0.0008, mat), (NR - T, ZJ + 0.004, mat)]
    ri = BR - T
    zji = BZ + math.sqrt(ri * ri - (NR - T) ** 2)
    a_top_i = math.asin((zji - BZ) / ri)
    for i in range(nb, 0, -1):
        a = -math.pi / 2 + (a_top_i + math.pi / 2) * i / nb
        out.append((ri * math.cos(a), BZ + ri * math.sin(a), mat))
    out.append((0.0, BZ - ri, mat))
    return out


def glass_kit(lod, q):
    k = Kit()
    if lod < 3:
        k.lathe(flask_profile((12, 8, 4)[lod]), seg(40, q, 8))
    else:  # LOD3: opaque-ready solid (outer surface only)
        prof = [(0.0, BZ - BR, GLASS)] + [(BR * math.cos(a), BZ + BR * math.sin(a), GLASS)
                                          for a in (-0.9, 0.0, 0.7)] + [(NR, NZ1, GLASS), (0.0, NZ1, GLASS)]
        k.lathe(prof, 6)
    return k


def cork(k, lod, q):
    n = seg(18, q, 6)
    k.cyl(NR - T + 0.0004, NZ1 - 0.006, NZ1 + 0.006, CARD, n, bev=0.0025 if lod < 3 else 0.0, bseg=2)
    if lod < 2:  # wire twist: a band round the cork crown + two legs to the lip
        k.torus(NR - T + 0.0008, 0.0007, STEEL, n, 4, m=kit.at(0, 0, NZ1 + 0.004))
        for s in (-1, 1):
            k.sweep([(s * (NR - T + 0.0008), 0, NZ1 + 0.004), (s * (NR + 0.0012), 0, NZ1 + 0.0005),
                     (s * (NR + 0.0016), 0, NZ1 - 0.004)], 0.0006, 4, STEEL)
        k.cyl(0.0012, NZ1 + 0.0055, NZ1 + 0.0072, STEEL, 6)


def base_ring(k, lod, q):
    n = seg(40, q, 8)
    k.lathe([(0.036, RING_Z0, G), (RING_R - 0.003, RING_Z0, G), (RING_R, RING_Z0 + 0.003, G),
             (RING_R, RING_Z1 - 0.003, G), (RING_R - 0.003, RING_Z1, G), (0.036, RING_Z1, G)], n, closed=True)
    k.cyl(0.037, RING_Z0 + 0.001, RING_Z0 + 0.006, G, n)


BAIL_A = (90.0, 210.0, 330.0)


def bail_path(a_deg, n):
    a = math.radians(a_deg)
    d = Vector((math.cos(a), math.sin(a), 0))
    pts = []
    z0, z1 = RING_Z1 - 0.002, COLLAR_Z[0] + 0.002
    for i in range(n + 1):
        t = i / n
        z = z0 + (z1 - z0) * t
        if z < BZ:
            r = BR + 0.0045
        else:
            r = math.sqrt(max(0.0, BR * BR - (z - BZ) ** 2)) + 0.0045
        r = max(r, NR + 0.004)
        if t == 0:
            r = RING_R - 0.005
        pts.append(tuple(d * r + Vector((0, 0, z))))
    return pts


def bail(k, a, lod, q):
    k.sweep(bail_path(a, (10, 6, 4, 2)[lod]), 0.0022, seg(8, q, 4) if lod < 3 else 4, G)


def build(lod, q):
    flask = glass_kit(lod, q)
    cage = Kit()
    n = seg(28, q, 8) if lod < 3 else 6
    if lod < 3:
        base_ring(cage, lod, q)
        cage.cyl(NR + 0.005, COLLAR_Z[0], COLLAR_Z[1], G, n, bev=0.0012 if lod < 2 else 0.0, bseg=1)
    else:
        cage.cyl(RING_R, RING_Z0, RING_Z1, G, 6)
    for a in BAIL_A:
        bail(cage, a, lod, q)
    for i in range(3):
        a = math.radians(30 + 120 * i)
        _m2.foot(cage, 'S', 0.043 * math.cos(a), 0.043 * math.sin(a), min(1.0, q), lod, z0=FLOOR)
    cage.cyl(0.024, RING_Z0 + 0.005, RING_Z0 + 0.0075, LED, n)
    cage.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.25))
    top = Kit()
    cork(top, lod, q)
    top.cyl(NR + 0.0007, SLEEVE_Z[0], SLEEVE_Z[1], RED, n, bev=0.0006 if lod < 2 else 0.0, bseg=1)
    pieces = {'flask': flask, 'cage': cage, 'top': top}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('picto.fragile.warn', (0, 0, sum(SLEEVE_Z) / 2), (0, 0, 1), NR + 0.0007, (0, -1, 0), 0.022,
                           0.022, nu=6),
    ])


def frac_kits():
    out = []
    q = 0.8
    # 8 bulb shards: 4 sectors x 2 bands, below the neck join
    for band in range(2):
        for s in range(4):
            k = glass_kit(0, q)
            mi = k.mi(IGLASS)
            _m2.frac_cut(k, (0, 0, ZJ), (0, 0, 1), mi, bridge=True)       # keep below the neck
            a0 = math.radians(-90 + 90 * s + 20 * band)
            a1 = a0 + math.pi / 2
            _m2.frac_cut(k, (0, 0, 0), (math.sin(a0), -math.cos(a0), 0), mi)
            _m2.frac_cut(k, (0, 0, 0), (-math.sin(a1), math.cos(a1), 0), mi)
            zc = BZ - 0.006
            _m2.frac_cut(k, (0, 0, zc), (0, 0, 1) if band == 0 else (0, 0, -1), mi)
            out.append(k)
    for sx in (-1, 1):  # 2 neck halves
        k = glass_kit(0, q)
        mi = k.mi(IGLASS)
        _m2.frac_cut(k, (0, 0, ZJ), (0, 0, -1), mi, bridge=True)
        _m2.frac_cut(k, (0, 0, 0), (sx, 0, 0), mi)
        out.append(k)
    k = Kit()
    cork(k, 0, q)
    out.append(k)
    k = Kit()
    base_ring(k, 0, q)
    k.cyl(0.024, RING_Z0 + 0.005, RING_Z0 + 0.0075, LED, 24)
    out.append(k)
    for a in BAIL_A[:2]:  # two bent bails (the third stays on the ring chunk's side)
        k = Kit()
        k.sweep([tuple(Vector(p) + Vector((0.0, 0.0, 0.004 * i * i))) for i, p in enumerate(bail_path(a, 8))],
                0.0022, 6, G)
        out.append(k)
    return out


def cavity(part):
    k = Kit()
    ri = BR - T - 0.0035
    prof = [(0.0, BZ - ri, AMBER)]
    for i in range(1, 12):
        a = -math.pi / 2 + math.pi * 0.9 * i / 11
        prof.append((ri * math.cos(a), BZ + ri * math.sin(a), AMBER))
    zt = BZ + ri * math.sin(-math.pi / 2 + math.pi * 0.9)
    prof += [(NR - T - 0.0035, zt + 0.004, AMBER), (NR - T - 0.0035, SLEEVE_Z[0], AMBER), (0.0, SLEEVE_Z[0], AMBER)]
    k.lathe(prof, 32)
    ob = geom.object_from_bmesh('CAVITY__liquid', k.bm, [part.mats[AMBER]], template.get_collection('CAVITY'))
    ob['matter'] = 'fill'
    ob['capacity'] = 0.22
    ob['fill'] = 0.75
    return ob


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'S', '1,1.5,1', 0.4, 'com', 2800,
        'Shock-sensitive nitro flask (free body; origin = the briefed COM 0.05 above the floor, kn_com_explicit): '
        '2.5 mm kn_glass round-bottom flask (bulb r 0.0425 at z -0.005, neck r 0.016 to z 0.093), kn_cardboard cork + '
        'steel wire twist, kn_powder_graphite cage (base ring on 3 x FOOT_S with the kn_led agitation disc, group 0; '
        'three open bails; neck collar), kn_paper_red neck sleeve with the fragile pictogram. CAVITY__liquid (fill, '
        'kn_poly_amber, 0.22 L, fill 0.75). FRAC__01-14 (8 bulb shards, 2 neck halves, cork, base ring, 2 bent '
        'bails). Impact only, no fuse. UV1 authored for the 1024² set (bake pending). '
        'Brief: docs/art/briefs/boom.md#jitterjuice.',
        MASTERS, led_groups='0:agitation', skins='classic',
        hints={'kn_macro_chunks': 14, 'kn_yield': 1.5, 'kn_break_impulse': 0.15},
        pipeline={'kn_com_explicit': True})
    part.build_lods(build, lod0_q=1.2)
    part.col_sphere('bulb', BR, (0, 0, BZ), phys='glass', restitution=0.3, friction=0.4)
    part.col_cyl('neck', NR, 0.06, (0, 0, 0.065), 'z', phys='glass', restitution=0.3, friction=0.4)
    part.col_cyl('base', RING_R, 0.02, (0, 0, -0.04), 'z', phys='powder', restitution=0.3, friction=0.4)
    pts = [(0.052 * math.cos(2 * math.pi * i / 12), 0.052 * math.sin(2 * math.pi * i / 12), z)
           for i in range(12) for z in (FLOOR, 0.0)] + [(0.019 * math.cos(2 * math.pi * i / 8),
                                                         0.019 * math.sin(2 * math.pi * i / 8), 0.101) for i in range(8)]
    part.sensor('impact', 'shock', pts, threshold=0.15, near_miss=0.08)
    part.emit('boom', 'core', (0, 0, 0), (0, 0, 1))
    part.emit('fizz', 'surface', (0, 0, 0.02), (0, 0, 1))
    cavity(part)
    _m2.frac_objects(part, frac_kits())
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
