/** Messages between the page and the wake-word worker. */
export type ToWakeWorker =
  | {
      type: 'init';
      /** URLs of the four models, served by the gateway from `~/.ephemeralos/models`. */
      models: { mel: string; embedding: string; wake: string; vad: string };
      wasmUrl: string;
      threshold: number;
      /** Audio chunks arrive on this port, straight from the capture worklet. */
      audio: MessagePort;
    }
  | { type: 'listen'; enabled: boolean };

export type FromWakeWorker =
  { type: 'ready' } | { type: 'wake'; score: number } | { type: 'error'; message: string };
