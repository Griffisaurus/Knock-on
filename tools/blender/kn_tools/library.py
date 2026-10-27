"""Shared libraries: master materials (materials.blend) and port rings (port_ring.blend).

Parts *link* from these (ASSET_PIPELINE §5.1, shared_kit.md §1), so one fix updates every part.
"""
import math
import os

import bmesh
import bpy

from . import geom, paths
from .conventions import PORT_RING_DIAMETER
from .masters import master_table


# ---------------------------------------------------------------- colour

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, cap=0.85):
    """sRGB hex -> linear RGBA, peak channel capped at `cap` linear with hue kept (ART_BIBLE §3.1)."""
    h = h.lstrip('#')
    c = [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    peak = max(c)
    if peak > cap:
        c = [x * cap / peak for x in c]
    return (*c, 1.0)


# ---------------------------------------------------------------- materials.blend

def _principled(name, spec):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    base = hexcol(spec['base'])
    p.inputs['Base Color'].default_value = base
    p.inputs['Roughness'].default_value = spec['rough']
    p.inputs['Metallic'].default_value = spec.get('metal', 0.0)
    p.inputs['Coat Weight'].default_value = spec.get('coat', 0.0)
    p.inputs['Coat Roughness'].default_value = spec.get('coat_rough', 0.1)
    p.inputs['Transmission Weight'].default_value = spec.get('transmission', 0.0)
    p.inputs['IOR'].default_value = spec.get('ior', 1.5)
    p.inputs['Subsurface Weight'].default_value = spec.get('sss', 0.0)
    p.inputs['Anisotropic'].default_value = spec.get('aniso', 0.0)
    p.inputs['Sheen Weight'].default_value = spec.get('sheen', 0.0)
    if 'emission' in spec:
        p.inputs['Emission Color'].default_value = hexcol(spec['emission'], cap=10)
        p.inputs['Emission Strength'].default_value = spec.get('strength', 0.0)
    if 'bump' in spec:
        # Authoring-only preview of the shared tiling detail normal (shared_kit.md §7.2 rule 3).
        scale, strength, dist = spec['bump']
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = 6.0
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = dist
        nt.links.new(n.outputs['Fac'], b.inputs['Height'])
        nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    if 'wood' in spec:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (0.12, 1.0, 1.0)
        w = nt.nodes.new('ShaderNodeTexWave')
        w.wave_type = 'RINGS'
        w.inputs['Scale'].default_value = 9.0
        w.inputs['Distortion'].default_value = 6.0
        w.inputs['Detail'].default_value = 3.0
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = hexcol(spec['wood'][0])
        ramp.color_ramp.elements[1].color = hexcol(spec['wood'][1])
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], w.inputs['Vector'])
        nt.links.new(w.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    m.diffuse_color = base  # viewport solid colour
    m.roughness = spec['rough']
    m.metallic = spec.get('metal', 0.0)
    m.use_fake_user = True  # libraries keep unused masters
    m['kn_master'] = True
    return m


def build_materials_lib(path):
    """Write materials.blend from the master table. Run in a fresh (factory) session."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in master_table().items():
        _principled(name, spec)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


# ---------------------------------------------------------------- port_ring.blend

def ring_profiles(D):
    """shared_kit.md §1.1 proportions, axis +X outward, x = 0 on the housing surface."""
    R = D / 2.6
    a = 0.1154 * D
    collar = [(R + a * math.cos(math.radians(t)), a * math.sin(math.radians(t))) for t in range(0, 181, 30)]
    # Back half deleted and capped flat: the closed profile returns along x = 0.
    led_c, led_x, led_r = 0.269 * D, 0.104 * D - 0.0425 * D, 0.0425 * D
    led = [(led_c + led_r * math.cos(math.radians(t)), led_x + led_r * math.sin(math.radians(t)))
           for t in range(0, 360, 45)]
    sock_r, face, back = 0.2385 * D, 0.040 * D, 0.040 * D - 0.096 * D
    bore_r, bore_floor = 0.09 * D, 0.040 * D - 0.08 * D
    socket = [(0.0, back), (sock_r, back), (sock_r, face), (bore_r, face), (bore_r, bore_floor), (0.0, bore_floor)]
    return collar, led, socket


def build_port_ring_lib(path, materials_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = link_materials(materials_path, ['kn_steel_brushed', 'kn_led', 'kn_rubber'])
    for size, D in PORT_RING_DIAMETER.items():
        col = bpy.data.collections.new('PR_' + size)
        col.use_fake_user = True
        bpy.context.scene.collection.children.link(col)
        collar, led, socket = ring_profiles(D)
        for piece, prof, mat, closed, seg in (('collar', collar, 'kn_steel_brushed', True, 32),
                                               ('led', led, 'kn_led', True, 32),
                                               ('socket', socket, 'kn_rubber', False, 32)):
            bm = bmesh.new()
            geom.lathe(bm, prof, seg, closed=closed)
            ob = geom.object_from_bmesh('PR_%s__%s' % (size, piece), bm, [mats[mat]], col)
            geom.set_sharp_by_angle(ob.data, 40)
        col['kn_port_ring_size'] = size
        col['kn_outer_diameter'] = D
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, relative_remap=True)
    return path


def ensure_libs(root, force=False):
    """Build the libraries if missing (or forced). Leaves a fresh empty session behind."""
    mpath, rpath = paths.materials_lib(root), paths.port_ring_lib(root)
    built = []
    if force or not os.path.exists(mpath):
        built.append(build_materials_lib(mpath))
    if force or not os.path.exists(rpath):
        built.append(build_port_ring_lib(rpath, mpath))
    if built:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    return built


# ---------------------------------------------------------------- linking

def _same_file(a, b):
    return os.path.normcase(os.path.abspath(bpy.path.abspath(a))) == os.path.normcase(os.path.abspath(b))


def _linked(datablocks, lib_path, name):
    for d in datablocks:
        if d.name == name and d.library and _same_file(d.library.filepath, lib_path):
            return d
    return None


def link_materials(lib_path, names):
    """Link master materials by id (File > Link semantics). Returns {name: Material}."""
    out, missing = {}, []
    for n in names:
        found = _linked(bpy.data.materials, lib_path, n)
        if found:
            out[n] = found
        else:
            missing.append(n)
    if missing:
        with bpy.data.libraries.load(lib_path, link=True, relative=True) as (src, dst):
            unknown = [n for n in missing if n not in src.materials]
            if unknown:
                raise KeyError('not in master library %s: %s' % (lib_path, ', '.join(unknown)))
            dst.materials = list(missing)
        for n in missing:
            out[n] = _linked(bpy.data.materials, lib_path, n)
    return out


def link_port_ring(lib_path, size):
    name = 'PR_' + size
    found = _linked(bpy.data.collections, lib_path, name)
    if found:
        return found
    with bpy.data.libraries.load(lib_path, link=True, relative=True) as (src, dst):
        if name not in src.collections:
            raise KeyError('%s missing from %s' % (name, lib_path))
        dst.collections = [name]
    return _linked(bpy.data.collections, lib_path, name)
