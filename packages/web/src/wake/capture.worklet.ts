/// <reference lib="webworker" />
/**
 * AudioWorklet: turns microphone audio into 80 ms chunks of 16 kHz audio and posts them
 * straight to the wake-word worker over a MessagePort, so the main thread never sees them.
 */
import { CHUNK_SAMPLES, SAMPLE_RATE } from './detector.ts';
import { ChunkResampler } from './resampler.ts';

// AudioWorkletGlobalScope globals, which TypeScript's DOM libs don't declare.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class CaptureProcessor extends AudioWorkletProcessor {
  private target: MessagePort | null = null;
  private readonly resampler = new ChunkResampler(sampleRate, SAMPLE_RATE, CHUNK_SAMPLES, (c) =>
    this.target?.postMessage(c, [c.buffer]),
  );

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<MessagePort>) => {
      this.target = event.data;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) this.resampler.push(channel);
    return true;
  }
}

registerProcessor('eos-capture', CaptureProcessor);
