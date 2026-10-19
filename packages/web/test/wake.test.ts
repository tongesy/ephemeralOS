import { describe, expect, it } from 'vitest';
import {
  CHUNK_SAMPLES,
  WakeWordDetector,
  type MakeTensor,
  type SessionLike,
  type TensorLike,
} from '../src/wake/detector.ts';
import { ChunkResampler } from '../src/wake/resampler.ts';

describe('ChunkResampler', () => {
  it('turns 48 kHz into fixed 16 kHz chunks in int16 scale', () => {
    const chunks: Float32Array[] = [];
    const resampler = new ChunkResampler(48_000, 16_000, 1280, (c) => chunks.push(c));
    const block = new Float32Array(128).fill(0.5);
    for (let i = 0; i < 30; i++) resampler.push(block); // 3840 in → 1280 out
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBe(1280);
    expect(chunks[0]![0]).toBeCloseTo(0.5 * 32767, 0);
  });

  it('handles rates that do not divide evenly', () => {
    let out = 0;
    const resampler = new ChunkResampler(44_100, 16_000, 160, (c) => (out += c.length));
    resampler.push(new Float32Array(44_100));
    expect(Math.abs(out - 16_000)).toBeLessThanOrEqual(160);
  });
});

/** A stand-in session: returns `value` in the model's output shape. */
function fake(input: string, output: (feeds: Record<string, TensorLike>) => Float32Array) {
  const session: SessionLike & { runs: number } = {
    inputNames: [input],
    outputNames: ['out'],
    runs: 0,
    async run(feeds) {
      session.runs++;
      return { out: { data: output(feeds), dims: [] } };
    },
  };
  return session;
}

const tensor: MakeTensor = (_type, data, dims) => ({ data, dims });

describe('WakeWordDetector', () => {
  it('waits for a full window, wakes above threshold, then cools down', async () => {
    let score = 0.9;
    const models = {
      mel: fake('input', () => new Float32Array(8 * 32)),
      embedding: fake('input_1', () => new Float32Array(96)),
      wake: fake('x.1', () => Float32Array.of(score)),
    };
    const detector = new WakeWordDetector(models, tensor, { threshold: 0.5, cooldownMs: 2000 });
    const chunk = new Float32Array(CHUNK_SAMPLES);

    const results = [];
    for (let i = 0; i < 16; i++) results.push(await detector.process(chunk));
    // 15 chunks to fill the 16-embedding window; the 16th can wake.
    expect(results.slice(0, 15).every((r) => !r.woke && r.score === 0)).toBe(true);
    expect(results[15]!.woke).toBe(true);

    expect((await detector.process(chunk)).woke).toBe(false); // cooling down
    for (let i = 0; i < 23; i++) expect((await detector.process(chunk)).woke).toBe(false);
    // Exactly 2 s after the first wake.
    expect((await detector.process(chunk)).woke).toBe(true);

    score = 0.2;
    for (let i = 0; i < 30; i++) expect((await detector.process(chunk)).woke).toBe(false);
  });

  it('needs the VAD to have heard speech', async () => {
    const vad: SessionLike = {
      inputNames: ['input', 'sr', 'h', 'c'],
      outputNames: ['output', 'hn', 'cn'],
      async run() {
        const state = { data: new Float32Array(128), dims: [2, 1, 64] };
        return { output: { data: Float32Array.of(0.1), dims: [1, 1] }, hn: state, cn: state };
      },
    };
    const models = {
      mel: fake('input', () => new Float32Array(8 * 32)),
      embedding: fake('input_1', () => new Float32Array(96)),
      wake: fake('x.1', () => Float32Array.of(0.99)),
      vad,
    };
    const detector = new WakeWordDetector(models, tensor, { threshold: 0.5 });
    for (let i = 0; i < 40; i++) {
      expect((await detector.process(new Float32Array(CHUNK_SAMPLES))).woke).toBe(false);
    }
  });

  it('rejects chunks of the wrong size', async () => {
    const models = {
      mel: fake('input', () => new Float32Array(8 * 32)),
      embedding: fake('input_1', () => new Float32Array(96)),
      wake: fake('x.1', () => Float32Array.of(0)),
    };
    const detector = new WakeWordDetector(models, tensor, { threshold: 0.5 });
    await expect(detector.process(new Float32Array(100))).rejects.toThrow();
  });
});
