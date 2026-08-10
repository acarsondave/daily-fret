import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CaretDownIcon, TrophyIcon } from '../icons';
import { getTodayString, useUserData } from '../../store';
import { buildHistory, weeklyTotals, type HistoryDay } from '../../lib/history';
import { EmptyState } from './EmptyState';
import './history.css';

const PAGE = 14;
/** Half a year of weeks: long enough to show a habit, short enough to read. */
const WEEKS_SHOWN = 26;

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonth(week: string): string {
  const [, month, day] = week.split('-');
  return `${parseInt(day, 10)} ${MONTHS[parseInt(month, 10)] ?? ''}`;
}

/**
 * What you actually did, day by day.
 *
 * The app could report a best change rate and a streak but not what happened on
 * a given Tuesday, which is the first question anyone asks when they wonder
 * whether the practice is working. Everything here is the log read back; nothing
 * is summarised into a verdict.
 */
interface Props {
  onStartSession?: () => void;
}

export function HistoryPanel({ onStartSession }: Props) {
  const data = useUserData();
  const [shown, setShown] = useState(PAGE);
  // `undefined` means the player has not chosen yet, which is not the same as
  // having closed everything: the newest day opens itself so the tab answers
  // "what did I just do" without a click, and stays closable.
  const [open, setOpen] = useState<string | null | undefined>(undefined);

  const days = useMemo(
    () => buildHistory(data.dailyLogs, data.routines),
    [data.dailyLogs, data.routines],
  );
  const weeks = useMemo(
    () => weeklyTotals(days, getTodayString()).slice(-WEEKS_SHOWN),
    [days],
  );
  const busiest = useMemo(() => Math.max(1, ...weeks.map((w) => w.count)), [weeks]);
  const practisedWeeks = useMemo(() => weeks.filter((w) => w.count > 0).length, [weeks]);

  if (!days.length) {
    return (
      <EmptyState
        icon={<TrophyIcon size={26} />}
        title="Nothing logged yet"
        body="Every day you practise lands here, with what you played and how it went."
        action={onStartSession && { label: 'Start today\u2019s session', onClick: onStartSession }}
      />
    );
  }

  return (
    <div className="history">
      {weeks.length > 1 && (
        <section className="history-weeks">
          <h3 className="history-title">Days practised, by week</h3>
          {/* Bars rather than a heat grid: seven possible values a week does not
              need a colour scale, and a bar can be read without a legend.
              Twenty-six of them read as a shape, not as twenty-six numbers, so
              the screen reader gets the shape in one sentence instead. */}
          <ol className="history-bars" aria-hidden="true">
            {weeks.map((w) => (
              <li key={w.week} className="history-bar-slot">
                {/* A week off leaves an empty slot. Drawing a stub for zero
                    would make a gap look like a day of practice. */}
                {w.count > 0 && (
                  <span
                    className="history-bar"
                    style={{ height: `${Math.round((w.count / busiest) * 100)}%` }}
                    title={`Week of ${w.week}: ${w.count} day${w.count === 1 ? '' : 's'}`}
                  />
                )}
              </li>
            ))}
          </ol>
          <p className="history-axis" aria-hidden="true">
            <span>{shortMonth(weeks[0].week)}</span>
            <span>This week</span>
          </p>
          <span className="history-scale">
            Practised in {practisedWeeks} of the last {weeks.length} weeks, busiest {busiest} day
            {busiest === 1 ? '' : 's'}.
          </span>
          <span className="sr-only">
            Days practised each week over the last {weeks.length} weeks, from{' '}
            {shortMonth(weeks[0].week)} to this week. You practised in {practisedWeeks} of them, and
            the busiest week held {busiest} day{busiest === 1 ? '' : 's'}.
          </span>
        </section>
      )}

      <section className="history-days">
        <h3 className="history-title">Every day you practised</h3>
        <ul className="history-list">
          {days.slice(0, shown).map((day) => {
            const isOpen = (open === undefined ? days[0].date : open) === day.date;
            return (
              <DayRow
                key={day.date}
                day={day}
                open={isOpen}
                onToggle={() => setOpen(isOpen ? null : day.date)}
              />
            );
          })}
        </ul>
        {shown < days.length && (
          <button type="button" className="history-more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, days.length - shown)} more of {days.length}
          </button>
        )}
      </section>
    </div>
  );
}

function DayRow({ day, open, onToggle }: { day: HistoryDay; open: boolean; onToggle: () => void }) {
  const summary = day.results.length
    ? `${day.results.length} drill${day.results.length === 1 ? '' : 's'}`
    : day.completed
      ? `${day.completed} task${day.completed === 1 ? '' : 's'}`
      : 'a note';

  return (
    <li className={clsx('history-day', open && 'is-open')}>
      <button type="button" className="history-day-head" onClick={onToggle} aria-expanded={open}>
        <span className="history-day-date">{day.label}</span>
        <span className="history-day-summary">
          {summary}
          {day.bests > 0 && (
            <span className="history-day-bests">
              <TrophyIcon size={12} /> {day.bests}
            </span>
          )}
        </span>
        <CaretDownIcon size={16} className={clsx('history-caret', open && 'is-open')} />
      </button>

      {open && (
        <div className="history-day-body">
          {day.routineName && (
            <p className="history-day-routine">
              {day.routineName}
              {day.planned !== null && ` · ${day.completed} of ${day.planned} done`}
            </p>
          )}
          {day.results.length > 0 && (
            <ul className="history-results">
              {day.results.map((r) => (
                <li key={r.key} className={clsx('history-result', r.isBest && 'is-best')}>
                  <span className="history-result-name">{r.label}</span>
                  <span className="history-result-value">
                    {r.value}
                    {r.unit && <span className="history-result-unit"> {r.unit}</span>}
                  </span>
                  {/* What it beat, rather than just that it was a best. The
                      number it improved on is the interesting half. */}
                  {r.isBest && r.previousBest !== null && (
                    <span className="history-result-note">up from {r.previousBest}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {day.feedback && <blockquote className="history-note">{day.feedback}</blockquote>}
        </div>
      )}
    </li>
  );
}
