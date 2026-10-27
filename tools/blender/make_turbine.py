"""Procedurally build the TURBINE source file (docs/art/briefs/drive.md, "TURBINE: Toy wind turbine").

Usage: blender -b --factory-startup -P tools/blender/make_turbine.py -- [out.blend]
Default output: assets/src/drive/turbine.blend

A desk-toy wind turbine. Graphite base (0.14 x 0.10 x 0.06 on FOOT_M bumpers) with a recessed kn_poly_clear
top window over a pocket that shows the kn_anod_cobalt bevel pair: PIVOT__bevel_in (axis z, on the mast axis)
and PIVOT__bevel_out (axis y, on the port axis z 0.034) feeding the PR-M spin port on the base front. A tapered
graphite mast (axis at y 0.008) carries the nacelle (capsule along Y at z 0.25, LED_D6 on top). PIVOT__rotor
(axis y, hub (0, -0.03, 0.25)) carries three chunky kn_powder_ignition paddle blades (0.115 long, chord 0.045
-> 0.03 with a rounded tip, 6 mm thick, 25° pitch at mid-span with 8° twist root to tip; one blade straight
up at rest), the graphite hub and the chrome nose cone. COL boxes per blade (0.115 x 0.04 x 0.006) sit at the
same 25° pitch in the rest pose. Name plate on the base +X side, rotating-parts pictogram on the base front.
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

TYPE = 'turbine'
HUB = Vector((0.0, -0.03, 0.25))
TIP_R, ROOT_R = 0.145, 0.030               # blade span 0.115
CHORD_ROOT, CHORD_TIP, BLADE_T = 0.045, 0.030, 0.006
PITCH, TWIST = 25.0, 8.0                   # mid-span pitch, root -> tip twist
BLADE_ANGLES = (90.0, 210.0, 330.0)       # one blade straight up at rest (rotor plane XZ, angle from +X)
BASE = (0.14, 0.10, 0.06)                  # W x D x H (Blender x, y, z)
FOOT_H = 0.004
BASE_Z0, BASE_Z1 = FOOT_H, FOOT_H + BASE[2]
MAST_Y = 0.008
NAC_R, NAC_Y0, NAC_Y1 = 0.021, -0.020, 0.046
APEX = Vector((0.0, MAST_Y, 0.034))        # bevel axes meet here (port axis z 0.034, mast axis y 0.008)
BEV_R = 0.016                              # pitch radius at the heel
PORT = (0.0, -0.051, 0.034)
POCKET = (0.11, 0.072, 0.050)              # top window pocket W x D x depth
LID_T = 0.003
G, IGN, CHROME, STEEL, RUBBER, POLY, COBALT, LED = (
    'kn_powder_graphite', 'kn_powder_ignition', 'kn_chrome', 'kn_steel_brushed', 'kn_rubber', 'kn_poly_clear',
    'kn_anod_cobalt', 'kn_led')
MASTERS = [G, IGN, CHROME, STEEL, RUBBER, POLY, COBALT, LED, 'kn_decal']


def loft(k, rings, mat):
    """Closed shell through rings of 3D points (same count), capped with n-gons at both ends."""
    bm = k.bm
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    mi = k.mi(mat)
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
    for ring in (vs[0], vs[-1]):
        f = bm.faces.new(list(reversed(ring)) if ring is vs[0] else ring)
        f.material_index = mi


def stadium(chord, thick, n):
    """Blade cross-section: a rounded slab (stadium) chord x thick, CCW, n points per round end."""
    r = thick / 2
    hx = max(0.0, chord / 2 - r)
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((hx + r * math.cos(a), r * math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((-hx + r * math.cos(a), r * math.sin(a)))
    return pts


def blade_frame(deg):
    a = math.radians(deg)
    u = Vector((math.cos(a), 0.0, math.sin(a)))     # span direction
    t = Vector((-math.sin(a), 0.0, math.cos(a)))    # rotation tangent
    return u, t


def pitch_at(s):
    """Blade pitch (degrees) at span fraction s: 25° at mid-span, 8° twist from root to tip."""
    return PITCH + TWIST * (0.5 - s)


def chord_at(r):
    """Paddle plan form: 16 mm shank into the hub collar, flare to the 45 mm root chord by r 0.046, straight
    taper to the 30 mm tip chord, rounded (semicircular) tip."""
    tip0 = TIP_R - CHORD_TIP / 2
    if r <= 0.034:
        return 0.016
    if r < 0.046:
        f = (r - 0.034) / 0.012
        return 0.016 + (CHORD_ROOT - 0.016) * (0.5 - 0.5 * math.cos(math.pi * f))
    if r <= tip0:
        return CHORD_ROOT + (CHORD_TIP - CHORD_ROOT) * (r - 0.046) / (tip0 - 0.046)
    d = r - tip0
    return max(0.006, 2 * math.sqrt(max(0.0, (CHORD_TIP / 2) ** 2 - d * d)))


def blade(k, deg, q, lod):
    u, t = blade_frame(deg)
    y = Vector((0.0, 1.0, 0.0))
    span = TIP_R - ROOT_R
    tip0 = TIP_R - CHORD_TIP / 2
    nf = seg(3, q, 1) if lod < 2 else 1
    ns = seg(7, q, 2) if lod < 3 else 1
    nt = seg(5, q, 2) if lod < 3 else 2
    nr = seg(3, q, 1) if lod < 2 else 1
    rs = [0.024, 0.034] + [0.034 + 0.012 * i / nf for i in range(1, nf + 1)]
    rs += [0.046 + (tip0 - 0.046) * i / ns for i in range(1, ns + 1)]
    rs += [tip0 + (TIP_R - tip0) * math.sin(math.pi / 2 * i / nt) for i in range(1, nt + 1)]
    rings = []
    for r in rs:
        chord = chord_at(r)
        th = 0.008 if r <= 0.034 else (BLADE_T if r <= tip0 else max(0.004, BLADE_T * min(1.0, chord / 0.02)))
        if r >= TIP_R - 1e-9:
            th = 0.004
        s = min(1.0, max(0.0, (r - ROOT_R) / span))
        p = math.radians(pitch_at(s))
        cdir = t * math.cos(p) + y * math.sin(p)
        tdir = -t * math.sin(p) + y * math.cos(p)
        c = HUB + u * r
        rings.append([c + cdir * a + tdir * b for a, b in stadium(chord, th, nr)])
    loft(k, rings, IGN)


def bevel_gear(k, centre, axis, teeth, q, lod, toward):
    """Cobalt mitre gear: heel at `centre`, cone running `toward` the apex along `axis` (unit vector)."""
    ax = Vector(axis).normalized() * (1 if toward > 0 else -1)
    m = kit.frame(centre, ax)
    nt = teeth if lod < 2 else teeth // 2
    if lod < 2:
        rr, rt, w = BEV_R - 0.0018, BEV_R + 0.0014, 0.0058
        pts = []
        for i in range(nt):
            a = 2 * math.pi * i / nt
            for f, rad in ((0.0, rr), (0.15, rr), (0.28, rt), (0.47, rt), (0.60, rr)):
                aa = a + 2 * math.pi / nt * f
                pts.append((rad * math.cos(aa), rad * math.sin(aa)))
        s = 0.62  # toe scale (45° cone over the face width)
        heel = [m @ Vector((x, y, 0.0)) for x, y in pts]
        toe = [m @ Vector((x * s, y * s, w)) for x, y in pts]
        loft(k, [heel, toe], COBALT)
        k.cyl(BEV_R * 0.55, -0.006, 0.001, COBALT, seg(20, q, 8), bev=0.0006 if lod == 0 else 0.0, bseg=1, m=m)
    else:
        k.lathe([(0.0, 0.0, COBALT), (BEV_R, 0.0, COBALT), (BEV_R * 0.62, 0.0058, COBALT), (0.0, 0.0058, COBALT)],
                seg(12, q, 6), m)
    k.cyl(0.0022, -0.014, 0.004, STEEL, seg(10, q, 5), m=m)


def build(lod, q, mats):
    cs = (3, 2, 1, 1)[lod]
    body = Kit()
    body.colors['led'] = _m2.led_attr(lambda c, n: (0, 0.08))
    # base with a top window pocket (boolean, brushed-steel liner so the cobalt gears read), the clear lid recessed 1.5 mm, graphite bridge ring for the mast
    base = Kit()
    base.rbox(BASE, (0, 0, (BASE_Z0 + BASE_Z1) / 2), 0.006 if lod < 3 else 0.004, G, cseg=cs,
              rz=0.0045 if lod < 3 else 0.003)  # rz < r: no collapsed cap corners for the EXACT boolean
    if lod < 3:
        cut = Kit()
        cut.rbox((POCKET[0], POCKET[1], POCKET[2] + 0.01), (0, 0, BASE_Z1 - POCKET[2] / 2 + 0.005), 0.006, STEEL,
                 cseg=max(1, cs - 1), rz=0.0)
        body.merge(kit.boolean_diff(base, [cut], mats))
        lid_z1 = BASE_Z1 - 0.0015
        body.rbox((POCKET[0] - 0.0004, POCKET[1] - 0.0004, LID_T), (0, 0, lid_z1 - LID_T / 2), 0.0058, POLY,
                  cseg=max(1, cs - 1), rz=0.001 if lod == 0 else 0.0)
    else:
        body.merge(base)
        base = None
    # feet: FOOT_M bumpers at the base corners
    for x in (-0.055, 0.055):
        for y in (-0.035, 0.035):
            _m2.foot(body, 'M', x, y, q, lod, z0=0.0, top=0.0006)
    # M5 heads on the front face corners (2) beside the port ring
    if lod < 2:
        for x in (-0.055, 0.055):
            _m2.screw(body, 'M5', (x, -BASE[1] / 2, 0.034), (0, -1, 0), q, lod)
    # mast: tapered graphite cone from a flange on the lid to the nacelle
    mz0, mz1 = BASE_Z1 - 0.001, HUB.z - NAC_R + 0.004
    n = seg(28, q, 8)
    body.cyl(0.0145, BASE_Z1 - 0.003, BASE_Z1 + 0.004, G, n, bev=(0.002, 0.0015, 0.0, 0.0)[lod], bseg=cs,
             m=kit.at(0, MAST_Y, 0))
    body.lathe([(0.0, mz0, G), (0.0125, mz0, G), (0.0085, mz1, G), (0.0, mz1, G)], n, kit.at(0, MAST_Y, 0))
    # nacelle: capsule along Y, rounded tail, LED_D6 on top
    ny = seg(32, q, 8)
    rings = (4, 3, 2, 1)[lod]
    prof = [(0.0, NAC_Y0, G)]
    for i in range(1, rings + 1):
        a = -math.pi / 2 + math.pi / 2 * i / rings
        prof.append((NAC_R * math.cos(a), NAC_Y0 + 0.004 + 0.004 * math.sin(a), G))
    for i in range(0, rings + 1):
        a = math.pi / 2 * i / rings
        prof.append((NAC_R * math.cos(a), NAC_Y1 - NAC_R * 0.8 + NAC_R * 0.8 * math.sin(a), G))
    prof[-1] = (0.0, NAC_Y1, G)
    body.lathe(kit.dedupe(prof), ny, kit.at(0, 0, HUB.z) @ kit.Y_AXIS)
    _m2.led_dome(body, 6, (0.0, 0.016, HUB.z + NAC_R - 0.0004), (0, 0, 1), q, lod)
    # front axle boss where the rotor leaves the nacelle
    if lod < 3:
        body.cyl(0.009, NAC_Y0 - 0.004, NAC_Y0 + 0.002, STEEL, seg(20, q, 6), m=kit.at(0, 0, HUB.z) @ kit.Y_AXIS)

    rotor = Kit(pivot='PIVOT__rotor')
    for d in BLADE_ANGLES:
        blade(rotor, d, q, lod)
    hm = kit.at(HUB.x, 0, HUB.z) @ kit.Y_AXIS @ kit.rot_x(0)
    # hub: graphite drum (y -0.040...-0.022) round the blade roots, chrome nose cone in front
    hub_y0, hub_y1 = HUB.y - 0.011, HUB.y + 0.008
    body_n = seg(32, q, 8)
    rotor.cyl(0.028, hub_y0, hub_y1, G, body_n, bev=(0.004, 0.003, 0.002, 0.0)[lod], bseg=cs,
              m=kit.at(HUB.x, 0, HUB.z) @ kit.Y_AXIS)
    rotor.cyl(0.0055, hub_y1 - 0.002, NAC_Y0 - 0.002, STEEL, seg(14, q, 6), m=kit.at(HUB.x, 0, HUB.z) @ kit.Y_AXIS)
    nose = [(0.0, 0.0, CHROME)]
    nr = (6, 4, 3, 2)[lod]
    for i in range(nr + 1):
        a = math.pi / 2 * i / nr
        nose.append((0.022 * math.cos(a), 0.016 * math.sin(a), CHROME))
    nose[-1] = (0.0, 0.016, CHROME)
    rotor.lathe(kit.dedupe(nose), body_n, kit.frame((HUB.x, hub_y0 + 0.001, HUB.z), '-y'))
    if lod < 2:  # root collars where the blades enter the hub
        for d in BLADE_ANGLES:
            u, _t = blade_frame(d)
            rotor.cyl(0.0085, 0.024, 0.032, G, seg(16, q, 6), bev=0.0015 if lod == 0 else 0.0, bseg=1,
                      m=kit.frame(tuple(HUB), tuple(u)))

    # bevel pair in the base window
    bev_in = Kit(pivot='PIVOT__bevel_in')
    bev_out = Kit(pivot='PIVOT__bevel_out')
    bevel_gear(bev_in, (APEX.x, APEX.y, APEX.z + BEV_R), (0, 0, 1), 18, q, lod, -1)
    bev_in.cyl(0.0022, APEX.z + BEV_R, BASE_Z1 + 0.003, STEEL, seg(10, q, 5), m=kit.at(APEX.x, APEX.y, 0))
    bevel_gear(bev_out, (APEX.x, APEX.y - BEV_R, APEX.z), (0, 1, 0), 18, q, lod, 1)
    bev_out.cyl(0.0022, PORT[1] + 0.004, APEX.y - BEV_R, STEEL, seg(10, q, 5),
                m=kit.at(APEX.x, 0, APEX.z) @ kit.Y_AXIS)
    pieces = {'body': body, 'rotor': rotor, 'bevel_in': bev_in, 'bevel_out': bev_out}
    decals = [
        kit.decal_plane('name.turbine.bone', (BASE[0] / 2, 0.0, 0.036), (1, 0, 0), (0, 0, 1), 0.056),
        kit.decal_plane('picto.rotating_parts.mono', (-0.038, -BASE[1] / 2, 0.034), (0, -1, 0), (0, 0, 1),
                        0.020, 0.020),
    ]
    return kit.add_decals(pieces, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'drive', 'M', '2.5,4,1', 1.4, 'bottom', 7000,
        'Toy wind turbine. Brief: docs/art/briefs/drive.md#turbine. PIVOT__rotor (y, hub) carries 3 Ignition '
        'paddle blades (25° pitch at mid-span, 8° twist), hub and chrome nose; one blade points straight up at '
        'rest. COL__box__blade_a/b/c match the render blades at the 25° pitch in that rest pose (not parented: '
        'COL is static data; custom prop pivot = PIVOT__rotor). Deviation: footprint 2.5 x 4 x 1 cells - three '
        'blades 120° apart span at most 0.29 * sin 60° = 0.25 m (+ chord 0.266) across, so the rest pose cannot '
        'fill the 0.30 brief width (the 0.29 m rotor sweep does). Base window: recessed clear lid over a pocket '
        'showing the cobalt bevel pair (bevel_in z on the mast axis, bevel_out y on the port axis). Name plate on '
        'the base +X side, rotating-parts mono pictogram on the base front. Blade thickness map deferred.',
        MASTERS, led_groups='0:status')
    part.pivot('rotor', tuple(HUB), 'y')
    part.pivot('bevel_in', (APEX.x, APEX.y, APEX.z + BEV_R), 'z')
    part.pivot('bevel_out', (APEX.x, APEX.y - BEV_R, APEX.z), 'y')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.4)
    part.col_box('base', BASE, (0, 0, (BASE_Z0 + BASE_Z1) / 2), phys='powder', restitution=0.25, friction=0.5)
    mz0, mz1 = BASE_Z1, HUB.z + NAC_R
    part.col_capsule('mast', 0.013, mz1 - mz0, (0, MAST_Y, (mz0 + mz1) / 2), 'z', phys='powder')
    y = Vector((0, 1, 0))
    p = math.radians(PITCH)
    for name, d in zip(('blade_a', 'blade_b', 'blade_c'), BLADE_ANGLES):
        u, t = blade_frame(d)
        cdir = t * math.cos(p) + y * math.sin(p)
        tdir = t * math.sin(p) - y * math.cos(p)   # (u, chord, thickness) right-handed
        rot = Matrix((u, cdir, tdir)).transposed().to_4x4()
        c = HUB + u * (ROOT_R + (TIP_R - ROOT_R) / 2)
        ob = part.col_box(name, (TIP_R - ROOT_R, 0.04, BLADE_T), (0, 0, 0), phys='powder',
                          matrix=Matrix.Translation(c) @ rot, restitution=0.3, friction=0.4)
        ob['pivot'] = 'PIVOT__rotor'
    part.port('spin', 'out', PORT, (0, -1, 0), 'M', 'out', kind='axle')
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
