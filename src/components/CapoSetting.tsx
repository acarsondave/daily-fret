import { useStore, useUserData } from '../store';
import { CapoIcon } from './icons';

/** Frets a capo realistically lives on. The store clamps beyond this anyway. */
const FRETS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Where the capo is. Account settings rather than a per-drill control, because
 * it is a fact about the instrument in the room, like the microphone and the
 * calibration it sits beside.
 *
 * This is the one setting whose absence used to break things silently: the
 * detector matches pitch classes, so a capo transposed everything it heard and
 * drills simply stopped counting with no visible cause.
 */
export function CapoSetting() {
  const capo = useUserData().capoFret ?? 0;
  const setCapoFret = useStore((s) => s.setCapoFret);

  return (
    <div className="mic-setting">
      <div className="mic-setting-head">
        <CapoIcon size={18} />
        <span id="capo-setting-label">Capo</span>
      </div>
      <div className="capo-frets" role="radiogroup" aria-labelledby="capo-setting-label">
        {FRETS.map((fret) => (
          <button
            key={fret}
            type="button"
            role="radio"
            aria-checked={fret === capo}
            aria-label={fret === 0 ? 'No capo' : `Capo on fret ${fret}`}
            className={fret === capo ? 'capo-fret is-on' : 'capo-fret'}
            onClick={() => setCapoFret(fret)}
          >
            {fret === 0 ? 'None' : fret}
          </button>
        ))}
      </div>
      <p className="cal-setting-status">
        {capo === 0
          ? 'Set this whenever you clamp one on, or the drills stop hearing you.'
          : `Drills expect a capo on fret ${capo}. Take it off and set this back to None.`}
      </p>
    </div>
  );
}
