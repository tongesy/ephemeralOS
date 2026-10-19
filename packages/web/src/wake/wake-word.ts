import { MODELS_PATH, type GatewayStatus } from '@ephemeralos/shared';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import workletUrl from './capture.worklet.ts?worker&url';
import type { FromWakeWorker, ToWakeWorker } from './protocol.ts';

/**
 * The local wake word. Microphone audio goes worklet → worker over a private port;
 * nothing leaves the browser until the phrase is heard.
 */
export class WakeWord {
  private readonly worker = new Worker(new URL('./wake.worker.ts', import.meta.url), {
    type: 'module',
  });
  private node: AudioWorkletNode | null = null;
  private wakeHandler: (score: number) => void = () => {};

  static async start(
    context: AudioContext,
    source: AudioNode,
    settings: GatewayStatus['wakeWord'],
  ): Promise<WakeWord> {
    const wake = new WakeWord();
    await wake.init(context, source, settings);
    return wake;
  }

  onWake(handler: (score: number) => void): void {
    this.wakeHandler = handler;
  }

  /** Pause detection while a voice session is open (the phrase means nothing then). */
  listen(enabled: boolean): void {
    this.post({ type: 'listen', enabled });
  }

  private post(msg: ToWakeWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private async init(
    context: AudioContext,
    source: AudioNode,
    settings: GatewayStatus['wakeWord'],
  ): Promise<void> {
    await context.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(context, 'eos-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    source.connect(this.node);

    const channel = new MessageChannel();
    this.node.port.postMessage(channel.port1, [channel.port1]);

    const model = (name: string) => `${MODELS_PATH}${name}.onnx`;
    const ready = new Promise<void>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<FromWakeWorker>) => {
        const msg = event.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'wake') this.wakeHandler(msg.score);
        else if (msg.type === 'heard') {
          console.debug(`[wake] heard something close (score ${msg.score.toFixed(2)})`);
        } else {
          console.warn('[wake]', msg.message);
          reject(new Error(msg.message));
        }
      };
    });
    this.post(
      {
        type: 'init',
        models: {
          mel: model('melspectrogram'),
          embedding: model('embedding_model'),
          wake: model(settings.model),
          vad: model('silero_vad'),
        },
        wasmUrl: new URL(wasmUrl, location.href).href,
        threshold: settings.threshold,
        audio: channel.port2,
      },
      [channel.port2],
    );
    await ready;
  }
}
