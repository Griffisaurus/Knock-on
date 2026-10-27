"""Procedurally build the STOMP PAD source file (docs/art/briefs/power_signal.md, "STOMP PAD: Pressure plate").

Usage: blender -b --factory-startup -P tools/blender/make_stomp_pad.py -- [out.blend]
Default output: assets/src/power/stomp_pad.blend

A low graphite tray (0.2 x 0.2 x 0.027 on 3 mm rubber pads, rim top z 0.030) with a pocket for the
kn_rubber_grip plate (0.14 x 0.14, centred (-0.01, 0.01), top flush with the rim at z 0.030, PIVOT__plate
translation z -6 mm ... 0), the signal-coloured kn_led strip in the plate gap, and the volt anodised corner
boss at (0.08, -0.08) carrying the PR-S signal out ring, flush at z 0.030. Three M3 screws on the free tray
corners sit nearly flush so Rollers cross the rim without a bump.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'stomp_pad'
TOP, PAD_H = 0.030, 0.003
PLATE_C, PLATE_W, PLATE_T = (-0.01, 0.01), 0.14, 0.010
GAP = 0.003
BOSS_C, BOSS_R = (0.08, -0.08), 0.0175
G, GRIP, LED, VOLT, STEEL, RUBBER = ('kn_powder_graphite', 'kn_rubber_grip', 'kn_led', 'kn_anod_volt',
                                     'kn_steel_brushed', 'kn_rubber')
MASTERS = [G, GRIP, LED, VOLT, STEEL, RUBBER]


def build(lod, q, mats):
    cseg = max(0, min((3, 2, 1, 0)[lod], int(round(3 * q))))
    tray = Kit()
    tray.prism(kit.outline_rrect(0.2, 0.2, 0.012, cseg + 1), PAD_H, TOP, G, bt=(0.003, 0.0025, 0.002, 0.0)[lod],
               bb=(0.001, 0.0, 0.0, 0.0)[lod], bseg=cseg)
    pocket = Kit()
    pw = PLATE_W + 2 * GAP
    pocket.prism(kit.outline_rrect(pw, pw, 0.008, cseg + 1), TOP - PLATE_T, TOP + 0.01, G,
                 m=kit.at(PLATE_C[0], PLATE_C[1], 0))
    cutters = [pocket]
    if lod < 3:
        bp = Kit()
        bp.cyl(BOSS_R + 0.0005, TOP - 0.008, TOP + 0.01, VOLT, seg(28, q, 8), m=kit.at(BOSS_C[0], BOSS_C[1], 0))
        cutters.append(bp)
    tray = kit.boolean_diff(tray, cutters, mats)
    if lod < 3:
        tray.cyl(BOSS_R, TOP - 0.0085, TOP, VOLT, seg(28, q, 8), bev=0.001 if lod < 2 else 0.0, bseg=1,
                 m=kit.at(BOSS_C[0], BOSS_C[1], 0))
        for x, y in ((-0.085, -0.085), (-0.085, 0.085), (0.085, 0.085), (0.085, -0.085)):  # 3 mm rubber pads
            tray.cyl(0.008, 0.0, PAD_H + 0.0006, RUBBER, seg(16, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1,
                     bev_bot=0.0008 if lod < 2 else 0.0, m=kit.at(x, y, 0))
    # light strip in the plate gap (signal colour, engine-driven); never dropped, so state reads at LOD3
    prof = [(-0.0011, TOP - 0.0085), (0.0011, TOP - 0.0085), (0.0011, TOP - 0.0012), (-0.0011, TOP - 0.0012)]
    if lod == 3:
        prof = [(-0.0011, TOP - 0.0085), (0.0011, TOP - 0.0085), (0.0, TOP - 0.0012)]
    tray.ring_sweep(kit.outline_rrect(PLATE_W + GAP, PLATE_W + GAP, 0.0075, cseg + 1 if lod < 3 else 0), prof, LED,
                    m=kit.at(PLATE_C[0], PLATE_C[1], 0))
    if lod < 2:  # M3 heads, nearly flush (0.7 mm) on the free corners
        prof = [(0.0, -0.0005, STEEL), (0.00275, -0.0005, STEEL), (0.00275, 0.0002, STEEL), (0.0018, 0.0006, STEEL),
                (0.0, 0.0007, STEEL)]
        for x, y in ((-0.0915, 0.0915), (0.0815, 0.0915), (-0.0915, -0.0815)):
            tray.lathe(prof, seg(12, q, 6), kit.at(x, y, TOP))
    plate = Kit(pivot='PIVOT__plate')
    plate.prism(kit.outline_rrect(PLATE_W, PLATE_W, 0.006, cseg + 1), TOP - PLATE_T, TOP, GRIP,
                bt=(0.0015, 0.0012, 0.0, 0.0)[lod], bseg=max(1, cseg - 1), m=kit.at(PLATE_C[0], PLATE_C[1], 0))
    # Name plate on the tray front (bone ink on graphite), clear of the corner boss.
    decals = [kit.decal_plane('name.stomp_pad.bone', (-0.03, -0.1, 0.0155), (0, -1, 0), (0, 0, 1), 0.06)]
    return kit.add_decals({'tray': tray, 'plate': plate}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '2,0.3,2', 1.2, 'bottom', 1400,
        'Pressure plate. Brief: docs/art/briefs/power_signal.md#stomp-pad. Tread ribs live in the '
        'kn_rubber_grip normal; name plate decal on the tray front.',
        MASTERS, led_groups='0:perimeter')
    part.pivot('plate', (PLATE_C[0], PLATE_C[1], TOP), 'z', -0.006, 0.0)
    part.build_lods(lambda lod, q: build(lod, q, part.mats))
    part.col_box('tray', (0.2, 0.2, TOP), (0, 0, TOP / 2), phys='powder', restitution=0.2, friction=1.0)
    part.col_box('plate', (PLATE_W, PLATE_W, PLATE_T), (PLATE_C[0], PLATE_C[1], TOP - PLATE_T / 2), phys='rubber',
                 friction=1.0)
    part.port('signal', 'out', (BOSS_C[0], BOSS_C[1], TOP), (0, 0, 1), 'S', 'out', max_links=8)
    hw = PLATE_W / 2
    part.sensor('pressure', 'plate', [(PLATE_C[0] + x * hw, PLATE_C[1] + y * hw, TOP + z) for x in (-1, 1)
                                      for y in (-1, 1) for z in (0.0, 0.02)], threshold=0.5, cooldown=0.1)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
