// Where a neck's frets and strings sit, for however much of the neck is drawn.
//
// Split out of NeckMap so a caller can lay real buttons over the figure without
// importing a component to get at a number: a tap target has to be focusable,
// named and thumb-sized, and an SVG rect is none of those without inventing
// semantics for it. The note circle solves the same problem the same way.
//
// THE DRAWING IS ALWAYS THE SAME WIDTH. A rung that only asks about the first
// four frets used to be drawn across all twelve, which put the whole of its
// world in a quarter of a picture and made a fret about four millimetres of a
// propped laptop. So the window narrows and the cells fatten to fill the same
// canvas, which means every stroke weight, letter size and row height on the
// figure keeps the meaning it already had: a narrower question is drawn bigger,
// not drawn differently.

import { STRING_POSITIONS } from '../../lib/noteFinder';

/**
 * The strings top to bottom, as this app draws them.
 *
 * Thinnest at the top, which is how tab is written and how TabStaff engraves it
 * two drills away. A fretboard chart is honestly drawn either way up and both
 * are in common use; what it cannot be is drawn one way up here and the other
 * way there, because then reading anything starts with working out which guitar
 * you are looking at.
 */
export const STRING_STACK: readonly number[] = [...STRING_POSITIONS].reverse();

/** The drawing's width in its own units, whatever stretch of neck it holds. */
export const VIEW_W = 507;
/**
 * The string's name, in a column of its own left of everything.
 *
 * The column is sized for the largest lettering this figure ever sets, which is
 * a four-fret window on a phone. The name used to share the open cell's space,
 * which put the string line straight through the letter and the open string's
 * own mark straight over it: the one position on the neck that already has a
 * name written on it was the one position whose name could not be read.
 */
export const LABEL_X = 14;
/** Where the board and the drawn strings start, clear of the names. */
export const BOARD_LEFT = 36;
const RIGHT_MARGIN = 6;
/**
 * The open cell, relative to a fretted one.
 *
 * Slightly narrower because it is not a fret: it is the string sounding with
 * nothing on it, and giving it a fret's full width would draw it as one.
 */
const OPEN_SHARE = 0.9;

/** Rows follow the cells, so a position stays something a fingertip could cover. */
const ROW_OF_CELL = 0.42;
const ROW_MIN = 18;
const ROW_MAX = 44;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export interface NeckWindow {
  /** Lowest fret drawn. Zero means the nut and the open string are in the picture. */
  from: number;
  /** Highest fret drawn. */
  to: number;
  frets: number[];
  /** Width of one fretted cell. */
  cell: number;
  /** Height of one string's row. */
  row: number;
  /** Where the nut is drawn, or null when the window starts past it. */
  nutX: number | null;
  left: (fret: number) => number;
  width: (fret: number) => number;
  centre: (fret: number) => number;
}

export function neckWindow(from: number, to: number): NeckWindow {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new Error(`A neck cannot be drawn from fret ${from} to fret ${to}.`);
  }
  const frets = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const open = from === 0;
  const cell = (VIEW_W - BOARD_LEFT - RIGHT_MARGIN) / (frets.length - (open ? 1 - OPEN_SHARE : 0));
  const openWidth = cell * OPEN_SHARE;
  const nutX = open ? BOARD_LEFT + openWidth : null;

  const left = (fret: number) => {
    if (open && fret === 0) return BOARD_LEFT;
    const before = open ? fret - 1 : fret - from;
    return (nutX ?? BOARD_LEFT) + before * cell;
  };
  const width = (fret: number) => (open && fret === 0 ? openWidth : cell);

  return {
    from,
    to,
    frets,
    cell,
    row: Math.round(clamp(cell * ROW_OF_CELL, ROW_MIN, ROW_MAX)),
    nutX,
    left,
    width,
    centre: (fret: number) => left(fret) + width(fret) / 2,
  };
}

export interface NeckLayout {
  viewH: number;
  boardTop: number;
  boardBottom: number;
  /** Where the fret numbers are written. */
  numberY: number;
  /** Vertical centre of one string's row, by its index in the drawn stack. */
  rowY: (index: number) => number;
  /** Height of a mark drawn over one position. */
  markH: number;
  /**
   * Type size for the figure's own lettering, in drawing units.
   *
   * Carried here rather than left to a stylesheet because the drawing scales to
   * whatever width it is given: a size fixed in CSS would render at one size on
   * a whole neck and at three times that on a four-fret window.
   */
  type: number;
}

export function neckLayout(window: NeckWindow, strings: number): NeckLayout {
  const { row } = window;
  const rowTop = row + row / 3;
  const boardTop = rowTop - row / 2;
  const boardBottom = rowTop + (strings - 1) * row + row / 2;
  const type = Math.round(clamp(row * 0.62, 12, 24));
  const numberY = boardBottom + type + 5;
  return {
    viewH: numberY + type / 2,
    boardTop,
    boardBottom,
    numberY,
    rowY: (index: number) => rowTop + index * row,
    markH: Math.round(row * 0.72),
    type,
  };
}

/** One position's box over the drawing, as percentages, for a real button. */
export function positionBox(
  window: NeckWindow,
  layout: NeckLayout,
  fret: number,
  rowIndex: number,
): { left: string; top: string; width: string; height: string } {
  const top = layout.rowY(rowIndex) - window.row / 2;
  return {
    left: `${(window.left(fret) / VIEW_W) * 100}%`,
    width: `${(window.width(fret) / VIEW_W) * 100}%`,
    top: `${(top / layout.viewH) * 100}%`,
    height: `${(window.row / layout.viewH) * 100}%`,
  };
}
