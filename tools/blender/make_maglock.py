"""Procedurally build the MAGLOCK source file (docs/art/briefs/power_signal.md, "MAGLOCK: Electromagnet").

Usage: blender -b --factory-startup -P tools/blender/make_maglock.py -- [out.blend]
Default output: assets/src/power/maglock.blend

A pot electromagnet (2 x 2 x 2, bottom origin) in a graphite yoke: the head is one lathe along Y (Ø 0.16,
y -0.09 ... 0.09, centre z 0.10). Its front pole face is the read: a kn_chrome centre pole (Ø 0.06, 1 mm proud), a
kn_led field ring (group 0), a kn_rubber ring and a brushed-steel outer pole ring, flat and facing -Y. Behind it a
kn_poly_clear coil band (y -0.06 ... -0.01) shows the kn_copper windings, then a kn_anod_volt trim ring
(y -0.01 ... -0.004) and the graphite rear cap with the status LED_D8 (group 1) on top and the name plate on the
back. The head hangs on steel trunnions (y 0) in two graphite yoke arms (x ±0.093) on a 0.18 x 0.18 x 0.016 base
plate with 4 M5 heads on FOOT_M bumpers. A graphite eye boss on the head top carries the PR-S tension eye (hook)
and a steel eye ring to z 0.20; PR-M power in on a 1 mm land on the right arm.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'maglock'
HZ, HR = 0.10, 0.08                      # head axis height, radius
BASE_Z0, BASE_Z1 = 0.004, 0.020
ARM_X, ARM_T, ARM_D = 0.092, 0.016, 0.06
PORT_PWR = (0.101, 0.0, 0.055)
EYE_PORT = (0.0, 0.0, 0.183)
STATUS = (0.0, 0.055, HZ + HR - 0.0002)
G, STEEL, RUBBER, COPPER, POLY, VOLT, CHROME, LED = (
    'kn_powder_graphite', 'kn_steel_brushed', 'kn_rubber', 'kn_copper', 'kn_poly_clear', 'kn_anod_volt', 'kn_chrome',
    'kn_led')
MASTERS = [G, STEEL, RUBBER, COPPER, POLY, VOLT, CHROME, LED, 'kn_decal']
HEAD = kit.at(0, 0, HZ) @ kit.frame(axis='y')   # local z = +Y


def led_group(c, _n):
    return (0, 0.0) if c.y < -0.08 else (1, 0.08)


def head_profile(lod):
    C, L, R, S, P, V = CHROME, LED, RUBBER, STEEL, POLY, VOLT
    p = [(0.0, -0.091, C), (0.0292, -0.091, C)]
    if lod < 2:
        p += [(0.030, -0.0904, C)]
    p += [(0.030, -0.0895, L), (0.036, -0.0895, R), (0.046, -0.0895, S), (0.046, -0.090, S)]
    if lod < 3:
        p += [(HR - 0.0025, -0.090, S), (HR - 0.0007, -0.0893, S)]
    p += [(HR, -0.0875, S), (HR, -0.060, P), (HR, -0.010, V), (HR + 0.0012, -0.0094, V), (HR + 0.0012, -0.0046, V),
          (HR, -0.004, G), (HR, 0.084, G)]
    if lod < 3:
        p += [(HR - 0.0015, 0.0885, G)]
    p += [(HR - 0.006, 0.090, G), (0.0, 0.090, G)]
    return p


def windings_profile(lod):
    """Copper coil pack under the clear band: a lathe with one bump per winding layer."""
    n = (16, 10, 6, 0)[lod]
    y0, y1, r0, r1 = -0.058, -0.012, 0.050, 0.0755
    p = [(0.0, y0, COPPER), (r1 - 0.0015, y0, COPPER)]
    for i in range(n):
        t = (i + 0.5) / n
        p.append((r1 - (0.0 if i % 2 == 0 else 0.0012), y0 + (y1 - y0) * t, COPPER))
    p += [(r1 - 0.0015, y1, COPPER), (r0, y1, COPPER), (0.0, y1, COPPER)]
    return p


def build(lod, q):
    cs = (3, 2, 1, 0)[lod]
    head = Kit()
    ns = seg(64, q, 10)
    head.lathe(head_profile(lod), ns, HEAD)
    if lod < 3:
        head.lathe(windings_profile(lod), ns, HEAD)
    # eye boss (graphite) and its 1 mm land face at z 0.183
    head.cyl(0.0175, HZ + HR - 0.012, EYE_PORT[2], G, (28, 16, 10, 8)[lod], bev=0.001 if lod < 2 else 0.0, bseg=1,
             bev_bot=0.0)
    _m2.led_dome(head, 8, STATUS, (0, 0, 1), q, lod)
    head.colors['led'] = _m2.led_attr(led_group)
    eye = Kit()
    eye.torus(0.0075, 0.0022, STEEL, seg(20, q, 6), (8, 6, 4, 4)[lod],
              m=kit.at(0, 0, EYE_PORT[2] + 0.0098) @ kit.rot_x(90))
    yoke = Kit()
    for sx in (-1, 1):
        yoke.rbox((ARM_T, ARM_D, 0.118), (sx * ARM_X, 0, BASE_Z1 + 0.059 - 0.001), 0.005 if lod < 3 else 0.0, G,
                  cseg=cs, rz=0.004 if lod < 3 else 0.0)
        # trunnion: steel pin boss on the outer face, inner pin into the head
        yoke.cyl(0.011, ARM_T / 2 - 0.0005, ARM_T / 2 + 0.0015, STEEL, seg(24, q, 8), bev=0.0008 if lod < 2 else 0.0,
                 bseg=1, bev_bot=0.0, m=kit.at(sx * ARM_X, 0, HZ) @ kit.frame(axis='x' if sx > 0 else '-x'))
        if lod < 3:
            yoke.cyl(0.007, -0.002, ARM_X - ARM_T / 2 - HR + 0.004, STEEL, seg(16, q, 6),
                     m=kit.at(sx * (ARM_X - ARM_T / 2), 0, HZ) @ kit.frame(axis='-x' if sx > 0 else 'x'))
    _m2.land(yoke, 'M', PORT_PWR, (1, 0, 0), 0.001, lod)
    base = Kit()
    base.rbox((0.18, 0.18, BASE_Z1 - BASE_Z0), (0, 0, (BASE_Z0 + BASE_Z1) / 2), 0.008 if lod < 3 else 0.0, G,
              cseg=cs, rz=0.003 if lod < 3 else 0.0)
    for x in (-0.072, 0.072):
        for y in (-0.072, 0.072):
            _m2.screw(base, 'M5', (x, y, BASE_Z1), (0, 0, 1), q, lod)
            _m2.foot(base, 'M', x, y, min(1.0, q), lod, z0=0.0)
    pieces = {'head': head, 'eye': eye, 'yoke': yoke, 'base': base}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.maglock.bone', (0, 0.0902, HZ + 0.03), (0, 1, 0), (0, 0, 1), 0.060),
        kit.decal_plane('picto.magnetic_field.mono', (0, 0.0902, HZ - 0.02), (0, 1, 0), (0, 0, 1), 0.030, 0.030),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'M', '2,2,2', 3.0, 'bottom', 7000,
        'Pot electromagnet: head lathe along Y (Ø 0.16, centre z 0.10) with a flat front pole face (kn_chrome centre '
        'pole Ø 0.06 1 mm proud, kn_led field ring group 0, kn_rubber ring, steel outer pole ring), kn_poly_clear coil '
        'band over kn_copper windings, kn_anod_volt trim ring, graphite rear cap with the status LED_D8 (group 1), '
        'name plate and magnetic-field pictogram (mono) on the back. Steel trunnions in a graphite yoke on a base plate '
        '(4 x M5, FOOT_M). Eye boss + steel eye ring on top (PR-S tension hook), PR-M power in on the right arm. No '
        'horseshoe styling. UV1 authored for the 2048² set (bake pending). '
        'Brief: docs/art/briefs/power_signal.md#maglock.',
        MASTERS, led_groups='0:field_ring,1:status')
    part.build_lods(build, lod0_q=1.2)
    part.col_cyl('head', HR, 0.18, (0, 0, HZ), 'y', phys='steel', restitution=0.2, friction=0.5)
    part.col_box('base', (0.18, 0.18, BASE_Z1), (0, 0, BASE_Z1 / 2), phys='powder', restitution=0.2, friction=0.6)
    for sx, nm in ((-1, 'yoke_l'), (1, 'yoke_r')):
        part.col_box(nm, (ARM_T, ARM_D, 0.118), (sx * ARM_X, 0, BASE_Z1 + 0.058), phys='powder', restitution=0.2,
                     friction=0.5)
    part.port('power', 'in', PORT_PWR, (1, 0, 0), 'M', 'in')
    part.port('tension', 'eye', EYE_PORT, (0, 0, 1), 'S', 'both', kind='hook')
    pts = []
    for y in (-0.09, -0.69):
        for i in range(16):
            a = 2 * math.pi * i / 16
            pts.append((0.12 * math.cos(a), y, HZ + 0.12 * math.sin(a)))
    part.sensor('field', 'pole', pts, filter='steel', reach=0.6, rated_w=150.0)
    part.emit('clack', 'pole', (0, -0.091, HZ), (0, -1, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
