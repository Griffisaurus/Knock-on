"""BACKLOT set dressing (environments.md §4.3), built with the props-kit context (core.P) but in its own registry:
these are Backlot pieces, not shared `kn_prop_*` kit props. Real scale, Z up, origin = footprint centre on the
ground, front = -Y. Toy style: chunky, bevelled, no real studio names (stage signs are numbers only)."""
import math

from mathutils import Matrix, Vector

from .core import I4, P, at, frame
from .stationery import rot_x, rot_y, rot_z

BACKLOT = {}


def piece(name, cls, budget, variants=1):
    def deco(fn):
        BACKLOT[name] = {'fn': fn, 'cls': cls, 'budget': budget, 'variants': variants,
                         'desc': (fn.__doc__ or '').strip().split('\n')[0]}
        return fn
    return deco


def build_piece(name, kit, M=None, lod=0, variant=0, cols=None, seed=0):
    spec = BACKLOT[name]
    p = P(kit, M, lod, variant % spec['variants'], cols, seed)
    p.cs_base = 1 if spec['cls'] == 'E-S' else 2
    spec['fn'](p)
    return p


@piece('water_tower', 'E-H', 60000)
def water_tower(p):
    """Water tower, 30 m to the tank top: Bone tank with an Ignition band, steel legs and braces, oak catwalk."""
    tz0, tz1, R = 18.0, 27.0, 5.0
    p.cyl((0, 0), R, tz0, tz1, 'kn_powder_bone', segs=48, bev=0.4)
    p.cyl((0, 0), R + 0.06, tz0 + 5.6, tz0 + 6.6, 'kn_powder_ignition', segs=48, bev=0.05)
    p.lathe([(0.0, tz1 - 0.1, 'kn_powder_bone'), (R + 0.3, tz1 - 0.1, 'kn_powder_bone'), (R * 0.4, tz1 + 2.6, 'kn_powder_bone'),
             (0.5, tz1 + 3.0, 'kn_powder_bone'), (0.0, tz1 + 3.1, 'kn_powder_bone')], segs=48)
    p.cyl((0, 0), 0.25, tz1 + 3.0, tz1 + 3.6, 'kn_steel_brushed', segs=12, bev=0.05)
    p.lathe([(0.0, tz0 + 0.2, 'kn_powder_bone'), (R - 0.1, tz0 + 0.2, 'kn_powder_bone'), (1.0, tz0 - 1.6, 'kn_powder_bone'),
             (0.0, tz0 - 1.8, 'kn_powder_bone')], segs=40)
    legs = []
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        top = Vector((R * 0.8 * math.cos(a), R * 0.8 * math.sin(a), tz0))
        bot = Vector((R * 1.25 * math.cos(a), R * 1.25 * math.sin(a), 0.0))
        legs.append((top, bot))
        p.sweep([tuple(bot), tuple(top)], 0.35, 'kn_steel_brushed', sides=12)
        p.cyl((bot.x, bot.y), 0.9, 0.0, 0.6, 'kn_env_concrete', segs=16, bev=0.08)
        p.col_box((bot.x - 0.9, bot.y - 0.9, 0.0), (bot.x + 0.9, bot.y + 0.9, tz0), 'steel')
    for k in range(4):
        (t0, b0), (t1, b1) = legs[k], legs[(k + 1) % 4]
        for f0, f1 in ((0.15, 0.55), (0.55, 0.95)):
            pa, pb = b0.lerp(t0, f0), b1.lerp(t1, f1)
            p.sweep([tuple(pa), tuple(pb)], 0.1, 'kn_steel_brushed', sides=6)
            pa, pb = b1.lerp(t1, f0), b0.lerp(t0, f1)
            p.sweep([tuple(pa), tuple(pb)], 0.1, 'kn_steel_brushed', sides=6)
    p.cyl((0, 0), R + 1.3, tz0 - 0.25, tz0, 'kn_wood_oak', segs=48, bev=0.05)
    p.torus(R + 1.25, 0.06, 'kn_steel_brushed', maj=48, mn=6, m=at(0, 0, tz0 + 1.1))
    for i in range(16):
        a = i / 16 * 2 * math.pi
        p.sweep([((R + 1.25) * math.cos(a), (R + 1.25) * math.sin(a), tz0),
                 ((R + 1.25) * math.cos(a), (R + 1.25) * math.sin(a), tz0 + 1.1)], 0.05, 'kn_steel_brushed', sides=4)
    p.sweep([(R * 1.25 * 0.7, -0.4, 0.0), (R * 0.95, -0.4, tz0)], 0.08, 'kn_steel_brushed', sides=4)
    p.sweep([(R * 1.25 * 0.7, 0.4, 0.0), (R * 0.95, 0.4, tz0)], 0.08, 'kn_steel_brushed', sides=4)
    p.col_cyl((0, 0), R, tz0 - 1.8, tz1 + 3.1, 'steel')
    p.col_box((-R - 1.3, -R - 1.3, tz0 - 0.25), (R + 1.3, R + 1.3, tz0), 'wood')


@piece('light_tower', 'E-L', 12000)
def light_tower(p):
    """18 m lattice light tower with a bank of six Graphite lamp heads (practicals for Dusk / Night)."""
    h, w = 18.0, 1.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.sweep([(sx * w * 0.9, sy * w * 0.9, 0.0), (sx * w * 0.45, sy * w * 0.45, h)], 0.08, 'kn_steel_brushed',
                    sides=6)
    for k in range(9):
        z0, z1 = k * h / 9, (k + 1) * h / 9
        s0, s1 = w * (0.9 - 0.45 * z0 / h), w * (0.9 - 0.45 * z1 / h)
        for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            p.sweep([(ax * s0, ay * s0, z0), (bx * s1, by * s1, z1)], 0.04, 'kn_steel_brushed', sides=4)
    p.box((-1.6, -0.5, h), (1.6, 0.5, h + 0.25), 'kn_powder_graphite', r=0.05)
    for i in range(6):
        cx, cz = -1.1 + (i % 3) * 1.1, h + 0.75 + (i // 3) * 0.95
        p.cyl((0, 0), 0.38, -0.25, 0.25, 'kn_powder_graphite', segs=20, bev=0.06, m=at(cx, 0.0, cz) @ rot_x(90))
        p.cyl((0, 0), 0.3, 0.25, 0.27, 'kn_env_bulb', segs=20, bev=0.0, m=at(cx, 0.0, cz) @ rot_x(90))
    p.box((-1.5, -0.05, h + 0.25), (1.5, 0.05, h + 2.2), 'kn_steel_brushed', r=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl((sx * w * 0.9, sy * w * 0.9), 0.4, 0.0, 0.5, 'kn_env_concrete', segs=12, bev=0.05)
    p.col_box((-w, -w, 0.0), (w, w, h), 'steel')
    p.col_box((-1.6, -0.5, h), (1.6, 0.5, h + 2.2), 'steel')


@piece('trailer', 'E-L', 15000)
def trailer(p):
    """Production trailer: Bone body with rounded ends, steel skirt, door, windows, wheels on a steel chassis."""
    L, W, H = 10.0, 2.6, 2.9
    p.box((-L / 2, -W / 2, 0.8), (L / 2, W / 2, 0.8 + H), 'kn_powder_bone', r=0.45)
    p.box((-L / 2 + 0.3, -W / 2 - 0.02, 0.65), (L / 2 - 0.3, W / 2 + 0.02, 0.9), 'kn_steel_brushed', r=0.05)
    p.box((-L / 2 + 0.4, -W / 2 - 0.03, 2.3), (L / 2 - 0.4, -W / 2 + 0.05, 2.5), 'kn_powder_cobalt', r=0.04)
    p.box((1.5, -W / 2 - 0.04, 0.95), (2.4, -W / 2 + 0.05, 3.0), 'kn_powder_graphite', r=0.05)
    for x in (-3.5, -1.5, 3.6):
        p.box((x - 0.6, -W / 2 - 0.04, 2.6), (x + 0.6, -W / 2 + 0.05, 3.3), 'kn_glass', r=0.06)
    for x in (-1.0, 1.0):
        for y in (-W / 2 + 0.2, W / 2 - 0.2):
            p.cyl((0, 0), 0.45, -0.18, 0.18, 'kn_rubber', segs=20, bev=0.08, m=at(x, y, 0.45) @ rot_x(90))
    p.box((1.6, -W / 2 - 0.9, 0.0), (2.3, -W / 2, 0.6), 'kn_wood_oak', r=0.04)
    p.box((L / 2, -0.12, 0.6), (L / 2 + 1.6, 0.12, 0.75), 'kn_steel_brushed', r=0.03)
    p.col_box((-L / 2, -W / 2, 0.0), (L / 2, W / 2, 0.8 + H), 'powder')
    p.col_box((1.6, -W / 2 - 0.9, 0.0), (2.3, -W / 2, 0.6), 'wood')


@piece('directors_chair', 'E-S', 1500)
def directors_chair(p):
    """Folding director's chair (by the scale reference): oak X-frame, Ignition canvas."""
    for sx in (-1, 1):
        x = sx * 0.27
        p.sweep([(x, -0.22, 0.0), (x, 0.22, 0.48)], 0.018, 'kn_wood_oak', sides=6)
        p.sweep([(x, 0.22, 0.0), (x, -0.22, 0.48)], 0.018, 'kn_wood_oak', sides=6)
        p.sweep([(x, 0.22, 0.0), (x, 0.22, 0.95)], 0.02, 'kn_wood_oak', sides=6)
        p.sweep([(x, -0.22, 0.48), (x, 0.22, 0.65)], 0.015, 'kn_wood_oak', sides=6)
    p.box((-0.27, -0.22, 0.46), (0.27, 0.22, 0.49), 'kn_fabric_ignition', r=0.01)
    p.box((-0.27, 0.2, 0.7), (0.27, 0.235, 0.92), 'kn_fabric_ignition', r=0.01)
    p.col_box((-0.3, -0.25, 0.0), (0.3, 0.25, 0.95), 'wood')


@piece('apple_box', 'E-S', 300, variants=4)
def apple_box(p):
    """Apple boxes: 0 full, 1 half, 2 quarter, 3 pancake (0.5 x 0.3 m footprint), hand-holes as dark slots."""
    h = (0.2, 0.1, 0.05, 0.025)[p.v]
    p.box((-0.255, -0.15, 0.0), (0.255, 0.15, h), 'kn_wood_oak', r=0.006)
    if h >= 0.1:
        for sx in (-1, 1):
            p.box((sx * 0.256 - 0.001, -0.06, h * 0.55), (sx * 0.256 + 0.001, 0.06, h * 0.55 + 0.035), 'kn_wood_walnut',
                  r=0.0)
    p.col_box((-0.255, -0.15, 0.0), (0.255, 0.15, h), 'wood')


@piece('sandbag', 'E-S', 400)
def sandbag(p):
    """Sandbag: a soft Bone pillow with a strap."""
    p.ellipsoid((0, 0, 0.07), (0.3, 0.16, 0.08), 'kn_fabric_bone', segs=14, rings=7)
    p.torus(0.15, 0.012, 'kn_fabric_graphite', maj=14, mn=4, m=at(0, 0, 0.07) @ Matrix.Diagonal((1.0, 1.0, 0.6, 1.0)))
    p.col_box((-0.3, -0.16, 0.0), (0.3, 0.16, 0.15), 'fabric')


@piece('hay_bale', 'E-S', 800)
def hay_bale(p):
    """Hay bale with two twine bands."""
    p.box((-0.55, -0.25, 0.0), (0.55, 0.25, 0.45), 'kn_env_hay', r=0.06)
    for x in (-0.25, 0.25):
        p.box((x - 0.012, -0.252, -0.002), (x + 0.012, 0.252, 0.452), 'kn_rope', r=0.004)
    p.col_box((-0.55, -0.25, 0.0), (0.55, 0.25, 0.45), 'wood')


@piece('fence', 'E-S', 600)
def fence(p):
    """4 m post-and-rail fence section."""
    for x in (-2.0, 0.0, 2.0):
        p.box((x - 0.06, -0.06, 0.0), (x + 0.06, 0.06, 1.15), 'kn_wood_oak', r=0.015)
    for z in (0.45, 0.9):
        p.box((-2.0, -0.1, z), (2.0, -0.06, z + 0.14), 'kn_wood_oak', r=0.015)
    p.col_box((-2.06, -0.1, 0.0), (2.06, 0.06, 1.15), 'wood')


@piece('tree_oak', 'E-M', 8000, variants=3)
def tree_oak(p):
    """Oak: chunky walnut trunk and three to five round foliage puffs (three variants)."""
    rng = p.rng
    h = (6.0, 7.5, 5.0)[p.v]
    p.sweep([(0, 0, 0), (0.2, 0.1, h * 0.45), (0.0, 0.3, h * 0.7)], 0.45, 'kn_wood_walnut', sides=10,
            radii=[0.55, 0.38, 0.28])
    n = 3 + p.v
    for i in range(n):
        a = i / n * 2 * math.pi + rng.uniform(-0.3, 0.3)
        r = rng.uniform(1.6, 2.4)
        c = (math.cos(a) * 1.4, math.sin(a) * 1.4, h * 0.75 + rng.uniform(-0.5, 0.8))
        p.sphere(c, r, 'kn_env_foliage' if i % 2 else 'kn_env_foliage_dark', segs=16, rings=8, sz_top=0.9, sz_bot=0.75)
    p.sphere((0.0, 0.2, h * 0.95), 2.6, 'kn_env_foliage', segs=18, rings=9, sz_top=0.85, sz_bot=0.7)
    p.col_cyl((0, 0), 0.5, 0.0, h * 0.6, 'wood')


@piece('tree_poplar', 'E-M', 6000, variants=2)
def tree_poplar(p):
    """Poplar: tall narrow foliage spindle on a slim trunk (two variants)."""
    h = (10.0, 12.5)[p.v]
    p.cyl((0, 0), 0.25, 0.0, h * 0.35, 'kn_wood_walnut', segs=10, bev=0.05)
    p.lathe([(0.0, h * 0.2, 'kn_env_foliage_dark'), (1.3, h * 0.3, 'kn_env_foliage_dark'), (1.6, h * 0.5, 'kn_env_foliage_dark'),
             (1.2, h * 0.8, 'kn_env_foliage_dark'), (0.0, h, 'kn_env_foliage_dark')], segs=16)
    p.col_cyl((0, 0), 0.3, 0.0, h * 0.35, 'wood')


@piece('bush', 'E-S', 1500, variants=4)
def bush(p):
    """Round bush, four variants (no collision)."""
    rng = p.rng
    for i in range(2 + p.v % 3):
        a = rng.uniform(0, 2 * math.pi)
        p.sphere((math.cos(a) * 0.4, math.sin(a) * 0.4, 0.55), rng.uniform(0.55, 0.85),
                 'kn_env_foliage' if (i + p.v) % 2 else 'kn_env_foliage_dark', segs=12, rings=6, sz_bot=0.6)


@piece('rock_outcrop', 'E-M', 5000, variants=6)
def rock_outcrop(p):
    """Rock outcrop: two to four chunky faceted hulls (six variants)."""
    rng = p.rng
    for i in range(2 + p.v % 3):
        cx, cy = rng.uniform(-1.2, 1.2), rng.uniform(-0.9, 0.9)
        s = rng.uniform(0.7, 1.6)
        pts = [(cx + s * rng.uniform(-1, 1), cy + s * rng.uniform(-0.8, 0.8), s * rng.uniform(0.0, 1.2)) for _ in range(14)]
        pts += [(cx + s * math.cos(a), cy + s * 0.8 * math.sin(a), -0.2) for a in (0, 2, 4)]
        p.hull(pts, 'kn_env_rock')
        lo = [min(q[k] for q in pts) for k in range(3)]
        hi = [max(q[k] for q in pts) for k in range(3)]
        p.col_box((lo[0], lo[1], 0.0), (hi[0], hi[1], hi[2]), 'ceramic')


@piece('traffic_cone', 'E-S', 300)
def traffic_cone(p):
    """Traffic cone: Ignition cone on a Graphite base, Bone band."""
    p.box((-0.18, -0.18, 0.0), (0.18, 0.18, 0.03), 'kn_powder_graphite', r=0.02)
    p.lathe([(0.0, 0.03, 'kn_powder_ignition'), (0.14, 0.03, 'kn_powder_ignition'), (0.09, 0.3, 'kn_powder_bone'),
             (0.075, 0.4, 'kn_powder_ignition'), (0.03, 0.7, 'kn_powder_ignition'), (0.0, 0.71, 'kn_powder_ignition')], segs=16)
    p.col_box((-0.18, -0.18, 0.0), (0.18, 0.18, 0.71), 'rubber')


@piece('soundstage', 'E-L', 18000, variants=6)
def soundstage(p):
    """Soundstage: concrete barrel-roof hall, Graphite elephant door, a numbered sign as blocks (no names).
    Arena: backdrop (no collision); Mega: buildable."""
    L, W, H = 60.0, 40.0, 18.0
    p.box((-L / 2, -W / 2, 0.0), (L / 2, W / 2, H), 'kn_env_concrete', r=0.4)
    # barrel roof: a squashed cylinder along X whose lower half sits inside the hall
    p.cyl((0, 0), W / 2 + 0.3, -L / 2 - 0.3, L / 2 + 0.3, 'kn_powder_bone', segs=32, bev=0.3,
          m=at(0, 0, H - 0.5) @ rot_y(90) @ Matrix.Diagonal((0.22, 1.0, 1.0, 1.0)))
    p.box((-8.0, -W / 2 - 0.3, 0.0), (8.0, -W / 2 + 0.1, 12.0), 'kn_powder_graphite', r=0.2)
    p.box((-0.15, -W / 2 - 0.35, 0.0), (0.15, -W / 2 + 0.1, 12.0), 'kn_powder_bone', r=0.05)
    n = p.v + 1
    for i in range(n):
        p.box((12.0 + i * 1.6, -W / 2 - 0.2, 13.0), (13.0 + i * 1.6, -W / 2 + 0.1, 16.5), 'kn_powder_amber', r=0.2)
    p.col_box((-L / 2, -W / 2, 0.0), (L / 2, W / 2, H), 'powder')


def bake_tris(name, variant=0, lod=0):
    from kn_tools.kit import Kit
    k = Kit()
    build_piece(name, k, I4, lod, variant)
    t = k.tris()
    k.free()
    return t


_ = (frame, Vector)
