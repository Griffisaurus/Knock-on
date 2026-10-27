// Writes the benchmark scenes as shipped demo worlds (PRODUCTION §2 M3: "ship both as demo worlds"):
//   apps/game/bench/demos/kiloton.knockon, domino_day.knockon   (import: Lobby upload, or POST /share then /import)
//   apps/game/bench/demos/links.json                             (inline #m= share links when they fit in 12 KB)
//   node --disable-warning=ExperimentalWarning apps/game/bench/make-demos.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeWorld, inlineLink, worldHash } from '@knockon/format';
import { dominoDay, kiloton } from './scenes.ts';

const dir = fileURLToPath(new URL('./demos/', import.meta.url));
mkdirSync(dir, { recursive: true });
const links: Record<string, unknown> = {};
for (const [name, w] of [['kiloton', kiloton()], ['domino_day', dominoDay()]] as const) {
  const bytes = encodeWorld(w);
  writeFileSync(`${dir}${name}.knockon`, bytes);
  const frag = inlineLink(w, { cam: 'director' });
  links[name] = { title: w.title, parts: w.parts.length, bytes: bytes.length, worldHash: worldHash(w), link: frag ? `/#${frag}` : null };
  console.log(`${name}: ${w.parts.length} parts, ${bytes.length} B file, inline link ${frag ? `${frag.length} chars` : 'too big (share through the host)'}`);
}
writeFileSync(`${dir}links.json`, JSON.stringify(links, null, 1));
