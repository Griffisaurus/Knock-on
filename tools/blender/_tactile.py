"""Tactile look-dev materials (D78): procedural Cycles stand-ins for the per-part texture sets.

They show the target surfaces before the texture pass exists: enamel paint with worn edges and darkened
cavities, hardwood with real grain, brass and copper with patina in recesses, scratched steel, paper fibre.
Colours come from the master table, so every part keeps its palette. Masters that are already right
(poly, glass, latex, fur, LEDs, screens, decals) are left alone.

Cycles only: edge wear reads Geometry > Pointiness and cavities read the Ambient Occlusion node.
"""
import bpy

from kn_tools import library
from kn_tools.masters import master_table

# master prefix -> look; first match wins
LOOKS = (
    ('kn_powder_', 'enamel'),
    ('kn_anod_', 'enamel'),
    ('kn_steel_brushed', 'steel'),
    ('kn_chrome', 'chrome'),
    ('kn_brass', 'patina'),
    ('kn_copper', 'patina'),
    ('kn_wood_', 'wood'),
    ('kn_paper_', 'paper'),
    ('kn_cardboard', 'paper'),
    ('kn_rubber', 'rubber'),
    ('kn_brick', 'brick'),
    ('kn_rope', 'cord'),
    ('kn_fuse_cord', 'cord'),
    ('kn_ceramic_', 'ceramic'),
)


def look_for(name):
    for prefix, look in LOOKS:
        if name.startswith(prefix):
            return look
    return None


class _NT:
    """Tiny node-tree helper: n('Type', **inputs) and link(a, b)."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        self.bsdf = self.nt.nodes.new('ShaderNodeBsdfPrincipled')
        self.link(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            if hasattr(node, k) and not k[0].isupper():
                setattr(node, k, v)
            else:
                node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def coords(self, scale=(1, 1, 1)):
        tc = self.n('ShaderNodeTexCoord')
        mp = self.n('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        self.link(tc.outputs['Object'], mp.inputs['Vector'])
        return mp.outputs['Vector']

    def noise(self, vec, scale, detail=4.0, rough=0.55, dims='3D'):
        nz = self.n('ShaderNodeTexNoise', noise_dimensions=dims, Scale=scale, Detail=detail, Roughness=rough)
        self.link(vec, nz.inputs['Vector'])
        return nz

    def maprange(self, val, a, b, lo=0.0, hi=1.0):
        mr = self.n('ShaderNodeMapRange', clamp=True)
        mr.inputs['From Min'].default_value = a
        mr.inputs['From Max'].default_value = b
        mr.inputs['To Min'].default_value = lo
        mr.inputs['To Max'].default_value = hi
        self.link(val, mr.inputs['Value'])
        return mr.outputs['Result']

    def math(self, op, a, b):
        m = self.n('ShaderNodeMath', operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs['Value']

    @staticmethod
    def _sock(socks, name, kind):
        return next(x for x in socks if x.name == name and x.type == kind)

    def _feed(self, sock, v):
        if isinstance(v, (int, float, tuple)):
            sock.default_value = v
        else:
            self.link(v, sock)

    def mix(self, fac, a, b, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=True)
        self._feed(self._sock(m.inputs, 'Factor', 'VALUE'), fac)
        self._feed(self._sock(m.inputs, 'A', 'RGBA'), a)
        self._feed(self._sock(m.inputs, 'B', 'RGBA'), b)
        return self._sock(m.outputs, 'Result', 'RGBA')

    def mixf(self, fac, a, b):
        m = self.n('ShaderNodeMix', data_type='FLOAT', clamp_result=True)
        self._feed(self._sock(m.inputs, 'Factor', 'VALUE'), fac)
        self._feed(self._sock(m.inputs, 'A', 'VALUE'), a)
        self._feed(self._sock(m.inputs, 'B', 'VALUE'), b)
        return self._sock(m.outputs, 'Result', 'VALUE')

    def cavity(self, dist=0.025):
        ao = self.n('ShaderNodeAmbientOcclusion', only_local=True, samples=12)
        ao.inputs['Distance'].default_value = dist
        return ao.outputs['AO']

    def edges(self, lo=0.57, hi=0.68, breakup=40.0):
        """Worn-edge mask: convex edges (pointiness) broken up by noise so wear reads as hand polish, not a stripe."""
        geo = self.n('ShaderNodeNewGeometry')
        e = self.maprange(geo.outputs['Pointiness'], lo, hi)
        nz = self.noise(self.coords(), breakup, detail=6.0, rough=0.65)
        brk = self.maprange(nz.outputs['Fac'], 0.42, 0.62)
        return self.math('MULTIPLY', e, brk)

    def bump(self, height, strength, dist, bevel=0.0015):
        bv = self.n('ShaderNodeBevel', samples=6)
        bv.inputs['Radius'].default_value = bevel
        b = self.n('ShaderNodeBump', Strength=strength, Distance=dist)
        self.link(height, b.inputs['Height'])
        self.link(bv.outputs['Normal'], b.inputs['Normal'])
        self.link(b.outputs['Normal'], self.bsdf.inputs['Normal'])

    def set(self, **kw):
        names = {'base': 'Base Color', 'metal': 'Metallic', 'rough': 'Roughness', 'coat': 'Coat Weight',
                 'coat_rough': 'Coat Roughness', 'sheen': 'Sheen Weight', 'aniso': 'Anisotropic',
                 'sss': 'Subsurface Weight', 'spec': 'Specular IOR Level'}
        for k, v in kw.items():
            sock = self.bsdf.inputs[names[k]]
            if isinstance(v, (int, float, tuple)):
                sock.default_value = v
            else:
                self.link(v, sock)


def _shade(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


def _tint(c, t, k):
    return (c[0] * (1 - k) + t[0] * k, c[1] * (1 - k) + t[1] * k, c[2] * (1 - k) + t[2] * k, 1.0)


def build(name, look, spec, axis='X'):
    """One tactile material for master `name` (spec from master_table)."""
    mat = bpy.data.materials.new(name + '__tactile' + ('' if look != 'wood' else '_' + axis))
    t = _NT(mat)
    base = library.hexcol(spec['base'])
    rough = spec.get('rough', 0.5)
    vec = t.coords()
    var = t.noise(vec, 9.0, detail=3.0)
    cav = t.cavity()
    dark = t.maprange(cav, 0.35, 1.0, 0.0, 1.0)  # 0 in recesses

    if look == 'enamel':
        # thick enamel paint, slightly mottled; edges polished through to steel; recesses a touch darker
        col = t.mix(t.maprange(var.outputs['Fac'], 0.3, 0.7), _shade(base, 0.93), _shade(base, 1.04))
        col = t.mix(dark, _shade(base, 0.72), col)
        wear = t.edges()
        col = t.mix(t.math('MULTIPLY', wear, 0.85), col, (0.62, 0.62, 0.6, 1.0))
        t.set(base=col, metal=t.math('MULTIPLY', wear, 0.85),
              rough=t.mixf(wear, t.maprange(var.outputs['Fac'], 0.3, 0.7, 0.36, 0.52), 0.28),
              coat=0.18, coat_rough=0.22)
        peel = t.noise(vec, 900.0, detail=2.0)
        t.bump(peel.outputs['Fac'], 0.06, 0.0004)
    elif look in ('steel', 'chrome'):
        scratch = t.noise(t.coords((1.0, 1.0, 40.0)), 180.0, detail=8.0, rough=0.7)
        r0 = 0.06 if look == 'chrome' else rough
        t.set(base=t.mix(dark, _shade(base, 0.55), base), metal=1.0,
              rough=t.maprange(scratch.outputs['Fac'], 0.3, 0.75, r0, r0 + 0.14),
              aniso=0.0 if look == 'chrome' else 0.5)
        t.bump(scratch.outputs['Fac'], 0.04, 0.0002)
    elif look == 'patina':
        patina = (0.10, 0.20, 0.15)
        p = t.math('MULTIPLY', t.math('SUBTRACT', 1.0, dark), t.maprange(var.outputs['Fac'], 0.35, 0.65))
        t.set(base=t.mix(p, base, _tint(base, patina, 0.7)), metal=t.mixf(p, 1.0, 0.3),
              rough=t.mixf(p, t.maprange(var.outputs['Fac'], 0.3, 0.7, 0.2, 0.36), 0.7))
        t.bump(var.outputs['Fac'], 0.05, 0.0005)
    elif look == 'wood':
        lo, hi = (library.hexcol(h) for h in spec.get('wood', ('#9A6338', '#D7A86E')))
        stretch = {'X': (1.0, 14.0, 14.0), 'Y': (14.0, 1.0, 14.0), 'Z': (14.0, 14.0, 1.0)}[axis]
        gvec = t.coords(stretch)
        wave = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', Scale=2.2,
                   Distortion=9.0, Detail=6.0)
        wave.inputs['Detail Scale'].default_value = 1.6
        t.link(gvec, wave.inputs['Vector'])
        fine = t.noise(gvec, 60.0, detail=10.0, rough=0.7)
        g = t.math('MULTIPLY', wave.outputs['Fac'], t.maprange(fine.outputs['Fac'], 0.3, 0.7, 0.7, 1.0))
        col = t.mix(t.maprange(g, 0.15, 0.85), lo, hi)
        col = t.mix(dark, _shade(lo, 0.6), col)
        wear = t.edges(0.56, 0.66, 30.0)
        col = t.mix(t.math('MULTIPLY', wear, 0.5), col, _shade(hi, 1.12))
        t.set(base=col, rough=t.maprange(g, 0.0, 1.0, 0.42, 0.62), coat=0.22, coat_rough=0.25)
        t.bump(g, 0.18, 0.0008)
    elif look == 'paper':
        fib = t.noise(vec, 260.0, detail=10.0, rough=0.75)
        col = t.mix(t.maprange(var.outputs['Fac'], 0.3, 0.7), _shade(base, 0.9), _shade(base, 1.05))
        t.set(base=t.mix(dark, _shade(base, 0.65), col), rough=rough + 0.05, sheen=0.25)
        t.bump(fib.outputs['Fac'], 0.12, 0.0006)
    elif look == 'rubber':
        nz = t.noise(vec, 400.0, detail=4.0)
        t.set(base=t.mix(t.maprange(var.outputs['Fac'], 0.3, 0.7), _shade(base, 0.92), _shade(base, 1.12)),
              rough=0.78, sheen=0.3)
        t.bump(nz.outputs['Fac'], 0.03, 0.0002)
    elif look == 'brick':
        grain = t.noise(vec, 220.0, detail=8.0, rough=0.8)
        col = t.mix(t.maprange(var.outputs['Fac'], 0.25, 0.75), _shade(base, 0.82), _shade(base, 1.1))
        t.set(base=t.mix(dark, _shade(base, 0.55), col), rough=0.9)
        t.bump(grain.outputs['Fac'], 0.3, 0.001)
    elif look == 'cord':
        twist = t.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', Scale=60.0, Distortion=1.0)
        t.link(vec, twist.inputs['Vector'])
        t.set(base=t.mix(t.maprange(twist.outputs['Fac'], 0.2, 0.8), _shade(base, 0.8), base), rough=0.9, sheen=0.4)
        t.bump(twist.outputs['Fac'], 0.25, 0.0008)
    elif look == 'ceramic':
        t.set(base=t.mix(dark, _shade(base, 0.8), base), rough=0.18, coat=0.5, coat_rough=0.05)
    return mat


def _longest_axis(ob):
    d = ob.dimensions
    return 'XYZ'[max(range(3), key=lambda i: d[i])]


def apply(objects, root):
    """Swap master materials on `objects` for tactile ones; link the remaining masters from materials.blend.
    Returns the masters dict (for callers that want kn_led etc.)."""
    from kn_tools import paths
    from kn_tools.conventions import is_master_material
    table = master_table()
    cache = {}
    linked_names = set()
    for ob in objects:
        if ob.type != 'MESH':
            continue
        for slot in ob.material_slots:
            m = slot.material
            if not m or m.library:
                continue
            key = m.name.split('.')[0]
            look = look_for(key)
            if look and key in table:
                axis = _longest_axis(ob) if look == 'wood' else 'X'
                ck = (key, axis)
                if ck not in cache:
                    cache[ck] = build(key, look, table[key], axis)
                slot.link = 'OBJECT'
                slot.material = cache[ck]
            elif is_master_material(key):
                linked_names.add(key)
    masters = library.link_materials(paths.materials_lib(root), sorted(linked_names)) if linked_names else {}
    for m in list(bpy.data.materials):
        key = m.name.split('.')[0]
        if not m.library and key in masters and m is not masters[key]:
            m.user_remap(masters[key])
    return masters
