"""Procedurally build the GLIDEPATH BOOSTER source file (docs/art/briefs/frame.md, "GLIDEPATH: Rail track", the
`glidepath__booster` piece; parts-data `glidepath_booster`, added by stream A3 because a link can't carry ports).

Usage: blender -b --factory-startup -P tools/blender/make_glidepath_booster.py -- [out.blend]
Default output: assets/src/frame/glidepath_booster.blend

A fixed 0.30 m powered straight of GLIDEPATH track (kn_origin = 'path': origin at its centre on the rail-top
centreline, like the GLIDEPATH kit): a 0.30 m stub of the seamless kn_chrome rails on the kn_anod_cobalt T-spine,
inside a pillowed kn_powder_bone housing 0.30 x 0.095 x 0.048 that leaves the rider channel open between its side
blocks. A kn_poly_clear window over each friction tyre shows the two Ø 0.03 kn_rubber tyres (steel hubs) on
PIVOT__tyre_l / _r (axis z, counter-rotating) either side of the rider at bearing-centre height. The PR-M spin drive
ring sits on a 1 mm land on the housing front over the internal drive axle: PIVOT__drive (axis y at z -0.055, the
def's ghost-arm hinge) carries the Cobalt drive dog seen in the ring and the steel axle. Name plate and the
rotating-parts pictogram on the front. Geometry from make_glidepath.booster() / tyre() at x = 0.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
import make_glidepath as gp  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'glidepath_booster'
L = gp.BOOST_X1 - gp.BOOST_X0            # 0.30
AXLE_Z = -0.055
PORT = (0.0, -0.025, AXLE_Z)
MASTERS = gp.MASTERS


TYRE_R, TYRE_Y = 0.013, 0.021      # Ø 0.026 tyres touching a Ø 0.016 rider (the brief's Ø 0.03 can't fit 0.05)
POD_R = 0.0155                     # tyre pods on the housing flanks (max |y| 0.0365, def bounds ±0.025 + 0.012)
POD_Z0 = -0.014


def housing(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    k = Kit()
    # every shell is cut on its own (the EXACT solver misreads overlapping shells inside one boolean target)
    for s in (-1, 1):
        for shell in ('block', 'pod'):
            sh = Kit()
            if shell == 'block':
                sh.rbox((L, gp.HOUSE_Y - 0.0115, gp.HOUSE_Z1 - gp.HOUSE_Z0), (0, s * (gp.HOUSE_Y + 0.0115) / 2,
                        (gp.HOUSE_Z0 + gp.HOUSE_Z1) / 2), 0.004 if lod < 3 else 0.0, gp.BONE, cseg=cs,
                        rz=0.003 if lod < 3 else 0.0)
            else:
                sh.cyl(POD_R, POD_Z0, gp.HOUSE_Z1, gp.BONE, seg(28, q, 8), bev=0.002 if lod < 3 else 0.0, bseg=1,
                       bev_bot=0.002 if lod < 3 else 0.0, m=kit.at(0, s * TYRE_Y, 0))
            if lod < 3:  # the tyre well
                well = Kit()
                well.cyl(TYRE_R + 0.0012, gp.TYRE_Z0 - 0.002, gp.HOUSE_Z1 + 0.01, gp.BONE, seg(24, q, 8),
                         m=kit.at(0, s * TYRE_Y, 0))
                sh = kit.boolean_diff(sh, [well], mats)
            k.merge(sh)
            sh.free()
    k.rbox((L, 2 * gp.HOUSE_Y, 0.030), (0, 0, gp.HOUSE_Z0 + 0.015), 0.004 if lod < 3 else 0.0, gp.BONE, cseg=cs,
           rz=0.003 if lod < 3 else 0.0)
    _m2.land(k, 'M', PORT, (0, -1, 0), 0.001, lod, mat=gp.BONE)
    win = Kit()
    for s in ((-1, 1) if lod < 3 else ()):
        win.cyl(POD_R - 0.0012, gp.HOUSE_Z1 - 0.0012, gp.HOUSE_Z1 + 0.0008, gp.POLY, seg(24, q, 8),
                bev=0.0006 if lod < 2 else 0.0, bseg=1, m=kit.at(0, s * TYRE_Y, 0))
    return k, win


def tyre(side, lod, q):
    k = Kit(pivot='PIVOT__tyre_%s' % ('l' if side > 0 else 'r'))
    c = (0.0, side * TYRE_Y, 0.0)
    k.cyl(TYRE_R, gp.TYRE_Z0, gp.TYRE_Z1, gp.RUBBER, seg(24, q, 6), bev=0.0025 if lod < 3 else 0.0,
          bseg=2 if lod < 2 else 1, m=kit.at(*c))
    if lod < 3:
        k.cyl(0.005, gp.TYRE_Z1 - 0.0005, gp.TYRE_Z1 + 0.0012, gp.STEEL, seg(12, q, 6), bev=0.0005 if lod < 2 else 0.0,
              bseg=1, m=kit.at(*c))
    return k


def build(lod, q, mats):
    rails = Kit()
    gp.sweep_rails(rails, -L / 2, L / 2, gp.RAIL_SIDES[lod] if q >= 0.5 else max(4, gp.RAIL_SIDES[lod] - 2))
    spine = Kit()
    gp.sweep_spine(spine, -L / 2, L / 2)
    house, window = housing(lod, q, mats)
    drive = Kit(pivot='PIVOT__drive')
    # Cobalt drive dog in the ring's socket and the internal steel axle
    drive.rbox((0.012, 0.004, 0.006), (0.0, -0.0258, AXLE_Z), 0.0015 if lod < 3 else 0.0, gp.COBALT,
               cseg=1 if lod < 3 else 0, rz=0.0)
    drive.cyl(0.003, -0.026, 0.020, gp.STEEL, seg(12, q, 6), m=kit.at(0, 0, AXLE_Z) @ kit.frame(axis='y'))
    pieces = {'rails': rails, 'spine': spine, 'housing': house, 'window': window, 'drive': drive,
              'tyre_l': tyre(1, lod, q), 'tyre_r': tyre(-1, lod, q)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.glidepath.graphite', (-0.085, -gp.HOUSE_Y, -0.022), (0, -1, 0), (0, 0, 1), 0.06),
        kit.decal_plane('picto.rotating_parts.warn', (0.095, -gp.HOUSE_Y, -0.022), (0, -1, 0), (0, 0, 1), 0.024, 0.024),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '3,1,0.7', 0.6, 'path', 4500,
        'GLIDEPATH booster (parts-data glidepath_booster): a fixed 0.30 m powered straight, origin at its centre on the '
        'rail-top line (kn_origin = path, like the kit). Chrome rail + Cobalt spine stub inside a pillowed Bone '
        'housing with an open rider channel; kn_poly_clear windows over the two kn_rubber friction tyres on '
        'PIVOT__tyre_l / _r (z, counter-rotating); PR-M spin drive on a 1 mm land over the internal axle on '
        'PIVOT__drive (y at z -0.055, the def hinge; Cobalt drive dog + steel axle). Tyres are Ø 0.026 in flank pods '
        '(the brief\'s Ø 0.03 beside a Ø 0.016 rider cannot fit its 0.05 housing; overall depth 0.073). The def visuals '
        'show four tyres; '
        'the brief and this art have one pair (tyre_l / tyre_r). Name plate + rotating-parts pictogram on the front. '
        'UV1 authored for the 2048² set (bake pending). Brief: docs/art/briefs/frame.md#glidepath (booster piece).',
        MASTERS)
    part.pivot('tyre_l', (0.0, TYRE_Y, 0.0), 'z', motion='turn')
    part.pivot('tyre_r', (0.0, -TYRE_Y, 0.0), 'z', motion='turn')
    part.pivot('drive', (0.0, 0.0, AXLE_Z), 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.2)
    # def shapes: housing box (0.30 x 0.075 x 0.05 at y -0.0475 engine) + the arm's axle cylinder
    part.col_box('housing', (L, 0.05, 0.075), (0, 0, -0.0475), phys='powder', restitution=0.25, friction=0.5)
    _m2.under(part, part.col_cyl('drive', 0.015, 0.02, (0, 0, AXLE_Z), 'y', phys='powder'), 'drive')
    part.port('spin', 'drive', PORT, (0, -1, 0), 'M', 'in', kind='axle')
    part.sensor('trigger', 'booster', [(x * 0.15, y * 0.015, z) for x in (-1, 1) for y in (-1, 1)
                                       for z in (0.0, 0.03)], threshold=0.0)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
