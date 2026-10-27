"""Procedurally build the SCOOP source file (docs/art/briefs/frame.md, "SCOOP: Bucket").

Usage: blender -b --factory-startup -P tools/blender/make_scoop.py -- [out.blend]
Default output: assets/src/frame/scoop.blend

A tapered Bone bucket, origin bottom centre: outer Ø 0.16 at the bottom, Ø 0.20 at the rim (z 0.18) with a Ø 10 mm
rolled bead, 4 mm wall, a 5 mm rubber base ring, and Cobalt base and rim bands (0.8 mm proud). Cobalt bail lugs at
(+-0.10, 0, 0.165), one M3 each. The Ø 6 mm steel bail (rubber-grip sleeves either side of a Cobalt hook block) hangs
on PIVOT__bail (axis x through the lugs, -80..+80) and is modelled at its rest pose, -75° (lying back toward +Y
over the back rim); prop rest = -75. Upright, the hook block face is 0.10 above the pivot, at (0, 0, 0.265).
PORT__tension__bail sits on the hook block face at the rest pose, (0, 0.097, 0.191), facing outward along the bail
apex; ports cannot ride a pivot in this pipeline, so it stays at the rest pose. Inside: graphite fill-mark ticks
every 0.5 L on the inner back wall and the CAVITY__contents frustum (matter fill, 3.5 L). Name plate (graphite on
Bone) on the front wall.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import geom, kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'scoop'
R0, TAPER = 0.080, 0.1063              # outer wall radius r_o(z) = R0 + TAPER * z (Ø 0.16 at the floor)
WALL = 0.004
Z_BOT, Z_FLOOR = 0.004, 0.008          # outer bottom (on the rubber ring) / inner floor top
BEAD_C, BEAD_R = (0.095, 0.180), 0.005  # rolled bead: outer edge at r 0.100 (Ø 0.20)
BANDS = ((0.008, 0.030), (0.145, 0.170))  # Cobalt base / rim bands (z), 0.8 mm proud
BAND_PROUD = 0.0008
PIVOT = Vector((0.0, 0.0, 0.165))
REST = -75.0
BAIL_R = 0.003
BAIL_U, BAIL_V0 = 0.104, 0.012         # bail side legs (u = |x|), shoulder height above the pivot
BAIL_APEX = 0.092                      # wire centreline at the apex; the hook block face is at 0.100
BAIL_P = 3.0
HOOK = (0.030, 0.014, 0.026)           # hook block (u, v, w): face 0.100 above the pivot
CAV_INSET = 0.0035
CAP_L = 3.5
BONE, COBALT, STEEL, GRIP, RUBBER, CLEAR = ('kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed',
                                            'kn_rubber_grip', 'kn_rubber', 'kn_poly_clear')
MASTERS = [BONE, COBALT, STEEL, GRIP, RUBBER, CLEAR, 'kn_decal']
PORT_POS = (0.0, 0.097, 0.191)
# Outward along the bail apex at the rest pose (+Z of the upright bail turned -75° about X). NOTE: the
# m2_parts.test.ts pin expects +Z here; flip PORT_FACING to (0, 0, 1) if the test is the contract.
PORT_FACING = (0.0, math.sin(math.radians(-REST)), math.cos(math.radians(-REST)))


def r_o(z):
    return R0 + TAPER * z


def r_i(z):
    return r_o(z) - WALL


def r_c(z):
    return r_i(z) - CAV_INSET


def bail_m():
    """Bail local (u, w, v) = (x, y, z) about the pivot, upright, then turned to the rest pose."""
    return kit.at(*PIVOT) @ kit.rot_x(REST)


def ellipse_pts(t0, t1, n):
    """Bail centreline (u, 0, v) on a superellipse (exponent BAIL_P) from the shoulder (t 0) to the apex (t pi/2):
    squarer than an ellipse so the resting bail clears the rolled bead (>= 0.5 mm)."""
    a, b = BAIL_U, BAIL_APEX - BAIL_V0
    out = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        c, s = math.cos(t), math.sin(t)
        out.append((a * math.copysign(abs(c) ** (2 / BAIL_P), c), 0.0, BAIL_V0 + b * abs(s) ** (2 / BAIL_P)))
    return out


def ellipse_t(u):
    """Parameter t of the superellipse point with |u| = u."""
    return math.acos((u / BAIL_U) ** (BAIL_P / 2))


def body_profile(lod, q):
    """Closed revolve (poles at both ends): outer skin with banded steps, the rolled bead, the inner wall, floor.
    LOD2+ fold the rubber base ring into the profile (a rubber bottom strip) and paint the bands flush."""
    if lod < 2:
        prof = [(0.0, Z_BOT, BONE), (R0 - 0.004, Z_BOT, BONE), (R0 - 0.0012, Z_BOT + 0.0008, BONE),
                (r_o(0.0068), 0.0068, BONE)]
    else:
        prof = [(0.0, 0.0, RUBBER), (R0 - 0.002, 0.0, RUBBER), (r_o(0.006), 0.006, BONE)]
    for z0, z1 in BANDS:
        if lod < 2:
            prof += [(r_o(z0), z0, COBALT), (r_o(z0) + BAND_PROUD, z0 + 0.0002, COBALT),
                     (r_o(z1) + BAND_PROUD, z1, BONE)]
        else:
            prof += [(r_o(z0), z0, COBALT), (r_o(z1), z1, BONE)]
    na = (5, 4, 4, 2)[lod]
    a0, a1 = math.radians(-40), math.radians(220)
    for k in range(na + 1):
        a = a0 + (a1 - a0) * k / na
        prof.append((BEAD_C[0] + BEAD_R * math.cos(a), BEAD_C[1] + BEAD_R * math.sin(a), BONE))
    prof += [(r_i(0.170), 0.170, BONE), (r_i(0.012), 0.012, BONE)]
    if lod < 3:
        prof += [(r_i(0.012) - 0.0012, Z_FLOOR + 0.0008, BONE), (r_i(0.012) - 0.004, Z_FLOOR, BONE)]
    prof.append((0.0, Z_FLOOR, BONE))
    return kit.dedupe(prof)


def tick(z, width, h=0.0018, lift=0.0003):
    """Graphite tape tick on the inner back wall, facing the camera (-Y), image right = +X, up = +Z."""
    rows = []
    for zz in (z - h / 2, z + h / 2):
        r = r_i(zz) - lift
        span = width / r
        rows.append([Vector((r * math.sin(-span / 2 + span * i / 4), r * math.cos(-span / 2 + span * i / 4), zz))
                     for i in range(5)])
    return kit.decal_grid(rows, kit.atlas_rect('trim.tape_graphite', (0.40, 0.30, 0.60, 0.70)))


def cavity_volume(z):
    """Litres of the cavity frustum from its floor up to z."""
    z0 = Z_FLOOR + CAV_INSET
    if z <= z0:
        return 0.0
    a, b = r_c(z0), r_c(z)
    return math.pi * (z - z0) / 3 * (a * a + a * b + b * b) * 1000.0


def fill_heights():
    out = []
    for k in range(1, 8):
        v = 0.5 * k
        lo, hi = Z_FLOOR, 0.2
        for _ in range(50):
            mid = (lo + hi) / 2
            if cavity_volume(mid) < v:
                lo = mid
            else:
                hi = mid
        if lo < 0.168:  # stays below the rolled lip
            out.append((v, lo))
    return out


def build(lod, q):
    n = seg(48, q, (8, 8, 6, 5)[lod])
    body = Kit()
    body.lathe(body_profile(lod, q), n)
    if lod < 2:  # 5 mm rubber base ring (LOD2+: folded into the body profile)
        prof = [(0.070, 0.0), (0.0795, 0.0), (0.081, 0.0015), (0.081, 0.0065)]
        body.lathe([(r, z, RUBBER) for r, z in prof], n, closed=True)
    # bail lugs (Cobalt, on the rim band), one M3 each below the pivot
    if lod < 3:
        for s in (-1, 1):
            body.rbox((0.012, 0.018, 0.026), (s * 0.0975, 0, 0.163), 0.003 if lod < 2 else 0.0, COBALT,
                      cseg=1)
            _m2.screw(body, 'M3', (s * 0.1035, 0, 0.1555), (s, 0, 0), q, lod)

    bail = Kit(pivot='PIVOT__bail')
    m = bail_m()
    sides = (5, 4, 4, 3)[lod]
    if lod == 3:  # one sweep over the whole bail
        k = seg(2, q, 1)
        half = ellipse_pts(0, math.pi / 2, k)
        path = [(p[0], p[1], p[2] - BAIL_V0 * (1 - i / k)) for i, p in enumerate(half)]
        path = path + [(-p[0], p[1], p[2]) for p in reversed(path[:-1])]
        bail.sweep([tuple(m @ Vector(p)) for p in path], BAIL_R, sides, STEEL)
    else:
        na = seg(10, q, 3)
        for s in (-1, 1):
            arc = ellipse_pts(0, math.pi / 2, na)
            if s < 0:
                arc = [(-p[0], p[1], p[2]) for p in arc]
            path = [(s * 0.096, 0.0, 0.0), (s * BAIL_U, 0.0, 0.0), (s * BAIL_U, 0.0, BAIL_V0 * 0.5)] + arc
            bail.sweep([tuple(m @ Vector(p)) for p in path], BAIL_R, sides, STEEL)
            if lod < 2:  # pin through the lug
                bail.cyl(BAIL_R, -0.006, 0.006, STEEL, seg(10, q, 4),
                         m=kit.frame(PIVOT + Vector((s * 0.099, 0, 0)), 'x'))
                # rubber-grip sleeve beside the hook block
                t0, t1 = ellipse_t(0.050), ellipse_t(0.017)
                sl = ellipse_pts(t0, t1, seg(5, q, 2))
                if s < 0:
                    sl = [(-p[0], p[1], p[2]) for p in sl]
                bail.sweep([tuple(m @ Vector(p)) for p in sl], BAIL_R + 0.0018, sides + 1, GRIP)
    hc = (0.0, 0.0, 0.100 - HOOK[1] / 2)
    bail.rbox((HOOK[0], HOOK[2], HOOK[1]), hc, 0.004 if lod < 3 else 0.0, COBALT, cseg=(2, 1, 1, 0)[lod],
              rz=0.003 if lod < 2 else 0.0, m=m)

    decals = [kit.decal_cylinder('name.scoop.graphite', (0, 0, 0.088), (0, 0, 1), r_o(0.088), (0, -1, 0), 0.05,
                                 lift=0.0006)]
    for v, z in fill_heights():
        decals.append(tick(z, 0.022 if abs(v - round(v)) < 1e-6 else 0.013))
    return kit.add_decals({'body': body, 'bail': bail}, lod, decals)


def add_cavity(part):
    k = Kit()
    z0, z1 = Z_FLOOR + CAV_INSET, BEAD_C[1] - BEAD_R - 0.0005
    k.lathe([(0.0, z0, CLEAR), (r_c(z0), z0, CLEAR), (r_c(z1), z1, CLEAR), (0.0, z1, CLEAR)], 32)
    ob = geom.object_from_bmesh('CAVITY__contents', k.bm, [part.mats[CLEAR]], template.get_collection('CAVITY'))
    ob['matter'] = 'fill'
    ob['capacity'] = CAP_L
    return ob


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '2,2,2', 0.45, 'bottom', 2300,
        'Bucket: tapered Bone body (Ø 0.16 -> 0.20, rolled Ø 10 bead at z 0.18, 4 mm wall) on a 5 mm rubber ring, '
        'Cobalt base / rim bands and bail lugs (M3 each), Ø 6 steel bail with rubber-grip sleeves and a Cobalt '
        'hook block on PIVOT__bail (axis x, -80..80, modelled at rest -75 lying back toward +Y). Brief: '
        'docs/art/briefs/frame.md#scoop. PORT__tension__bail is placed at the rest pose (0, 0.097, 0.191) facing '
        'outward along the bail apex: ports cannot ride a pivot in this pipeline (the engine must carry it with '
        'PIVOT__bail; upright it is (0, 0, 0.265) +Z). Fill-mark ticks every 0.5 L (graphite tape decals) on the '
        'inner back wall; CAVITY__contents frustum (fill, 3.5 L) inset 3.5 mm. No collider on the bail.',
        MASTERS)
    part.pivot('bail', tuple(PIVOT), 'x', -80.0, 80.0, rest=REST, motion='turn')
    part.build_lods(build, lod0_q=1.2)
    # COL: floor + 8 staves (compound hulls; the bucket moves)
    part.col_hull('floor', [(r * math.cos(2 * math.pi * i / 16), r * math.sin(2 * math.pi * i / 16), z)
                            for i in range(16) for r, z in ((0.080, 0.0), (r_i(Z_FLOOR), Z_FLOOR))],
                  phys='powder', friction=0.5, restitution=0.25)
    for k in range(8):
        pts = []
        for j in range(3):
            a = math.radians(k * 45 - 22.5 + 22.5 * j)
            for z in (Z_BOT, 0.180):
                for r in (r_o(z), r_i(z) - 0.001):
                    pts.append((r * math.cos(a), r * math.sin(a), z))
        part.col_hull('wall_%d' % k, pts, phys='powder', friction=0.5, restitution=0.25)
    bail_port = part.port('tension', 'bail', PORT_POS, PORT_FACING, 'S', 'both', kind='hook')
    bail_port['pivot'] = 'bail'  # rides PIVOT__bail; modelled at rest (-75), parts-data holds the pivot-0 (upright) pose
    pts = []
    for i in range(16):
        a = 2 * math.pi * i / 16
        for r, z in ((0.075, 0.008), (0.090, 0.178)):
            pts.append((r * math.cos(a), r * math.sin(a), z))
    part.sensor('intake', 'mouth', pts, channel='fluid', capacity=CAP_L)
    add_cavity(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
