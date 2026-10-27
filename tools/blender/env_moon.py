"""Procedurally build MOON BASE (environments.md §6): flat grey regolith under a hard white sun and a black sky, a
sintered landing apron, a habitat dome and an original rounded toy lander as landmarks, a rover, solar arrays, an
antenna mast, supply crates, a KNOCK-ON pennant, boulders, craters and ridges, Earth low on the horizon. One set
serves Room, Warehouse and Arena (all presets share the origin, §6.1).

Usage: blender -b --factory-startup -P tools/blender/env_moon.py -- [--no-ts] [--no-blend] [--no-bake] [--ibl-samples N]
       blender -b --factory-startup -P tools/blender/env_moon.py -- --render <out.png> [--samples N]
   or: node tools/assets.mjs --env-moon [--render]

Outputs (assets/build/env/moon/)
  moon.glb                       LOD0..LOD2 > CHUNK__<cx>_<cy>, LOD3 > HLOD__<hx>_<hy>, BACKDROP, REF__scale__<preset>,
                                 PROBES. Set coordinates (= every preset's world coordinates).
  moon_boulders.glb              extra visual-only boulders per tier, outside the Arena bounds: TIER8, TIER12, TIER16
  moon_<preset>.height.r16       the authored heightfield the sim loads (TerrainRecord layout, see env_moon.ts) + .png
  terrain/terrain_<layer>_*.png  regolith and sintered-apron tiling sets (basecolor + height in A, normal, orm), and the
                                 regolith micro-pebble detail normal
  ibl_moon.hdr / .json           Cycles equirect bake (2048 x 1024) + SH9
  lut_moon.png                   32^3 LUT strip: neutral, slight cool shadows
  moon.env.json                  the generated data as JSON (tooling)
  assets/src/env/moon/moon_set.blend   source
  packages/parts-data/src/env_moon.ts  generated literals (M5 contract 4), with the heightfield as integer samples

Set coordinates: Blender metres, Z up, origin = the bounds floor centre of every preset; +Y = away from the default
camera. The base sits on the flat floor (Z 0) of a shallow basin: the ground is never below Z 0 (u16 heights), so the
crater field and the ridges rise around the base rather than dig below it.
"""
import json
import math
import os
import random
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import env_hangar as H  # noqa: E402  (shared primitives: bx, scale_ref, kelvin_rgb, rebind, ...)
from kn_tools import envset, library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import Kit, at, outline_circle, outline_rrect  # noqa: E402
from props.core import PROPS, load_all, place  # noqa: E402
from props.envkit import add_box_markers, empty, eng, eng_box, eng_dir, eng_minmax, ts_literal  # noqa: E402

ENV = 'moon'
SpaceSet = H.SpaceSet
bx, box_corners = H.bx, H.box_corners
REG, SINT, DARK, ROCK = 'kn_env_regolith', 'kn_env_regolith_sintered', 'kn_env_regolith_dark', 'kn_env_rock'
GRAPH, AMBER, BONE, IGN, STEEL = H.GRAPH, H.AMBER, H.BONE, H.IGN, H.STEEL
FOIL = 'kn_env_foil_gold'

SUN_EL, SUN_AZ = 18.0, 240.0   # azimuth from +Y toward +X: 240 = from the front-left (§6.4 "from front-left, raking")
_to_sun = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)),
                  math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL))))
SUN_TRAVEL = -_to_sun
EARTH_EL, EARTH_AZ, EARTH_DIAM, EARTH_D = 12.0, 25.0, 2.0, 1850.0   # inside the renderer's 2 km far plane
TO_EARTH = Vector((math.sin(math.radians(EARTH_AZ)) * math.cos(math.radians(EARTH_EL)),
                   math.cos(math.radians(EARTH_AZ)) * math.cos(math.radians(EARTH_EL)), math.sin(math.radians(EARTH_EL))))
APRON_R = 24.0
EARTH_FILES = {'albedo': 'earth_moon.albedo.png', 'normal': 'earth_moon.normal.png', 'orm': 'earth_moon.orm.png', 'size': 1024}
# The renderer draws to 2 km (gfx/renderer.ts far plane): the backdrop ground runs to 1.2 km, the highlands to 1.9 km
# (scaled so their silhouettes keep the 2-8 km read: ~4 deg at most, crisp, no haze), Earth and the stars inside it.
FAR_GROUND, HIGHLANDS_R = 1200.0, 1900.0
SPACING = 0.5

PRESETS = {   # §6.1
    'room': {'half': 8.0, 'H': 8.0, 'neutral': ((-4.0, -5.0), (4.0, 3.0)), 'target': (0.0, -1.0, 0.5),
             'camera': (0.0, -12.5, 7.15), 'scale_ref': (5.5, -6.0, 0.0), 'drones': ((-3.0, -9.0, 3.0), (3.0, -9.0, 3.0)),
             'field': 32.0},
    'warehouse': {'half': 32.0, 'H': 24.0, 'neutral': ((-8.0, -12.0), (8.0, 4.0)), 'target': (0.0, -4.0, 1.0),
                  'camera': (0.0, -34.3, 18.5), 'scale_ref': (10.5, -13.5, 0.0),
                  'drones': ((-5.0, -26.0, 8.0), (5.0, -26.0, 8.0)), 'field': 32.0},
    'arena': {'half': 128.0, 'H': 64.0, 'neutral': ((-16.0, -20.0), (16.0, 12.0)), 'target': (0.0, -8.0, 2.0),
              'camera': (0.0, -76.0, 41.0), 'scale_ref': (18.5, -21.5, 0.0),
              'drones': ((-8.0, -60.0, 20.0), (8.0, -60.0, 20.0)), 'field': 128.0},
}
CAMERAS = {   # look-dev / photo / lobby views, set space (shared by every preset)
    'hero': {'pos': (-9.0, -30.0, 2.6), 'target': (6.0, 30.0, 8.5), 'lens': 24, 'focus': 52.0, 'fstop': 8.0},
    'wide': {'pos': (-62.0, -70.0, 30.0), 'target': (2.0, 18.0, 2.0), 'lens': 22, 'focus': 100.0, 'fstop': 11.0},
    'lobby': {'pos': (-14.5, 7.5, 1.7), 'target': (-21.0, 17.0, 4.2), 'lens': 40, 'fstop': 2.8, 'focus': 11.5},
}
PROBES = {
    'room': [('apron', (0.0, 0.0, 3.0), (10.0, 10.0, 3.0)), ('dome', (0.0, 30.0, 6.0), (16.0, 12.0, 6.0))],
    'warehouse': [('apron', (0.0, -4.0, 4.0), (24.0, 24.0, 4.0)), ('dome', (0.0, 36.0, 8.0), (18.0, 12.0, 8.0)),
                  ('lander', (-22.0, 18.0, 6.0), (10.0, 10.0, 6.0)), ('rover', (20.0, 6.0, 3.0), (8.0, 8.0, 3.0))],
    'arena': [('q%d%d' % (i, j), (-96.0 + 64.0 * i, -96.0 + 64.0 * j, 8.0), (32.0, 32.0, 8.0))
              for i in range(4) for j in range(4)],
}
IBL_PROBE = (0.0, -4.0, 1.6)

# props and their flat pads: (x, y, flat radius, blend)
LANDER = (-22.0, 18.0, 20.0)       # x, y, yaw
ROVER = (20.0, 6.0, 25.0)
DOME = (0.0, 40.0, 15.0)            # x, y, radius (15 m tall hemisphere)
ARRAYS = [(40.0, 40.0), (55.0, 40.0), (70.0, 40.0)]
ANTENNA = (-60.0, 60.0, 25.0)
PENNANT = (-13.5, 23.0)
PADS = [(LANDER[0], LANDER[1], 9.0, 6.0), (ROVER[0], ROVER[1], 4.0, 3.0), (DOME[0], DOME[1], 18.0, 6.0)] + \
       [(x, y, 6.0, 4.0) for x, y in ARRAYS] + [(ANTENNA[0], ANTENNA[1], 5.0, 4.0)]
# craters: (x, y, diameter, depth rim-to-floor, rim height); large + 6 medium in the field, more beyond (render only)
CRATERS = [(80.0, -70.0, 60.0, 8.0, 2.2),
           (-70.0, -30.0, 18.0, 3.6, 0.8), (-95.0, 20.0, 14.0, 3.0, 0.7), (55.0, -100.0, 16.0, 3.4, 0.8),
           (-40.0, -98.0, 22.0, 4.6, 1.0), (102.0, 28.0, 12.0, 2.6, 0.6), (-100.0, -72.0, 25.0, 5.0, 1.1)]


# ---------------------------------------------------------------- the authored heightfield (numpy, set coords)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


_T = np.random.default_rng(1969).random((256, 256))


def vnoise(X, Y, cell, octaves=4, seed=0):
    """Value-noise fBm in [-1, 1] (a fixed lattice table: deterministic everywhere)."""
    out = np.zeros_like(X, dtype=np.float64)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gx = X / cell + 37.0 * (seed + o)
        gy = Y / cell + 91.0 * (seed + o)
        ix, iy = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
        fx, fy = gx - ix, gy - iy
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = _T[iy % 256, ix % 256]
        b = _T[iy % 256, (ix + 1) % 256]
        c = _T[(iy + 1) % 256, ix % 256]
        d = _T[(iy + 1) % 256, (ix + 1) % 256]
        v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
        out += amp * (v * 2 - 1)
        tot += amp
        amp *= 0.5
        cell *= 0.5
    return out / tot


def far_craters():
    rng = random.Random(4)
    out = []
    for _ in range(36):
        r = rng.uniform(220.0, 1700.0)
        a = rng.uniform(0, 2 * math.pi)
        D = rng.uniform(20.0, 160.0)
        out.append((r * math.cos(a), r * math.sin(a), D, D * 0.2, D * 0.045))
    return out


ALL_CRATERS = CRATERS + far_craters()


def crater_delta(X, Y, c):
    x, y, D, depth, rim = c
    R = D / 2
    d = np.hypot(X - x, Y - y) / R
    inside = rim - depth * np.clip(1.0 - d * d, 0.0, 1.0) ** 0.85
    outside = rim * np.exp(-((d - 1.0) / 0.38) ** 2)
    return np.where(d < 1.0, inside, outside) * (d < 3.0)


def raw_height(X, Y, craters=ALL_CRATERS):
    """The analytic ground (before pads and flats): basin floor at 0 inside r 40, rising to ~7 m beyond r 110 with
    undulation, the ridge toward the back edge, the craters."""
    r = np.hypot(X, Y)
    h = 7.0 * smoothstep(50.0, 110.0, r)
    h += 1.3 * vnoise(X, Y, 48.0, 4, 1) * smoothstep(42.0, 85.0, r)
    h += 18.0 * smoothstep(92.0, 126.0, Y) * (0.62 + 0.38 * vnoise(X, Y * 0.3, 60.0, 3, 2)) * \
        (1.0 - smoothstep(260.0, 520.0, np.abs(X))) * (1.0 - smoothstep(320.0, 640.0, Y))
    # beyond the Arena: gentle hills toward the highlands (render only)
    h += 26.0 * smoothstep(300.0, 1600.0, r) * (0.5 + 0.5 * vnoise(X, Y, 500.0, 3, 3))
    for c in craters:
        if abs(c[0]) < 2000 and abs(c[1]) < 2000:
            h = h + crater_delta(X, Y, c)
    return h


def height(X, Y):
    """The final authored ground: flat pads under the props (at their own level), the apron and every neutral zone
    flat at 0, never below 0."""
    h = raw_height(X, Y)
    for (cx, cy, rf, rb) in PADS:
        level = float(raw_height(np.array([cx]), np.array([cy]))[0])
        level = max(0.0, level)
        w = 1.0 - smoothstep(rf, rf + rb, np.hypot(X - cx, Y - cy))
        h = h * (1 - w) + level * w
    flat = 1.0 - smoothstep(APRON_R + 6.0, APRON_R + 14.0, np.hypot(X, Y))
    (zx0, zy0), (zx1, zy1) = PRESETS['arena']['neutral']
    dx = np.maximum(np.maximum(zx0 - 3.0 - X, X - zx1 - 3.0), 0.0)
    dy = np.maximum(np.maximum(zy0 - 3.0 - Y, Y - zy1 - 3.0), 0.0)
    flat = np.maximum(flat, 1.0 - smoothstep(0.0, 6.0, np.hypot(dx, dy)))
    h = h * (1 - flat)
    return np.maximum(h, 0.0)


def field_samples(half):
    """Heights (m) on the sim grid of a field of half-size `half`: rows along engine +z from z = -half (set y =
    +half, the back), columns along +x from x = -half."""
    n = int(round(2 * half / SPACING)) + 1
    xs = -half + SPACING * np.arange(n)
    ys = half - SPACING * np.arange(n)
    X, Y = np.meshgrid(xs, ys)
    return height(X, Y), n


def quantize(h, maxh):
    return np.clip(np.round(h * 65535.0 / maxh), 0, 65535).astype(np.uint16)


class Ground:
    """Bilinear ground sampler over the Arena field as the sim sees it (dequantized u16)."""

    def __init__(self, u16, n, half, maxh):
        self.h = u16.astype(np.float64) * maxh / 65535.0
        self.n, self.half = n, half

    def at(self, x, y):
        fx = (x + self.half) / SPACING
        fz = (self.half - y) / SPACING
        if fx < 0 or fz < 0 or fx > self.n - 1 or fz > self.n - 1:
            return float(height(np.array([x]), np.array([y]))[0])
        ix, iz = min(self.n - 2, int(fx)), min(self.n - 2, int(fz))
        ux, uz = fx - ix, fz - iz
        a, b = self.h[iz, ix], self.h[iz, ix + 1]
        c, d = self.h[iz + 1, ix], self.h[iz + 1, ix + 1]
        return float(a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz)

    def min_under(self, x, y, r):
        return min(self.at(x + dx, y + dy) for dx in (-r, 0, r) for dy in (-r, 0, r))


# ---------------------------------------------------------------- terrain render mesh

def terrain_piece(S, G):
    """The field's render mesh: one grid per 32 m chunk (1 / 2 / 4 m at LOD0 / 1 / 2, 8 m merged at LOD3), vertex
    heights = the sim's samples, lowered 5 cm under the apron tiles (render only). Slopes over 26 deg are rock."""
    step = (2, 4, 8, 16)[S.lod]            # in samples (0.5 m)
    n_chunk = int(envset.CHUNK / SPACING)
    half = G.half
    k = S.kit('terrain')
    rock = k.mi(ROCK)
    reg = k.mi(REG)
    bm = k.bm
    nc = int(2 * half / envset.CHUNK)
    for cj in range(nc):
        for ci in range(nc):
            i0, j0 = ci * n_chunk, cj * n_chunk
            m = n_chunk // step + 1
            vs = []
            for jj in range(m):
                row = []
                for ii in range(m):
                    ix, iz = i0 + ii * step, j0 + jj * step
                    x, y = -half + ix * SPACING, half - iz * SPACING
                    z = G.h[iz, ix]
                    if math.hypot(x, y) < APRON_R - 0.4:
                        z -= 0.05
                    row.append(bm.verts.new((x, y, z)))
                vs.append(row)
            for jj in range(m - 1):
                for ii in range(m - 1):
                    a, b, c, d = vs[jj][ii], vs[jj][ii + 1], vs[jj + 1][ii + 1], vs[jj + 1][ii]
                    f = bm.faces.new((a, d, c, b))       # CCW from above (rows run toward -y)
                    f.normal_update()
                    if f.normal.z < 0:
                        f.normal_flip()
                    f.material_index = rock if f.normal.z < math.cos(math.radians(26)) else reg
    S.keepnormals.add('terrain')


def backdrop_terrain(S, G):
    """Beyond the field (render only, never casts onto the set): a polar grid from the field edge to 1.2 km on the
    same analytic ground, then the highlands to 1.9 km, scaled to read like §6.1's 2-8 km range (crisp, no haze)."""
    k = S.kit('ground_far', 'backdrop')
    bm = k.bm
    na = 192
    radii = [120.0 * (FAR_GROUND / 120.0) ** (i / 40) for i in range(41)]
    ang = [2 * math.pi * a / na for a in range(na)]
    X = np.array([[r * math.cos(a) for a in ang] for r in radii])
    Y = np.array([[r * math.sin(a) for a in ang] for r in radii])
    Z = height(X, Y)
    half = G.half
    inside = (np.abs(X) < half - 1.0) & (np.abs(Y) < half - 1.0)
    Z = np.where(inside, Z - 0.6, Z - 0.02)
    vs = [[bm.verts.new((float(X[i, j]), float(Y[i, j]), float(Z[i, j]))) for j in range(na)] for i in range(len(radii))]
    mi = k.mi(REG)
    for i in range(len(radii) - 1):
        for j in range(na):
            jn = (j + 1) % na
            if inside[i, j] and inside[i, jn] and inside[i + 1, j] and inside[i + 1, jn]:
                continue
            f = bm.faces.new((vs[i][j], vs[i][jn], vs[i + 1][jn], vs[i + 1][j]))
            f.material_index = mi
    # highlands: 2-8 km, ridged silhouettes up to ~420 m
    kh = S.kit('highlands', 'backdrop')
    bmh = kh.bm
    rr = [FAR_GROUND + (HIGHLANDS_R - FAR_GROUND) * (i / 10) ** 1.2 for i in range(11)]
    rng = np.random.default_rng(11)
    ph = rng.uniform(0, 2 * np.pi, 6)
    vh = []
    for i, r in enumerate(rr):
        row = []
        for j, a in enumerate(ang):
            base = float(height(np.array([FAR_GROUND * math.cos(a)]), np.array([FAR_GROUND * math.sin(a)]))[0]) if i == 0                 else 0.0
            t = i / 10
            ridge = sum(abs(math.sin(a * (k_ + 2) + ph[k_])) ** 1.5 / (k_ + 1) for k_ in range(6))
            z = base if i == 0 else base + (18.0 + 105.0 * ridge / 2.45) * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.7
            z = z if i < 10 else z * 0.4
            row.append(bmh.verts.new((r * math.cos(a), r * math.sin(a), z)))
        vh.append(row)
    mh = kh.mi(REG)
    for i in range(len(rr) - 1):
        for j in range(na):
            jn = (j + 1) % na
            f = bmh.faces.new((vh[i][j], vh[i][jn], vh[i + 1][jn], vh[i + 1][j]))
            f.material_index = mh
    S.noshadow.update(('ground_far', 'highlands'))


# ---------------------------------------------------------------- apron

def clip_poly(poly, circle_n=96, R=APRON_R):
    """Sutherland-Hodgman clip of a convex polygon against a regular circle_n-gon of radius R."""
    out = list(poly)
    edges = [(R * math.cos(2 * math.pi * i / circle_n), R * math.sin(2 * math.pi * i / circle_n)) for i in range(circle_n)]
    for i in range(circle_n):
        a, b = edges[i], edges[(i + 1) % circle_n]
        if not out:
            break
        inp, out = out, []

        def side(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0

        def inter(p, q):
            x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
            x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            if side(q):
                if not side(p):
                    out.append(inter(p, q))
                out.append(q)
            elif side(p):
                out.append(inter(p, q))
    return out


def apron(S):
    """Ø 48 m sintered-regolith pad (§6.2): 2 m hex tiles with 15 mm seams, clipped to the disc; graphite tie-down
    rings every 8 m (none inside any neutral zone); concrete collision strips, top Z 0."""
    k = S.kit('apron')
    a = 2.0 / math.sqrt(3)          # hex circumradius for 2 m across the flats
    g = 0.015
    rows = int(APRON_R / 1.5) + 2
    for j in range(-rows, rows + 1):
        for i in range(-rows, rows + 1):
            cx = i * 2.0 + (1.0 if j % 2 else 0.0)
            cy = j * 1.5 * a
            if math.hypot(cx, cy) > APRON_R + a:
                continue
            hexp = [(cx + (a - g / math.sqrt(3)) * math.cos(math.radians(30 + 60 * q)),
                     cy + (a - g / math.sqrt(3)) * math.sin(math.radians(30 + 60 * q))) for q in range(6)]
            poly = clip_poly(hexp)
            if len(poly) < 3:
                continue
            area = 0.5 * abs(sum(poly[q][0] * poly[(q + 1) % len(poly)][1] - poly[(q + 1) % len(poly)][0] * poly[q][1]
                                 for q in range(len(poly))))
            if area < 0.02:
                continue
            if S.lod <= 1:
                k.prism(poly, -0.06, 0.0, SINT, bt=0.006 if S.lod == 0 and len(poly) == 6 else 0.0, bseg=1)
    if S.lod >= 2:   # coarse LODs: the pad as one disc per quadrant (chunk-local islands)
        for qx in (-1, 1):
            for qy in (-1, 1):
                n = 12 if S.lod == 2 else 6
                arc = [(qx * APRON_R * math.cos(math.pi / 2 * i / n), qy * APRON_R * math.sin(math.pi / 2 * i / n))
                       for i in range(n + 1)]
                poly = [(0.0, 0.0)] + arc
                if qx * qy < 0:
                    poly = list(reversed(poly))
                k.prism(poly, -0.06, 0.0, SINT)
    # tie-down rings
    for gx in range(-3, 4):
        for gy in range(-3, 4):
            x, y = gx * 8.0, gy * 8.0
            if math.hypot(x, y) > APRON_R - 2.0 or in_any_zone(x, y, 1.0):
                continue
            S.kit('apron_tiedowns').torus(0.22, 0.035, GRAPH, S.seg(20, 8), 6, m=at(x, y, 0.0) @
                                          Matrix.Diagonal((1, 1, 0.5, 1)))
            S.kit('apron_tiedowns').cyl(0.12, -0.01, 0.004, GRAPH, S.seg(12, 6), m=at(x, y, 0))
    # collision: inscribed 4 m strips (concrete), top Z 0
    for y0 in range(-24, 24, 4):
        y1 = y0 + 4
        ym = max(abs(y0), abs(y1))
        if ym >= APRON_R:
            continue
        hx = math.sqrt(APRON_R ** 2 - ym ** 2)
        S.collider('apron', (-hx, y0, -0.5), (hx, y1, 0.0), 'concrete')


def in_any_zone(x, y, m=0.0):
    for p in PRESETS.values():
        (x0, y0), (x1, y1) = p['neutral']
        if x0 - m <= x <= x1 + m and y0 - m <= y <= y1 + m:
            return True
    return False


def shadow_hits_zone(x, y, h, r):
    """Would a prop of height h and radius r at (x, y) cast its sun shadow (§6.4) across any neutral zone?"""
    L = h / math.tan(math.radians(SUN_EL)) + r
    d = Vector((SUN_TRAVEL.x, SUN_TRAVEL.y)).normalized()
    for t in np.linspace(0.0, 1.0, 12):
        px, py = x + d.x * L * t, y + d.y * L * t
        if in_any_zone(px, py, r + 0.6):
            return True
    return False


# ---------------------------------------------------------------- landmarks

def lander(S, G, lights):
    """An original rounded toy lander (§6.3), 12 m tall: gold-foil quilted descent stage on four splayed legs with
    dish footpads, a graphite engine bell, a Bone cabin pod with a big glowing window, hatch, ladder and porch,
    RCS quads, two floodlights (the "Base lights" toggle), a dish and a whip antenna. Hulls: stage, bell, cabin,
    four legs, mast."""
    x, y, yaw = LANDER
    z0 = G.min_under(x, y, 3.0)
    M = place(x, y, z0, yaw)
    k = S.kit('lander')
    cs = max(1, S.cs(2))
    R8 = 2.9
    oct8 = [(R8 * math.cos(math.radians(22.5 + 45 * i)), R8 * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    zs0, zs1 = 2.4, 4.6
    k.prism(oct8, zs0, zs1, GRAPH, bt=0.08 if S.lod <= 1 else 0.0, bb=0.08 if S.lod <= 1 else 0.0, bseg=cs, m=M)
    # quilted foil panels on the eight faces
    for i in range(8):
        a0, a1 = math.radians(22.5 + 45 * i), math.radians(22.5 + 45 * (i + 1))
        am = (a0 + a1) / 2
        rf = R8 * math.cos(math.radians(22.5))
        w = 2 * R8 * math.sin(math.radians(22.5)) - 0.2
        F = M @ at(rf * math.cos(am), rf * math.sin(am), (zs0 + zs1) / 2) @ Matrix.Rotation(am - math.pi / 2, 4, 'Z') @ \
            Matrix.Rotation(math.radians(90), 4, 'X')
        if S.lod <= 1:
            for qy in (-0.5, 0.5):
                k.rbox((w, (zs1 - zs0) / 2 - 0.12, 0.2), (0, qy * ((zs1 - zs0) / 2), -0.02), 0.09, FOIL,
                       cseg=2 if S.lod == 0 else 1, m=F)
        else:
            k.hull(box_corners((-w / 2, -(zs1 - zs0) / 2 + 0.06, -0.1), (w / 2, (zs1 - zs0) / 2 - 0.06, 0.08)), FOIL, m=F)
    k.prism(oct8, zs1, zs1 + 0.18, BONE, bt=0.06 if S.lod <= 1 else 0.0, bseg=cs, m=M)
    S.hull_col('lander_stage', [tuple(M @ Vector((px, py, z))) for px, py in oct8 for z in (zs0, zs1 + 0.18)], 'powder')
    # engine bell
    bell = [(0.0, 1.15, GRAPH), (0.95, 1.15, GRAPH), (0.98, 1.3, GRAPH), (0.55, 2.2, GRAPH), (0.45, 2.42, GRAPH),
            (0.0, 2.42, GRAPH)]
    k.lathe(bell, S.seg(32, 8), m=M)
    S.hull_col('lander_bell', [tuple(M @ Vector((r * math.cos(t), r * math.sin(t), z))) for r, z in ((0.98, 1.15), (0.5, 2.42))
                               for t in np.linspace(0, 2 * math.pi, 10, endpoint=False)], 'steel')
    # legs: primary strut, two secondaries, knee, dish footpad
    for i in range(4):
        a = math.radians(45 + 90 * i)
        ca, sa = math.cos(a), math.sin(a)
        top = Vector((2.55 * ca, 2.55 * sa, 4.2))
        foot = Vector((6.0 * ca, 6.0 * sa, 0.32))
        knee = top.lerp(foot, 0.55)
        ra, rb = Vector((2.7 * math.cos(a + 0.35), 2.7 * math.sin(a + 0.35), 2.45)), \
            Vector((2.7 * math.cos(a - 0.35), 2.7 * math.sin(a - 0.35), 2.45))
        P = [tuple(M @ p) for p in (top, knee, foot)]
        S.sweep('lander_legs', P, 0.15, STEEL, sides=10)
        for s_ in (ra, rb):
            S.sweep('lander_legs', [tuple(M @ s_), tuple(M @ knee)], 0.07, STEEL, sides=8)
        S.sphere('lander_legs', tuple(M @ knee), 0.22, GRAPH, segs=14, rings=8)
        k.lathe([(0.0, 0.0, STEEL), (0.62, 0.0, STEEL), (0.75, 0.14, STEEL), (0.7, 0.2, STEEL), (0.25, 0.32, STEEL),
                 (0.0, 0.32, STEEL)], S.seg(24, 8), m=M @ at(foot.x, foot.y, 0.0))
        pts = []
        for p in (top, foot, ra, rb):
            for o in ((0.2, 0, 0), (-0.2, 0, 0), (0, 0.2, 0), (0, -0.2, 0), (0, 0, 0.2), (0, 0, -0.2)):
                pts.append(tuple(M @ (p + Vector(o))))
        for t in np.linspace(0, 2 * math.pi, 8, endpoint=False):
            pts.append(tuple(M @ Vector((foot.x + 0.75 * math.cos(t), foot.y + 0.75 * math.sin(t), 0.0))))
        S.hull_col('lander_leg', pts, 'steel')
    # cabin pod
    zc0 = zs1 + 0.18
    prof = [(0.0, zc0, BONE), (1.9, zc0, BONE), (2.25, zc0 + 0.5, BONE), (2.35, zc0 + 1.6, BONE), (2.2, zc0 + 2.6, BONE),
            (1.7, zc0 + 3.35, BONE), (0.9, zc0 + 3.75, BONE), (0.0, zc0 + 3.85, BONE)]
    if S.lod <= 1:   # smooth the pod profile
        sm = [prof[0]]
        for p_, q_ in zip(prof[1:-1], prof[2:]):
            sm.append(p_)
            sm.append(((p_[0] + q_[0]) / 2 * 1.02, (p_[1] + q_[1]) / 2, BONE))
        sm.append(prof[-1])
        prof = sm
    k.lathe(prof, S.seg(40, 10), m=M)
    S.hull_col('lander_cabin', [tuple(M @ Vector((r * math.cos(t), r * math.sin(t), z))) for r, z, _m in prof if r > 0
                                for t in np.linspace(0, 2 * math.pi, 8, endpoint=False)] +
               [tuple(M @ Vector((0, 0, prof[-1][1])))], 'powder')
    # front (local -Y): window, hatch, porch and ladder
    wz = zc0 + 2.1
    Wf = M @ at(0.0, -2.28, wz) @ Matrix.Rotation(math.radians(90), 4, 'X')
    k.cyl(0.78, -0.05, 0.14, GRAPH, S.seg(32, 10), bev=0.04 if S.lod <= 1 else 0.0, m=Wf)
    k.cyl(0.62, 0.12, 0.17, 'kn_env_window_glow', S.seg(32, 10), m=Wf)
    k.cyl(0.64, 0.17, 0.2, 'kn_poly_clear', S.seg(32, 10), m=Wf)
    if S.lod <= 1:
        Hf = M @ at(0.0, -2.2, zc0 + 0.75) @ Matrix.Rotation(math.radians(90), 4, 'X')
        k.prism(outline_rrect(1.1, 1.0, 0.25, 3 if S.lod == 0 else 1), 0.0, 0.16, GRAPH, bt=0.04, bseg=1, m=Hf)
        k.cyl(0.07, 0.16, 0.26, STEEL, 10, m=Hf @ at(0.35, 0.0, 0))
        S.text('lander_ink', 'KN-1', M @ H.wall_frame((-2.064, 0.0, zc0 + 2.85), (-1, 0, 0)), 0.26, GRAPH, FONT[0])
    bxp(S, 'lander', M, (-0.9, -3.6, zs1 - 0.06), (0.9, -2.6, zs1 + 0.06), GRAPH, r=0.03)   # porch
    for sxx in (-0.42, 0.42):
        S.sweep('lander_ladder', [tuple(M @ Vector((sxx, -3.5, zs1))), tuple(M @ Vector((sxx, -4.3, 0.35)))], 0.035, STEEL,
                sides=6)
    for t in np.linspace(0.12, 0.92, 9):
        p = Vector((0.0, -3.5, zs1)).lerp(Vector((0.0, -4.3, 0.35)), float(t))
        S.sweep('lander_ladder', [tuple(M @ Vector((-0.42, p.y, p.z))), tuple(M @ Vector((0.42, p.y, p.z)))], 0.025,
                STEEL, sides=6)
    S.hull_col('lander_ladder', [tuple(M @ Vector(v)) for v in ((-0.95, -2.6, zs1 + 0.06), (0.95, -2.6, zs1 + 0.06),
                                                                (-0.95, -3.6, zs1 + 0.06), (0.95, -3.6, zs1 + 0.06),
                                                                (-0.5, -4.35, 0.3), (0.5, -4.35, 0.3),
                                                                (-0.5, -2.6, zs1 - 0.1), (0.5, -2.6, zs1 - 0.1))],
               'steel')
    # RCS quads, floodlights, dish, whip antenna
    for i in range(4):
        a = math.radians(45 + 90 * i)
        p = Vector((2.3 * math.cos(a), 2.3 * math.sin(a), zc0 + 1.7))
        bxp(S, 'lander', M @ at(*p) @ Matrix.Rotation(a, 4, 'Z'), (-0.18, -0.25, -0.25), (0.25, 0.25, 0.25), GRAPH, r=0.05)
        if S.lod == 0:
            for o in ((0, 0, 0.32, 90), (0, 0, -0.32, -90)):
                k.cyl(0.06, 0.0, 0.14, STEEL, 8, m=M @ at(*p) @ Matrix.Rotation(a, 4, 'Z') @ at(0.05, 0, o[2]) @
                      Matrix.Rotation(math.radians(0 if o[2] > 0 else 180), 4, 'X'))
    for sgn in (-1, 1):
        # aimed forward and 20 deg down onto the apron (110 deg about X turns the lamp's +Z to (0, -0.94, -0.34))
        Fp = M @ at(sgn * 1.25, -1.9, zc0 + 3.15) @ Matrix.Rotation(math.radians(sgn * -20), 4, 'Z') @ \
            Matrix.Rotation(math.radians(110), 4, 'X')
        k.cyl(0.24, 0.0, 0.32, GRAPH, S.seg(16, 8), bev=0.04 if S.lod <= 1 else 0.0, m=Fp)
        S.kit('lander_flood_lens').cyl(0.19, 0.3, 0.34, 'kn_poly_clear', S.seg(16, 8), m=Fp)
        if S.lod == 0:
            p = Fp @ Vector((0, 0, 0.36))
            d = (Fp.to_3x3() @ Vector((0, 0, 1))).normalized()
            lights.append({'kind': 'flood', 'pos': tuple(p), 'dir': tuple(d), 'kelvin': 5000, 'lumens': 20000,
                           'shadowed': True, 'zone': 'lander', 'toggle': 'baseLights'})
    mz = zc0 + 3.8
    S.sweep('lander_mast', [tuple(M @ Vector((0.6, 0.6, mz - 0.3))), tuple(M @ Vector((0.6, 0.6, mz + 1.8)))], 0.06,
            STEEL, sides=8)
    S.sweep('lander_mast', [tuple(M @ Vector((-0.5, 0.4, mz - 0.2))), tuple(M @ Vector((-0.5, 0.4, 12.0)))], 0.02, STEEL,
            sides=5)
    De = earth_dir_local(M)
    D = M @ at(0.6, 0.6, mz + 1.8) @ De
    k.lathe([(0.0, 0.0, BONE), (0.45, 0.02, BONE), (0.85, 0.22, BONE), (0.8, 0.26, BONE), (0.42, 0.08, BONE),
             (0.0, 0.06, BONE)], S.seg(24, 8), m=D)
    S.sweep('lander_mast', [tuple(D @ Vector((0, 0, 0.06))), tuple(D @ Vector((0, 0, 0.55)))], 0.025, STEEL, sides=5)
    S.hull_col('lander_mast', [tuple(M @ Vector(v)) for v in ((0.45, 0.45, mz - 0.3), (0.75, 0.75, mz - 0.3),
                                                              (0.45, 0.75, mz + 2.7), (0.75, 0.45, mz + 2.7),
                                                              (-0.3, -0.3, mz + 2.2), (1.5, 1.5, mz + 2.2))], 'steel')


def earth_dir_local(M):
    """Rotation turning local +Z toward the Earth (a dish aimed at home), expressed in M's frame."""
    d = (M.to_3x3().inverted() @ TO_EARTH).normalized()
    return d.to_track_quat('Z', 'Y').to_matrix().to_4x4()


def bxp(S, piece, M, lo, hi, mat, r=0.0, cs=1):
    """Rounded box in a local frame M (no collider)."""
    k = S.kit(piece)
    lo, hi = Vector(lo), Vector(hi)
    size, c = hi - lo, (lo + hi) / 2
    rr = min(r, min(size) * 0.45)
    if S.lod >= 2 or rr < 0.001:
        k.hull(box_corners(lo, hi), mat, m=M)
    else:
        k.rbox(tuple(size), tuple(c), rr, mat, cseg=cs if S.lod == 0 else 1, m=M)


def dome(S, G, lights):
    """Habitat dome (§6.3), Ø 30 m, 15 m tall: faceted white panel segments over a graphite shell with seam ribs,
    a ring of glowing amber windows, a graphite base ring, an entrance tunnel toward the apron with a hazard-framed
    door, a cupola and a dish. Sphere collider (the hemisphere) + the base ring hull + the tunnel box."""
    cx, cy, R = DOME
    z0 = G.min_under(cx, cy, 2.0)
    k = S.kit('dome')
    ks = S.kit('dome_shell')
    ks.sphere(R - 0.15, GRAPH, S.seg(64, 12), S.seg(32, 6), m=at(cx, cy, z0), sz_bot=0.0)
    rows = (10, 7, 4, 3)[S.lod]
    el0 = math.asin(1.1 / R)
    win = []
    for rI in range(rows):
        e0 = el0 + (math.pi / 2 - el0) * rI / rows
        e1 = el0 + (math.pi / 2 - el0) * (rI + 1) / rows
        nseg = max(6, int(round(56 * math.cos((e0 + e1) / 2) * (1.0, 0.7, 0.45, 0.3)[S.lod])))
        for sI in range(nseg):
            a0 = 2 * math.pi * sI / nseg
            a1 = 2 * math.pi * (sI + 1) / nseg
            gap_a = 0.05 / (R * math.cos(e1) + 1e-6)
            gap_e = 0.05 / R
            corners = [(a0 + gap_a, e0 + gap_e), (a1 - gap_a, e0 + gap_e), (a1 - gap_a, e1 - gap_e), (a0 + gap_a, e1 - gap_e)]
            if rI == rows - 1:
                corners = [(a0 + gap_a, e0 + gap_e), (a1 - gap_a, e0 + gap_e), ((a0 + a1) / 2, math.pi / 2 - 0.02)]
            is_win = (S.lod <= 2 and rI == 1 and sI % 2 == 0)
            mat = 'kn_env_window_glow' if is_win else 'kn_env_panel_white'   # warm-lit amber glazing
            pts = []
            for a, e in corners:
                for rr in (R, R - 0.12):
                    pts.append((cx + rr * math.cos(e) * math.cos(a), cy + rr * math.cos(e) * math.sin(a), z0 + rr * math.sin(e)))
            k.hull(pts, mat)
            if is_win:
                win.append([(cx + (R - 0.13) * math.cos(e) * math.cos(a), cy + (R - 0.13) * math.cos(e) * math.sin(a),
                             z0 + (R - 0.13) * math.sin(e)) for a, e in corners])
    if S.lod == 0 and win:
        for i, quad in enumerate(win[::4]):
            c = sum((Vector(p) for p in quad), Vector()) / 4
            d = (c - Vector((cx, cy, z0))).normalized()
            lights.append({'kind': 'window', 'pos': tuple(c + d * 0.4), 'dir': tuple(d), 'kelvin': 3000, 'lumens': 1200,
                           'shadowed': False, 'zone': 'dome'})
    # seam ribs (LOD0/1)
    if S.lod <= 1:
        for rI in range(1, rows):
            e = el0 + (math.pi / 2 - el0) * rI / rows
            rr = (R + 0.02) * math.cos(e)
            S.kit('dome_ribs').torus(rr, 0.05, GRAPH, S.seg(96, 24), 4, m=at(cx, cy, z0 + (R + 0.02) * math.sin(e)))
    # base ring, entrance tunnel, cupola, dish
    kb = S.kit('dome_base')
    kb.cyl(R + 0.35, 0.0, 1.1, GRAPH, S.seg(72, 16), bev=0.12 if S.lod <= 1 else 0.0, m=at(cx, cy, z0))
    S.hull_col('dome_base', [(cx + (R + 0.35) * math.cos(t), cy + (R + 0.35) * math.sin(t), z0 + z)
                             for t in np.linspace(0, 2 * math.pi, 14, endpoint=False) for z in (0.0, 1.1)], 'powder')
    S.sphere_col('dome', (cx, cy, z0), R, 'powder')
    ty0, ty1, tr = cy - R + 1.0, cy - R - 5.5, 2.1
    Mt = at(cx, ty1, z0 + tr) @ Matrix.Rotation(math.radians(-90), 4, 'X')
    kb.cyl(tr, 0.0, ty0 - ty1, BONE, S.seg(32, 10), bev=0.0, m=Mt)
    for t in (0.4, 2.6, 4.8):
        kb.torus(tr + 0.02, 0.07, GRAPH, S.seg(32, 10), 4, m=at(cx, ty1 + t, z0 + tr) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    bx(S, 'dome_base', (cx - tr - 0.2, ty1, z0), (cx + tr + 0.2, ty0, z0 + 0.5), GRAPH, r=0.05)
    S.collider('dome_tunnel', (cx - tr - 0.2, ty1 - 0.4, z0), (cx + tr + 0.2, ty0, z0 + 2 * tr), 'powder')
    Md = at(cx, ty1 - 0.02, z0 + tr) @ Matrix.Rotation(math.radians(90), 4, 'X')
    k.cyl(tr + 0.12, 0.0, 0.3, GRAPH, S.seg(32, 10), bev=0.06 if S.lod <= 1 else 0.0, m=Md)
    if S.lod <= 1:
        for i in range(12):
            a0 = 2 * math.pi * i / 12
            S.kit('dome_hazard').lathe_arc([(tr - 0.05, 0.3, AMBER if i % 2 else GRAPH), (tr + 0.1, 0.3, AMBER if i % 2 else GRAPH),
                                            (tr + 0.1, 0.33, AMBER if i % 2 else GRAPH), (tr - 0.05, 0.33, AMBER if i % 2 else GRAPH)],
                                           a0, a0 + 2 * math.pi / 12, 3, m=Md)
    k.prism(outline_rrect(1.5, 2.3, 0.4, 3 if S.lod == 0 else 1), 0.2, 0.34, GRAPH, bt=0.03, bseg=1, m=Md @ at(0, -0.65, 0))
    k.cyl(0.25, 0.34, 0.38, 'kn_env_window_glow', 16, m=Md @ at(0, -0.1, 0))
    kb.cyl(1.4, R - 0.3, R + 1.1, BONE, S.seg(24, 8), bev=0.15 if S.lod <= 1 else 0.0, m=at(cx, cy, z0))
    kb.sphere(1.25, 'kn_poly_amber', S.seg(24, 8), S.seg(12, 4), m=at(cx, cy, z0 + R + 1.1), sz_bot=0.0)
    De = at(cx + 9.0, cy - 6.0, z0 + 10.0) @ earth_dir_local(Matrix.Identity(4))
    kb.lathe([(0.0, 0.0, BONE), (0.6, 0.03, BONE), (1.2, 0.32, BONE), (1.14, 0.37, BONE), (0.55, 0.12, BONE),
              (0.0, 0.1, BONE)], S.seg(24, 8), m=De)
    S.sweep('dome_base', [(cx + 9.0, cy - 6.0, z0 + 10.0), tuple(De @ Vector((0, 0, -0.9)))], 0.08, STEEL, sides=6)


def rover(S, G):
    """Rover (§6.3): Bone body, Ignition fenders, six grip tyres with chevron treads and spoked steel hubs (the
    mesh-wheel look in geometry), seats, console, a camera mast and dish, a cargo crate and a lunchbox."""
    x, y, yaw = ROVER
    z0 = G.min_under(x, y, 2.5)
    M = place(x, y, z0, yaw)
    k = S.kit('rover')
    wr, ww = 0.5, 0.38
    body_z = 0.72
    bxp(S, 'rover', M, (-1.05, -2.0, body_z), (1.05, 2.0, body_z + 0.42), BONE, r=0.12, cs=2)
    bxp(S, 'rover', M, (-0.95, -2.15, body_z + 0.3), (0.95, -1.55, body_z + 1.05), BONE, r=0.12, cs=2)   # console
    bxp(S, 'rover', M, (-0.8, -2.16, body_z + 0.62), (0.8, -2.1, body_z + 0.95), 'kn_screen', r=0.0)
    for sx in (-0.45, 0.45):    # seats
        bxp(S, 'rover_seats', M, (sx - 0.32, -1.25, body_z + 0.42), (sx + 0.32, -0.6, body_z + 0.62), GRAPH, r=0.08, cs=2)
        bxp(S, 'rover_seats', M, (sx - 0.32, -0.62, body_z + 0.42), (sx + 0.32, -0.48, body_z + 1.2), GRAPH, r=0.06, cs=2)
    bxp(S, 'rover', M, (-0.95, 0.3, body_z + 0.42), (0.95, 1.95, body_z + 0.72), GRAPH, r=0.06)   # cargo tray
    bxp(S, 'rover_cargo', M, (-0.55, 0.65, body_z + 0.72), (0.4, 1.5, body_z + 1.32), BONE, r=0.05)
    if S.lod <= 1:
        S.text('rover_ink', 'KN', M @ at(-0.075, 0.645, body_z + 1.02) @ Matrix.Rotation(math.radians(90), 4, 'X') @
               Matrix.Rotation(math.radians(180), 4, 'Y'), 0.24, GRAPH, FONT[0])
    S.prop('lunchbox', 0, 0, 0, M=M @ place(0.45, -0.95, body_z + 0.62, 80), col=False, piece='rover_props')
    # mast + camera + dish
    S.sweep('rover_mast', [tuple(M @ Vector((0.75, -1.4, body_z + 0.42))), tuple(M @ Vector((0.75, -1.4, body_z + 2.2)))],
            0.045, STEEL, sides=8)
    bxp(S, 'rover', M, (0.55, -1.6, body_z + 2.2), (0.95, -1.2, body_z + 2.5), GRAPH, r=0.06, cs=2)
    k.cyl(0.08, 0.0, 0.06, 'kn_poly_beam', 12, m=M @ at(0.75, -1.6, body_z + 2.35) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    S.sweep('rover_mast', [tuple(M @ Vector((-0.7, 1.75, body_z + 0.72))), tuple(M @ Vector((-0.7, 1.75, body_z + 1.9)))],
            0.03, STEEL, sides=6)
    Dm = M @ at(-0.7, 1.75, body_z + 1.9) @ earth_dir_local(M)
    k.lathe([(0.0, 0.0, BONE), (0.25, 0.01, BONE), (0.5, 0.14, BONE), (0.47, 0.17, BONE), (0.22, 0.05, BONE),
             (0.0, 0.04, BONE)], S.seg(20, 8), m=Dm)
    # wheels
    for wx in (-1.32, 1.32):
        for wy in (-1.45, 0.0, 1.45):
            W = M @ at(wx, wy, wr) @ Matrix.Rotation(math.radians(90), 4, 'Y')
            tyre = [(wr - 0.18, -ww / 2, 'kn_rubber_grip'), (wr - 0.05, -ww / 2, 'kn_rubber_grip'),
                    (wr, -ww / 2 + 0.06, 'kn_rubber_grip'), (wr, ww / 2 - 0.06, 'kn_rubber_grip'),
                    (wr - 0.05, ww / 2, 'kn_rubber_grip'), (wr - 0.18, ww / 2, 'kn_rubber_grip')]
            S.kit('rover_wheels').lathe(tyre, S.seg(32, 10), m=W, closed=True)
            if S.lod == 0:
                for t in range(16):
                    a = 2 * math.pi * t / 16
                    Mt = W @ Matrix.Rotation(a, 4, 'Z') @ at(wr + 0.015, 0, 0)
                    for side in (-1, 1):
                        S.kit('rover_wheels').hull(box_corners((-0.025, -0.05, 0.0), (0.025, 0.05, side * ww / 2 * 0.9)),
                                                   'kn_rubber_grip', m=Mt @ Matrix.Rotation(math.radians(side * 25), 4, 'X'))
            kh = S.kit('rover_hubs')
            kh.cyl(wr - 0.2, -ww / 2 + 0.06, ww / 2 - 0.06, STEEL, S.seg(20, 8), m=W) if S.lod >= 2 else None
            if S.lod <= 1:
                kh.cyl(0.12, -ww / 2 - 0.02, ww / 2 + 0.02, STEEL, S.seg(16, 8), bev=0.03, m=W)
                kh.torus(wr - 0.19, 0.03, STEEL, S.seg(32, 10), 6, m=W)
                for t in range(6):
                    a = 2 * math.pi * t / 6
                    Ms = W @ Matrix.Rotation(a, 4, 'Z')
                    kh.hull(box_corners((0.1, -0.025, -0.04), (wr - 0.19, 0.025, 0.04)), STEEL, m=Ms)
            Fm = W @ Matrix.Rotation(math.radians(90 if wx > 0 else 90), 4, 'Z')
            S.kit('rover_fenders').lathe_arc([(wr + 0.06, -ww / 2 - 0.04, IGN), (wr + 0.12, -ww / 2 - 0.04, IGN),
                                              (wr + 0.12, ww / 2 + 0.04, IGN), (wr + 0.06, ww / 2 + 0.04, IGN)],
                                             math.radians(10), math.radians(170), S.seg(12, 4), m=Fm)
            S.hull_col('rover_wheel', [tuple(W @ Vector((wr * math.cos(t), wr * math.sin(t), z)))
                                       for t in np.linspace(0, 2 * math.pi, 10, endpoint=False) for z in (-ww / 2, ww / 2)],
                       'rubber')
            S.sweep('rover_axles', [tuple(M @ Vector((wx * 0.78, wy, wr))), tuple(M @ Vector((wx, wy, wr)))], 0.05, GRAPH,
                    sides=8)
    for lo, hi in (((-1.05, -2.0, body_z), (1.05, 2.0, body_z + 0.42)), ((-0.95, -2.15, body_z + 0.3), (0.95, -1.55, body_z + 1.05)),
                   ((-0.95, 0.3, body_z + 0.42), (0.95, 1.95, body_z + 1.32))):
        pts = [M @ Vector(p) for p in box_corners(lo, hi)]
        S.collider('rover', tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)),
                   'powder')


def solar_array(S, G, x, y, i):
    """Solar array (§6.3): steel post and yoke, a 6 x 3 m panel of Cobalt cells in a steel frame, tilted to face the
    low sun (72 deg, toward the front-left). Post box + panel hull."""
    z0 = G.min_under(x, y, 1.0)
    k = S.kit('solar_arrays')
    post_h = 3.1
    k.cyl(0.22, 0.0, post_h, STEEL, S.seg(16, 8), bev=0.04 if S.lod <= 1 else 0.0, m=at(x, y, z0))
    k.cyl(0.55, 0.0, 0.25, GRAPH, S.seg(16, 8), bev=0.05 if S.lod <= 1 else 0.0, m=at(x, y, z0))
    S.collider('solar_post', (x - 0.55, y - 0.55, z0), (x + 0.55, y + 0.55, z0 + post_h), 'steel')
    az = math.atan2(-SUN_TRAVEL.x, -SUN_TRAVEL.y)          # toward the sun, from +Y toward +X
    tilt = math.radians(72.0)
    P = at(x, y, z0 + post_h + 0.25) @ Matrix.Rotation(-az, 4, 'Z') @ Matrix.Rotation(-tilt, 4, 'X')
    bxp(S, 'solar_arrays', at(x, y, z0 + post_h) @ Matrix.Rotation(-az, 4, 'Z'), (-0.6, -0.25, -0.1), (0.6, 0.25, 0.35),
        GRAPH, r=0.06)
    w, h = 6.0, 3.0
    # ART (beta polish, D128): 6 x 3 cell modules (1 m) with 8 cm gaps over a backplate 7 cm behind, instead of E5c's
    # 12 x 6 cells with 3 cm gaps. The engine draws env LOD0 at every distance with no mips on geometry, and 3 cm gaps
    # (under half a pixel at 40-80 m, 1080p) shimmered against the bright silver backplate; 8 cm gaps are 1.3-2.5 px
    # there, there are 7 lines instead of 16, and the backplate is a mid blue-grey (kn_env_solar_grid) rather than
    # brushed steel, so the lines have far less contrast (measured in engine: frame-to-frame change on the panels under
    # sub-pixel camera moves -37 %, -54 % on the farthest). Still no near-coplanar faces (z-fighting, E5c 10c).
    m = 0.07
    bxp(S, 'solar_arrays', P, (-w / 2, -h / 2, -0.09), (w / 2, h / 2, -0.04), 'kn_env_solar_grid', r=0.02)
    for lo, hi in (((-w / 2, -h / 2), (w / 2, -h / 2 + m)), ((-w / 2, h / 2 - m), (w / 2, h / 2)),
                   ((-w / 2, -h / 2 + m), (-w / 2 + m, h / 2 - m)), ((w / 2 - m, -h / 2 + m), (w / 2, h / 2 - m))):
        bxp(S, 'solar_arrays', P, (lo[0], lo[1], -0.09), (hi[0], hi[1], 0.045), STEEL, r=0.015)
    nx_, ny_ = (6, 3) if S.lod <= 1 else (1, 1)
    gap = 0.08 if S.lod <= 1 else 0.0
    cw, ch = (w - 2 * m) / nx_, (h - 2 * m) / ny_
    for a in range(nx_):
        for b in range(ny_):
            u0, v0 = -w / 2 + m + a * cw, -h / 2 + m + b * ch
            # the outer gaps against the frame are half width, so all the visible lines read alike
            ga0, ga1 = (gap / 2 if a else 0.0), (gap / 2 if a < nx_ - 1 else 0.0)
            gb0, gb1 = (gap / 2 if b else 0.0), (gap / 2 if b < ny_ - 1 else 0.0)
            bxp(S, 'solar_cells', P, (u0 + ga0, v0 + gb0, -0.01), (u0 + cw - ga1, v0 + ch - gb1, 0.03),
                'kn_env_solar_cell')
    S.hull_col('solar_panel', [tuple(P @ Vector(p)) for p in box_corners((-w / 2, -h / 2, -0.09), (w / 2, h / 2, 0.045))],
               'glass')
    _ = i


def antenna(S, G, lights):
    """Antenna mast (§6.3), 25 m: a Bone triangular lattice tapering up, a dish aimed at Earth, an amber beacon with
    a `kn_led` lens the renderer blinks at 0.5 Hz. Hull collider over the tower."""
    x, y, h = ANTENNA
    z0 = G.min_under(x, y, 2.0)
    base, top = 1.9, 0.6
    legs = []
    for i in range(3):
        a = math.radians(90 + 120 * i)
        legs.append(((x + base * math.cos(a), y + base * math.sin(a), z0), (x + top * math.cos(a), y + top * math.sin(a), z0 + h)))
    for b, t in legs:
        S.sweep('antenna', [b, t], 0.09, BONE, sides=8)
        S.kit('antenna').cyl(0.3, 0.0, 0.3, GRAPH, 12, m=at(b[0], b[1], z0))
    n = 10 if S.lod <= 1 else 4
    for j in range(n):
        t0, t1 = j / n, (j + 1) / n
        for i in range(3):
            p0 = Vector(legs[i][0]).lerp(Vector(legs[i][1]), t0)
            p1 = Vector(legs[(i + 1) % 3][0]).lerp(Vector(legs[(i + 1) % 3][1]), t1)
            q0 = Vector(legs[(i + 1) % 3][0]).lerp(Vector(legs[(i + 1) % 3][1]), t0)
            S.sweep('antenna', [tuple(p0), tuple(p1)], 0.04, BONE, sides=6)
            S.sweep('antenna', [tuple(p0), tuple(q0)], 0.04, BONE, sides=6)
    S.kit('antenna').cyl(1.0, 0.0, 0.15, GRAPH, 16, bev=0.03 if S.lod <= 1 else 0.0, m=at(x, y, z0 + h))
    D = at(x, y + 0.8, z0 + h - 2.5) @ earth_dir_local(Matrix.Identity(4))
    S.kit('antenna').lathe([(0.0, 0.0, BONE), (0.8, 0.04, BONE), (1.7, 0.5, BONE), (1.62, 0.56, BONE), (0.75, 0.17, BONE),
                            (0.0, 0.14, BONE)], S.seg(32, 10), m=D)
    S.sweep('antenna', [tuple(D @ Vector((0, 0, 0.14))), tuple(D @ Vector((0, 0, 1.2)))], 0.03, STEEL, sides=5)
    S.kit('antenna').cyl(0.2, 0.15, 0.55, AMBER, 12, bev=0.04 if S.lod <= 1 else 0.0, m=at(x, y, z0 + h))
    S.kit('antenna_beacon').sphere(0.17, 'kn_env_sconce', S.seg(16, 8), S.seg(8, 4), m=at(x, y, z0 + h + 0.66))
    S.hull_col('antenna', [b for b, _t in legs] + [t for _b, t in legs] + [(x, y, z0 + h + 0.85)], 'powder')
    if S.lod == 0:
        lights.append({'kind': 'beacon', 'pos': (x, y, z0 + h + 0.66), 'dir': (0.0, 0.0, 1.0), 'kelvin': 2200,
                       'lumens': 600, 'shadowed': False, 'zone': 'antenna', 'blinkHz': 0.5})


def crates(S, G):
    """Supply crates in three sizes (Bone / Graphite, KN SUPPLY stencils) by the dome entrance and the lander."""
    rng = random.Random(23)
    spots = [(-5.5, 23.5, 0), (-4.3, 22.6, 1), (-5.1, 22.4, 2), (5.6, 24.0, 1), (6.6, 23.2, 0), (-15.5, 20.5, 2),
             (-16.4, 19.2, 1), (-28.5, 14.0, 0), (-29.2, 15.2, 2)]
    sizes = ((0.6, 0.6, 0.5), (0.9, 0.9, 0.7), (1.3, 1.0, 0.9))
    stacked = {}
    for i, (x, y, s) in enumerate(spots):
        w, d, h = sizes[s]
        yaw = rng.uniform(-25, 25)
        z0 = G.min_under(x, y, max(w, d) / 2)
        key = (round(x), round(y))
        M = place(x, y, z0, yaw)
        mat = BONE if i % 3 else GRAPH
        bxp(S, 'crates', M, (-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), mat, r=0.04, cs=2)
        if S.lod <= 1:
            for zz in (0.12, h - 0.12):
                bxp(S, 'crates_bands', M, (-w / 2 - 0.012, -d / 2 - 0.012, zz - 0.035), (w / 2 + 0.012, d / 2 + 0.012, zz + 0.035),
                    GRAPH if mat == BONE else AMBER)
            if s > 0:
                S.text('crates_ink', 'KN SUPPLY', M @ at(0, -d / 2 - 0.013, h / 2) @ Matrix.Rotation(math.radians(90), 4, 'X'),
                       0.09 * (1 + s * 0.3), AMBER if mat == GRAPH else GRAPH, FONT[0])
        pts = [M @ Vector(p) for p in box_corners((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h))]
        S.collider('crate', tuple(min(p[q] for p in pts) for q in range(3)), tuple(max(p[q] for p in pts) for q in range(3)),
                   'powder')
        stacked[key] = h
    _ = stacked


def pennant(S, G):
    """The KNOCK-ON lab pennant (no national flags, §6.3): a graphite pole and a stiffened Ignition pennant with a
    Bone stripe and lettering (no wind on the Moon)."""
    x, y = PENNANT
    z0 = G.min_under(x, y, 0.3)
    k = S.kit('pennant')
    k.cyl(0.045, 0.0, 3.2, GRAPH, S.seg(12, 6), bev=0.02 if S.lod <= 1 else 0.0, m=at(x, y, z0))
    k.cyl(0.25, 0.0, 0.08, GRAPH, S.seg(16, 6), bev=0.02 if S.lod <= 1 else 0.0, m=at(x, y, z0))
    k.sphere(0.07, AMBER, 12, 6, m=at(x, y, z0 + 3.25))
    F = at(x + 0.04, y, z0 + 3.1) @ Matrix.Rotation(math.radians(90), 4, 'X')
    k.prism([(0.0, 0.0), (0.0, -0.9), (1.6, -0.45)], -0.012, 0.012, IGN, m=F)
    k.prism([(0.0, -0.58), (1.15, -0.5), (1.15, -0.4), (0.0, -0.32)], -0.016, 0.016, BONE, m=F)
    S.text('pennant_ink', 'KNOCK-ON', F @ at(0.5, -0.2, 0.013), 0.1, GRAPH, FONT[0])
    S.text('pennant_ink', 'KNOCK-ON', F @ Matrix.Rotation(math.radians(180), 4, 'Y') @ at(-0.5, -0.2, 0.013), 0.1, GRAPH,
           FONT[0])
    S.collider('pennant_pole', (x - 0.045, y - 0.045, z0), (x + 0.045, y + 0.045, z0 + 3.2), 'steel')
    S.collider('pennant_base', (x - 0.25, y - 0.25, z0), (x + 0.25, y + 0.25, z0 + 0.08), 'steel')


# ---------------------------------------------------------------- boulders, small craters, tracks

BOULDER_SIZES = (0.4, 1.2, 3.0)


def boulder_kit(k, shape, size, M, lod):
    """One of four boulder shapes (§6.2): a lumpy, flattened-bottom rock (bevelled toy facets, not photoreal) with a
    regolith dust top (faces looking up)."""
    segs, rings = ((14, 8), (10, 6), (7, 4), (5, 3))[lod]
    n0 = len(k.bm.faces)
    v0 = len(k.bm.verts)
    k.sphere(size / 2, ROCK, segs, rings)
    k.bm.verts.ensure_lookup_table()
    rnd = random.Random(1000 + shape * 17)
    lumps = [(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 1))).normalized(), rnd.uniform(0.08, 0.22))
             for _ in range(5)]
    sq = (0.62, 0.78, 0.55, 0.7)[shape]
    stretch = (1.0, 1.25, 1.1, 0.9)[shape]
    for v in list(k.bm.verts)[v0:]:
        d = v.co.normalized() if v.co.length > 1e-9 else Vector((0, 0, 1))
        f = 1.0 + sum(a * max(0.0, d.dot(c)) ** 3 for c, a in lumps)
        co = v.co * f
        co.x *= stretch
        co.z = co.z * sq if co.z > 0 else co.z * 0.35
        v.co = co
    k.bm.faces.ensure_lookup_table()
    di = k.mi(REG)
    for f in list(k.bm.faces)[n0:]:
        f.normal_update()
        if f.normal.z > 0.62:
            f.material_index = di
    bmesh.ops.transform(k.bm, matrix=M, verts=list(k.bm.verts)[v0:])


def scatter_boulders(G, count, rmin, rmax, seed, sizes_w, avoid_field=False):
    rng = random.Random(seed)
    out = []
    tries = 0
    while len(out) < count and tries < count * 60:
        tries += 1
        r = rmin + (rmax - rmin) * math.sqrt(rng.random())
        a = rng.uniform(0, 2 * math.pi)
        x, y = r * math.cos(a), r * math.sin(a)
        if avoid_field and abs(x) < 130 and abs(y) < 130:
            continue
        si = rng.choices(range(3), weights=sizes_w)[0]
        s = BOULDER_SIZES[si] * rng.uniform(0.8, 1.2)
        if not avoid_field:
            if abs(x) > 127 or abs(y) > 127:
                continue
            if math.hypot(x, y) < APRON_R + 3 or in_any_zone(x, y, s + 1.0):
                continue
            if any(math.hypot(x - px, y - py) < rf + rb + s for px, py, rf, rb in PADS):
                continue
            if shadow_hits_zone(x, y, s * 0.7, s * 0.6):
                continue
            if near_tracks(x, y, s + 0.8):
                continue
        out.append((x, y, si, s, rng.randrange(4), rng.uniform(0, 360)))
    return out


TRACKS = [[(20.0, 6.0), (24.0, 13.0), (30.0, 20.0), (38.0, 28.0), (45.0, 34.0)],
          [(20.0, 6.0), (21.5, 15.0), (14.0, 21.0), (2.0, 24.5), (-10.0, 24.0), (-17.5, 21.0)],
          [(-17.5, 21.0), (-20.0, 28.0), (-30.0, 38.0), (-44.0, 48.0), (-56.0, 56.0)]]


def near_tracks(x, y, m):
    for path in TRACKS:
        for (ax, ay), (bx_, by) in zip(path, path[1:]):
            vx, vy = bx_ - ax, by - ay
            t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
            if math.hypot(x - (ax + t * vx), y - (ay + t * vy)) < m:
                return True
    return False


def boulders(S, G, placed):
    """The baked boulders (the 4 GB count, 400): sit 15 % into the ground; 1.2 / 3 m ones get hull colliders, 0.4 m
    ones a sphere."""
    k = S.kit('boulders')
    for x, y, si, s, shape, yaw in placed:
        g = G.min_under(x, y, s * 0.4)
        M = place(x, y, g + s * 0.06, yaw)      # the flattened bottom sits ~12 % of the size into the ground
        boulder_kit(k, shape, s, M, S.lod if si > 0 else min(3, S.lod + 1))
        if S.lod == 0:
            if si == 0:
                S.sphere_col('boulder_s', (x, y, g + s * 0.12), s * 0.3, 'regolith')
            else:
                tmp = Kit()
                boulder_kit(tmp, shape, s, M, 3)
                S.hull_col('boulder', [tuple(v.co) for v in tmp.bm.verts], 'regolith')
                tmp.free()


def small_craters(S, G):
    """Small craters (Ø 1-4 m): a low rim ring and a darker floor disc, visual only (≤ 4 cm), never in a neutral zone,
    on the apron, a pad or a track."""
    rng = random.Random(31)
    k = S.kit('craters_small')
    n = 0
    tries = 0
    while n < 90 and tries < 5000:
        tries += 1
        x, y = rng.uniform(-125, 125), rng.uniform(-125, 125)
        D = rng.uniform(1.0, 4.0)
        if math.hypot(x, y) < APRON_R + 2 or in_any_zone(x, y, D) or near_tracks(x, y, D) or \
                any(math.hypot(x - px, y - py) < rf + rb + D for px, py, rf, rb in PADS):
            continue
        z = G.min_under(x, y, D / 2)
        r = D / 2
        if S.lod <= 2:
            k.lathe([(r * 0.7, -0.03, REG), (r * 1.25, -0.03, REG), (r * 1.15, 0.015, REG), (r * 1.0, 0.04, REG),
                     (r * 0.82, 0.02, REG)], S.seg(20, 8), m=at(x, y, z), closed=True)
            k.cyl(r * 0.86, -0.03, 0.006, DARK, S.seg(20, 8), m=at(x, y, z))
        n += 1


def tracks(S, G):
    """Rover tracks (two dark tread strips with chevrons, 1.6 m apart) along the drive paths, and boot prints from
    the lander ladder toward the dome; 3 mm proud, visual only."""
    if S.lod >= 2:
        return
    k = S.kit('tracks')
    for path in TRACKS:
        pts = []
        for (ax, ay), (bx_, by) in zip(path, path[1:]):
            L = math.hypot(bx_ - ax, by - ay)
            n = max(2, int(L / 0.8))
            for i in range(n):
                t = i / n
                pts.append((ax + (bx_ - ax) * t, ay + (by - ay) * t))
        pts.append(path[-1])
        for side in (-0.8, 0.8):
            for i in range(len(pts) - 1):
                (ax, ay), (bx_, by) = pts[i], pts[i + 1]
                d = Vector((bx_ - ax, by - ay))
                if d.length < 1e-6:
                    continue
                d.normalize()
                nrm = Vector((-d.y, d.x))
                c0 = Vector((ax, ay)) + nrm * side
                c1 = Vector((bx_, by)) + nrm * side
                za, zb = G.at(c0.x, c0.y), G.at(c1.x, c1.y)
                if S.lod == 0:   # chevron tread marks
                    for q in range(2):
                        p = c0.lerp(c1, 0.25 + 0.5 * q)
                        z = (za + zb) / 2
                        quad = [p + nrm * 0.17 - d * 0.05, p + d * 0.08, p - nrm * 0.17 - d * 0.05, p - d * 0.02]
                        k.hull([(v.x, v.y, z + zz) for v in quad for zz in (-0.004, 0.003)], DARK)
                quad = [c0 + nrm * 0.15, c1 + nrm * 0.15, c1 - nrm * 0.15, c0 - nrm * 0.15]
                zs = (za, zb, zb, za)
                k.hull([(v.x, v.y, z + zz) for v, z in zip(quad, zs) for zz in (-0.004, 0.0015)], DARK)
    # boot prints: lander ladder -> the dome tunnel
    rng = random.Random(8)
    lx, ly, _ = LANDER
    a = Vector((lx + 1.0, ly - 4.3))
    b = Vector((DOME[0] - 1.0, DOME[1] - DOME[2] - 6.2))
    n = int((b - a).length / 0.75)
    for i in range(n):
        p = a.lerp(b, i / n) + Vector((math.sin(i * 0.4) * 0.6, 0))
        if in_any_zone(p.x, p.y, 0.5):
            continue
        d = (b - a).normalized()
        nrm = Vector((-d.y, d.x))
        q = p + nrm * (0.14 if i % 2 else -0.14)
        z = G.at(q.x, q.y)
        rot = math.atan2(d.y, d.x)
        M = at(q.x, q.y, z) @ Matrix.Rotation(rot + rng.uniform(-0.15, 0.15), 4, 'Z')
        k.hull([tuple(M @ Vector((ex * 0.15, ey * 0.065, zz))) for ex, ey in
                ((1, 0), (0.7, 0.7), (0, 1), (-0.7, 0.8), (-1, 0), (-0.7, -0.8), (0, -1), (0.7, -0.7))
                for zz in (-0.004, 0.002)], DARK)


# ---------------------------------------------------------------- backdrop sky

def backdrop_sky(S):
    """Earth low on the horizon (§6.1: elevation 12 deg, azimuth 25 deg right of the default view, apparent Ø 2 deg)
    and a sparse star field. Black sky."""
    c = TO_EARTH * EARTH_D
    R = EARTH_D * math.tan(math.radians(EARTH_DIAM / 2))
    to_eye = (Vector((0, 0, 1.7)) - c).normalized()
    S.keepnormals.add('earth')
    H.earth_uv_sphere(S.kit('earth', 'backdrop'), c, R, to_eye, n_lon=96, n_lat=48)   # the baked, lit Earth (earth_moon)
    eye = Vector((0, 0, 1.7))
    to = (eye - c).normalized()
    D = (eye - c).length
    r_sil = R * math.sqrt(max(0.0, 1.0 - (R / D) ** 2))
    rot = to.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    S.kit('earth_glow', 'backdrop').ring_sweep(
        outline_circle(r_sil * 1.002, 96), [(0.0, -1.0), (r_sil * 0.02, -1.0), (r_sil * 0.02, 1.0), (0.0, 1.0)],
        'kn_env_atmosphere', m=at(*(c + to * (R * R / D))) @ rot)
    rng = random.Random(9)
    ks = S.kit('stars', 'backdrop')
    Ds = 1950.0
    for _ in range(450):
        while True:
            v = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
            if v.length > 1e-6:
                v.normalize()
                if v.z > 0.06:
                    break
        p = v * Ds
        s = Ds * math.tan(math.radians(rng.uniform(0.008, 0.02)))   # pin-points: the sky stays black (bloom grows them)
        ks.hull([p + Vector(o) * s for o in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))],
                'kn_env_star')
    S.noshadow.update(('earth', 'earth_glow', 'stars'))
    return c, R


# ---------------------------------------------------------------- build

FONT = [None]


def build(lod, G, placed):
    S = SpaceSet(lod)
    lights = []
    terrain_piece(S, G)
    apron(S)
    lander(S, G, lights)
    dome(S, G, lights)
    rover(S, G)
    for i, (x, y) in enumerate(ARRAYS):
        solar_array(S, G, x, y, i)
    antenna(S, G, lights)
    crates(S, G)
    pennant(S, G)
    boulders(S, G, placed)
    small_craters(S, G)
    tracks(S, G)
    for preset, p in PRESETS.items():
        H.scale_ref(S, preset, *p['scale_ref'])
    if lod == 0:
        backdrop_terrain(S, G)
        S.earth = backdrop_sky(S)
    S.lights = lights
    return S


# ---------------------------------------------------------------- data

def preset_data(preset, S0, ibl, terr, ec, er):
    p = PRESETS[preset]
    half, Hh = p['half'], p['H']
    (nx0, ny0), (nx1, ny1) = p['neutral']
    boxes = []
    for b in S0.boxes:
        if b['preset'] not in (None, preset):
            continue
        c, h = eng_box(b['lo'], b['hi'])
        boxes.append({'name': b['name'], 'center': c, 'half': h, 'phys': b['phys']})
    spheres = [{'name': s['name'], 'center': eng(s['c']), 'radius': round(s['r'], 4), 'phys': s['phys']}
               for s in S0.spheres if s['preset'] in (None, preset)]
    hulls = []
    for hh in S0.hulls:
        pts = [eng(q) for q in hh['pts']]
        hulls.append({'name': hh['name'], 'points': pts,
                      'aabb': {'min': [round(min(q[i] for q in pts), 4) for i in range(3)],
                               'max': [round(max(q[i] for q in pts), 4) for i in range(3)]}, 'phys': hh['phys']})
    cams = {'default': {'pos': eng(Vector(p['camera'])), 'target': eng(Vector(p['target'])), 'fovYDeg': 40.0}}
    for name, c in CAMERAS.items():
        cams[name] = {'pos': eng(Vector(c['pos'])), 'target': eng(Vector(c['target'])), 'fovYDeg': H.lens_fov(c['lens']),
                      'focusM': c['focus'], 'fStop': c['fstop']}
    practicals = []
    for q in S0.lights:
        outer, inner = (40.0, 25.0) if q['kind'] == 'flood' else (85.0, 60.0)
        sr = 2 * math.pi * (1 - math.cos(math.radians(outer)))
        e = {'kind': q['kind'], 'pos': eng(Vector(q['pos'])), 'dir': eng_dir(Vector(q['dir'])), 'kelvin': q['kelvin'],
             'color': H.kelvin_rgb(q['kelvin']), 'lumens': q['lumens'], 'candela': round(q['lumens'] / sr, 1),
             'innerConeDeg': inner, 'outerConeDeg': outer, 'rangeM': 40.0 if q['kind'] == 'flood' else 8.0,
             'shadowed': q['shadowed'], 'zone': q['zone']}
        cd = q['lumens'] / sr
        boost = {'window': 10.0, 'beacon': 10.0}.get(q['kind'], 1.0)   # stylised: warm pools read in the shade
        e['bulbRadiusM'] = 0.19 if q['kind'] == 'flood' else 0.12
        e['cyclesWatts'] = round(4 * math.pi * cd * 9.0 / 120000.0 * boost, 3)
        if 'toggle' in q:
            e['toggle'] = q['toggle']
        if 'blinkHz' in q:
            e['blinkHz'] = q['blinkHz']
        practicals.append(e)
    practicals.sort(key=lambda e: (e['kind'] != 'flood', e['kind']))     # the shadowed floods first
    emit = [('amb_moon_dome_hum', (DOME[0], DOME[1], 2.0)), ('amb_moon_beacon', (ANTENNA[0], ANTENNA[1], ANTENNA[2]))]
    gh = max(16.0, Hh / 2)
    return {
        'glb': 'env/moon/moon.glb',
        'origin': [0, 0, 0],
        'bounds': eng_minmax((-half, -half, 0.0), (half, half, Hh)),
        'neutral': eng_minmax((nx0, ny0, 0.0), (nx1, ny1, 0.0)),
        'camera': cams['default']['pos'], 'target': cams['default']['target'],
        'cameras': cams,
        'drones': [eng(Vector(d)) for d in p['drones']],
        'scaleRef': eng(Vector(p['scale_ref'])),
        'boxes': boxes, 'spheres': spheres, 'hulls': hulls,
        'practicals': practicals[:8],
        'lights': practicals,
        'probes': [{'name': n, 'center': eng(Vector(c)), 'half': [h[0], h[2], h[1]]} for n, c, h in PROBES[preset]],
        'giVolume': {'center': eng(Vector((0.0, 0.0, gh / 2))), 'half': [half + 8.0, gh / 2, half + 8.0]},
        'emitters': [{'name': n, 'pos': eng(Vector(v))} for n, v in emit],
        'terrain': terr,
        # D128: runtime-lit from the true sun (no art phase here), spinning 1 deg / min about the planet's pole
        'earth': {'center': eng(ec), 'radius': round(er, 3), 'spinAxis': [0.0, 1.0, 0.0], 'degPerMinute': 1.0,
                  'lighting': 'runtime',
                  'meshes': ['env_moon__bd_earth'], 'texture': dict(EARTH_FILES)},
        'ibl': ibl,
    }


def env_data(S0, ibl, terrains, boulder_tiers):
    d = SUN_TRAVEL.normalized()
    ec, er = S0.earth
    data = {'env': 'moon', 'scale': 1, 'gravity': 'moon', 'gravityPercent': 16.5, 'air': 0.0, 'feel': 'real',
            'glb': 'env/moon/moon.glb', 'presets': {pr: preset_data(pr, S0, ibl, terrains[pr], ec, er) for pr in PRESETS}}
    data['light'] = {
        'sunDir': eng_dir(d), 'sunElevationDeg': SUN_EL, 'sunAzimuthDeg': SUN_AZ,
        'sunFrom': 'front-left, raking (18 deg): long black shadows trail away to the back-right',
        'sunKelvin': 5900, 'sunColor': H.kelvin_rgb(5900), 'sunLux': 120000, 'sunAngleDeg': 0.53,
        'sky': '#000000', 'earthshineDir': eng_dir(-TO_EARTH), 'earthshineColor': '#A8C4FF', 'earthshineIntensity': 0.002,
        'groundBounceLowTier': 0.08, 'ev100': 15.0, 'autoExposureEv': 0.0, 'tonemap': 'khronos-pbr-neutral',
        'vignette': 0.1, 'grain': 0.012, 'fogDensity': 0.0,
        'note': 'no haze ever (§6.1); the brief\'s "azimuth 120 deg ... from front-left" is honoured as front-left: '
                'sunAzimuthDeg is measured from +Y (set) toward +X, as in env_tinker.ts'}
    data['lut'] = {'name': 'lut_moon', 'file': 'env/moon/lut_moon.png', 'size': 32,
                   'layout': 'strip 1024 x 32: red = x within a 32 px tile, green = y (top row 0), blue = tile index',
                   'space': 'display (after the tonemap)', 'grade': 'neutral, slight cool shadows'}
    data['terrainLayers'] = {
        'regolith': {'basecolor': 'env/moon/terrain/terrain_regolith_basecolor.png',
                     'normal': 'env/moon/terrain/terrain_regolith_normal.png',
                     'orm': 'env/moon/terrain/terrain_regolith_orm.png',
                     'detailNormal': 'env/moon/terrain/terrain_regolith_detail_normal.png', 'tileM': 4.0,
                     'detailTileM': 0.5, 'opposition': 0.15},
        'sintered': {'basecolor': 'env/moon/terrain/terrain_sintered_basecolor.png',
                     'normal': 'env/moon/terrain/terrain_sintered_normal.png',
                     'orm': 'env/moon/terrain/terrain_sintered_orm.png', 'tileM': 4.0},
        'rockAboveDeg': 26.0, 'apron': {'center': [0, 0, 0], 'radius': APRON_R}, 'renderMesh': 'env_moon__terrain',
    }
    data['boulders'] = boulder_tiers
    floods = [i for i, q in enumerate(data['presets']['arena']['practicals']) if q.get('toggle') == 'baseLights']
    data['lightGroups'] = {'baseLights': {
        'label': 'Base lights', 'defaultOn': False, 'practicals': floods,
        'meshes': ['env_moon__lander_flood_lens'],
        'note': 'the lander floodlights (2 x 5,000 K, 20k lm, shadowed): a world toggle, off by default (§6.4). When on, '
                'draw the listed practicals and make the lens meshes emissive (kn_env_sconce-like, 5,000 K)'}}
    ns = set()
    for g, pc in S0.pieces:
        if pc in S0.noshadow:
            ns.add('env_moon__%s%s' % ('bd_' if g == 'backdrop' else '', pc))
    data['noShadow'] = sorted(ns)
    return data


TS_HEAD = '''// GENERATED by tools/blender/env_moon.py (`node tools/assets.mjs --env-moon`). Do not edit by hand.
// MOON BASE (art/briefs/environments.md §6), M5 contract 4 (E5c -> W5): static colliders, build zones, cameras,
// drones, light rig, probes, IBL and LUT names, and the fixed authored heightfield as integer samples, generated from
// the same tables as assets/build/env/moon/moon.glb. One set serves Room, Warehouse and Arena; every preset shares the
// origin (the bounds floor centre). Real scale. Engine space: metres, Y-up, front (default camera side) = +Z.
// Literals only (determinism lint); the heightfield decoder is integer arithmetic.
'''

TS_TYPES = '''
import type { EnvBox, EnvCamera, EnvEarth, EnvHull, EnvIbl, EnvLut, EnvPractical, EnvSphere, EnvV3 } from './env_hangar.ts';

/** The authored heightfield in the TerrainRecord layout (packages/format terrain.ts): rows along +z from origin[1],
 *  columns along +x from origin[0], spacing 0.5 m, metres = u16 * maxHeight / 65535 (maxHeight = the preset's bounds
 *  height). `data` = base64 of each row's zigzag-varint deltas from its left neighbour; `fnv1a` checks the samples. */
export interface MoonTerrain {
  readonly origin: readonly [number, number]; readonly nx: number; readonly nz: number; readonly spacing: number;
  readonly maxHeight: number; readonly preset: string; readonly phys: 'regolith'; readonly encoding: string;
  readonly data: string; readonly fnv1a: number;
  /** Highest sample (m) and the sample count at 0 (the flat basin floor). */
  readonly maxM: number; readonly flatSamples: number;
}

/** What moonTerrain() returns: structurally a format TerrainRecord. */
export interface MoonTerrainRecord {
  readonly origin: readonly [number, number]; readonly nx: number; readonly nz: number; readonly maxHeight: number;
  readonly heights: Uint16Array; readonly preset: string;
}

export interface MoonPreset {
  /** The shared set glb (LOD0..LOD2 > CHUNK__cx_cy, LOD3 > HLOD__hx_hy, BACKDROP, REF__scale__<preset>, PROBES). */
  readonly glb: string;
  readonly origin: EnvV3;
  readonly bounds: { readonly min: EnvV3; readonly max: EnvV3 };
  readonly neutral: { readonly min: EnvV3; readonly max: EnvV3 };
  readonly camera: EnvV3;
  readonly target: EnvV3;
  readonly cameras: { readonly default: EnvCamera; readonly hero: EnvCamera; readonly wide: EnvCamera; readonly lobby: EnvCamera };
  readonly drones: readonly [EnvV3, EnvV3];
  readonly scaleRef: EnvV3;
  /** The apron's concrete strips (top y = 0), props and the scale reference. */
  readonly boxes: readonly EnvBox[];
  /** The dome (its hemisphere), small boulders, the scale-reference THUD. */
  readonly spheres: readonly EnvSphere[];
  readonly hulls: readonly EnvHull[];
  /** The renderer's spot table (≤ 8): the two lander floods first (group `baseLights`, off by default), the dome
   *  window pools, the beacon. */
  readonly practicals: readonly EnvPractical[];
  /** Every light fixture (the same set here). */
  readonly lights: readonly EnvPractical[];
  readonly probes: readonly { readonly name: string; readonly center: EnvV3; readonly half: EnvV3 }[];
  readonly giVolume: { readonly center: EnvV3; readonly half: EnvV3 };
  readonly emitters: readonly { readonly name: string; readonly pos: EnvV3 }[];
  readonly terrain: MoonTerrain;
  readonly earth: EnvEarth;
  readonly ibl: EnvIbl;
}

export interface MoonEnv {
  readonly env: 'moon';
  readonly scale: number;
  readonly gravity: 'moon';
  /** 16.5 % (§6). */
  readonly gravityPercent: number;
  /** 0: no air (Helios sink, Gales do nothing). */
  readonly air: number;
  readonly feel: 'real';
  /** The shared set glb (same as every preset's `glb`). */
  readonly glb: string;
  readonly presets: { readonly room: MoonPreset; readonly warehouse: MoonPreset; readonly arena: MoonPreset };
  /** §6.4. sunDir / earthshineDir = the direction the light travels; earthshineIntensity is × the sun. */
  readonly light: {
    readonly sunDir: EnvV3; readonly sunElevationDeg: number; readonly sunAzimuthDeg: number; readonly sunFrom: string;
    readonly sunKelvin: number; readonly sunColor: EnvV3; readonly sunLux: number; readonly sunAngleDeg: number;
    readonly sky: string; readonly earthshineDir: EnvV3; readonly earthshineColor: string; readonly earthshineIntensity: number;
    readonly groundBounceLowTier: number; readonly ev100: number; readonly autoExposureEv: number; readonly tonemap: string;
    readonly vignette: number; readonly grain: number; readonly fogDensity: number; readonly note: string;
  };
  readonly lut: EnvLut;
  /** Terrain shading: the regolith and sintered-apron tiling sets (basecolor + height in A, normal, orm), the
   *  regolith micro-pebble detail normal, the rock-slope rule, the apron disc, and the glb's render-mesh prefix. */
  readonly terrainLayers: {
    readonly regolith: { readonly basecolor: string; readonly normal: string; readonly orm: string; readonly detailNormal: string; readonly tileM: number; readonly detailTileM: number; readonly opposition: number };
    readonly sintered: { readonly basecolor: string; readonly normal: string; readonly orm: string; readonly tileM: number };
    readonly rockAboveDeg: number; readonly apron: { readonly center: EnvV3; readonly radius: number }; readonly renderMesh: string;
  };
  /** Boulders: `baked` are in moon.glb (with colliders, every tier); the tier extras are visual only, outside the
   *  Arena bounds, in moon_boulders.glb roots TIER8 / TIER12 / TIER16 (cumulative with the lower tiers). */
  readonly boulders: { readonly baked: number; readonly glb: string; readonly tiers: { readonly [tier: string]: number } };
  /** World light toggles. `baseLights` ("Base lights", §6.4): `practicals` = indices into every preset's
   *  `practicals` switched by it, `meshes` = glb mesh prefixes to light up (the flood lenses) while it is on. */
  readonly lightGroups: {
    readonly baseLights: { readonly label: string; readonly defaultOn: boolean; readonly practicals: readonly number[]; readonly meshes: readonly string[]; readonly note: string };
  };
  readonly noShadow: readonly string[];
}
'''


def write_ts(path, data, stats):
    """The presets share one set: its colliders are written once (MOON_SET_*) and spread into each preset next to
    that preset's own scale-reference colliders."""
    out = [TS_HEAD + '// ' + stats, TS_TYPES, envset.TS_DECODER]
    pres = data['presets']
    shared = {}
    for key in ('boxes', 'spheres', 'hulls'):
        lists = [pres[p][key] for p in PRESETS]
        common = [e for e in lists[0] if all(e in L for L in lists[1:])]
        shared[key] = common
    d2 = dict(data)
    d2['presets'] = {}
    for p in PRESETS:
        q = dict(pres[p])
        for key, const in (('boxes', 'MOON_SET_BOXES'), ('spheres', 'MOON_SET_SPHERES'), ('hulls', 'MOON_SET_HULLS')):
            own = [e for e in q[key] if e not in shared[key]]
            q[key] = ['@@...%s@@' % const] + own
        d2['presets'][p] = q
    for key, const, typ in (('boxes', 'MOON_SET_BOXES', 'EnvBox'), ('spheres', 'MOON_SET_SPHERES', 'EnvSphere'),
                            ('hulls', 'MOON_SET_HULLS', 'EnvHull')):
        out.append('/** The set\'s %s shared by every preset. */\nconst %s: readonly %s[] = %s;\n'
                   % (key, const, typ, ts_literal(shared[key])))
    lit = ts_literal(d2)
    for const in ('MOON_SET_BOXES', 'MOON_SET_SPHERES', 'MOON_SET_HULLS'):
        lit = lit.replace("'@@...%s@@'" % const, '...' + const)
    out.append('export const MOON: MoonEnv = %s;' % lit)
    out.append('')
    out.append("export const MOON_PRESETS = ['room', 'warehouse', 'arena'] as const;")
    out.append('')
    out.append('''/** The authored heightfield of a preset as a TerrainRecord (decoded once per call; cache it). */
export function moonTerrain(preset: 'room' | 'warehouse' | 'arena'): MoonTerrainRecord {
  const t = MOON.presets[preset].terrain;
  return { origin: t.origin, nx: t.nx, nz: t.nz, maxHeight: t.maxHeight, heights: decodeRows(t.data, t.nx, t.nz), preset: t.preset };
}
''')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out))


# ---------------------------------------------------------------- textures, IBL, LUT

class _TexKit:
    """Periodic numpy texture helpers (the same recipes as E3b's Backlot terrain art, kept local: importing
    props/env_backlot.py runs its build)."""

    @staticmethod
    def hexrgb(h):
        h = h.lstrip('#')
        return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])

    @staticmethod
    def fnoise(rng, n, f0, f1, power=1.0):
        w = rng.standard_normal((n, n))
        fx = np.fft.fftfreq(n) * n
        r = np.sqrt(fx[None, :] ** 2 + fx[:, None] ** 2)
        filt = ((r >= f0) & (r <= f1)) / np.maximum(r, 1.0) ** power
        out = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
        out -= out.min()
        return out / max(out.max(), 1e-9)

    @staticmethod
    def blobs(rng, n, count, radius):
        imp = np.zeros((n, n))
        xs, ys = rng.integers(0, n, count), rng.integers(0, n, count)
        imp[ys, xs] = rng.uniform(0.6, 1.0, count)
        d2 = (np.minimum(np.arange(n), n - np.arange(n)) ** 2)
        ker = np.exp(-(d2[None, :] + d2[:, None]) / (2 * radius ** 2))
        out = np.real(np.fft.ifft2(np.fft.fft2(imp) * np.fft.fft2(ker)))
        out -= out.min()
        return out / max(out.max(), 1e-9)

    @staticmethod
    def normal_from(h, strength):
        dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
        dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
        n = np.stack([-dx, dy, np.ones_like(h)], axis=2)   # OpenGL convention (+Y up), rows top-down
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        return n * 0.5 + 0.5

    @staticmethod
    def save_png(path, arr, srgb=True):
        """arr: (rows top-down, cols, 3 or 4) floats 0..1."""
        h, w = arr.shape[:2]
        if arr.shape[2] == 3:
            arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
        im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        im.pixels.foreach_set(np.ascontiguousarray(arr[::-1], dtype=np.float32).ravel())
        im.filepath_raw = path
        im.file_format = 'PNG'
        im.save()
        bpy.data.images.remove(im)


def terrain_textures(out_dir):
    """Regolith (base #8C8A85, roughness .95) and sintered apron (#9A968E, .8) tiling sets, 2048^2 over 4 m: toy-
    flattened albedo, chunky pebble / dimple normals; the regolith micro-pebble detail normal 1024^2 over 0.5 m."""
    eb = _TexKit
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(1972)
    rep = {}
    for name, (a, b, rough, n) in (('regolith', ('#8C8A85', '#7E7C77', 0.95, 2048)),
                                   ('sintered', ('#9A968E', '#8E8A82', 0.8, 2048))):
        if name == 'regolith':
            h = 0.5 * eb.blobs(rng, n, 1600, n / 160) + 0.3 * eb.fnoise(rng, n, 3, 18) + 0.2 * eb.fnoise(rng, n, 80, 300)
            pits = eb.blobs(rng, n, 160, n / 90)
            h = h - 0.35 * (pits > 0.6) * (pits - 0.6)
        else:   # sintered: smooth with faint 2 m hex-scale cells and fine grain
            h = 0.25 * eb.fnoise(rng, n, 2, 8) + 0.15 * eb.fnoise(rng, n, 120, 400) + 0.6 * eb.blobs(rng, n, 300, n / 400)
        h = (h - h.min()) / max(h.max() - h.min(), 1e-9)
        var = eb.fnoise(rng, n, 1, 6)
        ca, cb = eb.hexrgb(a), eb.hexrgb(b)
        t = np.clip(0.5 * h + 0.5 * var, 0, 1)[:, :, None]
        col = ca[None, None, :] * (1 - t) + cb[None, None, :] * t
        col *= (0.95 + 0.1 * h)[:, :, None]
        eb.save_png(os.path.join(out_dir, 'terrain_%s_basecolor.png' % name),
                    np.concatenate([np.clip(col, 0, 1), h[:, :, None]], axis=2), srgb=True)
        eb.save_png(os.path.join(out_dir, 'terrain_%s_normal.png' % name),
                    eb.normal_from(h, 10.0 if name == 'regolith' else 4.0), srgb=False)
        blur = h.copy()
        for _ in range(5):
            blur = (blur + np.roll(blur, 3, 0) + np.roll(blur, -3, 0) + np.roll(blur, 3, 1) + np.roll(blur, -3, 1)) / 5
        ao = np.clip(1.0 - 1.5 * np.maximum(blur - h, 0.0), 0.6, 1.0)
        rgh = np.clip(rough + 0.04 * (var - 0.5), 0.5, 1.0)
        eb.save_png(os.path.join(out_dir, 'terrain_%s_orm.png' % name), np.stack([ao, rgh, np.zeros_like(h)], axis=2),
                    srgb=False)
        rep[name] = [round(float(c), 4) for c in col.reshape(-1, 3).mean(axis=0)]
    d = 1024
    hd = 0.7 * eb.blobs(rng, d, 5000, d / 300) + 0.3 * eb.fnoise(rng, d, 60, 300)
    hd = (hd - hd.min()) / max(hd.max() - hd.min(), 1e-9)
    eb.save_png(os.path.join(out_dir, 'terrain_regolith_detail_normal.png'), eb.normal_from(hd, 6.0), srgb=False)
    return rep


BAKE_SUN = 8.0


def bake_rig(sc):
    """Vacuum: a black world, the hard 5,900 K sun from the front-left at 18 deg, earthshine (unshadowed, 0.002 x).
    The regolith's bounce is the path tracer's; Earth and stars light by emission."""
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
    out = []
    for name, travel, energy, col, shadow in (('Sun', SUN_TRAVEL, BAKE_SUN, H.kelvin_rgb(5900), True),
                                              ('Earthshine', -TO_EARTH, BAKE_SUN * 0.002, (0.66, 0.77, 1.0), False)):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy, ld.angle, ld.color = energy, math.radians(0.53), tuple(col[:3])
        ld.use_shadow = shadow
        o = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(o)
        o.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()
        out.append(o)
    return out


GRADE = envset.cool_shadows((-0.006, -0.001, 0.010), sat=1.0, s_curve=0.0)


def write_height(out_dir, preset, u16, n):
    path = os.path.join(out_dir, 'moon_%s.height.r16' % preset)
    with open(path, 'wb') as f:
        f.write(u16.astype('<u2').tobytes())
    img = np.clip(u16.astype(np.float64) / max(1.0, float(u16.max())), 0, 1)
    _TexKit.save_png(path.replace('.r16', '.png'), np.stack([img, img, img], axis=2), srgb=False)
    return path


# ---------------------------------------------------------------- render

def render(root, out_png, samples):
    """moon.glb from the hero view over the Arena spawn view -> out_png; the Room over the Warehouse spawn views ->
    out_png with _room."""
    jobs = [(out_png, [('hero', 'arena'), ('default', 'arena')]),
            (out_png.replace('.png', '_room.png'), [('default', 'room'), ('default', 'warehouse')])]
    import render_lookdev as rl
    for png, views in jobs:
        shots = []
        for view, preset in views:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            sc = bpy.context.scene
            bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'assets', 'build', 'env', ENV, 'moon.glb'))
            keep = ('LOD0', 'BACKDROP', 'REF__scale__' + preset)
            for ob in list(bpy.data.objects):
                top = ob
                while top.parent is not None:
                    top = top.parent
                if not top.name.split('.')[0].startswith(keep):
                    bpy.data.objects.remove(ob, do_unlink=True)
            H.rebind(root, solo=True)
            H.use_cycles_earth(H.earth_lit_png(root, ENV, 'earth_moon'))   # D128: the lit look-dev bake
            for ob in bpy.data.objects:
                if ob.type == 'MESH' and '__noshadow' in ob.name:
                    ob.visible_shadow = False
            bake_rig(sc)
            cd = bpy.data.cameras.new('cam')
            cd.clip_end = 30000.0
            cam = bpy.data.objects.new('cam', cd)
            sc.collection.objects.link(cam)
            if view == 'default':
                p = PRESETS[preset]
                pos, tgt = Vector(p['camera']), Vector(p['target'])
                cd.lens = 18.0 * 9 / 16 / math.tan(math.radians(20.0))
            else:
                c = CAMERAS[view]
                pos, tgt, cd.lens = Vector(c['pos']), Vector(c['target']), c['lens']
            cam.location = pos
            cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
            sc.camera = cam
            rl.use_cycles(sc, samples)
            sc.cycles.max_bounces = 6
            sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
            sc.view_settings.view_transform = 'Khronos PBR Neutral'
            sc.view_settings.exposure = 0.0
            tmp = png.replace('.png', '_%s_%s.tmp.png' % (view, preset))
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            shots.append(tmp)
        H.stack_pngs(shots, png)
        for t in shots:
            os.remove(t)
        print('rendered', png)


# ---------------------------------------------------------------- main

def main():
    args = _cli.script_args()
    no_ts = _cli.flag(args, '--no-ts')
    no_blend = _cli.flag(args, '--no-blend')
    no_bake = _cli.flag(args, '--no-bake')
    ibl_samples = int(_cli.option(args, '--ibl-samples', '96'))
    render_png = _cli.option(args, '--render')
    samples = int(_cli.option(args, '--samples', '96'))
    root = paths.repo_root()
    out_dir = os.path.join(root, 'assets', 'build', 'env', ENV)
    if render_png:
        render(root, render_png, samples)
        return
    library.ensure_libs(root)
    load_all()
    os.makedirs(out_dir, exist_ok=True)
    envset.write_lut(os.path.join(out_dir, 'lut_moon.png'), GRADE)
    EARTH_FILES.update(H.earth_bake(out_dir, 'earth_moon', 1024, TO_EARTH * EARTH_D, EARTH_D * math.tan(math.radians(EARTH_DIAM / 2)),
                                    Vector((0.0, 0.0, 1.7)), _to_sun, lit_path=H.earth_lit_png(root, ENV, 'earth_moon')))
    tex = terrain_textures(os.path.join(out_dir, 'terrain'))
    print('  terrain textures', tex)
    # the heightfields (sim data) and the render ground sampler
    terrains = {}
    G = None
    for preset, p in PRESETS.items():
        h, n = field_samples(p['field'])
        u16 = quantize(h, p['H'])
        enc, nbytes = envset.encode_heights(u16.ravel().tolist(), n, n)
        terrains[preset] = {'origin': [-p['field'], -p['field']], 'nx': n, 'nz': n, 'spacing': SPACING,
                            'maxHeight': p['H'], 'preset': preset, 'phys': 'regolith',
                            'encoding': 'base64 zigzag-varint row deltas (u16)', 'data': enc,
                            'fnv1a': envset.fnv1a_u16(u16.ravel().tolist()),
                            'maxM': round(float(u16.max()) * p['H'] / 65535.0, 3), 'flatSamples': int((u16 == 0).sum())}
        write_height(out_dir, preset, u16, n)
        print('  %s heightfield %d x %d, max %.2f m, %d flat samples, %d bytes encoded' % (
            preset, n, n, terrains[preset]['maxM'], terrains[preset]['flatSamples'], nbytes))
        if preset == 'arena':
            G = Ground(u16, n, p['field'], p['H'])
    placed = scatter_boulders(G, 400, 30.0, 180.0, 5, (75, 20, 5))
    print('  boulders baked: %d' % len(placed))
    sc, cols = H.new_scene()
    FONT[0] = bpy.data.fonts.load(os.path.join(root, 'assets', 'src', 'lib', 'fonts', 'DejaVuSans-Bold.ttf'))
    builds = [build(lod, G, placed) for lod in range(4)]
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
        print('  LOD%d: %d tris (%.1f %%)' % (i, t, 100.0 * t / tris[0]))
    print('  backdrop %d tris, scale refs %d, %d boxes, %d spheres, %d hulls, %d practicals, %d objects'
          % (bd, extra, len(S0.boxes), len(S0.spheres), len(S0.hulls), len(S0.lights), len(bpy.data.objects)))
    if os.environ.get('KN_PIECES'):
        per = {}
        for o in cols['LOD0'].objects:
            key = re.sub(r'__c-?\d+_-?\d+.*', '', o.name)
            per[key] = per.get(key, 0) + envset.tri_count([o])
        for nme, t in sorted(per.items(), key=lambda x: -x[1])[:30]:
            print('    %8d  %s' % (t, nme))
    add_box_markers(cols['COL'], S0.boxes)
    for preset, p in PRESETS.items():
        half, Hh = p['half'], p['H']
        empty(cols['BOUNDS'], 'BOUNDS__' + preset, (0, 0, Hh / 2), (half, half, Hh / 2), 'CUBE')
        (nx0, ny0), (nx1, ny1) = p['neutral']
        empty(cols['ZONE'], 'ZONE__neutral__' + preset, ((nx0 + nx1) / 2, (ny0 + ny1) / 2, 0.025),
              ((nx1 - nx0) / 2, (ny1 - ny0) / 2, 0.025), 'CUBE')
        for nm, loc in (('camera', p['camera']), ('target', p['target']), ('drone__p1', p['drones'][0]),
                        ('drone__p2', p['drones'][1]), ('scale_ref', p['scale_ref'])):
            empty(cols['SPAWN'], 'SPAWN__%s__%s' % (nm, preset), loc)
        for n, c, h in PROBES[preset]:
            empty(cols['PROBE'], 'PROBE__reflect__%s__%s' % (preset, n), c, h, 'CUBE')
    for name, c in CAMERAS.items():
        empty(cols['SPAWN'], 'SPAWN__camera_%s' % name, c['pos'])
    empty(cols['PROBE'], 'PROBE__ibl__0', IBL_PROBE, None, 'SPHERE')
    for key, val in (('kn_env', ENV), ('kn_presets', 'room,warehouse,arena'), ('kn_gravity', 'moon'), ('kn_air', 0),
                     ('kn_feel', 'real')):
        sc[key] = val
    if not no_blend:
        src = os.path.join(root, 'assets', 'src', 'env', ENV, 'moon_set.blend')
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
        tree['REF__scale__' + g[4:]] = objs
    tree['PROBES'] = list(cols['PROBE'].objects)
    glb = os.path.join(out_dir, 'moon.glb')
    envset.export_tree(tree, glb)
    from kn_tools import textures as kt
    print('texSet on %d material(s)' % kt.patch_glb(glb, {H.EARTH_MAT}, 'earth'))
    H.use_cycles_earth(H.earth_lit_png(root, ENV, 'earth_moon'))   # D128: the IBL bake sees the lit look-dev Earth
    print('exported', glb, os.path.getsize(glb), 'bytes')
    # IBL
    meta_path = os.path.join(out_dir, 'ibl_moon.json')
    if no_bake and os.path.exists(meta_path):
        with open(meta_path, encoding='utf-8') as f:
            meta = json.load(f)
    else:
        for c in ('LOD1', 'LOD2', 'LOD3'):
            cols[c].hide_render = True
        for ob in sc.objects:
            if ob.type == 'MESH' and '__noshadow' in ob.name:
                ob.visible_shadow = False
        added = bake_rig(sc)
        px, w, h = envset.bake_equirect(IBL_PROBE, os.path.join(out_dir, 'ibl_moon.hdr'), ibl_samples)
        meta = {'name': 'ibl_moon', 'file': 'env/moon/ibl_moon.hdr', 'format': 'equirect-hdr', 'size': [w, h],
                'probe': eng(Vector(IBL_PROBE)), 'sh9': envset.sh9(px), 'bakeSunStrength': BAKE_SUN,
                'meanRadiance': [round(float(px[:, :, c].mean()), 5) for c in range(3)], 'samples': ibl_samples,
                'note': 'Cycles bake of moon.glb LOD0 + backdrop with the §6.4 rig; centre column faces +Y (engine -Z)'}
        envset.write_json(meta_path, meta)
        for ob in added:
            bpy.data.objects.remove(ob, do_unlink=True)
    ibl = {k: meta[k] for k in ('name', 'file', 'format', 'size', 'probe', 'sh9', 'bakeSunStrength')}
    boulder_tiers = boulders_glb(root, out_dir, G, mats)
    data = env_data(S0, ibl, terrains, boulder_tiers)
    full = dict(data)
    full['stats'] = {'lodTris': tris, 'backdropTris': bd, 'scaleRefTris': extra, 'masters': names,
                     'glbBytes': os.path.getsize(glb), 'textures': tex}
    full['presets'] = {pr: {**q, 'terrain': {k: v for k, v in q['terrain'].items() if k != 'data'}}
                       for pr, q in data['presets'].items()}
    full['textures'] = dict(EARTH_FILES)      # gfx/environment.ts binds it (texSetsOf) for kn_env_earth_tex
    envset.write_json(os.path.join(out_dir, 'moon.env.json'), full)
    if not no_ts:
        nb = ', '.join('%s %d boxes / %d spheres / %d hulls' % (pr, len(q['boxes']), len(q['spheres']), len(q['hulls']))
                       for pr, q in data['presets'].items())
        stats = 'LOD0..3 tris %s · backdrop %d · %s' % (' / '.join(str(t) for t in tris), bd, nb)
        write_ts(os.path.join(root, 'packages', 'parts-data', 'src', 'env_moon.ts'), data, stats)
    _ = PROPS


def boulders_glb(root, out_dir, G, mats):
    """moon_boulders.glb: the tier extras (visual only, outside the Arena bounds, so tiers never change the sim),
    one merged mesh per tier increment: TIER8 (+1,100), TIER12 (+2,500), TIER16 (+4,000)."""
    sc, cols = H.new_scene()
    mats, _local = envset.materials(paths.materials_lib(root), [ROCK, REG])
    tiers = {'TIER8': 1100, 'TIER12': 2500, 'TIER16': 4000}
    tree = {}
    for i, (name, n) in enumerate(tiers.items()):
        S = SpaceSet(0)
        k = S.kit('boulders_' + name.lower(), 'backdrop')
        for x, y, si, s, shape, yaw in scatter_boulders(G, n, 140.0, 900.0, 50 + i, (70, 24, 6), avoid_field=True):
            z = float(height(np.array([x]), np.array([y]))[0]) - s * 0.08
            boulder_kit(k, shape, s * 1.4, place(x, y, z + s * 0.12, yaw), 3)
        out = envset.to_objects(S, ENV, mats, cols, chunked=False)
        tree[name] = out['backdrop']
    path = os.path.join(out_dir, 'moon_boulders.glb')
    envset.export_tree(tree, path)
    print('exported', path, os.path.getsize(path), 'bytes')
    return {'baked': 400, 'glb': 'env/moon/moon_boulders.glb',
            'tiers': {'4': 400, '8': 400 + tiers['TIER8'], '12': 400 + tiers['TIER8'] + tiers['TIER12'],
                      '16': 400 + sum(tiers.values())}}


if __name__ == '__main__':
    main()
