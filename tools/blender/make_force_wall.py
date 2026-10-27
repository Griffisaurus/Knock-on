"""Procedurally build the FORCE WALL source file (docs/art/briefs/future.md, "FORCE WALL: Signal-toggled energy
barrier between two pylons"). Resizable 0.1-1 m each way: built at the def default (W 0.6 x H 0.4, packages/parts-data
src/defs_m5.ts); every kit piece is its own glb node so the engine can lay the wall out at any size.

Usage: blender -b --factory-startup -P tools/blender/make_force_wall.py -- [out.blend]
Default output: assets/src/future/force_wall.blend

Two slim kn_powder_graphite pylons at x = ±(W/2 - 0.020), each a 3-piece kit:
  force_wall__base_l / _r     0.040 W x 0.040 H x 0.050 D incl. 4 mm rubber feet, 4 mm pillow (z 0-0.040)
  force_wall__column_l / _r   0.024 x 0.030 section from z 0.040 to H - 0.015 (scale it in z about z 0.040 for
                              another H), an 8 mm kn_led emitter strip on the inner face (group 0)
  force_wall__cap_l / _r      0.030 x 0.015 x 0.036 kn_anod_plasma cap (z H - 0.015 ... H) with an LED_D8 dome (group 1)
and force_wall__field: the field surface between the column inner faces (x ±(W/2 - 0.032), z 0.040 ... H - 0.015),
a 4 mm kn_poly_plasma slab with 0-1 UVs (u along +X, v up) for the engine's hex-lattice look (vfx.md §7.6); the engine
scales it to (W - 0.064) x (H - 0.055) and hides it while the wall is OFF. PR-S signal `toggle` on the left base front
(-W/2 + 0.020, -0.025, 0.022). Name plate up the left column's front, a hex mark on the right base.
"""
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

TYPE = 'force_wall'
G, PLASMA, PPOLY, RUBBER, LED, STEEL = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_rubber', 'kn_led', 'kn_steel_brushed')
MASTERS = [G, PLASMA, PPOLY, RUBBER, LED, STEEL, 'kn_decal', 'kn_poly_beam']
W, H = 0.6, 0.4                       # the def defaults (defs_m5.ts force_wall width / height)
PX = W / 2 - 0.020                    # pylon centres
INNER = W / 2 - 0.032                 # column inner faces
BASE_Z1, CAP_Z0 = 0.040, H - 0.015
PORT = (-PX, -0.025, 0.022)


def build(lod, q, mats):
    cs = max(1, int(round((3, 2, 2, 1)[lod] * min(1.5, q))))
    pieces = {}
    for side, sx in (('l', -1), ('r', 1)):
        x = sx * PX
        base = Kit()
        base.rbox((0.040, 0.050, BASE_Z1 - 0.004), (x, 0, 0.004 + (BASE_Z1 - 0.004) / 2), 0.004,
                  G, cseg=cs, rz=0.004)
        for fx in (-1, 1):
            for fy in (-1, 1):
                _m2.foot(base, 'S', x + fx * 0.012, fy * 0.017, min(1.0, q), lod)
        col = Kit()
        col.rbox((0.024, 0.030, CAP_Z0 - BASE_Z1 + 0.002), (x, 0, (BASE_Z1 + CAP_Z0) / 2), 0.003 if lod < 3 else 0.0,
                 G, cseg=max(1, cs - 1), rz=0.0)
        # emitter strip on the inner face, full height
        col.rbox((0.0016, 0.008, CAP_Z0 - BASE_Z1 - 0.006), (x - sx * 0.0124, 0, (BASE_Z1 + CAP_Z0) / 2),
                 0.0006 if lod < 2 else 0.0, LED, cseg=1, rz=0.0006 if lod < 2 else 0.0)
        col.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
        cap = Kit()
        cap.rbox((0.030, 0.036, 0.015), (x, 0, CAP_Z0 + 0.0075), 0.006, PLASMA, cseg=cs, rz=0.005)
        _m2.led_dome(cap, 8, (x, 0, H), (0, 0, 1), q, lod)
        cap.colors['led'] = _m2.led_attr(lambda c, nn: (1, 0.08))
        pieces['base_' + side] = base
        pieces['column_' + side] = col
        pieces['cap_' + side] = cap
    # the field surface: a thin closed slab with planar 0-1 UVs on its two big faces
    fld = Kit()
    bm = fld.bm
    uvl = bm.loops.layers.uv.verify()
    mi = fld.mi(PPOLY)
    x0, x1, z0, z1, t = -INNER, INNER, BASE_Z1, CAP_Z0, 0.002
    vs = {}
    for ix, xx in enumerate((x0, x1)):
        for iy, yy in enumerate((-t, t)):
            for iz, zz in enumerate((z0, z1)):
                vs[ix, iy, iz] = bm.verts.new((xx, yy, zz))
    quads = [((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),   # front (-Y)
             ((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)),   # back (+Y)
             ((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)),   # left
             ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),   # right
             ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),   # top
             ((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0))]   # bottom
    for qd in quads:
        f = bm.faces.new([vs[k] for k in qd])
        f.material_index = mi
        for loop, k in zip(f.loops, qd):
            gu, gv = float(k[0]), float(k[2])
            loop[uvl].uv = (gu, 1.0 - gv)
    pieces['field'] = fld
    nz = (BASE_Z1 + CAP_Z0) / 2
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.force_wall.bone', (-PX, -0.015, nz), (0, -1, 0), (-1, 0, 0), 0.10),
        kit.decal_plane('trim.marks_m5', (PX, -0.025, 0.022), (0, -1, 0), (0, 0, 1), 0.020, 0.019,
                        sub=_m5.marks5('hex')),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '%g,%g,0.5' % (W * 10, H * 10), 1.2, 'bottom', 4000,
        'Signal-toggled energy barrier, built at the def default W 0.6 x H 0.4 (resizable 0.1-1 m each way). Two '
        'pylons at x = ±(W/2 - 0.020), each a kit of separate nodes: base (0.040 x 0.040 x 0.050, FOOT_S), column '
        '(0.024 x 0.030, z 0.040 to H - 0.015, kn_led emitter strip on the inner face, group 0) and kn_anod_plasma cap '
        '(0.030 x 0.015 x 0.036, LED_D8 group 1). force_wall__field: 4 mm kn_poly_plasma slab between the column inner '
        'faces (x ±(W/2 - 0.032), z 0.040 to H - 0.015), 0-1 UVs, for the engine lattice (scale to (W - 0.064) x '
        '(H - 0.055), hide while OFF). PR-S signal toggle on the left base. Collision: per pylon base, column, cap '
        '(defs_m5 shapes); the field box is the engine\'s, present only while ON. '
        'Brief: docs/art/briefs/future.md#force-wall.',
        MASTERS, led_groups='0:emitter_strips,1:caps', skins='plasma,beam',
        hints={'kn_resizable': True, 'kn_ref_width': W, 'kn_ref_height': H, 'kn_column_z0': BASE_Z1,
               'kn_cap_drop': 0.015})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=2.0)
    i = 0
    for sx in (-1, 1):
        x = sx * PX
        part.col_box(str(i), (0.040, 0.050, 0.040), (x, 0, 0.020), phys='powder')
        part.col_box(str(i + 1), (0.024, 0.030, H - 0.055), (x, 0, 0.040 + (H - 0.055) / 2), phys='powder')
        part.col_box(str(i + 2), (0.030, 0.036, 0.015), (x, 0, H - 0.0075), phys='powder')
        i += 3
    part.port('signal', 'toggle', PORT, (0, -1, 0), 'S', 'in')
    mid = (BASE_Z1 + CAP_Z0) / 2
    part.emit('field', 'left', (-INNER, 0, mid), (1, 0, 0))
    part.emit('field', 'right', (INNER, 0, mid), (-1, 0, 0))
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
