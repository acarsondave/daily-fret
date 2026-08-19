import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import './progressRing.css';

/**
 * What a run looks like against the run before it.
 *
 * The ring is a target, and `benchmark` puts the number to beat on it as a mark
 * on the circumference. Everything the results card used to say in a sentence is
 * then a length: the arc reaching past the mark is what a new best looks like,
 * the dashed run from the arc's end to the mark is what is left to beat it, and
 * a mark appearing where the arc stopped is a first benchmark being set.
 *
 * It is drawn during the run as well as after it, which is the point. A player
 * with a guitar in their hands can see how far off their best they are while
 * there is still time to do something about it, without reading anything.
 */

interface ProgressRingProps {
  progress: number; // 0..1
  /**
   * Where the best before this run sits, 0..1.
   *
   * Three different things, and they are deliberately not two: a number is a
   * best to aim at, `null` is a run that is scored but has no best yet and so
   * sets one, and leaving it off entirely is a ring that is not scoring
   * anything. The countdown on a timed block is the last of those, and it must
   * never grow a personal best out of a clock running down.
   */
  benchmark?: number | null;
  /**
   * 'live' tracks a count that is still climbing: it follows immediately and
   * never replays its entrance. 'result' is the card at the end, where the arc
   * draws itself once and the mark walks up to a new best after it lands.
   */
  phase?: 'live' | 'result';
  /** Intrinsic size. A stylesheet overrides it through --ring-size. */
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}

// Circular target ring. Stroke color is driven by `currentColor` so the parent
// can switch between accent and a celebratory hue with a single CSS class.
export function ProgressRing({
  progress,
  benchmark,
  phase = 'result',
  size = 220,
  stroke = 10,
  className,
  children,
}: ProgressRingProps) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const center = size / 2;
  const live = phase === 'live';

  // The three states the mark can be in, which are the three sentences it
  // replaces: nothing to beat, beaten, and not beaten yet.
  const scoring = benchmark !== undefined;
  const marked = typeof benchmark === 'number';
  const beaten = marked && clamped > benchmark;
  const shortfall = marked && clamped < benchmark;
  // A first run has no mark to draw until it has a number, and then the mark it
  // sets is exactly where it landed. That is a benchmark being set, drawn.
  const markAt = benchmark ?? clamped;
  const markVisible = scoring && (marked || (!live && clamped > 0));

  /**
   * A real arc rather than a dash offset around a full circle, because the gap
   * is drawn as a dashed line and one element cannot hold both a dash pattern
   * and its own extent on the same property.
   */
  const arcPath = (from: number, to: number): string => {
    const point = (at: number) => {
      const rad = (at * 360 - 90) * (Math.PI / 180);
      return [center + radius * Math.cos(rad), center + radius * Math.sin(rad)];
    };
    const [x0, y0] = point(from);
    const [x1, y1] = point(Math.min(to, from + 0.9999));
    const large = to - from > 0.5 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  return (
    // `size` is the intrinsic width and travels as its own property, because an
    // inline declaration beats every author rule without `!important`. Written
    // as `--ring-size` it silently outranked the stylesheet that claims to own
    // it, so `.om-ring-live`'s larger live ring and every media query that
    // shrinks a ring on a short frame had never once applied.
    <div
      className={clsx('progress-ring', className)}
      style={{ '--ring-intrinsic': `${size}px` } as CSSProperties}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />

        {/* What is left to beat it, drawn as the distance it is. */}
        {shortfall && (
          <path className="ring-gap" d={arcPath(clamped, benchmark)} strokeWidth={stroke} />
        )}

        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: live ? offset : circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={live ? { duration: 0.18, ease: 'linear' } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          transform={`rotate(-90 ${center} ${center})`}
        />

        {/* Everything past the best, in the colour the app keeps for a record.
            This length is the whole of "+7 over your best". */}
        {beaten && (
          <motion.path
            className="ring-over"
            d={arcPath(benchmark, clamped)}
            strokeWidth={stroke}
            initial={live ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: live ? 0 : 0.5 }}
          />
        )}

        {/* The best itself, across the track like a mark on a rule. It stays
            where it is while a run climbs towards it, so the player is aiming at
            a fixed place; on a first run it appears once the arc has landed,
            which is the only time this drill has ever had a mark to show. */}
        {markVisible && (
          <motion.g
            style={{ transformBox: 'view-box', transformOrigin: `${center}px ${center}px` }}
            initial={false}
            animate={{ rotate: markAt * 360, opacity: 1 }}
            transition={
              live || marked || reducedMotion
                ? { duration: 0 }
                : { duration: 0.5, delay: 0.85 }
            }
          >
            <line
              className="ring-mark"
              x1={center}
              y1={center - radius - stroke * 0.95}
              x2={center}
              y2={center - radius + stroke * 0.95}
            />
          </motion.g>
        )}
      </svg>
      <div className="progress-ring-face">{children}</div>
    </div>
  );
}
