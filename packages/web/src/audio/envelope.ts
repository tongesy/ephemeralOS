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
