"""Procedurally build the SPONGE source file (docs/art/briefs/matter.md, "SPONGE: Absorbing foam block").

Usage: blender -b --factory-startup -P tools/blender/make_sponge.py -- [out.blend]
Default output: assets/src/matter/sponge.blend

A chunky kn_fabric_bone foam block (0.20 x 0.10, z -0.05 ... +0.035; free body, origin = centre of mass, floor at
z -0.05) with 24 modelled stylised pores (Ø 6-14 mm, boolean-cut at LOD0 / LOD1; LOD2 keeps the larger ones, LOD3
is a plain block), under a kn_fabric_beam scourer layer (z 0.035-0.05). Shape keys sk_swell (+6 % at saturation)
and sk_squash (-35 % height toward the floor, +10 % footprint) on both pieces; the wet look is the engine's wetness
overlay. No cavity: the sponge holds water as its own `wet` state (matter.md).
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
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'sponge'
FOAM, SCOUR = 'kn_fabric_bone', 'kn_fabric_beam'
MASTERS = [FOAM, SCOUR]
W, D, Z0, Z1, Z2 = 0.20, 0.10, -0.05, 0.035, 0.05


def pores():
    """24 pores: (centre, radius) on the foam faces (8 front, 8 back, 2 per end, 4 underneath), seeded."""
    rnd = random.Random(1724)
    out = []

    def jit(a, b):
        return a + (b - a) * rnd.random()
    for face, count in (('-y', 8), ('+y', 8), ('-x', 2), ('+x', 2), ('-z', 4)):
        placed = []
        while len(placed) < count:
            r = jit(0.0035, 0.0072)
            if face in ('-y', '+y'):
                u, v = jit(-0.085, 0.085), jit(Z0 + 0.014, Z1 - 0.012)
                c = Vector((u, (-1 if face == '-y' else 1) * (D / 2 - r * 0.3), v))
            elif face in ('-x', '+x'):
                u, v = jit(-0.035, 0.035), jit(Z0 + 0.014, Z1 - 0.012)
                c = Vector(((-1 if face == '-x' else 1) * (W / 2 - r * 0.3), u, v))
            else:
                u, v = jit(-0.08, 0.08), jit(-0.035, 0.035)
                c = Vector((u, v, Z0 + r * 0.3))
            if all((c - p).length > r + pr + 0.004 for p, pr in placed):
                placed.append((c, r))
        out += placed
    return out


PORES = pores()


def squash(co):
    s = 0.65
    return Vector((co.x * 1.10, co.y * 1.10, Z0 + (co.z - Z0) * s))


def swell(co):
    return co * 1.06


def build(lod, q, mats):
    cs = (3, 2, 1, 2)[lod]
    foam = Kit()
    foam.rbox((W, D, Z1 - Z0 + 0.001), (0, 0, (Z0 + Z1 + 0.001) / 2), 0.012 if lod < 3 else 0.006, FOAM, cseg=cs,
              rz=0.008 if lod < 3 else 0.004)
    if lod < 3:
        import bmesh
        bmesh.ops.triangulate(foam.bm, faces=[f for f in foam.bm.faces if len(f.verts) > 4])
        cut = [p for p in PORES if lod < 2 or p[1] > 0.006]
        cutters = []
        for c, r in cut:
            k = Kit()
            k.sphere(r, FOAM, seg(12, q, 6), seg(6, q, 3), m=kit.at(*c))
            cutters.append(k)
        foam = kit.boolean_diff(foam, cutters, mats)
    scour = Kit()
    scour.rbox((W - 0.002, D - 0.002, Z2 - Z1 + 0.001), (0, 0, (Z1 + Z2 - 0.001) / 2), 0.011 if lod < 3 else 0.005,
               SCOUR, cseg=min(cs, 2) if lod < 3 else 1, rz=0.004 if lod < 3 else 0.002)
    if lod < 2:
        for k_ in (foam, scour):
            k_.shape_keys['sk_swell'] = (swell, 'wet 0..1 -> +6 % size (saturated)', 0.0)
            k_.shape_keys['sk_squash'] = (squash, 'squeeze 0..1 -> -35 % height', 0.0)
    pieces = {'foam': foam, 'scourer': scour}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.sponge.graphite', (0.045, -D / 2 - 0.0001, -0.012), (0, -1, 0), (0, 0, 1), 0.055,
                        lift=0.0006),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'S', '2,1,1', 0.05, 'com', 2500,
        'Absorbing foam block (free body, origin = COM, floor z -0.05): kn_fabric_bone foam (0.20 x 0.10, z -0.05 ... '
        '+0.035) with 24 boolean-cut stylised pores (Ø 6-14 mm), kn_fabric_beam scourer (z 0.035-0.05), name tag '
        'decal on the front. Shape keys sk_swell (+6 %) and sk_squash (-35 % height) on both pieces (LOD0/1); wet '
        'look from the engine wetness overlay (albedo -25 %, roughness -> 0.35). Mass 0.05 kg dry -> 2.05 kg '
        'saturated (engine). Brief: docs/art/briefs/matter.md#sponge.',
        MASTERS, skins='classic,sea', hints={'kn_wet_mass_max': 2.0})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('body', (W, D, Z2 - Z0), (0, 0, 0), phys='rubber', restitution=0.05, friction=0.9)
    part.sensor('intake', 'body', [(x * 0.105, y * 0.055, z * 0.055) for x in (-1, 1) for y in (-1, 1)
                                   for z in (-1, 1)], capacity=2.0)
    part.emit('drip', 'bottom', (0, 0, Z0), (0, 0, -1))
    part.emit('squeeze', 'body', (0, 0, Z0), (0, 0, -1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
