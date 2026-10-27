"""Procedurally build the TANK source file (docs/art/briefs/matter.md, "TANK: Water tank and valve").

Usage: blender -b --factory-startup -P tools/blender/make_tank.py -- [out.blend]
Default output: assets/src/matter/tank.blend

A kn_poly_clear cylinder (Ø 0.26, 4 mm wall, z 0.054-0.37) strapped by two kn_powder_beam bands (z 0.12, 0.29) on
a kn_powder_graphite plinth (r 0.14, z 0.004-0.054 on FOOT_M, flat front land at y -0.122 carrying the PR-M signal
`open` ring and the SCR_BAR_10 level bar), a graphite top cap with a Ø 0.12 funnel intake over a kn_steel_brushed
strainer, and a front valve: graphite body, kn_powder_beam Ø 0.03 spout tilted 15° down, kn_anod_beam Ø 0.06
handwheel on PIVOT__handwheel (z, 0-270°). CAVITY__water (matter water, 15 L) for the fill pass, inset 3.5 mm.
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

TYPE = 'tank'
G, BEAM, ABEAM, CLEAR, STEEL, RUBBER, LED, SCREEN = (
    'kn_powder_graphite', 'kn_powder_beam', 'kn_anod_beam', 'kn_poly_clear', 'kn_steel_brushed', 'kn_rubber',
    'kn_led', 'kn_screen')
MASTERS = [G, BEAM, ABEAM, CLEAR, STEEL, RUBBER, LED, SCREEN, 'kn_glass', 'kn_poly_beam']
PL_R, PL_Z0, PL_Z1, FLAT_Y = 0.14, 0.004, 0.054, -0.122
T_RO, T_RI, T_Z0, T_Z1 = 0.13, 0.126, 0.054, 0.37
CAP_Z0, CAP_Z1 = 0.366, 0.40
STRAPS = (0.12, 0.29)
PORT = (0.04, FLAT_Y, 0.029)
SCR_C, SCR_W, SCR_H = Vector((-0.035, FLAT_Y, 0.029)), 0.056, 0.014
VALVE_C, VALVE_S = Vector((0.0, -0.1393, 0.075)), (0.036, 0.0155, 0.040)
WHEEL = Vector((0.0, -0.14, 0.10))
SPOUT_TIP = Vector((0.0, -0.152, 0.065))
SPOUT_D = Vector((0.0, -math.cos(math.radians(15)), -math.sin(math.radians(15))))
LED_C = (VALVE_S[0] / 2 + VALVE_C.x, VALVE_C.y, 0.078)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(64, q, 8, 4)
    body = Kit()
    # plinth with the flat front land
    body.prism(kit.outline_circle_flat(PL_R, n, FLAT_Y), PL_Z0 - 0.0004, PL_Z1, G,
               bt=0.004 if lod < 3 else 0.0, bseg=cs)
    if lod < 3:
        body.cyl(0.006, -0.011, 0.0045, G, seg(16, q, 6), m=kit.frame((0, PL_R + 0.005, 0.029), "y"))  # rear drain boss
    else:
        body.cyl(0.006, -0.011, 0.0045, G, 6, m=kit.frame((0, PL_R + 0.005, 0.029), "y"))
    for i in range(4):
        a = math.radians(45 + 90 * i)
        _m2.foot(body, 'M', 0.10 * math.cos(a), 0.10 * math.sin(a), min(1.0, q), lod)
    # top cap with the funnel intake
    if lod < 3:
        cap = [(0.0, CAP_Z0), (0.133, CAP_Z0), (0.136, CAP_Z0 + 0.003)]
        for k in range(cs + 1):  # rounded outer top rim, r 4 mm
            a = math.pi / 2 * k / cs
            cap.append((0.132 + 0.004 * math.cos(a), CAP_Z1 - 0.004 + 0.004 * math.sin(a)))
        cap += [(0.066, CAP_Z1), (0.061, CAP_Z1 - 0.004), (0.036, 0.381), (0.0, 0.381)]
    else:
        cap = [(0.0, CAP_Z0), (0.136, CAP_Z0), (0.136, CAP_Z1), (0.06, CAP_Z1), (0.0, 0.385)]
    body.lathe(kit.dedupe([(r, z, G) for r, z in cap]), n)
    # straps
    for z in STRAPS:
        prof = [(T_RO - 0.0005, z - 0.007), (0.1335, z - 0.007), (0.1345, z - 0.006), (0.1345, z + 0.006),
                (0.1335, z + 0.007), (T_RO - 0.0005, z + 0.007)] if lod < 3 else \
            [(T_RO - 0.0005, z - 0.007), (0.1345, z - 0.007), (0.1345, z + 0.007), (T_RO - 0.0005, z + 0.007)]
        body.lathe([(r, zz, BEAM) for r, zz in prof], n, closed=True)
        for sx in (-1, 1):  # buckles left and right
            if lod < 3:
                body.rbox((0.009, 0.026, 0.017), (sx * 0.138, 0, z), 0.002 if lod < 2 else 0.0, BEAM, cseg=1,
                          rz=0.0015 if lod < 2 else 0.0)
            for s in (-1, 1):
                _m2.screw(body, 'M5', (sx * 0.1425, s * 0.007, z), (sx, 0, 0), q, lod)
    for i in range(4):
        a = math.radians(45 + 90 * i)
        _m2.screw(body, 'M5', (0.10 * math.cos(a), 0.10 * math.sin(a), CAP_Z1), (0, 0, 1), q, lod)
    # valve body (its back face against the tube) and the short spout
    body.rbox(VALVE_S, tuple(VALVE_C), 0.005 if lod < 3 else 0.0, G, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    start = SPOUT_TIP - SPOUT_D * 0.010
    body.cyl(0.015, 0.0, 0.010, BEAM, seg(28, q, 8), bev=0.002 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
             cap=G if lod < 3 else BEAM, m=kit.frame(tuple(start), tuple(SPOUT_D)))
    body.cyl(0.0035, VALVE_C.z + VALVE_S[2] / 2 - 0.001, WHEEL.z - 0.003, STEEL, seg(12, q, 6),
             m=kit.at(WHEEL.x, WHEEL.y, 0))
    _m2.led_dome(body, 6, LED_C, (1, 0, 0), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # screen bezel on the flat land
    n_out, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C), tuple(n_out), tuple(up), lod, q,
                                     depth=0.004))
    else:
        sc = SCR_C + n_out * 0.0025
    # the clear tank: one closed hollow tube (LOD3: a solid, opaque-ready)
    shell = Kit()
    if lod < 3:
        shell.lathe([(T_RI, T_Z0 - 0.002, CLEAR), (T_RO, T_Z0 - 0.002, CLEAR), (T_RO, T_Z1 + 0.002, CLEAR),
                     (T_RI, T_Z1 + 0.002, CLEAR)], n, closed=True)
    else:
        shell.cyl(T_RO, T_Z0 - 0.002, T_Z1 + 0.002, CLEAR, n)
    if lod < 2:  # steel strainer in the funnel throat
        body.cyl(0.0355, 0.3805, 0.3822, STEEL, seg(32, q, 8))
    wheel = Kit(pivot='PIVOT__handwheel')
    nw = seg(36, q, 8)
    if lod < 2:
        wheel.torus(0.026, 0.0042, ABEAM, nw, (8, 6)[lod], m=kit.at(*WHEEL))
        for k in range(3):
            a = math.radians(90 + 120 * k)
            d = Vector((math.cos(a), math.sin(a), 0))
            wheel.sweep([WHEEL + d * 0.006, WHEEL + d * 0.024], 0.0022, (6, 5)[lod], ABEAM)
        wheel.cyl(0.0075, WHEEL.z - 0.004, WHEEL.z + 0.005, ABEAM, seg(16, q, 6), bev=0.0015, bseg=1,
                  m=kit.at(WHEEL.x, WHEEL.y, 0))
        hp = WHEEL + Vector((0.026, 0.0, 0.0))
        wheel.cyl(0.0035, 0.0, 0.012, ABEAM, seg(10, q, 6), bev=0.0015, bseg=1, bev_bot=0.0, m=kit.frame(tuple(hp)))
    else:
        wheel.cyl(0.030, WHEEL.z - 0.004, WHEEL.z + 0.004, ABEAM, seg(16, q, 6), m=kit.at(WHEEL.x, WHEEL.y, 0))
    pieces = {'body': body, 'shell': shell, 'handwheel': wheel,
              'screen_level': kit.screen_quad(tuple(sc), tuple(n_out), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('name.tank.bone', (0, 0, 0.029), (0, 0, 1), PL_R, (0, 1, 0), 0.075, lift=0.0004),
        kit.decal_plane('trim.marks_m4', (0.0, 0.098, CAP_Z1), (0, 0, 1), (0, 1, 0), 0.022, 0.022,
                        sub=_m4.marks4('drop')),
    ])


def cavity(part):
    r, z0, z1 = T_RI - 0.0035, PL_Z1 + 0.0035, CAP_Z0 - 0.0035
    k = Kit()
    k.lathe([(0.0, z0, 'x'), (r, z0, 'x'), (r, z1, 'x'), (0.0, z1, 'x')], 64)
    return _m4.cavity(part, 'water', k, 'water', capacity=15.0)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '3,4,3', 5.0, 'bottom', 7000,
        'Water tank and valve: kn_poly_clear tube (Ø 0.26, 4 mm wall, z 0.054-0.37) with kn_powder_beam strap bands '
        '(z 0.12 / 0.29, M5 buckles) on a kn_powder_graphite plinth (r 0.14 on FOOT_M, flat front land y -0.122: PR-M '
        'signal `open`, SCR_BAR_10 level bar); graphite top cap, Ø 0.12 funnel intake over a steel strainer; front '
        'valve with a beam Ø 0.03 spout (15° down) and the kn_anod_beam handwheel on PIVOT__handwheel (z, 0-270°); '
        'valve_open LED_D6 (group 0) on the valve flank. CAVITY__water (15 L, fill LUT baked at export). A rear drain '
        'boss balances the static bounds (kn_bounds = origin: the handwheel is judged out). '
        'Brief: docs/art/briefs/matter.md#tank.',
        MASTERS, led_groups='0:valve_open', skins='classic,lab', pipeline={'kn_bounds': 'origin'})
    part.pivot('handwheel', tuple(WHEEL), 'z', 0.0, 270.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_cyl('tank', T_RO, CAP_Z1 - T_Z0, (0, 0, (CAP_Z1 + T_Z0) / 2), 'z', phys='glass', restitution=0.2,
                 friction=0.4)
    part.col_cyl('plinth', PL_R, PL_Z1, (0, 0, PL_Z1 / 2), 'z', phys='powder', restitution=0.2, friction=0.5)
    part.col_box('valve', VALVE_S, tuple(VALVE_C), phys='powder')
    part.sensor('intake', 'top', _m4.cyl_points(0.06, 0.37, 0.40, 16))
    part.port('signal', 'open', PORT, (0, -1, 0), 'M', 'in')
    part.emit('spout', 'valve', tuple(SPOUT_TIP), tuple(SPOUT_D))
    part.emit('drip', 'valve', tuple(SPOUT_TIP), tuple(SPOUT_D))
    part.screen('level', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.0025, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=10, color='fluid')
    cavity(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
