"""Procedurally build the SNIPPER source file (docs/art/briefs/contraptions.md, "SNIPPER: Big scissors").

Usage: blender -b --factory-startup -P tools/blender/make_snipper.py -- [out.blend]
Default output: assets/src/contraptions/snipper.blend

Oversized scissors lying open on a bone plinth (0.24 x 0.18 x 0.036, 6 mm pillow, rubber feet). Each half is a
brushed-steel blade (0.13 long, tip at x 0.15, real bevelled edges, straight cutting edge facing the jaw) plus
the opposite steel shank and an Ignition finger loop (outer Ø 0.06, reaching x -0.15 and y +-0.089), stacked at
z 0.065 (half_a) / 0.055 (half_b) on the Ignition pivot post at (0.02, 0), with a chrome torsion spring under the
blades, the M8 pivot screw (top z 0.085) and the Ø 6 mm ready LED. Modelled open (ready): PIVOT__half_a at +25°,
PIVOT__half_b at -25° (pivot prop `rest`), 0 = closed.
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

TYPE = 'snipper'
PLINTH = (0.24, 0.18, 0.036)
FEET = 0.0035
PIVOT = Vector((0.02, 0.0, 0.06))
OPEN = 25.0
BLADE_Z = {'half_a': 0.065, 'half_b': 0.055}
BLADE_T = 0.0076
LOOP_C, LOOP_R, LOOP_r = Vector((-0.12, 0.059)), 0.024, 0.006
BONE, STEEL, IGN, CHROME, RUBBER, LED = ('kn_powder_bone', 'kn_steel_brushed', 'kn_powder_ignition', 'kn_chrome',
                                         'kn_rubber', 'kn_led')
MASTERS = [BONE, STEEL, IGN, CHROME, RUBBER, LED]


def blade_outline(n, side):
    """Blade + pivot boss in the half's local frame (blade along +x from the pivot). side = +1 opens toward +y:
    its straight cutting edge is on -y, the curved spine on +y."""
    pts = [(0.13, 0.0), (0.11, 0.0035 * side), (0.07, 0.0085 * side), (0.03, 0.0115 * side)]
    k = max(3, n)
    for i in range(k + 1):
        a = math.pi / 2 + math.pi * i / k  # boss back arc, r 0.0125
        pts.append((0.0125 * math.cos(a), 0.0125 * math.sin(a) * side))
    pts.append((0.03, -0.006 * side))
    if side < 0:
        pts.reverse()
    return pts[::-1] if _area(pts) < 0 else pts


def _area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def half(lod, q, name, sign):
    k = Kit(pivot='PIVOT__' + name)
    z = BLADE_Z[name]
    m = kit.at(PIVOT.x, PIVOT.y, 0) @ kit.rot_z(sign * OPEN)
    bev = 0.0008 if lod < 3 else 0.0
    k.prism(blade_outline(seg(10, q, 3), sign), z - BLADE_T / 2, z + BLADE_T / 2, STEEL, bt=bev, bb=bev,
            bseg=1, m=m)
    # loop on the far side: world centre (-0.12, -sign * 0.059)
    loop = Vector((LOOP_C.x, -sign * LOOP_C.y, z))
    rel = (loop - Vector((PIVOT.x, PIVOT.y, z)))
    d = rel.normalized()
    p0 = Vector((PIVOT.x, PIVOT.y, z)) + d * 0.008
    p1 = loop - d * (LOOP_R - 0.002)
    k.sweep([p0, p1], 0.0042, seg(10, q, 5), STEEL)
    k.torus(LOOP_R, LOOP_r, IGN, seg(32, q, 8), (8, 6, 4, 4)[lod], m=kit.at(*loop))
    return k


def spring(kit_, q):
    turns, z0, z1, r, wire = 3.0, 0.0385, 0.0505, 0.0155, 0.0012
    n = max(12, int(48 * q))
    path = [(PIVOT.x + r * math.cos(2 * math.pi * turns * i / n), PIVOT.y + r * math.sin(2 * math.pi * turns * i / n),
             z0 + (z1 - z0) * i / n) for i in range(n + 1)]
    kit_.sweep(path, wire, 6, CHROME)


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    base = Kit()
    base.rbox((PLINTH[0], PLINTH[1], PLINTH[2] - FEET), (0, 0, FEET + (PLINTH[2] - FEET) / 2),
              0.012 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.006 if lod < 3 else 0.0)
    if lod < 3:
        for x in (-0.1, 0.1):
            for y in (-0.07, 0.07):
                base.cyl(0.008, 0.0, FEET + 0.0006, RUBBER, seg(14, q, 6), bev=0.0012 if lod < 2 else 0.0, bseg=1,
                         bev_bot=0.0012 if lod < 2 else 0.0, m=kit.at(x, y, 0))
    base.cyl(0.0105, PLINTH[2] - 0.002, 0.0695, IGN, seg(24, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1,
             m=kit.at(PIVOT.x, PIVOT.y, 0))
    if lod < 2:
        spring(base, q)
    base.cyl(0.009, 0.0688, 0.081, STEEL, seg(20, q, 6), bev=0.001 if lod < 2 else 0.0, bseg=1,
             m=kit.at(PIVOT.x, PIVOT.y, 0))
    base.sphere(0.0068, STEEL, seg(20, q, 6), (8, 6, 4, 2)[lod], sz_top=0.6, sz_bot=0.1,
                m=kit.at(PIVOT.x, PIVOT.y, 0.081))
    base.sphere(0.003, LED, seg(12, q, 4), (6, 4, 2, 2)[lod], sz_bot=0.2, m=kit.at(PIVOT.x, PIVOT.y, 0.0848))
    pieces = {'plinth': base, 'half_a': half(lod, q, 'half_a', 1), 'half_b': half(lod, q, 'half_b', -1)}
    # Plinth front: name plate + blades pictogram (one pictogram per face), clear of the signal ring at x -0.06.
    n, up, yf = (0, -1, 0), (0, 0, 1), -PLINTH[1] / 2
    decals = [kit.decal_plane('name.snipper.graphite', (0.045, yf, 0.020), n, up, 0.07),
              kit.decal_plane('picto.blades.warn', (-0.022, yf, 0.020), n, up, 0.016, 0.016)]
    return kit.add_decals(pieces, lod, decals)


def half_hull(name, sign):
    z = BLADE_Z[name]
    rot = Matrix.Rotation(math.radians(sign * OPEN), 3, 'Z')
    pts = []
    for x, y in blade_outline(4, sign)[:5]:
        p = rot @ Vector((x, y, 0)) + Vector((PIVOT.x, PIVOT.y, 0))
        pts += [(p.x, p.y, z - 0.004), (p.x, p.y, z + 0.004)]
    loop = Vector((LOOP_C.x, -sign * LOOP_C.y))
    for k in range(8):
        a = 2 * math.pi * k / 8
        pts += [(loop.x + 0.03 * math.cos(a), loop.y + 0.03 * math.sin(a), z + s * 0.004) for s in (-1, 1)]
    return pts


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '3,1,2', 1.4, 'bottom', 5000,
        'Big scissors on a plinth, modelled open (ready). Brief: docs/art/briefs/contraptions.md#snipper. '
        'Pivots rest at +-25° (open); 0 = closed (tips at x 0.15). kn_bounds = origin: open blades shift '
        'the bounds centre 6 mm. Deferred: sk_wind spring shape key, '
        'tailor skin.',
        MASTERS, led_groups='0:ready', pipeline={'kn_bounds': 'origin'})
    part.pivot('half_a', tuple(PIVOT), 'z', 0.0, OPEN, rest=OPEN)
    part.pivot('half_b', tuple(PIVOT), 'z', -OPEN, 0.0, rest=-OPEN)
    part.build_lods(build, lod0_q=1.2)
    part.col_box('plinth', PLINTH, (0, 0, PLINTH[2] / 2), phys='powder', restitution=0.2, friction=0.5)
    part.col_box('post', (0.024, 0.024, 0.034), (PIVOT.x, PIVOT.y, 0.053), phys='powder')
    for name, sign in (('half_a', 1), ('half_b', -1)):
        part.col_hull(name, half_hull(name, sign), phys='steel', sharp=True)
    part.port('signal', 'close', (-0.06, -0.091, 0.02), (0, -1, 0), 'S', 'in')
    ta = Matrix.Rotation(math.radians(OPEN), 3, 'Z') @ Vector((0.13, 0, 0)) + Vector((PIVOT.x, PIVOT.y, 0))
    tb = Matrix.Rotation(math.radians(-OPEN), 3, 'Z') @ Vector((0.13, 0, 0)) + Vector((PIVOT.x, PIVOT.y, 0))
    jaw = [(PIVOT.x + 0.012, 0.0), (ta.x, ta.y - 0.003), (tb.x, tb.y + 0.003)]
    part.sensor('trigger', 'jaw', [(x, y, z) for x, y in jaw for z in (0.045, 0.075)])
    part.sensor('impact', 'handle', [(x, y, z) for x in (-0.15, -0.09) for y in (-0.089, 0.089)
                                     for z in (0.045, 0.075)], threshold=0.4)
    part.emit('snip', 'jaw', (0.10, 0.0, 0.06), (1, 0, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
