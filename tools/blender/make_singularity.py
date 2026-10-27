"""Procedurally build the SINGULARITY source file (docs/art/briefs/boom.md, "SINGULARITY: Micro black-hole
containment unit").

Usage: blender -b --factory-startup -P tools/blender/make_singularity.py -- [out.blend]
Default output: assets/src/boom/singularity.blend

A graphite containment cage: a 0.20 x 0.20 plinth (z 0.004-0.050, FOOT_M), four Ø 0.020 posts at (±0.085, ±0.085)
and a 0.20 x 0.20 x 0.02 top cap ring (z 0.18-0.20) with a Ø 0.13 open aperture. Inside, a plasma gimbal round the
core (0, 0, 0.115): the horizontal kn_anod_plasma outer ring (Ø 0.15) on PIVOT__ring_outer (z, continuous) carries the
upright inner ring (Ø 0.12) on PIVOT__ring_inner (x, counter-spin, nested) through two steel pins. A kn_poly_plasma
containment shell (Ø 0.08) holds the black bead (Ø 0.03 kn_led driven to emission 0, group 3 core). Four kn_copper
coil pods on the posts aim at the core with LED tips (group 0 containment); four vertical kn_led charge bars on the
posts' inner faces (group 1). Plinth front: the PR-M signal `arm` port, SCREEN__countdown (SCR_7SEG_2, field colour,
graphite bezel + glass), status LED_D6 (group 2), the name plate, the explosive pictogram, 4 M3 screws; an amber /
graphite stripe band on the plinth top front. Clip singularity__collapse (0.6 s): the rings snap-align and brake.
No glowing eyes, skulls or space-horror cues.
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

TYPE = 'singularity'
G, PLASMA, PPOLY, COPPER, STEEL, RUBBER, LED, SCREEN, GLASS = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_copper', 'kn_steel_brushed', 'kn_rubber', 'kn_led',
    'kn_screen', 'kn_glass')
MASTERS = [G, PLASMA, PPOLY, COPPER, STEEL, RUBBER, LED, SCREEN, GLASS, 'kn_decal']
W, PL_Z0, PL_Z1, CAP_Z0, CAP_Z1 = 0.20, 0.004, 0.050, 0.180, 0.200
POST, POST_R = 0.085, 0.010
CORE = Vector((0.0, 0.0, 0.115))
R_OUTER, R_INNER, TUBE = 0.071, 0.056, 0.0038
APERTURE = 0.065
PORT = (0.06, -0.101, 0.027)
SCR_C, SCR_W, SCR_H = Vector((-0.045, -0.101, 0.027)), 0.024, 0.020


def post_dir(sx, sy):
    return Vector((-sx, -sy, 0.0)).normalized()  # from a post toward the core axis


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    n = seg(64, q, 12, 4)
    body = Kit()
    body.rbox((W, W, PL_Z1 - PL_Z0), (0, 0, (PL_Z0 + PL_Z1) / 2), 0.010 if lod < 3 else 0.004, G, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.080, sy * 0.080, min(1.0, q), lod)
    # cap ring with the open aperture
    cap = Kit()
    cap.rbox((W, W, CAP_Z1 - CAP_Z0), (0, 0, (CAP_Z0 + CAP_Z1) / 2), 0.010 if lod < 3 else 0.004, G, cseg=cs,
             rz=0.004 if lod < 3 else 0.0)
    hole = Kit()
    ch = 0.003 if lod < 3 else 0.0
    hole.lathe(kit.dedupe([(0.0, CAP_Z0 - 0.01, G), (APERTURE, CAP_Z0 - 0.01, G), (APERTURE, CAP_Z1 - ch, G),
                           (APERTURE + ch + 0.001, CAP_Z1 + 0.001, G), (APERTURE + ch + 0.001, CAP_Z1 + 0.01, G),
                           (0.0, CAP_Z1 + 0.01, G)]), n)
    cap = kit.boolean_diff(cap, [hole], mats)
    body.merge(cap)
    cap.free()
    # posts, coil pods with LED tips, charge bars
    for sx in (-1, 1):
        for sy in (-1, 1):
            body.cyl(POST_R, PL_Z1 - 0.002, CAP_Z0 + 0.002, G, seg(20, q, 6), m=kit.at(sx * POST, sy * POST, 0))
            d = post_dir(sx, sy)
            base = Vector((sx * POST, sy * POST, CORE.z)) + d * (POST_R - 0.002)
            if lod < 3:
                body.cyl(0.0095, 0.0, 0.016, COPPER, seg(18, q, 6), bev=0.002 if lod < 2 else 0.0, bseg=1,
                         m=kit.frame(tuple(base), tuple(d)))
                if lod < 2:  # winding grooves on the pod
                    for t in (0.005, 0.009, 0.013):
                        body.torus(0.0098, 0.0011, COPPER, seg(18, q, 6), 4, m=kit.frame(tuple(base + d * t), tuple(d)))
                _m2.led_dome(body, 8, tuple(base + d * 0.016), tuple(d), q, lod, bezel=STEEL)
            else:
                body.cyl(0.009, 0.0, 0.018, COPPER, 6, m=kit.frame(tuple(base), tuple(d)))
            # charge bar on the inner face, above and below the pod
            for z0, z1 in ((0.060, 0.098), (0.132, 0.172)):
                p = Vector((sx * POST, sy * POST, (z0 + z1) / 2)) + d * (POST_R - 0.0012)
                body.rbox((0.0035, 0.0035, z1 - z0), tuple(p), 0.0012 if lod < 2 else 0.0, LED, cseg=1,
                          rz=0.0012 if lod < 2 else 0.0)
    # front: countdown screen bezel, status LED, M3 screws
    n_out, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    if lod < 3:
        sc = Vector(_m2.screen_bezel(body, mats, SCR_W, SCR_H, tuple(SCR_C - n_out * (0.004 - 0.0015)),
                                     tuple(n_out), tuple(up), lod, q, depth=0.004))
    else:
        sc = SCR_C
    _m2.led_dome(body, 6, (0.0, -0.078, PL_Z1), (0, 0, 1), q, lod)
    for sx in (-1, 1):
        for z in (0.013, 0.041):
            _m2.screw(body, 'M3', (sx * 0.090, -W / 2, z), (0, -1, 0), q, lod)

    def led_of(c, nn):
        if c.z < PL_Z1 + 0.006:
            return (2, 0.08)      # status
        if math.hypot(c.x, c.y) > POST - POST_R - 0.004 and abs(c.z - CORE.z) > 0.012:
            return (1, 0.0)       # charge bars
        return (0, 0.08)          # pod tips
    body.colors['led'] = _m2.led_attr(led_of)
    # gimbal: horizontal outer ring (spins about z) carrying the upright inner ring (tumbles about x)
    outer = Kit(pivot='PIVOT__ring_outer')
    outer.torus(R_OUTER, TUBE, PLASMA, n, (10, 8, 6, 4)[lod], m=kit.at(*CORE))
    if lod < 3:
        for k in range(4):  # lugs so the spin reads
            a = math.radians(45 + 90 * k)
            outer.rbox((0.010, 0.006, 0.010), (R_OUTER, 0, 0), 0.002 if lod < 2 else 0.0, PLASMA, cseg=1,
                       m=kit.at(*CORE) @ kit.rot_z(math.degrees(a)))
        for sx in (-1, 1):  # bearing pins to the inner ring
            outer.cyl(0.0022, R_INNER - 0.001, R_OUTER, STEEL, seg(10, q, 6),
                      m=kit.frame(tuple(CORE), (sx, 0, 0)))
    inner = Kit(pivot='PIVOT__ring_inner')
    inner.torus(R_INNER, TUBE * 0.9, PLASMA, n, (10, 8, 6, 4)[lod], m=kit.at(*CORE) @ kit.rot_x(90))
    # containment shell and the black bead
    shell = Kit()
    shell.sphere(0.040, PPOLY, n, (20, 14, 10, 6)[lod], m=kit.at(*CORE))
    core = Kit()
    core.sphere(0.015, LED, seg(24, q, 8), (12, 8, 6, 4)[lod], m=kit.at(*CORE))
    core.colors['led'] = _m2.led_attr(lambda c, nn: (3, 0.0))
    pieces = {'body': body, 'ring_outer': outer, 'ring_inner': inner, 'shell': shell, 'core': core,
              'screen_countdown': kit.screen_quad(tuple(sc), tuple(n_out), tuple(up), SCR_W, SCR_H, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.singularity.bone', (0.003, -W / 2, 0.034), (0, -1, 0), (0, 0, 1), 0.050),
        kit.decal_plane('picto.explosive.warn', (0.003, -W / 2, 0.016), (0, -1, 0), (0, 0, 1), 0.016, 0.016),
        kit.decal_plane('trim.hazard_r', (-0.034, -0.092, PL_Z1), (0, 0, 1), (0, 1, 0), 0.068, 0.0085),
        kit.decal_plane('trim.hazard_r', (0.034, -0.092, PL_Z1), (0, 0, 1), (0, 1, 0), 0.068, 0.0085),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'L', '2,2,2', 7.0, 'bottom', 16000,
        'Micro black-hole containment unit: kn_powder_graphite plinth 0.20 x 0.20 (z 0.004-0.050, FOOT_M), four '
        'Ø 0.020 posts at (±0.085, ±0.085), cap ring z 0.18-0.20 with a Ø 0.13 aperture. Gimbal at the core (0, 0, '
        '0.115): kn_anod_plasma outer ring Ø 0.15 (horizontal) on PIVOT__ring_outer (z) > inner ring Ø 0.12 (upright) '
        'on PIVOT__ring_inner (x), steel pins. kn_poly_plasma shell Ø 0.08; bead Ø 0.03 kn_led (group 3 core, driven '
        'black). kn_copper coil pods with LED tips (group 0), kn_led charge bars on the posts (group 1), status LED_D6 '
        '(group 2). Front: PR-M signal arm, SCREEN__countdown (SCR_7SEG_2, field), name plate, explosive pictogram, '
        '4 M3; hazard band on the plinth top. Clip singularity__collapse (0.6 s). Immune to its own field and blasts. '
        'Brief: docs/art/briefs/boom.md#singularity.',
        MASTERS, led_groups='0:containment,1:charge,2:status,3:core', skins='classic',
        hints={'kn_pull_radius': 20.0, 'kn_pull_seconds': 6.0, 'kn_recycle_radius': 0.30})
    part.pivot('ring_outer', tuple(CORE), 'z', motion='turn')
    part.pivot('ring_inner', tuple(CORE), 'x', motion='turn')
    _m2.nest(part, 'ring_inner', 'ring_outer')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.0)
    part.col_box('plinth', (W, W, PL_Z1), (0, 0, PL_Z1 / 2), phys='powder')
    part.col_box('cap', (W, W, CAP_Z1 - CAP_Z0), (0, 0, (CAP_Z0 + CAP_Z1) / 2), phys='powder')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1)), 1):
        part.col_cyl('post_%d' % i, POST_R, CAP_Z0 - PL_Z1, (sx * POST, sy * POST, (PL_Z1 + CAP_Z0) / 2), 'z',
                     phys='powder')
    k = Kit()
    k.sphere(0.30, 'x', 16, 8, m=kit.at(*CORE))
    part.sensor('field', 'core', [tuple(v.co) for v in k.bm.verts])
    k.free()
    part.port('signal', 'arm', PORT, (0, -1, 0), 'M', 'in')
    part.emit('field', 'core', tuple(CORE), (0, 0, 1))
    part.emit('lens', 'core', tuple(CORE), (0, 0, 1))
    part.emit('disk', 'core', tuple(CORE), (0, 0, 1))
    part.emit('vent', 'cap', (0, 0, CAP_Z1), (0, 0, 1))
    part.screen('countdown', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.0002, 0))), (0, -1, 0), (0, 0, 1), kind='7seg',
                digits=2, color='field')
    _m2.clip(part, 'collapse', {'ring_outer': [(0.0, 0.0), (0.25, 160.0), (0.45, 178.0), (0.6, 180.0)],
                                'ring_inner': [(0.0, 0.0), (0.2, -120.0), (0.45, -178.0), (0.6, -180.0)]})
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
