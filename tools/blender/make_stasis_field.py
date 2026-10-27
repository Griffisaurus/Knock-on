"""Procedurally build the STASIS FIELD source file (docs/art/briefs/future.md, "STASIS FIELD: Powered freeze volume
framed by corner nodes"). Resizable 0.1-1 m each way: built at the def default (0.5 x 0.5 x 0.5, packages/parts-data
src/defs_m5.ts); each node and rail is its own glb node so the engine can lay the frame out at any size. The volume
itself is engine-drawn (vfx.md §7.3).

Usage: blender -b --factory-startup -P tools/blender/make_stasis_field.py -- [out.blend]
Default output: assets/src/future/stasis_field.blend

Four squat kn_powder_graphite corner nodes (stasis_field__node_fl / fr / bl / br: 0.04 x 0.04 x 0.06 incl. FOOT_S,
4 mm pillow, centred at (±(W/2 - 0.02), ±(D/2 - 0.02))) with kn_anod_plasma caps, a kn_poly_plasma lens (Ø 0.016 on
the inner top corner, aimed 45° up and in) and an LED_D8 dome (group 0 nodes). Low graphite rails (0.012 W x 0.008 H;
stasis_field__rail_front / back / left / right, between the nodes, non-colliding trim; scale along their length)
carry 8 mm kn_led dashes every 0.05 m (group 1 rail_dashes). PR-S power port on the front-left node's front face
(-W/2 + 0.020, -D/2, 0.030). Name plate on the front-right node's front face, the stasis mark on its outer side.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Vector  # noqa: E402

import _m2  # noqa: E402
import _m5  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'stasis_field'
G, PLASMA, PPOLY, RUBBER, LED, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_rubber', 'kn_led', 'kn_steel_brushed')
MASTERS = [G, PLASMA, PPOLY, RUBBER, LED, STEEL, 'kn_decal', 'kn_poly_beam']
W, H, D = 0.5, 0.5, 0.5               # the def defaults (defs_m5.ts stasis_field width / height / depth)
NX, NY = W / 2 - 0.02, D / 2 - 0.02   # node centres
NODE_Z0, CAP_Z0, NODE_Z1 = 0.004, 0.050, 0.060
PORT = (-NX, -D / 2, 0.030)
NODES = (('fl', -1, -1), ('fr', 1, -1), ('bl', -1, 1), ('br', 1, 1))


def lens_dir(sx, sy):
    """45° up and in, along the node's inner diagonal."""
    inward = Vector((-sx, -sy, 0.0)).normalized()
    return (inward + Vector((0, 0, 1))).normalized()


def lens_point(sx, sy):
    return Vector((sx * NX, sy * NY, 0.0)) + Vector((-sx, -sy, 0.0)) * 0.0105 + Vector((0, 0, NODE_Z1 - 0.0045))


def build(lod, q, mats):
    cs = max(1, int(round((3, 2, 2, 1)[lod] * min(1.5, q))))
    pieces = {}
    for name, sx, sy in NODES:
        x, y = sx * NX, sy * NY
        node = Kit()
        node.rbox((0.040, 0.040, CAP_Z0 - NODE_Z0 + 0.001), (x, y, (NODE_Z0 + CAP_Z0 + 0.001) / 2), 0.004 if lod < 3
                  else 0.0, G, cseg=cs, rz=0.003 if lod < 3 else 0.0)
        node.rbox((0.038, 0.038, NODE_Z1 - CAP_Z0), (x, y, (CAP_Z0 + NODE_Z1) / 2), 0.0035 if lod < 3 else 0.0,
                  PLASMA, cseg=cs, rz=0.003 if lod < 3 else 0.0)
        for fx in (-1, 1):
            for fy in (-1, 1):
                _m2.foot(node, 'S', x + fx * 0.012, y + fy * 0.012, min(1.0, q), lod)
        # lens on the inner top corner (a plasma bezel + kn_poly_plasma dome), LED dome on the outer half of the top
        d = lens_dir(sx, sy)
        lp = lens_point(sx, sy)
        if lod < 3:
            node.cyl(0.0095, -0.004, 0.0015, PLASMA, seg(16, q, 6), bev=0.001 if lod < 2 else 0.0, bseg=1,
                     m=kit.frame(tuple(lp), tuple(d)))
            node.sphere(0.008, PPOLY, seg(16, q, 6), (6, 4, 3)[lod], m=kit.frame(tuple(lp + d * 0.0012), tuple(d)),
                        sz_bot=0.2, sz_top=0.55)
        else:
            node.cyl(0.008, -0.003, 0.003, PPOLY, 6, m=kit.frame(tuple(lp), tuple(d)))
        _m2.led_dome(node, 8, (x + sx * 0.008, y + sy * 0.008, NODE_Z1), (0, 0, 1), q, lod)
        node.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
        pieces['node_' + name] = node
    # rails between the nodes with LED dashes every 0.05 m
    rails = {'front': ((-NX + 0.02, -NY), (NX - 0.02, -NY)), 'back': ((-NX + 0.02, NY), (NX - 0.02, NY)),
             'left': ((-NX, -NY + 0.02), (-NX, NY - 0.02)), 'right': ((NX, -NY + 0.02), (NX, NY - 0.02))}
    for name, (a, b) in rails.items():
        r = Kit()
        a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        L = (b - a).length + 0.004
        c = (a + b) / 2
        along_x = abs(b.x - a.x) > 1e-6
        size = (L, 0.012, 0.008) if along_x else (0.012, L, 0.008)
        r.rbox(size, (c.x, c.y, 0.004), 0.003 if lod < 3 else 0.0, G, cseg=max(1, cs - 1),
               rz=0.0015 if lod < 3 else 0.0)
        n_d = int(L / 0.05)
        if lod >= 3:  # LOD3: fewer, longer dashes
            n_d = max(2, min(n_d, int(round(n_d * q * 0.5))))
        for k in range(n_d):
            t = (k + 0.5) / n_d
            p = a.lerp(b, t)
            ds = (0.008, 0.004, 0.0012) if along_x else (0.004, 0.008, 0.0012)
            r.rbox(ds, (p.x, p.y, 0.0082), 0.0012 if lod < 2 else 0.0, LED, cseg=1, rz=0.0)
        r.colors['led'] = _m2.led_attr(lambda cc, nn: (1, 0.08))
        pieces['rail_' + name] = r
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.stasis_field.bone', (NX, -D / 2, 0.026), (0, -1, 0), (0, 0, 1), 0.034),
        kit.decal_plane('trim.marks_m5', (NX + 0.020, -NY, 0.028), (1, 0, 0), (0, 0, 1), 0.022, 0.021,
                        sub=_m5.marks5('stasis')),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '%g,0.5,%g' % (W * 10, D * 10), 1.6, 'bottom', 7000,
        'Powered freeze volume framed by corner nodes, built at the def default 0.5 x 0.5 x 0.5 (resizable 0.1-1 m each '
        'way; the volume is engine-drawn). Four kn_powder_graphite nodes 0.04 x 0.04 x 0.06 (FOOT_S, 4 mm pillow) at '
        '(±(W/2 - 0.02), ±(D/2 - 0.02)), kn_anod_plasma caps, kn_poly_plasma lens Ø 0.016 on the inner top corner aimed '
        '45° up and in, LED_D8 (group 0 nodes). Graphite rails 0.012 x 0.008 between the nodes (non-colliding; scale '
        'along their length) with 8 mm kn_led dashes every 0.05 m (group 1). PR-S power in on the front-left node. Each '
        'node and rail is its own glb node. Collision: the 4 node boxes (defs_m5). '
        'Brief: docs/art/briefs/future.md#stasis-field.',
        MASTERS, led_groups='0:nodes,1:rail_dashes', skins='plasma,cryo',
        hints={'kn_resizable': True, 'kn_ref_width': W, 'kn_ref_height': H, 'kn_ref_depth': D, 'kn_need_supply': 0.75})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.0)
    for i, (name, sx, sy) in enumerate(NODES):
        part.col_box(str(i), (0.04, 0.04, 0.06), (sx * NX, sy * NY, 0.03), phys='powder')
    part.port('power', 'in', PORT, (0, -1, 0), 'S', 'in')
    for name, sx, sy in NODES:
        part.emit('field', 'node_' + name, tuple(lens_point(sx, sy)), tuple(lens_dir(sx, sy)))
    part.emit('freeze', 'volume', (0, 0, H / 2), (0, 0, 1))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
