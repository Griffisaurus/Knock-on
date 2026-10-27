"""Kit props: paper, card and stationery (environments.md §7). Prop space: real size, Z up, origin = footprint
centre on the floor, front = -Y. Wall / door props (poster, corkboard, magnet) have their back on the y = 0
plane and face -Y; flat props (sheet, notebook, drafting set) lie on the XY plane, face up.
No readable text anywhere: covers, spines and packaging carry colour bands and simple shapes only."""
import math

from mathutils import Matrix

from .core import at, prop

BOOK_TINTS = ('kn_env_book_red', 'kn_env_book_blue', 'kn_env_book_mustard', 'kn_env_book_green', 'kn_env_book_plum',
              'kn_env_book_navy', 'kn_cardboard', 'kn_fabric_bone')
BOOK_SIZES = ((0.20, 0.14, 0.024), (0.25, 0.18, 0.034), (0.30, 0.22, 0.045))  # height, depth, thickness
BRIGHT = ('kn_powder_ignition', 'kn_powder_cobalt', 'kn_powder_amber', 'kn_powder_volt', 'kn_powder_plasma',
          'kn_powder_beam', 'kn_powder_bone', 'kn_powder_graphite')


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


@prop('book', 'E-S', 'both', 600, variants=26)
def book(p):
    """Hardback: 3 sizes x 8 cloth tints standing upright (spine to -Y); variants 24, 25 lie open face-up."""
    v = p.v
    if v >= 24:  # open, face up: cover under two page blocks bowed up from the gutter
        h, d, t = BOOK_SIZES[1 + (v - 24)]
        cloth = BOOK_TINTS[v % 8]
        p.box((-d, -h / 2, 0.0), (d, h / 2, 0.004), cloth, r=0.0015)
        for sx in (-1, 1):
            m = at(sx * 0.003, 0, 0.004) @ rot_y(-sx * 5)
            lo, hi = (0.0, -h / 2 + 0.006, 0.0), (d - 0.008, h / 2 - 0.006, t * 0.42)
            if sx < 0:
                lo, hi = (-(d - 0.008), lo[1], 0.0), (0.0, hi[1], hi[2])
            p.box(lo, hi, 'kn_paper_tan', r=0.003, m=m)
        p.col_box((-d, -h / 2, 0), (d, h / 2, t * 0.5), 'paper')
        return
    h, d, t = BOOK_SIZES[v % 3]
    cloth = BOOK_TINTS[(v // 3) % 8]
    bt = 0.003
    for sx in (-1, 1):  # boards
        p.box((sx * t / 2 - (bt if sx > 0 else 0), -d / 2, 0.0), (sx * t / 2 + (0 if sx > 0 else bt), d / 2, h), cloth,
              r=0.0012)
    p.box((-t / 2, -d / 2 - 0.0015, 0.0), (t / 2, -d / 2 + 0.006, h), cloth, r=0.003)          # rounded spine
    p.box((-t / 2 + bt, -d / 2 + 0.004, 0.004), (t / 2 - bt, d / 2 - 0.003, h - 0.004), 'kn_paper_tan', r=0.002)
    band = 'kn_paper_tan' if cloth not in ('kn_fabric_bone', 'kn_cardboard') else 'kn_env_book_navy'
    for z in (0.025, h - 0.035):                                                                # spine bands
        p.box((-t / 2 + 0.002, -d / 2 - 0.0025, z), (t / 2 - 0.002, -d / 2, z + 0.01), band, r=0.0008)
    p.col_box((-t / 2, -d / 2, 0), (t / 2, d / 2, h), 'paper')


@prop('notebook', 'E-S', 'both', 500, variants=2)
def notebook(p):
    """Spiral notebook (A5) lying flat; variant 1 lies open."""
    w, d, t = 0.15, 0.21, 0.012
    cover = BOOK_TINTS[(p.v * 3 + 1) % 6]
    pads = [(0.0, 1.0)] if p.v == 0 else [(-w / 2 - 0.008, 1.0), (w / 2 + 0.008, -1.0)]
    for cx, side in pads:
        p.box((cx - w / 2, -d / 2, 0.0), (cx + w / 2, d / 2, 0.002), cover, r=0.001)
        p.box((cx - w / 2 + 0.003, -d / 2 + 0.003, 0.002), (cx + w / 2 - 0.003, d / 2 - 0.003, t - 0.002),
              'kn_paper_tan', r=0.0015)
        if p.v == 0:
            p.box((cx - w / 2, -d / 2, t - 0.002), (cx + w / 2, d / 2, t), cover, r=0.001)
    sx = -w / 2 + 0.008 if p.v == 0 else 0.0
    n = 6
    for i in range(n):
        y = -d / 2 + 0.015 + (d - 0.03) * i / (n - 1)
        p.torus(0.0065, 0.0011, 'kn_steel_brushed', maj=6, mn=3, m=at(sx, y, t / 2) @ rot_x(90))
    p.col_box((-w / 2 - (0.16 if p.v else 0), -d / 2, 0), (w / 2 + (0.16 if p.v else 0), d / 2, t), 'paper')


@prop('paper_sheet', 'E-S', 'both', 50, variants=4)
def paper_sheet(p):
    """Loose sheet with tape corners, face up: 0 crayon drawing, 1 pencil sketch, 2 blueprint, 3 lined note."""
    w, d = 0.21, 0.297
    base = 'kn_env_blueprint' if p.v == 2 else 'kn_paper_tan'
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, 0.0008), base, r=0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m = at(sx * (w / 2 - 0.01), sy * (d / 2 - 0.01), 0.0008) @ rot_z(45 * sx * sy)
            p.box((-0.022, -0.008, 0.0), (0.022, 0.008, 0.0005), 'kn_poly_amber', r=0.0, m=m)
    z = 0.0012
    if p.v == 0:   # crayon: sun, house, grass, a cat-ish blob
        sun = [(0.05 + 0.025 * math.cos(a / 8 * 2 * math.pi), 0.09 + 0.025 * math.sin(a / 8 * 2 * math.pi), z)
               for a in range(9)]
        p.sweep(sun, 0.0018, 'kn_powder_amber', sides=4)
        p.sweep([(-0.07, -0.02, z), (-0.07, 0.04, z), (-0.03, 0.08, z), (0.01, 0.04, z), (0.01, -0.02, z),
                 (-0.07, -0.02, z)], 0.0018, 'kn_powder_ignition', sides=4)
        p.sweep([(-0.09, -0.06, z), (-0.03, -0.05, z), (0.03, -0.065, z), (0.09, -0.055, z)], 0.002,
                'kn_powder_volt', sides=4)
        p.sweep([(0.04, -0.03, z), (0.07, -0.02, z), (0.075, 0.005, z), (0.05, 0.0, z), (0.04, -0.03, z)], 0.0016,
                'kn_powder_cobalt', sides=4)
    elif p.v == 1:  # pencil sketch of a lever
        ink = 'kn_powder_graphite'
        p.sweep([(-0.08, -0.03, z), (0.08, 0.02, z)], 0.0009, ink, sides=4)
        p.sweep([(-0.01, -0.07, z), (0.0, -0.01, z), (0.012, -0.07, z), (-0.01, -0.07, z)], 0.0009, ink, sides=4)
        p.sweep([(0.06, 0.04, z), (0.075, 0.075, z), (0.085, 0.04, z)], 0.0009, ink, sides=4)
    else:           # blueprint grid / lined note
        ink = 'kn_env_chalk' if p.v == 2 else 'kn_powder_beam'
        for i in range(7 if p.v == 2 else 10):
            y = -d / 2 + 0.03 + i * (0.035 if p.v == 2 else 0.025)
            p.sweep([(-w / 2 + 0.02, y, z), (w / 2 - 0.02, y, z)], 0.0006, ink, sides=3)
        if p.v == 2:
            p.sweep([(0.04 * math.cos(a / 10 * 2 * math.pi), 0.06 + 0.04 * math.sin(a / 10 * 2 * math.pi), z)
                     for a in range(11)], 0.0008, ink, sides=3)


POSTERS = ('machines', 'solar', 'lever', 'glyphs', 'cat', 'blueprint')


@prop('poster', 'E-S', 'lab', 100, variants=6)
def poster(p):
    """0.6 x 0.9 m wall poster (back on y = 0, faces -Y): 0 simple machines, 1 solar system, 2 parts of a lever,
    3 channel glyph chart, 4 cat cartoon, 5 blueprint. Shapes only, no words."""
    w, h, t = 0.6, 0.9, 0.003
    kind = POSTERS[p.v % 6]
    base = 'kn_env_blueprint' if kind == 'blueprint' else ('kn_powder_graphite' if kind == 'solar' else 'kn_paper_tan')
    p.box((-w / 2, -t, 0.0), (w / 2, 0.0, h), base, r=0.0)
    y = -t - 0.0012
    fr = rot_x(90)  # local XY drawing plane -> wall (x, z), drawn just proud of the face

    def dot(x, z, r, mat, segs=16):
        p.cyl((0, 0), r, 0.0, 0.0012, mat, segs=segs, bev=0.0, m=at(x, y + 0.0012, z) @ fr)

    def line(pts, r, mat):
        p.sweep([(x, y, z) for x, z in pts], r, mat, sides=4)

    if kind == 'machines':
        line([(-0.22, 0.62), (0.0, 0.72)], 0.006, 'kn_powder_cobalt')
        p.hull([(-0.03, y, 0.6), (0.03, y, 0.6), (0.0, y, 0.66), (-0.03, y - 0.002, 0.6), (0.03, y - 0.002, 0.6),
                (0.0, y - 0.002, 0.66)], 'kn_powder_ignition')
        dot(0.15, 0.3, 0.07, 'kn_powder_amber')
        dot(0.15, 0.3, 0.02, 'kn_powder_graphite')
        line([(-0.22, 0.2), (0.0, 0.2), (0.0, 0.42)], 0.005, 'kn_powder_graphite')
    elif kind == 'solar':
        dot(-0.2, 0.45, 0.08, 'kn_powder_amber', 24)
        for i, (r, c) in enumerate(((0.012, 'kn_powder_ignition'), (0.018, 'kn_powder_beam'), (0.02, 'kn_powder_cobalt'),
                                    (0.03, 'kn_powder_plasma'), (0.026, 'kn_powder_volt'))):
            dot(-0.08 + i * 0.075, 0.45 + (0.04 if i % 2 else -0.04), r, c)
    elif kind == 'lever':
        line([(-0.22, 0.42), (0.22, 0.52)], 0.008, 'kn_powder_cobalt')
        p.hull([(-0.04, y, 0.3), (0.04, y, 0.3), (0.0, y, 0.46), (-0.04, y - 0.002, 0.3), (0.04, y - 0.002, 0.3),
                (0.0, y - 0.002, 0.46)], 'kn_powder_ignition')
        dot(-0.2, 0.47, 0.035, 'kn_powder_graphite')
        line([(0.2, 0.7), (0.2, 0.58)], 0.004, 'kn_powder_ignition')
    elif kind == 'glyphs':
        cols = ('kn_powder_amber', 'kn_powder_beam', 'kn_powder_volt', 'kn_powder_plasma', 'kn_powder_ignition',
                'kn_powder_cobalt')
        for i in range(12):
            r_, c_ = divmod(i, 3)
            dot(-0.15 + c_ * 0.15, 0.75 - r_ * 0.17, 0.04, cols[i % 6])
    elif kind == 'cat':
        dot(0.0, 0.42, 0.17, 'kn_powder_bone', 24)
        for sx in (-1, 1):
            p.hull([(sx * 0.07, y, 0.55), (sx * 0.15, y, 0.55), (sx * 0.13, y, 0.68),
                    (sx * 0.07, y - 0.002, 0.55), (sx * 0.15, y - 0.002, 0.55), (sx * 0.13, y - 0.002, 0.68)],
                   'kn_powder_bone')
            dot(sx * 0.06, 0.45, 0.022, 'kn_powder_graphite')
        dot(0.0, 0.39, 0.012, 'kn_powder_plasma')
    else:
        for i in range(6):
            line([(-0.26, 0.12 + i * 0.13), (0.26, 0.12 + i * 0.13)], 0.0015, 'kn_env_chalk')
        circ = [(0.12 * math.cos(a / 16 * 2 * math.pi), 0.5 + 0.12 * math.sin(a / 16 * 2 * math.pi)) for a in range(17)]
        line(circ, 0.003, 'kn_env_chalk')


@prop('corkboard', 'E-M', 'both', 3000)
def corkboard(p):
    """0.9 x 0.6 m pinboard with an oak frame, five notes and pins (wall prop)."""
    w, h, t = 0.9, 0.6, 0.02
    p.box((-w / 2 + 0.02, -t + 0.004, 0.02), (w / 2 - 0.02, 0.0, h - 0.02), 'kn_env_cork', r=0.0)
    for lo, hi in (((-w / 2, -t, 0.0), (w / 2, 0.0, 0.025)), ((-w / 2, -t, h - 0.025), (w / 2, 0.0, h)),
                   ((-w / 2, -t, 0.0), (-w / 2 + 0.025, 0.0, h)), ((w / 2 - 0.025, -t, 0.0), (w / 2, 0.0, h))):
        p.box(lo, hi, 'kn_wood_oak', r=0.004)
    notes = ((-0.28, 0.38, 'kn_paper_tan'), (-0.08, 0.42, 'kn_powder_bone'), (0.14, 0.36, 'kn_paper_tan'),
             (0.3, 0.2, 'kn_powder_amber'), (-0.2, 0.15, 'kn_powder_beam'))
    for i, (x, z, mat) in enumerate(notes):
        m = at(x, -t + 0.004, z) @ rot_y(p.rng.uniform(-8, 8))
        p.box((-0.065, -0.0012, -0.065), (0.065, 0.0, 0.065), mat, r=0.0, m=m)
        p.sphere((x, -t - 0.004, z + 0.045), 0.006, BRIGHT[i % 5], segs=10, rings=5)


@prop('cardboard_box', 'E-S', 'both', 400, variants=6)
def cardboard_box(p):
    """Card box: 0-2 closed small / medium / large, 3 open medium, 4 open small, 5 flattened."""
    sizes = ((0.3, 0.22, 0.2), (0.45, 0.32, 0.3), (0.6, 0.4, 0.4))
    v = p.v
    if v == 5:
        p.box((-0.4, -0.3, 0.0), (0.4, 0.3, 0.008), 'kn_cardboard', r=0.002)
        p.box((-0.4, -0.02, 0.008), (0.4, 0.02, 0.009), 'kn_poly_amber', r=0.0)
        p.col_box((-0.4, -0.3, 0), (0.4, 0.3, 0.008), 'paper')
        return
    w, d, h = sizes[{0: 0, 1: 1, 2: 2, 3: 1, 4: 0}[v]]
    if v <= 2:
        p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 'kn_cardboard', r=0.006)
        p.box((-0.03, -d / 2 - 0.001, h - 0.06), (0.03, d / 2 + 0.001, h + 0.001), 'kn_poly_amber', r=0.001)
        p.box((-w / 2 + 0.002, -0.001, h - 0.0005), (w / 2 - 0.002, 0.001, h + 0.0015), 'kn_cardboard', r=0.0)
    else:
        t = 0.006
        p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, t), 'kn_cardboard', r=0.002)
        for lo, hi in (((-w / 2, -d / 2, 0), (w / 2, -d / 2 + t, h)), ((-w / 2, d / 2 - t, 0), (w / 2, d / 2, h)),
                       ((-w / 2, -d / 2, 0), (-w / 2 + t, d / 2, h)), ((w / 2 - t, -d / 2, 0), (w / 2, d / 2, h))):
            p.box(lo, hi, 'kn_cardboard', r=0.002)
        for sy in (-1, 1):  # flaps folded out and down
            m = at(0, sy * d / 2, h) @ rot_x(sy * 30)
            p.box((-w / 2 + 0.005, 0.0, -0.003), (w / 2 - 0.005, d * 0.45, 0.003), 'kn_cardboard', r=0.001,
                  m=m @ rot_x(0) if sy > 0 else m @ rot_z(180))
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'paper')


CEREAL = (('kn_powder_amber', 'kn_powder_ignition'), ('kn_powder_cobalt', 'kn_powder_bone'),
          ('kn_powder_graphite', 'kn_powder_amber'))


@prop('cereal_box', 'E-S', 'kitchen', 800, variants=3)
def cereal_box(p):
    """Invented cereal boxes ("MORNING CRUNCH" sun, "OAT ROCKETS" rocket, "COCOA COGS" cog), artwork as
    shapes only. 0.2 x 0.07 x 0.3 m."""
    w, d, h = 0.2, 0.07, 0.3
    body, accent = CEREAL[p.v % 3]
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 'kn_cardboard', r=0.004)
    p.box((-w / 2 + 0.006, -d / 2 - 0.0012, 0.01), (w / 2 - 0.006, -d / 2 + 0.002, h - 0.01), body, r=0.002)
    p.box((-w / 2 + 0.012, -d / 2 - 0.0024, h - 0.075), (w / 2 - 0.012, -d / 2, h - 0.03), accent, r=0.003)
    yf = -d / 2 - 0.002
    fr = at(0, yf, 0) @ rot_x(90)
    if p.v == 0:      # sun over a bowl
        p.cyl((0, 0), 0.04, 0.0, 0.002, accent, segs=20, bev=0.0, m=at(0.0, 0, 0.14) @ fr)
        p.cyl((0, 0), 0.06, 0.0, 0.002, 'kn_powder_bone', segs=20, bev=0.0, m=at(0, 0, 0.05) @ fr)
    elif p.v == 1:    # rocket
        p.hull([(-0.02, yf, 0.06), (0.02, yf, 0.06), (0.0, yf, 0.19), (-0.02, yf - 0.003, 0.06),
                (0.02, yf - 0.003, 0.06), (0.0, yf - 0.003, 0.19)], accent)
        p.cyl((0, 0), 0.012, 0.0, 0.003, 'kn_powder_ignition', segs=12, bev=0.0, m=at(0, 0, 0.12) @ fr)
    else:             # cog
        p.cyl((0, 0), 0.045, 0.0, 0.002, accent, segs=24, bev=0.0, m=at(0, 0, 0.13) @ fr)
        for i in range(8):
            a = i / 8 * 2 * math.pi
            m = at(0.05 * math.cos(a), yf, 0.13 + 0.05 * math.sin(a)) @ rot_y(-math.degrees(a))
            p.box((-0.008, -0.002, -0.008), (0.008, 0.0, 0.008), accent, r=0.0, m=m)
        p.cyl((0, 0), 0.015, 0.0, 0.003, 'kn_cardboard', segs=12, bev=0.0, m=at(0, 0, 0.13) @ fr)
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'paper')


@prop('crayon_box', 'E-S', 'both', 900)
def crayon_box(p):
    """Open box of 8 crayons in the brand colours."""
    w, d, h = 0.11, 0.035, 0.09
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 'kn_powder_amber', r=0.003)
    p.box((-w / 2 + 0.004, -d / 2 - 0.001, 0.025), (w / 2 - 0.004, -d / 2 + 0.002, 0.06), 'kn_powder_cobalt', r=0.002)
    for i in range(8):
        x = -w / 2 + 0.009 + i * (w - 0.018) / 7
        top = h + 0.02 + (0.006 if i % 2 else 0.0)
        p.cyl((x, 0.0), 0.0045, h - 0.02, top - 0.006, BRIGHT[i], segs=8, bev=0.0)
        p.lathe([(0.0, top - 0.006, BRIGHT[i]), (0.0045, top - 0.006, BRIGHT[i]), (0.0015, top, BRIGHT[i]),
                 (0.0, top, BRIGHT[i])], segs=8, m=at(x, 0, 0))
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'paper')


@prop('pencil_cup', 'E-S', 'both', 1500)
def pencil_cup(p):
    """Steel tin of pencils, a ruler and crayons."""
    r, h = 0.038, 0.1
    p.lathe([(0.0, 0.0, 'kn_steel_brushed'), (r, 0.0, 'kn_steel_brushed'), (r, h, 'kn_steel_brushed'),
             (r - 0.002, h, 'kn_steel_brushed'), (r - 0.002, 0.004, 'kn_steel_brushed'), (0.0, 0.004, 'kn_steel_brushed')],
            segs=24)
    for i in range(7):
        a = i / 7 * 2 * math.pi
        x, y = 0.018 * math.cos(a), 0.018 * math.sin(a)
        tilt = rot_x(p.rng.uniform(-12, 12)) @ rot_y(p.rng.uniform(-12, 12))
        m = at(x, y, 0.005) @ tilt
        col = BRIGHT[i % 6] if i % 3 else 'kn_wood_oak'
        p.cyl((0, 0), 0.0038, 0.0, 0.16 + 0.02 * (i % 3), col, segs=6, bev=0.0, m=m)
        p.lathe([(0.0, 0.16 + 0.02 * (i % 3), 'kn_wood_oak'), (0.0038, 0.16 + 0.02 * (i % 3), 'kn_wood_oak'),
                 (0.0, 0.18 + 0.02 * (i % 3), 'kn_powder_graphite')], segs=6, m=m)
    p.box((-0.004, -0.015, 0.005), (0.004, -0.012, 0.21), 'kn_wood_oak', r=0.0008, m=rot_x(6))
    p.col_cyl((0, 0), r, 0.0, h, 'steel')


@prop('drafting_set', 'E-S', 'lab', 600)
def drafting_set(p):
    """Set square, protractor, closed compass and steel rule lying flat."""
    t = 0.003
    p.prism([(-0.12, -0.06), (0.06, -0.06), (-0.12, 0.08)], 0.0, t, 'kn_poly_clear')
    arc = [(0.06 * math.cos(math.pi * i / 12), 0.06 * math.sin(math.pi * i / 12)) for i in range(13)]
    p.prism(arc, 0.0, t, 'kn_poly_amber', m=at(0.1, 0.03, 0.0))
    p.box((-0.15, -0.11, 0.0), (0.15, -0.085, 0.0015), 'kn_steel_brushed', r=0.0)
    for sx in (-1, 1):
        p.sweep([(0.13, 0.02, 0.006), (0.13 + sx * 0.006, 0.12, 0.006)], 0.0035, 'kn_steel_brushed', sides=6)
    p.cyl((0.13, 0.015), 0.006, 0.0, 0.012, 'kn_powder_graphite', segs=10)


@prop('tape_dispenser', 'E-S', 'both', 600)
def tape_dispenser(p):
    """Graphite desk dispenser with an amber tape roll."""
    p.box((-0.07, -0.03, 0.0), (0.07, 0.03, 0.035), 'kn_powder_graphite', r=0.012)
    p.hull([(-0.07, -0.03, 0.03), (-0.07, 0.03, 0.03), (-0.02, -0.03, 0.07), (-0.02, 0.03, 0.07),
            (0.04, -0.03, 0.05), (0.04, 0.03, 0.05), (0.04, -0.03, 0.03), (0.04, 0.03, 0.03)], 'kn_powder_graphite')
    m = at(0.0, 0.0, 0.06) @ rot_x(90)
    p.cyl((0, 0), 0.032, -0.012, 0.012, 'kn_poly_amber', segs=20, bev=0.002, m=m)
    p.cyl((0, 0), 0.02, -0.0125, 0.0125, 'kn_cardboard', segs=16, bev=0.0, m=m)
    p.col_box((-0.07, -0.03, 0), (0.07, 0.03, 0.09), 'powder')


@prop('magnet', 'E-S', 'both', 150, variants=6)
def magnet(p):
    """Fridge magnet (back on y = 0, faces -Y): 0 orange, 1 apple, 2 star, 3 heart, 4 letter block, 5 cloud."""
    fr = rot_x(90)
    t = 0.012
    v = p.v % 6
    if v in (0, 1):
        mat = 'kn_ceramic_ignition' if v == 0 else 'kn_ceramic_plasma'
        p.cyl((0, 0), 0.028, 0.0, t, mat, segs=12, bev=0.004, m=at(0, 0, 0) @ fr)
        p.cyl((0, 0), 0.008, t - 0.002, t + 0.003, 'kn_env_foliage', segs=8, bev=0.0, m=at(0.0, 0, 0.022) @ fr)
    elif v == 2:
        star = []
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            rr = 0.032 if i % 2 == 0 else 0.014
            star.append((rr * math.cos(a), rr * math.sin(a)))
        p.prism(star, 0.0, t, 'kn_ceramic_amber', m=fr)  # one concave prism, n-gon caps
    elif v == 3:
        for sx in (-1, 1):
            p.cyl((0, 0), 0.015, 0.0, t, 'kn_ceramic_plasma', segs=8, bev=0.0, m=at(sx * 0.012, 0, 0.008) @ fr)
        p.prism([(-0.026, 0.004), (0.026, 0.004), (0.0, -0.03)], 0.0, t, 'kn_ceramic_plasma', m=fr)
    elif v == 4:
        p.box((-0.022, -t, -0.03), (-0.01, 0.0, 0.03), 'kn_ceramic_cobalt', r=0.003)
        p.box((-0.01, -t, -0.004), (0.022, 0.0, 0.008), 'kn_ceramic_cobalt', r=0.003)
        p.box((0.01, -t, 0.008), (0.022, 0.0, 0.03), 'kn_ceramic_cobalt', r=0.003)
    else:
        for x, z, r in ((-0.02, 0.0, 0.016), (0.0, 0.008, 0.02), (0.022, 0.0, 0.015)):
            p.cyl((0, 0), r, 0.0, t, 'kn_ceramic_bone', segs=10, bev=0.002, m=at(x, 0, z) @ fr)


@prop('lunchbox', 'E-S', 'both', 1000)
def lunchbox(p):
    """Kid's lunchbox with a handle, a latch and round stickers."""
    w, d, h = 0.24, 0.1, 0.17
    p.box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 'kn_powder_cobalt', r=0.018)
    p.box((-w / 2 - 0.002, -d / 2 - 0.002, h - 0.045), (w / 2 + 0.002, d / 2 + 0.002, h - 0.04), 'kn_powder_graphite',
          r=0.002)
    p.sweep([(-0.06, 0, h - 0.005), (-0.055, 0, h + 0.04), (0.055, 0, h + 0.04), (0.06, 0, h - 0.005)], 0.007,
            'kn_rubber', sides=8)
    p.box((-0.015, -d / 2 - 0.006, h - 0.07), (0.015, -d / 2 + 0.002, h - 0.03), 'kn_steel_brushed', r=0.003)
    fr = rot_x(90)
    for x, z, r, mat in ((-0.07, 0.06, 0.025, 'kn_ceramic_amber'), (0.06, 0.05, 0.02, 'kn_ceramic_plasma'),
                         (0.0, 0.09, 0.015, 'kn_ceramic_volt')):
        p.cyl((0, 0), r, 0.0, 0.0012, mat, segs=14, bev=0.0, m=at(x, -d / 2 - 0.0012, z) @ fr)
    p.col_box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), 'powder')
