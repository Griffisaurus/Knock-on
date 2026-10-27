"""Procedurally build the SKYSHOW source file (docs/art/briefs/boom.md, "SKYSHOW: Six-shot firework cake").

Usage: blender -b --factory-startup -P tools/blender/make_skyshow.py -- [out.blend]
Default output: assets/src/boom/skyshow.blend

Six splayed kn_paper_red mortar tubes (Ø 0.075) on a pillowed kn_powder_graphite tray (0.30 x 0.30, z 0.004 ...
0.04) on four FOOT_M bumpers (3 x 2 x 3, bottom origin). Tube base centres per the brief (1-3 front row, 4-6 back
row); rows splay ±10° about X and the outer columns ±8° about Y, tops at z 0.195, so the tube axes (the shell
trajectories) are exact. Each tube has a kn_cardboard rim and a kn_paper_tan cap. A kn_fuse_cord quick-match runs on
the tray top from the PR-S heat fuse ring (front face) to tube 1 and hops 1 -> 6 in shallow S curves; a short built-in
stub leaves the ring to its spark tip (0.03, -0.165, 0.03). Hazard stripe band and explosive pictogram on the tray
front, name plate on the tray top front.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'skyshow'
TZ0, TZ1 = 0.004, 0.04
TOP_Z = 0.195
TR = 0.0375
BASES = [(-0.085, -0.065), (0.0, -0.065), (0.085, -0.065), (0.085, 0.065), (0.0, 0.065), (-0.085, 0.065)]
PORT = (0.0, -0.151, 0.022)
TIP = (0.03, -0.162, 0.03)       # brief -0.165; 3 mm in so the cake keeps its 3-cell depth and centre
G, RUBBER, CARD, RED, TAN, CORD = (
    'kn_powder_graphite', 'kn_rubber', 'kn_cardboard', 'kn_paper_red', 'kn_paper_tan', 'kn_fuse_cord')
MASTERS = [G, RUBBER, CARD, RED, TAN, CORD, 'kn_decal']


def tube_axis(i):
    """Unit axis of tube i: rows splay ±10° on Y (toward the row's side), outer columns ±8° on X."""
    x, y = BASES[i]
    ax = math.radians(8.0) * (1 if x > 0.01 else -1 if x < -0.01 else 0)
    ay = math.radians(10.0) * (1 if y > 0 else -1)
    d = Vector((math.tan(ax), math.tan(ay), 1.0))
    return d.normalized()


def tube_frame(i):
    """(base point on the tray top, axis, length to the top plane z 0.195)."""
    x, y = BASES[i]
    d = tube_axis(i)
    length = (TOP_Z - TZ1) / d.z
    return Vector((x, y, TZ1)), d, length


def tube(k, i, lod, q):
    base, d, L = tube_frame(i)
    n = seg(32, q, 8)
    m = kit.frame(tuple(base), tuple(d))
    rim = 0.0035
    prof = [(0.0, -0.004, RED), (TR, -0.004, RED), (TR, L - 0.006, CARD), (TR + 0.0012, L - 0.005, CARD),
            (TR + 0.0012, L - 0.0005, CARD), (TR - rim, L, CARD), (TR - rim, L - 0.002, TAN), (0.0, L - 0.0015, TAN)]
    if lod >= 3:
        prof = [(0.0, -0.004, RED), (TR, -0.004, RED), (TR, L - 0.005, CARD), (TR, L, TAN), (0.0, L, TAN)]
    k.lathe(prof, n, m)


def tube_point(i, h, ang):
    base, d, _ = tube_frame(i)
    rot = d.to_track_quat('Z', 'Y').to_matrix()
    return base + d * h + rot @ Vector((TR * math.cos(ang), TR * math.sin(ang), 0.0))


def match_path():
    """Quick-match on the tray top: port -> tube 1 -> ... -> tube 6, each run a shallow S at z 0.044."""
    z = TZ1 + 0.003
    pts = [Vector((PORT[0], PORT[1] + 0.012, z))]
    order = list(range(6))
    prev = pts[0]
    for i in order:
        x, y = BASES[i]
        tgt = Vector((x, y, z))
        to = (tgt - prev)
        to.z = 0
        dist = to.length
        near = tgt - to.normalized() * (TR + 0.004)
        mid = (prev + near) / 2
        side = Vector((-to.y, to.x, 0)).normalized() * 0.012
        pts += [prev.lerp(mid, 0.5) + side, mid, mid.lerp(near, 0.5) - side, near]
        prev = near
    return [tuple(p) for p in pts]


def build(lod, q):
    cs = (3, 2, 1, 0)[lod]
    tray = Kit()
    tray.rbox((0.30, 0.30, TZ1 - TZ0), (0, 0, (TZ0 + TZ1) / 2), 0.012 if lod < 3 else 0.0, G, cseg=cs,
              rz=0.006 if lod < 3 else 0.0)
    # rear carry tab (balances the front fuse stub so the bounds stay centred)
    tray.rbox((0.08, 0.012, 0.014), (0, 0.149, 0.024), 0.006 if lod < 3 else 0.0, G, cseg=max(1, cs - 1) if lod < 3
              else 0, rz=0.003 if lod < 3 else 0.0)
    for x in (-0.12, 0.12):
        for y in (-0.12, 0.12):
            _m2.foot(tray, 'M', x, y, min(1.0, q), lod)
    tubes = Kit()
    for i in range(6):
        tube(tubes, i, lod, q)
    fuse = Kit()
    if lod < 3:
        p = match_path()
        if lod >= 1:
            p = p[::2] + [p[-1]] if lod == 2 else p
        fuse.sweep(p, 0.0022, (6, 5, 4)[lod], CORD)
        # built-in stub from the ring out to the spark tip
        fuse.sweep([(PORT[0], PORT[1] + 0.004, PORT[2]), (PORT[0] + 0.01, PORT[1] - 0.006, PORT[2] + 0.004),
                    (TIP[0] - 0.006, TIP[1] + 0.004, TIP[2] - 0.001), TIP], 0.0022, (6, 5, 4)[lod], CORD)
    else:
        fuse.sweep([(PORT[0], PORT[1] + 0.004, PORT[2]), TIP], 0.0022, 4, CORD)
    pieces = {'tray': tray, 'tubes': tubes, 'fuse': fuse}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('trim.hazard_r', (-0.085, -0.15, 0.022), (0, -1, 0), (0, 0, 1), 0.10, 0.014,
                        sub=(0.0, 0.0, 0.9, 1.0)),
        kit.decal_plane('trim.hazard_r', (0.098, -0.15, 0.022), (0, -1, 0), (0, 0, 1), 0.076, 0.014,
                        sub=(0.0, 0.0, 0.68, 1.0)),
        kit.decal_plane('picto.explosive.warn', (0.112, -0.115, TZ1), (0, 0, 1), (0, 1, 0), 0.028, 0.028),
        kit.decal_plane('name.skyshow.bone', (-0.075, -0.136, TZ1), (0, 0, 1), (0, 1, 0), 0.056),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'boom', 'M', '3,2,3', 1.6, 'bottom', 6500,
        'Six-shot firework cake: kn_paper_red tubes (Ø 0.075, kn_cardboard rims, kn_paper_tan caps) splayed exactly '
        '(rows ±10° about X, outer columns ±8° about Y, tops z 0.195) on a graphite tray (z 0.004 ... 0.04) on FOOT_M; '
        'kn_fuse_cord quick-match from the PR-S heat fuse ring hopping tube 1 -> 6 in shallow S runs, built-in stub '
        'to the spark tip. Hazard stripe band + explosive pictogram on the tray front, name plate on the tray top. '
        'UV1 authored (bake pending; masters + decal atlas per the brief). Brief: docs/art/briefs/boom.md#skyshow.',
        MASTERS, skins='classic,gala')
    part.build_lods(build, lod0_q=2.2)
    part.col_box('tray', (0.30, 0.30, TZ1), (0, 0, TZ1 / 2), phys='powder', restitution=0.2, friction=0.6)
    pts = []
    for i in range(6):
        for h in (0.0, tube_frame(i)[2]):
            for a in range(0, 360, 60):
                pts.append(tuple(tube_point(i, h, math.radians(a))))
    # keep only the outer hull points (<= 64 for rule 7): farthest-first from the cake centre
    pts.sort(key=lambda p: -(p[0] ** 2 + p[1] ** 2))
    part.col_hull('cake', pts[:64], phys='paper', restitution=0.2, friction=0.6)
    part.port('heat', 'fuse', PORT, (0, -1, 0), 'S', 'in')
    part.emit('spark', 'fuse_tip', TIP, (0, 0, 1))
    for i in range(6):
        base, d, L = tube_frame(i)
        part.emit('muzzle', 'tube_%d' % (i + 1), tuple(base + d * L), tuple(d))
    part.emit('smoke', 'tray', (0, 0, 0.05), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
