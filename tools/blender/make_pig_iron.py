"""Procedurally build the PIG IRON source file (docs/art/briefs/rollers.md, "PIG IRON: Iron ball").

Usage: blender -b --factory-startup -P tools/blender/make_pig_iron.py -- [out.blend]
Default output: assets/src/rollers/pig_iron.blend

A compact cast-iron ball r 0.060 lathed about Z: kn_anod_graphite cast body, a flush 0.012 m kn_steel_brushed
belt on the equator (latitude rows, so the band edges are exact and nothing stands proud of the pure-sphere
collider) and a flattened Ø 0.022 m sprue boss at the top pole standing 1 mm proud, carrying a Bone "6.5" stamp
(`mark.mass_6_5.bone`). Free body: origin = sphere centre, no feet, fasteners or port rings. Root
kn_magnetic = true (Field channel: Maglock, Grav Well, Tractor Beam act on it).
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'pig_iron'
R = 0.060                 # collider radius = shell radius
BELT = 0.012              # flush equator belt width
BOSS_R = 0.011            # Ø 0.022 boss
BOSS_TOP = R + 0.001      # 1 mm proud of the pole
BOSS_BEV = 0.0006
IRON, STEEL = 'kn_anod_graphite', 'kn_steel_brushed'
MASTERS = [IRON, STEEL]


def ball_profile(lod, q):
    """(r, z, master of the strip above) from the bottom pole to the boss top, for Kit.lathe about Z."""
    hs = seg(11, q, 3)                         # strips per hemisphere, pole/boss -> belt edge
    a_belt = math.asin(BELT / 2 / R)
    boss_foot = BOSS_R + (0.0008 if lod < 2 else 0.0)
    a_boss = math.acos(boss_foot / R)          # latitude where the boss meets the shell
    prof = [(0.0, -R, IRON)]
    for k in range(1, hs + 1):                 # lower hemisphere up to the belt's lower edge
        lat = -math.pi / 2 + (math.pi / 2 - a_belt) * k / hs
        prof.append((R * math.cos(lat), R * math.sin(lat), STEEL if k == hs else IRON))
    if lod < 3:                                # one mid row keeps the belt round on the silhouette
        prof.append((R, 0.0, STEEL))
    prof.append((R * math.cos(a_belt), R * math.sin(a_belt), IRON))
    up = max(2, hs - 1)
    for k in range(1, up + 1):                 # upper hemisphere up to the boss foot
        lat = a_belt + (a_boss - a_belt) * k / up
        prof.append((R * math.cos(lat), R * math.sin(lat), IRON))
    if lod < 2:                                # boss: short wall, bevelled top rim, flat face
        prof += [(BOSS_R, R * math.sin(a_boss) + 0.0002, IRON),
                 (BOSS_R, BOSS_TOP - BOSS_BEV, IRON),
                 (BOSS_R - BOSS_BEV * 0.3, BOSS_TOP - BOSS_BEV * 0.3, IRON),
                 (BOSS_R - BOSS_BEV, BOSS_TOP, IRON)]
    else:
        prof.append((BOSS_R, BOSS_TOP, IRON))
    prof.append((0.0, BOSS_TOP, IRON))
    return kit.dedupe(prof)


def build(lod, q):
    ball = Kit()
    ball.lathe(ball_profile(lod, q), seg(48, q, 8))
    # Bone "6.5" stamped on the boss face, reading upright from the front.
    decals = [kit.decal_plane('mark.mass_6_5.bone', (0, 0, BOSS_TOP), (0, 0, 1), (0, 1, 0), 0.017)]
    return kit.add_decals({'ball': ball}, lod, decals)


def main(out_path=None):
    part = kit.Part(
        TYPE, 'rollers', 'S', '1.2,1.2,1.2', 6.5, 'com', 1800,
        'Cast-iron ball r 0.060, magnetic (kn_magnetic). Graphite anodised cast body, flush 12 mm brushed-steel '
        'equator belt, flattened Ø 22 mm sprue boss 1 mm proud at the top pole with a Bone "6.5" stamp. '
        'Brief: docs/art/briefs/rollers.md#pig-iron-iron-ball. Deferred: the 1024 cast-pitting Normal (shared trim '
        'layer) and belt anisotropy direction (needs tangents/UVs); masters only.',
        MASTERS, hints={'kn_magnetic': True})
    part.build_lods(build, lod0_q=1.3)
    part.col_sphere('0', R, phys='steel', restitution=0.10, friction=0.40)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
