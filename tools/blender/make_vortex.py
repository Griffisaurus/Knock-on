"""Procedurally build the VORTEX source file (docs/art/briefs/frame.md, "VORTEX: Funnel").

Usage: blender -b --factory-startup -P tools/blender/make_vortex.py -- [out.blend]
Default output: assets/src/frame/vortex.blend

The wide coin-funnel (0.80 x 0.45 x 0.80, origin = bottom centre of the outlet spigot). The bowl is ONE closed
lathe: the kn_powder_bone interior follows a smooth centripetal Catmull-Rom spline through the brief's (r, z)
points, rim (0.395, 0.445) -> throat (0.144, 0.08), then the straight Ø 0.288 bore to z 0; the kn_powder_cobalt
exterior is that curve offset 5 mm into the wall (so the spigot outside is Ø 0.300 = the wide TUBE OD), closed
inside the Ø 12 mm kn_steel_brushed rim bead. A Cobalt spigot collar (OD 0.320 x 0.030, the wide tube__collar)
carries the Bone name plate; three Cobalt mount tabs hang under the bowl at 120° (the tripod legs bolt there),
each with one M3. COL__mesh__0 is the brief's static mesh: inner 48 radial x 16 rings + outer 24 x 8.
The 6 faint helical grooves are Normal only (deferred); the tripod skin is not built here.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _m2  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'vortex'
PROFILE = [(0.395, 0.445), (0.32, 0.41), (0.25, 0.35), (0.20, 0.27), (0.165, 0.19), (0.144, 0.08)]
BORE_R = 0.144                 # bore Ø 0.288
WALL = 0.005                   # -> spigot OD 0.300 (wide tube)
BEAD_C = (0.396, 0.445)        # Ø 12 mm rim bead centre (outer edge at r 0.402)
BEAD_R = 0.006
COLLAR = (0.147, 0.160, 0.0005, 0.030)   # inner r, outer r (OD 0.320), z0, z1
TAB_ANGLES = (90.0, 210.0, 330.0)
TAB_R = (0.255, 0.315)
TAB_T = 0.008
BONE, COBALT, STEEL = 'kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed'
MASTERS = [BONE, COBALT, STEEL]


# ---------------------------------------------------------------- profile curve

def _catmull(pts, per=60, alpha=0.5):
    """Centripetal Catmull-Rom through pts (with phantom ends), densely sampled."""
    p = [Vector(v) for v in pts]
    ext = [p[0] + (p[0] - p[1]), *p, Vector((BORE_R, -0.25))]   # phantom below the throat: vertical tangent
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        t0 = 0.0
        t1 = t0 + (p1 - p0).length ** alpha
        t2 = t1 + (p2 - p1).length ** alpha
        t3 = t2 + (p3 - p2).length ** alpha
        for k in range(per):
            t = t1 + (t2 - t1) * k / per
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            out.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    out.append(p[-1].copy())
    return out


DENSE = _catmull(PROFILE)
_CUM = [0.0]
for _i in range(len(DENSE) - 1):
    _CUM.append(_CUM[-1] + (DENSE[_i + 1] - DENSE[_i]).length)


def bowl_at(s):
    """Point and wall normal (into the wall, away from the bowl interior) at arc length fraction s (0 rim, 1 throat)."""
    L = _CUM[-1] * min(1.0, max(0.0, s))
    j = 0
    while j < len(_CUM) - 2 and _CUM[j + 1] < L:
        j += 1
    f = (L - _CUM[j]) / max(1e-12, _CUM[j + 1] - _CUM[j])
    p = DENSE[j].lerp(DENSE[j + 1], f)
    a, b = DENSE[max(0, j - 1)], DENSE[min(len(DENSE) - 1, j + 2)]
    t = (b - a).normalized()                       # running rim -> throat (down and in)
    return p, Vector((-t.y, t.x))                  # rotate +90°: outward / downward into the wall


def bowl(n):
    return [bowl_at(i / n) for i in range(n + 1)]


def z_outer(r):
    """z of the exterior (offset) surface at radius r, from a dense offset polyline."""
    pts = [p + nrm * WALL for p, nrm in bowl(300)]
    for a, b in zip(pts, pts[1:]):
        if min(a.x, b.x) <= r <= max(a.x, b.x) and abs(b.x - a.x) > 1e-9:
            return a.y + (b.y - a.y) * (r - a.x) / (b.x - a.x)
    raise ValueError(r)


# ---------------------------------------------------------------- pieces

def bowl_shell(k, lod, q, S):
    nb = seg(14, q, 3)
    no = seg(6, q, 2) if lod < 2 else nb        # coarse LODs: outer rows match inner ones (no bone poke-through)
    prof = [(p.x, p.y, BONE) for p, _ in bowl(nb)]
    prof.append((BORE_R, 0.0, COBALT))                             # bore -> bottom annulus
    prof.append((BORE_R + WALL, 0.0, COBALT))                      # spigot outside
    outer = [p + nrm * WALL for p, nrm in bowl(no)]
    prof += [(v.x, v.y, COBALT) for v in reversed(outer)]          # throat -> rim, last strip closes in the bead
    k.lathe(prof, S, closed=True)


def collar(k, lod, q, S):
    ri, ro, z0, z1 = COLLAR
    b = 0.002 if lod < 2 else 0.0
    if b:
        prof = [(ri, z0, COBALT), (ro - b, z0, COBALT), (ro, z0 + b, COBALT), (ro, z1 - b, COBALT),
                (ro - b, z1, COBALT), (ri, z1, COBALT)]
    else:
        prof = [(ri, z0, COBALT), (ro, z0, COBALT), (ro, z1, COBALT), (ri, z1, COBALT)]
    k.lathe(prof, S, closed=True)


def tab(k, ang, lod, q):
    """A Cobalt mount tab hanging under the bowl in the radial plane at `ang`, its top sunk into the wall."""
    a = math.radians(ang)
    rad = Vector((math.cos(a), math.sin(a), 0.0))
    side = Vector((math.sin(a), -math.cos(a), 0.0))               # rad x Z: right-handed frame
    m = Matrix(((rad.x, 0, side.x, 0), (rad.y, 0, side.y, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    r0, r1 = TAB_R
    zb = z_outer(r0) - 0.032
    corners = [(r0, zb), (r1, zb), (r1, z_outer(r1) + 0.0045), (r0, z_outer(r0) + 0.0045)]
    cs = (3, 2, 1, 0)[lod]
    outline = kit.outline_round_poly(corners, 0.006, cs) if cs else corners
    k.prism(outline, -TAB_T / 2, TAB_T / 2, COBALT, bt=0.0015 if lod < 2 else 0.0, bb=0.0015 if lod < 2 else 0.0,
            bseg=1, m=m)
    c = rad * ((r0 + r1) / 2) + Vector((0, 0, zb + 0.012))
    _m2.screw(k, 'M3', tuple(c + side * (TAB_T / 2 + 0.0001)), tuple(side), q, lod)   # one M3 per tab


def build(lod, q):
    S = seg(48, q, 8, 2)
    body = Kit()
    bowl_shell(body, lod, q, S)
    body.torus(BEAD_C[0], BEAD_R, STEEL, S, seg(8, q, 3) if lod < 3 else 3, m=kit.at(0, 0, BEAD_C[1]))
    if lod < 3:                                   # LOD3: collar, tabs and screws drop (under the bowl)
        collar(body, lod, q, S)
        for ang in TAB_ANGLES:
            tab(body, ang, lod, q)
    name = kit.decal_cylinder('name.vortex.bone', (0, 0, (COLLAR[2] + COLLAR[3]) / 2), (0, 0, 1), COLLAR[1],
                              (0, -1, 0), 0.08, nu=10)
    return kit.add_decals({'bowl': body}, lod, [name])


def col_mesh():
    """Brief: inner bowl 48 radial x 16 rings (+ bore) and outer 24 x 8, two open surfaces in one static mesh."""
    k = Kit()
    inner = [(p.x, p.y, 'x') for p, _ in bowl(14)] + [(BORE_R, 0.04, 'x'), (BORE_R, 0.0, 'x')]
    k.lathe(inner, 48)
    outer = [p + nrm * WALL for p, nrm in bowl(7)]
    k.lathe([(v.x, v.y, 'x') for v in outer] + [(BORE_R + WALL, 0.0, 'x')], 24)
    return k


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '8,4.5,8', 2.5, 'bottom', 2800,
        'Wide coin funnel: one closed lathe bowl, kn_powder_bone interior on a smooth centripetal Catmull-Rom '
        'through the brief (r, z) points (rim 0.395/0.445 -> throat 0.144/0.08, straight Ø 0.288 bore to z 0), '
        'kn_powder_cobalt exterior offset 5 mm (spigot OD 0.300), Ø 12 mm steel rim bead, Cobalt spigot collar '
        'OD 0.320 x 0.030 with the Bone name plate, 3 Cobalt mount tabs at 120° with one M3 each. Static: '
        'kn_mass_hint is nominal. COL__mesh__0 = inner 48 x 16 rings + outer 24 x 8. Brief: '
        'docs/art/briefs/frame.md#vortex. Deferred: the 1024 Normal (6 helical grooves), vortex__tripod skin, '
        'vortex_slim.',
        MASTERS)
    part.build_lods(build, lod0_q=1.0)
    part._col('mesh', '0', col_mesh(), None, 'powder', restitution=0.30, friction=0.15)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
