"""Procedurally build the GOTCHA BOX source file (docs/art/briefs/contraptions.md, "GOTCHA BOX: Pop-up spring sprite
box").

Usage: blender -b --factory-startup -P tools/blender/make_gotcha_box.py -- [out.blend]
Default output: assets/src/contraptions/gotcha_box.blend

A bone crank box (0.18 x 0.182 x 0.169, z 0.005-0.174, 6 mm walls, open top) on four FOOT_L bumpers, with
Ignition corner posts and the Ignition lid (0.186 x 0.18 x 0.016) on PIVOT__lid (x, back top edge (0, 0.09, 0.174),
0-115°: the empty is yawed 180° so +angle opens). A kn_poly_clear front window (50 x 80 mm, x -0.08...-0.03,
z 0.03-0.11) in an Ignition frame shows the brass music comb and the pinned brass drum (PIVOT__drum, y, with its
gear) under three LED_D6 wind dots. The crank (PIVOT__crank, y, through the PR-M spin socket at
(0.035, -0.091, 0.095)): steel hub + arm 0.04 + Ignition knob Ø 0.025, modelled pointing down.
Inside, the sprite is modelled compressed under the closed lid: PIVOT__lean (x, floor hinge, 0-35°) ->
PIVOT__spring (z slide 0-0.30 m, chrome coil Ø 0.068) -> PIVOT__head (y, ±25°, at the neck) carrying the round
bone head (Ø 0.11, centre z 0.108), Ignition nose and ruff collar and the `trim.face_gotcha` face decal (-Y).
Baked clips gotcha_box__pop (0.6 s) and gotcha_box__reset (0.4 s).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import decal_atlas, kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'gotcha_box'
BW, BD, BZ0, BZ1 = 0.18, 0.182, 0.005, 0.174      # body: x +-0.09, y +-0.091
WALL = 0.006
FY = -BD / 2                                       # front face y
WIN = (-0.08, -0.03, 0.03, 0.11)                   # window x0, x1, z0, z1
CRANK = Vector((0.035, FY, 0.095))
DRUM = Vector((-0.055, -0.063, 0.048))
DRUM_R, DRUM_Y0, DRUM_Y1 = 0.012, -0.081, -0.045
LID_PIV = (0.0, 0.09, BZ1)
LID = (0.186, 0.180, 0.016)                        # x, y, z; y -0.094...0.086
LID_C = (0.0, -0.004, BZ1 + LID[2] / 2)
LEAN_Z, SPRING_Z, NECK_Z = 0.011, 0.016, 0.058
STROKE = 0.30                                      # PIVOT__spring slide
HEAD_C, HEAD_R = Vector((0.0, 0.0, 0.108)), 0.055
COIL_R, COIL_r = 0.030, 0.004
BONE, IGN, CHROME, BRASS, POLY, STEEL, RUBBER, LED = (
    'kn_powder_bone', 'kn_powder_ignition', 'kn_chrome', 'kn_brass', 'kn_poly_clear', 'kn_steel_brushed',
    'kn_rubber', 'kn_led')
MASTERS = [BONE, IGN, CHROME, BRASS, POLY, STEEL, RUBBER, LED, 'kn_decal']


def front(x, z, y=FY):
    """Frame on the front face: local (x, y) = Blender (x, z), local +z = -Y (out of the face)."""
    return kit.at(x, y, z) @ kit.FRONT_OUT


def box(k, x0, x1, y0, y1, z0, z1, mat, r=0.0, cs=0):
    k.rbox((x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), r, mat, cseg=cs)


def gear_outline(r, teeth, depth):
    pts = []
    for i in range(teeth * 4):
        a = 2 * math.pi * i / (teeth * 4)
        rr = r if (i % 4) in (0, 1) else r - depth
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


def body_kit(lod, q, mats):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    outer = Kit()
    outer.prism(kit.outline_rrect(BW, BD, 0.008 if lod < 3 else 0.004, cs), BZ0, BZ1, BONE,
                bt=0.002 if lod < 2 else 0.0, bb=0.006 if lod < 3 else 0.0, bseg=cs, bseg_top=1)
    if lod >= 3:
        body = outer
    else:
        cav = Kit()
        box(cav, -BW / 2 + WALL, BW / 2 - WALL, -BD / 2 + WALL, BD / 2 - WALL, BZ0 + WALL, BZ1 + 0.02, BONE,
            0.004, 1)
        hole = Kit()
        box(hole, WIN[0], WIN[1], FY - 0.01, FY + WALL + 0.004, WIN[2], WIN[3], BONE, 0.004, 1)
        body = kit.boolean_diff(outer, [cav, hole], mats)
    wc = ((WIN[0] + WIN[1]) / 2, (WIN[2] + WIN[3]) / 2)
    ww, wh = WIN[1] - WIN[0], WIN[3] - WIN[2]
    wo = kit.outline_rrect(ww + 0.002, wh + 0.002, 0.004, max(1, cs - 1))
    body.prism(wo, -0.0035, -0.0015, POLY, m=front(*wc))           # glass set 1.5 mm into the opening
    if lod < 3:  # Ignition window frame, 2 mm proud
        body.ring_sweep(kit.outline_rrect(ww, wh, 0.004, max(1, cs - 1)),
                        [(0.0, -0.0005), (0.004, -0.0005), (0.004, 0.0015), (0.0025, 0.002), (0.0, 0.002)],
                        IGN, m=front(*wc))
    # Ignition corner posts
    po = kit.outline_rrect(0.019, 0.019, 0.006 if lod < 3 else 0.0, max(1, cs - 1) if lod < 3 else 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            body.prism(po, BZ0 + 0.003, BZ1 - 0.002, IGN, bt=0.002 if lod < 2 else 0.0,
                       bb=0.002 if lod < 2 else 0.0, bseg=1, m=kit.at(sx * 0.0835, sy * 0.0845, 0))
    # static hinge knuckles on the back top edge (lid knuckle in between)
    for x0, x1 in ((-0.082, -0.048), (0.048, 0.082)):
        body.cyl(0.005, x0, x1, STEEL, seg(16, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1,
                 m=kit.frame((0, LID_PIV[1], LID_PIV[2]), 'x'))
    # wind LEDs above the window (group 0)
    for x in (-0.07, -0.055, -0.04):
        _m2.led_dome(body, 6, (x, FY, 0.124), (0, -1, 0), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08))
    # M5 corner screws: 4 per side face, 4 on the back
    for sx in (-1, 1):
        for y in (-0.062, 0.062):
            for z in (0.026, 0.152):
                _m2.screw(body, 'M5', (sx * BW / 2, y, z), (sx, 0, 0), q, lod)
    for x in (-0.062, 0.062):
        for z in (0.026, 0.152):
            _m2.screw(body, 'M5', (x, BD / 2, z), (0, 1, 0), q, lod)
    for x in (-0.062, 0.062):
        for y in (-0.062, 0.062):
            _m2.foot(body, 'L', x, y, q, lod)
    if lod < 3:
        # music mechanism: comb pillar + tines over the drum, drum bearing post, floor hinge cheeks
        box(body, -0.082, -0.069, -0.083, -0.045, BZ0 + WALL - 0.001, 0.074, BRASS, 0.002 if lod < 2 else 0.0, 1)
        if lod < 2:
            for i in range(9):
                y = -0.0805 + i * 0.0042
                ln = 0.019 - 0.005 * i / 8
                box(body, -0.0695, -0.069 + ln, y - 0.0013, y + 0.0013, 0.0612, 0.0624, BRASS)
        else:
            box(body, -0.0695, -0.052, -0.082, -0.046, 0.0612, 0.0624, BRASS)
        box(body, DRUM.x - 0.005, DRUM.x + 0.005, -0.044, -0.040, BZ0 + WALL - 0.001, DRUM.z + 0.005, STEEL,
            0.0015 if lod < 2 else 0.0, 1)
        for x in (-0.024, 0.024):
            box(body, x - 0.003, x + 0.003, -0.008, 0.008, BZ0 + WALL - 0.001, 0.018, STEEL,
                0.0015 if lod < 2 else 0.0, 1)
    return body


def build(lod, q, mats):
    pieces = {'body': body_kit(lod, q, mats)}
    bev = 0.0008 if lod < 2 else 0.0

    lid = Kit(pivot='PIVOT__lid')
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    lid.rbox(LID, LID_C, 0.008 if lod < 3 else 0.003, IGN, cseg=cs, rz=0.005 if lod < 3 else 0.002)
    lid.cyl(0.005, -0.045, 0.045, IGN, seg(16, q, 6), bev=bev, bseg=1, m=kit.frame((0, LID_PIV[1], LID_PIV[2]), 'x'))
    pieces['lid'] = lid

    crank = Kit(pivot='PIVOT__crank')
    out = kit.frame(tuple(CRANK), '-y')                       # local +z = -Y out of the socket
    crank.cyl(0.004, -0.006, 0.006, STEEL, seg(12, q, 6), m=out)
    crank.cyl(0.008, 0.0045, 0.0105, STEEL, seg(20, q, 6), bev=bev, bseg=1, m=out)
    box(crank, CRANK.x - 0.005, CRANK.x + 0.005, FY - 0.0105, FY - 0.0055, CRANK.z - 0.046, CRANK.z, STEEL,
        0.002 if lod < 3 else 0.0, 1 if lod < 2 else 0)
    crank.cyl(0.0125, 0.0105, 0.0285, IGN, seg(24, q, 6), bev=0.0045 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
              bev_bot=0.001 if lod < 2 else 0.0, m=kit.frame((CRANK.x, FY, CRANK.z - 0.04), '-y'))
    pieces['crank'] = crank

    drum = Kit(pivot='PIVOT__drum')
    ax = kit.frame((DRUM.x, 0.0, DRUM.z), 'y')               # local z = +Y
    drum.cyl(DRUM_R, DRUM_Y0, DRUM_Y1, BRASS, seg(24, q, 6), bev=bev, bseg=1, m=ax)
    drum.cyl(0.003, DRUM_Y0 - 0.003, DRUM_Y1 + 0.005, STEEL, seg(10, q, 4), m=ax)
    if lod < 3:
        drum.prism(gear_outline(0.016, 12, 0.002), DRUM_Y0 - 0.003, DRUM_Y0, BRASS, m=ax)
    if lod < 1:
        for i in range(24):  # pins: 8 rows x 3 angles, staggered
            a = 2 * math.pi * (i * 0.37 % 1.0)
            y = DRUM_Y0 + 0.003 + (DRUM_Y1 - DRUM_Y0 - 0.006) * (i % 8) / 7
            d = Vector((math.cos(a), 0.0, math.sin(a)))
            c = Vector((DRUM.x, y, DRUM.z)) + d * (DRUM_R - 0.0005)
            drum.cyl(0.0008, 0.0, 0.0032, BRASS, 4, m=kit.frame(tuple(c), tuple(d)))
    pieces['drum'] = drum

    lean = Kit(pivot='PIVOT__lean')
    lean.cyl(0.034, LEAN_Z, SPRING_Z, STEEL, seg(32, q, 8), bev=bev, bseg=1)
    lean.cyl(0.0035, -0.021, 0.021, STEEL, seg(10, q, 4), m=kit.frame((0, 0, 0.014), 'x'))
    pieces['lean'] = lean

    def coil_piece(z0, pivot='PIVOT__spring'):
        k = Kit(pivot=pivot)
        _m2.coil(k, COIL_R, COIL_r, z0, NECK_Z, 4.0, CHROME, q, lod)
        k.cyl(0.032, NECK_Z - 0.003, NECK_Z + 0.001, CHROME, seg(32, q, 8), bev=bev, bseg=1)
        return k
    spring = coil_piece(SPRING_Z)
    if lod < 2:  # stretched: the coil keeps its top at the neck and reaches down 0.30 (the slide), so at full slide
        # its foot stays on the lean plate
        spring.shape_keys['sk_stretch'] = (coil_piece(SPRING_Z - STROKE, None), '0 = compressed under the lid (rest); '
                                           '1 = stretched to full height: with PIVOT__spring at +0.30 the foot stays on '
                                           'the lean plate and the coil spans 0.342 m', 0.0)
    pieces['spring'] = spring

    head = Kit(pivot='PIVOT__head')
    n = seg(96, q, 16, 4)
    path = [(math.cos(2 * math.pi * i / n) * (0.038 + 0.005 * math.cos(12 * 2 * math.pi * i / n)),
             math.sin(2 * math.pi * i / n) * (0.038 + 0.005 * math.cos(12 * 2 * math.pi * i / n)),
             NECK_Z + 0.008) for i in range(n)]
    if lod < 3:
        head.sweep(path, 0.0085, seg(8, q, 4), IGN, closed=True)
    else:
        head.cyl(0.046, NECK_Z, NECK_Z + 0.016, IGN, 8)
    head.sphere(HEAD_R, BONE, seg(48, q, 8), seg(24, q, 4, 2), m=kit.at(*HEAD_C))
    head.sphere(0.010, IGN, seg(20, q, 6), seg(10, q, 4, 2), m=kit.frame((0.0, -HEAD_R + 0.003, HEAD_C.z - 0.002),
                                                                         '-y'))
    pieces['head'] = head

    # decals: name plate on the +X side (graphite on bone); the sprite face on the head (-Y), riding PIVOT__head
    face_rect = kit.atlas_rect('trim.face_gotcha', decal_atlas.FACE_SUB)
    decals = [kit.decal_plane('name.gotcha_box.graphite', (BW / 2, 0.0, 0.09), (1, 0, 0), (0, 0, 1), 0.06),
              kit.decal_wrap(face_rect, (0, -1, 0), (0, 0, 1), 0.085, lambda d: HEAD_C + d * HEAD_R, nu=8, nv=4,
                             pivot='PIVOT__head', ref=HEAD_R)]
    return kit.add_decals(pieces, lod, decals)


def under(part, ob, pivot):
    """Hang a COL shape under its pivot (world transform kept) so it rides the moving piece."""
    import bpy
    bpy.context.view_layer.update()
    piv = part.pivots['PIVOT__' + pivot]
    w = ob.matrix_world.copy()
    ob.parent = piv
    ob.matrix_parent_inverse = piv.matrix_world.inverted()
    ob.matrix_world = w


def main(out_path=None):
    import bpy
    part = kit.Part(
        TYPE, 'contraptions', 'L', '2,2,2', 3.0, 'bottom', 14000,
        'Pop-up spring sprite box, modelled closed: bone box, Ignition lid / corner posts / crank knob, brass comb '
        '+ pinned drum behind a clear front window, sprite compressed under the lid (head centre z 0.108). '
        'Brief: docs/art/briefs/contraptions.md#gotcha_box. Pivot chain lean -> spring -> head (nested); '
        'PIVOT__lid is yawed 180° so +115 opens; crank / drum turn continuously (no limits). Clips: '
        'gotcha_box__pop, gotcha_box__reset (spring overshoot kept inside 0-0.30 m as a rebound). COL lid / '
        'spring / head hang under their pivots. kn_bounds = origin (the crank knob reaches y -0.12). Box read as '
        'W 0.18 x D 0.182 x H 0.169 (the lid hinge at z 0.174 and the port at y -0.091 fix it), COL__box__box '
        '0.18 x 0.18 x 0.17 (x, y, z). Shape key sk_stretch on the spring piece (LOD0/1; drive it with the '
        'PIVOT__spring slide / 0.30). Deferred: window thickness map, face 1024 detail texture (atlas decal instead).',
        MASTERS, led_groups='0:wind', skins='classic,pumpkin', pipeline={'kn_bounds': 'origin'})
    part.pivot('crank', tuple(CRANK), 'y', motion='turn')
    part.pivot('drum', tuple(DRUM), 'y', motion='turn')
    part.pivot('lid', LID_PIV, 'x', 0.0, 115.0, motion='turn')
    part.pivots['PIVOT__lid'].rotation_euler = (0.0, 0.0, math.pi)   # local +x = world -X: +angle opens
    part.pivot('lean', (0.0, 0.0, LEAN_Z), 'x', 0.0, 35.0, motion='turn')
    part.pivot('spring', (0.0, 0.0, SPRING_Z), 'z', 0.0, 0.30, motion='slide')
    part.pivot('head', (0.0, 0.0, NECK_Z), 'y', -25.0, 25.0, motion='turn')
    bpy.context.view_layer.update()
    _m2.nest(part, 'spring', 'lean')
    _m2.nest(part, 'head', 'spring')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)

    part.col_box('box', (0.18, 0.18, 0.17), (0.0, 0.0, BZ0 + 0.085), phys='powder', restitution=0.2, friction=0.5)
    under(part, part.col_box('lid', LID, LID_C, phys='powder'), 'lid')
    under(part, part.col_capsule('spring', 0.034, 0.07, (0.0, 0.0, 0.046), 'z', phys='steel'), 'lean')
    under(part, part.col_sphere('head', HEAD_R, tuple(HEAD_C), phys='powder', restitution=0.4), 'spring')
    part.port('spin', 'crank', tuple(CRANK), (0, -1, 0), 'M', 'in', kind='axle')
    part.sensor('impact', 'box', [(x * 0.095, y * 0.096, z) for x in (-1, 1) for y in (-1, 1) for z in (0.0, 0.195)],
                threshold=1.0)
    y0, y1 = LID_C[1] - LID[1] / 2, LID_C[1] + LID[1] / 2
    part.sensor('impact', 'lid', [(x * LID[0] / 2, y, z) for x in (-1, 1) for y in (y0, y1) for z in (0.184, 0.196)],
                threshold=0.5, pivot='lid')
    part.emit('pop', 'lid', (0.0, 0.0, 0.19), (0, 0, 1))
    part.emit('pow', 'head', (0.0, -HEAD_R - 0.013, HEAD_C.z), (0, -1, 0))['pivot'] = 'head'

    _m2.clip(part, 'pop', {
        'lid': [(0.0, 0.0), (0.04, 60.0), (0.08, 105.0), (0.12, 115.0), (0.6, 115.0)],
        'spring': [(0.0, 0.0), (0.03, 0.0), (0.10, 0.24), (0.15, 0.30), (0.22, 0.255), (0.30, 0.30), (0.38, 0.285),
                   (0.46, 0.30), (0.6, 0.30)],
        'lean': [(0.0, 0.0), (0.12, 0.0), (0.24, 35.0), (0.32, 28.0), (0.42, 35.0), (0.6, 35.0)],
        'head': [(0.0, 0.0), (0.18, 0.0), (0.26, 25.0), (0.34, -18.0), (0.42, 11.0), (0.50, -5.0), (0.56, 2.0),
                 (0.6, 0.0)],
    })
    _m2.clip(part, 'reset', {
        'lean': [(0.0, 35.0), (0.12, 0.0), (0.4, 0.0)],
        'spring': [(0.0, 0.30), (0.06, 0.30), (0.24, 0.0), (0.4, 0.0)],
        'head': [(0.0, 0.0), (0.4, 0.0)],
        'lid': [(0.0, 115.0), (0.22, 115.0), (0.36, 0.0), (0.4, 0.0)],
    })
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
