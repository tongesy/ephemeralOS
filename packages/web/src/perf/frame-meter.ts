/** Rolling frame-time statistics over the last `capacity` frames. */
export interface FrameStats {
  fps: number;
  /** 95th-percentile frame time in ms; the honest measure of smoothness. */
  p95Ms: number;
  worstMs: number;
  /** Share of frames slower than 1.5× the 60 Hz budget (~25 ms). */
  droppedPct: number;
  frames: number;
}

const BUDGET_MS = 1000 / 60;

export class FrameMeter {
  private readonly samples: Float32Array;
  private count = 0;
  private head = 0;

  constructor(capacity = 240) {
    this.samples = new Float32Array(capacity);
  }

  record(dtMs: number): void {
    this.samples[this.head] = dtMs;
    this.head = (this.head + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  stats(): FrameStats {
    if (this.count === 0) return { fps: 0, p95Ms: 0, worstMs: 0, droppedPct: 0, frames: 0 };
    const window = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const mean = window.reduce((s, x) => s + x, 0) / window.length;
    const dropped = window.filter((x) => x > BUDGET_MS * 1.5).length;
    return {
      fps: 1000 / mean,
      p95Ms: window[Math.min(window.length - 1, Math.floor(window.length * 0.95))]!,
      worstMs: window[window.length - 1]!,
      droppedPct: (dropped / window.length) * 100,
      frames: window.length,
    };
  }
}

/**
 * Lowers render resolution when frames run long and restores it when there is headroom,
 * so the orb stays at 60 fps on modest GPUs instead of stuttering at full resolution.
 */
export class QualityGovernor {
  private slowFor = 0;
  private fastFor = 0;

  constructor(
    private ratio: number,
    private readonly max: number,
    private readonly apply: (ratio: number) => void,
    private readonly min = 0.6,
  ) {}

  get pixelRatio(): number {
    return this.ratio;
  }

  /** Feed the current p95 frame time once per frame. */
  update(p95Ms: number, dtMs: number): void {
    if (p95Ms > BUDGET_MS * 1.15) {
      this.slowFor += dtMs;
      this.fastFor = 0;
    } else if (p95Ms < BUDGET_MS * 0.7) {
      this.fastFor += dtMs;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    if (this.slowFor > 1500 && this.ratio > this.min) this.step(-0.25);
    else if (this.fastFor > 5000 && this.ratio < this.max) this.step(0.25);
  }

  private step(delta: number): void {
    this.ratio = Math.min(this.max, Math.max(this.min, this.ratio + delta));
    this.slowFor = this.fastFor = 0;
    this.apply(this.ratio);
  }
}
