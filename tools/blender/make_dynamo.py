"""Procedurally build the DYNAMO source file (docs/art/briefs/drive.md, "DYNAMO: Flywheel generator").

Usage: blender -b --factory-startup -P tools/blender/make_dynamo.py -- [out.blend]
Default output: assets/src/drive/dynamo.blend

The MOTOR's big sibling (same build as make_motor.py: pillowed graphite end caps with a 7 mm bevel, a solid
kn_poly_clear shell between them, FOOT_BAR5 rubber bars under the caps, steel button heads on the cap fronts)
at 3x2x2: left cap x -0.124...-0.084, shell x -0.084...0.066, right cap x 0.066...0.150 (84 mm, a 70 mm flat
for the PR-L power ring), all centred at z 0.100. Under PIVOT__rotor (axis x, on the spin port): the spoked
Ignition flywheel (Ø 0.17 x 0.024 at x -0.136, 5 spokes), the chrome shaft and the 4-pole rotor (Ø 0.09 x
0.12, Ignition / graphite poles alternating). Static inside the shell: 6 fat copper coil bobbins (steel pole
shoes and flanges, held by two steel stator rings) with kn_led spacer strips between them (led group 0
coil_glow). Status LED_D8 dome on the left cap (group 1 status), SCR_BAR_10_X15 meter recessed in the right
cap top, M8 heads on the cap fronts, name plate on the right cap front, rotating-parts pictogram on the left.
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

TYPE = 'dynamo'
CZ = 0.100                                   # rotor axis height
CAP_H = 0.19                                 # caps 0.19 x 0.19 (Y x Z), z 0.005...0.195
LCAP = (-0.124, -0.084)                      # left cap x range
RCAP = (0.066, 0.150)                        # right cap x range
SHELL_X = (-0.084, 0.066)
SHELL_YZ = 0.175
FLY_X, FLY_R, FLY_T = -0.136, 0.085, 0.024   # flywheel centre x, radius, thickness
ROTOR_R, ROTOR_L = 0.045, 0.12
ROTOR_C = (SHELL_X[0] + SHELL_X[1]) / 2      # -0.009
COIL_X = (ROTOR_C - 0.048, ROTOR_C + 0.048)
SPIN_PORT = (-0.151, 0.0, CZ)
POWER_PORT = (0.108, -0.096, CZ)
SCR_W, SCR_H = 0.084, 0.021                  # SCR_BAR_10_X15 quad
SCR_C = (0.108, 0.0, 0.196)                  # quad centre (brief), recessed bezel in the cap top
SCR_DEPTH, SCR_BORDER = 0.009, 0.006
STATUS = (-0.104, -0.05, CAP_H / 2 + CZ)     # LED_D8 on the left cap top
G, IGN, STEEL, COPPER, CHROME, POLY, RUBBER, LED, SCREEN, GLASS = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed', 'kn_copper', 'kn_chrome', 'kn_poly_clear',
    'kn_rubber', 'kn_led', 'kn_screen', 'kn_glass')
MASTERS = [G, IGN, STEEL, COPPER, CHROME, POLY, RUBBER, LED, SCREEN, GLASS, 'kn_decal']
AXIS = kit.at(0, 0, CZ) @ kit.X_AXIS         # local z = +X, local (x, y) = Blender (y, z), on the rotor axis


def led_group(c, n):
    return (1, 0.08) if c.x < LCAP[1] + 0.002 else (0, 0.08)


def radial(a, r, x):
    """Basis (tangent, +X, radial) at angle a round the rotor axis, origin at radius r and axial x."""
    u = Vector((0.0, math.cos(a), math.sin(a)))
    t = Vector((0.0, -math.sin(a), math.cos(a)))
    m = Matrix((t, Vector((1, 0, 0)), u)).transposed().to_4x4()
    return Matrix.Translation(Vector((x, 0.0, CZ)) + u * r) @ m


def sector(r0, r1, a0, a1, n):
    """Annular sector outline (CCW) in the local xy plane."""
    outer = [(r1 * math.cos(a0 + (a1 - a0) * i / n), r1 * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    m = max(1, n // 3)
    inner = [(r0 * math.cos(a1 - (a1 - a0) * i / m), r0 * math.sin(a1 - (a1 - a0) * i / m)) for i in range(m + 1)]
    return outer + inner


def screws(k, q, lod):
    n = (0, -1, 0)
    y = -CAP_H / 2
    for x in (RCAP[0] + 0.016, RCAP[1] - 0.016):
        for z in (CZ - 0.076, CZ + 0.076):
            _m2.screw(k, 'M8', (x, y, z), n, q, lod)
    for z in (CZ - 0.076, CZ + 0.076):
        _m2.screw(k, 'M8', ((LCAP[0] + LCAP[1]) / 2, y, z), n, q, lod)


def flywheel(k, q, lod):
    """Spoked Ignition flywheel about the rotor axis (local z of AXIS = +X)."""
    n = seg(64, q, 12)
    x0, x1 = FLY_X - FLY_T / 2, FLY_X + FLY_T / 2 - 0.003   # 3 mm clear of the left cap face
    bev = (0.003, 0.0025, 0.0015, 0.0)[lod]
    rim_in = FLY_R - 0.016
    if lod < 3:
        prof = [(rim_in + 0.002, x0, IGN), (FLY_R - bev, x0, IGN), (FLY_R, x0 + bev, IGN), (FLY_R, x1 - bev, IGN),
                (FLY_R - bev, x1, IGN), (rim_in + 0.002, x1, IGN), (rim_in, x1 - 0.002, IGN),
                (rim_in, x0 + 0.002, IGN)]
        k.lathe(prof, n, AXIS, closed=True)
        if lod < 2:  # raised outer bead and inner lip so the rim reads chunky
            k.torus(FLY_R - 0.004, 0.0035, IGN, n, (6, 4)[lod], m=AXIS @ kit.at(0, 0, x0 + 0.002))
    else:
        k.lathe([(rim_in, x0, IGN), (FLY_R, x0, IGN), (FLY_R, x1, IGN), (rim_in, x1, IGN)], n, AXIS, closed=True)
    hub_r = 0.026
    k.cyl(hub_r, FLY_X - FLY_T / 2 + 0.001, LCAP[0], IGN, seg(40, q, 10), bev=(0.003, 0.002, 0.0, 0.0)[lod],
          bseg=(3, 2, 1, 1)[lod], m=AXIS)
    cs = (3, 2, 1, 0)[lod]
    for i in range(5):
        a = math.pi / 2 + 2 * math.pi * i / 5
        d = Vector((0.0, math.cos(a), math.sin(a)))
        r0, r1 = hub_r - 0.004, rim_in + 0.004
        c = Vector((FLY_X - 0.0015, 0.0, CZ)) + d * ((r0 + r1) / 2)
        t = Vector((0.0, -math.sin(a), math.cos(a)))
        m = Matrix.Translation(c) @ Matrix((t, Vector((1, 0, 0)), d)).transposed().to_4x4()
        k.rbox((0.016, FLY_T - 0.007, r1 - r0), (0, 0, 0), 0.004 if lod < 3 else 0.0, IGN, cseg=cs, m=m, rz=0.0)


def build(lod, q, mats):
    cseg = (4, 3, 2, 1)[lod]
    body = Kit()
    body.colors['led'] = _m2.led_attr(led_group)
    # caps (MOTOR build, 7 mm pillowed bevel) and shell (into the caps so no seam opens at the bevels)
    for x0, x1 in (LCAP, RCAP):
        body.rbox((x1 - x0, CAP_H, CAP_H), ((x0 + x1) / 2, 0, CZ), 0.007, G, cseg=cseg)
    if lod < 3:
        body.rbox((SHELL_X[1] - SHELL_X[0] + 0.02, SHELL_YZ, SHELL_YZ), (ROTOR_C, 0, CZ), 0.012, POLY, cseg=cseg)
    else:  # LOD3: shell opaque (copper drum read), interior dropped
        body.rbox((SHELL_X[1] - SHELL_X[0] + 0.02, SHELL_YZ, SHELL_YZ), (ROTOR_C, 0, CZ), 0.006, COPPER, cseg=1)
    # FOOT_BAR5 under each cap
    for (x0, x1), w in ((LCAP, 0.022), (RCAP, 0.03)):
        _m2.foot_bar(body, 0.15, (x0 + x1) / 2, 0.0, q, lod, h=0.005, w=w, along='y')
    screws(body, q, lod)
    # static bearing collar on the flywheel hub (PR-L spin ring land, Ø 64 mm)
    body.cyl(0.032, SPIN_PORT[0], SPIN_PORT[0] + 0.006, STEEL, seg(48, q, 10),
             bev=(0.0015, 0.001, 0.0, 0.0)[lod], bseg=(2, 1, 1, 1)[lod], m=AXIS)
    if lod < 3:  # thrust collar where the shaft leaves the left cap
        body.cyl(0.016, LCAP[0] - 0.003, LCAP[0] + 0.001, STEEL, seg(32, q, 8), m=AXIS)
    # stator: 6 copper bobbins on steel pole shoes, steel flanges, two steel stator rings, LED spacer strips
    if lod < 2:
        for i in range(6):
            a = math.pi / 2 + 2 * math.pi * i / 6
            span = math.radians(22)
            body.lathe_arc([(0.049, COIL_X[0], STEEL), (0.054, COIL_X[0], STEEL), (0.054, COIL_X[1], STEEL),
                            (0.049, COIL_X[1], STEEL)], a - span, a + span, max(2, seg(6, q, 2)),
                           m=AXIS)
            xm = (COIL_X[0] + COIL_X[1]) / 2
            body.rbox((0.034, COIL_X[1] - COIL_X[0] - 0.006, 0.022), (0, 0, 0), 0.007, COPPER,
                      cseg=max(1, cseg - 1), m=radial(a, 0.0655, xm))
            if lod == 0:  # winding grooves: three thin bands proud of the block
                for dx in (-0.028, 0.0, 0.028):
                    body.rbox((0.0355, 0.004, 0.0205), (0, 0, 0), 0.0065, COPPER, cseg=2, rz=0.0015,
                              m=radial(a, 0.0655, xm + dx))
            # outer bobbin flange: an open steel frame round the winding so the copper stays visible
            body.ring_sweep(kit.outline_rrect(0.041, COIL_X[1] - COIL_X[0] + 0.002, 0.006, max(1, cseg - 1)),
                            [(-0.0035, -0.0015), (0.0, -0.0015), (0.0, 0.0015), (-0.0035, 0.0015)], STEEL,
                            m=radial(a, 0.0775, xm))
            b = a + math.pi / 6  # LED spacer strip between this coil and the next
            body.rbox((0.0045, COIL_X[1] - COIL_X[0] - 0.012, 0.005), (0, 0, 0), 0.002, LED, cseg=max(1, cseg - 2),
                      m=radial(b, 0.072, xm))
        rs = seg(56, q, 12)
        for x in (COIL_X[0] - 0.0035, COIL_X[1] + 0.0005):
            body.lathe([(0.050, x, STEEL), (0.0805, x, STEEL), (0.0805, x + 0.003, STEEL), (0.050, x + 0.003, STEEL)],
                       rs, AXIS, closed=True)
    elif lod == 2:  # LOD2: coils -> one copper ring block, LED strips kept as flat bars
        rs = seg(36, q, 10)
        body.lathe([(0.049, COIL_X[0], COPPER), (0.079, COIL_X[0], COPPER), (0.079, COIL_X[1], COPPER),
                    (0.049, COIL_X[1], COPPER)], rs, AXIS, closed=True)
        for i in range(6):
            b = math.pi / 2 + 2 * math.pi * i / 6 + math.pi / 6
            body.rbox((0.005, COIL_X[1] - COIL_X[0] - 0.012, 0.004), (0, 0, 0), 0.0, LED, cseg=0,
                      m=radial(b, 0.0795, (COIL_X[0] + COIL_X[1]) / 2))
    # status LED_D8 dome on the left cap top (group 1)
    _m2.led_dome(body, 8, STATUS, (0, 0, 1), q, lod)
    # SCR_BAR_10_X15 on the right cap top, long axis along Y; image up = -X so the bar fills front -> back
    n, up = Vector((0, 0, 1)), Vector((-1, 0, 0))
    surf = (SCR_C[0], SCR_C[1], SCR_C[2] - (SCR_DEPTH - 0.0015))
    c = _m2.screen_bezel(body, mats, SCR_W, SCR_H, surf, n, up, lod, q, depth=SCR_DEPTH, border=SCR_BORDER)

    rotor = Kit(pivot='PIVOT__rotor')
    flywheel(rotor, q, lod)
    rotor.cyl(0.006, FLY_X - FLY_T / 2 + 0.002, ROTOR_C + ROTOR_L / 2 + 0.008, CHROME, seg(16, q, 6),
              bev=0.0008 if lod < 2 else 0.0, bseg=1, m=AXIS)
    if lod < 3:
        x0, x1 = ROTOR_C - ROTOR_L / 2, ROTOR_C + ROTOR_L / 2
        ns = seg(12, q, 3)
        gap = math.radians((4, 4, 6, 6)[lod])
        for p in range(4):
            a0 = math.pi / 4 + p * math.pi / 2 + gap / 2
            a1 = a0 + math.pi / 2 - gap
            rotor.prism(sector(0.012, ROTOR_R, a0, a1, ns), x0 + 0.003, x1 - 0.003, IGN if p % 2 == 0 else G,
                        bt=(0.003, 0.002, 0.0, 0.0)[lod], bb=(0.003, 0.002, 0.0, 0.0)[lod], bseg=(2, 1, 1, 1)[lod],
                        m=AXIS)
        rotor.cyl(0.013, x0, x1, STEEL, seg(24, q, 6), m=AXIS)
        if lod < 2:  # steel end plates
            for xa in (x0, x1 - 0.003):
                rotor.cyl(0.040, xa, xa + 0.003, STEEL, seg(48, q, 10), bev=0.0008 if lod == 0 else 0.0, bseg=1,
                          m=AXIS)
    pieces = {'body': body, 'rotor': rotor,
              'screen': kit.screen_quad(c, n, up, SCR_W, SCR_H, lift=0.0002)}
    fy = -CAP_H / 2
    decals = [
        kit.decal_plane('name.dynamo.bone', ((RCAP[0] + RCAP[1]) / 2, fy, CZ + 0.052), (0, -1, 0), (0, 0, 1), 0.05),
        kit.decal_plane('picto.rotating_parts.mono', ((LCAP[0] + LCAP[1]) / 2, fy, CZ), (0, -1, 0), (0, 0, 1),
                        0.022, 0.022),
    ]
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'L', '3,2,2', 4.5, 'bottom', 18000,
        'Flywheel generator: the MOTOR build (caps, solid clear shell, FOOT_BAR5 feet, steel heads) at 3x2x2. '
        'Brief: docs/art/briefs/drive.md#dynamo. PIVOT__rotor (x, on the spin port) carries the 5-spoke Ignition '
        'flywheel, chrome shaft and the 4-pole rotor; 6 copper bobbins with kn_led spacer strips (coil_glow) stay '
        'static. SCR_BAR_10_X15 recessed in the right cap top (bezel 2.5 mm proud so the quad sits at the brief '
        'z 0.196), image up -X so the bar fills front to back. Flywheel faces stop 3 mm short of the left cap. '
        'LOD2 coils -> copper ring block; LOD3 shell opaque (kn_copper drum read, interior dropped). Decals: name '
        'plate on the right cap front, rotating-parts mono pictogram on the left cap front. Shell thickness map '
        'deferred (no unique textures).',
        MASTERS, led_groups='0:coil_glow,1:status')
    part.pivot('rotor', SPIN_PORT, 'x')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('body', (RCAP[1] - LCAP[0], CAP_H, CAP_H), ((RCAP[1] + LCAP[0]) / 2, 0, CZ), phys='powder',
                 restitution=0.25, friction=0.5)
    part.col_cyl('flywheel', FLY_R, FLY_T, (FLY_X, 0, CZ), 'x', phys='powder', restitution=0.25, friction=0.5)
    part.port('spin', 'in', SPIN_PORT, (-1, 0, 0), 'L', 'in', kind='axle')
    part.port('power', 'out', POWER_PORT, (0, -1, 0), 'L', 'out', max_links=4)
    part.emit('spark', 'shell', (0.0, 0.0, 0.190), (0, 0, 1))
    c = Vector(SCR_C)
    part.screen('output', SCR_W, SCR_H, tuple(c + Vector((0, 0, 0.0002))), (0, 0, 1), (-1, 0, 0), kind='bar',
                cells=10, color='power')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
