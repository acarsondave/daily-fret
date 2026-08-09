import { useCallback, useEffect, useRef, useState } from 'react';
import { MicStream } from '../audio/micStream';
import { PitchDetector, type PitchFrame } from '../audio/pitch';
import { centsBetween } from '../audio/tuning';
import { getPreferredMicId } from '../audio/micDevice';

export type PitchStatus = 'idle' | 'requesting' | 'listening' | 'error';

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
    setPitch(null);
    await mic?.stop();
  }, [clearHold]);

  const start = useCallback(async (): Promise<boolean> => {
    if (micRef.current?.running) return true;
    setStatus('requesting');
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
      });
      setStatus('listening');
      return true;
    } catch (err) {
      micRef.current = null;
      detectorRef.current = null;
      setStatus('error');
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : err instanceof Error
            ? err.message
            : 'The microphone could not be opened.',
      );
      return false;
    }
  }, [onAnalysis]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      void micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  return { status, error, pitch, levelRef, start, stop };
}
