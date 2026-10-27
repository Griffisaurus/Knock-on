"""Shared helpers for the M4 part builders (stream E4a): lofted shells for clear containers, cavities for the
container-fill pass (ASSET_PIPELINE §3.10, briefs/matter.md), ray-sampled outlines and a few small kit pieces.

Usage from a make_<type>.py:  import _m4 ; _m4.loft(kit, rings, 'kn_poly_clear')

  polar_rrect()   rounded rectangle sampled at n equal polar angles (rings that loft onto circles)
  polar_circle()  circle sampled at the same angles
  superellipse()  |x/a|^p + |y/b|^p = 1 at n polar angles (oval tubs)
  loft()          closed solid / shell from a list of matching rings (quads between rings, n-gon or pole caps)
  shell_rings()   a hollow open-top container: outer rings bottom -> top, then the inset inner rings top -> bottom,
                  lofted as ONE closed shell (a single transmission surface pair)
  cavity()        CAVITY__<name> from a closed Kit (matter / capacity props, optional pivot)
  wheel_col()     COL__wheel__<n> (ZIPPY) cylinder along Y
  marks4()        decal sub-rect for a kn_tools.decal_atlas.MARKS_M4 mark
"""
import math

from mathutils import Vector

from kn_tools import decal_atlas, geom, template
from kn_tools.kit import Kit, frame


def polar_rrect(w, d, r, n, start=0.0):
    """Points of a w x d rounded rectangle (corner r) where rays at n equal angles from the centre meet it."""
    r = min(r, w / 2 - 1e-6, d / 2 - 1e-6)
    hx, hy = w / 2, d / 2
    out = []
    for i in range(n):
        a = start + 2 * math.pi * i / n
        dx, dy = math.cos(a), math.sin(a)
        # bisect the ray length on the rounded-rect signed distance
        lo, hi = 0.0, math.hypot(hx, hy) * 1.01
        for _ in range(40):
            t = (lo + hi) / 2
            px, py = abs(dx * t), abs(dy * t)
            qx, qy = px - (hx - r), py - (hy - r)
            sd = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
            if sd > 0:
                hi = t
            else:
                lo = t
        out.append((dx * lo, dy * lo))
    return out


def polar_circle(r, n, start=0.0):
    return [(r * math.cos(start + 2 * math.pi * i / n), r * math.sin(start + 2 * math.pi * i / n)) for i in range(n)]


def superellipse(a, b, p, n, start=0.0):
    out = []
    for i in range(n):
        t = start + 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        rr = (abs(c / a) ** p + abs(s / b) ** p) ** (-1.0 / p)
        out.append((c * rr, s * rr))
    return out


def ring(pts2d, z, cx=0.0, cy=0.0, scale=1.0):
    return [(cx + x * scale, cy + y * scale, z) for x, y in pts2d]


def loft(k, rings, mat, cap_bot=True, cap_top=True, closed=False, mats=None, m=None):
    """Quads between consecutive rings (each a list of 3D points, same count, CCW seen from +Z for a solid that
    grows upward). cap_* closes the first / last ring with an n-gon; closed=True wraps the last ring onto the first
    (hollow shells). mats: optional per-strip masters (len(rings) - 1, or len(rings) when closed)."""
    bm = k.bm
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    strips = list(range(len(vr) - 1)) + ([len(vr) - 1] if closed else [])
    for s in strips:
        a, b = vr[s], vr[(s + 1) % len(vr)]
        mi = k.mi(mats[s] if mats else mat)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
    if not closed:
        if cap_bot:
            f = bm.faces.new(list(reversed(vr[0])))
            f.material_index = k.mi(mats[0] if mats else mat)
        if cap_top:
            f = bm.faces.new(vr[-1])
            f.material_index = k.mi(mats[-1] if mats else mat)
    if m is not None:
        import bmesh
        bmesh.ops.transform(bm, matrix=m, verts=[v for r in vr for v in r])
    return vr


def shell_rings(outer, inner):
    """outer: rings bottom -> top; inner: matching inset rings bottom -> top. Returns one closed ring loop
    (outer up, inner down) for loft(..., closed=True): a watertight hollow, open-top shell."""
    return list(outer) + list(reversed(inner))


def cavity(part, name, k, matter, capacity=None, pivot=None, fallback=None, **props):
    """CAVITY__<name> from a closed Kit (one shell only: overlapping shells would double-count the fill volume).
    `fallback` is the thumbnail / impostor master (matter.md LODs): sand kn_paper_tan, water kn_poly_beam,
    marbles kn_glass, slime kn_slime."""
    fallback = fallback or {'sand': 'kn_paper_tan', 'water': 'kn_poly_beam', 'marble': 'kn_glass',
                            'goo': 'kn_slime'}.get(matter, 'kn_poly_amber')
    for i in range(len(k.mats)):
        k.mats[i] = fallback
    ob = geom.object_from_bmesh('CAVITY__' + name, k.bm, [part.mats[fallback]], template.get_collection('CAVITY'))
    ob['matter'] = matter
    if capacity is not None:
        ob['capacity'] = float(capacity)
    for kk, v in props.items():
        ob[kk] = v
    ob.hide_render = True
    if pivot:
        import _m2
        _m2.under(part, ob, pivot)
    return ob


def wheel_col(part, name, r, width, centre, phys='rubber', **props):
    k = Kit()
    k.cyl(r, -width / 2, width / 2, 'x', 24)
    return part._col('wheel', name, k, frame(centre, 'y'), phys, **props)


def cyl_points(r, z0, z1, n, cx=0.0, cy=0.0, axis='z'):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        for z in (z0, z1):
            p = (cx + r * math.cos(a), cy + r * math.sin(a), z)
            if axis == 'y':
                p = (cx + r * math.cos(a), z, cy + r * math.sin(a))
            elif axis == 'x':
                p = (z, cx + r * math.cos(a), cy + r * math.sin(a))
            pts.append(p)
    return pts


def sphere_points(c, r, n=6):
    pts = []
    for i in range(n + 1):
        phi = -math.pi / 2 + math.pi * i / n
        m = 1 if i in (0, n) else 2 * n
        for j in range(m):
            th = 2 * math.pi * j / m
            pts.append((c[0] + r * math.cos(phi) * math.cos(th), c[1] + r * math.cos(phi) * math.sin(th),
                        c[2] + r * math.sin(phi)))
    return pts


def marks4(name):
    return decal_atlas.marks4_sub(name)


def lerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)


def smooth_path(pts, sub):
    """Catmull-Rom through pts with `sub` segments per span (ends clamped): smooth sweeps from a few points."""
    p = [Vector(x) for x in pts]
    if sub <= 1 or len(p) < 3:
        return [tuple(v) for v in p]
    ext = [p[0] * 2 - p[1]] + p + [p[-1] * 2 - p[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                                    (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    out.append(tuple(p[-1]))
    return out
