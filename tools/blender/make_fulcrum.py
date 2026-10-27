"""Procedurally build the FULCRUM source file (docs/art/briefs/frame.md, "FULCRUM: Seesaw").

Usage: blender -b --factory-startup -P tools/blender/make_fulcrum.py -- [out.blend]
Default output: assets/src/frame/fulcrum.blend

The look-dev fulcrum() read: a solid Ignition triangular-prism base (0.14 wide x 0.20 deep, apex rounded round
the pin, 9 mm pillowed bevels) on 4 rubber feet, a fat brass pin (Ø 0.018) through the apex at the origin
(0.065 m above the floor), and under PIVOT__beam (axis y, -12..+12°) a steel knuckle, the oak beam
(0.56 x 0.025 x 0.10 at z 0.022) and two graphite end caps carrying the PR-S tension hooks. Rubber stop pads on
both flanks meet the beam underside at exactly +-12°.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'fulcrum'
FLOOR, FEET = -0.065, 0.004
HALF_W, DEPTH, APEX_R = 0.07, 0.20, 0.0125
BEAM = (0.56, 0.10, 0.025)   # x, y, z
BEAM_Z, CAP, CAP_X = 0.022, (0.04, 0.10, 0.04), 0.28
PIN_R, PIN_HALF = 0.009, DEPTH / 2 + 0.008
STOP_DEG, STOP_X = 12.0, 0.032
IGN, OAK, G, BRASS, STEEL, RUBBER = ('kn_powder_ignition', 'kn_wood_oak', 'kn_powder_graphite', 'kn_brass',
                                     'kn_steel_brushed', 'kn_rubber')
MASTERS = [IGN, OAK, G, BRASS, STEEL, RUBBER]
UNDER = BEAM_Z - BEAM[2] / 2    # beam underside at rest, above the pin axis


def apex_z():
    """Apex height whose rounded corner (radius APEX_R) is centred on the pin axis."""
    lo, hi = 0.0, 0.08
    base = FLOOR + FEET
    for _ in range(60):
        za = (lo + hi) / 2
        half = math.atan2(HALF_W, za - base)
        if za - APEX_R / math.sin(half) > 0:
            hi = za
        else:
            lo = za
    return (lo + hi) / 2


def tri_outline(cseg):
    """Triangle in the prism frame: local (x, y) = Blender (z, x); CCW in that plane."""
    base = FLOOR + FEET
    za = apex_z()
    corners = [(base, -HALF_W), (base, HALF_W), (za, 0.0)]
    # CCW in (z, x): check the signed area and flip if needed
    area = sum(corners[i][0] * corners[(i + 1) % 3][1] - corners[(i + 1) % 3][0] * corners[i][1] for i in range(3))
    if area < 0:
        corners.reverse()
    return kit.outline_round_poly(corners, APEX_R, cseg)


def stop_pad(kit_, side):
    """Rubber wedge on a flank whose top lies on the beam underside tilted 12° toward that side."""
    t = math.radians(STOP_DEG)
    za = apex_z()
    base = FLOOR + FEET

    def under(x):  # tilted underside: a line UNDER from the pin, sloping down toward the pad side
        return UNDER / math.cos(t) - abs(x) * math.tan(t)

    def flank(x):
        return za - (za - base) * abs(x) / HALF_W
    pts = []
    for x in (STOP_X - 0.006, STOP_X + 0.006):
        for y in (-0.035, 0.035):
            pts.append((side * x, y, under(x)))
            pts.append((side * x, y, flank(x) - 0.006))
    kit_.hull(pts, RUBBER)


def build(lod, q):
    cs = max(1, min((3, 2, 1, 1)[lod], int(round(3 * q))))
    base = Kit()
    base.prism(tri_outline(max(2, seg(10, q, 2))), -DEPTH / 2, DEPTH / 2, IGN, bt=0.009 if lod < 3 else 0.0,
               bb=0.009 if lod < 3 else 0.0, bseg=cs, m=kit.Y_AXIS)
    base.cyl(PIN_R, -PIN_HALF, PIN_HALF, BRASS, seg(24, q, 6), bev=0.002 if lod < 2 else 0.0, bseg=cs,
             m=kit.Y_AXIS)
    if lod < 3:
        for s in (-1, 1):
            stop_pad(base, s)
        for x in (-0.05, 0.05):
            for y in (-0.075, 0.075):
                base.cyl(0.007, FLOOR, FLOOR + FEET + 0.0008, RUBBER, seg(14, q, 6), bev=0.0015 if lod < 2 else 0.0,
                         bseg=1, bev_bot=0.0015 if lod < 2 else 0.0, m=kit.at(x, y, 0))
    beam = Kit(pivot='PIVOT__beam')
    beam.rbox(BEAM, (0, 0, BEAM_Z), 0.004 if lod < 3 else 0.0, OAK, cseg=cs, rz=0.004 if lod < 3 else 0.0)
    for s in (-1, 1):
        beam.rbox(CAP, (s * CAP_X, 0, BEAM_Z), 0.006 if lod < 3 else 0.0, G, cseg=cs)
    if lod < 3:  # steel knuckle: a saddle block on the beam underside wrapping the pin
        beam.cyl(0.0145, -0.032, 0.032, STEEL, seg(24, q, 6), bev=0.0015 if lod < 2 else 0.0, bseg=1,
                 m=kit.Y_AXIS)
        beam.rbox((0.029, 0.064, UNDER + 0.002), (0, 0, (UNDER + 0.002) / 2), 0.003 if lod < 2 else 0.0, STEEL,
                  cseg=max(1, cs - 1))
    # Name plate on the base's front triangle (graphite ink on Ignition).
    decals = [kit.decal_plane('name.fulcrum.graphite', (0, -DEPTH / 2, -0.042), (0, -1, 0), (0, 0, 1), 0.05)]
    return kit.add_decals({'base': base, 'beam': beam}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '6,1,2', 2.5, 'hinge', 4500,
        'Seesaw: look-dev fulcrum() read. Brief: docs/art/briefs/frame.md#fulcrum. Origin on the pin axis, '
        '0.065 m above the floor. Base 2.5 kg anchored, beam 1.0 kg (kn_arm_mass). Baked 1024 oak and the '
        'walnut skin deferred.',
        MASTERS, hints={'kn_arm_mass': 1.0})
    part.pivot('beam', (0, 0, 0), 'y', -STOP_DEG, STOP_DEG)
    part.build_lods(build, lod0_q=1.6)
    part.col_box('beam', BEAM, (0, 0, BEAM_Z), phys='wood', friction=0.55)
    for s, nm in ((-1, 'cap_l'), (1, 'cap_r')):
        part.col_box(nm, CAP, (s * CAP_X, 0, BEAM_Z), phys='powder')
    za = apex_z()
    part.col_hull('base', [(x, y, z) for y in (-DEPTH / 2, DEPTH / 2)
                           for x, z in ((-HALF_W, FLOOR), (HALF_W, FLOOR), (0.0, za))], phys='powder')
    for s, nm in ((-1, 'end_l'), (1, 'end_r')):
        part.port('tension', nm, (s * CAP_X, -0.05, BEAM_Z), (0, -1, 0), 'S', 'both', kind='hook')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
