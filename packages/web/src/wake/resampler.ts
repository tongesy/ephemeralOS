/**
 * Downsample to 16 kHz in fixed chunks. Each output sample is the mean of the input
 * samples it covers, a box filter that is enough anti-aliasing for speech features.
 * Output is in int16 scale, as openWakeWord expects.
 */
export class ChunkResampler {
  private readonly step: number;
  private readonly chunk: Float32Array;
  private filled = 0;
  private position = 0;
  private sum = 0;
  private count = 0;

  constructor(
    inputRate: number,
    outputRate: number,
    readonly chunkSize: number,
    private readonly emit: (chunk: Float32Array) => void,
  ) {
    if (inputRate < outputRate) throw new Error('can only downsample');
    this.step = inputRate / outputRate;
    this.chunk = new Float32Array(chunkSize);
  }

  push(input: Float32Array): void {
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]!;
      this.count++;
      this.position++;
      if (this.position < this.step) continue;
      this.position -= this.step;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.chunk[this.filled++] = value * 32767;
      if (this.filled === this.chunkSize) {
        this.emit(this.chunk.slice());
        this.filled = 0;
      }
    }
  }
}
