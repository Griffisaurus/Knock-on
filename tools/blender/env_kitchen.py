"""Procedurally build the MEGA KITCHEN set (docs/art/briefs/environments.md §2, ART_BIBLE §9).

Usage: blender -b --factory-startup -P tools/blender/env_kitchen.py -- [--no-ts] [--no-blend]
   or: node tools/assets.mjs --env kitchen

Outputs
  assets/src/env/kitchen/kitchen_set.blend     source (ENV_RENDER/LOD1..3, COL, BOUNDS, SPAWN, ZONE, REF, BACKDROP)
  assets/build/env/kitchen/kitchen.glb         nodes LOD0..LOD3, BACKDROP, REF__scale__room / __warehouse
  assets/build/env/kitchen/kitchen.env.json    the same collider / zone / spawn data as JSON (tooling)
  packages/parts-data/src/env_kitchen.ts       generated data for the sim (contract 5): literals only

The set is built at 5 : 1 in *set coordinates* (Blender metres, Z-up, origin = the Warehouse bounds floor centre,
back wall Y = +32, left wall X = -32). The glb and the colliders share one table: every collider box is emitted
by the same call that builds the visible piece, so the two cannot drift. Engine coordinates are glTF's Y-up
(x, z, -y); the Room preset's world origin is set (0, +24, 0) = engine (0, 0, -24).
Not a part: it skips validator v1 (no kn_type root), but every material is a linked master.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import geom, library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import Kit, at, frame  # noqa: E402

from props.core import build_prop, load_all, place  # noqa: E402  (M3 maximalism pass: the shared props kit)
from props.envkit import clean  # noqa: E402

ENV = 'kitchen'
LODQ = (1.0, 0.6, 0.35, 0.15)
KS = 5.0  # kit props are authored 1 : 1 and instanced at 5 : 1 here (environments.md §7)

# environments.md §2.1 (set coordinates)
PRESETS = {
    'room': {'bounds': ((-8, 16, 0), (8, 32, 8)), 'origin': (0, 24, 0),
             'neutral': ((-4, 17, 0), (4, 25, 0)),
             'target': (0, 21, 0.5), 'camera': (0, 9.5, 7.2), 'drones': ((-3, 12, 3), (3, 12, 3)),
             'scale_ref': (5.5, 17.5, 0)},
    'warehouse': {'bounds': ((-32, -32, 0), (32, 32, 24)), 'origin': (0, 0, 0),
                  'neutral': ((-24, -28, 0), (-8, -12, 0)),
                  'target': (-4, -8, 1), 'camera': (-4, -40, 19.5), 'drones': ((-5, -32, 8), (5, -32, 8)),
                  'scale_ref': (-6, -27, 0)},
}
PHYS = ('powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric')


class SetBuilder:
    """Collects render kits per piece for one LOD, and (on LOD0 only) the collider table."""

    def __init__(self, lod):
        self.lod = lod
        self.q = LODQ[lod]
        self.pieces = {}
        self.boxes = []
        self.spheres = []

    def kit(self, piece, group='set'):
        key = (group, piece)
        if key not in self.pieces:
            self.pieces[key] = Kit()
        return self.pieces[key]

    # bevel helpers (toy style: every edge rounded; fewer segments per LOD)
    def cs(self, base=3):
        return max(0, int(round(base * self.q)))

    def box(self, piece, lo, hi, mat, r=0.04, phys='powder', col=True, group='set', name=None, M=None, preset=None):
        """Axis-aligned (in the local frame M) rounded box from lo to hi, plus its collider."""
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        c = (lo + hi) / 2
        k = self.kit(piece, group)
        rr = min(r, min(size) * 0.45)
        cs = self.cs(3) if rr > 0.001 else 0
        if cs == 0:
            rr = 0.0
            k.hull([(c.x + sx * size.x / 2, c.y + sy * size.y / 2, c.z + sz * size.z / 2)
                    for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], mat, m=M)
        else:
            k.rbox(tuple(size), tuple(c), rr, mat, cseg=cs, m=M)
        if col:
            self.collider(name or piece, lo, hi, phys, M, preset)

    def collider(self, name, lo, hi, phys, M=None, preset=None):
        if self.lod != 0:
            return
        assert phys in PHYS, phys
        pts = [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        if M is not None:
            pts = [M @ p for p in pts]
        a = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        b = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        n = sum(1 for bx in self.boxes if bx['name'].startswith(name))
        self.boxes.append({'name': '%s_%d' % (name, n) if n else name, 'lo': a, 'hi': b, 'phys': phys,
                           'preset': preset})

    def sphere_col(self, name, c, r, phys, preset=None):
        if self.lod == 0:
            self.spheres.append({'name': name, 'c': Vector(c), 'r': r, 'phys': phys, 'preset': preset})

    def cyl(self, piece, c, r, z0, z1, mat, bev=0.03, phys='powder', col=True, group='set', cap=None, name=None,
            preset=None):
        k = self.kit(piece, group)
        segs = max(8, int(40 * self.q))
        k.cyl(r, z0, z1, mat, segs, bev=bev if self.lod < 3 else 0.0, bseg=max(1, self.cs(2)),
              m=at(c[0], c[1], 0.0), cap=cap)
        if col:
            self.collider(name or piece, (c[0] - r, c[1] - r, z0), (c[0] + r, c[1] + r, z1), phys, None, preset)

    def lathe(self, piece, c, profile, group='set', m=None):
        k = self.kit(piece, group)
        segs = max(8, int(40 * self.q))
        mm = at(*c) if m is None else m
        k.lathe(profile, segs, m=mm)


# ---------------------------------------------------------------- set pieces

def floor(S):
    """1.5 m checker tiles (0.3 m real), Bone / warm grey, 30 mm grout; one ceramic floor collider (top z = 0)."""
    tile, grout = 1.5, 0.03
    k_tiles = S.kit('floor')
    if S.lod == 3:
        k_tiles.hull([(x, y, z) for x in (-32, 32) for y in (-32, 32) for z in (-0.3, 0.0)], 'kn_env_floor_tile')
    else:
        bm = k_tiles.bm
        n = int(math.ceil(32 / tile))
        ch = 0.02 if S.lod == 0 else 0.0
        for i in range(-n, n):
            for j in range(-n, n):
                x0, x1 = max(-32, i * tile + grout / 2), min(32, (i + 1) * tile - grout / 2)
                y0, y1 = max(-32, j * tile + grout / 2), min(32, (j + 1) * tile - grout / 2)
                if x1 - x0 < 0.05 or y1 - y0 < 0.05:
                    continue
                mat = 'kn_env_floor_tile' if (i + j) % 2 == 0 else 'kn_env_floor_tile_grey'
                mi = k_tiles.mi(mat)
                if ch:
                    top = [bm.verts.new((x0 + ch, y0 + ch, 0.0)), bm.verts.new((x1 - ch, y0 + ch, 0.0)),
                           bm.verts.new((x1 - ch, y1 - ch, 0.0)), bm.verts.new((x0 + ch, y1 - ch, 0.0))]
                    bot = [bm.verts.new((x0, y0, -0.015)), bm.verts.new((x1, y0, -0.015)),
                           bm.verts.new((x1, y1, -0.015)), bm.verts.new((x0, y1, -0.015))]
                    bm.faces.new(top).material_index = mi
                    for a in range(4):
                        b = (a + 1) % 4
                        bm.faces.new((bot[a], bot[b], top[b], top[a])).material_index = mi
                else:
                    f = bm.faces.new([bm.verts.new((x0, y0, 0.0)), bm.verts.new((x1, y0, 0.0)),
                                      bm.verts.new((x1, y1, 0.0)), bm.verts.new((x0, y1, 0.0))])
                    f.material_index = mi
        g = S.kit('grout')
        g.hull([(x, y, z) for x in (-32, 32) for y in (-32, 32) for z in (-0.3, -0.012)], 'kn_env_floor_tile_grey')
    S.collider('floor', (-32, -32, -0.5), (32, 32, 0.0), 'ceramic')


def walls(S):
    """Back wall (window hole X -3..3, Z 5.6..11) and left wall (doorway Y -32..-24, 10.5 m tall), 13.5 m with a
    Bone cornice and skirting. Open-top dollhouse: no ceiling."""
    W, T, H = 'kn_env_wall', 0.4, 13.5
    # back wall, plane Y = +32
    for nm, lo, hi in (('wall_back', (-32.4, 32, 0), (-3, 32 + T, H)), ('wall_back', (3, 32, 0), (32, 32 + T, H)),
                       ('wall_back', (-3, 32, 0), (3, 32 + T, 5.6)), ('wall_back', (-3, 32, 11.0), (3, 32 + T, H))):
        S.box('walls', lo, hi, W, r=0.02, phys='powder', name=nm)
    # left wall, plane X = -32
    for nm, lo, hi in (('wall_left', (-32 - T, -24, 0), (-32, 32, H)), ('wall_left', (-32 - T, -32, 10.5),
                                                                          (-32, -24, H))):
        S.box('walls', lo, hi, W, r=0.02, phys='powder', name=nm)
    # cornice + skirting (Bone), render only (the wall boxes cover them within 0.3 m)
    for lo, hi in (((-32.4, 31.7, 13.2), (32, 32, 13.6)), ((-32, -32, 13.2), (-31.7, 32, 13.6))):
        S.box('trim', lo, hi, 'kn_powder_bone', r=0.05, col=False)
    for lo, hi in (((-32, 31.9, 0), (32, 32, 0.6)), ((-32, -24, 0), (-31.9, 32, 0.6))):
        S.box('trim', lo, hi, 'kn_powder_bone', r=0.02, col=False)
    # door frame
    for lo, hi in (((-32.5, -24.2, 0), (-31.85, -23.9, 10.7)), ((-32.5, -32, 10.4), (-31.85, -23.9, 10.7))):
        S.box('trim', lo, hi, 'kn_powder_bone', r=0.04, col=False)


def run_frame(kind, start):
    """Local frame for a counter run: local x along the run, local y from the front (0) to the wall (depth),
    z up. 'back' runs along +X against the back wall (front faces -Y); 'left' runs along +Y against the left
    wall (front faces +X)."""
    if kind == 'back':
        return Matrix.Translation((start, 29.0, 0.0))
    return Matrix.Translation((-29.0, start, 0.0)) @ Matrix.Rotation(math.radians(90), 4, 'Z')


def counter_run(S, piece, kind, x0, x1, sink=None, doors=True):
    """Lower cabinets: Oak toe kick, Bone carcass and doors, Graphite pulls (with colliders, §2.6), the
    kn_env_counter top (0.15 m overhang). `sink` = (sx0, sx1, sy0, sy1, depth) in run-local metres."""
    M = run_frame(kind, x0)
    L = x1 - x0
    D, TOP = 3.0, 4.6
    S.box(piece, (0, 0.35, 0), (L, D, 0.5), 'kn_wood_oak', r=0.02, phys='wood', name=piece + '_toe', M=M)
    if sink is None:
        S.box(piece, (0, 0.05, 0.5), (L, D, 4.3), 'kn_powder_bone', r=0.03, name=piece + '_body', M=M)
        S.box(piece, (-0.0, -0.15, 4.3), (L, D, TOP), 'kn_env_counter', r=0.05, name=piece + '_top', M=M)
    else:
        sx0, sx1, sy0, sy1, depth = sink
        floor_z = TOP - depth
        S.box(piece, (0, 0.05, 0.5), (sx0, D, 4.3), 'kn_powder_bone', r=0.03, name=piece + '_body', M=M)
        S.box(piece, (sx1, 0.05, 0.5), (L, D, 4.3), 'kn_powder_bone', r=0.03, name=piece + '_body', M=M)
        S.box(piece, (sx0, 0.05, 0.5), (sx1, D, floor_z - 0.1), 'kn_powder_bone', r=0.03, col=False, M=M)
        S.collider(piece + '_under_sink', (sx0, 0.0, 0.5), (sx1, D, floor_z), 'steel', M)
        S.box(piece, (0, -0.15, 4.3), (sx0, D, TOP), 'kn_env_counter', r=0.05, name=piece + '_top', M=M)
        S.box(piece, (sx1, -0.15, 4.3), (L, D, TOP), 'kn_env_counter', r=0.05, name=piece + '_top', M=M)
        S.box(piece, (sx0, -0.15, floor_z), (sx1, sy0, TOP), 'kn_env_counter', r=0.05, col=False, M=M)
        S.box(piece, (sx0, sy1, floor_z), (sx1, D, TOP), 'kn_env_counter', r=0.05, col=False, M=M)
        S.collider('sink_rim_front', (sx0, -0.15, floor_z), (sx1, sy0, TOP), 'steel', M)
        S.collider('sink_rim_back', (sx0, sy1, floor_z), (sx1, D, TOP), 'steel', M)
        # brushed-steel basin: floor, four walls (inside the rim / cabinet colliders), chrome drain grille
        t = 0.05
        S.box('sink', (sx0, sy0, floor_z - 0.1), (sx1, sy1, floor_z), 'kn_steel_brushed', r=0.04, col=False, M=M)
        for lo, hi in (((sx0, sy0, floor_z), (sx0 + t, sy1, TOP)), ((sx1 - t, sy0, floor_z), (sx1, sy1, TOP)),
                       ((sx0, sy0, floor_z), (sx1, sy0 + t, TOP)), ((sx0, sy1 - t, floor_z), (sx1, sy1, TOP))):
            S.box('sink', lo, hi, 'kn_steel_brushed', r=0.02, col=False, M=M)
        S.collider('sink_floor', (sx0, sy0, floor_z - 0.1), (sx1, sy1, floor_z), 'steel', M)
        dc = M @ Vector(((sx0 + sx1) / 2, (sy0 + sy1) / 2, 0))
        S.cyl('sink', (dc.x, dc.y), 0.225, floor_z, floor_z + 0.02, 'kn_chrome', bev=0.01, col=False)
    if doors:
        n = max(1, int(round(L / 1.5)))
        w = L / n
        for i in range(n):
            a, b = i * w + 0.03, (i + 1) * w - 0.03
            S.box(piece + '_doors', (a, -0.01, 0.56), (b, 0.06, 4.24), 'kn_powder_bone', r=0.03, col=False, M=M)
            S.box(piece + '_pulls', ((a + b) / 2 - 0.4, -0.16, 3.85), ((a + b) / 2 + 0.4, -0.01, 3.97),
                  'kn_powder_graphite', r=0.05, name=piece + '_pull', M=M)


def upper_cabinets(S, x0, x1):
    """Back-wall uppers, Z 7.25..9.75 (bottom 1.45 m real), 1.65 m deep, Bone doors, Graphite pulls."""
    M = Matrix.Translation((x0, 30.35, 0.0))
    L = x1 - x0
    S.box('uppers', (0, 0.04, 7.25), (L, 1.65, 9.75), 'kn_powder_bone', r=0.04, name='uppers', M=M)
    n = max(1, int(round(L / 1.5)))
    w = L / n
    for i in range(n):
        a, b = i * w + 0.03, (i + 1) * w - 0.03
        S.box('uppers_doors', (a, -0.03, 7.3), (b, 0.05, 9.7), 'kn_powder_bone', r=0.03, col=False, M=M)
        S.box('uppers_pulls', ((a + b) / 2 - 0.35, -0.17, 7.42), ((a + b) / 2 + 0.35, -0.03, 7.54),
              'kn_powder_graphite', r=0.05, name='uppers_pull', M=M)


def sink_and_tap(S):
    # tap: column at X 0, Y 31.8 rising to Z 7.8, gooseneck over the basin
    k = S.kit('tap')
    sides = max(8, int(24 * S.q))
    k.cyl(0.32, 4.6, 4.8, 'kn_chrome', sides, bev=0.06, m=at(0, 31.6, 0))
    path = [(0, 31.6, 4.7), (0, 31.6, 7.2), (0, 31.45, 7.65), (0, 31.1, 7.8), (0, 30.7, 7.65), (0, 30.5, 7.2)]
    k.sweep(path, 0.17, sides, 'kn_chrome')
    for sx in (-1, 1):
        k.cyl(0.13, 4.6, 5.25, 'kn_chrome', sides, bev=0.04, m=at(0.7 * sx, 31.6, 0))
        k.sweep([(0.7 * sx, 31.6, 5.15), (0.7 * sx, 31.3, 5.3)], 0.07, max(6, sides // 2), 'kn_rubber')
    S.collider('tap', (-0.32, 31.28, 4.6), (0.32, 31.92, 7.85), 'steel')
    S.collider('tap_spout', (-0.17, 30.33, 7.0), (0.17, 31.28, 7.97), 'steel')
    S.collider('tap_valve', (-0.83, 31.47, 4.6), (-0.57, 31.73, 5.25), 'steel')
    S.collider('tap_valve', (0.57, 31.47, 4.6), (0.83, 31.73, 5.25), 'steel')


def window(S):
    """Back wall X -3..3, Z 5.6..11.0: Bone frame + cross mullion, kn_glass pane, sill (herb pot sits on it)."""
    F = 'kn_powder_bone'
    for lo, hi in (((-3.25, 31.8, 5.45), (3.25, 32.35, 5.75)), ((-3.25, 31.8, 10.85), (3.25, 32.35, 11.15)),
                   ((-3.25, 31.8, 5.45), (-2.95, 32.35, 11.15)), ((2.95, 31.8, 5.45), (3.25, 32.35, 11.15)),
                   ((-0.09, 31.95, 5.6), (0.09, 32.2, 11.0)), ((-3, 31.95, 8.2), (3, 32.2, 8.38))):
        S.box('window', lo, hi, F, r=0.04, col=False)
    S.box('window', (-3.45, 31.3, 5.4), (3.45, 32.0, 5.6), F, r=0.05, name='window_sill')
    S.box('window_glass', (-2.95, 32.08, 5.75), (2.95, 32.12, 10.85), 'kn_glass', r=0.0, name='window_glass',
          phys='glass')
    S.collider('window_frame', (-3.25, 31.8, 5.45), (3.25, 32.35, 5.75), 'powder')


def fridge(S):
    """X -12.5..-8, Y 28.5..32, 9.0 m: Bone body, freezer + main door, chrome bar handles, 4 Amber magnets."""
    x0, x1, y0, y1 = -12.5, -8.0, 28.5, 32.0
    S.box('fridge', (x0, y0 + 0.15, 0.3), (x1, y1, 9.0), 'kn_powder_bone', r=0.18, name='fridge')
    S.box('fridge', (x0 + 0.15, y0 + 0.3, 0.0), (x1 - 0.15, y1, 0.3), 'kn_powder_graphite', r=0.02, col=False)
    S.box('fridge_doors', (x0 + 0.03, y0, 6.25), (x1 - 0.03, y0 + 0.2, 8.95), 'kn_powder_bone', r=0.12, col=False)
    S.box('fridge_doors', (x0 + 0.03, y0, 0.35), (x1 - 0.03, y0 + 0.2, 6.15), 'kn_powder_bone', r=0.12, col=False)
    k = S.kit('fridge_handles')
    sides = max(8, int(20 * S.q))
    for z0, z1 in ((6.6, 8.6), (3.2, 5.8)):
        hx = x1 - 0.45
        k.sweep([(hx, y0 + 0.15, z0), (hx, y0 - 0.25, z0 + 0.1), (hx, y0 - 0.25, z1 - 0.1), (hx, y0 + 0.15, z1)],
                0.09, sides, 'kn_chrome')
        S.collider('fridge_handle', (hx - 0.09, y0 - 0.34, z0 - 0.09), (hx + 0.09, y0 + 0.15, z1 + 0.09), 'steel')
    for (mx, mz) in ((-11.6, 7.8), (-10.6, 7.3), (-11.2, 4.9), (-10.0, 3.9)):
        m = frame((mx, y0 - 0.0, mz), (0, -1, 0))
        S.kit('fridge_magnets').cyl(0.2, 0.0, 0.07, 'kn_powder_amber', max(8, int(24 * S.q)), bev=0.03,
                                    bseg=max(1, S.cs(2)), m=m)


def stove(S):
    """Left wall X -32..-29, Y -2..2, top 4.6: Graphite body and hob, Ignition knobs (1.3x), glass oven door."""
    M = run_frame('left', -2.0)
    S.box('stove', (0, 0.0, 0.0), (4.0, 3.0, 4.3), 'kn_powder_graphite', r=0.06, name='stove', M=M)
    S.box('stove', (0, -0.05, 4.3), (4.0, 3.0, 4.6), 'kn_powder_graphite', r=0.05, name='stove_hob', M=M)
    for bx, by in ((1.0, 0.9), (3.0, 0.9), (1.0, 2.1), (3.0, 2.1)):
        p = M @ Vector((bx, by, 0))
        k = S.kit('stove_burners')
        k.torus(0.42, 0.06, 'kn_steel_brushed', max(12, int(32 * S.q)), max(4, int(8 * S.q)), m=at(p.x, p.y, 4.62))
        k.cyl(0.18, 4.58, 4.7, 'kn_powder_graphite', max(8, int(20 * S.q)), bev=0.03, m=at(p.x, p.y, 0))
    for i, kx in enumerate((0.7, 1.55, 2.45, 3.3)):
        p = M @ Vector((kx, 0.0, 3.92))
        m = frame((p.x, p.y, p.z), (1, 0, 0))
        S.kit('stove_knobs').cyl(0.17, 0.0, 0.2, 'kn_powder_ignition', max(10, int(28 * S.q)), bev=0.05,
                                 bseg=max(1, S.cs(2)), m=m)
    S.collider('stove_knobs', M @ Vector((0.5, -0.2, 3.75)), M @ Vector((3.5, 0.0, 4.09)), 'powder')
    S.box('stove_door', (0.35, -0.06, 0.6), (3.65, 0.02, 3.3), 'kn_glass', r=0.04, col=False, M=M)
    S.box('stove_door', (0.5, -0.32, 3.42), (3.5, -0.06, 3.58), 'kn_steel_brushed', r=0.06, name='stove_handle',
          phys='steel', M=M)


def island(S):
    """Centre (+6, +10), 10 x 5 m, top 4.6: Walnut top, Bone sides, Oak toe kick."""
    S.box('island', (1.3, 7.8, 0.45), (10.7, 12.2, 4.3), 'kn_powder_bone', r=0.06, name='island_base')
    S.box('island', (1.6, 8.1, 0.0), (10.4, 11.9, 0.45), 'kn_wood_oak', r=0.02, col=False)
    S.collider('island_toe', (1.6, 8.1, 0.0), (10.4, 11.9, 0.45), 'wood')
    S.box('island', (1.0, 7.5, 4.3), (11.0, 12.5, 4.6), 'kn_wood_walnut', r=0.06, phys='wood', name='island_top')
    for i in range(3):
        x = 1.6 + i * 3.1
        S.box('island_panels', (x, 7.74, 0.7), (x + 2.9, 7.8, 4.05), 'kn_powder_bone', r=0.03, col=False)


def table_and_chairs(S):
    """Dining table centre (+16, -14), 8 x 4.5 m, top 3.75 (Oak); 4 chairs, Cobalt seats at Z 2.3."""
    cx, cy = 16.0, -14.0
    S.box('table', (cx - 4, cy - 2.25, 3.5), (cx + 4, cy + 2.25, 3.75), 'kn_wood_oak', r=0.06, phys='wood',
          name='table_top')
    for sx in (-1, 1):
        for sy in (-1, 1):
            lx, ly = cx + sx * 3.55, cy + sy * 1.8
            S.box('table', (lx - 0.18, ly - 0.18, 0.0), (lx + 0.18, ly + 0.18, 3.5), 'kn_wood_oak', r=0.05,
                  phys='wood', name='table_leg')
    for x in (cx - 2, cx + 2):
        for side in (-1, 1):
            y = cy + side * 4.4          # seat centre, 4.4 m from the table centre line
            back = y + side * 1.0        # backrest on the far side from the table
            S.box('chairs', (x - 1.1, y - 1.1, 2.08), (x + 1.1, y + 1.1, 2.3), 'kn_wood_oak', r=0.05, phys='wood',
                  name='chair_seat')
            S.box('chair_cushions', (x - 1.0, y - 1.0, 2.3), (x + 1.0, y + 1.0, 2.42), 'kn_fabric_cobalt', r=0.06,
                  col=False)
            S.box('chairs', (x - 1.1, min(back, back + side * 0.22), 2.3), (x + 1.1, max(back, back + side * 0.22),
                                                                            4.7),
                  'kn_wood_oak', r=0.05, phys='wood', name='chair_back')
            for lx in (x - 0.95, x + 0.95):
                for ly in (y - 0.95, y + 0.95):
                    S.box('chairs', (lx - 0.12, ly - 0.12, 0.0), (lx + 0.12, ly + 0.12, 2.08), 'kn_wood_oak',
                          r=0.04, phys='wood', name='chair_leg')
    # rug under the table: flat, part of the floor (render only)
    S.box('rug', (cx - 6, cy - 4, 0.0), (cx + 6, cy + 4, 0.03), 'kn_fabric_cobalt', r=0.01, col=False)


def mixer(S):
    """Stand mixer on the back counter at X +14 (Ignition body, steel bowl)."""
    x, y, z = 14.0, 30.3, 4.6
    S.box('mixer', (x - 0.55, y - 0.9, z), (x + 0.55, y + 0.9, z + 0.25), 'kn_powder_ignition', r=0.1,
          name='mixer_base')
    S.box('mixer', (x - 0.35, y + 0.3, z + 0.25), (x + 0.35, y + 0.85, z + 1.45), 'kn_powder_ignition', r=0.15,
          name='mixer_column')
    S.box('mixer', (x - 0.42, y - 0.75, z + 1.35), (x + 0.42, y + 0.85, z + 1.85), 'kn_powder_ignition', r=0.2,
          name='mixer_head')
    prof = [(0.0, 0.0, 'kn_steel_brushed'), (0.3, 0.0, 'kn_steel_brushed'), (0.45, 0.25, 'kn_steel_brushed'),
            (0.5, 0.75, 'kn_steel_brushed'), (0.46, 0.78, 'kn_steel_brushed'), (0.0, 0.78, 'kn_steel_brushed')]
    S.lathe('mixer_bowl', (x, y - 0.2, z + 0.25), prof)
    S.collider('mixer_bowl', (x - 0.5, y - 0.7, z + 0.25), (x + 0.5, y + 0.3, z + 1.03), 'steel')
    S.kit('mixer_bowl').cyl(0.06, z + 1.0, z + 1.36, 'kn_steel_brushed', max(8, int(12 * S.q)), m=at(x, y - 0.2, 0))


def kettle(S):
    """Back counter X -20: Beam body, rubber handle, spout."""
    x, y, z = -20.0, 30.6, 4.6
    prof = [(0.0, 0.0, 'kn_powder_beam'), (0.48, 0.0, 'kn_powder_beam'), (0.55, 0.12, 'kn_powder_beam'),
            (0.55, 0.75, 'kn_powder_beam'), (0.42, 1.0, 'kn_powder_beam'), (0.18, 1.1, 'kn_powder_beam'),
            (0.0, 1.12, 'kn_powder_beam')]
    S.lathe('kettle', (x, y, z), prof)
    S.collider('kettle', (x - 0.55, y - 0.55, z), (x + 0.55, y + 0.55, z + 1.12), 'powder')
    k = S.kit('kettle')
    sides = max(8, int(16 * S.q))
    k.sweep([(x, y + 0.35, z + 1.0), (x, y + 0.3, z + 1.45), (x, y - 0.3, z + 1.45), (x, y - 0.35, z + 1.0)], 0.07,
            sides, 'kn_rubber')
    S.collider('kettle_handle', (x - 0.08, y - 0.42, z + 1.0), (x + 0.08, y + 0.42, z + 1.53), 'rubber')
    k.sweep([(x, y - 0.45, z + 0.35), (x, y - 0.75, z + 0.7), (x, y - 0.85, z + 0.85)], 0.09, sides,
            'kn_powder_beam', radii=[0.12, 0.08, 0.06])
    S.collider('kettle_spout', (x - 0.12, y - 0.92, z + 0.25), (x + 0.12, y - 0.45, z + 0.92), 'powder')


def small_props(S):
    # cereal box "MORNING CRUNCH" (invented brand), back counter X +20. M3 pass: re-dressed as the kit box (same
    # 1.0 x 0.35 x 1.5 m at 5 : 1), the collider is the M2 one, unchanged
    dress(S, 'cereal_box', place(20.0, 30.975, 4.6, 0.0, 5.0), 0)
    S.collider('cereal_box', (19.5, 30.8, 4.6), (20.5, 31.15, 6.1), 'paper')
    # dish rack with 4 plates, right of the sink
    S.box('dish_rack', (3.9, 29.75, 4.6), (6.15, 31.25, 4.72), 'kn_steel_brushed', r=0.03, phys='steel',
          name='dish_rack')
    k = S.kit('dish_rack')
    sides = max(6, int(10 * S.q))
    for xx in (4.0, 6.05):
        for yy in (29.85, 31.15):
            k.cyl(0.03, 4.72, 5.3, 'kn_steel_brushed', sides, m=at(xx, yy, 0))
    for yy in (29.85, 31.15):
        k.sweep([(4.0, yy, 5.3), (6.05, yy, 5.3)], 0.03, sides, 'kn_steel_brushed')
    for i in range(4):
        px = 4.4 + i * 0.45
        m = frame((px, 30.5, 4.72 + 0.56), (1, 0, 0))
        S.kit('plates').cyl(0.55, -0.04, 0.04, 'kn_ceramic_bone', max(12, int(36 * S.q)), bev=0.03,
                            bseg=max(1, S.cs(2)), m=m)
        S.collider('plate', (px - 0.04, 29.95, 4.72), (px + 0.04, 31.05, 5.84), 'ceramic')
    # spice jars x6 (glass, Graphite lids), back counter X +24..+27
    for i in range(6):
        jx = 24.2 + i * 0.5
        S.cyl('spices', (jx, 31.45), 0.125, 4.6, 5.05, 'kn_glass', bev=0.03, phys='glass', name='spice_jar')
        S.cyl('spice_lids', (jx, 31.45), 0.13, 5.05, 5.14, 'kn_powder_graphite', bev=0.02, col=False)
    # cookie jar, left counter Y +20 (Plasma ceramic, Oak lid)
    prof = [(0.0, 0.0, 'kn_ceramic_plasma'), (0.42, 0.0, 'kn_ceramic_plasma'), (0.5, 0.15, 'kn_ceramic_plasma'),
            (0.5, 0.85, 'kn_ceramic_plasma'), (0.4, 0.95, 'kn_ceramic_plasma'), (0.0, 0.95, 'kn_ceramic_plasma')]
    S.lathe('cookie_jar', (-30.5, 20.0, 4.6), prof)
    S.cyl('cookie_jar', (-30.5, 20.0), 0.44, 5.55, 5.65, 'kn_wood_oak', bev=0.03, col=False)
    S.kit('cookie_jar').sphere(0.1, 'kn_wood_oak', max(8, int(16 * S.q)), max(4, int(8 * S.q)),
                               m=at(-30.5, 20.0, 5.72))
    S.collider('cookie_jar', (-31.0, 19.5, 4.6), (-30.0, 20.5, 5.82), 'ceramic')
    # potted herb on the sill
    prof = [(0.0, 0.0, 'kn_ceramic_ignition'), (0.2, 0.0, 'kn_ceramic_ignition'), (0.28, 0.45, 'kn_ceramic_ignition'),
            (0.32, 0.5, 'kn_ceramic_ignition'), (0.26, 0.5, 'kn_ceramic_ignition'), (0.0, 0.42, 'kn_ceramic_ignition')]
    S.lathe('herb', (1.8, 31.65, 5.6), prof)
    S.collider('herb_pot', (1.48, 31.33, 5.6), (2.12, 31.97, 6.1), 'ceramic')
    k = S.kit('herb')
    for dx, dy, dz, r in ((0, 0, 0.75, 0.3), (0.22, 0.05, 0.62, 0.22), (-0.2, -0.05, 0.66, 0.24),
                          (0.05, -0.15, 0.95, 0.2), (-0.05, 0.14, 0.92, 0.2)):
        k.sphere(r, 'kn_env_foliage', max(8, int(14 * S.q)), max(4, int(8 * S.q)), m=at(1.8 + dx, 31.65 + dy, 5.6 + dz),
                 sz_top=0.8, sz_bot=0.7)
    # cat bowl "MOCHI" (gag; the name decal is deferred), on the floor by the fridge
    prof = [(0.0, 0.0, 'kn_ceramic_bone'), (0.34, 0.0, 'kn_ceramic_bone'), (0.375, 0.2, 'kn_ceramic_bone'),
            (0.35, 0.25, 'kn_ceramic_bone'), (0.3, 0.25, 'kn_ceramic_bone'), (0.28, 0.1, 'kn_ceramic_bone'),
            (0.0, 0.08, 'kn_ceramic_bone')]
    S.lathe('cat_bowl', (-10.0, 26.0, 0.0), prof)
    S.collider('cat_bowl', (-10.375, 25.625, 0.0), (-9.625, 26.375, 0.25), 'ceramic')
    # wall clock above the doorway (out of reach: no collider)
    m = frame((-31.95, -28.0, 12.0), (1, 0, 0))
    k = S.kit('clock')
    k.cyl(0.75, 0.0, 0.12, 'kn_powder_graphite', max(16, int(48 * S.q)), bev=0.05, bseg=max(1, S.cs(2)), m=m)
    k.cyl(0.66, 0.1, 0.14, 'kn_powder_bone', max(16, int(48 * S.q)), m=m)
    for ang, ln in ((60, 0.45), (-30, 0.6)):
        a = math.radians(ang)
        c = Vector((-31.79, -28.0 + math.sin(a) * ln / 2, 12.0 + math.cos(a) * ln / 2))
        k.sweep([(-31.79, -28.0, 12.0), (-31.79, -28.0 + math.sin(a) * ln, 12.0 + math.cos(a) * ln)], 0.03, 4,
                'kn_powder_graphite')
        _ = c
    # fruit bowl with 5 oranges on the island
    bx, by, bz = 6.0, 10.0, 4.6
    prof = [(0.0, 0.0, 'kn_ceramic_bone'), (0.32, 0.0, 'kn_ceramic_bone'), (0.62, 0.22, 'kn_ceramic_bone'),
            (0.7, 0.38, 'kn_ceramic_bone'), (0.64, 0.38, 'kn_ceramic_bone'), (0.56, 0.24, 'kn_ceramic_bone'),
            (0.0, 0.08, 'kn_ceramic_bone')]
    S.lathe('fruit_bowl', (bx, by, bz), prof)
    S.collider('fruit_bowl_base', (bx - 0.4, by - 0.4, bz), (bx + 0.4, by + 0.4, bz + 0.1), 'ceramic')
    for lo, hi in (((-0.7, -0.7, 0), (0.7, -0.55, 0.38)), ((-0.7, 0.55, 0), (0.7, 0.7, 0.38)),
                   ((-0.7, -0.55, 0), (-0.55, 0.55, 0.38)), ((0.55, -0.55, 0), (0.7, 0.55, 0.38))):
        S.collider('fruit_bowl_rim', (bx + lo[0], by + lo[1], bz + lo[2]), (bx + hi[0], by + hi[1], bz + hi[2]),
                   'ceramic')
    for i, (ox, oy, oz) in enumerate(((-0.22, -0.12, 0.27), (0.2, -0.16, 0.27), (0.02, 0.22, 0.27),
                                      (-0.05, -0.02, 0.6), (0.24, 0.16, 0.5))):
        c = (bx + ox, by + oy, bz + oz)
        S.kit('oranges').sphere(0.19, 'kn_powder_ignition', max(10, int(24 * S.q)), max(6, int(14 * S.q)),
                                m=at(*c))
        S.sphere_col('orange', c, 0.19, 'rubber')
    # pendant lamps x3 over the island, hung from a Graphite rail at Z 25 (above the Warehouse bounds)
    S.box('lamp_rail', (-32, 9.9, 25.0), (32, 10.1, 25.25), 'kn_powder_graphite', r=0.04, col=False)
    for lx in (3.0, 6.0, 9.0):
        k = S.kit('pendants')
        sides = max(8, int(32 * S.q))
        k.cyl(0.025, 9.5, 25.0, 'kn_powder_graphite', max(4, int(6 * S.q)), m=at(lx, 10.0, 0))
        prof = [(0.0, 9.55, 'kn_powder_amber'), (0.12, 9.55, 'kn_powder_amber'), (0.6, 8.85, 'kn_powder_amber'),
                (0.62, 8.8, 'kn_powder_amber'), (0.0, 8.95, 'kn_powder_amber')]
        k.lathe(prof, sides, m=at(lx, 10.0, 0))
        k.sphere(0.16, 'kn_powder_bone', max(8, int(16 * S.q)), max(4, int(8 * S.q)), m=at(lx, 10.0, 8.92))


def dress(S, name, M, variant=0, seed=0):
    """M3 maximalism pass (environments.md §2.8): a kit prop, render only. It never adds a collider: every
    placement is flush on a face that has one, on top of the fridge / uppers, outside the active bounds, or
    re-dresses an M2 prop in place and reuses its collider."""
    build_prop(name, S.kit('dress_' + name), M, S.lod, variant, None, seed)


def on_wall(x, y, z, facing, scale=KS):
    """Wall-mounted kit prop (back on the face, facing into the room) at 5 : 1."""
    yaw = {'-y': 0.0, '+x': 90.0, '-x': -90.0}[facing]
    return place(x, y, z, yaw, scale)


def flat_on_wall(x, y, z, facing, spin=0.0, scale=KS):
    """A flat (face-up) kit prop such as a paper sheet turned onto a vertical face."""
    return on_wall(x, y, z, facing, 1.0) @ Matrix.Rotation(math.radians(90), 4, 'X') @ \
        Matrix.Rotation(math.radians(spin), 4, 'Z') @ Matrix.Scale(scale, 4)


def maximalism(S):
    """The M3 "science class maximalism" dressing (D78, environments.md §2.8), visual only."""
    import random
    rng = random.Random(8)
    fy = 28.5 - 0.002                       # fridge door fronts (door boxes start at y 28.5)
    # fridge: 20 magnets and 6 kids' drawings (paper sheets, crayon / sketch)
    taken = [(-11.6, 7.8), (-10.6, 7.3), (-11.2, 4.9), (-10.0, 3.9)]
    drawings = ((-11.45, 2.3, -4, 0), (-9.55, 2.1, 5, 1), (-10.5, 4.15, 3, 0), (-11.55, 6.0, -6, 0),
                (-9.45, 5.6, 4, 1), (-10.4, 7.75, -2, 0))
    for x, z, spin, v in drawings:
        dress(S, 'paper_sheet', flat_on_wall(x, fy, z, '-y', spin), v)
        taken.append((x, z))
    n = 0
    while n < 20:
        x, z = rng.uniform(-12.2, -8.85), rng.uniform(1.0, 8.7)
        if 6.0 < z < 6.5 or any(abs(x - a) < 0.45 and abs(z - b) < 0.55 for a, b in taken):
            continue
        dress(S, 'magnet', on_wall(x, fy, z - 0.15, '-y'), n % 6)
        taken.append((x, z))
        n += 1
    # a crayon drawing taped to the upper cabinet door left of the window
    dress(S, 'paper_sheet', flat_on_wall(-5.5, 30.32 - 0.002, 8.55, '-y', 3), 0)
    # on top of the fridge: three cereal boxes and two cookbooks; on top of the uppers: trailing plants + crate
    for i, (x, yaw) in enumerate(((-11.7, 8), (-10.55, -4), (-9.45, 12))):
        dress(S, 'cereal_box', place(x, 30.4, 9.0, yaw, KS), i)
    for i, x in enumerate((22.0, 28.5)):
        dress(S, 'plant_trailing', place(x, 30.95, 9.75, 0, KS), i % 2)
    for x in (-28.0, -20.5, 6.5):
        dress(S, 'plant_trailing', place(x, 30.95, 9.75, 10, KS), 0)
    dress(S, 'crate', place(-15.0, 31.1, 9.75, 4, KS), 1)
    # the cookbook and mug shelf, above the uppers (Z >= 9.75, out of reach)
    for x in (15.0, 20.0):
        dress(S, 'wall_shelf', on_wall(x, 32.0, 10.4, '-y'))
    top = 10.4 + 0.225 * KS
    x = 12.8
    for v in (7, 10, 13, 16, 4, 19, 22, 1):
        h, d, t = ((0.20, 0.14, 0.024), (0.25, 0.18, 0.034), (0.30, 0.22, 0.045))[v % 3]
        dress(S, 'book', place(x + t * KS / 2, 32.0 - 0.06 - d * KS / 2, top, 0, KS), v)
        x += t * KS + 0.02
    for i, x in enumerate((17.4, 18.3, 19.2)):
        dress(S, 'mug', place(x, 31.45, top, 30 * i, KS), i + 1)
    dress(S, 'jar', place(21.2, 31.45, top, 0, KS), 2)
    # utensils on a rail on the left wall above the stove; a tea towel over the oven-door rail
    dress(S, 'utensil_rail', on_wall(-32.0, 0.0, 8.1, '+x'))
    dress(S, 'tea_towel', place(-28.81, 0.6, 3.58, 90, KS), 1)
    # calendar and notes beside the doorway
    for i, (y, z, v) in enumerate(((-22.6, 7.6, 3), (-21.4, 8.2, 1), (-22.0, 5.9, 0))):
        dress(S, 'paper_sheet', flat_on_wall(-32.0 + 0.002, y, z, '+x', (-5, 4, 2)[i]), v)
    # a tall plant by the doorway (outside the Room bounds)
    dress(S, 'plant_tall', place(-27.0, -25.5, 0.0, 30, KS))
    # the fruit bowl re-dressed: two apples and a banana among the M2 oranges (their colliders stay)
    bx, by, bz = 6.0, 10.0, 4.6
    k = S.kit('dress_fruit')
    for (ox, oy, oz) in ((0.3, -0.05, 0.3), (-0.28, 0.2, 0.3)):
        k.sphere(0.2, 'kn_ceramic_plasma', max(10, int(24 * S.q)), max(6, int(14 * S.q)), m=at(bx + ox, by + oy, bz + oz),
                 sz_top=0.9, sz_bot=0.85)
        k.cyl(0.02, 0.17, 0.27, 'kn_wood_walnut', 6, m=at(bx + ox, by + oy, bz + oz))
    pts = [(bx - 0.45 + 0.9 * t / 6, by - 0.32 + 0.12 * math.sin(math.pi * t / 6), bz + 0.48 + 0.12 * math.sin(math.pi * t / 6))
           for t in range(7)]
    k.sweep(pts, 0.09, max(6, int(12 * S.q)), 'kn_powder_amber', radii=[0.03, 0.07, 0.09, 0.095, 0.09, 0.07, 0.03])


def backdrop(S):
    """Outside the bounds, never collides: garden + sky behind the window, a dark hallway past the doorway."""
    # kept below the 13.5 m wall top so the open-top cutaway shows only the haze dome above the set
    S.box('sky', (-16, 40, -2), (16, 40.5, 13.2), 'kn_env_backdrop', r=0.0, col=False, group='backdrop')
    S.box('garden', (-16, 32.4, -1.0), (16, 40, 2.5), 'kn_env_foliage', r=0.3, col=False, group='backdrop')
    S.box('fence', (-16, 37.5, 2.5), (16, 37.8, 6.5), 'kn_wood_oak', r=0.1, col=False, group='backdrop')
    k = S.kit('bushes', 'backdrop')
    for i, (x, y, z, r) in enumerate(((-7, 35.5, 4, 2.6), (-2.5, 36.5, 5.0, 2.4), (2.5, 35, 4.5, 2.6),
                                      (7, 36, 5, 2.8), (11, 35, 4, 2.0), (-11, 36, 4.5, 2.2), (4, 38.5, 8, 3.2),
                                      (-4, 38.8, 8.5, 3.4))):
        k.sphere(r, 'kn_env_foliage', max(8, int(20 * S.q)), max(5, int(12 * S.q)), m=at(x, y, z), sz_top=0.85,
                 sz_bot=0.6)
    S.box('hallway', (-44, -34, 0), (-32.4, -22, -0.0 + 0.02), 'kn_powder_graphite', r=0.0, col=False,
          group='backdrop')
    S.box('hallway', (-44, -34, 0), (-43.6, -22, 11), 'kn_powder_graphite', r=0.0, col=False, group='backdrop')
    S.box('hallway', (-44, -22.4, 0), (-32.4, -22, 11), 'kn_powder_graphite', r=0.0, col=False, group='backdrop')
    S.box('hallway', (-44, -34, 10.6), (-32.4, -22, 11), 'kn_powder_graphite', r=0.0, col=False, group='backdrop')


def scale_refs(S):
    """env_scale_ref per preset (environments.md §0.7): 1 m stick on a foot, 0.40 x 0.40 x 0.45 plinth, a THUD."""
    for preset, p in PRESETS.items():
        x, y, _ = p['scale_ref']
        g = 'ref_' + preset
        S.box('plinth', (x - 0.2, y - 0.2, 0.0), (x + 0.2, y + 0.2, 0.45), 'kn_powder_graphite', r=0.012,
              group=g, name='scale_ref_plinth', preset=preset)
        S.box('plinth', (x - 0.18, y - 0.18, 0.445), (x + 0.18, y + 0.18, 0.455), 'kn_powder_bone', r=0.003,
              col=False, group=g)
        tz = 0.45 - 0.015 + 0.11
        k = S.kit('thud', g)
        k.sphere(0.11, 'kn_powder_graphite', max(12, int(40 * S.q)), max(8, int(20 * S.q)), m=at(x, y, tz))
        k.torus(0.108, 0.007, 'kn_powder_ignition', max(12, int(40 * S.q)), 6, m=at(x, y, tz))
        S.sphere_col('scale_ref_thud', (x, y, tz), 0.11, 'powder', preset)
        sx = x + 0.35
        S.box('stick', (sx - 0.06, y - 0.06, 0.0), (sx + 0.06, y + 0.06, 0.02), 'kn_powder_graphite', r=0.003,
              group=g, name='scale_ref_foot', preset=preset)
        for b in range(10):
            mat = 'kn_powder_ignition' if b == 5 else ('kn_powder_bone' if b % 2 == 0 else 'kn_powder_graphite')
            S.box('stick', (sx - 0.02, y - 0.01, 0.02 + b * 0.1), (sx + 0.02, y + 0.01, 0.02 + (b + 1) * 0.1),
                  mat, r=0.003, col=False, group=g)
        S.collider('scale_ref_stick', (sx - 0.02, y - 0.01, 0.02), (sx + 0.02, y + 0.01, 1.02), 'powder', None,
                   preset)


def build(lod):
    S = SetBuilder(lod)
    floor(S)
    walls(S)
    window(S)
    # back counter run Y +29..+32 (fridge gap X -12.5..-8), the sink at X -2..+2, Y +29.5..+31.5, 1.1 m deep
    counter_run(S, 'counter_back', 'back', -32.0, -12.5)
    counter_run(S, 'counter_back', 'back', -8.0, 32.0, sink=(6.0, 10.0, 0.5, 2.5, 1.1))
    # left counter X -32..-29, Y -24..+29 with the stove at Y -2..+2 (joined to the back run at the corner)
    counter_run(S, 'counter_left', 'left', -24.0, -2.0)
    counter_run(S, 'counter_left', 'left', 2.0, 29.0)
    stove(S)
    for x0, x1 in ((-32.0, -12.5), (-8.0, -3.0), (3.0, 32.0)):
        upper_cabinets(S, x0, x1)
    sink_and_tap(S)
    fridge(S)
    island(S)
    table_and_chairs(S)
    mixer(S)
    kettle(S)
    small_props(S)
    maximalism(S)
    backdrop(S)
    scale_refs(S)
    return S


# ---------------------------------------------------------------- scene, export, data

def to_objects(S, mats, cols):
    out = []
    for (group, piece), k in S.pieces.items():
        clean(k.bm)
        if not k.bm.faces:
            k.free()
            continue
        if group == 'set':
            col = cols['LOD%d' % S.lod]
            name = 'env_kitchen__%s%s' % (piece, '' if S.lod == 0 else '__L%d' % S.lod)
        elif group == 'backdrop':
            if S.lod != 0:
                k.free()
                continue
            col = cols['BACKDROP']
            name = 'env_kitchen__bd_%s' % piece
        else:
            col = cols['REF__%s' % group[4:]] if S.lod == 0 else None
            if col is None:
                k.free()
                continue
            name = 'env_kitchen__%s_%s' % (group, piece)
        ob = geom.object_from_bmesh(name, k.bm, [mats[m] for m in k.mats], col)
        geom.set_sharp_by_angle(ob.data, 40)
        out.append(ob)
    return out


def tri_count(objs):
    t = 0
    for ob in objs:
        ob.data.calc_loop_triangles()
        t += len(ob.data.loop_triangles)
    return t


def eng(v):
    """Blender set (x, y, z) -> engine (x, z, -y), rounded."""
    return [round(float(v[0]), 4) + 0.0, round(float(v[2]), 4) + 0.0, round(-float(v[1]), 4) + 0.0]


def eng_box(b, off=(0, 0, 0)):
    lo, hi = Vector(b['lo']) - Vector(off), Vector(b['hi']) - Vector(off)
    a, c = eng(lo), eng(hi)
    mn = [min(a[i], c[i]) for i in range(3)]
    mx = [max(a[i], c[i]) for i in range(3)]
    centre = [round((mn[i] + mx[i]) / 2, 4) + 0.0 for i in range(3)]
    half = [round((mx[i] - mn[i]) / 2, 4) + 0.0 for i in range(3)]
    return centre, half


def env_data(S0):
    data = {'env': 'kitchen', 'scale': 5, 'gravity': 'earth', 'air': 1.0, 'feel': 'real',
            'glb': 'env/kitchen/kitchen.glb', 'presets': {}}
    for preset, p in PRESETS.items():
        off = Vector(p['origin'])
        bl, bh = p['bounds']
        nl, nh = p['neutral']
        boxes = []
        for b in S0.boxes:
            if b['preset'] not in (None, preset):
                continue
            c, h = eng_box(b, off)
            boxes.append({'name': b['name'], 'center': c, 'half': h, 'phys': b['phys']})
        spheres = [{'name': s['name'], 'center': eng(s['c'] - off), 'radius': s['r'], 'phys': s['phys']}
                   for s in S0.spheres if s['preset'] in (None, preset)]
        bc, bhalf = eng_box({'lo': bl, 'hi': bh}, off)
        nc, nhalf = eng_box({'lo': nl, 'hi': (nh[0], nh[1], 0.0)}, off)
        data['presets'][preset] = {
            'origin': eng(off),
            'bounds': {'min': [round(bc[i] - bhalf[i], 4) + 0.0 for i in range(3)],
                       'max': [round(bc[i] + bhalf[i], 4) + 0.0 for i in range(3)]},
            'neutral': {'min': [round(nc[i] - nhalf[i], 4) + 0.0 for i in range(3)],
                        'max': [round(nc[i] + nhalf[i], 4) + 0.0 for i in range(3)]},
            'camera': eng(Vector(p['camera']) - off), 'target': eng(Vector(p['target']) - off),
            'drones': [eng(Vector(d) - off) for d in p['drones']],
            'scaleRef': eng(Vector(p['scale_ref']) - off),
            'boxes': boxes, 'spheres': spheres,
        }
    data['light'] = {'sunElevationDeg': 22, 'sunFrom': 'back (+Y set, -Z engine), 20 deg toward +X',
                     'sunDir': [round(v, 4) for v in sun_dir_engine()], 'sunKelvin': 4300, 'sunLux': 60000,
                     'windowSky': '#CFE6FF', 'hazeDensity': 0.012, 'hazeAnisotropy': 0.6, 'ev100': 10.5,
                     'underCabinetKelvin': 3000, 'shaftsMinTierGB': 12, 'lowTierHaze': 0.004}
    return data


def sun_dir_engine():
    """Direction the sunlight travels, engine space: from +Y (through the window), 20 deg toward +X, 22 deg up."""
    el, az = math.radians(22), math.radians(20)
    src = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))  # set, toward the sun
    d = -src
    return eng(d)


def ts_literal(v, ind=0):
    pad = '  ' * ind
    if isinstance(v, dict):
        items = []
        for k, x in v.items():
            items.append('%s  %s: %s' % (pad, k, ts_literal(x, ind + 1)))
        return '{\n' + ',\n'.join(items) + ',\n' + pad + '}'
    if isinstance(v, list):
        if all(isinstance(x, (int, float)) for x in v):
            return '[' + ', '.join(_num(x) for x in v) + ']'
        if not v:
            return '[]'
        return '[\n' + ',\n'.join(pad + '  ' + ts_literal(x, ind + 1) for x in v) + ',\n' + pad + ']'
    if isinstance(v, str):
        return json.dumps(v).replace('"', "'")
    return _num(v)


def _num(x):
    if isinstance(x, bool):
        return 'true' if x else 'false'
    if isinstance(x, int):
        return str(x)
    s = repr(round(float(x), 4))
    if s.endswith('.0'):
        s = s[:-2]
    return '0' if s == '-0' else s


def write_ts(path, data, stats):
    presets = data['presets']
    lines = [
        '// GENERATED by tools/blender/env_kitchen.py (`node tools/assets.mjs --env kitchen`). Do not edit by hand.',
        '// MEGA KITCHEN (art/briefs/environments.md §2), contract 5 of docs/dev/M2_PLAN.md: the static colliders,',
        '// neutral build zone and spawn points, generated from the same table as assets/build/env/kitchen/kitchen.glb.',
        '// Engine space: metres, Y-up, front (default camera side) = +Z. Each preset is in its own world coordinates',
        '// (origin = the preset bounds floor centre); kitchen.glb is authored in Warehouse (set) coordinates, so draw',
        '// it at -origin for the Room preset. Literals only (determinism lint).',
        '// %s' % stats,
        '',
        "export type KitchenPhys = 'powder' | 'wood' | 'ceramic' | 'steel' | 'glass' | 'rubber' | 'paper' | 'fabric';",
        'export type KitchenV3 = readonly [number, number, number];',
        '',
        '/** Static axis-aligned box: centre and half extents (engine metres). */',
        'export interface KitchenBox { readonly name: string; readonly center: KitchenV3; readonly half: KitchenV3; '
        'readonly phys: KitchenPhys }',
        '/** Static sphere (the fruit-bowl oranges, the scale reference THUD). */',
        'export interface KitchenSphere { readonly name: string; readonly center: KitchenV3; readonly radius: number; '
        'readonly phys: KitchenPhys }',
        '',
        'export interface KitchenPreset {',
        '  /** Where this preset\'s world origin sits in set (Warehouse) coordinates; the glb is drawn at -origin. */',
        '  readonly origin: KitchenV3;',
        '  readonly bounds: { readonly min: KitchenV3; readonly max: KitchenV3 };',
        '  /** Neutral build zone (flat, no props; environments.md §0.9), y = floor. */',
        '  readonly neutral: { readonly min: KitchenV3; readonly max: KitchenV3 };',
        '  readonly camera: KitchenV3;',
        '  readonly target: KitchenV3;',
        '  /** Multiplayer drone starts: P1 (-X), P2 (+X). */',
        '  readonly drones: readonly [KitchenV3, KitchenV3];',
        '  /** env_scale_ref placement (environments.md §0.7); its plinth / stick / THUD colliders are in boxes. */',
        '  readonly scaleRef: KitchenV3;',
        '  readonly boxes: readonly KitchenBox[];',
        '  readonly spheres: readonly KitchenSphere[];',
        '}',
        '',
        'export interface KitchenEnv {',
        "  readonly env: 'kitchen';",
        '  /** Set scale (5 : 1); parts and critters stay real size. */',
        '  readonly scale: number;',
        "  readonly gravity: 'earth';",
        '  readonly air: number;',
        "  readonly feel: 'real';",
        '  /** Served at /env/kitchen/kitchen.glb (nodes LOD0..LOD3, BACKDROP, REF__scale__room / __warehouse). */',
        '  readonly glb: string;',
        '  readonly presets: { readonly room: KitchenPreset; readonly warehouse: KitchenPreset };',
        '  /** Look-dev rig (environments.md §2.3) for the renderer. sunDir = direction the light travels. */',
        '  readonly light: {',
        '    readonly sunElevationDeg: number; readonly sunFrom: string; readonly sunDir: KitchenV3;',
        '    readonly sunKelvin: number; readonly sunLux: number; readonly windowSky: string; readonly hazeDensity: number;',
        '    readonly hazeAnisotropy: number; readonly ev100: number; readonly underCabinetKelvin: number;',
        '    /** M3 pass (environments.md §2.8): D79 sun shafts through the window from this tier up; below it a',
        '     *  uniform haze of lowTierHaze / m. */',
        '    readonly shaftsMinTierGB: number; readonly lowTierHaze: number;',
        '  };',
        '}',
        '',
    ]
    body = dict(data)
    lines.append('export const KITCHEN: KitchenEnv = %s;' % ts_literal(body))
    lines.append('')
    lines.append('export const KITCHEN_PRESETS = [%s] as const;' % ', '.join("'%s'" % k for k in presets))
    lines.append('')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    cols = {}
    for name in ('LOD0', 'LOD1', 'LOD2', 'LOD3', 'BACKDROP', 'REF__room', 'REF__warehouse', 'COL', 'BOUNDS',
                 'SPAWN', 'ZONE'):
        c = bpy.data.collections.new('ENV_RENDER' if name == 'LOD0' else name)
        sc.collection.children.link(c)
        cols[name] = c
    return sc, cols


def add_markers(cols, S0):
    """COL / BOUNDS / SPAWN / ZONE helpers in the source .blend (environments.md §0.3), not exported."""
    for b in S0.boxes:
        lo, hi = b['lo'], b['hi']
        me = bpy.data.meshes.new('COL__box__' + b['name'])
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        ob.location = (lo + hi) / 2
        ob.scale = hi - lo
        ob.display_type = 'WIRE'
        ob['phys'] = b['phys']
        if b['preset']:
            ob['preset'] = b['preset']
        cols['COL'].objects.link(ob)
    for preset, p in PRESETS.items():
        for nm, (lo, hi), col in ((('BOUNDS__%s' % preset), p['bounds'], 'BOUNDS'),
                                  (('ZONE__neutral__%s' % preset), (p['neutral'][0], (p['neutral'][1][0],
                                                                                     p['neutral'][1][1], 0.05)),
                                   'ZONE')):
            e = bpy.data.objects.new(nm, None)
            e.empty_display_type = 'CUBE'
            e.location = [(a + b) / 2 for a, b in zip(lo, hi)]
            e.scale = [(b - a) / 2 for a, b in zip(lo, hi)]
            cols[col].objects.link(e)
        for nm, loc in (('SPAWN__camera__' + preset, p['camera']), ('SPAWN__target__' + preset, p['target']),
                        ('SPAWN__drone__p1__' + preset, p['drones'][0]), ('SPAWN__drone__p2__' + preset, p['drones'][1]),
                        ('SPAWN__scale_ref__' + preset, p['scale_ref'])):
            e = bpy.data.objects.new(nm, None)
            e.location = loc
            cols['SPAWN'].objects.link(e)


def export_glb(cols, path):
    sc = bpy.context.scene
    created, sel = [], []
    roots = {'LOD0': 'LOD0', 'LOD1': 'LOD1', 'LOD2': 'LOD2', 'LOD3': 'LOD3', 'BACKDROP': 'BACKDROP',
             'REF__room': 'REF__scale__room', 'REF__warehouse': 'REF__scale__warehouse'}
    for cname, node in roots.items():
        e = bpy.data.objects.new(node, None)
        sc.collection.objects.link(e)
        created.append(e)
        sel.append(e)
        for ob in cols[cname].objects:
            ob.parent = e
            sel.append(ob)
    for ob in sc.objects:
        ob.select_set(ob in sel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False, export_materials='EXPORT', export_image_format='NONE',
                              export_texcoords=False, export_normals=True, export_tangents=False,
                              export_draco_mesh_compression_enable=False, export_skins=False, export_morph=False)
    for ob in sel:
        if ob.parent in created:
            ob.parent = None
    for e in created:
        bpy.data.objects.remove(e)


def main():
    args = _cli.script_args()
    no_ts = _cli.flag(args, '--no-ts')
    no_blend = _cli.flag(args, '--no-blend')
    root = paths.repo_root()
    library.ensure_libs(root)
    load_all()
    sc, cols = setup_scene()
    builds = [build(lod) for lod in range(4)]
    names = sorted({m for S in builds for k in S.pieces.values() for m in k.mats})
    bad = [m for m in names if not is_master_material(m)]
    if bad:
        _cli.die('not master materials: %s' % ', '.join(bad))
    mats = library.link_materials(paths.materials_lib(root), names)
    lod_objs = []
    for S in builds:
        lod_objs.append(to_objects(S, mats, cols))
    S0 = builds[0]
    tris = [tri_count([o for o in objs if o.users_collection[0] == cols['LOD%d' % i]])
            for i, objs in enumerate(lod_objs)]
    bd = tri_count(list(cols['BACKDROP'].objects))
    refs = tri_count(list(cols['REF__room'].objects)) + tri_count(list(cols['REF__warehouse'].objects))
    for i, t in enumerate(tris):
        print('  LOD%d: %d tris (%.1f %%)' % (i, t, 100.0 * t / tris[0]))
    print('  backdrop %d tris, scale refs %d tris, %d collider boxes + %d spheres, %d masters'
          % (bd, refs, len(S0.boxes), len(S0.spheres), len(names)))
    add_markers(cols, S0)
    out_dir = os.path.join(root, 'assets', 'build', 'env', ENV)
    glb = os.path.join(out_dir, 'kitchen.glb')
    if not no_blend:
        src = os.path.join(root, 'assets', 'src', 'env', ENV, 'kitchen_set.blend')
        os.makedirs(os.path.dirname(src), exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=src, compress=True, relative_remap=True)
        print('saved', src)
    export_glb(cols, glb)
    data = env_data(S0)
    stats = 'LOD0..3 tris %s · backdrop %d · %d boxes + %d spheres (Warehouse) · %d masters' % (
        ' / '.join(str(t) for t in tris), bd, len(data['presets']['warehouse']['boxes']),
        len(data['presets']['warehouse']['spheres']), len(names))
    data['stats'] = {'lodTris': tris, 'backdropTris': bd, 'scaleRefTris': refs, 'masters': names}
    with open(os.path.join(out_dir, 'kitchen.env.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    if not no_ts:
        ts_data = {k: v for k, v in data.items() if k != 'stats'}
        write_ts(os.path.join(root, 'packages', 'parts-data', 'src', 'env_kitchen.ts'), ts_data, stats)
    print('exported', glb, '·', stats)


main()
