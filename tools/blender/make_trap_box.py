"""Procedurally build the TRAP BOX source file (docs/art/briefs/frame.md, "TRAP BOX: Drop cage").

Usage: blender -b --factory-startup -P tools/blender/make_trap_box.py -- [out.blend]
Default output: assets/src/frame/trap_box.blend

A chrome-barred drop cage, 0.70 x 0.50 x 0.50, origin bottom centre = the underside of the rim's rubber strip.
Bottom frame: a Cobalt ring 0.020 wide x 0.025 tall inside the 0.02 m wall zone (so the opening stays 0.66 x 0.46
at floor level) on a 4 mm rubber strip. Four Cobalt Ø 20 mm corner posts (centres x +-0.34, y +-0.24) and 44 chrome
Ø 10 mm bars spaced evenly between them: 13 per long side (pitch 0.0486) and 9 per short side (pitch 0.048).
Top frame on z 0.46-0.48: a Cobalt ring with a recessed Bone plate, two Cobalt cross braces meeting at the
Cobalt eye boss (PR-M tension hook ring at (0, 0, 0.492), facing +Z) and four M3 screws on the frame corners.
The Bone critter flag (paw pictogram) lies flat on the plate under PIVOT__flag (axis y, 0 flat .. 90 up).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'trap_box'
W, D = 0.70, 0.50
POST_X, POST_Y, POST_R = 0.34, 0.24, 0.010
BAR_R = 0.005
N_LONG, N_SHORT = 13, 9
STRIP_T = 0.004                         # rubber strip under the bottom ring
RING_Z0, RING_Z1 = STRIP_T, STRIP_T + 0.025
TOP_Z0, TOP_Z1 = 0.46, 0.48
PLATE_TOP = 0.474                       # recessed Bone plate, 6 mm below the frame top
BOSS_R, BOSS_TOP = 0.028, 0.492         # eye boss: flat land Ø 0.056 for the PR-M ring (Ø 0.042)
FLAG_PIVOT = Vector((0.305, -0.15, PLATE_TOP + 0.0025))
FLAG_T = 0.004
CHROME, BONE, COBALT, STEEL, RUBBER = ('kn_chrome', 'kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed',
                                       'kn_rubber')
MASTERS = [CHROME, BONE, COBALT, STEEL, RUBBER, 'kn_decal']


def bar_positions():
    out = []
    for i in range(1, N_LONG + 1):          # long sides (front / back)
        x = -POST_X + 2 * POST_X * i / (N_LONG + 1)
        out += [(x, -POST_Y), (x, POST_Y)]
    for i in range(1, N_SHORT + 1):         # short sides (left / right)
        y = -POST_Y + 2 * POST_Y * i / (N_SHORT + 1)
        out += [(-POST_X, y), (POST_X, y)]
    return out


def rect_frame(k, z0, z1, mat, cs, bev, width=0.020):
    """Rectangular frame ring on the wall-zone centreline (0.68 x 0.48), `width` wide, rounded section."""
    outline = kit.outline_rrect(2 * POST_X, 2 * POST_Y, 0.016, cs)
    hw = width / 2
    if bev > 0:
        prof = [(-hw + bev, z0), (hw - bev, z0), (hw, z0 + bev), (hw, z1 - bev), (hw - bev, z1), (-hw + bev, z1),
                (-hw, z1 - bev), (-hw, z0 + bev)]
    else:
        prof = [(-hw, z0), (hw, z0), (hw, z1), (-hw, z1)]
    k.ring_sweep(outline, prof, mat)


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(2.4 * q))))
    fcs = cs if lod < 3 else 0          # LOD3 frames: sharp 4-corner rings
    bev = (0.003, 0.003, 0.002, 0.0)[lod]
    cage = Kit()
    # bottom frame: rubber strip (LOD3 drops it; the ring keeps the silhouette) + Cobalt ring
    if lod < 3:
        rect_frame(cage, 0.0, STRIP_T + 0.0008, RUBBER, fcs, 0.0012 if lod < 2 else 0.0, width=0.018)
        rect_frame(cage, RING_Z0, RING_Z1, COBALT, fcs, bev)
    else:
        rect_frame(cage, 0.0, RING_Z1, COBALT, fcs, bev)
    # top frame ring + recessed Bone plate + cross braces + eye boss
    rect_frame(cage, TOP_Z0, TOP_Z1, COBALT, fcs, bev)
    cage.rbox((2 * POST_X - 0.004, 2 * POST_Y - 0.004, 0.012), (0, 0, PLATE_TOP - 0.006), 0.012 if lod < 3 else 0.0,
              BONE, cseg=cs, rz=0.0)
    br = 0.003 if lod < 3 else 0.0
    cage.rbox((2 * POST_X - 0.01, 0.03, 0.008), (0, 0, TOP_Z1 - 0.004), br, COBALT, cseg=max(1, cs - 1))
    cage.rbox((0.03, 2 * POST_Y - 0.01, 0.008), (0, 0, TOP_Z1 - 0.004), br, COBALT, cseg=max(1, cs - 1))
    if lod < 3:
        cage.cyl(BOSS_R + 0.006, TOP_Z1 - 0.004, TOP_Z1 + 0.004, COBALT, seg(32, q, 8),
                 bev=0.002 if lod < 2 else 0.0, bseg=max(1, cs - 1))
    cage.cyl(BOSS_R, TOP_Z1, BOSS_TOP, COBALT, seg(32, q, 8), bev=0.003 if lod < 3 else 0.0, bseg=cs)
    if lod < 2:  # four M3 on the top frame corners
        for sx in (-1, 1):
            for sy in (-1, 1):
                _m2.screw(cage, 'M3', (sx * POST_X, sy * POST_Y, TOP_Z1), (0, 0, 1), q, lod)
    # corner posts and bars (ends buried in the frames)
    pz0, pz1 = RING_Z1 - 0.003, TOP_Z0 + 0.003
    for sx in (-1, 1):
        for sy in (-1, 1):
            if lod < 3:
                cage.cyl(POST_R, pz0, pz1, COBALT, seg(20, q, 6), m=kit.at(sx * POST_X, sy * POST_Y, 0))
            else:
                cage.prism(kit.outline_circle(POST_R, seg(6, q, 3)), pz0, pz1, COBALT,
                           m=kit.at(sx * POST_X, sy * POST_Y, 0))
    nb = seg(14, q, 4) if lod < 3 else seg(4, q, 3)
    for x, y in bar_positions():
        cage.prism(kit.outline_circle(BAR_R, nb), pz0, pz1, CHROME, m=kit.at(x, y, 0))

    # the critter flag: hinge barrel, stem and pennant lying flat toward -X on the top plate
    flag = Kit(pivot='PIVOT__flag')
    fz = FLAG_PIVOT.z
    if lod < 3:
        flag.cyl(0.004, -0.016, 0.016, STEEL, seg(12, q, 6), m=kit.at(*FLAG_PIVOT) @ kit.frame((0, 0, 0), 'y'))
    flag.rbox((0.05, 0.012, FLAG_T), (FLAG_PIVOT.x - 0.027, FLAG_PIVOT.y, fz), 0.003 if lod < 3 else 0.0, BONE,
              cseg=max(1, cs - 1), rz=0.0)
    fc = Vector((FLAG_PIVOT.x - 0.095, FLAG_PIVOT.y, fz))
    flag.rbox((0.09, 0.07, FLAG_T), tuple(fc), 0.014 if lod < 3 else 0.0, BONE, cseg=cs,
              rz=0.0015 if lod < 2 else 0.0)
    # pivot leaf on the plate (static): a small Cobalt hinge block under the barrel
    if lod < 3:
        cage.rbox((0.014, 0.036, 0.006), (FLAG_PIVOT.x + 0.004, FLAG_PIVOT.y, PLATE_TOP + 0.002), 0.002, COBALT,
                  cseg=1, rz=0.0)

    n_up, n_dn = (0, 0, 1), (0, 0, -1)
    decals = [
        # name plate on the top frame's front face (Bone ink on Cobalt)
        kit.decal_plane('name.trap_box.bone', (-0.17, -(POST_Y + 0.010), (TOP_Z0 + TOP_Z1) / 2), (0, -1, 0),
                        (0, 0, 1), 0.06),
        # paw pictogram on both flag faces (top: armed read from above; bottom: faces -X when the flag is up)
        kit.decal_plane('picto.critter_friendly.warn', (fc.x, fc.y, fz + FLAG_T / 2), n_up, (1, 0, 0), 0.05, 0.05,
                        pivot='PIVOT__flag'),
        kit.decal_plane('picto.critter_friendly.warn', (fc.x, fc.y, fz - FLAG_T / 2), n_dn, (1, 0, 0), 0.05, 0.05,
                        pivot='PIVOT__flag'),
    ]
    return kit.add_decals({'cage': cage, 'flag': flag}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '7,5,5', 5.2, 'bottom', 8000,
        'Drop cage: 44 chrome Ø 10 bars (13 per long side, 9 per short side) between Cobalt Ø 20 corner posts, '
        'Cobalt bottom ring on a 4 mm rubber strip, Cobalt top frame with a recessed Bone plate, two cross braces '
        'and the eye boss carrying the PR-M tension hook (0, 0, 0.492, +Z). Bone critter flag with the paw '
        'pictogram on PIVOT__flag (axis y, 0 flat .. 90 up). Brief: docs/art/briefs/frame.md#trap-box. '
        'Collision: solid walls + top (steel); no separate rubber rim collider (the 4 mm strip is under the 5 mm '
        'shape minimum and the walls already reach z 0).',
        MASTERS)
    part.pivot('flag', tuple(FLAG_PIVOT), 'y', 0.0, 90.0, motion='turn')
    part.build_lods(build, lod0_q=1.4)
    hz, zc = 0.48, 0.24
    for nm, size, c in (('wall_f', (W, 0.014, hz), (0, -POST_Y, zc)), ('wall_b', (W, 0.014, hz), (0, POST_Y, zc)),
                        ('wall_l', (0.014, D, hz), (-POST_X, 0, zc)), ('wall_r', (0.014, D, hz), (POST_X, 0, zc))):
        part.col_box(nm, size, c, phys='steel', restitution=0.10, friction=0.4)
    part.col_box('top', (W, D, 0.02), (0, 0, 0.47), phys='steel', restitution=0.10, friction=0.4)
    part.port('tension', 'hook', (0, 0, BOSS_TOP), (0, 0, 1), 'M', 'both', kind='hook')
    part.sensor('catch', 'inside', [(x * 0.32, y * 0.22, z) for x in (-1, 1) for y in (-1, 1) for z in (0.01, 0.45)])
    part.emit('dust', 'rim', (0, -0.25, 0), (0, 0, -1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
