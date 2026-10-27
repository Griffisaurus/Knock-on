"""Procedurally build the TRACTOR BEAM source file (docs/art/briefs/future.md, "TRACTOR BEAM: Pull-and-hold beam
projector").

Usage: blender -b --factory-startup -P tools/blender/make_tractor_beam.py -- [out.blend]
Default output: assets/src/future/tractor_beam.blend

A sleek kn_powder_graphite barrel (rounded-square section 0.09 W x 0.08 H, 12 mm pillow, centre z 0.060) from the
dish face at y -0.150 to y +0.120, with a kn_anod_plasma nose band and a graphite rear cap (to y +0.146) with three
cooling slots, on two graphite saddles (y ±0.08, z 0.004-0.026) with FOOT_S bumpers. The beam fires toward -Y: a
concave kn_anod_plasma emitter dish (Ø 0.076) with three segmented kn_led lens rings (Ø 0.030 / 0.050 / 0.070,
group 0) and a kn_poly_plasma lens dome (apex y -0.155) on PIVOT__dish_spin (y, continuous). Top: PR-M power port
(0, 0.070, 0.100) and the pull / hold mode domes (group 1, y -0.02 / -0.05). Right flank: a 4-segment kn_led load bar
(group 2, y 0.02). Left flank: name plate. No weapon cues: no bore, trigger or sight.
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

TYPE = 'tractor_beam'
G, PLASMA, PPOLY, RUBBER, LED, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_rubber', 'kn_led', 'kn_steel_brushed')
MASTERS = [G, PLASMA, PPOLY, RUBBER, LED, STEEL, 'kn_decal']
BW, BH, BZ = 0.09, 0.08, 0.060
Y_FRONT, Y_BACK, Y_CAP = -0.150, 0.120, 0.146
NOSE = -0.136
PORT = (0.0, 0.070, 0.100)
DISH_C = Vector((0.0, Y_FRONT, BZ))
M_DISH = kit.at(*DISH_C) @ kit.FRONT_OUT      # local z -> -Y, local (x, y) -> (x, z)
BARREL_M = kit.at(0, 0, BZ) @ kit.Y_AXIS      # outline (z, x) extruded along +Y


def dish_h(r):
    """Concave dish surface height (local h = -y offset from the barrel face) at radius r."""
    return -0.0025 + 0.0045 * (r / 0.036) ** 2


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    outline = kit.outline_rrect(BH, BW, 0.012 if lod < 3 else 0.006, max(1, cs))
    body.prism(outline, Y_FRONT, Y_BACK, G, bt=0.0, bb=0.004 if lod < 3 else 0.0, bseg=max(1, cs - 1), m=BARREL_M,
               cuts=(NOSE,), side_fn=lambda zm: PLASMA if zm < NOSE else G, bot=G)
    # rear cap with a 1 mm panel-line neck and three cooling slots
    cap = Kit()
    cap.prism(kit.outline_rrect(BH - 0.002, BW - 0.002, 0.011 if lod < 3 else 0.006, max(1, cs)), Y_BACK + 0.0010,
              Y_CAP, G, bt=0.005 if lod < 3 else 0.0, bseg=max(1, cs), m=BARREL_M)
    body.prism(kit.outline_rrect(BH - 0.004, BW - 0.004, 0.010, max(1, cs)), Y_BACK - 0.001, Y_BACK + 0.0015, G,
               m=BARREL_M)
    if lod < 2:
        cutters = []
        for dz in (-0.016, 0.0, 0.016):
            c = Kit()
            c.rbox((0.050, 0.010, 0.0055), (0, Y_CAP, BZ + dz), 0.0027, G, cseg=2, rz=0.0)
            cutters.append(c)
        cap = kit.boolean_diff(cap, cutters, mats)
    body.merge(cap)
    cap.free()
    # saddles with feet
    for sy in (-1, 1):
        body.rbox((BW, 0.030, 0.022), (0, sy * 0.080, 0.004 + 0.011), 0.006 if lod < 3 else 0.0, G, cseg=max(1, cs),
                  rz=0.003 if lod < 3 else 0.0)
        for sx in (-1, 1):
            for dy in (-1, 1):
                _m2.foot(body, 'S', sx * 0.034, sy * 0.080 + dy * 0.009, min(1.0, q), lod)
    # top: mode domes; right flank: load bar
    for y in (-0.02, -0.05):
        _m2.led_dome(body, 8, (0.0, y, BZ + BH / 2), (0, 0, 1), q, lod)
    for i in range(4):
        z = BZ - 0.0165 + 0.011 * i
        body.rbox((0.0024, 0.010, 0.008), (BW / 2 + 0.0004, 0.020, z), 0.0008 if lod < 2 else 0.0, LED, cseg=1,
                  rz=0.0008 if lod < 2 else 0.0)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (2, 0.0) if c.x > BW / 2 - 0.002 else (1, 0.08))
    # the emitter dish (spins), its segmented lens rings and the lens dome
    dish = Kit(pivot='PIVOT__dish_spin')
    n = seg(48, q, 12, 4)
    rs = (6, 4, 3, 2)[lod]
    prof = [(0.0, -0.006, PLASMA), (0.038, -0.006, PLASMA), (0.038, 0.0015, PLASMA), (0.0368, 0.0028, PLASMA)]
    for k in range(rs, -1, -1):
        r = 0.0355 * k / rs
        prof.append((r, dish_h(r), PLASMA))
    dish.lathe(kit.dedupe(prof), n, M_DISH)
    if lod < 3:
        for R in (0.015, 0.025, 0.035):
            w = 0.0016
            h = dish_h(R)
            ring = [(R - w, h - 0.0008, LED), (R + w, h - 0.0008, LED), (R + w, h + 0.0007, LED),
                    (R - w, h + 0.0007, LED)]
            for k in range(3):
                a0 = math.radians(120 * k + 12)
                a1 = math.radians(120 * (k + 1) - 12)
                dish.lathe_arc(ring, a0, a1, max(2, int(seg(16, q, 3) * R / 0.035)), m=M_DISH)
    else:
        dish.lathe([(0.024, dish_h(0.024) - 0.0008, LED), (0.026, dish_h(0.026) - 0.0008, LED),
                    (0.026, 0.0012, LED), (0.024, 0.0012, LED)], 8, M_DISH, closed=True)
    dish.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    lens = Kit(pivot='PIVOT__dish_spin')
    lens.sphere(0.010, PPOLY, seg(20, q, 8), (8, 6, 4, 3)[lod], m=M_DISH @ kit.at(0, 0, -0.005))
    pieces = {'body': body, 'dish': dish, 'lens': lens}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.tractor_beam.bone', (-BW / 2, -0.035, BZ), (-1, 0, 0), (0, 0, 1), 0.10),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '1,1,3', 2.0, 'bottom', 5500,
        'Pull-and-hold beam projector: kn_powder_graphite barrel (0.09 x 0.08, 12 mm pillow, centre z 0.060, y -0.150 '
        'to +0.120) with a kn_anod_plasma nose band and a graphite rear cap (to +0.146, three cooling slots) on two '
        'graphite saddles (y ±0.08) with FOOT_S. Concave kn_anod_plasma dish Ø 0.076 with three segmented kn_led lens '
        'rings (Ø 0.030 / 0.050 / 0.070, group 0) and a kn_poly_plasma lens dome (apex y -0.155) on PIVOT__dish_spin '
        '(y, continuous). Top: PR-M power in, pull / hold LED_D8 domes (group 1). Right flank: 4-segment kn_led load '
        'bar (group 2). Beam toward -Y; hold point 0.5-3 m. No weapon cues. '
        'Brief: docs/art/briefs/future.md#tractor-beam.',
        MASTERS, led_groups='0:lens_rings,1:mode,2:load', skins='graphite,lab_white',
        hints={'kn_range_min': 0.5, 'kn_range_max': 3.0})
    part.pivot('dish_spin', (0.0, -0.145, BZ), 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('0', (0.09, 0.29, 0.08), (0, -0.005, BZ), phys='powder', restitution=0.2, friction=0.5)
    for i, sy in ((1, -1), (2, 1)):
        part.col_box(str(i), (0.09, 0.03, 0.02), (0, sy * 0.080, 0.010), phys='powder')
    part.port('power', 'in', PORT, (0, 0, 1), 'M', 'in')
    part.emit('beam', 'lens', (0.0, -0.155, BZ), (0, -1, 0))
    part.emit('hold', 'focus', (0.0, -0.655, BZ), (0, -1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
