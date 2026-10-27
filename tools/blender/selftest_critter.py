"""Validator rule 11 self-test (M2, stream E2): the clean critter passes, and each broken copy fails on rule 11.

Usage: blender -b assets/src/critters/<critter>.blend --factory-startup -P tools/blender/selftest_critter.py
Exits 1 when any case does not behave as expected. Nothing is saved.
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402,F401

import bpy  # noqa: E402

from kn_tools import rig, template, validate  # noqa: E402


def lod0():
    return rig.lod_meshes(bpy.context.scene, 0)[0]


def five_weights():
    ob = lod0()
    v = ob.data.vertices[0]
    have = {g.group for g in v.groups}
    for g in ob.vertex_groups:
        if g.index not in have and len(v.groups) < 5:
            g.add([0], 0.1, 'REPLACE')


def unweighted_vertex():
    ob = lod0()
    for g in ob.vertex_groups:
        g.remove([0])


def missing_clip():
    t = template.find_root(bpy.context.scene)['kn_type']
    bpy.data.actions.remove(bpy.data.actions[t + '__sniff'])


def missing_role_clip():
    root = template.find_root(bpy.context.scene)
    root['kn_role_clips'] = root.get('kn_role_clips', '') + ',moonwalk'


def root_motion():
    t = template.find_root(bpy.context.scene)['kn_type']
    act = bpy.data.actions[t + '__walk']
    fc = act.fcurves.new('pose.bones["root"].location', index=1, action_group='root')
    fc.keyframe_points.add(2)
    fc.keyframe_points.foreach_set('co', [0.0, 0.0, 30.0, 0.5])


def no_head_ragdoll():
    bpy.data.objects.remove(bpy.data.objects['RAG__head'], do_unlink=True)


def bad_ragdoll_mass():
    ob = next(o for o in rig.rag_objects(bpy.context.scene))
    ob['mass'] = float(ob['mass']) + 1.0


def ragdoll_no_swing():
    ob = next(o for o in rig.rag_objects(bpy.context.scene))
    del ob['swing_deg']


def too_many_bones():
    arm = rig.find_rig(bpy.context.scene)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for i in range(81):
        b = arm.data.edit_bones.new('extra_%02d' % i)
        b.head = (0, 0, 0.1)
        b.tail = (0, 0, 0.11)
        b.parent = arm.data.edit_bones['head']
    bpy.ops.object.mode_set(mode='OBJECT')


def wrong_fps():
    bpy.context.scene.render.fps = 24


CASES = [five_weights, unweighted_vertex, missing_clip, missing_role_clip, root_motion, no_head_ragdoll,
         bad_ragdoll_mass, ragdoll_no_swing, too_many_bones, wrong_fps]


def main():
    path = bpy.data.filepath
    if not path:
        _cli.die('open a critter .blend')
    failures = []
    rep = validate.validate()
    if not rep.ok:
        failures.append('clean file does not pass: %s' % [str(i) for i in rep.errors])
    else:
        print('  ok   clean %s passes (%s)' % (os.path.basename(path), rep.stats.get('rig')))
    for case in CASES:
        bpy.ops.wm.open_mainfile(filepath=path)
        case()
        rep = validate.validate(blend_path=path)
        r11 = [i for i in rep.errors if i.rule.startswith('11.')]
        if r11:
            print('  ok   %-20s -> %s' % (case.__name__, r11[0].message))
        else:
            failures.append('%s: expected a rule 11 error, got %s' % (case.__name__, [str(i) for i in rep.errors]))
    for f in failures:
        print('  FAIL', f)
    print('critter selftest: %d cases, %d failures' % (len(CASES) + 1, len(failures)))
    sys.stdout.flush()
    sys.exit(1 if failures else 0)


main()
