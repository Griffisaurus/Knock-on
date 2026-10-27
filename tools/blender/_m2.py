"""Shared helpers for the M2 part builders (stream E1): the shared_kit pieces every M2 brief reuses, built
procedurally in the house style of kn_tools.kit (closed shells, LOD-aware), plus nested pivots, baked clips and
device socket rigs.

Usage from a make_<type>.py:  import _m2 ; _m2.screw(kit_obj, 'M5', centre, normal, q, lod)

Kit pieces (docs/art/briefs/shared_kit.md):
  screw()        §2 hex-socket button heads M3 / M5 / M8 (LOD drop-out per the table: M3 LOD0 only, M5 LOD0-1,
                 M8 LOD0-2)
  foot()         §3 domed bumpers FOOT_S / FOOT_M / FOOT_L (LOD2: 8-sided prism, LOD3: removed)
  foot_bar()     §3 FOOT_BAR / FOOT_BAR5 stadium bars
  led_dome()     §4.1 LED_D6 / D8 / D10 (steel bezel + kn_led dome; the LED face never disappears)
  screen_bezel() §5 graphite bezel (4 mm border, 2 / 1 mm radii) with the quad pocket inset 1.5 mm and a 1 mm
                 kn_glass cover 0.3 mm under the bezel face (LOD0). Returns the screen quad centre.
  coil()         chrome coil springs (helix sweep, closed)
  led_attr()     the `led` face-corner colour fn (R = group / 255, G = idle brightness) for Kit.colors
Mechanism helpers:
  nest()         hang a PIVOT__ empty under another (nested pivot chains; validator rule 9 allows direct nesting)
  clip()         bake a `<type>__<clip>` action (30 fps) on pivots, stored as muted NLA tracks
  socket_rig()   device RIG armature with root + socket_* bones (ASSET_PIPELINE §3.9) -> .art.json sockets
"""
import math

import bpy
from mathutils import Matrix, Vector

from kn_tools import kit, template
from kn_tools.kit import Kit, seg

STEEL, LED, RUBBER, GRAPHITE, GLASS = 'kn_steel_brushed', 'kn_led', 'kn_rubber', 'kn_powder_graphite', 'kn_glass'

# head radius, head height, last LOD that keeps the head
SCREWS = {'M3': (0.00275, 0.00165, 0), 'M5': (0.00425, 0.0026, 1), 'M8': (0.0065, 0.004, 2)}


def screw(k, size, centre, normal, q, lod, mat=STEEL):
    """ISO 7380-style button head seated 0.1 mm into the surface at `centre`, facing `normal`."""
    r, h, keep = SCREWS[size]
    if lod > keep:
        return
    if lod >= 2:  # M8 flat cap at LOD2
        k.cyl(r, -0.0001, h * 0.6, mat, 8, m=kit.frame(centre, normal))
        return
    prof = [(0.0, -0.0001, mat), (r, -0.0001, mat), (r, h * 0.27, mat), (r * 0.85, h * 0.65, mat),
            (r * 0.5, h * 0.92, mat), (0.0, h, mat)]
    k.lathe(prof, seg(14 if size != 'M8' else 18, q, 6), kit.frame(centre, normal))


FEET = {'S': (0.004, 0.003), 'M': (0.007, 0.004), 'L': (0.011, 0.005)}


def foot(k, size, x, y, q, lod, z0=0.0, mat=RUBBER, top=0.0006):
    """Domed bumper standing on z0 (its sole), sunk `top` into the shell above. LOD3 drops feet."""
    r, h = FEET[size]
    if lod >= 3:
        return
    if lod == 2:
        k.prism(kit.outline_circle(r, 8), z0, z0 + h + top, mat, m=kit.at(x, y, 0))
        return
    n = seg(16, q, 8)
    fil = min(r * 0.3, h * 0.45)
    prof = [(0.0, z0, mat), (r - fil, z0, mat), (r - fil * 0.3, z0 + fil * 0.3, mat), (r, z0 + fil, mat),
            (r, z0 + h + top, mat), (0.0, z0 + h + top, mat)]
    k.lathe(prof, n, kit.at(x, y, 0))


def foot_bar(k, length, x, y, q, lod, h=0.004, w=0.010, z0=0.0, along='x', mat=RUBBER):
    if lod >= 3:
        return
    cs = (3, 2, 1, 1)[lod]
    size = (length, w, h + 0.0006) if along == 'x' else (w, length, h + 0.0006)
    k.rbox(size, (x, y, z0 + (h + 0.0006) / 2), w / 2 * 0.99 if lod < 2 else 0.0, mat, cseg=cs,
           rz=min(0.0015, h / 3) if lod < 2 else 0.0)


LEDS = {6: (0.003, 0.0033, 0.0045, 0.0012), 8: (0.004, 0.0044, 0.0055, 0.0012), 10: (0.005, 0.0055, 0.0065, 0.0015)}


def led_dome(k, d, centre, normal, q, lod, bezel=STEEL):
    """LED_D6/8/10: steel bezel ring + kn_led dome on a surface at `centre` (dome base on the surface)."""
    rd, hd, rb, hb = LEDS[d]
    m = kit.frame(centre, normal)
    if lod >= 3:
        k.cyl(rd, -0.0002, 0.0006, LED, 4, m=m)
        return
    if lod < 2:
        k.cyl(rb, -0.0002, hb, bezel, seg(16, q, 6), bev=0.0003 if lod == 0 else 0.0, bseg=1, m=m)
    k.sphere(rd, LED, seg(14, q, 6) if lod < 2 else 6, (5, 3, 2)[lod], m=m @ kit.at(0, 0, hb * 0.5),
             sz_bot=0.2, sz_top=hd / rd)


def led_attr(group_of):
    """Kit.colors['led'] fn: group_of(centre, normal) -> (group index, idle brightness) for kn_led faces."""
    def fn(centre, normal, master):
        if master != LED:
            return (0.0, 0.0, 0.0, 1.0)
        g, b = group_of(centre, normal)
        return (g / 255.0, b, 0.0, 1.0)
    return fn


def screen_bezel(k, mats, w, h, centre, normal, up, lod, q, depth=0.006, border=0.004, glass=True):
    """Kit screen (§5): graphite bezel standing `depth` proud of the surface at `centre`, with a pocket for the
    w x h quad inset 1.5 mm and a 1 mm glass cover 0.3 mm below the bezel face. Returns the quad centre (on the
    pocket floor) for kit.screen_quad / Part.screen."""
    n = Vector(normal).normalized()
    u = (Vector(up) - n * Vector(up).dot(n)).normalized()
    r = u.cross(n)
    # local x = image right, local y = image up, local z = out of the face
    m = Matrix((
        (r.x, u.x, n.x, centre[0]),
        (r.y, u.y, n.y, centre[1]),
        (r.z, u.z, n.z, centre[2]),
        (0, 0, 0, 1)))
    cs = max(1, (3, 2, 1, 1)[lod])
    bez = Kit()
    bez.prism(kit.outline_rrect(w + 2 * border, h + 2 * border, 0.002, cs), -0.0005, depth, GRAPHITE,
              bt=0.0008 if lod < 2 else 0.0, bseg=1, m=m)
    pocket = Kit()
    pocket.prism(kit.outline_rrect(w, h, 0.001, cs), depth - 0.0015, depth + 0.002, GRAPHITE, m=m)
    k.merge(kit.boolean_diff(bez, [pocket], mats))
    if glass and lod == 0:
        k.prism(kit.outline_rrect(w, h, 0.001, cs), depth - 0.0003 - 0.001, depth - 0.0003, GLASS, m=m)
    c = Vector(centre) + n * (depth - 0.0015)
    return tuple(c)


def coil(k, R, r, z0, z1, turns, mat, q, lod, m=None, sides=None, per_turn=None):
    """Closed coil spring along local +Z from z0 to z1, coil radius R, wire radius r. Ends are flat-ground
    (a closing half turn at each end). LOD3: a plain tube."""
    if lod >= 3:
        k.lathe([(0.0, z0, mat), (R + r, z0, mat), (R + r, z1, mat), (R - r, z1, mat), (R - r, z0 + 1e-4, mat),
                 (0.0, z0 + 1e-4, mat)], 8, m)
        return
    sides = sides or max(3, (6, 5, 4)[lod] if q >= 0.6 else 4)
    per = per_turn or seg((20, 12, 8)[lod], q, 6)
    n = max(2, int(round(turns * per)))
    pts = []
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * turns * t
        pts.append((R * math.cos(a), R * math.sin(a), z0 + r + (z1 - z0 - 2 * r) * t))
    if m is not None:
        pts = [tuple(m @ Vector(p)) for p in pts]
    k.sweep(pts, r, sides, mat)


def grid_slab(k, w, d, z0, z1, n, mat, centre=(0.0, 0.0)):
    """Closed w x d slab from z0 to z1 with an n x n quad grid on top and bottom (interior vertices, so a shape
    key can dip its middle: SPRONG mat). Sides are one quad row per grid edge."""
    bm = k.bm
    mi = k.mi(mat)
    cx, cy = centre
    xs = [cx - w / 2 + w * i / n for i in range(n + 1)]
    ys = [cy - d / 2 + d * j / n for j in range(n + 1)]
    top = [[bm.verts.new((x, y, z1)) for x in xs] for y in ys]
    bot = [[bm.verts.new((x, y, z0)) for x in xs] for y in ys]
    for j in range(n):
        for i in range(n):
            bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i])).material_index = mi
            bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1])).material_index = mi
    ring_t = [top[0][i] for i in range(n)] + [top[j][n] for j in range(n)] + \
             [top[n][i] for i in range(n, 0, -1)] + [top[j][0] for j in range(n, 0, -1)]
    ring_b = [bot[0][i] for i in range(n)] + [bot[j][n] for j in range(n)] + \
             [bot[n][i] for i in range(n, 0, -1)] + [bot[j][0] for j in range(n, 0, -1)]
    m = len(ring_t)
    for a in range(m):
        b = (a + 1) % m
        bm.faces.new((ring_b[a], ring_b[b], ring_t[b], ring_t[a])).material_index = mi


def axial_remap(origin, axis, a0, a1, b0, b1, radius=None):
    """Shape-key fn for a coil along `axis` through `origin`: the axial span a0..a1 maps linearly onto b0..b1
    (stretch / compress); radius limits it to vertices within that distance of the axis."""
    o, u = Vector(origin), Vector(axis).normalized()

    def fn(co):
        rel = co - o
        t = rel.dot(u)
        if radius is not None and (rel - u * t).length > radius:
            return co
        s = (t - a0) / (a1 - a0) if a1 != a0 else 0.0
        return co + u * (b0 + (b1 - b0) * s - t)
    return fn


# ---------------------------------------------------------------- mechanism

def nest(part, child, parent):
    """Hang PIVOT__<child> under PIVOT__<parent> with an identity parent inverse (local location = offset), so
    clips key plain local transforms. Call before build_lods."""
    c = part.pivots['PIVOT__' + child]
    p = part.pivots['PIVOT__' + parent]
    bpy.context.view_layer.update()
    w = c.matrix_world.copy()
    c.parent = p
    c.matrix_parent_inverse = Matrix.Identity(4)
    c.matrix_world = w
    bpy.context.view_layer.update()


def _axis_vec(ob):
    return {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[ob['axis']]


def clip(part, name, tracks, fps=30):
    """Bake action `<type>__<name>`: tracks = {pivot: [(seconds, value), ...]}; value is degrees about the
    pivot axis, or metres along it for slide pivots (`motion = 'slide'`). Linear keys at the given times plus
    the pivot's rest transform. Stored on each pivot as a muted NLA track named after the action, so the saved
    pose stays at rest; the exporter writes one glTF animation per action."""
    sc = bpy.context.scene
    sc.render.fps = fps
    act_name = '%s__%s' % (part.type, name)
    act = bpy.data.actions.new(act_name)
    act.use_fake_user = True
    end = 1
    for pname, keys in tracks.items():
        ob = part.pivots['PIVOT__' + pname]
        ob.rotation_mode = 'XYZ'
        rest_loc = ob.location.copy()
        rest_rot = ob.rotation_euler.copy()
        ax = _axis_vec(ob)
        slide = ob.get('motion') == 'slide'
        ad = ob.animation_data_create()
        prev = ad.action
        ad.action = act
        for t, v in keys:
            f = 1 + round(t * fps)
            end = max(end, f)
            ob.location = rest_loc
            ob.rotation_euler = rest_rot
            if slide:
                ob.location = rest_loc + ax * v
            else:
                e = ax * math.radians(v)
                ob.rotation_euler = (rest_rot.x + e.x, rest_rot.y + e.y, rest_rot.z + e.z)
            ob.keyframe_insert('location', frame=f)
            ob.keyframe_insert('rotation_euler', frame=f)
        slot = ad.action_slot
        ad.action = prev
        ob.location = rest_loc
        ob.rotation_euler = rest_rot
        tr = ad.nla_tracks.new()
        tr.name = act_name
        st = tr.strips.new(act_name, 1, act)
        if slot is not None and hasattr(st, 'action_slot'):
            st.action_slot = slot
        tr.mute = True
    act.frame_range = (1, end)
    sc.frame_set(1)
    return act


def socket_rig(part, bones):
    """Device RIG armature (ASSET_PIPELINE §3.9). bones = [(name, head, tail_dir, parent, follow_pivot)], name
    'root' or 'socket_*'; follow_pivot (e.g. 'crank') adds a Child Of constraint to PIVOT__<pivot> so the socket
    rides it; .art.json records it as `follow`."""
    arm = bpy.data.armatures.new('RIG')
    ob = bpy.data.objects.new('RIG', arm)
    template.get_collection('RIG').objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, head, tail_dir, parent, _f in bones:
        b = arm.edit_bones.new(name)
        b.head = Vector(head)
        b.tail = Vector(head) + Vector(tail_dir).normalized() * 0.03
        if parent:
            b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for name, _h, _t, _p, follow in bones:
        if follow:
            pb = ob.pose.bones[name]
            pb['follow'] = 'PIVOT__' + follow
            c = pb.constraints.new('CHILD_OF')
            c.target = part.pivots['PIVOT__' + follow]
            c.inverse_matrix = c.target.matrix_world.inverted()
    return ob


# ---------------------------------------------------------------- M3 (stream E3a): authored for the texture set

# Masters that never take a texture set (ASSET_PIPELINE §5.2 "Exempt"); a mesh made only of these gets no UV1.
UV_EXEMPT = ('kn_poly_', 'kn_glass', 'kn_chrome', 'kn_led', 'kn_screen', 'kn_decal')


def _textured(ob):
    return ob.type == 'MESH' and any(m is not None and not m.name.startswith(UV_EXEMPT) for m in ob.data.materials)


def uv1(part, set_name='body', margin=0.004, angle=66.0):
    """UV1 for the part's texture set (ASSET_PIPELINE §4 / §5.2, contract 1): every textured LOD0 mesh is smart-
    projected together into ONE non-overlapping 0-1 layout (multi-object edit mode packs all islands into one
    space; margin 0.004 = 4 px at 1024² / 8 px at 2048²). LOD1-3 meshes take their UVs from that layout by
    nearest-surface projection onto LOD0 (barycentric on the closest LOD0 triangle, probed from slightly inside
    each face so seam corners land in their own face's island), so every LOD samples the same set. Each textured
    object gets `kn_set = <set_name>` (the slot's set name, §5.2). Decal and screen quads keep their own UVs."""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    from kn_tools.conventions import LOD_COLLECTIONS
    cols = [template.get_collection(c) for c in LOD_COLLECTIONS]
    lod0 = [ob for ob in cols[0].objects if _textured(ob)]
    if not lod0:
        return 0
    vl = bpy.context.view_layer
    bpy.context.view_layer.update()
    for o in vl.objects:
        o.select_set(False)
    for ob in lod0:
        if not ob.data.uv_layers:
            ob.data.uv_layers.new(name='UVMap')
        ob.select_set(True)
    vl.objects.active = lod0[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for ob in lod0:
        ob.select_set(False)
        ob['kn_set'] = set_name
    # world-space LOD0 triangles with their corner UVs, grouped into UV islands (union of triangles that share
    # an edge with the same UVs on both sides)
    verts, tris, tuv = [], [], []
    parent = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for ob in lod0:
        me = ob.data
        mw = ob.matrix_world
        uvl = me.uv_layers.active.data
        me.calc_loop_triangles()
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        edge_tri = {}
        for lt in me.loop_triangles:
            ti = len(tris)
            tris.append(tuple(base + i for i in lt.vertices))
            uvs = tuple(uvl[li].uv.copy() for li in lt.loops)
            tuv.append(uvs)
            parent.append(ti)
            for a_, b_ in ((0, 1), (1, 2), (2, 0)):
                va, vb = lt.vertices[a_], lt.vertices[b_]
                ua, ub = uvs[a_], uvs[b_]
                if va > vb:
                    va, vb, ua, ub = vb, va, ub, ua
                key = (va, vb, round(ua.x, 5), round(ua.y, 5), round(ub.x, 5), round(ub.y, 5))
                if key in edge_tri:
                    ra, rb = find(edge_tri[key]), find(ti)
                    if ra != rb:
                        parent[rb] = ra
                else:
                    edge_tri[key] = ti
    tree = BVHTree.FromPolygons(verts, tris, epsilon=0.0)
    islands = {}
    for ti in range(len(tris)):
        islands.setdefault(find(ti), []).append(ti)
    itree = {}
    for root, members in islands.items():
        itree[root] = (BVHTree.FromPolygons(verts, [tris[t] for t in members], epsilon=0.0), members)

    def uv_on(ti, p):
        a, b, c = (verts[i] for i in tris[ti])
        ua, ub, uc = (Vector((u.x, u.y, 0.0)) for u in tuv[ti])
        return barycentric_transform(p, a, b, c, ua, ub, uc)
    n = 0
    for col in cols[1:]:
        for ob in col.objects:
            if not _textured(ob):
                continue
            me = ob.data
            uvl = (me.uv_layers.active or me.uv_layers.new(name='UVMap')).data
            mw = ob.matrix_world
            wv = [mw @ v.co for v in me.vertices]
            for poly in me.polygons:
                cen = sum((wv[me.loops[li].vertex_index] for li in poly.loop_indices), Vector()) / poly.loop_total
                hit = tree.find_nearest(cen)
                if hit[2] is None:
                    continue
                isl_tree, members = itree[find(hit[2])]
                for li in poly.loop_indices:
                    p = wv[me.loops[li].vertex_index]
                    h = isl_tree.find_nearest(p)
                    q = uv_on(members[h[2]], h[0]) if h[2] is not None else uv_on(hit[2], p)
                    uvl[li].uv = (q.x, q.y)
            ob['kn_set'] = set_name
            n += 1
    return len(lod0) + n


def twist(origin, axis, a0, a1, deg, radius=None):
    """Shape-key fn (M3, E3a) for a torsion spring along `axis` through `origin`: each vertex turns about the axis
    by deg x (its axial position a0 -> a1 mapped to 0 -> 1), i.e. the coil winds / unwinds; `radius` limits it to
    vertices within that distance of the axis (legs and pins stay)."""
    o, u = Vector(origin), Vector(axis).normalized()

    def fn(co):
        rel = co - o
        t = rel.dot(u)
        if radius is not None and (rel - u * t).length > radius:
            return co
        s = max(0.0, min(1.0, (t - a0) / (a1 - a0))) if a1 != a0 else 0.0
        return o + Matrix.Rotation(math.radians(deg * s), 3, u) @ rel
    return fn


def under(part, ob, pivot):
    """Hang a COL shape / sensor / emitter / port under PIVOT__<pivot> (world transform kept) so it rides the moving
    piece; the exporter records it as `pivot` at its rest pose."""
    piv = part.pivots['PIVOT__' + pivot]
    bpy.context.view_layer.update()
    w = ob.matrix_world.copy()
    ob.parent = piv
    ob.matrix_parent_inverse = piv.matrix_world.inverted()
    ob.matrix_world = w
    return ob


LAND_R = {'S': 0.0175, 'M': 0.0245, 'L': 0.0315}   # shared_kit §1.1: ring land Ø 35 / 49 / 63 mm


def land(k, size, port, normal, depth, lod, mat=GRAPHITE, base=None):
    """Port land boss: a disc standing `depth` proud along `normal` from the housing surface, its face on the port
    point (the ring's centre plane), so the PR-S/M/L ring seats flat. `base` overrides the start point. LOD3 drops
    it (the engine-drawn ring covers it)."""
    if lod >= 3:
        return
    n = Vector(normal).normalized()
    c = Vector(port) - n * depth if base is None else Vector(base)
    k.cyl(LAND_R[size], -0.0006, (Vector(port) - c).dot(n), mat, (28, 16, 10, 6)[lod],
          bev=0.0008 if lod < 2 else 0.0, bseg=1, bev_bot=0.0, m=kit.frame(tuple(c), tuple(n)))


def frac_cut(k, co, no, inner_mi, bridge=False):
    """Keep the side of closed kit k behind plane (co, no) and cap the cut (bridged loops or n-gon fills) with the
    interior master index `inner_mi` (the FISHBOWL fracture cut, shared for M3 breakables)."""
    import bmesh
    bm = k.bm
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-7,
                                 plane_co=co, plane_no=no, clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    if edges:
        faces = bmesh.ops.bridge_loops(bm, edges=edges)['faces'] if bridge else \
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
        for f in faces:
            f.material_index = inner_mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return k


def frac_objects(part, kits, first=1, digits=2):
    """FRAC__NN objects (ASSET_PIPELINE §7) from closed Kits, numbered from `first`; returns their names."""
    from kn_tools import geom
    col = template.get_collection('FRAC')
    names = []
    for i, k in enumerate(kits, first):
        if not k.bm.faces:
            k.free()
            continue
        name = 'FRAC__%0*d' % (digits, i)
        ob = geom.object_from_bmesh(name, k.bm, [part.mats[nm] for nm in k.mats], col, recalc_normals=False)
        geom.set_sharp_by_angle(ob.data, 40)
        names.append(name)
    return names


def ring_decal(slot, centre, normal, ref, r0, r1, a0, a1, nu, sub=None, pivot=None, lift=kit.LIFT):
    """kn_decal annulus (r0 inner .. r1 outer) on a flat face from angle a0 to a1 (radians, measured from `ref`
    about `normal`, counter-clockwise seen from the normal side): the image's u runs round the ring, its bottom
    edge on the outer radius (so the quads face `normal`). Hazard stripe rings on lids."""
    rect = kit.atlas_rect(slot, sub)
    n = Vector(normal).normalized()
    x = (Vector(ref) - n * Vector(ref).dot(n)).normalized()
    y = n.cross(x)
    c = Vector(centre) + n * lift
    rows = []
    for r in (r1, r0):
        row = []
        for i in range(nu + 1):
            a = a0 + (a1 - a0) * i / nu
            row.append(c + (x * math.cos(a) + y * math.sin(a)) * r)
        rows.append(row)
    return kit.decal_grid(rows, rect, pivot)
