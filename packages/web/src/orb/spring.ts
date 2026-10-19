/**
 * A critically damped spring: eases in and out, never overshoots, and retargets
 * mid-flight without a jolt. `smoothTime` is roughly how long a move takes, in ms.
 */
export class Spring {
  velocity = 0;

  constructor(
    public value: number,
    public target = value,
    private readonly smoothTime = 600,
  ) {}

  get settled(): boolean {
    return Math.abs(this.value - this.target) < 1e-3 && Math.abs(this.velocity) < 1e-3;
  }

  /** Jump straight to `value` (e.g. on first layout). */
  snap(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }

  update(dtMs: number): number {
    const omega = 2000 / this.smoothTime;
    const dt = dtMs / 1000;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - this.target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * decay;
    this.value = this.target + (change + temp) * decay;
    return this.value;
  }
}
