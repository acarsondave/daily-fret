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

    const msPerFrame = (frameSize / sampleRate) * 1000;
    this.minFramesBetweenOnsets = Math.ceil(60 / msPerFrame);
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
    const median = sorted[Math.floor(sorted.length / 2)];
    const threshold = median * this.thresholdMultiplier;

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
