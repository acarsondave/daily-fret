import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { PlayIcon } from '../icons';
import { getTodayString, useDrillLogs } from '../../store';
import { readLedger } from '../../lib/ledger';
import { isFirstViewToday } from '../../lib/firstView';
import './dayLedger.css';

/**
 * What the practice has actually produced, on the screen it is produced from.
 *
 * Every measurement this app takes used to live behind the Progress button,
 * which is a place people go once they already believe there is something to
 * see. On day zero nobody believes that, so the one screen a new player opens
 * said nothing at all about the thing that makes this app different from a
 * checklist.
 *
 * Three states, and the difference between them is the whole design:
 *
 * - Nothing measured. The figures are underscores, not zeros. An underscore is
 *   a space held open; a zero is a measurement, and it means the drill ran and
 *   nothing was heard. One line says what will fill them, and there is exactly
 *   one thing to press.
 * - One session in. The figures are there. Nothing to compare them to yet, so
 *   nothing is claimed about them.
 * - A second session. The lead is the delta, because the delta is the only news:
 *   a number you have already seen is not news, and "welcome back" is not news
 *   either. It names the drill and the day it beat, so it can be checked.
 *
 * The figures count up out of their underscores once a day. Not on every render
 * and not on every visit: a confirmation that replays is decoration.
 */

interface Props {
  /** Run the whole routine, guided. Null when there is nothing to run. */
  onStart: (() => void) | null;
}

export function DayLedger({ onStart }: Props) {
  const dailyLogs = useDrillLogs();
  const today = getTodayString();
  const reducedMotion = useReducedMotion();
  const [ledger] = useState(() => readLedger(dailyLogs));
  // Read once per mount rather than on every render: whether this is the first
  // look today is a fact about the visit, not about the paint.
  const [animate] = useState(() => isFirstViewToday(today) && !reducedMotion);

  const empty = ledger.daysMeasured === 0;

  if (empty) {
    return (
      <section className="ledger is-empty" aria-label="Your numbers">
        <div className="ledger-figures">
          <Figure value={null} unit="changes a minute" animate={false} />
          <Figure value={null} unit="shapes placed" animate={false} />
          <Figure value={null} unit="days measured" animate={false} />
        </div>
        <p className="ledger-line">Nothing measured yet. The first run sets the bar.</p>
        {onStart && (
          <button type="button" className="ledger-start" onClick={onStart}>
            <PlayIcon size={16} /> Start the session
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="ledger" aria-label="Your numbers">
      {ledger.delta && (
        // The news, first, and specific enough to be wrong. A general "you are
        // improving" cannot be checked by the person reading it.
        <p className={clsx('ledger-line', 'is-delta', ledger.delta.change < 0 && 'is-down')}>
          <span className="ledger-delta-value">
            {ledger.delta.change > 0 ? '+' : ''}
            {ledger.delta.change}
          </span>{' '}
          {ledger.delta.unit} on {ledger.delta.label} since {shortDay(ledger.delta.since)}
        </p>
      )}
      <div className="ledger-figures">
        <Figure value={ledger.bestChanges} unit="changes a minute" animate={animate} />
        <Figure value={ledger.bestPlaced} unit="shapes placed" animate={animate} />
        <Figure value={ledger.daysMeasured} unit="days measured" animate={animate} />
      </div>
    </section>
  );
}

/**
 * One figure, and the space it will occupy before it exists.
 *
 * The count is drawn rather than reported: the number arrives at its value the
 * way it was earned, one at a time, and lands. It is the only motion on this
 * block and it happens once a day.
 */
function Figure({
  value,
  unit,
  animate,
}: {
  value: number | null;
  unit: string;
  animate: boolean;
}) {
  // Starts at the underscore only when it is going to count out of it. Where
  // there is no animation the figure is simply the figure, from the first paint.
  const [shown, setShown] = useState<number | null>(() =>
    animate && value !== null ? null : value,
  );
  const frame = useRef(0);

  useEffect(() => {
    if (!animate || value === null) return;
    const started = performance.now();
    const run = (now: number) => {
      const t = Math.min(1, (now - started) / 620);
      // Exponential ease-out, the same curve the rest of the app moves on: fast
      // out of the underscore, settling onto the number rather than stopping.
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(value * eased));
      if (t < 1) frame.current = requestAnimationFrame(run);
    };
    frame.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame.current);
  }, [animate, value]);

  const missing = shown === null || (value !== null && shown === 0 && animate);

  return (
    <p className="ledger-figure">
      <span className={clsx('ledger-value', missing && 'is-blank')} aria-hidden="true">
        {missing ? '__' : shown}
      </span>
      <span className="sr-only">
        {value === null ? `No ${unit} measured yet` : `${value} ${unit}`}
      </span>
      <span className="ledger-unit">{unit}</span>
    </p>
  );
}

/** "Friday", or the date itself where it cannot be parsed. */
function shortDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { weekday: 'long' });
}
