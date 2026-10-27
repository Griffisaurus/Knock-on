"""Kit props: glassware and science-class objects (environments.md §7). Prop space as in core.py.
Glass vessels are closed shells; liquids are separate closed shells inside at a fixed level (never simulated)."""
import math

from mathutils import Matrix, Vector

from .core import at, frame, prop
from .stationery import BRIGHT, rot_x, rot_y

LIQUIDS = ('kn_poly_beam', 'kn_poly_amber', 'kn_poly_plasma')


def cup(p, r, h, t, mat, segs=24, m=None, foot=0.0):
    """Open vessel as one closed shell: outer wall, rim, inner wall, inner floor (watertight)."""
    p.lathe([(0.0, 0.0, mat), (r - foot, 0.0, mat), (r, foot + 0.002, mat), (r, h, mat), (r - t, h, mat),
             (r - t, t, mat), (0.0, t, mat)], segs=segs, m=m)


def liquid(p, r, z0, z1, mat, segs=24, m=None):
    p.lathe([(0.0, z0, mat), (r, z0, mat), (r, z1, mat), (0.0, z1, mat)], segs=segs, m=m)


@prop('beaker', 'E-S', 'lab', 700, variants=6)
def beaker(p):
    """Beaker, 3 sizes; variants 3-5 hold a coloured liquid at a fixed level. White graduation rings."""
    r, h = ((0.035, 0.09), (0.05, 0.13), (0.07, 0.18))[p.v % 3]
    t = 0.0025
    cup(p, r, h, t, 'kn_glass', segs=20, foot=0.003)
    p.torus(r + 0.0006, 0.0022, 'kn_glass', maj=20, mn=3, m=at(0, 0, h))                       # rolled rim
    for i in range(2):
        p.torus(r + 0.0002, 0.0006, 'kn_env_chalk', maj=16, mn=3, m=at(0, 0, h * (0.3 + 0.25 * i)))
    if p.v >= 3:
        liquid(p, r - t - 0.0008, t + 0.0008, h * 0.55, LIQUIDS[p.v % 3])
    p.col_cyl((0, 0), r, 0.0, h, 'glass')


@prop('flask', 'E-S', 'lab', 900, variants=4)
def flask(p):
    """Conical (0, 2) and round-bottom (1, 3) flasks with cork stoppers; 2 and 3 hold a liquid."""
    conical = p.v % 2 == 0
    liq = LIQUIDS[(p.v // 2 + 1) % 3]
    rn = 0.013
    if conical:
        R, H = 0.055, 0.15
        p.lathe([(0.0, 0.0, 'kn_glass'), (R - 0.004, 0.0, 'kn_glass'), (R, 0.006, 'kn_glass'), (rn, H - 0.05, 'kn_glass'),
                 (rn, H, 'kn_glass'), (0.0, H, 'kn_glass')], segs=24)
        if p.v >= 2:
            p.lathe([(0.0, 0.003, liq), (R - 0.006, 0.003, liq), (R - 0.025, 0.045, liq), (0.0, 0.045, liq)], segs=24)
    else:
        R, H = 0.055, 0.17
        prof = [(0.0, 0.0, 'kn_glass')]
        a_end = math.degrees(math.asin(rn / R))
        for i in range(1, 12):
            a = math.radians(-90 + (180 - a_end) * i / 12)
            prof.append((R * math.cos(a), R + R * math.sin(a), 'kn_glass'))
        prof += [(rn, R + R * math.cos(math.radians(a_end)), 'kn_glass'), (rn, H, 'kn_glass'), (0.0, H, 'kn_glass')]
        p.lathe(prof, segs=24)
        if p.v >= 2:
            p.sphere((0, 0, R), R - 0.006, liq, segs=16, rings=6, sz_top=0.1)
        p.torus(R * 0.55, 0.008, 'kn_rubber', maj=16, mn=4, m=at(0, 0, 0.008))  # cork ring stand
    p.lathe([(0.0, H - 0.012, 'kn_wood_oak'), (rn - 0.001, H - 0.012, 'kn_wood_oak'), (rn + 0.003, H + 0.018, 'kn_wood_oak'),
             (0.0, H + 0.018, 'kn_wood_oak')], segs=16)
    p.col_cyl((0, 0), R, 0.0, H + 0.018, 'glass')


@prop('test_tube_rack', 'E-S', 'lab', 1500)
def test_tube_rack(p):
    """Oak rack with six tubes, three filled."""
    w, d = 0.2, 0.07
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, 0.015), 'kn_wood_oak', r=0.003)
    for sx in (-1, 1):
        p.box((sx * w / 2 - (0.012 if sx > 0 else 0), -0.012, 0.015), (sx * w / 2 + (0 if sx > 0 else 0.012), 0.012, 0.1),
              'kn_wood_oak', r=0.003)
    p.box((-w / 2, -d / 2 + 0.01, 0.085), (w / 2, d / 2 - 0.01, 0.095), 'kn_wood_oak', r=0.002)
    for i in range(6):
        x = -0.07 + i * 0.028
        prof = [(0.0, 0.018, 'kn_glass')]
        for k in range(1, 5):
            a = math.radians(-90 + 90 * k / 4)
            prof.append((0.008 * math.cos(a), 0.026 + 0.008 * math.sin(a), 'kn_glass'))
        prof += [(0.008, 0.16, 'kn_glass'), (0.0, 0.16, 'kn_glass')]
        p.lathe(prof, segs=12, m=at(x, 0, 0))
        if i % 2 == 0:
            liquid(p, 0.0062, 0.021, 0.07 + 0.012 * i, LIQUIDS[i // 2 % 3], segs=12, m=at(x, 0, 0))
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, 0.16), 'wood')


@prop('jar', 'E-S', 'both', 1200, variants=4)
def jar(p):
    """Screw-lid jar of 0 buttons, 1 springs, 2 cotton reels, 3 pebbles (contents never loose)."""
    r, h = 0.045, 0.12
    cup(p, r, h, 0.003, 'kn_glass', segs=20, foot=0.004)
    lid = ('kn_powder_ignition', 'kn_powder_cobalt', 'kn_powder_amber', 'kn_powder_graphite')[p.v % 4]
    p.cyl((0, 0), r + 0.002, h - 0.004, h + 0.016, lid, segs=24, bev=0.004)
    rng = p.rng
    if p.v == 0:
        for i in range(9):
            x, y = rng.uniform(-0.028, 0.028), rng.uniform(-0.028, 0.028)
            z = 0.008 + (i // 4) * 0.008
            m = at(x, y, z) @ rot_x(rng.uniform(-30, 30))
            p.cyl((0, 0), rng.uniform(0.008, 0.012), 0.0, 0.004, BRIGHT[i % 7], segs=8, bev=0.0, m=m)
    elif p.v == 1:
        for i in range(3):
            cx, cy = (-0.015, -0.012, 0.016, 0.012)[i], (-0.014, 0.016, 0.01, -0.016)[i]
            pts = [(cx + 0.009 * math.cos(t / 6 * math.pi), cy + 0.009 * math.sin(t / 6 * math.pi),
                    0.006 + t * 0.0027 + i * 0.012) for t in range(0, 24)]
            p.sweep(pts, 0.0012, 'kn_steel_brushed', sides=3)
    elif p.v == 2:
        for i, (x, y, z) in enumerate(((-0.015, -0.012, 0.004), (0.016, 0.01, 0.004), (0.0, 0.014, 0.036),
                                        (-0.012, -0.01, 0.04))):
            p.cyl((x, y), 0.012, z, z + 0.004, 'kn_wood_oak', segs=12, bev=0.001)
            p.cyl((x, y), 0.01, z + 0.004, z + 0.026, ('kn_fabric_plasma', 'kn_fabric_beam', 'kn_fabric_amber',
                                                       'kn_fabric_cobalt')[i], segs=12, bev=0.0)
            p.cyl((x, y), 0.012, z + 0.026, z + 0.03, 'kn_wood_oak', segs=12, bev=0.001)
    else:
        for i in range(10):
            x, y = rng.uniform(-0.026, 0.026), rng.uniform(-0.026, 0.026)
            p.ellipsoid((x, y, 0.012 + (i // 4) * 0.014), (0.012, 0.009, 0.007),
                        ('kn_env_rock', 'kn_ceramic_bone', 'kn_env_terracotta')[i % 3], segs=8, rings=4)
    p.col_cyl((0, 0), r + 0.002, 0.0, h + 0.016, 'glass')


@prop('rock_tray', 'E-S', 'lab', 1800)
def rock_tray(p):
    """Walnut compartment tray of mineral samples with paper labels."""
    w, d, h = 0.3, 0.2, 0.035
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, 0.008), 'kn_wood_walnut', r=0.002)
    t = 0.006
    for x in (-w / 2, -w / 4, 0.0, w / 4, w / 2):
        p.box((x - t / 2, -d / 2, 0.0), (x + t / 2, d / 2, h), 'kn_wood_walnut', r=0.0)
    for y in (-d / 2, -d / 6, d / 6, d / 2):
        p.box((-w / 2, y - t / 2, 0.0), (w / 2, y + t / 2, h), 'kn_wood_walnut', r=0.0)
    rocks = ('kn_env_rock', 'kn_ceramic_amber', 'kn_ceramic_plasma', 'kn_glass', 'kn_ceramic_bone', 'kn_env_terracotta',
             'kn_copper', 'kn_env_rock', 'kn_ceramic_beam', 'kn_powder_graphite', 'kn_brass', 'kn_ceramic_volt')
    for i in range(12):
        c, r = divmod(i, 3)
        x = -w / 2 + w / 8 + c * w / 4
        y = -d / 3 + r * d / 3
        p.ellipsoid((x, y + 0.008, 0.02), (0.022, 0.016, 0.013), rocks[i], segs=8, rings=4)
        p.box((x - 0.016, y - 0.026, 0.008), (x + 0.016, y - 0.014, 0.0095), 'kn_paper_tan', r=0.0)
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'wood')


@prop('microscope', 'E-M', 'lab', 6000)
def microscope(p):
    """Student microscope: Bone base and tube, Graphite arm and stage, chrome objectives and knobs."""
    p.box((-0.065, -0.09, 0.0), (0.065, 0.07, 0.028), 'kn_powder_bone', r=0.012)
    p.cyl((0.0, -0.035), 0.016, 0.028, 0.045, 'kn_chrome', segs=20, bev=0.002)                # lamp lens
    arc = [(0.0, 0.05 + 0.02 * math.sin(t / 8 * math.pi), 0.028 + 0.2 * t / 8) for t in range(9)]
    p.sweep(arc, 0.018, 'kn_powder_graphite', sides=12)
    p.box((-0.05, -0.085, 0.105), (0.05, 0.03, 0.115), 'kn_powder_graphite', r=0.003)          # stage
    for sx in (-1, 1):
        p.box((sx * 0.03 - 0.008, -0.07, 0.115), (sx * 0.03 + 0.008, -0.01, 0.118), 'kn_chrome', r=0.001)
        p.cyl((0, 0), 0.02, 0.0, 0.012, 'kn_chrome', segs=20, bev=0.003, m=at(sx * 0.018, 0.05, 0.16) @ rot_y(sx * 90))
        p.cyl((0, 0), 0.012, 0.012, 0.022, 'kn_powder_graphite', segs=16, bev=0.002,
              m=at(sx * 0.018, 0.05, 0.16) @ rot_y(sx * 90))
    tube = at(0.0, -0.035, 0.205) @ rot_x(-25)
    p.cyl((0, 0), 0.018, -0.05, 0.08, 'kn_powder_bone', segs=20, bev=0.004, m=tube)
    p.cyl((0, 0), 0.012, 0.08, 0.11, 'kn_powder_graphite', segs=16, bev=0.003, m=tube)
    p.cyl((0, 0), 0.026, -0.064, -0.05, 'kn_chrome', segs=20, bev=0.003, m=tube)
    for i in range(3):
        a = i / 3 * 2 * math.pi
        m = tube @ at(0.014 * math.cos(a), 0.014 * math.sin(a), -0.064)
        p.cyl((0, 0), 0.006, -0.02 - 0.006 * i, 0.0, 'kn_chrome', segs=10, bev=0.001, m=m)
    p.col_box((-0.065, -0.09, 0.0), (0.065, 0.07, 0.115), 'powder')
    p.col_box((-0.03, -0.1, 0.115), (0.03, 0.08, 0.27), 'powder')


@prop('globe', 'E-M', 'lab', 5000)
def globe(p):
    """Tilted globe on a brass meridian over a walnut stand; stylised continents, no labels."""
    R, cz = 0.13, 0.27
    p.lathe([(0.0, 0.0, 'kn_wood_walnut'), (0.085, 0.0, 'kn_wood_walnut'), (0.09, 0.012, 'kn_wood_walnut'),
             (0.07, 0.035, 'kn_wood_walnut'), (0.02, 0.045, 'kn_wood_walnut'), (0.0, 0.045, 'kn_wood_walnut')], segs=28)
    p.cyl((0, 0), 0.01, 0.04, cz - R - 0.012, 'kn_brass', segs=12, bev=0.002)
    tilt = at(0, 0, cz) @ rot_y(23.5)
    mer = [(0.0, (R + 0.012) * math.sin(math.radians(a)), (R + 0.012) * -math.cos(math.radians(a)))
           for a in range(0, 181, 12)]
    p.sweep([tuple(tilt @ Vector(v)) for v in mer], 0.005, 'kn_brass', sides=6)
    p.sphere((0, 0, 0), R, 'kn_ceramic_beam', segs=32, rings=16, m=tilt)
    for lat, lon, sx, sy in ((30, 20, 0.07, 0.05), (-15, 40, 0.05, 0.07), (45, 120, 0.08, 0.04), (-25, 150, 0.04, 0.04),
                             (10, -70, 0.05, 0.08), (-60, -20, 0.06, 0.03)):
        la, lo = math.radians(lat), math.radians(lon)
        n = Vector((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
        m = tilt @ frame(tuple(n * R * 0.985), tuple(n)) @ Matrix.Diagonal((sx, sy, 0.012, 1.0))
        p.k.sphere(1.0, 'kn_env_foliage', p.seg(12, 5), p.seg(6, 3), m=p.M @ m)
    p.cyl((0, 0), 0.006, R - 0.004, R + 0.02, 'kn_brass', segs=8, bev=0.0, m=tilt)
    p.col_cyl((0, 0), 0.09, 0.0, 0.14, 'wood')
    p.col_sphere((0, 0, cz), R, 'ceramic')


@prop('orrery', 'E-M', 'lab', 7000)
def orrery(p):
    """Static brass solar-system model on a walnut base."""
    p.lathe([(0.0, 0.0, 'kn_wood_walnut'), (0.12, 0.0, 'kn_wood_walnut'), (0.12, 0.03, 'kn_wood_walnut'),
             (0.1, 0.045, 'kn_wood_walnut'), (0.0, 0.045, 'kn_wood_walnut')], segs=32)
    p.cyl((0, 0), 0.008, 0.045, 0.22, 'kn_brass', segs=12, bev=0.002)
    p.sphere((0, 0, 0.24), 0.035, 'kn_ceramic_amber', segs=24, rings=12)
    planets = ((0.06, 0.012, 'kn_ceramic_graphite', 20), (0.09, 0.016, 'kn_ceramic_ignition', 110),
               (0.12, 0.018, 'kn_ceramic_beam', 200), (0.16, 0.014, 'kn_ceramic_plasma', 300),
               (0.21, 0.03, 'kn_ceramic_amber', 60))
    for i, (r, pr, mat, ang) in enumerate(planets):
        a = math.radians(ang)
        z = 0.08 + i * 0.025
        ex, ey = r * math.cos(a), r * math.sin(a)
        p.sweep([(0, 0, z), (ex, ey, z), (ex, ey, z + 0.07)], 0.0025, 'kn_brass', sides=6)
        p.sphere((ex, ey, z + 0.07 + pr), pr, mat, segs=16, rings=8)
    p.torus(0.26, 0.002, 'kn_brass', maj=40, mn=4, m=at(0, 0, 0.18))
    p.col_cyl((0, 0), 0.12, 0.0, 0.045, 'wood')


@prop('parts_drawers', 'E-S', 'lab', 1800)
def parts_drawers(p):
    """12-drawer unit (3 x 4) with clear fronts and small pulls."""
    w, d, h = 0.3, 0.15, 0.24
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 'kn_powder_graphite', r=0.006)
    cw, ch = (w - 0.02) / 3, (h - 0.02) / 4
    for i in range(12):
        c, r = divmod(i, 4)
        x0, z0 = -w / 2 + 0.01 + c * cw, 0.01 + r * ch
        p.box((x0 + 0.003, -d / 2 - 0.004, z0 + 0.003), (x0 + cw - 0.003, -d / 2 + 0.002, z0 + ch - 0.003),
              'kn_poly_clear', r=0.002)
        p.box((x0 + cw / 2 - 0.012, -d / 2 - 0.009, z0 + ch / 2 - 0.004), (x0 + cw / 2 + 0.012, -d / 2 - 0.004,
                                                                         z0 + ch / 2 + 0.004), 'kn_powder_graphite',
              r=0.0)
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'powder')


@prop('paint_tin', 'E-S', 'lab', 900, variants=4)
def paint_tin(p):
    """Paint tins 0-2 (three sizes, colour bands, wire handles); 3 a jar of brushes."""
    if p.v == 3:
        cup(p, 0.04, 0.11, 0.003, 'kn_glass', foot=0.003)
        for i in range(5):
            a = i / 5 * 2 * math.pi
            m = at(0.016 * math.cos(a), 0.016 * math.sin(a), 0.004) @ rot_x(8 * math.sin(a)) @ rot_y(8 * math.cos(a))
            p.cyl((0, 0), 0.004, 0.0, 0.17, 'kn_wood_oak', segs=6, bev=0.0, m=m)
            p.cyl((0, 0), 0.005, 0.17, 0.19, 'kn_steel_brushed', segs=6, bev=0.0, m=m)
            p.lathe([(0.0, 0.19, 'kn_rope'), (0.006, 0.19, 'kn_rope'), (0.004, 0.215, 'kn_rope'), (0.0, 0.215, 'kn_rope')],
                    segs=6, m=m)
        p.col_cyl((0, 0), 0.04, 0.0, 0.11, 'glass')
        return
    r, h = ((0.045, 0.06), (0.06, 0.09), (0.08, 0.12))[p.v]
    band = ('kn_powder_ignition', 'kn_powder_cobalt', 'kn_powder_volt')[p.v]
    p.cyl((0, 0), r, 0.0, h, 'kn_steel_brushed', segs=28, bev=0.003)
    p.cyl((0, 0), r + 0.0012, h * 0.25, h * 0.75, band, segs=28, bev=0.0)
    p.cyl((0, 0), r * 0.9, h, h + 0.004, 'kn_steel_brushed', segs=28, bev=0.001)
    p.sweep([(-r, 0, h * 0.8), (-r * 0.7, 0, h + r * 0.6), (r * 0.7, 0, h + r * 0.6), (r, 0, h * 0.8)], 0.0012,
            'kn_steel_brushed', sides=4)
    p.col_cyl((0, 0), r, 0.0, h, 'steel')


@prop('spool', 'E-S', 'both', 600, variants=3)
def spool(p):
    """Thread and cotton-cord spools, three sizes."""
    r, h = ((0.018, 0.05), (0.03, 0.07), (0.05, 0.1))[p.v]
    cord = ('kn_fabric_plasma', 'kn_rope', 'kn_fabric_cobalt')[p.v]
    fl = 0.006 + 0.002 * p.v
    p.cyl((0, 0), r, 0.0, fl, 'kn_wood_oak', segs=20, bev=0.002)
    p.cyl((0, 0), r * 0.82, fl, h - fl, cord, segs=20, bev=0.0)
    p.cyl((0, 0), r, h - fl, h, 'kn_wood_oak', segs=20, bev=0.002)
    p.col_cyl((0, 0), r, 0.0, h, 'wood')
