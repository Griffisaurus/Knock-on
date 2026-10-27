"""Procedurally build the BIG TOP source file (docs/art/briefs/boom.md, "BIG TOP: Circus cannon").

Usage: blender -b --factory-startup -P tools/blender/make_big_top.py -- [out.blend]
Default output: assets/src/boom/big_top.blend

A squat red circus mortar on a long graphite carriage, modelled at the default 30° elevation (bounds x -0.295
(trail spade) ... +0.289 (bell lip), y +-0.205 (tyres), z 0 ... 0.416 (bell top)). Barrel frame: origin at the
trunnion (0.06, 0, 0.18), barrel-local +x along the bore (cos 30°, 0, sin 30°).
  carriage  two 16 mm graphite cheeks (inner faces y +-0.17, outer +-0.186, x -0.245..0.12) with steel trunnion
            caps + M8 screws and two M8 cheek bolts per side, a rear transom and a trail spade on a rubber pad; the
            PR-L heat fuse ring sits on the front cheek (-0.20, -0.186, 0.10)
  wheels    spoked graphite wheels Ø 0.18 (8 spokes, steel hub caps) with 16 mm kn_rubber tyres, axle
            (0.02, +-0.197, 0.09), on PIVOT__wheel_l (+Y) / PIVOT__wheel_r (-Y)
  cradle    steel trunnion band and pins on PIVOT__elevation (the barrel slides through it on recoil)
  barrel    kn_powder_ignition barrel Ø 0.30 (bore Ø 0.27, graphite liner, barrel-local -0.06..+0.06) flaring to the
            Ø 0.36 bell at +0.16, breech plate + cascabel knob, touch-hole boss with a short fuse stub; eight
            kn_anod_ignition iris leaves (open pose, aperture Ø 0.26, plane barrel-local +0.12, stacked like a camera
            aperture) behind a steel iris ring; on PIVOT__recoil
  ram       steel pusher plate Ø 0.25 (rest face barrel-local -0.05) with a rubber pad and an M8 screw, PIVOT__ram
  flag      graphite loaded-flag (bone star decal) on the front cheek top, PIVOT__flag (y, 0..80°)
Pivot frames: PIVOT__elevation is rotated into the barrel frame with its local y = world -Y, so its axis prop 'y'
raises the muzzle as the angle grows (15..55°, rest 30). PIVOT__recoil (x, slide -0.03..0) and PIVOT__ram (x, slide
0..0.16) nest under it with identity local rotation, so their local x is the bore axis. PIVOT__carriage (z, slide
0..0.01) is an added root pivot for the clip's carriage hop; everything hangs under it. Clip big_top__recoil (0.5 s).
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

TYPE = 'big_top'
G, IGN, ANOD, STEEL, RUBBER, CORD = ('kn_powder_graphite', 'kn_powder_ignition', 'kn_anod_ignition',
                                     'kn_steel_brushed', 'kn_rubber', 'kn_fuse_cord')
MASTERS = [G, IGN, ANOD, STEEL, RUBBER, CORD]
ELEV = 30.0
T = Vector((0.06, 0.0, 0.18))
B = Vector((math.cos(math.radians(ELEV)), 0.0, math.sin(math.radians(ELEV))))   # bore axis
N = Vector((-math.sin(math.radians(ELEV)), 0.0, math.cos(math.radians(ELEV))))  # barrel top normal
LATHE = kit.frame(T, B)                       # local z = bore axis (barrel-local x), origin at the trunnion
CHEEK_IN, CHEEK_OUT = 0.170, 0.186
CHEEK = [(-0.245, 0.035), (0.12, 0.075), (0.12, 0.17), (0.06, 0.225), (-0.02, 0.225), (-0.245, 0.15)]
WHEEL_C = Vector((0.02, 0.197, 0.09))
WHEEL_R, TYRE_W = 0.09, 0.016
PORT = (-0.20, -0.186, 0.10)
IRIS_X, IRIS_OPEN_R, IRIS_OUT_R = 0.12, 0.13, 0.172
RAM_FACE = -0.05
FLAG_H = Vector((-0.06, -0.178, 0.217))
SLOPE = math.atan2(0.225 - 0.15, 0.225)       # cheek top slope toward -X
FLAG_D = Vector((-math.cos(SLOPE), 0.0, -math.sin(SLOPE)))
FLAG_U = Vector((-math.sin(SLOPE), 0.0, math.cos(SLOPE)))
TOUCH_XL = -0.017                             # barrel-local x of the touch-hole (world (-0.03, 0, 0.30))
FUSE_TIP = (-0.04, 0.0, 0.313)


def bl(x, up=0.0, side=0.0):
    """Barrel-local point (x along the bore, up along the barrel top normal, side along +Y) at the rest pose."""
    return T + B * x + N * up + Vector((0.0, side, 0.0))


def barrel_rot():
    """Rotation whose local x = bore axis, local y = world -Y (elevation grows upward), local z = x cross y."""
    y = Vector((0.0, -1.0, 0.0))
    z = B.cross(y)
    return Matrix((B, y, z)).transposed()


def rounded_rect_profile(r0, r1, h0, h1, c, n, mat):
    """Closed (r, h) rounded rectangle for lathe(closed=True): tyres, rims."""
    pts = []
    for cr, ch, a0 in ((r1 - c, h0 + c, -90), (r1 - c, h1 - c, 0), (r0 + c, h1 - c, 90), (r0 + c, h0 + c, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cr + c * math.cos(a), ch + c * math.sin(a), mat))
    return pts


def barrel_profile(ns, bs, lod):
    """Barrel shell + bell + iris housing + bore liner as one closed lathe profile (h = barrel-local x)."""
    p = [(0.0, -0.060, IGN)]
    bev = 0.015
    for k in range(bs + 1):
        t = math.pi / 2 * k / bs
        p.append((0.150 - bev + bev * math.sin(t), -0.060 + bev * (1 - math.cos(t)), IGN))
    p.append((0.150, 0.060, IGN))
    for i in range(1, ns + 1):
        t = i / ns
        p.append((0.150 + 0.030 * (1 - (1 - t) ** 3), 0.060 + 0.095 * t, IGN))
    if lod < 2:
        p += [(0.1796, 0.1585, IGN), (0.1770, 0.1600, IGN), (0.1735, 0.1597, G)]
    else:
        p += [(0.1765, 0.1600, G)]
    p += [(0.1710, 0.1570, G), (0.1705, 0.108, G), (0.1360, 0.098, G), (0.1350, 0.094, G), (0.1350, -0.057, G),
          (0.0, -0.057, G)]
    return kit.dedupe(p)


def iris_leaf_outline(m):
    """One open iris leaf centred on local +x: outer arc r 0.172, crescent inner edge down to r 0.13, blunt ends."""
    half = math.radians(36)
    pts = []
    for i in range(m + 1):  # outer arc, CCW
        a = -half + 2 * half * i / m
        pts.append((IRIS_OUT_R * math.cos(a), IRIS_OUT_R * math.sin(a)))
    for i in range(m + 1):  # inner edge back, deepest a little past the middle (swirl)
        s = i / m
        a = half - 2 * half * s
        r = 0.165 - (0.165 - IRIS_OPEN_R) * math.sin(math.pi * s ** 0.85) ** 0.8
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


# sk_iris: each leaf turns about a pin on its outer rim (leaf-local angle +36°, r 0.168) by -IRIS_CLOSE_DEG,
# which brings the eight inner edges in to the Ø 0.045 stop (solved numerically for the 22-segment outline).
IRIS_PIN = (0.168 * math.cos(math.radians(36)), 0.168 * math.sin(math.radians(36)))
IRIS_CLOSE_DEG = 46.0


def iris(k, lod, q, close=0.0):
    if lod >= 3:  # one anodised annulus
        k.lathe([(IRIS_OPEN_R, -0.001, ANOD), (IRIS_OUT_R, -0.001, ANOD), (IRIS_OUT_R, 0.001, ANOD),
                 (IRIS_OPEN_R, 0.001, ANOD)], 16, LATHE @ kit.at(0, 0, IRIS_X), closed=True)
        return
    m = seg(22, q, 5)
    outline = iris_leaf_outline(m)
    bt = 0.0004 if lod < 2 else 0.0
    pin = kit.at(IRIS_PIN[0], IRIS_PIN[1], 0) @ kit.rot_z(-IRIS_CLOSE_DEG * close) @         kit.at(-IRIS_PIN[0], -IRIS_PIN[1], 0)
    for j in range(8):
        mm = LATHE @ kit.at(0, 0, IRIS_X) @ kit.rot_z(45.0 * j) @ pin @ kit.rot_x(4.5)
        k.prism(outline, -0.001, 0.001, ANOD, bt=bt, bb=bt, bseg=1, m=mm)


def iris_piece(lod, q):
    """The eight leaves as their own piece on PIVOT__recoil, so sk_iris (0 open Ø 0.26 -> 1 closed Ø 0.045) works
    on them alone."""
    k = Kit(pivot='PIVOT__recoil')
    iris(k, lod, q)
    if lod < 2:
        alt = Kit()
        iris(alt, lod, q, close=1.0)
        k.shape_keys['sk_iris'] = (alt, '0 = open (aperture Ø 0.26, leaves stowed in the flare); 1 = closed to the '
                                        'Ø 0.045 stop. Engine weight = (0.26 - (roller Ø + 0.004)) / 0.215', 0.0)
    return k


def wheel(lod, q, side):
    name = 'wheel_l' if side > 0 else 'wheel_r'
    k = Kit(pivot='PIVOT__' + name)
    c = Vector((WHEEL_C.x, side * WHEEL_C.y, WHEEL_C.z))
    m = kit.frame(c, (0, side, 0))          # local +z = outward
    n = seg(48, q, 10)
    cn = (3, 2, 1, 1)[lod]
    k.lathe(rounded_rect_profile(0.077, WHEEL_R, -TYRE_W / 2, TYRE_W / 2, 0.0045 if lod < 3 else 0.002, cn, RUBBER),
            n, m, closed=True)
    k.lathe(rounded_rect_profile(0.068, 0.0785, -0.006, 0.006, 0.002 if lod < 2 else 0.001, max(1, cn - 1), G),
            n, m, closed=True)
    hs = seg(24, q, 8)
    k.cyl(0.024, -0.008, 0.0055, G, hs, bev=0.003 if lod < 3 else 0.0, bseg=max(1, cn - 1), m=m)
    if lod < 3:
        k.cyl(0.013, 0.004, 0.008, STEEL, hs, bev=0.0015 if lod < 2 else 0.0, bseg=1, m=m)
        sides = (8, 6, 4)[lod]
        for i in range(8):
            a = 2 * math.pi * i / 8 + math.pi / 8
            d = Vector((math.cos(a), math.sin(a), 0.0))
            k.sweep([tuple(m @ (d * 0.020)), tuple(m @ (d * 0.0705))], 0.0055, sides, G)
    else:
        k.cyl(0.069, -0.003, 0.003, G, 10, m=m)
    return k


def carriage(lod, q):
    k = Kit(pivot='PIVOT__carriage')
    cs = (3, 2, 1, 1)[lod]
    rr = (0.012, 0.010, 0.008, 0.0)[lod]
    outline = kit.outline_round_poly(CHEEK, rr, cs) if rr else CHEEK
    bev = (0.004, 0.003, 0.002, 0.0)[lod]
    for s in (-1, 1):  # FRONT_OUT: local z = -Y
        z0, z1 = (-CHEEK_OUT, -CHEEK_IN) if s > 0 else (CHEEK_IN, CHEEK_OUT)
        k.prism(outline, z0, z1, G, bt=bev, bb=bev, bseg=max(1, cs - 1), m=kit.FRONT_OUT)
        # trunnion cap (steel, 2 mm) + M8, two M8 cheek bolts
        k.cyl(0.026, -0.0005, 0.002, STEEL, seg(32, q, 8), bev=0.0008 if lod < 2 else 0.0, bseg=1,
              m=kit.frame((T.x, s * CHEEK_OUT, T.z), (0, s, 0)))
        _m2.screw(k, 'M8', (T.x, s * (CHEEK_OUT + 0.002), T.z), (0, s, 0), q, lod)
        for z in (0.065, 0.165):
            _m2.screw(k, 'M8', (-0.125, s * CHEEK_OUT, z), (0, s, 0), q, lod)
        # axle stub from the cheek into the wheel hub
        k.cyl(0.012, -0.002, 0.007, STEEL, seg(16, q, 6), m=kit.frame((WHEEL_C.x, s * (CHEEK_OUT - 0.001), WHEEL_C.z),
                                                                     (0, s, 0)))
    # rear transom, trail spade on its rubber pad
    k.rbox((0.040, 2 * CHEEK_IN + 0.004, 0.095), (-0.225, 0.0, 0.0925), 0.006 if lod < 3 else 0.0, G, cseg=cs)
    k.rbox((0.060, 0.120, 0.056), (-0.265, 0.0, 0.0325), 0.010 if lod < 3 else 0.0, G, cseg=cs,
           rz=0.006 if lod < 3 else 0.0)
    k.rbox((0.052, 0.110, 0.0050), (-0.265, 0.0, 0.0025), 0.008 if lod < 3 else 0.0, RUBBER, cseg=max(1, cs - 1),
           rz=0.0015 if lod < 2 else 0.0)
    # flag hinge bracket on the front cheek top
    k.rbox((0.014, 0.012, 0.010), tuple(FLAG_H - Vector((0, 0, 0.005))), 0.003 if lod < 3 else 0.0, STEEL,
           cseg=max(1, cs - 1), rz=0.002 if lod < 3 else 0.0)
    return k


def cradle(lod, q):
    k = Kit(pivot='PIVOT__elevation')
    n = seg(64, q, 12)
    prof = [(0.140, -0.020, STEEL), (0.1528, -0.020, STEEL), (0.1535, -0.018, STEEL), (0.1535, 0.018, STEEL),
            (0.1528, 0.020, STEEL), (0.140, 0.020, STEEL)]
    k.lathe(prof, n, LATHE, closed=True)
    for s in (-1, 1):
        k.cyl(0.020, 0.146, CHEEK_IN + 0.004, STEEL, seg(24, q, 8), bev=0.0, m=kit.frame(tuple(T), (0, s, 0)))
    return k


def barrel(lod, q):
    k = Kit(pivot='PIVOT__recoil')
    n = seg(80, q, 12)
    k.lathe(barrel_profile((10, 6, 4, 3)[lod], (4, 3, 2, 1)[lod], lod), n, LATHE)
    # breech plate and cascabel knob
    k.cyl(0.125, 0.0585, 0.068, G, n, bev=0.003 if lod < 3 else 0.0, bseg=max(1, (3, 2, 1, 1)[lod]), bev_bot=0.0,
          m=LATHE @ kit.rot_x(180))
    k.cyl(0.030, 0.066, 0.100, G, seg(32, q, 8), m=LATHE @ kit.rot_x(180))
    k.sphere(0.032, G, seg(32, q, 8), seg(14, q, 4, 2), m=LATHE @ kit.at(0, 0, -0.112))
    # steel iris ring in front of the leaves
    if lod < 3:
        k.lathe(rounded_rect_profile(0.1615, 0.1715, 0.128, 0.136, 0.002 if lod < 2 else 0.0008, (2, 1, 1, 1)[lod],
                                     STEEL), n, LATHE, closed=True)
    # touch-hole boss + fuse stub (FUSE profile Ø 6 mm) rising along the barrel normal
    hole = bl(TOUCH_XL, 0.150)
    k.cyl(0.008, -0.002, 0.004, STEEL, seg(16, q, 6), bev=0.0012 if lod < 2 else 0.0, bseg=1,
          m=kit.frame(tuple(hole), tuple(N)))
    tip = Vector(FUSE_TIP)
    p0 = hole + N * 0.003
    mid = hole + N * 0.009 + Vector((0.0, 0.002, 0.0)) - B * 0.002
    k.sweep([tuple(p0), tuple(mid), tuple(tip)], 0.003, (8, 6, 5, 4)[lod], CORD)
    return k


def ram(lod, q):
    k = Kit(pivot='PIVOT__ram')
    n = seg(56, q, 10)
    k.cyl(0.125, RAM_FACE - 0.008, RAM_FACE - 0.002, STEEL, n, bev=0.0015 if lod < 3 else 0.0, bseg=1, m=LATHE)
    k.cyl(0.085, RAM_FACE - 0.0025, RAM_FACE, RUBBER, n, bev=0.001 if lod < 2 else 0.0, bseg=1, m=LATHE)
    _m2.screw(k, 'M8', tuple(bl(RAM_FACE)), tuple(B), q, lod)
    return k


def flag(lod, q):
    k = Kit(pivot='PIVOT__flag')
    tip = FLAG_H + FLAG_D * 0.085
    k.sweep([tuple(FLAG_H), tuple(tip)], 0.003, (8, 6, 4, 4)[lod], G)
    if lod < 3:
        k.sphere(0.0045, G, seg(12, q, 6), (6, 4, 3, 2)[lod], m=kit.at(*tip))
    # panel: from 45 to 85 mm along the mast, 32 mm tall, 3 mm thick, in the XZ plane
    c = FLAG_H + FLAG_D * 0.065 + FLAG_U * 0.017
    basis = Matrix((FLAG_D, FLAG_U, Vector((0, 1, 0)))).transposed().to_4x4()
    k.rbox((0.040, 0.032, 0.003), (0, 0, 0), 0.004 if lod < 3 else 0.0, G, cseg=(2, 1, 1, 1)[lod],
           rz=0.001 if lod < 2 else 0.0, m=Matrix.Translation(c) @ basis)
    return k


def build(lod, q):
    pieces = {'carriage': carriage(lod, q), 'wheel_l': wheel(lod, q, 1), 'wheel_r': wheel(lod, q, -1),
              'cradle': cradle(lod, q), 'barrel': barrel(lod, q), 'iris': iris_piece(lod, q), 'ram': ram(lod, q), 'flag': flag(lod, q)}
    # Decals: amber/graphite stripe band at mid-barrel (two half wraps, one tile each: 2,156 px/m, 30 mm band),
    # name plate on the front cheek, bone star on the flag, keep-clear pictogram on the trail spade.
    circ_half = math.pi * 0.150
    band_h = 0.030
    v = band_h * (1016.0 / circ_half) / 120.0
    decals = []
    for mid in (N, -N):
        decals.append(kit.decal_cylinder('trim.hazard_r', tuple(bl(0.040)), tuple(B), 0.150, tuple(mid), 0, band_h,
                                         nu=48, span=math.pi, sub=(0.0, 0.0, 1.0, v), lift=0.0004,
                                         pivot='PIVOT__recoil'))
    decals.append(kit.decal_plane('name.big_top.bone', (-0.125, -CHEEK_OUT, 0.112), (0, -1, 0), (0, 0, 1), 0.050,
                                  pivot='PIVOT__carriage'))
    star_c = FLAG_H + FLAG_D * 0.065 + FLAG_U * 0.017 + Vector((0, -0.0015, 0))
    decals.append(kit.decal_plane('mark.star.bone', tuple(star_c), (0, -1, 0), tuple(FLAG_U), 0.024, 0.024,
                                  pivot='PIVOT__flag'))
    decals.append(kit.decal_plane('picto.keep_clear.warn', (-0.265, 0.0, 0.0605), (0, 0, 1), (1, 0, 0), 0.040, 0.040,
                                  pivot='PIVOT__carriage'))
    return kit.add_decals(pieces, lod, decals)


def cyl_pts(r, x0, x1, n=12):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        for x in (x0, x1):
            pts.append(tuple(bl(x, r * math.cos(a), r * math.sin(a))))
    return pts


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'L', '6,4,4', 18.0, 'bottom', 24000,
        'Circus cannon at the default 30° elevation: graphite carriage (cheeks, transom, trail spade), spoked '
        'wheels with rubber tyres, red Ø 0.30 barrel flaring to the Ø 0.36 bell, eight anodised iris leaves in '
        'the bell (open pose, aperture Ø 0.26) behind a steel iris ring, ram pusher plate, touch-hole fuse stub, '
        'loaded flag with the bone star. Brief: docs/art/briefs/boom.md#big-top. Pivots: carriage (ADDED root, z '
        'slide 0..0.01, for the clip hop) > elevation (frame rotated to the barrel: local x = bore, local y = '
        'world -Y so the axis-y angle raises the muzzle; 15..55, rest 30) > recoil (local x = bore, slide '
        '-0.03..0) > ram (slide 0..0.16, rest face barrel-local -0.05); carriage > wheel_l (+Y) / wheel_r (-Y) '
        '(y) and flag (y, 0..80, modelled down). Clip big_top__recoil 0.5 s: carriage hop 10 mm, wheels roll '
        'back 15°, barrel kick -0.03 and return. COL barrel / wheels and SENSOR__catch__bore / the touch-hole '
        'emitters carry a `pivot` prop (they ride recoil / elevation in the engine); the port ring, COL and '
        'emitters do not follow the 10 mm clip hop. Trail spade ends at x -0.295 (brief -0.30) to keep the '
        'bounds centred within 5 mm. Decals: barrel stripe band, name plate, flag star, keep-clear pictogram. '
        'Shape key sk_iris on the iris piece (LOD0/1). Deferred: internal bounce light, 2048 + 1024 detail set, midway skin.',
        MASTERS)
    rot = barrel_rot().to_4x4()
    part.pivot('carriage', (0.0, 0.0, 0.0), 'z', 0.0, 0.01, motion='slide')
    part.pivot('elevation', tuple(T), 'y', 15.0, 55.0, rest=ELEV, motion='turn')
    part.pivot('recoil', tuple(T), 'x', -0.03, 0.0, motion='slide')
    part.pivot('ram', tuple(bl(RAM_FACE)), 'x', 0.0, 0.16, motion='slide')
    part.pivot('wheel_l', (WHEEL_C.x, WHEEL_C.y, WHEEL_C.z), 'y', motion='turn')
    part.pivot('wheel_r', (WHEEL_C.x, -WHEEL_C.y, WHEEL_C.z), 'y', motion='turn')
    part.pivot('flag', tuple(FLAG_H), 'y', 0.0, 80.0, motion='turn')
    for name in ('elevation', 'recoil', 'ram'):
        ob = part.pivots['PIVOT__' + name]
        ob.matrix_world = Matrix.Translation(ob.location.copy()) @ rot
    _m2.nest(part, 'elevation', 'carriage')
    _m2.nest(part, 'recoil', 'elevation')
    _m2.nest(part, 'ram', 'recoil')
    for name in ('wheel_l', 'wheel_r', 'flag'):
        _m2.nest(part, name, 'carriage')
    part.build_lods(build, lod0_q=1.3)
    _m2.clip(part, 'recoil', {
        'carriage': [(0.0, 0.0), (0.05, 0.010), (0.15, 0.0), (0.5, 0.0)],
        'recoil': [(0.0, 0.0), (0.04, -0.03), (0.30, 0.0), (0.5, 0.0)],
        'wheel_l': [(0.0, 0.0), (0.10, -15.0), (0.40, 0.0), (0.5, 0.0)],
        'wheel_r': [(0.0, 0.0), (0.10, -15.0), (0.40, 0.0), (0.5, 0.0)],
    })
    props = dict(phys='powder', restitution=0.2, friction=0.6)
    for s, nm in ((1, 'cheek_l'), (-1, 'cheek_r')):
        part.col_box(nm, (0.365, CHEEK_OUT - CHEEK_IN, 0.19), (-0.0625, s * (CHEEK_IN + CHEEK_OUT) / 2, 0.13), **props)
        w = part.col_cyl('wheel_' + nm[-1], WHEEL_R, TYRE_W, (WHEEL_C.x, s * WHEEL_C.y, WHEEL_C.z), 'y', phys='rubber',
                         restitution=0.3, friction=0.9)
        w['pivot'] = 'wheel_' + nm[-1]
    part.col_box('trail', (0.090, 2 * CHEEK_IN + 0.002, 0.135), (-0.250, 0.0, 0.0675), **props)
    bcol = part.col_cyl('barrel', 0.150, 0.22, tuple(bl(0.05)), tuple(B), **props)
    bcol['pivot'] = 'recoil'
    part.port('heat', 'fuse', PORT, (0, -1, 0), 'L', 'in')
    part.sensor('catch', 'bore', cyl_pts(0.135, -0.05, 0.16), max_rollers=1, max_marbles=12, pivot='recoil')
    for fx, name, loc, d in (('spark', 'fuse_tip', FUSE_TIP, N), ('smoke', 'touch_hole', (-0.03, 0.0, 0.30), N),
                             ('muzzle', 'barrel', tuple(bl(0.16)), B)):
        e = part.emit(fx, name, loc, tuple(d))
        e['pivot'] = 'recoil'
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
