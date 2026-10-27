"""Before / after sheet for the texture pass (M3 stream E3c): each exported part's LOD0 twice, on the left with
the master materials only (what M1 shipped) and on the right with its texture set bound the way the engine
binds it (TEXCOORD_0; albedo sRGB, ORM linear R occlusion / G roughness / B metallic, OpenGL +Y tangent
normal under the master's own preview detail bump). Same light cyc and lights as render_contact.py.

Usage: blender -b --factory-startup -P tools/blender/render_textured.py -- <out.png> [type ...] [--cols N]
       [--res 2800x2600] [--samples N] [--after-only] [--lod N]
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

import render_lookdev as rl  # noqa: E402

FIT = 0.22
FAMILY_ORDER = ('rollers', 'frame', 'drive', 'air', 'power', 'boom', 'contraptions', 'fun')
M1 = ('thud', 'boing', 'helio', 'brik', 'plank', 'slope', 'ledge', 'fulcrum', 'anchor', 'sheave', 'treadway',
      'cog_s', 'cog_m', 'cog_l', 'motor', 'gale', 'mains', 'stomp_pad', 'the_button', 'wick', 'bangstick', 'snipper',
      'topple_tile')


def import_lod(glb, lod):
    before = set(bpy.data.objects)
    mats_before = set(bpy.data.materials)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    node = next(ob for ob in new if ob.name.split('.')[0] == 'LOD%d' % lod)
    keep = set()

    def walk(o):
        keep.add(o)
        for c in o.children:
            walk(c)
    walk(node)
    for ob in new:
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    return node, [ob for ob in keep if ob.type == 'MESH'], [m for m in bpy.data.materials if m not in mats_before]


def bounds(meshes):
    bpy.context.view_layer.update()
    pts = [ob.matrix_world @ Vector(c) for ob in meshes for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def textured_copy(master, imgs, cache):
    """Local copy of a master with the set plugged in (engine binding)."""
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
    # occlusion: Cycles traces its own; darken the albedo by half the baked cavity, as the engine's indirect does
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
    if bump is not None:  # keep the master's preview detail (the engine's detail layer) over the set
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


def label(text, loc, size, mat):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('lbl', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)
    return ob


def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '3200x3000')
    cols = int(_cli.option(args, '--cols', '4'))
    samples = int(_cli.option(args, '--samples', '64'))
    lod = int(_cli.option(args, '--lod', '0'))
    after_only = _cli.flag(args, '--after-only')
    if not args:
        _cli.die('usage: render_textured.py -- <out.png> [type ...]')
    out_png = os.path.abspath(args[0])
    types = args[1:] or list(M1)
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = []
    for t in types:
        p = os.path.join(root, 'assets', 'build', 'parts', t, t + '.art.json')
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                parts.append((t, json.load(f)))
    parts.sort(key=lambda ta: (FAMILY_ORDER.index(ta[1]['family']) if ta[1]['family'] in FAMILY_ORDER else 99,
                               types.index(ta[0])))
    halves = (('after',) if after_only else ('before', 'after'))
    cell_w = 0.30 * len(halves) + 0.08
    cell_h = 0.40
    rows = math.ceil(len(parts) / cols)
    lbl_mat = bpy.data.materials.new('label')
    lbl_mat.use_nodes = True
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    lbl_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    groups = []  # (half, materials, set)
    for i, (t, art) in enumerate(parts):
        r, c = divmod(i, cols)
        cx = (c - (cols - 1) / 2) * cell_w
        cy = ((rows - 1) / 2 - r) * cell_h
        glb = os.path.join(root, 'assets', 'build', 'parts', t, t + '.glb')
        tset = load_set(root, t, art)
        for j, half in enumerate(halves):
            node, meshes, mats = import_lod(glb, lod)
            lo, hi = bounds(meshes)
            size = hi - lo
            s = min(FIT / max(size.x, size.y, size.z, 1e-3), 3.5)
            centre = (lo + hi) / 2
            hx = cx + (j - (len(halves) - 1) / 2) * 0.30
            node.matrix_world = (Matrix.Translation(Vector((hx, cy, 0.0))) @ Matrix.Scale(s, 4) @
                                 Matrix.Translation(Vector((-centre.x, -centre.y, -lo.z)))) @ node.matrix_world
            groups.append((half, mats, tset if half == 'after' else None, meshes))
        tag = '%s · %d² set' % (t.upper(), art['textures']['size']) if art.get('textures') else t.upper() + ' · no set'
        label(tag + ('   before | after' if len(halves) == 2 else ''), (cx, cy - FIT * 0.55, 0.0005), 0.02, lbl_mat)
    imported = [m for m in bpy.data.materials if not m.library and m.name != 'label']
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    cache = {}
    for half, mats, tset, meshes in groups:
        for ob in meshes:
            for slot in ob.material_slots:
                m = slot.material
                if m is None:
                    continue
                key = m.name.split('.')[0]
                if key not in masters:
                    continue
                if tset and key in tset[1]:
                    slot.link = 'OBJECT'
                    slot.material = textured_copy(masters[key], tset[0], cache)
                else:
                    slot.link = 'OBJECT'
                    slot.material = masters[key]
    rl.bind_decal_atlas(root)
    sc = bpy.context.scene
    rl.use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.3
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
    span_x, span_y = cols * cell_w, rows * cell_h
    rl.cyc(cyc_mat, width=span_x * 3, front=span_y * 2, back=span_y * 0.6 + 0.3, radius=0.8, height=3.0)
    target = Vector((0.0, -0.10, 0.06))
    k = max(span_x, span_y) / 2.4
    rl.area('Key', (-1.6 * k, -1.8 * k, 2.2 * k), target, 520 * k * k, 2.0 * k)
    rl.area('Fill', (2.0 * k, -1.2 * k, 1.0 * k), target, 140 * k * k, 2.0 * k)
    rl.area('Rim', (0.3 * k, 2.0 * k, 1.6 * k), target, 380 * k * k, 1.8 * k, color=(0.86, 0.94, 1.0))
    rl.area('Top', (0, 0.2 * k, 3.0 * k), target, 220 * k * k, 3.0 * k)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.type = 'ORTHO'  # every cell the same size
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    aspect = w / h
    el = math.radians(55)
    cam_d.ortho_scale = max(span_x * 1.04, (span_y * math.sin(el) + 0.30) * aspect)
    cam_d.clip_end = 100.0
    dist = 8.0
    cam.location = (0.0, -dist * math.cos(el), dist * math.sin(el) + 0.02)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png, '(%d parts)' % len(parts))


main()
