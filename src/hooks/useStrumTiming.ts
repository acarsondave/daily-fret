import { useCallback, useEffect, useRef, useState } from 'react';
import { TimingCapture } from '../audio/timingCapture';
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

    const capture = new TimingCapture();
    captureRef.current = capture;
    try {
      await capture.start({
        deviceId: getPreferredMicId() ?? undefined,
        label,
        onStrum: (onset) => handlersRef.current.onStrum?.(onset),
        onClick: (onset) => handlersRef.current.onClick?.(onset),
        onLevel: (level) => handlersRef.current.onLevel?.(level),
      });
      setStatus('running');
      return true;
    } catch (err) {
      captureRef.current = null;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Microphone access was denied.');
      return false;
    }
  }, []);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    setStatus('idle');
    await capture?.stop();
  }, []);

  useEffect(() => {
    return () => {
      void captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  return { status, error, start, stop, setHandlers };
}
