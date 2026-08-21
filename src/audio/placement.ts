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
// Counting strums is not enough on its own, and a later export (2026-08-10)
// shows why. Two things that are not strums pass the arming gate, because that
// gate asks whether the level rose and never whether a note started:
//
//   - A hand muting the strings. In that export it is a 0.94 transient that
//     falls to 0.07 in 46ms. It is *louder* than the strum it follows, so it
//     clears the rise test easily, and it contains no chord at all.
//   - A swell inside a chord that is still ringing. A guitar's sustain is not
//     monotonic; strings beat against each other, and a 20% ripple across 140ms
//     reads as an attack.
//
// Either one then gets credited by the dying tail of the chord that was already
// sounding — several in that export at an RMS of 0.025 to 0.07, at the noise
// gate. So the score drifted with how long a shape rings rather than with how
// often it was placed: Em (three open strings) scored 27 where Am scored 14 off
// the same number of strums. That is the original bug's mirror image. The old
// rule needed silence and scored long-ringing chords too low; this one accepted
// ringing as evidence and scored them too high. Both were measuring the room.
//
// So a strum has to be paid for three times over, and each test is about the
// sound the player's hand actually made:
//
//   1. The chord confirming it must be loud enough to be a strum in its own
//      right. Same bar the detector uses to arm one: no new number.
//   2. It must be a fair fraction of the attack that armed it. This is the test
//      a mute cannot pass, because a mute's attack is enormous and what follows
//      it is a decay that has nothing to do with it.
//
// Replayed against that export, the two together keep the block that was already
// clean at exactly its shipped count and take a fifth off each of the two
// inflated ones, closing most of the gap between them.
//
// Two things were tried and are deliberately not here, both because the takes in
// tests/placements.test.mjs show they cannot tell a real rep from a false one:
//
//   - Requiring the sound to fall away between reps — the lift, which is the
//     drill's whole motion. A rep every 800ms with the chord damped at 700ms has
//     the same envelope as a take with no lift in it at all: the next strum
//     lands before the damp is audible. No rule can pass one and fail the other,
//     and one that failed both would silently punish playing at pace.
//   - Asking a strum to rise further above what it landed on than the detector
//     needs to arm it. That reference is the loudest frame in the 140ms before
//     the attack, which during continuous playing is the chord still ringing, so
//     genuine strums sit barely above the bar too.
//
// The swell inside a sustaining chord therefore still gets through, and it is
// the one over-count left. It is a detector-level question — a swell is not an
// attack — and the changes drills read the same arming and currently do not miss
// anything, so it is not worth risking them for it from here.
//
// It is caught here instead, by the refractory floor, and the export of
// 2026-08-21 is what showed where that floor belongs. See MIN_PLACEMENT_MS: the
// swells do not arrive at random, they arrive in the half-second after a
// placement while the shape it counted is still sounding, so a floor set from
// the real spacing of reps removes them without any new test on the sound.

import type { LevelEvent } from './detector';
import { MIN_STRUM_RMS, STRUM_RMS_RATIO } from './detector';

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
// shape this fast, so anything faster is the same placement being credited
// twice, and this refuses it.
//
// It was 250ms, which is a guess at the edge of what a hand can do rather than a
// reading of what one does. Every chord-perfect block in the thirteen exports at
// the repository root — 309 placements, 292 gaps between consecutive ones in the
// same block — says the number is more than twice that. The gaps are bimodal:
//
//   250-549ms   34 gaps   a dense cluster sitting on the old floor
//   550-1099ms  20 gaps   the trough, roughly a third of the density either side
//   1100ms+    238 gaps   the drill, median 1672ms
//
// The cliff falls immediately after 549: nine gaps in the 500-549 bucket, two in
// the 550-599 one. Past 600ms the removal curve flattens (550→600 takes another
// 0.6% of placements, 600→700 takes 1.0%, 700→800 another 0.7%), which is the
// floor starting to eat the trough rather than the cluster. So 600ms: inside the
// trough rather than on its edge, and a hundred milliseconds clear of the
// fastest rep any test here defends.
//
// What that cluster is, is not a guess either. Applying this floor to the real
// blocks takes Em down 10%, Dm 14% and C 21%, and Am not at all — and Am is the
// one shape in the set with no long open ring behind it. An over-count that
// scales with how long a chord sustains is the swell described above, not a rep.
// The number the player is shown drops about a tenth, and it stops being partly
// a measurement of the room.
const MIN_PLACEMENT_MS = 600;
// How much of the strum's own attack the chord confirming it has to still carry.
// Measured on the 2026-08-10 export: mutes confirm at 3-11% of their attack,
// genuine placements at 41% and up, most of them above 90% or louder than the
// attack frame itself (a strum spreads across the strings and peaks after the
// frame that caught its leading edge). 0.3 sits in the empty band between.
const STRUM_BODY_FRACTION = 0.3;

export interface PlacementOptions {
  confirmFrames?: number;
  confirmWindowMs?: number;
  minPlacementMs?: number;
  strumBodyFraction?: number;
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
  private readonly strumBodyFraction: number;

  private target = '';
  private hold = 0; // consecutive frames matching the target
  private otherHold = 0; // consecutive frames matching some other chord
  private otherChord = '';
  private strumAt = -1; // when the uncredited strum landed, or -1 for none
  private strumRms = 0; // how hard that strum hit
  private lastPlacementAt = -Infinity;
  private placements = 0;

  constructor(options: PlacementOptions = {}) {
    this.confirmFrames = options.confirmFrames ?? CONFIRM_FRAMES;
    this.confirmWindowMs = options.confirmWindowMs ?? CONFIRM_WINDOW_MS;
    this.minPlacementMs = options.minPlacementMs ?? MIN_PLACEMENT_MS;
    this.strumBodyFraction = options.strumBodyFraction ?? STRUM_BODY_FRACTION;
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
    this.strumRms = 0;
    this.lastPlacementAt = -Infinity;
    this.placements = 0;
  }

  /**
   * Point the counter at a different shape without ending the run.
   *
   * For a rotation, where the target changes every time the player lands one and
   * the count is of the whole loop rather than of one shape. Any strum in flight
   * is dropped for the same reason `begin` drops it: it was aimed at the shape
   * that has just been answered.
   */
  retarget(chord: string): void {
    this.target = chord;
    this.hold = 0;
    this.otherHold = 0;
    this.otherChord = '';
    this.strumAt = -1;
    this.strumRms = 0;
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
      this.strumRms = ev.strumRms;
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
    // The chord has to be a sound in its own right, by the same bar the detector
    // used to decide the strum was one.
    if (ev.rms <= Math.max(ev.noiseFloor * STRUM_RMS_RATIO, MIN_STRUM_RMS)) return false;
    // ...and it has to belong to the strum that armed it rather than to whatever
    // was already ringing when a mute landed on top of it. Not spent on failure:
    // the same strum's chord can still swell into range a frame or two later.
    if (this.strumRms > 0 && ev.rms < this.strumBodyFraction * this.strumRms) return false;

    this.strumAt = -1;
    this.lastPlacementAt = nowMs;
    this.placements += 1;
    return true;
  }
}
