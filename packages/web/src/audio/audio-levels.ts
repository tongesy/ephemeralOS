import {
  Envelope,
  SPECTRUM_SIZE,
  SpectrumEnvelope,
  rms,
  rmsToLevel,
  toBands,
  toLogSpectrum,
} from './envelope.ts';

/** Live audio features the orb reads every frame. All values are 0..1. */
export interface LevelsSnapshot {
  /** Microphone loudness. */
  input: number;
  /** Voice output loudness. */
  output: number;
  /** Voice output in four bands, low → high (the brief's `uBands`). */
  bands: Float32Array;
  /** Microphone spectrum, log-spaced, low → high. */
  spectrumIn: Float32Array;
  /** Voice output spectrum, log-spaced, low → high. */
  spectrumOut: Float32Array;
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

/** One measured signal: an analyser plus its smoothed loudness and spectrum. */
class Channel {
  readonly analyser: AnalyserNode;
  readonly level: Envelope;
  readonly spectrum = new SpectrumEnvelope();
  private readonly time: Float32Array<ArrayBuffer>;
  private readonly freq: Uint8Array<ArrayBuffer>;
  private readonly spectrumRaw = new Float32Array(SPECTRUM_SIZE);

  constructor(context: AudioContext, attackMs: number, releaseMs: number) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.level = new Envelope(attackMs, releaseMs);
    this.time = new Float32Array(this.analyser.fftSize);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  get binHz(): number {
    return this.analyser.context.sampleRate / this.analyser.fftSize;
  }

  /** Read the analyser; returns the raw FFT bytes for further use. */
  update(dtMs: number): Uint8Array {
    this.analyser.getFloatTimeDomainData(this.time);
    this.level.update(rmsToLevel(rms(this.time)), dtMs);
    this.analyser.getByteFrequencyData(this.freq);
    this.spectrum.update(toLogSpectrum(this.freq, this.binHz, this.spectrumRaw), dtMs);
    return this.freq;
  }
}

/**
 * Measures microphone input and voice output through AnalyserNodes.
 * M1 wires the microphone; M2 connects the Realtime session's audio via `attachOutput`.
 */
export class AudioLevels {
  readonly snapshot: LevelsSnapshot = {
    input: 0,
    output: 0,
    bands: new Float32Array(4),
    spectrumIn: new Float32Array(SPECTRUM_SIZE),
    spectrumOut: new Float32Array(SPECTRUM_SIZE),
  };

  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private input: Channel | null = null;
  private output: Channel | null = null;
  private readonly bandEnvs = [0, 1, 2, 3].map(() => new Envelope(30, 200));
  private readonly bandsRaw = new Float32Array(4);

  get running(): boolean {
    return this.context.state === 'running';
  }

  /** Browsers only start audio after a user gesture (or, in some, a microphone grant). */
  resume(): Promise<void> {
    return this.context.resume();
  }

  async attachMicrophone(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    this.input = new Channel(this.context, 30, 220);
    this.context.createMediaStreamSource(stream).connect(this.input.analyser);
    return stream;
  }

  /** Route an audio node (e.g. remote Realtime audio) through the output analyser. */
  attachOutput(node: AudioNode): void {
    this.output = new Channel(this.context, 25, 180);
    node.connect(this.output.analyser);
  }

  /** Read the analysers and smooth the results. Call once per animation frame. */
  update(dtMs: number): LevelsSnapshot {
    const snap = this.snapshot;
    if (this.input) {
      this.input.update(dtMs);
      snap.input = this.input.level.value;
      snap.spectrumIn.set(this.input.spectrum.values);
    }
    if (this.output) {
      const freq = this.output.update(dtMs);
      toBands(freq, this.output.binHz, this.bandsRaw);
      snap.output = this.output.level.value;
      snap.spectrumOut.set(this.output.spectrum.values);
    } else {
      // Nothing playing yet: start each frame from silence (dev tools may simulate output).
      snap.output = 0;
      snap.spectrumOut.fill(0);
      this.bandsRaw.fill(0);
    }
    for (let b = 0; b < 4; b++) snap.bands[b] = this.bandEnvs[b]!.update(this.bandsRaw[b]!, dtMs);
    return snap;
  }
}
