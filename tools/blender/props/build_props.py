"""Build the shared props kit (environments.md §7, D78): one source .blend per prop and the kit glb + index.

Usage: blender -b --factory-startup -P tools/blender/props/build_props.py -- [name ...] [--no-blend]
   or: node tools/assets.mjs --props

Outputs
  assets/src/env/_shared/props/kn_prop_<name>.blend   ENV_RENDER (LOD0) / LOD1..LOD3 / COL, one object per variant
                                                      (variants side by side along +X); scene props kn_prop_class,
                                                      kn_prop_used_in, kn_prop_variants
  assets/build/env/props/kn_props.glb                 node kn_prop_<name> > v<k> > LOD0..LOD3 (prop space, Y-up)
  assets/build/env/props/kn_props.json                per prop: class, used in, budget, variants, LOD tris per
                                                      variant, bounds and colliders (prop space, engine axes)
"""
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from kn_tools import geom, library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402
from props.core import build_prop, load_all, place  # noqa: E402
from props.envkit import clean  # noqa: E402

SPACING = 0.15


def eng(v):
    return [round(float(v[0]), 4) + 0.0, round(float(v[2]), 4) + 0.0, round(-float(v[1]), 4) + 0.0]


def kits_for(name, variant):
    """LOD0..3 kits for one variant plus the LOD0 collider list (prop space)."""
    out, cols = [], []
    for lod in range(4):
        k = Kit()
        build_prop(name, k, None, lod, variant, cols if lod == 0 else None)
        clean(k.bm)
        out.append(k)
    return out, cols


def bounds_of(kit):
    vs = [v.co for v in kit.bm.verts]
    lo = Vector([min(c[i] for c in vs) for i in range(3)])
    hi = Vector([max(c[i] for c in vs) for i in range(3)])
    return lo, hi


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def collections(sc, names):
    out = {}
    for n in names:
        c = bpy.data.collections.new(n)
        sc.collection.children.link(c)
        out[n] = c
    return out


def materials_for(root, kits):
    names = sorted({m for k in kits for m in k.mats})
    bad = [m for m in names if not is_master_material(m)]
    if bad:
        _cli.die('not master materials: %s' % ', '.join(bad))
    return library.link_materials(paths.materials_lib(root), names)


def save_prop_blend(root, name, spec):
    sc = new_scene()
    cols = collections(sc, ('ENV_RENDER', 'LOD1', 'LOD2', 'LOD3', 'COL'))
    sc['kn_prop_class'] = spec['cls']
    sc['kn_prop_used_in'] = spec['used']
    sc['kn_prop_variants'] = spec['variants']
    sc['kn_notes'] = spec['desc']
    x = 0.0
    all_kits = []
    per = []
    for v in range(spec['variants']):
        kits, colls = kits_for(name, v)
        lo, hi = bounds_of(kits[0])
        per.append((kits, colls, lo, hi))
        all_kits += kits
    mats = materials_for(root, all_kits)
    for v, (kits, colls, lo, hi) in enumerate(per):
        dx = x - lo.x
        for lod, k in enumerate(kits):
            cname = 'ENV_RENDER' if lod == 0 else 'LOD%d' % lod
            ob = geom.object_from_bmesh('kn_prop_%s__v%d%s' % (name, v, '' if lod == 0 else '__L%d' % lod), k.bm,
                                        [mats[m] for m in k.mats], cols[cname])
            geom.set_sharp_by_angle(ob.data, 40)
            ob.location.x = dx
        for i, c in enumerate(colls):
            if c['kind'] == 'box':
                me = bpy.data.meshes.new('COL__box__v%d_%d' % (v, i))
                bm = bmesh.new()
                bmesh.ops.create_cube(bm, size=1.0)
                bm.to_mesh(me)
                bm.free()
                ob = bpy.data.objects.new(me.name, me)
                ob.location = (c['lo'] + c['hi']) / 2 + Vector((dx, 0, 0))
                ob.scale = c['hi'] - c['lo']
            else:
                ob = bpy.data.objects.new('COL__sphere__v%d_%d' % (v, i), None)
                ob.empty_display_type = 'SPHERE'
                ob.empty_display_size = c['r']
                ob.location = c['c'] + Vector((dx, 0, 0))
            ob.display_type = 'WIRE' if ob.type == 'MESH' else ob.display_type
            ob['phys'] = c['phys']
            cols['COL'].objects.link(ob)
        x += (hi.x - lo.x) + SPACING
    path = os.path.join(root, 'assets', 'src', 'env', '_shared', 'props', 'kn_prop_%s.blend' % name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, relative_remap=True)
    return path


def build_kit_glb(root, names, specs):
    sc = new_scene()
    index = {}
    created = []
    all_kits = []
    plan = []
    for name in names:
        spec = specs[name]
        for v in range(spec['variants']):
            kits, colls = kits_for(name, v)
            plan.append((name, v, kits, colls))
            all_kits += kits
    mats = materials_for(root, all_kits)
    roots = {}
    for name, v, kits, colls in plan:
        spec = specs[name]
        if name not in roots:
            e = bpy.data.objects.new('kn_prop_%s' % name, None)
            sc.collection.objects.link(e)
            roots[name] = e
            created.append(e)
            index[name] = {'class': spec['cls'], 'usedIn': spec['used'], 'budget': spec['budget'],
                           'variants': spec['variants'], 'lod3': spec['lod3'], 'desc': spec['desc'], 'v': []}
        ve = bpy.data.objects.new('kn_prop_%s__v%d' % (name, v), None)
        sc.collection.objects.link(ve)
        ve.parent = roots[name]
        created.append(ve)
        lo, hi = bounds_of(kits[0])
        tris = []
        for lod, k in enumerate(kits):
            le = bpy.data.objects.new('kn_prop_%s__v%d__LOD%d' % (name, v, lod), None)
            sc.collection.objects.link(le)
            le.parent = ve
            created.append(le)
            tris.append(k.tris())
            ob = geom.object_from_bmesh('kn_prop_%s__v%d__L%d' % (name, v, lod), k.bm, [mats[m] for m in k.mats],
                                        sc.collection)
            geom.set_sharp_by_angle(ob.data, 40)
            ob.parent = le
        cl = []
        for c in colls:
            if c['kind'] == 'box':
                a, b = eng(c['lo']), eng(c['hi'])
                mn = [min(a[i], b[i]) for i in range(3)]
                mx = [max(a[i], b[i]) for i in range(3)]
                cl.append({'kind': 'box', 'center': [round((mn[i] + mx[i]) / 2, 4) for i in range(3)],
                           'half': [round((mx[i] - mn[i]) / 2, 4) for i in range(3)], 'phys': c['phys']})
            else:
                cl.append({'kind': 'sphere', 'center': eng(c['c']), 'radius': round(c['r'], 4), 'phys': c['phys']})
        ea, eb = eng(lo), eng(hi)
        index[name]['v'].append({'lodTris': tris, 'bounds': {'min': [min(ea[i], eb[i]) for i in range(3)],
                                                             'max': [max(ea[i], eb[i]) for i in range(3)]},
                                 'colliders': cl})
    out_dir = os.path.join(root, 'assets', 'build', 'env', 'props')
    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, 'kn_props.glb')
    for ob in sc.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False, export_materials='EXPORT', export_image_format='NONE',
                              export_texcoords=False, export_normals=True, export_tangents=False,
                              export_draco_mesh_compression_enable=False, export_skins=False, export_morph=False)
    data = {'kit': 'kn_prop', 'glb': 'env/props/kn_props.glb', 'scaleLab': 1, 'scaleKitchen': 5,
            'note': 'prop space: real size, engine axes (Y up, front = +Z), origin = footprint centre on the floor '
                    '(wall props: back on z = 0; hung props: the hanging point)', 'props': index}
    with open(os.path.join(out_dir, 'kn_props.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    return glb, index


def main():
    args = _cli.script_args()
    no_blend = _cli.flag(args, '--no-blend')
    root = paths.repo_root(HERE)
    library.ensure_libs(root)
    specs = load_all()
    names = sorted(args) if args else sorted(specs)
    unknown = [n for n in names if n not in specs]
    if unknown:
        _cli.die('unknown props: %s' % ', '.join(unknown))
    if not no_blend:
        for n in names:
            save_prop_blend(root, n, specs[n])
    glb, index = build_kit_glb(root, names, specs)
    over = []
    print('  %-18s %-4s %-7s %4s  %s' % ('prop', 'cls', 'used', 'vars', 'LOD0 / 1 / 2 / 3 tris (variant 0) · budget'))
    for n in names:
        e = index[n]
        t = e['v'][0]['lodTris']
        mx = max(v['lodTris'][0] for v in e['v'])
        flag = '' if mx <= e['budget'] * 1.1 else '  OVER'
        if flag:
            over.append(n)
        print('  %-18s %-4s %-7s %4d  %s · max LOD0 %d / %d%s' % (n, e['class'], e['usedIn'], e['variants'],
                                                                 ' / '.join(str(x) for x in t), mx, e['budget'], flag))
    print('props: %d (%d variants), glb %s (%d bytes)' % (len(names), sum(index[n]['variants'] for n in names), glb,
                                                         os.path.getsize(glb)))
    if over:
        print('over budget (> 110 %):', ', '.join(over))
    _ = place


main()
