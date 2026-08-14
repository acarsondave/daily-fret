import { useEffect, useState } from 'react';
import { MediaClock, type TimeSource } from '../lib/mediaClock';
import {
  availableRatesOf,
  currentTimeOf,
  playbackRateOf,
  type YTPlayer,
} from '../lib/youtube';
import type { PlaybackPhase } from '../components/practice/YouTubePlayer';

/**
 * How often the player is asked what time it is.
 *
 * Four times a second. Every reading crosses into the embed and back, so this
 * is a cost, not a free measurement; the frames in between are interpolated. It
 * is also frequent enough that a drift correction is spread over several polls
 * rather than arriving as one visible nudge.
 */
export const POLL_MS = 250;

export interface PlayerClock {
  /** Read once per animation frame. Stable for the life of the hook. */
  time: TimeSource;
  /** True once the player has answered at all. Until then there is no chart. */
  ready: boolean;
  rate: number;
  /** Speeds this video offers, ascending. Empty until the player has answered. */
  rates: number[];
}

const sameRates = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((rate, i) => rate === b[i]);

/**
 * A smooth, always-current reading of the recording's playback position.
 *
 * The resync is driven off `phase` rather than off a timer: ads, buffering,
 * seeking and pausing all arrive as a state change from the player, and each of
 * them invalidates the projection outright. Re-running on the phase takes a
 * fresh reading at the exact moment the old one stopped being trustworthy,
 * which is what stops the chart running on through an ad break and coming back
 * thirty seconds ahead of the record.
 */
export function usePlayerClock(player: YTPlayer | null, phase: PlaybackPhase): PlayerClock {
  // Created once and held in state rather than in a ref, so the object handed
  // to the chart is the same one on every render and the chart's animation loop
  // is never torn down and rebuilt underneath a playing song.
  const [engine] = useState(() => {
    const clock = new MediaClock();
    const time: TimeSource = { read: () => clock.read(performance.now()) };
    return { clock, time };
  });

  const [sampled, setSampled] = useState(false);
  const [rate, setRate] = useState(1);
  const [rates, setRates] = useState<number[]>([]);

  useEffect(() => {
    if (!player) return;

    const read = () => {
      const mediaSeconds = currentTimeOf(player);
      const playerRate = playbackRateOf(player);
      // A reading we could not take is not a reading of zero. Skipping the
      // sample leaves the projection running on the last good one, which is
      // exactly right for a player mid-teardown or mid-load.
      if (mediaSeconds === null || playerRate === null) return null;
      engine.clock.sample({
        mediaSeconds,
        wallMs: performance.now(),
        playing: phase === 'playing',
        rate: playerRate,
      });
      return playerRate;
    };

    // The hard resync. A state change is the moment the projection stopped
    // being trustworthy, so it is corrected then rather than up to a poll later.
    read();

    const id = window.setInterval(() => {
      const playerRate = read();
      if (playerRate === null) return;
      setSampled(true);
      setRate((current) => (current === playerRate ? current : playerRate));
      setRates((current) => {
        const offered = availableRatesOf(player);
        if (!offered.length) return current;
        const sorted = [...offered].sort((a, b) => a - b);
        return sameRates(current, sorted) ? current : sorted;
      });
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [player, phase, engine]);

  return { time: engine.time, ready: sampled && player !== null, rate, rates };
}
