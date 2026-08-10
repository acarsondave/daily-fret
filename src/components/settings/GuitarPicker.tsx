import { useMemo, useState } from 'react';
import { CheckIcon, PencilIcon, TrashIcon } from '../icons';
import { useStore, useUserData } from '../../store';
import { activeProfileOf, profileIsUsable, profilesOf, readyChords } from '../../lib/chordProfiles';

interface GuitarPickerProps {
  /** Renaming and deleting belong to the settings surface, not to the quick
      popover, where the only question is which guitar is in your hands. */
  manage?: boolean;
}

/**
 * Which guitar the detector is listening for.
 *
 * A calibration fitted to one guitar makes drills stop counting on another, and
 * that failure is silent, so the instrument in use is always named on screen and
 * switching is one tap.
 */
export function GuitarPicker({ manage = false }: GuitarPickerProps) {
  const account = useUserData();
  const setActiveChordProfile = useStore((s) => s.setActiveChordProfile);
  const renameChordProfile = useStore((s) => s.renameChordProfile);
  const deleteChordProfile = useStore((s) => s.deleteChordProfile);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const profiles = useMemo(() => profilesOf(account), [account]);
  const active = useMemo(() => activeProfileOf(account), [account]);

  const commitRename = () => {
    if (renaming) renameChordProfile(renaming, nameDraft);
    setRenaming(null);
  };

  const describe = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    const chords = readyChords(profile);
    if (!chords) return 'Not calibrated yet';
    // Says "one chord" rather than "calibrated" when one chord is all there is:
    // a single chord cannot produce a discriminative fit, so calling it
    // calibrated would promise something the detector will not deliver.
    if (!profileIsUsable(profile)) return '1 chord learned, needs a second';
    return `${chords} chords learned`;
  };

  if (profiles.length === 0) return null;

  return (
    <ul className="guitar-list" role="radiogroup" aria-label="Guitar in use">
      {profiles.map((profile) => {
        const isActive = profile.id === active?.id;
        return (
          <li key={profile.id} className={`guitar-row${isActive ? ' is-active' : ''}`}>
            {renaming === profile.id ? (
              <input
                className="guitar-name-input"
                // Not "Rename X": that is the button's name, and two controls
                // answering to one name is a screen reader picking between them
                // at random. Only one row renames at a time.
                aria-label="Guitar name"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    // Stops here, or the dialog behind this row closes too and
                    // an abandoned rename takes the whole surface with it.
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={isActive}
                className="guitar-pick"
                onClick={() => setActiveChordProfile(profile.id)}
              >
                <span className="guitar-mark" aria-hidden="true">
                  {isActive && <CheckIcon size={13} />}
                </span>
                <span className="guitar-text">
                  <span className="guitar-name">{profile.label}</span>
                  <span className="guitar-meta">{describe(profile.id)}</span>
                </span>
              </button>
            )}
            {manage && (
              <div className="guitar-row-tools">
                <button
                  type="button"
                  className="guitar-tool"
                  aria-label={`Rename ${profile.label}`}
                  onClick={() => {
                    setNameDraft(profile.label);
                    setRenaming(profile.id);
                  }}
                >
                  <PencilIcon size={14} />
                </button>
                <button
                  type="button"
                  className="guitar-tool is-danger"
                  aria-label={`Delete ${profile.label}`}
                  onClick={() => deleteChordProfile(profile.id)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
