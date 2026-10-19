/**
 * Development-only controls. Loaded behind `import.meta.env.DEV`, so production builds
 * contain none of this: the running product takes no keyboard input.
 *
 *   Space / →   next state        ←   previous state
 *   1–5         zen, listening, thinking, speaking, error
 *   D           show each display component in turn, then clear (the orb moves aside)
 *   P           frame-time readout
 *   V           simulated voice output (drives `speaking` without a voice session)
 *   A           voice preview: talking moves zen → listening, silence moves back
 *               (on by default while no voice key is set; picking a state turns it off)
 *   W           wake: start a voice session as if the wake word was heard
 */
import { ORB_STATES } from '@ephemeralos/shared';
import type { LevelsSnapshot } from '../audio/audio-levels.ts';
import type { Orb } from '../orb/orb.ts';
import type { PerfOverlay } from '../perf/perf-overlay.ts';
import type { DisplayManager } from '../display/display-manager.ts';
import { DEMO_DISPLAYS } from './demo-displays.ts';

export interface DevToolsHost {
  orb: Orb;
  perf: PerfOverlay;
  display: DisplayManager;
  /** Start a voice session, if voice is set up. */
  wake(): void;
}

export interface DevTools {
  /** Overlay simulated output levels onto the live snapshot. */
  decorate(levels: LevelsSnapshot, now: number): void;
  /** Real voice drives the orb once it's available, so the preview steps aside. */
  setVoiceAvailable(available: boolean): void;
}

/** Mic level that counts as talking, and how long silence lasts before zen returns. */
const PREVIEW_THRESHOLD = 0.3;
const PREVIEW_HANG_MS = 1500;

export function installDevTools({ orb, perf, display, wake }: DevToolsHost): DevTools {
  let simulateVoice = true;
  let voicePreview = true;
  let lastVoice = -Infinity;
  let demo = -1;
  const nextDemo = (): void => {
    demo = demo + 1 > DEMO_DISPLAYS.length - 1 ? -1 : demo + 1;
    if (demo < 0) display.screen({ action: 'dismiss_all' });
    else display.display(DEMO_DISPLAYS[demo]);
  };

  const step = (delta: number): void => {
    const i = ORB_STATES.indexOf(orb.state);
    orb.setState(ORB_STATES[(i + delta + ORB_STATES.length) % ORB_STATES.length]!);
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    const manual = (digit >= 1 && digit <= ORB_STATES.length) || event.key.startsWith('Arrow');
    if (manual || event.key === ' ') voicePreview = false;
    if (digit >= 1 && digit <= ORB_STATES.length) orb.setState(ORB_STATES[digit - 1]!);
    else if (event.key === ' ' || event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'a') voicePreview = !voicePreview;
    else if (event.key === 'd') nextDemo();
    else if (event.key === 'p') perf.toggle();
    else if (event.key === 'v') simulateVoice = !simulateVoice;
    else if (event.key === 'w') wake();
    else return;
    event.preventDefault();
    console.info(
      `[dev] state=${orb.state} display=${demo} voice=${simulateVoice} preview=${voicePreview}`,
    );
  });

  console.info(
    '[dev] orb shortcuts: Space/←/→ cycle, 1–5 pick, A preview, D displays, P perf, V voice, W wake',
  );

  return {
    setVoiceAvailable(available) {
      if (!available) return;
      voicePreview = false;
      simulateVoice = false;
    },
    decorate(levels, now) {
      if (voicePreview && (orb.state === 'zen' || orb.state === 'listening')) {
        if (levels.input > PREVIEW_THRESHOLD) {
          lastVoice = now;
          orb.setState('listening');
        } else if (orb.state === 'listening' && now - lastVoice > PREVIEW_HANG_MS) {
          orb.setState('zen');
        }
      }
      if (!simulateVoice || orb.state !== 'speaking' || levels.output > 0.02) return;
      // Syllable-ish envelope: a fast carrier gated by a slower phrase rhythm.
      const t = now / 1000;
      const phrase = Math.max(0, Math.sin(t * 1.3) * 0.6 + 0.5);
      const syllable = 0.5 + 0.5 * Math.sin(t * 11.0 + Math.sin(t * 3.1) * 2.0);
      const out = Math.min(1, phrase * (0.35 + 0.65 * syllable));
      levels.output = out;
      levels.bands[0] = out * (0.7 + 0.3 * Math.sin(t * 7.0));
      levels.bands[1] = out * (0.6 + 0.4 * Math.sin(t * 9.0 + 1.0));
      levels.bands[2] = out * (0.45 + 0.35 * Math.sin(t * 13.0 + 2.0));
      levels.bands[3] = out * (0.25 + 0.25 * Math.sin(t * 17.0 + 3.0));
      // Two drifting formants over a falling tilt, roughly the shape of a voice.
      const f1 = 0.22 + 0.08 * Math.sin(t * 2.3);
      const f2 = 0.55 + 0.12 * Math.sin(t * 1.7 + 1.0);
      const n = levels.spectrumOut.length;
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        const peaks =
          Math.exp(-(((x - f1) / 0.08) ** 2)) + 0.7 * Math.exp(-(((x - f2) / 0.1) ** 2));
        levels.spectrumOut[i] = out * Math.min(1, 0.25 * (1 - x) + 0.8 * peaks);
      }
    },
  };
}
