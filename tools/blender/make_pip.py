"""Procedurally build PIP (docs/art/briefs/critters.md, "PIP: Striped dwarf hamster athlete").

Usage: blender -b --factory-startup -P tools/blender/make_pip.py -- [out.blend]
Default output: assets/src/critters/pip.blend

A round biscuit bean with an espresso dorsal stripe, cream belly / cheeks / muzzle, pink ear insides, paws and
nose, big round ears and the Beam sweatband (with its knot on `band_knot`). 29 deform bones, 7 RAG__ capsules
(0.12 kg), the ART_BIBLE §8 face keys + sk_cheeks_full / sk_nose_twitch / sk_whiskers_fwd, every required clip
and the role clips wheel_run, wheel_sprint, wheel_exit, stuff_cheeks, burrow_enter, burrow_exit.
"""
import math
import os
import sys

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from _critter import cap, ell  # noqa: E402

TYPE = 'pip'
COM = (0.0, 0.0, 0.035)


def side(p, sx):
    return (p[0] * sx, p[1], p[2])


def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.02), None),
         ('hips', (0, 0.02, 0.035), (0, 0.045, 0.035), 'root'),
         ('spine_01', (0, 0.02, 0.035), (0, 0.0, 0.038), 'hips'),
         ('spine_02', (0, 0.0, 0.038), (0, -0.018, 0.042), 'spine_01'),
         ('spine_03', (0, -0.018, 0.042), (0, -0.03, 0.046), 'spine_02'),
         ('neck', (0, -0.03, 0.046), (0, -0.036, 0.05), 'spine_03'),
         ('head', (0, -0.036, 0.05), (0, -0.038, 0.075), 'neck'),
         ('jaw', (0, -0.045, 0.04), (0, -0.06, 0.037), 'head'),
         ('band_knot', (0, -0.012, 0.066), (0, 0.002, 0.062), 'head'),
         ('tail_01', (0, 0.05, 0.025), (0, 0.055, 0.024), 'hips'),
         ('tail_02', (0, 0.055, 0.024), (0, 0.059, 0.022), 'tail_01')]
    for s, sx in (('l', 1), ('r', -1)):
        B += [('eye_' + s, side((0.016, -0.046, 0.055), sx), side((0.016, -0.056, 0.055), sx), 'head'),
              ('ear_' + s, side((0.02, -0.03, 0.07), sx), side((0.024, -0.03, 0.083), sx), 'head'),
              ('cheek_' + s, side((0.016, -0.045, 0.037), sx), side((0.022, -0.045, 0.037), sx), 'head'),
              ('upperarm_' + s, side((0.018, -0.02, 0.025), sx), side((0.019, -0.026, 0.012), sx), 'spine_03'),
              ('forearm_' + s, side((0.019, -0.026, 0.012), sx), side((0.019, -0.028, 0.004), sx), 'upperarm_' + s),
              ('paw_' + s, side((0.019, -0.028, 0.004), sx), side((0.019, -0.036, 0.002), sx), 'forearm_' + s),
              ('thigh_' + s, side((0.02, 0.03, 0.028), sx), side((0.022, 0.024, 0.013), sx), 'hips'),
              ('shin_' + s, side((0.022, 0.024, 0.013), sx), side((0.022, 0.032, 0.005), sx), 'thigh_' + s),
              ('foot_' + s, side((0.022, 0.032, 0.005), sx), side((0.022, 0.022, 0.002), sx), 'shin_' + s)]
    return B


def elements():
    E = [ell('spine_01', (0, 0.012, 0.036), (0.0375, 0.04, 0.03)),
         ell('hips', (0, 0.03, 0.034), (0.034, 0.025, 0.026)),
         ell('spine_02', (0, -0.012, 0.038), (0.034, 0.025, 0.028)),
         ell('spine_03', (0, -0.024, 0.042), (0.03, 0.02, 0.026), gen=False),
         ell('neck', (0, -0.032, 0.046), (0.028, 0.012, 0.024), gen=False),
         ell('head', (0, -0.035, 0.05), (0.031, 0.021, 0.025)),
         ell('head', (0, -0.056, 0.043), (0.013, 0.011, 0.011)),
         ell('jaw', (0, -0.052, 0.036), (0.01, 0.009, 0.006)),
         cap('tail_01', (0, 0.05, 0.025), (0, 0.056, 0.024), 0.004),
         cap('tail_02', (0, 0.056, 0.024), (0, 0.06, 0.022), 0.003),
         cap('band_knot', (0, -0.012, 0.066), (0, 0.0, 0.064), 0.004, gen=False)]
    for s, sx in (('l', 1), ('r', -1)):
        E += [ell('cheek_' + s, side((0.017, -0.044, 0.037), sx), (0.014, 0.013, 0.012)),
              ell('ear_' + s, side((0.021, -0.029, 0.077), sx), (0.009, 0.003, 0.009), rot=(0, 15 * sx, 0)),
              cap('upperarm_' + s, side((0.018, -0.02, 0.022), sx), side((0.019, -0.026, 0.01), sx), 0.006),
              cap('forearm_' + s, side((0.019, -0.026, 0.01), sx), side((0.019, -0.028, 0.004), sx), 0.005),
              ell('paw_' + s, side((0.019, -0.032, 0.003), sx), (0.005, 0.006, 0.003)),
              ell('thigh_' + s, side((0.022, 0.028, 0.022), sx), (0.01, 0.012, 0.012)),
              cap('shin_' + s, side((0.022, 0.026, 0.012), sx), side((0.022, 0.03, 0.005), sx), 0.005),
              ell('foot_' + s, side((0.022, 0.025, 0.003), sx), (0.005, 0.008, 0.003))]
    return E


def region(c, n, bone):
    x, y, z = c
    if bone.startswith('ear_'):
        return 'pink' if (n[1] < -0.35) else 'fur'
    if bone.startswith(('paw_', 'foot_')) or (bone.startswith(('forearm_', 'shin_')) and z < 0.006):
        return 'pink'
    if abs(x) < 0.0042 and n[2] > 0.2 and y > -0.05 and z > 0.04:
        return 'stripe'
    if bone.startswith('cheek_') or (bone in ('head', 'jaw') and y < -0.05 and z < 0.05):
        return 'cream'
    if n[2] < -0.3 and z < 0.03:
        return 'cream'
    return 'fur'


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    out = [cr.torus('band', (0, -0.038, 0.062), (0, 0.32, 0.95), (0.0275, 0.0245), 0.0016, 'band',
                    maj=max(16, int(48 * q)), mn=max(4, int(8 * q)), bone='head', squash=1.9)]
    knot = cr.ellipsoid('knot', (0, -0.012, 0.066), (0.004, 0.003, 0.003), 'band', segs=max(6, int(10 * q)),
                        rings=max(4, int(6 * q)), bone='head')
    out.append(knot)
    for sx in (1, -1):
        tail = cr.ellipsoid('knot_tail', (0.003 * sx, -0.003, 0.063), (0.0018, 0.006, 0.0012), 'band',
                            segs=max(6, int(10 * q)), rings=max(4, int(6 * q)), rot=_euler(-20, 0, 15 * sx),
                            bone='band_knot')
        out.append(tail)
    return out


def _euler(x, y, z):
    from mathutils import Euler
    return Euler((math.radians(x), math.radians(y), math.radians(z))).to_quaternion()


def cheeks_full(P, N):
    out = P.copy()
    for sx in (1, -1):
        c = np.array([0.017 * sx, -0.044, 0.037])
        d = P - c
        w = np.exp(-(d ** 2).sum(1) / 0.013 ** 2)[:, None]
        out += d * 0.6 * w
    return out


ANIM = {'kind': 'quad', 'hips': 'hips', 'spine': ['spine_01', 'spine_02', 'spine_03'], 'neck': ['neck'],
        'head': 'head', 'jaw': 'jaw', 'eye_l': 'eye_l', 'eye_r': 'eye_r',
        'ears': {'l': ['ear_l'], 'r': ['ear_r']},
        'legs': {'f' + s: {'kind': 'front', 'upper': 'upperarm_' + s, 'lower': 'forearm_' + s, 'foot': 'paw_' + s}
                 for s in 'lr'} | {'h' + s: {'kind': 'hind', 'upper': 'thigh_' + s, 'lower': 'shin_' + s,
                                             'foot': 'foot_' + s} for s in 'lr'},
        'tail': ['tail_01', 'tail_02']}

SP = {'hip_h': 0.035, 'tail_carry': 0.0, 'stride': 30, 'lift': 40, 'bob': 0.0015, 'walk_T': 0.4, 'run_T': 0.2,
      'run_stride': 38, 'run_flex': 12, 'lie_drop': 0.006, 'sit_pitch': 40, 'sit_drop': 0.006, 'sit_thigh': 50,
      'sit_knee': 60, 'wrap': 0, 'sleep_roll': 0, 'curl': 0}


def library():
    L = an.quad_library(SP)
    sit = L['_sit']
    S, win, ramp = an.S, an.win, an.ramp

    def sleep(t, T):  # curled ball
        c = {'hip_z': -0.005, 'hip_roll': 12, 'spine_pitch': -14 + 2 * S(t, T, 1), 'spine_yaw': -10,
             'neck_pitch': -6, 'head_pitch': -10, 'head_yaw': -12, 'ear_back_l': 35, 'ear_back_r': 35,
             'scale': {'spine_02': 1.0 + 0.02 * S(t, T, 1)}}
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_bend'] = 75
            c[leg + '_swing'] = 25 if leg[0] == 'f' else -15
        return c

    def wheel(t, T, cycles, ears=0.0, head=0.0, swing=40):
        c = {}
        an.gait(c, t, T, an.GALLOP, swing, 48, cycles=cycles)
        c.update(spine_pitch=12 * S(t, T, cycles, 0.25), hip_z=0.0015 * S(t, T, cycles), hip_pitch=-6,
                 neck_pitch=head, head_pitch=4 * S(t, T, cycles, 0.5), ear_back_l=ears, ear_back_r=ears,
                 tail_pitch=-5 * S(t, T, cycles))
        return c

    def wheel_exit(t, T):  # stumble off into dizzy
        c = wheel(t, T, 2, ears=30)
        k = ramp(t, 0.25, 0.7)
        for key in [k2 for k2 in c if k2.endswith(('_swing', '_bend'))]:
            c[key] *= (1 - k)
        c.update(hip_pitch=-6 * (1 - k) - 35 * win(t, 0.3, 0.6, 0.1), hip_roll=40 * win(t, 0.4, 0.8, 0.12),
                 hip_z=0.006 * win(t, 0.3, 0.55, 0.08), head_roll=20 * k, ear_splay_l=30 * k, ear_splay_r=30 * k)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_spread'] = 15 * k
        return c

    def stuff_cheeks(t, T):  # 1.2 s, cheeks 0 -> 1 (bones scale with sk_cheeks_full)
        c = {}
        sit(c, t, T, 0.6)
        k = ramp(t, 0.1, 1.0)
        munch = max(0.0, math.sin(math.tau * 6 * t))
        c['fl_swing'] = c.get('fl_swing', 0) + 50
        c['fr_swing'] = c.get('fr_swing', 0) + 50
        c['fl_bend'] = 65
        c['fr_bend'] = 65
        c.update(jaw=8 * munch * win(t, 0.1, 1.05, 0.1), head_pitch=c['head_pitch'] - 8,
                 scale={'cheek_l': 1.0 + 0.6 * k, 'cheek_r': 1.0 + 0.6 * k}, ear_back_l=-8, ear_back_r=-8)
        return c

    def burrow_enter(t, T):
        c = {}
        dig = math.sin(math.tau * 8 * t)
        k = ramp(t, 0.0, 0.6)
        c.update(hip_pitch=-35 * k, hip_z=-0.012 * ramp(t, 0.4, T), neck_pitch=-20 * k, head_pitch=-15 * k,
                 ear_back_l=40 * k, ear_back_r=40 * k, fl_swing=40 * dig * k, fr_swing=-40 * dig * k,
                 fl_bend=40 * k, fr_bend=40 * k, hl_swing=-25 * k, hr_swing=-25 * k, tail_pitch=20 * k)
        return c

    def burrow_exit(t, T):
        c = burrow_enter(T - t, T)
        shake = win(t, 0.7, 1.0, 0.05) * math.sin(math.tau * 10 * t)
        c['head_roll'] = 15 * shake
        c['spine_roll'] = 8 * shake
        return c

    L.update({'sleep': (90, True, sleep),
              'wheel_run': (10, True, lambda t, T: wheel(t, T, 1)),
              'wheel_sprint': (180, True, lambda t, T: wheel(t, T, 36, ears=50, head=-8, swing=44)),
              'wheel_exit': (30, False, wheel_exit), 'stuff_cheeks': (36, False, stuff_cheeks),
              'burrow_enter': (30, False, burrow_enter), 'burrow_exit': (30, False, burrow_exit)})
    return L


def ragdoll():
    """The RAG__ set, kept identical to stream B's ragdoll data (packages/parts-data/src/critters.ts,
    contract 3): rows are (bone, parent, joint a, end b in engine root space, radius, kg, swing, twist).
    packages/assets/test/critters.test.ts fails if the two drift apart."""
    rag = cr.rag
    return [
    rag('hips', None, (0.0, 0.035, -0.05), (0.0, 0.035, -0.015), 0.03, 0.035, 20, 10),
    rag('spine_02', 'hips', (0.0, 0.035, -0.015), (0.0, 0.038, 0.015), 0.03, 0.035, 25, 15),
    rag('head', 'spine_02', (0.0, 0.04, 0.015), (0.0, 0.046, 0.044), 0.024, 0.03, 40, 30),
    rag('upperarm_l', 'spine_02', (0.022, 0.022, 0.018), (0.022, 0.006, 0.024), 0.0042, 0.005, 70, 20),
    rag('upperarm_r', 'spine_02', (-0.022, 0.022, 0.018), (-0.022, 0.006, 0.024), 0.0042, 0.005, 70, 20),
    rag('thigh_l', 'hips', (0.024, 0.022, -0.035), (0.024, 0.006, -0.04), 0.0045, 0.005, 70, 20),
    rag('thigh_r', 'hips', (-0.024, 0.022, -0.035), (-0.024, 0.006, -0.04), 0.0045, 0.005, 70, 20),
    ]


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 0.12, 'tri_budget': 26000, 'ragdoll_impulse': 0.3,
    'skins': 'biscuit_stripe,pearl,cinnamon',
    'notes': 'Striped dwarf hamster athlete. Brief: docs/art/briefs/critters.md#pip. Origin = centre of mass; '
             'root bone on the floor at part (0,0,-0.035). One RAG__ capsule per limb spans the whole leg. '
             'Texture-mask regions are flat kn_fur_pip_* masters until the body set is baked.',
    'masters': {'fur': 'kn_fur_pip', 'stripe': 'kn_fur_pip_stripe', 'cream': 'kn_fur_pip_cream',
                'pink': 'kn_fur_pip_pink', 'eye': 'kn_ceramic_graphite', 'catch': 'kn_powder_bone',
                'lid': 'kn_fur_pip', 'brow': 'kn_fur_pip', 'mouth': 'kn_ceramic_graphite', 'nose': 'kn_fur_pip_pink',
                'whisker': 'kn_fur_pip_cream', 'band': 'kn_fabric_beam'},
    'phys': {'friction': 0.9, 'restitution': 0.15},
    'col': {'r': 0.032, 'length': 0.11, 'centre': (0, 0, 0.034)},
    'bones': bones(), 'elements': elements(), 'region': region, 'accessories': accessories, 'mb_res': 0.0011,
    'face': {'eye': (0.0165, -0.05, 0.055), 'eye_r': 0.006, 'eye_fwd': (0.5, -1, 0.1),
             'brow': (0.0, 0.002, 0.0085), 'brow_semi': (0.005, 0.002, 0.0015), 'brow_rest_tilt': 6,
             'mouth': (0, -0.064, 0.0385), 'mouth_semi': (0.004, 0.0015, 0.001), 'mouth_bone': 'jaw',
             'nose': (0, -0.0665, 0.045), 'nose_semi': (0.0035, 0.0025, 0.0025),
             'whiskers': {'base': (0.008, -0.062, 0.042), 'set': [(0.0015, 12), (0.0, 0), (-0.0015, -12)],
                          'len': 0.022, 'r': 0.0003}},
    'extra_keys': ('sk_cheeks_full', 'sk_nose_twitch', 'sk_whiskers_fwd'),
    'body_keys': {'sk_cheeks_full': cheeks_full},
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.05, 0.055), (0, -1, 0), 'head'),
                 ('voice', 'mouth', (0, -0.064, 0.04), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, -0.02, 0.15), (0, 0, 1), 'head'),
                 ('step', 'paw_fl', (0.019, -0.033, 0.0), (0, 0, -1), 'paw_l'),
                 ('step', 'paw_fr', (-0.019, -0.033, 0.0), (0, 0, -1), 'paw_r'),
                 ('step', 'paw_hl', (0.022, 0.026, 0.0), (0, 0, -1), 'foot_l'),
                 ('step', 'paw_hr', (-0.022, 0.026, 0.0), (0, 0, -1), 'foot_r'),
                 ('crumbs', 'cheek', (0, -0.045, 0.035), (0, -1, 0), 'head')],
    'anim': ANIM,
    'role_clips': ('wheel_run', 'wheel_sprint', 'wheel_exit', 'stuff_cheeks', 'burrow_enter', 'burrow_exit'),
}


def main(out_path=None):
    c = cr.Critter(SPEC)
    c.build(library())
    return c.part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
