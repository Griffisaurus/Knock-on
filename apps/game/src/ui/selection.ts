// Multi-selection shared by the 3D view, the Outliner and the Inspector. Holds part and link ids;
// `primary` is the part the Inspector shows (main.ts's `selectedId` mirrors it).

export class Selection {
  private readonly set = new Set<number>();
  /** The last part picked: Inspector target and soft-lock holder. */
  primary: number | null = null;
  /** Anchor for Shift+click ranges in the Outliner. */
  anchor: number | null = null;
  private readonly listeners = new Set<() => void>();
  private quiet = 0;

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void { if (!this.quiet) for (const fn of this.listeners) fn(); }

  get size(): number { return this.set.size; }
  has(id: number): boolean { return this.set.has(id); }
  ids(): number[] { return [...this.set].sort((a, b) => a - b); }

  /** Replace the selection. `primary` defaults to the first part id given. */
  replace(ids: Iterable<number>, primary?: number | null, isPart: (id: number) => boolean = () => true): void {
    const next = [...ids];
    const same = next.length === this.set.size && next.every((id) => this.set.has(id));
    const p = primary !== undefined ? primary : next.find(isPart) ?? null;
    if (same && p === this.primary) return;
    this.set.clear();
    for (const id of next) this.set.add(id);
    this.primary = p;
    this.anchor = next.at(-1) ?? null;
    this.emit();
  }

  toggle(id: number, isPart: (id: number) => boolean = () => true): void {
    if (this.set.has(id)) {
      this.set.delete(id);
      if (this.primary === id) this.primary = [...this.set].find(isPart) ?? null;
    } else {
      this.set.add(id);
      if (isPart(id)) this.primary = id;
    }
    this.anchor = id;
    this.emit();
  }

  clear(): void {
    if (!this.set.size && this.primary === null) return;
    this.set.clear();
    this.primary = null;
    this.anchor = null;
    this.emit();
  }

  /** Drop ids that no longer exist (after remote edits or undo). */
  prune(exists: (id: number) => boolean, isPart: (id: number) => boolean): void {
    let changed = false;
    for (const id of [...this.set]) if (!exists(id)) { this.set.delete(id); changed = true; }
    if (this.primary !== null && !this.set.has(this.primary)) { this.primary = [...this.set].find(isPart) ?? null; changed = true; }
    if (changed) this.emit();
  }

  /** Run `fn` without notifying, then notify once. */
  batch(fn: () => void): void {
    this.quiet++;
    try { fn(); } finally { this.quiet--; }
    this.emit();
  }
}
