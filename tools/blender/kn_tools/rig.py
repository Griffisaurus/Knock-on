"""Critter rigs (M2, stream E2): validator rule 11 and the skinned glb / .art.json extension.

ASSET_PIPELINE §6 critter rig standard: <= 80 deform bones, <= 4 influences per vertex, `root` bone at the
floor under the centre of mass, `head`, `spine_01-03`, limb chains, tail chain (<= 8); clips are actions
`<type>__<clip>` at 30 fps with no root motion; the ragdoll is `RAG__<bone>` capsules carrying `swing_deg`,
`twist_deg` and `mass`.

Engine data written here uses the exporter's conventions (export.py): engine Y-up metres, part space
(origin = centre of mass), Blender (x, y, z) -> engine (x, z, -y).
"""
import os
import re

import bpy
from mathutils import Matrix, Vector

from . import geom, template
from .conventions import LOD_COLLECTIONS, blender_to_engine, round_list, split_list

REQUIRED_CLIPS = ('idle', 'idle_alt', 'walk', 'run', 'chase', 'flee', 'startled', 'tumble', 'getup', 'dizzy',
                  'trapped', 'celebrate', 'sleep', 'sniff', 'emote_happy', 'emote_angry', 'emote_confused')
MAX_DEFORM_BONES = 80
MAX_INFLUENCES = 4
MAX_TAIL = 8
CLIP_FPS = 30
# Bones that must carry a ragdoll capsule when the rig has them ("ragdoll capsules for all major bones").
MAJOR_BONES = ('hips', 'spine_02', 'head', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r')
ART_BIBLE_FACE = ('sk_blink_l', 'sk_blink_r', 'sk_happy', 'sk_smug', 'sk_scared', 'sk_angry', 'sk_dizzy',
                  'sk_sleepy', 'sk_surprised', 'sk_determined', 'sk_vis_a', 'sk_vis_o', 'sk_vis_e')
_RE_BONE = re.compile(r'^[a-z0-9]+(?:_[a-z0-9]+)*$')
_RE_ROOT_PATH = re.compile(r'^pose\.bones\["root"\]\.')
_RE_BONE_PATH = re.compile(r'^pose\.bones\["([^"]+)"\]\.')


def find_rig(scene):
    col = template.get_collection('RIG', scene, create=False)
    if not col:
        return None
    for ob in col.all_objects:
        if ob.type == 'ARMATURE' and ob.name == 'RIG':
            return ob
    return None


def rag_objects(scene):
    col = template.get_collection('RIG', scene, create=False)
    return [ob for ob in col.all_objects if ob.name.startswith('RAG__')] if col else []


def lod_meshes(scene, i):
    col = template.get_collection(LOD_COLLECTIONS[i], scene, create=False)
    return [ob for ob in col.all_objects if ob.type == 'MESH'] if col else []


def critter_actions(ptype):
    return sorted((a for a in bpy.data.actions if not a.library and a.name.startswith(ptype + '__')),
                  key=lambda a: a.name)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------------------------------------------------------------- rule 11

def check_critter(rep, scene, root, dg=None):
    R = '11.critter'
    ptype = root.get('kn_type', root.name)
    rig = find_rig(scene)
    if rig is None:
        rep.error(R, 'RIG', 'critters need a `RIG` armature in the RIG collection (ASSET_PIPELINE §6)')
        return
    bones = rig.data.bones
    names = [b.name for b in bones]
    deform = [b for b in bones if b.use_deform]
    dnames = {b.name for b in deform}
    rep.stats['rig'] = '%d deform bones (%d total)' % (len(deform), len(bones))
    if len(deform) > MAX_DEFORM_BONES:
        rep.error(R, 'RIG', '%d deform bones, max %d' % (len(deform), MAX_DEFORM_BONES))
    for b in names:
        if not _RE_BONE.match(b):
            rep.error(R, 'RIG', 'bone %r is not lower_snake' % b)
    # M4 stream E4b: robot critters (kn_robot: DUSTY; BUZZ in M5) are rigid. Their rig is `root` + `body` plus
    # pivot-mirror bones (critters.md: "2 bones + the pivots"), the face is LED screens, not shape keys, and the
    # ragdoll is one RAG__body entry (a rigid tumble)
    robot = bool(root.get('kn_robot', False))
    for req in (('root', 'body') if robot else ('root', 'head')):
        if req not in names:
            rep.error(R, 'RIG', 'missing required bone %r' % req)
    spines = [n for n in names if re.match(r'^spine_\d\d$', n)]
    for req in (() if robot else ('spine_01', 'spine_02', 'spine_03')):
        if req not in spines:
            rep.error(R, 'RIG', 'missing required bone %r' % req)
    roots = [b for b in bones if b.parent is None]
    if [b.name for b in roots] != ['root']:
        rep.error(R, 'RIG', 'exactly one parentless bone, `root`, expected; found %s' % [b.name for b in roots])
    if 'root' in names:
        h = bones['root'].head_local
        if h.z > -1e-4 or abs(h.x) > 1e-4:
            rep.error(R, 'root', 'root bone must sit on the floor under the centre of mass (x = 0, below the '
                                 'origin); head at %s' % (tuple(round(c, 4) for c in h),))
    tail = [n for n in names if re.match(r'^tail_\d\d$', n)]
    if len(tail) > MAX_TAIL:
        rep.error(R, 'RIG', 'tail chain has %d bones, max %d' % (len(tail), MAX_TAIL))
    if not geom.is_identity(rig.matrix_world):
        rep.error(R, 'RIG', 'the armature object must sit at the part origin with no rotation or scale')

    # skin: every LOD skinned to RIG, <= 4 influences, normalised, groups only for deform bones
    for i, colname in enumerate(LOD_COLLECTIONS):
        for ob in lod_meshes(scene, i):
            mods = [m for m in ob.modifiers if m.type == 'ARMATURE']
            if len(mods) != 1 or mods[0].object is not rig:
                rep.error(R, ob.name, 'LOD mesh must have exactly one Armature modifier targeting RIG')
                continue
            gname = {g.index: g.name for g in ob.vertex_groups}
            bad_groups = sorted({gname[i] for i in gname} - dnames - set())
            over, unnorm, empty, nondef = 0, 0, 0, set()
            for v in ob.data.vertices:
                ws = [(gname[g.group], g.weight) for g in v.groups if g.weight > 1e-6]
                if not ws:
                    empty += 1
                    continue
                if len(ws) > MAX_INFLUENCES:
                    over += 1
                for n, _w in ws:
                    if n not in dnames:
                        nondef.add(n)
                if abs(sum(w for _n, w in ws) - 1.0) > 0.01:
                    unnorm += 1
            if over:
                rep.error(R, ob.name, '%d vertices have more than %d bone influences' % (over, MAX_INFLUENCES))
            if empty:
                rep.error(R, ob.name, '%d vertices have no bone weights' % empty)
            if unnorm:
                rep.error(R, ob.name, '%d vertices have weights that do not sum to 1' % unnorm)
            if nondef:
                rep.error(R, ob.name, 'weights on non-deform or missing bones: %s' % ', '.join(sorted(nondef)))
            elif bad_groups:
                rep.warn(R, ob.name, 'vertex groups without a deform bone: %s' % ', '.join(bad_groups))
            if any(m.type not in ('ARMATURE',) for m in ob.modifiers):
                rep.error(R, ob.name, 'only the Armature modifier is allowed on skinned meshes (apply the rest)')
            sk = ob.data.shape_keys
            if sk:
                for kb in sk.key_blocks[1:]:
                    if not kb.name.startswith('sk_'):
                        rep.error(R, ob.name, 'shape key %r must be named sk_<name>' % kb.name)
                if i == 0:
                    missing = [k for k in ART_BIBLE_FACE if k not in sk.key_blocks]
                    if missing:
                        rep.warn(R, ob.name, 'face shape keys missing (ART_BIBLE §8): %s' % ', '.join(missing))
            elif i == 0 and not robot:
                rep.warn(R, ob.name, 'no face shape keys (ART_BIBLE §8)')

    # clips
    fps = scene.render.fps / scene.render.fps_base
    if abs(fps - CLIP_FPS) > 1e-6:
        rep.error(R, None, 'scene frame rate is %g fps; critter clips are authored at %d fps' % (fps, CLIP_FPS))
    acts = critter_actions(ptype)
    have = {a.name.split('__', 1)[1]: a for a in acts}
    role = split_list(root.get('kn_role_clips', ''))
    for clip in REQUIRED_CLIPS + tuple(role):
        if clip not in have:
            rep.error(R, None, 'missing clip action %s__%s' % (ptype, clip))
    tracks = set()
    if rig.animation_data:
        for tr in rig.animation_data.nla_tracks:
            for st in tr.strips:
                if st.action:
                    tracks.add(st.action.name)
    for name, act in have.items():
        if act.name not in tracks:
            rep.error(R, act.name, 'clip is not on an NLA track of RIG (the glTF exporter would skip it)')
        for fc in act.fcurves:
            m = _RE_BONE_PATH.match(fc.data_path)
            if m and m.group(1) not in names:
                rep.error(R, act.name, 'animates missing bone %r' % m.group(1))
            if _RE_ROOT_PATH.match(fc.data_path):
                vals = [k.co[1] for k in fc.keyframe_points]
                rest = 1.0 if (fc.data_path.endswith('rotation_quaternion') and fc.array_index == 0) or \
                    fc.data_path.endswith('scale') else 0.0
                if vals and (max(vals) - min(vals) > 1e-6 or abs(vals[0] - rest) > 1e-6):
                    rep.error(R, act.name, 'root motion: the root bone is animated (%s[%d])'
                              % (fc.data_path, fc.array_index))
    rep.stats['clips'] = '%d (%s)' % (len(have), ', '.join(sorted(have)))

    # ragdoll
    rags = rag_objects(scene)
    covered = set()
    total = 0.0
    for ob in rags:
        b = ob.name[len('RAG__'):]
        if b not in names:
            rep.error(R, ob.name, 'RAG__ capsule names a missing bone %r' % b)
            continue
        if b not in dnames:
            rep.error(R, ob.name, 'RAG__ capsule bone %r is not a deform bone' % b)
        covered.add(b)
        for k, lo, hi in (('swing_deg', 0.0, 180.0), ('twist_deg', 0.0, 180.0), ('mass', 1e-6, 1e6)):
            v = ob.get(k)
            if not _num(v) or not lo <= v <= hi:
                rep.error(R, ob.name, 'custom property %s must be a number in %g..%g, got %r' % (k, lo, hi, v))
        if _num(ob.get('mass')):
            total += float(ob['mass'])
        if ob.type != 'MESH':
            rep.error(R, ob.name, 'RAG__ capsules are meshes (cylinder-ish along local Z)')
            continue
        pts = geom.local_points(ob, dg)
        if pts:
            lo, hi = geom.bounds(pts)
            if min(hi.x - lo.x, hi.y - lo.y) < 0.005:
                rep.error(R, ob.name, 'capsule thinner than 5 mm')
            if not geom.is_convex(ob, dg):
                rep.error(R, ob.name, 'capsule mesh must be convex')
    # the capsules form one tree: rag_parent (when authored) names another capsule, exactly one root
    parents = {ob.name[len('RAG__'):]: (ob['rag_parent'] or None) for ob in rags if 'rag_parent' in ob.keys()}
    if parents:
        for b, p in parents.items():
            if p is not None and p not in covered:
                rep.error(R, 'RAG__' + b, 'rag_parent %r is not another RAG__ capsule' % p)
        roots_ = [b for b, p in parents.items() if p is None]
        if len(roots_) != 1:
            rep.error(R, None, 'the ragdoll needs exactly one root capsule (rag_parent empty), found %s' % roots_)
    missing = [b for b in (('body',) if robot else MAJOR_BONES) if b in names and b not in covered]
    if missing:
        rep.error(R, None, 'no ragdoll capsule for major bones: %s' % ', '.join(missing))
    if not rags:
        rep.error(R, None, 'no RAG__ ragdoll capsules')
    mh = root.get('kn_mass_hint')
    if rags and _num(mh) and abs(total - mh) > 0.02 * mh:
        rep.error(R, None, 'ragdoll masses sum to %.3f kg but kn_mass_hint is %g kg' % (total, mh))
    rep.stats['ragdoll'] = '%d capsules, %.3f kg' % (len(rags), total)


# ---------------------------------------------------------------- export

def _eng(v, nd=5):
    return round_list(blender_to_engine(v), nd)


def critter_art(scene, root):
    """The .art.json extension for critters: rig, skin, ragdoll, clip timing, shape keys, emitter bones."""
    from .export import q_engine
    ptype = root['kn_type']
    rig = find_rig(scene)
    bones = rig.data.bones
    root_head = bones['root'].head_local
    rigd = {
        'armature': 'RIG',
        'deformBones': sum(1 for b in bones if b.use_deform),
        'maxInfluences': MAX_INFLUENCES,
        'root': 'root',
        'rootPos': _eng(root_head),
        'bones': [{'name': b.name, 'parent': b.parent.name if b.parent else None, 'head': _eng(b.head_local),
                   'tail': _eng(b.tail_local), 'deform': bool(b.use_deform)} for b in bones],
    }
    rag_by_bone = {ob.name[len('RAG__'):]: ob for ob in rag_objects(scene)}
    ragdoll = []
    for ob in sorted(rag_by_bone.values(), key=lambda o: [b.name for b in bones].index(o.name[5:])):
        bname = ob.name[len('RAG__'):]
        if 'rag_parent' in ob.keys():
            pname = ob['rag_parent'] or None
        else:
            par = bones[bname].parent
            while par is not None and par.name not in rag_by_bone:
                par = par.parent
            pname = par.name if par is not None else None
        mw = ob.matrix_world
        lo, hi = geom.bounds(geom.local_points(ob))
        c = mw @ ((lo + hi) / 2)
        r = max(hi.x - lo.x, hi.y - lo.y) / 2
        hh = max(0.0, (hi.z - lo.z) / 2 - r)
        shape = ob.get('rag_shape', 'capsule')   # M4 (E4b): 'cylinder' for a robot critter's rigid RAG__body
        if shape == 'cylinder':
            hh = (hi.z - lo.z) / 2
        box = None
        if shape == 'box':   # M5 (E5b): a robot critter's rigid box RAG__body (BUZZ); radius = half the X span
            hh = (hi.z - lo.z) / 2
            r = (hi.x - lo.x) / 2
            box = [round(abs(v) / 2, 5) for v in blender_to_engine(hi - lo)]
        axis = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
        ha = c - axis * hh   # joint end (a) and far end (b), as in parts-data RagBone
        hb = c + axis * hh
        entry = {'bone': bname, 'name': ob.name, 'parent': pname, 'shape': shape,
                 'radius': round(r, 5), 'halfHeight': round(hh, 5), 'pos': _eng(c), 'rot': q_engine(mw.to_3x3()),
                 'axis': _eng(axis, 6), 'rootPos': _eng(c - root_head), 'a': _eng(ha - root_head),
                 'b': _eng(hb - root_head),
                 'swing': float(ob['swing_deg']), 'twist': float(ob['twist_deg']), 'mass': float(ob['mass']),
                 'phys': ob.get('phys', 'fur')}
        for k in ('friction', 'restitution'):
            if k in ob.keys():
                entry[k] = float(ob[k])
        if box is not None:
            entry['halfExtents'] = box
        ragdoll.append(entry)
    clip_info = []
    for a in critter_actions(ptype):
        f0, f1 = a.frame_range
        frames = int(round(f1 - f0))
        clip_info.append({'name': a.name.split('__', 1)[1], 'action': a.name, 'frames': frames,
                          'seconds': round(frames / CLIP_FPS, 4), 'loop': bool(a.get('kn_loop', False))})
    keys = []
    lod0 = lod_meshes(scene, 0)
    for ob in lod0:
        if ob.data.shape_keys:
            keys = [kb.name for kb in ob.data.shape_keys.key_blocks[1:]]
    emit_bones = {}
    for ob in template.get_collection('EMIT', scene, create=False).all_objects:
        if 'bone' in ob.keys():
            emit_bones[ob.name] = ob['bone']
    # M4 (E4b): robot critters' LED face: per clip, [frame, icon] keys from the action's `kn_face` JSON (the
    # brief's face_icon track; glTF can't carry custom-property animation), plus the icon set and pivot bones
    extra = {}
    if root.get('kn_robot'):
        import json
        tracks = {}
        for a in critter_actions(ptype):
            if a.get('kn_face'):
                tracks[a.name.split('__', 1)[1]] = json.loads(a['kn_face'])
        extra = {'robot': True, 'faceTracks': tracks, 'faceIcons': split_list(root.get('kn_face_icons', '')),
                 'pivotBones': {ob.name: ob['bone'] for ob in template.get_collection('PIVOT', scene, create=False)
                                .all_objects if 'bone' in ob.keys()}}
    return dict(extra, **{
        'rig': rigd,
        'skin': {'meshes': [ob.name for i in range(4) for ob in lod_meshes(scene, i)], 'joints': 'all bones',
                 'morphLods': [i for i in range(4) if any(o.data.shape_keys for o in lod_meshes(scene, i))]},
        'ragdoll': ragdoll,
        'clipFps': CLIP_FPS,
        'clipInfo': clip_info,
        'roleClips': split_list(root.get('kn_role_clips', '')),
        'shapeKeys': keys,
        'emitterBones': emit_bones,
        'comRoot': [float(x) for x in split_list(root.get('kn_com_root', ''))],
    })


def export_critter_glb(scene, filepath):
    """LOD0..LOD3 nodes, each holding one skinned mesh, one shared skin from `RIG`, one glTF animation per clip
    action, face morph targets (sparse) on the LODs that carry shape keys."""
    rig = find_rig(scene)
    created, restore = [], []
    pose_pos = rig.data.pose_position
    active = rig.animation_data.action if rig.animation_data else None
    try:
        for ob in scene.objects:
            ob.select_set(False)
        sel = [rig]
        for i in range(4):
            empty = bpy.data.objects.new('LOD%d' % i, None)
            scene.collection.objects.link(empty)
            created.append(empty)
            sel.append(empty)
            for ob in lod_meshes(scene, i):
                restore.append((ob, ob.parent, ob.matrix_parent_inverse.copy(), ob.matrix_world.copy()))
                ob.parent = empty
                ob.matrix_parent_inverse = Matrix.Identity(4)
                sel.append(ob)
        for ob in sel:
            ob.select_set(True)
        rig.data.pose_position = 'POSE'
        if rig.animation_data:
            rig.animation_data.action = None
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        from . import textures  # M4 (E4b): critters with a D78 set export MikkTSpace tangents, like parts
        tangents = textures.has_set(scene)
        bpy.ops.export_scene.gltf(
            filepath=filepath, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
            export_cameras=False, export_lights=False, export_extras=False, export_materials='EXPORT',
            export_image_format='NONE', export_texcoords=True, export_normals=True, export_tangents=tangents,
            export_draco_mesh_compression_enable=False, export_skins=True, export_def_bones=False,
            export_morph=True, export_morph_normal=False, export_animations=True,
            export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
            export_anim_single_armature=True, export_reset_pose_bones=True, export_optimize_animation_size=True)
    finally:
        rig.data.pose_position = pose_pos
        if rig.animation_data:
            rig.animation_data.action = active
        for ob, parent, mpi, mw in reversed(restore):
            ob.parent = parent
            ob.matrix_parent_inverse = mpi
            ob.matrix_world = mw
        for e in created:
            bpy.data.objects.remove(e)
    return filepath
