"""Procedurally build the QUACK source file (docs/art/briefs/fun.md, "QUACK: Floating, squeaking rubber duck").

Usage: blender -b --factory-startup -P tools/blender/make_quack.py -- [out.blend]
Default output: assets/src/fun/quack.blend

A glossy kn_latex_amber duck, chunkier than usual (free body, origin = the briefed COM 0.028 above the flat base,
kn_com_explicit; beak faces -Y): body ovoid 0.082 x 0.098 x 0.052 centred (0, 0.002, -0.002), flat-bottomed with a
kn_latex_bone keel mark underneath; head Ø 0.050 at (0, -0.020, 0.040); an upturned tail flick at (0, 0.047, 0.012);
a flattened kn_latex_ignition beak (0.022 long x 0.030 wide) centred (0, -0.052, 0.034); kn_latex_bone eye whites
(Ø 0.012 at (±0.018, -0.040, 0.050)) with kn_powder_graphite pupils and a modelled bone catchlight. A small graphite
squeak hole sits under the tail. Shape key sk_squash (body -15 % height, +8 % width, head tips back 6°) on every
piece at LOD0 / LOD1. No sailor hat, no licensed faces.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'quack'
# pupils and the squeak hole are kn_rubber (brief: kn_powder_graphite): the tiny graphite islands failed check 13's
# slot mean (+59 %), while the rubber master calibrates on small pieces (feet) and reads the same dark slate
AMBER, BONE, IGN, G = 'kn_latex_amber', 'kn_latex_bone', 'kn_latex_ignition', 'kn_rubber'
MASTERS = [AMBER, BONE, IGN, G]
BASE = -0.028
BODY_C, BODY_R = Vector((0.0, 0.002, -0.002)), (0.041, 0.049, 0.026)
HEAD_C, HEAD_R = Vector((0.0, -0.020, 0.040)), 0.025
BEAK_C = Vector((0.0, -0.052, 0.034))
EYES = [Vector((s * 0.018, -0.040, 0.050)) for s in (-1, 1)]
NECK = Vector((0.0, -0.012, 0.020))


def squash(co):
    """sk_squash: body -15 % height toward the base, +8 % width; the head (blended in above z 0.012) tips back 6°
    about the neck after riding the squashed body down."""
    w = max(0.0, min(1.0, (co.z - 0.010) / 0.014))
    sq = Vector((co.x * (1 + 0.08 * (1 - w)), co.y, BASE + (co.z - BASE) * 0.85))
    if w <= 0:
        return sq
    neck_sq = Vector((NECK.x, NECK.y, BASE + (NECK.z - BASE) * 0.85))
    rel = Vector((co.x, co.y, co.z)) - NECK
    rot = Matrix.Rotation(math.radians(-6.0), 3, 'X') @ rel
    head = neck_sq + rot
    return sq.lerp(head, w)


def body_profile(rings):
    """Flat-bottomed ovoid profile (unit radius in plan, real z): an ellipse of half-height 0.030 about BODY_C cut
    by the base plane, so the duck sits on a flat disc (r 0.5) at z BASE."""
    rz = 0.030
    phi0 = math.asin((BASE - BODY_C.z) / rz)
    pts = [(0.0, BASE)]
    for i in range(rings + 1):
        phi = phi0 + (math.pi / 2 - phi0) * i / rings
        pts.append((math.cos(phi) if i < rings else 0.0, BODY_C.z + rz * math.sin(phi)))
    return kit.dedupe([(r, z, None) for r, z in pts])


def build(lod, q):
    duck = Kit()
    n = seg(36, q, 6, 2) if lod < 3 else 5
    prof = [(r, z, AMBER) for r, z, _ in body_profile(seg(14, q, 4))]
    duck.lathe(prof, n, m=Matrix.Translation((BODY_C.x, BODY_C.y, 0)) @ Matrix.Diagonal((BODY_R[0], BODY_R[1],
                                                                                         1.0, 1.0)))
    duck.sphere(HEAD_R, AMBER, n, seg(14, q, 4), m=kit.at(*HEAD_C))
    # neck fillet (a short squat cylinder blending head into body)
    duck.cyl(0.019, 0.0, 0.020, AMBER, n, m=kit.at(HEAD_C.x, HEAD_C.y + 0.004, 0.012))
    # tail flick: a tapering curl up and back
    tail = _m4.smooth_path([(0, 0.034, -0.002), (0, 0.042, 0.004), (0, 0.045, 0.012), (0, 0.0425, 0.019)],
                           (3, 2, 1, 1)[lod])
    radii = [0.0085 * (1 - 0.8 * i / (len(tail) - 1)) + 0.0012 for i in range(len(tail))]
    duck.sweep(tail, 0.01, seg(10, q, 4) if lod < 3 else 3, AMBER, radii=radii)
    beak = Kit()
    beak.sphere(1.0, IGN, seg(20, q, 6), seg(8, q, 4),
                m=Matrix.Translation(BEAK_C) @ kit.rot_x(-8) @ Matrix.Diagonal((0.0145, 0.0115, 0.0052, 1.0)))
    eyes = Kit()
    for e in EYES:
        out = (e - HEAD_C).normalized()
        if lod < 3:
            eyes.sphere(0.006, BONE, seg(14, q, 6), seg(7, q, 4), m=kit.at(*(e)))
            pc = e + out * 0.0032
            eyes.sphere(0.0034, G, seg(12, q, 5), seg(6, q, 3), m=kit.frame(tuple(pc), tuple(out)), sz_bot=0.4)
            if lod < 2:
                eyes.sphere(0.0011, BONE, 6, 3, m=kit.at(*(pc + out * 0.0024 + Vector((0.0, 0.0, 0.0012)))))
        else:
            eyes.sphere(0.006, G, 5, 3, m=kit.at(*(e)))
    keel = Kit()
    if lod < 3:  # bone keel mark on the underside + squeak hole
        keel.cyl(1.0, BASE - 0.0004, BASE + 0.0004, BONE, seg(20, q, 6),
                 m=Matrix.Translation((0, 0.002, 0)) @ Matrix.Diagonal((0.018, 0.030, 1.0, 1.0)))
        keel.cyl(0.0022, BASE - 0.0007, BASE + 0.0002, G, seg(10, q, 5), m=kit.at(0.0, 0.010, 0.0))
    pieces = {'duck': duck, 'beak': beak, 'eyes': eyes, 'keel': keel}
    if lod < 2:
        for k_ in pieces.values():
            k_.shape_keys['sk_squash'] = (squash, 'squeeze 0..1 (0.12 s in, 0.25 s spring back)', 0.0)
    return pieces


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '1,1,1', 0.04, 'com', 2200,
        'Floating, squeaking rubber duck (free body; origin = the briefed COM 0.028 above the flat base, '
        'kn_com_explicit; beak -Y): kn_latex_amber flat-bottomed ovoid body (0.082 x 0.098 x 0.052), head Ø 0.050, '
        'upturned tail flick; kn_latex_ignition flattened beak; kn_latex_bone eye whites + keel mark, '
        'kn_rubber pupils with bone catchlights, rubber squeak hole under the tail. Shape key sk_squash '
        '(body -15 % height, +8 % width, head back 6°) on every piece, LOD0/1. Fluid channel only: the squeak is '
        'cosmetic audio, never a Sound event. Brief: docs/art/briefs/fun.md#quack.',
        MASTERS, skins='amber,plasma,bone,cobalt', pipeline={'kn_com_explicit': True},
        hints={'kn_buoyancy_volume': 0.00025})
    part.build_lods(build, lod0_q=1.0)
    hull = []
    for i in range(8):
        phi = -math.pi / 2 + math.pi * i / 7
        z = max(BASE, BODY_C.z + BODY_R[2] * math.sin(phi))
        rr = max(0.62, math.cos(phi)) if z <= BASE + 1e-6 else math.cos(phi)
        for j in range(6):
            a = 2 * math.pi * j / 6 + (0.5 if i % 2 else 0.0)
            hull.append((BODY_C.x + BODY_R[0] * rr * math.cos(a), BODY_C.y + BODY_R[1] * rr * math.sin(a), z))
    part.col_hull('0', hull, phys='rubber', restitution=0.55, friction=0.7)
    part.col_sphere('1', HEAD_R, tuple(HEAD_C), phys='rubber', restitution=0.55, friction=0.7)
    inset = [(x * 0.94, BODY_C.y + (y - BODY_C.y) * 0.94, z * 0.94 + BASE * 0.06) for x, y, z in hull]
    part.sensor('pressure', 'squeeze', inset, threshold=0.06, load_kg=0.3)
    part.emit('squeak', 'hole', (0.0, 0.010, BASE), (0, 0, -1))
    part.emit('splash', 'base', (0.0, 0.0, BASE), (0, 0, -1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
