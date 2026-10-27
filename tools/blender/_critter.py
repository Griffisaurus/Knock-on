"""Shared critter builder (M2, stream E2): soft-sculpt body, rig, skin weights, face shape keys, ragdoll
capsules, LODs and baked clips for the make_<critter>.py scripts (docs/art/briefs/critters.md,
ASSET_PIPELINE §6, ART_BIBLE §8).

A critter spec is plain data in root space (the brief's frame: floor = z 0, nose toward -Y, +X = the
critter's left). The builder shifts everything by -COM so the part origin is the centre of mass
(ASSET_PIPELINE §3.2 free bodies) and the `root` bone sits on the floor under it.

Pipeline per critter:
  body       metaball elements (ellipsoids / capsules, each bound to a bone) -> watertight mesh, decimated
             to the LOD budget; faces get a fur master by region (the brief's texture-mask regions)
  pieces     closed accessory / face meshes (eyes, catchlights, lids, brows, mouth, nose, collar, ...);
             face pieces are parametric so every shape key rebuilds them with the same topology
  weights    each body vertex is weighted by the metaball field of the elements around it (the same field
             that made the surface), top 4 bones, normalised; pieces are rigid or use their own fields
  LODs       LOD0..3 = one skinned mesh each (RENDER / LOD1..3), 50 / 25 / 8 % of LOD0
  rig        `RIG` armature (deform bones per brief), RAG__<bone> capsules with swing / twist / mass
  clips      actions `<type>__<clip>` at 30 fps, each in its own muted NLA track (glTF: one animation each)
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kn_tools import kit, template  # noqa: E402
from kn_tools.conventions import LOD_COLLECTIONS, LOD_RATIOS  # noqa: E402

FPS = 30
MB_STIFF = 2.0
MB_THRESH = 0.6
MB_K = 0.575          # surface radius / element radius at stiffness 2, threshold 0.6 (measured)
LOD_SUFFIX = ('', '__L1', '__L2', '__L3')
REQUIRED_CLIPS = ('idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy',
                  'trapped', 'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused')
# ART_BIBLE §8 face set (basis = neutral).
FACE_KEYS = ('sk_blink_l', 'sk_blink_r', 'sk_happy', 'sk_smug', 'sk_scared', 'sk_angry', 'sk_dizzy', 'sk_sleepy',
             'sk_surprised', 'sk_determined', 'sk_vis_a', 'sk_vis_o', 'sk_vis_e', 'sk_brow_up_l', 'sk_brow_up_r',
             'sk_brow_down_l', 'sk_brow_down_r')


def V(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


# ---------------------------------------------------------------- numpy mesh pieces

class Piece:
    """A closed mesh piece: verts (n,3), faces (list of index tuples), one material, skin weights."""

    def __init__(self, name, verts, faces, mat, bone=None, field=None, smooth=True):
        self.name = name
        self.verts = np.asarray(verts, dtype=np.float64)
        self.faces = [tuple(f) for f in faces]
        self.mat = mat
        self.bone = bone          # rigid binding
        self.field = field        # list of influence Elements (overrides bone)
        self.smooth = smooth
        self.fmats = None         # optional per-face material list
        self.rebuild = None       # params -> verts (face pieces)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


def fix_winding(verts, faces):
    """Flip all faces when the closed piece's signed volume is negative."""
    v = verts
    vol = 0.0
    for f in faces:
        a = v[f[0]]
        for i in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(v[f[i]], v[f[i + 1]]))
    if vol < 0:
        return [tuple(reversed(f)) for f in faces]
    return faces


def sphere_topo(segs, rings):
    faces = []
    n = segs
    for j in range(n):
        faces.append((0, 1 + j, 1 + (j + 1) % n))
    for i in range(rings - 2):
        a, b = 1 + i * n, 1 + (i + 1) * n
        for j in range(n):
            faces.append((a + j, b + j, b + (j + 1) % n, a + (j + 1) % n))
    last = 1 + (rings - 1) * n
    base = 1 + (rings - 2) * n
    for j in range(n):
        faces.append((last, base + (j + 1) % n, base + j))
    return faces


def sphere_unit(segs, rings):
    vs = [(0.0, 0.0, 1.0)]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            vs.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    vs.append((0.0, 0.0, -1.0))
    return np.array(vs)


def xform(verts, m):
    m = np.array(m)
    return verts @ m[:3, :3].T + m[:3, 3]


def frame_matrix(centre, axes=None, rot=None):
    """4x4 from a centre and either a 3x3 basis (columns) or a mathutils rotation."""
    m = Matrix.Identity(4)
    if rot is not None:
        m = rot.to_matrix().to_4x4() if isinstance(rot, Quaternion) else rot.to_4x4()
    elif axes is not None:
        m = Matrix((axes[0], axes[1], axes[2])).transposed().to_4x4()
    m.translation = V(centre)
    return m


def look_basis(fwd, up=(0, 0, 1)):
    """Columns (x, y, z) with y along fwd, z as close to up as possible."""
    y = V(fwd).normalized()
    z = V(up)
    x = y.cross(z)
    if x.length < 1e-6:
        x = y.cross(Vector((0, -1, 0)))
    x.normalize()
    z = x.cross(y).normalized()
    return (x, y, z)


def ellipsoid(name, centre, semi, mat, segs=16, rings=10, rot=None, bone=None, field=None):
    u = sphere_unit(segs, rings) * np.array(semi)
    m = frame_matrix(centre, rot=rot)
    faces = fix_winding(u, sphere_topo(segs, rings))
    return Piece(name, xform(u, m), faces, mat, bone=bone, field=field)


def torus(name, centre, axis, R, r, mat, maj=32, mn=8, bone=None, field=None, squash=1.0):
    x, y, z = look_basis(axis, up=(0, -1, 0)) if abs(V(axis).normalized().z) > 0.9 else look_basis(axis)
    # ring lies in the plane normal to `axis` (= y of the basis)
    vs, faces = [], []
    Ra, Rb = (R, R) if isinstance(R, (int, float)) else R   # elliptical ring: radius along x / z of the basis
    for i in range(maj):
        a = 2 * math.pi * i / maj
        ring = math.cos(a) * Ra * x + math.sin(a) * Rb * z
        cdir = ring.normalized()
        for j in range(mn):
            b = 2 * math.pi * j / mn
            p = V(centre) + ring + cdir * (r * math.cos(b)) + y * (r * math.sin(b) * squash)
            vs.append(p[:])
    for i in range(maj):
        for j in range(mn):
            a, b = i * mn + j, i * mn + (j + 1) % mn
            c, d = ((i + 1) % maj) * mn + (j + 1) % mn, ((i + 1) % maj) * mn + j
            faces.append((a, b, c, d))
    v = np.array(vs)
    return Piece(name, v, fix_winding(v, faces), mat, bone=bone, field=field)


def tube(name, path, radii, mat, sides=10, bone=None, field=None, up=(0, 0, 1)):
    """Closed tube along a polyline with per-point radii, capped with fans."""
    P = [V(p) for p in path]
    n = len(P)
    vs, faces = [], []
    prev_x = None
    for i, p in enumerate(P):
        t = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        if prev_x is None:
            x = t.cross(V(up))
            if x.length < 1e-6:
                x = t.cross(Vector((1, 0, 0)))
            x.normalize()
        else:
            x = (prev_x - t * prev_x.dot(t)).normalized()
        z = x.cross(t).normalized()
        prev_x = x
        for j in range(sides):
            a = 2 * math.pi * j / sides
            vs.append((p + radii[i] * (math.cos(a) * x + math.sin(a) * z))[:])
    for i in range(n - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    c0 = len(vs)
    vs.append(P[0][:])
    c1 = len(vs)
    vs.append(P[-1][:])
    for j in range(sides):
        faces.append((c0, (j + 1) % sides, j))
        base = (n - 1) * sides
        faces.append((c1, base + j, base + (j + 1) % sides))
    v = np.array(vs)
    return Piece(name, v, fix_winding(v, faces), mat, bone=bone, field=field)


def lid_cap(centre, axis, ref, r_out, r_in, alpha_deg, nth, nps):
    """Closed thin spherical-cap shell around `axis` (half-angle alpha). Topology depends only on nth, nps."""
    a = V(axis).normalized()
    e1 = (V(ref) - a * V(ref).dot(a)).normalized()
    e2 = a.cross(e1)
    al = math.radians(alpha_deg)
    c = V(centre)
    vs = [(c + a * r_out)[:]]
    for i in range(1, nth + 1):
        th = al * i / nth
        for j in range(nps):
            ps = 2 * math.pi * j / nps
            d = math.cos(th) * a + math.sin(th) * (math.cos(ps) * e1 + math.sin(ps) * e2)
            vs.append((c + d * r_out)[:])
    for i in range(nth, 0, -1):
        th = al * i / nth
        for j in range(nps):
            ps = 2 * math.pi * j / nps
            d = math.cos(th) * a + math.sin(th) * (math.cos(ps) * e1 + math.sin(ps) * e2)
            vs.append((c + d * r_in)[:])
    vs.append((c + a * r_in)[:])
    return np.array(vs)


def lid_topo(nth, nps):
    faces = []
    for j in range(nps):
        faces.append((0, 1 + j, 1 + (j + 1) % nps))
    rows = 2 * nth
    for i in range(rows - 1):
        a, b = 1 + i * nps, 1 + (i + 1) * nps
        for j in range(nps):
            faces.append((a + j, b + j, b + (j + 1) % nps, a + (j + 1) % nps))
    last = 1 + rows * nps
    base = 1 + (rows - 1) * nps
    for j in range(nps):
        faces.append((last, base + (j + 1) % nps, base + j))
    return faces


# ---------------------------------------------------------------- metaball field

class Element:
    """A metaball element / skin influence in root space. kind: 'ell' (semi-axes) or 'cap' (segment a-b, r)."""

    def __init__(self, kind, bone, centre=None, semi=None, rot=None, a=None, b=None, r=None, gen=True,
                 region=None):
        self.kind = kind
        self.bone = bone
        self.centre = V(centre) if centre is not None else (V(a) + V(b)) / 2
        self.semi = semi
        self.rot = rot or Quaternion()
        self.a = V(a) if a is not None else None
        self.b = V(b) if b is not None else None
        self.r = r
        self.gen = gen          # contributes geometry (False = skin influence only)
        self.region = region

    # metaball parameters
    def mb_params(self):
        if self.kind == 'ell':
            big = max(self.semi)
            R = big / MB_K
            size = [s / (MB_K * R) for s in self.semi]
            return 'ELLIPSOID', self.centre, R, size, self.rot
        d = self.b - self.a
        L = d.length
        R = self.r / MB_K
        q = Vector((1, 0, 0)).rotation_difference(d.normalized()) if L > 1e-9 else Quaternion()
        return 'CAPSULE', self.centre, R, [L / 2, 1, 1], q

    def field(self, P):
        """Metaball field s*(1-(d/R)^2)^3 at points P (n,3) in root space (Blender's falloff)."""
        kind, c, R, size, q = self.mb_params()
        m = q.to_matrix().transposed()
        loc = (P - np.array(c[:])) @ np.array(m).T
        if kind == 'ELLIPSOID':
            s = np.array(size)
            d = np.linalg.norm(loc / s, axis=1)
        else:
            hx = size[0]
            x = np.clip(loc[:, 0], -hx, hx)
            d = np.linalg.norm(loc - np.stack([x, np.zeros_like(x), np.zeros_like(x)], 1), axis=1)
        u = np.clip(1.0 - (d / R) ** 2, 0.0, 1.0)
        return MB_STIFF * u ** 3


MB_SCALE = 20.0   # build the metaball 20x larger: Blender clamps MetaBall.resolution to >= 0.005


def metaball_mesh(elements, res, offset):
    K = MB_SCALE
    mb = bpy.data.metaballs.new('critter_mb')
    mb.resolution = res * K
    mb.render_resolution = res * K
    mb.threshold = MB_THRESH
    for e in elements:
        if not e.gen:
            continue
        kind, c, R, size, q = e.mb_params()
        el = mb.elements.new()
        el.type = kind
        el.co = (c - offset) * K
        el.radius = R * K
        el.stiffness = MB_STIFF
        if kind == 'CAPSULE':
            size = [size[0] * K, size[1], size[2]]   # capsule half-length is absolute
        el.size_x, el.size_y, el.size_z = size
        el.rotation = q
    ob = bpy.data.objects.new('critter_mb', mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    me.transform(Matrix.Scale(1.0 / K, 4))
    return me


def mesh_arrays(me):
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', v)
    t = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', t)
    return v.reshape(-1, 3), t.reshape(-1, 3)


def decimate_to(me, target):
    """Collapse-decimate a mesh datablock (in place) to about `target` triangles."""
    ob = bpy.data.objects.new('dec', me)
    bpy.context.scene.collection.objects.link(ob)
    for _ in range(3):
        me.calc_loop_triangles()
        cur = len(me.loop_triangles)
        if cur <= target * 1.002:
            break
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / cur
        mod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.remove(mod)
        ob.data = new
        bpy.data.meshes.remove(me)
        me = new
    bpy.data.objects.remove(ob)
    return me


def is_watertight(verts, faces):
    edges = {}
    for f in faces:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            k = (a, b) if a < b else (b, a)
            edges[k] = edges.get(k, 0) + 1
    return sum(1 for c in edges.values() if c != 2)


# ---------------------------------------------------------------- face (parametric pieces)

NEUTRAL = {'lid_up': 50.0, 'lid_lo': 38.0, 'tilt': 0.0, 'eye': 1.0, 'brow_dz': 0.0, 'brow_tilt': 0.0,
           'mouth_sx': 1.0, 'mouth_sz': 1.0, 'curve': 0.0, 'skew': 0.0, 'mouth_fwd': 0.0, 'tongue': 0.0,
           'catch': 1.0, 'whisk': 0.0, 'nose_dz': 0.0}

# key -> overrides; values may be (left, right) pairs
FACE_KEY_PARAMS = {
    'sk_blink_l': {'lid_up': (124.0, None)},
    'sk_blink_r': {'lid_up': (None, 124.0)},
    'sk_happy': {'lid_lo': 82.0, 'lid_up': 62.0, 'curve': 1.0, 'brow_dz': 0.25},
    'sk_smug': {'lid_up': 92.0, 'lid_lo': 56.0, 'curve': 0.5, 'skew': 0.6, 'brow_dz': -0.15},
    'sk_scared': {'lid_up': 30.0, 'lid_lo': 26.0, 'eye': 1.12, 'brow_dz': 0.6, 'brow_tilt': -15.0,
                  'mouth_sz': 1.6, 'mouth_sx': 0.8, 'curve': -0.6},
    'sk_angry': {'lid_up': 80.0, 'tilt': 22.0, 'brow_dz': -0.45, 'brow_tilt': 25.0, 'curve': -0.8,
                 'mouth_sx': 1.1},
    'sk_dizzy': {'lid_up': (86.0, 58.0), 'lid_lo': (38.0, 62.0), 'skew': -0.8, 'mouth_sz': 1.5},
    'sk_sleepy': {'lid_up': 100.0, 'lid_lo': 52.0, 'brow_dz': -0.2},
    'sk_surprised': {'lid_up': 28.0, 'lid_lo': 28.0, 'eye': 1.08, 'brow_dz': 0.85, 'mouth_sx': 0.7,
                     'mouth_sz': 2.3},
    'sk_determined': {'lid_up': 76.0, 'tilt': 15.0, 'lid_lo': 55.0, 'brow_dz': -0.3, 'brow_tilt': 18.0,
                      'curve': -0.2},
    'sk_vis_a': {'mouth_sz': 3.2, 'mouth_sx': 1.1},
    'sk_vis_o': {'mouth_sz': 2.3, 'mouth_sx': 0.7, 'mouth_fwd': 1.0},
    'sk_vis_e': {'mouth_sz': 1.6, 'mouth_sx': 1.5},
    'sk_brow_up_l': {'brow_dz': (0.8, None)},
    'sk_brow_up_r': {'brow_dz': (None, 0.8)},
    'sk_brow_down_l': {'brow_dz': (-0.6, None), 'brow_tilt': (15.0, None)},
    'sk_brow_down_r': {'brow_dz': (None, -0.6), 'brow_tilt': (None, 15.0)},
    # extras (critters.md per brief)
    'sk_blep': {'tongue': 1.0},
    'sk_whiskers_fwd': {'whisk': 1.0},
    'sk_nose_twitch': {'nose_dz': 1.0},
    'sk_pucker': {'mouth_sx': 0.55, 'mouth_sz': 1.3, 'mouth_fwd': 1.6},
    'sk_gulp': {'mouth_sz': 2.6, 'mouth_sx': 0.9},
    'sk_grin_sly': {'skew': 1.0, 'curve': 0.8, 'lid_up': (70.0, 50.0)},
    'sk_eyes_sparkle': {'lid_lo': 74.0, 'lid_up': 70.0, 'catch': 1.6, 'curve': 0.7},
}


def side_params(base, over, side):
    p = dict(base)
    for k, v in over.items():
        if isinstance(v, tuple):
            v = v[0] if side == 'l' else v[1]
            if v is None:
                continue
        p[k] = v
    return p


class Face:
    """Eyes, catchlights, lids, brows, mouth, nose, tongue, whiskers built from a face spec (root space)."""

    def __init__(self, spec, mats):
        self.s = spec
        self.m = mats

    def pieces(self, lod):
        s = self.s
        out = []
        q = (1.0, 0.75, 0.5, 0.3)[lod]
        es, er = max(8, int(20 * q)), max(6, int(12 * q))
        nth, nps = max(3, int(6 * q)), max(8, int(20 * q))
        for side, sx in (('l', 1), ('r', -1)):
            c = V(s['eye']) * Vector((sx, 1, 1))
            r = s['eye_r']
            fwd = V(s.get('eye_fwd', (0.25, -1, 0.05))) * Vector((sx, 1, 1))
            bx, by, bz = look_basis(fwd)

            def eye_build(p, c=c, r=r, side=side):
                k = side_params(NEUTRAL, p, side)['eye']
                return xform(sphere_unit(es, er) * (r * k), frame_matrix(c))
            pc = Piece('eye_' + side, eye_build({}), fix_winding(sphere_unit(es, er), sphere_topo(es, er)),
                       self.m['eye'], bone='eye_' + side)
            pc.rebuild = eye_build
            out.append(pc)
            # catchlights: modelled as geometry, painted bone (ART_BIBLE §8)
            for ci, (du, dr, rr) in enumerate(((0.45, 0.30, 0.26), (-0.10, -0.42, 0.13))):
                def cat_build(p, c=c, r=r, du=du, dr=dr, rr=rr, side=side, bx=bx, by=by, bz=bz, sx=sx):
                        sp = side_params(NEUTRAL, p, side)
                        k, kc = sp['eye'], sp['catch']
                        d = (by * 0.80 + bz * du + bx * (dr * sx) * -1).normalized()
                        cc = c + d * (r * k * 0.93)
                        return xform(sphere_unit(8, 6) * (r * rr * kc), frame_matrix(cc))
                pc = Piece('catch_%s_%d' % (side, ci), cat_build({}), fix_winding(sphere_unit(8, 6), sphere_topo(8, 6)),
                           self.m['catch'], bone='eye_' + side)
                pc.rebuild = cat_build
                if lod < 3:
                    out.append(pc)
            # lids: upper (axis up, tilted by `tilt` toward the inner corner), lower (axis down)
            lids = (('up', 1),) if s.get('upper_lids_only') else (('up', 1), ('lo', -1))
            for lid, sgn in lids:
                def lid_build(p, c=c, r=r, lid=lid, sgn=sgn, side=side, bx=bx, by=by, bz=bz, sx=sx):
                    sp = side_params(NEUTRAL, p, side)
                    k = sp['eye']
                    alpha = sp['lid_up'] if lid == 'up' else sp['lid_lo']
                    ax = bz * sgn
                    if lid == 'up' and sp['tilt']:
                        inner = bx * (-sx)  # toward the nose: the lid drops on the inner corner
                        ph = math.radians(sp['tilt'])
                        ax = (bz * math.cos(ph) + inner * math.sin(ph)).normalized()
                    ref = by
                    return lid_cap(c, ax, ref, r * k * 1.10, r * k * 1.03, alpha, nth, nps)
                topo = lid_topo(nth, nps)
                v0 = lid_build({})
                topo = fix_winding(v0, topo)
                pc = Piece('lid_%s_%s' % (lid, side), v0, topo, self.m['lid'], bone='head')
                pc.rebuild = lid_build
                out.append(pc)
            # brows: a fur ridge above each eye
            if s.get('brow'):
                bsemi = s['brow_semi']

                def brow_build(p, c=c, r=r, side=side, bx=bx, by=by, bz=bz, sx=sx, bsemi=bsemi):
                    sp = side_params(NEUTRAL, p, side)
                    off = V(s['brow']) * Vector((sx, 1, 1))
                    cc = c + off + Vector((0, 0, sp['brow_dz'] * r * 0.55))
                    rot = Matrix.Rotation(math.radians(sp['brow_tilt'] * sx + s.get('brow_rest_tilt', 0) * sx), 3,
                                          by)
                    return xform(sphere_unit(10, 6) * np.array(bsemi), frame_matrix(cc, rot=rot @ Matrix(
                        (bx, by, bz)).transposed()))
                pc = Piece('brow_' + side, brow_build({}), fix_winding(sphere_unit(10, 6), sphere_topo(10, 6)),
                           self.m['brow'], bone='head')
                pc.rebuild = brow_build
                out.append(pc)
            # whiskers
            if s.get('whiskers') and lod < 2:
                for wi, (dz, ang) in enumerate(s['whiskers']['set']):
                    def wh_piece(p, side=side, sx=sx, dz=dz, ang=ang):
                        sp = side_params(NEUTRAL, p, side)
                        w = s['whiskers']
                        base = V(w['base']) * Vector((sx, 1, 1)) + Vector((0, 0, dz))
                        a = math.radians(ang)
                        fwd = math.radians(25) * sp['whisk']
                        d = Vector((math.cos(a) * math.cos(fwd) * sx, -math.sin(fwd) - 0.15, math.sin(a)))
                        d.normalize()
                        pts = [base + d * (w['len'] * t) + Vector((0, 0, -0.15 * w['len'] * t * t)) for t in
                               (0, 0.5, 1.0)]
                        return tube('w', pts, [w['r'], w['r'] * 0.7, w['r'] * 0.3], 'x', sides=4)
                    p0 = wh_piece({})
                    pc = Piece('whisker_%s_%d' % (side, wi), p0.verts, p0.faces, self.m['whisker'], bone='head')
                    pc.rebuild = (lambda p, f=wh_piece: f(p).verts)
                    out.append(pc)
        # mouth: a dark lozenge under the nose; keys scale / curve / skew it
        if s.get('mouth'):
            ms = s['mouth_semi']
            mseg, mring = max(10, int(16 * q)), max(6, int(8 * q))

            def mouth_build(p):
                sp = side_params(NEUTRAL, p, 'l')
                u = sphere_unit(mseg, mring) * np.array([ms[0] * sp['mouth_sx'], ms[1], ms[2] * sp['mouth_sz']])
                xn = u[:, 0] / max(1e-9, ms[0] * sp['mouth_sx'])
                u[:, 2] += (sp['curve'] * xn * xn + sp['skew'] * xn * 0.6) * ms[2] * 1.6
                u[:, 1] -= sp['mouth_fwd'] * ms[1] * 1.2
                return xform(u, frame_matrix(s['mouth']))
            pc = Piece('mouth', mouth_build({}), fix_winding(sphere_unit(mseg, mring), sphere_topo(mseg, mring)),
                       self.m['mouth'], bone=s.get('mouth_bone', 'jaw'))
            pc.rebuild = mouth_build
            out.append(pc)
        if s.get('tongue') and lod < 2:
            ts = s['tongue_semi']

            def tongue_build(p):
                sp = side_params(NEUTRAL, p, 'l')
                c = V(s['tongue']) + Vector((0, -ts[1] * 1.6, -ts[2] * 1.2)) * sp['tongue']
                return xform(sphere_unit(10, 6) * np.array(ts), frame_matrix(c))
            pc = Piece('tongue', tongue_build({}), fix_winding(sphere_unit(10, 6), sphere_topo(10, 6)),
                       self.m['tongue'], bone='jaw')
            pc.rebuild = tongue_build
            out.append(pc)
        if s.get('nose'):
            ns = s['nose_semi']

            def nose_build(p):
                sp = side_params(NEUTRAL, p, 'l')
                c = V(s['nose']) + Vector((0, 0, sp['nose_dz'] * ns[2] * 0.6))
                return xform(sphere_unit(12, 8) * np.array(ns), frame_matrix(c))
            pc = Piece('nose', nose_build({}), fix_winding(sphere_unit(12, 8), sphere_topo(12, 8)), self.m['nose'],
                       bone='head')
            pc.rebuild = nose_build
            out.append(pc)
        return out


# ---------------------------------------------------------------- the build

class Critter:
    def __init__(self, spec):
        self.s = spec
        self.type = spec['type']
        self.com = V(spec['com'])
        masters = sorted(set(spec['masters'].values()))
        notes = spec['notes']
        self.part = kit.Part(self.type, 'critters', 'XL', '1,1,1', spec['mass'], 'com', spec['tri_budget'], notes,
                             masters, skins=spec.get('skins', ''),
                             hints={'kn_ragdoll_impulse': spec['ragdoll_impulse']})
        root = self.part.root
        root['kn_role_clips'] = ','.join(spec['role_clips'])
        root['kn_com_root'] = ','.join('%g' % c for c in spec['com'])
        scene = bpy.context.scene
        scene.render.fps = FPS
        scene.render.fps_base = 1.0
        self.mats = self.part.mats
        self.mat_names = spec['masters']   # role -> master id

    # -- rig -------------------------------------------------------------------------------------------
    def build_rig(self):
        col = template.get_collection('RIG')
        arm = bpy.data.armatures.new('RIG')
        ob = bpy.data.objects.new('RIG', arm)
        col.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        ebs = {}
        for b in self.s['bones']:
            name, head, tail, parent = b[0], b[1], b[2], b[3]
            opts = b[4] if len(b) > 4 else {}
            eb = arm.edit_bones.new(name)
            eb.head = V(head) - self.com
            eb.tail = V(tail) - self.com
            d = (eb.tail - eb.head).normalized()
            up = Vector((0, -1, 0)) if abs(d.z) > 0.8 else Vector((0, 0, 1))
            eb.align_roll(up)
            eb.use_deform = opts.get('deform', True)
            if parent:
                eb.parent = ebs[parent]
                eb.use_connect = False
            ebs[name] = eb
        bpy.ops.object.mode_set(mode='OBJECT')
        arm.pose_position = 'REST'
        arm.display_type = 'STICK'
        self.rig = ob
        for pb in ob.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        return ob

    def deform_bones(self):
        return [b.name for b in self.rig.data.bones if b.use_deform]

    # -- body ------------------------------------------------------------------------------------------
    def body_mesh(self, target):
        s = self.s
        els = s['elements']
        # pick a metaball resolution giving ~1.6x the target, then decimate to it
        res = s['mb_res']
        want = target * 1.6
        me = None
        for _ in range(5):
            if me is not None:
                bpy.data.meshes.remove(me)
            me = metaball_mesh(els, res, self.com)
            me.calc_loop_triangles()
            raw = len(me.loop_triangles)
            if want <= raw <= want * 2.5:
                break
            res = res * math.sqrt(raw / (want * 1.4))
        me = decimate_to(me, target)
        v, t = mesh_arrays(me)
        bpy.data.meshes.remove(me)
        self.mb_res_used = res
        return v + np.array(self.com[:]), [tuple(x) for x in t]

    def body_weights(self, P):
        """Field-based weights from the element set (root-space points)."""
        names = self.deform_bones()
        idx = {n: i for i, n in enumerate(names)}
        W = np.zeros((len(P), len(names)))
        F = np.zeros((len(P), len(self.s['elements'])))
        for ei, e in enumerate(self.s['elements']):
            F[:, ei] = e.field(P)
            W[:, idx[e.bone]] += F[:, ei]
        zero = W.sum(1) < 1e-9
        if zero.any():
            # outside every influence: nearest element centre
            C = np.array([e.centre[:] for e in self.s['elements']])
            near = np.argmin(((P[zero, None, :] - C[None]) ** 2).sum(2), axis=1)
            for k, ei in zip(np.nonzero(zero)[0], near):
                W[k, idx[self.s['elements'][ei].bone]] = 1.0
        return limit4(W), names, F

    def region_of(self, centre, normal, bone):
        fn = self.s.get('region')
        return fn(centre, normal, bone) if fn else 'fur'

    # -- assembly --------------------------------------------------------------------------------------
    def build_lod(self, lod, body_target, face):
        s = self.s
        P, faces = self.body_mesh(body_target)
        W, names, _F = self.body_weights(P)
        bone_of = np.argmax(W, axis=1)
        roles = []
        for f in faces:
            c = P[list(f)].mean(0)
            a, b, cc = P[f[0]], P[f[1]], P[f[2]]
            n = np.cross(b - a, cc - a)
            nl = np.linalg.norm(n)
            n = n / nl if nl > 0 else n
            roles.append(self.region_of(c, n, names[bone_of[f[0]]]))
        body = Piece('body', P, faces, 'fur')
        body.fmats = roles
        pieces = [body] + face.pieces(lod) + [p for p in s['accessories'](lod)]
        return self.assemble(lod, pieces, names, W)

    def assemble(self, lod, pieces, names, Wbody):
        idx = {n: i for i, n in enumerate(names)}
        verts, faces, fmat, ranges = [], [], [], {}
        weights = []
        off = 0
        for pc in pieces:
            n = len(pc.verts)
            ranges[pc.name] = (off, off + n, pc)
            verts.append(pc.verts)
            for fi, f in enumerate(pc.faces):
                faces.append(tuple(i + off for i in f))
                fmat.append(pc.fmats[fi] if pc.fmats else pc.mat)
            if pc.name == 'body':
                weights.append(Wbody)
            elif pc.field:
                W = np.zeros((n, len(names)))
                for e in pc.field:
                    W[:, idx[e.bone]] += e.field(pc.verts)
                z = W.sum(1) < 1e-9
                if z.any():
                    W[z, idx[pc.field[0].bone]] = 1.0
                weights.append(limit4(W))
            else:
                W = np.zeros((n, len(names)))
                W[:, idx[pc.bone]] = 1.0
                weights.append(W)
            off += n
        V0 = np.concatenate(verts) - np.array(self.com[:])
        Wall = np.concatenate(weights)
        open_edges = is_watertight(None, faces)
        # one slot per master (several roles may share one), faces sorted by slot so each LOD exports one
        # primitive per material
        order = list(dict.fromkeys(self.mat_names[r] for r in self.mat_names))
        used = sorted({self.mat_names[r] for r in fmat}, key=order.index)
        mats = [self.mats[m] for m in used]
        mi = [used.index(self.mat_names[r]) for r in fmat]
        perm = sorted(range(len(faces)), key=lambda i: mi[i])
        faces = [faces[i] for i in perm]
        mi = [mi[i] for i in perm]
        name = '%s__body%s' % (self.type, LOD_SUFFIX[lod])
        me = bpy.data.meshes.new(name)
        me.from_pydata(V0.tolist(), [], faces)
        for m in mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', mi)
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.update()
        # triangulate now and drop doubled triangles, so the glTF exporter (which drops repeated
        # triangles) writes exactly the triangle count the validator and .art.json report
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        seen, dup = {}, []
        for f in bm.faces:   # decimation can leave a doubled triangle pair (same 3 verts): drop both
            k = tuple(sorted(v.index for v in f.verts))
            if k in seen:
                dup += [f, seen[k]]
            else:
                seen[k] = f
        if dup:
            bmesh.ops.delete(bm, geom=list(set(dup)), context='FACES_ONLY')
        bm.to_mesh(me)
        bm.free()
        me.update()
        assert len(me.vertices) == len(V0), 'degenerate cleanup removed vertices: weights would shift'
        ob = bpy.data.objects.new(name, me)
        template.get_collection(LOD_COLLECTIONS[lod]).objects.link(ob)
        # skin
        groups = {}
        for n in names:
            groups[n] = ob.vertex_groups.new(name=n)
        nz = np.nonzero(Wall)
        for vi, bi in zip(*nz):
            groups[names[bi]].add([int(vi)], float(Wall[vi, bi]), 'REPLACE')
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = self.rig
        mod.use_vertex_groups = True
        self.lod_objects = getattr(self, 'lod_objects', {})
        self.lod_objects[lod] = (ob, ranges)
        print('  LOD%d: %d verts, %d tris, open edges %d' % (lod, len(V0), tri_count(ob), open_edges))
        return ob

    # -- shape keys ------------------------------------------------------------------------------------
    def shape_keys(self, lod, keys):
        ob, ranges = self.lod_objects[lod]
        me = ob.data
        n = len(me.vertices)
        base = np.empty(n * 3)
        me.vertices.foreach_get('co', base)
        base = base.reshape(-1, 3)
        ob.shape_key_add(name='Basis', from_mix=False)
        body = ranges['body']
        b0, b1, _ = body
        # body normals for the body-level keys
        nrm = np.empty(n * 3)
        me.vertices.foreach_get('normal', nrm)
        nrm = nrm.reshape(-1, 3)
        com = np.array(self.com[:])
        for key in keys:
            co = base.copy()
            params = FACE_KEY_PARAMS.get(key, {})
            for pname, (a, b, pc) in ranges.items():
                if pc.rebuild is not None:
                    co[a:b] = pc.rebuild(params) - com
            extra = self.s.get('body_keys', {}).get(key)
            if extra:
                co[b0:b1] = extra(co[b0:b1] + com, nrm[b0:b1]) - com
            for pname, fn in self.s.get('piece_keys', {}).get(key, {}).items():
                if pname in ranges:
                    a, b, pc = ranges[pname]
                    co[a:b] = fn(co[a:b] + com) - com
            kb = ob.shape_key_add(name=key, from_mix=False)
            kb.data.foreach_set('co', co.ravel())
            kb.value = 0.0
        return keys

    # -- ragdoll ---------------------------------------------------------------------------------------
    def ragdoll(self):
        col = template.get_collection('RIG')
        out = []
        bones = self.rig.data.bones
        for rd in self.s['ragdoll']:
            bone = bones[rd['bone']]
            a = V(rd.get('a', bone.head_local + self.com))
            b = V(rd.get('b', bone.tail_local + self.com))
            r = rd['r']
            d = b - a
            L = d.length
            k = kit.Kit()
            h = max(0.0, L / 2)
            prof = [(0.0, -h - r, 'x')]
            for i in range(1, 5):
                t = -math.pi / 2 + math.pi / 2 * i / 4
                prof.append((r * math.cos(t), -h + r * math.sin(t), 'x'))
            for i in range(0, 4):
                t = math.pi / 2 * i / 4
                prof.append((r * math.cos(t), h + r * math.sin(t), 'x'))
            prof.append((0.0, h + r, 'x'))
            k.lathe(kit.dedupe(prof), 12)
            me = bpy.data.meshes.new('RAG__' + rd['bone'])
            k.bm.to_mesh(me)
            k.free()
            ob = bpy.data.objects.new('RAG__' + rd['bone'], me)
            q = Vector((0, 0, 1)).rotation_difference(d.normalized()) if L > 1e-9 else Quaternion()
            ob.matrix_world = Matrix.Translation((a + b) / 2 - self.com) @ q.to_matrix().to_4x4()
            ob['bone'] = rd['bone']
            if 'parent' in rd:
                ob['rag_parent'] = rd['parent'] or ''
            ob['swing_deg'] = float(rd['swing'])
            ob['twist_deg'] = float(rd['twist'])
            ob['mass'] = float(rd['mass'])
            ob['phys'] = 'fur'
            ob['radius'] = float(r)
            ob['half_height'] = float(h)
            for kk in ('friction', 'restitution'):
                if kk in self.s['phys']:
                    ob[kk] = float(self.s['phys'][kk])
            ob.display_type = 'WIRE'
            ob.hide_render = True
            col.objects.link(ob)
            out.append(ob)
        return out

    # -- clips -----------------------------------------------------------------------------------------
    def clips(self, library):
        import _critter_anim as anim
        rig = self.rig
        rig.animation_data_create()
        made = []
        for name, entry in library.items():
            if name.startswith('_'):
                continue
            frames, loop, fn = entry
            act = anim.bake_action(rig, '%s__%s' % (self.type, name), frames, loop, fn, self.s['anim'])
            act['kn_loop'] = bool(loop)
            act['kn_frames'] = int(frames)
            tr = rig.animation_data.nla_tracks.new()
            tr.name = act.name
            tr.strips.new(act.name, 0, act)
            tr.mute = True
            made.append(name)
        rig.animation_data.action = None
        return made

    # -- emitters --------------------------------------------------------------------------------------
    def emitters(self):
        for fx, name, loc, d, bone in self.s['emitters']:
            ob = self.part.emit(fx, name, V(loc) - self.com, d)
            ob['bone'] = bone

    # -- main ------------------------------------------------------------------------------------------
    def build(self, library):
        s = self.s
        self.build_rig()
        face = Face(s['face'], {r: r for r in ('eye', 'catch', 'lid', 'brow', 'mouth', 'nose', 'tongue',
                                               'whisker')} | s.get('face_roles', {}))
        budget = min(s['tri_budget'], max(s['tri_budget'] * 0.975, 25150))  # XL floor is 25k (class budget)
        fixed = sum(p.tris() for p in face.pieces(0) + s['accessories'](0))
        ob0 = self.build_lod(0, budget - fixed, face)
        t0 = tri_count(ob0)
        for lod in (1, 2, 3):
            target = t0 * LOD_RATIOS['LOD%d' % lod]
            fx = sum(p.tris() for p in face.pieces(lod) + s['accessories'](lod))
            self.build_lod(lod, max(200, target - fx), face)
        keys = list(FACE_KEYS) + list(s.get('extra_keys', ()))
        for lod in (0, 1):
            self.shape_keys(lod, keys)
        self.ragdoll()
        c = s['col']
        self.part.col_capsule('0', c['r'], c['length'], V(c['centre']) - self.com, axis=(0, 1, 0), phys='fur',
                              **s['phys'])
        self.emitters()
        made = self.clips(library)
        # catalogue footprint from the built LOD0 (free bodies use their catalogue size, §3.1)
        dg = bpy.context.evaluated_depsgraph_get()
        pts = np.array([v.co[:] for v in ob0.evaluated_get(dg).to_mesh().vertices])
        ob0.evaluated_get(dg).to_mesh_clear()
        lo, hi = pts.min(0), pts.max(0)
        size = hi - lo
        self.part.root['kn_footprint'] = '%g,%g,%g' % (round(size[0] * 10, 2), round(size[2] * 10, 2),
                                                       round(size[1] * 10, 2))
        print('  footprint (cells) %s, size %s m, root-space z %.3f..%.3f' % (
            self.part.root['kn_footprint'], np.round(size, 3), lo[2] + self.com.z, hi[2] + self.com.z))
        print('  clips (%d): %s' % (len(made), ', '.join(made)))
        self.rig.data.pose_position = 'REST'
        return self


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def limit4(W):
    """Keep the 4 largest weights per row, normalise to 1."""
    if W.shape[1] > 4:
        part = np.argpartition(-W, 4, axis=1)[:, 4:]
        np.put_along_axis(W, part, 0.0, axis=1)
    top = np.argmax(W, axis=1)
    W[W < 1e-3 * W.max(1, keepdims=True)] = 0.0   # drop influences under 0.1 % of the strongest
    dead = W.sum(1) <= 0
    W[dead, top[dead]] = 1.0
    s = W.sum(1, keepdims=True)
    s[s == 0] = 1.0
    return W / s


# ---------------------------------------------------------------- spec helpers

def ell(bone, centre, semi, rot=None, gen=True):
    if rot is not None and not isinstance(rot, Quaternion):
        from mathutils import Euler
        rot = Euler([math.radians(a) for a in rot]).to_quaternion()
    return Element('ell', bone, centre=centre, semi=semi, rot=rot, gen=gen)


def cap(bone, a, b, r, gen=True):
    return Element('cap', bone, a=a, b=b, r=r, gen=gen)


def rag(bone, parent, a, b, r, mass, swing, twist):
    """A RAG__ capsule given as stream B's ragdoll row (packages/parts-data/src/critters.ts): joint `a` -> end `b`
    in *engine* root space (x, y up, z = nose). Stored in Blender root space (x, -z, y) for the builder."""
    return dict(bone=bone, parent=parent, a=(a[0], -a[2], a[1]), b=(b[0], -b[2], b[1]), r=r, mass=mass,
                swing=swing, twist=twist)


def mirror(p):
    return (-p[0], p[1], p[2])


def chain_points(pts, n):
    """Resample a polyline to n+1 evenly spaced points."""
    P = [V(p) for p in pts]
    L = [0.0]
    for i in range(1, len(P)):
        L.append(L[-1] + (P[i] - P[i - 1]).length)
    out = []
    for k in range(n + 1):
        s = L[-1] * k / n
        i = max(1, min(len(P) - 1, next((j for j in range(1, len(P)) if L[j] >= s), len(P) - 1)))
        t = (s - L[i - 1]) / max(1e-9, L[i] - L[i - 1])
        out.append(P[i - 1].lerp(P[i], t))
    return out
