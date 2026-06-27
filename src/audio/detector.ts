// Real-time chord detection engine. Ports the per-frame orchestration from the
// native `engine.rs`: noise gate, onset-anchored window reset, tonal-salience
// gate, majority-vote debounce, and change-triggered emission.

import { Chromagram, SEMITONES } from './chromagram';
import { OnsetDetector } from './onset';
import { matchChord, matchChordAmong } from './chords';

export const FRAME_SIZE = 1024;

const SILENCE_THRESHOLD = 0.005;
// Cap the adaptive noise floor so a noisy/sensitive mic can't drag the active
// gate (noiseFloor * 2) up high enough to swallow real playing. Without this the
// gate "locks out" and detection goes dead for seconds until the floor decays.
const NOISE_FLOOR_MAX = 0.03;
const CHORD_STABLE_FRAMES = 2;
export const CHROMA_SALIENCE_MIN = 1.2;
// Restricted mode (song / changes) used to be *lenient* on salience because
// there are only a couple of templates — but that's exactly what lets quiet room
// noise resolve to one of the few candidates and register a phantom chord. Hold
// it to the same tonal-salience bar as open mode.
const CHROMA_SALIENCE_MIN_RESTRICTED = 1.2;
// Reject ambiguous frames more firmly: a ringing/decaying chord drifting toward
// the other target otherwise registers phantom transitions (false counts).
const RESTRICTED_MARGIN_MIN = 0.12;
// A count must be backed by a strum that is clearly louder than the ambient
// noise floor. This is the main guard against "it counted when I wasn't
// playing": a flux blip on room noise can fire an onset, but it won't arm a
// count unless the frame is genuinely loud. Tune if soft playing is missed
// (lower) or silence still counts (raise).
const STRUM_RMS_RATIO = 3;
const MIN_STRUM_RMS = 0.02;

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
  restrictTo?: string[]; // when set, only these chord names are matched
}

export class ChordDetector {
  private readonly chromagram: Chromagram;
  private readonly onsetDetector: OnsetDetector;
  private readonly handlers: DetectorHandlers;
  private offset: number;
  private restrictTo: string[] | null;

  private lastEmittedChord: string | null = null;
  private chordHistory: string[] = [];
  private silentFrameCount = 0;
  private noiseFloor = SILENCE_THRESHOLD;
  // A counted chord must be backed by a fresh strum. After each emission this
  // flips false and only a new onset (or a pause) re-arms it, so a chord's decay
  // or fingers moving toward the next shape can't register a phantom count.
  // Starts armed so the first strum of a session counts.
  private onsetSinceEmit = true;

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
    this.restrictTo = opts.restrictTo && opts.restrictTo.length ? opts.restrictTo : null;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  setRestrict(chords: string[] | null): void {
    this.restrictTo = chords && chords.length ? chords : null;
  }

  /// Feed exactly one FRAME_SIZE block of mono samples.
  processFrame(frame: Float32Array): void {
    if (frame.length !== FRAME_SIZE) return;

    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    const rms = Math.sqrt(sumSq / frame.length);

    const activeThreshold = Math.max(this.noiseFloor * 2, SILENCE_THRESHOLD);
    if (rms < activeThreshold) {
      this.noiseFloor = Math.min(this.noiseFloor * 0.98 + rms * 0.02, NOISE_FLOOR_MAX);
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
        // A pause re-arms counting: the next chord after silence is a fresh
        // attempt even if the onset detector is still warming up.
        this.onsetSinceEmit = true;
      }
      this.chromagram.next(frame);
      return;
    }

    this.silentFrameCount = 0;

    if (this.onsetDetector.detect(frame)) {
      this.handlers.onOnset?.({ energy: rms });
      // Only a strum clearly above the noise floor arms a count, so a flux blip
      // on room noise or handling can't register a phantom chord.
      if (rms > Math.max(this.noiseFloor * STRUM_RMS_RATIO, MIN_STRUM_RMS)) {
        this.onsetSinceEmit = true;
      }
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
    const salienceFloor = this.restrictTo
      ? CHROMA_SALIENCE_MIN_RESTRICTED
      : CHROMA_SALIENCE_MIN;
    const salient = mean > 0 && salience >= salienceFloor;

    const normalized = new Float32Array(SEMITONES);
    if (peak > 0) {
      for (let i = 0; i < SEMITONES; i++) normalized[i] = chroma[i] / peak;
    }

    if (salient) {
      const match = this.restrictTo
        ? matchChordAmong(normalized, this.restrictTo, this.offset)
        : matchChord(normalized, this.offset);
      // In restricted mode reject ambiguous frames (the chroma is between the
      // two targets, e.g. fingers in flight) so we don't flap and over-count.
      if (match && this.restrictTo && match.margin < RESTRICTED_MARGIN_MIN) {
        this.handlers.onLevel?.({
          rms,
          noiseFloor: this.noiseFloor,
          salience,
          chroma: normalized,
        });
        return;
      }
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
            if (this.lastEmittedChord !== bestChord && this.onsetSinceEmit) {
              this.handlers.onChord?.({
                chord: bestChord,
                confidence: match.confidence,
              });
              this.lastEmittedChord = bestChord;
              this.onsetSinceEmit = false;
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
