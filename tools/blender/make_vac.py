"""Procedurally build the VAC source file (docs/art/briefs/air.md, "VAC: Suction nozzle").

Usage: blender -b --factory-startup -P tools/blender/make_vac.py -- [out.blend]
Default output: assets/src/air/vac.blend

A long kn_powder_bone suction tube (Ø 0.08 along Y, centre z 0.052) on a bone cradle (FOOT_S): a kn_powder_beam
trumpet mouth (Ø 0.094 at y -0.15 ... -0.115, hollow, kn_rubber lip) with a kn_led ring inside (group 1) and a
kn_steel_brushed grille recessed 15 mm behind the lip; a kn_poly_clear window band (y -0.11 ... -0.05) over seven
kn_poly_amber impeller blades on PIVOT__impeller (y); the motor section (y -0.03 ... 0.15) with a flat top boss
(z 0.095) for the PR-M power `in` ring facing +Z, a status LED (group 0) beside it, a beam rear cap ring and a steel
rear grille. Self-contained nozzle, no hose.
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

TYPE = 'vac'
BONE, BEAM, CLEAR, AMBER, STEEL, RUBBER, LED, G = (
    'kn_powder_bone', 'kn_powder_beam', 'kn_poly_clear', 'kn_poly_amber', 'kn_steel_brushed', 'kn_rubber', 'kn_led',
    'kn_powder_graphite')
MASTERS = [BONE, BEAM, CLEAR, AMBER, STEEL, RUBBER, LED, G]
TZ, TR = 0.052, 0.040
Y_LIP, Y_FLARE1, Y_WIN0, Y_WIN1, Y_MOT0, Y_REAR = -0.15, -0.115, -0.11, -0.05, -0.03, 0.15
GRILLE_Y = Y_LIP + 0.015
IMP_Y = -0.08
PORT = (0.0, 0.080, 0.095)


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    n = seg(48, q, 8, 4)
    ax = kit.frame((0, 0, TZ), 'y')     # local z -> +Y
    body = Kit()
    # bone tube sections: mouth neck (y -0.115 ... -0.11), window gap, front collar + motor section
    body.lathe([(0.0, Y_FLARE1, BONE), (TR, Y_FLARE1, BONE), (TR, Y_WIN0 + 0.001, BONE), (0.0, Y_WIN0 + 0.001, BONE)],
               n, m=ax)
    body.lathe([(0.0, Y_WIN1 - 0.001, BONE), (TR, Y_WIN1 - 0.001, BONE), (TR, Y_REAR - 0.008, BONE),
                (0.0, Y_REAR - 0.008, BONE)], n, m=ax)
    # rear cap ring (beam) + rear grille (steel)
    body.lathe([(TR - 0.006, Y_REAR - 0.009, BEAM), (TR + 0.0015, Y_REAR - 0.009, BEAM),
                (TR + 0.0015, Y_REAR - 0.001, BEAM), (TR - 0.006, Y_REAR - 0.001, BEAM)], n, m=ax, closed=True)
    if lod < 2:
        for rr in (0.012, 0.024):
            body.torus(rr, 0.0011, STEEL, seg(int(rr * 1100), q, 8), (6, 4)[lod],
                       m=kit.frame((0, Y_REAR - 0.004, TZ), 'y'))
        for k in range(6):
            a = 2 * math.pi * k / 6
            d = Vector((math.cos(a), 0.0, math.sin(a)))
            p0 = Vector((0, Y_REAR - 0.004, TZ)) + d * 0.005
            body.sweep([p0, p0 + d * 0.029], 0.001, (6, 4)[lod], STEEL)
    body.cyl(TR - 0.0055, Y_REAR - 0.0075, Y_REAR - 0.0065, G, n, m=ax)  # dark backing behind the grille
    # flat top boss for the PR-M ring, status LED
    body.rbox((0.05, 0.05, 0.02), (0.0, PORT[1], PORT[2] - 0.010), 0.008 if lod < 3 else 0.0, BONE, cseg=cs,
              rz=0.0)
    _m2.land(body, 'M', PORT, (0, 0, 1), 0.001, lod, mat=BONE)
    _m2.led_dome(body, 6, (0.0, 0.035, TZ + TR - 0.0006), (0, 0, 1), q, lod)
    # cradle + feet
    body.rbox((0.07, 0.22, 0.028), (0.0, 0.03, 0.018), 0.008 if lod < 3 else 0.0, BONE, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for y in (-0.06, 0.12):
            _m2.foot(body, 'S', sx * 0.026, y, min(1.0, q), lod)
    for sx in (-1, 1):
        _m2.screw(body, 'M3', (sx * 0.036, 0.03, 0.018), (sx, 0, 0), q, lod)
    # mouth: hollow trumpet (beam), rubber lip, led ring inside, recessed grille
    mouth = Kit()
    rows = (6, 4, 2, 1)[lod]
    outer, inner = [], []
    for k in range(rows + 1):
        t = k / rows
        y = Y_FLARE1 + (Y_LIP + 0.003 - Y_FLARE1) * t
        r = TR + (0.047 - TR) * (t ** 1.6)
        outer.append((r, y))
        inner.append((r - 0.004, y))
    prof = [(r, y, BEAM) for r, y in outer] + [(r, y, BEAM) for r, y in reversed(inner)]
    mouth.lathe(prof, n, m=kit.frame((0, 0, TZ), 'y'), closed=True)
    if lod < 3:
        mouth.torus(0.0435, 0.0035, RUBBER, n, (8, 6, 4)[lod], m=kit.frame((0, Y_LIP + 0.0035, TZ), 'y'))
        mouth.torus(0.036, 0.0018, LED, n, (6, 4, 4)[lod], m=kit.frame((0, Y_FLARE1 - 0.008, TZ), 'y'))
        if lod < 2:
            for rr in (0.010, 0.021, 0.032):
                mouth.torus(rr, 0.0012, STEEL, seg(int(rr * 1100), q, 8), (6, 4)[lod],
                            m=kit.frame((0, GRILLE_Y, TZ), 'y'))
            for k in range(8):
                a = 2 * math.pi * k / 8
                d = Vector((math.cos(a), 0.0, math.sin(a)))
                p0 = Vector((0, GRILLE_Y, TZ)) + d * 0.004
                mouth.sweep([p0, p0 + d * 0.033], 0.0011, (6, 4)[lod], STEEL)
        else:
            mouth.cyl(0.034, GRILLE_Y - 0.0008, GRILLE_Y + 0.0008, STEEL, n, m=kit.frame((0, 0, TZ), 'y'))
        mouth.cyl(TR - 0.002, Y_FLARE1 - 0.002, Y_FLARE1 + 0.0005, G, n, m=kit.frame((0, 0, TZ), 'y'))
    mouth.colors['led'] = _m2.led_attr(lambda c, nn: (1, 0.0))
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    window = Kit()
    if lod < 3:
        window.lathe([(TR - 0.003, Y_WIN0, CLEAR), (TR + 0.0003, Y_WIN0, CLEAR), (TR + 0.0003, Y_WIN1, CLEAR),
                      (TR - 0.003, Y_WIN1, CLEAR)], n, m=ax, closed=True)
    else:
        window.cyl(TR, Y_WIN0, Y_WIN1, CLEAR, n, m=ax)
    imp = Kit(pivot='PIVOT__impeller')
    if lod < 2:
        for k in range(7):
            a = 2 * math.pi * k / 7
            u = Vector((math.cos(a), 0.0, math.sin(a)))
            t = Vector((-math.sin(a), 0.0, math.cos(a)))
            basis = Matrix((u, t, u.cross(t))).transposed().to_4x4()
            imp.rbox((0.024, 0.016, 0.002), (0, 0, 0), 0.004, AMBER, cseg=1,
                     m=Matrix.Translation(Vector((0, IMP_Y, TZ)) + u * 0.020) @ basis @ kit.rot_x(30))
        imp.cyl(0.008, -0.009, 0.009, BONE, seg(16, q, 6), bev=0.002, bseg=1, m=kit.frame((0, IMP_Y, TZ), 'y'))
    else:
        imp.cyl(0.033, -0.0012, 0.0012, AMBER, seg(16, q, 6), m=kit.frame((0, IMP_Y, TZ), 'y'))
    pieces = {'body': body, 'mouth': mouth, 'window': window, 'impeller': imp}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.vac.graphite', (TR + 0.0002, 0.04, TZ), (1, 0, 0), (0, 0, 1), 0.05, lift=0.0004),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'air', 'M', '1,1,3', 1.1, 'bottom', 6000,
        'Suction nozzle: kn_powder_bone tube Ø 0.08 along Y (centre z 0.052) on a bone cradle (FOOT_S, M3 screws); '
        'kn_powder_beam trumpet mouth (Ø 0.094 at y -0.15 ... -0.115, hollow) with a kn_rubber lip, kn_led mouth ring '
        '(group 1) and a steel grille recessed 15 mm; kn_poly_clear window band (y -0.11 ... -0.05) over seven '
        'kn_poly_amber impeller blades on PIVOT__impeller (y); motor section with a flat top boss (z 0.095) for the '
        'PR-M power `in` ring (+Z), status LED_D6 (group 0), beam rear cap ring, steel rear grille. Name plate on the '
        'motor flank. Brief: docs/art/briefs/air.md#vac.',
        MASTERS, led_groups='0:status,1:mouth_ring', skins='air,graphite')
    part.pivot('impeller', (0, IMP_Y, TZ), 'y')
    part.build_lods(build, lod0_q=1.2)
    part.col_cyl('tube', TR, Y_REAR - Y_FLARE1, (0, (Y_REAR + Y_FLARE1) / 2, TZ), 'y', phys='powder')
    part.col_cyl('mouth', 0.047, Y_FLARE1 - Y_LIP, (0, (Y_FLARE1 + Y_LIP) / 2, TZ), 'y', phys='rubber')
    part.col_box('cradle', (0.07, 0.22, 0.032), (0.0, 0.03, 0.016), phys='powder')
    part.sensor('intake', 'mouth', [(x, y, z + TZ) for x, z, y in
                                    [(p[0], p[1], yy) for p in kit.outline_circle(0.035, 12)
                                     for yy in (-0.15, -0.12)]])
    part.port('power', 'in', PORT, (0, 0, 1), 'M', 'in')
    part.emit('wind', 'mouth', (0, Y_LIP, TZ), (0, -1, 0))
    part.emit('exhaust', 'rear', (0, Y_REAR, TZ), (0, 1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
