// C4 (M4): the Cascade Report's share card (GAME_SPEC §17.4, UI_UX §4.9 "Share card (image)"): a 1600 × 900 PNG of the
// current view, rendered at full quality, with the run's score, title tier, longest chain and stats set over it in
// the Glass Lab type (Unbounded, Inter, JetBrains Mono).

import { CASCADE_CHANNEL_HEX, type CascadeReport } from '../cascade.ts';

export interface CardInfo {
  partName(id: number): string;
  worldTitle: string;
  runLabel: string;
  tickRate: number;
}

export const CARD_W = 1600, CARD_H = 900;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Composes the card over `scene` (a CARD_W × CARD_H render) and returns a PNG. */
export async function composeCard(scene: Blob, r: CascadeReport, info: CardInfo): Promise<Blob> {
  try {
    await Promise.all(['900 40px Unbounded', '500 20px Inter', '700 40px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
  } catch { /* system fallbacks */ }
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext('2d')!;
  const img = await createImageBitmap(scene);
  g.drawImage(img, 0, 0, CARD_W, CARD_H);
  img.close();
  // legibility: a warm-dark wash from the left and the bottom
  const gl = g.createLinearGradient(0, 0, CARD_W * 0.62, 0);
  gl.addColorStop(0, 'rgba(11,13,18,0.82)'); gl.addColorStop(1, 'rgba(11,13,18,0)');
  g.fillStyle = gl; g.fillRect(0, 0, CARD_W, CARD_H);
  const gb = g.createLinearGradient(0, CARD_H * 0.55, 0, CARD_H);
  gb.addColorStop(0, 'rgba(11,13,18,0)'); gb.addColorStop(1, 'rgba(11,13,18,0.86)');
  g.fillStyle = gb; g.fillRect(0, 0, CARD_W, CARD_H);
  const paper = '#EEF1F6', text2 = '#C9CFDB', ignition = '#FF5B2E';
  g.textBaseline = 'alphabetic';
  // wordmark
  g.fillStyle = paper; g.font = '900 40px Unbounded, system-ui, sans-serif';
  g.fillText('KNOCK-ON', 64, 92);
  const wm = g.measureText('KNOCK-ON').width;
  g.fillStyle = ignition; g.beginPath(); g.arc(64 + wm + 18, 78, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = text2; g.font = '500 22px Inter, system-ui, sans-serif';
  g.fillText([info.worldTitle, info.runLabel].filter(Boolean).join(' · '), 64, 130);
  // score
  g.fillStyle = text2; g.font = '700 20px Inter, system-ui, sans-serif';
  g.fillText('OVERREACTION SCORE', 64, 250);
  g.fillStyle = paper; g.font = '700 132px "JetBrains Mono", ui-monospace, monospace';
  g.fillText(r.score.toLocaleString('en-US'), 58, 380);
  g.fillStyle = ignition; g.font = '900 52px Unbounded, system-ui, sans-serif';
  g.fillText(r.title, 64, 450);
  // stats
  const secs = (t: number): string => `${(t / info.tickRate).toFixed(1)} s`;
  const stats: [string, string][] = [['K.O.', String(r.ko)], ['RUN TIME', secs(r.runTicks)], ['PARTS USED', `${r.partsUsed} / ${r.partsTotal}`], ['PEAK', `${r.peak} at once`]];
  let sx = 64;
  for (const [k, v] of stats) {
    g.fillStyle = text2; g.font = '700 16px Inter, system-ui, sans-serif'; g.fillText(k, sx, 520);
    g.fillStyle = paper; g.font = '700 34px "JetBrains Mono", ui-monospace, monospace'; g.fillText(v, sx, 562);
    sx += Math.max(170, g.measureText(v).width + 48);
  }
  // longest chain: chips joined by channel-coloured arrows
  const chain = r.chain.slice(0, 7);
  if (chain.length) {
    g.fillStyle = text2; g.font = '700 16px Inter, system-ui, sans-serif';
    g.fillText(`LONGEST CHAIN · ${r.chain.length} LINK${r.chain.length === 1 ? '' : 'S'}`, 64, 712);
    let x = 64;
    const y = 736, ch = 64;
    for (let i = 0; i < chain.length; i++) {
      const s = chain[i]!;
      if (s.via) {
        const col = CASCADE_CHANNEL_HEX[s.via];
        g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x + 4, y + ch / 2); g.lineTo(x + 30, y + ch / 2); g.stroke();
        g.beginPath(); g.moveTo(x + 24, y + ch / 2 - 8); g.lineTo(x + 34, y + ch / 2); g.lineTo(x + 24, y + ch / 2 + 8); g.stroke();
        x += 44;
      }
      const name = info.partName(s.part);
      g.font = '800 20px Unbounded, system-ui, sans-serif';
      const w = Math.max(110, g.measureText(name).width + 36);
      if (x + w > CARD_W - 48) {
        g.fillStyle = text2; g.font = '700 24px Inter, system-ui, sans-serif'; g.fillText('…', x, y + 42);
        break;
      }
      roundRect(g, x, y, w, ch, 14);
      g.fillStyle = 'rgba(16,19,26,0.72)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = paper; g.fillText(name, x + 18, y + 30);
      g.fillStyle = text2; g.font = '700 16px "JetBrains Mono", ui-monospace, monospace'; g.fillText(secs(s.tick), x + 18, y + 52);
      x += w;
    }
  } else {
    g.fillStyle = text2; g.font = '500 24px Inter, system-ui, sans-serif';
    g.fillText('Nothing knocked on anything. Yet.', 64, 760);
  }
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The share card could not be encoded.');
  return blob;
}
