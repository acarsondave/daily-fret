import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon } from '../icons';
import { RecordingError, recoveryFor } from '../../media/failure';
import { camerasAreNamed, listCameras, openCameraPreview, type CameraInput } from '../../media/cameraDevice';
import { filmingDayKey } from '../../media/cadence';
import { useRecordingStore } from '../../media/recordingStore';
import './filmNotice.css';

/**
 * The camera says so before it rolls.
 *
 * A camera that opens without warning is the one thing this feature cannot do
 * and keep the player's trust, and it is the moment where credibility outranks
 * everything else on the surface. So on the first session of a filming day, and
 * only the first, the shot arrives before the drill does.
 *
 * It is the shot rather than a sentence about the shot, and that is not a
 * flourish: the same picture does all three jobs the player needs here. It is
 * proof the camera is on, in the only form that cannot be doubted. It is the
 * framing check, so hands that would have been out of frame for the whole
 * session are found now. And it is the device check, because the wrong webcam
 * plugged in is instantly obvious as the wrong room. A paragraph asking someone
 * to verify those things is the same information with the evidence removed.
 *
 * Once a day, never once a session. The second run of the same day has already
 * been told, and asking again would be the app performing consent rather than
 * getting it.
 */

/** The preview only has to be good enough to see the room and the hands. */
const PREVIEW_W = 640;
const PREVIEW_H = 360;

interface Props {
  /**
   * Fired once the player has answered, either way.
   *
   * Optional, because answering writes the day into the recording store and
   * every surface showing this is subscribed to it: the notice clears itself.
   * The hook exists for a surface that has its own phase to advance.
   */
  onAnswered?: () => void;
}

export function FilmNotice({ onAnswered }: Props) {
  const cameraId = useRecordingStore((s) => s.settings.cameraId);
  const setCameraId = useRecordingStore((s) => s.setCameraId);
  const answerFilmNotice = useRecordingStore((s) => s.answerFilmNotice);

  const [cameras, setCameras] = useState<CameraInput[]>([]);
  const [error, setError] = useState<RecordingError | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Handing the camera back is unconditional and happens on every route out of
  // here. A notice that leaves a webcam light on behind it has said one thing
  // and done another.
  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      release();
      try {
        const stream = await openCameraPreview(cameraId, PREVIEW_W, PREVIEW_H);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setError(null);
        if (videoRef.current) videoRef.current.srcObject = stream;
        // Named devices only exist once a camera has been granted, so the list
        // is read after the preview rather than before it.
        setCameras(await listCameras());
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof RecordingError ? err : new RecordingError('failed', 'The camera did not open.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraId, release]);

  useEffect(() => {
    const timer = setTimeout(() => headingRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const answer = (film: boolean) => {
    release();
    answerFilmNotice(film, filmingDayKey(Date.now()));
    onAnswered?.();
  };

  const named = camerasAreNamed(cameras);

  return (
    <div className="film-notice" role="dialog" aria-modal="true" aria-labelledby="film-notice-title">
      <h2 className="film-notice-title" id="film-notice-title" ref={headingRef} tabIndex={-1}>
        Today is a filming day.
      </h2>

      {error ? (
        <div className="film-notice-problem">
          <p className="film-notice-reason" role="status">{error.message}</p>
          <p className="film-notice-recovery">{recoveryFor(error.kind)}</p>
        </div>
      ) : (
        /* The proof, the framing check and the device check, in one picture.
           Mirrored, because a preview of yourself that moves the wrong way is
           unusable for setting a shot up. */
        <video ref={videoRef} className="film-notice-shot" autoPlay playsInline muted />
      )}

      {/* Only where the choice exists. One camera is not a decision, and a
          picker naming a single device is a control that does nothing. */}
      {cameras.length > 1 && (
        <div className="film-notice-cameras" role="radiogroup" aria-label="Camera">
          {cameras.map((camera, i) => (
            <button
              key={camera.deviceId}
              type="button"
              role="radio"
              aria-checked={camera.deviceId === cameraId}
              className={`film-notice-camera${camera.deviceId === cameraId ? ' is-on' : ''}`}
              onClick={() => setCameraId(camera.deviceId)}
            >
              {named ? camera.label : `Camera ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="film-notice-actions">
        <button type="button" className="film-notice-btn is-primary" onClick={() => answer(true)} autoFocus>
          <CameraIcon size={16} /> Start
        </button>
        {/* A decision about today, not a setting. It expires by being a date, so
            nobody has to remember to turn filming back on next week. */}
        <button type="button" className="film-notice-btn" onClick={() => answer(false)}>
          Not today
        </button>
      </div>

      <p className="film-notice-where">Kept on this device. Nothing is uploaded.</p>
    </div>
  );
}
