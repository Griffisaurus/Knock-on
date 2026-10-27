"""Procedurally build the RAM source file (docs/art/briefs/drive.md, "RAM: Pneumatic piston").

Usage: blender -b --factory-startup -P tools/blender/make_ram.py -- [out.blend]
Default output: assets/src/drive/ram.blend

Built at the D = 0.5 reference (1 x 1 x 5, stroke 0.25, origin bottom centre, retracted, fires -Y). Modules along Y:
`cap_rear` (0.05, kn_powder_ignition) + 4 x `barrel` (0.1, pillowed square kn_powder_graphite with a kn_poly_clear
window segment on both ±X faces, panel lines at the module joints) + `cap_front` (0.05 incl. head: brushed-steel
cap, 4 M5 per side on both caps). PIVOT__rod (axis y, slide -0.25 ... 0) carries the Ø 0.024 kn_chrome rod, the
steel piston seen through the windows and the fat kn_powder_ignition pusher head (Ø 0.08 x 0.025) with a
kn_rubber_grip face. Two LED_D6 on the top near the front (group 0 armed, 1 extended); PR-S power in and signal in
on the top of the rear module; name plate on the top; FOOT_M bumpers. No hoses.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'ram'
D = 0.5
STROKE = D / 2
W, TOP, FEET = 0.10, 0.10, 0.004
AXZ = 0.052                                  # rod axis height
Y0, Y1 = -D / 2, D / 2
HEAD_T, HEAD_R = 0.025, 0.04
CAPF_Y1 = Y0 + 0.05                          # front cap (incl. head) ends here
G, IGN, STEEL, CHROME, POLY, GRIP, RUBBER, LED = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed', 'kn_chrome', 'kn_poly_clear', 'kn_rubber_grip',
    'kn_rubber', 'kn_led')
MASTERS = [G, IGN, STEEL, CHROME, POLY, GRIP, RUBBER, LED, 'kn_decal']
AX = kit.at(0, 0, AXZ) @ kit.frame(axis='-y')   # local z = -Y (toward the front)


def led_group(c, _n):
    return (0, 0.08) if c.x < 0 else (1, 0.08)


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    rb = 0.006 if lod < 3 else 0.0
    zc, h = FEET + (TOP - FEET) / 2, TOP - FEET
    body = Kit()
    # barrel: 4 modules joined at panel-line grooves
    barrel = Kit()
    barrel.rbox((W, Y1 - 0.05 - CAPF_Y1 - 0.0, h), (0, (CAPF_Y1 + Y1 - 0.05) / 2, zc), rb, G, cseg=cs,
                rz=0.005 if lod < 3 else 0.0)
    if lod < 3:
        cuts = Kit()
        for i in range(4):  # window openings, one per module, both faces
            yc = CAPF_Y1 + 0.05 + 0.1 * i
            cuts.rbox((W + 0.02, 0.08, 0.040), (0, yc, AXZ), 0.004 if lod < 2 else 0.0, G, cseg=max(1, cs - 1), rz=0.0)
        if lod < 2:
            for i in range(1, 4):  # panel lines at the module joints
                y = CAPF_Y1 + 0.1 * i
                ring = Kit()
                ring.rbox((W + 0.01, 0.0016, h + 0.01), (0, y, zc), 0.0, G, cseg=0, rz=0.0)
                inner = Kit()
                inner.rbox((W - 0.0016, 0.004, h - 0.0016), (0, y, zc), 0.005, G, cseg=max(1, cs - 1), rz=0.004)
                cuts.merge(kit.boolean_diff(ring, [inner], mats))
        barrel = kit.boolean_diff(barrel, [cuts], mats)
    body.merge(barrel)
    barrel.free()
    # rear cap (Ignition) and front cap (steel)
    body.rbox((W, 0.05, h), (0, Y1 - 0.025, zc), rb, IGN, cseg=cs, rz=0.005 if lod < 3 else 0.0)
    body.rbox((W, 0.025, h), (0, CAPF_Y1 - 0.0125, zc), rb, STEEL, cseg=cs, rz=0.005 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for yc in (Y1 - 0.025, CAPF_Y1 - 0.0125):
            dy = 0.014 if yc > 0 else 0.007
            for y in (yc - dy, yc + dy):
                for z in (0.024, 0.080):
                    _m2.screw(body, 'M5', (sx * W / 2, y, z), (sx, 0, 0), min(q, 0.55), lod)
    for x in (-0.035, 0.035):
        for y in (Y0 + 0.04, Y1 - 0.04):
            _m2.foot(body, 'M', x, y, min(1.0, q), lod if lod < 2 else 3, z0=0.0)
    for x in (-0.022, 0.022):
        _m2.led_dome(body, 6, (x, CAPF_Y1 + 0.03, TOP), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(led_group)
    win = Kit()
    for i in range(4):
        yc = CAPF_Y1 + 0.05 + 0.1 * i
        win.rbox((W - 0.004, 0.084 if lod < 3 else 0.09, 0.044), (0, yc, AXZ), 0.004 if lod < 3 else 0.0, POLY,
                 cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.0)
    # rod, piston and head (PIVOT__rod, modelled retracted)
    rod = Kit(pivot='PIVOT__rod')
    nr = seg(32, q, 8)
    rod.cyl(0.012, -0.001, 0.30, CHROME, seg(20, q, 6), m=kit.at(0, Y0 + HEAD_T + 0.30 - 0.001, AXZ)
            @ kit.frame(axis='-y'))
    if lod < 3:
        rod.cyl(0.036, -0.012, 0.012, STEEL, nr, bev=0.002 if lod < 2 else 0.0, bseg=1,
                m=kit.at(0, Y0 + HEAD_T + 0.29, AXZ) @ kit.frame(axis='-y'))
    prof = [(0.0, 0.0, IGN), (HEAD_R - 0.006, 0.0, IGN)]
    if lod < 3:
        prof += [(HEAD_R - 0.001, 0.002, IGN)]
    prof += [(HEAD_R, 0.006, IGN), (HEAD_R, HEAD_T - 0.007, IGN)]
    if lod < 3:
        prof += [(HEAD_R - 0.0015, HEAD_T - 0.003, IGN)]
    prof += [(HEAD_R - 0.004, HEAD_T - 0.002, GRIP), (0.0, HEAD_T, GRIP)]
    rod.lathe(prof, nr, kit.at(0, Y0 + HEAD_T, AXZ) @ kit.frame(axis='-y'))
    pieces = {'body': body, 'window': win, 'rod': rod}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.ram.bone', (0, 0.02, TOP), (0, 0, 1), (0, 1, 0), 0.06),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'M', '1,1,5', 1.1, 'bottom', 5000,
        'Pneumatic piston at D = 0.5 (stroke 0.25, retracted, fires -Y): Ignition rear cap, 4 graphite barrel modules '
        'with kn_poly_clear window segments on both ±X faces (panel lines at the joints), brushed-steel front cap, '
        '4 x M5 per cap side, FOOT_M. PIVOT__rod (y, -0.25 ... 0): chrome rod Ø 0.024, steel piston behind the windows, '
        'Ignition pusher head Ø 0.08 x 0.025 with a rubber-grip face. LED_D6 x 2 (group 0 armed, 1 extended) near the '
        'front, PR-S power / signal in on the rear top, name plate on the top. Other lengths: the engine tiles '
        'ram__barrel (deferred: one mesh at D = 0.5). kn_mass_hint = 0.8 + 0.6 x 0.5. UV1 authored for the 2048² set '
        '(bake pending). Brief: docs/art/briefs/drive.md#ram.',
        MASTERS, led_groups='0:armed,1:extended', skins='ignition,bone')
    part.pivot('rod', (0, 0, AXZ), 'y', -STROKE, 0.0, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    part.col_box('body', (W, D - HEAD_T, TOP), (0, HEAD_T / 2, TOP / 2), phys='powder', restitution=0.2, friction=0.5)
    _m2.under(part, part.col_cyl('rod', 0.012, 0.30, (0, Y0 + HEAD_T + 0.15, AXZ), 'y', phys='steel'), 'rod')
    _m2.under(part, part.col_cyl('head', HEAD_R, HEAD_T, (0, Y0 + HEAD_T / 2, AXZ), 'y', phys='rubber',
                                 restitution=0.3, friction=0.9), 'rod')
    part.port('power', 'in', (0, Y1 - 0.030, TOP), (0, 0, 1), 'S', 'in')
    part.port('signal', 'fire', (0, Y1 - 0.075, TOP), (0, 0, 1), 'S', 'in')  # brief: PORT__signal__in; def: fire
    part.emit('exhaust', 'vent', (0, Y1, 0.05), (0, 1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
