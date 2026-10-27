"""Procedurally build the TREADWAY source file (docs/art/briefs/drive.md, "TREADWAY: Modular conveyor").

Usage: blender -b --factory-startup -P tools/blender/make_treadway.py -- [out.blend]
Default output: assets/src/drive/treadway.blend

The catalogue TREADWAY (parts-data: 0.60 x 0.10 x 0.20, origin bottom centre): end_l + 4 x mid + end_r as one
assembly. Graphite side rails (lip 8 mm above the belt) and base, a kn_rubber_grip belt looped round two steel
drums (Ø 0.06, centre z 0.058, belt 4 mm, top dead flat at z 0.092), Ignition end guards with rounded outer
corners, M5 screws, two kn_led chevrons per end (group 0 dir_fwd on the front guards, group 1 dir_rev on the
back), a 4 mm rubber foot strip, and the two PR-M spin rings on the front guards over the drum axles.
PIVOT__drum_l / PIVOT__drum_r (axis y) carry the drums; the belt scrolls by UV in the engine.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import math  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'treadway'
L, D, H = 0.60, 0.20, 0.10
DRUM_X, DRUM_Z, DRUM_R, BELT_T, BELT_HW = 0.25, 0.058, 0.030, 0.004, 0.078
FEET = 0.004
G, IGN, GRIP, STEEL, RUBBER, LED = ('kn_powder_graphite', 'kn_powder_ignition', 'kn_rubber_grip',
                                    'kn_steel_brushed', 'kn_rubber', 'kn_led')
MASTERS = [G, IGN, GRIP, STEEL, RUBBER, LED]
GUARD_Y0, GUARD_Y1 = 0.0785, 0.1015


def stadium(n):
    """Belt mid-surface path round both drums, as (Z, X) pairs for the Y_AXIS frame, CCW."""
    r = DRUM_R + BELT_T / 2
    pts = []
    for cx, a0 in ((DRUM_X, -math.pi / 2), (-DRUM_X, math.pi / 2)):
        for i in range(n + 1):
            a = a0 + math.pi * i / n
            pts.append((DRUM_Z + r * math.sin(a), cx + r * math.cos(a)))
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts)))
    return pts if area > 0 else list(reversed(pts))


def chevron(kit_, x, y, sign, simple=False):
    """A kn_led chevron 12 x 12 mm pointing along sign * X, 1.5 mm proud of the guard top."""
    pts = [(-0.006, -0.006), (-0.001, -0.006), (0.006, 0.0), (-0.001, 0.006), (-0.006, 0.006), (0.0005, 0.0)]
    if simple:  # LOD3: a triangle, so the direction still reads
        pts = [(-0.005, -0.006), (0.006, 0.0), (-0.005, 0.006)]
    pts = [(sign * px, sign * py) for px, py in pts]
    kit_.prism(pts, H - 0.001, H + 0.0015, LED, m=kit.at(x, y, 0))


def led_groups(centre, _normal, master):
    if master != LED:
        return (0.0, 0.0, 0.0, 1.0)
    return ((0.0 if centre.y < 0 else 1.0) / 255.0, 0.08, 0.0, 1.0)  # R = group, G = idle brightness


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    body = Kit()
    bev = (0.004, 0.003, 0.002, 0.0)[lod]
    for s in (-1, 1):  # side rails
        body.rbox((0.46, 0.02, H - FEET), (0, s * 0.09, FEET + (H - FEET) / 2), bev, G, cseg=cs)
    body.rbox((0.46, 0.16, 0.016), (0, 0, FEET + 0.008), 0.0, G, cseg=0, rz=0.0)
    guard = kit.outline_rrect(0.10, H - FEET, 0.03, max(2, seg(8, q, 2)))
    for sx in (-1, 1):  # Ignition end guards, both sides; outline in (Z, X)
        gl = [(z + FEET + (H - FEET) / 2, x * 1 + sx * 0.25) for x, z in guard]
        gl = list(reversed(gl))
        for sy in (-1, 1):
            y0, y1 = (GUARD_Y0, GUARD_Y1) if sy > 0 else (-GUARD_Y1, -GUARD_Y0)
            if lod == 3:
                body.rbox((0.10, y1 - y0, H - FEET), (sx * 0.25, (y0 + y1) / 2, FEET + (H - FEET) / 2), 0.0, IGN,
                          cseg=0, rz=0.0)
                continue
            body.prism(gl, y0, y1, IGN, bt=0.003, bb=0.003, bseg=cs, m=kit.Y_AXIS)
    belt = [(-BELT_T / 2, -BELT_HW), (BELT_T / 2, -BELT_HW), (BELT_T / 2, BELT_HW), (-BELT_T / 2, BELT_HW)]
    body.ring_sweep(stadium(seg(14, q, 3)), belt, GRIP, m=kit.Y_AXIS)
    if lod < 3:
        for y in (-0.07, 0.07):  # 4 mm foot strip
            body.rbox((0.56, 0.01, FEET + 0.001), (0, y, (FEET + 0.001) / 2), 0.004, RUBBER, cseg=max(1, cs - 1),
                      rz=0.0015 if lod < 2 else 0.0)
    for sx in (-1, 1):  # chevrons: fwd (+X) on the front guards, rev (-X) on the back guards
        chevron(body, sx * 0.235, -0.09, 1, lod == 3)
        chevron(body, sx * 0.235, 0.09, -1, lod == 3)
    if lod < 2:  # M5 heads, 2 per guard face (front and back)
        prof = [(0.0, -0.0006, STEEL), (0.00425, -0.0006, STEEL), (0.00425, 0.0007, STEEL), (0.0036, 0.0017, STEEL),
                (0.0021, 0.0024, STEEL), (0.0, 0.0026, STEEL)]
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (0.022, 0.084):
                    body.lathe(prof, seg(12, q, 6), kit.frame((sx * 0.212, sy * GUARD_Y1, z), (0, sy, 0)))
    body.colors['led'] = led_groups
    out = {'frame': body}
    for name, sx in (('drum_l', -1), ('drum_r', 1)):
        d = Kit(pivot='PIVOT__' + name)
        d.cyl(DRUM_R, -BELT_HW, BELT_HW, STEEL, seg(28, q, 8 if lod < 3 else 6), bev=0.002 if lod < 2 else 0.0,
              bseg=1,
              m=kit.at(sx * DRUM_X, 0, DRUM_Z) @ kit.Y_AXIS)
        if lod < 3:
            d.cyl(0.006, -GUARD_Y1 + 0.001, GUARD_Y1 - 0.001, STEEL, seg(12, q, 6),
                  m=kit.at(sx * DRUM_X, 0, DRUM_Z) @ kit.Y_AXIS)
        out[name] = d
    # Name plate on the right guard front, pinch-point pictogram on the left guard front (under the rings).
    n, up = (0, -1, 0), (0, 0, 1)
    decals = [kit.decal_plane('name.treadway.graphite', (0.255, -GUARD_Y1, 0.020), n, up, 0.06),
              kit.decal_plane('picto.pinch_point.warn', (-0.255, -GUARD_Y1, 0.021), n, up, 0.016, 0.016)]
    return kit.add_decals(out, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'M', '6,1,2', 2.3, 'bottom', 3200,
        'Conveyor at the catalogue 0.6 m (end_l + 4 mid + end_r in one file). Brief: docs/art/briefs/drive.md'
        '#treadway. Deferred: module split for the engine-side resize, belt chevron normal + uv_scroll UVs, '
        'the 2048 set, Bone / Workshop skins. Decals: name plate (right guard), pinch-point pictogram (left).',
        MASTERS, led_groups='0:dir_fwd,1:dir_rev')
    part.pivot('drum_l', (-DRUM_X, 0, DRUM_Z), 'y')
    part.pivot('drum_r', (DRUM_X, 0, DRUM_Z), 'y')
    part.build_lods(build, lod0_q=1.2)
    part.col_box('belt', (0.58, 0.16, 0.012), (0, 0, 0.086), phys='rubber', restitution=0.2, friction=1.0,
                 surface_velocity='x')
    for s, nm in ((-1, 'rail_l'), (1, 'rail_r')):
        part.col_box(nm, (L, 0.02, H - FEET), (0, s * 0.09, FEET + (H - FEET) / 2), phys='powder')
    part.col_box('base', (L, 0.16, 0.08), (0, 0, 0.04), phys='powder')
    for s, nm in ((-1, 'drive_l'), (1, 'drive_r')):
        part.port('spin', nm, (s * DRUM_X, -0.101, DRUM_Z), (0, -1, 0), 'M', 'both', kind='axle')
        part.emit('jam', 'drum' + nm[-2:], (s * DRUM_X, 0, DRUM_Z), (0, 0, 1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
