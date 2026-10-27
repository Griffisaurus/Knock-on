"""Procedurally build the PING source file (docs/art/briefs/power_signal.md, "PING: Wireless transmitter /
receiver").

Usage: blender -b --factory-startup -P tools/blender/make_ping.py -- [out.blend]
Default output: assets/src/power/ping.blend

A seamless "newer product line" puck (1 x 1 x 1, bottom origin): a graphite base 0.09 x 0.09 x 0.05 with a 7 mm
pillowed bevel on four FOOT_S bumpers, a kn_poly_clear dome (Ø 0.06 x 0.02, z 0.05 ... 0.07) over a kn_led core
(group 0 pair_pulse), a Ø 3 mm kn_chrome whip antenna to z 0.090 and a Ø 0.016 anodised tip bead (pair colour;
default skin `ignition`, kn_anod_ignition). SCREEN__mode (icon, 0.024 square, Tx / Rx) in a shallow kit bezel on
the front; PR-S signal in on -X and signal out on +X, each on a 1 mm land on the 36 mm side flats. Name plate on the
back. No visible fasteners.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'ping'
FEET = 0.003
BW, BTOP = 0.09, 0.05
DOME_R, DOME_Z0, DOME_Z1 = 0.03, 0.05, 0.07
TIP_Z, TIP_R = 0.090, 0.008
SCR = 0.024
SCR_C = Vector((0.0, -0.0455, 0.025))
G, RUBBER, CHROME, TIP, POLY, LED, SCREEN, GLASS = (
    'kn_powder_graphite', 'kn_rubber', 'kn_chrome', 'kn_anod_ignition', 'kn_poly_clear', 'kn_led', 'kn_screen',
    'kn_glass')
MASTERS = [G, RUBBER, CHROME, TIP, POLY, LED, SCREEN, GLASS, 'kn_decal']


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    q = min(1.0, q * 2.0)  # small curved pieces (dome, bead) carry the read
    body = Kit()
    body.rbox((BW, BW, BTOP - FEET), (0, 0, FEET + (BTOP - FEET) / 2), 0.007 if lod < 3 else 0.0, G,
              cseg=cs if lod < 3 else 0, rz=0.007 if lod < 3 else 0.0)
    for sx in (-1, 1):
        _m2.land(body, 'S', (sx * 0.046, 0, 0.025), (sx, 0, 0), 0.001, lod)
    for x in (-0.033, 0.033):
        for y in (-0.033, 0.033):
            _m2.foot(body, 'S', x, y, 0.4, lod if lod == 0 else lod + 1)
    n, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    depth = 0.002
    if lod < 3:
        c = Vector(_m2.screen_bezel(body, mats, SCR, SCR, tuple(SCR_C - n * (depth - 0.0015)), tuple(n), tuple(up),
                                    lod, q, depth=depth))
    else:  # LOD3: the quad sits on the flat front
        c = SCR_C
    # dome: clear cap with the LED core underneath and a graphite seat ring
    dome = Kit()
    nd = seg(32, q, 8)
    if lod < 3:
        dome.cyl(DOME_R + 0.002, BTOP - 0.001, BTOP + 0.002, G, nd, bev=0.001 if lod < 2 else 0.0, bseg=1)
    dome.sphere(DOME_R, POLY, nd, seg(8, q, 3, 2) if lod < 3 else 4, m=kit.at(0, 0, DOME_Z0 + 0.0005), sz_top=0.65,
                sz_bot=0.02)
    if lod < 3:
        dome.sphere(0.012, LED, seg(16, q, 6), seg(6, q, 3), m=kit.at(0, 0, DOME_Z0 + 0.002), sz_top=0.6, sz_bot=0.1)
    else:
        dome.cyl(0.012, DOME_Z0, DOME_Z0 + 0.006, LED, 6)
    dome.colors['led'] = _m2.led_attr(lambda c_, n_: (0, 0.15))
    ant = Kit()
    ant.cyl(0.0015, DOME_Z0 + 0.004, TIP_Z, CHROME, seg(10, q, 4) if lod < 3 else 4)
    ant.sphere(TIP_R, TIP, seg(18, q, 6) if lod < 3 else 6, seg(10, q, 4, 2) if lod < 3 else 3, m=kit.at(0, 0, TIP_Z))
    pieces = {'body': body, 'dome': dome, 'antenna': ant,
              'screen': kit.screen_quad(tuple(c), tuple(n), tuple(up), SCR, SCR, lift=0.0002)}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.ping.bone', (0, BW / 2, 0.026), (0, 1, 0), (0, 0, 1), 0.044),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '1,1,1', 0.25, 'bottom', 1500,
        'Wireless transmitter / receiver: seamless graphite puck (7 mm pillow) on FOOT_S, kn_poly_clear dome over a '
        'kn_led core (group 0 pair_pulse), Ø 3 mm chrome whip antenna with a Ø 0.016 anodised tip bead (pair colour '
        'skins; default ignition). SCREEN__mode icon (Tx / Rx) in a shallow kit bezel on the front; PR-S signal in '
        '(-X) / out (+X, max 8) on 1 mm lands. Name plate on the back; no fasteners. UV1 authored for the 1024² set '
        '(bake pending). Brief: docs/art/briefs/power_signal.md#ping.',
        MASTERS, led_groups='0:pair_pulse', skins='ignition,volt,beam,cobalt,plasma,graphite')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.2)
    part.col_box('base', (BW, BW, BTOP), (0, 0, BTOP / 2), phys='powder', restitution=0.25, friction=0.5)
    part.col_capsule('antenna', TIP_R, TIP_Z + TIP_R - DOME_Z0, (0, 0, (TIP_Z + TIP_R + DOME_Z0) / 2), 'z',
                     phys='powder', restitution=0.3, friction=0.4)
    part.port('signal', 'in', (-0.046, 0, 0.025), (-1, 0, 0), 'S', 'in')
    part.port('signal', 'out', (0.046, 0, 0.025), (1, 0, 0), 'S', 'out', max_links=8)
    part.emit('ping', 'antenna', (0, 0, 0.10), (0, 0, 1))
    n = Vector((0, -1, 0))
    part.screen('mode', SCR, SCR, tuple(SCR_C + n * 0.0002), tuple(n), (0, 0, 1), kind='icon', color='signal')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
