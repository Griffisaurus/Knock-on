"""`kn_tools > New Part`: the part template (ASSET_PIPELINE §3.3, §3.8)."""
import bpy

from . import library, paths
from .conventions import (CLASSES, FAMILIES, KNOWN_COLLECTIONS, TEMPLATE_COLLECTIONS, default_origin,
                          is_lower_snake)


def get_collection(name, scene=None, create=True):
    scene = scene or bpy.context.scene
    for c in scene.collection.children:
        if c.name == name:
            return c
    if not create:
        return None
    if name not in KNOWN_COLLECTIONS:
        raise ValueError('unknown part collection %s' % name)
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    if name not in ('RENDER',):
        # Only LOD0 renders in the authoring viewport; the rest are helpers or alternates.
        c.hide_render = name != 'RENDER'
    return c


def find_root(scene=None):
    """The root empty: carries kn_type and lives directly in the scene collection."""
    scene = scene or bpy.context.scene
    for ob in scene.collection.objects:
        if 'kn_type' in ob.keys():
            return ob
    return None


def new_part(part_type, family, cls, footprint, mass_hint, origin=None, tri_budget=None, skins='', notes='',
             led_groups='', version=1, scene=None, root_dir=None):
    if not is_lower_snake(part_type):
        raise ValueError('part type must be lower_snake: %r' % part_type)
    if family not in FAMILIES:
        raise ValueError('unknown family %r' % family)
    if cls not in CLASSES:
        raise ValueError('unknown class %r' % cls)
    scene = scene or bpy.context.scene
    us = scene.unit_settings
    us.system = 'METRIC'
    us.scale_length = 1.0
    us.length_unit = 'METERS'
    for name in TEMPLATE_COLLECTIONS:
        get_collection(name, scene)
    root = find_root(scene)
    if root is None:
        root = bpy.data.objects.new(part_type, None)
        root.empty_display_type = 'ARROWS'
        root.empty_display_size = 0.05
        scene.collection.objects.link(root)
    root.name = part_type
    root['kn_type'] = part_type
    root['kn_family'] = family
    root['kn_class'] = cls
    root['kn_footprint'] = footprint if isinstance(footprint, str) else ','.join('%g' % v for v in footprint)
    root['kn_mass_hint'] = float(mass_hint)
    root['kn_skins'] = skins
    root['led_groups'] = led_groups
    root['kn_notes'] = notes
    root['kn_origin'] = origin or default_origin(family)
    root['kn_version'] = int(version)
    if tri_budget:
        root['kn_tri_budget'] = int(tri_budget)
    return root


def link_masters(names, root_dir=None):
    root_dir = root_dir or paths.repo_root(bpy.data.filepath or None)
    return library.link_materials(paths.materials_lib(root_dir), names)


def add_col(kind, name, mesh_ob_data, location=(0, 0, 0), phys='powder', **overrides):
    """Wrap mesh data as a COL__<kind>__<name> shape with its physics custom properties (§3.4)."""
    ob = bpy.data.objects.new('COL__%s__%s' % (kind, name), mesh_ob_data)
    ob.location = location
    ob.display_type = 'WIRE'
    ob.hide_render = True
    ob['phys'] = phys
    for k, v in overrides.items():
        ob[k] = v
    get_collection('COL').objects.link(ob)
    return ob
