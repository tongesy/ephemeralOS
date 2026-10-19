import type { FrameStats } from './frame-meter.ts';

/**
 * A small read-only readout of frame timing, shown with `?perf` (any build) or the dev
 * shortcut. Output only: it is there to measure the 60 fps budget on real hardware.
 */
export class PerfOverlay {
  private readonly el = document.createElement('output');
  private lastPaint = 0;

  constructor() {
    this.el.className = 'perf glass';
    this.el.setAttribute('aria-hidden', 'true');
  }

  get visible(): boolean {
    return this.el.isConnected;
  }

  toggle(force = !this.visible): void {
    if (force) document.body.append(this.el);
    else this.el.remove();
  }

  update(now: number, stats: FrameStats, pixelRatio: number): void {
    if (!this.visible || now - this.lastPaint < 250) return;
    this.lastPaint = now;
    this.el.textContent =
      `${stats.fps.toFixed(0)} fps · p95 ${stats.p95Ms.toFixed(1)} ms · ` +
      `drops ${stats.droppedPct.toFixed(1)}% · ${pixelRatio.toFixed(2)}×`;
  }
}
