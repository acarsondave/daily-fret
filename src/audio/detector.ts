// Real-time chord detection engine. Ports the per-frame orchestration from the
// native `engine.rs`: noise gate, onset-anchored window reset, tonal-salience
// gate, majority-vote debounce, and change-triggered emission.

import { Chromagram, SEMITONES } from './chromagram';
import { OnsetDetector } from './onset';
import { matchChord } from './chords';

export const FRAME_SIZE = 1024;

const SILENCE_THRESHOLD = 0.005;
const CHORD_STABLE_FRAMES = 2;
const CHROMA_SALIENCE_MIN = 1.2;

export const NO_CHORD = 'No Chord';

export interface ChordEvent {
  chord: string;
  confidence: number;
}

export interface OnsetEvent {
  energy: number;
}

export interface LevelEvent {
  rms: number;
  noiseFloor: number;
  salience: number;
  chroma: Float32Array | null;
}

export interface DetectorHandlers {
  onChord?: (ev: ChordEvent) => void;
  onOnset?: (ev: OnsetEvent) => void;
  onLevel?: (ev: LevelEvent) => void;
}

export interface DetectorOptions extends DetectorHandlers {
  sampleRate: number;
  offset?: number;
}

export class ChordDetector {
  private readonly chromagram: Chromagram;
  private readonly onsetDetector: OnsetDetector;
  private readonly handlers: DetectorHandlers;
  private offset: number;

  private lastEmittedChord: string | null = null;
  private chordHistory: string[] = [];
  private silentFrameCount = 0;
  private noiseFloor = SILENCE_THRESHOLD;

  constructor(opts: DetectorOptions) {
    this.chromagram = new Chromagram({
      frameSize: FRAME_SIZE,
      samplingRate: opts.sampleRate,
      downsampleFactor: 4,
      hopSize: FRAME_SIZE,
      referenceFrequency: 130.8127,
      numOctaves: 2,
      numHarmonics: 2,
    });
    this.onsetDetector = new OnsetDetector(FRAME_SIZE, opts.sampleRate);
    this.handlers = opts;
    this.offset = opts.offset ?? 0;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  /// Feed exactly one FRAME_SIZE block of mono samples.
  processFrame(frame: Float32Array): void {
    if (frame.length !== FRAME_SIZE) return;

    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    const rms = Math.sqrt(sumSq / frame.length);

    const activeThreshold = Math.max(this.noiseFloor * 2, SILENCE_THRESHOLD);
    if (rms < activeThreshold) {
      this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      this.handlers.onLevel?.({
        rms,
        noiseFloor: this.noiseFloor,
        salience: 0,
        chroma: null,
      });

      this.silentFrameCount += 1;
      if (this.silentFrameCount > 10) {
        if (this.lastEmittedChord !== NO_CHORD) {
          this.handlers.onChord?.({ chord: NO_CHORD, confidence: 1 });
          this.lastEmittedChord = NO_CHORD;
        }
        this.chordHistory = [];
      }
      this.chromagram.next(frame);
      return;
    }

    this.silentFrameCount = 0;

    if (this.onsetDetector.detect(frame)) {
      this.handlers.onOnset?.({ energy: rms });
      // Anchor analysis to the new chord so the next chroma reflects what is
      // being played now instead of the previous chord lingering in the window.
      this.chromagram.reset();
      this.chordHistory = [];
    }

    const chroma = this.chromagram.next(frame);
    if (!chroma) return;

    let peak = 0;
    let sum = 0;
    for (let i = 0; i < SEMITONES; i++) {
      if (chroma[i] > peak) peak = chroma[i];
      sum += chroma[i];
    }
    const mean = sum / SEMITONES;
    const salience = mean > 0 ? peak / mean : 0;
    const salient = mean > 0 && salience >= CHROMA_SALIENCE_MIN;

    const normalized = new Float32Array(SEMITONES);
    if (peak > 0) {
      for (let i = 0; i < SEMITONES; i++) normalized[i] = chroma[i] / peak;
    }

    if (salient) {
      const match = matchChord(normalized, this.offset);
      if (match) {
        if (this.chordHistory.length >= CHORD_STABLE_FRAMES) {
          this.chordHistory.shift();
        }
        this.chordHistory.push(match.chord);

        if (this.chordHistory.length === CHORD_STABLE_FRAMES) {
          let maxCount = 0;
          let bestChord = this.chordHistory[0];
          for (const candidate of this.chordHistory) {
            const count = this.chordHistory.filter((c) => c === candidate).length;
            if (count > maxCount) {
              maxCount = count;
              bestChord = candidate;
            }
          }
          if (maxCount >= Math.floor(CHORD_STABLE_FRAMES / 2) + 1) {
            if (this.lastEmittedChord !== bestChord) {
              this.handlers.onChord?.({
                chord: bestChord,
                confidence: match.confidence,
              });
              this.lastEmittedChord = bestChord;
            }
          }
        }
      }
    } else {
      this.chordHistory = [];
    }

    this.handlers.onLevel?.({
      rms,
      noiseFloor: this.noiseFloor,
      salience,
      chroma: normalized,
    });
  }
}
