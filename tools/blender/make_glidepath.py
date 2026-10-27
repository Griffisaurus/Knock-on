"""Procedurally build the GLIDEPATH kit (docs/art/briefs/frame.md, "GLIDEPATH: Rail track").

Usage: blender -b --factory-startup -P tools/blender/make_glidepath.py -- [out.blend]
Default output: assets/src/frame/glidepath.blend  (+ sidecar assets/build/parts/glidepath/glidepath.profile.json)

GLIDEPATH is path-drawn like GUTTER: the engine sweeps `glidepath__profile` (two Ø 8 mm kn_chrome rails at 14 mm
centres on a kn_anod_cobalt T-spine, 0.030 W x 0.040 H, origin on the rail-top centreline) along the player's path
and places the kit pieces. It ships as a KIT + PROFILE (kn_origin = 'path', origin = the run's first control point
at the rail-top centreline). The .blend holds a 1.0 m demo straight along +X:

  glidepath__rails    the sweep: two seamless chrome rails (x 0 ... 1.0)
  glidepath__spine    the sweep: Cobalt T-spine under them
  glidepath__tie      one Bone tie, 0.03 wide, at x 0.05 (instanced every 0.1 m by gfx/glidepath.ts)
  glidepath__clamp    one Cobalt U-band at the x 0.5 joint
  glidepath__post     one Bone Ø 0.016 post (one 0.1 m module) with a Cobalt clamp head and a Ø 0.04 rubber foot, x 0.25
  glidepath__demo     look-dev only: the straight's other ties, the x 0.8 clamp and the x 0.9 post
  glidepath__buffer   rubber bumper on a 0.05 m Cobalt block at the run end (x 1.0)

The powered booster (fixed 0.30 m straight, PR-M spin drive, two friction tyres) is its own part type,
`glidepath_booster` (a link can't carry ports; parts-data, stream A3), built by make_glidepath_booster.py from the
booster() / tyre() helpers here.

COL__mesh__0 is the static sweep collider (rails as 6-side tubes, the spine as a box section). glidepath.profile.json
holds the closed profiles with per-loop masters and LOD sides, the path rules, the budget and the kit anchors.
"""
import json
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

TYPE = 'glidepath'
CHROME, BONE, COBALT, RUBBER, POLY, STEEL = (
    'kn_chrome', 'kn_powder_bone', 'kn_anod_cobalt', 'kn_rubber', 'kn_poly_clear', 'kn_steel_brushed')
MASTERS = [CHROME, BONE, COBALT, RUBBER, POLY, STEEL, 'kn_decal']
RAIL_R, RAIL_Y, RAIL_Z = 0.004, 0.007, -0.004     # rail tube radius, centre offset, centre height
RAIL_SIDES = (12, 8, 6, 4)
RUN = 1.0
JOINTS = (0.5, 0.8)
BOOST_X0, BOOST_X1 = 0.5, 0.8
BOOST_C = (BOOST_X0 + BOOST_X1) / 2               # booster origin (centre of its top, on the rail-top line)
HOUSE_Z0, HOUSE_Z1, HOUSE_Y = -0.080, 0.015, 0.024
TYRE_R, TYRE_Y, TYRE_Z0, TYRE_Z1 = 0.015, 0.023, 0.0005, 0.0115
PORT = (BOOST_C, -0.025, -0.055)
POSTS = (0.25, 0.9)
POST_TOP, POST_LEN, FOOT_H = -0.050, 0.100, 0.004
FLOOR = POST_TOP - POST_LEN - FOOT_H              # -0.154
PATH_RULES = {'min_bend_radius': 0.10, 'bank': 'any (loops allowed)', 'gradient': 'any', 'ring_step_deg': 5.0,
              'tie_spacing': 0.1, 'clamp_max_spacing': 0.5, 'post_module': 0.1,
              'straight_rings': 'joints only (one span per straight)'}


def spine_outline():
    """T-spine (x_lat, z), CCW: top bar 0.020 x 0.0055 under the rails, web 0.006 down to z -0.040."""
    return [(-0.003, -0.040), (0.003, -0.040), (0.003, -0.0115), (0.010, -0.0115), (0.010, -0.006),
            (-0.010, -0.006), (-0.010, -0.0115), (-0.003, -0.0115)]


def rail_outline(side, sides):
    return [(side * RAIL_Y + RAIL_R * math.cos(2 * math.pi * i / sides),
             RAIL_Z + RAIL_R * math.sin(2 * math.pi * i / sides)) for i in range(sides)]


def sweep_rails(k, x0, x1, sides):
    for s in (-1, 1):
        k.prism(rail_outline(s, sides), x0, x1, CHROME, m=kit.X_AXIS)


def sweep_spine(k, x0, x1):
    k.prism(spine_outline(), x0, x1, COBALT, m=kit.X_AXIS)


def ties(lod, q, xs):
    k = Kit()
    cs = (2, 1, 0, 0)[lod]
    for x in (xs if lod < 3 else ()):
        k.rbox((0.008, 0.030, 0.0065), (x, 0, -0.0085), 0.0025 if cs else 0.0, BONE, cseg=cs,
               rz=0.0012 if cs else 0.0)
    return k


def clamp_outline(n):
    """U-band (y, z) round the rail sides and the spine bar, open over the rail tops."""
    pts = [(-0.0135, -0.0145), (0.0135, -0.0145), (0.0135, -0.002), (0.0115, -0.002), (0.0115, -0.0125),
           (-0.0115, -0.0125), (-0.0115, -0.002), (-0.0135, -0.002)]
    return pts


def clamps(lod, q, xs):
    k = Kit()
    for x in xs:
        k.prism(clamp_outline(1), -0.006, 0.006, COBALT, bt=0.0008 if lod < 2 else 0.0, bb=0.0008 if lod < 2 else 0.0,
                bseg=1, m=kit.at(x, 0, 0) @ kit.X_AXIS)
    return k


def posts(lod, q, xs):
    k = Kit()
    n = seg(16, q, 6)
    for x in xs:
        # Cobalt clamp head hugging the spine web bottom
        k.rbox((0.022, 0.016, 0.012), (x, 0, -0.044), 0.004 if lod < 3 else 0.0, COBALT, cseg=(2, 1, 1, 0)[lod],
               rz=0.002 if lod < 2 else 0.0)
        k.cyl(0.008, POST_TOP - POST_LEN + 0.0005, POST_TOP + 0.001, BONE, n, bev=0.001 if lod < 2 else 0.0, bseg=1,
              m=kit.at(x, 0, 0))
        if lod < 3:  # module line ring at the 0.1 m module joint
            k.torus(0.008, 0.0008, BONE, n, 4, m=kit.at(x, 0, POST_TOP - POST_LEN / 2))
        k.cyl(0.020, FLOOR, FLOOR + FOOT_H + 0.0005, RUBBER, seg(24, q, 8), bev=0.0012 if lod < 2 else 0.0, bseg=1,
              bev_bot=0.0006 if lod < 2 else 0.0, m=kit.at(x, 0, 0))
    return k


def buffer(lod, q):
    k = Kit()
    k.rbox((0.05, 0.030, 0.042), (RUN + 0.025, 0, -0.019), 0.004 if lod < 3 else 0.0, COBALT, cseg=(2, 1, 1, 0)[lod],
           rz=0.003 if lod < 3 else 0.0)
    k.sphere(0.011, RUBBER, seg(20, q, 6), seg(10, q, 4, 2), m=kit.at(RUN, 0, 0.004) @ kit.frame(axis='-x'),
             sz_top=0.6, sz_bot=0.05)
    return k


def booster(lod, q, mats, bx=BOOST_C):
    """The 0.30 m booster housing centred on x = bx (the glidepath_booster part uses bx = 0)."""
    k = Kit()
    cs = (3, 2, 1, 0)[lod]
    L = BOOST_X1 - BOOST_X0
    blocks = Kit()
    for s in (-1, 1):  # two side blocks, the rider channel between them
        blocks.rbox((L, HOUSE_Y - 0.0115, HOUSE_Z1 - HOUSE_Z0), (bx, s * (HOUSE_Y + 0.0115) / 2,
                    (HOUSE_Z0 + HOUSE_Z1) / 2), 0.004 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.003 if lod < 3 else 0.0)
    # bridge under the spine
    blocks.rbox((L, 2 * HOUSE_Y, 0.030), (bx, 0, HOUSE_Z0 + 0.015), 0.004 if lod < 3 else 0.0, BONE, cseg=cs,
                rz=0.003 if lod < 3 else 0.0)
    if lod < 3:  # tyre wells under the windows
        wells = Kit()
        for s in (-1, 1):
            wells.cyl(TYRE_R + 0.002, TYRE_Z0 - 0.002, HOUSE_Z1 + 0.01, BONE, seg(24, q, 8),
                      m=kit.at(bx, s * TYRE_Y, 0))
        blocks = kit.boolean_diff(blocks, [wells], mats)
    k.merge(blocks)
    blocks.free()
    _m2.land(k, 'M', (bx, PORT[1], PORT[2]), (0, -1, 0), 0.001, lod, mat=BONE)
    win = Kit()
    for s in ((-1, 1) if lod < 3 else ()):
        win.cyl(TYRE_R + 0.004, HOUSE_Z1 - 0.0012, HOUSE_Z1 + 0.0008, POLY, seg(24, q, 8),
                bev=0.0006 if lod < 2 else 0.0, bseg=1, m=kit.at(bx, s * TYRE_Y, 0))
    return k, win


def tyre(side, lod, q, bx=BOOST_C):
    k = Kit(pivot='PIVOT__tyre_%s' % ('l' if side > 0 else 'r'))
    n = seg(24, q, 6)
    c = (bx, side * TYRE_Y, 0.0)
    k.cyl(TYRE_R, TYRE_Z0, TYRE_Z1, RUBBER, n, bev=0.0025 if lod < 3 else 0.0, bseg=2 if lod < 2 else 1,
          m=kit.at(*c))
    if lod < 3:
        k.cyl(0.006, TYRE_Z1 - 0.0005, TYRE_Z1 + 0.0012, STEEL, seg(12, q, 6), bev=0.0005 if lod < 2 else 0.0, bseg=1,
              m=kit.at(*c))
    return k


def build(lod, q, mats):
    rails = Kit()
    sweep_rails(rails, 0.0, RUN, RAIL_SIDES[lod] if q >= 0.5 else max(4, RAIL_SIDES[lod] - 2))
    spine = Kit()
    sweep_spine(spine, 0.0, RUN)
    # the powered booster is its own part (glidepath_booster: a link can't carry ports), built by
    # make_glidepath_booster.py from booster() / tyre() above
    # one instance of each kit piece at its profile.json demo_pos (gfx/glidepath.ts places them along the
    # player's path); `demo` holds the rest of this straight's ties, the second clamp and post for the look-dev
    tie_xs = [0.05 + 0.1 * i for i in range(int(RUN / 0.1)) if 0.05 + 0.1 * i <= RUN]
    demo = ties(lod, q, tie_xs[1:])
    for extra in (clamps(lod, q, JOINTS[1:]), posts(lod, q, POSTS[1:])):
        demo.merge(extra)
        extra.free()
    pieces = {'rails': rails, 'spine': spine, 'tie': ties(lod, q, tie_xs[:1]), 'clamp': clamps(lod, q, JOINTS[:1]),
              'post': posts(lod, q, POSTS[:1]), 'buffer': buffer(lod, q), 'demo': demo}
    return pieces


def col_mesh():
    k = Kit()
    for s in (-1, 1):
        k.prism(rail_outline(s, 6), 0.0, RUN, 'x', m=kit.X_AXIS)
    k.prism([(-0.010, -0.040), (0.010, -0.040), (0.010, -0.006), (-0.010, -0.006)], 0.0, RUN, 'x', m=kit.X_AXIS)
    return k


def bounds(pieces):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for kk in pieces.values():
        for v in kk.bm.verts:
            lo = Vector(min(a, b) for a, b in zip(lo, v.co))
            hi = Vector(max(a, b) for a, b in zip(hi, v.co))
    return lo, hi


def profile_json(lo, hi):
    lods = {}
    for lod, sides in enumerate(RAIL_SIDES):
        lods['LOD%d' % lod] = {
            'rail_sides': sides,
            'loops': [
                {'name': 'rail_l', 'master': CHROME, 'points': [[round(a, 6), round(b, 6)] for a, b in
                                                                rail_outline(1, sides)]},
                {'name': 'rail_r', 'master': CHROME, 'points': [[round(a, 6), round(b, 6)] for a, b in
                                                                rail_outline(-1, sides)]},
                {'name': 'spine', 'master': COBALT, 'points': [[a, b] for a, b in spine_outline()]},
            ]}
    return {
        'type': TYPE, 'kind': 'path_sweep',
        'note': 'GLIDEPATH is a kit + profile: the engine sweeps the three closed loops (two rails, one T-spine) along '
                'player-drawn splines and places the kit pieces from the .glb. The rails stay seamless: no rings on '
                'straights, one ring every ring_step_deg on bends. The .glb demo is one straight 1.0 m run along +X.',
        'units': 'm',
        'frame': 'profile (x_lat, z): origin = rail-top centreline on the path; z = path up (banked normal); x_lat = '
                 'up x tangent (left of travel; Blender +Y on the demo run, which travels +X). Each loop is a closed '
                 'CCW polygon with one master.',
        'gauge': {'rail_d': 2 * RAIL_R, 'rail_centres': 2 * RAIL_Y, 'rider': 'Ø 0.016 BEARING sits between the rails',
                  'overall_w_h': [0.030, 0.040]},
        'lods': lods, 'path_rules': PATH_RULES,
        'budget': {'sweep_tris_per_m': 300, 'tie': 60, 'clamp_max': 200, 'post_max': '400 + 40 per 0.1 m module',
                   'buffer_max': 500, 'booster_max': 4500},
        'kit': {
            'glidepath__tie': {'anchor': 'every 0.1 m along s, centred on the path', 'demo_pos': [0.05, 0, 0]},
            'glidepath__clamp': {'anchor': 'every joint (at most 0.5 m apart)', 'demo_pos': [JOINTS[0], 0, 0],
                                 'width': 0.012},
            'glidepath__post': {'anchor': 'under the spine, plumb', 'demo_pos': [POSTS[0], 0, 0],
                                'module': POST_LEN, 'post_d': 0.016, 'foot_d': 0.04,
                                'note': 'clamp head under the web at z -0.038 ... -0.050; modules stack down to the '
                                        'floor; foot %.3f m' % FOOT_H},
            'glidepath__buffer': {'anchor': 'run end', 'demo_pos': [RUN, 0, 0], 'extends': [-0.011, 0.05]},
            'glidepath_booster': {'anchor': 'separate part type (parts-data glidepath_booster): a fixed 0.30 m '
                                  'straight placed on the track, origin at its centre on the rail-top line',
                                  'glb': 'parts/glidepath_booster/glidepath_booster.glb', 'length': 0.30},
        },
        'demo_bounds_blender': {'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi]},
        'collision': {'name': 'COL__mesh__0', 'phys': 'steel', 'friction': 0.10, 'static': True,
                      'profile': 'rails as 6-side tubes, spine as a box section'},
    }


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '1,1,1', 1.0, 'path', 4000,
        'Rail track, delivered as a KIT + PROFILE (path-drawn like GUTTER; kn_origin = path, origin = the first '
        'control point on the rail-top centreline). Demo: a 1.0 m straight along +X with seamless kn_chrome rails '
        '(Ø 8 mm at 14 mm centres) on a kn_anod_cobalt T-spine, Bone ties every 0.1 m, Cobalt joint clamps (the '
        'materials row; the notes call them steel bands), two Bone posts with Cobalt clamp heads and rubber feet, '
        'and a rubber buffer on a Cobalt block. The powered booster is the separate part glidepath_booster. Engine '
        'sweep data: '
        'assets/build/parts/glidepath/glidepath.profile.json. Static: kn_mass_hint nominal. UV1 authored for the '
        '2048² set (bake pending). Brief: docs/art/briefs/frame.md#glidepath.',
        MASTERS)
    probe = build(0, 1.0, part.mats)
    lo, hi = bounds(probe)
    for kk in probe.values():
        kk.free()
    size = hi - lo
    part.root['kn_footprint'] = '%.2f,%.2f,%.2f' % (size.x * 10, size.z * 10, size.y * 10)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.15)
    part._col('mesh', '0', col_mesh(), None, 'steel', restitution=0.3, friction=0.10)
    side = os.path.join(part.root_dir, 'assets', 'build', 'parts', TYPE)
    os.makedirs(side, exist_ok=True)
    with open(os.path.join(side, TYPE + '.profile.json'), 'w', encoding='utf8') as f:
        json.dump(profile_json(lo, hi), f, indent=1)
    print('wrote', os.path.join(side, TYPE + '.profile.json'), 'footprint', part.root['kn_footprint'])
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
