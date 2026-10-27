"""Big-set environment helpers (M5, stream E5c): ORBITAL HANGAR and MOON BASE (environments.md §0, §5, §6).

Shared by env_hangar.py and env_moon.py, on top of E3b's `props.envkit.SetBuilder` (pieces per LOD, colliders
emitted by the same call that builds the visible piece, kit props). Adds what sets of 64-256 m need:
  * the environment physics materials (`concrete`, `regolith`) and static convex hulls next to boxes / spheres;
  * chunked export (environments.md §0.3): LOD0..LOD2 meshes split by island into 32 m `CHUNK__<cx>_<cy>` groups,
    LOD3 merged into one proxy per 128 m cell (`HLOD__<hx>_<hy>`, 4 x 4 chunks);
  * master materials linked from materials.blend, or built locally from the master table when the library
    predates them (so a concurrent stream never has to rebuild the shared library for us);
  * the Cycles equirect IBL bake with SH9, the 32^3 LUT strip, and the integer heightfield encoding of the
    generated TypeScript (zigzag varint row deltas, base64, FNV-1a).
Coordinates: set space, Blender metres, Z up; engine = glTF Y up (x, z, -y).
"""
import base64
import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

from . import geom, library
from .masters import master_table

PHYS_ENV = ('powder', 'wood', 'ceramic', 'steel', 'glass', 'rubber', 'paper', 'fabric', 'concrete', 'regolith')
CHUNK = 32.0
HLOD = 128.0
NOSHADOW = '__noshadow'


def make_builder(base_cls):
    """Subclass E3b's SetBuilder (passed in, so this module doesn't import the props package)."""

    class SpaceSet(base_cls):
        def __init__(self, lod):
            super().__init__(lod)
            self.hulls = []
            self.cutaway = set()       # single-sided, drawn with back-face culling (data `cutaway`)
            self.keepnormals = set()   # open shells whose authored normals must survive (cloud shell)
            self.prop_lod1_drop = False

        def collider(self, name, lo, hi, phys, M=None, preset=None):
            if self.lod != 0:
                return
            assert phys in PHYS_ENV, phys
            pts = [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
            if M is not None:
                pts = [M @ p for p in pts]
            a = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            b = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            n = sum(1 for bx in self.boxes if bx['base'] == name)
            self.boxes.append({'name': '%s_%d' % (name, n) if n else name, 'base': name, 'lo': a, 'hi': b,
                               'phys': phys, 'preset': preset})

        def sphere_col(self, name, c, r, phys, preset=None):
            if self.lod == 0:
                assert phys in PHYS_ENV, phys
                n = sum(1 for s in self.spheres if s['base'] == name)
                self.spheres.append({'name': '%s_%d' % (name, n) if n else name, 'base': name, 'c': Vector(c),
                                     'r': r, 'phys': phys, 'preset': preset})

        def hull_col(self, name, pts, phys, preset=None, M=None):
            """Static convex hull collider (set space points; at most 32 are kept, the extremes first)."""
            if self.lod != 0:
                return
            assert phys in PHYS_ENV, phys
            P = [Vector(p) if M is None else M @ Vector(p) for p in pts]
            P = reduce_points(P, 32)
            n = sum(1 for h in self.hulls if h['base'] == name)
            self.hulls.append({'name': '%s_%d' % (name, n) if n else name, 'base': name, 'pts': P, 'phys': phys,
                               'preset': preset})

    return SpaceSet


def reduce_points(P, cap):
    """Keep at most `cap` points of a convex set: the hull vertices, thinned by farthest-point sampling."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in P]
    try:
        res = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
        hv = [g.co.copy() for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    except Exception:  # noqa: BLE001 - degenerate (flat) input: keep the raw points
        hv = [p.copy() for p in P]
    bm.free()
    if not hv:
        hv = [p.copy() for p in P]
    uniq = []
    for p in hv:
        if all((p - q).length > 1e-5 for q in uniq):
            uniq.append(p)
    if len(uniq) <= cap:
        return uniq
    out = [max(uniq, key=lambda p: p.length)]
    while len(out) < cap:
        out.append(max(uniq, key=lambda p: min((p - q).length for q in out)))
    return out


# ---------------------------------------------------------------- materials

def materials(lib_path, names):
    """Masters linked from the library; masters the library doesn't have yet (this stream's new kn_env_*) are
    built locally from the same table (library._principled), identical to what a rebuilt library would hold."""
    with bpy.data.libraries.load(lib_path, link=True, relative=True) as (src, _dst):
        have = set(src.materials)
    linked = library.link_materials(lib_path, [n for n in names if n in have])
    table = master_table()
    local = []
    for n in names:
        if n not in linked:
            if n not in table:
                raise KeyError('not a master: %s' % n)
            linked[n] = library._principled(n, table[n])
            local.append(n)
    return linked, local


# ---------------------------------------------------------------- chunked objects

def chunk_of(x, y, size=CHUNK):
    return int(math.floor(x / size)), int(math.floor(y / size))


def _arrays(bm):
    import numpy as np
    me = bpy.data.meshes.new('envset_tmp')
    bm.to_mesh(me)
    nv, nl, npoly = len(me.vertices), len(me.loops), len(me.polygons)
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    loops = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops)
    starts = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get('loop_start', starts)
    totals = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get('loop_total', totals)
    mats = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get('material_index', mats)
    bpy.data.meshes.remove(me)
    return co.reshape(-1, 3), loops, starts, totals, mats


def _islands(nv, loops, starts, totals):
    """Vertex -> island label (union-find over polygon edges)."""
    import numpy as np
    parent = list(range(nv))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for s, t in zip(starts.tolist(), totals.tolist()):
        r0 = find(int(loops[s]))
        for k in range(s + 1, s + t):
            r = find(int(loops[k]))
            if r != r0:
                parent[r] = r0
    return np.array([find(i) for i in range(nv)], dtype=np.int64)


def _mesh_from(name, co, loops, starts, totals, mats, sel_polys, materials_list):
    import numpy as np
    idx = np.concatenate([loops[starts[p]:starts[p] + totals[p]] for p in sel_polys]) if len(sel_polys) else \
        np.empty(0, dtype=np.int64)
    used, inv = np.unique(idx, return_inverse=True)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(used))
    me.vertices.foreach_set('co', co[used].astype(np.float32).ravel())
    me.loops.add(len(idx))
    me.loops.foreach_set('vertex_index', inv.astype(np.int32))
    tot = totals[sel_polys]
    st = np.concatenate([[0], np.cumsum(tot)[:-1]]) if len(tot) else np.empty(0)
    me.polygons.add(len(sel_polys))
    me.polygons.foreach_set('loop_start', st.astype(np.int32))
    me.polygons.foreach_set('loop_total', tot.astype(np.int32))
    me.polygons.foreach_set('material_index', mats[sel_polys].astype(np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    for m in materials_list:
        me.materials.append(m)
    return me


def clean(bm):
    """Drop zero-area faces and loose verts (font outlines, collapsed bevel rows)."""
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
    bad = [f for f in bm.faces if f.calc_area() < 1e-12]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')


def to_objects(S, env, mats, cols, chunked=True):
    """Kits -> objects. Set pieces: LOD0..2 split by island into 32 m chunks (`objs['chunks'][(cx, cy)]`), LOD3
    merged per 128 m cell and shadow class (`objs['hlod'][(hx, hy)]`). Backdrop (LOD0 only) and the per-preset
    scale references are whole. Pieces in `S.cutaway` keep their authored normals (single-sided walls)."""
    import numpy as np
    out = {'chunks': {}, 'hlod': {}, 'backdrop': [], 'groups': {}}
    hl_parts = {}   # (cell, ns) -> [(co, loops, starts, totals, mats, mat names)]
    keep = getattr(S, 'keepnormals', set()) | S.cutaway
    for (group, piece), k in S.pieces.items():
        clean(k.bm)
        if not k.bm.faces:
            k.free()
            continue
        if piece not in keep:
            bmesh.ops.recalc_face_normals(k.bm, faces=k.bm.faces)
        ns = NOSHADOW if piece in S.noshadow else ''
        mlist = [mats[m] for m in k.mats]
        if group != 'set':
            # backdrop (never streamed), and whole LOD0-only groups: `ref_<preset>` scale references,
            # `zone_<n>` zero-g floor rings
            if S.lod != 0:
                k.free()
                continue
            if group == 'backdrop':
                name, col, bucket = 'env_%s__bd_%s%s' % (env, piece, ns), cols['BACKDROP'], out['backdrop']
            else:
                name, col = 'env_%s__%s_%s%s' % (env, group, piece, ns), cols['EXTRA']
                bucket = out['groups'].setdefault(group, [])
            ob = geom.object_from_bmesh(name, k.bm, mlist, col, recalc_normals=False)
            geom.set_sharp_by_angle(ob.data, 40)
            bucket.append(ob)
            continue
        co, loops, starts, totals, mi = _arrays(k.bm)
        k.free()
        lab = _islands(len(co), loops, starts, totals)
        # island centre (bbox) -> chunk / cell
        order = np.argsort(lab, kind='stable')
        lab_s = lab[order]
        brk = np.flatnonzero(np.diff(lab_s)) + 1
        groups = np.split(order, brk)
        key_of_label = {}
        size = HLOD if S.lod == 3 else CHUNK
        for g in groups:
            c = co[g]
            mn, mx = c.min(axis=0), c.max(axis=0)
            key_of_label[int(lab[g[0]])] = chunk_of((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, size) if chunked \
                else (0, 0)
        poly_lab = lab[loops[starts]]
        poly_key = [key_of_label[int(v)] for v in poly_lab]
        keys = sorted(set(poly_key))
        pk = np.array([keys.index(x) for x in poly_key], dtype=np.int64) if keys else np.empty(0, dtype=np.int64)
        for ki, key in enumerate(keys):
            sel = np.flatnonzero(pk == ki)
            if S.lod == 3:
                hl_parts.setdefault((key, ns), []).append((co, loops, starts, totals, mi, sel, list(k.mats)))
                continue
            suffix = ('__c%d_%d' % key) if chunked else ''
            name = 'env_%s__%s%s%s%s' % (env, piece, suffix, '' if S.lod == 0 else '__L%d' % S.lod, ns)
            me = _mesh_from(name, co, loops, starts, totals, mi, sel, mlist)
            ob = bpy.data.objects.new(name, me)
            cols['LOD%d' % S.lod].objects.link(ob)
            geom.set_sharp_by_angle(ob.data, 40)
            out['chunks'].setdefault(key, []).append(ob)
    # LOD3: one merged proxy per 128 m cell (and one for its no-shadow pieces)
    for (key, ns), parts in sorted(hl_parts.items()):
        names = sorted({m for p in parts for m in p[6]})
        bm = bmesh.new()
        for co, loops, starts, totals, mi, sel, mnames in parts:
            remap = np.array([names.index(m) for m in mnames], dtype=np.int64)
            me = _mesh_from('tmp', co, loops, starts, totals, remap[mi], sel, [])
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        name = 'env_%s__hlod__%d_%d__L3%s' % (env, key[0], key[1], ns)
        ob = geom.object_from_bmesh(name, bm, [mats[m] for m in names], cols['LOD3'], recalc_normals=False)
        geom.set_sharp_by_angle(ob.data, 50)
        out['hlod'].setdefault(key, []).append(ob)
    return out


def tri_count(objs):
    t = 0
    for ob in objs:
        ob.data.calc_loop_triangles()
        t += len(ob.data.loop_triangles)
    return t


def export_tree(tree, path):
    """tree: {root: [obj | (child_name, [obj])]}. Builds the empties, exports the selection as glb (Y up), and
    undoes the parenting."""
    sc = bpy.context.scene
    made, sel = [], []

    def node(name, parent=None):
        e = bpy.data.objects.new(name, None)
        sc.collection.objects.link(e)
        e.parent = parent
        made.append(e)
        sel.append(e)
        return e

    reparent = []
    for root, items in tree.items():
        r = node(root)
        for it in items:
            if isinstance(it, tuple):
                c = node(it[0], r)
                for ob in it[1]:
                    reparent.append((ob, ob.parent))
                    ob.parent = c
                    sel.append(ob)
            else:
                reparent.append((it, it.parent))
                it.parent = r
                sel.append(it)
    keep = set(sel)
    for ob in sc.objects:
        ob.select_set(ob in keep)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False, export_materials='EXPORT', export_image_format='NONE',
                              # texcoords: only meshes that carry a UV map write them (the textured Earth)
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_draco_mesh_compression_enable=False, export_skins=False, export_morph=False)
    for ob, p in reparent:
        ob.parent = p
    for e in made:
        bpy.data.objects.remove(e)


# ---------------------------------------------------------------- IBL (Cycles equirect + SH9)

def sh9(px):
    """Unnormalised irradiance projection of an equirect (rows bottom-up, centre column = engine -Z)."""
    import numpy as np
    h, w = px.shape[:2]
    v = (np.arange(h) + 0.5) / h
    u = (np.arange(w) + 0.5) / w
    theta = (1.0 - v) * math.pi
    phi = (u - 0.5) * 2 * math.pi
    T, Ph = np.meshgrid(theta, phi, indexing='ij')
    T = T[::-1]
    sx, sy, sz = np.sin(T) * np.sin(Ph), np.cos(T), -np.sin(T) * np.cos(Ph)
    dw = (2 * math.pi / w) * (math.pi / h) * np.sin(T)
    basis = [0.282095 * np.ones_like(sx), 0.488603 * sy, 0.488603 * sz, 0.488603 * sx, 1.092548 * sx * sy,
             1.092548 * sy * sz, 0.315392 * (3 * sz * sz - 1), 1.092548 * sx * sz, 0.546274 * (sx * sx - sy * sy)]
    return [[round(float((px[:, :, c] * b * dw).sum()), 5) for c in range(3)] for b in basis]


def bake_equirect(probe, hdr_path, samples, size=(2048, 1024), bounces=6):
    """Render a level equirect from `probe` (set space) with whatever lights and world the scene has; the
    image centre column looks along +Y (the back wall: engine -Z). Returns (pixels rows bottom-up, w, h)."""
    import numpy as np
    import render_lookdev as rl
    sc = bpy.context.scene
    rl.use_cycles(sc, samples)
    sc.cycles.max_bounces = bounces
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = size[0], size[1], 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    cd = bpy.data.cameras.new('ibl_cam')
    cd.type = 'PANO'
    if hasattr(cd, 'panorama_type'):
        cd.panorama_type = 'EQUIRECTANGULAR'
    else:
        cd.cycles.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new('ibl_cam', cd)
    sc.collection.objects.link(cam)
    cam.location = probe
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.image_settings.file_format = 'HDR'
    sc.render.filepath = hdr_path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(hdr_path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam, do_unlink=True)
    return px.reshape(h, w, 4)[:, :, :3], w, h


def write_json(path, data):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=1)
        f.write('\n')


# ---------------------------------------------------------------- LUT (32^3 strip, display space)

def write_lut(path, grade, n=32):
    """grade((r, g, b) display 0..1) -> (r, g, b). Strip 1024 x 32: red = x within a tile, green = y (top row 0),
    blue = tile index (the Tinker Lab layout)."""
    import numpy as np
    img = np.zeros((n, n * n, 4), dtype=np.float32)
    g = np.linspace(0.0, 1.0, n)
    for b in range(n):
        for gy in range(n):
            for r in range(n):
                c = grade((float(g[r]), float(g[gy]), float(g[b])))
                img[gy, b * n + r] = (min(1.0, max(0.0, c[0])), min(1.0, max(0.0, c[1])), min(1.0, max(0.0, c[2])), 1.0)
    im = bpy.data.images.new(os.path.basename(path), n * n, n, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    return path


def cool_shadows(lift, sat=1.0, s_curve=0.0):
    """A grade: per-channel lift weighted toward the shadows ((1 - v)^2), neutral highlights, optional saturation
    and S-curve (positive = more contrast)."""
    def grade(c):
        out = []
        for v, l in zip(c, lift):
            w = (1.0 - v) ** 2
            v2 = v + l * w
            if s_curve:   # darker below mid-grey, brighter above (the Tinker grade's soft S)
                v2 = v2 - s_curve * math.sin(2 * math.pi * min(1.0, max(0.0, v2)))
            out.append(v2)
        lum = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
        return [lum + (v - lum) * sat for v in out]
    return grade


# ---------------------------------------------------------------- integer heightfield encoding (generated TS)

def encode_heights(heights, nx, nz):
    """u16 samples (row-major, nz rows of nx) -> base64 of zigzag varints of each row's deltas from its left
    neighbour (the first sample of a row from 0). Lossless; decoded by the generated TypeScript."""
    out = bytearray()
    for z in range(nz):
        prev = 0
        row = heights[z * nx:(z + 1) * nx]
        for v in row:
            d = int(v) - prev
            prev = int(v)
            u = (d << 1) if d >= 0 else ((-d << 1) - 1)
            while True:
                b = u & 0x7F
                u >>= 7
                if u:
                    out.append(b | 0x80)
                else:
                    out.append(b)
                    break
    return base64.b64encode(bytes(out)).decode('ascii'), len(out)


def fnv1a_u16(heights):
    """FNV-1a 32 over the samples as little-endian bytes."""
    h = 0x811C9DC5
    for v in heights:
        v = int(v)
        for b in (v & 0xFF, v >> 8):
            h ^= b
            h = (h * 0x01000193) & 0xFFFFFFFF
    return h


TS_DECODER = '''
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 -> bytes (no platform atob: the same on every client). */
function b64bytes(s: string): Uint8Array {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  let n = s.length;
  while (n > 0 && s.charCodeAt(n - 1) === 61) n--;
  const out = new Uint8Array((n * 3) >> 2);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < n; i++) {
    acc = ((acc << 6) | lut[s.charCodeAt(i)]!) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

/** Zigzag-varint row deltas -> u16 samples (row-major, nz rows of nx), integer ops only. */
function decodeRows(data: string, nx: number, nz: number): Uint16Array {
  const b = b64bytes(data);
  const out = new Uint16Array(nx * nz);
  let p = 0;
  for (let z = 0; z < nz; z++) {
    let prev = 0;
    for (let x = 0; x < nx; x++) {
      let u = 0, shift = 0, byte = 0;
      do { byte = b[p++]!; u += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
      const d = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
      prev += d;
      out[z * nx + x] = prev;
    }
  }
  return out;
}

/** FNV-1a 32 of the samples as little-endian bytes (the generated `fnv1a`). */
export function heightsFnv1a(h: Uint16Array): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    x = Math.imul(x ^ (v & 0xff), 0x01000193) >>> 0;
    x = Math.imul(x ^ (v >> 8), 0x01000193) >>> 0;
  }
  return x;
}
'''
