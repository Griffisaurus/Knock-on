"""Library and UI part thumbnails per the thumbnail rig (art/briefs/ui_icons.md §6): front-right three-quarter
(azimuth 30°, elevation 20°, vertical FOV 24°), bounding sphere at 80 % of the frame height (88 % for the
128² crop) shifted up 6 %, transparent background with a soft contact shadow, from the *exported* glb.
Renders straight at the output size (the brief's 2x-then-Lanczos downsample is left to tools/bake).

--warm   uses the Tinker Lab light (D77/D78): warm window key, golden rim, cool fill.
--tactile swaps masters for the _tactile.py look-dev surfaces (the D78 texture-pass target).
Without either flag it is the Studio Light rig with the shipped masters (what the engine shows today).

Usage: blender -b --factory-startup -P tools/blender/render_thumbs.py -- <out_dir> [--types thud,motor,...]
       [--size 512] [--crop128] [--warm] [--tactile] [--samples N]
Writes <out_dir>/<type>.thumb.webp (or <type>.thumb_128.webp with --crop128), lossless with alpha.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import render_lookdev as rl  # noqa: E402
from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402

SKIP = {'mochi', 'pip', 'goby', 'bandit'}  # critters have their own card art (critters.md)


def import_lod0(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    lod0 = next((ob for ob in bpy.data.objects if ob.name.startswith('LOD0')), None)
    keep = set()
    stack = [lod0] if lod0 else []
    while stack:
        o = stack.pop()
        keep.add(o)
        stack.extend(o.children)
    for ob in list(bpy.data.objects):
        if lod0 and ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    return [ob for ob in bpy.data.objects if ob.type == 'MESH']


def bind_masters(root, meshes, tactile):
    if tactile:
        import _tactile
        _tactile.apply(meshes, root)
    else:
        imported = [m for m in bpy.data.materials if not m.library]
        wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
        masters = library.link_materials(paths.materials_lib(root), wanted)
        for m in imported:
            key = m.name.split('.')[0]
            if key in masters:
                m.user_remap(masters[key])
    rl.bind_decal_atlas(root)
    # LEDs and port rings at "active" 100 % (ui_icons §6): a warm-white glow stands in for the channel colour
    for m in bpy.data.materials:
        if m.name.split('.')[0] == 'kn_led' and m.library is None and m.use_nodes:
            p = m.node_tree.nodes.get('Principled BSDF')
            if p:
                p.inputs['Emission Strength'].default_value = 3.0


def bounds(meshes):
    pts = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def rig(centre, radius, warm):
    s = radius / 0.25  # the look-dev rig is tuned for a ~0.5 m part
    def at(v):
        return centre + Vector(v) * s
    if warm:
        rl.area('Key', at((-1.0, -1.1, 1.0)), centre, 260 * s * s, 0.9 * s, color=(1.0, 0.82, 0.62))
        rl.area('Fill', at((1.2, -0.9, 0.3)), centre, 40 * s * s, 1.2 * s, color=(0.78, 0.86, 1.0))
        rl.area('Rim', at((0.9, 1.3, 0.8)), centre, 420 * s * s, 0.7 * s, color=(1.0, 0.7, 0.4))
        rl.area('Top', at((0.0, 0.1, 1.5)), centre, 60 * s * s, 1.5 * s, color=(1.0, 0.92, 0.82))
    else:
        rl.area('Key', at((-0.8, -0.75, 0.95)), centre, 90 * 4.2 * s * s / 4, 0.8 * s)
        rl.area('Fill', at((0.9, -0.6, 0.35)), centre, 18 * 4.2 * s * s / 4, 1.0 * s)
        rl.area('Rim', at((0.3, 1.2, 0.9)), centre, 110 * 4.2 * s * s / 4, 0.8 * s, color=(0.86, 0.94, 1.0))
        rl.area('Top', at((0.0, 0.1, 1.4)), centre, 35 * 4.2 * s * s / 4, 1.5 * s)


def render_one(root, kind, out_path, size, fill, warm, tactile, samples):
    glb = os.path.join(root, 'assets', 'build', 'parts', kind, kind + '.glb')
    meshes = import_lod0(glb)
    bind_masters(root, meshes, tactile)
    lo, hi = bounds(meshes)
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)

    sc = bpy.context.scene
    rl.use_cycles(sc, samples)
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filter_size = 1.2
    sc.render.resolution_percentage = 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.9 if not warm else -1.5
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.5, 0.45, 1) if warm else (0.5, 0.5, 0.52, 1)
    bg.inputs[1].default_value = 0.3

    # shadow catcher under the part (35 % contact shadow written into alpha)
    bpy.ops.mesh.primitive_plane_add(size=radius * 12, location=(centre.x, centre.y, lo.z))
    catcher = bpy.context.active_object
    catcher.is_shadow_catcher = True
    rig(centre, radius, warm)

    fov = math.radians(24)
    dist = radius / math.sin(fill * fov / 2)
    az, el = math.radians(30), math.radians(20)
    # front is -Y; azimuth turns toward +X
    direction = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cd = bpy.data.cameras.new('Camera')
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = fov
    cd.clip_start = radius * 0.05
    cd.shift_y = -0.06
    cam = bpy.data.objects.new('Camera', cd)
    sc.collection.objects.link(cam)
    cam.location = centre + direction * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam

    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 100
    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print('thumb', kind, out_path)


def main():
    args = _cli.script_args()
    size = int(_cli.option(args, '--size', '512'))
    types = _cli.option(args, '--types')
    samples = int(_cli.option(args, '--samples', '64'))
    crop128 = _cli.flag(args, '--crop128')
    warm = _cli.flag(args, '--warm')
    tactile = _cli.flag(args, '--tactile')
    if not args:
        _cli.die('usage: render_thumbs.py -- <out_dir> [--types a,b] [--size 512] [--warm] [--tactile]')
    out_dir = os.path.abspath(args[0])
    root = paths.repo_root(os.path.dirname(os.path.abspath(__file__)))
    parts_dir = os.path.join(root, 'assets', 'build', 'parts')
    kinds = types.split(',') if types else sorted(k for k in os.listdir(parts_dir) if k not in SKIP)
    os.makedirs(out_dir, exist_ok=True)
    for kind in kinds:
        name = kind + ('.thumb_128.webp' if crop128 else '.thumb.webp')
        render_one(root, kind, os.path.join(out_dir, name), 128 if crop128 else size, 0.88 if crop128 else 0.80,
                   warm, tactile, samples)


if __name__ == '__main__':
    main()
