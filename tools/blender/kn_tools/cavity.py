"""Container cavities and fill LUTs (ASSET_PIPELINE §3.10, briefs/matter.md "Contents rendering"; M4 stream E4a).

A `CAVITY__<name>` mesh is the closed, manifold inner volume of a container, inset 3-4 mm from the inner wall, with
custom properties `matter = sand|water|marble|goo|fill` and (on emitting / absorbing containers) `capacity`.

The exporter writes one `.art.json -> cavities[]` entry per cavity (engine Y-up metres, part space, rest pose):

  name, matter, capacity?, fill? (fixed cosmetic level, `matter = fill` parts)
  volume      litres enclosed by the cavity mesh
  min, max    cavity bounds
  lut         64 level-plane heights (engine y): lut[i] = the height of the level plane that encloses i / 63 of the
              volume with the part upright (lut[0] = min y, lut[63] = max y). Linear between entries.
  mesh        {vertices: flat [x, y, z, ...], indices: flat triangle list}: the cavity itself, for the fill pass
              to clip against a world-space level plane at any tilt (the LUT covers the upright pose only)
  pivot?      the PIVOT__ the cavity rides (its pose = that pivot's rest); with it
  tilt?       {pivot, axis, origin, angles (degrees), luts}: the same 64-entry LUT for the pivot turned to each angle
              (world y of the level plane in part space), for tipping containers (SPRINKLE CAN)

The volume below a horizontal plane z = h is exact for a closed mesh: with F = (0, 0, z - h), div F = 1 and F
vanishes on the cap, so V(h) = sum over triangles of the integral of (z - h) n_z dA over the part below the plane,
i.e. signed projected area x the mean of (z - h) over the clipped piece (z is linear on a triangle). No bpy in the
maths, so it is testable in plain Python.
"""
import math

import numpy as np

LUT_SIZE = 64
SAMPLES = 1024           # V(h) samples between min z and max z, inverted by interpolation
MATTERS = ('sand', 'water', 'marble', 'goo', 'fill')


def tris_array(verts, tris):
    v = np.asarray(verts, dtype=np.float64).reshape(-1, 3)
    t = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    return v[t]  # (n, 3, 3)


def volume_below(tri, h):
    """Volume of the closed triangle mesh `tri` (n x 3 x 3, outward winding, z up) below the plane z = h."""
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    area = 0.5 * ((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
    d = tri[:, :, 2] - h                                  # (n, 3) signed heights
    below = d < 0.0
    nb = below.sum(1)
    out = np.zeros(len(tri))
    full = nb == 3
    out[full] = area[full] * d[full].sum(1) / 3.0
    for i in range(3):
        j, k = (i + 1) % 3, (i + 2) % 3
        di, dj, dk = d[:, i], d[:, j], d[:, k]
        # one vertex below (i): the small triangle (i, p_ij, p_ik), scaled copy of the face
        m1 = (nb == 1) & below[:, i]
        if m1.any():
            tij = di[m1] / (di[m1] - dj[m1])
            tik = di[m1] / (di[m1] - dk[m1])
            out[m1] = area[m1] * tij * tik * di[m1] / 3.0
        # two below, vertex i above: the whole face minus the small triangle above
        m2 = (nb == 2) & ~below[:, i]
        if m2.any():
            tij = di[m2] / (di[m2] - dj[m2])
            tik = di[m2] / (di[m2] - dk[m2])
            out[m2] = area[m2] * (d[m2].sum(1) / 3.0 - tij * tik * di[m2] / 3.0)
    return float(out.sum())


def total_volume(tri):
    return volume_below(tri, float(tri[:, :, 2].max()) + 1.0)


def fill_lut(tri, n=LUT_SIZE, samples=SAMPLES):
    """(volume m³, z_min, z_max, [n heights]) with the level-plane height for fill fractions 0 .. 1 by volume."""
    z0, z1 = float(tri[:, :, 2].min()), float(tri[:, :, 2].max())
    vt = total_volume(tri)
    if vt <= 0:
        raise ValueError('cavity mesh encloses no volume (open, or inward-facing normals)')
    hs = np.linspace(z0, z1, samples)
    vs = np.array([volume_below(tri, h) for h in hs])
    vs[0], vs[-1] = 0.0, vt
    vs = np.maximum.accumulate(vs)                        # monotone against round-off
    fr = np.linspace(0.0, 1.0, n) * vt
    lut = np.interp(fr, vs, hs)
    lut[0], lut[-1] = z0, z1
    return vt, z0, z1, [float(x) for x in lut]


def rotate(verts, origin, axis, deg):
    v = np.asarray(verts, dtype=np.float64).reshape(-1, 3) - np.asarray(origin, dtype=np.float64)
    u = np.asarray(axis, dtype=np.float64)
    u = u / np.linalg.norm(u)
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    # Rodrigues
    rot = v * c + np.cross(u, v) * s + np.outer(v @ u, u) * (1 - c)
    return rot + np.asarray(origin, dtype=np.float64)


def check_closed(tris):
    """Number of edges not shared by exactly two triangles with opposite directions (0 = closed, consistent)."""
    t = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    edges = {}
    for a, b, c in t:
        for e in ((a, b), (b, c), (c, a)):
            edges[e] = edges.get(e, 0) + 1
    bad = 0
    for (a, b), n in edges.items():
        if n != 1 or edges.get((b, a), 0) != 1:
            bad += 1
    return bad


# ---------------------------------------------------------------- bpy side (exporter / validator hooks)

def _mesh_data(ob, dg):
    """World-space (part space) vertices and triangles of an evaluated cavity mesh."""
    from . import geom
    with geom.EvaluatedMesh(ob, dg) as me:
        me.calc_loop_triangles()
        mw = ob.matrix_world
        verts = [tuple(mw @ v.co) for v in me.vertices]
        tris = [tuple(lt.vertices) for lt in me.loop_triangles]
    return verts, tris


def _pivot_of(ob):
    p = ob.parent
    while p is not None and not p.name.startswith('PIVOT__'):
        p = p.parent
    return p


def art_entries(scene, dg, collection_objects, parse_name, blender_to_engine, round_list):
    out = []
    for ob in collection_objects(scene, 'CAVITY'):
        p = parse_name('CAVITY', ob.name)
        if not p or ob.type != 'MESH':
            continue
        entry = {'name': p['name'], 'matter': ob.get('matter', 'fill')}
        if 'capacity' in ob.keys():
            entry['capacity'] = float(ob['capacity'])
        if 'fill' in ob.keys():
            entry['fill'] = float(ob['fill'])
        verts, tris = _mesh_data(ob, dg)
        tri = tris_array(verts, tris)
        vol, z0, z1, lut = fill_lut(tri)
        ev = [blender_to_engine(v) for v in verts]
        entry['volume'] = round(vol * 1000.0, 5)
        entry['min'] = round_list([min(v[i] for v in ev) for i in range(3)])
        entry['max'] = round_list([max(v[i] for v in ev) for i in range(3)])
        entry['lut'] = [round(h, 5) + 0.0 for h in lut]
        entry['mesh'] = {'vertices': [round(float(x), 5) + 0.0 for v in ev for x in v],
                         'indices': [int(i) for t in tris for i in t]}
        piv = _pivot_of(ob)
        if piv is not None:
            name = piv.name[len('PIVOT__'):]
            entry['pivot'] = name
            if ob.get('tilt_lut', True) and 'min' in piv.keys() and 'max' in piv.keys():
                from mathutils import Vector
                local = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[piv.get('axis', 'z')]
                axis = (piv.matrix_world.to_3x3() @ local).normalized()
                origin = piv.matrix_world.translation
                lo, hi = float(piv['min']), float(piv['max'])
                steps = int(ob.get('tilt_steps', 7))
                angles = [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]
                luts = []
                for a in angles:
                    rv = rotate(verts, tuple(origin), tuple(axis), a)
                    luts.append([round(h, 5) + 0.0 for h in fill_lut(tris_array(rv, tris))[3]])
                entry['tilt'] = {'pivot': name, 'axis': round_list(blender_to_engine(axis), 6),
                                 'origin': round_list(blender_to_engine(origin)),
                                 'angles': [round(a, 4) for a in angles], 'luts': luts}
        out.append(entry)
    return out


def check(rep, scene, dg, collection_objects):
    """Validator hook (rule 10 for CAVITY__ meshes, §3.10): closed and consistently wound, positive volume, a known
    `matter`, a numeric `capacity` when present."""
    for ob in collection_objects(scene, 'CAVITY'):
        if ob.type != 'MESH':
            continue
        m = ob.get('matter')
        if m not in MATTERS:
            rep.error('10.cavity', ob.name, 'matter must be one of %s, got %r' % ('|'.join(MATTERS), m))
        if 'capacity' in ob.keys():
            c = ob['capacity']
            if not isinstance(c, (int, float)) or isinstance(c, bool) or c <= 0:
                rep.error('10.cavity', ob.name, 'capacity must be a positive number, got %r' % (c,))
        verts, tris = _mesh_data(ob, dg)
        if not tris:
            rep.error('10.cavity', ob.name, 'empty cavity mesh')
            continue
        bad = check_closed(tris)
        if bad:
            rep.error('10.cavity', ob.name, '%d open or inconsistently wound edges (the cavity must be closed and '
                                            'manifold for the fill LUT)' % bad)
            continue
        vol = total_volume(tris_array(verts, tris))
        if vol <= 0:
            rep.error('10.cavity', ob.name, 'cavity encloses no volume (normals face inward?)')
