"""Procedurally build the BURNING GLASS source file (docs/art/briefs/power_signal.md, "BURNING GLASS: Magnifier").

Usage: blender -b --factory-startup -P tools/blender/make_burning_glass.py -- [out.blend]
Default output: assets/src/power/burning_glass.blend

A classic magnifying glass standing upright (1x3x1): a weighted graphite base (0.09 x 0.09 x 0.03, 6 mm) on
four FOOT_S, a kn_wood_walnut handle (Ø 0.02, z 0.034 ... 0.19) with brushed-steel ferrules at both ends (the
top one carries a short shank into the rim), and a kn_anod_beam rim (8 mm round tube, outer Ø 0.098) centred
(0, 0, 0.245) holding a fat biconvex kn_glass lens (Ø 0.084, 14 mm at the centre, 3 mm at the edge, the edge
seated 1 mm into the rim tube). Optical axis Y; one glass layer in the sight line. Base front: name plate and
LED_D6 (group 0 focus). No ports.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'burning_glass'
BASE_W, BASE_TOP, FOOT_H = 0.09, 0.033, 0.003
HANDLE_R, HANDLE_Z0, HANDLE_Z1 = 0.01, 0.034, 0.19
RIM_C, RIM_R, RIM_r = (0.0, 0.0, 0.245), 0.045, 0.004       # tube centreline R, tube radius (outer Ø 0.098)
LENS_R, LENS_T, LENS_EDGE = 0.042, 0.014, 0.003
LED_C = (0.028, -BASE_W / 2, 0.018)
G, WALNUT, STEEL, BEAM, GLASS, RUBBER, LED = (
    'kn_powder_graphite', 'kn_wood_walnut', 'kn_steel_brushed', 'kn_anod_beam', 'kn_glass', 'kn_rubber', 'kn_led')
MASTERS = [G, WALNUT, STEEL, BEAM, GLASS, RUBBER, LED, 'kn_decal']
LENS_AXIS = kit.frame(RIM_C, 'y')                            # local +Z = part +Y (optical axis)


def lens_profile(rings):
    """Biconvex lens (r, h along the optical axis): two spherical caps meeting a 3 mm cylindrical edge."""
    sag = (LENS_T - LENS_EDGE) / 2
    R = (LENS_R ** 2 + sag ** 2) / (2 * sag)

    def h(r):
        return LENS_EDGE / 2 + sag - (R - math.sqrt(R * R - r * r))
    rs = [LENS_R * i / rings for i in range(rings + 1)]
    pts = [(r, -h(r), GLASS) for r in rs] + [(r, h(r), GLASS) for r in reversed(rs)]
    return kit.dedupe(pts)


def led_group(_c, _n):
    return 0, 0.0  # group 0 "focus", lit only above the ignition threshold


def build(lod, q):
    base = Kit()
    cs = (3, 2, 1, 0)[lod]
    base.rbox((BASE_W, BASE_W, BASE_TOP - FOOT_H), (0, 0, (BASE_TOP + FOOT_H) / 2), 0.006 if lod < 3 else 0.0, G,
              cseg=cs, rz=None if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            if lod == 0:
                _m2.foot(base, 'S', sx * 0.033, sy * 0.033, q * 0.5, lod)
            elif lod < 3:  # LOD1 8-sided, LOD2 4-sided pads
                base.prism(kit.outline_circle(0.004, 8 if lod == 1 else 4), 0.0, FOOT_H + 0.0006, RUBBER,
                           m=kit.at(sx * 0.033, sy * 0.033, 0))
    _m2.led_dome(base, 6, LED_C, (0, -1, 0), q, lod)
    base.colors['led'] = _m2.led_attr(led_group)
    # handle + ferrules
    stick = Kit()
    rim = Kit()
    if lod == 3:  # primitives: one handle cylinder, a coarse rim and a flat lens disc
        stick.cyl(HANDLE_R, BASE_TOP - 0.0005, RIM_C[2] - RIM_R + 0.002, WALNUT, seg(8, q, 5))
        rim.torus(RIM_R, RIM_r, BEAM, seg(12, q, 6), 3, m=LENS_AXIS)
        rim.cyl(LENS_R, -0.004, 0.004, GLASS, seg(12, q, 6), m=LENS_AXIS)
    else:
        hn = seg(16, q, 6)
        stick.cyl(HANDLE_R, HANDLE_Z0 + 0.006, HANDLE_Z1 - 0.008, WALNUT, hn, bev=0.0015 if lod < 2 else 0.0,
                  bseg=1)
        fb = 0.001 if lod < 2 else 0.0
        stick.cyl(0.0125, BASE_TOP - 0.0005, HANDLE_Z0 + 0.012, STEEL, hn, bev=fb, bseg=1, bev_bot=0.0)
        stick.cyl(0.0115, HANDLE_Z1 - 0.014, HANDLE_Z1, STEEL, hn, bev=fb, bseg=1)
        stick.cyl(0.0055, HANDLE_Z1 - 0.002, RIM_C[2] - RIM_R + 0.001, STEEL, seg(12, q, 6))  # shank into the rim
        # rim: round tube (torus) about the optical axis + biconvex lens
        rim.torus(RIM_R, RIM_r, BEAM, seg(44, q, 12), (8, 6, 4)[lod], m=LENS_AXIS)
        rim.lathe(lens_profile(seg(6, q, 2) if lod < 2 else 2), seg(40, q, 10), LENS_AXIS)
    pieces = {'base': base, 'handle': stick, 'rim': rim}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.burning_glass.bone', (-0.012, -BASE_W / 2, 0.018), (0, -1, 0), (0, 0, 1), 0.050),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,3,1', 0.6, 'bottom', 2500,
        'Magnifier: weighted graphite base (0.09 x 0.09 x 0.03) on four FOOT_S, walnut handle (Ø 0.02, z '
        '0.034-0.19) with steel ferrules and a shank into the Beam anodised rim (8 mm tube, outer Ø 0.098, centre '
        'z 0.245), fat biconvex kn_glass lens (Ø 0.084, 14 mm centre, 3 mm edge), optical axis Y. Base front: name '
        'plate + LED_D6 (group 0 focus). No ports. Brief: docs/art/briefs/power_signal.md#burning-glass. '
        'Walnut grain bake deferred (procedural master only).',
        MASTERS, led_groups='0:focus')
    part.build_lods(build, lod0_q=1.3)
    part.col_box('base', (BASE_W, BASE_W, BASE_TOP), (0, 0, BASE_TOP / 2), phys='powder', restitution=0.25,
                 friction=0.5)
    part.col_capsule('handle', HANDLE_R, RIM_C[2] - RIM_R - HANDLE_Z0, (0, 0, (HANDLE_Z0 + RIM_C[2] - RIM_R) / 2),
                     'z', phys='wood', restitution=0.3, friction=0.6)
    part.col_cyl('lens', RIM_R + RIM_r, 0.016, RIM_C, 'y', phys='glass', restitution=0.3, friction=0.3)
    k = Kit()
    k.cyl(LENS_R, -0.008, 0.008, 'x', 16, m=LENS_AXIS)
    part.sensor('light', 'lens', [tuple(v.co) for v in k.bm.verts])
    k.free()
    part.emit('focus', 'lens', RIM_C, (0, 1, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
