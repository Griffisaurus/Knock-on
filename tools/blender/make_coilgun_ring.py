"""Procedurally build the COILGUN RING source file (docs/art/briefs/future.md, "COILGUN RING: Steel accelerator ring
with visible coils"). A toy-like ring accelerator: a hoop, never a tube or a barrel.

Usage: blender -b --factory-startup -P tools/blender/make_coilgun_ring.py -- [out.blend]
Default output: assets/src/future/coilgun_ring.blend

An upright ring (outer Ø 0.285 centred at z 0.1575, bore Ø 0.16, depth 0.08 along Y): 8 mm kn_powder_graphite front
and back flanges, a kn_poly_plasma clear shell wall between them, and a kn_anod_plasma bore liner. Inside the shell,
six copper coil packs at 60° steps (three kn_copper winding bands round a kn_steel_brushed core each; LOD2: one copper
block, LOD3: the shell goes solid and opaque-ready). 12 kn_led chase segments on the front flange's inner edge
(group 0 bore_chase). A 0.16 x 0.10 x 0.05 graphite plinth cradles the ring bottom on four FOOT_M bumpers: front PR-M
power port (0.050, -0.050, 0.025) and the SCREEN__charge bar (8 cells, power colour) at (-0.045, -0.0505, 0.025);
name plate on the back, magnetic-field pictogram on the right flank; direction chevrons on both flange tops.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

from mathutils import Matrix, Vector  # noqa: E402

import _m2  # noqa: E402
import _m4  # noqa: E402
import _m5  # noqa: E402
from kn_tools import kit  # noqa: E402
from kn_tools.kit import Kit, seg  # noqa: E402

TYPE = 'coilgun_ring'
G, PLASMA, PPOLY, COPPER, STEEL, RUBBER, LED, SCREEN = (
    'kn_powder_graphite', 'kn_anod_plasma', 'kn_poly_plasma', 'kn_copper', 'kn_steel_brushed', 'kn_rubber', 'kn_led',
    'kn_screen')
MASTERS = [G, PLASMA, PPOLY, COPPER, STEEL, RUBBER, LED, SCREEN, 'kn_decal', 'kn_poly_beam']
C = Vector((0.0, 0.0, 0.1575))
R_BORE, R_OUT, HALF_D, FL = 0.080, 0.1425, 0.040, 0.008
M_RING = kit.at(*C) @ kit.FRONT_OUT    # local z = h = -y, local (x, y) -> (x, z)
PL_W, PL_D, PL_Z0, PL_Z1 = 0.16, 0.10, 0.004, 0.054
PORT = (0.050, -0.050, 0.025)
SCR_C, SCR_W, SCR_H = Vector((-0.045, -0.0505, 0.025)), 0.060, 0.010
PACKS = [30.0 + 60.0 * k for k in range(6)]


def pack_frame(deg):
    """Ring-local frame of a coil pack: local x = tangent, y = the ring axis (h), z = radial (outward)."""
    a = math.radians(deg)
    t = Vector((-math.sin(a), math.cos(a), 0.0))
    h = Vector((0.0, 0.0, 1.0))
    r = Vector((math.cos(a), math.sin(a), 0.0))
    m = Matrix(((t.x, h.x, r.x, 0), (t.y, h.y, r.y, 0), (t.z, h.z, r.z, 0), (0, 0, 0, 1)))
    return M_RING @ m


RIM_O, RIM_I = 0.127, 0.096     # flange outer rim from RIM_O out, inner rim up to RIM_I; clear windows between


def flange(h0, h1, front, lod, r0, r1, round_outer):
    """Graphite annulus r0..r1 between h0 < h1; the outer edge rounded on its open face when round_outer."""
    b = 0.003 if (lod < 3 and round_outer) else 0.0
    bs = (3, 2, 1, 1)[lod]
    if front:
        prof = [(r0, h0, G), (r1, h0, G)]
        if b:
            for i in range(bs + 1):
                a = math.pi / 2 * i / bs
                prof.append((r1 - b + b * math.cos(a), h1 - b + b * math.sin(a), G))
        else:
            prof.append((r1, h1, G))
        prof.append((r0, h1, G))
    else:
        prof = []
        if b:
            for i in range(bs + 1):
                a = math.pi / 2 * i / bs
                prof.append((r1 - b + b * math.sin(a), h0 + b - b * math.cos(a), G))
        else:
            prof.append((r1, h0, G))
        prof += [(r1, h1, G), (r0, h1, G), (r0, h0, G)]
    return kit.dedupe(prof)


def flanges(k, n, lod):
    """Front and back flanges: an outer rim and an inner rim joined by six spokes (between the coil packs), with
    kn_poly_plasma windows behind them so the coils show from the front too."""
    for front, h0, h1 in ((True, HALF_D - FL, HALF_D), (False, -HALF_D, -HALF_D + FL)):
        if lod >= 3:  # LOD3: solid flanges, no windows
            k.lathe(flange(h0, h1, front, lod, R_BORE + 0.0015, R_OUT, False), n, M_RING, closed=True)
            continue
        k.lathe(flange(h0, h1, front, lod, RIM_O, R_OUT, True), n, M_RING, closed=True)
        k.lathe(flange(h0, h1, front, lod, R_BORE + 0.0015, RIM_I, False), n, M_RING, closed=True)
        for i in range(6):
            m = pack_frame(60.0 * i)
            k.rbox((0.012, FL, RIM_O - RIM_I + 0.004), (0, (h0 + h1) / 2, (RIM_O + RIM_I) / 2),
                   0.003 if lod < 2 else 0.0, G, cseg=1, m=m, rz=0.0)


def build(lod, q, mats):
    n = seg(96, q, 16, 4)
    ring = Kit()
    flanges(ring, n, lod)
    # bore liner (plasma), slightly inside the flanges' inner edge
    ring.lathe([(R_BORE, -HALF_D + 0.0005, PLASMA), (R_BORE + 0.004, -HALF_D + 0.0005, PLASMA),
                (R_BORE + 0.004, HALF_D - 0.0005, PLASMA), (R_BORE, HALF_D - 0.0005, PLASMA)], n, M_RING, closed=True)
    # LED chase on the front flange's inner edge
    if lod < 3:
        for i in range(12):
            a0 = math.radians(30 * i + 3)
            a1 = math.radians(30 * (i + 1) - 3)
            ring.lathe_arc([(0.0845, HALF_D - 0.0006, LED), (0.0905, HALF_D - 0.0006, LED),
                            (0.0905, HALF_D + 0.0011, LED), (0.0845, HALF_D + 0.0011, LED)], a0, a1,
                           (4, 3, 2)[lod], m=M_RING)
    else:
        ring.lathe([(0.0845, HALF_D - 0.0006, LED), (0.0905, HALF_D - 0.0006, LED), (0.0905, HALF_D + 0.0011, LED),
                    (0.0845, HALF_D + 0.0011, LED)], 12, M_RING, closed=True)
    ring.colors['led'] = _m2.led_attr(lambda c, nn: (0, 0.08))
    # coil packs (inside the shell)
    coils = Kit()
    if lod < 3:
        for deg in PACKS:
            m = pack_frame(deg)
            coils.rbox((0.016, 0.040, 0.050), (0, 0, 0.1105), 0.003 if lod < 2 else 0.0, STEEL, cseg=1, m=m,
                       rz=0.002 if lod < 2 else 0.0)
            if lod < 2:
                for r0, r1 in ((0.0935, 0.1040), (0.1060, 0.1165), (0.1185, 0.1290)):
                    coils.prism(kit.outline_rrect(0.036, 0.058, 0.010, (3, 2)[lod]), r0, r1, COPPER,
                                bt=0.0018, bb=0.0018, bseg=(2, 1)[lod], m=m)
            else:
                coils.prism(kit.outline_rrect(0.036, 0.058, 0.008, 1), 0.0935, 0.1290, COPPER, m=m)
    # the clear shell wall between the flanges (LOD3: the whole ring body becomes one solid poly annulus)
    shell = Kit()
    if lod < 3:
        shell.lathe([(R_OUT - 0.0032, -HALF_D + FL - 0.001, PPOLY), (R_OUT - 0.0002, -HALF_D + FL - 0.001, PPOLY),
                     (R_OUT - 0.0002, HALF_D - FL + 0.001, PPOLY), (R_OUT - 0.0032, HALF_D - FL + 0.001, PPOLY)],
                    n, M_RING, closed=True)
        for hs in (1, -1):  # front / back windows between the rims, just inside the flanges
            hw0, hw1 = sorted((hs * (HALF_D - FL - 0.0004), hs * (HALF_D - FL + 0.0016)))
            shell.lathe([(RIM_I - 0.002, hw0, PPOLY), (RIM_O + 0.002, hw0, PPOLY), (RIM_O + 0.002, hw1, PPOLY),
                         (RIM_I - 0.002, hw1, PPOLY)], n, M_RING, closed=True)
    else:
        shell.lathe([(R_BORE + 0.004, -HALF_D + FL - 0.001, PPOLY), (R_OUT - 0.0002, -HALF_D + FL - 0.001, PPOLY),
                     (R_OUT - 0.0002, HALF_D - FL + 0.001, PPOLY), (R_BORE + 0.004, HALF_D - FL + 0.001, PPOLY)],
                    n, M_RING, closed=True)
    # plinth with feet and the charge screen
    body = Kit()
    cs = (3, 2, 1, 1)[lod]
    body.rbox((PL_W, PL_D, PL_Z1 - PL_Z0), (0, 0, (PL_Z0 + PL_Z1) / 2), 0.006 if lod < 3 else 0.0, G, cseg=cs,
              rz=0.004 if lod < 3 else 0.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            _m2.foot(body, 'M', sx * 0.062, sy * 0.034, min(1.0, q), lod)
    if lod < 3:  # a 1 mm graphite frame round the screen
        body.rbox((SCR_W + 0.003, 0.0012, SCR_H + 0.003), (SCR_C.x, -PL_D / 2 - 0.0004, SCR_C.z), 0.0015, G, cseg=1,
                  rz=0.0)
    pieces = {'ring': ring, 'coils': coils, 'shell': shell, 'body': body,
              'screen_charge': kit.screen_quad(tuple(SCR_C + Vector((0, -0.0006, 0))), (0, -1, 0), (0, 0, 1), SCR_W,
                                               SCR_H, lift=0.0)}
    top = C.z + R_OUT
    return kit.add_decals(pieces, lod, [
        kit.decal_plane('name.coilgun_ring.bone', (0, PL_D / 2, 0.029), (0, 1, 0), (0, 0, 1), 0.10),
        kit.decal_plane('picto.magnetic_field.mono', (PL_W / 2, 0, 0.029), (1, 0, 0), (0, 0, 1), 0.034, 0.034),
        kit.decal_plane('trim.marks_m5', (0, -HALF_D + FL / 2, top), (0, 0, 1), (0, -1, 0), 0.0075, 0.0072,
                        sub=_m5.marks5('chevrons'), lift=0.0004),
        kit.decal_plane('trim.marks_m5', (0, HALF_D - FL / 2, top), (0, 0, 1), (0, -1, 0), 0.0075, 0.0072,
                        sub=_m5.marks5('chevrons'), lift=0.0004),
    ])


def main(out_path=None):
    part = kit.Part(
        TYPE, 'future', 'M', '3,3,1', 4.0, 'bottom', 9500,
        'Steel accelerator ring (a toy hoop, no barrel cues): outer Ø 0.285 at z 0.1575, bore Ø 0.16, depth 0.08 (Y); '
        '8 mm kn_powder_graphite flanges, kn_poly_plasma clear shell wall, kn_anod_plasma bore liner; six coil packs '
        '(kn_copper winding bands on kn_steel_brushed cores) at 60° steps inside the shell (LOD2 copper blocks, LOD3 '
        'solid shell). 12 kn_led chase segments on the front flange inner edge (group 0). Plinth 0.16 x 0.10 x 0.05 on '
        'FOOT_M: PR-M power in, SCREEN__charge (bar x 8, power; 0.060 wide to stay on the plinth face), name plate '
        '(back), magnetic-field pictogram (right), chevrons on the flange tops. Boost axis Y (default toward -Y). '
        'Brief: docs/art/briefs/future.md#coilgun-ring.',
        MASTERS, led_groups='0:bore_chase', skins='plasma,beam',
        hints={'kn_boost_dv': 3.0, 'kn_recharge': 0.5})
    part.build_lods(lambda lod, q: build(lod, q, part.mats), lod0_q=1.6)
    _m5.ring_cols(part, 8, (C.x, 0.0, C.z), 0.111, 0.11, 0.08, 0.06, start_deg=22.5, phys='powder',
                  restitution=0.3, friction=0.4)
    part.col_box('8', (PL_W, PL_D, 0.05), (0, 0, PL_Z0 + 0.025), phys='powder')
    part.sensor('trigger', 'bore', _m4.cyl_points(0.075, -0.05, 0.05, 24, cx=C.x, cy=C.z, axis='y'),
                magnetic_only=True)
    part.port('power', 'in', PORT, (0, -1, 0), 'M', 'in')
    part.emit('boost', 'exit', (0, -0.050, C.z), (0, -1, 0))
    for i, deg in enumerate(PACKS, 1):
        p = _m5.polar((C.x, 0.0, C.z), 0.130, deg)
        part.emit('arc', 'coil_%d' % i, tuple(p), tuple((p - C).normalized()))
    part.screen('charge', SCR_W, SCR_H, tuple(SCR_C + Vector((0, -0.0006, 0))), (0, -1, 0), (0, 0, 1), kind='bar',
                cells=8, color='power')
    _m2.uv1(part)
    return part.save(out_path)


if __name__ == '__main__':
    args = _cli.script_args()
    main(os.path.abspath(args[0]) if args else None)
