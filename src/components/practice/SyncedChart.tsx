import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StrumRow } from './StrumRow';
import {
  barIndexAt,
  beatCursorAt,
  beatPositionAt,
  beatsUntilNextBar,
  type SongTimeline,
} from '../../lib/songTiming';
import type { TimeSource } from '../../lib/mediaClock';
import './syncedChart.css';

// The chart that moves with the record.
//
// Three decisions carry this component.
//
// One: the bar you are playing is calm and the bar after it is already on
// screen. A beginner cannot read a chord and form it in the same instant, so a
// chart that reveals the chord as it arrives is a chart that is always one beat
// too late. The whole ribbon is laid out so the next chord has announced itself
// a full bar early, and that lead is the point of the layout, not a side effect.
//
// Two: nothing here is measured, scored, or failed. The microphone would hear
// the record through the speakers, so any accuracy number would be grading the
// band rather than the player. Nothing turns red. Nothing keeps count.
//
// Three: motion is written straight to the DOM, never through React. The
// transform is set on one element per frame while a video decodes beside it;
// re-rendering a tree sixty times a second to move a strip sideways is how this
// screen would stutter on the phone it is actually used on. React handles what
// changes once a bar, which is the chord, the strum and the section.

/**
 * The chart before it can move: the same frame, holding its own space, saying
 * what it is waiting for.
 *
 * Sized and shaped like the real thing so nothing jumps when the clock arrives.
 * A spinner in the middle of an empty rectangle would tell the player less and
 * would move the whole screen when it resolved.
 */
export function ChartStandIn({ note }: { note: string }) {
  return (
    <div className="chart is-standin">
      <div className="chart-ribbon">
        <div className="chart-viewport">
          <div className="chart-standin-bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="chart-playhead" aria-hidden="true" />
      </div>
      <p className="chart-note">{note}</p>
    </div>
  );
}

interface Props {
  timeline: SongTimeline;
  time: TimeSource;
  /**
   * Called on every frame with the current video time.
   *
   * The clock is read here because here is where the frame is, and the section
   * loop needs the same reading without a second animation loop of its own.
   * Must not cause a render.
   */
  onFrame?: (seconds: number) => void;
}

/** Bars kept behind and ahead of the playhead. Everything else is not built. */
const TRAIL_BARS = 2;
const LEAD_BARS = 7;

/** Longest count-in shown. Beyond two bars of waiting a number is just noise. */
const MAX_COUNT_IN_BEATS = 8;

/** A jump this large is a seek or a loop, not playback. It re-arms the count-in. */
const SEEK_JUMP_SECONDS = 0.6;

/**
 * Ribbon width per beat.
 *
 * Constant per beat rather than per second, so bars are the same width whatever
 * the tempo and the arrows inside them stay legible. The scroll speed then
 * varies with the music, which is what being carried by a record feels like.
 */
const beatPxFor = (width: number): number => Math.max(24, Math.min(46, Math.round(width / 11)));

export function SyncedChart({ timeline, time, onFrame }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const pipsRef = useRef<HTMLDivElement>(null);

  const [beatPx, setBeatPx] = useState(32);
  const [barIndex, setBarIndex] = useState(-1);
  const [countIn, setCountIn] = useState<number | null>(null);

  const beatPxRef = useRef(beatPx);
  useLayoutEffect(() => {
    beatPxRef.current = beatPx;
  }, [beatPx]);

  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  // The ribbon's scale comes from the space it actually got, not from a
  // breakpoint guess. On a 360px phone that lands a four-beat bar just under a
  // third of the screen, which keeps two bars of lead time visible ahead.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setBeatPx(beatPxFor(entry.contentRect.width));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const playhead = playheadRef.current;
    if (!track || !playhead) return;

    // Someone who has asked for less motion still needs the chart. It stops
    // gliding and steps from bar to bar instead, which carries every bit of the
    // information and none of the continuous movement.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

    let raf = 0;
    let lastBar = Number.NaN;
    let lastBeat = 0;
    let lastSeconds = Number.NaN;
    let lastCount: number | null = null;
    let countBar: number | null = null;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { seconds, playing } = time.read();
      onFrameRef.current?.(seconds);

      const index = barIndexAt(timeline, seconds);
      const bars = timeline.bars;

      const beat =
        calm.matches && index >= 0 && index < bars.length
          ? bars[index].beatStart
          : beatPositionAt(timeline, seconds);
      track.style.transform = `translate3d(${-beat * beatPxRef.current}px, 0, 0)`;

      const cursor = beatCursorAt(timeline, seconds);
      if (cursor.beat !== lastBeat) {
        lastBeat = cursor.beat;
        const pips = pipsRef.current?.children;
        if (pips) {
          for (let i = 0; i < pips.length; i++) {
            (pips[i] as HTMLElement).dataset.lit = i < cursor.beat ? 'yes' : 'no';
          }
        }
      }
      // One custom property on one element: the playhead swells on the beat and
      // settles before the next, so the pulse is the record's, not a loop of
      // our own running at a tempo it guessed.
      playhead.style.setProperty(
        '--pulse',
        playing ? String(Math.max(0, 1 - cursor.phase * 2.4)) : '0',
      );

      // A jump means a seek, a loop or an ad ending. Count the player back in
      // rather than dropping them mid-bar with no idea where the beat is.
      if (Number.isFinite(lastSeconds) && Math.abs(seconds - lastSeconds) > SEEK_JUMP_SECONDS) {
        countBar = index;
      }
      lastSeconds = seconds;

      const leading = index < 0 || index === countBar;
      const beatsAway = leading ? Math.ceil(beatsUntilNextBar(timeline, seconds)) : 0;
      const shown = beatsAway > 0 && beatsAway <= MAX_COUNT_IN_BEATS ? beatsAway : null;
      if (shown !== lastCount) {
        lastCount = shown;
        setCountIn(shown);
      }

      if (index !== lastBar) {
        if (index !== countBar) countBar = null;
        lastBar = index;
        setBarIndex(index);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [timeline, time]);

  const bars = timeline.bars;
  const anchor = barIndex < 0 ? 0 : Math.min(barIndex, bars.length - 1);
  const from = Math.max(0, anchor - TRAIL_BARS);
  const to = Math.min(bars.length, anchor + LEAD_BARS);
  const window_ = bars.slice(from, to);

  const current = barIndex >= 0 && barIndex < bars.length ? bars[barIndex] : null;
  // Before the first downbeat the chart still announces what it opens on, so
  // the hand is already on the shape when the record arrives.
  const nextIndex = barIndex < 0 ? 0 : barIndex + 1;
  const next = nextIndex < bars.length ? bars[nextIndex] : null;
  const finished = barIndex >= bars.length;
  const arrowSize = Math.max(9, Math.round(beatPx * 0.34));

  return (
    <div className="chart" ref={frameRef} role="group" aria-label="Chord chart, moving with the recording">
      <div className="chart-now">
        <div className="chart-now-main">
          <span className="chart-now-chord" key={current?.chord ?? 'lead'}>
            {current ? current.chord : finished ? 'End' : next?.chord ?? ''}
          </span>
          <div className="chart-pips" ref={pipsRef} aria-hidden="true">
            {Array.from({ length: current?.beats ?? timeline.bars[0].beats }, (_, i) => (
              <span className="chart-pip" key={i} data-lit="no" />
            ))}
          </div>
        </div>
        {next && !finished && (
          <div className="chart-next">
            <span className="chart-next-label">{current ? 'next' : 'starts on'}</span>
            <span className="chart-next-chord">{next.chord}</span>
          </div>
        )}
      </div>

      {current?.lyric && <p className="chart-lyric">{current.lyric}</p>}

      <div className="chart-ribbon">
        {/* The clip and the edge fade live here rather than on the track: the
            track is as wide as the whole song, so a gradient mask applied to it
            would be measured against five hundred bars instead of the window. */}
        <div className="chart-viewport">
          <div className="chart-track" ref={trackRef}>
            {window_.map((bar) => (
              <div
                key={bar.index}
                className={`chart-bar${bar.index === barIndex ? ' is-now' : ''}${
                  bar.index === nextIndex ? ' is-next' : ''
                }${bar.index < barIndex ? ' is-past' : ''}`}
                style={{ left: `${bar.beatStart * beatPx}px`, width: `${bar.beats * beatPx}px` }}
              >
                {bar.opensSection && <span className="chart-flag">{bar.sectionLabel}</span>}
                <span className="chart-bar-chord">{bar.chord}</span>
                <StrumRow strum={bar.strum} size={arrowSize} />
                {bar.tag && <span className="chart-bar-tag">{bar.tag}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="chart-playhead" ref={playheadRef} aria-hidden="true">
          <span className="chart-playhead-glow" />
        </div>
        {countIn !== null && (
          <div className="chart-countin" aria-hidden="true">
            <span className="chart-countin-number" key={countIn}>
              {countIn}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
