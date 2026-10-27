"""Procedurally build HENNY (docs/art/briefs/critters.md, "HENNY: Highly strung hen who lays when startled").

Usage: blender -b --factory-startup -P tools/blender/make_henny.py -- [out.blend] [--no-tex]
Default output: assets/src/critters/henny.blend

A plump buff hen: an egg-shaped soft-sculpt body with a cream breast and fluff, sculpted feather-clump wings
(separate closed clumps on the wing chain, so they lift cleanly off the body; never cards) with caramel primaries,
a fanned caramel tail, a three-lobed red comb and wattle, a yellow beak (lower beak on `jaw`), yellow legs and
the Beam ribbon bow at the nape (tails on cloth bones bow_01-02). 42 deform bones (the brief's 41 plus
`spine_03`, which the rig standard requires), 10 RAG__ capsules (1.6 kg), the ART_BIBLE §8 face keys (brows are
feather tufts) + sk_beak_wide / sk_feather_fluff / sk_comb_flop, every required clip and the role clips flap,
lay_egg, glide_down, peck, scratch, proud_puff. Root space: floor z 0, beak -Y, +X = her left. M4 stream E4b.
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
from _critter import cap, ell  # noqa: E402

TYPE = 'henny'
COM = (0.0, 0.0, 0.14)
EYE = (0.026, -0.12, 0.26)
EYE_R = 0.009
EYE_FWD = (0.75, -0.62, 0.06)


def side(p, sx):
    return (p[0] * sx, p[1], p[2])


# wing chain (left side, folded along the flank), root space
WING = [(0.058, -0.048, 0.188), (0.078, -0.036, 0.176), (0.09, 0.0, 0.166), (0.093, 0.04, 0.162),
        (0.09, 0.072, 0.152), (0.085, 0.1, 0.143), (0.076, 0.128, 0.134)]
WING_BONES = ('shoulder', 'upper', 'fore', 'hand', 'primaries_01', 'primaries_02')
TAIL = [(0, 0.105, 0.17), (0, 0.13, 0.2), (0, 0.15, 0.228), (0, 0.162, 0.25)]


# ---------------------------------------------------------------- rig (42 deform bones)

def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.06), None),
         ('hips', (0, 0.07, 0.142), (0, 0.12, 0.15), 'root'),
         ('spine_01', (0, 0.07, 0.142), (0, 0.02, 0.144), 'hips'),
         ('spine_02', (0, 0.02, 0.144), (0, -0.03, 0.152), 'spine_01'),
         ('spine_03', (0, -0.03, 0.152), (0, -0.058, 0.172), 'spine_02'),
         ('neck_01', (0, -0.058, 0.172), (0, -0.072, 0.194), 'spine_03'),
         ('neck_02', (0, -0.072, 0.194), (0, -0.083, 0.212), 'neck_01'),
         ('neck_03', (0, -0.083, 0.212), (0, -0.09, 0.227), 'neck_02'),
         ('neck_04', (0, -0.09, 0.227), (0, -0.095, 0.24), 'neck_03'),
         ('head', (0, -0.095, 0.24), (0, -0.1, 0.298), 'neck_04'),
         ('jaw', (0, -0.128, 0.244), (0, -0.162, 0.24), 'head'),
         ('comb', (0, -0.1, 0.29), (0, -0.1, 0.322), 'head'),
         ('wattle', (0, -0.138, 0.232), (0, -0.14, 0.2), 'head'),
         ('bow_01', (0, -0.035, 0.212), (0, -0.026, 0.195), 'neck_02'),
         ('bow_02', (0, -0.026, 0.195), (0, -0.02, 0.176), 'bow_01')]
    for s, sx in (('l', 1), ('r', -1)):
        B.append(('eye_' + s, side(EYE, sx), side((EYE[0] + 0.02, EYE[1] - 0.016, EYE[2]), sx), 'head'))
        prev = 'spine_03'
        for i, b in enumerate(WING_BONES):
            nm = '%s_%s' % (b, s)
            B.append((nm, side(WING[i], sx), side(WING[i + 1], sx), prev))
            prev = nm
        B += [('thigh_' + s, side((0.034, 0.035, 0.13), sx), side((0.04, 0.012, 0.09), sx), 'hips'),
              ('shin_' + s, side((0.04, 0.012, 0.09), sx), side((0.04, 0.03, 0.058), sx), 'thigh_' + s),
              ('tarsus_' + s, side((0.04, 0.03, 0.058), sx), side((0.04, 0.022, 0.011), sx), 'shin_' + s),
              ('toe_main_' + s, side((0.04, 0.022, 0.011), sx), side((0.04, -0.018, 0.004), sx), 'tarsus_' + s),
              ('toe_back_' + s, side((0.04, 0.022, 0.011), sx), side((0.04, 0.042, 0.006), sx), 'tarsus_' + s)]
    for i in range(3):
        B.append(('tail_%02d' % (i + 1), TAIL[i], TAIL[i + 1], 'hips' if i == 0 else 'tail_%02d' % i))
    return B


# ---------------------------------------------------------------- soft-sculpt body

def elements():
    E = [ell('spine_02', (0, 0.0, 0.142), (0.087, 0.075, 0.08)),     # egg body
         ell('spine_01', (0, 0.052, 0.144), (0.085, 0.07, 0.078)),
         ell('hips', (0, 0.096, 0.158), (0.068, 0.058, 0.064)),
         ell('spine_03', (0, -0.05, 0.152), (0.074, 0.062, 0.074)),   # plump breast
         ell('neck_01', (0, -0.068, 0.194), (0.05, 0.044, 0.048)),
         ell('neck_02', (0, -0.082, 0.216), (0.043, 0.04, 0.042)),
         ell('neck_03', (0, -0.09, 0.232), (0.04, 0.038, 0.038)),
         ell('head', (0, -0.1, 0.258), (0.04, 0.044, 0.04)),
         ell('head', (0, -0.118, 0.252), (0.03, 0.03, 0.028)),        # face / cheeks
         cap('tail_01', TAIL[0], TAIL[1], 0.034),
         cap('tail_02', TAIL[1], TAIL[2], 0.022, gen=False),
         cap('tail_03', TAIL[2], TAIL[3], 0.016, gen=False),
         ell('jaw', (0, -0.14, 0.243), (0.01, 0.012, 0.006), gen=False),
         cap('comb', (0, -0.1, 0.29), (0, -0.1, 0.322), 0.012, gen=False),
         cap('wattle', (0, -0.138, 0.232), (0, -0.14, 0.205), 0.01, gen=False)]
    for s, sx in (('l', 1), ('r', -1)):
        E += [ell('thigh_' + s, side((0.044, 0.025, 0.098), sx), (0.032, 0.04, 0.036)),   # fluffy drumstick
              cap('shin_' + s, side((0.04, 0.012, 0.09), sx), side((0.04, 0.03, 0.062), sx), 0.02),
              cap('tarsus_' + s, side((0.04, 0.03, 0.058), sx), side((0.04, 0.022, 0.014), sx), 0.008, gen=False),
              cap('toe_main_' + s, side((0.04, 0.022, 0.011), sx), side((0.04, -0.018, 0.004), sx), 0.008, gen=False),
              cap('toe_back_' + s, side((0.04, 0.022, 0.011), sx), side((0.04, 0.042, 0.006), sx), 0.006, gen=False)]
        for i, b in enumerate(WING_BONES):   # skin-only influences for the wing clumps
            E.append(cap('%s_%s' % (b, s), side(WING[i], sx), side(WING[i + 1], sx), 0.03 if i < 2 else 0.024,
                         gen=False))
    return E


ELEMENTS = elements()
GEN = [e for e in ELEMENTS if e.gen]


def field(P):
    P = np.atleast_2d(np.asarray(P, dtype=float))
    return sum(e.field(P) for e in GEN)


def surface_along(origin, d, step=0.001, limit=0.25):
    o = np.array(origin, dtype=float)
    d = np.array(d, dtype=float)
    d /= np.linalg.norm(d)
    t = 0.0
    while t < limit:
        if field(o + d * t)[0] < cr.MB_THRESH:
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


def eye_centre(out=0.5):
    f = np.array(EYE_FWD, dtype=float)
    f /= np.linalg.norm(f)
    s = surface_along(np.array(EYE) - f * 0.03, f)
    return tuple(float(v) for v in np.round(s - f * EYE_R * (1.0 - out), 4))


EYE_AT = eye_centre()


# ---------------------------------------------------------------- texture-mask regions (see make_biscuit.py)

def _e(c, r, soft=0.3, n=None):
    d = {'c': list(c), 'r': list(r), 'soft': soft}
    if n:
        d['n'] = [list(n[0]), n[1], n[2]]
    return d


REGIONS = [
    ('cream', [_e((0, -0.075, 0.13), (0.075, 0.07, 0.075), 0.3, ((0, -1, 0), 0.0, 0.4)),     # breast
               _e((0, 0.02, 0.08), (0.075, 0.1, 0.045), 0.35, ((0, 0, -1), 0.1, 0.5)),       # belly fluff
               _e((0.044, 0.025, 0.09), (0.034, 0.04, 0.03), 0.3), _e((-0.044, 0.025, 0.09), (0.034, 0.04, 0.03), 0.3),
               _e((0, 0.13, 0.13), (0.05, 0.04, 0.035), 0.35, ((0, 0, -1), 0.0, 0.4))]),     # vent fluff
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
    m = spec['masters']
    regions = [[m[name], terms] for name, terms in REGIONS]
    coat = {'look': 'feather', 'regions': regions, 'coat': m[COAT], 'com': list(COM), 'clump': 0.011, 'flow': 'Y',
            'stretch': 0.6}
    out = {m['fur']: dict(coat), m['cream']: dict(coat)}
    out[m['caramel']] = {'look': 'feather', 'clump': 0.01, 'flow': 'Y', 'stretch': 0.5}
    out[m['comb']] = {'look': 'plain', 'rough': 0.45}
    out[m['beak']] = {'look': 'plain', 'rough': 0.35}       # brief: the beak gets roughness 0.35 through the ORM
    out[m['catch']] = {'look': 'plain'}
    return out


# ---------------------------------------------------------------- pieces

def clump(name, centre, length_dir, width_dir, size, mat, q, field_=None, bone=None):
    """A sculpted feather clump: a flattened ellipsoid (closed), long along `length_dir`."""
    L = Vector(length_dir).normalized()
    W = Vector(width_dir)
    W = (W - L * W.dot(L)).normalized()
    N = W.cross(L)   # right-handed (W, L, N): a mirrored frame would turn the shell inside out
    s = max(8, int(14 * q))
    rot = Matrix((W, L, N)).transposed()
    return cr.ellipsoid(name, centre, (size[1], size[0], size[2]), mat, segs=s, rings=max(5, s // 2 + 1), rot=rot,
                        bone=bone, field=field_)


def wing_pieces(q):
    """Folded wing per side: coverts, secondaries and caramel primaries layered on the flank."""
    out = []
    for s, sx in (('l', 1), ('r', -1)):
        fld = [e for e in ELEMENTS if e.bone.endswith('_' + s) and e.bone.split('_' + s)[0] in WING_BONES]
        rows = [  # (along 0..1 of the chain, drop below the chain (m), size (len, width, thick), material)
            (0.12, 0.0, (0.04, 0.034, 0.009), 'fur'), (0.3, 0.004, (0.042, 0.034, 0.009), 'fur'),
            (0.48, 0.006, (0.04, 0.03, 0.008), 'fur'),
            (0.3, 0.03, (0.055, 0.024, 0.007), 'fur'), (0.46, 0.034, (0.058, 0.024, 0.007), 'fur'),
            (0.62, 0.03, (0.058, 0.022, 0.007), 'fur'),
            (0.64, 0.012, (0.062, 0.018, 0.006), 'caramel'), (0.76, 0.02, (0.064, 0.017, 0.006), 'caramel'),
            (0.86, 0.008, (0.06, 0.016, 0.0055), 'caramel'), (0.92, 0.024, (0.056, 0.015, 0.0055), 'caramel'),
        ]
        if q < 0.4:
            rows = rows[:2] + rows[3:4] + rows[5:7] + rows[8:9]
        pts = [Vector(side(p, sx)) for p in WING]
        lens = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
        tot = sum(lens)
        for k, (u, drop, size, mat) in enumerate(rows):
            d = u * tot
            i = 0
            while i < len(lens) - 1 and d > lens[i]:
                d -= lens[i]
                i += 1
            p = pts[i].lerp(pts[i + 1], min(1.0, d / lens[i]))
            p = p + Vector((0, 0, -drop))
            surf = Vector(surface_along((0.0, p.y, p.z), (sx, 0.0, 0.0)))
            c = Vector((abs(surf.x) * sx, p.y, p.z)) + Vector((sx * (size[2] * 0.45 + 0.0015 * k / 9), 0, 0))
            back = Vector((0.0, 1.0, -0.35 - 0.6 * drop / 0.034))
            out.append(clump('wing_%s_%d' % (s, k), c[:], back[:], (0, 0, 1), size, mat, q, field_=fld))
    return out


def tail_pieces(q):
    """The caramel tail fan: five clumps radiating up and back from tail_02 / tail_03."""
    out = []
    fld = [e for e in ELEMENTS if e.bone in ('tail_02', 'tail_03')]
    base = Vector((0, 0.142, 0.215))
    n = 5 if q >= 0.4 else 3
    for k in range(n):
        a = math.radians(-52 + 104 * k / (n - 1))
        d = Vector((math.sin(a) * 0.75, 0.45, 0.8 * math.cos(a) + 0.15)).normalized()
        c = base + d * 0.034 + Vector((0, 0.004 * abs(k - (n - 1) / 2), 0))
        # each feather lies in the fan plane (normal ~ +Y), so the fan reads from the front and the back
        w = Vector((0, 1, 0)).cross(d)
        out.append(clump('tail_%d' % k, c[:], d[:], w[:], (0.072, 0.026, 0.008), 'caramel', q, field_=fld))
    return out


def comb_pieces(q):
    out = []
    s = max(8, int(14 * q))
    for k, (dy, h, r) in enumerate(((-0.018, 0.022, 0.011), (0.0, 0.03, 0.013), (0.018, 0.024, 0.011))):
        out.append(cr.ellipsoid('comb_%d' % k, (0, -0.1 + dy, 0.292 + h * 0.4), (0.0055, r, h * 0.62), 'comb', segs=s,
                                rings=max(5, s // 2), bone='comb'))
    out.append(cr.ellipsoid('comb_base', (0, -0.1, 0.289), (0.006, 0.026, 0.008), 'comb', segs=s, rings=max(5, s // 2),
                            bone='comb'))
    for sx in (1, -1):
        out.append(cr.ellipsoid('wattle_' + ('l' if sx > 0 else 'r'), (0.006 * sx, -0.137, 0.218), (0.007, 0.007, 0.014),
                                'comb', segs=s, rings=max(5, s // 2), bone='wattle'))
    return out


BEAK_UP_C = (0.0, -0.153, 0.252)
BEAK_LO_C = (0.0, -0.149, 0.2415)


def beak_pieces(q):
    s = max(8, int(16 * q))
    up = cr.ellipsoid('beak_up', BEAK_UP_C, (0.0095, 0.018, 0.0065), 'beak', segs=s, rings=max(6, s // 2),
                      rot=Matrix.Rotation(math.radians(-12), 3, 'X'), bone='head')
    # taper the upper beak to a hooked point
    v = up.verts
    k = np.clip((BEAK_UP_C[1] - v[:, 1]) / 0.018, 0.0, 1.0)
    v[:, 0] *= (1 - 0.6 * k)
    v[:, 2] -= 0.004 * k * k
    lo = cr.ellipsoid('beak_lo', BEAK_LO_C, (0.0075, 0.013, 0.0042), 'beak', segs=s, rings=max(6, s // 2), bone='jaw')
    return [up, lo]


def leg_pieces(q):
    out = []
    sides = max(6, int(10 * q))
    for s, sx in (('l', 1), ('r', -1)):
        out.append(cr.tube('tarsus_' + s, [side((0.04, 0.03, 0.062), sx), side((0.04, 0.026, 0.035), sx),
                                           side((0.04, 0.022, 0.013), sx)], [0.0062, 0.0058, 0.0055], 'beak',
                           sides=sides, bone='tarsus_' + s))
        out.append(cr.ellipsoid('ankle_' + s, side((0.04, 0.022, 0.011), sx), (0.0065, 0.0065, 0.006), 'beak',
                                segs=sides, rings=max(5, sides // 2), bone='tarsus_' + s))
        for k, ang in enumerate((-28, 0, 28)):
            a = math.radians(ang)
            tip = (0.04 * sx + math.sin(a) * 0.034 * sx, 0.022 - math.cos(a) * 0.034, 0.0036)
            out.append(cr.tube('toe_%s_%d' % (s, k), [side((0.04, 0.022, 0.009), sx), tip], [0.0038, 0.0032], 'beak',
                               sides=max(5, sides - 2), bone='toe_main_' + s))
        out.append(cr.tube('toe_%s_back' % s, [side((0.04, 0.022, 0.009), sx), side((0.04, 0.044, 0.0036), sx)],
                           [0.0034, 0.003], 'beak', sides=max(5, sides - 2), bone='toe_back_' + s))
    return out


def bow_pieces(q):
    """Beam ribbon bow at the nape (0.045 wide), two 0.04 m tails on bow_01 / bow_02."""
    nape = Vector(surface_along((0, -0.082, 0.214), (0, 1.0, 0.25)))
    c = nape + Vector((0, 0.006, 0.0))
    s = max(8, int(14 * q))
    out = [cr.ellipsoid('bow_knot', c[:], (0.0065, 0.006, 0.006), 'bow', segs=s, rings=max(5, s // 2), bone='neck_02')]
    for sx in (1, -1):
        lc = c + Vector((0.0125 * sx, 0.002, 0.003))
        rot = Matrix.Rotation(math.radians(-20 * sx), 3, 'Y')
        out.append(cr.ellipsoid('bow_loop_' + ('l' if sx > 0 else 'r'), lc[:], (0.012, 0.004, 0.0085), 'bow', segs=s,
                                rings=max(5, s // 2), rot=rot, bone='neck_02'))
        fld = [cap('bow_01', (0, -0.035, 0.212), (0, -0.026, 0.195), 0.015, gen=False),
               cap('bow_02', (0, -0.026, 0.195), (0, -0.02, 0.176), 0.015, gen=False)]
        tc = c + Vector((0.006 * sx, 0.006, -0.02))
        rot = Matrix.Rotation(math.radians(-14 * sx), 3, 'Y') @ Matrix.Rotation(math.radians(18), 3, 'X')
        out.append(cr.ellipsoid('bow_tail_' + ('l' if sx > 0 else 'r'), tc[:], (0.0055, 0.0022, 0.02), 'bow',
                                segs=max(6, s - 4), rings=max(5, s // 2), rot=rot, field=fld))
    return out


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    return wing_pieces(q) + tail_pieces(q) + comb_pieces(q) + beak_pieces(q) + leg_pieces(q) + bow_pieces(q)


# ---------------------------------------------------------------- extra face keys

def _rot_about(P, pivot, axis, deg):
    R = np.array(Matrix.Rotation(math.radians(deg), 3, axis))
    return (P - pivot) @ R.T + pivot


JAW_PIVOT = np.array((0.0, -0.13, 0.245))


def beak_open(deg):
    return lambda P: _rot_about(P, JAW_PIVOT, 'X', -deg)   # lower beak tip swings down


def feather_fluff(P, N):
    return P + N * 0.007


def comb_flop(P):
    """The comb sags sideways and down when dizzy or sleepy."""
    base = np.array((0.0, -0.1, 0.288))
    return _rot_about(P, base, 'Y', 38.0) + np.array((0.004, 0.0, -0.003))


# ---------------------------------------------------------------- clips

ANIM = {'kind': 'quad', 'hips': 'hips', 'spine': ['spine_01', 'spine_02', 'spine_03'],
        'neck': ['neck_01', 'neck_02', 'neck_03', 'neck_04'], 'head': 'head', 'jaw': 'jaw', 'eye_l': 'eye_l',
        'eye_r': 'eye_r', 'ears': {},
        'legs': {'h' + s: {'kind': 'hind', 'upper': 'thigh_' + s, 'lower': 'shin_' + s, 'foot': 'tarsus_' + s,
                           'paw': 'toe_main_' + s} for s in 'lr'},
        'tail': ['tail_01', 'tail_02', 'tail_03']}

BIPED = {'hl': 0.0, 'hr': 0.5}


def library():
    S, C, win, ramp, TAU = an.S, an.C, an.win, an.ramp, an.TAU
    L = {}

    def wings(c, yaw=0.0, roll=0.0, fold=0.0, flare=0.0, ph=0.0):
        """Wing pose: `yaw` swings the chain out from the flank (deg), `roll` raises it (+ up), `fold` bends the
        hand back in, `flare` fans the primaries. Same values mirror to both sides."""
        b = c.setdefault('bones', {})
        for s, sx in (('l', 1), ('r', -1)):
            b['shoulder_' + s] = [('r', -roll * sx), ('y', -yaw * sx)]
            b['fore_' + s] = [('y', fold * sx)]
            b['hand_' + s] = [('y', fold * 0.6 * sx), ('r', -flare * 0.3 * sx)]
            b['primaries_01_' + s] = [('y', -flare * sx)]
            b['primaries_02_' + s] = [('y', -flare * 0.6 * sx)]
        return c

    def flapping(c, t, T, k, amp=55, base=10, yaw=78):
        f = math.sin(TAU * k * t / T)
        return wings(c, yaw=yaw, roll=base + amp * f, fold=-6 * f, flare=12 + 8 * f)

    def head_jerk(t, T, n, amp):
        """Chicken head: holds still, then snaps to a new angle (n steps per clip, periodic)."""
        u = (t / T) * n
        i = int(u) % n
        frac = u - int(u)
        vals = [amp * math.sin(TAU * j / n * 2.3) for j in range(n)]
        a, b = vals[i - 1], vals[i]
        return a + (b - a) * an.ss(frac / 0.25)

    def walkcycle(c, t, T, stride=26, lift=40, cycles=1, bob=1.0):
        an.gait(c, t, T, BIPED, stride, lift, cycles=cycles, legs=('hl', 'hr'))
        ph = TAU * cycles * t / T * 2
        c['hip_roll'] = c.get('hip_roll', 0) + 6 * math.sin(TAU * cycles * t / T)
        c['hip_z'] = c.get('hip_z', 0) - 0.003 * bob + 0.003 * bob * math.cos(ph)
        # the head stays put while the body moves on, then catches up: neck pitch bob
        c['neck_pitch'] = c.get('neck_pitch', 0) + 10 * bob * math.sin(ph)
        c['head_pitch'] = c.get('head_pitch', 0) - 9 * bob * math.sin(ph)
        return c

    def idle(t, T):
        c = {}
        c.update(spine_pitch=1.5 * S(t, T, 3), head_yaw=head_jerk(t, T, 6, 30), head_roll=head_jerk(t, T, 5, 14),
                 jaw=6 * win(t, 1.5, 1.7, 0.05) + 6 * win(t, 1.85, 2.0, 0.05), tail_pitch=2 * S(t, T, 3))
        return wings(c, roll=1.5 * S(t, T, 3))
    L['idle'] = (90, True, idle)

    def idle_alt(t, T):   # preen: the head dips under one wing, then looks around
        c = {}
        pre = win(t, 0.6, 2.2, 0.35)
        c.update(neck_yaw=60 * pre, head_yaw=70 * pre + head_jerk(t, T, 4, 15) * (1 - pre), neck_pitch=-25 * pre,
                 head_pitch=-20 * pre + 10 * pre * S(t, T, 12), head_roll=10 * pre, spine_yaw=8 * pre)
        wings(c, roll=0)
        c['bones']['shoulder_l'] = [('r', -12 * pre), ('y', -10 * pre)]
        return c
    L['idle_alt'] = (120, True, idle_alt)

    def walk(t, T):
        c = walkcycle({}, t, T)
        c.update(spine_yaw=4 * S(t, T, 1), tail_yaw=6 * S(t, T, 1))
        return wings(c, roll=2 * S(t, T, 2))
    L['walk'] = (24, True, walk)

    def run(t, T, lean=-14, wing=20, head=-10, k=1.0):
        c = walkcycle({}, t, T, stride=38 * k, lift=55, bob=1.4)
        c.update(hip_pitch=lean, neck_pitch=c['neck_pitch'] + head, head_pitch=c['head_pitch'] - lean - head * 0.4,
                 tail_pitch=-lean * 0.5)
        return wings(c, yaw=wing, roll=wing * 0.6 + 8 * S(t, T, 2), flare=wing * 0.3)
    L['run'] = (14, True, run)
    L['chase'] = (13, True, lambda t, T: run(t, T, lean=-18, wing=14, head=-16))
    L['flee'] = (12, True, lambda t, T: flapping(run(t, T, lean=-10, wing=0, head=8, k=1.1), t, T, 2, amp=40, base=20,
                                                 yaw=60))

    def startled(t, T):   # 0.8 s: the jump and the wing burst (the feather puff is EMIT__feathers__body)
        c = {}
        air = win(t, 0.08, 0.5, 0.06)
        crouch = win(t, 0.0, 0.08, 0.04)
        burst = win(t, 0.06, 0.55, 0.06)
        c.update(hip_z=-0.012 * crouch + 0.03 * air, neck_pitch=14 * burst, head_pitch=-6 * burst,
                 head_yaw=12 * S(t, T, 3) * burst, tail_pitch=20 * burst, jaw=20 * burst)
        c['hl_swing'] = c['hr_swing'] = -15 * air
        c['hl_bend'] = c['hr_bend'] = 40 * crouch + 30 * air
        return flapping(c, t, T, 3, amp=45 * burst, base=25 * burst, yaw=80 * burst)
    L['startled'] = (24, False, startled)

    def tumble(t, T):
        c = {}
        for i, l in enumerate(('hl', 'hr')):
            c[l + '_swing'] = 40 * S(t, T, 2, i * 0.3)
            c[l + '_bend'] = 35 + 30 * C(t, T, 2, i * 0.3)
        c.update(spine_pitch=-12 * S(t, T, 1), neck_pitch=20 * S(t, T, 2), head_roll=20 * S(t, T, 1), jaw=15,
                 tail_pitch=15 * S(t, T, 2))
        return flapping(c, t, T, 4, amp=50, base=10, yaw=70)
    L['tumble'] = (24, True, tumble)

    def getup(t, T):
        u = ramp(t, 0.25, 0.85)
        c = {'hip_roll': 85 * (1 - u), 'hip_z': -0.06 * (1 - u), 'neck_pitch': -20 * (1 - u),
             'head_roll': 30 * (1 - ramp(t, 0.1, 0.5))}
        push = win(t, 0.2, 0.7, 0.12)
        c['hl_bend'] = c['hr_bend'] = 50 * (1 - u) + 30 * push
        wings(c, yaw=50 * push, roll=30 * push)
        return c
    L['getup'] = (36, False, getup)

    def dizzy(t, T):
        c = {'head_yaw': 18 * S(t, T, 2), 'head_roll': 16 * C(t, T, 2), 'neck_yaw': 8 * S(t, T, 1),
             'hip_roll': 6 * S(t, T, 1), 'neck_pitch': -8 + 6 * S(t, T, 2, 0.25), 'jaw': 5}
        c['hl_spread'] = c['hr_spread'] = 8
        return wings(c, yaw=12, roll=8 + 6 * S(t, T, 2))
    L['dizzy'] = (60, True, dizzy)

    def trapped(t, T):   # wings tucked, indignant; shuffles in place
        c = {'hip_z': -0.01, 'neck_pitch': -6, 'head_yaw': head_jerk(t, T, 4, 35), 'head_roll': 10 * S(t, T, 2),
             'jaw': 10 * win(t, 0.9, 1.1, 0.05), 'tail_pitch': 8}
        c['hl_bend'] = 10 + 14 * max(0.0, S(t, T, 2))
        c['hr_bend'] = 10 + 14 * max(0.0, -S(t, T, 2))
        return wings(c, roll=-3)
    L['trapped'] = (60, True, trapped)

    def celebrate(t, T):
        c = {}
        hop = max(0.0, math.sin(TAU * t / (T / 2))) if t < T * 0.9 else 0.0
        c.update(hip_z=0.03 * hop, neck_pitch=10, head_pitch=-6, tail_pitch=18, jaw=12 * hop)
        c['hl_bend'] = c['hr_bend'] = 25 * (1 - hop)
        return flapping(c, t, T, 4, amp=45, base=30, yaw=75)
    L['celebrate'] = (45, False, celebrate)

    def sleep(t, T):   # roosting fluff: settled on her belly, legs folded under, head tucked into the neck
        br = S(t, T, 1)
        c = {'hip_z': -0.052, 'neck_pitch': -38 + 1.5 * br, 'head_pitch': 20, 'head_yaw': 15, 'spine_pitch': 1.5 * br,
             'tail_pitch': -6}
        c['hl_swing'] = c['hr_swing'] = 40
        c['hl_bend'] = c['hr_bend'] = 95
        return wings(c, roll=-2 + 1.5 * br)
    L['sleep'] = (90, True, sleep)

    def sniff(t, T):   # ground inspection: a slow walk with a peck every step
        c = walkcycle({}, t, T, stride=18, lift=30, bob=0.6)
        pk = max(0.0, S(t, T, 2)) ** 3
        c.update(neck_pitch=c['neck_pitch'] - 30 - 25 * pk, head_pitch=c['head_pitch'] - 20 * pk, jaw=6 * pk,
                 head_roll=head_jerk(t, T, 4, 18))
        return wings(c)
    L['sniff'] = (36, True, sniff)

    def emote_happy(t, T):
        c = {}
        b = max(0.0, math.sin(TAU * t / (T / 2)))
        c.update(hip_z=0.008 * b, head_roll=16 * S(t, T, 1), spine_roll=6 * S(t, T, 2), tail_yaw=14 * S(t, T, 4),
                 jaw=8 * b)
        return wings(c, yaw=18, roll=12 + 10 * S(t, T, 6))
    L['emote_happy'] = (36, False, emote_happy)

    def emote_angry(t, T):
        stomp = win(t, 0.25, 0.45, 0.06) + win(t, 0.65, 0.85, 0.06)
        c = {'neck_pitch': -16, 'head_pitch': 10, 'jaw': 20 * stomp, 'hip_z': -0.006 * stomp, 'tail_pitch': 15}
        c['hl_bend'] = 35 * win(t, 0.25, 0.45, 0.06)
        c['hr_bend'] = 35 * win(t, 0.65, 0.85, 0.06)
        return wings(c, yaw=40, roll=25, flare=15)
    L['emote_angry'] = (36, False, emote_angry)

    def emote_confused(t, T):
        tilt = math.sin(TAU * t / T)
        c = {'head_roll': 28 * tilt, 'head_yaw': -20 * tilt, 'neck_pitch': 5}
        return wings(c, roll=4)
    L['emote_confused'] = (45, False, emote_confused)

    # ---- role clips ------------------------------------------------------------------------------

    def flap(t, T):   # 0.6 s rise loop, full-span wings (two beats); the engine lifts the body 1.0 m
        c = {'hip_pitch': 14, 'neck_pitch': 10, 'head_pitch': -16, 'tail_pitch': 12, 'jaw': 10 + 8 * S(t, T, 2)}
        c['hl_swing'] = c['hr_swing'] = -25
        c['hl_bend'] = c['hr_bend'] = 35
        c['hip_z'] = 0.004 * S(t, T, 2, 0.25)
        return flapping(c, t, T, 2, amp=58, base=12, yaw=82)
    L['flap'] = (18, True, flap)

    def lay_egg(t, T):   # 0.8 s mid-air squat; the YOLK spawns on frame 18 (0.6 s), then a look-back double take
        sq = win(t, 0.2, 0.62, 0.1)
        look = win(t, 0.62, 0.8, 0.04)
        take = math.sin(TAU * max(0.0, t - 0.62) / 0.12) if t > 0.62 else 0.0
        c = {'hip_pitch': -10 * sq + 12, 'hip_z': -0.01 * sq, 'tail_pitch': 30 * sq, 'spine_pitch': -6 * sq,
             'neck_yaw': 45 * look, 'head_yaw': 70 * look + 15 * take * look, 'neck_pitch': 6, 'jaw': 16 * look}
        c['hl_swing'] = c['hr_swing'] = -25 + 30 * sq
        c['hl_bend'] = c['hr_bend'] = 35 + 40 * sq
        c['hl_spread'] = c['hr_spread'] = 12 * sq
        return flapping(c, t, T, 3, amp=50 - 20 * sq, base=15, yaw=80)
    L['lay_egg'] = (24, False, lay_egg)

    def glide_down(t, T):   # descending: wings held wide with small beats, feet reaching down
        c = {'hip_pitch': 6, 'neck_pitch': 4, 'head_pitch': -6, 'tail_pitch': 10}
        c['hl_swing'] = c['hr_swing'] = 10
        c['hl_bend'] = c['hr_bend'] = 10
        return flapping(c, t, T, 2, amp=18, base=22, yaw=84)
    L['glide_down'] = (24, True, glide_down)

    def peck(t, T):   # two quick pecks
        p = max(0.0, S(t, T, 2, -0.25)) ** 4
        c = {'neck_pitch': -20 - 40 * p, 'head_pitch': -25 * p, 'jaw': 8 * p, 'hip_pitch': -6 * p, 'tail_pitch': 6 * p}
        return wings(c, roll=2 * p)
    L['peck'] = (30, True, peck)

    def scratch(t, T):   # alternating backward kicks, head down to look at the dirt
        c = {'neck_pitch': -22, 'head_pitch': -10 + head_jerk(t, T, 4, 10), 'hip_pitch': -6}
        for l, ph in (('hl', 0.0), ('hr', 0.5)):
            k = max(0.0, S(t, T, 2, ph)) ** 2
            c[l + '_swing'] = -40 * k
            c[l + '_bend'] = 25 * k
        return wings(c, roll=4, yaw=6)
    L['scratch'] = (36, True, scratch)

    def proud_puff(t, T):   # celebrate variant after laying: chest out, head high, wings shimmy
        u = win(t, 0.1, 1.3, 0.2)
        c = {'spine_pitch': 14 * u, 'neck_pitch': 18 * u, 'head_pitch': -14 * u, 'tail_pitch': 22 * u,
             'jaw': 14 * win(t, 0.5, 1.0, 0.08) * max(0.0, S(t, T, 6))}
        return wings(c, yaw=20 * u, roll=14 * u + 6 * u * S(t, T, 6), flare=10 * u)
    L['proud_puff'] = (45, False, proud_puff)
    return L


# ---------------------------------------------------------------- ragdoll (proposed to B4)

def ragdoll():
    """10 RAG__ capsules (hips, spine_02, neck_02, head, upper wings x2, thighs x2, shins x2), 1.6 kg: stream B4's
    HENNY_RAG rows (packages/parts-data/src/critters.ts), copied as data (engine root space, nose +Z)."""
    rag = cr.rag
    return [
    rag('hips', None, (0, 0.13, -0.11), (0, 0.135, -0.03), 0.075, 0.5, 20, 10),
    rag('spine_02', 'hips', (0, 0.135, -0.03), (0, 0.15, 0.04), 0.075, 0.48, 25, 15),
    rag('neck_02', 'spine_02', (0, 0.15, 0.04), (0, 0.21, 0.09), 0.03, 0.08, 35, 25),
    rag('head', 'neck_02', (0, 0.21, 0.09), (0, 0.255, 0.12), 0.04, 0.12, 40, 30),
    rag('upper_l', 'spine_02', (0.065, 0.17, 0.02), (0.07, 0.15, -0.07), 0.02, 0.08, 70, 20),
    rag('upper_r', 'spine_02', (-0.065, 0.17, 0.02), (-0.07, 0.15, -0.07), 0.02, 0.08, 70, 20),
    rag('thigh_l', 'hips', (0.035, 0.13, -0.035), (0.04, 0.09, -0.012), 0.02, 0.08, 70, 20),
    rag('thigh_r', 'hips', (-0.035, 0.13, -0.035), (-0.04, 0.09, -0.012), 0.02, 0.08, 70, 20),
    rag('shin_l', 'thigh_l', (0.04, 0.09, -0.012), (0.04, 0.012, -0.022), 0.012, 0.05, 70, 10),
    rag('shin_r', 'thigh_r', (-0.04, 0.09, -0.012), (-0.04, 0.012, -0.022), 0.012, 0.05, 70, 10),
    ]


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 1.6, 'tri_budget': 40000, 'ragdoll_impulse': 1.2,
    'skins': 'buff,russet,pearl',
    'notes': 'Highly strung hen. Brief: docs/art/briefs/critters.md#henny. Origin = centre of mass; root bone on the '
             'floor at part (0,0,-0.14). spine_03 is added to the brief\'s 41 bones (the rig standard requires '
             'spine_01-03). Wing bones are shoulder/upper/fore/hand/primaries_01-02_<side>; the wings and tail are '
             'separate sculpted feather clumps. M4 stream E4b.',
    'masters': {'fur': 'kn_fur_henny', 'cream': 'kn_fur_henny_cream', 'caramel': 'kn_fur_henny_caramel',
                'comb': 'kn_fur_henny_comb', 'beak': 'kn_fur_henny_beak', 'eye': 'kn_ceramic_graphite',
                'catch': 'kn_powder_bone', 'lid': 'kn_fur_henny', 'brow': 'kn_fur_henny_caramel',
                'bow': 'kn_fabric_beam'},
    'phys': {'friction': 0.8, 'restitution': 0.12},
    'col': {'r': 0.08, 'length': 0.24, 'centre': (0, 0.01, 0.13)},
    'bones': bones(), 'elements': ELEMENTS, 'region': region, 'accessories': accessories, 'mb_res': 0.003,
    'face': {'eye': EYE_AT, 'eye_r': EYE_R, 'eye_fwd': EYE_FWD,
             'brow': (0.0, 0.002, 0.0115), 'brow_semi': (0.008, 0.004, 0.003), 'brow_rest_tilt': 10},
    'extra_keys': ('sk_beak_wide', 'sk_feather_fluff', 'sk_comb_flop'),
    'body_keys': {'sk_feather_fluff': feather_fluff},
    'piece_keys': {'sk_beak_wide': {'beak_lo': beak_open(30)}, 'sk_vis_a': {'beak_lo': beak_open(22)},
                   'sk_vis_o': {'beak_lo': beak_open(14)}, 'sk_vis_e': {'beak_lo': beak_open(8)},
                   'sk_surprised': {'beak_lo': beak_open(12)}, 'sk_scared': {'beak_lo': beak_open(8)},
                   'sk_comb_flop': {'comb_0': comb_flop, 'comb_1': comb_flop, 'comb_2': comb_flop,
                                    'comb_base': comb_flop}},
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.12, 0.26), (0, -1, 0), 'head'),
                 ('voice', 'mouth', (0, -0.15, 0.25), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, -0.06, 0.42), (0, 0, 1), 'head'),
                 ('step', 'foot_l', (0.04, 0.005, 0.0), (0, 0, -1), 'toe_main_l'),
                 ('step', 'foot_r', (-0.04, 0.005, 0.0), (0, 0, -1), 'toe_main_r'),
                 ('egg', 'vent', (0, 0.10, 0.10), (0, 0, -1), 'hips'),
                 ('feathers', 'body', (0, 0, 0.15), (0, 0, 1), 'spine_02')],
    'anim': ANIM,
    'role_clips': ('flap', 'lay_egg', 'glide_down', 'peck', 'scratch', 'proud_puff'),
}


def main(out_path=None, tex=True):
    import json
    from kn_tools import textures
    c = cr.Critter(SPEC)
    c.part.root['kn_tex_looks'] = json.dumps(tex_looks(SPEC), separators=(',', ':'))
    c.build(library())
    path = c.part.save(out_path)
    if tex:
        textures.texture_part()   # D78 set (ASSET_PIPELINE §5.2); assets.mjs bakes parts only
        c.part.save(path)
    return path


if __name__ == '__main__':
    args = _cli.script_args()
    no_tex = _cli.flag(args, '--no-tex')
    main(os.path.abspath(args[0]) if args else None, tex=not no_tex)
