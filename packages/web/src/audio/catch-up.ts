/*
 * The first words after the wake word. The Realtime connection takes a second or two to
 * open, and people start talking straight away. So the microphone reaches the connection
 * through a delay line: when the connection opens, the delay is set to how long it took,
 * and the model hears everything from the moment the wake word fired. Once the user
 * pauses, the delay drops back to nothing, so later turns have no lag.
 */

/** The longest wait it can make up for; a slower connection loses only the start. */
export const MAX_CATCH_UP_S = 6;

/** How far behind the connection should listen, given when the wake word fired. */
export function catchUpDelay(wokeAt: number | null, now: number): number {
  if (wokeAt === null) return 0;
  return Math.min(Math.max(now - wokeAt, 0), MAX_CATCH_UP_S);
}

export class MicCatchUp {
  private readonly delay: DelayNode;
  private readonly out: MediaStreamAudioDestinationNode;
  private wokeAt: number | null = null;

  constructor(
    private readonly context: AudioContext,
    source: AudioNode,
  ) {
    this.delay = new DelayNode(context, { maxDelayTime: MAX_CATCH_UP_S + 0.5, delayTime: 0 });
    this.out = context.createMediaStreamDestination();
    this.out.channelCount = 1;
    source.connect(this.delay).connect(this.out);
  }

  /** The microphone as the connection should hear it. */
  get track(): MediaStreamTrack {
    return this.out.stream.getAudioTracks()[0]!;
  }

  /** The wake word fired: the user may start talking now. */
  woke(): void {
    this.wokeAt = this.context.currentTime;
    this.set(0);
  }

  /** The connection is open: play it everything since the wake word. */
  connected(): void {
    this.set(catchUpDelay(this.wokeAt, this.context.currentTime));
    this.wokeAt = null;
  }

  /** The user has paused: skip the backlog (it is silence) and listen live. */
  caughtUp(): void {
    if (this.delay.delayTime.value > 0) this.set(0);
  }

  private set(seconds: number): void {
    this.delay.delayTime.cancelScheduledValues(0);
    this.delay.delayTime.setValueAtTime(seconds, this.context.currentTime);
  }
}
