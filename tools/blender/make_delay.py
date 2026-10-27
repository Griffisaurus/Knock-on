"""Procedurally build the DELAY source file (docs/art/briefs/power_signal.md, "DELAY: Signal delay box").

Usage: blender -b --factory-startup -P tools/blender/make_delay.py -- [out.blend]
Default output: assets/src/power/delay.blend

A pillowed graphite logic cube (0.09 x 0.09 x 0.08, 8 mm pillow) on four FOOT_S bumpers with four M3 heads on the
front. On top: the knurled Volt setting knob (Ø 0.034 x 0.014) on PIVOT__knob (axis z, 0...300°, modelled at 0
with its steel pointer facing -Y) ringed by 12 kn_led dots (group 1 progress). Front: the SCR_7SEG_3 delay readout
(0.034 x 0.020) in a graphite bezel under glass, an in -> out arrow decal, and a kn_poly_clear window (0.05 x 0.025)
over a pocket where a brass escapement wheel turns on PIVOT__escapement (axis y). Status LED_D6 (group 0) beside
the signal in port (-X, PR-S, max 4); signal out on +X (PR-S, max 8). Name plate on the back.
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

TYPE = 'delay'
FEET = 0.003
BOX = (0.09, 0.09, 0.08)
TOP = FEET + BOX[2]                       # 0.083
FRONT = -BOX[1] / 2                       # -0.045
KNOB = Vector((0.0, 0.0, TOP))
KNOB_R, KNOB_H = 0.017, 0.014
DOT_R = 0.0255
WIN_C = Vector((0.0, -0.0455, 0.028))
WIN_W, WIN_H = 0.05, 0.025
ESC = Vector((0.0, -0.0375, 0.028))      # escapement wheel centre (pivot), inside the window pocket
POCKET_BACK = -0.032
SCR_W, SCR_H = 0.034, 0.020
SCR_C = Vector((0.0, -0.0455, 0.062))
BEZ_DEPTH = 0.006
STATUS = Vector((-0.045, -0.027, 0.045))
G, VOLT, RUBBER, STEEL, POLY, BRASS, SCREEN, GLASS, LED = (
    'kn_powder_graphite', 'kn_anod_volt', 'kn_rubber', 'kn_steel_brushed', 'kn_poly_clear', 'kn_brass', 'kn_screen',
    'kn_glass', 'kn_led')
MASTERS = [G, VOLT, RUBBER, STEEL, POLY, BRASS, SCREEN, GLASS, LED, 'kn_decal']


def led_group(c, _n):
    # the progress ring sits on the top face; the status dot is on the -X side
    if c.z > TOP - 0.002:
        return 1, 0.08
    return 0, 0.08


def star(r_out, r_in, n):
    """Knurl outline: 2n points alternating r_out / r_in (CCW)."""
    return [((r_out if i % 2 == 0 else r_in) * math.cos(math.pi * i / n),
             (r_out if i % 2 == 0 else r_in) * math.sin(math.pi * i / n)) for i in range(2 * n)]


def escape_outline(n_teeth, r_out, r_root):
    """Escape-wheel sawtooth (CCW): each tooth rises along the circle and drops radially."""
    pts = []
    for i in range(n_teeth):
        a0 = 2 * math.pi * i / n_teeth
        a1 = 2 * math.pi * (i + 0.72) / n_teeth
        pts.append((r_root * math.cos(a0), r_root * math.sin(a0)))
        pts.append((r_out * math.cos(a1), r_out * math.sin(a1)))
        pts.append((r_root * math.cos(a1 + 0.02), r_root * math.sin(a1 + 0.02)))
    return pts


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.rbox(BOX, (0, 0, FEET + BOX[2] / 2), 0.008 if lod < 3 else 0.004, G, cseg=cs, rz=0.007 if lod < 3 else 0.0)
    if lod < 2:  # window pocket (LOD2+: the pane sits on the flat face)
        pocket = Kit()
        pocket.prism(kit.outline_rrect(WIN_W - 0.004, WIN_H - 0.004, 0.0015, 2), 0.0, 0.02, G,
                     m=kit.at(0, POCKET_BACK, WIN_C.z) @ kit.FRONT_OUT)
        body = kit.boolean_diff(body, [pocket], mats)
    # readout bezel: the quad lands on SCR_C
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    c = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C - n * (BEZ_DEPTH - 0.0015)), tuple(n),
                                tuple(up), lod, q, depth=BEZ_DEPTH))
    # clear window over the pocket
    body.rbox((WIN_W, 0.0015, WIN_H), tuple(WIN_C), 0.002 if lod < 3 else 0.0, POLY, cseg=max(1, cs - 1),
              rz=0.0005 if lod < 2 else 0.0)
    for x in (-0.035, 0.035):  # M3 heads, front corners
        for z in (0.016, 0.070):
            _m2.screw(body, 'M3', (x, FRONT, z), (0, -1, 0), min(1.0, q * 0.6), lod)
    for x in (-0.033, 0.033):  # FOOT_S x 4 (LOD1 takes the 8-sided prism)
        for y in (-0.033, 0.033):
            _m2.foot(body, 'S', x, y, min(1.0, q * 0.6), lod if lod != 1 else 2, top=0.0006)
    # 12-dot progress ring round the knob, and the status dot by the input port
    for i in range(12):
        a = math.pi / 2 - 2 * math.pi * i / 12  # dot 0 at the back (12 o'clock seen from the front-top)
        p = (DOT_R * math.cos(a), DOT_R * math.sin(a), TOP - 0.0004)
        if lod < 3:
            body.sphere(0.0019, LED, seg(8, q, 4), (3, 2, 2, 2)[lod], m=kit.at(*p), sz_bot=0.2, sz_top=0.75)
        else:  # LOD3: a 4-tri pip per dot
            body.hull([(p[0] + 0.0019 * math.cos(b), p[1] + 0.0019 * math.sin(b), p[2]) for b in (a, a + 2.1, a - 2.1)]
                      + [(p[0], p[1], p[2] + 0.0012)], LED)
    _m2.led_dome(body, 6, tuple(STATUS), (-1, 0, 0), q, lod)
    body.colors['led'] = _m2.led_attr(led_group)

    knob = Kit(pivot='PIVOT__knob')
    nk = seg(20, q, 6)
    if lod < 2:
        knob.prism(star(KNOB_R, KNOB_R - 0.0009, nk), TOP - 0.0005, TOP + KNOB_H, VOLT, bt=0.0012, bseg=2)
        knob.cyl(KNOB_R - 0.0028, TOP + KNOB_H - 0.001, TOP + KNOB_H + 0.0004, VOLT, nk, bev=0.0004, bseg=1)
    else:
        knob.prism(kit.outline_circle(KNOB_R, nk), TOP - 0.0005, TOP + KNOB_H, VOLT,
                   bt=0.0012 if lod < 3 else 0.0, bseg=1)
    # steel pointer inlay pointing -Y at the rest pose (0°)
    knob.rbox((0.0026, 0.011, 0.0014), (0, -0.0085, TOP + KNOB_H + 0.0001), 0.0012 if lod < 3 else 0.0, STEEL,
              cseg=1, rz=0.0)

    esc = Kit(pivot='PIVOT__escapement')
    if lod < 2:
        wheel = Kit()
        wheel.prism(escape_outline(15, 0.0088, 0.0072), -0.00075, 0.00075, BRASS, m=kit.frame(ESC, 'y'))
        holes = Kit()
        for i in range(4):
            a = math.pi / 4 + math.pi / 2 * i
            holes.cyl(0.0017, -0.002, 0.002, BRASS, seg(10, q, 6),
                      m=kit.frame(ESC + Vector((0.0046 * math.cos(a), 0, 0.0046 * math.sin(a))), 'y'))
        esc.merge(kit.boolean_diff(wheel, [holes], mats))
        esc.cyl(0.0012, -0.0022, POCKET_BACK - ESC.y + 0.001, STEEL, seg(10, q, 5), m=kit.frame(ESC, 'y'))
        esc.cyl(0.0024, -0.0012, 0.0012, BRASS, seg(12, q, 5), m=kit.frame(ESC, 'y'))
    elif lod == 2:
        esc.prism(kit.outline_circle(0.0085, seg(15, q, 6)), -0.00075, 0.00075, BRASS, m=kit.frame(ESC, 'y'))

    pieces = {'body': body, 'knob': knob, 'escapement': esc,
              'screen': kit.screen_quad(tuple(c), tuple(n), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('mark.arrow_out.bone', (0, FRONT, 0.0443), (0, -1, 0), (0, 0, 1), 0.016, 0.016),
        kit.decal_plane('name.delay.bone', (0, -FRONT, 0.045), (0, 1, 0), (0, 0, 1), 0.05),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,1,1', 0.35, 'bottom', 2400,
        'Signal delay box: graphite cube with the SCR_7SEG_3 readout, a knurled Volt knob ringed by 12 progress '
        'LEDs, and a clear window onto a brass escapement wheel. Brief: docs/art/briefs/power_signal.md#delay. '
        'Knob modelled at 0° (pointer to -Y). Decals: in -> out arrow (mark.arrow_out) on the front between '
        'window and readout, name plate on the back. LOD2 drops the window pocket and the wheel detail; LOD3 '
        'drops the wheel.',
        MASTERS, led_groups='0:status,1:progress')
    part.pivot('knob', tuple(KNOB), 'z', 0.0, 300.0, motion='turn')
    part.pivot('escapement', tuple(ESC), 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('body', (BOX[0], BOX[1], TOP), (0, 0, TOP / 2), phys='powder', restitution=0.25, friction=0.5)
    part.port('signal', 'in', (-0.046, 0, 0.045), (-1, 0, 0), 'S', 'in', max_links=4)
    part.port('signal', 'out', (0.046, 0, 0.045), (1, 0, 0), 'S', 'out', max_links=8)
    n = Vector((0, -1, 0))
    part.screen('delay', SCR_W, SCR_H, tuple(SCR_C + n * 0.0002), tuple(n), (0, 0, 1), kind='7seg', digits=3,
                color='signal')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
