"""Procedurally build the INFLATOR source file (docs/art/briefs/air.md, "INFLATOR: Helium tank").

Usage: blender -b --factory-startup -P tools/blender/make_inflator.py -- [out.blend]
Default output: assets/src/air/inflator.blend

A chunky toy gas bottle: a kn_powder_bone tank (Ø 0.13, z 0.02-0.22, dome to 0.245) standing in a bone cradle ring
(Ø 0.19 x 0.036, FOOT_S, M5 screws; front facet + land for the PR-S signal `in` ring at z 0.019), a kn_powder_beam
shoulder band (z 0.19-0.215) and valve guard ring (to z 0.30), a kn_brass valve (z 0.245-0.27) with its knob on
PIVOT__valve_knob (z, 0-90°), a brass needle gauge (bone dial decal Volt -> Amber band, kn_glass cover) with the
needle on PIVOT__gauge_needle (y, -135...+135°), the air-colour filling LED and the amber over-pressure LED on the
valve front, and a fixed sculpted kn_rubber curly hose (Ø 8 mm) to the kn_steel_brushed filler nozzle whose PR-S
air `fill` port faces +Z at (0.08, -0.02, 0.285), clear of the guard ring. No real gas marks, no hazard diamonds.
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

TYPE = 'inflator'
BONE, BEAM, BRASS, STEEL, RUBBER, GLASS, LED, G = (
    'kn_powder_bone', 'kn_powder_beam', 'kn_brass', 'kn_steel_brushed', 'kn_rubber', 'kn_glass', 'kn_led',
    'kn_powder_graphite')
MASTERS = [BONE, BEAM, BRASS, STEEL, RUBBER, GLASS, LED, G]
TR, TZ0, TZ1, DOME = 0.065, 0.02, 0.22, 0.245
CR_R, CR_Z0, CR_Z1, FLAT = 0.095, 0.004, 0.040, -0.0855  # Ø 0.19 (brief Ø 0.17 < the 0.18 m footprint minimum)
PORT_IN = (0.0, -0.086, 0.019)
PORT_FILL = (0.08, -0.02, 0.285)
VALVE_Z0, VALVE_Z1 = DOME - 0.001, 0.27
KNOB = Vector((0.0, 0.0, 0.272))
GAUGE = Vector((-0.026, -0.016, 0.258))
GUARD_R, GUARD_Z = 0.036, 0.296
NOZZLE_BASE = Vector((0.08, -0.02, 0.255))


def tank_profile(nd):
    prof = [(0.0, TZ0), (TR - 0.006, TZ0), (TR, TZ0 + 0.006), (TR, TZ1)]
    for k in range(1, nd + 1):
        a = math.pi / 2 * k / nd
        prof.append((0.016 + (TR - 0.016) * math.cos(a), TZ1 + (DOME - TZ1) * math.sin(a)))
    prof.append((0.0, DOME))
    return prof


def hose_path(sub):
    """Fixed sculpted curl: out of the valve's +X side, three loose loops, up into the nozzle base."""
    a = Vector((0.016, 0.0, 0.257))
    b = NOZZLE_BASE
    pts = [a, a + Vector((0.008, 0, 0))]
    n_turns, steps = 2.5, 10
    for i in range(1, steps * 2):
        t = i / (steps * 2)
        c = a + Vector((0.008, 0, 0)) + (b - a - Vector((0.008, 0, -0.012))) * t
        ang = 2 * math.pi * n_turns * t
        pts.append(c + Vector((0.0, 0.010 * math.cos(ang), -0.012 * math.sin(math.pi * t) + 0.007 * math.sin(ang))))
    pts += [b - Vector((0, 0, 0.012)), b]
    return _m4.smooth_path([tuple(p) for p in pts], sub)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(48, q, 8, 4)
    body = Kit()
    body.lathe([(r, z, BONE) for r, z in tank_profile((6, 4, 3, 2)[lod])], n)
    # shoulder band
    body.lathe([(TR - 0.001, 0.19, BEAM), (TR + 0.0025, 0.19, BEAM), (TR + 0.0025, 0.215, BEAM),
                (TR - 0.001, 0.215, BEAM)], n, closed=True)
    # cradle ring with the front facet
    ring_k = Kit()
    ring_k.prism(kit.outline_circle_flat(CR_R, n, FLAT), CR_Z0 - 0.0004, CR_Z1, BONE, bt=0.003 if lod < 3 else 0.0,
                 bseg=max(1, cs - 1))
    if lod < 3:  # the cup the tank stands in
        hole = Kit()
        hole.cyl(TR + 0.001, CR_Z0 + 0.006, CR_Z1 + 0.01, BONE, n)
        ring_k = kit.boolean_diff(ring_k, [hole], mats)
    body.merge(ring_k)
    ring_k.free()
    _m2.land(body, "S", PORT_IN, (0, -1, 0), 0.0008, lod, mat=BONE)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        _m2.screw(body, 'M5', (0.082 * math.cos(a), 0.082 * math.sin(a), CR_Z1), (0, 0, 1), q, lod)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        _m2.foot(body, "S", 0.074 * math.cos(a), 0.074 * math.sin(a), min(1.0, q), lod)
    # valve body (brass), bleed nozzle, side outlet, LEDs
    body.cyl(0.014, VALVE_Z0, VALVE_Z1, BRASS, seg(24, q, 8), bev=0.0015 if lod < 3 else 0.0, bseg=1)
    body.cyl(0.0035, 0.0, 0.016, BRASS, seg(10, q, 5), bev=0.001 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
             m=kit.frame((0, -0.013, 0.26), (0, -1, 0)))
    body.cyl(0.005, 0.0, 0.012, BRASS, seg(12, q, 5), m=kit.frame((0.012, 0, 0.257), (1, 0, 0)))
    for x in (-0.006, 0.006):
        _m2.led_dome(body, 6, (x, -0.0138, 0.251), (0, -1, 0), q, lod, bezel=BRASS)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.0) if c.x < 0 else (1, 0.0))
    # gauge: brass case, dial decal, glass cover (+ needle on its pivot)
    gm = kit.frame(tuple(GAUGE), (0, -1, 0))
    body.cyl(0.016, -0.009, 0.004, BRASS, seg(28, q, 8), bev=0.002 if lod < 3 else 0.0, bseg=1, m=gm)
    body.cyl(0.0045, -0.006, 0.014, BRASS, seg(10, q, 5), m=kit.frame(tuple(GAUGE + Vector((0.004, 0.0, 0.0))),
                                                                      (1, 0, 0)))
    cover = Kit()
    if lod < 3:
        cover.sphere(0.0135, GLASS, seg(24, q, 8), seg(6, q, 3), m=gm @ kit.at(0, 0, 0.004), sz_bot=0.05, sz_top=0.25)
    # guard ring on two posts (beam)
    body.torus(GUARD_R, 0.0035, BEAM, n, (8, 6, 4, 4)[lod], m=kit.at(0, 0, GUARD_Z))
    for s in (-1, 1):
        body.cyl(0.0035, DOME - 0.012, GUARD_Z, BEAM, seg(10, q, 5), m=kit.at(0, s * GUARD_R, 0))
    # nozzle bracket arm + filler nozzle
    body.sweep([(0.0, 0.0, 0.232), (0.04, -0.01, 0.24), (NOZZLE_BASE.x, NOZZLE_BASE.y, 0.243)], 0.0035,
               seg(10, q, 5), STEEL)
    body.cyl(0.006, 0.241, NOZZLE_BASE.z, STEEL, seg(16, q, 6), m=kit.at(NOZZLE_BASE.x, NOZZLE_BASE.y, 0))
    body.cyl(0.0045, NOZZLE_BASE.z, PORT_FILL[2] - 0.0005, STEEL, seg(16, q, 6), bev=0.001 if lod < 2 else 0.0,
             bseg=1, bev_bot=0.0, m=kit.at(NOZZLE_BASE.x, NOZZLE_BASE.y, 0))
    # curly hose
    if lod < 3:
        body.sweep(hose_path((3, 2, 1)[lod]), 0.004, seg(10, q, 5), RUBBER)
    else:
        body.sweep([(0.016, 0, 0.257), tuple(NOZZLE_BASE)], 0.004, 4, RUBBER)
    knob = Kit(pivot='PIVOT__valve_knob')
    if lod < 3:
        prof = [(0.0, KNOB.z, BRASS), (0.012, KNOB.z, BRASS), (0.0145, KNOB.z + 0.003, BRASS),
                (0.0145, KNOB.z + 0.008, BRASS), (0.011, KNOB.z + 0.011, BRASS), (0.0, KNOB.z + 0.011, BRASS)]
        knob.lathe(prof, seg(24, q, 8))
        if lod < 2:
            for k in range(8):
                a = 2 * math.pi * k / 8
                knob.cyl(0.0022, KNOB.z + 0.002, KNOB.z + 0.009, BRASS, 6,
                         m=kit.at(0.0145 * math.cos(a), 0.0145 * math.sin(a), 0))
    else:
        knob.cyl(0.0145, KNOB.z, KNOB.z + 0.011, BRASS, 6)
    needle = Kit(pivot='PIVOT__gauge_needle')
    if lod < 2:
        tip = GAUGE + Vector((0, -0.0012, 0.011))
        needle.sweep([tuple(GAUGE + Vector((0, -0.0012, 0))), tuple(tip)], 0.0007, 4, STEEL)
        needle.cyl(0.0018, -0.0016, 0.0, STEEL, 8, m=gm)
    pieces = {'body': body, 'cover': cover, 'valve_knob': knob, 'gauge_needle': needle}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.marks_m4', tuple(GAUGE + Vector((0, -0.0042, 0))), (0, -1, 0), (0, 0, 1), 0.026, 0.026,
                        sub=_m4.marks4('gauge_dial')),
        kit.decal_cylinder('name.inflator.graphite', (0, 0, 0.11), (0, 0, 1), TR, (0, -1, 0), 0.085, nu=8,
                           lift=0.0004),
        kit.decal_cylinder('picto.pressurised.mono', (0, 0, 0.16), (0, 0, 1), TR, (0.7, -0.7, 0), 0.03, 0.03, nu=6,
                           lift=0.0004),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'air', 'M', '2,3,2', 2.4, 'bottom', 6500,
        'Toy helium tank: kn_powder_bone tank (Ø 0.13, z 0.02-0.22, dome to 0.245) in a bone cradle ring (Ø 0.17 x '
        '0.036, FOOT_S, M5 screws, front facet + land: PR-S signal `in` at z 0.019), kn_powder_beam shoulder band and '
        'valve guard ring (to z 0.30), kn_brass valve + knob on PIVOT__valve_knob (z, 0-90°), brass gauge with the '
        'Volt -> Amber dial decal under a kn_glass cover, needle on PIVOT__gauge_needle (y, -135...+135°), filling '
        '(group 0, air colour) and over-pressure (group 1, amber) LEDs on the valve front, sculpted kn_rubber curly '
        'hose to the steel filler nozzle: PR-S air `fill` out, +Z, at (0.08, -0.02, 0.285), clear of the guard ring. '
        'Name plate "INFLATOR" and the optional shared Pressurised mark on the tank. '
        'Brief: docs/art/briefs/air.md#inflator.',
        MASTERS, led_groups='0:filling,1:overpressure', skins='air,party')
    part.pivot('valve_knob', tuple(KNOB), 'z', 0.0, 90.0, motion='turn')
    part.pivot('gauge_needle', tuple(GAUGE), 'y', -135.0, 135.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_cyl('tank', TR, DOME - TZ0, (0, 0, (DOME + TZ0) / 2), 'z', phys='powder', restitution=0.2)
    part.col_cyl('cradle', CR_R, CR_Z1, (0, 0, CR_Z1 / 2), 'z', phys='powder', restitution=0.2, friction=0.6)
    part.col_box('valve', (0.04, 0.04, 0.06), (0, 0, 0.27), phys='steel')
    part.port('signal', 'in', PORT_IN, (0, -1, 0), 'S', 'in')
    part.port('air', 'fill', PORT_FILL, (0, 0, 1), 'S', 'out')
    part.emit('hiss', 'valve', (0.0, -0.03, 0.26), (0, -1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
