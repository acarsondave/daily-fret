import { useEffect, useMemo, useRef } from 'react';
import { StrumRow } from './StrumRow';
import { beatPositionAt, type SongTimeline } from '../../lib/songTiming';
import './chartMiniature.css';

// The chart mode card is the chart, at a quarter scale, already moving.
//
// Not an illustration of the mode and not a sentence about it. Two bars of this
// song loop past a playhead with the chords changing and the arrows going by,
// which is the whole of what the mode does, so nobody has to be told.
//
// It borrows the real chart's discipline rather than its code: the transform is
// written straight to the DOM once a frame and React renders only the bars,
// which never change. A card that re-rendered a tree sixty times a second to
// advertise a feature would be a strange thing to ship.

interface Props {
  timeline: SongTimeline;
  /** Bars in the loop. Two is enough to show a chord change; four reads busy. */
  bars?: number;
}

/** Pixels per beat. Roughly half the real chart's 24 to 46. A quarter of it drew
 *  six arrows into forty pixels, which is texture rather than a strum. */
const BEAT_PX = 16;

/**
 * Where the loop starts.
 *
 * At the first chord change, so the card always shows the thing it is there to
 * show. Sing opens on four bars of Em, and two bars of one chord going past is a
 * picture of nothing changing.
 */
function loopStart(bars: SongTimeline['bars']): number {
  for (let i = 0; i < bars.length - 1; i++) {
    if (bars[i].chord !== bars[i + 1].chord) return i;
  }
  return 0;
}

export function ChartMiniature({ timeline, bars = 2 }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const count = Math.max(1, Math.min(bars, timeline.bars.length));
  const loop = useMemo(() => {
    const from = Math.min(loopStart(timeline.bars), Math.max(0, timeline.bars.length - count));
    return timeline.bars.slice(from, from + count);
  }, [timeline, count]);
  const loopBeats = loop.reduce((sum, bar) => sum + bar.beats, 0);
  const loopSeconds = loop[loop.length - 1].endSeconds - loop[0].startSeconds;

  useEffect(() => {
    const track = trackRef.current;
    if (!track || loopSeconds <= 0) return;
    // Someone who has asked for less motion still gets the picture: it steps
    // from bar to bar instead of gliding, which carries the same information.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const started = performance.now();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const into = ((performance.now() - started) / 1000) % loopSeconds;
      const seconds = loop[0].startSeconds + into;
      const at = beatPositionAt(timeline, seconds);
      const beat = calm.matches ? Math.floor(at / loop[0].beats) * loop[0].beats : at;
      track.style.transform = `translate3d(${-beat * BEAT_PX}px, 0, 0)`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [timeline, loop, loopSeconds]);

  // The loop drawn twice, so the wrap has nothing to catch the eye.
  const drawn = [...loop, ...loop];

  return (
    <span className="chart-mini" aria-hidden="true">
      <span className="chart-mini-viewport">
        <span className="chart-mini-track" ref={trackRef}>
          {drawn.map((bar, i) => (
            <span
              key={i}
              className="chart-mini-bar"
              style={{
                left: `${(bar.beatStart + (i >= count ? loopBeats : 0)) * BEAT_PX}px`,
                width: `${bar.beats * BEAT_PX}px`,
              }}
            >
              <span className="chart-mini-chord">{bar.chord}</span>
              <StrumRow strum={bar.strum} size={9} />
            </span>
          ))}
        </span>
      </span>
      <span className="chart-mini-playhead" />
    </span>
  );
}
