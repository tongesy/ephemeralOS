import { ScreenArgs, parseDisplay, type Scene, type ScreenAction } from '@ephemeralos/shared';
import type { Rect } from '../orb/placement.ts';
import { DisplayStack, type DisplayEntry } from './display-stack.ts';
import { conceal, resize, reveal } from './motion.ts';
import { describeItem, numberedItems, renderSurface } from './render.ts';

/** What the model is told about the screen after each call. */
export interface ScreenSummary {
  shown: null | {
    title?: string;
    component: string;
    position: string;
    items?: number;
    enlarged: boolean;
  };
  [key: string]: unknown;
}

/** How long content lingers after a conversation ends before the screen clears. */
const AFTER_SESSION_MS = 4000;

/**
 * Owns the screen: one surface at a time fades in, the previous fades out, and the orb
 * is told which space is taken so it can glide into what's left. An update to what is
 * shown (same id) keeps the panel: the old content leaves, the panel eases to its new
 * size and the new content cascades in. Surfaces fade on their own after their TTL, and
 * everything clears shortly after the conversation ends.
 */
export class DisplayManager {
  private readonly stack = new DisplayStack();
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private enlarged = false;
  /** Bumped by every render, so a morph that is overtaken stops where it is. */
  private generation = 0;
  private sessionEnd: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onLayout: (occupied: Rect[]) => void,
    /** The world behind what is shown (the weather), or null for the plain page. */
    private readonly onScene: (scene: Scene | null) => void = () => {},
  ) {
    window.addEventListener('resize', () => this.reportLayout());
  }

  /** Handle a `display` call (JSON arguments). Returns the JSON result for the model. */
  display(rawArgs: unknown): string {
    const parsed = parseDisplay(rawArgs);
    if (!parsed.ok) return JSON.stringify({ error: parsed.error });
    const { entry, updated } = this.stack.show(parsed.value);
    this.render(entry, updated);
    return JSON.stringify({ ok: true, ...this.summary() });
  }

  /** Handle a `screen` call. */
  screen(rawArgs: unknown): string {
    const parsed = ScreenArgs.safeParse(rawArgs);
    if (!parsed.success) return JSON.stringify({ error: parsed.error.issues[0]?.message });
    const { action, index } = parsed.data;
    const result = this.act(action, index);
    return JSON.stringify({ ...result, ...this.summary() });
  }

  /** The conversation ended: let what's shown linger a moment, then clear the screen. */
  sessionEnded(): void {
    clearTimeout(this.sessionEnd);
    if (!this.el) return;
    this.sessionEnd = setTimeout(() => {
      this.stack.clear();
      this.clearSurface();
    }, AFTER_SESSION_MS);
  }

  /** A conversation started again: keep what's shown. */
  sessionStarted(): void {
    clearTimeout(this.sessionEnd);
  }

  get hasContent(): boolean {
    return this.stack.shown !== null;
  }

  summary(): ScreenSummary {
    const entry = this.stack.shown;
    if (!entry) return { shown: null };
    const c = entry.request.content;
    const items =
      c.component === 'list' ? c.items.length : c.component === 'table' ? c.rows.length : undefined;
    return {
      shown: {
        title: entry.request.title,
        component: c.component,
        position: this.stack.position()!,
        items,
        enlarged: this.enlarged,
      },
    };
  }

  private act(action: ScreenAction, index?: number): Record<string, unknown> {
    switch (action) {
      case 'next':
      case 'back': {
        const moved = this.stack.step(action === 'next' ? 1 : -1);
        if (!moved)
          return { note: action === 'next' ? 'Nothing after this.' : 'Nothing before this.' };
        this.render(this.stack.shown!, false);
        return { ok: true };
      }
      case 'dismiss':
        this.stack.hide();
        this.clearSurface();
        return { ok: true };
      case 'dismiss_all':
        this.stack.clear();
        this.clearSurface();
        return { ok: true };
    }

    const el = this.el;
    if (!el) return { note: 'Nothing is on screen.' };
    this.restartTimer();
    switch (action) {
      case 'scroll_down':
      case 'scroll_up': {
        const atLimit =
          action === 'scroll_down'
            ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2
            : el.scrollTop <= 0;
        el.scrollBy({
          top: (action === 'scroll_down' ? 1 : -1) * el.clientHeight * 0.7,
          behavior: 'smooth',
        });
        return atLimit
          ? { note: `Already at the ${action === 'scroll_down' ? 'bottom' : 'top'}.` }
          : { ok: true };
      }
      case 'enlarge':
        this.enlarged = !this.enlarged;
        el.toggleAttribute('data-large', this.enlarged);
        this.reportLayout();
        return { ok: true };
      case 'open': {
        const items = numberedItems(el);
        if (!index) return { error: 'Say which number to open.' };
        const item = items[index - 1];
        if (!item)
          return { error: `There are ${items.length} items; there is no number ${index}.` };
        for (const other of items) other.toggleAttribute('data-open', other === item);
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return { ok: true, item: describeItem(item) };
      }
    }
  }

  private render(entry: DisplayEntry, inPlace: boolean): void {
    const generation = ++this.generation;
    const next = renderSurface(entry.request);
    next.dataset.key = entry.key;
    this.enlarged = false;
    this.restartTimer(entry.ttlMs);
    this.onScene(entry.request.scene ?? null);
    const previous = this.el;
    if (inPlace && previous?.dataset.key === entry.key) {
      void this.morph(previous, next, generation);
      return;
    }
    this.fadeOut(previous);
    document.body.append(next);
    this.el = next;
    reveal(next, 140);
    requestAnimationFrame(() => {
      next.toggleAttribute('data-shown', true);
      this.reportLayout();
    });
  }

  /** Same panel, new content: out, ease to the new size, then cascade back in. */
  private async morph(panel: HTMLElement, next: HTMLElement, generation: number): Promise<void> {
    await conceal(panel);
    if (generation !== this.generation) return;
    const from = panel.getBoundingClientRect();
    panel.className = next.className;
    panel.removeAttribute('data-large');
    panel.replaceChildren(...next.childNodes);
    panel.scrollTop = 0;
    this.reportLayout();
    reveal(panel, 120);
    await resize(panel, from);
  }

  private clearSurface(): void {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.sessionEnd);
    this.fadeOut(this.el);
    this.el = null;
    this.enlarged = false;
    this.onScene(null);
    this.reportLayout();
  }

  private fadeOut(el: HTMLElement | null): void {
    if (!el) return;
    el.toggleAttribute('data-shown', false);
    const remove = () => el.remove();
    el.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 1500); // in case no transition runs (reduced motion)
  }

  private restartTimer(ms = this.stack.shown?.ttlMs): void {
    clearTimeout(this.timer);
    if (!ms) return;
    this.timer = setTimeout(() => {
      this.stack.hide();
      this.clearSurface();
    }, ms);
  }

  private reportLayout(): void {
    if (!this.el) {
      this.onLayout([]);
      return;
    }
    // Mid-fade the surface sits a few pixels low; close enough for the orb to plan around.
    const { x, y, width, height } = this.el.getBoundingClientRect();
    this.onLayout([{ x, y, width, height }]);
  }
}
