// Streaming 12-bin chromagram. Direct TypeScript port of the native
// PantherPlay `chromagram.rs` (originally Adam Stark, Queen Mary University of
// London) so the browser detector produces the same pitch-class vectors as the
// desktop engine. Includes the onset-anchored `reset()` used to fix the
// one-strum detection lag.

import { FFT } from './fft';

export const SEMITONES = 12;
const BUFFER_SIZE = 8192;
const CHROMA_INTERVAL = BUFFER_SIZE / 2;

// Gain inside the log compression ln(1 + k * |X|). Matches the native engine.
const LOG_COMPRESSION_GAIN = 50.0;

function makeHammingWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let n = 0; n < size; n++) {
    w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (size - 1));
  }
  return w;
}

const HAMMING_WINDOW = makeHammingWindow(BUFFER_SIZE);

export interface ChromagramOptions {
  frameSize: number;
  samplingRate: number;
  downsampleFactor: number;
  numHarmonics: number;
  numOctaves: number;
  searchWidth: number;
  referenceFrequency: number;
  hopSize: number;
}

const DEFAULTS: ChromagramOptions = {
  frameSize: 1024,
  samplingRate: 44_100,
  downsampleFactor: 4,
  numHarmonics: 2,
  numOctaves: 2,
  searchWidth: 3,
  referenceFrequency: 130.8127,
  hopSize: CHROMA_INTERVAL,
};

export class Chromagram {
  private readonly opts: ChromagramOptions;
  private readonly buffer: Float32Array;
  private head = 0;
  private readonly filtered: Float32Array;
  private readonly fft: FFT;
  private readonly fftRe: Float32Array;
  private readonly fftIm: Float32Array;
  private readonly magnitude: Float32Array;
  private readonly chroma: Float32Array;
  private readonly noteFrequencies: Float32Array;
  private samplesSinceLast = 0;

  constructor(options: Partial<ChromagramOptions> = {}) {
    const opts = { ...DEFAULTS, ...options };
    if (BUFFER_SIZE % opts.downsampleFactor !== 0) {
      throw new Error('BUFFER_SIZE must be divisible by downsampleFactor');
    }
    if (opts.frameSize === 0) {
      throw new Error('frameSize cannot be zero');
    }
    this.opts = opts;

    this.buffer = new Float32Array(BUFFER_SIZE);
    this.filtered = new Float32Array(opts.frameSize / opts.downsampleFactor);
    this.fft = new FFT(BUFFER_SIZE);
    this.fftRe = new Float32Array(BUFFER_SIZE);
    this.fftIm = new Float32Array(BUFFER_SIZE);
    this.magnitude = new Float32Array(BUFFER_SIZE / 2 + 1);
    this.chroma = new Float32Array(SEMITONES);

    this.noteFrequencies = new Float32Array(SEMITONES);
    for (let i = 0; i < SEMITONES; i++) {
      this.noteFrequencies[i] = opts.referenceFrequency * Math.pow(2, i / 12);
    }
  }

  /// Discard the accumulated analysis window so the next chroma reflects the
  /// chord being played now rather than the previous chord still ringing in the
  /// ~680ms buffer. Called on a detected strum onset.
  reset(): void {
    this.buffer.fill(0);
    this.head = 0;
    this.samplesSinceLast = 0;
    this.chroma.fill(0);
  }

  /// Push one audio frame. Returns the 12-bin chroma when a hop completes,
  /// otherwise null.
  next(frame: Float32Array): Float32Array | null {
    if (frame.length !== this.opts.frameSize) {
      throw new Error(
        `expected frame of length ${this.opts.frameSize}, got ${frame.length}`,
      );
    }

    this.downsampleFrame(frame);

    for (let i = 0; i < this.filtered.length; i++) {
      this.buffer[this.head] = this.filtered[i];
      this.head = (this.head + 1) % BUFFER_SIZE;
    }

    this.samplesSinceLast += this.opts.frameSize;
    if (this.samplesSinceLast < this.opts.hopSize) {
      return null;
    }
    this.samplesSinceLast -= this.opts.hopSize;

    this.computeSpectrum();
    this.computeChromagram();
    return this.chroma;
  }

  private downsampleFrame(input: Float32Array): void {
    const b0 = 0.2929;
    const b1 = 0.5858;
    const b2 = 0.2929;
    const a1 = -0.0;
    const a2 = 0.1716;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let out = 0;

    const factor = this.opts.downsampleFactor;
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;

      if (i % factor === 0) {
        this.filtered[out] = y0;
        out += 1;
      }
    }
  }

  private computeSpectrum(): void {
    const start = this.head;
    for (let i = 0; i < BUFFER_SIZE; i++) {
      const sample = this.buffer[(start + i) % BUFFER_SIZE];
      this.fftRe[i] = sample * HAMMING_WINDOW[i];
      this.fftIm[i] = 0;
    }

    this.fft.transform(this.fftRe, this.fftIm);

    for (let i = 0; i < this.magnitude.length; i++) {
      const re = this.fftRe[i];
      const im = this.fftIm[i];
      const linear = Math.sqrt(re * re + im * im);
      this.magnitude[i] = Math.log(1 + LOG_COMPRESSION_GAIN * linear);
    }
  }

  private computeChromagram(): void {
    const binWidth =
      this.opts.samplingRate / this.opts.downsampleFactor / BUFFER_SIZE;
    const maxBin = this.magnitude.length - 1;

    for (let n = 0; n < SEMITONES; n++) {
      let cSum = 0;
      for (let octave = 1; octave <= this.opts.numOctaves; octave++) {
        let noteSum = 0;
        for (let harm = 1; harm <= this.opts.numHarmonics; harm++) {
          const freq = this.noteFrequencies[n] * octave * harm;
          const center = Math.round(freq / binWidth);
          const lo = Math.max(0, center - this.opts.searchWidth * harm);
          const hi = Math.min(center + this.opts.searchWidth * harm, maxBin);

          let peak = 0;
          for (let b = lo; b <= hi; b++) {
            if (this.magnitude[b] > peak) peak = this.magnitude[b];
          }
          noteSum += peak / harm;
        }
        cSum += noteSum;
      }
      this.chroma[n] = cSum;
    }
  }
}
