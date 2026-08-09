// Microphone input graph: getUserMedia -> AudioContext -> AudioWorklet, emitting
// fixed-size mono frames. Knows nothing about what listens to them.
//
// This was the top half of ChordCapture. The tuner needs the same graph with a
// different analyser attached, and the parts worth getting right — partial
// teardown on failure, StrictMode double-invoke, iOS suspended contexts, a dead
// preferred device — are exactly the parts nobody should own twice.

// Served verbatim from /public so addModule always gets a real, same-origin
// classic script. BASE_URL keeps it correct under any deploy sub-path.
const WORKLET_URL = `${import.meta.env.BASE_URL}pcm-worklet.js`;

export interface MicStreamHandlers {
  /** Specific mic to capture from; omitted = system default. */
  deviceId?: string;
  /** Fired once the context exists, before any frame arrives. */
  onReady?: (info: { sampleRate: number }) => void;
  onFrame: (frame: Float32Array) => void;
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

  get running(): boolean {
    return this.ctx !== null || this.starting;
  }

  get sampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  async start(handlers: MicStreamHandlers): Promise<void> {
    if (this.ctx || this.starting) return;
    this.disposed = false;
    this.starting = true;

    // StrictMode (and rapid open/close) can call stop() mid-startup. Re-check
    // `disposed` after every await and tear down any partial graph if so.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(handlers.deviceId),
      });
    } catch (err) {
      // The preferred device may be gone (unplugged headset); fall back to the
      // system default rather than failing the whole session.
      if (
        handlers.deviceId &&
        err instanceof DOMException &&
        (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')
      ) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
      } else {
        this.starting = false;
        throw err;
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
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (this.disposed) return this.teardown();

      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      await this.teardown();
      throw err;
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

    this.attachResumeOnGesture(ctx);
    this.starting = false;
  }

  // iOS Safari frequently leaves the AudioContext suspended until a user
  // gesture lands. Resume on the next interaction, then self-detach.
  private attachResumeOnGesture(ctx: AudioContext): void {
    if (ctx.state === 'running') return;
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'touchend', 'keydown'];
    const resume = () => { void ctx.resume(); };
    events.forEach((e) => document.addEventListener(e, resume, { passive: true }));
    this.detachResume = () => {
      events.forEach((e) => document.removeEventListener(e, resume));
      this.detachResume = null;
    };
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.detachResume?.();
    });
  }

  async stop(): Promise<void> {
    this.disposed = true;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.starting = false;
    this.detachResume?.();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.sink?.disconnect();
    this.sink = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
