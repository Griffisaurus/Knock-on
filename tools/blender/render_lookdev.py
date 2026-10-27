"""Look-dev render of an *exported* part: imports the .glb, re-binds master materials by id from
materials.blend (what the engine does), and renders LOD0 in front of LOD1-3 on the light cyc.
Cycles (GPU when available, denoised) so clear poly shells and glass refract; `--eevee` for a quick draft.

Usage: blender -b --factory-startup -P tools/blender/render_lookdev.py -- <part.glb> <out.png> [--res 1280x720]
       [--eevee] [--samples N]
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402


def cyc(mat, width=6.0, front=3.0, back=0.8, radius=0.8, height=3.0):
    prof = [(-front, 0.0)]
    y = -front
    while y < back:
        y = min(back, y + 0.25)
        prof.append((y, 0.0))
    for i in range(1, 17):
        t = math.radians(90 * i / 16)
        prof.append((back + radius * math.sin(t), radius * (1 - math.cos(t))))
    prof.append((back + radius, height))
    verts = [(-width / 2, py, pz) for py, pz in prof] + [(width / 2, py, pz) for py, pz in prof]
    n = len(prof)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    me = bpy.data.meshes.new('cyc')
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new('cyc', me)
    bpy.context.scene.collection.objects.link(ob)


def area(name, loc, target, power, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy, ld.color, ld.size = power, color, size
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def bind_decal_atlas(root):
    """kn_decal in materials.blend is a flat grey placeholder; for look-dev, draw what the engine draws:
    assets/build/kit/decals_atlas.png at the quad UVs, alpha-tested at 0.5."""
    png = os.path.join(root, 'assets', 'build', 'kit', 'decals_atlas.png')
    users = [ob for ob in bpy.data.objects if ob.type == 'MESH'
             and any(s.material and s.material.name.split('.')[0] == 'kn_decal' for s in ob.material_slots)]
    if not users or not os.path.exists(png):
        return
    m = bpy.data.materials.new('kn_decal_lookdev')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = 0.5
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(png, check_existing=True)
    tex.interpolation = 'Linear'
    cut = nt.nodes.new('ShaderNodeMath')
    cut.operation = 'GREATER_THAN'
    cut.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], cut.inputs[0])
    nt.links.new(cut.outputs['Value'], p.inputs['Alpha'])
    for ob in users:
        for slot in ob.material_slots:
            if slot.material and slot.material.name.split('.')[0] == 'kn_decal':
                slot.link = 'OBJECT'
                slot.material = m


def use_cycles(sc, samples):
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev_type in ('OPTIX', 'CUDA', 'HIP'):
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            if any(d.type == dev_type for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dev_type
                sc.cycles.device = 'GPU'
                break
        except Exception:  # noqa: BLE001 - fall back to CPU
            continue
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 12
    sc.cycles.transmission_bounces = 12
    sc.cycles.transparent_max_bounces = 12


def frame_size(meshes):
    """Camera scale from LOD0's bounds: tall parts by height, long parts (Bangstick, Treadway) by width."""
    lod0 = [ob for ob in meshes if _under(ob, 'LOD0')] or meshes
    pts = [ob.matrix_world @ Vector(c) for ob in lod0 for c in ob.bound_box]
    if not pts:
        return 0.2
    ext = [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]
    return max(ext[2], 0.62 * ext[0], 0.5 * ext[1], 0.05)


def _under(ob, name):
    p = ob.parent
    while p is not None:
        if p.name == name:
            return True
        p = p.parent
    return False


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '1280x720')
    eevee = _cli.flag(args, '--eevee')
    samples = int(_cli.option(args, '--samples', '48'))
    if len(args) < 2:
        _cli.die('usage: render_lookdev.py -- <part.glb> <out.png> [--res WxH]')
    glb, out_png = os.path.abspath(args[0]), os.path.abspath(args[1])
    root = paths.repo_root(glb)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)

    # Engine-side material resolution: glTF materials are named by master id.
    imported = [m for m in bpy.data.materials if not m.library]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    bind_decal_atlas(root)

    lods = {ob.name: ob for ob in bpy.data.objects if ob.name in ('LOD0', 'LOD1', 'LOD2', 'LOD3')}
    meshes = [ob for ob in bpy.data.objects if ob.type == 'MESH']
    zs = [(ob.matrix_world @ Vector(c)).z for ob in meshes for c in ob.bound_box]
    lift = -min(zs) if zs else 0.0
    size = frame_size(meshes)
    layout = {'LOD0': (0.0, 0.0), 'LOD1': (-1.45 * size, 2.4 * size), 'LOD2': (0.05 * size, 2.9 * size),
              'LOD3': (1.45 * size, 2.4 * size)}
    for name, (x, y) in layout.items():
        if name in lods:
            lods[name].location = (x, y, lift)

    sc = bpy.context.scene
    if eevee:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
        sc.eevee.taa_render_samples = 64
        if hasattr(sc.eevee, 'use_raytracing'):
            sc.eevee.use_raytracing = True
    else:
        use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.0
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.25

    cyc_mat = bpy.data.materials.new('cyc_light')
    cyc_mat.use_nodes = True
    p = cyc_mat.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = library.hexcol('#BDB8AF')
    p.inputs['Roughness'].default_value = 0.92
    cyc(cyc_mat)

    target = Vector((0.0, 0.25 * size, 0.45 * size))
    area('Key', (-0.8, -0.75, 0.95), target, 90, 0.8)
    area('Fill', (0.9, -0.6, 0.35), target, 18, 1.0)
    area('Rim', (0.3, 1.2, 0.9), target, 110, 0.8, color=(0.86, 0.94, 1.0))
    area('Top', (0, 0.1, 1.4), target, 35, 1.5)

    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 46
    cam_d.clip_start = 0.01
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    cam.location = (0.12 * size / 0.22, -1.1 * size / 0.22, 0.5 * size / 0.22)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam

    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


if __name__ == '__main__':
    main()
