"""Procedural part kit for the make_<type>.py builders (house style of make_thud.py).

`Kit` accumulates closed (watertight) shells in one bmesh with master-material slots by id. Every primitive
here emits a closed shell, so a piece made of several overlapping shells still passes validator rule 10.
`Part` wraps the template: root properties, linked masters, LOD tuning (50 / 25 / 8 % of LOD0, §4), pivots,
ports with linked rings, collision, sensors, emitters and screens.

A builder is `build(lod, q) -> {piece: Kit}`: `lod` switches structural simplifications (LOD2 interiors,
LOD3 primitives) and `q` (0..1] scales radial / profile resolution. `Part.build_lods` picks q per LOD so
each LOD lands on its tri ratio. Pieces with `kit.pivot = 'PIVOT__x'` hang under that pivot empty.
Coordinates: Blender part space, metres, Z up, front = -Y (ASSET_PIPELINE §3.1).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import decal_atlas, geom, library, paths, ports, template
from .conventions import LOD_COLLECTIONS, LOD_RATIOS

LOD_SUFFIX = ('', '__L1', '__L2', '__L3')
SHARP_DEG = (35, 40, 50, 65)  # coarse LODs keep low-segment cylinders smooth


def seg(n, q, lo=3, mult=1):
    """Segment count n scaled by quality q, rounded to a multiple of `mult`, never below `lo`."""
    v = int(round(n * q / mult)) * mult
    return max(lo, v)


def frame(origin=(0.0, 0.0, 0.0), axis=(0.0, 0.0, 1.0), spin=0.0):
    """4x4 that maps local +Z onto `axis` (vector or 'x'/'y'/'z'/'-x'...) at `origin`, spun about it."""
    if isinstance(axis, str):
        sign = -1.0 if axis.startswith('-') else 1.0
        axis = {'x': (sign, 0, 0), 'y': (0, sign, 0), 'z': (0, 0, sign)}[axis[-1]]
    d = Vector(axis).normalized()
    if d.z > 0.9999:
        rot = Matrix.Identity(3)
    elif d.z < -0.9999:
        rot = Matrix.Rotation(math.pi, 3, 'X')
    else:
        rot = d.to_track_quat('Z', 'Y').to_matrix()
    if spin:
        rot = rot @ Matrix.Rotation(spin, 3, 'Z')
    return Matrix.Translation(Vector(origin)) @ rot.to_4x4()


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


def at(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


# Prism / lathe frames whose local Z runs along a Blender axis, with local (x, y) = the other two axes in
# cyclic order: X_AXIS maps local (x, y, z) -> (y, z, x), Y_AXIS -> (z, x, y). Proper rotations (det +1).
X_AXIS = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
Y_AXIS = Matrix(((0, 1, 0, 0), (0, 0, 1, 0), (1, 0, 0, 0), (0, 0, 0, 1)))
# local z -> -Y (out of a front face), local (x, y) -> Blender (x, z)
FRONT_OUT = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


# ---------------------------------------------------------------- 2D outlines (CCW)

def outline_circle(r, n, start=0.0):
    return [(r * math.cos(start + 2 * math.pi * i / n), r * math.sin(start + 2 * math.pi * i / n)) for i in range(n)]


def outline_rrect(w, d, r, cseg):
    """Rounded rectangle w (x) by d (y), corner radius r with cseg segments per corner."""
    r = min(r, w / 2 - 1e-5, d / 2 - 1e-5)
    hx, hy = w / 2 - r, d / 2 - r
    pts = []
    for cx, cy, a0 in ((hx, -hy, -90), (hx, hy, 0), (-hx, hy, 90), (-hx, -hy, 180)):
        if r <= 1e-6 or cseg < 1:  # sharp corner: the rectangle's own corner
            a = math.radians(a0 + 45)
            pts.append((cx + r * math.sqrt(2) * math.cos(a), cy + r * math.sqrt(2) * math.sin(a)))
            continue
        for k in range(cseg + 1):
            a = math.radians(a0 + 90 * k / cseg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def outline_round_poly(corners, r, cseg):
    """Convex CCW polygon with every corner rounded by radius r."""
    n = len(corners)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(corners[i - 1]), Vector(corners[i]), Vector(corners[(i + 1) % n])
        a, b = (p0 - p1).normalized(), (p2 - p1).normalized()
        half = math.acos(max(-1.0, min(1.0, a.dot(b)))) / 2
        dist = r / math.tan(half)
        c = p1 + (a + b).normalized() * (r / math.sin(half))
        t0, t1 = p1 + a * dist, p1 + b * dist
        a0 = math.atan2(t0.y - c.y, t0.x - c.x)
        a1 = math.atan2(t1.y - c.y, t1.x - c.x)
        while a1 < a0:
            a1 += 2 * math.pi
        for k in range(cseg + 1):
            t = a0 + (a1 - a0) * k / cseg
            out.append((c.x + r * math.cos(t), c.y + r * math.sin(t)))
    return out


def outline_circle_flat(r, n, flat_y):
    """Circle of radius r with the part below y = flat_y cut off by a straight chord (front facets)."""
    a = math.asin(max(-1.0, min(1.0, flat_y / r)))  # right chord end; the left end is at pi - a
    arc = math.pi - 2 * a                            # CCW from a over the top (+Y) to pi - a
    m = max(3, int(round(n * arc / (2 * math.pi))))
    return [(r * math.cos(a + arc * i / m), r * math.sin(a + arc * i / m)) for i in range(m + 1)]


def outline_normals(pts):
    """Per-vertex outward miter vectors (unit bisector / cos) for a CCW outline."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1, e2 = (p1 - p0), (p2 - p1)
        n1 = Vector((e1.y, -e1.x)).normalized() if e1.length > 1e-12 else Vector((0, 0))
        n2 = Vector((e2.y, -e2.x)).normalized() if e2.length > 1e-12 else n1
        b = (n1 + n2)
        if b.length < 1e-9:
            b = n1
        b.normalize()
        c = max(0.35, b.dot(n2 if n2.length else n1))
        out.append(b / c)
    return out


# ---------------------------------------------------------------- kit

class Kit:
    """One bmesh of closed shells plus its master-material slot list (by id)."""

    def __init__(self, pivot=None):
        self.bm = bmesh.new()
        self.mats = []
        self.pivot = pivot
        self.colors = {}  # attribute name -> fn(face centre, normal, master id) -> RGBA (face-corner colour)
        # M2 (E1): shape keys -> glTF morph targets. name -> (target, meaning, default weight); target is a Kit
        # with the same vertex order (the piece rebuilt in its other state) or fn(co: Vector) -> Vector.
        self.shape_keys = {}

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def free(self):
        self.bm.free()
        for target, *_rest in getattr(self, 'shape_keys', {}).values():
            if isinstance(target, Kit) and target.bm.is_valid:
                target.free()

    def _xf(self, verts, m):
        if m is not None:
            bmesh.ops.transform(self.bm, matrix=m, verts=verts)

    # -- primitives -------------------------------------------------------------------------------

    def lathe(self, profile, segs, m=None, closed=False, start=0.0):
        """Revolve [(r, h, mat), ...] about local +Z. The strip from point i to i+1 takes point i's master.
        r = 0 makes a pole. Open profiles must start and end on poles to be watertight."""
        bm = self.bm
        rings, verts = [], []
        for r, h, _ in profile:
            if r < 1e-9:
                v = bm.verts.new((0.0, 0.0, h))
                rings.append([v])
                verts.append(v)
            else:
                ring = [bm.verts.new((r * math.cos(start + 2 * math.pi * i / segs),
                                      r * math.sin(start + 2 * math.pi * i / segs), h)) for i in range(segs)]
                rings.append(ring)
                verts.extend(ring)
        idx = list(range(len(rings) - 1))
        if closed:
            idx.append(len(rings) - 1)
        faces = []
        for k in idx:
            a, b = rings[k], rings[(k + 1) % len(rings)]
            mi = self.mi(profile[k][2])
            if len(a) == 1 and len(b) == 1:
                continue
            for i in range(segs):
                j = (i + 1) % segs
                if len(a) == 1:
                    f = bm.faces.new((a[0], b[j], b[i]))
                elif len(b) == 1:
                    f = bm.faces.new((a[i], a[j], b[0]))
                else:
                    f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
                faces.append(f)
        self._xf(verts, m)
        return faces

    def lathe_arc(self, profile, a0, a1, segs, m=None, cap=None):
        """Revolve a *closed* profile [(r, h, mat), ...] about local +Z from angle a0 to a1 (radians) and cap
        both cut ends with the profile polygon: a watertight partial ring (winding bands, C-clips)."""
        bm = self.bm
        rings, verts = [], []
        for i in range(segs + 1):
            a = a0 + (a1 - a0) * i / segs
            ca, sa = math.cos(a), math.sin(a)
            ring = [bm.verts.new((r * ca, r * sa, h)) for r, h, _ in profile]
            rings.append(ring)
            verts.extend(ring)
        n = len(profile)
        for i in range(segs):
            a, b = rings[i], rings[i + 1]
            for k in range(n):
                j = (k + 1) % n
                f = bm.faces.new((a[k], a[j], b[j], b[k]))
                f.material_index = self.mi(profile[k][2])
        cmi = self.mi(cap or profile[0][2])
        for ring in (rings[0], rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = cmi
        self._xf(verts, m)

    def cyl(self, r, z0, z1, mat, segs, bev=0.0, bseg=2, m=None, cap=None, bev_bot=None, cap_bot=None):
        """Cylinder about local Z from z0 to z1 with rounded rims (bev) and optional cap masters."""
        cap = cap or mat
        cap_bot = cap_bot or cap
        bb = bev if bev_bot is None else bev_bot
        bev = min(bev, r * 0.95, (z1 - z0) / 2 * 0.95)
        bb = min(bb, r * 0.95, (z1 - z0) / 2 * 0.95)
        prof = [(0.0, z0, cap_bot)]
        prof += arc_pts(r, z0, bb, bseg, True, mat, cap)
        prof += arc_pts(r, z1, bev, bseg, False, mat, cap)
        prof.append((0.0, z1, cap))
        return self.lathe(dedupe(prof), segs, m)

    def sphere(self, r, mat, segs, rings, m=None, sz_top=1.0, sz_bot=1.0, pinch=None):
        prof = []
        for k in range(rings + 1):
            phi = -math.pi / 2 + math.pi * k / rings
            z = math.sin(phi)
            rr = r * math.cos(phi)
            if pinch is not None:
                rr *= pinch(z)
            zz = r * z * (sz_top if z > 0 else sz_bot)
            prof.append((0.0 if k in (0, rings) else rr, zz, mat))
        return self.lathe(prof, segs, m)

    def torus(self, R, r, mat, maj, mn, m=None, start=0.0):
        prof = [(R + r * math.cos(2 * math.pi * k / mn), r * math.sin(2 * math.pi * k / mn), mat) for k in range(mn)]
        return self.lathe(prof, maj, m, closed=True, start=start)

    def prism(self, outline, z0, z1, mat, bt=0.0, bb=0.0, bseg=2, m=None, top=None, bot=None, side=None, cuts=(),
              side_fn=None, bseg_top=None):
        """Extrude a CCW outline from z0 to z1 with rounded (bevelled) top / bottom rims. Caps are n-gons.
        `cuts` adds wall rows at those z; `side_fn(z_mid) -> master` paints wall strips by height."""
        bm = self.bm
        top, bot, side = top or mat, bot or mat, side or mat
        bseg = max(1, bseg)
        nrm = outline_normals(outline)
        h = z1 - z0
        bt = min(bt, h * 0.49)
        bb = min(bb, h * 0.49)
        rows = []  # (inset, z, master of strip above)
        if bb > 0:
            for k in range(bseg + 1):
                t = math.pi / 2 * k / bseg
                rows.append((bb * (1 - math.sin(t)), z0 + bb * (1 - math.cos(t)), side))
        else:
            rows.append((0.0, z0, side))
        for zc in sorted(cuts):
            if z0 + bb + 1e-6 < zc < z1 - bt - 1e-6:
                rows.append((0.0, zc, side))
        if bt > 0:
            ts = max(1, bseg_top or bseg)
            for k in range(ts + 1):
                t = math.pi / 2 * k / ts
                rows.append((bt * (1 - math.cos(t)), z1 - bt + bt * math.sin(t), side))
        else:
            rows.append((0.0, z1, side))
        rows = dedupe_rows(rows)
        rings, verts = [], []
        for inset, z, _ in rows:
            ring = [bm.verts.new((p[0] - nv.x * inset, p[1] - nv.y * inset, z)) for p, nv in zip(outline, nrm)]
            rings.append(ring)
            verts.extend(ring)
        n = len(outline)
        faces = []
        smi = self.mi(side)
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            mi = smi if side_fn is None else self.mi(side_fn((rows[k][1] + rows[k + 1][1]) / 2))
            for i in range(n):
                j = (i + 1) % n
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
                faces.append(f)
        fb = bm.faces.new(list(reversed(rings[0])))
        fb.material_index = self.mi(bot)
        ft = bm.faces.new(rings[-1])
        ft.material_index = self.mi(top)
        faces += [fb, ft]
        self._xf(verts, m)
        return faces

    def rbox(self, size, center, r, mat, cseg=3, m=None, rz=None, top=None, bot=None):
        """Pillowed box: rounded-rect outline (corner r) with rounded top/bottom rims (rz, default r)."""
        sx, sy, sz = size
        rz = r if rz is None else rz
        mm = at(*center)
        if m is not None:
            mm = m @ mm
        return self.prism(outline_rrect(sx, sy, r, cseg), -sz / 2, sz / 2, mat, bt=rz, bb=rz, bseg=cseg, m=mm,
                          top=top, bot=bot)

    def sweep(self, path, radius, sides, mat, m=None, caps=True, radii=None, closed=False):
        """Round tube along a polyline (parallel-transport frames), capped (watertight) unless closed."""
        bm = self.bm
        pts = [Vector(p) for p in path]
        n = len(pts)
        tans = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[i - 1]
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = pts[i + 1] - pts[i - 1]
            tans.append(t.normalized())
        ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
        nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
        rings, verts = [], []
        for i in range(n):
            if i > 0:
                nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
            bi = tans[i].cross(nrm)
            rr = radii[i] if radii else radius
            ring = [bm.verts.new(pts[i] + (nrm * math.cos(2 * math.pi * k / sides) +
                                           bi * math.sin(2 * math.pi * k / sides)) * rr) for k in range(sides)]
            rings.append(ring)
            verts.extend(ring)
        mi = self.mi(mat)
        faces = []
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            a, b = rings[i], rings[(i + 1) % n]
            for k in range(sides):
                j = (k + 1) % sides
                f = bm.faces.new((a[k], a[j], b[j], b[k]))
                f.material_index = mi
                faces.append(f)
        if caps and not closed:
            for ring in (rings[0], rings[-1]):
                f = bm.faces.new(ring)
                f.material_index = mi
                faces.append(f)
        self._xf(verts, m)
        return faces

    def ring_sweep(self, outline, profile, mat, m=None):
        """Closed planar outline swept by a closed 2D profile [(out, z), ...]: frames, gaskets, LED strips."""
        bm = self.bm
        nrm = outline_normals(outline)
        n, k = len(outline), len(profile)
        rings, verts = [], []
        for (o, z) in profile:
            ring = [bm.verts.new((p[0] + nv.x * o, p[1] + nv.y * o, z)) for p, nv in zip(outline, nrm)]
            rings.append(ring)
            verts.extend(ring)
        mi = self.mi(mat)
        for a_i in range(k):
            a, b = rings[a_i], rings[(a_i + 1) % k]
            for i in range(n):
                j = (i + 1) % n
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
        self._xf(verts, m)

    def hull(self, points, mat, m=None):
        """Convex hull of points as a closed shell (cheap screws, wedges, sensor-like solids)."""
        bm = self.bm
        vs = [bm.verts.new(p) for p in points]
        res = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
        for g in res.get('geom_interior', []) + res.get('geom_unused', []):
            if isinstance(g, bmesh.types.BMVert) and g.is_valid and not g.link_faces:
                bm.verts.remove(g)
        mi = self.mi(mat)
        out = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        for f in out:
            f.material_index = mi
        self._xf([v for v in vs if v.is_valid], m)
        return out

    def merge(self, other):
        """Append another kit's shells (materials remapped by id)."""
        remap = {i: self.mi(n) for i, n in enumerate(other.mats)}
        me = bpy.data.meshes.new('kit_tmp')
        other.bm.to_mesh(me)
        for p in me.polygons:
            p.material_index = remap.get(p.material_index, 0)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def bevel_edges(self, edges, offset, segs, profile=0.5):
        if not edges or offset <= 0:
            return
        bmesh.ops.bevel(self.bm, geom=list(edges), offset=offset, offset_type='OFFSET', segments=segs,
                        profile=profile, affect='EDGES', clamp_overlap=True)

    def sharp_edges(self, deg=30):
        thr = math.radians(deg)
        return [e for e in self.bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > thr]


def dedupe(prof, eps=1e-7):
    out = []
    for p in prof:
        if out and abs(out[-1][0] - p[0]) < eps and abs(out[-1][1] - p[1]) < eps:
            continue
        out.append(p)
    return out


def dedupe_rows(rows, eps=1e-7):
    out = []
    for r in rows:
        if out and abs(out[-1][0] - r[0]) < eps and abs(out[-1][1] - r[1]) < eps:
            continue
        out.append(r)
    return out


def arc_pts(r, z, bev, bseg, bottom, side, cap):
    """Rim profile points from the bottom cap edge up to the wall (bottom) or from the wall to the top cap
    edge (top). Each point carries the master of the strip above it: side for walls and bevels, cap for the
    last top point (its strip runs to the top pole)."""
    if bev <= 1e-7:
        return [(r, z, side if bottom else cap)]
    bseg = max(1, bseg)
    pts = []
    for k in range(bseg + 1):
        t = math.pi / 2 * k / bseg
        if bottom:
            pts.append((r - bev + bev * math.sin(t), z + bev - bev * math.cos(t), side))
        else:
            pts.append((r - bev + bev * math.cos(t), z - bev + bev * math.sin(t), side if k < bseg else cap))
    return pts


def boolean_diff(kit, cutters, mats):
    """kit minus every cutter Kit (EXACT solver). Cutter faces keep their own masters (walls, liners)."""
    names = list(kit.mats)
    me = bpy.data.meshes.new('bool_target')
    kit.bm.to_mesh(me)
    for n in names:
        me.materials.append(mats[n])
    ob = bpy.data.objects.new('bool_target', me)
    bpy.context.scene.collection.objects.link(ob)
    tmp = []
    for c in cutters:
        cme = bpy.data.meshes.new('bool_cutter')
        c.bm.to_mesh(cme)
        for n in c.mats:
            cme.materials.append(mats[n])
        cob = bpy.data.objects.new('bool_cutter', cme)
        bpy.context.scene.collection.objects.link(cob)
        cob.hide_render = True
        tmp.append(cob)
        mod = ob.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.material_mode = 'TRANSFER'
        mod.object = cob
    geom.apply_modifiers(ob)
    res = ob.data
    out = Kit(kit.pivot)
    remap = {}
    for i, m in enumerate(res.materials):
        remap[i] = out.mi(m.name if m else names[0])
    for p in res.polygons:
        p.material_index = remap.get(p.material_index, 0)
    out.bm.from_mesh(res)
    bmesh.ops.recalc_face_normals(out.bm, faces=out.bm.faces)
    for cob in tmp:
        cme = cob.data
        bpy.data.objects.remove(cob)
        bpy.data.meshes.remove(cme)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(res)
    kit.free()
    for c in cutters:
        c.free()
    return out


def bisect_fill(kit, co, no):
    """Cut a closed kit with a plane, keep the side behind the normal and cap the hole (stays watertight)."""
    bm = kit.bm
    geom_all = list(bm.verts) + list(bm.edges) + list(bm.faces)
    res = bmesh.ops.bisect_plane(bm, geom=geom_all, dist=1e-7, plane_co=co, plane_no=no, clear_outer=True)
    cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if cut:
        filled = bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        for f in filled['faces']:
            nb = [lf for e in f.edges for lf in e.link_faces if lf is not f]
            if nb:
                f.material_index = nb[0].material_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit


# ---------------------------------------------------------------- decals (shared_kit.md §6)

DECAL = 'kn_decal'
OPEN_MASTERS = ('kn_decal', 'kn_screen')  # open single-sided quads (validator rule 10 exempts them)
LIFT = 0.0002  # decal quads float 0.2 mm off the surface


def atlas_rect(slot, sub=None):
    """Pixel rect (x, y, w, h; y down) of a slot's live area, or of a sub-rect given as fractions
    (u0, v0, u1, v1) of it (trims sample part of a tile). Explicit 4-tuples pass through."""
    if not isinstance(slot, str):
        return tuple(slot)
    x, y, w, h = decal_atlas.slot(slot)['live']
    if sub:
        u0, v0, u1, v1 = sub
        return (x + u0 * w, y + v0 * h, (u1 - u0) * w, (v1 - v0) * h)
    return (x, y, w, h)


def decal_grid(rows, rect, pivot=None):
    """kn_decal quads over a point grid: rows[j][i], j bottom -> top, i left -> right of the printed image.
    UVs map the grid onto `rect` (atlas pixels); Blender v is flipped so the exported glTF v runs top-down."""
    k = Kit(pivot=pivot)
    bm = k.bm
    uv = bm.loops.layers.uv.verify()
    mi = k.mi(DECAL)
    nv, nu = len(rows) - 1, len(rows[0]) - 1
    x, y, w, h = rect
    S = decal_atlas.SIZE
    verts = [[bm.verts.new(p) for p in row] for row in rows]
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            f.material_index = mi
            for loop, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                px = x + w * a / nu
                py = y + h - h * b / nv
                loop[uv].uv = (px / S, 1.0 - py / S)
    return k


def _h(rect, width, height):
    return height if height else width * rect[3] / rect[2]


def decal_plane(slot, centre, normal, up, width, height=None, pivot=None, sub=None, lift=LIFT):
    """Flat decal facing `normal` with the image's up along `up` (right = up x normal)."""
    rect = atlas_rect(slot, sub)
    n = Vector(normal).normalized()
    u = (Vector(up) - n * Vector(up).dot(n)).normalized()
    r = u.cross(n)
    hgt = _h(rect, width, height)
    c = Vector(centre) + n * lift
    rows = [[c + r * (sx * width / 2) + u * (sy * hgt / 2) for sx in (-1, 1)] for sy in (-1, 1)]
    return decal_grid(rows, rect, pivot)


def decal_cylinder(slot, origin, axis, radius, mid, width, height=None, nu=8, pivot=None, sub=None, lift=LIFT,
                   span=None):
    """Decal wrapped round a cylinder (axis through `origin`), image up along `axis`, centred on the outward
    direction `mid`; `width` is the arc length (or `span` radians), height runs along the axis."""
    rect = atlas_rect(slot, sub)
    a = Vector(axis).normalized()
    n0 = (Vector(mid) - a * Vector(mid).dot(a)).normalized()
    t0 = a.cross(n0)                       # image right at the centre line
    ang = span if span is not None else width / radius
    hgt = _h(rect, width if span is None else ang * radius, height)
    rows = []
    for sy in (-1, 1):
        row = []
        for i in range(nu + 1):
            th = -ang / 2 + ang * i / nu
            n = n0 * math.cos(th) + t0 * math.sin(th)
            row.append(Vector(origin) + a * (sy * hgt / 2) + n * (radius + lift))
        rows.append(row)
    return decal_grid(rows, rect, pivot)


def decal_wrap(slot, centre_dir, up, width, surface, height=None, nu=6, nv=2, pivot=None, lift=LIFT, ref=0.12):
    """Decal draped over a star-shaped surface round the origin: grid laid in the tangent plane at centre_dir
    (scaled by `ref`), each point re-projected onto surface(direction) and lifted along that direction."""
    rect = atlas_rect(slot)
    d0 = Vector(centre_dir).normalized()
    u = (Vector(up) - d0 * Vector(up).dot(d0)).normalized()
    r = u.cross(d0)
    hgt = _h(rect, width, height)
    rows = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            p = d0 * ref + r * (-width / 2 + width * i / nu) + u * (-hgt / 2 + hgt * j / nv)
            d = p.normalized()
            row.append(surface(d) + d * lift)
        rows.append(row)
    return decal_grid(rows, rect, pivot)


SCREEN = 'kn_screen'


def screen_quad(centre, normal, up, w, h, pivot=None, lift=0.0):
    """One kn_screen quad, UV 0-1. Exported glTF UVs: u runs left -> right (a bar fills from u = 0, empty, to
    u = 1, full) and v runs bottom (0) -> top (1); Blender stores v flipped, the exporter flips it back."""
    n = Vector(normal).normalized()
    u = (Vector(up) - n * Vector(up).dot(n)).normalized()
    r = u.cross(n)
    c = Vector(centre) + n * lift
    k = Kit(pivot=pivot)
    bm = k.bm
    uvl = bm.loops.layers.uv.verify()
    vs = [bm.verts.new(c + r * (sx * w / 2) + u * (sy * h / 2)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    f.material_index = k.mi(SCREEN)
    for loop, (gu, gv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = (gu, 1.0 - gv)
    return k


def add_decals(pieces, lod, decals):
    """Decals are LOD0 / LOD1 only (LOD2 bakes them into the base colour later, LOD3 drops them)."""
    if lod < 2:
        for i, d in enumerate(decals, 1):
            pieces['decal_%d' % i] = d
    else:
        for d in decals:
            d.free()
    return pieces


# ---------------------------------------------------------------- part assembly

def add_shape_keys(ob, kit):
    """M2 (E1): author kit.shape_keys on the emitted object (Basis + one key each, exported as glTF morph targets
    named by the key, extras.targetNames). The key value is the default weight; `kn_sk__<name>` keeps the meaning
    for .art.json shapeKeys."""
    me = ob.data
    ob.shape_key_add(name='Basis', from_mix=False)
    for name, spec in kit.shape_keys.items():
        target, meaning, default = (tuple(spec) + ('', 0.0))[:3]
        kb = ob.shape_key_add(name=name, from_mix=False)
        if isinstance(target, Kit):
            target.bm.verts.ensure_lookup_table()
            if len(target.bm.verts) != len(me.vertices):
                raise ValueError('%s: shape key %s target has %d verts, mesh has %d'
                                 % (ob.name, name, len(target.bm.verts), len(me.vertices)))
            for i, v in enumerate(target.bm.verts):
                kb.data[i].co = v.co
            target.free()
        else:
            for i, v in enumerate(me.vertices):
                kb.data[i].co = target(v.co.copy())
        kb.slider_min, kb.slider_max = 0.0, 1.0
        kb.value = float(default)
        ob['kn_sk__' + name] = meaning
    kit.shape_keys = {}


class Part:
    def __init__(self, ptype, family, cls, footprint, mass, origin, tri_budget, notes, masters, led_groups='',
                 skins='', hints=None, pipeline=None):
        self.type = ptype
        self.family = family
        self.root_dir = paths.repo_root()
        library.ensure_libs(self.root_dir)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.root = template.new_part(ptype, family, cls, footprint, mass, origin=origin, tri_budget=tri_budget,
                                      notes=notes, led_groups=led_groups, skins=skins)
        for k, v in (hints or {}).items():
            self.root[k] = v
        for k, v in (pipeline or {}).items():
            self.root[k] = v
        self.mats = template.link_masters(list(masters) + [m for m in (DECAL,) if m not in masters],
                                          self.root_dir)
        self.pivots = {}
        self.lod_tris = []

    # -- LODs ---------------------------------------------------------------------------------------

    def _count(self, pieces):
        return sum(k.tris() for k in pieces.values())

    def _free(self, pieces):
        for k in pieces.values():
            k.free()

    def tune(self, build, lod, target, qlo=0.04, qhi=3.0, iters=16):
        """Bisect q so build(lod, q) lands as close as possible to `target` tris."""
        best = None
        lo, hi = qlo, qhi
        tried = {}

        def ev(q):
            q = round(q, 4)
            if q in tried:
                return tried[q]
            pieces = build(lod, q)
            t = self._count(pieces)
            self._free(pieces)
            tried[q] = t
            return t

        for _ in range(iters):
            mid = (lo + hi) / 2
            t = ev(mid)
            if t > target:
                hi = mid
            else:
                lo = mid
        for q in (qlo, qhi):
            ev(q)
        best = min(tried.items(), key=lambda kv: (abs(kv[1] - target), -kv[0]))
        return best[0], best[1]

    def fit(self, build, lod, cap, qlo=0.04, qhi=1.0, iters=18):
        """Largest q whose build stays within `cap` tris."""
        best = qlo
        for _ in range(iters):
            mid = (qlo + qhi) / 2
            pieces = build(lod, mid)
            t = self._count(pieces)
            self._free(pieces)
            if t <= cap:
                best, qlo = mid, mid
            else:
                qhi = mid
        return best

    def build_lods(self, build, lod0_q=1.0, fixed=None, headroom=0.985):
        """LOD0 at lod0_q (lowered to fit kn_tri_budget), then LOD1..3 tuned to the §4 ratios."""
        fixed = fixed or {}
        budget = self.root.get('kn_tri_budget')
        if budget:
            probe = build(0, lod0_q)
            over = self._count(probe) > budget * headroom
            self._free(probe)
            if over:
                lod0_q = self.fit(build, 0, int(budget * headroom), qhi=lod0_q)
        p0 = build(0, lod0_q)
        t0 = self._count(p0)
        self._emit(0, p0)
        report = [('LOD0', lod0_q, t0)]
        for lod, name in ((1, 'LOD1'), (2, 'LOD2'), (3, 'LOD3')):
            if lod in fixed:
                q = fixed[lod]
            else:
                q, _ = self.tune(build, lod, t0 * LOD_RATIOS[name])
            pieces = build(lod, q)
            report.append((name, q, self._count(pieces)))
            self._emit(lod, pieces)
        for name, q, t in report:
            print('  %s q=%.3f tris=%d (%.1f %%)' % (name, q, t, 100.0 * t / max(1, t0)))
        self.lod_tris = report
        return report

    def _emit(self, lod, pieces):
        col = template.get_collection(LOD_COLLECTIONS[lod])
        for name, kit in pieces.items():
            if not kit.bm.faces:
                kit.free()
                continue
            obname = '%s__%s%s' % (self.type, name, LOD_SUFFIX[lod])
            colors = {}
            for name, fn in kit.colors.items():
                kit.bm.normal_update()
                colors[name] = [fn(f.calc_center_median(), f.normal, kit.mats[f.material_index])
                                for f in kit.bm.faces]
            flat = set(kit.mats) <= set(OPEN_MASTERS)  # decal / screen quads keep their authored winding
            ob = geom.object_from_bmesh(obname, kit.bm, [self.mats[n] for n in kit.mats], col,
                                        recalc_normals=not flat)
            for name, vals in colors.items():
                attr = ob.data.color_attributes.new(name, 'BYTE_COLOR', 'CORNER')
                for poly, rgba in zip(ob.data.polygons, vals):
                    for li in poly.loop_indices:
                        attr.data[li].color = rgba
            geom.set_sharp_by_angle(ob.data, SHARP_DEG[lod])
            if getattr(kit, 'shape_keys', None):  # M2 (E1): shape keys (glTF morph targets)
                add_shape_keys(ob, kit)
            if kit.pivot:
                piv = self.pivots[kit.pivot]
                ob.parent = piv
                ob.matrix_parent_inverse = piv.matrix_world.inverted()

    # -- helpers objects ----------------------------------------------------------------------------

    def pivot(self, name, loc, axis, lo=None, hi=None, **props):
        ob = bpy.data.objects.new('PIVOT__' + name, None)
        ob.empty_display_type = 'ARROWS'
        ob.empty_display_size = 0.03
        ob.location = loc
        ob['axis'] = axis
        if lo is not None:
            ob['min'] = float(lo)
        if hi is not None:
            ob['max'] = float(hi)
        for k, v in props.items():
            ob[k] = v
        template.get_collection('PIVOT').objects.link(ob)
        bpy.context.view_layer.update()
        self.pivots[ob.name] = ob
        return ob.name

    def port(self, channel, name, loc, direction, size, dir, max_links=None, kind=None):
        ob = ports.add_port(channel, name, Vector(loc), Vector(direction), size=size, dir=dir, max_links=max_links,
                            kind=kind)
        bpy.context.view_layer.update()
        ports.snap_port_ring(ob, size=size, snap_to_surface=False, root_dir=self.root_dir)
        return ob

    def _col(self, kind, name, kit, matrix=None, phys='powder', **props):
        me = bpy.data.meshes.new('COL__%s__%s' % (kind, name))
        kit.bm.to_mesh(me)
        kit.free()
        ob = template.add_col(kind, name, me, phys=phys, **props)
        if matrix is not None:
            ob.matrix_world = matrix
        return ob

    def col_box(self, name, size, center, phys='powder', matrix=None, **props):
        k = Kit()
        sx, sy, sz = size
        k.hull([(x * sx / 2, y * sy / 2, z * sz / 2) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], 'x')
        m = at(*center) if matrix is None else matrix @ at(*center)
        return self._col('box', name, k, m, phys, **props)

    def col_cyl(self, name, r, length, center, axis='z', phys='powder', segs=24, **props):
        k = Kit()
        k.cyl(r, -length / 2, length / 2, 'x', segs)
        return self._col('cylinder', name, k, frame(center, axis), phys, **props)

    def col_capsule(self, name, r, length, center, axis='z', phys='powder', segs=16, **props):
        k = Kit()
        h = length / 2 - r
        prof = [(0.0, -h - r, 'x')]
        for i in range(1, 5):
            t = -math.pi / 2 + math.pi / 2 * i / 4
            prof.append((r * math.cos(t), -h + r * math.sin(t), 'x'))
        for i in range(0, 4):
            t = math.pi / 2 * i / 4
            prof.append((r * math.cos(t), h + r * math.sin(t), 'x'))
        prof.append((0.0, h + r, 'x'))
        k.lathe(dedupe(prof), segs)
        return self._col('capsule', name, k, frame(center, axis), phys, **props)

    def col_sphere(self, name, r, center=(0, 0, 0), phys='powder', **props):
        k = Kit()
        k.sphere(r, 'x', 16, 8)
        return self._col('sphere', name, k, at(*center), phys, **props)

    def col_hull(self, name, points, phys='powder', **props):
        k = Kit()
        k.hull(points, 'x')
        return self._col('hull', name, k, None, phys, **props)

    def sensor(self, kind, name, points, **props):
        k = Kit()
        k.hull(points, 'x')
        me = bpy.data.meshes.new('SENSOR__%s__%s' % (kind, name))
        k.bm.to_mesh(me)
        k.free()
        ob = bpy.data.objects.new(me.name, me)
        ob.display_type = 'WIRE'
        ob.hide_render = True
        for kk, v in props.items():
            ob[kk] = v
        template.get_collection('SENSOR').objects.link(ob)
        return ob

    def emit(self, fx, name, loc, direction):
        ob = bpy.data.objects.new('EMIT__%s__%s' % (fx, name), None)
        ob.empty_display_type = 'SINGLE_ARROW'
        ob.empty_display_size = 0.02
        ob.matrix_world = Matrix.Translation(Vector(loc)) @ geom.track_matrix(direction).to_4x4()
        template.get_collection('EMIT').objects.link(ob)
        return ob

    def screen(self, name, w, h, center, normal=(0, -1, 0), up=(0, 0, 1), **props):
        """SCREEN__<name> quad for .art.json screens[] (ASSET_PIPELINE §3.7): the same quad, UVs and place as
        the RENDER kn_screen quad from screen_quad(), so the engine can match the two."""
        k = screen_quad(center, normal, up, w, h, lift=0.0)
        me = bpy.data.meshes.new('SCREEN__' + name)
        k.bm.to_mesh(me)
        k.free()
        me.materials.append(template.link_masters([SCREEN], self.root_dir)[SCREEN])
        ob = bpy.data.objects.new(me.name, me)
        for kk, v in props.items():
            ob[kk] = v
        template.get_collection('SCREEN').objects.link(ob)
        return ob

    def save(self, out_path=None):
        out_path = out_path or paths.source_blend(self.root_dir, self.family, self.type)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups next to sources
        bpy.ops.wm.save_as_mainfile(filepath=out_path, compress=True, relative_remap=True)
        print('saved', out_path)
        return out_path
