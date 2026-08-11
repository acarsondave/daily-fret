// Real-time chord detection engine. Ports the per-frame orchestration from the
// native `engine.rs`: noise gate, onset-anchored window reset, tonal-salience
// gate, majority-vote debounce, and change-triggered emission.

import { Chromagram, SEMITONES } from './chromagram';
import { OnsetDetector } from './onset';
import { matchChord, matchChordAmong, type LearnedTemplates } from './chords';
import { diag, DIAG_CODE } from './diagnostics';

export const FRAME_SIZE = 1024;

const SILENCE_THRESHOLD = 0.005;
// Cap the adaptive noise floor so a noisy/sensitive mic can't drag the active
// gate (noiseFloor * 2) up high enough to swallow real playing. Without this the
// gate "locks out" and detection goes dead for seconds until the floor decays.
const NOISE_FLOOR_MAX = 0.03;
const CHORD_STABLE_FRAMES = 2;
export const CHROMA_SALIENCE_MIN = 1.2;
// Restricted mode (song / changes) sits slightly below open mode. A diagnostics
// export (2026-07-03) showed the entire rejected-salience band packed at
// 1.0-1.2, and ~24% of those were as loud as a median emitted chord — real
// strums (open chords ring across many pitch classes, flattening peak/mean) that
// the 1.2 bar was eating, producing the "played it right, didn't count" misses.
// 1.15 recovers ~60% of that loud band as a conservative half-step; phantom room
// noise is still stopped by the strum-loudness arming and the restricted margin
// gate below, which open mode lacks. Drop further if misses persist next export.
const CHROMA_SALIENCE_MIN_RESTRICTED = 1.15;
// Reject ambiguous frames more firmly: a ringing/decaying chord drifting toward
// the other target otherwise registers phantom transitions (false counts).
const RESTRICTED_MARGIN_MIN = 0.12;
// ...but ambiguity that never changes its mind is not ambiguity. The gate above
// exists to throw away the chroma of a hand in flight between two shapes, and a
// hand in flight drifts: its best guess wanders from frame to frame and is gone
// inside ~150ms. A hand holding a chord the templates cannot cleanly separate
// sits perfectly still and names the same chord for as long as you let it ring.
// Without this exit, three-chord sets deadlock: a diagnostics export (2026-08-10)
// has a D held through 32 consecutive frames at a median margin of 0.046, and
// the anchor rotation reported nothing at all for 4.8 seconds while the player
// was playing. Two-chord drills are untouched by this — in the same export their
// ambiguous runs are one frame long.
const AMBIGUOUS_PERSIST_FRAMES = 8;
// A count must be backed by a strum that is clearly louder than the ambient
// noise floor. This is the main guard against "it counted when I wasn't
// playing": a flux blip on room noise can fire an onset, but it won't arm a
// count unless the frame is genuinely loud. Tune if soft playing is missed
// (lower) or silence still counts (raise).
export const STRUM_RMS_RATIO = 3;
export const MIN_STRUM_RMS = 0.02;
// Loudness alone does not separate a strum from the chord it is still ringing
// out. Spectral flux spikes again part-way through a decay (its baseline is
// still recovering from the silence before the strum) and again while a hand
// comes off the strings, and each of those spikes used to reset the analysis
// window onto whatever happened to be sounding — which, on a lift, is the open
// strings. That is where the phantom chords came from.
//
// So an onset only becomes a strum if the level RISES across it: the loudest
// frame in the few frames after it must beat the loudest frame in the window
// before it. Measured this way a decay scores below 1 (it is quieter than it
// just was) whether or not it is loud, while a fresh strum lands near 1.6 even
// when it is played on top of a chord that has not finished ringing.
const STRUM_ATTACK_RISE = 1.2;
// The reference is the loudest frame in the ~140ms before the attack started,
// skipping the two frames the attack is already bleeding into. Max, not min: a
// frame that catches only the first milliseconds of a strum reads quiet, and
// against a minimum that frame would make the chord's own sustain look like a
// second strum.
const ATTACK_REF_FRAMES = 6;
const ATTACK_SKIP_FRAMES = 2;
// A strum is spread across the strings and takes a few frames to reach full
// level, so the rise is looked for over this many frames from the onset.
const ATTACK_CONFIRM_FRAMES = 4;
// The onset gate disarms after every counted chord and normally re-arms only on
// a fresh strum. During continuous/fast playing the flux-based onset detector
// misses strums (its baseline rises), which silently starves real chord changes.
// So also re-arm once this much time has passed since the last count: longer than
// the sub-130ms ring/transition flicker we want to suppress, short enough that
// any genuine human chord change still registers.
const REARM_MS = 150;

// Snapshot of every tuning constant, embedded in each diagnostic session so an
// exported log is interpretable even after the constants change.
export const DETECTOR_CONSTANTS: Record<string, number> = {
  FRAME_SIZE,
  SILENCE_THRESHOLD,
  NOISE_FLOOR_MAX,
  CHORD_STABLE_FRAMES,
  CHROMA_SALIENCE_MIN,
  CHROMA_SALIENCE_MIN_RESTRICTED,
  RESTRICTED_MARGIN_MIN,
  STRUM_RMS_RATIO,
  MIN_STRUM_RMS,
  STRUM_ATTACK_RISE,
  ATTACK_REF_FRAMES,
  ATTACK_SKIP_FRAMES,
  ATTACK_CONFIRM_FRAMES,
  REARM_MS,
  AMBIGUOUS_PERSIST_FRAMES,
};

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
  // The chord this frame matched (restricted mode) and its margin to the runner
  // up, or null/0 when the frame did not cleanly match. Lets passive calibration
  // ingest only frames the detector already agrees with at high confidence.
  chord: string | null;
  margin: number;
  /**
   * A strum landed at or just before this frame.
   *
   * Latched rather than instantaneous: the frame carrying the attack resets the
   * chromagram and therefore produces no chroma, so reporting the strum only on
   * that frame would report it to nobody. It is carried to the first frame a
   * listener actually receives, which is the first frame that can describe what
   * was struck. Anything counting player actions must key off this, because a
   * chord alone cannot tell a fresh placement from the one still ringing.
   */
  strum: boolean;
  /**
   * How loud the strum being reported on this frame actually hit, or 0 on frames
   * that carry no strum.
   *
   * Carried alongside the flag because a strum's level is the only thing that
   * says whether the chord arriving after it belongs to it. A hand muting the
   * strings is a huge transient with nothing behind it: the frames that follow
   * are the dying tail of whatever was already ringing, and without the attack
   * level to measure them against there is no way to tell that tail from the
   * sound of a shape genuinely placed and struck.
   */
  strumRms: number;
  /**
   * How far the strum rose above the level it landed on: its attack over the
   * loudest frame in the ~140ms before it. 0 on frames carrying no strum.
   *
   * The detector arms anything above STRUM_ATTACK_RISE, deliberately low so soft
   * playing still registers. A guitar's sustain is not smooth — strings beat
   * against each other — so a swell inside a chord that never went away can just
   * clear that bar, and a drill counting placements would count it twice. The
   * ratio is reported rather than acted on here, so a drill that needs a
   * stronger claim than "something got louder" can ask for one without raising
   * the bar for every drill that does not.
   */
  strumRise: number;
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
  templates?: LearnedTemplates; // per-chord learned overrides from calibration
}

export class ChordDetector {
  private readonly chromagram: Chromagram;
  private readonly onsetDetector: OnsetDetector;
  private readonly handlers: DetectorHandlers;
  private offset: number;
  private restrictTo: string[] | null;
  private readonly learned: LearnedTemplates | undefined;

  private lastEmittedChord: string | null = null;
  private chordHistory: string[] = [];
  private silentFrameCount = 0;
  private noiseFloor = SILENCE_THRESHOLD;
  // A counted chord must be backed by a fresh strum. After each emission this
  // flips false and only a new onset (or a pause) re-arms it, so a chord's decay
  // or fingers moving toward the next shape can't register a phantom count.
  // Starts armed so the first strum of a session counts.
  private onsetSinceEmit = true;
  private lastEmitAt = 0; // epoch ms of the last emitted chord (drives REARM_MS)
  // Rolling RMS of the last few frames, so an onset can be compared against the
  // level the signal was already at. That comparison is what makes an attack an
  // attack rather than a loud part of a decay.
  private readonly recentRms = new Float32Array(ATTACK_REF_FRAMES + ATTACK_SKIP_FRAMES)
    .fill(SILENCE_THRESHOLD);
  private recentHead = 0;
  // An onset waiting to be judged: the level it has to beat, how many frames it
  // has left to do it in, and the RMS it fired at (kept only so the diagnostic
  // record still describes the onset itself rather than the frame that settled
  // it).
  private candidateFrames = 0;
  private candidateRef = 0;
  private candidateRms = 0;
  // Set when a strum is confirmed, cleared when it has been reported on a level
  // event. See LevelEvent.strum for why it has to survive a frame or two.
  private strumPending = false;
  private strumRmsPending = 0;
  private strumRisePending = 0;
  // How many frames in a row have named the same chord while sitting under the
  // restricted margin. See AMBIGUOUS_PERSIST_FRAMES.
  private ambiguousChord: string | null = null;
  private ambiguousRun = 0;

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
    this.learned = opts.templates;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  setRestrict(chords: string[] | null): void {
    this.restrictTo = chords && chords.length ? chords : null;
    diag.mark(this.restrictTo ? `restrict: ${this.restrictTo.join(', ')}` : 'restrict: open');
  }

  /// The level an attack has to rise above: the loudest frame in the reference
  /// window, which stops ATTACK_SKIP_FRAMES short of now so the leading edge of
  /// the attack itself is never used as its own reference.
  private attackReference(): number {
    let max = 0;
    // recentHead is the oldest slot, so the window runs from there forward and
    // the newest ATTACK_SKIP_FRAMES entries sit at the end.
    for (let i = 0; i < ATTACK_REF_FRAMES; i++) {
      const v = this.recentRms[(this.recentHead + i) % this.recentRms.length];
      if (v > max) max = v;
    }
    return max;
  }

  /// True on the frame an open onset candidate proves itself a strum. A
  /// candidate that never reaches the level is dropped, and reported as an
  /// onset that did not arm anything.
  private settleCandidate(rms: number, loud: boolean): boolean {
    if (this.candidateFrames === 0) return false;
    if (loud && rms >= this.candidateRef * STRUM_ATTACK_RISE) {
      this.candidateFrames = 0;
      diag.onset(this.candidateRms, true);
      return true;
    }
    this.candidateFrames -= 1;
    if (this.candidateFrames === 0) diag.onset(this.candidateRms, false);
    return false;
  }

  /// A strum has been established. Anchor the analysis window to it so the next
  /// chroma describes what was just struck rather than what is still ringing,
  /// let a change be emitted again, and hold the flag for the drills.
  private acceptStrum(): void {
    this.handlers.onOnset?.({ energy: this.candidateRms });
    this.onsetSinceEmit = true;
    this.strumPending = true;
    this.strumRmsPending = this.candidateRms;
    this.strumRisePending = this.candidateRef > 0 ? this.candidateRms / this.candidateRef : 0;
    this.chromagram.reset();
    this.chordHistory = [];
    // A fresh strum is a fresh question. Whatever the last shape was narrowing
    // toward, this one has to earn its own persistence.
    this.ambiguousRun = 0;
    this.ambiguousChord = null;
  }

  /// Every level event goes through here so the latched strum flag is reported
  /// exactly once, on the first frame a listener actually receives after it.
  private emitLevel(ev: Omit<LevelEvent, 'strum' | 'strumRms' | 'strumRise'>): void {
    const handler = this.handlers.onLevel;
    const strum = this.strumPending;
    const strumRms = strum ? this.strumRmsPending : 0;
    const strumRise = strum ? this.strumRisePending : 0;
    this.strumPending = false;
    handler?.({ ...ev, strum, strumRms, strumRise });
  }

  /// Feed exactly one FRAME_SIZE block of mono samples.
  processFrame(frame: Float32Array): void {
    if (frame.length !== FRAME_SIZE) return;

    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    const rms = Math.sqrt(sumSq / frame.length);
    const attackRef = this.attackReference();
    this.recentRms[this.recentHead] = rms;
    this.recentHead = (this.recentHead + 1) % this.recentRms.length;

    const loud = rms > Math.max(this.noiseFloor * STRUM_RMS_RATIO, MIN_STRUM_RMS);
    // An onset opened on an earlier frame may prove itself on this one, silent
    // frames included: a candidate that runs into silence has to be dropped, not
    // left open for the next chord to inherit.
    if (this.settleCandidate(rms, loud)) this.acceptStrum();

    const activeThreshold = Math.max(this.noiseFloor * 2, SILENCE_THRESHOLD);
    if (rms < activeThreshold) {
      this.noiseFloor = Math.min(this.noiseFloor * 0.98 + rms * 0.02, NOISE_FLOOR_MAX);
      this.emitLevel({
        rms,
        noiseFloor: this.noiseFloor,
        salience: 0,
        chroma: null,
        chord: null,
        margin: 0,
      });

      diag.silentFrame();
      this.silentFrameCount += 1;
      this.ambiguousRun = 0;
      this.ambiguousChord = null;
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
      // Keep the rolling buffer current for when audio resumes, but skip the
      // 8192-point chroma compute: the result is unused on silent frames. The
      // onset detector's much smaller transform does have to run, because its
      // baseline is only meaningful if the quiet is in it.
      this.chromagram.advance(frame);
      this.onsetDetector.observe(frame);
      return;
    }

    this.silentFrameCount = 0;

    if (this.onsetDetector.detect(frame)) {
      // Open a candidate rather than acting on the onset directly. Whether this
      // is a strum or the middle of a decay is not yet knowable: a strum reaches
      // full level over the next few frames, and that is the part worth reading.
      // A candidate still open here is superseded, and goes into the record as
      // the onset it was: one that armed nothing.
      if (this.candidateFrames > 0) diag.onset(this.candidateRms, false);
      this.candidateFrames = ATTACK_CONFIRM_FRAMES;
      this.candidateRef = attackRef;
      this.candidateRms = rms;
      if (this.settleCandidate(rms, loud)) this.acceptStrum();
    }

    const chroma = this.chromagram.next(frame);
    if (!chroma) {
      diag.frame(DIAG_CODE.WINDOW_FILLING, rms, this.noiseFloor, 0, 0, null);
      return;
    }

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

    // What this frame matched, surfaced on the level event for passive calibration.
    let frameChord: string | null = null;
    let frameMargin = 0;

    if (salient) {
      const match = this.restrictTo
        ? matchChordAmong(normalized, this.restrictTo, this.offset, this.learned)
        : matchChord(normalized, this.offset, this.learned);
      if (match) {
        frameChord = match.chord;
        frameMargin = match.margin;
      }
      // In restricted mode reject ambiguous frames (the chroma is between the
      // two targets, e.g. fingers in flight) so we don't flap and over-count —
      // unless the same chord has been winning narrowly for long enough that a
      // hand in flight would have landed by now.
      const narrow = !!match && !!this.restrictTo && match.margin < RESTRICTED_MARGIN_MIN;
      if (narrow) {
        this.ambiguousRun = match!.chord === this.ambiguousChord ? this.ambiguousRun + 1 : 1;
        this.ambiguousChord = match!.chord;
      } else {
        this.ambiguousRun = 0;
        this.ambiguousChord = null;
      }
      if (narrow && this.ambiguousRun < AMBIGUOUS_PERSIST_FRAMES) {
        diag.frame(DIAG_CODE.AMBIGUOUS, rms, this.noiseFloor, salience, match!.margin, match!.chord);
        // The frame is being rejected as in-flight, so it must not be reported
        // as a match either. Passing the name through was how a chroma the
        // detector had just refused to believe still reached the drills.
        this.emitLevel({
          rms,
          noiseFloor: this.noiseFloor,
          salience,
          chroma: normalized,
          chord: null,
          margin: match.margin,
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
            const armed = this.onsetSinceEmit || Date.now() - this.lastEmitAt >= REARM_MS;
            if (this.lastEmittedChord !== bestChord && armed) {
              diag.frame(DIAG_CODE.EMIT, rms, this.noiseFloor, salience, match.margin, bestChord);
              diag.emit(bestChord, match.confidence);
              this.handlers.onChord?.({
                chord: bestChord,
                confidence: match.confidence,
              });
              this.lastEmittedChord = bestChord;
              this.onsetSinceEmit = false;
              this.lastEmitAt = Date.now();
            } else if (this.lastEmittedChord !== bestChord) {
              // The vote wanted a change but the arming gate blocked it. This is
              // the starvation signature: many of these in a row = real changes
              // being eaten.
              diag.frame(DIAG_CODE.BLOCKED_UNARMED, rms, this.noiseFloor, salience, match.margin, bestChord);
            } else {
              diag.frame(DIAG_CODE.HOLD, rms, this.noiseFloor, salience, match.margin, bestChord);
            }
          } else {
            diag.frame(DIAG_CODE.VOTE_PENDING, rms, this.noiseFloor, salience, match.margin, match.chord);
          }
        } else {
          diag.frame(DIAG_CODE.VOTE_PENDING, rms, this.noiseFloor, salience, match.margin, match.chord);
        }
      } else {
        diag.frame(DIAG_CODE.NO_MATCH, rms, this.noiseFloor, salience, 0, null);
      }
    } else {
      diag.frame(DIAG_CODE.LOW_SALIENCE, rms, this.noiseFloor, salience, 0, null);
      this.chordHistory = [];
    }

    this.emitLevel({
      rms,
      noiseFloor: this.noiseFloor,
      salience,
      chroma: normalized,
      chord: frameChord,
      margin: frameMargin,
    });
  }
}
