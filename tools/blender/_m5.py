"""Shared helpers for the M5 part builders (stream E5a): Future Tech strips and rings, ring-segment collision, and
a few small kit pieces the M5 briefs reuse.

Usage from a make_<type>.py:  import _m5 ; _m5.rrect_path(0.30, 0.30, 0.010, 4, 0.125, -0.125, 0.020)

  rrect_path()    open path round a rounded rectangle (CCW from the front edge at x0 to the front edge at x1)
  strip()         a kn_led light strip swept along a path (round tube, embedded half into the host)
  ring_cols()     n COL__box segments round a ring (rift gate, coilgun) in the x-z plane
  marks5()        decal sub-rect for a kn_tools.decal_atlas.MARKS_M5 mark
  polar()         point at angle / radius in the x-z plane about a centre (rings that face -Y)
"""
import math

from mathutils import Matrix, Vector

from kn_tools import decal_atlas, kit
from kn_tools.kit import Kit


def rrect_path(w, d, r, cseg, x0, x1, z, grow=0.0):
    """Points of the w x d rounded rectangle (corner r, offset outward by `grow`) at height z, walking CCW (seen from
    +Z) from the front edge (y = -d/2) at x = x0 round the right, back and left sides to the front edge at x = x1
    (x0 > x1: the gap between them on the front edge stays open)."""
    pts = kit.outline_rrect(w + 2 * grow, d + 2 * grow, r + grow, cseg)
    y = -d / 2 - grow
    out = [(x0, y, z)] + [(p[0], p[1], z) for p in pts] + [(x1, y, z)]
    return out


def strip(k, path, radius, sides, mat='kn_led'):
    k.sweep(path, radius, max(3, sides), mat)


def polar(c, r, deg):
    """Point at angle `deg` (0 = +X, 90 = +Z) and radius r about centre c in the x-z plane (y from c)."""
    a = math.radians(deg)
    return Vector((c[0] + r * math.cos(a), c[1], c[2] + r * math.sin(a)))


def ring_cols(part, n, centre, r_mid, seg_len, depth, thick, phys='powder', start_deg=0.0, prefix='', first=0,
              **props):
    """n COL__box__<first + i> segments round a ring facing -Y: each seg_len long (tangent), `depth` along Y and
    `thick` radial, centred on the ring's r_mid midline at angles start_deg + 360 i / n."""
    obs = []
    for i in range(n):
        a = math.radians(start_deg + 360.0 * i / n)
        p = Vector((centre[0] + r_mid * math.cos(a), centre[1], centre[2] + r_mid * math.sin(a)))
        # box local x = tangent, y = depth (Y), z = radial
        m = Matrix.Translation(p) @ Matrix.Rotation(-a + math.pi / 2, 4, 'Y')
        obs.append(part.col_box(prefix + str(first + i), (seg_len, depth, thick), (0, 0, 0), phys=phys, matrix=m,
                                **props))
    return obs


def marks5(name):
    return decal_atlas.marks5_sub(name)


def disc_profile(rings):
    """Lathe profile helper: [(r, z, mat), ...] with duplicate points removed."""
    return kit.dedupe(rings)


def unit(v):
    return Vector(v).normalized()


def ring_face_frame(centre):
    """4x4 that maps local +Z onto -Y (out of a front-facing ring) at `centre`: lathes about the ring axis."""
    return kit.frame(centre, (0, -1, 0))


def ring_axis_frame(centre):
    """Local +Z -> +Y (the ring axis pointing back) at `centre`."""
    return kit.frame(centre, (0, 1, 0))


def kit_count(*kits):
    return sum(k.tris() for k in kits if isinstance(k, Kit))
