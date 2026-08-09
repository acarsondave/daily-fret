import { useMemo, useState } from 'react';
import { FlameIcon, MinusIcon, PlayIcon, TargetIcon, TrendDownIcon, TrendUpIcon } from '../icons';
import clsx from 'clsx';
import { useDrillStats } from '../../hooks/useDrillStats';
import { recommendNext, type DrillStat } from '../../lib/drillStats';
import { useUserData } from '../../store';
import { ProgressChart } from './ProgressChart';
import { EmptyState } from './EmptyState';
import './progress.css';

function currentStreak(dailyLogs: Record<string, { completedTaskIds?: string[] }>): number {
  let streak = 0;
  const d = new Date();
  // Allow today to be empty (you may not have practiced yet) without breaking it.
  for (let i = 0; i < 400; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const done = (dailyLogs[key]?.completedTaskIds?.length ?? 0) > 0;
    if (done) streak += 1;
    else if (i !== 0) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// What the chart's axis is actually counting, in words.
function unitLabel(stat: DrillStat): string {
  if (stat.kind === 'pair') return 'changes / min';
  return stat.unit === 'placed' ? 'shapes placed' : 'changes per drill';
}

interface RowProps {
  stat: DrillStat;
  isActive: boolean;
  onSelect: () => void;
}

function StatRow({ stat, isActive, onSelect }: RowProps) {
  const values = stat.series.map((p) => p.value);
  const first = values[0];
  const last = values[values.length - 1];
  const hasTrend = values.length >= 2;
  const deltaPct = hasTrend && first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const dir = !hasTrend ? 'flat' : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';

  return (
    <button
      className={clsx('progress-pair-row', isActive && 'is-active')}
      onClick={onSelect}
      aria-pressed={isActive}
    >
      <span className="progress-pair-name">{stat.label}</span>
      <span className="progress-pair-best">
        {stat.best}
        <span className="progress-pair-unit">{stat.unit}</span>
      </span>
      {hasTrend && (
        <span className={clsx('progress-trend', `is-${dir}`)}>
          {dir === 'up' && <TrendUpIcon size={12} />}
          {dir === 'down' && <TrendDownIcon size={12} />}
          {dir === 'flat' && <MinusIcon size={12} />}
          {dir === 'up' ? '+' : ''}
          {deltaPct}%
        </span>
      )}
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
  const userData = useUserData();

  const sortedPairs = useMemo(() => [...pairs].sort((a, b) => b.best - a.best), [pairs]);
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => b.best - a.best), [tasks]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (!any) {
    return (
      <EmptyState
        icon={<TargetIcon size={26} />}
        title="No measurements yet"
        body="Run a drill that listens and its history starts building here. Each drill keeps its own benchmark."
        action={onStartSession && { label: 'Start today’s session', onClick: onStartSession }}
      />
    );
  }

  // One chart, either family. Chord changes lead, because they are the measure
  // the app prescribes tempo from.
  const everything: DrillStat[] = [...sortedPairs, ...sortedTasks];
  // Open on something with a shape to it. Sorting by personal best alone put a
  // single-session pair at the top, so the panel greeted you with a chart
  // holding one dot — the highest number, and nothing to read from it.
  const chartable = everything.filter((s) => s.series.length >= 2);
  const selected: DrillStat =
    everything.find((s) => s.key === selectedKey) ?? chartable[0] ?? everything[0];

  const totalSessions = everything.reduce((sum, s) => sum + s.series.length, 0);
  const topPair = sortedPairs.length ? sortedPairs[0].best : null;
  const streak = currentStreak(userData?.dailyLogs ?? {});
  const recommendation = recommendNext(sortedPairs);

  return (
    <div className="progress-root">
      {recommendation && onPracticePair && (
        <button
          className="progress-reco"
          onClick={() => onPracticePair(recommendation.stat.from, recommendation.stat.to)}
        >
          <TargetIcon size={20} className="progress-reco-icon" />
          <span className="progress-reco-text">
            <span className="progress-reco-label">Practice next</span>
            <span className="progress-reco-pair">
              {recommendation.stat.from} → {recommendation.stat.to}
              <span className="progress-reco-reason"> · {recommendation.reason}</span>
            </span>
          </span>
          <span className="progress-reco-go">
            <PlayIcon size={16} />
          </span>
        </button>
      )}

      <div className="progress-summary">
        <div className="progress-stat">
          {/* An em dash rather than a 0: no chord-change history is not a score
              of zero, and this panel must not imply one. */}
          <span className="progress-stat-value">{topPair ?? '—'}</span>
          <span className="progress-stat-label">top cpm</span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value">{totalSessions}</span>
          <span className="progress-stat-label">session{totalSessions === 1 ? '' : 's'}</span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value progress-stat-streak">
            {streak > 0 && <FlameIcon size={18} />}
            {streak}
          </span>
          <span className="progress-stat-label">day streak</span>
        </div>
      </div>

      <div className="progress-chart-card">
        <div className="progress-chart-head">
          <div className="progress-chart-titles">
            <span className="progress-chart-pair">{selected.label}</span>
            <span className="progress-chart-sub">best {unitLabel(selected)}</span>
          </div>
          <span className="progress-chart-best">{selected.best}</span>
        </div>
        <ProgressChart series={selected.series} unitLabel={unitLabel(selected)} />
      </div>

      {sortedPairs.length > 0 && (
        <section className="progress-section">
          <h3 className="progress-section-title">Chord changes</h3>
          <div className="progress-pairs">
            {sortedPairs.map((s) => (
              <StatRow
                key={s.key}
                stat={s}
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
                isActive={s.key === selected.key}
                onSelect={() => setSelectedKey(s.key)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
