"""Procedurally build THE BUTTON source file (docs/art/briefs/power_signal.md, "THE BUTTON: Big red button").

Usage: blender -b --factory-startup -P tools/blender/make_the_button.py -- [out.blend]
Default output: assets/src/power/the_button.blend

The approved look-dev the_button() with the base raised to 50 mm: a graphite puck (Ø 0.10, 8 mm rounded
rim) with a flat 36 mm front facet for the PR-S signal ring, on a rubber foot ring; a steel collar torus
(R 0.041, r 0.006) hugged by the kn_led ring (R 0.0475); and the candy-gloss Ignition dome (r 0.038 squashed
to 0.55, centre z 0.063) under PIVOT__cap (translation z -6 mm ... 0).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'the_button'
BASE_R, BASE_TOP, FACET_Y = 0.05, 0.05, -0.0467
FOOT_H = 0.003
DOME_R, DOME_SQ, DOME_Z = 0.038, 0.55, 0.063
GRAPHITE, STEEL, LED, RUBBER, DOME = ('kn_powder_graphite', 'kn_steel_brushed', 'kn_led', 'kn_rubber',
                                      'kn_powder_ignition_gloss')
MASTERS = [GRAPHITE, STEEL, LED, RUBBER, DOME]


def build(lod, q):
    base = Kit()
    n = seg(56, q, 8)
    bseg = (3, 2, 1, 1)[lod]
    base.prism(kit.outline_circle_flat(BASE_R, n, FACET_Y), FOOT_H, BASE_TOP, GRAPHITE,
               bt=(0.008, 0.008, 0.006, 0.0)[lod], bb=(0.0015, 0.001, 0.0, 0.0)[lod], bseg=bseg)
    if lod < 3:  # foot ring: 4 wide x 3 high skirt (shared_kit §3 FOOT_RING), removed at LOD3
        fs = seg(40, q, 8)
        prof = [(0.040, FOOT_H + 0.0006), (0.040, 0.0008), (0.0408, 0.0), (0.0432, 0.0), (0.044, 0.0008),
                (0.044, FOOT_H + 0.0006)]
        base.lathe([(r, z, RUBBER) for r, z in prof], fs, closed=True)
    base.torus(0.041, 0.006, STEEL, seg(44, q, 6), (7, 6, 5, 4)[lod], m=kit.at(0, 0, 0.055))
    base.torus(0.0475, 0.0022, LED, seg(44, q, 6), (4, 4, 3, 3)[lod], m=kit.at(0, 0, 0.0545))
    cap = Kit(pivot='PIVOT__cap')
    cap.sphere(DOME_R, DOME, seg(44, q, 6), seg(16, q, 4, 2), m=kit.at(0, 0, DOME_Z), sz_top=DOME_SQ,
               sz_bot=DOME_SQ)
    # Name plate on the base back, wrapped round the puck (bone ink on graphite).
    decals = [kit.decal_cylinder('name.the_button.bone', (0, 0, 0.026), (0, 0, 1), BASE_R, (0, 1, 0), 0.05, nu=10)]
    return kit.add_decals({'base': base, 'cap': cap}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,1,1', 0.6, 'bottom', 1800,
        'Big red button: look-dev the_button() with a 50 mm base. Brief: docs/art/briefs/power_signal.md'
        '#the-button. Name plate decal wrapped on the base back.',
        MASTERS, led_groups='0:collar_ring')
    part.pivot('cap', (0, 0, DOME_Z), 'z', -0.006, 0.0)
    part.build_lods(build)
    part.col_cyl('base', BASE_R, BASE_TOP, (0, 0, BASE_TOP / 2), 'z', phys='powder', restitution=0.4, friction=0.5)
    part.col_cyl('cap', DOME_R, 0.03, (0, 0, 0.065), 'z', phys='rubber', restitution=0.4, friction=0.5)
    part.port('signal', 'out', (0, FACET_Y, 0.026), (0, -1, 0), 'S', 'out', max_links=8)
    k = Kit()
    k.sphere(DOME_R + 0.002, 'x', 12, 6, m=kit.at(0, 0, DOME_Z), sz_top=DOME_SQ, sz_bot=DOME_SQ)
    pts = [tuple(v.co) for v in k.bm.verts if v.co.z >= BASE_TOP]
    k.free()
    part.sensor('trigger', 'cap', pts + [(x, y, BASE_TOP) for x, y in kit.outline_circle(DOME_R, 12)],
                threshold=0.02, cooldown=0.25)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
