import type { SongPace } from '../../lib/songTempo';

// The tempo, drawn as the fraction it is.
//
// "0.7x" is a number about the control. What a player wants to know is how much
// of the song's own pace they are holding, so the bar fills toward the record's
// tempo and the mark sits where they are on it. At seventy percent of Get Lucky
// the mark is seventy percent along, and over weeks that mark moves right, which
// is the only record a song shelf has ever kept.
//
// A song with no written tempo has nothing to be a fraction of, so it shows the
// number alone. The app does not invent a record tempo to make a nicer picture.
//
// When the audio has gone, this says so in the metronome's own words and its own
// colour rather than in a new mechanism of its own: one appearance for one fact.

interface Props {
  pace: SongPace;
  /** The chart's current fraction of the pace above. */
  rate: number;
  audible: boolean;
}

export function SongPaceBar({ pace, rate, audible }: Props) {
  const played = Math.round(pace.bpm * rate);
  const full = pace.fullBpm;
  const fraction = full ? Math.min(1, played / full) : null;
  const label = audible
    ? full
      ? `${played} of the song's ${full} beats per minute`
      : `${played} beats per minute`
    : 'The click and the chords cannot be heard right now.';

  return (
    <div className={audible ? 'song-pace' : 'song-pace is-silent'} role="status" aria-label={label}>
      {fraction !== null && (
        <span className="song-pace-track" aria-hidden="true">
          <span className="song-pace-fill" style={{ width: `${fraction * 100}%` }} />
          <span className="song-pace-mark" style={{ left: `${fraction * 100}%` }} />
        </span>
      )}
      <span className="song-pace-value" aria-hidden="true">
        {audible ? played : 'muted'}
      </span>
    </div>
  );
}
