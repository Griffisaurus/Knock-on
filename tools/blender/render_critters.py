"""Critter contact sheet (M2, stream E2): imports each *exported* critter glb, re-binds master materials by id
(as the engine does), and poses LOD0 with its own glTF clips: one column per critter, one row per pose.
This is also a round-trip check: skins, inverse binds and clips are read back from the glb, not the .blend.

Usage: blender -b --factory-startup -P tools/blender/render_critters.py -- <out.png> [type ...]
       [--res 2400x1800] [--samples N] [--eevee]
"""
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

CRITTERS = ('mochi', 'pip', 'goby', 'bandit')
# (row label, clip, time in seconds) per critter
POSES = {
    'mochi': [('idle', 'idle', 0.0), ('walk', 'walk', 0.3), ('pounce', 'pounce', 0.55), ('sleep', 'sleep', 0.0)],
    'pip': [('idle', 'idle', 0.0), ('run', 'run', 0.12), ('stuff_cheeks', 'stuff_cheeks', 0.9),
            ('sleep', 'sleep', 0.0)],
    'goby': [('idle', 'idle', 0.0), ('swim', 'swim', 0.2), ('flop', 'flop', 0.25), ('celebrate', 'celebrate', 0.6)],
    'bandit': [('idle', 'idle', 0.0), ('walk', 'walk', 0.3), ('steal_carry', 'steal_carry', 0.2),
               ('pedal', 'pedal', 0.25)],
}
CELL = 0.5
FIT = 0.34


def import_critter(glb):
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    arm = next(ob for ob in new if ob.type == 'ARMATURE')
    # the importer re-parents skinned meshes to the armature; LOD0 is the one without an __L<n> suffix
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


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '2400x1900')
    samples = int(_cli.option(args, '--samples', '48'))
    eevee = _cli.flag(args, '--eevee')
    nrows = int(_cli.option(args, '--rows', '4'))
    elev = float(_cli.option(args, '--el', '40'))
    yaw = float(_cli.option(args, '--yaw', '-32'))
    if not args:
        _cli.die('usage: render_critters.py -- <out.png> [type ...]')
    out_png = os.path.abspath(args[0])
    types = args[1:] or list(CRITTERS)
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = 30
    lbl_mat = bpy.data.materials.new('label')
    lbl_mat.use_nodes = True
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    cols, rows = len(types), nrows
    import json
    for ci, t in enumerate(types):
        glb = os.path.join(root, 'assets', 'build', 'parts', t, t + '.glb')
        with open(os.path.join(root, 'assets', 'build', 'parts', t, t + '.art.json'), encoding='utf-8') as f:
            art = json.load(f)
        arm0, body0, acts = import_critter(glb)
        # true size from the rest pose
        lo, hi = world_bounds(body0)
        size = hi - lo
        s = FIT / max(size.x, size.y, size.z)
        cx = (ci - (cols - 1) / 2) * CELL
        for ri, (rlabel, clip, tsec) in enumerate(POSES.get(t, POSES['mochi'])[:rows]):
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
            cy = ((rows - 1) / 2 - ri) * CELL * 0.92
            arm.matrix_world = Matrix.Identity(4)
            bpy.context.view_layer.update()
            plo, phi = world_bounds(body)
            centre = (plo + phi) / 2
            m = (Matrix.Translation(Vector((cx, cy, 0.0))) @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @
                 Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-centre.x, -centre.y, -plo.z))))
            arm.matrix_world = m
            arm['kn_frame'] = frame
            if ri == 0:
                ext = [art['bounds']['max'][k] - art['bounds']['min'][k] for k in range(3)]
                yb = -((rows - 1) / 2) * CELL * 0.92 - CELL * 0.52
                label('%s' % t.upper(), (cx, yb, 0.0005), 0.05, lbl_mat)
                label('%.2f x %.2f x %.2f m · %d tris · %d bones · %d clips' % (
                    ext[0], ext[1], ext[2], art['lods'][0]['tris'], art['rig']['deformBones'], len(art['clips'])),
                    (cx, yb - CELL * 0.09, 0.0005), 0.018, lbl_mat)
            label(rlabel, (cx, cy - CELL * 0.33, 0.0005), 0.022, lbl_mat)
            arm['kn_action'] = act.name if act else ''
    # every posed copy has its own action; frame_set once more evaluates them all at their own frame
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE' and ob.animation_data and ob.animation_data.action:
            act = ob.animation_data.action
            f = ob.get('kn_frame', 0)
            # offset the action so the shared scene frame shows each copy's chosen frame
            for tr in list(ob.animation_data.nla_tracks):
                ob.animation_data.nla_tracks.remove(tr)
            ob.animation_data.action = None
            tr = ob.animation_data.nla_tracks.new()
            st = tr.strips.new(act.name, int(-f), act)
            st.extrapolation = 'HOLD'
    sc.frame_set(0)
    imported = [m for m in bpy.data.materials if not m.library and m.name != 'label']
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    if eevee:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
        sc.eevee.taa_render_samples = 64
    else:
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


main()
