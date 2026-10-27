"""Procedurally build the RIFT GATES source file (docs/art/briefs/future.md, "RIFT GATES: Paired single-sided portal
frames"). One art type, placed twice; the pair colour is a property that the engine applies to the LED groups.

Usage: blender -b --factory-startup -P tools/blender/make_rift_gate.py -- [out.blend]
Default output: assets/src/future/rift_gate.blend

A slim upright kn_powder_graphite ring (outer Ø 0.39 centred at z 0.205, radial section 0.040 x 0.050, aperture
Ø 0.31) with a kn_anod_plasma inner lip, cradled by a 0.20 x 0.05 x 0.025 graphite plinth on four rubber feet. The
active side is the front (-Y): 16 kn_led pair-ring segments on the front face (group 0, pair colour, chase), a thin
kn_led cooldown ring on the lip chamfer (group 1), the counter-rotating kn_anod_plasma trim ring with 12 lugs on
PIVOT__trim_ring (y, continuous) and the SCREEN__membrane disc (Ø 0.31 at y -0.004, kn_screen icon: the engine's
swirl). The back is a closed graphite backplate (Ø 0.316 x 0.006 at y 0.019-0.025) with the name plate, the pair
glyph and 4 M3 screws, so the active side is never ambiguous. A plasma chevron inlay on the ring top marks the front.
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

TYPE = 'rift_gate'
G, PLASMA, RUBBER, LED, SCREEN, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_rubber', 'kn_led', 'kn_screen', 'kn_steel_brushed')
MASTERS = [G, PLASMA, RUBBER, LED, SCREEN, STEEL, 'kn_decal']
C = Vector((0.0, 0.0, 0.205))
R_IN, R_OUT, HALF_D = 0.155, 0.195, 0.025
M_RING = kit.at(*C) @ kit.FRONT_OUT    # local z -> -Y (out of the front), local (x, y) -> Blender (x, z)
TRIM_H = 0.010                         # trim ring plane, y -0.010
MEMB_H = 0.004                         # membrane plane, y -0.004
BP_Y0, BP_Y1, BP_R = 0.019, 0.025, 0.158


def ring_profile(lod):
    """Closed ring section (r, h, master) with h = -y (front positive), walked bore -> back -> outer -> front."""
    b = (0.006, 0.006, 0.004, 0.0)[lod]
    ch = 0.006 if lod < 3 else 0.004
    bs = (3, 2, 1, 1)[lod]
    gd = 0.0055 if lod < 3 else 0.0          # the trim ring runs in a groove in the bore (clear of the aperture)
    pts = [(R_IN, HALF_D - ch, PLASMA)]
    if gd:
        pts += [(R_IN, TRIM_H + 0.0045, PLASMA), (R_IN + gd, TRIM_H + 0.0045, PLASMA),
                (R_IN + gd, TRIM_H - 0.0045, PLASMA), (R_IN, TRIM_H - 0.0045, PLASMA)]
    pts += [(R_IN, -HALF_D + 0.003, G), (R_IN + 0.003, -HALF_D, G)]
    if b > 0:
        for k in range(bs + 1):
            a = math.pi / 2 * k / bs
            pts.append((R_OUT - b + b * math.sin(a), -HALF_D + b - b * math.cos(a), G))
        for k in range(bs + 1):
            a = math.pi / 2 * k / bs
            pts.append((R_OUT - b + b * math.cos(a), HALF_D - b + b * math.sin(a), G if k < bs else PLASMA))
    else:
        pts += [(R_OUT, -HALF_D, G), (R_OUT, HALF_D, G)]
    pts.append((R_IN + ch, HALF_D, PLASMA))
    # strip materials: the strip from point i to i+1 takes point i's master; front face graphite, chamfer plasma
    fixed = []
    for i, (r, h, m) in enumerate(pts):
        fixed.append((r, h, m))
    fixed[-2] = (fixed[-2][0], fixed[-2][1], G)          # last rounding point -> front face is graphite
    fixed[-1] = (fixed[-1][0], fixed[-1][1], PLASMA)     # front face end -> chamfer (closing strip) plasma
    return kit.dedupe(fixed)


def build(lod, q, mats):
    n = seg(112, q, 16, 8)
    ring = Kit()
    ring.lathe(ring_profile(lod), n, M_RING, closed=True)
    # pair-ring LED segments on the front face (half a step off the top so the chevron sits in a gap)
    nseg = 16
    span = 360.0 / nseg
    if lod < 3:
        for i in range(nseg):
            a0 = math.radians(span * (i + 0.5) - span / 2 + 2.6)
            a1 = math.radians(span * (i + 0.5) + span / 2 - 2.6)
            prof = [(0.170, HALF_D - 0.0006, LED), (0.186, HALF_D - 0.0006, LED), (0.186, HALF_D + 0.0012, LED),
                    (0.170, HALF_D + 0.0012, LED)]
            ring.lathe_arc(prof, a0, a1, (4, 3, 2)[lod], m=M_RING)
        # cooldown ring on the lip chamfer
        ring.torus(0.1588, 0.0013, LED, n, (6, 4, 3)[lod], m=M_RING @ kit.at(0, 0, HALF_D - 0.0028))
    else:
        ring.lathe([(0.170, HALF_D - 0.0006, LED), (0.186, HALF_D - 0.0006, LED), (0.186, HALF_D + 0.0012, LED),
                    (0.170, HALF_D + 0.0012, LED)], 16, M_RING, closed=True)
    # front chevron inlay on the ring top (points to the active side)
    top = C.z + R_OUT
    if lod < 3:
        ring.hull([(sx * 0.008, 0.002, top - 0.0012) for sx in (-1, 1)] + [(0.0, -0.013, top - 0.0012)] +
                  [(sx * 0.008, 0.002, top + 0.0009) for sx in (-1, 1)] + [(0.0, -0.013, top + 0.0009)], PLASMA)
    ring.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08) if math.hypot(c.x, c.z - C.z) > 0.165 else (1, 0.0))
    # plinth cradling the ring bottom, on four feet
    body = Kit()
    cs = (3, 2, 1, 1)[lod]
    body.rbox((0.20, 0.05, 0.025), (0, 0, 0.004 + 0.0125), 0.006 if lod < 3 else 0.0, G, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'S', sx * 0.082, sy * 0.014, min(1.0, q), lod)
    # backplate set into the rear lip, 4 M3 screws
    body.cyl(BP_R, BP_Y0, BP_Y1, G, n, bev=0.0015 if lod < 2 else 0.0, bseg=1, bev_bot=0.0,
             m=kit.frame(tuple(C), (0, 1, 0)))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        _m2.screw(body, 'M3', (C.x + 0.125 * math.cos(a), BP_Y1, C.z + 0.125 * math.sin(a)), (0, 1, 0), q, lod)
    # counter-rotating trim ring with lugs
    trim = Kit(pivot='PIVOT__trim_ring')
    tr_m = M_RING @ kit.at(0, 0, TRIM_H)
    trim.torus(0.1586, 0.0026, PLASMA, n, (8, 6, 4, 3)[lod], m=tr_m)
    if lod < 3:
        for k in range(12):
            a = 2 * math.pi * k / 12
            trim.rbox((0.0046, 0.009, 0.0062), (0.1586, 0, 0), 0.0015 if lod < 2 else 0.0, PLASMA, cseg=1,
                      m=tr_m @ kit.rot_z(math.degrees(a)))
    # membrane: a kn_screen disc with planar 0-1 UVs (u along +X, v along +Z), facing -Y
    memb = Kit()
    bm = memb.bm
    uvl = bm.loops.layers.uv.verify()
    mi = memb.mi(SCREEN)
    nm = max(16, n // 2 // 4 * 4)
    ctr = bm.verts.new((C.x, -MEMB_H, C.z))
    rim = []
    for i in range(nm):
        a = 2 * math.pi * i / nm
        rim.append(bm.verts.new((C.x + R_IN * math.cos(a), -MEMB_H, C.z + R_IN * math.sin(a))))
    for i in range(nm):
        j = (i + 1) % nm
        f = bm.faces.new((ctr, rim[i], rim[j]))
        f.material_index = mi
        for loop in f.loops:
            p = loop.vert.co
            gu, gv = 0.5 + (p.x - C.x) / (2 * R_IN), 0.5 + (p.z - C.z) / (2 * R_IN)
            loop[uvl].uv = (gu, 1.0 - gv)
    pieces = {'ring': ring, 'body': body, 'trim': trim, 'screen_membrane': memb}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.rift_gate.bone', (0, BP_Y1, C.z + 0.040), (0, 1, 0), (0, 0, 1), 0.13),
        kit.decal_plane('trim.marks_m5', (0, BP_Y1, C.z - 0.035), (0, 1, 0), (0, 0, 1), 0.045, 0.0425,
                        sub=_m5.marks5('pair')),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'L', '4,4,0.5', 4.5, 'bottom', 12000,
        'Paired single-sided portal frame: kn_powder_graphite ring (outer Ø 0.39 at z 0.205, section 0.040 x 0.050, '
        'aperture Ø 0.31) with a kn_anod_plasma lip chamfer, on a 0.20 x 0.05 x 0.025 plinth with FOOT_S. Front: 16 '
        'kn_led pair-ring segments (group 0, pair colour), kn_led cooldown ring on the lip (group 1), kn_anod_plasma '
        'trim ring with 12 lugs on PIVOT__trim_ring (y, continuous), SCREEN__membrane disc (icon, engine swirl / live '
        'partner view). Back: closed graphite backplate (Ø 0.316 x 0.006, y 0.019-0.025), name plate, pair glyph, '
        '4 M3. Plasma chevron on the ring top marks the front. The pair colour is a property (plasma, beam, amber, '
        'volt, cobalt, ignition) the engine applies to the LED groups. Brief: docs/art/briefs/future.md#rift-gates.',
        MASTERS, led_groups='0:pair_ring,1:cooldown', skins='classic',
        hints={'kn_pair_colours': 'plasma,beam,amber,volt,cobalt,ignition', 'kn_aperture': 0.31})
    part.pivot('trim_ring', (C.x, -TRIM_H, C.z), 'y', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=3.0)
    _m5.ring_cols(part, 8, (C.x, 0.0, C.z), 0.175, 0.155, 0.050, 0.040, start_deg=22.5, phys='powder',
                  restitution=0.3, friction=0.4)
    part.col_box('8', (0.20, 0.05, 0.025), (0, 0, 0.004 + 0.0125), phys='powder')
    part.col_cyl('9', 0.155, 0.006, (C.x, 0.022, C.z), 'y', phys='powder', restitution=0.3, friction=0.4)
    part.sensor('trigger', 'aperture', _m4.cyl_points(0.15, -0.025, -0.005, 24, cx=C.x, cy=C.z, axis='y'),
                transit_cooldown=0.25)
    part.emit('exit', 'aperture', (C.x, -0.030, C.z), (0, -1, 0))
    part.emit('warp', 'rim', (C.x, -0.030, C.z), (0, -1, 0))
    part.emit('hum', 'core', tuple(C), (0, -1, 0))
    part.screen('membrane', 2 * R_IN, 2 * R_IN, (C.x, -MEMB_H, C.z), (0, -1, 0), (0, 0, 1), kind='icon',
                color='plasma')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
