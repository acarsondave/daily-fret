import { useMemo, useState } from 'react';
import { Target, Play, TrendUp, TrendDown, Minus, Fire } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useDrillStats, recommendNext, type PairStat } from '../../lib/drillStats';
import { useUserData } from '../../store';
import { ProgressChart } from './ProgressChart';
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

interface Props {
  onPracticePair?: (from: string, to: string) => void;
}

export function ProgressPanel({ onPracticePair }: Props) {
  const stats = useDrillStats();
  const userData = useUserData();

  const sorted = useMemo(() => [...stats].sort((a, b) => b.best - a.best), [stats]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (stats.length === 0) {
    return (
      <p className="progress-empty">
        Run a Chord Changes drill to start tracking your speed — each pair builds its own benchmark here.
      </p>
    );
  }

  const selected: PairStat = sorted.find((s) => s.key === selectedKey) ?? sorted[0];
  const topBest = Math.max(...stats.map((s) => s.best));
  const totalSessions = stats.reduce((sum, s) => sum + s.series.length, 0);
  const streak = currentStreak(userData?.dailyLogs ?? {});
  const recommendation = recommendNext(stats);

  return (
    <div className="progress-root">
      {recommendation && onPracticePair && (
        <button
          className="progress-reco"
          onClick={() => onPracticePair(recommendation.stat.from, recommendation.stat.to)}
        >
          <Target size={20} weight="duotone" className="progress-reco-icon" />
          <span className="progress-reco-text">
            <span className="progress-reco-label">Practice next</span>
            <span className="progress-reco-pair">
              {recommendation.stat.from} → {recommendation.stat.to}
              <span className="progress-reco-reason"> · {recommendation.reason}</span>
            </span>
          </span>
          <span className="progress-reco-go">
            <Play size={16} weight="fill" />
          </span>
        </button>
      )}

      <div className="progress-summary">
        <div className="progress-stat">
          <span className="progress-stat-value">{topBest}</span>
          <span className="progress-stat-label">top cpm</span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value">{totalSessions}</span>
          <span className="progress-stat-label">session{totalSessions === 1 ? '' : 's'}</span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value progress-stat-streak">
            {streak > 0 && <Fire size={18} weight="fill" />}
            {streak}
          </span>
          <span className="progress-stat-label">day streak</span>
        </div>
      </div>

      <div className="progress-chart-card">
        <div className="progress-chart-head">
          <div className="progress-chart-titles">
            <span className="progress-chart-pair">
              {selected.from} ↔ {selected.to}
            </span>
            <span className="progress-chart-sub">best changes / min</span>
          </div>
          <span className="progress-chart-best">{selected.best}</span>
        </div>
        <ProgressChart series={selected.series} />
      </div>

      <div className="progress-pairs">
        {sorted.map((s) => {
          const cpms = s.series.map((p) => p.cpm);
          const first = cpms[0];
          const last = cpms[cpms.length - 1];
          const hasTrend = cpms.length >= 2;
          const deltaPct = hasTrend && first > 0 ? Math.round(((last - first) / first) * 100) : 0;
          const dir = !hasTrend ? 'flat' : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
          return (
            <button
              key={s.key}
              className={clsx('progress-pair-row', s.key === selected.key && 'is-active')}
              onClick={() => setSelectedKey(s.key)}
            >
              <span className="progress-pair-name">
                {s.from} ↔ {s.to}
              </span>
              <span className="progress-pair-best">
                {s.best}
                <span className="progress-pair-unit">cpm</span>
              </span>
              {hasTrend && (
                <span className={clsx('progress-trend', `is-${dir}`)}>
                  {dir === 'up' && <TrendUp size={12} weight="bold" />}
                  {dir === 'down' && <TrendDown size={12} weight="bold" />}
                  {dir === 'flat' && <Minus size={12} weight="bold" />}
                  {dir === 'up' ? '+' : ''}
                  {deltaPct}%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
