// Spectral-flux onset (strum) detector. Direct port of the native `onset.rs`.
// A detected onset anchors the chromagram window to the freshly struck chord.

import { FFT } from './fft';

export class OnsetDetector {
  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly prevSpectrum: Float32Array;

  private readonly fluxHistory: number[] = [];
  private readonly fluxHistorySize = 30;
  private readonly thresholdMultiplier = 2.5;
  // Baseline percentile for the adaptive threshold. The median (0.5) breaks down
  // under fast continuous strumming: once most recent frames are "active" the
  // median sits inside the active range and no new strum can exceed
  // median * multiplier, so onsets stop firing until you pause. A low percentile
  // tracks the brief lulls between strums instead, so each attack still spikes
  // above it and onsets keep firing at speed.
  private readonly baselinePercentile = 0.35;

  private framesSinceLastOnset: number;
  private readonly minFramesBetweenOnsets: number;

  constructor(frameSize: number, sampleRate: number) {
    this.fft = new FFT(frameSize);

    this.window = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
    }

    this.re = new Float32Array(frameSize);
    this.im = new Float32Array(frameSize);
    this.prevSpectrum = new Float32Array(frameSize);

    // Hard invariant: the refractory MUST exceed the chromagram's window-fill
    // time. Each onset resets that window (~186ms to refill to MIN_FILLED before
    // any chroma is produced) plus ~2 frames to complete the stability vote. A
    // shorter refractory lets the sustain/decay of one strum re-fire onsets that
    // reset the window before it can ever fill, so the detector stays blind
    // through most of continuous playing. 220ms guarantees one strum resolves to
    // a reading before another onset can wipe it, while still allowing >4 chord
    // changes/sec — far above any human drill pace.
    const msPerFrame = (frameSize / sampleRate) * 1000;
    this.minFramesBetweenOnsets = Math.ceil(220 / msPerFrame);
    this.framesSinceLastOnset = this.minFramesBetweenOnsets;
  }

  detect(frame: Float32Array): boolean {
    if (frame.length !== this.window.length) return false;

    this.framesSinceLastOnset += 1;

    for (let i = 0; i < frame.length; i++) {
      this.re[i] = frame[i] * this.window[i];
      this.im[i] = 0;
    }

    this.fft.transform(this.re, this.im);

    let flux = 0;
    const half = frame.length / 2;
    for (let i = 0; i < half; i++) {
      const mag = Math.sqrt(this.re[i] * this.re[i] + this.im[i] * this.im[i]);
      const diff = mag - this.prevSpectrum[i];
      if (diff > 0) flux += diff;
      this.prevSpectrum[i] = mag;
    }

    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.fluxHistorySize) {
      this.fluxHistory.shift();
    }

    if (this.fluxHistory.length < 5) return false;

    const sorted = [...this.fluxHistory].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length * this.baselinePercentile)];
    const threshold = baseline * this.thresholdMultiplier;

    if (
      flux > threshold &&
      this.framesSinceLastOnset >= this.minFramesBetweenOnsets
    ) {
      this.framesSinceLastOnset = 0;
      return true;
    }
    return false;
  }
}
