import { useCallback, useEffect, useRef, useState } from 'react';
import { ChordCapture } from '../audio/capture';
import type { DetectorHandlers } from '../audio/detector';
import type { LearnedTemplates } from '../audio/chords';
import { getPreferredMicId, setPreferredMicId } from '../audio/micDevice';

export type DetectorStatus = 'idle' | 'requesting' | 'running' | 'error';

type StartOptions = { restrictTo?: string[]; offset?: number; templates?: LearnedTemplates };

// Owns a single ChordCapture instance for a component. Handlers are read
// through a ref so the latest closures (and component state) are used without
// tearing down the audio graph.
export function useChordDetector() {
  const captureRef = useRef<ChordCapture | null>(null);
  const handlersRef = useRef<DetectorHandlers>({});
  const optionsRef = useRef<StartOptions | undefined>(undefined);
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const setHandlers = useCallback((handlers: DetectorHandlers) => {
    handlersRef.current = handlers;
  }, []);

  // Resolves to true once the mic is live, false if access failed/was denied.
  const start = useCallback(async (
    handlers: DetectorHandlers,
    options?: StartOptions,
  ): Promise<boolean> => {
    handlersRef.current = handlers;
    optionsRef.current = options;
    if (captureRef.current?.running) {
      captureRef.current.setRestrict(options?.restrictTo ?? null);
      setStatus('running');
      return true;
    }
    setStatus('requesting');
    setError(null);

    const capture = new ChordCapture();
    captureRef.current = capture;
    try {
      await capture.start({
        deviceId: getPreferredMicId() ?? undefined,
        restrictTo: options?.restrictTo,
        offset: options?.offset,
        templates: options?.templates,
        onChord: (e) => handlersRef.current.onChord?.(e),
        onOnset: (e) => handlersRef.current.onOnset?.(e),
        onLevel: (e) => handlersRef.current.onLevel?.(e),
      });
      setStatus('running');
      return true;
    } catch (err) {
      captureRef.current = null;
      setStatus('error');
      setError(
        err instanceof Error ? err.message : 'Microphone access was denied.',
      );
      return false;
    }
  }, []);

  // Switch the active input device. Persists the choice and, if a capture is
  // live, restarts it on the new device with the same handlers/restriction.
  const switchDevice = useCallback(async (deviceId: string): Promise<void> => {
    setPreferredMicId(deviceId);
    if (!captureRef.current?.running) return;
    const handlers = handlersRef.current;
    const options = optionsRef.current;
    const prev = captureRef.current;
    captureRef.current = null;
    await prev.stop();
    await start(handlers, options);
  }, [start]);

  const setRestrict = useCallback((chords: string[] | null) => {
    captureRef.current?.setRestrict(chords);
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

  return { status, error, start, stop, setHandlers, setRestrict, switchDevice };
}

export type ChordDetectorApi = ReturnType<typeof useChordDetector>;
