"""Procedural critter clips (M2, stream E2): semantic channels -> bone rotations -> baked actions.

A clip is fn(t, T) -> channels (a dict; missing keys are 0). A mapper turns the channels into per-bone
rotations about *armature* axes (X = the critter's left, Y = back, Z = up), which bake_action converts to
each bone's local frame. Conventions for the channel values (degrees unless noted):
  pitch +   nose / limb tip forward-up            yaw +   toward the critter's left (+X)
  roll  +   right side up                         hip_x/y/z  hips offset in metres (+Y = back)
Loops are periodic in T (every frequency is a whole number of cycles per clip), so frame 0 == frame N.
Root motion is never keyed: the `root` bone stays at rest in every clip (ASSET_PIPELINE §6).
"""
import math
from collections import defaultdict

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
TAU = 2 * math.pi


def P(deg):
    """Pitch: limb tip / nose forward-up (rotation about armature X by -deg)."""
    return Quaternion((1, 0, 0), math.radians(-deg))


def Y(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


def R(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def rot(pitch=0.0, yaw=0.0, roll=0.0):
    return Y(yaw) @ P(pitch) @ R(roll)


def ss(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def win(t, a, b, fade=0.08):
    """1 inside [a, b] with smooth edges of `fade` seconds."""
    return ss((t - a) / fade + 1) * ss((b - t) / fade + 1) if fade > 0 else float(a <= t <= b)


def ramp(t, a, b):
    return ss((t - a) / max(1e-6, b - a))


def S(t, T, k=1, ph=0.0):
    return math.sin(TAU * (k * t / T + ph))


def C(t, T, k=1, ph=0.0):
    return math.cos(TAU * (k * t / T + ph))


# ---------------------------------------------------------------- mappers

def map_quad(ch, a):
    """Quadruped / biped channels -> {bone: (Quaternion armature-axes, loc Vector|None, scale float|None)}."""
    g = defaultdict(float, ch)
    out = {}

    def put(b, q, loc=None, sc=None):
        if b is None:
            return
        o = out.get(b)
        if o:
            q = o[0] @ q
            loc = loc if loc is not None else o[1]
            sc = sc if sc is not None else o[2]
        out[b] = (q, loc, sc)

    put(a['hips'], rot(g['hip_pitch'], g['hip_yaw'], g['hip_roll']), Vector((g['hip_x'], g['hip_y'], g['hip_z'])))
    sp = a['spine']
    for i, b in enumerate(sp):
        w = a.get('spine_w', [1.0 / len(sp)] * len(sp))[i]
        put(b, rot(g['spine_pitch'] * w + g.get('spine_pitch_%d' % i, 0.0), g['spine_yaw'] * w,
                   g['spine_roll'] * w))
    nk = a['neck']
    for b in nk:
        put(b, rot(g['neck_pitch'] / len(nk), g['neck_yaw'] / len(nk), 0))
    put(a['head'], rot(g['head_pitch'], g['head_yaw'], g['head_roll']))
    put(a.get('jaw'), rot(-g['jaw'], 0, 0))
    for side, sx in (('l', 1), ('r', -1)):
        ear = a['ears'].get(side, [])
        for i, b in enumerate(ear):
            k = 1.0 if i == 0 else 0.5
            put(b, rot(g['ear_back_' + side] * k, 0, g['ear_splay_' + side] * sx * k))
        put(a.get('eye_' + side), rot(g['eye_pitch'], g['eye_yaw'], 0))
    for leg, chain in a['legs'].items():
        side = 1 if leg.endswith('l') else -1
        sw, bd, spd = g[leg + '_swing'], g[leg + '_bend'], g[leg + '_spread']
        if chain['kind'] in ('front', 'arm'):
            put(chain.get('clav'), rot(sw * 0.25, 0, spd * 0.3 * side))
            put(chain.get('upper'), rot(sw * (0.75 if chain.get('clav') else 1.0), g[leg + '_yaw'] * side,
                                        spd * side * (0.7 if chain.get('clav') else 1.0)))
            put(chain.get('lower'), rot(-bd, g[leg + '_elbow_in'] * -side, 0))
            put(chain.get('foot'), rot(bd * 1.2 + g[leg + '_wrist'], 0, 0))
            put(chain.get('toe'), rot(bd * 0.3, 0, 0))
            grip = g[leg + '_grip']
            put(chain.get('fingers'), rot(-grip, 0, 0))
            put(chain.get('thumb'), rot(-grip * 0.6, grip * 0.3 * -side, 0))
        else:
            put(chain.get('upper'), rot(sw, 0, spd * side))
            put(chain.get('lower'), rot(bd, 0, 0))
            put(chain.get('foot'), rot(-bd * 1.25 + g[leg + '_ankle'], 0, 0))
            put(chain.get('paw'), rot(bd * 0.3, 0, 0))
            put(chain.get('toe'), rot(bd * 0.3, 0, 0))
    tail = a.get('tail', [])
    n = len(tail)
    for i, b in enumerate(tail):
        f = g['tail_freq'] or 0.0
        wave = g['tail_wave'] * math.sin(TAU * (f * g['_t']) - i * (g['tail_k'] or 0.6)) * (0.4 + 0.6 * i / max(1, n - 1))
        lift = g['tail_pitch'] if i == 0 else g['tail_bend']
        tip = g['tail_tip'] if i >= n - 3 else 0.0
        # bottle-brush: thicken (bone-local x / z) at the base only; the chain inherits it, length stays
        puff = (g['tail_puff'], 1.0, g['tail_puff']) if (i == 0 and g['tail_puff']) else None
        put(b, rot(lift + tip, (g['tail_yaw'] if i == 0 else 0.0) + g['tail_curl'] + wave, 0), sc=puff)
    for b, items in ch.get('bones', {}).items():
        q = Quaternion()
        for ax, deg in items:
            q = q @ {'p': P, 'y': Y, 'r': R}[ax](deg)
        put(b, q)
    for b, sc in ch.get('scale', {}).items():
        put(b, Quaternion(), sc=sc)
    for b, loc in ch.get('loc', {}).items():
        put(b, Quaternion(), loc=Vector(loc))
    return out


def map_fish(ch, a):
    g = defaultdict(float, ch)
    t = g['_t']
    out = {}

    def put(b, q, loc=None, sc=None):
        out[b] = (q, loc, sc)

    put(a['body'], rot(g['body_pitch'], g['body_yaw'], g['body_roll']),
        Vector((g['body_x'], g['body_y'], g['body_z'])))
    sp = a['spine']
    n = len(sp)
    f, k = g['wave_freq'], (g['wave_k'] or 0.7)
    for i, b in enumerate(sp):
        amp = g['wave_amp'] * ((i + 1) / n) ** 1.2
        put(b, rot(g['arch'], g['curl'] + amp * math.sin(TAU * f * t - k * (i + 1)), 0))
    put(a['head'], rot(g['head_pitch'], g['head_yaw'] + g['wave_amp'] * 0.15 * math.sin(TAU * f * t + 0.8), 0))
    put(a['jaw'], rot(-g['jaw'], 0, 0))
    for side, sx in (('l', 1), ('r', -1)):
        put(a['eyes'][side], rot(g['eye_pitch'], g['eye_yaw'], 0))
        put(a['gills'][side], rot(0, g['gill'] * sx, 0))
        pf, pa = g['pect_freq'], g['pect_amp']
        for i, b in enumerate(a['pect'][side]):
            ph = 0.0 if side == 'l' else g['pect_ph']
            put(b, rot(pa * math.sin(TAU * (pf * t + ph) - i * 0.9) + g['pect_base'], g['pect_fold'] * sx, 0))
        put(a['pelvic'][side], rot(g['pelvic'] * math.sin(TAU * pf * t + (0 if side == 'l' else 1.5)), 0, 0))
    for i, b in enumerate(a['dorsal']):
        put(b, rot(-g['dorsal_raise'], g['dorsal_amp'] * math.sin(TAU * f * t - i * 0.8 - 1.0), 0))
    for b in a['anal']:
        put(b, rot(g['dorsal_raise'] * 0.5, g['dorsal_amp'] * math.sin(TAU * f * t - 2.0), 0))
    for lobe, sx in (('l', 1), ('c', 0), ('r', -1)):
        for i, b in enumerate(a['tail'][lobe]):
            amp = g['wave_amp'] * 1.15 * (1.0 + 0.3 * i)
            yaw = amp * math.sin(TAU * f * t - k * (n + 1 + i)) + g['curl'] * 0.8
            spread = g['tail_spread'] * sx if i == 0 else g['tail_spread'] * 0.3 * sx
            put(b, rot(g['arch'] * 0.5 + (g['tail_fold'] * (1 if lobe != 'c' else 0) if i == 0 else 0),
                       yaw + spread, 0))
    for b, items in ch.get('bones', {}).items():
        q = Quaternion()
        for ax, deg in items:
            q = q @ {'p': P, 'y': Y, 'r': R}[ax](deg)
        put(b, q)
    return out


MAPPERS = {'quad': map_quad, 'fish': map_fish}


# ---------------------------------------------------------------- baking

def bake_action(rig, name, frames, loop, fn, aspec):
    """Sample fn at every frame 0..frames, write quaternion (+ location / scale where used) fcurves."""
    mapper = MAPPERS[aspec['kind']]
    T = frames / FPS
    bones = rig.data.bones
    rest = {b.name: b.matrix_local.to_3x3() for b in bones}
    samples = []
    used_loc, used_sc = set(), set()
    for f in range(frames + 1):
        t = (f % frames) / FPS if loop else f / FPS
        ch = fn(t, T)
        ch['_t'] = t
        pose = mapper(ch, aspec)
        local = {}
        for b, (q, loc, sc) in pose.items():
            if b not in rest or b == 'root':
                continue
            R3 = rest[b]
            Ri = R3.inverted()
            ql = (Ri @ q.to_matrix() @ R3).to_quaternion()
            ll = None
            if loc is not None and loc.length > 1e-9:
                ll = Ri @ loc
                used_loc.add(b)
            if sc:
                used_sc.add(b)
            local[b] = (ql, ll, sc)
        samples.append(local)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    names = sorted({b for s in samples for b in s})
    for b in names:
        grp = act.groups.new(b)
        prev = None
        qs = []
        for s in samples:
            q = s.get(b, (Quaternion(), None, None))[0].copy()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            qs.append(q)
            prev = q
        _curves(act, 'pose.bones["%s"].rotation_quaternion' % b, grp, [[q[i] for q in qs] for i in range(4)])
        if b in used_loc:
            vals = [s.get(b, (None, None, None))[1] or Vector() for s in samples]
            _curves(act, 'pose.bones["%s"].location' % b, grp, [[v[i] for v in vals] for i in range(3)])
        if b in used_sc:
            vals = [_vec3(s.get(b, (None, None, None))[2]) for s in samples]
            _curves(act, 'pose.bones["%s"].scale' % b, grp, [[v[i] for v in vals] for i in range(3)])
    act.frame_range = (0, frames)
    try:
        act.use_frame_range = True
    except AttributeError:
        pass
    return act


def _vec3(sc):
    if sc is None:
        return (1.0, 1.0, 1.0)
    if isinstance(sc, (int, float)):
        return (float(sc),) * 3
    return tuple(float(x) for x in sc)


def _curves(act, path, grp, channels):
    for i, vals in enumerate(channels):
        fc = act.fcurves.new(path, index=i, action_group=grp.name)
        n = len(vals)
        fc.keyframe_points.add(n)
        co = []
        for f, v in enumerate(vals):
            co.extend((float(f), float(v)))
        fc.keyframe_points.foreach_set('co', co)
        fc.keyframe_points.foreach_set('interpolation', [1] * n)  # LINEAR (sampled every frame)
        fc.update()


# ---------------------------------------------------------------- quadruped clip library

def gait(ch, t, T, phases, swing, lift, cycles=1, legs=('fl', 'fr', 'hl', 'hr'), base_bend=0.0):
    for leg in legs:
        s = TAU * (cycles * t / T + phases[leg])
        ch[leg + '_swing'] = ch.get(leg + '_swing', 0.0) + swing * math.sin(s)
        ch[leg + '_bend'] = ch.get(leg + '_bend', 0.0) + lift * max(0.0, math.cos(s)) + base_bend


WALK = {'hl': 0.0, 'fl': 0.25, 'hr': 0.5, 'fr': 0.75}
GALLOP = {'fl': 0.0, 'fr': 0.1, 'hl': 0.5, 'hr': 0.6}


def quad_library(sp):
    """Required clips for a four-legged critter. sp: species tuning (sizes in metres, angles in degrees)."""
    hh = sp['hip_h']         # hips height above the floor
    tc = sp['tail_carry']    # resting tail lift
    L = {}

    def base(t, T, f=0.5):
        return {'tail_pitch': tc, 'tail_bend': sp.get('tail_bend', 0.0), 'tail_freq': 0.0, 'tail_k': 0.6}

    def idle(t, T):
        c = base(t, T)
        c.update(spine_pitch=1.5 * S(t, T, 2), hip_z=0.002 * hh * C(t, T, 2), head_yaw=6 * S(t, T, 1),
                 head_pitch=2 * S(t, T, 2, 0.2), tail_wave=8, tail_freq=1 / T,
                 ear_back_l=8 * win(t, 1.0, 1.3), ear_splay_r=10 * win(t, 2.0, 2.25))
        return c
    L['idle'] = (90, True, idle)

    def idle_alt(t, T):
        c = base(t, T)
        look = math.sin(TAU * t / T)
        c.update(head_yaw=35 * look, neck_yaw=10 * look, head_pitch=6 * S(t, T, 2), tail_wave=12,
                 tail_freq=2 / T, ear_back_l=-10 * look, ear_back_r=10 * look, spine_yaw=4 * look)
        return c
    L['idle_alt'] = (120, True, idle_alt)

    def walk(t, T):
        c = base(t, T)
        gait(c, t, T, WALK, sp['stride'], sp['lift'])
        c.update(hip_z=-sp['bob'] * 0.5 + sp['bob'] * 0.5 * C(t, T, 2), spine_yaw=3 * S(t, T, 1),
                 head_pitch=-2 * C(t, T, 2), tail_wave=10, tail_freq=1 / T, hip_roll=2 * S(t, T, 1))
        return c
    L['walk'] = (int(round(sp['walk_T'] * FPS)), True, walk)

    def run(t, T, head=0.0, ears=0.0, tail=0.0, low=0.0, k=1.0):
        c = base(t, T)
        gait(c, t, T, GALLOP, sp['run_stride'] * k, sp['lift'] * 1.4)
        c.update(spine_pitch=sp['run_flex'] * S(t, T, 1, 0.25), hip_z=sp['bob'] * 1.5 * S(t, T, 1) - low,
                 hip_pitch=4 * S(t, T, 1, 0.25), neck_pitch=head, head_pitch=-head * 0.5 + 3 * C(t, T, 1),
                 ear_back_l=ears, ear_back_r=ears, tail_pitch=tc * 0.3 + tail, tail_bend=1, tail_wave=6,
                 tail_freq=1 / T)
        return c
    L['run'] = (int(round(sp['run_T'] * FPS)), True, run)
    L['chase'] = (int(round(sp['run_T'] * 0.9 * FPS)), True,
                  lambda t, T: run(t, T, head=-12, ears=-12, tail=-10, low=0.01 * hh))
    L['flee'] = (int(round(sp['run_T'] * 0.8 * FPS)), True,
                 lambda t, T: run(t, T, head=-4, ears=55, tail=-tc - 15, low=0.04 * hh, k=1.1))

    def startled(t, T):
        c = base(t, T)
        crouch = win(t, 0.0, 0.12, 0.05)
        air = win(t, 0.15, 0.5, 0.1)
        land = win(t, 0.5, 0.65, 0.06)
        settle = ramp(t, 0.6, T)
        c.update(hip_z=-0.12 * hh * crouch + 0.25 * hh * air - 0.08 * hh * land,
                 hip_pitch=8 * air, tail_pitch=tc + 35 * air * (1 - settle) + 20 * (1 - settle) * ramp(t, 0.1, 0.2),
                 tail_bend=-1, ear_back_l=-15 * air + 30 * settle * (1 - ramp(t, 0.7, T)),
                 ear_back_r=-15 * air + 30 * settle * (1 - ramp(t, 0.7, T)), head_pitch=12 * air,
                 spine_pitch=6 * air)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_spread'] = 12 * air
            c[leg + '_bend'] = 35 * crouch + 25 * land
            c[leg + '_swing'] = (10 if leg[0] == 'f' else -10) * air
        return c
    L['startled'] = (24, False, startled)

    def tumble(t, T):
        c = base(t, T)
        for i, leg in enumerate(('fl', 'fr', 'hl', 'hr')):
            c[leg + '_swing'] = 45 * S(t, T, 2, i * 0.27)
            c[leg + '_bend'] = 30 + 30 * C(t, T, 2, i * 0.31)
            c[leg + '_spread'] = 20 + 15 * S(t, T, 1, i * 0.2)
        c.update(spine_pitch=-18 + 10 * S(t, T, 1), spine_yaw=12 * S(t, T, 1, 0.3), head_pitch=-15 + 10 * S(t, T, 2),
                 head_roll=15 * S(t, T, 1), tail_wave=35, tail_freq=2 / T, ear_back_l=40, ear_back_r=40,
                 ear_splay_l=25, ear_splay_r=25, jaw=10)
        return c
    L['tumble'] = (24, True, tumble)

    lie = sp['lie_drop']

    def getup(t, T):
        c = base(t, T)
        u = ramp(t, 0.25, 0.85)            # 0 lying on the side -> 1 standing
        c.update(hip_roll=88 * (1 - u), hip_z=-lie * (1 - u) + 0.03 * hh * win(t, 0.85, 1.0, 0.06),
                 spine_yaw=-15 * (1 - u), head_pitch=-10 * (1 - u) + 8 * win(t, 0.85, 1.1, 0.08),
                 head_roll=25 * (1 - ramp(t, 0.1, 0.5)), tail_pitch=tc * u - 10 * (1 - u),
                 ear_back_l=30 * (1 - u), ear_back_r=30 * (1 - u))
        for leg in ('fl', 'fr', 'hl', 'hr'):
            fold = win(t, 0.3, 0.75, 0.15)
            c[leg + '_bend'] = 20 * (1 - u) + 60 * fold
            c[leg + '_swing'] = (25 if leg[0] == 'f' else -20) * (1 - u)
        return c
    L['getup'] = (36, False, getup)

    def dizzy(t, T):
        c = base(t, T)
        c.update(head_yaw=16 * S(t, T, 2), head_pitch=-6 + 10 * C(t, T, 2), head_roll=12 * S(t, T, 2, 0.25),
                 hip_roll=7 * S(t, T, 1), hip_x=0.03 * hh * S(t, T, 1), spine_yaw=6 * S(t, T, 1, 0.25),
                 ear_splay_l=28, ear_splay_r=28, ear_back_l=15, ear_back_r=15, tail_pitch=tc * 0.3,
                 tail_wave=12, tail_freq=1 / T, jaw=4)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_spread'] = 9 + 4 * S(t, T, 1, 0.5 if leg.endswith('r') else 0)
            c[leg + '_bend'] = 8 + 8 * max(0.0, S(t, T, 1, 0.25 if leg[0] == 'f' else 0.75))
        return c
    L['dizzy'] = (60, True, dizzy)

    def sit(c, t, T, k=1.0):
        c.update(hip_pitch=sp['sit_pitch'] * k, hip_z=-sp['sit_drop'] * k, hip_y=sp.get('sit_back', 0.0) * k,
                 neck_pitch=-sp['sit_pitch'] * 0.55 * k, head_pitch=-sp['sit_pitch'] * 0.25 * k)
        c['hl_swing'] = c.get('hl_swing', 0.0) + sp['sit_thigh'] * k
        c['hr_swing'] = c.get('hr_swing', 0.0) + sp['sit_thigh'] * k
        c['hl_bend'] = c.get('hl_bend', 0.0) + sp['sit_knee'] * k
        c['hr_bend'] = c.get('hr_bend', 0.0) + sp['sit_knee'] * k
        c['fl_swing'] = c.get('fl_swing', 0.0) - sp['sit_pitch'] * k
        c['fr_swing'] = c.get('fr_swing', 0.0) - sp['sit_pitch'] * k
        return c

    def trapped(t, T):
        c = base(t, T)
        sit(c, t, T)
        c.update(ear_back_l=60, ear_back_r=60, ear_splay_l=35, ear_splay_r=35, tail_pitch=-25,
                 tail_curl=sp['wrap'], tail_tip=14 * S(t, T, 3), head_yaw=5 * S(t, T, 1), spine_pitch=-4)
        c['fl_bend'] = 6
        c['fr_bend'] = 6
        return c
    L['trapped'] = (60, True, trapped)

    def celebrate(t, T):
        c = base(t, T)
        hop = max(0.0, math.sin(TAU * t / (T / 2))) if t < T * 0.9 else 0.0
        c.update(hip_z=0.25 * hh * hop, hip_pitch=22 * hop, head_pitch=14 * hop + 6, tail_pitch=tc + 25,
                 tail_wave=20, tail_freq=4 / T, ear_back_l=-12, ear_back_r=-12, spine_pitch=8 * hop)
        c['fl_swing'] = 35 * hop
        c['fr_swing'] = 35 * hop
        c['fl_bend'] = 40 * hop
        c['fr_bend'] = 40 * hop
        c['hl_swing'] = -15 * hop
        c['hr_swing'] = -15 * hop
        return c
    L['celebrate'] = (45, False, celebrate)

    def sleep(t, T):   # curled donut on the side: the curl is ventral (pitch), which lies in the floor plane
        c = base(t, T)
        k = sp['curl']
        c.update(hip_roll=sp['sleep_roll'], hip_z=-lie, spine_pitch=-k * 3 + 1.5 * S(t, T, 1), neck_pitch=-k * 1.4,
                 head_pitch=-k, head_roll=-8, tail_pitch=-15, tail_bend=-sp['wrap'], tail_tip=3 * S(t, T, 1),
                 ear_back_l=25, ear_back_r=25)
        for leg in ('fl', 'fr', 'hl', 'hr'):
            c[leg + '_bend'] = 70
            c[leg + '_swing'] = 30 if leg[0] == 'f' else -20
        return c
    L['sleep'] = (90, True, sleep)

    def sniff(t, T):
        c = base(t, T)
        c.update(neck_pitch=-28, head_pitch=-12 + 3 * S(t, T, 12), jaw=2 * max(0.0, S(t, T, 12)),
                 head_yaw=10 * S(t, T, 1), spine_pitch=-4, tail_pitch=tc * 0.6, tail_wave=6, tail_freq=1 / T,
                 ear_back_l=-12, ear_back_r=-12, hip_z=-0.03 * hh)
        c['fl_bend'] = 12
        c['fr_bend'] = 12
        return c
    L['sniff'] = (60, True, sniff)

    def emote_happy(t, T):
        c = base(t, T)
        b = max(0.0, math.sin(TAU * t / (T / 2)))
        c.update(hip_z=0.08 * hh * b, head_roll=15 * math.sin(TAU * t / T), head_pitch=8, tail_pitch=tc + 15,
                 tail_wave=25, tail_freq=4 / T, ear_back_l=-10, ear_back_r=-10, spine_pitch=3 * b)
        return c
    L['emote_happy'] = (36, False, emote_happy)

    def emote_angry(t, T):
        c = base(t, T)
        stomp = win(t, 0.25, 0.45, 0.06) + win(t, 0.65, 0.85, 0.06)
        c.update(neck_pitch=-14, head_pitch=6, ear_back_l=70, ear_back_r=70, ear_splay_l=20, ear_splay_r=20,
                 tail_pitch=tc * 0.5, tail_wave=30, tail_freq=4 / T, hip_z=-0.04 * hh * stomp, jaw=6 * stomp,
                 spine_pitch=-5)
        c['fl_swing'] = 20 * stomp
        c['fl_bend'] = 30 * stomp
        return c
    L['emote_angry'] = (36, False, emote_angry)

    def emote_confused(t, T):
        c = base(t, T)
        tilt = math.sin(TAU * t / T)
        c.update(head_roll=20 * tilt, head_yaw=-8 * tilt, ear_back_l=30 * ramp(t, 0, 0.3), ear_back_r=-10,
                 ear_splay_l=15, tail_pitch=tc + 10, tail_bend=8, tail_tip=25 * ramp(t, 0.1, 0.5))
        return c
    L['emote_confused'] = (45, False, emote_confused)
    L['_sit'] = sit
    return L


def fish_library(sp):
    L = {}

    def base(f=1.0):
        return {'wave_freq': f, 'wave_k': 0.75, 'pect_freq': 2.0, 'pect_amp': 22, 'dorsal_amp': 6,
                'tail_spread': 14, 'pelvic': 10, 'pect_ph': 0.5}

    def cyc(T, k):
        return k / T

    def idle(t, T):
        c = base(cyc(T, 2))
        c.update(wave_amp=6, pect_freq=cyc(T, 4), pect_amp=28, body_z=0.0015 * S(t, T, 1), body_pitch=3 * S(t, T, 1),
                 gill=8 * max(0.0, S(t, T, 2)), jaw=6 * max(0.0, S(t, T, 2, 0.1)))
        return c
    L['idle'] = (60, True, idle)

    def idle_alt(t, T):   # glass kiss
        c = base(cyc(T, 2))
        k = win(t, 0.6, 1.6, 0.25)
        c.update(wave_amp=5, pect_freq=cyc(T, 6), body_y=-0.006 * k, body_pitch=-4 * k, jaw=14 * k * max(0.0, S(t, T, 4)),
                 eye_yaw=10 * S(t, T, 1))
        return c
    L['idle_alt'] = (66, True, idle_alt)

    def swim(t, T, amp=16, curl=0.0, head=0.0, fold=0.0):
        c = base(cyc(T, 1))
        c.update(wave_amp=amp, pect_freq=cyc(T, 1), pect_amp=12, pect_fold=fold, curl=curl, head_yaw=head,
                 body_roll=2 * S(t, T, 1))
        return c
    L['walk'] = (36, True, lambda t, T: swim(t, T, 16))
    L['swim'] = (18, True, lambda t, T: swim(t, T, 20))
    L['run'] = (18, True, lambda t, T: swim(t, T, 26, fold=25))
    L['chase'] = (24, True, lambda t, T: swim(t, T, 22, head=8 * S(t, T, 1)))
    L['flee'] = (18, True, lambda t, T: swim(t, T, 30, curl=6, fold=35))

    def startled(t, T):
        c = base(cyc(T, 3))
        c.update(wave_amp=30 * win(t, 0.0, 0.5, 0.1), body_yaw=360 * ramp(t, 0.05, 0.55), body_z=0.004 * win(t, 0.0, 0.3),
                 tail_spread=25, dorsal_raise=25 * win(t, 0.0, 0.6), pect_fold=30, jaw=12 * win(t, 0.0, 0.2, 0.04))
        return c
    L['startled'] = (24, False, startled)

    def tumble(t, T):
        c = base(cyc(T, 2))
        c.update(wave_amp=35, curl=15 * S(t, T, 1), body_roll=40 * S(t, T, 1), body_pitch=30 * S(t, T, 1, 0.25),
                 pect_amp=45, pect_freq=cyc(T, 4), jaw=12, tail_spread=25)
        return c
    L['tumble'] = (24, True, tumble)

    def getup(t, T):      # on the floor: flips belly-down
        c = base(cyc(T, 2))
        u = ramp(t, 0.2, 0.7)
        c.update(body_roll=90 * (1 - u), body_z=sp['side_drop'] * (1 - u) + 0.006 * win(t, 0.3, 0.6),
                 arch=12 * win(t, 0.15, 0.6), wave_amp=14, pect_amp=30)
        return c
    L['getup'] = (30, False, getup)

    def dizzy(t, T):
        c = base(cyc(T, 2))
        c.update(wave_amp=10, body_roll=25 * S(t, T, 1), body_yaw=20 * S(t, T, 1, 0.25), body_pitch=10 * C(t, T, 1),
                 eye_yaw=15 * S(t, T, 2), jaw=8, curl=8 * S(t, T, 1))
        return c
    L['dizzy'] = (60, True, dizzy)

    def trapped(t, T):
        c = base(0.0)
        c.update(wave_amp=0, pect_amp=2, pect_freq=cyc(T, 2), tail_spread=6, eye_yaw=18 * S(t, T, 3),
                 eye_pitch=6 * S(t, T, 2, 0.3))
        return c
    L['trapped'] = (60, True, trapped)

    def celebrate(t, T):  # loop-de-loop
        c = base(cyc(T, 3))
        c.update(wave_amp=22, body_pitch=360 * ramp(t, 0.1, 1.0), body_z=0.012 * math.sin(math.pi * ramp(t, 0.1, 1.0)),
                 dorsal_raise=15, tail_spread=22)
        return c
    L['celebrate'] = (36, False, celebrate)

    def sleep(t, T):
        c = base(cyc(T, 1))
        c.update(wave_amp=3, pect_amp=8, pect_freq=cyc(T, 1), body_z=-0.004, body_pitch=-3, tail_spread=4,
                 dorsal_raise=-15, gill=4 * max(0.0, S(t, T, 1)))
        return c
    L['sleep'] = (90, True, sleep)

    def sniff(t, T):
        c = base(cyc(T, 2))
        d = max(0.0, S(t, T, 2))
        c.update(wave_amp=8, body_pitch=-30 * d, body_y=-0.004 * d, jaw=10 * d * max(0.0, S(t, T, 8)))
        return c
    L['sniff'] = (60, True, sniff)

    def emote_happy(t, T):
        c = base(cyc(T, 3))
        c.update(wave_amp=18, body_roll=20 * S(t, T, 2), body_z=0.004 * max(0.0, S(t, T, 2)), tail_spread=24,
                 dorsal_raise=10)
        return c
    L['emote_happy'] = (36, False, emote_happy)

    def emote_angry(t, T):
        c = base(cyc(T, 4))
        c.update(wave_amp=26, head_pitch=-6, gill=20, dorsal_raise=30, tail_spread=26, body_pitch=-6, jaw=10)
        return c
    L['emote_angry'] = (36, False, emote_angry)

    def emote_confused(t, T):
        c = base(cyc(T, 2))
        c.update(wave_amp=8, body_roll=18 * S(t, T, 1), head_yaw=12 * S(t, T, 1), eye_yaw=-12 * S(t, T, 1),
                 eye_pitch=8)
        return c
    L['emote_confused'] = (45, False, emote_confused)

    def flop(t, T):
        c = base(cyc(T, 1))
        b = abs(math.sin(math.pi * t / T))
        c.update(body_roll=90, body_z=sp['side_drop'] + 0.03 * b, arch=22 * S(t, T, 1), curl=10 * S(t, T, 1, 0.25),
                 wave_amp=30, pect_amp=40, pect_freq=cyc(T, 2), jaw=14 * max(0.0, S(t, T, 2)), tail_spread=24)
        return c
    L['flop'] = (15, True, flop)

    def bubble_rescue(t, T):
        c = base(cyc(T, 2))
        u = win(t, 0.1, 0.9, 0.2)
        c.update(curl=26 * u, arch=8 * u, pect_fold=40 * u, tail_fold=30 * u, wave_amp=6,
                 body_z=0.03 * ramp(t, 0.8, T), body_pitch=20 * ramp(t, 0.8, T))
        return c
    L['bubble_rescue'] = (36, False, bubble_rescue)
    return L
