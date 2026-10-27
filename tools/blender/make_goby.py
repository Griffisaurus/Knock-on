"""Procedurally build GOBY (docs/art/briefs/critters.md, "GOBY: Fantail goldfish with a flair for drama").

Usage: blender -b --factory-startup -P tools/blender/make_goby.py -- [out.blend]
Default output: assets/src/critters/goby.blend

A chubby tangerine teardrop with a gold belly, big bulging eyes (upper lids only), oversized peach fins fading to
cream at the edges (painted and opaque) and the Plasma bow on the dorsal fin's leading edge. The root sits on
the belly line under the centre of mass (also the floor contact when flopping). 28 deform bones, 4 RAG__
capsules (0.03 kg), the ART_BIBLE §8 face keys + sk_pucker / sk_gulp / sk_cheeks_puff, every required clip
(mapped to a swimmer) and the role clips swim, flop, bubble_rescue.
"""
import math
import os
import sys

import numpy as np
from mathutils import Euler, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from _critter import cap, ell  # noqa: E402

TYPE = 'goby'
COM = (0.0, -0.005, 0.020)
SPINE_Y = (-0.005, 0.0, 0.005, 0.010, 0.014, 0.018, 0.022)


def side(p, sx):
    return (p[0] * sx, p[1], p[2])


def bones():
    B = [('root', (0, 0, 0), (0, 0, 0.01), None)]
    for i in range(6):
        B.append(('spine_%02d' % (i + 1), (0, SPINE_Y[i], 0.02), (0, SPINE_Y[i + 1], 0.02),
                  'root' if i == 0 else 'spine_%02d' % i))
    B += [('head', (0, -0.005, 0.021), (0, -0.04, 0.022), 'spine_01'),
          ('jaw', (0, -0.038, 0.014), (0, -0.046, 0.013), 'head'),
          ('dorsal_01', (0, -0.005, 0.036), (0, 0.004, 0.048), 'spine_02'),
          ('dorsal_02', (0, 0.004, 0.048), (0, 0.014, 0.053), 'dorsal_01'),
          ('anal_01', (0, 0.012, 0.007), (0, 0.02, -0.001), 'spine_04'),
          ('tail_c_01', (0, 0.022, 0.022), (0, 0.034, 0.026), 'spine_06'),
          ('tail_c_02', (0, 0.034, 0.026), (0, 0.048, 0.03), 'tail_c_01')]
    for s, sx in (('l', 1), ('r', -1)):
        B += [('eye_' + s, side((0.0105, -0.036, 0.03), sx), side((0.016, -0.042, 0.03), sx), 'head'),
              ('gill_' + s, side((0.012, -0.022, 0.018), sx), side((0.014, -0.016, 0.018), sx), 'head'),
              ('pectoral_%s_01' % s, side((0.012, -0.018, 0.01), sx), side((0.02, -0.012, 0.006), sx), 'spine_01'),
              ('pectoral_%s_02' % s, side((0.02, -0.012, 0.006), sx), side((0.026, -0.006, 0.003), sx),
               'pectoral_%s_01' % s),
              ('pelvic_' + s, side((0.006, -0.002, 0.005), sx), side((0.009, 0.006, -0.003), sx), 'spine_02'),
              ('tail_%s_01' % s, side((0.002, 0.022, 0.02), sx), side((0.01, 0.033, 0.021), sx), 'spine_06'),
              ('tail_%s_02' % s, side((0.01, 0.033, 0.021), sx), side((0.019, 0.046, 0.022), sx), 'tail_%s_01' % s)]
    return B


def elements():
    E = [ell('spine_01', (0, -0.012, 0.02), (0.0145, 0.022, 0.0175)),
         ell('head', (0, -0.03, 0.021), (0.0135, 0.015, 0.0155)),
         ell('spine_02', (0, -0.004, 0.013), (0.013, 0.016, 0.011)),
         ell('spine_03', (0, 0.006, 0.021), (0.011, 0.012, 0.013)),
         cap('spine_04', (0, 0.008, 0.021), (0, 0.014, 0.021), 0.0075),
         cap('spine_05', (0, 0.014, 0.021), (0, 0.019, 0.021), 0.0058),
         cap('spine_06', (0, 0.019, 0.021), (0, 0.023, 0.021), 0.0048),
         ell('jaw', (0, -0.04, 0.014), (0.007, 0.006, 0.004)),
         ell('gill_l', (0.012, -0.02, 0.018), (0.004, 0.006, 0.008), gen=False),
         ell('gill_r', (-0.012, -0.02, 0.018), (0.004, 0.006, 0.008), gen=False)]
    return E


def region(c, n, bone):
    if n[2] < -0.25 or c[2] < 0.011:
        return 'belly'
    return 'body'


def fin(name, centre, semi, rot, bones_field, q, edge_axis=1, edge_from=0.45, base=None):
    """A thin closed fin sheet (flattened ellipsoid) with field weights; faces far from the base get the edge
    master (the peach -> cream fade, painted and opaque)."""
    segs, rings = max(10, int(28 * q)), max(6, int(14 * q))
    pc = cr.ellipsoid(name, centre, semi, 'fin', segs=segs, rings=rings, rot=rot, field=bones_field)
    b = np.array(base if base is not None else centre)
    reach = max(semi) * 2
    fm = []
    for f in pc.faces:
        c = pc.verts[list(f)].mean(0)
        fm.append('fin_edge' if np.linalg.norm(c - b) > edge_from * reach else 'fin')
    pc.fmats = fm
    return pc


def E_(x, y, z):
    return Euler((math.radians(x), math.radians(y), math.radians(z))).to_quaternion()


def accessories(lod):
    q = (1.0, 0.75, 0.5, 0.3)[lod]
    T = 0.0011   # fin half-thickness (2.2 mm sheets)
    out = [
        # dorsal sail, leading edge at y -0.006
        fin('dorsal', (0, 0.004, 0.044), (T, 0.012, 0.0105), E_(-25, 0, 0),
            [cap('dorsal_01', (0, -0.004, 0.036), (0, 0.004, 0.048), 0.008),
             cap('dorsal_02', (0, 0.004, 0.048), (0, 0.016, 0.054), 0.008),
             ell('spine_02', (0, 0.0, 0.03), (0.01, 0.01, 0.006))], q, base=(0, 0.0, 0.034)),
        fin('anal', (0, 0.016, 0.004), (T, 0.007, 0.006), E_(30, 0, 0),
            [cap('anal_01', (0, 0.012, 0.007), (0, 0.02, -0.001), 0.007)], q, base=(0, 0.012, 0.009)),
    ]
    for s, sx in (('l', 1), ('r', -1)):
        out += [
            fin('pectoral_' + s, side((0.019, -0.012, 0.007), sx), (0.0085, 0.0065, T), E_(0, -25 * sx, -35 * sx),
                [cap('pectoral_%s_01' % s, side((0.012, -0.018, 0.01), sx), side((0.02, -0.012, 0.006), sx), 0.006),
                 cap('pectoral_%s_02' % s, side((0.02, -0.012, 0.006), sx), side((0.027, -0.006, 0.003), sx), 0.006)],
                q, base=side((0.012, -0.016, 0.01), sx)),
            fin('pelvic_' + s, side((0.008, 0.002, 0.002), sx), (0.0035, 0.006, T), E_(25, -30 * sx, 0),
                [cap('pelvic_' + s, side((0.006, -0.002, 0.005), sx), side((0.009, 0.007, -0.003), sx), 0.006)],
                q, base=side((0.006, -0.002, 0.006), sx)),
            # fantail lobes: big vertical-ish sheets splayed outward
            fin('tail_' + s, side((0.0105, 0.035, 0.022), sx), (T, 0.0155, 0.0125), E_(0, 0, -38 * sx),
                [cap('tail_%s_01' % s, side((0.002, 0.022, 0.02), sx), side((0.01, 0.033, 0.021), sx), 0.009),
                 cap('tail_%s_02' % s, side((0.01, 0.033, 0.021), sx), side((0.02, 0.048, 0.022), sx), 0.009)],
                q, base=side((0.002, 0.022, 0.021), sx)),
        ]
    out.append(fin('tail_c', (0, 0.034, 0.028), (T, 0.014, 0.008), E_(-18, 0, 0),
                   [cap('tail_c_01', (0, 0.022, 0.022), (0, 0.034, 0.026), 0.008),
                    cap('tail_c_02', (0, 0.034, 0.026), (0, 0.049, 0.031), 0.008)], q, base=(0, 0.022, 0.024)))
    # Plasma bow on the dorsal leading edge (on dorsal_02)
    bs = max(6, int(12 * q))
    for sx in (1, -1):
        out.append(cr.ellipsoid('bow', (0.0036 * sx, -0.004, 0.05), (0.0036, 0.0016, 0.0026), 'bow', segs=bs,
                                rings=max(4, bs // 2), rot=E_(0, 20 * sx, 0), bone='dorsal_02'))
    out.append(cr.ellipsoid('bow_knot', (0, -0.004, 0.05), (0.0017, 0.0019, 0.0019), 'bow', segs=bs,
                            rings=max(4, bs // 2), bone='dorsal_02'))
    return out


def cheeks_puff(P, N):
    out = P.copy()
    for sx in (1, -1):
        c = np.array([0.011 * sx, -0.03, 0.018])
        d = P - c
        w = np.exp(-(d ** 2).sum(1) / 0.008 ** 2)[:, None]
        out += d * 0.45 * w
    return out


ANIM = {'kind': 'fish', 'body': 'spine_01', 'spine': ['spine_%02d' % i for i in range(2, 7)], 'head': 'head',
        'jaw': 'jaw', 'eyes': {'l': 'eye_l', 'r': 'eye_r'}, 'gills': {'l': 'gill_l', 'r': 'gill_r'},
        'pect': {'l': ['pectoral_l_01', 'pectoral_l_02'], 'r': ['pectoral_r_01', 'pectoral_r_02']},
        'pelvic': {'l': 'pelvic_l', 'r': 'pelvic_r'}, 'dorsal': ['dorsal_01', 'dorsal_02'], 'anal': ['anal_01'],
        'tail': {'l': ['tail_l_01', 'tail_l_02'], 'c': ['tail_c_01', 'tail_c_02'], 'r': ['tail_r_01', 'tail_r_02']}}


def ragdoll():
    """The RAG__ set, kept identical to stream B's ragdoll data (packages/parts-data/src/critters.ts,
    contract 3): rows are (bone, parent, joint a, end b in engine root space, radius, kg, swing, twist).
    packages/assets/test/critters.test.ts fails if the two drift apart."""
    rag = cr.rag
    return [
    rag('spine_02', None, (0.0, 0.02, 0.004), (0.0, 0.02, 0.018), 0.016, 0.009, 30, 10),
    rag('head', 'spine_02', (0.0, 0.02, 0.018), (0.0, 0.021, 0.034), 0.013, 0.009, 30, 10),
    rag('spine_04', 'spine_02', (0.0, 0.02, 0.004), (0.0, 0.02, -0.012), 0.013, 0.008, 30, 10),
    rag('tail_c_01', 'spine_04', (0.0, 0.02, -0.012), (0.0, 0.021, -0.03), 0.007, 0.004, 30, 10),
    ]


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 0.03, 'tri_budget': 25000, 'ragdoll_impulse': 0.1,
    'skins': 'tangerine,calico,ghost,black_moor',
    'notes': 'Fantail goldfish. Brief: docs/art/briefs/critters.md#goby. Origin = centre of mass; root bone on '
             'the belly line at part (0,0.005,-0.02). Fins are closed 2.2 mm sheets (painted, opaque); the '
             'peach -> cream fade is two flat masters (kn_fur_goby_fin / _fin_edge) until the texture bake.',
    'masters': {'body': 'kn_fur_goby', 'belly': 'kn_fur_goby_belly', 'fin': 'kn_fur_goby_fin',
                'fin_edge': 'kn_fur_goby_fin_edge', 'eye': 'kn_ceramic_graphite', 'catch': 'kn_powder_bone',
                'lid': 'kn_fur_goby', 'brow': 'kn_fur_goby', 'mouth': 'kn_ceramic_graphite',
                'bow': 'kn_fabric_plasma'},
    'phys': {'restitution': 0.3},
    'col': {'r': 0.016, 'length': 0.07, 'centre': (0, -0.005, 0.02)},
    'bones': bones(), 'elements': elements(), 'region': region, 'accessories': accessories, 'mb_res': 0.0006,
    'face': {'eye': (0.0115, -0.037, 0.029), 'eye_r': 0.0055, 'eye_fwd': (1.0, -0.55, 0.1), 'upper_lids_only': True,
             'brow': (-0.001, 0.0, 0.0062), 'brow_semi': (0.0042, 0.0016, 0.0012), 'brow_rest_tilt': 4,
             'mouth': (0, -0.0455, 0.0165), 'mouth_semi': (0.0028, 0.0016, 0.0021), 'mouth_bone': 'jaw'},
    'extra_keys': ('sk_pucker', 'sk_gulp', 'sk_cheeks_puff'),
    'body_keys': {'sk_cheeks_puff': cheeks_puff},
    'ragdoll': ragdoll(),
    'emitters': [('look', 'eyes', (0, -0.040, 0.030), (0, -1, 0), 'head'),
                 ('voice', 'mouth', (0, -0.048, 0.022), (0, -1, 0), 'jaw'),
                 ('emote', 'bubble', (0, 0.0, 0.11), (0, 0, 1), 'spine_01'),
                 ('bubbles', 'mouth', (0, -0.048, 0.022), (0, 0, 1), 'jaw'),
                 ('bubble', 'body', (0, -0.005, 0.020), (0, 0, 1), 'spine_01'),
                 ('splash', 'body', (0, -0.005, 0.020), (0, 0, 1), 'spine_01')],
    'anim': ANIM,
    'role_clips': ('swim', 'flop', 'bubble_rescue'),
}


def main(out_path=None):
    c = cr.Critter(SPEC)
    c.build(an.fish_library({'side_drop': -0.005}))
    return c.part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
