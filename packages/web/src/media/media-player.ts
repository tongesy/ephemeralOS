import {
  ARTWORK_PATH,
  MEDIA_PATH,
  MediaArgs,
  POSTERS_PATH,
  YOUTUBE_EMBED_ORIGIN,
  type MediaItem,
} from '@ephemeralos/shared';
import { conceal, reveal } from '../display/motion.ts';
import type { Rect } from '../orb/placement.ts';
import {
  STAGE_MS,
  VOLUME_STEP,
  YT_ENDED,
  YT_PAUSED,
  YT_PLAYING,
  clock,
  docked,
  effectiveVolume,
  embedUrl,
  episodeLine,
  playerCommand,
  readPlayerMessage,
} from './playback.ts';

/** Something left paused this long is put away. */
const IDLE_MS = 10 * 60_000;
const SKIP_SECONDS = 30;

export interface MediaPlayerHost {
  context: AudioContext;
  /** The sound of what is playing, for the orb to move to; null when there is none. */
  measure(node: AudioNode | null): void;
  /** The space the player takes, so the orb can keep clear of it. */
  onLayout(occupied: Rect[]): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * What is playing: one podcast episode or video at a time. It arrives on stage (large,
 * beside the orb) and settles into the corner when something else is shown or, for a
 * podcast, once it is under way. It keeps playing after the conversation ends, drops to a
 * murmur while one is open, and goes when it finishes, is stopped, or sits paused a while.
 */
export class MediaPlayer {
  private item: MediaItem | null = null;
  private el: HTMLElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private frame: HTMLIFrameElement | null = null;
  private readonly gain: GainNode;
  private readonly video = { state: -1, time: 0, duration: 0 };
  private volume = 1;
  private conversing = false;
  private screenBusy = false;
  private stagedAt = 0;
  private isDocked = false;
  private dockTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every change of item, so a slow transition for an old one stops. */
  private generation = 0;

  constructor(private readonly host: MediaPlayerHost) {
    this.gain = host.context.createGain();
    this.gain.connect(host.context.destination);
    window.addEventListener('message', (event) => this.onFrameMessage(event));
    window.addEventListener('resize', () => this.report());
  }

  get playing(): boolean {
    return this.item !== null;
  }

  play(item: MediaItem): void {
    this.finish();
    const generation = ++this.generation;
    this.item = item;
    this.video.state = -1;
    this.video.time = this.video.duration = 0;
    const el = item.kind === 'audio' ? this.audioSurface(item) : this.videoSurface(item);
    this.el = el;
    this.isDocked = false;
    this.stagedAt = performance.now();
    this.applyVolume(true);
    document.body.append(el);
    reveal(el, 140);
    requestAnimationFrame(() => {
      if (generation !== this.generation) return;
      el.toggleAttribute('data-shown', true);
      this.relayout();
    });
  }

  /** A conversation opened or closed: play quietly underneath it, and come forward. */
  setConversing(on: boolean): void {
    this.conversing = on;
    if (!on) this.stagedAt = performance.now();
    this.applyVolume(false);
    this.relayout();
  }

  /** Other content is (or is no longer) on screen; it takes the stage. */
  setScreenBusy(busy: boolean): void {
    if (busy === this.screenBusy) return;
    this.screenBusy = busy;
    this.relayout();
  }

  /** Handle a `media` call. Returns the JSON result for the model. */
  act(rawArgs: unknown): string {
    const parsed = MediaArgs.safeParse(rawArgs);
    if (!parsed.success) return JSON.stringify({ error: parsed.error.issues[0]?.message });
    const item = this.item;
    if (!item) return JSON.stringify({ note: 'Nothing is playing.' });
    const { action, seconds = SKIP_SECONDS } = parsed.data;
    switch (action) {
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'stop':
        this.finish();
        return JSON.stringify({ ok: true, note: 'Stopped.' });
      case 'forward':
      case 'back':
        this.seek(this.position() + (action === 'forward' ? seconds : -seconds));
        break;
      case 'restart':
        this.seek(0);
        this.resume();
        break;
      case 'louder':
      case 'quieter':
        this.volume = Math.min(
          Math.max(this.volume + (action === 'louder' ? VOLUME_STEP : -VOLUME_STEP), 0.2),
          1,
        );
        this.applyVolume(false);
        break;
      case 'status':
        break;
    }
    return JSON.stringify({ ok: true, ...this.status() });
  }

  status(): Record<string, unknown> {
    const item = this.item;
    if (!item) return { playing: null };
    const length = item.kind === 'audio' ? (this.audio?.duration ?? 0) : this.video.duration;
    return {
      playing: item.title,
      ...(item.by && { by: item.by }),
      kind: item.kind === 'audio' ? 'podcast' : 'video',
      paused: this.paused(),
      position: clock(this.position()),
      ...(Number.isFinite(length) && length > 0 && { length: clock(length) }),
      volume: `${Math.round(this.volume * 100)}%`,
    };
  }

  // --- Surfaces ---------------------------------------------------------------------

  private audioSurface(item: Extract<MediaItem, { kind: 'audio' }>): HTMLElement {
    const el = element('section', 'media media--audio glass');
    el.setAttribute('aria-label', `Playing ${item.title}`);
    if (item.artwork) {
      const art = element('img', 'media__art');
      art.alt = '';
      art.decoding = 'async';
      art.src = `${ARTWORK_PATH}${encodeURIComponent(item.artwork)}`;
      art.addEventListener('load', () => art.setAttribute('data-loaded', ''), { once: true });
      art.addEventListener('error', () => art.remove(), { once: true });
      el.append(art);
    }
    const text = element('div', 'media__text');
    if (item.by) text.append(element('p', 'media__by', item.by));
    text.append(element('h2', 'media__title', item.title));
    const line = episodeLine(item.published, item.durationSeconds);
    if (line) text.append(element('p', 'media__meta', line));
    const progress = element('div', 'media__progress');
    const bar = element('span', 'media__bar');
    progress.append(bar);
    const times = element('p', 'media__time');
    const elapsed = element('span', '', '0:00');
    const left = element('span', '', item.durationSeconds ? `−${clock(item.durationSeconds)}` : '');
    times.append(elapsed, left);
    el.append(text, progress, times);

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = `${MEDIA_PATH}${item.id}`;
    audio.addEventListener('timeupdate', () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : (item.durationSeconds ?? 0);
      bar.style.transform = `scaleX(${d ? Math.min(audio.currentTime / d, 1) : 0})`;
      elapsed.textContent = clock(audio.currentTime);
      if (d) left.textContent = `−${clock(d - audio.currentTime)}`;
    });
    audio.addEventListener('play', () => this.markPaused(false));
    audio.addEventListener('pause', () => this.markPaused(!audio.ended));
    audio.addEventListener('ended', () => this.finish());
    audio.addEventListener('error', () => {
      console.warn('[media] the episode could not be played');
      this.finish();
    });
    // Through Web Audio, so the volume can duck smoothly and the orb can hear it.
    this.source = this.host.context.createMediaElementSource(audio);
    this.source.connect(this.gain);
    this.host.measure(this.source);
    this.audio = audio;
    audio.play().catch((error: unknown) => console.warn('[media] playback blocked:', error));
    return el;
  }

  private videoSurface(item: Extract<MediaItem, { kind: 'video' }>): HTMLElement {
    const el = element('section', 'media media--video');
    el.setAttribute('aria-label', `Playing ${item.title}`);
    const screen = element('div', 'media__screen');
    // Poster first: the frame fades in over it once the video is actually playing.
    const poster = element('img', 'media__poster');
    poster.alt = '';
    poster.decoding = 'async';
    poster.src = `${POSTERS_PATH}${item.youtube}`;
    poster.addEventListener('load', () => poster.setAttribute('data-loaded', ''), { once: true });
    poster.addEventListener('error', () => poster.remove(), { once: true });
    const frame = element('iframe', 'media__frame');
    frame.title = item.title;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    // YouTube's player refuses to start without a referrer (error 153); the rest of the
    // page sends none.
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    frame.src = embedUrl(item.youtube, location.origin);
    frame.addEventListener('load', () => {
      // Ask the player to report its state and time.
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        YOUTUBE_EMBED_ORIGIN,
      );
      this.applyVolume(true);
    });
    screen.append(poster, frame);
    const caption = element('div', 'media__caption');
    if (item.by) caption.append(element('p', 'media__by', item.by));
    caption.append(element('h2', 'media__title', item.title));
    el.append(screen, caption);
    this.frame = frame;
    return el;
  }

  private onFrameMessage(event: MessageEvent): void {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const report = readPlayerMessage(event.origin, event.data);
    if (!report) return;
    if (report.time !== undefined) this.video.time = report.time;
    if (report.duration !== undefined) this.video.duration = report.duration;
    if (report.state === undefined || report.state === this.video.state) return;
    this.video.state = report.state;
    if (report.state === YT_PLAYING) this.el?.toggleAttribute('data-playing', true);
    if (report.state === YT_PLAYING || report.state === YT_PAUSED) {
      this.markPaused(report.state === YT_PAUSED);
    }
    if (report.state === YT_ENDED) this.finish();
  }

  // --- Playback ---------------------------------------------------------------------

  private command(func: string, args: unknown[] = []): void {
    this.frame?.contentWindow?.postMessage(playerCommand(func, args), YOUTUBE_EMBED_ORIGIN);
  }

  private pause(): void {
    if (this.audio) this.audio.pause();
    else this.command('pauseVideo');
    this.markPaused(true);
  }

  private resume(): void {
    if (this.audio) {
      void this.audio
        .play()
        .catch((error: unknown) => console.warn('[media] playback blocked:', error));
    } else this.command('playVideo');
    this.markPaused(false);
  }

  private seek(seconds: number): void {
    const to = Math.max(0, seconds);
    if (this.audio) {
      const end = Number.isFinite(this.audio.duration) ? this.audio.duration - 1 : to;
      this.audio.currentTime = Math.min(to, Math.max(end, 0));
    } else {
      this.command('seekTo', [to, true]);
      this.video.time = to;
    }
  }

  private position(): number {
    return this.audio ? this.audio.currentTime : this.video.time;
  }

  private paused(): boolean {
    return this.audio ? this.audio.paused : this.video.state === YT_PAUSED;
  }

  private markPaused(paused: boolean): void {
    this.el?.toggleAttribute('data-paused', paused);
    clearTimeout(this.idleTimer);
    if (paused) this.idleTimer = setTimeout(() => this.finish(), IDLE_MS);
  }

  private applyVolume(immediate: boolean): void {
    const level = effectiveVolume(this.volume, this.conversing);
    const now = this.host.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    if (immediate) this.gain.gain.setValueAtTime(level, now);
    // Down quickly when you start talking, back up gently after.
    else this.gain.gain.setTargetAtTime(level, now, this.conversing ? 0.08 : 0.4);
    if (this.frame) this.command('setVolume', [Math.round(level * 100)]);
  }

  /** Go: fade the surface out and let everything go. */
  private finish(): void {
    if (!this.item) return;
    this.generation++;
    this.item = null;
    clearTimeout(this.dockTimer);
    clearTimeout(this.idleTimer);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.host.measure(null);
    // Silence the video now; its frame goes with the surface once it has faded.
    if (this.frame) this.command('pauseVideo');
    this.frame = null;
    const el = this.el;
    this.el = null;
    if (el) {
      el.toggleAttribute('data-shown', false);
      const remove = () => el.remove();
      el.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 1500);
    }
    this.report();
  }

  // --- Placement --------------------------------------------------------------------

  private relayout(): void {
    const item = this.item;
    const el = this.el;
    if (!item || !el) return;
    clearTimeout(this.dockTimer);
    const sinceStageMs = performance.now() - this.stagedAt;
    const dock = docked({
      kind: item.kind,
      screenBusy: this.screenBusy,
      conversing: this.conversing,
      sinceStageMs,
    });
    // Check again when a podcast's time on stage is up.
    if (!dock && item.kind === 'audio' && !this.conversing) {
      this.dockTimer = setTimeout(() => this.relayout(), STAGE_MS - sinceStageMs + 50);
    }
    if (dock === this.isDocked) {
      this.report();
      return;
    }
    this.isDocked = dock;
    if (item.kind === 'video') {
      // The frame can't be rebuilt without restarting the video, so it glides instead.
      el.classList.toggle('is-docked', dock);
      this.report();
      setTimeout(() => this.report(), 950);
      return;
    }
    const generation = this.generation;
    void conceal(el).then(() => {
      if (generation !== this.generation) return;
      // The same content comes back, so let go of the fade that hid it.
      for (const animation of el.getAnimations({ subtree: true })) animation.cancel();
      el.classList.toggle('is-docked', dock);
      reveal(el, 60);
      this.report();
    });
  }

  private report(): void {
    if (!this.el) {
      this.host.onLayout([]);
      return;
    }
    const { x, y, width, height } = this.el.getBoundingClientRect();
    this.host.onLayout([{ x, y, width, height }]);
  }
}
