/**
 * openWakeWord's streaming pipeline, model-runtime agnostic so it can be tested in Node.
 *
 *   16 kHz audio, 80 ms chunks (1280 samples, int16 scale)
 *     → melspectrogram  (last chunk + 480 samples of context → 8 frames × 32 bins)
 *     → embedding       (last 76 frames → one 96-dim vector per chunk)
 *     → wake model      (last 16 vectors → score 0..1)
 *   plus Silero VAD as a second opinion, so loud non-speech can't wake the orb.
 *
 * Ported from github.com/dscripka/openWakeWord (Apache-2.0), `openwakeword/utils.py`.
 */

export const SAMPLE_RATE = 16_000;
export const CHUNK_SAMPLES = 1280;
const MEL_CONTEXT = 480;
const MEL_BINS = 32;
const MEL_WINDOW = 76;
const EMBEDDING_SIZE = 96;
const VAD_WINDOW_CHUNKS = 10;

/** The slice of an ONNX runtime the detector needs. */
export interface TensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
}
export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}
export type MakeTensor = (
  type: 'float32' | 'int64',
  data: Float32Array | BigInt64Array,
  dims: number[],
) => TensorLike;

export interface WakeModels {
  mel: SessionLike;
  embedding: SessionLike;
  wake: SessionLike;
  /** Optional: without it, the score alone decides. */
  vad?: SessionLike;
}

export interface WakeResult {
  score: number;
  /** Peak speech probability over the last ~0.8 s, or 1 without a VAD. */
  speech: number;
  woke: boolean;
}

export interface DetectorOptions {
  threshold: number;
  /** Speech probability the VAD must have seen recently. */
  vadThreshold?: number;
  /** Ignore further wakes for this long after one. */
  cooldownMs?: number;
}

function output(result: Record<string, TensorLike>, session: SessionLike): Float32Array {
  return result[session.outputNames[0]!]!.data as Float32Array;
}

export class WakeWordDetector {
  private readonly raw = new Float32Array(CHUNK_SAMPLES + MEL_CONTEXT);
  // openWakeWord seeds the mel buffer with ones, then slides real frames in.
  private readonly mel = new Float32Array(MEL_WINDOW * MEL_BINS).fill(1);
  // hey_jarvis and the other openWakeWord models look at 16 embeddings (~1.3 s).
  private readonly frames = 16;
  private readonly embeddings = new Float32Array(this.frames * EMBEDDING_SIZE);
  private filled = 0;
  private readonly vadScores: number[] = [];
  private vadH: Float32Array = new Float32Array(2 * 64);
  private vadC: Float32Array = new Float32Array(2 * 64);
  private cooldownUntil = 0;
  private elapsedMs = 0;

  constructor(
    private readonly models: WakeModels,
    private readonly tensor: MakeTensor,
    private readonly options: DetectorOptions,
  ) {}

  /** Feed one 1280-sample chunk of 16 kHz audio in int16 scale (±32768). */
  async process(chunk: Float32Array): Promise<WakeResult> {
    if (chunk.length !== CHUNK_SAMPLES) throw new Error(`expected ${CHUNK_SAMPLES} samples`);
    this.elapsedMs += (CHUNK_SAMPLES / SAMPLE_RATE) * 1000;

    this.raw.copyWithin(0, CHUNK_SAMPLES);
    this.raw.set(chunk, MEL_CONTEXT);

    // One at a time: the WebAssembly runtime does not run sessions concurrently.
    const score = await this.score();
    const speech = await this.speech(chunk);
    const vadOk = speech >= (this.options.vadThreshold ?? 0.5);
    const ready = this.filled >= this.frames;
    const woke =
      ready && score >= this.options.threshold && vadOk && this.elapsedMs >= this.cooldownUntil;
    if (woke) this.cooldownUntil = this.elapsedMs + (this.options.cooldownMs ?? 2000);
    return { score: ready ? score : 0, speech, woke };
  }

  private async score(): Promise<number> {
    const { mel, embedding, wake } = this.models;

    const melOut = output(
      await mel.run({
        [mel.inputNames[0]!]: this.tensor('float32', this.raw.slice(), [1, this.raw.length]),
      }),
      mel,
    );
    const newFrames = melOut.length / MEL_BINS;
    this.mel.copyWithin(0, newFrames * MEL_BINS);
    const start = (MEL_WINDOW - newFrames) * MEL_BINS;
    for (let i = 0; i < melOut.length; i++) this.mel[start + i] = melOut[i]! / 10 + 2;

    const vector = output(
      await embedding.run({
        [embedding.inputNames[0]!]: this.tensor('float32', this.mel.slice(), [
          1,
          MEL_WINDOW,
          MEL_BINS,
          1,
        ]),
      }),
      embedding,
    );
    this.embeddings.copyWithin(0, EMBEDDING_SIZE);
    this.embeddings.set(vector.subarray(0, EMBEDDING_SIZE), (this.frames - 1) * EMBEDDING_SIZE);
    this.filled = Math.min(this.filled + 1, this.frames);

    const result = output(
      await wake.run({
        [wake.inputNames[0]!]: this.tensor('float32', this.embeddings.slice(), [
          1,
          this.frames,
          EMBEDDING_SIZE,
        ]),
      }),
      wake,
    );
    return result[0] ?? 0;
  }

  private async speech(chunk: Float32Array): Promise<number> {
    const vad = this.models.vad;
    if (!vad) return 1;
    const input = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) input[i] = chunk[i]! / 32768;
    const out = await vad.run({
      input: this.tensor('float32', input, [1, input.length]),
      sr: this.tensor('int64', BigInt64Array.of(BigInt(SAMPLE_RATE)), []),
      h: this.tensor('float32', this.vadH, [2, 1, 64]),
      c: this.tensor('float32', this.vadC, [2, 1, 64]),
    });
    this.vadH = out.hn!.data as Float32Array;
    this.vadC = out.cn!.data as Float32Array;
    this.vadScores.push((out.output!.data as Float32Array)[0] ?? 0);
    if (this.vadScores.length > VAD_WINDOW_CHUNKS) this.vadScores.shift();
    return Math.max(...this.vadScores);
  }
}
