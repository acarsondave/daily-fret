// Where the neck's frets sit, as fractions of the drawing.
//
// Split out of NeckMap so a caller can lay real buttons over the figure without
// importing a component to get at a number: a tap target has to be focusable,
// named and thumb-sized, and an SVG rect is none of those without inventing
// semantics for it. The note circle solves the same problem the same way.

import { TOP_FRET } from '../../lib/noteFinder';

/** The open string sits left of the nut, and twelve fret cells run right of it. */
export const OPEN_X = 16;
export const NUT_X = 34;
export const CELL = 37;
export const NECK_VIEW_W = NUT_X + TOP_FRET * CELL + 6;

export const fretLeft = (fret: number) => (fret === 0 ? 2 : NUT_X + (fret - 1) * CELL);
export const fretWidth = (fret: number) => (fret === 0 ? NUT_X - 5 : CELL);
export const fretCentre = (fret: number) => (fret === 0 ? OPEN_X : NUT_X + (fret - 0.5) * CELL);

/** One fret's column, as percentages of the drawing's width. */
export function fretColumn(fret: number): { left: string; width: string } {
  return {
    left: `${(fretLeft(fret) / NECK_VIEW_W) * 100}%`,
    width: `${(fretWidth(fret) / NECK_VIEW_W) * 100}%`,
  };
}
