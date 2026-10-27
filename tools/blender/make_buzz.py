"""Procedurally build BUZZ (docs/art/briefs/critters.md, "BUZZ: Ducted courier drone").

Usage: blender -b --factory-startup -P tools/blender/make_buzz.py -- [out.blend] [--no-tex]
Default output: assets/src/critters/buzz.blend

Dusty's flying sibling: a bone pebble body on a graphite chassis, four graphite ducted fans (rubber lips, a white
LED ring inside each lip, three-blade rotors on motor pods and struts), a Beam LED visor face on a glossy graphite
bezel (no glass cover: the skinned renderer draws kn_screen as lit panels and has no screen-through-glass pass, the
M4 DUSTY call), two white nav domes on the front ducts and an amber rear strobe, graphite skids, a winch claw
(graphite hub with a cargo LED ring and three rubber-tipped fingers) and an Ignition pennant on a whip antenna.
A rigid robot critter (kn_robot, as DUSTY): the rig is the brief's 4 bones (`root`, `body`, `pennant_01–02`) plus
pivot-mirror bones (rotor_fl / fr / bl / br, visor, winch, claw_a / b / c) that the PIVOT__ empties name, so the
clips can spin the rotors, nod the visor, run the winch and open the claw, and the engine can drive them
procedurally. Each clip carries a face-icon track (action `kn_face`, exported to .art.json faceTracks; the icon set
is DUSTY's). One rigid RAG__body box (1.1 kg, swing 0, twist 0). Root space: floor z 0 (the skids), front -Y,
+X = its left. M5 stream E5b.
"""
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from kn_tools import kit, template  # noqa: E402
from kn_tools.conventions import LOD_COLLECTIONS, LOD_RATIOS  # noqa: E402

TYPE = 'buzz'
COM = (0.0, 0.0, 0.055)
MASS = 1.1
BONE, GRAPHITE, FABRIC, RUBBER = 'kn_powder_bone', 'kn_powder_graphite', 'kn_fabric_ignition', 'kn_rubber'
LED, SCREEN, BEZEL = 'kn_led', 'kn_screen', 'kn_powder_graphite_gloss'
FACE_ICONS = ('neutral', 'blink', 'happy', 'smug', 'scared', 'angry', 'dizzy', 'sleepy', 'surprised', 'determined',
              'scan', 'strain')
# body pebble 0.14 W x 0.12 D x 0.06 H at z 0.055 (superellipsoid exponents: vertical e1, horizontal e2)
BODY_C, BODY_SEMI, BODY_E1, BODY_E2 = (0.0, 0.0, 0.055), (0.070, 0.060, 0.030), 0.74, 0.80
# ducts: O 0.11 x 0.035 at (+-0.115, +-0.115, 0.066); front = -Y, +X = its left
DUCT_C, DUCT_Z, DUCT_R, DUCT_H = 0.115, 0.066, 0.055, 0.035
DUCT_IN = 0.0470                          # inner wall radius (blade tips at 0.0445)
ROTORS = {'fl': (1, -1), 'fr': (-1, -1), 'bl': (1, 1), 'br': (-1, 1)}
SPIN = {'fl': -1.0, 'br': -1.0, 'fr': 1.0, 'bl': 1.0}   # fl and br clockwise seen from above (-Z), fr and bl ccw
VISOR_P = (0.0, -0.055, 0.075)            # PIVOT__visor hinge (axis x, +-12 deg)
SCREEN_C, SCREEN_W, SCREEN_H = (0.0, -0.0679, 0.068), 0.070, 0.025   # 6.9 mm proud of the brief's -0.061: see notes
WINCH_P = (0.0, 0.0, 0.022)               # PIVOT__winch (axis z, translate -0.60..0)
HUB_Z0, HUB_Z1, HUB_R = 0.0115, 0.0205, 0.015
CLAW_HINGE_R, CLAW_HINGE_Z = 0.0115, 0.0125
CLAWS = {'claw_a': -90.0, 'claw_b': 30.0, 'claw_c': 150.0}   # hinge angle about the hub (a at the front)
ANT_BASE, ANT_TIP_Z = (0.0, 0.050, 0.087), 0.145
FLAG_Y0, FLAG_LEN = 0.0505, 0.050
SKID_X, SKID_Y = 0.060, 0.066
CARRY = (0.0, 0.0, 0.003)                 # EMIT__carry__claw: where a carried item hangs (claw tips)
CARRY_WINCH = 0.08                        # tether paid out while carrying (B5's CRITTER_M5.buzz.carryWinch)


def spow(x, e):
    return math.copysign(abs(x) ** e, x)


def body_surface_z(x, y):
    """Top of the body pebble at (x, y) (root space), from the superellipsoid's implicit form."""
    a, b, c = BODY_SEMI
    h = (abs(x / a) ** (2 / BODY_E2) + abs(y / b) ** (2 / BODY_E2)) ** (BODY_E2 / BODY_E1)
    return BODY_C[2] + c * max(0.0, 1 - h) ** (BODY_E1 / 2)


# ---------------------------------------------------------------- rig: root + body + pennant + pivot mirrors

def bones():
    out = [('root', (0, 0, 0), (0, 0, 0.02), None),
           ('body', COM, (0, 0, 0.11), 'root'),
           # pennant_01 is the whip antenna (it bends back with airspeed and folds flat in a tumble); pennant_02
           # the flag's tail half
           ('pennant_01', ANT_BASE, (ANT_BASE[0], ANT_BASE[1], ANT_TIP_Z), 'body'),
           ('pennant_02', (0, FLAG_Y0 + 0.022, 0.128), (0, FLAG_Y0 + FLAG_LEN, 0.129), 'pennant_01')]
    for k, (sx, sy) in ROTORS.items():
        out.append(('rotor_' + k, (sx * DUCT_C, sy * DUCT_C, DUCT_Z), (sx * DUCT_C, sy * DUCT_C, DUCT_Z + 0.03),
                    'body'))
    out.append(('visor', VISOR_P, (0, VISOR_P[1] - 0.03, VISOR_P[2]), 'body'))
    out.append(('winch', WINCH_P, (0, 0, 0.004), 'body'))
    for nm, a in CLAWS.items():
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        out.append((nm, (CLAW_HINGE_R * ca, CLAW_HINGE_R * sa, CLAW_HINGE_Z),
                    (0.0105 * ca, 0.0105 * sa, 0.0035), 'winch'))
    return out


def claw_tangent(a_deg):
    a = math.radians(a_deg)
    return Vector((-math.sin(a), math.cos(a), 0.0))


# ---------------------------------------------------------------- mesh helpers

def kit_piece(name, k, bone):
    """Kit (closed shells, per-face master) -> a rigid critter Piece bound to `bone`."""
    bm = k.bm
    bm.verts.index_update()
    verts = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    fm = [k.mats[f.material_index] for f in bm.faces]
    k.free()
    pc = cr.Piece(name, verts, faces, fm[0] if fm else BONE, bone=bone)
    pc.fmats = fm
    return pc


def superquad(name, centre, semi, e1, e2, nu, nv, bone, mat, rot=None):
    """Closed superellipsoid on a quad grid (pole fans), `mat` a master or fn(eta) -> master per latitude band.
    Quad-grid topology everywhere: rounded-rect n-gon caps triangulate into slivers whose MikkTSpace frames bake
    as normal-map noise (the M4 DUSTY brow)."""
    a, b, c = semi
    vs = [(0.0, 0.0, -c)]
    rings, etas = [], []
    for k in range(1, nv):
        eta = -math.pi / 2 + math.pi * k / nv
        ce, se = spow(math.cos(eta), e1), spow(math.sin(eta), e1)
        ring = []
        for i in range(nu):
            w = 2 * math.pi * i / nu
            ring.append(len(vs))
            vs.append((a * ce * spow(math.cos(w), e2), b * ce * spow(math.sin(w), e2), c * se))
        rings.append(ring)
        etas.append(eta)
    top = len(vs)
    vs.append((0.0, 0.0, c))
    faces, fm = [], []
    mf = mat if callable(mat) else (lambda _e: mat)
    for i in range(nu):
        j = (i + 1) % nu
        faces.append((0, rings[0][j], rings[0][i]))
        fm.append(mf(-math.pi / 2))
    for r in range(len(rings) - 1):
        lo, hi = rings[r], rings[r + 1]
        em = (etas[r] + etas[r + 1]) / 2
        for i in range(nu):
            j = (i + 1) % nu
            faces.append((lo[i], lo[j], hi[j], hi[i]))
            fm.append(mf(em))
    for i in range(nu):
        j = (i + 1) % nu
        faces.append((rings[-1][i], rings[-1][j], top))
        fm.append(mf(math.pi / 2))
    v = np.array(vs)
    if rot is not None:
        v = v @ np.array(rot).T
    v = v + np.array(centre)
    fixed = cr.fix_winding(v, faces)
    pc = cr.Piece(name, v, fixed, fm[0], bone=bone)
    pc.fmats = fm
    return pc


def slab(name, fn, nu, nv, thick, mat, bone):
    """A thin closed sheet: fn(u, v) -> (x, y, z) mid-surface over a nu x nv grid, offset +-thick/2 along X (the
    pennant). Front, back and rim faces are all quads."""
    vs, idx = [], {}
    for side in (-1, 1):
        for i in range(nu + 1):
            for j in range(nv + 1):
                x, y, z = fn(i / nu, j / nv)
                idx[(side, i, j)] = len(vs)
                vs.append((x + side * thick / 2, y, z))
    faces = []
    for i in range(nu):
        for j in range(nv):
            q = [idx[(1, i, j)], idx[(1, i + 1, j)], idx[(1, i + 1, j + 1)], idx[(1, i, j + 1)]]
            faces.append(tuple(q))
            faces.append(tuple(idx[(-1,) + k[1:]] for k in reversed([(1, i, j), (1, i + 1, j), (1, i + 1, j + 1),
                                                                      (1, i, j + 1)])))
    rim = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + \
          [(0, j) for j in range(nv, 0, -1)]
    for k in range(len(rim)):
        a, b = rim[k], rim[(k + 1) % len(rim)]
        faces.append((idx[(1,) + a], idx[(-1,) + a], idx[(-1,) + b], idx[(1,) + b]))
    v = np.array(vs)
    return cr.Piece(name, v, cr.fix_winding(v, faces), mat, bone=bone)


# ---------------------------------------------------------------- hard-surface pieces

def duct_profile(q):
    """Closed (r, z) profile of one duct about its centre (z 0 = DUCT_Z): graphite shroud, a rounded rubber lip
    on top (the brief's `phys = rubber` duct lips), graphite inner wall, rounded bottom rims."""
    hz = DUCT_H / 2
    n = max(1, int(round(6 * min(1.0, q))))
    if q < 0.2:   # far LODs: square bottom rims
        p = [(DUCT_IN + 0.0004, -hz, GRAPHITE), (DUCT_R - 0.0006, -hz, GRAPHITE), (DUCT_R - 0.0004, 0.0085, RUBBER)]
    else:
        p = [(DUCT_IN + 0.0008, -hz + 0.0012, GRAPHITE), (DUCT_IN + 0.0025, -hz, GRAPHITE),
             (DUCT_R - 0.0028, -hz, GRAPHITE), (DUCT_R - 0.0008, -hz + 0.0016, GRAPHITE),
             (DUCT_R - 0.0004, 0.0085, RUBBER)]
    # lip bead: a half-round from the outer wall over the top to the inner wall
    cx, cz, rr = (DUCT_R + DUCT_IN) / 2 + 0.0001, hz - 0.0040, 0.0040
    for i in range(n + 1):
        th = -0.25 * math.pi + 1.4 * math.pi * i / n
        p.append((cx + rr * math.cos(th), cz + rr * math.sin(th), RUBBER))
    p.append((DUCT_IN, 0.0095, GRAPHITE))
    if q >= 0.2:
        p.append((DUCT_IN - 0.0002, -hz + 0.0030, GRAPHITE))
    return kit.dedupe(p)


def pieces(lod, q):
    s = lambda n, lo=6: kit.seg(n, q, lo)  # noqa: E731
    out = []
    # body pebble: bone shell over a graphite chassis band (latitude below ~ -20 deg)
    out.append(superquad('shell', BODY_C, BODY_SEMI, BODY_E1, BODY_E2, s(72, 10), s(28, 6), 'body',
                         lambda eta: GRAPHITE if eta < -0.36 else BONE))
    # arms: body to each duct (graphite, flattened)
    for k, (sx, sy) in ROTORS.items():
        ang = math.atan2(sy, sx)
        rot = Matrix.Rotation(ang, 3, 'Z')
        c = Vector((math.cos(ang), math.sin(ang), 0)) * 0.086 + Vector((0, 0, 0.0625))
        out.append(superquad('arm_' + k, c[:], (0.029, 0.0105, 0.0062), 0.5, 0.45, s(20, 6), s(10, 4), 'body',
                             GRAPHITE, rot=rot))
    # ducts: shroud + lip, LED ring under the lip (group 1), motor pod and struts, front nav domes (group 0)
    k = kit.Kit()
    prof = duct_profile(q)
    for key, (sx, sy) in ROTORS.items():
        m = kit.at(sx * DUCT_C, sy * DUCT_C, DUCT_Z)
        k.lathe(prof, s(64, 8), m=m, closed=True)
        k.torus(DUCT_IN - 0.0001, 0.0011, LED, s(48, 8), max(3, int(6 * q)), m=kit.at(sx * DUCT_C, sy * DUCT_C,
                                                                                      DUCT_Z + 0.0080))
        k.cyl(0.0105, -0.0165, -0.0015, GRAPHITE, s(24, 6), bev=0.0025 if q >= 0.2 else 0.0, bseg=max(1, int(3 * q)), m=m)
        if lod < 3:
            for i in range(3):
                a = math.radians(30 + 120 * i) + math.atan2(sy, sx)
                d = Vector((math.cos(a), math.sin(a), 0))
                c0 = Vector((sx * DUCT_C, sy * DUCT_C, DUCT_Z - 0.011))
                k.sweep([c0 + d * 0.009, c0 + d * (DUCT_IN + 0.0015)], 0.0016, max(4, int(8 * q)), GRAPHITE)
        if sy < 0:   # nav domes on the front duct faces
            k.sphere(0.0042, LED, s(24, 6), max(3, int(8 * q)),
                     m=kit.at(sx * DUCT_C, sy * DUCT_C - DUCT_R + 0.0006, DUCT_Z - 0.003))
    out.append(kit_piece('ducts', k, 'body'))
    # rotors: hub with a bone spinner cap and three twisted blades, on each rotor bone
    for key, (sx, sy) in ROTORS.items():
        k = kit.Kit()
        cx, cy = sx * DUCT_C, sy * DUCT_C
        k.cyl(0.0072, DUCT_Z - 0.0015, DUCT_Z + 0.0055, GRAPHITE, s(24, 6), bev=0.002 if q >= 0.2 else 0.0,
              bseg=max(1, int(2 * q)),
              cap=BONE, m=kit.at(cx, cy, 0))
        out.append(kit_piece('rotor_' + key, k, 'rotor_' + key))
        hand = SPIN[key]
        for i in range(3):
            # a smooth flattened superellipsoid blade, pitched 17 deg into its spin direction
            phi = 2 * math.pi * i / 3 + (0.3 if sx * sy > 0 else 0.9)
            pitch = math.radians(17.0) * hand
            rot = Matrix.Rotation(phi, 3, 'Z') @ Matrix.Rotation(pitch, 3, 'X')
            c = (cx + 0.0258 * math.cos(phi), cy + 0.0258 * math.sin(phi), DUCT_Z + 0.0025)
            out.append(superquad('blade_%s_%d' % (key, i), c, (0.0190, 0.0046, 0.0009), 0.6, 0.45, s(16, 4), s(6, 2),
                                 'rotor_' + key, GRAPHITE, rot=rot))
    # skids: two rails with upturned ends and angled struts into the chassis; winch spool boss; rear strobe
    k = kit.Kit()
    for sx in (1, -1):
        x = sx * SKID_X
        path = [(x, -SKID_Y, 0.0105), (x, -SKID_Y + 0.006, 0.0050), (x, -SKID_Y + 0.014, 0.0035),
                (x, SKID_Y - 0.014, 0.0035), (x, SKID_Y - 0.006, 0.0050), (x, SKID_Y, 0.0105)]
        k.sweep(path, 0.0035, s(12, 5), GRAPHITE)
        for sy in (1, -1):
            k.sweep([(x, sy * 0.034, 0.005), (sx * 0.047, sy * 0.031, 0.022), (sx * 0.040, sy * 0.029, 0.034)],
                    0.0027, s(10, 4), GRAPHITE)
    k.cyl(0.0095, WINCH_P[2] - 0.0005, 0.031, GRAPHITE, s(24, 6), bev=0.0015 if q >= 0.2 else 0.0, bseg=1)
    # rear strobe (amber, LED group 3) and the antenna boss
    k.sphere(0.0045, LED, s(16, 5), max(3, int(6 * q)), m=kit.at(0, 0.0592, 0.060))
    zb = body_surface_z(ANT_BASE[0], ANT_BASE[1])
    k.cyl(0.0055, zb - 0.004, ANT_BASE[2], GRAPHITE, s(16, 5), bev=0.0015 if q >= 0.2 else 0.0, bseg=1,
          m=kit.at(ANT_BASE[0], ANT_BASE[1], 0))
    if lod < 3:   # vent slots on the rear chassis band
        for i in (-1, 0, 1):
            k.rbox((0.012, 0.004, 0.0035), (i * 0.017, 0.0545, 0.036), 0.0014, GRAPHITE, cseg=max(1, int(2 * q)))
    out.append(kit_piece('chassis', k, 'body'))
    # whip antenna (pennant_01; weighted from the boss up, see reweight) with a tip ball
    k = kit.Kit()
    n = max(2, int(8 * q))
    path = [(ANT_BASE[0], ANT_BASE[1], ANT_BASE[2] - 0.002 + (ANT_TIP_Z - ANT_BASE[2] + 0.002) * i / n)
            for i in range(n + 1)]
    k.sweep(path, 0.0013, s(8, 4), GRAPHITE, radii=[0.0014 - 0.0005 * i / n for i in range(n + 1)])
    k.sphere(0.0019, GRAPHITE, s(10, 4), max(2, int(5 * q)), m=kit.at(ANT_BASE[0], ANT_BASE[1], ANT_TIP_Z))
    out.append(kit_piece('whip', k, 'pennant_01'))

    # pennant: a tapered Ignition flag streaming back (+Y) from the whip's top 30 mm

    def flag(u, v):
        y = FLAG_Y0 + FLAG_LEN * u
        zc = 0.127 + 0.002 * u
        h = 0.030 + (0.004 - 0.030) * u
        return (0.0012 * math.sin(math.pi * 1.5 * u) * u, y, zc + (v - 0.5) * h)
    out.append(slab('flag', flag, max(3, int(10 * q)), max(1, int(4 * q)), 0.0014, FABRIC, 'pennant_01'))
    # visor: glossy graphite bezel (quad-grid superellipsoid) on the visor bone; the screen is a separate object
    out.append(superquad('bezel', (0, -0.0565, 0.068), (0.0430, 0.0110, 0.0172), 0.32, 0.30, s(48, 8), s(20, 4),
                         'visor', BEZEL))
    # winch claw: hub + cargo LED ring (group 2) on `winch`, three rubber-tipped fingers on claw_a / b / c
    k = kit.Kit()
    k.cyl(HUB_R, HUB_Z0, HUB_Z1, GRAPHITE, s(32, 6), bev=0.0022 if q >= 0.2 else 0.0, bseg=max(1, int(3 * q)))
    k.torus(HUB_R + 0.0001, 0.0011, LED, s(32, 6), max(3, int(6 * q)), m=kit.at(0, 0, (HUB_Z0 + HUB_Z1) / 2))
    out.append(kit_piece('claw_hub', k, 'winch'))
    for nm, a in CLAWS.items():
        k = kit.Kit()
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        rz = [(0.0110, 0.0130), (0.0148, 0.0090), (0.0142, 0.0052), (0.0098, 0.0030)]
        pts = [(r * ca, r * sa, z) for r, z in rz]
        k.sweep(pts, 0.0021, s(10, 4), GRAPHITE)
        k.sphere(0.0026, RUBBER, s(12, 5), max(3, int(6 * q)), m=kit.at(*pts[-1]))
        out.append(kit_piece(nm, k, nm))
    return out


def screens(lod):
    """The visor's kn_screen quad (on the visor bone)."""
    c = (SCREEN_C[0], SCREEN_C[1], SCREEN_C[2] - COM[2])
    return [(kit.screen_quad(c, (0, -1, 0), (0, 0, 1), SCREEN_W, SCREEN_H), 'visor')]


# ---------------------------------------------------------------- the robot critter build

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class Buzz(cr.Critter):
    def build_lod_pieces(self, lod, q):
        pcs = pieces(lod, q)
        return pcs, sum(p.tris() for p in pcs)

    def tune(self, lod, target):
        lo, hi = 0.05, 2.5
        best = None
        for _ in range(16):
            mid = (lo + hi) / 2
            _p, t = self.build_lod_pieces(lod, mid)
            if best is None or abs(t - target) < abs(best[1] - target):
                best = (mid, t)
            if t > target:
                hi = mid
            else:
                lo = mid
        return best[0]

    def screens_object(self, lod):
        from kn_tools import geom
        names = self.deform_bones()
        k = kit.Kit()
        bones_of = []
        for sk, bone in screens(lod):
            n0 = len(k.bm.verts)
            k.merge(sk)
            bones_of += [bone] * (len(k.bm.verts) - n0)
        nm = '%s__screens%s' % (self.type, cr.LOD_SUFFIX[lod])
        ob = geom.object_from_bmesh(nm, k.bm, [self.mats[n] for n in k.mats],
                                    template.get_collection(LOD_COLLECTIONS[lod]), recalc_normals=False)
        k.free()
        groups = {n: ob.vertex_groups.new(name=n) for n in names}
        for vi, b in enumerate(bones_of):
            groups[b].add([vi], 1.0, 'REPLACE')
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = self.rig
        return ob

    def reweight(self, lod):
        """Smooth the whip and flag between body / pennant_01 / pennant_02 so the antenna bends from its boss
        and the flag's tail half waves (rigid pieces are bound to one bone each by assemble)."""
        ob, ranges = self.lod_objects[lod]
        com = np.array(self.com[:])
        vg = ob.vertex_groups
        for pname in ('whip', 'flag'):
            if pname not in ranges:
                continue
            a, b, pc = ranges[pname]
            for vi in range(a, b):
                p = pc.verts[vi - a]
                if pname == 'whip':
                    w1 = smooth((p[2] - (ANT_BASE[2] - 0.002)) / 0.016)
                    ws = {'body': 1 - w1, 'pennant_01': w1, 'pennant_02': 0.0}
                else:
                    w2 = smooth((p[1] - (FLAG_Y0 + 0.012)) / 0.026)
                    ws = {'body': 0.0, 'pennant_01': 1 - w2, 'pennant_02': w2}
                for bn, w in ws.items():
                    if w > 1e-4:
                        vg[bn].add([vi], float(w), 'REPLACE')
                    else:
                        vg[bn].remove([vi])
        del com

    def led_colours(self, ob):
        """ASSET_PIPELINE §3.6 `led` face-corner colour on kn_led faces (R = group / 255, G = brightness):
        0 nav (front duct domes), 1 ducts (ring inside each lip, the engine scales it with thrust), 2 cargo (claw
        hub ring, off until carrying), 3 strobe (the amber rear strobe; the engine can't tint one group two
        colours, so it is its own group)."""
        me = ob.data
        names = [m.name.split('.')[0] for m in me.materials]
        if LED not in names:
            return
        li = names.index(LED)
        attr = me.color_attributes.new('led', 'BYTE_COLOR', 'CORNER')
        for p in me.polygons:
            if p.material_index != li:
                col = (0.0, 0.0, 0.0, 1.0)
            else:
                c = p.center + self.com
                dmin = min(math.hypot(c.x - sx * DUCT_C, c.y - sy * DUCT_C) for sx, sy in ROTORS.values())
                if c.z < 0.026:
                    g, br = 2, 0.0
                elif c.y > 0.05 and abs(c.x) < 0.02:
                    g, br = 3, 1.0
                elif dmin < 0.051:
                    g, br = 1, 0.8
                else:
                    g, br = 0, 1.0
                col = (g / 255.0, br, 0.0, 1.0)
            for li_ in p.loop_indices:
                attr.data[li_].color = col

    def build(self, library):
        import bpy
        s = self.s
        self.build_rig()
        names = self.deform_bones()
        budget = s['tri_budget']
        q0 = self.tune(0, budget * 0.985)
        p0, t0 = self.build_lod_pieces(0, q0)
        ob0 = self.assemble(0, p0, names, None)
        self.reweight(0)
        self.led_colours(ob0)
        self.screens_object(0)
        for lod in (1, 2, 3):
            q = self.tune(lod, t0 * LOD_RATIOS['LOD%d' % lod])
            pcs, _t = self.build_lod_pieces(lod, q)
            ob = self.assemble(lod, pcs, names, None)
            self.reweight(lod)
            self.led_colours(ob)
            self.screens_object(lod)
        self.ragdoll()
        part = self.part
        com = self.com
        # collision (the brief): body box, four duct cylinders (rubber lips), the skid box
        part.col_box('0', (0.14, 0.12, 0.06), Vector(BODY_C) - com, phys='powder')
        for i, (sx, sy) in enumerate(ROTORS.values()):
            part.col_cyl(str(i + 1), DUCT_R, DUCT_H, Vector((sx * DUCT_C, sy * DUCT_C, DUCT_Z)) - com, axis='z',
                         phys='rubber')
        part.col_box('5', (2 * SKID_X + 0.008, 2 * SKID_Y - 0.002, 0.012), Vector((0, 0, 0.006)) - com,
                     phys='powder')
        self.emitters()
        # pivots: the engine's procedural drivers; each names the bone it turns (pivot-mirror bones)
        for key, (sx, sy) in ROTORS.items():
            part.pivot('rotor_' + key, Vector((sx * DUCT_C, sy * DUCT_C, DUCT_Z)) - com, 'z', None, None,
                       bone='rotor_' + key, continuous=True, spin='cw' if SPIN[key] < 0 else 'ccw',
                       rps_idle=45.0, rps_max=90.0, blur_rps=20.0)
        part.pivot('visor', Vector(VISOR_P) - com, 'x', -12.0, 12.0, bone='visor')
        wn = part.pivot('winch', Vector(WINCH_P) - com, 'z', -0.60, 0.0, bone='winch', translate=True,
                        motion='slide', rope='kn_rope', rope_d=0.003)
        winch = bpy.data.objects[wn]
        for nm, a in CLAWS.items():
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            loc = Vector((CLAW_HINGE_R * ca, CLAW_HINGE_R * sa, CLAW_HINGE_Z)) - com
            pn = part.pivot(nm, loc, 'x', 0.0, 40.0, bone=nm)
            ob = bpy.data.objects[pn]
            # local +X = the hinge's tangent axis, signed so a positive angle opens the finger (tip outward)
            t = -claw_tangent(a)
            zf = Vector((0, 0, 1))
            yf = zf.cross(t).normalized()
            ob.matrix_world = Matrix.Translation(loc) @ Matrix((t, yf, zf)).transposed().to_4x4()
            ob.parent = winch
            ob.matrix_parent_inverse = winch.matrix_world.inverted()
        bpy.context.view_layer.update()
        # SENSOR__catch__claw: sphere O 0.06 at the claw, riding the winch; grabs a tagged body <= 2 kg
        c = Vector((0, 0, 0.008)) - com
        pts = []
        for i in range(12):
            for j in range(1, 6):
                th, ph = 2 * math.pi * i / 12, math.pi * j / 6
                pts.append((c.x + 0.03 * math.sin(ph) * math.cos(th), c.y + 0.03 * math.sin(ph) * math.sin(th),
                            c.z + 0.03 * math.cos(ph)))
        pts += [(c.x, c.y, c.z + 0.03), (c.x, c.y, c.z - 0.03)]
        so = part.sensor('catch', 'claw', pts, max_kg=2.0)
        so['pivot'] = 'winch'
        so['bone'] = 'winch'
        # the visor screen for .art.json (the same quad as the render screen)
        part.screen('face', SCREEN_W, SCREEN_H, Vector(SCREEN_C) - com, normal=(0, -1, 0), up=(0, 0, 1),
                    kind='icon', color='beam')
        made = self.clips(library)
        for nm in library:
            act = bpy.data.actions.get('%s__%s' % (self.type, nm))
            if act is not None and nm in FACE:
                act['kn_face'] = json.dumps(FACE[nm])
        root = part.root
        root['kn_robot'] = True
        root['kn_face_icons'] = ','.join(FACE_ICONS)
        root['led_groups'] = '0:nav,1:ducts,2:cargo,3:strobe'
        dg = bpy.context.evaluated_depsgraph_get()
        pts = np.array([v.co[:] for v in ob0.evaluated_get(dg).to_mesh().vertices])
        ob0.evaluated_get(dg).to_mesh_clear()
        size = pts.max(0) - pts.min(0)
        root['kn_footprint'] = '%g,%g,%g' % (round(size[0] * 10, 2), round(size[2] * 10, 2), round(size[1] * 10, 2))
        print('  footprint (cells) %s, size %s m, root-space z %.4f..%.4f' % (
            root['kn_footprint'], np.round(size, 4), pts.min(0)[2] + com.z, pts.max(0)[2] + com.z))
        print('  clips (%d): %s' % (len(made), ', '.join(made)))
        self.rig.data.pose_position = 'REST'
        return self

    def ragdoll(self):
        """RAG__body: one rigid box over the whole drone (0.34 x 0.34 x 0.090: duct outer edges, skids to the
        folded antenna), swing 0, twist 0, 1.1 kg."""
        import bpy
        hx, hy, hz = RAG_HALF
        k = kit.Kit()
        k.hull([(x * hx, y * hy, z * hz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], 'x')
        me = bpy.data.meshes.new('RAG__body')
        k.bm.to_mesh(me)
        k.free()
        ob = bpy.data.objects.new('RAG__body', me)
        ob.matrix_world = Matrix.Translation(Vector((0, 0, hz)) - self.com)
        ob['bone'] = 'body'
        ob['rag_parent'] = ''
        ob['rag_shape'] = 'box'
        ob['swing_deg'] = 0.0
        ob['twist_deg'] = 0.0
        ob['mass'] = MASS
        ob['phys'] = 'powder'
        ob['half_extents'] = [hx, hy, hz]
        ob.display_type = 'WIRE'
        ob.hide_render = True
        template.get_collection('RIG').objects.link(ob)
        return [ob]


RAG_HALF = (0.17, 0.17, 0.045)


# ---------------------------------------------------------------- clips (drone behaviours)

def map_buzz(ch, a):
    """map_quad (hips = body, `bones` / `loc` / `scale`) plus `quat`: {bone: Quaternion in armature axes} for
    rotations about arbitrary axes (the claw fingers' tangent hinges)."""
    out = an.map_quad(ch, a)
    for b, q in ch.get('quat', {}).items():
        o = out.get(b)
        out[b] = (o[0] @ q, o[1], o[2]) if o else (q, None, None)
    return out


an.MAPPERS['buzz'] = map_buzz
ANIM = {'kind': 'buzz', 'hips': 'body', 'spine': [], 'neck': [], 'head': None, 'ears': {}, 'legs': {}, 'tail': []}

# per clip: [frame, icon] keys of the LED visor (critters.md: Dusty's icon set)
FACE = {
    'idle': [[0, 'neutral'], [40, 'blink'], [43, 'neutral'], [76, 'blink'], [79, 'neutral']],
    'idle_alt': [[0, 'neutral'], [15, 'scan'], [95, 'neutral'], [106, 'blink'], [109, 'neutral']],
    'walk': [[0, 'happy']], 'run': [[0, 'determined']], 'chase': [[0, 'determined']], 'flee': [[0, 'scared']],
    'startled': [[0, 'surprised'], [18, 'neutral']], 'tumble': [[0, 'scared']],
    'getup': [[0, 'dizzy'], [15, 'scared'], [30, 'determined']], 'dizzy': [[0, 'dizzy']],
    'trapped': [[0, 'angry'], [30, 'strain'], [45, 'angry']], 'celebrate': [[0, 'happy']],
    'sleep': [[0, 'sleepy']], 'sniff': [[0, 'scan']], 'emote_happy': [[0, 'happy']],
    'emote_angry': [[0, 'angry']], 'emote_confused': [[0, 'surprised'], [12, 'neutral'], [24, 'blink'], [27, 'scan']],
    'takeoff': [[0, 'blink'], [3, 'determined']], 'land': [[0, 'neutral'], [24, 'happy']],
    'grab': [[0, 'determined'], [25, 'smug']], 'carry': [[0, 'determined'], [50, 'blink'], [53, 'determined']],
    'drop_off': [[0, 'determined'], [27, 'happy']], 'deliver_bow': [[0, 'happy'], [12, 'smug'], [24, 'happy']],
}


def hull_points(fold=False):
    """Extreme points of the drone (root space) for floor contact: duct rims, skid ends, body top (+ the folded
    whip when `fold`)."""
    pts = []
    for sx, sy in ROTORS.values():
        for i in range(12):
            a = 2 * math.pi * i / 12
            for z in (DUCT_Z - DUCT_H / 2, DUCT_Z + DUCT_H / 2):
                pts.append((sx * DUCT_C + DUCT_R * math.cos(a), sy * DUCT_C + DUCT_R * math.sin(a), z))
    for sx in (1, -1):
        for sy in (1, -1):
            pts.append((sx * SKID_X, sy * (SKID_Y - 0.014), 0.0))
    pts.append((0, 0, 0.085))
    if fold:
        pts += [(0, 0.06, 0.090), (0, 0.10, 0.090), (0, 0.13, 0.088)]
    return [Vector(p) - Vector(COM) for p in pts]


def floor_z(pitch=0.0, yaw=0.0, roll=0.0, fold=False):
    """hip_z that puts the lowest point on the floor (rest: skids at z 0, hip_z 0) for a body rotation."""
    q = an.rot(pitch, yaw, roll)
    return -COM[2] - min((q @ p).z for p in hull_points(fold))


def library():
    S, C, win, ramp, TAU = an.S, an.C, an.win, an.ramp, an.TAU
    L = {}

    def drive(c, t, T, revs=3.0, mode='const', back=0.0, wave=0.0, flap=0.0, droop=0.0, visor=0.0, claw=0.0,
              winch=0.0, swing=(0.0, 0.0)):
        """Pivot bones. revs: rotor revolutions over the clip (whole numbers keep loops seamless; baked slow, 2-4
        rps, so three blades don't strobe at 30 fps: the engine spins them for real and swaps in blur discs);
        mode 'up' / 'down' spins up / down. back: whip bend toward +Y (deg); wave: whip side-sway; flap: flag
        tail side-wave; droop: flag tail down; visor: nod (+ up, within +-12); claw: finger opening (0-40 deg);
        winch: tether length (m); swing: winch pendulum (pitch, roll) in degrees."""
        u = t / T
        f = {'const': u, 'up': u * u, 'down': 1 - (1 - u) ** 2}[mode]
        b = c.setdefault('bones', {})
        for k in ROTORS:
            b['rotor_' + k] = [('y', SPIN[k] * 360.0 * revs * f)]
        b['pennant_01'] = [('p', back), ('y', wave)]
        b['pennant_02'] = [('y', flap), ('p', droop)]
        b['visor'] = [('p', max(-12.0, min(12.0, visor)))]
        if swing[0] or swing[1]:
            b['winch'] = [('p', swing[0]), ('r', swing[1])]
        if winch:
            c.setdefault('loc', {})['winch'] = (0.0, 0.0, -winch)
        if claw:
            qd = c.setdefault('quat', {})
            for nm, a in CLAWS.items():
                qd[nm] = Quaternion(claw_tangent(a), -math.radians(claw))
        return c

    def idle(t, T):   # 0.01 m hover bob, blink
        c = {'hip_z': 0.005 * S(t, T, 3), 'hip_roll': 1.5 * S(t, T, 2, 0.3), 'hip_pitch': 1.0 * S(t, T, 1)}
        return drive(c, t, T, revs=9, back=4, flap=6 * S(t, T, 6), visor=2 * S(t, T, 1))
    L['idle'] = (90, True, idle)

    def idle_alt(t, T):   # yaw look-around, pennant flick
        c = {'hip_yaw': 22 * S(t, T, 1), 'hip_roll': -3 * S(t, T, 1), 'hip_z': 0.004 * S(t, T, 4)}
        flick = win(t, 1.7, 2.4, 0.15)
        return drive(c, t, T, revs=12, back=4 + 10 * flick, flap=6 * S(t, T, 8) + 22 * flick * S(t, T, 24),
                     visor=6 * S(t, T, 2))
    L['idle_alt'] = (120, True, idle_alt)

    def cruise(t, T, pitch, revs, back, flap, visor, roll=2.0, yaw=0.0, wob=0.003):
        c = {'hip_pitch': pitch + 1.2 * S(t, T, 2), 'hip_roll': roll * S(t, T, 1), 'hip_yaw': yaw * S(t, T, 1),
             'hip_z': wob * S(t, T, 2)}
        return drive(c, t, T, revs=revs, back=back + 4 * S(t, T, 4), wave=3 * S(t, T, 3), flap=flap * S(t, T, 6),
                     visor=visor)
    L['walk'] = (30, True, lambda t, T: cruise(t, T, -10, 3, 25, 12, 6))
    L['run'] = (20, True, lambda t, T: cruise(t, T, -20, 2, 55, 16, 11))
    L['chase'] = (20, True, lambda t, T: cruise(t, T, -15, 2, 45, 15, 9, roll=-8, yaw=6))

    def flee(t, T):   # back off and climb: nose up, the pennant blown forward
        c = {'hip_pitch': 12 + 2 * S(t, T, 2), 'hip_roll': 4 * S(t, T, 2), 'hip_z': 0.004 * S(t, T, 2),
             'hip_yaw': 8 * S(t, T, 1)}
        return drive(c, t, T, revs=4, back=-12, wave=4 * S(t, T, 3), flap=16 * S(t, T, 6), visor=-6)
    L['flee'] = (30, True, flee)

    def startled(t, T):   # 0.05 m jolt up, O O eyes
        j = win(t, 0.0, 0.25, 0.12)
        z = 0.05 * (ramp(t, 0.0, 0.14) - ramp(t, 0.22, 0.72))
        c = {'hip_z': z, 'hip_pitch': 10 * j, 'hip_roll': 6 * S(t, T, 4) * (1 - ramp(t, 0.1, 0.75))}
        return drive(c, t, T, revs=3, back=-18 * j + 6, flap=20 * S(t, T, 4), visor=10 * j,
                     claw=28 * win(t, 0.04, 0.5, 0.1))
    L['startled'] = (24, False, startled)

    def tumble(t, T):   # rigid tumble (the ragdoll moves the body): rotors cut, whip folded back, claw flails
        c = {}
        return drive(c, t, T, revs=0, back=75 + 8 * S(t, T, 4), wave=10 * S(t, T, 2), flap=30 * S(t, T, 4),
                     claw=20 + 14 * S(t, T, 4, 0.25), swing=(12 * S(t, T, 2), 10 * C(t, T, 2)))
    L['tumble'] = (24, True, tumble)

    def getup(t, T):   # upside down on the floor: wobble, rotors spin up, a thrust flips it upright, a little lift
        flip = ramp(t, 0.7, 1.25)
        wob = 7 * S(t, T, 3) * win(t, 0.0, 0.7, 0.1)
        roll = 180 * (1 - flip) + wob * (1 - flip)
        fold = flip < 0.5
        z = floor_z(0, 0, roll, fold=fold) + 0.03 * math.sin(math.pi * flip)
        z += 0.012 * win(t, 1.45, 1.85, 0.18)
        c = {'hip_roll': roll, 'hip_z': z, 'hip_pitch': -3 * win(t, 1.25, 1.6, 0.1)}
        return drive(c, t, T, revs=5, mode='up', back=80 * (1 - ramp(t, 1.0, 1.45)) + 5,
                     flap=20 * S(t, T, 6) * ramp(t, 1.2, 1.5), droop=25 * (1 - ramp(t, 1.0, 1.4)),
                     claw=10 * win(t, 0.0, 0.8, 0.1), visor=-4 * win(t, 1.3, 1.9, 0.2))
    L['getup'] = (60, False, getup)

    def dizzy(t, T):   # wobbly circles, spiral eyes
        c = {'hip_x': 0.015 * C(t, T, 2), 'hip_y': 0.015 * S(t, T, 2), 'hip_roll': 8 * S(t, T, 2),
             'hip_pitch': 8 * C(t, T, 2), 'hip_yaw': 360.0 * t / T}
        return drive(c, t, T, revs=6, back=10, flap=20 * S(t, T, 8), visor=-4 + 4 * S(t, T, 3),
                     swing=(6 * C(t, T, 2), 6 * S(t, T, 2)))
    L['dizzy'] = (60, True, dizzy)

    def trapped(t, T):   # straining against a hold: lunges, jerks back, rotors flat out
        k = max(0.0, S(t, T, 4)) ** 2
        c = {'hip_pitch': -16 - 8 * k + 2 * S(t, T, 16), 'hip_y': -0.012 * k, 'hip_roll': 3 * S(t, T, 6),
             'hip_z': 0.002 * S(t, T, 16)}
        return drive(c, t, T, revs=8, back=40 + 10 * k, flap=22 * S(t, T, 8), visor=7 + 3 * k)
    L['trapped'] = (60, True, trapped)

    def celebrate(t, T):   # a 360 deg barrel roll
        u = ramp(t, 0.2, 1.1)
        c = {'hip_roll': 360.0 * u, 'hip_z': 0.04 * math.sin(math.pi * ramp(t, 0.1, 1.25))}
        return drive(c, t, T, revs=5, back=20 * math.sin(math.pi * u), flap=25 * S(t, T, 6),
                     visor=10 * win(t, 1.1, 1.5, 0.12))
    L['celebrate'] = (45, False, celebrate)

    def sleep(t, T):   # on the beacon, rotors off, visor down, flag drooping
        c = {'hip_z': -0.0004 * (1 + S(t, T, 1)) * 0.5}
        return drive(c, t, T, revs=0, droop=35 + 2 * S(t, T, 1), visor=-10 + 1.5 * S(t, T, 1))
    L['sleep'] = (90, True, sleep)

    def sniff(t, T):   # scan sweep for tags
        c = {'hip_yaw': 35 * S(t, T, 1), 'hip_pitch': -4 + 1.5 * S(t, T, 2), 'hip_z': 0.003 * S(t, T, 4)}
        return drive(c, t, T, revs=6, back=6, flap=8 * S(t, T, 6), visor=-8 + 4 * S(t, T, 2))
    L['sniff'] = (60, True, sniff)

    def emote_happy(t, T):
        bnc = abs(math.sin(TAU * t / T))   # two bounces, ending at rest
        c = {'hip_z': 0.015 * bnc, 'hip_yaw': 15 * S(t, T, 2), 'hip_roll': 8 * S(t, T, 2)}
        return drive(c, t, T, revs=4, back=8, flap=25 * S(t, T, 6), visor=8 * bnc)
    L['emote_happy'] = (36, False, emote_happy)

    def emote_angry(t, T):
        k = win(t, 0.15, 0.3, 0.04) + win(t, 0.5, 0.65, 0.04) + win(t, 0.85, 1.0, 0.04)
        c = {'hip_y': -0.015 * k, 'hip_pitch': -12 * k, 'hip_roll': 3 * S(t, T, 9)}
        return drive(c, t, T, revs=5, back=15 * k, flap=20 * S(t, T, 6), visor=-8 * k, claw=25 * k)
    L['emote_angry'] = (36, False, emote_angry)

    def emote_confused(t, T):
        c = {'hip_roll': 12 * S(t, T, 1), 'hip_yaw': -15 * S(t, T, 1), 'hip_z': 0.003 * S(t, T, 2)}
        return drive(c, t, T, revs=4, back=4, wave=6 * S(t, T, 1), flap=10 * S(t, T, 4), visor=8 * S(t, T, 1))
    L['emote_confused'] = (45, False, emote_confused)

    # ---- role clips (altitude and travel are the sim's; the clips add the attitude, rotors, winch and claw)
    def takeoff(t, T):   # spin up, settle on the skids, wobble free
        c = {'hip_z': -0.002 * win(t, 0.1, 0.35, 0.1) + 0.006 * math.sin(math.pi * ramp(t, 0.4, 1.0)),
             'hip_roll': 3 * S(t, T, 3) * win(t, 0.35, 0.9, 0.15), 'hip_pitch': -3 * win(t, 0.45, 0.9, 0.15)}
        return drive(c, t, T, revs=3, mode='up', back=15 * ramp(t, 0.3, 1.0), flap=15 * S(t, T, 4) * ramp(t, 0.3, 1),
                     droop=20 * (1 - ramp(t, 0.1, 0.5)), visor=6 * win(t, 0.1, 0.6, 0.15))
    L['takeoff'] = (30, False, takeoff)

    def land(t, T):   # touch down (skids squash), spin down, flag drops
        touch = win(t, 0.5, 0.7, 0.08)
        c = {'hip_z': -0.003 * touch, 'hip_roll': 2 * S(t, T, 2) * (1 - ramp(t, 0.5, 0.8)),
             'hip_pitch': 2 * touch}
        return drive(c, t, T, revs=2, mode='down', back=15 * (1 - ramp(t, 0.4, 0.9)),
                     flap=12 * S(t, T, 3) * (1 - ramp(t, 0.5, 1.0)), droop=20 * ramp(t, 0.6, 1.0),
                     visor=-5 * ramp(t, 0.6, 1.0))
    L['land'] = (30, False, land)

    def grab(t, T):   # descend, winch out, claw opens and closes on the tagged item, winch in
        dip = win(t, 0.15, 0.95, 0.2)
        c = {'hip_z': -0.01 * dip, 'hip_pitch': -5 * dip}
        return drive(c, t, T, revs=4, back=8, flap=10 * S(t, T, 4), visor=-10 * dip,
                     winch=0.08 * win(t, 0.1, 1.0, 0.3), claw=40 * win(t, 0.15, 0.62, 0.12),
                     swing=(3 * S(t, T, 2) * dip, 0.0))
    L['grab'] = (36, False, grab)

    def carry(t, T):   # loaded hover: sags, works harder, the item sways on 0.08 m of tether (CRITTER_M5 carryWinch)
        c = {'hip_z': -0.006 + 0.004 * S(t, T, 2), 'hip_pitch': -3 + 2 * S(t, T, 1), 'hip_roll': 2.5 * S(t, T, 3)}
        return drive(c, t, T, revs=8, back=20 + 4 * S(t, T, 4), flap=12 * S(t, T, 6), visor=3, winch=CARRY_WINCH,
                     swing=(5 * S(t, T, 2, 0.15), 3 * S(t, T, 1)))
    L['carry'] = (60, True, carry)

    def drop_off(t, T):   # winch the item down onto the pad, release, winch in, a relieved bob up
        lower = win(t, 0.1, 1.42, 0.4)
        c = {'hip_z': -0.004 * lower + 0.006 * win(t, 0.85, 1.15, 0.1), 'hip_pitch': -4 * lower}
        return drive(c, t, T, revs=4, back=10, flap=10 * S(t, T, 4), visor=-10 * lower,
                     winch=0.10 * lower, claw=40 * win(t, 0.82, 1.3, 0.1))
    L['drop_off'] = (45, False, drop_off)

    def deliver_bow(t, T):   # a little dip
        d = win(t, 0.15, 0.75, 0.2)
        c = {'hip_pitch': -20 * d, 'hip_z': -0.01 * d}
        return drive(c, t, T, revs=3, back=10 + 10 * d, flap=18 * S(t, T, 3), visor=-12 * d)
    L['deliver_bow'] = (30, False, deliver_bow)
    return L


ROLE_CLIPS = ('takeoff', 'land', 'grab', 'carry', 'drop_off', 'deliver_bow')
SPEC = {
    'type': TYPE, 'com': COM, 'mass': MASS, 'tri_budget': 22000, 'ragdoll_impulse': 3.0,
    'skins': 'bone,night_courier,express',
    'notes': 'Ducted courier drone critter (rigid robot, flies). Brief: docs/art/briefs/critters.md#buzz. Origin = '
             'centre of mass; root bone on the floor (skids) at part (0,0,-0.055). Rig = root + body + pennant_01-02 '
             '+ pivot-mirror bones named by the PIVOT__ empties (rotors, visor, winch, claw fingers); LED visor icons '
             'per clip in .art.json faceTracks; RAG__body is one box over the drone. The winch tether is an engine '
             'rope (kn_rope O 3 mm) from the spool to the claw hub. M5 stream E5b.',
    'masters': {m: m for m in (BONE, GRAPHITE, FABRIC, RUBBER, BEZEL, LED, SCREEN)},
    'phys': {},
    'bones': bones(), 'elements': [], 'accessories': lambda lod: [], 'face': {},
    'ragdoll': [],
    'emitters': [('downwash', 'rotor_' + k, (sx * DUCT_C, sy * DUCT_C, DUCT_Z - DUCT_H / 2), (0, 0, -1), 'body')
                 for k, (sx, sy) in ROTORS.items()] +
                [('spark', 'duct', (DUCT_C, -DUCT_C - DUCT_R, DUCT_Z), (0, -1, 0), 'body'),
                 ('voice', 'visor', (0, -0.068, 0.065), (0, -1, 0), 'visor'),
                 ('emote', 'bubble', (0, 0, 0.20), (0, 0, 1), 'body'),
                 ('carry', 'claw', CARRY, (0, 0, -1), 'winch')],
    'anim': ANIM,
    'role_clips': ROLE_CLIPS,
}


def tex_looks():
    # satin moulded ABS like DUSTY (same product line); the bezel is gloss
    return {BONE: {'look': 'plastic', 'rough': 0.46}, GRAPHITE: {'look': 'plastic', 'rough': 0.55},
            BEZEL: {'look': 'plastic', 'rough': 0.18}}


def main(out_path=None, tex=True):
    from kn_tools import textures
    c = Buzz(SPEC)
    c.part.root['kn_tex_looks'] = json.dumps(tex_looks(), separators=(',', ':'))
    c.build(library())
    path = c.part.save(out_path)
    if tex:
        # D78 set at 2048² (robot critter); assets.mjs bakes parts only
        textures.texture_part(samples=128)
        c.part.save(path)
    return path


if __name__ == '__main__':
    args = _cli.script_args()
    no_tex = _cli.flag(args, '--no-tex')
    main(os.path.abspath(args[0]) if args and not args[0].startswith('--') else None, tex=not no_tex)
