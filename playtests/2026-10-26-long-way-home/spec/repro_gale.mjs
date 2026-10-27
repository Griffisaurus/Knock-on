// REPRO 1 (suspected bug: GALE does not push a BOING). Warehouse, MAINS (on) -> GALE (air 100%), balls 0.3 / 0.6 / 1.2 m in front of the nozzle.
// A = gale on the floor (y 0, flat, as first tried); B = gale overhead (y 0.5, pitched 15 deg down, as used in THE LONG WAY HOME).
// Run: PRESET=warehouse SPEC=repro_gale.mjs node sim.ts 6      (prints "moved N@t" per ball)
export const parts = [], links = [], tubes = [], stations = [];
const P = (key, type, pos, props = {}, rot = [0, 0, 0], flags = 0) => parts.push({ key, type, pos, rot, props, flags, station: '' });
const W = (a, ap, b, bp) => links.push({ from: [a, ap], to: [b, bp] });
let row = 0;
for (const [mode, gy, pitch] of [['A', 0.0, 0], ['B', 0.5, 15]]) for (const type of ['boing', 'stitch', 'fuzz']) for (const d of [0.3, 0.6, 1.2]) {
  const x = (row++) * 3, r = { boing: 0.12, stitch: 0.037, fuzz: 0.033 }[type];
  P(`m${row}`, 'mains', [x - 0.6, 0, 0], { on: 1 }); P(`g${row}`, 'gale', [x, gy, 0], {}, [0, pitch, 0]); W(`m${row}`, 'out', `g${row}`, 'in');
  P(`${mode}_${type}_${d}`, type, [x, r + 0.002, d]);
}
export const types = [...new Set(parts.map((p) => p.type))];
