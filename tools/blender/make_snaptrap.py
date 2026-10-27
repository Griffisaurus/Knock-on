"""Procedurally build the SNAPTRAP source file (docs/art/briefs/contraptions.md, "SNAPTRAP: Fling trap").

Usage: blender -b --factory-startup -P tools/blender/make_snaptrap.py -- [out.blend]
Default output: assets/src/contraptions/snaptrap.blend

A mousetrap-style fling board (2 x 0.5 x 1, bottom origin) with no bait and no mouse imagery: a kn_wood_oak board
(0.20 x 0.10, z 0.003 ... 0.015) on four kn_rubber corner pads; a kn_chrome Ø 4 mm wire U-loop snap bar
(0.085 x 0.08) on PIVOT__bar (axis y at (0, 0, 0.022); modelled armed at 0°, lying on -X) carrying the
kn_powder_ignition payload cup (Ø 0.03 x 0.012) at x -0.08; two chrome torsion springs (Ø 0.012) on the axle at
y ±0.035 with shape key `sk_wind` (1 = wound, default); chrome axle staples; a chrome latch wire on PIVOT__latch
(axis y, 0 ... 35°) holding the bar down; the Ignition pedal plate (0.03 x 0.05, grip dots) on PIVOT__pedal (axis y,
-6° ... 0, hinged at its -X edge). Bone name plate decal on the +X board end.
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

TYPE = 'snaptrap'
BZ0, BZ1 = 0.003, 0.015
AXZ = 0.022
BAR_L, BAR_W, WIRE = 0.085, 0.08, 0.002
CUP_X, CUP_R, CUP_H = -0.08, 0.015, 0.012
SPR_Y, SPR_R, SPR_W = 0.035, 0.006, 0.0008
PEDAL = (0.025, 0.0, 0.018)       # hinge (-X edge of the plate)
LATCH = (0.024, 0.0, 0.0185)
OAK, RUBBER, IGN, CHROME = 'kn_wood_oak', 'kn_rubber', 'kn_powder_ignition', 'kn_chrome'
MASTERS = [OAK, RUBBER, IGN, CHROME, 'kn_decal']


def spring(k, sy, lod, q, length=0.012):
    m = kit.at(0, sy, AXZ) @ kit.frame(axis='y')
    _m2.coil(k, SPR_R - SPR_W, SPR_W, -length / 2, length / 2, 4.0, CHROME, q, lod, m=m)
    if lod < 3:  # the spring's long leg pressing on the board
        k.sweep([(0.0, sy, AXZ - SPR_R + 0.001), (0.03, sy, BZ1 + 0.0009)], SPR_W, 4, CHROME)


def bar(k, lod, q):
    n = seg(8, q, 4)
    y = BAR_W / 2
    pts = [(0.0, -y, AXZ), (-BAR_L + 0.008, -y, AXZ), (-BAR_L, -y + 0.008, AXZ), (-BAR_L, y - 0.008, AXZ),
           (-BAR_L + 0.008, y, AXZ), (0.0, y, AXZ)]
    if lod < 2:  # round the U corners
        pts = [(0.0, -y, AXZ)]
        for c, a0 in (((-BAR_L + 0.008, -y + 0.008), -90), ((-BAR_L + 0.008, y - 0.008), 180)):
            for j in range(5):
                a = math.radians(a0 - 90 * j / 4)
                pts.append((c[0] + 0.008 * math.cos(a), c[1] + 0.008 * math.sin(a), AXZ))
        pts.append((0.0, y, AXZ))
    k.sweep(pts, WIRE, n, CHROME)
    # payload cup on the bar end, opening up
    cz = AXZ + WIRE
    prof = [(0.0, cz - 0.001, IGN), (CUP_R - 0.002, cz - 0.001, IGN), (CUP_R, cz + 0.002, IGN),
            (CUP_R, cz + CUP_H, IGN), (CUP_R - 0.0018, cz + CUP_H, IGN), (CUP_R - 0.0018, cz + 0.0025, IGN),
            (0.0, cz + 0.0025, IGN)]
    if lod >= 3:
        prof = [(0.0, cz - 0.001, IGN), (CUP_R, cz - 0.001, IGN), (CUP_R, cz + CUP_H, IGN), (0.0, cz + CUP_H, IGN)]
    k.lathe(prof, seg(24, q, 6), kit.at(CUP_X, 0, 0))


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    board = Kit()
    board.rbox((0.20, 0.10, BZ1 - BZ0), (0, 0, (BZ0 + BZ1) / 2), 0.004 if lod < 3 else 0.0, OAK, cseg=cs,
               rz=0.002 if lod < 3 else 0.0)
    for x in (-0.09, 0.09):
        for y in (-0.04, 0.04):
            if lod < 3:
                board.cyl(0.006, 0.0, BZ0 + 0.0005, RUBBER, seg(12, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1,
                          bev_bot=0.0, m=kit.at(x, y, 0))
    if lod < 3:  # axle staples
        for sy in (-0.046, 0.046):
            board.sweep([(-0.004, sy, BZ1 - 0.001), (-0.004, sy, AXZ + 0.003), (0.004, sy, AXZ + 0.003),
                         (0.004, sy, BZ1 - 0.001)], 0.0011, 4, CHROME)
        board.cyl(0.0012, -0.05, 0.05, CHROME, 6, m=kit.at(0, 0, AXZ) @ kit.frame(axis='y'))
    springs = Kit()
    for sy in (-SPR_Y, SPR_Y):
        spring(springs, sy, lod, q)
    if lod < 2:
        def unwind(co):  # each coil turns up to 50° about the axle across its length (legs, off the coil, stay)
            rel = Vector((co.x, 0.0, co.z - AXZ))
            if rel.length > SPR_R + 0.0004:
                return co
            s = max(0.0, min(1.0, (abs(co.y) - (SPR_Y - 0.006)) / 0.012))
            r = Matrix.Rotation(math.radians(50.0 * s), 3, 'Y') @ rel
            return Vector((r.x, co.y, r.z + AXZ))
        springs.shape_keys['sk_wind'] = (unwind, '1 = wound (armed); 0 = sprung, each coil unwinds up to 50° about '
                                                 'the axle', 1.0)
    snap = Kit(pivot='PIVOT__bar')
    bar(snap, lod, q)
    latch = Kit(pivot='PIVOT__latch')
    if lod < 3:
        latch.sweep([LATCH, (0.0, 0.0, AXZ + WIRE + 0.0012), (-0.05, 0.0, AXZ + WIRE + 0.0012),
                     (-0.054, 0.0, AXZ + WIRE - 0.001)], 0.0009, 4, CHROME)
        latch.cyl(0.0022, -0.003, 0.003, CHROME, 8, m=kit.at(*LATCH) @ kit.frame(axis='y'))
    pedal = Kit(pivot='PIVOT__pedal')
    pedal.rbox((0.030, 0.050, 0.003), (PEDAL[0] + 0.015, 0, PEDAL[2]), 0.004 if lod < 3 else 0.0, IGN,
               cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.001 if lod < 3 else 0.0)
    if lod < 2:  # grip dots
        for i in range(3):
            for j in range(4):
                pedal.sphere(0.0016, IGN, 8, 3, m=kit.at(PEDAL[0] + 0.007 + 0.008 * i, -0.018 + 0.012 * j,
                                                          PEDAL[2] + 0.0014), sz_bot=0.1, sz_top=0.5)
    pieces = {'board': board, 'springs': springs, 'bar': snap, 'latch': latch, 'pedal': pedal}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.snaptrap.graphite', (0.10, 0, 0.009), (1, 0, 0), (0, 0, 1), 0.05, 0.0075),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '2,0.5,1', 0.15, 'bottom', 3500,
        'Fling trap (no bait, no mouse imagery): kn_wood_oak board on rubber corner pads; kn_chrome Ø 4 mm U-loop snap '
        'bar on PIVOT__bar (y at (0, 0, 0.022), armed 0° on -X ... 175° sprung) with the kn_powder_ignition payload cup '
        'at x -0.08; chrome torsion springs at y ±0.035 with sk_wind (1 = wound, default); chrome staples + axle; '
        'latch wire on PIVOT__latch (y, 0 ... 35°); Ignition pedal (grip dots) on PIVOT__pedal (y, -6 ... 0). The bar '
        'clears the pedal when sprung. Name plate (graphite on bone) on the +X board end. UV1 authored for the 2048² '
        'oak set (bake pending). Brief: docs/art/briefs/contraptions.md#snaptrap.',
        MASTERS, skins='classic')
    part.pivot('bar', (0, 0, AXZ), 'y', 0.0, 175.0, motion='turn')
    part.pivot('latch', LATCH, 'y', 0.0, 35.0, motion='turn')
    part.pivot('pedal', PEDAL, 'y', -6.0, 0.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('board', (0.20, 0.10, 0.012), (0, 0, 0.009), phys='wood', restitution=0.2, friction=0.6)
    _m2.under(part, part.col_box('pedal', (0.030, 0.050, 0.0055), (PEDAL[0] + 0.015, 0, PEDAL[2]), phys='powder'),
              'pedal')
    pts = [(x, y, z) for x in (0.0, -BAR_L) for y in (-BAR_W / 2 - WIRE, BAR_W / 2 + WIRE) for z in
           (AXZ - WIRE, AXZ + WIRE)]
    pts += [(CUP_X + CUP_R * math.cos(2 * math.pi * i / 8), CUP_R * math.sin(2 * math.pi * i / 8), z)
            for i in range(8) for z in (AXZ, AXZ + WIRE + CUP_H)]
    _m2.under(part, part.col_hull('bar', pts, phys='steel', restitution=0.3, friction=0.4), 'bar')
    _m2.under(part, part.sensor('trigger', 'pedal', [(PEDAL[0] + 0.015 + x * 0.0175, y * 0.0275, z)
                                                    for x in (-1, 1) for y in (-1, 1)
                                                    for z in (PEDAL[2], PEDAL[2] + 0.02)],
                                threshold=0.03, impulse=0.03), 'pedal')
    part.emit('snap', 'bar', (0, 0, 0.03), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
