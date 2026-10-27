"""Shared props kit core (environments.md §7, D78): the builder context and the registry.

Every kit prop is a plain function `build(p)` that emits closed shells into a `kn_tools.kit.Kit` through the
context `p` (a `P`), in prop space: real size (1 : 1), metres, Z up, origin = the centre of the footprint on
the floor, front = -Y. The context carries the placement matrix (an environment instances a prop at 2 : 1 or
5 : 1 by passing a uniformly scaled matrix), the LOD, the variant index and, when the placement wants them,
the collider list. So one table builds the prop's own .blend, the kit glb, the contact sheet and every
environment placement, and a prop can never drift from its colliders.

LODs follow env_kitchen.py: each LOD is rebuilt at a lower segment quality (LODQ). E-S props (and any prop
that asks for it) end at a 12-tri box at LOD3 (environments.md §7 "LOD").
"""
import math
import random

from mathutils import Matrix, Vector

from kn_tools.kit import Kit, at, frame, outline_rrect  # noqa: F401  (re-exported for the prop modules)

LODQ = (1.0, 0.6, 0.35, 0.15)
PHYS = ('powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric')
I4 = Matrix.Identity(4)

PROPS = {}


def prop(name, cls, used, budget, variants=1, lod3=None, desc=''):
    """Register `build(p)` as kit prop `kn_prop_<name>` (class E-S / E-M / E-L, used in 'lab' / 'kitchen' /
    'both', LOD0 tri budget from the brief, number of variants). E-S props default to a LOD3 box."""
    def deco(fn):
        PROPS[name] = {'fn': fn, 'cls': cls, 'used': used, 'budget': budget, 'variants': variants,
                       'lod3': lod3 if lod3 is not None else ('box' if cls == 'E-S' else 'build'),
                       'desc': desc or (fn.__doc__ or '').strip().split('\n')[0]}
        return fn
    return deco


class P:
    """Builder context. Local coordinates are prop space; `M` places the prop (may carry a uniform scale)."""

    def __init__(self, kit, M=None, lod=0, variant=0, cols=None, seed=0):
        self.k = kit
        self.M = M if M is not None else I4
        self.lod = lod
        self.q = LODQ[lod]
        self.v = variant
        self.cols = cols            # list to append colliders to (environment placements), or None
        self.rng = random.Random(seed * 7919 + variant * 31 + 17)
        self.s = self.M.to_scale().x
        self.cs_base = 2

    # -- resolution helpers ------------------------------------------------------------------------
    def seg(self, n, lo=6):
        return max(lo, int(round(n * self.q)))

    def cs(self, base=None):
        """Bevel segments: E-S props bevel with 1 segment at LOD0, E-M / E-L with 2; fewer per LOD."""
        b = self.cs_base if base is None else min(base, self.cs_base)
        return max(0, int(b * self.q + 0.2))

    def _m(self, m=None):
        return self.M if m is None else self.M @ m

    # -- primitives (prop space) -------------------------------------------------------------------
    def box(self, lo, hi, mat, r=0.004, m=None):
        """Rounded (toy-bevelled) box from lo to hi."""
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        c = (lo + hi) / 2
        rr = min(r, min(size) * 0.45)
        cs = self.cs() if rr > 0.0004 else 0
        if cs == 0:
            self.k.hull([(c.x + sx * size.x / 2, c.y + sy * size.y / 2, c.z + sz * size.z / 2)
                         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], mat, m=self._m(m))
        else:
            self.k.rbox(tuple(size), tuple(c), rr, mat, cseg=cs, m=self._m(m))

    def cyl(self, c, r, z0, z1, mat, segs=24, bev=0.002, m=None, cap=None, lo=6):
        mm = at(c[0], c[1], 0.0) if m is None else m @ at(c[0], c[1], 0.0)
        self.k.cyl(r, z0, z1, mat, self.seg(segs, lo), bev=bev if self.lod < 3 else 0.0,
                   bseg=max(1, self.cs(2)), m=self._m(mm), cap=cap)

    def lathe(self, profile, segs=24, m=None, lo=6):
        self.k.lathe(profile, self.seg(segs, lo), m=self._m(m))

    def sphere(self, c, r, mat, segs=16, rings=8, sz_top=1.0, sz_bot=1.0, m=None):
        mm = at(*c) if m is None else m @ at(*c)
        self.k.sphere(r, mat, self.seg(segs, 6), self.seg(rings, 3), m=self._m(mm), sz_top=sz_top, sz_bot=sz_bot)

    def ellipsoid(self, c, size, mat, segs=12, rings=6, m=None):
        """Sphere scaled to `size` (x, y, z radii), e.g. leaves, cushions, fruit."""
        sc = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
        mm = at(*c) @ sc
        if m is not None:
            mm = m @ mm
        self.k.sphere(1.0, mat, self.seg(segs, 5), self.seg(rings, 3), m=self._m(mm))

    def sweep(self, path, radius, mat, sides=8, radii=None, m=None, closed=False):
        self.k.sweep(path, radius, self.seg(sides, 4), mat, m=self._m(m), radii=radii, closed=closed)

    def torus(self, R, r, mat, maj=24, mn=8, m=None):
        self.k.torus(R, r, mat, self.seg(maj, 6), self.seg(mn, 4), m=self._m(m))

    def hull(self, pts, mat, m=None):
        self.k.hull(pts, mat, m=self._m(m))

    def prism(self, outline, z0, z1, mat, bev=0.0, m=None, **kw):
        bseg = max(1, self.cs(2))
        self.k.prism(outline, z0, z1, mat, bt=bev if self.lod < 3 else 0.0, bb=bev if self.lod < 3 else 0.0,
                     bseg=bseg, m=self._m(m), **kw)

    def slab(self, w, d, z0, z1, mat, r=0.01, m=None):
        """Rounded-rect slab centred on the origin in x/y (rug, mat, board)."""
        cs = self.cs(2)
        self.k.prism(outline_rrect(w, d, r if cs else 0.0, cs), z0, z1, mat, m=self._m(m))

    # -- colliders (only when the placement asked for them, LOD0 only) -----------------------------
    def _world_aabb(self, lo, hi, m=None):
        mm = self._m(m)
        pts = [mm @ Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        a = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        b = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return a, b

    def col_box(self, lo, hi, phys, m=None, name=None):
        assert phys in PHYS, phys
        if self.cols is None or self.lod != 0:
            return
        a, b = self._world_aabb(lo, hi, m)
        self.cols.append({'kind': 'box', 'lo': a, 'hi': b, 'phys': phys, 'name': name})

    def col_cyl(self, c, r, z0, z1, phys, name=None):
        """Upright cylinder -> its bounding box (environment colliders are boxes and spheres)."""
        self.col_box((c[0] - r, c[1] - r, z0), (c[0] + r, c[1] + r, z1), phys, name=name)

    def col_sphere(self, c, r, phys, name=None):
        assert phys in PHYS, phys
        if self.cols is None or self.lod != 0:
            return
        self.cols.append({'kind': 'sphere', 'c': self.M @ Vector(c), 'r': r * self.s, 'phys': phys, 'name': name})


def build_prop(name, kit, M=None, lod=0, variant=0, cols=None, seed=0):
    """Emit kit prop `name` into `kit`. At LOD3 an E-S prop becomes its LOD2 bounding box (12 tris) in its
    dominant master. Returns the context (for its collider list)."""
    spec = PROPS[name]
    v = variant % max(1, spec['variants'])
    if lod == 3 and spec['lod3'] == 'box':
        tmp = Kit()
        pt = P(tmp, I4, 2, v, None, seed)
        pt.cs_base = 1
        spec['fn'](pt)
        vs = [v_.co for v_ in tmp.bm.verts]
        counts = {}
        for f in tmp.bm.faces:
            counts[f.material_index] = counts.get(f.material_index, 0) + f.calc_area()
        mat = tmp.mats[max(counts, key=counts.get)] if counts else 'kn_cardboard'
        lo = Vector([min(c[i] for c in vs) for i in range(3)])
        hi = Vector([max(c[i] for c in vs) for i in range(3)])
        tmp.free()
        kit.hull([(x, y, z) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)], mat,
                 m=M if M is not None else I4)
        p = P(kit, M, lod, v, cols, seed)
        return p
    p = P(kit, M, lod, v, cols, seed)
    p.cs_base = 1 if spec['cls'] == 'E-S' else 2
    spec['fn'](p)
    return p


def place(x, y, z, yaw=0.0, scale=1.0):
    """Placement matrix: translate, then yaw (degrees about Z), then uniform scale."""
    return at(x, y, z) @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Scale(scale, 4)


def load_all():
    """Import every prop module so the registry is full. Returns PROPS."""
    from . import stationery, lab, plants, workshop, furniture  # noqa: F401
    return PROPS
