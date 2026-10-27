"""Procedurally build the BUZZ BEACON source file (docs/art/briefs/critters.md, BUZZ notes: "Companion type
`buzz_beacon`"; GAME_SPEC §12.10 lists it with Future Tech). BUZZ (the critter) is stream E5b's; this is its dock.

Usage: blender -b --factory-startup -P tools/blender/make_buzz_beacon.py -- [out.blend]
Default output: assets/src/future/buzz_beacon.blend

A Ø 0.20 x 0.040 kn_powder_graphite landing pad (z 0.004-0.040, 6 mm pillow) on four FOOT_S bumpers, sized so Buzz's
0.14 x 0.12 skid footprint lands with margin: a kn_rubber_grip landing disc (Ø 0.150) with the Buzz glyph decal in
its centre, ringed by a kn_led pair ring (group 0, the Buzz <-> beacon pair colour, default ignition) and a
kn_anod_graphite trim. Front: a 0.036 x 0.036 flat land at y -0.100 carrying the PR-S signal `call` port
(0, -0.100, 0.022). Rear rim: the name plate. EMIT__land__pad (0, 0, 0.040) is the landing target. Device RIG
(ASSET_PIPELINE §3.9): `root` + `socket_dock` at (0, 0, 0.040) with its +X pointing -Y, so Buzz docks facing the
port side; Buzz's root binds there when docked.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
import _m5  # noqa: E402
from kn_tools import kit, template  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'buzz_beacon'
G, AGRAPH, GRIP, RUBBER, LED, STEEL = (
    'kn_powder_graphite', 'kn_anod_graphite', 'kn_rubber_grip', 'kn_rubber', 'kn_led', 'kn_steel_brushed')
MASTERS = [G, AGRAPH, GRIP, RUBBER, LED, STEEL, 'kn_decal']
R, Z0, Z1 = 0.100, 0.004, 0.040
PORT = (0.0, -0.100, 0.022)
DOCK = (0.0, 0.0, Z1)


def build(lod, q, mats):
    n = seg(72, q, 12, 4) if lod < 3 else seg(16, q, 8, 2)
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    b = 0.006 if lod < 3 else 0.0
    prof = [(0.0, Z0, G)]
    if b:
        for k in range(cs + 1):
            a = math.pi / 2 * k / cs
            prof.append((R - b + b * math.sin(a), Z0 + b - b * math.cos(a), G))
        for k in range(cs + 1):
            a = math.pi / 2 * k / cs
            prof.append((R - b + b * math.cos(a), Z1 - b + b * math.sin(a), G))
    else:
        prof += [(R, Z0, G), (R, Z1, G)]
    # top: a shallow step down to the trim and the landing disc
    prof += [(0.084, Z1, G), (0.0, Z1, G)]
    body.lathe(kit.dedupe(prof), n)
    # front land for the port ring (flat 0.036 x 0.036 at y -0.100)
    body.rbox((0.036, 0.006, 0.034), (0.0, -R + 0.003, Z0 + 0.018), 0.003 if lod < 3 else 0.0, G,
              cseg=max(1, cs - 1), rz=0.003 if lod < 3 else 0.0)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        _m2.foot(body, 'S', 0.072 * math.cos(a), 0.072 * math.sin(a), min(1.0, q), lod)
    # LED pair ring + graphite trim + rubber landing disc
    body.lathe([(0.079, Z1 - 0.002, LED), (0.0855, Z1 - 0.002, LED), (0.0855, Z1 + 0.0012, LED),
                (0.079, Z1 + 0.0012, LED)], n, closed=True)
    if lod < 3:
        body.lathe([(0.075, Z1 - 0.002, AGRAPH), (0.0792, Z1 - 0.002, AGRAPH), (0.0792, Z1 + 0.0018, AGRAPH),
                    (0.075, Z1 + 0.0018, AGRAPH)], n, closed=True)
        body.cyl(0.0752, Z1 - 0.002, Z1 + 0.0010, GRIP, n, bev=0.0008 if lod < 2 else 0.0, bseg=1, bev_bot=0.0)
    for k in range(3):  # M3 screws in the trim ring
        a = math.radians(90 + 120 * k)
        _m2.screw(body, 'M3', (0.0772 * math.cos(a), 0.0772 * math.sin(a), Z1 + 0.0018), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    pieces = {'body': body}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.marks_m5', (0, 0, Z1 + 0.0010), (0, 0, 1), (0, 1, 0), 0.070, 0.066,
                        sub=_m5.marks5('buzz')),
        kit.decal_cylinder('name.buzz_beacon.bone', (0, 0, (Z0 + Z1) / 2 + 0.001), (0, 0, 1), R, (0, 1, 0), 0.080,
                           lift=0.0004),
    ])


def socket_rig(part):
    """RIG: root at the origin, socket_dock at the pad top with its +X along -Y (Buzz faces the port side),
    +Z up. Bones are set from full matrices so the exported socket frame is exact."""
    arm = bpy.data.armatures.new('RIG')
    ob = bpy.data.objects.new('RIG', arm)
    template.get_collection('RIG').objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    root = arm.edit_bones.new('root')
    root.head, root.tail = (0, 0, 0), (0, 0, 0.03)
    dock = arm.edit_bones.new('socket_dock')
    # bone axes: X = -Y world (Buzz's forward), Y (the bone's length) = +X world, Z = +Z world
    m = Matrix(((0, 1, 0, DOCK[0]), (-1, 0, 0, DOCK[1]), (0, 0, 1, DOCK[2]), (0, 0, 0, 1)))
    dock.length = 0.03
    dock.matrix = m
    dock.length = 0.03
    dock.parent = root
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'S', '2,0.5,2', 0.4, 'bottom', 2500,
        'BUZZ BEACON (Buzz\'s dock and delivery target): Ø 0.20 x 0.040 kn_powder_graphite landing pad (z 0.004-0.040, '
        '6 mm pillow) on FOOT_S; kn_rubber_grip landing disc Ø 0.150 with the Buzz glyph, kn_led pair ring (group 0, '
        'Buzz <-> beacon pair colour, default ignition), kn_anod_graphite trim with 3 M3. Front 0.036 flat land: PR-S '
        'signal call (0, -0.100, 0.022). Rear rim name plate. EMIT__land__pad = landing target. RIG root + socket_dock '
        '(0, 0, 0.040), +X -> -Y. Footprint h 0.5 cells (real 0.040; brief 0.4). Source in future/ (not critters/): '
        'it is a device, so it takes the part validator and a texture set. '
        'Brief: docs/art/briefs/critters.md (BUZZ notes).',
        MASTERS, led_groups='0:pair_ring', skins='classic')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_cyl('pad', R, Z1, (0, 0, Z1 / 2), 'z', phys='powder', restitution=0.2, friction=0.6)
    part.port('signal', 'call', PORT, (0, -1, 0), 'S', 'in')
    part.emit('land', 'pad', DOCK, (0, 0, 1))
    socket_rig(part)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
