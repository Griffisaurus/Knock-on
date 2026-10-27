"""Per-part texture sets (ASSET_PIPELINE v1.1 §5.2, D78 "loved, not grimy"), M3 stream E3c.

One set per part (`body`): albedo (basecolor), normal and ORM, baked in Cycles from procedural tactile
materials (the production versions of the `_tactile.py` look-dev stand-ins, held to the ART_BIBLE §4 wear
limits) onto a unique UV1 atlas that covers every textured slot of all four LODs.

    texture_part(scene)          UV1 + bake + source PNGs + image datablocks + root props (`--tex` step)
    export_set(scene, ...)       build PNGs + `.art.json textures` + glb material extras `texSet`
    check(rep, scene, root, info) validator check 13

Files (the L3 contract, docs/dev/M3_NOTES_E3c.md):
    source  assets/src/<family>/tex/<type>__body__basecolor.png   sRGB, 8-bit RGB
            assets/src/<family>/tex/<type>__body__normal.png      linear, 16-bit RGB, OpenGL +Y (tangent space)
            assets/src/<family>/tex/<type>__body__orm.png         linear, 8-bit RGB (R occlusion, G rough, B metal)
    build   assets/build/parts/<type>/<type>.tex.albedo.png       = basecolor (sRGB 8-bit)
            assets/build/parts/<type>/<type>.tex.normal.png       8-bit RGB, OpenGL +Y
            assets/build/parts/<type>/<type>.tex.orm.png          linear 8-bit RGB
PNG rows are written top-first in glTF UV orientation (texel row = (1 - v_blender) * size = v_gltf * size).

UV1 atlas: one Smart UV Project over the textured faces of LOD0..LOD3 packed together; LOD1/2/3 islands are
scaled 0.5 / 0.35 / 0.25 before packing so LOD0 holds about 70 % of the atlas. Every LOD is baked from its own
geometry (no projection between LODs), so occlusion and worn edges are exact per LOD. Exempt masters
(§5.2: poly, glass, chrome, LED, screen, decal; plus interiors, which only ride FRAC chunks) take no atlas
space and are never sampled (no `texSet` flag on their glb material).
"""
import math
import os
import shutil
import struct
import zlib

import bpy
import numpy as np

from . import paths, template
from .conventions import LOD_COLLECTIONS
from .masters import master_table

SET = 'body'
MAPS = ('basecolor', 'normal', 'orm')
BUILD_NAMES = {'basecolor': 'albedo', 'normal': 'normal', 'orm': 'orm'}
COLORSPACE = {'basecolor': 'sRGB', 'normal': 'Non-Color', 'orm': 'Non-Color'}
EXEMPT_PREFIXES = ('kn_poly_', 'kn_glass', 'kn_chrome', 'kn_led', 'kn_screen', 'kn_decal', 'kn_interior_')
LOD_UV_SCALE = {'RENDER': 1.0, 'LOD1': 0.5, 'LOD2': 0.35, 'LOD3': 0.25}
# §4 instancing-heavy: one 1024² set. Art type ids (MARBLE is the one mesh for the GLINT / BEARING defs).
INSTANCING = ('brik', 'topple_tile', 'stacker', 'pin', 'marble', 'glint', 'bearing')
ALBEDO_MIN, ALBEDO_MAX = 0.03, 0.85      # ART_BIBLE §3.1 linear albedo range
VALUE_TOL = 0.04                          # ART_BIBLE §3.1: ±4 % value against the master
HUE_TOL_DEG = 8.0
METAL_SOFT_PX = 4                         # §9.13: metallic is 0 or 1, soft edges <= 4 px
NORMAL_Y = '+Y'                           # OpenGL
UV_ANGLE = 60.0                           # Smart UV Project angle limit (degrees)
HIDDEN_ATTR = 'kn_hidden'                 # interior faces (face attribute, not exported)
VERSION = 1


def is_exempt(name):
    return name.startswith(EXEMPT_PREFIXES)


# M4 (stream E4c): parts whose brief class is XL (the critter class, 4096²) but which are parts: PEDAL RIG is XL
# by footprint (14.5k tris, an L budget). The renderer's set arrays are 1024² / 2048² only (L3), so it takes L's.
SIZE_OVERRIDES = {'pedal_rig': 2048}
# M4 (stream E4b): robot critters take 2048² (ASSET_PIPELINE §4 XL row: "robot critters 2048²").
SIZE_OVERRIDES.update({'dusty': 2048})
# M5 (stream E5b): BUZZ, the second robot critter, likewise.
SIZE_OVERRIDES.update({'buzz': 2048})


def set_size(cls, ptype):
    """§5.2: S 1024² · M 2048² · L 2048² · instancing-heavy 1024²."""
    if ptype in SIZE_OVERRIDES:
        return SIZE_OVERRIDES[ptype]
    if ptype in INSTANCING:
        return 1024
    return {'S': 1024, 'M': 2048, 'L': 2048, 'XL': 4096}.get(cls, 1024)


def pad_px(size):
    return 4 if size <= 1024 else 8


def island_gap(size, ptype=None):
    """Pack gap between UV islands, in texels. M1 / M3 sets: 2 x padding (8 px at 1024², 16 px at 2048²).
    M4 (E4c): the M2 parts use the §4 / §5.2 padding itself as the gap (4 px at 1024², 8 px at 2048²): they carry
    hundreds of small islands (cage bars, rivets, coils; TRAP BOX 850 at LOD0), where a 2 x gap left 84 % of the tile
    to gaps (626 px/m; 1 x: 794). Push-pull fill keeps gap texels at the neighbouring island's colour."""
    if ptype is None:
        root = template.find_root(bpy.context.scene)
        ptype = root.get('kn_type') if root is not None else None
    return (1 if ptype in M2_TYPES or ptype in ONE_GAP else 2) * pad_px(size)


# M5 (stream E5b): sets that also pack at the 1 x padding gap: BUZZ carries hundreds of small hard-surface islands
# (12 rotor blades, duct struts, skids, claw fingers), where the 2 x gap left most of the tile to gaps.
ONE_GAP = ('buzz',)


def src_dir(root_dir, family):
    return os.path.join(root_dir, 'assets', 'src', family, 'tex')


def src_name(ptype, m):
    return '%s__%s__%s' % (ptype, SET, m)


def build_name(ptype, m):
    return '%s.tex.%s.png' % (ptype, BUILD_NAMES[m])


def _master(slot):
    m = slot.material
    if not m:
        return None
    n = m.name.split('.')[0]
    if n.startswith('__bake__'):  # a BakeMat standing in for its master during texture_part
        n = n[len('__bake__'):].split('__')[0]
    return n


def _lod_objects(scene):
    from .validate import collection_objects
    out = []
    for col in LOD_COLLECTIONS:
        for ob in collection_objects(scene, col):
            if ob.type == 'MESH':
                out.append((col, ob))
    return out


def textured_objects(scene):
    """(collection, object) for every LOD mesh with at least one non-exempt master."""
    return [(c, ob) for c, ob in _lod_objects(scene)
            if any(_master(s) and not is_exempt(_master(s)) for s in ob.material_slots)]


def textured_masters(scene):
    seen = []
    for _c, ob in textured_objects(scene):
        for s in ob.material_slots:
            k = _master(s)
            if k and not is_exempt(k) and k not in seen:
                seen.append(k)
    return seen


# ---------------------------------------------------------------- colour helpers

def srgb_to_linear(a):
    a = np.asarray(a, dtype=np.float64)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = np.clip(np.asarray(a, dtype=np.float64), 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def hex_linear(h):
    h = h.lstrip('#')
    return srgb_to_linear([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def fit_range(rgb):
    """Hue-preserving fit of a linear colour into the albedo range: peak <= 0.85, peak >= 0.045 (so darkened
    recesses stay >= 0.03). Rubber #1C1E22 (peak 0.016) is the one master this lifts."""
    rgb = np.asarray(rgb, dtype=np.float64)
    m = float(rgb.max())
    if m > ALBEDO_MAX:
        rgb = rgb * (ALBEDO_MAX / m)
    elif m < 0.045:
        rgb = rgb * (0.045 / max(m, 1e-4))
    return rgb


def reference_colour(master):
    """The linear colour a slot's mean must match (master swatch, capped as materials.blend stores it)."""
    spec = master_table().get(master)
    if spec is None:
        return None
    rgb = hex_linear(spec['base'])
    if rgb.max() > 0.85:  # library.hexcol: peak channel capped at 0.85 linear, hue kept
        rgb = rgb * (0.85 / rgb.max())
    return fit_range(rgb)


def hsv(rgb):
    r, g, b = (float(x) for x in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d < 1e-6:
        h = 0.0
    elif mx == r:
        h = 60.0 * (((g - b) / d) % 6)
    elif mx == g:
        h = 60.0 * ((b - r) / d + 2)
    else:
        h = 60.0 * ((r - g) / d + 4)
    return h, (d / mx if mx > 1e-6 else 0.0), mx


# ---------------------------------------------------------------- PNG I/O (numpy + zlib; exact bytes)

def _chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)


def write_png(path, arr):
    """arr: H x W x C (C = 1, 3, 4), uint8 or uint16, top row first. Paeth-filtered, zlib level 6."""
    arr = np.ascontiguousarray(arr)
    h, w, c = arr.shape
    depth = 16 if arr.dtype == np.uint16 else 8
    raw = (arr.astype('>u2') if depth == 16 else arr.astype(np.uint8)).view(np.uint8).reshape(h, -1)
    bpp = c * depth // 8
    a = np.zeros_like(raw, dtype=np.int16)
    a[:, bpp:] = raw[:, :-bpp]
    b = np.zeros_like(a)
    b[1:] = raw[:-1]
    cc = np.zeros_like(a)
    cc[1:, bpp:] = raw[:-1, :-bpp]
    p = a + b - cc
    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - cc)
    pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, cc))
    filt = ((raw.astype(np.int16) - pred) & 0xff).astype(np.uint8)
    payload = np.hstack([np.full((h, 1), 4, np.uint8), filt]).tobytes()
    ctype = {1: 0, 3: 2, 4: 6}[c]
    png = (b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, depth, ctype, 0, 0, 0)) +
           _chunk(b'IDAT', zlib.compress(payload, 6)) + _chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def png_info(path):
    """(width, height, bit depth, colour type) from the IHDR chunk."""
    with open(path, 'rb') as f:
        head = f.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise ValueError('%s is not a PNG' % path)
    w, h, depth, ctype = struct.unpack('>IIBB', head[16:26])
    return w, h, depth, ctype


def image_array(img):
    """Image pixels as H x W x 4 float32, Blender orientation (row 0 = v 0), stored values (no colour
    management: byte sRGB images give encoded values)."""
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)


# ---------------------------------------------------------------- node helper

class _NT:
    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        self.bsdf = self.nt.nodes.new('ShaderNodeBsdfPrincipled')
        self._geo = None
        self._co = None

    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if hasattr(node, k) and not k[0].isupper():
                setattr(node, k, v)
            else:
                node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def feed(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, (tuple, list, np.ndarray)):
            v = [float(x) for x in v]
            sock.default_value = v + [1.0] if len(v) == 3 and len(sock.default_value) == 4 else v
        else:
            self.link(v, sock)

    @property
    def geo(self):
        if self._geo is None:
            self._geo = self.n('ShaderNodeNewGeometry')
        return self._geo

    def co(self, scale=(1.0, 1.0, 1.0), offset=(0.0, 0.0, 0.0)):
        if self._co is None:
            self._co = self.n('ShaderNodeTexCoord')
        mp = self.n('ShaderNodeMapping')
        mp.inputs['Location'].default_value = offset
        mp.inputs['Scale'].default_value = scale
        self.link(self._co.outputs['Object'], mp.inputs['Vector'])
        return mp.outputs['Vector']

    def noise(self, vec, scale, detail=3.0, rough=0.55):
        nz = self.n('ShaderNodeTexNoise', noise_dimensions='3D', Scale=scale, Detail=detail, Roughness=rough)
        self.link(vec, nz.inputs['Vector'])
        return nz.outputs['Fac']

    def math(self, op, a, b=0.0, clamp=False):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(m.inputs[0], a)
        self.feed(m.inputs[1], b)
        return m.outputs['Value']

    def mr(self, val, a, b, lo=0.0, hi=1.0, smooth=False):
        m = self.n('ShaderNodeMapRange', clamp=True, interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR')
        self.feed(m.inputs['Value'], val)
        m.inputs['From Min'].default_value = a
        m.inputs['From Max'].default_value = b
        m.inputs['To Min'].default_value = lo
        m.inputs['To Max'].default_value = hi
        return m.outputs['Result']

    @staticmethod
    def _sock(socks, name, kind):
        return next(x for x in socks if x.name == name and x.type == kind)

    def mix(self, fac, a, b, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=False)
        self.feed(self._sock(m.inputs, 'Factor', 'VALUE'), fac)
        self.feed(self._sock(m.inputs, 'A', 'RGBA'), a)
        self.feed(self._sock(m.inputs, 'B', 'RGBA'), b)
        return self._sock(m.outputs, 'Result', 'RGBA')

    def mixf(self, fac, a, b):
        m = self.n('ShaderNodeMix', data_type='FLOAT', clamp_result=False)
        self.feed(self._sock(m.inputs, 'Factor', 'VALUE'), fac)
        self.feed(self._sock(m.inputs, 'A', 'VALUE'), a)
        self.feed(self._sock(m.inputs, 'B', 'VALUE'), b)
        return self._sock(m.outputs, 'Result', 'VALUE')

    def scale(self, col, k):
        """col * k (k a float or a value socket)."""
        return self.mix(1.0, col, k if not isinstance(k, (int, float)) else (k, k, k), blend='MULTIPLY') \
            if isinstance(k, (int, float)) else self.mix(1.0, col, self._grey(k), blend='MULTIPLY')

    def _grey(self, v):
        c = self.n('ShaderNodeCombineColor')
        for ch in ('Red', 'Green', 'Blue'):
            self.feed(c.inputs[ch], v)
        return c.outputs['Color']

    def lerpk(self, fac, k0, k1):
        """Scalar k0..k1 by fac."""
        return self.mixf(fac, k0, k1)

    def ao(self, dist):
        a = self.n('ShaderNodeAmbientOcclusion', only_local=True, samples=16)
        a.inputs['Distance'].default_value = dist
        return a.outputs['AO']

    def bevel_normal(self, radius, samples=8):
        b = self.n('ShaderNodeBevel', samples=samples)
        b.inputs['Radius'].default_value = radius
        return b.outputs['Normal']

    def dot(self, a, b):
        v = self.n('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.feed(v.inputs[0], a)
        self.feed(v.inputs[1], b)
        return v.outputs['Value']

    def near_edge(self, radius):
        """0 on flat faces, -> 1 within `radius` of an edge or on a modelled round (Bevel vs shading normal)."""
        d = self.dot(self.bevel_normal(radius), self.geo.outputs['Normal'])
        return self.mr(d, 0.9995, 0.97)

    def convex(self, lo, hi):
        return self.mr(self.geo.outputs['Pointiness'], lo, hi)

    def endness(self, axis):
        a = {'X': (1.0, 0.0, 0.0), 'Y': (0.0, 1.0, 0.0), 'Z': (0.0, 0.0, 1.0)}[axis]
        d = self.dot(self.geo.outputs['Normal'], a)
        return self.mr(self.math('ABSOLUTE', d), 0.72, 0.92)


# ---------------------------------------------------------------- looks

LOOKS = (
    ('kn_powder_', 'enamel'), ('kn_anod_', 'anod'), ('kn_steel_', 'steel'), ('kn_brass', 'patina'),
    ('kn_copper', 'patina'), ('kn_iron_cast', 'iron'), ('kn_wood_', 'wood'), ('kn_paper_', 'paper'),
    ('kn_cardboard', 'paper'), ('kn_rubber', 'rubber'), ('kn_brick', 'brick'), ('kn_rope', 'cord'),
    ('kn_fuse_cord', 'cord'), ('kn_wax', 'wax'), ('kn_latex_', 'latex'), ('kn_ceramic_', 'ceramic'),
    ('kn_fabric_', 'fabric'),
)

# Per-part look overrides from the briefs (+ D78). Keys: (type, master) -> dict.
OVERRIDES = {
    ('boing', 'kn_powder_ignition'): {'look': 'pebble', 'rough': 0.62},   # rollers.md: own ORM 0.62 + pebble
    ('the_button', 'kn_powder_ignition_gloss'): {'wear': 0.6},            # hero cap: polish, little wear
    ('bangstick', 'kn_paper_red'): {'print': True},
    ('bangstick', 'kn_paper_tan'): {'print': True},
    ('plank', 'kn_wood_oak'): {'axis': 'Y'},
}

# M4 (stream E4c): the M2 parts' texture pass. Looks only these parts use ('felt', 'grip') are keyed here, so the
# M1 / M3 sets re-bake unchanged.
M2_TYPES = ('stitch', 'fuzz', 'pig_iron', 'gutter', 'vortex', 'sprong', 'trap_box', 'scoop', 'flap', 'dynamo',
            'hamster_drive', 'turbine', 'pedal_rig', 'puffer', 'cell', 'suncell', 'lamp', 'torch', 'burning_glass',
            'toggle', 'ringer', 'delay', 't_plunger', 'skyrocket', 'big_top', 'cork_blaster', 'punchline',
            'gotcha_box', 'fishbowl')
for _t in M2_TYPES:
    OVERRIDES[(_t, 'kn_rubber_grip')] = {'look': 'grip'}        # ART_BIBLE §4: `_grip` adds a knurl normal
OVERRIDES.update({
    ('stitch', 'kn_fabric_ignition'): {'look': 'cord'},         # rollers.md: chunky waxed-thread stitches
    ('fuzz', 'kn_fabric_amber'): {'look': 'felt'},              # rollers.md: felt, sheen + a fuzz normal
    ('sprong', 'kn_fabric_graphite'): {'look': 'felt', 'fuzz': 0.6},  # the landing mat: tighter felt
    ('pig_iron', 'kn_anod_graphite'): {'look': 'iron'},         # rollers.md: cast body, 0.3 mm cast pitting
    ('skyrocket', 'kn_paper_red'): {'print': True},             # printed double rules on the tube, like BANGSTICK
    ('cork_blaster', 'kn_powder_ignition_gloss'): {'wear': 0.6},  # hero trigger cap: polish, little wear
    # the photocell's thin graphite cell strips are nearly all arris: edge wear turned 60 % of them to bare
    # aluminium (+69 % slot value). A cell face is never handled, so no wear (polish and mottle stay)
    ('suncell', 'kn_anod_graphite'): {'wear': 0.0},
})


# M4 (stream E4b): critter coats and robot critters (critters.md, ASSET_PIPELINE §4). `kn_fur_*` bakes the 'fur'
# look; per-critter looks (feather, plastic, the coat's smooth texture-mask regions) travel with the .blend as
# the part root's `kn_tex_looks` JSON {master: overrides}, merged over OVERRIDES at bake time. Robot critters
# (DUSTY; BUZZ in M5) take a 2048² set instead of the XL 4096².
LOOKS = LOOKS + (('kn_fur_', 'fur'),)


def root_looks(scene=None):
    """{master: overrides} from the part root's `kn_tex_looks` JSON (M4 E4b), or {}."""
    import json
    root = template.find_root(scene or bpy.context.scene)
    raw = root.get('kn_tex_looks') if root is not None else None
    return json.loads(raw) if raw else {}


def region_mask_np(terms, com, P, N):
    """Numpy twin of the shader region mask (_region_mask): max over ellipsoid terms of a soft inside test, each
    optionally gated by the normal. P / N are part-space (n, 3) arrays; terms are in critter root space."""
    m = np.zeros(len(P))
    for tm in terms:
        c = np.array(tm['c'], dtype=float) - np.array(com, dtype=float)
        d = np.linalg.norm((P - c) / np.array(tm['r'], dtype=float), axis=1)
        s = float(tm.get('soft', 0.25))
        w = np.clip((1.0 + s - d) / (2.0 * s), 0.0, 1.0)
        if 'n' in tm:
            ax, lo, hi = tm['n']
            dn = N @ np.array(ax, dtype=float)
            w = w * np.clip((dn - lo) / (hi - lo), 0.0, 1.0)
        m = np.maximum(m, w)
    return m


def _region_mask(t, terms, com):
    m = None
    for tm in terms:
        c = tuple(float(tm['c'][i]) - float(com[i]) for i in range(3))
        s = float(tm.get('soft', 0.25))
        sub = t.n('ShaderNodeVectorMath', operation='SUBTRACT')
        t.link(t.co(), sub.inputs[0])
        sub.inputs[1].default_value = c
        div = t.n('ShaderNodeVectorMath', operation='DIVIDE')
        t.link(sub.outputs['Vector'], div.inputs[0])
        div.inputs[1].default_value = tuple(float(x) for x in tm['r'])
        ln = t.n('ShaderNodeVectorMath', operation='LENGTH')
        t.link(div.outputs['Vector'], ln.inputs[0])
        w = t.mr(ln.outputs['Value'], 1.0 + s, 1.0 - s)
        if 'n' in tm:
            ax, lo, hi = tm['n']
            w = t.math('MULTIPLY', w, t.mr(t.dot(t.geo.outputs['Normal'], tuple(float(a) for a in ax)), lo, hi))
        m = w if m is None else t.math('MAXIMUM', m, w)
    return m


def _region_colour(t, ov, base):
    """Coat colour by position: the coat master, then each region's master on top (first listed wins)."""
    coat = reference_colour(ov.get('coat', '')) if ov.get('coat') else None
    col = coat if coat is not None else base
    for master, terms in reversed(ov['regions']):
        rc = reference_colour(master)
        if rc is None or not terms:
            continue
        col = t.mix(_region_mask(t, terms, ov.get('com', (0.0, 0.0, 0.0))), col, rc)
    return col


def look_for(master):
    for prefix, look in LOOKS:
        if master.startswith(prefix):
            return look
    return 'plain'


STEEL = hex_linear('#C9CDD3')
ALUMINIUM = np.array([0.78, 0.79, 0.81])
UNDERCOAT = hex_linear('#5E6168')
MORTAR = hex_linear('#CFC6B8')


def _ob_params(ob):
    """Object-space frame of a piece: centre, size, longest / shortest axis (part space)."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    size = hi - lo
    return {'centre': (lo + hi) / 2, 'size': size, 'long': 'XYZ'[int(np.argmax(size))],
            'short': 'XYZ'[int(np.argmin(size))]}


def build_look(t, master, spec, prm, ov):
    """Wire the look into t; returns dict base/rough/metal/occ (value or socket), height (socket|None),
    hstr, hdist, bevel (radius for the rounded-edge normal)."""
    look = ov.get('look', look_for(master))
    base = reference_colour(master)
    if base is None:
        base = fit_range(hex_linear(spec['base']))
    rough0 = ov.get('rough', spec.get('rough', 0.5))
    size = float(max(prm['size'].max(), 0.02))
    vec = t.co()
    mott = t.noise(vec, 7.0, detail=3.0)
    ao_c = t.ao(min(0.02, 0.25 * size))
    dark = t.mr(ao_c, 0.25, 1.0)           # 0 in recesses, 1 open
    occ = t.mr(ao_c, 0.15, 1.0, 0.45, 1.0)  # ORM R
    out = {'occ': occ, 'height': None, 'hstr': 0.0, 'hdist': 0.0, 'bevel': 0.0015, 'metal': 0.0}

    def cavity(col, k=0.85):
        # ART_BIBLE §4: recess darkening, never more than 20 %
        return t.mix(dark, t.scale(col, k), col)

    if look in ('enamel', 'anod'):
        # anod: D79 review decision (coordinator, 2026-10-24): the anodised masters (COG gears, rails, trims)
        # read as light enamel paint over metal like the key art, not bare metal: metallic 0 on the paint,
        # 1 only where worn through to bare aluminium, roughness ~0.45
        wear_k = ov.get('wear', 1.0)
        gloss = master.endswith('_gloss')
        if look == 'anod':
            rough0 = ov.get('rough', 0.45)
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.965, base * 1.035)
        fine = t.noise(t.co(), 45.0, detail=4.0)
        col = t.mix(t.mr(fine, 0.35, 0.65), t.scale(col, 0.98), t.scale(col, 1.02))
        col = cavity(col)
        polish = t.math('MULTIPLY', t.convex(0.53, 0.60), t.near_edge(0.006))
        col = t.mix(t.math('MULTIPLY', polish, 0.8), col, t.scale(col, 1.05))
        brk = t.mr(t.noise(t.co(), 55.0, detail=5.0, rough=0.65), 0.40, 0.62)
        w = t.math('MULTIPLY', t.math('MULTIPLY', t.convex(0.565, 0.66), t.near_edge(0.003)), brk)
        w = t.math('MULTIPLY', w, wear_k)
        wb = t.mr(w, 0.42, 0.58)          # binary-ish: metal shows where enamel is worn through
        col = t.mix(wb, col, ALUMINIUM if look == 'anod' else STEEL)
        r = t.mr(mott, 0.3, 0.7, rough0 - 0.03, rough0 + 0.03)
        r = t.math('SUBTRACT', r, t.math('MULTIPLY', polish, 0.04))
        out.update(base=col, metal=wb, rough=t.mixf(wb, r, 0.30), bevel=0.0015)
        out.update(height=t.noise(t.co(), 160.0, detail=2.0), hstr=0.05 if not gloss else 0.02, hdist=0.0003)
    elif look == 'pebble':
        vor = t.n('ShaderNodeTexVoronoi', feature='SMOOTH_F1', Scale=1.0 / 0.0016, Smoothness=0.6)
        t.link(t.co(), vor.inputs['Vector'])
        peb = t.mr(vor.outputs['Distance'], 0.0, 0.5, 1.0, 0.0)
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.97, base * 1.03)
        col = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, peb), 0.6), col, t.scale(col, 0.95))
        col = cavity(col, 0.9)
        out.update(base=col, rough=t.mr(peb, 0.0, 1.0, rough0 + 0.03, rough0 - 0.03), height=peb, hstr=0.35,
                   hdist=0.0006, bevel=0.0)
    elif look == 'anod_metal':  # the pre-review bare anodised metal look, kept for reference
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02)
        col = cavity(col, 0.88)
        w = t.math('MULTIPLY', t.convex(0.565, 0.66), t.near_edge(0.002))
        col = t.mix(t.mr(w, 0.3, 0.7), col, (0.78, 0.79, 0.81))  # bare aluminium on worn arrises
        out.update(base=col, metal=1.0, rough=t.mixf(t.mr(w, 0.3, 0.7), t.mr(mott, 0.3, 0.7, rough0 - 0.02,
                                                                                   rough0 + 0.02), 0.22))
        out.update(height=t.noise(t.co(), 120.0, detail=2.0), hstr=0.01, hdist=0.0002)
    elif look in ('steel', 'iron'):
        stretch = {'X': (6.0, 60.0, 60.0), 'Y': (60.0, 6.0, 60.0), 'Z': (60.0, 60.0, 6.0)}[prm['long']]
        streak = t.noise(t.co(stretch), 1.0, detail=4.0)
        col = cavity(t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02), 0.88)
        hi = t.math('MULTIPLY', t.convex(0.53, 0.62), t.near_edge(0.004))
        if look == 'iron':
            r = t.math('SUBTRACT', t.mr(mott, 0.3, 0.7, 0.53, 0.57), t.math('MULTIPLY', hi, 0.1))
            vor = t.n('ShaderNodeTexVoronoi', feature='F1', Scale=900.0)
            t.link(t.co(), vor.inputs['Vector'])
            out.update(height=t.mr(vor.outputs['Distance'], 0.0, 0.35), hstr=0.12, hdist=0.0003)
        else:
            r = t.math('SUBTRACT', t.mr(streak, 0.3, 0.7, rough0 - 0.03, rough0 + 0.03), t.math('MULTIPLY', hi, 0.04))
        out.update(base=t.mix(t.math('MULTIPLY', hi, 0.6), col, t.scale(col, 1.04)), metal=1.0, rough=r)
    elif look == 'patina':
        brk = t.mr(t.noise(t.co(), 30.0, detail=4.0), 0.35, 0.65)
        rec = t.math('MULTIPLY', t.mr(ao_c, 0.85, 0.35), t.mixf(brk, 0.6, 1.0))
        brown = base * np.array([0.86, 0.80, 0.70])  # warm brown, about -15 % value; never verdigris
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02)
        col = t.mix(rec, col, brown)
        hi = t.math('MULTIPLY', t.convex(0.53, 0.62), t.near_edge(0.004))
        col = t.mix(t.math('MULTIPLY', hi, 0.7), col, t.scale(col, 1.06))
        r = t.math('ADD', rough0, t.math('MULTIPLY', rec, 0.15))
        out.update(base=col, metal=1.0, rough=t.math('SUBTRACT', r, t.math('MULTIPLY', hi, 0.04)))
    elif look == 'wood':
        axis = ov.get('axis', prm['long'])
        lo_c, hi_c = (fit_range(hex_linear(h)) for h in spec.get('wood', ('#9A6338', '#D7A86E')))
        ai = 'XYZ'.index(axis)
        sc = [1.0, 1.0, 1.0]
        sc[ai] = 0.12
        off = [-float(c) for c in prm['centre']]
        perp = [i for i in range(3) if i != ai]
        off[perp[0]] += 0.21  # pith outside the piece, so faces show flat-sawn arcs
        off[perp[1]] += 0.07
        gvec = t.co(scale=(1.0, 1.0, 1.0), offset=off)
        sv = t.n('ShaderNodeMapping')
        sv.inputs['Scale'].default_value = sc
        t.link(gvec, sv.inputs['Vector'])
        wave = t.n('ShaderNodeTexWave', wave_type='RINGS', rings_direction=axis, Scale=70.0, Distortion=4.0,
                   Detail=3.0)
        wave.inputs['Detail Scale'].default_value = 1.2
        t.link(sv.outputs['Vector'], wave.inputs['Vector'])
        ring = t.mr(wave.outputs['Fac'], 0.15, 0.95, 0.0, 1.0, smooth=True)
        pst = [420.0, 420.0, 420.0]
        pst[ai] = 25.0
        pores = t.mr(t.noise(t.co(tuple(pst)), 1.0, detail=6.0, rough=0.7), 0.58, 0.72)
        g = t.math('MULTIPLY', ring, t.mixf(pores, 1.0, 0.7))
        col = t.mix(t.mr(g, 0.1, 0.9), lo_c, hi_c)
        broad = t.noise(t.co(), 4.0, detail=2.0)
        col = t.mix(t.mr(broad, 0.3, 0.7), t.scale(col, 0.94), t.scale(col, 1.06))
        end = t.endness(axis)
        col = t.mix(end, col, t.scale(col, 0.86))         # end grain reads darker
        col = cavity(col, 0.86)
        polish = t.math('MULTIPLY', t.convex(0.53, 0.62), t.near_edge(0.004))
        col = t.mix(t.math('MULTIPLY', polish, 0.7), col, t.scale(col, 1.06))
        r = t.math('ADD', t.mr(g, 0.0, 1.0, rough0 + 0.05, rough0 - 0.03), t.math('MULTIPLY', end, 0.1))
        r = t.math('SUBTRACT', r, t.math('MULTIPLY', polish, 0.05))
        h = t.math('ADD', t.math('MULTIPLY', ring, 0.4), t.math('MULTIPLY', pores, -0.6))
        out.update(base=col, rough=r, height=h, hstr=0.12, hdist=0.0006, bevel=0.0012)
    elif look == 'paper':
        fib = t.noise(t.co(), 700.0, detail=8.0, rough=0.7)
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.97, base * 1.03)
        col = t.mix(t.mr(fib, 0.35, 0.65), t.scale(col, 0.98), t.scale(col, 1.02))
        r = t.mr(mott, 0.3, 0.7, rough0 - 0.02, rough0 + 0.03)
        if ov.get('print') and prm['size'].max() > 2.2 * sorted(prm['size'])[1]:
            ai = 'XYZ'.index(prm['long'])
            sep = t.n('ShaderNodeSeparateXYZ')
            t.link(t.co(offset=[-float(c) for c in prm['centre']]), sep.inputs['Vector'])
            u = t.math('ABSOLUTE', t.math('DIVIDE', sep.outputs['XYZ'[ai]], float(prm['size'][ai]) / 2))
            ink = None
            for c0, wdt in ((0.70, 0.010), (0.745, 0.004)):    # printed double rule near each end
                band = t.math('MULTIPLY', t.mr(u, c0 - wdt - 0.004, c0 - wdt), t.mr(u, c0 + wdt, c0 + wdt + 0.004))
                ink = band if ink is None else t.math('MAXIMUM', ink, band)
            col = t.mix(ink, col, t.scale(col, 0.74))
            r = t.mixf(ink, r, rough0 - 0.1)
        col = cavity(col, 0.88)
        soft = t.math('MULTIPLY', t.convex(0.54, 0.62), t.near_edge(0.004))
        col = t.mix(t.math('MULTIPLY', soft, 0.6), col, t.scale(col, 1.04))
        out.update(base=col, rough=r, height=fib, hstr=0.08, hdist=0.0004, bevel=0.002)
    elif look == 'rubber':
        si = 'XYZ'.index(prm['short'])
        sep = t.n('ShaderNodeSeparateXYZ')
        t.link(t.co(offset=[-float(c) for c in prm['centre']]), sep.inputs['Vector'])
        d = t.math('ABSOLUTE', sep.outputs['XYZ'[si]])
        ridge = t.mr(d, 0.00045, 0.0, 0.0, 1.0, smooth=True)       # parting line
        vor = t.n('ShaderNodeTexVoronoi', feature='F1', Scale=35.0)
        t.link(t.co(), vor.inputs['Vector'])
        dist_m = t.math('DIVIDE', vor.outputs['Distance'], 35.0)    # metres from the cell point
        ring = t.math('MULTIPLY', t.mr(dist_m, 0.0011, 0.0014), t.mr(dist_m, 0.0019, 0.0016))
        ax = [0.0, 0.0, 0.0]
        ax[si] = -1.0
        under = t.mr(t.dot(t.geo.outputs['Normal'], tuple(ax)), 0.6, 0.85)
        pin = t.math('MULTIPLY', ring, under)                       # ejector-pin circles on the underside
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.97, base * 1.04)
        col = cavity(col, 0.88)
        r = t.mr(mott, 0.3, 0.7, 0.78, 0.84)
        r = t.mixf(t.math('MAXIMUM', ridge, pin), r, 0.68)
        out.update(base=col, rough=r, height=t.math('MAXIMUM', ridge, t.math('MULTIPLY', pin, -1.0)),
                   hstr=0.25, hdist=0.0003, bevel=0.001)
    elif look == 'brick':
        grain = t.noise(t.co(), 260.0, detail=8.0, rough=0.8)
        vor = t.n('ShaderNodeTexVoronoi', feature='F1', Scale=180.0)
        t.link(t.co(), vor.inputs['Vector'])
        speck = t.mr(vor.outputs['Distance'], 0.12, 0.05)
        col = t.mix(t.mr(mott, 0.25, 0.75), base * 0.94, base * 1.06)
        col = t.mix(t.math('MULTIPLY', speck, 0.8), col, t.scale(col, 0.78))
        # the tooled 5 mm perimeter round = mortar band: faces whose true normal leaves the brick's axes
        sep = t.n('ShaderNodeSeparateXYZ')
        t.link(t.geo.outputs['True Normal'], sep.inputs['Vector'])
        ax = t.math('MAXIMUM', t.math('MAXIMUM', t.math('ABSOLUTE', sep.outputs['X']),
                                      t.math('ABSOLUTE', sep.outputs['Y'])), t.math('ABSOLUTE', sep.outputs['Z']))
        mortar = t.mr(ax, 0.995, 0.97)
        col = t.mix(mortar, col, MORTAR * np.array([0.92, 0.92, 0.92]))
        col = cavity(col, 0.86)
        r = t.mixf(mortar, t.mr(grain, 0.3, 0.7, 0.84, 0.9), 0.95)
        out.update(base=col, rough=r, height=t.math('SUBTRACT', grain, t.math('MULTIPLY', mortar, 0.6)),
                   hstr=0.25, hdist=0.0008, bevel=0.0)
    elif look == 'cord':
        tw = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', Scale=900.0, Distortion=0.6,
                 Detail=2.0)
        t.link(t.co(), tw.inputs['Vector'])
        twist = t.mr(tw.outputs['Fac'], 0.15, 0.85, 0.0, 1.0, smooth=True)
        fuzz = t.noise(t.co(), 1500.0, detail=6.0)
        col = t.mix(twist, base * 0.86, base * 1.05)
        col = t.mix(t.mr(fuzz, 0.4, 0.7), col, t.scale(col, 1.03))
        out.update(base=cavity(col, 0.88), rough=t.mr(twist, 0.0, 1.0, 0.92, 0.86), height=twist, hstr=0.3,
                   hdist=0.0006, bevel=0.0)
    elif look == 'wax':
        drip = t.noise(t.co((60.0, 60.0, 8.0)), 1.0, detail=3.0)
        col = cavity(t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02), 0.92)
        out.update(base=col, rough=t.mr(drip, 0.3, 0.7, rough0 - 0.05, rough0 + 0.05), height=drip, hstr=0.05,
                   hdist=0.0006, bevel=0.002)
    elif look == 'latex':
        col = cavity(t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02), 0.92)
        out.update(base=col, rough=t.mr(mott, 0.3, 0.7, rough0 - 0.02, rough0 + 0.03),
                   height=t.noise(t.co(), 90.0, detail=2.0), hstr=0.01, hdist=0.0003, bevel=0.0)
    elif look == 'felt':
        # M4 (E4c): pressed wool felt (FUZZ, SPRONG's mat): fibre fuzz (~0.5 mm) over felting clumps (~4 mm),
        # lighter fibre tips, matte; no wear, no metal
        k = ov.get('fuzz', 1.0)
        fib = t.noise(t.co(), 1800.0, detail=6.0, rough=0.75)
        clump = t.noise(t.co(), 260.0, detail=3.0)
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.97, base * 1.03)
        col = t.mix(t.mr(clump, 0.35, 0.65), t.scale(col, 0.97), t.scale(col, 1.03))
        col = t.mix(t.mr(fib, 0.45, 0.72), col, t.scale(col, 1.05))
        col = cavity(col, 0.88)
        h = t.math('ADD', t.math('MULTIPLY', fib, 0.7), t.math('MULTIPLY', clump, 0.3))
        out.update(base=col, rough=t.mr(fib, 0.3, 0.7, 0.95, 0.88), height=h, hstr=0.3 * k, hdist=0.0004,
                   bevel=0.0)
    elif look == 'grip':
        # M4 (E4c): moulded grip rubber: a 1.6 mm diamond knurl (two crossed diagonal ridges in part space),
        # polished a little on the peaks (hands), ejector-free; colour as `rubber`
        kq = math.pi / 0.0016

        def ridge(axis):
            d = t.dot(t.co(), tuple(a / math.sqrt(3.0) for a in axis))
            return t.math('ABSOLUTE', t.math('SINE', t.math('MULTIPLY', d, kq)))
        knurl = t.math('MULTIPLY', ridge((1.0, 1.0, 1.0)), ridge((1.0, -1.0, 1.0)))
        peak = t.mr(knurl, 0.35, 0.85)
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.97, base * 1.04)
        col = t.mix(t.math('MULTIPLY', peak, 0.6), col, t.scale(col, 1.04))
        col = cavity(col, 0.88)
        r = t.mixf(peak, t.mr(mott, 0.3, 0.7, 0.82, 0.86), 0.74)
        out.update(base=col, rough=r, height=knurl, hstr=0.3, hdist=0.0003, bevel=0.001)
    elif look in ('fur', 'feather'):
        # M4 (stream E4b): critter coats, "loved, not grimy" soft fur (ART_BIBLE §4 / §8): low-contrast clumping
        # from smooth noise stretched along the fur flow, mid-size tufts, and fine directional strands. Every
        # field is continuous, so neither albedo nor normal has cell borders (an earlier Voronoi crease read as
        # cracked leather close up). 'feather' adds soft overlapping scallops (smooth-F1 domes, also continuous)
        # and longer barbs. The brief's texture-mask regions blend smoothly by position (kn_tex_looks `regions`),
        # so the coat reads painted, not cut along triangle edges; each slot keeps its master's mean (rule 13).
        col = _region_colour(t, ov, base) if ov.get('regions') else t.mix(t.mr(mott, 0.3, 0.7), base * 0.985,
                                                                             base * 1.015)
        k = 1.0 / float(ov.get('clump', 0.012))
        fa = 'XYZ'.index(ov.get('flow', 'Y'))
        stretch = float(ov.get('stretch', 0.45))

        def flow_co(scale_across, along_factor):
            sc = [scale_across] * 3
            sc[fa] = scale_across * along_factor
            return t.co(tuple(sc))
        clump = t.mr(t.noise(flow_co(k, stretch), 1.0, detail=2.0, rough=0.45), 0.3, 0.7, 0.0, 1.0, smooth=True)
        tuft = t.mr(t.noise(flow_co(k * 2.6, stretch * 0.8), 1.0, detail=2.0, rough=0.5), 0.3, 0.7)
        strand_len = 0.011 if look == 'feather' else 0.007
        strand = t.mr(t.noise(flow_co(1.0 / 0.0009, 0.0009 / strand_len), 1.0, detail=2.0, rough=0.5), 0.25, 0.75)
        col = t.mix(clump, t.scale(col, 0.96), t.scale(col, 1.035))
        col = t.mix(tuft, t.scale(col, 0.975), t.scale(col, 1.02))
        col = t.mix(strand, t.scale(col, 0.955), t.scale(col, 1.035))
        h = t.math('ADD', t.math('ADD', t.math('MULTIPLY', clump, 0.35), t.math('MULTIPLY', tuft, 0.25)),
                   t.math('MULTIPLY', strand, 0.4))
        if look == 'feather':
            vor = t.n('ShaderNodeTexVoronoi', feature='SMOOTH_F1', Scale=1.0, Smoothness=1.0, Randomness=0.7)
            t.link(flow_co(k, 0.75), vor.inputs['Vector'])
            dome = t.mr(vor.outputs['Distance'], 0.05, 0.75, 1.0, 0.0, smooth=True)
            col = t.mix(dome, t.scale(col, 0.97), t.scale(col, 1.025))
            h = t.math('ADD', t.math('MULTIPLY', h, 0.6), t.math('MULTIPLY', dome, 0.4))
        col = cavity(col, 0.9)
        r = t.math('SUBTRACT', t.mr(strand, 0.0, 1.0, rough0 + 0.03, rough0 - 0.02), t.math('MULTIPLY', clump, 0.02))
        out.update(base=col, rough=r, height=h, hstr=float(ov.get('hstr', 0.4)), hdist=float(ov.get('hdist', 0.0008)),
                   bevel=0.0)
    elif look == 'plastic':
        # M4 (stream E4b): moulded ABS (DUSTY): a fine matte moulding grain, softly rounded edges with a little
        # hand polish (ART_BIBLE §4 contact points), cavity occlusion; never metal, no worn-through edges.
        col = t.mix(t.mr(mott, 0.3, 0.7), base * 0.985, base * 1.015)
        col = cavity(col, 0.88)
        polish = t.math('MULTIPLY', t.convex(0.53, 0.60), t.near_edge(0.0012))   # thin pieces (the 3 mm brow): a
        # bevel radius over the thickness samples both faces and bakes speckle
        col = t.mix(t.math('MULTIPLY', polish, 0.7), col, t.scale(col, 1.05))
        grain = t.noise(t.co(), 700.0, detail=2.0, rough=0.45)   # >= 4 texels per feature at 2048²: no speckle
        r = t.mr(mott, 0.3, 0.7, rough0 - 0.02, rough0 + 0.02)
        r = t.math('SUBTRACT', r, t.math('MULTIPLY', polish, 0.06))
        out.update(base=col, rough=r, height=grain, hstr=0.025, hdist=0.0002, bevel=0.0)   # edges are modelled round;
        # a Bevel-node normal samples the overlapping glass / lid shells of the face band and bakes noise
    else:  # ceramic, fabric, plain
        col = cavity(t.mix(t.mr(mott, 0.3, 0.7), base * 0.98, base * 1.02), 0.9)
        out.update(base=col, rough=t.mr(mott, 0.3, 0.7, rough0 - 0.02, rough0 + 0.02))
        if look == 'fabric':
            out.update(height=t.noise(t.co(), 900.0, detail=4.0), hstr=0.15, hdist=0.0004)
    return out


class BakeMat:
    """A temporary bake material: the look, plus switchable outputs for the normal / albedo / ORM passes."""

    def __init__(self, name, master, spec, prm, ov):
        self.mat = bpy.data.materials.new(name)
        self.master = master
        t = self.t = _NT(self.mat)
        o = build_look(t, master, spec, prm, ov)
        # albedo gain (calibration) then the hue-preserving range clamp
        self.gain = t.n('ShaderNodeValue')
        self.gain.outputs[0].default_value = 1.0
        col = t.mix(1.0, o['base'], t._grey(self.gain.outputs[0]), blend='MULTIPLY')
        sep = t.n('ShaderNodeSeparateColor')
        t.link(col, sep.inputs['Color'])
        mx = t.math('MAXIMUM', t.math('MAXIMUM', sep.outputs['Red'], sep.outputs['Green']), sep.outputs['Blue'])
        k = t.math('MINIMUM', t.math('DIVIDE', ALBEDO_MAX, t.math('MAXIMUM', mx, 1e-4)), 1.0)
        k = t.math('MAXIMUM', k, t.math('DIVIDE', ALBEDO_MIN, t.math('MAXIMUM', mx, 1e-4)))
        self.albedo = t.mix(1.0, col, t._grey(k), blend='MULTIPLY')
        t.feed(t.bsdf.inputs['Base Color'], self.albedo)
        t.feed(t.bsdf.inputs['Roughness'], o['rough'])
        t.feed(t.bsdf.inputs['Metallic'], o['metal'])
        nrm = t.bevel_normal(o['bevel'], 8) if o['bevel'] > 0 else None  # worn-edge rounding
        if o['height'] is not None:
            b = t.n('ShaderNodeBump', Strength=o['hstr'], Distance=o['hdist'])
            t.link(o['height'], b.inputs['Height'])
            if nrm is not None:
                t.link(nrm, b.inputs['Normal'])
            t.link(b.outputs['Normal'], t.bsdf.inputs['Normal'])
        elif nrm is not None:
            t.link(nrm, t.bsdf.inputs['Normal'])
        comb = t.n('ShaderNodeCombineColor')
        t.feed(comb.inputs['Red'], o['occ'])
        t.feed(comb.inputs['Green'], o['rough'] if isinstance(o['rough'], (int, float)) else
               t.math('MINIMUM', t.math('MAXIMUM', o['rough'], 0.0), 1.0))
        t.feed(comb.inputs['Blue'], o['metal'])
        self.orm = comb.outputs['Color']
        self.emit = t.n('ShaderNodeEmission')
        self.emit.inputs['Strength'].default_value = 1.0
        self.img = t.n('ShaderNodeTexImage')
        t.nt.nodes.active = self.img

    def mode(self, which, image):
        t = self.t
        self.img.image = image
        t.nt.nodes.active = self.img
        for lk in list(t.out.inputs['Surface'].links):
            t.nt.links.remove(lk)
        if which == 'normal':
            t.link(t.bsdf.outputs['BSDF'], t.out.inputs['Surface'])
            return
        for lk in list(self.emit.inputs['Color'].links):
            t.nt.links.remove(lk)
        t.link(self.albedo if which == 'basecolor' else self.orm, self.emit.inputs['Color'])
        t.link(self.emit.outputs['Emission'], t.out.inputs['Surface'])


# ---------------------------------------------------------------- UVs

def triangulate_ngons(objs):
    """Faces with more than 4 corners -> triangles (BEAUTY). MikkTSpace tangents (glTF export, the bake) need
    tris and quads; the LOD triangle counts do not change."""
    import bmesh
    n = 0
    for ob in objs:
        me = ob.data
        if not any(p.loop_total > 4 for p in me.polygons):
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        faces = [f for f in bm.faces if len(f.verts) > 4]
        n += len(faces)
        bmesh.ops.triangulate(bm, faces=faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(me)
        bm.free()
        me.update()
    return n


def _ensure_visible(objs):
    state = []
    vl = bpy.context.view_layer

    def walk(lc):
        yield lc
        for c in lc.children:
            yield from walk(c)
    for lc in walk(vl.layer_collection):
        state.append(('lc', lc, lc.exclude, lc.hide_viewport))
        lc.exclude = False
        lc.hide_viewport = False
    for c in bpy.data.collections:
        state.append(('col', c, c.hide_viewport, c.hide_render, c.hide_select))
        c.hide_viewport = c.hide_render = c.hide_select = False
    for ob in objs:
        state.append(('ob', ob, ob.hide_get(), ob.hide_viewport, ob.hide_render, ob.hide_select))
        ob.hide_set(False)
        ob.hide_viewport = ob.hide_render = ob.hide_select = False
    return state


def _restore_visible(state):
    for s in reversed(state):
        if s[0] == 'lc':
            s[1].exclude, s[1].hide_viewport = s[2], s[3]
        elif s[0] == 'col':
            s[1].hide_viewport, s[1].hide_render, s[1].hide_select = s[2], s[3], s[4]
        else:
            ob = s[1]
            ob.hide_viewport, ob.hide_render, ob.hide_select = s[3], s[4], s[5]
            ob.hide_set(s[2])


def _select_only(objs, active):
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active


HIDDEN_CELL = 4  # texels per hidden-face cell in the reserved strip


def unwrap(tex_objs, size, log=print):
    """Smart UV Project of the visible textured faces of every LOD, LODn islands scaled, one pack (visible islands
    only), a refit into the tile below a reserved strip, then the hidden faces laid out in that strip."""
    import bmesh
    objs = [ob for _c, ob in tex_objs]
    lod_of = {ob.name: c for c, ob in tex_objs}
    hidden = {ob.name: hidden_mask(ob.data) for ob in objs}
    for ob in objs:
        me = ob.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name='UVMap')
    _select_only(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    try:
        bpy.ops.mesh.select_mode(type='FACE')
        for ob in objs:
            bm = bmesh.from_edit_mesh(ob.data)
            keep = [i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))]
            hid = hidden[ob.name]
            for f in bm.faces:
                f.select = f.material_index in keep and not hid[f.index]
            bm.select_flush(True)
            bmesh.update_edit_mesh(ob.data)
        bpy.ops.uv.smart_project(angle_limit=math.radians(UV_ANGLE), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        for ob in objs:
            s = LOD_UV_SCALE[lod_of[ob.name]]
            bm = bmesh.from_edit_mesh(ob.data)
            uv = bm.loops.layers.uv.verify()
            for f in bm.faces:
                for lp in f.loops:
                    if f.select:
                        lp[uv].uv = lp[uv].uv * s
                        lp[uv].select = True
                        lp[uv].select_edge = True
                    else:
                        lp[uv].uv = (0.0, 0.0)
                        lp[uv].select = False
                        lp[uv].select_edge = False
            bmesh.update_edit_mesh(ob.data)
        if os.environ.get('KN_TEX_DEBUG'):
            for ob in objs:
                bm = bmesh.from_edit_mesh(ob.data)
                uv = bm.loops.layers.uv.verify()
                us = [lp[uv].uv for f in bm.faces if f.select for lp in f.loops]
                if us:
                    log('    DEBUG pre-pack %s: u %.3g..%.3g v %.3g..%.3g' % (
                        ob.name, min(u.x for u in us), max(u.x for u in us), min(u.y for u in us),
                        max(u.y for u in us)))
        margin = island_gap(size) / size
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True,
                                merge_overlap=False, margin_method='FRACTION', margin=margin, pin=False,
                                shape_method='CONCAVE')
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')
    # hidden interior faces: a strip along the top of the tile, one HIDDEN_CELL-texel cell per face (each
    # still bakes its own colour, for cutaways and folded triangles). Kept out of the pack: thousands of
    # one-face islands (FABRICATOR has 4,269) make pack_islands collapse every island and spill the tile.
    hid_faces = []
    for ob in objs:
        keep = {k for k, sl in enumerate(ob.material_slots) if _master(sl) and not is_exempt(_master(sl))}
        hid_faces += [(ob, int(i)) for i in np.nonzero(hidden[ob.name])[0]
                      if ob.data.polygons[int(i)].material_index in keep]
    per_row = size // HIDDEN_CELL
    rows = -(-len(hid_faces) // per_row) if hid_faces else 0
    strip = (rows * HIDDEN_CELL + (2 * pad_px(size) if rows else 0)) / size
    fit_unit_tile(objs, size, log, top=1.0 - strip, hidden=hidden)
    for n, (ob, i) in enumerate(hid_faces):
        me = ob.data
        p = me.polygons[i]
        uvl = me.uv_layers.active.data
        x0 = (n % per_row) * HIDDEN_CELL
        y0 = size - rows * HIDDEN_CELL + (n // per_row) * HIDDEN_CELL
        nrm = p.normal
        if nrm.length < 0.5 or p.area <= 0.0:
            for li in p.loop_indices:
                uvl[li].uv = ((x0 + HIDDEN_CELL / 2) / size, (y0 + HIDDEN_CELL / 2) / size)
            continue
        t = nrm.orthogonal().normalized()
        bv = nrm.cross(t)
        c = p.center
        q = [((me.vertices[v].co - c).dot(t), (me.vertices[v].co - c).dot(bv)) for v in p.vertices]
        ext = max(max(abs(qa) for qa, _ in q), max(abs(qb) for _, qb in q), 1e-9)
        k = (HIDDEN_CELL / 2 - 0.5) / ext
        for li, (qa, qb) in zip(p.loop_indices, q):
            uvl[li].uv = ((x0 + HIDDEN_CELL / 2 + qa * k) / size, (y0 + HIDDEN_CELL / 2 + qb * k) / size)
    # exempt faces park on the corner texel (never sampled: their masters carry no texSet)
    park = (0.5 / size, 0.5 / size)
    for ob in objs:
        me = ob.data
        keep = {i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))}
        uvl = me.uv_layers.active.data
        for p in me.polygons:
            if p.material_index not in keep:
                for li in p.loop_indices:
                    uvl[li].uv = park
    log('  uv: %d objects unwrapped and packed (margin %d px at %d²); %d hidden faces in a %d px strip' % (
        len(objs), island_gap(size), size, len(hid_faces), round(strip * size)))


def fit_unit_tile(objs, size, log=print, top=1.0, hidden=None):
    """Keep the visible textured UVs inside [pad, 1 - pad] x [pad, top - pad]: pack_islands(CLOSEST_UDIM) can
    spill past the tile (FABRICATOR reached 1.4), and the hidden-face strip takes the top. Moves and uniformly
    scales every object's islands together, only when they don't already fit."""
    lo, hi = np.array([np.inf, np.inf]), np.array([-np.inf, -np.inf])
    data = []
    for ob in objs:
        me = ob.data
        keep = {i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))}
        hid = hidden[ob.name] if hidden else np.zeros(len(me.polygons), dtype=bool)
        li = np.array([l for p in me.polygons if p.material_index in keep and not hid[p.index]
                       for l in p.loop_indices], dtype=np.int64)
        if not li.size:
            continue
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        bad = ~np.isfinite(uv[li]).all(1)
        if bad.any():  # never let a degenerate loop decide the fit
            uv[li[bad]] = 0.5
        lo = np.minimum(lo, uv[li].min(0))
        hi = np.maximum(hi, uv[li].max(0))
        data.append((me, li, uv))
    if not data:
        return
    m = pad_px(size) / size
    if lo.min() >= m * 0.5 and hi[0] <= 1.0 - m * 0.5 and hi[1] <= top - m * 0.5:
        return
    ext = np.maximum(hi - lo, 1e-9)
    k = min((1.0 - 2.0 * m) / ext[0], (top - 2.0 * m) / ext[1])
    log('  uv: islands span %.3f..%.3f x %.3f..%.3f; refit x%.3f into the tile (top %.3f)' % (
        lo[0], hi[0], lo[1], hi[1], k, top))
    for me, li, uv in data:
        uv[li] = (uv[li] - lo) * k + m
        me.uv_layers.active.data.foreach_set('uv', uv.ravel().astype(np.float32))
        me.update()


def uv_stats(tex_objs, size):
    """LOD0 texel density (px/m) and atlas use per LOD."""
    use = {}
    dens = []
    for c, ob in tex_objs:
        me = ob.data
        me.calc_loop_triangles()
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        keep = {i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))}
        hid = hidden_mask(me)
        a_uv = a_3d = 0.0
        for tri in me.loop_triangles:
            if tri.material_index not in keep or hid[tri.polygon_index]:
                continue
            p = uv[list(tri.loops)]
            a_uv += abs((p[1, 0] - p[0, 0]) * (p[2, 1] - p[0, 1]) - (p[2, 0] - p[0, 0]) * (p[1, 1] - p[0, 1])) / 2
            a_3d += tri.area
        use[c] = use.get(c, 0.0) + a_uv
        if c == 'RENDER' and a_3d > 0:
            dens.append((a_uv, a_3d))
    au = sum(a for a, _ in dens)
    a3 = sum(b for _, b in dens)
    return {'px_per_m': round(math.sqrt(au / a3) * size, 1) if a3 else 0.0,
            'atlas_use': {k: round(v, 4) for k, v in use.items()}}


# ---------------------------------------------------------------- sampling (shared by calibration + check 13)

def hidden_mask(me):
    """Per-polygon bool: the `kn_hidden` face attribute written by texture_part (interior faces)."""
    attr = me.attributes.get(HIDDEN_ATTR)
    out = np.zeros(len(me.polygons), dtype=bool)
    if attr is not None and attr.domain == 'FACE' and len(attr.data) == len(me.polygons):
        vals = np.empty(len(me.polygons), dtype=bool)
        attr.data.foreach_get('value', vals)
        out = vals
    return out


def _raster(uvpx, h, w):
    """Flat indices of the texels whose centres lie inside the triangle uvpx (3 x 2, pixel units)."""
    lo = np.clip(np.floor(uvpx.min(0) - 0.5).astype(np.int64), 0, [w - 1, h - 1])
    hi = np.clip(np.ceil(uvpx.max(0) - 0.5).astype(np.int64), 0, [w - 1, h - 1])
    xs = np.arange(lo[0], hi[0] + 1) + 0.5
    ys = np.arange(lo[1], hi[1] + 1) + 0.5
    if not xs.size or not ys.size:
        return np.empty(0, np.int64)
    X, Y = np.meshgrid(xs, ys)
    a, b, c = uvpx

    def e(p, q):
        return (q[0] - p[0]) * (Y - p[1]) - (q[1] - p[1]) * (X - p[0])
    d1, d2, d3 = e(a, b), e(b, c), e(c, a)
    inside = ((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))
    return ((Y[inside] - 0.5).astype(np.int64) * w + (X[inside] - 0.5).astype(np.int64))


def slot_texels(objs, h, w, masters=None):
    """{master: flat texel indices} - the texels the bake writes for each slot's visible faces (texel centre
    inside one of the slot's triangles). Sliver triangles that cover no texel centre contribute nothing, and
    texels of a neighbouring slot never leak in, however thin the island."""
    acc = {}
    for ob in objs:
        me = ob.data
        if not me.uv_layers:
            continue
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        if not n:
            continue
        loops = np.empty(n * 3, dtype=np.int64)
        me.loop_triangles.foreach_get('loops', loops)
        mi = np.empty(n, dtype=np.int64)
        me.loop_triangles.foreach_get('material_index', mi)
        poly = np.empty(n, dtype=np.int64)
        me.loop_triangles.foreach_get('polygon_index', poly)
        vis = ~hidden_mask(me)[poly]
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)[loops].reshape(n, 3, 2) * np.array([w, h])
        for k, slot in enumerate(ob.material_slots):
            name = _master(slot)
            if not name or is_exempt(name) or (masters and name not in masters):
                continue
            idx = [_raster(uv[i], h, w) for i in np.nonzero((mi == k) & vis)[0]]
            if idx:
                acc.setdefault(name, []).extend(idx)
    return {k: np.unique(np.concatenate(v)) for k, v in acc.items()}


def slot_means(objs, arr_lin, masters=None, valid=None):
    """Mean linear colour per master over the texels its visible faces own (slot_texels), from arr_lin
    (H x W x >=3, Blender orientation); `valid` (H x W bool) drops texels the bake never wrote. The same
    measure serves calibration and validator check 13, so the two always agree. {master: (rgb, texels)}."""
    h, w = arr_lin.shape[:2]
    flat = arr_lin[..., :3].reshape(-1, 3)
    out = {}
    for name, idx in slot_texels(objs, h, w, masters).items():
        if valid is not None:
            idx = idx[valid.reshape(-1)[idx]]
        if idx.size:
            out[name] = (flat[idx].astype(np.float64).mean(0), float(idx.size))
    return out


def mark_hidden(tex_objs, scene, log=print):
    """Interior faces (closing caps, pieces sunk into others) get almost no atlas space: a face is hidden when all
    16 rays over its outer hemisphere, from its centroid and from each inset corner, hit opaque geometry of the same LOD (clear poly and glass don't
    occlude). Written as the boolean face attribute `kn_hidden` (never exported); unwrap() lays these faces out
    in a strip of 4-texel cells along the top of the tile."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    dirs_local = [(0.0, 0.0, 1.0)]
    for el in (30.0, 55.0, 78.0):
        for k in range(5):
            az = math.radians(72.0 * k + (36.0 if el == 55.0 else 0.0))
            e = math.radians(el)
            dirs_local.append((math.sin(e) * math.cos(az), math.sin(e) * math.sin(az), math.cos(e)))
    total = hidden = 0
    by_lod = {}
    for c, ob in _lod_objects(scene):
        by_lod.setdefault(c, []).append(ob)
    for col, obs in by_lod.items():
        verts, polys = [], []
        for ob in obs:
            mw = ob.matrix_world
            names = [_master(s) for s in ob.material_slots]
            if names and all(nm in ('kn_decal', 'kn_screen') for nm in names if nm):
                continue
            base = len(verts)
            verts.extend(mw @ v.co for v in ob.data.vertices)
            for p in ob.data.polygons:
                nm = names[p.material_index] if p.material_index < len(names) else None
                if nm and (nm.startswith('kn_poly_') or nm == 'kn_glass' or nm in ('kn_decal', 'kn_screen')):
                    continue
                polys.append([base + i for i in p.vertices])
        if not polys:
            continue
        tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
        for c2, ob in tex_objs:
            if c2 != col:
                continue
            me = ob.data
            mw = ob.matrix_world
            nmat = mw.to_3x3().inverted_safe().transposed()
            keep = {i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))}
            flags = np.zeros(len(me.polygons), dtype=bool)
            for p in me.polygons:
                if p.material_index not in keep:
                    continue
                total += 1
                nrm = (nmat @ p.normal).normalized()
                t = nrm.orthogonal().normalized()
                b = nrm.cross(t)
                c = p.center
                # the centroid and every corner pulled 15 % toward it: a fan triangle whose centroid sits under
                # a neighbour (WICK's puck top under the candle) is still visible at its outer corners
                samples = [c] + [me.vertices[v].co.lerp(c, 0.15) for v in p.vertices]
                blocked = True
                for co in samples:
                    o = mw @ co + nrm * 1e-4
                    if any(tree.ray_cast(o, t * dx + b * dy + nrm * dz, 10.0)[0] is None for dx, dy, dz in dirs_local):
                        blocked = False
                        break
                if blocked:
                    flags[p.index] = True
            attr = me.attributes.get(HIDDEN_ATTR)
            if attr is not None:
                me.attributes.remove(attr)
            if flags.any():
                attr = me.attributes.new(HIDDEN_ATTR, 'BOOLEAN', 'FACE')
                attr.data.foreach_set('value', flags)
                hidden += int(flags.sum())
    log('  hidden: %d of %d textured faces are interior (strip cells)' % (hidden, total))
    return hidden


# ---------------------------------------------------------------- bake

def _use_gpu(sc):
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for dev in ('OPTIX', 'CUDA', 'HIP'):
            try:
                prefs.compute_device_type = dev
                prefs.get_devices()
                if any(d.type == dev for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == dev
                    sc.cycles.device = 'GPU'
                    return dev
            except Exception:  # noqa: BLE001 - next backend, else CPU
                continue
    except KeyError:
        pass
    sc.cycles.device = 'CPU'
    return 'CPU'


def _new_image(name, size, float_buffer=True):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=float_buffer)
    img.generated_color = (0.0, 0.0, 0.0, 0.0)
    img.colorspace_settings.name = 'Non-Color'
    return img


def _bake(sc, kind, objs, mats, image, size, samples):
    for bm in mats:
        bm.mode('normal' if kind == 'normal' else kind, image)
    sc.cycles.samples = samples
    b = sc.render.bake
    b.margin = island_gap(size)  # M1 / M3: 2 x padding; M2 parts: 1 x (never wider than the island gap)
    b.margin_type = 'EXTEND'
    b.use_clear = True
    b.target = 'IMAGE_TEXTURES'
    if kind == 'normal':
        b.normal_space = 'TANGENT'
        b.normal_r, b.normal_g, b.normal_b = 'POS_X', 'POS_Y', 'POS_Z'
        bpy.ops.object.bake(type='NORMAL', margin=b.margin, use_clear=True)
    else:
        bpy.ops.object.bake(type='EMIT', margin=b.margin, use_clear=True)


def _assign_bake_mats(tex_objs, ptype, log):
    """Swap every textured slot (object link) for a BakeMat; returns (mats, restore list)."""
    table = master_table()
    cache, restore, mats = {}, [], []
    looks = root_looks()  # M4 (E4b): per-part looks stored on the root (critter coats, robot plastic)
    for c, ob in tex_objs:
        prm = _ob_params(ob)
        for i, slot in enumerate(ob.material_slots):
            key = _master(slot)
            if not key or is_exempt(key):
                continue
            spec = table.get(key, {'base': '#808080', 'rough': 0.5})
            ov = dict(OVERRIDES.get((ptype, key), {}), **looks.get(key, {}))
            look = ov.get('look', look_for(key))
            per_object = look in ('wood', 'rubber', 'paper', 'steel', 'iron')
            ck = (key, ob.name) if per_object else (key,)
            if ck not in cache:
                cache[ck] = BakeMat('__bake__%s__%s' % (key, ob.name if per_object else 'all'), key, spec, prm, ov)
                mats.append(cache[ck])
            restore.append((slot, slot.link, slot.material if slot.link == 'OBJECT' else None))
            slot.link = 'OBJECT'
            slot.material = cache[ck].mat
    log('  bake: %d tactile bake materials' % len(mats))
    return mats, restore


def _unassign(mats, restore):
    for slot, link, mat in reversed(restore):
        slot.material = mat
        slot.link = link
    for bm in mats:
        bpy.data.materials.remove(bm.mat)


def _empty(arr):
    """Texels no island and no bake margin wrote: alpha 0 and still the cleared black (margin texels keep
    alpha 0 but carry the extended colour)."""
    return (arr[..., 3] < 0.5) & (arr[..., :3].max(-1) <= 0.0)


def push_pull(rgb, valid):
    """Fill invalid texels from the nearest valid ones (push-pull over a 2x pyramid): islands bleed outward,
    so mips never pull in black and sliver triangles whose texels the bake missed still read their colour."""
    rgb = np.asarray(rgb, dtype=np.float64)
    w = valid.astype(np.float64)
    levels = [(rgb * w[..., None], w)]
    while levels[-1][1].shape[0] > 1:
        c, ww = levels[-1]
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        c2 = c[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, -1).sum((1, 3))
        ww2 = ww[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
        levels.append((c2, ww2))
    c, ww = levels[-1]
    fill = c / np.maximum(ww, 1e-9)[..., None]
    for c, ww in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)[:c.shape[0], :c.shape[1]]
        have = ww > 0
        fill = np.where(have[..., None], c / np.maximum(ww, 1e-9)[..., None], up)
    out = rgb.copy()
    out[~valid] = fill[~valid]
    return out


def fill_slots(rgb, written, slots):
    """M4 (E4c): texels inside a slot's visible triangles that the bake never wrote take a push-pull of that slot's
    own written texels (never a neighbouring slot's). Returns (rgb, ok): ok marks texels holding a slot's colour
    (written, or filled from a slot with at least one written texel)."""
    rgb = np.asarray(rgb, dtype=np.float64).copy()
    h, w = written.shape
    flat = rgb.reshape(-1, rgb.shape[-1])
    wflat = written.reshape(-1)
    ok = wflat.copy()
    for idx in slots.values():
        miss = idx[~wflat[idx]]
        have = idx[wflat[idx]]
        if not miss.size or not have.size:
            continue
        m = np.zeros(h * w, dtype=bool)
        m[have] = True
        flat[miss] = push_pull(rgb, m.reshape(h, w)).reshape(-1, rgb.shape[-1])[miss]
        ok[miss] = True
    return rgb, ok.reshape(h, w)


def _fill_empty(arr, fill=None):
    """Texels no island (or bake margin) touched: push-pull from their neighbours."""
    return push_pull(arr[..., :3], ~_empty(arr))


def texture_part(scene=None, root_dir=None, size=None, samples=24, log=print):
    """`--tex`: UV1 atlas + bake + source PNGs + image datablocks + root props. Caller saves the .blend."""
    scene = scene or bpy.context.scene
    root = template.find_root(scene)
    if root is None:
        raise RuntimeError('no part root in this file')
    ptype, family, cls = root['kn_type'], root['kn_family'], root['kn_class']
    root_dir = root_dir or paths.repo_root(bpy.data.filepath or None)
    tex_objs = textured_objects(scene)
    if not tex_objs:
        log('  %s: every master is exempt (§5.2); no texture set' % ptype)
        return None
    size = size or set_size(cls, ptype)
    log('texture set %s__%s: %d² · %d textured objects · masters %s' % (
        ptype, SET, size, len(tex_objs), ', '.join(textured_masters(scene))))
    objs = [ob for _c, ob in tex_objs]
    ngons = triangulate_ngons(objs)
    if ngons:
        log('  triangulated %d n-gons (tangents need tris / quads; tri counts unchanged)' % ngons)
    vis = _ensure_visible(objs)
    try:
        if root.get('kn_tex_looks') and template.find_root(scene).get('kn_family') == 'critters':
            # M4 (E4b): skinned critters move every piece (wings spread, jaws open, lids blink), so no face is
            # truly interior; strip cells would show as flat facets the moment a pose reveals them
            for _c, ob in tex_objs:
                if ob.data.attributes.get(HIDDEN_ATTR) is not None:
                    ob.data.attributes.remove(ob.data.attributes[HIDDEN_ATTR])
            log('  hidden: none (animated critter: every face gets atlas space)')
        else:
            mark_hidden(tex_objs, scene, log)
        unwrap(tex_objs, size, log)
        for ob in objs:
            ob['kn_set'] = SET
        dev = _use_gpu(scene)
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 0
        log('  bake device: %s' % dev)
        mats, restore = _assign_bake_mats(tex_objs, ptype, log)
        _select_only(objs, objs[0])
        lod0 = [ob for c, ob in tex_objs if c == 'RENDER']
        try:
            # calibration: low-res albedo, per-slot mean value -> gain, so each slot's mean keeps the master
            # value (ART_BIBLE §3.1 ±4 %) after cavities, polish and worn edges
            by_master = {}
            for bm in mats:
                by_master.setdefault(bm.master, []).append(bm)
            # M4 (E4c): the M2 parts get up to two more set-size passes while a slot is > 1 % off: a thin slot
            # (BIG TOP's fuse cord) reads 75 % high at 512 through neighbour bleed, the 0.8 gain floor then leaves
            # it -7 % after the set-size pass
            # (every part since E4a's thin M4 slots: the passes stop as soon as all slots are within 1 %, so a set
            # whose slots are all within 1 % after the set-size pass bakes exactly as before)
            extra = 2
            if root.get('kn_tex_looks'):  # M4 (E4b): the critters' tiny slots (catchlights) bleed at 512 too
                extra = 2
            passes = [512, size] + [size] * extra
            for pi, res in enumerate(passes):  # coarse pass, then at the set size (small islands bleed at 512)
                if pi >= 2 and not off_slots:
                    break
                off_slots = []
                cal = _new_image('__bake_cal', res)
                _bake(scene, 'basecolor', objs, mats, cal, res, 6)
                arr = image_array(cal)
                means = slot_means(lod0, arr, valid=~_empty(arr))
                for master, (rgb, _a) in means.items():
                    ref = reference_colour(master)
                    if ref is None or rgb.max() <= 1e-5:
                        continue
                    g = float(np.clip(ref.max() / rgb.max(), 0.8, 1.25))
                    log('    calibrate %s: mean peak %.4f ref %.4f gain x%.3f' % (master, rgb.max(), ref.max(), g))
                    if abs(ref.max() / rgb.max() - 1.0) > 0.01:
                        off_slots.append(master)
                    clipped = rgb.max() >= ALBEDO_MAX - 0.002 and ref.max() < ALBEDO_MAX - 0.01
                    for bm in by_master.get(master, ()):
                        if clipped and root.get('kn_tex_looks'):
                            # M4 (E4b): a mean pinned at the albedo cap says nothing about the true value (the
                            # 512 pass over-boosted a bled slot): restart this slot from its own look
                            bm.gain.outputs[0].default_value = 1.0
                        else:
                            bm.gain.outputs[0].default_value *= g
                bpy.data.images.remove(cal)
            imgs = {}
            for m in MAPS:
                imgs[m] = _new_image('__bake_' + m, size)
                _bake(scene, m, objs, mats, imgs[m], size, samples)
                log('  baked %s' % m)
            arrays = {m: image_array(imgs[m]) for m in MAPS}
            for master, (rgb, _a) in sorted(slot_means(lod0, arrays['basecolor'],
                                                       valid=~_empty(arrays['basecolor'])).items()):
                ref = reference_colour(master)
                if ref is not None:
                    log('    final %s: mean peak %.4f (%+.1f %%)' % (master, rgb.max(), 100 * (rgb.max() / ref.max() - 1)))
            for m in MAPS:
                bpy.data.images.remove(imgs[m])
        finally:
            _unassign(mats, restore)
    finally:
        _restore_visible(vis)

    # --- post-process + write the source maps
    alb = arrays['basecolor']
    cov = ~_empty(alb)
    lin = alb[..., :3].astype(np.float64)
    pk = lin.max(-1, keepdims=True)
    lin = lin * np.where(pk > ALBEDO_MAX, ALBEDO_MAX / np.maximum(pk, 1e-6), 1.0)
    pk = lin.max(-1, keepdims=True)
    lin = lin * np.where(pk < ALBEDO_MIN, ALBEDO_MIN / np.maximum(pk, 1e-6), 1.0)
    # M4 (E4c; V4's BC7 report and E4a's check-13 mismatch): every map is rebuilt from the texels whose centres
    # lie inside a visible island triangle - the measure check 13 and calibration use (slot_texels).
    #  1. Cycles leaves some of those texels unwritten on thin pieces (dots, pupils, grip strips, cords): the old
    #     global push-pull filled them from the nearest island of any slot, so check 13 (all inside texels) read
    #     +46..+163 % where calibration (written texels only) read 0 %. They are now filled from their own slot's
    #     written texels (fill_slots), so both measures agree and the engine shows the slot's colour there.
    #  2. Gap texels (bake margin, outside every triangle) are push-pulled from the inside texels only: margin and
    #     edge texels could carry off-by-120° normals into the gaps, which mips and BC7 blocks pick up.
    #  3. The hidden-face strip keeps its baked colour (cutaways) and gets a flat normal (interior, never lit).
    h, w = alb.shape[:2]
    slots = slot_texels(objs, h, w)
    inside = np.zeros(h * w, dtype=bool)
    for idx in slots.values():
        inside[idx] = True
    inside = inside.reshape(h, w)
    strip = np.zeros((h, w), dtype=bool)
    srows = hidden_rows(scene, size)
    if srows:
        strip[h - srows:, :] = True

    def rebuild(rgb, written, keep_strip=True):
        rgb, ok = fill_slots(rgb, written, slots)
        return push_pull(rgb, (inside & ok) | (strip & written if keep_strip else False))

    lin = rebuild(lin, cov)
    log('  inside texels the bake left unwritten (filled from their own slot): %d of %d' % (
        int((inside & ~cov).sum()), int(inside.sum())))
    nwritten = ~_empty(arrays['normal'])
    nv = rebuild(arrays['normal'][..., :3], nwritten, keep_strip=False) * 2.0 - 1.0
    nv[strip] = (0.0, 0.0, 1.0)
    nv[..., 2] = np.maximum(nv[..., 2], 1e-3)
    nrm = nv / np.linalg.norm(nv, axis=-1, keepdims=True) * 0.5 + 0.5
    orm = arrays['orm']
    orm = rebuild(orm[..., :3], ~_empty(orm))
    orm[..., 2] = np.where(orm[..., 2] > 0.5, 1.0, 0.0)  # §9.13: metallic is 0 or 1
    out = src_dir(root_dir, family)
    os.makedirs(out, exist_ok=True)
    files = {m: os.path.join(out, src_name(ptype, m) + '.png') for m in MAPS}
    q8 = lambda a: np.clip(np.rint(a * 255.0), 0, 255).astype(np.uint8)  # noqa: E731
    sizes = {
        'basecolor': write_png(files['basecolor'], q8(linear_to_srgb(lin))[::-1]),
        'normal': write_png(files['normal'], np.clip(np.rint(nrm * 65535.0), 0, 65535).astype(np.uint16)[::-1]),
        'orm': write_png(files['orm'], q8(orm)[::-1]),
    }
    # stale maps of this part (another set name or map) would fail check 13
    for f in os.listdir(out):
        if f.startswith(ptype + '__') and os.path.join(out, f) not in files.values():
            os.remove(os.path.join(out, f))
    attach_images(ptype, files)
    stats = uv_stats(tex_objs, size)
    root['kn_tex_set'] = SET
    root['kn_tex_size'] = size
    root['kn_tex_version'] = VERSION
    log('  wrote %s (%s bytes) · LOD0 %.0f px/m · atlas use %s' % (
        ', '.join(os.path.relpath(p, root_dir) for p in files.values()),
        ' / '.join(str(sizes[m]) for m in MAPS), stats['px_per_m'], stats['atlas_use']))
    return {'size': size, 'files': files, 'bytes': sizes, 'uv': stats}


def attach_images(ptype, files):
    """Image datablocks for the set (relative paths, fake user, colour space by map)."""
    for m, path in files.items():
        name = src_name(ptype, m)
        old = bpy.data.images.get(name)
        if old is not None:
            bpy.data.images.remove(old)
        img = bpy.data.images.load(path, check_existing=False)
        img.name = name
        img.colorspace_settings.name = COLORSPACE[m]
        img.use_fake_user = True
        if bpy.data.filepath:
            try:
                img.filepath = bpy.path.relpath(path)
            except ValueError:
                pass
        if m == 'normal':
            img['kn_normal_y'] = NORMAL_Y
        img['kn_set'] = SET


def part_set(scene):
    """{set, size, images{map: Image}} when the part carries a set, else None."""
    root = template.find_root(scene)
    if root is None or not root.get('kn_tex_set'):
        return None
    ptype, s = root['kn_type'], root['kn_tex_set']
    imgs = {m: bpy.data.images.get('%s__%s__%s' % (ptype, s, m)) for m in MAPS}
    return {'set': s, 'size': int(root.get('kn_tex_size', 0)), 'images': imgs, 'type': ptype}


def has_set(scene):
    info = part_set(scene)
    return bool(info) and all(info['images'].values())


# ---------------------------------------------------------------- export

def patch_glb(glb_path, masters, set_name):
    """Add `extras.texSet = <set>` to the glb materials named after a textured master."""
    with open(glb_path, 'rb') as f:
        data = f.read()
    magic, ver, _length = struct.unpack('<III', data[:12])
    jlen, jtype = struct.unpack('<II', data[12:20])
    import json
    doc = json.loads(data[20:20 + jlen].decode('utf-8'))
    rest = data[20 + jlen:]
    n = 0
    for m in doc.get('materials', []):
        if m.get('name') in masters:
            m.setdefault('extras', {})['texSet'] = set_name
            n += 1
    js = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), jtype) + js + rest
    with open(glb_path, 'wb') as f:
        f.write(out)
    return n


def hidden_rows(scene, size):
    """M4 (E4c): height in texels of the hidden-face strip along the top of the tile (glTF orientation: the first
    rows of the PNG), 0 when the part has no interior faces. Lets checks outside Blender skip the strip cells, as
    check 13 does (they bake occluded geometry and bleed between 4-texel cells)."""
    lo = 1.0
    for _c, ob in textured_objects(scene):
        me = ob.data
        hid = hidden_mask(me)
        if not hid.any() or not me.uv_layers:
            continue
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        keep = {i for i, s in enumerate(ob.material_slots) if _master(s) and not is_exempt(_master(s))}
        li = [l for p in me.polygons if hid[p.index] and p.material_index in keep for l in p.loop_indices]
        if li:
            lo = min(lo, float(uv[li, 1].min()))
    if lo >= 1.0:
        return 0
    return int(size - math.floor(lo * size / HIDDEN_CELL) * HIDDEN_CELL)


def export_set(scene, out_dir, glb_path, log=print):
    """Build files + glb extras; returns the `.art.json textures` entry (or None, removing stale files)."""
    root = template.find_root(scene)
    ptype = root['kn_type']
    stale = [os.path.join(out_dir, build_name(ptype, m)) for m in MAPS]
    info = part_set(scene)
    if not info or not all(info['images'].values()):
        for p in stale:
            if os.path.exists(p):
                os.remove(p)
        return None
    out = {}
    nbytes = {}
    for m in MAPS:
        img = info['images'][m]
        src = bpy.path.abspath(img.filepath)
        dst = os.path.join(out_dir, build_name(ptype, m))
        if m == 'normal':
            arr = image_array(img)[..., :3]
            nbytes[m] = write_png(dst, np.clip(np.rint(arr * 255.0), 0, 255).astype(np.uint8)[::-1])
        else:
            shutil.copyfile(src, dst)
            nbytes[m] = os.path.getsize(dst)
        out[BUILD_NAMES[m]] = os.path.basename(dst)
    masters = textured_masters(scene)
    n = patch_glb(glb_path, set(masters), info['set'])
    entry = {
        'albedo': out['albedo'], 'normal': out['normal'], 'orm': out['orm'], 'size': info['size'],
        'set': info['set'], 'format': 'png',
        'colorSpace': {'albedo': 'srgb', 'normal': 'linear', 'orm': 'linear'},
        'normalY': NORMAL_Y, 'orm_channels': 'occlusion,roughness,metallic', 'uv': 'TEXCOORD_0',
        'slots': masters, 'bytes': nbytes,
    }
    hr = hidden_rows(scene, info['size'])
    if hr:
        entry['hiddenRows'] = hr  # M4 (E4c): top rows (glTF v < hiddenRows / size) = interior-face strip cells
    log('  texture set: %s (%d², %s bytes); texSet on %d glb materials' % (
        ', '.join(entry[k] for k in ('albedo', 'normal', 'orm')), info['size'],
        ' / '.join(str(nbytes[m]) for m in MAPS), n))
    return entry


# ---------------------------------------------------------------- validator check 13

def _dilate2(mask, r):
    acc = mask.copy()
    for s in range(1, r + 1):
        acc[s:] |= mask[:-s]
        acc[:-s] |= mask[s:]
    m2 = acc.copy()
    for s in range(1, r + 1):
        acc[:, s:] |= m2[:, :-s]
        acc[:, :-s] |= m2[:, s:]
    return acc


def check(rep, scene, root, info, root_dir=None):
    """ASSET_PIPELINE §9 rule 13: texture sets. A part still awaiting the texture pass only warns."""
    R = '13.textures'
    ptype = root.get('kn_type', root.name)
    masters = textured_masters(scene)
    if not masters:
        return
    s = root.get('kn_tex_set')
    if not s:
        rep.warn(R, root.name, 'no texture set yet (awaiting the texture pass; D78): run node tools/assets.mjs %s '
                               '--tex' % ptype)
        return
    if s != SET:
        rep.error(R, root.name, "kn_tex_set %r: one set per part, named %r (§5.2)" % (s, SET))
    imgs = {}
    for m in MAPS:
        name = '%s__%s__%s' % (ptype, s, m)
        img = bpy.data.images.get(name)
        if img is None:
            rep.error(R, name, 'missing %s map of set %r' % (m, s))
            continue
        imgs[m] = img
        fp = img.filepath.replace('\\', '/')
        if fp.rsplit('/', 1)[-1] != name + '.png' or fp.rsplit('/', 2)[-2:-1] != ['tex']:
            rep.error(R, name, 'file must be tex/%s.png next to the .blend (§5.2), is %r' % (name, img.filepath))
        if not os.path.exists(bpy.path.abspath(img.filepath)):
            rep.error(R, name, 'file not found: %s' % img.filepath)
        if img.colorspace_settings.name != COLORSPACE[m]:
            rep.error(R, name, '%s must be %s, is %s' % (m, COLORSPACE[m], img.colorspace_settings.name))
    if len(imgs) < len(MAPS):
        return
    sizes = {tuple(img.size) for img in imgs.values()}
    want = set_size(info.get('class') or root.get('kn_class'), ptype)
    if len(sizes) != 1:
        rep.error(R, root.name, 'maps of set %r differ in size: %s' % (s, sorted(sizes)))
        return
    w, h = sizes.pop()
    if w != h or w != want:
        rep.error(R, root.name, 'set is %dx%d; class %s%s needs %d² (§5.2)' % (
            w, h, root.get('kn_class'), ' (instancing-heavy)' if ptype in INSTANCING else '', want))
    if int(root.get('kn_tex_size', 0)) != w:
        rep.error(R, root.name, 'kn_tex_size %r does not match the maps (%d)' % (root.get('kn_tex_size'), w))
    # unlisted files in tex/
    if bpy.data.filepath:
        tdir = os.path.join(os.path.dirname(bpy.data.filepath), 'tex')
        listed = {'%s__%s__%s.png' % (ptype, s, m) for m in MAPS}
        if os.path.isdir(tdir):
            for f in sorted(os.listdir(tdir)):
                if f.startswith(ptype + '__') and f not in listed:
                    rep.error(R, f, 'unlisted file in tex/ (only %s)' % ', '.join(sorted(listed)))
    # UVs and kn_set on every textured piece
    lod0 = []
    for c, ob in textured_objects(scene):
        if not ob.data.uv_layers:
            rep.error(R, ob.name, 'textured piece has no UV map (TEXCOORD_0)')
            continue
        if ob.get('kn_set') != s:
            rep.error(R, ob.name, 'textured piece must name its set: kn_set = %r' % s)
        if c == 'RENDER':
            lod0.append(ob)
        uv = np.empty(len(ob.data.loops) * 2)
        ob.data.uv_layers.active.data.foreach_get('uv', uv)
        if uv.size and (uv.min() < -1e-4 or uv.max() > 1.0001):
            rep.error(R, ob.name, 'UVs outside 0..1 (%.3f..%.3f)' % (uv.min(), uv.max()))
    # basecolor range and per-slot hue / value
    alb = image_array(imgs['basecolor'])
    lin = srgb_to_linear(alb[..., :3])
    pk = lin.max(-1).ravel()
    p1, p99 = np.percentile(pk, 1), np.percentile(pk, 99)
    rep.stats['texset'] = '%s %d² · basecolor peak p1 %.3f p99 %.3f' % (s, w, p1, p99)
    if p99 > ALBEDO_MAX + 0.005 or p1 < ALBEDO_MIN - 0.003:
        rep.error(R, imgs['basecolor'].name, 'basecolor outside linear %.2f-%.2f (p1 %.3f, p99 %.3f)' % (
            ALBEDO_MIN, ALBEDO_MAX, p1, p99))
    means = slot_means(lod0, lin)
    for master, (rgb, area) in sorted(means.items()):
        ref = reference_colour(master)
        if ref is None or area <= 0:
            continue
        dv = rgb.max() / max(ref.max(), 1e-6) - 1.0
        if abs(dv) > VALUE_TOL:
            rep.error(R, master, 'slot mean value %+.1f %% from the master (limit ±4 %%)' % (dv * 100))
        hs, ss, _ = hsv(linear_to_srgb(rgb))
        hr, sr, _ = hsv(linear_to_srgb(ref))
        if sr >= 0.15 and ss >= 0.05:
            dh = abs((hs - hr + 180.0) % 360.0 - 180.0)
            if dh > HUE_TOL_DEG:
                rep.error(R, master, 'slot mean hue shifted %.1f° from the master (limit %.0f°)' % (dh, HUE_TOL_DEG))
    # ORM metallic: 0 or 1, soft edges <= 4 px
    orm = image_array(imgs['orm'])
    met = orm[..., 2]
    lo, hi = met <= 0.1, met >= 0.9
    mid = ~(lo | hi)
    if mid.any():
        ok = _dilate2(lo, METAL_SOFT_PX) & _dilate2(hi, METAL_SOFT_PX)
        bad = int((mid & ~ok).sum())
        if bad:
            rep.error(R, imgs['orm'].name, 'metallic must be 0 or 1: %d texels in between away from a 0/1 edge '
                                           '(soft edges <= %d px)' % (bad, METAL_SOFT_PX))
    # normal map: OpenGL +Y, tangent space
    nimg = imgs['normal']
    if nimg.get('kn_normal_y') != NORMAL_Y:
        rep.error(R, nimg.name, 'normal map must be baked OpenGL +Y (kn_normal_y = %r, got %r)' % (
            NORMAL_Y, nimg.get('kn_normal_y')))
    nrm = image_array(nimg)
    mr, mg, mb = (float(nrm[..., i].mean()) for i in range(3))
    if abs(mr - 0.5) > 0.06 or abs(mg - 0.5) > 0.06 or mb < 0.85:
        rep.error(R, nimg.name, 'not a tangent-space normal map (mean %.2f %.2f %.2f)' % (mr, mg, mb))
