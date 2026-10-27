"""Procedurally build the WRECKER source file (docs/art/briefs/contraptions.md, "WRECKER: Wrecking ball").

Usage: blender -b --factory-startup -P tools/blender/make_wrecker.py -- [out.blend]
Default output: assets/src/contraptions/wrecker.blend

A 20 kg wrecking ball (⌀2, free body, origin = ball centre): a Ø 0.19 kn_powder_bone shell with four meridian
panel lines (0.8 mm grooves), a 40 mm kn_powder_ignition equator band and an Ignition top boss (Ø 0.07) whose face
(z 0.097) carries the PR-M tension hook ring; the kn_chrome D-shackle (Ø 8 mm stock, to z 0.115) rises through the
socket on PIVOT__swivel (axis z). "20 KG" stamp and name plate on the band. No finger holes (not THUD).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'wrecker'
R = 0.095
BAND = 0.02
BOSS_R, BOSS_Z = 0.035, 0.097
BONE, IGN, CHROME = 'kn_powder_bone', 'kn_powder_ignition', 'kn_chrome'
MASTERS = [BONE, IGN, CHROME, 'kn_decal']


def build(lod, q, mats):
    ball = Kit()
    ns, nr = (seg(64, q, 10), seg(32, q, 6, 2)) if lod < 3 else (10, 7)
    # the four 0.8 mm meridian panel lines are normal-map detail (ASSET_PIPELINE §4: < 3 mm), baked with the set
    ball.sphere(R, BONE, ns, nr)
    band = Kit()
    zb = BAND
    rb = math.sqrt(R * R - zb * zb) + 0.0012
    band.lathe([(R - 0.004, -zb, IGN), (rb, -zb, IGN), (R + 0.0012, -zb + 0.004, IGN), (R + 0.0012, zb - 0.004, IGN),
                (rb, zb, IGN), (R - 0.004, zb, IGN)], ns, closed=True)
    zb0 = math.sqrt(R * R - BOSS_R * BOSS_R) - 0.004
    band.cyl(BOSS_R, zb0, BOSS_Z, IGN, seg(36, q, 8) if lod < 3 else 8, bev=0.003 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
             bev_bot=0.0)
    sh = Kit(pivot='PIVOT__swivel')
    n = seg(10, q, 5)
    if lod < 3:  # D-shackle: a U bow standing on the boss, a pin across its feet
        pts = [(-0.012, 0.0, BOSS_Z - 0.002)]
        for i in range(9):
            a = math.pi - math.pi * i / 8
            pts.append((0.012 * math.cos(a), 0.0, BOSS_Z + 0.008 + 0.004 * math.sin(a) + 0.002))
        pts.append((0.012, 0.0, BOSS_Z - 0.002))
        sh.sweep(pts, 0.004, n, CHROME)
        sh.cyl(0.0042, -0.018, 0.018, CHROME, n, bev=0.001 if lod < 2 else 0.0, bseg=1,
               m=kit.at(0, 0, BOSS_Z + 0.001) @ kit.frame(axis='x'))
    else:
        sh.torus(0.012, 0.004, CHROME, 6, 4, m=kit.at(0, 0, BOSS_Z + 0.006) @ kit.rot_x(90))
    pieces = {'ball': ball, 'band': band, 'shackle': sh}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('name.wrecker.bone', (0, 0, 0), (0, 0, 1), R + 0.0013, (0, -1, 0), 0.06, 0.009, nu=6),
        kit.decal_cylinder('mark.mass_20.graphite', (0, 0, -0.034), (0, 0, 1),
                           math.sqrt(R * R - 0.034 ** 2) + 0.0002, (0.0, 1.0, 0), 0.04, 0.04, nu=6),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '2,2,2', 20.0, 'com', 4000,
        'Wrecking ball (free body, origin = ball centre): Ø 0.19 kn_powder_bone shell with four meridian panel '
        'grooves (0.8 mm), 40 mm kn_powder_ignition equator band, Ignition top boss (Ø 0.07, face z 0.097) for the '
        'PR-M tension hook ring, kn_chrome D-shackle (Ø 8 mm stock, to z 0.115) on PIVOT__swivel (z). Name plate on '
        'the band (front), "20 KG" stamp below the band (back). Hangs from a standard LINE (chain). UV1 authored '
        '(bake pending). Brief: docs/art/briefs/contraptions.md#wrecker.',
        MASTERS, skins='classic')
    part.pivot('swivel', (0, 0, BOSS_Z), 'z', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_sphere('ball', R, (0, 0, 0), phys='steel', restitution=0.1, friction=0.5)
    part.port('tension', 'hook', (0, 0, BOSS_Z), (0, 0, 1), 'M', 'both', kind='hook')
    part.emit('dust', 'contact', (0, 0, -R), (0, 0, -1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
