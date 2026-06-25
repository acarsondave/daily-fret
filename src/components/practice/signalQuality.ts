import type { LevelEvent } from '../../audio/detector';

export type SignalQuality = 'silent' | 'weak' | 'good' | 'loud';

// Derive a coarse mic-quality bucket from a detector level event. Detection is
// invisible when it fails, so this turns "nothing's registering" into something
// the player can act on (move closer, strum harder, back off if clipping).
export function classifyLevel(ev: LevelEvent | null): SignalQuality {
  if (!ev || ev.chroma === null) return 'silent';
  if (ev.rms > 0.6) return 'loud';
  if (ev.salience < 1.5) return 'weak';
  return 'good';
}
