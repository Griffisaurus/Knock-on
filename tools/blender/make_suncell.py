"""Procedurally build the SUNCELL source file (docs/art/briefs/power_signal.md, "SUNCELL: Solar panel").

Usage: blender -b --factory-startup -P tools/blender/make_suncell.py -- [out.blend]
Default output: assets/src/power/suncell.blend

A slim graphite tray (0.3 x 0.2, 3 x 0.2 x 2 cells) on four 3 mm rubber pads (FOOT_S). The tray deck is at
z 0.019; a kn_anod_beam trim lip (4 mm wide, top z 0.021) frames the 3 x 2 grid of clipped-corner
kn_anod_graphite cells (0.078, pitch 0.08, grid 0.24 x 0.16 centred at x -0.02) under one kn_glass cover.
Busbars: two bone lines per cell (kn_decal, thin solid slices of the `num.minus.sans.bone` stroke) printed on
the cells under the glass. Equipment strip x 0.10 ... 0.15 (bare deck): PORT__power__out (PR-S, +Z) at
(0.125, -0.075, 0.019), LED_D6 at (0.125, 0.05, 0.019) (group 0 output), and the name plate running along +Y
between them.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'suncell'
TRAY_W, TRAY_D = 0.3, 0.2
PAD_H = 0.003
DECK = 0.019                                # tray deck (strip surface: port + LED land here)
LIP_TOP = 0.021
GRID_X, PITCH, CELL = -0.02, 0.08, 0.078
CELL_Z0, CELL_Z1 = DECK - 0.0003, DECK + 0.0005
GLASS_Z0, GLASS_Z1 = CELL_Z1 + 0.0004, CELL_Z1 + 0.0012
WIN_W, WIN_D = 0.242, 0.162                 # lip inner outline (glass edge tucks 1 mm under it)
LIP_W = 0.004
PORT = (0.125, -0.075, DECK)
LED_C = (0.125, 0.05, DECK)
G, AG, BEAM, GLASS, RUBBER, STEEL, LED = (
    'kn_powder_graphite', 'kn_anod_graphite', 'kn_anod_beam', 'kn_glass', 'kn_rubber', 'kn_steel_brushed', 'kn_led')
MASTERS = [G, AG, BEAM, GLASS, RUBBER, STEEL, LED, 'kn_decal']
BUSBAR = 'num.minus.sans.bone'
BUSBAR_SUB = (0.34, 0.485, 0.66, 0.54)      # solid bone inside the minus stroke


def cell_centres():
    return [(GRID_X + (i - 1) * PITCH, (j - 0.5) * PITCH) for j in range(2) for i in range(3)]


def clipped_square(s, c):
    """Mono-cell outline: square of side s with 45° clipped corners (c)."""
    h = s / 2
    return [(h - c, -h), (h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h)]


def led_group(_c, _n):
    return 0, 0.0  # group 0 "output", dark until lit


def build(lod, q):
    tray = Kit()
    cs = (3, 2, 1, 0)[lod]
    z0 = PAD_H - 0.0004
    if lod < 3:
        tray.rbox((TRAY_W, TRAY_D, DECK - z0), (0, 0, (DECK + z0) / 2), 0.008, G, cseg=cs,
                  rz=(0.002, 0.002, 0.0015, 0.0)[lod])
    else:
        tray.rbox((TRAY_W, TRAY_D, DECK - z0), (0, 0, (DECK + z0) / 2), 0.0, G, cseg=0, rz=0.0)
    for sx in (-1, 1):  # 4 x FOOT_S pads (LOD1: 8-sided prisms, LOD2: 4-sided, LOD3: none)
        for sy in (-1, 1):
            if lod == 0:
                _m2.foot(tray, 'S', sx * 0.13, sy * 0.08, q, lod)
            elif lod < 3:
                tray.prism(kit.outline_circle(0.004, 8 if lod == 1 else 4), 0.0, PAD_H + 0.0006, RUBBER,
                           m=kit.at(sx * 0.13, sy * 0.08, 0))
    # cells (kn_anod_graphite), glass cover and the Beam trim lip
    cells = Kit()
    if lod < 3:
        for x, y in cell_centres():
            out = clipped_square(CELL, 0.008) if lod < 2 else kit.outline_rrect(CELL, CELL, 0.0, 0)
            cells.prism(out, CELL_Z0, CELL_Z1, AG, m=kit.at(x, y, 0))
    else:  # one strip per column
        for i in range(3):
            cells.rbox((CELL, 2 * PITCH - 0.002, CELL_Z1 - CELL_Z0), (GRID_X + (i - 1) * PITCH, 0,
                       (CELL_Z0 + CELL_Z1) / 2), 0.0, AG, cseg=0, rz=0.0)
    if lod < 3:
        cells.rbox((WIN_W + 0.002, WIN_D + 0.002, GLASS_Z1 - GLASS_Z0), (GRID_X, 0, (GLASS_Z0 + GLASS_Z1) / 2),
                   0.003 if lod == 0 else 0.0, GLASS, cseg=1 if lod == 0 else 0, rz=0.0)
    lcs = (max(1, cs - 1), 1, 1, 0)[lod]
    lip = kit.outline_rrect(WIN_W, WIN_D, 0.003 if lod < 3 else 0.0, lcs)
    if lod == 0:
        prof = [(0.0, DECK - 0.0005), (LIP_W, DECK - 0.0005), (LIP_W, LIP_TOP - 0.001), (LIP_W - 0.0007, LIP_TOP),
                (0.0007, LIP_TOP), (0.0, LIP_TOP - 0.001)]
    else:
        prof = [(0.0, DECK - 0.0005), (LIP_W, DECK - 0.0005), (LIP_W, LIP_TOP), (0.0, LIP_TOP)]
    cells.ring_sweep(lip, prof, BEAM, m=kit.at(GRID_X, 0, 0))
    # equipment strip: LED_D6 (group 0 output); the port ring is linked by part.port
    _m2.led_dome(tray, 6, LED_C, (0, 0, 1), q, lod)
    tray.colors['led'] = _m2.led_attr(led_group)
    pieces = {'tray': tray, 'cells': cells}
    n, up = (0, 0, 1), (0, 1, 0)
    decals = []
    if lod < 2:
        bz = CELL_Z1  # printed on the cells, under the glass
        for x, y in cell_centres():
            for dx in (-0.0195, 0.0195):
                decals.append(kit.decal_plane(BUSBAR, (x + dx, y, bz), n, up, 0.0012, CELL - 0.006, sub=BUSBAR_SUB,
                                              lift=0.0002))
        # name plate along the strip (reads bottom -> top from the front-right)
        decals.append(kit.decal_plane('name.suncell.bone', (0.1285, -0.006, DECK), n, (-1, 0, 0), 0.056))
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '3,0.2,2', 0.7, 'bottom', 1200,
        'Solar panel: slim graphite tray (deck z 0.019) on four 3 mm FOOT_S pads, 3 x 2 clipped-corner '
        'kn_anod_graphite cells under one kn_glass cover inside a 4 mm kn_anod_beam lip (top z 0.021); busbars '
        'are bone kn_decal lines (thin solid slices of the num.minus.sans.bone stroke) printed on the cells. '
        'Strip x 0.10-0.15: PR-S power out facing +Z, LED_D6 (group 0 output), name plate along +Y. '
        'Brief: docs/art/briefs/power_signal.md#suncell. Deviation: the lip and glass add 2 mm over the 0.019 deck '
        '(total 0.021 as the brief size); the strip stays at deck height so the ring sits on it. Port max_links 4 '
        'from parts-data (the brief gives none).',
        MASTERS, led_groups='0:output')
    part.build_lods(build, lod0_q=1.3)
    part.col_box('panel', (TRAY_W, TRAY_D, LIP_TOP), (0, 0, LIP_TOP / 2), phys='powder', restitution=0.2,
                 friction=0.5)
    part.port('power', 'out', PORT, (0, 0, 1), 'S', 'out', max_links=4)  # parts-data maxLinks 4
    x0, x1 = GRID_X - 0.12, GRID_X + 0.12
    part.sensor('light', 'panel', [(x, y, z) for x in (x0, x1) for y in (-0.08, 0.08) for z in (DECK, DECK + 0.01)],
                threshold=0.05)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
