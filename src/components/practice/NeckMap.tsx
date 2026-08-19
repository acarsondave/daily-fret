// The neck, as the note finder has filled it in.
//
// THESIS. A fretboard wears where it is played. That is the figure: every
// position the drill has asked about and been answered at is drawn as light on
// the wood, and a position it has never put a question to is drawn as wood.
// Nothing on it is a score, a percentage or a verdict — an unasked fret is not a
// failure and must never look like one, so the only honest mark for it is none.
//
// It is therefore blank on the day it is first opened, and that is correct. What
// makes it worth opening is what it looks like after a month and after a year:
// the low strings filling first, first position going bright before the fifth
// fret has been asked about at all, and the gaps that are still gaps.
//
// ONE DRAWING, TWO DENSITIES. The same figure draws all six strings, which is
// the record, and one string at a time, which is the drill asking a question.
// Row height and lettering follow the number of strings rather than being
// authored twice, because a second copy of this would drift from the first the
// day either changed.
//
// WHAT IT IS NOT A CLAIM ABOUT. A microphone hears a pitch, and a pitch does not
// carry the string it came off. Every mark here means the prompt named this
// position and the pitch that position makes came back — never "your finger was
// here". src/lib/noteFinder.ts holds that argument in full.

import { useMemo } from 'react';
import clsx from 'clsx';
import {
  QUICK_MS,
  STRING_POSITIONS,
  TOP_FRET,
  openMidiOf,
  positionKey,
  positionStanding,
  type NoteMap,
  type PositionStanding,
} from '../../lib/noteFinder';
import { inlayAt, noteAtFret, sharpName } from '../../lib/noteCircle';
import { DEFAULT_TUNING_ID, getTuning } from '../../audio/tuning';
import { CELL, NECK_VIEW_W, NUT_X, OPEN_X, fretCentre, fretLeft, fretWidth } from './neckGeometry';
import './neckMap.css';

// The engraving is fixed and written out rather than derived from a scale
// factor, because a half pixel of drift shows on a figure this regular. It lives
// in ./neckGeometry.ts so a caller can lay tap targets over the drawing without
// importing a component to get at a number. Only the CSS ever picks a size.

/** Fret numbers worth writing. The dots already say where the rest are. */
const NUMBERED = [3, 5, 7, 9, 12];

const STANDARD = getTuning(DEFAULT_TUNING_ID);
const STRING_LABEL = new Map(STANDARD.strings.map((s) => [s.position, s.name]));

export interface NeckMark {
  stringPosition: number;
  fret: number;
}

interface Props {
  map: NoteMap;
  /** Which strings to draw, thickest first. Absent draws the whole instrument. */
  strings?: readonly number[];
  /**
   * Positions to call out over the wear: this run's finds, or the one just
   * answered. Drawn as an outline rather than a fill, so the wear underneath
   * still reads and the call-out is visibly a different kind of statement.
   */
  marks?: readonly NeckMark[];
  /** Write the note name on each marked position. Off while a drill is asking. */
  nameMarks?: boolean;
  /** Draw one string heavier than the rest: the one a prompt is asking about. */
  litString?: number | null;
  className?: string;
}

/** How many positions stand at each level, for the one line a screen reader gets. */
function tally(map: NoteMap, strings: readonly number[]): { found: number; quick: number; total: number } {
  let found = 0;
  let quick = 0;
  let total = 0;
  for (const stringPosition of strings) {
    for (let fret = 0; fret <= TOP_FRET; fret += 1) {
      total += 1;
      const standing = positionStanding(map[positionKey(stringPosition, fret)]);
      if (standing === 'unasked') continue;
      found += 1;
      if (standing === 'quick') quick += 1;
    }
  }
  return { found, quick, total };
}

export function NeckMap({
  map,
  strings = STRING_POSITIONS,
  marks,
  nameMarks = false,
  litString = null,
  className,
}: Props) {
  // Row height follows the number of strings: six rows is a record to scan, one
  // row is a question being asked from across the room, and they cannot be the
  // same size without one of them failing at its job.
  const single = strings.length === 1;
  const row = single ? 46 : 18;
  const rowTop = single ? 30 : 24;
  const boardTop = rowTop - row / 2;
  const boardBottom = rowTop + (strings.length - 1) * row + row / 2;
  const numberY = boardBottom + (single ? 22 : 17);
  const viewH = numberY + (single ? 8 : 6);
  const markH = single ? 30 : 13;
  const markInset = single ? 4 : 3.5;
  const rowY = (stringPosition: number) => rowTop + strings.indexOf(stringPosition) * row;

  const cells = useMemo(() => {
    const out: Array<{ key: string; stringPosition: number; fret: number; standing: PositionStanding }> = [];
    for (const stringPosition of strings) {
      for (let fret = 0; fret <= TOP_FRET; fret += 1) {
        const key = positionKey(stringPosition, fret);
        const standing = positionStanding(map[key]);
        if (standing === 'unasked') continue;
        out.push({ key, stringPosition, fret, standing });
      }
    }
    return out;
  }, [map, strings]);

  const counts = useMemo(() => tally(map, strings), [map, strings]);
  const seconds = Math.round(QUICK_MS / 1000);
  const inlayGap = single ? 11 : 15;

  return (
    <div className={clsx('neck-map', single && 'is-single', className)}>
      {/* The figure in words. Silent about the frets nothing has been asked
          about, exactly as the drawing is. */}
      <p className="sr-only">
        {counts.found === 0
          ? 'Nothing has been asked for on this neck yet.'
          : `${counts.found} of ${counts.total} positions found, ${counts.quick} of them inside ${seconds} seconds.`}
      </p>

      <svg viewBox={`0 0 ${NECK_VIEW_W} ${viewH}`} aria-hidden="true" focusable="false">
        <rect
          className="nm-board"
          x={NUT_X}
          y={boardTop}
          width={NECK_VIEW_W - NUT_X - 3}
          height={boardBottom - boardTop}
          rx={2}
        />

        {Array.from({ length: TOP_FRET }, (_, i) => (
          <line
            key={`w${i}`}
            className="nm-wire"
            x1={NUT_X + (i + 1) * CELL}
            y1={boardTop}
            x2={NUT_X + (i + 1) * CELL}
            y2={boardBottom}
          />
        ))}
        <line className="nm-nut" x1={NUT_X} y1={boardTop} x2={NUT_X} y2={boardBottom} />

        {Array.from({ length: TOP_FRET }, (_, i) => {
          const fret = i + 1;
          const dots = inlayAt(fret);
          if (dots === 0) return null;
          const mid = (boardTop + boardBottom) / 2;
          return dots === 2 ? (
            <g key={`i${fret}`} className="nm-inlay">
              <circle cx={fretCentre(fret)} cy={mid - inlayGap} r={2.6} />
              <circle cx={fretCentre(fret)} cy={mid + inlayGap} r={2.6} />
            </g>
          ) : (
            <circle key={`i${fret}`} className="nm-inlay" cx={fretCentre(fret)} cy={mid} r={2.6} />
          );
        })}

        {/* Gauge, drawn at the real order: which string this is has a thickness
            before it has a name, which is how it is picked out on the guitar. */}
        {strings.map((stringPosition) => (
          <line
            key={`s${stringPosition}`}
            className={clsx('nm-string', stringPosition === litString && 'is-lit')}
            x1={2}
            y1={rowY(stringPosition)}
            x2={NECK_VIEW_W - 3}
            y2={rowY(stringPosition)}
            style={{ strokeWidth: 0.8 + (stringPosition - 1) * (single ? 0.5 : 0.28) }}
          />
        ))}

        {/* The wear. Nothing is drawn where nothing has been asked, which is why
            an untouched neck is a picture of an untouched neck. */}
        {cells.map(({ key, stringPosition, fret, standing }) => (
          <rect
            key={key}
            className={clsx('nm-wear', `is-${standing}`)}
            x={fretLeft(fret) + markInset}
            y={rowY(stringPosition) - markH / 2}
            width={Math.max(4, fretWidth(fret) - markInset * 2)}
            height={markH}
            rx={3}
          />
        ))}

        {marks?.map(({ stringPosition, fret }) => (
          <g key={`m${stringPosition}-${fret}`} className="nm-mark">
            <rect
              x={fretLeft(fret) + markInset}
              y={rowY(stringPosition) - markH / 2}
              width={Math.max(4, fretWidth(fret) - markInset * 2)}
              height={markH}
              rx={3}
            />
            {nameMarks && (
              <text
                className="nm-mark-name"
                x={fretCentre(fret)}
                y={rowY(stringPosition) + (single ? 7 : 4)}
                textAnchor="middle"
              >
                {sharpName(noteAtFret(openMidiOf(stringPosition), fret))}
              </text>
            )}
          </g>
        ))}

        {NUMBERED.map((fret) => (
          <text key={`n${fret}`} className="nm-number" x={fretCentre(fret)} y={numberY} textAnchor="middle">
            {fret}
          </text>
        ))}

        {/* The open strings, named. The same thing the note circle does: the
            tuning states what it is rather than being described. */}
        {strings.map((stringPosition) => (
          <text
            key={`l${stringPosition}`}
            className={clsx('nm-open', stringPosition === litString && 'is-lit')}
            x={OPEN_X}
            y={rowY(stringPosition) + (single ? 6 : 4)}
            textAnchor="middle"
          >
            {STRING_LABEL.get(stringPosition)}
          </text>
        ))}
      </svg>
    </div>
  );
}
