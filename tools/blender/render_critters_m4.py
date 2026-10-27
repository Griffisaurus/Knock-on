"""M4 critter look-dev and contact sheet (stream E4b): BISCUIT, HENNY, DUSTY from their *exported* glbs.

Same round trip as render_critters.py (M2): each glb is imported, its materials are re-bound to the master
materials by id, and LOD0 is posed with its own glTF clips. Critters that carry a D78 texture set get it bound
the way the engine binds it (TEXCOORD_0; albedo sRGB, ORM R occlusion / G roughness / B metallic, OpenGL +Y
normal), as render_textured.py does for parts. DUSTY's LED eyes are lit with the clip's face icon colour.

Usage: blender -b --factory-startup -P tools/blender/render_critters_m4.py -- <out.png> [type ...]
       [--res 2400x1900] [--samples N] [--el 38] [--yaw -32] [--flat] [--turn] [--rows N]
  --turn   one row per view (front, 3/4, side, back) of the rest pose instead of the clip poses
  --flat   masters only (no texture set)
  --clips  'clip@sec,...' rows instead of the default poses (with --rows N to keep N of them)
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402

import render_lookdev as rl  # noqa: E402

CRITTERS = ('biscuit', 'henny', 'dusty')
# (row label, clip, time in seconds) per critter
POSES = {
    'biscuit': [('idle', 'idle', 0.0), ('chase', 'chase', 0.12), ('bark', 'bark', 0.2), ('sleep', 'sleep', 0.0)],
    'henny': [('idle', 'idle', 0.0), ('peck', 'peck', 0.25), ('flap', 'flap', 0.15), ('lay_egg', 'lay_egg', 0.6)],
    'dusty': [('idle', 'idle', 0.0), ('suck', 'suck', 0.15), ('bin_full', 'bin_full', 0.9),
              ('celebrate', 'celebrate', 0.5)],
}
TURN = [('front', 0.0, None), ('three quarter', -35.0, None), ('side', -90.0, None), ('back', 150.0, None)]
CELL = 0.5
FIT = 0.34
# DUSTY LED face colour (Beam) and the per-icon brightness of the two eye screens
BEAM = (0.18, 0.84, 1.0)


def import_critter(glb):
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    arm = next(ob for ob in new if ob.type == 'ARMATURE')
    body = [ob for ob in new if ob.type == 'MESH' and ob.find_armature() is arm and '__L' not in ob.name]
    for ob in new:
        if ob is not arm and ob not in body and ob.type == 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
    acts = [a for a in bpy.data.actions if a not in acts_before]
    return arm, body, acts


def find_action(acts, name):
    for a in acts:
        base = a.name.split('.')[0]
        if base == name or base.startswith(name + '_') or base.startswith(name + '|'):
            return a
    return None


def label(text, loc, size, mat, align='CENTER'):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = align
    ob = bpy.data.objects.new('lbl', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)
    return ob


def world_bounds(meshes):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        pts.extend(ob.matrix_world @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def textured_copy(master, imgs, cache):
    """Local copy of a master with the set plugged in (engine binding; render_textured.py)."""
    key = (master.name, id(imgs['albedo']))
    if key in cache:
        return cache[key]
    m = master.copy()
    m.name = master.name + '__set'
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    tex = {}
    for k in ('albedo', 'orm', 'normal'):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = imgs[k]
        t.interpolation = 'Linear'
        nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
        tex[k] = t
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex['orm'].outputs['Color'], sep.inputs['Color'])
    occ = nt.nodes.new('ShaderNodeMix')
    occ.data_type = 'RGBA'
    occ.blend_type = 'MULTIPLY'
    occ.inputs['Factor'].default_value = 0.5
    nt.links.new(tex['albedo'].outputs['Color'], occ.inputs['A'])
    nt.links.new(sep.outputs['Red'], occ.inputs['B'])
    for lk in list(bsdf.inputs['Base Color'].links):
        nt.links.remove(lk)
    nt.links.new(occ.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
    bump = next((n for n in nt.nodes if n.type == 'BUMP'), None)
    if bump is not None:
        nt.links.new(nm.outputs['Normal'], bump.inputs['Normal'])
    else:
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    cache[key] = m
    return m


def load_set(root, t, art):
    tx = art.get('textures')
    if not tx:
        return None
    d = os.path.join(root, 'assets', 'build', 'parts', t)
    imgs = {}
    for k, cs in (('albedo', 'sRGB'), ('orm', 'Non-Color'), ('normal', 'Non-Color')):
        img = bpy.data.images.load(os.path.join(d, tx[k]), check_existing=True)
        img.colorspace_settings.name = cs
        imgs[k] = img
    return imgs, set(tx.get('slots', []))


def lit_screen(name, strength=6.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
    p.inputs['Emission Color'].default_value = (*BEAM, 1)
    p.inputs['Emission Strength'].default_value = strength
    return m


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '2400x1900')
    samples = int(_cli.option(args, '--samples', '48'))
    nrows = int(_cli.option(args, '--rows', '4'))
    elev = float(_cli.option(args, '--el', '38'))
    yaw = float(_cli.option(args, '--yaw', '-32'))
    flat = _cli.flag(args, '--flat')
    turn = _cli.flag(args, '--turn')
    clips = _cli.option(args, '--clips', None)   # 'clip@sec,clip@sec,...' instead of the default poses
    across = _cli.flag(args, '--across') or turn   # poses along X, critters along Y
    if not args:
        _cli.die('usage: render_critters_m4.py -- <out.png> [type ...]')
    out_png = os.path.abspath(args[0])
    types = args[1:] or list(CRITTERS)
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = 30
    lbl_mat = bpy.data.materials.new('label')
    lbl_mat.use_nodes = True
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    custom = [(c.split('@')[0] + '@' + c.split('@')[1], c.split('@')[0], float(c.split('@')[1]), None, None)
              for c in clips.split(',')] if clips else None
    rows_spec = {t: (custom if custom else [(lbl, 'idle', 0.0, a, e) for lbl, a, e in TURN] if turn else
                     [(lbl, c, s, None, None) for lbl, c, s in POSES[t]])[:nrows] for t in types}
    cols = len(types)
    rows = max(len(v) for v in rows_spec.values())
    if across:
        cols, rows = rows, cols

    def grid(ci, ri):
        gx, gy = (ri, ci) if across else (ci, ri)
        return (gx - (cols - 1) / 2) * CELL, ((rows - 1) / 2 - gy) * CELL * 0.92
    sets = {}
    for ci, t in enumerate(types):
        glb = os.path.join(root, 'assets', 'build', 'parts', t, t + '.glb')
        with open(os.path.join(root, 'assets', 'build', 'parts', t, t + '.art.json'), encoding='utf-8') as f:
            art = json.load(f)
        mats_before = set(bpy.data.materials)
        arm0, body0, acts = import_critter(glb)
        if not flat:
            s = load_set(root, t, art)
            if s:
                sets[t] = (s, [m for m in bpy.data.materials if m not in mats_before])
        lo, hi = world_bounds(body0)
        size = hi - lo
        s = FIT / max(size.x, size.y, size.z)
        faces = art.get('faceTracks', {})
        for ri, (rlabel, clip, tsec, vyaw, vel) in enumerate(rows_spec[t]):
            if ri == 0:
                arm, body = arm0, body0
            else:
                arm = arm0.copy()
                arm.data = arm0.data
                sc.collection.objects.link(arm)
                body = []
                for b in body0:
                    nb = b.copy()
                    sc.collection.objects.link(nb)
                    nb.parent = arm
                    nb.matrix_parent_inverse = b.matrix_parent_inverse.copy()
                    for m in nb.modifiers:
                        if m.type == 'ARMATURE':
                            m.object = arm
                    body.append(nb)
            act = find_action(acts, '%s__%s' % (t, clip))
            arm.animation_data_create()
            arm.animation_data.action = act
            if act is not None and hasattr(arm.animation_data, 'action_slot') and act.slots:
                arm.animation_data.action_slot = act.slots[0]
            frame = int(round(tsec * 30))
            sc.frame_set(frame)
            cx, cy = grid(ci, ri)
            arm.matrix_world = Matrix.Identity(4)
            bpy.context.view_layer.update()
            plo, phi = world_bounds(body)
            centre = (plo + phi) / 2
            ry = yaw if vyaw is None else vyaw
            m = (Matrix.Translation(Vector((cx, cy, 0.0))) @ Matrix.Rotation(math.radians(ry), 4, 'Z') @
                 Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-centre.x, -centre.y, -plo.z))))
            arm.matrix_world = m
            arm['kn_frame'] = frame
            # DUSTY: light the eye screens for this clip's face icon (art.json faceTracks)
            if faces:
                icon = 'neutral'
                for f0, name in faces.get(clip, []):
                    if f0 <= frame:
                        icon = name
                arm['kn_icon'] = icon
                for b in body:
                    for slot in b.material_slots:
                        if slot.material and slot.material.name.split('.')[0] == 'kn_screen':
                            slot.link = 'OBJECT'
                            dim = icon in ('sleepy', 'blink')
                            slot.material = lit_screen('screen_' + icon, 2.0 if dim else 7.0)
            if ri == 0:
                ext = [art['bounds']['max'][k] - art['bounds']['min'][k] for k in range(3)]
                yb = (cy if across else -((rows - 1) / 2) * CELL * 0.92) - CELL * 0.52
                label('%s' % t.upper(), (cx, yb, 0.0005), 0.05, lbl_mat)
                label('%.2f x %.2f x %.2f m · %d tris · %d bones · %d clips%s' % (
                    ext[0], ext[1], ext[2], art['lods'][0]['tris'], art['rig']['deformBones'], len(art['clips']),
                    ' · tex %d²' % art['textures']['size'] if art.get('textures') and not flat else ''),
                    (cx, yb - CELL * 0.09, 0.0005), 0.018, lbl_mat)
            label(rlabel, (cx, cy - CELL * 0.33, 0.0005), 0.022, lbl_mat)
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE' and ob.animation_data and ob.animation_data.action:
            act = ob.animation_data.action
            f = ob.get('kn_frame', 0)
            for tr in list(ob.animation_data.nla_tracks):
                ob.animation_data.nla_tracks.remove(tr)
            ob.animation_data.action = None
            tr = ob.animation_data.nla_tracks.new()
            st = tr.strips.new(act.name, int(-f), act)
            st.extrapolation = 'HOLD'
    sc.frame_set(0)
    imported = [m for m in bpy.data.materials if not m.library and m.name != 'label' and
                not m.name.startswith('screen_')]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    cache = {}
    for m in imported:
        key = m.name.split('.')[0]
        if key not in masters:
            continue
        tgt = masters[key]
        for t, ((imgs, slots), mats) in sets.items():
            if m in mats and key in slots:
                tgt = textured_copy(masters[key], imgs, cache)
        m.user_remap(tgt)
    rl.use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.7
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    cyc_mat = bpy.data.materials.new('cyc_light')
    cyc_mat.use_nodes = True
    p = cyc_mat.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = library.hexcol('#BDB8AF')
    p.inputs['Roughness'].default_value = 0.92
    span_x, span_y = cols * CELL, rows * CELL * 0.92
    rl.cyc(cyc_mat, width=span_x * 3, front=span_y * 2, back=span_y * 0.7 + 0.3, radius=0.8, height=3.0)
    target = Vector((0.0, -CELL * 0.25, 0.05))
    rl.area('Key', (-1.6, -1.8, 2.4), target, 560, 2.0)
    rl.area('Fill', (2.0, -1.2, 1.0), target, 160, 2.0)
    rl.area('Rim', (0.3, 2.0, 1.6), target, 380, 1.8, color=(0.86, 0.94, 1.0))
    rl.area('Top', (0, 0.2, 3.0), target, 240, 3.0)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 50
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    dist = max(span_x * 1.06 / 0.72, span_y * 1.25 / 0.57)
    el = math.radians(elev)
    cam.location = (0.0, -dist * math.cos(el), dist * math.sin(el))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


if __name__ == '__main__':
    main()
