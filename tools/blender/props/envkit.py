"""Environment set helpers shared by env_tinker.py (and the props-based dressing of env_kitchen.py).

The same pattern as env_kitchen.py's SetBuilder: per LOD, render kits per piece, and (LOD0 only) the collider
table, emitted by the same call that builds the visible piece. Adds kit-prop placement (`prop`), chalk / print
text (`text`), no-shadow pieces (window glazing bars, pendants and beams: environments.md §3.1 render flag) and
the glb / TypeScript writers.
Coordinates: set space, Blender metres, Z up. Engine = glTF Y-up (x, z, -y).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from kn_tools import geom
from kn_tools.kit import Kit, at

from .core import LODQ, PHYS, PROPS, build_prop, place

NOSHADOW = '__noshadow'
SHADOWONLY = '__shadowonly'   # drawn into shadow maps only (the cutaway's invisible roof)


class SetBuilder:
    def __init__(self, lod):
        self.lod = lod
        self.q = LODQ[lod]
        self.pieces = {}
        self.boxes = []
        self.spheres = []
        self.noshadow = set()
        self.shadowonly = set()
        self.prop_lod1_drop = True

    def kit(self, piece, group='set'):
        key = (group, piece)
        if key not in self.pieces:
            self.pieces[key] = Kit()
        return self.pieces[key]

    def cs(self, base=3):
        return max(0, int(round(base * self.q)))

    def seg(self, n, lo=6):
        return max(lo, int(round(n * self.q)))

    # -- set primitives (with colliders) -----------------------------------------------------------
    def box(self, piece, lo, hi, mat, r=0.01, phys='powder', col=True, group='set', name=None, M=None, preset=None):
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        c = (lo + hi) / 2
        k = self.kit(piece, group)
        rr = min(r, min(size) * 0.45)
        cs = self.cs(2) if rr > 0.001 else 0
        if cs == 0:
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
        n = sum(1 for bx in self.boxes if bx['base'] == name)
        self.boxes.append({'name': '%s_%d' % (name, n) if n else name, 'base': name, 'lo': a, 'hi': b, 'phys': phys,
                           'preset': preset})

    def sphere_col(self, name, c, r, phys, preset=None):
        if self.lod == 0:
            self.spheres.append({'name': name, 'c': Vector(c), 'r': r, 'phys': phys, 'preset': preset})

    def cyl(self, piece, c, r, z0, z1, mat, bev=0.01, segs=32, group='set', m=None):
        k = self.kit(piece, group)
        mm = at(c[0], c[1], 0.0) if m is None else m
        k.cyl(r, z0, z1, mat, self.seg(segs), bev=bev if self.lod < 3 else 0.0, bseg=max(1, self.cs(2)), m=mm)

    def sweep(self, piece, path, radius, mat, sides=8, group='set', radii=None):
        self.kit(piece, group).sweep(path, radius, self.seg(sides, 3), mat, radii=radii)

    def sphere(self, piece, c, r, mat, segs=16, rings=8, group='set', sz_top=1.0, sz_bot=1.0):
        self.kit(piece, group).sphere(r, mat, self.seg(segs), self.seg(rings, 3), m=at(*c), sz_top=sz_top,
                                      sz_bot=sz_bot)

    # -- kit props -----------------------------------------------------------------------------------
    def prop(self, name, x, y, z, yaw=0.0, scale=1.0, variant=0, col=True, piece=None, group='set', seed=0,
             preset=None, M=None, bias=0):
        """Place kit prop kn_prop_<name>. Its colliders join the table (as boxes / spheres) when col.
        `bias` builds far-background dressing (filled bookcases) that many LODs coarser."""
        cols = [] if (col and self.lod == 0) else None
        mm = M if M is not None else place(x, y, z, yaw, scale)
        # set LOD1 takes kit props at their LOD2 (dressing is what the 50 % LOD gives up first)
        drop = self.lod == 1 and self.prop_lod1_drop and bias > 0
        eff = min(3, self.lod + bias + (1 if drop else 0))
        build_prop(name, self.kit(piece or ('prop_' + name), group), mm, eff, variant, cols, seed)
        for c in cols or ():
            nm = 'prop_' + name
            if c['kind'] == 'box':
                self.collider(nm, c['lo'], c['hi'], c['phys'], None, preset)
            else:
                n = sum(1 for s in self.spheres if s['name'].startswith(nm))
                self.sphere_col('%s_%d' % (nm, n) if n else nm, c['c'], c['r'], c['phys'], preset)

    # -- text (chalk, print) ------------------------------------------------------------------------
    def text(self, piece, body, M, size, mat, font, align='CENTER', depth=0.002, group='set'):
        """Flat extruded text in the local XY plane of M (local +Z = out of the surface). LOD0/1 only."""
        if self.lod > 1:
            return
        cu = bpy.data.curves.new('tmp_text', 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = align
        cu.extrude = depth / 2
        cu.resolution_u = 3 if self.lod == 0 else 2
        cu.font = font
        ob = bpy.data.objects.new('tmp_text', cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        k = self.kit(piece, group)
        mi = k.mi(mat)
        for p in me.polygons:
            p.material_index = 0
        tmp = bmesh.new()
        tmp.from_mesh(me)
        # weld the glyph caps to their sides: the font mesh comes in split, and the normal recalc that every set
        # object gets would then orient the loose caps arbitrarily (both ended up facing the wall, so the engine
        # culled the chalk text). Welded, each glyph is a closed shell and recalc points the caps outward.
        bmesh.ops.remove_doubles(tmp, verts=tmp.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        bmesh.ops.transform(tmp, matrix=M @ at(0, 0, depth / 2), verts=tmp.verts)
        tmp.to_mesh(me)
        tmp.free()
        for p in me.polygons:
            p.material_index = mi
        n0 = len(k.bm.faces)
        k.bm.from_mesh(me)
        k.bm.faces.ensure_lookup_table()
        for f in list(k.bm.faces)[n0:]:
            f.material_index = mi
        bpy.data.meshes.remove(me)


# ---------------------------------------------------------------- conversion and writers

def eng(v):
    """Blender set (x, y, z) -> engine (x, z, -y), rounded."""
    return [round(float(v[0]), 4) + 0.0, round(float(v[2]), 4) + 0.0, round(-float(v[1]), 4) + 0.0]


def eng_dir(v):
    d = Vector(v).normalized()
    return [round(float(d[0]), 4) + 0.0, round(float(d[2]), 4) + 0.0, round(-float(d[1]), 4) + 0.0]


def eng_box(lo, hi, off=(0, 0, 0)):
    a, c = eng(Vector(lo) - Vector(off)), eng(Vector(hi) - Vector(off))
    mn = [min(a[i], c[i]) for i in range(3)]
    mx = [max(a[i], c[i]) for i in range(3)]
    return ([round((mn[i] + mx[i]) / 2, 4) + 0.0 for i in range(3)],
            [round((mx[i] - mn[i]) / 2, 4) + 0.0 for i in range(3)])


def eng_minmax(lo, hi, off=(0, 0, 0)):
    c, h = eng_box(lo, hi, off)
    return {'min': [round(c[i] - h[i], 4) + 0.0 for i in range(3)], 'max': [round(c[i] + h[i], 4) + 0.0 for i in range(3)]}


def ts_literal(v, ind=0):
    pad = '  ' * ind
    if isinstance(v, dict):
        items = ['%s  %s: %s' % (pad, k, ts_literal(x, ind + 1)) for k, x in v.items()]
        return '{\n' + ',\n'.join(items) + ',\n' + pad + '}'
    if isinstance(v, (list, tuple)):
        if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
            return '[' + ', '.join(_num(x) for x in v) + ']'
        if not v:
            return '[]'
        if all(isinstance(x, str) for x in v) and sum(len(x) for x in v) < 90:
            return '[' + ', '.join(ts_literal(x) for x in v) + ']'
        return '[\n' + ',\n'.join(pad + '  ' + ts_literal(x, ind + 1) for x in v) + ',\n' + pad + ']'
    if isinstance(v, str):
        return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"
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


def clean(bm):
    """Drop zero-area faces (font outlines, collapsed bevel rows) so the exporter never writes NaN normals."""
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
    bad = [f for f in bm.faces if f.calc_area() < 1e-12]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')


def to_objects(S, env, mats, cols):
    """Kits -> objects in the LOD / BACKDROP / REF__<preset> collections. No-shadow set pieces get the
    `__noshadow` name suffix (the renderer reads it; the glb has no per-node shadow flag)."""
    out = []
    for (group, piece), k in S.pieces.items():
        clean(k.bm)
        if not k.bm.faces:
            k.free()
            continue
        ns = NOSHADOW if piece in S.noshadow else (SHADOWONLY if piece in S.shadowonly else '')
        if group == 'set':
            col = cols['LOD%d' % S.lod]
            name = 'env_%s__%s%s%s' % (env, piece, '' if S.lod == 0 else '__L%d' % S.lod, ns)
        elif group == 'backdrop':
            if S.lod != 0:
                k.free()
                continue
            col = cols['BACKDROP']
            name = 'env_%s__bd_%s%s' % (env, piece, ns)
        else:
            col = cols.get('REF__%s' % group[4:]) if S.lod == 0 else None
            if col is None:
                k.free()
                continue
            name = 'env_%s__%s_%s' % (env, group, piece)
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


def setup_scene(names):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    cols = {}
    for name in names:
        c = bpy.data.collections.new('ENV_RENDER' if name == 'LOD0' else name)
        sc.collection.children.link(c)
        cols[name] = c
    return sc, cols


def add_box_markers(col, boxes):
    for b in boxes:
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
        col.objects.link(ob)


def empty(col, name, loc, scale=None, kind='PLAIN_AXES'):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.location = loc
    if scale is not None:
        e.scale = scale
    col.objects.link(e)
    return e


def export_glb(cols, roots, path):
    """roots: {collection key: glb root node name}. Children of each collection hang under that node."""
    sc = bpy.context.scene
    created, sel = [], []
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


def frame_wall(x, y, z, facing='-y'):
    """Matrix for a wall-mounted prop / drawing whose back is on the wall at (x, y, z), facing `facing`
    ('-y' back wall, '+x' left wall, '-x' right wall, '+y' front)."""
    yaw = {'-y': 0.0, '+x': 90.0, '-x': -90.0, '+y': 180.0}[facing]
    return at(x, y, z) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')


def face_out(facing='-y'):
    """Local XY drawing plane -> the wall plane, local +Z -> out of the wall (for text and flat art)."""
    return frame_wall(0, 0, 0, facing) @ Matrix.Rotation(math.radians(90), 4, 'X')
