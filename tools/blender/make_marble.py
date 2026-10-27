"""Procedurally build the MARBLE source file (docs/art/briefs/rollers.md, "GLINT / BEARING: Glass and steel marble").

Usage: blender -b --factory-startup -P tools/blender/make_marble.py -- [out.blend]
Default output: assets/src/rollers/marble.blend

The cheapest possible instance (instancing-heavy, ASSET_PIPELINE §4): a Ø 0.016 UV sphere, origin at its centre
(com), one material slot. LOD0 16 x 10 = 288 tris, LOD1 12 x 7 = 144, LOD2 9 x 5 = 72 (the Matter grain mesh, still
a convincing sphere), LOD3 a 20-tri icosahedron (the §4 primitive floor). Default skin `glint` (kn_ceramic_beam,
gloss; the cat's-eye swirl is the 1024² BaseColor of the texture set, facing -Y unrotated); skin `bearing` swaps
the master to kn_chrome. No transmission, no inner geometry.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'marble'
R = 0.008
MAT = 'kn_ceramic_beam'
MASTERS = [MAT]
SPHERES = {0: (16, 10), 1: (12, 7), 2: (9, 5)}


def icosahedron(r):
    p = (1 + math.sqrt(5)) / 2
    pts = [(-1, p, 0), (1, p, 0), (-1, -p, 0), (1, -p, 0), (0, -1, p), (0, 1, p), (0, -1, -p), (0, 1, -p),
           (p, 0, -1), (p, 0, 1), (-p, 0, -1), (-p, 0, 1)]
    s = r / math.sqrt(1 + p * p)
    return [(x * s, y * s, z * s) for x, y, z in pts]


def build(lod, q):
    k = Kit()
    if lod in SPHERES:
        segs, rings = SPHERES[lod]
        # seam at +Y (the back) so the swirl centred on -Y is unbroken
        k.sphere(R, MAT, segs, rings, m=kit.rot_z(90))
    else:
        k.hull(icosahedron(R), MAT)
    return {'body': k}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'S', '0.16,0.16,0.16', 0.0054, 'com', 288,
        'GLINT / BEARING marble: Ø 0.016 UV sphere (LOD0 16 x 10 = 288, LOD1 144, LOD2 72 = Matter grain, LOD3 20-tri '
        'icosahedron floor), one slot. Default skin glint = kn_ceramic_beam (swirl BaseColor faces -Y; texture set '
        'pending), skin bearing = kn_chrome. Per-variant mass / phys / kn_magnetic (bearing 0.0167 kg, steel, '
        'magnetic) live in marble.part.json, so the root carries the glint values. No transmission or inner geometry. '
        'Brief: docs/art/briefs/rollers.md#glint--bearing.',
        MASTERS, skins='glint,bearing')
    part.build_lods(build, lod0_q=1.0, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_sphere('0', R, phys='glass', restitution=0.6, friction=0.3)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
