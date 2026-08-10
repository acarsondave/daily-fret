import { useEffect, useState } from 'react';
import { MicIcon } from '../icons';
import { listMicInputs, getPreferredMicId, setPreferredMicId, type MicInput } from '../../audio/micDevice';

// Which input the drills open. The drills read the saved preference when they
// open the mic. Device names only appear after mic access is granted, so we
// offer a button to unlock the labels.
export function MicSetting() {
  const [devices, setDevices] = useState<MicInput[]>([]);
  const [selected, setSelected] = useState<string>(getPreferredMicId() ?? '');
  const [unlocking, setUnlocking] = useState(false);

  const refresh = () => {
    void listMicInputs().then(setDevices);
  };

  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, []);

  // Before mic permission, labels fall back to "Microphone N". Detect that so we
  // can prompt the user to unlock real names.
  const hasRealNames = devices.length > 0 && devices.every((d) => !/^Microphone \d+$/.test(d.label));

  const unlockNames = async () => {
    setUnlocking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refresh();
    } catch {
      /* denied, so the generic names stand */
    } finally {
      setUnlocking(false);
    }
  };

  const handleChange = (id: string) => {
    setSelected(id);
    setPreferredMicId(id);
  };

  return (
    <div className="setting-block">
      <h3 className="setting-head" id="mic-setting-label">
        <MicIcon size={18} className="setting-head-icon" />
        <span>Microphone</span>
      </h3>
      <select
        className="mic-setting-select"
        aria-labelledby="mic-setting-label"
        value={devices.some((d) => d.deviceId === selected) ? selected : ''}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">System default</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      {!hasRealNames && (
        <button type="button" className="mic-setting-unlock" onClick={unlockNames} disabled={unlocking}>
          {unlocking ? 'Detecting…' : 'Allow mic access to see device names'}
        </button>
      )}
    </div>
  );
}
