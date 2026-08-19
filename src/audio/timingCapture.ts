// Strum-timing capture. Attaches a TimingAnalyser to a MicStream and owns the
// diagnostic session around it. The audio graph itself lives in micStream.ts,
// which the tuner and the chord drills share.
//
// Deliberately a sibling of ChordCapture rather than a mode of it. The two want
// different things from the same microphone: the chord path needs a 12-bin
// chromagram and knows nothing about when anything happened, and this path needs
// millisecond timing and knows nothing about what was played. Folding them
// together would mean every chord drill paying for filters it has no use for,
// and this drill carrying a chord matcher it never asks a question of.

import { MicStream, type MicRouteState } from './micStream';
import { TimingAnalyser, TIMING_CONSTANTS, type TimingHandlers } from './timing';
import { diag } from './diagnostics';

export interface TimingCaptureHandlers extends TimingHandlers {
  /** Specific mic to capture from; omitted = system default. */
  deviceId?: string;
  /** What the drill is doing, for the diagnostic session's label. */
  label?: string;
  /**
   * Fired whenever the input route changes, and once as soon as the graph is up.
   *
   * ChordCapture has taken this since a microphone revoked mid-drill was found
   * to go unnoticed; this path did not, so the one drill that grades rhythm was
   * still the old failure exactly: the frames stop, no error is raised, the
   * level meter freezes on whatever it last said, and the run goes on against a
   * beat grid nothing is refreshing.
   */
  onRouteChange?: (state: MicRouteState) => void;
}

export class TimingCapture {
  private readonly mic = new MicStream();
  private analyser: TimingAnalyser | null = null;

  get running(): boolean {
    return this.mic.running;
  }

  async start(handlers: TimingCaptureHandlers): Promise<void> {
    try {
      await this.startGraph(handlers);
    } catch (err) {
      // MicStream has already torn the graph down, but the diagnostic session
      // opened in onReady would otherwise stay open forever and swallow the
      // next real session's log.
      if (this.analyser) diag.end();
      this.analyser = null;
      throw err;
    }
  }

  private async startGraph(handlers: TimingCaptureHandlers): Promise<void> {
    await this.mic.start({
      deviceId: handlers.deviceId,
      onRouteChange: handlers.onRouteChange,
      onReady: ({ sampleRate }) => {
        diag.start({
          label: handlers.label ?? 'timing session',
          sampleRate,
          restrictTo: null,
          constants: TIMING_CONSTANTS,
        });
        this.analyser = new TimingAnalyser({
          sampleRate,
          onStrum: handlers.onStrum,
          onClick: handlers.onClick,
          onLevel: handlers.onLevel,
        });
      },
      onFrame: (frame) => this.analyser?.processFrame(frame),
    });
  }

  async stop(): Promise<void> {
    if (this.analyser) diag.end();
    this.analyser = null;
    await this.mic.stop();
  }
}
