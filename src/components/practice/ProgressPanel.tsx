import { useMemo, useState } from 'react';
import { CheckIcon, FlameIcon, MinusIcon, PlayIcon, TrendDownIcon, TrendUpIcon, TrophyIcon } from '../icons';
import clsx from 'clsx';
import { useDrillStats } from '../../hooks/useDrillStats';
import {
  pickFocus,
  recentTrend,
  recommendNext,
  trendLabel,
  type DrillStat,
  type Trend,
} from '../../lib/drillStats';
import { readiness, CHANGES_BAR, ROTATION_BAR, type Readiness } from '../../lib/readiness';
import { parseRingKey, parseSweepKey } from '../../lib/drillKeys';
import { restAdvice, computeXp } from '../../lib/xp';
import { getTodayString, useUserData } from '../../store';
import { ProgressChart } from './ProgressChart';
import { EmptyState } from './EmptyState';
import { ProgressPreview } from './EmptyPreviews';
import './progress.css';

/**
 * Whether this drill's number can be repeated, where the app is entitled to an
 * opinion about it.
 *
 * What decides it is having a bar, not what kind of drill it is. This used to
 * be chord pairs only, because everything else was filed under a task id and
 * lost its beginning whenever a routine was rebuilt; keys name what was played
 * now (src/lib/drillKeys.ts), so an anchor ring survives the same way a pair
 * always did and is judged against its own bar.
 *
 * Chord Perfect still carries no mark, and that is a statement about the number
 * rather than about the drill. A pool score is every placement in a block, and
 * lib/readiness.ts has no bar for placements: CHORD_BAR is a change rate. A
 * "held" chip against a bar the app invented on the spot would be exactly the
 * kind of unearned verdict this file exists to avoid.
 */
function readinessOf(stat: DrillStat, today: string): Readiness | null {
  if (stat.kind === 'pair') return readiness(stat.series, CHANGES_BAR, today);
  if (parseRingKey(stat.key) || parseSweepKey(stat.key)) return readiness(stat.series, ROTATION_BAR, today);
  return null;
}

// What the chart's axis is actually counting, in words.
//
// Read off the stat's own unit rather than guessed from what it is not. A key
// the app can no longer identify carries an empty unit, and the old else-branch
// labelled those "changes per drill" on the strength of not being placements,
// which is a claim about a number whose drill is exactly what has been lost.
function unitLabel(stat: DrillStat): string {
  if (stat.kind === 'pair') return 'changes / min';
  if (stat.unit === 'placed') return 'shapes placed';
  if (stat.unit === 'changes') return 'changes per drill';
  return 'result';
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${parseInt(day, 10)} ${MONTHS[parseInt(month, 10)] ?? ''}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function TrendChip({ trend, size = 12 }: { trend: Trend; size?: number }) {
  const Mark = trend.direction === 'up' ? TrendUpIcon : trend.direction === 'down' ? TrendDownIcon : MinusIcon;
  return (
    <span className={clsx('progress-trend', `is-${trend.direction}`)}>
      <Mark size={size} />
      {trendLabel(trend)}
    </span>
  );
}

interface RowProps {
  stat: DrillStat;
  today: string;
  isActive: boolean;
  onSelect: () => void;
}

function StatRow({ stat, today, isActive, onSelect }: RowProps) {
  const trend = recentTrend(stat.series);
  const latest = stat.series[stat.series.length - 1];
  // Only a settled answer belongs in a list being scanned. A part-built streak
  // is real progress and it is still a running total, so it says its piece in
  // the focus section where there is room for the sentence, and stays out of
  // twenty rows the player is reading down.
  const ready = readinessOf(stat, today);
  const standing = ready?.state === 'held' || ready?.state === 'lapsed' ? ready : null;

  return (
    <button
      type="button"
      className={clsx('progress-pair-row', isActive && 'is-active')}
      onClick={onSelect}
      aria-pressed={isActive}
    >
      <span className="progress-pair-label">
        <span className="progress-pair-name">{stat.label}</span>
        {standing && (
          <span className={clsx('progress-standing', `is-${standing.state}`)}>
            {standing.state === 'held' && <CheckIcon size={12} aria-hidden="true" />}
            {standing.label}
          </span>
        )}
      </span>
      <span className="progress-pair-figures">
        <span className="progress-pair-best">
          {latest.value}
          <span className="progress-pair-unit">{stat.unit}</span>
        </span>
        {/* With one run the latest *is* the best, and printing both twice says
            nothing the row has not already said. */}
        {stat.series.length > 1 && <span className="progress-pair-context">best {stat.best}</span>}
      </span>
      {/* A single session gets a statement of its own, not a blank column: a
          missing chip reads as a chip the app failed to draw. */}
      {trend ? <TrendChip trend={trend} /> : <span className="progress-trend is-none">1 run</span>}
    </button>
  );
}

interface Props {
  onPracticePair?: (from: string, to: string) => void;
  /* Absent when the routine has nothing coachable to start. */
  onStartSession?: () => void;
}

export function ProgressPanel({ onPracticePair, onStartSession }: Props) {
  const { pairs, tasks, any } = useDrillStats();
  const { dailyLogs } = useUserData();
  // Read once and handed down, so every row and the focus line agree about
  // what day it is even if the panel is open across midnight.
  const today = getTodayString();

  const sortedPairs = useMemo(() => [...pairs].sort((a, b) => b.best - a.best), [pairs]);
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => b.best - a.best), [tasks]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Both counts come from lib/xp so the Numbers tab and the Awards tab can
  // never disagree about how much practice happened. This panel used to carry
  // its own streak that counted a day as practised if any task was ticked,
  // which xp.ts deliberately refuses to do; the two answers differed by weeks.
  const totals = useMemo(() => {
    const xp = computeXp(dailyLogs);
    return {
      days: xp.practiceDays,
      results: xp.totalResults,
      streak: restAdvice(dailyLogs, today).run,
    };
  }, [dailyLogs, today]);

  if (!any) {
    return (
      <EmptyState
        preview={<ProgressPreview />}
        title="No measurements yet"
        action={onStartSession && { label: 'Start today’s session', onClick: onStartSession }}
      />
    );
  }

  // One chart, either family. Chord changes lead, because they are the measure
  // the app prescribes tempo from. Which one is on it is decided for the
  // player; the rows below are a way to look elsewhere, not a step to take
  // before the panel says anything.
  const everything: DrillStat[] = [...sortedPairs, ...sortedTasks];
  const selected: DrillStat =
    everything.find((s) => s.key === selectedKey) ?? pickFocus(everything) ?? everything[0];

  const points = selected.series;
  const latest = points[points.length - 1];
  const bestPoint = points.reduce((best, p) => (p.value >= best.value ? p : best), points[0]);
  const bestIsLatest = bestPoint.date === latest.date;
  const trend = recentTrend(points);
  const ready = readinessOf(selected, today);
  const recommendation = recommendNext(sortedPairs);
  const verdict =
    trend === null
      ? null
      : trend.direction === 'up'
        ? 'Improving'
        : trend.direction === 'down'
          ? 'Slipping'
          : 'Holding level';

  return (
    <div className="progress-root">
      {recommendation && onPracticePair && (
        <button
          type="button"
          className="progress-reco"
          onClick={() => onPracticePair(recommendation.stat.from, recommendation.stat.to)}
        >
          <span className="progress-reco-text">
            <span className="progress-reco-label">Practice next</span>
            {/* The stat's own label, so the pair is named identically here, on
                the chart, and in the list. Two spellings of one pair on one
                screen makes the reader check whether they are the same thing. */}
            <span className="progress-reco-pair">{recommendation.stat.label}</span>
            <span className="progress-reco-reason">
              {recommendation.reason} · best {recommendation.stat.best} {recommendation.stat.unit}
            </span>
          </span>
          <span className="progress-reco-go">
            <PlayIcon size={18} />
          </span>
        </button>
      )}

      <section className="progress-focus" aria-label={`${selected.label} over time`}>
        <header className="progress-focus-head">
          <div className="progress-focus-titles">
            <h3 className="progress-focus-title">{selected.label}</h3>
            <p className="progress-focus-sub">
              {unitLabel(selected)} · {plural(points.length, 'run')}
              {selected.today !== null && ' · drilled today'}
            </p>
          </div>
          <div className="progress-focus-figure">
            <span className="progress-focus-value">{latest.value}</span>
            <span className="progress-focus-value-label">latest</span>
          </div>
        </header>

        {/* The reading, done for the player. A chart alone asks them to work
            out whether the last month meant anything; this says it, and then
            names what was compared so the claim can be checked. */}
        {trend && verdict && (
          <p className="progress-focus-trend">
            <span className="progress-focus-verdict">{verdict}</span>
            <TrendChip trend={trend} size={13} />
            <span className="progress-focus-basis">{trend.basis}</span>
          </p>
        )}

        {/* Two readings of the same drill, and they answer different questions.
            The line above says which way the number is going. This one says
            whether it can be repeated, which is the one that decides whether
            the player is done with this pair. It is stated, never celebrated:
            the record gets the trophy, and this gets a tick. */}
        {ready && ready.state !== 'none' && (
          <p className={clsx('progress-standing-line', `is-${ready.state}`)}>
            {ready.label && (
              <>
                <span className="progress-standing-label">
                  {ready.state === 'held' && <CheckIcon size={13} aria-hidden="true" />}
                  {ready.label}
                </span>
                {/* A real space, not the margin that draws one. Without it the
                    two spans concatenate in the accessibility tree and "2 of 3"
                    followed by "33 and 35" is announced as "2 of 333 and 35". */}
                {' '}
              </>
            )}
            <span className="progress-standing-evidence">{ready.evidence}</span>
          </p>
        )}

        {points.length >= 2 ? (
          <ProgressChart series={points} unitLabel={unitLabel(selected)} />
        ) : (
          <p className="progress-focus-single">
            One run so far, on {shortDate(latest.date)}. A second gives this a shape to read.
          </p>
        )}

        <p className="progress-focus-best">
          <TrophyIcon size={13} />
          Best {bestPoint.value} {selected.unit} on {shortDate(bestPoint.date)}
          {bestIsLatest ? ', which is your latest run' : ''}
        </p>
      </section>

      {sortedPairs.length > 0 && (
        <section className="progress-section">
          <h3 className="progress-section-title">Chord changes</h3>
          <div className="progress-pairs">
            {sortedPairs.map((s) => (
              <StatRow
                key={s.key}
                stat={s}
                today={today}
                isActive={s.key === selected.key}
                onSelect={() => setSelectedKey(s.key)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Chord Perfect and the anchor rotation. Their results have always been
          recorded and have always driven the prescribed tempo; until now they
          had nowhere to be seen. */}
      {sortedTasks.length > 0 && (
        <section className="progress-section">
          <h3 className="progress-section-title">Shape drills</h3>
          <div className="progress-pairs">
            {sortedTasks.map((s) => (
              <StatRow
                key={s.key}
                stat={s}
                today={today}
                isActive={s.key === selected.key}
                onSelect={() => setSelectedKey(s.key)}
              />
            ))}
          </div>
        </section>
      )}

      {/* A caption, not a scoreboard. Three hero figures at the top of the panel
          were the loudest thing on it and answered none of the questions the
          panel exists for. */}
      {/* Each fact carries its own trailing separator rather than a leading
          one, so a line that wraps ends on the divider instead of opening
          with an orphaned mark. */}
      <p className="progress-meta">
        <span>{plural(totals.days, 'day')} measured</span>
        <span>{plural(totals.results, 'result')} recorded</span>
        {/* Omitted at zero rather than printed as "0 days running": no run is
            an absence, and the app does not report absences as scores. */}
        {totals.streak > 0 && (
          <span className="progress-meta-streak">
            <FlameIcon size={13} />
            {plural(totals.streak, 'day')} running
          </span>
        )}
      </p>
    </div>
  );
}
