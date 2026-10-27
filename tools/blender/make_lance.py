"""Procedurally build the LANCE source file (docs/art/briefs/power_signal.md, "LANCE: Benchtop laser").

Usage: blender -b --factory-startup -P tools/blender/make_lance.py -- [out.blend]
Default output: assets/src/power/lance.blend

A lab-instrument laser (2x1x1, bottom origin): a pillowed graphite housing 0.16 x 0.07 x 0.07 (x -0.10 ... 0.06,
z 0.012 ... 0.082) on two graphite skids with kn_rubber pads, five brushed-steel cooling fins on the rear top
(to z 0.095), four M3 heads on the top corners and a status LED_D6 (group 0) at the top rear. A kn_poly_clear top
window (0.09 x 0.05) sits over a pocket holding the Ø 0.016 kn_glass tube with its kn_led core (group 1) on two
graphite cradles. The kn_anod_beam emitter barrel (Ø 0.04, x 0.06 ... 0.10, axis z 0.047) has two cooling
grooves and a dark aperture with a kn_led dot (group 2) on the beam axis. PR-S power in on a 6 mm Ø 35 mm land on
the -Y side. Name plate on the -Y side, light-beam pictogram (mono) on the +Y side. No grip, trigger or sights.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'lance'
HX0, HX1, HZ0, HZ1, HY = -0.10, 0.06, 0.012, 0.082, 0.035   # housing
AXZ = 0.047                                                  # barrel / beam axis height
BR, BX0, BX1 = 0.02, 0.06, 0.10                              # barrel
PORT = (-0.07, -0.041, AXZ)
WIN_C, WIN_W, WIN_D = (0.005, 0.0), 0.09, 0.05               # top window centre (x, y), size
TUBE_Z, TUBE_R = 0.064, 0.008
FINS_X = (-0.088, -0.079, -0.070, -0.061, -0.052)
LED_STATUS = (-0.070, 0.0275, HZ1)
G, STEEL, RUBBER, BEAM, POLY, GLASS, LED = (
    'kn_powder_graphite', 'kn_steel_brushed', 'kn_rubber', 'kn_anod_beam', 'kn_poly_clear', 'kn_glass', 'kn_led')
MASTERS = [G, STEEL, RUBBER, BEAM, POLY, GLASS, LED, 'kn_decal']
AXIS = kit.at(0, 0, AXZ) @ kit.X_AXIS   # local z = +X along the beam axis


def led_group(c, _n):
    if c.x > BX1 - 0.004:
        return 2, 0.0          # aperture dot
    if c.z > HZ1 - 0.002:
        return 0, 0.08         # status dome on the top
    return 1, 0.0              # tube core


def barrel_profile(lod):
    """Lathe (r, x, master) along +X: a collar in the housing, two cooling grooves, rounded nose, aperture."""
    p = [(0.0, BX0 - 0.004, BEAM), (BR - 0.002, BX0 - 0.004, BEAM), (BR - 0.002, BX0, BEAM), (BR, BX0 + 0.002, BEAM)]
    if lod < 2:
        for g in (0.072, 0.082):
            p += [(BR, g - 0.002, BEAM), (BR - 0.0018, g - 0.001, BEAM), (BR - 0.0018, g + 0.001, BEAM),
                  (BR, g + 0.002, BEAM)]
    if lod < 3:
        p += [(BR, BX1 - 0.003, BEAM), (BR - 0.0009, BX1 - 0.0009, BEAM)]
    p += [(BR - 0.003, BX1, BEAM), (0.0075, BX1, G), (0.0065, BX1 - 0.003, G), (0.0025, BX1 - 0.003, LED),
          (0.0, BX1 - 0.0028, LED)]
    return p


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    body = Kit()
    body.rbox((HX1 - HX0, 2 * HY, HZ1 - HZ0), ((HX0 + HX1) / 2, 0, (HZ0 + HZ1) / 2), 0.006 if lod < 3 else 0.0, G,
              cseg=cs, rz=0.005 if lod < 3 else 0.0)
    if lod < 3:  # window pocket down to the tube cradles
        pocket = Kit()
        pocket.prism(kit.outline_rrect(WIN_W - 0.006, WIN_D - 0.006, 0.003, max(1, cs)), TUBE_Z - 0.012, HZ1 + 0.01, G,
                     m=kit.at(WIN_C[0], WIN_C[1], 0))
        body = kit.boolean_diff(body, [pocket], mats)
    # port land: 6 mm proud, Ø 35 mm, the PR-S ring's centre plane on its face
    body.cyl(0.0175, -0.0005, -PORT[1] - HY, G, (24, 14, 10, 6)[lod], bev=0.001 if lod < 2 else 0.0,
             bseg=1, bev_bot=0.0, m=kit.frame((PORT[0], -HY, PORT[2]), '-y'))
    # skids with rubber pads
    for y in (-0.034, 0.034):
        body.rbox((0.152, 0.012, HZ0 - 0.0025 + 0.002), (-0.021, y, 0.0025 + (HZ0 - 0.0025 + 0.002) / 2),
                  0.004 if lod < 2 else 0.0, G, cseg=max(1, cs - 1), rz=0.0012 if lod < 2 else 0.0)
        if lod < 3:
            body.rbox((0.146, 0.010, 0.003), (-0.021, y, 0.0015), 0.003 if lod < 2 else 0.0, RUBBER,
                      cseg=1 if lod < 2 else 0, rz=0.0008 if lod < 2 else 0.0)
    # cooling fins (rear top)
    fins = Kit()
    if lod < 3:
        for x in FINS_X:
            fins.rbox((0.0028, 0.040, 0.0145), (x, 0, HZ1 + 0.0065), 0.0012 if lod < 2 else 0.0, STEEL,
                      cseg=1, rz=0.0012 if lod < 2 else 0.0)
    else:
        fins.rbox((FINS_X[-1] - FINS_X[0] + 0.003, 0.040, 0.0145), (sum(FINS_X) / 5, 0, HZ1 + 0.0065), 0.0, STEEL,
                  cseg=0, rz=0.0)
    for x in (-0.094, 0.054):
        for y in (-0.0275, 0.0275):
            _m2.screw(body, 'M3', (x, y, HZ1), (0, 0, 1), min(1.0, q), lod)
    _m2.led_dome(body, 6, LED_STATUS, (0, 0, 1), q, lod)
    # tube: glass envelope with a kn_led core on two graphite cradles, under the clear window
    tube = Kit()
    if lod < 3:
        tx0, tx1 = WIN_C[0] - 0.036, WIN_C[0] + 0.036
        n = seg(14, q, 6)
        tube.cyl(TUBE_R, tx0, tx1, GLASS, n, bev=0.003 if lod < 2 else 0.0, bseg=2,
                 m=kit.at(0, WIN_C[1], TUBE_Z) @ kit.X_AXIS)
        tube.cyl(0.0032, tx0 + 0.006, tx1 - 0.006, LED, seg(8, q, 4), m=kit.at(0, WIN_C[1], TUBE_Z) @ kit.X_AXIS)
        for x in (tx0 + 0.008, tx1 - 0.008):
            tube.rbox((0.006, 0.026, 0.008), (x, WIN_C[1], TUBE_Z - TUBE_R - 0.003), 0.0015 if lod < 2 else 0.0, G,
                      cseg=1, rz=0.0)
        tube.rbox((WIN_W, WIN_D, 0.0016), (WIN_C[0], WIN_C[1], HZ1 - 0.0004), 0.004 if lod < 2 else 0.0, POLY,
                  cseg=max(1, cs - 1), rz=0.0006 if lod < 2 else 0.0)
    else:
        tube.rbox((WIN_W, WIN_D, 0.0016), (WIN_C[0], WIN_C[1], HZ1 + 0.0004), 0.0, POLY, cseg=0, rz=0.0)
        tube.cyl(0.004, WIN_C[0] - 0.03, WIN_C[0] + 0.03, LED, 4, m=kit.at(0, 0, HZ1 + 0.0012) @ kit.X_AXIS)
    tube.colors['led'] = _m2.led_attr(led_group)
    barrel = Kit()
    barrel.lathe(barrel_profile(lod), seg(32, q, 8), AXIS)
    barrel.colors['led'] = _m2.led_attr(led_group)
    body.colors['led'] = _m2.led_attr(led_group)
    pieces = {'body': body, 'fins': fins, 'tube': tube, 'barrel': barrel}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.lance.bone', (0.010, -HY, 0.050), (0, -1, 0), (0, 0, 1), 0.050),
        kit.decal_plane('picto.light_beam.mono', (0.035, HY, 0.047), (0, 1, 0), (0, 0, 1), 0.024, 0.024),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '2,1,1', 0.9, 'bottom', 3000,
        'Benchtop laser: pillowed graphite housing on rubber-padded skids, five brushed-steel cooling fins and a '
        'status LED_D6 (group 0) on the rear top, 4 x M3; a kn_poly_clear top window over a kn_glass tube with a '
        'kn_led core (group 1); kn_anod_beam emitter barrel (Ø 0.04) with a kn_led aperture dot (group 2) on the '
        'beam axis (z 0.047). PR-S power in on a 6 mm land on the -Y side. Decals: name plate (-Y side), light-beam '
        'pictogram mono (+Y side). Not a weapon: no grip, trigger, stock or sights. UV1 authored for the 1024² set '
        '(texture bake pending). Brief: docs/art/briefs/power_signal.md#lance.',
        MASTERS, led_groups='0:status,1:tube,2:aperture')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('housing', (HX1 - HX0, 2 * HY, HZ1), ((HX0 + HX1) / 2, 0, HZ1 / 2), phys='powder', restitution=0.25,
                 friction=0.5)
    part.col_cyl('barrel', BR, BX1 - BX0, ((BX0 + BX1) / 2, 0, AXZ), 'x', phys='powder', restitution=0.25, friction=0.5)
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    part.emit('beam', 'aperture', (BX1, 0, AXZ), (1, 0, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
