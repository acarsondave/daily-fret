// Loading the tuner is its own small piece of product, so it has its own file.
//
// It used to be `lazy()` behind a bare `<Suspense fallback={<Loader label="Listening…" />}>`,
// which failed in two ways at once. A chunk that never arrived left that overlay
// up forever with no close button, saying the app was listening while it was in
// fact fetching JavaScript; and a chunk that failed outright threw past the
// Suspense into the app-level ErrorBoundary, replacing the user's whole screen
// with "Something broke" because a tuner did not download. Both are reproducible
// by stalling or refusing the chunk (tests/browser/tuner.mjs).
//
// Suspense cannot express either recovery: it has no timeout and no retry. So
// the import is driven here, where waiting is bounded, failure is named, and
// there is always a way out.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader } from '../Loader';
import { CloseIcon, RetryIcon } from '../icons';
import { loadTuner, type TunerComponent } from './tunerChunk';
import './tunerGate.css';

/** How long a normal open may take before the surface stops pretending. */
const SLOW_MS = 5000;

type Phase = 'loading' | 'slow' | 'failed';

interface Props {
  onClose: () => void;
}

export function TunerLauncher({ onClose }: Props) {
  const [Tuner, setTuner] = useState<TunerComponent | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const retriedRef = useRef(false);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const slowTimer = window.setTimeout(() => {
      if (liveRef.current) setPhase('slow');
    }, SLOW_MS);

    loadTuner().then(
      (component) => {
        if (liveRef.current) setTuner(() => component);
      },
      (err: unknown) => {
        if (!liveRef.current) return;
        console.error('The tuner failed to load', err);
        // One silent retry, for the case where the request was dropped rather
        // than refused. Past that, the honest answer is that this build's tuner
        // is not reachable and only a reload will fetch a current one.
        if (!retriedRef.current) {
          retriedRef.current = true;
          setPhase('loading');
          setAttempt((n) => n + 1);
          return;
        }
        setPhase('failed');
      },
    );

    return () => clearTimeout(slowTimer);
  }, [attempt]);

  // Escape closes the gate. A full-screen wait the keyboard cannot dismiss is
  // the trap this whole file exists to remove.
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    if (Tuner) return; // once mounted the tuner owns Escape itself
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [Tuner, close]);

  if (Tuner) return <Tuner onClose={onClose} />;

  return createPortal(
    <div className="tuner-gate" role="dialog" aria-modal="true" aria-label="Opening the tuner">
      <button type="button" className="tuner-gate-close" onClick={close} aria-label="Close">
        <CloseIcon size={20} />
      </button>

      {phase === 'failed' ? (
        <div className="tuner-gate-panel">
          <p className="tuner-gate-title">The tuner did not load.</p>
          <p className="tuner-gate-body">
            Its part of the app could not be fetched. This is usually a dropped
            connection, or a newer version having been released while this page
            was open. Reloading gets the current one.
          </p>
          <div className="tuner-gate-actions">
            <button
              type="button"
              className="tuner-gate-btn is-primary"
              onClick={() => window.location.reload()}
            >
              <RetryIcon size={17} /> Reload
            </button>
            <button type="button" className="tuner-gate-btn" onClick={close}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Never "Listening…". Nothing is listening yet; this is a download. */}
          <Loader label="Opening the tuner" />
          {phase === 'slow' && (
            <div className="tuner-gate-panel is-quiet">
              <p className="tuner-gate-body">
                This is taking longer than it should. Your connection may have
                dropped.
              </p>
              <div className="tuner-gate-actions">
                <button
                  type="button"
                  className="tuner-gate-btn"
                  onClick={() => window.location.reload()}
                >
                  <RetryIcon size={17} /> Reload
                </button>
                <button type="button" className="tuner-gate-btn" onClick={close}>
                  Not now
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
