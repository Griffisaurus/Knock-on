"""Mega Kitchen look-dev (M2, stream E2): imports the *exported* kitchen.glb, re-binds master materials by id
(as the engine does) and renders the brief's morning rig (environments.md §2.3) from a preset's spawn camera.
A real-size MOCHI (from its exported glb) sits near the island for the 5 : 1 read.

Usage: blender -b --factory-startup -P tools/blender/render_kitchen.py -- <out.png> [--preset warehouse|room]
       [--view hero|spawn] [--res 1920x1080] [--samples N] [--both]
--both renders the Warehouse and Room hero views and stacks them into <out.png>.
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


def stack(paths_in, out_png):
    import numpy as np
    imgs = [bpy.data.images.load(p) for p in paths_in]
    w = imgs[0].size[0]
    arrs = []
    for im in imgs:
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        arrs.append(a.reshape(im.size[1], im.size[0], 4))
    # Blender pixel rows run bottom-up: the first image goes on top
    full = np.concatenate(list(reversed(arrs)), axis=0)
    out = bpy.data.images.new('stack', w, full.shape[0], alpha=False)
    out.pixels.foreach_set(full.ravel())
    out.filepath_raw = out_png
    out.file_format = 'PNG'
    out.save()


def main():
    args = _cli.script_args()
    if _cli.flag(args, '--both'):
        import subprocess
        out_png = os.path.abspath(args[0])
        rest = args[1:]
        parts = []
        for pr in ('warehouse', 'room'):
            part = out_png[:-4] + '_' + pr + '.png'
            subprocess.run([bpy.app.binary_path, '-b', '--factory-startup', '-P', os.path.abspath(__file__), '--',
                            part, '--preset', pr] + rest, check=True)
            parts.append(part)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        stack(parts, out_png)
        print('rendered', out_png)
        return
    preset = _cli.option(args, '--preset', 'warehouse')
    view = _cli.option(args, '--view', 'hero')   # hero: 3/4 look-dev view; spawn: the preset's default camera
    res = _cli.option(args, '--res', '1920x1080')
    samples = int(_cli.option(args, '--samples', '96'))
    if not args:
        _cli.die('usage: render_kitchen.py -- <out.png>')
    out_png = os.path.abspath(args[0])
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    glb = os.path.join(root, 'assets', 'build', 'env', 'kitchen', 'kitchen.glb')
    with open(os.path.join(root, 'assets', 'build', 'env', 'kitchen', 'kitchen.env.json'), encoding='utf-8') as f:
        env = json.load(f)
    bpy.ops.import_scene.gltf(filepath=glb)
    # LOD0 + backdrop + this preset's scale reference only
    keep = {'LOD0', 'BACKDROP', 'REF__scale__' + preset}
    for ob in list(bpy.data.objects):
        top = ob
        while top.parent is not None:
            top = top.parent
        if top.name.split('.')[0] not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    # the glb is in set (= Warehouse) coordinates; the camera uses set coordinates too
    p = env['presets'][preset]
    off = Vector(p['origin'])  # engine
    off_b = Vector((off.x, -off.z, off.y))

    def to_set(e):
        return Vector((e[0], -e[2], e[1])) + off_b

    # a real-size critter for scale
    mglb = os.path.join(root, 'assets', 'build', 'parts', 'mochi', 'mochi.glb')
    if os.path.exists(mglb):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=mglb)
        new = [ob for ob in bpy.data.objects if ob not in before]
        arm = next(ob for ob in new if ob.type == 'ARMATURE')
        for ob in new:
            if ob.type == 'MESH' and '__L' in ob.name:
                bpy.data.objects.remove(ob, do_unlink=True)
        act = next((a for a in bpy.data.actions if a.name.startswith('mochi__idle')), None)
        if act:
            arm.animation_data_create()
            arm.animation_data.action = act
        # on the back counter beside the kettle (counter top z 4.6; the glb origin is the cat's centre of mass)
        spot = Vector((-18.6, 30.2, 4.6 + 0.14))
        arm.matrix_world = Matrix.Translation(spot) @ Matrix.Rotation(math.radians(-25), 4, 'Z')
    imported = [m for m in bpy.data.materials if not m.library]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    # the window sky card glows (kn_env_backdrop); make it read as daylight in Cycles
    sky = masters.get('kn_env_backdrop')
    rl.use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    sc.view_settings.exposure = 0.3
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = library.hexcol('#F3E3C8')
    bg.inputs[1].default_value = 0.55
    # morning sun through the window: elevation 22 deg, from +Y, 20 deg toward +X, 4300 K
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.2
    sun.angle = math.radians(2.0)
    sun.color = (1.0, 0.86, 0.72)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    d = Vector(env['light']['sunDir'])          # engine direction the light travels
    db = Vector((d.x, -d.z, d.y))               # -> set (Blender)
    so.rotation_euler = db.to_track_quat('-Z', 'Y').to_euler()
    # soft fill from the open top (the dollhouse cutaway)
    fill = bpy.data.lights.new('Fill', 'AREA')
    fill.energy, fill.size, fill.color = 60000, 40, (1.0, 0.95, 0.9)
    fo = bpy.data.objects.new('Fill', fill)
    sc.collection.objects.link(fo)
    fo.location = (0, -10, 40)
    # morning haze (environments.md §2.3, froxel fog) is an engine effect; a world volume here would also
    # swallow the open-top sky, so the look-dev leaves it out
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 30 if preset == 'warehouse' else 24
    cam_d.clip_end = 400
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    if view == 'spawn':
        cam.location = to_set(p['camera'])
        tgt = to_set(p['target'])
    elif preset == 'room':
        cam.location = Vector((7.0, 8.0, 7.5))
        tgt = Vector((-1.5, 26.0, 4.5))
    else:
        cam.location = Vector((22.0, -34.0, 21.0))
        tgt = Vector((-6.0, 14.0, 4.0))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    _ = sky
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


main()
