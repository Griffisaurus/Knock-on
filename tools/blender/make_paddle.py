"""Procedurally build the PADDLE source file (docs/art/briefs/contraptions.md, "PADDLE / BUMPER: Pinball flipper and
pop bumper").

Usage: blender -b --factory-startup -P tools/blender/make_paddle.py -- [out.blend]
Default output: assets/src/contraptions/paddle.blend

A pinball flipper (3 x 1 x 1; origin = hinge axis centre at the bat's -X end, mid-thickness; floor z -0.06): a
pillowed kn_powder_bone base puck (Ø 0.07 x 0.045) on three FOOT_S bumpers with a flat front boss for the PR-S
signal flip ring, and a steel hinge pin. PIVOT__bat (axis z, -15° rest ... +30°; modelled at rest) carries the
kn_powder_ignition teardrop bat (0.29 long, Ø 0.06 hub -> 0.025 tip, hub-to-tip 0.2475, 0.03 thick) with an 8 mm
kn_rubber rim round its edge and a kn_chrome hub cap to z 0.025. At -15° the bounds fill 3 x 1 (0.287 x 0.112).
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

TYPE = 'paddle'
FLOOR = -0.06
PUCK_R, PUCK_Z1 = 0.035, -0.015
HUB_R, TIP_R, TIP_X, T = 0.03, 0.0125, 0.2475, 0.03
REST = -15.0
PORT = (0.0, -0.036, -0.037)
BONE, RUBBER, IGN, CHROME, STEEL = 'kn_powder_bone', 'kn_rubber', 'kn_powder_ignition', 'kn_chrome', 'kn_steel_brushed'
MASTERS = [BONE, RUBBER, IGN, CHROME, STEEL, 'kn_decal']


def teardrop(n_hub, n_tip):
    """CCW outline: hub circle r 0.03 at the origin, tip circle r 0.0125 at x 0.2475, joined by tangents."""
    d = TIP_X
    phi = math.asin((HUB_R - TIP_R) / d)          # tangent angle offset
    pts = []
    a0, a1 = math.pi / 2 + phi, 3 * math.pi / 2 - phi
    for i in range(n_hub + 1):
        a = a0 + (a1 - a0) * i / n_hub
        pts.append((HUB_R * math.cos(a), HUB_R * math.sin(a)))
    b0, b1 = -math.pi / 2 - phi, math.pi / 2 + phi
    for i in range(n_tip + 1):
        a = b0 + (b1 - b0) * i / n_tip
        pts.append((d + TIP_R * math.cos(a), TIP_R * math.sin(a)))
    return pts


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    base = Kit()
    n = seg(36, q, 8)
    base.cyl(PUCK_R, FLOOR + 0.003, PUCK_Z1, BONE, n, bev=0.005 if lod < 3 else 0.0, bseg=(3, 2, 1, 1)[lod],
             bev_bot=0.002 if lod < 3 else 0.0)
    _m2.land(base, 'S', PORT, (0, -1, 0), 0.0015, lod, mat=BONE)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        _m2.foot(base, 'S', 0.022 * math.cos(a), 0.022 * math.sin(a), min(1.0, q), lod, z0=FLOOR)
    base.cyl(0.006, PUCK_Z1 - 0.004, -T / 2 + 0.001, STEEL, seg(14, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1)
    bat = Kit(pivot='PIVOT__bat')
    out = teardrop(seg(20, q, 6), seg(12, q, 4))
    m = kit.rot_z(REST)
    rb = 0.004
    bat.prism(out, -T / 2, T / 2, IGN, bt=0.004 if lod < 3 else 0.0, bb=0.004 if lod < 3 else 0.0,
              bseg=(2, 1, 1, 1)[lod], cuts=(-rb, rb), side_fn=lambda z: RUBBER if abs(z) < rb else IGN, m=m)
    if lod < 3:  # the rim stands 1 mm proud of the bat edge
        rim = [(p[0] * 1.0, p[1] * 1.0) for p in out]
        bat.ring_sweep(rim, [(-0.0005, -rb), (0.001, -rb + 0.001), (0.001, rb - 0.001), (-0.0005, rb)], RUBBER, m=m)
    bat.cyl(0.02, T / 2 - 0.001, 0.025, CHROME, seg(32, q, 8), bev=0.003 if lod < 3 else 0.0, bseg=2)
    pieces = {'base': base, 'bat': bat}
    rot = kit.rot_z(REST).to_3x3()
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.paddle.bone', tuple(rot @ Vector((0.120, 0, T / 2))), (0, 0, 1),
                        tuple(rot @ Vector((0, 1, 0))), 0.06, pivot='PIVOT__bat'),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'M', '3,1,1', 0.8, 'hinge', 3500,
        'Pinball flipper (origin on the hinge at the bat -X end, floor z -0.06): pillowed kn_powder_bone puck (Ø 0.07 '
        'x 0.045) on 3 x FOOT_S with a front boss for the PR-S signal flip ring; PIVOT__bat (z, -15° rest ... +30°) '
        'carries the kn_powder_ignition teardrop bat (hub Ø 0.06 -> tip 0.025, 0.2475 centres, 0.03 thick) with an '
        '8 mm kn_rubber edge rim and a kn_chrome hub cap. Name plate on the bat top. UV1 authored for the 2048² set '
        '(bake pending). Brief: docs/art/briefs/contraptions.md#paddle--bumper.',
        MASTERS, skins='classic,retro')
    part.pivot('bat', (0, 0, 0), 'z', REST, 30.0, motion='turn', rest=REST)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.3)
    part.col_cyl('base', PUCK_R, PUCK_Z1 - FLOOR, (0, 0, (FLOOR + PUCK_Z1) / 2), 'z', phys='powder', restitution=0.2,
                 friction=0.6)
    rot = kit.rot_z(REST).to_3x3()
    pts = [tuple(rot @ Vector((x, y, z))) for x, y in teardrop(8, 5) for z in (-T / 2, T / 2)]
    _m2.under(part, part.col_hull('bat', pts, phys='rubber', restitution=0.7, friction=0.6), 'bat')
    part.port('signal', 'flip', PORT, (0, -1, 0), 'S', 'in')
    nrm = rot @ Vector((0, 1, 0))
    mid = rot @ Vector((TIP_X / 2, 0, 0)) + nrm * 0.024
    _m2.under(part, part.emit('flip', 'bat', tuple(mid), tuple(nrm)), 'bat')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
