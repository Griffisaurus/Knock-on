"""Procedurally build the ZONE source file (docs/art/briefs/future.md, "ZONE: Invisible-in-run gravity / antigrav /
wind / stasis volume").

Usage: blender -b --factory-startup -P tools/blender/make_zone.py -- [out.blend]
Default output: assets/src/future/zone.blend

The only hardware of a ZONE: one corner stake (the engine places four at the volume's bottom corners, rotated so the
glyph faces look out of the volume, and fades them on LET IT RIP). A 0.03 x 0.03 x 0.05 kn_powder_graphite post with
a 4 mm pillow, a Ø 10 mm kn_led mode cap dome on top (group 0 mode_cap: gravity / antigrav / wind / stasis colour)
and the mode glyph decal on its two outward faces (-X and -Y for this authored front-left stake; default gravity =
down chevrons; the antigrav / wind / stasis glyphs sit beside it in trim.marks_m3 for the mode swap). Origin = the
stake's bottom centre. The volume, edges and glyph particles are engine-drawn.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import decal_atlas, kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'zone'
SW, SH = 0.03, 0.05
G, LED, STEEL = 'kn_powder_graphite', 'kn_led', 'kn_steel_brushed'
MASTERS = [G, LED, STEEL, 'kn_decal']


def build(lod, q):
    k = Kit()
    if lod == 2:
        k.prism(kit.outline_rrect(SW, SW, 0.004, 1), 0.0, SH, G, bt=0.0035, bb=0.0035, bseg=2)
    else:
        k.rbox((SW, SW, SH), (0, 0, SH / 2), 0.004 if lod < 3 else 0.0, G, cseg=(3, 2, 1, 0)[lod],
               rz=0.0035 if lod < 3 else 0.0)
    if lod < 3:
        _m2.led_dome(k, 10, (0, 0, SH), (0, 0, 1), q, lod)
    else:  # LOD3: a 5-sided LED cap
        k.cyl(0.005, SH - 0.0002, SH + 0.003, LED, 5)
    k.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.6))
    pieces = {'stake': k}
    sub = decal_atlas.marks_sub('zone_down')
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.marks_m3', (0, -SW / 2, 0.026), (0, -1, 0), (0, 0, 1), 0.020, 0.019, sub=sub),
        kit.decal_plane('trim.marks_m3', (-SW / 2, 0, 0.026), (-1, 0, 0), (0, 0, 1), 0.020, 0.019, sub=sub),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'S', '0.5,0.5,0.5', 0.01, 'bottom', 400,
        'ZONE corner stake (the engine places 4 and draws the volume): 0.03 x 0.03 x 0.05 kn_powder_graphite post, 4 mm '
        'pillow, Ø 10 mm kn_led mode cap (group 0 mode_cap), mode glyph decals (trim.marks_m3; default gravity) on the '
        '-X / -Y faces. Stakes never collide: COL__box__0 exists only because the asset contract needs one shape; the '
        'def must give the zone no body. kn_mass_hint is nominal (stakes have no mass). Footprint 0.5 cells (0.03 m '
        'real, the half-cell minimum). Class proc in the brief; S here. UV1 authored for the shared 1024² trim (bake '
        'pending). Brief: docs/art/briefs/future.md#zone.',
        MASTERS, led_groups='0:mode_cap', skins='gravity,antigrav,wind,stasis')
    part.build_lods(build, lod0_q=1.6)
    part.col_box('0', (SW, SW, SH), (0, 0, SH / 2), phys='powder', restitution=0.0, friction=0.0, ghost=True)
    part.emit('glyph', 'stake', (0, 0, SH + 0.006), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
