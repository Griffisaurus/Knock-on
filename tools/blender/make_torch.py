"""Procedurally build the TORCH source file (docs/art/briefs/power_signal.md, "TORCH: Flashlight").

Usage: blender -b --factory-startup -P tools/blender/make_torch.py -- [out.blend]
Default output: assets/src/power/torch.blend

A chunky square-bodied flashlight (2x1x1) lying in a two-saddle cradle: a pillowed graphite body (0.065 square
section along X, x -0.1 ... 0.06, axis z 0.055, 8 mm), a kn_rubber_grip knurl band at the tail, and a
kn_anod_beam head (Ø 0.088, x 0.06 ... 0.10) whose lathe profile turns inward into a deep kn_chrome reflector
with a kn_led disc in its throat (group 0 lens) behind a 2 mm kn_glass lens. The fat rubber switch dome
(Ø 0.022) sits on PIVOT__switch (axis z, slide -4 mm ... 0) at (-0.03, 0, 0.088) in a steel bezel ring.
Two graphite U-saddles (x -0.06 and 0.03) with rubber cradle pads stand on rubber foot bars. PORT__signal__in
(PR-S, -Y) sits on a 1 mm Ø 35 mm boss on the body side between the saddles; name plate on the same side,
light-beam pictogram (mono) on the body top.
"""
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

TYPE = 'torch'
AXZ = 0.055                                  # body / head axis height
SEC = 0.065                                  # body square section
BODY_X0, BODY_X1 = -0.1, 0.06
HEAD_R, HEAD_X0, HEAD_X1 = 0.044, 0.06, 0.10
SADDLES = (-0.06, 0.03)
SW = (-0.03, 0.0, 0.088)                     # PIVOT__switch
DOME_R = 0.011
PORT = (-0.015, -0.0335, AXZ)
PAD_TOP = AXZ - SEC / 2                       # body underside z 0.0225
G, GRIP, RUBBER, BEAM, CHROME, GLASS, STEEL, LED = (
    'kn_powder_graphite', 'kn_rubber_grip', 'kn_rubber', 'kn_anod_beam', 'kn_chrome', 'kn_glass',
    'kn_steel_brushed', 'kn_led')
MASTERS = [G, GRIP, RUBBER, BEAM, CHROME, GLASS, STEEL, LED, 'kn_decal']
AXIS = kit.at(0, 0, AXZ) @ kit.X_AXIS         # local z = +X along the torch axis, local (x, y) = Blender (y, z)


def fillet(pts, r, n):
    """Round every corner of a closed polygon (convex or concave) with a quadratic-Bezier fillet of n segs."""
    if n < 1 or r <= 0:
        return list(pts)
    out = []
    m = len(pts)
    for i in range(m):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % m])
        a, b = (p0 - p1), (p2 - p1)
        d = min(r, a.length * 0.45, b.length * 0.45)
        t0, t1 = p1 + a.normalized() * d, p1 + b.normalized() * d
        for k in range(n + 1):
            t = k / n
            p = t0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + t1 * t * t
            out.append((p.x, p.y))
    return out


def head_profile(n_refl, lod):
    """Head lathe (r, x, master): pole inside the body, Ø 0.088 shell, rounded front lip, then inward along a
    parabolic kn_chrome reflector to a kn_led disc in the throat."""
    p = [(0.0, HEAD_X0 - 0.003, BEAM), (0.036, HEAD_X0 - 0.003, BEAM)]
    if lod < 2:
        p += [(0.041, HEAD_X0 - 0.0015, BEAM), (HEAD_R - 0.0005, HEAD_X0 + 0.002, BEAM)]
    p += [(HEAD_R, HEAD_X0 + 0.004, BEAM), (HEAD_R, HEAD_X1 - 0.003, BEAM)]
    if lod < 2:
        p += [(HEAD_R - 0.0008, HEAD_X1 - 0.0008, BEAM)]
    p += [(HEAD_R - 0.003, HEAD_X1, BEAM), (0.0385, HEAD_X1, BEAM), (0.0375, HEAD_X1 - 0.001, CHROME)]
    # reflector: r from 0.0375 (x 0.0965) down to 0.009 (x 0.074), parabola-ish
    x_top, x_bot = HEAD_X1 - 0.0035, 0.074
    for i in range(1, n_refl + 1):
        t = i / n_refl
        r = 0.0375 + (0.009 - 0.0375) * t
        x = x_top - (x_top - x_bot) * (t ** 1.8)
        p.append((r, x, CHROME if i < n_refl else LED))
    p.append((0.0, x_bot, LED))
    return p


def led_group(_c, _n):
    return 0, 0.0  # group 0 "lens", dark when off


def saddle_outline(n):
    """U-cradle cross-section in (y, z): base under the body, two cheeks up the sides."""
    w, top, floor, cheek = 0.042, 0.042, PAD_TOP - 0.004, SEC / 2 + 0.001
    pts = [(-w, 0.0032), (w, 0.0032), (w, top), (cheek, top), (cheek, floor), (-cheek, floor), (-cheek, top),
           (-w, top)]
    return fillet(pts, 0.003, n)


def build(lod, q):
    cs = (3, 2, 1, 0)[lod]
    body = Kit()
    if lod < 3:
        body.rbox((BODY_X1 - BODY_X0, SEC, SEC), ((BODY_X0 + BODY_X1) / 2, 0, AXZ), 0.008, G, cseg=cs)
        # knurl band at the tail (kn_rubber_grip), 2 mm proud
        body.rbox((0.024, SEC + 0.004, SEC + 0.004), (-0.084, 0, AXZ), 0.009, GRIP, cseg=max(1, cs - 1))
        # port boss: the PR-S collar's centre plane sits on its face (y -0.0335)
        body.cyl(0.0175, -0.006, 0.0, G, seg(20, q, 8), bev=0.001 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
                 m=kit.frame(PORT, '-y'))
        # switch bezel ring
        body.torus(0.0125, 0.0016, STEEL, seg(22, q, 6), (5, 4, 3)[lod], m=kit.at(SW[0], SW[1], SEC / 2 + AXZ))
    else:
        body.rbox((BODY_X1 - BODY_X0, SEC, SEC), ((BODY_X0 + BODY_X1) / 2, 0, AXZ), 0.0, G, cseg=0, rz=0.0)
    # head: Beam shell + chrome reflector + LED throat, glass lens in the lip
    head = Kit()
    hs = seg(32, q, 8)
    head.lathe(head_profile(seg(5, q, 2) if lod < 3 else 1, lod), hs, AXIS)
    if lod < 3:
        head.cyl(0.0388, HEAD_X1 - 0.0035, HEAD_X1 - 0.0012, GLASS, hs, bev=0.0005 if lod == 0 else 0.0, bseg=1,
                 m=AXIS)
    head.colors['led'] = _m2.led_attr(led_group)
    # cradle: two U-saddles with rubber pads, on rubber foot bars
    cradle = Kit()
    for x in SADDLES:
        if lod < 3:
            cradle.prism(saddle_outline((2, 1, 1)[lod]), -0.008, 0.008, G, bt=0.0015 if lod < 2 else 0.0,
                         bb=0.0015 if lod < 2 else 0.0, bseg=1, m=kit.at(x, 0, 0) @ kit.X_AXIS)
            cradle.rbox((0.018, 0.046, 0.0045), (x, 0, PAD_TOP - 0.00225), 0.002 if lod < 2 else 0.0, RUBBER,
                        cseg=1 if lod < 2 else 0, rz=0.001 if lod < 2 else 0.0)
            # rubber foot bar (FOOT_BAR section, 3.2 mm high so the saddle sits on it)
            cradle.rbox((0.012, 0.07, 0.0038), (x, 0, 0.0019), 0.004 if lod < 2 else 0.0, RUBBER,
                        cseg=1 if lod < 2 else 0, rz=0.0012 if lod < 2 else 0.0)
        else:
            cradle.rbox((0.016, 0.084, PAD_TOP), (x, 0, PAD_TOP / 2), 0.0, G, cseg=0, rz=0.0)
    # switch dome (moves with PIVOT__switch, modelled at rest)
    sw = Kit(pivot='PIVOT__switch')
    sw.sphere(DOME_R, RUBBER, seg(24, q, 6), seg(10, q, 4, 2), m=kit.at(SW[0], SW[1], SEC / 2 + AXZ),
              sz_top=0.7, sz_bot=0.5)
    pieces = {'body': body, 'head': head, 'cradle': cradle, 'switch': sw}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.torch.bone', (0.030, -SEC / 2, 0.066), (0, -1, 0), (0, 0, 1), 0.040),
        kit.decal_plane('picto.light_beam.mono', (0.026, 0, AXZ + SEC / 2), (0, 0, 1), (0, 1, 0), 0.020, 0.020),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'power', 'S', '2,1,1', 0.4, 'bottom', 2500,
        'Flashlight: square-section graphite body (0.065, 8 mm) along X with a rubber-grip knurl band, Beam '
        'anodised head (Ø 0.088) turning into a chrome reflector with a kn_led throat disc (group 0 lens) '
        'behind a glass lens; rubber switch dome on PIVOT__switch (z slide -4 mm ... 0); two graphite U-saddles '
        'with rubber pads on rubber foot bars. PR-S signal in on a 1 mm side boss. Decals: name plate on the '
        'body -Y side, light-beam pictogram (mono) on the body top. Brief: docs/art/briefs/power_signal.md#torch.',
        MASTERS, led_groups='0:lens')
    part.pivot('switch', SW, 'z', -0.004, 0.0, motion='slide')
    part.build_lods(build, lod0_q=1.3)
    part.col_box('body', (0.2, 0.08, 0.08), (0, 0, AXZ), phys='powder', restitution=0.25, friction=0.5)
    part.col_box('cradle', (0.106, 0.084, 0.016), (sum(SADDLES) / 2, 0, 0.008), phys='rubber', restitution=0.3,
                 friction=0.9)
    part.port('signal', 'in', PORT, (0, -1, 0), 'S', 'in')
    part.emit('beam', 'lens', (HEAD_X1, 0, AXZ), (1, 0, 0))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
