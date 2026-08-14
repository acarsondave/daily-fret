// Which camera films the practice.
//
// The same shape as src/audio/micDevice.ts, and for the same reason: the built-in
// webcam points at your face, and a face is the one part of playing a guitar
// that tells you nothing. Anyone filming their hands is using a second camera,
// or a phone propped somewhere the laptop is not, and that choice has to
// survive a reload or they will re-make it every day and then stop.

import { RecordingError, describeCameraFailure } from './failure';

export interface CameraInput {
  deviceId: string;
  label: string;
}

/**
 * Cameras the browser will admit to.
 *
 * Labels are empty until camera permission has been granted at least once, so
 * the picker offers to ask (see RecordingSetting.tsx) rather than showing a
 * list of "Camera 1, Camera 2" and calling that a choice.
 */
export async function listCameras(): Promise<CameraInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** True once the browser is handing back real device names. */
export function camerasAreNamed(cameras: readonly CameraInput[]): boolean {
  return cameras.length > 0 && cameras.every((c) => !/^Camera \d+$/.test(c.label));
}

/**
 * The constraints for one camera at one size.
 *
 * `ideal` rather than `exact` throughout. A webcam that cannot do 1080p should
 * hand back 720p and let the session be filmed, not throw OverconstrainedError
 * and leave the player with no footage because a number in settings was
 * optimistic. The clip records what was actually captured.
 */
export function videoConstraints(deviceId: string | null, width: number, height: number): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
  };
  return deviceId ? { ...base, deviceId: { ideal: deviceId } } : base;
}

/**
 * A camera stream for looking at, not recording.
 *
 * The caller owns it and must stop its tracks. Used by the settings picker and
 * by the technique check's framing step, both of which need the player to see
 * the shot before anything is committed to disk. Framing a camera you cannot
 * see is the reason most self-filmed practice footage is a shot of a ceiling.
 */
export async function openCameraPreview(
  deviceId: string | null,
  width: number,
  height: number,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RecordingError(
      window.isSecureContext ? 'unsupported' : 'insecure',
      window.isSecureContext
        ? 'This browser cannot open a camera for this page.'
        : 'The camera is only available over a secure (https) connection.',
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(deviceId, width, height),
      audio: false,
    });
  } catch (err) {
    throw describeCameraFailure(err);
  }
}
