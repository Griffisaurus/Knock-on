// THE LONG WAY HOME v2: a GALE chain (overhead fans pitched 13° down) carries the BOING; TUBEs keep it on the line.
// World metres; rot = [yaw, pitch, roll] degrees. Warehouse, Studio. Flat floor x ±12, z −8..40.
export const parts = [], links = [], tubes = [], stations = [];
const r3 = (v) => Math.round(v * 1000) / 1000;
export function P(key, type, pos, props = {}, rot = [0, 0, 0], flags = 0) {
  if (parts.find((p) => p.key === key)) throw new Error(`dup ${key}`);
  parts.push({ key, type, pos: pos.map(r3), rot, props, flags, station: stations.at(-1)?.id ?? '' });
  return key;
}
export function W(a, ap, b, bp, via) { links.push({ from: [a, ap], to: [b, bp], ...(via ? { via } : {}) }); }
export function ST(id, name) { stations.push({ id, name }); }
const GH = 0.5, GP = 15;    // overhead gale height and pitch
/** An overhead GALE on the ball's line at (x, z), yaw = direction of travel (0 = +Z, 90 = +X), powered by `mains`. */
export function gale(key, x, z, yaw, mains) { P(key, 'gale', [x, GH, z], {}, [yaw, GP, 0]); W(mains, 'out', key, 'in'); }
/** Light-beam gate: LANCE at (x0,z) and TRIPWIRE at (x1,z), beam along +X across the line. */
export function beam(prefix, x0, x1, z, mainsKey) {
  P(`${prefix}M`, 'mains', [x0 - 1.0, 0, z], { on: 1 });
  P(`${prefix}L`, 'lance', [x0, 0, z]); W(`${prefix}M`, 'out', `${prefix}L`, 'in');
  P(`${prefix}T`, 'tripwire', [x1, 0, z]);
}

/** One-shot latch: a signal makes a FABRICATOR (one STITCH in its pool) spawn a stitch into a RECYCLER (goal 1), which signals once. */
export function latch(prefix, x, z, inKey, inPort) {
  P(`${prefix}F`, 'fabricator', [x, 0.4, z], { part: 1, count: 1, interval: 0, speed: 1.0 });
  P(`${prefix}R`, 'recycler', [x, 0, z + 0.36], { target: 1 });
  W(inKey, inPort, `${prefix}F`, 'spawn');
  return `${prefix}R`;
}

// ================= ACT I: THE ESCAPE =================
ST('I', 'Act I: The Escape');
P('btn', 'the_button', [0, 0, -7]);                       // the friend's press
P('rng', 'ringer', [-2.5, 0, -7], { time: 1 });           // 1 s after the start: the ring wakes BISCUIT
P('clk', 'hourglass', [-5.0, 0, -7], { duration: 120 });  // the clock: 120 s
P('bis', 'biscuit', [-1.0, 0, -3.9]);
P('trap', 'flap', [-1.5, 0.62, -2.4]);                    // the shelf trapdoor
W('btn', 'out', 'trap', 'in');
P('bo', 'boing', [-1.5, 0.82, -2.4], {}, [0, 0, 0], 512);   // the hero (tagged for BUZZ: flag 512)
P('sl', 'slope', [-1.5, 0, -2.2], { angle: 12 }, [90, 0, 0]);
P('fnL', 'plank', [-1.95, 0.05, -0.55], {}, [15, 0, 0]);  // a V-funnel of two PLANKs guides the ball into the tube mouth
P('fnR', 'plank', [-1.05, 0.05, -0.55], {}, [-15, 0, 0]);
tubes.push({ key: 'route1', slim: false, pts: [[-1.5, 0.15, 0.0], [-1.5, 0.15, 8.6]] });
// pig iron on a shelf drops on a brick tower beside the run
P('dpig', 'delay', [-3.0, 0, -5.0], { delay: 5.5 });
W('btn', 'out', 'dpig', 'in');
P('pf', 'flap', [1.6, 1.6, 1.2]);
W('dpig', 'out', 'pf', 'in');
P('pig', 'pig_iron', [1.6, 1.72, 1.2]);
P('pstop', 'plank', [1.6, 0.05, 3.2], {}, [90, 0, 0]);   // stops the pig iron rolling on
for (const [x, y] of [[1.5, 0.05], [1.7, 0.05], [1.5, 0.15], [1.7, 0.15]]) P(`brk${x}${y}`, 'brik', [x, y, 1.2]);
// the first fans: MAINS A switches on 2.5 s after the press
P('mA', 'mains', [-4.2, 0, 3.0], { on: 0 });
P('dA', 'delay', [-3.4, 0, -5.0], { delay: 2.5 });
W('btn', 'out', 'dA', 'in'); W('dA', 'out', 'mA', 'in');
gale('g1', -1.5, -0.3, 0, 'mA');
gale('g2', -1.5, 4.5, 0, 'mA');

// ================= ACT II: THE LOCKED DOOR =================
ST('II', 'Act II: The Locked Door');
P('mB', 'mains', [-4.2, 0, 8.0], { on: 0 });                // MAINS B (g3, g4) switches on 22 s after the press: a timer bridge
P('dB', 'delay', [-3.4, 0, -4.0], { delay: 21 });
W('btn', 'out', 'dB', 'in'); W('dB', 'out', 'mB', 'in');
gale('g3', -1.5, 7.5, 0, 'mB');
gale('g4', -1.5, 12.5, 0, 'mB');
beam('d1', -3.0, -0.3, 9.0);                                // LANCE beam across the first gap
P('gate', 'force_wall', [-1.5, 0, 9.55], { width: 0.4, height: 0.4, start: 1 });   // the locked door
W('d1T', 'out', 'gate', 'toggle');
tubes.push({ key: 'route2a', slim: false, pts: [[-1.5, 0.15, 9.8], [-1.5, 0.15, 13.4]] });
beam('d2', -3.0, -0.3, 14.0);                               // the second beam: the slam (one-shot latch so the ball's bounces can't re-trigger it)
P('slam', 'force_wall', [-1.5, 0, 14.8], { width: 0.4, height: 0.4, start: 0 });   // slams shut on the ball
const lat2 = latch('l2', 1.5, 12.0, 'd2T', 'out');
P('dSlam', 'delay', [-3.0, 0, 14.8], { delay: 4 });         // and opens again 4 s later
P('dMixSlam', 'delay', [-3.0, 0, 15.6], { delay: 0.1 });    // FORCE WALL toggle takes one cable: both pulses go through this DELAY
W(lat2, 'count', 'dSlam', 'in'); W(lat2, 'count', 'dMixSlam', 'in'); W('dSlam', 'out', 'dMixSlam', 'in'); W('dMixSlam', 'out', 'slam', 'toggle');
tubes.push({ key: 'route2b', slim: false, pts: [[-1.5, 0.15, 15.0], [-1.5, 0.15, 19.0]] });
// PIP wakes at 30 s (RINGER) and runs the wheel: HAMSTER DRIVE → DYNAMO → GALE g5 for ~6 s
P('rPip', 'ringer', [-5.5, 0, 17.0], { time: 30 });
P('ham', 'hamster_drive', [-4.0, 0, 16.0]);
P('pip', 'pip', [-4.0, 0.04, 16.0]);
P('dyn', 'dynamo', [-3.2, 0, 16.0]); W('ham', 'out', 'dyn', 'in');
P('g5', 'gale', [-1.5, GH, 16.0], {}, [0, GP, 0]); W('dyn', 'out', 'g5', 'in');

// ================= ACT III: THE RIFT =================
ST('III', 'Act III: The Rift');
P('rgA', 'rift_gate', [-1.5, 0, 19.7], { pair: 0 }, [180, 0, 0]);
P('rgB', 'rift_gate', [2.5, 0, 22.0], { pair: 0 }, [0, 0, 0]);
tubes.push({ key: 'route3a', slim: false, pts: [[2.5, 0.15, 22.8], [2.5, 0.15, 25.5]] });
// the lift station: the ball rolls across a floor gap to a stop wall; a beam across the gap starts the TRACTOR BEAM
beam('d3', 1.0, 4.0, 27.2);
P('stop3', 'force_wall', [2.5, 0, 28.4], { width: 0.4, height: 0.4, start: 1 });
P('mT', 'mains', [6.0, 0, 29.5], { on: 0 });
P('tr', 'tractor_beam', [4.3, 1.8, 27.9], { mode: 1, range: 3.0, hold: 1.0 }, [270, 45, 0]);
W('mT', 'out', 'tr', 'in');
P('dT1', 'delay', [3.2, 0, 26.0], { delay: 0.5 }); P('dT2', 'delay', [3.6, 0, 26.0], { delay: 4.0 });
const lat3 = latch('l3', 6.5, 24.0, 'd3T', 'out');
P('dMixT', 'delay', [3.4, 0, 26.0], { delay: 0.1 });   // MAINS in takes one cable
W(lat3, 'count', 'dT1', 'in'); W('dT1', 'out', 'dMixT', 'in'); W(lat3, 'count', 'dT2', 'in'); W('dT2', 'out', 'dMixT', 'in'); W('dMixT', 'out', 'mT', 'in');
tubes.push({ key: 'route4', slim: false, pts: [[3.45, 0.65, 27.9], [3.45, 0.15, 27.9], [10.0, 0.15, 27.9], [10.0, 0.15, 31.15]] });
P('mE', 'mains', [6.0, 0, 26.0], { on: 1 });
gale('g7', 5.6, 27.9, 90, 'mE');
gale('g8', 8.8, 27.9, 90, 'mE');
gale('g9', 10.0, 29.2, 0, 'mE');
gale('g10', 10.0, 30.0, 0, 'mE');
// ---- the long timers (a DELAY is at most 30 s: three in a row make the 86 s mark) ----
P('T1', 'delay', [-6.0, 0, -4.0], { delay: 30 }); P('T2', 'delay', [-6.0, 0, -3.0], { delay: 30 }); P('T3', 'delay', [-6.0, 0, -2.0], { delay: 25 });
W('btn', 'out', 'T1', 'in'); W('T1', 'out', 'T2', 'in'); W('T2', 'out', 'T3', 'in');       // T3 fires at ≈ 86 s
// ---- the STASIS station: a cell wall holds the ball; at ≈ 86 s the wall opens and the STASIS FIELD engages: it freezes the ball
ST('IIIb', 'Act III: Stasis');
P('cell', 'force_wall', [10.0, 0, 31.35], { width: 0.4, height: 0.4, start: 1 });
P('stasis', 'stasis_field', [10.0, 0, 31.95], { width: 0.5, height: 0.5, depth: 0.5 });
P('mS', 'mains', [12.0, 0, 32.2], { on: 0 });
W('mS', 'out', 'stasis', 'in');
W('T3', 'out', 'cell', 'toggle');
P('dS', 'delay', [12.0, 0, 33.2], { delay: 8 }); W('T3', 'out', 'dS', 'in');
P('dMixS', 'delay', [13.0, 0, 33.2], { delay: 0.1 }); W('T3', 'out', 'dMixS', 'in'); W('dS', 'out', 'dMixS', 'in'); W('dMixS', 'out', 'mS', 'in');   // MAINS in takes one cable   // the field lets go 8 s later
tubes.push({ key: 'route6', slim: false, pts: [[10.0, 0.15, 33.0], [10.0, 0.15, 36.4]] });
// ================= ACT IV: HOME =================
ST('IV', 'Act IV: Home');
P('goo', 'goo_vat', [10.0, 0, 38.9], { flow: 1.0, start: 60, open: 0 }, [180, 0, 0]);   // the goo puddle in front of the tube mouth
P('dG', 'delay', [12.0, 0, 36.0], { delay: 4 }); W('T3', 'out', 'dG', 'in'); W('dG', 'out', 'goo', 'open');   // opens 4 s after the stasis starts
P('cell2', 'force_wall', [10.0, 0, 38.55], { width: 0.4, height: 0.4, start: 1 });   // the end stop inside the puddle
P('bowl', 'buzz_beacon', [3.0, 0, 38.5], { pair: 5 });            // the bowl
P('buzz', 'buzz', [3.0, 0.04, 38.5], { pair: 5 });
P('dBz', 'delay', [5.0, 0, 36.0], { delay: 12 }); W('T3', 'out', 'dBz', 'in'); W('dBz', 'out', 'bowl', 'call');   // BUZZ is called ≈ 98 s
// the GRABBER by the puddle: powered, goes when the ball is stuck
P('mGr', 'mains', [12.0, 0, 38.0], { on: 1 });
P('grab', 'grabber', [10.4, 0, 38.0], { aYaw: -90, aReach: 0.3, aHeight: 0.0, bYaw: 90, bReach: 0.3, bHeight: 0.0 }, [0, 0, 0]);
W('mGr', 'out', 'grab', 'in');
P('dGr', 'delay', [12.0, 0, 37.0], { delay: 18 }); W('T3', 'out', 'dGr', 'in'); W('dGr', 'out', 'grab', 'go');
// ---- the end of the clock: HOURGLASS (120 s) → SINGULARITY far to the west; MAINS H off drops the pig iron from the HOVER PAD
P('dEnd', 'delay', [-5.0, 0, -6.0], { delay: 0.1 }); W('clk', 'out', 'dEnd', 'in');
P('sing', 'singularity', [-11.0, 0, 4.0]);
W('dEnd', 'out', 'sing', 'arm');
// ---- the celebration: the HOVER PAD holds the PIG IRON above a T-PLUNGER; when the clock runs out MAINS H cuts, the pad drops,
// the plunger fires two POWDER KEGs and three BANGSTICKs; a GRAV WELL switches on beside them
ST('IVb', 'Act IV: The boom');
P('mH', 'mains', [10.5, 0, 12.0], { on: 1 });
P('plunger', 't_plunger', [8.5, 0, 13.0]);
P('hpad', 'hover_pad', [8.5, 0.35, 13.0]);
W('mH', 'out', 'hpad', 'in');
P('pigH', 'pig_iron', [8.5, 0.46, 13.0]);
W('dEnd', 'out', 'mH', 'in');
P('keg1', 'powder_keg', [7.0, 0.15, 14.8]); P('keg2', 'powder_keg', [9.8, 0.15, 14.8]);
P('bang1', 'bangstick', [6.5, 0.04, 12.0]); P('bang2', 'bangstick', [8.5, 0.04, 11.4]); P('bang3', 'bangstick', [10.5, 0.04, 14.4]);
for (const k of ['keg1', 'keg2', 'bang1', 'bang2', 'bang3']) W('plunger', 'out', k, 'detonator');
P('mW', 'mains', [10.5, 0, 16.5], { on: 0 });
P('well', 'grav_well', [8.5, 0, 16.5]);
W('mW', 'out', 'well', 'in'); W('dEnd', 'out', 'mW', 'in');
// ---- Act I's other chase: the PIG IRON of the Library's COILGUN recipe rolls through the ring and bowls over TOPPLE TILES
ST('Ib', 'Act I: the pig-iron chase');
P('mCG', 'mains', [4.6, 0, -3.4], { on: 1 });
P('coil', 'coilgun_ring', [4.64, 0, -3.0], {}, [270, 0, 0]);
W('mCG', 'out', 'coil', 'in');
P('cLedge', 'ledge', [4.9, 0.05, -3.0]);
P('cSlope', 'slope', [5.4, 0.1, -3.0], { angle: 4 }, [0, 0, 0]);
P('cPig', 'pig_iron', [5.6, 0.33, -3.0]);
for (let i = 0; i < 6; i++) P(`cTile${i}`, 'topple_tile', [3.7 - 0.1 * i, 0.075, -3.0]);
// ---- ambience: a sprong beside the brick tower; HENNY by the slam; DUSTY sweeping sand from a GRIT HOPPER
ST('IIb', 'Act II: the yard');
P('spr', 'sprong', [1.6, 0, 2.0]);
P('henny', 'henny', [-4.5, 0, 12.0], { eggs: 3 });
P('grit', 'grit_hopper', [-5.0, 0, 5.0], { capacity: 50000, rate: 5000, start: 30, open: 0 });
W('T1', 'out', 'grit', 'open');
P('dusty', 'dusty', [-6.5, 0, 7.5], { zone_w: 2.4, zone_d: 2.0, zone_x: 0.9, zone_z: -1.8 });
export const types = [...new Set(parts.map((p) => p.type))];
