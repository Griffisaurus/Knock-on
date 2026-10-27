"""BACKLOT terrain art (environments.md §4.2) and set dressing (§4.3) for stream S3's heightfield terrain.

Usage: blender -b --factory-startup -P tools/blender/props/env_backlot.py -- [--render <out.png>] [--no-blend]
   or: node tools/assets.mjs --env-backlot [--render]

Outputs (assets/build/env/backlot/)
  terrain/terrain_<layer>_basecolor.png   sRGB albedo, RGB + height in A (for height blending), tiling
  terrain/terrain_<layer>_normal.png      tangent-space normal (OpenGL, +Y up), tiling
  terrain/terrain_<layer>_orm.png         R occlusion, G roughness, B metalness, tiling
                                          layers: grass, dirt, sand, rock; 1024^2, one repeat = TILE_M metres
  backlot_arena.height.r16                the default Arena heightfield: 513 x 513 little-endian u16, 0.5 m spacing,
                                          height = v / 65535 * 64 m (bounds height); row j <-> engine z = -128 + 0.5 j
                                          (row 0 = the back / north edge), column i <-> engine x = -128 + 0.5 i
  backlot_arena.height.png                8-bit preview of the same
  backlot_dressing.glb                    node <piece> > v<k> > LOD0..LOD3 (piece space, Y-up), like kn_props.glb
  backlot.json                            the data contract with S3: heightfield format, layer rules, grass cover,
                                          service roads, and every dressing placement (engine coords) with colliders
  assets/src/env/backlot/backlot_dressing.blend   source
The heightfield is sim state (S3, terrain.stroke ops); this file is only the *default* the sim loads or reproduces.
"""
import json
import math
import os
import random
import struct
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import _cli  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from kn_tools import geom, library, paths  # noqa: E402
from kn_tools.conventions import is_master_material  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402
from props.backlot import BACKLOT, build_piece  # noqa: E402
from props.core import place  # noqa: E402
from props.envkit import clean, eng  # noqa: E402

N, SPACING, HALF, H_BOUNDS = 513, 0.5, 128.0, 64.0
GROUND = 4.0
TEX = 1024
TILE_M = 4.0
LAYERS = {  # albedo (flattened, toy), roughness, stylised detail
    'grass': ('#6E9A48', '#5C8A3C', 0.85), 'dirt': ('#8E6B4A', '#7A5A3E', 0.9),
    'sand': ('#D6BE8E', '#C8AE7E', 0.9), 'rock': ('#8B8580', '#77716C', 0.75),
}
ROADS = [[(-120.0, -36.0), (-60.0, -36.0), (-36.0, -20.0), (-36.0, 30.0), (20.0, 44.0), (60.0, 70.0)],
         [(36.0, -36.0), (70.0, -70.0), (120.0, -76.0)]]


# ---------------------------------------------------------------- tiling textures (numpy, periodic by FFT)

def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def fnoise(rng, n, f0, f1, power=1.0):
    """Periodic band-limited noise: white noise filtered to radial frequencies f0..f1 (cycles per tile)."""
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    fx = np.fft.fftfreq(n) * n
    r = np.sqrt(fx[None, :] ** 2 + fx[:, None] ** 2)
    filt = ((r >= f0) & (r <= f1)) / np.maximum(r, 1.0) ** power
    out = np.real(np.fft.ifft2(F * filt))
    out -= out.min()
    return out / max(out.max(), 1e-9)


def blobs(rng, n, count, radius):
    """Periodic field of round bumps (pebbles, clumps) via FFT convolution of random impulses."""
    imp = np.zeros((n, n))
    xs, ys = rng.integers(0, n, count), rng.integers(0, n, count)
    imp[ys, xs] = rng.uniform(0.6, 1.0, count)
    k = np.fft.fftfreq(n) * n
    d2 = (np.minimum(np.arange(n), n - np.arange(n)) ** 2)
    ker = np.exp(-(d2[None, :] + d2[:, None]) / (2 * radius ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(imp) * np.fft.fft2(ker)))
    _ = k
    out -= out.min()
    return out / max(out.max(), 1e-9)


def layer_height(name, n, rng):
    if name == 'grass':     # chunky clumps + fine blades noise
        h = 0.65 * blobs(rng, n, 900, n / 90) + 0.35 * fnoise(rng, n, 40, 160)
        h = np.round(h * 6) / 6 * 0.5 + h * 0.5            # a little posterised: toy, not photo
    elif name == 'dirt':    # pebbles over soft mounds
        h = 0.55 * blobs(rng, n, 420, n / 110) + 0.3 * fnoise(rng, n, 2, 10) + 0.15 * fnoise(rng, n, 60, 200)
    elif name == 'sand':    # wind ripples + grains
        y = np.arange(n)[:, None] / n
        x = np.arange(n)[None, :] / n
        warp = fnoise(rng, n, 1, 4)
        h = 0.6 * (0.5 + 0.5 * np.sin(2 * math.pi * (9 * y + 1.2 * warp + 0.0 * x))) + 0.4 * fnoise(rng, n, 80, 260)
    else:                   # rock: terraced, faceted chunks with cracks
        base = fnoise(rng, n, 2, 14)
        h = np.round(base * 7) / 7
        cracks = fnoise(rng, n, 20, 60)
        h = 0.8 * h + 0.2 * base - 0.25 * (np.abs(cracks - 0.5) < 0.02)
    h -= h.min()
    return h / max(h.max(), 1e-9)


def normal_from(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], axis=2)   # OpenGL convention (+Y up), rows top-down
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def save_png(path, arr, srgb=True):
    """arr: (rows top-down, cols, 3 or 4) floats 0..1."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(arr[::-1], dtype=np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def build_textures(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(42)
    report = {}
    for name, (a, b, rough) in LAYERS.items():
        h = layer_height(name, TEX, rng)
        var = fnoise(rng, TEX, 1, 6)
        ca, cb = hexrgb(a), hexrgb(b)
        t = np.clip(0.55 * h + 0.45 * var, 0, 1)[:, :, None]
        col = ca[None, None, :] * (1 - t) + cb[None, None, :] * t
        col *= (0.94 + 0.12 * h)[:, :, None]                        # albedo +-6 %: flattened, toy
        save_png(os.path.join(out_dir, 'terrain_%s_basecolor.png' % name),
                 np.concatenate([np.clip(col, 0, 1), h[:, :, None]], axis=2), srgb=True)
        save_png(os.path.join(out_dir, 'terrain_%s_normal.png' % name),
                 normal_from(h, {'grass': 6.0, 'dirt': 8.0, 'sand': 4.0, 'rock': 14.0}[name]), srgb=False)
        blur = h.copy()
        for _ in range(6):
            blur = (blur + np.roll(blur, 3, 0) + np.roll(blur, -3, 0) + np.roll(blur, 3, 1) + np.roll(blur, -3, 1)) / 5
        ao = np.clip(1.0 - 1.6 * np.maximum(blur - h, 0.0), 0.55, 1.0)
        rgh = np.clip(rough + 0.08 * (var - 0.5) - 0.05 * h, 0.4, 1.0)
        save_png(os.path.join(out_dir, 'terrain_%s_orm.png' % name),
                 np.stack([ao, rgh, np.zeros_like(h)], axis=2), srgb=False)
        report[name] = {'albedo': [round(float(c), 4) for c in col.reshape(-1, 3).mean(axis=0)],
                        'roughness': rough}
    return report


# ---------------------------------------------------------------- default heightfield (set coords: x east, y back)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def flatten(h, X, Y, cx, cy, r, blend, level):
    d = np.hypot(X - cx, Y - cy)
    w = 1.0 - smoothstep(r, r + blend, d)
    return h * (1 - w) + level * w


def heightfield():
    c = np.linspace(-HALF, HALF, N)
    X, Y = np.meshgrid(c, -c)             # rows top-down: row 0 = set y +128 (engine z -128)
    sw = (0.5 * np.sin(X / 23.0 + 1.3) * np.sin(Y / 31.0 - 0.7) + 0.3 * np.sin(X / 11.3 + Y / 17.1) +
          0.2 * np.cos(Y / 9.7 - X / 14.9))
    sw = np.clip(3.0 * sw / 0.85, -3.0, 3.0)
    plateau = np.maximum(np.abs(X), np.abs(Y))
    w = smoothstep(32.0, 50.0, plateau)
    h = GROUND + sw * w
    h += 20.0 * smoothstep(100.0, 122.0, Y) * (0.85 + 0.15 * np.sin(X / 13.0))       # the ridge, Y +110..+128
    h = flatten(h, X, Y, 70.0, 82.0, 12.0, 8.0, GROUND)                             # water tower pad
    for sx in (-1, 1):
        for sy in (-1, 1):
            h = flatten(h, X, Y, 96.0 * sx, 96.0 * sy, 4.0, 4.0, float(h[int((HALF - 96 * sy) / SPACING),
                                                                          int((HALF + 96 * sx) / SPACING)]))
    for ty in (-60.0, -40.0, -20.0):
        h = flatten(h, X, Y, -92.0, ty, 7.0, 5.0, GROUND)
    h = flatten(h, X, Y, -42.0, 34.0, 6.0, 5.0, GROUND)
    # service roads: a gentle cut-and-fill toward the ground level so they read as tracks
    for road in ROADS:
        for (ax, ay), (bx, by) in zip(road, road[1:]):
            vx, vy = bx - ax, by - ay
            L2 = vx * vx + vy * vy
            t = np.clip(((X - ax) * vx + (Y - ay) * vy) / L2, 0, 1)
            d = np.hypot(X - (ax + t * vx), Y - (ay + t * vy))
            k = (1.0 - smoothstep(3.0, 7.0, d)) * 0.6
            h = h * (1 - k) + GROUND * k
    return np.clip(h, 0.5, H_BOUNDS - 8.0), X, Y


def sample(h, x, y):
    """Bilinear height at set (x, y)."""
    fi, fj = (x + HALF) / SPACING, (HALF - y) / SPACING
    i0, j0 = int(min(N - 2, max(0, math.floor(fi)))), int(min(N - 2, max(0, math.floor(fj))))
    u, v = fi - i0, fj - j0
    return float(h[j0, i0] * (1 - u) * (1 - v) + h[j0, i0 + 1] * u * (1 - v) + h[j0 + 1, i0] * (1 - u) * v +
                 h[j0 + 1, i0 + 1] * u * v)


def sim_lot(path):
    """S3's default lot (export_default_lot.ts, from packages/format defaultTerrain): the ground the sim builds.
    Same layout as ours: rows along +z from z = -128, so row j is set y = 128 - 0.5 j."""
    q = np.fromfile(path, dtype='<u2')
    if q.size != N * N:
        return None
    return q.reshape(N, N).astype(np.float64) / 65535.0 * H_BOUNDS


def ground_under(h, x, y, r):
    """Lowest ground over a piece's footprint (centre and 8 points at radius r): pieces sit into slopes, never
    float over them."""
    pts = [(x, y)] + [(x + r * math.cos(a * math.pi / 4), y + r * math.sin(a * math.pi / 4)) for a in range(8)]
    return min(sample(h, px, py) for px, py in pts)


FOOT = {'water_tower': 6.3, 'light_tower': 1.2, 'trailer': 4.5, 'soundstage': 25.0, 'tree_oak': 0.5,
        'tree_poplar': 0.3, 'rock_outcrop': 1.2, 'fence': 2.0, 'hay_bale': 0.5}


def write_height(out_dir, h):
    q = np.round(h / H_BOUNDS * 65535).astype('<u2')
    with open(os.path.join(out_dir, 'backlot_arena.height.r16'), 'wb') as f:
        f.write(q.tobytes())
    g = (h - h.min()) / (h.max() - h.min())
    save_png(os.path.join(out_dir, 'backlot_arena.height.png'), np.stack([g, g, g], axis=2), srgb=False)
    return q


def layer_weights(h):
    """The §4.2 layer rules on the default heightfield (what the engine computes procedurally)."""
    gy, gx = np.gradient(h, SPACING)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    rock = smoothstep(34.0, 42.0, slope)
    sand = (1.0 - rock) * (1.0 - smoothstep(GROUND - 1.6, GROUND - 0.6, h))
    return slope, rock, sand


# ---------------------------------------------------------------- dressing

def placements(h):
    """Every dressing placement in set coordinates: (piece, variant, x, y, yaw, backdrop)."""
    rng = random.Random(4)
    P = [('water_tower', 0, 70.0, 82.0, 15.0, False)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            yaw = math.degrees(math.atan2(sx, -sy))
            P.append(('light_tower', 0, 96.0 * sx, 96.0 * sy, yaw, False))
            for k in range(3):
                a = k * 2.1
                P.append(('sandbag', 0, 96.0 * sx + 1.6 * math.cos(a), 96.0 * sy + 1.6 * math.sin(a), k * 40.0, False))
    for ty in (-60.0, -40.0, -20.0):
        P.append(('trailer', 0, -92.0, ty, 90.0, False))
    P.append(('directors_chair', 0, 20.3, -18.4, -20.0, False))
    for i, (dx, dy, v) in enumerate(((0, 0, 0), (0.6, 0.1, 1), (0.1, 0.5, 2), (-0.5, 0.3, 3))):
        P.append(('apple_box', v, 23.5 + dx, -15.0 + dy, 8 * i, False))
    for i in range(6):
        P.append(('hay_bale', 0, -40.0 + (i % 3) * 1.2, -72.0 + (i // 3) * 0.6, rng.uniform(-6, 6), False))
    for i in range(10):
        P.append(('fence', 0, 42.0 + i * 4.0, -92.0, 0.0, False))
    for i in range(8):
        P.append(('traffic_cone', 0, -36.0 + rng.uniform(-3, 3), -20.0 + i * 6.0, 0.0, False))

    def free(x, y, clear=20.0):
        return max(abs(x), abs(y)) > 16.0 + clear and all(math.hypot(x - q[2], y - q[3]) > 6 for q in P)

    n = 0
    while n < 70:                        # tree belts (Y > +100, X < -110) and groves
        if n < 34:
            x, y = rng.uniform(-125, 125), rng.uniform(100, 126)
        elif n < 56:
            x, y = rng.uniform(-126, -110), rng.uniform(-120, 100)
        else:
            x, y = rng.uniform(-120, 120), rng.uniform(-120, 120)
        if not free(x, y):
            continue
        kind = 'tree_poplar' if rng.random() < 0.3 else 'tree_oak'
        P.append((kind, rng.randrange(3), x, y, rng.uniform(0, 360), False))
        n += 1
    n = 0
    while n < 40:
        x, y = rng.uniform(-124, 124), rng.uniform(-124, 124)
        if free(x, y, 8.0):
            P.append(('bush', rng.randrange(4), x, y, rng.uniform(0, 360), False))
            n += 1
    for i in range(10):
        x, y = rng.uniform(-110, 110), rng.uniform(104, 120)
        P.append(('rock_outcrop', i % 6, x, y, rng.uniform(0, 360), False))
    for i in range(6):                   # soundstage row: the Arena's backdrop (outside the bounds)
        P.append(('soundstage', i, -200.0 + i * 80.0, 200.0, 0.0, True))
    return P


def build_dressing(root, h, out_dir, save_blend):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    created = []
    plan, kits_all = [], []
    used = sorted({(p[0], p[1] % BACKLOT[p[0]]['variants']) for p in placements(h)})
    for name, v in used:
        kits = []
        for lod in range(4):
            k = Kit()
            build_piece(name, k, None, lod, v)
            clean(k.bm)
            kits.append(k)
        cols = []
        build_piece(name, Kit(), None, 0, v, cols)
        plan.append((name, v, kits, cols))
        kits_all += kits
    names = sorted({m for k in kits_all for m in k.mats})
    bad = [m for m in names if not is_master_material(m)]
    if bad:
        _cli.die('not master materials: %s' % ', '.join(bad))
    mats = library.link_materials(paths.materials_lib(root), names)
    roots, index = {}, {}
    for name, v, kits, cols in plan:
        if name not in roots:
            e = bpy.data.objects.new(name, None)
            sc.collection.objects.link(e)
            roots[name] = e
            created.append(e)
            index[name] = {'class': BACKLOT[name]['cls'], 'budget': BACKLOT[name]['budget'],
                           'desc': BACKLOT[name]['desc'], 'v': {}}
        ve = bpy.data.objects.new('%s__v%d' % (name, v), None)
        sc.collection.objects.link(ve)
        ve.parent = roots[name]
        tris = []
        for lod, k in enumerate(kits):
            le = bpy.data.objects.new('%s__v%d__LOD%d' % (name, v, lod), None)
            sc.collection.objects.link(le)
            le.parent = ve
            tris.append(k.tris())
            ob = geom.object_from_bmesh('%s__v%d__L%d' % (name, v, lod), k.bm, [mats[m] for m in k.mats], sc.collection)
            geom.set_sharp_by_angle(ob.data, 40)
            ob.parent = le
        index[name]['v'][str(v)] = {'lodTris': tris}
    if save_blend:
        src = os.path.join(root, 'assets', 'src', 'env', 'backlot', 'backlot_dressing.blend')
        os.makedirs(os.path.dirname(src), exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=src, compress=True, relative_remap=True)
    for ob in sc.objects:
        ob.select_set(True)
    glb = os.path.join(out_dir, 'backlot_dressing.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False, export_materials='EXPORT', export_image_format='NONE',
                              export_texcoords=False, export_normals=True, export_tangents=False,
                              export_draco_mesh_compression_enable=False, export_skins=False, export_morph=False)
    # placements with world colliders (engine coords; Arena and Megastructure share the origin)
    out = []
    for name, v, x, y, yaw, backdrop in placements(h):
        v = v % BACKLOT[name]['variants']
        z = ground_under(h, x, y, FOOT.get(name, 0.25)) if abs(x) <= HALF and abs(y) <= HALF else GROUND
        cols = []
        if not backdrop:
            build_piece(name, Kit(), place(x, y, z - 0.05, yaw), 0, v, cols)
        cl = []
        for c in cols:
            if c['kind'] == 'box':
                a, b = eng(c['lo']), eng(c['hi'])
                mn = [min(a[i], b[i]) for i in range(3)]
                mx = [max(a[i], b[i]) for i in range(3)]
                cl.append({'center': [round((mn[i] + mx[i]) / 2, 3) for i in range(3)],
                           'half': [round((mx[i] - mn[i]) / 2, 3) for i in range(3)], 'phys': c['phys']})
        out.append({'piece': name, 'variant': v, 'pos': eng((x, y, z - 0.05)), 'yawDeg': round(yaw, 2),
                    'backdropArena': backdrop, 'boxes': cl})
    return glb, index, out


def render_preview(root, h, out_png, dressing):
    """Afternoon aerial of the Arena with the layer rules painted from the default heightfield (look-dev)."""
    import render_lookdev as rl
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    step = 4
    hs = h[::step, ::step]
    n = hs.shape[0]
    c = np.linspace(-HALF, HALF, n)
    verts = [(float(c[i]), float(-c[j]), float(hs[j, i])) for j in range(n) for i in range(n)]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i) for j in range(n - 1) for i in range(n - 1)]
    me = bpy.data.meshes.new('terrain')
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    slope, rock, sand = layer_weights(h)
    attr = me.color_attributes.new('layers', 'FLOAT_COLOR', 'POINT')
    rs, ss = rock[::step, ::step], sand[::step, ::step]
    for j in range(n):
        for i in range(n):
            x, y = c[i], -c[j]
            dirt = 0.0
            for road in ROADS:
                for (ax, ay), (bx, by) in zip(road, road[1:]):
                    vx, vy = bx - ax, by - ay
                    t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
                    d = math.hypot(x - (ax + t * vx), y - (ay + t * vy))
                    dirt = max(dirt, 1.0 - min(1.0, max(0.0, (d - 2.0) / 3.0)))
            attr.data[j * n + i].color = (0.0, dirt, float(ss[j, i]), float(rs[j, i]))
    ob = bpy.data.objects.new('terrain', me)
    sc.collection.objects.link(ob)
    m = bpy.data.materials.new('terrain')
    m.use_nodes = True
    nt = m.node_tree
    pb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / TILE_M, 1 / TILE_M, 1 / TILE_M)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'layers'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(ca.outputs['Color'], sep.inputs['Color'])
    tdir = os.path.join(root, 'assets', 'build', 'env', 'backlot', 'terrain')
    texs = {}
    for name in LAYERS:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(tdir, 'terrain_%s_basecolor.png' % name))
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        texs[name] = t
    cur = texs['grass'].outputs['Color']
    for name, ch in (('dirt', 'Green'), ('sand', 'Blue')):
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        nt.links.new(sep.outputs[ch], mix.inputs['Factor'])
        nt.links.new(cur, mix.inputs['A'])
        nt.links.new(texs[name].outputs['Color'], mix.inputs['B'])
        cur = mix.outputs['Result']
    rk = nt.nodes.new('ShaderNodeVertexColor')
    rk.layer_name = 'layers'
    mixr = nt.nodes.new('ShaderNodeMix')
    mixr.data_type = 'RGBA'
    nt.links.new(rk.outputs['Alpha'], mixr.inputs['Factor'])
    nt.links.new(cur, mixr.inputs['A'])
    nt.links.new(texs['rock'].outputs['Color'], mixr.inputs['B'])
    nt.links.new(mixr.outputs['Result'], pb.inputs['Base Color'])
    pb.inputs['Roughness'].default_value = 0.88
    me.materials.append(m)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'assets', 'build', 'env', 'backlot', 'backlot_dressing.glb'))
    imported = [mm for mm in bpy.data.materials if not mm.library and mm.name.split('.')[0].startswith('kn_')]
    masters = library.link_materials(paths.materials_lib(root), sorted({mm.name.split('.')[0] for mm in imported}))
    for mm in imported:
        mm.user_remap(masters[mm.name.split('.')[0]])
    srcs = {}
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.split('.')[0].endswith('__L0'):
            srcs[o.name.split('.')[0][:-4]] = o
    for d in dressing:
        src = srcs.get('%s__v%d' % (d['piece'], d['variant']))
        if src is None:
            continue
        inst = src.copy()
        inst.parent = None
        sc.collection.objects.link(inst)
        e = d['pos']
        inst.matrix_world = place(e[0], -e[2], e[1], d['yawDeg'])
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and '__L' in o.name and o.parent is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.68, 0.9, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy, sun.color, sun.angle = 4.5, (1.0, 0.95, 0.88), math.radians(1.0)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    el, az = math.radians(50), math.radians(220)
    to_sun = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    so.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('Camera')
    cd.lens, cd.clip_end = 32, 3000
    cam = bpy.data.objects.new('Camera', cd)
    sc.collection.objects.link(cam)
    cam.location = (40.0, -150.0, 75.0)
    cam.rotation_euler = (Vector((0.0, 30.0, 4.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    rl.use_cycles(sc, 64)
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.3
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('rendered', out_png)


def main():
    args = _cli.script_args()
    out_png = _cli.option(args, '--render')
    sim_path = _cli.option(args, '--sim-lot')
    no_blend = _cli.flag(args, '--no-blend')
    root = paths.repo_root(HERE)
    library.ensure_libs(root)
    out_dir = os.path.join(root, 'assets', 'build', 'env', 'backlot')
    os.makedirs(out_dir, exist_ok=True)
    tex = build_textures(os.path.join(out_dir, 'terrain'))
    h, X, Y = heightfield()
    source = 'art fallback generator (env_backlot.heightfield)'
    if sim_path and os.path.exists(sim_path):
        hs = sim_lot(sim_path)
        if hs is not None:
            h, source = hs, 'S3 packages/format/src/terrain.ts defaultTerrain(arena) via export_default_lot.ts'
    print('heightfield source:', source)
    write_height(out_dir, h)
    slope, rock, sand = layer_weights(h)
    glb, index, dressing = build_dressing(root, h, out_dir, not no_blend)
    data = {
        'env': 'backlot',
        'heightfield': {
            'file': 'env/backlot/backlot_arena.height.r16', 'preset': 'arena', 'samples': [N, N], 'spacing': SPACING,
            'origin': [-HALF, 0.0, -HALF], 'encoding': 'u16 little-endian, height = v / 65535 * boundsHeight',
            'boundsHeight': H_BOUNDS, 'rowAxis': '+z (row 0 at z = -128, the back)', 'colAxis': '+x (col 0 at x = -128)',
            'defaultGround': GROUND, 'bedrock': 0.5, 'maxRaise': H_BOUNDS - 8.0, 'source': source,
            'chunks': {'size': 32, 'samples': 65, 'note': 'COL__heightfield__<cx>_<cy>: 65 x 65 with shared edges, '
                                                          'Jolt HeightFieldShape block size 4 (environments.md §0.6)'},
            'megastructure': 'same generator scaled: defaultGround 16, 2049 x 2049; S3 regenerates or deforms it',
            'stats': {'min': round(float(h.min()), 3), 'max': round(float(h.max()), 3),
                      'rockFraction': round(float((rock > 0.5).mean()), 4), 'sandFraction': round(float((sand > 0.5).mean()), 4)},
        },
        'layers': {
            'order': ['grass', 'dirt', 'sand', 'rock'], 'tileMeters': TILE_M, 'size': TEX,
            'files': {n: {'basecolor': 'env/backlot/terrain/terrain_%s_basecolor.png' % n,
                          'normal': 'env/backlot/terrain/terrain_%s_normal.png' % n,
                          'orm': 'env/backlot/terrain/terrain_%s_orm.png' % n} for n in LAYERS},
            'masters': {n: 'kn_env_' + n for n in LAYERS}, 'meanAlbedo': {n: tex[n]['albedo'] for n in tex},
            'heightInBaseColorAlpha': True, 'normalConvention': 'OpenGL (+Y up)',
            'rules': {'rockSlopeDeg': 38, 'rockBlendDeg': 8, 'rockTriplanarAboveDeg': 50,
                      'sandBelowGround': 1.0, 'sandAlsoIn': 'creek bed (Mega)',
                      'dirt': 'disturbed mask (R8, 1.0 under raise / lower strokes, decays over 3 run-stop cycles) '
                              'and the service roads', 'grass': 'everywhere else',
                      'splat': 'RGBA8 at heightfield resolution: R grass, G dirt, B sand, A rock (Arena 512^2)'},
            'grassCover': {'cardsPerClump': 3, 'trisPerClump': 24, 'radiusM': {'12GB': 40, '16GB': 80},
                           'resident': {'12GB': 150000, '16GB': 400000}, 'clearUnderParts': True},
        },
        'roads': [[eng((x, y, GROUND))[0::2] for x, y in r] for r in ROADS],
        'dressing': {'glb': 'env/backlot/backlot_dressing.glb', 'pieces': index, 'placements': dressing,
                     'note': 'pos = piece origin on the default ground (engine metres, Arena = Mega origin); boxes are '
                             'static colliders; backdropArena pieces have no colliders in the Arena (outside bounds)'},
    }
    with open(os.path.join(out_dir, 'backlot.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    tot = sum(index[d['piece']]['v'][str(d['variant'])]['lodTris'][0] for d in dressing if not d['backdropArena'])
    print('backlot: heightfield %d^2 (%.2f .. %.2f m), %d placements (%d LOD0 tris in bounds), %d colliders, glb %d bytes'
          % (N, h.min(), h.max(), len(dressing), tot, sum(len(d['boxes']) for d in dressing), os.path.getsize(glb)))
    for name in sorted(index):
        print('  %-16s %s' % (name, ', '.join('v%s %s' % (k, '/'.join(str(t) for t in v['lodTris']))
                                             for k, v in sorted(index[name]['v'].items()))))
    _ = (X, Y, slope, struct)
    if out_png:
        render_preview(root, h, os.path.abspath(out_png), dressing)


main()
