"""Procedurally build the CORK BLASTER source file (docs/art/briefs/boom.md, "CORK BLASTER: Toy cork pop-gun on a stand").

Usage: blender -b --factory-startup -P tools/blender/make_cork_blaster.py -- [out.blend]
Default output: assets/src/boom/cork_blaster.blend

A toy pop tube, never a firearm: a fat kn_powder_ignition barrel (Ø 0.06, axis x at z 0.06) lying in the cradle of
a pillowed kn_powder_bone saddle stand (0.18 x 0.08, top z 0.039) on four FOOT_M bumpers, with a bone -X end cap
(the PR-S tension hook ring sits on its face) and a bone muzzle bell (Ø 0.075 at x 0.135). The front half of the
barrel between x -0.06 and +0.02 is a kn_poly_clear window over a bone-lined interior showing the chrome spring
and the chrome piston (PIVOT__piston, x slide 0..0.06). Behind the end cap the kn_powder_ignition_gloss pull ring
(torus Ø 0.045 with a cross bar) rides PIVOT__plunger (x slide -0.025..0) on a chrome shaft through the hook
socket. A kn_cardboard cork sits in the bell (piece `cork`: the engine hides it and launches the separate cork
body) tied by a kn_rope string (Ø 2 mm, piece `string`) to a steel eyelet under the bell. LED_D8 ready dome on
the stand top; PR-S signal fire ring on a bone land on the stand front. No grip, trigger, sights or stock, and
nothing black or gunmetal.
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

TYPE = 'cork_blaster'
BONE, RUBBER, IGN, CLEAR, CHROME, GLOSS, CORK, ROPE, STEEL, LED = (
    'kn_powder_bone', 'kn_rubber', 'kn_powder_ignition', 'kn_poly_clear', 'kn_chrome', 'kn_powder_ignition_gloss',
    'kn_cardboard', 'kn_rope', 'kn_steel_brushed', 'kn_led')
MASTERS = [BONE, RUBBER, IGN, CLEAR, CHROME, GLOSS, CORK, ROPE, STEEL, LED]
FEET = 0.004
STAND = (0.18, 0.08, 0.039)
BZ, BR = 0.06, 0.03                   # barrel axis height, radius
WIN_X0, WIN_X1 = -0.06, 0.02
PISTON = Vector((-0.043, 0.0, BZ))   # rest: piston faces at x -0.046 / -0.040 (fired: front face at +0.020)
PLUNGER = Vector((-0.13, 0.0, BZ))
RING_X = -0.146
PORT_FIRE = (-0.03, -0.041, 0.021)
PORT_PULL = (-0.128, 0.0, BZ)
EYELET = (0.12, 0.0, 0.03)
LED_C = (-0.07, -0.029, STAND[2])
SPR_R, SPR_W, SPR_COCKED, SPR_FIRED = 0.0185, 0.0019, 0.0145, 0.0745   # spring from the window start (x -0.06)
STRING = [(0.1478, 0.0, 0.0475), (0.1500, 0.0, 0.0430), (0.1490, 0.0, 0.0330), (0.1450, 0.0, 0.0240),
          (0.1380, 0.0, 0.0182), (0.1290, 0.0, 0.0188), (0.1225, 0.0, 0.0222)]


def ax(x0=0.0):
    """Barrel frame: local z = Blender +x (offset x0), local (x, y) = Blender (y, z) about the barrel axis."""
    return kit.at(x0, 0.0, BZ) @ kit.X_AXIS


def face(x, y, z):
    return kit.at(x, y, z) @ kit.FRONT_OUT


def catmull(pts, sub):
    p = [Vector(v) for v in pts]
    p = [p[0] * 2 - p[1]] + p + [p[-1] * 2 - p[-2]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(sub):
            t = k / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(p[-2])
    return out


def bell_profile(ns, lod):
    prof = [(0.0, 0.100, BONE), (BR + 0.0005, 0.100, BONE)]
    for i in range(1, ns + 1):
        t = i / ns
        prof.append((BR + 0.0005 + 0.007 * t * t, 0.100 + 0.0335 * t, BONE))
    if lod < 2:
        prof += [(0.0372, 0.1350, BONE), (0.0350, 0.1350, BONE)]
    else:
        prof += [(0.0350, 0.1350, BONE)]
    prof += [(0.0168, 0.1150, BONE), (0.0160, 0.1120, BONE), (0.0, 0.1120, BONE)]
    return kit.dedupe(prof)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(40, q, 8 if lod < 3 else 6)
    body = Kit()
    # saddle stand with the barrel cradle cut, feet, LED, port land
    stand = Kit()
    stand.rbox((STAND[0], STAND[1], STAND[2] - FEET), (0, 0, (FEET + STAND[2]) / 2), 0.008 if lod < 3 else 0.004,
               BONE, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    if lod < 3:  # LOD3: the barrel simply overlaps the solid stand
        cut = Kit()
        cut.cyl(BR + 0.0008, -0.1, 0.1, BONE, n, m=ax())
        stand = kit.boolean_diff(stand, [cut], mats)
    body.merge(stand)
    stand.free()
    for x in (-0.07, 0.07):
        for y in (-0.025, 0.025):
            _m2.foot(body, 'M', x, y, q, lod)
    body.rbox((0.032, 0.031, 0.002), (0, 0, 0), 0.006 if lod < 3 else 0.0, BONE, cseg=max(1, cs - 1),
              rz=0.0006 if lod < 2 else 0.0, m=face(PORT_FIRE[0], PORT_FIRE[1] + 0.001, PORT_FIRE[2]))
    _m2.led_dome(body, 8, LED_C, (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # barrel: solid rear section, window section (bone-lined ignition back half + clear front half), front section
    bev = 0.0015 if lod < 3 else 0.0
    body.cyl(BR, -0.115, WIN_X0 + 0.001, IGN, n, bev=bev, bseg=1, m=ax())
    body.cyl(BR, WIN_X1 - 0.001, 0.104, IGN, n, bev=bev, bseg=1, m=ax())
    if lod < 3:
        ring = [(0.0272, WIN_X0, IGN), (BR, WIN_X0, IGN), (BR, WIN_X1, IGN), (0.0272, WIN_X1, BONE)]
        half = max(3, n // 2)
        body.lathe_arc(ring, -math.pi / 2, math.pi / 2, half, m=ax())
        glass = [(0.0275, WIN_X0 + 0.0005, CLEAR), (BR - 0.0002, WIN_X0 + 0.0005, CLEAR),
                 (BR - 0.0002, WIN_X1 - 0.0005, CLEAR), (0.0275, WIN_X1 - 0.0005, CLEAR)]
        body.lathe_arc(glass, math.pi / 2, 3 * math.pi / 2, half, m=ax())
        # window rims: thin ignition collars hide the seams
        for x in (WIN_X0, WIN_X1):
            body.torus(BR, 0.0012, IGN, n, (6, 4, 3, 3)[lod], m=ax(x))
    else:
        body.cyl(BR, WIN_X0, WIN_X1, IGN, n, m=ax())
    # bone end cap (PR-S hook ring on its -X face) and muzzle bell
    body.cyl(0.033, 0.111, 0.128, BONE, n, bev=0.003 if lod < 3 else 0.0, bseg=cs, bev_bot=0.0, m=ax() @ kit.rot_x(180))
    body.lathe(bell_profile((8, 6, 4, 3)[lod], lod), n, ax())
    # steel eyelet under the bell (string anchor)
    if lod < 3:
        body.torus(0.0034, 0.001, STEEL, seg(12, q, 6), (6, 4, 3, 3)[lod],
                   m=kit.at(EYELET[0], 0.0, 0.0258) @ kit.rot_x(90))
    # piston (chrome disc + rubber seal + rod), plunger (gloss pull ring + cross bar + chrome shaft)
    piston = Kit(pivot='PIVOT__piston')
    if lod < 3:
        piston.cyl(0.0255, -0.003, 0.003, CHROME, n, bev=0.0012 if lod < 2 else 0.0, bseg=1, m=ax(PISTON.x))
        if lod < 2:
            piston.torus(0.0255, 0.0013, RUBBER, n, 5 if lod == 0 else 4, m=ax(PISTON.x))
        piston.cyl(0.003, -0.072, -0.002, CHROME, seg(10, q, 5), m=ax(PISTON.x))
    # LOD3: the window is solid, so the piston is hidden and dropped
    plunger = Kit(pivot='PIVOT__plunger')
    plunger.cyl(0.003, RING_X, -0.100, CHROME, seg(10, q, 5), m=ax())
    plunger.torus(0.019, 0.0035, GLOSS, seg(36, q, 8), (8, 6, 4, 3)[lod], m=ax(RING_X))
    plunger.cyl(0.0028, -0.0185, 0.0185, GLOSS, seg(10, q, 5), m=kit.at(RING_X, 0.0, BZ))
    if lod < 3:
        plunger.sphere(0.0055, GLOSS, seg(14, q, 6), (6, 4, 3, 2)[lod], m=kit.at(RING_X + 0.001, 0.0, BZ))
    # cork (separate sim body at runtime) and its string
    cork = Kit()
    cprof = [(0.0, 0.1135, CORK), (0.0122, 0.1135, CORK), (0.0150, 0.1465, CORK)]
    if lod < 2:
        cprof += [(0.0145, 0.1480, CORK), (0.0, 0.1480, CORK)]
    else:
        cprof += [(0.0, 0.1480, CORK)]
    cork.lathe(cprof, seg(24, q, 6), ax())
    string = Kit()
    string.sweep(catmull(STRING, seg(3, q, 1)), 0.001, (6, 5, 4, 3)[lod], ROPE)
    if lod < 2:
        string.sphere(0.0022, ROPE, 8, 4, m=kit.at(*STRING[0]))
    # chrome spring behind the piston: its own piece so sk_compress (1 = cocked, the default) can work it. The
    # base mesh is the released spring (piston fired, +0.06); the key is the cocked (modelled) length.
    spring = Kit()
    if lod < 3:
        _m2.coil(spring, SPR_R, SPR_W, 0.0, SPR_FIRED if lod < 2 else SPR_COCKED, 3.0, CHROME, q, lod, m=ax(WIN_X0))
        if lod < 2:
            alt = Kit()
            _m2.coil(alt, SPR_R, SPR_W, 0.0, SPR_COCKED, 3.0, CHROME, q, lod, m=ax(WIN_X0))
            spring.shape_keys['sk_compress'] = (alt, '1 = cocked (default; the spring packed 14.5 mm behind the piston '
                                                 'at rest); 0 = released, stretched 74.5 mm to the fired piston', 1.0)
    pieces = {'body': body, 'spring': spring, 'piston': piston, 'plunger': plunger, 'cork': cork, 'string': string}
    # Decals: amber stripe ring behind the bell (square stripes: one tile round the 0.1885 m circumference),
    # name plate on the stand front, launch pictogram on the stand's +X end.
    band_h = 0.0155
    v = band_h * (1016.0 / (2 * math.pi * BR)) / 120.0
    decals = [
        kit.decal_cylinder('trim.hazard_r', (0.0915, 0, BZ), (1, 0, 0), BR, (0, -1, 0), 0, band_h, nu=seg(40, 1.0, 8),
                           span=2 * math.pi, sub=(0.0, 0.0, 1.0, v)),
        kit.decal_plane('name.cork_blaster.graphite', (0.045, -STAND[1] / 2, 0.0215), (0, -1, 0), (0, 0, 1), 0.060),
        kit.decal_plane('picto.launch.warn', (STAND[0] / 2, 0.0, 0.0215), (1, 0, 0), (0, 0, 1), 0.024, 0.024),
    ]
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '3,1,1', 0.9, 'bottom', 5500,
        'Toy cork pop-gun on a bone saddle stand (never a firearm: no grip, trigger, sights or stock, nothing black '
        'or gunmetal). Ignition tube 0.219 long / 0.06 = 3.65:1 (0.263 overall with the bone end cap and bell). '
        'Clear front-half window shows the chrome spring and the piston (PIVOT__piston, x slide 0..0.06); pull '
        'ring + shaft on PIVOT__plunger (x slide -0.025..0, modelled at 0). Brief: '
        'docs/art/briefs/boom.md#cork-blaster. Pieces `cork` and `string` are static render pieces the engine '
        'hides when it spawns the separate cork body (0.02 kg, COL__capsule__cork r 0.014 x 0.035, sharp, '
        'authored in code; not in this part\'s COL so it never welds to the stand) and the 1.5 m tether. '
        'COL__box__stand read as W x D x H (0.18 x 0.08 x 0.039). Decals: stripe ring behind the bell, name plate, '
        'launch pictogram. Shape key sk_compress on the spring piece (1 = cocked, default weight 1; LOD0/1).',
        MASTERS, led_groups='0:ready')
    part.pivot('plunger', tuple(PLUNGER), 'x', -0.025, 0.0, motion='slide')
    part.pivot('piston', tuple(PISTON), 'x', 0.0, 0.06, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('stand', STAND, (0, 0, STAND[2] / 2), phys='powder', restitution=0.2, friction=0.6)
    part.col_cyl('barrel', BR, 0.23, (-0.005, 0, BZ), 'x', phys='powder', restitution=0.2, friction=0.5)
    part.port('signal', 'fire', PORT_FIRE, (0, -1, 0), 'S', 'in')
    part.port('tension', 'pull', PORT_PULL, (-1, 0, 0), 'S', 'in', kind='hook')
    part.emit('muzzle', 'barrel', (0.135, 0.0, BZ), (1, 0, 0))
    part.emit('string', 'eyelet', EYELET, (1, 0, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
