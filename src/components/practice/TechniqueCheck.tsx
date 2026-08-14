import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, CameraIcon, CheckCircleIcon, CloseIcon, RecordIcon } from '../icons';
import { containFocus, pushOverlay } from '../overlayStack';
import { getTodayString } from '../../store';
import { openCameraPreview } from '../../media/cameraDevice';
import { RecordingError, recoveryFor } from '../../media/failure';
import { formatMegabytes, presetFor } from '../../media/quality';
import { PracticeRecorder } from '../../media/recorder';
import { fileRecording, useRecordingStore } from '../../media/recordingStore';
import { TECHNIQUE_VIEWS, type Recording, type TechniqueView } from '../../media/types';
import { TechniqueGuide } from './TechniqueGuide';
// The shell this surface sits in, imported directly rather than through
// practice.css, which is the entry point for the five drill stylesheets and
// pulls 35 kB behind it that a camera screen has no use for. The tuner made the
// same choice; what it did not do, and what the shell's own comment warns
// about, is forget the import altogether and render as an ordinary block laid
// out below the fold. Both stylesheets are needed, and both are named here.
import './overlayShell.css';
import './recording.css';

/**
 * A deliberate look at your own hands, from the three angles that actually show
 * something.
 *
 * This is the part of the feature that earns the rest of it. Session recording
 * is passive: it accumulates footage nobody has time to watch. A technique check
 * is seventy-five seconds, filmed on purpose, from angles chosen because each
 * one answers a question the others cannot, and the clips are small enough to
 * keep forever. They are the ones a later analysis pass reads, and they are the
 * ones worth sending to a teacher.
 *
 * The design problem is not the recording, it is the framing. Anyone can film
 * themselves; almost nobody films their fretting hand, because the obvious
 * camera position is the one that hides it. So each angle is shown as a drawing
 * over the live picture and the player matches the two, rather than reading a
 * paragraph and guessing.
 */

const CLIP_SECONDS = 25;

interface ViewCopy {
  title: string;
  place: string;
  shows: string;
}

const VIEW_COPY: Record<TechniqueView, ViewCopy> = {
  front: {
    title: 'Straight on',
    place: 'Camera at chest height, an arm and a half away, square to you.',
    shows: 'Posture, both hands at once, and whether the neck is drooping towards the floor.',
  },
  neck: {
    title: 'Down the neck',
    place: 'Camera just over your fretting shoulder, sighting along the strings towards the sound hole.',
    shows: 'Where each finger lands. This is the only angle that shows a fingertip sitting behind the fret rather than on it.',
  },
  strumming: {
    title: 'From the strumming side',
    place: 'Camera out to your picking side, level with the sound hole and close in.',
    shows: 'How far the wrist travels, where the strum turns round, and how deep the pick is digging.',
  },
};

type Phase = 'intro' | 'framing' | 'filming' | 'done';

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function TechniqueCheck({ onClose }: { onClose: () => void }) {
  const quality = useRecordingStore((s) => s.settings.quality);
  const cameraId = useRecordingStore((s) => s.settings.cameraId);

  const [phase, setPhase] = useState<Phase>('intro');
  const [viewIdx, setViewIdx] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<RecordingError | null>(null);
  const [saved, setSaved] = useState<Recording[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(CLIP_SECONDS);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<PracticeRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // All three angles are one session, so the library can offer them together.
  const sessionRef = useRef<string | null>(null);
  if (sessionRef.current === null) sessionRef.current = newId();

  const view = TECHNIQUE_VIEWS[Math.min(viewIdx, TECHNIQUE_VIEWS.length - 1)];
  const copy = VIEW_COPY[view];
  const isLast = viewIdx >= TECHNIQUE_VIEWS.length - 1;

  // Read through a ref so the one-shot effect below never holds a stale exit.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // The layer, the key and the scroll lock, on the same terms as every other
  // full-attention surface in this app.
  useEffect(() => {
    const overlay = pushOverlay();
    if (surfaceRef.current) surfaceRef.current.style.zIndex = String(overlay.layer);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (!overlay.isTop()) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const surface = surfaceRef.current;
      if (surface) containFocus(surface, e);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      overlay.release();
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // Every exit lands here, so this is the one place the camera is given
      // back, and it is unconditional. A half-recorded clip is thrown away
      // rather than filed: a technique check is three angles or it is nothing.
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) void recorder.cancel();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Keep the ref and the state in step, so teardown can reach the stream
  // without the effect above depending on it and re-running.
  useEffect(() => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  const openCamera = useCallback(async () => {
    setOpening(true);
    setError(null);
    try {
      const preset = presetFor(quality);
      const live = await openCameraPreview(cameraId, preset.width, preset.height);
      setStream(live);
      setPhase('framing');
    } catch (err) {
      setError(err instanceof RecordingError ? err : new RecordingError('failed', 'The camera could not be opened.'));
    } finally {
      setOpening(false);
    }
  }, [cameraId, quality]);

  // One clip is finished with. Filed, then on to the next angle. Guarded by
  // nulling the ref first, so the recorder's own end-of-clip signal and a tap
  // on "Stop early" cannot both file the same take.
  const finishClip = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    const clip = await recorder.stop();
    if (clip) {
      await fileRecording(clip);
      setSaved((prev) => [...prev, clip]);
    }
    setViewIdx((idx) => {
      if (idx >= TECHNIQUE_VIEWS.length - 1) {
        setPhase('done');
        return idx;
      }
      setPhase('framing');
      return idx + 1;
    });
  }, []);

  const startClip = useCallback(async () => {
    if (!stream) return;
    const recorder = new PracticeRecorder();
    recorderRef.current = recorder;
    setSecondsLeft(CLIP_SECONDS);
    try {
      await recorder.start(
        {
          sessionId: sessionRef.current ?? newId(),
          kind: 'technique-check',
          date: getTodayString(),
          taskId: null,
          routineId: null,
          label: VIEW_COPY[view].title,
          view,
          // Starred at birth. These are the deliberate ones, and nothing that
          // runs in the background is allowed to decide they have expired.
          starred: true,
          durationMs: CLIP_SECONDS * 1000,
          quality,
          cameraId,
          videoStream: stream,
        },
        {
          onFailure: setError,
          onEnded: () => void finishClip(),
        },
      );
      setPhase('filming');
    } catch {
      // Already reported through onFailure; the surface stays on the framing
      // step so the player can try the same angle again.
      recorderRef.current = null;
    }
  }, [stream, view, quality, cameraId, finishClip]);

  useEffect(() => {
    if (phase !== 'filming') return;
    const deadline = Date.now() + CLIP_SECONDS * 1000;
    const id = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 200);
    return () => clearInterval(id);
  }, [phase, viewIdx]);

  const totalBytes = saved.reduce((sum, r) => sum + r.bytes, 0);
  const progress = phase === 'filming' ? 1 - secondsLeft / CLIP_SECONDS : 0;

  return createPortal(
    <motion.div
      className="practice-overlay tc-overlay"
      ref={surfaceRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label="Technique check"
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">
          Technique check
          {phase !== 'intro' && phase !== 'done' && ` · ${viewIdx + 1} of ${TECHNIQUE_VIEWS.length}`}
        </span>
        <div className="practice-topbar-actions">
          {phase === 'filming' && (
            <span className="capture-pill">
              <RecordIcon size={14} className="capture-pill-mark" />
              <span className="capture-pill-word">Recording</span>
              <span className="capture-pill-clock">{secondsLeft}s</span>
            </span>
          )}
          <button className="practice-close" onClick={onClose} title="Exit (Esc)" aria-label="Exit the technique check">
            <CloseIcon size={20} />
          </button>
        </div>
      </div>

      {phase === 'filming' && <span className="capture-frame" aria-hidden="true" />}

      <div className="practice-body tc-body">
        {phase === 'intro' && (
          <motion.div
            className="tc-intro"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="tc-title">Three angles, seventy-five seconds.</h2>
            <p className="tc-lead">
              Play anything you are working on. The app films twenty-five seconds from each of three
              positions, and shows you where to put the camera for each one.
            </p>
            <ol className="tc-angle-list">
              {TECHNIQUE_VIEWS.map((v, i) => (
                <li key={v} className="tc-angle">
                  <span className="tc-angle-mark" aria-hidden="true">
                    <TechniqueGuide view={v} animate={false} />
                  </span>
                  <span className="tc-angle-text">
                    <span className="tc-angle-name">
                      {i + 1}. {VIEW_COPY[v].title}
                    </span>
                    <span className="tc-angle-shows">{VIEW_COPY[v].shows}</span>
                  </span>
                </li>
              ))}
            </ol>
            {/* Said before the camera opens, not after. These clips outlive
                everything else the feature records, and that is a promise, so
                it is made where it can still be declined. */}
            <p className="tc-promise">
              These three are kept until you delete them. Nothing else the app records can push them
              out, and they never leave this device.
            </p>
            {error ? (
              <div className="tc-error" role="alert">
                <p className="tc-error-head">{error.message}</p>
                <p className="tc-error-help">{recoveryFor(error.kind)}</p>
                <button type="button" className="tc-btn is-ghost" onClick={() => void openCamera()}>
                  Try again
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="tc-btn is-primary tc-start"
                onClick={() => void openCamera()}
                disabled={opening}
                autoFocus
              >
                <CameraIcon size={18} />
                {opening ? 'Opening the camera…' : 'Set up the first angle'}
              </button>
            )}
          </motion.div>
        )}

        {(phase === 'framing' || phase === 'filming') && (
          <div className="tc-stage">
            <div className={clsx('tc-shot', phase === 'filming' && 'is-live')}>
              {/* Never mirrored. A mirrored guitar is a left-handed guitar, and
                  the whole point of this clip is reading which finger is where. */}
              <video ref={videoRef} className="tc-video" autoPlay playsInline muted />
              <TechniqueGuide view={view} animate={phase === 'framing'} />
              {phase === 'filming' && (
                <span
                  className="tc-progress"
                  style={{ transform: `scaleX(${progress})` }}
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="tc-instruction">
              <h2 className="tc-shot-title">{copy.title}</h2>
              <p className="tc-shot-place">{copy.place}</p>
              {phase === 'framing' ? (
                <>
                  <p className="tc-shot-shows">{copy.shows}</p>
                  <button type="button" className="tc-btn is-primary" onClick={() => void startClip()} autoFocus>
                    <RecordIcon size={18} /> {isLast ? 'Film the last angle' : 'Film this angle'}
                  </button>
                </>
              ) : (
                <>
                  <p className="tc-shot-shows" role="status">
                    Playing. {secondsLeft} second{secondsLeft === 1 ? '' : 's'} left.
                  </p>
                  <button type="button" className="tc-btn is-ghost" onClick={() => void finishClip()}>
                    Stop this one early
                  </button>
                </>
              )}
              {error && (
                <div className="tc-error" role="alert">
                  <p className="tc-error-head">{error.message}</p>
                  <p className="tc-error-help">{recoveryFor(error.kind)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <motion.div
            className="tc-intro"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="tc-title">
              {saved.length === TECHNIQUE_VIEWS.length ? 'All three are saved.' : 'Saved what was filmed.'}
            </h2>
            <ul className="tc-saved">
              {saved.map((clip) => (
                <li key={clip.id} className="tc-saved-row">
                  <CheckCircleIcon size={18} className="tc-saved-mark" />
                  <span className="tc-saved-name">{clip.label}</span>
                  <span className="tc-saved-size">
                    {Math.round(clip.durationMs / 1000)}s · {formatMegabytes(clip.bytes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tc-promise">
              {formatMegabytes(totalBytes)} in total, on this device. Delete them whenever you like
              from Settings, under Practice video.
            </p>
            <button type="button" className="tc-btn is-primary tc-start" onClick={onClose} autoFocus>
              Done <ArrowRightIcon size={16} />
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
