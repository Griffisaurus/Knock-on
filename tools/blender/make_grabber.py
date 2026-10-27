"""Procedurally build the GRABBER source file (docs/art/briefs/drive.md, "GRABBER: Desktop robot arm").

Usage: blender -b --factory-startup -P tools/blender/make_grabber.py -- [out.blend]
Default output: assets/src/drive/grabber.blend

A friendly desktop robot arm in its upright park pose (0.20 x 0.50 x 0.20). A 0.19 x 0.19 x 0.06 kn_powder_graphite
plinth on FOOT_M (front: PR-M power `in` (-0.045, -0.096, 0.032) and PR-S signal `go` (0.050, -0.096, 0.032), the
port names of defs_m5.ts; top: the zone A / B LED dots with their letters, groups 2 / 3; back: name plate) carries the
Ø 0.15 graphite turntable on PIVOT__yaw (z, ±180°) with the shoulder yoke and the status LED (group 0). The pivot chain
nests yaw > shoulder (x, z 0.10, -15...105°) > elbow (x, z 0.27, ±140°) > wrist_pitch (x, z 0.42, ±110°) > wrist_roll
(z, ±180°) > finger_l / finger_r (slides along x, 0.01-0.04 m = half the grip width, modelled at the 0.06 default grip:
`rest` 0.03). kn_powder_ignition links (upper arm 0.17, forearm 0.15) between graphite joint housings whose kn_poly_clear
caps show kn_steel_brushed servo gears; the wrist carries the kn_led holding ring (group 1); the gripper palm and two
graphite fingers with kn_rubber_grip pads reach the tips at z 0.495. Device RIG (ASSET_PIPELINE §3.9): root + pivot
mirrors (yaw, shoulder, elbow, wrist_pitch, wrist_roll) for the IK playback, socket_grip (between the fingers) and
socket_tip, each following its pivot. Clips grabber__idle (4 s scan), grabber__park (1.0 s), grabber__shrug (1.5 s).
No face or eyes: a tool with charm, not a critter.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
import _m5  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'grabber'
G, IGN, CLEAR, STEEL, RUBBER, GRIP, LED = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_poly_clear', 'kn_steel_brushed', 'kn_rubber', 'kn_rubber_grip',
    'kn_led')
MASTERS = [G, IGN, CLEAR, STEEL, RUBBER, GRIP, LED, 'kn_decal', 'kn_powder_bone']
PL, PL_Z1 = 0.19, 0.060
TT_R, TT_Z1 = 0.075, 0.090
SHOULDER, ELBOW, WRIST = 0.10, 0.27, 0.42
PALM_Z0, PALM_Z1, TIP = 0.4335, 0.452, 0.495
GRIP_HALF = 0.03                     # modelled at the default grip 0.06 (finger pivots rest = 0.03)
FX = GRIP_HALF + 0.004               # finger box centre (defs_m5 grabberLinks)
PORT_P, PORT_S = (-0.045, -0.096, 0.032), (0.050, -0.096, 0.032)


def gear(k, centre, axis, r, teeth, q, lod, th=0.0025):
    """A small spur gear (steel) facing `axis` at `centre`: a toothed prism plus a hub."""
    if lod >= 2:
        k.cyl(r, -th / 2, th / 2, STEEL, 8, m=kit.frame(centre, axis))
        return
    pts = []
    n = teeth * 4
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r if (i % 4) in (1, 2) else r * 0.82
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    k.prism(pts, -th / 2, th / 2, STEEL, m=kit.frame(centre, axis))
    k.cyl(r * 0.35, -th / 2 - 0.0008, th / 2 + 0.0008, STEEL, seg(10, q, 6), m=kit.frame(centre, axis))


def joint(k, z, r, half, q, lod, caps=True, cap_r=None):
    """Graphite joint housing along X at height z (x from -half to +half), with clear caps over servo gears."""
    n = seg(32, q, 8, 2)
    k.cyl(r, -half, half, G, n, bev=0.003 if lod < 2 else 0.0, bseg=(2, 1, 1, 1)[lod],
          m=kit.frame((0, 0, z), (1, 0, 0)))
    if not caps or lod >= 3:
        return
    cr = cap_r or r * 0.72
    for sx in (-1, 1):
        c = Vector((sx * half, 0, z))
        gear(k, tuple(c + Vector((sx * 0.0018, 0, 0))), (sx, 0, 0), cr * 0.78, 10, q, lod)
        k.sphere(cr, CLEAR, seg(20, q, 8), (6, 4, 3)[lod], m=kit.frame(tuple(c), (sx, 0, 0)), sz_bot=0.05, sz_top=0.42)


def link(k, z0, z1, w0, d0, w1, d1, q, lod):
    """Ignition arm link from z0 to z1: a pillowed super-ellipse loft that tapers, with rounded ends."""
    ns = seg(28, q, 8, 4)
    rings = []
    steps = (6, 4, 3, 2)[lod]
    for i in range(steps + 1):
        t = i / steps
        w, d = w0 + (w1 - w0) * t, d0 + (d1 - d0) * t
        rings.append(_m4.ring(_m4.superellipse(w / 2, d / 2, 3.2, ns), z0 + (z1 - z0) * t))
    _m4.loft(k, rings, IGN)


def cable(k, z0, z1, y0, bulge, q, lod):
    """A rubber servo cable along the back of a link, clipped at both ends (LOD0-1)."""
    if lod >= 2:
        return
    pts = _m4.smooth_path([(0.0, y0, z0), (0.0, y0 + bulge, z0 + (z1 - z0) * 0.3),
                           (0.0, y0 + bulge, z0 + (z1 - z0) * 0.7), (0.0, y0, z1)], (5, 3)[lod])
    k.sweep(pts, 0.0032, (8, 6)[lod], RUBBER)
    for z in (z0, z1):
        k.rbox((0.012, 0.006, 0.006), (0.0, y0 - 0.001, z), 0.0015, G, cseg=1, rz=0.0015)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.rbox((PL, PL, PL_Z1 - 0.004), (0, 0, 0.004 + (PL_Z1 - 0.004) / 2), 0.012 if lod < 3 else 0.004, G, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.075, sy * 0.075, min(1.0, q), lod)
    for sx in (-1, 1):  # back corners
        _m2.screw(body, 'M5', (sx * 0.079, 0.079, PL_Z1), (0, 0, 1), q, lod)
    for sx in (-1, 1):  # zone A (left) / B (right) dots
        _m2.led_dome(body, 6, (sx * 0.070, -0.070, PL_Z1), (0, 0, 1), q, lod)
    body.colors['led'] = _m2.led_attr(lambda c, nn: (2, 0.0) if c.x < 0 else (3, 0.0))
    # yaw: turntable, shoulder yoke, status LED
    yaw = Kit(pivot='PIVOT__yaw')
    n = seg(56, q, 12, 4)
    yaw.cyl(TT_R, PL_Z1 - 0.001, TT_Z1, G, n, bev=0.004 if lod < 3 else 0.0, bseg=cs, bev_bot=0.0)
    for sx in (-1, 1):
        yaw.rbox((0.012, 0.050, 0.046), (sx * 0.034, 0, TT_Z1 + 0.012), 0.005 if lod < 3 else 0.0, G, cseg=cs,
                 rz=0.0)
        yaw.cyl(0.025, -0.006, 0.006, G, n // 2, m=kit.frame((sx * 0.034, 0, SHOULDER), (1, 0, 0)))
        if lod < 3:
            c = Vector((sx * 0.040, 0, SHOULDER))
            gear(yaw, tuple(c + Vector((sx * 0.0018, 0, 0))), (sx, 0, 0), 0.0135, 12, q, lod)
            yaw.sphere(0.017, CLEAR, seg(20, q, 8), (6, 4, 3)[lod], m=kit.frame(tuple(c), (sx, 0, 0)), sz_bot=0.05,
                       sz_top=0.42)
    _m2.led_dome(yaw, 8, (0, -TT_R, (PL_Z1 + TT_Z1) / 2), (0, -1, 0), q, lod)
    yaw.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # shoulder: hub + upper arm
    sh = Kit(pivot='PIVOT__shoulder')
    joint(sh, SHOULDER, 0.022, 0.028, q, lod, caps=False)
    link(sh, SHOULDER + 0.012, ELBOW - 0.010, 0.046, 0.036, 0.040, 0.032, q, lod)
    cable(sh, SHOULDER + 0.030, ELBOW - 0.022, 0.0185, 0.007, q, lod)
    # elbow: housing + forearm
    el = Kit(pivot='PIVOT__elbow')
    joint(el, ELBOW, 0.021, 0.030, q, lod)
    link(el, ELBOW + 0.012, WRIST - 0.010, 0.038, 0.030, 0.032, 0.027, q, lod)
    cable(el, ELBOW + 0.028, WRIST - 0.022, 0.0150, 0.006, q, lod)
    # wrist pitch housing
    wp = Kit(pivot='PIVOT__wrist_pitch')
    joint(wp, WRIST, 0.0165, 0.024, q, lod, cap_r=0.012)
    # wrist roll: disc with the holding LED ring, palm
    wr = Kit(pivot='PIVOT__wrist_roll')
    wr.cyl(0.022, WRIST + 0.010, PALM_Z0 + 0.002, G, n // 2, bev=0.002 if lod < 2 else 0.0, bseg=1)
    wr.lathe([(0.0215, WRIST + 0.0135, LED), (0.0234, WRIST + 0.0135, LED), (0.0234, WRIST + 0.0175, LED),
              (0.0215, WRIST + 0.0175, LED)], n // 2, closed=True)
    wr.colors['led'] = _m2.led_attr(lambda c, nn: (1, 0.0))
    wr.rbox((0.050, 0.040, PALM_Z1 - PALM_Z0), (0, 0, (PALM_Z0 + PALM_Z1) / 2), 0.006 if lod < 3 else 0.0, G,
            cseg=cs, rz=0.003 if lod < 3 else 0.0)
    if lod < 2:  # finger guide rail on the palm top
        wr.rbox((0.074, 0.010, 0.004), (0, 0, PALM_Z1 + 0.0015), 0.002, STEEL, cseg=1, rz=0.001)
    fingers = {}
    for name, sx in (('finger_l', -1), ('finger_r', 1)):
        f = Kit(pivot='PIVOT__' + name)
        f.rbox((0.008, 0.030, TIP - PALM_Z1 + 0.002), (sx * FX, 0, (PALM_Z1 - 0.002 + TIP) / 2), 0.0025 if lod < 3
               else 0.0, G, cseg=max(1, cs - 1), rz=0.003 if lod < 3 else 0.0)
        if lod < 3:  # rubber grip pad on the inner face
            f.rbox((0.0024, 0.024, 0.030), (sx * (FX - 0.0045), 0, TIP - 0.019), 0.0008 if lod < 2 else 0.0, GRIP,
                   cseg=1, rz=0.0008 if lod < 2 else 0.0)
        fingers[name] = f
    pieces = {'body': body, 'turntable': yaw, 'upper_arm': sh, 'forearm': el, 'wrist': wp, 'gripper': wr}
    pieces.update(fingers)
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.grabber.bone', (0, PL / 2, 0.032), (0, 1, 0), (0, 0, 1), 0.09),
        kit.decal_plane('picto.rotating_parts.mono', (PL / 2, 0, 0.032), (1, 0, 0), (0, 0, 1), 0.034, 0.034),
        kit.decal_plane('trim.marks_m5', (-0.084, -0.054, PL_Z1), (0, 0, 1), (0, 1, 0), 0.013, 0.0125,
                        sub=_m5.marks5('letter_a')),
        kit.decal_plane('trim.marks_m5', (0.084, -0.054, PL_Z1), (0, 0, 1), (0, 1, 0), 0.013, 0.0125,
                        sub=_m5.marks5('letter_b')),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'L', '2,5,2', 3.5, 'bottom', 20000,
        'Desktop robot arm in its upright park pose: kn_powder_graphite plinth 0.19 x 0.19 x 0.06 on FOOT_M (PR-M power '
        'in, PR-S signal go, zone A / B LED dots + letters, groups 2 / 3; name plate back, rotating-parts pictogram '
        'right); Ø 0.15 turntable + shoulder yoke on PIVOT__yaw (status LED group 0); kn_powder_ignition upper arm '
        '(0.17) on PIVOT__shoulder (x, z 0.10), forearm (0.15) on PIVOT__elbow (x, z 0.27), graphite joint housings with '
        'kn_poly_clear caps over kn_steel_brushed servo gears; PIVOT__wrist_pitch (x, z 0.42) > PIVOT__wrist_roll (z, '
        'kn_led holding ring group 1, palm) > PIVOT__finger_l / _r (x slides 0.01-0.04 = half grip, rest 0.03; '
        'kn_rubber_grip pads; tips z 0.495). RIG: root + pivot mirrors + socket_grip / socket_tip for the IK playback. '
        'Clips grabber__idle / park / shrug. Skin lab = kn_powder_bone links. '
        'Brief: docs/art/briefs/drive.md#grabber.',
        MASTERS, led_groups='0:status,1:holding,2:zone_a,3:zone_b', skins='factory,lab',
        hints={'kn_reach': 0.39, 'kn_payload_max': 1.0})
    part.pivot('yaw', (0, 0, 0), 'z', -180.0, 180.0, motion='turn')
    part.pivot('shoulder', (0, 0, SHOULDER), 'x', -15.0, 105.0, motion='turn')
    part.pivot('elbow', (0, 0, ELBOW), 'x', -140.0, 140.0, motion='turn')
    part.pivot('wrist_pitch', (0, 0, WRIST), 'x', -110.0, 110.0, motion='turn')
    part.pivot('wrist_roll', (0, 0, WRIST), 'z', -180.0, 180.0, motion='turn')
    part.pivot('finger_r', (FX - 0.004, 0, PALM_Z1), 'x', 0.01, 0.04, motion='slide', rest=GRIP_HALF)
    fl = part.pivot('finger_l', (-FX + 0.004, 0, PALM_Z1), 'x', 0.01, 0.04, motion='slide', rest=GRIP_HALF)
    part.pivots[fl].rotation_euler = (0.0, 0.0, math.pi)  # local +x points -X: opening moves the left finger left
    for child, parent in (('shoulder', 'yaw'), ('elbow', 'shoulder'), ('wrist_pitch', 'elbow'),
                          ('wrist_roll', 'wrist_pitch'), ('finger_l', 'wrist_roll'), ('finger_r', 'wrist_roll')):
        _m2.nest(part, child, parent)
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.0)
    part.col_box('plinth', (PL, PL, PL_Z1), (0, 0, PL_Z1 / 2), phys='powder')
    _m2.under(part, part.col_cyl('turntable', TT_R, TT_Z1 - PL_Z1, (0, 0, (PL_Z1 + TT_Z1) / 2), 'z', phys='powder'),
              'yaw')
    _m2.under(part, part.col_capsule('upper', 0.02, 0.17, (0, 0, SHOULDER + 0.085), 'z', phys='powder'), 'shoulder')
    _m2.under(part, part.col_capsule('fore', 0.0175, 0.15, (0, 0, ELBOW + 0.075), 'z', phys='powder'), 'elbow')
    _m2.under(part, part.col_box('gripper', (0.05, 0.04, 0.03), (0, 0, WRIST + 0.015), phys='powder'), 'wrist_roll')
    _m2.under(part, part.col_box('finger_l', (0.008, 0.03, 0.045), (-FX, 0, WRIST + 0.0525), phys='rubber'),
              'finger_l')
    _m2.under(part, part.col_box('finger_r', (0.008, 0.03, 0.045), (FX, 0, WRIST + 0.0525), phys='rubber'),
              'finger_r')
    _m2.under(part, part.sensor('catch', 'jaw', [(x * 0.03, y * 0.015, WRIST + 0.0525 + z * 0.02) for x in (-1, 1)
                                                 for y in (-1, 1) for z in (-1, 1)]), 'wrist_roll')
    part.port('power', 'in', PORT_P, (0, -1, 0), 'M', 'in')
    part.port('signal', 'go', PORT_S, (0, -1, 0), 'S', 'in')
    _m2.under(part, part.emit('fault', 'gripper', (0, 0, TIP), (0, 0, 1)), 'wrist_roll')
    _m2.socket_rig(part, [
        ('root', (0, 0, 0), (0, 0, 1), None, None),
        ('yaw', (0, 0, TT_Z1), (0, 0, 1), 'root', 'yaw'),
        ('shoulder', (0, 0, SHOULDER), (0, 0, 1), 'yaw', 'shoulder'),
        ('elbow', (0, 0, ELBOW), (0, 0, 1), 'shoulder', 'elbow'),
        ('wrist_pitch', (0, 0, WRIST), (0, 0, 1), 'elbow', 'wrist_pitch'),
        ('wrist_roll', (0, 0, WRIST + 0.012), (0, 0, 1), 'wrist_pitch', 'wrist_roll'),
        ('socket_grip', (0, 0, WRIST + 0.0525), (0, 0, 1), 'wrist_roll', 'wrist_roll'),
        ('socket_tip', (0, 0, TIP), (0, 0, 1), 'wrist_roll', 'wrist_roll'),
    ])
    _m2.clip(part, 'idle', {'yaw': [(0.0, 0.0), (1.0, 28.0), (2.0, 0.0), (3.0, -28.0), (4.0, 0.0)],
                            'wrist_pitch': [(0.0, 0.0), (0.5, 12.0), (1.5, 12.0), (2.0, 0.0), (2.5, 12.0),
                                            (3.5, 12.0), (4.0, 0.0)]})
    _m2.clip(part, 'park', {'shoulder': [(0.0, 40.0), (1.0, 0.0)], 'elbow': [(0.0, 70.0), (1.0, 0.0)],
                            'wrist_pitch': [(0.0, 50.0), (1.0, 0.0)], 'yaw': [(0.0, 45.0), (1.0, 0.0)]})
    _m2.clip(part, 'shrug', {'elbow': [(0.0, 0.0), (0.3, 18.0), (0.6, -6.0), (0.9, 12.0), (1.5, 0.0)],
                             'wrist_pitch': [(0.0, 0.0), (0.3, -25.0), (0.9, -25.0), (1.5, 0.0)],
                             'wrist_roll': [(0.0, 0.0), (0.4, 25.0), (0.8, -25.0), (1.2, 10.0), (1.5, 0.0)],
                             'finger_l': [(0.0, 0.0), (0.4, -0.01), (1.1, -0.01), (1.5, 0.0)],
                             'finger_r': [(0.0, 0.0), (0.4, 0.01), (1.1, 0.01), (1.5, 0.0)]})
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
