"""Procedurally build the POWDER KEG source file (docs/art/briefs/boom.md, "POWDER KEG: Big oak barrel charge").

Usage: blender -b --factory-startup -P tools/blender/make_powder_keg.py -- [out.blend]
Default output: assets/src/boom/powder_keg.blend

A fat oak keg (2 x 3 x 2, free body, origin = centre of mass at mid-height, floor contact z -0.15): 12 kn_wood_oak
staves bellied from Ø 0.17 at the heads (z ±0.15) to Ø 0.20 at z 0, each a separate closed partial lathe with a
2 mm groove between neighbours and its own kn_paper_red belly wrap face (z -0.07 ... 0.07); two oak lids recessed
8 mm inside the chime (top face z 0.142); two kn_powder_graphite hoops (20 mm at z ±0.10, one M5 each at the
front). On the top lid: the PR-S heat fuse and signal detonator rings 90 mm apart (x ±0.045), a kn_brass bung
collar (Ø 0.012) in the fuse ring with the kn_fuse_cord stub curling out to its tip (0.065, -0.02, 0.165) through a
kn_led ember sleeve, and the amber / graphite hazard stripe ring decal on the lid rim (r 0.063 ... 0.075). Name
plate on the front stave, explosive pictogram on the next. FRAC__01-16: 12 staves (oak + wrap, kn_interior_wood
torn ends), 2 hoops sprung into 290° C-shapes, 2 lids (the top one keeps the bung).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'powder_keg'
H = 0.15                        # half height (heads at z ±0.15)
R0, R1 = 0.10, 0.085            # belly / head radius
WALL = 0.012
LID_Z = 0.142
WRAP = 0.07
HOOPS = (-0.10, 0.10)
N_STAVES = 12
GAP = math.radians(0.9)         # half-gap between staves
FUSE = (0.045, 0.0, LID_Z)
DET = (-0.045, 0.0, LID_Z)
TIP = (0.065, -0.02, 0.165)
OAK, RED, G, BRASS, CORD, LED, STEEL, IWOOD = (
    'kn_wood_oak', 'kn_paper_red', 'kn_powder_graphite', 'kn_brass', 'kn_fuse_cord', 'kn_led', 'kn_steel_brushed',
    'kn_interior_wood')
MASTERS = [OAK, RED, G, BRASS, CORD, LED, STEEL, IWOOD, 'kn_decal']


def r_at(z):
    t = z / H
    return R1 + (R0 - R1) * (1 - t * t)


def stave_profile(nz, wrap=True):
    """Closed (r, z, master) profile of one stave: outer belly curve up (oak / paper wrap), inner curve down."""
    zs = sorted(set([-H + 2 * H * i / nz for i in range(nz + 1)] + ([-WRAP, WRAP] if wrap else [])))
    out = []
    for z in zs:
        m = RED if (wrap and -WRAP - 1e-6 <= z < WRAP - 1e-6) else OAK
        out.append((r_at(z) + (0.0006 if m == RED else 0.0), z, m))
    inner = [(r_at(z) - WALL, z, OAK) for z in reversed(zs)]
    return out + inner


def stave(k, i, lod, q, cap=None):
    a_mid = -math.pi / 2 + 2 * math.pi * i / N_STAVES          # stave 0 faces -Y (front)
    da = math.pi / N_STAVES
    k.lathe_arc(stave_profile((14, 9, 6, 3)[lod]), a_mid - da + GAP, a_mid + da - GAP, (5, 3, 2, 1)[lod],
                cap=cap or OAK)


def hoop(k, z, lod, q, a0=0.0, a1=None, cap=None):
    n = seg(72, q, 12)
    w, t = 0.010, 0.003
    prof = [(r_at(z - w) - 0.001, z - w, G), (r_at(z - w) + t * 0.7, z - w, G), (r_at(z) + t, z - w * 0.4, G),
            (r_at(z) + t, z + w * 0.4, G), (r_at(z + w) + t * 0.7, z + w, G), (r_at(z + w) - 0.001, z + w, G)]
    if a1 is None:
        k.lathe(prof, n, closed=True)
    else:
        k.lathe_arc(prof, a0, a1, max(4, int(n * (a1 - a0) / (2 * math.pi))), cap=cap or G)


def lid(k, top, lod, q):
    z = LID_Z if top else -LID_Z
    n = seg(56, q, 10)
    rr = r_at(LID_Z) - WALL + 0.0015
    if top:
        k.cyl(rr, z - 0.014, z, OAK, n, bev=0.0015 if lod < 3 else 0.0, bseg=1, bev_bot=0.0)
    else:
        k.cyl(rr, z, z + 0.014, OAK, n, bev=0.0015 if lod < 3 else 0.0, bseg=1)


def bung(k, lod, q):
    k.cyl(0.006, LID_Z - 0.002, LID_Z + 0.006, BRASS, seg(16, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1,
          m=kit.at(FUSE[0], FUSE[1], 0))
    path = [Vector((FUSE[0], 0, LID_Z + 0.004)), Vector((FUSE[0] + 0.001, -0.001, 0.153)),
            Vector((FUSE[0] + 0.006, -0.006, 0.161)), Vector((0.058, -0.013, 0.166)), Vector(TIP)]
    if lod < 3:
        k.sweep([tuple(p) for p in path], 0.0022, seg(8, q, 4), CORD)
        k.cyl(0.0034, 0.0, 0.009, LED, seg(10, q, 5), m=kit.frame(tuple(path[1]), tuple(path[2] - path[1])))
    else:
        k.sweep([tuple(p) for p in (path[0], path[2], path[4])], 0.0022, 4, CORD)


def build(lod, q, mats):
    staves = Kit()
    if lod < 3:
        for i in range(N_STAVES):
            stave(staves, i, lod, q)
    else:  # LOD3: one solid bellied shell, 12 sides (one per stave), wrap band kept
        prof = [(0.0, -H, OAK)] + [(r_at(z), z, RED if -WRAP <= z < WRAP else OAK)
                                   for z in (-H, -WRAP, 0.0, WRAP, H)] + [(0.0, H, OAK)]
        staves.lathe(prof, N_STAVES, start=-math.pi / 2)
    lids = Kit()
    lid(lids, True, lod, q)
    lid(lids, False, lod, q)
    bung(lids, lod, q)
    hoops = Kit()
    for z in HOOPS:
        hoop(hoops, z, lod, q)
        _m2.screw(hoops, 'M5', (0, -(r_at(z) + 0.003), z), (0, -1, 0), q, lod)
    lids.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.0))
    pieces = {'staves': staves, 'lids': lids, 'hoops': hoops}
    a1 = -math.pi / 2 + 2 * math.pi / N_STAVES
    d1 = (math.cos(a1), math.sin(a1), 0.0)
    # hazard ring: 7 arcs, each sampling the whole seamless stripe tile once (UVs stay inside the atlas slot)
    ring = [_m2.ring_decal('trim.hazard_r', (0, 0, LID_Z), (0, 0, 1), (1, 0, 0), 0.063, 0.075, 2 * math.pi * i / 7,
                           2 * math.pi * (i + 1) / 7, 4) for i in range(7)]
    return kit.add_decals(pieces, lod, ring + [
        kit.decal_cylinder('name.powder_keg.graphite', (0, 0, -0.10 - 0.025), (0, 0, 1), r_at(-0.125) + 0.0002,
                           (0, -1, 0), 0.05, nu=4),
        kit.decal_cylinder('picto.explosive.warn', (0, 0, 0.0), (0, 0, 1), r_at(0.0) + 0.0008, d1, 0.032, 0.032, nu=4),
    ])


def frac_kits(q=0.8):
    out = []
    for i in range(N_STAVES):  # FRAC__01-12 staves (oak + wrap, interior-wood torn ends)
        k = Kit()
        stave(k, i, 0, q, cap=IWOOD)
        k.mi(IWOOD)
        out.append(k)
    for j, z in enumerate(HOOPS):  # FRAC__13-14 hoops sprung open into 290° C-shapes
        k = Kit()
        a0 = math.radians(35 + 120 * j)
        hoop(k, z, 0, q, a0, a0 + math.radians(290), cap=G)
        out.append(k)
    for top in (True, False):  # FRAC__15-16 lids (top keeps the bung)
        k = Kit()
        lid(k, top, 0, q)
        if top:
            bung(k, 0, q)
        out.append(k)
    return out


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '2,3,2', 6.0, 'com', 8500,
        'Big oak barrel charge (free body, origin at mid-height COM): 12 kn_wood_oak staves (Ø 0.20 belly, Ø 0.17 '
        'heads) each with its kn_paper_red belly wrap face, lids recessed 8 mm (top z 0.142), two kn_powder_graphite '
        'hoops (z ±0.10, one M5 each at the front). Top lid: PR-S heat fuse and signal detonator rings at x ±0.045, '
        'kn_brass bung collar + kn_fuse_cord stub to (0.065, -0.02, 0.165) through a kn_led ember sleeve, hazard '
        'stripe ring decal (r 0.063 ... 0.075). Name plate on the front stave, explosive pictogram on the next. '
        'FRAC__01-16 (12 staves, 2 hoop C-shapes, 2 lids; the ring copies on the top lid are left to the engine). '
        'UV1 authored for the 2048² oak set (bake pending). Brief: docs/art/briefs/boom.md#powder-keg.',
        MASTERS, skins='classic,xxx', hints={'kn_macro_chunks': 16, 'kn_yield': 3.0, 'kn_cookoff_s': 1.5})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    pts = []
    for z, r in ((-H, R1), (-0.04, R0), (0.04, R0), (H, R1)):
        for i in range(12):
            a = 2 * math.pi * (i + 0.5) / 12
            pts.append((r / math.cos(math.pi / 12) * math.cos(a), r / math.cos(math.pi / 12) * math.sin(a), z))
    part.col_hull('body', pts, phys='wood', restitution=0.15, friction=0.6)
    part.port('heat', 'fuse', FUSE, (0, 0, 1), 'S', 'in')
    part.port('signal', 'detonator', DET, (0, 0, 1), 'S', 'in')
    part.emit('spark', 'fuse_tip', TIP, (0, 0, 1))
    part.emit('smoke', 'bung', (FUSE[0], 0, 0.15), (0, 0, 1))
    part.emit('boom', 'core', (0, 0, 0), (0, 0, 1))
    _m2.frac_objects(part, frac_kits())
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
