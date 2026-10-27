"""Procedurally build the LIFT source file (docs/art/briefs/frame.md, "LIFT: Elevator platform").

Usage: blender -b --factory-startup -P tools/blender/make_lift.py -- [out.blend]
Default output: assets/src/frame/lift.blend

Built at the default travel of 1.0 m (overall 0.30 x 1.12 x 0.45; origin = bottom centre of the deck at its lowest
stop, kn_bounds = 'moving'). The Bone deck (0.30 x 0.30, lips 0.01 left / right / back, kn_rubber_grip mat, Cobalt
front fascia) and its kn_anod_cobalt carriage ride PIVOT__carriage (axis z, slide 0 ... 1.0 m) on a twin Cobalt
rail mast (x ±0.07, y 0.18 ... 0.20): mast foot 0.08 + travel, capped by the open-sided Bone top cap (0.16 x 0.04 x
0.04) with the idler pulley (PIVOT__pulley_idle) and the ▲ / ▼ kn_led chevrons (groups 1 / 2) on its front. The
exposed kn_rubber toothed belt loops from the drive pulley (PIVOT__pulley_drive, in the mast foot) to the idler; the
carriage clamps its front run. Behind: the Bone housing 0.30 x 0.15 x 0.10 on 5 mm feet with 4 M5, the status
LED_D8 (group 0) and the PR-M rings (power in, signal call on the front; signal arrive on the top).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import _m2  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'lift'
TRAVEL = 1.0
DECK, DECK_H, LIP = 0.30, 0.04, 0.01
RAIL_X, RAIL_Y, RAIL_S = 0.07, 0.19, 0.02
MAST_TOP = 0.08 + TRAVEL                       # 1.08
CAP_Z1 = MAST_TOP + 0.0385                     # 1.1185 (footprint h 11 ± 0.02)
H_Y0, H_Y1, H_Z0, H_Z1 = 0.20, 0.30, 0.005, 0.155
DRIVE = (0.0, RAIL_Y, 0.045)
IDLE = (0.0, RAIL_Y, MAST_TOP + 0.017)
PUL_R = 0.016
BELT_W, BELT_T = 0.012, 0.0025
STATUS = (-0.11, 0.25, H_Z1)
BONE, COBALT, RUBBER, GRIP, STEEL, LED = (
    'kn_powder_bone', 'kn_anod_cobalt', 'kn_rubber', 'kn_rubber_grip', 'kn_steel_brushed', 'kn_led')
MASTERS = [BONE, COBALT, RUBBER, GRIP, STEEL, LED, 'kn_decal']


def led_group(c, _n):
    if c.z < 0.5:
        return 0, 0.08
    return (1, 0.05) if c.z > CAP_Z1 - 0.02 else (2, 0.05)


def chevron(k, cx, cz, up, lod):
    s = 1 if up else -1
    pts = [(-0.012, -0.004 * s), (0.0, 0.006 * s), (0.012, -0.004 * s), (0.012, -0.0005 * s - 0.0035 * s + 0.0035 * s),
           (0.0, 0.0095 * s), (-0.012, -0.0005 * s)]
    # a thick V: outer edge then inner edge (CCW for up; reversed for down)
    pts = [(-0.012, -0.004 * s), (0.0, 0.004 * s), (0.012, -0.004 * s), (0.012, 0.0005 * s), (0.0, 0.0085 * s),
           (-0.012, 0.0005 * s)]
    if not up:
        pts = list(reversed(pts))
    if lod >= 3:
        k.hull([(cx + x, 0.1595, cz + z) for x, z in pts] + [(cx + x, 0.1575, cz + z) for x, z in pts], LED)
        return
    k.prism(pts, -0.0015, 0.0015, LED, m=kit.at(cx, 0.1595, cz) @ kit.FRONT_OUT)


def build(lod, q, mats):
    cs = (3, 2, 1, 0)[lod]
    rb = 0.004 if lod < 3 else 0.0
    # ---- deck + carriage (PIVOT__carriage)
    deck = Kit(pivot='PIVOT__carriage')
    deck.rbox((DECK, DECK, DECK_H), (0, 0, DECK_H / 2), rb, BONE, cseg=cs, rz=0.003 if lod < 3 else 0.0)
    for x, y, sx, sy in ((-(DECK - LIP) / 2, 0.0, LIP, DECK), ((DECK - LIP) / 2, 0.0, LIP, DECK),
                         (0.0, (DECK - LIP) / 2, DECK, LIP)):
        deck.rbox((sx, sy, 0.012), (x, y, DECK_H + 0.006 - 0.001), 0.003 if lod < 3 else 0.0, BONE,
                  cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.002 if lod < 3 else 0.0)
    if lod < 3:
        deck.rbox((DECK - 2 * LIP - 0.01, DECK - LIP - 0.015, 0.004), (0, -0.0025, DECK_H + 0.0015), 0.006, GRIP,
                  cseg=max(1, cs - 1), rz=0.001)
    deck.rbox((DECK - 0.01, 0.005, DECK_H - 0.012), (0, -DECK / 2 - 0.0015, DECK_H / 2), 0.002 if lod < 3 else 0.0,
              COBALT, cseg=max(1, cs - 1) if lod < 3 else 0, rz=0.002 if lod < 3 else 0.0)
    car = Kit(pivot='PIVOT__carriage')
    car.rbox((0.20, 0.032, 0.11), (0, 0.164, 0.055), rb, COBALT, cseg=cs, rz=0.003 if lod < 3 else 0.0)
    if lod < 2:  # guide shoes round each rail and the belt clamp
        for sx in (-1, 1):
            car.rbox((0.034, 0.03, 0.09), (sx * RAIL_X, RAIL_Y, 0.055), 0.004, COBALT, cseg=max(1, cs - 1), rz=0.002)
        car.rbox((0.024, 0.012, 0.03), (0, RAIL_Y - PUL_R - 0.002, 0.07), 0.002, STEEL, cseg=1, rz=0.001)
        for x in (-0.07, 0.07):
            for z in (0.03, 0.08):
                _m2.screw(car, 'M5', (x, 0.148, z), (0, -1, 0), q, lod)
    # ---- mast (static): twin rails, foot, top cap, belt
    mast = Kit()
    for sx in (-1, 1):
        mast.rbox((RAIL_S, RAIL_S, MAST_TOP), (sx * RAIL_X, RAIL_Y, MAST_TOP / 2), 0.003 if lod < 3 else 0.0, COBALT,
                  cseg=(2, 1, 1, 0)[lod], rz=0.0)
    mast.rbox((0.16, 0.02, 0.012), (0, RAIL_Y, 0.006), 0.003 if lod < 3 else 0.0, COBALT, cseg=max(1, cs - 1) if lod < 3
              else 0, rz=0.002 if lod < 3 else 0.0)
    cap = Kit()
    cz = MAST_TOP + 0.0185
    if lod < 3:  # open-sided cap: two cheeks + a roof
        for sx in (-1, 1):
            cap.rbox((0.012, 0.04, 0.04), (sx * 0.074, RAIL_Y - 0.01, cz), 0.004, BONE, cseg=max(1, cs - 1), rz=0.003)
        cap.rbox((0.16, 0.04, 0.010), (0, RAIL_Y - 0.01, CAP_Z1 - 0.005), 0.004, BONE, cseg=max(1, cs - 1), rz=0.003)
        cap.rbox((0.136, 0.006, 0.026), (0, RAIL_Y - 0.027, cz - 0.004), 0.002, BONE, cseg=1, rz=0.001)
    else:
        cap.rbox((0.16, 0.04, 0.04), (0, RAIL_Y - 0.01, cz), 0.0, BONE, cseg=0, rz=0.0)
    chevron(cap, -0.035, cz - 0.004, True, lod)
    chevron(cap, 0.035, cz - 0.004, False, lod)
    cap.colors['led'] = _m2.led_attr(led_group)
    belt = Kit()
    zb0, zb1 = DRIVE[2], IDLE[2]
    for y in (RAIL_Y - PUL_R - BELT_T / 2, RAIL_Y + PUL_R + BELT_T / 2):
        belt.rbox((BELT_W, BELT_T, zb1 - zb0), (0, y, (zb0 + zb1) / 2), 0.0, RUBBER, cseg=0, rz=0.0)
    for c, top in ((DRIVE, False), (IDLE, True)):  # belt wraps (half rings) round each pulley
        if lod < 3:
            prof = [(PUL_R, -BELT_W / 2, RUBBER), (PUL_R + BELT_T, -BELT_W / 2, RUBBER),
                    (PUL_R + BELT_T, BELT_W / 2, RUBBER), (PUL_R, BELT_W / 2, RUBBER)]
            a0, a1 = (math.pi / 2, 3 * math.pi / 2) if top else (-math.pi / 2, math.pi / 2)
            belt.lathe_arc(prof, a0, a1, seg(12, q, 4), m=kit.at(*c) @ kit.X_AXIS @ kit.rot_z(0))
    # ---- pulleys
    pd = Kit(pivot='PIVOT__pulley_drive')
    pi_ = Kit(pivot='PIVOT__pulley_idle')
    for k, c in ((pd, DRIVE), (pi_, IDLE)):
        k.cyl(PUL_R, -0.008, 0.008, STEEL, seg(24, q, 6), bev=0.0012 if lod < 3 else 0.0, bseg=1,
              m=kit.at(*c) @ kit.X_AXIS)
        if lod < 3:
            k.cyl(PUL_R + 0.0035, -0.0095, -0.0075, STEEL, seg(24, q, 6), m=kit.at(*c) @ kit.X_AXIS)
            k.cyl(PUL_R + 0.0035, 0.0075, 0.0095, STEEL, seg(24, q, 6), m=kit.at(*c) @ kit.X_AXIS)
            k.cyl(0.004, -0.06, 0.06, STEEL, seg(10, q, 6), m=kit.at(*c) @ kit.X_AXIS)
    # ---- housing
    house = Kit()
    house.rbox((0.30, H_Y1 - H_Y0, H_Z1 - H_Z0), (0, (H_Y0 + H_Y1) / 2, (H_Z0 + H_Z1) / 2), 0.008 if lod < 3 else 0.0,
               BONE, cseg=cs, rz=0.006 if lod < 3 else 0.0)
    for x in (-0.13, 0.13):
        for y in (0.215, 0.285):
            _m2.foot(house, 'L', x, y, min(1.0, q), lod if lod < 2 else 3)
            _m2.screw(house, 'M5', (x, y, H_Z1), (0, 0, 1), q, lod)
    _m2.led_dome(house, 8, STATUS, (0, 0, 1), q, lod)
    house.colors['led'] = _m2.led_attr(led_group)
    pieces = {'deck': deck, 'carriage': car, 'mast': mast, 'cap': cap, 'belt': belt, 'pulley_drive': pd,
              'pulley_idle': pi_, 'housing': house}
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.lift.graphite', (0.15, 0.25, 0.08), (1, 0, 0), (0, 0, 1), 0.06),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'frame', 'M', '3,11,4.5', 5.3, 'bottom', 6000,
        'Elevator platform at the default travel 1.0 m (overall 0.30 x 1.12 x 0.45; footprint h 11 cells = 1.10 within '
        'the 0.02 tolerance, the brief\'s 11.2 is not a half cell). Origin = bottom centre of the deck at the lowest '
        'stop, judged on the moving pieces (kn_bounds = moving, new in the validator). Bone deck with lips, grip mat and '
        'Cobalt fascia + Cobalt carriage on PIVOT__carriage (z slide 0 ... 1.0); twin Cobalt rail mast, open Bone top '
        'cap with the idler (PIVOT__pulley_idle) and ▲ / ▼ kn_led chevrons (groups 1 / 2); exposed rubber belt from the '
        'drive pulley (PIVOT__pulley_drive) in the mast foot; Bone housing on 5 mm feet with 4 x M5, status LED_D8 '
        '(group 0) and 3 PR-M rings. The engine stacks lift__mast_10 / _50 modules for other travels (deferred: the '
        'modules ship inside this one mast). kn_mass_hint = deck+carriage 1.5 + housing 3.0 + mast 0.8. UV1 '
        'authored for the 2048² set (bake pending). Brief: docs/art/briefs/frame.md#lift.',
        MASTERS, led_groups='0:status,1:dir_up,2:dir_down', pipeline={'kn_bounds': 'moving'})
    part.pivot('carriage', (0, 0, 0), 'z', 0.0, TRAVEL, motion='slide')
    part.pivot('pulley_drive', DRIVE, 'x', motion='turn')
    part.pivot('pulley_idle', IDLE, 'x', motion='turn')
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.0)
    for nm, size, c in (('deck', (DECK, DECK, DECK_H), (0, 0, DECK_H / 2)),
                        ('lip_l', (LIP, DECK, 0.012), (-(DECK - LIP) / 2, 0, DECK_H + 0.005)),
                        ('lip_r', (LIP, DECK, 0.012), ((DECK - LIP) / 2, 0, DECK_H + 0.005)),
                        ('lip_b', (DECK, LIP, 0.012), (0, (DECK - LIP) / 2, DECK_H + 0.005)),
                        ('carriage', (0.20, 0.06, 0.11), (0, 0.175, 0.055))):
        _m2.under(part, part.col_box(nm, size, c, phys='rubber' if nm == 'deck' else 'powder', restitution=0.2,
                                     friction=0.9 if nm == 'deck' else 0.5), 'carriage')
    part.col_box('housing', (0.30, H_Y1 - H_Y0, H_Z1), (0, (H_Y0 + H_Y1) / 2, H_Z1 / 2), phys='powder',
                 restitution=0.2, friction=0.5)
    part.col_box('mast', (0.16, 0.02, MAST_TOP), (0, RAIL_Y, MAST_TOP / 2), phys='powder', restitution=0.2,
                 friction=0.4)
    part.port('power', 'in', (-0.11, 0.20, 0.08), (0, -1, 0), 'M', 'in')
    part.port('signal', 'call', (0.11, 0.20, 0.08), (0, -1, 0), 'M', 'in')
    part.port('signal', 'arrive', (0.11, 0.25, 0.155), (0, 0, 1), 'M', 'out', max_links=8)
    _m2.under(part, part.sensor('pressure', 'deck', [(x * 0.13, y * 0.13, z) for x in (-1, 1) for y in (-1, 1)
                                                    for z in (DECK_H, DECK_H + 0.02)], threshold=15.0), 'carriage')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
