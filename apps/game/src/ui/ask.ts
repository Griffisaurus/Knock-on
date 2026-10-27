// A small in-app dialog (text prompt or confirm) instead of window.prompt / confirm, which block the
// page and break automation. Resolves null on cancel.

export function ask(parent: HTMLElement, opts: { title: string; value?: string; confirm?: string; danger?: boolean; maxLength?: number; text?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const wrap = document.createElement('div');
    wrap.className = 'kn-ask';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'kn-ask-title');
    wrap.innerHTML = '<form class="kn-panel"><b id="kn-ask-title"></b><input/><div class="acts"><button type="button" data-a="cancel">Cancel</button><button type="submit" class="primary"></button></div></form>';
    const form = wrap.firstChild as HTMLFormElement;
    (form.querySelector('b') as HTMLElement).textContent = opts.title;
    const input = form.querySelector('input') as HTMLInputElement;
    if (opts.text === false) input.remove();
    else { input.value = opts.value ?? ''; input.maxLength = opts.maxLength ?? 64; input.setAttribute('aria-label', opts.title); }
    const ok = form.querySelector('[type=submit]') as HTMLButtonElement;
    ok.textContent = opts.confirm ?? 'OK';
    if (opts.danger) ok.classList.add('danger');
    const done = (v: string | null): void => { wrap.remove(); prev?.focus?.(); resolve(v); };
    form.onsubmit = (e) => { e.preventDefault(); done(opts.text === false ? '' : input.value); };
    (form.querySelector('[data-a=cancel]') as HTMLElement).onclick = () => done(null);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
      // U4: Tab stays inside the dialog (WCAG 2.4.3 / modal pattern)
      if (e.key === 'Tab') {
        const list = [...form.querySelectorAll<HTMLElement>('input, button')];
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
        next?.focus();
        e.preventDefault();
      }
      e.stopPropagation();
    });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done(null); });
    parent.appendChild(wrap);
    if (opts.text === false) ok.focus(); else { input.focus(); input.select(); }
  });
}
