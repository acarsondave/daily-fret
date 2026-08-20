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

/**
 * A fretboard with one position found on it.
 *
 * Same grammar as the note circle above: the structure quiet, the one thing
 * being pointed at at full weight. Three strings and two wires is the fewest
 * that reads as a neck rather than as a grid.
 */
export const FretMapIcon = (p: IconProps) => (
  <IconBase {...p}>
    <g opacity="0.34">
      <path d="M3.6 8h16.8M3.6 12h16.8M3.6 16h16.8" />
      <path d="M9.2 5.4v13.2M14.8 5.4v13.2" />
    </g>
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
  </IconBase>
);

/** The same neck, answered by a finger rather than by a played note. */
export const TapFretIcon = (p: IconProps) => (
  <IconBase {...p}>
    <g opacity="0.34">
      <path d="M4 14h16" />
      <path d="M9 9v10M15 9v10" />
    </g>
    <circle cx="12" cy="14" r="2.5" />
    <path d="M12 3.6v3.4" />
  </IconBase>
);
