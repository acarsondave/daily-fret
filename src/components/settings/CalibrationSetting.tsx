import { useMemo } from 'react';
import { PlectrumIcon, PlusIcon } from '../icons';
import { useStore, useUserData } from '../../store';
import { activeProfileOf, profileIsUsable, profilesOf } from '../../lib/chordProfiles';
import { GuitarPicker } from './GuitarPicker';

interface CalibrationSettingProps {
  /**
   * Asks for calibration rather than rendering it. The flow listens to the
   * guitar for a minute or two, and this row lives inside a tab pane: owning
   * the flow here meant a change of tab, or closing settings, unmounted a
   * calibration mid-capture. The settings surface owns it instead.
   */
  onCalibrate: () => void;
}

// The guitars the detector knows, and their calibration. The list itself is
// GuitarPicker, because choosing the guitar in your hands is also a question the
// quick setup popover asks; everything around it here is management.
export function CalibrationSetting({ onCalibrate }: CalibrationSettingProps) {
  const account = useUserData();
  const addChordProfile = useStore((s) => s.addChordProfile);

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

      <button type="button" className="settings-action-btn" onClick={onCalibrate}>
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
    </div>
  );
}
