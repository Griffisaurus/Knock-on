"""Procedurally build MOCHI (docs/art/briefs/critters.md, "MOCHI: Dumpling-round house cat").

Usage: blender -b --factory-startup -P tools/blender/make_mochi.py -- [out.blend]
Default output: assets/src/critters/mochi.blend

A plump cream cat, ginger points (ears, paws, the last 3 tail rings), white muzzle / chin / belly / bib, a
cobalt knit collar with a round bone tag. Soft-sculpt metaball body, 44 deform bones, 15 RAG__ capsules
(4.0 kg), the ART_BIBLE §8 face keys + sk_whiskers_fwd / sk_blep / sk_fur_puff, every required clip and the
role clips pounce, arch_scared, groom, stalk, shove. Positions below are root space (floor z 0, nose -Y).
"""
import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from _critter import cap, chain_points, ell  # noqa: E402

TYPE = 'mochi'
COM = (0.0, -0.02, 0.14)

# ---------------------------------------------------------------- rig (root space)
TAIL = chain_points([(0, 0.172, 0.16), (0, 0.24, 0.2), (0, 0.28, 0.28), (0, 0.295, 0.36), (0, 0.285, 0.43)], 8)


def side(b, sx):
    return (b[0] * sx, b[1], b[2])


def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.06), None),
         ('hips', (0, 0.06, 0.15), (0, 0.12, 0.15), 'root'),
         ('spine_01', (0, 0.06, 0.15), (0, 0.0, 0.155), 'hips'),
         ('spine_02', (0, 0.0, 0.155), (0, -0.06, 0.16), 'spine_01'),
         ('spine_03', (0, -0.06, 0.16), (0, -0.11, 0.175), 'spine_02'),
         ('neck_01', (0, -0.11, 0.175), (0, -0.14, 0.205), 'spine_03'),
         ('neck_02', (0, -0.14, 0.205), (0, -0.165, 0.225), 'neck_01'),
         ('head', (0, -0.165, 0.225), (0, -0.17, 0.31), 'neck_02'),
         ('jaw', (0, -0.185, 0.215), (0, -0.235, 0.205), 'head'),
         ('collar_tag', (0, -0.188, 0.19), (0, -0.19, 0.168), 'neck_01')]
    for s, sx in (('l', 1), ('r', -1)):
        B += [('eye_' + s, side((0.03, -0.205, 0.255), sx), side((0.03, -0.235, 0.255), sx), 'head'),
              ('ear_%s_01' % s, side((0.04, -0.165, 0.305), sx), side((0.046, -0.168, 0.335), sx), 'head'),
              ('ear_%s_02' % s, side((0.046, -0.168, 0.335), sx), side((0.05, -0.17, 0.362), sx), 'ear_%s_01' % s),
              ('scapula_' + s, side((0.035, -0.075, 0.175), sx), side((0.045, -0.085, 0.115), sx), 'spine_03'),
              ('upperarm_' + s, side((0.045, -0.085, 0.115), sx), side((0.045, -0.09, 0.065), sx), 'scapula_' + s),
              ('forearm_' + s, side((0.045, -0.09, 0.065), sx), side((0.045, -0.095, 0.022), sx), 'upperarm_' + s),
              ('paw_' + s, side((0.045, -0.095, 0.022), sx), side((0.045, -0.112, 0.01), sx), 'forearm_' + s),
              ('toe_' + s, side((0.045, -0.112, 0.01), sx), side((0.045, -0.13, 0.007), sx), 'paw_' + s),
              ('thigh_' + s, side((0.045, 0.09, 0.15), sx), side((0.05, 0.07, 0.085), sx), 'hips'),
              ('shin_' + s, side((0.05, 0.07, 0.085), sx), side((0.05, 0.115, 0.045), sx), 'thigh_' + s),
              ('hock_' + s, side((0.05, 0.115, 0.045), sx), side((0.05, 0.115, 0.014), sx), 'shin_' + s),
              ('hindpaw_' + s, side((0.05, 0.115, 0.014), sx), side((0.05, 0.095, 0.008), sx), 'hock_' + s),
              ('hindtoe_' + s, side((0.05, 0.095, 0.008), sx), side((0.05, 0.075, 0.006), sx), 'hindpaw_' + s)]
    for i in range(8):
        B.append(('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], 'hips' if i == 0 else 'tail_%02d' % i))
    return B


def elements():
    E = [ell('head', (0, -0.17, 0.262), (0.066, 0.058, 0.064)),
         ell('head', (0, -0.222, 0.228), (0.028, 0.022, 0.02)),
         ell('jaw', (0, -0.212, 0.206), (0.02, 0.018, 0.012)),
         ell('neck_01', (0, -0.125, 0.198), (0.05, 0.045, 0.055)),
         ell('neck_02', (0, -0.15, 0.218), (0.045, 0.04, 0.045)),
         ell('spine_03', (0, -0.085, 0.15), (0.078, 0.07, 0.08)),
         ell('spine_02', (0, -0.02, 0.148), (0.08, 0.08, 0.083)),
         ell('spine_01', (0, 0.05, 0.148), (0.08, 0.07, 0.082)),
         ell('hips', (0, 0.11, 0.148), (0.076, 0.07, 0.078))]
    for s, sx in (('l', 1), ('r', -1)):
        E += [ell('head', side((0.042, -0.178, 0.232), sx), (0.034, 0.034, 0.03)),
              ell('ear_%s_01' % s, side((0.042, -0.166, 0.318), sx), (0.022, 0.008, 0.022), rot=(0, 18 * sx, 0)),
              ell('ear_%s_02' % s, side((0.048, -0.168, 0.345), sx), (0.013, 0.006, 0.016), rot=(0, 18 * sx, 0)),
              cap('scapula_' + s, side((0.035, -0.075, 0.17), sx), side((0.045, -0.085, 0.12), sx), 0.03, gen=False),
              cap('upperarm_' + s, side((0.045, -0.088, 0.108), sx), side((0.045, -0.09, 0.062), sx), 0.022),
              cap('forearm_' + s, side((0.045, -0.09, 0.062), sx), side((0.045, -0.096, 0.02), sx), 0.018),
              ell('paw_' + s, side((0.045, -0.106, 0.012), sx), (0.02, 0.026, 0.012)),
              cap('toe_' + s, side((0.045, -0.118, 0.01), sx), side((0.045, -0.128, 0.008), sx), 0.008, gen=False),
              ell('thigh_' + s, side((0.045, 0.1, 0.11), sx), (0.035, 0.05, 0.055)),
              cap('shin_' + s, side((0.05, 0.085, 0.08), sx), side((0.05, 0.115, 0.045), sx), 0.018),
              cap('hock_' + s, side((0.05, 0.115, 0.045), sx), side((0.05, 0.112, 0.016), sx), 0.016),
              ell('hindpaw_' + s, side((0.05, 0.1, 0.012), sx), (0.02, 0.03, 0.012)),
              cap('hindtoe_' + s, side((0.05, 0.088, 0.009), sx), side((0.05, 0.078, 0.007), sx), 0.008, gen=False)]
    for i in range(8):
        r = 0.0175 - 0.0045 * i / 7
        E.append(cap('tail_%02d' % (i + 1), TAIL[i][:], TAIL[i + 1][:], r))
    E.append(cap('collar_tag', (0, -0.188, 0.19), (0, -0.19, 0.17), 0.004, gen=False))
    return E


def region(c, n, bone):
    x, y, z = c
    if bone.startswith('ear_') and z > 0.322:
        return 'points'
    if bone.startswith(('paw_', 'toe_', 'hindpaw_', 'hindtoe_')) or (bone.startswith(('forearm_', 'hock_')) and z < 0.03):
        return 'rose' if (n[2] < -0.6 and z < 0.011) else 'points'
    if bone in ('tail_06', 'tail_07', 'tail_08'):
        return 'points'
    if bone in ('head', 'jaw') and y < -0.205 and z < 0.243:
        return 'white'
    if bone.startswith(('spine', 'hips')) and z < 0.1 and n[2] < -0.2:
        return 'white'
    if bone in ('neck_01', 'neck_02', 'spine_03') and n[1] < -0.55 and z < 0.215:
        return 'white'
    return 'fur'


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    out = [cr.torus('collar', (0, -0.142, 0.198), (0, -0.62, 0.78), 0.049, 0.006, 'collar', maj=max(12, int(40 * q)),
                    mn=max(4, int(8 * q)), bone='neck_01', squash=1.0),
           cr.tube('tag', [(0, -0.1825, 0.18), (0, -0.1865, 0.18)], [0.011, 0.011], 'tag', sides=max(8, int(20 * q)),
                   bone='collar_tag', up=(0, 0, 1))]
    return out


def fur_puff(P, N):
    return P + N * 0.006


ANIM = {'kind': 'quad', 'hips': 'hips', 'spine': ['spine_01', 'spine_02', 'spine_03'], 'neck': ['neck_01', 'neck_02'],
        'head': 'head', 'jaw': 'jaw', 'eye_l': 'eye_l', 'eye_r': 'eye_r',
        'ears': {'l': ['ear_l_01', 'ear_l_02'], 'r': ['ear_r_01', 'ear_r_02']},
        'legs': {'f' + s: {'kind': 'front', 'clav': 'scapula_' + s, 'upper': 'upperarm_' + s, 'lower': 'forearm_' + s,
                           'foot': 'paw_' + s, 'toe': 'toe_' + s} for s in 'lr'}
        | {'h' + s: {'kind': 'hind', 'upper': 'thigh_' + s, 'lower': 'shin_' + s, 'foot': 'hock_' + s,
                     'paw': 'hindpaw_' + s, 'toe': 'hindtoe_' + s} for s in 'lr'},
        'tail': ['tail_%02d' % i for i in range(1, 9)]}

SP = {'hip_h': 0.15, 'tail_carry': 0.0, 'stride': 22, 'lift': 35, 'bob': 0.004, 'walk_T': 1.0, 'run_T': 0.5,
      'run_stride': 32, 'run_flex': 10, 'lie_drop': 0.07, 'sit_pitch': 32, 'sit_drop': 0.035, 'sit_thigh': 55,
      'sit_knee': 70, 'wrap': 24, 'sleep_roll': 80, 'curl': 22}


def library():
    L = an.quad_library(SP)
    sit = L['_sit']
    S, C, win, ramp = an.S, an.C, an.win, an.ramp

    def pounce(t, T):   # 1.1 s: 0.4 s butt-wiggle wind-up, then the leap (the engine moves the body)
        c = {}
        wind = an.win(t, 0.0, 0.4, 0.06)
        leap = an.win(t, 0.42, 0.75, 0.06)
        land = an.win(t, 0.75, 0.95, 0.05)
        c.update(hip_z=-0.045 * wind - 0.02 * land, hip_pitch=-8 * wind + 12 * leap - 6 * land,
                 hip_yaw=8 * math.sin(math.tau * 5 * t) * wind, neck_pitch=-10 * wind, head_pitch=10 * wind,
                 ear_back_l=-15 * wind, ear_back_r=-15 * wind, tail_pitch=-25 * wind - 30 * leap,
                 tail_tip=20 * math.sin(math.tau * 6 * t) * wind, tail_bend=-2 * leap)
        for l in ('fl', 'fr'):
            c[l + '_swing'] = -10 * wind + 70 * leap + 15 * land
            c[l + '_bend'] = 30 * wind + 10 * leap + 35 * land
        for l in ('hl', 'hr'):
            c[l + '_swing'] = 25 * wind - 60 * leap
            c[l + '_bend'] = 60 * wind + 5 * leap + 30 * land
        return c

    def arch_scared(t, T):  # 0.8 s sideways hop, arched back, bottle-brush tail (sk_fur_puff is the face/body key)
        c = {}
        a = an.win(t, 0.05, 0.7, 0.1)
        hop = math.sin(math.pi * an.ramp(t, 0.1, 0.55))
        c.update(hip_z=0.03 * a + 0.04 * hop, hip_roll=10 * hop, hip_pitch=-10 * a, spine_pitch_0=22 * a,
                 spine_pitch_1=4 * a, spine_pitch_2=-18 * a, neck_pitch=-12 * a, head_pitch=6 * a,
                 ear_back_l=55 * a, ear_back_r=55 * a, ear_splay_l=30 * a, ear_splay_r=30 * a,
                 tail_pitch=55 * a, tail_bend=-3 * a, tail_puff=1.0 + 0.45 * a, jaw=10 * a)
        for l in ('fl', 'fr', 'hl', 'hr'):
            c[l + '_spread'] = 10 * a
            c[l + '_swing'] = (8 if l[0] == 'f' else -8) * a
        return c

    def groom(t, T):     # 3 s loop: paw lick, then a face wipe
        c = {}
        sit(c, t, T, 1.0)
        lick = 0.5 + 0.5 * math.cos(math.tau * t / T)
        wipe = 1 - lick
        c['fl_swing'] = c.get('fl_swing', 0) + 85 + 25 * wipe * math.sin(math.tau * 3 * t / T)
        c['fl_bend'] = 95 - 20 * wipe
        c.update(head_pitch=c['head_pitch'] - 18 * lick + 10 * wipe, head_yaw=12 * lick, head_roll=-10 * wipe,
                 jaw=6 * lick * max(0.0, math.sin(math.tau * 8 * t / T)), tail_curl=10, tail_pitch=-15,
                 ear_back_l=8 * wipe, ear_back_r=-5)
        return c

    def stalk(t, T):     # low crouch-walk loop
        c = {}
        an.gait(c, t, T, an.WALK, 16, 28, base_bend=22)
        c.update(hip_z=-0.04, neck_pitch=-14, head_pitch=14, ear_back_l=-12, ear_back_r=-12, tail_pitch=-28,
                 tail_bend=1, tail_tip=15 * S(t, T, 2), spine_yaw=2 * S(t, T, 1))
        return c

    def shove(t, T):     # additive 0.5 s paw swipe (front right) over `walk`
        k = math.sin(math.pi * an.ramp(t, 0.0, T))
        return {'fr_swing': 55 * k, 'fr_bend': 25 * k, 'fr_spread': -8 * k, 'head_yaw': -6 * k}

    L.update({'pounce': (33, False, pounce), 'arch_scared': (24, False, arch_scared), 'groom': (90, True, groom),
              'stalk': (48, True, stalk), 'shove': (15, False, shove)})
    return L


def ragdoll():
    """The RAG__ set, kept identical to stream B's ragdoll data (packages/parts-data/src/critters.ts,
    contract 3): rows are (bone, parent, joint a, end b in engine root space, radius, kg, swing, twist).
    packages/assets/test/critters.test.ts fails if the two drift apart."""
    rag = cr.rag
    return [
    rag('hips', None, (0.0, 0.15, -0.16), (0.0, 0.15, -0.07), 0.07, 0.93, 20, 10),
    rag('spine_02', 'hips', (0.0, 0.15, -0.07), (0.0, 0.155, 0.01), 0.072, 0.70, 25, 15),
    rag('spine_03', 'spine_02', (0.0, 0.155, 0.01), (0.0, 0.16, 0.09), 0.07, 0.70, 25, 15),
    rag('neck_01', 'spine_03', (0.0, 0.16, 0.09), (0.0, 0.19, 0.13), 0.04, 0.15, 35, 25),
    rag('head', 'neck_01', (0.0, 0.19, 0.13), (0.0, 0.22, 0.2), 0.062, 0.50, 40, 30),
    rag('upperarm_l', 'spine_03', (0.05, 0.12, 0.08), (0.05, 0.06, 0.09), 0.022, 0.12, 70, 20),
    rag('upperarm_r', 'spine_03', (-0.05, 0.12, 0.08), (-0.05, 0.06, 0.09), 0.022, 0.12, 70, 20),
    rag('forearm_l', 'upperarm_l', (0.05, 0.06, 0.09), (0.05, 0.016, 0.1), 0.016, 0.06, 70, 10),
    rag('forearm_r', 'upperarm_r', (-0.05, 0.06, 0.09), (-0.05, 0.016, 0.1), 0.016, 0.06, 70, 10),
    rag('thigh_l', 'hips', (0.05, 0.12, -0.12), (0.05, 0.06, -0.1), 0.028, 0.20, 70, 20),
    rag('thigh_r', 'hips', (-0.05, 0.12, -0.12), (-0.05, 0.06, -0.1), 0.028, 0.20, 70, 20),
    rag('shin_l', 'thigh_l', (0.05, 0.06, -0.1), (0.05, 0.018, -0.12), 0.018, 0.08, 70, 10),
    rag('shin_r', 'thigh_r', (-0.05, 0.06, -0.1), (-0.05, 0.018, -0.12), 0.018, 0.08, 70, 10),
    rag('tail_01', 'hips', (0.0, 0.18, -0.18), (0.0, 0.27, -0.24), 0.017, 0.06, 60, 30),
    rag('tail_04', 'tail_01', (0.0, 0.27, -0.24), (0.0, 0.37, -0.25), 0.014, 0.04, 60, 30),
    ]


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 4.0, 'tri_budget': 38000, 'ragdoll_impulse': 3.0,
    'skins': 'cream_point,smoke,midnight',
    'notes': 'Dumpling-round house cat. Brief: docs/art/briefs/critters.md#mochi. Origin = centre of mass; '
             'root bone on the floor at root-space (0,0,0) = part (0,0.02,-0.14). Texture-mask regions are flat '
             'kn_fur_mochi_* masters until the 4096 body set is baked. Hind paw/toe bones are hindpaw_l/r, '
             'hindtoe_l/r (the brief names both paws paw_l/r).',
    'masters': {'fur': 'kn_fur_mochi', 'points': 'kn_fur_mochi_points', 'white': 'kn_fur_mochi_white',
                'rose': 'kn_fur_mochi_rose', 'eye': 'kn_ceramic_graphite', 'catch': 'kn_powder_bone',
                'lid': 'kn_fur_mochi', 'brow': 'kn_fur_mochi', 'mouth': 'kn_ceramic_graphite',
                'nose': 'kn_fur_mochi_rose', 'tongue': 'kn_fur_mochi_rose', 'whisker': 'kn_fur_mochi_white',
                'collar': 'kn_fabric_cobalt', 'tag': 'kn_powder_bone'},
    'phys': {'friction': 0.8, 'restitution': 0.1},
    'col': {'r': 0.075, 'length': 0.42, 'centre': (0, -0.02, 0.14)},
    'bones': bones(), 'elements': elements(), 'region': region, 'accessories': accessories, 'mb_res': 0.0035,
    'face': {'eye': (0.030, -0.212, 0.255), 'eye_r': 0.016, 'eye_fwd': (0.3, -1, 0.05),
             'brow': (0.002, 0.004, 0.021), 'brow_semi': (0.013, 0.005, 0.004), 'brow_rest_tilt': 8,
             'mouth': (0, -0.236, 0.213), 'mouth_semi': (0.011, 0.004, 0.0028), 'mouth_bone': 'jaw',
             'tongue': (0, -0.231, 0.211), 'tongue_semi': (0.006, 0.006, 0.002),
             'nose': (0, -0.248, 0.232), 'nose_semi': (0.009, 0.006, 0.006),
             'whiskers': {'base': (0.017, -0.238, 0.222), 'set': [(0.004, 10), (0.0, 0), (-0.004, -10)],
                          'len': 0.05, 'r': 0.0007}},
    'extra_keys': ('sk_whiskers_fwd', 'sk_blep', 'sk_fur_puff'),
    'body_keys': {'sk_fur_puff': fur_puff},
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.215, 0.255), (0, -1, 0), 'head'),
                 ('voice', 'mouth', (0, -0.245, 0.215), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, -0.15, 0.42), (0, 0, 1), 'head'),
                 ('step', 'paw_fl', (0.045, -0.11, 0.0), (0, 0, -1), 'paw_l'),
                 ('step', 'paw_fr', (-0.045, -0.11, 0.0), (0, 0, -1), 'paw_r'),
                 ('step', 'paw_hl', (0.05, 0.1, 0.0), (0, 0, -1), 'hindpaw_l'),
                 ('step', 'paw_hr', (-0.05, 0.1, 0.0), (0, 0, -1), 'hindpaw_r'),
                 ('shove', 'chest', (0, -0.22, 0.12), (0, -1, 0), 'spine_03')],
    'anim': ANIM,
    'role_clips': ('pounce', 'arch_scared', 'groom', 'stalk', 'shove'),
}


def main(out_path=None):
    c = cr.Critter(SPEC)
    c.build(library())
    return c.part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
