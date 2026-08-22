import { useCallback, useEffect, useRef, useState } from 'react';
import { TimingCapture } from '../audio/timingCapture';
import type { MicRouteState } from '../audio/micStream';
import type { TimingHandlers } from '../audio/timing';
import { getPreferredMicId } from '../audio/micDevice';

export type TimingStatus = 'idle' | 'requesting' | 'running' | 'error';

// Owns a single TimingCapture for a component, the same way useChordDetector
// owns a ChordCapture. Handlers are read through a ref so the latest closures
// are used without tearing the audio graph down and losing the analyser's clock
// with it, which for this drill would restart the beat grid mid-run.
export function useStrumTiming() {
  const captureRef = useRef<TimingCapture | null>(null);
  const handlersRef = useRef<TimingHandlers>({});
  const [status, setStatus] = useState<TimingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // What the input is actually doing, as opposed to whether opening it worked.
  // The chord path has carried this since a revoked microphone was found to go
  // unnoticed mid-drill; this one did not, so a timing run whose input died
  // stayed 'running' over an analyser that had stopped receiving anything.
  const [route, setRoute] = useState<MicRouteState | null>(null);

  const setHandlers = useCallback((handlers: TimingHandlers) => {
    handlersRef.current = handlers;
  }, []);

  /** Resolves true once the mic is live, false if access failed or was denied. */
  const start = useCallback(async (handlers: TimingHandlers, label?: string): Promise<boolean> => {
    handlersRef.current = handlers;
    if (captureRef.current?.running) {
      setStatus('running');
      return true;
    }
    setStatus('requesting');
    setError(null);
    setRoute(null);

    const capture = new TimingCapture();
    captureRef.current = capture;
    try {
      await capture.start({
        deviceId: getPreferredMicId() ?? undefined,
        label,
        onStrum: (onset) => handlersRef.current.onStrum?.(onset),
        onClick: (onset) => handlersRef.current.onClick?.(onset),
        onLevel: (level) => handlersRef.current.onLevel?.(level),
        onRouteChange: setRoute,
      });
      // See useChordDetector: only the capture still in the ref may report, and
      // an open that has been abandoned has to answer `false` so the drill that
      // asked for it does not start a clock behind an overlay that has closed.
      if (captureRef.current !== capture) return false;
      setStatus('running');
      return true;
    } catch (err) {
      if (captureRef.current !== capture) return false;
      captureRef.current = null;
      setRoute(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Microphone access was denied.');
      return false;
    }
  }, []);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    setStatus('idle');
    setRoute(null);
    await capture?.stop();
  }, []);

  useEffect(() => {
    return () => {
      void captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  return { status, route, error, start, stop, setHandlers };
}
