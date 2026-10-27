"""Procedurally build the FISHBOWL source file (docs/art/briefs/contraptions.md, "FISHBOWL: Goby's glass bowl").

Usage: blender -b --factory-startup -P tools/blender/make_fishbowl.py -- [out.blend]
Default output: assets/src/contraptions/fishbowl.blend

A kn_glass bowl: sphere R 0.15 centred (0, 0, 0.15), 4 mm wall (inner R 0.146), cut flat at z 0.02 (Ø 0.15 base,
4 mm floor, inner floor z 0.024) and open at z 0.285 (Ø 0.13) with a 6 mm outward-rolled lip bead. It sits on a
bone cradle ring (r 0.095, seat hugging the glass, z 0.0055-0.030) on four FOOT_L bumpers. Inside: an Ignition
gravel underlay (z 0.0245-0.0325) under 40 rounded pebbles (24 Ignition, 16 Bone, tops to z ≈ 0.04) and the bone
arch ornament (60 x 45 mm above the gravel, spanning Y at x 0.07, top z 0.085). CAVITY__water (matter water,
capacity 12.5 L) is the inner glass inset 3.5 mm, up to the lip plane. FRAC__01-21: 18 curved wall shards
(3 tilted bands of 5 / 6 / 7 sectors, narrower toward -Y), the base disc with a 25 mm wall stub and two lip halves,
all closed meshes with kn_interior_glass cut faces. Name plate + fragile pictogram on the cradle front.
"""
import math
import os
import random
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import geom, kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'fishbowl'
C, R, T = 0.15, 0.15, 0.004            # sphere centre z, outer radius, wall
RI = R - T
Z_BASE, Z_FLOOR, Z_TOP = 0.020, 0.024, 0.285
LIP_R, LIP_r = 0.065, 0.003
CR_R, CR_Z0, CR_Z1 = 0.095, 0.0055, 0.030
BED_Z0, BED_Z1 = 0.0245, 0.0325
ARCH_X, ARCH_T, ARCH_Z0, ARCH_Z1 = 0.07, 0.012, 0.040, 0.085
ARCH_YAW = -20.0                       # turned so the opening reads from the front 3/4 (legs stay inside the glass)
ARCH_LEG_Z = 0.0355
GLASS, IGLASS, BONE, IGN, RUBBER, POLY = ('kn_glass', 'kn_interior_glass', 'kn_powder_bone', 'kn_powder_ignition',
                                          'kn_rubber', 'kn_poly_clear')
MASTERS = [GLASS, IGLASS, BONE, IGN, RUBBER, POLY, 'kn_decal']


def r_at(rad, z):
    return math.sqrt(max(0.0, rad * rad - (z - C) ** 2))


def sphere_arc(rad, z0, z1, n, mat):
    p0, p1 = math.asin((z0 - C) / rad), math.asin((z1 - C) / rad)
    return [(rad * math.cos(p0 + (p1 - p0) * i / n), C + rad * math.sin(p0 + (p1 - p0) * i / n), mat)
            for i in range(n + 1)]


def glass_profile(n):
    """Pole-to-pole closed profile of the bowl wall + floor (outer up, across the rim, inner down)."""
    prof = [(0.0, Z_BASE, GLASS)]
    prof += sphere_arc(R, Z_BASE, Z_TOP, n, GLASS)
    prof += sphere_arc(RI, Z_TOP, Z_FLOOR, n, GLASS)
    prof.append((0.0, Z_FLOOR, GLASS))
    return kit.dedupe(prof)


def glass_kit(lod, q):
    k = Kit()
    segs = seg(56, q, 10)
    k.lathe(glass_profile(seg(24, q, 4)), segs)
    k.torus(LIP_R, LIP_r, GLASS, segs, seg(8, q, 4) if lod < 3 else 4, m=kit.at(0, 0, Z_TOP + 0.0005))
    return k


def cradle(k, lod, q):
    n = seg(56, q, 10)
    seat = []
    for i in range(4 if lod < 2 else 2):
        r = 0.090 - (0.090 - 0.0752) * i / (3 if lod < 2 else 1)
        seat.append((r, C - math.sqrt((R + 0.0006) ** 2 - r * r)))
    prof = [(0.050, CR_Z0), (0.089, CR_Z0)]
    if lod < 2:
        prof += [(0.093, CR_Z0 + 0.0012), (CR_R, CR_Z0 + 0.004), (CR_R, 0.025), (0.0935, 0.0285), (0.0905, CR_Z1)]
    else:
        prof += [(CR_R, CR_Z0 + 0.003), (CR_R, 0.026), (0.0905, CR_Z1)]
    prof += seat
    prof += [(0.050, seat[-1][1])]
    k.lathe([(r, z, BONE) for r, z in prof], n, closed=True)
    for a in (45, 135, 225, 315):
        _m2.foot(k, 'L', 0.072 * math.cos(math.radians(a)), 0.072 * math.sin(math.radians(a)), q, lod)


def arch_outline(n):
    """Arch in (y, z): legs 14 mm wide, outer radius 0.030, inner 0.016, CCW."""
    zl = ARCH_Z1 - 0.030
    pts = [(-0.030, ARCH_LEG_Z), (-0.016, ARCH_LEG_Z), (-0.016, zl)]
    for i in range(1, n):
        a = math.pi - math.pi * i / n
        pts.append((0.016 * math.cos(a), zl + 0.016 * math.sin(a)))
    pts += [(0.016, zl), (0.016, ARCH_LEG_Z), (0.030, ARCH_LEG_Z), (0.030, zl)]
    for i in range(1, n):
        a = math.pi * i / n
        pts.append((0.030 * math.cos(a), zl + 0.030 * math.sin(a)))
    pts.append((-0.030, zl))
    return pts


def pebbles():
    """40 seeded pebble placements (x, y, z, radius, sx, sy, sz, yaw, master), clear of the arch legs."""
    rng = random.Random(11)
    out = []
    while len(out) < 40:
        a, rr = rng.uniform(0, 2 * math.pi), 0.077 * math.sqrt(rng.random())
        x, y = rr * math.cos(a), rr * math.sin(a)
        if any((x - p[0]) ** 2 + (y - p[1]) ** 2 < 0.0128 ** 2 for p in out):
            continue
        a_ = math.radians(ARCH_YAW)
        legs = [(ARCH_X - s * math.sin(a_), s * math.cos(a_)) for s in (-0.023, 0.023)]
        if any((x - lx) ** 2 + (y - ly) ** 2 < 0.012 ** 2 for lx, ly in legs):
            continue
        r = rng.uniform(0.0062, 0.0082)
        sz = rng.uniform(0.55, 0.7)
        out.append((x, y, BED_Z1 - 0.0015 + r * sz * 0.85, r, rng.uniform(1.0, 1.3), rng.uniform(0.85, 1.0), sz,
                    rng.uniform(0, 180), IGN if len(out) % 5 in (0, 2, 4) else BONE))
    return out


PEBBLES = pebbles()


def build(lod, q):
    bowl = glass_kit(lod, q)
    base = Kit()
    cradle(base, lod, q)
    # gravel: Ignition underlay + pebbles, bone arch
    inner = Kit()
    n = seg(48, q, 8)
    inner.lathe([(0.0, BED_Z0, IGN), (r_at(RI, BED_Z0) - 0.0005, BED_Z0, IGN), (r_at(RI, BED_Z1) - 0.001, BED_Z1, IGN),
                 (0.0, BED_Z1, IGN)], n)
    if lod < 3:
        ps = PEBBLES if lod < 2 else PEBBLES[::2]
        for x, y, z, r, sx, sy, sz, yaw, mat in ps:
            m = kit.at(x, y, z) @ kit.rot_z(yaw) @ Matrix.Diagonal((sx, sy, 1.0, 1.0))
            inner.sphere(r, mat, seg(12, q, 5), seg(6, q, 3), m=m, sz_top=sz, sz_bot=sz * 0.8)
    bev = 0.002 if lod < 2 else 0.0
    inner.prism(arch_outline(seg(10, q, 3)), ARCH_X - ARCH_T / 2, ARCH_X + ARCH_T / 2, BONE, bt=bev, bb=bev,
                bseg=1, m=kit.at(ARCH_X, 0, 0) @ kit.rot_z(ARCH_YAW) @ kit.at(-ARCH_X, 0, 0) @ kit.X_AXIS)
    pieces = {'bowl': bowl, 'cradle': base, 'gravel': inner}
    # cradle front: name plate (graphite on bone) + fragile pictogram to its left
    zc = 0.0185
    decals = [kit.decal_cylinder('name.fishbowl.graphite', (0, 0, zc), (0, 0, 1), CR_R, (0, -1, 0), 0.05, nu=8),
              kit.decal_cylinder('picto.fragile.warn', (0, 0, zc), (0, 0, 1), CR_R, (-0.5, -0.866, 0), 0.011, 0.011,
                                 nu=3)]
    return kit.add_decals(pieces, lod, decals)


# ---------------------------------------------------------------- fracture (FRAC__01-21)

def cut(k, co, no, inner_mi, bridge=False):
    """Keep the side of closed kit k behind plane (co, no); cap the cut (bridged annulus or n-gon fills) with
    the interior master."""
    bm = k.bm
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-7,
                                 plane_co=co, plane_no=no, clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    if bridge:
        faces = bmesh.ops.bridge_loops(bm, edges=edges)['faces']
    else:
        faces = bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
    for f in faces:
        f.material_index = inner_mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return k


def shell_copy(lod_q=1.0):
    k = glass_kit(0, lod_q)
    k.mi(IGLASS)
    return k


def tilted(z, tilt, az):
    t, a = math.radians(tilt), math.radians(az)
    return (0.0, 0.0, z), Vector((math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t)))


BANDS = [tilted(0.045, 0, 0), tilted(0.120, 8, 30), tilted(0.195, 6, 200), tilted(0.270, 0, 0)]
SECTORS = (5, 6, 7)


def sector_angles(n, band):
    """Boundary angles (radians) of n sectors, narrower toward -Y (the impact side) and staggered per band."""
    k = -0.45
    out = []
    for i in range(n):
        u = 2 * math.pi * (i + 0.5 * band) / n
        out.append(-math.pi / 2 + u + k * math.sin(u))
    return out


def frac_chunks(part):
    col = template.get_collection('FRAC')
    chunks = []
    q = 0.8
    for b, n in enumerate(SECTORS):
        angs = sector_angles(n, b)
        for i in range(n):
            a0, a1 = angs[i], angs[(i + 1) % n] + (2 * math.pi if i == n - 1 else 0.0)
            k = shell_copy(q)
            mi = k.mi(IGLASS)
            cut(k, (0, 0, 0), (math.sin(a0), -math.cos(a0), 0), mi)
            cut(k, (0, 0, 0), (-math.sin(a1), math.cos(a1), 0), mi)
            co, nrm = BANDS[b]
            cut(k, co, -nrm, mi)
            co, nrm = BANDS[b + 1]
            cut(k, co, nrm, mi)
            chunks.append(k)
    k = shell_copy(q)  # base disc + 25 mm wall stub
    cut(k, (0, 0, BANDS[0][0][2]), (0, 0, 1), k.mi(IGLASS), bridge=True)
    chunks.append(k)
    for s in (1, -1):  # lip ring halves (wall above z 0.27 + the rolled bead)
        k = shell_copy(q)
        mi = k.mi(IGLASS)
        cut(k, (0, 0, BANDS[-1][0][2]), (0, 0, -1), mi, bridge=True)
        cut(k, (0, 0, 0), (-s, 0, 0), mi)
        chunks.append(k)
    for i, k in enumerate(chunks, 1):
        ob = geom.object_from_bmesh('FRAC__%02d' % i, k.bm, [part.mats[nm] for nm in k.mats], col,
                                    recalc_normals=False)
        geom.set_sharp_by_angle(ob.data, 40)
    return len(chunks)


# ---------------------------------------------------------------- helpers objects

def bowl_points(rings=7, n=9, grow=1.0):
    pts = []
    zs = [Z_BASE + (Z_TOP + LIP_r - Z_BASE) * i / (rings - 1) for i in range(rings)]
    f = (1.0 + 1.0 / math.cos(math.pi / n)) / 2 * grow
    for j, z in enumerate(zs):
        r = r_at(R, min(z, Z_TOP)) if z <= Z_TOP else LIP_R + LIP_r
        if j == rings - 1:
            r = LIP_R + LIP_r
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * (j % 2)) / n
            pts.append((r * f * math.cos(a), r * f * math.sin(a), z))
    return pts


def cavity(part):
    k = Kit()
    ri = RI - 0.0035
    prof = [(0.0, Z_FLOOR + 0.0035, POLY)] + sphere_arc(ri, Z_FLOOR + 0.0035, Z_TOP, 16, POLY) + [(0.0, Z_TOP, POLY)]
    k.lathe(kit.dedupe(prof), 32)
    ob = geom.object_from_bmesh('CAVITY__water', k.bm, [part.mats[POLY]], template.get_collection('CAVITY'))
    ob['matter'] = 'water'
    ob['capacity'] = 12.5
    return ob


def main(out_path=None):
    part = kit.Part(
        TYPE, 'contraptions', 'L', '3,3,3', 15.0, 'bottom', 15000,
        "Goby's glass bowl: 4 mm kn_glass sphere shell (R 0.15, cut at z 0.02 / open at 0.285 with a rolled lip) on "
        'a bone cradle with four FOOT_L bumpers, Ignition gravel bed + 40 Ignition / bone pebbles, bone arch at '
        'x 0.07. Brief: docs/art/briefs/contraptions.md#fishbowl. CAVITY__water: matter water, capacity 12.5 L '
        '(mesh volume ≈ 11.9 L after the 3.5 mm inset; level plane is engine-driven). FRAC__01-18 wall shards '
        '(3 bands x 5/6/7 sectors, narrower toward -Y; they run 60-160 mm, larger than the brief\'s 30-90 mm '
        'because 18 pieces must tile the whole wall), FRAC__19 base disc + 25 mm stub, FRAC__20-21 lip halves, '
        'inner faces kn_interior_glass. Name plate + fragile pictogram on the cradle front. Deferred: thickness '
        'map / 1024 detail set, .frac.glb hulls, cavity fill LUT, Goby device sockets (RIG).',
        MASTERS, skins='classic,tropical', hints={'kn_break_impulse': 1.5, 'kn_macro_chunks': 21})
    part.build_lods(build, lod0_q=1.3)
    part.col_hull('bowl', bowl_points(8, 8), phys='glass', restitution=0.1, friction=0.2)
    part.col_cyl('cradle', 0.09, 0.025, (0.0, 0.0, 0.0125), 'z', phys='powder', restitution=0.1, friction=0.5)
    part.sensor('impact', 'bowl', bowl_points(8, 8, 1.01), threshold=1.5)
    part.sensor('intake', 'top', [(0.06 * math.cos(2 * math.pi * i / 12), 0.06 * math.sin(2 * math.pi * i / 12), z)
                                  for i in range(12) for z in (0.27, 0.29)])
    ell = []
    for j in range(1, 6):
        ph = -math.pi / 2 + math.pi * j / 6
        for i in range(10):
            a = 2 * math.pi * (i + 0.5 * (j % 2)) / 10
            ell.append((0.10 * math.cos(ph) * math.cos(a), 0.10 * math.cos(ph) * math.sin(a), 0.15 + 0.075 * math.sin(ph)))
    ell += [(0, 0, 0.075), (0, 0, 0.225)]
    part.sensor('catch', 'swim', ell, critter='goby')
    part.emit('burst', 'water', (0.0, 0.0, 0.14), (0, 0, 1))
    part.emit('spout', 'lip', (0.0, -0.065, 0.285), (0, -1, 0))
    part.emit('bubbles', 'surface', (0.0, 0.0, 0.25), (0, 0, 1))
    cavity(part)
    frac_chunks(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
