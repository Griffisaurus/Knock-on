"""Procedurally build the HAMSTER DRIVE source file (docs/art/briefs/drive.md, "HAMSTER DRIVE: Pip's wheel motor").

Usage: blender -b --factory-startup -P tools/blender/make_hamster_drive.py -- [out.blend]
Default output: assets/src/drive/hamster_drive.blend

Pip's home and job, device only (Pip is in critters.md). A graphite plinth (0.30 x 0.20 x 0.02 on two FOOT_BAR
strips) with a back pillar at y 0.075 carrying an open-fronted running wheel cantilevered on a steel axle stub
that ends at the back disc (no through-axle). PIVOT__wheel (axis y, (0, 0.005, 0.162)) carries the Ignition
back disc (Ø 0.25), the Ignition front rim (a ring only: nothing in front of Pip) and 24 Ø 3 mm steel rungs
whose inner tangent is the Ø 0.24 running surface. A gearbox pod (x 0.10...0.15, y 0.058...0.110, z
0.036...0.094) stands on a pedestal at the right rear: graphite land plate for the PR-M spin port (+X) and back
plate, a kn_poly_clear cover over two brass gears on PIVOT__gear_a / PIVOT__gear_b (axis y). 6 LED_D6 dots on
the plinth front lip (led group 0 run_timer). Device RIG: root, socket_pip (wheel bottom, +X forward) and
socket_pip_exit. Name plate on the pillar (+X side, reading upward), critter-friendly pictogram on the plinth lip.
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

TYPE = 'hamster_drive'
AXLE = Vector((0.0, 0.005, 0.162))
WHEEL_R, RUN_R, RUNG_r = 0.125, 0.120, 0.0015
WHEEL_Y0, WHEEL_Y1 = -0.045, 0.055        # wheel spans 0.10 along Y, centred on the axle
DISC_T = 0.008                             # back disc y 0.047...0.055
RIM_W = 0.008                              # front rim y -0.045...-0.037
FEET = 0.004
PLINTH = (0.30, 0.20, 0.02)                # z 0.004...0.024
PL_Z1 = FEET + PLINTH[2]
PILLAR = (0.05, 0.03)                      # x, y size; centre y 0.075
PILLAR_Y, PILLAR_TOP = 0.075, 0.192
POD = ((0.10, 0.15), (0.058, 0.110), (0.036, 0.094))
PORT = (0.151, 0.084, 0.065)
LAND_X0 = 0.142                            # graphite land plate x 0.142...0.150 (52 x 58 mm)
GEAR_M, GEAR_T, GEAR_Y = 0.0022, 0.006, 0.072
GEAR_A = Vector((0.119, GEAR_Y, 0.0755))   # 14 T, pitch r 0.0154
GEAR_B_T, GEAR_A_T = 9, 14
LEDS = [(-0.05 + 0.02 * i, -PLINTH[1] / 2, FEET + PLINTH[2] / 2) for i in range(6)]
G, IGN, STEEL, BRASS, POLY, RUBBER, LED = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed', 'kn_brass', 'kn_poly_clear', 'kn_rubber',
    'kn_led')
MASTERS = [G, IGN, STEEL, BRASS, POLY, RUBBER, LED, 'kn_decal']
WAXIS = kit.at(AXLE.x, 0, AXLE.z) @ kit.Y_AXIS   # local z = +Y, local (x, y) = Blender (z, x)


def gear_b_centre():
    ra, rb = GEAR_M * GEAR_A_T / 2, GEAR_M * GEAR_B_T / 2
    a = math.radians(-66)
    return Vector((GEAR_A.x + (ra + rb) * math.cos(a), GEAR_Y, GEAR_A.z + (ra + rb) * math.sin(a)))


def spur_outline(teeth, pitch_r, lod):
    """Look-dev tooth profile (cog brief): root 0-15 %, flank to 28 %, tip 28-47 %, flank to 60 %, root."""
    rr, rt = pitch_r - 1.25 * GEAR_M, pitch_r + GEAR_M
    if lod >= 2:
        return kit.outline_circle(pitch_r, max(8, teeth))
    pts = []
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        for f, r in ((0.0, rr), (0.15, rr), (0.28, rt), (0.47, rt), (0.60, rr)):
            aa = a + 2 * math.pi / teeth * f
            pts.append((r * math.cos(aa), r * math.sin(aa)))
    return pts


def spur(k, centre, teeth, q, lod):
    pr = GEAR_M * teeth / 2
    m = kit.at(centre.x, 0, centre.z) @ kit.Y_AXIS
    y0, y1 = centre.y - GEAR_T / 2, centre.y + GEAR_T / 2
    k.prism(spur_outline(teeth, pr, lod), y0, y1, BRASS, bt=0.0005 if lod == 0 else 0.0,
            bb=0.0005 if lod == 0 else 0.0, bseg=1, m=m)
    if lod < 3:  # steel hub
        k.cyl(0.0045, y0 - 0.0015, y1 + 0.0015, STEEL, seg(16, q, 6), bev=0.0006 if lod == 0 else 0.0, bseg=1, m=m)
    if lod < 2 and teeth > 10:  # lightening holes read as dark dimples: steel bosses instead (no booleans)
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            c = (centre.x + 0.0085 * math.cos(a), centre.z + 0.0085 * math.sin(a))
            k.cyl(0.002, y0 - 0.0004, y0 + 0.0006, STEEL, seg(8, q, 6), m=kit.at(c[0], 0, c[1]) @ kit.Y_AXIS)


def led_group(c, n):
    return (0, 0.08)


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.colors['led'] = _m2.led_attr(led_group)
    # plinth on two FOOT_BAR strips
    body.rbox(PLINTH, (0, 0, FEET + PLINTH[2] / 2), 0.008 if lod < 3 else 0.004, G, cseg=cs,
              rz=(0.004, 0.004, 0.003, 0.0)[lod])
    for y in (-0.065, 0.065):
        _m2.foot_bar(body, 0.26, 0.0, y, q, lod, h=FEET)
    # back pillar and the static axle boss (the wheel's axle stub ends at the back disc)
    body.rbox((PILLAR[0], PILLAR[1], PILLAR_TOP - PL_Z1 + 0.004), (0, PILLAR_Y, (PILLAR_TOP + PL_Z1 - 0.004) / 2),
              0.008 if lod < 3 else 0.004, G, cseg=cs, rz=(0.008, 0.006, 0.004, 0.0)[lod])
    if lod < 3:
        body.cyl(0.020, PILLAR_Y - PILLAR[1] / 2 - 0.004, PILLAR_Y - PILLAR[1] / 2 + 0.002, STEEL, seg(32, q, 8),
                 bev=(0.0015, 0.001, 0.0, 0.0)[lod], bseg=1, m=WAXIS)
    if lod < 2:  # M5 heads: pillar back (4) and plinth top (3; the pod pedestal takes the 4th corner)
        for x in (-0.013, 0.013):
            for z in (0.045, 0.170):
                _m2.screw(body, 'M5', (x, PILLAR_Y + PILLAR[1] / 2, z), (0, 1, 0), q, lod)
        for x, y in ((-0.13, -0.08), (0.13, -0.08), (-0.13, 0.08)):
            _m2.screw(body, 'M5', (x, y, PL_Z1), (0, 0, 1), q, lod)
    # LED dots on the plinth front lip (group 0 run_timer)
    for c in LEDS:
        _m2.led_dome(body, 6, c, (0, -1, 0), q, lod)
    # gearbox pod: pedestal, graphite land plate (+X, PR-M ring) and back plate, clear cover
    (x0, x1), (y0, y1), (z0, z1) = POD
    body.rbox((0.04, 0.036, z0 - PL_Z1 + 0.006), (0.125, 0.080, (z0 + PL_Z1) / 2), 0.004, G,
              cseg=max(1, cs - 1), rz=0.0)
    body.rbox((x1 - LAND_X0, y1 - y0, z1 - z0), ((LAND_X0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 0.003, G,
              cseg=max(1, cs - 1), rz=0.003 if lod < 3 else 0.0)
    body.rbox((LAND_X0 - x0 + 0.002, 0.010, z1 - z0), ((x0 + LAND_X0 + 0.002) / 2, y1 - 0.005, (z0 + z1) / 2),
              0.003, G, cseg=max(1, cs - 1), rz=0.003 if lod < 3 else 0.0)
    body.rbox((LAND_X0 - x0 + 0.002, 0.006 + (y1 - 0.010 - y0), 0.004), ((x0 + LAND_X0 + 0.002) / 2,
              (y0 + y1 - 0.010) / 2 + 0.003, z0 + 0.002), 0.003, G, cseg=max(1, cs - 1), rz=0.0)
    if lod < 3:
        body.rbox((LAND_X0 - x0 + 0.001, y1 - 0.010 - y0 + 0.001, z1 - z0 - 0.004),
                  ((x0 + LAND_X0) / 2, (y0 + y1 - 0.010) / 2, (z0 + z1) / 2 + 0.002), 0.006, POLY,
                  cseg=max(1, cs - 1), rz=0.005 if lod < 2 else 0.0)
    else:  # LOD3: cover opaque, gears dropped
        body.rbox((LAND_X0 - x0, y1 - 0.010 - y0, z1 - z0 - 0.004),
                  ((x0 + LAND_X0) / 2, (y0 + y1 - 0.010) / 2, (z0 + z1) / 2 + 0.002), 0.0, BRASS, cseg=0)
    if lod < 2:  # steel gear pins from the back plate
        for c in (GEAR_A, gear_b_centre()):
            body.cyl(0.0018, GEAR_Y, y1 - 0.009, STEEL, seg(8, q, 6), m=kit.at(c.x, 0, c.z) @ kit.Y_AXIS)

    # wheel: back disc + front rim (Ignition), 24 rungs, steel hub on the disc back
    wheel = Kit(pivot='PIVOT__wheel')
    n = seg(96, q, 16)
    db = (0.003, 0.0025, 0.0015, 0.0)[lod]
    wheel.cyl(WHEEL_R, WHEEL_Y1 - DISC_T, WHEEL_Y1, IGN, n, bev=db, bseg=cs, m=WAXIS)
    rim = [(RUN_R - 0.002, WHEEL_Y0 + 0.002), (RUN_R, WHEEL_Y0), (WHEEL_R - db, WHEEL_Y0),
           (WHEEL_R, WHEEL_Y0 + db), (WHEEL_R, WHEEL_Y0 + RIM_W - db), (WHEEL_R - db, WHEEL_Y0 + RIM_W),
           (RUN_R, WHEEL_Y0 + RIM_W), (RUN_R - 0.002, WHEEL_Y0 + RIM_W - 0.002)]
    wheel.lathe(kit.dedupe([(r, h, IGN) for r, h in rim]), n, WAXIS, closed=True)
    if lod < 3:
        rr = RUN_R + RUNG_r
        sides = (8, 6, 4, 4)[lod]
        nr = 24 if lod < 2 else 12
        for i in range(nr):
            a = 2 * math.pi * i / nr
            x, z = AXLE.x + rr * math.cos(a), AXLE.z + rr * math.sin(a)
            wheel.cyl(RUNG_r, WHEEL_Y0 + 0.004, WHEEL_Y1 - DISC_T + 0.001, STEEL, sides, m=kit.at(x, 0, z) @ kit.Y_AXIS)
        wheel.cyl(0.016, WHEEL_Y1 - 0.001, PILLAR_Y - PILLAR[1] / 2 - 0.004, STEEL, seg(32, q, 8),
                  bev=0.001 if lod < 2 else 0.0, bseg=1, m=WAXIS)
    if lod < 2:  # moulded stiffening bead on the disc front
        wheel.torus(0.092, 0.0022, IGN, n, (8, 5)[lod], m=kit.at(AXLE.x, WHEEL_Y1 - DISC_T, AXLE.z) @ kit.Y_AXIS)
    if lod < 2:  # a ring of 6 bolt heads round the hub on the disc front (inside Pip's space they stay flush)
        for i in range(6):
            a = 2 * math.pi * i / 6
            x, z = AXLE.x + 0.026 * math.cos(a), AXLE.z + 0.026 * math.sin(a)
            _m2.screw(wheel, 'M5', (x, WHEEL_Y1 - DISC_T, z), (0, -1, 0), q, lod)

    gear_a = Kit(pivot='PIVOT__gear_a')
    gear_b = Kit(pivot='PIVOT__gear_b')
    if lod < 3:
        spur(gear_a, GEAR_A, GEAR_A_T, q, lod)
        spur(gear_b, gear_b_centre(), GEAR_B_T, q, lod)
    pieces = {'body': body, 'wheel': wheel, 'gear_a': gear_a, 'gear_b': gear_b}
    decals = [
        # pillar +X side, reading upward (bone ink on graphite)
        kit.decal_plane('name.hamster_drive.bone', (PILLAR[0] / 2, PILLAR_Y, 0.110), (1, 0, 0), (0, -1, 0), 0.06),
        kit.decal_plane('picto.critter_friendly.mono', (0.095, -PLINTH[1] / 2, FEET + PLINTH[2] / 2), (0, -1, 0),
                        (0, 0, 1), 0.012, 0.012),
    ]
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'L', '3,3,2', 3.2, 'bottom', 16000,
        "Pip's wheel motor, device only. Brief: docs/art/briefs/drive.md#hamster-drive. Open-fronted wheel on "
        'PIVOT__wheel (y): Ignition back disc + front rim ring, 24 steel rungs on the Ø 0.24 running surface, axle '
        'stub ends at the back disc. Gearbox pod (x 0.10-0.15, y 0.058-0.110) with a clear cover over brass '
        'PIVOT__gear_a / gear_b (y); PR-M spin out on its graphite +X land. 6 LED_D6 run_timer dots on the plinth '
        'lip. RIG: root, socket_pip (wheel bottom, +X), socket_pip_exit. Name plate on the pillar +X side (reads '
        'upward; the pillar front is behind the back disc), critter-friendly mono pictogram on the plinth lip. '
        'Plinth on 4 mm FOOT_BAR strips so its top is z 0.024 (socket_pip_exit). LOD3 cover opaque brass block.',
        MASTERS, led_groups='0:run_timer')
    part.pivot('wheel', tuple(AXLE), 'y')
    part.pivot('gear_a', tuple(GEAR_A), 'y')
    part.pivot('gear_b', tuple(gear_b_centre()), 'y')
    part.build_lods(build, lod0_q=2.2)
    (x0, x1), (y0, y1), (z0, z1) = POD
    part.col_box('base', PLINTH, (0, 0, FEET + PLINTH[2] / 2), phys='powder', restitution=0.2, friction=0.6)
    part.col_box('pillar', (PILLAR[0], PILLAR[1], PILLAR_TOP - PL_Z1), (0, PILLAR_Y, (PILLAR_TOP + PL_Z1) / 2),
                 phys='powder')
    ob = part.col_cyl('wheel', WHEEL_R, WHEEL_Y1 - WHEEL_Y0, tuple(AXLE), 'y', phys='steel', restitution=0.2,
                      friction=0.6)
    ob['pivot'] = 'PIVOT__wheel'
    part.col_box('gearbox', (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
                 phys='powder')
    part.port('spin', 'out', PORT, (1, 0, 0), 'M', 'out', kind='axle')
    pts = [(x, y, z) for x in (-0.155, 0.155) for y in (-0.106, 0.115) for z in (0.0, 0.292)]
    part.sensor('trigger', 'bump', pts, threshold=0.05, cooldown=0.5)
    part.emit('emote', 'wheel', (0.0, 0.0, 0.32), (0, 0, 1))
    _m2.socket_rig(part, [
        ('root', (0, 0, 0), (0, 0, 1), None, None),
        ('socket_pip', (0.0, 0.005, 0.042), (1, 0, 0), 'root', None),
        ('socket_pip_exit', (-0.10, -0.08, 0.024), (1, 0, 0), 'root', None),
    ])
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
