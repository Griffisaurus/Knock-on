"""Procedurally build the GUTTER kit (docs/art/briefs/frame.md, "GUTTER: Open half-pipe").

Usage: blender -b --factory-startup -P tools/blender/make_gutter.py -- [out.blend]
Default output: assets/src/frame/gutter.blend  (+ sidecar assets/build/parts/gutter/gutter.profile.json)

GUTTER is path-drawn like TUBE: the engine sweeps `gutter__profile` along the player's path. So it ships as a
KIT + PROFILE, not one fixed mesh (kn_origin = 'path', origin = the run's first control point at the channel
floor centre). The .blend holds a demo straight run along +X, 0.5 m long, built from the kit pieces:

  gutter__channel  the sweep: ONE mesh, two slots (kn_powder_bone inside, kn_powder_cobalt outside + the Ø 12 mm
                   out-turned bead lips). Profile: inner r 0.145, outer r 0.150 (5 mm wall), arc centre 0.145 above
                   the floor; 24 arc segments at LOD0 (12 / 6 / 4), 8 per lip (4 / 3 / 2) -> 64 edges = 128 tris
                   per straight span. The demo caps the two cut ends (hidden under the stop / spout).
  gutter__strap    15 mm kn_steel_brushed band round the outside and over both beads at the x 0.5 joint, 2 dome
                   rivets (RIVET_R4).
  gutter__stop     closed kn_powder_bone end cap at x 0 with a kn_rubber bumper face toward the channel.
  gutter__spout    open end at x 0.5: the lip extended 0.03 m, the cut wall rolled into a round nose, bead ends
                   domed, and a Cobalt drip nose under the floor.
  gutter__saddle   Bone cradle on a Cobalt Ø 0.02 post (one 0.1 m module) on a rubber foot, under the run middle.

COL__mesh__0 is the static sweep collider (12-side half profile, 4-segment lips, outer) along the run including the
spout, plus the stop plate. make_gutter.py also writes gutter.profile.json: the closed 2D profiles of `gutter`
and `gutter_slim` with per-edge masters and LOD segment counts, the path rules and the kit anchors.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

from kn_tools import kit, paths  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'gutter'
BONE, COBALT, STEEL, RUBBER = 'kn_powder_bone', 'kn_powder_cobalt', 'kn_steel_brushed', 'kn_rubber'
MASTERS = [BONE, COBALT, STEEL, RUBBER]
# (inner r, outer r, lip radius): brief sizes for the wide and the slim profile
SPECS = {'gutter': (0.145, 0.150, 0.006), 'gutter_slim': (0.056, 0.060, 0.004)}
RIN, ROUT, LIPR = SPECS['gutter']
C = RIN                        # arc centre height: the floor centre (inner bottom) is the origin
LOD_SEGS = ((24, 8), (12, 4), (6, 3), (4, 2))   # (arc, lip) segments per LOD (sweep + profile.json)
RUN = 0.5                      # demo run length (one straight span)
SPOUT = 0.03                   # lip extended 0.03 m
STRAP_W, STRAP_T = 0.015, 0.0015
STOP_T = 0.010
SADDLE_X, SADDLE_W, POST_R, POST_L = RUN / 2, 0.030, 0.010, 0.100
FOOT_H = 0.004
PATH_RULES = {
    'gutter': {'min_bend_radius': 0.36, 'max_bank_deg': 30.0, 'max_gradient_deg': 60.0, 'ring_step_deg': 5.0,
               'strap_max_spacing': 0.5, 'straight_rings': 'joints only (one span per straight)'},
    'gutter_slim': {'min_bend_radius': 0.15, 'max_bank_deg': 30.0, 'max_gradient_deg': 60.0, 'ring_step_deg': 5.0,
                    'strap_max_spacing': 0.5, 'straight_rings': 'joints only (one span per straight)'},
}


# ---------------------------------------------------------------- profile

def junctions(rin, rout, lipr):
    """Where the inner / outer arcs meet the right bead circle (centre (rout, rin)): arc angles + bead angles."""
    c = rin
    xi = (rin * rin - lipr * lipr + rout * rout) / (2 * rout)
    zi = c - math.sqrt(max(0.0, rin * rin - xi * xi))
    xo = rout - lipr * lipr / (2 * rout)
    zo = c - math.sqrt(max(0.0, rout * rout - xo * xo))
    th_i, th_o = math.atan2(xi, c - zi), math.atan2(xo, c - zo)
    a0 = math.atan2(zi - c, xi - rout) % (2 * math.pi)     # ~213°: inner junction, upper-left of the bead
    a1 = math.atan2(zo - c, xo - rout)                     # ~-91°: outer junction, bead underside
    return th_i, th_o, a0, a1


def profile(spec, arc, lip):
    """Closed 2D profile [(x_lat, z, master of the edge to the next point)] for a sweep. Order: inner arc left ->
    right (Bone), right bead over the top, outer arc right -> left, left bead (Cobalt). Returns (pts, inner
    index range, outer start index) for the cap bridging."""
    rin, rout, lipr = spec
    c = rin
    th_i, th_o, a0, a1 = junctions(rin, rout, lipr)
    pts = []
    for k in range(arc + 1):
        th = -th_i + 2 * th_i * k / arc
        pts.append((rin * math.sin(th), c - rin * math.cos(th), BONE if k < arc else COBALT))
    bead = [a0 + (a1 - a0) * k / lip for k in range(1, lip)]
    pts += [(rout + lipr * math.cos(a), c + lipr * math.sin(a), COBALT) for a in bead]
    o0 = len(pts)
    for k in range(arc + 1):
        th = th_o - 2 * th_o * k / arc
        pts.append((rout * math.sin(th), c - rout * math.cos(th), COBALT))
    pts += [(-(rout + lipr * math.cos(a)), c + lipr * math.sin(a), COBALT) for a in reversed(bead)]
    return pts, o0


def sweep_straight(k, spec, arc, lip, x0, x1, cap=COBALT):
    """Straight sweep of the profile from x0 to x1 (one span), both cut ends capped (watertight)."""
    pts, o0 = profile(spec, arc, lip)
    bm = k.bm
    rings = [[bm.verts.new((x, p[0], p[1])) for p in pts] for x in (x0, x1)]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i])).material_index = k.mi(pts[i][2])
    cm = k.mi(cap)
    for r in rings:
        for j in range(arc):                                   # wall section: inner j <-> outer arc - j
            bm.faces.new((r[j], r[j + 1], r[o0 + arc - j - 1], r[o0 + arc - j])).material_index = cm
        bm.faces.new([r[arc]] + r[arc + 1:o0] + [r[o0]]).material_index = cm          # right bead section
        bm.faces.new([r[o0 + arc]] + r[o0 + arc + 1:] + [r[0]]).material_index = cm   # left bead section


def on_ring(theta, rad):
    """(y, z) on a circle of radius rad about the arc centre; theta 0 = bottom, + toward +Y."""
    return rad * math.sin(theta), C - rad * math.cos(theta)


# ---------------------------------------------------------------- pieces

def channel(lod):
    arc, lip = LOD_SEGS[lod]
    k = Kit()
    sweep_straight(k, SPECS['gutter'], arc, lip, 0.0, RUN)
    return k


def strap_spine(narc, nb, beads=True):
    """Path round the outside: left bead (over its top, 60° -> 225°), outer arc (-80° -> 80°), right bead
    (-45° -> 120°). Each point: ((y, z), outward unit normal)."""
    out = []
    for kk in range(nb + 1 if beads else 0):
        a = math.radians(60 + 165 * kk / nb)
        n = Vector((math.cos(a), math.sin(a)))
        out.append((Vector((-ROUT, C)) + n * LIPR, n))
    for kk in range(narc + 1):
        th = math.radians(-80 + 160 * kk / narc)
        n = Vector((math.sin(th), -math.cos(th)))
        out.append((Vector((0.0, C)) + n * ROUT, n))
    for kk in range(nb + 1 if beads else 0):
        a = math.radians(-45 + 165 * kk / nb)
        n = Vector((math.cos(a), math.sin(a)))
        out.append((Vector((ROUT, C)) + n * LIPR, n))
    return out


def strap(lod, q):
    k = Kit()
    narc = seg(16, q, 3)
    sp = strap_spine(narc, max(1, seg(4, q, 1)), beads=lod < 3)   # LOD3: the band under the trough only
    # the band's chords must clear the channel's outer facets: thicken by the chord sag of its own arc step
    t = STRAP_T + (ROUT + STRAP_T) * (1 - math.cos(math.radians(160.0 / narc) / 2))
    outline = [tuple(p + n * t) for p, n in sp] + [tuple(p - n * 0.0003) for p, n in reversed(sp)]
    k.prism(outline, RUN - STRAP_W / 2, RUN + STRAP_W / 2, STEEL, m=kit.X_AXIS)   # 1.5 mm band: no bevel rows
    if lod == 0:                                       # RIVET_R4 domes at +-50° on the strap
        for th in (-50.0, 50.0):
            t = math.radians(th)
            n = Vector((0.0, math.sin(t), -math.cos(t)))
            c = Vector((RUN, 0.0, C)) + n * (ROUT + STRAP_T - 0.0001)
            prof = [(0.0, -0.0002, STEEL)] + [(0.002 * math.cos(a), 0.0012 * math.sin(a), STEEL)
                                              for a in (0.0, math.pi / 4)] + [(0.0, 0.0012, STEEL)]
            k.lathe(prof, seg(8, q, 6), kit.frame(tuple(c), tuple(n)))
    return k


def stop(lod, q):
    """Bone end plate (covers the channel and both beads) with a rubber bumper pad on its inner face."""
    k = Kit()
    rp, top = ROUT + LIPR + 0.002, C + LIPR + 0.002
    n = seg(20, q, 3)
    arc = [on_ring(-math.pi / 2 + math.pi * i / n, rp) for i in range(n + 1)]
    rc = 0.004 if lod < 2 else 0.0
    cr = ([(rp - rc + rc * math.cos(a), top - rc + rc * math.sin(a)) for a in (0.0, math.pi / 4, math.pi / 2)]
          if rc else [(rp, top)])                      # top-right corner, side -> top
    outline = [(-x, z) for x, z in reversed(cr)] + arc + cr   # top-left -> down -> under -> up -> top-right
    b = 0.002 if lod < 2 else 0.0
    k.prism(_ccw(outline), -STOP_T, 0.002, BONE, bt=b, bb=b, bseg=2 if lod == 0 else 1, m=kit.X_AXIS)
    if lod < 3:                                        # rubber bumper face, inset 2 mm from the channel wall
        nb = seg(14, q, 4)
        r = RIN - 0.002
        ta = math.radians(80)
        pad = [on_ring(-ta + 2 * ta * i / nb, r) for i in range(nb + 1)]
        pb = 0.0015 if lod < 2 else 0.0
        k.prism(_ccw(pad), 0.0005, 0.008, RUBBER, bt=pb, bb=pb, bseg=1, m=kit.X_AXIS)
    return k


def _ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else list(reversed(pts))


def spout(lod, q):
    arc, lip = LOD_SEGS[lod]
    k = Kit()
    x0, x1 = RUN - 0.001, RUN + SPOUT
    sweep_straight(k, SPECS['gutter'], arc, lip, x0, x1)
    if lod < 3:                                        # rolled nose on the cut wall (mid-wall arc tube)
        th_i = junctions(RIN, ROUT, LIPR)[0]
        rm = (RIN + ROUT) / 2
        na = max(3, arc // 2)
        path = [(x1, *on_ring(-th_i + 2 * th_i * i / na, rm)) for i in range(na + 1)]
        k.sweep(path, 0.0034, (6, 5, 4)[lod], COBALT)
        for s in (-1, 1):                              # domed bead ends
            k.sphere(LIPR, COBALT, seg(8, q, 6), max(3, seg(4, q, 3)), m=kit.at(x1, s * ROUT, C))
    if lod < 3:                                        # drip nose under the floor at the open end
        k.rbox((0.014, 0.05, 0.010), (x1 - 0.007, 0.0, -0.006), 0.003 if lod < 2 else 0.0, COBALT,
               cseg=(1, 1, 1, 0)[lod], rz=0.003 if lod < 2 else 0.0)
    return k


def saddle(lod, q):
    """Bone cradle hugging the outer arc (+-35°), Cobalt Ø 0.02 post (one 0.1 m module), rubber foot."""
    k = Kit()
    n = seg(12, q, 3)
    ta = math.radians(35)
    top = [on_ring(ta - 2 * ta * i / n, ROUT - 0.0005) for i in range(n + 1)]     # right -> left (CCW)
    zb = C - ROUT - 0.022
    outline = top + [(-0.095, zb + 0.012), (-0.03, zb), (0.03, zb), (0.095, zb + 0.012)]
    b = 0.002 if lod < 2 else 0.0
    if lod < 3:
        k.prism(_ccw(outline), SADDLE_X - SADDLE_W / 2, SADDLE_X + SADDLE_W / 2, BONE, bt=b, bb=b, bseg=1,
                m=kit.X_AXIS)
    else:                                              # LOD3: a plain block under the trough
        k.rbox((SADDLE_W, 0.12, 0.02), (SADDLE_X, 0.0, zb + 0.01), 0.0, BONE, cseg=0, rz=0.0)
    z_foot = zb - POST_L - FOOT_H
    ps = seg(16, q, 6) if lod < 3 else 4
    k.cyl(POST_R, zb - POST_L, zb + 0.002, COBALT, ps, bev=0.0015 if lod < 2 else 0.0, bseg=1,
          m=kit.at(SADDLE_X, 0, 0))
    if lod < 3:
        fr = 0.016
        prof = [(0.0, z_foot, RUBBER), (fr - 0.0015, z_foot, RUBBER), (fr, z_foot + 0.0015, RUBBER),
                (fr, z_foot + FOOT_H + 0.0005, RUBBER), (0.0, z_foot + FOOT_H + 0.0005, RUBBER)]
        if lod > 0:
            prof = [prof[0], prof[1], prof[3], prof[4]]
        k.lathe(prof, ps, kit.at(SADDLE_X, 0, 0))
    return k


def name_plate():
    """Bone name plate on the Cobalt outer wall (front side, 60° up from the bottom), reading along +X."""
    t = math.radians(-60)
    nrm = Vector((0.0, math.sin(t), -math.cos(t)))
    up = Vector((0.0, -math.cos(t), -math.sin(t)))
    c = Vector((0.13, 0.0, C)) + nrm * ROUT
    return kit.decal_plane('name.gutter.bone', tuple(c), tuple(nrm), tuple(up), 0.06)


def build(lod, q):
    pieces = {'channel': channel(lod), 'strap': strap(lod, q), 'stop': stop(lod, q), 'spout': spout(lod, q),
              'saddle': saddle(lod, q)}
    return kit.add_decals(pieces, lod, [name_plate()])


def col_mesh():
    """Static sweep collider: 12-side half profile + 4-segment lips + outer, run + spout, plus the stop plate."""
    k = Kit()
    sweep_straight(k, SPECS['gutter'], 12, 4, 0.0, RUN + SPOUT, cap='x')
    k2 = stop(3, 0.3)
    k.merge(k2)
    k2.free()
    return k


def bounds(pieces):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for kk in pieces.values():
        for v in kk.bm.verts:
            lo = Vector(min(a, b) for a, b in zip(lo, v.co))
            hi = Vector(max(a, b) for a, b in zip(hi, v.co))
    return lo, hi


# ---------------------------------------------------------------- engine sidecar

def profile_json(lo, hi):
    out = {
        'type': TYPE,
        'kind': 'path_sweep',
        'note': 'GUTTER is a kit + profile: the engine sweeps the closed profile along player-drawn paths and places '
                'the kit pieces from the .glb (gutter__strap / __stop / __spout / __saddle). The .glb demo is one '
                'straight 0.5 m run along +X.',
        'units': 'm',
        'frame': 'profile (x_lat, z): origin = channel floor centre (inner bottom) on the path; z = path up '
                 '(banked normal); x_lat = up x tangent (left of travel; Blender +Y on the demo run, which travels '
                 '+X). Profiles are closed polygons; edge i runs from point i to point i+1 (the last edge closes to '
                 'point 0) and carries edge_master[i]. Two slots on one sweep mesh, never two meshes.',
        'profiles': {},
        'path_rules': PATH_RULES,
        'budget': {'straight_span_tris': 128, 'curve_ring_step_tris': 128, 'bend_90_tris': 2300, 'strap_max': 300,
                   'stop_max': 600, 'spout_max': 600, 'saddle_post_max': 500},
        'kit': {
            'gutter__channel': {'role': 'sweep', 'demo_span': [0.0, RUN],
                                'anchor': 'path s = 0 .. run length; demo caps both cut ends'},
            'gutter__stop': {'role': 'closed end cap', 'anchor_s': 0.0, 'attach': 'start',
                             'demo_pos': [0.0, 0.0, 0.0], 'extends': [-STOP_T, 0.002],
                             'note': 'plate outer face at s - 0.010; rubber bumper face toward +tangent'},
            'gutter__strap': {'role': 'joint band', 'anchor_s': RUN, 'attach': 'joint (centred)',
                              'demo_pos': [RUN, 0.0, 0.0], 'width': STRAP_W,
                              'rule': 'at every joint, joints at most 0.5 m apart'},
            'gutter__spout': {'role': 'open end', 'anchor_s': RUN, 'attach': 'end',
                              'demo_pos': [RUN, 0.0, 0.0], 'extends': [-0.001, SPOUT],
                              'note': 'lip extended 0.03 m along +tangent with a drip nose under the floor'},
            'gutter__saddle': {'role': 'support', 'anchor_s': SADDLE_X, 'attach': 'under (cradle on the outer arc)',
                               'demo_pos': [SADDLE_X, 0.0, 0.0], 'post_module': POST_L, 'post_d': 2 * POST_R,
                               'note': 'cradle bottom at z %.3f; post modules of 0.1 m stack down to the floor; '
                                       'rubber foot %.3f m' % (C - ROUT - 0.022, FOOT_H)},
        },
        'demo_bounds_blender': {'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi]},
        'collision': {'name': 'COL__mesh__0', 'phys': 'powder', 'friction': 0.40, 'restitution': 0.35,
                      'profile_segments': {'arc': 12, 'lip': 4}, 'static': True},
    }
    for name, spec in SPECS.items():
        rin, rout, lipr = spec
        lods = {}
        for lod, (arc, lip) in enumerate(LOD_SEGS):
            pts, _ = profile(spec, arc, lip)
            lods['LOD%d' % lod] = {'arc_segments': arc, 'lip_segments': lip,
                                   'points': [[round(p[0], 6), round(p[1], 6)] for p in pts],
                                   'edge_master': [p[2] for p in pts]}
        th_i, th_o, _, _ = junctions(rin, rout, lipr)
        out['profiles'][name] = {
            'inner_radius': rin, 'outer_radius': rout, 'wall': round(rout - rin, 4), 'lip_diameter': 2 * lipr,
            'arc_centre_z': rin, 'lip_centres': [[-rout, rin], [rout, rin]],
            'overall_w_h': [round(2 * (rout + lipr), 4), round(rin + lipr + (rout - rin), 4)],
            'inner_arc_half_angle_deg': round(math.degrees(th_i), 3),
            'outer_arc_half_angle_deg': round(math.degrees(th_o), 3),
            'masters': {'inside': BONE, 'outside_and_lips': COBALT},
            'lods': lods,
        }
    return out


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'S', '1,1,1', 4.0, 'path', 2150,
        'Open half-pipe, delivered as a KIT + PROFILE (path-drawn like TUBE; kn_origin = path, origin = first '
        'control point at the channel floor centre). The .blend is a demo straight 0.5 m run along +X: '
        'gutter__channel (sweep, Bone in / Cobalt out + Ø 12 mm bead lips, 24 arc segs, 128 tris per span, demo '
        'end caps), gutter__strap (15 mm steel band + 2 rivets at x 0.5), gutter__stop (Bone end cap + rubber '
        'bumper at x 0), gutter__spout (lip +0.03 m, rolled nose, drip nose) and gutter__saddle (Bone cradle, '
        'Cobalt Ø 0.02 post, one 0.1 m module, rubber foot) at x 0.25. Footprint = the demo run bounds. '
        'Engine sweep data: assets/build/parts/gutter/gutter.profile.json (gutter + gutter_slim). Static: '
        'kn_mass_hint is nominal. Brief: docs/art/briefs/frame.md#gutter. Deferred: gutter_slim kit pieces, '
        'curved / banked demo, the engine path sweep itself.',
        MASTERS)
    probe = build(0, 1.0)
    lo, hi = bounds(probe)
    for kk in probe.values():
        kk.free()
    size = hi - lo
    part.root['kn_footprint'] = '%.2f,%.2f,%.2f' % (size.x * 10, size.z * 10, size.y * 10)
    part.build_lods(build, lod0_q=1.0)
    part._col('mesh', '0', col_mesh(), None, 'powder', restitution=0.35, friction=0.40)
    side = os.path.join(part.root_dir, 'assets', 'build', 'parts', TYPE)
    os.makedirs(side, exist_ok=True)
    with open(os.path.join(side, TYPE + '.profile.json'), 'w', encoding='utf8') as f:
        json.dump(profile_json(lo, hi), f, indent=1)
    print('wrote', os.path.join(side, TYPE + '.profile.json'), 'footprint', part.root['kn_footprint'])
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
