"""Procedurally build the ORBITAL HANGAR (environments.md §5): two bays, each its own set built to fit its preset,
Warehouse = "Bay 2" and Arena = "Main Hall". Clean white panelled walls, a huge window with Earth outside, cool
ceiling strips, warm amber accents at the airlocks and docking clamps, a parked toy shuttle on clamps, a gantry
crane, cargo stacks, and glowing floor rings that mark the environment's zero-g zones.

Usage: blender -b --factory-startup -P tools/blender/env_hangar.py -- [--no-ts] [--no-blend] [--no-bake]
                                                                       [--ibl-samples N]
       blender -b --factory-startup -P tools/blender/env_hangar.py -- --render <out.png> [--bay B] [--samples N]
   or: node tools/assets.mjs --env-hangar [--render]

Outputs
  assets/src/env/hangar/hangar_<bay>.blend         source (ENV_RENDER/LOD1..3, BACKDROP, EXTRA, COL, BOUNDS, SPAWN,
                                                   ZONE, PROBE)
  assets/build/env/hangar/hangar_<bay>.glb         LOD0..LOD2 > CHUNK__<cx>_<cy> > meshes, LOD3 > HLOD__<hx>_<hy>,
                                                   BACKDROP, REF__scale__<bay>, ZONE__field__zerog_<n>, PROBES
  assets/build/env/hangar/ibl_hangar_<bay>.hdr     equirect 2048 x 1024 Radiance HDR, Cycles-baked from the bay and rig
  assets/build/env/hangar/ibl_hangar_<bay>.json    probe, SH9, bake sun strength
  assets/build/env/hangar/lut_hangar.png           32^3 grading LUT strip: slightly cool shadows, neutral highlights
  assets/build/env/hangar/hangar.env.json          the generated data as JSON (tooling; the renderer reads noShadow)
  packages/parts-data/src/env_hangar.ts            generated literals for the sim and the renderer (M5 contract 4)

Set coordinates: Blender metres, Z up, origin = the bay's bounds floor centre (the engine origin), +Y = the back
wall with the window (away from the default camera). The sun comes in through that window from +Y at 30 deg.
"""
import json
import re
import math
import os
import random
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402

from kn_tools import envset, library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import at, outline_circle, outline_rrect  # noqa: E402
from props.core import PROPS, load_all, place  # noqa: E402
from props.envkit import SetBuilder, add_box_markers, empty, eng, eng_box, eng_dir, eng_minmax, ts_literal  # noqa: E402

ENV = 'hangar'
SpaceSet = envset.make_builder(SetBuilder)

PANEL, DECK, SEAM = 'kn_env_panel_white', 'kn_env_deck', 'kn_env_deck_seam'
DECK_ALT = 'kn_env_deck_alt'


def vary(p):
    """A deterministic 0..1 value from a position (panel / tile tone variation)."""
    v = math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453
    return v - math.floor(v)


# ART (beta polish, D128): wall / ceiling panel tones vary per *run* (the panels between two structural ribs, the full
# wall height; on the ceiling, the strip between two beams), not per panel: E5c's per-panel hash read as a patchwork in
# engine. The tones themselves sit within ~0.16 stop of panel_white (masters.py), so the rhythm stays gentle.
PANEL_TONES = ((0.50, PANEL), (0.85, 'kn_env_panel_grey'), (1.01, 'kn_env_panel_warm'))   # cumulative shares
DECK_ALT_SHARE = 0.30      # share of deck blocks (rib-sized groups of 4 m tiles) in the darker deck_alt


def panel_tone(t):
    """Panel master for a run's 0..1 tone value."""
    return next(m for edge, m in PANEL_TONES if t < edge)
GRAPH, AMBER, COBALT, BONE, IGN = ('kn_powder_graphite', 'kn_powder_amber', 'kn_powder_cobalt', 'kn_powder_bone',
                                   'kn_powder_ignition')
STEEL, AGRAPH = 'kn_steel_brushed', 'kn_anod_graphite'
FIELD = '#FF3DAE'
SUN_EL = 30.0
SUN_TRAVEL = Vector((0.0, -math.cos(math.radians(SUN_EL)), -math.sin(math.radians(SUN_EL))))   # from +Y, down
EARTH_EL = -10.0   # Earthlight comes from below the window line (§5.3): it travels toward -Y and up
EARTH_TRAVEL = Vector((0.0, -math.cos(math.radians(EARTH_EL)), -math.sin(math.radians(EARTH_EL))))
WALL_T = 0.6       # wall / ceiling structure thickness
KICK = 0.6         # graphite kick plate height

BAYS = {
    'warehouse': {
        'title': 'Bay 2', 'half': 32.0, 'H': 24.0, 'W': 33.0, 'C': 26.0, 'open_front': True,
        'window': {'x': 28.0, 'z0': 3.0, 'z1': 21.0, 'cols': 4, 'rows': 2},
        'neutral': ((-8.0, -20.0), (8.0, -4.0)),
        'target': (0.0, -10.0, 1.0), 'camera': (0.0, -42.0, 19.5), 'fov': 40.0,
        'scale_ref': (10.5, -21.5, 0.0), 'drones': ((-5.0, -34.0, 8.0), (5.0, -34.0, 8.0)),
        'zones': [(-18.0, 14.0, 6.0, 20.0), (18.0, 14.0, 6.0, 20.0)],
        'shuttles': [(0.0, 20.0)], 'gantry': [(6.0, 22.0, -10.0, 12.0)],
        'airlocks': [('-x', -10.0), ('+x', -10.0)], 'door': (7.0, 8.0, 0.9),
        'stacks': [(-26.0, -24.0), (26.0, -24.0)],
        'carts': [(-9.0, 12.0, 20.0), (9.5, 27.0, -15.0)],
        'panel': 4.0, 'panel_hi': 4.0, 'ceil_panel': 4.0, 'rib': 8.0, 'bolts': True,
        'strips': (8, 6), 'sconces_extra': False,
        'screens': [((-1, 0), 4.0), ((-1, 0), -22.0), ((1, 0), 4.0), ((1, 0), -22.0), ((0, 1), -24.75), ((0, 1), 24.75)],
        'cameras': {   # look-dev / photo / lobby views (set space)
            'hero': {'pos': (-15.0, -15.0, 3.6), 'target': (2.0, 20.0, 7.5), 'lens': 24, 'focus': 37.0, 'fstop': 5.6},
            'wide': {'pos': (26.0, -29.0, 15.0), 'target': (-4.0, 8.0, 5.0), 'lens': 20, 'focus': 40.0, 'fstop': 8.0},
            'lobby': {'pos': (-8.0, -2.0, 2.0), 'target': (-18.0, 14.0, 2.6), 'lens': 40, 'focus': 18.8,
                      'fstop': 2.8},
        },
        'probes': [('front', (0.0, -18.0, 6.0), (32.0, 15.0, 6.0)), ('back', (0.0, 17.0, 6.0), (32.0, 16.0, 6.0)),
                   ('shuttle', (0.0, 20.0, 5.0), (10.0, 12.0, 5.0)), ('high', (0.0, 0.0, 18.0), (32.0, 32.0, 7.0))],
        'ibl_probe': (0.0, -6.0, 2.0),
        'earth_d': 600.0, 'stars_d': 1600.0,
    },
    'arena': {
        'title': 'Main Hall', 'half': 128.0, 'H': 64.0, 'W': 130.0, 'C': 68.0, 'open_front': False,
        'window': {'x': 110.0, 'z0': 6.0, 'z1': 56.0, 'cols': 8, 'rows': 3},
        'neutral': ((-16.0, -40.0), (16.0, -8.0)),
        'target': (0.0, -20.0, 2.0), 'camera': (0.0, -88.0, 41.0), 'fov': 40.0,
        'scale_ref': (18.5, -41.5, 0.0), 'drones': ((-8.0, -72.0, 20.0), (8.0, -72.0, 20.0)),
        'zones': [(-60.0, 40.0, 12.0, 50.0), (60.0, 40.0, 12.0, 50.0), (-60.0, -60.0, 12.0, 50.0),
                  (60.0, -60.0, 12.0, 50.0)],
        'shuttles': [(-70.0, 80.0), (70.0, 80.0)], 'gantry': [(0.0, 62.0, -24.0, 40.0), (60.0, 62.0, 30.0, 44.0)],
        'airlocks': [('-x', -10.0), ('+x', -10.0), ('-y', 0.0), ('+y', -120.0)], 'door': (12.0, 14.0, 1.4),
        'stacks': [(-122.0, -90.0), (-122.0, -40.0), (-122.0, 30.0), (122.0, -90.0), (122.0, -40.0), (122.0, 30.0)],
        'carts': [(-58.0, 72.0, 15.0), (80.0, 68.0, -25.0), (-30.0, -100.0, 5.0), (40.0, -20.0, 80.0)],
        'panel': 4.0, 'panel_hi': 8.0, 'ceil_panel': 8.0, 'rib': 16.0, 'bolts': False,
        'strips': (11, 20), 'sconces_extra': True,
        'screens': [((-1, 0), 12.0), ((-1, 0), -66.0), ((1, 0), 12.0), ((1, 0), -66.0), ((0, 1), -97.5), ((0, 1), 97.5)],
        'cameras': {
            'hero': {'pos': (-40.0, -36.0, 7.0), 'target': (-62.0, 78.0, 14.0), 'lens': 24, 'focus': 116.0,
                     'fstop': 8.0},
            'wide': {'pos': (100.0, -112.0, 52.0), 'target': (-10.0, 20.0, 8.0), 'lens': 18, 'focus': 150.0,
                     'fstop': 11.0},
            'lobby': {'pos': (-44.0, -38.0, 2.6), 'target': (-60.0, -60.0, 3.2), 'lens': 40, 'focus': 27.0,
                      'fstop': 2.8},
        },
        'probes': [('q%d%d' % (i, j), (-96.0 + 64.0 * i, -96.0 + 64.0 * j, 12.0), (32.0, 32.0, 12.0))
                   for i in range(4) for j in range(4)],
        'ibl_probe': (0.0, -18.0, 3.0),
        'earth_d': 1500.0, 'stars_d': 1900.0,   # inside the renderer's 2 km far plane
    },
}


def lens_fov(lens):
    """Vertical FOV (deg) of a 36 mm-wide sensor at 16 : 9."""
    return round(math.degrees(2 * math.atan(36 / 16 * 9 / 2 / lens)), 2)


def kelvin_rgb(k):
    """Blackbody colour (normalised, peak 1) for the light data and the bake rig (Tanner Helland's fit)."""
    t = k / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [min(255.0, max(0.0, v)) / 255.0 for v in (r, g, b)]
    m = max(c)
    return [round(v / m, 3) for v in c]


# ---------------------------------------------------------------- primitives

def box_corners(lo, hi):
    return [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def bx(S, piece, lo, hi, mat, r=0.0, cs=1, col=False, phys='powder', name=None, group='set', preset=None, M=None):
    """Axis-aligned (or M-placed) box: rounded at LOD0/1 when r > 0, a 12-tri hull otherwise."""
    lo, hi = Vector(lo), Vector(hi)
    size = hi - lo
    c = (lo + hi) / 2
    k = S.kit(piece, group)
    rr = min(r, min(size) * 0.45)
    cseg = 0 if S.lod >= 2 else (cs if S.lod == 0 else min(cs, 1))
    if rr <= 0.0005 or cseg == 0:
        k.hull(box_corners(lo, hi), mat, m=M)
    else:
        k.rbox(tuple(size), tuple(c), rr, mat, cseg=cseg, m=M)
    if col:
        S.collider(name or piece, lo, hi, phys, M, preset)


def wall_frame(origin, n):
    """Matrix: local X along the wall (right when facing it), local Y up, local Z = the wall's inward normal n.
    For the ceiling (n down) local Y is +Y."""
    n = Vector(n).normalized()
    u = Vector((0.0, 1.0, 0.0)) if abs(n.z) > 0.9 else Vector((0.0, 0.0, 1.0))
    r = u.cross(n).normalized()
    u = n.cross(r).normalized()
    M = Matrix.Identity(4)
    for i in range(3):
        M[i][0], M[i][1], M[i][2], M[i][3] = r[i], u[i], n[i], origin[i]
    return M


def bxm(S, piece, M, u0, u1, v0, v1, w0, w1, mat, r=0.0):
    """Box on a wall frame M: local (u, v, w) = along, up, out of the wall."""
    k = S.kit(piece)
    size = (u1 - u0, v1 - v0, w1 - w0)
    c = ((u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2)
    rr = min(r, min(size) * 0.45)
    if S.lod >= 2 or rr < 0.001:
        k.hull(box_corners((u0, v0, w0), (u1, v1, w1)), mat, m=M)
    else:
        k.rbox(size, c, rr, mat, cseg=1 if S.lod else 2, m=M)


def tiles(a0, a1, target):
    n = max(1, int(round((a1 - a0) / target)))
    w = (a1 - a0) / n
    return [(a0 + i * w, a0 + (i + 1) * w) for i in range(n)]


def spans(a0, a1, step=envset.CHUNK):
    """[a0, a1] cut at the 32 m chunk grid (so long structure stays chunk-local)."""
    cuts = [a0] + [step * k for k in range(int(math.floor(a0 / step)) + 1, int(math.ceil(a1 / step)))] + [a1]
    return [(a, b) for a, b in zip(cuts, cuts[1:]) if b - a > 1e-6]


def panel(S, piece, M, u0, u1, v0, v1, t=0.12, bolts=True, mat=PANEL):
    """A rounded white wall panel on frame M from (u0, v0) to (u1, v1), back at local w = 0, with a 25 mm gap
    all round (the seam shows the dark structure) and M8 screw heads in the corners (LOD0). `mat` is the run's tone
    (panel_rect picks it per rib run, D128)."""
    g = 0.025
    w, h = u1 - u0 - 2 * g, v1 - v0 - 2 * g
    if w < 0.2 or h < 0.2:
        return
    cx, cy = (u0 + u1) / 2, (v0 + v1) / 2
    k = S.kit(piece)
    if S.lod >= 2:
        k.hull(box_corners((cx - w / 2, cy - h / 2, 0.0), (cx + w / 2, cy + h / 2, t)), mat, m=M)
        return
    cs = 2 if S.lod == 0 else 1
    k.prism(outline_rrect(w, h, 0.07, cs), 0.0, t, mat, bt=0.02 if S.lod == 0 else 0.0, bseg=1, m=M @ at(cx, cy, 0))
    if bolts and S.lod == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                k.cyl(0.022, t, t + 0.01, STEEL, 6, m=M @ at(cx + sx * (w / 2 - 0.14), cy + sy * (h / 2 - 0.14), 0))


def panel_rect(S, piece, M, u0, u1, v0, v1, size, bolts=True, avoid=(), run=8.0, along='u'):
    """Tile a wall rectangle with panels of about `size` metres, skipping panels that touch an `avoid` rect
    (doors). Returns the bounding rect of the skipped panels per avoid rect (the door surround fills it).
    D128: the tone is one per run of panels about `run` metres long (the rib spacing) along `along` ('u' = vertical
    stripes the full wall height, 'v' = the ceiling's strips between beams), counted from (u0, v0), so bands of
    different panel sizes over the same u0 share their runs' tones."""
    holes = [None] * len(avoid)
    us, vs = tiles(u0, u1, size), tiles(v0, v1, size)
    step = (us if along == 'u' else vs)[0]
    per = max(1, int(round(run / (step[1] - step[0]))))
    for i, (a, b) in enumerate(us):
        for j, (c, d) in enumerate(vs):
            hit = [q for q, (au0, au1, av0, av1) in enumerate(avoid) if a < au1 and b > au0 and c < av1 and d > av0]
            if hit:
                for q in hit:
                    h = holes[q]
                    holes[q] = (a, b, c, d) if h is None else (min(h[0], a), max(h[1], b), min(h[2], c), max(h[3], d))
                continue
            r = (i if along == 'u' else j) // per
            key = (u0 + (r + 0.37) * run, -3.71, 0.0) if along == 'u' else (-3.71, v0 + (r + 0.37) * run, 0.0)
            panel(S, piece, M, a, b, c, d, bolts=bolts, mat=panel_tone(vary(M @ Vector(key))))
    return holes


# ---------------------------------------------------------------- shell: deck, walls, ceiling, window

def deck(S, B):
    """4 x 4 m anti-slip deck tiles (instanced), chamfered, 12 mm seams over a dark backing; one steel deck box."""
    W = B['W']
    for x0, x1 in spans(-W, W):
        for y0, y1 in spans(-W, W):
            bx(S, 'deck_backing', (x0, y0, -0.9), (x1, y1, -0.03), SEAM)
            if S.lod >= 2:
                bx(S, 'deck', (x0, y0, -0.06), (x1, y1, 0.0), DECK)
    if S.lod <= 1:
        n = int(round(2 * W / 4.0))
        w = 2 * W / n
        g = 0.012
        k = S.kit('deck')
        per = max(1, int(round(B['rib'] / w)))      # D128: tone per rib-sized block of tiles, not per tile
        (zx0, zy0), (zx1, zy1) = B['neutral']

        def block_mat(i, j):
            bi, bj = i // per, j // per
            x0, y0 = -W + bi * per * w, -W + bj * per * w
            x1, y1 = min(W, x0 + per * w), min(W, y0 + per * w)
            # §0.9: the neutral zone (and a 2 m margin) is one material, so a block touching it stays plain deck
            touches = x0 < zx1 + 2.0 and x1 > zx0 - 2.0 and y0 < zy1 + 2.0 and y1 > zy0 - 2.0
            alt = not touches and vary(Vector((bi * 7.3 + 0.5, bj * 5.1 + 0.25, 0.0))) < DECK_ALT_SHARE
            return DECK_ALT if alt else DECK

        for i in range(n):
            for j in range(n):
                cx, cy = -W + (i + 0.5) * w, -W + (j + 0.5) * w
                if S.lod == 0:
                    dm = block_mat(i, j)
                    k.prism(outline_rrect(w - g, w - g, 0.03, 1), -0.06, 0.0, dm, bt=0.008, bseg=1, m=at(cx, cy, 0))
                    if B['bolts']:
                        for sx in (-1, 1):
                            for sy in (-1, 1):
                                k.cyl(0.03, -0.004, 0.003, STEEL, 6,
                                      m=at(cx + sx * (w / 2 - 0.16), cy + sy * (w / 2 - 0.16), 0))
                else:
                    h = (w - g) / 2
                    k.hull(box_corners((cx - h, cy - h, -0.06), (cx + h, cy + h, 0.0)), block_mat(i, j))
    # the sim's deck: one steel box (a single shape: no seams for sliding parts to catch on; §5.5)
    S.collider('deck', (-W - 1.0, -W - 1.0, -1.0), (W + 1.0, W + 1.0, 0.0), 'steel')


def door_rects(B):
    """Per wall side: the door surround rect in that wall's panel frame (u along the wall, v up)."""
    dw, dh, fw = B['door']
    out = {}
    for side, c in B['airlocks']:
        u = c if side in ('-x', '+y') else -c
        out.setdefault(side, []).append((u - dw / 2 - fw - 0.05, u + dw / 2 + fw + 0.05, 0.0, dh + fw + 0.05))
    return out


SIDES = {'-x': ((-1, 0, 0), (1, 0, 0)), '+x': ((1, 0, 0), (-1, 0, 0)), '+y': ((0, 1, 0), (0, -1, 0)),
         '-y': ((0, -1, 0), (0, 1, 0))}


def walls(S, B):
    """Wall structure, kick plates and 4 m white panels on the side / back (/ front) walls, the window opening and
    the doors left out (the door surrounds fill the skipped panels), the ceiling panels, and Bay 2's cutaway front
    wall. One collision box per wall (split round the window)."""
    W, C, size, hi = B['W'], B['C'], B['panel'], B['panel_hi']
    T = WALL_T
    wx = B['window']['x'] + 0.8
    z0w, z1w = B['window']['z0'] - 0.8, B['window']['z1'] + 0.8
    for a, b in spans(-W - T, W + T):
        bx(S, 'wall_structure', (-W - T, a, 0.0), (-W, b, C + T), SEAM)
        bx(S, 'wall_structure', (W, a, 0.0), (W + T, b, C + T), SEAM)
        for c, d in spans(-W - T, W + T):
            bx(S, 'ceiling_structure', (a, c, C), (b, d, C + T), SEAM)
        if not B['open_front']:
            bx(S, 'wall_structure', (a, -W - T, 0.0), (b, -W, C + T), SEAM)
        if b <= -wx or a >= wx:
            bx(S, 'wall_structure', (a, W, 0.0), (b, W + T, C + T), SEAM)
        else:
            aa, bb = max(a, -wx), min(b, wx)
            if a < aa:
                bx(S, 'wall_structure', (a, W, 0.0), (aa, W + T, C + T), SEAM)
            if bb < b:
                bx(S, 'wall_structure', (bb, W, 0.0), (b, W + T, C + T), SEAM)
            bx(S, 'wall_structure', (aa, W, 0.0), (bb, W + T, z0w), SEAM)
            bx(S, 'wall_structure', (aa, W, z1w), (bb, W + T, C + T), SEAM)
    S.collider('wall_left', (-W - T, -W - T, 0.0), (-W, W + T, C), 'powder')
    S.collider('wall_right', (W, -W - T, 0.0), (W + T, W + T, C), 'powder')
    S.collider('ceiling', (-W - T, -W - T, C), (W + T, W + T, C + T), 'powder')
    for lo, hi_ in (((-W, W, 0.0), (-wx, W + T, C)), ((wx, W, 0.0), (W, W + T, C)), ((-wx, W, 0.0), (wx, W + T, z0w)),
                    ((-wx, W, z1w), (wx, W + T, C))):
        S.collider('wall_back', lo, hi_, 'powder')
    if not B['open_front']:
        S.collider('wall_front', (-W, -W - T, 0.0), (W, -W, C), 'powder')
    doors = door_rects(B)
    split = 16.0 if hi != size else C
    S.door_holes = {}
    for side, (o, n) in SIDES.items():
        if side == '-y' and B['open_front']:
            continue
        M = wall_frame(tuple(W * v for v in o), n)
        avoid = doors.get(side, [])
        # kick plate, broken at the doors
        cuts = sorted((a, b) for a, b, _c, _d in avoid)
        u = -W
        k = S.kit('kick_plate')
        for a, b in cuts + [(W, W)]:
            if a - u > 0.1:
                if S.lod <= 1:
                    k.prism(outline_rrect(a - u, KICK, 0.04, 1 if S.lod == 0 else 0), 0.0, 0.16, GRAPH,
                            bt=0.02 if S.lod == 0 else 0.0, bseg=1, m=M @ at((u + a) / 2, KICK / 2, 0))
                else:
                    k.hull(box_corners((u, 0.0, 0.0), (a, KICK, 0.16)), GRAPH, m=M)
            u = b
        bolts = B['bolts']
        if side == '+y':
            regions = [(-W, -wx, KICK, split, size, bolts), (wx, W, KICK, split, size, bolts),
                       (-wx, wx, KICK, z0w, size, bolts)]
            if split < C:
                regions += [(-W, -wx, split, C, hi, False), (wx, W, split, C, hi, False)]
            regions.append((-wx, wx, z1w, C, hi if z1w >= split else size, bolts and z1w < split))
        else:
            regions = [(-W, W, KICK, split, size, bolts)] + ([(-W, W, split, C, hi, False)] if split < C else [])
        holes = [None] * len(avoid)
        for u0, u1, v0, v1, sz, bl in regions:
            got = panel_rect(S, 'panels', M, u0, u1, v0, v1, sz, bl, avoid, run=B['rib'])
            for i, h in enumerate(got):
                if h is not None:
                    o_ = holes[i]
                    holes[i] = h if o_ is None else (min(o_[0], h[0]), max(o_[1], h[1]), min(o_[2], h[2]),
                                                     max(o_[3], h[3]))
        S.door_holes[side] = holes
    M = wall_frame((0, 0, C), (0, 0, -1))
    panel_rect(S, 'ceiling_panels', M, -W, W, -W, W, B['ceil_panel'], False, run=B['rib'], along='v')
    if B['open_front']:
        front_cutaway(S, B)
        # the cutaway section (side walls, ceiling and deck edges facing the camera), trimmed in graphite
        bx(S, 'cut_trim', (-W - T - 0.05, -W - 0.12, -0.9), (-W + 0.15, -W + 0.12, C + T + 0.05), GRAPH, r=0.04)
        bx(S, 'cut_trim', (W - 0.15, -W - 0.12, -0.9), (W + T + 0.05, -W + 0.12, C + T + 0.05), GRAPH, r=0.04)
        bx(S, 'cut_trim', (-W - T, -W - 0.12, C - 0.15), (W + T, -W + 0.12, C + T + 0.05), GRAPH, r=0.04)
        bx(S, 'cut_trim', (-W - T, -W - 0.14, -0.9), (W + T, -W + 0.02, -0.02), GRAPH, r=0.03)
        bx(S, 'cut_trim', (-W - T, -W - 0.17, -0.62), (W + T, -W - 0.13, -0.38), COBALT, r=0.015)


def front_cutaway(S, B):
    """Bay 2's front wall: the brief puts the spawn camera at Y -42, outside the wall at Y -33, so the wall is
    single-sided quads facing in (the engine back-face culls it from outside; the IBL and inside views see it)."""
    S.cutaway.add('front_wall')
    W, C = B['W'], B['C']
    k = S.kit('front_wall')
    bm = k.bm

    def quad(x0, x1, z0, z1, yy, mat):
        vs = [bm.verts.new(p) for p in ((x1, yy, z0), (x0, yy, z0), (x0, yy, z1), (x1, yy, z1))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.y < 0:
            f.normal_flip()
        f.material_index = k.mi(mat)

    quad(-W, W, 0.0, C, -W - 0.05, SEAM)
    step = 4.0 if S.lod <= 1 else 2 * W
    for a, b in tiles(-W, W, step):
        for c, d in tiles(KICK, C, step if S.lod <= 1 else C):
            quad(a + 0.025, b - 0.025, c + 0.025, d - 0.025, -W, PANEL)
    quad(-W, W, 0.0, KICK, -W + 0.01, GRAPH)


def window(S, B):
    """The big window: graphite outer frame, mullion grid (cols x rows), glass (no shadow: the sun patch carries
    the frame's shadows only), a cobalt bead and bolts. Frames collide (steel); the glass plane is a glass box."""
    W = B['W']
    wd = B['window']
    x, z0, z1 = wd['x'], wd['z0'], wd['z1']
    fw = 0.8
    y0, y1 = W - 0.3, W + 0.6
    S.noshadow.add('window_glass')
    bx(S, 'window_frame', (-x - fw, y0, z0 - fw), (x + fw, y1, z0), GRAPH, r=0.12, cs=2, col=True, phys='steel',
       name='window_sill')
    bx(S, 'window_frame', (-x - fw, y0, z1), (x + fw, y1, z1 + fw), GRAPH, r=0.12, cs=2, col=True, phys='steel',
       name='window_head')
    for sx in (-1, 1):
        a, b = sorted((sx * x, sx * (x + fw)))
        bx(S, 'window_frame', (a, y0, z0), (b, y1, z1), GRAPH, r=0.12, cs=2, col=True, phys='steel', name='window_jamb')
    mw = 0.45 if W < 50 else 0.9
    for i in range(1, wd['cols']):
        mx = -x + 2 * x * i / wd['cols']
        bx(S, 'window_frame', (mx - mw / 2, y0 + 0.1, z0), (mx + mw / 2, y1 - 0.1, z1), GRAPH, r=0.08, col=True,
           phys='steel', name='window_mullion')
    for j in range(1, wd['rows']):
        mz = z0 + (z1 - z0) * j / wd['rows']
        bx(S, 'window_frame', (-x, y0 + 0.1, mz - mw / 2), (x, y1 - 0.1, mz + mw / 2), GRAPH, r=0.08, col=True,
           phys='steel', name='window_transom')
    if S.lod <= 1:
        k = S.kit('window_trim')
        pts = [(-x - fw, y0 - 0.02, z0 - fw), (x + fw, y0 - 0.02, z0 - fw), (x + fw, y0 - 0.02, z1 + fw),
               (-x - fw, y0 - 0.02, z1 + fw)]
        k.sweep(pts, 0.06, S.seg(6, 4), COBALT, closed=True)
        if S.lod == 0:
            n = int(2 * x / 2.0)
            for i in range(n + 1):
                px = -x + 2 * x * i / n
                for pz in (z0 - fw / 2, z1 + fw / 2):
                    k.cyl(0.05, 0, 0.03, STEEL, 6, m=at(px, y0, pz) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    bx(S, 'window_glass', (-x, W + 0.12, z0), (x, W + 0.16, z1), 'kn_glass', col=True, phys='glass',
       name='window_glass')


# ---------------------------------------------------------------- structure: ribs, beams, lights

def ribs(S, B):
    """Structural ribs every 8 m (16 m in the Main Hall): graphite columns with a cobalt accent standing against
    the walls (none in front of doors or the window), and ceiling beams across X at the same stations. All
    outside the bounds: no colliders."""
    W, C, step = B['W'], B['C'], B['rib']
    dw, _dh, fw = B['door']
    clear = dw / 2 + fw + 1.0
    if step == 8.0:
        stations = [-32.0 + 8.0 * k for k in range(9)]
    else:
        stations = [-W + 1.0 + step * k for k in range(int((2 * W - 2) // step) + 1)]
    wx = B['window']['x'] + 0.8
    for s in stations:
        for side, sx in (('-x', -1), ('+x', 1)):
            if any(d == side and abs(s - c) < clear for d, c in B['airlocks']):
                continue
            if abs(s) > W - 1.5 and not B['open_front'] and s < 0:
                continue
            column(S, 'x', sx, s, W, C)
        for a, b in spans(-W, W):
            bx(S, 'ceiling_beams', (a, s - 0.45, C - 1.2), (b, s + 0.45, C - 0.12), GRAPH, r=0.08)
            if S.lod == 0:
                bx(S, 'ceiling_beams_accent', (a + 0.3, s - 0.2, C - 1.25), (b - 0.3, s + 0.2, C - 1.19), COBALT, r=0.02)
    walls_y = [('+y', 1)] + ([] if B['open_front'] else [('-y', -1)])
    for side, sy in walls_y:
        for s in stations:
            if abs(s) > W - 1.5 or (sy > 0 and abs(s) < wx + 0.6):
                continue
            if any(d == side and abs(s - c) < clear for d, c in B['airlocks']):
                continue
            column(S, 'y', sy, s, W, C)


def column(S, axis, sgn, s, W, C):
    """One rib column against wall `axis` = 'x' (side walls, at y = s) or 'y' (back / front, at x = s); sgn = the
    wall's side. Base plate, cobalt accent on its bay-facing face, bolts."""
    d, w = 0.7, 0.9
    face = sgn * (W - 0.12 - d)            # the bay-facing face coordinate
    wall = sgn * (W - 0.12)
    a, b = sorted((face, wall))
    if axis == 'x':
        lo, hi = (a, s - w / 2, 0.0), (b, s + w / 2, C - 0.12)
    else:
        lo, hi = (s - w / 2, a, 0.0), (s + w / 2, b, C - 0.12)
    bx(S, 'ribs', lo, hi, GRAPH, r=0.1, cs=2)
    if S.lod >= 2:
        return
    fa, fb = sorted((face, face - sgn * 0.02))
    pa, pb = sorted((face - sgn * 0.15, wall))
    if axis == 'x':
        bx(S, 'ribs_accent', (fa, s - 0.12, 0.8), (fb, s + 0.12, C - 1.6), COBALT, r=0.01)
        bx(S, 'ribs', (pa, s - 0.65, 0.0), (pb, s + 0.65, 0.18), GRAPH, r=0.04)
    else:
        bx(S, 'ribs_accent', (s - 0.12, fa, 0.8), (s + 0.12, fb, C - 1.6), COBALT, r=0.01)
        bx(S, 'ribs', (s - 0.65, pa, 0.0), (s + 0.65, pb, 0.18), GRAPH, r=0.04)
    if S.lod == 0:
        k = S.kit('ribs_bolts')
        for o in (-0.45, 0.45):
            p = (face - sgn * 0.08, s + o) if axis == 'x' else (s + o, face - sgn * 0.08)
            k.cyl(0.04, 0.18, 0.21, STEEL, 6, m=at(p[0], p[1], 0))


def ceiling_lights(S, B, lights):
    """Cool 6,500 K strip lights hung under the ceiling (graphite housing, emissive lens) and the 4 shadowed area
    panels over the neutral zone; their light data goes to `lights`."""
    W, C = B['W'], B['C']
    rows, cols = B['strips']
    ys = [-W + (j + 0.5) * 2 * W / rows for j in range(rows)]
    xs = [-W + (i + 0.5) * 2 * W / cols for i in range(cols)]
    L = 7.6
    zc = C - 1.45
    for y in ys:
        for x in xs:
            bx(S, 'light_strips', (x - 0.22, y - L / 2, zc), (x + 0.22, y + L / 2, zc + 0.16), GRAPH, r=0.03)
            bx(S, 'light_strips_lens', (x - 0.16, y - L / 2 + 0.08, zc - 0.03), (x + 0.16, y + L / 2 - 0.08, zc + 0.01),
               'kn_env_light_strip', r=0.01)
            if S.lod <= 1:
                for sy in (-1, 1):
                    S.sweep('light_strips_hangers', [(x, y + sy * (L / 2 - 0.5), zc + 0.16),
                                                     (x, y + sy * (L / 2 - 0.5), C - 0.12)], 0.012, STEEL, sides=4)
            if S.lod == 0:
                lights.append({'kind': 'strip', 'pos': (x, y, zc - 0.03), 'kelvin': 6500, 'lumens': 0, 'lengthM': L,
                               'shadowed': False, 'zone': 'ceiling'})
    (nx0, ny0), (nx1, ny1) = B['neutral']
    s = 0.12 * (nx1 - nx0)
    z = C - 1.9
    for fx in (0.25, 0.75):
        for fy in (0.25, 0.75):
            x, y = nx0 + (nx1 - nx0) * fx, ny0 + (ny1 - ny0) * fy
            bx(S, 'area_lights', (x - s / 2 - 0.15, y - s / 2 - 0.15, z), (x + s / 2 + 0.15, y + s / 2 + 0.15, z + 0.3),
               GRAPH, r=0.05)
            bx(S, 'area_lights_lens', (x - s / 2, y - s / 2, z - 0.04), (x + s / 2, y + s / 2, z + 0.01),
               'kn_env_light_strip', r=0.02)
            if S.lod <= 1:
                for sx_ in (-1, 1):
                    S.sweep('light_strips_hangers', [(x + sx_ * s / 2, y, z + 0.3), (x + sx_ * s / 2, y, C - 0.12)],
                            0.015, STEEL, sides=4)
            if S.lod == 0:
                lights.append({'kind': 'area', 'pos': (x, y, z - 0.04), 'kelvin': 6500, 'lumens': 0, 'sizeM': s,
                               'shadowed': True, 'zone': 'neutral'})


def sconce(S, x, y, z, n, lights, zone, scale=1.0):
    """Warm 2,700 K wall sconce: amber housing, glowing lens, facing n (horizontal unit vector)."""
    M = wall_frame((x, y, z), (n[0], n[1], 0.0)) @ Matrix.Scale(scale, 4)
    k = S.kit('sconces')
    if S.lod <= 1:
        cs = 2 if S.lod == 0 else 1
        k.prism(outline_rrect(0.5, 0.7, 0.12, cs), 0.0, 0.16, AMBER, bt=0.04, bseg=1, m=M)
        k.prism(outline_rrect(0.32, 0.5, 0.08, cs), 0.16, 0.22, 'kn_env_sconce', bt=0.02, bseg=1, m=M)
    else:
        k.hull(box_corners((-0.25, -0.35, 0.0), (0.25, 0.35, 0.2)), AMBER, m=M)
    if S.lod == 0:
        p = M @ Vector((0, 0, 0.3))
        lights.append({'kind': 'sconce', 'pos': tuple(p), 'dir': (n[0], n[1], -0.35), 'kelvin': 2700, 'lumens': 900,
                       'shadowed': False, 'zone': zone})


# ---------------------------------------------------------------- landmarks and props

SH_L, SH_R, SH_ZC, SH_ZS = 20.0, 2.4, 4.6, 0.86


def sh_rad(h):
    """Fuselage radius at h metres from the tail."""
    t = h / SH_L
    if t < 0.08:
        return SH_R * (0.82 + 0.18 * (t / 0.08) ** 0.5)
    if t < 0.66:
        return SH_R
    u = (t - 0.66) / 0.34
    return SH_R * math.sqrt(max(0.0, 1.0 - u ** 2.2))


def shuttle(S, sx, sy, lights):
    """The landmark: an original rounded toy shuttle, nose toward -Y, parked on four amber docking clamps. Bone
    body with an Ignition stripe, graphite belly and engines, Beam canopy. 10 hull colliders."""
    L, R, zc, zs = SH_L, SH_R, SH_ZC, SH_ZS
    k = S.kit('shuttle')
    segs = S.seg(64, 12)
    nst = S.seg(48, 10)
    prof = [(0.0, 0.0, BONE)]
    for i in range(nst + 1):
        h = L * i / nst
        t = h / L
        prof.append((sh_rad(h), h, IGN if 0.42 < t < 0.47 else BONE))
    prof[-1] = (0.0, L, BONE)
    M = at(sx, sy + L / 2, zc) @ Matrix.Diagonal((1.0, 1.0, zs, 1.0)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    n0 = len(k.bm.faces)
    k.lathe(prof, segs, m=M)
    k.bm.faces.ensure_lookup_table()
    gi = k.mi(AGRAPH)
    for f in list(k.bm.faces)[n0:]:
        if f.calc_center_median().z < zc - 0.62 * R * zs:
            f.material_index = gi            # graphite belly
    # canopy, cabin ports, panel seams, cargo-door lines
    k.sphere(1.0, 'kn_poly_beam', S.seg(24, 8), S.seg(12, 4),
             m=at(sx, sy - L / 2 + 5.2, zc + R * zs * 0.72) @ Matrix.Diagonal((1.25, 2.3, 0.78, 1.0)))
    if S.lod <= 1:
        for side in (-1, 1):
            for i in range(5):
                yy = sy - 2.0 + i * 1.3
                k.cyl(0.26, -0.05, 0.08, 'kn_poly_beam', S.seg(16, 8),
                      m=at(sx + side * (R - 0.05), yy, zc + 0.5) @ Matrix.Rotation(math.radians(90 * side), 4, 'Y'))
        for t in (0.2, 0.33, 0.58, 0.7):
            h = L * t
            k.torus(sh_rad(h) + 0.005, 0.03, AGRAPH, segs, 4,
                    m=at(sx, sy + L / 2 - h, zc) @ Matrix.Diagonal((1.0, 1.0, zs, 1.0)) @
                    Matrix.Rotation(math.radians(90), 4, 'X'))
        for side in (-1, 1):
            S.sweep('shuttle', [(sx + side * 0.9, sy - 2.5, zc + R * zs * 0.94),
                                (sx + side * 0.9, sy + 6.5, zc + R * zs * 0.94)], 0.035, AGRAPH, sides=4)
    # delta wings with Ignition tips and wingtip pods
    wz0, wz1 = zc - 1.05, zc - 0.55
    for side in (-1, 1):
        out = [(side * 1.8, -1.5), (side * 9.0, 4.6), (side * 9.0, 6.6), (side * 1.8, 8.4)]
        tip = [(side * 8.0, 3.98), (side * 9.1, 4.6), (side * 9.1, 6.7), (side * 8.0, 6.82)]
        if side < 0:
            out, tip = list(reversed(out)), list(reversed(tip))
        bv = S.lod <= 1
        k.prism(out, wz0, wz1, BONE, bt=0.12 if bv else 0.0, bb=0.08 if bv else 0.0, bseg=max(1, S.cs(2)),
                m=at(sx, sy, 0))
        k.prism(tip, wz0 - 0.03, wz1 + 0.03, IGN, bt=0.05 if bv else 0.0, bb=0.05 if bv else 0.0, bseg=1,
                m=at(sx, sy, 0))
        S.hull_col('shuttle_wing', [(sx + px, sy + py, z) for px, py in out for z in (wz0, wz1)], 'powder')
        k.cyl(0.32, 0.0, 2.6, BONE, S.seg(16, 6), bev=0.25 if bv else 0.0, bseg=max(1, S.cs(2)),
              m=at(sx + side * 9.1, sy + 4.2, zc - 0.8) @ Matrix.Rotation(math.radians(-90), 4, 'X'))
    # tail fin (local x along +Y toward the tail, y up, thickness along X)
    fin = [(-1.0, 0.0), (5.0, 0.0), (6.6, 4.4), (4.4, 4.4)]
    Mf = at(sx, sy + L / 2 - 6.6, zc + R * zs * 0.8) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ \
        Matrix.Rotation(math.radians(90), 4, 'X')
    bv = S.lod <= 1
    k.prism(fin, -0.22, 0.22, BONE, bt=0.1 if bv else 0.0, bb=0.1 if bv else 0.0, bseg=max(1, S.cs(2)), m=Mf)
    k.prism([(3.3, 3.5), (6.27, 3.5), (6.6, 4.4), (4.4, 4.4)], -0.25, 0.25, IGN, bseg=1, m=Mf)
    S.hull_col('shuttle_fin', [tuple(Mf @ Vector((px, py, z))) for px, py in fin for z in (-0.22, 0.22)], 'powder')
    # engines: three bells on a plate at the tail
    ty = sy + L / 2
    k.cyl(R * 0.82, -0.1, 0.35, AGRAPH, segs, bev=0.1 if bv else 0.0,
          m=at(sx, ty, zc) @ Matrix.Diagonal((1.0, 1.0, zs, 1.0)) @ Matrix.Rotation(math.radians(-90), 4, 'X'))
    bells = [(0.0, 0.45), (-1.05, -0.5), (1.05, -0.5)]
    bell = [(0.0, 0.0, AGRAPH), (0.45, 0.0, AGRAPH), (0.5, 0.4, AGRAPH), (0.78, 1.5, AGRAPH), (0.72, 1.55, AGRAPH),
            (0.42, 0.5, AGRAPH), (0.0, 0.5, AGRAPH)]
    for ex, ez in bells:
        k.lathe(bell, S.seg(32, 8), m=at(sx + ex, ty + 0.3, zc + ez) @ Matrix.Rotation(math.radians(-90), 4, 'X'))
    S.hull_col('shuttle_engines', [(sx + ex + dx, ty + dy, zc + ez + dz) for ex, ez in bells
                                   for dx in (-0.78, 0.78) for dz in (-0.78, 0.78) for dy in (0.0, 1.85)], 'steel')
    # fuselage hulls: 6 slices of the ellipse
    cuts = [0.0, 2.0, 7.0, 12.0, 14.5, 17.0, L]
    for a, b in zip(cuts, cuts[1:]):
        pts = []
        for h in (a, (a + b) / 2, b):
            r = max(0.05, sh_rad(min(h, L - 1e-6))) if h < L - 1e-6 else 0.05
            for q in range(10):
                ang = 2 * math.pi * q / 10
                pts.append((sx + r * math.cos(ang), sy + L / 2 - h, zc + r * math.sin(ang) * zs))
        S.hull_col('shuttle_hull', pts, 'powder')
    # docking clamps: two under the fuselage (jaws on the belly, fingers hugging it), two under the wings
    for cx, cy, fus in ((sx, sy - 5.0, True), (sx, sy + 6.5, True), (sx - 4.6, sy + 3.2, False),
                        (sx + 4.6, sy + 3.2, False)):
        rh = sh_rad(sy + L / 2 - cy)

        def belly_z(dx, rh=rh):
            return zc - zs * math.sqrt(max(0.0, rh * rh - dx * dx))

        clamp(S, cx, cy, belly_z(0.0) if fus else wz0, lights, belly_z if fus else None)


def clamp(S, x, y, ztop, lights, surface):
    """Docking clamp: amber base, steel column with hydraulic struts, amber jaw whose top touches the hull; on the
    fuselage two steel fingers hug the belly (top = the hull surface). Sconces on the base, front and back."""
    k = S.kit('docking_clamps')
    bx(S, 'docking_clamps', (x - 1.1, y - 1.1, 0.0), (x + 1.1, y + 1.1, 0.55), AMBER, r=0.12, cs=2, col=True,
       name='docking_clamp_base')
    k.cyl(0.38, 0.55, ztop - 0.38, STEEL, S.seg(20, 8), bev=0.04 if S.lod <= 1 else 0.0, m=at(x, y, 0))
    S.collider('docking_clamp_column', (x - 0.38, y - 0.38, 0.55), (x + 0.38, y + 0.38, ztop - 0.38), 'steel')
    bx(S, 'docking_clamps', (x - 0.9, y - 0.7, ztop - 0.38), (x + 0.9, y + 0.7, ztop), AMBER, r=0.1, cs=2, col=True,
       name='docking_clamp_jaw')
    for sx in (-1, 1):
        if surface is not None:
            fx = 1.15
            top = surface(fx) - 0.03
            bx(S, 'docking_clamps_fingers', (x + sx * fx - 0.13, y - 0.4, ztop - 0.38), (x + sx * fx + 0.13, y + 0.4, top),
               STEEL, r=0.05)
        if S.lod <= 1:
            S.sweep('docking_clamps_struts', [(x + sx * 0.95, y, 0.55), (x + sx * 0.42, y, ztop - 0.5)], 0.07, STEEL,
                    sides=8)
    for sy in (-1, 1):
        sconce(S, x, y + sy * 1.1, 0.28, (0.0, sy), lights, 'clamp', scale=0.5)


def gantry(S, B, gy, gz, hx, hook_z):
    """Ceiling gantry crane: cobalt rail along X with hangers, a trolley with a hoist drum, chrome cables and a
    hook block (static; the rail, trolley and hook collide)."""
    W, C = B['W'], B['C']
    lo, hi = (-W + 0.75, gy - 0.4, gz - 0.6), (W - 0.75, gy + 0.4, gz + 0.6)
    for a, b in spans(lo[0], hi[0]):
        bx(S, 'gantry', (a, lo[1], lo[2]), (b, hi[1], hi[2]), COBALT, r=0.08)
    S.collider('gantry_rail', lo, hi, 'steel')
    if S.lod <= 2:
        for i in range(int((2 * W - 8) // 8.0) + 1):
            x = -W + 4 + 8.0 * i
            S.sweep('gantry_hangers', [(x, gy, gz + 0.6), (x, gy, C - 0.12)], 0.06, STEEL, sides=6)
    bx(S, 'gantry', (hx - 1.4, gy - 1.1, gz - 1.5), (hx + 1.4, gy + 1.1, gz - 0.6), COBALT, r=0.12, cs=2, col=True,
       phys='steel', name='gantry_trolley')
    k = S.kit('gantry')
    k.cyl(0.45, -0.9, 0.9, GRAPH, S.seg(20, 8), bev=0.05 if S.lod <= 1 else 0.0,
          m=at(hx, gy, gz - 2.0) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
    S.collider('gantry_hoist', (hx - 0.9, gy - 0.45, gz - 2.45), (hx + 0.9, gy + 0.45, gz - 1.5), 'steel')
    for dx in (-0.5, 0.5):
        S.sweep('gantry_cable', [(hx + dx, gy, gz - 2.3), (hx + dx * 0.6, gy, hook_z + 1.1)], 0.035, 'kn_chrome', sides=6)
    bx(S, 'gantry_hook', (hx - 0.7, gy - 0.4, hook_z + 0.2), (hx + 0.7, gy + 0.4, hook_z + 1.2), AMBER, r=0.12, cs=2)
    pts = [(hx, gy, hook_z + 0.2), (hx, gy, hook_z - 0.4)]
    pts += [(hx + 0.35 * math.sin(math.radians(d)), gy, hook_z - 0.75 + 0.35 * math.cos(math.radians(d)))
            for d in range(30, 271, 30)]
    S.sweep('gantry_hook', pts, 0.085, STEEL, sides=8)
    S.hull_col('gantry_hook', box_corners((hx - 0.7, gy - 0.4, hook_z - 1.2), (hx + 0.7, gy + 0.4, hook_z + 1.2)), 'steel')
    S.noshadow.add('gantry_cable')


def airlock(S, B, side, c, lights, fonts):
    """Airlock door in a wall: a white surround plate filling the skipped panels, a graphite frame ring with amber
    hazard bands, two door leaves with Bone bands, a status screen, warm sconces each side, a stencil. In the
    wall plane (outside the bounds); the wall's own collider covers it."""
    W = B['W']
    o, n = SIDES[side]
    M = wall_frame(tuple(W * v for v in o), n)
    dw, dh, fw = B['door']
    u = c if side in ('-x', '+y') else -c
    holes = [h for h in S.door_holes.get(side, []) if h is not None and h[0] <= u <= h[1]]
    if holes:
        hu0, hu1, hv0, hv1 = holes[0]
        for (a, b, cc, d) in ((hu0, u - dw / 2 - fw, hv0, hv1), (u + dw / 2 + fw, hu1, hv0, hv1),
                              (u - dw / 2 - fw, u + dw / 2 + fw, dh + fw, hv1)):
            if b - a > 0.05 and d - cc > 0.05:
                bxm(S, 'airlock_surround', M, a + 0.025, b - 0.025, cc + 0.025, d - 0.025, 0.0, 0.12, PANEL, r=0.05)
    for (a, b, cc, d) in ((u - dw / 2 - fw, u - dw / 2, 0.0, dh + fw), (u + dw / 2, u + dw / 2 + fw, 0.0, dh + fw),
                          (u - dw / 2, u + dw / 2, dh, dh + fw)):
        bxm(S, 'airlocks', M, a, b, cc, d, 0.0, 0.6, GRAPH, r=0.12)
    if S.lod <= 1:
        nb = int(round((dw + 2 * fw) / 0.9))
        for i in range(nb):
            a = u - dw / 2 - fw + i * (dw + 2 * fw) / nb
            bxm(S, 'airlock_hazard', M, a, a + (dw + 2 * fw) / nb * 0.5, dh + fw * 0.3, dh + fw * 0.7, 0.6, 0.63, AMBER)
        nv = int(round(dh / 0.9))
        for sgn in (-1, 1):
            a, b = sorted((u + sgn * (dw / 2 + fw * 0.3), u + sgn * (dw / 2 + fw * 0.7)))
            for j in range(nv):
                v0 = j * dh / nv
                bxm(S, 'airlock_hazard', M, a, b, v0, v0 + dh / nv * 0.5, 0.6, 0.63, AMBER)
    for sgn in (-1, 1):
        a, b = sorted((u, u + sgn * dw / 2))
        bxm(S, 'airlocks', M, a + 0.03, b - 0.03, 0.0, dh - 0.03, 0.0, 0.1, GRAPH, r=0.06)
        if S.lod <= 1:
            for v in (dh * 0.3, dh * 0.62):
                bxm(S, 'airlocks_bands', M, a + 0.4, b - 0.4, v - 0.22 * dh / 8, v + 0.22 * dh / 8, 0.1, 0.13, BONE,
                    r=0.04)
    sx0 = u + dw / 2 + fw + 0.4
    bxm(S, 'wall_screens', M, sx0, sx0 + 1.2, 1.0, 1.8, 0.12, 0.22, GRAPH, r=0.05)
    bxm(S, 'wall_screens_face', M, sx0 + 0.1, sx0 + 1.1, 1.1, 1.7, 0.22, 0.235, 'kn_screen')
    for sgn in (-1, 1):
        for v in (2.6, dh - 0.6):
            p = M @ Vector((u + sgn * (dw / 2 + fw + 0.45), v, 0.12))
            sconce(S, p.x, p.y, p.z, n, lights, 'airlock')
    S.text('airlock_ink', 'AIRLOCK %s' % {'-x': 'A', '+x': 'B', '-y': 'C', '+y': 'D'}[side],
           M @ at(u, dh + fw + 0.75, 0.125), 0.55 if W < 50 else 1.0, GRAPH, fonts['sym'])


def container(S, x, y, z, colour, i, fonts, along_x=False):
    """Cargo container 2 x 2 x 4 m (long along Y, or X when along_x): corrugated sides, corner posts, door bars,
    "KN-BAY" stencils. Powder colourways Bone / Cobalt / Ignition."""
    w, L, h = 2.0, 4.0, 2.0
    sx, sy = (L, w) if along_x else (w, L)
    lo, hi = (x - sx / 2, y - sy / 2, z), (x + sx / 2, y + sy / 2, z + h)
    bx(S, 'containers', lo, hi, colour, r=0.06, cs=1, col=True, phys='powder', name='container')
    if S.lod >= 2:
        return
    for px in (lo[0] + 0.08, hi[0] - 0.08):
        for py in (lo[1] + 0.08, hi[1] - 0.08):
            bx(S, 'containers_detail', (px - 0.1, py - 0.1, z), (px + 0.1, py + 0.1, z + h), GRAPH, r=0.03)
    if S.lod == 1:
        return
    n = 9
    for j in range(n):
        t = (j + 0.5) / n
        if along_x:
            px = lo[0] + 0.25 + t * (sx - 0.5)
            for py, d in ((lo[1], -1), (hi[1], 1)):
                a, b = sorted((py, py + d * 0.04))
                bx(S, 'containers_ribs', (px - 0.07, a, z + 0.15), (px + 0.07, b, z + h - 0.15), colour, r=0.015)
        else:
            py = lo[1] + 0.25 + t * (sy - 0.5)
            for px, d in ((lo[0], -1), (hi[0], 1)):
                a, b = sorted((px, px + d * 0.04))
                bx(S, 'containers_ribs', (a, py - 0.07, z + 0.15), (b, py + 0.07, z + h - 0.15), colour, r=0.015)
    for o in (-0.45, -0.15, 0.15, 0.45):
        if along_x:
            S.sweep('containers_bars', [(lo[0] - 0.03, y + o, z + 0.15), (lo[0] - 0.03, y + o, z + h - 0.15)], 0.025,
                    STEEL, sides=5)
        else:
            S.sweep('containers_bars', [(x + o, lo[1] - 0.03, z + 0.15), (x + o, lo[1] - 0.03, z + h - 0.15)], 0.025,
                    STEEL, sides=5)
    ink = GRAPH if colour == BONE else BONE
    label = 'KN-BAY %02d' % (i + 1)
    if along_x:   # stencil on the -Y long side
        S.text('containers_ink', label, at(x, lo[1] - 0.045, z + h * 0.55) @ Matrix.Rotation(math.radians(90), 4, 'X'),
               0.22, ink, fonts['sym'])
    else:         # stencil on the long side facing the bay centre
        sgn = -1 if x > 0 else 1
        fx = (lo[0] - 0.045) if sgn < 0 else (hi[0] + 0.045)
        S.text('containers_ink', label, at(fx, y, z + h * 0.55) @ Matrix.Rotation(math.radians(-90 * sgn), 4, 'Z') @
               Matrix.Rotation(math.radians(90), 4, 'X'), 0.22, ink, fonts['sym'])


def stack(S, x, y, base_i, fonts, along_x):
    """A stack: three containers on the deck, two on top, in the three colourways."""
    cols = (BONE, COBALT, IGN)
    i = base_i
    for row, offs in ((0, (-1.0, 0.0, 1.0)), (1, (-0.5, 0.5))):
        for o in offs:
            px, py = (x, y + o * 2.1) if along_x else (x + o * 2.1, y)
            container(S, px, py, row * 2.02, cols[i % 3], i, fonts, along_x=along_x)
            i += 1
    return i


def tool_cart(S, x, y, yaw):
    """Tool cart: graphite frame on rubber wheels, two shelves, kit toolbox / parts drawers / tools / a mug."""
    w, d, h = 1.3, 0.7, 0.92
    M = place(x, y, 0, yaw)
    k = S.kit('tool_carts')
    for z in (0.22, h - 0.05):
        if S.lod <= 1:
            k.rbox((w, d, 0.05), (0, 0, z), 0.02, GRAPH, cseg=1, m=M)
        else:
            k.hull(box_corners((-w / 2, -d / 2, z - 0.025), (w / 2, d / 2, z + 0.025)), GRAPH, m=M)
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * (w / 2 - 0.04), sy * (d / 2 - 0.04)
            k.hull(box_corners((px - 0.02, py - 0.02, 0.1), (px + 0.02, py + 0.02, h)), GRAPH, m=M)
            k.cyl(0.07, -0.025, 0.025, 'kn_rubber', S.seg(12, 6),
                  m=M @ at(px, py, 0.07) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    if S.lod <= 1:
        S.sweep('tool_carts', [tuple(M @ Vector((-w / 2 - 0.12, -0.2, h))), tuple(M @ Vector((-w / 2 - 0.12, 0.2, h)))],
                0.02, STEEL, sides=6)
    pts = [M @ Vector(p) for p in box_corners((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h))]
    S.collider('tool_cart', tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)),
               'powder')
    top = h - 0.025
    S.prop('toolbox', 0, 0, 0, M=M @ place(-0.25, 0.0, top, 5), col=False, piece='cart_props')
    S.prop('parts_drawers', 0, 0, 0, M=M @ place(0.35, 0.05, top, -8), col=False, piece='cart_props')
    S.prop('mug', 0, 0, 0, M=M @ place(0.47, -0.24, top, 30), variant=2, col=False, piece='cart_props')
    S.prop('hand_tool', 0, 0, 0, M=M @ place(0.1, -0.15, 0.245, 70), variant=1, col=False, piece='cart_props')
    S.prop('spool', 0, 0, 0, M=M @ place(-0.4, 0.1, 0.245, 0), variant=2, col=False, piece='cart_props')


def wall_screen(S, M):
    bxm(S, 'wall_screens', M, -1.0, 1.0, -0.6, 0.6, 0.12, 0.24, GRAPH, r=0.06)
    bxm(S, 'wall_screens_face', M, -0.9, 0.9, -0.5, 0.5, 0.24, 0.255, 'kn_screen')


def zerog_ring(S, n, x, y, r, fonts):
    """Zero-g floor ring (§5.2): brushed-steel collar flush with the deck, an LED channel under a clear cover,
    separate LED pieces for the renderer to recolour (solid Field `_led`; dashed white `_led_dash` + Field glyphs
    `_glyph` in multiplayer), Amber / Graphite hazard stripes outside it and ZERO-G lettering. Visual only: the
    deck box carries it (all of it is within 15 mm of the deck)."""
    g = 'zone_%d' % n
    segs = 160 if r > 8 else 112
    w = 0.32 if r < 8 else 0.5
    S.kit('ring_collar', g).lathe([(r - w, 0.0, STEEL), (r + w, 0.0, STEEL), (r + w, 0.003, STEEL),
                                   (r + w - 0.03, 0.006, STEEL), (r - w + 0.03, 0.006, STEEL), (r - w, 0.003, STEEL)],
                                  segs, m=at(x, y, -0.002), closed=True)
    lw = 0.13 if r < 8 else 0.2      # LED half-width: a band that reads as a glowing ring at the bay's scale
    FL, WL = 'kn_env_field_led', 'kn_env_led_white'
    # the LED sits on the collar's flat top (z 0.006) with clear air between them (no coplanar faces). No clear
    # cover over it: in engine its glass reflected the bay's IBL at grazing angles and hid the LED
    S.kit('ring_led', g).lathe([(r - lw, 0.0075, FL), (r + lw, 0.0075, FL), (r + lw, 0.0105, FL),
                                (r - lw, 0.0105, FL)], segs, m=at(x, y, 0), closed=True)
    kd = S.kit('ring_led_dash', g)
    nd = 32
    for i in range(nd):
        a0 = 2 * math.pi * i / nd
        kd.lathe_arc([(r - lw - 0.005, 0.008, WL), (r + lw + 0.005, 0.008, WL), (r + lw + 0.005, 0.0115, WL),
                      (r - lw - 0.005, 0.0115, WL)], a0, a0 + 2 * math.pi / nd * 0.55, 6, m=at(x, y, 0))
    kg = S.kit('ring_glyph', g)
    for i in range(8):              # the Field glyph (a circled asterisk) every 45 deg, inside the collar
        a = 2 * math.pi * i / 8 + math.pi / 8
        gx, gy = x + (r - w - 0.45) * math.cos(a), y + (r - w - 0.45) * math.sin(a)
        kg.torus(0.22, 0.03, WL, 24, 4, m=at(gx, gy, 0.004) @ Matrix.Diagonal((1, 1, 0.08, 1)))
        for j in range(3):
            b = a + math.pi / 3 * j
            dx, dy = 0.15 * math.cos(b), 0.15 * math.sin(b)
            ox, oy = -0.02 * math.sin(b), 0.02 * math.cos(b)
            kg.hull([(gx + sg * dx + so * ox, gy + sg * dy + so * oy, z) for sg in (-1, 1) for so in (-1, 1)
                     for z in (0.003, 0.0055)], WL)
    kh = S.kit('ring_hazard', g)
    nh = int(2 * math.pi * r / 0.6)
    for i in range(nh):
        a0 = 2 * math.pi * i / nh
        mat = AMBER if i % 2 == 0 else GRAPH
        kh.lathe_arc([(r + w + 0.05, 0.0, mat), (r + w + 0.45, 0.0, mat), (r + w + 0.45, 0.003, mat),
                      (r + w + 0.05, 0.003, mat)], a0, a0 + 2 * math.pi / nh, 2, m=at(x, y, -0.001))
    S.text('ring_ink', 'ZERO-G', at(x, y - r - w - 1.0, 0.001), 0.7 if r < 8 else 1.4, BONE, fonts['sym'],
           group=g)


def neutral_marking(S, B):
    """A painted Bone line just outside the neutral zone (the landing box), 2 mm proud; the zone itself stays one
    clean deck material (§0.9)."""
    (x0, y0), (x1, y1) = B['neutral']
    m, w = 0.35, 0.18
    for lo, hi in (((x0 - m - w, y0 - m - w), (x1 + m + w, y0 - m)), ((x0 - m - w, y1 + m), (x1 + m + w, y1 + m + w)),
                   ((x0 - m - w, y0 - m), (x0 - m, y1 + m)), ((x1 + m, y0 - m), (x1 + m + w, y1 + m))):
        bx(S, 'deck_marking', (lo[0], lo[1], -0.004), (hi[0], hi[1], 0.002), BONE)


def scale_ref(S, preset, x, y, z0):
    """env_scale_ref (environments.md §0.7): plinth, THUD, 1 m stick on its foot (real size)."""
    g = 'ref_' + preset
    k = S.kit('plinth', g)
    k.rbox((0.4, 0.4, 0.45), (x, y, z0 + 0.225), 0.012, GRAPH, cseg=2)
    k.rbox((0.36, 0.36, 0.01), (x, y, z0 + 0.45), 0.003, BONE, cseg=1)
    S.collider('scale_ref_plinth', (x - 0.2, y - 0.2, z0), (x + 0.2, y + 0.2, z0 + 0.45), 'powder', None, preset)
    tz = z0 + 0.45 - 0.015 + 0.11
    kt = S.kit('thud', g)
    kt.sphere(0.11, GRAPH, 40, 20, m=at(x, y, tz))
    kt.torus(0.108, 0.007, IGN, 40, 6, m=at(x, y, tz))
    S.sphere_col('scale_ref_thud', (x, y, tz), 0.11, 'powder', preset)
    sx = x + 0.35
    ks = S.kit('stick', g)
    ks.rbox((0.12, 0.12, 0.02), (sx, y, z0 + 0.01), 0.003, GRAPH, cseg=1)
    S.collider('scale_ref_foot', (sx - 0.06, y - 0.06, z0), (sx + 0.06, y + 0.06, z0 + 0.02), 'powder', None, preset)
    for b in range(10):
        mat = IGN if b == 5 else (BONE if b % 2 == 0 else GRAPH)
        ks.rbox((0.04, 0.02, 0.1), (sx, y, z0 + 0.02 + (b + 0.5) * 0.1), 0.003, mat, cseg=1)
    S.collider('scale_ref_stick', (sx - 0.02, y - 0.01, z0 + 0.02), (sx + 0.02, y + 0.01, z0 + 1.02), 'powder', None,
               preset)


# ---------------------------------------------------------------- backdrop: Earth, stars

def earth_params(B):
    """Earth fills the lower ~40 % of the window seen from the deck: centre 20 deg below the horizon straight
    out of the window, angular radius 33 deg (upper limb ~13 deg above the horizon)."""
    D = B['earth_d']
    el = math.radians(-20.0)
    c = Vector((0.0, D * math.cos(el), 1.7 + D * math.sin(el)))
    return c, D * math.sin(math.radians(33.0))



# ---------------------------------------------------------------- the Earth: a baked, lit texture set

EARTH_MAT = 'kn_env_earth_tex'
# Hangar Earth: the true sun is behind it seen from the window (phase ~130 deg, a thin crescent); the bake turns the
# planet's sun toward the bay to 105 deg so ~35-40 % of the disc is lit (review call, M5_NOTES_E5c decision 9)
EARTH_PHASE = 105.0
EARTH_FILES = {'albedo': 'earth_hangar.albedo.png', 'normal': 'earth_hangar.normal.png', 'orm': 'earth_hangar.orm.png',
               'size': 2048}
EARTH_EMIT = 0.15     # the master's emissive factor: the engine shows texture x 0.15 x 12 (fs_part), Cycles the same


def earth_uv(d):
    """Planet-local unit direction -> equirect UV (u = 0.5 straight at -Y, the side facing the base / bay; the seam
    is at +Y, never built)."""
    u = 0.5 + math.atan2(d.x, -d.y) / (2 * math.pi)
    v = math.acos(max(-1.0, min(1.0, d.z))) / math.pi
    return u, 1.0 - v


def earth_uv_sphere(k, c, R, to, n_lon=192, n_lat=96, cut=-0.12):
    """The hemisphere of a sphere facing `to` (plus a margin past the limb), UV-mapped for the baked equirect."""
    bm = k.bm
    uvl = bm.loops.layers.uv.verify()
    mi = k.mi(EARTH_MAT)
    verts = {}

    def vert(i, j):
        key = (i, j)
        if key not in verts:
            lat = -math.pi / 2 + math.pi * i / n_lat
            lon = 2 * math.pi * j / n_lon
            d = Vector((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))
            verts[key] = (bm.verts.new(c + d * R), d)
        return verts[key]

    for i in range(n_lat):
        for j in range(n_lon):
            q = [vert(i, j), vert(i, j + 1), vert(i + 1, j + 1), vert(i + 1, j)]
            if all(d.dot(to) < cut for _v, d in q):
                continue
            uvs = [earth_uv(d) for _v, d in q]
            us = [uu for uu, _ in uvs]
            if max(us) - min(us) > 0.5:      # never at the seam (it's behind), but keep the UVs continuous anyway
                uvs = [((uu + 1.0) if uu < 0.5 else uu, vv) for uu, vv in uvs]
            if i == 0 or i == n_lat - 1:      # pole caps: triangles
                idx = [0, 2, 3] if i == 0 else [0, 1, 2]
                q, uvs = [q[t] for t in idx], [uvs[t] for t in idx]
            f = bm.faces.new([vv for vv, _d in q])
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - c) < 0:
                f.normal_flip()
                for loop, uv in zip(f.loops, reversed(uvs)):
                    loop[uvl].uv = uv
            else:
                for loop, uv in zip(f.loops, uvs):
                    loop[uvl].uv = uv
            f.material_index = mi
            f.smooth = True


class _Noise3:
    """Vectorised 3D value-noise fBm (a fixed hashed lattice: deterministic)."""

    def __init__(self, seed):
        import numpy as np
        rng = np.random.default_rng(seed)
        self.perm = rng.permutation(256).astype(np.int64)
        self.val = rng.random(256).astype(np.float32)

    def _h(self, ix, iy, iz):
        p = self.perm
        return self.val[p[(p[(p[ix & 255] + iy) & 255] + iz) & 255]]

    def noise(self, x, y, z):
        import numpy as np
        ix, iy, iz = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
        fx, fy, fz = x - ix, y - iy, z - iz
        sx, sy, sz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        out = 0.0
        for dx in (0, 1):
            wx = sx if dx else 1 - sx
            for dy in (0, 1):
                wy = sy if dy else 1 - sy
                for dz in (0, 1):
                    wz = sz if dz else 1 - sz
                    out = out + wx * wy * wz * self._h(ix + dx, iy + dy, iz + dz)
        return out

    def fbm(self, P, freq, octaves, gain=0.5):
        tot, amp, acc = 0.0, 1.0, 0.0
        for o in range(octaves):
            f = freq * (2.0 ** o)
            acc = acc + amp * self.noise(P[0] * f + 17.3 * o, P[1] * f - 9.1 * o, P[2] * f + 4.7 * o)
            tot += amp
            amp *= gain
        return acc / tot


def earth_lit_png(root, env, name):
    """ART (beta polish, D128): the lit look-dev Earth, `assets/src/env/<env>/<name>.lit.png`. Only Cycles uses it
    (the look-dev renders and the IBL bakes); the engine lights the shipped inputs at runtime."""
    return os.path.join(root, 'assets', 'src', 'env', env, name + '.lit.png')


def earth_bake(out_dir, name, size, c, R, eye, to_sun, log=print, phase_deg=None, lit_path=None):
    """Bake the Earth into a texture set (equirect, planet-local = world axes; u = 0.5 at -Y, v up = north).
    ART (beta polish, D128): the shipped set holds the **inputs** for the renderer's runtime planet lighting (the Earth
    spins, D112 lifted), no lighting baked in:
      `<name>.albedo.png` (sRGB) the unlit surface reflectance (ocean depth, land and climate colour, relief shading,
        ice), plain 0-1 with the pipeline's 0.85 linear peak cap; no clouds, cloud shadows, terminator, night side,
        city lights, glint or rim;
      `<name>.orm.png` (linear, a data map, not ORM): R cloud coverage 0-1, G night-lights intensity (ungated: the
        renderer masks it to the night side), B water mask (1 - land)(1 - ice) for the glint;
      `<name>.normal.png` flat.
    The previous lit composite (soft terminator from the set's own sun, `phase_deg` turning it toward the viewer, warm
    sunset band, city lights, cloud shadows, glint, rim) is still baked, to `lit_path`, for Cycles only.
    Stylised-real (ART_BIBLE §4: tactile, not photoreal, not flat): invented continents with soft coastlines, relief
    and climate colour (forest, plains, desert, mountains, ice caps), an ocean depth gradient, wispy domain-warped
    clouds. Returns the TexSetFiles entry for the data."""
    import time
    import numpy as np
    t0 = time.time()
    n = size
    v = (np.arange(n, dtype=np.float32) + 0.5) / n          # image rows, top = north (glTF v = 1 - row)
    u = (np.arange(n, dtype=np.float32) + 0.5) / n
    theta = v[:, None] * math.pi                             # 0 at the north pole
    lon = (u[None, :] - 0.5) * 2 * math.pi                   # u = 0.5 -> -Y
    st = np.sin(theta)
    dx = (st * np.sin(lon)).astype(np.float32)
    dy = (-st * np.cos(lon)).astype(np.float32)
    dz = np.broadcast_to(np.cos(theta), (n, n)).astype(np.float32)
    P = (dx, dy, dz)
    N1, N2, N3 = _Noise3(5), _Noise3(23), _Noise3(41)

    def sm(a, b, x):
        t = np.clip((x - a) / (b - a), 0.0, 1.0)
        return t * t * (3 - 2 * t)

    def hexc(h):
        h = h.lstrip('#')
        return np.array([(int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4)], dtype=np.float32)

    # continents (soft coast over a narrow band), relief, climate
    warp = N2.fbm(P, 1.1, 3)
    Pw = (dx + 0.35 * (warp - 0.5), dy + 0.35 * (N3.fbm(P, 1.1, 3) - 0.5), dz)
    f = N1.fbm(Pw, 1.35, 6)
    thr = 0.51
    land = sm(thr - 0.006, thr + 0.006, f)
    depth = np.clip((thr - f) / 0.16, 0.0, 1.0)
    relief = N2.fbm(P, 7.0, 5)
    lat = np.abs(dz)
    dry = N3.fbm(P, 2.4, 4)
    ice = sm(0.80, 0.86, lat + 0.06 * (relief - 0.5))
    ocean = (hexc('#3BB2D6')[None, None, :] * (1 - depth[..., None]) +
             hexc('#0F3B74')[None, None, :] * depth[..., None])
    ocean *= (0.92 + 0.16 * N3.fbm(P, 12.0, 2))[..., None]
    plains, forest = hexc('#7FAE58'), hexc('#3F7A3A')
    desert, mount, snow = hexc('#D2B37A'), hexc('#9A8A72'), hexc('#F2F4F6')
    veg = sm(0.45, 0.65, N1.fbm(P, 4.0, 4))
    lc = plains[None, None, :] * (1 - veg)[..., None] + forest[None, None, :] * veg[..., None]
    desert_w = sm(0.55, 0.7, dry) * sm(0.12, 0.25, lat) * (1 - sm(0.42, 0.55, lat))
    lc = lc * (1 - desert_w[..., None]) + desert[None, None, :] * desert_w[..., None]
    hi = sm(0.58, 0.72, relief) * sm(0.003, 0.04, f - thr)
    lc = lc * (1 - hi[..., None]) + mount[None, None, :] * hi[..., None]
    peak = sm(0.70, 0.78, relief) * sm(0.02, 0.06, f - thr)
    lc = lc * (1 - peak[..., None]) + snow[None, None, :] * peak[..., None]
    lc *= (0.9 + 0.2 * relief)[..., None]                    # relief shading: a tactile, not flat, surface
    col = ocean * (1 - land[..., None]) + lc * land[..., None]
    col = col * (1 - ice[..., None]) + snow[None, None, :] * ice[..., None]
    albedo = col.copy()       # D128: the unlit reflectance the engine lights (before cloud shadows and lighting)
    # clouds: domain-warped fBm, streaked along latitude, wispy
    w2 = N1.fbm((dx * 2.0, dy * 2.0, dz * 2.0), 1.7, 4)
    cw = N3.fbm((dx + 1.1 * (w2 - 0.5), dy + 1.1 * (warp - 0.5), dz * 3.4 + 0.8 * (w2 - 0.5)), 2.4, 7, 0.55)
    clouds = sm(0.56, 0.70, cw) * 0.88
    streak = N2.fbm((dx * 2.5 + 0.5 * (w2 - 0.5), dy * 2.5, dz * 12.0), 1.8, 5, 0.6)
    clouds = np.maximum(clouds, sm(0.60, 0.72, streak) * 0.5)
    # cloud shadows: the cloud field offset away from the sun on the surface
    L = to_sun.normalized()
    if phase_deg is not None:
        # an art call: turn the planet's sun toward the viewer (about the axis L x view) until the phase angle at the
        # disc centre is phase_deg, keeping the terminator's orientation (a thicker sunlit crescent)
        Vc = (Vector(tuple(eye)) - Vector(tuple(c))).normalized()
        cur = math.degrees(L.angle(Vc))
        ax = L.cross(Vc)
        if ax.length > 1e-6 and cur > phase_deg:
            from mathutils import Quaternion
            L = (Quaternion(ax.normalized(), math.radians(cur - phase_deg)) @ L).normalized()
    off = 0.012
    cs = N3.fbm((dx - L.x * off + 1.1 * (w2 - 0.5), dy - L.y * off + 1.1 * (warp - 0.5),
                 (dz - L.z * off) * 3.4 + 0.8 * (w2 - 0.5)), 2.4, 7, 0.55)
    col *= (1.0 - 0.35 * sm(0.56, 0.70, cs))[..., None]
    # lighting: soft terminator from the set's sun, warm sunset band, night side
    ndl = dx * L.x + dy * L.y + dz * L.z
    day = sm(-0.08, 0.16, ndl)
    band = sm(-0.06, 0.04, ndl) * (1 - sm(0.04, 0.2, ndl))
    lit = 0.10 + 0.90 * np.clip(ndl, 0.0, 1.0) ** 0.75
    warm = np.array([1.0, 0.62, 0.38], dtype=np.float32)
    surf = col * (lit * day)[..., None]
    surf = surf * (1 - 0.6 * band[..., None]) + surf * warm * 0.96 * band[..., None]
    cloud_col = np.array([0.93, 0.94, 0.96], dtype=np.float32)
    cl = cloud_col * (0.07 + 0.93 * np.clip(ndl + 0.05, 0.0, 1.0) ** 0.6 * day)[..., None]
    surf = surf * (1 - clouds[..., None]) + cl * clouds[..., None]
    night = 1.0 - day
    # the night side is dark blue-black (a trace of the surface colour, no green glow)
    surf += (col * 0.02 + np.array([0.004, 0.006, 0.016], dtype=np.float32)) * night[..., None]
    # night lights: sparse chains along the coasts and a few rivers plus a handful of metro clusters (most land stays
    # dark), strictly on the night side, small and dim with a soft glow falloff
    nightc = 1.0 - sm(-0.14, 0.02, ndl)
    coastc = sm(0.0, 0.01, f - thr) * (1 - sm(0.012, 0.03, f - thr)) * sm(0.48, 0.56, N2.fbm(P, 9.0, 2))
    river = sm(0.94, 0.975, 1.0 - np.abs(2.0 * N3.fbm(P, 5.0, 3) - 1.0)) * sm(0.02, 0.06, f - thr)
    metro = sm(0.80, 0.90, N1.fbm(P, 3.0, 3))
    chain = np.maximum(np.maximum(coastc, river * 0.7), metro)
    dots = sm(0.88, 0.95, N2.noise(dx * 520.0, dy * 520.0, dz * 520.0))
    city = dots * chain * land * (1 - ice) * (1 - 0.85 * clouds)
    glow = city.copy()
    for _ in range(3):
        glow = (glow + np.roll(glow, 1, 0) + np.roll(glow, -1, 0) + np.roll(glow, 1, 1) + np.roll(glow, -1, 1)) / 5.0
    lights = (0.45 * city + 0.6 * glow + 0.05 * metro * land * (1 - ice)) * nightc
    surf += np.array([1.0, 0.70, 0.36], dtype=np.float32) * lights[..., None]
    # ocean glint toward the viewer and the rim scattering
    Pw_ = np.stack([dx, dy, dz], axis=-1) * R + np.array(tuple(c), dtype=np.float32)
    V = np.array(tuple(eye), dtype=np.float32) - Pw_
    V /= np.linalg.norm(V, axis=-1, keepdims=True)
    H = V + np.array(tuple(L), dtype=np.float32)
    H /= np.linalg.norm(H, axis=-1, keepdims=True)
    ndh = np.clip(dx * H[..., 0] + dy * H[..., 1] + dz * H[..., 2], 0.0, 1.0)
    glint = (1 - land) * (1 - clouds) * day * (0.9 * ndh ** 220 + 0.07 * ndh ** 24)
    surf += np.array([1.0, 0.95, 0.85], dtype=np.float32) * glint[..., None]
    ndv = np.clip(dx * V[..., 0] + dy * V[..., 1] + dz * V[..., 2], 0.0, 1.0)
    fres = (1.0 - ndv) ** 3
    back = np.clip(-(V[..., 0] * L.x + V[..., 1] * L.y + V[..., 2] * L.z), 0.0, 1.0) ** 3
    rim = fres * (0.25 * sm(-0.35, 0.3, ndl) + 0.9 * back * sm(-0.5, 0.1, ndl))
    surf += np.array([0.42, 0.68, 1.0], dtype=np.float32) * rim[..., None]
    def to_srgb(x):
        return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)

    os.makedirs(out_dir, exist_ok=True)
    if lit_path:
        # the lit look-dev composite for Cycles (emission = texture x EARTH_EMIT x 12, as the engine drew it in M5)
        os.makedirs(os.path.dirname(lit_path), exist_ok=True)
        _save(lit_path, to_srgb(np.clip(surf / (EARTH_EMIT * 12.0) * 1.55, 0.0, 1.0)))
    # D128: the runtime inputs. Albedo: plain reflectance, the linear peak capped at 0.85 with the hue kept (as
    # library.build_materials caps the masters)
    peak = albedo.max(axis=-1, keepdims=True)
    albedo = albedo * np.minimum(1.0, 0.85 / np.maximum(peak, 1e-6))
    _save(os.path.join(out_dir, name + '.albedo.png'), to_srgb(np.clip(albedo, 0.0, 1.0)))
    flat = np.zeros((n, n, 3), dtype=np.float32)
    _save(os.path.join(out_dir, name + '.normal.png'), flat + np.array([0.5, 0.5, 1.0], dtype=np.float32))
    night_lights = 0.45 * city + 0.6 * glow + 0.05 * metro * land * (1 - ice)      # without the night-side gate
    water = (1 - land) * (1 - ice)
    data = np.stack([clouds, night_lights, water], axis=-1)
    _save(os.path.join(out_dir, name + '.orm.png'), np.clip(data, 0.0, 1.0).astype(np.float32))
    log('  earth texture %s %dx%d baked in %.1f s (runtime inputs; look-dev lit fraction %.2f; clouds mean %.3f, '
        'night lights max %.3f mean %.4f, water %.3f)'
        % (name, n, n, time.time() - t0, float((day > 0.5).mean()), float(clouds.mean()), float(night_lights.max()),
           float(night_lights.mean()), float(water.mean())))
    return {'albedo': name + '.albedo.png', 'normal': name + '.normal.png', 'orm': name + '.orm.png', 'size': n}


def _save(path, arr):
    """arr rows top-down, values already encoded (sRGB albedo, linear normal / ORM)."""
    import numpy as np
    h, w = arr.shape[:2]
    rgba = np.concatenate([arr, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(rgba[::-1], dtype=np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def earth_material_for_cycles(png):
    """A Cycles stand-in of what the engine draws: the baked texture as base colour and emission (x EARTH_EMIT x 12)."""
    m = bpy.data.materials.new(EARTH_MAT + '_cycles')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(png)
    t.image.colorspace_settings.name = 'sRGB'
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(t.outputs['Color'], p.inputs['Emission Color'])
    p.inputs['Emission Strength'].default_value = EARTH_EMIT * 12.0
    p.inputs['Roughness'].default_value = 0.6
    return m


def use_cycles_earth(png):
    """Swap the Earth's master for the textured Cycles stand-in on every object using it (look-dev / IBL)."""
    m = None
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        for slot in ob.material_slots:
            if slot.material is not None and slot.material.name.split('.')[0] == EARTH_MAT:
                m = m or earth_material_for_cycles(png)
                slot.material = m

def earth_land(d):
    v = noise.noise(d * 1.3 + Vector((3.1, 0.7, 1.9))) + 0.45 * noise.noise(d * 3.2 + Vector((1.0, 5.0, 2.0)))
    return v - 2.0 * max(0.0, abs(d.z) - 0.9)        # no land on the poles: ice-free stylised oceans


def earth_cloud(d):
    return noise.noise(d * 2.2 + Vector((7.0, 1.0, 3.0))) + 0.3 * noise.noise(d * 5.5 + Vector((2.0, 9.0, 4.0)))


def iso_sphere(k, c, R, to, fn, thr, mat_hi, mat_lo, n_lon=256, n_lat=128, cut=-0.08):
    """A sphere (the hemisphere toward `to` only) split along the iso-line fn(dir) = thr by marching triangles:
    the part above thr gets mat_hi, the part below mat_lo (or is left out when mat_lo is None: an open shell)."""
    def dirof(lat, lon):
        return Vector((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))

    grid = {}
    for i in range(n_lat + 1):
        lat = -math.pi / 2 + math.pi * i / n_lat
        for j in range(n_lon + 1):
            lon = 2 * math.pi * j / n_lon
            d = dirof(lat, lon)
            grid[i, j] = (lat, lon, d, fn(d) - thr)
    bm = k.bm
    hi, lo = k.mi(mat_hi), (k.mi(mat_lo) if mat_lo else None)

    def vert(lat, lon):
        return bm.verts.new(c + dirof(lat, lon) * R)

    def emit(pts, mi):
        if mi is None or len(pts) < 3:
            return
        vs = [vert(a, b) for a, b in pts]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.dot(vs[0].co - c) < 0:
            f.normal_flip()
        f.material_index = mi

    for i in range(n_lat):
        for j in range(n_lon):
            q = [grid[i, j], grid[i, j + 1], grid[i + 1, j + 1], grid[i + 1, j]]
            if all(p[2].dot(to) < cut for p in q):
                continue
            for tri in ((q[0], q[1], q[2]), (q[0], q[2], q[3])):
                above = [p for p in tri if p[3] >= 0]
                if len(above) in (0, 3):
                    emit([(p[0], p[1]) for p in tri], hi if above else lo)
                    continue
                pos, neg = [], []
                for a in range(3):
                    p, r_ = tri[a], tri[(a + 1) % 3]
                    (pos if p[3] >= 0 else neg).append((p[0], p[1]))
                    if (p[3] >= 0) != (r_[3] >= 0):
                        t = p[3] / (p[3] - r_[3])
                        x = (p[0] + (r_[0] - p[0]) * t, p[1] + (r_[1] - p[1]) * t)
                        pos.append(x)
                        neg.append(x)
                emit(pos, hi)
                emit(neg, lo)

def backdrop(S, B):
    """Black space, a sparse star field (no nebula) and a stylised-real Earth (a baked, lit texture set on the
    hemisphere facing the bay, earth_bake) with a thin limb glow at the silhouette (§5.2). Never casts shadows."""
    c, R = earth_params(B)
    # the textured Earth (baked by earth_bake): the hemisphere facing the bay, UV-mapped equirect
    eye = Vector((0.0, 0.0, 1.7))
    to = (eye - c).normalized()
    S.keepnormals.add('earth')
    earth_uv_sphere(S.kit('earth', 'backdrop'), c, R, to)
    # limb glow: an annulus at the silhouette circle seen from the bay (distance R^2 / D toward the viewer)
    D = (eye - c).length
    r_sil = R * math.sqrt(max(0.0, 1.0 - (R / D) ** 2))
    rot = to.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    S.kit('earth_glow', 'backdrop').ring_sweep(
        outline_circle(r_sil * 1.002, 160), [(0.0, -0.5), (r_sil * 0.012, -0.5), (r_sil * 0.012, 0.5), (0.0, 0.5)],
        'kn_env_atmosphere', m=at(*(c + to * (R * R / D))) @ rot)
    rng = random.Random(7)
    ks = S.kit('stars', 'backdrop')
    Ds = B['stars_d']
    for _ in range(900):
        while True:
            v = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
            if v.length > 1e-6:
                v.normalize()
                if v.y > 0.25:
                    break
        p = v * Ds
        s = Ds * math.tan(math.radians(rng.uniform(0.025, 0.07)))
        ks.hull([p + Vector(o) * s for o in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))],
                'kn_env_star')
    S.noshadow.update(('earth', 'earth_glow', 'stars'))


# ---------------------------------------------------------------- build

def build(bay, lod, fonts):
    B = BAYS[bay]
    S = SpaceSet(lod)
    lights = []
    deck(S, B)
    walls(S, B)
    window(S, B)
    ribs(S, B)
    ceiling_lights(S, B, lights)
    neutral_marking(S, B)
    for sx, sy in B['shuttles']:
        shuttle(S, sx, sy, lights)
    for gy, gz, hx, hz in B['gantry']:
        gantry(S, B, gy, gz, hx, hz)
    for side, c in B['airlocks']:
        airlock(S, B, side, c, lights, fonts)
    ci = 0
    for x, y in B['stacks']:
        ci = stack(S, x, y, ci, fonts, along_x=abs(x) > 100)
    for x, y, yaw in B['carts']:
        tool_cart(S, x, y, yaw)
    W, z0w = B['W'], B['window']['z0'] - 0.8
    for (nx, ny), u in B['screens']:
        if ny:   # back wall, under the window
            M = wall_frame((u, W, z0w - 0.9), (0, -1, 0))
        else:
            M = wall_frame((nx * W, u, 4.2 if W < 50 else 6.3), (-nx, 0, 0))
        wall_screen(S, M)
    if B['sconces_extra']:
        for x, y in B['stacks']:
            sx = -1 if x < 0 else 1
            for o in (-3.5, 3.5):
                sconce(S, sx * (W - 0.12), y + o, 3.2, (-sx, 0), lights, 'stack')
        for x in (-83.0, -77.0, 77.0, 83.0):
            sconce(S, x, -W + 0.12, 3.0, (0, 1), lights, 'wall')
    for i, (zx, zy, r, _h) in enumerate(B['zones']):
        zerog_ring(S, i, zx, zy, r, fonts)
    scale_ref(S, bay, *B['scale_ref'])
    if lod == 0:
        backdrop(S, B)
    S.lights = lights
    return S


# ---------------------------------------------------------------- data

def preset_data(bay, S0, ibl):
    B = BAYS[bay]
    W, H, half = B['W'], B['H'], B['half']
    (nx0, ny0), (nx1, ny1) = B['neutral']
    boxes = []
    for b in S0.boxes:
        if b['preset'] not in (None, bay):
            continue
        c, h = eng_box(b['lo'], b['hi'])
        boxes.append({'name': b['name'], 'center': c, 'half': h, 'phys': b['phys']})
    spheres = [{'name': s['name'], 'center': eng(s['c']), 'radius': round(s['r'], 4), 'phys': s['phys']}
               for s in S0.spheres if s['preset'] in (None, bay)]
    hulls = []
    for hh in S0.hulls:
        pts = [eng(p) for p in hh['pts']]
        hulls.append({'name': hh['name'], 'points': pts,
                      'aabb': {'min': [round(min(p[i] for p in pts), 4) for i in range(3)],
                               'max': [round(max(p[i] for p in pts), 4) for i in range(3)]}, 'phys': hh['phys']})
    cams = {'default': {'pos': eng(Vector(B['camera'])), 'target': eng(Vector(B['target'])), 'fovYDeg': B['fov']}}
    for name, c in B['cameras'].items():
        cams[name] = {'pos': eng(Vector(c['pos'])), 'target': eng(Vector(c['target'])), 'fovYDeg': lens_fov(c['lens']),
                      'focusM': c['focus'], 'fStop': c['fstop']}
    zones = []
    for i, (zx, zy, r, zh) in enumerate(B['zones']):
        w = 0.32 if r < 8 else 0.5
        zones.append({'name': 'zerog_%d' % i, 'field': 'antigrav', 'gravityPercent': 0, 'shape': 'cylinder',
                      'center': eng(Vector((zx, zy, zh / 2))), 'radius': r, 'halfHeight': zh / 2,
                      'box': eng_minmax((zx - r, zy - r, 0.0), (zx + r, zy + r, zh)),
                      'ring': {'center': eng(Vector((zx, zy, 0.0))), 'innerRadius': r - w, 'outerRadius': r + w,
                               'mesh': 'env_hangar__zone_%d_ring' % i}})
    practicals = []
    big = W > 50
    for p in S0.lights:
        kind = p['kind']
        d = p.get('dir', (0.0, 0.0, -1.0))
        if kind == 'strip':
            lm, outer, inner, rng = (120000 if big else 30000), 80.0, 60.0, (90.0 if big else 40.0)
        elif kind == 'area':
            lm, outer, inner, rng = (240000 if big else 60000), 70.0, 50.0, (90.0 if big else 40.0)
        else:
            lm, outer, inner, rng = p['lumens'], 75.0, 45.0, 10.0
        sr = 2 * math.pi * (1 - math.cos(math.radians(outer)))
        e = {'kind': kind, 'pos': eng(Vector(p['pos'])), 'dir': eng_dir(d), 'kelvin': p['kelvin'],
             'color': kelvin_rgb(p['kelvin']), 'lumens': lm, 'candela': round(lm / sr, 1), 'innerConeDeg': inner,
             'outerConeDeg': outer, 'rangeM': rng, 'shadowed': p['shadowed'], 'zone': p['zone']}
        for key, out in (('lengthM', 'lengthM'), ('sizeM', 'sizeM')):
            if key in p:
                e[out] = round(p[key], 3)
        e['bulbRadiusM'] = 0.06 if kind == 'sconce' else 0.12
        e['cyclesWatts'] = cycles_watts(kind, p, B)
        practicals.append(e)
    spots = renderer_spots(B, practicals)
    emit = [('amb_hangar_pa_chime', (-W + 0.5, -16.0, 9.0)), ('amb_hangar_pa_chime', (W - 0.5, 16.0, 9.0)),
            ('amb_hangar_window', (0.0, W - 0.5, 10.0))]
    for gy, gz, hx, _hz in B['gantry']:
        emit.append(('amb_hangar_gantry', (hx, gy, gz - 1.5)))
    for zx, zy, _r, _zh in B['zones']:
        emit.append(('amb_hangar_zerog_ring', (zx, zy, 0.3)))
    ec, er = earth_params(B)
    gx = W - 1.0
    return {
        'title': B['title'],
        'glb': 'env/hangar/hangar_%s.glb' % bay,
        'origin': [0, 0, 0],
        'bounds': eng_minmax((-half, -half, 0.0), (half, half, H)),
        'neutral': eng_minmax((nx0, ny0, 0.0), (nx1, ny1, 0.0)),
        'camera': cams['default']['pos'], 'target': cams['default']['target'],
        'cameras': cams,
        'drones': [eng(Vector(d)) for d in B['drones']],
        'scaleRef': eng(Vector(B['scale_ref'])),
        'boxes': boxes, 'spheres': spheres, 'hulls': hulls,
        'zones': zones,
        'practicals': spots,
        'lights': practicals,
        'probes': [{'name': n, 'center': eng(Vector(c)), 'half': [h[0], h[2], h[1]]} for n, c, h in B['probes']],
        'giVolume': {'center': eng(Vector((0.0, 0.0, B['C'] / 2))), 'half': [gx, B['C'] / 2, gx]},
        'emitters': [{'name': n, 'pos': eng(Vector(v))} for n, v in emit],
        # D128: runtime-lit, spinning about the planet's pole (set +Z = engine +Y; the bake's equirect axis), §5.3's
        # 1 deg / min. The 105 deg phase (D112, EARTH_PHASE) is applied by the renderer, not baked
        'earth': {'center': eng(ec), 'radius': round(er, 3), 'spinAxis': [0.0, 1.0, 0.0], 'degPerMinute': 1.0,
                  'lighting': 'runtime', 'phaseDeg': EARTH_PHASE,
                  'meshes': ['env_hangar__bd_earth'], 'texture': dict(EARTH_FILES)},
        'ibl': ibl,
    }


RIG_SUN = 9.0   # the renderer's practicals convert cyclesWatts against a strength-9 Cycles sun (look/practicals.ts)


def cycles_watts(kind, p, B):
    """A fixture's Cycles-equivalent point-light watts at the renderer's sun-9 scale (BAKE_SUN here is 6)."""
    k = RIG_SUN / BAKE_SUN
    if kind == 'area':        # the bake's area panel P (on-axis intensity P / pi) as a point light: 4 P
        s = p['sizeM']
        return round(4.0 * 1600.0 * (s / 1.92) ** 2 * k, 1)
    if kind == 'strip':       # ~0.6 W/m^2 (sun-6 scale) on the deck from each strip's share of the field
        return round(4 * math.pi * 0.6 * k * (B['C'] - 1.5) ** 2 / max(1, B['strips'][0] * B['strips'][1]) * 6.0, 1)
    return round(4 * math.pi * 0.02 * k * 4.0, 2)     # sconce: a warm accent pool of a few metres


def renderer_spots(B, lights):
    """The renderer's spot table (look/practicals.ts takes at most 8, the first `shadowed` one casts): the four zone
    panels (the first shadowed), then four wide downward fill spots, one per bay quadrant, standing in for the strip
    field (the strips themselves glow by emission and light the IBL)."""
    areas = [dict(l) for l in lights if l['kind'] == 'area']
    for i, a in enumerate(areas):
        a['shadowed'] = i == 0
    W, C = B['W'], B['C']
    k = RIG_SUN / BAKE_SUN
    fills = []
    for qx in (-0.5, 0.5):
        for qy in (-0.5, 0.5):
            h = C - 1.5
            cw = round(4 * math.pi * 1.0 * k * h * h, 1)
            fills.append({'kind': 'fill', 'pos': eng(Vector((qx * W, qy * W, h))), 'dir': [0.0, -1.0, 0.0], 'kelvin': 6500,
                          'color': kelvin_rgb(6500), 'lumens': 0, 'candela': 0, 'innerConeDeg': 55.0, 'outerConeDeg': 80.0,
                          'rangeM': round(h * 2.2, 1), 'shadowed': False, 'zone': 'ceiling', 'bulbRadiusM': 0.5,
                          'cyclesWatts': cw})
    return (areas + fills)[:8]


def env_data(S0s, ibls):
    d = SUN_TRAVEL.normalized()
    el = math.degrees(math.asin(-d.z))
    az = math.degrees(math.atan2(-d.x, -d.y))
    data = {'env': 'hangar', 'scale': 1, 'gravity': 'mars', 'gravityPercent': 38, 'air': 1.0, 'feel': 'real',
            'presets': {bay: preset_data(bay, S0s[bay], ibls[bay]) for bay in BAYS}}
    data['light'] = {
        'sunDir': eng_dir(d), 'sunElevationDeg': round(el, 2), 'sunAzimuthDeg': round(az, 2),
        'sunFrom': 'through the back-wall window (+Y), 30 deg up: grazes the shuttle, long window-frame shadows',
        'sunKelvin': 5800, 'sunColor': kelvin_rgb(5800), 'sunLux': 90000, 'sunAngleDeg': 0.53,
        'earthDir': eng_dir(EARTH_TRAVEL), 'earthKelvin': 9000, 'earthColor': '#9CC8FF', 'earthIntensity': 0.06,
        'earthShadowed': False, 'stripKelvin': 6500, 'sconceKelvin': 2700, 'space': '#000000',
        'ev100': 11.0, 'autoExposureEv': 0.5, 'tonemap': 'khronos-pbr-neutral', 'vignette': 0.12, 'grain': 0.015,
        'fogDensity': 0.0,
        'note': 'strip / area lumens are stylised for the brief\'s EV 11 interior (about 3,000 lux on the deck from '
                'the ceiling); the sun patches are far brighter, as §5.3 intends'}
    data['lut'] = {'name': 'lut_hangar', 'file': 'env/hangar/lut_hangar.png', 'size': 32,
                   'layout': 'strip 1024 x 32: red = x within a 32 px tile, green = y (top row 0), blue = tile index',
                   'space': 'display (after the tonemap)', 'grade': 'slightly cool shadows, neutral highlights'}
    ns = set()
    for S0 in S0s.values():
        for g, p in S0.pieces:
            if p in S0.noshadow:
                ns.add('env_hangar__%s%s' % ('bd_' if g == 'backdrop' else '', p))
    data['noShadow'] = sorted(ns)
    data['cutaway'] = ['env_hangar__front_wall']
    data['zoneColors'] = {'solo': FIELD, 'multiplayer': '#EEF1F6', 'glyphEveryDeg': 45}
    return data


TS_HEAD = '''// GENERATED by tools/blender/env_hangar.py (`node tools/assets.mjs --env-hangar`). Do not edit by hand.
// ORBITAL HANGAR (art/briefs/environments.md §5), M5 contract 4 (E5c -> W5): static colliders, zero-g zones, build
// zones, cameras, drones, light rig, probes, IBL and LUT names, generated from the same table as the bay glbs
// (assets/build/env/hangar/hangar_<preset>.glb). Each preset is its own bay ("Bay 2" = Warehouse, "Main Hall" = Arena).
// Real scale. Engine space: metres, Y-up, front (default camera side) = +Z; origin = the bay's bounds floor centre.
// Literals only (determinism lint).
'''

TS_TYPES = '''
/** Physics materials (environments.md §0.6; `concrete` / `regolith` are new for M5, SIMULATION §4.3). */
export type EnvPhys = 'powder' | 'wood' | 'ceramic' | 'steel' | 'glass' | 'rubber' | 'paper' | 'fabric' | 'concrete' | 'regolith';
export type EnvV3 = readonly [number, number, number];
export interface EnvBox { readonly name: string; readonly center: EnvV3; readonly half: EnvV3; readonly phys: EnvPhys }
export interface EnvSphere { readonly name: string; readonly center: EnvV3; readonly radius: number; readonly phys: EnvPhys }
/** Static convex hull (≤ 32 points, engine metres) for curved pieces; `aabb` is the box fallback. */
export interface EnvHull {
  readonly name: string; readonly points: readonly EnvV3[]; readonly aabb: { readonly min: EnvV3; readonly max: EnvV3 };
  readonly phys: EnvPhys;
}
export interface EnvCamera {
  readonly pos: EnvV3; readonly target: EnvV3; readonly fovYDeg: number; readonly focusM?: number; readonly fStop?: number;
}
/** A light, in the renderer's spot format (look/practicals.ts, as env_tinker.ts): position, direction, colour, cone,
 *  range, bulb radius, and `cyclesWatts` = its Cycles point-light watts against a strength-9 sun (the renderer's
 *  intensity), with the photometric lumens / candela kept as data. `kind`: strips (lengthM along the strip, dir down),
 *  area panels, sconces, windows, floods, the beacon, and the renderer-only quadrant `fill` spots. */
export interface EnvPractical {
  readonly kind: 'strip' | 'area' | 'sconce' | 'window' | 'flood' | 'beacon' | 'fill';
  readonly pos: EnvV3; readonly dir: EnvV3; readonly kelvin: number; readonly color: EnvV3; readonly lumens: number;
  readonly candela: number; readonly innerConeDeg: number; readonly outerConeDeg: number; readonly rangeM: number;
  readonly bulbRadiusM: number; readonly cyclesWatts: number;
  readonly shadowed: boolean; readonly zone: string;
  readonly lengthM?: number; readonly sizeM?: number;
  /** Light group that switches it (Moon `baseLights`, default off; see `lightGroups`); absent = always on. */
  readonly toggle?: string;
  readonly blinkHz?: number;
}
/** Baked environment light: equirect Radiance HDR + SH9; renderer scale = engine sun / bakeSunStrength. */
export interface EnvIbl {
  readonly name: string; readonly file: string; readonly format: string; readonly size: readonly [number, number];
  readonly probe: EnvV3; readonly sh9: readonly EnvV3[]; readonly bakeSunStrength: number;
}
export interface EnvLut { readonly name: string; readonly file: string; readonly size: number; readonly layout: string; readonly space: string; readonly grade: string }
/** Backdrop Earth: its glb mesh, with its texture set (`texture`, under the environment's folder; the env .json lists it
 *  as `textures`, bound like a part's set: material kn_env_earth_tex carries extras.texSet). D128 (beta polish): the set
 *  holds runtime-lighting inputs (`lighting: 'runtime'`): albedo = unlit reflectance (sRGB); orm = data, R cloud
 *  coverage, G night-lights intensity (ungated), B water mask; normal flat. The renderer lights it from the set's sun
 *  and spins it `degPerMinute` about `spinAxis` (engine space). `phaseDeg`, when present, is the art-directed phase
 *  angle the renderer turns the planet's sun to (the Hangar's 105 deg, D112). */
export interface EnvEarth {
  readonly center: EnvV3; readonly radius: number; readonly spinAxis: EnvV3; readonly degPerMinute: number;
  readonly lighting: 'runtime'; readonly phaseDeg?: number;
  readonly meshes: readonly string[];
  readonly texture: { readonly albedo: string; readonly normal: string; readonly orm: string; readonly size: number };
}
'''

TS_HANGAR = '''
/** An environment-authored zero-g zone (environments.md §5.1, `ZONE__field__zerog_n`): an Antigrav volume at 0 %
 *  gravity, togglable in world settings, never movable. `box` is the cylinder's bounding box. */
export interface HangarZone {
  readonly name: string; readonly field: 'antigrav'; readonly gravityPercent: number; readonly shape: 'cylinder';
  readonly center: EnvV3; readonly radius: number; readonly halfHeight: number;
  readonly box: { readonly min: EnvV3; readonly max: EnvV3 };
  /** The floor ring (glb root ZONE__field__<name>): meshes `<mesh>_led` (solo, Field colour), `<mesh>_led_dash` +
   *  `<mesh>_glyph` (multiplayer, dashed white + Field glyphs), `<mesh>_collar` / `_cover` / `_hazard`, `zone_<n>_ring_ink`. */
  readonly ring: { readonly center: EnvV3; readonly innerRadius: number; readonly outerRadius: number; readonly mesh: string };
}

export interface HangarPreset {
  /** "Bay 2" (Warehouse) or "Main Hall" (Arena). */
  readonly title: string;
  /** This bay's glb: LOD0..LOD2 > CHUNK__cx_cy, LOD3 > HLOD__hx_hy, BACKDROP, REF__scale__<preset>,
   *  ZONE__field__zerog_<n>, PROBES. */
  readonly glb: string;
  readonly origin: EnvV3;
  readonly bounds: { readonly min: EnvV3; readonly max: EnvV3 };
  /** Neutral build zone (§0.9), y = the deck. */
  readonly neutral: { readonly min: EnvV3; readonly max: EnvV3 };
  readonly camera: EnvV3;
  readonly target: EnvV3;
  readonly cameras: { readonly default: EnvCamera; readonly hero: EnvCamera; readonly wide: EnvCamera; readonly lobby: EnvCamera };
  readonly drones: readonly [EnvV3, EnvV3];
  readonly scaleRef: EnvV3;
  readonly boxes: readonly EnvBox[];
  readonly spheres: readonly EnvSphere[];
  readonly hulls: readonly EnvHull[];
  readonly zones: readonly HangarZone[];
  /** The renderer's spot table (≤ 8, look/practicals.ts MAX_SPOTS): the 4 zone panels (the first shadowed) + 4
   *  quadrant fills standing in for the strip field. */
  readonly practicals: readonly EnvPractical[];
  /** Every light fixture in the bay (48 / 220 strips, 4 zone panels, 16 / 48 sconces) for clustered lighting / GI. */
  readonly lights: readonly EnvPractical[];
  readonly probes: readonly { readonly name: string; readonly center: EnvV3; readonly half: EnvV3 }[];
  readonly giVolume: { readonly center: EnvV3; readonly half: EnvV3 };
  readonly emitters: readonly { readonly name: string; readonly pos: EnvV3 }[];
  readonly earth: EnvEarth;
  readonly ibl: EnvIbl;
}

export interface HangarEnv {
  readonly env: 'hangar';
  readonly scale: number;
  /** The Mars preset value, 38 % (the station's spin gravity). */
  readonly gravity: 'mars';
  readonly gravityPercent: number;
  readonly air: number;
  readonly feel: 'real';
  readonly presets: { readonly warehouse: HangarPreset; readonly arena: HangarPreset };
  /** §5.3. sunDir / earthDir = the direction the light travels; earthIntensity is × the sun. */
  readonly light: {
    readonly sunDir: EnvV3; readonly sunElevationDeg: number; readonly sunAzimuthDeg: number; readonly sunFrom: string;
    readonly sunKelvin: number; readonly sunColor: EnvV3; readonly sunLux: number; readonly sunAngleDeg: number;
    readonly earthDir: EnvV3; readonly earthKelvin: number; readonly earthColor: string; readonly earthIntensity: number;
    readonly earthShadowed: boolean; readonly stripKelvin: number; readonly sconceKelvin: number; readonly space: string;
    readonly ev100: number; readonly autoExposureEv: number; readonly tonemap: string; readonly vignette: number;
    readonly grain: number; readonly fogDensity: number; readonly note: string;
  };
  readonly lut: EnvLut;
  /** glb mesh-name prefixes that never cast shadows (window glass, cables, the backdrop). */
  readonly noShadow: readonly string[];
  /** Single-sided meshes drawn with back-face culling (Bay 2's front wall: the spawn camera is outside it). */
  readonly cutaway: readonly string[];
  /** Floor-ring LED colours, baked into the ring masters: `_led` is kn_env_field_led (Field pink, solo), `_led_dash`
   *  and `_glyph` are kn_env_led_white (multiplayer). Solo: hide `_led_dash` + `_glyph`; multiplayer: hide `_led`. */
  readonly zoneColors: { readonly solo: string; readonly multiplayer: string; readonly glyphEveryDeg: number };
}
'''


def write_ts(path, data, stats):
    lines = [TS_HEAD + '// ' + stats, TS_TYPES, TS_HANGAR]
    lines.append('export const HANGAR: HangarEnv = %s;' % ts_literal(data))
    lines.append('')
    lines.append("export const HANGAR_PRESETS = ['warehouse', 'arena'] as const;")
    lines.append('')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))


# ---------------------------------------------------------------- IBL rig and LUT

BAKE_SUN = 6.0


def bake_rig(sc, B):
    """Space: black world, the hard 5,800 K sun through the window, the cool Earthlight from below the window line
    (unshadowed), the four zone panels as area lights. Strips, sconces, Earth and stars light by emission."""
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1)
    bg.inputs[1].default_value = 0.0
    out = []
    for name, travel, energy, col, shadow in (('Sun', SUN_TRAVEL, BAKE_SUN, kelvin_rgb(5800), True),
                                              ('Earthlight', EARTH_TRAVEL, BAKE_SUN * 0.06, (0.61, 0.78, 1.0), False)):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy, ld.angle, ld.color = energy, math.radians(0.53), tuple(col[:3])
        ld.use_shadow = shadow
        o = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(o)
        o.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()
        out.append(o)
    (nx0, ny0), (nx1, ny1) = B['neutral']
    s = 0.12 * (nx1 - nx0)
    for fx in (0.25, 0.75):
        for fy in (0.25, 0.75):
            ld = bpy.data.lights.new('zone_panel', 'AREA')
            ld.size = s
            ld.energy = 1600.0 * (s / 1.92) ** 2
            ld.color = tuple(kelvin_rgb(6500))
            o = bpy.data.objects.new('zone_panel', ld)
            sc.collection.objects.link(o)
            o.location = (nx0 + (nx1 - nx0) * fx, ny0 + (ny1 - ny0) * fy, B['C'] - 1.95)
            out.append(o)
    if B['W'] > 50:
        # the Main Hall's 220 strips as a soft ceiling bounce: in the bake the thin emissive lenses alone left the 260 m
        # hall's walls near black in engine (its IBL mean was 0.2 against Bay 2's 0.55); four broad panels under the
        # ceiling bring the walls to mid-grey without touching the sun patches
        for fx in (-0.5, 0.5):
            for fy in (-0.5, 0.5):
                ld = bpy.data.lights.new('hall_bounce', 'AREA')
                ld.size = 90.0
                ld.energy = 9000.0
                ld.color = tuple(kelvin_rgb(6500))
                o = bpy.data.objects.new('hall_bounce', ld)
                sc.collection.objects.link(o)
                o.location = (fx * B['W'], fy * B['W'], B['C'] - 3.0)
                out.append(o)
    return out


def flag_objects():
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH' and '__noshadow' in ob.name:
            ob.visible_shadow = False


GRADE = envset.cool_shadows((-0.012, -0.002, 0.016), sat=1.0, s_curve=0.006)


# ---------------------------------------------------------------- render (look-dev from the exported glbs)

def rebind(root, solo=True):
    """Imported glb materials -> the masters by id (as the engine does), with readable stand-ins for the
    renderer-driven ones: ring LEDs in the solo Field colour (the multiplayer dash / glyph pieces hidden),
    screens a soft cyan."""
    imported = [m for m in bpy.data.materials if not m.library and m.name.split('.')[0].startswith('kn_')]
    names = sorted({m.name.split('.')[0] for m in imported})
    masters, _local = envset.materials(paths.materials_lib(root), names)
    for m in imported:
        m.user_remap(masters[m.name.split('.')[0]])
    for name, col, strength in (('kn_led', FIELD, 6.0), ('kn_screen', '#5FD8FF', 2.5)):
        if name not in masters:
            continue
        mm = masters[name].copy()
        p = mm.node_tree.nodes.get('Principled BSDF') if mm.use_nodes else None
        if p:
            p.inputs['Emission Color'].default_value = library.hexcol(col, cap=10)
            p.inputs['Emission Strength'].default_value = strength
        for ob in bpy.data.objects:
            if ob.type != 'MESH':
                continue
            for slot in ob.material_slots:
                if slot.material is masters[name]:
                    slot.material = mm
    for ob in bpy.data.objects:   # the multiplayer ring pieces stay hidden in a solo frame
        if ob.type == 'MESH' and solo and ('ring_led_dash' in ob.name or 'ring_glyph' in ob.name):
            ob.hide_render = True


def render(root, bay, out_png, samples):
    """Render the exported bay: the hero view (window, Earth, shuttle) over the spawn view, stacked."""
    import numpy as np
    import render_lookdev as rl
    B = BAYS[bay]
    shots = []
    for view in ('hero', 'default'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'assets', 'build', 'env', ENV, 'hangar_%s.glb' % bay))
        keep = ('LOD0', 'BACKDROP', 'REF__scale__', 'ZONE__field__')
        for ob in list(bpy.data.objects):
            top = ob
            while top.parent is not None:
                top = top.parent
            if not top.name.split('.')[0].startswith(keep):
                bpy.data.objects.remove(ob, do_unlink=True)
        rebind(root)
        use_cycles_earth(earth_lit_png(root, ENV, 'earth_hangar'))   # D128: Cycles sees the lit look-dev bake
        flag_objects()
        if view == 'default':
            for ob in list(bpy.data.objects):
                if 'front_wall' in ob.name:
                    bpy.data.objects.remove(ob, do_unlink=True)
        bake_rig(sc, B)
        cd = bpy.data.cameras.new('cam')
        cd.clip_end = 20000.0
        cam = bpy.data.objects.new('cam', cd)
        sc.collection.objects.link(cam)
        if view == 'default':
            pos, tgt = Vector(B['camera']), Vector(B['target'])
            cd.lens = 18.0 * 9 / 16 / math.tan(math.radians(B['fov'] / 2))
        else:
            c = B['cameras']['hero']
            pos, tgt, cd.lens = Vector(c['pos']), Vector(c['target']), c['lens']
            cd.dof.use_dof = True
            cd.dof.focus_distance = c['focus']
            cd.dof.aperture_fstop = c['fstop'] * 2
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        rl.use_cycles(sc, samples)
        sc.cycles.max_bounces = 6
        sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
        sc.view_settings.exposure = -0.4 if view == 'hero' else -0.2
        p = out_png.replace('.png', '_%s.tmp.png' % view)
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        shots.append(p)
    stack_pngs(shots, out_png)
    for p in shots:
        os.remove(p)
    print('rendered', out_png)


def stack_pngs(shots, out_png):
    import numpy as np
    imgs = []
    for p in shots:
        im = bpy.data.images.load(p)
        im.colorspace_settings.name = 'Non-Color'
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(im.size[1], im.size[0], 4))
    full = np.concatenate(list(reversed(imgs)), axis=0)
    out = bpy.data.images.new('stack', full.shape[1], full.shape[0], alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    out.pixels.foreach_set(full.ravel())
    out.filepath_raw = out_png
    out.file_format = 'PNG'
    out.save()


# ---------------------------------------------------------------- main

def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    cols = {}
    for name in ('LOD0', 'LOD1', 'LOD2', 'LOD3', 'BACKDROP', 'EXTRA', 'COL', 'BOUNDS', 'SPAWN', 'ZONE', 'PROBE'):
        c = bpy.data.collections.new('ENV_RENDER' if name == 'LOD0' else name)
        sc.collection.children.link(c)
        cols[name] = c
    return sc, cols


def build_bay(root, bay, out_dir, no_blend, no_bake, ibl_samples):
    B = BAYS[bay]
    sc, cols = new_scene()
    fonts = {'sym': bpy.data.fonts.load(os.path.join(root, 'assets', 'src', 'lib', 'fonts', 'DejaVuSans-Bold.ttf'))}
    builds = [build(bay, lod, fonts) for lod in range(4)]
    names = sorted({m for S in builds for k in S.pieces.values() for m in k.mats})
    bad = [m for m in names if not is_master_material(m)]
    if bad:
        _cli.die('not master materials: %s' % ', '.join(bad))
    mats, local = envset.materials(paths.materials_lib(root), names)
    if local:
        print('  masters built locally (not in materials.blend yet): %s' % ', '.join(local))
    outs = [envset.to_objects(S, ENV, mats, cols) for S in builds]
    S0 = builds[0]
    tris = [envset.tri_count(list(cols['LOD%d' % i].objects)) for i in range(4)]
    bd = envset.tri_count(list(cols['BACKDROP'].objects))
    extra = envset.tri_count(list(cols['EXTRA'].objects))
    for i, t in enumerate(tris):
        print('  %s LOD%d: %d tris (%.1f %%)' % (bay, i, t, 100.0 * t / tris[0]))
    print('  %s backdrop %d tris, rings + scale ref %d, %d boxes, %d spheres, %d hulls, %d practicals, %d objects'
          % (bay, bd, extra, len(S0.boxes), len(S0.spheres), len(S0.hulls), len(S0.lights), len(bpy.data.objects)))
    if os.environ.get('KN_PIECES'):
        per = {}
        for o in cols['LOD0'].objects:
            key = o.name.split('__c')[0]
            per[key] = per.get(key, 0) + envset.tri_count([o])
        for n, t in sorted(per.items(), key=lambda x: -x[1])[:30]:
            print('    %8d  %s' % (t, n))
    add_box_markers(cols['COL'], S0.boxes)
    half, H = B['half'], B['H']
    empty(cols['BOUNDS'], 'BOUNDS__' + bay, (0, 0, H / 2), (half, half, H / 2), 'CUBE')
    (nx0, ny0), (nx1, ny1) = B['neutral']
    empty(cols['ZONE'], 'ZONE__neutral__' + bay, ((nx0 + nx1) / 2, (ny0 + ny1) / 2, 0.025),
          ((nx1 - nx0) / 2, (ny1 - ny0) / 2, 0.025), 'CUBE')
    for i, (zx, zy, r, zh) in enumerate(B['zones']):
        e = empty(cols['ZONE'], 'ZONE__field__zerog_%d_volume' % i, (zx, zy, zh / 2), (r, r, zh / 2), 'CUBE')
        e['field'], e['gravity_percent'] = 'antigrav', 0
    for nm, loc in (('camera', B['camera']), ('target', B['target']), ('drone__p1', B['drones'][0]),
                    ('drone__p2', B['drones'][1]), ('scale_ref', B['scale_ref'])):
        empty(cols['SPAWN'], 'SPAWN__%s__%s' % (nm, bay), loc)
    for name, c in B['cameras'].items():
        empty(cols['SPAWN'], 'SPAWN__camera_%s__%s' % (name, bay), c['pos'])
    for n, c, h in B['probes']:
        empty(cols['PROBE'], 'PROBE__reflect__' + n, c, h, 'CUBE')
    empty(cols['PROBE'], 'PROBE__ibl__0', B['ibl_probe'], None, 'SPHERE')
    for key, val in (('kn_env', ENV), ('kn_presets', bay), ('kn_gravity', 'mars'), ('kn_air', 100), ('kn_feel', 'real'),
                     ('kn_notes', B['title'])):
        sc[key] = val
    if not no_blend:
        src = os.path.join(root, 'assets', 'src', 'env', ENV, 'hangar_%s.blend' % bay)
        os.makedirs(os.path.dirname(src), exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=src, compress=True, relative_remap=True)
        print('saved', src)
    tree = {}
    for lod in range(3):
        tree['LOD%d' % lod] = [('CHUNK__%d_%d' % key, objs) for key, objs in sorted(outs[lod]['chunks'].items())]
    tree['LOD3'] = [('HLOD__%d_%d' % key, objs) for key, objs in sorted(outs[3]['hlod'].items())]
    tree['BACKDROP'] = outs[0]['backdrop']
    for g, objs in sorted(outs[0]['groups'].items()):
        root_name = ('REF__scale__' + g[4:]) if g.startswith('ref_') else ('ZONE__field__zerog_' + g[5:])
        tree[root_name] = objs
    tree['PROBES'] = list(cols['PROBE'].objects)
    glb = os.path.join(out_dir, 'hangar_%s.glb' % bay)
    envset.export_tree(tree, glb)
    from kn_tools import textures as kt
    print('exported', glb, os.path.getsize(glb), 'bytes; texSet on %d material(s)' % kt.patch_glb(glb, {EARTH_MAT}, 'earth'))
    use_cycles_earth(earth_lit_png(root, ENV, 'earth_hangar'))   # D128: the IBL bake sees the lit look-dev Earth
    name = 'ibl_hangar_%s' % bay
    ibl_json = os.path.join(out_dir, name + '.json')
    if no_bake and os.path.exists(ibl_json):
        with open(ibl_json, encoding='utf-8') as f:
            meta = json.load(f)
    else:
        for c in ('LOD1', 'LOD2', 'LOD3', 'EXTRA'):
            cols[c].hide_render = c != 'EXTRA'
        flag_objects()
        added = bake_rig(sc, B)
        px, w, h = envset.bake_equirect(B['ibl_probe'], os.path.join(out_dir, name + '.hdr'), ibl_samples)
        meta = {'name': name, 'file': 'env/hangar/%s.hdr' % name, 'format': 'equirect-hdr', 'size': [w, h],
                'probe': eng(Vector(B['ibl_probe'])), 'sh9': envset.sh9(px), 'bakeSunStrength': BAKE_SUN,
                'meanRadiance': [round(float(px[:, :, c].mean()), 5) for c in range(3)], 'samples': ibl_samples,
                'note': 'Cycles bake of hangar_%s.glb LOD0 + backdrop with the §5.3 rig; centre column faces the back '
                        'wall (engine -Z)' % bay}
        envset.write_json(ibl_json, meta)
        for ob in added:
            bpy.data.objects.remove(ob, do_unlink=True)
    S0.stats = {'lodTris': tris, 'backdropTris': bd, 'ringsAndRefTris': extra, 'masters': names,
                'glbBytes': os.path.getsize(glb)}
    ibl = {k: meta[k] for k in ('name', 'file', 'format', 'size', 'probe', 'sh9', 'bakeSunStrength')}
    return S0, ibl, '%s LOD0..3 %s, backdrop %d' % (bay, ' / '.join(str(t) for t in tris), bd)


def main():
    args = _cli.script_args()
    no_ts = _cli.flag(args, '--no-ts')
    no_blend = _cli.flag(args, '--no-blend')
    no_bake = _cli.flag(args, '--no-bake')
    ibl_samples = int(_cli.option(args, '--ibl-samples', '96'))
    only = _cli.option(args, '--bay')
    render_png = _cli.option(args, '--render')
    samples = int(_cli.option(args, '--samples', '96'))
    root = paths.repo_root()
    out_dir = os.path.join(root, 'assets', 'build', 'env', ENV)
    if render_png:
        for bay in ([only] if only else list(BAYS)):
            render(root, bay, render_png if bay == 'warehouse' or only else render_png.replace('.png', '_arena.png'),
                   samples)
        return
    library.ensure_libs(root)
    load_all()
    os.makedirs(out_dir, exist_ok=True)
    envset.write_lut(os.path.join(out_dir, 'lut_hangar.png'), GRADE)
    c, R_ = earth_params(BAYS['warehouse'])      # both bays frame Earth alike (scaled), so one bake serves both
    EARTH_FILES.update(earth_bake(out_dir, 'earth_hangar', 2048, c, R_, Vector((0.0, 0.0, 1.7)), -SUN_TRAVEL,
                                  phase_deg=EARTH_PHASE, lit_path=earth_lit_png(root, ENV, 'earth_hangar')))
    S0s, ibls, stats = {}, {}, []
    for bay in BAYS:
        S0s[bay], ibls[bay], line = build_bay(root, bay, out_dir, no_blend, no_bake, ibl_samples)
        stats.append(line)
    data = env_data(S0s, ibls)
    full = dict(data)
    full['stats'] = {bay: S0s[bay].stats for bay in BAYS}
    full['textures'] = dict(EARTH_FILES)      # gfx/environment.ts binds it (texSetsOf) for kn_env_earth_tex
    envset.write_json(os.path.join(out_dir, 'hangar.env.json'), full)
    if not no_ts:
        nb = ', '.join('%s %d boxes + %d hulls' % (b, len(p['boxes']), len(p['hulls'])) for b, p in data['presets'].items())
        write_ts(os.path.join(root, 'packages', 'parts-data', 'src', 'env_hangar.ts'), data, ' · '.join(stats) + ' · ' + nb)
    _ = PROPS


if __name__ == '__main__':
    main()
