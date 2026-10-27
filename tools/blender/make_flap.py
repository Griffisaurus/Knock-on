"""Procedurally build the FLAP source file (docs/art/briefs/frame.md, "FLAP: Hinged door / trapdoor").

Usage: blender -b --factory-startup -P tools/blender/make_flap.py -- [out.blend]
Default output: assets/src/frame/flap.blend

Authored at the default size 0.30 x 0.05 x 0.30 as a trapdoor. Origin = the hinge axis centre (back edge of the
panel, mid-thickness): the footprint spans x +-0.15, y -0.28 .. +0.02, z -0.0375 .. +0.0125. 9-slice Cobalt frame
(fixed 0.02 x 0.02 corners, 0.02 wide rails, an M3 on each top corner) on four FOOT_S bumpers. The Bone panel
(0.256 x 0.256 x 0.025, flush with the frame top, 2 mm clear of every rail) hangs on PIVOT__panel (axis x at the
origin, 0..+90: +90 = open, front edge down by the right-hand rule about +X; the brief's
-90 label has the opposite sign, parts-data uses [0, 90]). Hinge: 5 steel knuckles (Ø 14, one per 0.05 m), alternating frame / panel; the panel is
notched round the frame knuckles and the back rail is coved round the hinge and recessed below it, so the panel
swings front-edge-down with 2 mm clearance. Fixed 0.06 m latch block at the right end of the front rail, under the
PR-S signal ring on the front fascia (0.11, -0.28, -0.0125); LED_D6 status dome on the front rail top above it.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'flap'
W, D = 0.30, 0.30                      # default size (frame included)
TOP, BOT, FEET = 0.0125, -0.0375, 0.003
FZ0 = BOT + FEET                       # frame underside (on the feet)
RAIL = 0.02
Y_FRONT, Y_BACK = -(D - 0.02), 0.02    # footprint y range
PANEL = 0.256                          # footprint - 0.04, 2 mm clear of the rails
PANEL_T = 0.025
KNUCKLE_R, KNUCKLE_L, PITCH = 0.007, 0.048, 0.05
KNUCKLES = (-0.10, -0.05, 0.0, 0.05, 0.10)   # even index = frame, odd = panel
NOTCH_Y = -(KNUCKLE_R + 0.002)         # panel notch round each frame knuckle
COVE_R = 0.0165                        # back-rail cove round the hinge axis
RECESS_Y = PANEL_T / 2 + 0.002         # back rail face below the hinge (panel hangs at y +-0.0125)
LED_POS = (W / 2 - 0.04, -(D - 0.03), TOP)
PORT_POS = (W / 2 - 0.04, Y_FRONT, -0.0125)
BONE, COBALT, STEEL, RUBBER, LED = 'kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed', 'kn_rubber', 'kn_led'
MASTERS = [BONE, COBALT, STEEL, RUBBER, LED, 'kn_decal']


def led_group(_c, _n):
    return 0, 0.25   # status: dim = latched


def panel_outline(notched):
    h = PANEL / 2
    yb, yf = -0.002, -0.002 - PANEL
    if not notched:
        return [(-h, yf), (h, yf), (h, yb), (-h, yb)]
    # back edge notched round the three frame knuckles (x ranges +-0.025 about -0.10, 0, 0.10, plus 1 mm)
    e = KNUCKLE_L / 2 + 0.001
    # assemble explicitly for clarity (CCW seen from +Z)
    pts = [(-h, yf), (h, yf), (h, NOTCH_Y),
           (0.10 - e, NOTCH_Y), (0.10 - e, yb), (0.0 + e, yb), (0.0 + e, NOTCH_Y),
           (0.0 - e, NOTCH_Y), (0.0 - e, yb), (-0.10 + e, yb), (-0.10 + e, NOTCH_Y),
           (-h, NOTCH_Y)]
    return pts


def knuckle(k, xc, n):
    """One Ø 14 hinge knuckle along X (n-gon prism, LOD3 n = 4)."""
    k.prism(kit.outline_circle(KNUCKLE_R, n), xc - KNUCKLE_L / 2, xc + KNUCKLE_L / 2, STEEL, m=kit.X_AXIS)


def build(lod, q, mats):
    h = TOP - FZ0
    zc = (TOP + FZ0) / 2
    frame = Kit()
    panel = Kit(pivot='PIVOT__panel')
    if lod == 3:  # primitives: four rail boxes, the panel slab, one hinge bar, the LED face
        for size, c in (((W, RAIL, h), (0, Y_FRONT + RAIL / 2, zc)), ((W, RAIL, h), (0, Y_BACK - RAIL / 2, zc)),
                        ((RAIL, D - 2 * RAIL, h), (-(W / 2 - RAIL / 2), (Y_FRONT + Y_BACK) / 2, zc)),
                        ((RAIL, D - 2 * RAIL, h), (W / 2 - RAIL / 2, (Y_FRONT + Y_BACK) / 2, zc))):
            frame.rbox(size, c, 0.0, COBALT, cseg=0)
        frame.prism(kit.outline_circle(KNUCKLE_R, seg(10, q, 3)), -0.125, 0.125, STEEL, m=kit.X_AXIS)
        _m2.led_dome(frame, 6, LED_POS, (0, 0, 1), q, lod)
        frame.colors['led'] = _m2.led_attr(led_group)
        panel.prism(panel_outline(False), -PANEL_T / 2, PANEL_T / 2, BONE)
        return {'frame': frame, 'panel': panel}

    cs = (1, 1, 0)[lod]
    rr = 0.004
    frame.rbox((W, RAIL, h), (0, Y_FRONT + RAIL / 2, zc), rr, COBALT, cseg=cs)
    for s in (-1, 1):
        frame.rbox((RAIL, D - 2 * RAIL + 0.01, h), (s * (W / 2 - RAIL / 2), (Y_FRONT + Y_BACK) / 2, zc), rr, COBALT,
                   cseg=cs)
    back = Kit()
    back.rbox((W, RAIL, h), (0, Y_BACK - RAIL / 2, zc), rr, COBALT, cseg=cs)
    if lod < 2:  # cove round the hinge + recess below it, so the swinging panel clears the back rail
        cove = Kit()
        cove.cyl(COVE_R, -(W / 2 - RAIL + 0.001), W / 2 - RAIL + 0.001, COBALT, seg(16, q, 6), m=kit.X_AXIS)
        rec = Kit()
        rec.rbox((W - 2 * RAIL + 0.002, RECESS_Y + 0.01, -FZ0 + 0.01), (0, (RECESS_Y - 0.01) / 2, FZ0 / 2 - 0.005),
                 0.0, COBALT, cseg=0)
        back = kit.boolean_diff(back, [cove, rec], mats)
    frame.merge(back)
    back.free()
    # hinge: 5 knuckles alternating frame / panel; frame knuckles carry leaves into the back rail; the pin
    nk = seg(14, q, 4)
    for i, xc in enumerate(KNUCKLES):
        knuckle(frame if i % 2 == 0 else panel, xc, nk)
        if i % 2 == 0 and lod < 2:
            frame.rbox((KNUCKLE_L - 0.008, COVE_R + 0.002, 0.007), (xc, (COVE_R + 0.002) / 2, 0.0), 0.0, STEEL,
                       cseg=0)
    if lod == 0:
        frame.prism(kit.outline_circle(0.0025, 6), -0.127, 0.127, STEEL, m=kit.X_AXIS)
    # latch block (fixed 0.06, right end of the front rail, under the port): a steel strike plate set 1.5 mm proud
    # of the front rail's inner face below the panel (clears the swinging front edge) and the bolt tongue under the
    # panel's front edge (retracts on release; not modelled moving)
    lx, yin = PORT_POS[0], Y_FRONT + RAIL
    if lod < 2:
        frame.rbox((0.06, 0.0025, 0.0175), (lx, yin + 0.00025, -0.0235), 0.001, STEEL, cseg=1, rz=0.0)
        frame.rbox((0.016, 0.0045, 0.003), (lx, yin + 0.0018, -0.015), 0.001, STEEL, cseg=1, rz=0.0)
    # M3 on the frame's top corners (LOD0), FOOT_S under the corners (LOD0; hidden under the frame beyond)
    for sx in (-1, 1):
        for y in (Y_FRONT + RAIL / 2, Y_BACK - RAIL / 2):
            _m2.screw(frame, 'M3', (sx * (W / 2 - RAIL / 2), y, TOP), (0, 0, 1), min(q, 0.6), lod)
            if lod == 0:
                frame.prism(kit.outline_circle(0.004, 8), BOT, FZ0 + 0.0006, RUBBER, bb=0.001, bseg=1,
                            m=kit.at(sx * (W / 2 - 0.01), y, 0))
    _m2.led_dome(frame, 6, LED_POS, (0, 0, 1), min(q, 0.55), lod)
    frame.colors['led'] = _m2.led_attr(led_group)

    panel.prism(panel_outline(True), -PANEL_T / 2, PANEL_T / 2, BONE, bt=0.003, bb=0.0015 if lod < 2 else 0.0,
                bseg=1)

    decals = [kit.decal_plane('name.flap.bone', (-0.07, Y_FRONT, -0.0125), (0, -1, 0), (0, 0, 1), 0.06)]
    return kit.add_decals({'frame': frame, 'panel': panel}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '3,0.5,3', 0.27, 'hinge', 1400,
        'Trapdoor at the default 0.30 x 0.30: Cobalt 9-slice frame (0.02 rails, fixed 0.02 corners, M3 on the top '
        'corners) on FOOT_S bumpers, Bone panel 0.256 x 0.256 x 0.025 on PIVOT__panel (axis x at the hinge origin, '
        '0..+90, +90 = open front-edge-down; brief says -90..0, parts-data [0, 90]), 5 steel knuckles (Ø 14, 0.05 pitch) alternating frame / panel, latch block under the '
        'PR-S signal ring on the front fascia, LED_D6 status dome above it. Brief: docs/art/briefs/frame.md#flap. '
        'kn_mass_hint = the panel (0.27 kg; frame static). The back rail is coved round the hinge and recessed '
        'under it so the panel swings front-edge-down with 2 mm clearance. Deferred: 9-slice resize modules, UV2 '
        'Bone trim. COL__box__panel is not parented to the pivot (house convention: FULCRUM / MAINS).',
        MASTERS, led_groups='0:status')
    part.pivot('panel', (0, 0, 0), 'x', 0.0, 90.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('panel', (PANEL, PANEL, PANEL_T), (0, -0.002 - PANEL / 2, 0), phys='powder', friction=0.5,
                 restitution=0.25, pivot='panel')
    h, zc = TOP - BOT, (TOP + BOT) / 2
    for nm, size, c in (('rail_f', (W, RAIL, h), (0, Y_FRONT + RAIL / 2, zc)),
                        ('rail_b', (W, RAIL, h), (0, Y_BACK - RAIL / 2, zc)),
                        ('rail_l', (RAIL, D - 2 * RAIL, h), (-(W / 2 - RAIL / 2), (Y_FRONT + Y_BACK) / 2, zc)),
                        ('rail_r', (RAIL, D - 2 * RAIL, h), (W / 2 - RAIL / 2, (Y_FRONT + Y_BACK) / 2, zc))):
        part.col_box(nm, size, c, phys='powder', friction=0.5, restitution=0.25)
    part.port('signal', 'in', PORT_POS, (0, -1, 0), 'S', 'in')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
