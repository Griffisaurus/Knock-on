"""Contact sheet of the shared props kit (environments.md §7): LOD0 of one variant per prop from the *exported*
kn_props.glb, each scaled into one cell and labelled with its name, true size and tris, on the warm light cyc
with the tactile look-dev surfaces (_tactile.py). Cycles.

Usage: blender -b --factory-startup -P tools/blender/props/render_props.py -- <out.png> [--cols N] [--res WxH]
       [--samples N]
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import _tactile as tac  # noqa: E402
import render_lookdev as rl  # noqa: E402
from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402

CELL = 0.4
FIT = 0.27
SHOW = {'beaker': 4, 'flask': 2, 'book': 7, 'mug': 6, 'cardboard_box': 3, 'poster': 1, 'magnet': 2, 'crate': 1,
        'jar': 0, 'paint_tin': 1, 'plant_succulent': 0, 'lamp_pendant': 0, 'notebook': 1, 'tea_towel': 1}
ORDER = ('book', 'notebook', 'paper_sheet', 'poster', 'corkboard', 'cardboard_box', 'cereal_box', 'crayon_box',
         'pencil_cup', 'drafting_set', 'tape_dispenser', 'magnet', 'lunchbox', 'mug', 'beaker', 'flask',
         'test_tube_rack', 'jar', 'rock_tray', 'microscope', 'globe', 'orrery', 'parts_drawers', 'paint_tin', 'spool',
         'plant_succulent', 'plant_fern', 'plant_trailing', 'plant_tall', 'pegboard', 'hand_tool', 'toolbox', 'clamp',
         'vice', 'crate', 'clock_wall', 'stool', 'chair_school', 'shelf_unit', 'wall_shelf', 'lamp_pendant', 'rug',
         'coat_hook', 'utensil_rail', 'tea_towel')


def label(text, loc, size, mat):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('lbl_' + text[:20], cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '2700x1800')
    cols = int(_cli.option(args, '--cols', '9'))
    samples = int(_cli.option(args, '--samples', '64'))
    if not args:
        _cli.die('usage: render_props.py -- <out.png>')
    out_png = os.path.abspath(args[0])
    root = paths.repo_root(HERE)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(os.path.join(root, 'assets', 'build', 'env', 'props', 'kn_props.json'), encoding='utf-8') as f:
        index = json.load(f)['props']
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'assets', 'build', 'env', 'props', 'kn_props.glb'))
    names = [n for n in ORDER if n in index] + sorted(n for n in index if n not in ORDER)
    keep = set()
    picks = {}
    for n in names:
        v = SHOW.get(n, 0)
        node = bpy.data.objects.get('kn_prop_%s__v%d__LOD0' % (n, v))
        if node is None:
            continue
        picks[n] = (v, node)
        stack = [node]
        while stack:
            o = stack.pop()
            keep.add(o)
            stack.extend(o.children)
    for ob in list(bpy.data.objects):
        if ob not in keep:
            ob.parent = None
    for ob in list(bpy.data.objects):
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    rows = math.ceil(len(picks) / cols)
    lbl = bpy.data.materials.new('label')
    lbl.use_nodes = True
    lbl.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    meshes = []
    for i, n in enumerate(names):
        if n not in picks:
            continue
        v, node = picks[n]
        r, c = divmod(i, cols)
        cx = (c - (cols - 1) / 2) * CELL
        cy = ((rows - 1) / 2 - r) * CELL * 1.5
        bpy.context.view_layer.update()
        ms = [o for o in node.children_recursive if o.type == 'MESH']
        meshes += ms
        pts = [o.matrix_world @ Vector(b) for o in ms for b in o.bound_box]
        lo = Vector([min(p[k] for p in pts) for k in range(3)])
        hi = Vector([max(p[k] for p in pts) for k in range(3)])
        size = hi - lo
        s = min(FIT / max(size.x, size.y, size.z * 1.2, 1e-3), 4.0)
        ctr = (lo + hi) / 2
        node.matrix_world = (Matrix.Translation((cx, cy, 0.0)) @ Matrix.Scale(s, 4) @
                             Matrix.Translation((-ctr.x, -ctr.y, -lo.z))) @ node.matrix_world
        e = index[n]
        tris = e['v'][v]['lodTris'][0]
        label('%s  %s' % (n.upper().replace('_', ' '), e['class']), (cx, cy - FIT * 0.62, 0.0005), 0.026, lbl)
        label('%.2f x %.2f x %.2f m · %d tris' % (size.x, size.y, size.z, tris), (cx, cy - FIT * 0.62 - 0.032, 0.0005),
              0.019, lbl)
    imported = [m for m in bpy.data.materials if not m.library and m.name != 'label']
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    tac.apply(meshes, root)
    sc = bpy.context.scene
    rl.use_cycles(sc, samples)
    w, h = (int(x) for x in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.2
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.5, 0.45, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    cyc = bpy.data.materials.new('cyc_warm')
    cyc.use_nodes = True
    cyc.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#CDBFA8')
    cyc.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    span_x, span_y = cols * CELL, rows * CELL * 1.5
    rl.cyc(cyc, width=span_x * 3, front=span_y * 2, back=span_y * 0.6 + 0.3, radius=0.8, height=3.0)
    target = Vector((0.0, -0.05, 0.0))
    rl.area('Key', (2.0, 2.2, 2.6), target, 900, 2.5, color=(1.0, 0.85, 0.68))
    rl.area('Fill', (-2.4, -2.0, 1.6), target, 260, 3.0, color=(0.8, 0.88, 1.0))
    rl.area('Top', (0, 0.2, 3.2), target, 300, 4.0)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 50
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    dist = max(span_x * 1.12 / 0.72, span_y / 0.45 * 0.9)
    el = math.radians(55)
    cam.location = (0.0, -dist * math.cos(el), dist * math.sin(el))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png, '(%d props)' % len(picks))


main()
