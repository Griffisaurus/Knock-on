"""Procedurally build the WATERWHEEL source file (docs/art/briefs/matter.md, "WATERWHEEL: Bucket wheel").

Usage: blender -b --factory-startup -P tools/blender/make_waterwheel.py -- [out.blend]
Default output: assets/src/matter/waterwheel.blend

A kn_anod_beam wheel (two Ø 0.36 rims at y ±0.05, five spokes per side, kn_powder_bone hub Ø 0.06 on a
kn_steel_brushed Ø 0.016 axle) carrying five kn_poly_clear buckets at 72° (0.10 wide x 0.05 deep L-section scoops:
a tangential floor plate at r 0.145 + a radial lip to the Ø 0.39 tips, clear end cheeks: A4's sim shapes) on
PIVOT__wheel (y, continuous),
standing on two kn_powder_bone A-frames (12 mm plates at y ±0.085...0.097, feet at x ±0.15, FOOT_S) with bearing
blocks. Origin = axle centre (floor z -0.20). The front bearing carries the PR-M spin `axle` port (kind axle).
Collision: per bucket a floor and a wall plate (10 boxes, under the pivot) + leg_l / leg_r = 12 shapes.
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

TYPE = 'waterwheel'
BONE, ABEAM, CLEAR, STEEL, RUBBER = ('kn_powder_bone', 'kn_anod_beam', 'kn_poly_clear', 'kn_steel_brushed',
                                     'kn_rubber')
MASTERS = [BONE, ABEAM, CLEAR, STEEL, RUBBER]
FLOOR = -0.20
RIM_R, RIM_W, RIM_Y, RIM_T = 0.180, 0.012, 0.050, 0.006
HUB_R = 0.03
BUCKET_N, TIP_R, B_W, PLATE = 5, 0.195, 0.10, 0.005
R_IN, HALF_ARC = 0.145, 18.0     # A4's bucket floor radius and half arc (defs_m4 WATERWHEEL)
LEG_Y = (0.085, 0.097)
FOOT_X = 0.15
PORT = (0.0, -0.10, 0.0)


def bucket_frames(i):
    """Bucket i: polar angle (from +X, about -Y so the wheel turns in the XZ plane), radial u and tangential t."""
    a = math.radians(90 + 72 * i)
    u = Vector((math.cos(a), 0.0, math.sin(a)))
    t = Vector((-math.sin(a), 0.0, math.cos(a)))
    return a, u, t


def plate_matrix(c, x_axis, z_axis):
    x = Vector(x_axis).normalized()
    z = Vector(z_axis).normalized()
    y = z.cross(x)
    return Matrix.Translation(c) @ Matrix((x, y, z)).transposed().to_4x4()


def bucket_plates(i):
    """(centre, size, x-axis) of the lip and floor plates of bucket i, matching A4's sim shapes (defs_m4 WATERWHEEL):
    the floor is a tangential plate centred on the bucket's angle at r 0.145 (chord of ±18°); the lip is radial,
    r 0.145 -> 0.195, at the bucket's clockwise edge (angle - 18°). Also the cheek corners: lip tip, lip root and the
    floor's free end."""
    a, u, t = bucket_frames(i)
    half = math.radians(HALF_ARC)
    chord = 2 * R_IN * math.sin(half)
    floor_c = u * R_IN
    al = a - half
    ul = Vector((math.cos(al), 0.0, math.sin(al)))
    lip_c = ul * ((R_IN + TIP_R) / 2)
    lip = (lip_c, (TIP_R - R_IN, B_W, PLATE), ul)
    floor = (floor_c, (chord, B_W, PLATE), -t)
    return lip, floor, (ul * TIP_R, ul * R_IN, floor_c + t * (chord / 2))


def rbox_on(k, centre, size, x_axis, z_axis, r, mat, cs=1):
    k.rbox(size, (0, 0, 0), r, mat, cseg=cs, m=plate_matrix(centre, x_axis, z_axis))


def build(lod, q):
    cs = (2, 1, 1, 1)[lod]
    n = seg(72, q, 10 if lod < 3 else 5, 5)
    wheel = Kit(pivot='PIVOT__wheel')
    for s in (-1, 1):  # rims: flat annuli
        prof = [(RIM_R - RIM_W, -RIM_T / 2), (RIM_R, -RIM_T / 2), (RIM_R, RIM_T / 2), (RIM_R - RIM_W, RIM_T / 2)]
        wheel.lathe([(r, z, ABEAM) for r, z in prof], n, m=kit.frame((0, s * RIM_Y, 0), 'y'), closed=True)
        for k in range(5):  # spokes
            a = math.radians(90 + 72 * k + 36)
            d = Vector((math.cos(a), 0.0, math.sin(a)))
            p0 = d * (HUB_R - 0.004) + Vector((0, s * RIM_Y, 0))
            p1 = d * (RIM_R - RIM_W + 0.002) + Vector((0, s * RIM_Y, 0))
            wheel.sweep([p0, p1], 0.0035, (8, 6, 4, 3)[lod], ABEAM)
    wheel.cyl(HUB_R, -0.058, 0.058, BONE, seg(32, q, 8), bev=0.004 if lod < 3 else 0.0, bseg=cs,
              m=kit.frame((0, 0, 0), 'y'))
    wheel.cyl(0.008, -0.099, 0.099, STEEL, seg(16, q, 6), m=kit.frame((0, 0, 0), 'y'))
    buckets = Kit(pivot='PIVOT__wheel')
    for i in range(BUCKET_N):
        (wc, ws, wx), (fc, fs, fx), (tip, inner, far) = bucket_plates(i)
        side = Vector((0, 1, 0))
        rbox_on(buckets, wc, ws, wx, wx.cross(side), 0.002 if lod < 2 else 0.0, CLEAR)
        rbox_on(buckets, fc, fs, fx, fx.cross(side), 0.002 if lod < 2 else 0.0, CLEAR)
        if lod < 3:  # clear end cheeks (triangular-ish) closing the scoop at the rims
            for s in (-1, 1):
                y = s * (B_W / 2 - 0.0015)
                pts = [tuple(p + Vector((0, y + dy, 0))) for p in (tip, inner, far) for dy in (-0.0015, 0.0015)]
                buckets.hull(pts, CLEAR)
            # anod beam lip bead along the tip and the floor's far edge, so the clear cups read at mid-zoom
            for p in (tip, far):
                wheel.sweep([tuple(p + Vector((0, -B_W / 2, 0))), tuple(p + Vector((0, B_W / 2, 0)))], 0.0026,
                            (8, 6, 4)[lod], ABEAM)
    stand = Kit()
    for s in (-1, 1):
        yc = s * sum(LEG_Y) / 2
        th = LEG_Y[1] - LEG_Y[0]
        top = Vector((0, yc, 0.0))
        for sx in (-1, 1):  # A-frame legs (12 mm plates)
            foot = Vector((sx * FOOT_X, yc, FLOOR + 0.005))
            d = (top - foot)
            L = d.length
            c = (top + foot) / 2
            rbox_on(stand, c, (L, th, 0.024), d, d.cross(Vector((0, 1, 0))) * -1, 0.004 if lod < 3 else 0.0, BONE,
                    cs)
            stand.rbox((0.064, th + 0.002, 0.012), (sx * (FOOT_X + 0.008), yc, FLOOR + 0.011),
                       0.004 if lod < 3 else 0.0,
                       BONE, cseg=cs, rz=0.002 if lod < 3 else 0.0)
            _m2.foot(stand, 'S', sx * (FOOT_X - 0.004), yc, min(1.0, q), lod, z0=FLOOR, top=0.0012)
        # cross brace and bearing block
        if lod < 3:
            stand.rbox((0.17, th, 0.014), (0, yc, FLOOR + 0.075), 0.003 if lod < 3 else 0.0, BONE, cseg=1)
        stand.cyl(0.026, -th / 2 - 0.001, th / 2 + 0.001, BONE, seg(32, q, 8), bev=0.002 if lod < 3 else 0.0, bseg=1,
                  m=kit.frame(tuple(top), 'y'))
        stand.cyl(0.011, -th / 2 - 0.002, th / 2 + 0.002, STEEL, seg(16, q, 6), m=kit.frame(tuple(top), 'y'))
        for k in range(4):
            a = math.radians(45 + 90 * k)
            _m2.screw(stand, 'M5', (0.019 * math.cos(a), s * (LEG_Y[1] + 0.0005), 0.019 * math.sin(a)), (0, s, 0),
                      q, lod)
    _m2.land(stand, 'M', PORT, (0, -1, 0), 0.003, lod, mat=BONE)
    pieces = {'stand': stand, 'wheel': wheel, 'buckets': buckets}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.waterwheel.graphite', (0, -LEG_Y[1] - 0.0001, FLOOR + 0.075), (0, -1, 0), (0, 0, 1),
                        0.11, 0.012, lift=0.0004),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '4,4,2', 3.7, 'axle', 8000,
        'Bucket wheel (origin = axle centre, floor z -0.20): kn_anod_beam rims Ø 0.36 at y ±0.05 with 5 spokes per '
        'side, kn_powder_bone hub Ø 0.06 on a Ø 0.016 steel axle, five kn_poly_clear L-section buckets at 72° '
        '(floor + radial lip plates matching the A4 sim shapes, clear end cheeks, tips Ø 0.39) on PIVOT__wheel (y, '
        'continuous; 1.2 kg '
        'dynamic hinge body), two kn_powder_bone A-frames (12 mm, y ±0.085...0.097, feet x ±0.15 on FOOT_S, cross '
        'braces, bearing blocks with M5 screws; 2.5 kg static). PR-M spin `axle` (kind axle) on the front bearing. '
        'Collision: 5 x (floor + wall) plates under the pivot so Matter water sits in the scoops, + leg_l (front '
        'A-frame, y -) / leg_r (back, y +) = 12. Water in the buckets is pass-through Matter (no cavity). '
        'Brief: docs/art/briefs/matter.md#waterwheel.',
        MASTERS, skins='classic,mill', hints={'kn_wheel_mass': 1.2, 'kn_stand_mass': 2.5})
    part.pivot('wheel', (0, 0, 0), 'y')
    part.build_lods(build, lod0_q=1.2)
    side = Vector((0, 1, 0))
    for i in range(BUCKET_N):
        (wc, ws, wx), (fc, fs, fx), _pts = bucket_plates(i)
        for nm, c, size, xa in (('bucket_%d_wall' % (i + 1), wc, ws, wx), ('bucket_%d_floor' % (i + 1), fc, fs, fx)):
            ob = part.col_box(nm, (size[0], size[1], 0.0052), (0, 0, 0), phys='glass',
                              matrix=plate_matrix(c, xa, xa.cross(side)),
                              restitution=0.1, friction=0.5)
            _m2.under(part, ob, 'wheel')
    for nm, s in (('leg_l', -1), ('leg_r', 1)):
        part.col_box(nm, (2 * FOOT_X + 0.02, LEG_Y[1] - LEG_Y[0], 0.21), (0, s * sum(LEG_Y) / 2, FLOOR + 0.105),
                     phys='powder')
    part.port('spin', 'axle', PORT, (0, -1, 0), 'M', 'out', kind='axle')
    part.emit('drip', 'rim', (0, 0, 0.19), (0, 0, -1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
