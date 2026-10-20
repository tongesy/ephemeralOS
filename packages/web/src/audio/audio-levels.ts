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

/** How strongly the orb follows a podcast or music, relative to its own voice. */
const MEDIA_LEVEL = 0.55;

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
 * The voice session's audio is attached with `attachOutput` while a session is open.
 */
export class AudioLevels {
  readonly snapshot: LevelsSnapshot = {
    input: 0,
    output: 0,
    bands: new Float32Array(4),
    spectrumIn: new Float32Array(SPECTRUM_SIZE),
    spectrumOut: new Float32Array(SPECTRUM_SIZE),
  };

  readonly context = new AudioContext({ latencyHint: 'interactive' });
  /** The live microphone, once granted; the wake word and voice session share it. */
  microphone: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;
  private input: Channel | null = null;
  private output: Channel | null = null;
  private outputSource: AudioNode | null = null;
  /** Something playing (a podcast), measured when the voice is quiet. */
  private media: Channel | null = null;
  private mediaSource: AudioNode | null = null;
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
    const source = this.context.createMediaStreamSource(stream);
    this.input = new Channel(this.context, 30, 220);
    source.connect(this.input.analyser);
    this.microphone = { stream, source };
    return stream;
  }

  /** Measure an audio node (the voice session's remote audio) as output. */
  attachOutput(node: AudioNode): void {
    this.detachOutput();
    this.output = new Channel(this.context, 25, 180);
    this.outputSource = node;
    node.connect(this.output.analyser);
  }

  detachOutput(): void {
    this.outputSource?.disconnect();
    this.outputSource = null;
    this.output = null;
  }

  /** Measure what is playing (a podcast), or stop (`null`). The orb moves to it gently. */
  attachMedia(node: AudioNode | null): void {
    try {
      if (this.mediaSource && this.media) this.mediaSource.disconnect(this.media.analyser);
    } catch {
      // Already disconnected along with everything else; nothing left to undo.
    }
    this.mediaSource = node;
    this.media = node ? new Channel(this.context, 40, 260) : null;
    if (node && this.media) node.connect(this.media.analyser);
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
    } else if (this.media) {
      // The voice is quiet: the orb sways to what is playing, at a lower level.
      const freq = this.media.update(dtMs);
      toBands(freq, this.media.binHz, this.bandsRaw);
      for (let b = 0; b < 4; b++) this.bandsRaw[b]! *= MEDIA_LEVEL;
      snap.output = this.media.level.value * MEDIA_LEVEL;
      const spectrum = this.media.spectrum.values;
      for (let i = 0; i < spectrum.length; i++) snap.spectrumOut[i] = spectrum[i]! * MEDIA_LEVEL;
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
