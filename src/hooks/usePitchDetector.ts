import { useCallback, useEffect, useRef, useState } from 'react';
import { MicStream, MicError, type MicFailureKind, type MicRouteState } from '../audio/micStream';
import { PitchDetector, type PitchFrame } from '../audio/pitch';
import { centsBetween } from '../audio/tuning';
import { getPreferredMicId } from '../audio/micDevice';

/**
 * Every way the detector can be, and there is no state that means "wait and see".
 *
 * 'asleep' and 'muted' exist because they used to be invisible: the graph was
 * built, the permission was granted, and not one sample was arriving, which the
 * surface rendered identically to a quiet room. A tuner that cannot hear must
 * say so, and say which of the two it is, because only one of them is fixed by
 * touching the screen.
 */
export type PitchStatus = 'idle' | 'requesting' | 'listening' | 'asleep' | 'muted' | 'error';

export interface StablePitch {
  hz: number;
  clarity: number;
  /** True while the note has faded but the reading is still being shown. */
  fading: boolean;
}

/** A single analysis is trusted only above this periodicity. */
const CLARITY_MIN = 0.75;
/** Analyses combined into one displayed reading. */
const WINDOW = 5;
/** Readings needed before anything is shown. Trades ~140ms for a still needle. */
const MIN_SAMPLES = 3;
/** A jump this large is a different string, not noise — start the window over. */
const JUMP_CENTS = 120;
/** How long a reading survives after the note dies, so it can still be read. */
const HOLD_MS = 1400;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const STATUS_BY_ROUTE: Record<MicRouteState, PitchStatus> = {
  running: 'listening',
  asleep: 'asleep',
  muted: 'muted',
  closed: 'idle',
};

/**
 * Owns the mic and the pitch analyser for one component, and turns a stream of
 * per-analysis estimates into something steady enough to tune against.
 *
 * The raw estimator is accurate but twitchy; a needle that trembles reads as a
 * broken tuner even when it is right, so readings are median-filtered over a
 * short window. The live signal level is published through a ref rather than
 * state, because the display animates it at frame rate and re-rendering React
 * 40 times a second to move a wave would be absurd.
 */
export function usePitchDetector() {
  const micRef = useRef<MicStream | null>(null);
  const detectorRef = useRef<PitchDetector | null>(null);
  const historyRef = useRef<number[]>([]);
  const holdTimerRef = useRef<number | null>(null);
  /** Current input level, 0–1-ish. Read by rAF; never triggers a render. */
  const levelRef = useRef(0);

  const [status, setStatus] = useState<PitchStatus>('idle');
  const [failure, setFailure] = useState<MicFailureKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<StablePitch | null>(null);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const onAnalysis = useCallback((frame: PitchFrame) => {
    levelRef.current = frame.rms;

    if (frame.hz === null || frame.clarity < CLARITY_MIN) {
      // Don't blank immediately: a plucked note decays out of confidence in
      // under a second, and clearing the display the instant it does would mean
      // the reading vanishes exactly when the user looks up at it.
      if (holdTimerRef.current === null) {
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null;
          historyRef.current = [];
          setPitch(null);
        }, HOLD_MS);
      }
      setPitch((prev) => (prev && !prev.fading ? { ...prev, fading: true } : prev));
      return;
    }

    clearHold();

    const history = historyRef.current;
    if (history.length && Math.abs(centsBetween(frame.hz, history[history.length - 1])) > JUMP_CENTS) {
      history.length = 0;
    }
    history.push(frame.hz);
    if (history.length > WINDOW) history.shift();
    if (history.length < MIN_SAMPLES) return;

    const hz = median(history);
    setPitch((prev) =>
      prev && !prev.fading && prev.hz === hz && prev.clarity === frame.clarity
        ? prev
        : { hz, clarity: frame.clarity, fading: false },
    );
  }, [clearHold]);

  const stop = useCallback(async () => {
    clearHold();
    const mic = micRef.current;
    micRef.current = null;
    detectorRef.current = null;
    historyRef.current = [];
    levelRef.current = 0;
    setStatus('idle');
    setFailure(null);
    setPitch(null);
    await mic?.stop();
  }, [clearHold]);

  const start = useCallback(async (): Promise<boolean> => {
    if (micRef.current?.running) return true;
    setStatus('requesting');
    setFailure(null);
    setError(null);

    const mic = new MicStream();
    micRef.current = mic;
    try {
      await mic.start({
        deviceId: getPreferredMicId() ?? undefined,
        onReady: ({ sampleRate }) => {
          detectorRef.current = new PitchDetector(sampleRate);
        },
        onFrame: (frame) => {
          const result = detectorRef.current?.push(frame);
          if (result) onAnalysis(result);
        },
        onRouteChange: (route) => {
          // A stream that has already been replaced must not narrate over the
          // live one. Its own teardown is the last thing it gets to say.
          if (micRef.current !== mic) return;
          setStatus(STATUS_BY_ROUTE[route]);
          if (route === 'running') return;
          // No samples are arriving, so the fade timer that normally retires a
          // reading will never run. Leaving the last note on screen would be the
          // tuner reporting a string it can no longer hear.
          clearHold();
          historyRef.current = [];
          levelRef.current = 0;
          setPitch(null);
        },
      });
      // Opening the mic is several awaits long, and the component can unmount or
      // restart inside them. Only the stream still in the ref may set state.
      if (micRef.current !== mic) return false;
      setStatus(STATUS_BY_ROUTE[mic.routeState]);
      return true;
    } catch (err) {
      if (micRef.current !== mic) return false;
      micRef.current = null;
      detectorRef.current = null;
      const micError = err instanceof MicError ? err : null;
      setStatus('error');
      setFailure(micError?.kind ?? 'failed');
      setError(
        micError?.message ??
          (err instanceof Error && err.message ? err.message : 'The microphone could not be opened.'),
      );
      return false;
    }
  }, [onAnalysis, clearHold]);

  /** Call from inside a user gesture: the one moment WebKit will start a route. */
  const wake = useCallback(() => {
    micRef.current?.wake();
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      void micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  return { status, failure, error, pitch, levelRef, start, stop, wake };
}
