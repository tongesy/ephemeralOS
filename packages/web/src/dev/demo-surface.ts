import type { Rect } from '../orb/placement.ts';

/**
 * A stand-in for M3's display tool: one glass card with a numbered list, so the fade
 * and the orb's move into open space can be seen before the voice loop exists.
 */
export class DemoSurface {
  private el: HTMLElement | null = null;

  constructor(private readonly onLayout: (occupied: Rect[]) => void) {}

  get shown(): boolean {
    return this.el?.hasAttribute('data-shown') ?? false;
  }

  toggle(): void {
    if (this.shown) this.hide();
    else this.show();
  }

  show(): void {
    this.el?.remove();
    const el = document.createElement('section');
    el.className = 'surface glass';
    el.setAttribute('aria-live', 'polite');
    el.style.left = '8vw';
    el.style.top = '50%';
    el.style.translate = '0 -50%';
    el.style.width = 'min(440px, 42vw)';
    el.innerHTML = `
      <p class="surface__eyebrow">Three options</p>
      <h2 class="surface__title">A quiet weekend in Copenhagen</h2>
      <ol class="surface__list">
        <li><span class="surface__label">Hotel Sanders</span><span class="surface__detail">Kongens Nytorv · from 3,200 kr</span></li>
        <li><span class="surface__label">Hotel Alexandra</span><span class="surface__detail">H.C. Andersens Boulevard · from 2,900 kr</span></li>
        <li><span class="surface__label">Villa Copenhagen</span><span class="surface__detail">Vesterbro · from 2,450 kr</span></li>
      </ol>`;
    document.body.append(el);
    this.el = el;
    requestAnimationFrame(() => {
      el.toggleAttribute('data-shown', true);
      // `translate` is static, so the resting rect is known before the fade finishes.
      const r = el.getBoundingClientRect();
      this.onLayout([{ x: r.x, y: r.y, width: r.width, height: r.height }]);
    });
  }

  hide(): void {
    const el = this.el;
    if (!el) return;
    el.toggleAttribute('data-shown', false);
    this.onLayout([]);
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    this.el = null;
  }
}
