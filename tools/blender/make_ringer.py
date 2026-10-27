"""Procedurally build the RINGER source file (docs/art/briefs/power_signal.md, "RINGER: Alarm-clock timer").

Usage: blender -b --factory-startup -P tools/blender/make_ringer.py -- [out.blend]
Default output: assets/src/power/ringer.blend

A twin-bell alarm clock as a lab timer: a pillowed graphite body (0.09 x 0.06 x 0.062, z 0.018-0.08) on two bent
chrome sled legs (one each side, front and back rubber tips), two kn_powder_amber bell domes (Ø 0.034 at x
+-0.026, z 0.082-0.099) on chrome posts, a brass hammer on PIVOT__hammer (axis y at (0, 0, 0.083), +-25°) in a
steel bracket between them, a steel butterfly winding key on the back (to y 0.04), an LED_D6 on the top front
(group 0 armed) and the SCR_7SEG_4 countdown (0.044 x 0.020, 16 mm digits) in a graphite bezel under glass on the
front. Signal out (PR-S, +X). The legs reach y -0.0425 so the depth fills the 1-cell footprint inside +-0.02.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'ringer'
BODY = (0.09, 0.06, 0.062)
BODY_Z0, BODY_Z1 = 0.018, 0.08
CZ = (BODY_Z0 + BODY_Z1) / 2
BELL_X, BELL_R, BELL_Z0, BELL_Z1 = 0.026, 0.017, 0.082, 0.099
HAMMER = Vector((0.0, 0.0, 0.083))
SCR_W, SCR_H = 0.044, 0.020
SCR_C = Vector((0.0, -0.031, 0.050))
BEZ_DEPTH = 0.006
LEG_X, LEG_R, TIP_R = 0.032, 0.0025, 0.0045
KEY_Z = 0.061
LED_POS = (0.0, -0.019)
G, CHROME, STEEL, RUBBER, AMBER, BRASS, SCREEN, GLASS, LED = (
    'kn_powder_graphite', 'kn_chrome', 'kn_steel_brushed', 'kn_rubber', 'kn_powder_amber', 'kn_brass', 'kn_screen',
    'kn_glass', 'kn_led')
MASTERS = [G, CHROME, STEEL, RUBBER, AMBER, BRASS, SCREEN, GLASS, LED, 'kn_decal']


def rounded_path(pts, rad, n):
    """Polyline with every inner corner replaced by a quadratic Bezier of `n` steps reaching `rad` along each
    leg (bent rod)."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        p0 = b + (a - b).normalized() * min(rad, (a - b).length / 2)
        p2 = b + (c - b).normalized() * min(rad, (c - b).length / 2)
        for k in range(n + 1):
            t = k / n
            out.append(p0 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p2 * t * t)
    out.append(pts[-1])
    return out


def led_group(_c, _n):
    return 0, 0.08


def bell_profile(lod, q):
    """Dome shell: inner pole -> inner curve -> lip -> outer curve -> top pole (closed lathe)."""
    n = max(2, seg(7, q, 2)) if lod < 2 else 2
    inner, outer = [], []
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        outer.append((BELL_R * math.cos(a), BELL_Z0 + (BELL_Z1 - BELL_Z0) * math.sin(a)))
        inner.append(((BELL_R - 0.0016) * math.cos(a), BELL_Z0 + (BELL_Z1 - BELL_Z0 - 0.002) * math.sin(a)))
    prof = [(0.0, inner[-1][1], AMBER)] + [(r, z, AMBER) for r, z in reversed(inner[:-1])]
    if lod < 2:  # rolled lip
        prof.append((BELL_R + 0.0004, BELL_Z0 - 0.0006, AMBER))
    prof += [(r, z, AMBER) for r, z in outer[:-1]] + [(0.0, BELL_Z1, AMBER)]
    return prof


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.rbox(BODY, (0, 0, CZ), 0.011 if lod < 3 else 0.006, G, cseg=cs, rz=0.007 if lod < 3 else 0.0)
    # countdown screen (SCR_7SEG_4) in its bezel: the quad lands on SCR_C
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    base_c = SCR_C - n * (BEZ_DEPTH - 0.0015)
    c = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(base_c), tuple(n), tuple(up), lod, q,
                                depth=BEZ_DEPTH))
    for x in (-0.036, 0.036):  # two M3 heads flanking the screen
        _m2.screw(body, 'M3', (x, -BODY[1] / 2, CZ), (0, -1, 0), min(1.0, q * 0.7), lod)

    # bells on chrome posts with cap nuts
    for s in (-1, 1):
        if lod < 3:
            body.lathe(bell_profile(lod, q), seg(28, q, 8), kit.at(s * BELL_X, 0, 0))
        else:
            body.lathe([(0.0, BELL_Z0, AMBER), (BELL_R, BELL_Z0, AMBER), (BELL_R * 0.72, BELL_Z1 - 0.004, AMBER),
                        (0.0, BELL_Z1, AMBER)], 6, kit.at(s * BELL_X, 0, 0))
        if lod < 3:
            body.cyl(0.0022, BODY_Z1 - 0.002, BELL_Z1 - 0.003, CHROME, seg(10, q, 4), m=kit.at(s * BELL_X, 0, 0))
            body.cyl(0.0028, BELL_Z1 - 0.0008, BELL_Z1 + 0.0018, CHROME, 6, bev=0.0006 if lod < 2 else 0.0,
                     bseg=1, m=kit.at(s * BELL_X, 0, 0))
    # hammer bracket: two steel cheeks round the hub
    if lod < 3:
        for s in (-1, 1):
            body.prism(kit.outline_rrect(0.008, 0.002, 0.0009, 1 if lod < 2 else 0), BODY_Z1 - 0.002,
                       HAMMER.z + 0.004, STEEL, bt=0.0008 if lod < 2 else 0.0, bseg=1,
                       m=kit.at(0, s * 0.0045, 0))
    # armed LED, top front between the bells
    _m2.led_dome(body, 6, (LED_POS[0], LED_POS[1], BODY_Z1), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(led_group)
    # winding key on the back: steel stem + butterfly wings, outer face at y 0.04
    yb = BODY[1] / 2
    body.cyl(0.0024, -0.001, 0.0055, STEEL, seg(10, q, 4), m=kit.frame((0, yb, KEY_Z), 'y'))
    wing_cs = (2, 1, 1, 0)[lod]
    for s in (-1, 1):
        body.prism(kit.outline_rrect(0.0115, 0.009, 0.0035, wing_cs), yb + 0.0052, yb + 0.010, STEEL,
                   bt=0.0008 if lod < 2 else 0.0, bb=0.0008 if lod < 2 else 0.0, bseg=1,
                   m=kit.at(s * 0.0062, 0, KEY_Z) @ kit.rot_x(-90))
    # sled legs: one bent chrome rod per side, rubber ball tips front and back
    bend_n = (4, 2, 1, 0)[lod]
    for s in (-1, 1):
        x = s * LEG_X
        zt = TIP_R if lod < 3 else LEG_R
        pts = [(x, -0.038, zt), (x, -0.024, BODY_Z0 + 0.0015), (x, 0.020, BODY_Z0 + 0.0015), (x, 0.034, zt)]
        path = rounded_path(pts, 0.008, bend_n) if bend_n else [Vector(p) for p in pts]
        body.sweep(path, LEG_R, seg(8, q, 4) if lod < 3 else 4, CHROME)
        if lod < 3:
            for y in (-0.038, 0.034):
                body.sphere(TIP_R, RUBBER, seg(12, q, 6), (6, 4, 4, 2)[lod], m=kit.at(x, y, TIP_R))

    hammer = Kit(pivot='PIVOT__hammer')
    hammer.cyl(0.0028, -0.0034, 0.0034, BRASS, seg(12, q, 4), bev=0.0006 if lod < 2 else 0.0, bseg=1,
               m=kit.frame(HAMMER, 'y'))
    hammer.cyl(0.0013, 0.0, 0.0095, BRASS, seg(8, q, 4), m=kit.at(*HAMMER))
    hammer.sphere(0.0042, BRASS, seg(14, q, 6), seg(8, q, 4, 2),
                  m=kit.at(HAMMER.x, HAMMER.y, HAMMER.z + 0.0105) @ Matrix.Diagonal((1.5, 1.0, 1.0, 1.0)))

    pieces = {'body': body, 'hammer': hammer,
              'screen': kit.screen_quad(tuple(c), tuple(n), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.ringer.bone', (0, yb, 0.034), (0, 1, 0), (0, 0, 1), 0.05),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'M', '1,1,1', 0.5, 'bottom', 4500,
        'Alarm-clock timer: graphite body on chrome sled legs, twin amber bells, brass hammer, steel winding key, '
        'SCR_7SEG_4 countdown (MM:SS) under glass. Brief: docs/art/briefs/power_signal.md#ringer. The two legs are '
        'bent rods with rubber tips front and back so the depth fills the cell. Decals: name plate on the back. '
        'Hammer is a procedural pivot; no clips.',
        MASTERS, led_groups='0:armed')
    part.pivot('hammer', tuple(HAMMER), 'y', -25.0, 25.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('body', (BODY[0], 0.08, BODY_Z1), (0, -0.002, BODY_Z1 / 2), phys='powder', restitution=0.25,
                 friction=0.5)
    part.col_box('bells', (2 * (BELL_X + BELL_R), 2 * BELL_R, BELL_Z1 - BELL_Z0 + 0.002),
                 (0, 0, (BELL_Z0 + BELL_Z1) / 2), phys='powder', restitution=0.3, friction=0.4)
    part.port('signal', 'out', (0.046, 0, 0.050), (1, 0, 0), 'S', 'out', max_links=8)
    part.emit('sound', 'bells', (0, 0, 0.09), (0, 0, 1))
    n = Vector((0, -1, 0))
    c = SCR_C
    part.screen('countdown', SCR_W, SCR_H, tuple(c + n * 0.0002), tuple(n), (0, 0, 1), kind='7seg', digits=4,
                color='signal')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
