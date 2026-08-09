import { useState } from 'react';
import { PlectrumIcon } from './icons';
import { useUserData } from '../store';
import { CalibrationFlow } from './practice/CalibrationFlow';

// Account-settings entry for per-guitar detector calibration. Shows whether a
// calibration exists and launches the guided flow. Mirrors MicSetting's row look.
export function CalibrationSetting() {
  const calibration = useUserData().chordCalibration;
  const [open, setOpen] = useState(false);

  const chordCount = calibration ? Object.keys(calibration.chords ?? {}).length : 0;
  const status = calibration
    ? `Tuned to your guitar · ${chordCount} chords`
    : 'Using default templates';

  return (
    <div className="mic-setting">
      <div className="mic-setting-head">
        <PlectrumIcon size={18} />
        <span>Detector calibration</span>
      </div>
      <div className="cal-setting-status">{status}</div>
      <button type="button" className="settings-action-btn" onClick={() => setOpen(true)}>
        <PlectrumIcon size={18} />
        <span>{calibration ? 'Recalibrate detection' : 'Calibrate to your guitar'}</span>
      </button>
      {open && <CalibrationFlow onClose={() => setOpen(false)} />}
    </div>
  );
}
