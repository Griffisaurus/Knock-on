"""Procedurally build the BLOWOUT source file (docs/art/briefs/air.md, "BLOWOUT: Hot-air blower").

Usage: blender -b --factory-startup -P tools/blender/make_blowout.py -- [out.blend]
Default output: assets/src/air/blowout.blend

A retro hair dryer in a dock: a kn_powder_bone dock (0.12 x 0.09 x 0.045, FOOT_S, PR-S power `in` on its front), a
thick bone handle leaning 10° with a kn_rubber inlay (brief: kn_rubber_grip, see M4_NOTES_E4a) and a beam
slider, and a bone barrel (Ø 0.085 along X,
x -0.09 ... 0.045, z 0.15) with a kn_poly_amber window band (x -0.04 ... 0.0) over a kn_copper heater coil (kn_led
filament, group 0), a kn_steel_brushed rear grille over six amber fan blades on PIVOT__fan (x), and a kn_powder_beam
concentrator nozzle flattening to a 0.07 x 0.03 slot at x 0.10. Rounded everywhere, flared nozzle, no trigger: a
toy dryer, not a gun. Status LED (group 1) on the barrel top, hot-surface pictogram on the nozzle top.
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

TYPE = 'blowout'
BONE, BEAM, AMBER, COPPER, STEEL, RUBBER, GRIP, LED, G = (
    'kn_powder_bone', 'kn_powder_beam', 'kn_poly_amber', 'kn_copper', 'kn_steel_brushed', 'kn_rubber',
    'kn_rubber_grip', 'kn_led', 'kn_powder_graphite')
MASTERS = [BONE, BEAM, AMBER, COPPER, STEEL, RUBBER, GRIP, LED, G]
BZ, BR = 0.15, 0.0425
X_REAR, X_WIN0, X_WIN1, X_NOZ0, X_NOZ1 = -0.09, -0.04, 0.0, 0.045, 0.10
DOCK_C, DOCK_S = Vector((-0.005, 0.0, 0.0245)), (0.12, 0.09, 0.041)
PORT = (0.0, -0.046, 0.027)
FAN_X = -0.081
HANDLE_BOT, HANDLE_TOP = Vector((-0.012, 0.0, 0.040)), Vector((-0.024, 0.0, BZ - 0.02))


def nozzle_rings(n, rows):
    """Loft from the round barrel (r 0.04 at x 0.045) to the 0.07 x 0.03 slot at x 0.10 (polar-sampled)."""
    out = []
    for k in range(rows + 1):
        t = k / rows
        s = t * t * (3 - 2 * t)
        ci = _m4.polar_circle(0.0405, n, start=math.pi / n)
        sl = _m4.polar_rrect(0.070, 0.030, 0.010, n, start=math.pi / n)
        x = X_NOZ0 + (X_NOZ1 - X_NOZ0) * t
        out.append([(x, a[0] * (1 - s) + b[0] * s, BZ + a[1] * (1 - s) + b[1] * s) for a, b in zip(ci, sl)])
    return out


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    n = seg(48, q, 8, 4)
    body = Kit()
    ax = kit.frame((0, 0, BZ), 'x')
    # barrel: bone rear housing, amber window band (hollow) over the heater, bone front, all along X
    rear = [(0.0, X_REAR + 0.002, BONE), (BR - 0.004, X_REAR + 0.002, BONE), (BR, X_REAR + 0.008, BONE),
            (BR, X_WIN0 + 0.001, BONE), (0.0, X_WIN0 + 0.001, BONE)] if lod < 3 else \
        [(0.0, X_REAR, BONE), (BR, X_REAR, BONE), (BR, X_WIN0, BONE), (0.0, X_WIN0, BONE)]
    body.lathe(rear, n, m=ax)
    body.lathe([(0.0, X_WIN1 - 0.001, BONE), (BR, X_WIN1 - 0.001, BONE), (BR, X_NOZ0 + 0.001, BONE),
                (0.0, X_NOZ0 + 0.001, BONE)], n, m=ax)
    window = Kit()
    if lod < 3:
        window.lathe([(BR - 0.003, X_WIN0, AMBER), (BR + 0.0005, X_WIN0, AMBER), (BR + 0.0005, X_WIN1, AMBER),
                      (BR - 0.003, X_WIN1, AMBER)], n, m=ax, closed=True)
        # heater: copper coil round a led filament rod
        _m2.coil(body, 0.026, 0.0022, X_WIN0 + 0.002, X_WIN1 - 0.002, 4.5, COPPER, q, lod, m=ax)
        body.cyl(0.006, X_WIN0, X_WIN1, LED, seg(12, q, 6), m=ax)
    else:
        window.cyl(BR, X_WIN0, X_WIN1, AMBER, n, m=ax)
    # rear grille ring + spokes (steel), fan hub housing
    if lod < 2:
        gx = X_REAR - 0.001
        for rr in (0.014, 0.026, 0.037):
            body.torus(rr, 0.0011, STEEL, seg(int(rr * 1100), q, 8), (6, 4)[lod], m=kit.frame((gx, 0, BZ), 'x'))
        for k in range(8):
            a = 2 * math.pi * k / 8
            d = Vector((0.0, math.cos(a), math.sin(a)))
            p0 = Vector((gx, 0, BZ)) + d * 0.006
            body.sweep([p0, p0 + d * 0.0335], 0.0010, (6, 4)[lod], STEEL)
        body.cyl(0.006, gx - 0.0012, gx + 0.0012, STEEL, seg(12, q, 6), m=kit.frame((0, 0, BZ), 'x'))
        body.torus(BR - 0.002, 0.0022, STEEL, n, (8, 6)[lod], m=kit.frame((X_REAR + 0.001, 0, BZ), 'x'))
    else:
        body.cyl(BR - 0.002, X_REAR - 0.002, X_REAR + 0.002, STEEL, n, m=ax)
    # nozzle (beam) lofted to the slot, with a dark recessed throat
    rows = (6, 4, 2, 1)[lod]
    rings = nozzle_rings(n, rows)
    _m4.loft(body, rings, BEAM, mats=None)
    if lod < 3:
        th = _m4.polar_rrect(0.060, 0.020, 0.006, n, start=math.pi / n)
        body.prism([(y, z) for y, z in th], -0.003, 0.0004, G, m=kit.frame((X_NOZ1, 0, BZ), 'x', spin=math.pi / 2))
    # handle: thick leaning capsule into the dock, grip inlay, beam slider
    d = (HANDLE_TOP - HANDLE_BOT)
    body.rbox((0.030, 0.032, d.length + 0.02), (0, 0, 0), 0.012 if lod < 3 else 0.006, BONE, cseg=cs,
              rz=0.006 if lod < 3 else 0.0,
              m=Matrix.Translation((HANDLE_BOT + HANDLE_TOP) / 2) @ kit.rot_y(-10))
    if lod < 3:
        body.rbox((0.003, 0.008, d.length * 0.62), (0.0162, 0, 0), 0.0015 if lod < 2 else 0.0, RUBBER, cseg=1,
                  m=Matrix.Translation((HANDLE_BOT + HANDLE_TOP) / 2 + Vector((0, 0, -0.004))) @ kit.rot_y(-10))
        body.rbox((0.010, 0.006, 0.014), (0, -0.0165, 0.012), 0.002 if lod < 2 else 0.0, BEAM, cseg=1,
                  m=Matrix.Translation((HANDLE_BOT + HANDLE_TOP) / 2) @ kit.rot_y(-10))
    # dock + feet
    body.rbox(DOCK_S, tuple(DOCK_C), 0.012 if lod < 3 else 0.004, BONE, cseg=cs, rz=0.005 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'S', DOCK_C.x + sx * 0.045, sy * 0.032, min(1.0, q), lod)
    for sx in (-1, 1):
        _m2.screw(body, 'M3', (DOCK_C.x + sx * 0.048, -0.02, DOCK_C.z + DOCK_S[2] / 2), (0, 0, 1), q, lod)
    _m2.led_dome(body, 6, (-0.065, 0.0, BZ + BR), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (1, 0.08) if c.z > BZ + 0.03 else (0, 0.0))
    fan = Kit(pivot='PIVOT__fan')
    if lod < 2:
        for k in range(6):
            a = 2 * math.pi * k / 6
            u = Vector((0.0, math.cos(a), math.sin(a)))
            t = Vector((0.0, -math.sin(a), math.cos(a)))
            basis = Matrix((u, t, u.cross(t))).transposed().to_4x4()
            fan.rbox((0.028, 0.013, 0.002), (0, 0, 0), 0.004, AMBER, cseg=1,
                     m=Matrix.Translation(Vector((FAN_X, 0, BZ)) + u * 0.021) @ basis @ kit.rot_x(28))
        fan.cyl(0.0085, -0.005, 0.005, BONE, seg(16, q, 6), bev=0.002, bseg=1, m=kit.frame((FAN_X, 0, BZ), 'x'))
    else:
        fan.cyl(0.035, -0.0012, 0.0012, AMBER, seg(16, q, 6), m=kit.frame((FAN_X, 0, BZ), 'x'))
    pieces = {'body': body, 'window': window, 'fan': fan}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.blowout.graphite', (X_WIN1 + 0.0225, -BR * 0.94, BZ + BR * 0.34),
                        (0, -0.94, 0.34), (0, 0.34, 0.94), 0.04, lift=0.0006),
        kit.decal_plane('picto.hot_surface.warn', (0.075, 0.0, BZ + 0.0172), (0, 0, 1), (1, 0, 0), 0.016, 0.016,
                        lift=0.0008),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'air', 'M', '2,2,1', 0.9, 'bottom', 7500,
        'Hot-air blower: kn_powder_bone dock (0.12 x 0.09 x 0.045, FOOT_S, M3 screws, PR-S power `in` on its front), '
        'thick bone handle leaning 10° (kn_rubber inlay, beam slider), bone barrel Ø 0.085 along X (x -0.09 ... '
        '0.045, z 0.15) with a kn_poly_amber window band (x -0.04 ... 0) over a kn_copper coil and kn_led filament '
        '(group 0 heater), steel rear grille over six amber blades on PIVOT__fan (x), kn_powder_beam nozzle lofted to '
        'a 0.07 x 0.03 slot at x 0.10 (dark throat). Status LED_D6 (group 1) on the barrel top; name plate on the '
        'front barrel, hot-surface pictogram on the nozzle top. Not a gun: rounded, thick handle into a dock, no '
        'trigger. Brief: docs/art/briefs/air.md#blowout.',
        MASTERS, led_groups='0:heater,1:status', skins='air,graphite')
    part.pivot('fan', (FAN_X, 0, BZ), 'x')
    part.build_lods(build, lod0_q=1.2)
    part.col_box('dock', DOCK_S, tuple(DOCK_C), phys='powder', restitution=0.2, friction=0.6)
    d = HANDLE_TOP - HANDLE_BOT
    part.col_capsule('handle', 0.015, d.length + 0.02, tuple((HANDLE_BOT + HANDLE_TOP) / 2), tuple(d), phys='powder')
    part.col_cyl('barrel', BR, X_NOZ0 - X_REAR, ((X_NOZ0 + X_REAR) / 2, 0, BZ), 'x', phys='powder')
    part.col_box('nozzle', (X_NOZ1 - X_NOZ0, 0.07, 0.06), ((X_NOZ0 + X_NOZ1) / 2, 0, BZ), phys='powder')
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    for fx in ('wind', 'heat', 'haze'):
        part.emit(fx, 'nozzle', (X_NOZ1, 0, BZ), (1, 0, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
