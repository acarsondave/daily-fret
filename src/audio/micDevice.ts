// Microphone input selection. The detector picks the system default device by
// default; this lets the player override it (e.g. a guitar-facing mic instead of
// a headset boom that only hears a faint, roomy signal). The choice persists so
// it survives reloads and applies to every drill.

const STORAGE_KEY = 'daily-fret-mic-device';

export interface MicInput {
  deviceId: string;
  label: string;
}

export function getPreferredMicId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setPreferredMicId(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Audio inputs the browser exposes. Labels are only populated once mic
// permission has been granted at least once, so call this after the first
// successful getUserMedia (the picker is shown on the live "playing" screen).
export async function listMicInputs(): Promise<MicInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
