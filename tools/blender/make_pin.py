"""Procedurally build the PIN source file (docs/art/briefs/fun.md, "PINS: Bowling pin, racked in sets of 10").

Usage: blender -b --factory-startup -P tools/blender/make_pin.py -- [out.blend]
Default output: assets/src/fun/pin.blend

A toy bowling pin (0.5 x 1.5 x 0.5, free body; origin = the briefed centre of mass 0.055 above the flat Ø 20 mm
base, kn_com_explicit). One lathe of the brief's 10-ring profile plus the crown pole in kn_powder_bone (one slot):
LOD0 14 sides = 280 tris, LOD1 7 sides = 140, LOD2 5 sides on 7 rings = 70, LOD3 a 6-sided 24-tri spindle. The two
4 mm neck stripes (0.093 ... 0.097 and 0.103 ... 0.107 above the base) are the faces between existing profile rings
and carry the `tint` face-corner colour (R = 1); the instance colour comes from the Brush or rack.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'pin'
BASE = -0.055
BONE = 'kn_powder_bone'
MASTERS = [BONE]
# (height above the base, diameter)
PROFILE = [(0.000, 0.020), (0.015, 0.034), (0.045, 0.048), (0.080, 0.036), (0.093, 0.024), (0.097, 0.021),
           (0.103, 0.018), (0.107, 0.019), (0.126, 0.025), (0.142, 0.020)]
CROWN = 0.150
STRIPES = ((0.093, 0.097), (0.103, 0.107))
LODS = {0: (14, PROFILE), 1: (7, PROFILE),
        2: (5, [PROFILE[i] for i in (0, 2, 3, 5, 7, 8, 9)]),
        3: (6, [PROFILE[2], PROFILE[8]])}


def tint(c, _n, _m):
    h = c.z - BASE
    on = any(a - 1e-4 <= h <= b + 1e-4 for a, b in STRIPES)
    return (1.0, 0.0, 0.0, 1.0) if on else (0.0, 0.0, 0.0, 1.0)


def build(lod, q):
    sides, prof = LODS[lod]
    k = Kit()
    pts = [(0.0, BASE, BONE)] + [(d / 2, BASE + h, BONE) for h, d in prof] + [(0.0, BASE + CROWN, BONE)]
    if lod == 3:
        pts = [(0.0, BASE, BONE)] + [(d / 2, BASE + h, BONE) for h, d in prof] + [(0.0, BASE + CROWN, BONE)]
    k.lathe(pts, sides)
    k.colors['tint'] = tint
    return {'body': k}


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '0.5,1.5,0.5', 0.10, 'com', 290,
        'Bowling pin (free body; origin = the briefed COM 0.055 above the flat Ø 20 mm base, kn_com_explicit): one '
        'kn_powder_bone lathe of the brief profile (LOD0 14 sides = 280 tris, LOD1 140, LOD2 70, LOD3 24-tri spindle '
        'floor), one slot; neck stripes carry the `tint` attribute (instance colour from the Brush / rack; default '
        'ignition). COL__hull__0 = 6 rings x 5 sides (neck concavity filled). UV1 authored for the 1024² set (bake '
        'pending). Brief: docs/art/briefs/fun.md#pins.',
        MASTERS, skins='ignition,cobalt,plasma', pipeline={'kn_com_explicit': True})
    part.build_lods(build, lod0_q=1.0, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    pts = []
    for h, d in ((0.0, 0.020), (0.015, 0.034), (0.045, 0.048), (0.080, 0.036), (0.126, 0.025), (0.146, 0.014)):
        r = d / 2 / math.cos(math.pi / 5)
        for i in range(5):
            a = 2 * math.pi * i / 5
            pts.append((r * math.cos(a), r * math.sin(a), BASE + h))
    part.col_hull('0', pts, phys='wood', restitution=0.35, friction=0.4)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
