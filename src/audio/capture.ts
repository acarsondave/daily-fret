// Chord-detection capture. Attaches a ChordDetector to a MicStream and owns the
// diagnostic session around it. The audio graph itself lives in micStream.ts,
// which the tuner shares.

import { ChordDetector, DETECTOR_CONSTANTS, type DetectorHandlers } from './detector';
import { MicStream } from './micStream';
import type { LearnedTemplates } from './chords';
import { diag } from './diagnostics';

export interface CaptureHandlers extends DetectorHandlers {
  offset?: number;
  restrictTo?: string[];
  templates?: LearnedTemplates; // per-chord learned overrides from calibration
  deviceId?: string; // specific mic to capture from; omitted = system default
}

export class ChordCapture {
  private readonly mic = new MicStream();
  private detector: ChordDetector | null = null;

  get running(): boolean {
    return this.mic.running;
  }

  async start(handlers: CaptureHandlers): Promise<void> {
    try {
      await this.startGraph(handlers);
    } catch (err) {
      // MicStream has already torn the graph down, but the diagnostic session
      // opened in onReady would otherwise stay open forever and swallow the
      // next real session's log.
      if (this.detector) diag.end();
      this.detector = null;
      throw err;
    }
  }

  private async startGraph(handlers: CaptureHandlers): Promise<void> {
    await this.mic.start({
      deviceId: handlers.deviceId,
      onReady: ({ sampleRate }) => {
        // Every capture records a diagnostic session (gate outcomes, onsets,
        // emits) so "detection was off today" is answerable from an export
        // instead of memory. See src/audio/diagnostics.ts.
        diag.start({
          label: 'mic session',
          sampleRate,
          restrictTo: handlers.restrictTo ?? null,
          constants: DETECTOR_CONSTANTS,
        });
        // Record whether this session ran on learned templates, so an export can
        // be read as "calibrated vs built-in" when comparing detection quality.
        const learnedChords = handlers.templates ? Object.keys(handlers.templates) : [];
        diag.mark(
          learnedChords.length
            ? `calibrated: ${learnedChords.join(', ')}`
            : 'calibration: built-in templates',
        );

        this.detector = new ChordDetector({
          sampleRate,
          offset: handlers.offset ?? 0,
          restrictTo: handlers.restrictTo,
          templates: handlers.templates,
          onChord: handlers.onChord,
          onOnset: handlers.onOnset,
          onLevel: handlers.onLevel,
        });
      },
      onFrame: (frame) => this.detector?.processFrame(frame),
    });
  }

  setOffset(offset: number): void {
    this.detector?.setOffset(offset);
  }

  setRestrict(chords: string[] | null): void {
    this.detector?.setRestrict(chords);
  }

  async stop(): Promise<void> {
    if (this.detector) diag.end();
    this.detector = null;
    await this.mic.stop();
  }
}
