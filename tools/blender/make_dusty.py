"""Procedurally build DUSTY (docs/art/briefs/critters.md, "DUSTY: Robot vacuum with LED eyes").

Usage: blender -b --factory-startup -P tools/blender/make_dusty.py -- [out.blend] [--no-tex]
Default output: assets/src/critters/dusty.blend

The approved look-dev robot vacuum (style_samples.py dusty()), at final detail: a bone disc with a graphite lid,
underside and brow strip, a rubber bumper ring, two Beam LED eye screens on glossy graphite bezels (no glass covers: the renderer has no screen-through-glass pass), a power port on the
lid, a thin status LED ring round the lid edge and a charge pip, a bin-fill bar screen, two drive wheels, a front
caster and the single Ignition side brush with three rubber-tipped arms. A rigid robot critter (kn_robot): the
rig is `root` + `body` plus pivot-mirror bones (wheel_l / wheel_r / brush / bumper / lid / caster) that the
PIVOT__ empties name, so the clips can spin, compress and pop them and the engine can drive them procedurally.
Each clip carries a face-icon track (action `kn_face`, exported to .art.json faceTracks). One rigid RAG__body
cylinder (3.2 kg, swing 0, twist 0). Root space: floor z 0, front -Y, +X = its left. M4 stream E4b.
"""
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _critter as cr  # noqa: E402
import _critter_anim as an  # noqa: E402
from kn_tools import kit, template  # noqa: E402
from kn_tools.conventions import LOD_COLLECTIONS, LOD_RATIOS  # noqa: E402

TYPE = 'dusty'
COM = (0.0, 0.0, 0.032)
BONE, GRAPHITE, IGNITION, RUBBER = 'kn_powder_bone', 'kn_powder_graphite', 'kn_powder_ignition', 'kn_rubber'
LED, SCREEN, BEZEL = 'kn_led', 'kn_screen', 'kn_powder_graphite_gloss'
FACE_ICONS = ('neutral', 'blink', 'happy', 'smug', 'scared', 'angry', 'dizzy', 'sleepy', 'surprised', 'determined',
              'scan', 'strain')
WHEEL_R = 0.022
BRUSH_C = (0.120, -0.080, 0.006)
LID_HINGE = (0.0, 0.137, 0.061)
BROW_Z, EYE_Z, EYE_SCREEN_Z = 0.0665, 0.0678, 0.0697


# ---------------------------------------------------------------- rig: root + body + pivot mirrors

def bones():
    return [('root', (0, 0, 0), (0, 0, 0.02), None),
            ('body', (0, 0, 0.032), (0, 0, 0.09), 'root'),
            ('wheel_l', (0.110, 0, WHEEL_R), (0.135, 0, WHEEL_R), 'body'),
            ('wheel_r', (-0.110, 0, WHEEL_R), (-0.135, 0, WHEEL_R), 'body'),
            ('brush', BRUSH_C, (BRUSH_C[0], BRUSH_C[1], 0.03), 'body'),
            ('bumper', (0, 0, 0.03), (0, -0.03, 0.03), 'body'),
            ('lid', LID_HINGE, (0, 0.1, 0.061), 'body'),
            ('caster', (0, -0.12, 0.01), (0, -0.12, 0.03), 'body')]


# ---------------------------------------------------------------- hard-surface pieces

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


def grid_box(name, centre, size, mat, nu, nv, bone):
    """A closed box built from a regular quad grid on every face: rounded-rect n-gon caps triangulate into long
    slivers whose MikkTSpace frames bake as normal-map noise on thin strips (the brow)."""
    cx, cy, cz = centre
    sx, sy, sz = (v / 2 for v in size)
    vs, faces, idx = [], [], {}

    def vid(p):
        k = tuple(round(c, 9) for c in p)
        if k not in idx:
            idx[k] = len(vs)
            vs.append(p)
        return idx[k]
    # six faces, each a grid; shared border vertices are merged by position
    for axis, sign in ((2, 1), (2, -1), (0, 1), (0, -1), (1, 1), (1, -1)):
        a, b = [i for i in range(3) if i != axis]
        na, nb = (nu if a == 0 else (nv if a == 1 else 1)), (nu if b == 0 else (nv if b == 1 else 1))
        ext = (sx, sy, sz)
        for i in range(na):
            for j in range(nb):
                quad = []
                for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    p = [0.0, 0.0, 0.0]
                    p[axis] = sign * ext[axis]
                    p[a] = -ext[a] + 2 * ext[a] * (i + di) / na
                    p[b] = -ext[b] + 2 * ext[b] * (j + dj) / nb
                    quad.append(vid((cx + p[0], cy + p[1], cz + p[2])))
                faces.append(tuple(quad) if sign > 0 else tuple(reversed(quad)))
    v = np.array(vs)
    return cr.Piece(name, v, cr.fix_winding(v, faces), mat, bone=bone)


def pieces(lod, q):
    s = lambda n, lo=6: kit.seg(n, q, lo)  # noqa: E731
    out = []
    # body shell (bone) with a graphite underside plate, and the graphite lid on its hinge bone
    k = kit.Kit()
    k.cyl(0.170, 0.008, 0.060, BONE, s(112, 10), bev=0.014, bseg=max(2, int(5 * min(1, q * 1.2))), cap_bot=GRAPHITE)
    k.cyl(0.158, 0.004, 0.0125, GRAPHITE, s(96, 8), bev=0.003, bseg=2)
    # the face sits on the lid's front band: the brief's z 0.0605 / 0.061 would bury the brow and eyes inside the
    # 0.0565-0.065 lid, so they stand proud of the lid top (bezel tops at 0.0696, the brief's 0.070 overall height).
    # No glass covers (orchestrator, M4): the skinned renderer draws kn_screen as lit panels and has no
    # screen-through-glass pass, so each eye screen sits uncovered on a glossy graphite bezel pad (the brief's
    # glossy eye read without a separate shell); the bezel pads are quad-grid boxes (see grid_box)
    # exhaust grille: three slots on the rear rim (lofted ribs)
    if lod < 3:
        for i in (-1, 0, 1):
            k.rbox((0.026, 0.006, 0.004), (i * 0.032, 0.163, 0.034), 0.0018, GRAPHITE, cseg=max(1, int(2 * q)),
                   m=kit.rot_x(0))
    # status LED ring (group 0) round the lid edge, sunk half into the body top
    k.torus(0.1275, 0.0016, LED, s(96, 10), max(3, int(6 * q)), m=kit.at(0, 0.012, 0.0602))
    out.append(kit_piece('shell', k, 'body'))
    out.append(grid_box('brow', (0, -0.104, BROW_Z), (0.110, 0.022, 0.003), GRAPHITE, max(4, int(16 * q)),
                        max(2, int(4 * q)), 'body'))
    for sx, nm in ((1, 'bezel_l'), (-1, 'bezel_r')):
        out.append(grid_box(nm, (sx * 0.036, -0.105, EYE_Z), (0.027, 0.0125, 0.0036), BEZEL, max(3, int(8 * q)),
                            max(2, int(4 * q)), 'body'))
    k = kit.Kit()
    k.cyl(0.125, 0.0565, 0.065, GRAPHITE, s(96, 10), bev=0.003, bseg=2, m=kit.at(0, 0.012, 0))
    # charge pip (LED group 1) beside the power port, and a hinge barrel
    k.cyl(0.003, 0.064, 0.0665, LED, s(16, 6), bev=0.001, bseg=1, m=kit.at(0.022, 0.1, 0))
    k.cyl(0.004, -0.02, 0.02, GRAPHITE, s(16, 6), m=kit.frame((0, 0.134, 0.061), 'x'))
    out.append(kit_piece('lid', k, 'lid'))
    # bumper ring
    k = kit.Kit()
    k.torus(0.171, 0.012, RUBBER, s(128, 12), max(4, int(16 * q)), m=kit.at(0, 0, 0.03))
    out.append(kit_piece('bumper', k, 'bumper'))
    # drive wheels (rubber tyre, graphite hub)
    for sx, nm in ((1, 'wheel_l'), (-1, 'wheel_r')):
        k = kit.Kit()
        m = kit.frame((sx * 0.110, 0, WHEEL_R), 'x')
        k.cyl(WHEEL_R, -0.008, 0.008, RUBBER, s(32, 8), bev=0.003, bseg=2, m=m)
        k.cyl(0.011, -0.0085, 0.0085, GRAPHITE, s(20, 6), bev=0.001, bseg=1, m=m)
        out.append(kit_piece(nm, k, nm))
    # caster
    k = kit.Kit()
    k.sphere(0.009, GRAPHITE, s(16, 6), max(4, int(8 * q)), m=kit.at(0, -0.12, 0.009))
    out.append(kit_piece('caster', k, 'caster'))
    # side brush: Ignition hub + 3 arms with rubber tips
    k = kit.Kit()
    k.cyl(0.022, 0.003, 0.009, IGNITION, s(32, 8), bev=0.002, bseg=2, m=kit.at(BRUSH_C[0], BRUSH_C[1], 0))
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.4
        d = Vector((math.cos(a), math.sin(a), -0.08)).normalized()
        p0 = Vector(BRUSH_C) + Vector((d.x, d.y, 0)) * 0.012
        p1 = p0 + d * 0.042
        k.sweep([p0, p1], 0.0024, max(5, int(8 * q)), IGNITION)
        k.sphere(0.0034, RUBBER, max(6, int(10 * q)), max(4, int(6 * q)), m=kit.at(*p1))
    out.append(kit_piece('brush', k, 'brush'))
    return out


def screens(lod):
    """kn_screen quads: the two eye screens (body) and the bin-fill bar (lid). LOD3 keeps the eyes only."""
    items = []
    for sx in (1, -1):
        items.append((kit.screen_quad((sx * 0.036, -0.105, EYE_SCREEN_Z - COM[2]), (0, 0, 1), (0, 1, 0), 0.0215, 0.0085),
                      'body'))
    if lod < 3:
        items.append((kit.screen_quad((0.060, 0.040, 0.0656 - COM[2]), (0, 0, 1), (0, 1, 0), 0.040, 0.008), 'lid'))
    return items


# ---------------------------------------------------------------- the robot critter build

class Robot(cr.Critter):
    def build_lod_pieces(self, lod, q):
        pcs = pieces(lod, q)
        return pcs, sum(p.tris() for p in pcs)

    def tune(self, lod, target):
        lo, hi = 0.05, 2.0
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
        names = self.deform_bones()
        k = kit.Kit()
        bones_of = []
        for sk, bone in screens(lod):
            n0 = len(k.bm.verts)
            k.merge(sk)
            bones_of += [bone] * (len(k.bm.verts) - n0)
        nm = '%s__screens%s' % (self.type, cr.LOD_SUFFIX[lod])
        from kn_tools import geom
        ob = geom.object_from_bmesh(nm, k.bm, [self.mats[n] for n in k.mats], template.get_collection(LOD_COLLECTIONS[lod]),
                                    recalc_normals=False)
        k.free()
        groups = {n: ob.vertex_groups.new(name=n) for n in names}
        for vi, b in enumerate(bones_of):
            groups[b].add([vi], 1.0, 'REPLACE')
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = self.rig
        return ob

    def led_colours(self, ob):
        """ASSET_PIPELINE §3.6: `led` face-corner colour on kn_led faces (R = group / 255, G = brightness)."""
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
                pip = p.center.y + self.com.y > 0.09 and p.center.x > 0.015   # charge pip beside the port
                col = ((1.0 if pip else 0.0) / 255.0, 1.0, 0.0, 1.0)
            for l in p.loop_indices:
                attr.data[l].color = col

    def build(self, library):
        s = self.s
        self.build_rig()
        names = self.deform_bones()
        budget = s['tri_budget']
        q0 = self.tune(0, budget * 0.985)
        p0, t0 = self.build_lod_pieces(0, q0)
        ob0 = self.assemble(0, p0, names, None)
        self.led_colours(ob0)
        self.screens_object(0)
        for lod in (1, 2, 3):
            q = self.tune(lod, t0 * LOD_RATIOS['LOD%d' % lod])
            pcs, _t = self.build_lod_pieces(lod, q)
            ob = self.assemble(lod, pcs, names, None)
            self.led_colours(ob)
            self.screens_object(lod)
        self.ragdoll()
        part = self.part
        part.col_cyl('0', 0.183, 0.055, Vector((0, 0, 0.0355)) - self.com, axis='z', phys='rubber', restitution=0.45)
        self.emitters()
        # pivots: the engine's procedural drivers; each names the bone it turns (pivot-mirror bones)
        for nm, loc, axis, lo, hi, extra in (
                ('wheel_l', (0.110, 0, WHEEL_R), 'x', None, None, {'continuous': True}),
                ('wheel_r', (-0.110, 0, WHEEL_R), 'x', None, None, {'continuous': True}),
                ('brush', BRUSH_C, 'z', None, None, {'continuous': True, 'rps_roam': 6.0, 'rps_suck': 12.0}),
                ('bumper', (0, 0, 0.03), 'y', 0.0, 0.005, {'translate': True}),
                ('lid', LID_HINGE, 'x', 0.0, 35.0, {}),
                ('caster', (0, -0.12, 0.01), 'z', None, None, {'free': True})):
            pn = part.pivot(nm, Vector(loc) - self.com, axis, lo, hi, bone=nm, **extra)
        # power port (approved look-dev): on the lid, facing up
        part.port('power', 'charge', Vector((0, 0.100, 0.064)) - self.com, (0, 0, 1), 'S', 'in')
        # sensors: the intake under the body, the bumper trigger (convex hull of the 180° front arc)
        c = Vector((0, -0.030, 0.006)) - self.com
        part.sensor('intake', 'suction', [(c.x + x * 0.1, c.y + y * 0.03, c.z + z * 0.006) for x in (-1, 1)
                                          for y in (-1, 1) for z in (-1, 1)], kinds='sand,marble')
        arc = []
        for i in range(13):
            a = math.pi + math.pi * i / 12
            for r in (0.178, 0.188):
                for z in (0.02, 0.04):
                    arc.append((r * math.cos(a), r * math.sin(a), z - self.com.z))
        part.sensor('trigger', 'bumper', arc, threshold=0.05)
        # screens for .art.json (same quads as the render screens)
        for sx, nm in ((1, 'eye_l'), (-1, 'eye_r')):
            part.screen(nm, 0.026, 0.012, Vector((sx * 0.036, -0.105, EYE_SCREEN_Z)) - self.com, normal=(0, 0, 1),
                        up=(0, 1, 0), kind='icon', color='beam')
        part.screen('bin', 0.040, 0.008, Vector((0.060, 0.040, 0.0656)) - self.com, normal=(0, 0, 1), up=(0, 1, 0),
                    kind='bar', cells=5, color='beam')
        made = self.clips(library)
        for nm, (frames, loop, fn) in library.items():
            act = bpy_action('%s__%s' % (self.type, nm))
            if act is not None and nm in FACE:
                act['kn_face'] = json.dumps(FACE[nm])
        root = part.root
        root['kn_robot'] = True
        root['kn_face_icons'] = ','.join(FACE_ICONS)
        root['led_groups'] = '0:status_ring,1:charge'
        dg = __import__('bpy').context.evaluated_depsgraph_get()
        pts = np.array([v.co[:] for v in ob0.evaluated_get(dg).to_mesh().vertices])
        ob0.evaluated_get(dg).to_mesh_clear()
        size = pts.max(0) - pts.min(0)
        root['kn_footprint'] = '%g,%g,%g' % (round(size[0] * 10, 2), round(size[2] * 10, 2), round(size[1] * 10, 2))
        print('  footprint (cells) %s, size %s m, root-space z %.3f..%.3f' % (
            root['kn_footprint'], np.round(size, 3), pts.min(0)[2] + self.com.z, pts.max(0)[2] + self.com.z))
        print('  clips (%d): %s' % (len(made), ', '.join(made)))
        self.rig.data.pose_position = 'REST'
        return self

    def ragdoll(self):
        """RAG__body: the collision cylinder (Ø 0.366 × 0.055, z 0.008-0.063), rigid (swing 0, twist 0)."""
        import bpy
        k = kit.Kit()
        k.cyl(0.183, -0.0275, 0.0275, 'x', 32)
        me = bpy.data.meshes.new('RAG__body')
        k.bm.to_mesh(me)
        k.free()
        ob = bpy.data.objects.new('RAG__body', me)
        ob.matrix_world = Matrix.Translation(Vector((0, 0, 0.0355)) - self.com)
        ob['bone'] = 'body'
        ob['rag_parent'] = ''
        ob['rag_shape'] = 'cylinder'
        ob['swing_deg'] = 0.0
        ob['twist_deg'] = 0.0
        ob['mass'] = 3.2
        ob['phys'] = 'rubber'
        ob['restitution'] = 0.45
        ob['radius'] = 0.183
        ob['half_height'] = 0.0275
        ob.display_type = 'WIRE'
        ob.hide_render = True
        template.get_collection('RIG').objects.link(ob)
        return [ob]


def bpy_action(name):
    import bpy
    return bpy.data.actions.get(name)


# ---------------------------------------------------------------- clips (robot behaviours)

ANIM = {'kind': 'quad', 'hips': 'body', 'spine': [], 'neck': [], 'head': None, 'ears': {}, 'legs': {}, 'tail': []}
# per clip: [frame, icon] keys of the LED face (critters.md "Face shape keys": the icon list)
FACE = {
    'idle': [[0, 'neutral'], [40, 'blink'], [43, 'neutral'], [76, 'blink'], [79, 'neutral']],
    'idle_alt': [[0, 'neutral'], [20, 'scan'], [100, 'neutral'], [108, 'blink'], [111, 'neutral']],
    'walk': [[0, 'happy']], 'run': [[0, 'determined']], 'chase': [[0, 'determined']], 'flee': [[0, 'scared']],
    'startled': [[0, 'surprised'], [20, 'neutral']], 'tumble': [[0, 'scared']],
    'getup': [[0, 'scared'], [27, 'determined'], [40, 'happy']], 'dizzy': [[0, 'dizzy']],
    'trapped': [[0, 'angry'], [28, 'blink'], [31, 'angry']], 'celebrate': [[0, 'happy']],
    'sleep': [[0, 'sleepy']], 'sniff': [[0, 'scan']], 'emote_happy': [[0, 'happy']],
    'emote_angry': [[0, 'angry']], 'emote_confused': [[0, 'surprised'], [12, 'neutral'], [24, 'blink'], [27, 'scan']],
    'suck': [[0, 'determined']], 'bin_full': [[0, 'strain'], [27, 'surprised'], [33, 'smug']],
    'bump_turn': [[0, 'surprised'], [6, 'neutral']],
}


def lowest_lift(roll_deg, pitch_deg=0.0):
    """hip_z that keeps the disc (x ±0.183, z -0.032..+0.038 about the COM) on the floor when rolled / pitched."""
    th = math.radians(roll_deg)
    ph = math.radians(pitch_deg)
    zs = []
    for x in (-0.183, 0.183):
        for z in (-0.032, 0.038):
            zr = -x * math.sin(th) + z * math.cos(th)
            zs.append(zr * math.cos(ph))
    for y in (-0.183, 0.183):
        for z in (-0.032, 0.038):
            zs.append(y * math.sin(ph) + z * math.cos(ph) * math.cos(th))
    return max(0.0, -0.032 - min(zs))


def library():
    S, C, win, ramp, TAU = an.S, an.C, an.win, an.ramp, an.TAU
    L = {}

    def drive(c, t, T, wl=0.0, wr=None, brush=0.0, caster=0.0, bump=0.0, lid=0.0):
        """Pivot bones: wheel / brush turns in revolutions over the clip (whole numbers keep loops seamless),
        bumper travel in metres, lid in degrees."""
        wr = wl if wr is None else wr
        u = t / T
        b = c.setdefault('bones', {})
        # a wheel rolling forward (-Y) turns its top toward -Y: about +X by -angle
        b['wheel_l'] = [('p', -360.0 * wl * u)]
        b['wheel_r'] = [('p', -360.0 * wr * u)]
        b['brush'] = [('y', 360.0 * brush * u)]
        b['caster'] = [('y', caster)]
        b['lid'] = [('p', lid)]
        if bump:
            c.setdefault('loc', {})['bumper'] = (0.0, bump, 0.0)
        return c

    def idle(t, T):
        c = {'hip_roll': 1.2 * S(t, T, 1), 'hip_pitch': 0.8 * S(t, T, 2, 0.2)}
        return drive(c, t, T, brush=1)
    L['idle'] = (90, True, idle)

    def idle_alt(t, T):   # brush wiggle, look-around
        c = {'hip_yaw': 10 * S(t, T, 1), 'hip_roll': 1.5 * S(t, T, 2)}
        drive(c, t, T)
        c['bones']['brush'] = [('y', 25 * S(t, T, 8))]
        return c
    L['idle_alt'] = (120, True, idle_alt)

    def roam(t, T, w, br, tilt=0.0, buzz=0.0006):
        c = {'hip_pitch': tilt, 'hip_z': buzz * S(t, T, 15), 'hip_roll': 0.6 * S(t, T, 3)}
        return drive(c, t, T, wl=w, brush=br, caster=4 * S(t, T, 1))
    L['walk'] = (30, True, lambda t, T: roam(t, T, 2, 2))
    L['run'] = (15, True, lambda t, T: roam(t, T, 2, 2, tilt=1.5, buzz=0.001))
    L['chase'] = (15, True, lambda t, T: roam(t, T, 2, 2, tilt=2.5, buzz=0.0012))

    def flee(t, T):   # reverse and spin away
        c = {'hip_yaw': 25 * S(t, T, 1), 'hip_pitch': -2, 'hip_z': 0.001 * S(t, T, 12)}
        return drive(c, t, T, wl=-3, wr=-1, brush=3, caster=180)
    L['flee'] = (30, True, flee)

    def startled(t, T):   # a 0.02 m hop
        hop = math.sin(math.pi * ramp(t, 0.05, 0.4)) if t < 0.45 else 0.0
        c = {'hip_z': 0.02 * hop, 'hip_pitch': -6 * hop, 'hip_roll': 3 * hop * S(t, T, 3)}
        return drive(c, t, T, brush=1, bump=0.003 * hop)
    L['startled'] = (24, False, startled)

    def tumble(t, T):   # rigid tumble (the ragdoll moves the body); wheels and brush spin, the bumper rattles
        c = {}
        return drive(c, t, T, wl=4, wr=-4, brush=8, caster=360 * t / T, bump=0.0025 + 0.0025 * S(t, T, 6))
    L['tumble'] = (24, True, tumble)

    def getup(t, T):   # upside down: wobble, wheels spin, a little puff tips it upright
        flip = 1 - ramp(t, 0.9, 1.25)
        wob = 6 * S(t, T, 4) * win(t, 0.0, 0.85, 0.1)
        roll = 180 * flip + wob * flip
        c = {'hip_roll': roll, 'hip_z': lowest_lift(roll) + 0.012 * math.sin(math.pi * ramp(t, 0.9, 1.25))}
        c['hip_z'] += 0.004 * win(t, 1.28, 1.4, 0.05)
        return drive(c, t, T, wl=6 * win(t, 0.0, 0.9, 0.1), wr=-6 * win(t, 0.0, 0.9, 0.1), brush=4)
    L['getup'] = (45, False, getup)

    def dizzy(t, T):   # slow spin with a wobble
        c = {'hip_yaw': 360.0 * t / T, 'hip_roll': 4 * S(t, T, 2), 'hip_pitch': 3 * C(t, T, 2)}
        c['hip_z'] = lowest_lift(4 * S(t, T, 2), 3 * C(t, T, 2))
        return drive(c, t, T, wl=1, wr=-1, brush=1)
    L['dizzy'] = (60, True, dizzy)

    def trapped(t, T):   # bumping in place without turning
        k = max(0.0, S(t, T, 4)) ** 2
        c = {'hip_y': -0.008 * k, 'hip_pitch': 2 * k}
        return drive(c, t, T, wl=2, brush=2, bump=0.005 * win(t % (T / 4), 0.08, 0.2, 0.04))
    L['trapped'] = (60, True, trapped)

    def celebrate(t, T):   # a 360° spin, lid pop
        u = ramp(t, 0.1, 1.2)
        c = {'hip_yaw': 360.0 * u, 'hip_z': 0.006 * math.sin(math.pi * u)}
        return drive(c, t, T, wl=2, wr=-2, brush=4, lid=15 * win(t, 0.4, 1.3, 0.12))
    L['celebrate'] = (45, False, celebrate)

    def sleep(t, T):
        c = {'hip_z': -0.0005 * (1 + S(t, T, 1)) * 0.5}
        return drive(c, t, T)
    L['sleep'] = (90, True, sleep)

    def sniff(t, T):   # scan: stops, rotates ±25°
        c = {'hip_yaw': 25 * S(t, T, 1)}
        return drive(c, t, T, wl=0.5, wr=-0.5, brush=1)
    L['sniff'] = (60, True, sniff)

    def emote_happy(t, T):
        b = max(0.0, math.sin(TAU * t / (T / 2)))
        c = {'hip_yaw': 12 * S(t, T, 3), 'hip_z': 0.006 * b}
        return drive(c, t, T, brush=3, lid=8 * b)
    L['emote_happy'] = (36, False, emote_happy)

    def emote_angry(t, T):
        k = win(t, 0.15, 0.3, 0.04) + win(t, 0.5, 0.65, 0.04)
        c = {'hip_y': -0.01 * k, 'hip_pitch': 3 * k}
        return drive(c, t, T, wl=1, brush=4, bump=0.004 * k)
    L['emote_angry'] = (36, False, emote_angry)

    def emote_confused(t, T):
        c = {'hip_roll': 5 * S(t, T, 1), 'hip_yaw': -15 * S(t, T, 1)}
        c['hip_z'] = lowest_lift(5 * S(t, T, 1))
        return drive(c, t, T, brush=1)
    L['emote_confused'] = (45, False, emote_confused)

    def suck(t, T):   # 0.3 s intake gulp shudder
        c = {'hip_z': -0.0015 * math.sin(math.pi * t / T) + 0.0008 * S(t, T, 6), 'hip_pitch': -1.5 * math.sin(math.pi * t / T)}
        return drive(c, t, T, brush=1.2)
    L['suck'] = (9, False, suck)

    def bin_full(t, T):   # 1.5 s: the lid strains, then pops; burp puff (EMIT__dust__exhaust); smug eyes
        strain = win(t, 0.1, 0.85, 0.15)
        pop = ramp(t, 0.88, 1.0)
        c = {'hip_z': 0.0012 * strain * S(t, T, 18), 'hip_pitch': 2 * strain * S(t, T, 9) - 3 * win(t, 0.9, 1.1, 0.05),
             'scale': {'body': (1 + 0.03 * strain, 1 + 0.03 * strain, 1 - 0.02 * strain)}}
        lid = 6 * strain * (0.5 + 0.5 * S(t, T, 12)) * (1 - pop) + 35 * pop
        return drive(c, t, T, lid=lid)
    L['bin_full'] = (45, False, bin_full)

    def bump_turn(t, T):   # bumper compresses, then a turn on the spot (the engine turns the body 30-150°)
        hit = win(t, 0.0, 0.2, 0.05)
        c = {'hip_y': 0.003 * hit, 'hip_pitch': 1.5 * hit}
        return drive(c, t, T, wl=-1.5, wr=1.5, brush=2, bump=0.005 * hit)
    L['bump_turn'] = (24, False, bump_turn)
    return L


SPEC = {
    'type': TYPE, 'com': COM, 'mass': 3.2, 'tri_budget': 16000, 'ragdoll_impulse': 4.0,
    'skins': 'bone,night_shift,future_edition',
    'notes': 'Robot vacuum critter (rigid). Brief: docs/art/briefs/critters.md#dusty. Origin = centre of mass; root '
             'bone on the floor at part (0,0,-0.032). Rig = root + body + pivot-mirror bones named by the PIVOT__ '
             'empties; LED face icons per clip in .art.json faceTracks; RAG__body is the collision cylinder. The '
             'bin fill adds up to 1.8 kg in the sim (critters.md). M4 stream E4b.',
    'masters': {m: m for m in (BONE, GRAPHITE, IGNITION, RUBBER, BEZEL, LED, SCREEN)},
    'phys': {'restitution': 0.45},
    'bones': bones(), 'elements': [], 'accessories': lambda lod: [], 'face': {},
    'ragdoll': [],
    'emitters': [('suck', 'intake', (0, -0.030, 0.0), (0, 0, 1), 'body'),
                 ('dust', 'exhaust', (0, 0.170, 0.030), (0, 1, 0), 'body'),
                 ('voice', 'speaker', (0, -0.120, 0.050), (0, -1, 0), 'body'),
                 ('emote', 'bubble', (0, 0, 0.18), (0, 0, 1), 'body')],
    'anim': ANIM,
    'role_clips': ('suck', 'bin_full', 'bump_turn'),
}


def tex_looks():
    # satin moulded ABS: rough enough that the graphite lid reads dark (as the approved look-dev), not silver
    return {BONE: {'look': 'plastic', 'rough': 0.48}, GRAPHITE: {'look': 'plastic', 'rough': 0.55},
            IGNITION: {'look': 'plastic', 'rough': 0.45}, BEZEL: {'look': 'plastic', 'rough': 0.18}}


def main(out_path=None, tex=True):
    from kn_tools import textures
    c = Robot(SPEC)
    c.part.root['kn_tex_looks'] = json.dumps(tex_looks(), separators=(',', ':'))
    c.build(library())
    path = c.part.save(out_path)
    if tex:
        # D78 set at 2048² (robot critter); assets.mjs bakes parts only. 128 samples: the face band's close-set
        # bezels, brow and lid make the cavity AO noisy at the default 24 (speckle on the brow strip)
        textures.texture_part(samples=128)
        c.part.save(path)
    return path


if __name__ == '__main__':
    args = _cli.script_args()
    no_tex = _cli.flag(args, '--no-tex')
    main(os.path.abspath(args[0]) if args else None, tex=not no_tex)
