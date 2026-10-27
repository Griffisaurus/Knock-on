"""`kn_tools > Export Part` (ASSET_PIPELINE §8): .blend -> <type>.glb + <type>.art.json + <type>.shapes.json.

Coordinates: everything written here is engine Y-up metres relative to the part origin. Blender (x, y, z)
maps to engine (x, z, -y), the same conversion the glTF exporter applies with export_yup (DATA_FORMATS §8).
"""
import json
import os

import bpy
from mathutils import Matrix, Vector

from . import geom, paths, template, validate
from .conventions import (LOD_COLLECTIONS, PIPELINE_VERSION, ROOT_OPTIONAL, ROOT_PIPELINE, ROOT_REQUIRED,
                          blender_to_engine, parse_footprint, parse_led_groups, parse_name, round_list, split_list)

# Change of basis Blender Z-up -> engine Y-up.
C = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))

# Steps of the §8 pipeline that M0 does not run yet. Each is a named hook so the build reports them explicitly.
DEFERRED = (
    ('frac', '{t}.frac.glb', 'fracture chunks + hulls (breakables only, §7)'),
    ('sdf', '{t}.sdf.ktx2', 'signed distance field bake (tools/bake, Node + Dawn)'),
    ('impostor', '{t}.impostor.ktx2', 'octahedral impostor bake (tools/bake)'),
    ('thumbs', '{t}.thumb.webp / {t}.thumb_128.webp', 'Library cards rendered in-engine (tools/bake)'),
    ('cavity_lut', '{t}.art.json cavities[].lut', 'fill LUT bake for CAVITY__ meshes (§3.10)'),
)


class ExportError(RuntimeError):
    pass


def v_engine(v, nd=5):
    return round_list(blender_to_engine(v), nd)


def q_engine(m3):
    """Rotation (Blender basis) -> engine quaternion [x, y, z, w]."""
    q = (C @ m3.normalized() @ C.transposed()).to_quaternion()
    if q.w < 0:
        q = -q
    return round_list((q.x, q.y, q.z, q.w), 6)


def dumps(obj):
    """JSON with short numeric arrays (vectors, quaternions) kept on one line."""
    def enc(o, ind):
        pad = '  ' * ind
        if isinstance(o, dict):
            if not o:
                return '{}'
            items = ['%s  %s: %s' % (pad, json.dumps(k), enc(v, ind + 1)) for k, v in o.items()]
            return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
        if isinstance(o, list):
            if not o:
                return '[]'
            if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in o):
                return '[' + ', '.join(json.dumps(x) for x in o) + ']'
            return '[\n' + ',\n'.join(pad + '  ' + enc(x, ind + 1) for x in o) + '\n' + pad + ']'
        return json.dumps(o)
    return enc(obj, 0) + '\n'


def _objs(scene, colname):
    return validate.collection_objects(scene, colname)


def _axis_x(ob):
    return (ob.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()


def _follow(ob):
    """M2 (E1): the pivot a COL shape, sensor or emitter rides (name without PIVOT__), from its `pivot` custom
    prop ('lid' or 'PIVOT__lid') or else its nearest PIVOT__ ancestor; None when it is static. Positions in the
    outputs stay in part space at the rest pose; the engine carries the item with that pivot."""
    v = ob.get('pivot')
    if not v:
        p = ob.parent
        while p is not None and not p.name.startswith('PIVOT__'):
            p = p.parent
        v = p.name if p is not None else None
    if not v:
        return None
    v = str(v)
    return v[len('PIVOT__'):] if v.startswith('PIVOT__') else v


# ---------------------------------------------------------------- clips (M2, stream E1)
# Baked mechanism clips (ASSET_PIPELINE §6: Gotcha Box pop, Big Top recoil) are actions named <type>__<clip>,
# stored on the PIVOT__ empties as muted NLA tracks (so the saved rest pose stays the authored one). The glTF
# exporter merges every object's strip of one action into one animation named after it.

def _clip_actions(scene):
    root = template.find_root(scene)
    if root is None:
        return []
    prefix = root['kn_type'] + '__'
    return [a for a in bpy.data.actions if not a.library and a.name.startswith(prefix)]


def _share_clips(src, dst):
    """Give a LOD proxy pivot the same clip strips (same action and slot) as its LOD0 pivot."""
    ad = src.animation_data
    if ad is None or not ad.nla_tracks:
        return
    dad = dst.animation_data_create()
    for tr in ad.nla_tracks:
        nt = dad.nla_tracks.new()
        nt.name = tr.name
        for st in tr.strips:
            ns = nt.strips.new(st.name, int(st.frame_start), st.action)
            if getattr(st, 'action_slot', None) is not None:
                ns.action_slot = st.action_slot
        nt.mute = tr.mute


# ---------------------------------------------------------------- glb

def export_glb(scene, filepath):
    """Export LOD0..LOD3 under nodes named LOD0..LOD3.

    Pivot empties export under LOD0 with their moving pieces. LOD1..3 moving pieces get a per-LOD copy of
    their pivot node (`PIVOT__<name>__L<n>`, same transform), so every LOD keeps the moving/static split
    the engine needs to draw a hinged part's arm separately (apps/game glbmesh.ts)."""
    created, restore = [], []
    try:
        for ob in scene.objects:
            ob.select_set(False)
        export_set = set()
        for i, colname in enumerate(LOD_COLLECTIONS):
            empty = bpy.data.objects.new('LOD%d' % i, None)
            scene.collection.objects.link(empty)
            created.append(empty)
            empty.select_set(True)
            members = [ob for ob in _objs(scene, colname) if ob.type == 'MESH']
            if i == 0:
                # Pivot empties carry the moving pieces; they export as nodes under LOD0.
                members += [p for p in _objs(scene, 'PIVOT')]
            else:
                proxies = {}

                def proxy(piv, i=i, proxies=proxies):
                    # M2 (E1): nested pivots (PIVOT__ parented to PIVOT__) keep their chain per LOD, and clip
                    # NLA tracks (<type>__<clip>) are shared so every LOD's proxy animates with LOD0.
                    px = proxies.get(piv.name)
                    if px is None:
                        px = bpy.data.objects.new('%s__L%d' % (piv.name, i), None)
                        scene.collection.objects.link(px)
                        created.append(px)
                        px.rotation_mode = piv.rotation_mode
                        up = piv.parent if piv.parent is not None and piv.parent.name.startswith('PIVOT__') else None
                        if up is not None:
                            px.parent = proxy(up)
                            px.matrix_parent_inverse = piv.matrix_parent_inverse.copy()
                            px.matrix_basis = piv.matrix_basis.copy()
                        else:
                            px.matrix_world = piv.matrix_world.copy()
                        _share_clips(piv, px)
                        proxies[piv.name] = px
                    return px
                for ob in list(members):
                    piv = ob.parent
                    if piv is None or not piv.name.startswith('PIVOT__'):
                        continue
                    px = proxy(piv)
                    # a freshly nested proxy's matrix_world is stale until the depsgraph updates; without this
                    # LOD1-3 pieces under nested pivots were offset by the pivot's world transform
                    bpy.context.view_layer.update()
                    mw = ob.matrix_world.copy()
                    restore.append((ob, ob.parent, ob.matrix_parent_inverse.copy(), mw))
                    ob.parent = px
                    ob.matrix_parent_inverse = px.matrix_world.inverted()
                members += list(proxies.values())
            member_set = set(members)
            for ob in members:
                export_set.add(ob)
                if ob.parent is None or ob.parent not in member_set:
                    restore.append((ob, ob.parent, ob.matrix_parent_inverse.copy(), ob.matrix_world.copy()))
                    ob.parent = empty
                    ob.matrix_parent_inverse = Matrix.Identity(4)
                    ob.matrix_world = restore[-1][3]
        for ob in export_set:
            ob.select_set(True)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        # M2 (E1): part shape keys export as morph targets (names in mesh.extras.targetNames, default weights
        # = key values). glTF's export_apply would drop shape keys, and part meshes carry no live modifiers.
        morph = any(ob.type == 'MESH' and ob.data.shape_keys for ob in export_set)
        # M3 (E3c): parts with a texture set also export MikkTSpace tangents (the frame the normal map was
        # baked in); TEXCOORD_0 is the set's UV1 atlas
        from . import textures
        tangents = textures.has_set(scene)
        bpy.ops.export_scene.gltf(
            filepath=filepath, export_format='GLB', use_selection=True, export_apply=not morph, export_yup=True,
            export_cameras=False, export_lights=False, export_extras=False,
            export_animations=bool(_clip_actions(scene)),  # M2 (E1): baked <type>__<clip> clips only
            export_materials='EXPORT', export_image_format='NONE', export_texcoords=True, export_normals=True,
            export_tangents=tangents, export_draco_mesh_compression_enable=False, export_skins=False,
            export_morph=morph, export_morph_normal=morph)
    finally:
        for ob, parent, mpi, mw in reversed(restore):
            ob.parent = parent
            ob.matrix_parent_inverse = mpi
            ob.matrix_world = mw
        for e in created:
            bpy.data.objects.remove(e)
    return filepath


# ---------------------------------------------------------------- art.json

def build_art(scene, root, tris, materials, dg):
    ptype = root['kn_type']
    pts = []
    for ob in _objs(scene, 'RENDER'):
        if ob.type == 'MESH':
            pts.extend(geom.world_points(ob, dg))
    eng = [blender_to_engine(p) for p in pts]
    lo = [min(p[i] for p in eng) for i in range(3)]
    hi = [max(p[i] for p in eng) for i in range(3)]

    ports = []
    for ob in _objs(scene, 'PORT'):
        p = parse_name('PORT', ob.name)
        if not p:
            continue
        entry = {'name': p['name'], 'channel': p['channel'], 'dir': ob.get('dir', 'both'), 'size': ob.get('size', 'M'),
                 'pos': v_engine(ob.matrix_world.translation), 'dirVec': v_engine(_axis_x(ob), 6)}
        if 'max_links' in ob.keys():
            entry['maxLinks'] = int(ob['max_links'])
        if ob.get('broadcast'):
            entry['broadcast'] = True
        if 'kind' in ob.keys():
            entry['kind'] = ob['kind']
        if ob.get('pivot'):  # M2 (E1): port rides this pivot; pos / dirVec are at the pivot's rest pose
            entry['pivot'] = _follow(ob)
        ports.append(entry)

    sensors = []
    for ob in _objs(scene, 'SENSOR'):
        p = parse_name('SENSOR', ob.name)
        if not p or ob.type != 'MESH':
            continue
        wp = geom.world_points(ob, dg)
        slo, shi = geom.bounds(wp)
        c = (slo + shi) / 2
        entry = {'name': p['name'], 'kind': p['kind'], 'pos': v_engine(c),
                 'points': [v_engine(q - c) for q in wp]}
        for k in ('threshold', 'cooldown'):
            if k in ob.keys():
                entry[k] = float(ob[k])
        if _follow(ob):  # M2: rides a pivot
            entry['pivot'] = _follow(ob)
        sensors.append(entry)

    emitters = []
    for ob in _objs(scene, 'EMIT'):
        p = parse_name('EMIT', ob.name)
        if p:
            entry = {'name': p['name'], 'fx': p['fx'], 'pos': v_engine(ob.matrix_world.translation),
                     'dirVec': v_engine(_axis_x(ob), 6)}
            if _follow(ob):  # M2: rides a pivot
                entry['pivot'] = _follow(ob)
            emitters.append(entry)

    pivots = []
    for ob in _objs(scene, 'PIVOT'):
        p = parse_name('PIVOT', ob.name)
        if not p:
            continue
        local = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}.get(ob.get('axis', 'z'))
        axis = (ob.matrix_world.to_3x3() @ local).normalized()
        entry = {'name': p['name'], 'pos': v_engine(ob.matrix_world.translation),
                 'rot': q_engine(ob.matrix_world.to_3x3()), 'axis': v_engine(axis, 6)}
        for k in ('min', 'max'):
            if k in ob.keys():
                entry[k] = float(ob[k])
        if ob.parent is not None and ob.parent.name.startswith('PIVOT__'):  # M2: nested pivot chain
            entry['parent'] = ob.parent.name[len('PIVOT__'):]
        if ob.get('motion') in ('slide', 'turn'):  # M2: explicit slide (metres) vs turn (degrees) pivots
            entry['motion'] = ob['motion']
        if 'rest' in ob.keys():  # M2: the pose the pieces are modelled in (pivot value, degrees or metres)
            entry['rest'] = float(ob['rest'])
        pivots.append(entry)

    screens = []
    for ob in _objs(scene, 'SCREEN'):
        p = parse_name('SCREEN', ob.name)
        if not p or ob.type != 'MESH':
            continue
        slo, shi = geom.bounds(geom.world_points(ob, dg))
        entry = {'name': p['name'], 'kind': ob.get('kind', 'icon'), 'pos': v_engine((slo + shi) / 2),
                 'size': round_list([abs(x) for x in blender_to_engine(shi - slo)])}
        for k in ('digits', 'cells'):
            if k in ob.keys():
                entry[k] = int(ob[k])
        if 'color' in ob.keys():
            entry['color'] = ob['color']
        screens.append(entry)

    # M4 (stream E4a): cavities carry volume, bounds, the 64-entry fill LUT, the cavity mesh and (under a pivot) the
    # tilt LUTs for the container-fill pass (kn_tools/cavity.py, ASSET_PIPELINE §3.10)
    from . import cavity
    cavities = cavity.art_entries(scene, dg, _objs, parse_name, blender_to_engine, round_list)

    # M2 (E1): device sockets for critters (ASSET_PIPELINE §3.9): socket_* bones of a device RIG armature,
    # rest pose in part space, with the PIVOT__ they follow (Copy Transforms subtarget or the `follow` prop).
    sockets = []
    for ob in _objs(scene, 'RIG'):
        if ob.type != 'ARMATURE':
            continue
        for b in ob.data.bones:
            if not b.name.startswith('socket_'):
                continue
            mw = ob.matrix_world @ b.matrix_local
            entry = {'name': b.name, 'pos': v_engine(mw.translation), 'rot': q_engine(mw.to_3x3())}
            follow = None
            pb = ob.pose.bones.get(b.name)
            for c in (pb.constraints if pb else ()):
                if c.type in ('COPY_TRANSFORMS', 'CHILD_OF') and getattr(c, 'target', None) is not None:
                    follow = c.target.name
            follow = follow or (pb.get('follow') if pb else None)
            if follow:
                entry['follow'] = follow[len('PIVOT__'):] if follow.startswith('PIVOT__') else follow
            if b.parent is not None:
                entry['parent'] = b.parent.name
            sockets.append(entry)

    hints = {}
    known = set(ROOT_REQUIRED) | set(ROOT_OPTIONAL) | set(ROOT_PIPELINE)
    for k in root.keys():
        v = root[k]
        if k.startswith('kn_') and k not in known and isinstance(v, (bool, int, float)):
            hints[k] = v

    clips = sorted(a.name.split('__', 1)[1] for a in bpy.data.actions
                   if not a.library and a.name.startswith(ptype + '__'))

    art = {
        'type': ptype,
        'version': int(root.get('kn_version', 1)),
        'class': root['kn_class'],
        'family': root['kn_family'],
        'origin': root.get('kn_origin', 'com'),
        'footprint': [float(v) for v in parse_footprint(root['kn_footprint'])],
        'bounds': {'min': round_list(lo), 'max': round_list(hi)},
        'ports': ports,
        'sensors': sensors,
        'emitters': emitters,
        'pivots': pivots,
        'screens': screens,
        'cavities': cavities,
        'ledGroups': parse_led_groups(root.get('led_groups', '')),
        'lods': [{'tris': tris[c]} for c in LOD_COLLECTIONS],
        'clips': clips,
        'skins': split_list(root.get('kn_skins', '')),
        'massHint': float(root['kn_mass_hint']),
        'materials': [m.name for m in materials],
        'hints': hints,
        'generator': 'kn_tools %s / Blender %s' % (PIPELINE_VERSION, bpy.app.version_string),
    }
    if sockets:
        art['sockets'] = sockets
    # M2 (E1): part shape keys (glTF morph targets on these LOD0 meshes and their LOD1 twins)
    shape_keys = []
    for ob in _objs(scene, 'RENDER'):
        if ob.type != 'MESH' or not ob.data.shape_keys:
            continue
        lods = [0] + [i for i, c in ((1, 'LOD1'), (2, 'LOD2'), (3, 'LOD3'))
                      if any(o.name == '%s__L%d' % (ob.name, i) and o.data.shape_keys for o in _objs(scene, c))]
        for kb in ob.data.shape_keys.key_blocks[1:]:
            shape_keys.append({'name': kb.name, 'mesh': ob.name, 'lods': lods, 'default': round(float(kb.value), 4),
                               'range': str(ob.get('kn_sk__' + kb.name, ''))})
    if shape_keys:
        art['shapeKeys'] = shape_keys
    if root.get('kn_notes'):
        art['notes'] = root['kn_notes']
    return art


# ---------------------------------------------------------------- shapes.json

def build_shapes(scene, root, dg):
    shapes = []
    for ob in _objs(scene, 'COL'):
        p = parse_name('COL', ob.name)
        if not p or ob.type != 'MESH':
            continue
        kind = p['kind']
        lp = geom.local_points(ob, dg)
        lo, hi = geom.bounds(lp)
        c = (lo + hi) / 2
        d = hi - lo
        mw = ob.matrix_world
        s = {'name': p['name'], 'kind': kind, 'pos': v_engine(mw @ c), 'rot': q_engine(mw.to_3x3())}
        if kind == 'sphere':
            s['radius'] = round(max(d) / 2, 5)
        elif kind == 'box':
            # Blender local (x, y, z) -> engine local (x, z, y) under the basis change.
            s['halfExtents'] = round_list((d.x / 2, d.z / 2, d.y / 2))
            s['convexRadius'] = float(ob.get('convex_radius', 0.0))
        elif kind in ('capsule', 'cylinder', 'wheel'):
            # Authored along local Z; Jolt runs them along local Y, which is where C maps Blender Z.
            r = max(d.x, d.y) / 2
            s['radius'] = round(r, 5)
            s['halfHeight'] = round(max(0.0, d.z / 2 - (r if kind == 'capsule' else 0.0)), 5)
        elif kind == 'hull':
            s['points'] = [round_list(C @ (q - c)) for q in lp]
        elif kind == 'mesh':
            with geom.EvaluatedMesh(ob, dg) as me:
                me.calc_loop_triangles()
                s['vertices'] = [round_list(C @ (v.co - c)) for v in me.vertices]
                s['indices'] = [i for t in me.loop_triangles for i in t.vertices]
        s['phys'] = ob.get('phys', 'powder')
        for k in ('restitution', 'friction'):
            if k in ob.keys():
                s[k] = float(ob[k])
        if ob.get('sharp'):
            s['sharp'] = True
        if _follow(ob):  # M2 (E1): the shape rides this pivot (pose = its rest)
            s['pivot'] = _follow(ob)
        shapes.append(s)
    return {'type': root['kn_type'], 'shapes': shapes}


# ---------------------------------------------------------------- entry point

def deferred_steps(scene, ptype):
    out = []
    for key, artifact, what in DEFERRED:
        applies = True
        if key == 'frac':
            applies = bool(_objs(scene, 'FRAC'))
        elif key == 'cavity_lut':
            applies = bool(_objs(scene, 'CAVITY'))
        status = 'deferred' if applies else 'n/a'
        if key == 'frac' and applies:  # M2 (E1): its own step, `node tools/assets.mjs <type> --frac`
            status = 'separate (--frac)'
        if key == 'cavity_lut' and applies:  # M4 (E4a): baked into .art.json cavities[] (kn_tools/cavity.py)
            status = 'baked'
        out.append({'step': key, 'artifact': artifact.format(t=ptype), 'what': what, 'status': status})
    return out


def export_part(out_dir=None, scene=None, validate_first=True, root_dir=None, log=print):
    scene = scene or bpy.context.scene
    root = template.find_root(scene)
    if root is None:
        raise ExportError('no root object with kn_type; run kn_tools > New Part first')
    ptype = root['kn_type']
    report = None
    if validate_first:
        report = validate.validate(scene)
        log(report.format())
        if not report.ok:
            raise ExportError('validation failed (%d errors); nothing exported' % len(report.errors))
    if out_dir is None:
        out_dir = paths.build_dir(root_dir or paths.repo_root(bpy.data.filepath or None), ptype)
    os.makedirs(out_dir, exist_ok=True)
    dg = bpy.context.evaluated_depsgraph_get()
    tris = validate.lod_tris(scene, dg)
    materials = validate.part_materials(scene)

    art = build_art(scene, root, tris, materials, dg)
    shapes = build_shapes(scene, root, dg)
    if root.get('kn_family') == 'critters':
        # M2 stream E2: skinned glb (skin, clips, face morphs) + rig / ragdoll / clip data (kn_tools/rig.py)
        from . import rig
        art.update(rig.critter_art(scene, root))
        glb_path = rig.export_critter_glb(scene, os.path.join(out_dir, ptype + '.glb'))
        # M4 stream E4b: critters with a D78 set ship it like parts (<type>.tex.*.png, .art.json textures,
        # glb extras.texSet); critters without one (the M2 cast) get no entry
        from . import textures
        tex = textures.export_set(scene, out_dir, glb_path, log)
        if tex:
            art['textures'] = tex
    else:
        glb_path = export_glb(scene, os.path.join(out_dir, ptype + '.glb'))
        # M3 (E3c): texture set -> <type>.tex.{albedo,normal,orm}.png, .art.json textures, glb extras.texSet
        from . import textures
        tex = textures.export_set(scene, out_dir, glb_path, log)
        if tex:
            art['textures'] = tex
    art_path = os.path.join(out_dir, ptype + '.art.json')
    shapes_path = os.path.join(out_dir, ptype + '.shapes.json')
    with open(art_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps(art))
    with open(shapes_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps(shapes))
    steps = deferred_steps(scene, ptype)
    if art.get('textures'):  # M3 (E3c): no offline KTX2 transcoder yet; the set ships as PNG
        steps.append({'step': 'ktx2', 'artifact': '%s.tex.*.ktx2' % ptype,
                      'what': 'texture set UASTC + RDO + zstd, full mips (BC7 on desktop); PNG until toktx',
                      'status': 'deferred'})
    summary = {
        'type': ptype,
        'source': bpy.data.filepath,
        'outputs': {'glb': glb_path, 'art': art_path, 'shapes': shapes_path},
        'bytes': dict({'glb': os.path.getsize(glb_path)},
                      **({'tex': art['textures']['bytes']} if art.get('textures') else {})),
        'lods': art['lods'],
        'validation': report.as_dict() if report else None,
        'deferred': steps,
    }
    with open(os.path.join(out_dir, ptype + '.report.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(summary, f, indent=2)
        f.write('\n')
    log('exported %s: %s (%d bytes), %s, %s' % (ptype, glb_path, summary['bytes']['glb'], art_path, shapes_path))
    for s in steps:
        if s['status'] == 'deferred':
            log('  deferred (M0): %s -> %s' % (s['step'], s['artifact']))
    return summary
