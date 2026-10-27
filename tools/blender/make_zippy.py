"""Procedurally build the ZIPPY source file (docs/art/briefs/fun.md, "ZIPPY: Signal-driven RC buggy").

Usage: blender -b --factory-startup -P tools/blender/make_zippy.py -- [out.blend]
Default output: assets/src/fun/zippy.blend

A stubby toy RC buggy (free body, origin = centre of mass 0.035 above the ground; nose at +X): a kn_powder_graphite
chassis tub (0.18 x 0.07 x 0.04) with an open rear bay showing the kn_steel_brushed motor can with kn_copper windings
and the kn_anod_volt spur gear (PIVOT__spur, y), graphite bumpers (headlight domes, group 0; tail bars, group 1; the
PR-S tension `tow` hook ring facing -X), a kn_powder_ignition wedge shell with a raked windscreen and a roof flat for
the PR-S signal `go` ring (status dome, group 2) on PIVOT__shell_roll (x, ±6°), a whippy graphite antenna with an
Ø 8 mm ignition ball on PIVOT__antenna, and four Ø 0.06 x 22 mm kn_rubber_grip tyres with real knobs on graphite hubs
(PIVOT__wheel_fl/fr/rl/rr, y; the fronts nested under PIVOT__steer_fl/fr, z ±25°). Tyre bottoms touch z -0.035.
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

TYPE = 'zippy'
G, IGN, GRIP, STEEL, COPPER, VOLT, LED = ('kn_powder_graphite', 'kn_powder_ignition', 'kn_rubber_grip',
                                          'kn_steel_brushed', 'kn_copper', 'kn_anod_volt', 'kn_led')
MASTERS = [G, IGN, GRIP, STEEL, COPPER, VOLT, LED]
GROUND = -0.035
WR, WW, WX, WY, WZ = 0.030, 0.022, 0.065, 0.0375, -0.005
WHEELS = {'fl': (WX, WY), 'fr': (WX, -WY), 'rl': (-WX, WY), 'rr': (-WX, -WY)}
TUB = (0.18, 0.07, 0.04, 0.005)          # size x, y, z and centre z
PORT_GO, PORT_TOW = (0.010, 0.0, 0.046), (-0.100, 0.0, 0.0)
ANT = Vector((-0.060, 0.025, 0.015))
SPUR = Vector((-0.065, 0.016, 0.0))
MOTOR = Vector((-0.071, -0.008, 0.010))
SHELL_STATIONS = [  # x, half width, z bottom, z top
    (0.074, 0.028, 0.016, 0.023), (0.050, 0.0375, 0.015, 0.032), (0.016, 0.0375, 0.015, 0.045),
    (-0.032, 0.0375, 0.015, 0.045), (-0.050, 0.034, 0.015, 0.039)]


def tyre(k, c, lod, q):
    """Knobbly tyre + hub along local Y at centre c."""
    m = kit.frame(tuple(c), 'y')
    n = seg(32, q, 6, 2)
    if lod >= 3:
        k.cyl(WR, -WW / 2, WW / 2, GRIP, n, m=m)
        return
    base = WR - 0.004 if lod < 2 else WR - 0.0015
    prof = [(0.0175, -WW / 2 + 0.002), (0.0215, -WW / 2), (base - 0.003, -WW / 2), (base, -WW / 2 + 0.003),
            (base, WW / 2 - 0.003), (base - 0.003, WW / 2), (0.0215, WW / 2), (0.0175, WW / 2 - 0.002)]
    k.lathe([(r, z, GRIP) for r, z in prof], n, m=m, closed=True)
    if lod < 2:
        nk = (18, 12)[lod]
        for row, (z0, off) in enumerate(((-0.0052, 0.0), (0.0052, 0.5))):
            for i in range(nk):
                a = 2 * math.pi * (i + off) / nk
                d = Vector((math.cos(a), math.sin(a), 0.0))
                t = Vector((-math.sin(a), math.cos(a), 0.0))
                bm = Matrix((d, t, Vector((0, 0, 1)))).transposed().to_4x4()
                kc = d * (WR - 0.0025) + Vector((0, 0, z0))  # knob tops on the Ø 0.06 tread line
                k.rbox((0.005, 0.0065, 0.0095), (0, 0, 0), 0.0, GRIP, cseg=1, m=m @ Matrix.Translation(kc) @ bm)
    # hub: dished graphite wheel with a steel nut
    k.cyl(0.0185, -WW / 2 + 0.003, WW / 2 - 0.003, G, n, bev=0.0015 if lod < 2 else 0.0, bseg=1, m=m)
    if lod < 2:
        for s in (-1, 1):
            k.cyl(0.004, 0.0, 0.0015, STEEL, 6, m=kit.frame(tuple(c + Vector((0, s * (WW / 2 - 0.0035), 0))),
                                                            (0, s, 0)))


def shell_points(cs):
    pts = []
    for x, hw, z0, z1 in SHELL_STATIONS:
        r = min(0.007, (z1 - z0) / 2 - 0.0005)
        for py, pz in kit.outline_rrect(2 * hw, z1 - z0, r, cs):
            pts.append((x, py, (z0 + z1) / 2 + pz))
    return pts


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    tub = Kit()
    sx, sy, sz, cz = TUB
    tub.rbox((sx, sy, sz), (0, 0, cz), 0.010 if lod < 3 else 0.004, G, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    if lod < 3:  # open rear bay
        import bmesh
        bmesh.ops.triangulate(tub.bm, faces=[f for f in tub.bm.faces if len(f.verts) > 4])
        bay = Kit()
        bay.rbox((0.05, 0.056, 0.04), (-0.072, 0, 0.012), 0.004, G, cseg=1, rz=0.0)
        tub = kit.boolean_diff(tub, [bay], mats)
    body = tub
    # bumpers
    body.rbox((0.012, 0.062, 0.022), (0.094, 0, 0.001), 0.005 if lod < 3 else 0.0, G, cseg=max(1, cs - 1),
              rz=0.003 if lod < 3 else 0.0)
    body.rbox((0.012, 0.066, 0.030), (-0.094, 0, 0.0), 0.005 if lod < 3 else 0.0, G, cseg=max(1, cs - 1),
              rz=0.003 if lod < 3 else 0.0)
    for s in (-1, 1):
        _m2.led_dome(body, 8, (0.0998, s * 0.025, 0.012), (1, 0, 0), q, lod)
        if lod < 3:
            body.rbox((0.0016, 0.012, 0.005), (-0.1003, s * 0.028, 0.0125), 0.0, LED, cseg=1)
    _m2.land(body, 'S', PORT_TOW, (-1, 0, 0), 0.0, lod, mat=G, base=(-0.0995, 0.0, 0.0))
    # rear bay contents: motor can (steel end bells, copper windings), pinion, spur gear post
    if lod < 3:
        mm = kit.frame(tuple(MOTOR), 'y')
        body.cyl(0.010, -0.015, -0.009, STEEL, seg(16, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1, m=mm)
        body.cyl(0.0085, -0.009, 0.009, COPPER, seg(16, q, 6), m=mm)
        if lod < 2:
            for z in (-0.006, -0.002, 0.002, 0.006):
                body.torus(0.0088, 0.0011, COPPER, seg(16, q, 6), 4, m=mm @ kit.at(0, 0, z))
        body.cyl(0.010, 0.009, 0.015, STEEL, seg(16, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=mm)
        body.cyl(0.0035, 0.015, 0.024, STEEL, seg(8, q, 5), m=mm)
        body.cyl(0.0022, 0.0, ANT.z - 0.002 - (-0.010), G, seg(8, q, 5), m=kit.at(ANT.x, ANT.y, -0.010))
    # rear axle stub through the spur
    body.cyl(0.0022, -WY + WW / 2, WY - WW / 2, STEEL, seg(8, q, 5), m=kit.frame((-WX, 0, WZ), 'y'))
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.25) if c.x > 0.09 else (1, 0.08))
    # shell (ignition wedge) on the roll pivot, windscreen, roof land, status dome
    shell = Kit(pivot='PIVOT__shell_roll')
    shell.hull(shell_points(cs), IGN)
    a, b = Vector((0.050, 0.0, 0.032)), Vector((0.016, 0.0, 0.045))
    along = (b - a).normalized()
    nrm = Vector((0, 1, 0)).cross(along).normalized()
    if nrm.z < 0:
        nrm = -nrm
    ws_c = (a + b) / 2 + nrm * 0.0004
    basis = Matrix((along, Vector((0, 1, 0)), nrm)).transposed().to_4x4()
    shell.rbox(((b - a).length * 0.82, 0.056, 0.0012), (0, 0, 0), 0.004 if lod < 3 else 0.0, G, cseg=1,
               m=Matrix.Translation(ws_c) @ basis)
    _m2.land(shell, 'S', PORT_GO, (0, 0, 1), 0.001, lod, mat=IGN)
    _m2.led_dome(shell, 6, (-0.020, 0.0, 0.045), (0, 0, 1), q, lod)
    shell.colors['led'] = _m2.led_attr(lambda c, nn: (2, 0.08))
    pieces = {'body': body, 'shell': shell}
    # wheels: fronts under steer, all under their spin pivots
    for name, (x, y) in WHEELS.items():
        w = Kit(pivot='PIVOT__wheel_' + name)
        tyre(w, Vector((x, y, WZ)), lod, q)
        pieces['wheel_' + name] = w
    spur = Kit(pivot='PIVOT__spur')
    if lod < 3:
        nt = seg(24, q, 10, 2)
        pts = []
        for i in range(nt * 2):
            r = 0.0135 if i % 2 == 0 else 0.0118
            a_ = math.pi * i / nt
            pts.append((r * math.cos(a_), r * math.sin(a_)))
        spur.prism(pts, -0.0025, 0.0025, VOLT, m=kit.frame(tuple(SPUR), 'y'))
        spur.cyl(0.004, -0.004, 0.004, STEEL, seg(10, q, 5), m=kit.frame(tuple(SPUR), 'y'))
    else:
        spur.cyl(0.0128, -0.0025, 0.0025, VOLT, 8, m=kit.frame(tuple(SPUR), 'y'))
    pieces['spur'] = spur
    ant = Kit(pivot='PIVOT__antenna')
    ant.cyl(0.00075, ANT.z, 0.058, G, (6, 5, 4, 3)[lod], m=kit.at(ANT.x, ANT.y, 0))
    ant.sphere(0.004, IGN, seg(14, q, 6), seg(7, q, 4), m=kit.at(ANT.x, ANT.y, 0.058))
    pieces['antenna'] = ant
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.zippy.bone', (-0.012, -0.0376, 0.031), (0, -1, 0), (0, 0, 1), 0.036, lift=0.0004,
                        pivot='PIVOT__shell_roll'),
        kit.decal_plane('name.zippy.bone', (-0.012, 0.0376, 0.031), (0, 1, 0), (0, 0, 1), 0.036, lift=0.0004,
                        pivot='PIVOT__shell_roll'),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'M', '2,1,1', 0.8, 'com', 8500,
        'Signal-driven RC buggy (free body, Jolt vehicle; origin = COM 0.035 above the ground; nose +X): '
        'kn_powder_graphite chassis tub (0.18 x 0.07 x 0.04) with an open rear bay (steel motor can, copper windings, '
        'kn_anod_volt spur gear on PIVOT__spur, y), graphite bumpers (headlights LED_D8 group 0, tail bars group 1, '
        'PR-S tension `tow` hook ring -X), kn_powder_ignition wedge shell with raked windscreen and roof land for the '
        'PR-S signal `go` ring, status dome (group 2), on PIVOT__shell_roll (x, ±6°); graphite whip antenna with an '
        'ignition ball on PIVOT__antenna (spring sway x/y ±20°, `axes = xy`); four Ø 0.06 x 22 mm kn_rubber_grip '
        'tyres with 2 x 18 knobs on graphite hubs, PIVOT__wheel_fl/fr/rl/rr (y), fronts nested under '
        'PIVOT__steer_fl/fr (z ±25°); tyre bottoms at z -0.035. COL: chassis + shell boxes, COL__wheel__0-3 (fl, fr, '
        'rl, rr). Brief: docs/art/briefs/fun.md#zippy.',
        MASTERS, led_groups='0:headlights,1:tail,2:status', skins='ignition,cobalt,plasma')
    for name, (x, y) in WHEELS.items():
        if name in ('fl', 'fr'):
            part.pivot('steer_' + name, (x, y, WZ), 'z', -25.0, 25.0, motion='turn')
        part.pivot('wheel_' + name, (x, y, WZ), 'y')
    for name in ('fl', 'fr'):
        _m2.nest(part, 'wheel_' + name, 'steer_' + name)
    part.pivot('shell_roll', (0.0, 0.0, 0.015), 'x', -6.0, 6.0, motion='turn')
    part.pivot('spur', tuple(SPUR), 'y')
    part.pivot('antenna', tuple(ANT), 'x', -20.0, 20.0, motion='turn', axes='xy')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.0)
    sx, sy, sz, cz = TUB
    part.col_box('0', (sx, sy, sz), (0, 0, cz), phys='powder', restitution=0.2, friction=0.5)
    part.col_box('1', (0.14, 0.075, 0.03), (0, 0, 0.030), phys='powder', restitution=0.2, friction=0.5)
    for i, name in enumerate(('fl', 'fr', 'rl', 'rr')):
        x, y = WHEELS[name]
        _m4.wheel_col(part, str(i), WR, WW, (x, y, WZ), phys='rubber', friction=1.1, wheel=name)
    part.sensor('trigger', 'bumper_front', [(x, y, z) for x in (0.100, 0.120) for y in (-0.035, 0.035)
                                            for z in (-0.02, 0.03)], threshold=0.1)
    part.port('signal', 'go', PORT_GO, (0, 0, 1), 'S', 'in')
    part.port('tension', 'tow', PORT_TOW, (-1, 0, 0), 'S', 'both', kind='hook')
    part.emit('dust', 'wheel_rl', (-WX, WY, GROUND), (-1, 0, 0))
    part.emit('dust', 'wheel_rr', (-WX, -WY, GROUND), (-1, 0, 0))
    part.emit('spark', 'underbody', (0, 0, -0.015), (0, 0, -1))
    part.emit('horn', 'nose', (0.095, 0, 0.010), (1, 0, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
