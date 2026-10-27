"""Procedurally build the FABRICATOR source file (docs/art/briefs/future.md, "FABRICATOR: Part spawner with a preview
window and countdown").

Usage: blender -b --factory-startup -P tools/blender/make_fabricator.py -- [out.blend]
Default output: assets/src/future/fabricator.blend

A seamless "next year's catalogue" cube (3 x 3 x 3, bottom origin): a kn_powder_graphite shell (0.30, 15 mm pillow)
on a 0.28 plinth inset 10 mm with four Ø 0.020 rubber feet. Front face (y -0.150): the mouth (0.14 x 0.11, z 0.035 ...
0.145, 0.10 deep tunnel with an 8° floor ramp) in a kn_anod_plasma bezel with a kn_led rim bar (group 2) and the
smoked kn_poly_plasma flap on PIVOT__mouth_flap (axis x, hinge (0, -0.148, 0.145), 0 ... 75°, kicks outward); the
counter strip at z 0.165 (SCREEN__count 7seg x 3 and SCREEN__interval bar x 10, both plasma, in kit bezels); the
preview window (0.150 x 0.085 at z 0.235) in a 6 mm plasma bezel over a chamber where the kn_anod_graphite turntable
(Ø 0.080, plasma LED rim) turns on PIVOT__preview (axis z). PR-L signal spawn ring in the left cheek; status LED_D8
(group 0) and name plate in the right cheek. Top: three vent slots with kn_led glow strips (group 1) in plasma trims.
Rear service panel with 2 flush M5 (no visible screws elsewhere). Clip `fabricator__spawn_kick` (0.4 s flap kick)
and shell shape key `sk_hiccup` (1 % squash).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'fabricator'
S = 0.30
FRONT = -0.150
SH_Z0 = 0.016
MOUTH_W, MOUTH_Z0, MOUTH_Z1, TUNNEL_Y1 = 0.14, 0.035, 0.145, -0.05
WIN_W, WIN_H, WIN_Z = 0.150, 0.085, 0.235
TT = (0.0, -0.090, 0.197)
HINGE = (0.0, -0.148, 0.145)
CNT_C = Vector((0.055, -0.151, 0.165))
CNT_W, CNT_H = 0.066, 0.024
INT_C = Vector((-0.055, -0.151, 0.165))
INT_W, INT_H = 0.070, 0.008
PORT = (-0.105, FRONT, 0.090)
STATUS = (0.105, -0.151, 0.125)
VENTS = (-0.04, 0.0, 0.04)
G, PLASMA, PPLASMA, AGRAPH, RUBBER, LED, SCREEN, GLASS, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_anod_graphite', 'kn_rubber', 'kn_led', 'kn_screen',
    'kn_glass', 'kn_steel_brushed')
MASTERS = [G, PLASMA, PPLASMA, AGRAPH, RUBBER, LED, SCREEN, GLASS, STEEL, 'kn_brass', 'kn_decal']


def led_group(c, _n):
    if c.z > S - 0.01:
        return 1, 0.25          # vent glow
    if abs(c.x) < 0.075 and MOUTH_Z0 - 0.01 < c.z < MOUTH_Z1 + 0.01 and c.y < -0.12:
        return 2, 0.25          # mouth rim
    if c.y > -0.12:
        return 1, 0.25          # turntable rim (print glow)
    return 0, 0.08              # status


def frame_ring(k, mats, w_out, h_out, w_in, h_in, r_out, r_in, y_front, depth, zc, mat, cs, bev=0.0):
    """Rectangular bezel ring standing `depth` proud of the front face (FRONT_OUT: local (x, y) = Blender (x, z))."""
    ring = Kit()
    ring.prism(kit.outline_rrect(w_out, h_out, r_out, cs), -0.002, depth, mat, bt=bev, bseg=1,
               m=kit.at(0, y_front, zc) @ kit.FRONT_OUT)
    hole = Kit()
    hole.prism(kit.outline_rrect(w_in, h_in, r_in, cs), -0.01, depth + 0.01, mat, m=kit.at(0, y_front, zc) @ kit.FRONT_OUT)
    k.merge(kit.boolean_diff(ring, [hole], mats))


def shell(lod, q, mats):
    cs = (max(2, int(round(5 * q))), max(2, int(round(2.5 * q))), max(2, int(round(1.6 * q))), 2)[lod]
    k = Kit()
    k.rbox((S, S, S - SH_Z0), (0, 0, (SH_Z0 + S) / 2), 0.015, G, cseg=cs,
           rz=0.012)  # rz < r: an equal rim radius collapses each corner of the cap n-gon to one point
    if lod < 3:
        cut = Kit()
        # mouth tunnel
        cut.rbox((MOUTH_W, (TUNNEL_Y1 - FRONT) + 0.02, MOUTH_Z1 - MOUTH_Z0 + 0.0),
                 (0, (FRONT - 0.02 + TUNNEL_Y1) / 2, (MOUTH_Z0 + MOUTH_Z1) / 2), 0.006, G, cseg=max(1, cs - 1), rz=0.0)
        # preview chamber behind the window
        cut.rbox((WIN_W - 0.004, 0.09, WIN_H - 0.004), (0, FRONT + 0.035, WIN_Z), 0.008, G, cseg=max(1, cs - 1),
                 rz=0.006 if lod < 2 else 0.0)
        # three vent slots in the top
        for y in VENTS:
            cut.rbox((0.18, 0.008, 0.02), (0, y, S - 0.004), 0.003, G, cseg=max(1, cs - 1), rz=0.0)
        # rear service panel groove
        if False:  # groove left to the normal map (debug: boolean leaves open edges)
            ring = Kit()
            ring.prism(kit.outline_rrect(0.16, 0.12, 0.01, 2), -0.0012, 0.003, G, m=kit.at(0, -FRONT, 0.12) @
                       kit.frame(axis='y') @ kit.rot_z(0))
            inner = Kit()
            inner.prism(kit.outline_rrect(0.157, 0.117, 0.0085, 2), -0.01, 0.01, G, m=kit.at(0, -FRONT, 0.12) @
                        kit.frame(axis='y'))
            cut.merge(kit.boolean_diff(ring, [inner], mats))
        # the big cap n-gons trip the EXACT solver where the vent slots cross them: fan them into triangles first
        import bmesh
        bmesh.ops.triangulate(k.bm, faces=[f for f in k.bm.faces if len(f.verts) > 4])
        k = kit.boolean_diff(k, [cut], mats)
        # rear service panel: a 1.5 mm raised plate (a cut groove left open edges with the EXACT solver)
        k.prism(kit.outline_rrect(0.16, 0.12, 0.01, max(1, cs - 1)), -0.0015, 0.0015, G,
                bt=0.0008 if lod < 2 else 0.0, bseg=1, m=kit.at(0, -FRONT, 0.12) @ kit.frame(axis='y'))
        # mouth floor ramp (8° down to the front)
        y0, y1 = FRONT + 0.004, TUNNEL_Y1
        z0 = MOUTH_Z0
        z1 = z0 + (y1 - y0) * math.tan(math.radians(8))
        k.hull([(x, y, z) for x in (-MOUTH_W / 2 + 0.001, MOUTH_W / 2 - 0.001)
                for y, z in ((y0, z0), (y1, z1), (y1, MOUTH_Z0 - 0.004), (y0, MOUTH_Z0 - 0.004))], G)
    else:  # LOD3: a dark mouth inset and the window as flat panels
        k.rbox((MOUTH_W, 0.002, MOUTH_Z1 - MOUTH_Z0), (0, FRONT - 0.0005, (MOUTH_Z0 + MOUTH_Z1) / 2), 0.0, AGRAPH,
               cseg=0, rz=0.0)
    for x in (-0.03, 0.03):
        _m2.screw(k, 'M5', (x, -FRONT + 0.002, 0.12), (0, 1, 0), q, lod)
    if lod < 2:  # print gantry seen through the window: two steel rails, a graphite carriage, a brass nozzle
        for z in (0.262, 0.270):
            k.cyl(0.0022, -0.072, 0.072, STEEL, seg(12, q, 6), m=kit.at(0, -0.074, z) @ kit.frame(axis='x'))
        k.rbox((0.022, 0.016, 0.020), (0.022, -0.080, 0.262), 0.003, AGRAPH, cseg=2, rz=0.002)
        k.lathe([(0.0, 0.252, 'kn_brass'), (0.004, 0.252, 'kn_brass'), (0.004, 0.246, 'kn_brass'),
                 (0.0012, 0.240, 'kn_brass'), (0.0, 0.240, 'kn_brass')], seg(14, q, 6), kit.at(0.022, -0.082, 0))
    return k


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    body = shell(lod, q, mats)
    plinth = Kit()
    plinth.rbox((0.28, 0.28, 0.012), (0, 0, 0.004 + 0.006), 0.012 if lod < 3 else 0.0, G, cseg=cs,
                rz=0.003 if lod < 3 else 0.0)
    for x in (-0.12, 0.12):
        for y in (-0.12, 0.12):
            if True:  # feet on every LOD (8-gon at LOD3)
                plinth.cyl(0.010, 0.0, 0.0046, RUBBER, seg(16, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1,
                           bev_bot=0.0008 if lod < 2 else 0.0, m=kit.at(x, y, 0))
    trims = Kit()
    if lod < 3:
        frame_ring(trims, mats, MOUTH_W + 0.016, MOUTH_Z1 - MOUTH_Z0 + 0.016, MOUTH_W, MOUTH_Z1 - MOUTH_Z0, 0.012,
                   0.006, FRONT, 0.003, (MOUTH_Z0 + MOUTH_Z1) / 2, PLASMA, max(1, cs), bev=0.001 if lod < 2 else 0.0)
        frame_ring(trims, mats, WIN_W + 0.012, WIN_H + 0.012, WIN_W, WIN_H, 0.008, 0.004, FRONT, 0.003, WIN_Z, PLASMA,
                   max(1, cs), bev=0.001 if lod < 2 else 0.0)
        for y in VENTS:  # plasma vent trims + LED glow strips
            fr = Kit()
            fr.rbox((0.188, 0.016, 0.004), (0, y, S - 0.0012), 0.006, PLASMA, cseg=max(1, cs - 1), rz=0.001)
            hole = Kit()
            hole.rbox((0.18, 0.008, 0.02), (0, y, S), 0.003, PLASMA, cseg=max(1, cs - 1), rz=0.0)
            trims.merge(kit.boolean_diff(fr, [hole], mats))
            trims.rbox((0.176, 0.006, 0.002), (0, y, S - 0.006), 0.003, LED, cseg=1, rz=0.0)
        # mouth rim light bar just inside the bezel
        rim = Kit()
        rim.prism(kit.outline_rrect(MOUTH_W - 0.001, MOUTH_Z1 - MOUTH_Z0 - 0.001, 0.006, max(1, cs - 1)), -0.006,
                  -0.003, LED, m=kit.at(0, FRONT, (MOUTH_Z0 + MOUTH_Z1) / 2) @ kit.FRONT_OUT)
        hole = Kit()
        hole.prism(kit.outline_rrect(MOUTH_W - 0.006, MOUTH_Z1 - MOUTH_Z0 - 0.006, 0.004, max(1, cs - 1)), -0.02, 0.02,
                   LED, m=kit.at(0, FRONT, (MOUTH_Z0 + MOUTH_Z1) / 2) @ kit.FRONT_OUT)
        trims.merge(kit.boolean_diff(rim, [hole], mats))
        # window pane
        trims.rbox((WIN_W + 0.002, 0.003, WIN_H + 0.002), (0, FRONT + 0.0015, WIN_Z), 0.005, PPLASMA, cseg=max(1, cs - 1),
                   rz=0.0)
    else:
        trims.rbox((WIN_W, 0.002, WIN_H), (0, FRONT - 0.0005, WIN_Z), 0.0, PPLASMA, cseg=0, rz=0.0)
        for y in VENTS:
            trims.rbox((0.18, 0.008, 0.002), (0, y, S), 0.0, LED, cseg=0, rz=0.0)
    _m2.led_dome(trims, 8, STATUS, (0, -1, 0), q, lod)
    # counter strip: count (7seg x 3) and interval (bar x 10) in kit bezels
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    depth = 0.0025
    if lod < 3:
        c1 = Vector(_m2.screen_bezel(trims, mats, CNT_W, CNT_H, tuple(CNT_C - n * (depth - 0.0015)), tuple(n), tuple(up),
                                     lod, q, depth=depth))
        c2 = Vector(_m2.screen_bezel(trims, mats, INT_W, INT_H, tuple(INT_C - n * (depth - 0.0015)), tuple(n), tuple(up),
                                     lod, q, depth=depth))
    else:
        c1, c2 = CNT_C, INT_C
    trims.colors['led'] = _m2.led_attr(led_group)
    flap = Kit(pivot='PIVOT__mouth_flap')
    fh = 0.105
    flap.rbox((0.135, 0.006, fh), (0, HINGE[1] - 0.004, HINGE[2] - fh / 2 - 0.002), 0.004 if lod < 3 else 0.0, PPLASMA,
              cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.002 if lod < 3 else 0.0)
    if lod < 3:  # hinge knuckle
        flap.cyl(0.004, -0.0675, 0.0675, PLASMA, seg(12, q, 6), m=kit.at(*HINGE) @ kit.frame(axis='x'))
    tt = Kit(pivot='PIVOT__preview')
    tt.cyl(0.040, TT[2] - 0.004, TT[2], AGRAPH, seg(40, q, 8), bev=0.0015 if lod < 3 else 0.0, bseg=1,
           m=kit.at(TT[0], TT[1], 0))
    if lod < 3:
        tt.torus(0.0395, 0.0014, LED, seg(40, q, 8), 4, m=kit.at(TT[0], TT[1], TT[2] - 0.002))
        tt.cyl(0.006, TT[2] - 0.03, TT[2] - 0.003, STEEL, seg(12, q, 6), m=kit.at(TT[0], TT[1], 0))
    tt.colors['led'] = _m2.led_attr(led_group)
    body.shape_keys['sk_hiccup'] = (lambda co: Vector((co.x * 1.005, co.y * 1.005, co.z * 0.99)),
                                    '0 rest -> 1 the 1 % spawn hiccup squash (z -1 %, xy +0.5 %)', 0.0) if lod < 2 \
        else None
    if lod >= 2:
        body.shape_keys = {}
    pieces = {'shell': body, 'plinth': plinth, 'trims': trims, 'flap': flap, 'turntable': tt,
              'screen_count': kit.screen_quad(tuple(c1), tuple(n), tuple(up), CNT_W, CNT_H, lift=0.0002),
              'screen_interval': kit.screen_quad(tuple(c2), tuple(n), tuple(up), INT_W, INT_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.fabricator.bone', (0.105, FRONT, 0.070), (0, -1, 0), (0, 0, 1), 0.052),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'L', '3,3,3', 9.0, 'bottom', 18000,
        'Part spawner: seamless kn_powder_graphite cube (15 mm pillow) on an inset plinth with rubber feet; mouth '
        '(0.14 x 0.11, tunnel 0.10, 8° ramp) in a kn_anod_plasma bezel with a kn_led rim bar (group 2) and the '
        'kn_poly_plasma flap on PIVOT__mouth_flap (x, 0 ... 75°); counter strip SCREEN__count (7seg x 3) + '
        'SCREEN__interval (bar x 10), plasma; preview window in a 6 mm plasma bezel over the kn_anod_graphite turntable '
        '(PIVOT__preview, z; plasma LED rim, group 1); PR-L signal spawn (left cheek), status LED_D8 group 0 + name '
        'plate (right cheek); 3 top vent slots with kn_led glow (group 1); rear service panel with 2 flush M5. Clip '
        'fabricator__spawn_kick (flap 0 -> 75 -> 0 in 0.4 s); shape key sk_hiccup on the shell (the engine keys it '
        'with the clip; shape-key tracks in clips are deferred). UV1 authored for the 2048² + 1024² sets (bake '
        'pending). Brief: docs/art/briefs/future.md#fabricator.',
        MASTERS, led_groups='0:status,1:print_glow,2:mouth_rim', skins='graphite,lab_white')
    part.pivot('mouth_flap', HINGE, 'x', 0.0, 75.0, motion='turn')
    part.pivot('preview', TT, 'z', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=3.0)
    part.col_box('0', (S, S, 0.155), (0, 0, 0.145 + 0.0775), phys='powder', restitution=0.2, friction=0.5)
    for i, sx in ((1, -1), (2, 1)):
        part.col_box(str(i), (0.08, S, 0.129), (sx * 0.11, 0, 0.016 + 0.0645), phys='powder')
    part.col_box('3', (0.14, 0.20, 0.129), (0, 0.05, 0.016 + 0.0645), phys='powder')
    ramp = Matrix.Translation((0, -0.10, 0.03)) @ Matrix.Rotation(math.radians(-8), 4, 'X')
    part.col_box('4', (0.14, 0.10, 0.01), (0, 0, 0), phys='powder', matrix=ramp)
    part.col_box('5', (0.28, 0.28, 0.016), (0, 0, 0.008), phys='powder')
    part.sensor('trigger', 'mouth_clear', [(x * 0.07, y, z) for x in (-1, 1) for y in (-0.15, -0.26)
                                           for z in (0.035, 0.145)], jam_seconds=0.5)
    part.port('signal', 'spawn', PORT, (0, -1, 0), 'L', 'in')
    part.emit('spawn', 'mouth', (0, -0.110, 0.070), (0, -1, 0))
    part.emit('warp', 'front', (0, -0.150, 0.150), (0, -1, 0))
    part.emit('puff', 'mouth', (0, -0.155, 0.090), (0, -1, 0))
    part.emit('print', 'chamber', (0, -0.090, 0.210), (0, 0, 1))
    part.emit('preview', 'turntable', (0, -0.090, 0.200), (0, 0, 1))
    part.screen('count', CNT_W, CNT_H, tuple(CNT_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='7seg',
                digits=3, color='plasma')
    part.screen('interval', INT_W, INT_H, tuple(INT_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=10, color='plasma')
    _m2.clip(part, 'spawn_kick', {'mouth_flap': [(0.0, 0.0), (0.08, 75.0), (0.18, 75.0), (0.4, 0.0)]})
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
