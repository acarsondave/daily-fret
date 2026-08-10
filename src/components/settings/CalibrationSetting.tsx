import { useMemo, useState } from 'react';
import { PlectrumIcon, PlusIcon } from '../icons';
import { useStore, useUserData } from '../../store';
import { CalibrationFlow } from '../practice/CalibrationFlow';
import { activeProfileOf, profileIsUsable, profilesOf } from '../../lib/chordProfiles';
import { GuitarPicker } from './GuitarPicker';

// The guitars the detector knows, and their calibration. The list itself is
// GuitarPicker, because choosing the guitar in your hands is also a question the
// quick setup popover asks; everything around it here is management.
export function CalibrationSetting() {
  const account = useUserData();
  const addChordProfile = useStore((s) => s.addChordProfile);

  const [open, setOpen] = useState(false);

  const profiles = useMemo(() => profilesOf(account), [account]);
  const active = useMemo(() => activeProfileOf(account), [account]);

  return (
    <div className="setting-block">
      <h3 className="setting-head">
        <PlectrumIcon size={18} className="setting-head-icon" />
        <span>Your guitars</span>
      </h3>

      {profiles.length === 0 ? (
        <p className="setting-note">
          Using the built-in templates. Calibrating teaches the detector how the
          chords sound on your instrument.
        </p>
      ) : (
        <GuitarPicker manage />
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
