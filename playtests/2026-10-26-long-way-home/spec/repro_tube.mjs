// REPRO 2 (suspected bug: a ball bounces off the TUBE rim). Warehouse. A 6 m TUBE (z 0..6) per case, a BOING (r 0.12) pushed in by a floor GALE
// 1.2 m behind the mouth (case F*). The tube's centreline height y is the variable: bore is 0.288 m, floor-flush is y = 0.15.
// Run: PRESET=warehouse SPEC=repro_tube.mjs POS="^ball" node sim.ts 8 "." "^ball"      (prints each ball every 0.5 s: x,y,z)
export const parts = [], links = [], tubes = [], stations = [];
const P = (key, type, pos, props = {}, rot = [0, 0, 0], flags = 0) => parts.push({ key, type, pos, rot, props, flags, station: '' });
const W = (a, ap, b, bp) => links.push({ from: [a, ap], to: [b, bp] });
[0.15, 0.17, 0.20, 0.25].forEach((y, i) => {
  const x = i * 3;
  P(`mF${i}`, 'mains', [x - 0.6, 0, -1.9], { on: 1 }); P(`gF${i}`, 'gale', [x, 0, -2.4]); W(`mF${i}`, 'out', `gF${i}`, 'in');
  P(`ballF${i}_y${y}`, 'boing', [x, 0.122, -1.2]);
  tubes.push({ key: `tF${i}`, slim: false, pts: [[x, y, 0], [x, y, 3], [x, y, 6]] });
});
export const types = [...new Set(parts.map((p) => p.type))];
