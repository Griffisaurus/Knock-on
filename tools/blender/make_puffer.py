"""Procedurally build the PUFFER source file (docs/art/briefs/air.md, "PUFFER: Spring bellows").

Usage: blender -b --factory-startup -P tools/blender/make_puffer.py -- [out.blend]
Default output: assets/src/air/puffer.blend

A chunky bellows lying on its belly: a Bone bottom board (x -0.14...0.10, z 0.004-0.026) on four FOOT_M bumpers
with a rubber-grip lower handle lip at its back end, a Bone nozzle block at the front carrying the brass hinge pin
(0.10, 0, 0.09, along Y), the Bone nozzle collar with its kn_led band (group 0 puff) and the steel nozzle cone to
the tip (0.15, 0, 0.055). The Beam top board (0.24 x 0.18 x 0.02) with the 0.12 x 0.12 rubber-grip strike pad and
the upper handle hangs on PIVOT__lid (axis y at the hinge, 0 = open 18°, -14 = closed) and is modelled at the 0
(open) rest pose. Four rubber pleats per side are an all-quad zigzag skin swept round the open sides and back
(modelled at rest; shape key sk_squash folds them with the lid), and a chrome coil spring stands behind them under the lid's far
end (shape key sk_spring). Baked clip puffer__squeeze: 0.35 s lid wobble.
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

TYPE = 'puffer'
OPEN = 18.0                               # lid elevation at the rest pose (pivot angle 0)
HINGE = Vector((0.10, 0.0, 0.09))
BOARD_X0, BOARD_X1, BOARD_Z0, BOARD_Z1, HALF_W = -0.14, 0.10, 0.004, 0.026, 0.09
LID_L, LID_T = 0.24, 0.02
BLOCK = (0.060, 0.124, 0.020, 0.078)      # nozzle block x0, x1, z0, z1
NOZ_Z, TIP_X = 0.055, 0.15
SPRING_X = -0.122
PLEAT_BACK, PLEAT_Y = -0.104, 0.084
BONE, BEAM, RUBBER, STEEL, GRIP, CHROME, BRASS, LED = (
    'kn_powder_bone', 'kn_powder_beam', 'kn_rubber', 'kn_steel_brushed', 'kn_rubber_grip', 'kn_chrome', 'kn_brass',
    'kn_led')
MASTERS = [BONE, BEAM, RUBBER, STEEL, GRIP, CHROME, BRASS, LED, 'kn_decal']


def lid_m():
    """Lid frame at rest: lid-local x runs from the hinge (0) back toward -X, z up; raised OPEN degrees."""
    return kit.at(*HINGE) @ Matrix.Rotation(math.radians(OPEN), 4, 'Y')


def lid_pt(lx, ly, lz):
    return lid_m() @ Vector((lx, ly, lz))


def lid_under_z(x):
    """World z of the lid underside at world x (rest pose)."""
    a = math.radians(OPEN)
    return HINGE.z - (LID_T / 2) / math.cos(a) + (HINGE.x - x) * math.tan(a)


CLOSED = -14.0                            # lid pivot at full squeeze


def follow_lid(co):
    """sk_squash / sk_spring at 1: each vertex turns about the hinge (axis +Y) by the closed lid angle scaled by
    its height between the bottom board (0) and the rest-pose lid underside (1), so the pleats and the coil fold
    with the lid while their bottoms stay on the board."""
    zt = lid_under_z(co.x)
    w = min(1.0, max(0.0, (co.z - BOARD_Z1) / max(1e-6, zt - BOARD_Z1)))
    r = Matrix.Rotation(math.radians(CLOSED * w), 3, 'Y')
    return HINGE + r @ (co - HINGE)


def led_group(_c, _n):
    return 0, 0.08


# ---------------------------------------------------------------- pleats

def pleat_path(nc, side_cuts, back_cuts):
    """U path (x, y, outward normal) round the bellows: -Y side from the block back, the back end, +Y side."""
    r = 0.012
    x_end = BLOCK[0] + 0.006
    out = []

    def line(p0, p1, nrm, n, skip_first):
        for i in range(0 if not skip_first else 1, n + 1):
            t = i / n
            out.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, nrm))

    cx = PLEAT_BACK + r
    line((x_end, -PLEAT_Y), (cx, -PLEAT_Y), (0, -1), side_cuts, False)
    for k in range(1, nc + 1):  # corner -Y / back
        a = -math.pi / 2 - math.pi / 2 * k / nc
        out.append((cx + r * math.cos(a), -PLEAT_Y + r + r * math.sin(a), (math.cos(a), math.sin(a))))
    line((PLEAT_BACK, -PLEAT_Y + r), (PLEAT_BACK, PLEAT_Y - r), (-1, 0), back_cuts, True)
    for k in range(1, nc + 1):  # corner back / +Y
        a = math.pi - math.pi / 2 * k / nc
        out.append((cx + r * math.cos(a), PLEAT_Y - r + r * math.sin(a), (math.cos(a), math.sin(a))))
    line((cx, PLEAT_Y), (x_end, PLEAT_Y), (0, 1), side_cuts, True)
    return out


def pleats(k, folds, nc, side_cuts, back_cuts, mat=RUBBER):
    """Closed all-quad bellows skin: a zigzag section (folds outward peaks) with a 2.5 mm wall swept along the U
    path, its height running from the bottom board to the lid underside at the rest pose; flat end caps."""
    bm = k.bm
    mi = k.mi(mat)
    levels = 2 * folds
    rings = []
    for x, y, (nx, ny) in pleat_path(nc, side_cuts, back_cuts):
        zb, zt = BOARD_Z1 - 0.002, lid_under_z(x) + 0.002
        outer, inner = [], []
        for j in range(levels + 1):
            f = j / levels
            off = 0.007 if j % 2 == 1 else -0.003
            z = zb + (zt - zb) * f
            outer.append((x + nx * off, y + ny * off, z))
            inner.append((x + nx * (off - 0.0025), y + ny * (off - 0.0025), z))
        sec = outer + list(reversed(inner))
        rings.append([bm.verts.new(p) for p in sec])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        # end caps as quads between the outer and inner skins (keeps the skin all-quad)
        h = n // 2
        for j in range(h - 1):
            vs = (ring[j], ring[j + 1], ring[n - 2 - j], ring[n - 1 - j])
            f = bm.faces.new(tuple(reversed(vs)) if rev else vs)
            f.material_index = mi


# ---------------------------------------------------------------- build

def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    base = Kit()
    xc = (BOARD_X0 + BOARD_X1) / 2
    base.rbox((BOARD_X1 - BOARD_X0, 2 * HALF_W, BOARD_Z1 - BOARD_Z0), (xc, 0, (BOARD_Z0 + BOARD_Z1) / 2),
              0.010 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    # lower handle: rubber-grip lip along the back edge
    hl = Kit()
    hl.cyl(0.0075, -0.075, 0.075, GRIP, seg(14, q, 5), bev=0.006 if lod < 2 else 0.0, bseg=(3, 2, 1, 1)[lod],
           m=kit.frame((BOARD_X0 + 0.0065, 0, 0.0155), 'y'))
    base.merge(hl)
    hl.free()
    for x in (-0.112, 0.07):  # FOOT_M x 4
        for y in (-0.065, 0.065):
            _m2.foot(base, 'M', x, y, min(1.0, q * 0.7), lod, z0=0.0, top=0.0008)
    # nozzle block + static hinge knuckle + pin
    bx0, bx1, bz0, bz1 = BLOCK
    base.rbox((bx1 - bx0, 2 * HALF_W - 0.004, bz1 - bz0), ((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2),
              0.008 if lod < 3 else 0.0, BONE, cseg=cs, rz=0.006 if lod < 3 else 0.0)
    base.rbox((0.016, 0.068, HINGE.z - bz1 + 0.002), (HINGE.x, 0, (bz1 + HINGE.z) / 2 - 0.001),
              0.003 if lod < 3 else 0.0, BONE, cseg=max(1, cs - 1), rz=0.0)
    base.cyl(0.0075, -0.034, 0.034, BONE, seg(16, q, 6), bev=0.0012 if lod < 2 else 0.0, bseg=1,
             m=kit.frame(HINGE, 'y'))
    base.cyl(0.0035, -0.089, 0.089, BRASS, seg(12, q, 5), m=kit.frame(HINGE, 'y'))
    if lod < 3:
        for s in (-1, 1):  # pin heads
            base.cyl(0.0052, 0.0, 0.0022, BRASS, seg(14, q, 6), bev=0.0008 if lod < 2 else 0.0, bseg=1,
                     m=kit.frame(HINGE + Vector((0, s * 0.0875, 0)), (0, s, 0)))
    # nozzle: Bone collar with an LED band, then the steel cone to the tip
    nm = kit.frame((0, 0, NOZ_Z), 'x')
    ns = seg(28, q, 6)
    base.cyl(0.0165, bx1 - 0.003, bx1 + 0.007, BONE, ns, bev=0.0015 if lod < 2 else 0.0, bseg=(2, 1, 1, 1)[lod],
             m=nm)
    band = [(0.0163, bx1 + 0.0015, LED), (0.0172, bx1 + 0.0025, LED), (0.0172, bx1 + 0.0045, LED),
            (0.0163, bx1 + 0.0055, LED)] if lod < 3 else [(0.0166, bx1 + 0.0015, LED), (0.0172, bx1 + 0.0055, LED),
                                                         (0.0166, bx1 + 0.0055, LED)]
    base.lathe(band, ns, nm, closed=True)
    cone = [(0.0, bx1 + 0.006, STEEL), (0.0125, bx1 + 0.006, STEEL)]
    if lod < 2:
        cone += [(0.0128, bx1 + 0.009, STEEL), (0.0118, bx1 + 0.011, STEEL)]
    cone += [(0.0048, TIP_X - 0.0025, STEEL), (0.0056, TIP_X - 0.0015, STEEL), (0.0056, TIP_X, STEEL),
             (0.0030, TIP_X, STEEL), (0.0030, TIP_X - 0.006, STEEL), (0.0, TIP_X - 0.006, STEEL)]
    if lod >= 3:
        cone = [(0.0, bx1 + 0.006, STEEL), (0.0125, bx1 + 0.006, STEEL), (0.0055, TIP_X, STEEL), (0.0, TIP_X, STEEL)]
    base.lathe(cone, ns, nm)
    base.colors['led'] = _m2.led_attr(led_group)
    # pleats (all quads) and the spring behind them
    pleat = Kit()
    if lod < 3:
        pleats(pleat, 4, (4, 2, 1, 1)[lod], (6, 3, 1, 1)[lod], (4, 2, 1, 1)[lod])
    else:
        pleats(pleat, 2, 1, 1, 1)
    spring = Kit()
    _m2.coil(spring, 0.0085, 0.0017, BOARD_Z1 - 0.001, lid_under_z(SPRING_X) + 0.001, 6.0, CHROME, q, lod,
             m=kit.at(SPRING_X, 0, 0))
    if lod < 3:  # spring seats
        spring.cyl(0.0105, BOARD_Z1 - 0.0005, BOARD_Z1 + 0.0015, CHROME, seg(16, q, 6),
                   bev=0.0006 if lod < 2 else 0.0, bseg=1, m=kit.at(SPRING_X, 0, 0))

    # ---- lid (PIVOT__lid), modelled at rest (open 18°)
    lid = Kit(pivot='PIVOT__lid')
    lm = lid_m()
    lid.rbox((LID_L - 0.006, 2 * HALF_W, LID_T), (-(LID_L + 0.006) / 2, 0, 0), 0.010 if lod < 3 else 0.0, BEAM,
             cseg=cs, rz=0.004 if lod < 3 else 0.0, m=lm)
    for s in (-1, 1):  # lid knuckles round the pin
        lid.cyl(0.0075, 0.0, 0.048, BEAM, seg(16, q, 6), bev=0.0012 if lod < 2 else 0.0, bseg=1,
                m=lm @ kit.frame((0, s * 0.037, 0), (0, s, 0)))
    # strike pad with raised grip ribs
    pad_c = -0.13
    lid.rbox((0.12, 0.12, 0.006), (pad_c, 0, LID_T / 2 + 0.002), 0.008 if lod < 3 else 0.0, GRIP,
             cseg=max(1, cs - 1), rz=0.0018 if lod < 2 else 0.0, m=lm)
    if lod < 2:
        for i in range(-3, 4):
            lid.rbox((0.0055, 0.104, 0.0034), (pad_c + i * 0.0145, 0, LID_T / 2 + 0.005), 0.0025, GRIP,
                     cseg=(2, 1)[lod], rz=0.0012, m=lm)
    # upper handle: rubber-grip bar on two Beam posts at the far end
    hx = -0.226
    for s in (-1, 1):
        lid.cyl(0.0042, LID_T / 2 - 0.001, 0.024, BEAM, seg(10, q, 5), bev=0.0, m=lm @ kit.at(hx, s * 0.055, 0))
    lid.cyl(0.0068, -0.072, 0.072, GRIP, seg(14, q, 5), bev=0.005 if lod < 2 else 0.0, bseg=(3, 2, 1, 1)[lod],
            m=lm @ kit.frame((hx, 0, 0.0235), 'y'))

    if lod < 2:
        pleat.shape_keys['sk_squash'] = (follow_lid, '0 = open rest (lid 18°); 1 = lid closed (pivot -14): the pleats '
                                         'fold down with the lid, bottom edge fixed on the board', 0.0)
        spring.shape_keys['sk_spring'] = (follow_lid, '0 = open rest; 1 = lid closed (pivot -14): the coil compresses '
                                          'under the lid, seat fixed on the board', 0.0)
    pieces = {'base': base, 'pleats': pleat, 'spring': spring, 'lid': lid}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.puffer.graphite', ((bx0 + bx1) / 2, -(HALF_W - 0.002), (bz0 + bz1) / 2 - 0.004),
                        (0, -1, 0), (0, 0, 1), 0.045),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'air', 'M', '3,2,2', 1.6, 'bottom', 7000,
        'Spring bellows on its belly: Bone boards and nozzle block, Beam lid with a rubber-grip strike pad and '
        'handles, 4 rubber pleats per side (all quads), chrome spring, steel nozzle with an LED collar band. '
        'Brief: docs/art/briefs/air.md#puffer. Lid modelled at its 0 (open 18°) rest pose; PIVOT__lid -14 closes '
        'it. Baked clip puffer__squeeze (0.35 s lid wobble). Decals: name plate on the nozzle block front. '
        'Shape keys sk_squash (pleats) and sk_spring (coil) follow the lid to -14 (LOD0/1). Deferred: the pleat wobble / nozzle flutter part of '
        'the clip (needs them), Workshop oak skin. The lower handle lip reaches x -0.141 so the bounds centre '
        'stays inside 5 mm of the origin (no kn_bounds override).',
        MASTERS, led_groups='0:puff')
    part.pivot('lid', tuple(HINGE), 'y', -14.0, 0.0, motion='turn')
    part.build_lods(build, lod0_q=1.2)
    part.col_box('base', (BOARD_X1 - BOARD_X0, 2 * HALF_W, BOARD_Z1), ((BOARD_X0 + BOARD_X1) / 2, 0, BOARD_Z1 / 2),
                 phys='powder', restitution=0.2, friction=0.5)
    lid_pts = [tuple(lid_pt(x, y, z)) for x in (-LID_L, -0.004) for y in (-HALF_W, HALF_W)
               for z in (-LID_T / 2, LID_T / 2 + 0.005)]
    lid_pts += [tuple(lid_pt(-0.226, y, 0.030)) for y in (-0.075, 0.075)]
    part.col_hull('lid', lid_pts, phys='powder', restitution=0.15, friction=0.8, pivot='lid')
    bx0, bx1, bz0, bz1 = BLOCK
    noz = [(x, y, z) for x in (bx0, bx1) for y in (-HALF_W + 0.002, HALF_W - 0.002) for z in (bz0, bz1)]
    noz += [(TIP_X, 0.0056 * math.cos(a), NOZ_Z + 0.0056 * math.sin(a)) for a in
            (2 * math.pi * i / 8 for i in range(8))]
    part.col_hull('nozzle', noz, phys='powder', restitution=0.2, friction=0.5)
    pad = [tuple(lid_pt(x, y, z)) for x in (-0.19, -0.07) for y in (-0.06, 0.06)
           for z in (LID_T / 2 + 0.005, LID_T / 2 + 0.025)]
    part.sensor('trigger', 'pad', pad, threshold=0.02, cooldown=0.15, pivot='lid')
    part.emit('wind', 'nozzle', (TIP_X, 0, NOZ_Z), (1, 0, 0))
    _m2.clip(part, 'squeeze', {'lid': [(0.0, 0.0), (0.05, -14.0), (0.10, -10.0), (0.15, -13.0), (0.20, -10.5),
                                       (0.25, -12.0), (0.30, -6.0), (0.35, 0.0)]})
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
