import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, CheckIcon } from '../icons';
import { RecordingError, recoveryFor } from '../../media/failure';
import { useRecordingStore } from '../../media/recordingStore';
import './filmOffer.css';

/**
 * The camera, asked for on the one day it has earned the question.
 *
 * First run used to ask for a camera on day zero: before there was a session to
 * film, before the microphone had proved itself, and backed by three retention
 * promises a stranger had no way to check on their first minute in the app. It
 * was the second permission prompt in a flow that had not yet counted a note.
 *
 * So it moved here, to the sheet that opens when a session has just been
 * finished. The ask is specific now, because there is something specific to
 * point at: that session happened, the next one can be filmed. And it is
 * answered by seeing the actual shot rather than by reading a promise about it,
 * which is also the only honest way to make the promise: the video never leaves
 * the device, and the way to demonstrate that is to show it to you and to
 * nobody else.
 *
 * Asked once. A "no" here is a complete answer; Settings is where someone who
 * changes their mind goes.
 */

const DECLINED_KEY = 'daily-fret-film-declined';

function hasDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDeclined(): void {
  try {
    localStorage.setItem(DECLINED_KEY, '1');
  } catch {
    /* storage disabled; the offer reappears next time, which is survivable */
  }
}

export function FilmOffer() {
  const enabled = useRecordingStore((s) => s.settings.enabled);
  const setEnabled = useRecordingStore((s) => s.setEnabled);
  const [declined, setDeclined] = useState(hasDeclined);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<RecordingError | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Handing the camera back is unconditional and happens on every route out of
  // this sheet. An offer that leaves a webcam light on behind it has said one
  // thing and done another.
  const close = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => close, [close]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  // Yes is a single act: the browser prompt, the picture and the setting land
  // together, so nobody agrees to filming and then finds the browser said no.
  const accept = async () => {
    setOpening(true);
    setError(null);
    try {
      const [{ openCameraPreview }, { presetFor }] = await Promise.all([
        import('../../media/cameraDevice'),
        import('../../media/quality'),
      ]);
      const preset = presetFor(useRecordingStore.getState().settings.quality);
      const live = await openCameraPreview(null, preset.width, preset.height);
      streamRef.current = live;
      setStream(live);
      setEnabled(true);
    } catch (err) {
      setError(
        err instanceof RecordingError
          ? err
          : new RecordingError('failed', 'The camera could not be opened.'),
      );
    } finally {
      setOpening(false);
    }
  };

  const decline = () => {
    close();
    rememberDeclined();
    setDeclined(true);
  };

  if (declined || (enabled && !stream)) return null;

  if (stream) {
    return (
      <div className="film-offer is-live">
        <video ref={videoRef} className="film-offer-shot" autoPlay playsInline muted />
        <p className="film-offer-state" role="status">
          <CheckIcon size={16} /> Point it at your hands. It films from tomorrow, onto this device
          only.
        </p>
      </div>
    );
  }

  return (
    <div className="film-offer">
      {error ? (
        <>
          <p className="film-offer-state is-problem" role="status">
            The camera did not open.
          </p>
          <p className="film-offer-reason">{error.message}</p>
          <p className="film-offer-note">{recoveryFor(error.kind)}</p>
        </>
      ) : (
        <p className="film-offer-note">
          Daily Fret heard that session. It cannot see how your hands did it.
        </p>
      )}
      <div className="film-offer-actions">
        <button
          type="button"
          className="film-offer-btn is-primary"
          onClick={() => void accept()}
          disabled={opening}
        >
          <CameraIcon size={16} />
          {opening ? 'Waiting for the browser' : error ? 'Try again' : 'Film the next one'}
        </button>
        <button type="button" className="film-offer-btn" onClick={decline}>
          Not this
        </button>
      </div>
    </div>
  );
}
