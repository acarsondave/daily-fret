import { useCallback, useRef, useState } from 'react';
import { CHROMA_SALIENCE_MIN, MIN_STRUM_RMS, type LevelEvent } from '../../audio/detector';
import type { TimingLevel } from '../../audio/timing';

export type SignalQuality = 'silent' | 'weak' | 'good' | 'loud';

// Derive a coarse mic-quality bucket from a detector level event. Detection is
// invisible when it fails, so this turns "nothing's registering" into something
// the player can act on (move closer, strum harder, switch mics if clipping).
// "good" is tied to the detector's own matching floor, so the meter agrees with
// reality instead of nagging "weak" while chords are actually being counted.
export function classifyLevel(ev: LevelEvent | null): SignalQuality {
  if (!ev || ev.chroma === null) return 'silent';
  if (ev.rms > 0.6) return 'loud';
  if (ev.salience < CHROMA_SALIENCE_MIN) return 'weak';
  return 'good';
}

/**
 * The same question for the strum-timing path, which has no chroma to ask about.
 *
 * Timing needs a *louder* signal than chord matching does, not a quieter one:
 * the attack detector works on how far the band level jumps, so a strum that is
 * only just above the room is a strum whose moment cannot be placed. The bar is
 * therefore the detector's own strum floor rather than a tonal one.
 */
export function classifyTimingLevel(level: TimingLevel | null): SignalQuality {
  if (!level) return 'silent';
  if (level.rms > 0.6) return 'loud';
  if (level.rms < Math.max(level.noiseFloor * 2, MIN_STRUM_RMS)) return 'silent';
  if (level.rms < MIN_STRUM_RMS * 2.5) return 'weak';
  return 'good';
}

// How long a new bucket must hold before we actually show it. Level events
// arrive ~40×/s and naturally jitter around the thresholds; without this dwell
// the meter strobes and looks broken.
const DWELL_MS = 400;

/**
 * A debounced quality, and the only place the dwell is implemented.
 *
 * Split out from `useSignalMeter` when the timing drill arrived needing the same
 * calm meter over a completely different measurement. The debounce is about how
 * a reading is shown, not about what it means, so it belongs to neither
 * classifier.
 */
function useQualityDwell() {
  const [quality, setQuality] = useState<SignalQuality>('silent');
  const currentRef = useRef<SignalQuality>('silent');
  const pendingRef = useRef<{ q: SignalQuality; since: number } | null>(null);

  const set = useCallback((q: SignalQuality) => {
    const now = Date.now();
    if (q === currentRef.current) {
      pendingRef.current = null;
      return;
    }
    if (!pendingRef.current || pendingRef.current.q !== q) {
      pendingRef.current = { q, since: now };
      return;
    }
    if (now - pendingRef.current.since >= DWELL_MS) {
      currentRef.current = q;
      pendingRef.current = null;
      setQuality(q);
    }
  }, []);

  const reset = useCallback(() => {
    currentRef.current = 'silent';
    pendingRef.current = null;
    setQuality('silent');
  }, []);

  return { quality, set, reset };
}

// Debounced mic-quality state for the chord drills. Feed it level events via
// `push`; the returned `quality` only changes once a different bucket has
// persisted past DWELL_MS, so the meter stays calm and readable.
export function useSignalMeter() {
  const { quality, set, reset } = useQualityDwell();
  const push = useCallback((ev: LevelEvent | null) => set(classifyLevel(ev)), [set]);
  return { quality, push, reset };
}

/** The same meter, fed by the strum-timing analyser. */
export function useTimingSignalMeter() {
  const { quality, set, reset } = useQualityDwell();
  const push = useCallback((level: TimingLevel | null) => set(classifyTimingLevel(level)), [set]);
  return { quality, push, reset };
}
