/**
 * Development-only controls. Loaded behind `import.meta.env.DEV`, so production builds
 * contain none of this: the running product takes no keyboard input.
 *
 *   Space / →   next state        ←   previous state
 *   1–5         zen, listening, thinking, speaking, error
 *   D           dock / undock     P   frame-time readout
 *   V           simulated voice output (drives `speaking` without a voice session)
 */
import { ORB_STATES } from '@ephemeralos/shared';
import type { LevelsSnapshot } from '../audio/audio-levels.ts';
import type { Orb } from '../orb/orb.ts';
import type { PerfOverlay } from '../perf/perf-overlay.ts';

export interface DevToolsHost {
  orb: Orb;
  perf: PerfOverlay;
}

export interface DevTools {
  /** Overlay simulated output levels onto the live snapshot. */
  decorate(levels: LevelsSnapshot, now: number): void;
}

export function installDevTools({ orb, perf }: DevToolsHost): DevTools {
  let simulateVoice = true;

  const step = (delta: number): void => {
    const i = ORB_STATES.indexOf(orb.state);
    orb.setState(ORB_STATES[(i + delta + ORB_STATES.length) % ORB_STATES.length]!);
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (digit >= 1 && digit <= ORB_STATES.length) orb.setState(ORB_STATES[digit - 1]!);
    else if (event.key === ' ' || event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'd') orb.setDocked(!orb.docked);
    else if (event.key === 'p') perf.toggle();
    else if (event.key === 'v') simulateVoice = !simulateVoice;
    else return;
    event.preventDefault();
    console.info(`[dev] state=${orb.state} docked=${orb.docked} voice=${simulateVoice}`);
  });

  console.info('[dev] orb shortcuts: Space/←/→ cycle, 1–5 pick, D dock, P perf, V voice');

  return {
    decorate(levels, now) {
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
    },
  };
}
