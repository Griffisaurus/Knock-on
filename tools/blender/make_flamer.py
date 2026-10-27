"""Procedurally build the FLAMER source file (docs/art/briefs/boom.md, "FLAMER: Cradle blowtorch").

Usage: blender -b --factory-startup -P tools/blender/make_flamer.py -- [out.blend]
Default output: assets/src/boom/flamer.blend

A bench blowtorch lying in its cradle (3 x 1 x 1, bottom origin, flame +X): a kn_powder_amber gas canister (Ø 0.065,
x -0.1425 ... 0, axis z 0.05) with an amber / graphite hazard band and the flammable pictogram, held by two graphite
saddles on a pillowed graphite cradle (0.20 x 0.08 x 0.035) with rubber foot bars. The graphite regulator block
(x 0 ... 0.04) carries the oversized valve knob on PIVOT__valve_knob (axis z, 0 ... 90°), the status LED_D8 (group 0)
and a kn_poly_amber sight glass on its front over the kn_led igniter spark gap (group 1). The kn_brass burner tube
(Ø 0.014) runs to x 0.15 inside a vented brushed-steel nozzle shroud (Ø 0.024) with the hot-surface pictogram. PR-S
signal on and power in rings on 1 mm lands on the cradle front; name plate on the cradle back. No pistol grip.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'flamer'
AXZ = 0.05
CAN_R, CAN_X0, CAN_X1 = 0.0325, -0.1425, 0.0
REG_X0, REG_X1 = 0.0, 0.04
CR_W, CR_D, CR_H = 0.20, 0.08, 0.035
KNOB = (0.02, 0.0, AXZ + 0.03)
NOZ = (0.15, 0.0, AXZ)
G, AMBER, STEEL, BRASS, PAMBER, RUBBER, LED = (
    'kn_powder_graphite', 'kn_powder_amber', 'kn_steel_brushed', 'kn_brass', 'kn_poly_amber', 'kn_rubber', 'kn_led')
MASTERS = [G, AMBER, STEEL, BRASS, PAMBER, RUBBER, LED, 'kn_decal']
AX = kit.at(0, 0, AXZ) @ kit.X_AXIS   # local z = +X


def led_group(c, _n):
    return (0, 0.08) if c.z > AXZ + 0.02 else (1, 0.0)


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    cradle = Kit()
    cradle.rbox((CR_W, CR_D, CR_H - 0.004), (0, 0, 0.004 + (CR_H - 0.004) / 2), 0.008 if lod < 3 else 0.0, G,
                cseg=cs, rz=0.004 if lod < 3 else 0.0)
    for x in (-0.07, -0.03):
        _m2.land(cradle, 'S', (x, -0.041, 0.019), (0, -1, 0), 0.001, lod)
    for y in (-0.028, 0.028):
        _m2.foot_bar(cradle, 0.17, 0.0, y, min(1.0, q), lod, h=0.004)
    # two saddles hugging the canister
    for x in (-0.11, -0.03):
        sad = Kit()
        sad.rbox((0.016, 0.072, AXZ - CR_H + 0.006), (x, 0, CR_H + (AXZ - CR_H + 0.006) / 2 - 0.003),
                 0.004 if lod < 3 else 0.0, G, cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.003 if lod < 3 else 0.0)
        if lod < 3:
            cut = Kit()
            cut.cyl(CAN_R + 0.0008, -0.02, 0.02, G, seg(32, q, 8), m=kit.at(x, 0, AXZ) @ kit.X_AXIS)
            sad = kit.boolean_diff(sad, [cut], mats)
        cradle.merge(sad)
        sad.free()
    # canister: lathe along +X with domed ends and a shoulder ring
    can = Kit()
    n = seg(40, q, 8)
    prof = [(0.0, CAN_X0, AMBER), (CAN_R * 0.6, CAN_X0 + 0.0015, AMBER), (CAN_R - 0.003, CAN_X0 + 0.006, AMBER),
            (CAN_R, CAN_X0 + 0.012, AMBER), (CAN_R, CAN_X1 - 0.012, AMBER), (CAN_R - 0.004, CAN_X1 - 0.004, AMBER),
            (0.012, CAN_X1, AMBER), (0.0, CAN_X1, AMBER)]
    if lod >= 2:
        prof = [prof[0], prof[3], prof[4], prof[6], prof[7]]
    can.lathe(prof, n, AX)
    # regulator block + knob + sight glass + status dome
    reg = Kit()
    reg.rbox((REG_X1 - REG_X0, 0.046, 0.05), ((REG_X0 + REG_X1) / 2, 0, AXZ), 0.006 if lod < 3 else 0.0, G, cseg=cs,
             rz=0.006 if lod < 3 else 0.0)
    reg.rbox((0.022, 0.003, 0.016), (0.02, -0.023, AXZ - 0.004), 0.003 if lod < 3 else 0.0, PAMBER,
             cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.0)
    reg.cyl(0.0025, -0.0005, 0.004, LED, seg(8, q, 4), m=kit.frame((0.02, -0.0205, AXZ - 0.004), 'y'))
    _m2.led_dome(reg, 8, (0.032, 0.012, AXZ + 0.025), (0, 0, 1), q, lod)
    reg.colors['led'] = _m2.led_attr(led_group)
    knob = Kit(pivot='PIVOT__valve_knob')
    nk = seg(12, q, 6)
    if lod < 2:
        star = [((0.013 if i % 2 == 0 else 0.0105) * math.cos(math.pi * i / nk),
                 (0.013 if i % 2 == 0 else 0.0105) * math.sin(math.pi * i / nk)) for i in range(2 * nk)]
        knob.prism(star, AXZ + 0.024, AXZ + 0.040, G, bt=0.002, bseg=2, m=kit.at(KNOB[0], KNOB[1], 0))
        knob.rbox((0.022, 0.004, 0.003), (KNOB[0] + 0.004, 0, AXZ + 0.0405), 0.0015, STEEL, cseg=1, rz=0.0)
    else:
        knob.cyl(0.012, AXZ + 0.024, AXZ + 0.040, G, nk, m=kit.at(KNOB[0], KNOB[1], 0))
    knob.cyl(0.004, AXZ + 0.020, AXZ + 0.026, STEEL, seg(10, q, 5), m=kit.at(KNOB[0], KNOB[1], 0))
    # burner tube + vented shroud
    burner = Kit()
    burner.cyl(0.007, REG_X1 - 0.004, 0.13, BRASS, seg(20, q, 6), m=AX)
    sh = Kit()
    sh.lathe([(0.0068, 0.108, STEEL), (0.012, 0.108, STEEL), (0.012, 0.149, STEEL), (0.0105, 0.15, STEEL),
              (0.0068, 0.15, STEEL)], seg(28, q, 8), AX, closed=True)
    if lod < 2:  # vent slots
        vents = Kit()
        for i in range(6):
            a = 360.0 * i / 6
            vents.rbox((0.012, 0.004, 0.012), (0.118, 0, 0.0), 0.0015, STEEL, cseg=1, rz=0.0,
                       m=kit.at(0, 0, AXZ) @ kit.rot_x(a) @ kit.at(0, 0, 0.012))
        sh = kit.boolean_diff(sh, [vents], mats)
    burner.merge(sh)
    sh.free()
    pieces = {'cradle': cradle, 'canister': can, 'regulator': reg, 'knob': knob, 'burner': burner}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('trim.hazard_r', (-0.115, 0, AXZ), (1, 0, 0), CAN_R + 0.0002, (0, -0.6, 0.8), 0.012,
                           span=math.pi, nu=12, sub=(0.0, 0.0, 0.8, 1.0)),
        kit.decal_cylinder('trim.hazard_r', (-0.115, 0, AXZ), (1, 0, 0), CAN_R + 0.0002, (0, 0.6, -0.8), 0.012,
                           span=math.pi, nu=12, sub=(0.0, 0.0, 0.8, 1.0)),
        kit.decal_plane('picto.flammable.warn', (-0.065, -0.012, AXZ + CAN_R - 0.0023), (0, -0.37, 0.93), (1, 0, 0),
                        0.026, 0.026),
        kit.decal_plane('picto.hot_surface.warn', (0.128, 0, AXZ + 0.0122), (0, 0, 1), (1, 0, 0), 0.014, 0.014),
        kit.decal_plane('name.flamer.bone', (0.0, CR_D / 2, 0.019), (0, 1, 0), (0, 0, 1), 0.05),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '3,1,1', 1.2, 'bottom', 6500,
        'Cradle blowtorch (flame +X): kn_powder_amber canister (Ø 0.065) with a hazard band and the flammable '
        'pictogram in two graphite saddles on a pillowed cradle with rubber foot bars; graphite regulator block with '
        'the oversized valve knob (PIVOT__valve_knob, z, 0 ... 90°), status LED_D8 (group 0), kn_poly_amber sight glass '
        'over the kn_led igniter (group 1); kn_brass burner in a vented steel shroud (hot-surface pictogram). PR-S '
        'signal on + power in on 1 mm lands on the cradle front; name plate on the back. Lies like a bench tool. '
        'UV1 authored (bake pending). Brief: docs/art/briefs/boom.md#flamer.',
        MASTERS, led_groups='0:status,1:igniter', skins='classic')
    part.pivot('valve_knob', KNOB, 'z', 0.0, 90.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.4)
    part.col_box('cradle', (CR_W, CR_D, CR_H), (0, 0, CR_H / 2), phys='powder', restitution=0.2, friction=0.6)
    part.col_cyl('canister', CAN_R, 0.14, (-0.07, 0, AXZ), 'x', phys='powder', restitution=0.2, friction=0.5)
    part.col_capsule('burner', 0.012, 0.11, (0.095, 0, AXZ), 'x', phys='powder', restitution=0.2, friction=0.5)
    part.port('signal', 'on', (-0.07, -0.041, 0.019), (0, -1, 0), 'S', 'in')
    part.port('power', 'in', (-0.03, -0.041, 0.019), (0, -1, 0), 'S', 'in')
    pts = [NOZ]
    for i in range(12):
        a = 2 * math.pi * i / 12
        pts.append((NOZ[0] + 0.6, 0.06 * math.cos(a), AXZ + 0.06 * math.sin(a)))
    part.sensor('heat', 'beam', pts, reach=0.6)
    part.emit('flame', 'nozzle', NOZ, (1, 0, 0))
    part.emit('spark', 'igniter', (0.02, -0.018, AXZ - 0.004), (0, -1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
