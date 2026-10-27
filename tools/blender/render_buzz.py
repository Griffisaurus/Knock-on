"""BUZZ look-dev and contact sheet (M5 stream E5b), from the *exported* glb.

The same round trip as render_critters_m4.py (imported glb, masters re-bound by id, the D78 set bound the way the
engine binds it, LOD0 posed with its own glTF clips), plus what the engine draws on top of a robot critter: the
LED visor face icon for the clip's frame (art.json faceTracks; icons drawn here as simple Beam glyphs, the
engine's own icon art is the renderer's), the LED groups lit (nav white, duct rings white, cargo Signal amber
while carrying, rear strobe amber) and the winch tether (an engine rope, kn_rope O 3 mm) from the spool to the
claw hub, with a stand-in parcel hanging from the claw in the carry poses.

Usage: blender -b --factory-startup -P tools/blender/render_buzz.py -- <out.png> [--res 2400x1500] [--samples N]
       [--turn] [--flat] [--clips 'clip@sec,...'] [--cols N] [--el 30] [--yaw -30] [--close]
  --turn   front, 3/4, side and back of the rest pose (hovering, idle frame 0)
  --close  one big hero view (the first pose)
"""
import json
import math
import os
import sys

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kn_tools import library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402

import render_critters_m4 as rc  # noqa: E402
import render_lookdev as rl  # noqa: E402

TYPE = 'buzz'
COM_Z = 0.055
# (label, clip, seconds, airborne height of the skids, parcel)
POSES = [('idle', 'idle', 0.0, 0.12, None), ('walk (cruise)', 'walk', 0.3, 0.12, None),
         ('sniff (scan)', 'sniff', 0.5, 0.12, None), ('grab', 'grab', 0.62, 0.16, 'grab'),
         ('carry', 'carry', 0.5, 0.16, 'carry'), ('deliver_bow', 'deliver_bow', 0.45, 0.10, None),
         ('celebrate', 'celebrate', 0.40, 0.10, None), ('sleep (docked)', 'sleep', 0.0, 0.0, None)]
TURN = [('front', 0.0, None), ('three quarter', -35.0, None), ('side', -90.0, None), ('back', 160.0, None)]
BEAM = (0.18, 0.84, 1.0)
WHITE = (0.93, 0.95, 1.0)
SIGNAL = (1.0, 0.55, 0.02)
AMBER = (1.0, 0.45, 0.0)
CELL = 0.50
ROW = 0.78   # row spacing (m): the camera looks down ~28 deg, so rows need more room than columns


# ---------------------------------------------------------------- face icons (look-dev stand-ins)

def icon_mask(icon, w=448, h=160):
    """A Beam glyph for the visor, drawn wider than DUSTY's pair of eye screens (critters.md): two eyes."""
    ys, xs = np.mgrid[0:h, 0:w]
    X = (xs + 0.5 - w / 2) / (h / 2)          # height spans -1..1, width -2.8..2.8
    Y = (h / 2 - ys - 0.5) / (h / 2)
    m = np.zeros((h, w))

    def rr(cx, cy, hw, hh, r):   # rounded rectangle
        dx = np.maximum(np.abs(X - cx) - (hw - r), 0)
        dy = np.maximum(np.abs(Y - cy) - (hh - r), 0)
        return np.hypot(dx, dy) - r

    def ring(cx, cy, r, t):
        return np.abs(np.hypot(X - cx, Y - cy) - r) - t
    eyes = (-0.95, 0.95)
    for i, cx in enumerate(eyes):
        side = -1 if i == 0 else 1
        if icon == 'neutral':
            d = rr(cx, 0.0, 0.26, 0.52, 0.24)
        elif icon == 'blink':
            d = rr(cx, -0.05, 0.36, 0.07, 0.07)
        elif icon == 'happy':
            d = np.where(Y > -0.05, ring(cx, -0.15, 0.36, 0.09), 9)
        elif icon == 'smug':
            d = np.maximum(rr(cx, -0.05, 0.34, 0.36, 0.3), Y - 0.02)
        elif icon == 'scared':
            d = ring(cx + 0.03 * math.sin(i * 3), 0.0, 0.17 + 0.02 * np.sin(np.arctan2(Y, X - cx) * 5), 0.07)
        elif icon == 'angry':
            d = np.maximum(rr(cx, -0.05, 0.3, 0.48, 0.26), (Y - 0.25) + 0.55 * side * (X - cx))
        elif icon == 'dizzy':
            a = np.arctan2(Y, X - cx)
            rad = np.hypot(X - cx, Y)
            k = 0.07
            d = np.abs(((rad - k * (a + math.pi)) % (2 * math.pi * k)) - math.pi * k) - 0.06
            d = np.where(rad < 0.55, d, 9)
        elif icon == 'sleepy':
            d = rr(cx, -0.25, 0.34, 0.07, 0.07)
        elif icon == 'surprised':
            d = ring(cx, 0.0, 0.42, 0.09)
        elif icon == 'determined':
            d = np.maximum(rr(cx, -0.08, 0.32, 0.45, 0.26), Y - 0.22)
        elif icon == 'scan':
            d = np.minimum(rr(0.0, 0.0, 2.2, 0.035, 0.035) + 0.0, np.hypot(X - 0.9, Y) - 0.28)
            d = np.where(d < 0, d, 9) if i == 0 else 9 + 0 * X
        elif icon == 'strain':
            d = np.hypot((X - cx) / 1.15, Y / 0.9) - 0.56
        else:
            d = rr(cx, 0.0, 0.26, 0.52, 0.24)
        m = np.maximum(m, np.clip(0.5 - d * (h / 2) / 1.5, 0, 1))
    if icon == 'scan':   # dim track
        m = np.maximum(m, 0.25 * np.clip(0.5 - rr(0.0, 0.0, 2.2, 0.035, 0.035) * (h / 2) / 1.5, 0, 1))
    return m


def icon_material(icon, cache={}):
    if icon in cache:
        return cache[icon]
    m = icon_mask(icon)
    h, w = m.shape
    img = bpy.data.images.new('icon_' + icon, w, h, alpha=False, float_buffer=True)
    rgba = np.ones((h, w, 4))
    for c in range(3):
        rgba[..., c] = m
    img.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())   # rows top-down: the imported screen quad's v is flipped
    mat = bpy.data.materials.new('screen_' + icon)
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.012, 0.014, 0.018, 1)
    p.inputs['Roughness'].default_value = 0.15
    p.inputs['Emission Color'].default_value = (*BEAM, 1)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 9.0 if icon not in ('sleepy', 'blink') else 4.0
    nt.links.new(tex.outputs['Color'], mul.inputs[0])
    nt.links.new(mul.outputs[0], p.inputs['Emission Strength'])
    cache[icon] = mat
    return mat


def led_material(name, col, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.05, 0.05, 0.05, 1)
    p.inputs['Emission Color'].default_value = (*col, 1)
    p.inputs['Emission Strength'].default_value = strength
    return m


def led_group(c):
    """Root-space face centre -> LED group (as make_buzz.led_colours)."""
    duct = min(math.hypot(c.x - sx * 0.115, c.y - sy * 0.115) for sx in (1, -1) for sy in (1, -1))
    if c.z < 0.026:
        return 2
    if c.y > 0.05 and abs(c.x) < 0.02:
        return 3
    if duct < 0.051:
        return 1
    return 0


def light_leds(meshes, carrying, mats):
    for ob in meshes:
        me = ob.data
        slots = [s.material.name.split('.')[0] if s.material else '' for s in ob.material_slots]
        if 'kn_led' not in slots:
            continue
        li = slots.index('kn_led')
        base = len(me.materials)
        for g in range(4):
            me.materials.append(mats[(g, carrying)])
        for p in me.polygons:
            if p.material_index == li:
                c = p.center
                g = led_group(Vector((c.x, c.y, c.z + COM_Z)))
                p.material_index = base + g


# ---------------------------------------------------------------- scene helpers

def cylinder_between(a, b, r, mat, name='rope'):
    d = b - a
    L = d.length
    if L < 1e-4:
        return None
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=L, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(mat)
    return ob


def parcel(at_top, mat, tape):
    s = 0.07
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(at_top.x, at_top.y, at_top.z - s / 2))
    ob = bpy.context.active_object
    ob.scale = (s, s * 0.85, s)
    bev = ob.modifiers.new('bev', 'BEVEL')
    bev.width = 0.004
    bev.segments = 3
    ob.data.materials.append(mat)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(at_top.x, at_top.y, at_top.z - s / 2))
    t = bpy.context.active_object
    t.scale = (s * 1.01, 0.012, s * 1.01)
    t.data.materials.append(tape)
    return ob


def bone_world(arm, bone, local_rest):
    """A point given in the bone's rest (armature) space, carried by the posed bone, in world space."""
    pb = arm.pose.bones[bone]
    m = pb.matrix @ pb.bone.matrix_local.inverted()
    return arm.matrix_world @ (m @ Vector(local_rest))


def main():
    args = _cli.script_args()
    if not args:
        _cli.die('usage: render_buzz.py -- <out.png> [--turn] [--flat] [--clips ...]')
    out_png = os.path.abspath(args[0])
    res = _cli.option(args, '--res', '2400x1500')
    samples = int(_cli.option(args, '--samples', '64'))
    elev = float(_cli.option(args, '--el', '36'))
    yaw = float(_cli.option(args, '--yaw', '-30'))
    flat = _cli.flag(args, '--flat')
    turn = _cli.flag(args, '--turn')
    close = _cli.flag(args, '--close')
    clips = _cli.option(args, '--clips', None)
    cols = int(_cli.option(args, '--cols', '4'))
    root = paths.repo_root()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = 30
    lbl = bpy.data.materials.new('label')
    lbl.use_nodes = True
    lbl.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#3A3E47')
    if turn:
        rows_spec = [(lb, 'idle', 0.0, 0.10, None, vy, ve) for lb, vy, ve in TURN]
        cols = len(rows_spec)
    elif clips:
        rows_spec = []
        for c in clips.split(','):
            nm, sec = c.split('@')
            h = 0.0 if nm in ('sleep', 'land', 'getup', 'takeoff', 'tumble') else 0.12
            pk = nm if nm in ('grab', 'carry', 'drop_off') else None
            rows_spec.append((c, nm, float(sec), h, pk, None, None))
    else:
        rows_spec = [p + (None, None) for p in POSES]
    if close:
        rows_spec = rows_spec[:1]
        cols = 1
    nrow = (len(rows_spec) + cols - 1) // cols
    d = os.path.join(root, 'assets', 'build', 'parts', TYPE)
    with open(os.path.join(d, TYPE + '.art.json'), encoding='utf-8') as f:
        art = json.load(f)
    mats_before = set(bpy.data.materials)
    arm0, body0, acts = rc.import_critter(os.path.join(d, TYPE + '.glb'))
    imported_mats = [m for m in bpy.data.materials if m not in mats_before]
    tex = None if flat else rc.load_set(root, TYPE, art)
    faces = art.get('faceTracks', {})
    rope = bpy.data.materials.new('rope')
    rope.use_nodes = True
    rope.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#EDE6D8')
    rope.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
    card = bpy.data.materials.new('card')
    card.use_nodes = True
    card.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#B88A5A')
    card.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    tape = bpy.data.materials.new('tape')
    tape.use_nodes = True
    tape.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = library.hexcol('#FF5B2E')
    led_mats = {}
    for carrying in (False, True):
        led_mats[(0, carrying)] = led_material('led_nav', WHITE, 30.0)
        led_mats[(1, carrying)] = led_material('led_duct', WHITE, 14.0)
        led_mats[(2, carrying)] = led_material('led_cargo', SIGNAL, 18.0) if carrying else \
            led_material('led_cargo_off', (0.0, 0.0, 0.0), 0.0)
        led_mats[(3, carrying)] = led_material('led_strobe', AMBER, 25.0)
    span_x = cols * CELL
    span_y = nrow * ROW
    for i, (rlabel, clip, tsec, lift, pk, vyaw, vel) in enumerate(rows_spec):
        ci, ri = i % cols, i // cols
        cx = (ci - (cols - 1) / 2) * CELL
        cy = ((nrow - 1) / 2 - ri) * ROW
        if i == 0:
            arm, body = arm0, body0
        else:
            arm = arm0.copy()
            arm.data = arm0.data
            sc.collection.objects.link(arm)
            body = []
            for b in body0:
                nb = b.copy()
                nb.data = b.data.copy()
                sc.collection.objects.link(nb)
                nb.parent = arm
                nb.matrix_parent_inverse = b.matrix_parent_inverse.copy()
                for m in nb.modifiers:
                    if m.type == 'ARMATURE':
                        m.object = arm
                body.append(nb)
        act = rc.find_action(acts, '%s__%s' % (TYPE, clip))
        arm.animation_data_create()
        arm.animation_data.action = act
        if act is not None and hasattr(arm.animation_data, 'action_slot') and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        frame = int(round(tsec * 30))
        ry = yaw if vyaw is None else vyaw
        arm.matrix_world = (Matrix.Translation(Vector((cx, cy, lift + COM_Z))) @ Matrix.Rotation(math.radians(ry), 4, 'Z'))
        arm['kn_frame'] = frame
        icon = 'neutral'
        for f0, name in faces.get(clip, []):
            if f0 <= frame:
                icon = name
        for b in body:
            for slot in b.material_slots:
                if slot.material and slot.material.name.split('.')[0] == 'kn_screen':
                    slot.link = 'OBJECT'
                    slot.material = icon_material(icon)
        light_leds(body, pk in ('carry', 'grab'), led_mats)
        arm['kn_parcel'] = pk or ''
        if not close:
            rc.label(rlabel, (cx, cy - ROW * 0.30, 0.0005), 0.026, lbl)
    if not close and not turn:
        rc.label('BUZZ', (-span_x / 2 + 0.03, -span_y / 2 - CELL * 0.12, 0.0005), 0.06, lbl, align='LEFT')
        ext = [art['bounds']['max'][k] - art['bounds']['min'][k] for k in range(3)]
        rc.label('%.2f x %.2f x %.2f m · 1.1 kg · LOD %d / %d / %d / %d tris · %d bones · %d clips%s' % (
            ext[0], ext[1], ext[2], *[lo['tris'] for lo in art['lods']], art['rig']['deformBones'],
            len(art['clips']),
            ' · tex %d²' % art['textures']['size'] if art.get('textures') and not flat else ''),
            (-span_x / 2 + 0.03, -span_y / 2 - CELL * 0.21, 0.0005), 0.02, lbl, align='LEFT')
    # bake each armature's pose into an NLA strip offset so frame 0 shows it
    for ob in bpy.data.objects:
        if ob.type == 'ARMATURE' and ob.animation_data and ob.animation_data.action:
            act = ob.animation_data.action
            f = ob.get('kn_frame', 0)
            for tr in list(ob.animation_data.nla_tracks):
                ob.animation_data.nla_tracks.remove(tr)
            ob.animation_data.action = None
            tr = ob.animation_data.nla_tracks.new()
            st = tr.strips.new(act.name, int(-f), act)
            st.extrapolation = 'HOLD'
    sc.frame_set(0)
    bpy.context.view_layer.update()
    # tethers and parcels at the posed winch
    for ob in list(bpy.data.objects):
        if ob.type != 'ARMATURE' or 'kn_frame' not in ob.keys():
            continue
        head_w = ob.matrix_world @ ob.pose.bones['winch'].head
        rest_w = ob.matrix_world @ ob.pose.bones['winch'].bone.head_local
        spool = bone_world(ob, 'body', ob.pose.bones['winch'].bone.head_local)
        hub = head_w
        if (hub - spool).length > 0.003 or ob.get('kn_parcel'):
            cylinder_between(spool, hub, 0.0015, rope)
        del rest_w
        if ob.get('kn_parcel') in ('carry', 'grab'):
            tip = bone_world(ob, 'winch', ob.pose.bones['winch'].bone.head_local + Vector((0, 0, -0.019)))
            parcel(tip, card, tape)
    # materials: masters (+ the set)
    imported = [m for m in bpy.data.materials if not m.library and m in imported_mats]
    wanted = sorted({m.name.split('.')[0] for m in imported if is_master_material(m.name.split('.')[0])})
    masters = library.link_materials(paths.materials_lib(root), wanted)
    cache = {}
    for m in imported:
        key = m.name.split('.')[0]
        if key not in masters:
            continue
        tgt = masters[key]
        if tex is not None and key in tex[1]:
            tgt = rc.textured_copy(masters[key], tex[0], cache)
        m.user_remap(tgt)
    rl.use_cycles(sc, samples)
    w, h = (int(v) for v in res.lower().split('x'))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -1.7
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    cyc_mat = bpy.data.materials.new('cyc_light')
    cyc_mat.use_nodes = True
    p = cyc_mat.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = library.hexcol('#BDB8AF')
    p.inputs['Roughness'].default_value = 0.92
    rl.cyc(cyc_mat, width=span_x * 3 + 2, front=span_y * 2 + 1, back=span_y * 0.7 + 0.3, radius=0.8, height=3.0)
    target = Vector((0.0, -0.12, 0.10))
    rl.area('Key', (-1.6, -1.8, 2.4), target, 560, 2.0)
    rl.area('Fill', (2.0, -1.2, 1.0), target, 160, 2.0)
    rl.area('Rim', (0.3, 2.0, 1.6), target, 380, 1.8, color=(0.86, 0.94, 1.0))
    rl.area('Top', (0, 0.2, 3.0), target, 240, 3.0)
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.lens = 75
    cam = bpy.data.objects.new('Camera', cam_d)
    sc.collection.objects.link(cam)
    el = math.radians(elev if not turn else 20)
    if close:
        target = Vector((0, 0, rows_spec[0][3] + COM_Z))
        dist = 0.62
        cam_d.lens = 60
    else:
        hx = math.atan(18.0 / cam_d.lens)
        hy = math.atan(18.0 * h / w / cam_d.lens)
        dist = max((span_x / 2 + 0.12) / math.tan(hx), (span_y / 2 + 0.15) * math.sin(el) / math.tan(hy))
    cam.location = target + Vector((0.0, -dist * math.cos(el), dist * math.sin(el)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


if __name__ == '__main__':
    main()
