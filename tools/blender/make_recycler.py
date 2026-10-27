"""Procedurally build the RECYCLER source file (docs/art/briefs/future.md, "RECYCLER: Despawning sink with a count
screen").

Usage: blender -b --factory-startup -P tools/blender/make_recycler.py -- [out.blend]
Default output: assets/src/future/recycler.blend

A low graphite bin (3 x 2 x 3, bottom origin, 12 mm pillow) on four FOOT_M bumpers. A kn_anod_plasma funnel lofts from
the 0.22 x 0.22 opening (40 mm corners) at z 0.200 down to the Ø 0.10 core at z 0.120 (the boolean's cutter faces are
the plasma walls), with a kn_led rim bar round the lip (group 0). In the core: SCREEN__core (icon, the engine's
plasma swirl) under six kn_anod_graphite iris blades on PIVOT__iris (axis z, 0 ... 25°, no teeth). Front:
SCREEN__count (7seg x 3, plasma) and SCREEN__target (7seg x 3, signal) in kit bezels with "IN" / "GOAL" captions,
the goal LED_D6 (group 1), the PR-M signal count ring and the name plate; rear exhaust grille. Never scary: no
trash-can or shredder cues.
"""
import bisect
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

TYPE = 'recycler'
W, H = 0.30, 0.20
FEET = 0.004
TOP_Z, CORE_Z = 0.200, 0.120
OPEN, OPEN_R, CORE_R = 0.22, 0.04, 0.05
FRONT = -0.150
CNT_C, CNT_W, CNT_H = Vector((0.020, -0.151, 0.105)), 0.080, 0.030
TGT_C, TGT_W, TGT_H = Vector((0.105, -0.151, 0.105)), 0.042, 0.016
PORT = (-0.095, FRONT, 0.100)
IRIS_Z = 0.125
G, PLASMA, AGRAPH, RUBBER, LED, SCREEN, GLASS, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_anod_graphite', 'kn_rubber', 'kn_led', 'kn_screen', 'kn_glass',
    'kn_steel_brushed')
MASTERS = [G, PLASMA, AGRAPH, RUBBER, LED, SCREEN, GLASS, STEEL, 'kn_decal']


def polar_rrect(w, r, n):
    """n points of a w x w rounded square sampled at equal angles (so it lofts onto an n-gon circle)."""
    dense = kit.outline_rrect(w, w, r, 24)
    pol = sorted(((math.atan2(y, x) % (2 * math.pi), math.hypot(x, y)) for x, y in dense))
    angs = [a for a, _ in pol]
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        j = bisect.bisect_left(angs, a) % len(pol)
        a0, r0 = pol[j - 1]
        a1, r1 = pol[j]
        span = (a1 - a0) % (2 * math.pi) or 1e-9
        t = ((a - a0) % (2 * math.pi)) / span
        rr = r0 + (r1 - r0) * t
        out.append((rr * math.cos(a), rr * math.sin(a)))
    return out


def loft(k, rings, mat, cap_top=True, cap_bot=True):
    """Closed loft through rings [(pts2d, z), ...] (same point count, bottom -> top)."""
    bm = k.bm
    mi = k.mi(mat)
    vr = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in rings]
    n = len(vr[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i])).material_index = mi
    if cap_bot:
        bm.faces.new(list(reversed(vr[0]))).material_index = mi
    if cap_top:
        bm.faces.new(vr[-1]).material_index = mi


def funnel_rings(n, steps, grow=0.0, top_extra=0.02):
    """Rounded square at the lip -> circle at the core, eased; `grow` offsets outward (for a wall shell)."""
    sq = polar_rrect(OPEN + 2 * grow, OPEN_R + grow, n)
    rings = [([((CORE_R + grow) * math.cos(2 * math.pi * i / n), (CORE_R + grow) * math.sin(2 * math.pi * i / n))
               for i in range(n)], CORE_Z - 0.012)]
    for s in range(steps + 1):
        t = s / steps
        e = t * t * (3 - 2 * t)
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            cx, cy = (CORE_R + grow) * math.cos(a), (CORE_R + grow) * math.sin(a)
            pts.append((cx + (sq[i][0] - cx) * e, cy + (sq[i][1] - cy) * e))
        rings.append((pts, CORE_Z + (TOP_Z - CORE_Z) * t))
    rings.append((sq, TOP_Z + top_extra))
    return rings


def blade_outline(n):
    """One iris blade: a curved crescent wedge spanning 70° of the ring r 0.034 ... 0.053."""
    pts = []
    for i in range(n + 1):
        a = math.radians(-35 + 70 * i / n)
        pts.append((0.053 * math.cos(a), 0.053 * math.sin(a)))
    for i in range(n, -1, -1):
        a = math.radians(-35 + 70 * i / n + 12 * (1 - i / n))
        pts.append((0.034 * math.cos(a), 0.034 * math.sin(a)))
    return pts


def build(lod, q, mats):
    cs = (max(2, int(round(3 * q))), max(1, int(round(2 * q))), 1, 1)[lod]
    nf = max(12, int(round((48, 32, 20, 16)[lod] * q / 4)) * 4)
    body = Kit()
    body.rbox((W, W, H - FEET), (0, 0, FEET + (H - FEET) / 2), 0.012, G, cseg=cs, rz=0.010 if lod < 3 else 0.006)
    cut = Kit()
    loft(cut, funnel_rings(nf, (10, 6, 3, 2)[lod]), PLASMA)
    import bmesh
    bmesh.ops.triangulate(body.bm, faces=[f for f in body.bm.faces if len(f.verts) > 4])
    body = kit.boolean_diff(body, [cut], mats)
    if lod < 3:  # lip rim light bar just inside the funnel opening
        rim_o = polar_rrect(OPEN - 0.002, OPEN_R - 0.001, nf)
        rim_i = polar_rrect(OPEN - 0.010, OPEN_R - 0.005, nf)
        loft_r = Kit()
        bm = loft_r.bm
        mi = loft_r.mi(LED)
        rings = [(rim_i, TOP_Z - 0.006), (rim_o, TOP_Z - 0.006), (rim_o, TOP_Z - 0.002), (rim_i, TOP_Z - 0.002)]
        vr = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in rings]
        for r0 in range(4):
            a, b = vr[r0], vr[(r0 + 1) % 4]
            for i in range(nf):
                j = (i + 1) % nf
                bm.faces.new((a[i], a[j], b[j], b[i])).material_index = mi
        body.merge(loft_r)
        loft_r.free()
    for x in (-0.12, 0.12):
        for y in (-0.12, 0.12):
            _m2.foot(body, 'M', x, y, min(1.0, q), lod if lod < 2 else 3)
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    depth = 0.0025
    if lod < 3:
        c1 = Vector(_m2.screen_bezel(body, mats, CNT_W, CNT_H, tuple(CNT_C - n * (depth - 0.0015)), tuple(n), tuple(up),
                                     lod, q, depth=depth))
        c2 = Vector(_m2.screen_bezel(body, mats, TGT_W, TGT_H, tuple(TGT_C - n * (depth - 0.0015)), tuple(n), tuple(up),
                                     lod, q, depth=depth))
    else:
        c1, c2 = CNT_C, TGT_C
    _m2.led_dome(body, 6, (TGT_C.x, FRONT, 0.132), (0, -1, 0), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: ((0, 0.25) if c.z > TOP_Z - 0.01 else (1, 0.0)))
    iris = Kit(pivot='PIVOT__iris')
    if lod < 3:
        for i in range(6):
            iris.prism(blade_outline((8, 5, 3)[lod]), IRIS_Z - 0.0015, IRIS_Z + 0.0012, AGRAPH,
                       m=kit.rot_z(60 * i))
    pieces = {'body': body, 'iris': iris,
              'screen_count': kit.screen_quad(tuple(c1), tuple(n), tuple(up), CNT_W, CNT_H, lift=0.0002),
              'screen_target': kit.screen_quad(tuple(c2), tuple(n), tuple(up), TGT_W, TGT_H, lift=0.0002),
              'screen_core': kit.screen_quad((0, 0, CORE_Z), (0, 0, 1), (0, 1, 0), 2 * CORE_R, 2 * CORE_R, lift=0.0)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('word.in.bone', (CNT_C.x, FRONT, 0.080), (0, -1, 0), (0, 0, 1), 0.034),
        kit.decal_plane('mark.goal.bone', (TGT_C.x, FRONT, 0.080), (0, -1, 0), (0, 0, 1), 0.026, 0.026),
        kit.decal_plane('name.recycler.bone', (-0.06, FRONT, 0.040), (0, -1, 0), (0, 0, 1), 0.06),
        kit.decal_plane('picto.recycle.mono', (0.105, FRONT, 0.045), (0, -1, 0), (0, 0, 1), 0.03, 0.03),
        kit.decal_plane('trim.grille', (0, -FRONT, 0.05), (0, 1, 0), (0, 0, 1), 0.12, 0.03, sub=(0.0, 0.0, 0.5, 1.0)),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '3,2,3', 6.0, 'bottom', 7500,
        'Despawning sink: pillowed graphite bin on FOOT_M with a kn_anod_plasma funnel lofted from the 0.22 x 0.22 '
        'opening (40 mm corners, z 0.200) to the Ø 0.10 core (z 0.120), kn_led rim bar (group 0); SCREEN__core (icon) '
        'under six kn_anod_graphite iris blades on PIVOT__iris (z, 0 ... 25°). Front: SCREEN__count (7seg x 3, plasma) '
        '+ SCREEN__target (7seg x 3, signal) with IN / GOAL captions, goal LED_D6 (group 1), PR-M signal count, name '
        'plate, recycle pictogram (mono); rear grille. Critters are refused by the engine, never despawned. UV1 '
        'authored for the 2048² set (bake pending). Brief: docs/art/briefs/future.md#recycler.',
        MASTERS, led_groups='0:rim,1:goal', skins='graphite,lab_white')
    part.pivot('iris', (0, 0, IRIS_Z), 'z', 0.0, 25.0, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.0)
    col = Kit()
    loft(col, funnel_rings(16, 3, grow=0.0, top_extra=0.0), 'x', cap_top=True, cap_bot=True)
    part._col('mesh', '0', col, None, 'steel', restitution=0.3, friction=0.4)
    part.col_box('1', (W, W, CORE_Z), (0, 0, CORE_Z / 2), phys='powder', restitution=0.2, friction=0.5)
    part.sensor('intake', 'mouth', [(x * 0.11, y * 0.11, z) for x in (-1, 1) for y in (-1, 1) for z in (0.13, 0.26)],
                refuse='critters')
    part.port('signal', 'count', PORT, (0, -1, 0), 'M', 'out', max_links=8)
    part.emit('dissolve', 'core', (0, 0, CORE_Z), (0, 0, 1))
    part.emit('refuse', 'core', (0, 0, CORE_Z), (0, 0, 1))
    part.emit('vent', 'rear', (0, 0.151, 0.050), (0, 1, 0))
    part.screen('count', CNT_W, CNT_H, tuple(CNT_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='7seg',
                digits=3, color='plasma')
    part.screen('target', TGT_W, TGT_H, tuple(TGT_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='7seg',
                digits=3, color='signal')
    part.screen('core', 2 * CORE_R, 2 * CORE_R, (0, 0, CORE_Z), (0, 0, 1), (0, 1, 0), kind='icon', color='plasma')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
