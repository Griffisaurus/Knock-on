// Parts whose final art the game loads from /parts/<type>/ (ASSET_PIPELINE §8). The art pipeline
// appends to this list as parts land; missing builds fall back to the blockout visuals.
// A part draws this art only when its def sets `art` (parts-data); COG uses one mesh per size.
export const ART_PARTS: readonly string[] = [
  'thud', 'boing', 'helio',
  'brik', 'plank', 'slope', 'ledge', 'fulcrum', 'anchor', 'sheave',
  'treadway', 'cog_s', 'cog_m', 'cog_l', 'motor',
  'gale',
  'mains', 'stomp_pad', 'the_button',
  'wick', 'bangstick',
  'snipper',
  'topple_tile',
  // M2 (stream E1). GUTTER is a path kit: gutter.glb holds the kit pieces on a demo run plus gutter.profile.json
  // for the engine sweep, so its def should not set `art` until the path sweeper reads that profile.
  'stitch', 'fuzz', 'pig_iron',
  'gutter', 'vortex', 'sprong', 'trap_box', 'scoop', 'flap',
  'dynamo', 'hamster_drive', 'turbine', 'pedal_rig',
  'puffer',
  'cell', 'suncell', 'lamp', 'torch', 'burning_glass', 'toggle', 'ringer', 'delay',
  't_plunger', 'skyrocket', 'big_top', 'cork_blaster',
  'punchline', 'gotcha_box', 'fishbowl',
  // M3 (stream E3a). GLIDEPATH is a path kit like GUTTER (glidepath.glb = kit pieces on a demo run +
  // glidepath.profile.json), so its def should not set `art` until the sweeper reads the profile. MARBLE carries the
  // GLINT / BEARING skins; RACK, RAM, LIFT and TONEBARS are built at their reference size / variant.
  'lance', 'mirror', 'splitter', 'tripwire', 'ping', 'maglock',
  'marble', 'glidepath', 'glidepath_booster', 'spindeck', 'lift', 'rack', 'ram',
  'powder_keg', 'jitterjuice', 'skyshow', 'flamer', 'popper',
  'snaptrap', 'bonker', 'flinger', 'wrecker', 'pinger', 'paddle', 'bumper',
  'pin', 'stacker', 'pane', 'vase', 'tonebars', 'ding',
  'fabricator', 'recycler', 'zone',
  // M4 (stream E4a). The Matter containers carry CAVITY__ fill data in .art.json cavities[] (volume, 64-entry fill
  // LUT, cavity mesh; SPRINKLE CAN adds tilt LUTs). TOAST_SLICE is the launched slice body (pooled like YOLK);
  // YOLK's DEB_eggshell bits are yolk.frac.glb (Spectacle debris, not sim chunks).
  'grit_hopper', 'hourglass', 'tank', 'sprinkle_can', 'waterwheel', 'sponge', 'marble_hopper',
  'blowout', 'vac', 'inflator', 'arc_tower', 'toast_cannon', 'toast_slice', 'yolk', 'zippy', 'quack',
  // M5 (stream E5a). FORCE WALL (W 0.6 x H 0.4) and STASIS FIELD (0.5³) are built at their def defaults with every kit
  // piece its own node (force_wall__field is the field surface to scale and hide while OFF). GRABBER carries a device RIG
  // (pivot mirrors + socket_grip / socket_tip) and clips; BUZZ BEACON its socket_dock. GOO VAT is art only (X5 holds
  // the goo sim); CAVITY__goo is in .art.json cavities[].
  'rift_gate', 'grav_well', 'tractor_beam', 'hover_pad', 'force_wall', 'coilgun_ring', 'stasis_field',
  'buzz_beacon', 'singularity', 'grabber', 'goo_vat',
];

/** Environments with built set art at /env/<id>/<id>.glb (stream C draws them; the Studio is procedural). */
export const ART_ENVS: readonly string[] = ['kitchen'];

/**
 * Critters with built skinned art at /parts/<type>/<type>.glb (gfx/critters.ts loads them; M2 E2 + M4 E4b).
 * The M4 three also carry a D78 texture set (`.art.json textures`, 4096² / DUSTY 2048²); DUSTY is a rigid robot
 * critter (`.art.json robot`, LED face icons per clip in `faceTracks`, pivot bones in `pivotBones`).
 * M5 (E5b): BUZZ, the second robot critter (2048² set; one `SCREEN__face` visor, rotor / visor / winch / claw pivots).
 */
export const ART_CRITTERS: readonly string[] = ['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty', 'buzz'];

/** Art meshes whose part type differs from their name (one mesh per COG size: `size` prop S/M/L). */
export const ART_BASE: Readonly<Record<string, string>> = { cog_s: 'cog', cog_m: 'cog', cog_l: 'cog' };
