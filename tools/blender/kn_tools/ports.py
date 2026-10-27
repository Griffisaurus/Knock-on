"""Port placement and `kn_tools > Snap Port Ring (S/M/L)` (ASSET_PIPELINE §3.5, shared_kit.md §1)."""
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from . import geom, library, paths, template
from .conventions import CHANNELS, PORT_DIRS, PORT_SIZES, is_lower_snake, parse_name


def add_port(channel, name, location, direction, size='M', dir='both', max_links=None, kind=None):
    """Create a PORT__<channel>__<name> empty whose local +X points along `direction` (outward)."""
    if channel not in CHANNELS:
        raise ValueError('unknown channel %r' % channel)
    if not is_lower_snake(name):
        raise ValueError('port name must be lower_snake: %r' % name)
    ob = bpy.data.objects.new('PORT__%s__%s' % (channel, name), None)
    ob.empty_display_type = 'SINGLE_ARROW'  # arrow = local +Z in the viewport; +X is the port axis
    ob.empty_display_size = 0.02
    ob.matrix_world = Matrix.Translation(location) @ geom.track_matrix(direction).to_4x4()
    ob['dir'] = dir
    ob['size'] = size
    if max_links is not None:
        ob['max_links'] = int(max_links)
    if kind:
        ob['kind'] = kind
    template.get_collection('PORT').objects.link(ob)
    return ob


def _render_bvh(scene):
    col = template.get_collection('RENDER', scene, create=False)
    if col is None:
        return None
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in col.all_objects:
        if ob.type != 'MESH':
            continue
        with geom.EvaluatedMesh(ob, dg) as me:
            base = len(verts)
            verts.extend(ob.matrix_world @ v.co for v in me.vertices)
            polys.extend([base + i for i in p.vertices] for p in me.polygons)
    if not polys:
        return None
    return BVHTree.FromPolygons(verts, polys)


def snap_port_ring(port_ob, size=None, snap_to_surface=True, scene=None, root_dir=None):
    """Snap a PORT empty onto the nearest RENDER surface (+X = surface normal) and instance the linked ring."""
    scene = scene or bpy.context.scene
    parsed = parse_name('PORT', port_ob.name)
    if not parsed:
        raise ValueError('%s is not a PORT__<channel>__<name> empty' % port_ob.name)
    size = size or port_ob.get('size', 'M')
    if size not in PORT_SIZES:
        raise ValueError('port size must be S/M/L, got %r' % size)
    port_ob['size'] = size
    if 'dir' not in port_ob.keys() or port_ob['dir'] not in PORT_DIRS:
        port_ob['dir'] = 'both'
    if snap_to_surface:
        bvh = _render_bvh(scene)
        if bvh is not None:
            hit, normal, _idx, _dist = bvh.find_nearest(port_ob.matrix_world.translation)
            if hit is not None:
                port_ob.matrix_world = Matrix.Translation(hit) @ geom.track_matrix(normal).to_4x4()
    root_dir = root_dir or paths.repo_root(bpy.data.filepath or None)
    ring_col = library.link_port_ring(paths.port_ring_lib(root_dir), size)
    ring_name = port_ob.name + '__ring'
    old = bpy.data.objects.get(ring_name)
    if old is not None:
        bpy.data.objects.remove(old)
    inst = bpy.data.objects.new(ring_name, None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = ring_col
    inst.empty_display_size = 0.01
    inst.parent = port_ob
    inst.matrix_parent_inverse = Matrix.Identity(4)
    inst.matrix_basis = Matrix.Identity(4)
    template.get_collection('PORT', scene).objects.link(inst)
    return inst


def port_axis(port_ob):
    """World-space port direction (local +X)."""
    return (port_ob.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
