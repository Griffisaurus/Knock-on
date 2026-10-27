"""Master material table (ASSET_PIPELINE §5.1, shared_kit.md §7.1) as plain data.

library.build_materials() turns these into assets/src/lib/materials.blend. Values are spec sRGB; the
builder caps linear albedo at 0.85 (peak channel scaled, hue kept) exactly like style_samples.hexcol().
"""
from .conventions import BRAND

BRAND_HEX = {'ignition': '#FF5B2E', 'volt': '#C6FF3A', 'cobalt': '#3355FF', 'plasma': '#FF3DAE',
             'bone': '#E8E2D6', 'graphite': '#3A3E47', 'amber': '#FFB020', 'beam': '#2FD6FF'}
ANOD_HEX = {'graphite': '#5A606B', 'beam': '#4FC3E8', 'volt': '#B5E043', 'cobalt': '#4A6BFF', 'plasma': '#F04FA8',
            'ignition': '#F0663E'}
POLY_HEX = {'clear': '#F4F7FA', 'beam': '#D2F4FF', 'amber': '#FFE6C0', 'plasma': '#FFD6EE'}

# Authoring-only preview bumps (noise scale, strength, distance); replaced by shared tiling maps at bake time.
ORANGE_PEEL = (1400, 0.035, 0.0004)
PAPER_TOOTH = (500, 0.08, 0.001)


def _m(base, rough, **kw):
    d = {'base': base, 'rough': rough}
    d.update(kw)
    return d


def master_table():
    t = {}
    for c in BRAND:
        t['kn_powder_' + c] = _m(BRAND_HEX[c], 0.42, coat=0.25, coat_rough=0.30, bump=ORANGE_PEEL)
        t['kn_powder_%s_gloss' % c] = _m(BRAND_HEX[c], 0.25, coat=1.0, coat_rough=0.03,
                                         bump=(1400, 0.015, 0.0004))
    for c, h in ANOD_HEX.items():
        t['kn_anod_' + c] = _m(h, 0.30, metal=1.0, aniso=0.2)
    t['kn_steel_brushed'] = _m('#C9CDD3', 0.24, metal=1.0, aniso=0.6)
    t['kn_chrome'] = _m('#E6E8EB', 0.05, metal=1.0)
    t['kn_brass'] = _m('#E3B261', 0.25, metal=1.0)
    t['kn_copper'] = _m('#D9824A', 0.28, metal=1.0)
    for c, h in POLY_HEX.items():
        t['kn_poly_' + c] = _m(h, 0.04, transmission=1.0, ior=1.58)
    t['kn_glass'] = _m('#FFFFFF', 0.0, transmission=1.0, ior=1.5)
    t['kn_rubber'] = _m('#1C1E22', 0.82, sheen=0.3)
    t['kn_rubber_grip'] = _m('#1C1E22', 0.82, sheen=0.3, bump=(3000, 0.3, 0.0006))
    t['kn_wood_oak'] = _m('#B8834E', 0.45, coat=0.35, coat_rough=0.15, wood=('#9A6338', '#D7A86E'))
    t['kn_wood_walnut'] = _m('#5E3F2A', 0.45, coat=0.35, coat_rough=0.15, wood=('#4A2E1F', '#7A5236'))
    t['kn_paper_red'] = _m('#D93A2B', 0.72, bump=PAPER_TOOTH)
    t['kn_paper_tan'] = _m('#D8C39A', 0.80, bump=PAPER_TOOTH)
    t['kn_cardboard'] = _m('#B88A5A', 0.78, bump=PAPER_TOOTH)
    for c in BRAND:
        t['kn_latex_' + c] = _m(BRAND_HEX[c], 0.30, coat=0.7, coat_rough=0.06, sss=0.12)
        t['kn_ceramic_' + c] = _m(BRAND_HEX[c], 0.15, coat=0.5, coat_rough=0.05)
        t['kn_fabric_' + c] = _m(BRAND_HEX[c], 0.90, sheen=0.6)
    t['kn_brick'] = _m('#B5553B', 0.85)
    t['kn_rope'] = _m('#EDE6D8', 0.85)
    t['kn_fuse_cord'] = _m('#4A3524', 0.90, bump=(800, 0.3, 0.001))
    t['kn_wax'] = _m('#F3E9D2', 0.45, sss=0.35, coat=0.2, coat_rough=0.2)
    t['kn_slime'] = _m('#7DFF7A', 0.10, transmission=0.6, sss=0.3)
    t['kn_led'] = _m('#000000', 0.30, emission='#FFFFFF', strength=0.0)
    t['kn_screen'] = _m('#000000', 0.20, emission='#FFFFFF', strength=0.0)
    t['kn_decal'] = _m('#808080', 0.50)  # atlas arrives with decals.blend (M1)
    for k, h, r, metal in (('wood', '#C89A62', 0.7, 0.0), ('brick', '#B5553B', 0.9, 0.0), ('glass', '#DDE8EA', 0.3, 0.0),
                           ('ceramic', '#F2EEE6', 0.6, 0.0), ('metal', '#9AA0A8', 0.5, 1.0),
                           ('paper', '#CDB894', 0.85, 0.0)):
        t['kn_interior_' + k] = _m(h, r, metal=metal)
    # --- M2 stream E2: critter fur and Mega Kitchen masters (additive) ---
    for k, h in FUR_HEX.items():
        t['kn_fur_' + k] = _m(h, 0.60, sheen=0.5)
    for k, (h, r, kw) in ENV_MASTERS.items():
        t['kn_env_' + k] = _m(h, r, **kw)
    return t


# M2 (stream E2). `kn_fur_<critter>` is the coat; `kn_fur_<critter>_<region>` are the brief's texture-mask
# regions (points, belly, stripe, mask, ...) as flat masters until the critter texture sets are baked
# (critters.md "Fur/skin material"). Roughness 0.6, sheen 0.5 (shared_kit §7.2 fur row).
FUR_HEX = {
    'mochi': '#EEE4D2', 'mochi_points': '#D99252', 'mochi_white': '#F8F4EC', 'mochi_rose': '#D98C8C',
    'pip': '#DDB98F', 'pip_stripe': '#5B4337', 'pip_cream': '#F5ECDD', 'pip_pink': '#E7A9A0',
    'goby': '#F47C2C', 'goby_belly': '#F6C25A', 'goby_fin': '#FFB07A', 'goby_fin_edge': '#FBE3C5',
    'bandit': '#8E8C93', 'bandit_mask': '#33333A', 'bandit_cream': '#EEE7DB', 'bandit_hands': '#4A4A50',
    # --- M4 stream E4b: BISCUIT and HENNY coats and their texture-mask regions (critters.md; additive) ---
    'biscuit': '#C98C50', 'biscuit_cream': '#F2E3C9', 'biscuit_brown': '#7A4F2F', 'biscuit_tongue': '#D9787A',
    'henny': '#D9A65E', 'henny_cream': '#F2DFB6', 'henny_caramel': '#A86F37', 'henny_comb': '#D6453B',
    'henny_beak': '#EDB23E',
}
# Mega Kitchen (environments.md §2, shared_kit §7.3). `floor_tile_grey` is the checker's second tile and
# `wall` the plaster walls: both stand in for the UV2 trim / unique textures until the env texture bake.
ENV_MASTERS = {
    'floor_tile': ('#E3DCCD', 0.35, {'coat': 0.3, 'coat_rough': 0.1}),
    'floor_tile_grey': ('#B9B1A3', 0.35, {'coat': 0.3, 'coat_rough': 0.1}),
    'counter': ('#D9D2C3', 0.40, {'coat': 0.2, 'coat_rough': 0.2, 'bump': (300, 0.05, 0.002)}),
    'wall': ('#EFE7DA', 0.85, {}),
    'foliage': ('#5E8F3E', 0.70, {'sheen': 0.2}),
    'backdrop': ('#CFE6FF', 1.0, {'emission': '#CFE6FF', 'strength': 1.0}),
    'cyc_light': ('#BDB8AF', 0.92, {}),
    'cyc_dark': ('#1C1F26', 0.85, {}),
    # --- M3 stream E3b: THE TINKER LAB, the props kit and the Backlot terrain (shared_kit §7.3; additive) ---
    # the key art's warm brown boards (render_tinker_lab.py 'floor'; D82: the approved key art wins). The first
    # pass's pale #9A8A74 read +1 EV too bright and cold under the bench in the D79 side-by-side (M3 close-out)
    'floorboards': ('#7A5236', 0.50, {'coat': 0.2, 'coat_rough': 0.3, 'wood': ('#5A3A24', '#8E6240')}),
    'plaster_warm': ('#E6D8BF', 0.85, {'bump': (400, 0.04, 0.001)}),
    'bench_oak': ('#B8834E', 0.45, {'coat': 0.35, 'coat_rough': 0.15, 'wood': ('#9C6A3C', '#BE8A55')}),
    'cutting_mat': ('#2E5E52', 0.70, {}),          # the key art's darker grey-green (D79 side-by-side)
    'cutting_mat_grid': ('#D6E4DC', 0.70, {}),     # crisp near-white grid
    'chalkboard': ('#2C3A34', 0.90, {}),
    'chalk': ('#F8F6EF', 0.95, {}),                # bright matte chalk (high albedo, no emission)
    'pegboard': ('#B98E5E', 0.80, {}),
    'cork': ('#B98A58', 0.95, {'bump': (900, 0.2, 0.001)}),
    'wainscot': ('#4F6F5E', 0.55, {'coat': 0.2, 'coat_rough': 0.25}),
    'blueprint': ('#21508F', 0.85, {}),
    'terracotta': ('#C2643E', 0.60, {}),
    'foliage_dark': ('#3E7D3A', 0.65, {'sheen': 0.2}),
    'book_red': ('#8E3B2F', 0.75, {}),
    'book_blue': ('#2F5D7E', 0.75, {}),
    'book_mustard': ('#C9A04A', 0.75, {}),
    'book_green': ('#3E6B4B', 0.75, {}),
    'book_plum': ('#6B4A7A', 0.75, {}),
    'book_navy': ('#2E3A55', 0.75, {}),
    'backdrop_warm': ('#FFE2B0', 1.0, {'emission': '#FFD9A0', 'strength': 1.0}),
    'bulb': ('#FFE7B8', 0.30, {'emission': '#FFD08A', 'strength': 8.0}),
    'enamel_green': ('#2F6B57', 0.40, {'coat': 0.3, 'coat_rough': 0.2}),
    'grass': ('#6E9A48', 0.85, {'sheen': 0.2}),
    'dirt': ('#8E6B4A', 0.90, {}),
    'sand': ('#D6BE8E', 0.90, {}),
    'rock': ('#8B8580', 0.75, {}),
    'hay': ('#D9B65E', 0.85, {}),
    'concrete': ('#A7A39B', 0.80, {}),
    # --- M5 stream E5c: ORBITAL HANGAR and MOON BASE (environments.md §5, §6; additive) ---
    # mid-light greys (review: the window and Earth must be the brightest thing in the bay), with variation tones
    'panel_white': ('#CCD1D6', 0.36, {'coat': 0.25, 'coat_rough': 0.2, 'bump': (1400, 0.02, 0.0004)}),
    # ART (beta polish, D128): the variation tones pulled in to ~0.16 / 0.12 stop below panel_white (were 0.39 / 0.32,
    # the warm one visibly yellow) and the deck's to 0.08 stop (was 0.19); env_hangar picks them per rib run, not per panel
    'panel_grey': ('#C2C7CD', 0.40, {'coat': 0.2, 'coat_rough': 0.25, 'bump': (1400, 0.02, 0.0004)}),
    'panel_warm': ('#C9C9C4', 0.40, {'coat': 0.2, 'coat_rough': 0.25, 'bump': (1400, 0.02, 0.0004)}),
    'deck': ('#979DA4', 0.72, {'bump': (2200, 0.18, 0.0008)}),          # mid-grey anti-slip deck
    'deck_alt': ('#93999F', 0.74, {'bump': (2200, 0.18, 0.0008)}),      # its darker variation block
    'solar_cell': ('#1A2A57', 0.30, {'coat': 0.35, 'coat_rough': 0.08}),  # deep blue cells, a little specular
    # ART (beta polish, D128): the solar backplate seen in the module gaps: a mid blue-grey (was brushed steel), so the
    # grid keeps its read up close without shimmering at 40-80 m
    'solar_grid': ('#4A5266', 0.60, {}),
    'deck_seam': ('#4E535B', 0.60, {}),                                  # deck / panel backing seen in the seams
    'light_strip': ('#F2F6FF', 0.30, {'emission': '#EAF1FF', 'strength': 6.0}),   # 6,500 K ceiling strips
    'sconce': ('#FFE2B8', 0.30, {'emission': '#FFC27A', 'strength': 5.0}),        # 2,700 K airlock / clamp sconces
    'earth': ('#1F86C2', 0.45, {'emission': '#1F86C2', 'strength': 0.45}),        # stylised Beam oceans
    'earth_land': ('#7DA35A', 0.80, {'emission': '#7DA35A', 'strength': 0.4}),    # Volt-tinted-down land
    'earth_cloud': ('#E8E2D6', 0.90, {'emission': '#E8E2D6', 'strength': 0.42}),  # Bone clouds
    'atmosphere': ('#9CC8FF', 1.00, {'emission': '#9CC8FF', 'strength': 0.9}),    # limb glow
    # the baked Earth (env_hangar.earth_bake): white so the texture set shows as is, emitting texture x 0.15 x 12
    'earth_tex': ('#FFFFFF', 0.60, {'emission': '#FFFFFF', 'strength': 0.15}),
    'field_led': ('#FF3DAE', 0.30, {'emission': '#FF3DAE', 'strength': 4.0}),     # zero-g ring LED, solo (Field)
    'led_white': ('#EEF1F6', 0.30, {'emission': '#EEF1F6', 'strength': 4.0}),     # ring dashes + glyphs, multiplayer
    'star': ('#FFFFFF', 1.00, {'emission': '#FFFFFF', 'strength': 4.0}),
    'regolith': ('#8C8A85', 0.95, {'bump': (900, 0.25, 0.002)}),
    'regolith_sintered': ('#9A968E', 0.80, {'bump': (1600, 0.08, 0.0008)}),
    'regolith_dark': ('#6F6C67', 0.95, {}),                              # rover tracks, boot prints, crater floors
    'foil_gold': ('#D9A441', 0.32, {'metal': 1.0}),
    'window_glow': ('#FFC98A', 0.40, {'emission': '#FFB870', 'strength': 4.0}),   # 3,000 K dome / cabin windows
}
