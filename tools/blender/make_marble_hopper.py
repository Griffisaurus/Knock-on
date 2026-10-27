"""Procedurally build the MARBLE HOPPER source file (docs/art/briefs/matter.md, "MARBLE HOPPER: Gumball-style
marble dispenser").

Usage: blender -b --factory-startup -P tools/blender/make_marble_hopper.py -- [out.blend]
Default output: assets/src/matter/marble_hopper.blend

A kn_poly_clear globe (Ø 0.26, centre z 0.27, 3 mm wall, open at the collar and the lid) on a kn_powder_bone
pedestal: a pillowed frustum (0.28 -> 0.18 square, z 0-0.15) whose sloped front carries the SCR_7SEG_6 counter
(beam), the flowing LED_D6, the PR-M signal `open` ring flat on the slope (normal (0, -0.95, 0.32)) and a clear
window onto the kn_anod_beam star-wheel (6 pockets) on PIVOT__feed_wheel (y). A kn_powder_beam neck collar and lid
cap, an anod beam chute (20° down) with its flap on PIVOT__chute_flap (x, 0-60°). CAVITY__marbles (matter marble,
capacity property 100k) for the fill pass.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'marble_hopper'
BONE, BEAM, ABEAM, CLEAR, STEEL, RUBBER, LED, SCREEN = (
    'kn_powder_bone', 'kn_powder_beam', 'kn_anod_beam', 'kn_poly_clear', 'kn_steel_brushed', 'kn_rubber', 'kn_led',
    'kn_screen')
MASTERS = [BONE, BEAM, ABEAM, CLEAR, STEEL, RUBBER, LED, SCREEN, 'kn_glass', 'kn_powder_graphite']
GC, GR, GW = Vector((0.0, 0.0, 0.27)), 0.13, 0.003
PED_Z1, COLLAR_Z1 = 0.14, 0.15
SLOPE_N = Vector((0.0, -1.0, 1.0 / 3.0)).normalized()   # the 0.28 -> 0.18 frustum over 0.15 m: dy/dz = 1/3
SLOPE_U = Vector((0.0, 1.0 / 3.0, 1.0)).normalized()    # up the slope
PORT = (0.07, -0.115, 0.075)
SCR_C, SCR_W, SCR_H = Vector((0.0, -0.095, 0.135)), 0.064, 0.020
WIN_C, WIN_S = Vector((-0.04, -0.11, 0.09)), 0.06
WHEEL_C = WIN_C - SLOPE_N * 0.017
CHUTE_P = Vector((0.0, -0.14, 0.05))
CHUTE_D = Vector((0.0, -math.cos(math.radians(20)), -math.sin(math.radians(20))))
FLAP_P = Vector((0.0, -0.1445, 0.0605))


def half(z):
    """Pedestal half-width at height z (0.14 at the floor, 0.09 at z 0.15)."""
    return 0.14 - z / 3.0


def pedestal(k, lod, q):
    cs = (4, 3, 2, 1)[lod]
    pts = []
    for z, r in ((0.004, 0.022), (0.010, 0.022), (PED_Z1, 0.015)):
        h = 0.1405 if z == 0.004 else half(z)
        pts += [(x, y, z) for x, y in kit.outline_rrect(2 * h, 2 * h, r, cs)]
    k.hull(pts, BONE)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(56, q, 8, 4)
    body = Kit()
    pedestal(body, lod, q)
    # window pocket + star-wheel bay
    if lod < 3:
        cut = Kit()
        frm = Matrix.Translation(WIN_C) @ Matrix(((1, 0, 0, 0), (0, SLOPE_U.y, SLOPE_N.y, 0),
                                                  (0, SLOPE_U.z, SLOPE_N.z, 0), (0, 0, 0, 1)))
        cut.rbox((WIN_S, WIN_S, 0.05), (0, 0, -0.005), 0.006, BONE, cseg=2, rz=0.0, m=frm)
        body = kit.boolean_diff(body, [cut], mats)
        pane = Kit()
        pane.rbox((WIN_S - 0.001, WIN_S - 0.001, 0.002), (0, 0, -0.0025), 0.0055, CLEAR, cseg=2, rz=0.0, m=frm)
    else:
        pane = Kit()
    # neck collar (beam), lid cap, M5 screws
    co = [(x, y, PED_Z1 - 0.001) for x, y in kit.outline_rrect(2 * half(PED_Z1), 2 * half(PED_Z1), 0.015, cs)]
    co += [(x, y, COLLAR_Z1) for x, y in kit.outline_rrect(2 * half(COLLAR_Z1), 2 * half(COLLAR_Z1), 0.014, cs)]
    body.hull(co, BEAM)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.screw(body, 'M5', (sx * 0.072, sy * 0.072, COLLAR_Z1), (0, 0, 1), q, lod)
    body.cyl(0.052, 0.384, 0.397, BEAM, n, bev=0.004 if lod < 3 else 0.0, bseg=cs, bev_bot=0.0)
    body.sphere(0.012, BEAM, seg(16, q, 6), seg(6, q, 3), m=kit.at(0, 0, 0.397), sz_bot=0.1, sz_top=0.45)
    # feet
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.11, sy * 0.11, min(1.0, q), lod)
    # counter bezel on the slope, LED, port land
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C), tuple(SLOPE_N), tuple(SLOPE_U), lod, q,
                                     depth=0.004))
    else:
        sc = SCR_C + SLOPE_N * 0.0025
    _m2.led_dome(body, 6, (0.054, -half(0.135), 0.135), tuple(SLOPE_N), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    _m2.land(body, 'M', PORT, tuple(SLOPE_N), 0.002, lod, mat=BONE)
    # chute (anod beam U-channel, 20° down) out of the pedestal front
    chute = Kit()
    side = Vector((1, 0, 0))
    upc = side.cross(CHUTE_D).normalized()
    if upc.z < 0:
        upc = -upc
    basis = Matrix((tuple(side), tuple(-CHUTE_D), tuple(upc))).transposed()
    start = CHUTE_P - CHUTE_D * 0.002
    L = 0.034
    for off, size in (((0, 0, -0.0072), (0.032, L, 0.003)), ((-0.0145, 0, 0.0), (0.003, L, 0.016)),
                      ((0.0145, 0, 0.0), (0.003, L, 0.016))):
        c = start + basis @ Vector((off[0], L / 2, off[2]))
        m = Matrix.Translation(c) @ basis.to_4x4()
        chute.rbox(size, (0, 0, 0), 0.0, ABEAM, cseg=1, m=m)
    body.merge(chute)
    chute.free()
    flap = Kit(pivot='PIVOT__chute_flap')
    flap.rbox((0.030, 0.002, 0.016), (FLAP_P.x, FLAP_P.y - 0.0012, FLAP_P.z - 0.008), 0.0015 if lod < 2 else 0.0,
              ABEAM, cseg=1)
    if lod < 3:
        flap.cyl(0.0018, -0.016, 0.016, ABEAM, seg(8, q, 4), m=kit.frame(tuple(FLAP_P), 'x'))
    # star-wheel behind the window
    wheel = Kit(pivot='PIVOT__feed_wheel')
    if lod < 3:
        m = 6
        npts = seg(48, q, 12, 6)
        pts = []
        for i in range(npts):
            a = 2 * math.pi * i / npts
            ph = (a * m / (2 * math.pi)) % 1.0
            dip = max(0.0, math.cos((ph - 0.5) * math.pi * 2.2)) if abs(ph - 0.5) < 0.4 else 0.0
            r = 0.022 - 0.008 * dip
            pts.append((r * math.cos(a), r * math.sin(a)))
        wheel.prism(pts, -0.004, 0.004, ABEAM, bt=0.0008 if lod < 2 else 0.0, bb=0.0008 if lod < 2 else 0.0, bseg=1,
                    m=kit.frame(tuple(WHEEL_C), (0, -1, 0)))
        wheel.cyl(0.006, -0.006, 0.006, STEEL, seg(12, q, 6), m=kit.frame(tuple(WHEEL_C), (0, -1, 0)))
    else:
        wheel.cyl(0.020, -0.004, 0.004, ABEAM, 6, m=kit.frame(tuple(WHEEL_C), (0, -1, 0)))
    # the globe: one closed hollow shell between the collar opening and the lid opening
    globe = Kit()
    zb, zt = 0.147, 0.388
    a0, a1 = math.asin((zb - GC.z) / GR), math.asin((zt - GC.z) / GR)
    rings = (14, 10, 7, 5)[lod]
    outer = [(GR * math.cos(a0 + (a1 - a0) * i / rings), GC.z + GR * math.sin(a0 + (a1 - a0) * i / rings))
             for i in range(rings + 1)]
    if lod < 3:
        ri = GR - GW
        b0, b1 = math.asin((zb - GC.z) / ri), math.asin((zt - GC.z) / ri)
        inner = [(ri * math.cos(b0 + (b1 - b0) * i / rings), GC.z + ri * math.sin(b0 + (b1 - b0) * i / rings))
                 for i in range(rings + 1)]
        globe.lathe([(r, z, CLEAR) for r, z in outer] + [(r, z, CLEAR) for r, z in reversed(inner)], n, closed=True)
    else:
        globe.lathe([(0.0, zb, CLEAR)] + [(r, z, CLEAR) for r, z in outer] + [(0.0, zt, CLEAR)], n)
    pieces = {'body': body, 'globe': globe, 'window': pane, 'feed_wheel': wheel, 'chute_flap': flap,
              'screen_count': kit.screen_quad(tuple(sc), tuple(SLOPE_N), tuple(SLOPE_U), SCR_W, SCR_H, lift=0.0002)}
    side_n = Vector((-1.0, 0.0, 1.0 / 3.0)).normalized()
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.marble_hopper.graphite', (-half(0.07), 0.0, 0.07), tuple(side_n),
                        tuple(Vector((1.0 / 3.0, 0, 1.0)).normalized()), 0.12, lift=0.0006),
    ])


def cavity(part):
    ri = GR - GW - 0.0035
    zb, zt = 0.152, 0.383
    a0, a1 = math.asin((zb - GC.z) / ri), math.asin((zt - GC.z) / ri)
    prof = [(0.0, zb, 'x')] + [(ri * math.cos(a0 + (a1 - a0) * i / 24), GC.z + ri * math.sin(a0 + (a1 - a0) * i / 24),
                                'x') for i in range(25)] + [(0.0, zt, 'x')]
    k = Kit()
    k.lathe(prof, 48)
    return _m4.cavity(part, 'marbles', k, 'marble', capacity=100000)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '3,4,3', 6.0, 'bottom', 8500,
        'Gumball-style marble dispenser: kn_poly_clear globe (Ø 0.26, centre z 0.27, 3 mm wall) on a kn_powder_bone '
        'pillowed frustum pedestal (0.28 -> 0.18 square, z 0-0.15, FOOT_M) with a kn_powder_beam neck collar and lid '
        'cap; sloped front: SCR_7SEG_6 counter (beam), flowing LED_D6 (group 0), PR-M signal `open` on a land flat on '
        'the slope, clear window onto the kn_anod_beam 6-pocket star-wheel (PIVOT__feed_wheel, y, continuous); anod '
        'beam chute (20° down) with its flap on PIVOT__chute_flap (x, 0-60°). CAVITY__marbles (capacity property '
        '100k; above the 2.7k the globe physically holds, the fill shows the fraction). No coin slot, no gumball '
        'colours. kn_bounds = origin (the flap is judged out). Brief: docs/art/briefs/matter.md#marble-hopper.',
        MASTERS, led_groups='0:flowing', skins='classic,arcade', pipeline={'kn_bounds': 'origin'})
    part.pivot('feed_wheel', tuple(WHEEL_C), 'y')
    part.pivot('chute_flap', tuple(FLAP_P), 'x', 0.0, 60.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.4)
    pts = []
    for z in (0.0, 0.15):
        h = half(z)
        pts += [(x * h, y * h, z) for x in (-1, 1) for y in (-1, 1)]
    part.col_hull('pedestal', pts, phys='powder', restitution=0.2, friction=0.5)
    part.col_sphere('globe', GR, tuple(GC), phys='glass', restitution=0.2, friction=0.4)
    part.sensor('intake', 'top', _m4.cyl_points(0.045, 0.385, 0.415, 16))
    part.port('signal', 'open', PORT, tuple(SLOPE_N), 'M', 'in')
    part.emit('spout', 'chute', tuple(CHUTE_P), tuple(CHUTE_D))
    part.screen('count', SCR_W, SCR_H, tuple(SCR_C + SLOPE_N * 0.0025), tuple(SLOPE_N), tuple(SLOPE_U), kind='7seg',
                digits=6, color='beam')
    cavity(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
