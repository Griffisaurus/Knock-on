"""Pipeline self-test: the validator must pass THUD and fail deliberately broken copies; the port ring
snap must produce a valid port. Nothing under assets/src is modified (broken copies go to <scratch_dir>).

Usage: blender -b --factory-startup -P tools/blender/selftest.py -- <scratch_dir>
Writes <scratch_dir>/broken_scale/thud.blend so tools/assets.mjs can also check the CLI exit code.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from kn_tools import paths, ports, template, validate  # noqa: E402

args = _cli.script_args()
if not args:
    _cli.die('usage: selftest.py -- <scratch_dir>')
SCRATCH = os.path.abspath(args[0])
ROOT = paths.repo_root()
THUD = paths.source_blend(ROOT, 'rollers', 'thud')
failures = []


def check(name, cond, detail=''):
    print('  %s  %s%s' % ('ok  ' if cond else 'FAIL', name, (' -- ' + detail) if detail and not cond else ''))
    if not cond:
        failures.append(name)


def fresh_thud():
    bpy.ops.wm.open_mainfile(filepath=THUD)
    return bpy.data.objects['thud__ball']


def run_case(name, mutate, expect_rule):
    ball = fresh_thud()
    mutate(ball)
    rep = validate.validate(blend_path=THUD)
    msgs = '; '.join(str(i).strip() for i in rep.errors)
    check('%s -> %s' % (name, expect_rule), not rep.ok and rep.has(expect_rule), msgs or 'validator passed')


def set_scale(ob):
    ob.scale = (1.2, 1.2, 1.2)


def neg_scale(ob):
    ob.scale = (-1, 1, 1)


def rename_col(ob):
    bpy.data.objects['COL__sphere__0'].name = 'COL_sphere0'


def local_material(ob):
    ob.material_slots[0].link = 'OBJECT'
    ob.material_slots[0].material = bpy.data.materials.new('graphite_oneoff')


def drop_mass(ob):
    del bpy.data.objects['thud']['kn_mass_hint']


def drop_col(ob):
    bpy.data.objects.remove(bpy.data.objects['COL__sphere__0'])


def stray_object(ob):
    stray = bpy.data.objects.new('Cube', bpy.data.meshes.new('Cube'))
    bpy.context.scene.collection.objects.link(stray)


def drop_lod2(ob):
    bpy.data.objects.remove(bpy.data.objects['thud__ball__L2'])


def col_phys(ob):
    del bpy.data.objects['COL__sphere__0']['phys']


def bad_footprint(ob):
    bpy.data.objects['thud']['kn_footprint'] = '3,3,3'


def unapplied_rotation(ob):
    ob.rotation_euler = (0.3, 0, 0)


print('selftest: validator')
fresh_thud()
base = validate.validate(blend_path=THUD)
check('THUD source validates clean', base.ok, '; '.join(str(i).strip() for i in base.errors))
for case in [('unapplied scale', set_scale, '2.transform'), ('negative scale', neg_scale, '2.transform'),
             ('unapplied rotation', unapplied_rotation, '2.transform'),
             ('renamed COL', rename_col, '1.naming'), ('one-off material', local_material, '5.materials'),
             ('missing kn_mass_hint', drop_mass, '1.props'), ('no collision', drop_col, '7.collision'),
             ('stray object', stray_object, '1.naming'), ('missing LOD2', drop_lod2, '1.collections'),
             ('COL without phys', col_phys, '7.collision'), ('wrong footprint', bad_footprint, '3.bounds')]:
    run_case(*case)

# M3 (stream E3c): rule 13, texture sets. THUD carries its set once `node tools/assets.mjs thud --tex` ran;
# each case breaks one rule in memory (nothing on disk changes).
def _img(m):
    return bpy.data.images['thud__body__' + m]


def _paint(m, fn, frac=0.25):
    import numpy as np
    img = _img(m)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    fn(px[: int(h * frac)])
    img.pixels.foreach_set(px.ravel())


def tex_drop_normal(ob):
    bpy.data.images.remove(_img('normal'))


def tex_size_mismatch(ob):
    _img('orm').scale(512, 512)


def tex_colorspace(ob):
    _img('basecolor').colorspace_settings.name = 'Non-Color'


def tex_metal_grey(ob):
    def f(a):
        a[..., 2] = 0.5
    _paint('orm', f)


def tex_albedo_white(ob):
    def f(a):
        a[..., :3] = 1.0
    _paint('basecolor', f, 0.1)


def tex_hue_shift(ob):
    def f(a):
        a[..., 0], a[..., 2] = a[..., 2].copy(), a[..., 0].copy()
    _paint('basecolor', f, 1.0)


def tex_no_kn_set(ob):
    del ob['kn_set']


def tex_normal_y(ob):
    _img('normal')['kn_normal_y'] = '-Y'


fresh_thud()
if bpy.data.images.get('thud__body__basecolor') is not None:
    print('selftest: rule 13 texture sets')
    for case in [('set without its normal map', tex_drop_normal, '13.textures'),
                 ('set maps of different sizes', tex_size_mismatch, '13.textures'),
                 ('basecolor not sRGB', tex_colorspace, '13.textures'),
                 ('metallic not 0 or 1', tex_metal_grey, '13.textures'),
                 ('albedo above linear 0.85', tex_albedo_white, '13.textures'),
                 ('slot hue shifted', tex_hue_shift, '13.textures'),
                 ('textured piece without kn_set', tex_no_kn_set, '13.textures'),
                 ('normal map baked -Y', tex_normal_y, '13.textures')]:
        run_case(*case)
    fresh_thud()
    del bpy.data.objects['thud']['kn_tex_set']
    rep = validate.validate(blend_path=THUD)
    check('part without a set only warns under 13', rep.ok and any(i.rule == '13.textures' for i in rep.warnings),
          '; '.join(str(i).strip() for i in rep.issues))
else:
    print('selftest: rule 13 skipped (THUD has no texture set; node tools/assets.mjs thud --tex)')

# A broken copy on disk for the CLI exit-code check (file name must stay thud.blend).
ball = fresh_thud()
set_scale(ball)
broken = os.path.join(SCRATCH, 'broken_scale', 'thud.blend')
os.makedirs(os.path.dirname(broken), exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=broken, relative_remap=True, copy=True)  # keep library links resolvable
print('  wrote', broken)

print('selftest: template + port ring snap')
bpy.ops.wm.read_factory_settings(use_empty=True)
template.new_part('selftest_box', 'frame', 'S', '2,1,1', 1.0)
mats = template.link_masters(['kn_powder_bone'], ROOT)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=(0.2, 0.1, 0.1), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0, 0.05), verts=bm.verts)
from kn_tools import geom  # noqa: E402
geom.object_from_bmesh('selftest_box__body', bm, [mats['kn_powder_bone']], template.get_collection('RENDER'))
port = ports.add_port('power', 'in', Vector((0.01, -0.09, 0.05)), (0, -1, 0), size='M', dir='in')
ring = ports.snap_port_ring(port, root_dir=ROOT)
loc = port.matrix_world.translation
check('port snapped onto the front face', abs(loc.y + 0.05) < 1e-5 and abs(loc.z - 0.05) < 1e-5, str(loc))
check('port +X faces outward (-Y)', (ports.port_axis(port) - Vector((0, -1, 0))).length < 1e-5,
      str(ports.port_axis(port)))
check('linked PR_M ring instanced', ring.instance_collection is not None
      and ring.instance_collection.name == 'PR_M' and ring.instance_collection.library is not None)
rep = validate.validate(blend_path=os.path.join(SCRATCH, 'selftest_box.blend'))
check('snapped port passes rule 8', not rep.has('8.'), '; '.join(str(i).strip() for i in rep.errors))
port['size'] = 'L'
rep = validate.validate(blend_path=os.path.join(SCRATCH, 'selftest_box.blend'))
check('ring/size mismatch -> 8.ports', rep.has('8.ports'))
port['size'] = 'M'
port.rotation_euler.z += 3.14159
rep = validate.validate(blend_path=os.path.join(SCRATCH, 'selftest_box.blend'))
check('inward-facing port -> 8.ports', rep.has('8.ports'))

print('selftest: %s (%d failures)' % ('PASS' if not failures else 'FAIL', len(failures)))
sys.stdout.flush()
sys.exit(1 if failures else 0)
