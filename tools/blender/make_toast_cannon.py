"""Procedurally build the TOAST CANNON source file (docs/art/briefs/contraptions.md, "TOAST CANNON: Launching
toaster").

Usage: blender -b --factory-startup -P tools/blender/make_toast_cannon.py -- [out.blend]
Default output: assets/src/contraptions/toast_cannon.blend

A pillowy kn_powder_bone toaster (0.19 x 0.095, 20 mm pillow radius, z 0.004-0.164, FOOT_S) with two slots along X
at y ±0.022, a kn_powder_ignition side band, an exaggerated ignition lever knob on PIVOT__lever (z slide, -0.06 ... 0)
in a graphite slot at x 0.075, an ignition browning-dial knob on PIVOT__dial (y, 0-270°) over the dial decal with
three kn_led progress dots (group 0), a kn_poly_amber window (x -0.015 ... 0.045, z 0.06-0.13) onto kn_copper
element coils with kn_led filaments (group 1), and the PR-S power `in` ring at (-0.06, -0.048, 0.045). Two golden
toast slices (kn_paper_tan faces, kn_cardboard crust) ride PIVOT__carriage (z, -0.07 ... +0.015), peeking 20 mm
above the slots at rest: the `toast_cannon__slices` node is what the engine hides after a launch (the flying slices
are the separate `toast_slice` part).
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
import make_toast_slice as slice_  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'toast_cannon'
BONE, IGN, AMBER, COPPER, RUBBER, LED, G, STEEL, TAN, CARD = (
    'kn_powder_bone', 'kn_powder_ignition', 'kn_poly_amber', 'kn_copper', 'kn_rubber', 'kn_led',
    'kn_powder_graphite', 'kn_steel_brushed', 'kn_paper_tan', 'kn_cardboard')
MASTERS = [BONE, IGN, AMBER, COPPER, RUBBER, LED, G, STEEL, TAN, CARD]
W, D, Z0, Z1, PILLOW = 0.19, 0.095, 0.004, 0.164, 0.020
FRONT = -D / 2
SLOT_Y, SLOT_L, SLOT_W = 0.022, 0.118, 0.017
WIN_X, WIN_Z = (-0.015, 0.045), (0.06, 0.13)
LEVER_X, LEVER_Z = 0.075, 0.128
DIAL = Vector((-0.060, FRONT, 0.112))
PORT = (-0.06, -0.048, 0.045)
SLICE_Z0 = 0.084                       # slice bottom at rest: top at z 0.184, 20 mm above the slots


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    shell = Kit()
    shell.rbox((W, D, Z1 - Z0), (0, 0, (Z0 + Z1) / 2), PILLOW if lod < 3 else 0.012, BONE, cseg=cs,
               rz=0.012 if lod < 3 else 0.006)
    if lod < 3:
        import bmesh
        bmesh.ops.triangulate(shell.bm, faces=[f for f in shell.bm.faces if len(f.verts) > 4])
        cuts = []
        for s in (-1, 1):
            c = Kit()
            c.rbox((SLOT_L, SLOT_W, 0.13), (0, s * SLOT_Y, Z1 - 0.055), 0.006, G, cseg=2, rz=0.0)
            cuts.append(c)
        win = Kit()
        win.rbox((WIN_X[1] - WIN_X[0], 0.016, WIN_Z[1] - WIN_Z[0]),
                 ((WIN_X[0] + WIN_X[1]) / 2, FRONT + 0.004, (WIN_Z[0] + WIN_Z[1]) / 2), 0.008, G, cseg=2, rz=0.0)
        cuts.append(win)
        shell = kit.boolean_diff(shell, cuts, mats)
    body = Kit()
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'S', sx * 0.075, sy * 0.032, min(1.0, q), lod)
    # ignition side band (proud 1 mm), lever slot plate, port land
    body.rbox((W + 0.002, D + 0.002, 0.010), (0, 0, 0.021), PILLOW + 0.001, IGN, cseg=cs, rz=0.0)
    if lod < 3:
        body.rbox((0.010, 0.002, 0.084), (LEVER_X, FRONT - 0.0005, 0.094), 0.004, G, cseg=1, rz=0.0)
        # window back wall + element coils with led filaments
        body.rbox((WIN_X[1] - WIN_X[0], 0.003, WIN_Z[1] - WIN_Z[0]),
                  ((WIN_X[0] + WIN_X[1]) / 2, FRONT + 0.0115, (WIN_Z[0] + WIN_Z[1]) / 2), 0.008, G, cseg=2, rz=0.0)
        for z in (0.075, 0.095, 0.115):
            m = kit.frame((WIN_X[0] + 0.004, FRONT + 0.0075, z), "x")
            if lod < 2:
                _m2.coil(body, 0.0035, 0.0009, 0.0, WIN_X[1] - WIN_X[0] - 0.008, 9, COPPER, q, lod, m=m)
            body.cyl(0.0012, 0.0, WIN_X[1] - WIN_X[0] - 0.008, LED, 6, m=m)
    _m2.land(body, 'S', PORT, (0, -1, 0), 0.0005, lod, mat=BONE)
    # dial: progress dots round it
    for k in range(3):
        a = math.radians(150 - 60 * k)
        _m2.led_dome(body, 6, (DIAL.x + 0.019 * math.cos(a), FRONT, DIAL.z + 0.019 * math.sin(a)), (0, -1, 0), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.0) if c.y < FRONT + 0.004 else (1, 0.0))
    window = Kit()
    if lod < 3:
        window.rbox((WIN_X[1] - WIN_X[0] + 0.002, 0.002, WIN_Z[1] - WIN_Z[0] + 0.002),
                    ((WIN_X[0] + WIN_X[1]) / 2, FRONT + 0.0025, (WIN_Z[0] + WIN_Z[1]) / 2), 0.009, AMBER, cseg=2,
                    rz=0.0)
    else:
        window.rbox((WIN_X[1] - WIN_X[0], 0.001, WIN_Z[1] - WIN_Z[0]),
                    ((WIN_X[0] + WIN_X[1]) / 2, FRONT - 0.0003, (WIN_Z[0] + WIN_Z[1]) / 2), 0.0, AMBER, cseg=1)
    lever = Kit(pivot='PIVOT__lever')
    lever.rbox((0.030, 0.015, 0.020), (LEVER_X, FRONT - 0.0068, LEVER_Z), 0.006 if lod < 3 else 0.0, IGN,
               cseg=max(1, cs - 1), rz=0.005 if lod < 3 else 0.0)
    dial = Kit(pivot='PIVOT__dial')
    dm = kit.frame(tuple(DIAL), (0, -1, 0))
    dial.cyl(0.011, -0.0005, 0.008, IGN, seg(24, q, 8), bev=0.002 if lod < 3 else 0.0, bseg=max(1, cs - 1), m=dm)
    if lod < 2:
        dial.rbox((0.003, 0.016, 0.003), (0, 0, 0.0085), 0.001, BONE, cseg=1, m=dm)
    slices = Kit(pivot='PIVOT__carriage')
    for s in (-1, 1):
        slice_.slice_kit(slices, lod, q, centre=(0.0, s * SLOT_Y, SLICE_Z0 + slice_.H / 2))
    if lod < 3:  # carriage tray under the bread
        slices.rbox((SLOT_L - 0.01, 0.056, 0.003), (0, 0, SLICE_Z0 - 0.0015), 0.002, STEEL, cseg=1)
    pieces = {'shell': shell, 'body': body, 'window': window, 'lever': lever, 'dial': dial, 'slices': slices}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.marks_m4', tuple(DIAL + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), 0.044, 0.044,
                        sub=_m4.marks4('brown_dial')),
        kit.decal_plane('name.toast_cannon.graphite', (0.0, -FRONT, 0.10), (0, 1, 0), (0, 0, 1), 0.11),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '2,2,1', 1.5, 'bottom', 6000,
        'Launching toaster: pillowy kn_powder_bone shell (0.19 x 0.095, 20 mm pillow, z 0.004-0.164, FOOT_S) with two '
        'boolean-cut slots along X (y ±0.022), kn_powder_ignition side band, exaggerated ignition lever knob on '
        'PIVOT__lever (z slide -0.06 ... 0) in a graphite slot at x 0.075, ignition dial knob on PIVOT__dial (y, '
        '0-270°) over the browning-dial decal with 3 kn_led progress dots (group 0), kn_poly_amber window (x -0.015 '
        '... 0.045, z 0.06-0.13) onto kn_copper element coils with kn_led filaments (group 1), PR-S power `in`. Two '
        'golden slices (kn_paper_tan / kn_cardboard crust) on PIVOT__carriage (z, -0.07 ... +0.015) peek 20 mm above '
        'the slots (bounds z 0.184); the engine hides `toast_cannon__slices` after a launch, the flying slices are '
        'the `toast_slice` part. kn_bounds = origin (the knobs are judged out). Name plate on the back. '
        'Brief: docs/art/briefs/contraptions.md#toast-cannon.',
        MASTERS, led_groups='0:progress,1:elements', skins='classic,chrome_diner', pipeline={'kn_bounds': 'origin'},
        hints={'kn_power_w': 200.0, 'kn_launch_speed': 3.0, 'kn_cycle_s': 3.0})
    part.pivot('carriage', (0.0, 0.0, SLICE_Z0), 'z', -0.07, 0.015, motion='slide')
    part.pivot('lever', (LEVER_X, FRONT, LEVER_Z), 'z', -0.06, 0.0, motion='slide')
    part.pivot('dial', tuple(DIAL), 'y', 0.0, 270.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('body', (0.19, 0.095, 0.16), (0, 0, 0.084), phys='powder', restitution=0.2, friction=0.5)
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    part.emit('launch', 'slot_a', (0, -SLOT_Y, 0.165), (0, 0, 1))
    part.emit('launch', 'slot_b', (0, SLOT_Y, 0.165), (0, 0, 1))
    part.emit('smoke', 'slots', (0, 0, 0.165), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
