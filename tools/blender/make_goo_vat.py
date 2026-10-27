"""Procedurally build the GOO VAT source file (docs/art/briefs/matter.md, "GOO VAT: Slime dispenser"). Art only: the
goo Matter, the emitter flow and the sim are the held X5 stream's; the fill pass reads CAVITY__goo.

Usage: blender -b --factory-startup -P tools/blender/make_goo_vat.py -- [out.blend]
Default output: assets/src/matter/goo_vat.blend

A squat kn_poly_clear vat (Ø 0.26, 4 mm wall, z 0.06-0.26) on a kn_powder_graphite plinth (rounded square 0.282, 30 mm
corners, z 0.004-0.06, FOOT_M, flat front face at y -0.141 carrying the PR-M signal `open` port, the SCR_BAR_10 level
bar and the name plate), under a graphite lid ring (z 0.26-0.29) with a lid hatch (the intake, r 0.035 at y 0.06)
and the kn_powder_beam stirrer motor pod (Ø 0.06, z 0.29-0.30). A kn_steel_brushed whisk stirrer (shaft + four bent
paddle loops, z 0.08-0.26) turns on PIVOT__stirrer (z, continuous) and stays visible through the front at every
level. Front low: a kn_anod_beam valve block with a wide duckbill nozzle (40 x 12 mm lip, 30° down, tip at y -0.152,
z 0.08) and the valve lever on PIVOT__valve_lever (x, 0-90°); valve_open LED_D6 (group 0) on the lid ring front.
CAVITY__goo (matter goo, capacity 9 L, ≈ 9.1 L inset 3.5 mm) for the fill pass. Slime green belongs to this part.
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
import _m5  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'goo_vat'
G, BEAM_P, BEAM_A, CLEAR, STEEL, RUBBER, LED, SCREEN, GLASS = (
    'kn_powder_graphite', 'kn_powder_beam', 'kn_anod_beam', 'kn_poly_clear', 'kn_steel_brushed', 'kn_rubber',
    'kn_led', 'kn_screen', 'kn_glass')
MASTERS = [G, BEAM_P, BEAM_A, CLEAR, STEEL, RUBBER, LED, SCREEN, GLASS, 'kn_slime', 'kn_decal']
PL_W, PL_D, PL_R, PL_Z0, PL_Z1 = 0.282, 0.280, 0.030, 0.004, 0.060
FRONT = -PL_D / 2
V_RO, V_RI, V_Z0, V_Z1 = 0.130, 0.126, 0.060, 0.260
LID_Z0, LID_Z1 = 0.260, 0.290
POD_R, POD_Z1 = 0.030, 0.300
HATCH = (0.0, 0.060)
PORT = (0.075, -0.14, 0.032)
SCR_C, SCR_W, SCR_H = Vector((-0.07, -0.140, 0.032)), 0.056, 0.014
NOZ_TIP = Vector((0.0, -0.152, 0.080))
NOZ_D = Vector((0.0, -math.cos(math.radians(30)), -math.sin(math.radians(30))))
VALVE_C = Vector((0.0, -0.136, 0.094))
LEVER = Vector((0.0, -0.141, 0.112))


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(64, q, 12, 4)
    body = Kit()
    # plinth: rounded square, flat front face
    body.rbox((PL_W, PL_D, PL_Z1 - PL_Z0), (0, 0, (PL_Z0 + PL_Z1) / 2), PL_R if lod < 3 else 0.02, G,
              cseg=max(2, cs + 1) if lod < 3 else 2, rz=0.005 if lod < 3 else 0.0)
    if lod < 3:  # rear refill boss (balances the nozzle in the static bounds)
        body.cyl(0.010, -0.002, 0.007, G, seg(16, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame((0, PL_D / 2, 0.032), (0, 1, 0)))
    else:
        body.cyl(0.010, -0.002, 0.007, G, 6, m=kit.frame((0, PL_D / 2, 0.032), (0, 1, 0)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.105, sy * 0.105, min(1.0, q), lod)
    # lid ring with a hatch opening, M5 screws, the motor pod
    lid = Kit()
    prof = [(0.0, LID_Z0 - 0.003, G), (V_RO + 0.004, LID_Z0 - 0.003, G)]
    b = 0.004 if lod < 3 else 0.0
    if b:
        for k in range(cs + 1):
            a = math.pi / 2 * k / cs
            prof.append((V_RO + 0.004 - b + b * math.cos(a), LID_Z1 - b + b * math.sin(a), G))
    else:
        prof.append((V_RO + 0.004, LID_Z1, G))
    prof.append((0.0, LID_Z1, G))
    lid.lathe(kit.dedupe(prof), n)
    hatch = Kit()
    hatch.cyl(0.030, LID_Z1 - 0.012, LID_Z1 + 0.01, G, seg(28, q, 8), m=kit.at(HATCH[0], HATCH[1], 0))
    lid = kit.boolean_diff(lid, [hatch], mats)
    body.merge(lid)
    lid.free()
    if lod < 3:  # hatch flap hinged at the back, a steel grate in the hole
        body.cyl(0.0285, LID_Z1 - 0.0110, LID_Z1 - 0.0095, STEEL, seg(28, q, 8), m=kit.at(HATCH[0], HATCH[1], 0))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        _m2.screw(body, 'M5', (0.112 * math.cos(a), 0.112 * math.sin(a), LID_Z1), (0, 0, 1), q, lod)
    body.cyl(POD_R, LID_Z1 - 0.001, POD_Z1, BEAM_P, seg(36, q, 8), bev=0.004 if lod < 3 else 0.0, bseg=cs,
             bev_bot=0.0)
    _m2.led_dome(body, 6, (0.0, -(V_RO + 0.004), (LID_Z0 + LID_Z1) / 2), (0, -1, 0), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # valve block on the front wall, duckbill nozzle, a beam collar where it meets the vat
    body.rbox((0.034, 0.016, 0.040), tuple(VALVE_C), 0.006 if lod < 3 else 0.0, BEAM_A, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    nz0 = NOZ_TIP - NOZ_D * 0.022
    nm = kit.frame(tuple(nz0), tuple(NOZ_D))
    if lod < 3:
        # lofted duckbill: round root -> wide flat lip (40 x 12 mm)
        ns = seg(24, q, 8, 4)
        rings = []
        for i, t in enumerate((0.0, 0.35, 0.7, 1.0)):
            w = 0.010 + (0.020 - 0.010) * t
            h = 0.010 + (0.006 - 0.010) * t
            pts = _m4.superellipse(w, h, 2.0 + 2.0 * t, ns)
            rings.append(_m4.ring(pts, 0.022 * t))
        _m4.loft(body, rings, BEAM_A, m=nm)
    else:
        body.rbox((0.040, 0.012, 0.022), (0, 0, 0.011), 0.0, BEAM_A, cseg=1, m=nm)
    # the clear vat: one closed hollow tube; LOD3 a solid
    shell = Kit()
    if lod < 3:
        shell.lathe([(V_RI, V_Z0 - 0.002, CLEAR), (V_RO, V_Z0 - 0.002, CLEAR), (V_RO, V_Z1 + 0.002, CLEAR),
                     (V_RI, V_Z1 + 0.002, CLEAR)], n, closed=True)
    else:
        shell.cyl(V_RO, V_Z0 - 0.002, V_Z1 + 0.002, CLEAR, n)
    # stirrer: shaft + four bent paddle loops (a whisk), steel
    stir = Kit(pivot='PIVOT__stirrer')
    stir.cyl(0.005, 0.075, LID_Z0 + 0.002, STEEL, seg(14, q, 6))
    if lod < 3:
        sides = (8, 6, 4)[lod]
        sub = (6, 4, 2)[lod]
        for k in range(4):
            a = math.radians(90 * k + 20)
            ca, sa = math.cos(a), math.sin(a)
            loop = _m4.smooth_path([(0.004, 0.0, 0.082), (0.060, 0.0, 0.090), (0.092, 0.0, 0.130),
                                    (0.092, 0.0, 0.200), (0.060, 0.0, 0.238), (0.004, 0.0, 0.245)], sub)
            pts = [(x * ca - y * sa, x * sa + y * ca, z) for x, y, z in loop]
            stir.sweep(pts, 0.0028, sides, STEEL)
            # a paddle blade on each loop
            stir.rbox((0.030, 0.003, 0.040), (0.074, 0, 0.165), 0.0012 if lod < 2 else 0.0, STEEL, cseg=1,
                      m=kit.rot_z(math.degrees(a)), rz=0.0012 if lod < 2 else 0.0)
    lever = Kit(pivot='PIVOT__valve_lever')
    lever.cyl(0.004, -0.019, 0.019, BEAM_A, seg(12, q, 6), m=kit.frame(tuple(LEVER), (1, 0, 0)))
    if lod < 3:
        lever.sweep([tuple(LEVER + Vector((0.016, 0, 0))), tuple(LEVER + Vector((0.016, -0.004, 0.024)))], 0.0032,
                    (10, 8, 6)[lod], BEAM_A)
        knob = LEVER + Vector((0.016, -0.0045, 0.026))
        lever.sphere(0.0058, BEAM_A, seg(14, q, 6), (6, 4, 3)[lod], m=kit.at(*knob))
    n_out, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C), tuple(n_out), tuple(up), lod, q,
                                     depth=0.003))
    else:
        sc = SCR_C + n_out * 0.0015
    pieces = {'body': body, 'shell': shell, 'stirrer': stir, 'valve_lever': lever,
              'screen_level': kit.screen_quad(tuple(sc), tuple(n_out), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.goo_vat.bone', (0.005, FRONT, 0.020), (0, -1, 0), (0, 0, 1), 0.052),
        kit.decal_plane('trim.marks_m5', (0.070, -0.045, LID_Z1), (0, 0, 1), (0, 1, 0), 0.022, 0.021,
                        sub=_m5.marks5('goo_drop')),
    ])


def cavity(part):
    r, z0, z1 = V_RI - 0.0035, V_Z0 + 0.0035, V_Z1 - 0.0035
    k = Kit()
    k.lathe([(0.0, z0, 'x'), (r, z0, 'x'), (r, z1, 'x'), (0.0, z1, 'x')], 64)
    return _m4.cavity(part, 'goo', k, 'goo', capacity=9.0)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '3,3,3', 6.0, 'bottom', 7500,
        'Slime dispenser: kn_poly_clear vat (Ø 0.26, 4 mm wall, z 0.06-0.26) on a kn_powder_graphite plinth (0.282 '
        'rounded square, 30 mm corners, z 0.004-0.06, FOOT_M; front: PR-M signal open, SCR_BAR_10 level bar (fluid), '
        'name plate; rear refill boss), graphite lid ring (z 0.26-0.29, 4 M5) with the intake hatch (r 0.035 at y '
        '0.06, steel grate) and the kn_powder_beam motor pod (Ø 0.06, z 0.29-0.30). kn_steel_brushed whisk stirrer on '
        'PIVOT__stirrer (z), kn_anod_beam valve block + duckbill nozzle (40 x 12 lip, 30° down, tip y -0.152 z 0.08) '
        'and lever on PIVOT__valve_lever (x, 0-90°); valve_open LED_D6 (group 0) on the lid front. CAVITY__goo (goo, '
        '9 L capacity, fill LUT baked at export; kn_slime fallback). Art only: X5 holds the goo sim. '
        'Brief: docs/art/briefs/matter.md#goo-vat.',
        MASTERS, led_groups='0:valve_open', skins='classic,lab')
    part.pivot('stirrer', (0, 0, 0.17), 'z', motion='turn')
    part.pivot('valve_lever', tuple(LEVER), 'x', 0.0, 90.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('plinth', (0.28, 0.28, 0.06), (0, 0, 0.03), phys='powder', restitution=0.2, friction=0.5)
    part.col_cyl('vat', V_RO, LID_Z1 - V_Z0, (0, 0, (V_Z0 + LID_Z1) / 2), 'z', phys='glass', restitution=0.2,
                 friction=0.4)
    part.col_box('nozzle', (0.040, 0.026, 0.044), (0, -0.138, 0.090), phys='powder')
    part.sensor('intake', 'lid', _m4.cyl_points(0.035, 0.27, 0.30, 16, cx=HATCH[0], cy=HATCH[1]))
    part.port('signal', 'open', PORT, (0, -1, 0), 'M', 'in')
    part.emit('spout', 'nozzle', tuple(NOZ_TIP), tuple(NOZ_D))
    part.emit('bubble', 'surface', (0, 0, V_Z1 - 0.0035), (0, 0, 1))
    part.screen('level', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.0017, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=10, color='fluid')
    cavity(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
