"""Procedurally build BISCUIT (docs/art/briefs/critters.md, "BISCUIT: Barrel-chested good boy with a big bark").

Usage: blender -b --factory-startup -P tools/blender/make_biscuit.py -- [out.blend]
Default output: assets/src/critters/biscuit.blend

A stocky toasted-tan mutt: barrel chest, short legs, folded rose ears with brown tips, brown brow dots, cream
muzzle / chest / socks / tail underside, a plume tail curled over the back and the Ignition bandana (collar
band, a 0.12 m triangle on the chest on cloth bones bandana_01-02, knot at the nape). Soft-sculpt metaball
body, 45 deform bones, 15 RAG__ capsules (12 kg, Mochi's layout), the ART_BIBLE §8 face keys + sk_tongue_out /
sk_jowl_puff / sk_nose_wrinkle, every required clip and the role clips bark, bark_run, wake_startle, barge,
tail_wag, shake_off. Positions below are root space (floor z 0, nose -Y, +X = his left), M4 stream E4b.
"""
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from _critter import cap, chain_points, ell  # noqa: E402

TYPE = 'biscuit'
COM = (0.0, -0.03, 0.20)
TAIL_PATH = [(0, 0.248, 0.268), (0, 0.278, 0.306), (0, 0.27, 0.345), (0, 0.238, 0.364), (0, 0.203, 0.354)]
TAIL = chain_points(TAIL_PATH, 6)
EYE = (0.040, -0.27, 0.32)


def side(p, sx):
    return (p[0] * sx, p[1], p[2])


# ---------------------------------------------------------------- rig (45 deform bones)

def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.08), None),
         ('hips', (0, 0.12, 0.205), (0, 0.2, 0.205), 'root'),
         ('spine_01', (0, 0.12, 0.205), (0, 0.04, 0.207), 'hips'),
         ('spine_02', (0, 0.04, 0.207), (0, -0.05, 0.21), 'spine_01'),
         ('spine_03', (0, -0.05, 0.21), (0, -0.14, 0.222), 'spine_02'),
         ('neck_01', (0, -0.14, 0.222), (0, -0.185, 0.262), 'spine_03'),
         ('neck_02', (0, -0.185, 0.262), (0, -0.21, 0.29), 'neck_01'),
         ('head', (0, -0.21, 0.29), (0, -0.215, 0.385), 'neck_02'),
         ('jaw', (0, -0.245, 0.27), (0, -0.325, 0.255), 'head'),
         ('tongue_01', (0, -0.268, 0.259), (0, -0.296, 0.258), 'jaw'),
         ('tongue_02', (0, -0.296, 0.258), (0, -0.322, 0.257), 'tongue_01'),
         ('bandana_01', (0, -0.228, 0.248), (0, -0.248, 0.2), 'neck_01'),
         ('bandana_02', (0, -0.248, 0.2), (0, -0.25, 0.158), 'bandana_01')]
    for s, sx in (('l', 1), ('r', -1)):
        B += [('eye_' + s, side((0.04, -0.26, 0.32), sx), side((0.042, -0.29, 0.32), sx), 'head'),
              ('ear_%s_01' % s, side((0.058, -0.214, 0.37), sx), side((0.083, -0.208, 0.362), sx), 'head'),
              ('ear_%s_02' % s, side((0.083, -0.208, 0.362), sx), side((0.096, -0.2, 0.33), sx), 'ear_%s_01' % s),
              ('scapula_' + s, side((0.05, -0.1, 0.26), sx), side((0.064, -0.14, 0.17), sx), 'spine_03'),
              ('upperarm_' + s, side((0.064, -0.14, 0.17), sx), side((0.066, -0.142, 0.1), sx), 'scapula_' + s),
              ('forearm_' + s, side((0.066, -0.142, 0.1), sx), side((0.066, -0.148, 0.034), sx), 'upperarm_' + s),
              ('paw_' + s, side((0.066, -0.148, 0.034), sx), side((0.066, -0.168, 0.012), sx), 'forearm_' + s),
              ('toe_' + s, side((0.066, -0.168, 0.012), sx), side((0.066, -0.19, 0.008), sx), 'paw_' + s),
              ('thigh_' + s, side((0.064, 0.16, 0.2), sx), side((0.07, 0.125, 0.118), sx), 'hips'),
              ('shin_' + s, side((0.07, 0.125, 0.118), sx), side((0.07, 0.18, 0.058), sx), 'thigh_' + s),
              ('hock_' + s, side((0.07, 0.18, 0.058), sx), side((0.07, 0.178, 0.016), sx), 'shin_' + s),
              ('hindpaw_' + s, side((0.07, 0.178, 0.016), sx), side((0.07, 0.158, 0.01), sx), 'hock_' + s),
              ('hindtoe_' + s, side((0.07, 0.158, 0.01), sx), side((0.07, 0.136, 0.007), sx), 'hindpaw_' + s)]
    for i in range(6):
        B.append(('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], 'hips' if i == 0 else 'tail_%02d' % i))
    return B


# ---------------------------------------------------------------- soft-sculpt body

def elements():
    E = [ell('head', (0, -0.226, 0.318), (0.088, 0.063, 0.076)),
         ell('head', (0, -0.212, 0.352), (0.064, 0.052, 0.044)),          # round crown
         ell('head', (0, -0.302, 0.288), (0.045, 0.045, 0.032)),          # blunt muzzle
         ell('jaw', (0, -0.292, 0.258), (0.034, 0.038, 0.016)),
         ell('neck_01', (0, -0.165, 0.243), (0.08, 0.06, 0.08)),
         ell('neck_02', (0, -0.196, 0.274), (0.07, 0.052, 0.068)),
         ell('spine_03', (0, -0.112, 0.196), (0.11, 0.1, 0.106)),         # barrel chest
         ell('spine_02', (0, -0.024, 0.204), (0.102, 0.085, 0.09)),
         ell('spine_01', (0, 0.058, 0.212), (0.091, 0.075, 0.08)),        # tucked loin
         ell('hips', (0, 0.16, 0.207), (0.094, 0.086, 0.086))]
    for s, sx in (('l', 1), ('r', -1)):
        E += [ell('head', side((0.046, -0.258, 0.292), sx), (0.038, 0.036, 0.032)),   # cheeks
              ell('jaw', side((0.026, -0.296, 0.268), sx), (0.018, 0.026, 0.016)),    # jowls
              ell('ear_%s_01' % s, side((0.072, -0.212, 0.37), sx), (0.032, 0.012, 0.023), rot=(0, 24 * sx, 0)),
              ell('ear_%s_02' % s, side((0.096, -0.203, 0.343), sx), (0.02, 0.01, 0.032), rot=(0, 16 * sx, 0)),
              cap('scapula_' + s, side((0.05, -0.1, 0.25), sx), side((0.064, -0.14, 0.18), sx), 0.04, gen=False),
              cap('upperarm_' + s, side((0.064, -0.14, 0.16), sx), side((0.066, -0.142, 0.1), sx), 0.033),
              cap('forearm_' + s, side((0.066, -0.142, 0.1), sx), side((0.066, -0.148, 0.036), sx), 0.026),
              ell('paw_' + s, side((0.066, -0.162, 0.0185), sx), (0.027, 0.033, 0.0155)),
              cap('toe_' + s, side((0.066, -0.176, 0.011), sx), side((0.066, -0.188, 0.009), sx), 0.01, gen=False),
              ell('thigh_' + s, side((0.06, 0.162, 0.158), sx), (0.046, 0.066, 0.072)),
              cap('shin_' + s, side((0.07, 0.14, 0.1), sx), side((0.07, 0.18, 0.058), sx), 0.027),
              cap('hock_' + s, side((0.07, 0.18, 0.058), sx), side((0.07, 0.176, 0.028), sx), 0.021),
              ell('hindpaw_' + s, side((0.07, 0.164, 0.0185), sx), (0.027, 0.035, 0.0155)),
              cap('hindtoe_' + s, side((0.07, 0.15, 0.011), sx), side((0.07, 0.138, 0.009), sx), 0.01, gen=False)]
    rads = (0.024, 0.03, 0.034, 0.034, 0.03, 0.023)   # plume: fullest at the top of the curl
    for i in range(6):
        E.append(cap('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], rads[i]))
    for b in ('tongue_01', 'tongue_02', 'bandana_01', 'bandana_02'):
        pass  # skin-only bones: weighted by their own pieces
    return E


ELEMENTS = elements()
GEN = [e for e in ELEMENTS if e.gen]


def field(P):
    P = np.atleast_2d(np.asarray(P, dtype=float))
    return sum(e.field(P) for e in GEN)


def surface_along(origin, d, step=0.0015, limit=0.3):
    """First point leaving the body surface (field < threshold) marching from `origin` along `d`."""
    o = np.array(origin, dtype=float)
    d = np.array(d, dtype=float)
    d /= np.linalg.norm(d)
    t = 0.0
    while t < limit:
        if field(o + d * t)[0] < cr.MB_THRESH:
            # refine between t - step and t
            a, b = max(0.0, t - step), t
            for _ in range(12):
                m = (a + b) / 2
                if field(o + d * m)[0] < cr.MB_THRESH:
                    b = m
                else:
                    a = m
            return o + d * b
        t += step
    return o + d * limit


# Texture-mask regions (critters.md "Fur/skin material"), root space. One definition drives both the per-face
# slot (region()) and the smooth painted boundary in the D78 set (kn_tex_looks -> textures._region_colour):
# first listed wins. Terms: ellipsoid centre `c`, semi-axes `r`, soft edge, optional normal gate (axis, lo, hi).
def _e(c, r, soft=0.3, n=None):
    d = {'c': list(c), 'r': list(r), 'soft': soft}
    if n:
        d['n'] = [list(n[0]), n[1], n[2]]
    return d


REGIONS = [
    ('brown', [_e((0.102, -0.2, 0.334), (0.018, 0.028, 0.03)), _e((-0.102, -0.2, 0.334), (0.018, 0.028, 0.03)),
               _e((0.03, -0.263, 0.353), (0.012, 0.018, 0.011), 0.35),
               _e((-0.03, -0.263, 0.353), (0.012, 0.018, 0.011), 0.35)]),
    ('cream', [_e((0, -0.326, 0.275), (0.05, 0.056, 0.042)),                             # muzzle
               _e((0.045, -0.286, 0.268), (0.034, 0.03, 0.024)), _e((-0.045, -0.286, 0.268), (0.034, 0.03, 0.024)),
               _e((0, -0.29, 0.25), (0.042, 0.05, 0.022)),                               # chin
               _e((0, -0.21, 0.212), (0.07, 0.07, 0.09), 0.3, ((0, -1, 0), 0.05, 0.45)),  # chest blaze
               _e((0, -0.1, 0.108), (0.06, 0.12, 0.045), 0.3, ((0, 0, -1), 0.3, 0.7)),    # brisket
               _e((0.066, -0.157, 0.026), (0.042, 0.046, 0.04)), _e((-0.066, -0.157, 0.026), (0.042, 0.046, 0.04)),
               _e((0.07, 0.166, 0.026), (0.042, 0.048, 0.04)), _e((-0.07, 0.166, 0.026), (0.042, 0.048, 0.04)),
               _e((0, 0.235, 0.37), (0.05, 0.055, 0.036), 0.3, ((0, 0, -1), 0.15, 0.55)),  # plume underside
               _e((0, 0.272, 0.322), (0.036, 0.036, 0.04), 0.3, ((0, -1, 0), 0.15, 0.55))]),
]
COAT = 'fur'


def region(c, n, bone):
    from kn_tools.textures import region_mask_np
    P, N = np.array([c]), np.array([n])
    for name, terms in REGIONS:
        if region_mask_np(terms, (0, 0, 0), P, N)[0] >= 0.5:
            return name
    return COAT


def tex_looks(spec):
    """kn_tex_looks for the part root: the coat look + regions on every fur slot (textures.py 'fur')."""
    m = spec['masters']
    regions = [[m[name], terms] for name, terms in REGIONS]
    coat = {'look': 'fur', 'regions': regions, 'coat': m[COAT], 'com': list(COM), 'clump': 0.013, 'flow': 'Y'}
    out = {m[k]: dict(coat) for k in ('fur', 'cream', 'brown')}
    out[m['tongue']] = {'look': 'plain', 'rough': 0.4}
    out[m['catch']] = {'look': 'plain'}   # modelled catchlights: flat bone, no enamel polish
    return out


# ---------------------------------------------------------------- accessories

def ring_tube(name, pts, r, mat, sides=8, bone=None):
    """Closed tube along a closed loop of points (a manifold torus-like shell)."""
    P = [Vector(p) for p in pts]
    n = len(P)
    vs, faces = [], []
    c = sum(P, Vector()) / n
    for i, p in enumerate(P):
        t = (P[(i + 1) % n] - P[i - 1]).normalized()
        out = (p - c)
        out = (out - t * out.dot(t)).normalized()
        b = t.cross(out).normalized()
        for j in range(sides):
            a = 2 * math.pi * j / sides
            vs.append((p + r * (math.cos(a) * out + math.sin(a) * b))[:])
    for i in range(n):
        for j in range(sides):
            a, b2 = i * sides + j, i * sides + (j + 1) % sides
            c2, d = ((i + 1) % n) * sides + (j + 1) % sides, ((i + 1) % n) * sides + j
            faces.append((a, b2, c2, d))
    v = np.array(vs)
    return cr.Piece(name, v, cr.fix_winding(v, faces), mat, bone=bone)


def slab(name, front, back, mat, bone=None, field_=None):
    """Closed thin shell from two (nv, nu, 3) grids (front / back layer) with side walls."""
    nv, nu = front.shape[:2]
    vs = np.concatenate([front.reshape(-1, 3), back.reshape(-1, 3)])
    off = nv * nu
    idx = lambda i, j: i * nu + j  # noqa: E731
    faces = []
    for i in range(nv - 1):
        for j in range(nu - 1):
            faces.append((idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)))
            faces.append((off + idx(i, j), off + idx(i + 1, j), off + idx(i + 1, j + 1), off + idx(i, j + 1)))
    loop = [idx(0, j) for j in range(nu)] + [idx(i, nu - 1) for i in range(1, nv)] + \
           [idx(nv - 1, j) for j in range(nu - 2, -1, -1)] + [idx(i, 0) for i in range(nv - 2, 0, -1)]
    for k in range(len(loop)):
        a, b = loop[k], loop[(k + 1) % len(loop)]
        faces.append((a, off + a, off + b, b))
    return cr.Piece(name, vs, cr.fix_winding(vs, faces), mat, bone=bone, field=field_)


def bandana_pieces(q):
    """Ignition bandana: collar band round neck_01, a triangle draped on the chest, a knot at the nape."""
    out = []
    # collar band: surface loop round the neck, perpendicular to the neck axis
    axis = (Vector((0, -0.185, 0.262)) - Vector((0, -0.14, 0.222))).normalized()
    centre = Vector((0, -0.178, 0.256))
    e1 = Vector((1, 0, 0))
    e2 = axis.cross(e1).normalized()
    m = max(16, int(40 * q))
    loop = []
    for i in range(m):
        a = 2 * math.pi * i / m
        d = math.cos(a) * e1 + math.sin(a) * e2
        s = surface_along(centre[:], d[:])
        loop.append(Vector(s) + d * 0.0015)
    out.append(ring_tube('bandana_band', [p[:] for p in loop], 0.0055, 'bandana', sides=max(6, int(10 * q)),
                         bone='neck_01'))
    # triangle: grid in (u across, v down) projected onto the chest front
    nu, nv = max(5, int(13 * q)), max(4, int(10 * q))
    front = np.zeros((nv, nu, 3))
    back = np.zeros((nv, nu, 3))
    for i in range(nv):
        v = i / (nv - 1)
        half = 0.06 * (1 - v) + 0.004 * v
        z = 0.262 - 0.11 * v
        for j in range(nu):
            u = j / (nu - 1) * 2 - 1
            x = u * half
            o = (x * 0.4, -0.12, z)
            d = (x * 1.6, -1.0, -0.15)
            s = surface_along(o, d)
            dn = np.array(d) / np.linalg.norm(d)
            sag = 0.004 * (1 - abs(u)) * v     # cloth hangs a little proud at the middle
            front[i, j] = s + dn * (0.0052 + sag)
            back[i, j] = s + dn * (0.0018 + sag)
    tri_field = [cap('bandana_01', (0, -0.235, 0.27), (0, -0.248, 0.205), 0.04, gen=False),
                 cap('bandana_02', (0, -0.248, 0.205), (0, -0.25, 0.14), 0.035, gen=False)]
    out.append(slab('bandana', front, back, 'bandana', field_=tri_field))
    # knot at the nape + two short tails
    nape = surface_along(centre[:], (0, 0.55, 0.83))
    nk = Vector(nape) + Vector((0, 0.35, 0.6)).normalized() * 0.006
    ks = max(8, int(14 * q))
    out.append(cr.ellipsoid('bandana_knot', nk[:], (0.013, 0.011, 0.01), 'bandana', segs=ks, rings=max(6, ks // 2),
                            bone='neck_01'))
    for sx in (1, -1):
        c = nk + Vector((0.012 * sx, 0.012, -0.008))
        rot = Matrix.Rotation(math.radians(-35 * sx), 3, 'Y') @ Matrix.Rotation(math.radians(30), 3, 'X')
        out.append(cr.ellipsoid('bandana_tail_' + ('l' if sx > 0 else 'r'), c[:], (0.006, 0.0035, 0.016),
                                'bandana', segs=max(6, ks - 4), rings=max(5, ks // 2 - 1), rot=rot,
                                bone='neck_01'))
    return out


TONGUE_C = (0.0, -0.298, 0.2585)
TONGUE_SEMI = (0.0135, 0.025, 0.0042)


def tongue_piece(q):
    s = max(8, int(14 * q))
    pc = cr.ellipsoid('tongue', TONGUE_C, TONGUE_SEMI, 'tongue', segs=s, rings=max(6, s // 2),
                      field=[cap('tongue_01', (0, -0.27, 0.259), (0, -0.296, 0.258), 0.02, gen=False),
                             cap('tongue_02', (0, -0.296, 0.258), (0, -0.325, 0.257), 0.02, gen=False)])
    return pc


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    out = bandana_pieces(q)
    if lod < 2:
        out.append(tongue_piece(q))
    return out


# ---------------------------------------------------------------- extra face keys

def tongue_out(P):
    """sk_tongue_out (pant): the tongue slides forward out of the mouth and hangs down over the chin."""
    root = np.array((0.0, -0.272, 0.259))
    d = P - root
    k = np.clip(-d[:, 1] / 0.052, 0.0, 1.0)           # 0 at the root, 1 at the tip
    a = np.radians(55.0) * k                           # curls down over the chin
    y = d[:, 1] * 1.45
    z = d[:, 2]
    out = np.stack([d[:, 0] * (1 + 0.2 * k), y * np.cos(a) - z * np.sin(a), y * np.sin(a) + z * np.cos(a)], 1)
    return root + out + np.array((0.0, -0.014, -0.004))


def _smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def jowl_puff(P, N):
    """sk_jowl_puff (the "boof"): the cheeks and jowls puff out."""
    w = 0.0
    for sx in (1, -1):
        d = np.linalg.norm((P - np.array((0.035 * sx, -0.29, 0.272))) / np.array((0.03, 0.04, 0.03)), axis=1)
        w = w + _smooth(1.2 - d)
    return P + N * (0.006 * np.clip(w, 0, 1))[:, None]


def nose_wrinkle_body(P, N):
    """sk_nose_wrinkle (sniff): the top of the muzzle bunches up and back."""
    d = np.linalg.norm((P - np.array((0.0, -0.32, 0.318))) / np.array((0.035, 0.03, 0.02)), axis=1)
    w = _smooth(1.0 - d)
    return P + (np.array((0.0, 0.004, 0.003))[None] + N * 0.002) * w[:, None]


def nose_wrinkle_nose(P):
    return P + np.array((0.0, 0.002, 0.0028))


# ---------------------------------------------------------------- clips

ANIM = {'kind': 'quad', 'hips': 'hips', 'spine': ['spine_01', 'spine_02', 'spine_03'], 'neck': ['neck_01', 'neck_02'],
        'head': 'head', 'jaw': 'jaw', 'eye_l': 'eye_l', 'eye_r': 'eye_r',
        'ears': {'l': ['ear_l_01', 'ear_l_02'], 'r': ['ear_r_01', 'ear_r_02']},
        'legs': {'f' + s: {'kind': 'front', 'clav': 'scapula_' + s, 'upper': 'upperarm_' + s, 'lower': 'forearm_' + s,
                           'foot': 'paw_' + s, 'toe': 'toe_' + s} for s in 'lr'}
        | {'h' + s: {'kind': 'hind', 'upper': 'thigh_' + s, 'lower': 'shin_' + s, 'foot': 'hock_' + s,
                     'paw': 'hindpaw_' + s, 'toe': 'hindtoe_' + s} for s in 'lr'},
        'tail': ['tail_%02d' % i for i in range(1, 7)]}

SP = {'hip_h': 0.2, 'tail_carry': 0.0, 'stride': 20, 'lift': 32, 'bob': 0.005, 'walk_T': 0.8, 'run_T': 0.44,
      'run_stride': 30, 'run_flex': 8, 'lie_drop': 0.095, 'sit_pitch': 30, 'sit_drop': 0.05, 'sit_thigh': 55,
      'sit_knee': 70, 'wrap': 18, 'sleep_roll': 84, 'curl': 10}


def library():
    L = an.quad_library(SP)
    S, C, win, ramp = an.S, an.C, an.win, an.ramp
    run = None

    def wag(c, t, T, k, amp=22, base=0.0):
        """Plume wag: whole-number cycles per clip so loops stay seamless."""
        c['tail_wave'] = amp
        c['tail_freq'] = k / T
        c['tail_k'] = 0.5
        c['tail_pitch'] = c.get('tail_pitch', 0.0) + base

    def idle(t, T):   # 3 s: breathing, the odd head turn, a lazy wag
        c = {'tail_pitch': 0.0, 'tail_k': 0.5}
        breathe = S(t, T, 4)
        c.update(spine_pitch=1.2 * breathe, hip_z=0.0015 * C(t, T, 4), head_yaw=8 * S(t, T, 1),
                 head_pitch=3 * S(t, T, 2, 0.2), jaw=3 * max(0.0, S(t, T, 4)),
                 ear_back_l=10 * win(t, 1.0, 1.3), ear_splay_r=12 * win(t, 2.0, 2.25))
        wag(c, t, T, 3, amp=10)
        return c

    def idle_alt(t, T):  # 4 s: looks around, sits back a touch, scratches at nothing with a hind leg twitch
        c = {'tail_k': 0.5}
        look = math.sin(an.TAU * t / T)
        c.update(head_yaw=32 * look, neck_yaw=10 * look, head_pitch=5 * S(t, T, 2), spine_yaw=4 * look,
                 ear_back_l=-8 * look, ear_back_r=8 * look, jaw=4 * win(t, 1.6, 2.6, 0.2))
        wag(c, t, T, 4, amp=14)
        return c

    def walk(t, T):
        c = {'tail_k': 0.5}
        an.gait(c, t, T, an.WALK, SP['stride'], SP['lift'])
        c.update(hip_z=-0.0025 + 0.0025 * C(t, T, 2), spine_yaw=3.5 * S(t, T, 1), hip_roll=3 * S(t, T, 1),
                 head_pitch=-2 * C(t, T, 2), spine_roll=-2 * S(t, T, 1))
        wag(c, t, T, 2, amp=14)
        return c

    def gallop(t, T, head=0.0, ears=0.0, low=0.0, k=1.0, tail=0.0, jaw=0.0, amp=8):
        c = {'tail_k': 0.5}
        an.gait(c, t, T, an.GALLOP, SP['run_stride'] * k, SP['lift'] * 1.35)
        c.update(spine_pitch=SP['run_flex'] * S(t, T, 1, 0.25), hip_z=0.007 * S(t, T, 1) - low,
                 hip_pitch=4 * S(t, T, 1, 0.25), neck_pitch=head, head_pitch=-head * 0.5 + 3 * C(t, T, 1),
                 ear_back_l=ears + 14 * S(t, T, 1, 0.1), ear_back_r=ears + 14 * S(t, T, 1, 0.15),
                 jaw=jaw * (0.6 + 0.4 * S(t, T, 1)), tail_pitch=tail)
        wag(c, t, T, 2, amp=amp, base=0.0)
        return c

    def chase(t, T):   # happy chase: mouth open, ears flying, wagging
        return gallop(t, T, head=-6, ears=-10, low=0.004, k=1.05, jaw=10, amp=16)

    def flee(t, T):
        return gallop(t, T, head=-2, ears=50, low=0.02, k=1.1, tail=-40, amp=4)

    L['walk'] = (24, True, walk)
    L['run'] = (13, True, lambda t, T: gallop(t, T, head=-4, jaw=5))
    L['chase'] = (12, True, chase)
    L['flee'] = (11, True, flee)
    L['idle'] = (90, True, idle)
    L['idle_alt'] = (120, True, idle_alt)

    def sleep(t, T):   # sprawled on his side, legs out, slow breathing, the odd dream twitch
        c = {'tail_k': 0.5}
        br = S(t, T, 1)
        twitch = win(t, 1.7, 2.0, 0.08) * S(t, T, 18)
        c.update(hip_roll=86, hip_z=-SP['lie_drop'], spine_pitch=1.5 * br, spine_roll=4, neck_pitch=-6,
                 head_pitch=-4, head_roll=12, ear_back_l=30, ear_back_r=10, ear_splay_l=25, ear_splay_r=-10,
                 tail_pitch=-40, tail_bend=4, jaw=2 * max(0.0, br))
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_swing'] = (22 if leg[0] == 'f' else -18) + 4 * twitch * (1 if leg.endswith('l') else 0.5)
            c[leg + '_bend'] = 12 + 6 * twitch
            c[leg + '_spread'] = -6 if leg.endswith('l') else 6
        return c
    L['sleep'] = (90, True, sleep)

    def trapped(t, T):  # standing, low, ears back, tail tucked, paw lift at the bars
        c = {'tail_k': 0.5}
        paw = win(t, 0.6, 1.3, 0.15)
        c.update(hip_z=-0.012, neck_pitch=-10, head_pitch=4, head_yaw=10 * S(t, T, 1), ear_back_l=55, ear_back_r=55,
                 ear_splay_l=20, ear_splay_r=20, tail_pitch=-45, tail_bend=-2, spine_pitch=-3,
                 jaw=3 * win(t, 1.5, 1.8, 0.08))
        c['fr_swing'] = 45 * paw
        c['fr_bend'] = 50 * paw
        for leg in ('fl', 'hl', 'hr'):
            c[leg + '_bend'] = 10
        wag(c, t, T, 4, amp=5, base=-45)
        return c
    L['trapped'] = (60, True, trapped)

    def sniff(t, T):   # nose-down trail-tracking walk loop
        c = {'tail_k': 0.5}
        an.gait(c, t, T, an.WALK, SP['stride'] * 0.7, SP['lift'] * 0.8, cycles=1)
        c.update(neck_pitch=-30, head_pitch=-14 + 3 * S(t, T, 8), head_yaw=9 * S(t, T, 1), jaw=2 * max(0.0, S(t, T, 8)),
                 spine_pitch=-4, hip_z=-0.006, ear_back_l=-8, ear_back_r=-8)
        wag(c, t, T, 2, amp=18, base=4)
        return c
    L['sniff'] = (36, True, sniff)

    def celebrate(t, T):   # play-bow, then two bounces
        c = {'tail_k': 0.5}
        bow = win(t, 0.0, 0.55, 0.12)
        hop = max(0.0, math.sin(an.TAU * (t - 0.6) / 0.45)) if 0.6 <= t <= 1.5 else 0.0
        c.update(hip_pitch=-18 * bow + 15 * hop, hip_z=-0.03 * bow + 0.04 * hop, neck_pitch=10 * bow,
                 head_pitch=12 * bow + 8 * hop, jaw=10, ear_back_l=-10, ear_back_r=-10, spine_pitch=-6 * bow)
        for l in ('fl', 'fr'):
            c[l + '_swing'] = 45 * bow + 30 * hop
            c[l + '_bend'] = 20 * bow + 35 * hop
        for l in ('hl', 'hr'):
            c[l + '_swing'] = -12 * hop
        wag(c, t, T, 8, amp=26)
        return c
    L['celebrate'] = (48, False, celebrate)

    def emote_happy(t, T):
        c = {'tail_k': 0.5}
        b = max(0.0, math.sin(an.TAU * t / (T / 2)))
        c.update(hip_z=0.012 * b, head_roll=14 * math.sin(an.TAU * t / T), head_pitch=8, jaw=9, ear_back_l=-10,
                 ear_back_r=-10, spine_pitch=3 * b, hip_yaw=8 * S(t, T, 2))
        wag(c, t, T, 6, amp=28)
        return c
    L['emote_happy'] = (36, False, emote_happy)

    # ---- role clips ------------------------------------------------------------------------------

    def bark(t, T):   # 0.6 s one-shot; the mouth peaks on frame 6 (0.2 s), aligned with EMIT__bark__mouth
        c = {'tail_k': 0.5}
        pk = math.exp(-((t - 0.2) / 0.075) ** 2)
        pre = win(t, 0.0, 0.16, 0.06)
        c.update(jaw=26 * pk, head_pitch=10 * pk - 5 * pre, neck_pitch=6 * pk - 6 * pre, hip_z=-0.008 * pk,
                 spine_pitch=-3 * pk, ear_back_l=-12 * pk, ear_back_r=-12 * pk, hip_y=0.006 * pk)
        for l in ('fl', 'fr'):
            c[l + '_swing'] = -6 * pk
            c[l + '_bend'] = 10 * pk
        wag(c, t, T, 3, amp=14)
        return c

    def bark_run(t, T):   # additive upper body over run / chase: head toss and jaw
        pk = math.exp(-((t - 0.2) / 0.075) ** 2)
        return {'jaw': 24 * pk, 'head_pitch': 10 * pk, 'neck_pitch': 5 * pk, 'ear_back_l': -10 * pk,
                'ear_back_r': -10 * pk}

    def wake_startle(t, T):   # 0.5 s: sprawled -> standing, ears flip up
        u = ramp(t, 0.03, 0.4)
        lie = 1 - u
        c = {'tail_k': 0.5}
        pop = win(t, 0.12, 0.3, 0.05)
        c.update(hip_roll=86 * lie, hip_z=-SP['lie_drop'] * lie + 0.015 * win(t, 0.3, 0.45, 0.04), spine_roll=4 * lie,
                 head_roll=12 * lie, neck_pitch=-6 * lie + 8 * pop, head_pitch=10 * pop,
                 ear_back_l=30 * lie - 30 * pop, ear_back_r=10 * lie - 30 * pop, ear_splay_l=25 * lie,
                 tail_pitch=-40 * lie + 10 * pop)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_swing'] = (22 if leg[0] == 'f' else -18) * lie
            c[leg + '_bend'] = 12 * lie + 55 * win(t, 0.1, 0.35, 0.08)
            c[leg + '_spread'] = (-6 if leg.endswith('l') else 6) * lie
        return c

    def barge(t, T):   # additive 0.5 s shoulder check (left shoulder leads)
        k = math.sin(math.pi * ramp(t, 0.0, T))
        return {'spine_yaw': -10 * k, 'spine_roll': -8 * k, 'neck_pitch': -10 * k, 'head_yaw': 8 * k, 'hip_z': -0.01 * k,
                'fl_spread': 14 * k, 'fl_swing': 10 * k, 'ear_back_l': 20 * k, 'ear_back_r': 20 * k}

    def tail_wag(t, T):   # additive loop: 2 wags in 0.5 s
        return {'tail_wave': 30, 'tail_freq': 2 / T, 'tail_k': 0.45}

    def shake_off(t, T):   # 1.0 s full-body shake after getup (also clears soot); the wave runs head -> tail
        c = {'tail_k': 0.5}
        env = win(t, 0.08, 0.85, 0.12)
        f = 5.0
        c.update(head_roll=34 * env * math.sin(an.TAU * f * t), neck_yaw=10 * env * math.sin(an.TAU * f * t),
                 spine_roll=24 * env * math.sin(an.TAU * f * t - 0.9), hip_roll=12 * env * math.sin(an.TAU * f * t - 1.8),
                 ear_splay_l=45 * env * max(0.0, math.sin(an.TAU * f * t)),
                 ear_splay_r=45 * env * max(0.0, -math.sin(an.TAU * f * t)),
                 ear_back_l=15 * env, ear_back_r=15 * env, jaw=6 * env, hip_z=-0.006 * env,
                 tail_wave=35 * env, tail_freq=f, tail_k=0.6)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_spread'] = 8 * env
            c[leg + '_bend'] = 8 * env
        return c

    L.update({'bark': (18, False, bark), 'bark_run': (18, False, bark_run), 'wake_startle': (15, False, wake_startle),
              'barge': (15, False, barge), 'tail_wag': (15, True, tail_wag), 'shake_off': (30, False, shake_off)})
    del run
    return L


# ---------------------------------------------------------------- ragdoll (proposed to B4)

def ragdoll():
    """15 RAG__ capsules in Mochi's layout, 12 kg: stream B4's BISCUIT_RAG rows (packages/parts-data/src/critters.ts,
    as M2 did), copied as data: (bone, parent, joint a, end b in engine root space, radius, kg, swing, twist).
    packages/assets/test/critters_m4.test.ts fails if the two drift apart."""
    rag = cr.rag
    return [
    rag('hips', None, (0, 0.2, -0.17), (0, 0.2, -0.07), 0.1, 2.6, 20, 10),
    rag('spine_02', 'hips', (0, 0.2, -0.07), (0, 0.205, 0.03), 0.105, 2.25, 25, 15),
    rag('spine_03', 'spine_02', (0, 0.205, 0.03), (0, 0.21, 0.13), 0.11, 2.4, 25, 15),
    rag('neck_01', 'spine_03', (0, 0.21, 0.13), (0, 0.27, 0.19), 0.05, 0.5, 35, 25),
    rag('head', 'neck_01', (0, 0.27, 0.19), (0, 0.3, 0.29), 0.075, 1.4, 40, 30),
    rag('upperarm_l', 'spine_03', (0.065, 0.16, 0.14), (0.066, 0.1, 0.142), 0.03, 0.35, 70, 20),
    rag('upperarm_r', 'spine_03', (-0.065, 0.16, 0.14), (-0.066, 0.1, 0.142), 0.03, 0.35, 70, 20),
    rag('forearm_l', 'upperarm_l', (0.066, 0.1, 0.142), (0.066, 0.025, 0.15), 0.025, 0.2, 70, 10),
    rag('forearm_r', 'upperarm_r', (-0.066, 0.1, 0.142), (-0.066, 0.025, 0.15), 0.025, 0.2, 70, 10),
    rag('thigh_l', 'hips', (0.065, 0.18, -0.155), (0.07, 0.118, -0.125), 0.035, 0.5, 70, 20),
    rag('thigh_r', 'hips', (-0.065, 0.18, -0.155), (-0.07, 0.118, -0.125), 0.035, 0.5, 70, 20),
    rag('shin_l', 'thigh_l', (0.07, 0.118, -0.125), (0.07, 0.025, -0.175), 0.025, 0.25, 70, 10),
    rag('shin_r', 'thigh_r', (-0.07, 0.118, -0.125), (-0.07, 0.025, -0.175), 0.025, 0.25, 70, 10),
    rag('tail_01', 'hips', (0, 0.25, -0.22), (0, 0.33, -0.24), 0.03, 0.15, 60, 30),
    rag('tail_04', 'tail_01', (0, 0.33, -0.24), (0, 0.37, -0.16), 0.03, 0.1, 60, 30),
    ]


def eye_centre(r=0.015, fwd=(0.32, -1, 0.06), out=0.5):
    """The brief's eye point, moved along the eye axis so the eyeball stands `out` x r proud of the head surface
    (the cheeks and muzzle swell the soft-sculpt head past the brief's y -0.27)."""
    f = np.array(fwd, dtype=float)
    f /= np.linalg.norm(f)
    s = surface_along(np.array(EYE) - f * 0.05, f)
    return tuple(float(v) for v in np.round(s - f * r * (1.0 - out), 4))


EYE_AT = eye_centre()

SPEC = {
    'type': TYPE, 'com': COM, 'mass': 12.0, 'tri_budget': 48000, 'ragdoll_impulse': 10.0,
    'skins': 'toasted_tan,black_and_tan,cream',
    'notes': 'Barrel-chested good boy. Brief: docs/art/briefs/critters.md#biscuit. Origin = centre of mass; root '
             'bone on the floor at part (0,0.03,-0.2). Hind paw/toe bones are hindpaw_l/r, hindtoe_l/r (the brief '
             'names both paws paw_l/r). Texture-mask regions (cream, brown) are kn_fur_biscuit_* slots under the '
             'one body texture set. M4 stream E4b.',
    'masters': {'fur': 'kn_fur_biscuit', 'cream': 'kn_fur_biscuit_cream', 'brown': 'kn_fur_biscuit_brown',
                'eye': 'kn_ceramic_graphite', 'catch': 'kn_powder_bone', 'lid': 'kn_fur_biscuit',
                'brow': 'kn_fur_biscuit_brown', 'mouth': 'kn_ceramic_graphite', 'nose': 'kn_ceramic_graphite',
                'tongue': 'kn_fur_biscuit_tongue', 'bandana': 'kn_fabric_ignition'},
    'phys': {'friction': 0.8, 'restitution': 0.08},
    'col': {'r': 0.11, 'length': 0.56, 'centre': (0, -0.03, 0.20)},
    'bones': bones(), 'elements': ELEMENTS, 'region': region, 'accessories': accessories, 'mb_res': 0.004,
    'face': {'eye': EYE_AT, 'eye_r': 0.015, 'eye_fwd': (0.32, -1, 0.06),
             'brow': (0.0, 0.004, 0.02), 'brow_semi': (0.0, 0.0, 0.0), 'brow_rest_tilt': 0,
             'mouth': (0, -0.334, 0.262), 'mouth_semi': (0.017, 0.0042, 0.0028), 'mouth_bone': 'jaw',
             'nose': (0, -0.343, 0.304), 'nose_semi': (0.017, 0.011, 0.012)},
    'extra_keys': ('sk_tongue_out', 'sk_jowl_puff', 'sk_nose_wrinkle'),
    'body_keys': {'sk_jowl_puff': jowl_puff, 'sk_nose_wrinkle': nose_wrinkle_body},
    'piece_keys': {'sk_tongue_out': {'tongue': tongue_out}, 'sk_nose_wrinkle': {'nose': nose_wrinkle_nose}},
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.27, 0.32), (0, -1, 0), 'head'),
                 ('bark', 'mouth', (0, -0.33, 0.29), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, -0.18, 0.52), (0, 0, 1), 'head'),
                 ('step', 'paw_fl', (0.066, -0.165, 0.0), (0, 0, -1), 'paw_l'),
                 ('step', 'paw_fr', (-0.066, -0.165, 0.0), (0, 0, -1), 'paw_r'),
                 ('step', 'paw_hl', (0.07, 0.164, 0.0), (0, 0, -1), 'hindpaw_l'),
                 ('step', 'paw_hr', (-0.07, 0.164, 0.0), (0, 0, -1), 'hindpaw_r')],
    'anim': ANIM,
    'role_clips': ('bark', 'bark_run', 'wake_startle', 'barge', 'tail_wag', 'shake_off'),
}
# brow dots are painted (brown region); no brow ridge pieces on the dog
SPEC['face'].pop('brow')


# Biscuit's resting eyes are rounder and more open than the M2 default (a happy dog, never sleepy-looking).
cr.NEUTRAL.update({'lid_up': 36.0, 'lid_lo': 30.0})


def main(out_path=None, tex=True):
    import json
    from kn_tools import textures
    c = cr.Critter(SPEC)
    c.part.root['kn_tex_looks'] = json.dumps(tex_looks(SPEC), separators=(',', ':'))
    c.build(library())
    path = c.part.save(out_path)
    if tex:
        # D78 set (ASSET_PIPELINE §5.2): baked here because assets.mjs runs texture_part.py for parts only
        textures.texture_part()
        c.part.save(path)
    return path


if __name__ == '__main__':
    args = _cli.script_args()
    no_tex = _cli.flag(args, '--no-tex')
    main(os.path.abspath(args[0]) if args else None, tex=not no_tex)
