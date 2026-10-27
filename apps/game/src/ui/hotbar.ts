// Hotbar slots 1–0 and favourites (UI_UX §4.3, §4.4): per viewer, persisted in localStorage. The first
// ten tray tiles in "All parts" are the hotbar; drag a part onto one to assign it, right-click clears.

export const HOTBAR_SIZE = 10;

export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

const memory = (): KeyValueStore => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const browserStore = (): KeyValueStore => {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* private mode */ }
  return memory();
};

export class Hotbar {
  /** Part type per slot (index 0 = key 1 … index 9 = key 0), null = empty. */
  readonly slots: (string | null)[];
  readonly favourites: Set<string>;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly defaults: readonly string[], private readonly known: (type: string) => boolean = () => true,
    private readonly store: KeyValueStore = browserStore()) {
    this.slots = this.loadSlots();
    this.favourites = new Set(this.read<string[]>('kn.favourites', []).filter((t) => typeof t === 'string' && known(t)));
  }

  on(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Type bound to key index i (0 = key 1). */
  typeAt(i: number): string | null { return this.slots[i] ?? null; }

  /** Slot index of a part type, or -1. */
  slotOf(type: string): number { return this.slots.indexOf(type); }

  /** Key label for a slot index: 1…9, then 0. */
  static keyOf(i: number): string { return String((i + 1) % 10); }

  /** Key index for a pressed digit: '1' → 0 … '0' → 9. */
  static indexOfKey(k: string): number { return k >= '0' && k <= '9' && k.length === 1 ? (Number(k) + 9) % 10 : -1; }

  /** Put a part in slot i. If it was already in another slot, the two swap. */
  assign(i: number, type: string): void {
    if (i < 0 || i >= HOTBAR_SIZE || !this.known(type)) return;
    const was = this.slots.indexOf(type);
    if (was === i) return;
    if (was >= 0) this.slots[was] = this.slots[i] ?? null;
    this.slots[i] = type;
    this.save();
  }

  clear(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE || this.slots[i] === null) return;
    this.slots[i] = null;
    this.save();
  }

  reset(): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) this.slots[i] = this.defaults[i] ?? null;
    this.save();
  }

  toggleFavourite(type: string): boolean {
    if (this.favourites.has(type)) this.favourites.delete(type); else if (this.known(type)) this.favourites.add(type);
    this.store.setItem('kn.favourites', JSON.stringify([...this.favourites]));
    this.emit();
    return this.favourites.has(type);
  }

  private loadSlots(): (string | null)[] {
    const saved = this.read<unknown>('kn.hotbar', null);
    const out: (string | null)[] = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const v = Array.isArray(saved) ? saved[i] : undefined;
      out.push(Array.isArray(saved) ? (typeof v === 'string' && this.known(v) ? v : null) : this.defaults[i] ?? null);
    }
    // a type may appear once only
    out.forEach((t, i) => { if (t && out.indexOf(t) !== i) out[i] = null; });
    return out;
  }

  private read<T>(key: string, fallback: T): T {
    try { const raw = this.store.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
  }

  private save(): void {
    try { this.store.setItem('kn.hotbar', JSON.stringify(this.slots)); } catch { /* session only */ }
    this.emit();
  }

  private emit(): void { for (const fn of this.listeners) fn(); }
}
