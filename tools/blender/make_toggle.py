"""Procedurally build the TOGGLE source file (docs/art/briefs/power_signal.md, "TOGGLE: Lever switch").

Usage: blender -b --factory-startup -P tools/blender/make_toggle.py -- [out.blend]
Default output: assets/src/power/toggle.blend

A small pillowed graphite box (0.09 x 0.09 x 0.075, 8 mm pillow) on four FOOT_S bumpers, a Bone top plate
(0.08 x 0.08 x 0.004, 4 M3 screws) printed OFF (left) / ON (right), a steel yoke holding the chrome bat lever on
PIVOT__lever (axis y at (0, 0, 0.080), -25 off ... +25 on). The lever is 0.11 from the pivot to the centre of
its Volt knob (Ø 0.026, 1.5x exaggerated) and is modelled in the OFF pose (pivot angle -25, leaning to -X,
prop rest = -25), so the knob reaches x -0.060 and z 0.193 as the brief measures at rest. LED_D6 beside ON
(group 0 state). Power passes through -X (in) to +X (out_power); the signal out port faces -Y.
kn_bounds = origin: the resting lever shifts the bounds centre 7 mm to -X, so the origin is judged on the box.
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

TYPE = 'toggle'
FEET = 0.003
BOX = (0.09, 0.09, 0.075)
BOX_Z0 = FEET
BOX_TOP = BOX_Z0 + BOX[2]                # 0.078
PLATE = (0.08, 0.08, 0.004)
PLATE_TOP = BOX_TOP + PLATE[2] - 0.0005  # 0.0815 (plate sunk 0.5 mm into the box top)
PIVOT = Vector((0.0, 0.0, 0.080))
REST = -25.0                             # modelled pose: OFF, leaning to -X
LEVER_L, KNOB_R = 0.11, 0.013
G, BONE, CHROME, VOLT, STEEL, RUBBER, LED = ('kn_powder_graphite', 'kn_powder_bone', 'kn_chrome', 'kn_anod_volt',
                                             'kn_steel_brushed', 'kn_rubber', 'kn_led')
MASTERS = [G, BONE, CHROME, VOLT, STEEL, RUBBER, LED, 'kn_decal']
LED_POS = (0.024, -0.008)


def lever_dir():
    a = math.radians(REST)  # rotation about +Y: positive angles lean +Z toward +X
    return Vector((math.sin(a), 0.0, math.cos(a)))


def led_group(_c, _n):
    return 0, 0.08


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.rbox(BOX, (0, 0, BOX_Z0 + BOX[2] / 2), 0.008 if lod < 3 else 0.004, G, cseg=cs,
              rz=0.006 if lod < 3 else 0.0)
    pcs = (2, 1, 1, 0)[lod]
    body.prism(kit.outline_rrect(PLATE[0], PLATE[1], 0.006, pcs), PLATE_TOP - PLATE[2], PLATE_TOP, BONE,
               bt=0.0015 if lod < 2 else 0.0, bseg=1)
    if lod < 3:  # steel yoke cheeks either side of the lever hub
        for s in (-1, 1):
            body.prism(kit.outline_rrect(0.018, 0.005, 0.002, 1 if lod < 2 else 0), PLATE_TOP - 0.001,
                       PLATE_TOP + 0.010, STEEL, bt=0.0015 if lod < 2 else 0.0, bseg=1, m=kit.at(0, s * 0.0125, 0))
    if lod < 2:  # cross-pin heads on the cheek outsides
        for s in (-1, 1):
            body.cyl(0.0035, -0.0005, 0.0015, STEEL, seg(12, q, 6), bev=0.0006 if lod < 1 else 0.0, bseg=1,
                     m=kit.frame((0, s * 0.015, PIVOT.z), (0, s, 0)))
    for x in (-0.033, 0.033):  # M3 heads on the plate corners (LOD0 only)
        for y in (-0.033, 0.033):
            _m2.screw(body, 'M3', (x, y, PLATE_TOP), (0, 0, 1), min(1.0, q * 0.6), lod)
    for x in (-0.033, 0.033):  # FOOT_S x 4 (LOD1 takes the 8-sided prism, about the kit's 50 %)
        for y in (-0.033, 0.033):
            _m2.foot(body, 'S', x, y, min(1.0, q * 0.6), lod if lod != 1 else 2, top=0.0006)
    _m2.led_dome(body, 6, (LED_POS[0], LED_POS[1], PLATE_TOP), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(led_group)

    lever = Kit(pivot='PIVOT__lever')
    d = lever_dir()
    lever.cyl(0.0072, -0.0095, 0.0095, CHROME, seg(18, q, 4), bev=0.0012 if lod < 2 else 0.0, bseg=1,
              m=kit.frame(PIVOT, 'y'))
    # bat lever: a short collar, then a shaft that swells slightly toward the knob
    prof = [(0.0, 0.0, CHROME), (0.0068, 0.0, CHROME), (0.0068, 0.013, CHROME), (0.0047, 0.018, CHROME),
            (0.0058, LEVER_L - KNOB_R * 0.6, CHROME), (0.0, LEVER_L - KNOB_R * 0.6, CHROME)]
    if lod >= 2:
        prof = [prof[0], prof[1], (0.0055, 0.015, CHROME), prof[4], prof[5]]
    lever.lathe(prof, seg(12, q, 4), kit.frame(PIVOT, d))
    lever.sphere(KNOB_R, VOLT, seg(24, q, 6), seg(14, q, 4, 2), m=kit.at(*(PIVOT + d * LEVER_L)))

    pieces = {'body': body, 'lever': lever}
    up_back, n_top = (0, 1, 0), (0, 0, 1)
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('word.off.graphite', (-0.021, -0.021, PLATE_TOP), n_top, up_back, 0.03),
        kit.decal_plane('word.on.graphite', (0.021, -0.021, PLATE_TOP), n_top, up_back, 0.03),
        kit.decal_plane('name.toggle.bone', (0, BOX[1] / 2, 0.046), (0, 1, 0), (0, 0, 1), 0.05),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,2,1', 0.4, 'bottom', 1600,
        'Lever switch: graphite box with a Bone OFF / ON top plate and a chrome bat lever tipped by a Volt knob '
        '(1.5x). Brief: docs/art/briefs/power_signal.md#toggle. Lever modelled in the OFF pose (pivot angle -25, '
        'leaning to -X; prop rest = -25), so bounds are measured at rest. kn_bounds = origin (the resting lever '
        'shifts the bounds centre 7 mm). Ports renamed per E1 lead: PORT__power__in, PORT__power__out_power, '
        'PORT__signal__out_signal. Decals: OFF / ON words, name plate on the back. Snap is procedural; no clips.',
        MASTERS, led_groups='0:state', pipeline={'kn_bounds': 'origin'})
    part.pivot('lever', tuple(PIVOT), 'y', -25.0, 25.0, rest=REST, motion='turn')
    part.build_lods(build, lod0_q=1.2)
    part.col_box('body', (BOX[0], BOX[1], PLATE_TOP), (0, 0, PLATE_TOP / 2), phys='powder', restitution=0.25,
                 friction=0.5)
    d = lever_dir()
    cap_len = LEVER_L + KNOB_R
    part.col_capsule('lever', KNOB_R, cap_len, tuple(PIVOT + d * (cap_len / 2)), tuple(d), phys='steel', pivot='lever')
    part.port('power', 'in', (-0.046, 0, 0.042), (-1, 0, 0), 'S', 'in')
    part.port('power', 'out_power', (0.046, 0, 0.042), (1, 0, 0), 'S', 'out')
    part.port('signal', 'out_signal', (0, -0.046, 0.042), (0, -1, 0), 'S', 'out', max_links=8)
    k = Kit()
    k.sphere(KNOB_R + 0.003, 'x', 10, 5, m=kit.at(*(PIVOT + d * LEVER_L)))
    part.sensor('trigger', 'knob', [tuple(v.co) for v in k.bm.verts], threshold=0.03, cooldown=0.2, pivot='lever')
    k.free()
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
