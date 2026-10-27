// MI (M4): writes the full rigid + Matter "Sandstorm" world as a demo (Lobby upload, or POST /share then /import):
//   apps/game/bench/demos/sandstorm.knockon        4 lanes × 1M grains (the 16 GB tier's 4M)
//   apps/game/bench/demos/sandstorm_small.knockon  4 lanes × 50k grains (any tier: a quick look)
//   node --disable-warning=ExperimentalWarning apps/game/bench/make-sandstorm.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeWorld } from '@knockon/format';
import { sandstormWorld } from './scenes.ts';

const dir = fileURLToPath(new URL('./demos/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, w] of [['sandstorm', sandstormWorld()], ['sandstorm_small', { ...sandstormWorld({ capacity: 50000, rate: 20000 }), title: 'Sandstorm (small)' }]] as const) {
  const bytes = encodeWorld(w);
  writeFileSync(`${dir}${name}.knockon`, bytes);
  console.log(`${name}: ${w.parts.length} parts, ${w.grains?.toLocaleString('en-US')} grains, ${bytes.length} B`);
}
