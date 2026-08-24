import { YoutubeLogo } from '@phosphor-icons/react';
import { ChartMiniature } from './ChartMiniature';
import { ICON_STROKE } from '../icons/Icon';
import type { SongTimeline } from '../../lib/songTiming';
import './songModeChoice.css';

// Two ways to play a song, as two pictures.
//
// The chart card is not a picture *of* chart mode, it is chart mode at a quarter
// scale, already running this song's own bars. Nobody has to be told what it
// does. The record card carries the YouTube mark, which is the one legitimate
// use of a stock glyph in this app: it names YouTube, and a redrawn YouTube logo
// would be a wrong logo.
//
// WHY THIS IS ALWAYS SHOWN, INCLUDING INSIDE A COACHED SESSION. The owner had
// been looking straight at the song screen for a fortnight and concluded the
// chart had never been built, because a coached session went straight to the
// video and nothing on the way in said there was anything else. A mode that is
// only reachable from a screen the person does not use is a mode that does not
// exist. It costs one tap, and record mode already cost that tap on the video's
// own play button.
//
// With no connection, the record card is struck through in the icon set's own
// stroke weight and cannot be picked. No sentence appears, and nothing is dimmed
// with opacity: this app never signals availability by making text harder to
// read.

export type SongMode = 'chart' | 'record';

interface Props {
  /** The chart's own timeline, or null when this song has no bars to scroll. */
  timeline: SongTimeline | null;
  online: boolean;
  onPick: (mode: SongMode) => void;
}

export function SongModeChoice({ timeline, online, onPick }: Props) {
  return (
    <div className="song-modes" role="group" aria-label="How to play this song">
      {timeline && (
        <button className="song-mode is-chart" onClick={() => onPick('chart')} autoFocus>
          <ChartMiniature timeline={timeline} />
          <span className="song-mode-name">Play the song</span>
        </button>
      )}
      <button
        className="song-mode is-record"
        onClick={() => onPick('record')}
        disabled={!online}
        autoFocus={!timeline}
      >
        <span className="song-mode-art">
          <YoutubeLogo size={34} color="#ff5252" weight="fill" />
          {!online && <Strike />}
        </span>
        <span className="song-mode-name">Play with the band</span>
      </button>
    </div>
  );
}

/**
 * The card, crossed out.
 *
 * Drawn rather than styled so it holds the icon set's 1.75 pen at any card
 * shape: a border or a gradient rule would thicken and thin with the aspect
 * ratio, and a CSS line-through would only reach the words.
 */
function Strike() {
  return (
    <svg
      className="song-mode-strike"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="6"
        y1="6"
        x2="94"
        y2="94"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
