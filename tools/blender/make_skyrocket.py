"""Procedurally build the SKYROCKET source file (docs/art/briefs/boom.md, "SKYROCKET: Finned paper rocket").

Usage: blender -b --factory-startup -P tools/blender/make_skyrocket.py -- [out.blend]
Default output: assets/src/boom/skyrocket.blend

A kn_paper_red body tube (Ø 0.05, z -0.09..0.09) under a convex kn_powder_amber nose cone (z 0.09-0.165) topped by
a kn_rubber_grip payload deck (Ø 0.03, top z 0.18). A graphite base collar (z -0.098..-0.066) carries the front
flat boss for the PR-S heat fuse ring (0, -0.032, -0.045) and the graphite nozzle bell (lip z -0.11, 10 mm above
the floor) with a kn_led ring inside (group 0 nozzle_heat). Three 5 mm graphite fins at 90° (back), 210° and 330°
stand the rocket on kn_rubber tip pads (floor z -0.12), keeping the front clear for the port. A short kn_fuse_cord
stub leaves the fuse ring and hangs to its tip at (0, -0.05, -0.08). Decals: the amber/graphite 45° hazard trim
wrapped round the upper tube (its stripes wind round it as a spiral), the name plate running up the front, the
launch pictogram above it.
Origin = centre of mass on the body axis, 0.12 above the floor (free body).
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

TYPE = 'skyrocket'
PAPER, G, AMBER, GRIP, RUBBER, LED, CORD = ('kn_paper_red', 'kn_powder_graphite', 'kn_powder_amber',
                                            'kn_rubber_grip', 'kn_rubber', 'kn_led', 'kn_fuse_cord')
MASTERS = [PAPER, G, AMBER, GRIP, RUBBER, LED, CORD]
R = 0.025
FLOOR = -0.12
FIN_ANGLES = (90.0, 210.0, 330.0)
FIN_T = 0.005
FIN = [(0.020, -0.100), (0.040, -0.1145), (0.0475, -0.1105), (0.0465, -0.078), (0.020, -0.022)]
PORT = (0.0, -0.032, -0.045)
TIP = (0.0, -0.05, -0.08)
STUB = [(0.0, -0.029, -0.045), (0.0, -0.040, -0.0455), (0.0, -0.0465, -0.0495), (0.0, -0.0495, -0.0570),
        (0.0, -0.0502, -0.0680), (0.0, -0.0500, -0.0800)]
NOZZLE = (0.0, 0.0, -0.11)
BAND_Z = 0.0605   # spiral stripe band centre (z 0.051..0.070)


def fin_frame(angle):
    """Local x = radial distance, local y = Blender z, local z = fin thickness (tangential)."""
    return kit.rot_z(angle) @ kit.FRONT_OUT


def catmull(pts, sub):
    p = [Vector(v) for v in pts]
    p = [p[0] * 2 - p[1]] + p + [p[-1] * 2 - p[-2]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(sub):
            t = k / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(p[-2])
    return out


def stripe_band():
    """The hazard trim wrapped once round the tube (decal_cylinder): one full tile across the circumference
    (6,470 px/m) and the full 120 px tile height (18.5 mm), so the 45° stripes stay square and wind round the
    tube as a spiral."""
    h = 120.0 / (1016.0 / (2 * math.pi * R))
    return kit.decal_cylinder('trim.hazard_r', (0, 0, BAND_Z), (0, 0, 1), R, (0, -1, 0), 0, h, nu=seg(40, 1.0, 8),
                              span=2 * math.pi)


def vertical_name(slot, theta, zc, length):
    """Name plate running up the tube (image right = +Z), wrapped on the cylinder."""
    rect = kit.atlas_rect(slot)
    hgt = length * rect[3] / rect[2]
    span = hgt / R
    rr = R + 0.0003
    rows = []
    for j in range(3):
        th = theta + span / 2 - span * j / 2          # image up = decreasing theta (to the viewer's left)
        rows.append([Vector((rr * math.cos(th), rr * math.sin(th), zc - length / 2 + length * i))
                     for i in (0.0, 1.0)])
    return kit.decal_grid(rows, rect)


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    n = seg(40, q, 8)
    body = Kit()
    # paper body tube, rolled rims
    body.cyl(R, -0.092, 0.0915, PAPER, n, bev=0.0012 if lod < 2 else 0.0, bseg=1)
    # nose cone: convex ogive Ø 0.052 -> Ø 0.03 (z 0.09..0.165), shoulder ring over the tube end
    ns = (10, 7, 5, 3)[lod]
    prof = [(0.0, 0.0885, AMBER), (0.0262, 0.0885, AMBER)]
    for i in range(ns + 1):
        t = i / ns
        prof.append((0.015 + 0.0112 * (1 - t ** 1.7), 0.091 + (0.1655 - 0.091) * t, AMBER))
    prof.append((0.0, 0.1655, AMBER))
    body.lathe(kit.dedupe(prof), n)
    # payload deck (rubber grip puck, top z 0.18)
    body.cyl(0.0158, 0.164, 0.180, GRIP, n, bev=0.0025 if lod < 3 else 0.0, bseg=cs, bev_bot=0.0)
    # base collar + front port boss
    body.cyl(0.0285, -0.098, -0.066, G, n, bev=0.002 if lod < 3 else 0.0, bseg=max(1, cs - 1))
    body.rbox((0.036, 0.020, 0.040), (0.0, -0.022, -0.045), 0.004 if lod < 3 else 0.0, G, cseg=max(1, cs - 1),
              rz=0.003 if lod < 3 else 0.0)
    # nozzle bell with its LED ring
    bell = [(0.0, -0.094, G), (0.009, -0.094, G), (0.0185, -0.1093, G), (0.0205, -0.110, G), (0.0222, -0.1085, G),
            (0.0178, -0.093, G), (0.0172, -0.087, G), (0.0, -0.087, G)]
    if lod >= 2:
        bell = [(0.0, -0.094, G), (0.009, -0.094, G), (0.0195, -0.110, G), (0.0222, -0.110, G), (0.0172, -0.087, G),
                (0.0, -0.087, G)]
    body.lathe(bell, n)
    nozzle = Kit()
    if lod < 3:
        nozzle.torus(0.0125, 0.0018, LED, n, (6, 4, 3, 3)[lod], m=kit.at(0, 0, -0.1015))
    else:
        nozzle.cyl(0.012, -0.0965, -0.0955, LED, 8)
    nozzle.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # fins with rubber tip pads
    corner = (0.004, 0.003, 0.002, 0.0)[lod]
    outline = kit.outline_round_poly(FIN, corner, max(1, cs - 1)) if corner else FIN
    for a in FIN_ANGLES:
        m = fin_frame(a)
        body.prism(outline, -FIN_T / 2, FIN_T / 2, G, bt=0.0015 if lod < 2 else 0.0, bb=0.0015 if lod < 2 else 0.0,
                   bseg=1, m=m)
        if lod < 3:
            body.rbox((0.012, 0.0085, 0.008), (0.0415, FLOOR + 0.004, 0.0), 0.0035 if lod < 2 else 0.0, RUBBER,
                      cseg=max(1, cs - 1), rz=0.0025 if lod < 2 else 0.0, m=m)
    # built-in fuse stub out of the fuse ring
    fuse = Kit()
    fuse.sweep(catmull(STUB, seg(3, q, 1)), 0.003, (8, 6, 5, 4)[lod], CORD)
    body.merge(fuse)
    fuse.free()
    pieces = {'body': body, 'nozzle': nozzle}
    decals = [stripe_band(),
              vertical_name('name.skyrocket.bone', math.radians(270), 0.0035, 0.050),
              kit.decal_cylinder('picto.launch.warn', (0, 0, 0.0385), (0, 0, 1), R, (0, -1, 0), 0.018, 0.018,
                                 nu=6, lift=0.0003)]
    return kit.add_decals(pieces, lod, decals)


def fin_hull():
    pts = []
    for a in FIN_ANGLES:
        m = fin_frame(a)
        for u, v in FIN:
            for t in (-FIN_T / 2, FIN_T / 2):
                pts.append(tuple(m @ Vector((u, v, t))))
    return pts


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '1,3,1', 0.3, 'com', 4500,
        'Finned paper rocket: red tube, amber nose cone + rubber payload deck, three graphite fins (90/210/330°) '
        'on rubber tip pads, graphite collar with the front fuse boss, nozzle bell with the nozzle_heat LED ring '
        '(lip 10 mm above the floor), built-in fuse stub to EMIT__spark__fuse_tip. '
        'Brief: docs/art/briefs/boom.md#skyrocket. Decals: amber/graphite 45° hazard trim wrapped round the upper '
        'tube (decal_cylinder, square stripes winding round it), name plate up the front, launch pictogram. COL__hull__fins has 30 '
        'points (5 outline corners x 2 faces x 3 fins). Deferred: scorched-nozzle decal (engine), comet skin.',
        MASTERS, led_groups='0:nozzle_heat')
    part.build_lods(build, lod0_q=1.3)
    part.col_capsule('body', 0.03, 0.27, (0, 0, 0.035), 'z', phys='paper', restitution=0.25, friction=0.5)
    part.col_hull('fins', fin_hull(), phys='paper', restitution=0.25, friction=0.5)
    part.port('heat', 'fuse', PORT, (0, -1, 0), 'S', 'in')
    part.sensor('catch', 'payload', [(x, y, z) for x in (-0.02, 0.02) for y in (-0.02, 0.02) for z in (0.18, 0.21)],
                threshold=0.5)
    part.emit('spark', 'fuse_tip', TIP, (0, 0, -1))
    part.emit('exhaust', 'nozzle', NOZZLE, (0, 0, -1))
    part.emit('trail', 'nozzle', NOZZLE, (0, 0, -1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
