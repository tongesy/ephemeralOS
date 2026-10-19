import { Envelope, rms, rmsToLevel, toBands } from './envelope.ts';

/** Live audio features the orb reads every frame. All values are 0..1. */
export interface LevelsSnapshot {
  input: number;
  output: number;
  bands: Float32Array;
}

/** Microphone constraints from the brief; far-field use benefits from a USB speakerphone. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

/**
 * Measures microphone input and voice output through AnalyserNodes.
 * M1 wires the microphone; M2 connects the Realtime session's audio via `attachOutput`.
 */
export class AudioLevels {
  readonly snapshot: LevelsSnapshot = { input: 0, output: 0, bands: new Float32Array(4) };

  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private input: AnalyserNode | null = null;
  private output: AnalyserNode | null = null;
  private readonly inputEnv = new Envelope(30, 220);
  private readonly outputEnv = new Envelope(25, 180);
  private readonly bandEnvs = [0, 1, 2, 3].map(() => new Envelope(30, 200));
  private readonly bandsRaw = new Float32Array(4);
  private timeBuf = new Float32Array(1024);
  private freqBuf = new Uint8Array(512);

  get running(): boolean {
    return this.context.state === 'running';
  }

  /** Browsers only start audio after a user gesture. */
  resume(): Promise<void> {
    return this.context.resume();
  }

  async attachMicrophone(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const source = this.context.createMediaStreamSource(stream);
    this.input = this.analyser();
    source.connect(this.input);
    return stream;
  }

  /** Route an audio node (e.g. remote Realtime audio) through the output analyser. */
  attachOutput(node: AudioNode): void {
    this.output = this.analyser();
    node.connect(this.output);
  }

  /** Read the analysers and smooth the results. Call once per animation frame. */
  update(dtMs: number): LevelsSnapshot {
    this.snapshot.input = this.inputEnv.update(this.level(this.input), dtMs);
    this.snapshot.output = this.outputEnv.update(this.level(this.output), dtMs);
    if (this.output) {
      this.output.getByteFrequencyData(this.freqBuf);
      toBands(this.freqBuf, this.context.sampleRate / this.output.fftSize, this.bandsRaw);
    } else {
      this.bandsRaw.fill(0);
    }
    for (let b = 0; b < 4; b++) {
      this.snapshot.bands[b] = this.bandEnvs[b]!.update(this.bandsRaw[b]!, dtMs);
    }
    return this.snapshot;
  }

  private analyser(): AnalyserNode {
    const node = this.context.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.5;
    this.timeBuf = new Float32Array(node.fftSize);
    this.freqBuf = new Uint8Array(node.frequencyBinCount);
    return node;
  }

  private level(node: AnalyserNode | null): number {
    if (!node) return 0;
    node.getFloatTimeDomainData(this.timeBuf);
    return rmsToLevel(rms(this.timeBuf));
  }
}
