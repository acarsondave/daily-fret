import { useCallback, useEffect, useRef } from 'react';
import type { SignalQuality } from './signalQuality';

/**
 * The readings that mean the drill was not being heard properly.
 *
 * Weak and unreadable are the two the meter reports over a microphone that is
 * failing rather than a player who is quiet, and `lost` is the input going away
 * entirely. Silence is deliberately not one of them: a player who stops for a
 * few seconds mid-run is silent, and counting that as a microphone fault would
 * let an ordinary pause excuse a bad number.
 */
const UNHEARD = ['weak', 'unreadable', 'lost'] as const;

type UnheardQuality = (typeof UNHEARD)[number];

const isUnheard = (q: SignalQuality): q is UnheardQuality =>
  (UNHEARD as readonly SignalQuality[]).includes(q);

/**
 * How much of a run the microphone spent unreadable, and which way.
 *
 * `useSignalMeter` already decides, several times a second, whether the input is
 * usable. Nothing kept the answer: it drew a meter and was forgotten, so a run
 * taken through a failing microphone reached the day's record indistinguishable
 * from a run played badly. This is the memory that was missing.
 *
 * Time, not frames. The meter dwells on a reading for as long as it holds, and a
 * share of the run's seconds is what the judgement in lib/unheardRun.ts is
 * written against.
 */
export function useUnheardShare(quality: SignalQuality, running: boolean) {
  const heardRef = useRef(0);
  const unheardRef = useRef<Record<UnheardQuality, number>>({ weak: 0, unreadable: 0, lost: 0 });
  const sinceRef = useRef(0);
  const stateRef = useRef({ quality, running });

  /**
   * Close the span that was open and start a new one.
   *
   * Called both when the reading changes and when the caller asks for the share,
   * because a run ends from inside its own timer while the last reading is still
   * standing. Without the second call that final span, which on a drill that
   * degraded at the end is the most telling one, would never be counted.
   */
  const settle = useCallback(() => {
    const now = Date.now();
    const previous = stateRef.current;
    if (previous.running && sinceRef.current > 0) {
      const elapsed = now - sinceRef.current;
      if (isUnheard(previous.quality)) unheardRef.current[previous.quality] += elapsed;
      else heardRef.current += elapsed;
    }
    sinceRef.current = now;
  }, []);

  useEffect(() => {
    settle();
    stateRef.current = { quality, running };
  }, [quality, running, settle]);

  const unheardMs = () => UNHEARD.reduce((sum, q) => sum + unheardRef.current[q], 0);

  /** 0 when the run was heard throughout, 1 when it never was. */
  const share = useCallback(() => {
    settle();
    const total = heardRef.current + unheardMs();
    return total > 0 ? unheardMs() / total : 0;
  }, [settle]);

  /**
   * Which failure the run mostly suffered, or null if it did not suffer one.
   *
   * Reads the buckets without touching them, so a results screen can ask during
   * render. The meter that draws this already carries the right words for each:
   * a weak signal and a signal nothing matches call for opposite responses from
   * the player, and lumping them into one "bad microphone" would lose that.
   */
  const verdict = useCallback((): SignalQuality | null => {
    let worst: UnheardQuality | null = null;
    for (const q of UNHEARD) {
      if (unheardRef.current[q] === 0) continue;
      if (worst === null || unheardRef.current[q] > unheardRef.current[worst]) worst = q;
    }
    return worst;
  }, []);

  const reset = useCallback(() => {
    heardRef.current = 0;
    unheardRef.current = { weak: 0, unreadable: 0, lost: 0 };
    sinceRef.current = Date.now();
  }, []);

  return { share, verdict, reset };
}
