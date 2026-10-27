"""Procedurally build the PEDAL RIG source file (docs/art/briefs/drive.md, "PEDAL RIG: Raccoon pedal drive").

Usage: blender -b --factory-startup -P tools/blender/make_pedal_rig.py -- [out.blend]
Default output: assets/src/drive/pedal_rig.blend

A raccoon-sized exercise bike, device and sockets only (Bandit is in critters.md); Bandit faces +X. Graphite
frame on two stabiliser bars (FOOT_L bumpers) and a centre beam: bottom-bracket shell at the crank axle (0.03, 0,
0.07), seat tube up to the rubber saddle (top (0, 0, 0.18), 73° seat angle), stem up to the handlebars (steel bar,
kn_rubber_grip grips at (0.13, +-0.07, 0.39)) with the console (8 kn_led timer segments + a lure-colour LED_D6, led
groups 0 timer / 1 lure_seen, name plate on its front) and a brass bell; a thin steel lure boom from the stem to
a graphite end puck at the tip (0.19, 0, 0.395) whose +X face carries the PR-S tension bait hook. PIVOT__crank (y)
carries the kn_anod_ignition chainring (Ø 0.09, 32 teeth on a 5-arm spider) and crank arms (0.035), with
PIVOT__pedal_l (+Y) / pedal_r nested under it. PIVOT__flywheel (y, (-0.13, -0.055, 0.08)) carries the Ø 0.12
flywheel (steel rim, 6 Ignition spokes) and its sprocket; a static steel collar on the hub front is the PR-M spin
out land. The chain is a static swept steel band (chainring <-> sprocket, plane y -0.0415; UV scroll + chain-link
normal deferred). The -Y side between crank and saddle stays clear (only the low chain run). Device RIG (9 bones).
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

TYPE = 'pedal_rig'
CRANK = Vector((0.03, 0.0, 0.07))
CRANK_R = 0.035
SADDLE_TOP = Vector((0.0, 0.0, 0.18))
GRIP_X, GRIP_Y, GRIP_Z = 0.13, 0.07, 0.39
FLY = Vector((-0.13, -0.055, 0.08))
FLY_R, FLY_T = 0.06, 0.016
BOOM_TIP = Vector((0.19, 0.0, 0.395))
BAIT = (0.195, 0.0, 0.385)
SPIN = (-0.13, -0.076, 0.08)
CHAIN_Y = -0.0415
RING_R, RING_TEETH = 0.045, 32           # chainring tip radius (Ø 0.09)
SPROCKET_R, SPROCKET_TEETH = 0.015, 11   # 3:1 to the chainring
ARM_Y = 0.052
PEDAL_Y = 0.077
PEDAL_L = Vector((CRANK.x - CRANK_R, PEDAL_Y, CRANK.z))    # left arm points -X at rest
PEDAL_R = Vector((CRANK.x + CRANK_R, -PEDAL_Y, CRANK.z))   # right arm points +X at rest
CONSOLE = Vector((0.128, 0.0, 0.392))  # top + LED dome stay under the 0.40 + 0.012 def bound
CONSOLE_S = (0.056, 0.056, 0.024)
PUCK_R, PUCK_X0 = 0.0165, 0.179            # graphite end puck: Ø 33 mm land for the PR-S ring (28)
G, STEEL, RUBBER, GRIP, ANOD, IGN, BRASS, LED = (
    'kn_powder_graphite', 'kn_steel_brushed', 'kn_rubber', 'kn_rubber_grip', 'kn_anod_ignition',
    'kn_powder_ignition', 'kn_brass', 'kn_led')
MASTERS = [G, STEEL, RUBBER, GRIP, ANOD, IGN, BRASS, LED, 'kn_decal']


def yframe(x, z):
    return kit.at(x, 0, z) @ kit.Y_AXIS


def led_group(c, n):
    return (1, 0.08) if c.y > 0.016 else (0, 0.08)


def tube(k, a, b, r, mat, sides):
    k.sweep([Vector(a), Vector(b)], r, sides, mat)


def belt_path(c1, r1, c2, r2, n1, n2):
    """Closed CCW outline (x, z) round two circles (r1 >= r2): open-belt external tangents."""
    c1, c2 = Vector(c1), Vector(c2)
    d = (c2 - c1).length
    phi = math.atan2(c2.y - c1.y, c2.x - c1.x)
    beta = math.acos((r1 - r2) / d)
    pts = []
    for i in range(n1 + 1):  # big wrap on circle 1, away from circle 2
        a = phi + beta + (2 * math.pi - 2 * beta) * i / n1
        pts.append((c1.x + r1 * math.cos(a), c1.y + r1 * math.sin(a)))
    for i in range(n2 + 1):  # small wrap on circle 2, facing away from circle 1
        a = phi - beta + 2 * beta * i / n2
        pts.append((c2.x + r2 * math.cos(a), c2.y + r2 * math.sin(a)))
    return pts


def toothed_ring(k, centre_xz, y, r_in, r_root, r_tip, teeth, thick, mat, q, lod):
    """Chainring / sprocket about +Y at plane y: a lathe annulus plus hull teeth (LOD2+: plain disc edge)."""
    m = yframe(*centre_xz)
    n = seg(teeth * 2, q, 12 if lod < 3 else 8)
    y0, y1 = y - thick / 2, y + thick / 2
    if lod >= 3:  # one plain annulus out to the tip
        k.lathe([(r_in, y0, mat), (r_tip, y0, mat), (r_tip, y1, mat), (r_in, y1, mat)], n, m, closed=True)
        return
    prof = [(r_in, y0, mat), (r_root, y0, mat), (r_root, y1, mat), (r_in, y1, mat)]
    k.lathe(prof, n, m, closed=True)
    if lod < 2:
        tw = 2 * math.pi * r_root / teeth
        for i in range(teeth):
            a = 2 * math.pi * (i + 0.5) / teeth
            u = Vector((math.cos(a), 0, math.sin(a)))
            t = Vector((-math.sin(a), 0, math.cos(a)))
            c = Vector((centre_xz[0], 0, centre_xz[1]))
            pts = []
            for rr, w in ((r_root - 0.0006, tw * 0.55), (r_tip, tw * 0.22)):
                for s in (-1, 1):
                    for yy in (y0 + 0.0004, y1 - 0.0004):
                        p = c + u * rr + t * (s * w / 2)
                        pts.append((p.x, yy, p.z))
            k.hull(pts, mat)
    else:
        k.lathe([(r_root, y0 + 0.0004, mat), (r_tip, y0 + 0.0008, mat), (r_tip, y1 - 0.0008, mat),
                 (r_root, y1 - 0.0004, mat)], n, m, closed=True)


def build(lod, q):
    cs = (3, 2, 1, 1)[lod]
    lo = 6 if lod < 3 else 4
    ts = (10, 8, 6, 4)[lod]
    body = Kit()
    body.colors['led'] = _m2.led_attr(led_group)
    # base: two stabiliser bars on FOOT_L bumpers + centre beam (rear bar kept low under the flywheel)
    for x, h in ((-0.16, 0.013), (0.14, 0.020)):
        body.rbox((0.028, 0.18, h), (x, 0, 0.005 + h / 2), 0.006, G, cseg=cs, rz=(0.004, 0.004, 0.003, 0.0)[lod])
        for y in (-0.072, 0.072):
            _m2.foot(body, 'L', x, y, q, lod, z0=0.0, top=0.0006)
        if lod < 2:
            for y in (-0.05, 0.05):
                _m2.screw(body, 'M5', (x, y, 0.005 + h), (0, 0, 1), q, lod)
    body.rbox((0.32, 0.03, 0.018), (-0.01, 0, 0.017), 0.006, G, cseg=cs, rz=(0.004, 0.004, 0.003, 0.0)[lod])
    # frame tubes (graphite): BB shell, down post, seat tube, stem, rear stay, flywheel bracket
    body.cyl(0.015, -0.034, 0.034, G, seg(28, q, 8), bev=(0.003, 0.002, 0.0, 0.0)[lod], bseg=cs - 1 or 1,
             m=yframe(CRANK.x, CRANK.z))
    tube(body, (CRANK.x, 0, 0.02), (CRANK.x, 0, CRANK.z), 0.011, G, seg(16, q, lo))
    seat_top = Vector((-0.004, 0.0, 0.158))
    tube(body, CRANK, seat_top, 0.011, G, seg(16, q, lo))
    stem_top = Vector((GRIP_X - 0.004, 0.0, GRIP_Z - 0.012))
    tube(body, (0.095, 0, 0.022), stem_top, 0.012, G, seg(16, q, lo))
    tube(body, (-0.01, -0.006, 0.128), (FLY.x + 0.004, -0.016, FLY.z + 0.012), 0.008, G, seg(12, q, lo))
    body.rbox((0.026, 0.010, 0.078), (FLY.x, -0.017, 0.056), 0.005, G, cseg=max(1, cs - 1),
              rz=(0.003, 0.002, 0.0, 0.0)[lod])
    # saddle post and the rubber saddle (top at z 0.18)
    body.cyl(0.0065, seat_top.z - 0.012, SADDLE_TOP.z - 0.012, STEEL, seg(14, q, lo), m=kit.at(-0.003, 0, 0))
    sad = [(-0.036, -0.025), (0.0, -0.021), (0.042, -0.008), (0.042, 0.008), (0.0, 0.021), (-0.036, 0.025)]
    body.prism(kit.outline_round_poly(sad, 0.007, max(1, seg(4, q, 1))), SADDLE_TOP.z - 0.019, SADDLE_TOP.z,
               RUBBER, bt=(0.006, 0.005, 0.003, 0.0)[lod], bb=(0.003, 0.002, 0.0, 0.0)[lod], bseg=cs,
               m=kit.at(SADDLE_TOP.x, 0, 0))
    # handlebars: steel bar, rubber_grip grips with end caps, stem clamp
    body.cyl(0.0065, -0.095, 0.095, STEEL, seg(16, q, lo), m=yframe(GRIP_X, GRIP_Z))
    for s in (-1, 1):
        y0, y1 = (0.048, 0.097) if s > 0 else (-0.097, -0.048)
        body.cyl(0.011, y0, y1, GRIP, seg(20, q, lo), bev=(0.004, 0.003, 0.002, 0.0)[lod], bseg=cs,
                 m=yframe(GRIP_X, GRIP_Z))
    body.rbox((0.026, 0.024, 0.024), (GRIP_X - 0.002, 0, GRIP_Z - 0.006), 0.006, G, cseg=max(1, cs - 1),
              rz=(0.004, 0.003, 0.0, 0.0)[lod])
    # console (8 timer segments + lure dot on top), name plate on its front
    body.rbox(CONSOLE_S, tuple(CONSOLE), 0.006, G, cseg=cs, rz=(0.004, 0.003, 0.002, 0.0)[lod])
    ctop = CONSOLE.z + CONSOLE_S[2] / 2
    for i in range(8):
        y = -0.0235 + 0.005 * i
        body.rbox((0.012, 0.0036, 0.003), (CONSOLE.x, y, ctop + 0.0003), 0.0012 if lod < 3 else 0.0, LED,
                  cseg=1 if lod < 3 else 0, rz=0.0006 if lod < 2 else 0.0)
    _m2.led_dome(body, 6, (CONSOLE.x, 0.020, ctop), (0, 0, 1), q, lod)
    # brass bell on the bar between the console and the left grip (+Y, clear of the name plate)
    if lod < 3:
        body.cyl(0.0022, GRIP_Z, GRIP_Z + 0.011, STEEL, seg(8, q, 5), m=kit.at(GRIP_X, 0.038, 0))
    body.sphere(0.0085, BRASS, seg(18, q, lo), seg(8, q, 4, 2), m=kit.at(GRIP_X, 0.038, GRIP_Z + 0.009),
                sz_bot=0.35, sz_top=0.95)
    # lure boom (thin steel) from the stem to the end puck carrying the PR-S bait hook
    boom = [Vector((0.119, 0, 0.300)), Vector((0.142, 0, 0.318)), Vector((0.160, 0, 0.342)),
            Vector((0.172, 0, 0.366)), Vector((0.178, 0, 0.380)), Vector((PUCK_X0 + 0.004, 0, BAIT[2]))]
    body.sweep(boom, 0.0035, (8, 6, 5, 4)[lod], STEEL)
    body.cyl(0.0145, -0.006, 0.006, STEEL, seg(20, q, lo), bev=0.001 if lod < 2 else 0.0, bseg=1,
             m=kit.frame(tuple(boom[0]), (0.087, 0, 0.996)))  # boom clamp on the stem
    body.cyl(PUCK_R, PUCK_X0, BAIT[0], G, seg(28, q, lo), bev=(0.003, 0.0025, 0.0015, 0.0)[lod], bseg=cs,
             m=kit.at(0, 0, BAIT[2]) @ kit.X_AXIS)
    # flywheel axle (static) and the bearing collar on the hub front (PR-M land, Ø 48 mm)
    body.cyl(0.005, SPIN[1] + 0.006, -0.012, STEEL, seg(14, q, lo), m=yframe(FLY.x, FLY.z))
    body.cyl(0.024, SPIN[1], SPIN[1] + 0.007, STEEL, seg(40, q, 10), bev=(0.0015, 0.001, 0.0, 0.0)[lod],
             bseg=1, m=yframe(FLY.x, FLY.z))
    # chain: swept steel band round the chainring and the sprocket (static; the engine scrolls its UVs)
    if lod < 3:
        pr1, pr2 = RING_R - 0.0015, SPROCKET_R - 0.0012
        path = belt_path((CRANK.x, CRANK.z), pr1, (FLY.x, FLY.z), pr2, seg(28, q, 8), seg(10, q, 4))
        path = [p for i, p in enumerate(path) if i == 0 or (Vector(p) - Vector(path[i - 1])).length > 1e-5]
        prof = [(-0.0016, -0.003), (0.0016, -0.003), (0.0016, 0.003), (-0.0016, 0.003)]
        body.ring_sweep(path, prof, STEEL, m=kit.at(0, CHAIN_Y, 0) @ kit.FRONT_OUT)

    # crank: chainring (spider), crank arms, spindle, pedal spindles
    crank = Kit(pivot='PIVOT__crank')
    toothed_ring(crank, (CRANK.x, CRANK.z), CHAIN_Y, 0.034, RING_R - 0.0035, RING_R, RING_TEETH, 0.004, ANOD,
                 q, lod)
    for i in range(5):
        a = math.pi / 2 + 2 * math.pi * i / 5
        d = Vector((math.cos(a), 0, math.sin(a)))
        t = Vector((-math.sin(a), 0, math.cos(a)))
        mm = Matrix.Translation(CRANK + d * 0.022 + Vector((0, CHAIN_Y - 0.001, 0))) @ \
            Matrix((t, Vector((0, 1, 0)), d)).transposed().to_4x4()
        crank.rbox((0.008, 0.005, 0.028), (0, 0, 0), 0.0035 if lod < 3 else 0.0, ANOD, cseg=max(1, cs - 1),
                   m=mm, rz=0.0)
    crank.cyl(0.012, CHAIN_Y - 0.004, CHAIN_Y + 0.003, ANOD, seg(20, q, lo), m=yframe(CRANK.x, CRANK.z))
    crank.cyl(0.0055, -ARM_Y - 0.004, ARM_Y + 0.004, STEEL, seg(14, q, lo), m=yframe(CRANK.x, CRANK.z))
    for s, p in ((1, PEDAL_L), (-1, PEDAL_R)):
        y = s * ARM_Y
        c = (CRANK + p) / 2
        mm = kit.at(c.x, y, c.z) @ kit.rot_x(90)   # local xy = Blender (x, z), local z = -Y
        crank.prism(kit.outline_rrect(CRANK_R + 0.016, 0.014, 0.0069, max(1, seg(4, q, 1))), -0.004, 0.004, ANOD,
                    bt=(0.0015, 0.001, 0.0, 0.0)[lod], bb=(0.0015, 0.001, 0.0, 0.0)[lod], bseg=1, m=mm)
        y0, y1 = sorted((y, s * (PEDAL_Y - 0.010)))
        crank.cyl(0.0035, y0, y1, STEEL, seg(10, q, 5), m=yframe(p.x, p.z))
    pedals = {}
    for name, p in (('pedal_l', PEDAL_L), ('pedal_r', PEDAL_R)):
        k = Kit(pivot='PIVOT__' + name)
        k.rbox((0.032, 0.024, 0.010), tuple(p), 0.004, GRIP, cseg=max(1, cs - 1), rz=(0.002, 0.0015, 0.0, 0.0)[lod])
        pedals[name] = k

    # flywheel: steel rim, 6 Ignition spokes, Ignition hub, steel sprocket in the chain plane
    fly = Kit(pivot='PIVOT__flywheel')
    n = seg(56, q, 12 if lod < 3 else 10)
    fy0, fy1 = FLY.y - FLY_T / 2, FLY.y + FLY_T / 2
    bev = (0.003, 0.0025, 0.0015, 0.0)[lod]
    rim = [(0.047, fy0 + 0.001), (0.049, fy0), (FLY_R - bev, fy0), (FLY_R, fy0 + bev), (FLY_R, fy1 - bev),
           (FLY_R - bev, fy1), (0.049, fy1), (0.047, fy1 - 0.001)]
    if lod >= 3:
        rim = [(0.047, fy0), (FLY_R, fy0), (FLY_R, fy1), (0.047, fy1)]
    fly.lathe(kit.dedupe([(r, h, STEEL) for r, h in rim]), n, yframe(FLY.x, FLY.z), closed=True)
    for i in range(6):
        a = math.pi / 2 + 2 * math.pi * i / 6
        d = Vector((math.cos(a), 0, math.sin(a)))
        t = Vector((-math.sin(a), 0, math.cos(a)))
        mm = Matrix.Translation(FLY + d * 0.032) @ Matrix((t, Vector((0, 1, 0)), d)).transposed().to_4x4()
        fly.rbox((0.009, 0.008, 0.034), (0, 0, 0), 0.0035 if lod < 3 else 0.0, IGN, cseg=max(1, cs - 1), m=mm,
                 rz=0.0)
    fly.cyl(0.016, SPIN[1] + 0.007, fy1 + 0.002, IGN, seg(28, q, 8), bev=(0.002, 0.0015, 0.0, 0.0)[lod],
            bseg=1, m=yframe(FLY.x, FLY.z))
    toothed_ring(fly, (FLY.x, FLY.z), CHAIN_Y, 0.008, SPROCKET_R - 0.0025, SPROCKET_R, SPROCKET_TEETH, 0.004,
                 STEEL, q, lod)
    fly.cyl(0.009, fy1, CHAIN_Y + 0.002, STEEL, seg(16, q, lo), m=yframe(FLY.x, FLY.z))

    pieces = {'body': body, 'crank': crank, 'flywheel': fly}
    pieces.update(pedals)
    decals = [
        kit.decal_plane('name.pedal_rig.bone', (CONSOLE.x, -CONSOLE_S[1] / 2, CONSOLE.z), (0, -1, 0), (0, 0, 1),
                        0.040),
        kit.decal_plane('picto.critter_friendly.mono', (0.085, -0.015, 0.017), (0, -1, 0), (0, 0, 1), 0.010, 0.010),
    ]
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'XL', '4,4,2', 5.0, 'bottom', 15000,
        'Raccoon pedal drive, device + sockets only. Brief: docs/art/briefs/drive.md#pedal-rig. Bandit faces +X. '
        'PIVOT__crank (y) carries the anodised Ignition chainring (Ø 0.09) and 0.035 arms; PIVOT__pedal_l (+Y) / '
        'pedal_r nest under it (rest: right arm +X, left arm -X). PIVOT__flywheel (y) carries the Ø 0.12 flywheel '
        '(steel rim, Ignition spokes) and an 11 T sprocket; the static steel collar on its hub front is the PR-M '
        'spin land. Chain = static swept steel band in the plane y -0.0415 (UV scroll and chain-link normal '
        'deferred). Lure boom: thin steel tube from the stem to a Ø 33 mm graphite end puck whose +X face holds the PR-S '
        'bait hook. Console: 8 kn_led timer segments (group 0) + LED_D6 lure dot (group 1), name plate on its '
        'front; critter-friendly mono pictogram on the beam front. Rear stabiliser kept 13 mm tall to clear the '
        'flywheel. XL row by GAME_SPEC; 15,000 tris is below the XL floor by design (validator warns). '
        'SENSOR__lure__range is a 1.5 m sphere hull at the saddle (approximation; it does not count toward bounds).',
        MASTERS, led_groups='0:timer,1:lure_seen')
    part.pivot('crank', tuple(CRANK), 'y')
    part.pivot('pedal_l', tuple(PEDAL_L), 'y')
    part.pivot('pedal_r', tuple(PEDAL_R), 'y')
    part.pivot('flywheel', tuple(FLY), 'y')
    _m2.nest(part, 'pedal_l', 'crank')
    _m2.nest(part, 'pedal_r', 'crank')
    part.build_lods(build, lod0_q=2.0)
    part.col_box('base', (0.33, 0.18, 0.027), (-0.01, 0, 0.0185), phys='powder', restitution=0.2, friction=0.6)
    pts = []
    for x, z in ((-0.15, 0.03), (0.15, 0.03), (0.138, 0.385), (0.112, 0.385), (-0.01, 0.165), (-0.135, 0.095)):
        for y in (-0.016, 0.016):
            pts.append((x, y, z))
    part.col_hull('frame', pts, phys='powder')
    part.col_box('seat', (0.078, 0.05, 0.02), (0.003, 0, SADDLE_TOP.z - 0.01), phys='rubber', restitution=0.2,
                 friction=0.8)
    part.col_capsule('bar', 0.012, 0.20, (GRIP_X, 0, GRIP_Z), 'y', phys='steel')
    ob = part.col_cyl('flywheel', FLY_R, FLY_T, tuple(FLY), 'y', phys='steel')
    ob['pivot'] = 'PIVOT__flywheel'
    part.port('spin', 'out', SPIN, (0, -1, 0), 'M', 'out', kind='axle')
    part.port('tension', 'bait', BAIT, (1, 0, 0), 'S', 'both', kind='hook')
    k = Kit()
    k.sphere(1.5, 'x', 16, 8, m=kit.at(*SADDLE_TOP))
    part.sensor('lure', 'range', [tuple(v.co) for v in k.bm.verts])
    k.free()
    k = Kit()
    k.sphere(0.05, 'x', 12, 6, m=kit.at(*SADDLE_TOP))
    part.sensor('sound', 'ear', [tuple(v.co) for v in k.bm.verts])
    k.free()
    part.emit('emote', 'seat', (0.0, 0.0, 0.68), (0, 0, 1))
    fwd = (1, 0, 0)
    _m2.socket_rig(part, [
        ('root', (0, 0, 0), (0, 0, 1), None, None),
        ('crank', tuple(CRANK), fwd, 'root', 'crank'),
        ('socket_pedal_l', (PEDAL_L.x, PEDAL_L.y, PEDAL_L.z + 0.005), fwd, 'crank', 'pedal_l'),
        ('socket_pedal_r', (PEDAL_R.x, PEDAL_R.y, PEDAL_R.z + 0.005), fwd, 'crank', 'pedal_r'),
        ('socket_seat', tuple(SADDLE_TOP), fwd, 'root', None),
        ('socket_grip_l', (GRIP_X, GRIP_Y, GRIP_Z), fwd, 'root', None),
        ('socket_grip_r', (GRIP_X, -GRIP_Y, GRIP_Z), fwd, 'root', None),
        ('socket_mount', (-0.25, -0.15, 0.0), (1, 1, 0), 'root', None),
        ('socket_lure_look', tuple(BOOM_TIP), fwd, 'root', None),
    ])
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
