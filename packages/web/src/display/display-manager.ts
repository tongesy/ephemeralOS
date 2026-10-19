import { ScreenArgs, parseDisplay, type Scene, type ScreenAction } from '@ephemeralos/shared';
import type { Rect } from '../orb/placement.ts';
import { DisplayStack, type DisplayEntry } from './display-stack.ts';
import { LAYOUT_CHANGED, stepSlides } from './editorial.ts';
import { conceal, resize, reveal } from './motion.ts';
import { wouldReplaceToolResult } from './tool-result.ts';
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
  /**
   * A tool's result is on screen (a search table, a forecast) and the user hasn't spoken
   * since. The voice model sometimes follows a result with its own summary card, which
   * would replace the real thing; until the user's next turn, that is refused.
   */
  private toolResult: string | null = null;
  /** Something just started playing and the user hasn't spoken since: it has the stage. */
  private justPlayed = false;

  constructor(
    private readonly onLayout: (occupied: Rect[]) => void,
    /** The world behind what is shown (the weather), or null for the plain page. */
    private readonly onScene: (scene: Scene | null) => void = () => {},
    /** How long new content waits for the stage to clear (a player moving aside). */
    private readonly entranceDelay: () => number = () => 0,
  ) {
    window.addEventListener('resize', () => this.reportLayout());
    document.addEventListener(LAYOUT_CHANGED, () => this.reportLayout());
  }

  /**
   * Handle a `display` call (JSON arguments). Returns the JSON result for the model.
   * `fromTool` marks results a gateway tool put up itself.
   */
  display(rawArgs: unknown, fromTool = false): string {
    const parsed = parseDisplay(rawArgs);
    if (!parsed.ok) return JSON.stringify({ error: parsed.error });
    if (this.justPlayed && !fromTool) {
      return JSON.stringify({
        ok: false,
        note: 'It is playing on screen. Do not put anything else up; just say what is playing.',
      });
    }
    const shown = this.stack.shown;
    const replaces = wouldReplaceToolResult({
      toolResult: this.el ? this.toolResult : null,
      shown: shown && { key: shown.key, id: shown.request.id },
      incomingId: parsed.value.id,
      fromTool,
    });
    if (replaces) {
      return JSON.stringify({
        ok: false,
        note: 'The result is already on screen. Do not replace it; just say the gist.',
        ...this.summary(),
      });
    }
    const { entry, updated } = this.stack.show(parsed.value);
    this.toolResult = fromTool ? entry.key : null;
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

  /** The user started speaking: a new turn may change what's shown. */
  userSpoke(): void {
    this.toolResult = null;
    this.justPlayed = false;
  }

  /**
   * Something started playing: it takes the stage. What was shown goes (back brings it
   * back), and until the user speaks again the voice model can't put a card over it.
   */
  mediaStarted(): void {
    this.justPlayed = true;
    if (!this.stack.shown) return;
    this.stack.hide();
    this.clearSurface();
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
        if (this.el && stepSlides(this.el, action === 'next' ? 1 : -1)) {
          this.restartTimer();
          return { ok: true, note: 'Moved within the slideshow.' };
        }
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
    const wait = previous ? 0 : this.entranceDelay();
    document.body.append(next);
    this.el = next;
    reveal(next, 140 + wait);
    requestAnimationFrame(() => {
      // Reported now, so whatever is on stage starts moving aside before this arrives.
      this.reportLayout();
      setTimeout(() => {
        if (generation === this.generation) next.toggleAttribute('data-shown', true);
      }, wait);
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
    // Full-bleed layouts mark the part the orb must keep clear (their text); the rest of
    // the screen is a picture it may sit on. Mid-fade the surface sits a few pixels low;
    // close enough for the orb to plan around.
    const marked = [...this.el.querySelectorAll<HTMLElement>('[data-occupies]')];
    const parts = this.el.matches('.editorial') && marked.length ? marked : [this.el];
    this.onLayout(
      parts.map((part) => {
        const { x, y, width, height } = part.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  }
}
