// The twelve notes as a closed loop, and the same loop as a length of string.
//
// Everything here is derived from src/audio/tuning.ts rather than restated.
// That file already owns the note-name table and says why it is written in
// sharps; a second table here would be a second answer to the same question,
// and the two would disagree the first time either changed. So the names come
// out of `midiToName`, which is defined over every MIDI number and therefore
// over every pitch class, and the flat spellings are computed from the sharp
// ones instead of listed.
//
// A pitch class is a MIDI number with the octave discarded: 0 is C, 11 is B,
// which is the convention `midiToName` already indexes by.

import { midiToName } from '../audio/tuning';

/** 0-11, C through B. The octave is not part of the value. */
export type PitchClass = number;

export const SEMITONES_IN_OCTAVE = 12;

/**
 * Where the circle starts reading, at twelve o'clock.
 *
 * A, not C. The lesson this surface carries recites the notes as "A, A sharp,
 * B, C…", the letters themselves start at A, and A is the string a guitarist
 * tunes from. Drawing the clock from C would be the piano's convention on a
 * surface that is about a fretboard.
 */
export const CIRCLE_START: PitchClass = 9;

/** The twelve pitch classes in the order the circle draws them, clockwise. */
export const CIRCLE_ORDER: readonly PitchClass[] = Array.from(
  { length: SEMITONES_IN_OCTAVE },
  (_, step) => (CIRCLE_START + step) % SEMITONES_IN_OCTAVE,
);

/** Fold any integer, including a negative one, into 0-11. */
export function pitchClass(value: number): PitchClass {
  return ((value % SEMITONES_IN_OCTAVE) + SEMITONES_IN_OCTAVE) % SEMITONES_IN_OCTAVE;
}

/** The sharp spelling, which is the one the rest of the app reads in. */
export function sharpName(pc: PitchClass): string {
  return midiToName(pitchClass(pc)).name;
}

/** True for the five notes that sit between two letters. */
export function isSharp(pc: PitchClass): boolean {
  return sharpName(pc).length > 1;
}

/**
 * The other name for the same note, or null where there is only one.
 *
 * Read off the letter above rather than from a list: a sharp is always a
 * semitone below the natural whose name it borrows, so B flat is whatever
 * `midiToName` calls the pitch class one step up, with the sign changed.
 */
export function flatName(pc: PitchClass): string | null {
  if (!isSharp(pc)) return null;
  return `${sharpName(pitchClass(pc + 1))}♭`;
}

/** How many semitones clockwise, 0-11. */
export function semitonesUp(from: PitchClass, to: PitchClass): number {
  return pitchClass(to - from);
}

/** How many semitones anticlockwise, 0-11. */
export function semitonesDown(from: PitchClass, to: PitchClass): number {
  return pitchClass(from - to);
}

/**
 * How far the walk goes, clockwise, when you actually set off.
 *
 * The one place this differs from `semitonesUp` is the note you are already
 * standing on. Modulo says nought; a person who picks A and then picks A again
 * has asked how far round it is to the next A, and the answer to that is a full
 * lap. Which is also the only gesture on this surface that draws an octave, so
 * the arithmetic is where the lesson's last claim gets demonstrated.
 */
export function stepsRound(from: PitchClass, to: PitchClass): number {
  return semitonesUp(from, to) || SEMITONES_IN_OCTAVE;
}

/** Lowest fret at or above the nut where this note falls on this string. */
export function fretOf(openMidi: number, pc: PitchClass): number {
  return pitchClass(pc - openMidi);
}

/** What note a fret produces on a string tuned to this open note. */
export function noteAtFret(openMidi: number, fret: number): PitchClass {
  return pitchClass(openMidi + fret);
}

/** How many dots the neck carries at this fret: none, one, or the octave pair. */
export function inlayAt(fret: number): 0 | 1 | 2 {
  if (fret <= 0) return 0;
  const within = fret % SEMITONES_IN_OCTAVE;
  if (within === 0) return 2;
  return within === 3 || within === 5 || within === 7 || within === 9 ? 1 : 0;
}

/**
 * The same distance said in tones, which is the unit the lesson pairs with it.
 *
 * A full lap is named rather than counted. "Six tones" is arithmetically right
 * and is not what anyone calls it, and naming it is the only moment on this
 * surface where the word octave is earned by something the player just drew.
 */
export function toneReading(semitones: number): string {
  if (semitones === SEMITONES_IN_OCTAVE) return 'octave';
  if (semitones === 1) return '½ tone';
  if (semitones === 2) return '1 tone';
  const whole = Math.floor(semitones / 2);
  return semitones % 2 === 0 ? `${whole} tones` : `${whole}½ tones`;
}
