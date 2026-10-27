"""Procedurally build the THUD source file (docs/art/briefs/rollers.md, "THUD: Heavy ball").

Usage: blender -b --factory-startup -P tools/blender/make_thud.py -- [out.blend]
Default output: assets/src/rollers/thud.blend

One watertight mesh per LOD with three master slots (graphite shell, ignition band, steel finger-hole
liners). The sphere is built in the band's own frame so the band is just latitude rows: it lands exactly on
the brief's tilted great circle and stays <= 1.5 mm proud of the pure-sphere collider.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

from kn_tools import geom, library, paths, template  # noqa: E402

TYPE = 'thud'
R = 0.110                     # collider radius = shell radius
BAND_WIDTH = 0.013
BAND_PROUD = 0.0015           # brief: <= 1.5 mm proud
HOLE_RADIUS = 0.023 / 2
LIP = 0.002                   # 2 mm rounded lips
HOLE_DIRS = [(-0.16, -0.55, 0.82), (0.16, -0.55, 0.82), (0.0, -0.80, 0.60)]
BAND_FRAME = Euler((math.radians(-18), math.radians(8), 0), 'XYZ').to_matrix()
GRAPHITE, IGNITION, STEEL = 0, 1, 2
MASTERS = ['kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed']

# Per-LOD resolution. Ratios target 50 / 25 / 8 % of LOD0 (ASSET_PIPELINE §4); LOD3 drops the holes and
# keeps the band as flush material so the read (dark ball, orange stripe) survives at distance.
LODS = (
    ('RENDER', '', dict(segments=40, shell_strips=10, band='simple', hole_segs=16, hole_depth=0.035, lip_segs=2)),
    ('LOD1', '__L1', dict(segments=28, shell_strips=6, band='simple', hole_segs=12, hole_depth=0.035, lip_segs=1)),
    ('LOD2', '__L2', dict(segments=18, shell_strips=5, band='simple', hole_segs=8, hole_depth=0.012, lip_segs=0)),
    ('LOD3', '__L3', dict(segments=14, shell_strips=3, band='flush', hole_segs=0)),
)


def band_rows(mode):
    a = math.degrees(BAND_WIDTH / 2 / R)
    if mode == 'full':  # rounded shoulder: 1.0 mm step then 1.5 mm crown
        prof = [(-a, R), (-(a - 0.24), R + 0.0010), (-(a - 0.64), R + BAND_PROUD),
                (a - 0.64, R + BAND_PROUD), (a - 0.24, R + 0.0010), (a, R)]
    elif mode == 'simple':
        prof = [(-a, R), (-(a - 0.35), R + BAND_PROUD), (a - 0.35, R + BAND_PROUD), (a, R)]
    else:
        prof = [(-a, R), (a, R)]
    rows = [(lat, r, IGNITION) for lat, r in prof]
    rows[-1] = (rows[-1][0], rows[-1][1], GRAPHITE)
    return rows, a


def sphere_rows(band, strips):
    brows, a = band_rows(band)
    shell = [a + (90 - a) * k / strips for k in range(1, strips)]
    rows = [(-90.0, R, GRAPHITE)] + [(-lat, R, GRAPHITE) for lat in reversed(shell)]
    rows += brows
    rows += [(lat, R, GRAPHITE) for lat in shell] + [(90.0, R, GRAPHITE)]
    return rows


def make_cutter(segs, depth, steel):
    """Three blind bores along the brief's unit directions, from depth below the surface to just outside."""
    bm = bmesh.new()
    inner, outer = R - depth, R + 0.012
    for d in HOLE_DIRS:
        d = Vector(d).normalized()
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation(d * (inner + outer) / 2) @ rot
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=HOLE_RADIUS,
                              radius2=HOLE_RADIUS, depth=outer - inner, matrix=m)
    me = bpy.data.meshes.new('thud_cutter')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(steel)
    ob = bpy.data.objects.new('thud_cutter', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_lod(colname, suffix, p, mats):
    bm = bmesh.new()
    geom.latitude_sphere(bm, sphere_rows(p['band'], p['shell_strips']), p['segments'], frame=BAND_FRAME)
    ob = geom.object_from_bmesh(TYPE + '__ball' + suffix, bm, [mats[n] for n in MASTERS],
                                template.get_collection(colname))
    if p['hole_segs']:
        cutter = make_cutter(p['hole_segs'], p['hole_depth'], mats['kn_steel_brushed'])
        mod = ob.modifiers.new('holes', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.material_mode = 'TRANSFER'  # bore walls and floors come out steel
        mod.object = cutter
        geom.apply_modifiers(ob)
        bpy.data.objects.remove(cutter)
        bpy.data.meshes.remove(bpy.data.meshes['thud_cutter'])
        _normalise_slots(ob, mats)
        if p['lip_segs']:
            _bevel_lips(ob, p['lip_segs'])
    geom.set_sharp_by_angle(ob.data, 35)
    return ob


def _normalise_slots(ob, mats):
    """Boolean TRANSFER may append a duplicate steel slot; fold faces back onto the three canonical slots."""
    me = ob.data
    remap = {}
    for i, m in enumerate(me.materials):
        remap[i] = MASTERS.index(m.name) if m and m.name in MASTERS else GRAPHITE
    for poly in me.polygons:
        poly.material_index = remap.get(poly.material_index, GRAPHITE)
    while len(me.materials) > len(MASTERS):
        me.materials.pop()


def _bevel_lips(ob, segs):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    rim = [e for e in bm.edges if len(e.link_faces) == 2
           and {f.material_index == STEEL for f in e.link_faces} == {True, False}]
    bmesh.ops.bevel(bm, geom=rim, offset=LIP, offset_type='OFFSET', segments=segs, profile=0.5, affect='EDGES',
                    clamp_overlap=True, material=STEEL)
    bm.to_mesh(ob.data)
    bm.free()


def build(out_path):
    root_dir = paths.repo_root()
    library.ensure_libs(root_dir)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    template.new_part(
        TYPE, 'rollers', 'S', '2.2,2.2,2.2', 7.0, origin='com', tri_budget=2400,
        notes='Heavy ball. Brief: docs/art/briefs/rollers.md#thud-heavy-ball. '
              'Bone "THUD 7KG" kn_decal stamp waits for decals.blend (M1).')
    mats = template.link_masters(MASTERS, root_dir)
    for colname, suffix, p in LODS:
        build_lod(colname, suffix, p, mats)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=R)
    me = bpy.data.meshes.new('COL__sphere__0')
    bm.to_mesh(me)
    bm.free()
    template.add_col('sphere', '0', me, phys='powder', restitution=0.12, friction=0.30)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups next to sources
    bpy.ops.wm.save_as_mainfile(filepath=out_path, compress=True, relative_remap=True)
    print('saved', out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    build(os.path.abspath(args[0]) if args else paths.source_blend(paths.repo_root(), 'rollers', TYPE))
