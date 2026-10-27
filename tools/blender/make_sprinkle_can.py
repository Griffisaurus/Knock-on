"""Procedurally build the SPRINKLE CAN source file (docs/art/briefs/matter.md, "SPRINKLE CAN: Tipping watering
can").

Usage: blender -b --factory-startup -P tools/blender/make_sprinkle_can.py -- [out.blend]
Default output: assets/src/matter/sprinkle_can.blend

A kn_poly_clear oval tub (0.16 x 0.14 superellipse in plan, centre x -0.06, z 0.025-0.145, 3 mm wall, closed top
with the fill opening at the top-rear) hinged on PIVOT__tilt (y at (-0.02, 0, 0.07), 0-45°, positive dips the
spout) between two kn_powder_bone yokes on a bone U-cradle (open under the can so the tilted tub clears it, FOOT_M).
A kn_powder_beam handle arch (top z 0.19), rim, fill collar, trunnion bosses and a Ø 0.02 gooseneck spout to the
kn_steel_brushed Ø 0.04 rose (7 holes) facing along the spout axis, 25° up; a kn_rubber push pad on the back is the
"knock me" target. CAVITY__water (matter water, 2 L) rides the pivot; its tilt LUTs cover 0-45°.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'sprinkle_can'
BONE, BEAM, CLEAR, STEEL, RUBBER = ('kn_powder_bone', 'kn_powder_beam', 'kn_poly_clear', 'kn_steel_brushed',
                                    'kn_rubber')
MASTERS = [BONE, BEAM, CLEAR, STEEL, RUBBER, 'kn_poly_beam']
PIV = Vector((-0.02, 0.0, 0.07))
CX, A, B, P = -0.06, 0.08, 0.07, 3.0          # tub centre x, half-axes, superellipse exponent
Z0, Z1, WALL, EDGE = 0.025, 0.145, 0.003, 0.012
FILL_C, FILL_A, FILL_B = Vector((-0.10, 0.0, Z1)), 0.030, 0.025
YOKE_Y = (0.085, 0.092)
EMIT_P = Vector((0.15, 0.0, 0.15))                       # brief emitter point
ROSE_D = Vector((0.906, 0.0, 0.423)).normalized()          # spout axis, 25° up (A4 SPRINKLE.roseDir)
ROSE = EMIT_P - ROSE_D * 0.011                             # rose face centre just behind the emitter
SPOUT = [(0.000, 0, 0.048), (0.035, 0, 0.072), (0.070, 0, 0.095), (0.100, 0, 0.118),
         tuple(ROSE - ROSE_D * 0.024), tuple(ROSE - ROSE_D * 0.010)]
STOP = 45.0                                                # pour stop (A4: at 60° the rose digs into the floor)


def tub_rings(n, inset, z0, z1, edge, rows):
    """Superellipse rings bottom -> top with rounded bottom / top edges of radius `edge` (inset shrinks plan and
    height by `inset`)."""
    a, b = A - inset, B - inset
    out = []
    for k in range(rows + 1):  # bottom round
        t = math.pi / 2 * k / rows
        s = (edge * (1 - math.sin(t))) if edge > 0 else 0.0
        z = z0 + edge * (1 - math.cos(t))
        out.append(_m4.ring(_m4.superellipse(a - s, b - s, P, n), z, cx=CX))
    for k in range(rows + 1):  # top round
        t = math.pi / 2 * k / rows
        s = edge * (1 - math.cos(t))
        z = z1 - edge + edge * math.sin(t)
        out.append(_m4.ring(_m4.superellipse(a - s, b - s, P, n), z, cx=CX))
    if edge <= 0:
        out = [out[0], out[-1]]
    return out


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(48, q, 8, 4)
    rows = (3, 2, 1, 1)[lod]
    tub = Kit(pivot='PIVOT__tilt')
    outer = tub_rings(n, 0.0, Z0, Z1, EDGE if lod < 3 else 0.0, rows)
    _m4.loft(tub, outer, CLEAR)
    if lod < 3:
        inner = Kit()
        _m4.loft(inner, tub_rings(n, WALL, Z0 + WALL, Z1 - WALL, EDGE - WALL, rows), CLEAR)
        hole = Kit()
        hole.prism([(FILL_C.x + x * FILL_A / 0.03, y * FILL_B / 0.03) for x, y in kit.outline_circle(0.03, n // 2)],
                   Z1 - 0.02, Z1 + 0.01, CLEAR)
        import bmesh
        bmesh.ops.triangulate(tub.bm, faces=[f for f in tub.bm.faces if len(f.verts) > 4])
        tub = kit.boolean_diff(tub, [inner, hole], mats)
        tub.pivot = 'PIVOT__tilt'
    trim = Kit(pivot='PIVOT__tilt')
    # rim band round the top edge, fill collar, trunnion bosses
    if lod < 3:
        r_o = _m4.superellipse(A + 0.0015, B + 0.0015, P, n)
        r_i = _m4.superellipse(A - 0.004, B - 0.004, P, n)
        _m4.loft(trim, [_m4.ring(r_o, Z1 - EDGE - 0.004, cx=CX), _m4.ring(r_o, Z1 - EDGE + 0.004, cx=CX),
                        _m4.ring(r_i, Z1 - EDGE + 0.004, cx=CX), _m4.ring(r_i, Z1 - EDGE - 0.004, cx=CX)], BEAM,
                 closed=True)
        co = [(FILL_C.x + x * (FILL_A + 0.005) / 0.03, y * (FILL_B + 0.005) / 0.03) for x, y in
              kit.outline_circle(0.03, n // 2)]
        ci = [(FILL_C.x + x * (FILL_A - 0.001) / 0.03, y * (FILL_B - 0.001) / 0.03) for x, y in
              kit.outline_circle(0.03, n // 2)]
        _m4.loft(trim, [_m4.ring(co, Z1 - 0.004), _m4.ring(co, Z1 + 0.004), _m4.ring(ci, Z1 + 0.004),
                        _m4.ring(ci, Z1 - 0.004)], BEAM, closed=True)
    for s in (-1, 1):
        trim.cyl(0.011, 0.0, 0.016, BEAM, seg(20, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame((PIV.x, s * (B - 0.004), PIV.z), (0, s, 0)))
    # handle arch, push pad, gooseneck spout and rose
    arch = [(-0.136, 0, 0.11), (-0.146, 0, 0.145), (-0.13, 0, 0.178), (-0.10, 0, 0.190), (-0.07, 0, 0.186),
            (-0.045, 0, 0.168), (-0.035, 0, 0.146)]
    if lod < 3:
        trim.sweep(_m4.smooth_path(arch, (4, 2, 1)[lod]), 0.0062, seg(10, q, 6), BEAM)
    else:
        trim.sweep([arch[0], arch[3], arch[-1]], 0.0062, 4, BEAM)
    trim.rbox((0.008, 0.05, 0.04), (-0.1435, 0, 0.082), 0.004 if lod < 3 else 0.0, RUBBER, cseg=max(1, cs - 1),
              rz=0.002 if lod < 3 else 0.0)
    trim.sweep(_m4.smooth_path(SPOUT, 3) if lod < 2 else [SPOUT[0], SPOUT[2], SPOUT[4], SPOUT[5]], 0.010,
               seg(14, q, 5), BEAM)
    rp = [(0.010, -0.002, STEEL), (0.0115, 0.004, STEEL), (0.0195, 0.012, STEEL), (0.020, 0.015, STEEL),
          (0.0, 0.016, STEEL)]
    base = ROSE - ROSE_D * 0.016
    trim.lathe([(0.0, -0.002, STEEL)] + rp, seg(24, q, 8), m=kit.frame(tuple(base), tuple(ROSE_D)))
    # rose holes: the shared grille dots as a decal on the face (tiny modelled holes starve check 13's slot mean)
    up = Vector((0, 0, 1)) - ROSE_D * ROSE_D.z
    rose_decal = kit.decal_plane('trim.grille', tuple(ROSE), tuple(ROSE_D), tuple(up), 0.024, 0.024,
                                 sub=(0.0, 0.0, 0.118, 1.0), pivot='PIVOT__tilt', lift=0.0004)
    # cradle: rear bar + side rails (open under the tub so it clears at 60°), yokes, trunnion pins, feet
    body = Kit()
    body.rbox((0.03, 0.184, 0.02), (-0.105, 0, 0.014), 0.006 if lod < 3 else 0.0, BONE, cseg=max(1, cs - 1),
              rz=0.003 if lod < 3 else 0.0)
    for s in (-1, 1):
        body.rbox((0.16, 0.024, 0.02), (-0.04, s * 0.080, 0.014), 0.006 if lod < 3 else 0.0, BONE,
                  cseg=max(1, cs - 1), rz=0.003 if lod < 3 else 0.0)
        yc = s * sum(YOKE_Y) / 2
        body.rbox((0.05, YOKE_Y[1] - YOKE_Y[0], 0.05), (PIV.x, yc, 0.047), 0.004 if lod < 3 else 0.0, BONE, cseg=1,
                  rz=0.0)
        body.cyl(0.025, -(YOKE_Y[1] - YOKE_Y[0]) / 2, (YOKE_Y[1] - YOKE_Y[0]) / 2, BONE, seg(28, q, 8),
                 bev=0.0015 if lod < 2 else 0.0, bseg=1, m=kit.frame((PIV.x, yc, PIV.z), 'y'))
        body.cyl(0.005, 0.0, 0.03, STEEL, seg(12, q, 6), bev=0.001 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame((PIV.x, s * 0.066, PIV.z), (0, s, 0)))
        for x in (-0.105, 0.025):
            _m2.foot(body, 'M', x, s * 0.080, min(1.0, q), lod)
    pieces = {'body': body, 'can': tub, 'trim': trim}
    return kit.add_decals(pieces, lod, [
        rose_decal,
        kit.decal_plane('name.sprinkle_can.graphite', (0.0, -0.092 - 0.0001, 0.014), (0, -1, 0), (0, 0, 1), 0.09,
                        lift=0.0004),
    ])


def cavity(part):
    k = Kit()
    ins = WALL + 0.0035
    _m4.loft(k, tub_rings(48, ins, Z0 + ins, Z1 - ins, EDGE - ins, 3), 'x')
    return _m4.cavity(part, 'water', k, 'water', capacity=2.0, pivot='tilt')


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'M', '3,2,2', 0.8, 'bottom', 6000,
        'Tipping watering can: kn_poly_clear oval tub (0.16 x 0.14 superellipse, centre x -0.06, z 0.025-0.145, 3 mm '
        'wall, closed top with the 0.06 x 0.05 fill opening top-rear) on PIVOT__tilt (y at (-0.02, 0, 0.07), 0-45°, '
        'positive dips the spout; detent past 20°, latched at the 45° stop: A4 found 60° digs the rose into the '
        'floor) between kn_powder_bone yokes (y ±0.085...0.092) on '
        'a bone U-cradle (rear bar + side rails, open under the tub so it clears at full tilt; COL__box__cradle is the '
        'briefed 0.16 x 0.18 x 0.02 slab), FOOT_M. kn_powder_beam handle arch (top z 0.19), rim band, fill collar, '
        'trunnion bosses and a Ø 0.02 gooseneck spout ending 25° up, so the kn_steel_brushed Ø 0.04 rose '
        '(7 holes) faces along the spout axis; kn_rubber push pad on the back. CAVITY__water (2 L) rides the '
        'pivot (tilt LUTs 0-45°). Brief: docs/art/briefs/matter.md#sprinkle-can.',
        MASTERS, skins='classic,garden', hints={'kn_detent_deg': 20.0, 'kn_pour_stop_deg': STOP})
    part.pivot('tilt', tuple(PIV), 'y', 0.0, STOP, motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_box('cradle', (0.16, 0.18, 0.02), (-0.04, 0, 0.014), phys='powder', restitution=0.2, friction=0.6)
    for s, nm in ((-1, 'yoke_l'), (1, 'yoke_r')):
        part.col_box(nm, (0.05, 0.007, 0.06), (PIV.x, s * sum(YOKE_Y) / 2, 0.052), phys='powder')
    pts = [(x, y, z) for x, y, _ in _m4.ring(_m4.superellipse(A, B, P, 16), 0.0, cx=CX) for z in (Z0, Z1)]
    _m2.under(part, part.col_hull('body', pts, phys='glass', restitution=0.2, friction=0.4), 'tilt')
    a, b = Vector(SPOUT[0]), Vector(ROSE)
    _m2.under(part, part.col_capsule('spout', 0.012, (b - a).length + 0.024, tuple((a + b) / 2), tuple(b - a),
                                     phys='powder'), 'tilt')
    push = [(x, y, z) for x in (-0.152, -0.10) for y in (-0.06, 0.06) for z in (0.03, 0.196)]
    _m2.under(part, part.sensor('impact', 'push', push, threshold=0.3), 'tilt')
    fill = [(FILL_C.x + FILL_A * math.cos(2 * math.pi * i / 12), FILL_B * math.sin(2 * math.pi * i / 12), z)
            for i in range(12) for z in (Z1 - 0.005, Z1 + 0.015)]
    _m2.under(part, part.sensor('intake', 'fill', fill, capacity=2.0), 'tilt')
    _m2.under(part, part.emit('spout', 'rose', tuple(EMIT_P), tuple(ROSE_D)), 'tilt')
    _m2.under(part, part.emit('drip', 'rose', tuple(EMIT_P), tuple(ROSE_D)), 'tilt')
    cavity(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
