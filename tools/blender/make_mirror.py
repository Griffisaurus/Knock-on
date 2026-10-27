"""Procedurally build the MIRROR source file (docs/art/briefs/power_signal.md, "MIRROR / SPLITTER: Optics pair").

Usage: blender -b --factory-startup -P tools/blender/make_mirror.py -- [out.blend]
Default output: assets/src/power/mirror.blend

The tall optic of the pair (1 x 2 cells, 0.036 deep, bottom origin): a 0.1 x 0.02 x 0.185 plate on a graphite
foot sled (0.1 x 0.036 x 0.012) with two kn_rubber pad strips. The plate front (-Y) is an 8 mm kn_anod_beam frame
round a perfectly flat kn_chrome face (0.084 x 0.17, `optic = reflect`), recessed 1 mm; the back is pillowed
graphite with the name plate. SENSOR__light__face is a 3 mm slab over the face. No LEDs or screens (beams read).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit  # noqa: E402

TYPE = 'mirror'
SLED_H, SLED_D = 0.012, 0.036
PZ0, PZ1, PW, PD = SLED_H, SLED_H + 0.185, 0.10, 0.02     # plate
FACE_W, FACE_H = 0.084, 0.17
FY = -PD / 2 + 0.001                                      # chrome face plane (1 mm behind the frame front)
G, RUBBER, BEAM, CHROME = 'kn_powder_graphite', 'kn_rubber', 'kn_anod_beam', 'kn_chrome'
MASTERS = [G, RUBBER, BEAM, CHROME, 'kn_decal']
PZC = (PZ0 + PZ1) / 2


def build(lod, q, mats):
    cs = (max(1, int(round(3 * q))), 2, 1, 0)[lod]
    bev = (0.0025, 0.002, 0.0015, 0.0)[lod]
    body = Kit()
    # graphite back (y -0.004 ... +0.010)
    body.rbox((PW, 0.014, PZ1 - PZ0), (0, 0.003, PZC), bev, G, cseg=cs, rz=bev if lod < 2 else 0.0)
    # foot sled + rubber pads
    body.rbox((PW, SLED_D, SLED_H - 0.002), (0, 0, 0.002 + (SLED_H - 0.002) / 2), bev, G, cseg=cs,
              rz=bev * 0.6 if lod == 0 else 0.0)
    for y in ((-0.012, 0.012) if lod < 3 else (0.0,)):
        body.rbox((0.094, 0.008 if lod < 3 else 0.032, 0.0026), (0, y, 0.0013), 0.002 if lod < 3 else 0.0, RUBBER,
                  cseg=(2, 1, 1, 0)[lod], rz=0.0007 if lod == 0 else 0.0)
    # Beam frame: a 6 mm ring round the face window (outer = plate outline)
    frame = Kit()
    if lod < 3:
        outer = kit.outline_rrect(PW, PZ1 - PZ0, bev, cs)
        win = Kit()
        win.prism(kit.outline_rrect(FACE_W, FACE_H, 0.0015 if lod < 2 else 0.0, cs if lod < 2 else 0), -0.01, 0.01,
                  BEAM, m=kit.at(0, -PD / 2, PZC) @ kit.FRONT_OUT)
        frame.prism(outer, 0.0, 0.0065, BEAM, bt=bev * 0.6 if lod < 2 else 0.0, bseg=2 if lod == 0 else 1,
                    m=kit.at(0, -PD / 2 + 0.0065, PZC) @ kit.FRONT_OUT)
        frame = kit.boolean_diff(frame, [win], mats)
    else:
        frame.rbox((PW, 0.0065, PZ1 - PZ0), (0, -PD / 2 + 0.00325, PZC), 0.0, BEAM, cseg=0, rz=0.0)
    # chrome face: one flat quad slab (no normal map, no bevel on the face)
    face = Kit()
    face.rbox((FACE_W + 0.002, 0.003, FACE_H + 0.002), (0, FY + 0.0015, PZC), 0.0, CHROME, cseg=0, rz=0.0)
    if lod == 3:
        face.free()
        face = Kit()
        face.rbox((FACE_W, 0.001, FACE_H), (0, -PD / 2 - 0.0002, PZC), 0.0, CHROME, cseg=0, rz=0.0)
    pieces = {'body': body, 'frame': frame, 'face': face}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.mirror.bone', (0, 0.010, 0.040), (0, 1, 0), (0, 0, 1), 0.050),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,2,0.5', 0.3, 'bottom', 800,
        'Optics pair, MIRROR: 0.1 x 0.02 x 0.185 plate on a graphite foot sled with rubber pads; 8 mm kn_anod_beam '
        'frame round a perfectly flat kn_chrome face (0.084 x 0.17, optic = reflect) recessed 1 mm; pillowed graphite '
        'back with the name plate. kn_footprint d is 0.5 cells (0.036 m real depth; the brief\'s 0.2 cells is not a '
        'half-cell multiple, rule 3). UV1 authored for the shared 1024² set (bake pending). '
        'Brief: docs/art/briefs/power_signal.md#mirror--splitter.',
        MASTERS)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.0, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('plate', (PW, PD, PZ1 - PZ0), (0, 0, PZC), phys='glass', restitution=0.2, friction=0.4)
    part.col_box('foot', (PW, SLED_D, SLED_H), (0, 0, SLED_H / 2), phys='powder', restitution=0.25, friction=0.6)
    part.sensor('light', 'face', [(x * FACE_W / 2, y, PZC + z * FACE_H / 2) for x in (-1, 1) for z in (-1, 1)
                                  for y in (-PD / 2, -PD / 2 - 0.003)], optic='reflect')
    for lod in ('', '__L1', '__L2', '__L3'):
        bpy.data.objects[TYPE + '__face' + lod]['optic'] = 'reflect'
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
