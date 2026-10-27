"""Procedurally build THE TINKER LAB set (environments.md §3, D78, D82: real scale, key light from behind-right
through the windows, following the approved key art art/style-samples/tinker_lab_key.png).

Usage: blender -b --factory-startup -P tools/blender/env_tinker.py -- [--no-ts] [--no-blend] [--no-bake]
                                                                       [--ibl-samples N]
   or: node tools/assets.mjs --env-tinker [--render]

Outputs
  assets/src/env/tinker/tinker_set.blend      source (ENV_RENDER/LOD1..3, BACKDROP, REF__desk/room, COL, BOUNDS,
                                              SPAWN, ZONE, PROBE, LIGHT, EMIT)
  assets/build/env/tinker/tinker.glb          nodes LOD0..LOD3, BACKDROP, REF__scale__desk / __room, PROBES
  assets/build/env/tinker/tinker.env.json     the same data as JSON (tooling)
  assets/build/env/tinker/ibl_tinker_lab.hdr  equirect 2048 x 1024 Radiance HDR, Cycles-baked from this set and rig
  assets/build/env/tinker/ibl_tinker_lab.json probe position, SH9 diffuse coefficients, exposure
  assets/build/env/tinker/lut_tinker_lab.png  32^3 grading LUT as a 1024 x 32 strip (the key art's grade)
  packages/parts-data/src/env_tinker.ts       generated literals for the sim and the renderer (contract 2)

Set coordinates: Blender metres, Z up, origin = the Room bounds floor centre, back wall face Y = +8.4, side wall
faces X = -8.4 / +8.4, the front is open (cutaway); no ceiling. The key-art bench sits at the back: its frame
(render_tinker_lab.py, bench centre at the origin) maps to set space by KEY_OFFSET. The Desk preset's world origin
is the cutting-mat top centre, set (0, 6.43, 0.904).
"""
import json
import math
import os
import random
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import at  # noqa: E402
from props.core import PROPS, load_all, place  # noqa: E402
from props.envkit import (SetBuilder, add_box_markers, empty, eng, eng_box, eng_dir, eng_minmax, export_glb,  # noqa: E402
                          face_out, frame_wall, setup_scene, to_objects, tri_count, ts_literal)
from props.furniture import SHELF_UNIT_LEVELS, SHELF_UNIT_SIZE, WALL_SHELF_TOP  # noqa: E402
from props.stationery import BOOK_SIZES  # noqa: E402

ENV = 'tinker'
KEY_OFFSET = Vector((-0.05, 6.45, 0.0))     # key-art frame -> set
WALL = 8.4                                   # inner faces of the back / side walls
WT, WH = 0.15, 3.2                           # wall thickness and height (real scale)
BENCH = ((-1.55, 5.95), (1.45, 6.95))        # bench top footprint (x0, y0), (x1, y1)
BENCH_Z = 0.90
MAT = ((-1.15, 6.02), (1.15, 6.84))          # cutting mat = the Desk build zone
MAT_Z = 0.904
FLOOR_MAT = ((-4.2, -5.2), (4.2, 3.2))       # printed floor mat around the Room build zone
WINDOWS = ((1.70, 2.70), (3.00, 4.00), (4.30, 5.30), (5.60, 6.60), (6.90, 7.90))
SILL, HEAD = 1.0, 2.85
SUN_TRAVEL = Vector((-0.5, -1.0, -0.42))     # key art: the light travels toward front-left and down
DESK_ORIGIN = (0.0, 6.43, MAT_Z)
BENCH_LAMPS = ((-0.40, 6.50, 2.0), (0.90, 6.60, 2.05), (2.55, 7.05, 2.2))   # bulb centres (key art)
SIDE_LAMPS = ((-6.0, 3.0, 2.5), (-6.0, -2.5, 2.5), (6.0, 1.0, 2.5), (6.0, -3.5, 2.5))
MOCHI = {'pos': (-1.36, 6.30, BENCH_Z + 0.1), 'yaw': 100.0, 'radius': 0.1, 'half': 0.08}  # pos = glb origin (COM)


def k2s(x, y, z):
    v = Vector((x, y, z)) + KEY_OFFSET
    return (round(v.x, 4), round(v.y, 4), round(v.z, 4))


def lens_fov(lens):
    """Vertical FOV (deg) of a 36 mm-wide sensor at 16 : 9."""
    return round(math.degrees(2 * math.atan(36 / 16 * 9 / 2 / lens)), 2)


# key-art cameras (render_tinker_lab.py views), in set space
CAMERAS = {
    'hero': {'pos': k2s(-0.45, -2.45, 1.78), 'target': k2s(0.08, 0.22, 1.08), 'lens': 30, 'focus': 2.75, 'fstop': 2.4},
    'wide': {'pos': k2s(-1.6, -3.4, 1.85), 'target': k2s(0.2, 0.4, 1.2), 'lens': 26, 'focus': 3.9, 'fstop': 3.2},
    'lobby': {'pos': k2s(0.9, -1.75, 1.3), 'target': k2s(-0.1, 0.25, 1.05), 'lens': 40, 'focus': 2.15, 'fstop': 2.0},
}
PRESETS = {
    'desk': {'bounds': ((-2, 4.93, MAT_Z), (2, 7.93, MAT_Z + 3)), 'origin': DESK_ORIGIN,
             'neutral': ((MAT[0][0], MAT[0][1], MAT_Z), (MAT[1][0], MAT[1][1], MAT_Z)),
             'target': (0.0, 6.43, MAT_Z + 0.3), 'camera': (0.0, 6.43 - 4.63, MAT_Z + 2.66),
             'drones': ((-1.2, 6.43 - 2.4, MAT_Z + 1.6), (1.2, 6.43 - 2.4, MAT_Z + 1.6)),
             'scale_ref': (3.0, 6.30, MAT_Z)},
    'room': {'bounds': ((-8, -8, 0), (8, 8, 8)), 'origin': (0.0, 0.0, 0.0),
             'neutral': ((-4, -5, 0), (4, 3, 0)),
             'target': (0, -1, 0.5), 'camera': (0, -12.5, 7.15), 'drones': ((-3, -9, 3), (3, -9, 3)),
             'scale_ref': (5.5, -6.0, 0)},
}
PROBES = [  # box-projected reflection probes (centre, half extents), set space
    ('bench', (0.0, 6.4, 1.4), (4.0, 2.0, 1.6)),
    ('left', (-6.2, 0.0, 1.6), (2.2, 8.4, 1.6)),
    ('right', (6.2, 0.0, 1.6), (2.2, 8.4, 1.6)),
    ('centre', (0.0, -2.0, 1.6), (4.0, 6.4, 1.6)),
]
GI_VOLUME = ((0.0, 0.0, 1.7), (8.6, 8.6, 1.8))
IBL_PROBE = (0.0, 5.2, 1.5)


# ---------------------------------------------------------------- shell

def floor(S):
    """Oak boards 0.15 m wide running along X, staggered seams, over a walnut subfloor; one wood floor collider."""
    x0, x1, y0, y1 = -WALL - WT, WALL + WT, -8.6, WALL
    k = S.kit('floor')
    k2 = S.kit('subfloor')
    k2.hull([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (-0.3, -0.004)], 'kn_wood_walnut')
    if S.lod >= 2:
        k.hull([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (-0.02, 0.0)], 'kn_env_floorboards')
    else:
        rng = random.Random(3)
        w, gap = 0.15, 0.003
        n = int((y1 - y0) / w)
        for j in range(n):
            ya, yb = y0 + j * w + gap / 2, y0 + (j + 1) * w - gap / 2
            x = x0 - rng.uniform(0.0, 2.4)
            while x < x1:
                L = rng.uniform(1.8, 3.0)
                a, b = max(x0, x) + gap / 2, min(x1, x + L) - gap / 2
                if b - a > 0.1:
                    out = [(a, ya), (b, ya), (b, yb), (a, yb)]
                    k.prism(out, -0.02, 0.0, 'kn_env_floorboards', bt=0.003 if S.lod == 0 else 0.0, bseg=1)
                x += L
    S.collider('floor', (-32, -32, -1.0), (32, 32, 0.0), 'wood')


def grid_mat(S, piece, x0, y0, x1, y1, z, cx, cy, minor=0.1, major=0.5, thick=0.003):
    """Self-healing cutting mat: green slab, grid lines on the build grid (minor 0.1 m = one cell, major 0.5 m),
    ruler ticks along the front edge. Lines are aligned to (cx, cy), the preset origin."""
    k = S.kit(piece)
    k.hull([(x, y, zz) for x in (x0, x1) for y in (y0, y1) for zz in (z - thick, z)], 'kn_env_cutting_mat')
    if S.lod >= 2:
        return
    lz = z + 0.0004

    def line(ax0, ay0, ax1, ay1, w):
        k.hull([(x, y, zz) for x in (ax0, ax1) for y in (ay0, ay1) for zz in (z - 0.0002, lz)], 'kn_env_cutting_mat_grid')

    inset = 0.03
    i0, i1 = int(math.ceil((x0 + inset - cx) / minor)), int(math.floor((x1 - inset - cx) / minor))
    for i in range(i0, i1 + 1):
        x = cx + i * minor
        w = 0.008 if i % int(round(major / minor)) == 0 else 0.005   # crisp lines, as the key art's mat
        line(x - w / 2, y0 + inset, x + w / 2, y1 - inset, w)
        if S.lod == 0:   # ruler ticks along the front edge
            tl = 0.02 if i % 5 == 0 else 0.01
            line(x - 0.0012, y0 + 0.004, x + 0.0012, y0 + 0.004 + tl, 0.0024)
    j0, j1 = int(math.ceil((y0 + inset - cy) / minor)), int(math.floor((y1 - inset - cy) / minor))
    for j in range(j0, j1 + 1):
        y = cy + j * minor
        w = 0.008 if j % int(round(major / minor)) == 0 else 0.005
        line(x0 + inset, y - w / 2, x1 - inset, y + w / 2, w)


def walls(S):
    """Back wall with five tall windows on its right half (the key art's window wall, behind-right), plain side
    walls, green enamel wainscot to 0.95 m and an oak chair rail. Plaster above."""
    P = 'kn_env_plaster_warm'
    yb0, yb1 = WALL, WALL + WT
    xs = [-WALL - WT] + [v for w in WINDOWS for v in w] + [WALL + WT]
    for a, b in zip(xs[0::2], xs[1::2]):
        S.box('walls', (a, yb0, 0), (b, yb1, WH), P, r=0.0, name='wall_back')
    for a, b in WINDOWS:
        S.box('walls', (a, yb0, 0), (b, yb1, SILL - 0.025), P, r=0.0, name='wall_back')
        S.box('walls', (a, yb0, HEAD + 0.04), (b, yb1, WH), P, r=0.0, name='wall_back')
    S.box('walls', (-WALL - WT, -8.6, 0), (-WALL, yb1, WH), P, r=0.0, name='wall_left')
    S.box('walls', (WALL, -8.6, 0), (WALL + WT, yb1, WH), P, r=0.0, name='wall_right')
    # wainscot + chair rail (render only: within 3 cm of the wall boxes)
    W, T = 'kn_env_wainscot', 0.025
    runs = [((-WALL, WALL - T), (WALL, WALL)), ((-WALL, -8.6), (-WALL + T, WALL)), ((WALL - T, -8.6), (WALL, WALL))]
    for (ax, ay), (bx, by) in runs:
        S.box('wainscot', (ax, ay, 0.0), (bx, by, 0.95), W, r=0.004, col=False)
    for (ax, ay), (bx, by) in ((((-WALL, WALL - 0.045), (WALL, WALL))), (((-WALL, -8.6), (-WALL + 0.045, WALL))),
                               (((WALL - 0.045, -8.6), (WALL, WALL)))):
        S.box('chair_rail', (ax, ay, 0.95), (bx, by, 1.0), 'kn_wood_oak', r=0.01, col=False)
        S.box('skirting', (ax, ay, 0.0), (bx, by, 0.1), 'kn_wood_oak', r=0.006, col=False)
    # wall tops: the cutaway shows the wall section, capped in oak
    for lo, hi in (((-WALL - WT, WALL, WH), (WALL + WT, WALL + WT, WH + 0.03)),
                   ((-WALL - WT, -8.6, WH), (-WALL, WALL + WT, WH + 0.03)),
                   ((WALL, -8.6, WH), (WALL + WT, WALL + WT, WH + 0.03))):
        S.box('wall_caps', lo, hi, 'kn_wood_walnut', r=0.006, col=False)


def windows(S):
    """Oak frames (jambs, head, a centre mullion and two transoms), glass, oak sills with plants. Frames and
    glass are no-shadow pieces (environments.md §3.1), so the sun patch through them is clean."""
    S.noshadow.update(('window_frames', 'window_glass'))
    for a, b in WINDOWS:
        S.box('window_sills', (a - 0.08, WALL - 0.12, SILL - 0.025), (b + 0.08, WALL + 0.12, SILL + 0.025), 'kn_wood_oak',
              r=0.01, name='window_sill')
        for x in (a, b):
            S.box('window_frames', (x - 0.03, WALL - 0.07, SILL), (x + 0.03, WALL + 0.11, HEAD), 'kn_wood_oak', r=0.008,
                  col=False)
        S.box('window_frames', (a - 0.06, WALL - 0.07, HEAD - 0.04), (b + 0.06, WALL + 0.11, HEAD + 0.04), 'kn_wood_oak',
              r=0.008, col=False)
        m = (a + b) / 2
        S.box('window_frames', (m - 0.0175, WALL + 0.02, SILL), (m + 0.0175, WALL + 0.08, HEAD), 'kn_wood_oak', r=0.005,
              col=False)
        for z in (SILL + (HEAD - SILL) / 3, SILL + 2 * (HEAD - SILL) / 3):
            S.box('window_frames', (a, WALL + 0.02, z - 0.0175), (b, WALL + 0.08, z + 0.0175), 'kn_wood_oak', r=0.005,
                  col=False)
        S.box('window_glass', (a + 0.03, WALL + 0.085, SILL), (b - 0.03, WALL + 0.095, HEAD - 0.04), 'kn_glass', r=0.0,
              phys='glass', name='window_glass')
    # plants on the sills (the key art's four, plus the new windows); outside the bounds: no colliders
    for i, x in enumerate((2.0, 2.45, 3.35, 3.8, 4.6, 5.0, 6.1, 7.2, 7.6)):
        S.prop('plant_succulent' if i % 3 else 'plant_fern', x, WALL - 0.02, SILL + 0.025, yaw=20 * i, variant=i,
               col=False, seed=i, scale=1.0 if i % 3 else 0.7)


def backdrop(S):
    """Outside the windows: a sunlit schoolyard (warm sky card, soft trees, a low fence, grass). No collision, and
    no shadows: the sun is behind the yard, so its scenery must not shade the room."""
    S.noshadow.update(('sky', 'yard', 'fence', 'trees', 'trunks'))
    S.box('sky', (-30.0, 13.0, -1.0), (30.0, 13.2, 12.0), 'kn_env_backdrop_warm', r=0.0, col=False, group='backdrop')
    S.box('yard', (-1.0, WALL + WT, -0.2), (18.0, 13.0, -0.01), 'kn_env_grass', r=0.0, col=False, group='backdrop')
    S.box('fence', (-1.0, 11.6, 0.0), (18.0, 11.7, 0.9), 'kn_wood_oak', r=0.02, col=False, group='backdrop')
    rng = random.Random(11)
    k = S.kit('trees', 'backdrop')
    for i in range(16):
        x, y, z, r = rng.uniform(0.5, 16.0), rng.uniform(10.0, 12.6), rng.uniform(1.2, 3.4), rng.uniform(0.9, 1.7)
        k.sphere(r, 'kn_env_foliage' if i % 2 else 'kn_env_foliage_dark', max(8, int(16 * S.q)), max(5, int(10 * S.q)),
                 m=at(x, y, z) @ Matrix.Diagonal((1.0, 0.65, 0.9, 1.0)))
        if z - r * 0.9 > 0.1:
            S.cyl('trunks', (x, y), 0.12, 0.0, z - r * 0.6, 'kn_wood_walnut', group='backdrop', segs=8)


# ---------------------------------------------------------------- the bench and the key-art back wall

def bench(S):
    """The key-art workbench: butcher-block oak top 3.0 x 1.0 m at 0.90 m, oak legs, rail and lower shelf, the
    green cutting mat (the Desk build zone, printed on the build grid)."""
    (x0, y0), (x1, y1) = BENCH
    S.box('bench', (x0, y0, BENCH_Z - 0.07), (x1, y1, BENCH_Z), 'kn_env_bench_oak', r=0.006, phys='wood',
          name='bench_top')
    for lx in (x0 + 0.15, x1 - 0.15):
        for ly in (y0 + 0.1, y1 - 0.1):
            S.box('bench_legs', (lx - 0.04, ly - 0.04, 0.0), (lx + 0.04, ly + 0.04, BENCH_Z - 0.07), 'kn_wood_walnut',
                  r=0.006, phys='wood', name='bench_leg')
    S.box('bench_legs', (x0 + 0.15, y1 - 0.125, 0.16), (x1 - 0.15, y1 - 0.075, 0.24), 'kn_wood_walnut', r=0.006,
          phys='wood', name='bench_rail')
    S.box('bench', (x0 + 0.15, y0 + 0.1, 0.165), (x1 - 0.15, y1 - 0.1, 0.195), 'kn_env_bench_oak', r=0.006, phys='wood',
          name='bench_shelf')
    (mx0, my0), (mx1, my1) = MAT
    grid_mat(S, 'cutting_mat', mx0, my0, mx1, my1, MAT_Z, DESK_ORIGIN[0], DESK_ORIGIN[1])
    S.collider('cutting_mat', (mx0, my0, MAT_Z - 0.009), (mx1, my1, MAT_Z), 'wood')
    # bench-end dressing (inside the Desk bounds: kit colliders). Sun side (+X): low things only (§0.10).
    S.prop('mug', 1.33, 6.40, BENCH_Z, yaw=-30, variant=0)
    S.prop('pencil_cup', 1.27, 6.80, BENCH_Z, yaw=10)
    flat_books(S, 1.30, 6.13, BENCH_Z, -8, (7, 4, 13))
    S.prop('plant_succulent', -1.40, 6.80, BENCH_Z, yaw=40, variant=2)
    S.prop('notebook', -1.36, 5.98 + 0.11, BENCH_Z, yaw=78, variant=0, scale=0.85)
    # stools at the bench ends (below the Desk bounds)
    S.prop('stool', -2.05, 5.55, 0.0, yaw=15)
    S.prop('stool', 1.95, 5.50, 0.0, yaw=-20)


def flat_books(S, x, y, z, yaw, variants, col=True):
    """A stack of hardbacks lying flat (kit book turned onto its side)."""
    for i, v in enumerate(variants):
        h, d, t = BOOK_SIZES[v % 3]
        M = place(x, y, z, yaw + (i * 7 - 7)) @ at(-h / 2, 0, t / 2) @ Matrix.Rotation(math.radians(90), 4, 'Y')
        S.prop('book', 0, 0, 0, variant=v, M=M, col=col, piece='prop_book')
        z += t


def chalkboard(S, fonts):
    """Green chalkboard with the key art's chalk text and the ramp / dominoes / ball sketch, oak frame and tray."""
    cx, cz, cw, ch = 0.40, 1.85, 2.3, 1.15
    y = WALL
    S.box('chalkboard', (cx - cw / 2 - 0.05, y - 0.055, cz - ch / 2 - 0.05), (cx + cw / 2 + 0.05, y, cz + ch / 2 + 0.05),
          'kn_wood_oak', r=0.008, col=False)
    S.box('chalkboard', (cx - cw / 2, y - 0.065, cz - ch / 2), (cx + cw / 2, y - 0.04, cz + ch / 2), 'kn_env_chalkboard',
          r=0.002, col=False)
    S.box('chalkboard', (cx - cw / 2 - 0.05, y - 0.125, cz - ch / 2 - 0.08), (cx + cw / 2 + 0.05, y - 0.055,
                                                                             cz - ch / 2 - 0.05), 'kn_wood_oak', r=0.006,
          col=False)
    fy = y - 0.0665   # 1.5 mm proud of the slate; the text is 2 mm deep
    F = face_out('-y')

    def txt(body, x, z, size, mat):
        S.text('chalk', body, at(x, fy, z) @ F, size, mat, fonts['sym'])

    txt('EVERY ACTION HAS AN', cx - 0.15, cz + 0.12, 0.08, 'kn_env_chalk')
    txt('OVERREACTION!', cx - 0.15, cz - 0.02, 0.1, 'kn_powder_amber')
    txt('F = m · a   →   KABOOM', cx - 0.45, cz - 0.2, 0.055, 'kn_env_chalk')
    txt('Δt  ≈  0.42 s', cx - 0.55, cz - 0.31, 0.045, 'kn_env_chalk')
    if S.lod > 1:
        return
    bx = cx + 0.55
    S.sweep('chalk', [(bx - 0.05, fy, cz + 0.02), (bx + 0.35, fy, cz - 0.2), (bx + 0.55, fy, cz - 0.2)], 0.004,
            'kn_env_chalk', sides=4)
    for i in range(6):
        x = bx + 0.6 + i * 0.05
        lean = min(i, 3) * 0.012
        S.sweep('chalk', [(x, fy, cz - 0.2), (x + lean, fy, cz - 0.1)], 0.004, 'kn_env_chalk', sides=4)
    ang = [i / 20 * 2 * math.pi for i in range(21)]
    S.sweep('chalk', [(bx + 0.05 + 0.05 * math.cos(a), fy, cz + 0.07 + 0.05 * math.sin(a)) for a in ang], 0.004,
            'kn_env_chalk', sides=4)
    S.sweep('chalk', [(bx + 0.12, fy, cz + 0.12), (bx + 0.3, fy, cz + 0.02), (bx + 0.27, fy, cz + 0.06)], 0.003,
            'kn_powder_amber', sides=4)
    # a chalk doodle of MOCHI, bottom right (environments.md §3.1)
    mx, mz = cx + 0.95, cz - 0.42
    S.sweep('chalk', [(mx + 0.06 * math.cos(a), fy, mz + 0.045 * math.sin(a)) for a in ang], 0.003, 'kn_env_chalk',
            sides=4)
    for sx in (-1, 1):
        S.sweep('chalk', [(mx + sx * 0.035, fy, mz + 0.03), (mx + sx * 0.05, fy, mz + 0.075), (mx + sx * 0.015, fy,
                                                                                              mz + 0.04)], 0.003,
                'kn_env_chalk', sides=4)


def wall_art(S, fonts):
    """Blueprint poster (left of the board), the SAFETY FIRST poster and the corkboard, as in the key art."""
    y = WALL
    F = face_out('-y')
    px, pz = -1.55, 1.9
    S.box('blueprint', (px - 0.5, y - 0.012, pz - 0.65), (px + 0.5, y, pz + 0.65), 'kn_env_blueprint', r=0.0, col=False)
    by = y - 0.013
    S.text('blueprint_ink', 'BUILD  RUN  REWIND', at(px, by, pz + 0.5) @ F, 0.06, 'kn_env_chalk', fonts['sym'])
    S.text('blueprint_ink', 'COG · L   ⌀ 310', at(px, by, pz - 0.5) @ F, 0.04, 'kn_env_chalk', fonts['sym'])
    if S.lod <= 1:
        for i in range(7):
            S.sweep('blueprint_ink', [(px - 0.45, by, pz - 0.55 + i * 0.15), (px + 0.45, by, pz - 0.55 + i * 0.15)],
                    0.0015, 'kn_env_chalk', sides=3)
            S.sweep('blueprint_ink', [(px - 0.45 + i * 0.15, by, pz - 0.55), (px - 0.45 + i * 0.15, by, pz + 0.38)],
                    0.0015, 'kn_env_chalk', sides=3)
        ring = [i / 32 * 2 * math.pi for i in range(33)]
        for r in (0.26, 0.18, 0.06):
            S.sweep('blueprint_ink', [(px + r * math.cos(a), by, pz - 0.08 + r * math.sin(a)) for a in ring], 0.003,
                    'kn_env_chalk', sides=4)
        for i in range(12):
            a = i / 12 * 2 * math.pi
            S.sweep('blueprint_ink', [(px + 0.26 * math.cos(a), by, pz - 0.08 + 0.26 * math.sin(a)),
                                      (px + 0.32 * math.cos(a), by, pz - 0.08 + 0.32 * math.sin(a))], 0.006,
                    'kn_env_chalk', sides=4)
    # SAFETY FIRST* poster
    sx, sz = -2.60, 2.0
    S.box('posters', (sx - 0.21, y - 0.01, sz - 0.29), (sx + 0.21, y, sz + 0.29), 'kn_paper_tan', r=0.0, col=False)
    S.text('poster_ink', 'SAFETY\nFIRST*', at(sx, y - 0.011, sz + 0.12) @ F, 0.07, 'kn_powder_ignition', fonts['sym'])
    S.text('poster_ink', '*then fuses', at(sx, y - 0.011, sz - 0.18) @ F, 0.035, 'kn_powder_graphite', fonts['sym'])
    S.prop('corkboard', 0, 0, 0, M=frame_wall(-2.65, y, 1.05), col=False)
    # more posters on the left run of the back wall and the side walls (invented designs, no words)
    for i, (x, z) in enumerate(((-6.2, 1.9), (-7.4, 2.0))):
        S.prop('poster', 0, 0, 0, M=frame_wall(x, y, z - 0.45), variant=(i + 1) * 2, col=False)
    for i, yy in enumerate((-5.0, -6.3)):
        S.prop('poster', 0, 0, 0, M=frame_wall(WALL, yy, 1.4, '-x'), variant=3 + i, col=False)
    S.prop('poster', 0, 0, 0, M=frame_wall(-WALL, -5.6, 1.4, '+x'), variant=4, col=False)


def fill_shelf(S, M, x0, x1, z, depth, rng, plants=True, col=False, bias=0):
    """Books, jars, beakers and the odd plant along a shelf from local x0 to x1 at height z (top surface), back
    edge at local y = 0 (items face -Y). M is the shelf's frame (set space). LOD3 leaves shelves empty."""
    if S.lod == 3:
        return
    x = x0
    while x < x1 - 0.03:
        kind = rng.random()
        if plants and kind > 0.92 and x + 0.16 < x1:
            S.prop('plant_trailing' if rng.random() < 0.5 else 'plant_succulent', 0, 0, 0, variant=rng.randrange(3),
                   M=M @ place(x + 0.08, -depth / 2, z, rng.uniform(-20, 20)), col=col, seed=rng.randrange(99), bias=bias)
            x += 0.18
        elif kind < 0.62:
            for _ in range(rng.randint(3, 9)):
                v = rng.randrange(24)
                h, d, t = BOOK_SIZES[v % 3]
                if x + t > x1 or d > depth:
                    break
                lean = rng.choice((0, 0, 0, 0, 6))
                S.prop('book', 0, 0, 0, variant=v, M=M @ place(x + t / 2, -0.01 - d / 2, z, 0) @
                       Matrix.Rotation(math.radians(lean), 4, 'Y'), col=col, piece='prop_book', bias=bias)
                x += t + 0.002
            x += 0.03
        elif kind < 0.82:
            S.prop('jar', 0, 0, 0, variant=rng.randrange(4), M=M @ place(x + 0.05, -depth / 2, z, rng.uniform(0, 90)),
                   col=col, bias=bias)
            x += 0.12
        elif kind < 0.9:
            S.prop('beaker' if rng.random() < 0.6 else 'flask', 0, 0, 0, variant=rng.randrange(6),
                   M=M @ place(x + 0.06, -depth / 2, z, 0), col=col, bias=bias)
            x += 0.13
        else:
            S.prop('spool' if rng.random() < 0.5 else 'paint_tin', 0, 0, 0, variant=rng.randrange(3),
                   M=M @ place(x + 0.05, -depth / 2, z, rng.uniform(0, 90)), col=col, bias=bias)
            x += 0.11


def back_wall_dressing(S):
    """Long wall shelf behind the bench (key art), bookcases and the pegboard workshop on the left run, radiators
    and a window seat under the windows."""
    rng = random.Random(21)
    for i, x in enumerate((-1.85, -0.85, 0.15, 1.15)):
        S.prop('wall_shelf', 0, 0, 0, M=frame_wall(x, WALL, 1.075 - WALL_SHELF_TOP), col=False)
    fill_shelf(S, frame_wall(0, WALL, 0), -2.3, 1.6, 1.075, 0.21, rng)
    # bookcases (outside both bounds: they keep their kit colliders for anything that gets there)
    W, D, H = SHELF_UNIT_SIZE
    for x in (-4.1, -5.15):
        M = frame_wall(x, WALL - D / 2, 0) @ at(0, 0, 0)
        S.prop('shelf_unit', 0, 0, 0, M=M)
        for z in SHELF_UNIT_LEVELS:
            fill_shelf(S, M @ at(0, D / 2 - 0.012, 0), -W / 2 + 0.035, W / 2 - 0.035, z, D - 0.03, rng, bias=1)
    S.prop('globe', 0, 0, 0, M=frame_wall(-4.1, WALL - D / 2, H + 0.03))
    S.prop('plant_trailing', 0, 0, 0, M=frame_wall(-5.0, WALL - 0.12, H + 0.03), variant=1, col=False)
    # pegboard workshop: a low cabinet run with two pegboards and hung tools
    cab(S, 'cabinet_left', -8.3, -5.8, WALL - 0.6, WALL)
    for i, x in enumerate((-7.65, -6.40)):
        S.prop('pegboard', 0, 0, 0, M=frame_wall(x, WALL, 1.2), col=False)
        for k, dx in enumerate((-0.4, -0.12, 0.15, 0.42)):
            M = frame_wall(x + dx, WALL - 0.03, 1.5) @ Matrix.Rotation(math.radians(90), 4, 'X')
            S.prop('hand_tool', 0, 0, 0, M=M, variant=i * 2 + k, col=False)
    S.prop('toolbox', -7.6, WALL - 0.3, 0.9, yaw=8)
    S.prop('vice', -6.4, WALL - 0.42, 0.9, yaw=0)
    S.prop('parts_drawers', -6.9, WALL - 0.2, 0.9, yaw=-4)
    S.prop('clamp', -6.0, WALL - 0.35, 0.9, yaw=70, variant=0)
    # radiators under the first two windows (cast iron fins), a window seat under the rest
    for a, b in WINDOWS[:2]:
        n = 9
        for i in range(n):
            x = a + 0.08 + i * (b - a - 0.16) / (n - 1)
            S.box('radiators', (x - 0.03, WALL - 0.14, 0.12), (x + 0.03, WALL - 0.04, 0.78), 'kn_anod_graphite', r=0.02,
                  col=False)
        S.box('radiators', (a + 0.05, WALL - 0.12, 0.2), (b - 0.05, WALL - 0.06, 0.24), 'kn_anod_graphite', r=0.01,
              col=False)
        S.box('radiators', (a + 0.05, WALL - 0.12, 0.66), (b - 0.05, WALL - 0.06, 0.7), 'kn_anod_graphite', r=0.01,
              col=False)
    x0, x1 = WINDOWS[2][0] - 0.05, WINDOWS[4][1] + 0.05
    S.box('window_seat', (x0, WALL - 0.55, 0.0), (x1, WALL, 0.4), 'kn_wood_oak', r=0.012, phys='wood',
          name='window_seat')
    S.box('window_seat', (x0 + 0.03, WALL - 0.53, -0.001), (x1 - 0.03, WALL - 0.03, 0.06), 'kn_wood_walnut', r=0.006,
          col=False)
    for i in range(3):
        cx = x0 + (i + 0.5) * (x1 - x0) / 3
        S.box('cushions', (cx - 0.52, WALL - 0.52, 0.4), (cx + 0.52, WALL - 0.04, 0.5), 'kn_fabric_cobalt', r=0.04,
              col=False)
    flat_books(S, 5.0, WALL - 0.3, 0.5, 20, (2, 5), col=False)
    S.prop('lunchbox', 6.6, WALL - 0.3, 0.5, yaw=-15, col=False)


def cab(S, piece, x0, x1, y0, y1, top=0.9, body='kn_powder_bone'):
    """Low drawer cabinet: carcass, oak top, drawer fronts with brass pulls."""
    S.box(piece, (x0, y0 + 0.02, 0.08), (x1, y1, top - 0.03), body, r=0.01, name=piece)
    S.box(piece, (x0 + 0.04, y0 + 0.06, 0.0), (x1 - 0.04, y1, 0.08), 'kn_wood_walnut', r=0.004, col=False)
    S.box(piece, (x0 - 0.02, y0, top - 0.03), (x1 + 0.02, y1, top), 'kn_env_bench_oak', r=0.006, phys='wood',
          name=piece + '_top')
    n = max(1, int(round((x1 - x0) / 0.6)))
    w = (x1 - x0) / n
    for i in range(n):
        for z0, z1 in ((0.12, 0.45), (0.49, top - 0.07)):
            a, b = x0 + i * w + 0.02, x0 + (i + 1) * w - 0.02
            S.box(piece + '_fronts', (a, y0 + 0.005, z0), (b, y0 + 0.025, z1), body, r=0.008, col=False)
            S.box(piece + '_pulls', ((a + b) / 2 - 0.06, y0 - 0.012, z1 - 0.07), ((a + b) / 2 + 0.06, y0 + 0.005,
                                                                                   z1 - 0.05), 'kn_brass', r=0.006,
                  col=False)


def side_furniture(S):
    """Flanking cabinets (shade side left: the tall dressing; sun side right: low things and the Desk scale
    reference), the left wall of bookcases, the right wall (coat hooks, clock, posters, the teacher's trolley),
    rugs, chairs, crates and floor plants. Nothing in the Room build zone, nothing tall at the front edge."""
    rng = random.Random(5)
    # left of the bench: tall dressing on a cabinet
    cab(S, 'cabinet_bench_l', -3.45, -2.05, 5.95, 6.9)
    S.prop('globe', -3.12, 6.5, 0.9, yaw=25)
    S.prop('microscope', -2.58, 6.55, 0.9, yaw=-15)
    flat_books(S, -2.4, 6.17, 0.9, 12, (2, 8, 11, 5))
    S.prop('test_tube_rack', -2.95, 6.72, 0.9, yaw=4)
    S.prop('beaker', -2.75, 6.25, 0.9, variant=4)
    S.prop('flask', -3.3, 6.16, 0.9, variant=2)
    # right of the bench: a low cabinet with the Desk scale reference and low things
    cab(S, 'cabinet_bench_r', 2.35, 3.65, 5.95, 6.9, top=MAT_Z)
    S.prop('notebook', 2.6, 6.68, MAT_Z, yaw=-12, variant=1)
    S.prop('tape_dispenser', 3.45, 6.7, MAT_Z, yaw=200)
    # left wall: eight bookcases facing +X
    W, D, H = SHELF_UNIT_SIZE
    for i in range(8):
        yy = -3.5 + i * (W + 0.02)
        M = frame_wall(-WALL + D / 2, yy, 0, '+x')
        S.prop('shelf_unit', 0, 0, 0, M=M)
        for z in SHELF_UNIT_LEVELS:
            fill_shelf(S, M @ at(0, D / 2 - 0.012, 0), -W / 2 + 0.035, W / 2 - 0.035, z, D - 0.03, rng, bias=1)
        top = M @ at(0, 0, H + 0.03)
        if i % 3 == 0:
            S.prop('plant_trailing', 0, 0, 0, M=top @ at(0, 0.05, 0), variant=i % 2, col=False)
        elif i % 3 == 1:
            S.prop('orrery', 0, 0, 0, M=top, col=False) if i == 1 else S.prop('crate', 0, 0, 0, M=top, variant=1,
                                                                                col=False)
        else:
            S.prop('rock_tray', 0, 0, 0, M=top, col=False)
    # right wall
    S.prop('coat_hook', 0, 0, 0, M=frame_wall(WALL, 4.6, 0, '-x'), col=False)
    S.prop('clock_wall', 0, 0, 0, M=frame_wall(WALL, 2.4, 2.35, '-x'), col=False)
    S.prop('corkboard', 0, 0, 0, M=frame_wall(WALL, -1.6, 1.2, '-x'), col=False)
    S.prop('poster', 0, 0, 0, M=frame_wall(WALL, 0.3, 1.25, '-x'), variant=5, col=False)
    trolley(S, 6.6, 3.0)
    # floor: rugs, reading corner, crates, plants
    S.prop('rug', -6.2, 0.6, 0.0, yaw=90, variant=2, col=False)
    S.prop('chair_school', -6.6, 1.4, 0.0, yaw=60)
    S.prop('chair_school', -5.7, -0.4, 0.0, yaw=150)
    S.prop('rug', 6.0, 6.9, 0.0, yaw=0, variant=1, col=False)
    S.prop('plant_tall', -7.35, -4.7, 0.0, yaw=30)
    S.prop('plant_tall', 7.3, -4.9, 0.0, yaw=200)
    S.prop('plant_fern', 7.5, 6.2, 0.0, yaw=0)
    S.prop('crate', -7.3, -6.3, 0.0, yaw=8, variant=0)
    S.prop('crate', -6.6, -6.9, 0.0, yaw=-14, variant=1)
    S.prop('cardboard_box', 6.9, -6.7, 0.0, yaw=12, variant=1)
    S.prop('cardboard_box', 6.3, -7.2, 0.0, yaw=-20, variant=5)
    S.prop('cardboard_box', 7.4, -7.4, 0.0, yaw=40, variant=0)


def trolley(S, x, y):
    """Teacher's trolley: Bone shelves on oak posts, rubber wheels, glassware on top."""
    w, d = 0.9, 0.5
    for z in (0.18, 0.86):
        S.box('trolley', (x - w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z + 0.04), 'kn_powder_bone', r=0.01,
              phys='powder', name='trolley_shelf')
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = x + sx * (w / 2 - 0.03), y + sy * (d / 2 - 0.03)
            S.box('trolley', (px - 0.02, py - 0.02, 0.08), (px + 0.02, py + 0.02, 0.9), 'kn_wood_oak', r=0.006,
                  phys='wood', name='trolley_post')
            S.cyl('trolley_wheels', (px, py), 0.04, 0.0, 0.08, 'kn_rubber', bev=0.015, segs=16)
    top = 0.9
    S.prop('beaker', x - 0.3, y - 0.1, top, variant=5)
    S.prop('beaker', x - 0.15, y + 0.12, top, variant=3)
    S.prop('flask', x + 0.02, y - 0.12, top, variant=0)
    S.prop('flask', x + 0.15, y + 0.1, top, variant=3)
    S.prop('test_tube_rack', x + 0.3, y - 0.08, top, yaw=90)
    S.prop('jar', x - 0.3, y + 0.15, 0.22, variant=1)
    S.prop('crayon_box', x + 0.2, y, 0.22, yaw=10)


def lamps_and_beams(S):
    """Walnut beams at the wall top carry the enamel pendants (key art green). Beams, cords and shades are
    no-shadow pieces; the bench beam and the bench pendants hang over the Desk build zone and are visual only
    (environments.md §3.6), the side beams collide."""
    S.noshadow.update(('beams', 'beams_side', 'pendant_cords', 'prop_lamp_pendant'))
    for yb in (6.55, 7.05):
        S.box('beams', (-WALL, yb - 0.09, WH), (WALL, yb + 0.09, WH + 0.2), 'kn_wood_walnut', r=0.012, col=False)
    for xb in (-6.0, 6.0):
        S.box('beams_side', (xb - 0.09, -6.6, WH), (xb + 0.09, 6.46, WH + 0.2), 'kn_wood_walnut', r=0.012, phys='wood',
              name='beam_side')
    for (x, y, z) in BENCH_LAMPS + SIDE_LAMPS:
        top = z + 0.42
        S.prop('lamp_pendant', x, y, top, variant=0, col=False)
        S.sweep('pendant_cords', [(x, y, top), (x, y, WH)], 0.004, 'kn_rubber', sides=5)


def scale_refs(S):
    """env_scale_ref per preset (environments.md §0.7): plinth, THUD, 1 m stick on its foot (real size)."""
    for preset, p in PRESETS.items():
        x, y, z0 = p['scale_ref']
        g = 'ref_' + preset
        S.box('plinth', (x - 0.2, y - 0.2, z0), (x + 0.2, y + 0.2, z0 + 0.45), 'kn_powder_graphite', r=0.012, group=g,
              name='scale_ref_plinth', preset=preset)
        S.box('plinth', (x - 0.18, y - 0.18, z0 + 0.445), (x + 0.18, y + 0.18, z0 + 0.455), 'kn_powder_bone', r=0.003,
              col=False, group=g)
        tz = z0 + 0.45 - 0.015 + 0.11
        k = S.kit('thud', g)
        k.sphere(0.11, 'kn_powder_graphite', max(12, int(40 * S.q)), max(8, int(20 * S.q)), m=at(x, y, tz))
        k.torus(0.108, 0.007, 'kn_powder_ignition', max(12, int(40 * S.q)), 6, m=at(x, y, tz))
        S.sphere_col('scale_ref_thud', (x, y, tz), 0.11, 'powder', preset)
        sx = x + 0.35
        S.box('stick', (sx - 0.06, y - 0.06, z0), (sx + 0.06, y + 0.06, z0 + 0.02), 'kn_powder_graphite', r=0.003,
              group=g, name='scale_ref_foot', preset=preset)
        for b in range(10):
            mat = 'kn_powder_ignition' if b == 5 else ('kn_powder_bone' if b % 2 == 0 else 'kn_powder_graphite')
            S.box('stick', (sx - 0.02, y - 0.01, z0 + 0.02 + b * 0.1), (sx + 0.02, y + 0.01, z0 + 0.02 + (b + 1) * 0.1),
                  mat, r=0.003, col=False, group=g)
        S.collider('scale_ref_stick', (sx - 0.02, y - 0.01, z0 + 0.02), (sx + 0.02, y + 0.01, z0 + 1.02), 'powder',
                   None, preset)


ROOF_Z = 3.32


def lantern_opening():
    """The shadow-only roof's lantern: the Room build zone pushed back along the sun ray to the roof height, so
    the D82 sun (behind-right, 21 deg) lands on the zone through it and nowhere else from above."""
    (zx0, zy0, _), (zx1, zy1, _) = PRESETS['room']['neutral']
    s = ROOF_Z / -SUN_TRAVEL.z
    dx, dy = -SUN_TRAVEL.x * s, -SUN_TRAVEL.y * s
    return (zx0 + dx, zy0 + dy), (zx1 + dx, min(zy1 + dy, WALL + WT))


def shadow_roof(S):
    """The cutaway has no ceiling, but the key light must come through the windows (D82): an invisible roof
    that only casts shadows (`__shadowonly`), with a lantern opening over the Room build zone."""
    S.shadowonly.add('shadow_roof')
    (ox0, oy0), (ox1, oy1) = lantern_opening()
    x0, x1, y0, y1 = -WALL - WT, WALL + WT, -8.6, WALL + WT
    z0, z1 = ROOF_Z, ROOF_Z + 0.06
    for lo, hi in (((x0, y0, z0), (x1, oy0, z1)), ((x0, oy1, z0), (x1, y1, z1)) if oy1 < y1 else (None, None),
                   ((x0, oy0, z0), (ox0, oy1, z1)), ((ox1, oy0, z0), (x1, oy1, z1))):
        if lo is None or hi[0] - lo[0] < 0.01 or hi[1] - lo[1] < 0.01:
            continue
        S.box('shadow_roof', lo, hi, 'kn_powder_graphite', r=0.0, col=False)


def build(lod, fonts):
    S = SetBuilder(lod)
    floor(S)
    (fx0, fy0), (fx1, fy1) = FLOOR_MAT
    grid_mat(S, 'floor_mat', fx0, fy0, fx1, fy1, 0.003, 0.0, 0.0)
    walls(S)
    windows(S)
    backdrop(S)
    bench(S)
    chalkboard(S, fonts)
    wall_art(S, fonts)
    back_wall_dressing(S)
    side_furniture(S)
    lamps_and_beams(S)
    scale_refs(S)
    shadow_roof(S)
    return S


# ---------------------------------------------------------------- data

def sun_info():
    d = SUN_TRAVEL.normalized()
    el = math.degrees(math.asin(-d.z))
    az = math.degrees(math.atan2(-d.x, -d.y))  # toward the sun, measured from +Y (back) toward +X
    return d, round(el, 2), round(az, 2)


def practical(bulb, off, i):
    """A pendant as the renderer needs it to light the bench and the wall pools: an enamel shade over a bulb is a
    downward cone with a soft edge. Intensity: 1,600 lm into the shade's cone (the key art's 70 W Cycles point
    lights, colour (1.0, 0.78, 0.52))."""
    outer = 70.0
    sr = 2 * math.pi * (1 - math.cos(math.radians(outer)))
    return {'pos': eng(Vector(bulb) - off), 'dir': [0.0, -1.0, 0.0], 'kelvin': 2700, 'color': [1.0, 0.78, 0.52],
            'lumens': 1600, 'candela': round(1600 / sr, 1), 'innerConeDeg': 45.0, 'outerConeDeg': outer,
            'rangeM': 8.0, 'bulbRadiusM': 0.045, 'cyclesWatts': 70, 'shadowed': i == 1,
            'zone': 'bench' if i < len(BENCH_LAMPS) else 'aisle'}


def env_data(S0, ibl):
    d, el, az = sun_info()
    data = {'env': 'tinker', 'scale': 1, 'gravity': 'earth', 'air': 1.0, 'feel': 'real', 'glb': 'env/tinker/tinker.glb',
            'presets': {}}
    for preset, p in PRESETS.items():
        off = Vector(p['origin'])
        bl, bh = p['bounds']
        nl, nh = p['neutral']
        boxes = []
        for b in S0.boxes:
            if b['preset'] not in (None, preset):
                continue
            c, h = eng_box(b['lo'], b['hi'], off)
            boxes.append({'name': b['name'], 'center': c, 'half': h, 'phys': b['phys']})
        spheres = [{'name': s['name'], 'center': eng(s['c'] - off), 'radius': round(s['r'], 4), 'phys': s['phys']}
                   for s in S0.spheres if s['preset'] in (None, preset)]
        cams = {'default': {'pos': eng(Vector(p['camera']) - off), 'target': eng(Vector(p['target']) - off),
                            'fovYDeg': 37.3 if preset == 'desk' else 40.0}}
        for name, c in CAMERAS.items():
            cams[name] = {'pos': eng(Vector(c['pos']) - off), 'target': eng(Vector(c['target']) - off),
                          'fovYDeg': lens_fov(c['lens']), 'focusM': c['focus'], 'fStop': c['fstop']}
        mp = Vector(MOCHI['pos'])
        data['presets'][preset] = {
            'origin': eng(off),
            'bounds': eng_minmax(bl, bh, off),
            'neutral': eng_minmax((nl[0], nl[1], nl[2]), (nh[0], nh[1], nh[2]), off),
            'camera': cams['default']['pos'], 'target': cams['default']['target'],
            'cameras': cams,
            'drones': [eng(Vector(dd) - off) for dd in p['drones']],
            'scaleRef': eng(Vector(p['scale_ref']) - off),
            'boxes': boxes, 'spheres': spheres,
            'mochi': {'pos': eng(mp - off), 'yawDeg': MOCHI['yaw'], 'clip': 'sleep',
                      'capsule': {'center': eng(mp - off), 'radius': MOCHI['radius'],
                                  'halfHeight': MOCHI['half'], 'axis': 'x'}, 'phys': 'fabric'},
            'practicals': [practical(l, off, i) for i, l in enumerate(BENCH_LAMPS + SIDE_LAMPS)],
            'probes': [{'name': n, 'center': eng(Vector(c) - off), 'half': [h[0], h[2], h[1]]} for n, c, h in PROBES],
            'giVolume': {'center': eng(Vector(GI_VOLUME[0]) - off), 'half': [GI_VOLUME[1][0], GI_VOLUME[1][2],
                                                                            GI_VOLUME[1][1]]},
            'emitters': [{'name': n, 'pos': eng(Vector(v) - off)} for n, v in (
                ('amb_tinker_clock_tick', (WALL - 0.05, 2.4, 2.5)), ('amb_tinker_mochi_purr', MOCHI['pos']),
                ('amb_tinker_radiator', (2.2, WALL - 0.1, 0.4)), ('amb_tinker_radiator', (3.5, WALL - 0.1, 0.4)),
                ('amb_tinker_window', (4.8, WALL + 0.1, 1.9)))] +
            [{'name': 'amb_tinker_pendant_hum', 'pos': eng(Vector(l) - off)} for l in BENCH_LAMPS],
        }
    data['light'] = {
        'sunDir': eng_dir(d), 'sunElevationDeg': el, 'sunAzimuthDeg': az,
        'sunFrom': 'behind-right, through the back-wall windows (key art, D82)',
        'sunKelvin': 3500, 'sunColor': [1.0, 0.74, 0.47], 'sunLux': 30000, 'sunAngleDeg': 1.2,
        'skyFill': '#AEBACF', 'windowSky': '#FFD9A0', 'fogDensity': 0.010, 'fogAnisotropy': 0.65,
        'hazeLowTier': 0.003, 'practicalKelvin': 2700, 'practicalLumens': 1600, 'ev100': 9.5, 'autoExposureEv': 0.5,
        'tonemap': 'khronos-pbr-neutral', 'vignette': 0.15, 'grain': 0.02,
    }
    data['ibl'] = ibl
    data['lut'] = {'name': 'lut_tinker_lab', 'file': 'env/tinker/lut_tinker_lab.png', 'size': 32,
                   'layout': 'strip 1024 x 32: red = x within a 32 px tile, green = y (top row 0), blue = tile index',
                   'space': 'display (after the tonemap)'}
    data['noShadow'] = sorted({'env_tinker__%s%s' % ('bd_' if g == 'backdrop' else '', p) for g, p in S0.pieces
                               if p in S0.noshadow})
    (ox0, oy0), (ox1, oy1) = lantern_opening()
    data['shadowOnly'] = sorted({'env_tinker__%s' % p for p in S0.shadowonly})
    data['roofLantern'] = {'roofY': ROOF_Z, 'opening': eng_minmax((ox0, oy0, ROOF_Z), (ox1, oy1, ROOF_Z))}
    return data


TS_HEAD = '''// GENERATED by tools/blender/env_tinker.py (`node tools/assets.mjs --env-tinker`). Do not edit by hand.
// THE TINKER LAB (art/briefs/environments.md §3, D78, D82), contract 2 of docs/dev/M3_PLAN.md: static colliders,
// build zones, cameras (incl. the key-art hero), drones, light rig, probes, IBL and LUT names, generated from the
// same table as assets/build/env/tinker/tinker.glb. Real scale (1 : 1). Engine space: metres, Y-up, front (default
// camera side) = +Z. Each preset is in its own world coordinates (origin = the preset bounds floor centre; the Desk
// origin is the cutting-mat top); tinker.glb is authored in Room (set) coordinates, so draw it at -origin.
// Literals only (determinism lint).
'''

TS_TYPES = '''
export type TinkerPhys = 'powder' | 'wood' | 'ceramic' | 'steel' | 'glass' | 'rubber' | 'paper' | 'fabric';
export type TinkerV3 = readonly [number, number, number];

/** Static axis-aligned box: centre and half extents (engine metres). */
export interface TinkerBox { readonly name: string; readonly center: TinkerV3; readonly half: TinkerV3; readonly phys: TinkerPhys }
/** Static sphere (the scale reference THUD, kit globes). */
export interface TinkerSphere { readonly name: string; readonly center: TinkerV3; readonly radius: number; readonly phys: TinkerPhys }
/** A camera: position, look-at target, vertical FOV; focus distance and f-stop for the DOF views. */
export interface TinkerCamera {
  readonly pos: TinkerV3; readonly target: TinkerV3; readonly fovYDeg: number;
  readonly focusM?: number; readonly fStop?: number;
}

export interface TinkerPreset {
  /** Where this preset's world origin sits in set (Room) coordinates; the glb is drawn at -origin. */
  readonly origin: TinkerV3;
  readonly bounds: { readonly min: TinkerV3; readonly max: TinkerV3 };
  /** Build zone (environments.md §0.9 / §0.10): the cutting mat (Desk) or the floor-mat square (Room); y = its top. */
  readonly neutral: { readonly min: TinkerV3; readonly max: TinkerV3 };
  /** Default orbit camera and target (same as cameras.default). */
  readonly camera: TinkerV3;
  readonly target: TinkerV3;
  /** default, and the key-art views: hero (the D79 proof frame), wide, lobby (title / lobby backdrop). */
  readonly cameras: { readonly default: TinkerCamera; readonly hero: TinkerCamera; readonly wide: TinkerCamera; readonly lobby: TinkerCamera };
  /** Multiplayer drone starts: P1 (-X), P2 (+X). */
  readonly drones: readonly [TinkerV3, TinkerV3];
  /** env_scale_ref placement (environments.md §0.7); its plinth / stick / THUD colliders are in boxes / spheres. */
  readonly scaleRef: TinkerV3;
  readonly boxes: readonly TinkerBox[];
  readonly spheres: readonly TinkerSphere[];
  /** The ambient sleeping MOCHI (display copy, environments.md §3.3): hidden, with its capsule, while the world
   *  has a MOCHI part. The capsule is not in boxes so it can be toggled. */
  readonly mochi: {
    readonly pos: TinkerV3; readonly yawDeg: number; readonly clip: string;
    readonly capsule: { readonly center: TinkerV3; readonly radius: number; readonly halfHeight: number; readonly axis: string };
    readonly phys: TinkerPhys;
  };
  /** Pendant bulbs (practical lights, environments.md §3.4): a downward cone under the enamel shade. candela =
   *  lumens over the outer cone's solid angle; `shadowed` = the centre bench pendant (12 GB and up). */
  readonly practicals: readonly {
    readonly pos: TinkerV3; readonly dir: TinkerV3; readonly kelvin: number; readonly color: TinkerV3;
    readonly lumens: number; readonly candela: number; readonly innerConeDeg: number; readonly outerConeDeg: number;
    readonly rangeM: number; readonly bulbRadiusM: number; readonly cyclesWatts: number; readonly shadowed: boolean;
    readonly zone: string;
  }[];
  /** Box-projected reflection probes and the GI probe volume (centre, half extents). */
  readonly probes: readonly { readonly name: string; readonly center: TinkerV3; readonly half: TinkerV3 }[];
  readonly giVolume: { readonly center: TinkerV3; readonly half: TinkerV3 };
  /** Ambience emitters (environments.md §3.7). */
  readonly emitters: readonly { readonly name: string; readonly pos: TinkerV3 }[];
}

export interface TinkerEnv {
  readonly env: 'tinker';
  /** Set scale: 1 (real scale, D82). */
  readonly scale: number;
  readonly gravity: 'earth';
  readonly air: number;
  readonly feel: 'real';
  /** Served at /env/tinker/tinker.glb (nodes LOD0..LOD3, BACKDROP, REF__scale__desk / __room, PROBES). */
  readonly glb: string;
  readonly presets: { readonly desk: TinkerPreset; readonly room: TinkerPreset };
  /** Golden-hour rig (environments.md §3.4 after D82). sunDir = direction the light travels. */
  readonly light: {
    readonly sunDir: TinkerV3; readonly sunElevationDeg: number; readonly sunAzimuthDeg: number; readonly sunFrom: string;
    readonly sunKelvin: number; readonly sunColor: TinkerV3; readonly sunLux: number; readonly sunAngleDeg: number;
    readonly skyFill: string; readonly windowSky: string; readonly fogDensity: number; readonly fogAnisotropy: number;
    readonly hazeLowTier: number; readonly practicalKelvin: number; readonly practicalLumens: number;
    readonly ev100: number; readonly autoExposureEv: number; readonly tonemap: string; readonly vignette: number;
    readonly grain: number;
  };
  /** Baked environment light: equirect Radiance HDR + SH9 (linear RGB, unnormalised irradiance coefficients). */
  readonly ibl: {
    readonly name: string; readonly file: string; readonly format: string; readonly size: readonly [number, number];
    readonly probe: TinkerV3; readonly sh9: readonly TinkerV3[];
  };
  /** Per-environment grading LUT (display space, after the tonemap). */
  readonly lut: { readonly name: string; readonly file: string; readonly size: number; readonly layout: string; readonly space: string };
  /** glb mesh-name prefixes drawn without casting shadows (window glazing bars, beams, pendants). */
  readonly noShadow: readonly string[];
  /** glb mesh-name prefixes drawn into the sun's shadow maps only, never shaded: the cutaway's invisible roof. */
  readonly shadowOnly: readonly string[];
  /** The invisible roof's lantern opening (set/Room coordinates, engine axes): the sun reaches the Room build
   *  zone through it; everywhere else it only comes in through the windows. */
  readonly roofLantern: { readonly roofY: number; readonly opening: { readonly min: TinkerV3; readonly max: TinkerV3 } };
}
'''


def write_ts(path, data, stats):
    lines = [TS_HEAD + '// ' + stats, TS_TYPES]
    lines.append('export const TINKER: TinkerEnv = %s;' % ts_literal(data))
    lines.append('')
    lines.append("export const TINKER_PRESETS = ['desk', 'room'] as const;")
    lines.append('')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))


# ---------------------------------------------------------------- IBL and LUT

def bake_ibl(root, cols, out_dir, samples):
    """Render a 2048 x 1024 equirect from IBL_PROBE with the key-art rig (Cycles), save Radiance HDR and SH9."""
    import numpy as np
    sc = bpy.context.scene
    hide = [c for n, c in cols.items() if n in ('LOD1', 'LOD2', 'LOD3', 'REF__desk')]
    for c in hide:
        c.hide_render = True
    for ob in sc.objects:  # the renderer's flags: no-shadow pieces, the shadow-only roof
        if ob.type == 'MESH' and '__noshadow' in ob.name:
            ob.visible_shadow = False
        if ob.type == 'MESH' and '__shadowonly' in ob.name:
            ob.visible_camera = ob.visible_glossy = False
    import render_lookdev as rl
    rl.use_cycles(sc, samples)
    sc.cycles.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 2048, 1024, 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    added = key_art_rig(sc)
    cd = bpy.data.cameras.new('ibl_cam')
    cd.type = 'PANO'
    if hasattr(cd, 'panorama_type'):
        cd.panorama_type = 'EQUIRECTANGULAR'
    else:
        cd.cycles.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new('ibl_cam', cd)
    sc.collection.objects.link(cam)
    cam.location = IBL_PROBE
    cam.rotation_euler = (math.radians(90), 0, 0)  # level, looking +Y: the equirect centre faces the back wall
    sc.camera = cam
    hdr = os.path.join(out_dir, 'ibl_tinker_lab.hdr')
    sc.render.image_settings.file_format = 'HDR'
    sc.render.filepath = hdr
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(hdr)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]          # rows bottom-up
    # SH9 projection (engine axes: y up). Pixel (i, j): theta from +Y (up) down, phi around.
    v = (np.arange(h) + 0.5) / h                # 0 bottom .. 1 top
    u = (np.arange(w) + 0.5) / w
    theta = (1.0 - v) * math.pi                 # 0 at the top row
    phi = (u - 0.5) * 2 * math.pi
    T, Ph = np.meshgrid(theta, phi, indexing='ij')
    T = T[::-1]                                  # match the bottom-up rows
    sx, sy, sz = np.sin(T) * np.sin(Ph), np.cos(T), -np.sin(T) * np.cos(Ph)
    dw = (2 * math.pi / w) * (math.pi / h) * np.sin(T)
    basis = [0.282095 * np.ones_like(sx), 0.488603 * sy, 0.488603 * sz, 0.488603 * sx, 1.092548 * sx * sy,
             1.092548 * sy * sz, 0.315392 * (3 * sz * sz - 1), 1.092548 * sx * sz, 0.546274 * (sx * sx - sy * sy)]
    sh = [[round(float((px[:, :, c] * b * dw).sum()), 5) for c in range(3)] for b in basis]
    mean = [round(float(px[:, :, c].mean()), 5) for c in range(3)]
    meta = {'name': 'ibl_tinker_lab', 'file': 'env/tinker/ibl_tinker_lab.hdr', 'format': 'equirect-hdr',
            'size': [w, h], 'probe': eng(IBL_PROBE), 'sh9': sh, 'meanRadiance': mean, 'samples': samples,
            'note': 'Cycles bake of tinker.glb LOD0 + backdrop with the key-art rig (render_tinker_lab.py); '
                    'centre column faces the back wall (engine -Z)'}
    with open(os.path.join(out_dir, 'ibl_tinker_lab.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    for ob in added + [cam]:
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in hide:
        c.hide_render = False
    return meta


def key_art_rig(sc):
    """The key art's light (render_tinker_lab.light_and_world), without its ceiling: sun from behind-right, a cool
    sky, a warm floor bounce. Returns the objects it added."""
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.42, 0.5, 0.62, 1)
    bg.inputs[1].default_value = 0.22
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy, sun.angle = 9.0, math.radians(1.2)
    sun.color = (1.0, 0.74, 0.47)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = SUN_TRAVEL.to_track_quat('-Z', 'Y').to_euler()
    out = [so]
    for (x, y, z) in BENCH_LAMPS + SIDE_LAMPS:
        ld = bpy.data.lights.new('lamp', 'POINT')
        ld.energy, ld.shadow_soft_size, ld.color = 70, 0.05, (1.0, 0.78, 0.52)
        lo = bpy.data.objects.new('lamp', ld)
        sc.collection.objects.link(lo)
        lo.location = (x, y, z - 0.06)
        out.append(lo)
    return out


def lgg(s, lift, gain):
    """Blender's Color Balance lift / gain (gamma 1) on an sRGB-encoded value, as in the key-art compositor."""
    x = ((s - 1.0) * (2.0 - lift) + 1.0) * gain
    return max(0.0, x)


def write_lut(out_dir):
    """32^3 LUT strip of the key art's grade (render_tinker_lab.post): lift (1, .99, .97), gain (1.05, 1, .93),
    a gentle S-curve to move Khronos PBR Neutral toward AgX High Contrast, saturation 1.04. Display space."""
    import numpy as np
    n = 32
    lift, gain = (1.0, 0.99, 0.97), (1.05, 1.0, 0.93)
    img = np.zeros((n, n * n, 4), dtype=np.float32)
    g = np.linspace(0.0, 1.0, n)
    for b in range(n):
        for gy in range(n):
            for r in range(n):
                c = [g[r], g[gy], g[b]]
                c = [lgg(c[i], lift[i], gain[i]) for i in range(3)]
                c = [v + 0.06 * math.sin(2 * math.pi * min(1.0, v)) * -1.0 * 0.5 for v in c]  # soft S: darker mids low
                lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
                c = [min(1.0, max(0.0, lum + (v - lum) * 1.04)) for v in c]
                img[gy, b * n + r] = (c[0], c[1], c[2], 1.0)
    im = bpy.data.images.new('lut_tinker_lab', n * n, n, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(img[::-1].ravel())      # Blender rows run bottom-up; row 0 = green 0 at the top
    path = os.path.join(out_dir, 'lut_tinker_lab.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return path


# ---------------------------------------------------------------- main

def main():
    args = _cli.script_args()
    no_ts = _cli.flag(args, '--no-ts')
    no_blend = _cli.flag(args, '--no-blend')
    no_bake = _cli.flag(args, '--no-bake')
    ibl_samples = int(_cli.option(args, '--ibl-samples', '128'))
    root = paths.repo_root()
    library.ensure_libs(root)
    load_all()
    sc, cols = setup_scene(('LOD0', 'LOD1', 'LOD2', 'LOD3', 'BACKDROP', 'REF__desk', 'REF__room', 'COL', 'BOUNDS',
                            'SPAWN', 'ZONE', 'PROBE', 'EMIT'))
    fdir = os.path.join(root, 'assets', 'src', 'lib', 'fonts')
    fonts = {'sym': bpy.data.fonts.load(os.path.join(fdir, 'DejaVuSans-Bold.ttf'))}
    builds = [build(lod, fonts) for lod in range(4)]
    names = sorted({m for S in builds for k in S.pieces.values() for m in k.mats})
    bad = [m for m in names if not is_master_material(m)]
    if bad:
        _cli.die('not master materials: %s' % ', '.join(bad))
    mats = library.link_materials(paths.materials_lib(root), names)
    for S in builds:
        to_objects(S, ENV, mats, cols)
    S0 = builds[0]
    tris = [tri_count(list(cols['LOD%d' % i].objects)) for i in range(4)]
    bd = tri_count(list(cols['BACKDROP'].objects))
    refs = tri_count(list(cols['REF__desk'].objects)) + tri_count(list(cols['REF__room'].objects))
    for i, t in enumerate(tris):
        print('  LOD%d: %d tris (%.1f %%)' % (i, t, 100.0 * t / tris[0]))
    bad_geo = []
    for o in [o for c in cols.values() for o in c.objects if o.type == 'MESH']:
        for v in o.data.vertices:
            if not all(math.isfinite(c) and abs(c) < 100 for c in v.co):
                bad_geo.append(o.name)
                break
    if bad_geo:
        _cli.die('non-finite or far-out vertices in: %s' % ', '.join(bad_geo))
    if os.environ.get('KN_PIECES'):
        per = sorted(((tri_count([o]), o.name) for o in cols['LOD0'].objects), reverse=True)
        for t, n in per[:25]:
            print('    %7d  %s' % (t, n))
    print('  backdrop %d tris, scale refs %d tris, %d collider boxes + %d spheres, %d masters, %d kit props used'
          % (bd, refs, len(S0.boxes), len(S0.spheres), len(names),
             len({p[1][5:] for p in S0.pieces if p[1].startswith('prop_')})))
    # markers (source .blend only)
    add_box_markers(cols['COL'], S0.boxes)
    for preset, p in PRESETS.items():
        lo, hi = p['bounds']
        empty(cols['BOUNDS'], 'BOUNDS__' + preset, [(a + b) / 2 for a, b in zip(lo, hi)],
              [(b - a) / 2 for a, b in zip(lo, hi)], 'CUBE')
        nl, nh = p['neutral']
        empty(cols['ZONE'], 'ZONE__neutral__' + preset, ((nl[0] + nh[0]) / 2, (nl[1] + nh[1]) / 2, nl[2] + 0.025),
              ((nh[0] - nl[0]) / 2, (nh[1] - nl[1]) / 2, 0.025), 'CUBE')
        for nm, loc in (('camera', p['camera']), ('target', p['target']), ('drone__p1', p['drones'][0]),
                        ('drone__p2', p['drones'][1]), ('scale_ref', p['scale_ref'])):
            empty(cols['SPAWN'], 'SPAWN__%s__%s' % (nm, preset), loc)
    for name, c in CAMERAS.items():
        empty(cols['SPAWN'], 'SPAWN__camera_%s__desk' % name, c['pos'])
    for n, c, h in PROBES:
        empty(cols['PROBE'], 'PROBE__reflect__' + n, c, h, 'CUBE')
    empty(cols['PROBE'], 'PROBE__gi_volume__0', GI_VOLUME[0], GI_VOLUME[1], 'CUBE')
    empty(cols['PROBE'], 'PROBE__ibl__0', IBL_PROBE, None, 'SPHERE')
    out_dir = os.path.join(root, 'assets', 'build', 'env', ENV)
    os.makedirs(out_dir, exist_ok=True)
    if not no_blend:
        src = os.path.join(root, 'assets', 'src', 'env', ENV, 'tinker_set.blend')
        os.makedirs(os.path.dirname(src), exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=src, compress=True, relative_remap=True)
        print('saved', src)
    glb = os.path.join(out_dir, 'tinker.glb')
    export_glb(cols, {'LOD0': 'LOD0', 'LOD1': 'LOD1', 'LOD2': 'LOD2', 'LOD3': 'LOD3', 'BACKDROP': 'BACKDROP',
                      'REF__desk': 'REF__scale__desk', 'REF__room': 'REF__scale__room', 'PROBE': 'PROBES'}, glb)
    write_lut(out_dir)
    ibl_json = os.path.join(out_dir, 'ibl_tinker_lab.json')
    if no_bake and os.path.exists(ibl_json):
        with open(ibl_json, encoding='utf-8') as f:
            ibl = json.load(f)
    else:
        ibl = bake_ibl(root, cols, out_dir, ibl_samples)
    ibl_ts = {k: ibl[k] for k in ('name', 'file', 'format', 'size', 'probe', 'sh9')}
    data = env_data(S0, ibl_ts)
    nb = {k: len(v['boxes']) for k, v in data['presets'].items()}
    ns = {k: len(v['spheres']) for k, v in data['presets'].items()}
    stats = 'LOD0..3 tris %s · backdrop %d · Desk %d boxes + %d spheres · Room %d boxes + %d spheres · %d masters' % (
        ' / '.join(str(t) for t in tris), bd, nb['desk'], ns['desk'], nb['room'], ns['room'], len(names))
    full = dict(data)
    full['stats'] = {'lodTris': tris, 'backdropTris': bd, 'scaleRefTris': refs, 'masters': names,
                     'props': sorted({p[1][5:] for p in S0.pieces if p[1].startswith('prop_')})}
    with open(os.path.join(out_dir, 'tinker.env.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(full, f, indent=1)
        f.write('\n')
    if not no_ts:
        write_ts(os.path.join(root, 'packages', 'parts-data', 'src', 'env_tinker.ts'), data, stats)
    print('exported', glb, '·', stats)
    _ = PROPS


if __name__ == '__main__':
    main()
