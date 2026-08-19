// Where the neck's frets sit, as fractions of the drawing.
//
// Split out of NeckMap so a caller can lay real buttons over the figure without
// importing a component to get at a number: a tap target has to be focusable,
// named and thumb-sized, and an SVG rect is none of those without inventing
// semantics for it. The note circle solves the same problem the same way.

import { TOP_FRET } from '../../lib/noteFinder';

/**
 * The open string is a cell of its own, left of the nut, and the string's name
 * sits to the left of that again.
 *
 * The name used to share the open cell's space, which put the string line
 * straight through the letter and the open string's own mark straight over it:
 * the one position on the neck that already has a name written on it was the one
 * position whose name could not be read. They are separate columns now.
 */
export const LABEL_X = 10;
export const OPEN_LEFT = 24;
export const NUT_X = 57;
export const CELL = 37;
export const NECK_VIEW_W = NUT_X + TOP_FRET * CELL + 6;
/** Where the drawn string starts: at its open cell, clear of its name. */
export const STRING_X = OPEN_LEFT;

export const fretLeft = (fret: number) => (fret === 0 ? OPEN_LEFT : NUT_X + (fret - 1) * CELL);
export const fretWidth = (fret: number) => (fret === 0 ? NUT_X - OPEN_LEFT : CELL);
export const fretCentre = (fret: number) =>
  fret === 0 ? OPEN_LEFT + (NUT_X - OPEN_LEFT) / 2 : NUT_X + (fret - 0.5) * CELL;

/** One fret's column, as percentages of the drawing's width. */
export function fretColumn(fret: number): { left: string; width: string } {
  return {
    left: `${(fretLeft(fret) / NECK_VIEW_W) * 100}%`,
    width: `${(fretWidth(fret) / NECK_VIEW_W) * 100}%`,
  };
}
