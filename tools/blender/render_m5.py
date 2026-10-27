"""M5 (stream E5a) render wrapper: runs render_thumbs.py or render_contact.py unchanged, but also draws each part's
container contents from `.art.json cavities[]` (the fill pass's job in the engine), so a GOO VAT icon reads as "a fat
clear drum of bright green goo" instead of an empty vat. The contents are the closed cavity mesh cut at a cosmetic
level (the cavity's `fill`, else `--level`, default 0.8 of its volume via the fill LUT) in the cavity's fallback master
(kn_tools.cavity / _m4.cavity: goo -> kn_slime, water -> kn_poly_beam, sand -> kn_paper_tan, marbles -> kn_glass).

Usage: blender -b --factory-startup -P tools/blender/render_m5.py -- thumbs <render_thumbs.py args>
       blender -b --factory-startup -P tools/blender/render_m5.py -- contact <render_contact.py args>
       Optional before the mode: --level 0.8
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402

FALLBACK = {'goo': 'kn_slime', 'water': 'kn_poly_beam', 'sand': 'kn_paper_tan', 'marble': 'kn_glass',
            'fill': 'kn_poly_amber'}


def contents(glb, level):
    """Mesh objects for the cavities of the part whose glb is `glb`, cut at the cosmetic level (Blender space)."""
    art_path = glb[:-4] + '.art.json'
    if not os.path.exists(art_path):
        return []
    with open(art_path, encoding='utf-8') as f:
        art = json.load(f)
    out = []
    root = paths.repo_root(os.path.dirname(os.path.abspath(__file__)))
    for c in art.get('cavities', []):
        mesh = c.get('mesh')
        lut = c.get('lut')
        if not mesh or not lut:
            continue
        frac = c.get('fill', level)
        h = lut[min(len(lut) - 1, max(0, int(round(frac * (len(lut) - 1)))))]
        v = mesh['vertices']
        bm = bmesh.new()
        verts = [bm.verts.new((v[i], -v[i + 2], v[i + 1])) for i in range(0, len(v), 3)]  # engine -> Blender
        ix = mesh['indices']
        for t in range(0, len(ix), 3):
            try:
                bm.faces.new((verts[ix[t]], verts[ix[t + 1]], verts[ix[t + 2]]))
            except ValueError:
                pass
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=(0, 0, h), plane_no=(0, 0, 1),
                                     clear_outer=True)
        cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut:
            bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('contents_' + c['name'])
        bm.to_mesh(me)
        bm.free()
        master = FALLBACK.get(c.get('matter'), 'kn_poly_amber')
        mats = library.link_materials(paths.materials_lib(root), [master])
        me.materials.append(mats[master])
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new('contents_' + c['name'], me)
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    level = 0.8
    if argv and argv[0] == '--level':
        level = float(argv[1])
        argv = argv[2:]
    mode, rest = argv[0], argv[1:]
    sys.argv = [sys.argv[0], '--'] + rest
    if mode == 'thumbs':
        import render_thumbs as rt
        orig = rt.import_lod0

        def import_lod0(glb):
            meshes = orig(glb)
            return meshes + contents(glb, level)
        rt.import_lod0 = import_lod0
        rt.main()
    elif mode == 'contact':
        import render_contact as rc
        orig = rc.import_lod0

        def import_lod0(glb):
            lod0, meshes = orig(glb)
            extra = contents(glb, level)
            for ob in extra:
                ob.parent = lod0
                ob.matrix_parent_inverse = lod0.matrix_world.inverted()
            return lod0, meshes + extra
        rc.import_lod0 = import_lod0
        rc.main()
    else:
        raise SystemExit('render_m5.py: mode must be thumbs or contact')


if __name__ == '__main__':
    main()
