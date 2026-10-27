"""Procedurally build the GRAV WELL source file (docs/art/briefs/future.md, "GRAV WELL: Levitating-orb attractor/
repulsor").

Usage: blender -b --factory-startup -P tools/blender/make_grav_well.py -- [out.blend]
Default output: assets/src/future/grav_well.blend

A 0.20 x 0.20 x 0.046 kn_powder_graphite plinth (12 mm pillow, z 0.004-0.050) on four FOOT_M bumpers. Three curved
graphite fins (roots at r 0.075 on the plinth top, at 90° (rear), 210° and 330°) curl in to kn_anod_plasma tips with
LED_D8 domes (group 1 tips) that cradle the Ø 0.09 orb. The orb hangs on PIVOT__orb_lift (z slide 0 ... 0.020: resting
centre z 0.115, powered 0.135) and PIVOT__orb_spin (z, continuous, a child of the lift): a polished kn_anod_graphite
body with kn_powder_plasma polar caps, two meridian grooves so the spin reads, and a 4 mm kn_led equator seam
(group 0 seam). A ring of 12 kn_led segments on the plinth top (group 2 mode_ring: chases inward = attract, outward =
repel). Front: PR-M power port (0.055, -0.100, 0.025), name plate. No fuse, no rivets: never a bomb.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'grav_well'
G, PLASMA_P, PLASMA_A, AGRAPH, RUBBER, LED, STEEL = (
    'kn_powder_graphite', 'kn_powder_plasma', 'kn_anod_plasma', 'kn_anod_graphite', 'kn_rubber', 'kn_led',
    'kn_steel_brushed')
MASTERS = [G, PLASMA_P, PLASMA_A, AGRAPH, RUBBER, LED, STEEL, 'kn_decal']
W, PL_Z0, PL_Z1 = 0.20, 0.004, 0.050
ORB_R, ORB_Z = 0.045, 0.115
ARMS = (90.0, 210.0, 330.0)
PORT = (0.055, -0.100, 0.025)
# fin path in (r, z), root on the plinth top to the tip that cradles the orb
FIN = [(0.080, 0.046), (0.087, 0.062), (0.085, 0.078), (0.074, 0.089), (0.058, 0.093), (0.045, 0.089)]
TIP = (0.040, 0.0855)


def tip_point(deg):
    a = math.radians(deg)
    return Vector((TIP[0] * math.cos(a), TIP[0] * math.sin(a), TIP[1]))


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.rbox((W, W, PL_Z1 - PL_Z0), (0, 0, (PL_Z0 + PL_Z1) / 2), 0.012 if lod < 3 else 0.004, G, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.080, sy * 0.080, min(1.0, q), lod)
    # mode ring: 12 LED segments on the plinth top
    nseg = 12 if lod < 3 else 0
    if lod >= 3:
        body.lathe([(0.052, PL_Z1 - 0.0005, LED), (0.060, PL_Z1 - 0.0005, LED), (0.060, PL_Z1 + 0.0010, LED),
                    (0.052, PL_Z1 + 0.0010, LED)], 12, closed=True)
    for i in range(nseg):
        a0 = math.radians(360.0 * i / nseg + 4)
        a1 = math.radians(360.0 * (i + 1) / nseg - 4)
        body.lathe_arc([(0.052, PL_Z1 - 0.0005, LED), (0.060, PL_Z1 - 0.0005, LED), (0.060, PL_Z1 + 0.0010, LED),
                        (0.052, PL_Z1 + 0.0010, LED)], a0, a1, (3, 2, 1, 1)[lod])
    # three curved fins with plasma tips and LED domes
    sub = (4, 3, 2, 1)[lod]
    path = _m4.smooth_path(FIN, sub)
    nr = len(path)
    radii = [0.0085 - 0.0035 * i / (nr - 1) for i in range(nr)]
    sides = seg(12, q, 6) if lod < 3 else 4
    flat = Matrix.Diagonal((1.0, 0.62, 1.0, 1.0))
    for deg in ARMS:
        m = kit.rot_z(deg) @ flat
        pts3 = [(r, 0.0, z) for r, z in path]
        body.sweep(pts3, 0.0085, sides, G, m=m, radii=radii)
        # plasma tip collar and LED dome facing the orb centre
        tp = tip_point(deg)
        d = (Vector((0, 0, ORB_Z)) - tp).normalized()
        if lod < 3:
            body.cyl(0.0058, -0.003, 0.0012, PLASMA_A, seg(14, q, 6), bev=0.0012 if lod < 2 else 0.0, bseg=1,
                     m=kit.frame(tuple(tp), tuple(d)))
        _m2.led_dome(body, 8, tuple(tp + d * 0.0012), tuple(d), q, lod, bezel=PLASMA_A)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (2, 0.08) if c.z < PL_Z1 + 0.003 else (1, 0.08))
    # the orb (lift + spin)
    orb = Kit(pivot='PIVOT__orb_spin')
    n = seg(48, q, 10, 2) if lod < 3 else seg(10, q, 8, 2)
    rings = (24, 16, 10, 6)[lod]
    cap_lat = math.radians(58)
    prof = [(0.0, -ORB_R, PLASMA_P)]
    for k in range(1, rings):
        phi = -math.pi / 2 + math.pi * k / rings
        mat = PLASMA_P if abs(phi) > cap_lat else AGRAPH
        prof.append((ORB_R * math.cos(phi), ORB_R * math.sin(phi), mat))
    prof.append((0.0, ORB_R, PLASMA_P))
    # strip master = its lower point; fix the strips crossing into the north cap
    fixed = []
    for i, (r, z, mat) in enumerate(prof):
        if i + 1 < len(prof):
            zm = (z + prof[i + 1][1]) / 2
            mat = PLASMA_P if abs(zm) > ORB_R * math.sin(cap_lat) else AGRAPH
        fixed.append((r, z, mat))
    orb.lathe(fixed, n, kit.at(0, 0, ORB_Z))
    # equator seam band (proud 0.6 mm) and two meridian grooves rendered as thin plasma ribs
    orb.lathe([(ORB_R - 0.001, -0.002, LED), (ORB_R + 0.0006, -0.002, LED), (ORB_R + 0.0006, 0.002, LED),
               (ORB_R - 0.001, 0.002, LED)], n, kit.at(0, 0, ORB_Z), closed=True)
    if lod < 3:
        for k in range(2):
            arc = []
            nn = (14, 10, 6)[lod]
            for i in range(nn + 1):
                phi = -cap_lat + 2 * cap_lat * i / nn
                if abs(phi) < 0.06:
                    continue
                arc.append((ORB_R * math.cos(phi) + 0.0002, 0.0, ORB_Z + ORB_R * math.sin(phi)))
            lo_arc = [p for p in arc if p[2] < ORB_Z]
            hi_arc = [p for p in arc if p[2] > ORB_Z]
            for seg_pts in (lo_arc, hi_arc):
                if len(seg_pts) >= 2:
                    orb.sweep(seg_pts, 0.0011, (6, 5, 4)[lod], PLASMA_P, m=kit.rot_z(90 + 180 * k))
    orb.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    pieces = {'body': body, 'orb': orb}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.grav_well.bone', (-0.050, -W / 2, 0.025), (0, -1, 0), (0, 0, 1), 0.075),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '2,1.5,2', 3.0, 'bottom', 6500,
        'Levitating-orb attractor / repulsor: kn_powder_graphite plinth 0.20 x 0.20 (12 mm pillow, z 0.004-0.050) on '
        'FOOT_M; three curved graphite fins (90°, 210°, 330°) with kn_anod_plasma tip collars + LED_D8 domes (group 1 '
        'tips) cradling the Ø 0.09 orb. Orb on PIVOT__orb_lift (z slide 0-0.020, resting centre z 0.115) > '
        'PIVOT__orb_spin (z, continuous): kn_anod_graphite body, kn_powder_plasma polar caps, plasma meridian ribs, '
        'kn_led equator seam (group 0). 12 kn_led mode-ring segments on the plinth top (group 2). PR-M power in, name '
        'plate. Footprint h 1.5 cells: the resting orb tops out at z 0.160 (0.180 lifted; brief 0.18). '
        'Brief: docs/art/briefs/future.md#grav-well.',
        MASTERS, led_groups='0:seam,1:tips,2:mode_ring', skins='graphite,lab_white',
        hints={'kn_field_radius': 5.0})
    part.pivot('orb_lift', (0, 0, ORB_Z), 'z', 0.0, 0.020, motion='slide')
    part.pivot('orb_spin', (0, 0, ORB_Z), 'z', motion='turn')
    _m2.nest(part, 'orb_spin', 'orb_lift')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('0', (W, W, PL_Z1), (0, 0, PL_Z1 / 2), phys='powder', restitution=0.2, friction=0.5)
    for i, deg in enumerate(ARMS, 1):
        a = math.radians(deg)
        p0 = Vector((0.083 * math.cos(a), 0.083 * math.sin(a), 0.058))
        p1 = Vector((0.060 * math.cos(a), 0.060 * math.sin(a), 0.090))
        mid = (p0 + p1) / 2
        part.col_capsule(str(i), 0.0075, (p1 - p0).length + 0.015, tuple(mid), tuple((p1 - p0).normalized()),
                         phys='powder')
    orb_col = part.col_sphere('4', ORB_R, (0, 0, ORB_Z), phys='steel', restitution=0.3, friction=0.3)
    _m2.under(part, orb_col, 'orb_lift')
    part.port('power', 'in', PORT, (0, -1, 0), 'M', 'in')
    part.emit('field', 'orb', (0, 0, 0.135), (0, 0, 1))
    for name, deg in zip(('a', 'b', 'c'), ARMS):
        part.emit('arc', 'tip_' + name, tuple(tip_point(deg)), tuple((Vector((0, 0, ORB_Z)) - tip_point(deg))))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
