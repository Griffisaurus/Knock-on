"""Procedurally build the STITCH source file (docs/art/briefs/rollers.md, "STITCH: Hard ball").

Usage: blender -b --factory-startup -P tools/blender/make_stitch.py -- [out.blend]
Default output: assets/src/rollers/stitch.blend

A satin Bone ball r 0.0375 with a continuous two-lobe seam (the closed spherical curve
p(t) = (a cos t + b cos 3t, a sin t - b sin 3t, 2 sqrt(ab) sin 2t), a + b = 1, which lies exactly on the unit
sphere). The seam is a 4 mm kn_fabric_ignition band raised 0.8 mm, swept as a closed ribbon whose base sinks
below the shell facets (overlapping closed shells, so every LOD stays watertight). LOD0 carries the brief's
2 x 44 V-chevron stitches as geometry (exaggerated 1.3x, 0.6 mm proud of the band) evenly spaced by arc
length; LOD1 down keep only the band (the stitches move to the shared V-stitch normal, deferred). A tiny
Graphite "KN-ST" stamp (mark.kn_st.graphite) is draped in the middle of one lobe.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'stitch'
R = 0.0375                     # collider radius = shell radius
SEAM_B = 0.25                  # two-lobe curve parameter (a = 1 - b)
BAND_W = 0.004                 # 4 mm band
BAND_H = 0.0008                # raised 0.8 mm
EXAG = 1.3                     # stitches exaggerated 1.3x
STITCHES = 88                  # 2 x 44 V-chevrons
ST_HW = 0.00145                # chevron half span (inside the 3.2 mm band top)
ST_DEPTH = 0.0013 * EXAG       # V depth along the seam
ST_ARM = 0.0007 * EXAG         # arm thickness
ST_H = 0.00045 * EXAG          # 0.6 mm proud of the band top
BONE, FABRIC = 'kn_powder_bone', 'kn_fabric_ignition'
MASTERS = [BONE, FABRIC]
STAMP_DIR_WISH = Vector((0.45, -0.8, 0.4)).normalized()   # put a lobe centre here (front, upper right)


def seam_raw(t):
    a, b = 1.0 - SEAM_B, SEAM_B
    c = 2.0 * math.sqrt(a * b)
    return Vector((a * math.cos(t) + b * math.cos(3 * t), a * math.sin(t) - b * math.sin(3 * t), c * math.sin(2 * t)))


def _lobe_centre(pts):
    """Direction farthest from the seam (centre of a lobe), by brute force over a Fibonacci sphere."""
    best, best_d = None, -1.0
    n = 1500
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        ph = i * math.pi * (3 - math.sqrt(5))
        d = Vector((r * math.cos(ph), r * math.sin(ph), z))
        m = min((d - p).length for p in pts)
        if m > best_d + 1e-9:
            best, best_d = d, m
    return best


def _seam_frame():
    pts = [seam_raw(2 * math.pi * i / 240) for i in range(240)]
    c = _lobe_centre(pts)
    return c.rotation_difference(STAMP_DIR_WISH).to_matrix()


ROT = _seam_frame()


def seam(t):
    return (ROT @ seam_raw(t)).normalized()


def seam_frame(t):
    """(p, T, B): unit radial, tangent along the seam, lateral (on the sphere)."""
    p = seam(t)
    h = 1e-4
    d = seam(t + h) - seam(t - h)
    T = (d - p * d.dot(p)).normalized()
    return p, T, p.cross(T)


def arclength_params(n, dense=2000):
    """n parameters evenly spaced by arc length along the closed seam."""
    ts = [2 * math.pi * i / dense for i in range(dense + 1)]
    cum = [0.0]
    for i in range(dense):
        cum.append(cum[-1] + (seam(ts[i + 1]) - seam(ts[i])).length)
    total = cum[-1]
    out, j = [], 0
    for k in range(n):
        s = total * k / n
        while cum[j + 1] < s:
            j += 1
        f = (s - cum[j]) / max(1e-12, cum[j + 1] - cum[j])
        out.append(ts[j] + (ts[j + 1] - ts[j]) * f)
    return out, total * R


def loop_sweep(k, params, profile, radius):
    """Closed ribbon along the seam: profile [(lateral, radial offset, master of the edge to the next point)]
    closed in both directions (a torus-like loop), so it is watertight with no caps."""
    bm = k.bm
    rings = []
    for t in params:
        p, T, B = seam_frame(t)
        rings.append([bm.verts.new(p * (radius + rad) + B * lat) for lat, rad, _ in profile])
    n, m = len(rings), len(profile)
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(m):
            jj = (j + 1) % m
            f = bm.faces.new((a[j], a[jj], b[jj], b[j]))
            f.material_index = k.mi(profile[j][2])


def chevron(k, t, mat):
    """One V-stitch (apex pointing along +T) as a closed 9-vertex roof shell, base sunk into the band top."""
    p, T, B = seam_frame(t)
    top = R + BAND_H
    d, a, hw = ST_DEPTH, ST_ARM, ST_HW
    base = [(-d / 2, -hw), (d / 2, 0.0), (-d / 2, hw), (-d / 2 - a, hw), (d / 2 - a * 1.6, 0.0), (-d / 2 - a, -hw)]
    ridge = [(-d / 2 - a / 2, -hw * 0.92), (d / 2 - a * 0.8, 0.0), (-d / 2 - a / 2, hw * 0.92)]

    def place(u, v, hgt):
        q = p * top + T * u + B * v
        return q.normalized() * (top + hgt)

    bm = k.bm
    vb = [bm.verts.new(place(u, v, -0.00015)) for u, v in base]
    vr = [bm.verts.new(place(u, v, ST_H)) for u, v in ridge]
    lo, ao, ro, ri, ai, li = vb
    lr, ar, rr = vr
    mi = k.mi(mat)
    for f in ((lo, ai, ao), (lo, li, ai), (ao, ai, ri), (ao, ri, ro),            # base (concave V, 4 tris)
              (lo, ao, ar, lr), (ao, ro, rr, ar), (ri, ai, ar, rr), (ai, li, lr, ar),  # roof
              (li, lo, lr), (ro, ri, rr)):                                       # arm ends
        bm.faces.new(f).material_index = mi


def build(lod, q):
    ball = Kit()
    S = seg(24, q, 8, 2)
    rings = max(4, S // 2)
    ball.sphere(R, BONE, S, rings)
    sag = R * (1 - math.cos(math.pi / min(S, 2 * rings)))
    sunk = sag + 0.0003
    hw = BAND_W / 2
    if lod < 3:
        prof = [(-hw, -sunk, FABRIC), (-hw + 0.0004, BAND_H, FABRIC), (hw - 0.0004, BAND_H, FABRIC),
                (hw, -sunk, FABRIC)]
    else:
        prof = [(-hw, -sunk, FABRIC), (0.0, BAND_H, FABRIC), (hw, -sunk, FABRIC)]
    params, _ = arclength_params(seg(56, q, 12))
    loop_sweep(ball, params, prof, R)
    pieces = {'ball': ball}
    if lod == 0:
        st = Kit()
        sp, _ = arclength_params(STITCHES)
        for t in sp:
            chevron(st, t, FABRIC)
        pieces['stitches'] = st
    stamp = kit.decal_wrap('mark.kn_st.graphite', tuple(STAMP_DIR_WISH), (0, 0, 1), 0.016, lambda d: d * R,
                           nu=4, nv=2, ref=R)
    return kit.add_decals(pieces, lod, [stamp])


def main(out_path=None):
    _, length = arclength_params(STITCHES)
    part = kit.Part(
        TYPE, 'rollers', 'S', '0.75,0.75,0.75', 0.15, 'com', 2200,
        'Hard ball: satin Bone shell r 0.0375 with a continuous two-lobe seam (closed spherical curve, '
        'b = %.2f, %.3f m long): 4 mm kn_fabric_ignition band raised 0.8 mm. LOD0 models the 2 x 44 V-chevron '
        'stitches as geometry (1.3x, 0.6 mm proud of the band, by arc length); LOD1-3 keep the band only. Tiny '
        'Graphite "KN-ST" stamp (mark.kn_st.graphite) in one lobe. Brief: docs/art/briefs/rollers.md#stitch. '
        'Deferred: the shared 1024 V-stitch Normal (trim layer) for LOD1+.' % (SEAM_B, length),
        MASTERS)
    part.build_lods(build, lod0_q=1.0)
    part.col_sphere('0', R, phys='powder', restitution=0.50, friction=0.45)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
