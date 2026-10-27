"""Kit props: furniture, lamps, textiles and kitchen things (environments.md §7). Prop space as in core.py.
Wall props have their back on y = 0 and face -Y. Hung props (lamp_pendant, utensil_rail) put the origin at
the hanging point (z = 0) and hang down."""
import math

from .core import at, prop
from .stationery import rot_x, rot_y, rot_z

SHELF_UNIT_LEVELS = (0.06, 0.44, 0.82, 1.2, 1.58)   # top faces of the bottom board and the four shelves
SHELF_UNIT_SIZE = (1.0, 0.32, 2.0)
WALL_SHELF_TOP = 0.225                              # board top above the prop origin
MUG_TINTS = ('kn_ceramic_bone', 'kn_ceramic_cobalt', 'kn_ceramic_ignition', 'kn_ceramic_amber', 'kn_ceramic_beam',
             'kn_ceramic_plasma')
LAMP_SHADES = ('kn_env_enamel_green', 'kn_powder_amber', 'kn_powder_bone')


@prop('clock_wall', 'E-M', 'both', 3000)
def clock_wall(p):
    """School wall clock, Ø 0.3 m: Graphite rim, Bone face, hour ticks, hands, glass (wall prop; centre 0.15 up)."""
    c = at(0, 0, 0.15) @ rot_x(90)          # local z -> -Y (out of the wall)
    p.cyl((0, 0), 0.15, 0.0, 0.045, 'kn_powder_graphite', segs=48, bev=0.012, m=c)
    p.cyl((0, 0), 0.132, 0.044, 0.05, 'kn_powder_bone', segs=48, bev=0.0, m=c)
    for i in range(12):
        a = i / 12 * 2 * math.pi
        L = 0.02 if i % 3 else 0.03
        m = c @ at(0.115 * math.sin(a), 0.115 * math.cos(a), 0.05) @ rot_z(-math.degrees(a))
        p.box((-0.003, -L / 2, 0.0), (0.003, L / 2, 0.002), 'kn_powder_graphite', r=0.0, m=m)
    for ang, L, wdt in ((-60, 0.07, 0.006), (40, 0.1, 0.004)):
        m = c @ at(0, 0, 0.053) @ rot_z(ang)
        p.box((-wdt / 2, -0.01, 0.0), (wdt / 2, L, 0.002), 'kn_powder_graphite', r=0.0, m=m)
    p.cyl((0, 0), 0.01, 0.05, 0.058, 'kn_powder_ignition', segs=12, bev=0.0, m=c)
    p.cyl((0, 0), 0.134, 0.06, 0.064, 'kn_glass', segs=48, bev=0.002, m=c)


@prop('stool', 'E-M', 'lab', 3500)
def stool(p):
    """Lab stool: oak round seat on four splayed Cobalt legs with a foot ring and rubber feet. Seat 0.65 m."""
    p.cyl((0, 0), 0.17, 0.62, 0.66, 'kn_wood_oak', segs=32, bev=0.012)
    p.cyl((0, 0), 0.12, 0.6, 0.62, 'kn_powder_cobalt', segs=24, bev=0.004)
    for i in range(4):
        a = i / 4 * 2 * math.pi + math.pi / 4
        top, bot = (0.09 * math.cos(a), 0.09 * math.sin(a), 0.61), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.02)
        p.sweep([bot, top], 0.012, 'kn_powder_cobalt', sides=8)
        p.cyl((bot[0], bot[1]), 0.016, 0.0, 0.025, 'kn_rubber', segs=10, bev=0.004)
    p.torus(0.165, 0.008, 'kn_powder_cobalt', maj=28, mn=6, m=at(0, 0, 0.22))
    p.col_cyl((0, 0), 0.17, 0.6, 0.66, 'wood')
    p.col_box((-0.2, -0.2, 0.0), (0.2, 0.2, 0.6), 'steel')


@prop('chair_school', 'E-M', 'lab', 4000)
def chair_school(p):
    """School chair: oak ply seat and back on an Ignition tube frame."""
    p.box((-0.21, -0.2, 0.42), (0.21, 0.2, 0.445), 'kn_wood_oak', r=0.01)
    p.box((-0.2, 0.17, 0.55), (0.2, 0.2, 0.8), 'kn_wood_oak', r=0.01, m=at(0, 0.18, 0.67) @ rot_x(-8) @ at(0, -0.18, -0.67))
    for sx in (-1, 1):
        p.sweep([(sx * 0.19, -0.18, 0.0), (sx * 0.19, -0.18, 0.42), (sx * 0.19, 0.18, 0.42), (sx * 0.19, 0.2, 0.82)],
                0.011, 'kn_powder_ignition', sides=8)
        p.sweep([(sx * 0.19, 0.18, 0.0), (sx * 0.19, 0.18, 0.42)], 0.011, 'kn_powder_ignition', sides=8)
        for y in (-0.18, 0.18):
            p.cyl((sx * 0.19, y), 0.014, 0.0, 0.015, 'kn_rubber', segs=8, bev=0.004)
    p.col_box((-0.21, -0.2, 0.0), (0.21, 0.2, 0.445), 'wood')
    p.col_box((-0.21, 0.16, 0.445), (0.21, 0.24, 0.82), 'wood')


@prop('shelf_unit', 'E-L', 'both', 9000)
def shelf_unit(p):
    """1 x 2 m open bookcase module: oak carcass and shelves, Bone back panel, plinth. Empty (fill it in place)."""
    w, d, h = SHELF_UNIT_SIZE
    t = 0.025
    for sx in (-1, 1):
        x0 = sx * w / 2 - (t if sx > 0 else 0)
        p.box((x0, -d / 2, 0.0), (x0 + t, d / 2, h), 'kn_wood_oak', r=0.004)
        p.col_box((x0, -d / 2, 0.0), (x0 + t, d / 2, h), 'wood')
    p.box((-w / 2 + t, d / 2 - 0.012, 0.0), (w / 2 - t, d / 2, h), 'kn_powder_bone', r=0.002)
    p.col_box((-w / 2 + t, d / 2 - 0.012, 0.0), (w / 2 - t, d / 2, h), 'powder')
    p.box((-w / 2 + t, -d / 2 + 0.02, 0.0), (w / 2 - t, -d / 2 + 0.04, 0.04), 'kn_wood_walnut', r=0.003)
    for z in SHELF_UNIT_LEVELS + (h,):
        p.box((-w / 2 + t, -d / 2, z - t), (w / 2 - t, d / 2 - 0.012, z), 'kn_wood_oak', r=0.004)
        p.col_box((-w / 2 + t, -d / 2, z - t), (w / 2 - t, d / 2 - 0.012, z), 'wood')
    p.box((-w / 2, -d / 2, h - 0.004), (w / 2, d / 2 + 0.01, h + 0.03), 'kn_wood_oak', r=0.008)


@prop('wall_shelf', 'E-M', 'both', 2000)
def wall_shelf(p):
    """1 m oak shelf on two cast brackets (wall prop: brackets z 0..0.2, board top at 0.225)."""
    p.box((-0.5, -0.22, 0.2), (0.5, 0.0, WALL_SHELF_TOP), 'kn_wood_oak', r=0.006)
    for x in (-0.36, 0.36):
        p.hull([(x - 0.012, 0.0, 0.0), (x + 0.012, 0.0, 0.0), (x - 0.012, 0.0, 0.2), (x + 0.012, 0.0, 0.2),
                (x - 0.012, -0.18, 0.2), (x + 0.012, -0.18, 0.2), (x - 0.012, -0.03, 0.17), (x + 0.012, -0.03, 0.17)],
               'kn_anod_graphite')
    p.col_box((-0.5, -0.22, 0.2), (0.5, 0.0, WALL_SHELF_TOP), 'wood')


@prop('lamp_pendant', 'E-M', 'both', 3000, variants=3)
def lamp_pendant(p):
    """Enamel pendant shade (0 green, as in the key art; 1 Amber; 2 Bone) with an emissive bulb. Origin = the
    hanging point; 0.3 m of cord, the shade's rim 0.48 m below. A practical light (environments.md §3.4)."""
    shade = LAMP_SHADES[p.v % 3]
    p.cyl((0, 0), 0.035, -0.02, 0.0, 'kn_powder_graphite', segs=16, bev=0.006)
    p.cyl((0, 0), 0.004, -0.3, -0.02, 'kn_rubber', segs=6, bev=0.0)
    p.cyl((0, 0), 0.022, -0.34, -0.3, 'kn_powder_graphite', segs=16, bev=0.004)
    p.lathe([(0.0, -0.33, shade), (0.05, -0.33, shade), (0.07, -0.37, shade), (0.19, -0.47, shade), (0.205, -0.48, shade),
             (0.2, -0.485, 'kn_powder_bone'), (0.18, -0.476, 'kn_powder_bone'), (0.06, -0.38, 'kn_powder_bone'),
             (0.0, -0.37, 'kn_powder_bone')], segs=40)
    p.sphere((0, 0, -0.42), 0.045, 'kn_env_bulb', segs=16, rings=8)


@prop('rug', 'E-S', 'both', 500, variants=3)
def rug(p):
    """Woven striped rug, three sizes (1.2 x 0.8, 2 x 1.4, 3 x 2 m). Flat: part of the floor box."""
    w, d = ((1.2, 0.8), (2.0, 1.4), (3.0, 2.0))[p.v]
    p.slab(w, d, 0.0, 0.008, 'kn_env_book_navy', r=0.03)
    for i, mat in enumerate(('kn_fabric_bone', 'kn_env_book_mustard', 'kn_fabric_bone')):
        x = -w / 2 + w * (0.18 + 0.32 * i)
        p.box((x - w * 0.04, -d / 2 + 0.03, 0.008), (x + w * 0.04, d / 2 - 0.03, 0.0095), mat, r=0.0)


@prop('coat_hook', 'E-M', 'lab', 6000)
def coat_hook(p):
    """Oak hook rail at 1.6 m with a lab coat and a backpack (wall prop; origin on the floor at the wall)."""
    p.box((-0.45, -0.02, 1.55), (0.45, 0.0, 1.65), 'kn_wood_oak', r=0.006)
    for i in range(4):
        x = -0.33 + i * 0.22
        p.sweep([(x, -0.02, 1.6), (x, -0.07, 1.6), (x, -0.08, 1.64)], 0.006, 'kn_steel_brushed', sides=6)
    # lab coat: a soft body with sleeves and a collar
    p.hull([(-0.33 - 0.18, -0.03, 0.75), (-0.33 + 0.18, -0.03, 0.75), (-0.33 - 0.2, -0.16, 0.8), (-0.33 + 0.2, -0.16, 0.8),
            (-0.33 - 0.15, -0.03, 1.55), (-0.33 + 0.15, -0.03, 1.55), (-0.33 - 0.17, -0.13, 1.45),
            (-0.33 + 0.17, -0.13, 1.45), (-0.33, -0.08, 1.62)], 'kn_fabric_bone')
    for sx in (-1, 1):
        p.sweep([(-0.33 + sx * 0.17, -0.08, 1.45), (-0.33 + sx * 0.21, -0.1, 1.15), (-0.33 + sx * 0.2, -0.1, 0.9)], 0.045,
                'kn_fabric_bone', sides=8)
    p.box((-0.33 - 0.06, -0.165, 1.25), (-0.33 + 0.06, -0.15, 1.33), 'kn_fabric_bone', r=0.004)
    # backpack on the third hook
    p.box((0.11 - 0.15, -0.2, 1.05), (0.11 + 0.15, -0.03, 1.5), 'kn_fabric_cobalt', r=0.06)
    p.box((0.11 - 0.12, -0.23, 1.1), (0.11 + 0.12, -0.19, 1.28), 'kn_fabric_amber', r=0.03)
    p.sweep([(0.11, -0.05, 1.5), (0.11, -0.07, 1.6), (0.11, -0.05, 1.64)], 0.012, 'kn_rubber', sides=6)


@prop('mug', 'E-S', 'both', 700, variants=8)
def mug(p):
    """Ceramic mug, 6 tints (variants 0-5 empty, 6-7 holding pens)."""
    mat = MUG_TINTS[p.v % 6]
    r, h, t = 0.042, 0.095, 0.004
    p.lathe([(0.0, 0.0, mat), (r - 0.004, 0.0, mat), (r, 0.005, mat), (r, h, mat), (r - t, h, mat), (r - t, 0.008, mat),
             (0.0, 0.008, 'kn_powder_graphite' if p.v < 6 else mat)], segs=24)
    p.sweep([(r - 0.002, 0, h - 0.018), (r + 0.026, 0, h - 0.024), (r + 0.03, 0, 0.035), (r - 0.002, 0, 0.025)], 0.0065,
            mat, sides=6)
    if p.v >= 6:
        for i, col in enumerate(('kn_powder_cobalt', 'kn_powder_ignition', 'kn_powder_graphite')):
            m = at(0.01 * (i - 1), 0.008 * (i % 2), 0.01) @ rot_y(8 * (i - 1))
            p.cyl((0, 0), 0.0045, 0.0, 0.15, col, segs=6, bev=0.0, m=m)
    p.col_cyl((0, 0), r, 0.0, h, 'ceramic')


@prop('utensil_rail', 'E-S', 'kitchen', 1800)
def utensil_rail(p):
    """Steel wall rail with a wooden spoon, a spatula, a ladle and a whisk (no knives). Origin = the rail."""
    p.cyl((0, 0), 0.008, -0.4, 0.4, 'kn_steel_brushed', segs=10, bev=0.003, m=at(0, -0.04, 0) @ rot_y(90))
    for sx in (-1, 1):
        p.sweep([(sx * 0.38, 0.0, 0.0), (sx * 0.38, -0.04, 0.0)], 0.007, 'kn_steel_brushed', sides=6)
    for i, x in enumerate((-0.27, -0.09, 0.09, 0.27)):
        p.sweep([(x, -0.04, 0.012), (x, -0.052, 0.0), (x, -0.04, -0.012), (x, -0.045, -0.035)], 0.0022,
                'kn_steel_brushed', sides=4)
        top = -0.035
        if i == 0:      # wooden spoon
            p.sweep([(x, -0.045, top), (x, -0.045, top - 0.24)], 0.007, 'kn_wood_oak', sides=6)
            p.ellipsoid((x, -0.047, top - 0.28), (0.028, 0.009, 0.04), 'kn_wood_oak')
        elif i == 1:    # spatula
            p.sweep([(x, -0.045, top), (x, -0.045, top - 0.2)], 0.008, 'kn_wood_oak', sides=6)
            p.box((x - 0.035, -0.049, top - 0.3), (x + 0.035, -0.043, top - 0.2), 'kn_powder_ignition', r=0.008)
        elif i == 2:    # ladle
            p.sweep([(x, -0.045, top), (x, -0.045, top - 0.22)], 0.005, 'kn_steel_brushed', sides=6)
            p.sphere((x, -0.07, top - 0.26), 0.045, 'kn_steel_brushed', segs=16, rings=8, sz_top=0.35)
        else:           # whisk
            p.sweep([(x, -0.045, top), (x, -0.045, top - 0.12)], 0.009, 'kn_wood_oak', sides=8)
            for k in range(4):
                a = k / 4 * math.pi
                pts = [(x + 0.03 * math.cos(a) * math.sin(t / 8 * math.pi), -0.045 + 0.03 * math.sin(a) *
                        math.sin(t / 8 * math.pi), top - 0.12 - 0.17 * (1 - math.cos(t / 8 * math.pi)) / 2)
                       for t in range(9)]
                p.sweep(pts, 0.0012, 'kn_steel_brushed', sides=3)


@prop('tea_towel', 'E-S', 'kitchen', 400, variants=2)
def tea_towel(p):
    """Striped tea towel: 0 folded flat, 1 hung over a rail (origin = the rail top, drapes 0.3 m each side)."""
    if p.v == 0:
        p.box((-0.15, -0.1, 0.0), (0.15, 0.1, 0.024), 'kn_fabric_bone', r=0.008)
        p.box((-0.151, -0.1, 0.006), (0.151, -0.06, 0.018), 'kn_fabric_ignition', r=0.003)
        p.col_box((-0.15, -0.1, 0.0), (0.15, 0.1, 0.024), 'fabric')
        return
    # the drape is concave: two straight panels and a rounded fold over the rail
    for sy, L in ((-1, 0.3), (1, 0.33)):
        p.box((-0.15, sy * 0.02 - 0.003, -L), (0.15, sy * 0.02 + 0.003, 0.0), 'kn_fabric_bone', r=0.002)
        p.box((-0.151, sy * 0.02 - 0.0035, -L + 0.04), (0.151, sy * 0.02 + 0.0035, -L + 0.08), 'kn_fabric_ignition',
              r=0.001)
    p.cyl((0, 0), 0.023, -0.15, 0.15, 'kn_fabric_bone', segs=12, bev=0.0, m=at(0, 0, 0.0) @ rot_y(90))
