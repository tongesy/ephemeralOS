import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';

import { AudioLevels } from './audio/audio-levels.ts';
import type { DevTools } from './dev/dev-tools.ts';
import { GatewayClient } from './gateway-client.ts';
import { Orb } from './orb/orb.ts';
import { FrameMeter, QualityGovernor } from './perf/frame-meter.ts';
import { PerfOverlay } from './perf/perf-overlay.ts';
import { applyPalette } from './theme/palette.ts';

applyPalette();

const canvas = document.querySelector<HTMLCanvasElement>('#orb')!;
const hint = document.querySelector<HTMLParagraphElement>('#hint')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const orb = new Orb(canvas, { reducedMotion });
const audio = new AudioLevels();
const meter = new FrameMeter();
const perf = new PerfOverlay();
const maxRatio = Math.min(window.devicePixelRatio, 2);
const quality = new QualityGovernor(maxRatio, maxRatio, (ratio) => orb.setPixelRatio(ratio));

if (new URLSearchParams(location.search).has('perf')) perf.toggle(true);

let devTools: DevTools | null = null;
if (import.meta.env.DEV) {
  const { installDevTools } = await import('./dev/dev-tools.ts');
  devTools = installDevTools({ orb, perf });
}

window.addEventListener('resize', () => orb.resize());

// --- Microphone: the one permitted click --------------------------------------
function showHint(text: string | null): void {
  if (text) {
    hint.textContent = text;
    hint.hidden = false;
    requestAnimationFrame(() => hint.toggleAttribute('data-visible', true));
  } else {
    hint.toggleAttribute('data-visible', false);
  }
}

// Browsers keep audio suspended until a user gesture, which may come before or after
// the microphone prompt resolves; listen from the start so neither order loses it.
const unlock = (): void => {
  void audio.resume().then(() => showHint(null));
};
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

async function startAudio(): Promise<void> {
  try {
    await audio.attachMicrophone();
  } catch (error) {
    console.warn('[audio] microphone unavailable:', error);
    orb.setState('error');
    showHint('Microphone access is needed. Allow it in the address bar, then reload.');
    return;
  }
  if (!audio.running) showHint('Click once to let me hear you');
}

void startAudio();

// --- Gateway ---------------------------------------------------------------
const gateway = GatewayClient.fromPage();
if (gateway) {
  gateway.onMessage((msg) => {
    if (msg.type === 'welcome') console.info(`[gateway] connected, protocol ${msg.protocol}`);
  });
  gateway.connect();
} else {
  console.warn('[gateway] no launch token on the page; start with `pnpm dev` or `pnpm start`');
}

// --- Frame loop --------------------------------------------------------------
let last = performance.now();
function tick(now: number): void {
  // Clamp so a backgrounded tab doesn't fast-forward every animation on return.
  const dt = Math.min(now - last, 100);
  last = now;

  const levels = audio.update(dt);
  devTools?.decorate(levels, now);
  orb.frame(dt, levels);

  meter.record(dt);
  const stats = meter.stats();
  quality.update(stats.p95Ms, dt);
  perf.update(now, stats, quality.pixelRatio);

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
