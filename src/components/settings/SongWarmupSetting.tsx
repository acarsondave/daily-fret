import { useStore, useUserData } from '../../store';
import { MusicNoteIcon } from '../icons';

/**
 * Whether a song in a coached session is preceded by a drill of its own strum.
 *
 * Off unless turned on. The owner asked for it to go or be optional: his
 * routine already carries its strumming tasks, and a song task that opens with
 * another strum block keeps him from the song he came to play.
 */
export function SongWarmupSetting() {
  const on = useUserData().songStrumWarmup ?? false;
  const setSongStrumWarmup = useStore((s) => s.setSongStrumWarmup);

  return (
    <div className="setting-block">
      <h3 className="setting-head" id="song-warmup-label">
        <MusicNoteIcon size={18} className="setting-head-icon" />
        <span>Strum warm-up before songs</span>
      </h3>
      <div className="song-warmup-options" role="radiogroup" aria-labelledby="song-warmup-label">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={on === value}
            className={`capo-fret${on === value ? ' is-on' : ''}`}
            onClick={() => setSongStrumWarmup(value)}
          >
            {value ? 'On' : 'Off'}
          </button>
        ))}
      </div>
      <p className="setting-note">
        {on
          ? 'In a coached session each song starts with 90 seconds of its own strum.'
          : 'In a coached session a song task goes straight to the song.'}
      </p>
    </div>
  );
}
