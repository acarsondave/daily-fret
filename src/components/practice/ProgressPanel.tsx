import { TrendUp, TrendDown, Minus } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useDrillStats } from '../../lib/drillStats';
import { Sparkline } from './Sparkline';
import './progress.css';

export function ProgressPanel() {
  const stats = useDrillStats().filter((s) => s.series.length > 0);

  if (stats.length === 0) {
    return (
      <p className="progress-empty">
        Run a 1-Minute Changes drill to start tracking your change speed.
      </p>
    );
  }

  const sorted = [...stats].sort((a, b) => b.best - a.best);
  const topBest = Math.max(...stats.map((s) => s.best));
  const totalSessions = stats.reduce((sum, s) => sum + s.series.length, 0);

  return (
    <div className="progress-root">
      <div className="progress-summary">
        <div className="progress-stat">
          <span className="progress-stat-value">{topBest}</span>
          <span className="progress-stat-label">top cpm</span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value">{stats.length}</span>
          <span className="progress-stat-label">
            pair{stats.length === 1 ? '' : 's'} trained
          </span>
        </div>
        <div className="progress-stat">
          <span className="progress-stat-value">{totalSessions}</span>
          <span className="progress-stat-label">
            session{totalSessions === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="progress-list">
        {sorted.map((s) => {
          const cpms = s.series.map((p) => p.cpm);
          const first = cpms[0];
          const last = cpms[cpms.length - 1];
          const hasTrend = cpms.length >= 2;
          const deltaPct =
            hasTrend && first > 0 ? Math.round(((last - first) / first) * 100) : 0;
          const dir = !hasTrend ? 'flat' : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';

          return (
            <div key={s.taskId} className="progress-row">
              <div className="progress-row-main">
                <div className="progress-row-head">
                  <span className="progress-pair">
                    {s.from} <span className="progress-arrow">→</span> {s.to}
                  </span>
                  {hasTrend && (
                    <span className={clsx('progress-trend', `is-${dir}`)}>
                      {dir === 'up' && <TrendUp size={13} weight="bold" />}
                      {dir === 'down' && <TrendDown size={13} weight="bold" />}
                      {dir === 'flat' && <Minus size={13} weight="bold" />}
                      {dir === 'up' ? '+' : ''}
                      {deltaPct}%
                    </span>
                  )}
                </div>
                <div className="progress-figure">
                  <span className="progress-best-value">{s.best}</span>
                  <span className="progress-best-unit">cpm best</span>
                </div>
                <span className="progress-meta">
                  {s.today !== null ? `Today ${s.today}` : `Last ${last}`}
                  {' · '}
                  {cpms.length} session{cpms.length === 1 ? '' : 's'}
                </span>
              </div>

              {hasTrend && (
                <div className={clsx('progress-trend-line', `is-${dir}`)}>
                  <Sparkline values={cpms} width={108} height={48} area />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
