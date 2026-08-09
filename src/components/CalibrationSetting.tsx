import { useMemo, useState } from 'react';
import { CheckIcon, PencilIcon, PlectrumIcon, PlusIcon, TrashIcon } from './icons';
import { useStore, useUserData } from '../store';
import { CalibrationFlow } from './practice/CalibrationFlow';
import { activeProfileOf, profileIsUsable, profilesOf, readyChords } from '../lib/chordProfiles';

// Which guitar the detector is listening for, and its calibration.
//
// This used to be a single row saying "calibrated" or not, which quietly
// assumed one instrument. Picking up a second guitar then made every drill stop
// counting with nothing on screen to explain why, because the templates were
// still describing the first one. The list is the fix: the guitar in use is
// always named, and switching is one tap.
export function CalibrationSetting() {
  const account = useUserData();
  const addChordProfile = useStore((s) => s.addChordProfile);
  const setActiveChordProfile = useStore((s) => s.setActiveChordProfile);
  const renameChordProfile = useStore((s) => s.renameChordProfile);
  const deleteChordProfile = useStore((s) => s.deleteChordProfile);

  const [open, setOpen] = useState(false);
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

  return (
    <div className="mic-setting">
      <div className="mic-setting-head">
        <PlectrumIcon size={18} />
        <span>Your guitars</span>
      </div>

      {profiles.length === 0 ? (
        <div className="setting-note guitar-empty">
          Using the built-in templates. Calibrating teaches the detector how the
          chords sound on your instrument.
        </div>
      ) : (
        <ul className="guitar-list" role="radiogroup" aria-label="Guitar in use">
          {profiles.map((profile) => {
            const isActive = profile.id === active?.id;
            return (
              <li key={profile.id} className={`guitar-row${isActive ? ' is-active' : ''}`}>
                {renaming === profile.id ? (
                  <input
                    className="guitar-name-input"
                    // Not "Rename X": that is the button's name, and two
                    // controls answering to one name is a screen reader picking
                    // between them at random. Only one row renames at a time.
                    aria-label="Guitar name"
                    value={nameDraft}
                    autoFocus
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(null);
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
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="settings-action-btn" onClick={() => setOpen(true)}>
        <PlectrumIcon size={18} />
        <span>
          {active
            ? `${profileIsUsable(active) ? 'Recalibrate' : 'Calibrate'} ${active.label}`
            : 'Calibrate to your guitar'}
        </span>
      </button>

      {/* Only offered once one guitar exists. "Add another" before there is a
          first one is a question about a problem the user does not have yet. */}
      {profiles.length > 0 && (
        <button type="button" className="settings-action-btn" onClick={() => addChordProfile()}>
          <PlusIcon size={18} />
          <span>Add another guitar</span>
        </button>
      )}

      {open && <CalibrationFlow onClose={() => setOpen(false)} />}
    </div>
  );
}
