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
// WHAT IS NOT HERE, AND WHAT NOW IS. This file used to say: no score, no
// percentage, no verdict, because src/data/skills.ts filed note names as
// knowledge and the app does not grade things it has not measured. The first
// half of that still stands and always will. What changed is the second: the
// note finder measures it now, by calling a note and hearing it played
// (src/lib/noteFinder.ts), so there is something true to draw.
//
// What is drawn is wear, not a verdict. The inner band on the ring is the whole
// neck folded by note: one tick per place that note lives below the twelfth
// fret, each tick standing for itself, so a glance says how much of C is
// actually under the hand rather than giving C a mark out of ten. The board
// carries the same fact where a fret is a place rather than a note, for the
// twelve-fret window it happens to be showing — this string is an interval
// ruler and not a map, and the ruler is honest about what it has room for. The
// map of the whole instrument belongs to the drill that filled it in. There is still no score, no percentage and no
// grade, and a position nothing has ever been asked about is drawn as nothing at
// all, because an unasked fret is not a failure. On a neck nobody has drilled
// this whole layer is invisible and the surface is exactly what it was: a thing
// to play with.
//
// THE STRING. Standard tuning, and it says so by naming its six open strings.
// The window always runs from the anchor's own fret to twelve frets above it,
// which is why the octave is drawn at the right-hand end whatever note is
// picked, rather than only when the anchor happens to be the open string.
// Frets are spaced evenly, which no real neck is: what is being counted here is
// the interval, and an interval is the one thing a real neck draws unevenly.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'framer-motion';
import { DEFAULT_TUNING_ID, getTuning, type TuningString } from '../../audio/tuning';
import { useNoteMap } from '../../store';
import { positionKey, positionStanding, positionsOf } from '../../lib/noteFinder';
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

/**
 * Where the record sits: inside the walk, outside the count.
 *
 * Its own radius rather than a treatment on the arc that is already there,
 * because the two say different things on different clocks. The outer arc is the
 * interval being made right now and it changes on every tap; this is months of
 * practice and it changes about once a session.
 */
const WEAR_R = 78;
/** Degrees left clear each side of a note's band, so twelve bands stay twelve. */
const WEAR_SLOT_GAP = 3;
/** And between the ticks inside one band, so the places can be counted. */
const WEAR_TICK_GAP = 0.9;

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

/**
 * One tick of the record: one place a note lives on the neck, at its own
 * standing.
 *
 * Drawn as arc segments inside the note it belongs to, one per position, so the
 * band is countable the way the walk above it is. Six ticks under C is the six
 * places C sits below the twelfth fret, and how many of them are lit is how much
 * of C is actually under the hand.
 */
function wearPath(slot: number, index: number, of: number): string {
  const span = (DEGREES_PER_STEP - WEAR_SLOT_GAP * 2) / of;
  const from = slot * DEGREES_PER_STEP + WEAR_SLOT_GAP + index * span + WEAR_TICK_GAP / 2;
  const to = from + span - WEAR_TICK_GAP;
  const a = polar(from / DEGREES_PER_STEP, WEAR_R);
  const b = polar(to / DEGREES_PER_STEP, WEAR_R);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} A${WEAR_R} ${WEAR_R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
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

/** How long one demonstrated tap takes: the ring closing, then the pick. */
const DEMO_TAP_MS = 900;
/** The pause before the first one, so the figure is read before it moves. */
const DEMO_LEAD_MS = 1100;
/** And between the two, so the second reads as the same move rather than a bounce. */
const DEMO_GAP_MS = 1300;
/**
 * The two notes the demonstration taps.
 *
 * E then G, from the opening A to C. Both land on naturals with no sharp
 * between them and neither is the note already selected, so what moves is
 * unambiguous: the anchor takes up where the target was, and the walk is a
 * different length the second time.
 */
const DEMO_TAPS: readonly PitchClass[] = [4, 7];

/** Where the last look at this surface is remembered. */
const SEEN_KEY = 'daily-fret-note-circle-seen';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'yes';
  } catch {
    // Storage disabled. The honest answer is no: the demonstration plays once
    // for this page load and nothing is lost.
    return false;
  }
}

function rememberSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'yes');
  } catch {
    /* storage disabled; the demonstration simply plays again next time */
  }
}

/**
 * The tap gesture, performed once by the figure itself.
 *
 * Returns the note the mark is currently closing on, or null when nothing is
 * being shown, and the way to call the whole thing off. Under reduced motion it
 * never starts: a jump with no travel in it demonstrates nothing, and the
 * mechanic is discoverable by tapping anything.
 */
function useDemonstration(reduceMotion: boolean, pick: (pc: PitchClass) => void) {
  const [at, setAt] = useState<PitchClass | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopped = useRef(false);

  const stop = useCallback(() => {
    stopped.current = true;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    setAt(null);
    rememberSeen();
  }, []);

  useEffect(() => {
    if (reduceMotion || alreadySeen()) return;
    const queue = (ms: number, run: () => void) => {
      timers.current.push(
        setTimeout(() => {
          if (!stopped.current) run();
        }, ms),
      );
    };
    DEMO_TAPS.forEach((pc, i) => {
      const opens = DEMO_LEAD_MS + i * (DEMO_TAP_MS + DEMO_GAP_MS);
      queue(opens, () => setAt(pc));
      queue(opens + DEMO_TAP_MS, () => {
        setAt(null);
        pick(pc);
      });
    });
    queue(DEMO_LEAD_MS + DEMO_TAPS.length * (DEMO_TAP_MS + DEMO_GAP_MS), rememberSeen);
    const running = timers.current;
    return () => {
      for (const t of running) clearTimeout(t);
      timers.current = [];
    };
    // Mount only. `pick` is rebuilt every render and re-running this on each one
    // would restart the demonstration under the player's hands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { at, stop };
}

/** The semitones split into the pairs that make tones, with any odd one left over. */
function pairUp(steps: number): number[] {
  const pairs: number[] = [];
  for (let i = 0; i < steps; i += 2) pairs.push(Math.min(2, steps - i));
  return pairs;
}

export function NoteCircle() {
  const reduceMotion = useReducedMotion();
  const noteMap = useNoteMap();
  const [stringPosition, setStringPosition] = useState(6);
  // One piece of state, not two. The pair is a single fact — this surface is
  // never in a condition with no interval in it — and holding it as one is also
  // what lets `pick` be written as a function of the interval it is replacing
  // rather than of whatever the last render closed over. The demonstration below
  // is mounted once and would otherwise have carried a stale near end into its
  // second tap.
  //
  // A to C. Three semitones, and the arc runs straight through the one place the
  // alphabet has no room for a sharp, so the first thing the surface shows is
  // the fact that costs beginners the most.
  const [{ from, to }, setInterval] = useState<{ from: PitchClass; to: PitchClass }>({
    from: 9,
    to: 0,
  });

  const noteRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const fretRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const stringRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const string = STRINGS.find((s) => s.position === stringPosition) ?? STRINGS[0];
  const steps = stepsRound(from, to);
  // Every place each of the twelve notes lives on the neck, at the standing the
  // note finder has left it. Left to the compiler rather than hand-memoised:
  // twelve lookups of at most seven positions, once a render.
  const record = CIRCLE_ORDER.map((pc) =>
    positionsOf(pc).map((p) => positionStanding(noteMap[positionKey(p.stringPosition, p.fret)])),
  );
  const anythingRecorded = record.some((ticks) => ticks.some((t) => t !== 'unasked'));
  const fromSlot = slotOf(from);
  const anchorFret = fretOf(string.midi, from);

  // The tap sets where you are going and the note you were on becomes where you
  // came from. One gesture, no modes, and never a state with no interval in it.
  const pick = useCallback((next: PitchClass) => {
    setInterval((current) => ({ from: current.to, to: next }));
  }, []);

  // The one gesture on this surface nothing advertises, shown once by doing it.
  //
  // "Tap a note and the note you were on becomes where you came from" is the
  // whole mechanic and there is no shape on screen that implies it, so the
  // figure performs it: a ring closes on a note, the pick happens for real, and
  // the walk steps out. Twice, on two different notes, so the second one is
  // recognisably the same move rather than a one-off animation.
  //
  // It never runs again once it has been seen or once the player has tapped
  // anything, because a demonstration that replays after the behaviour is
  // learned has stopped demonstrating and become decoration.
  const demo = useDemonstration(reduceMotion === true, pick);

  // One arrow press is one semitone, which is the surface's first claim made
  // available to a keyboard. Focus follows the pick into whichever figure the
  // press came from, so the two groups never fight over it.
  const onRingKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    demo.stop();
    const next = pitchClass(to + delta);
    pick(next);
    noteRefs.current[next]?.focus();
  };

  const onNeckKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    demo.stop();
    const next = pitchClass(to + delta);
    pick(next);
    fretRefs.current[stepsRound(to, next)]?.focus();
  };

  const onStringKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(e.key);
    if (!delta) return;
    e.preventDefault();
    demo.stop();
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

  // The one authored moment: the walk steps out, one semitone at a time, on the
  // ring and along the string at the same instant. That simultaneity is the
  // whole argument that the two figures are one object.
  //
  // Reduced motion suppresses the entrance by refusing an initial state, not by
  // giving the entrance a zero duration. `transition: { duration: 0 }` was the
  // first attempt and it left every segment and every pip stranded at the
  // initial opacity of nought: measured under prefers-reduced-motion, the arc,
  // the frets and the count's pips were all invisible and stayed that way. The
  // reading a reduced-motion player is owed is the finished drawing, arrived at
  // without a transition, which is what `initial={false}` actually produces.
  const segmentDelay = (index: number) => index * 0.032;
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

      {/* The record in words, and silent while there is none. Not live: it does
          not change while anyone is on this screen. */}
      {anythingRecorded && (
        <p className="sr-only">
          {record
            .map((ticks, slot) => {
              const found = ticks.filter((t) => t !== 'unasked').length;
              if (!found) return null;
              const quick = ticks.filter((t) => t === 'quick').length;
              return `${sharpName(CIRCLE_ORDER[slot])}: found in ${found} of ${ticks.length} places, ${quick} of them quickly.`;
            })
            .filter((line): line is string => line !== null)
            .join(' ')}
        </p>
      )}

      <div className="nc-stage">
        <div className="nc-ring-wrap">
          <svg className="nc-ring" viewBox={`0 0 ${RING_VIEW} ${RING_VIEW}`} aria-hidden="true" focusable="false">
            <circle className="nc-ring-track" cx={RING_MID} cy={RING_MID} r={RING_R} />

            {/* Months of practice, folded by note: one tick per place that note
                lives on the neck. The whole band appears together or not at all,
                because a lit tick means nothing without the unlit ones beside it
                — four of six is the reading, and four floating specks is not. So
                until something has been measured there is nothing here, and the
                figure is exactly what it was before there was anything true to
                put on it. */}
            {anythingRecorded &&
              record.map((ticks, slot) =>
                ticks.map((standing, i) => (
                  <path
                    key={`wear-${slot}-${i}`}
                    className={clsx('nc-wear', `is-${standing}`)}
                    d={wearPath(slot, i, ticks.length)}
                  />
                )),
              )}

            {Array.from({ length: steps }, (_, i) => (
              <motion.path
                key={`${fromSlot}-${steps}-${i}`}
                className="nc-ring-step"
                d={segmentPath(fromSlot + i)}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: segmentDelay(i) }}
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
            {/* The demonstration's own mark: a ring closing on the note about
                to be tapped. It is the gesture drawn, and it is the only thing
                on this surface that is not a fact about music. */}
            {demo.at !== null && (
              <motion.circle
                key={`demo-${demo.at}`}
                className="nc-demo"
                cx={polar(slotOf(demo.at), RING_HIT_R).x}
                cy={polar(slotOf(demo.at), RING_HIT_R).y}
                r={22}
                initial={{ r: 22, opacity: 0 }}
                animate={{ r: 11, opacity: [0, 1, 1, 0] }}
                transition={{ duration: DEMO_TAP_MS / 1000, ease: [0.16, 1, 0.3, 1] }}
              />
            )}

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
                  onClick={() => {
                    demo.stop();
                    pick(pc);
                  }}
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
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.4 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2, delay: segmentDelay(index) }}
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
                onClick={() => {
                  demo.stop();
                  setStringPosition(s.position);
                }}
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

              {/* The same record, on the string being looked at. Frets, not
                  notes: this is where the hand has been asked to go. */}
              {cells.map(({ cell, fret }) => {
                const standing = positionStanding(noteMap[positionKey(string.position, fret)]);
                if (standing === 'unasked' || fret > 12) return null;
                return (
                  <rect
                    key={`wear${cell}`}
                    className={clsx('nc-neck-wear', `is-${standing}`)}
                    x={wireX(cell) + 4}
                    y={NECK_TOP + 4}
                    width={NECK_CELL - 8}
                    height={NECK_BOTTOM - NECK_TOP - 8}
                    rx={3}
                  />
                );
              })}

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
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: segmentDelay(i) }}
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
                  onClick={() => {
                    demo.stop();
                    pick(pc);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
