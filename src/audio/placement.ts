// Counts placements for Chord Perfect: place the shape, strum it, lift clear,
// place it again.
//
// The drill used to count a chord APPEARING, gated on the chord first having
// gone away for a while. Both halves of that are wrong, and a diagnostics export
// from a real session shows exactly how wrong. A strummed chord rings on through
// the lift and into the next placement, so the shape never appears to go away
// and the next rep never counts: three 30-second blocks with 58, 51 and 52
// strums in them scored 7, 11 and 17. What the number tracked was not how many
// times the player placed the shape but how often the sound happened to die out
// between reps, which is a property of the room and of the chord, not of the
// playing. It also ran backwards: the better the detection held on to a chord,
// the lower the score.
//
// So a placement is counted from the strum instead. The strum is the one event
// that is unambiguously an action by the player: it is a rise in level, it
// cannot be produced by a chord decaying, and it cannot be produced by silence.
// A strum on its own still counts nothing. It is credited only once the frames
// after it resolve to the shape being drilled, which is what makes the number
// mean "you placed THIS chord" rather than "you made a noise".
//
// What this deliberately does not try to do is verify the lift. Two strums of
// the same shape with a clean lift between them, and two strums without one,
// are the same sound; there is nothing in the audio to tell them apart. The
// drill asks for the lift on screen and counts the strums, rather than inventing
// a signal it does not have.

import type { LevelEvent } from './detector';

// Frames matching the target that must follow a strum before it is credited.
// One frame is ~23ms, and the chromagram needs ~186ms after a strum to produce
// its first reading, so two frames puts a confirmed placement ~230ms behind the
// strum that earned it: fast enough to feel immediate, slow enough that a single
// stray frame cannot spend a strum.
const CONFIRM_FRAMES = 2;
// How long a strum stays creditable. A strum whose chord never resolves inside
// this window is dropped and counts nothing, which is the behaviour wanted when
// the player fluffs the shape: no count is better than a wrong one.
const CONFIRM_WINDOW_MS = 600;
// Floor between counted placements. A player cannot lift clear and rebuild a
// shape four times a second, so anything faster is the same strum being credited
// twice, and this refuses it.
const MIN_PLACEMENT_MS = 250;

export interface PlacementOptions {
  confirmFrames?: number;
  confirmWindowMs?: number;
  minPlacementMs?: number;
}

/**
 * The placement machine for one Chord Perfect block.
 *
 * Fed every level event from the detector, in order, with the clock reading at
 * that frame. `frame` returns true on the frame a placement is counted, so the
 * caller can do exactly one thing per placement.
 */
export class PlacementCounter {
  private readonly confirmFrames: number;
  private readonly confirmWindowMs: number;
  private readonly minPlacementMs: number;

  private target = '';
  private hold = 0; // consecutive frames matching the target
  private otherHold = 0; // consecutive frames matching some other chord
  private otherChord = '';
  private strumAt = -1; // when the uncredited strum landed, or -1 for none
  private lastPlacementAt = -Infinity;
  private placements = 0;

  constructor(options: PlacementOptions = {}) {
    this.confirmFrames = options.confirmFrames ?? CONFIRM_FRAMES;
    this.confirmWindowMs = options.confirmWindowMs ?? CONFIRM_WINDOW_MS;
    this.minPlacementMs = options.minPlacementMs ?? MIN_PLACEMENT_MS;
  }

  /**
   * Point the counter at a shape and start its block from zero.
   *
   * Any strum already in flight is dropped: it was aimed at the previous shape,
   * and the chord still ringing from it must not be allowed to open the next
   * block with a placement the hand has not made.
   */
  begin(chord: string): void {
    this.target = chord;
    this.hold = 0;
    this.otherHold = 0;
    this.otherChord = '';
    this.strumAt = -1;
    this.lastPlacementAt = -Infinity;
    this.placements = 0;
  }

  get count(): number {
    return this.placements;
  }

  /** Whether the shape is being held right now. Drives the diagram, not the score. */
  get held(): boolean {
    return this.hold >= this.confirmFrames;
  }

  frame(ev: LevelEvent, nowMs: number): boolean {
    if (ev.strum) {
      // A new strum supersedes any older one still waiting: whatever sounds from
      // here belongs to this one.
      this.strumAt = nowMs;
      this.hold = 0;
      this.otherHold = 0;
      this.otherChord = '';
    }

    if (ev.chord === null) {
      this.hold = 0;
      this.otherHold = 0;
      return false;
    }

    if (ev.chord !== this.target) {
      // A strum belongs to the first shape that settles after it. Once the
      // frames have plainly resolved to something else, that strum was a strum
      // of something else, and no later drift back onto the target may spend it.
      this.hold = 0;
      this.otherHold = ev.chord === this.otherChord ? this.otherHold + 1 : 1;
      this.otherChord = ev.chord;
      if (this.otherHold >= this.confirmFrames) this.strumAt = -1;
      return false;
    }

    this.hold += 1;
    this.otherHold = 0;

    if (this.strumAt < 0) return false;
    if (nowMs - this.strumAt > this.confirmWindowMs) {
      this.strumAt = -1;
      return false;
    }
    if (this.hold < this.confirmFrames) return false;
    // Too soon after the last placement to be a second one. The strum is spent,
    // not deferred: holding it back would only let it count once the floor
    // passed, which is the double count arriving late.
    if (nowMs - this.lastPlacementAt < this.minPlacementMs) {
      this.strumAt = -1;
      return false;
    }

    this.strumAt = -1;
    this.lastPlacementAt = nowMs;
    this.placements += 1;
    return true;
  }
}
