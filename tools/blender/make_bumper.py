"""Procedurally build the BUMPER source file (docs/art/briefs/contraptions.md, "PADDLE / BUMPER: Pinball flipper and
pop bumper").

Usage: blender -b --factory-startup -P tools/blender/make_bumper.py -- [out.blend]
Default output: assets/src/contraptions/bumper.blend

A pop bumper (⌀1.5 x 1, bottom origin): a pillowed kn_powder_bone skirt (r 0.075 x 0.032) on three FOOT_S bumpers
with a flat front boss for the PR-S signal kick ring; a kn_powder_ignition body (r 0.06, z 0.03 ... 0.07) wrapped
by an 8 mm kn_rubber band; a kn_chrome kicker ring on three posts on PIVOT__ring (axis z, slide -0.012 ... 0,
modelled up); a kn_poly_clear dome (Ø 0.09, z 0.07 ... 0.10) over a kn_led star (group 0 cap, 25 % idle).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'bumper'
SK_R, SK_Z1 = 0.075, 0.032
BODY_R, BODY_Z0, BODY_Z1 = 0.06, 0.03, 0.07
DOME_R, DOME_Z1 = 0.045, 0.10
RING_Z = 0.058
PORT = (0.0, -0.076, 0.019)
BONE, RUBBER, IGN, CHROME, POLY, LED = 'kn_powder_bone', 'kn_rubber', 'kn_powder_ignition', 'kn_chrome', 'kn_poly_clear', 'kn_led'
MASTERS = [BONE, RUBBER, IGN, CHROME, POLY, LED, 'kn_decal']


def build(lod, q, mats):
    n = seg(48, q, 10) if lod < 3 else 8
    skirt = Kit()
    skirt.cyl(SK_R, 0.003, SK_Z1, BONE, n, bev=0.006 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
              bev_bot=0.002 if lod < 3 else 0.0)
    _m2.land(skirt, 'S', PORT, (0, -1, 0), 0.0015, lod, mat=BONE)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        _m2.foot(skirt, 'S', 0.055 * math.cos(a), 0.055 * math.sin(a), min(1.0, q), lod)
    body = Kit()
    zb0, zb1 = 0.046, 0.054
    if lod >= 3:
        body.lathe([(0.0, BODY_Z0 - 0.002, IGN), (BODY_R, BODY_Z0 - 0.002, RUBBER), (BODY_R, zb1, IGN),
                    (BODY_R, BODY_Z1, IGN), (0.0, BODY_Z1, IGN)], n)
    else:
        body.lathe([(0.0, BODY_Z0 - 0.002, IGN), (BODY_R, BODY_Z0 - 0.002, IGN), (BODY_R, zb0, RUBBER),
                (BODY_R + 0.0035, zb0 + 0.0015, RUBBER), (BODY_R + 0.0035, zb1 - 0.0015, RUBBER), (BODY_R, zb1, IGN),
                (BODY_R, BODY_Z1 - 0.004, IGN), (BODY_R - 0.004, BODY_Z1, IGN), (0.0, BODY_Z1, IGN)], n)
    dome = Kit()
    dome.sphere(DOME_R, POLY, n, seg(10, q, 4, 2) if lod < 3 else 4, m=kit.at(0, 0, BODY_Z1 - 0.0005),
                sz_top=(DOME_Z1 - BODY_Z1 + 0.0005) / DOME_R, sz_bot=0.02)
    star = [((0.022 if i % 2 == 0 else 0.009) * math.cos(math.pi / 2 + math.pi * i / 5),
             (0.022 if i % 2 == 0 else 0.009) * math.sin(math.pi / 2 + math.pi * i / 5)) for i in range(10)]
    dome.prism(star, BODY_Z1 - 0.001, BODY_Z1 + 0.004, LED)
    dome.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.25))
    ring = Kit(pivot='PIVOT__ring')
    if lod < 3:
        ring.lathe([(0.064, RING_Z - 0.002, CHROME), (0.0705, RING_Z - 0.002, CHROME), (0.0715, RING_Z, CHROME),
                    (0.0705, RING_Z + 0.002, CHROME), (0.064, RING_Z + 0.002, CHROME)], n, closed=True)
    else:
        ring.cyl(0.0715, RING_Z - 0.002, RING_Z + 0.002, CHROME, n)
    if lod < 3:
        for i in range(3):
            a = math.radians(30 + 120 * i)
            ring.cyl(0.0022, SK_Z1 - 0.004, RING_Z, CHROME, seg(8, q, 4),
                     m=kit.at(0.0675 * math.cos(a), 0.0675 * math.sin(a), 0))
    pieces = {'skirt': skirt, 'body': body, 'dome': dome, 'ring': ring}
    return kit.add_decals(pieces, lod, [
        kit.decal_cylinder('name.bumper.graphite', (0, 0, 0.018), (0, 0, 1), SK_R + 0.0002, (0.7, 0.7, 0), 0.05,
                           nu=6),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'S', '1.5,1,1.5', 0.6, 'bottom', 2500,
        'Pop bumper: pillowed kn_powder_bone skirt (r 0.075) on 3 x FOOT_S with a front boss for the PR-S signal kick '
        'ring; kn_powder_ignition body (r 0.06) with an 8 mm kn_rubber band (restitution 1.2, active); kn_chrome '
        'kicker ring on 3 posts on PIVOT__ring (z slide -0.012 ... 0); kn_poly_clear dome over a kn_led star (group 0 '
        'cap). SENSOR__trigger__skirt is the convex hull of the ring volume (r 0.08, z 0.03 ... 0.07; the brief\'s '
        'annulus r 0.055 ... 0.08 is not convex). Name plate on the skirt. UV1 authored for the 1024² set (bake '
        'pending). Brief: docs/art/briefs/contraptions.md#paddle--bumper.',
        MASTERS, led_groups='0:cap', skins='classic,retro')
    part.pivot('ring', (0, 0, RING_Z), 'z', -0.012, 0.0, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_cyl('skirt', SK_R, SK_Z1, (0, 0, SK_Z1 / 2), 'z', phys='powder', restitution=0.3, friction=0.5)
    part.col_cyl('body', BODY_R, BODY_Z1 - BODY_Z0, (0, 0, (BODY_Z0 + BODY_Z1) / 2), 'z', phys='rubber',
                 restitution=1.0, friction=0.5, active_restitution=1.2)
    pts = [(0.08 * math.cos(2 * math.pi * i / 16), 0.08 * math.sin(2 * math.pi * i / 16), z)
           for i in range(16) for z in (0.03, 0.07)]
    part.sensor('trigger', 'skirt', pts, threshold=0.05, cooldown=0.1, r_inner=0.055)
    part.port('signal', 'kick', PORT, (0, -1, 0), 'S', 'in')
    part.emit('flash', 'cap', (0, 0, DOME_Z1), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
