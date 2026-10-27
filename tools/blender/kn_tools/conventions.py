"""KNOCK-ON asset conventions (docs/art/ASSET_PIPELINE.md §3-§5, §9) as plain data.

No bpy here, so the same tables serve the add-on, the headless CLI scripts and plain-Python checks.
"""
import re

PIPELINE_VERSION = '0.1.0'
CELL = 0.1  # metres per game cell (§3.1)

# §3.3 collections. RENDER holds LOD0.
LOD_COLLECTIONS = ('RENDER', 'LOD1', 'LOD2', 'LOD3')
KNOWN_COLLECTIONS = LOD_COLLECTIONS + ('COL', 'PORT', 'SENSOR', 'EMIT', 'PIVOT', 'SCREEN', 'CAVITY', 'FRAC', 'RIG')
TEMPLATE_COLLECTIONS = LOD_COLLECTIONS + ('COL', 'PORT', 'SENSOR', 'EMIT', 'PIVOT')
REQUIRED_COLLECTIONS = LOD_COLLECTIONS + ('COL',)

FAMILIES = ('rollers', 'frame', 'drive', 'air', 'power', 'boom', 'contraptions', 'matter', 'fun', 'future',
            'critters')
CLASSES = ('S', 'M', 'L', 'XL')

CHANNELS = ('impact', 'signal', 'spin', 'tension', 'power', 'light', 'heat', 'air', 'fluid', 'sound', 'lure', 'field')
SENSOR_KINDS = ('trigger', 'pressure', 'intake', 'catch',
                'impact', 'light', 'heat', 'air', 'fluid', 'sound', 'lure', 'field')
PORT_DIRS = ('in', 'out', 'both')
PORT_SIZES = ('S', 'M', 'L')
PORT_KINDS = ('axle', 'hook', 'end')
PORT_RING_DIAMETER = {'S': 0.028, 'M': 0.042, 'L': 0.056}  # shared_kit.md §1.1 outer Ø

# §3.4 collision
COL_KINDS = ('sphere', 'box', 'capsule', 'cylinder', 'hull', 'mesh', 'heightfield', 'wheel')
PHYS_MATERIALS = ('powder', 'rubber', 'steel', 'wood', 'glass', 'paper', 'brick', 'ceramic', 'latex', 'fur', 'fabric',
                  'concrete', 'soil', 'regolith')
MAX_COL_SHAPES = 12
MAX_HULL_VERTS = 64
MAX_COL_MESH_TRIS = 4000
MIN_SHAPE_THICKNESS = 0.005

# §3.2 origin rules, keyed by the root `kn_origin` property the template writes.
ORIGIN_KINDS = ('com', 'bottom', 'axle', 'hinge', 'path')  # path: path-drawn kits (GUTTER), origin = first point

# §4 budgets: LOD0 tris (min, max), uniquely textured material slots.
CLASS_BUDGETS = {
    'S': {'tris': (300, 3000), 'textured': 2},
    'M': {'tris': (3000, 10000), 'textured': 3},
    'L': {'tris': (10000, 25000), 'textured': 3},
    'XL': {'tris': (25000, 60000), 'textured': 4},
}
LOD_RATIOS = {'LOD1': 0.50, 'LOD2': 0.25, 'LOD3': 0.08}
LOD_RATIO_TOLERANCE = 0.10      # relative, "±10 %"
LOD3_PRIMITIVE_FLOOR = 20       # a 12-tri box or 20-tri icosahedron is always accepted (§4)
MAX_MATERIAL_SLOTS = 12
TEXTURE_SIZES = (1024, 2048, 4096)

# §3.8 root custom properties. Everything else numeric/boolean named kn_* becomes an .art.json hint.
ROOT_REQUIRED = ('kn_type', 'kn_family', 'kn_class', 'kn_footprint', 'kn_mass_hint')
ROOT_OPTIONAL = ('kn_skins', 'led_groups', 'kn_notes')
# Pipeline bookkeeping props written by the template; not gameplay hints.
ROOT_PIPELINE = ('kn_origin', 'kn_tri_budget', 'kn_version', 'kn_material_budget', 'kn_bounds', 'kn_com_explicit',
                 'kn_tex_size', 'kn_tex_version')  # M3 (E3c): texture-set bookkeeping, not hints

LOWER_SNAKE = r'[a-z0-9]+(?:_[a-z0-9]+)*'
_RE_LOWER_SNAKE = re.compile('^' + LOWER_SNAKE + '$')

# Master material ids (§5.1). The validator also requires the material to be linked from materials.blend.
BRAND = ('ignition', 'volt', 'cobalt', 'plasma', 'bone', 'graphite', 'amber', 'beam')
_MASTER_PATTERNS = [
    r'kn_powder_(?:%s)(?:_gloss)?' % '|'.join(BRAND),
    r'kn_anod_(?:graphite|beam|volt|cobalt|plasma|ignition)',
    r'kn_steel_brushed', r'kn_chrome', r'kn_brass', r'kn_copper',
    r'kn_poly_(?:clear|beam|amber|plasma)', r'kn_glass',
    r'kn_rubber(?:_grip)?', r'kn_wood_(?:oak|walnut)',
    r'kn_paper_(?:red|tan)', r'kn_cardboard',
    r'kn_latex_(?:%s)' % '|'.join(BRAND), r'kn_ceramic_(?:%s)' % '|'.join(BRAND),
    r'kn_brick', r'kn_rope', r'kn_fuse_cord', r'kn_wax',
    r'kn_fabric_(?:%s)' % '|'.join(BRAND), r'kn_fur_' + LOWER_SNAKE, r'kn_slime',
    r'kn_led', r'kn_screen', r'kn_decal',
    r'kn_interior_(?:wood|brick|glass|ceramic|metal|paper)', r'kn_env_' + LOWER_SNAKE,
]
_RE_MASTER = re.compile('^(?:' + '|'.join(_MASTER_PATTERNS) + ')$')
# Flat masters share textures game-wide, so they never count toward the textured-slot budget (§4).
UNTEXTURED_PREFIXES = ('kn_powder_', 'kn_anod_', 'kn_steel_', 'kn_chrome', 'kn_brass', 'kn_copper', 'kn_rubber',
                       'kn_poly_', 'kn_glass', 'kn_led', 'kn_screen', 'kn_decal')


def is_lower_snake(s):
    return bool(_RE_LOWER_SNAKE.match(s))


def is_master_material(name):
    return bool(_RE_MASTER.match(name))


def parse_footprint(value):
    """'2.2,2.2,2.2' -> (2.2, 2.2, 2.2) in cells (w = X, h = Z, d = Y in Blender)."""
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(',')]
    else:
        parts = list(value)
    if len(parts) != 3:
        raise ValueError('kn_footprint needs three values "w,h,d"')
    return tuple(float(p) for p in parts)


def split_list(value):
    if not value:
        return []
    return [s.strip() for s in str(value).split(',') if s.strip()]


def parse_led_groups(value):
    """'0:status,1:charge_bar' -> [{'index': 0, 'name': 'status'}, ...]."""
    out = []
    for item in split_list(value):
        idx, _, name = item.partition(':')
        out.append({'index': int(idx), 'name': name.strip()})
    return out


def default_origin(family):
    return 'com' if family in ('rollers', 'critters') else 'bottom'


# Object name grammar per collection (§3.3). Each returns a dict of parts or None.
_RE = {
    'RENDER': re.compile(r'^(?P<type>%s)__(?P<piece>%s)$' % (LOWER_SNAKE, LOWER_SNAKE)),
    'LOD': re.compile(r'^(?P<type>%s)__(?P<piece>%s)__L(?P<lod>[123])$' % (LOWER_SNAKE, LOWER_SNAKE)),
    'COL': re.compile(r'^COL__(?P<kind>[a-z]+)__(?P<name>[A-Za-z0-9_]+)$'),
    'PORT': re.compile(r'^PORT__(?P<channel>[a-z]+)__(?P<name>%s)$' % LOWER_SNAKE),
    'PORT_RING': re.compile(r'^PORT__(?P<channel>[a-z]+)__(?P<name>%s)__ring$' % LOWER_SNAKE),
    'SENSOR': re.compile(r'^SENSOR__(?P<kind>[a-z]+)__(?P<name>%s)$' % LOWER_SNAKE),
    'EMIT': re.compile(r'^EMIT__(?P<fx>%s)__(?P<name>%s)$' % (LOWER_SNAKE, LOWER_SNAKE)),
    'PIVOT': re.compile(r'^PIVOT__(?P<name>%s)$' % LOWER_SNAKE),
    'SCREEN': re.compile(r'^SCREEN__(?P<name>%s)$' % LOWER_SNAKE),
    'CAVITY': re.compile(r'^CAVITY__(?P<name>%s)$' % LOWER_SNAKE),
    'FRAC': re.compile(r'^FRAC__(?P<n>\d+)$'),
}


def parse_name(collection, name):
    key = 'LOD' if collection in ('LOD1', 'LOD2', 'LOD3') else collection
    rx = _RE.get(key)
    if rx is None:
        return None
    m = rx.match(name)
    return m.groupdict() if m else None


def parse_port_ring_name(name):
    m = _RE['PORT_RING'].match(name)
    return m.groupdict() if m else None


def blender_to_engine(v):
    """Blender Z-up (x, y, z) -> engine/glTF Y-up (x, z, -y). Front (-Y) becomes +Z (DATA_FORMATS §8)."""
    return [v[0], v[2], -v[1]]


def round_list(v, nd=5):
    return [round(float(x), nd) + 0.0 for x in v]  # + 0.0 folds -0.0
