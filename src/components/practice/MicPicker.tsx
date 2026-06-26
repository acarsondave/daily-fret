import { useEffect, useState } from 'react';
import { Microphone, CaretDown } from '@phosphor-icons/react';
import { listMicInputs, getPreferredMicId, type MicInput } from '../../audio/micDevice';

interface Props {
  onSwitch: (deviceId: string) => void;
}

// Browser labels are verbose ("Default - MacBook Pro Microphone (Built-in)").
// Trim the OS prefix and trailing qualifier so the control stays compact.
function shortLabel(label: string): string {
  return label
    .replace(/^(default|communications)\s*-\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || label;
}

// Lets the player pick which input the detector listens to. Only renders once
// more than one input exists (after permission is granted, so labels are real).
export function MicPicker({ onSwitch }: Props) {
  const [devices, setDevices] = useState<MicInput[]>([]);
  const [selected, setSelected] = useState<string>(getPreferredMicId() ?? '');

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listMicInputs().then((d) => {
        if (active) setDevices(d);
      });
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  if (devices.length < 2) return null;

  // Keep the control's value matching a real option even when no preference is
  // stored yet (the system default), so it never desyncs.
  const value = devices.some((d) => d.deviceId === selected)
    ? selected
    : devices[0].deviceId;

  const handleChange = (deviceId: string) => {
    setSelected(deviceId);
    onSwitch(deviceId);
  };

  return (
    <label className="mic-picker" title="Choose which microphone to listen to">
      <Microphone size={14} weight="fill" className="mic-picker-icon" />
      <select
        className="mic-picker-select"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {shortLabel(d.label)}
          </option>
        ))}
      </select>
      <CaretDown size={12} weight="bold" className="mic-picker-caret" />
    </label>
  );
}
