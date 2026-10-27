// Accessibility plumbing (M4 stream U4; GAME_SPEC §20, UI_UX §7, WCAG 2.2 AA):
//   • the announcer: two visually hidden ARIA live regions (polite, assertive), rate-limited, so screen
//     readers hear run starts and stops, captions, keyboard-building feedback and toasts without a flood;
//   • focus helpers: the focusable elements of a container, a focus trap for modals that restores focus to
//     the opener on close, and roving tabindex + arrow keys for tab lists, segments and listboxes.
// The pure part (AnnounceQueue) is unit-tested in test/a11y.test.ts.

export type Politeness = 'polite' | 'assertive';

/**
 * Rate limiter for live-region text. Screen readers drop or garble text replaced faster than they speak,
 * so messages are queued and released at most one per `gapMs` (assertive ones jump the queue), repeats of
 * the same text inside `dedupeMs` are dropped, and the queue keeps only the newest `max` messages.
 */
export class AnnounceQueue {
  private q: { text: string; level: Politeness }[] = [];
  private lastAt = -Infinity;
  private readonly recent = new Map<string, number>();
  constructor(readonly gapMs = 700, readonly dedupeMs = 2500, readonly max = 4) {}

  push(text: string, level: Politeness, now: number): void {
    const t = text.trim();
    if (!t) return;
    const seen = this.recent.get(t);
    if (seen !== undefined && now - seen < this.dedupeMs) return;
    this.recent.set(t, now);
    if (this.recent.size > 64) for (const [k, at] of this.recent) if (now - at > this.dedupeMs) this.recent.delete(k);
    if (level === 'assertive') this.q.unshift({ text: t, level });
    else this.q.push({ text: t, level });
    if (this.q.length > this.max) this.q = this.q.slice(0, this.max);
  }

  /** The next message to speak now, or null (nothing queued, or too soon after the last one). */
  take(now: number): { text: string; level: Politeness } | null {
    if (!this.q.length || now - this.lastAt < this.gapMs) return null;
    this.lastAt = now;
    return this.q.shift()!;
  }

  get size(): number { return this.q.length; }
}

let regions: { polite: HTMLElement; assertive: HTMLElement } | null = null;
const queue = new AnnounceQueue();
let timer = 0;

function ensureRegions(): { polite: HTMLElement; assertive: HTMLElement } | null {
  if (regions || typeof document === 'undefined') return regions;
  const mk = (level: Politeness): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'sr-only';
    el.id = `kn-live-${level}`;
    el.setAttribute('aria-live', level);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', level === 'assertive' ? 'alert' : 'status');
    document.body.appendChild(el);
    return el;
  };
  regions = { polite: mk('polite'), assertive: mk('assertive') };
  return regions;
}

function pump(): void {
  timer = 0;
  const r = ensureRegions();
  if (!r) return;
  const now = performance.now();
  const m = queue.take(now);
  if (m) {
    const el = r[m.level];
    // clear then set on the next frame so a repeated text is read again
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = m.text; });
  }
  if (queue.size) timer = window.setTimeout(pump, queue.gapMs);
}

/** Say something to screen-reader users (visually hidden). Rate-limited and de-duplicated. */
export function announce(text: string, level: Politeness = 'polite'): void {
  if (typeof document === 'undefined') return;
  queue.push(text, level, performance.now());
  if (!timer) timer = window.setTimeout(pump, 0);
}

// ---- focus -------------------------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable, visible elements inside `root`, in DOM order. */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const e = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
    return e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : el.offsetParent !== null;
  });
}

/**
 * Keep Tab / Shift+Tab inside `el` while `active()` is true (a modal dialog), and give focus back to
 * whatever had it when the trap opened. Call `opened()` when the dialog shows and `closed()` when it hides.
 */
export function trapFocus(el: HTMLElement, active: () => boolean): { opened(): void; closed(): void } {
  let opener: HTMLElement | null = null;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !active()) return;
    const list = focusables(el);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0]!, last = list.at(-1)!;
    const cur = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (cur === first || !el.contains(cur))) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (cur === last || !el.contains(cur))) { first.focus(); e.preventDefault(); }
    e.stopPropagation();
  });
  return {
    opened() { const a = document.activeElement as HTMLElement | null; opener = a && a !== document.body && !el.contains(a) ? a : null; },
    closed() { const o = opener; opener = null; if (o && o.isConnected && el.contains(document.activeElement)) o.focus(); else if (o && o.isConnected && document.activeElement === document.body) o.focus(); },
  };
}

/**
 * Roving tabindex for a composite widget (tab list, segment, radio group, listbox): one Tab stop, the
 * arrow keys (and Home / End) move between items, and Enter / Space activate the focused item (buttons
 * already click on those keys). `items` is re-queried on every key so the container can re-render freely.
 */
export function rovingFocus(container: HTMLElement, opts: { selector?: string; orientation?: 'horizontal' | 'vertical' | 'both'; activateOnMove?: boolean } = {}): void {
  const sel = opts.selector ?? 'button';
  const orient = opts.orientation ?? 'horizontal';
  const items = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(sel)].filter((b) => !b.hidden && !(b as HTMLButtonElement).disabled && b.offsetParent !== null);
  const sync = (): void => {
    const list = items();
    if (!list.length) return;
    const cur = list.find((b) => b === document.activeElement)
      ?? list.find((b) => b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.classList.contains('on'))
      ?? list[0]!;
    for (const b of list) b.tabIndex = b === cur ? 0 : -1;
  };
  container.addEventListener('keydown', (e) => {
    const keys = orient === 'vertical' ? ['ArrowUp', 'ArrowDown'] : orient === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (![...keys, 'Home', 'End'].includes(e.key)) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (back ? -1 : 1) + list.length) % list.length;
    const next = list[j]!;
    for (const b of list) b.tabIndex = b === next ? 0 : -1;
    next.focus();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (opts.activateOnMove) next.click();
    e.preventDefault();
    e.stopPropagation();
  });
  container.addEventListener('focusin', sync);
  new MutationObserver(() => { if (!container.contains(document.activeElement)) sync(); }).observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-checked', 'hidden'] });
  sync();
}

/** True when focus is on nothing in particular (the page or the 3D view), so global build keys apply. */
export function focusIsWorld(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement || a instanceof HTMLCanvasElement;
}

/**
 * Arrow keys inside any radio group, tab list or segment under `root` (delegated, so panels that re-render
 * keep working): ← → (↑ ↓ for vertical groups) move focus to the neighbouring button, and select it in a
 * radio group or tab list, as the ARIA patterns expect. Containers with their own `rovingFocus` stop the
 * event first.
 */
export function arrowGroups(root: HTMLElement): void {
  root.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const btn = (e.target as HTMLElement | null)?.closest?.('button');
    const group = btn?.parentElement?.closest<HTMLElement>('[role=radiogroup], [role=tablist], .seg, [data-roving]');
    if (!btn || !group || !group.contains(btn)) return;
    const list = [...group.querySelectorAll<HTMLElement>('button')].filter((b) => !(b as HTMLButtonElement).disabled && !b.hidden && b.offsetParent !== null);
    const i = list.indexOf(btn);
    if (i < 0 || list.length < 2) return;
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const next = list[(i + (back ? -1 : 1) + list.length) % list.length]!;
    next.focus();
    const role = group.getAttribute('role');
    if (role === 'radiogroup' || role === 'tablist') next.click();
    e.preventDefault();
    e.stopPropagation();
  });
}

/**
 * Mouse clicks shouldn't leave keyboard focus parked on a HUD button (Space would press it again instead
 * of letting it rip). A pointer-initiated click on a button hands focus back to the page afterwards;
 * keyboard activation (detail 0) keeps it, so keyboard users never lose their place.
 */
export function releaseMouseFocus(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    const b = (e.target as HTMLElement | null)?.closest?.('button');
    if (!b || b.closest('[role=dialog], [aria-modal=true], #settings, #palette, .kn-ask, #lobby, .sb-share, .sb-menu')) return;
    setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
  });
}
