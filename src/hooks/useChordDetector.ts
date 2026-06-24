import { useCallback, useEffect, useRef, useState } from 'react';
import { ChordCapture } from '../audio/capture';
import type { DetectorHandlers } from '../audio/detector';

export type DetectorStatus = 'idle' | 'requesting' | 'running' | 'error';

// Owns a single ChordCapture instance for a component. Handlers are read
// through a ref so the latest closures (and component state) are used without
// tearing down the audio graph.
export function useChordDetector() {
  const captureRef = useRef<ChordCapture | null>(null);
  const handlersRef = useRef<DetectorHandlers>({});
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const setHandlers = useCallback((handlers: DetectorHandlers) => {
    handlersRef.current = handlers;
  }, []);

  const start = useCallback(async (handlers: DetectorHandlers) => {
    handlersRef.current = handlers;
    if (captureRef.current?.running) {
      setStatus('running');
      return;
    }
    setStatus('requesting');
    setError(null);

    const capture = new ChordCapture();
    captureRef.current = capture;
    try {
      await capture.start({
        onChord: (e) => handlersRef.current.onChord?.(e),
        onOnset: (e) => handlersRef.current.onOnset?.(e),
        onLevel: (e) => handlersRef.current.onLevel?.(e),
      });
      setStatus('running');
    } catch (err) {
      captureRef.current = null;
      setStatus('error');
      setError(
        err instanceof Error ? err.message : 'Microphone access was denied.',
      );
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
