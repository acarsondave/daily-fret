// Why the camera is not recording, in terms the surface can act on.
//
// Modelled on src/audio/micStream.ts, for the same reason: every one of these
// has a different way out, and collapsing them into "recording failed" leaves
// the user reading instructions that do not apply to them. A permission the
// browser is holding, a camera someone unplugged, and a disk that is full are
// three different afternoons.
//
// The rule this file exists to keep: a failed recording never takes a practice
// session down with it. The session is the product; the recording is a
// passenger. Every one of these is reported beside the drill and none of them
// stops it.

export type RecordingFailureKind =
  | 'insecure' // not https, so the browser hides the camera entirely
  | 'unsupported' // no getUserMedia or no MediaRecorder in this browser
  | 'no-codec' // MediaRecorder exists but will not write any format we can read
  | 'denied' // the user, or a system setting, refused
  | 'no-camera' // nothing is plugged in
  | 'camera-busy' // another app or tab holds the camera
  | 'device-lost' // it went away part-way through a recording
  | 'quota' // the disk, or the browser's share of it, is full
  | 'storage' // any other failure writing the file
  | 'failed'; // anything else, message preserved

export class RecordingError extends Error {
  readonly kind: RecordingFailureKind;

  constructor(kind: RecordingFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RecordingError';
    this.kind = kind;
  }
}

/**
 * What to do about it, in one sentence.
 *
 * Kept beside the failure rather than at each call site so the same problem
 * reads the same way in settings, in onboarding and mid-drill. An error that
 * names the problem and not the recovery is a dead end with punctuation.
 */
export function recoveryFor(kind: RecordingFailureKind): string {
  switch (kind) {
    case 'insecure':
      return 'Open the app over https and the camera becomes available again.';
    case 'unsupported':
      return 'Practice still runs as normal. Recording needs a newer browser, or Chrome, Firefox or Safari on a desktop.';
    case 'no-codec':
      return 'Practice still runs as normal. This browser has no video format the app can save.';
    case 'denied':
      return 'Allow the camera for this site in your browser settings, then turn recording back on.';
    case 'no-camera':
      return 'Plug a camera in, or use a device with one, and try again.';
    case 'camera-busy':
      return 'Close whatever else is using the camera, such as another tab or a video call, and try again.';
    case 'device-lost':
      return 'Everything filmed up to that point was kept. Plug the camera back in before the next session.';
    case 'quota':
      return 'Delete some recordings, or keep fewer sessions, to make room.';
    case 'storage':
      return 'Practice was not affected. Try recording again, and if it keeps failing, delete the stored recordings.';
    case 'failed':
      return 'Practice was not affected. Try turning recording off and on again.';
  }
}

/** Turn whatever getUserMedia threw into something with a way out. */
export function describeCameraFailure(err: unknown): RecordingError {
  if (err instanceof RecordingError) return err;
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new RecordingError('denied', 'The browser is not letting this page use the camera.', { cause: err });
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new RecordingError('no-camera', 'No camera was found on this device.', { cause: err });
      case 'NotReadableError':
      case 'AbortError':
        return new RecordingError('camera-busy', 'The camera is busy, most likely in another app or tab.', { cause: err });
      case 'NotSupportedError':
        return new RecordingError('unsupported', 'This browser cannot open a camera for this page.', { cause: err });
      default:
        return new RecordingError('failed', err.message || 'The camera could not be opened.', { cause: err });
    }
  }
  return new RecordingError(
    'failed',
    err instanceof Error && err.message ? err.message : 'The camera could not be opened.',
    { cause: err },
  );
}

/**
 * Turn whatever a write threw into something with a way out.
 *
 * QuotaExceededError is the one that matters: it is the difference between
 * "this is broken" and "you are out of room", and only one of those has an
 * action attached to it.
 */
export function describeStorageFailure(err: unknown): RecordingError {
  if (err instanceof RecordingError) return err;
  const quota =
    (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NotAllowedError')) ||
    (err instanceof Error && /quota/i.test(err.message));
  if (quota) {
    return new RecordingError('quota', 'There is no room left on this device for another recording.', { cause: err });
  }
  return new RecordingError(
    'storage',
    err instanceof Error && err.message ? err.message : 'The recording could not be saved.',
    { cause: err },
  );
}
