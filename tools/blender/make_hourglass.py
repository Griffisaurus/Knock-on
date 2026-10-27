"""Procedurally build the HOURGLASS source file (docs/art/briefs/matter.md, "HOURGLASS: Sand timer").

Usage: blender -b --factory-startup -P tools/blender/make_hourglass.py -- [out.blend]
Default output: assets/src/matter/hourglass.blend

Two kn_poly_clear bulbs (Ø 0.075, z 0.022-0.10 and 0.10-0.178, Ø 0.008 neck, 2 mm wall) lathed as one closed shell
between identical kn_powder_bone rounded-square caps (0.10 x 0.10, 18 mm thick, FOOT_S rubber feet on both outer
faces so it stands either way up), three kn_anod_beam pillars (Ø 0.01 at r 0.044, 90° / 210° / 330°), a bone neck
collar with the PR-S signal `out` boss facing -Y at mid-height, and the hourglass__stream sand thread (Ø 1.5 mm,
kn_paper_tan) the engine scales to the pile and hides when not flowing. CAVITY__top / CAVITY__bottom (matter sand)
are the timer's two fill volumes (not Matter grains: the timer is deterministic and free on the Matter budget).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'hourglass'
BONE, ABEAM, CLEAR, RUBBER, TAN = ('kn_powder_bone', 'kn_anod_beam', 'kn_poly_clear', 'kn_rubber', 'kn_paper_tan')
MASTERS = [BONE, ABEAM, CLEAR, RUBBER, TAN, 'kn_glass']
MID, HALF = 0.10, 0.078            # neck height, bulb half-length (0.022 -> 0.10 -> 0.178)
CAP, CAP_T, FOOT_H = 0.10, 0.018, 0.004
WALL = 0.002
PILLAR_R, PILLAR_A = 0.044, (90.0, 210.0, 330.0)
PORT = (0.0, -0.032, MID)
# bulb outer radius against t = |z - MID| / HALF (0 at the neck, 1 at the cap)
BULB = [(0.0, 0.004), (0.06, 0.0045), (0.12, 0.0065), (0.20, 0.0115), (0.28, 0.019), (0.37, 0.028), (0.46, 0.0345),
        (0.56, 0.0375), (0.68, 0.0368), (0.80, 0.0335), (0.90, 0.0290), (1.0, 0.0245)]


def bulb_r(t):
    for (t0, r0), (t1, r1) in zip(BULB[:-1], BULB[1:]):
        if t <= t1:
            s = (t - t0) / (t1 - t0)
            s = s * s * (3 - 2 * s)
            return r0 + (r1 - r0) * s
    return BULB[-1][1]


def ts(nb):
    """Profile stations 0..1 per bulb, denser near the neck."""
    return [(i / nb) ** 1.35 for i in range(nb + 1)]


def glass(k, lod, q):
    nb = max(2, int(round((7, 5, 3, 2)[lod] * min(q, 2.0))))
    segs = seg(24, q, 6, 2)
    if lod == 3:
        prof = [(0.0, MID - HALF, CLEAR), (bulb_r(1.0), MID - HALF, CLEAR), (bulb_r(0.55), MID - HALF * 0.55, CLEAR),
                (bulb_r(0.0), MID, CLEAR), (bulb_r(0.55), MID + HALF * 0.55, CLEAR), (bulb_r(1.0), MID + HALF, CLEAR),
                (0.0, MID + HALF, CLEAR)]
        k.lathe(prof, segs)
        return
    st = ts(nb)
    outer = [(bulb_r(t), MID - HALF * t) for t in reversed(st)] + [(bulb_r(t), MID + HALF * t) for t in st[1:]]
    inner = [(max(0.0015, r - WALL), z) for r, z in outer]
    prof = [(r, z, CLEAR) for r, z in outer] + [(r, z, CLEAR) for r, z in reversed(inner)]
    k.lathe(prof, segs, closed=True)


def foot(k, x, y, z_face, down, lod, q):
    """Rubber foot Ø 8 mm, 4 mm proud of the cap face (down = under the bottom cap, else on the top cap)."""
    if lod >= 3:
        return
    s = -1 if down else 1
    z0, z1 = sorted((z_face - s * 0.0004, z_face + s * FOOT_H))
    b = 0.0012 if lod < 2 else 0.0  # round the outer (floor-side) rim only
    k.cyl(0.004, z0, z1, RUBBER, seg(10, q, 5), bev=0.0 if down else b, bseg=1, bev_bot=b if down else 0.0,
          m=kit.at(x, y, 0))


def cap(k, z0, z1, lod, q, feet_down):
    cs = (2, 2, 1, 1)[lod]
    k.rbox((CAP, CAP, z1 - z0), (0, 0, (z0 + z1) / 2), 0.012 if lod < 3 else 0.004, BONE, cseg=cs,
           rz=0.003 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            foot(k, sx * 0.036, sy * 0.036, z0 if feet_down else z1, feet_down, lod, q)


def build(lod, q):
    body = Kit()
    cap(body, FOOT_H - 0.0004, FOOT_H + CAP_T, lod, q, True)
    cap(body, 2 * MID - FOOT_H - CAP_T, 2 * MID - FOOT_H + 0.0004, lod, q, False)
    nps = seg(12, q, 5)
    for a in PILLAR_A:
        x, y = PILLAR_R * math.cos(math.radians(a)), PILLAR_R * math.sin(math.radians(a))
        body.cyl(0.005, FOOT_H + CAP_T - 0.002, 2 * MID - FOOT_H - CAP_T + 0.002, ABEAM, nps,
                 bev=0.0008 if lod < 2 else 0.0, bseg=1, m=kit.at(x, y, 0))
    # neck collar + port boss
    body.cyl(0.0095, MID - 0.006, MID + 0.006, BONE, seg(20, q, 6), bev=0.0015 if lod < 3 else 0.0, bseg=1)
    body.rbox((0.012, 0.024, 0.010), (0, -0.0205, MID), 0.002 if lod < 3 else 0.0, BONE, cseg=1)
    _m2.land(body, 'S', PORT, (0, -1, 0), 0.004, lod, mat=BONE)
    glass_k = Kit()
    glass(glass_k, lod, q)
    stream = Kit()
    if lod < 3:
        stream.cyl(0.00075, FOOT_H + CAP_T + 0.002, MID, TAN, (8, 6, 4)[lod])
    pieces = {'body': body, 'bulbs': glass_k, 'stream': stream}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.hourglass.graphite', (0, -CAP / 2, 2 * MID - FOOT_H - CAP_T / 2), (0, -1, 0), (0, 0, 1),
                        0.07, lift=0.0004),
    ])


def cavity(part, name, top):
    inset = WALL + 0.0035
    t_end = 0.15  # where the inset bulb radius reaches ~1.5 mm near the neck
    nb = 16
    st = [t_end + (1.0 - t_end) * i / nb for i in range(nb + 1)]
    prof = []
    for t in st:
        z = MID + (HALF * t if top else -HALF * t)
        z = min(z, MID + HALF - 0.0035) if top else max(z, MID - HALF + 0.0035)
        prof.append((max(0.0012, bulb_r(t) - inset), z))
    prof = sorted(prof, key=lambda p: p[1])
    z_lo, z_hi = prof[0][1], prof[-1][1]
    pts = [(0.0, z_lo, 'x')] + [(r, z, 'x') for r, z in prof] + [(0.0, z_hi, 'x')]
    k = Kit()
    k.lathe(kit.dedupe(pts), 40)
    return _m4.cavity(part, name, k, 'sand')


def main(out_path=None):
    part = kit.Part(
        TYPE, 'matter', 'S', '1,2,1', 0.5, 'bottom', 2800,
        'Sand timer (dynamic, upright on the floor; the engine takes the COM from the shapes): kn_poly_clear bulbs '
        '(Ø 0.075, neck Ø 0.008, 2 mm wall) lathed as one shell between identical kn_powder_bone caps (0.10 square, '
        '18 mm, FOOT_S on both outer faces), three kn_anod_beam pillars (Ø 0.01 at r 0.044), bone neck collar with '
        'the PR-S signal `out` boss (-Y, mid-height), hourglass__stream (Ø 1.5 mm kn_paper_tan thread: the engine '
        'sets its length to the pile and hides it when not flowing). CAVITY__top / CAVITY__bottom (sand): the timer '
        'fill, never Matter grains. Name plate on the top cap front. Brief: docs/art/briefs/matter.md#hourglass.',
        MASTERS, skins='classic,night', hints={'kn_duration_default': 10.0})
    part.build_lods(build, lod0_q=1.6)
    part.col_box('cap_bottom', (CAP, CAP, 0.022), (0, 0, 0.011), phys='powder', restitution=0.2)
    part.col_box('cap_top', (CAP, CAP, 0.022), (0, 0, 0.189), phys='powder', restitution=0.2)
    pts = [(0.0375 * math.cos(2 * math.pi * i / 20), 0.0375 * math.sin(2 * math.pi * i / 20), z)
           for i in range(20) for z in (0.022, 0.178)]
    part.col_hull('bulbs', pts, phys='glass', restitution=0.2)
    part.port('signal', 'out', PORT, (0, -1, 0), 'S', 'out')
    part.emit('stream', 'neck', (0, 0, MID), (0, 0, -1))
    cavity(part, 'top', True)
    cavity(part, 'bottom', False)
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
