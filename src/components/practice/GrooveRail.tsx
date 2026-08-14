import type { CSSProperties } from 'react';
import { IN_TIME_MS, TIMING_RESOLUTION_MS, type BeatOffset } from '../../lib/strumTiming';

/**
 * How far either side of the beat the rail can show, in milliseconds.
 *
 * Not half a beat, which is the widest an offset can mathematically be: at 80
 * BPM that is 375 ms and it would squeeze every real strum into the middle
 * eighth of the rail, where nothing is legible and nothing appears to move.
 * 140 ms is a little under three times the in-time window, so the window sits in
 * the middle third and an ordinary beginner's spread fills the rail rather than
 * hiding in it. Anything wider is pinned to the edge and squared off against it,
 * because a strum that missed by 300 ms is a fact worth showing and its exact
 * size is not.
 */
export const RAIL_SPAN_MS = 140;

/** Position across the rail, 0 to 1, with anything past the ends pinned. */
function railPosition(offsetMs: number): number {
  const clamped = Math.max(-RAIL_SPAN_MS, Math.min(RAIL_SPAN_MS, offsetMs));
  return (clamped + RAIL_SPAN_MS) / (2 * RAIL_SPAN_MS);
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

/**
 * The fixed furniture of the rail: the beat, and the window around it.
 *
 * Shared by the live view and the results chart so the two are literally the
 * same picture at two moments. A player who has learnt to read the live rail has
 * already learnt to read their result.
 */
function RailGround({ pulsing }: { pulsing: boolean }) {
  return (
    <>
      <span
        className="groove-window"
        style={{
          left: percent(railPosition(-IN_TIME_MS)),
          right: percent(1 - railPosition(IN_TIME_MS)),
        }}
      />
      <span className={pulsing ? 'groove-beat is-pulsing' : 'groove-beat'} />
    </>
  );
}

interface LiveProps {
  /** Most recent first. The rail draws them as a queue running down its face. */
  marks: readonly { id: number; offsetMs: number }[];
  /** Where the middle of the playing is sitting, in ms, or null before there is one. */
  centreMs: number | null;
  /** How wide the playing is, in ms. Drawn as the band that narrows as it tightens. */
  spreadMs: number;
  /** True when the run is inside the resolution the drill can honestly claim. */
  locked: boolean;
  /** Bumped on every click heard in the room, so the beat can answer it. */
  clickPulse: number;
}

/**
 * The live view.
 *
 * Two things are drawn and they say different things on purpose. Each strum is a
 * mark, and a mark is never right or wrong: it has a position and nothing else,
 * no tick, no cross, no colour that means failure. What does carry a verdict is
 * the band behind them, which is the whole run's centre and spread, and which
 * narrows and slides home as the playing tightens. So the thing that improves is
 * the groove rather than the strum, which is both truer and the difference
 * between practising and being marked.
 */
export function GrooveRail({ marks, centreMs, spreadMs, locked, clickPulse }: LiveProps) {
  const bandHalf = Math.max(spreadMs, TIMING_RESOLUTION_MS / 2);
  const hasBand = centreMs !== null && marks.length >= 3;

  return (
    <div className="groove" role="img" aria-label={grooveLabel(centreMs, spreadMs, marks.length)}>
      <div className="groove-rail">
        <RailGround pulsing />
        {hasBand && (
          <span
            className={locked ? 'groove-band is-locked' : 'groove-band'}
            style={{
              left: percent(railPosition(centreMs - bandHalf)),
              right: percent(1 - railPosition(centreMs + bandHalf)),
            }}
          />
        )}
        {/* Keyed by strum, so React moves each mark down its queue rather than
            recycling one element's position and teleporting the marks about. */}
        {marks.map((mark, age) => (
          <span
            key={mark.id}
            className={`groove-mark is-age-${Math.min(age, 5)}${edgeClass(mark.offsetMs)}`}
            style={{ left: percent(railPosition(mark.offsetMs)), '--groove-age': age } as GrooveMarkStyle}
          />
        ))}
        {/* One pulse per click heard, remounted by key so it always plays from
            the start even when two clicks land inside its own duration. */}
        <span key={clickPulse} className="groove-pulse" aria-hidden="true" />
      </div>
      <div className="groove-scale">
        <span>ahead of the click</span>
        <span>behind it</span>
      </div>
    </div>
  );
}

interface GrooveMarkStyle extends CSSProperties {
  '--groove-age': number;
}

/** A mark the rail could not fit is squared off against the edge it ran past. */
function edgeClass(offsetMs: number): string {
  if (offsetMs < -RAIL_SPAN_MS) return ' is-beyond is-early';
  if (offsetMs > RAIL_SPAN_MS) return ' is-beyond is-late';
  return '';
}

function grooveLabel(centreMs: number | null, spreadMs: number, count: number): string {
  if (count === 0) return 'No strums heard yet.';
  if (centreMs === null) return `${count} strums heard.`;
  const lean = Math.round(centreMs);
  const where =
    Math.abs(lean) <= TIMING_RESOLUTION_MS
      ? 'on the beat'
      : lean < 0
        ? `${Math.abs(lean)} milliseconds ahead of the beat`
        : `${lean} milliseconds behind the beat`;
  return `Landing ${where}, spread ${Math.round(spreadMs)} milliseconds.`;
}

/**
 * The finished run, on the same rail.
 *
 * Every beat of the block at once, oldest at the top, so drift over the minute
 * is visible as a lean in the column rather than as a number that has averaged
 * it away. This is the artefact of the session and the reason the live view and
 * the result share a geometry.
 */
export function GrooveTrace({ offsets }: { offsets: readonly BeatOffset[] }) {
  if (offsets.length === 0) return null;
  const step = 100 / Math.max(1, offsets.length - 1);
  return (
    <div className="groove groove-trace" role="img" aria-label={`${offsets.length} strums, from the start of the block to the end.`}>
      <div className="groove-rail">
        <RailGround pulsing={false} />
        {offsets.map((offset, index) => (
          <span
            key={offset.beat}
            className={`groove-tick${edgeClass(offset.offsetMs)}`}
            style={{
              left: percent(railPosition(offset.offsetMs)),
              top: `${(index * step).toFixed(3)}%`,
            }}
          />
        ))}
      </div>
      <div className="groove-scale">
        <span>ahead</span>
        <span>behind</span>
      </div>
    </div>
  );
}
