"""THE TINKER LAB key art (D78): a warm, maximal science classroom around a workbench machine, built from the
*exported* part glbs with tactile look-dev materials (_tactile.py), golden-hour light and depth of field.

It doubles as the look target for the in-engine renderer (D79): the engine frame is reviewed beside it.

Usage: blender -b --factory-startup -P tools/blender/render_tinker_lab.py -- <out.png> [--res 1920x1080]
       [--samples N] [--view hero|wide|lobby] [--no-volume] [--blend <save.blend>]
       [--check]  place and settle everything, print the overlap report, don't render
       [--strict] fail if any placed things interpenetrate
"""
import math
import os
import random
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import _tactile as tac  # noqa: E402
import render_lookdev as rl  # noqa: E402
from kn_tools import library, paths  # noqa: E402

BENCH_Z = 0.90          # bench top
MAT_Z = BENCH_Z + 0.004  # cutting mat top: the build surface
WALL_Y = 1.95           # back wall face
RNG = random.Random(7)


# ---------------------------------------------------------------------------------------------- helpers
def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_ob(name, me, mat=None):
    for p in me.polygons:
        p.use_smooth = False
    if mat:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def box(name, size, loc, mat=None, bevel=0.004, rot=(0, 0, 0)):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = mesh_ob(name, me, mat)
    ob.location, ob.rotation_euler = loc, rot
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width, m.segments, m.limit_method = bevel, 2, 'ANGLE'
    return ob


def cyl(name, r, h, loc, mat=None, verts=32, rot=(0, 0, 0), r2=None, bevel=0.002):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = mesh_ob(name, me, mat)
    for p in me.polygons:
        p.use_smooth = True
    ob.location, ob.rotation_euler = loc, rot
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width, m.segments, m.limit_method = bevel, 2, 'ANGLE'
    return ob


def sphere(name, r, loc, mat=None, scale=(1, 1, 1), seg=32):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = mesh_ob(name, me, mat)
    for p in me.polygons:
        p.use_smooth = True
    ob.location, ob.scale = loc, scale
    return ob


def text(name, body, loc, size, mat, font=None, rot=(math.radians(90), 0, 0), align='CENTER', extrude=0.0):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = align
    cu.extrude = extrude
    if font:
        cu.font = font
    ob = link(bpy.data.objects.new(name, cu))
    ob.location, ob.rotation_euler = loc, rot
    cu.materials.append(mat)
    return ob


def polyline(name, pts, radius, mat):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1.0)
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu))


def flat(name, hexcol, rough=0.6, metal=0.0, emit=None, strength=0.0, sss=0.0, transmission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = library.hexcol(hexcol, cap=0.9)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Subsurface Weight'].default_value = sss
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['Alpha'].default_value = alpha
    if emit:
        p.inputs['Emission Color'].default_value = library.hexcol(emit, cap=1.0)
        p.inputs['Emission Strength'].default_value = strength
    return m


def tactile(name, look, base, rough=0.5, **kw):
    spec = {'base': base, 'rough': rough}
    spec.update(kw)
    return tac.build(name, look, spec, kw.pop('axis', 'X') if 'axis' in kw else 'X')


# ---------------------------------------------------------------------------------------------- parts
def import_part(root, kind, loc, rot=(0, 0, 0), scale=1.0):
    """Import a part glb, keep LOD0 only, and drop it at loc (rotation in degrees). Returns the LOD0 root."""
    glb = os.path.join(root, 'assets', 'build', 'parts', kind, kind + '.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    lod0 = next((ob for ob in new if ob.name.startswith('LOD0')), None)
    keep = set()
    if lod0:
        stack = [lod0]
        while stack:
            o = stack.pop()
            keep.add(o)
            stack.extend(o.children)
    for ob in new:
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    lod0.name = 'part_' + kind
    lod0.location = loc
    lod0.rotation_mode = 'XYZ'  # the glTF importer leaves quaternions on
    lod0.rotation_euler = Euler([math.radians(a) for a in rot])
    lod0.scale = (scale, scale, scale)
    return lod0


def descendants(ob):
    out, stack = [], [ob]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def world_verts_with(ob_root, mat_key):
    bpy.context.view_layer.update()
    pts = []
    for o in descendants(ob_root):
        if o.type != 'MESH':
            continue
        idx = [i for i, s in enumerate(o.material_slots) if s.material and s.material.name.startswith(mat_key)]
        if not idx:
            continue
        for poly in o.data.polygons:
            if poly.material_index in idx:
                pts.extend(o.matrix_world @ o.data.vertices[v].co for v in poly.vertices)
    return pts


def import_mochi(root, loc, yaw, pose='idle'):
    glb = os.path.join(root, 'assets', 'build', 'parts', 'mochi', 'mochi.glb')
    if not os.path.exists(glb):
        return None
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [ob for ob in bpy.data.objects if ob not in before]
    arm = next(ob for ob in new if ob.type == 'ARMATURE')
    for ob in new:
        if ob.type == 'MESH' and ('__L' in ob.name or ob.find_armature() is not arm):
            bpy.data.objects.remove(ob, do_unlink=True)
    acts = [a for a in bpy.data.actions if a not in acts_before]
    act = next((a for a in acts if a.name.startswith('mochi__' + pose)), None)
    if act:
        arm.animation_data_create()
        arm.animation_data.action = act
        if hasattr(arm.animation_data, 'action_slot') and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    # keep the importer's Y-up -> Z-up turn on the armature, then place and yaw it
    arm.matrix_world = (Matrix.Translation(loc) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
                        @ arm.matrix_world.to_3x3().to_4x4())
    return arm



# ---------------------------------------------------------------------------------------------- contact
def world_mesh(objs):
    """Evaluated (modifiers, armature pose) world-space verts and polys of every mesh in objs."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in objs:
        if o.type != 'MESH':
            continue
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        base = len(verts)
        verts.extend(eo.matrix_world @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        eo.to_mesh_clear()
    return verts, polys


def meshes_of(ob):
    """The meshes that make up a placed thing: a part root's descendants, or an armature's skinned meshes."""
    if ob.type == 'ARMATURE':
        return [o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() is ob]
    return [o for o in descendants(ob) if o.type == 'MESH']


def settle(ob, supports, clearance=0.0005):
    """Drop (or lift) `ob` straight down until it rests on the nearest support surface below it.
    Three ray sets: the ob's vertices down, the supports' vertices up, and a 17 x 17 grid over the ob's footprint.
    Rays start 0.5 m outside, so a vertex already sunk into a support still finds the support's top face."""
    from mathutils.bvhtree import BVHTree
    sv, sp = world_mesh([m for s in supports for m in meshes_of(s)])
    tree = BVHTree.FromPolygons(sv, sp)
    verts, polys = world_mesh(meshes_of(ob))
    own = BVHTree.FromPolygons(verts, polys)
    gap = None
    down, up = Vector((0, 0, -1)), Vector((0, 0, 1))
    # the ob's vertices looking down at the supports ...
    for v in verts:
        hit, _, _, _ = tree.ray_cast(v + Vector((0, 0, 0.5)), down, 2.0)
        if hit is not None:
            g = v.z - hit.z
            gap = g if gap is None else min(gap, g)
    # ... and the supports' vertices looking up at the ob (a brick turned across another has no corner above it)
    lo = Vector([min(v[i] for v in verts) for i in range(3)])
    hi = Vector([max(v[i] for v in verts) for i in range(3)])
    for v in sv:
        if lo.x <= v.x <= hi.x and lo.y <= v.y <= hi.y and v.z <= hi.z:
            hit, _, _, _ = own.ray_cast(v - Vector((0, 0, 0.5)), up, 2.0)
            if hit is not None:
                g = hit.z - v.z
                gap = g if gap is None else min(gap, g)
    # ... and a grid over the footprint, for face-on-face contact where neither has a vertex over the other
    n = 16
    for i in range(n + 1):
        for j in range(n + 1):
            x, y = lo.x + (hi.x - lo.x) * i / n, lo.y + (hi.y - lo.y) * j / n
            bottom, _, _, _ = own.ray_cast(Vector((x, y, lo.z - 0.5)), up, 2.0)
            if bottom is None:
                continue
            top, _, _, _ = tree.ray_cast(Vector((x, y, bottom.z + 0.5)), down, 2.0)
            if top is not None:
                g = bottom.z - top.z
                gap = g if gap is None else min(gap, g)
    if gap is None:
        print('SETTLE', ob.name, 'no support below', len(sv), [s.name for s in supports],
              [m.name for s in supports for m in meshes_of(s)])
        return
    ob.location.z -= gap - clearance
    bpy.context.view_layer.update()
    if os.environ.get('KN_DEBUG'):
        print('SETTLE', ob.name, 'gap %.4f -> z %.4f' % (gap, ob.location.z))


def check_overlaps(things, tol=0.002):
    """Report every pair of placed things whose surfaces interpenetrate (triangle-level, after posing)."""
    from mathutils.bvhtree import BVHTree
    data = []
    for t in things:
        v, p = world_mesh(meshes_of(t))
        if not v:
            continue
        lo = Vector([min(x[i] for x in v) for i in range(3)])
        hi = Vector([max(x[i] for x in v) for i in range(3)])
        data.append((t.name, BVHTree.FromPolygons(v, p, epsilon=0.0), lo, hi))
    bad = []
    for i in range(len(data)):
        for j in range(i + 1, len(data)):
            a, b = data[i], data[j]
            if any(a[2][k] > b[3][k] - tol or b[2][k] > a[3][k] - tol for k in range(3)):
                continue
            n = len(a[1].overlap(b[1]))
            if n:
                bad.append((a[0], b[0], n))
    for a, b, n in bad:
        print('OVERLAP %s x %s: %d triangle pairs' % (a, b, n))
    print('OVERLAP check: %d pairs intersect' % len(bad))
    return bad


# ---------------------------------------------------------------------------------------------- set
def build_room(fonts):
    M = {
        'floor': tactile('env_floor', 'wood', '#7A5236', 0.5, wood=('#5A3A24', '#8E6240'), axis='X'),
        'plaster': tactile('env_plaster', 'paper', '#E9DCC3', 0.85),
        'wainscot': tactile('env_wainscot', 'enamel', '#4F6F5E', 0.55),
        'trim': tactile('env_trim', 'wood', '#9A6A42', 0.5, wood=('#7A4E2E', '#B0804F'), axis='X'),
        'slate': tactile('env_slate', 'paper', '#26392F', 0.92),
        'chalk': flat('env_chalk', '#F1EEE4', 0.95, emit='#F1EEE4', strength=0.15),
        'chalk_y': flat('env_chalk_y', '#F2D46B', 0.95, emit='#F2D46B', strength=0.12),
        'blueprint': tactile('env_blueprint', 'paper', '#21508F', 0.85),
        'bp_ink': flat('env_bp_ink', '#DCE9F7', 0.9, emit='#DCE9F7', strength=0.1),
        'poster': tactile('env_poster', 'paper', '#E8D9B5', 0.85),
        'ceiling': tactile('env_ceiling', 'paper', '#D8CBB2', 0.9),
        'glass': flat('env_window_glass', '#FFFFFF', 0.02, transmission=1.0),
        'sky': flat('env_sky', '#FFE2B0', 1.0, emit='#FFD9A0', strength=5.5),
        'tree': flat('env_tree', '#5C8A3E', 1.0, emit='#7FA65A', strength=1.4),
        'cork': tactile('env_cork', 'paper', '#B88A5A', 0.95),
    }
    # floor, ceiling, walls (the back wall is built around two tall windows on the right)
    box('floor', (9, 7, 0.1), (0, 0, -0.05), M['floor'], bevel=0)
    box('ceiling', (9, 7, 0.1), (0, 0, 3.25), M['ceiling'], bevel=0)
    wy = WALL_Y + 0.075
    win = [(1.75, 2.75), (3.05, 4.05)]  # window x spans
    sill, head = 1.0, 2.85
    xs = [-4.5] + [v for w in win for v in w] + [4.5]
    for a, b in zip(xs[0::2], xs[1::2]):
        box('wall_%.1f' % a, (b - a, 0.15, 3.2), ((a + b) / 2, wy, 1.6), M['plaster'], bevel=0)
    for a, b in win:
        box('wall_low_%.1f' % a, (b - a, 0.15, sill), ((a + b) / 2, wy, sill / 2), M['plaster'], bevel=0)
        box('wall_high_%.1f' % a, (b - a, 0.15, 3.2 - head), ((a + b) / 2, wy, (head + 3.2) / 2), M['plaster'], bevel=0)
        # frame, mullions, sill
        box('sill_%.1f' % a, (b - a + 0.16, 0.24, 0.05), ((a + b) / 2, WALL_Y - 0.04, sill), M['trim'])
        for x in (a, b):
            box('jamb', (0.06, 0.18, head - sill), (x, WALL_Y + 0.02, (sill + head) / 2), M['trim'])
        box('head', (b - a + 0.12, 0.18, 0.08), ((a + b) / 2, WALL_Y + 0.02, head), M['trim'])
        box('mull_v', (0.035, 0.06, head - sill), ((a + b) / 2, WALL_Y + 0.07, (sill + head) / 2), M['trim'])
        for z in (sill + (head - sill) / 3, sill + 2 * (head - sill) / 3):
            box('mull_h', (b - a, 0.06, 0.035), ((a + b) / 2, WALL_Y + 0.07, z), M['trim'])
    # outside: a warm sky card and soft tree blobs
    box('sky_card', (14, 0.05, 7), (2.5, 6.5, 2.0), M['sky'], bevel=0).visible_shadow = False
    for i in range(14):
        sphere('tree', RNG.uniform(0.7, 1.4), (RNG.uniform(0.8, 6.0), RNG.uniform(4.0, 6.0), RNG.uniform(0.6, 2.4)),
               M['tree'], scale=(1, 0.6, 0.9), seg=16).visible_shadow = False
    # wainscot, chair rail and skirting along the back wall
    box('wainscot', (9, 0.03, 0.95), (0, WALL_Y - 0.015, 0.475), M['wainscot'], bevel=0.002)
    box('rail', (9, 0.05, 0.05), (0, WALL_Y - 0.03, 0.97), M['trim'])
    # side walls
    box('wall_left', (0.15, 7, 3.2), (-3.9, 0, 1.6), M['plaster'], bevel=0)
    box('wall_right', (0.15, 7, 3.2), (4.5, 0, 1.6), M['plaster'], bevel=0)

    # chalkboard
    cx, cz, cw, ch = 0.45, 1.85, 2.3, 1.15
    box('chalk_frame', (cw + 0.1, 0.05, ch + 0.1), (cx, WALL_Y - 0.03, cz), M['trim'])
    box('chalkboard', (cw, 0.03, ch), (cx, WALL_Y - 0.05, cz), M['slate'], bevel=0.001)
    box('chalk_tray', (cw + 0.1, 0.07, 0.025), (cx, WALL_Y - 0.09, cz - ch / 2 - 0.03), M['trim'])
    fy = WALL_Y - 0.068
    text('chalk_t1', 'EVERY ACTION HAS AN', (cx - 0.15, fy, cz + 0.12), 0.08, M['chalk'], fonts['sym'])
    text('chalk_t2', 'OVERREACTION!', (cx - 0.15, fy, cz - 0.02), 0.1, M['chalk_y'], fonts['sym'])
    text('chalk_eq', 'F = m · a   →   KABOOM', (cx - 0.45, fy, cz - 0.2), 0.055, M['chalk'], fonts['sym'])
    text('chalk_eq2', 'Δt  ≈  0.42 s', (cx - 0.55, fy, cz - 0.31), 0.045, M['chalk'], fonts['sym'])
    # a chalk ramp + ball + domino diagram on the right of the board
    bx = cx + 0.55
    polyline('chalk_ramp', [(bx - 0.05, fy, cz + 0.02), (bx + 0.35, fy, cz - 0.2), (bx + 0.55, fy, cz - 0.2)], 0.004,
             M['chalk'])
    for i in range(6):
        x = bx + 0.6 + i * 0.05
        lean = min(i, 3) * 0.012
        polyline('chalk_dom', [(x, fy, cz - 0.2), (x + lean, fy, cz - 0.1)], 0.004, M['chalk'])
    ang = [i / 24 * 2 * math.pi for i in range(25)]
    polyline('chalk_ball', [(bx + 0.05 + 0.05 * math.cos(a), fy, cz + 0.07 + 0.05 * math.sin(a)) for a in ang],
             0.004, M['chalk'])
    polyline('chalk_arrow', [(bx + 0.12, fy, cz + 0.12), (bx + 0.3, fy, cz + 0.02), (bx + 0.27, fy, cz + 0.06)], 0.003,
             M['chalk_y'])

    # blueprint poster (left of the board) with a rocket-ish part diagram
    px, pz = -1.5, 1.9
    box('blueprint', (1.0, 0.012, 1.3), (px, WALL_Y - 0.02, pz), M['blueprint'], bevel=0)
    by = WALL_Y - 0.03
    text('bp_title', 'BUILD  RUN  REWIND', (px, by, pz + 0.5), 0.06, M['bp_ink'], fonts['sym'])
    for i in range(7):
        polyline('bp_grid_h', [(px - 0.45, by, pz - 0.55 + i * 0.15), (px + 0.45, by, pz - 0.55 + i * 0.15)], 0.0012,
                 M['bp_ink'])
    for i in range(7):
        polyline('bp_grid_v', [(px - 0.45 + i * 0.15, by, pz - 0.55), (px - 0.45 + i * 0.15, by, pz + 0.38)], 0.0012,
                 M['bp_ink'])
    ring = [i / 32 * 2 * math.pi for i in range(33)]
    for r in (0.26, 0.18, 0.06):
        polyline('bp_cog', [(px + r * math.cos(a), by, pz - 0.08 + r * math.sin(a)) for a in ring], 0.003, M['bp_ink'])
    for i in range(12):
        a = i / 12 * 2 * math.pi
        polyline('bp_tooth', [(px + 0.26 * math.cos(a), by, pz - 0.08 + 0.26 * math.sin(a)),
                              (px + 0.32 * math.cos(a), by, pz - 0.08 + 0.32 * math.sin(a))], 0.006, M['bp_ink'])
    text('bp_note', 'COG · L   ⌀ 310', (px, by, pz - 0.5), 0.04, M['bp_ink'], fonts['sym'])

    # small posters and a cork board
    box('poster_a', (0.42, 0.01, 0.58), (-2.55, WALL_Y - 0.015, 2.0), M['poster'], bevel=0)
    text('poster_a_t', 'SAFETY\nFIRST*', (-2.55, WALL_Y - 0.022, 2.12), 0.07, flat('ink_r', '#C7442E', 0.8),
         fonts['display'])
    text('poster_a_s', '*then fuses', (-2.55, WALL_Y - 0.022, 1.82), 0.035, flat('ink_g', '#3A3E47', 0.8), fonts['ui'])
    box('cork', (0.9, 0.03, 0.6), (-2.6, WALL_Y - 0.02, 1.35), M['cork'], bevel=0.002)
    for i in range(7):
        col = RNG.choice(['#F2E6B8', '#F7C5C0', '#C9E4F2', '#D9F2C2', '#FFFFFF'])
        x, z = -2.95 + (i % 4) * 0.22 + RNG.uniform(-0.03, 0.03), 1.5 - (i // 4) * 0.27 + RNG.uniform(-0.03, 0.03)
        box('note', (0.15, 0.004, 0.15), (x, WALL_Y - 0.04, z), flat('note_%d' % i, col, 0.85), bevel=0,
            rot=(0, math.radians(RNG.uniform(-8, 8)), 0))
        sphere('pin', 0.008, (x, WALL_Y - 0.045, z + 0.06), flat('pin_%d' % i, RNG.choice(['#FF5B2E', '#2FD6FF', '#FFB020']),
                                                               0.3), seg=12)
    return M


def fill_shelf(M, x0, x1, z, y, plants=0):
    """Books, jars, beakers and the odd plant along a shelf from x0 to x1 at height z (top surface)."""
    x = x0
    while x < x1:
        kind = RNG.random()
        if plants and kind > 0.93:
            plant((x + 0.07, y, z), 0.06, 0.24, n=8)
            x += 0.18
        elif kind < 0.62:  # a run of books
            for _ in range(RNG.randint(3, 8)):
                w, h = RNG.uniform(0.025, 0.055), RNG.uniform(0.18, 0.3)
                col = RNG.choice(['#8E3B2F', '#2F5D7E', '#C9A04A', '#3E6B4B', '#6B4A7A', '#D8C9A6', '#B8562E',
                                  '#2E3A55'])
                lean = math.radians(RNG.choice([0, 0, 0, 0, 5]))
                box('book', (w, 0.18, h), (x + w / 2, y, z + h / 2),
                    tactile('book_%d' % RNG.randrange(99999), 'paper', col, 0.7), bevel=0.003, rot=(0, lean, 0))
                x += w + 0.003
            x += 0.04
        elif kind < 0.86:  # a jar with something coloured inside
            r, h = RNG.uniform(0.04, 0.065), RNG.uniform(0.12, 0.2)
            cyl('jar', r, h, (x + r, y, z + h / 2), M['glass'], verts=24)
            cyl('jar_fill', r * 0.9, h * 0.55, (x + r, y, z + 0.005 + h * 0.275),
                flat('fill', RNG.choice(['#E8B04A', '#7FBF6A', '#C95A3A', '#5A8FD8', '#F2E6B8']), 0.4, sss=0.3),
                verts=24)
            cyl('jar_lid', r * 1.02, 0.02, (x + r, y, z + 0.01 + h), tactile('lid', 'patina', '#E3B261', 0.3), verts=24)
            x += 2 * r + 0.03
        else:  # a beaker or flask
            r, h = 0.045, RNG.uniform(0.1, 0.16)
            cyl('beaker', r, h, (x + r, y, z + h / 2), M['glass'], verts=24, r2=RNG.choice([r, r * 0.45]))
            x += 2 * r + 0.03


def build_shelves(M):
    """Tall shelf unit left of the windows (x 1.0..1.65 is the board margin, so use the left wall run)."""
    wood = M['trim']
    sx, sw = -3.15, 1.3
    for i, z in enumerate((0.35, 0.85, 1.35, 1.85, 2.35)):
        box('shelf', (sw, 0.32, 0.03), (sx, WALL_Y - 0.17, z), wood)
        if i == 4:
            continue
        fill_shelf(M, sx - sw / 2 + 0.05, sx + sw / 2 - 0.12, z + 0.015, WALL_Y - 0.2)
    # a long wall shelf behind the bench (the clutter ring the camera sees through the depth of field)
    box('wall_shelf', (3.9, 0.24, 0.03), (-0.35, WALL_Y - 0.13, 1.06), wood)
    for x in (-2.1, -0.35, 1.4):
        box('bracket', (0.03, 0.2, 0.12), (x, WALL_Y - 0.12, 0.99), tactile('bracket', 'enamel', '#3A3E47', 0.4))
    fill_shelf(M, -2.25, 1.5, 1.075, WALL_Y - 0.14, plants=1)
    for x in (2.0, 2.45, 3.35, 3.8):
        plant((x, WALL_Y - 0.05, 1.025), RNG.uniform(0.06, 0.08), RNG.uniform(0.22, 0.36))
    # a globe on top
    gx, gz = sx + 0.35, 2.37
    cyl('globe_base', 0.07, 0.03, (gx, WALL_Y - 0.18, gz + 0.015), tactile('globe_base', 'wood', '#5E3F2A', 0.4,
                                                                           wood=('#4A2E1F', '#7A5236')))
    cyl('globe_stem', 0.008, 0.08, (gx, WALL_Y - 0.18, gz + 0.07), tactile('globe_stem', 'patina', '#E3B261', 0.3))
    sphere('globe', 0.13, (gx, WALL_Y - 0.18, gz + 0.24), tactile('globe', 'paper', '#5C8FB0', 0.5))
    # a plant on top
    plant((sx - 0.35, WALL_Y - 0.18, 2.365), 0.08, 0.35)


def plant(base, r, h, n=11):
    pot = cyl('pot', r, r * 1.6, (base[0], base[1], base[2] + r * 0.8), tactile('pot', 'ceramic', '#C2643E', 0.4),
              verts=24, r2=r * 0.78)
    pot.rotation_euler = (math.pi, 0, 0)
    leaf = flat('leaf_%d' % RNG.randrange(9999), RNG.choice(['#3E7D3A', '#4F8F3C', '#5E9E45']), 0.45, sss=0.15)
    for i in range(n):
        a = i / n * 2 * math.pi + RNG.uniform(-0.2, 0.2)
        tilt = RNG.uniform(0.3, 1.0)
        L = h * RNG.uniform(0.5, 1.0)
        ob = sphere('leaf', 1.0, (base[0], base[1], base[2] + r * 1.5), leaf, scale=(L * 0.5, L * 0.14, 0.012), seg=16)
        ob.rotation_euler = (0, -tilt, a)
        ob.location = Vector(base) + Vector((math.cos(a) * L * 0.4 * math.sin(tilt), math.sin(a) * L * 0.4 * math.sin(tilt),
                                             r * 1.5 + L * 0.35 * math.cos(tilt)))


def build_bench(M):
    oak = tactile('bench_top', 'wood', '#B8834E', 0.45, wood=('#9C6A3C', '#BE8A55'), axis='X')
    leg = tactile('bench_leg', 'wood', '#7A5236', 0.5, wood=('#5A3A24', '#8E6240'), axis='Z')
    box('bench_top', (3.0, 1.0, 0.07), (0, 0, BENCH_Z - 0.035), oak, bevel=0.006)
    for x in (-1.35, 1.35):
        for y in (-0.4, 0.4):
            box('bench_leg', (0.08, 0.08, BENCH_Z - 0.07), (x, y, (BENCH_Z - 0.07) / 2), leg)
    box('bench_rail', (2.7, 0.05, 0.08), (0, 0.4, 0.2), leg)
    box('bench_shelf', (2.7, 0.8, 0.03), (0, 0, 0.18), oak)
    # cutting mat: the clean build zone
    mat = bpy.data.materials.new('cutting_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    grid = nt.nodes.new('ShaderNodeTexBrick')
    grid.inputs['Scale'].default_value = 1.0
    grid.inputs['Mortar Size'].default_value = 0.006
    grid.inputs['Mortar Smooth'].default_value = 0.0
    grid.inputs['Bias'].default_value = 0.0
    grid.inputs['Brick Width'].default_value = 0.1
    grid.inputs['Row Height'].default_value = 0.1
    grid.offset = 0.0
    grid.inputs['Color1'].default_value = library.hexcol('#2E5E52')
    grid.inputs['Color2'].default_value = library.hexcol('#2B584D')
    grid.inputs['Mortar'].default_value = library.hexcol('#8FB8A8')
    nt.links.new(tc.outputs['Object'], grid.inputs['Vector'])
    nt.links.new(grid.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.7
    box('cutting_mat', (2.3, 0.82, 0.004), (0.05, -0.02, BENCH_Z + 0.002), mat, bevel=0.001)
    # clutter ring on the bench: mug, pencil cup, books, ruler, screws, a plant
    mug_m = tactile('mug', 'ceramic', '#E8E2D6', 0.2)
    cyl('mug', 0.045, 0.1, (1.38, -0.02, BENCH_Z + 0.05), mug_m, verts=32)
    cyl('mug_coffee', 0.04, 0.005, (1.38, -0.02, BENCH_Z + 0.092), flat('coffee', '#3B2416', 0.15), verts=32)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.028, minor_radius=0.008, location=(1.43, -0.02, BENCH_Z + 0.05),
                                     rotation=(math.radians(90), 0, 0))
    h = bpy.context.active_object
    h.data.materials.append(mug_m)
    cyl('pencil_cup', 0.035, 0.11, (1.3, 0.32, BENCH_Z + 0.055), tactile('pcup', 'enamel', '#3355FF', 0.4), verts=24)
    for i in range(5):
        pc = cyl('pencil', 0.004, 0.18, (1.3 + RNG.uniform(-0.015, 0.015), 0.32 + RNG.uniform(-0.015, 0.015),
                                        BENCH_Z + 0.14), flat('pencil_%d' % i, RNG.choice(['#FFB020', '#FF5B2E',
                                                                                          '#2FD6FF', '#C6FF3A']), 0.5),
                 verts=6, rot=(RNG.uniform(-0.25, 0.25), RNG.uniform(-0.25, 0.25), 0))
    for i, (col, hgt) in enumerate((('#8E3B2F', 0.035), ('#2F5D7E', 0.03), ('#C9A04A', 0.04))):
        box('bench_book', (0.24, 0.17, hgt), (1.3, -0.34, BENCH_Z + 0.02 + sum(x for _, x in
                                                                               (('', 0.035), ('', 0.03), ('', 0.04))[:i])
                                               + hgt / 2), tactile('bb%d' % i, 'paper', col, 0.7),
            rot=(0, 0, math.radians(RNG.uniform(-12, 12))))
    box('ruler', (0.5, 0.035, 0.004), (0.2, -0.47, BENCH_Z + 0.002), tactile('ruler', 'wood', '#D7A86E', 0.4),
        rot=(0, 0, math.radians(4)))
    for i in range(6):
        cyl('screw', 0.004, 0.02, (-0.95 + RNG.uniform(-0.1, 0.1), -0.45 + RNG.uniform(-0.03, 0.03), BENCH_Z + 0.004),
            tactile('screw', 'steel', '#C9CDD3', 0.25), verts=8, rot=(math.radians(90), 0, RNG.uniform(0, 3)))
    plant((-1.3, 0.35, BENCH_Z), 0.07, 0.3)


def build_lamps(M, xs):
    shade = tactile('lamp_shade', 'enamel', '#2F6B57', 0.4)
    inner = flat('lamp_inner', '#FFF4E0', 0.5)
    bulb = flat('lamp_bulb', '#FFE7B8', 0.2, emit='#FFD08A', strength=40.0)
    cord = flat('lamp_cord', '#1C1E22', 0.6)
    for (x, y, z) in xs:
        cyl('cord', 0.004, 3.25 - z, (x, y, (3.25 + z) / 2 + 0.12), cord, verts=8, bevel=0)
        cyl('shade', 0.2, 0.18, (x, y, z), shade, verts=48, r2=0.05)
        cyl('shade_in', 0.195, 0.17, (x, y, z - 0.004), inner, verts=48, r2=0.045)
        sphere('bulb', 0.045, (x, y, z - 0.07), bulb)
        ld = bpy.data.lights.new('lamp', 'POINT')
        ld.energy, ld.shadow_soft_size = 70, 0.05
        ld.color = (1.0, 0.78, 0.52)
        lo = link(bpy.data.objects.new('lamp', ld))
        lo.location = (x, y, z - 0.1)


# ---------------------------------------------------------------------------------------------- machine
def build_machine(root):
    """Place the machine, then settle every resting part onto what holds it up (no floating, no sinking)."""
    Z = MAT_Z
    mat = bpy.data.objects['cutting_mat']
    P = {}

    def put(key, kind, loc, rot=(0, 0, 0), on=None):
        P[key] = import_part(root, kind, loc, rot)
        if on is not None:
            settle(P[key], on)
        return P[key]

    # brick tower + tilted slope + THUD at the top
    put('brik1', 'brik', (-0.98, -0.02, Z + 0.1), on=[mat])
    put('brik2', 'brik', (-0.98, -0.02, Z + 0.25), (0, 0, 90), on=[P['brik1']])
    put('brik3', 'brik', (-0.98, -0.02, Z + 0.4), on=[P['brik2']])
    put('slope', 'slope', (-0.72, -0.02, Z + 0.3), (0, 31, 0), on=[mat, P['brik3']])
    put('thud', 'thud', (-0.9, -0.02, Z + 0.7), (0, 0, 30), on=[P['slope'], P['brik3']])
    # conveyor and dominoes running to the button
    put('treadway', 'treadway', (-0.05, -0.04, Z + 0.1), on=[mat])
    # dominoes: the first two already falling, each leaning on the next
    xs = [0.34, 0.405, 0.465] + [0.465 + 0.05 * k for k in range(1, 7)]
    leans = [16, 7] + [0] * 7
    for i, (x, lean) in enumerate(zip(xs, leans)):
        t = (x - xs[0]) / (xs[-1] - xs[0])
        y = -0.04 - 0.2 * t * t
        yaw = math.degrees(math.atan2(-0.4 * t, 1.0)) if i else 0
        put('tile%d' % i, 'topple_tile', (x, y, Z + 0.2), (0, lean, yaw), on=[mat])
    put('button', 'the_button', (0.86, -0.3, Z + 0.1), (0, 0, 20), on=[mat])
    # power + gear train on a standing plate at the back
    put('mains', 'mains', (0.95, 0.24, Z + 0.1), (0, 0, -25), on=[mat])
    put('motor', 'motor', (0.42, 0.26, Z + 0.1), (0, 0, 180), on=[mat])
    put('plate', 'ledge', (-0.08, 0.36, Z + 0.4), (90, 0, 0), on=[mat])
    put('cog_l', 'cog_l', (-0.16, 0.274, Z + 0.24))
    put('cog_m', 'cog_m', (0.08, 0.274, Z + 0.33))
    put('cog_s', 'cog_s', (0.12, 0.274, Z + 0.15))
    # a fan blowing at a balloon tied to the bench
    put('gale', 'gale', (0.62, 0.05, Z + 0.1), (0, 0, -60), on=[mat])
    put('helio', 'helio', (0.98, -0.02, Z + 0.62), (0, 8, 0))
    # the finale: a bangstick with its fuse fizzing
    put('bang', 'bangstick', (1.04, -0.13, Z + 0.2), (0, 0, 160), on=[mat])
    put('fulcrum', 'fulcrum', (-0.55, -0.34, Z + 0.2), (0, 0, 8), on=[mat])
    put('boing', 'boing', (-0.36, -0.35, Z + 0.5), on=[P['fulcrum'], mat])
    return P


def fuse_spark(bang):
    pts = world_verts_with(bang, 'kn_fuse_cord')
    if not pts:
        return
    tip = max(pts, key=lambda p: (p - bang.matrix_world.translation).length)
    hot = flat('spark_core', '#FFC870', 0.5, emit='#FFC870', strength=60.0)
    streak = flat('spark_streak', '#FF8A2A', 0.5, emit='#FF8A2A', strength=30.0)
    sphere('spark_core', 0.008, tip, hot, seg=12)
    for i in range(26):
        d = Vector((RNG.uniform(-1, 1), RNG.uniform(-1, 1), RNG.uniform(-0.3, 1))).normalized()
        L = RNG.uniform(0.02, 0.07)
        a = tip + d * RNG.uniform(0.008, 0.02)
        polyline('spark', [tuple(a), tuple(a + d * L)], 0.0009, streak)
    ld = bpy.data.lights.new('spark', 'POINT')
    ld.energy, ld.color, ld.shadow_soft_size = 6, (1.0, 0.6, 0.3), 0.01
    link(bpy.data.objects.new('spark', ld)).location = tip


def balloon_string(helio, anchor):
    pts = world_verts_with(helio, 'kn_latex')
    if not pts:
        return
    knot = min(pts, key=lambda p: p.z)
    mid = (knot + Vector(anchor)) / 2 + Vector((0.03, 0, 0))
    polyline('helio_line', [tuple(knot), tuple(mid), anchor], 0.0012, tactile('line', 'cord', '#EDE6D8', 0.85))


# ---------------------------------------------------------------------------------------------- lighting, camera, post
def light_and_world(volume):
    sc = bpy.context.scene
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.42, 0.5, 0.62, 1)
    bg.inputs[1].default_value = 0.35
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy, sun.angle = 9.0, math.radians(1.2)
    sun.color = (1.0, 0.74, 0.47)
    so = link(bpy.data.objects.new('Sun', sun))
    so.rotation_euler = (Vector((-0.5, -1.0, -0.42))).to_track_quat('-Z', 'Y').to_euler()
    # warm bounce from the room and a soft fill from the camera side
    rl.area('Fill', (-1.6, -2.4, 1.9), (0.1, 0.1, 1.0), 120, 2.0, color=(1.0, 0.86, 0.7))
    rl.area('Bounce', (0.0, 0.0, 0.25), (0.0, 0.0, 2.0), 40, 3.0, color=(1.0, 0.7, 0.45))
    if volume:
        vm = bpy.data.materials.new('haze')
        vm.use_nodes = True
        nt = vm.node_tree
        nt.nodes.remove(nt.nodes['Principled BSDF'])
        pv = nt.nodes.new('ShaderNodeVolumePrincipled')
        pv.inputs['Density'].default_value = 0.03
        pv.inputs['Anisotropy'].default_value = 0.55
        pv.inputs['Color'].default_value = (1.0, 0.92, 0.8, 1.0)
        nt.links.new(pv.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
        hz = box('haze', (8.3, 6.5, 3.15), (0.3, -1.3, 1.62), None, bevel=0)
        hz.data.materials.append(vm)
        hz.visible_shadow = False


def camera(view):
    sc = bpy.context.scene
    views = {
        'hero': ((-0.45, -2.45, 1.78), (0.08, 0.22, 1.08), 30, 2.75, 2.4),
        'wide': ((-1.6, -3.4, 1.85), (0.2, 0.4, 1.2), 26, 3.9, 3.2),
        'lobby': ((0.9, -1.75, 1.3), (-0.1, 0.25, 1.05), 40, 2.15, 2.0),
    }
    loc, tgt, lens, focus, fstop = views[view]
    cd = bpy.data.cameras.new('Camera')
    cd.lens, cd.clip_start = lens, 0.02
    cd.dof.use_dof, cd.dof.focus_distance, cd.dof.aperture_fstop = True, focus, fstop
    cam = link(bpy.data.objects.new('Camera', cd))
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam


def post():
    sc = bpy.context.scene
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    rlay = nt.nodes.new('CompositorNodeRLayers')
    glare = nt.nodes.new('CompositorNodeGlare')
    glare.glare_type = 'FOG_GLOW'
    glare.quality = 'HIGH'
    if hasattr(glare, 'threshold'):
        glare.threshold, glare.size, glare.mix = 1.2, 8, -0.75
    else:  # 4.4+: settings moved to inputs
        for k, v in (('Threshold', 1.2), ('Size', 0.6), ('Strength', 0.35)):
            if k in glare.inputs:
                glare.inputs[k].default_value = v
    bal = nt.nodes.new('CompositorNodeColorBalance')
    bal.correction_method = 'LIFT_GAMMA_GAIN'
    bal.lift = (1.0, 0.99, 0.97)
    bal.gain = (1.05, 1.0, 0.93)
    mask = nt.nodes.new('CompositorNodeEllipseMask')
    mask.width, mask.height = 1.15, 1.25
    blur = nt.nodes.new('CompositorNodeBlur')
    blur.use_relative, blur.factor_x, blur.factor_y, blur.filter_type = True, 0.35, 0.35, 'GAUSS'
    vig = nt.nodes.new('CompositorNodeMixRGB')
    vig.blend_type = 'MULTIPLY'
    vig.inputs[0].default_value = 0.0
    ramp = nt.nodes.new('CompositorNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.0
    ramp.inputs['From Max'].default_value = 1.0
    ramp.inputs['To Min'].default_value = 0.55
    ramp.inputs['To Max'].default_value = 1.0
    comp = nt.nodes.new('CompositorNodeComposite')
    L = nt.links.new
    L(rlay.outputs['Image'], glare.inputs['Image'])
    L(glare.outputs['Image'], bal.inputs['Image'])
    L(mask.outputs['Mask'], blur.inputs['Image'])
    L(blur.outputs['Image'], ramp.inputs['Value'])
    vig.inputs[0].default_value = 1.0
    L(bal.outputs['Image'], vig.inputs[1])
    L(ramp.outputs['Value'], vig.inputs[2])
    L(vig.outputs['Image'], comp.inputs['Image'])


# ---------------------------------------------------------------------------------------------- main
def main():
    args = _cli.script_args()
    res = _cli.option(args, '--res', '1920x1080')
    samples = int(_cli.option(args, '--samples', '256'))
    view = _cli.option(args, '--view', 'hero')
    save_blend = _cli.option(args, '--blend')
    volume = not _cli.flag(args, '--no-volume')
    if not args:
        _cli.die('usage: render_tinker_lab.py -- <out.png> [--res WxH] [--samples N] [--view hero|wide|lobby]')
    out_png = os.path.abspath(args[0])
    root = paths.repo_root(os.path.dirname(os.path.abspath(__file__)))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fdir = os.path.join(root, 'assets', 'src', 'lib', 'fonts')
    fonts = {k: bpy.data.fonts.load(os.path.join(fdir, f)) for k, f in
             (('display', 'Unbounded-Bold.ttf'), ('ui', 'Inter-Medium.otf'), ('mono', 'JetBrainsMono-Bold.ttf'),
              ('sym', 'DejaVuSans-Bold.ttf'))}

    M = build_room(fonts)
    build_shelves(M)
    build_bench(M)
    build_lamps(M, [(-0.35, 0.05, 2.0), (0.95, 0.15, 2.05), (2.6, 0.6, 2.2)])
    P = build_machine(root)
    parts, helio, bang = list(P.values()), P['helio'], P['bang']
    bpy.context.scene.frame_set(1)
    cat = import_mochi(root, Vector((-1.18, -0.22, BENCH_Z + 0.3)), 70)
    if cat:
        bpy.context.scene.frame_set(1)
        settle(cat, [bpy.data.objects['bench_top'], bpy.data.objects['cutting_mat']])
    bpy.context.view_layer.update()
    hits = check_overlaps(parts + ([cat] if cat else []) + [o for o in bpy.data.objects if o.parent is None and o.type == 'MESH'
                                                            and o.name.startswith(('pot', 'mug', 'pencil_cup', 'bench_book'))])
    if hits and _cli.flag(args, '--strict'):
        _cli.die('%d overlapping pairs' % len(hits))
    if _cli.flag(args, '--check'):
        return
    part_objs = [o for p in parts for o in descendants(p)]
    if cat:
        part_objs += [o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() is cat]
    tac.apply(part_objs, root)
    rl.bind_decal_atlas(root)
    fuse_spark(bang)
    balloon_string(helio, (1.1, 0.06, MAT_Z + 0.002))
    light_and_world(volume)
    camera(view)

    sc = bpy.context.scene
    sc.frame_set(1)
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
    sc.view_settings.exposure = 0.05
    post()
    if save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(save_blend))
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


if __name__ == '__main__':
    main()
