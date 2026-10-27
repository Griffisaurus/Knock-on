"""Procedurally build the GRIT HOPPER source file (docs/art/briefs/matter.md, "GRIT HOPPER: Sand dispenser bin").

Usage: blender -b --factory-startup -P tools/blender/make_grit_hopper.py -- [out.blend]
Default output: assets/src/matter/grit_hopper.blend

A square kn_poly_clear bin (0.28 x 0.28, 20 mm corners, z 0.20-0.385, 4 mm wall) funnelling to a Ø 0.05 neck,
lofted as one closed shell, on four kn_powder_graphite legs (0.025 square at (±0.125, ±0.125)) joined by a graphite
cradle frame that hugs the funnel, lower stretchers and a front brace carrying the SCR_BAR_10 fill bar. A
kn_powder_beam rim collar (z 0.385-0.40) holds the kn_steel_brushed top grille; a beam funnel collar sits on the
graphite gate housing (0.09 x 0.092 x 0.06, z 0.08-0.14) whose front carries the PR-M signal `open` ring. The beam
gate slide rides PIVOT__gate (x, 0-0.04 m). CAVITY__sand (matter sand) fills bin + funnel for the fill pass.
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

TYPE = 'grit_hopper'
G, BEAM, CLEAR, STEEL, RUBBER, LED, SCREEN = (
    'kn_powder_graphite', 'kn_powder_beam', 'kn_poly_clear', 'kn_steel_brushed', 'kn_rubber', 'kn_led', 'kn_screen')
MASTERS = [G, BEAM, CLEAR, STEEL, RUBBER, LED, SCREEN, 'kn_glass', 'kn_paper_tan']
BIN_W, BIN_R, BIN_Z0, BIN_Z1 = 0.28, 0.020, 0.20, 0.385
NECK_R, NECK_Z = 0.025, 0.12
WALL = 0.004
LEG, LEG_XY, LEG_Z1 = 0.025, 0.125, 0.181
FRAME_Z = (0.178, 0.200)
HOUSE_C, HOUSE_S = Vector((0.0, 0.0, 0.11)), (0.09, 0.092, 0.06)
PORT = (0.0, -0.046, 0.11)
BRACE_Y, BRACE_Z = (-0.1215, -0.1115), (0.132, 0.178)
SCR_C, SCR_W, SCR_H = Vector((0.0, -0.1215, 0.16)), 0.056, 0.014
GATE_Z = 0.095


def funnel_t(z):
    return max(0.0, min(1.0, (z - NECK_Z) / (BIN_Z0 - NECK_Z)))


def section(z, n, inset=0.0):
    """Outer (inset = 0) or inset cross-section of bin + funnel at height z: a circle at the neck blending into the
    rounded square (smoothstep), straight walls above BIN_Z0."""
    t = funnel_t(z)
    s = t * t * (3 - 2 * t)
    sq = _m4.polar_rrect(BIN_W - 2 * inset, BIN_W - 2 * inset, max(0.002, BIN_R - inset), n, start=math.pi / n)
    ci = _m4.polar_circle(NECK_R - inset, n, start=math.pi / n)
    return [(a[0] * (1 - s) + b[0] * s, a[1] * (1 - s) + b[1] * s, z) for a, b in zip(ci, sq)]


def funnel_zs(rows, top):
    zs = [NECK_Z + (BIN_Z0 - NECK_Z) * (i / rows) for i in range(rows + 1)]
    return zs + [top]


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(48, q, 8, 8)
    rows = (6, 4, 3, 2)[lod]
    shell = Kit()
    zs = funnel_zs(rows, BIN_Z1)
    outer = [section(z, n) for z in zs]
    if lod < 3:
        inner = [section(z, n, WALL) for z in zs]
        _m4.loft(shell, _m4.shell_rings(outer, inner), CLEAR, closed=True)
    else:
        _m4.loft(shell, outer, CLEAR)
    body = Kit()
    # legs + feet
    for sx in (-1, 1):
        for sy in (-1, 1):
            body.rbox((LEG, LEG, LEG_Z1 - 0.004), (sx * LEG_XY, sy * LEG_XY, 0.004 + (LEG_Z1 - 0.004) / 2),
                      0.003 if lod < 3 else 0.0, G, cseg=max(1, cs - 1), rz=0.002 if lod < 3 else 0.0)
            _m2.foot(body, 'S', sx * LEG_XY, sy * LEG_XY, min(1.0, q), lod, top=0.0008)
    # cradle frame that hugs the funnel between the legs
    fo = [_m4.ring(_m4.polar_rrect(0.288, 0.288, 0.01, n, start=math.pi / n), z) for z in FRAME_Z]
    fi = [[(x * 1.004, y * 1.004, zz) for x, y, zz in section(z, n)] for z in FRAME_Z]
    _m4.loft(body, [fo[0], fo[1], fi[1], fi[0]], G, closed=True)
    # lower stretchers (sides and back) and the front brace
    zst = 0.05
    for sx in (-1, 1):
        body.rbox((0.012, 2 * LEG_XY, 0.012), (sx * LEG_XY, 0, zst), 0.002 if lod < 2 else 0.0, G, cseg=1)
    body.rbox((2 * LEG_XY, 0.012, 0.012), (0, LEG_XY, zst), 0.002 if lod < 2 else 0.0, G, cseg=1)
    body.rbox((2 * LEG_XY - LEG, BRACE_Y[1] - BRACE_Y[0], BRACE_Z[1] - BRACE_Z[0]),
              (0, sum(BRACE_Y) / 2, sum(BRACE_Z) / 2), 0.003 if lod < 3 else 0.0, G, cseg=max(1, cs - 1))
    for sx in (-1, 1):
        for z in (BRACE_Z[0] + 0.008, BRACE_Z[1] - 0.008):
            _m2.screw(body, 'M5', (sx * 0.095, BRACE_Y[0], z), (0, -1, 0), q, lod)
    # rim collar (beam) and top grille (steel)
    co = _m4.polar_rrect(0.292, 0.292, 0.026, n, start=math.pi / n)
    ci = _m4.polar_rrect(BIN_W - 2 * WALL - 0.006, BIN_W - 2 * WALL - 0.006, 0.010, n, start=math.pi / n)
    _m4.loft(body, [_m4.ring(co, BIN_Z1 - 0.002), _m4.ring(co, 0.40), _m4.ring(ci, 0.40),
                    _m4.ring(ci, BIN_Z1 - 0.002)], BEAM, closed=True)
    if lod < 3:
        nb = (11, 7, 4)[lod]
        span = (BIN_W - 2 * WALL - 0.006) / 2 - 0.001
        for i in range(nb):
            x = -span + 2 * span * (i + 1) / (nb + 1)
            body.sweep([(x, -span, 0.394), (x, span, 0.394)], 0.0014, (6, 4, 4)[lod], STEEL)
        for y in (-span / 2, span / 2):
            body.sweep([(-span, y, 0.3925), (span, y, 0.3925)], 0.0016, (6, 4, 4)[lod], STEEL)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.screw(body, 'M5', (sx * 0.131, sy * 0.131, 0.40), (0, 0, 1), q, lod)
    # funnel collar (beam) where the neck enters the gate housing
    body.cyl(NECK_R + 0.007, HOUSE_C.z + HOUSE_S[2] / 2 - 0.002, HOUSE_C.z + HOUSE_S[2] / 2 + 0.014, BEAM,
             seg(32, q, 8), bev=0.002 if lod < 2 else 0.0, bseg=1, bev_bot=0.0)
    # gate housing, outlet nozzle, LED
    body.rbox(HOUSE_S, tuple(HOUSE_C), 0.008 if lod < 3 else 0.0, G, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    body.cyl(0.013, 0.072, HOUSE_C.z - HOUSE_S[2] / 2 + 0.001, G, seg(24, q, 6), bev=0.0015 if lod < 2 else 0.0,
             bseg=1, cap_bot=RUBBER, cap=G)
    _m2.led_dome(body, 6, (0.028, -0.026, HOUSE_C.z + HOUSE_S[2] / 2), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    n_out, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C), tuple(n_out), tuple(up), lod, q,
                                     depth=0.0045))
    else:
        sc = SCR_C + n_out * 0.003
    # gate slide (beam) through the housing's +X side
    gate = Kit(pivot='PIVOT__gate')
    gate.rbox((0.05, 0.050, 0.006), (0.050, 0.0, GATE_Z), 0.002 if lod < 3 else 0.0, BEAM, cseg=1,
              rz=0.0015 if lod < 2 else 0.0)
    gate.cyl(0.006, 0.0, 0.012, BEAM, seg(16, q, 6), bev=0.002 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
             m=kit.frame((0.074, 0.0, GATE_Z), 'x'))
    pieces = {'body': body, 'bin': shell, 'gate': gate,
              'screen_fill': kit.screen_quad(tuple(sc), tuple(n_out), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    fy = -0.144
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.grit_hopper.bone', (-0.04, fy, sum(FRAME_Z) / 2), (0, -1, 0), (0, 0, 1), 0.10),
        kit.decal_plane('trim.marks_m4', (0.075, fy, sum(FRAME_Z) / 2), (0, -1, 0), (0, 0, 1), 0.017, 0.017,
                        sub=_m4.marks4('grains')),
    ])


def cavity(part):
    k = Kit()
    inset = WALL + 0.0035
    zs = [NECK_Z + 0.005 + (BIN_Z0 - NECK_Z - 0.005) * i / 8 for i in range(9)] + [BIN_Z1 - 0.004]
    _m4.loft(k, [section(z, 48, inset) for z in zs], 'x')
    return _m4.cavity(part, 'sand', k, 'sand', capacity=1000000)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '3,4,3', 4.0, 'bottom', 7500,
        'Sand dispenser bin: square kn_poly_clear bin (0.28, 20 mm corners, z 0.20-0.385, 4 mm wall) lofted with its '
        'funnel to a Ø 0.05 neck as one closed shell; four kn_powder_graphite legs on FOOT_S, a graphite cradle frame '
        'hugging the funnel, lower stretchers, front brace with the SCR_BAR_10 fill bar (beam) and M5 screws; '
        'kn_powder_beam rim collar (z 0.385-0.40) with the steel top grille and a beam funnel collar on the graphite '
        'gate housing (PR-M signal `open` on its front, flowing LED_D6 group 0 on top, outlet nozzle straight down); '
        'beam gate slide on PIVOT__gate (x, slide 0-0.04 m). CAVITY__sand (capacity property 1M grains; the fill shows '
        'the fraction of the capacity). Name plate + grains mark on the frame front. '
        'Brief: docs/art/briefs/matter.md#grit-hopper.',
        MASTERS, led_groups='0:flowing', skins='classic,desert')
    part.pivot('gate', (0.0, 0.0, GATE_Z), 'x', 0.0, 0.04, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.4)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1)), 1):
        part.col_box('leg_%d' % i, (LEG, LEG, 0.196), (sx * LEG_XY, sy * LEG_XY, 0.102), phys='powder')
    col = Kit()
    _m4.loft(col, [section(z, 24) for z in funnel_zs(3, 0.40)], 'x')
    part._col('mesh', 'bin', col, None, 'glass', restitution=0.2, friction=0.5)
    part.col_box('gate', HOUSE_S, tuple(HOUSE_C), phys='powder')
    part.sensor('intake', 'top', [(x * 0.13, y * 0.13, z) for x in (-1, 1) for y in (-1, 1) for z in (0.37, 0.40)])
    part.port('signal', 'open', PORT, (0, -1, 0), 'M', 'in')
    part.emit('spout', 'outlet', (0, 0, 0.08), (0, 0, -1))
    part.emit('dust', 'outlet', (0, 0, 0.08), (0, 0, -1))
    part.screen('fill', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.003, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=10, color='beam')
    cavity(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
