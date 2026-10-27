"""Procedurally build the CELL source file (docs/art/briefs/power_signal.md, "CELL: Battery").

Usage: blender -b --factory-startup -P tools/blender/make_cell.py -- [out.blend]
Default output: assets/src/power/cell.blend

A chunky rounded-square battery filling 1x2x1: a pillowed graphite body (0.09 x 0.09 x 0.17, 8 mm bevel) on a
rubber foot ring (FOOT_RING, 4 wide x 3 high), a Volt anodised positive cap (Ø 0.06 x 0.014) with a brushed
steel nub (Ø 0.02) to z 0.198. Front (-Y): a 1 mm graphite port land carrying PORT__power__out (PR-S) at
z 0.152, and SCREEN__charge, a SCR_BAR_5 quad (0.030 x 0.014) rotated 90° to a vertical meter that fills
bottom -> top, in a 2 mm graphite bezel (pocket 1.5 mm, kn_glass cover) so the quad sits at y -0.0455.
Decals: "+" (graphite ink) on the cap, "-" (bone ink) on the base front, name plate on the back.
No discrete LEDs (led_groups "").
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'cell'
BODY_W, BODY_H, BEV = 0.09, 0.17, 0.008
FOOT_H = 0.003
Z0, Z1 = FOOT_H, FOOT_H + BODY_H            # body 0.003 .. 0.173
FACE_Y = -BODY_W / 2
CAP_R, CAP_Z0, CAP_Z1 = 0.03, Z1 - 0.0005, Z1 + 0.0145   # Volt cap, 14 mm proud of the body top
NUB_R, NUB_TOP = 0.01, 0.198
PORT = (0.0, -0.046, 0.152)
SCR_W, SCR_H = 0.030, 0.014                 # SCR_BAR_5, rotated: w runs up the meter
SCR_N, SCR_UP = (0.0, -1.0, 0.0), (-1.0, 0.0, 0.0)  # image right (bar fill) = +Z
SCR_C = (0.0, FACE_Y, 0.110)
SCR_DEPTH = 0.002                           # bezel proud of the face: quad lands at y -0.0455
G, VOLT, STEEL, RUBBER, GLASS, SCREEN = (
    'kn_powder_graphite', 'kn_anod_volt', 'kn_steel_brushed', 'kn_rubber', 'kn_glass', 'kn_screen')
MASTERS = [G, VOLT, STEEL, RUBBER, GLASS, SCREEN, 'kn_decal']


def build(lod, q, mats):
    body = Kit()
    cs = max(1, min((4, 3, 2, 1)[lod], int(round(4 * q))))
    if lod < 3:
        body.rbox((BODY_W, BODY_W, BODY_H), (0, 0, (Z0 + Z1) / 2), BEV, G, cseg=cs)
    else:
        body.rbox((BODY_W, BODY_W, BODY_H), (0, 0, (Z0 + Z1) / 2), 0.0, G, cseg=0, rz=0.0)
    # Port boss (� 35 mm): 1 mm proud of the front so the PR-S collar's centre plane sits on a flat face (y -0.046).
    if lod < 3:
        body.cyl(0.0175, -0.006, 0.0, G, seg(32, q, 8), bev=0.001 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame(PORT, '-y'))
    # Volt cap + steel nub
    n = seg(40, q, 8)
    body.cyl(CAP_R, CAP_Z0, CAP_Z1, VOLT, n, bev=(0.002, 0.0015, 0.001, 0.0)[lod], bseg=(2, 1, 1, 1)[lod])
    body.cyl(NUB_R, CAP_Z1 - 0.0005, NUB_TOP, STEEL, seg(24, q, 6), bev=(0.002, 0.0015, 0.0, 0.0)[lod],
             bseg=(2, 1, 1, 1)[lod], bev_bot=0.0)
    if lod < 3:  # FOOT_RING: 4 wide x 3 high skirt under the body
        prof = [(0.030, FOOT_H + 0.0006), (0.030, 0.0008), (0.0308, 0.0), (0.0332, 0.0), (0.034, 0.0008),
                (0.034, FOOT_H + 0.0006)]
        if lod == 2:
            prof = [(0.030, FOOT_H + 0.0006), (0.030, 0.0), (0.034, 0.0), (0.034, FOOT_H + 0.0006)]
        body.lathe([(r, z, RUBBER) for r, z in prof], seg(36, q, 8), closed=True)
    # Charge screen: SCR_BAR_5 turned vertical
    if lod < 3:
        c = _m2.screen_bezel(body, mats, SCR_W, SCR_H, SCR_C, SCR_N, SCR_UP, lod, q, depth=SCR_DEPTH)
    else:
        body.rbox((SCR_H + 0.008, 0.0014, SCR_W + 0.008), (0, FACE_Y + 0.0003, SCR_C[2]), 0.0, G, cseg=0, rz=0.0)
        c = tuple(Vector(SCR_C) + Vector(SCR_N) * (SCR_DEPTH - 0.0015))
    pieces = {'body': body, 'screen': kit.screen_quad(c, SCR_N, SCR_UP, SCR_W, SCR_H, lift=0.0002)}
    # "+" on the cap (graphite ink on Volt), "-" on the base front and the name plate on the back (bone ink).
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('num.plus.sans.graphite', (0, -0.0195, CAP_Z1), (0, 0, 1), (0, 1, 0), 0.022),
        kit.decal_plane('num.minus.sans.bone', (0, FACE_Y, 0.052), (0, -1, 0), (0, 0, 1), 0.022),
        kit.decal_plane('name.cell.bone', (0, -FACE_Y, 0.110), (0, 1, 0), (0, 0, 1), 0.05),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,2,1', 0.6, 'bottom', 1800,
        'Battery: pillowed graphite body (0.09 x 0.09 x 0.17, 8 mm) on a rubber foot ring, Volt anodised cap and '
        'steel nub to z 0.198, PR-S power out on a 1 mm front land. SCREEN__charge = SCR_BAR_5 turned vertical '
        '(fills bottom -> top) in a 2 mm graphite bezel under glass, quad at y -0.0455. Decals: "+" on the cap, '
        '"-" on the base front, name plate on the back. Brief: docs/art/briefs/power_signal.md#cell. '
        'Deviations: bezel depth 2 mm (not the kit 6 mm) so the quad sits at the brief y; port on a Ø 35 mm boss 1 mm proud '
        'so the ring plane is the brief y -0.046.',
        MASTERS, led_groups='')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('body', (BODY_W, BODY_W, Z1), (0, 0, Z1 / 2), phys='powder', restitution=0.25, friction=0.5,
                 convex_radius=0.008)
    part.col_cyl('cap', CAP_R, NUB_TOP - Z1, (0, 0, (Z1 + NUB_TOP) / 2), 'z', phys='powder', restitution=0.25,
                 friction=0.5)
    part.port('power', 'out', PORT, (0, -1, 0), 'S', 'out', max_links=4)
    c = Vector(SCR_C) + Vector(SCR_N) * (SCR_DEPTH - 0.0015 + 0.0002)
    part.screen('charge', SCR_W, SCR_H, tuple(c), SCR_N, SCR_UP, kind='bar', cells=5, color='power')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
