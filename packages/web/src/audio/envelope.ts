/**
 * Attack/release envelope follower. Rises quickly with the signal and falls slowly,
 * which is what makes audio-reactive motion feel alive rather than jittery.
 */
export class Envelope {
  value = 0;

  constructor(
    private readonly attackMs = 40,
    private readonly releaseMs = 260,
  ) {}

  update(target: number, dtMs: number): number {
    const tau = target > this.value ? this.attackMs : this.releaseMs;
    const k = 1 - Math.exp(-dtMs / tau);
    this.value += (target - this.value) * k;
    return this.value;
  }
}

/** Map an RMS amplitude onto 0..1 using a decibel window that suits speech. */
export function rmsToLevel(rms: number, floorDb = -60, ceilDb = -12): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(Math.max((db - floorDb) / (ceilDb - floorDb), 0), 1);
}

/** Root mean square of a block of samples. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

/** Frequency ranges (Hz) of the four bands the orb reacts to while speaking. */
export const BAND_EDGES_HZ = [80, 250, 800, 2500, 6000] as const;

/**
 * Average byte-scaled FFT magnitudes into four bands.
 * `bins` is AnalyserNode.getByteFrequencyData output; `binHz` = sampleRate / fftSize.
 */
export function toBands(bins: Uint8Array, binHz: number, out: Float32Array): Float32Array {
  for (let b = 0; b < 4; b++) {
    const lo = Math.max(1, Math.floor(BAND_EDGES_HZ[b]! / binHz));
    const hi = Math.min(bins.length, Math.max(lo + 1, Math.ceil(BAND_EDGES_HZ[b + 1]! / binHz)));
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += bins[i]!;
    out[b] = sum / ((hi - lo) * 255);
  }
  return out;
}

/** Resolution of the spectra the orb maps around its edge. */
export const SPECTRUM_SIZE = 32;

/**
 * Resample byte-scaled FFT magnitudes onto `out.length` log-spaced bins between
 * `minHz` and `maxHz`, so speech's low formants get as much of the orb as its sibilants.
 */
export function toLogSpectrum(
  bins: Uint8Array,
  binHz: number,
  out: Float32Array,
  minHz = 80,
  maxHz = 8000,
): Float32Array {
  const ratio = maxHz / minHz;
  for (let i = 0; i < out.length; i++) {
    const lo = Math.floor((minHz * ratio ** (i / out.length)) / binHz);
    const hi = Math.max(lo + 1, Math.ceil((minHz * ratio ** ((i + 1) / out.length)) / binHz));
    let sum = 0;
    let count = 0;
    for (let b = lo; b < hi && b < bins.length; b++, count++) sum += bins[b]!;
    out[i] = count ? sum / (count * 255) : 0;
  }
  return out;
}

/** An Envelope for every bin of a spectrum. */
export class SpectrumEnvelope {
  readonly values: Float32Array;
  private readonly envs: Envelope[];

  constructor(size = SPECTRUM_SIZE, attackMs = 35, releaseMs = 220) {
    this.values = new Float32Array(size);
    this.envs = Array.from({ length: size }, () => new Envelope(attackMs, releaseMs));
  }

  update(target: Float32Array, dtMs: number): Float32Array {
    for (let i = 0; i < this.values.length; i++) {
      this.values[i] = this.envs[i]!.update(target[i] ?? 0, dtMs);
    }
    return this.values;
  }
}
