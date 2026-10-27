"""Build the shared decal atlas (docs/art/briefs/shared_kit.md §6): assets/build/kit/decals_atlas.png + .json.

Usage: blender -b --factory-startup -P tools/blender/build_decals.py -- [--out DIR] [--keep-text]

4096², RGBA8, sRGB colour + linear (straight) alpha, transparent background. The layout and slot ids live in
kn_tools/decal_atlas.py. Text (regions A, A2, B, C and the COG tooth marks in D) is set in Blender with
Workbench (flat, Standard view transform, so the inks land on their exact sRGB values); pictograms (E) and
trims (F rows 1-2) are painted with numpy signed-distance shapes. Every cell keeps its 4 px transparent gutter,
then colour is dilated 8 px into transparent texels so mips don't bleed dark fringes.

Fonts (assets/src/lib/fonts, assets/LICENSES.csv), all the brief's and SIL OFL: Unbounded Bold (names, words,
numerals, marks; a static wght 700 instance of the Google Fonts variable font), Inter Medium (spec text) and
JetBrains Mono Bold (technical numerals). Unbounded has no ♯ / ♭, so slots that use them fall back to DejaVu Sans
Bold. Variable-font outlines overlap (stems through bars), and Blender fills text even-odd, which punches holes
where strokes cross: bold-face slots are filled with the non-zero rule instead (`fill_nonzero`). Blender's bundled Inter is a
variable font whose overlapping contours fill with holes in Blender text objects, so it isn't used.
"""
import json
import math
import os
import sys
import tempfile

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from kn_tools import decal_atlas as DA, library, paths  # noqa: E402

SIZE = DA.SIZE
FONT_DIR = os.path.join(paths.repo_root(), 'assets', 'src', 'lib', 'fonts')
FONTS = {'bold': 'Unbounded-Bold.ttf', 'regular': 'Inter-Medium.otf', 'mono': 'JetBrainsMono-Bold.ttf', 'fallback': 'DejaVuSans-Bold.ttf'}
NOT_IN_BOLD = set('♯♭')  # ♯ ♭: Unbounded lacks them
# (face, cap height px, minimum cap px when a long string is scaled down to fit) per slot kind
STYLE = {'name': ('bold', 30, 22), 'word': ('bold', 30, 22), 'spec': ('regular', 14, 10), 'mark': ('bold', 44, 30),
         'stamp': ('bold', 44, 14)}  # stamp: M2 single-ink marks (KN-ST, 6.5) scaled to fit the 128 px cell


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


INK = {k: hex_rgb(v) for k, v in DA.INK_HEX.items()}
AMBER = hex_rgb(DA.AMBER_HEX)
DARK = hex_rgb('#1C1E22')


# ---------------------------------------------------------------- text (Blender, Workbench)

def _flatten(sp, mw, steps=8):
    """A closed bezier spline as a polygon in atlas pixels (x right, y down)."""
    bp = sp.bezier_points
    n = len(bp)
    out = []
    for i in range(n):
        a, b = bp[i], bp[(i + 1) % n]
        p0, p1, p2, p3 = a.co, a.handle_right, b.handle_left, b.co
        for k in range(steps):
            t = k / steps
            u = 1.0 - t
            q = mw @ (p0 * (u * u * u) + p1 * (3 * u * u * t) + p2 * (3 * u * t * t) + p3 * (t * t * t))
            out.append((q.x, -q.y))
    return out


def outlines(ob):
    """A laid-out text object's glyph contours in atlas pixels; removes the object from the render."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    cu = ev.to_curve(dg)
    mw = ob.matrix_world.copy()
    polys = [_flatten(sp, mw) for sp in cu.splines if sp.type == 'BEZIER' and len(sp.bezier_points) > 1]
    ev.to_curve_clear()
    bpy.data.objects.remove(ob)
    return polys


def fill_nonzero(atlas, live, polys, rgb, ss=4):
    """Paints glyph contours into a live rect with the non-zero winding rule (what fonts are drawn for;
    Blender fills text even-odd, which punches holes where a variable font's strokes overlap)."""
    x0, y0, w, h = live
    e = np.array([(a[0], a[1], b[0], b[1]) for poly in polys for a, b in zip(poly, poly[1:] + poly[:1])], dtype=np.float64)
    e = e[e[:, 1] != e[:, 3]]
    ax, ay, bx, by = e[:, 0], e[:, 1], e[:, 2], e[:, 3]
    up = np.where(by > ay, 1, -1)
    xs = x0 + (np.arange(w * ss) + 0.5) / ss
    hit = np.zeros((h * ss, w * ss), dtype=np.float32)
    for r in range(h * ss):
        y = y0 + (r + 0.5) / ss
        m = (ay <= y) != (by <= y)
        if not m.any():
            continue
        xc = ax[m] + (y - ay[m]) * (bx[m] - ax[m]) / (by[m] - ay[m])
        order = np.argsort(xc)
        wind = np.concatenate(([0], np.cumsum(up[m][order])))
        hit[r] = wind[np.searchsorted(xc[order], xs, side='right')] != 0
    coverage = hit.reshape(h, ss, w, ss).mean(axis=(1, 3))
    dst = atlas[y0:y0 + h, x0:x0 + w]
    da = dst[..., 3]
    oa = coverage + da * (1 - coverage)
    safe = np.where(oa > 0, oa, 1)
    for k in range(3):
        dst[..., k] = (rgb[k] * coverage + dst[..., k] * da * (1 - coverage)) / safe
    dst[..., 3] = oa


def render_text(slot_table, png_path):
    """Renders the regular and mono faces with Blender; returns the bold-face slots as outlines
    [(live rect, ink, polygons)] for `fill_nonzero`."""
    vector = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    fonts = {k: bpy.data.fonts.load(os.path.join(FONT_DIR, f), check_existing=True) for k, f in FONTS.items()}
    mats = {}
    for ink, h in DA.INK_HEX.items():
        m = bpy.data.materials.new('ink_' + ink)
        m.diffuse_color = library.hexcol(h, cap=10)
        mats[ink] = m

    cap_ratio = {}
    for face, font in fonts.items():
        cu = bpy.data.curves.new('probe', 'FONT')
        cu.body = 'H'
        cu.font = font
        ob = bpy.data.objects.new('probe', cu)
        sc.collection.objects.link(ob)
        bpy.context.view_layer.update()
        cap_ratio[face] = ob.dimensions.y
        bpy.data.objects.remove(ob)

    for sid, s in slot_table.items():
        c = s['content']
        if c['kind'] not in ('name', 'word', 'spec', 'numeral', 'mark', 'stamp'):
            continue
        if c['kind'] == 'numeral':
            face, cap, cap_min = ('bold' if c['face'] == 'sans' else 'mono'), 74, 50
        else:
            face, cap, cap_min = STYLE[c['kind']]
        x, y, w, h = s['live']
        if face == 'bold' and NOT_IN_BOLD & set(c['text']):
            face = 'fallback'
        cu = bpy.data.curves.new(sid, 'FONT')
        cu.body = c['text']
        cu.font = fonts[face]
        cu.align_x = 'CENTER'
        cu.align_y = 'BOTTOM_BASELINE'
        cu.space_character = 1.02 if c['kind'] in ('name', 'word') else 1.0
        ob = bpy.data.objects.new(sid, cu)
        sc.collection.objects.link(ob)
        ob.data.materials.append(mats[c['ink']])
        bpy.context.view_layer.update()
        s_cap = cap / cap_ratio[face]
        width = ob.dimensions.x * s_cap
        live_w = w - 6
        if width > live_w:  # scale down uniformly (never condense); names may drop to the 22 px floor
            s_cap *= max(live_w / width, cap_min / cap)
        actual_cap = cap_ratio[face] * s_cap
        ob.scale = (s_cap, s_cap, 1.0)
        ob.location = (x + w / 2, -(y + h / 2 + actual_cap / 2), 0.0)
        if face == 'bold':
            vector.append((s['live'], c['ink'], outlines(ob)))

    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = SIZE
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    cam.location = (SIZE / 2, -SIZE / 2, 50.0)
    sc.camera = cam
    cam_d.clip_end = 1000
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'FLAT'
    sh.color_type = 'MATERIAL'
    sh.show_specular_highlight = False
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_shadows = False
    sc.display.render_aa = '32'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.filepath = png_path
    bpy.ops.render.render(write_still=True)
    return vector


def load_rgba(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    buf = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(SIZE, SIZE, 4)[::-1].copy()  # Blender rows run bottom-up


# ---------------------------------------------------------------- signed-distance painting

def cov(d):
    return np.clip(0.5 - d, 0.0, 1.0)


class Cell:
    """Paints into one live rect of the atlas with straight-alpha 'over'. Coordinates are cell pixels (y down)."""

    def __init__(self, atlas, live):
        self.atlas = atlas
        self.x, self.y, self.w, self.h = live
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        self.px, self.py = xx + 0.5 + 4, yy + 0.5 + 4   # +gutter: shape coords are in full-cell space

    def over(self, coverage, rgb):
        a = coverage.astype(np.float32)
        dst = self.atlas[self.y:self.y + self.h, self.x:self.x + self.w]
        da = dst[..., 3]
        oa = a + da * (1 - a)
        safe = np.where(oa > 0, oa, 1)
        for k in range(3):
            dst[..., k] = (rgb[k] * a + dst[..., k] * da * (1 - a)) / safe
        dst[..., 3] = oa


def d_circle(c, cx, cy, r):
    return np.hypot(c.px - cx, c.py - cy) - r


def d_seg(c, ax, ay, bx, by, r):
    pax, pay = c.px - ax, c.py - ay
    bax, bay = bx - ax, by - ay
    t = np.clip((pax * bax + pay * bay) / max(bax * bax + bay * bay, 1e-9), 0, 1)
    return np.hypot(pax - bax * t, pay - bay * t) - r


def d_poly(c, pts):
    """Signed distance to a closed polygon (negative inside, even-odd)."""
    d = np.full(c.px.shape, 1e9, dtype=np.float32)
    inside = np.zeros(c.px.shape, dtype=bool)
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        d = np.minimum(d, d_seg(c, ax, ay, bx, by, 0.0))
        cond = ((ay > c.py) != (by > c.py)) & (c.px < (bx - ax) * (c.py - ay) / ((by - ay) or 1e-9) + ax)
        inside ^= cond
    return np.where(inside, -d, d)


def d_polyline(c, pts, r):
    d = np.full(c.px.shape, 1e9, dtype=np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        d = np.minimum(d, d_seg(c, ax, ay, bx, by, r))
    return d


def d_arc(c, cx, cy, rad, a0, a1, r):
    """Stroke of radius r along a circle arc from angle a0 to a1 (radians, y-down screen angles)."""
    pts = [(cx + rad * math.cos(a0 + (a1 - a0) * i / 48), cy + rad * math.sin(a0 + (a1 - a0) * i / 48))
           for i in range(49)]
    return d_polyline(c, pts, r)


def d_rrect(c, x0, y0, x1, y1, rad):
    cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 - rad, (y1 - y0) / 2 - rad
    qx, qy = np.abs(c.px - cx) - hx, np.abs(c.py - cy) - hy
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - rad


def arrowhead(tip, direction, size):
    dx, dy = direction
    n = math.hypot(dx, dy)
    dx, dy = dx / n, dy / n
    bx, by = tip[0] - dx * size, tip[1] - dy * size
    return [(tip[0] + dx * size * 0.15, tip[1] + dy * size * 0.15), (bx - dy * size * 0.62, by + dx * size * 0.62),
            (bx + dy * size * 0.62, by - dx * size * 0.62)]


# Pictogram symbols in a unit box (u right, v down), drawn with 16 px strokes (§6.2).
def symbol(c, name, box, ink):
    bx, by, bs = box
    S = 8.0  # stroke half-width: 16 px

    def P(u, v):
        return (bx + u * bs, by + v * bs)

    def seg(u0, v0, u1, v1, r=S):
        return d_seg(c, *P(u0, v0), *P(u1, v1), r)

    def circ(u, v, rr):
        return d_circle(c, *P(u, v), rr * bs)

    def ring(u, v, rr, r=S):
        return np.abs(np.hypot(c.px - P(u, v)[0], c.py - P(u, v)[1]) - rr * bs) - r

    def arc(u, v, rr, a0, a1, r=S):
        return d_arc(c, *P(u, v), rr * bs, math.radians(a0), math.radians(a1), r)

    def poly(pts):
        return d_poly(c, [P(u, v) for u, v in pts])

    def line(pts, r=S):
        return d_polyline(c, [P(u, v) for u, v in pts], r)

    def head(tip_uv, dir_uv, size=0.2):
        return d_poly(c, arrowhead(P(*tip_uv), dir_uv, size * bs))

    ds = []
    if name == 'explosive':
        ds = [circ(0.40, 0.62, 0.30), seg(0.58, 0.40, 0.70, 0.24), seg(0.80, 0.16, 0.98, 0.10, 6),
              seg(0.80, 0.16, 0.86, 0.0, 6), seg(0.80, 0.16, 0.98, 0.28, 6)]
    elif name == 'flammable':
        ds = [poly([(0.50, 0.0), (0.68, 0.26), (0.78, 0.50), (0.74, 0.70), (0.60, 0.82), (0.40, 0.82),
                    (0.26, 0.70), (0.22, 0.50), (0.32, 0.34), (0.41, 0.46), (0.43, 0.24)]),
              seg(0.14, 0.97, 0.86, 0.97)]
    elif name == 'hot_surface':
        for u in (0.28, 0.5, 0.72):
            ds.append(line([(u + 0.06 * math.sin(k / 10 * 2 * math.pi), 0.04 + 0.62 * k / 10) for k in range(11)]))
        ds.append(d_rrect(c, *P(0.06, 0.82), *P(0.94, 0.98), 6))
    elif name == 'high_voltage':
        ds = [poly([(0.62, 0.0), (0.24, 0.56), (0.47, 0.56), (0.34, 1.0), (0.80, 0.40), (0.56, 0.40), (0.74, 0.0)])]
    elif name == 'rotating_parts':
        ds = [ring(0.5, 0.56, 0.20)]
        for k in range(8):
            a = 2 * math.pi * k / 8
            ds.append(seg(0.5 + 0.24 * math.cos(a), 0.56 + 0.24 * math.sin(a),
                          0.5 + 0.33 * math.cos(a), 0.56 + 0.33 * math.sin(a), 7))
        ds += [arc(0.5, 0.56, 0.47, 200, 330, 6)]
        a = math.radians(330)
        ds.append(head((0.5 + 0.47 * math.cos(a) + 0.04, 0.56 + 0.47 * math.sin(a) + 0.07), (0.45, 1.0), 0.17))
    elif name == 'pinch_point':
        ds = [ring(0.27, 0.66, 0.20), ring(0.73, 0.66, 0.20), seg(0.5, 0.0, 0.5, 0.26), head((0.5, 0.44), (0, 1))]
    elif name == 'light_beam':
        st = [(0.20 + 0.20 * math.cos(math.pi / 4 * k) * (1 if k % 2 == 0 else 0.4),
               0.5 + 0.20 * math.sin(math.pi / 4 * k) * (1 if k % 2 == 0 else 0.4)) for k in range(8)]
        ds = [poly(st), seg(0.44, 0.5, 1.0, 0.5, 10), seg(0.46, 0.36, 0.98, 0.22, 5), seg(0.46, 0.64, 0.98, 0.78, 5)]
    elif name == 'magnetic_field':
        ds = [arc(0.5, 0.52, 0.27, 0, 180, 12), seg(0.23, 0.52, 0.23, 0.18, 12), seg(0.77, 0.52, 0.77, 0.18, 12),
              seg(0.23, 0.14, 0.23, 0.02, 12), seg(0.77, 0.14, 0.77, 0.02, 12),
              arc(0.5, 0.18, 0.42, 200, 340, 5)]
    elif name == 'fragile':
        ds = [np.abs(d_rrect(c, *P(0.18, 0.04), *P(0.82, 0.96), 8)) - S,
              line([(0.46, 0.04), (0.56, 0.32), (0.42, 0.56), (0.60, 0.96)], 6)]
    elif name == 'pressurised':
        ds = [d_rrect(c, *P(0.28, 0.26), *P(0.72, 1.0), 0.16 * bs), seg(0.5, 0.26, 0.5, 0.10),
              seg(0.32, 0.06, 0.68, 0.06)]
    elif name == 'wireless':
        ds = [circ(0.5, 0.86, 0.09)]
        for rr in (0.26, 0.50, 0.74):
            ds.append(arc(0.5, 0.86, rr, -135, -45))
    elif name == 'recycle':
        for k in range(3):
            a0 = -90 + 120 * k + 12
            a1 = a0 + 90
            ds.append(arc(0.5, 0.56, 0.36, a0, a1))
            a = math.radians(a1)
            tip = (0.5 + 0.36 * math.cos(a), 0.56 + 0.36 * math.sin(a))
            ds.append(head((tip[0] - 0.05 * math.sin(a), tip[1] + 0.05 * math.cos(a)),
                           (-math.sin(a), math.cos(a)), 0.2))
    elif name == 'critter_friendly':
        pad = [(0.5 + 0.24 * math.cos(2 * math.pi * k / 24), 0.70 + 0.19 * math.sin(2 * math.pi * k / 24))
               for k in range(24)]
        ds = [poly(pad), circ(0.18, 0.40, 0.10), circ(0.38, 0.20, 0.10), circ(0.62, 0.20, 0.10),
              circ(0.82, 0.40, 0.10)]
    elif name == 'keep_clear':
        ds = [np.abs(d_rrect(c, *P(0.32, 0.32), *P(0.68, 0.68), 4)) - S]
        for (u0, v0, u1, v1) in ((0.5, 0.26, 0.5, 0.08), (0.5, 0.74, 0.5, 0.92), (0.26, 0.5, 0.08, 0.5),
                                 (0.74, 0.5, 0.92, 0.5)):
            ds.append(seg(u0, v0, u1, v1, 6))
            ds.append(head((u1 + (u1 - u0) * 0.4, v1 + (v1 - v0) * 0.4), (u1 - u0, v1 - v0), 0.16))
    elif name == 'blades':
        ds = [ring(0.24, 0.80, 0.13, 7), ring(0.76, 0.80, 0.13, 7), seg(0.33, 0.70, 0.80, 0.02),
              seg(0.67, 0.70, 0.20, 0.02), circ(0.5, 0.46, 0.06)]
    elif name == 'launch':
        ds = [seg(0.04, 0.96, 0.50, 0.96), arc(0.92, 0.92, 0.66, 180, 262), head((0.98, 0.26), (1.0, -0.05), 0.22)]
    d = ds[0]
    for e in ds[1:]:
        d = np.minimum(d, e)
    c.over(cov(d), ink)


TRI = [(128.0, 20.0), (240.0, 216.0), (16.0, 216.0)]


def tri_inset(d):
    """Warning triangle with every edge moved inward by d (scaled about the incentre)."""
    (ax, ay), (bx, by), (cx, cy) = TRI
    la, lb, lc = math.hypot(bx - cx, by - cy), math.hypot(ax - cx, ay - cy), math.hypot(ax - bx, ay - by)
    p = la + lb + lc
    ix, iy = (la * ax + lb * bx + lc * cx) / p, (la * ay + lb * by + lc * cy) / p
    s_ = p / 2
    rho = math.sqrt(s_ * (s_ - la) * (s_ - lb) * (s_ - lc)) / s_
    k = (rho - d) / rho
    return [(ix + (x - ix) * k, iy + (y - iy) * k) for x, y in TRI]


def picto(atlas, live, name, style):
    """Row 1 warn: Amber rounded triangle, 14 px Graphite border, Graphite symbol. Row 2 mono: Bone outline
    and symbol on transparent (for dark plates)."""
    c = Cell(atlas, live)
    rr = 18.0
    shape = d_poly(c, tri_inset(rr)) - rr          # rounded triangle
    border = np.maximum(shape, -(shape + 14.0))
    ink = INK['graphite'] if style == 'warn' else INK['bone']
    if style == 'warn':
        c.over(cov(shape), AMBER)
    c.over(cov(border), ink)
    symbol(c, name, (85, 112, 86), ink)


def glyph(atlas, live, name, ink):
    """M2 (E1) region D glyphs in a 128 px cell (cell coords, y down): the in / out / both / rotate-CW arrows
    and the five-point star, single ink on transparent."""
    c = Cell(atlas, live)
    S = 9.0
    if name == 'arrow_out':
        ds = [d_seg(c, 22, 34, 22, 94, S), d_seg(c, 30, 64, 84, 64, S), d_poly(c, arrowhead((110, 64), (1, 0), 34))]
    elif name == 'arrow_in':
        ds = [d_seg(c, 18, 64, 70, 64, S), d_poly(c, arrowhead((96, 64), (1, 0), 34)), d_seg(c, 106, 34, 106, 94, S)]
    elif name == 'arrow_both':
        ds = [d_seg(c, 40, 64, 88, 64, S), d_poly(c, arrowhead((116, 64), (1, 0), 32)),
              d_poly(c, arrowhead((12, 64), (-1, 0), 32))]
    elif name == 'arrow_rotate':
        a1 = math.radians(200)
        ds = [d_arc(c, 64, 66, 38, math.radians(-70), a1, S)]
        tip = (64 + 38 * math.cos(a1), 66 + 38 * math.sin(a1))
        ds.append(d_poly(c, arrowhead((tip[0] + 6, tip[1] - 14), (0.35, -1.0), 30)))
    elif name == 'star':
        pts = [(64 + (54 if k % 2 == 0 else 22) * math.cos(-math.pi / 2 + math.pi * k / 5),
                66 + (54 if k % 2 == 0 else 22) * math.sin(-math.pi / 2 + math.pi * k / 5)) for k in range(10)]
        ds = [d_poly(c, pts) - 2.0]
    else:
        raise ValueError('unknown glyph %r' % name)
    d = ds[0]
    for e in ds[1:]:
        d = np.minimum(d, e)
    c.over(cov(d), INK[ink])


def m3_mark(c, name, cx, cy):
    """M3 (E3a) marks for trim.marks_m3, centred on (cx, cy) in a ~127 x 120 px sub-cell (y down); SDF list."""
    S = 7.0
    if name == 'beam_break':  # a beam broken by a slash: TRIPWIRE "BREAK" mode
        return [d_seg(c, cx - 50, cy, cx - 16, cy, S), d_seg(c, cx + 16, cy, cx + 44, cy, S),
                d_poly(c, arrowhead((cx + 56, cy), (1, 0), 22)), d_seg(c, cx - 10, cy + 30, cx + 10, cy - 30, S * 0.8)]
    if name == 'beam_lit':  # a small sun with 8 rays: TRIPWIRE "LIT" mode
        out = [d_circle(c, cx, cy, 17)]
        for k in range(8):
            a = math.pi * k / 4
            out.append(d_seg(c, cx + 29 * math.cos(a), cy + 29 * math.sin(a), cx + 46 * math.cos(a),
                             cy + 46 * math.sin(a), S * 0.75))
        return out
    if name in ('zone_down', 'zone_up'):  # double chevrons: gravity (down) / antigrav (up)
        s = 1 if name == 'zone_down' else -1
        out = []
        for off in (-18, 18):
            y0 = cy + off * s - 16 * s
            out.append(d_polyline(c, [(cx - 34, y0), (cx, y0 + 30 * s), (cx + 34, y0)], S))
        return out
    if name == 'zone_wind':  # three streaks with curled tips
        out = []
        for dy, x0, x1 in ((-30, -48, 30), (0, -36, 44), (30, -48, 20)):
            out.append(d_seg(c, cx + x0, cy + dy, cx + x1, cy + dy, S * 0.8))
            out.append(d_arc(c, cx + x1, cy + dy - 9, 9, math.pi / 2, -math.pi, S * 0.8))
        return out
    if name == 'zone_stasis':  # snowflake inside a clock ring: stasis
        out = [d_arc(c, cx, cy, 50, 0, 2 * math.pi, S * 0.7)]
        for k in range(3):
            a = math.pi / 2 + math.pi * k / 3
            out.append(d_seg(c, cx - 34 * math.cos(a), cy - 34 * math.sin(a), cx + 34 * math.cos(a),
                             cy + 34 * math.sin(a), S * 0.7))
        return out
    if name == 'tick':  # a rounded vertical bar (SPINDECK rim ticks; sampled narrow)
        return [d_seg(c, cx, cy - 44, cx, cy + 44, 14.0)]
    if name == 'potter':  # potter's mark: a ring with a spiral inside
        pts = [(cx + (6 + 30 * t) * math.cos(6.0 * t * math.pi), cy + (6 + 30 * t) * math.sin(6.0 * t * math.pi))
               for t in [i / 240 for i in range(241)]]
        return [d_arc(c, cx, cy, 48, 0, 2 * math.pi, S * 0.8), d_polyline(c, pts, S)]
    raise ValueError('unknown M3 mark %r' % name)


M4_COL = {'ignition': hex_rgb('#FF5B2E'), 'volt': hex_rgb('#C6FF3A'), 'amber': hex_rgb(DA.AMBER_HEX),
          'beam': hex_rgb('#2FD6FF'), 'tan': hex_rgb('#E8D3A8'), 'golden': hex_rgb('#D9A04A'),
          'sand': hex_rgb('#D8C39A')}


def m4_mark(c, name, cx, cy):
    """M4 (E4a) marks for trim.marks_m4, centred on (cx, cy) in a ~127 x 120 px sub-cell (y down); a list of
    (signed distance, rgb) layers painted in order."""
    S = 7.0
    if name == 'kn_stamp':  # YOLK: "KN" in Ignition ink, stroked letters inside a thin oval ring
        k = [d_seg(c, cx - 38, cy - 26, cx - 38, cy + 26, S), d_seg(c, cx - 36, cy + 2, cx - 10, cy - 26, S),
             d_seg(c, cx - 28, cy - 6, cx - 8, cy + 26, S)]
        n = [d_polyline(c, [(cx + 8, cy + 26), (cx + 8, cy - 26), (cx + 38, cy + 26), (cx + 38, cy - 26)], S)]
        ring = d_arc(c, cx, cy, 52, 0, 2 * math.pi, 3.0)
        d = ring
        for e in k + n:
            d = np.minimum(d, e)
        return [(d, M4_COL['ignition'])]
    if name == 'gauge_dial':  # INFLATOR: bone face, graphite ticks, Volt band -135..+90 deg, Amber band +90..+135
        face = d_circle(c, cx, cy, 56)
        # dial angles measured clockwise from straight up (screen y down)
        def ang(deg):
            return math.radians(deg - 90.0)
        volt = d_arc(c, cx, cy, 44, ang(-135), ang(90), 6.0)
        amber = d_arc(c, cx, cy, 44, ang(90), ang(135), 6.0)
        ticks = np.full(c.px.shape, 1e9, dtype=np.float32)
        for k in range(11):
            a = ang(-135 + 27 * k)
            ticks = np.minimum(ticks, d_seg(c, cx + 30 * math.cos(a), cy + 30 * math.sin(a), cx + 37 * math.cos(a),
                                            cy + 37 * math.sin(a), 2.2))
        hub = d_circle(c, cx, cy, 5)
        return [(face, INK['bone']), (volt, M4_COL['volt']), (amber, M4_COL['amber']), (np.minimum(ticks, hub),
                                                                                          INK['graphite'])]
    if name == 'brown_dial':  # TOAST CANNON: five dots light tan -> golden round a 270 deg arc, on bone
        face = d_circle(c, cx, cy, 56)
        out = [(face, INK['bone'])]
        for k in range(5):
            a = math.radians(-225 + 270 * k / 4 - 90 + 90)
            t = k / 4
            col = M4_COL['tan'] * (1 - t) + M4_COL['golden'] * t
            out.append((d_circle(c, cx + 40 * math.cos(a), cy + 40 * math.sin(a), 8.5 + 1.2 * k), col))
        out.append((d_circle(c, cx, cy, 6), INK['graphite']))
        return out
    if name == 'drop':  # a Beam water drop
        pts = [(cx + 34 * math.sin(t) * (1 - 0.0 * t), cy + 14 - 34 * math.cos(t)) for t in
               [math.pi * (0.25 + 1.5 * i / 40) for i in range(41)]]
        d = np.minimum(d_poly(c, pts + [(cx, cy - 52)]), d_circle(c, cx, cy + 14, 34))
        return [(d, M4_COL['beam'])]
    if name == 'grains':  # three sand grains
        d = np.minimum(np.minimum(d_circle(c, cx - 24, cy + 16, 18), d_circle(c, cx + 24, cy + 16, 18)),
                       d_circle(c, cx, cy - 22, 18))
        return [(d, M4_COL['sand'])]
    return []  # spare cells stay transparent


M5_COL = {'slime': hex_rgb('#7DFF7A')}


def m5_mark(c, name, cx, cy):
    """M5 (E5a) marks for trim.marks_m5, centred on (cx, cy) in a ~127 x 120 px sub-cell (y down); a list of
    (signed distance, rgb) layers painted in order."""
    S = 7.0
    bone = INK['bone']
    if name == 'pair':  # RIFT GATE pair glyph: two linked rings
        d = np.minimum(d_arc(c, cx - 18, cy, 30, 0, 2 * math.pi, S), d_arc(c, cx + 18, cy, 30, 0, 2 * math.pi, S))
        return [(d, bone)]
    if name == 'buzz':  # BUZZ BEACON pad glyph: Buzz from above, a pebble body with four ducted rings
        body = np.hypot((c.px - cx) / 1.15, c.py - cy) - 20
        d = body
        for sx in (-1, 1):
            for sy in (-1, 1):
                d = np.minimum(d, d_arc(c, cx + sx * 36, cy + sy * 32, 16, 0, 2 * math.pi, 5.0))
                d = np.minimum(d, d_seg(c, cx + sx * 12, cy + sy * 10, cx + sx * 26, cy + sy * 23, 5.0))
        return [(d, bone)]
    if name in ('letter_a', 'letter_b'):  # GRABBER zone letters, stroked
        if name == 'letter_a':
            d = np.minimum(d_polyline(c, [(cx - 32, cy + 44), (cx, cy - 44), (cx + 32, cy + 44)], 8.5),
                           d_seg(c, cx - 18, cy + 12, cx + 18, cy + 12, 8.5))
        else:
            d = d_polyline(c, [(cx - 24, cy + 44), (cx - 24, cy - 44), (cx + 8, cy - 44)], 8.5)
            d = np.minimum(d, d_arc(c, cx + 8, cy - 22, 22, -math.pi / 2, math.pi / 2, 8.5))
            d = np.minimum(d, d_seg(c, cx - 24, cy, cx + 10, cy, 8.5))
            d = np.minimum(d, d_arc(c, cx + 10, cy + 22, 22, -math.pi / 2, math.pi / 2, 8.5))
            d = np.minimum(d, d_seg(c, cx - 24, cy + 44, cx + 10, cy + 44, 8.5))
        return [(d, bone)]
    if name == 'chevrons':  # COILGUN RING boost direction: two chevrons pointing up the tile (+v = boost)
        d = np.full(c.px.shape, 1e9, dtype=np.float32)
        for off in (-22, 18):
            d = np.minimum(d, d_polyline(c, [(cx - 36, cy + off + 18), (cx, cy + off - 16), (cx + 36, cy + off + 18)],
                                         S * 1.2))
        return [(d, bone)]
    if name == 'goo_drop':  # GOO VAT: a slime drop with a bubble highlight
        pts = [(cx + 34 * math.sin(t), cy + 14 - 34 * math.cos(t)) for t in
               [math.pi * (0.25 + 1.5 * i / 40) for i in range(41)]]
        d = np.minimum(d_poly(c, pts + [(cx, cy - 52)]), d_circle(c, cx, cy + 14, 34))
        return [(d, M5_COL['slime']), (d_circle(c, cx - 12, cy + 6, 7), bone)]
    if name == 'hex':  # FORCE WALL: one hex cell outline
        pts = [(cx + 44 * math.cos(math.pi / 6 + math.pi / 3 * k), cy + 44 * math.sin(math.pi / 6 + math.pi / 3 * k))
               for k in range(7)]
        return [(d_polyline(c, pts, S), bone)]
    if name == 'stasis':  # STASIS FIELD: an hourglass inside a clock ring
        out = d_arc(c, cx, cy, 50, 0, 2 * math.pi, S * 0.7)
        glass = d_polyline(c, [(cx - 22, cy - 30), (cx + 22, cy - 30), (cx - 22, cy + 30), (cx + 22, cy + 30),
                               (cx - 22, cy - 30)], S * 0.7)
        return [(np.minimum(out, glass), bone)]
    return []


def trim(atlas, live, name):
    x, y, w, h = live
    ss = 4
    yy, xx = np.mgrid[0:h * ss, 0:w * ss].astype(np.float32)
    px, py = (xx + 0.5) / ss + 4, (yy + 0.5) / ss + 4

    def down(a):
        return a.reshape(h, ss, w, ss).mean(axis=(1, 3))
    rgb = np.zeros((h, w, 3), dtype=np.float32)
    alpha = np.zeros((h, w), dtype=np.float32)
    if name.startswith('hazard'):
        pitch = 32.0 if 'narrow' in name else 64.0
        right = name in ('hazard_r', 'hazard_r_cap_l', 'hazard_r_cap_r', 'hazard_narrow_r')
        diag = (px + py) if right else (px - py)   # y down: x + y = const leans right
        amber = (np.mod(diag, pitch) < pitch / 2).astype(np.float32)
        a = down(amber)
        rgb = a[..., None] * AMBER + (1 - a[..., None]) * INK['graphite']
        alpha[:] = 1.0
        if 'cap' in name:
            r = (h - 0) / 2
            c = Cell.__new__(Cell)
            c.px, c.py = px, py
            if name.endswith('cap_l'):
                d = d_rrect(c, 4, 4, 4 + w + 2 * r, 4 + h, r)
            else:
                d = d_rrect(c, 4 - 2 * r, 4, 4 + w, 4 + h, r)
            alpha = down((d < 0).astype(np.float32))
    elif name == 'tape_graphite':
        rgb[:] = INK['graphite']
        alpha[:] = 1.0
    elif name == 'face_gotcha':  # M2 (E1): GOTCHA BOX sprite face in the left 256 x 128 px (FACE_SUB)
        c = Cell.__new__(Cell)
        c.px, c.py = px, py
        dark = INK['graphite'] * 0.55
        eyes = np.minimum(np.hypot((px - 88) / 0.8, py - 40) - 19, np.hypot((px - 176) / 0.8, py - 40) - 19)
        glint = np.minimum(d_circle(c, 95, 32, 6.0), d_circle(c, 183, 32, 6.0))
        a0, a1 = math.radians(38), math.radians(142)
        grin = d_arc(c, 132, 8, 96, a0, a1, 9)
        face = down((np.minimum(eyes, grin) < 0).astype(np.float32))
        g = down((glint < 0).astype(np.float32))
        rgb[:] = dark
        rgb = rgb * (1 - g[..., None]) + INK['bone'] * g[..., None]
        alpha = face
    elif name == 'marks_m3':  # M3 (E3a): 8 Bone marks, one per 1/8 of the tile (decal_atlas.MARKS_M3)
        c = Cell.__new__(Cell)
        c.px, c.py = px, py
        d = np.full(px.shape, 1e9, dtype=np.float32)
        cw = w / 8.0
        for i, mk in enumerate(DA.MARKS_M3):
            for e in m3_mark(c, mk, 4 + cw * (i + 0.5), 4 + h / 2.0):
                d = np.minimum(d, e)
        alpha = down((d < 0).astype(np.float32))
        rgb[:] = INK['bone']
    elif name == 'marks_m4':  # M4 (E4a): 8 coloured marks, one per 1/8 of the tile (decal_atlas.MARKS_M4)
        c = Cell.__new__(Cell)
        c.px, c.py = px, py
        cw = w / 8.0
        for i, mk in enumerate(DA.MARKS_M4):
            for d, col in m4_mark(c, mk, 4 + cw * (i + 0.5), 4 + h / 2.0):
                a = down((d < 0).astype(np.float32))
                rgb = rgb * (1 - a[..., None]) + np.asarray(col, dtype=np.float32) * a[..., None]
                alpha = np.maximum(alpha, a)
    elif name == 'marks_m5':  # M5 (E5a): 8 marks, one per 1/8 of the tile (decal_atlas.MARKS_M5)
        c = Cell.__new__(Cell)
        c.px, c.py = px, py
        cw = w / 8.0
        for i, mk in enumerate(DA.MARKS_M5):
            for d, col in m5_mark(c, mk, 4 + cw * (i + 0.5), 4 + h / 2.0):
                a = down((d < 0).astype(np.float32))
                rgb = rgb * (1 - a[..., None]) + np.asarray(col, dtype=np.float32) * a[..., None]
                alpha = np.maximum(alpha, a)
    elif name == 'grille':
        gx, gy = np.mod(px - 4, 16.0) - 8.0, np.mod(py - 4, 16.0) - 8.0
        alpha = down((np.hypot(gx, gy) < 5.0).astype(np.float32))
        rgb[:] = DARK
    atlas[y:y + h, x:x + w, :3] = rgb
    atlas[y:y + h, x:x + w, 3] = alpha


# ---------------------------------------------------------------- finishing

def clear_gutters(atlas, slot_table):
    keep = np.zeros(atlas.shape[:2], dtype=bool)
    for s in slot_table.values():
        x, y, w, h = s['live']
        keep[y:y + h, x:x + w] = True
    atlas[~keep] = 0.0


def dilate(atlas, steps):
    """Spread colour into transparent texels (alpha untouched) so filtering never pulls in black."""
    a = atlas[..., 3]
    known = a > 0.0
    rgb = atlas[..., :3] * known[..., None]
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(np.roll(known, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][..., None]
        known = known | grow
    atlas[..., :3] = np.where((a > 0)[..., None], atlas[..., :3], rgb)


def save_png(atlas, path):
    img = bpy.data.images.new('decals_atlas', SIZE, SIZE, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'sRGB'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.ascontiguousarray(atlas[::-1]).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def main():
    args = _cli.script_args()
    out_dir = _cli.option(args, '--out')
    keep_text = _cli.flag(args, '--keep-text')
    root = paths.repo_root()
    out_dir = os.path.abspath(out_dir) if out_dir else os.path.join(root, 'assets', 'build', 'kit')
    os.makedirs(out_dir, exist_ok=True)
    table = DA.slots()
    text_png = os.path.join(tempfile.gettempdir(), 'kn_decals_text.png') if not keep_text else \
        os.path.join(out_dir, '_text.png')
    vector = render_text(table, text_png)
    atlas = load_rgba(text_png)
    for live, ink, polys in vector:
        fill_nonzero(atlas, live, polys, INK[ink])
    if not keep_text:
        os.remove(text_png)
    for sid, s in table.items():
        c = s['content']
        if c['kind'] == 'picto':
            picto(atlas, s['live'], c['picto'], c['style'])
        elif c['kind'] == 'trim':
            trim(atlas, s['live'], c['tile'])
        elif c['kind'] == 'glyph':  # M2 (E1): region D arrows and the star
            glyph(atlas, s['live'], c['shape'], c['ink'])
    clear_gutters(atlas, table)
    dilate(atlas, DA.DILATE)
    atlas = np.clip(atlas, 0.0, 1.0)
    png = os.path.join(out_dir, 'decals_atlas.png')
    save_png(atlas, png)
    meta = {
        'size': SIZE, 'gutter': DA.GUTTER, 'dilate': DA.DILATE, 'image': 'decals_atlas.png',
        'colour': 'sRGB, straight alpha (linear)', 'uv': 'glTF: u = x / size, v = y / size (v = 0 at the top)',
        'fonts': {'names_numerals': 'Unbounded Bold (♯ / ♭ in DejaVu Sans Bold)',
                  'spec': 'Inter Medium',
                  'mono_numerals': 'JetBrains Mono Bold'},
        'slots': {sid: {'rect': s['rect'], 'live': s['live'], 'region': s['region']} for sid, s in table.items()},
    }
    with open(os.path.join(out_dir, 'decals_atlas.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print('decal atlas: %s (%d slots)' % (png, len(table)))


main()
