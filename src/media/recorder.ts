// One recording, from opening the camera to the file being on disk.
//
// The governing rule: the session is the product and the recording is a
// passenger. Nothing in here is allowed to throw into a drill. Every failure
// arrives at `onFailure` as a structured RecordingError, the camera is given
// back, and the drill carries on counting chord changes with a line of text on
// screen saying what happened to the film.
//
// The lifecycle is written out rather than leaned on MediaRecorder's own,
// because MediaRecorder does not tell you the two things that actually go wrong
// in a room with a guitar in it: someone knocks the webcam's cable out, and the
// phone locks. Both look like a recording that is still running and producing
// nothing.

import { liveMicTrack } from '../audio/liveMic';
import { openCameraPreview } from './cameraDevice';
import { RecordingError, describeCameraFailure, describeStorageFailure } from './failure';
import { chooseMimeType, extensionFor, presetFor } from './quality';
import { preferredStore, type RecordingSink } from './storage';
import type {
  Recording,
  RecordingEnd,
  RecordingKind,
  RecordingQuality,
  StorageBackend,
  TechniqueView,
} from './types';

/**
 * How long one clip may run.
 *
 * Not a policy about practice length, a bound on a single file. Twelve minutes
 * at Detail is roughly 280 MB, which is about as much as the IndexedDB fallback
 * can hold in memory on a phone without the tab being killed for it. Drills are
 * a minute or two and timed blocks are five, so nothing normal reaches this;
 * what reaches it is a session left open while its owner went to answer the
 * door, and that is exactly the file worth capping.
 */
export const MAX_CLIP_MS = 12 * 60 * 1000;

/** Chunk interval. Small enough to bound the fallback's buffer, large enough
 *  that the disk is not written to on every animation frame. */
const TIMESLICE_MS = 2000;

/** A track flickers muted when a camera warms up; only a sustained one counts. */
const MUTE_GRACE_MS = 1500;

export interface CaptureRequest {
  sessionId: string;
  kind: RecordingKind;
  date: string;
  taskId: string | null;
  routineId: string | null;
  label: string;
  view?: TechniqueView;
  quality: RecordingQuality;
  cameraId: string | null;
  /** Starred at birth, which is how a technique check becomes prune-proof. */
  starred?: boolean;
  /** Stop on its own after this long. Capped by MAX_CLIP_MS either way. */
  durationMs?: number;
  /**
   * A camera the caller already has open and will close itself. The technique
   * check frames each shot on a live preview and then records from that same
   * stream, so the picture never blinks between framing and rolling.
   */
  videoStream?: MediaStream;
}

export interface CaptureEvents {
  /** The camera is live. Handed the stream so a surface can show the shot. */
  onLive?: (stream: MediaStream) => void;
  /** Fired once, with the reason. The recorder has already cleaned up. */
  onFailure?: (error: RecordingError) => void;
  /** Fired when a running recording ends itself rather than being stopped. */
  onEnded?: (reason: RecordingEnd) => void;
}

export type RecorderPhase = 'idle' | 'opening' | 'recording' | 'saving';

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// The browser's own voice processing is built for speech and takes a guitar
// apart: gain riding flattens dynamics, noise suppression reads a decaying
// chord as room noise. Same settings as the detector's capture, for the same
// reason. Only used when no microphone is already open to clone from.
const RECORDER_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export class PracticeRecorder {
  private phase: RecorderPhase = 'idle';
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ownsVideo = true;
  private sink: RecordingSink | null = null;
  private detach: (() => void) | null = null;
  private limitTimer: number | null = null;
  private muteTimer: number | null = null;
  private endedBy: RecordingEnd = 'complete';
  private startedAt = 0;
  private request: CaptureRequest | null = null;
  private events: CaptureEvents = {};
  private mimeType = '';
  private key = '';
  private backend: StorageBackend = 'opfs';
  private size = { width: 0, height: 0 };
  private hasAudio = false;
  private settled = false;

  get state(): RecorderPhase {
    return this.phase;
  }

  get running(): boolean {
    return this.phase === 'recording';
  }

  /**
   * Open the camera and roll.
   *
   * Resolves once the recorder is running, or rejects with a RecordingError
   * that has already been reported to `onFailure`. Callers that treat recording
   * as a passenger can ignore the rejection entirely; the ones that are showing
   * a camera on screen (settings, the technique check) want it.
   */
  async start(request: CaptureRequest, events: CaptureEvents = {}): Promise<void> {
    if (this.phase !== 'idle') {
      throw new RecordingError('failed', 'A recording is already running.');
    }
    this.phase = 'opening';
    this.request = request;
    this.events = events;
    this.settled = false;
    this.endedBy = 'complete';

    try {
      await this.open(request);
    } catch (err) {
      const failure =
        err instanceof RecordingError ? err : describeCameraFailure(err);
      await this.teardown();
      this.phase = 'idle';
      events.onFailure?.(failure);
      throw failure;
    }
  }

  private async open(request: CaptureRequest): Promise<void> {
    if (typeof MediaRecorder === 'undefined') {
      throw new RecordingError('unsupported', 'This browser cannot record video.');
    }
    const mimeType = chooseMimeType();
    if (!mimeType) {
      throw new RecordingError('no-codec', 'This browser will not write any video format the app can read.');
    }
    this.mimeType = mimeType;

    const preset = presetFor(request.quality);

    // The camera. Either one the caller is already showing, or our own.
    if (request.videoStream) {
      this.stream = new MediaStream(request.videoStream.getVideoTracks());
      this.ownsVideo = false;
    } else {
      this.stream = await openCameraPreview(request.cameraId, preset.width, preset.height);
      this.ownsVideo = true;
    }

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new RecordingError('no-camera', 'The camera opened but produced no picture.');
    }
    const settings = videoTrack.getSettings();
    this.size = { width: settings.width ?? preset.width, height: settings.height ?? preset.height };

    await this.attachAudio();
    this.events.onLive?.(this.stream);

    // The file is opened before the recorder starts, so a disk that is already
    // full is reported as "no room" before any footage exists to lose.
    const store = preferredStore();
    this.backend = store.backend;
    this.key = `${newId()}.${extensionFor(mimeType)}`;
    try {
      this.sink = await store.open(this.key);
    } catch (err) {
      throw describeStorageFailure(err);
    }

    const recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: preset.videoBitsPerSecond,
      audioBitsPerSecond: preset.audioBitsPerSecond,
    });
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.sink?.write(event.data);
    };
    recorder.onerror = () => {
      // MediaRecorder's error event carries a DOMException on a property TS
      // does not model; the useful part is that it stopped, and why is almost
      // always the disk.
      this.finishBecause('storage-full');
    };

    this.watchDevice(videoTrack);
    recorder.start(TIMESLICE_MS);
    this.startedAt = Date.now();
    this.phase = 'recording';

    // A clip that has run its length stops itself rather than waiting to be
    // told. A caller that has navigated away, or a technique check whose timer
    // was throttled by a background tab, must not leave a camera rolling.
    const asked = request.durationMs;
    const limit = Math.min(asked ?? MAX_CLIP_MS, MAX_CLIP_MS);
    this.limitTimer = window.setTimeout(() => {
      this.limitTimer = null;
      // Reaching a length the caller asked for is a complete take. Reaching the
      // hard cap is not, and the clip says which.
      this.finishBecause(asked !== undefined && asked <= MAX_CLIP_MS ? 'complete' : 'time-limit');
      // Flushes the final chunk. The caller's own stop() then finds an inactive
      // recorder and only has to close the file.
      if (recorder.state !== 'inactive') recorder.stop();
    }, limit);
  }

  /**
   * Guitar audio, from the microphone that is already open where there is one.
   *
   * Silent footage is much less useful for review: half of what a technique
   * check shows is whether the change that looks clean actually sounded clean.
   * So audio is attached whenever it can be, and its absence is recorded rather
   * than being a failure. A song play-along has no microphone open and gets its
   * own; if that request is refused, the clip is filmed silent instead of not
   * being filmed.
   */
  private async attachAudio(): Promise<void> {
    const stream = this.stream;
    if (!stream) return;

    const live = liveMicTrack();
    if (live) {
      stream.addTrack(live.clone());
      this.hasAudio = true;
      return;
    }

    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: RECORDER_AUDIO });
      const track = audio.getAudioTracks()[0];
      if (track) {
        stream.addTrack(track);
        this.hasAudio = true;
      }
    } catch {
      // Deliberate, and the only swallowed failure in this file. The camera is
      // already open and the drill is about to start; refusing to film because
      // the microphone said no would trade the whole feature for half of it.
      // `hasAudio: false` on the clip is what the review surface reads.
      this.hasAudio = false;
    }
  }

  /**
   * The two ways a recording dies without saying so.
   *
   * `ended` is the cable coming out, or the camera being claimed by another
   * app. `muted` for longer than a warm-up flicker is what a phone locking or a
   * tab being buried looks like from in here: the track is still live and every
   * frame it hands over is black. Both stop the recording and keep what was
   * filmed up to that point.
   */
  private watchDevice(track: MediaStreamTrack): void {
    const clearMute = () => {
      if (this.muteTimer !== null) {
        clearTimeout(this.muteTimer);
        this.muteTimer = null;
      }
    };
    const onEnded = () => this.finishBecause('device-lost');
    const onMute = () => {
      clearMute();
      this.muteTimer = window.setTimeout(() => {
        this.muteTimer = null;
        this.finishBecause(document.hidden ? 'hidden' : 'device-lost');
      }, MUTE_GRACE_MS);
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', clearMute);
    this.detach = () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', clearMute);
      clearMute();
      this.detach = null;
    };
  }

  // A running recording ending on its own. Stop() does the rest; this only
  // records why, so the clip can say so.
  private finishBecause(reason: RecordingEnd): void {
    if (this.phase !== 'recording') return;
    this.endedBy = reason;
    if (reason === 'hidden') {
      this.report(new RecordingError('device-lost', 'The camera stopped when the screen or the tab went away.'));
    } else if (reason === 'storage-full') {
      this.report(new RecordingError('quota', 'There was no room left to keep going.'));
    } else if (reason === 'device-lost') {
      this.report(new RecordingError('device-lost', 'The camera disconnected part-way through.'));
    }
    this.events.onEnded?.(reason);
  }

  /**
   * Stop, and hand back the finished clip.
   *
   * Null means there is nothing worth keeping: no recording was running, or it
   * produced no bytes. A zero-byte file in the library would be a broken
   * thumbnail the player has to open to discover is nothing.
   */
  async stop(): Promise<Recording | null> {
    if (this.phase !== 'recording' && this.phase !== 'opening') {
      await this.teardown();
      return null;
    }
    const request = this.request;
    const recorder = this.recorder;
    this.phase = 'saving';

    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;

    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          recorder.stop();
        } catch {
          // Already stopped by the browser (device gone). Nothing to wait for.
          resolve();
        }
      });
    }

    let bytes = 0;
    let failure: RecordingError | null = null;
    if (this.sink) {
      try {
        bytes = await this.sink.close();
      } catch (err) {
        failure = err instanceof RecordingError ? err : describeStorageFailure(err);
        await this.sink.abort();
      }
    }

    const store = this.sink;
    this.sink = null;
    await this.teardown();
    this.phase = 'idle';

    if (failure) {
      this.report(failure);
      return null;
    }
    if (!request || !store || bytes === 0) return null;

    return {
      id: newId(),
      sessionId: request.sessionId,
      kind: request.kind,
      date: request.date,
      taskId: request.taskId,
      routineId: request.routineId,
      label: request.label,
      view: request.view,
      startedAt: this.startedAt,
      durationMs,
      bytes,
      mimeType: this.mimeType,
      quality: request.quality,
      width: this.size.width,
      height: this.size.height,
      hasAudio: this.hasAudio,
      starred: request.starred ?? false,
      endedBy: this.endedBy,
      location: { backend: this.backend, key: this.key },
    };
  }

  /** Stop and keep nothing. Used when a surface is dismissed mid-capture. */
  async cancel(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    await this.sink?.abort();
    this.sink = null;
    await this.teardown();
    this.phase = 'idle';
  }

  private report(failure: RecordingError): void {
    if (this.settled) return;
    this.settled = true;
    this.events.onFailure?.(failure);
  }

  private async teardown(): Promise<void> {
    if (this.limitTimer !== null) {
      clearTimeout(this.limitTimer);
      this.limitTimer = null;
    }
    this.detach?.();
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder = null;
    }
    // Only what this recorder opened. A preview the technique check is still
    // showing belongs to the technique check, and stopping it here would blank
    // the screen between two of the three angles.
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        if (track.kind === 'video' && !this.ownsVideo) continue;
        track.stop();
      }
    }
  }
}
