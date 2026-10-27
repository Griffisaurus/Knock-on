"""Procedurally build the LAMP source file (docs/art/briefs/power_signal.md, "LAMP: Light bulb").

Usage: blender -b --factory-startup -P tools/blender/make_lamp.py -- [out.blend]
Default output: assets/src/power/lamp.blend

An oversized bulb on a little dark plinth (1x2x1): a pillowed graphite base (0.09 x 0.09, top z 0.07, 8 mm)
on four FOOT_S, a kn_anod_volt trim band (z 0.068-0.074), a brushed-steel screw collar (Ø 0.042 x 0.024,
four thread ribs) and a kn_glass bulb (Ø 0.088 centred z 0.148, exhaust tip to 0.196) modelled as one closed
1.5 mm shell so the filament reads through a single glass layer. Inside: a 3-turn kn_led coil (exaggerated,
group 0 filament) on two steel support wires rising from the collar. PORT__power__in (PR-S, -Y) sits on a 1 mm
Ø 35 mm boss at z 0.036; name plate on the base back, hot-surface pictogram (mono) on the base's +X side.
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

TYPE = 'lamp'
BASE_W, BASE_TOP, FOOT_H = 0.09, 0.07, 0.003
BAND = (0.068, 0.074)
COLLAR_R, COLLAR_Z0, COLLAR_Z1 = 0.021, 0.074, 0.098
BULB_R, BULB_Z, TIP_Z, NECK_R, WALL = 0.044, 0.148, 0.196, 0.0165, 0.0015
COIL_R, COIL_r, COIL_X = 0.006, 0.0013, 0.012
PORT = (0.0, -0.046, 0.036)
G, VOLT, STEEL, GLASS, RUBBER, LED = (
    'kn_powder_graphite', 'kn_anod_volt', 'kn_steel_brushed', 'kn_glass', 'kn_rubber', 'kn_led')
MASTERS = [G, VOLT, STEEL, GLASS, RUBBER, LED, 'kn_decal']


def bulb_profile(rings, inner_rings):
    """Closed shell profile: outer top pole -> outer wall -> neck rim -> inner wall -> inner top pole."""
    zn = BULB_Z - math.sqrt(BULB_R ** 2 - NECK_R ** 2)       # where the neck meets the sphere
    a0 = math.asin(NECK_R / BULB_R)                         # polar angle from the bottom
    a1 = math.pi - math.asin(0.004 / BULB_R)                # tip shoulder
    out = [(0.0, TIP_Z), (0.0034, TIP_Z - 0.0012)]
    for i in range(rings + 1):
        a = a1 - (a1 - a0) * i / rings
        out.append((BULB_R * math.sin(a), BULB_Z - BULB_R * math.cos(a)))
    out.append((NECK_R, COLLAR_Z0 + 0.016))
    ri = BULB_R - WALL
    ai0 = math.asin((NECK_R - WALL) / ri)
    ai1 = math.pi - math.asin(0.0025 / ri)
    inn = [(NECK_R - WALL, COLLAR_Z0 + 0.016), (NECK_R - WALL, zn + 0.0005)]
    for i in range(inner_rings + 1):
        a = ai0 + (ai1 - ai0) * i / inner_rings
        inn.append((ri * math.sin(a), BULB_Z - ri * math.cos(a)))
    inn.append((0.0, TIP_Z - 0.0035))
    return [(r, z, GLASS) for r, z in kit.dedupe([(r, z) for r, z in out + inn])]


def collar_profile(ribs):
    """Screw collar: bottom pole, 3 V thread ribs (LOD0), a shoulder and a top pole (under the glass neck)."""
    p = [(0.0, COLLAR_Z0 - 0.0005), (COLLAR_R - 0.0015, COLLAR_Z0 - 0.0005)]
    if ribs:
        pitch = (COLLAR_Z1 - COLLAR_Z0 - 0.006) / 3
        for k in range(3):
            z = COLLAR_Z0 + 0.002 + k * pitch
            p += [(COLLAR_R - 0.0015, z), (COLLAR_R, z + pitch * 0.5)]
        p += [(COLLAR_R - 0.0015, COLLAR_Z0 + 0.002 + 3 * pitch)]
    p += [(COLLAR_R - 0.0015, COLLAR_Z1 - 0.002), (COLLAR_R - 0.0025, COLLAR_Z1), (NECK_R + 0.0008, COLLAR_Z1),
          (0.0, COLLAR_Z1)]
    return [(r, z, STEEL) for r, z in kit.dedupe(p)]


def led_group(_c, _n):
    return 0, 0.0  # group 0 "filament", dark when off


def build(lod, q):
    base = Kit()
    cs = (3, 2, 1, 0)[lod]
    base.rbox((BASE_W, BASE_W, BASE_TOP - FOOT_H), (0, 0, (BASE_TOP + FOOT_H) / 2), 0.008 if lod < 3 else 0.0, G,
              cseg=cs, rz=None if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            if lod == 0:
                _m2.foot(base, 'S', sx * 0.033, sy * 0.033, q * 0.5, lod)
            elif lod < 3:  # LOD1 8-sided, LOD2 4-sided pads
                base.prism(kit.outline_circle(0.004, 8 if lod == 1 else 4), 0.0, FOOT_H + 0.0006, RUBBER,
                           m=kit.at(sx * 0.033, sy * 0.033, 0))
    if lod < 3:  # port boss: the PR-S collar's centre plane sits on its face (y -0.046)
        base.cyl(0.0175, -0.006, 0.0, G, seg(18, q, 8), bev=0.001 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame(PORT, '-y'))
    base.cyl(0.028, BAND[0], BAND[1], VOLT, seg(20, q, 8), bev=(0.001, 0.001, 0.0, 0.0)[lod], bseg=1, bev_bot=0.0)
    if lod < 2:
        base.lathe(collar_profile(lod == 0), seg(16, q, 8))
    else:
        base.cyl(COLLAR_R, COLLAR_Z0 - 0.0005, COLLAR_Z1, STEEL, seg(16, q, 6))
    # bulb: one closed glass shell (LOD3: a solid glass ball with a stub neck)
    bulb = Kit()
    if lod < 3:
        bulb.lathe(bulb_profile(seg(9, q, 4), seg(5, q, 2)), seg(26, q, 8))
    else:
        bulb.sphere(BULB_R, GLASS, 8, 5, m=kit.at(0, 0, BULB_Z))
    # filament: 3-turn kn_led coil along X on two steel supports
    fil = Kit()
    if lod < 3:
        _m2.coil(fil, COIL_R, COIL_r, 0.0, 2 * COIL_X, 3, LED, q, lod, m=kit.at(-COIL_X, 0, BULB_Z) @ kit.X_AXIS,
                 sides=(5, 4, 3)[lod], per_turn=seg((10, 7, 5)[lod], q, 4))
        sw = (5, 4, 3)[lod]
        for s in (-1, 1):
            x = s * (COIL_X - COIL_r)
            path = [(x, COIL_R, BULB_Z), (x, COIL_R * 0.6, BULB_Z - 0.012), (s * 0.0045, 0.0, 0.110),
                    (s * 0.0045, 0.0, COLLAR_Z1 - 0.004)]
            fil.sweep(path, 0.0008, sw, STEEL)
    else:
        fil.cyl(COIL_R + COIL_r, -COIL_X, COIL_X, LED, 6, m=kit.at(0, 0, BULB_Z) @ kit.X_AXIS)
    fil.colors['led'] = _m2.led_attr(led_group)
    pieces = {'base': base, 'bulb': bulb, 'filament': fil}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.lamp.bone', (0, BASE_W / 2, 0.026), (0, 1, 0), (0, 0, 1), 0.05),
        kit.decal_plane('picto.hot_surface.mono', (BASE_W / 2, 0, 0.040), (1, 0, 0), (0, 0, 1), 0.022, 0.022),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,2,1', 0.5, 'bottom', 2200,
        'Light bulb: graphite base (top z 0.07) on four FOOT_S, Volt trim band, threaded steel collar, a 1.5 mm '
        'kn_glass bulb shell (Ø 0.088 at z 0.148, tip 0.196) with a 3-turn kn_led filament coil (group 0) on '
        'steel supports. PR-S power in on a 1 mm front boss. Decals: name plate on the base back, hot-surface '
        'pictogram (mono) on the +X side. Brief: docs/art/briefs/power_signal.md#lamp. Collar thread normal map '
        'deferred (thread ribs modelled at LOD0).',
        MASTERS, led_groups='0:filament')
    part.build_lods(build, lod0_q=1.3)
    part.col_box('base', (BASE_W, BASE_W, BAND[1]), (0, 0, BAND[1] / 2), phys='powder', restitution=0.25,
                 friction=0.5)
    part.col_sphere('bulb', BULB_R, (0, 0, BULB_Z), phys='glass', restitution=0.3, friction=0.3)
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    part.emit('light', 'bulb', (0, 0, BULB_Z), (0, 0, 1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
