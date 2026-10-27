"""Kit props: potted plants (environments.md §7). Fat, rounded toy leaves (flattened ellipsoids) over lathed
pots; never photoreal. Leaves are visual only: colliders cover the pot."""
import math

from mathutils import Matrix, Vector

from .core import at, frame, prop

POTS = ('kn_env_terracotta', 'kn_ceramic_bone', 'kn_ceramic_cobalt', 'kn_ceramic_amber')
LEAVES = ('kn_env_foliage', 'kn_env_foliage_dark')


def pot(p, r, h, mat, segs=24):
    """Tapered pot with a rolled lip and a soil disc; returns the soil height."""
    rb = r * 0.75
    p.lathe([(0.0, 0.0, mat), (rb, 0.0, mat), (r * 0.98, h * 0.88, mat), (r * 1.06, h * 0.9, mat), (r * 1.06, h, mat),
             (r * 0.92, h, mat), (r * 0.9, h * 0.92, 'kn_env_dirt'), (0.0, h * 0.92, 'kn_env_dirt')], segs=segs)
    return h * 0.92


def leaf(p, base, direction, length, width, mat, thick=0.012):
    """A flattened ellipsoid leaf from `base` along `direction` (its broad face roughly up)."""
    d = Vector(direction).normalized()
    c = Vector(base) + d * (length / 2)
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    rot = Matrix((side, d, up)).transposed().to_4x4()
    m = at(*c) @ rot @ Matrix.Diagonal((width / 2, length / 2, thick, 1.0))
    p.k.sphere(1.0, mat, p.seg(8, 5), p.seg(4, 3), m=p.M @ m)


@prop('plant_succulent', 'E-S', 'both', 1500, variants=3)
def plant_succulent(p):
    """Small pot with a rosette of fat leaves (three variants: rosette, tall cluster, round paddles)."""
    r, h = 0.05, 0.07
    z = pot(p, r, h, POTS[p.v % 4])
    if p.v == 0:
        for i in range(14):
            a = i * 2.4
            ring = 0.4 + 0.6 * (i / 14)
            el = math.radians(70 - 45 * ring)
            leaf(p, (0, 0, z), (math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)), 0.05 * ring + 0.02,
                 0.026, LEAVES[i % 2], thick=0.008)
    elif p.v == 1:
        for i in range(6):
            a = i / 6 * 2 * math.pi
            x, y = 0.018 * math.cos(a), 0.018 * math.sin(a)
            p.cyl((x, y), 0.009, z - 0.005, z + 0.05 + 0.02 * (i % 3), LEAVES[i % 2], segs=10, bev=0.008)
    else:
        for i in range(5):
            a = i / 5 * 2 * math.pi
            leaf(p, (0, 0, z), (0.6 * math.cos(a), 0.6 * math.sin(a), 0.8), 0.06, 0.045, LEAVES[i % 2], thick=0.007)
    p.col_cyl((0, 0), r * 1.06, 0.0, h, 'ceramic')


@prop('plant_fern', 'E-M', 'both', 5000)
def plant_fern(p):
    """Medium pot with arching fronds of paired leaflets."""
    r, h = 0.09, 0.13
    z = pot(p, r, h, POTS[0])
    for i in range(7):
        a = i / 7 * 2 * math.pi + 0.3
        el = math.radians(55 + 15 * (i % 3))
        L = 0.28 + 0.06 * (i % 2)
        pts = []
        for k in range(6):
            t = k / 5
            hor = L * t * math.cos(el)
            pts.append((math.cos(a) * hor, math.sin(a) * hor, z + L * t * math.sin(el) - 0.18 * t * t))
        p.sweep(pts, 0.004, 'kn_env_foliage_dark', sides=4, radii=[0.005, 0.0045, 0.004, 0.0035, 0.003, 0.002])
        for k in range(1, 5):
            b = Vector(pts[k])
            tan = (Vector(pts[k + 1]) - Vector(pts[k - 1])).normalized()
            side = tan.cross(Vector((0, 0, 1))).normalized()
            for s in (-1, 1):
                leaf(p, b, side * s + tan * 0.4 + Vector((0, 0, 0.15)), 0.06 - 0.008 * k, 0.022, LEAVES[(i + k) % 2],
                     thick=0.004)
    p.col_cyl((0, 0), r * 1.06, 0.0, h, 'ceramic')


@prop('plant_trailing', 'E-M', 'both', 6000, variants=2)
def plant_trailing(p):
    """Trailing plant for shelf edges and cabinet tops: vines spill over the front (-Y) edge. Variant 1 is the
    long one (vines drop 0.55 m instead of 0.3 m)."""
    r, h = 0.075, 0.11
    z = pot(p, r, h, POTS[1 + p.v])
    drop = 0.3 if p.v == 0 else 0.55
    for i in range(7):
        a = math.radians(200 + i * 20)
        sx = math.cos(a)
        pts = [(sx * 0.03, -0.02, z + 0.01), (sx * 0.08, -0.07, z + 0.02), (sx * 0.1, -0.11, z - 0.05)]
        for k in range(1, 5):
            pts.append((sx * (0.1 + 0.01 * k) + 0.02 * math.sin(k + i), -0.12 - 0.005 * k, z - 0.05 - drop * k / 4 *
                        (0.6 + 0.4 * ((i * 37) % 5) / 4)))
        p.sweep(pts, 0.0025, 'kn_env_foliage_dark', sides=4)
        for k in range(1, len(pts)):
            b = Vector(pts[k])
            leaf(p, b, (0.5 if k % 2 else -0.5, -1.0, 0.3), 0.035, 0.03, LEAVES[(i + k) % 2], thick=0.004)
    for i in range(6):
        a = i / 6 * 2 * math.pi
        leaf(p, (0, 0, z), (math.cos(a), math.sin(a), 0.9), 0.06, 0.04, LEAVES[i % 2], thick=0.005)
    p.col_cyl((0, 0), r * 1.06, 0.0, h, 'ceramic')


@prop('plant_tall', 'E-L', 'both', 12000)
def plant_tall(p):
    """1.4 m large-leaf floor plant in a Bone pot."""
    r, h = 0.2, 0.36
    z = pot(p, r, h, 'kn_ceramic_bone', segs=32)
    stems = ((0.0, 0.0, 1.0, 1.0), (0.4, 0.3, 0.85, 0.9), (2.2, -0.35, 0.8, 0.8), (3.6, 0.4, 0.9, 0.95),
             (4.8, -0.3, 0.75, 0.85))
    for i, (a, lean, hgt, sz) in enumerate(stems):
        top = Vector((math.cos(a) * lean * 0.35, math.sin(a) * lean * 0.35, z + hgt))
        mid = Vector((top.x * 0.4, top.y * 0.4, z + hgt * 0.5))
        p.sweep([(0, 0, z - 0.02), tuple(mid), tuple(top)], 0.012, 'kn_wood_walnut', sides=6,
                radii=[0.016, 0.012, 0.008])
        for k in range(3):
            ang = a + k * 2.1 + i
            dirv = Vector((math.cos(ang), math.sin(ang), 0.35 - 0.25 * k))
            leaf(p, top - Vector((0, 0, 0.12 * k)), dirv, 0.32 * sz, 0.2 * sz, LEAVES[(i + k) % 2], thick=0.014)
    p.col_cyl((0, 0), r * 1.06, 0.0, h, 'ceramic')
