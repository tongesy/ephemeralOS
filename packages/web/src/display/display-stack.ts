import { DEFAULT_TTL_SECONDS, type DisplayRequest } from '@ephemeralos/shared';

export interface DisplayEntry {
  key: string;
  request: DisplayRequest;
  ttlMs: number;
}

/** Things shown this session, kept so "go back" can bring them back. */
const HISTORY = 12;

let serial = 0;

/**
 * What is on screen and what came before, without any DOM: one entry is current (or
 * none, when the screen is clear); `next` and `back` walk the history.
 */
export class DisplayStack {
  readonly entries: DisplayEntry[] = [];
  /** Index of the entry on screen, or -1 when nothing is shown. */
  current = -1;

  get shown(): DisplayEntry | null {
    return this.entries[this.current] ?? null;
  }

  /** Show a request: update the entry with the same id in place, or add a new one. */
  show(request: DisplayRequest): { entry: DisplayEntry; updated: boolean } {
    const ttlMs = (request.ttlSeconds ?? DEFAULT_TTL_SECONDS[request.content.component]) * 1000;
    const existing = request.id ? this.entries.findIndex((e) => e.request.id === request.id) : -1;
    if (existing >= 0) {
      const entry = { ...this.entries[existing]!, request, ttlMs };
      this.entries[existing] = entry;
      this.current = existing;
      return { entry, updated: true };
    }
    const entry = { key: `d${++serial}`, request, ttlMs };
    this.entries.push(entry);
    if (this.entries.length > HISTORY) this.entries.shift();
    this.current = this.entries.length - 1;
    return { entry, updated: false };
  }

  /** Move through history. With nothing shown, `back` brings the latest back. */
  step(delta: 1 | -1): boolean {
    if (this.entries.length === 0) return false;
    if (this.current < 0) {
      if (delta > 0) return false;
      this.current = this.entries.length - 1;
      return true;
    }
    const next = this.current + delta;
    if (next < 0 || next >= this.entries.length) return false;
    this.current = next;
    return true;
  }

  /** Clear the screen but keep history. */
  hide(): void {
    this.current = -1;
  }

  clear(): void {
    this.entries.length = 0;
    this.current = -1;
  }

  /** e.g. "2 of 3", for the model. */
  position(): string | null {
    return this.current < 0 ? null : `${this.current + 1} of ${this.entries.length}`;
  }
}
