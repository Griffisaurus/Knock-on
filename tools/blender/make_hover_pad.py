"""Procedurally build the HOVER PAD source file (docs/art/briefs/future.md, "HOVER PAD: Field-levitated platform").

Usage: blender -b --factory-startup -P tools/blender/make_hover_pad.py -- [out.blend]
Default output: assets/src/future/hover_pad.blend

A thin kn_powder_graphite slab (0.30 x 0.30 x 0.040, z 0.006-0.046, 10 mm pillow) with a kn_rubber_grip top inlay
(0.26 x 0.26, inset 20 mm, 2 mm chamfer, top at z 0.050) framed by a kn_anod_plasma trim, standing on four
kn_anod_plasma thruster discs (Ø 0.070 x 0.006 at (±0.09, ±0.09), z 0-0.006; origin = their bottom centre), each with
a kn_led ring (group 1 thrusters) round a dark kn_anod_graphite centre grille. A 4 mm kn_led edge strip (group 0) runs
round the slab edge at z 0.020, broken round the PR-S power port (0.100, -0.150, 0.026) and the SCREEN__load bar
(6 cells, plasma, at (-0.080, -0.151, 0.026)). The underside is the hero view: a graphite service plate with 4 M5
screws, the name plate and cable ribs between the thrusters. No flames or exhaust: it's a field, not a rocket.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m5  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'hover_pad'
G, PLASMA, AGRAPH, GRIP, LED, SCREEN, STEEL, GLASS = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_anod_graphite', 'kn_rubber_grip', 'kn_led', 'kn_screen',
    'kn_steel_brushed', 'kn_glass')
MASTERS = [G, PLASMA, AGRAPH, GRIP, LED, SCREEN, STEEL, GLASS, 'kn_decal']
W, SL_Z0, SL_Z1 = 0.30, 0.006, 0.046
GRIP_W, GRIP_Z1 = 0.26, 0.050
DISC = 0.09
PORT = (0.100, -0.150, 0.026)
SCR_C, SCR_W, SCR_H = Vector((-0.080, -0.151, 0.026)), 0.060, 0.010
STRIP_Z = 0.020


def thruster(k, x, y, lod, q):
    n = seg(40, q, 8, 4)
    if lod >= 3:
        k.cyl(0.035, 0.0, SL_Z0 + 0.0004, PLASMA, n, cap=AGRAPH, cap_bot=AGRAPH)
        k.cyl(0.024, -0.0004, 0.001, LED, n)
        return
    prof = [(0.0, 0.0016, AGRAPH)]
    if lod < 2:  # concentric grille ridges
        for i, r in enumerate((0.004, 0.008, 0.012, 0.016)):
            zz = 0.0016 if i % 2 == 0 else 0.0011
            prof += [(r, prof[-1][1], AGRAPH), (r, zz, AGRAPH)]
    prof += [(0.020, prof[-1][1], LED), (0.020, 0.0006, LED), (0.026, 0.0006, PLASMA), (0.026, 0.0, PLASMA)]
    bev = 0.002 if lod < 2 else 0.0
    if bev:
        prof.append((0.035 - bev, 0.0, PLASMA))
        for kk in range(1, 3):
            a = math.pi / 2 * kk / 2
            prof.append((0.035 - bev + bev * math.sin(a), bev - bev * math.cos(a), PLASMA))
    else:
        prof.append((0.035, 0.0, PLASMA))
    prof += [(0.035, SL_Z0 + 0.0004, PLASMA), (0.0, SL_Z0 + 0.0004, PLASMA)]
    k.lathe(kit.dedupe(prof), n, kit.at(x, y, 0))


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    body = Kit()
    body.rbox((W, W, SL_Z1 - SL_Z0), (0, 0, (SL_Z0 + SL_Z1) / 2), 0.010 if lod < 3 else 0.0, G, cseg=max(1, cs),
              rz=0.006 if lod < 3 else 0.0)
    # grip inlay with a chamfered top edge, framed by the plasma trim
    body.prism(kit.outline_rrect(GRIP_W, GRIP_W, 0.012, max(1, cs)), SL_Z1 - 0.002, GRIP_Z1, GRIP,
               bt=0.002 if lod < 2 else 0.0, bseg=1)
    if lod < 3:
        trim = kit.outline_rrect(GRIP_W, GRIP_W, 0.012, max(1, cs))
        body.ring_sweep(trim, [(0.0, SL_Z1 - 0.002), (0.004, SL_Z1 - 0.002), (0.004, SL_Z1 + 0.0015),
                               (0.0, SL_Z1 + 0.0015)], PLASMA)
    for sx in (-1, 1):
        for sy in (-1, 1):
            thruster(body, sx * DISC, sy * DISC, lod, q)
    # underside service plate, screws and cable ribs between the thrusters
    if lod < 3:
        body.rbox((0.12, 0.12, 0.003), (0, 0, SL_Z0 - 0.0010), 0.008, G, cseg=max(1, cs), rz=0.001 if lod < 2 else 0.0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                _m2.screw(body, 'M5', (sx * 0.048, sy * 0.048, SL_Z0 - 0.0025), (0, 0, -1), q, lod)
                if lod < 2:  # a cable rib from the plate to each thruster
                    body.rbox((0.030, 0.008, 0.002), (0, 0, SL_Z0 - 0.0006), 0.003, AGRAPH, cseg=1, rz=0.0006,
                              m=kit.at(sx * 0.074, sy * 0.074, 0) @ kit.rot_z(45 * sx * sy))
    # LED edge strip, broken round the port and the load screen
    sides = (8, 6, 4, 3)[lod]
    cseg_p = (4, 3, 2, 1)[lod]
    grow = -0.0011
    _m5.strip(body, _m5.rrect_path(W, W, 0.010, cseg_p, 0.125, -0.125, STRIP_Z, grow=grow), 0.002, sides)
    _m5.strip(body, [(-0.040, -W / 2 - grow, STRIP_Z), (0.078, -W / 2 - grow, STRIP_Z)], 0.002, sides)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (1, 0.0) if c.z < 0.004 else (0, 0.0))
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    depth = 0.0025
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C - n * (depth - 0.0015)), tuple(n),
                                     tuple(up), lod, q, depth=depth))
    else:
        sc = SCR_C
    pieces = {'body': body,
              'screen_load': kit.screen_quad(tuple(sc), tuple(n), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.hover_pad.bone', (0, -0.012, SL_Z0 - 0.0025), (0, 0, -1), (0, -1, 0), 0.085),
        kit.decal_plane('trim.marks_m5', (0, 0.026, SL_Z0 - 0.0025), (0, 0, -1), (0, -1, 0), 0.022, 0.021,
                        sub=_m5.marks5('hex')),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '3,0.5,3', 2.5, 'bottom', 4500,
        'Field-levitated platform: kn_powder_graphite slab 0.30 x 0.30 x 0.040 (z 0.006-0.046, 10 mm pillow) with a '
        'kn_rubber_grip inlay (0.26 square, inset 20 mm, 2 mm chamfer, top z 0.050) in a kn_anod_plasma trim; four '
        'kn_anod_plasma thruster discs Ø 0.070 x 0.006 at (±0.09, ±0.09), z 0-0.006 (origin = their bottom centre), '
        'each a kn_led ring (group 1 thrusters) round a kn_anod_graphite grille. kn_led edge strip (group 0) at z 0.020, '
        'broken round the PR-S power port and SCREEN__load (bar x 6, plasma). Underside hero view: service plate, 4 M5, '
        'cable ribs, name plate, hex mark. Dynamic body: the def holds it 0.5 m above its base while powered. '
        'Brief: docs/art/briefs/future.md#hover-pad.',
        MASTERS, led_groups='0:edge_strip,1:thrusters', skins='graphite,lab_white',
        hints={'kn_payload_max': 10.0, 'kn_hover_height': 0.5})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('0', (W, W, SL_Z1 - SL_Z0), (0, 0, (SL_Z0 + SL_Z1) / 2), phys='powder', restitution=0.2, friction=0.5)
    part.col_box('1', (GRIP_W, GRIP_W, 0.0052), (0, 0, GRIP_Z1 - 0.0026), phys='rubber', restitution=0.1, friction=0.9)
    part.sensor('pressure', 'deck', [(x * GRIP_W / 2, y * GRIP_W / 2, z) for x in (-1, 1) for y in (-1, 1)
                                     for z in (0.050, 0.070)], threshold=0.05)
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    for name, sx, sy in (('fl', -1, -1), ('fr', 1, -1), ('bl', -1, 1), ('br', 1, 1)):
        part.emit('field', 'thruster_' + name, (sx * DISC, sy * DISC, 0.0), (0, 0, -1))
    part.emit('spark', 'edge', (0, -0.150, 0.026), (0, -1, 0))
    part.screen('load', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=6, color='plasma')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
