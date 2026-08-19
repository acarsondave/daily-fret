import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import { ChordDiagram } from './ChordDiagram';
import { StrumRow } from './StrumRow';
import { SweepIcon, SwapIcon } from '../icons';
import type { CoachSegment } from '../../lib/coached';

/**
 * What is coming, shown instead of named.
 *
 * The announce and rest screens between drills used to be a caption: "Am ↔ Em",
 * "Next: Anchor rotation · D → A → E". A chord name is the one thing a beginner
 * cannot act on with their hands; a shape is. Both screens are dead air the
 * player spends holding the guitar, which makes them the best place in the whole
 * session to put the shapes up, and the drill that follows draws exactly these
 * boxes, so the hand is already on the first one when it starts.
 *
 * A block with no chords shows what it does have: a strum pattern is drawn as
 * arrows, and a block with neither shows nothing rather than a placeholder.
 */

interface Props {
  segment: CoachSegment;
  size?: number;
  className?: string;
  /**
   * Shown only when there is nothing to draw. The announce screen used to carry
   * a caption naming the chords under the shapes it had just drawn and
   * labelled, which is the same statement twice; the words are the fallback for
   * a segment that cannot be pictured, never a caption on one that can.
   */
  fallback?: ReactNode;
}

export function SegmentCue({ segment, size = 84, className, fallback = null }: Props) {
  const shapes =
    segment.kind === 'changes'
      ? [segment.from, segment.to]
      : segment.kind === 'trainer' || segment.kind === 'rotation'
        ? segment.chords
        : [];

  if (shapes.length > 0) {
    // The separator says which exercise this is before a word of it is read:
    // a changes drill swaps between two shapes, a rotation sweeps along a path.
    const Separator = segment.kind === 'rotation' ? SweepIcon : SwapIcon;
    return (
      <div className={clsx('coach-cue', className)}>
        {shapes.map((chord, i) => (
          <span key={`${chord}-${i}`} className="coach-cue-shape">
            {i > 0 && <Separator size={16} className="coach-cue-sep" />}
            <span className="coach-cue-stack">
              <ChordDiagram chord={chord} size={size} showFingers={false} />
              <span className="coach-cue-name">{chord}</span>
            </span>
          </span>
        ))}
      </div>
    );
  }

  if (segment.kind === 'timed' && segment.pattern) {
    return (
      <div className={clsx('coach-cue', className)}>
        <StrumRow strum={segment.pattern} size={22} />
      </div>
    );
  }

  return <>{fallback}</>;
}

/**
 * The moment before a drill starts, drawn.
 *
 * This replaces the words "Get ready…", which were standing in for a count the
 * app could not yet make: when the coach voice is on, the spoken announcement
 * decides when the drill begins and its length is not known here. Three beats
 * with a light travelling across them says the same thing without claiming a
 * duration, and it hands over to the real count without changing shape, so the
 * silent 3·2·1 fallback lands on the same three beats that were already there.
 */
export function CountIn({ at }: { at: number }) {
  // `at` is the silent fallback's countdown: 3, 2, 1, and 0 while the coach is
  // still talking. Filled beats are the ones already counted.
  const counting = at > 0;
  const filled = counting ? 3 - at + 1 : 0;
  return (
    <div
      className={counting ? 'count-in is-counting' : 'count-in'}
      role="status"
      aria-label={counting ? `Starting in ${at}` : 'Starting'}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={clsx('count-in-beat', i < filled && 'is-lit')}
          style={{ '--beat': i } as CSSProperties}
        />
      ))}
    </div>
  );
}
