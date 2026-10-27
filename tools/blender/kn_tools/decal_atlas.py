"""Shared decal atlas layout (docs/art/briefs/shared_kit.md §6) as plain data: slot ids -> pixel rects.

No bpy here. tools/blender/build_decals.py renders assets/build/kit/decals_atlas.png from these tables and writes
decals_atlas.json; the make_<type>.py builders read the same tables to UV their `kn_decal` quads, so a part
build never depends on the PNG existing.

Pixel space: 4096², origin top-left, y down. glTF UVs use the same orientation (v = 0 at the image top);
Blender UVs are v-up, so a Blender UV is (x / 4096, 1 - y / 4096) and the glTF exporter flips it back.
Slot ids: name.<type>.<ink> · word.<word>.<ink> · spec.<type>.<ink> · num.<glyph>.<sans|mono>.<ink> ·
mark.<mark>.<ink> · picto.<pictogram>.<warn|mono> · trim.<tile>. <ink> is the text colour: bone (for graphite
plates) or graphite (for bone plates).
"""
SIZE = 4096
GUTTER = 4
DILATE = 8
INKS = ('bone', 'graphite')
INK_HEX = {'bone': '#E8E2D6', 'graphite': '#3A3E47'}
AMBER_HEX = '#FFB020'

# Region A: part names (every M1 part, incl. the procedural ones), shown in caps.
NAMES = [
    ('thud', 'THUD'), ('boing', 'BOING'), ('stitch', 'STITCH'), ('helio', 'HELIO'),
    ('brik', 'BRIK'), ('plank', 'PLANK'), ('slope', 'SLOPE'), ('tube', 'TUBE'), ('ledge', 'LEDGE'),
    ('fulcrum', 'FULCRUM'), ('anchor', 'ANCHOR'), ('sheave', 'SHEAVE'),
    ('treadway', 'TREADWAY'), ('band', 'BAND'), ('line', 'LINE'), ('cog', 'COG'), ('motor', 'MOTOR'),
    ('gale', 'GALE'),
    ('mains', 'MAINS'), ('stomp_pad', 'STOMP PAD'), ('the_button', 'THE BUTTON'),
    ('cable_power', 'POWER CABLE'), ('cable_signal', 'SIGNAL CABLE'),
    ('wick', 'WICK'), ('fuse', 'FUSE'), ('bangstick', 'BANGSTICK'),
    ('snipper', 'SNIPPER'), ('topple_tile', 'TOPPLE TILES'),
    # M2 parts (stream E1). Appended so every M1 slot keeps its place.
    ('fuzz', 'FUZZ'), ('pig_iron', 'PIG IRON'),
    ('gutter', 'GUTTER'), ('vortex', 'VORTEX'), ('sprong', 'SPRONG'), ('trap_box', 'TRAP BOX'), ('scoop', 'SCOOP'),
    ('flap', 'FLAP'),
    ('dynamo', 'DYNAMO'), ('hamster_drive', 'HAMSTER DRIVE'), ('turbine', 'TURBINE'), ('pedal_rig', 'PEDAL RIG'),
    ('puffer', 'PUFFER'),
    ('cell', 'CELL'), ('suncell', 'SUNCELL'), ('lamp', 'LAMP'), ('torch', 'TORCH'), ('burning_glass', 'BURNING GLASS'),
    ('toggle', 'TOGGLE'), ('ringer', 'RINGER'), ('delay', 'DELAY'),
    ('t_plunger', 'T-PLUNGER'), ('skyrocket', 'SKYROCKET'), ('big_top', 'BIG TOP'), ('cork_blaster', 'CORK BLASTER'),
    ('punchline', 'PUNCHLINE'), ('gotcha_box', 'GOTCHA BOX'), ('fishbowl', 'FISHBOWL'),
    # M3 parts (stream E3a). Appended so every M1 / M2 slot keeps its place.
    ('lance', 'LANCE'), ('mirror', 'MIRROR'), ('splitter', 'SPLITTER'), ('tripwire', 'TRIPWIRE'), ('ping', 'PING'),
    ('maglock', 'MAGLOCK'), ('glidepath', 'GLIDEPATH'), ('spindeck', 'SPINDECK'), ('lift', 'LIFT'), ('rack', 'RACK'),
    ('ram', 'RAM'), ('powder_keg', 'POWDER KEG'), ('jitterjuice', 'JITTERJUICE'), ('skyshow', 'SKYSHOW'),
    ('flamer', 'FLAMER'), ('popper', 'POPPER'), ('snaptrap', 'SNAPTRAP'), ('bonker', 'BONKER'),
    ('flinger', 'FLINGER'), ('wrecker', 'WRECKER'), ('pinger', 'PINGER'), ('paddle', 'PADDLE'), ('bumper', 'BUMPER'),
    ('pane', 'PANE'), ('tonebars', 'TONEBARS'), ('ding', 'DING'), ('fabricator', 'FABRICATOR'),
    ('recycler', 'RECYCLER'), ('zone', 'ZONE'),
    # M4 parts (stream E4a). Appended so every M1-M3 slot keeps its place.
    ('grit_hopper', 'GRIT HOPPER'), ('hourglass', 'HOURGLASS'), ('tank', 'TANK'), ('sprinkle_can', 'SPRINKLE CAN'),
    ('waterwheel', 'WATERWHEEL'), ('sponge', 'SPONGE'), ('marble_hopper', 'MARBLE HOPPER'), ('blowout', 'BLOWOUT'),
    ('vac', 'VAC'), ('inflator', 'INFLATOR'), ('arc_tower', 'ARC TOWER'), ('toast_cannon', 'TOAST CANNON'),
    ('zippy', 'ZIPPY'), ('quack', 'QUACK'),
    # M5 parts (stream E5a). Appended so every M1-M4 slot keeps its place.
    ('rift_gate', 'RIFT GATE'), ('grav_well', 'GRAV WELL'), ('tractor_beam', 'TRACTOR BEAM'),
    ('hover_pad', 'HOVER PAD'), ('force_wall', 'FORCE WALL'), ('coilgun_ring', 'COILGUN RING'),
    ('stasis_field', 'STASIS FIELD'), ('buzz_beacon', 'BUZZ BEACON'), ('singularity', 'SINGULARITY'),
    ('grabber', 'GRABBER'), ('goo_vat', 'GOO VAT'),
]
WORDS = ['IN', 'OUT', 'ON', 'OFF', 'MIN', 'MAX', 'PUSH', 'PULL', 'LOAD', 'FIRE', 'ARM', 'RESET']
# Region B: one flavour line per part that has spec text in its brief.
SPECS = [('motor', 'KN-07 · 24V · 1.5 rps'), ('mains', 'KN-01 · 500 W')]
# Region C columns.
NUMERALS = [('0', '0'), ('1', '1'), ('2', '2'), ('3', '3'), ('4', '4'), ('5', '5'), ('6', '6'), ('7', '7'),
            ('8', '8'), ('9', '9'), ('dot', '.'), ('minus', '−'), ('plus', '+'), ('times', '×'),
            ('degree', '°'), ('percent', '%')]
NUMERAL_ROWS = [('sans', 'bone'), ('sans', 'graphite'), ('mono', 'bone'), ('mono', 'graphite')]
# Region D, row 4 spare cells (cols 9..14): COG tooth-count marks ("20T" on the web, drive.md COG).
MARKS = [('teeth_20', '20T'), ('teeth_40', '40T'), ('teeth_60', '60T')]
# Region D, M2 (stream E1): single-ink stamps and glyphs in the spare cells (shared_kit §6.1 row plan).
# Row 1 / 2 cols 12-15: the in / out / both / rotate-CW arrows (Bone / Graphite), drawn as SDF shapes.
ARROWS = ['arrow_in', 'arrow_out', 'arrow_both', 'arrow_rotate']
# (id, text or shape, ink, col, row): STITCH "KN-ST" and PIG IRON "6.5" stamps (Unbounded, scaled to fit),
# and the BIG TOP loaded-flag star.
STAMPS = [('kn_st', 'KN-ST', 'graphite', 14, 2), ('mass_6_5', '6.5', 'bone', 15, 2),
          # M3 (E3a): WRECKER "20 KG" spec stamp, RECYCLER "GOAL" caption (A2 words are full)
          ('mass_20', '20 KG', 'graphite', 12, 2), ('goal', 'GOAL', 'bone', 13, 2)]
GLYPHS = [('star', 'bone', 15, 3)]
# Region F row 4 col 3 (spare): the GOTCHA BOX sprite face (glossy eyes + grin) in the tile's left 256 x 128 px;
# a decal samples it with sub = FACE_SUB.
FACE_SUB = (0.0, 0.0, 0.25, 1.0)
# M3 (E3a): Region F row 3 col 3 (spare "stencils" tile) holds 8 single-ink Bone marks, one per 1/8 of the tile
# (≈ 127 x 120 px each); a decal samples one with sub = marks_sub(name). TRIPWIRE BREAK / LIT mode icons, the ZONE
# stake mode glyphs (gravity down arrow, antigrav up arrow, wind streaks, stasis snowflake-clock), the SPINDECK
# rim tick and the VASE potter's mark.
MARKS_M3 = ['beam_break', 'beam_lit', 'zone_down', 'zone_up', 'zone_wind', 'zone_stasis', 'tick', 'potter']


def marks_sub(name):
    i = MARKS_M3.index(name)
    return (i / 8.0, 0.0, (i + 1) / 8.0, 1.0)


# M4 (stream E4a): Region F row 2 col 2 (spare) holds 8 coloured marks, one per 1/8 of the tile; a decal samples one
# with sub = marks4_sub(name). The YOLK "KN" stamp in Ignition ink, the INFLATOR gauge dial (Volt band -> Amber band,
# graphite ticks on bone), the TOAST CANNON browning dial (five tan -> golden dots round an arc), a Beam water drop
# (TANK / SPRINKLE CAN fill marks) and a sand-grain trio (GRIT HOPPER); three cells spare.
MARKS_M4 = ['kn_stamp', 'gauge_dial', 'brown_dial', 'drop', 'grains', 'spare_5', 'spare_6', 'spare_7']


def marks4_sub(name):
    i = MARKS_M4.index(name)
    return (i / 8.0, 0.0, (i + 1) / 8.0, 1.0)


# M5 (stream E5a): Region F row 3 col 2 (a spare cell of shared_kit §6.3 row 4) holds 8 marks, one per 1/8 of the
# tile; a decal samples one with sub = marks5_sub(name). The RIFT GATE pair glyph (two linked rings, bone), the BUZZ BEACON pad glyph (Buzz seen from
# above: a pebble with four ducts, bone), the GRABBER zone letters A / B (bone), the COILGUN RING direction chevrons
# (bone), a slime-green GOO VAT drop, a FORCE WALL hex cell (bone) and the STASIS FIELD hourglass-clock (bone).
MARKS_M5 = ['pair', 'buzz', 'letter_a', 'letter_b', 'chevrons', 'goo_drop', 'hex', 'stasis']


def marks5_sub(name):
    i = MARKS_M5.index(name)
    return (i / 8.0, 0.0, (i + 1) / 8.0, 1.0)
# Region E: the 16 pictograms of §6.2, in table order.
PICTOS = ['explosive', 'flammable', 'hot_surface', 'high_voltage', 'rotating_parts', 'pinch_point', 'light_beam',
          'magnetic_field', 'fragile', 'pressurised', 'wireless', 'recycle', 'critter_friendly', 'keep_clear',
          'blades', 'launch']
# Region F rows 1-2 (§6.3).
TRIMS = [['hazard_r', 'hazard_l', 'hazard_r_cap_l', 'hazard_r_cap_r'],
         ['hazard_narrow_r', 'hazard_narrow_l', 'tape_graphite', 'grille']]

REGIONS = {
    'A': (0, 0, 3840, 1536, 384, 64),
    'A2': (3840, 0, 256, 1536, 256, 64),
    'B': (0, 1536, 4096, 1024, 512, 32),
    'C': (0, 2560, 2048, 512, 128, 128),
    'D': (2048, 2560, 2048, 512, 128, 128),
    'E': (0, 3072, 4096, 512, 256, 256),
    'F': (0, 3584, 4096, 512, 1024, 128),
}


def _cell(region, col, row):
    x0, y0, w, h, cw, ch = REGIONS[region]
    if (col + 1) * cw > w or (row + 1) * ch > h:
        raise ValueError('cell %d,%d outside region %s' % (col, row, region))
    return (x0 + col * cw, y0 + row * ch, cw, ch)


def slots():
    """{slot id: {'rect': [x, y, w, h], 'live': [...], 'region', 'content'}} in pixels (y down)."""
    out = {}

    def add(sid, region, col, row, **content):
        x, y, w, h = _cell(region, col, row)
        out[sid] = {'region': region, 'rect': [x, y, w, h],
                    'live': [x + GUTTER, y + GUTTER, w - 2 * GUTTER, h - 2 * GUTTER], 'content': content}

    i = 0
    for t, text in NAMES:
        for ink in INKS:
            add('name.%s.%s' % (t, ink), 'A', i % 10, i // 10, kind='name', text=text, ink=ink)
            i += 1
    i = 0
    for wd in WORDS:
        for ink in INKS:
            add('word.%s.%s' % (wd.lower(), ink), 'A2', 0, i, kind='word', text=wd, ink=ink)
            i += 1
    i = 0
    for t, text in SPECS:
        for ink in INKS:
            add('spec.%s.%s' % (t, ink), 'B', i % 8, i // 8, kind='spec', text=text, ink=ink)
            i += 1
    for row, (face, ink) in enumerate(NUMERAL_ROWS):
        for col, (gid, ch) in enumerate(NUMERALS):
            add('num.%s.%s.%s' % (gid, face, ink), 'C', col, row, kind='numeral', text=ch, face=face, ink=ink)
    col = 9
    for mid, text in MARKS:
        for ink in INKS:
            add('mark.%s.%s' % (mid, ink), 'D', col, 3, kind='mark', text=text, ink=ink)
            col += 1
    for row, ink in enumerate(INKS):  # M2: arrows, stamps, glyphs, the Gotcha face (see ARROWS above)
        for k, a in enumerate(ARROWS):
            add('mark.%s.%s' % (a, ink), 'D', 12 + k, row, kind='glyph', shape=a, ink=ink)
    for mid, text, ink, col, row in STAMPS:
        add('mark.%s.%s' % (mid, ink), 'D', col, row, kind='stamp', text=text, ink=ink)
    for gid, ink, col, row in GLYPHS:
        add('mark.%s.%s' % (gid, ink), 'D', col, row, kind='glyph', shape=gid, ink=ink)
    add('trim.face_gotcha', 'F', 3, 3, kind='trim', tile='face_gotcha')
    add('trim.marks_m3', 'F', 3, 2, kind='trim', tile='marks_m3')  # M3 (E3a): see MARKS_M3
    add('trim.marks_m4', 'F', 2, 2, kind='trim', tile='marks_m4')  # M4 (E4a): see MARKS_M4
    add('trim.marks_m5', 'F', 2, 3, kind='trim', tile='marks_m5')  # M5 (E5a): see MARKS_M5
    for row, style in enumerate(('warn', 'mono')):
        for col, p in enumerate(PICTOS):
            add('picto.%s.%s' % (p, style), 'E', col, row, kind='picto', picto=p, style=style)
    for row, tiles in enumerate(TRIMS):
        for col, tname in enumerate(tiles):
            add('trim.' + tname, 'F', col, row, kind='trim', tile=tname)
    return out


_SLOTS = None


def slot(sid):
    global _SLOTS
    if _SLOTS is None:
        _SLOTS = slots()
    if sid not in _SLOTS:
        raise KeyError('no decal atlas slot %r' % sid)
    return _SLOTS[sid]


def live_uv(sid):
    """Blender UV corners (u0, v_bottom, u1, v_top) of a slot's live area (gutter excluded)."""
    x, y, w, h = slot(sid)['live']
    return x / SIZE, 1.0 - (y + h) / SIZE, (x + w) / SIZE, 1.0 - y / SIZE


def aspect(sid):
    _, _, w, h = slot(sid)['live']
    return w / h
