"""Procedurally build the TONEBARS source file (docs/art/briefs/fun.md, "TONEBARS: Tuned bar on a node cradle").

Usage: blender -b --factory-startup -P tools/blender/make_tonebars.py -- [out.blend]
Default output: assets/src/fun/tonebars.blend  (+ sidecar assets/build/parts/tonebars/tonebars.variants.json)

One placed bar unit (1 x 0.5 x 3, bottom origin): a pillowed kn_powder_graphite cradle rail (0.07 x 0.020 x 0.30,
z 0.004 ... 0.024) on four 4 mm FOOT_S bumpers, two 12 mm graphite node posts at ±0.276 L with kn_rubber grommets and
kn_brass pins, and the tuned bar on PIVOT__bar (axis z, slide ±2 mm ring-out wobble): 0.085 x 0.014, top at z 0.050,
2 mm bevel, with the arched tuning undercut on its bottom face. The exported mesh is variant `bar_00` (degree 1,
L 0.300, kn_anod_ignition). The rail's front face holds the LED_D8 note dome (group 0) and SCREEN__note (kind text,
3 chars, 0.026 x 0.010) in a kit bezel. The 15-bar two-octave set (lengths, node posts, degree colours) is written to
tonebars.variants.json: every variant is this bar with its length and post spacing changed (no other detail).
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'tonebars'
RAIL_W, RAIL_Z0, RAIL_Z1, RAIL_L = 0.07, 0.004, 0.024, 0.30
BAR_W, BAR_T, BAR_TOP = 0.085, 0.014, 0.050
FRONT = -RAIL_L / 2
LED_C = (-0.020, FRONT, 0.014)
SCR_C = Vector((0.010, FRONT - 0.0005, 0.014))
SCR_W, SCR_H = 0.026, 0.010
COLOURS = ['kn_anod_ignition', 'kn_copper', 'kn_brass', 'kn_anod_volt', 'kn_anod_beam', 'kn_anod_cobalt',
           'kn_anod_plasma']
DEGREES = ['1', '2', '3', '4', '5', '6', '7']
VARIANTS = []
for i in range(15):
    L = round(0.300 * 2 ** (-i / 14), 3)
    VARIANTS.append({'name': 'tonebars__bar_%02d' % i, 'degree': DEGREES[i % 7] + ("'" * (i // 7)),
                     'length': L, 'node_posts_y': round(0.276 * L, 3), 'master': COLOURS[i % 7]})
VAR = VARIANTS[0]
L = VAR['length']
POST_Y = VAR['node_posts_y']
G, RUBBER, BRASS, LED, SCREEN, GLASS, STEEL = (
    'kn_powder_graphite', 'kn_rubber', 'kn_brass', 'kn_led', 'kn_screen', 'kn_glass', 'kn_steel_brushed')
BAR = VAR['master']
MASTERS = [G, RUBBER, BRASS, LED, SCREEN, GLASS, STEEL, BAR, 'kn_decal']


def bar_outline(n_arch, bev):
    """Side profile (y, z) of the bar: flat top, ends, arched tuning undercut between the node posts (CCW)."""
    z0, z1 = BAR_TOP - BAR_T, BAR_TOP
    a = POST_Y + 0.012
    pts = [(-L / 2, z0), (-a, z0)]
    for i in range(1, n_arch):
        t = i / n_arch
        y = -a + 2 * a * t
        pts.append((y, z0 + 0.005 * math.sin(math.pi * t)))
    pts += [(a, z0), (L / 2, z0), (L / 2, z1), (-L / 2, z1)]
    return pts


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    rail = Kit()
    rail.rbox((RAIL_W, RAIL_L, RAIL_Z1 - RAIL_Z0), (0, 0, (RAIL_Z0 + RAIL_Z1) / 2), 0.005 if lod < 3 else 0.0, G,
              cseg=cs, rz=0.003 if lod < 3 else 0.0)
    for x in (-0.025, 0.025):
        for y in (-0.12, 0.12):
            _m2.foot(rail, 'S', x, y, min(1.0, q), lod if lod < 2 else 3)
    n = seg(16, q, 6)
    for sy in (-1, 1):  # node posts with rubber grommets and brass pins
        y = sy * POST_Y
        rail.cyl(0.006, RAIL_Z1 - 0.001, BAR_TOP - BAR_T - 0.004, G, n, bev=0.001 if lod < 3 else 0.0, bseg=1,
                 bev_bot=0.0, m=kit.at(0, y, 0))
        rail.torus(0.0055, 0.0022, RUBBER, n, (6, 4, 3, 3)[lod], m=kit.at(0, y, BAR_TOP - BAR_T - 0.003))
        if lod < 3:
            rail.cyl(0.0016, BAR_TOP - BAR_T - 0.004, BAR_TOP + 0.0012, BRASS, seg(8, q, 5), m=kit.at(0, y, 0))
            rail.cyl(0.0028, BAR_TOP - 0.0002, BAR_TOP + 0.0015, BRASS, seg(10, q, 5), bev=0.0006, bseg=1,
                     m=kit.at(0, y, 0))
    _m2.led_dome(rail, 8, LED_C, (0, -1, 0), q, lod)
    nrm, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    if lod < 3:
        depth = 0.0025
        c = Vector(_m2.screen_bezel(rail, mats, SCR_W, SCR_H, tuple(SCR_C - nrm * (depth - 0.0015)), tuple(nrm),
                                    tuple(up), lod, q, depth=depth))
    else:
        c = SCR_C
    rail.colors['led'] = _m2.led_attr(lambda cc, nn: (0, 0.1))
    bar = Kit(pivot='PIVOT__bar')
    b = 0.002 if lod < 3 else 0.0
    out = bar_outline((10, 6, 3, 1)[lod], b)
    # outline in (y, z) extruded along X (X_AXIS: local x -> Y, local y -> Z, local z -> X)
    bar.prism(out, -BAR_W / 2, BAR_W / 2, BAR, bt=b, bb=b, bseg=(2, 1, 1, 1)[lod], m=kit.X_AXIS)
    pieces = {'rail': rail, 'bar': bar, 'screen': kit.screen_quad(tuple(c), tuple(nrm), tuple(up), SCR_W, SCR_H,
                                                                 lift=0.0002)}
    return pieces


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'M', '1,0.5,3', 1.2, 'bottom', 3200,
        'Tuned bar unit, exported as variant bar_00 (degree 1, L 0.300, kn_anod_ignition): pillowed graphite cradle '
        'rail on 4 mm FOOT_S, node posts at ±0.276 L with rubber grommets and brass pins, bar 0.085 x 0.014 (top z '
        '0.050, 2 mm bevel, arched tuning undercut) on PIVOT__bar (z slide ±2 mm). LED_D8 note dome (group 0) and '
        'SCREEN__note (text, 3 chars) in a kit bezel on the rail front. The other 14 bars (lengths 2^(-i/14) x 0.3, '
        'posts, degree colours) are in tonebars.variants.json for the engine to swap / stretch (deferred: 15 separate '
        'meshes in one glb). No note names on the mesh. UV1 authored for the 2048² shared set (bake pending). '
        'Brief: docs/art/briefs/fun.md#tonebars.',
        MASTERS, led_groups='0:note', skins='metal,wood')
    part.pivot('bar', (0, 0, BAR_TOP - BAR_T / 2), 'z', -0.002, 0.002, motion='slide')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.2)
    part.col_box('0', (BAR_W, L, BAR_T), (0, 0, BAR_TOP - BAR_T / 2), phys='steel', restitution=0.45, friction=0.4)
    part.col_box('1', (RAIL_W, RAIL_L, RAIL_Z1 - RAIL_Z0), (0, 0, (RAIL_Z0 + RAIL_Z1) / 2), phys='powder',
                 restitution=0.2, friction=0.5)
    part.sensor('trigger', 'bar', [(x * BAR_W / 2, y * L / 2, z) for x in (-1, 1) for y in (-1, 1)
                                   for z in (BAR_TOP, BAR_TOP + 0.008)], threshold=0.02, cooldown=0.06)
    part.emit('note', 'bar', (0, 0, 0.058), (0, 0, 1))
    n = Vector((0, -1, 0))
    part.screen('note', SCR_W, SCR_H, tuple(SCR_C + n * 0.0002), tuple(n), (0, 0, 1), kind='text', chars=3,
                color='sound')
    side = os.path.join(part.root_dir, 'assets', 'build', 'parts', TYPE)
    os.makedirs(side, exist_ok=True)
    with open(os.path.join(side, TYPE + '.variants.json'), 'w', encoding='utf8') as f:
        json.dump({'type': TYPE, 'exported': VAR['name'], 'note': 'Every variant is the exported bar with its length '
                   'scaled along Y (part space) and the node posts moved to ±node_posts_y; the bar master follows '
                   'the degree (metal skin) or is kn_wood_walnut (wood skin). Tonics are ignition.',
                   'bar_section': {'width': BAR_W, 'thickness': BAR_T, 'top_z': BAR_TOP}, 'variants': VARIANTS},
                  f, indent=1)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
