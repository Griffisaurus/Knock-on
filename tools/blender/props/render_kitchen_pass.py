"""Mega Kitchen maximalism pass look-dev (M3, stream E3b, environments.md §2.8): imports the *exported*
kitchen.glb, re-binds masters with the tactile look-dev surfaces, and renders the morning rig with the window light
shafts the pass adds (a haze volume lit through the window only), from a close Room view (fridge, drawings, sink,
window) and the Warehouse overview.

Usage: blender -b --factory-startup -P tools/blender/props/render_kitchen_pass.py -- <out.png>
       [--view room|warehouse] [--res 1920x1080] [--samples N] [--both]
"""
import json
import math
import os
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import _tactile as tac  # noqa: E402
import render_lookdev as rl  # noqa: E402
from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from props.render_tinker import stack  # noqa: E402

VIEWS = {  # set coordinates: camera, target, lens, focus distance, f-stop
    'room': ((8.5, 5.5, 7.2), (-4.0, 26.5, 4.2), 24, 24.0, 4.0),
    'warehouse': ((22.0, -34.0, 21.0), (-6.0, 14.0, 4.0), 30, 52.0, 8.0),
}


def main():
    args = _cli.script_args()
    if _cli.flag(args, '--both'):
        out_png = os.path.abspath(args[0])
        parts = []
        for view in ('room', 'warehouse'):
            part = out_png[:-4] + '_' + view + '.png'
            subprocess.run([bpy.app.binary_path, '-b', '--factory-startup', '-P', os.path.abspath(__file__), '--',
                            part, '--view', view] + args[1:], check=True)
            parts.append(part)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        stack(parts, out_png)
        print('rendered', out_png)
        return
    view = _cli.option(args, '--view', 'room')
    res = _cli.option(args, '--res', '1920x1080')
    samples = int(_cli.option(args, '--samples', '160'))
    out_png = os.path.abspath(args[0])
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    kdir = os.path.join(root, 'assets', 'build', 'env', 'kitchen')
    with open(os.path.join(kdir, 'kitchen.env.json'), encoding='utf-8') as f:
        env = json.load(f)
    bpy.ops.import_scene.gltf(filepath=os.path.join(kdir, 'kitchen.glb'))
    keep = {'LOD0', 'BACKDROP', 'REF__scale__room' if view == 'room' else 'REF__scale__warehouse'}
    for ob in list(bpy.data.objects):
        top = ob
        while top.parent is not None:
            top = top.parent
        if top.name.split('.')[0] not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    env_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in env_meshes:
        top = o
        while top.parent is not None:
            top = top.parent
        if top.name.startswith('BACKDROP') or 'window_glass' in o.name:
            o.visible_shadow = False   # the garden is behind the sun and the pane is clear: neither shades
    imported = [m for m in bpy.data.materials if not m.library]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    tac.apply(env_meshes, root)
    sky = masters.get('kn_env_backdrop')
    if sky:
        lit = sky.copy()
        lit.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 4.0
        for ob in env_meshes:
            for slot in ob.material_slots:
                if slot.material == sky:
                    slot.link = 'OBJECT'
                    slot.material = lit
    # a real-size MOCHI on the back counter beside the kettle, for the 5 : 1 read
    mglb = os.path.join(root, 'assets', 'build', 'parts', 'mochi', 'mochi.glb')
    if os.path.exists(mglb):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=mglb)
        new = [ob for ob in bpy.data.objects if ob not in before]
        arm = next(ob for ob in new if ob.type == 'ARMATURE')
        for ob in new:
            if ob.type == 'MESH' and '__L' in ob.name:
                bpy.data.objects.remove(ob, do_unlink=True)
        act = next((a for a in bpy.data.actions if a.name.startswith('mochi__sit') or a.name.startswith('mochi__idle')),
                   None)
        if act:
            arm.animation_data_create()
            arm.animation_data.action = act
        arm.matrix_world = Matrix.Translation(Vector((-4.2, 30.4, 4.6 + 0.14))) @ Matrix.Rotation(math.radians(-30), 4, 'Z')
        tac.apply([ob for ob in bpy.data.objects if ob.type == 'MESH' and ob.find_armature() is arm], root)
    # morning rig (environments.md §2.3): warm low sun through the window, haze -> light shafts (the M3 pass)
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = library.hexcol('#F3E3C8')
    bg.inputs[1].default_value = 0.22
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy, sun.angle, sun.color = 12.0, math.radians(1.5), (1.0, 0.85, 0.68)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    d = Vector(env['light']['sunDir'])
    so.rotation_euler = Vector((d.x, -d.z, d.y)).to_track_quat('-Z', 'Y').to_euler()
    vm = bpy.data.materials.new('haze')
    vm.use_nodes = True
    nt = vm.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    pv = nt.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Density'].default_value = 0.022
    pv.inputs['Anisotropy'].default_value = 0.6
    pv.inputs['Color'].default_value = (1.0, 0.93, 0.82, 1.0)
    nt.links.new(pv.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new('haze')
    bm.to_mesh(me)
    bm.free()
    hz = bpy.data.objects.new('haze', me)
    sc.collection.objects.link(hz)
    if view == 'room':
        hz.location, hz.scale = (0.0, 18.0, 6.7), (40.0, 28.0, 13.3)
    else:
        hz.location, hz.scale = (0.0, 0.0, 6.7), (63.5, 63.5, 13.3)
    me.materials.append(vm)
    hz.visible_shadow = False
    # a shadow-only lid at the wall top: the dollhouse cutaway is open, but the sun only enters by the window
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me2 = bpy.data.meshes.new('lid')
    bm.to_mesh(me2)
    bm.free()
    lid = bpy.data.objects.new('lid', me2)
    sc.collection.objects.link(lid)
    lid.location, lid.scale = (0.0, 0.0, 13.6), (64.8, 64.8, 0.1)
    lid.visible_camera = lid.visible_glossy = lid.visible_diffuse = lid.visible_transmission = False
    lid.visible_volume_scatter = False
    fill = bpy.data.lights.new('Fill', 'AREA')
    fill.energy, fill.size, fill.color = 7000, 40, (1.0, 0.95, 0.9)
    fo = bpy.data.objects.new('Fill', fill)
    sc.collection.objects.link(fo)
    fo.location = (0, -10, 40)
    loc, tgt, lens, focus, fstop = VIEWS[view]
    cd = bpy.data.cameras.new('Camera')
    cd.lens, cd.clip_end = lens, 400
    cd.dof.use_dof, cd.dof.focus_distance, cd.dof.aperture_fstop = True, focus, fstop
    cam = bpy.data.objects.new('Camera', cd)
    sc.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    if os.environ.get('KN_SUN_ONLY'):
        fill.energy = 0.0
        bg.inputs[1].default_value = 0.0
        hz.hide_render = True
    rl.use_cycles(sc, samples)
    sc.cycles.volume_bounces = 1
    sc.cycles.volume_step_rate = 4.0
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    sc.view_settings.exposure = 0.0
    sc.frame_set(1)
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


if __name__ == '__main__':
    main()
