"""Contact sheet of exported parts: LOD0 of every glb, scaled to one cell each, labelled with its type and true
size, on the light cyc (Cycles). Materials are re-bound by master id from materials.blend, like the engine.

Usage: blender -b --factory-startup -P tools/blender/render_contact.py -- <out.png> [type ...] [--cols N]
       [--res 2400x1500] [--samples N]
Default: every part under assets/build/parts, sorted by family then type.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402

import render_lookdev as rl  # noqa: E402  (cyc, area, use_cycles)

CELL = 0.40
FIT = 0.25
FAMILY_ORDER = ('rollers', 'frame', 'drive', 'air', 'power', 'boom', 'contraptions', 'fun')


def discover(root):
    out = []
    base = os.path.join(root, 'assets', 'build', 'parts')
    for t in sorted(os.listdir(base)):
        art = os.path.join(base, t, t + '.art.json')
        if os.path.exists(art) and os.path.exists(os.path.join(base, t, t + '.glb')):
            with open(art, encoding='utf-8') as f:
                a = json.load(f)
            out.append((t, a))
    out.sort(key=lambda ta: (FAMILY_ORDER.index(ta[1]['family']) if ta[1]['family'] in FAMILY_ORDER else 99, ta[0]))
    return out


def import_lod0(glb):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    lod0 = next(ob for ob in new if ob.name.split('.')[0] == 'LOD0')
    keep = set()

    def walk(o):
        keep.add(o)
        for c in o.children:
            walk(c)
    walk(lod0)
    for ob in new:
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    return lod0, [ob for ob in keep if ob.type == 'MESH']


def bounds(meshes):
    bpy.context.view_layer.update()
    pts = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def label(text, loc, size, mat):
    cu = bpy.data.curves.new('lbl_' + text, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('lbl_' + text, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)
    return ob


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '2400x1500')
    cols = int(_cli.option(args, '--cols', '6'))
    samples = int(_cli.option(args, '--samples', '64'))
    if not args:
        _cli.die('usage: render_contact.py -- <out.png> [type ...]')
    out_png = os.path.abspath(args[0])
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = discover(root)
    if args[1:]:
        parts = [p for p in parts if p[0] in args[1:]]
    rows = math.ceil(len(parts) / cols)
    lbl_mat = bpy.data.materials.new('label')
    lbl_mat.use_nodes = True
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    for i, (t, art) in enumerate(parts):
        r, c = divmod(i, cols)
        cx = (c - (cols - 1) / 2) * CELL
        cy = ((rows - 1) / 2 - r) * CELL * 1.3
        lod0, meshes = import_lod0(os.path.join(root, 'assets', 'build', 'parts', t, t + '.glb'))
        lo, hi = bounds(meshes)
        size = hi - lo
        s = min(FIT / max(size.x, size.y, size.z, 1e-3), 3.5)
        centre = (lo + hi) / 2
        lod0.matrix_world = (Matrix.Translation(Vector((cx, cy, 0.0))) @ Matrix.Scale(s, 4) @
                             Matrix.Translation(Vector((-centre.x, -centre.y, -lo.z)))) @ lod0.matrix_world
        ext = [art['bounds']['max'][k] - art['bounds']['min'][k] for k in range(3)]
        label('%s  %.2f x %.2f x %.2f m · %d tris' % (t.upper(), ext[0], ext[1], ext[2], art['lods'][0]['tris']),
              (cx, cy - FIT * 0.62, 0.0005), 0.021, lbl_mat)
    imported = [m for m in bpy.data.materials if not m.library and m.name != 'label']
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    rl.bind_decal_atlas(root)
    sc = bpy.context.scene
    rl.use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.9
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.3
    cyc_mat = bpy.data.materials.new('cyc_light')
    cyc_mat.use_nodes = True
    p = cyc_mat.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = library.hexcol('#BDB8AF')
    p.inputs['Roughness'].default_value = 0.92
    span_x, span_y = cols * CELL, rows * CELL * 1.3
    rl.cyc(cyc_mat, width=span_x * 3, front=span_y * 2, back=span_y * 0.6 + 0.3, radius=0.8, height=3.0)
    target = Vector((0.0, -0.09, 0.0))
    rl.area('Key', (-1.6, -1.8, 2.2), target, 520, 2.0)
    rl.area('Fill', (2.0, -1.2, 1.0), target, 140, 2.0)
    rl.area('Rim', (0.3, 2.0, 1.6), target, 380, 1.8, color=(0.86, 0.94, 1.0))
    rl.area('Top', (0, 0.2, 3.0), target, 220, 3.0)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 50
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    # 36 mm sensor at 50 mm: the frame is 0.72 x dist wide; leave a margin round the grid
    dist = max(span_x * 1.04 / 0.72, span_y * 1.0 / 0.45 * 0.85)
    el = math.radians(58)
    cam.location = (0.0, -dist * math.cos(el), dist * math.sin(el) + 0.02)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png, '(%d parts)' % len(parts))


main()
