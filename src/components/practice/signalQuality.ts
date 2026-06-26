import { useCallback, useRef, useState } from 'react';
import { CHROMA_SALIENCE_MIN, type LevelEvent } from '../../audio/detector';

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

// How long a new bucket must hold before we actually show it. Level events
// arrive ~40×/s and naturally jitter around the thresholds; without this dwell
// the meter strobes and looks broken.
const DWELL_MS = 400;

// Debounced mic-quality state. Feed it level events via `push`; the returned
// `quality` only changes once a different bucket has persisted past DWELL_MS,
// so the meter stays calm and readable.
export function useSignalMeter() {
  const [quality, setQuality] = useState<SignalQuality>('silent');
  const currentRef = useRef<SignalQuality>('silent');
  const pendingRef = useRef<{ q: SignalQuality; since: number } | null>(null);

  const push = useCallback((ev: LevelEvent | null) => {
    const q = classifyLevel(ev);
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

  return { quality, push, reset };
}
