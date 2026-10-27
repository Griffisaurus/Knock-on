"""THE TINKER LAB look-dev (M3, stream E3b): imports the *exported* tinker.glb, re-binds master materials by id
(as the engine does) with the tactile look-dev surfaces, and renders it with the key-art rig and machine
(render_tinker_lab.py), so the shipped set can be held against art/style-samples/tinker_lab_key.png.

Usage: blender -b --factory-startup -P tools/blender/props/render_tinker.py -- <out.png> [--view hero|wide|lobby|room]
       [--res 1920x1080] [--samples N] [--no-machine] [--both] [--value-check]
--both        renders the hero view (with the key-art machine) and the Room spawn view, stacked into <out.png>
--value-check (room view) reports the density-zoning bake check of environments.md §0.10: mean luminance and
              saturation inside the build zone vs outside it, from the spawn camera
The env is drawn shifted by -KEY_OFFSET so the key-art frame (bench centre = origin) is the world frame.
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
from mathutils import Vector  # noqa: E402

import _tactile as tac  # noqa: E402
import render_tinker_lab as rtl  # noqa: E402
from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.masters import master_table  # noqa: E402

KEY_OFFSET = Vector((-0.05, 6.45, 0.0))
ENV_LOOKS = {'kn_env_floorboards': 'wood', 'kn_env_bench_oak': 'wood', 'kn_env_plaster_warm': 'paper',
             'kn_env_cork': 'paper', 'kn_env_pegboard': 'paper', 'kn_env_chalkboard': 'paper',
             'kn_env_blueprint': 'paper', 'kn_env_wainscot': 'enamel', 'kn_env_enamel_green': 'enamel',
             'kn_env_terracotta': 'ceramic', 'kn_env_book_red': 'paper', 'kn_env_book_blue': 'paper',
             'kn_env_book_mustard': 'paper', 'kn_env_book_green': 'paper', 'kn_env_book_plum': 'paper',
             'kn_env_book_navy': 'paper'}


def stack(paths_in, out_png):
    import numpy as np
    arrs, w = [], None
    for p in paths_in:
        im = bpy.data.images.load(p)
        im.colorspace_settings.name = 'Non-Color'   # raw bytes in, raw bytes out: no sRGB round trip (banding)
        w = im.size[0]
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        arrs.append(a.reshape(im.size[1], im.size[0], 4))
    full = np.concatenate(list(reversed(arrs)), axis=0)
    out = bpy.data.images.new('stack', w, full.shape[0], alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    out.pixels.foreach_set(full.ravel())
    out.filepath_raw = out_png
    out.file_format = 'PNG'
    out.save()


def import_env(root):
    glb = os.path.join(root, 'assets', 'build', 'env', 'tinker', 'tinker.glb')
    bpy.ops.import_scene.gltf(filepath=glb)
    keep = {'LOD0', 'BACKDROP', 'REF__scale__desk'}
    for ob in list(bpy.data.objects):
        top = ob
        while top.parent is not None:
            top = top.parent
        if top.name.split('.')[0] not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    for ob in bpy.data.objects:
        if ob.parent is None:
            ob.location -= KEY_OFFSET
    mat = next(o for o in bpy.data.objects if o.name.startswith('env_tinker__cutting_mat'))
    mat.name = 'cutting_mat'
    bench = next(o for o in bpy.data.objects if o.name.startswith('env_tinker__bench') and 'legs' not in o.name)
    bench.name = 'bench_top'
    bpy.context.view_layer.update()
    for ob in bpy.data.objects:  # the renderer's no-shadow flag
        if '__noshadow' in ob.name and ob.type == 'MESH':
            ob.visible_shadow = False
        if '__shadowonly' in ob.name and ob.type == 'MESH':
            ob.visible_camera = ob.visible_glossy = False  # still blocks sky light, like a real roof
            ob.visible_transmission = ob.visible_volume_scatter = False
    return [o for o in bpy.data.objects if o.type == 'MESH']


def materials(env_meshes, root):
    imported = [m for m in bpy.data.materials if not m.library]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    for m in imported:
        key = m.name.split('.')[0]
        if key in masters:
            m.user_remap(masters[key])
    tac.apply(env_meshes, root)
    table, cache = master_table(), {}
    for ob in env_meshes:
        for slot in ob.material_slots:
            m = slot.material
            key = m.name.split('.')[0] if m else ''
            if key in ENV_LOOKS:
                axis = tac._longest_axis(ob) if ENV_LOOKS[key] == 'wood' else 'X'
                ck = (key, axis)
                if ck not in cache:
                    cache[ck] = tac.build(key, ENV_LOOKS[key], table[key], axis)
                slot.link = 'OBJECT'
                slot.material = cache[ck]
    # the window sky card reads as sunlit sky in Cycles (key art strength 5.5); the engine exposes it itself
    sky = masters.get('kn_env_backdrop_warm')
    if sky:
        lit = sky.copy()
        lit.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 5.0
        for ob in env_meshes:
            for slot in ob.material_slots:
                if slot.material == sky:
                    slot.link = 'OBJECT'
                    slot.material = lit
    return masters


def value_check(png, cam, zone_set):
    """environments.md §0.10 bake check from the spawn camera: luminance (EV) and saturation of the build zone
    vs everything else in frame."""
    import numpy as np
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    im = bpy.data.images.load(png)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    rgb = a.reshape(h, w, 4)[:, :, :3]
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lum = 0.2126 * lin[:, :, 0] + 0.7152 * lin[:, :, 1] + 0.0722 * lin[:, :, 2]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = mx - mn  # display chroma (HSV saturation over-rates dark pixels)
    (x0, y0), (x1, y1) = zone_set
    poly = []
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        v = world_to_camera_view(sc, cam, Vector((x, y, 0.0)) - KEY_OFFSET)
        poly.append((v.x * w, v.y * h))
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.ones((h, w), dtype=bool)
    for i in range(4):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % 4]
        inside &= ((bx - ax) * (yy + 0.5 - ay) - (by - ay) * (xx + 0.5 - ax)) >= 0
    # "outside" = the set in frame: rows below the back wall's top edge (the open sky / yard is not the set)
    top = world_to_camera_view(sc, cam, Vector((0.0, 8.55, 3.2)) - KEY_OFFSET).y * h
    in_set = yy + 0.5 < top
    outside = (~inside) & in_set
    li, lo = float(lum[inside].mean()), float(lum[outside].mean())
    si, so = float(sat[inside].mean()), float(sat[outside].mean())
    ev = math.log2(li / lo)
    res = {'zoneLum': round(li, 4), 'outsideLum': round(lo, 4), 'evDelta': round(ev, 2),
           'zoneSat': round(si, 3), 'outsideSat': round(so, 3), 'satDrop': round(1 - so / si, 3) if si else 0.0,
           'zonePixels': int(inside.sum()), 'pass_ev': 0.7 <= ev <= 1.3, 'pass_sat': si > 0 and (1 - so / si) >= 0.15}
    print('VALUE CHECK', json.dumps(res))
    return res


def main():
    args = _cli.script_args()
    if _cli.flag(args, '--both'):
        out_png = os.path.abspath(args[0])
        rest = args[1:]
        parts = []
        for view, extra in (('hero', []), ('room', ['--no-machine', '--value-check'])):
            part = out_png[:-4] + '_' + view + '.png'
            subprocess.run([bpy.app.binary_path, '-b', '--factory-startup', '-P', os.path.abspath(__file__), '--',
                            part, '--view', view] + extra + rest, check=True)
            parts.append(part)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        stack(parts, out_png)
        print('rendered', out_png)
        return
    view = _cli.option(args, '--view', 'hero')
    res = _cli.option(args, '--res', '1920x1080')
    samples = int(_cli.option(args, '--samples', '192'))
    no_machine = _cli.flag(args, '--no-machine')
    do_value = _cli.flag(args, '--value-check')
    if not args:
        _cli.die('usage: render_tinker.py -- <out.png>')
    out_png = os.path.abspath(args[0])
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    env_meshes = import_env(root)
    materials(env_meshes, root)
    sc = bpy.context.scene
    sc.frame_set(1)
    parts = []
    if not no_machine:
        P = rtl.build_machine(root)
        parts = list(P.values())
        part_objs = [o for p in parts for o in rtl.descendants(p)]
        tac.apply(part_objs, root)
        import render_lookdev as rl
        rl.bind_decal_atlas(root)
        rtl.fuse_spark(P['bang'])
        rtl.balloon_string(P['helio'], (1.1, 0.06, rtl.MAT_Z + 0.002))
    with open(os.path.join(root, 'assets', 'build', 'env', 'tinker', 'tinker.env.json'), encoding='utf-8') as f:
        env = json.load(f)
    m = env['presets']['desk']['mochi']
    o = env['presets']['desk']['origin']
    pos_set = Vector((m['pos'][0] + o[0], -(m['pos'][2] + o[2]), m['pos'][1] + o[1]))
    cat = rtl.import_mochi(root, pos_set - KEY_OFFSET - Vector((0, 0, 0.1)), m['yawDeg'], pose='sleep')
    if cat:
        sc.frame_set(1)
        rtl.settle(cat, [bpy.data.objects['bench_top']])
        tac.apply([ob for ob in bpy.data.objects if ob.type == 'MESH' and ob.find_armature() is cat], root)
    rtl.light_and_world(view != 'room')
    if view == 'room':
        cd = bpy.data.cameras.new('Camera')
        cd.lens = 24
        cd.clip_end = 200
        cam = bpy.data.objects.new('Camera', cd)
        sc.collection.objects.link(cam)
        p = env['presets']['room']
        loc = Vector((p['camera'][0], -p['camera'][2], p['camera'][1])) - KEY_OFFSET
        tgt = Vector((p['target'][0], -p['target'][2], p['target'][1])) - KEY_OFFSET
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
    else:
        rtl.camera(view)
    import render_lookdev as rl
    rl.use_cycles(sc, samples)
    sc.cycles.max_bounces = 8
    sc.cycles.volume_bounces = 1
    sc.cycles.volume_step_rate = 4.0
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - High Contrast'
    except TypeError:
        pass
    sc.view_settings.exposure = 0.05 if view != 'room' else 0.6
    if view != 'room':  # the key-art grade + vignette; the Room overview stays ungraded for the value check
        rtl.post()
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)
    if do_value and view == 'room':
        res_v = value_check(out_png, sc.camera, ((-4.0, -5.0), (4.0, 3.0)))
        with open(out_png[:-4] + '.value.json', 'w', encoding='utf-8') as f:
            json.dump(res_v, f, indent=1)


if __name__ == '__main__':
    main()
