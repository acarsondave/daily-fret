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
  /**
   * True until enough analyses agree. The reading is the best answer available
   * and is shown, because a display that lags a string change by a tenth of a
   * second reads as a broken tuner; but nothing irreversible may be decided on
   * it, because the string it names has only just started sounding.
   */
  provisional: boolean;
  /**
   * Set when a second string is ringing at this whole multiple of `hz`. The
   * reading is then the period the two share and not an identification of
   * either, so no verdict may be given while it holds.
   */
  secondNoteAt: number | null;
}

/** A single analysis is trusted only above this periodicity. */
const CLARITY_MIN = 0.75;
/** Analyses combined into one displayed reading. */
const WINDOW = 5;
/** Analyses that must agree before a reading stops being provisional. */
const MIN_SAMPLES = 3;
/** A jump this large is a different string, not noise — start the window over. */
const JUMP_CENTS = 120;
/** How long a reading survives after the note dies, so it can still be read. */
const HOLD_MS = 1400;
/**
 * Analyses in the window that must see a second note before the tuner says so.
 *
 * A single flagged analysis is not evidence: a quiet tail in a noisy room throws
 * one every so often. Three of five is: two strings ringing together flag almost
 * every analysis for as long as they both sound.
 */
const SECOND_NOTE_MIN = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The multiple most of the window agrees on, or null if it does not agree. */
function agreedSecondNote(window: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  let flagged = 0;
  for (const multiple of window) {
    if (multiple === null) continue;
    flagged++;
    counts.set(multiple, (counts.get(multiple) ?? 0) + 1);
  }
  if (flagged < SECOND_NOTE_MIN) return null;
  let best: number | null = null;
  let bestCount = 0;
  for (const [multiple, count] of counts) {
    if (count > bestCount) {
      best = multiple;
      bestCount = count;
    }
  }
  return best;
}

const STATUS_BY_ROUTE: Record<MicRouteState, PitchStatus> = {
  running: 'listening',
  asleep: 'asleep',
  muted: 'muted',
  // A route that has gone reads as idle, because that is what the display has
  // to do with it: there is nothing to show. It is not what a drill has to do
  // with it, and the two cannot be told apart from this word — a detector that
  // has not been started yet is 'idle' as well. Anything that has to know the
  // difference reads `route`, which says 'closed' only when an input that was
  // open has stopped being one.
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
  const secondNoteRef = useRef<(number | null)[]>([]);
  const holdTimerRef = useRef<number | null>(null);
  /** Current input level, 0–1-ish. Read by rAF; never triggers a render. */
  const levelRef = useRef(0);

  const [status, setStatus] = useState<PitchStatus>('idle');
  /**
   * What the input is actually doing, as opposed to what the display should say.
   *
   * The chord path has carried this since a revoked microphone was found to go
   * unnoticed mid-drill; this one collapsed it into `status`, where 'closed' and
   * 'never opened' are the same word. The note finder is the drill that pays for
   * that: its own microphone-lost path could not fire, so a run whose input died
   * showed a permission prompt for a permission it already had, kept its clock,
   * and filed the count as a measured run.
   */
  const [route, setRoute] = useState<MicRouteState | null>(null);
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
          secondNoteRef.current = [];
          setPitch(null);
        }, HOLD_MS);
      }
      setPitch((prev) => (prev && !prev.fading ? { ...prev, fading: true } : prev));
      return;
    }

    clearHold();

    const history = historyRef.current;
    const secondNotes = secondNoteRef.current;
    if (history.length && Math.abs(centsBetween(frame.hz, history[history.length - 1])) > JUMP_CENTS) {
      // A different string is sounding. Everything the window holds describes
      // the previous one, and holding on to any of it is how the tuner came to
      // sit on a stale note long enough to call it done while the player was
      // already on the next string.
      history.length = 0;
      secondNotes.length = 0;
    }
    history.push(frame.hz);
    secondNotes.push(frame.secondNoteAt);
    if (history.length > WINDOW) history.shift();
    if (secondNotes.length > WINDOW) secondNotes.shift();

    const hz = median(history);
    const provisional = history.length < MIN_SAMPLES;
    const secondNoteAt = agreedSecondNote(secondNotes);
    setPitch((prev) =>
      prev &&
      !prev.fading &&
      prev.hz === hz &&
      prev.clarity === frame.clarity &&
      prev.provisional === provisional &&
      prev.secondNoteAt === secondNoteAt
        ? prev
        : { hz, clarity: frame.clarity, fading: false, provisional, secondNoteAt },
    );
  }, [clearHold]);

  const stop = useCallback(async () => {
    clearHold();
    const mic = micRef.current;
    micRef.current = null;
    detectorRef.current = null;
    historyRef.current = [];
    secondNoteRef.current = [];
    levelRef.current = 0;
    setStatus('idle');
    setRoute(null);
    setFailure(null);
    setPitch(null);
    await mic?.stop();
  }, [clearHold]);

  const start = useCallback(async (): Promise<boolean> => {
    if (micRef.current?.running) return true;
    setStatus('requesting');
    setRoute(null);
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
        onRouteChange: (next) => {
          // A stream that has already been replaced must not narrate over the
          // live one. Its own teardown is the last thing it gets to say.
          if (micRef.current !== mic) return;
          setRoute(next);
          setStatus(STATUS_BY_ROUTE[next]);
          if (next === 'running') return;
          // No samples are arriving, so the fade timer that normally retires a
          // reading will never run. Leaving the last note on screen would be the
          // tuner reporting a string it can no longer hear.
          clearHold();
          historyRef.current = [];
          secondNoteRef.current = [];
          levelRef.current = 0;
          setPitch(null);
        },
      });
      // Opening the mic is several awaits long, and the component can unmount or
      // restart inside them. Only the stream still in the ref may set state.
      if (micRef.current !== mic) return false;
      setRoute(mic.routeState);
      setStatus(STATUS_BY_ROUTE[mic.routeState]);
      return true;
    } catch (err) {
      if (micRef.current !== mic) return false;
      micRef.current = null;
      detectorRef.current = null;
      const micError = err instanceof MicError ? err : null;
      setRoute(null);
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

  return { status, route, failure, error, pitch, levelRef, start, stop, wake };
}
