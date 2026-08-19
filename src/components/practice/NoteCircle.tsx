// The note circle and a string, drawn as one object.
//
// THESIS. B1-504 makes six claims: twelve notes in a loop, one step is a
// semitone, one fret is a semitone, two semitones are a tone, a lap is an
// octave, and a sharp and the flat above it are one note with two names. Five
// of those are relationships between two things, and a relationship written in
// a sentence has to be believed, while a relationship drawn as two figures that
// move together is just watched. So there is no explanatory copy on this
// surface at all. The circle and the string are the same twelve steps in two
// shapes, they share one selection, and every claim above is something the
// player makes happen rather than something they read.
//
// STORY. Tap a note. The tap sets the far end of the interval and the near end
// takes up where you were, so tapping walks you round the loop and the arc
// between the two picks is Justin's own exercise, drawn: pick two notes, count
// the semitones. The count is drawn three ways at once — the arc is cut into
// one segment per semitone so it can be counted, the string shows the same
// number of frets, and the pips in the middle pair off, which is what a tone
// is. Tap the note you are already on and the walk goes all the way round: a
// full ring, twelve frets, the same letter at both ends of the string, and the
// only place the word octave appears.
//
// WHAT IS NOT HERE. No score, no percentage, no verdict. src/data/skills.ts
// files note names as `known` — knowledge, not motor skill — and the app does
// not grade things it has not measured. This is a thing to play with.
//
// THE STRING. Standard tuning, and it says so by naming its six open strings.
// The window always runs from the anchor's own fret to twelve frets above it,
// which is why the octave is drawn at the right-hand end whatever note is
// picked, rather than only when the anchor happens to be the open string.
// Frets are spaced evenly, which no real neck is: what is being counted here is
// the interval, and an interval is the one thing a real neck draws unevenly.

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'framer-motion';
import { DEFAULT_TUNING_ID, getTuning, type TuningString } from '../../audio/tuning';
import {
  CIRCLE_ORDER,
  CIRCLE_START,
  SEMITONES_IN_OCTAVE,
  flatName,
  fretOf,
  inlayAt,
  isSharp,
  noteAtFret,
  pitchClass,
  sharpName,
  stepsRound,
  toneReading,
  type PitchClass,
} from '../../lib/noteCircle';
import './noteCircle.css';

// Fixed engraving, like the chord boxes: the numbers are written out rather
// than derived from a scale factor, because a half pixel of drift shows on a
// figure this regular. Only the CSS ever picks a size.
const RING_VIEW = 300;
const RING_MID = RING_VIEW / 2;
const RING_R = 96;
/** Where the tap targets are centred: over the dot and its name, not just the dot. */
const RING_HIT_R = 124;
const DEGREES_PER_STEP = 360 / SEMITONES_IN_OCTAVE;
/** Half the gap between two arc segments, in degrees. What makes them countable. */
const SEGMENT_GAP = 5;

const NECK_VIEW_W = 534;
const NECK_VIEW_H = 132;
const NECK_PAD = 20;
const NECK_CELL = 38;
const NECK_TOP = 22;
const NECK_BOTTOM = 78;
const STRING_Y = 40;
const INLAY_Y = 62;
const NAME_Y = 100;
const FRET_Y = 119;
/** Thirteen positions, because the thirteenth is the first one again. */
const CELLS = SEMITONES_IN_OCTAVE + 1;

const STANDARD = getTuning(DEFAULT_TUNING_ID);
/** Thickest first, which is how the strings are stacked on the instrument. */
const STRINGS: readonly TuningString[] = [...STANDARD.strings].sort((a, b) => b.position - a.position);

function polar(step: number, radius: number): { x: number; y: number } {
  const angle = ((step * DEGREES_PER_STEP - 90) * Math.PI) / 180;
  return { x: RING_MID + radius * Math.cos(angle), y: RING_MID + radius * Math.sin(angle) };
}

/** One semitone of the ring, drawn short of both its neighbours. */
function segmentPath(step: number): string {
  const start = polar(step + SEGMENT_GAP / DEGREES_PER_STEP, RING_R);
  const end = polar(step + 1 - SEGMENT_GAP / DEGREES_PER_STEP, RING_R);
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} A${RING_R} ${RING_R} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const cellX = (cell: number) => NECK_PAD + cell * NECK_CELL + NECK_CELL / 2;
const wireX = (cell: number) => NECK_PAD + cell * NECK_CELL;

/** Where a pitch class sits on the clock face: A is nought, G# is eleven. */
const slotOf = (pc: PitchClass) => pitchClass(pc - CIRCLE_START);

/** Which way an arrow key moves: forward, back, or not at all. */
function arrowDelta(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowUp') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return -1;
  return 0;
}

/** The semitones split into the pairs that make tones, with any odd one left over. */
function pairUp(steps: number): number[] {
  const pairs: number[] = [];
  for (let i = 0; i < steps; i += 2) pairs.push(Math.min(2, steps - i));
  return pairs;
}

export function NoteCircle() {
  const reduceMotion = useReducedMotion();
  const [stringPosition, setStringPosition] = useState(6);
  // A to C. Three semitones, and the arc runs straight through the one place
  // the alphabet has no room for a sharp, so the first thing the surface shows
  // is the fact that costs beginners the most.
  const [from, setFrom] = useState<PitchClass>(9);
  const [to, setTo] = useState<PitchClass>(0);

  const noteRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const fretRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const stringRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const string = STRINGS.find((s) => s.position === stringPosition) ?? STRINGS[0];
  const steps = stepsRound(from, to);
  const fromSlot = slotOf(from);
  const anchorFret = fretOf(string.midi, from);

  // The tap sets where you are going and the note you were on becomes where you
  // came from. One gesture, no modes, and never a state with no interval in it.
  const pick = (next: PitchClass) => {
    setFrom(to);
    setTo(next);
  };

  // One arrow press is one semitone, which is the surface's first claim made
  // available to a keyboard. Focus follows the pick into whichever figure the
  // press came from, so the two groups never fight over it.
  const onRingKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    const next = pitchClass(to + delta);
    pick(next);
    noteRefs.current[next]?.focus();
  };

  const onNeckKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    const next = pitchClass(to + delta);
    pick(next);
    fretRefs.current[stepsRound(to, next)]?.focus();
  };

  const onStringKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    // The row reads thickest first, so moving right in the row is moving down
    // a string number.
    const next = Math.min(6, Math.max(1, stringPosition - delta));
    setStringPosition(next);
    stringRefs.current[next]?.focus();
  };

  // Left to the compiler rather than hand-memoised: thirteen lookups a render.
  const cells = Array.from({ length: CELLS }, (_, cell) => ({
    cell,
    pc: noteAtFret(string.midi, anchorFret + cell),
    fret: anchorFret + cell,
  }));

  const segmentDelay = (index: number) => (reduceMotion ? 0 : index * 0.032);
  const glide = reduceMotion
    ? { duration: 0 }
    : { duration: 0.34, ease: [0.16, 1, 0.3, 1] as const };

  const target = polar(slotOf(to), RING_R);

  return (
    <div className="note-circle">
      {/* The interval in words, for anyone who cannot see either figure. It is
          the only place on this surface where the relationship is said rather
          than drawn, and it is never painted. */}
      <p className="sr-only" aria-live="polite">
        {`${sharpName(from)} to ${sharpName(to)}, ${steps} ${steps === 1 ? 'semitone' : 'semitones'}, ${toneReading(steps)}`}
      </p>

      <div className="nc-stage">
      <div className="nc-ring-wrap">
        <svg className="nc-ring" viewBox={`0 0 ${RING_VIEW} ${RING_VIEW}`} aria-hidden="true" focusable="false">
          <circle className="nc-ring-track" cx={RING_MID} cy={RING_MID} r={RING_R} />

          {Array.from({ length: steps }, (_, i) => (
            <motion.path
              key={`${fromSlot}-${steps}-${i}`}
              className="nc-ring-step"
              d={segmentPath(fromSlot + i)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, delay: segmentDelay(i) }}
            />
          ))}

          {CIRCLE_ORDER.map((pc, slot) => {
            const at = polar(slot, RING_R);
            const sharp = isSharp(pc);
            return (
              <circle
                key={pc}
                className={clsx('nc-note-dot', sharp && 'is-sharp', pc === from && 'is-from', pc === to && 'is-to')}
                cx={at.x}
                cy={at.y}
                r={sharp ? 3.2 : 5.2}
              />
            );
          })}

          {/* The anchor is an open ring and the target is filled, the same two
              marks the string uses, so a glance at either figure finds the same
              two ends. */}
          <circle className="nc-anchor" cx={polar(fromSlot, RING_R).x} cy={polar(fromSlot, RING_R).y} r={9} />
          <motion.circle
            className="nc-target"
            cx={target.x}
            cy={target.y}
            r={7.4}
            animate={{ cx: target.x, cy: target.y }}
            initial={false}
            transition={glide}
          />
        </svg>

        {/* Real buttons over the drawing, the way the headstock does it: the
            targets have to be focusable, named and big enough for a thumb, and
            an SVG <g> is none of those without inventing semantics for it. */}
        <div
          className="nc-ring-hits"
          role="radiogroup"
          aria-label="The twelve notes"
          onKeyDown={onRingKey}
        >
          {CIRCLE_ORDER.map((pc, slot) => {
            const at = polar(slot, RING_HIT_R);
            const flat = flatName(pc);
            return (
              <button
                key={pc}
                type="button"
                role="radio"
                aria-checked={pc === to}
                tabIndex={pc === to ? 0 : -1}
                ref={(el) => { noteRefs.current[pc] = el; }}
                className={clsx('nc-note', isSharp(pc) && 'is-sharp', pc === from && 'is-from', pc === to && 'is-to')}
                style={{ '--nc-x': `${(at.x / RING_VIEW) * 100}%`, '--nc-y': `${(at.y / RING_VIEW) * 100}%` } as CSSProperties}
                aria-label={flat ? `${sharpName(pc)}, also ${flat}` : sharpName(pc)}
                onClick={() => pick(pc)}
              >
                {/* Both names, always, on the five notes that have two. The
                    equivalence is a permanent fact about the circle, so it is
                    drawn as one label in two lines rather than revealed by an
                    interaction nobody would think to try. */}
                <span className="nc-note-name" aria-hidden="true">{sharpName(pc)}</span>
                {flat && <span className="nc-note-alt" aria-hidden="true">{flat}</span>}
              </button>
            );
          })}
        </div>

        {/* The count, where a clock keeps its hands. */}
        <div className="nc-count" aria-hidden="true">
          <span className="nc-count-value">{steps}</span>
          <span className="nc-count-unit">{steps === 1 ? 'semitone' : 'semitones'}</span>
          <span className="nc-pips">
            {pairUp(steps).map((size, pairIndex) => (
              <span className="nc-pip-pair" key={pairIndex}>
                {Array.from({ length: size }, (_, i) => {
                  const index = pairIndex * 2 + i;
                  return (
                    <motion.i
                      className="nc-pip"
                      key={`${fromSlot}-${steps}-${index}`}
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2, delay: segmentDelay(index) }}
                    />
                  );
                })}
              </span>
            ))}
          </span>
          <span className="nc-tones">{toneReading(steps)}</span>
        </div>
      </div>

      <div className="nc-neck-wrap">
        <div className="nc-strings" role="radiogroup" aria-label="String, standard tuning" onKeyDown={onStringKey}>
          {STRINGS.map((s) => (
            <button
              key={s.position}
              type="button"
              role="radio"
              aria-checked={s.position === stringPosition}
              tabIndex={s.position === stringPosition ? 0 : -1}
              ref={(el) => { stringRefs.current[s.position] = el; }}
              className={clsx('nc-string', s.position === stringPosition && 'is-on')}
              aria-label={s.label}
              onClick={() => setStringPosition(s.position)}
            >
              {/* Gauge, not a number: the sixth string is the fat one, and that
                  is how a player picks it out without reading anything. */}
              <svg viewBox="0 0 34 8" aria-hidden="true" focusable="false">
                <line x1="1" y1="4" x2="33" y2="4" strokeWidth={0.7 + (s.position - 1) * 0.7} />
              </svg>
              <span aria-hidden="true">{s.name}</span>
            </button>
          ))}
        </div>

        <div className="nc-neck">
          <svg viewBox={`0 0 ${NECK_VIEW_W} ${NECK_VIEW_H}`} aria-hidden="true" focusable="false">
            <rect
              className="nc-fretboard"
              x={anchorFret === 0 ? wireX(0) : 0}
              y={NECK_TOP}
              width={(anchorFret === 0 ? NECK_VIEW_W - wireX(0) : NECK_VIEW_W)}
              height={NECK_BOTTOM - NECK_TOP}
            />

            {Array.from({ length: CELLS }, (_, cell) => (
              <line
                key={`w${cell}`}
                className="nc-fret-wire"
                x1={wireX(cell + 1)}
                y1={NECK_TOP}
                x2={wireX(cell + 1)}
                y2={NECK_BOTTOM}
              />
            ))}

            {anchorFret === 0 ? (
              <line className="nc-nut" x1={wireX(0)} y1={NECK_TOP} x2={wireX(0)} y2={NECK_BOTTOM} />
            ) : (
              <line className="nc-fret-wire" x1={wireX(0)} y1={NECK_TOP} x2={wireX(0)} y2={NECK_BOTTOM} />
            )}

            {cells.map(({ cell, fret }) => {
              const dots = inlayAt(fret);
              if (dots === 0 || cell === 0) return null;
              return dots === 2 ? (
                <g key={`i${cell}`} className="nc-inlay">
                  <circle cx={cellX(cell) - 7} cy={INLAY_Y} r={2.6} />
                  <circle cx={cellX(cell) + 7} cy={INLAY_Y} r={2.6} />
                </g>
              ) : (
                <circle key={`i${cell}`} className="nc-inlay" cx={cellX(cell)} cy={INLAY_Y} r={2.6} />
              );
            })}

            {/* The drawn string thickens with the one that is chosen, so the
                picker above and the figure below are visibly the same object. */}
            <line
              className="nc-string-line"
              x1={0}
              y1={STRING_Y}
              x2={NECK_VIEW_W}
              y2={STRING_Y}
              style={{ strokeWidth: 1 + (string.position - 1) * 0.42 }}
            />

            {/* The same walk again, one segment per fret, timed with the ring's
                so the two figures step together. That simultaneity is the whole
                argument that they are one object. */}
            {Array.from({ length: steps }, (_, i) => (
              <motion.line
                key={`s${anchorFret}-${steps}-${i}`}
                className="nc-neck-step"
                x1={cellX(i) + 5}
                y1={STRING_Y}
                x2={cellX(i + 1) - 5}
                y2={STRING_Y}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, delay: segmentDelay(i) }}
              />
            ))}

            {cells.map(({ cell, pc }) => (
              <text
                key={`n${cell}`}
                className={clsx('nc-fret-name', isSharp(pc) && 'is-sharp', cell === 0 && 'is-from', cell === steps && 'is-to')}
                x={cellX(cell)}
                y={NAME_Y}
                textAnchor="middle"
              >
                {sharpName(pc)}
              </text>
            ))}

            {/* Only the two frets the player is being asked about. Thirteen fret
                numbers is a row of noise, and the dots already say where on the
                neck this is. */}
            {[0, steps].map((cell) => (
              <text key={`f${cell}`} className="nc-fret-number" x={cellX(cell)} y={FRET_Y} textAnchor="middle">
                {cells[cell].fret}
              </text>
            ))}

            <circle className="nc-anchor" cx={cellX(0)} cy={STRING_Y} r={9} />
            <motion.circle
              className="nc-target"
              cx={cellX(steps)}
              cy={STRING_Y}
              r={6.6}
              animate={{ cx: cellX(steps) }}
              initial={false}
              transition={glide}
            />
          </svg>

          <div className="nc-fret-hits" role="radiogroup" aria-label="Frets" onKeyDown={onNeckKey}>
            {cells.map(({ cell, pc, fret }) => (
              <button
                key={cell}
                type="button"
                role="radio"
                aria-checked={cell === steps}
                tabIndex={cell === steps ? 0 : -1}
                ref={(el) => { fretRefs.current[cell] = el; }}
                className="nc-fret-hit"
                style={{ '--nc-x': `${(wireX(cell) / NECK_VIEW_W) * 100}%` } as CSSProperties}
                aria-label={`Fret ${fret}, ${sharpName(pc)}`}
                onClick={() => pick(pc)}
              />
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
