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
// THREE LEVELS, NOT TWO. A position the drill lit and the player simply played
// is drawn, and drawn as the different thing it is: a hairline outline rather
// than light in the wood. Seeing where a note lives is worth recording and is
// not worth claiming as knowing where it lives, and the two must be tellable
// apart at a glance or the record stops meaning anything.
//
// ONE DRAWING, ANY STRETCH OF NECK. The same figure draws all twelve frets,
// which is the record, and four of them, which is a rung being drilled. The
// cells fatten to fill the same canvas rather than the canvas shrinking
// (./neckGeometry.ts), so both are the same drawing at two zooms rather than two
// drawings that would drift apart the day either changed.
//
// WHAT IT IS NOT A CLAIM ABOUT. A microphone hears a pitch, and a pitch does not
// carry the string it came off. Every mark here means the prompt named this
// position and the note that position makes came back — never "your finger was
// here". src/lib/noteFinder.ts holds that argument in full.

import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import {
  QUICK_MS,
  TOP_FRET,
  openMidiOf,
  positionKey,
  positionStanding,
  timesShown,
  type NoteMap,
  type PositionStanding,
} from '../../lib/noteFinder';
import { inlayAt, noteAtFret, sharpName } from '../../lib/noteCircle';
import { DEFAULT_TUNING_ID, getTuning } from '../../audio/tuning';
import { LABEL_X, STRING_STACK, VIEW_W, neckLayout, neckWindow } from './neckGeometry';
import './neckMap.css';

/** Fret numbers worth writing when the whole neck is on show. The dots say the rest. */
const LANDMARKS = [3, 5, 7, 9, 12];
/** A window this short can afford a number under every fret, and a beginner wants one. */
const NUMBER_EVERY_UP_TO = 8;

const STANDARD = getTuning(DEFAULT_TUNING_ID);
const STRING_LABEL = new Map(STANDARD.strings.map((s) => [s.position, s.name]));

/**
 * What a mark on the board is saying.
 *
 * - `show` is an instruction: put a finger here, now. Filled, because it is the
 *   one mark the player is meant to act on rather than read.
 * - `found` is this run's recall, called out over the wear underneath.
 * - `shown` is this run's placement against a lit answer, which is a quieter
 *   claim and is drawn as one.
 * - `miss` is what arrived instead, drawn where it actually is, so the distance
 *   between the two is a distance rather than a sentence.
 */
export type NeckMarkKind = 'show' | 'found' | 'shown' | 'miss';

export interface NeckMark {
  stringPosition: number;
  fret: number;
  kind: NeckMarkKind;
  /** Write the note's name on it. Per mark, because one drawing can hold both. */
  name?: boolean;
}

interface Props {
  map: NoteMap;
  /** Lowest fret to draw. Zero, the nut, by default. */
  from?: number;
  /** Highest fret to draw. */
  to?: number;
  marks?: readonly NeckMark[];
  /** Strings to draw heavier than the rest: the ones a prompt or a rung is about. */
  litStrings?: readonly number[];
  className?: string;
}

interface Tally {
  found: number;
  quick: number;
  shown: number;
  total: number;
}

function tally(map: NoteMap, frets: readonly number[]): Tally {
  const counts: Tally = { found: 0, quick: 0, shown: 0, total: 0 };
  for (const stringPosition of STRING_STACK) {
    for (const fret of frets) {
      counts.total += 1;
      const find = map[positionKey(stringPosition, fret)];
      const standing = positionStanding(find);
      if (standing !== 'unasked') {
        counts.found += 1;
        if (standing === 'quick') counts.quick += 1;
        continue;
      }
      if (timesShown(find) > 0) counts.shown += 1;
    }
  }
  return counts;
}

function inWords(counts: Tally, seconds: number): string {
  if (counts.found === 0 && counts.shown === 0) {
    return 'Nothing has been asked for on this neck yet.';
  }
  const recalled = `${counts.found} of ${counts.total} positions found from memory, ${counts.quick} of them inside ${seconds} seconds.`;
  if (counts.shown === 0) return recalled;
  return `${recalled} ${counts.shown} more have been shown but not yet recalled.`;
}

export function NeckMap({
  map,
  from = 0,
  to = TOP_FRET,
  marks,
  litStrings,
  className,
}: Props) {
  const window = useMemo(() => neckWindow(from, to), [from, to]);
  const layout = useMemo(() => neckLayout(window, STRING_STACK.length), [window]);
  const { boardTop, boardBottom, markH, type } = layout;
  const rowY = (stringPosition: number) => layout.rowY(STRING_STACK.indexOf(stringPosition));
  const inset = Math.max(3, window.cell * 0.09);
  // A short window numbers every fret it draws, the open cell included: the one
  // position that sits off the board is the one a beginner is least sure of, and
  // a nought under it settles it without a word.
  const numbered = useMemo(
    () =>
      window.frets.length <= NUMBER_EVERY_UP_TO
        ? window.frets
        : window.frets.filter((fret) => LANDMARKS.includes(fret)),
    [window],
  );

  const cells = useMemo(() => {
    const out: Array<{
      key: string;
      stringPosition: number;
      fret: number;
      standing: PositionStanding;
    }> = [];
    for (const stringPosition of STRING_STACK) {
      for (const fret of window.frets) {
        const key = positionKey(stringPosition, fret);
        const find = map[key];
        const standing = positionStanding(find);
        if (standing === 'unasked' && timesShown(find) === 0) continue;
        out.push({ key, stringPosition, fret, standing });
      }
    }
    return out;
  }, [map, window]);

  const counts = useMemo(() => tally(map, window.frets), [map, window]);
  const isLit = (stringPosition: number) => litStrings?.includes(stringPosition) === true;

  return (
    <div
      className={clsx('neck-map', className)}
      style={{ '--nm-type': `${type}px` } as CSSProperties}
    >
      {/* The figure in words. Silent about the frets nothing has been asked
          about, exactly as the drawing is. */}
      <p className="sr-only">{inWords(counts, Math.round(QUICK_MS / 1000))}</p>

      <svg viewBox={`0 0 ${VIEW_W} ${layout.viewH}`} aria-hidden="true" focusable="false">
        <rect
          className="nm-board"
          x={window.nutX ?? window.left(window.from)}
          y={boardTop}
          width={VIEW_W - (window.nutX ?? window.left(window.from)) - 3}
          height={boardBottom - boardTop}
          rx={2}
        />

        {/* One wire on the far side of every cell. The open cell's far side is
            the nut, which is drawn as a nut. */}
        {window.frets
          .filter((fret) => window.nutX === null || fret > 0)
          .map((fret) => {
            const x = window.left(fret) + window.width(fret);
            return <line key={`w${fret}`} className="nm-wire" x1={x} y1={boardTop} x2={x} y2={boardBottom} />;
          })}
        {window.nutX !== null ? (
          <line className="nm-nut" x1={window.nutX} y1={boardTop} x2={window.nutX} y2={boardBottom} />
        ) : (
          <line
            className="nm-wire"
            x1={window.left(window.from)}
            y1={boardTop}
            x2={window.left(window.from)}
            y2={boardBottom}
          />
        )}

        {window.frets.map((fret) => {
          const dots = inlayAt(fret);
          if (dots === 0) return null;
          const mid = (boardTop + boardBottom) / 2;
          const gap = window.row * 0.85;
          const r = Math.max(2.6, window.cell * 0.07);
          return dots === 2 ? (
            <g key={`i${fret}`} className="nm-inlay">
              <circle cx={window.centre(fret)} cy={mid - gap} r={r} />
              <circle cx={window.centre(fret)} cy={mid + gap} r={r} />
            </g>
          ) : (
            <circle key={`i${fret}`} className="nm-inlay" cx={window.centre(fret)} cy={mid} r={r} />
          );
        })}

        {/* Gauge, drawn at the real order: which string this is has a thickness
            before it has a name, which is how it is picked out on the guitar. */}
        {STRING_STACK.map((stringPosition) => (
          <line
            key={`s${stringPosition}`}
            className={clsx('nm-string', isLit(stringPosition) && 'is-lit')}
            x1={window.left(window.from)}
            y1={rowY(stringPosition)}
            x2={VIEW_W - 3}
            y2={rowY(stringPosition)}
            style={{ strokeWidth: 0.8 + (stringPosition - 1) * 0.28 }}
          />
        ))}

        {/* The wear. Nothing is drawn where nothing has been asked, which is why
            an untouched neck is a picture of an untouched neck. */}
        {cells.map(({ key, stringPosition, fret, standing }) => (
          <rect
            key={key}
            className={standing === 'unasked' ? 'nm-seen' : clsx('nm-wear', `is-${standing}`)}
            x={window.left(fret) + inset}
            y={rowY(stringPosition) - markH / 2}
            width={Math.max(4, window.width(fret) - inset * 2)}
            height={markH}
            rx={3}
          />
        ))}

        {marks?.map(({ stringPosition, fret, kind, name }) => (
          <g key={`m${kind}-${stringPosition}-${fret}`} className={clsx('nm-mark', `is-${kind}`)}>
            <rect
              x={window.left(fret) + inset}
              y={rowY(stringPosition) - markH / 2}
              width={Math.max(4, window.width(fret) - inset * 2)}
              height={markH}
              rx={3}
            />
            {name === true && (
              <text
                className="nm-mark-name"
                x={window.centre(fret)}
                y={rowY(stringPosition) + markH * 0.28}
                textAnchor="middle"
              >
                {sharpName(noteAtFret(openMidiOf(stringPosition), fret))}
              </text>
            )}
          </g>
        ))}

        {numbered.map((fret) => (
          <text
            key={`n${fret}`}
            className="nm-number"
            x={window.centre(fret)}
            y={layout.numberY}
            textAnchor="middle"
          >
            {fret}
          </text>
        ))}

        {/* The open strings, named. The same thing the note circle does: the
            tuning states what it is rather than being described. */}
        {STRING_STACK.map((stringPosition) => (
          <text
            key={`l${stringPosition}`}
            className={clsx('nm-open', isLit(stringPosition) && 'is-lit')}
            x={LABEL_X}
            y={rowY(stringPosition) + type * 0.34}
            textAnchor="middle"
          >
            {STRING_LABEL.get(stringPosition)}
          </text>
        ))}
      </svg>
    </div>
  );
}
