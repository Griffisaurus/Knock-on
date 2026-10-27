"""Procedurally build the FLINGER source file (docs/art/briefs/contraptions.md, "FLINGER: Torsion catapult").

Usage: blender -b --factory-startup -P tools/blender/make_flinger.py -- [out.blend]
Default output: assets/src/contraptions/flinger.blend

A cream A-frame catapult (4 x 3 x 3 cocked, bottom origin, throws +X): two kn_powder_bone base rails (0.045 tall)
on FOOT_M bumpers under two 15 mm Bone A-frame side plates (y ±0.13, apex z 0.29) joined by a steel rear cross rod
and the brushed-steel axle at (0.04, y, 0.12) with M5 heads. A fat kn_chrome torsion spring (Ø 0.06) winds on the
axle (shape key `sk_wind`, 1 = wound). PIVOT__arm (axis y; theta from vertical, -105° cocked ... theta_stop;
modelled cocked) carries the kn_wood_oak arm (0.04 x 0.03) and the kn_powder_ignition cup (Ø 0.09, 0.035 deep) whose
centre sits 0.20 from the axle at (-0.153, 0, 0.068). PIVOT__stop (axis y, -70 ... -30°, modelled at -45°) carries
the padded stop bar riding the visible arc slots behind and above the axle. A chrome latch hook on PIVOT__latch
(axis y, 0 ... 30°) holds the cup. PR-M signal release and tension trigger (hook) rings on the front plate; ready
LED_D8 (group 0) at the front plate apex; name plate on the back plate.
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

TYPE = 'flinger'
AX = Vector((0.04, 0.0, 0.12))
COCK, STOP_REST = -105.0, -45.0
ARM_L, CUP_R, CUP_D = 0.20, 0.045, 0.035
PLATE_Y, PLATE_T = 0.13, 0.015
RAIL_H = 0.045
SLOT_R, SLOT_A0, SLOT_A1 = 0.12, 115.0, 165.0     # slot arc about the axle (deg from +X in the XZ plane)
LATCH = (-0.185, 0.0, 0.062)
G_OUT = [(-0.19, RAIL_H), (0.19, RAIL_H), (0.165, 0.085), (0.075, 0.255), (0.02, 0.29), (-0.035, 0.29),
         (-0.115, 0.215), (-0.17, 0.10)]
WINDOW = [(-0.135, 0.105), (0.15, 0.105), (0.066, 0.243), (0.02, 0.266), (-0.03, 0.266), (-0.098, 0.204),
          (-0.13, 0.13)]
BONE, RUBBER, STEEL, IGN, OAK, CHROME, LED = (
    'kn_powder_bone', 'kn_rubber', 'kn_steel_brushed', 'kn_powder_ignition', 'kn_wood_oak', 'kn_chrome', 'kn_led')
MASTERS = [BONE, RUBBER, STEEL, IGN, OAK, CHROME, LED, 'kn_decal']
YAX = kit.frame(axis='y')


def arm_dir(theta):
    t = math.radians(theta)
    return Vector((math.sin(t), 0.0, math.cos(t)))


def arm_tan(theta):
    t = math.radians(theta)
    return Vector((math.cos(t), 0.0, -math.sin(t)))


def plate_kit(sy, lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    k = Kit()
    out = kit.outline_round_poly(G_OUT, 0.012, max(1, cs)) if lod < 3 else G_OUT
    y0 = sy * PLATE_Y
    # outline in (x, z), extruded along y: Y_AXIS maps local (x, y, z) -> (z, x, y); use FRONT_OUT (x, z) instead
    k.prism(out, -PLATE_T / 2, PLATE_T / 2, BONE, bt=0.003 if lod < 3 else 0.0, bb=0.003 if lod < 3 else 0.0,
            bseg=max(1, cs - 1), m=kit.at(0, y0, 0) @ kit.FRONT_OUT)
    if lod < 3:  # open the A-frame: one big window, keeping a boss round the axle and a band round the slot
        win = Kit()
        win.prism(kit.outline_round_poly(WINDOW, 0.008, max(1, cs - 1)), -0.02, 0.02, BONE,
                  m=kit.at(0, y0, 0) @ kit.FRONT_OUT)
        keep = Kit()
        keep.cyl(0.03, -0.03, 0.03, BONE, seg(24, q, 8), m=kit.at(AX.x, y0, AX.z) @ YAX)
        band = []
        n = (14, 8, 5)[lod]
        for i in range(n + 1):
            a = math.radians(SLOT_A0 - 10 + (SLOT_A1 - SLOT_A0 + 20) * i / n)
            band.append((AX.x + 0.148 * math.cos(a), AX.z + 0.148 * math.sin(a)))
        for i in range(n, -1, -1):
            a = math.radians(SLOT_A0 - 10 + (SLOT_A1 - SLOT_A0 + 20) * i / n)
            band.append((AX.x + 0.092 * math.cos(a), AX.z + 0.092 * math.sin(a)))
        keep.prism(band, -0.03, 0.03, BONE, m=kit.at(0, y0, 0) @ kit.FRONT_OUT)
        win = kit.boolean_diff(win, [keep], mats)
        k = kit.boolean_diff(k, [win], mats)
    if lod < 3:  # arc slot for the stop bar
        slot = Kit()
        n = (14, 8, 5)[lod]
        pts_o, pts_i = [], []
        for i in range(n + 1):
            a = math.radians(SLOT_A0 + (SLOT_A1 - SLOT_A0) * i / n)
            pts_o.append((AX.x + (SLOT_R + 0.007) * math.cos(a), AX.z + (SLOT_R + 0.007) * math.sin(a)))
            pts_i.append((AX.x + (SLOT_R - 0.007) * math.cos(a), AX.z + (SLOT_R - 0.007) * math.sin(a)))
        ring = pts_i + list(reversed(pts_o))
        ring = list(reversed(ring))  # CCW
        slot.prism(ring, -0.02, 0.02, BONE, m=kit.at(0, y0, 0) @ kit.FRONT_OUT)
        k = kit.boolean_diff(k, [slot], mats)
    return k


def cup(k, theta, lod, q):
    c = AX + arm_dir(theta) * ARM_L
    t = arm_tan(theta)
    m = kit.frame(tuple(c), tuple(t))
    n = seg(32, q, 8)
    b = -CUP_D / 2 - 0.004
    prof = [(0.0, b, IGN), (CUP_R - 0.008, b, IGN), (CUP_R - 0.002, b + 0.004, IGN), (CUP_R, b + 0.012, IGN),
            (CUP_R, CUP_D / 2, IGN), (CUP_R - 0.004, CUP_D / 2 + 0.0015, IGN), (CUP_R - 0.006, CUP_D / 2, IGN),
            (CUP_R - 0.006, b + 0.014, IGN), (CUP_R - 0.014, b + 0.006, IGN), (0.0, b + 0.006, IGN)]
    if lod >= 3:
        prof = [(0.0, b, IGN), (CUP_R, b, IGN), (CUP_R, CUP_D / 2, IGN), (CUP_R - 0.006, CUP_D / 2, IGN),
                (0.0, b + 0.006, IGN)]
    k.lathe(prof, n, m)


def spring_kit(lod, q, turns):
    k = Kit()
    _m2.coil(k, 0.026, 0.004, -0.045, 0.045, turns, CHROME, q, lod, m=kit.at(*AX) @ YAX)
    if lod < 3:  # legs: one bearing on the arm, one on the rear cross rod
        for sy in (-1, 1):
            k.sweep([(AX.x, sy * 0.045, AX.z + 0.03), (AX.x - 0.03, sy * 0.045, AX.z + 0.0)], 0.004, 5, CHROME)
    return k


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    frame = Kit()
    for sy in (-1, 1):
        frame.rbox((0.40, 0.032, RAIL_H - 0.005), (0, sy * PLATE_Y, 0.005 + (RAIL_H - 0.005) / 2 + 0.0005),
                   0.008 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.005 if lod < 3 else 0.0)
        for x in (-0.17, 0.17):
            _m2.foot(frame, 'M', x, sy * PLATE_Y, min(1.0, q), lod, z0=0.0)
        frame.merge(plate_kit(sy, lod, q, mats))
    # axle + rear cross rod, with M5 heads on the outer faces
    frame.cyl(0.006, -PLATE_Y - PLATE_T / 2 - 0.003, PLATE_Y + PLATE_T / 2 + 0.003, STEEL, seg(16, q, 6),
              bev=0.001 if lod < 2 else 0.0, bseg=1, m=kit.at(*AX) @ YAX)
    frame.cyl(0.005, -PLATE_Y, PLATE_Y, STEEL, seg(12, q, 6), m=kit.at(LATCH[0], 0, LATCH[2]) @ YAX)
    for sy in (-1, 1):
        _m2.screw(frame, 'M5', (AX.x, sy * (PLATE_Y + PLATE_T / 2 + 0.003), AX.z), (0, sy, 0), q, lod)
        _m2.screw(frame, 'M5', (LATCH[0], sy * (PLATE_Y + PLATE_T / 2), LATCH[2]), (0, sy, 0), q, lod)
    for x in (-0.12, -0.04):
        _m2.land(frame, 'M', (x, -0.138, 0.07), (0, -1, 0), 0.0005, lod, mat=BONE)
    _m2.led_dome(frame, 8, (-0.005, -PLATE_Y - PLATE_T / 2, 0.275), (0, -1, 0), q, lod)
    frame.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08))
    springs = spring_kit(lod, q, 4.0)
    if lod < 2:
        springs.shape_keys['sk_wind'] = (lambda co: co + Vector((0, 0, 0)) if (co - AX).length > 0.04 else
                                         AX + Matrix.Rotation(math.radians(-25), 3, 'Y') @ (co - AX),
                                         '1 = wound (cocked); 0 = released, the coil body unwinds 25° about the axle',
                                         1.0)
    # arm + cup (PIVOT__arm, cocked)
    arm = Kit(pivot='PIVOT__arm')
    d = arm_dir(COCK)
    rot = Matrix.Rotation(math.radians(COCK), 4, 'Y')
    arm.rbox((0.030, 0.040, ARM_L - CUP_R + 0.02), (0, 0, (ARM_L - CUP_R + 0.02) / 2 - 0.02), 0.006 if lod < 3 else 0.0,
             OAK, cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.004 if lod < 3 else 0.0, m=kit.at(*AX) @ rot)
    arm.cyl(0.013, -0.022, 0.022, OAK, seg(20, q, 6), bev=0.002 if lod < 3 else 0.0, bseg=1, m=kit.at(*AX) @ YAX)
    cup(arm, COCK, lod, q)
    # stop bar (PIVOT__stop) with Ignition pads facing the arm
    stop = Kit(pivot='PIVOT__stop')
    sc = AX + arm_dir(STOP_REST) * SLOT_R
    stop.cyl(0.0065, -PLATE_Y - PLATE_T / 2 - 0.004, PLATE_Y + PLATE_T / 2 + 0.004, STEEL, seg(14, q, 6),
             bev=0.0015 if lod < 3 else 0.0, bseg=1, m=kit.at(*sc) @ YAX)
    for sy in (-1, 1):  # knurled knobs outside the plates (the angle adjust)
        stop.cyl(0.011, 0.0, 0.008, BONE, seg(16, q, 6), bev=0.002 if lod < 3 else 0.0, bseg=1,
                 m=kit.at(sc.x, sy * (PLATE_Y + PLATE_T / 2 + 0.001), sc.z) @ kit.frame(axis='y' if sy > 0 else '-y'))
    stop.cyl(0.013, -0.05, 0.05, IGN, seg(20, q, 6), bev=0.004 if lod < 3 else 0.0, bseg=2, m=kit.at(*sc) @ YAX)
    latch = Kit(pivot='PIVOT__latch')
    if lod < 3:
        cupc = AX + arm_dir(COCK) * ARM_L
        rim = cupc + arm_tan(COCK) * (CUP_D / 2) - d * (CUP_R - 0.004)
        latch.sweep([LATCH, (LATCH[0] + 0.004, 0.0, LATCH[2] + 0.02), (rim.x - 0.002, 0.0, rim.z + 0.004),
                     (rim.x + 0.004, 0.0, rim.z - 0.002)], 0.0022, 6, CHROME)
        latch.cyl(0.0055, -0.012, 0.012, CHROME, seg(12, q, 6), m=kit.at(*LATCH) @ YAX)
    pieces = {'frame': frame, 'springs': springs, 'arm': arm, 'stop': stop, 'latch': latch}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.flinger.graphite', (-0.03, PLATE_Y + PLATE_T / 2, 0.08), (0, 1, 0), (0, 0, 1), 0.07),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '4,3,3', 5.0, 'bottom', 9000,
        'Torsion catapult (cocked, throws +X): kn_powder_bone rails on FOOT_M under 15 mm Bone A-frame side plates with '
        'arc slots; steel axle at (0.04, y, 0.12) + rear cross rod with M5 heads; fat kn_chrome torsion spring on the '
        'axle (sk_wind, 1 = wound). PIVOT__arm (y, -105° cocked ... theta_stop) carries the kn_wood_oak arm and the '
        'kn_powder_ignition cup (Ø 0.09, centre 0.20 out); PIVOT__stop (y, -70 ... -30°, modelled -45°) the padded stop '
        'bar with angle knobs; PIVOT__latch (y, 0 ... 30°) the chrome latch hook. PR-M signal release + tension trigger '
        '(hook) on the front plate, ready LED_D8 (group 0) at the apex, name plate on the back plate. UV1 authored for '
        'the 2048² set (bake pending). Brief: docs/art/briefs/contraptions.md#flinger.',
        MASTERS, led_groups='0:ready', skins='classic,castle')
    part.pivot('arm', tuple(AX), 'y', COCK, -30.0, motion='turn', rest=COCK)
    part.pivot('stop', tuple(AX), 'y', -70.0, -30.0, motion='turn', rest=STOP_REST)
    part.pivot('latch', LATCH, 'y', 0.0, 30.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('base', (0.40, 0.30, 0.04), (0, 0, 0.02), phys='powder', restitution=0.2, friction=0.6)
    for sy, nm in ((-1, 'plate_l'), (1, 'plate_r')):
        part.col_box(nm, (0.38, PLATE_T, 0.245), (0, sy * PLATE_Y, RAIL_H + 0.1225), phys='powder', restitution=0.2,
                     friction=0.5)
    sc = AX + arm_dir(STOP_REST) * SLOT_R
    _m2.under(part, part.col_box('stop', (0.03, 0.10, 0.03), tuple(sc), phys='rubber', restitution=0.3,
                                 friction=0.8), 'stop')
    rot = Matrix.Rotation(math.radians(COCK), 4, 'Y')
    _m2.under(part, part.col_box('arm', (0.03, 0.04, ARM_L - CUP_R), (0, 0, 0), phys='wood',
                                 matrix=kit.at(*AX) @ rot @ kit.at(0, 0, (ARM_L - CUP_R) / 2)), 'arm')
    cupc = AX + arm_dir(COCK) * ARM_L
    t, d = arm_tan(COCK), arm_dir(COCK)
    side = Vector((0, 1, 0))
    b = cupc - t * (CUP_D / 2 + 0.004)
    floor = [tuple(b + d * (CUP_R * math.cos(a)) + side * (CUP_R * math.sin(a)) + t * dz)
             for a in [2 * math.pi * i / 8 for i in range(8)] for dz in (0.0, 0.006)]
    _m2.under(part, part.col_hull('cup_floor', floor, phys='powder'), 'arm')
    for i in range(4):  # 4 rim segments round the cup wall
        pts = []
        for j in range(3):
            a = 2 * math.pi * (i + j / 2) / 4
            for r in (CUP_R - 0.006, CUP_R):
                for dz in (0.006, CUP_D + 0.004):
                    pts.append(tuple(b + d * (r * math.cos(a)) + side * (r * math.sin(a)) + t * dz))
        _m2.under(part, part.col_hull('cup_rim_%d' % (i + 1), pts, phys='powder'), 'arm')
    part.port('signal', 'release', (-0.12, -0.138, 0.07), (0, -1, 0), 'M', 'in')
    part.port('tension', 'trigger', (-0.04, -0.138, 0.07), (0, -1, 0), 'M', 'in', kind='hook')
    cyl = [tuple(cupc - t * 0.016 + t * dz + d * (0.04 * math.cos(a)) + side * (0.04 * math.sin(a)))
           for a in [2 * math.pi * i / 10 for i in range(10)] for dz in (0.0, 0.04)]
    _m2.under(part, part.sensor('catch', 'cup', cyl), 'arm')
    _m2.under(part, part.emit('launch', 'cup', tuple(cupc), tuple(t)), 'arm')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
