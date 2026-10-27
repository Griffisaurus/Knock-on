"""Procedurally build the BANGSTICK source file (docs/art/briefs/boom.md, "BANGSTICK: Three-stick paper charge").

Usage: blender -b --factory-startup -P tools/blender/make_bangstick.py -- [out.blend]
Default output: assets/src/boom/bangstick.blend

The approved look-dev (style_samples.py bangstick()) at catalogue scale: three kn_paper_red sticks
(0.28 x Ø 0.05, recessed kn_paper_tan end discs) in a triangle stack, two graphite tape bands that follow
the rounded-triangle hull 2.5 mm proud and press flush underneath (so the bundle rests on its capsules at
z -0.039), a bone label tilted 25° up on the front, and a kn_fuse_cord stub that leaves the top stick's +X
cap through the fuse ring, loops out to x 0.16 and ends over the top stick at z 0.058.
Origin = centre of mass (bundle centroid), free body.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'bangstick'
R, L = 0.025, 0.28
STICKS = [(-0.025, -0.014), (0.025, -0.014), (0.0, 0.029)]  # (y, z) centres, brief Collision row
FLOOR = -0.039
TAPE_X, TAPE_W, TAPE_PROUD = 0.07, 0.021, 0.0025
LABEL = (0.075, 0.002, 0.027)
LABEL_TILT = 25.0
FUSE_R = 0.003
FUSE_PATH = [(0.134, 0.0, 0.029), (0.146, 0.0, 0.0292), (0.1535, 0.0015, 0.0325), (0.1568, 0.0045, 0.0395),
             (0.1558, 0.0085, 0.0475), (0.1505, 0.0118, 0.0538), (0.1405, 0.0140, 0.0573), (0.1250, 0.0150, 0.0580)]
TIP = (0.125, 0.015, 0.058)
PAPER, TAN, TAPE, BONE, CORD = 'kn_paper_red', 'kn_paper_tan', 'kn_powder_graphite', 'kn_powder_bone', 'kn_fuse_cord'
MASTERS = [PAPER, TAN, TAPE, BONE, CORD, 'kn_interior_paper']
# Local prism frame for the tape bands: outline (u, v) = Blender (y, z), extrusion along +X.
YZX = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def hull2d(pts):
    pts = sorted(set((round(x, 9), round(y, 9)) for x, y in pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def clip_below(poly, vmin):
    """Sutherland-Hodgman: keep v >= vmin (the flat underside of the tape)."""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ia, ib = a[1] >= vmin, b[1] >= vmin
        if ia:
            out.append(a)
        if ia != ib:
            t = (vmin - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * t, vmin))
    clean = []
    for p in out:
        if not clean or (abs(clean[-1][0] - p[0]) > 1e-7 or abs(clean[-1][1] - p[1]) > 1e-7):
            clean.append(p)
    return clean


def tape_outline(n):
    samples = []
    for y, z in STICKS:
        for i in range(n):
            a = 2 * math.pi * i / n
            samples.append((y + (R + TAPE_PROUD) * math.cos(a), z + (R + TAPE_PROUD) * math.sin(a)))
    return clip_below(hull2d(samples), FLOOR)


def catmull(pts, sub):
    p = [Vector(v) for v in pts]
    p = [p[0] * 2 - p[1]] + p + [p[-1] * 2 - p[-2]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(sub):
            t = k / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(p[-2])
    return out


def stick_profile(bseg, discs):
    h = L / 2
    if not discs:
        return [(0.0, -h, PAPER), (R, -h, PAPER), (R, h, PAPER), (0.0, h, PAPER)]
    b = 0.0025
    prof = [(0.0, -h + 0.001, TAN), (0.84 * R, -h + 0.001, PAPER), (0.88 * R, -h, PAPER)]
    prof += kit.arc_pts(R, -h, b, bseg, True, PAPER, PAPER)
    prof += kit.arc_pts(R, h, b, bseg, False, PAPER, PAPER)
    prof += [(0.88 * R, h, PAPER), (0.84 * R, h - 0.001, TAN), (0.0, h - 0.001, TAN)]
    return kit.dedupe(prof)


def build(lod, q):
    body = Kit()
    segs = seg(44, q, 7)
    bseg = (3, 2, 1, 1)[lod]
    for y, z in STICKS:
        body.lathe(stick_profile(bseg, lod < 3), segs, kit.frame((0.0, y, z), 'x'))
    outline = tape_outline(seg(56, q, 8))
    tb = (0.002, 0.0015, 0.001, 0.0)[lod]
    for x in (-TAPE_X, TAPE_X):
        body.prism(outline, x - TAPE_W / 2, x + TAPE_W / 2, TAPE, bt=tb, bb=tb, bseg=max(1, bseg - 1), m=YZX)
    # Label: tangent to the front-lower stick, normal 25° above -Y.
    n = Vector((0.0, -math.cos(math.radians(LABEL_TILT)), math.sin(math.radians(LABEL_TILT))))
    up = Vector((0.0, math.sin(math.radians(LABEL_TILT)), math.cos(math.radians(LABEL_TILT))))
    c0 = Vector((0.0,) + STICKS[0])
    centre = c0 + n * (R + LABEL[1] / 2 + 0.0002) + up * 0.004
    lr = (0.0008, 0.0006, 0.0, 0.0)[lod]
    if lod < 3:
        body.rbox(LABEL, (0, 0, 0), lr, BONE, cseg=max(1, bseg - 1), m=kit.at(*centre) @ kit.rot_x(-LABEL_TILT))
    fuse = Kit()
    sides = (8, 6, 5, 4)[lod]
    path = catmull(FUSE_PATH, seg(4, q, 1))
    fuse.sweep(path, FUSE_R, sides, CORD)
    body.merge(fuse)
    fuse.free()
    # Label (75 x 27 bone plate): 6 mm narrow hazard border, name plate + explosive pictogram inside it.
    front = centre + n * (LABEL[1] / 2)
    right = up.cross(n)
    w, h, b = LABEL[0], LABEL[2], 0.006
    decals = []
    for sy in (-1, 1):  # top / bottom stripes: 75 x 6 mm from half the tile height (60 px -> 750 px long)
        decals.append(kit.decal_plane('trim.hazard_narrow_r', front + up * (sy * (h - b) / 2), n, up, w, b,
                                      sub=(0.0, 0.0, 0.738, 0.5)))
    for sx in (-1, 1):  # side stripes run up the label: 15 x 6 mm
        decals.append(kit.decal_plane('trim.hazard_narrow_r', front + right * (sx * (w - b) / 2), n, -right * sx,
                                      h - 2 * b, b, sub=(0.0, 0.0, 0.148, 0.5)))
    decals.append(kit.decal_plane('name.bangstick.graphite', front - right * 0.008, n, up, 0.044))
    decals.append(kit.decal_plane('picto.explosive.warn', front + right * 0.0235, n, up, 0.013, 0.013))
    return kit.add_decals({'charge': body}, lod, decals)


def frac_chunks(part):
    """4 macro chunks (boom.md Fracture): two torn tape halves, two lengthwise paper-tube halves."""
    col = template.get_collection('FRAC')
    from kn_tools import geom
    chunks = []
    for i, (no, sign) in enumerate((((0, 1, 0), 1), ((0, -1, 0), -1))):
        k = Kit()
        k.prism(tape_outline(24), TAPE_X * sign - TAPE_W / 2, TAPE_X * sign + TAPE_W / 2, TAPE, bt=0.001, bb=0.001,
                bseg=1, m=YZX)
        kit.bisect_fill(k, (0, 0, 0), no)
        chunks.append(k)
    y, z = STICKS[2]
    for no in ((0, 0, 1), (0, 0, -1)):
        k = Kit()
        k.lathe(stick_profile(1, True), 20, kit.frame((0.0, y, z), 'x'))
        kit.bisect_fill(k, (0, y, z), no)
        chunks.append(k)
    for i, k in enumerate(chunks, 1):
        k.bm.normal_update()
        cut = k.mi("kn_interior_paper")
        for f in k.bm.faces:
            if len(f.verts) > 8 and abs(f.normal.dot(Vector((0, 0, 1)))) > 0.99 and i > 2:
                f.material_index = cut
        ob = geom.object_from_bmesh('FRAC__%d' % i, k.bm, [part.mats[nm] for nm in k.mats], col)
        geom.set_sharp_by_angle(ob.data, 40)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '3,1,1', 0.8, 'com', 5500,
        'Dynamite: look-dev bangstick() at catalogue scale. Brief: docs/art/briefs/boom.md#bangstick. '
        'Label decals: name plate, explosive pictogram, 6 mm narrow hazard border (decals_atlas); the stub '
        'burn/ember is procedural (FUSE profile + kn_fuse_cord burnt swap).',
        MASTERS, hints={'kn_macro_chunks': 4})
    part.build_lods(build)
    for i, (y, z) in enumerate(STICKS, 1):
        part.col_capsule('stick_%d' % i, R, L, (0.0, y, z), 'x', phys='paper', restitution=0.2, friction=0.6)
    part.port('signal', 'detonator', (-0.14, 0.0, 0.0), (-1, 0, 0), 'S', 'in')
    part.port('heat', 'fuse', (0.14, 0.0, 0.029), (1, 0, 0), 'S', 'in')
    part.emit('spark', 'fuse_tip', TIP, (0, 0, 1))
    part.emit('smoke', 'fuse_tip', TIP, (0, 0, 1))
    part.emit('boom', 'core', (0, 0, 0), (0, 0, 1))
    frac_chunks(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
