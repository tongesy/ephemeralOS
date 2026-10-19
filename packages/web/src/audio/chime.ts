/*
 * The one sound ephemeralOS makes of its own: a soft two-note chime when the microphone
 * is open and the orb can hear you (rising), and when it goes back to sleep (falling).
 * Synthesised, so there is nothing to load: two sine tones, each with a quiet octave
 * overtone, a quick attack and a long, bell-like decay.
 */

const NOTES = { open: [659.25, 987.77], close: [783.99, 523.25] } as const;
const GAP_S = 0.09;
const DECAY_S = 0.9;
const LEVEL = 0.07;

export type Chime = keyof typeof NOTES;

export function playChime(context: AudioContext, kind: Chime): void {
  if (context.state !== 'running') return;
  const out = context.createGain();
  out.gain.value = LEVEL;
  out.connect(context.destination);
  const start = context.currentTime + 0.01;
  NOTES[kind].forEach((frequency, i) => {
    const at = start + i * GAP_S;
    for (const [multiple, weight] of [
      [1, 1],
      [2, 0.18],
    ] as const) {
      const tone = context.createOscillator();
      tone.frequency.value = frequency * multiple;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(weight, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + DECAY_S / multiple);
      tone.connect(envelope).connect(out);
      tone.start(at);
      tone.stop(at + DECAY_S + 0.05);
    }
  });
  setTimeout(() => out.disconnect(), (GAP_S + DECAY_S + 0.2) * 1000);
}
