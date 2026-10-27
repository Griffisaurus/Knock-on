"""Procedurally build the YOLK source file (docs/art/briefs/rollers.md, "YOLK: Egg").

Usage: blender -b --factory-startup -P tools/blender/make_yolk.py -- [out.blend]
Default output: assets/src/rollers/yolk.blend

A warm tan hen's egg (Ø 0.045 x 0.060, true egg profile: blunt end up, pointed end down, aspect 0.75) in one
kn_paper_tan shell with the Ignition "KN" stamp decal on its side. Free body: origin = the centre of mass, 2 mm toward
the blunt end from the geometric centre (kn_com_explicit). COL__hull__0 is a 47-point egg hull so it rolls in curves.
FRAC__01-14 are the 14 DEB_eggshell bits (shared_kit.md §8: curved shell pieces 4-20 mm, 20-60 tris, kn_paper_tan
outside, kn_interior_ceramic inside and on the broken rims): Spectacle debris spawned with the splat decal, NOT sim
chunks (the brief: "splat, no chunks"); they export to yolk.frac.glb with their centres and hulls in
assets/build/parts/yolk/frac_yolk.ts (kept out of packages/parts-data on purpose).
"""
import math
import os
import random
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import geom, kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'yolk'
TAN, INNER = 'kn_paper_tan', 'kn_interior_ceramic'
MASTERS = [TAN, INNER]
L, R_MAX, ZC = 0.060, 0.0225, -0.002     # length, max radius, geometric centre (the origin is the COM, 2 mm up)
K = 0.20                                  # egg asymmetry: wider toward the blunt (+Z) end
_scale = None


def _raw(t):
    return math.sqrt(max(0.0, 1 - t * t)) * (1 + K * t)


def radius(t):
    """Egg radius at t in [-1 (pointed, bottom), +1 (blunt, top)], scaled so the widest point is R_MAX."""
    global _scale
    if _scale is None:
        _scale = R_MAX / max(_raw(i / 1000 - 1) for i in range(2001))
    return _raw(t) * _scale


def z_of(t):
    return ZC + t * L / 2


def profile(rings):
    pts = []
    for i in range(rings + 1):
        th = math.pi * i / rings          # cosine spacing: denser near the poles
        t = -math.cos(th)
        pts.append((0.0 if i in (0, rings) else radius(t), z_of(t)))
    return pts


def surface(d):
    """Point where the ray from the origin along unit d meets the egg (bisection on the profile)."""
    d = Vector(d).normalized()
    lo, hi = 0.0, 0.05
    for _ in range(40):
        m = (lo + hi) / 2
        p = d * m
        t = (p.z - ZC) / (L / 2)
        inside = abs(t) < 1 and math.hypot(p.x, p.y) < radius(t)
        if inside:
            lo = m
        else:
            hi = m
    return d * lo


def normal_at(p):
    eps = 1e-4
    t = (p.z - ZC) / (L / 2)
    rr = math.hypot(p.x, p.y)
    dr = (radius(min(1, t + eps)) - radius(max(-1, t - eps))) / (2 * eps) / (L / 2)
    radial = Vector((p.x, p.y, 0.0)).normalized() if rr > 1e-9 else Vector((0, 0, 0))
    n = radial - Vector((0, 0, dr))
    if n.length < 1e-9:
        n = Vector((0, 0, 1 if t > 0 else -1))
    return n.normalized()


def build(lod, q):
    shell = Kit()
    if lod < 3:
        shell.lathe([(r, z, TAN) for r, z in profile(seg(15, q, 3))], seg(32, q, 5))
    else:  # 70 tris: 7 sides x 6 rings
        shell.lathe([(r, z, TAN) for r, z in profile(6)], 7)
    pieces = {'shell': shell}
    if lod < 2:  # Ignition "KN" stamp on the front-right flank, image up along +Z
        rect = kit.atlas_rect('trim.marks_m4', _m4.marks4('kn_stamp'))
        rows = []
        size, nu = 0.016, 4
        for j in range(nu + 1):
            row = []
            for i in range(nu + 1):
                f = size / 0.0225 * 0.9
                d = (Vector((0.45, -1.0, 0.1)).normalized() + Vector((1.0, 0.45, 0.0)).normalized() * (i / nu - 0.5) * f
                     + Vector((0, 0, 1)) * (j / nu - 0.5) * f)
                p = surface(d)
                row.append(p + normal_at(p) * kit.LIFT * 2)
            rows.append(row)
        pieces['decal_1'] = kit.decal_grid(rows, rect)
    return pieces


def shard_kits():
    """14 curved shell bits: fan patches on the egg surface (outer tan, inner / rim interior ceramic)."""
    rnd = random.Random(4417)
    sizes = [0.004, 0.006, 0.008, 0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.007, 0.011, 0.015, 0.009, 0.013]
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i, s in enumerate(sizes):
        zf = 1 - 2 * (i + 0.5) / len(sizes)
        rr = math.sqrt(1 - zf * zf)
        d = Vector((rr * math.cos(golden * i), rr * math.sin(golden * i), zf))
        c = surface(d)
        n = normal_at(c)
        u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        v = n.cross(u)
        k_sides = 6 + (i % 4)
        rim = []
        for j in range(k_sides):
            a = 2 * math.pi * j / k_sides + rnd.uniform(-0.25, 0.25)
            r = s / 2 * rnd.uniform(0.7, 1.0)
            rim.append(surface(c + (u * math.cos(a) + v * math.sin(a)) * r))
        k = Kit()
        bm = k.bm
        mo, mi = k.mi(TAN), k.mi(INNER)
        th = 0.0005
        oc = bm.verts.new(c)
        ic = bm.verts.new(c - n * th)
        orr = [bm.verts.new(p) for p in rim]
        irr = [bm.verts.new(p - normal_at(p) * th) for p in rim]
        for j in range(k_sides):
            jj = (j + 1) % k_sides
            bm.faces.new((oc, orr[j], orr[jj])).material_index = mo
            bm.faces.new((ic, irr[jj], irr[j])).material_index = mi
            bm.faces.new((orr[j], irr[j], irr[jj], orr[jj])).material_index = mi
        import bmesh
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        out.append(k)
    return out


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'S', '0.45,0.6,0.45', 0.055, 'com', 900,
        'Egg (free body; origin = the briefed COM, 2 mm toward the blunt end, kn_com_explicit): true egg profile '
        '(Ø 0.045 x 0.060, blunt end up), one kn_paper_tan shell + the Ignition "KN" stamp decal. COL__hull__0: '
        '47-point egg hull (ceramic, restitution 0.15, friction 0.5). Breaks at kn_break_impulse 0.3 N·s into the '
        'splat decal + the 14 DEB_eggshell bits FRAC__01-14 (Spectacle debris, not sim chunks; yolk.frac.glb). '
        'Brief: docs/art/briefs/rollers.md#yolk.',
        MASTERS, hints={'kn_break_impulse': 0.3}, pipeline={'kn_com_explicit': True})
    part.build_lods(build, lod0_q=1.0)
    pts = [(0.0, 0.0, z_of(-1.0)), (0.0, 0.0, z_of(1.0))]
    for t in (-0.8, -0.5, -0.1, 0.35, 0.75):
        for j in range(9):
            a = 2 * math.pi * j / 9 + (0.35 if t > 0 else 0.0)
            pts.append((radius(t) * math.cos(a), radius(t) * math.sin(a), z_of(t)))
    part.col_hull('0', pts, phys='ceramic', restitution=0.15, friction=0.5)
    part.emit('splat', 'centre', (0, 0, 0), (1, 0, 0))
    col = template.get_collection('FRAC')
    for i, k in enumerate(shard_kits(), 1):
        ob = geom.object_from_bmesh('FRAC__%02d' % i, k.bm, [part.mats[m] for m in k.mats], col, recalc_normals=False)
        geom.set_sharp_by_angle(ob.data, 40)
        ob['r'] = round(max((v.co - sum((w.co for w in ob.data.vertices), Vector()) / len(ob.data.vertices)).length
                            for v in ob.data.vertices), 5)
        ob['phys'] = 'ceramic'
        ob['surface'] = 'eggshell'
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
