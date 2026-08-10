import { useStore, useUserData } from '../../store';
import { CapoIcon } from '../icons';

/** Frets a capo realistically lives on. The store clamps beyond this anyway. */
const FRETS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Where the capo is.
 *
 * This is the one setting whose absence used to break things silently: the
 * detector matches pitch classes, so a capo transposed everything it heard and
 * drills simply stopped counting with no visible cause. That is why it is also
 * carried in the quick setup popover in the header: it changes from session to
 * session, and burying it under a scroll is how it goes wrong.
 */
export function CapoSetting() {
  const capo = useUserData().capoFret ?? 0;
  const setCapoFret = useStore((s) => s.setCapoFret);

  return (
    <div className="setting-block">
      <h3 className="setting-head" id="capo-setting-label">
        <CapoIcon size={18} className="setting-head-icon" />
        <span>Capo</span>
      </h3>
      <div className="capo-frets" role="radiogroup" aria-labelledby="capo-setting-label">
        {FRETS.map((fret) => (
          <button
            key={fret}
            type="button"
            role="radio"
            aria-checked={fret === capo}
            aria-label={fret === 0 ? 'No capo' : `Capo on fret ${fret}`}
            className={`capo-fret${fret === capo ? ' is-on' : ''}${fret === 0 ? ' is-none' : ''}`}
            onClick={() => setCapoFret(fret)}
          >
            {fret === 0 ? 'None' : fret}
          </button>
        ))}
      </div>
      <p className="setting-note">
        {capo === 0
          ? 'Set this whenever you clamp one on, or the drills stop hearing you.'
          : `Drills expect a capo on fret ${capo}. Take it off and set this back to None.`}
      </p>
    </div>
  );
}
