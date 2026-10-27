"""Shared COG builder (docs/art/briefs/drive.md, "COG: Spur and bevel gears") for make_cog_s/m/l.py.

One .blend and one exported mesh per size (cog_s, cog_m, cog_l): the game picks the art by the `size` prop.
The look-dev gear() tooth profile (root 0-15 %, flank to 28 %, tip land 28-47 %, flank to 60 %, root to 100 %,
root r = pitch - 1.25 m, tip r = pitch + m) with module 5 mm for every size, so any cog meshes with any other;
tooth 0 is centred on +X at rest. Five lightening holes (0.56 x root r, hole r 0.2 x root r), anodised cobalt
body 25 mm thick, steel hub and chrome axle under PIVOT__gear (axis y); the steel bearing collar that carries
the spin port ring stays on the root. Axis = Blender Y (the disc faces the camera).
"""
import math

from kn_tools import kit
from kn_tools.kit import Kit, seg

MODULE, FACE = 0.005, 0.025
SIZES = {
    's': dict(teeth=20, mass=0.25, budget=1600, hub_d=0.034, port='S', cells=1),
    'm': dict(teeth=40, mass=0.9, budget=2400, hub_d=0.050, port='M', cells=2),
    'l': dict(teeth=60, mass=2.0, budget=3000, hub_d=0.050, port='M', cells=3),
}
COBALT, STEEL, CHROME = 'kn_anod_cobalt', 'kn_steel_brushed', 'kn_chrome'
MASTERS = [COBALT, STEEL, CHROME]
COLLAR_Y0, COLLAR_Y1 = -0.0205, -0.0135   # static bearing collar; its front face carries the port ring
AXLE_Y1 = 0.030                            # chrome stub 15 mm out of the hub back
FRAME = kit.Y_AXIS                         # local z = Blender Y; local (x, y) = Blender (z, x)


def radii(teeth):
    rp = MODULE * teeth / 2
    return rp, rp + MODULE, rp - 1.25 * MODULE


def tooth_outline(teeth, per_tooth):
    """CCW outline in the gear frame. 4 pts/tooth = look-dev profile (the 0.8 root point is a flat chord),
    2 = tip land only, 1 = a pitch-circle polygon (LOD3)."""
    rp, rt, rr = radii(teeth)
    if per_tooth == 1:  # LOD3: a polygon just outside the pitch circle, capped at 48 sides
        return kit.outline_circle(rp + 0.3 * MODULE, min(teeth, 48), start=math.pi / 2)
    step = 2 * math.pi / teeth
    fr = {4: ((0.15, rr), (0.28, rt), (0.47, rt), (0.60, rr)),
          2: ((0.22, rt * 0.985), (0.53, rt * 0.985))}[per_tooth]
    pts = []
    for i in range(teeth):
        for f, r in fr:
            a = (i + f - 0.375) * step + math.pi / 2  # local +y = Blender +X: tooth 0 centred there
            pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def build_fn(size, mats):
    cfg = SIZES[size]
    teeth = cfg['teeth']
    rp, rt, rr = radii(teeth)
    hub_r = cfg['hub_d'] / 2
    axle_r = 0.0025 if cfg['port'] == 'S' else 0.0038

    def build(lod, q):
        per = (4, 4, 2, 1)[lod]
        body = Kit(pivot='PIVOT__gear')
        body.prism(tooth_outline(teeth, per), -FACE / 2, FACE / 2, COBALT, m=FRAME)
        if lod < 3:
            hs = seg((24, 16, 10, 0)[lod], q, 6)
            cutters = []
            for k in range(5):
                a = math.pi / 2 + 2 * math.pi * (k + 0.5) / 5
                c = Kit()
                c.cyl(0.2 * rr, -FACE, FACE, COBALT, hs,
                      m=FRAME @ kit.at(0.56 * rr * math.cos(a), 0.56 * rr * math.sin(a), 0))
                cutters.append(c)
            body = kit.boolean_diff(body, cutters, mats)
            body.pivot = 'PIVOT__gear'
            if lod == 0:
                # Front-face rims only (the camera side, -Y): 2 mm on the holes, the look-dev 0.9 mm on the
                # teeth. Back rims stay sharp to hold the brief budget.
                front = [e for e in body.sharp_edges(30) if all(v.co.y < -FACE / 2 + 1e-5 for v in e.verts)]
                holes = [e for e in front if min(math.hypot(v.co.x, v.co.z) for v in e.verts) < rr * 0.9]
                body.bevel_edges(holes, 0.002, 1)
                front = [e for e in body.sharp_edges(30) if all(v.co.y < -FACE / 2 + 1e-5 for v in e.verts)
                         and min(math.hypot(v.co.x, v.co.z) for v in e.verts) > rr * 0.97]
                body.bevel_edges(front, 0.0009, 1)
        n = seg(28, q, 6)
        hb = (0.0015, 0.001, 0.0, 0.0)[lod]
        # hub: web boss behind the collar to 15 mm behind the origin
        if lod < 3:  # LOD3: the disc and collar carry the read
            body.cyl(hub_r * 0.78, COLLAR_Y1 - 0.0005, 0.0155, STEEL, n, bev=hb, bseg=1, m=FRAME)
            body.cyl(axle_r, COLLAR_Y0 + 0.002, AXLE_Y1, CHROME, seg(16, q, 6), bev=0.0006 if lod < 2 else 0.0,
                     bseg=1, m=FRAME)
        collar = Kit()
        cb = (0.0015, 0.001, 0.0, 0.0)[lod]
        prof = [(axle_r + 0.0004, COLLAR_Y0, STEEL)]
        prof += kit.arc_pts(hub_r, COLLAR_Y0, cb, 1 if cb else 1, True, STEEL, STEEL)
        prof += kit.arc_pts(hub_r, COLLAR_Y1, cb, 1 if cb else 1, False, STEEL, STEEL)
        prof += [(axle_r + 0.0004, COLLAR_Y1, STEEL)]
        collar.lathe(kit.dedupe(prof), n, m=FRAME, closed=True)
        # Tooth count ("20T") on the web front, between two holes on the +X side; it turns with the gear.
        sz = {20: 0.009, 40: 0.013, 60: 0.016}[teeth]
        decals = [kit.decal_plane('mark.teeth_%d.bone' % teeth, (0.56 * rr, -FACE / 2, 0.0), (0, -1, 0), (0, 0, 1),
                                  sz, sz, pivot='PIVOT__gear')]
        return kit.add_decals({'gear': body, 'collar': collar}, lod, decals)
    return build


def make(size, out_path=None):
    cfg = SIZES[size]
    ptype = 'cog_' + size
    teeth = cfg['teeth']
    rp, rt, _ = radii(teeth)
    c = cfg['cells']
    part = kit.Part(
        ptype, 'drive', 'S', '%d,%d,0.5' % (c, c), cfg['mass'], 'axle', cfg['budget'],
        'COG %s: %d teeth, module 5 mm, pitch Ø %.2f. Brief: docs/art/briefs/drive.md#cog. Game art for '
        'cog size %s (one mesh per size). Tooth bevel is a 0.9 mm chamfer and holes are %s-sided to hold '
        'the brief budget; "%dT" decal on the web turns with the gear.'
        % (size.upper(), teeth, 2 * rp, size.upper(), 'up to 24', teeth),
        MASTERS, hints={'kn_module': MODULE, 'kn_teeth': teeth, 'kn_pitch_r': rp})
    part.pivot('gear', (0, 0, 0), 'y')
    part.build_lods(build_fn(size, part.mats), lod0_q=1.0)
    part.col_cyl('body', rt, FACE, (0, 0, 0), 'y', phys='steel', segs=32, sharp=True, restitution=0.2,
                 friction=0.4)
    part.col_cyl('hub', cfg['hub_d'] / 2, 0.036, (0, (COLLAR_Y0 + 0.0155) / 2, 0), 'y', phys='steel')
    part.port('spin', 'axle', (0, COLLAR_Y0, 0), (0, -1, 0), cfg['port'], 'both', kind='axle')
    return part.save(out_path)
