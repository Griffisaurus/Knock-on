"""Procedurally build the ARC TOWER source file (docs/art/briefs/power_signal.md, "ARC TOWER: Tesla coil").

Usage: blender -b --factory-startup -P tools/blender/make_arc_tower.py -- [out.blend]
Default output: assets/src/power/arc_tower.blend

A tabletop Tesla coil: a kn_powder_graphite plinth (0.2 x 0.2 x 0.095 on FOOT_M, 8 mm pillowed bevel, M8 screws on
the top corners, four kn_led charge bars along the top edges, status dome on the back corner) wrapped by the
Amber / Graphite hazard band (z 0.077-0.091) with the high-voltage pictogram and the PR-L power `in` ring on the
front flat; a flat kn_copper primary spiral (Ø 0.16, z 0.102) on graphite stand-offs; a kn_poly_clear tube
(Ø 0.07, z 0.104-0.39, 3 mm wall) over the copper secondary winding (ridged turns) with a kn_led glow ring at its
foot; a kn_steel_brushed toroid (R 0.07, r 0.03, outer Ø 0.20 at z 0.42: the widest element) on a steel hub, and a
kn_chrome breakout spike to z 0.50. No arcs in the mesh (VFX).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'arc_tower'
G, STEEL, COPPER, CLEAR, CHROME, RUBBER, LED = ('kn_powder_graphite', 'kn_steel_brushed', 'kn_copper',
                                               'kn_poly_clear', 'kn_chrome', 'kn_rubber', 'kn_led')
MASTERS = [G, STEEL, COPPER, CLEAR, CHROME, RUBBER, LED]
PL_W, PL_Z0, PL_Z1, PL_BEV = 0.20, 0.005, 0.100, 0.008
PRI_Z, PRI_R0, PRI_R1 = 0.1025, 0.044, 0.080
TUBE_R, TUBE_Z0, TUBE_Z1, TUBE_W = 0.035, 0.104, 0.39, 0.003
SEC_R = 0.026
TOR_Z, TOR_R, TOR_r = 0.42, 0.07, 0.03
SPIKE_TOP = 0.50
PORT = (0.0, -0.101, 0.045)
HV = (0.068, -0.1005, 0.045)


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    n = seg(64, q, 8, 4)
    body = Kit()
    body.rbox((PL_W, PL_W, PL_Z1 - PL_Z0), (0, 0, (PL_Z0 + PL_Z1) / 2), PL_BEV, G, cseg=cs,
              rz=PL_BEV if lod < 3 else 0.004)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.075, sy * 0.075, min(1.0, q), lod, top=0.0012)
            _m2.screw(body, 'M8', (sx * 0.084, sy * 0.084, PL_Z1), (0, 0, 1), q, lod)
    # charge bars: 4 kn_led strips along the top edges, inset from the bevel
    if lod < 3:
        for k in range(4):
            a = math.radians(90 * k)
            d = Vector((math.cos(a), math.sin(a), 0))
            c = d * (PL_W / 2 - 0.012) + Vector((0, 0, PL_Z1))
            body.rbox((0.004, 0.10, 0.0016), (0, 0, 0), 0.0, LED, cseg=1,
                      m=kit.at(*c) @ kit.rot_z(math.degrees(a)))
    _m2.led_dome(body, 6, (0.072, PL_W / 2, 0.06), (0, 1, 0), q, lod)
    _m2.land(body, 'L', PORT, (0, -1, 0), 0.001, lod, mat=G)
    # primary: flat copper spiral on 4 graphite stand-offs
    if lod < 3:
        turns, steps = 4.0, seg(28, q, 8) * 4
        pts = []
        for i in range(steps + 1):
            t = i / steps
            a = 2 * math.pi * turns * t
            r = PRI_R0 + (PRI_R1 - PRI_R0) * t
            pts.append((r * math.cos(a), r * math.sin(a), PRI_Z + 0.0025))
        body.sweep(pts, 0.0025, (8, 6, 4)[lod], COPPER)
        for k in range(4):
            a = math.radians(45 + 90 * k)
            body.cyl(0.005, PL_Z1 - 0.001, PRI_Z + 0.001, G, seg(10, q, 5),
                     m=kit.at(0.062 * math.cos(a), 0.062 * math.sin(a), 0))
    else:
        body.lathe([(PRI_R0 - 0.0025, PRI_Z, COPPER), (PRI_R1 + 0.0025, PRI_Z, COPPER),
                    (PRI_R1 + 0.0025, PRI_Z + 0.005, COPPER), (PRI_R0 - 0.0025, PRI_Z + 0.005, COPPER)], n, closed=True)
    # tube collar (graphite) + led glow ring at the foot
    body.lathe([(TUBE_R - 0.004, TUBE_Z0 - 0.004, G), (TUBE_R + 0.005, TUBE_Z0 - 0.004, G),
                (TUBE_R + 0.005, TUBE_Z0 + 0.008, G), (TUBE_R - 0.004, TUBE_Z0 + 0.008, G)], n, closed=True)
    if lod < 3:
        body.torus(TUBE_R + 0.0055, 0.0018, LED, n, (6, 4, 4)[lod], m=kit.at(0, 0, TUBE_Z0 + 0.0095))
    # secondary winding: copper core with ridged turns
    sec = [(0.0, TUBE_Z0, COPPER), (SEC_R - 0.002, TUBE_Z0, COPPER)]
    nt = (36, 18, 0, 0)[lod]
    if nt:
        for i in range(nt + 1):
            z = TUBE_Z0 + 0.012 + (TUBE_Z1 - 0.012 - TUBE_Z0 - 0.012) * i / nt
            sec += [(SEC_R, z - 0.0025, COPPER), (SEC_R + 0.0008, z, COPPER), (SEC_R, z + 0.0025, COPPER)]
    else:
        sec += [(SEC_R, TUBE_Z0 + 0.01, COPPER), (SEC_R, TUBE_Z1 - 0.01, COPPER)]
    sec += [(SEC_R - 0.002, TUBE_Z1 - 0.004, COPPER), (0.0, TUBE_Z1 - 0.004, COPPER)]
    body.lathe(kit.dedupe(sec), seg(32, q, 6, 2))
    # top cap, hub, toroid, spike
    body.cyl(TUBE_R + 0.004, TUBE_Z1 - 0.004, TUBE_Z1 + 0.006, STEEL, n, bev=0.002 if lod < 3 else 0.0, bseg=1)
    body.cyl(0.012, TUBE_Z1 + 0.005, TOR_Z, STEEL, seg(20, q, 6))
    body.cyl(0.044, TOR_Z - 0.012, TOR_Z + 0.012, STEEL, n, bev=0.004 if lod < 3 else 0.0, bseg=cs)
    body.torus(TOR_R, TOR_r, STEEL, seg(72, q, 10, 2), seg(28, q, 6, 2), m=kit.at(0, 0, TOR_Z))
    spike = [(0.0, TOR_Z + 0.010, CHROME), (0.006, TOR_Z + 0.010, CHROME), (0.006, TOR_Z + 0.022, CHROME),
             (0.0035, TOR_Z + 0.028, CHROME), (0.0012, SPIKE_TOP - 0.004, CHROME), (0.0, SPIKE_TOP, CHROME)]
    body.lathe(spike, seg(16, q, 6))
    body.colors['led'] = _m2.led_attr(
        lambda c, nn: (2, 0.08) if c.y > PL_W / 2 - 0.003 and c.z < 0.09 else ((0, 0.0) if c.z > PL_Z1 - 0.003 and
                                                                                c.z < PL_Z1 + 0.003 else (1, 0.0)))
    tube = Kit()
    if lod < 3:
        tube.lathe([(TUBE_R - TUBE_W, TUBE_Z0, CLEAR), (TUBE_R, TUBE_Z0, CLEAR), (TUBE_R, TUBE_Z1, CLEAR),
                    (TUBE_R - TUBE_W, TUBE_Z1, CLEAR)], n, closed=True)
    else:
        tube.cyl(TUBE_R, TUBE_Z0, TUBE_Z1, CLEAR, n)
    pieces = {'body': body, 'tube': tube}
    decals = []
    zb = (0.077 + 0.091) / 2
    for k, (nrm, up) in enumerate((((0, -1, 0), (0, 0, 1)), ((1, 0, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)),
                                   ((-1, 0, 0), (0, 0, 1)))):
        c = Vector(nrm) * (PL_W / 2) + Vector((0, 0, zb))
        decals.append(kit.decal_plane('trim.hazard_r', tuple(c), nrm, up, PL_W - 2 * PL_BEV - 0.002, 0.014,
                                      sub=(0.0, 0.0, 1.0, 1.0)))
    decals.append(kit.decal_plane('picto.high_voltage.warn', HV, (0, -1, 0), (0, 0, 1), 0.026, 0.026))
    decals.append(kit.decal_plane('name.arc_tower.bone', (-0.02, PL_W / 2, 0.045), (0, 1, 0), (0, 0, 1), 0.09))
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'L', '2,5,2', 6.0, 'bottom', 18000,
        'Tabletop Tesla coil: kn_powder_graphite plinth (0.2 x 0.2 x 0.095 on FOOT_M, 8 mm bevel, M8 screws) with the '
        'Amber / Graphite hazard band decal (z 0.077-0.091, clear above the port), high-voltage pictogram, PR-L power '
        '`in` on the front flat, four kn_led charge bars on the top edges (group 0), status dome on the back (group '
        '2); flat kn_copper primary spiral (Ø 0.16) on stand-offs; kn_poly_clear tube (Ø 0.07, z 0.104-0.39) over '
        'the '
        'ridged copper secondary, kn_led glow ring at its foot (group 1); kn_steel_brushed toroid (R 0.07, r 0.03, '
        'outer Ø 0.20, z 0.42) on a steel hub; kn_chrome breakout spike to z 0.50. Name plate on the back. Arc origin '
        'torus in hints kn_arc_torus_R / kn_arc_torus_r. Brief: docs/art/briefs/power_signal.md#arc-tower.',
        MASTERS, led_groups='0:charge,1:secondary_glow,2:status',
        hints={'kn_arc_torus_R': TOR_R, 'kn_arc_torus_r': TOR_r, 'kn_arc_range': 2.0, 'kn_power_w': 400.0})
    part.build_lods(build, lod0_q=1.2)
    part.col_box('plinth', (PL_W, PL_W, PL_Z1), (0, 0, PL_Z1 / 2), phys='powder', restitution=0.2, friction=0.6)
    part.col_cyl('tube', TUBE_R, TUBE_Z1 - TUBE_Z0, (0, 0, (TUBE_Z0 + TUBE_Z1) / 2), 'z', phys='glass')
    part.col_cyl('toroid', TOR_R + TOR_r, 2 * TOR_r, (0, 0, TOR_Z), 'z', phys='steel')
    part.col_capsule('spike', 0.006, SPIKE_TOP - TOR_Z - 0.02, (0, 0, (SPIKE_TOP + TOR_Z + 0.02) / 2), 'z',
                     phys='steel', sharp=True)
    part.sensor('field', 'range', _m4.sphere_points((0, 0, TOR_Z), 2.0, 6))
    part.port('power', 'in', PORT, (0, -1, 0), 'L', 'in')
    part.emit('arc', 'breakout', (0, 0, SPIKE_TOP), (0, 0, 1))
    part.emit('arc', 'toroid', (0, 0, TOR_Z), (0, 0, 1))
    part.emit('crackle', 'primary', (0, 0, 0.105), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
