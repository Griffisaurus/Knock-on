"""Kit props: workshop things (environments.md §7). Cast iron is `kn_anod_graphite` until the M3 `kn_iron_cast`
master exists (shared_kit §5; the env pass swaps it then). No blades: nothing here reads as a part or a weapon."""
import math

from .core import at, prop
from .stationery import rot_x, rot_y, rot_z

IRON = 'kn_anod_graphite'


@prop('pegboard', 'E-M', 'lab', 2500)
def pegboard(p):
    """1.2 x 0.6 m hardboard panel on battens with steel hooks (wall prop, back on y = 0)."""
    w, h, t = 1.2, 0.6, 0.008
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        p.box((x - 0.02, -0.02, 0.0), (x + 0.02, 0.0, h), 'kn_wood_oak', r=0.003)
    p.box((-w / 2, -0.02 - t, 0.0), (w / 2, -0.02, h), 'kn_env_pegboard', r=0.003)
    # a few visible holes as dark dimples on the face, then hooks
    for i in range(10):
        for j in range(5):
            if (i + j) % 3:
                continue
            x, z = -w / 2 + 0.08 + i * 0.115, 0.07 + j * 0.115
            p.cyl((0, 0), 0.004, 0.0, 0.001, 'kn_powder_graphite', segs=6, bev=0.0, m=at(x, -0.028 - 0.0005, z) @ rot_x(90))
    for i in range(8):
        x, z = -w / 2 + 0.12 + i * 0.14, 0.35 + 0.12 * (i % 2)
        p.sweep([(x, -0.026, z), (x, -0.07, z), (x, -0.075, z + 0.02)], 0.0025, 'kn_steel_brushed', sides=5)


@prop('hand_tool', 'E-S', 'lab', 800, variants=5)
def hand_tool(p):
    """Lying flat: 0 hammer, 1 screwdriver, 2 pliers, 3 spanner, 4 hand drill (no blades)."""
    v = p.v % 5
    if v == 0:
        p.cyl((0, 0), 0.013, 0.0, 0.28, 'kn_wood_oak', segs=10, bev=0.004, m=at(0, -0.14, 0.016) @ rot_x(-90))
        p.box((-0.055, 0.12, 0.0), (0.055, 0.15, 0.032), IRON, r=0.006)
        p.cyl((0, 0), 0.016, 0.0, 0.03, IRON, segs=12, bev=0.003, m=at(-0.07, 0.135, 0.016) @ rot_y(-90))
        p.col_box((-0.085, -0.14, 0), (0.055, 0.15, 0.032), 'wood')
    elif v == 1:
        p.cyl((0, 0), 0.015, 0.0, 0.1, 'kn_powder_ignition', segs=8, bev=0.005, m=at(0, -0.12, 0.015) @ rot_x(-90))
        p.cyl((0, 0), 0.004, 0.1, 0.24, 'kn_steel_brushed', segs=6, bev=0.0, m=at(0, -0.12, 0.015) @ rot_x(-90))
        p.col_box((-0.015, -0.12, 0), (0.015, 0.12, 0.03), 'powder')
    elif v == 2:
        for s in (-1, 1):
            m = at(0, 0, 0.008) @ rot_z(s * 9)
            p.sweep([(s * 0.004, -0.12, 0.0), (s * 0.008, -0.02, 0.0), (s * 0.003, 0.02, 0.0)], 0.009, 'kn_rubber',
                    sides=6, m=m)
            p.hull([(s * 0.002, 0.015, -0.006), (s * 0.002, 0.015, 0.006), (s * 0.012, 0.015, -0.006),
                    (s * 0.012, 0.015, 0.006), (s * 0.001, 0.08, -0.004), (s * 0.001, 0.08, 0.004),
                    (s * 0.006, 0.08, -0.004), (s * 0.006, 0.08, 0.004)], 'kn_steel_brushed', m=m)
        p.cyl((0, 0), 0.008, -0.009, 0.009, 'kn_steel_brushed', segs=10, bev=0.002, m=at(0, 0.012, 0.008))
        p.col_box((-0.03, -0.13, 0), (0.03, 0.08, 0.018), 'steel')
    elif v == 3:
        p.box((-0.009, -0.09, 0.0), (0.009, 0.09, 0.006), 'kn_steel_brushed', r=0.003)
        for y, r in ((-0.1, 0.02), (0.1, 0.017)):
            p.torus(r * 0.75, r * 0.3, 'kn_steel_brushed', maj=14, mn=5, m=at(0, y, 0.004))
        p.col_box((-0.026, -0.12, 0), (0.026, 0.12, 0.01), 'steel')
    else:
        p.cyl((0, 0), 0.005, 0.0, 0.26, 'kn_steel_brushed', segs=8, bev=0.0, m=at(0, -0.13, 0.03) @ rot_x(-90))
        p.cyl((0, 0), 0.018, 0.0, 0.08, 'kn_wood_oak', segs=10, bev=0.006, m=at(0, 0.05, 0.03) @ rot_x(-90))
        p.cyl((0, 0), 0.04, -0.006, 0.006, IRON, segs=20, bev=0.002, m=at(0, -0.02, 0.04) @ rot_y(90))
        p.sweep([(0.012, -0.02, 0.04), (0.02, -0.02, 0.075), (0.045, -0.02, 0.075)], 0.004, 'kn_steel_brushed', sides=5)
        p.col_box((-0.04, -0.13, 0), (0.05, 0.13, 0.08), 'steel')


@prop('toolbox', 'E-M', 'lab', 4000)
def toolbox(p):
    """Closed cantilever toolbox: Ignition body and lid trays, steel handle and latches."""
    w, d, h = 0.45, 0.22, 0.2
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h * 0.7), 'kn_powder_ignition', r=0.012)
    for sx in (-1, 1):
        p.box((sx * 0.004 + (0 if sx > 0 else -w / 2), -d / 2, h * 0.7), (w / 2 if sx > 0 else -0.004, d / 2, h),
              'kn_powder_ignition', r=0.012)
        lx = sx * (w / 2 - 0.06)
        p.box((lx - 0.015, -d / 2 - 0.006, h * 0.55), (lx + 0.015, -d / 2 + 0.002, h * 0.75), 'kn_steel_brushed',
              r=0.003)
    p.sweep([(-0.08, 0, h), (-0.07, 0, h + 0.06), (0.07, 0, h + 0.06), (0.08, 0, h)], 0.01, 'kn_steel_brushed', sides=8)
    p.cyl((0, 0), 0.016, -0.06, 0.06, 'kn_rubber', segs=10, bev=0.005, m=at(0, 0, h + 0.06) @ rot_y(90))
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'powder')


@prop('clamp', 'E-S', 'lab', 1200, variants=2)
def clamp(p):
    """0 F-clamp (steel bar, Cobalt jaws, oak handle), 1 C-clamp (cast frame, screw, tommy bar). Lying flat."""
    if p.v == 0:
        p.box((-0.006, -0.15, 0.0), (0.006, 0.15, 0.022), 'kn_steel_brushed', r=0.002)
        p.box((-0.006, 0.12, 0.0), (0.09, 0.15, 0.024), 'kn_powder_cobalt', r=0.005)
        p.box((0.0, -0.06, 0.0), (0.09, -0.03, 0.024), 'kn_powder_cobalt', r=0.005)
        p.cyl((0, 0), 0.005, 0.0, 0.08, 'kn_steel_brushed', segs=8, bev=0.0, m=at(0.075, -0.03, 0.012) @ rot_x(-90))
        p.cyl((0, 0), 0.014, 0.0, 0.07, 'kn_wood_oak', segs=10, bev=0.005, m=at(0.075, -0.13, 0.014) @ rot_x(-90))
        p.col_box((-0.006, -0.15, 0), (0.09, 0.15, 0.028), 'steel')
    else:
        pts = [(0.0, -0.06, 0.01), (0.06, -0.06, 0.01), (0.075, 0.0, 0.01), (0.06, 0.06, 0.01), (0.0, 0.06, 0.01)]
        p.sweep(pts, 0.01, IRON, sides=8)
        p.cyl((0, 0), 0.005, 0.0, 0.1, 'kn_steel_brushed', segs=8, bev=0.0, m=at(0.0, -0.06, 0.01) @ rot_x(-90))
        p.cyl((0, 0), 0.003, -0.04, 0.04, 'kn_steel_brushed', segs=6, bev=0.0, m=at(0.0, -0.075, 0.01) @ rot_y(90))
        p.col_box((-0.04, -0.08, 0), (0.085, 0.07, 0.02), 'steel')


@prop('vice', 'E-M', 'lab', 5000)
def vice(p):
    """Bench vice: cast base and body, Cobalt jaws, steel screw and handle."""
    p.box((-0.07, -0.06, 0.0), (0.07, 0.06, 0.02), IRON, r=0.006)
    p.cyl((0, 0), 0.05, 0.02, 0.035, IRON, segs=24, bev=0.003)
    p.box((-0.07, 0.0, 0.035), (0.07, 0.05, 0.12), IRON, r=0.01)
    p.box((-0.065, -0.11, 0.035), (0.065, -0.06, 0.12), IRON, r=0.01)
    for y0, y1 in ((-0.06, -0.05), (-0.005, 0.005)):
        p.box((-0.07, y0, 0.1), (0.07, y1, 0.13), 'kn_powder_cobalt', r=0.002)
    p.box((-0.02, -0.06, 0.05), (0.02, 0.0, 0.09), 'kn_steel_brushed', r=0.004)
    p.cyl((0, 0), 0.008, 0.0, 0.05, 'kn_steel_brushed', segs=10, bev=0.0, m=at(0, -0.11, 0.07) @ rot_x(90))
    p.cyl((0, 0), 0.005, -0.08, 0.08, 'kn_steel_brushed', segs=8, bev=0.0, m=at(0, -0.16, 0.07) @ rot_y(90))
    for sx in (-1, 1):
        p.sphere((sx * 0.085, -0.16, 0.07), 0.009, 'kn_steel_brushed', segs=10, rings=5)
    p.col_box((-0.07, -0.11, 0), (0.07, 0.06, 0.13), 'steel')
    p.col_box((-0.095, -0.17, 0.06), (0.095, -0.11, 0.08), 'steel')


@prop('crate', 'E-S', 'both', 700, variants=2)
def crate(p):
    """Wooden slatted crate: 0 open, 1 lidded."""
    w, d, h = 0.5, 0.35, 0.3
    t = 0.015
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, t), 'kn_wood_oak', r=0.003)
    for z0 in (0.03, 0.17):
        for lo, hi in (((-w / 2, -d / 2, z0), (w / 2, -d / 2 + t, z0 + 0.1)),
                       ((-w / 2, d / 2 - t, z0), (w / 2, d / 2, z0 + 0.1)),
                       ((-w / 2, -d / 2, z0), (-w / 2 + t, d / 2, z0 + 0.1)),
                       ((w / 2 - t, -d / 2, z0), (w / 2, d / 2, z0 + 0.1))):
            p.box(lo, hi, 'kn_wood_oak', r=0.003)  # (two slat rows)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((sx * w / 2 - (0.03 if sx > 0 else 0), sy * d / 2 - (0.03 if sy > 0 else 0), 0.0),
                  (sx * w / 2 + (0 if sx > 0 else 0.03), sy * d / 2 + (0 if sy > 0 else 0.03), h), 'kn_wood_walnut',
                  r=0.0)
    if p.v == 1:
        for i in range(4):
            x0 = -w / 2 + i * w / 4
            p.box((x0 + 0.004, -d / 2, h), (x0 + w / 4 - 0.004, d / 2, h + t), 'kn_wood_oak', r=0.0)
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h + (t if p.v else 0)), 'wood')
