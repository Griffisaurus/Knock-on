"""Procedurally build the SPRONG source file (docs/art/briefs/frame.md, "SPRONG: Trampoline").

Usage: blender -b --factory-startup -P tools/blender/make_sprong.py -- [out.blend]
Default output: assets/src/frame/sprong.blend

A low square trampoline, 0.30 x 0.05 x 0.30, origin bottom centre. Four Cobalt rails (0.025 wide x 0.03 tall on
z 0.005-0.035, outer faces at +-0.15) run between four Bone corner blocks (0.04 cube, one M3 on top) that stand
on 5 mm rubber feet. The graphite woven mat (0.20 x 0.20 at z 0.03) hangs on 16 chrome coil springs (4 per side,
coil OD 8 mm, 0.025 long) from steel eyelets to the rail inner faces. Mat, eyelets and springs are one piece
(`mat`) so the `sk_depress` shape key moves them together. Name plate (Bone ink) on the front rail.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'sprong'
W = 0.30
RAIL_W, RAIL_Z0, RAIL_Z1 = 0.025, 0.005, 0.035
RAIL_C = W / 2 - RAIL_W / 2                # 0.1375 rail centreline
RAIL_IN = W / 2 - RAIL_W                   # 0.125 rail inner face
BLOCK, BLOCK_C = 0.04, W / 2 - 0.02        # corner blocks centred at +-0.13
BLOCK_Z0 = 0.005
MAT, MAT_Z, MAT_T = 0.20, 0.030, 0.004
EYE_IN = 0.004                             # eyelet centre inset from the mat edge
SPRING_R, SPRING_WIRE, TURNS = 0.0033, 0.0007, 4.5   # coil OD = 2 * (R + wire) = 8 mm
SPRING_AT = (-0.075, -0.025, 0.025, 0.075)
FABRIC, BONE, COBALT, CHROME, STEEL, RUBBER = ('kn_fabric_graphite', 'kn_powder_bone', 'kn_powder_cobalt',
                                               'kn_chrome', 'kn_steel_brushed', 'kn_rubber')
MASTERS = [FABRIC, BONE, COBALT, CHROME, STEEL, RUBBER, 'kn_decal']


def foot5(k, x, y, q, lod):
    """5 mm domed rubber foot (Ø 16) under a corner block: the brief's 5 mm feet (FOOT_M profile, 5 mm tall)."""
    r, h, top = 0.008, BLOCK_Z0, 0.0006
    if lod >= 3:
        return
    if lod == 2:
        k.prism(kit.outline_circle(r, 8), 0.0, h + top, RUBBER, m=kit.at(x, y, 0))
        return
    fil = 0.0015
    prof = [(0.0, 0.0, RUBBER), (r - fil, 0.0, RUBBER), (r - fil * 0.3, fil * 0.3, RUBBER), (r, fil, RUBBER),
            (r, h + top, RUBBER), (0.0, h + top, RUBBER)]
    k.lathe(prof, seg(16, q, 8), kit.at(x, y, 0))


def spring_frames():
    """(start, direction) of each spring: from the mat eyelet outward to the rail inner face."""
    out = []
    e = MAT / 2 - EYE_IN
    for s in SPRING_AT:
        out += [((s, -e, MAT_Z), (0, -1, 0)), ((s, e, MAT_Z), (0, 1, 0)),
                ((-e, s, MAT_Z), (-1, 0, 0)), ((e, s, MAT_Z), (1, 0, 0))]
    return out


DIP, EDGE_DIP, PULL = 0.022, 0.004, 0.0035
EYE = MAT / 2 - EYE_IN                     # eyelet line (0.096)
SPRING_END = RAIL_IN + 0.0005


def depress(co):
    """sk_depress at 1: the mat dips 0.022 at the centre (cosine bowl down to 4 mm at the eyelet line) and draws
    in 3.5 mm at the eyelets; each spring blends from the eyelet's motion to none at the rail (stretches)."""
    import math
    from mathutils import Vector
    a = max(abs(co.x), abs(co.y))
    if a <= MAT / 2 + 1e-4:
        s = min(1.0, a / EYE)
        dz = -(EDGE_DIP + (DIP - EDGE_DIP) * 0.5 * (1.0 + math.cos(math.pi * s)))
        pull = PULL * s
        dx = -co.x / a * pull if a > 1e-9 else 0.0
        dy = -co.y / a * pull if a > 1e-9 else 0.0
        return co + Vector((dx, dy, dz))
    t = min(1.0, max(0.0, (a - EYE) / (SPRING_END - EYE)))
    w = 1.0 - t
    if abs(co.x) >= abs(co.y):   # spring along X
        return co + Vector((-math.copysign(PULL, co.x) * w, 0.0, -EDGE_DIP * w))
    return co + Vector((0.0, -math.copysign(PULL, co.y) * w, -EDGE_DIP * w))


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(2.4 * q))))
    frame = Kit()
    rr = 0.004 if lod < 3 else 0.0
    span = 2 * (BLOCK_C - BLOCK / 2) + 0.01     # rails run between the corner blocks, ends buried 5 mm
    zc = (RAIL_Z0 + RAIL_Z1) / 2
    for s in (-1, 1):
        frame.rbox((span, RAIL_W, RAIL_Z1 - RAIL_Z0), (0, s * RAIL_C, zc), rr, COBALT, cseg=cs)
        frame.rbox((RAIL_W, span, RAIL_Z1 - RAIL_Z0), (s * RAIL_C, 0, zc), rr, COBALT, cseg=cs)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * BLOCK_C, sy * BLOCK_C
            frame.rbox((BLOCK, BLOCK, BLOCK), (x, y, BLOCK_Z0 + BLOCK / 2), 0.006 if lod < 3 else 0.0, BONE,
                       cseg=cs)
            _m2.screw(frame, 'M3', (x, y, BLOCK_Z0 + BLOCK), (0, 0, 1), q, lod)
            foot5(frame, x, y, q, lod)

    # mat + eyelets + springs: one piece for sk_depress (mat dips 0.022, springs stretch 15 %)
    mat = Kit()
    if lod < 2:  # gridded slab: interior vertices so sk_depress can dip the centre
        _m2.grid_slab(mat, MAT, MAT, MAT_Z - MAT_T / 2, MAT_Z + MAT_T / 2, seg(10, q, 4, 2), FABRIC)
    else:
        mat.rbox((MAT, MAT, MAT_T), (0, 0, MAT_Z), 0.008 if lod < 3 else 0.0, FABRIC, cseg=cs, rz=0.0)
    for (p, d) in spring_frames():
        x, y, z = p
        dx, dy, _ = d
        if lod < 2:  # steel eyelet through the mat edge
            mat.prism(kit.outline_circle(0.0028, seg(8, q, 6)), MAT_Z - MAT_T / 2 - 0.0006,
                      MAT_Z + MAT_T / 2 + 0.0006, STEEL, m=kit.at(x, y, 0))
        z0 = 0.0028                                 # coil starts at the eyelet rim
        z1 = (RAIL_IN + 0.0005) - (MAT / 2 - EYE_IN)  # ... and ends 0.5 mm into the rail inner face
        m = kit.frame(p, d)
        if lod == 0:
            _m2.coil(mat, SPRING_R, SPRING_WIRE, z0, z1, TURNS, CHROME, q, lod, m=m, sides=4,
                     per_turn=seg(6, q, 3))
        elif lod == 1:
            _m2.coil(mat, SPRING_R, SPRING_WIRE, z0, z1, TURNS, CHROME, q, lod, m=m, sides=3,
                     per_turn=seg(6, q, 3))
        elif lod == 2:  # a chrome tube per spring
            mat.cyl(SPRING_R + SPRING_WIRE, z0, z1, CHROME, seg(6, q, 4), m=m)
        else:  # LOD3: a plain chrome prism keeps the "sparkle of springs" at distance
            mat.prism(kit.outline_circle(SPRING_R + SPRING_WIRE, seg(4, q, 3)), z0, z1, CHROME, m=m)

    if lod < 2:
        mat.shape_keys['sk_depress'] = (depress, '0 = rest; 1 = mat centre dipped 0.022 m (to z 0.008), mat edge '
                                        '4 mm, eyelets pulled 3.5 mm inward so the springs stretch ~15 %', 0.0)
    decals = [kit.decal_plane('name.sprong.bone', (0, -W / 2, zc), (0, -1, 0), (0, 0, 1), 0.06)]
    return kit.add_decals({'frame': frame, 'mat': mat}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '3,0.5,3', 1.8, 'bottom', 6500,
        'Trampoline: graphite woven mat (0.20 x 0.20 at z 0.03) on 16 chrome coil springs (4 per side, OD 8 mm, '
        '0.025 long) inside four Cobalt rails and Bone corner blocks (M3 on top) on 5 mm rubber feet. Brief: '
        'docs/art/briefs/frame.md#sprong. Mat, eyelets and springs share the `mat` piece for sk_depress. '
        'Deviations: COL__box__mat restitution is 1.0 (validator range 0..1); the briefed e 1.15 and the 8 m/s '
        'exit cap are props on SENSOR__trigger__mat (exit_restitution, exit_speed_max; not exported yet). '
        'Shape key sk_depress on the mat piece (LOD0/1). Deferred: 1024 woven Normal.',
        MASTERS)
    part.build_lods(build, lod0_q=1.2)
    part.col_box('mat', (MAT, MAT, 0.01), (0, 0, 0.030), phys='rubber', restitution=1.0, friction=0.6)
    zc, h = (RAIL_Z0 + RAIL_Z1) / 2, RAIL_Z1 - RAIL_Z0
    for nm, size, c in (('rail_n', (W, RAIL_W, h), (0, RAIL_C, zc)), ('rail_s', (W, RAIL_W, h), (0, -RAIL_C, zc)),
                        ('rail_e', (RAIL_W, W, h), (RAIL_C, 0, zc)), ('rail_w', (RAIL_W, W, h), (-RAIL_C, 0, zc))):
        part.col_box(nm, size, c, phys='powder', restitution=0.3, friction=0.6)
    z0, z1 = 0.035, 0.115
    part.sensor('trigger', 'mat', [(x * MAT / 2, y * MAT / 2, z) for x in (-1, 1) for y in (-1, 1) for z in (z0, z1)],
                threshold=0.05, exit_restitution=1.15, exit_speed_max=8.0)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
