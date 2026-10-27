"""Procedurally build the POPPER source file (docs/art/briefs/boom.md, "POPPER: Party popper on a base").

Usage: blender -b --factory-startup -P tools/blender/make_popper.py -- [out.blend]
Default output: assets/src/boom/popper.blend

A party-popper cone standing in a graphite cup (1 x 1.5 x 1, bottom origin): a pillowed kn_powder_graphite base cup
(Ø 0.08 x 0.045) on three FOOT_S bumpers with a flat front boss for the PR-S tension ring; a kn_paper_red cone
(Ø 0.03 at z 0.05 -> Ø 0.06 at z 0.14, axis exactly +Z) wrapped by an amber / graphite spiral stripe decal; a
kn_paper_tan foil cap of six petals that open with shape key `sk_torn` (0 sealed -> 1 petals peeled 115° out over
the rim); a kn_rope pull string from the ring to the kn_powder_bone pull tab (20 x 12 mm) on PIVOT__tab (axis y,
slide 0 ... -0.03). An air puff, not an explosive: no explosive pictogram.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'popper'
CUP_R, CUP_H, FEET = 0.0402, 0.045, 0.003
CZ0, CZ1, CR0, CR1 = 0.045, 0.14, 0.015, 0.030
CAP_Z = CZ1
PETALS = 6
PORT = (0.0, -0.041, 0.022)
TAB = (0.0, -0.062, 0.010)
G, RUBBER, RED, TAN, ROPE, BONE = (
    'kn_powder_graphite', 'kn_rubber', 'kn_paper_red', 'kn_paper_tan', 'kn_rope', 'kn_powder_bone')
MASTERS = [G, RUBBER, RED, TAN, ROPE, BONE, 'kn_decal']


def r_cone(z):
    t = (z - CZ0 - 0.005) / (CZ1 - CZ0 - 0.005)
    return CR0 + (CR1 - CR0) * max(0.0, min(1.0, t))


def petal_index(co):
    a = math.atan2(co.y, co.x) % (2 * math.pi)
    return int(a / (2 * math.pi / PETALS)) % PETALS


def torn(co):
    """sk_torn: rotate each petal 115° about its hinge chord on the rim (outward and down)."""
    if co.z < CAP_Z - 0.0005:
        return co
    i = petal_index(co)
    am = 2 * math.pi * (i + 0.5) / PETALS
    d = Vector((math.cos(am), math.sin(am), 0.0))
    hinge = d * (CR1 * math.cos(math.pi / PETALS)) + Vector((0, 0, CAP_Z))
    axis = Vector((-d.y, d.x, 0.0))
    rot = Matrix.Rotation(math.radians(-115), 3, axis)
    return hinge + rot @ (co - hinge)


def cap(lod, q):
    """Six thin closed petal wedges (tips offset 0.4 mm along their bisector so each vertex has one petal)."""
    k = Kit()
    rim = CR1 + 0.0008
    for i in range(PETALS):
        a0, a1 = 2 * math.pi * i / PETALS, 2 * math.pi * (i + 1) / PETALS
        am = (a0 + a1) / 2
        n = (4, 2, 1, 1)[lod]
        tip = (0.0004 * math.cos(am), 0.0004 * math.sin(am))
        pts = [tip] + [(rim * math.cos(a0 + (a1 - a0) * j / n + (0.02 if j == 0 else -0.02 if j == n else 0.0)),
                        rim * math.sin(a0 + (a1 - a0) * j / n + (0.02 if j == 0 else -0.02 if j == n else 0.0)))
                       for j in range(n + 1)]
        k.prism(pts, CAP_Z - 0.0002, CAP_Z + 0.0012, TAN)
    if lod < 2:  # shape keys ride LOD0 / LOD1 only
        k.shape_keys['sk_torn'] = (torn, '0 sealed foil cap -> 1 six petals peeled 115° out over the rim (pop)', 0.0)
    return k


def spiral_stripe(turns=1.75, n=120, w=0.011, t0=0.0, t1=1.0):
    rows = []
    for j in (0, 1):
        row = []
        for i in range(n + 1):
            t = t0 + (t1 - t0) * i / n
            z = CZ0 + 0.012 + (CZ1 - CZ0 - 0.024) * t + (j - 0.5) * w
            a = -math.pi / 2 + 2 * math.pi * turns * t
            r = r_cone(z) + 0.0005
            row.append(Vector((r * math.cos(a), r * math.sin(a), z)))
        rows.append(row)
    rect = kit.atlas_rect('trim.hazard_narrow_r', (0.0, 0.0, 1.0, 1.0))
    return kit.decal_grid(rows, rect)


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    cup = Kit()
    n = seg(36, q, 8)
    cup.cyl(CUP_R, FEET, CUP_H, G, n, bev=0.005 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
            bev_bot=0.002 if lod < 3 else 0.0)
    _m2.land(cup, 'S', PORT, (0, -1, 0), 0.006, lod)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        _m2.foot(cup, 'S', 0.028 * math.cos(a), 0.028 * math.sin(a), min(1.0, q), lod)
    cone = Kit()
    prof = [(0.0, CZ0 - 0.004, RED), (CR0, CZ0 - 0.004, RED), (CR0, CZ0 + 0.005, RED), (CR1, CZ1 - 0.0015, RED),
            (CR1 + 0.0008, CZ1 - 0.0004, TAN), (CR1, CZ1, TAN), (0.0, CZ1 - 0.002, TAN)]
    cone.lathe(prof, seg(32, q, 8))
    string = Kit(pivot='PIVOT__tab')  # pulls out with the tab on pop
    if lod < 3:
        path = [(PORT[0], PORT[1] + 0.003, PORT[2]), (0.0, -0.047, 0.019), (0.0, -0.052, 0.014),
                (0.0, TAB[1] + 0.005, TAB[2] + 0.002)]
        string.sweep(path, 0.00125, (6, 5, 4)[lod], ROPE)
    tab = Kit(pivot='PIVOT__tab')
    tab.rbox((0.020, 0.012, 0.004), TAB, 0.003 if lod < 3 else 0.0, BONE, cseg=max(1, cs - 1) if lod < 3 else 0,
             rz=0.0015 if lod < 3 else 0.0, m=None)
    pieces = {'cup': cup, 'cone': cone, 'cap': cap(lod, q), 'string': string, 'tab': tab}
    if lod < 2:
        for s in range(3):  # three runs, each sampling the seamless tile once (UVs inside the slot)
            pieces['decal_%d' % (s + 1)] = spiral_stripe(n=(40, 22)[lod], t0=s / 3, t1=(s + 1) / 3)
    return pieces


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'S', '1,1.5,1', 0.12, 'bottom', 2200,
        'Party popper on a base: pillowed graphite cup (Ø 0.08 x 0.045) on 3 x FOOT_S with a 6 mm front boss for the '
        'PR-S tension (hook) ring; kn_paper_red cone (Ø 0.03 -> 0.06, axis +Z) with an amber / graphite spiral stripe '
        'decal; kn_paper_tan foil cap as six petals with shape key sk_torn (0 sealed -> 1 peeled open); kn_rope pull '
        'string to the kn_powder_bone tab on PIVOT__tab (y, 0 ... -0.03). Air puff only: no explosive pictogram. UV1 '
        'authored for the 1024² set (bake pending). Brief: docs/art/briefs/boom.md#popper.',
        MASTERS, skins='classic,gold', pipeline={'kn_bounds': 'origin'})
    part.pivot('tab', TAB, 'y', -0.03, 0.0, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_cyl('base', CUP_R, CUP_H, (0, 0, CUP_H / 2), 'z', phys='powder', restitution=0.2, friction=0.6)
    pts = [(r * math.cos(2 * math.pi * i / 10), r * math.sin(2 * math.pi * i / 10), z)
           for r, z in ((CR0, CZ0), (CR1 + 0.001, CZ1 + 0.005)) for i in range(10)]
    part.col_hull('cone', pts, phys='paper', restitution=0.2, friction=0.5)
    part.port('tension', 'string', PORT, (0, -1, 0), 'S', 'in', kind='hook')
    part.emit('confetti', 'mouth', (0, 0, 0.145), (0, 0, 1))
    part.emit('wind', 'mouth', (0, 0, 0.145), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
