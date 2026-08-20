// A riff, engraved and paced.
//
// THESIS. Tab is a timeline drawn on six strings, and this app draws real
// instruments everywhere else: the chord boxes, the tuner's headstock, the neck
// inside the note circle. The riff was the one surface that dropped to monospace
// dashes and pipes, which is a text file pretending to be music and read as
// exactly that next to everything around it. So the strings are strings, drawn
// at their real gauge; the fret numbers break the string the way engraved tab
// does; a bar division is a division; a repeat is a repeat with the return drawn
// as a return. Nothing on this surface is a character.
//
// STORY. The riff is read, not followed. A note in brackets is drawn as a tie
// arriving from the note before it, and a repeat is drawn with the return
// bracket that says where it sends you: the two questions the owner had to ask
// out loud, answered in the drawing rather than in a caption.
//
// WHAT IS NOT HERE. A playhead. This surface carried one for a day: a marker
// walking the staff at the click's tempo, with a count-in of four pips. Two
// things were wrong with it. It was broken, reading a bar-relative beat count as
// though it were elapsed time, so it could never leave the first bar. And the
// idea was wrong underneath the bug, which is why it is not being repaired. The
// tempo it walked at was the block's own BPM or the default practice click,
// a number with nothing to do with how the riff is actually played, so it asked
// the player to sync to an arbitrary pace on a surface that hears nothing. A
// screen that invites matching while measuring nothing is the same overclaim as
// a number nobody earned. The click is still there for anyone who wants it; it
// simply no longer pretends the sheet is following it.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  parseTab,
  readScore,
  readStrings,
  readSystems,
  type TabBar,
  type TabJoin,
  type TabJoinKind,
  type TabNote,
  type TabScore,
  type TabString,
  type TabSystem,
} from '../../lib/tab';
import './tab.css';

interface Props {
  source: string;
}

// Fixed engraving, like the chord boxes and the note circle's neck: the numbers
// are written out rather than derived from a scale factor, because a half pixel
// of drift shows on a figure this regular. Only the stylesheet ever picks a
// size, and it does it by saying what one grid column is worth in real pixels.
const COL = 10;
/**
 * Glyph scale: how wide a fret numeral and the marks around it are.
 *
 * Separate from the column pitch because a justified system stretches its
 * columns and must not stretch its numbers with them. The same split every
 * engraver makes between the spacing of a line and the size of its type.
 */
const GLYPH = 10;
const STRING_GAP = 16;
/** Room for the string names, which every system reprints. */
const GUTTER = 26;
const PAD_R = 7;
const PAD_T = 7;
const PAD_B = 16;
/** The count row's band, above the strings. */
const COUNT_BAND = 20;
/** The repeat's return arc, above everything. */
const ARC_BAND = 16;

/** Column pitch in px, used only before the first measurement lands. */
const FALLBACK_COL_PX = 12;
/** Under this a system is too narrow to be a staff, and the riff stops wrapping. */
const MIN_COLUMNS = 8;
/** Columns assumed before the frame has been measured. */
const UNMEASURED_COLUMNS = 32;
/**
 * How full a system has to be before it is stretched to the full width.
 *
 * Notation justifies every system but a short last one, and this is the line
 * between the two. Under it a system keeps its natural spacing and ends where
 * it ends; over it, it fills, which is what stops a riff of three equal bars
 * from sitting in the left two thirds of the screen with nothing beside it.
 */
const JUSTIFY_FLOOR = 0.62;
/**
 * How far past the design pitch a line may be packed to save a system.
 *
 * A riff four columns wider than the screen would otherwise become two lines,
 * the first full and the second holding a bar and a half of air. Tightening the
 * spacing by a sixth is invisible; a half-empty second line is not.
 */
const SQUEEZE = 1.18;

export function TabStaff({ source }: Props) {
  const riffs = useMemo(() => {
    return parseTab(source).map((block) => {
      const score = readScore(block);
      return { score, strings: readStrings(score.labels) };
    });
  }, [source]);

  if (!riffs.length) return null;

  return (
    <div className="tab-staff">
      {riffs.map((riff, i) => (
        <Riff key={i} score={riff.score} strings={riff.strings} />
      ))}
    </div>
  );
}

interface RiffProps {
  score: TabScore;
  strings: TabString[];
}

function Riff({ score, strings }: RiffProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  // What one column is worth here, and how many of them fit. The pitch is a
  // design value and lives in the stylesheet; the count is arithmetic and lives
  // here, measured off the rendered frame rather than guessed from a breakpoint.
  const [fit, setFit] = useState<{ columns: number; colPx: number }>({
    columns: UNMEASURED_COLUMNS,
    colPx: FALLBACK_COL_PX,
  });

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const styles = getComputedStyle(el);
      const pitch = Number.parseFloat(styles.getPropertyValue('--tab-col'));
      const pad = Number.parseFloat(styles.getPropertyValue('--tab-pad'));
      const colPx = Number.isFinite(pitch) && pitch > 0 ? pitch : FALLBACK_COL_PX;
      // The frame is measured but never painted; the sheet inside it carries the
      // padding and the border, and its own width comes back out of this.
      const inset = (Number.isFinite(pad) ? pad : 0) * 2 + 2;
      const usable = (el.clientWidth - inset) / (colPx / COL) - GUTTER - PAD_R;
      const columns = Math.max(MIN_COLUMNS, Math.floor(usable / COL));
      setFit((prev) => (prev.columns === columns && prev.colPx === colPx ? prev : { columns, colPx }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Every system is drawn in a viewBox of the same width, so they stack as one
  // block with one staff height. A full system fills that width by stretching
  // its column pitch, the way an engraver justifies a line; a short last one
  // keeps its natural spacing and simply ends sooner.
  const layout = useMemo(() => {
    const view = GUTTER + fit.columns * COL + PAD_R;
    return readSystems(score, Math.floor(fit.columns * SQUEEZE)).map((system) => {
      const span = system.to - system.from;
      const natural = GUTTER + span * COL + PAD_R;
      const justify = natural >= view * JUSTIFY_FLOOR;
      const width = justify ? view : natural;
      return {
        system,
        col: justify ? (view - GUTTER - PAD_R) / span : COL,
        width,
        // Stated in real pixels rather than as a percentage, so the sheet behind
        // the music can shrink to the music instead of the column it sits in.
        px: (width * fit.colPx) / COL,
      };
    });
  }, [score, fit]);
  const repeat = useMemo(() => readRepeatSpan(score), [score]);
  const hasCount = score.beats.length > 0;
  const band = (repeat ? ARC_BAND : 0) + (hasCount ? COUNT_BAND : 0);
  const top = PAD_T + band;
  const height = top + Math.max(0, score.labels.length - 1) * STRING_GAP + PAD_B;

  if (!score.labels.length) {
    return score.caption ? <p className="tab-caption is-alone">{score.caption}</p> : null;
  }

  const spoken = describe(score, strings);

  return (
    <figure className="tab-riff">
      {score.caption && <figcaption className="tab-caption">{score.caption}</figcaption>}
      {/* The staff is drawn, so it is a picture; the riff is a sequence, so it
          is also a list. Sighted players get the first, screen readers the
          second, and neither is a summary of the other. The old renderer needed
          a focusable scroll region because half the riff was off-screen; this
          one has nothing off-screen left to reach. */}
      <ol className="sr-only tab-spoken">
        {spoken.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      <div className="tab-frame" ref={frameRef}>
        <div className="tab-sheet">
        {layout.map(({ system, col, width, px }, i) => {
          return (
            <svg
              key={`${system.from}-${system.to}`}
              className="tab-system"
              viewBox={`0 0 ${width.toFixed(2)} ${height}`}
              style={{ width: `${px.toFixed(2)}px`, animationDelay: `${0.04 + i * 0.07}s` }}
              aria-hidden="true"
              focusable="false"
            >
              <System
                score={score}
                strings={strings}
                system={system}
                col={col}
                top={top}
                hasCount={hasCount}
                repeat={repeat}
              />
            </svg>
          );
        })}
        </div>
      </div>
    </figure>
  );
}

interface RepeatSpan {
  /** Column the repeat sends the player back to. */
  from: number;
  /** Column the repeat turns at. */
  to: number;
}

function readRepeatSpan(score: TabScore): RepeatSpan | null {
  const close = score.bars.findIndex((bar) => bar.repeatEnd);
  if (close < 0) return null;
  let open = 0;
  for (let i = close - 1; i >= 0; i--) {
    if (score.bars[i].repeatStart) {
      open = score.bars[i].column;
      break;
    }
  }
  return { from: open, to: score.bars[close].column };
}

interface SystemProps {
  score: TabScore;
  strings: TabString[];
  system: TabSystem;
  /** This system's column pitch, which justification may have stretched. */
  col: number;
  top: number;
  hasCount: boolean;
  repeat: RepeatSpan | null;
}

/** One line of staff: strings, frets, bars, and the marks between them. */
function System({ score, strings, system, col, top, hasCount, repeat }: SystemProps) {
  const x = (column: number) => GUTTER + (column - system.from + 0.5) * col;
  const y = (line: number) => top + line * STRING_GAP;
  const notes = score.notes.filter((n) => n.column >= system.from && n.column < system.to);
  const bars = score.bars.filter((b) => b.column >= system.from && b.column < system.to);
  // A staff that starts on a barline starts *at* it, not half a column short of
  // it: the stub of string hanging off the front is the one thing that makes an
  // otherwise clean system look unfinished.
  const opensOnRule = bars.some((b) => b.column === system.from);
  const closesOnRule = bars.some((b) => b.column + b.width === system.to);
  const left = opensOnRule ? x(system.from) : x(system.from) - col / 2;
  const right = closesOnRule ? x(system.to - 1) : x(system.to - 1) + col / 2;
  const joins = score.joins.filter((j) => j.from >= system.from && j.to <= system.to);
  const beats = score.beats.filter((b) => b.column >= system.from && b.column < system.to);

  return (
    <>
      {/* The strings. Gauge follows the instrument, thinnest at the top, the
          same taper the chord boxes and the tuner draw, so the three screens
          describe one guitar. Each line is cut where a numeral sits on it,
          which is what engraved tab does and what stops a fret number looking
          like it floats over the string rather than stopping it. */}
      {strings.map((string, line) => (
        <g key={line} className="tab-string" style={{ strokeWidth: 0.5 + (string.position - 1) * 0.16 }}>
          {stringSegments(notes, line, left, right, x).map((seg, i) => (
            <line key={i} x1={seg[0]} y1={y(line)} x2={seg[1]} y2={y(line)} />
          ))}
        </g>
      ))}

      {/* String names, reprinted on every system the way a clef is. */}
      {strings.map((string, line) => (
        <text key={`n${line}`} className="tab-name" x={GUTTER - 9} y={y(line)} dy="0.34em" textAnchor="end">
          {string.label || string.position}
        </text>
      ))}

      {bars.map((bar, i) => (
        <Barline key={`b${i}`} bar={bar} x={x(bar.column)} top={top} lines={score.labels.length} />
      ))}

      {joins.map((join, i) => (
        <Join key={`j${i}`} join={join} x={x} y={y} />
      ))}

      {notes.map((note, i) => (
        <Note key={`f${i}`} note={note} score={score} system={system} col={col} x={x} y={y} />
      ))}

      {/* The count, drawn as a ruler rather than typed as a row of characters:
          numbers on the beats, dots on the subdivisions between them. It reads
          as rhythm at a glance, which "1 + 2 + 3 + 4 +" never does. */}
      {hasCount &&
        beats.map((beat, i) =>
          beat.primary ? (
            <text
              key={`c${i}`}
              className="tab-count"
              x={x(beat.column)}
              y={top - COUNT_BAND * 0.55}
              textAnchor="middle"
            >
              {beat.label}
            </text>
          ) : (
            <circle key={`c${i}`} className="tab-off" cx={x(beat.column)} cy={top - COUNT_BAND * 0.68} r={1.25} />
          ),
        )}

      {repeat && <ReturnArc repeat={repeat} system={system} col={col} x={x} top={top} />}

    </>
  );
}

/**
 * The string, minus the places a fret number is sitting on it.
 *
 * Written as gaps rather than as a filled box behind each numeral, so the cut is
 * exact at any size and does not depend on the staff having a flat colour behind
 * it.
 */
function stringSegments(
  notes: readonly TabNote[],
  line: number,
  left: number,
  right: number,
  x: (column: number) => number,
): [number, number][] {
  const gaps = notes
    .filter((n) => n.line === line)
    .map((n): [number, number] => [x(n.column) - GLYPH * 0.62, x(n.column + n.width - 1) + GLYPH * 0.62])
    .sort((a, b) => a[0] - b[0]);

  const out: [number, number][] = [];
  let cursor = left;
  for (const [from, to] of gaps) {
    if (from > cursor) out.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < right) out.push([cursor, right]);
  return out;
}

function Note({
  note,
  score,
  system,
  col,
  x,
  y,
}: {
  note: TabNote;
  score: TabScore;
  system: TabSystem;
  col: number;
  x: (column: number) => number;
  y: (line: number) => number;
}) {
  const cx = (x(note.column) + x(note.column + note.width - 1)) / 2;
  const cy = y(note.line);
  if (!note.tied) {
    return (
      <text className="tab-fret" x={cx} y={cy} dy="0.35em" textAnchor="middle">
        {note.fret}
      </text>
    );
  }

  // A bracketed fret is a note still ringing, not a new one. Drawn as the tie it
  // is: an arc arriving from whatever struck it, and the numeral held one step
  // back, so "do not play this one" is seen rather than looked up. When the note
  // it continues from sits on an earlier system the arc arrives from off the
  // left edge, which is exactly what a tie across a system break looks like.
  const previous = score.notes.filter((n) => n.line === note.line && n.column < note.column).pop();
  const fromX =
    previous && previous.column >= system.from
      ? x(previous.column + previous.width - 1) + GLYPH * 0.5
      : x(system.from) - col * 0.5;
  const toX = cx - GLYPH * 0.6;
  const lift = cy - STRING_GAP * 0.5;
  return (
    <g className="tab-tied">
      <path
        d={`M ${fromX.toFixed(2)} ${cy} Q ${((fromX + toX) / 2).toFixed(2)} ${lift.toFixed(2)} ${toX.toFixed(2)} ${cy}`}
      />
      <text x={cx} y={cy} dy="0.35em" textAnchor="middle">
        {note.fret}
      </text>
    </g>
  );
}

function Barline({ bar, x, top, lines }: { bar: TabBar; x: number; top: number; lines: number }) {
  const y1 = top;
  const y2 = top + Math.max(0, lines - 1) * STRING_GAP;
  const mid = (y1 + y2) / 2;
  const rule = (at: number, key: string, className = 'tab-rule') => (
    <line key={key} className={className} x1={at} y1={y1} x2={at} y2={y2} />
  );

  if (bar.repeatStart || bar.repeatEnd) {
    // Heavy rule outermost, thin rule inside it, dots inside that: the order
    // printed music has used for two hundred years, and the whole of how a
    // player tells an opening from a closing without reading anything.
    const side = bar.repeatEnd ? -1 : 1;
    return (
      <g>
        {rule(x, 'heavy', 'tab-rule is-heavy')}
        {rule(x + side * 3.6, 'thin')}
        {repeatDots(top, lines, mid).map((cy, i) => (
          <circle key={i} className="tab-dot" cx={x + side * 8} cy={cy} r={1.6} />
        ))}
      </g>
    );
  }

  return (
    <g>
      {rule(x, 'a')}
      {bar.heavy && rule(x + 3.2, 'b', 'tab-rule is-heavy')}
    </g>
  );
}

/**
 * Where a repeat's two dots go: in the spaces either side of the middle, never
 * on a string.
 *
 * A dot sitting on a line reads as a note on that string, which on a tab staff
 * is exactly the wrong thing to suggest.
 */
function repeatDots(top: number, lines: number, mid: number): [number, number] {
  const spaces = lines - 1;
  if (spaces < 2) return [mid - STRING_GAP * 0.24, mid + STRING_GAP * 0.24];
  const low = spaces % 2 === 1 ? (spaces - 1) / 2 - 1 : spaces / 2 - 1;
  const high = spaces % 2 === 1 ? (spaces - 1) / 2 + 1 : spaces / 2;
  return [top + (low + 0.5) * STRING_GAP, top + (high + 0.5) * STRING_GAP];
}

/**
 * Where the repeat sends the player, drawn as the journey it is.
 *
 * The owner asked out loud how to restart a riff, and the answer was two
 * characters that looked like every other character on the staff. This is the
 * same answer as a path: up out of the closing rule, back across the music, and
 * down onto the opening one with the arrow on the end. A bracket rather than a
 * slur, because a slur drawn over six hundred pixels of staff is a straight
 * line, and a straight line above the music says nothing at all.
 */
function ReturnArc({
  repeat,
  system,
  col,
  x,
  top,
}: {
  repeat: RepeatSpan;
  system: TabSystem;
  col: number;
  x: (column: number) => number;
  top: number;
}) {
  const startsHere = repeat.from >= system.from && repeat.from < system.to;
  const endsHere = repeat.to >= system.from && repeat.to < system.to;
  const spans = repeat.from < system.from && repeat.to >= system.to;
  if (!startsHere && !endsHere && !spans) return null;

  const x1 = startsHere ? x(repeat.from) : x(system.from) - col * 0.5;
  const x2 = endsHere ? x(repeat.to) : x(system.to - 1) + col * 0.5;
  if (x2 <= x1) return null;
  // Down onto the rules themselves rather than to a floating point above them:
  // the bracket has to visibly leave one barline and arrive at the other.
  const base = top - 1;
  const lane = PAD_T + 2.5;
  const r = Math.min(4, (x2 - x1) / 2);

  // Only the end that is actually on this system turns down onto a rule. An end
  // that carries on runs flat off the edge, which is the whole of how a reader
  // knows the repeat continues on the line below.
  const d =
    (endsHere
      ? `M ${x2.toFixed(2)} ${base.toFixed(2)} V ${(lane + r).toFixed(2)}` +
        ` Q ${x2.toFixed(2)} ${lane.toFixed(2)} ${(x2 - r).toFixed(2)} ${lane.toFixed(2)}`
      : `M ${x2.toFixed(2)} ${lane.toFixed(2)}`) +
    ` H ${(startsHere ? x1 + r : x1).toFixed(2)}` +
    (startsHere
      ? ` Q ${x1.toFixed(2)} ${lane.toFixed(2)} ${x1.toFixed(2)} ${(lane + r).toFixed(2)}` +
        ` V ${base.toFixed(2)}`
      : '');

  return (
    <g className="tab-return">
      <path d={d} />
      {startsHere && (
        <path
          className="tab-return-head"
          d={`M ${(x1 - 2.6).toFixed(2)} ${(base - 3.6).toFixed(2)} L ${x1.toFixed(2)} ${base.toFixed(2)} L ${(x1 + 2.6).toFixed(2)} ${(base - 3.6).toFixed(2)}`}
        />
      )}
    </g>
  );
}

/** Printed tab puts a letter on the slur for these two, and nothing on the rest. */
const JOIN_LETTER: Record<TabJoinKind, string> = {
  hammer: 'H',
  pull: 'P',
  bend: 'B',
  'slide-up': '',
  'slide-down': '',
  vibrato: '',
};

function Join({
  join,
  x,
  y,
}: {
  join: TabJoin;
  x: (column: number) => number;
  y: (line: number) => number;
}) {
  const x1 = x(join.from) - GLYPH * 0.3;
  const x2 = x(join.to) - GLYPH * 0.7;
  const cy = y(join.line);

  if (join.kind === 'vibrato') {
    // A real wave, on the string's own line, rather than a run of tildes.
    const width = Math.max(GLYPH, x2 - x1 + GLYPH);
    const steps = Math.max(2, Math.round(width / 3.4));
    const step = width / steps;
    let d = `M ${x1.toFixed(2)} ${cy}`;
    for (let i = 0; i < steps; i++) {
      d += ` q ${(step / 2).toFixed(2)} ${i % 2 ? 2.2 : -2.2} ${step.toFixed(2)} 0`;
    }
    return <path className="tab-join is-vibrato" d={d} />;
  }

  if (join.kind === 'slide-up' || join.kind === 'slide-down') {
    const rise = join.kind === 'slide-up' ? 3 : -3;
    return <line className="tab-join is-slide" x1={x1} y1={cy + rise} x2={x2} y2={cy - rise} />;
  }

  const lift = cy - STRING_GAP * 0.48;
  return (
    <g className="tab-join">
      <path
        d={`M ${x1.toFixed(2)} ${(cy - 2.4).toFixed(2)} Q ${((x1 + x2) / 2).toFixed(2)} ${lift.toFixed(2)} ${x2.toFixed(2)} ${(cy - 2.4).toFixed(2)}`}
      />
      <text x={(x1 + x2) / 2} y={lift + 1.2} textAnchor="middle">
        {JOIN_LETTER[join.kind]}
      </text>
    </g>
  );
}

/**
 * The riff as a sequence, for anyone who cannot see it.
 *
 * One line per column rather than one per note, because a chord is one thing to
 * place and reading it as three separate frets describes a different instrument.
 * Everything the drawing states is stated here too: the bar, the string, the
 * fret, the tie, and where the repeat turns.
 */
function describe(score: TabScore, strings: TabString[]): string[] {
  if (!score.notes.length) return [];
  const lines: string[] = [];
  const columns = [...new Set(score.notes.map((n) => n.column))].sort((a, b) => a - b);
  // Bar boundaries straight off the drawn rules. The spoken list is the sighted
  // reading's equal, and a sighted reader can see where a bar starts.
  const spans: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < score.bars.length; i++) {
    const from = score.bars[i].column + score.bars[i].width;
    const to = score.bars[i + 1].column;
    if (to > from) spans.push({ from, to });
  }
  let bar = -1;

  for (const column of columns) {
    const which = spans.findIndex((b) => column >= b.from && column < b.to);
    if (which >= 0 && which !== bar) {
      bar = which;
      lines.push(`Bar ${which + 1}`);
    }
    const here = score.notes.filter((n) => n.column === column);
    lines.push(
      here
        .map((note) => {
          const string = strings[note.line];
          const name = string ? string.spoken : `string ${note.line + 1}`;
          return note.tied ? `${name} fret ${note.fret}, still ringing` : `${name} fret ${note.fret}`;
        })
        .join(', '),
    );
  }

  const close = score.bars.findIndex((b) => b.repeatEnd);
  if (close >= 0) {
    const opens = score.bars.slice(0, close).some((b) => b.repeatStart);
    lines.push(opens ? 'Repeat back to the opening repeat mark' : 'Repeat from the start');
  }
  return lines;
}
