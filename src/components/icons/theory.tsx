import { IconBase, type IconProps } from './Icon';

// Marks for the things a player knows rather than plays. Same 24 grid and the
// same 1.75 pen as the rest of the set.

/**
 * The twelve notes as a closed loop, with a span measured across part of it.
 *
 * The loop is drawn quiet and the span is drawn at full weight, because the
 * surface behind this mark is not "here are the notes" but "how far is it from
 * one to another". The dot is where the span lands.
 */
export const NoteCircleIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.4" opacity="0.34" />
    <path d="M12 3.6a8.4 8.4 0 0 1 7.27 12.6" />
    <circle cx="19.27" cy="16.2" r="1.8" fill="currentColor" stroke="none" />
  </IconBase>
);
