"""Procedurally build the PUNCHLINE source file (docs/art/briefs/contraptions.md, "PUNCHLINE: Spring boxing glove").

Usage: blender -b --factory-startup -P tools/blender/make_punchline.py -- [out.blend]
Default output: assets/src/contraptions/punchline.blend

A pillowed bone housing (0.20 x 0.176 x 0.176, x -0.15...0.05, z 0.004-0.18, 10 mm radius, 6 mm walls) on four
FOOT_M bumpers, with a kn_poly_clear L-shaped window over the top and upper front (x -0.13...0.03). Through it:
the wound chrome spring (Ø 0.05, 9 turns) between a steel seat plate and the ram collar, and the three-stage
chrome ram on nested slide pivots PIVOT__ram_1 (tube Ø 32) -> PIVOT__ram_2 (Ø 26) -> PIVOT__glove (rod Ø 20,
0-0.17 / 0-0.17 / 0-0.16 m along +X, total reach 0.50 m). The oversized Ignition glove (Ø 0.12 fist, 1.4x real,
thumb on top, no laces) sits on its bone cuff at rest centre (0.10, 0, 0.09), retracted against the steel nose
bushing. PR-M signal trigger on the front face, Ø 8 mm ready LED on the top rear, 12 M5 screws (4 per side:
front, back, -X end), name plate on the cuff (graphite ink).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'punchline'
HX0, HX1, HY, HZ0, HZ1 = -0.15, 0.05, 0.088, 0.004, 0.18
HC = ((HX0 + HX1) / 2, 0.0, (HZ0 + HZ1) / 2)
HSIZE = (HX1 - HX0, 2 * HY, HZ1 - HZ0)
WALL = 0.006
AZ = 0.09                                   # ram axis height (glove centre)
WIN_X0, WIN_X1, WIN_Y1, WIN_Z0 = -0.13, 0.03, 0.0605, 0.1045
TUBE = {'ram_1': (0.016, -0.130, 0.048), 'ram_2': (0.013, -0.130, 0.052), 'glove': (0.010, -0.125, 0.062)}
GLOVE_C, GLOVE_R, GLOVE_BACK = (0.10, 0.0, AZ), 0.06, 0.6
CUFF_R, CUFF_X0, CUFF_X1 = 0.045, 0.0515, 0.084
SPRING_X0, SPRING_X1 = -0.138, -0.030
SPRING_RELAX = 0.040                        # relaxed spring end: the nose bushing's back face
LED_C = (-0.10, 0.071, HZ1)
BONE, IGN, CHROME, POLY, STEEL, RUBBER, LED = ('kn_powder_bone', 'kn_powder_ignition', 'kn_chrome', 'kn_poly_clear',
                                               'kn_steel_brushed', 'kn_rubber', 'kn_led')
MASTERS = [BONE, IGN, CHROME, POLY, STEEL, RUBBER, LED, 'kn_decal']
AXIS_X = lambda x: kit.frame((x, 0.0, AZ), 'x')  # noqa: E731  local +Z = +X on the ram axis


def box(k, x0, x1, y0, y1, z0, z1, mat):
    k.rbox((x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 0.0, mat, cseg=0)


def window_outline(n):
    """L-shaped clear band in (y, z): 2.5 mm thick, 0.5 mm inside the housing skin, rounded over the front-top
    edge (rim centre (-0.0795, 0.1715), r 8.5 mm). CCW."""
    import math
    ro, ri, cy, cz = 0.008, 0.0055, -HY + 0.0085, HZ1 - 0.0085
    top, front = HZ1 - 0.0005, -HY + 0.0005
    pts = [(WIN_Y1, top)]
    for i in range(n + 1):
        a = math.pi / 2 + math.pi / 2 * i / n
        pts.append((cy + ro * math.cos(a), cz + ro * math.sin(a)))
    pts += [(front, WIN_Z0), (front + 0.0025, WIN_Z0)]
    for i in range(n + 1):
        a = math.pi - math.pi / 2 * i / n
        pts.append((cy + ri * math.cos(a), cz + ri * math.sin(a)))
    pts.append((WIN_Y1, top - 0.0025))
    return pts


def housing(lod, q, mats):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    outer = Kit()
    outer.rbox(HSIZE, HC, 0.010 if lod < 3 else 0.004, BONE, cseg=cs, rz=0.0085 if lod < 3 else 0.004)  # rz < r: no collapsed cap corners for the EXACT boolean
    if lod >= 3:  # opaque silhouette: no interior
        return outer
    cav = Kit()
    cav.rbox((HSIZE[0] - 2 * WALL, HSIZE[1] - 2 * WALL, HSIZE[2] - 2 * WALL), HC, 0.004, BONE, cseg=1)
    win = Kit()
    box(win, WIN_X0, WIN_X1, -0.10, WIN_Y1, WIN_Z0, 0.19, BONE)
    # window notch first, then the cavity (which opens into the notch, so the result stays one shell); with both
    # cutters in one modifier stack the EXACT solver dropped the cavity at LOD0
    return kit.boolean_diff(kit.boolean_diff(outer, [win], mats), [cav], mats)


def build(lod, q, mats):
    body = housing(lod, q, mats)
    # clear window band over the top + upper front, ends tucked 0.5 mm into the bone frames
    body.prism(window_outline(seg(6, q, 1) if lod < 2 else 1), WIN_X0 - 0.0005, WIN_X1 + 0.0005, POLY,
               m=kit.X_AXIS)
    if lod < 3:
        # spring seat plate, nose bushing (ram guide) and the wound chrome spring (Ø 0.05)
        body.cyl(0.030, SPRING_X0 - 0.006, SPRING_X0, STEEL, seg(28, q, 8), bev=0.001 if lod < 2 else 0.0, bseg=1,
                 m=AXIS_X(0))
        body.cyl(0.021, HX1 - 0.010, HX1 + 0.0005, STEEL, seg(32, q, 8), bev=0.0012 if lod < 2 else 0.0, bseg=1,
                 m=AXIS_X(0))
    else:
        body.cyl(0.025, SPRING_X0, SPRING_X1, CHROME, 6, m=AXIS_X(0))
    _m2.led_dome(body, 8, LED_C, (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.25))
    # M5 button heads, 4 per side: front corners (upper pair on the window frames), back corners, -X end
    for x, z in ((-0.135, 0.022), (0.035, 0.022), (-0.1365, 0.156), (0.0365, 0.156)):
        _m2.screw(body, 'M5', (x, -HY, z), (0, -1, 0), q, lod)
    for x in (-0.135, 0.035):
        for z in (0.022, 0.162):
            _m2.screw(body, 'M5', (x, HY, z), (0, 1, 0), q, lod)
    for y in (-0.064, 0.064):
        for z in (0.024, 0.160):
            _m2.screw(body, 'M5', (HX0, y, z), (-1, 0, 0), q, lod)
    for x in (-0.128, 0.028):
        for y in (-0.066, 0.066):
            _m2.foot(body, 'M', x, y, q, lod)

    pieces = {'housing': body}
    # the wound chrome spring: its own piece so sk_compress (1 = wound, the default) can work it. Base mesh = the
    # relaxed spring (out to the nose bushing at x 0.040); the key is the wound (modelled) length.
    if lod < 3:
        spring = Kit()
        _m2.coil(spring, 0.0215, 0.0035, 0.0, (SPRING_RELAX if lod < 2 else SPRING_X1) - SPRING_X0, 9.0, CHROME, q, lod,
                 m=AXIS_X(SPRING_X0))
        if lod < 2:
            alt = Kit()
            _m2.coil(alt, 0.0215, 0.0035, 0.0, SPRING_X1 - SPRING_X0, 9.0, CHROME, q, lod, m=AXIS_X(SPRING_X0))
            spring.shape_keys['sk_compress'] = (alt, '1 = wound (default; spring x -0.138..-0.030 behind the ram collar); '
                                                 '0 = relaxed to the nose bushing (x 0.040)', 1.0)
        pieces['spring'] = spring
    rs = seg(32, q, 6)
    bev = 0.0012 if lod < 2 else 0.0
    for name in ('ram_1', 'ram_2', 'glove'):
        r, x0, x1 = TUBE[name]
        k = Kit(pivot='PIVOT__' + name)
        k.cyl(r, x0, x1, CHROME, rs, bev=bev, bseg=1, m=AXIS_X(0))
        if name == 'ram_1':  # spring collar
            k.cyl(0.0225, SPRING_X1, SPRING_X1 + 0.008, STEEL, rs, bev=bev, bseg=1, m=AXIS_X(0))
        pieces[name] = k
    g = pieces['glove']
    g.cyl(CUFF_R, CUFF_X0, CUFF_X1, BONE, seg(40, q, 6), bev=0.0025 if lod < 3 else 0.0, bseg=(2, 2, 1, 1)[lod],
          m=AXIS_X(0))
    g.sphere(GLOVE_R, IGN, seg(44, q, 6), seg(22, q, 4, 2), m=kit.frame(GLOVE_C, 'x'), sz_bot=GLOVE_BACK)
    if lod < 3:  # thumb lying along the top of the fist
        g.sphere(0.021, IGN, seg(24, q, 6), seg(12, q, 4, 2), m=kit.frame((0.090, 0.0, 0.137), (1, 0, -0.25)),
                 sz_top=1.35, sz_bot=1.1)
    # name plate on the cuff front (graphite ink on the bone cuff), riding PIVOT__glove
    decals = [kit.decal_plane('name.punchline.graphite', (0.064, -CUFF_R, AZ), (0, -1, 0), (0, 0, 1), 0.020,
                              pivot='PIVOT__glove')]
    return kit.add_decals(pieces, lod, decals)


def under(part, ob, pivot):
    """Hang a COL shape under its pivot (world transform kept) so it rides the moving piece."""
    piv = part.pivots['PIVOT__' + pivot]
    w = ob.matrix_world.copy()
    ob.parent = piv
    ob.matrix_parent_inverse = piv.matrix_world.inverted()
    ob.matrix_world = w


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '3,2,2', 4.0, 'bottom', 8500,
        'Spring boxing glove: bone housing with a clear top + upper-front window showing the wound chrome spring '
        'and the three-stage chrome ram (nested slide pivots ram_1 -> ram_2 -> glove, metres along +X), Ignition '
        'glove Ø 0.12 on a bone cuff, modelled retracted (rest = 0). Brief: '
        'docs/art/briefs/contraptions.md#punchline. Name plate on the cuff (20 mm wide: the only cuff band left '
        'clear of the fist). No pictogram (Punchline: skip). COL ram / glove hang under their pivots. Deferred: '
        'poly window thickness map. Shape key sk_compress on the spring piece (1 = wound, default weight 1; LOD0/1).',
        MASTERS, led_groups='0:ready', skins='classic,champ')
    part.pivot('ram_1', (TUBE['ram_1'][2], 0.0, AZ), 'x', 0.0, 0.17, motion='slide')
    part.pivot('ram_2', (TUBE['ram_2'][2], 0.0, AZ), 'x', 0.0, 0.17, motion='slide')
    part.pivot('glove', GLOVE_C, 'x', 0.0, 0.16, motion='slide')
    _m2.nest(part, 'ram_2', 'ram_1')
    _m2.nest(part, 'glove', 'ram_2')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('housing', HSIZE, HC, phys='powder', restitution=0.2, friction=0.5)
    r, x0, x1 = TUBE['ram_1']
    under(part, part.col_capsule('ram', 0.012, x1 - x0, ((x0 + x1) / 2, 0.0, AZ), 'x', phys='steel'), 'ram_1')
    under(part, part.col_sphere('glove', GLOVE_R, GLOVE_C, phys='powder', restitution=0.3, friction=0.6), 'glove')
    part.port('signal', 'trigger', (-0.10, -HY, 0.06), (0, -1, 0), 'M', 'in')
    part.emit('pow', 'glove', (0.16, 0.0, AZ), (1, 0, 0))['pivot'] = 'glove'
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
