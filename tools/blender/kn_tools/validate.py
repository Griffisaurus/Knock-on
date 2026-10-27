"""Validator v1 (ASSET_PIPELINE §9). Returns a Report; the CLI turns errors into a non-zero exit.

Rule tags match the §9 numbering so CI output points straight at the doc:
  1 naming · 2 transforms/origin · 3 bounds · 4 tris/LODs · 5 materials · 6 textures · 7 collision ·
  8 ports/sensors/emitters · 9 pivots · 10 manifold · 11 critters · 12 licences · 13 texture sets (M3)
"""
import math
import os

import bpy
from mathutils import Vector

from . import geom, template
from .conventions import (CELL, CHANNELS, CLASS_BUDGETS, CLASSES, COL_KINDS, FAMILIES, KNOWN_COLLECTIONS,
                          LOD_COLLECTIONS, LOD_RATIO_TOLERANCE, LOD_RATIOS, LOD3_PRIMITIVE_FLOOR, MAX_COL_MESH_TRIS,
                          MAX_COL_SHAPES, MAX_HULL_VERTS, MAX_MATERIAL_SLOTS, MIN_SHAPE_THICKNESS, ORIGIN_KINDS,
                          PHYS_MATERIALS, PORT_DIRS, PORT_KINDS, PORT_SIZES, REQUIRED_COLLECTIONS, SENSOR_KINDS,
                          TEXTURE_SIZES, UNTEXTURED_PREFIXES, default_origin, is_master_material, parse_footprint,
                          parse_name, parse_port_ring_name)

ALLOWED_TYPES = {
    'RENDER': ('MESH',), 'LOD1': ('MESH',), 'LOD2': ('MESH',), 'LOD3': ('MESH',), 'COL': ('MESH',),
    'PORT': ('EMPTY',), 'SENSOR': ('MESH',), 'EMIT': ('EMPTY',), 'PIVOT': ('EMPTY',), 'SCREEN': ('MESH',),
    'CAVITY': ('MESH',), 'FRAC': ('MESH',), 'RIG': ('ARMATURE', 'MESH'),
}
# Meshes in these collections must carry applied transforms unless they hang under a PIVOT.
APPLIED_COLLECTIONS = ('RENDER', 'LOD1', 'LOD2', 'LOD3', 'SENSOR', 'SCREEN', 'CAVITY', 'FRAC')
MATERIAL_COLLECTIONS = ('RENDER', 'LOD1', 'LOD2', 'LOD3', 'SCREEN', 'CAVITY', 'FRAC')


class Issue:
    def __init__(self, level, rule, obj, message):
        self.level = level
        self.rule = rule
        self.obj = obj
        self.message = message

    def as_dict(self):
        return {'level': self.level, 'rule': self.rule, 'object': self.obj, 'message': self.message}

    def __str__(self):
        tag = 'ERROR' if self.level == 'error' else 'WARN '
        where = (' %s:' % self.obj) if self.obj else ''
        return '  %s [%s]%s %s' % (tag, self.rule, where, self.message)


class Report:
    def __init__(self, source):
        self.source = source
        self.issues = []
        self.stats = {}

    def error(self, rule, obj, msg):
        self.issues.append(Issue('error', rule, obj, msg))

    def warn(self, rule, obj, msg):
        self.issues.append(Issue('warning', rule, obj, msg))

    @property
    def errors(self):
        return [i for i in self.issues if i.level == 'error']

    @property
    def warnings(self):
        return [i for i in self.issues if i.level == 'warning']

    @property
    def ok(self):
        return not self.errors

    def has(self, rule_prefix):
        return any(i.rule.startswith(rule_prefix) for i in self.errors)

    def format(self):
        lines = ['kn_tools validator v1: %s' % self.source]
        for k, v in self.stats.items():
            lines.append('  %-10s %s' % (k, v))
        lines.extend(str(i) for i in self.issues)
        verdict = 'PASS' if self.ok else 'FAIL'
        lines.append('RESULT: %s (%d errors, %d warnings)' % (verdict, len(self.errors), len(self.warnings)))
        return '\n'.join(lines)

    def as_dict(self):
        return {'source': self.source, 'ok': self.ok, 'stats': self.stats,
                'issues': [i.as_dict() for i in self.issues]}


# ---------------------------------------------------------------- helpers

def collection_objects(scene, name):
    col = template.get_collection(name, scene, create=False)
    return list(col.all_objects) if col else []


def _pivot_ancestors(ob):
    out, p = [], ob.parent
    while p is not None:
        if p.name.startswith('PIVOT__'):
            out.append(p)
        p = p.parent
    return out


def _lib_basename(idblock):
    return os.path.basename(bpy.path.abspath(idblock.library.filepath)) if idblock.library else None


def _has_image_nodes(mat):
    return bool(mat.node_tree) and any(n.type == 'TEX_IMAGE' for n in mat.node_tree.nodes)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------------------------------------------------------------- validation

def validate(scene=None, blend_path=None):
    scene = scene or bpy.context.scene
    blend_path = blend_path if blend_path is not None else bpy.data.filepath
    rep = Report(os.path.basename(blend_path) if blend_path else '<unsaved>')
    dg = bpy.context.evaluated_depsgraph_get()

    root = template.find_root(scene)
    if root is None:
        rep.error('1.naming', None, 'no root object: an empty in the scene collection carrying kn_type '
                                    '(use kn_tools > New Part)')
        return rep
    info = _check_root(rep, root, blend_path)
    ptype = info.get('type') or root.name
    _check_collections(rep, scene, root, ptype)
    _check_transforms(rep, scene, root)
    lod0_lo, lod0_hi = _lod_bounds(scene, 'RENDER', dg)
    # kn_bounds = 'static': origin and footprint are judged on the housing only, so a moving piece that
    # sweeps past it (MAINS lever) doesn't shift the bottom-centre origin or inflate the cell footprint.
    # kn_bounds = 'origin': only the origin is judged on the housing (SNIPPER's open blades).
    fp_lo, fp_hi = lod0_lo, lod0_hi
    or_lo, or_hi = lod0_lo, lod0_hi
    # kn_bounds = 'moving' (M3, E3a): only the origin is judged, on the pieces under a pivot (LIFT: the origin is
    # the bottom centre of the deck at its lowest stop, while the mast and housing stand behind it).
    basis = root.get('kn_bounds', 'all')
    if basis not in ('all', 'static', 'origin', 'moving'):
        rep.error('1.props', root.name, "kn_bounds must be 'all', 'static', 'origin' or 'moving', got %r" % (basis,))
    elif basis in ('static', 'origin'):
        or_lo, or_hi = _lod_bounds(scene, 'RENDER', dg, static_only=True)
        if basis == 'static':
            fp_lo, fp_hi = or_lo, or_hi
    if basis == 'moving':  # the origin sits on the moving pieces' floor plane, inside their footprint
        mv_lo, mv_hi = _lod_bounds(scene, 'RENDER', dg, moving_only=True)
        if mv_lo is None:
            rep.error('2.origin', None, "kn_bounds = 'moving' needs pieces under a PIVOT__")
        elif abs(mv_lo.z) > 0.001 or not (mv_lo.x < 0 < mv_hi.x and mv_lo.y < 0 < mv_hi.y):
            rep.error('2.origin', None, 'origin must lie on the floor of the moving pieces, inside their footprint '
                                        '(their bounds %s .. %s)' % (_fmt(mv_lo), _fmt(mv_hi)))
    else:
        _check_origin(rep, scene, info, or_lo, or_hi, dg)
    _check_footprint(rep, info, fp_lo, fp_hi)
    _check_tris(rep, scene, info, dg)
    _check_materials(rep, scene, info)
    _check_textures(rep)
    _check_collision(rep, scene, info, dg)
    st_lo, st_hi = _lod_bounds(scene, 'RENDER', dg, static_only=True)
    _check_ports(rep, scene, lod0_lo, lod0_hi, st_lo, st_hi)
    _check_sensors_emitters(rep, scene)
    _check_pivots(rep, scene)
    _check_manifold(rep, scene, dg)
    from . import cavity  # M4 (E4a): CAVITY__ meshes closed, matter / capacity props (§3.10)
    cavity.check(rep, scene, dg, collection_objects)
    if info.get('family') == 'critters':
        from . import rig  # M2 stream E2: rule 11 (bones, weights <= 4, clips, ragdoll) lives in kn_tools/rig.py
        rig.check_critter(rep, scene, root, dg)
        if root.get('kn_tex_set') or root.get('kn_tex_looks'):
            # M4 stream E4b: critters authored with a D78 set (BISCUIT, HENNY, DUSTY) also pass rule 13
            from . import textures
            textures.check(rep, scene, root, info)
    elif info.get('family') not in (None, 'critters'):
        # M3 stream E3c: rule 13 (texture sets, §5.2 / D78) lives in kn_tools/textures.py; a part still
        # awaiting the texture pass only warns
        from . import textures
        textures.check(rep, scene, root, info)
    for lib in bpy.data.libraries:
        if not os.path.exists(bpy.path.abspath(lib.filepath, library=lib.parent)):
            rep.error('5.materials', lib.name, 'linked library not found: %s (relative to %s)'
                      % (lib.filepath, rep.source))
        if 'third_party' in lib.filepath.replace('\\', '/'):
            rep.warn('12.licence', lib.name, 'third_party input: confirm it is listed in assets/LICENSES.csv')
    return rep


def _check_root(rep, root, blend_path):
    info = {}
    info['com_explicit'] = bool(root.get('kn_com_explicit', False))  # M3 (E3a), see _check_origin
    keys = root.keys()
    for k in ('kn_type', 'kn_family', 'kn_class', 'kn_footprint', 'kn_mass_hint'):
        if k not in keys:
            rep.error('1.props', root.name, 'missing root custom property %s (§3.8)' % k)
    ptype = root.get('kn_type')
    if ptype is not None:
        info['type'] = str(ptype)
        if root.name != ptype:
            rep.error('1.naming', root.name, 'root object must be named after kn_type %r' % ptype)
        if blend_path:
            stem = os.path.splitext(os.path.basename(blend_path))[0]
            if stem != ptype:
                rep.error('1.naming', root.name, 'file name %r must equal kn_type %r' % (stem, ptype))
    fam = root.get('kn_family')
    if fam is not None:
        info['family'] = fam
        if fam not in FAMILIES:
            rep.error('1.props', root.name, 'kn_family %r not one of %s' % (fam, ', '.join(FAMILIES)))
    cls = root.get('kn_class')
    if cls is not None:
        info['class'] = cls
        if cls not in CLASSES:
            rep.error('1.props', root.name, 'kn_class %r not one of S/M/L/XL' % cls)
    if 'kn_footprint' in keys:
        try:
            info['footprint'] = parse_footprint(root['kn_footprint'])
        except (ValueError, TypeError) as e:
            rep.error('1.props', root.name, 'kn_footprint %r: %s' % (root['kn_footprint'], e))
    mass = root.get('kn_mass_hint')
    if mass is not None and (not _num(mass) or mass <= 0):
        rep.error('1.props', root.name, 'kn_mass_hint must be a positive number (kg), got %r' % (mass,))
    origin = root.get('kn_origin')
    if origin is None:
        origin = default_origin(fam)
        rep.warn('2.origin', root.name, 'no kn_origin property; assuming %r for family %r' % (origin, fam))
    elif origin not in ORIGIN_KINDS:
        rep.error('2.origin', root.name, 'kn_origin %r not one of %s' % (origin, ', '.join(ORIGIN_KINDS)))
    info['origin'] = origin
    budget = root.get('kn_tri_budget')
    if budget is not None:
        info['tri_budget'] = int(budget)
    for k in keys:
        if k.startswith('kn_') and not isinstance(root[k], (str, int, float, bool)):
            rep.error('1.props', root.name, '%s must be a string, number or boolean' % k)
    if not geom.is_identity(root.matrix_world):
        rep.error('2.transform', root.name, 'root empty must sit at the world origin with no rotation or scale')
    return info


def _check_collections(rep, scene, root, ptype):
    for c in scene.collection.children:
        if c.name not in KNOWN_COLLECTIONS:
            rep.error('1.collections', c.name, 'unknown collection (allowed: %s)' % ', '.join(KNOWN_COLLECTIONS))
        for sub in c.children:
            rep.error('1.collections', sub.name, 'nested collection inside %s is not allowed' % c.name)
    for name in REQUIRED_COLLECTIONS:
        col = template.get_collection(name, scene, create=False)
        if col is None or not col.all_objects:
            rep.error('1.collections', name, 'required collection is missing or empty')
    for ob in scene.objects:
        if ob is root:
            continue
        cols = [c.name for c in ob.users_collection]
        if scene.collection in ob.users_collection:
            rep.error('1.naming', ob.name, 'unknown object in the scene root (put it in a part collection or delete it)')
            continue
        known = [n for n in cols if n in KNOWN_COLLECTIONS]
        if len(known) != 1 or len(cols) != 1:
            rep.error('1.collections', ob.name, 'must live in exactly one part collection, found %s' % cols)
            continue
        col = known[0]
        if ob.type not in ALLOWED_TYPES[col]:
            rep.error('1.naming', ob.name, '%s object in %s (allowed: %s)' % (ob.type, col, ', '.join(ALLOWED_TYPES[col])))
        if col == 'RIG':
            if not (ob.name == 'RIG' or ob.name.startswith('RAG__')):
                rep.error('1.naming', ob.name, 'RIG holds the RIG armature and RAG__<bone> capsules only')
            continue
        if col == 'PORT' and parse_port_ring_name(ob.name):
            continue
        parsed = parse_name(col, ob.name)
        if parsed is None:
            rep.error('1.naming', ob.name, 'name does not match the %s convention (%s)' % (col, _pattern_hint(col, ptype)))
            continue
        if col in LOD_COLLECTIONS and parsed['type'] != ptype:
            rep.error('1.naming', ob.name, 'render pieces must start with the part type %r' % ptype)
        if col in ('LOD1', 'LOD2', 'LOD3') and parsed['lod'] != col[-1]:
            rep.error('1.naming', ob.name, 'suffix __L%s does not match collection %s' % (parsed['lod'], col))


def _pattern_hint(col, ptype):
    return {
        'RENDER': '%s__<piece>' % ptype, 'LOD1': '%s__<piece>__L1' % ptype, 'LOD2': '%s__<piece>__L2' % ptype,
        'LOD3': '%s__<piece>__L3' % ptype, 'COL': 'COL__<kind>__<n>', 'PORT': 'PORT__<channel>__<name>',
        'SENSOR': 'SENSOR__<kind>__<name>', 'EMIT': 'EMIT__<fx>__<name>', 'PIVOT': 'PIVOT__<name>',
        'SCREEN': 'SCREEN__<name>', 'CAVITY': 'CAVITY__<name>', 'FRAC': 'FRAC__<n>',
    }.get(col, '?')


def _check_transforms(rep, scene, root):
    us = scene.unit_settings
    if us.system != 'METRIC' or abs(us.scale_length - 1.0) > 1e-6:
        rep.error('2.units', None, 'scene units must be Metric with unit scale 1.0 (1 BU = 1 m), got %s x%g'
                  % (us.system, us.scale_length))
    for ob in scene.objects:
        s = ob.scale
        if any(c < 0 for c in s) or ob.matrix_world.determinant() < 0:
            rep.error('2.transform', ob.name, 'negative scale %s (mirroring happens in the engine)' % _fmt(s))
        elif any(abs(c - 1.0) > 1e-5 for c in s):
            rep.error('2.transform', ob.name, 'unapplied scale %s (apply all transforms)' % _fmt(s))
        cols = [c.name for c in ob.users_collection]
        if any(c in APPLIED_COLLECTIONS for c in cols) and ob.type == 'MESH' and not _pivot_ancestors(ob):
            loc, rot, _scale = ob.matrix_world.decompose()
            if loc.length > 1e-6 or min(rot.angle, 2 * math.pi - rot.angle) > 1e-5:
                rep.error('2.transform', ob.name, 'unapplied location/rotation (apply transforms; '
                                                  'moving pieces hang under a PIVOT__ empty)')


def _fmt(v):
    return '(' + ', '.join('%.4g' % c for c in v) + ')'


def _lod_bounds(scene, colname, dg, static_only=False, moving_only=False):
    pts = []
    for ob in collection_objects(scene, colname):
        if moving_only and not _pivot_ancestors(ob):  # M3 (E3a): kn_bounds = 'moving'
            continue
        if ob.type == 'MESH' and not (static_only and _pivot_ancestors(ob)):
            pts.extend(geom.world_points(ob, dg))
    return geom.bounds(pts) if pts else (None, None)


def _check_origin(rep, scene, info, lo, hi, dg):
    if lo is None:
        return
    origin = info.get('origin')
    size = hi - lo
    centre = (lo + hi) / 2
    if origin == 'com':
        # The engine takes the COM from the collision shapes, so check against those when present.
        col_pts = []
        for ob in collection_objects(scene, 'COL'):
            if ob.type == 'MESH':
                col_pts.extend(geom.world_points(ob, dg))
        if col_pts:
            clo, chi = geom.bounds(col_pts)
            centre = (clo + chi) / 2
        tol = max(0.002, 0.1 * max(size))
        # M3 (E3a): kn_com_explicit = True when the brief states the COM (a bottom-heavy PIN, the JITTERJUICE flask,
        # a DING bell): the origin is that briefed point, not the shape centre; it must still lie inside the shapes.
        if info.get('com_explicit') and col_pts:
            if not all(clo[i] - 1e-6 <= 0.0 <= chi[i] + 1e-6 for i in range(3)):
                rep.error('2.origin', None, 'kn_com_explicit: the briefed COM (origin) lies outside the collision '
                                            'shapes')
        elif centre.length > tol:
            rep.error('2.origin', None, 'free body origin must be the centre of mass; shape centre is %.4f m away'
                      % centre.length)
    elif origin == 'bottom':
        if abs(lo.z) > 0.001:
            rep.error('2.origin', None, 'placed device origin must be bottom centre: lowest point at z=%.4f m' % lo.z)
        if Vector((centre.x, centre.y)).length > 0.005:
            rep.error('2.origin', None, 'placed device origin must be the footprint centre: bounds centre at %s'
                      % _fmt((centre.x, centre.y)))
    elif origin in ('axle', 'hinge'):
        pivots = [ob for ob in collection_objects(scene, 'PIVOT') if ob.matrix_world.translation.length < 0.001]
        if not pivots:
            rep.warn('2.origin', None, '%s origin: expected a PIVOT__ empty on the origin' % origin)


def _check_footprint(rep, info, lo, hi):
    fp = info.get('footprint')
    if fp is None or lo is None:
        return
    size = hi - lo
    actual = (size.x, size.z, size.y)  # w, h, d
    for label, want_cells, got in zip(('w', 'h', 'd'), fp, actual):
        want = want_cells * CELL
        if abs(got - want) > 0.02:
            rep.error('3.bounds', None, 'LOD0 %s = %.3f m but kn_footprint says %g cells (%.3f m) ± 0.02'
                      % (label, got, want_cells, want))
    if info.get('origin') not in ('com', 'path'):  # path-drawn kits (M2 GUTTER) have free run lengths
        for label, v in zip(('w', 'h', 'd'), fp):
            if label == 'h' and v < 1:
                continue  # plates thinner than a cell (STOMP PAD 0.3) keep their brief height; the grid is w x d
            if abs(v * 2 - round(v * 2)) > 1e-6:
                rep.error('3.bounds', None, 'placed device footprint must be whole or half cells, got %s %g'
                          % (label, v))


def lod_tris(scene, dg=None):
    dg = dg or bpy.context.evaluated_depsgraph_get()
    return {name: sum(geom.tri_count(ob, dg) for ob in collection_objects(scene, name) if ob.type == 'MESH')
            for name in LOD_COLLECTIONS}


def _check_tris(rep, scene, info, dg):
    tris = lod_tris(scene, dg)
    rep.stats['tris'] = ' / '.join('%s %d' % (k, v) for k, v in tris.items())
    cls = info.get('class')
    if cls not in CLASS_BUDGETS:
        return
    lo, hi = CLASS_BUDGETS[cls]['tris']
    budget = hi
    if 'tri_budget' in info:
        budget = min(hi, info['tri_budget'])
    t0 = tris['RENDER']
    if t0 > budget:
        rep.error('4.tris', 'RENDER', 'LOD0 has %d tris, over the %s budget of %d' % (t0, 'brief' if budget < hi
                                                                                        else 'class ' + cls, budget))
    elif t0 < lo:
        rep.warn('4.tris', 'RENDER', 'LOD0 has %d tris, under the class %s range %d-%d' % (t0, cls, lo, hi))
    if t0 == 0:
        return
    for name, target in LOD_RATIOS.items():
        t = tris[name]
        ratio = t / t0
        if t == 0:
            rep.error('4.lod', name, 'empty LOD (target %d %% of LOD0)' % round(target * 100))
            continue
        if name == 'LOD3' and t <= LOD3_PRIMITIVE_FLOOR:
            continue
        if abs(ratio / target - 1) > LOD_RATIO_TOLERANCE:
            rep.error('4.lod', name, '%d tris = %.1f %% of LOD0; target %d %% ± 10 %% (%d-%d tris)'
                      % (t, ratio * 100, round(target * 100), math.ceil(t0 * target * (1 - LOD_RATIO_TOLERANCE)),
                         math.floor(t0 * target * (1 + LOD_RATIO_TOLERANCE))))


def part_materials(scene):
    """Ordered unique materials used by render-side meshes (LOD0 first)."""
    seen = []
    for colname in MATERIAL_COLLECTIONS:
        for ob in collection_objects(scene, colname):
            if ob.type != 'MESH':
                continue
            for slot in ob.material_slots:
                if slot.material and slot.material not in seen:
                    seen.append(slot.material)
    return seen


def _check_materials(rep, scene, info):
    for colname in MATERIAL_COLLECTIONS:
        for ob in collection_objects(scene, colname):
            if ob.type != 'MESH':
                continue
            if not ob.material_slots:
                rep.error('5.materials', ob.name, 'no material slots (link a master from materials.blend)')
            used = {p.material_index for p in ob.data.polygons}
            for i, slot in enumerate(ob.material_slots):
                if slot.material is None and i in used:
                    rep.error('5.materials', ob.name, 'material slot %d is empty' % i)
            if used and max(used) >= len(ob.material_slots):
                rep.error('5.materials', ob.name, 'faces reference missing material slot %d' % max(used))
    mats = part_materials(scene)
    textured = 0
    for m in mats:
        lib = _lib_basename(m)
        if lib != 'materials.blend':
            rep.error('5.materials', m.name, 'local material: only masters linked from assets/src/lib/materials.blend '
                                             'are allowed (never append or make one-offs)')
        if not is_master_material(m.name):
            rep.error('5.materials', m.name, 'not a master material id (ASSET_PIPELINE §5.1)')
        if not m.name.startswith(UNTEXTURED_PREFIXES) and _has_image_nodes(m):
            textured += 1
    rep.stats['materials'] = ', '.join(m.name for m in mats) or '-'
    if len(mats) > MAX_MATERIAL_SLOTS:
        rep.error('5.materials', None, '%d material slots, hard cap is %d' % (len(mats), MAX_MATERIAL_SLOTS))
    cls = info.get('class')
    if cls in CLASS_BUDGETS and textured > CLASS_BUDGETS[cls]['textured']:
        rep.error('5.materials', None, '%d uniquely textured slots, class %s allows %d'
                  % (textured, cls, CLASS_BUDGETS[cls]['textured']))


def _check_textures(rep):
    for img in bpy.data.images:
        if img.library or img.users == 0 or img.type in ('RENDER_RESULT', 'COMPOSITING'):
            continue
        w, h = img.size
        if w != h or w not in TEXTURE_SIZES:
            rep.error('6.textures', img.name, 'size %dx%d; must be square 1024, 2048 or 4096' % (w, h))
        n = img.name.lower()
        cs = img.colorspace_settings.name
        if any(k in n for k in ('basecolor', 'albedo', 'emissive')) and cs != 'sRGB':
            rep.error('6.textures', img.name, 'colour texture must be sRGB, is %s' % cs)
        if any(k in n for k in ('normal', 'orm', 'rough', 'thickness', 'mask')) and cs != 'Non-Color':
            rep.error('6.textures', img.name, 'data texture must be Non-Color, is %s' % cs)


def _check_collision(rep, scene, info, dg):
    shapes = [ob for ob in collection_objects(scene, 'COL')]
    if not shapes:
        rep.error('7.collision', 'COL', 'no collision shapes (need at least one COL__<kind>__<n>)')
        return
    if len(shapes) > MAX_COL_SHAPES:
        rep.error('7.collision', 'COL', '%d shapes, max %d per part' % (len(shapes), MAX_COL_SHAPES))
    for ob in shapes:
        parsed = parse_name('COL', ob.name)
        if parsed is None or ob.type != 'MESH':
            continue  # already reported under 1.naming
        kind = parsed['kind']
        if kind not in COL_KINDS:
            rep.error('7.collision', ob.name, 'unknown shape kind %r (%s)' % (kind, ', '.join(COL_KINDS)))
            continue
        phys = ob.get('phys')
        if phys is None:
            rep.error('7.collision', ob.name, 'missing custom property phys (%s)' % '|'.join(PHYS_MATERIALS))
        elif phys not in PHYS_MATERIALS:
            rep.error('7.collision', ob.name, 'phys %r not a physics material' % phys)
        for k, rng in (('restitution', (0.0, 1.0)), ('friction', (0.0, 2.0))):
            if k in ob.keys():
                v = ob[k]
                if not _num(v) or not rng[0] <= v <= rng[1]:
                    rep.error('7.collision', ob.name, '%s must be a number in %g..%g, got %r' % (k, rng[0], rng[1], v))
        if 'sharp' in ob.keys() and not isinstance(ob['sharp'], (bool, int)):
            rep.error('7.collision', ob.name, 'sharp must be a boolean')
        pts = geom.local_points(ob, dg)
        if not pts:
            rep.error('7.collision', ob.name, 'empty mesh')
            continue
        lo, hi = geom.bounds(pts)
        dims = hi - lo
        if min(dims) < MIN_SHAPE_THICKNESS:
            rep.error('7.collision', ob.name, 'thinner than 5 mm (%.4f m)' % min(dims))
        if kind == 'sphere':
            c = (lo + hi) / 2
            d = [(p - c).length for p in pts]
            if max(d) - min(d) > 0.03 * max(d) or max(dims) - min(dims) > 0.03 * max(dims):
                rep.error('7.collision', ob.name, 'not a sphere: author a UV sphere (radius is read from bounds)')
        elif kind == 'mesh':
            if info.get('origin') == 'com':
                rep.error('7.collision', ob.name, 'COL__mesh is for static parts only; free bodies need primitives or hulls')
            if geom.tri_count(ob, dg) > MAX_COL_MESH_TRIS:
                rep.error('7.collision', ob.name, 'collision mesh over %d tris' % MAX_COL_MESH_TRIS)
        elif kind == 'heightfield':
            rep.error('7.collision', ob.name, 'heightfields are for environments only')
        elif kind == 'wheel':
            if info.get('type') == 'zippy':  # M4 (E4a): the one part the vehicle wheel shape is for
                continue
            rep.warn('7.collision', ob.name, 'COL__wheel is reserved for Zippy')
        else:
            if not geom.is_convex(ob, dg):
                rep.error('7.collision', ob.name, '%s shape must be convex' % kind)
            if kind == 'hull' and len(pts) > MAX_HULL_VERTS:
                rep.error('7.collision', ob.name, 'hull has %d vertices, max %d' % (len(pts), MAX_HULL_VERTS))


def _host_centre(scene, pos, tol=0.004):
    """M3 (E3a): bounds centre of the LOD0 mesh whose bounding box holds the port point (within `tol`), the
    smallest such box if several; None when none does. Lets a port face out of its own host piece on tall parts
    whose overall centre sits elsewhere (LIFT's arrive ring on the housing top, under the mast's centre)."""
    best = None
    for ob in collection_objects(scene, 'RENDER'):
        if ob.type != 'MESH' or not ob.data.vertices:
            continue
        pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        lo, hi = geom.bounds(pts)
        if all(lo[i] - tol <= pos[i] <= hi[i] + tol for i in range(3)):
            vol = (hi - lo).x * (hi - lo).y * (hi - lo).z
            if best is None or vol < best[0]:
                best = (vol, (lo + hi) / 2)
    return best[1] if best else None


def _check_ports(rep, scene, lo, hi, st_lo=None, st_hi=None):
    objs = collection_objects(scene, 'PORT')
    ports = [ob for ob in objs if parse_name('PORT', ob.name)]
    rings = [ob for ob in objs if parse_port_ring_name(ob.name)]
    # Outward = away from the LOD0 centre or from the static housing's centre (a moving piece such as
    # ANCHOR's eye may stand over its own port).
    centres = [(lo + hi) / 2 if lo is not None else Vector()]
    if st_lo is not None:
        centres.append((st_lo + st_hi) / 2)
    for ob in ports:
        p = parse_name('PORT', ob.name)
        if p['channel'] not in CHANNELS:
            rep.error('8.ports', ob.name, 'unknown channel %r' % p['channel'])
        d, size = ob.get('dir'), ob.get('size')
        if d not in PORT_DIRS:
            rep.error('8.ports', ob.name, 'dir must be in|out|both, got %r' % (d,))
        if size not in PORT_SIZES:
            rep.error('8.ports', ob.name, 'size must be S|M|L, got %r' % (size,))
        if 'kind' in ob.keys() and ob['kind'] not in PORT_KINDS:
            rep.error('8.ports', ob.name, 'kind must be axle|hook|end, got %r' % ob['kind'])
        ml = ob.get('max_links', 1)
        cap = 64 if (p['channel'] == 'signal' and d == 'out' and bool(ob.get('broadcast', False))) else 8
        if not isinstance(ml, int) or isinstance(ml, bool) or not 1 <= ml <= cap:
            rep.error('8.ports', ob.name, 'max_links must be an integer 1..%d, got %r' % (cap, ml))
        if ob.get('broadcast') and not (p['channel'] == 'signal' and d == 'out'):
            rep.error('8.ports', ob.name, 'broadcast is only valid on signal outputs')
        ring = next((r for r in rings if r.name == ob.name + '__ring'), None)
        if ring is None:
            rep.error('8.ports', ob.name, 'no linked port ring instance (kn_tools > Snap Port Ring)')
        else:
            ic = ring.instance_collection
            if ring.instance_type != 'COLLECTION' or ic is None:
                rep.error('8.ports', ring.name, 'ring must be a collection instance of PR_S/PR_M/PR_L')
            else:
                if ic.name != 'PR_%s' % size:
                    rep.error('8.ports', ring.name, 'ring %s does not match size %r' % (ic.name, size))
                if _lib_basename(ic) != 'port_ring.blend':
                    rep.error('8.ports', ring.name, 'ring must be linked from assets/src/lib/port_ring.blend')
            if ring.parent is not ob or not geom.is_identity(ring.matrix_basis):
                rep.error('8.ports', ring.name, 'ring must be parented to its port with an identity local transform')
        pos = ob.matrix_world.translation
        axis = (ob.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
        outs = [pos - c for c in centres]
        host = _host_centre(scene, pos)  # M3 (E3a): or from the centre of the piece it sits on (LIFT's housing top)
        if host is not None:
            outs.append(pos - host)
        if all(o.length > 1e-4 and axis.dot(o.normalized()) <= 0.0 for o in outs):
            rep.error('8.ports', ob.name, 'port +X faces into the housing (must point outward)')
    names = {ob.name for ob in ports}
    for r in rings:
        if r.name[:-len('__ring')] not in names:
            rep.error('8.ports', r.name, 'ring instance without a matching PORT empty')


def _check_sensors_emitters(rep, scene):
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in collection_objects(scene, 'SENSOR'):
        p = parse_name('SENSOR', ob.name)
        if not p:
            continue
        if p['kind'] not in SENSOR_KINDS:
            rep.error('8.sensors', ob.name, 'unknown sensor kind %r (signal/spin/tension/power travel over links only)'
                      % p['kind'])
        if ob.type == 'MESH' and not geom.is_convex(ob, dg):
            rep.error('8.sensors', ob.name, 'sensor volumes must be convex meshes')
        for k in ('threshold', 'cooldown'):
            if k in ob.keys() and not _num(ob[k]):
                rep.error('8.sensors', ob.name, '%s must be a number' % k)


def _check_pivots(rep, scene):
    for ob in collection_objects(scene, 'PIVOT'):
        if ob.get('axis') not in ('x', 'y', 'z'):
            rep.error('9.pivots', ob.name, 'pivot needs custom property axis = x|y|z')
        for k in ('min', 'max'):
            if k in ob.keys() and not _num(ob[k]):
                rep.error('9.pivots', ob.name, '%s must be a number (degrees or metres)' % k)
    for colname in LOD_COLLECTIONS:
        for ob in collection_objects(scene, colname):
            piv = _pivot_ancestors(ob)
            # M2 (E1): a pivot may hang directly under another pivot (PUNCHLINE ram stages, GOTCHA BOX lean ->
            # spring -> head); the piece still belongs to exactly one pivot, its direct parent.
            nested = all(p.parent is piv[k + 1] for k, p in enumerate(piv[:-1]))
            if len(piv) > 1 and not nested:
                rep.error('9.pivots', ob.name, 'moving piece under %d pivots; exactly one allowed' % len(piv))
            if ob.parent is not None and not ob.parent.name.startswith('PIVOT__'):
                rep.error('9.pivots', ob.name, 'render pieces may only be parented to PIVOT__ empties')


OPEN_QUAD_MASTERS = ('kn_decal', 'kn_screen')


def _is_open_quad_piece(ob):
    """Decals (shared_kit §6) and screen quads (§5) are single-sided quads floated over the surface."""
    mats = [s.material.name for s in ob.material_slots if s.material]
    return bool(mats) and all(m in OPEN_QUAD_MASTERS for m in mats)


def _check_manifold(rep, scene, dg):
    for colname in LOD_COLLECTIONS:
        for ob in collection_objects(scene, colname):
            if ob.type != 'MESH' or _is_open_quad_piece(ob):
                continue
            ok, bad = geom.is_manifold(ob, dg)
            if not ok:
                if colname == 'RENDER':
                    rep.error('10.manifold', ob.name, '%d non-manifold/open edges (LOD0 must be watertight for '
                                                      'the SDF bake)' % bad)
                else:
                    rep.warn('10.manifold', ob.name, '%d non-manifold/open edges' % bad)
