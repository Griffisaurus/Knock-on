"""KNOCK-ON art style samples: procedural Blender scenes rendered in Cycles.

Builds "Lab Toy Futurism" look-dev scenes from the master materials and part shapes in GAME_SPEC.md §10 and §19.
These are look-development blockouts, not final assets.

Usage:
  blender -b --factory-startup --python tools/blender/style_samples.py -- <png_dir> <blend_dir> [preview|final] [scene,scene]
Scenes: lineup, mechanism, boom, materials
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PNG_DIR = argv[0] if len(argv) > 0 else '//'
BLEND_DIR = argv[1] if len(argv) > 1 else '//'
QUALITY = argv[2] if len(argv) > 2 else 'preview'
SCENES = argv[3].split(',') if len(argv) > 3 else ['lineup', 'mechanism', 'boom', 'materials']

CREATED = []  # objects made by the current part builder, collected for grouping
M = {}        # material library
FONT = None


# ---------------------------------------------------------------- colour + materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, cap=0.85):
    """sRGB hex -> linear RGBA. Albedo is capped at 0.85 per the asset spec; pass cap>1 for emission."""
    h = h.lstrip('#')
    c = [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    peak = max(c)
    if peak > cap:
        c = [x * cap / peak for x in c]
    return (*c, 1.0)


def principled(name, base, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.1, transmission=0.0, ior=1.5,
               emission=None, strength=0.0, sss=0.0, aniso=0.0, sheen=0.0, bump=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = base
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coat_rough
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = ior
    p.inputs['Subsurface Weight'].default_value = sss
    p.inputs['Anisotropic'].default_value = aniso
    p.inputs['Sheen Weight'].default_value = sheen
    if emission:
        p.inputs['Emission Color'].default_value = emission
        p.inputs['Emission Strength'].default_value = strength
    if bump:  # (noise scale, strength, distance): powder-coat orange peel, paper tooth
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = bump[0]
        n.inputs['Detail'].default_value = 6.0
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = bump[1]
        b.inputs['Distance'].default_value = bump[2]
        nt.links.new(n.outputs['Fac'], b.inputs['Height'])
        nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    return m


def emissive(name, hexc, strength):
    return principled(name, (0.01, 0.01, 0.01, 1), rough=0.3, emission=hexcol(hexc, cap=10), strength=strength)


def hardwood():
    m = bpy.data.materials.new('hardwood')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = 0.45
    p.inputs['Coat Weight'].default_value = 0.35
    p.inputs['Coat Roughness'].default_value = 0.15
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.12, 1.0, 1.0)
    w = nt.nodes.new('ShaderNodeTexWave')
    w.wave_type = 'RINGS'
    w.inputs['Scale'].default_value = 9.0
    w.inputs['Distortion'].default_value = 6.0
    w.inputs['Detail'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = hexcol('#9A6338')
    ramp.color_ramp.elements[1].color = hexcol('#D7A86E')
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], w.inputs['Vector'])
    nt.links.new(w.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    return m


BRAND = {'ignition': '#FF5B2E', 'volt': '#C6FF3A', 'cobalt': '#3355FF', 'plasma': '#FF3DAE',
         'bone': '#E8E2D6', 'graphite': '#3A3E47', 'amber': '#FFB020', 'beam': '#2FD6FF'}
CHANNEL = {'power': '#C6FF3A', 'signal': '#FFC21A', 'spin': '#A78BFA', 'heat': '#FF5B2E', 'light': '#FFF1A8'}


def build_materials():
    M.clear()
    for n, h in BRAND.items():
        M['pc_' + n] = principled('powder_' + n, hexcol(h), rough=0.42, coat=0.25, coat_rough=0.3,
                                  bump=(1400, 0.035, 0.0004))
    M['pc_ignition_gloss'] = principled('powder_ignition_gloss', hexcol(BRAND['ignition']), rough=0.25, coat=1.0,
                                        coat_rough=0.03)
    M['boing'] = principled('boing_rubber', hexcol('#FF6A33'), rough=0.6, sheen=0.25, bump=(2600, 0.25, 0.0008))
    M['anod_beam'] = principled('anodized_beam', hexcol('#4FC3E8'), rough=0.3, metal=1.0)
    M['anod_volt'] = principled('anodized_volt', hexcol('#B5E043'), rough=0.32, metal=1.0)
    M['anod_cobalt'] = principled('anodized_cobalt', hexcol('#4A6BFF'), rough=0.3, metal=1.0)
    M['anod_plasma'] = principled('anodized_plasma', hexcol('#F04FA8'), rough=0.3, metal=1.0)
    M['steel'] = principled('brushed_steel', hexcol('#C9CDD3'), rough=0.24, metal=1.0, aniso=0.6)
    M['chrome'] = principled('chrome', hexcol('#E6E8EB'), rough=0.05, metal=1.0)
    M['brass'] = principled('brass', hexcol('#E3B261'), rough=0.25, metal=1.0)
    M['copper'] = principled('copper', hexcol('#D9824A'), rough=0.28, metal=1.0)
    M['poly'] = principled('polycarbonate_beam', hexcol('#D2F4FF'), rough=0.03, transmission=1.0, ior=1.58)
    M['poly_amber'] = principled('polycarbonate_amber', hexcol('#FFC266'), rough=0.05, transmission=1.0, ior=1.58)
    M['glass'] = principled('glass', (1, 1, 1, 1), rough=0.0, transmission=1.0, ior=1.5)
    M['rubber'] = principled('rubber', hexcol('#1C1E22'), rough=0.82, sheen=0.3)
    M['paper_red'] = principled('paper_red', hexcol('#D93A2B'), rough=0.72, bump=(500, 0.08, 0.001))
    M['paper_tan'] = principled('paper_tan', hexcol('#D8C39A'), rough=0.8, bump=(500, 0.08, 0.001))
    M['latex'] = principled('latex_plasma', hexcol(BRAND['plasma']), rough=0.3, coat=0.7, coat_rough=0.06, sss=0.12)
    M['fuse'] = principled('fuse_cord', hexcol('#4A3524'), rough=0.9, bump=(800, 0.3, 0.001))
    M['string'] = principled('string', hexcol('#EDE6D8'), rough=0.85)
    M['wood'] = hardwood()
    for n, h in CHANNEL.items():
        M['led_' + n] = emissive('led_' + n, h, 14.0)
    M['eye'] = emissive('led_eye', BRAND['beam'], 10.0)
    M['spark'] = emissive('spark', '#FF8A2A', 45.0)
    M['spark_hot'] = emissive('spark_hot', '#FFC870', 90.0)
    M['ember'] = emissive('ember', '#FF6A1F', 60.0)
    M['cyc_light'] = principled('cyc_light', hexcol('#BDB8AF'), rough=0.92)
    M['cyc_dark'] = principled('cyc_dark', hexcol('#1C1F26'), rough=0.85)
    M['label'] = principled('label', hexcol('#EEF1F6'), rough=0.6, emission=hexcol('#EEF1F6', cap=10), strength=0.6)
    M['label_dim'] = principled('label_dim', hexcol('#8A93A6'), rough=0.6, emission=hexcol('#8A93A6', cap=10),
                                strength=0.4)


# ---------------------------------------------------------------- geometry helpers

def _track(obj):
    CREATED.append(obj)
    return obj


def _active():
    return bpy.context.view_layer.objects.active


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def bevel(ob, width, segments=4, angle=35, harden=True):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = harden
    smooth(ob)
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def box(name, size, loc, mat, bev=0.006, seg=4, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = _active()
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(ob, mat)
    if bev:
        bevel(ob, bev, seg)
    return _track(ob)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=96, bev=0.003, seg=3):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob = _active()
    ob.name = name
    assign(ob, mat)
    if bev:
        bevel(ob, bev, seg, angle=50)
    else:
        smooth(ob)
    return _track(ob)


def sphere(name, r, loc, mat, segs=96, rings=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r, location=loc)
    ob = _active()
    ob.name = name
    assign(ob, mat)
    smooth(ob)
    return _track(ob)


def torus(name, R, r, loc, mat, rot=(0, 0, 0), major=128, minor=24):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor,
                                     location=loc, rotation=rot)
    ob = _active()
    ob.name = name
    assign(ob, mat)
    smooth(ob)
    return _track(ob)


def mesh_obj(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    assign(ob, mat)
    return _track(ob)


def curve(name, pts, radius, mat, resolution=24):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.resolution_u = resolution
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (*co, 1.0)
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts))
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return _track(ob)


def euler_to(direction, up='Y'):
    return Vector(direction).normalized().to_track_quat('Z', up).to_euler()


def cutter(name, r, depth, loc, rot):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=r, depth=depth, location=loc, rotation=rot)
    ob = _active()
    ob.name = name
    ob.hide_render = True
    ob.display_type = 'WIRE'
    return _track(ob)


def boolean(target, cut):
    m = target.modifiers.new('Cut_' + cut.name, 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.solver = 'EXACT'
    m.object = cut


def group(name, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """Parent everything built since the last group() to an empty and place it."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    for ob in CREATED:
        if ob.parent is None:
            ob.parent = e
    CREATED.clear()
    e.location = loc
    e.rotation_euler = rot
    e.scale = (scale, scale, scale)
    return e


def port_ring(name, loc, direction, led, R=0.018):
    """The universal connection collar: machined steel ring, channel LED, rubber socket."""
    d = Vector(direction).normalized()
    rot = euler_to(d)
    loc = Vector(loc)
    torus(name + '_collar', R, R * 0.3, loc, M['steel'], rot=rot)
    torus(name + '_led', R * 0.7, R * 0.11, loc + d * R * 0.16, M['led_' + led], rot=rot, minor=16)
    cyl(name + '_socket', R * 0.62, R * 0.25, loc - d * R * 0.02, M['rubber'], rot=rot, bev=0.0006, seg=2)


def gear(name, teeth, module, thickness, mat, phase=0.0, holes=5, hub_mat=None):
    """Spur gear at the origin, axis +Z."""
    rp = module * teeth / 2
    rt, rr = rp + module, rp - 1.25 * module
    step = 2 * math.pi / teeth
    profile = []
    for i in range(teeth):
        for frac, r in ((0.0, rr), (0.15, rr), (0.28, rt), (0.47, rt), (0.6, rr), (0.8, rr)):
            a = (i + frac) * step + phase
            profile.append((r * math.cos(a), r * math.sin(a)))
    n = len(profile)
    h = thickness / 2
    verts = [(x, y, h) for x, y in profile] + [(x, y, -h) for x, y in profile]
    faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    ob = mesh_obj(name, verts, faces, mat)
    if holes:
        for k in range(holes):
            a = 2 * math.pi * k / holes
            c = cutter(f'{name}_hole{k}', rr * 0.2, thickness * 3,
                       (rr * 0.56 * math.cos(a), rr * 0.56 * math.sin(a), 0), (0, 0, 0))
            c.parent = ob
            boolean(ob, c)
    c = cutter(name + '_bore', module * 1.6, thickness * 3, (0, 0, 0), (0, 0, 0))
    c.parent = ob
    boolean(ob, c)
    bevel(ob, min(0.0012, module * 0.18), 2, angle=40)
    hub = cyl(name + '_hub', module * 2.6, thickness * 1.25, (0, 0, 0), hub_mat or M['steel'], bev=0.0008, seg=2)
    hub.parent = ob
    bore = cyl(name + '_axle', module * 1.0, thickness * 1.6, (0, 0, 0), M['chrome'], bev=0.0005, seg=2)
    bore.parent = ob
    return ob, rp


# ---------------------------------------------------------------- scene helpers

def setup_render(samples, res=(1920, 1080), world=(0.02, 0.02, 0.025), world_strength=1.0, exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev_type in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            if any(d.type == dev_type for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dev_type
                sc.cycles.device = 'GPU'
                print('render device:', dev_type, [d.name for d in prefs.devices if d.use])
                break
        except Exception as e:  # noqa: BLE001 - fall through to CPU
            print('device', dev_type, 'unavailable:', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 16
    sc.cycles.glossy_bounces = 8
    sc.cycles.transmission_bounces = 16
    sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Punchy'
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.exposure = exposure
    w = bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*world, 1)
    bg.inputs[1].default_value = world_strength


def cyc(mat, width=12, front=6, back=1.2, radius=1.5, height=6):
    prof = [(-front, 0.0)]
    y = -front
    while y < back:
        y = min(back, y + 0.5)
        prof.append((y, 0.0))
    for i in range(1, 25):
        t = math.radians(90 * i / 24)
        prof.append((back + radius * math.sin(t), radius * (1 - math.cos(t))))
    z = radius
    while z < height:
        z = min(height, z + 0.5)
        prof.append((back + radius, z))
    verts = [(-width / 2, py, pz) for py, pz in prof] + [(width / 2, py, pz) for py, pz in prof]
    n = len(prof)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    ob = mesh_obj('Cyclorama', verts, faces, mat)
    smooth(ob)
    CREATED.clear()
    return ob


def area(name, loc, target, power, size, color=(1, 1, 1), size_y=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.color = color
    ld.size = size
    if size_y:
        ld.shape = 'RECTANGLE'
        ld.size_y = size_y
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def point(name, loc, power, color, radius=0.005):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = power
    ld.color = color
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    return ob


def camera(loc, target, lens=50, fstop=None, focus=None):
    cd = bpy.data.cameras.new('Camera')
    cd.lens = lens
    cd.clip_start = 0.01
    ob = bpy.data.objects.new('Camera', cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    if fstop:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fstop
        cd.dof.focus_distance = focus if focus else (Vector(target) - Vector(loc)).length
    return ob


def label(text, loc, size, mat, rot=(math.radians(90), 0, 0)):
    cu = bpy.data.curves.new('lbl_' + text, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    if FONT:
        cu.font = FONT
    ob = bpy.data.objects.new('lbl_' + text, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------- parts (built at origin, base on z=0, front = -Y)

def thud():
    r = 0.11
    c = Vector((0, 0, r))
    ball = sphere('THUD', r, c, M['pc_graphite'])
    for i, d in enumerate([(-0.16, -0.55, 0.82), (0.16, -0.55, 0.82), (0.0, -0.8, 0.6)]):
        d = Vector(d).normalized()
        k = cutter(f'THUD_finger{i}', 0.0115, 0.07, c + d * r, euler_to(d))
        boolean(ball, k)
    bevel(ball, 0.0025, 3, angle=30, harden=False)
    torus('THUD_band', r * 0.995, 0.0065, c, M['pc_ignition'], rot=(math.radians(-18), math.radians(8), 0))
    return group('THUD')


def boing():
    r = 0.12
    c = Vector((0, 0, r))
    sphere('BOING', r, c, M['boing'])
    for rot in [(0, 0, 0), (math.radians(90), 0, 0), (math.radians(90), 0, math.radians(90))]:
        torus('BOING_seam', r * 0.998, 0.0032, c, M['rubber'], rot=rot, minor=12)
    return group('BOING')


def helio(height=0.62, anchor_offset=(0.06, 0.04)):
    r = 0.12
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r, location=(0, 0, 0))
    b = _active()
    b.name = 'HELIO'
    for v in b.data.vertices:
        z = v.co.z / r
        k = 1.0 - 0.38 * (max(0.0, -z) ** 1.6)
        v.co.x *= k
        v.co.y *= k
        v.co.z *= 1.18 if z < 0 else 1.08
    b.location = (0, 0, height)
    assign(b, M['latex'])
    smooth(b)
    _track(b)
    knot_z = height - r * 1.18
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.012, radius2=0.004, depth=0.022,
                                    location=(0, 0, knot_z - 0.006), rotation=(math.pi, 0, 0))
    k = _active()
    assign(k, M['latex'])
    smooth(k)
    _track(k)
    ax, ay = anchor_offset
    curve('HELIO_string', [(0, 0, knot_z - 0.015), (0.02, 0.0, knot_z * 0.7), (ax * 0.4, ay * 0.5, knot_z * 0.35),
                           (ax, ay, 0.03)], 0.0011, M['string'])
    cyl('ANCHOR_puck', 0.026, 0.014, (ax, ay, 0.007), M['pc_graphite'], bev=0.003)
    torus('ANCHOR_ring', 0.011, 0.0028, (ax, ay, 0.026), M['brass'], rot=(math.radians(90), 0, 0))
    return group('HELIO')


def fulcrum(tilt=-12):
    h, a, d = 0.085, 0.06, 0.09
    tri = [(-a, 0), (a, 0), (0, h)]
    verts = [(x, -d / 2, z) for x, z in tri] + [(x, d / 2, z) for x, z in tri]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    base = mesh_obj('FULCRUM_base', verts, faces, M['pc_ignition'])
    bevel(base, 0.009, 4, angle=30)
    pivot = Vector((0, 0, h - 0.004))
    cyl('FULCRUM_pin', 0.009, d + 0.03, pivot, M['brass'], rot=(math.radians(90), 0, 0), bev=0.002)
    t = math.radians(tilt)
    plank_c = pivot + Vector((0, 0, 0.021))
    box('FULCRUM_plank', (0.56, 0.075, 0.022), plank_c, M['wood'], bev=0.004, rot=(0, t, 0))
    for s in (-1, 1):
        off = Vector((s * 0.29 * math.cos(t), 0, -s * 0.29 * math.sin(t)))
        box('FULCRUM_cap', (0.035, 0.08, 0.03), plank_c + off, M['pc_graphite'], bev=0.006, rot=(0, t, 0))
    return group('FULCRUM')


def motor(port_dir=(0, -1, 0), with_cog=True):
    L, H = 0.2, 0.13
    cz = H / 2 + 0.012
    for s in (-1, 1):
        box('MOTOR_cap', (0.034, H, H), (s * (L / 2 - 0.017), 0, cz), M['pc_graphite'], bev=0.013, seg=5)
        box('MOTOR_foot', (0.03, 0.1, 0.012), (s * (L / 2 - 0.017), 0, 0.006), M['rubber'], bev=0.003)
    box('MOTOR_shell', (L - 0.05, H * 0.92, H * 0.92), (0, 0, cz), M['poly'], bev=0.012, seg=5)
    cyl('MOTOR_core', 0.036, 0.11, (0, 0, cz), M['steel'], rot=(0, math.radians(90), 0), bev=0.002)
    for i in range(14):
        x = -0.048 + i * 0.0074
        torus('MOTOR_winding', 0.039, 0.0034, (x, 0, cz), M['copper'], rot=(0, math.radians(90), 0), minor=10)
    for s in (-1, 1):
        box('MOTOR_magnet', (0.1, 0.07, 0.012), (0, 0, cz + s * 0.048), M['pc_ignition'], bev=0.003)
    cyl('MOTOR_shaft', 0.006, 0.34, (0.06, 0, cz), M['chrome'], rot=(0, math.radians(90), 0), bev=0.001)
    port_ring('MOTOR_port', (-(L / 2 - 0.017), -H / 2 - 0.001, cz), port_dir, 'power', R=0.02)
    sphere('MOTOR_status', 0.0055, (L / 2 - 0.017, -0.035, cz + H / 2), M['led_power'], segs=32, rings=16)
    box('MOTOR_badge', (0.05, 0.002, 0.016), (L / 2 - 0.017, -H / 2 - 0.0005, cz - 0.03), M['pc_bone'], bev=0.0008,
        seg=2)
    cog = None
    if with_cog:
        cog, _ = gear('MOTOR_cog', 14, 0.006, 0.014, M['anod_volt'])
        cog.location = (0.17, 0, cz)
        cog.rotation_euler = (0, math.radians(90), 0)
    return group('MOTOR'), cz


def gale():
    cyl('GALE_base', 0.065, 0.016, (0, 0, 0.008), M['pc_graphite'], bev=0.006)
    cyl('GALE_stem', 0.008, 0.15, (0, 0.0, 0.09), M['steel'], bev=0.001)
    head = Vector((0, 0, 0.2))
    fwd = Vector((0, -1, 0))
    rot = euler_to(fwd)
    torus('GALE_housing', 0.095, 0.013, head, M['pc_ignition'], rot=rot)
    cyl('GALE_pod', 0.03, 0.06, head + Vector((0, 0.035, 0)), M['pc_graphite'], rot=rot, bev=0.008)
    for rr in (0.035, 0.065, 0.093):
        torus('GALE_grill', rr, 0.0014, head + fwd * 0.012, M['steel'], rot=rot, minor=8)
    for k in range(10):
        a = 2 * math.pi * k / 10
        p = head + fwd * 0.012 + Vector((math.cos(a) * 0.05, 0, math.sin(a) * 0.05))
        cyl('GALE_spoke', 0.0011, 0.09, p, M['steel'], rot=(0, -a + math.pi / 2, 0), verts=12, bev=0)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        p = head + Vector((math.cos(a) * 0.045, -0.002, math.sin(a) * 0.045))
        box('GALE_blade', (0.07, 0.004, 0.034), p, M['poly_amber'], bev=0.0015, seg=3,
            rot=(math.radians(25), -a, 0))
    sphere('GALE_hub', 0.017, head + fwd * 0.004, M['pc_graphite'], segs=48, rings=24)
    port_ring('GALE_port', (0, -0.062, 0.009), (0, -1, 0.15), 'power', R=0.011)
    return group('GALE')


def bangstick(lit=False):
    r, L = 0.019, 0.17
    rows = [(-0.0195, r), (0.0195, r), (0.0, r + 0.0338)]
    for i, (y, z) in enumerate(rows):
        cyl(f'BANGSTICK_stick{i}', r, L, (0, y, z), M['paper_red'], rot=(0, math.radians(90), 0), bev=0.002)
        for s in (-1, 1):
            cyl('BANGSTICK_end', r * 0.86, 0.004, (s * L / 2, y, z), M['paper_tan'], rot=(0, math.radians(90), 0),
                bev=0.0008, seg=2)
    centroid_z = (2 * r + r + 0.0338) / 3
    for x in (-0.045, 0.045):
        cyl('BANGSTICK_tape', 0.0435, 0.014, (x, 0, centroid_z), M['pc_graphite'], rot=(0, math.radians(90), 0),
            bev=0.002)
    box('BANGSTICK_label', (0.05, 0.002, 0.018), (0, -0.0385, centroid_z + 0.004), M['pc_bone'], bev=0.0008, seg=2,
        rot=(math.radians(-25), 0, 0))
    top = rows[2]
    tip = Vector((0.13, 0.05, 0.12))
    curve('BANGSTICK_fuse', [(L / 2 - 0.004, top[0], top[1]), (L / 2 + 0.03, 0.0, top[1] + 0.01),
                             (0.13, 0.015, 0.09), tuple(tip)], 0.0019, M['fuse'])
    port_ring('BANGSTICK_port', (-L / 2 - 0.001, 0, centroid_z), (-1, 0, 0), 'signal', R=0.011)
    if lit:
        sparks(tip)
    return group('BANGSTICK'), tip


def sparks(at, n=70, seed=7):
    rnd = random.Random(seed)
    at = Vector(at)
    sphere('spark_core', 0.0045, at, M['spark_hot'], segs=24, rings=12)
    sphere('spark_glow', 0.009, at, M['spark'], segs=24, rings=12)
    for i in range(n):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 1.3))).normalized()
        length = rnd.uniform(0.008, 0.05)
        dist = rnd.uniform(0.004, 0.06)
        mid = at + d * (dist + length / 2)
        cyl('spark_streak', 0.0005, length, mid, M['spark'] if rnd.random() < 0.7 else M['spark_hot'],
            rot=euler_to(d), verts=8, bev=0)
    for i in range(18):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 0.6))).normalized()
        sphere('ember', rnd.uniform(0.0008, 0.0016), at + d * rnd.uniform(0.04, 0.12), M['ember'], segs=8, rings=4)
    point('spark_light', at, 6.0, (1.0, 0.62, 0.3), radius=0.004)


def the_button(pressed=False):
    cyl('BUTTON_base', 0.055, 0.032, (0, 0, 0.016), M['pc_graphite'], bev=0.008, seg=5)
    torus('BUTTON_collar', 0.041, 0.006, (0, 0, 0.033), M['steel'])
    torus('BUTTON_led', 0.0475, 0.0022, (0, 0, 0.0325), M['led_signal'], minor=12)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=0.036,
                                         location=(0, 0, 0.033 + (0.002 if pressed else 0.008)))
    cap = _active()
    cap.scale = (1, 1, 0.55)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(cap, M['pc_ignition_gloss'])
    smooth(cap)
    _track(cap)
    port_ring('BUTTON_port', (0, -0.055, 0.016), (0, -1, 0), 'signal', R=0.01)
    return group('THE_BUTTON')


def dusty():
    cyl('DUSTY_body', 0.17, 0.052, (0, 0, 0.034), M['pc_bone'], bev=0.014, seg=5)
    cyl('DUSTY_lid', 0.125, 0.008, (0, 0.012, 0.061), M['pc_graphite'], bev=0.003)
    torus('DUSTY_bumper', 0.171, 0.012, (0, 0, 0.03), M['rubber'], minor=16)
    for s in (-1, 1):
        box('DUSTY_eye', (0.026, 0.012, 0.006), (s * 0.036, -0.105, 0.061), M['eye'], bev=0.0028, seg=3)
    box('DUSTY_brow', (0.11, 0.022, 0.003), (0, -0.104, 0.0605), M['pc_graphite'], bev=0.001, seg=2)
    port_ring('DUSTY_port', (0, 0.1, 0.064), (0, 0, 1), 'power', R=0.012)
    cyl('DUSTY_brush', 0.022, 0.006, (0.12, -0.08, 0.006), M['pc_ignition'], bev=0.002)
    return group('DUSTY')


def cog_pair(phase_a=0.0):
    a, ra = gear('COG_A', 18, 0.0055, 0.016, M['anod_cobalt'], phase=phase_a)
    b, rb = gear('COG_B', 12, 0.0055, 0.016, M['anod_volt'], phase=math.pi / 12 + phase_a)
    a.location = (0, 0, 0.012)
    b.location = (ra + rb, 0, 0.012)
    for x, r in ((0, ra), (ra + rb, rb)):
        cyl('COG_plinth', 0.022, 0.006, (x, 0, 0.003), M['pc_graphite'], bev=0.002)
    return group('COG_pair')


def mains():
    box('MAINS_body', (0.13, 0.08, 0.075), (0, 0, 0.0375), M['pc_graphite'], bev=0.012, seg=5)
    box('MAINS_face', (0.11, 0.004, 0.05), (0, -0.04, 0.04), M['pc_bone'], bev=0.002, seg=3)
    box('MAINS_lever', (0.012, 0.012, 0.045), (-0.025, -0.05, 0.05), M['chrome'], bev=0.004, seg=3,
        rot=(math.radians(-30), 0, 0))
    box('MAINS_ledbar', (0.04, 0.003, 0.006), (0.03, -0.043, 0.055), M['led_power'], bev=0.001, seg=2)
    port_ring('MAINS_port', (0.066, 0, 0.04), (1, 0, 0), 'power', R=0.016)
    return group('MAINS')


def topple_tile(name, mat_band):
    box(name, (0.03, 0.075, 0.15), (0, 0, 0.075), M['pc_bone'], bev=0.004)
    box(name + '_band', (0.0312, 0.0762, 0.012), (0, 0, 0.1), mat_band, bev=0.002, seg=3)


# ---------------------------------------------------------------- scenes

def haze(density, size=(4, 4, 2), color=(0.8, 0.85, 1.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, size[2] / 2))
    ob = _active()
    ob.name = 'Haze'
    ob.scale = size
    m = bpy.data.materials.new('haze')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    v = nt.nodes.new('ShaderNodeVolumeScatter')
    v.inputs['Density'].default_value = density
    v.inputs['Color'].default_value = (*color, 1)
    nt.links.new(v.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
    assign(ob, m)
    CREATED.clear()


def scene_lineup(samples):
    setup_render(samples, world=(0.5, 0.5, 0.52), world_strength=0.3, exposure=-0.9)
    cyc(M['cyc_light'])
    # back row: Fulcrum carrying a Thud, Motor, Gale, Helio
    f = fulcrum(tilt=-12)
    f.location = (-0.5, 0.26, 0)
    t = thud()
    t.location = (-0.5 - 0.243, 0.26, 0.062)
    m, _ = motor()
    m.location = (-0.02, 0.3, 0)
    m.rotation_euler = (0, 0, math.radians(-10))
    g = gale()
    g.location = (0.36, 0.32, 0)
    g.rotation_euler = (0, 0, math.radians(-22))
    h = helio(height=0.44, anchor_offset=(-0.05, -0.05))
    h.location = (0.66, 0.36, 0)
    # front row: Boing, Bangstick, The Button, Dusty, Cogs
    boing().location = (-0.42, -0.16, 0)
    b, _ = bangstick()
    b.location = (-0.12, -0.2, 0)
    b.rotation_euler = (0, 0, math.radians(12))
    the_button().location = (0.11, -0.22, 0)
    d = dusty()
    d.location = (0.38, -0.12, 0)
    d.rotation_euler = (0, 0, math.radians(14))
    c = cog_pair()
    c.location = (0.62, -0.28, 0)
    c.rotation_euler = (0, 0, math.radians(-15))
    target = (0.02, 0.06, 0.2)
    area('Key', (-1.6, -1.5, 1.9), target, 420, 1.6)
    area('Fill', (1.9, -1.1, 0.9), target, 110, 2.0)
    area('Rim', (0.3, 1.8, 1.5), target, 380, 1.5, color=(0.86, 0.94, 1.0))
    area('Top', (0, 0.2, 2.8), target, 160, 3.0)
    camera((0.02, -1.95, 0.6), target, lens=42, fstop=7.1)


def scene_mechanism(samples):
    setup_render(samples, world=(0.012, 0.013, 0.016), world_strength=1.0, exposure=-0.4)
    cyc(M['cyc_dark'])
    m, cz = motor()
    cog_r = 0.006 * 14 / 2
    plate_x = 0.205
    # clock-movement style gear plate behind the train
    box('gear_plate', (0.01, 0.34, 0.36), (plate_x, -0.02, 0.18), M['pc_graphite'], bev=0.006)
    CREATED.clear()
    big, r_big = gear('COG_big', 24, 0.006, 0.016, M['anod_cobalt'], phase=math.pi / 24)
    big.location = (0.182, 0, cz + cog_r + r_big)
    big.rotation_euler = (0, math.radians(90), 0)
    small, r_small = gear('COG_small', 10, 0.006, 0.016, M['anod_plasma'], phase=0.13)
    a = math.radians(60)
    small.location = (0.182, -(r_big + r_small) * math.sin(a), big.location.z + (r_big + r_small) * math.cos(a))
    small.rotation_euler = (0, math.radians(90), 0)
    for ob in (big, small):
        cyl('axle_boss', 0.011, 0.024, (plate_x - 0.012, ob.location.y, ob.location.z), M['brass'],
            rot=(0, math.radians(90), 0), bev=0.002)
    port_ring('plate_port', (plate_x - 0.006, -0.15, 0.06), (-1, 0, 0), 'spin', R=0.016)
    CREATED.clear()
    mm = mains()
    mm.location = (-0.36, -0.06, 0)
    curve('power_cable', [(-0.293, -0.06, 0.04), (-0.24, -0.09, 0.012), (-0.15, -0.1, 0.012),
                          (-0.085, -0.075, cz)], 0.0045, M['rubber'])
    CREATED.clear()
    target = (0.02, 0, 0.1)
    area('Key', (-0.7, -0.75, 0.85), target, 120, 0.7, color=(0.95, 0.97, 1.0))
    area('Rim', (0.6, 0.55, 0.55), target, 150, 0.5, color=(0.55, 0.85, 1.0))
    area('Kick', (-0.5, 0.6, 0.25), target, 60, 0.4, color=(1.0, 0.6, 0.45))
    area('Top', (0, 0, 1.2), target, 40, 1.0)
    haze(0.05, size=(3, 3, 1.5))
    camera((-0.12, -0.9, 0.36), (0.07, 0.0, 0.13), lens=55, fstop=4.0, focus=0.92)


def scene_boom(samples):
    setup_render(samples, world=(0.008, 0.009, 0.012), world_strength=1.0)
    cyc(M['cyc_dark'])
    b, tip = bangstick(lit=True)
    b.location = (0.18, 0.02, 0)
    b.rotation_euler = (0, 0, math.radians(-8))
    bpy.context.view_layer.update()
    tip_world = b.matrix_world @ tip
    # Topple Tiles curving toward the charge; the front ones are mid-fall.
    n = 16
    for i in range(n):
        t = i / (n - 1)
        x = -0.9 + 0.95 * t
        y = 0.25 - 0.25 * math.sin(t * math.pi * 0.9)
        dy = -0.25 * math.pi * 0.9 * math.cos(t * math.pi * 0.9)
        yaw = math.atan2(dy, 0.95)
        fall = min(78.0, (i - (n - 7)) * 13.0) if i >= n - 6 else 0.0
        topple_tile(f'TILE{i}', M['pc_ignition'] if i % 2 else M['pc_cobalt'])
        g = group(f'TILE{i}_g')
        g.location = (x, y, 0)
        g.rotation_euler = (0, math.radians(fall), yaw)
    btn = the_button(pressed=True)
    btn.location = (-1.02, 0.36, 0)
    th = thud()
    th.location = (-1.0, 0.1, 0)
    target = (-0.1, 0.06, 0.08)
    area('Key', (-1.2, -1.4, 1.4), target, 90, 1.2, color=(0.75, 0.82, 1.0))
    area('Rim', (0.8, 1.2, 0.9), target, 120, 1.0, color=(0.5, 0.75, 1.0))
    point('spark_bounce', tip_world + Vector((0, -0.05, -0.05)), 2.0, (1.0, 0.5, 0.2), radius=0.05)
    haze(0.07, size=(4, 4, 1.5))
    camera((0.62, -1.02, 0.24), (-0.12, 0.08, 0.09), lens=40, fstop=2.8,
           focus=(Vector((0.62, -1.02, 0.24)) - tip_world).length)


def scene_materials(samples):
    setup_render(samples, world=(0.012, 0.013, 0.016), world_strength=1.0, exposure=-0.6)
    cyc(M['cyc_dark'])
    swatches = [
        ('IGNITION', 'pc_ignition'), ('VOLT', 'pc_volt'), ('COBALT', 'pc_cobalt'), ('PLASMA', 'pc_plasma'),
        ('BONE', 'pc_bone'),
        ('GRAPHITE', 'pc_graphite'), ('ANODIZED', 'anod_beam'), ('STEEL', 'steel'), ('BRASS', 'brass'),
        ('COPPER', 'copper'),
        ('POLYCARB', 'poly'), ('GLASS', 'glass'), ('RUBBER', 'rubber'), ('HARDWOOD', 'wood'), ('LED', 'led_power'),
    ]
    cols, sx, sy = 5, 0.2, 0.3
    for i, (name, key) in enumerate(swatches):
        r, c = divmod(i, cols)
        x = (c - (cols - 1) / 2) * sx
        y = (1 - r) * sy
        cyl('pedestal', 0.045, 0.03, (x, y, 0.015), M['pc_graphite'], bev=0.006)
        torus('pedestal_ring', 0.046, 0.0018, (x, y, 0.03), M['steel'], minor=8)
        if key == 'led_power':
            cyl('led_swatch', 0.045, 0.02, (x, y, 0.045), M['poly'], bev=0.006)
            torus('led_swatch_ring', 0.03, 0.008, (x, y, 0.06), M['led_power'])
            sphere('led_swatch_dot', 0.012, (x, y, 0.062), M['led_power'], segs=24, rings=12)
        elif key == 'wood':
            box('wood_swatch', (0.09, 0.09, 0.09), (x, y, 0.077), M['wood'], bev=0.012, seg=5)
        else:
            sphere('swatch', 0.05, (x, y, 0.08), M[key])
        label(name, (x, y - 0.085, 0.001), 0.022, M['label'], rot=(0, 0, 0))
        CREATED.clear()
    target = (0, 0.02, 0.05)
    area('Key', (-0.9, -0.9, 1.3), target, 160, 1.0)
    area('Rim', (0.7, 0.9, 0.8), target, 130, 1.0, color=(0.6, 0.85, 1.0))
    area('Top', (0, 0, 1.6), target, 90, 1.6)
    camera((0, -1.2, 1.3), (0, -0.02, 0.02), lens=45, fstop=8)


SCENE_FUNCS = {'lineup': scene_lineup, 'mechanism': scene_mechanism, 'boom': scene_boom,
               'materials': scene_materials}


def main():
    global FONT
    samples = 512 if QUALITY == 'final' else 64
    res = (1920, 1080) if QUALITY == 'final' else (960, 540)
    os.makedirs(PNG_DIR, exist_ok=True)
    os.makedirs(BLEND_DIR, exist_ok=True)
    for name in SCENES:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        CREATED.clear()
        font_path = 'C:/Windows/Fonts/segoeuib.ttf'
        FONT = bpy.data.fonts.load(font_path) if os.path.exists(font_path) else None
        build_materials()
        SCENE_FUNCS[name](samples)
        sc = bpy.context.scene
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(PNG_DIR, f'knockon_{name}.png')
        if QUALITY == 'final':
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND_DIR, f'knockon_{name}.blend'))
        bpy.ops.render.render(write_still=True)
        print('rendered', sc.render.filepath)


main()
