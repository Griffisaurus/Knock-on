"""Procedurally build the GALE source file (docs/art/briefs/air.md, "GALE: Desk fan").

Usage: blender -b --factory-startup -P tools/blender/make_gale.py -- [out.blend]
Default output: assets/src/air/gale.blend

The approved look-dev gale() recoloured into the Air family and scaled down: bone base drum (Ø 0.095 x 0.03) on
a rubber foot ring with a tilted front port boss (the PR-S power ring faces (0, -0.99, 0.15)), a steel stem at
y 0.022 rising >= 70 mm to the bone motor pod (Ø 0.044 x 0.045) behind the head, the kn_powder_beam housing
torus (R 0.0665, r 0.0085, outer Ø 0.15) at (0, -0.005, 0.122), a steel front grill (3 rings + 10 spokes), and
five kn_poly_amber blades (0.046 x 0.022 x 0.003, 25° pitch) round a domed bone hub under PIVOT__rotor (axis y).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'gale'
HEAD = Vector((0.0, -0.005, 0.122))
HOUSING_R, HOUSING_r = 0.0665, 0.0085
BASE_R, BASE_TOP, FOOT_H = 0.0475, 0.030, 0.003
STEM_Y, STEM_R = 0.022, 0.006
POD_R, POD_Y0, POD_Y1 = 0.022, 0.0035, 0.0485
GRILL_Y = HEAD.y - HOUSING_r - 0.0006
PORT, PORT_DIR = (0.0, -0.048, 0.019), Vector((0.0, -0.99, 0.15)).normalized()
BONE, BEAM, STEEL, AMBER, RUBBER, LED = ('kn_powder_bone', 'kn_powder_beam', 'kn_steel_brushed', 'kn_poly_amber',
                                        'kn_rubber', 'kn_led')
MASTERS = [BONE, BEAM, STEEL, AMBER, RUBBER, LED]


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    body = Kit()
    n = seg(48, q, 8)
    body.cyl(BASE_R, FOOT_H, BASE_TOP, BONE, n, bev=(0.004, 0.004, 0.003, 0.0)[lod], bseg=cs,
             bev_bot=(0.001, 0.0, 0.0, 0.0)[lod])
    tilt = math.degrees(math.atan2(PORT_DIR.z, -PORT_DIR.y))
    boss_d = 0.016
    c = Vector(PORT) - PORT_DIR * (boss_d / 2 - 0.0004)
    body.rbox((0.036, boss_d, 0.028), (0, 0, 0), 0.004 if lod < 3 else 0.0, BONE, cseg=cs,
              rz=0.002 if lod < 2 else 0.0, m=kit.at(*c) @ kit.rot_x(-tilt))
    if lod < 3:
        prof = [(0.036, FOOT_H + 0.0006), (0.036, 0.0008), (0.0368, 0.0), (0.0392, 0.0), (0.040, 0.0008),
                (0.040, FOOT_H + 0.0006)]
        body.lathe([(r, z, RUBBER) for r, z in prof], seg(36, q, 8), closed=True)
    body.cyl(STEM_R, BASE_TOP - 0.002, HEAD.z - POD_R + 0.004, STEEL, seg(16, q, 6), m=kit.at(0, STEM_Y, 0))
    body.cyl(POD_R, POD_Y0, POD_Y1, BONE, seg(32, q, 8), bev=(0.005, 0.004, 0.003, 0.0)[lod], bseg=cs,
             m=kit.at(0, 0, HEAD.z) @ kit.Y_AXIS)
    body.torus(HOUSING_R, HOUSING_r, BEAM, seg(56, q, 10), (12, 8, 6, 4)[lod], m=kit.at(*HEAD) @ kit.Y_AXIS)
    # status LED (LED_D6) on the pod top
    led_c = (0.0, 0.024, HEAD.z + POD_R)
    if lod < 3:
        body.cyl(0.0045, -0.0005, 0.0012, STEEL, seg(12, q, 6), m=kit.at(*led_c))
    body.sphere(0.003, LED, seg(12, q, 4), (6, 4, 2, 2)[lod], m=kit.at(led_c[0], led_c[1], led_c[2] + 0.0008),
                sz_bot=0.25)
    if lod < 2:  # front grill: 3 rings + 10 spokes (one transparent layer in front of the blades)
        gm = kit.at(HEAD.x, GRILL_Y, HEAD.z) @ kit.Y_AXIS
        for rr in (0.0245, 0.0455, 0.065):
            body.torus(rr, 0.0011, STEEL, seg(int(rr * 900), q, 8), (6, 4)[lod], m=gm)
        for k in range(10):
            a = 2 * math.pi * k / 10
            d = Vector((math.sin(a), 0.0, math.cos(a)))
            p0 = Vector((HEAD.x, GRILL_Y, HEAD.z)) + d * 0.010
            body.sweep([p0, p0 + d * 0.056], 0.0010, (6, 4)[lod], STEEL)
        body.cyl(0.0105, GRILL_Y - 0.0012, GRILL_Y + 0.0012, STEEL, seg(16, q, 6), bev=0.0006, bseg=1,
                 m=kit.at(HEAD.x, 0, HEAD.z) @ kit.Y_AXIS)
    rotor = Kit(pivot='PIVOT__rotor')
    if lod < 2:
        for k in range(5):
            a = 2 * math.pi * k / 5 + 0.3
            u = Vector((math.cos(a), 0.0, math.sin(a)))
            t = Vector((-math.sin(a), 0.0, math.cos(a)))
            nrm = u.cross(t)
            basis = Matrix((u, t, nrm)).transposed().to_4x4()
            m = kit.at(*(HEAD + u * 0.031)) @ basis @ kit.rot_x(25)
            rotor.rbox((0.046, 0.022, 0.003), (0, 0, 0), 0.007, AMBER, cseg=cs, rz=0.001 if lod == 0 else 0.0, m=m)
    else:  # LOD2+: the blades become one amber disc
        rotor.cyl(0.054, -0.0015, 0.0015, AMBER, seg(28, q, 8), m=kit.at(*HEAD) @ kit.Y_AXIS @ kit.rot_x(180))
    rotor.sphere(0.0135, BONE, seg(24, q, 6), seg(10, q, 4, 2), sz_top=0.75, sz_bot=0.5,
                 m=kit.at(HEAD.x, HEAD.y - 0.002, HEAD.z) @ kit.frame((0, 0, 0), '-y'))
    # Name plate on the motor pod's +X flank (graphite ink on bone), running along the pod.
    decals = [kit.decal_plane('name.gale.graphite', (POD_R, (POD_Y0 + POD_Y1) / 2, HEAD.z), (1, 0, 0), (0, 0, 1),
                              0.034, lift=0.0004)]
    return kit.add_decals({'body': body, 'rotor': rotor}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'air', 'M', '1.5,2,1', 0.9, 'bottom', 6000,
        'Desk fan: look-dev gale() in Air colours. Brief: docs/art/briefs/air.md#gale. The head (outer Ø 0.15) '
        'sets the width, so the footprint is 1.5 x 2 x 1 cells (brief size 0.20 wide). Name plate decal on the '
        'pod flank; blade thickness map deferred.',
        MASTERS, led_groups='0:status')
    part.pivot('rotor', tuple(HEAD), 'y')
    part.build_lods(build, lod0_q=1.1)
    part.col_cyl('base', BASE_R, BASE_TOP, (0, 0, BASE_TOP / 2), 'z', phys='powder', restitution=0.25, friction=0.5)
    z0, z1 = BASE_TOP, HEAD.z - POD_R
    part.col_capsule('stem', STEM_R, z1 - z0, (0, STEM_Y, (z0 + z1) / 2), 'z', phys='steel')
    part.col_cyl('head', 0.075, 0.035, tuple(HEAD), 'y', phys='powder')
    part.port('power', 'in', PORT, tuple(PORT_DIR), 'S', 'in')
    part.emit('wind', 'front', (0.0, -0.015, HEAD.z), (0, -1, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
