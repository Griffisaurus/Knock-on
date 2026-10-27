"""Mesh helpers shared by the builders, validator and exporter (bpy + bmesh, no operators).

Everything here avoids bpy.ops so it runs the same in the UI and in `blender -b`.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector


# ---------------------------------------------------------------- evaluation

class EvaluatedMesh:
    """Context manager: the modifier-evaluated mesh of an object (freed on exit)."""

    def __init__(self, ob, depsgraph=None):
        self.ob = ob
        self.dg = depsgraph or bpy.context.evaluated_depsgraph_get()
        self.eval_ob = None
        self.mesh = None

    def __enter__(self):
        self.eval_ob = self.ob.evaluated_get(self.dg)
        self.mesh = self.eval_ob.to_mesh()
        return self.mesh

    def __exit__(self, *exc):
        self.eval_ob.to_mesh_clear()
        return False


def tri_count(ob, depsgraph=None):
    if ob.type not in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT'):
        return 0
    with EvaluatedMesh(ob, depsgraph) as me:
        if me is None:
            return 0
        me.calc_loop_triangles()
        return len(me.loop_triangles)


def world_points(ob, depsgraph=None):
    """Evaluated vertex positions in world space."""
    if ob.type != 'MESH':
        return [ob.matrix_world.translation.copy()]
    mw = ob.matrix_world
    with EvaluatedMesh(ob, depsgraph) as me:
        return [mw @ v.co for v in me.vertices]


def local_points(ob, depsgraph=None):
    with EvaluatedMesh(ob, depsgraph) as me:
        return [v.co.copy() for v in me.vertices]


def bounds(points):
    if not points:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


def is_manifold(ob, depsgraph=None):
    """True when every edge has exactly two faces (closed, watertight: needed for the SDF bake)."""
    with EvaluatedMesh(ob, depsgraph) as me:
        bm = bmesh.new()
        bm.from_mesh(me)
        try:
            bad = sum(1 for e in bm.edges if not e.is_manifold or e.is_boundary)
            return bad == 0, bad
        finally:
            bm.free()


def is_convex(ob, depsgraph=None, tol=1e-5):
    """Every vertex must lie on (or inside within tol) every face plane, and no vertex may be interior."""
    with EvaluatedMesh(ob, depsgraph) as me:
        bm = bmesh.new()
        bm.from_mesh(me)
        try:
            if not bm.faces:
                return False
            bm.normal_update()
            centre = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
            for f in bm.faces:
                n = f.normal
                if (f.calc_center_median() - centre).dot(n) < 0:
                    n = -n  # tolerate flipped faces; the shape is what matters for Jolt
                d = n.dot(f.verts[0].co)
                for v in bm.verts:
                    if n.dot(v.co) - d > tol:
                        return False
            return True
        finally:
            bm.free()


def apply_modifiers(ob):
    """Bake the modifier stack into the object's mesh (no bpy.ops, so it works headless)."""
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    name = old.name
    old.name = name + '__pre_apply'  # free the name so the baked mesh keeps it (glTF mesh names)
    ob.modifiers.clear()
    ob.data = new_me
    new_me.name = name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def set_sharp_by_angle(me, degrees):
    """Smooth-shade everything, then mark edges sharper than `degrees` as hard (exported as split normals)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(degrees)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() <= thr
            if e.link_faces[0].material_index != e.link_faces[1].material_index and e.calc_face_angle() > thr * 0.5:
                e.smooth = False
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------- construction

def object_from_bmesh(name, bm, materials, collection, recalc_normals=True):
    if recalc_normals:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def lathe(bm, profile, segments, mat_index=0, closed=False, frame=None):
    """Revolve a profile of (radius, axial) points around the local +X axis.

    Points with radius 0 become single pole vertices. `closed` joins the last point back to the first.
    `frame` (Matrix 3x3/4x4) re-orients the result; default keeps the axis on +X.
    """
    rings = []
    for r, x in profile:
        if r < 1e-9:
            rings.append([bm.verts.new((x, 0.0, 0.0))])
        else:
            ring = []
            for i in range(segments):
                a = 2 * math.pi * i / segments
                ring.append(bm.verts.new((x, r * math.cos(a), r * math.sin(a))))
            rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    faces = []
    for a, b in pairs:
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1 or len(b) == 1:
            pole, ring = (a[0], b) if len(a) == 1 else (b[0], a)
            for i in range(segments):
                faces.append(bm.faces.new((pole, ring[i], ring[(i + 1) % segments])))
        else:
            for i in range(segments):
                j = (i + 1) % segments
                faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in faces:
        f.material_index = mat_index
    if frame is not None:
        m4 = frame.to_4x4() if len(frame) == 3 else frame
        bmesh.ops.transform(bm, matrix=m4, verts=[v for r in rings for v in r])
    return faces


def latitude_sphere(bm, rows, segments, frame=None):
    """A sphere built from explicit latitude rows, so features (bands, seams) land exactly on rows.

    rows: list of (latitude_deg, radius, material_index_of_strip_above) from -90 to +90, poles included.
    The strip between row i and row i+1 takes rows[i][2]. `frame` rotates the pole axis (+Z) into place.
    """
    rings = []
    for lat, r, _ in rows:
        phi = math.radians(lat)
        if abs(abs(lat) - 90) < 1e-9:
            rings.append([bm.verts.new((0.0, 0.0, r * math.copysign(1, lat)))])
            continue
        z = r * math.sin(phi)
        rr = r * math.cos(phi)
        rings.append([bm.verts.new((rr * math.cos(2 * math.pi * i / segments),
                                    rr * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    for k in range(len(rings) - 1):
        a, b, mi = rings[k], rings[k + 1], rows[k][2]
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1:
                f = bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[j], b[0]))
            else:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
    if frame is not None:
        m4 = frame.to_4x4() if len(frame) == 3 else frame
        bmesh.ops.transform(bm, matrix=m4, verts=bm.verts)


def track_matrix(direction, up=(0, 0, 1)):
    """Rotation whose local +X points along `direction` (port convention: +X outward)."""
    d = Vector(direction).normalized()
    upv = Vector(up)
    if abs(d.dot(upv)) > 0.999:
        upv = Vector((0, 1, 0))
    return d.to_track_quat('X', 'Z' if upv.z else 'Y').to_matrix()


def is_identity(m, tol=1e-5):
    ident = Matrix.Identity(4)
    return all(abs(m[i][j] - ident[i][j]) <= tol for i in range(4) for j in range(4))
