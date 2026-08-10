import { useStore, useUserData } from '../../store';
import { PlectrumIcon } from '../icons';
import { ChordDiagram } from '../practice/ChordDiagram';

/**
 * Which way round the chord boxes are drawn.
 *
 * A left-handed player reading a right-handed chord box has to mirror every
 * shape in their head before their hand can use it. The preview is the point:
 * this is a setting you confirm by looking, not by reading a label.
 */
export function HandednessSetting() {
  const leftHanded = useUserData().leftHanded ?? false;
  const setLeftHanded = useStore((s) => s.setLeftHanded);

  return (
    <div className="setting-block">
      <h3 className="setting-head" id="handedness-label">
        <PlectrumIcon size={18} className="setting-head-icon" />
        <span>Chord diagrams</span>
      </h3>
      <div className="handedness-options" role="radiogroup" aria-labelledby="handedness-label">
        {[false, true].map((left) => (
          <button
            key={String(left)}
            type="button"
            role="radio"
            aria-checked={leftHanded === left}
            className={leftHanded === left ? 'handedness-option is-on' : 'handedness-option'}
            onClick={() => setLeftHanded(left)}
          >
            <ChordDiagram chord="G" size={72} showFingers={false} flipped={left} />
            <span>{left ? 'Left handed' : 'Right handed'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
