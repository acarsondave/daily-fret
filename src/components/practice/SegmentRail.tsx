import clsx from 'clsx';
import './segmentRail.css';

/**
 * Where the session is, drawn as a neck.
 *
 * This replaces the line "Coached · 2 / 3", which was the only thing telling the
 * player how far through a routine they were: eleven pixels of uppercase in a
 * corner, on a screen read at arm's length with both hands on the guitar. A
 * fraction also has to be read and divided before it means anything, and the
 * question it answers is a shape question, not an arithmetic one.
 *
 * So it is the shape. A bone wire with one inlay per segment, which is what a
 * neck already does for a player looking for their place without counting: the
 * wire fills in the accent as far as the session has travelled, played segments
 * are solid inlays behind it, the one under way is lit, and what is left is
 * faint. It carries the whole session with no number and no label, and it is on
 * screen through every phase, including the ones a drill has taken over.
 */

interface Props {
  total: number;
  /** Zero-based position of the segment on screen. */
  index: number;
  /** True once the last segment is behind the player, so the rail reads as run through. */
  complete?: boolean;
  className?: string;
}

export function SegmentRail({ total, index, complete = false, className }: Props) {
  if (total <= 1) return null;
  const at = complete ? total : Math.min(index, total - 1);
  // The lit inlay sits at the head of the travelled length, so the fill runs to
  // the dot rather than through it. A finished session fills the whole neck.
  const travelled = complete ? 1 : total > 1 ? at / (total - 1) : 1;

  return (
    <div
      className={clsx('segment-rail', complete && 'is-complete', className)}
      role="img"
      aria-label={
        complete
          ? `All ${total} drills done.`
          : `Drill ${Math.min(index + 1, total)} of ${total}.`
      }
    >
      <span className="segment-rail-wire" aria-hidden="true" />
      <span
        className="segment-rail-run"
        aria-hidden="true"
        style={{ transform: `scaleX(${travelled.toFixed(4)})` }}
      />
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={clsx(
            'segment-rail-inlay',
            i < at && 'is-played',
            !complete && i === at && 'is-now',
          )}
          style={{ left: `${((i / (total - 1)) * 100).toFixed(4)}%` }}
        />
      ))}
    </div>
  );
}
