import type { TechniqueView } from '../../media/types';

/**
 * Where to put the camera, drawn rather than described.
 *
 * "Film your fretting hand" is the instruction everyone has already failed to
 * follow: the phone goes on the music stand, straight on, and the fretting hand
 * spends the whole clip hidden behind the player's own wrist. Three sentences
 * of prose do not fix that, because the thing being described is a position in
 * a room and prose is the wrong medium for a position in a room.
 *
 * So each angle gets a diagram of the shot it is asking for, laid over the live
 * picture at the same aspect ratio, and the player matches one to the other.
 * The marks are drawn on the app's own grid at the app's own weight; the guide
 * is part of the interface, not an illustration dropped into it.
 */

interface Props {
  view: TechniqueView;
  /** Drawn in when the angle changes, then held. */
  animate: boolean;
}

const COMMON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function TechniqueGuide({ view, animate }: Props) {
  return (
    <svg
      className={animate ? 'tc-guide is-drawing' : 'tc-guide'}
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {/* The frame edge every angle shares: keep the whole thing inside this. */}
      <rect
        x="8"
        y="6"
        width="144"
        height="78"
        rx="6"
        {...COMMON}
        strokeWidth={1.2}
        strokeDasharray="4 5"
        className="tc-guide-edge"
      />
      {view === 'front' && <Front />}
      {view === 'neck' && <Neck />}
      {view === 'strumming' && <Strumming />}
    </svg>
  );
}

// Seated, square to the lens: head, shoulders, the guitar's body low and right,
// the neck raking up and left. Both hands land inside the frame, which is the
// only thing this angle has to get right.
function Front() {
  return (
    <g className="tc-guide-art">
      <circle cx="80" cy="24" r="9" {...COMMON} />
      <path d="M62 50c2-9 8-14 18-14s16 5 18 14" {...COMMON} />
      <ellipse cx="92" cy="62" rx="19" ry="15" {...COMMON} />
      <circle cx="92" cy="62" r="5.5" {...COMMON} />
      <path d="M77 55 44 40" {...COMMON} />
      <path d="M74 61 41 46" {...COMMON} />
      <path d="M41 46 44 40" {...COMMON} />
      {/* Both hands, marked, because "both hands in shot" is the whole ask. */}
      <circle cx="57" cy="47" r="5" {...COMMON} strokeDasharray="3 3" className="tc-guide-hand" />
      <circle cx="92" cy="62" r="9" {...COMMON} strokeDasharray="3 3" className="tc-guide-hand" />
    </g>
  );
}

// Over the fretting shoulder, sighting along the strings. The neck converges
// away from the lens; the frets are the rungs. This is the angle that shows a
// finger sitting behind the fret instead of on top of it, and no other angle
// can.
function Neck() {
  return (
    <g className="tc-guide-art">
      <path d="M40 84 66 18" {...COMMON} />
      <path d="M120 84 88 18" {...COMMON} />
      <path d="M45 70h68" {...COMMON} />
      <path d="M52 54h50" {...COMMON} />
      <path d="M58 40h37" {...COMMON} />
      <path d="M63 28h26" {...COMMON} />
      <circle cx="72" cy="62" r="4.6" {...COMMON} strokeDasharray="3 3" className="tc-guide-hand" />
      <circle cx="86" cy="47" r="4.2" {...COMMON} strokeDasharray="3 3" className="tc-guide-hand" />
    </g>
  );
}

// From the picking side, level with the sound hole and close in. The arc is the
// sweep: what this angle is for is seeing how far the wrist travels and where
// it turns round.
function Strumming() {
  return (
    <g className="tc-guide-art">
      <ellipse cx="66" cy="48" rx="30" ry="26" {...COMMON} />
      <circle cx="72" cy="46" r="11" {...COMMON} />
      <path d="M96 40 132 26" {...COMMON} />
      <path d="M96 54 132 40" {...COMMON} />
      <path d="M132 26l0 14" {...COMMON} />
      <path d="M88 22c10 10 10 38 0 48" {...COMMON} strokeDasharray="4 4" className="tc-guide-sweep" />
      <path d="M84 66c1.6-2.6 4.4-2.6 6 0-1.6 3.2-4.4 3.2-6 0Z" {...COMMON} className="tc-guide-hand" />
    </g>
  );
}
