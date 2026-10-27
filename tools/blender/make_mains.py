"""Procedurally build the MAINS source file (docs/art/briefs/power_signal.md, "MAINS: Power block with toggle").

Usage: blender -b --factory-startup -P tools/blender/make_mains.py -- [out.blend]
Default output: assets/src/power/mains.blend

The approved look-dev mains() stood upright to fill 2x2x1: a pillowed graphite body (0.2 x 0.1 x 0.19, 12 mm)
on two 5 mm rubber bars, a bone face panel (0.17 x 0.15) with 4 M5 screws, the chunky chrome toggle lever
(0.018 x 0.018 x 0.055, Ø 0.022 ball, x1.4) on PIVOT__lever (axis x) in a volt anodised bezel, the power
light bar (LEDBAR_60) and the 10-cell load screen in graphite bezels. Pivot angle 0 points the lever 30° above
-Y; it is modelled at +30 ("on", the default `on` prop, the look-dev's 30°-from-vertical lean), recorded as
the pivot's `rest` property; off (-30) is horizontal. Port rings: power out (PR-M, +X),
signal in (PR-S, -X). kn_bounds = static: origin and footprint are judged on the housing, not the lever.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'mains'
BODY = (0.2, 0.1, 0.19)
FEET = 0.005
CZ = FEET + BODY[2] / 2
FACE_Y = -BODY[1] / 2
PIVOT = Vector((-0.045, -0.058, 0.110))
REST = 30.0          # modelled pose on the pivot's -30..+30 travel (on)
ELEV0 = 30.0         # lever elevation above -Y at pivot angle 0; on = 60° up (the look-dev lean)
LEVER_L, LEVER_W, BALL_R = 0.055, 0.018, 0.011
G, BONE, CHROME, VOLT, STEEL, RUBBER, LED, SCREEN, GLASS = (
    'kn_powder_graphite', 'kn_powder_bone', 'kn_chrome', 'kn_anod_volt', 'kn_steel_brushed', 'kn_rubber', 'kn_led',
    'kn_screen', 'kn_glass')
MASTERS = [G, BONE, CHROME, VOLT, STEEL, RUBBER, LED, SCREEN, GLASS, 'kn_decal']
# SCR_BAR_10 (shared_kit §5): 56 x 14 quad, graphite bezel with a 4 mm border (2 mm outer / 1 mm inner radius),
# quad inset 1.5 mm, 1 mm kn_glass cover 0.3 mm under the bezel face.
SCR_C, SCR_W, SCR_H = (0.045, 0.105), 0.056, 0.014
BEZEL_FRONT = FACE_Y - 0.003
SCR_Y = BEZEL_FRONT + 0.0015
PANEL_FRONT = FACE_Y - 0.002
FRONT = kit.rot_x(90)  # local xy = Blender xz, local z = -Y (out of the face)


def lever_dir():
    a = math.radians(ELEV0 + REST)
    return Vector((0.0, -math.cos(a), math.sin(a)))


def on_face(x, z, y=FACE_Y):  # noqa: D401
    return kit.at(x, y, z) @ FRONT


def build(lod, q, mats):
    body = Kit()
    cseg = (4, 3, 2, 1)[lod]
    body.rbox(BODY, (0, 0, CZ), 0.012 if lod < 3 else 0.008, G, cseg=cseg)
    body.rbox((0.17, 0.15, 0.004), (0, 0, 0), 0.006, BONE, cseg=max(1, cseg - 1), rz=0.0015 if lod < 2 else 0.0,
              m=on_face(0, CZ))
    # light bar (LEDBAR_60) and the 10-cell load screen, each in a graphite bezel
    body.rbox((0.066, 0.014, 0.006), (0, 0, 0), 0.004, G, cseg=max(1, cseg - 2), rz=0.001 if lod < 2 else 0.0,
              m=on_face(0.045, 0.155))
    body.rbox((0.06, 0.008, 0.007), (0, 0, 0), 0.0038 if lod < 3 else 0.0, LED, cseg=max(1, cseg - 2),
              rz=0.0012 if lod < 2 else 0.0, m=on_face(0.045, 0.155))
    bezel = Kit()
    bezel.rbox((SCR_W + 0.008, SCR_H + 0.008, 0.006), (0, 0, 0), 0.002, G, cseg=max(1, cseg - 2),
               rz=0.001 if lod < 2 else 0.0, m=on_face(*SCR_C))
    pocket = Kit()
    pocket.prism(kit.outline_rrect(SCR_W, SCR_H, 0.001, max(1, cseg - 2)), -0.0015, 0.001, G,
                 m=kit.at(SCR_C[0], BEZEL_FRONT, SCR_C[1]) @ kit.FRONT_OUT)
    body.merge(kit.boolean_diff(bezel, [pocket], mats))
    if lod == 0:
        body.rbox((SCR_W, SCR_H, 0.001), (0, 0, 0), 0.0, GLASS, cseg=0, rz=0.0,
                  m=on_face(*SCR_C, y=BEZEL_FRONT + 0.0003 + 0.0005))
    # lever bezel (volt anodised ring) round the lever root
    if lod < 3:
        body.torus(0.0135, 0.0028, VOLT, seg(28, q, 8), (6, 5, 4, 3)[lod],
                   m=kit.frame((PIVOT.x, FACE_Y - 0.0018, PIVOT.z), '-y'))
        body.cyl(0.0125, -0.0005, 0.0045, G, seg(28, q, 8), bev=0.0012 if lod < 2 else 0.0, bseg=1,
                 m=kit.frame((PIVOT.x, FACE_Y - 0.001, PIVOT.z), '-y'))
    if lod < 2:  # M5 button heads on the face corners
        prof = [(0.0, -0.0006, STEEL), (0.00425, -0.0006, STEEL), (0.00425, 0.0007, STEEL), (0.0036, 0.0017, STEEL),
                (0.0021, 0.0024, STEEL), (0.0, 0.0026, STEEL)]
        for x in (-0.0745, 0.0745):
            for z in (0.0335, 0.1665):
                body.lathe(prof, seg(14, q, 6), kit.frame((x, FACE_Y - 0.002, z), '-y'))
    if lod < 3:  # FOOT_BAR5 x 2
        for y in (-0.03, 0.03):
            body.rbox((0.16, 0.01, FEET + 0.001), (0, y, (FEET + 0.001) / 2), 0.004, RUBBER, cseg=max(1, cseg - 2),
                      rz=0.0015 if lod < 2 else 0.0)

    lever = Kit(pivot='PIVOT__lever')
    d = lever_dir()
    lever.cyl(0.0075, -0.012, 0.012, CHROME, seg(20, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1,
              m=kit.frame(PIVOT, 'x'))
    lever.rbox((LEVER_W, LEVER_W, LEVER_L), (0, 0, 0), 0.004 if lod < 3 else 0.0, CHROME, cseg=max(1, cseg - 1),
               m=kit.frame(PIVOT + d * (LEVER_L / 2 - 0.004), d))
    lever.sphere(BALL_R, CHROME, seg(24, q, 6), seg(12, q, 4, 2), m=kit.at(*(PIVOT + d * LEVER_L)))
    pieces = {'body': body, 'lever': lever,
              'screen': kit.screen_quad((SCR_C[0], SCR_Y, SCR_C[1]), (0, -1, 0), (0, 0, 1), SCR_W, SCR_H,
                                        lift=0.0002)}
    # Face labels (ART_BIBLE §6): name plate + spec line bottom-left, high-voltage pictogram at the brief's spot.
    n, up = (0, -1, 0), (0, 0, 1)
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.mains.graphite', (-0.04, PANEL_FRONT, 0.066), n, up, 0.054),
        kit.decal_plane('spec.mains.graphite', (-0.04, PANEL_FRONT, 0.056), n, up, 0.054),
        kit.decal_plane('picto.high_voltage.warn', (0.045, PANEL_FRONT, 0.050), n, up, 0.020, 0.020),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'M', '2,2,1', 1.8, 'bottom', 4500,
        'Power block with toggle: look-dev mains() upright. Brief: docs/art/briefs/power_signal.md#mains. '
        'Lever modelled in the "on" pose (pivot angle +30 = 60° up, prop rest = 30; 0 = 30° up). '
        'Decals: name plate, "KN-01 · 500 W" spec line and the high-voltage pictogram (decals_atlas). '
        'SCREEN__load = SCR_BAR_10 in a pocketed bezel under a glass cover.',
        MASTERS, led_groups='0:power_on', pipeline={'kn_bounds': 'static'})
    part.pivot('lever', tuple(PIVOT), 'x', -30.0, 30.0, rest=REST)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('body', BODY, (0, 0, CZ), phys='powder', restitution=0.25, friction=0.5)
    d = lever_dir()
    part.col_capsule('lever', BALL_R, LEVER_L + BALL_R, tuple(PIVOT + d * ((LEVER_L + BALL_R) / 2)), tuple(d),
                     phys='steel')
    part.port('power', 'out', (0.101, 0, CZ), (1, 0, 0), 'M', 'out', max_links=6)
    part.port('signal', 'in', (-0.101, 0, CZ), (-1, 0, 0), 'S', 'in')
    tip = PIVOT + d * LEVER_L
    k = Kit()
    k.sphere(0.016, 'x', 10, 5, m=kit.at(*tip))
    part.sensor('trigger', 'lever', [tuple(v.co) for v in k.bm.verts], threshold=0.03, cooldown=0.2)
    k.free()
    part.screen('load', SCR_W, SCR_H, (SCR_C[0], SCR_Y - 0.0002, SCR_C[1]), (0, -1, 0), kind='bar', cells=10,
                color='power')
    part.emit('spark', 'face', (0.045, -0.055, 0.105), (0, -1, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
