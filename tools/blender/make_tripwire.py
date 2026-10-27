"""Procedurally build the TRIPWIRE source file (docs/art/briefs/power_signal.md, "TRIPWIRE: Beam sensor").

Usage: blender -b --factory-startup -P tools/blender/make_tripwire.py -- [out.blend]
Default output: assets/src/power/tripwire.blend

A small pillowed graphite receiver block (0.085 x 0.09 x 0.085, on four FOOT_S bumpers) with a kn_anod_beam eye
hood (Ø 0.044, 12 mm proud of the -X face at z 0.05) holding a kn_glass lens behind a kn_led ring (group 0, lit
while light reaches it). On top: a recessed slot with the kn_anod_volt mode slider knob on PIVOT__mode_slider
(axis x, 0 = BREAK ... 0.02 m = LIT; modelled at 0) flanked by the BREAK / LIT icon decals and their two LED dots
(groups 1 / 2). A 3 mm graphite service cover with 4 M3 heads on +X balances the hood so the bounds stay centred.
PR-S signal out on a 3.5 mm land on the -Y face; name plate on the back.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import decal_atlas, kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'tripwire'
FEET = 0.003
BW, BH = 0.085, 0.09
TOP = FEET + BH                          # 0.093
EYE_Z, HOOD_R = 0.05, 0.022
HOOD_X0, HOOD_X1 = -BW / 2, -BW / 2 - 0.012
PORT = (0.015, -0.046, 0.045)
SLIDE0 = (-0.010, 0.006, TOP)            # knob rest (BREAK); slides +0.02 along X to LIT
G, RUBBER, STEEL, BEAM, GLASS, VOLT, LED = (
    'kn_powder_graphite', 'kn_rubber', 'kn_steel_brushed', 'kn_anod_beam', 'kn_glass', 'kn_anod_volt', 'kn_led')
MASTERS = [G, RUBBER, STEEL, BEAM, GLASS, VOLT, LED, 'kn_decal']
EYE = kit.at(0, 0, EYE_Z) @ kit.X_AXIS   # local z = +X


def led_group(c, _n):
    if c.x < HOOD_X0 + 0.002:
        return 0, 0.0
    return (1 if c.x < 0 else 2), 0.1


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    body = Kit()
    body.rbox((BW, BW, BH), (0, 0, FEET + BH / 2), 0.008 if lod < 3 else 0.0, G, cseg=cs, rz=0.007 if lod < 3 else 0.0)
    if lod < 3:  # slider slot
        slot = Kit()
        slot.prism(kit.outline_rrect(0.036, 0.008, 0.0035 if lod < 2 else 0.0, max(1, cs)), TOP - 0.004, TOP + 0.01, G,
                   m=kit.at(0, SLIDE0[1], 0))
        body = kit.boolean_diff(body, [slot], mats)
    # port land (3.5 mm proud of the -Y face)
    body.cyl(0.0175, -0.0005, -PORT[1] - BW / 2, G, (24, 14, 10, 6)[lod], bev=0.0008 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
             m=kit.frame((PORT[0], -BW / 2, PORT[2]), '-y'))
    # +X service cover with 4 M3
    body.rbox((0.0035, 0.06, 0.06), (BW / 2 + 0.00125, 0, FEET + BH / 2), 0.004 if lod < 3 else 0.0, G,
              cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.001 if lod < 2 else 0.0, m=None)
    for y in (-0.023, 0.023):
        for z in (FEET + BH / 2 - 0.023, FEET + BH / 2 + 0.023):
            _m2.screw(body, 'M3', (BW / 2 + 0.003, y, z), (1, 0, 0), min(1.0, q), lod)
    for x in (-0.031, 0.031):
        for y in (-0.031, 0.031):
            _m2.foot(body, 'S', x, y, min(1.0, q), lod if lod == 0 else lod + 1)
    # mode LEDs beside the slot ends (break at -X, lit at +X)
    for x in (-0.030, 0.030):
        if lod < 3:
            body.sphere(0.0022, LED, seg(10, q, 5), (4, 3, 2)[lod], m=kit.at(x, SLIDE0[1], TOP - 0.0004), sz_bot=0.2,
                        sz_top=0.7)
        else:
            body.cyl(0.002, -0.0003, 0.0008, LED, 4, m=kit.at(x, SLIDE0[1], TOP))
    body.colors['led'] = _m2.led_attr(led_group)
    # eye hood: Beam tube with a lip, glass lens and the LED ring inside
    hood = Kit()
    n = seg(28, q, 6)
    prof = [(0.0, HOOD_X0 + 0.003, BEAM), (HOOD_R, HOOD_X0 + 0.003, BEAM), (HOOD_R, HOOD_X1 + 0.002, BEAM)]
    if lod < 2:
        prof += [(HOOD_R - 0.0008, HOOD_X1 + 0.0004, BEAM), (HOOD_R - 0.0025, HOOD_X1, BEAM)]
    if lod < 3:
        prof += [(0.017, HOOD_X1, BEAM), (0.016, HOOD_X1 + 0.004, LED), (0.0125, HOOD_X1 + 0.0046, BEAM),
                 (0.0125, HOOD_X1 + 0.007, GLASS), (0.0, HOOD_X1 + 0.0085, GLASS)]
    else:
        prof += [(0.016, HOOD_X1 + 0.002, LED), (0.0, HOOD_X1 + 0.004, GLASS)]
    # the profile runs along -X: map local z = -X
    hood.lathe([(r, -x, mt) for r, x, mt in prof], n, kit.at(0, 0, EYE_Z) @ kit.frame(axis='-x'))
    hood.colors['led'] = _m2.led_attr(led_group)
    knob = Kit(pivot='PIVOT__mode_slider')
    knob.rbox((0.010, 0.0065, 0.010), (SLIDE0[0], SLIDE0[1], TOP + 0.001), 0.0025 if lod < 3 else 0.0, VOLT,
              cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.002 if lod < 3 else 0.0)
    pieces = {'body': body, 'hood': hood, 'knob': knob}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.marks_m3', (-0.030, SLIDE0[1] - 0.0115, TOP), (0, 0, 1), (0, 1, 0), 0.011, 0.0104,
                        sub=decal_atlas.marks_sub('beam_break')),
        kit.decal_plane('trim.marks_m3', (0.030, SLIDE0[1] - 0.0115, TOP), (0, 0, 1), (0, 1, 0), 0.011, 0.0104,
                        sub=decal_atlas.marks_sub('beam_lit')),
        kit.decal_plane('name.tripwire.bone', (0, BW / 2, 0.050), (0, 1, 0), (0, 0, 1), 0.052),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,1,1', 0.3, 'bottom', 1500,
        'Beam sensor: pillowed graphite block on FOOT_S, kn_anod_beam eye hood on -X (Ø 0.044, 12 mm proud, z 0.05) '
        'with a kn_glass lens and kn_led ring (group 0 eye); kn_anod_volt mode slider on PIVOT__mode_slider (x, '
        '0 break ... 0.02 lit, modelled at 0) in a top slot between BREAK / LIT icon decals (trim.marks_m3) and their '
        'LED dots (groups 1 / 2). A 3 mm +X service cover with 4 x M3 balances the hood (bounds centred). Receiver '
        'only. UV1 authored for the 1024² set (bake pending). Brief: docs/art/briefs/power_signal.md#tripwire.',
        MASTERS, led_groups='0:eye,1:mode_break,2:mode_lit')
    part.pivot('mode_slider', SLIDE0, 'x', 0.0, 0.02, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('body', (BW, BW, TOP), (0, 0, TOP / 2), phys='powder', restitution=0.25, friction=0.5)
    part.port('signal', 'out', PORT, (0, -1, 0), 'S', 'out', max_links=8)
    c = (-0.0545, 0.0, EYE_Z)
    import math
    part.sensor('light', 'eye', [(c[0] + dx, 0.015 * math.cos(a), EYE_Z + 0.015 * math.sin(a))
                                 for dx in (-0.005, 0.005) for a in [2 * math.pi * i / 12 for i in range(12)]],
                threshold=0.1, debounce_ticks=2)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
