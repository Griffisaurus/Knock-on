"""Procedurally build the PANE source file (docs/art/briefs/fun.md, "PANE / VASE: Hero-shatter glass sheet and vase").

Usage: blender -b --factory-startup -P tools/blender/make_pane.py -- [out.blend]
Default output: assets/src/fun/pane.blend

A tall hero-shatter glass sheet (1 x 4 x 0.1, free body, origin = centre of mass 0.20 above the base): a 10 mm
kn_glass sheet (0.10 x 0.40) with polished 2 mm edge bevels, standing in kn_powder_plasma U-channels 12 mm tall on
its top and bottom edges (14 mm thick, so the channels add 4 mm), each lined with a kn_rubber sliver. A frosted-etch
"PANE" name plate in the lower-left corner. FRAC__01-24 (24 chunks, the §7 maximum): 22 glass shards in a radial
spider pattern centred 0.18 above the base (11 sectors x inner / outer ring, long slivers outward, kn_interior_glass
edges) plus the two channels as intact chunks.
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

TYPE = 'pane'
W, HH, T = 0.10, 0.20, 0.010         # width, half height, glass thickness
CH_H, CH_T = 0.012, 0.014            # channel height / outer thickness
CENTRE_Z = -0.02                     # spider centre: 0.18 above the base
GLASS, PLASMA, RUBBER, IGLASS = 'kn_glass', 'kn_powder_plasma', 'kn_rubber', 'kn_interior_glass'
MASTERS = [GLASS, PLASMA, RUBBER, IGLASS, 'kn_decal']


def glass_kit(lod, bev=True):
    k = Kit()
    b = 0.002 if (bev and lod < 3) else 0.0
    cs, bs = ((3, 2), (1, 1), (1, 1), (0, 1))[lod] if bev else (0, 1)
    if lod == 3 and bev:  # 6-point outline (two chamfered corners): 20 tris
        w, h = (W - 0.001) / 2, HH - 0.002
        out = [(-w, -h), (w, -h), (w, h - 0.004), (w - 0.004, h), (-w + 0.004, h), (-w, h - 0.004)]
        k.prism(out, -T / 2, T / 2, GLASS, m=kit.FRONT_OUT)
        return k
    k.prism(kit.outline_rrect(W - 0.001, HH * 2 - 0.004, b, cs if b else 0), -T / 2, T / 2, GLASS,
            bt=b, bb=b, bseg=bs, m=kit.FRONT_OUT)
    return k


def channel_kit(top, lod):
    k = Kit()
    s = 1 if top else -1
    zc = s * (HH - CH_H / 2)
    if lod < 2:
        rb = 0.0015
        outer = Kit()
        outer.rbox((W, CH_T, CH_H), (0, 0, zc), rb, PLASMA, cseg=(2, 1)[lod], rz=rb)
        slot = Kit()
        slot.rbox((W + 0.02, T + 0.0008, CH_H), (0, 0, zc - s * 0.003), 0.0, PLASMA, cseg=0, rz=0.0)
        outer = kit.boolean_diff(outer, [slot], _MATS)
        k.merge(outer)
        outer.free()
        for sy in (-1, 1):  # rubber liner slivers on both slot walls
            k.rbox((W - 0.004, 0.0006, CH_H - 0.004), (0, sy * (T / 2 + 0.0002), zc - s * 0.001), 0.0, RUBBER, cseg=0,
                   rz=0.0)
    elif lod == 2:  # U from three plain boxes
        for sy in (-1, 1):
            k.rbox((W, (CH_T - T) / 2, CH_H), (0, sy * (T + CH_T) / 4, zc), 0.0, PLASMA, cseg=0, rz=0.0)
        k.rbox((W, CH_T, 0.003), (0, 0, s * (HH - 0.0015)), 0.0, PLASMA, cseg=0, rz=0.0)
    else:
        k.rbox((W, CH_T, CH_H), (0, 0, zc), 0.0, PLASMA, cseg=0, rz=0.0)
    return k


_MATS = {}


def build(lod, q):
    pieces = {'glass': glass_kit(lod), 'channels': channel_kit(True, lod)}
    pieces['channels'].merge(channel_kit(False, lod))
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.pane.bone', (-0.022, -T / 2, -HH + CH_H + 0.012), (0, -1, 0), (0, 0, 1), 0.04),
    ])


def frac_kits():
    out = []
    n = 11
    rng = [0.055, 0.075, 0.05, 0.07, 0.06, 0.08, 0.052, 0.068, 0.058, 0.077, 0.062]
    angs = [2 * math.pi * (i + 0.15 * math.sin(3.0 * i)) / n for i in range(n)]
    for i in range(n):
        a0, a1 = angs[i], angs[(i + 1) % n] + (2 * math.pi if i == n - 1 else 0.0)
        am = (a0 + a1) / 2
        for inner in (True, False):
            k = glass_kit(0, bev=False)
            mi = k.mi(IGLASS)
            c = (0.0, 0.0, CENTRE_Z)
            # sector between the rays at a0 and a1 (angles in the pane's XZ plane)
            _m2.frac_cut(k, c, (math.sin(a0), 0.0, -math.cos(a0)), mi)
            _m2.frac_cut(k, c, (-math.sin(a1), 0.0, math.cos(a1)), mi)
            d = (math.cos(am), 0.0, math.sin(am))
            # ring cut at ~45-60 % of the way to the glass edge along the bisector (long slivers outward)
            reach = min((W / 2) / max(abs(d[0]), 1e-6), (HH - 0.004 - (CENTRE_Z if d[2] > 0 else -CENTRE_Z)) /
                        max(abs(d[2]), 1e-6))
            r = reach * (0.45 + 0.15 * (rng[i] - 0.05) / 0.03)
            p = (d[0] * r, 0.0, CENTRE_Z + d[2] * r)
            _m2.frac_cut(k, p, d if inner else (-d[0], 0.0, -d[2]), mi)
            out.append(k)
    for top in (True, False):
        out.append(channel_kit(top, 0))
    return out


def main(out_path=None):
    part = kit.Part(
        TYPE, 'fun', 'S', '1,4,0.1', 1.0, 'com', 600,
        'Hero-shatter glass sheet (free body, origin = COM 0.20 above the base): 10 mm kn_glass sheet with 2 mm edge '
        'bevels in kn_powder_plasma U-channels (12 mm tall, 14 mm thick, kn_rubber liners) top and bottom; frosted-etch '
        'name plate lower left. FRAC__01-24: 22 spider shards (11 sectors x inner / outer, centred 0.18 above the base, '
        'kn_interior_glass) + the 2 channels intact. Break 0.8 N·s. UV1 authored (glass exempt; channels take the '
        '1024² set, bake pending). Brief: docs/art/briefs/fun.md#pane--vase.',
        MASTERS, skins='plasma,cobalt,amber', hints={'kn_break_impulse': 0.8, 'kn_macro_chunks': 24})
    _MATS.update(part.mats)
    part.build_lods(build, lod0_q=1.0, fixed={1: 1.0, 2: 1.0, 3: 1.0})
    part.col_box('0', (W, CH_T, HH * 2), (0, 0, 0), phys='glass', restitution=0.2, friction=0.4)
    part.emit('shatter', 'centre', (0, 0, 0), (0, 0, 1))
    _m2.frac_objects(part, frac_kits())  # FRAC__01-24 (frac.test numbers chunks from 01)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
