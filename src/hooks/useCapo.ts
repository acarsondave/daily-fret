import { useUserData } from '../store';

/**
 * The capo's fret, as the semitone offset the detector needs.
 *
 * A capo moves every pitch up, so the chroma the detector sees for a "D shape"
 * with a capo on 2 is an E. `ChordDetector` already takes an offset to undo
 * that; nothing in the app had ever set it, so putting a capo on quietly broke
 * every listening drill and the player had no way to know why.
 */
export function useCapoOffset(): number {
  return useUserData().capoFret ?? 0;
}
