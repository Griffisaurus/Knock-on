"""Procedurally build BANDIT (docs/art/briefs/critters.md, "BANDIT: Masked raccoon with sticky hands").

Usage: blender -b --factory-startup -P tools/blender/make_bandit.py -- [out.blend]
Default output: assets/src/critters/bandit.blend

An ash-grey raccoon: charcoal mask with a lighter rim round each eye, cream brow / muzzle / ear rims, dark
oversized four-fingered hands and feet, a fat tail with 5 charcoal rings and the Amber satchel (brass press-stud,
strap over the right shoulder). 43 deform bones + the non-deform `prop_r` socket (right palm), 14 RAG__
capsules (5.5 kg), the ART_BIBLE §8 face keys + sk_grin_sly / sk_whiskers_fwd / sk_eyes_sparkle, every
required clip and the role clips pedal, pedal_mount, pedal_dismount, steal_grab, steal_carry, loot_admire,
wash_hands.
"""
import math
import os
import sys

import numpy as np
from mathutils import Euler

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from _critter import cap, chain_points, ell  # noqa: E402

TYPE = 'bandit'
COM = (0.0, -0.02, 0.15)
TAIL_PATH = [(0, 0.185, 0.17), (0, 0.255, 0.17), (0, 0.325, 0.15), (0, 0.395, 0.15), (0, 0.435, 0.18)]
TAIL = chain_points(TAIL_PATH, 8)
EYE = (0.032, -0.213, 0.236)   # brief (0.032, -0.205, 0.235), pushed 8 mm forward to clear the head


def side(p, sx):
    return (p[0] * sx, p[1], p[2])


def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.06), None),
         ('hips', (0, 0.08, 0.17), (0, 0.14, 0.17), 'root'),
         ('spine_01', (0, 0.08, 0.17), (0, 0.02, 0.17), 'hips'),
         ('spine_02', (0, 0.02, 0.17), (0, -0.05, 0.165), 'spine_01'),
         ('spine_03', (0, -0.05, 0.165), (0, -0.11, 0.165), 'spine_02'),
         ('neck_01', (0, -0.11, 0.165), (0, -0.14, 0.185), 'spine_03'),
         ('neck_02', (0, -0.14, 0.185), (0, -0.165, 0.2), 'neck_01'),
         ('head', (0, -0.165, 0.2), (0, -0.175, 0.28), 'neck_02'),
         ('jaw', (0, -0.19, 0.2), (0, -0.245, 0.19), 'head'),
         ('satchel', (0.088, 0.02, 0.155), (0.09, 0.02, 0.1), 'spine_02'),
         ('satchel_flap', (0.104, 0.02, 0.158), (0.107, 0.02, 0.125), 'satchel')]
    for s, sx in (('l', 1), ('r', -1)):
        B += [('eye_' + s, side((0.032, -0.195, 0.235), sx), side((0.032, -0.225, 0.235), sx), 'head'),
              ('ear_' + s, side((0.05, -0.165, 0.27), sx), side((0.058, -0.16, 0.3), sx), 'head'),
              ('clavicle_' + s, side((0.02, -0.08, 0.16), sx), side((0.055, -0.09, 0.14), sx), 'spine_03'),
              ('upperarm_' + s, side((0.055, -0.09, 0.14), sx), side((0.06, -0.1, 0.085), sx), 'clavicle_' + s),
              ('forearm_' + s, side((0.06, -0.1, 0.085), sx), side((0.06, -0.105, 0.03), sx), 'upperarm_' + s),
              ('hand_' + s, side((0.06, -0.105, 0.03), sx), side((0.06, -0.125, 0.008), sx), 'forearm_' + s),
              ('thumb_' + s, side((0.052, -0.12, 0.01), sx), side((0.045, -0.138, 0.006), sx), 'hand_' + s),
              ('fingers_' + s, side((0.06, -0.125, 0.008), sx), side((0.06, -0.148, 0.004), sx), 'hand_' + s),
              ('thigh_' + s, side((0.055, 0.11, 0.17), sx), side((0.06, 0.085, 0.09), sx), 'hips'),
              ('shin_' + s, side((0.06, 0.085, 0.09), sx), side((0.06, 0.13, 0.04), sx), 'thigh_' + s),
              ('foot_' + s, side((0.06, 0.13, 0.04), sx), side((0.06, 0.11, 0.008), sx), 'shin_' + s),
              ('toe_' + s, side((0.06, 0.11, 0.008), sx), side((0.06, 0.085, 0.005), sx), 'foot_' + s)]
    for i in range(8):
        B.append(('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], 'hips' if i == 0 else 'tail_%02d' % i))
    B.append(('prop_r', (-0.06, -0.13, 0.012), (-0.06, -0.13, 0.032), 'hand_r', {'deform': False}))
    return B


def elements():
    E = [ell('head', (0, -0.175, 0.232), (0.06, 0.05, 0.05)),
         ell('head', (0, -0.222, 0.208), (0.025, 0.03, 0.02)),
         ell('jaw', (0, -0.215, 0.195), (0.018, 0.022, 0.01)),
         ell('neck_01', (0, -0.13, 0.178), (0.05, 0.04, 0.05)),
         ell('neck_02', (0, -0.155, 0.195), (0.045, 0.035, 0.045)),
         ell('spine_03', (0, -0.08, 0.15), (0.07, 0.06, 0.07)),
         ell('spine_02', (0, -0.01, 0.155), (0.08, 0.075, 0.075)),
         ell('spine_01', (0, 0.06, 0.165), (0.085, 0.07, 0.08)),
         ell('hips', (0, 0.12, 0.17), (0.08, 0.065, 0.075))]
    for s, sx in (('l', 1), ('r', -1)):
        E += [ell('head', side((0.055, -0.17, 0.215), sx), (0.03, 0.03, 0.028)),
              ell('ear_' + s, side((0.054, -0.162, 0.284), sx), (0.017, 0.007, 0.018), rot=(0, 22 * sx, 0)),
              cap('clavicle_' + s, side((0.02, -0.08, 0.16), sx), side((0.055, -0.09, 0.14), sx), 0.035, gen=False),
              cap('upperarm_' + s, side((0.058, -0.095, 0.13), sx), side((0.06, -0.1, 0.085), sx), 0.022),
              cap('forearm_' + s, side((0.06, -0.1, 0.085), sx), side((0.06, -0.105, 0.032), sx), 0.018),
              ell('hand_' + s, side((0.06, -0.116, 0.012), sx), (0.021, 0.024, 0.01)),
              cap('thumb_' + s, side((0.049, -0.122, 0.009), sx), side((0.043, -0.137, 0.006), sx), 0.0052),
              ell('thigh_' + s, side((0.055, 0.11, 0.12), sx), (0.04, 0.055, 0.06)),
              cap('shin_' + s, side((0.06, 0.09, 0.09), sx), side((0.06, 0.13, 0.042), sx), 0.02),
              cap('foot_' + s, side((0.06, 0.13, 0.042), sx), side((0.06, 0.12, 0.012), sx), 0.016),
              ell('foot_' + s, side((0.06, 0.105, 0.011), sx), (0.022, 0.04, 0.011)),
              cap('toe_' + s, side((0.06, 0.09, 0.008), sx), side((0.06, 0.075, 0.006), sx), 0.008, gen=False)]
        for k, dx in enumerate((-0.012, -0.004, 0.004, 0.012)):   # four visible fingers
            E.append(cap('fingers_' + s, side((0.06 + dx, -0.128, 0.008), sx), side((0.06 + dx * 1.25, -0.146, 0.006), sx),
                         0.0055))
    for i in range(8):
        r = 0.03 - 0.006 * (i / 7) ** 2
        E.append(cap('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], r))
    return E


def _tail_u(p):
    """Arc-length parameter 0..1 of point p along the tail path."""
    best, bu = 1e9, 0.0
    total = sum((TAIL[i + 1] - TAIL[i]).length for i in range(8))
    acc = 0.0
    for i in range(8):
        a, b = np.array(TAIL[i][:]), np.array(TAIL[i + 1][:])
        d = b - a
        L = np.linalg.norm(d)
        t = max(0.0, min(1.0, float(np.dot(p - a, d) / (L * L))))
        dist = np.linalg.norm(a + d * t - p)
        if dist < best:
            best, bu = dist, (acc + t * L) / total
        acc += L
    return bu


def region(c, n, bone):
    x, y, z = c
    if bone.startswith('tail_'):
        return 'mask' if int(_tail_u(c) * 10) % 2 == 1 else 'fur'
    if bone.startswith(('hand_', 'fingers_', 'thumb_', 'foot_', 'toe_')) or \
            (bone.startswith(('forearm_', 'shin_')) and z < 0.035):
        return 'hands'
    if bone.startswith('ear_'):
        return 'cream' if z > 0.292 or n[1] < -0.5 else 'fur'
    if bone in ('head', 'jaw'):
        de = min(np.linalg.norm(np.array(c) - np.array(side(EYE, sx))) for sx in (1, -1))
        if de < 0.023:
            return 'cream'   # the lighter rim that makes the eyes pop
        if 0.21 < z < 0.256 and y < -0.17 and abs(x) < 0.075:
            return 'mask'
        if y < -0.226 or (z < 0.21 and y < -0.19):
            return 'cream'   # muzzle
        if 0.256 <= z < 0.27 and y < -0.19:
            return 'cream'   # brow
    return 'fur'


def E_(x, y, z):
    return Euler((math.radians(x), math.radians(y), math.radians(z))).to_quaternion()


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    cs = max(1, int(3 * q))
    out = []
    bag = cr.Piece('satchel', *_rbox((0.03, 0.09, 0.07), (0.098, 0.02, 0.12), 0.008, cs), 'satchel', bone='satchel')
    flap = cr.Piece('flap', *_rbox((0.008, 0.088, 0.04), (0.114, 0.02, 0.14), 0.0035, cs), 'satchel',
                    bone='satchel_flap')
    stud = cr.tube('stud', [(0.117, 0.02, 0.126), (0.121, 0.02, 0.126)], [0.0055, 0.0045], 'stud',
                   sides=max(8, int(16 * q)), bone='satchel_flap')
    out += [bag, flap, stud]
    # strap: bag top -> over the back -> right shoulder -> across the chest -> back into the bag front
    path = [(0.095, 0.0, 0.16), (0.05, -0.03, 0.225), (-0.02, -0.07, 0.235), (-0.065, -0.1, 0.2),
            (-0.07, -0.125, 0.155), (-0.02, -0.145, 0.135), (0.045, -0.115, 0.13), (0.085, -0.04, 0.135),
            (0.095, -0.005, 0.14)]
    strap = cr.tube('strap', [_push(p) for p in path], [0.0038] * len(path), 'satchel', sides=max(6, int(10 * q)))
    strap.field = [e for e in ELEMENTS if e.bone in ('spine_02', 'spine_03', 'neck_01', 'clavicle_r', 'upperarm_r',
                                                       'clavicle_l')]
    out.append(strap)
    return out


def _push(p):
    """Lift a strap path point just outside the body surface (field iso-surface) along the outward normal."""
    from mathutils import Vector
    P = np.array([p], dtype=float)
    for _ in range(40):
        f = sum(e.field(P)[0] for e in ELEMENTS if e.gen)
        if f < 0.55:
            break
        c = np.array([0.0, p[1], 0.15])
        d = P[0] - c
        P[0] += d / max(1e-9, np.linalg.norm(d)) * 0.002
    return tuple(P[0] + (P[0] - np.array([0.0, p[1], 0.15])) / max(1e-9, np.linalg.norm(P[0] - np.array([0.0, p[1], 0.15]))) * 0.003)


def _rbox(size, centre, r, cs):
    from kn_tools.kit import Kit
    k = Kit()
    k.rbox(size, centre, r, 'x', cseg=cs)
    me_v = np.array([v.co[:] for v in k.bm.verts])
    k.bm.verts.index_update()
    faces = [tuple(v.index for v in f.verts) for f in k.bm.faces]
    k.free()
    return me_v, cr.fix_winding(me_v, faces)


ELEMENTS = elements()

ANIM = {'kind': 'quad', 'hips': 'hips', 'spine': ['spine_01', 'spine_02', 'spine_03'], 'neck': ['neck_01', 'neck_02'],
        'head': 'head', 'jaw': 'jaw', 'eye_l': 'eye_l', 'eye_r': 'eye_r',
        'ears': {'l': ['ear_l'], 'r': ['ear_r']},
        'legs': {'f' + s: {'kind': 'arm', 'clav': 'clavicle_' + s, 'upper': 'upperarm_' + s, 'lower': 'forearm_' + s,
                           'foot': 'hand_' + s, 'thumb': 'thumb_' + s, 'fingers': 'fingers_' + s} for s in 'lr'}
        | {'h' + s: {'kind': 'hind', 'upper': 'thigh_' + s, 'lower': 'shin_' + s, 'foot': 'foot_' + s,
                     'toe': 'toe_' + s} for s in 'lr'},
        'tail': ['tail_%02d' % i for i in range(1, 9)]}

SP = {'hip_h': 0.17, 'tail_carry': 0.0, 'stride': 22, 'lift': 35, 'bob': 0.005, 'walk_T': 0.9, 'run_T': 0.5,
      'run_stride': 30, 'run_flex': 8, 'lie_drop': 0.085, 'sit_pitch': 55, 'sit_drop': 0.03, 'sit_thigh': 60,
      'sit_knee': 70, 'wrap': 26, 'sleep_roll': 75, 'curl': 22}


def library():
    L = an.quad_library(SP)
    sit = L['_sit']
    S, C, win, ramp = an.S, an.C, an.win, an.ramp

    def biped(c, k=1.0):
        """Stand up on the hind legs (0.40 m tall): body pitched up about the hips, legs counter-rotated."""
        c.update(hip_pitch=c.get('hip_pitch', 0) + 65 * k, hip_z=c.get('hip_z', 0) + 0.022 * k,
                 neck_pitch=c.get('neck_pitch', 0) - 42 * k, head_pitch=c.get('head_pitch', 0) - 18 * k,
                 tail_pitch=c.get('tail_pitch', 0) - 55 * k)
        for l in ('hl', 'hr'):
            c[l + '_swing'] = c.get(l + '_swing', 0) - 65 * k
        return c

    def seated(c, k=1.0):
        sit(c, 0, 1, k * 1.15)
        c['tail_pitch'] = c.get('tail_pitch', 0) - 30 * k
        c['tail_curl'] = c.get('tail_curl', 0) + 10 * k
        return c

    def pedal(t, T):    # 1 crank rev per 1.0 s at 1x; feet on opposite pedals, hands on the grips
        c = seated({})
        for l, ph in (('hl', 0.0), ('hr', 0.5)):
            c[l + '_swing'] += 22 * S(t, T, 1, ph)
            c[l + '_bend'] = c.get(l + '_bend', 0) - 25 + 30 * C(t, T, 1, ph)
        for l in ('fl', 'fr'):
            c[l + '_swing'] += 70
            c[l + '_bend'] = 25
            c[l + '_grip'] = 60
        c.update(spine_roll=4 * S(t, T, 1), head_yaw=3 * S(t, T, 1), hip_roll=3 * S(t, T, 1))
        return c

    def mount(t, T, rev=False):
        u = ramp(T - t if rev else t, 0.15, 0.85)
        c = seated({}, u)
        hop = math.sin(math.pi * u)
        c['hip_z'] = c.get('hip_z', 0) + 0.04 * hop
        for l in ('fl', 'fr'):
            c[l + '_swing'] = c.get(l + '_swing', 0) + 70 * u
            c[l + '_bend'] = 25 * u
            c[l + '_grip'] = 60 * u
        return c

    def steal_grab(t, T):   # 0.7 s reach and snatch; the item snaps to prop_r at frame 12 (0.4 s)
        reach = ramp(t, 0.05, 0.35) * (1 - ramp(t, 0.42, 0.7))
        grip = ramp(t, 0.36, 0.42)
        c = {'fr_swing': 75 * reach + 30 * grip * (1 - ramp(t, 0.55, 0.7)), 'fr_bend': 10 * reach + 60 * grip,
             'fr_grip': 80 * grip, 'neck_pitch': -10 * reach, 'head_pitch': -10 * reach, 'spine_pitch': -5 * reach,
             'hip_z': -0.01 * reach, 'ear_back_l': -15 * reach, 'ear_back_r': -15 * reach, 'hip_yaw': -6 * reach}
        return c

    def steal_carry(t, T):  # bipedal waddle hugging the item; glance back every second cycle
        c = biped({})
        for l, ph in (('hl', 0.0), ('hr', 0.5)):
            c[l + '_swing'] += 20 * S(t, T, 2, ph)
            c[l + '_bend'] = 25 * max(0.0, C(t, T, 2, ph))
        for l in ('fl', 'fr'):
            c[l + '_swing'] = 55
            c[l + '_bend'] = 85
            c[l + '_elbow_in'] = 25
            c[l + '_grip'] = 70
        glance = win(t, T * 0.62, T * 0.88, 0.1)
        c.update(hip_roll=8 * S(t, T, 2), spine_roll=-4 * S(t, T, 2), head_yaw=70 * glance, neck_yaw=20 * glance,
                 hip_z=c['hip_z'] + 0.006 * abs(S(t, T, 2)))
        return c

    def loot_admire(t, T):  # holds the item up, sparkle eyes (sk_eyes_sparkle)
        c = biped({}, 0.85)
        c['hip_z'] -= 0.02
        c['hl_bend'] = 40
        c['hr_bend'] = 40
        for l in ('fl', 'fr'):
            c[l + '_swing'] = 120 + 8 * S(t, T, 1)
            c[l + '_bend'] = 50
            c[l + '_elbow_in'] = 20
            c[l + '_grip'] = 70
        c.update(head_pitch=c['head_pitch'] + 22, head_roll=10 * S(t, T, 1), tail_wave=10, tail_freq=2 / T)
        return c

    def wash_hands(t, T):   # sitting up, rubbing the hands together
        c = seated({}, 0.9)
        rub = S(t, T, 6)
        for l, sgn in (('fl', 1), ('fr', -1)):
            c[l + '_swing'] = c.get(l + '_swing', 0) + 75
            c[l + '_bend'] = 70
            c[l + '_elbow_in'] = 28 + 8 * rub * sgn
            c[l + '_wrist'] = 10 * rub * sgn
        c.update(neck_pitch=c['neck_pitch'] - 14, head_pitch=c['head_pitch'] - 10, head_yaw=4 * S(t, T, 1))
        return c

    L.update({'pedal': (30, True, pedal), 'pedal_mount': (30, False, lambda t, T: mount(t, T)),
              'pedal_dismount': (30, False, lambda t, T: mount(t, T, rev=True)),
              'steal_grab': (21, False, steal_grab), 'steal_carry': (48, True, steal_carry),
              'loot_admire': (60, True, loot_admire), 'wash_hands': (60, True, wash_hands)})
    return L


def ragdoll():
    """The RAG__ set, kept identical to stream B's ragdoll data (packages/parts-data/src/critters.ts,
    contract 3): rows are (bone, parent, joint a, end b in engine root space, radius, kg, swing, twist).
    packages/assets/test/critters.test.ts fails if the two drift apart."""
    rag = cr.rag
    return [
    rag('hips', None, (0.0, 0.17, -0.17), (0.0, 0.17, -0.08), 0.075, 1.5, 20, 10),
    rag('spine_02', 'hips', (0.0, 0.17, -0.08), (0.0, 0.175, 0.0), 0.078, 1.0, 25, 15),
    rag('spine_03', 'spine_02', (0.0, 0.175, 0.0), (0.0, 0.18, 0.08), 0.075, 0.94, 25, 15),
    rag('head', 'spine_03', (0.0, 0.19, 0.09), (0.0, 0.21, 0.18), 0.065, 0.7, 40, 30),
    rag('upperarm_l', 'spine_03', (0.06, 0.14, 0.07), (0.06, 0.075, 0.08), 0.025, 0.15, 70, 20),
    rag('upperarm_r', 'spine_03', (-0.06, 0.14, 0.07), (-0.06, 0.075, 0.08), 0.025, 0.15, 70, 20),
    rag('forearm_l', 'upperarm_l', (0.06, 0.075, 0.08), (0.06, 0.022, 0.09), 0.02, 0.08, 70, 20),
    rag('forearm_r', 'upperarm_r', (-0.06, 0.075, 0.08), (-0.06, 0.022, 0.09), 0.02, 0.08, 70, 20),
    rag('thigh_l', 'hips', (0.06, 0.14, -0.14), (0.06, 0.075, -0.12), 0.03, 0.25, 70, 20),
    rag('thigh_r', 'hips', (-0.06, 0.14, -0.14), (-0.06, 0.075, -0.12), 0.03, 0.25, 70, 20),
    rag('shin_l', 'thigh_l', (0.06, 0.075, -0.12), (0.06, 0.024, -0.14), 0.022, 0.1, 70, 20),
    rag('shin_r', 'thigh_r', (-0.06, 0.075, -0.12), (-0.06, 0.024, -0.14), 0.022, 0.1, 70, 20),
    rag('tail_01', 'hips', (0.0, 0.18, -0.2), (0.0, 0.17, -0.32), 0.03, 0.12, 60, 30),
    rag('tail_04', 'tail_01', (0.0, 0.17, -0.32), (0.0, 0.2, -0.43), 0.028, 0.08, 60, 30),
    ]


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 5.5, 'tri_budget': 45000, 'ragdoll_impulse': 4.0,
    'skins': 'ash_grey,silver,cinnamon',
    'notes': 'Masked raccoon. Brief: docs/art/briefs/critters.md#bandit. Origin = centre of mass; root bone on '
             'the floor at part (0,0.02,-0.15). prop_r (non-deform, right palm) is the stolen-item socket. The '
             'satchel rides at x 0.098 (brief 0.07, which is inside the 0.08 m flank).',
    'masters': {'fur': 'kn_fur_bandit', 'mask': 'kn_fur_bandit_mask', 'cream': 'kn_fur_bandit_cream',
                'hands': 'kn_fur_bandit_hands', 'eye': 'kn_ceramic_graphite', 'catch': 'kn_powder_bone',
                'lid': 'kn_fur_bandit_mask', 'brow': 'kn_fur_bandit_cream', 'mouth': 'kn_ceramic_graphite',
                'nose': 'kn_fur_bandit_mask', 'whisker': 'kn_fur_bandit_cream', 'satchel': 'kn_fabric_amber',
                'stud': 'kn_brass'},
    'phys': {'friction': 0.85, 'restitution': 0.1},
    'col': {'r': 0.08, 'length': 0.42, 'centre': (0, -0.02, 0.15)},
    'bones': bones(), 'elements': ELEMENTS, 'region': region, 'accessories': accessories, 'mb_res': 0.0035,
    'face': {'eye': EYE, 'eye_r': 0.013, 'eye_fwd': (0.3, -1, 0.05),
             'brow': (0.0, 0.004, 0.0175), 'brow_semi': (0.012, 0.0045, 0.0038), 'brow_rest_tilt': 6,
             'mouth': (0, -0.243, 0.191), 'mouth_semi': (0.01, 0.0035, 0.0025), 'mouth_bone': 'jaw',
             'nose': (0, -0.251, 0.207), 'nose_semi': (0.0095, 0.007, 0.0068),
             'whiskers': {'base': (0.016, -0.243, 0.204), 'set': [(0.004, 12), (0.0, 0), (-0.004, -12)],
                          'len': 0.04, 'r': 0.0007}},
    'extra_keys': ('sk_grin_sly', 'sk_whiskers_fwd', 'sk_eyes_sparkle'),
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.205, 0.235), (0, -1, 0), 'head'),
                 ('voice', 'mouth', (0, -0.235, 0.205), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, -0.12, 0.42), (0, 0, 1), 'head'),
                 ('step', 'paw_fl', (0.06, -0.12, 0.0), (0, 0, -1), 'hand_l'),
                 ('step', 'paw_fr', (-0.06, -0.12, 0.0), (0, 0, -1), 'hand_r'),
                 ('step', 'paw_hl', (0.06, 0.105, 0.0), (0, 0, -1), 'foot_l'),
                 ('step', 'paw_hr', (-0.06, 0.105, 0.0), (0, 0, -1), 'foot_r')],
    'anim': ANIM,
    'role_clips': ('pedal', 'pedal_mount', 'pedal_dismount', 'steal_grab', 'steal_carry', 'loot_admire',
                   'wash_hands'),
}


def main(out_path=None):
    c = cr.Critter(SPEC)
    c.build(library())
    return c.part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
