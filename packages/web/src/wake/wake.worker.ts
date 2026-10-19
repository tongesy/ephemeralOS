/// <reference lib="webworker" />
/** Runs the wake-word models off the main thread so the orb's frame budget is untouched. */
import * as ort from 'onnxruntime-web/wasm';
import { WakeWordDetector, type MakeTensor } from './detector.ts';
import type { FromWakeWorker, ToWakeWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWakeWorker) => self.postMessage(msg);
const tensor: MakeTensor = (type, data, dims) => new ort.Tensor(type, data, dims);

let detector: WakeWordDetector | null = null;
let listening = true;
let busy = false;
const queue: Float32Array[] = [];
/** If inference ever falls behind, drop old audio rather than wake late. */
const MAX_QUEUE = 4;
/** Scores worth logging even though they didn't wake the orb. */
const NEAR_MISS = 0.1;

async function drain(): Promise<void> {
  if (busy || !detector) return;
  busy = true;
  try {
    while (queue.length) {
      const chunk = queue.shift()!;
      const result = await detector.process(chunk);
      if (!listening) continue;
      if (result.woke) {
        // Stay quiet until the page says the session is over.
        listening = false;
        post({ type: 'wake', score: result.score });
      } else if (result.score >= NEAR_MISS) post({ type: 'heard', score: result.score });
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
}

async function init(msg: Extract<ToWakeWorker, { type: 'init' }>): Promise<void> {
  ort.env.wasm.wasmPaths = { wasm: msg.wasmUrl };
  ort.env.wasm.numThreads = 1;
  const load = (url: string) => ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
  const [mel, embedding, wake, vad] = await Promise.all([
    load(msg.models.mel),
    load(msg.models.embedding),
    load(msg.models.wake),
    load(msg.models.vad),
  ]);
  detector = new WakeWordDetector({ mel, embedding, wake, vad }, tensor, {
    threshold: msg.threshold,
  });
  msg.audio.onmessage = (event: MessageEvent<Float32Array>) => {
    queue.push(event.data);
    if (queue.length > MAX_QUEUE) queue.shift();
    void drain();
  };
  post({ type: 'ready' });
}

self.onmessage = (event: MessageEvent<ToWakeWorker>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    init(msg).catch((error: unknown) =>
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
  } else {
    listening = msg.enabled;
  }
};
