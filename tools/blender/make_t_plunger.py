"""Procedurally build the T-PLUNGER source file (docs/art/briefs/boom.md, "T-PLUNGER: Push-handle detonator box").

Usage: blender -b --factory-startup -P tools/blender/make_t_plunger.py -- [out.blend]
Default output: assets/src/boom/t_plunger.blend

A red fibre-case box (kn_paper_red panels 0.18 x 0.18, z 0.022-0.149) between a pillowed graphite plinth
(0.20 x 0.20, z 0.004-0.024, four FOOT_M bumpers) and a graphite top plate (z 0.147-0.159, four M5 corner screws),
with graphite corner beads capping the four vertical edges. The chrome rod (r 8 mm) rises through a steel bushing
to the graphite T-bar (0.16 long, underside z 0.265, top z 0.30) with kn_rubber_grip grips 1.3x the bar core;
rod, T-bar and the brass rack hang under PIVOT__plunger (z, slide -0.10..0: fully down the bar's underside stops
at z 0.165). The front carries a 60 x 80 mm kn_poly_amber window (centre x -0.05, z 0.075) in a graphite frame over
a bone-lined pocket showing the rack, the pinion + gear on PIVOT__pinion (x) and the copper dynamo on
PIVOT__armature (x) with the kn_led coil strip (group 1) behind it; the PR-M signal out ring sits on a 1 mm graphite
escutcheon 54 mm right of the window. LED_D8 armed dome (group 0) on the top plate front. Decals: hazard stripe band
round the case top, explosive pictogram on the +X panel, name plate on the plinth front.
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

TYPE = 't_plunger'
G, PAPER, STEEL, CHROME, GRIP, AMBER, BRASS, COPPER, RUBBER, LED = (
    'kn_powder_graphite', 'kn_paper_red', 'kn_steel_brushed', 'kn_chrome', 'kn_rubber_grip', 'kn_poly_amber',
    'kn_brass', 'kn_copper', 'kn_rubber', 'kn_led')
BONE = 'kn_powder_bone'
MASTERS = [G, PAPER, STEEL, CHROME, GRIP, AMBER, BRASS, COPPER, RUBBER, LED, BONE]

FEET = 0.004
PLINTH_TOP, CASE_TOP, PLATE_TOP = 0.024, 0.149, 0.159
CASE_W = 0.18
FACE_Y = -CASE_W / 2
WIN_C, WIN_W, WIN_H = (-0.05, 0.075), 0.06, 0.08
POCKET_BACK = -0.032
PORT = (0.055, -0.091, 0.075)
BAR_Z = 0.2825                 # T-bar axis: underside 0.265, top 0.30
BAR_CORE, GRIP_R = 0.027, 0.0175
PINION = Vector((-0.065, -0.060, 0.106))
ARM = Vector((-0.045, -0.060, 0.066))
LED_C = (0.0, -0.075, PLATE_TOP)


def face(x, y, z):
    """Frame on the front face: local (x, y) = Blender (x, z), local +z = out of the face (-Y)."""
    return kit.at(x, y, z) @ kit.FRONT_OUT


def gear_outline(n, r_root, r_tip, start=0.0):
    pts = []
    p = 2 * math.pi / n
    for i in range(n):
        a = start + i * p
        for r, f in ((r_root, 0.0), (r_tip, 0.22), (r_tip, 0.5), (r_root, 0.72)):
            pts.append((r * math.cos(a + f * p), r * math.sin(a + f * p)))
    return pts


def mechanism(lod, q):
    """Pinion + gear (PIVOT__pinion) and the dynamo armature (PIVOT__armature), both on axis x."""
    pin = Kit(pivot='PIVOT__pinion')
    arm = Kit(pivot='PIVOT__armature')
    pm = kit.at(*PINION) @ kit.X_AXIS       # local z = Blender +x, local (x, y) = Blender (y, z)
    am = kit.at(*ARM) @ kit.X_AXIS
    if lod < 2:
        pin.prism(gear_outline(seg(12, q, 8), 0.0072, 0.0092), -0.005, 0.005, BRASS, m=pm)
        pin.prism(gear_outline(seg(32, q, 16), 0.0245, 0.0262), -0.013, -0.010, BRASS, m=pm)
        pin.cyl(0.006, -0.0135, -0.0095, BRASS, seg(16, q, 6), m=pm)  # gear hub
        arm.prism(gear_outline(seg(18, q, 10), 0.0125, 0.0142, 0.1), -0.033, -0.030, BRASS, m=am)
    else:
        pin.cyl(0.0085, -0.005, 0.005, BRASS, seg(16, q, 6), m=pm)
        pin.cyl(0.0255, -0.013, -0.010, BRASS, seg(24, q, 8), m=pm)
        arm.cyl(0.0135, -0.033, -0.030, BRASS, seg(16, q, 6), m=am)
    pin.cyl(0.002, -0.016, 0.046, CHROME, seg(8, q, 4), m=pm)   # axle, wall to wall
    arm.cyl(0.0025, -0.035, 0.023, CHROME, seg(10, q, 4), m=am)
    # dynamo: steel core + three copper winding bands split at the slots, brass commutator
    n = seg(36, q, 6)
    if lod < 2:
        arm.cyl(0.0128, -0.021, 0.015, STEEL, n, m=am)
        prof = [(0.0124, -0.020, COPPER), (0.0152, -0.020, COPPER), (0.0163, -0.018, COPPER),
                (0.0163, 0.012, COPPER), (0.0152, 0.014, COPPER), (0.0124, 0.014, COPPER)]
        gap = math.radians(22)
        for g in range(3):
            a0 = 2 * math.pi * g / 3 + gap / 2
            arm.lathe_arc(prof, a0, a0 + 2 * math.pi / 3 - gap, max(2, n // 3), m=am)
        arm.cyl(0.0075, 0.015, 0.021, BRASS, seg(12, q, 6), m=am)
    else:
        arm.cyl(0.016, -0.020, 0.014, COPPER, n, m=am)
    return pin, arm


def plunger(lod, q):
    k = Kit(pivot='PIVOT__plunger')
    cs = (3, 2, 1, 1)[lod]
    k.cyl(0.008, 0.110, BAR_Z - 0.010, CHROME, seg(20, q, 6), m=kit.at(0, 0, 0))
    k.rbox((0.032, 0.031, 0.035), (0, 0, BAR_Z), 0.007 if lod < 3 else 0.0, G, cseg=cs, rz=0.006 if lod < 3 else 0.0)
    k.rbox((0.150, BAR_CORE, BAR_CORE), (0, 0, BAR_Z), 0.008 if lod < 3 else 0.0, G, cseg=cs,
           rz=0.008 if lod < 3 else 0.0)
    gs = seg(24, q, 6)
    for s in (-1, 1):
        # grip sleeve Ø 0.035 (1.3x the 27 mm bar core), x 0.020..0.072, four shallow ribs
        prof = [(0.0, 0.0, GRIP), (GRIP_R - 0.002, 0.0, GRIP), (GRIP_R, 0.002, GRIP)]
        if lod < 2:
            for i in range(4):
                z0 = 0.008 + i * 0.011
                prof += [(GRIP_R, z0, GRIP), (GRIP_R - 0.0012, z0 + 0.003, GRIP), (GRIP_R, z0 + 0.006, GRIP)]
        prof += [(GRIP_R, 0.050, GRIP), (GRIP_R - 0.002, 0.052, GRIP), (0.0, 0.052, GRIP)]
        k.lathe(kit.dedupe(prof), gs, kit.frame((s * 0.020, 0, BAR_Z), (s, 0, 0)))
        # domed graphite end cap to x 0.080
        k.cyl(0.0155, 0.0, 0.009, G, gs, bev=0.006 if lod < 3 else 0.0, bseg=cs, bev_bot=0.0,
              m=kit.frame((s * 0.071, 0, BAR_Z), (s, 0, 0)))
    # brass rack behind the pinion (teeth face -Y), rides the plunger: z 0.106..0.158 at rest
    k.rbox((0.010, 0.008, 0.052), (PINION.x, -0.044, 0.132), 0.0015 if lod < 2 else 0.0, BRASS, cseg=1,
           rz=0.0015 if lod < 2 else 0.0)
    if lod < 2:
        for i in range(12):
            z = 0.108 + i * 0.004
            k.prism([(-0.0085, -0.001), (-0.0065, 0.0), (-0.0065, 0.0015), (-0.0085, 0.0025)], -0.005, 0.005, BRASS,
                    m=kit.at(PINION.x, -0.0415, z) @ kit.X_AXIS)
    return k


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    # plinth + FOOT_M bumpers
    body.rbox((0.20, 0.20, PLINTH_TOP - FEET), (0, 0, (FEET + PLINTH_TOP) / 2), 0.008 if lod < 3 else 0.004, G,
              cseg=cs, rz=0.004 if lod < 3 else 0.0)
    for x in (-0.075, 0.075):
        for y in (-0.075, 0.075):
            _m2.foot(body, 'M', x, y, q, lod)
    # red fibre case, window pocket cut (bone liner so the mechanism reads through the amber pane)
    case = Kit()
    case.rbox((CASE_W, CASE_W, CASE_TOP - 0.022), (0, 0, (CASE_TOP + 0.022) / 2), 0.004, PAPER, cseg=max(1, cs - 1),
              rz=0.0)
    if lod < 3:
        cut = Kit()
        depth = 0.020 + (POCKET_BACK - FACE_Y)
        cut.rbox((WIN_W, WIN_H, depth), (0, 0, 0), 0.003 if lod < 2 else 0.0, BONE, cseg=max(1, cs - 1), rz=0.0,
                 m=face(WIN_C[0], POCKET_BACK - depth / 2, WIN_C[1]))
        case = kit.boolean_diff(case, [cut], mats)
    body.merge(case)
    case.free()
    # corner beads cap the four vertical edges
    for x in (-0.0895, 0.0895):
        for y in (-0.0895, 0.0895):
            body.cyl(0.0055, 0.022, CASE_TOP + 0.002, G, seg(16, q, 6), m=kit.at(x, y, 0))
    # top plate, bushing, M5 corner screws, armed LED
    body.rbox((0.192, 0.192, PLATE_TOP - CASE_TOP + 0.002), (0, 0, (PLATE_TOP + CASE_TOP - 0.002) / 2),
              0.008 if lod < 3 else 0.004, G, cseg=cs, rz=0.003 if lod < 3 else 0.0)
    body.cyl(0.015, PLATE_TOP - 0.001, PLATE_TOP + 0.007, STEEL, seg(28, q, 8), bev=0.002 if lod < 2 else 0.0,
             bseg=max(1, cs - 1), m=kit.at(0, 0, 0))
    for x in (-0.080, 0.080):
        for y in (-0.080, 0.080):
            _m2.screw(body, 'M5', (x, y, PLATE_TOP), (0, 0, 1), q, lod)
    _m2.led_dome(body, 8, LED_C, (0, 0, 1), q, lod)
    # window frame + amber pane, port escutcheon
    wx, wz = WIN_C
    if lod < 3:
        prof = [(-0.001, -0.002), (0.005, -0.002), (0.005, 0.0015), (0.004, 0.0025), (0.0, 0.0025), (-0.001, 0.0015)]
        if lod >= 2:
            prof = [(-0.001, -0.002), (0.005, -0.002), (0.005, 0.0025), (-0.001, 0.0025)]
        body.ring_sweep(kit.outline_rrect(WIN_W, WIN_H, 0.003, max(1, cs - 1)), prof, G, m=face(wx, FACE_Y, wz))
        body.rbox((WIN_W + 0.002, WIN_H + 0.002, 0.002), (0, 0, 0), 0.003, AMBER, cseg=max(1, cs - 1), rz=0.0,
                  m=face(wx, FACE_Y + 0.0015, wz))
    else:
        body.rbox((WIN_W + 0.006, WIN_H + 0.006, 0.003), (0, 0, 0), 0.0, AMBER, cseg=0, rz=0.0,
                  m=face(wx, FACE_Y - 0.001, wz))
    body.rbox((0.050, 0.050, 0.0025), (0, 0, 0), 0.006 if lod < 3 else 0.0, G, cseg=max(1, cs - 1),
              rz=0.0006 if lod < 2 else 0.0, m=face(PORT[0], PORT[1] + 0.00125, PORT[2]))
    pieces = {'body': body, 'plunger': plunger(lod, q)}
    if lod < 3:
        pin, arm = mechanism(lod, q)
        coil = Kit()
        coil.rbox((0.036, 0.004, 0.012), (ARM.x - 0.002, POCKET_BACK - 0.001, ARM.z), 0.0015 if lod < 2 else 0.0,
                  LED, cseg=1, rz=0.001 if lod < 2 else 0.0)
        body.merge(coil)
        coil.free()
        pieces.update({'pinion': pin, 'armature': arm})
    body.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08) if c.z > 0.15 else (1, 0.08))
    # Decals: hazard band round the case top (between the corner beads), explosive pictogram on the +X panel,
    # name plate (bone ink) on the graphite plinth front.
    band_z, band_h, band_w = 0.136, 0.016, 0.166
    sub = (0.0, 0.0, band_w * (60 / band_h) / 1016, 0.5)   # 60 px over 16 mm, square stripes
    decals = []
    for nrm, up in (((0, -1, 0), (0, 0, 1)), ((1, 0, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1))):
        c = Vector(nrm) * (CASE_W / 2) + Vector((0, 0, band_z))
        decals.append(kit.decal_plane('trim.hazard_r', c, nrm, up, band_w, band_h, sub=sub))
    decals.append(kit.decal_plane('picto.explosive.warn', (CASE_W / 2, 0.0, 0.075), (1, 0, 0), (0, 0, 1), 0.06, 0.06))
    decals.append(kit.decal_plane('name.t_plunger.bone', (0.0, -0.100, 0.014), (0, -1, 0), (0, 0, 1), 0.060))
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '2,3,2', 2.5, 'bottom', 7000,
        'Push-handle detonator: red fibre case, graphite plinth / corner beads / top plate, chrome rod and graphite '
        'T-bar with 1.3x rubber grips on PIVOT__plunger (z slide -0.10..0; fully down the bar underside stops at '
        'z 0.165), amber window showing the brass rack (on the plunger), pinion (PIVOT__pinion, x) and copper '
        'dynamo (PIVOT__armature, x) over a kn_led coil strip. Brief: docs/art/briefs/boom.md#t-plunger. '
        'Decals: hazard band, explosive pictogram, name plate. COL box sizes read as W x D x H (the brief lists '
        'height last); COL__box__handle carries pivot=plunger (the engine moves it with the handle). '
        'Rack is 52 mm long so it stays inside the case at full stroke. Deferred: window interior AO bake '
        '(2048 set), mine-cart walnut skin.',
        MASTERS, led_groups='0:armed,1:coil')
    part.pivot('plunger', (0.0, 0.0, BAR_Z), 'z', -0.10, 0.0, motion='slide')
    part.pivot('pinion', tuple(PINION), 'x', motion='turn')
    part.pivot('armature', tuple(ARM), 'x', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('plinth', (0.20, 0.20, 0.024), (0, 0, 0.012), phys='powder', restitution=0.2, friction=0.6)
    part.col_box('case', (0.18, 0.18, 0.135), (0, 0, 0.0915), phys='powder', restitution=0.2, friction=0.6)
    rod = part.col_cyl('rod', 0.008, BAR_Z - 0.0175 - PLATE_TOP, (0, 0, (BAR_Z - 0.0175 + PLATE_TOP) / 2), 'z',
                       phys='steel')
    rod['pivot'] = 'plunger'
    h = part.col_box('handle', (0.16, 0.035, 0.035), (0, 0, BAR_Z), phys='powder', restitution=0.2, friction=0.8)
    h['pivot'] = 'plunger'
    port = part.port('signal', 'out', PORT, (0, -1, 0), 'M', 'out', max_links=64)
    port['broadcast'] = True
    part.sensor('impact', 'handle', [(x, y, z) for x in (-0.08, 0.08) for y in (-0.0175, 0.0175)
                                     for z in (0.29, 0.31)], threshold=0.3, cooldown=0.0, one_shot=True,
                pressure_kg=1.0, pivot='plunger')
    part.emit('spark', 'window', (-0.05, -0.092, 0.075), (0, -1, 0))
    part.emit('fire', 'port', PORT, (0, -1, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
