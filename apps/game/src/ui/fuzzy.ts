// Command palette matching (UI_UX §4.6): prefixes (`>` actions, `@` parts in the scene, `?` help),
// fuzzy subsequence scoring with the matched letters for highlighting, and grouped results.

export type PaletteGroup = 'Recent' | 'Actions' | 'Parts' | 'Parts in scene' | 'Settings' | 'Help';
export const GROUP_ORDER: readonly PaletteGroup[] = ['Recent', 'Actions', 'Parts in scene', 'Parts', 'Settings', 'Help'];

export interface Query { readonly scope: 'all' | 'actions' | 'scene' | 'help'; readonly text: string }

export function parseQuery(raw: string): Query {
  const t = raw.trimStart();
  const scope = t.startsWith('>') ? 'actions' : t.startsWith('@') ? 'scene' : t.startsWith('?') ? 'help' : 'all';
  return { scope, text: (scope === 'all' ? t : t.slice(1)).trim().toLowerCase() };
}

export interface Match { readonly score: number; readonly hits: readonly number[] }

/**
 * Score `label` against a lower-case query: a prefix beats a word start beats a substring beats a
 * subsequence. Returns null when it doesn't match. `hits` are the matched character indices.
 */
export function fuzzy(label: string, q: string): Match | null {
  if (!q) return { score: 1, hits: [] };
  const t = label.toLowerCase();
  const at = t.indexOf(q);
  if (at === 0) return { score: 400 - t.length * 0.01, hits: range(0, q.length) };
  if (at > 0) {
    const wordStart = /[\s:(›·-]/.test(t[at - 1]!);
    return { score: (wordStart ? 300 : 200) - at * 0.1, hits: range(at, at + q.length) };
  }
  // subsequence, preferring runs and word starts
  const hits: number[] = [];
  let i = 0, score = 100;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      if (hits.length && hits.at(-1) === j - 1) score += 4;
      if (j === 0 || /[\s:(›·-]/.test(t[j - 1]!)) score += 3;
      hits.push(j);
      i++;
    }
  }
  if (i < q.length) return null;
  const spread = hits.at(-1)! - hits[0]!;
  if (spread > q.length * 3) return null; // letters scattered across the label: noise, not a match
  return { score: score - spread * 0.5, hits };
}

/** Split a label into plain and highlighted runs (for <b> wrapping). */
export function highlightRuns(label: string, hits: readonly number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < label.length; i++) {
    const hit = set.has(i);
    const last = out.at(-1);
    if (last && last.hit === hit) last.text += label[i]; else out.push({ text: label[i]!, hit });
  }
  return out;
}

export interface Candidate { readonly label: string; readonly group: PaletteGroup; readonly keywords?: string }

/** Filter and order candidates for a query: best score first inside each group, groups in GROUP_ORDER. */
export function rank<T extends Candidate>(items: readonly T[], raw: string, limit = 14): { item: T; match: Match }[] {
  const q = parseQuery(raw);
  const allowed = (g: PaletteGroup): boolean =>
    q.scope === 'all' ? true : q.scope === 'actions' ? g === 'Actions' || g === 'Settings' : q.scope === 'scene' ? g === 'Parts in scene' : g === 'Help';
  const scored: { item: T; match: Match }[] = [];
  for (const item of items) {
    if (!allowed(item.group)) continue;
    if (!q.text && q.scope === 'all' && item.group === 'Parts in scene') continue; // only on demand
    let m = fuzzy(item.label, q.text);
    if (!m && item.keywords) { const k = fuzzy(item.keywords, q.text); if (k) m = { score: k.score - 50, hits: [] }; }
    if (m) scored.push({ item, match: m });
  }
  scored.sort((a, b) => b.match.score - a.match.score);
  const top = scored.slice(0, limit);
  return top.sort((a, b) => GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || b.match.score - a.match.score);
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);
