import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/surface.css';

import { AudioLevels } from './audio/audio-levels.ts';
import { playChime } from './audio/chime.ts';
import type { DevTools } from './dev/dev-tools.ts';
import { DisplayManager } from './display/display-manager.ts';
import { GatewayClient } from './gateway-client.ts';
import { connectRealtime } from './voice/realtime-client.ts';
import { VoiceSession } from './voice/voice-session.ts';
import { WakeWord } from './wake/wake-word.ts';
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
// Render at the display's full density (the orb is small, so this is cheap), and never
// let the governor drop below one buffer pixel per CSS pixel: softness reads as blur.
const maxRatio = Math.min(window.devicePixelRatio, 3);
const quality = new QualityGovernor(maxRatio, maxRatio, (ratio) => orb.setPixelRatio(ratio), 1);

if (new URLSearchParams(location.search).has('perf')) perf.toggle(true);

let voice: VoiceSession | null = null;

/** The screen: content fades in and out; the orb moves into whatever space is left. */
const display = new DisplayManager((occupied) => orb.setOccupied(occupied));

/** Tools the voice model calls that act on this page directly. */
function localTool(name: string, args: string): string | null {
  if (name !== 'display' && name !== 'screen') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args || '{}');
  } catch {
    return JSON.stringify({ error: 'Arguments were not valid JSON' });
  }
  return name === 'display' ? display.display(parsed) : display.screen(parsed);
}

let devTools: DevTools | null = null;
if (import.meta.env.DEV) {
  const { installDevTools } = await import('./dev/dev-tools.ts');
  devTools = installDevTools({ orb, perf, display, wake: () => void voice?.start() });
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

/** What to say once the page can hear: how to start talking, or what setup is missing. */
let readyHint: { text: string; holdMs?: number } | null = null;
let readyTimer: ReturnType<typeof setTimeout> | undefined;

function showReady(): void {
  if (!audio.running) return; // the click hint has priority until audio is unlocked
  clearTimeout(readyTimer);
  showHint(readyHint?.text ?? null);
  if (readyHint?.holdMs) readyTimer = setTimeout(() => showHint(null), readyHint.holdMs);
}

function setReadyHint(text: string | null, holdMs?: number): void {
  readyHint = text ? { text, holdMs } : null;
  showReady();
}

// Browsers keep audio suspended until a user gesture, which may come before or after
// the microphone prompt resolves; listen from the start so neither order loses it.
const unlock = (): void => {
  void audio.resume().then(showReady);
};
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

async function startAudio(): Promise<boolean> {
  try {
    await audio.attachMicrophone();
  } catch (error) {
    console.warn('[audio] microphone unavailable:', error);
    orb.setState('error');
    showHint('Microphone access is needed. Allow it in the address bar, then reload.');
    return false;
  }
  // Some browsers allow audio once the microphone is granted; try before asking for a click.
  await audio.resume().catch(() => undefined);
  if (!audio.running) showHint('Click once to let me hear you');
  return true;
}

// --- Gateway -----------------------------------------------------------------
const gateway = GatewayClient.fromPage();
if (gateway) {
  gateway.onMessage((msg) => {
    if (msg.type === 'welcome') console.info(`[gateway] connected, protocol ${msg.protocol}`);
    // The gateway can put things on screen too (a forecast, and from M4 the brain's results).
    if (msg.type === 'display') display.display(msg.args);
  });
  gateway.connect();
} else {
  console.warn('[gateway] no launch token on the page; start with `pnpm dev` or `pnpm start`');
}

// --- Voice: wake word → Realtime session → sleep ---------------------------------
/** Plays the voice. An <audio> element (not Web Audio) so the browser's echo canceller hears it. */
const player = new Audio();
player.autoplay = true;

function speakLocally(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

const SETUP_HINT = 'Run pnpm ephemeralos init in your terminal to give me a voice';

async function startVoice(gateway: GatewayClient): Promise<void> {
  const status = await gateway.fetchStatus();
  if (!status.voice) {
    console.info('[voice] no OpenAI key yet; run `pnpm ephemeralos init` to add one');
    setReadyHint(SETUP_HINT);
    return;
  }
  const microphone = audio.microphone!;
  let wake: WakeWord | null = null;
  let sessionId = '';

  voice = new VoiceSession({
    settings: status,
    setState: (state) => {
      if (state !== orb.state) console.debug(`[voice] ${state}`);
      orb.setState(state);
    },
    connect: async (handlers) => {
      sessionId = crypto.randomUUID();
      const session = await gateway.realtimeSession();
      return connectRealtime(
        session.clientSecret,
        microphone.stream.getAudioTracks()[0]!,
        handlers,
      );
    },
    callTool: (callId, name, args) => gateway.callTool(callId, name, args),
    localTool,
    transcript: (role, text) => gateway.send({ type: 'transcript', sessionId, role, text }),
    speakFallback: speakLocally,
    audio: (stream) => {
      player.srcObject = stream;
      if (stream) {
        // Autoplay can be refused without a click on the page; say so rather than stay mute.
        player.play().catch((error: unknown) => console.warn('[voice] playback blocked:', error));
        audio.attachOutput(audio.context.createMediaStreamSource(stream));
      } else audio.detachOutput();
    },
    // A chime as the microphone opens, so after the wake word you know when to talk.
    ready: () => playChime(audio.context, 'open'),
    ended: () => {
      playChime(audio.context, 'close');
      display.sessionEnded();
      wake?.listen(true);
    },
  });
  devTools?.setVoiceAvailable(true);

  const begin = (): void => {
    clearTimeout(readyTimer);
    showHint(null);
    wake?.listen(false);
    display.sessionStarted();
    void voice?.start();
  };

  if (status.wakeWord.available) {
    try {
      wake = await WakeWord.start(audio.context, microphone.source, status.wakeWord);
      wake.onWake(begin);
      console.info(`[voice] listening for "${status.wakeWord.phrase}"`);
      setReadyHint(`Say “${status.wakeWord.phrase}”`, 6000);
      return;
    } catch (error) {
      console.warn('[wake] could not start; falling back to click-to-talk', error);
    }
  } else {
    console.info('[voice] wake-word models not installed; click to talk');
  }
  setReadyHint('Click anywhere to talk', 6000);
  // Without a wake word, the one permitted click doubles as push-to-start.
  window.addEventListener('pointerdown', () => {
    if (audio.running && !voice?.active) begin();
  });
}

void startAudio().then((ok) => {
  if (ok && gateway) {
    startVoice(gateway).catch((error: unknown) => {
      // Usually a gateway from before M2, or one that isn't running.
      console.warn('[voice] unavailable:', error);
      setReadyHint(`I can't reach the gateway. Restart it with pnpm start`);
    });
  }
});

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
