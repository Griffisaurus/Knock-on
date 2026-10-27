"""Procedurally build the MOTOR source file (docs/art/briefs/drive.md, "MOTOR: Clear-shell electric motor").

Usage: blender -b --factory-startup -P tools/blender/make_motor.py -- [out.blend]
Default output: assets/src/drive/motor.blend

The approved look-dev motor() scaled to 2x2x2: two pillowed graphite end caps (0.05 x 0.19 x 0.19, 7 mm),
a kn_poly_clear shell (0.15 x 0.175 x 0.175), Ignition field magnets top and bottom (1.5 mm clear of the
windings), and the armature under PIVOT__armature (axis x, on the spin port): a 3-slot steel core, 14
copper winding bands (R 0.057, r 0.005, x -0.048...+0.048) split at the three slots so rotation reads,
a 6-segment brass commutator and a chrome shaft (Ø 7.6 mm) with a hex coupler out through the PR-M ring.
Feet are two 5 mm rubber bars (FOOT_BAR5); 4 M5 screws per cap front; Ø 8 mm status LED on the right cap.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'motor'
CZ = 0.100                      # armature axis height
CAP_X, CAP_W, CAP_H = 0.075, 0.05, 0.19
SHELL = (0.15, 0.175, 0.175)
WIND_R, WIND_r, WIND_N, WIND_X = 0.057, 0.005, 14, 0.048
CORE_R = 0.050
SLOT_GAP = math.radians(20)
SHAFT_R, SHAFT_X0, SHAFT_X1 = 0.0038, -0.070, 0.108
G, IGN, STEEL, COPPER, BRASS, CHROME, POLY, RUBBER, LED = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_steel_brushed', 'kn_copper', 'kn_brass', 'kn_chrome',
    'kn_poly_clear', 'kn_rubber', 'kn_led')
MASTERS = [G, IGN, STEEL, COPPER, BRASS, CHROME, POLY, RUBBER, LED]
AXIS = kit.at(0, 0, CZ) @ kit.X_AXIS   # local z = +X, local (x, y) = Blender (y, z), centred on the shaft


def winding_profile(k):
    """Closed (r, h) outline of the 14 overlapping band tori: scalloped outside, flat at the inner radius."""
    d = 2 * WIND_X / (WIND_N - 1)
    tj = math.asin(min(1.0, d / 2 / WIND_r))
    pts = []

    def band(c, t0, t1, n):
        for i in range(n + 1):
            t = t0 + (t1 - t0) * i / n
            pts.append((WIND_R + WIND_r * math.cos(t), c + WIND_r * math.sin(t), COPPER))
    cs = [-WIND_X + i * d for i in range(WIND_N)]
    band(cs[0], -math.pi, -tj, 2 + k)
    for c in cs[1:-1]:
        pts.pop()
        band(c, -tj, tj, k + 1)
    pts.pop()
    band(cs[-1], -tj, math.pi, 2 + k)
    return kit.dedupe(pts)


def slotted_core(n):
    """Core outline: circle r 0.05 with three 8 mm x 7 mm slots, CCW from the first slot."""
    w, rin = 0.004, CORE_R - 0.007
    ws = math.asin(w / CORE_R)
    m = max(2, n // 3)
    pts = []
    for s in range(3):
        a = math.pi / 2 + 2 * math.pi * s / 3
        for rr, off in ((CORE_R, -w), (rin, -w), (rin, w), (CORE_R, w)):
            x = math.sqrt(rr * rr - off * off)
            pts.append((x * math.cos(a) - off * math.sin(a), x * math.sin(a) + off * math.cos(a)))
        for i in range(1, m):
            t = a + ws + (2 * math.pi / 3 - 2 * ws) * i / m
            pts.append((CORE_R * math.cos(t), CORE_R * math.sin(t)))
    return pts


def build(lod, q):
    body = Kit()
    cseg = (4, 3, 2, 1)[lod]
    for s in (-1, 1):
        body.rbox((CAP_W, CAP_H, CAP_H), (s * CAP_X, 0, CZ), 0.007, G, cseg=cseg)
    body.rbox(SHELL, (0, 0, CZ), 0.012 if lod < 3 else 0.006, POLY, cseg=cseg)
    if lod < 3:
        for s in (-1, 1):  # field magnets, inner faces 1.5 mm clear of the windings
            body.rbox((0.1, 0.1, 0.017), (0, 0, CZ + s * 0.0720), 0.003, IGN, cseg=max(1, cseg - 1))
        for s in (-1, 1):  # FOOT_BAR5 under each cap
            body.rbox((0.03, 0.15, 0.0055), (s * CAP_X, 0, 0.00275), 0.002, RUBBER, cseg=max(1, cseg - 2))
    else:
        for s in (-1, 1):
            body.rbox((0.1, 0.1, 0.017), (0, 0, CZ + s * 0.0720), 0.0, IGN, cseg=0)
    if lod < 2:  # M5 button heads, 4 per cap front (y = -0.095)
        hs = seg(14, q, 6)
        prof = [(0.0, -0.0006, STEEL), (0.00425, -0.0006, STEEL), (0.00425, 0.0007, STEEL), (0.0036, 0.0017, STEEL),
                (0.0021, 0.0024, STEEL), (0.0, 0.0026, STEEL)]
        for s in (-1, 1):
            for dx in (-0.0125, 0.0125):
                for z in (0.025, 0.175):
                    body.lathe(prof, hs, kit.frame((s * CAP_X + dx, -CAP_H / 2, z), '-y'))
    # status LED (LED_D8) on top of the right cap
    led_c = (CAP_X, -0.05, 0.195)
    if lod < 3:
        body.cyl(0.0055, -0.0005, 0.0012, STEEL, seg(16, q, 6), m=kit.at(*led_c))
    body.sphere(0.004, LED, seg(16, q, 4), (6, 4, 2, 2)[lod], m=kit.at(led_c[0], led_c[1], led_c[2] + 0.0008),
                sz_bot=0.25, sz_top=1.0)

    arm = Kit(pivot='PIVOT__armature')
    segs = seg(40, q, 6)
    if lod < 2:
        prof = winding_profile(1 if lod == 0 else 0)
        for g in range(3):
            a0 = math.pi / 2 + 2 * math.pi * g / 3 + SLOT_GAP / 2
            a1 = a0 + 2 * math.pi / 3 - SLOT_GAP
            arm.lathe_arc(prof, a0, a1, max(2, segs // 3), m=AXIS)
        arm.prism(slotted_core(seg(36, q, 9, 3)), -0.046, 0.050, STEEL, m=AXIS)
        cprof = [(0.011, -0.0495, BRASS), (0.016, -0.0495, BRASS), (0.016, -0.0455, BRASS), (0.011, -0.0455, BRASS)]
        for g in range(6):
            a0 = 2 * math.pi * g / 6 + math.radians(4)
            arm.lathe_arc(cprof, a0, a0 + math.radians(52), 3, m=AXIS)
    else:  # LOD2+: the interior becomes a copper cylinder (ignition slabs stay on the body)
        arm.cyl(WIND_R + WIND_r * 0.7, -WIND_X - WIND_r, WIND_X + WIND_r, COPPER, segs, m=AXIS)
    arm.cyl(SHAFT_R, SHAFT_X0, SHAFT_X1 - 0.008, CHROME, seg(14, q, 5), bev=0.0006 if lod < 2 else 0.0, bseg=1,
            m=AXIS)
    if lod < 3:  # hex coupler out through the spin port socket
        arm.prism(kit.outline_circle(0.0042, 6), 0.096, SHAFT_X1, CHROME, bt=0.0006 if lod < 2 else 0.0, bseg=1,
                  m=AXIS)
    # Right cap front: "MOTOR" name plate + "KN-07 · 24V · 1.5 rps" spec line (bone ink on graphite).
    n, up = (0, -1, 0), (0, 0, 1)
    decals = [kit.decal_plane('name.motor.bone', (CAP_X, -CAP_H / 2, 0.140), n, up, 0.032),
              kit.decal_plane('spec.motor.bone', (CAP_X, -CAP_H / 2, 0.1305), n, up, 0.032)]
    return kit.add_decals({'body': body, 'armature': arm}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'M', '2,2,2', 1.6, 'bottom', 8000,
        'Clear-shell motor: look-dev motor() at 2x2x2. Brief: docs/art/briefs/drive.md#motor. The winding '
        'bands are split at the three core slots so spin reads. Name plate + spec line decals on the right cap; '
        'shell thickness map deferred (no unique textures).',
        MASTERS, led_groups='0:status')
    part.pivot('armature', (0.101, 0.0, CZ), 'x')
    part.build_lods(build, lod0_q=1.25)
    part.col_box('body', (0.2, 0.19, 0.19), (0, 0, CZ), phys='powder', restitution=0.25, friction=0.5)
    part.col_cyl('shaft', 0.01, 0.03, (0.101, 0, CZ), 'x', phys='steel')
    part.port('power', 'in', (-CAP_X, -0.096, CZ), (0, -1, 0), 'S', 'in')
    part.port('spin', 'out', (0.101, 0.0, CZ), (1, 0, 0), 'M', 'out', kind='axle')
    part.emit('spark', 'brushes', (-0.060, 0.0, CZ), (0, 0, 1))
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
