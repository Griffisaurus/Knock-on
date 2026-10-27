// P5 playtest machine spec: "THE GRAND KNOCK-ON". Plain data the UI builder follows (it never injects these):
// parts in metres / degrees [yaw, pitch, roll] / prop values by key; links port → port; one TUBE path.
// Stations reuse the Library's per-part demo recipes (packages/parts-data demos) for distances and props.
import { readFileSync } from 'node:fs';
const CAT = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
const DEF = Object.fromEntries(CAT.parts.map((p) => [p.type, p]));

export const parts = []; // { key, type, pos:[x,y,z], rot:[yaw,pitch,roll], props:{}, flags, station, note }
export const links = []; // { from:[key,port], to:[key,port], via?:[[x,y,z]] }
export const tubes = []; // { key, slim, pts:[[x,y,z]] }
export const stations = [];
let ST = null;

export function station(id, name, ox, oz) { ST = { id, name, ox, oz }; stations.push(ST); }
const r3 = (v) => Math.round(v * 1000) / 1000;
/** A part at station-local x, z (y absolute). */
export function P(key, type, pos, props = {}, rot = [0, 0, 0], flags = 0) {
  if (!DEF[type]) throw new Error(`unknown type ${type}`);
  if (parts.find((p) => p.key === key)) throw new Error(`dup key ${key}`);
  parts.push({ key, type, pos: [r3(ST.ox + pos[0]), r3(Math.max(0, pos[1])), r3(ST.oz + pos[2])], rot, props, flags, station: ST.id });
  return key;
}
export function W(a, ap, b, bp, via) { links.push({ from: [a, ap], to: [b, bp], ...(via ? { via } : {}) }); }

/** Copy a Library demo at station-local (dx, dz), optionally turned 180° (yaw). skip: demo part ids to leave out. */
export function block(name, demo, dx, dz, o = {}) {
  const d = CAT.demos[demo];
  const keys = {};
  for (const q of d.parts) {
    if (o.skip?.includes(q.id)) continue;
    const def = DEF[q.type];
    const props = {};
    for (const [i, steps] of q.props ?? []) {
      const k = Object.keys(def.props)[i], s = def.props[k];
      props[k] = s.type === 'enum' || s.type === 'bool' || s.type === 'int' ? steps : +(steps * (s.step ?? 1)).toFixed(4);
    }
    Object.assign(props, o.props?.[q.id] ?? {});
    let [x, y, z] = q.pos; let rot = Array.isArray(q.rot) ? [...q.rot] : [0, 0, 0];
    if (o.move?.[q.id]) [x, y, z] = o.move[q.id];
    if (o.rot180) { x = -x; z = -z; rot[0] = ((rot[0] + 180 + 180) % 360) - 180; }
    const key = `${name}.${o.names?.[q.id] ?? `${q.type}${q.id}`}`;
    keys[q.id] = P(key, q.type, [dx + x, y, dz + z], props, rot, q.flags ?? 0);
  }
  for (const l of d.links) {
    if (!l.from || !l.to || !keys[l.from.part] || !keys[l.to.part]) continue;
    W(keys[l.from.part], l.from.port, keys[l.to.part], l.to.port);
  }
  return keys;
}

// =============================================================================================================
// S1 OVERTURE: rollers, frame and fun (row A, west). Gravity, from t = 0; the domino spine hands off to S2.
station('S1', 'Overture: rollers, frame and fun', -10, -4);
{
  // the domino spine: THUD down a SLOPE into 14 TOPPLE TILES, the last tile lands on a STOMP PAD
  const sx = 1.4, sz = 2.0;
  P('s1.spine.slope', 'slope', [sx, 0, sz], {}, [180, 0, 0]);
  P('s1.spine.thud', 'thud', [sx - 0.15, 0.4, sz]);
  for (let i = 0; i < 14; i++) P(`s1.spine.tile${i + 1}`, 'topple_tile', [sx + 0.5 + 0.1 * i, 0.075, sz]);
  P('s1.spine.pad', 'stomp_pad', [sx + 0.5 + 1.3 + 0.18, 0, sz], { weight: 0.05 });
  // a three-sided LEDGE fence round the pad, so strays from the overture can't press it again
  P('s1.fence.e', 'ledge', [sx + 0.5 + 1.3 + 0.18 + 0.2, 0.2, sz], {}, [0, 0, 90]);
  P('s1.fence.n', 'ledge', [sx + 0.5 + 1.3 + 0.18, 0.2, sz + 0.17], {}, [0, 90, 0]);
  P('s1.fence.s', 'ledge', [sx + 0.5 + 1.3 + 0.18, 0.2, sz - 0.22], {}, [0, 90, 0]);
  // a one-shot latch (a pad can be pressed again by any stray ball, and each press would toggle S2's MAINS): the pad
  // tells a FABRICATOR with a single STITCH to spawn it; it drops into a RECYCLER (goal 1, signals once) that starts S2
  P('s1.latch.fab', 'fabricator', [3.9, 0.4, 2.3], { part: 1, count: 1, interval: 0, speed: 1.0 });
  P('s1.latch.recycler', 'recycler', [3.9, 0, 2.66], { target: 1 });
  W('s1.spine.pad', 'out', 's1.latch.fab', 'spawn');
  // a TUBE chute: a STITCH starts inside its top end, rolls out onto a DING
  tubes.push({ key: 's1.tube', slim: false, pts: [[-3.6, 0.75, 2.0], [-2.6, 0.35, 2.0], [-2.0, 0.15, 2.0]].map(([x, y, z]) => [ST.ox + x, y, ST.oz + z]) });
  P('s1.tube.stitch', 'stitch', [-3.6, 0.72, 2.0]);
  P('s1.tube.ding', 'ding', [-1.65, 0.035, 2.0], { degree: 4 });
  P('s1.boing', 'boing', [-0.6, 1.0, 2.0]); // BOING demo: bounces back up
  // the grid of recipes
  block('s1.thud', 'thud', -3, -2.2);
  block('s1.stitch', 'stitch', -1.4, -2.2);
  block('s1.fuzz', 'fuzz', 0.2, -2.2);
  block('s1.glint', 'glint', 1.8, -2.2);
  block('s1.bear', 'bearing', 3.4, -2.2);
  block('s1.fulc', 'fulcrum', -3, -0.8);
  block('s1.sprong', 'sprong', -1.4, -0.8);
  block('s1.vortex', 'vortex', 0.2, -0.8);
  block('s1.ledge', 'ledge', 1.8, -0.8);
  block('s1.plank', 'plank', 3.4, -0.8);
  block('s1.pig', 'pig_iron', -4.8, -2.2);
  block('s1.helio', 'helio', -1.4, 0.6);
  block('s1.sheave', 'sheave', 0.2, 0.6);
  block('s1.anchor', 'anchor', 1.8, 0.6);
  block('s1.scoop', 'scoop', 2.8, 0.6);
  // POPPER (anchored, up in the air): a SCOOP hangs from its string and the tug pops it (the Library demo's HELIO
  // tug pops it in the headless sim but not always in the browser)
  P('s1.popper.popper', 'popper', [3.6, 0.6, 0.6], {}, [0, 0, 0], 32);
  P('s1.popper.fuzz', 'fuzz', [3.6, 0.78, 0.6]);
  P('s1.popper.scoop', 'scoop', [3.6, 0.15, 0.6]);
  W('s1.popper.scoop', 'bail', 's1.popper.popper', 'string');
  // (turned round so their balls roll west, away from the spine's STOMP PAD)
  block('s1.pins', 'pin', -2.2, -3.6, { skip: [9, 10, 11, 12], rot180: true });
  block('s1.stack', 'stacker', -0.8, -3.6, { skip: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], rot180: true });
  block('s1.pane', 'pane', 0.9, -3.6, { rot180: true });
  block('s1.vase', 'vase', 1.6, -3.6);
  block('s1.yolk', 'yolk', 2.1, -3.6);
  block('s1.quack', 'quack', 2.6, -3.6);
  block('s1.wreck', 'wrecker', 3.8, -3.6, { skip: [9, 10, 11] });
  block('s1.ding', 'ding', -3.6, -5.0);
  block('s1.tone', 'tonebars', -3.0, -5.0);
  block('s1.snap', 'snaptrap', -2.0, -5.0);
  block('s1.bump', 'bumper', -0.6, -5.0);
}

// S2 GEARS AND DRIVE (row A): the spine's STOMP PAD switches on two MAINS; a DELAY calls the LIFT, which hands off
station('S2', 'Gears and drive', -3, -4);
{
  P('s2.bus', 'delay', [-2.4, 0, 2.0], { delay: 0.2 });
  W('s1.latch.recycler', 'count', 's2.bus', 'in');
  P('s2.mainsA', 'mains', [-2.4, 0, 0.6], { on: 0 });
  P('s2.mainsB', 'mains', [-2.4, 0, -0.6], { on: 0 });
  P('s2.mainsB2', 'mains', [-2.4, 0, 1.2], { on: 0 });
  P('s2.liftDelay', 'delay', [-2.0, 0, 2.0], { delay: 4 });
  W('s2.bus', 'out', 's2.mainsA', 'in'); W('s2.bus', 'out', 's2.mainsB', 'in'); W('s2.bus', 'out', 's2.mainsB2', 'in'); W('s2.bus', 'out', 's2.liftDelay', 'in');
  const cog = block('s2.cog', 'cog', -1.0, -2.5, { skip: [1] });
  const tread = block('s2.tread', 'treadway', 1.2, -2.5, { skip: [1] });
  const got = block('s2.got', 'gotcha_box', -1.0, -1.0, { skip: [1] });
  const rack = block('s2.rack', 'rack', 1.0, -1.0, { skip: [1] });
  const spin = block('s2.spin', 'spindeck', -1.0, 0.5, { skip: [1] });
  const dyn = block('s2.dyn', 'dynamo', 1.0, 0.3, { skip: [1] });
  for (const m of [cog[2], tread[2], got[2], rack[2]]) W('s2.mainsA', 'out', m, 'in');
  for (const m of [spin[2], dyn[2]]) W('s2.mainsB', 'out', m, 'in');
  const tur = block('s2.tur', 'turbine', 2.4, -2.6, { skip: [1] });
  const lift = block('s2.lift', 'lift', 2.4, 0.9, { skip: [1, 4, 5] });
  const ram = block('s2.ram', 'ram', 0.0, 1.6, { skip: [1, 4, 5] });
  P('s2.toast', 'toast_cannon', [-1.2, 0, 1.9], { toast: 2 });
  P('s2.boostMotor', 'motor', [1.0, 0, 2.0]);
  P('s2.booster', 'glidepath_booster', [1.5, 0.3, 2.0]);
  W('s2.boostMotor', 'out', 's2.booster', 'drive');
  for (const m of [tur[3], 's2.boostMotor']) W('s2.mainsB', 'out', m, 'in');
  for (const m of [lift[2], ram[2], 's2.toast']) W('s2.mainsB2', 'out', m, 'in');
  W('s2.liftDelay', 'out', lift[2], 'call');
  W('s2.liftDelay', 'out', ram[2], 'fire');
}

// S3 LIGHT, POWER AND SIGNAL (row A): the LIFT's arrive switches on lasers and torches; a split beam lights three
// TRIPWIREs; one sends a PING to S4
station('S3', 'Light, power and signal', 2.4, -4);
{
  const L = 's2.lift.lift2';
  P('s3.mainsC', 'mains', [-2.0, 0, 2.2], { on: 0 });
  P('s3.flapDelay', 'delay', [-1.6, 0, 2.2], { delay: 1 });
  P('s3.mainsC2', 'mains', [-2.4, 0, 1.6], { on: 0 });
  W(L, 'arrive', 's3.mainsC2', 'in');
  W(L, 'arrive', 's3.mainsC', 'in'); W(L, 'arrive', 's3.flapDelay', 'in');
  const mir = block('s3.mir', 'mirror', -1.0, -2.5, { skip: [1] });
  const spl = block('s3.split', 'splitter', 1.0, -2.5, { skip: [1] });
  const lan = block('s3.lance', 'lance', -1.0, -1.0, { skip: [1] });
  // TRIPWIRE (break): a STITCH held on a FLAP drops onto a SLOPE and rolls through the beam → BANGSTICK
  const trip = block('s3.trip', 'tripwire', 1.2, -0.9, { skip: [1, 5] });
  P('s3.trip.flap', 'flap', [1.1, 0.45, -0.9 + 0.4 + 0.13], {}, [180, 0, 0]);
  P('s3.trip.stitch', 'stitch', [1.1, 0.5, -0.9 + 0.4]);
  W('s3.flapDelay', 'out', 's3.trip.flap', 'in');
  for (const l of [mir[2], spl[2], lan[2], trip[2]]) W('s3.mainsC', 'out', l, 'in');
  const tor = block('s3.torch', 'torch', -1.4, 0.6, { skip: [1, 2] });
  W(L, 'arrive', tor[3], 'in');
  const bg = block('s3.bg', 'burning_glass', 0.2, 0.7, { skip: [3, 4] });
  W(L, 'arrive', bg[2], 'in');
  const mag = block('s3.mag', 'maglock', 1.8, 0.6, { skip: [1] });
  const arc = block('s3.arc', 'arc_tower', -1.6, 1.8, { skip: [1] });
  W('s3.mainsC', 'out', mag[2], 'in'); W('s3.mainsC2', 'out', arc[2], 'in');
  // CELL → TOGGLE (flipped by a STITCH from a FLAP) → GALE blows a BOING; the CELL also lights a LAMP
  P('s3.cell', 'cell', [0.0, 0, 2.0], { capacity: 60 });
  P('s3.cellLamp', 'lamp', [0.3, 0, 2.3]);
  P('s3.toggle', 'toggle', [0.4, 0, 1.8]);
  P('s3.tgGale', 'gale', [0.8, 0, 1.8]);
  P('s3.tgBoing', 'boing', [0.8, 0.12, 2.3]);
  P('s3.tgFlap', 'flap', [0.34, 0.6, 1.8 - 0.13]);
  P('s3.tgStitch', 'stitch', [0.34, 0.65, 1.8]);
  W('s3.cell', 'out', 's3.toggle', 'in'); W('s3.cell', 'out', 's3.cellLamp', 'in'); W('s3.toggle', 'out_power', 's3.tgGale', 'in');
  W('s3.flapDelay', 'out', 's3.tgFlap', 'in');
  // the hand-off: the split beam's middle TRIPWIRE (Lit) → PING Tx (Beam) → S4's PING Rx
  P('s3.pingTx', 'ping', [2.2, 0, 2.2], { pair: 2, mode: 0 });
  W(spl[5], 'out', 's3.pingTx', 'in');
}

// S4 FIRE, HEAT AND AIR (row A, east)
station('S4', 'Fire, heat and air', 7.4, -4);
{
  P('s4.pingRx', 'ping', [-2.2, 0, 2.2], { pair: 2, mode: 1 });
  P('s4.bus', 'delay', [-1.8, 0, 2.2], { delay: 0.2 });
  W('s4.pingRx', 'out', 's4.bus', 'in');
  // FLAMER A lights a WICK whose FUSE sets off a BANGSTICK in a BRIK wall; its flame pops a tethered HELIO
  const fa = block('s4.fA', 'flamer', -1.8, -2.4, { skip: [1, 2], props: { 7: { lit: 0 } } });
  const brik = block('s4.brik', 'brik', -0.6, -2.0, { skip: [13], props: { 12: { fuse: 0.5 } } });
  W(fa[7], 'flame', brik[12], 'fuse');
  // FLAMER B → WICK → FUSE → SKYROCKET
  P('s4.fB.ledge', 'ledge', [-1.8, 0.09, -0.9]); P('s4.fB.flamer', 'flamer', [-1.8, 0.14, -0.9]);
  P('s4.fB.wick', 'wick', [-1.2, 0, -0.9], { lit: 0 });
  P('s4.rocket', 'skyrocket', [-0.9, 0.12, -0.9], { fuse: 0.3 });
  W('s4.fB.wick', 'flame', 's4.rocket', 'fuse');
  // FLAMER C → WICK → FUSE → BIG TOP fires a BOING
  P('s4.fC.ledge', 'ledge', [-1.8, 0.09, 0.3]); P('s4.fC.flamer', 'flamer', [-1.8, 0.14, 0.3]);
  P('s4.fC.wick', 'wick', [-1.2, 0, 0.3], { lit: 0 });
  P('s4.bigtop', 'big_top', [-0.6, 0, 0.6], { elevation: 45, power: 3 }, [90, 0, 0]);
  P('s4.bigtop.boing', 'boing', [-0.6, 0.22, 0.48]);
  W('s4.fC.wick', 'flame', 's4.bigtop', 'fuse');
  for (const f of [fa[4], 's4.fB.flamer', 's4.fC.flamer']) W('s4.bus', 'out', f, 'on');
  // air: MAINS D → GALE (blows a BOING, puts out a WICK), BLOWOUT (pops a HELIO), VAC (sucks a FUZZ)
  P('s4.mainsD', 'mains', [-1.4, 0, 2.2], { on: 0 });
  W('s4.bus', 'out', 's4.mainsD', 'in');
  const gale = block('s4.gale', 'gale', 0.8, -2.0, { skip: [1] });
  const blow = block('s4.blow', 'blowout', 0.8, 0.4, { skip: [1] });
  const vac = block('s4.vac', 'vac', 2.0, 0.4, { skip: [1] });
  for (const f of [gale[2], blow[2], vac[2]]) W('s4.mainsD', 'out', f, 'in');
  // INFLATOR fills a HELIO until it pops
  const inf = block('s4.inf', 'inflator', 2.2, -1.2, { skip: [3, 4, 5, 6] });
  W('s4.bus', 'out', inf[1], 'in');
  // PUFFER: a THUD held on a FLAP drops on it; the puff blows out a WICK
  P('s4.puffer', 'puffer', [0.6, 0, 1.8]);
  P('s4.pufFlap', 'flap', [0.57, 0.62, 1.8 - 0.13]);
  P('s4.pufThud', 'thud', [0.57, 0.75, 1.8]);
  P('s4.pufWick', 'wick', [1.2, 0, 1.8]);
  W('s4.bus', 'out', 's4.pufFlap', 'in');
  // bridge to the critters (row B): a DELAY
  P('s4.toS5', 'delay', [-1.4, 0, 2.6], { delay: 5 });
  W('s4.bus', 'out', 's4.toS5', 'in');
}

// S5 CONTRAPTIONS (row B, east): eight contraptions on one bus; BONKER presses THE BUTTON, which hands off to S6
station('S6', 'Contraptions', 2.4, 4);
{
  P('s5.bus', 'delay', [-1.4, 0, -2.4], { delay: 0.2 });
  W('s7.toS5', 'out', 's5.bus', 'in');
  const pun = block('s5.punch', 'punchline', -2.0, -1.2, { skip: [2, 3] });
  const snip = block('s5.snip', 'snipper', -0.6, -1.2, { skip: [4, 5] });
  const bonk = block('s5.bonk', 'bonker', 0.8, -1.4, { skip: [1, 2] });
  const fl = block('s5.fling', 'flinger', 2.2, -1.2, { skip: [1, 2] });
  const ping = block('s5.pinger', 'pinger', -2.0, 0.4, { skip: [1, 2] });
  const pad = block('s5.paddle', 'paddle', -0.8, 0.4, { skip: [1, 2] });
  const cork = block('s5.cork', 'cork_blaster', 0.4, 0.4, { skip: [3, 4] });
  const jit = block('s5.jit', 'jitterjuice', 1.8, 1.8, { skip: [1, 2] });
  W('s5.bus', 'out', pun[1], 'trigger'); W('s5.bus', 'out', snip[1], 'close'); W('s5.bus', 'out', bonk[3], 'swing');
  W('s5.bus', 'out', fl[3], 'release'); W('s5.bus', 'out', ping[3], 'fire'); W('s5.bus', 'out', pad[3], 'flip');
  W('s5.bus', 'out', cork[2], 'fire'); W('s5.bus', 'out', jit[3], 'fire');
  const zip = block('s5.zippy', 'zippy', -2.0, 1.9, { skip: [2, 3] });
  W('s7.toS5', 'out', zip[1], 'go');
}

// S6 MATTER (row B): THE BUTTON (bonked in S5) opens the hoppers, the TANK over the WATERWHEEL and the GOO VAT
station('S7', 'Matter', -3, 4);
{
  P('s6.bus', 'delay', [2.0, 0, -2.4], { delay: 0.3 });
  W('s5.bonk.the_button4', 'out', 's6.bus', 'in');
  P('s6.grit', 'grit_hopper', [1.2, 0, -1.4], { capacity: 100000, rate: 20000, start: 100 });
  const ww = block('s6.ww', 'waterwheel', -0.4, -1.4, { skip: [4, 5], props: { 1: { flow: 1.5, start: 100 } } });
  P('s6.wwCog', 'cog', [0.05, 0.2, -1.4 + 0.25], { size: 1 });
  W(ww[3], 'axle', 's6.wwCog', 'axle');
  P('s6.marbles', 'marble_hopper', [-1.8, 0, -1.4], { capacity: 3000, rate: 600, start: 100 });
  const goo = block('s6.goo', 'goo_vat', 1.0, 0.4, { props: { 1: { flow: 0.6, start: 60, open: 0 } } });
  W('s6.bus', 'out', 's6.grit', 'open'); W('s6.bus', 'out', ww[1], 'open'); W('s6.bus', 'out', 's6.marbles', 'open'); W('s6.bus', 'out', goo[1], 'open');
  // SPONGE: a THUD on a FLAP drops on the soaked SPONGE; SPRINKLE CAN: a STITCH on a FLAP tips it
  P('s6.sponge', 'sponge', [-1.0, 0.05, 1.0], { start: 100 });
  P('s6.spFlap', 'flap', [-1.0, 0.55, 1.0 - 0.13]); P('s6.spThud', 'thud', [-1.0, 0.68, 1.0]);
  P('s6.can', 'sprinkle_can', [-2.0, 0, 1.0], { start: 100 });
  P('s6.canFlap', 'flap', [-2.1, 0.6, 1.0 - 0.13]); P('s6.canStitch', 'stitch', [-2.1, 0.65, 1.0]);
  W('s6.bus', 'out', 's6.spFlap', 'in'); W('s6.bus', 'out', 's6.canFlap', 'in');
  // DUSTY patrols round the marble hopper and sweeps up what spills
  P('s6.dusty', 'dusty', [-1.8, 0, -0.2], { zone_w: 2.0, zone_d: 1.6, zone_x: 0, zone_z: -0.6 });
  // HOURGLASS: the timer that wakes the critters (S7)
  P('s6.hourglass', 'hourglass', [-2.4, 0, -2.4], { duration: 28 });
}

// S7 CRITTERS (row B): a BANGSTICK's boom wakes BISCUIT, startles HENNY and BANDIT; FLAPs drop balls on PIP's wheel
// and on GOBY's bowl; a SNIPPER drops the TRAP BOX on a sleeping MOCHI
station('S5', 'Critters', 7.4, 4);
{
  P('s7.bus', 'delay', [2.4, 0, -2.4], { delay: 0.2 });
  W('s4.toS5', 'out', 's7.bus', 'in');
  P('s7.boom', 'bangstick', [0.4, 0.04, -0.6], { fuse: 0.5 });
  W('s7.bus', 'out', 's7.boom', 'detonator');
  // BANDIT sits on the PEDAL RIG (startled, he pedals: BAND → COG); later the TRAP BOX drops over him
  P('s7.pedal', 'pedal_rig', [-2.0, 0, -0.6]);
  P('s7.bandit', 'bandit', [-2.0, 0.18, -0.6]);
  P('s7.pedalCog', 'cog', [-2.0, 0.3, 0.15]);
  W('s7.pedal', 'out', 's7.pedalCog', 'axle');
  const trap = block('s7.trap', 'trap_box', -2.0, -0.6, { skip: [6, 7, 9], move: { 1: [0, 0.8, 0], 2: [0, 1.6, 0], 4: [-0.12, 1.4, 0], 5: [-0.08, 1.45, 0] } });
  P('s7.snipDelay', 'delay', [2.0, 0, -2.4], { delay: 4 });
  W('s7.bus', 'out', 's7.snipDelay', 'in'); W('s7.snipDelay', 'out', trap[5], 'close');
  // BISCUIT sleeps till the boom, then chases MOCHI; HENNY, startled, lays a YOLK
  P('s7.biscuit', 'biscuit', [1.8, 0, 0.4]);
  P('s7.mochi', 'mochi', [-1.8, 0, 1.8]);
  P('s7.henny', 'henny', [2.0, 0, 2.3]);
  // PIP naps in the HAMSTER DRIVE till a BOING (from a FLAP) bumps it; GOBY's FISHBOWL is smashed by a THUD
  const ham = block('s7.ham', 'hamster_drive', -0.8, -2.2, { move: { 3: [-0.08, 0.75, -0.05] } });
  P('s7.hamFlap', 'flap', [-0.88, 0.62, -2.2 - 0.05 - 0.13]);
  W('s7.bus', 'out', 's7.hamFlap', 'in');
  const fish = block('s7.fish', 'fishbowl', -0.4, 1.6, { move: { 4: [0.78, 0.68, 0] } });
  P('s7.fishFlap', 'flap', [0.38, 0.55, 1.6 - 0.13]);
  W('s7.bus', 'out', 's7.fishFlap', 'in');
  P('s7.ringer', 'ringer', [1.0, 0, -1.4], { time: 12.5 });
  P('s7.toS5', 'delay', [1.6, 0, -2.4], { delay: 6 });
  W('s7.bus', 'out', 's7.toS5', 'in');
}

// S8 FUTURE TECH FINALE (row B, west): everything powers up; FABRICATOR feeds the RECYCLER, whose goal drops a THUD
// on the T-PLUNGER (POWDER KEGs, BANGSTICKs), lights the SKYSHOW and arms the SINGULARITY
station('S8', 'Future Tech finale', -10, 4);
{
  P('s8.bus', 'delay', [3.4, 0, -2.4], { delay: 0.2 });
  W('s6.hourglass', 'out', 's8.bus', 'in');
  P('s8.mainsE', 'mains', [3.0, 0, -2.4], { on: 0 });
  P('s8.mainsF', 'mains', [0.6, 0, -1.6], { on: 1 });
  W('s8.bus', 'out', 's8.mainsE', 'in'); W('s8.bus', 'out', 's8.mainsF', 'in');
  const gw = block('s8.grav', 'grav_well', 2.6, 3.8, { skip: [1] });
  P('s8.mainsG', 'mains', [1.4, 0, 4.4], { on: 0 });
  W('s8.mainsG', 'out', gw[2], 'in');
  P('s8.mainsE2', 'mains', [3.0, 0, -2.0], { on: 0 });
  W('s8.bus', 'out', 's8.mainsE2', 'in');
  const tr = block('s8.tract', 'tractor_beam', 1.4, -2.2, { skip: [1] });
  const hov = block('s8.hover', 'hover_pad', 0.0, -2.0, { skip: [1, 4] });
  const coil = block('s8.coil', 'coilgun_ring', 2.6, 1.0, { skip: [1] });
  P('s8.coilWall', 'force_wall', [2.85, 0, 1.0], { width: 0.3, height: 0.5, start: 1 }, [90, 0, 0]);
  for (const f of [tr[2], hov[2]]) W('s8.mainsE', 'out', f, 'in');
  W('s8.mainsE2', 'out', coil[2], 'in');
  W('s8.bus', 'out', 's8.coilWall', 'toggle');
  // STASIS FIELD (MAINS F on at start): a BOING and a STITCH hang frozen until the bus switches MAINS F off
  const st = block('s8.stasis', 'stasis_field', 0.6, -0.4, { skip: [1, 3] });
  W('s8.mainsF', 'out', st[2], 'in');
  // FORCE WALL holds a STITCH on a SLOPE until the bus switches it off
  const fw = block('s8.fw', 'force_wall', -1.2, -2.0, { skip: [4] });
  W('s8.bus', 'out', fw[1], 'toggle');
  // RIFT GATES: a STITCH on a flat FORCE WALL drops into the lying gate and shoots out of its twin into TOPPLE TILES
  const rift = block('s8.rift', 'rift_gate', -3.4, -0.4, { move: { 3: [0, 0.75, 0] } });
  // (a STASIS FIELD hold doesn't work here: a released STITCH bounces off the gate; see the playtest log) so a
  // FORCE WALL laid flat (pitch −90) is the shelf
  P('s8.riftWall', 'force_wall', [-3.4, 0.65, -0.4 + 0.15], { width: 0.3, height: 0.3, start: 1 }, [0, -90, 0]);
  W('s8.bus', 'out', 's8.riftWall', 'toggle');
  // BUZZ fetches a tagged STITCH to its beacon
  const bz = block('s8.buzz', 'buzz', -1.4, 1.0, { skip: [3, 4] });
  W('s8.bus', 'out', bz[1], 'call');
  // GRABBER (power from MAINS E) picks a STITCH up and puts it down
  const gr = block('s8.grab', 'grabber', 0.2, 1.4, { skip: [1] });
  W('s8.mainsE', 'out', gr[2], 'in');
  P('s8.goDelay', 'delay', [3.4, 0, -2.0], { delay: 1 });
  W('s8.bus', 'out', 's8.goDelay', 'in'); W('s8.goDelay', 'out', gr[2], 'go');
  // ZONE (antigrav) lifts two BOINGs
  block('s8.zone', 'zone', -3.4, 1.4);
  // FABRICATOR → RECYCLER (goal 3) → the finale bus
  P('s8.fab', 'fabricator', [1.0, 0.4, 2.0], { part: 1, count: 5, interval: 0, speed: 1.0 });
  P('s8.recycler', 'recycler', [1.0, 0, 2.36], { target: 1 });
  P('s8.fabDelay', 'delay', [3.4, 0, -1.6], { delay: 5 });
  W('s8.goDelay', 'out', 's8.fabDelay', 'in'); W('s8.fabDelay', 'out', 's8.fab', 'spawn');
  P('s8.finale', 'delay', [-0.2, 0, 2.8], { delay: 0.3 });
  W('s8.recycler', 'count', 's8.finale', 'in');
  // the big boom: a THUD on a FLAP drops onto the T-PLUNGER, wired to two POWDER KEGs and three BANGSTICKs
  P('s8.plunger', 't_plunger', [-2.0, 0, 2.6]);
  P('s8.plFlap', 'flap', [-2.0, 0.8, 2.6 - 0.13]); P('s8.plThud', 'thud', [-2.0, 0.93, 2.6]);
  W('s8.finale', 'out', 's8.plFlap', 'in'); W('s8.finale', 'out', 's8.mainsG', 'in');
  P('s8.keg1', 'powder_keg', [-3.0, 0.15, 2.4]); P('s8.keg2', 'powder_keg', [-3.0, 0.15, 2.9]);
  P('s8.bang1', 'bangstick', [-2.6, 0.04, 3.4]); P('s8.bang2', 'bangstick', [-2.0, 0.04, 3.4]); P('s8.bang3', 'bangstick', [-1.4, 0.04, 3.4]);
  for (const k of ['s8.keg1', 's8.keg2', 's8.bang1', 's8.bang2', 's8.bang3']) W('s8.plunger', 'out', k, 'detonator');
  // SKYSHOW: FLAMER F lights a WICK → FUSE → fireworks
  P('s8.fF.ledge', 'ledge', [-0.6, 0.09, 3.6]); P('s8.fF.flamer', 'flamer', [-0.6, 0.14, 3.6]);
  P('s8.fF.wick', 'wick', [0.0, 0, 3.6], { lit: 0 });
  P('s8.skyshow', 'skyshow', [0.3, 0, 3.9], { altitude: 8, pattern: 1 });
  W('s8.finale', 'out', 's8.fF.flamer', 'on'); W('s8.fF.wick', 'flame', 's8.skyshow', 'fuse');
  // SINGULARITY: armed 3 s after the boom, it swallows the lot
  P('s8.singDelay', 'delay', [0.2, 0, 2.8], { delay: 3 });
  P('s8.singularity', 'singularity', [-1.0, 0, 5.0]);
  W('s8.finale', 'out', 's8.singDelay', 'in'); W('s8.singDelay', 'out', 's8.singularity', 'arm');
}

export const types = [...new Set(parts.map((p) => p.type))];
