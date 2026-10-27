"""Procedurally build the FUZZ source file (docs/art/briefs/rollers.md, "FUZZ: Fuzzy ball").

Usage: blender -b --factory-startup -P tools/blender/make_fuzz.py -- [out.blend]
Default output: assets/src/rollers/fuzz.blend

A warm kn_fabric_amber felt ball (collider r 0.0325) with a dark kn_rubber two-lobe seam (the closed spherical
curve p(t) = (a cos t + b cos 3t, a sin t - b sin 3t, 2 sqrt(ab) sin 2t), a + b = 1). The felt shell sits at
r 0.0326 and the 3 mm seam is a groove cut into it (EXACT boolean with a closed ribbon cutter, so the result stays
watertight): its rubber floor is 0.6 mm under the collider radius, i.e. the felt stands 0.7 mm proud of the seam.
LOD0-1 carry the real groove; LOD2-3 lay a flush rubber ribbon over a plain felt sphere (the groove is under a
pixel there). No decal (brief: accent none). Fuzz Normal + sheen are the master's / deferred trim layer.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402

from mathutils import Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'fuzz'
R = 0.0325                     # collider radius
FELT = R + 0.0001              # felt shell
FLOOR = FELT - 0.0007          # seam floor: felt pushed 0.7 mm out from the seam (0.6 mm under R)
SEAM_W = 0.003                 # 3 mm seam
SEAM_B = 0.25                  # two-lobe curve parameter (a = 1 - b)
AMBER, RUBBER = 'kn_fabric_amber', 'kn_rubber'
MASTERS = [AMBER, RUBBER]
LOBE_WISH = Vector((-0.4, -0.75, 0.5)).normalized()   # turn a lobe centre toward the front-upper-left


def seam_raw(t):
    a, b = 1.0 - SEAM_B, SEAM_B
    c = 2.0 * math.sqrt(a * b)
    return Vector((a * math.cos(t) + b * math.cos(3 * t), a * math.sin(t) - b * math.sin(3 * t), c * math.sin(2 * t)))


def _lobe_centre(pts):
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


ROT = _lobe_centre([seam_raw(2 * math.pi * i / 240) for i in range(240)]).rotation_difference(LOBE_WISH).to_matrix()


def seam(t):
    return (ROT @ seam_raw(t)).normalized()


SEAM_LEN = sum((seam(2 * math.pi * (i + 1) / 600) - seam(2 * math.pi * i / 600)).length for i in range(600))


def seam_frame(t):
    p = seam(t)
    h = 1e-4
    d = seam(t + h) - seam(t - h)
    T = (d - p * d.dot(p)).normalized()
    return p, T, p.cross(T)


def arclength_params(n, dense=2000):
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
    return out


def loop_sweep(k, params, profile):
    """Closed ribbon along the seam; profile [(lateral, radius, master)] is a closed polygon."""
    bm = k.bm
    rings = []
    for t in params:
        p, T, B = seam_frame(t)
        rings.append([bm.verts.new(p * rad + B * lat) for lat, rad, _ in profile])
    n, m = len(rings), len(profile)
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(m):
            jj = (j + 1) % m
            bm.faces.new((a[j], a[jj], b[jj], b[j])).material_index = k.mi(profile[j][2])


def build(lod, q, mats):
    S = seg(28, q, 8, 2)
    rings = max(4, S // 2)
    ball = Kit()
    ball.sphere(FELT, AMBER, S, rings)
    hw = SEAM_W / 2
    n = seg(64, q, 8)
    if lod < 2:
        # LOD1: sink the floor by the facet + chord sag so the coarser groove never breaks up
        fl = FLOOR if lod == 0 else FLOOR - FELT * (1 - math.cos(math.pi / S)) - FELT * (1 - math.cos(SEAM_LEN / n / 2))
        cutter = Kit()
        loop_sweep(cutter, arclength_params(n), [(-hw, fl, RUBBER), (-hw, FELT + 0.002, RUBBER),
                                                 (hw, FELT + 0.002, RUBBER), (hw, fl, RUBBER)])
        bmesh.ops.recalc_face_normals(cutter.bm, faces=cutter.bm.faces)
        bmesh.ops.recalc_face_normals(ball.bm, faces=ball.bm.faces)
        ball = kit.boolean_diff(ball, [cutter], mats)
    else:
        sag = FELT * (1 - math.cos(math.pi / S))
        chord = FELT * (1 - math.cos(SEAM_LEN / n / 2))   # ribbon chords cut under the sphere between samples
        top = FELT + chord + 0.00005
        prof = ([(-hw, FELT - sag - 0.0004, RUBBER), (-hw, top, RUBBER), (hw, top, RUBBER),
                 (hw, FELT - sag - 0.0004, RUBBER)] if lod == 2 else
                [(-hw, FELT - sag - 0.0004, RUBBER), (0.0, top, RUBBER), (hw, FELT - sag - 0.0004, RUBBER)])
        loop_sweep(ball, arclength_params(n), prof)
    return {'ball': ball}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'S', '0.65,0.65,0.65', 0.058, 'com', 1600,
        'Fuzzy ball: kn_fabric_amber felt (Amber, not tennis yellow) r 0.0326 with a 3 mm kn_rubber two-lobe seam '
        'groove (boolean; floor 0.6 mm under the collider radius, felt 0.7 mm proud of it). LOD2-3: flush rubber '
        'ribbon over a plain sphere. No decal. Brief: docs/art/briefs/rollers.md#fuzz. Deferred: the shared 1024 '
        'fuzz Normal (trim layer); wet state is the engine `wet` parameter.',
        MASTERS)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_sphere('0', R, phys='fabric', restitution=0.70, friction=1.20)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
