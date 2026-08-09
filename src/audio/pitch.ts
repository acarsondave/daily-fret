// Monophonic pitch detection for the tuner: YIN (de Cheveigné & Kawahara, 2002)
// with the difference function computed through the FFT.
//
// Why not reuse the chord detector: it collapses everything to 12 pitch classes,
// which is the one piece of information a tuner cannot use. A tuner needs
// absolute frequency to well under a cent, and only ever looks at one string, so
// a time-domain periodicity estimator is both the right tool and the cheaper one.
//
// The naive difference function is O(W · tauMax) per analysis — around 1.7M
// multiply-adds at 44.1 kHz, every 46 ms, on the main thread. Expressing it
// through the autocorrelation (d(tau) = power terms − 2·r(tau)) turns it into two
// FFTs plus a prefix sum, roughly an eighth of the work, which is what keeps this
// affordable on a phone.

import { FFT } from './fft';

/** Below the lowest note anyone tunes a six-string to (drop-B sits at ~61 Hz). */
const MIN_FREQ = 55;
/** Above the 12th fret of the high E; past this it is not a tuning problem. */
const MAX_FREQ = 1400;

/** YIN's absolute threshold. Lower is stricter about what counts as periodic. */
const YIN_THRESHOLD = 0.14;
/** Fall back to the global minimum only if it is at least this convincing. */
const FALLBACK_MAX_CMND = 0.5;

/** Root-mean-square below which there is nothing to analyse. */
const MIN_RMS = 0.005;

export interface PitchFrame {
  /** Signal level of the analysed block, for meters and gating. */
  rms: number;
  /** Estimated fundamental in Hz, or null when nothing periodic was found. */
  hz: number | null;
  /** 0–1. How periodic the block was; the honest confidence of `hz`. */
  clarity: number;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export class PitchDetector {
  readonly sampleRate: number;
  /** Analysis block length in samples. */
  private readonly blockSize: number;
  /** Samples between analyses. */
  private readonly hopSize: number;
  private readonly tauMin: number;
  private readonly tauMax: number;

  private readonly ring: Float32Array;
  private ringHead = 0;
  private ringFilled = 0;
  private sinceAnalysis = 0;

  private readonly fft: FFT;
  private readonly fftSize: number;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly block: Float32Array;
  private readonly prefixSq: Float32Array;
  private readonly cmnd: Float32Array;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.tauMin = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
    this.tauMax = Math.ceil(sampleRate / MIN_FREQ);

    // Four periods of the lowest note we support, so the analysis window is
    // still several periods long at the far end of the tau sweep where the
    // difference function has the least data behind it.
    this.blockSize = nextPowerOfTwo(4 * this.tauMax);
    this.hopSize = this.blockSize / 2;
    this.fftSize = this.blockSize * 2; // zero-padded: linear, not circular, ACF

    this.ring = new Float32Array(this.blockSize);
    this.fft = new FFT(this.fftSize);
    this.re = new Float32Array(this.fftSize);
    this.im = new Float32Array(this.fftSize);
    this.block = new Float32Array(this.blockSize);
    this.prefixSq = new Float32Array(this.blockSize + 1);
    this.cmnd = new Float32Array(this.tauMax + 1);
  }

  /** Feed audio. Returns a reading on the frames that complete a hop, else null. */
  push(frame: Float32Array): PitchFrame | null {
    for (let i = 0; i < frame.length; i++) {
      this.ring[this.ringHead] = frame[i];
      this.ringHead = (this.ringHead + 1) % this.blockSize;
    }
    this.ringFilled = Math.min(this.blockSize, this.ringFilled + frame.length);
    this.sinceAnalysis += frame.length;

    if (this.sinceAnalysis < this.hopSize) return null;
    if (this.ringFilled < this.blockSize) return null;
    this.sinceAnalysis = 0;
    return this.analyse();
  }

  /** Drop the accumulated window, e.g. when switching input device. */
  reset(): void {
    this.ring.fill(0);
    this.ringHead = 0;
    this.ringFilled = 0;
    this.sinceAnalysis = 0;
  }

  private analyse(): PitchFrame {
    const N = this.blockSize;
    const block = this.block;

    // Oldest-to-newest, with the DC offset removed. A DC term dominates the
    // autocorrelation at every lag and quietly biases the whole estimate.
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const s = this.ring[(this.ringHead + i) % N];
      block[i] = s;
      sum += s;
    }
    const mean = sum / N;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const s = block[i] - mean;
      block[i] = s;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / N);
    if (rms < MIN_RMS) return { rms, hz: null, clarity: 0 };

    // Autocorrelation by FFT. The power spectrum of a real signal is symmetric,
    // so its forward transform equals its inverse transform scaled by fftSize —
    // which is why one more forward pass stands in for an IFFT here.
    const M = this.fftSize;
    this.re.set(block);
    this.re.fill(0, N);
    this.im.fill(0);
    this.fft.transform(this.re, this.im);
    for (let k = 0; k < M; k++) {
      this.re[k] = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      this.im[k] = 0;
    }
    this.fft.transform(this.re, this.im);
    // this.re[tau] / M is now sum over j of block[j] * block[j + tau].

    const prefix = this.prefixSq;
    prefix[0] = 0;
    for (let i = 0; i < N; i++) prefix[i + 1] = prefix[i] + block[i] * block[i];

    const { tauMin, tauMax, cmnd } = this;
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      const overlap = N - tau;
      const ac = this.re[tau] / M;
      // Squared difference over the overlapping region only. Dividing by that
      // region's length removes the shrinking-window bias, which otherwise makes
      // large lags look artificially good and produces octave-down errors.
      const d = (prefix[overlap] + (prefix[N] - prefix[tau]) - 2 * ac) / overlap;
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }

    // First lag that dips below the threshold, followed down to its local floor.
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < YIN_THRESHOLD) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // Nothing cleared the bar. Take the best lag anyway if it is at least
      // half-convincing, so a decaying note keeps reading instead of blinking
      // out, but report the lower clarity honestly.
      let bestTau = -1;
      let bestVal = Infinity;
      for (let t = tauMin; t <= tauMax; t++) {
        if (cmnd[t] < bestVal) {
          bestVal = cmnd[t];
          bestTau = t;
        }
      }
      if (bestTau < 0 || bestVal > FALLBACK_MAX_CMND) return { rms, hz: null, clarity: 0 };
      tau = bestTau;
    }

    const refined = this.refine(tau);
    const hz = this.sampleRate / refined;
    if (hz < MIN_FREQ || hz > MAX_FREQ) return { rms, hz: null, clarity: 0 };

    return { rms, hz, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
  }

  /**
   * Sub-sample lag by fitting a parabola to the three points around the minimum.
   * At 44.1 kHz one whole sample of lag is ~7.5 cents on the high E string, so
   * without this the readout could never settle inside a usable tolerance.
   */
  private refine(tau: number): number {
    const { cmnd, tauMin, tauMax } = this;
    if (tau <= tauMin || tau >= tauMax) return tau;
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * s1 - s2 - s0;
    if (denom === 0) return tau;
    const shift = (0.5 * (s2 - s0)) / denom;
    // A well-formed minimum shifts by less than half a sample; anything larger
    // means the three points are not bracketing one, so keep the integer lag.
    return Math.abs(shift) < 0.5 ? tau + shift : tau;
  }
}
