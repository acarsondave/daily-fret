// Microphone capture controller. Wires getUserMedia -> AudioContext ->
// AudioWorklet (1024-sample frames) -> ChordDetector. Browser equivalent of
// PantherPlay's native audio engine I/O.

import { ChordDetector, type DetectorHandlers } from './detector';

// Served verbatim from /public so addModule always gets a real, same-origin
// classic script. BASE_URL keeps it correct under any deploy sub-path.
const WORKLET_URL = `${import.meta.env.BASE_URL}pcm-worklet.js`;

export interface CaptureHandlers extends DetectorHandlers {
  offset?: number;
}

export class ChordCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private detector: ChordDetector | null = null;
  private disposed = false;
  private starting = false;

  get running(): boolean {
    return this.ctx !== null || this.starting;
  }

  async start(handlers: CaptureHandlers): Promise<void> {
    if (this.ctx || this.starting) return;
    this.disposed = false;
    this.starting = true;

    // StrictMode (and rapid open/close) can call stop() mid-startup. Re-check
    // `disposed` after every await and tear down any partial graph if so.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (this.disposed) return this.teardown();

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (this.disposed) return this.teardown();

    await ctx.audioWorklet.addModule(WORKLET_URL);
    if (this.disposed) return this.teardown();

    this.detector = new ChordDetector({
      sampleRate: ctx.sampleRate,
      offset: handlers.offset ?? 0,
      onChord: handlers.onChord,
      onOnset: handlers.onOnset,
      onLevel: handlers.onLevel,
    });

    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-frame-processor');
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.detector?.processFrame(event.data);
    };

    // Muted sink keeps the worklet in the active graph without monitoring the
    // mic back to the speakers (which would cause feedback).
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;

    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);

    this.starting = false;
  }

  setOffset(offset: number): void {
    this.detector?.setOffset(offset);
  }

  async stop(): Promise<void> {
    this.disposed = true;
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.starting = false;
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
    this.detector = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
