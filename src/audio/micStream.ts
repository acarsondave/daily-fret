// Microphone input graph: getUserMedia -> AudioContext -> AudioWorklet, emitting
// fixed-size mono frames. Knows nothing about what listens to them.
//
// This was the top half of ChordCapture. The tuner needs the same graph with a
// different analyser attached, and the parts worth getting right — partial
// teardown on failure, StrictMode double-invoke, iOS suspended contexts, a dead
// preferred device — are exactly the parts nobody should own twice.

import { beginMicOpen, clearLiveMic, endMicOpen, registerLiveMic } from './liveMic';

// Served verbatim from /public so addModule always gets a real, same-origin
// classic script. BASE_URL keeps it correct under any deploy sub-path.
const WORKLET_URL = `${import.meta.env.BASE_URL}pcm-worklet.js`;

/**
 * Why the microphone is not producing sound, in terms the surface can act on.
 * Every one of these has a different way out, so collapsing them into a single
 * "mic failed" would leave the user reading the wrong instructions.
 */
export type MicFailureKind =
  | 'insecure' // page is not on https, so the browser hides the microphone entirely
  | 'unsupported' // the browser has no capture API at all
  | 'denied' // the user, or a system setting, refused
  | 'no-device' // nothing is plugged in
  | 'device-busy' // another app or tab holds the input
  | 'failed'; // anything else, message preserved

export class MicError extends Error {
  readonly kind: MicFailureKind;

  constructor(kind: MicFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MicError';
    this.kind = kind;
  }
}

/**
 * What the input route is doing right now.
 *
 * 'asleep' covers both 'suspended' and WebKit's own 'interrupted': the graph is
 * built and the permission is granted, but no samples are arriving and none will
 * until a user gesture wakes it. 'muted' is the opposite trade — the route is
 * live but the track is silent, which is what a phone call or another app taking
 * the microphone looks like from in here.
 *
 * 'closed' is the one with no way back: the graph is gone, or the track has
 * ended. A track ends when the permission is revoked mid-session or the input it
 * was reading is unplugged, and nothing about the context changes when it
 * happens — it stays 'running' over an input that no longer exists. Waking it
 * cannot help; the capture has to be opened again.
 */
export type MicRouteState = 'running' | 'asleep' | 'muted' | 'closed';

/** A track flickers muted at startup on some devices; only a sustained one counts. */
const MUTE_GRACE_MS = 1200;

function describeFailure(err: unknown): MicError {
  if (err instanceof MicError) return err;
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new MicError('denied', 'The browser is not letting this page use the microphone.', { cause: err });
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new MicError('no-device', 'No microphone was found on this device.', { cause: err });
      case 'NotReadableError':
      case 'AbortError':
        return new MicError('device-busy', 'The microphone is busy, most likely in another app or tab.', { cause: err });
      // Without this the default branch printed the browser's own bare
      // "Not supported" as the whole explanation, which reads as a bug report
      // rather than a reason.
      case 'NotSupportedError':
        return new MicError('unsupported', 'This browser cannot open a microphone for this page.', { cause: err });
      default:
        return new MicError('failed', err.message || 'The microphone could not be opened.', { cause: err });
    }
  }
  return new MicError(
    'failed',
    err instanceof Error && err.message ? err.message : 'The microphone could not be opened.',
    { cause: err },
  );
}

export interface MicStreamHandlers {
  /** Specific mic to capture from; omitted = system default. */
  deviceId?: string;
  /** Fired once the context exists, before any frame arrives. */
  onReady?: (info: { sampleRate: number }) => void;
  onFrame: (frame: Float32Array) => void;
  /** Fired on every route change, and once as soon as the graph is built. */
  onRouteChange?: (state: MicRouteState) => void;
}

// Disable the browser's voice-oriented processing — it mangles a guitar's
// harmonics (and a headset's onboard DSP can suppress the guitar as "noise").
function audioConstraints(deviceId?: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

export class MicStream {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private disposed = false;
  private starting = false;
  private detachResume: (() => void) | null = null;
  private detachRoute: (() => void) | null = null;
  private muteTimer: number | null = null;
  private muted = false;
  // The track has ended: revoked, unplugged, or claimed by something that does
  // not give it back. Kept here rather than read from the track on demand
  // because the track reference is dropped on teardown and the answer has to
  // survive long enough for a listener to be told.
  private ended = false;
  private onRouteChange: ((state: MicRouteState) => void) | null = null;

  get running(): boolean {
    return this.ctx !== null || this.starting;
  }

  get sampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  get routeState(): MicRouteState {
    // Asked before the context, because a context stays 'running' quite happily
    // over a track that has ended. That is the whole defect this answers: a
    // drill scoring zero behind a screen that says it is listening.
    if (this.ended) return 'closed';
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return 'closed';
    if (ctx.state !== 'running') return 'asleep';
    return this.muted ? 'muted' : 'running';
  }

  /**
   * Open the microphone and build the graph.
   *
   * The body is `openGraph`; this wrapper exists only to bracket it with the
   * live-mic registry's "a microphone is on its way" flag. Bracketing here
   * rather than inside means no exit path can forget it: the body throws from
   * six places and returns early from three more, and a recorder left waiting
   * on a microphone that failed to open would sit there until its timeout and
   * then film silence.
   */
  async start(handlers: MicStreamHandlers): Promise<void> {
    if (this.ctx || this.starting) return;
    beginMicOpen();
    try {
      await this.openGraph(handlers);
    } finally {
      endMicOpen();
    }
  }

  private async openGraph(handlers: MicStreamHandlers): Promise<void> {
    this.disposed = false;
    this.starting = true;
    this.ended = false;
    this.onRouteChange = handlers.onRouteChange ?? null;

    // A page served over plain http has no navigator.mediaDevices at all, and
    // reaching through it throws a TypeError whose text ends up in front of the
    // user. Name the real problem instead.
    if (!navigator.mediaDevices?.getUserMedia) {
      this.starting = false;
      throw window.isSecureContext
        ? new MicError('unsupported', 'This browser cannot record audio.')
        : new MicError('insecure', 'The microphone is only available over a secure (https) connection.');
    }

    // StrictMode (and rapid open/close) can call stop() mid-startup. Re-check
    // `disposed` after every await and tear down any partial graph if so.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(handlers.deviceId),
      });
    } catch (err) {
      // The preferred device may be gone (unplugged headset); fall back to the
      // system default rather than failing the whole session.
      // NotReadableError belongs here too: a stored device that is busy is a
      // stored device that cannot be used right now, and the system default
      // usually can. Without it, picking a mic once and later leaving another
      // app holding it hard-failed the drill instead of falling back.
      if (
        handlers.deviceId &&
        err instanceof DOMException &&
        (err.name === 'OverconstrainedError' ||
          err.name === 'NotFoundError' ||
          err.name === 'NotReadableError')
      ) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
        } catch (fallbackErr) {
          this.starting = false;
          throw describeFailure(fallbackErr);
        }
      } else {
        this.starting = false;
        throw describeFailure(err);
      }
    }
    if (this.disposed) return this.teardown();

    // From here on a failure (context creation, worklet fetch) must tear down
    // the partial graph. Leaving it leaks the live mic stream and an open
    // AudioContext per retry; browsers cap concurrent contexts, and once the
    // tab exhausts them every sound in the app (sfx, voice, detection) goes
    // dead until reload.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      await this.teardown();
      throw describeFailure(err);
    }
    if (this.disposed) return this.teardown();

    handlers.onReady?.({ sampleRate: ctx.sampleRate });

    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-frame-processor');
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      handlers.onFrame(event.data);
    };

    // Muted sink keeps the worklet in the active graph without monitoring the
    // mic back to the speakers (which would cause feedback).
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;

    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);

    // Offer this track to anything that needs guitar audio without opening a
    // second microphone (see ./liveMic.ts). Registered only once the graph is
    // complete, so nothing can clone a track from a capture that is about to
    // fail and be torn down.
    registerLiveMic(this.stream.getAudioTracks()[0] ?? null);

    this.watchRoute(ctx);
    this.attachResumeOnGesture(ctx);
    this.wake();
    this.starting = false;

    // Fired last, once the graph can actually carry sound, so a listener that
    // reacts to 'running' is never told so before there is anything to hear.
    this.emitRoute();
  }

  /**
   * Ask the browser to start the route. Safe to call from anywhere; free to call
   * from inside a user gesture, which is the only moment WebKit ever says yes.
   *
   * Deliberately never awaited. WebKit leaves the promise from a denied resume()
   * pending forever rather than rejecting it, so awaiting it stalls whatever is
   * upstream. That stall is what this file was doing: the context is created
   * after `await getUserMedia`, by which point the click that opened the tuner
   * has long expired, so on Safari it started suspended, resume() was refused,
   * and start() never returned. The tuner sat on screen saying "listening" and
   * heard nothing. outputContext.ts had already learned this; the capture side
   * had not. A refused resume is not an error worth reporting either — the route
   * state says so, and the next gesture tries again.
   */
  wake(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    void Promise.resolve(ctx.resume()).catch(() => {
      /* refused; routeState still reads 'asleep' and the next gesture retries */
    });
  }

  private emitRoute(): void {
    this.onRouteChange?.(this.routeState);
  }

  // Both halves of "the graph is up but nothing is coming through": the context
  // being suspended or interrupted, and the track itself going silent because
  // something else claimed the input. Neither raises an error, and without
  // watching for them a dead tuner is indistinguishable from a quiet room.
  private watchRoute(ctx: AudioContext): void {
    const onState = () => this.emitRoute();
    ctx.addEventListener('statechange', onState);

    const track = this.stream?.getAudioTracks()[0] ?? null;
    const clearMuteTimer = () => {
      if (this.muteTimer !== null) {
        clearTimeout(this.muteTimer);
        this.muteTimer = null;
      }
    };
    const onMute = () => {
      clearMuteTimer();
      this.muteTimer = window.setTimeout(() => {
        this.muteTimer = null;
        this.muted = true;
        this.emitRoute();
      }, MUTE_GRACE_MS);
    };
    const onUnmute = () => {
      clearMuteTimer();
      if (!this.muted) return;
      this.muted = false;
      this.emitRoute();
    };
    // The event a revoked permission or an unplugged interface actually fires.
    // Nothing else reports it: the context keeps saying 'running', no error is
    // raised, and the frames simply stop. Immediate and ungraced, unlike mute:
    // an ended track never comes back.
    const onEnded = () => {
      clearMuteTimer();
      if (this.ended) return;
      this.ended = true;
      this.emitRoute();
    };
    track?.addEventListener('mute', onMute);
    track?.addEventListener('unmute', onUnmute);
    track?.addEventListener('ended', onEnded);
    if (track?.muted) onMute();
    // It can have ended between getUserMedia resolving and this line.
    if (track?.readyState === 'ended') onEnded();

    this.detachRoute = () => {
      ctx.removeEventListener('statechange', onState);
      track?.removeEventListener('mute', onMute);
      track?.removeEventListener('unmute', onUnmute);
      track?.removeEventListener('ended', onEnded);
      clearMuteTimer();
      this.detachRoute = null;
    };
  }

  // Safari routinely leaves an AudioContext suspended until a user gesture
  // lands, and can take a running one back to 'interrupted' at any point after
  // that — a call, another tab, the screen locking. The listeners therefore stay
  // for the life of the stream instead of detaching the first time the context
  // runs, because "it started fine" is no guarantee it is still running a minute
  // later. Each one costs an early return when the route is already up.
  private attachResumeOnGesture(ctx: AudioContext): void {
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'touchend', 'keydown'];
    const resume = () => {
      if (ctx.state === 'running') return;
      this.wake();
    };
    events.forEach((e) => document.addEventListener(e, resume, { passive: true }));
    this.detachResume = () => {
      events.forEach((e) => document.removeEventListener(e, resume));
      this.detachResume = null;
    };
  }

  async stop(): Promise<void> {
    this.disposed = true;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.starting = false;
    this.onRouteChange = null;
    this.detachResume?.();
    this.detachRoute?.();
    this.muted = false;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.sink?.disconnect();
    this.sink = null;
    clearLiveMic(this.stream?.getAudioTracks()[0] ?? null);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
